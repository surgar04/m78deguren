param([ValidateRange(1,999999)][int]$DeveloperBuild=1)
$ErrorActionPreference='Stop'
$env:ZHENJING_BUILD_EDITION='developer'
$env:ZHENJING_DEVELOPER_BUILD=[string]$DeveloperBuild
. "$PSScriptRoot/env.ps1"
# 仅通过实际身份验证器读取既有私有凭据，联网只读固定 API；所有缴费均属于临时测试账本。
& cargo test --manifest-path src-tauri/Cargo.toml --locked --features developer-edition --lib native_developer_dues -- --ignored --test-threads=1
exit $LASTEXITCODE
