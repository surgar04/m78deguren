$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([IO.Path]::GetPathRoot($projectRoot) -ne 'D:\') {
    throw '本项目只允许在 D 盘运行。'
}

# 仅改变当前进程及子进程，避免修改用户环境、注册表或 C 盘配置。
$env:ZHENJING_RESTRICT_WRITES_TO_D = '1'
$directories = @{
    TEMP = '.cache\tmp'
    TMP = '.cache\tmp'
    APPDATA = '.cache\profile\AppData\Roaming'
    LOCALAPPDATA = '.cache\profile\AppData\Local'
    USERPROFILE = '.cache\profile'
    XDG_CACHE_HOME = '.cache\xdg\cache'
    XDG_CONFIG_HOME = '.cache\xdg\config'
    XDG_DATA_HOME = '.cache\xdg\data'
    PNPM_HOME = '.tools\pnpm'
    npm_config_cache = '.cache\npm'
    npm_config_store_dir = '.cache\pnpm\store'
    npm_config_state_dir = '.cache\pnpm\state'
    npm_config_cache_dir = '.cache\pnpm\cache'
    npm_config_config_dir = '.cache\pnpm\config'
    COREPACK_HOME = '.cache\corepack'
    CARGO_HOME = '.tools\cargo'
    RUSTUP_HOME = '.tools\rustup'
    CARGO_TARGET_DIR = '.cache\cargo\target'
    TAURI_BUNDLER_TOOLS_DIR = '.tools\tauri-bundler'
    PLAYWRIGHT_BROWSERS_PATH = '.cache\playwright'
    ZHENJING_DATA_DIR = '.local\data'
}
foreach ($entry in $directories.GetEnumerator()) {
    $path = Join-Path $projectRoot $entry.Value
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    [Environment]::SetEnvironmentVariable($entry.Key, $path, 'Process')
}
$env:npm_config_userconfig = Join-Path $projectRoot '.npmrc'
$env:npm_config_globalconfig = Join-Path $projectRoot '.cache\npm\global.npmrc'
$env:COREPACK_ENABLE_AUTO_PIN = '0'
$env:RUSTUP_TOOLCHAIN = '1.96.0'
$env:DOTNET_CLI_HOME = Join-Path $projectRoot '.cache\dotnet'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_NOLOGO = 'true'
$env:NUGET_PACKAGES = Join-Path $projectRoot '.cache\nuget\packages'
$env:NUGET_HTTP_CACHE_PATH = Join-Path $projectRoot '.cache\nuget\http'
$env:DOTNET_BUNDLE_EXTRACT_BASE_DIR = Join-Path $projectRoot '.cache\dotnet\bundle'
$env:PSModuleAnalysisCachePath = Join-Path $projectRoot '.cache\powershell\ModuleAnalysisCache'
[IO.Directory]::CreateDirectory((Split-Path -Parent $env:PSModuleAnalysisCachePath)) | Out-Null
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = Join-Path $projectRoot '.tools\msvc\bin\link.exe'
$env:CC_x86_64_pc_windows_msvc = Join-Path $projectRoot '.tools\msvc\bin\cl.exe'
$env:CXX_x86_64_pc_windows_msvc = $env:CC_x86_64_pc_windows_msvc
$env:AR_x86_64_pc_windows_msvc = Join-Path $projectRoot '.tools\msvc\bin\lib.exe'
$libraryPaths = @('.tools\msvc\lib', '.tools\winsdk\lib\ucrt', '.tools\winsdk\lib\um') | ForEach-Object { Join-Path $projectRoot $_ }
$env:LIB = $libraryPaths -join ';'
$includePaths = @('.tools\msvc\include', '.tools\winsdk\include\ucrt', '.tools\winsdk\include\shared', '.tools\winsdk\include\um', '.tools\winsdk\include\winrt') | ForEach-Object { Join-Path $projectRoot $_ }
$env:INCLUDE = $includePaths -join ';'
$toolPaths = @('scripts', '.tools\node', '.tools\cargo\bin', '.tools\msvc\bin', '.tools\winsdk\bin') | ForEach-Object { Join-Path $projectRoot $_ }
$env:PATH = ($toolPaths -join ';') + ';' + $env:PATH
Set-Location -LiteralPath $projectRoot
