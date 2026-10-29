param([switch]$Debug,[switch]$Publish)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
if($Debug){throw '分发包只支持 Release；调试请使用 desktop:dev。'}

if($Publish){
    & (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\publish-release.ts') --preflight
    if($LASTEXITCODE -ne 0){throw 'GitHub 发布预检未通过；未清理或覆盖现有安装包。'}
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
if($Publish){
    & (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\publish-release.ts')
    if($LASTEXITCODE -ne 0){throw 'MSI 已在本地生成，但 GitHub Release 发布未完成；修复权限/网络后运行 release:publish 重试，不要宣称线上更新已生效。'}
}else{Write-Output '本地构建已完成；按用户选择等待手动上传完整 dist\desktop 到 GitHub Release。尚未上线。'}
# 只构建和检查，不执行安装器；真实安装/卸载由用户自行启动。
