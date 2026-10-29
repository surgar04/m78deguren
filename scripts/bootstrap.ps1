param(
    [string]$MsvcSource = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207',
    [string]$SdkSource = 'C:\Program Files (x86)\Windows Kits\10',
    [string]$SdkVersion = '10.0.26100.0'
)
$ErrorActionPreference = 'Stop'
$originalProfile = [Environment]::GetFolderPath('UserProfile')
. "$PSScriptRoot\env.ps1"
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path '.tools\msvc\bin\link.exe') -and -not (Test-Path "$MsvcSource\bin\Hostx64\x64\link.exe")) {
    throw '缺少可只读复用的 MSVC 源组件；禁止调用系统安装器。'
}
if (-not (Test-Path '.tools\winsdk\lib\um\kernel32.lib') -and -not (Test-Path "$SdkSource\Lib\$SdkVersion\um\x64\kernel32.lib")) {
    throw '缺少可只读复用的 Windows SDK 源组件；禁止调用系统安装器。'
}

function Copy-ToolDirectory([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) { throw "缺少源组件: $Source" }
    $output = Join-Path $projectRoot $Destination
    if (-not ([IO.Path]::GetFullPath($output)).StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw '目标必须在 D 盘' }
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    & robocopy $Source $output /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "复制失败: $Source" }
}

# 便携 ZIP + 官方 SHA256；不运行系统安装器，也不修改注册表。
if (-not (Test-Path '.tools\node\node.exe')) {
    $nodeVersion = 'v24.22.1'
    $archive = Join-Path $env:TEMP 'node-win-x64.zip'
    $base = "https://nodejs.org/dist/$nodeVersion"
    Invoke-WebRequest "$base/node-$nodeVersion-win-x64.zip" -OutFile $archive
    $checksums = (Invoke-WebRequest "$base/SHASUMS256.txt").Content
    $expected = ($checksums -split "`n" | Where-Object { $_ -match "node-$nodeVersion-win-x64.zip$" }) -split '\s+' | Select-Object -First 1
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $expected) { throw 'Node SHA256 不匹配' }
    Expand-Archive -LiteralPath $archive -DestinationPath '.cache\tmp\node-extract' -Force
    New-Item -ItemType Directory -Force -Path '.tools\node' | Out-Null
    Copy-ToolDirectory ".cache\tmp\node-extract\node-$nodeVersion-win-x64" '.tools\node'
}
if (-not (Test-Path '.tools\pnpm\bin\pnpm.cjs')) {
    $metadata = Invoke-RestMethod 'https://registry.npmjs.org/pnpm/10.33.0'
    $archive = Join-Path $env:TEMP 'pnpm.tgz'
    Invoke-WebRequest $metadata.dist.tarball -OutFile $archive
    $algorithm = [Security.Cryptography.SHA512]::Create()
    try { $actual = 'sha512-' + [Convert]::ToBase64String($algorithm.ComputeHash([IO.File]::ReadAllBytes($archive))) }
    finally { $algorithm.Dispose() }
    if ($actual -ne $metadata.dist.integrity) { throw 'pnpm 完整性校验失败' }
    New-Item -ItemType Directory -Force -Path '.tools\pnpm' | Out-Null
    # Windows tar 在英文区域可能将绝对中文路径按 ANSI 转成问号；仅传 ASCII 相对路径。
    & tar -xzf '.cache\tmp\pnpm.tgz' -C '.tools\pnpm' --strip-components=1
    if ($LASTEXITCODE -ne 0) { throw 'pnpm 解压失败' }
}
if (-not (Test-Path '.tools\cargo\bin\rustup.exe')) {
    $existing = Join-Path $originalProfile '.cargo\bin'
    if (Test-Path (Join-Path $existing 'rustup.exe')) {
        Copy-ToolDirectory $existing '.tools\cargo\bin'
    } else {
        $installer = Join-Path $env:TEMP 'rustup-init.exe'
        Invoke-WebRequest 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $installer
        $expected = ((Invoke-WebRequest 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe.sha256').Content -split '\s+')[0]
        if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $expected) { throw 'Rustup SHA256 不匹配' }
        # Rustup 使用多调用二进制；仅复制为 rustup 及代理名称，完全不运行安装流程。
        New-Item -ItemType Directory -Force -Path '.tools\cargo\bin' | Out-Null
        Copy-Item -LiteralPath $installer -Destination '.tools\cargo\bin\rustup.exe'
        foreach ($proxy in @('cargo', 'rustc', 'rustdoc', 'rustfmt', 'cargo-fmt', 'cargo-clippy', 'clippy-driver', 'rust-analyzer')) {
            Copy-Item -LiteralPath '.tools\cargo\bin\rustup.exe' -Destination ".tools\cargo\bin\$proxy.exe"
        }
    }
}
if (-not (Test-Path '.tools\rustup\toolchains\1.96.0-x86_64-pc-windows-msvc')) {
    & rustup toolchain install 1.96.0 --profile minimal --component rustfmt --component clippy --component rust-analyzer --component rust-src --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw 'Rust 工具链安装失败' }
}
& rustup component add rust-analyzer rust-src --toolchain 1.96.0
if ($LASTEXITCODE -ne 0) { throw 'Rust Analyzer 安装失败' }
if (-not (Test-Path '.tools\msvc\bin\link.exe')) {
    Copy-ToolDirectory "$MsvcSource\bin\Hostx64\x64" '.tools\msvc\bin'
    Copy-ToolDirectory "$MsvcSource\include" '.tools\msvc\include'
    Copy-ToolDirectory "$MsvcSource\lib\x64" '.tools\msvc\lib'
}
if (-not (Test-Path '.tools\winsdk\lib\um\kernel32.lib')) {
    Copy-ToolDirectory "$SdkSource\Lib\$SdkVersion\um\x64" '.tools\winsdk\lib\um'
    Copy-ToolDirectory "$SdkSource\Lib\$SdkVersion\ucrt\x64" '.tools\winsdk\lib\ucrt'
    Copy-ToolDirectory "$SdkSource\Include\$SdkVersion" '.tools\winsdk\include'
    Copy-ToolDirectory "$SdkSource\bin\$SdkVersion\x64" '.tools\winsdk\bin'
}
& "$PSScriptRoot\pnpm.cmd" install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$PSScriptRoot\pnpm.cmd" run env:check
exit $LASTEXITCODE
