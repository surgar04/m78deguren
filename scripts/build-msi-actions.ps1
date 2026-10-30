param([ValidateSet('release','debug')][string]$Profile='release',[switch]$Test)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
$template=[IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri\installer\installer.wxs'))
$generated=Join-Path $projectRoot '.cache\msi\installer.wxs'
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($generated))|Out-Null
& (Join-Path $projectRoot '.tools/node/node.exe') (Join-Path $projectRoot 'scripts/generate-msi-components.ts')
if($LASTEXITCODE -ne 0){throw 'MSI 显式文件布局生成失败'}
$directory=Join-Path $env:CARGO_TARGET_DIR $Profile
[IO.Directory]::CreateDirectory($directory)|Out-Null
$source=Join-Path $projectRoot 'native\msi-actions\installer.cpp'
$output=Join-Path $directory 'zhenjing.exe.msi-actions.dll'
$object=Join-Path $directory 'msi-actions.obj'
$arguments=@('/nologo','/std:c++20','/utf-8','/W4','/WX','/O2','/MT','/EHsc','/DUNICODE','/D_UNICODE',('/Fo'+$object))
if($Test){
    $output=Join-Path $directory 'msi-actions-tests.exe'
    $arguments+='/DZHENJING_INSTALLER_TEST'
}else{$arguments+='/LD'}
$arguments+=@($source,('/Fe'+$output),'/link','Msi.Lib','Advapi32.Lib','Shell32.Lib')
& (Join-Path $projectRoot '.tools\msvc\bin\cl.exe') @arguments
if($LASTEXITCODE -ne 0){throw 'MSI 原生路径校验编译失败'}
if($Test){& $output;if($LASTEXITCODE -ne 0){throw 'MSI 路径校验测试失败'}}
