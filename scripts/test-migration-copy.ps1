# Exercise only the real copy function against fresh D-drive fixtures. No MSI or process operations.
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
# Get-FileHash is a module-exported function in Windows PowerShell 5.1.
# Load it before the isolated corruption test shadows that command name.
Import-Module (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -Force -ErrorAction Stop
$script:OriginalHashCommand=(Get-Command Get-FileHash -ErrorAction Stop).ScriptBlock
if(-not $script:OriginalHashCommand){throw 'Expected the Windows PowerShell Get-FileHash function'}
. ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/tools/windows/storage-policy.ps1'))))
$tokens=$null;$parseErrors=$null
$tree=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/onboarding/migration.ps1')),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ('Invalid migration script: '+($parseErrors|Out-String))}
$copyFunction=$tree.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Copy-Profile'},$true)
if(-not $copyFunction){throw 'Copy-Profile function missing'}
. ([ScriptBlock]::Create($copyFunction.Extent.Text))
$fixture=Join-Path $projectRoot ('.cache/verification/migration-copy-'+[guid]::NewGuid().ToString('N'))
$oldData=Join-Path $fixture 'source';$newData=Join-Path $fixture 'target';$owned=@('settings','home')
$manifestPath=Join-Path $fixture 'manifest.json';$copied=[Collections.Generic.List[object]]::new()
foreach($folder in @('settings','home','unrelated')){[IO.Directory]::CreateDirectory((Join-Path $oldData $folder))|Out-Null;[IO.File]::WriteAllText((Join-Path $oldData ($folder+'/data.json')),('{"folder":"'+$folder+'"}'))}
Copy-Profile
if($copied.Count -ne 2 -or (Test-Path -LiteralPath (Join-Path $newData 'unrelated'))){throw 'Copy must use the application directory allowlist'}
foreach($file in $copied){if(-not (Test-Path -LiteralPath $file.source) -or (Get-FileHash -LiteralPath $file.target -Algorithm SHA256).Hash -cne $file.sha256){throw 'Copy changed originals or skipped destination verification'}}
$newData=Join-Path $fixture 'corruption-target';$copied=[Collections.Generic.List[object]]::new()
function Get-FileHash {param($LiteralPath,$Algorithm) if($LiteralPath.StartsWith($newData,[StringComparison]::OrdinalIgnoreCase)){return [pscustomobject]@{Hash='corrupted'}};return & $script:OriginalHashCommand -LiteralPath $LiteralPath -Algorithm $Algorithm}
$rejected=$false;try{Copy-Profile}catch{$rejected=$true}
if(-not $rejected -or -not (Test-Path -LiteralPath (Join-Path $oldData 'settings/data.json'))){throw 'Corrupt copies must fail before originals can be removed'}
Write-Output 'Migration copy: allowlist, original retention, destination hashes and corruption refusal passed. No MSI executed.'
