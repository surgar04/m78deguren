param([switch]$Debug,[switch]$Publish)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
if($Debug){throw '分发包只支持 Release；调试请使用 desktop:dev。'}

if($Publish){
    & (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\publish-release.ts') --preflight
    if($LASTEXITCODE -ne 0){throw 'GitHub 发布预检未通过；未清理或覆盖现有安装包。'}
}
# 应用版本升级后先重建受版本约束的原生 DLL，避免把旧版本组件带入检查或安装包。
# 只使用 D 盘便携 SDK；不放宽 Rust 构建期的版本、来源和逐文件摘要校验。
$packageVersion=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw|ConvertFrom-Json).version
$bridgeManifest=Join-Path $projectRoot 'src-tauri/resources/windows-bridge/manifest.json'
if(-not (Test-Path -LiteralPath $bridgeManifest) -or (Get-Content -LiteralPath $bridgeManifest -Raw|ConvertFrom-Json).version -ne $packageVersion){
    & "$PSScriptRoot\build-windows-bridge.ps1"
}
$monitorLibrary=Join-Path $projectRoot 'src-tauri/resources/hardware-monitor/runtime/ZhenjingMonitor.dll'
if(-not (Test-Path -LiteralPath $monitorLibrary) -or [Diagnostics.FileVersionInfo]::GetVersionInfo($monitorLibrary).FileVersion -ne ($packageVersion+'.0')){
    & "$PSScriptRoot\build-hardware-monitor.ps1"
}
& (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot '.tools\pnpm\bin\pnpm.cjs') check
if($LASTEXITCODE -ne 0){throw '质量检查未通过，停止打包与发布。'}
& "$PSScriptRoot\clean-packages.ps1"
& "$PSScriptRoot\prepare-msi-tools.ps1"
# 统一使用 MSI，保留 Windows Installer 事务，不生成其他安装格式。
$env:LOCALAPPDATA=$env:TAURI_BUNDLER_TOOLS_DIR
$arguments=@('tauri','build','--bundles','msi')
& (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot '.tools\pnpm\bin\pnpm.cjs') @arguments
if($LASTEXITCODE -ne 0){throw 'Windows 安装包构建失败'}
& "$PSScriptRoot\prepare-package-certificate.ps1"
& "$PSScriptRoot\collect-installer.ps1" -Profile release
& (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\sign-release.ts')
if($LASTEXITCODE -ne 0){throw 'MSI 发布清单生成失败'}
# 必须解包核对实际 MSI，而不是仅凭 WiX 成功就报告可分发。
& (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\verify-installer.ts')
if($LASTEXITCODE -ne 0){throw 'MSI 包内组件、许可、签名清单或程序一致性验收失败；禁止发布。'}
if($Publish){
    & (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\publish-release.ts')
    if($LASTEXITCODE -ne 0){throw 'MSI 已在本地生成，但 GitHub Release 发布未完成；修复权限/网络后运行 release:publish 重试，不要宣称线上更新已生效。'}
}else{Write-Output '本地构建已完成；按用户选择等待手动上传完整 dist\desktop 到 GitHub Release。尚未上线。'}
# 只构建和检查，不执行安装器；真实安装/卸载由用户自行启动。
