param([ValidateSet('debug','release')][string]$Profile='release')
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
# MSI 保留 Windows Installer 原生事务和登记，不再封装 EXE 引导。
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw|ConvertFrom-Json).version
$application=Join-Path $env:CARGO_TARGET_DIR ($Profile+'\zhenjing.exe')
if([Diagnostics.FileVersionInfo]::GetVersionInfo($application).ProductVersion -ne $version){throw '主程序版本与安装包不一致，拒绝发布'}
& (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\verify-release-dependencies.ts') $Profile
if($LASTEXITCODE -ne 0){throw '发布二进制运行依赖检查失败'}
& (Join-Path $projectRoot '.tools\node\node.exe') (Join-Path $projectRoot 'scripts\collect-installer.ts') $Profile
if($LASTEXITCODE -ne 0){throw '安装包封装失败'}
$target=Join-Path $projectRoot ('dist\desktop\zhenjing-'+$version+'-windows-x64.msi')
& "$PSScriptRoot\sign-windows-package.ps1" -Path $target
$readme=[IO.File]::ReadAllText((Join-Path $projectRoot 'docs\release-readme.md')).Replace('{{VERSION}}',$version)
[IO.File]::WriteAllText((Join-Path $projectRoot 'dist\desktop\INSTALL.md'),$readme,[Text.UTF8Encoding]::new($false))
