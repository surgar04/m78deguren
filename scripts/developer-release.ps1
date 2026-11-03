param([ValidateSet('publish','verify')][string]$Action='verify',[ValidateRange(1,999999)][int]$DeveloperBuild=1)
$ErrorActionPreference='Stop'
$env:ZHENJING_BUILD_EDITION='developer'
$env:ZHENJING_DEVELOPER_BUILD=[string]$DeveloperBuild
. "$PSScriptRoot\env.ps1"
$script=if($Action -eq 'publish'){'publish-release.ts'}else{'verify-public-release.ts'}
& (Join-Path $projectRoot '.tools/node/node.exe') (Join-Path $PSScriptRoot $script)
exit $LASTEXITCODE
