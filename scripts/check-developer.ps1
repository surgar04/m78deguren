param([switch]$Clippy)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
# 仅做静态编译，不生成桌面应用或安装包；有效编号供编译期校验。
$env:ZHENJING_DEVELOPER_BUILD='1'
$arguments=@('check','--manifest-path','src-tauri/Cargo.toml','--locked','--features','developer-edition')
if($Clippy){$arguments=@('clippy','--manifest-path','src-tauri/Cargo.toml','--locked','--features','developer-edition','--all-targets','--','-D','warnings')}
& (Join-Path $projectRoot '.tools/cargo/bin/cargo.exe') @arguments
exit $LASTEXITCODE
