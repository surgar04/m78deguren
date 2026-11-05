param([ValidateRange(1,999999)][int]$DeveloperBuild=1)
$ErrorActionPreference='Stop'
$env:ZHENJING_BUILD_EDITION='developer'
$env:ZHENJING_DEVELOPER_BUILD=[string]$DeveloperBuild
. "$PSScriptRoot/env.ps1"
# 通过正式验证器读取既有私有凭据；仅使用合成成员及临时账本，联网 API 由专用命令单独验收。
& cargo test --manifest-path src-tauri/Cargo.toml --locked --features developer-edition --lib native_developer_dues -- --ignored --test-threads=1
exit $LASTEXITCODE
