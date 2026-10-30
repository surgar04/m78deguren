# 只读 Windows 检测验收；不安装、不登录、不启动或终止任何第三方客户端。
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
$root=Join-Path (Split-Path -Parent $PSScriptRoot) ('.cache\verification\acceleration-native-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../src-tauri/src/services/acceleration/windows.ps1') -Raw -Encoding UTF8
$script=Join-Path $root 'acceleration.ps1'
[IO.File]::WriteAllText($script,$source,[Text.UTF8Encoding]::new($true))
$parseErrors=$null;$tokens=$null
$null=[Management.Automation.Language.Parser]::ParseFile($script,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count -gt 0){throw "Native script parse failed: $parseErrors"}
$powershell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$clock=[Diagnostics.Stopwatch]::StartNew()
$output=& $powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Operation acceleration-discover -ArgumentJson '[]'
if($LASTEXITCODE -ne 0){throw "Discovery failed: $output"}
$found=($output -join "`n")|ConvertFrom-Json
if($null -eq $found.clients -or $null -eq $found.warnings){throw 'Discovery arrays missing'}
$elapsed=$clock.ElapsedMilliseconds
$fake=Join-Path $root 'QuickFox.exe'
[IO.File]::WriteAllBytes($fake,[byte[]](0x4d,0x5a,0,0))
$arguments=ConvertTo-Json -InputObject @($fake) -Compress
$output=& $powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Operation acceleration-verify -ArgumentJson $arguments
if($LASTEXITCODE -eq 0 -or -not (($output -join "`n")|ConvertFrom-Json).failure){throw 'Unsigned fake client was accepted'}
$output=& $powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Operation acceleration-open -ArgumentJson $arguments
if($LASTEXITCODE -eq 0 -or -not (($output -join "`n")|ConvertFrom-Json).failure){throw 'D-drive guard did not reject third-party execution'}
$report=@{passed=$true;discoveryMs=$elapsed;verifiedInstallations=@($found.clients).Count;unsignedRejected=$true;developmentLaunchRejected=$true}
[IO.File]::WriteAllText((Join-Path $root 'result.json'),($report|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$report|ConvertTo-Json
Write-Output "Evidence: $root"
