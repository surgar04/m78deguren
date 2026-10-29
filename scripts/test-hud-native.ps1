$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
# Pure core tests only. No driver, ETW session, network or system writes.
& (Join-Path $projectRoot '.tools\dotnet\dotnet.exe') run --project (Join-Path $projectRoot 'native\hud-tests\HudTests.csproj') --configuration Release
if($LASTEXITCODE -ne 0){throw 'HUD native core tests failed'}
