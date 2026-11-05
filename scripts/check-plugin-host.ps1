# 独立宿主使用自己的锁文件和质量入口；不依赖桌面主程序的 feature 合并结果。
$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
$pluginHostTarget=Join-Path $projectRoot '.cache/cargo/target'
& cargo fmt --manifest-path native/plugin-host/Cargo.toml --all -- --check
if($LASTEXITCODE -ne 0){throw 'Plugin host formatting failed'}
& cargo clippy --manifest-path native/plugin-host/Cargo.toml --locked --target-dir $pluginHostTarget --all-targets -- -D warnings
if($LASTEXITCODE -ne 0){throw 'Plugin host lint failed'}
& cargo test --manifest-path native/plugin-host/Cargo.toml --locked --target-dir $pluginHostTarget
if($LASTEXITCODE -ne 0){throw 'Plugin host tests failed'}
