# Cargo 只在当前开发进程使用此 runner，不修改全局 Cargo 配置、系统清单或注册表。
# Tauri/rfd 的测试 EXE 不带应用清单；嵌入 Common Controls v6 后才能解析 TaskDialogIndirect。
$ErrorActionPreference='Stop'
$nativeTestInvocation=@($args)
. "$PSScriptRoot/env.ps1"
if($nativeTestInvocation.Count -lt 1){throw 'Missing Cargo executable'}
$nativeTestExecutable=[IO.Path]::GetFullPath([string]$nativeTestInvocation[0])
$nativeTestArguments=@($nativeTestInvocation | Select-Object -Skip 1)
$nativeTestTargetRoot=[IO.Path]::GetFullPath($env:CARGO_TARGET_DIR).TrimEnd('\')+'\'
$nativeTestIsOwned=$nativeTestExecutable.StartsWith($nativeTestTargetRoot,[StringComparison]::OrdinalIgnoreCase)
if($nativeTestIsOwned -and [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($nativeTestExecutable)) -eq 'deps' -and [IO.Path]::GetFileName($nativeTestExecutable) -like 'zhenjing_lib-*.exe'){
    if([IO.Path]::GetPathRoot($nativeTestExecutable) -ine 'D:\'){throw 'Native tests must remain on D:'}
    $nativeManifestTool=Get-Command mt.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if(-not $nativeManifestTool){throw 'Windows SDK mt.exe is required. Official SDK: https://developer.microsoft.com/windows/downloads/windows-sdk/'}
    $nativeManifestPath=$nativeTestExecutable+'.manifest'
    $nativeManifestText='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><assemblyIdentity version="1.0.0.0" processorArchitecture="*" name="Zhenjing.NativeTests" type="win32"/><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency></assembly>'
    [IO.File]::WriteAllText($nativeManifestPath,$nativeManifestText,[Text.UTF8Encoding]::new($false))
    & $nativeManifestTool.Source -nologo -manifest $nativeManifestPath "-outputresource:$nativeTestExecutable;#1"
    if($LASTEXITCODE -ne 0){throw 'Native test manifest could not be embedded'}
}
& $nativeTestExecutable @nativeTestArguments
exit $LASTEXITCODE
