$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
& "$PSScriptRoot\build-msi-actions.ps1" -Test
if($LASTEXITCODE -ne 0){throw 'MSI 原生路径测试失败'}
# 质量检查不创建证书信任，也不执行安装。
foreach($path in @('src-tauri/src/services/settings/maintenance.ps1','scripts/prepare-package-certificate.ps1','scripts/sign-windows-package.ps1','scripts/test-package-lifecycle.ps1','scripts/prepare-dotnet.ps1','scripts/build-windows-bridge.ps1','scripts/build-hardware-monitor.ps1')){
    $tokens=$null;$errors=$null
    $null=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText((Join-Path $projectRoot $path)),[ref]$tokens,[ref]$errors)
    if($errors.Count){throw ('安装体系脚本存在语法错误：'+$path)}
}
