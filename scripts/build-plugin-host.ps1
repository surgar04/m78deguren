param([switch]$Release)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
$pluginHostDestination=Join-Path $projectRoot 'src-tauri/resources/plugin-host'
New-Item -ItemType Directory -Force -Path $pluginHostDestination | Out-Null
# 插件宿主不包含稳定/开发者发行状态。两种主程序复用同一份构建缓存，避免成对打包重复编译 Wasmtime。
$pluginHostTarget=Join-Path $projectRoot '.cache/cargo/target'
$pluginHostTriple='x86_64-pc-windows-msvc'
$pluginBuildArgs=@('build','--manifest-path','native/plugin-host/Cargo.toml','--locked','--target',$pluginHostTriple,'--target-dir',$pluginHostTarget)
$pluginProfile='plugin-runtime'
if($Release){$pluginBuildArgs+='--release';$pluginProfile='release'}else{$pluginBuildArgs+=@('--profile','plugin-runtime')}
$pluginBuildArgs+=@('--jobs','2')
# 独立 Cargo 入口不会继承 Tauri CLI 的静态 CRT 策略。必须同时让 Rust 和 C/C++ 依赖选择 /MT，
# 并显式指定 target，避免把目标参数施加到编译期 proc-macro。仅修改本构建进程，结束后恢复。
$pluginOldRustFlags=$env:RUSTFLAGS
$pluginOldEncodedFlags=$env:CARGO_ENCODED_RUSTFLAGS
try {
    if($pluginOldEncodedFlags){$env:CARGO_ENCODED_RUSTFLAGS=$pluginOldEncodedFlags+[char]31+'-C'+[char]31+'target-feature=+crt-static'}
    else{$env:RUSTFLAGS=($pluginOldRustFlags+' -C target-feature=+crt-static').Trim()}
    & cargo @pluginBuildArgs
    if($LASTEXITCODE -ne 0){throw '插件宿主未链接成功，禁止生成组件摘要'}
}finally{
    $env:RUSTFLAGS=$pluginOldRustFlags
    $env:CARGO_ENCODED_RUSTFLAGS=$pluginOldEncodedFlags
}
$pluginHostSource=Join-Path $pluginHostTarget "$pluginHostTriple/$pluginProfile/zhenjing-plugin-host.exe"
$pluginHostImports=& (Join-Path $projectRoot '.tools/msvc/bin/dumpbin.exe') /dependents $pluginHostSource | Out-String
if($LASTEXITCODE -ne 0 -or $pluginHostImports -match '(?im)^\s+(?:vcruntime|msvcp|msvcr|concrt)\d[\w.-]*\.dll\s*$'){
    throw '插件宿主仍依赖额外 VC++ 运行库，拒绝生成分发资源。'
}
$pluginHostDestination=Join-Path $projectRoot 'src-tauri/resources/plugin-host'
New-Item -ItemType Directory -Force -Path $pluginHostDestination | Out-Null
$pluginHostDigest=(Get-FileHash -LiteralPath $pluginHostSource -Algorithm SHA256).Hash.ToLowerInvariant()
$pluginHostDeployed=Join-Path $pluginHostDestination 'zhenjing-plugin-host.exe'
# 内容不变时保留目标文件与摘要时间戳，避免每次 desktop:dev 都触发主程序无效重编译。
if(-not (Test-Path -LiteralPath $pluginHostDeployed) -or (Get-FileHash -LiteralPath $pluginHostDeployed -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pluginHostDigest){
    Copy-Item -LiteralPath $pluginHostSource -Destination $pluginHostDeployed -Force
}
& (Join-Path $projectRoot '.tools/node/node.exe') (Join-Path $projectRoot 'scripts/collect-plugin-licenses.ts')
if($LASTEXITCODE -ne 0){throw '插件宿主依赖许可收集失败'}
$pluginHostFiles=[ordered]@{'zhenjing-plugin-host.exe'=$pluginHostDigest}
foreach($pluginLicense in Get-ChildItem -LiteralPath (Join-Path $pluginHostDestination 'licenses') -Recurse -File | Sort-Object FullName){
    $pluginRelative=$pluginLicense.FullName.Substring($pluginHostDestination.Length+1).Replace('\','/')
    $pluginHostFiles[$pluginRelative]=(Get-FileHash -LiteralPath $pluginLicense.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
$pluginHostManifest=[ordered]@{schemaVersion=1;sha256=$pluginHostDigest;files=$pluginHostFiles} | ConvertTo-Json -Depth 4
$pluginHostManifestPath=Join-Path $pluginHostDestination 'manifest.json'
if(-not (Test-Path -LiteralPath $pluginHostManifestPath) -or [IO.File]::ReadAllText($pluginHostManifestPath) -cne $pluginHostManifest){
    [IO.File]::WriteAllText($pluginHostManifestPath,$pluginHostManifest,[Text.UTF8Encoding]::new($false))
}
Write-Output '独立插件宿主已链接并生成摘要；主程序下一次构建会内嵌该摘要。'
