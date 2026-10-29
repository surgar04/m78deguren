# Syntax and injected storage-policy checks only: no disk, WUA, registry or installer mutations.
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
$source=Join-Path $projectRoot 'src-tauri/src/services/onboarding/windows.ps1'
$tokens=$null;$parseErrors=$null
$tree=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($source,[Text.Encoding]::UTF8),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ('Invalid first-run script: '+($parseErrors|Out-String))}
$storageFunction=$tree.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Storage-Info'},$true)
if(-not $storageFunction){throw 'Storage-Info function missing'}
. ([ScriptBlock]::Create($storageFunction.Extent.Text))
$script:fixture=@{second=$false;occupied=$false;style='GPT';encrypted=$false;free=400GB}
function Get-CimInstance {param($ClassName,$Filter) $rows=@([pscustomobject]@{DeviceID=([IO.Path]::GetPathRoot($env:SystemRoot).Substring(0,2));VolumeName='System';Size=512GB;FreeSpace=$script:fixture.free});if($script:fixture.second){$rows+=[pscustomobject]@{DeviceID='E:';VolumeName='Data';Size=1TB;FreeSpace=500GB}};return $rows}
function Test-Path {param($LiteralPath) return $script:fixture.occupied}
function Get-Partition {param($DriveLetter) return [pscustomobject]@{DiskNumber=0;PartitionNumber=3;Size=512GB}}
function Get-Disk {param($Number) return [pscustomobject]@{PartitionStyle=$script:fixture.style;IsReadOnly=$false;IsOffline=$false}}
function Get-BitLockerVolume {param($MountPoint,$ErrorAction) return [pscustomobject]@{VolumeStatus=$(if($script:fixture.encrypted){'FullyEncrypted'}else{'FullyDecrypted'})}}
function Get-PartitionSupportedSize {param($DiskNumber,$PartitionNumber) return [pscustomobject]@{SizeMin=100GB}}
function Check($value,[string]$message){if(-not $value){throw $message}}
$result=Storage-Info;Check ($result.canSplit -and $result.maxNewGiB -eq 340) 'Incorrect OS capacity reservation'
$script:fixture.second=$true;Check (-not (Storage-Info).canSplit) 'Multiple volumes must not trigger a split';$script:fixture.second=$false
$script:fixture.occupied=$true;Check (-not (Storage-Info).canSplit) 'Occupied D letter must be rejected';$script:fixture.occupied=$false
$script:fixture.style='MBR';Check (-not (Storage-Info).canSplit) 'Unsupported disk style must be rejected';$script:fixture.style='GPT'
$script:fixture.encrypted=$true;Check (-not (Storage-Info).canSplit) 'Encrypted OS volume must be rejected';$script:fixture.encrypted=$false
$script:fixture.free=65GB;Check (-not (Storage-Info).canSplit) 'Insufficient free space must be rejected'
Write-Output 'First-run storage checks: 6 passed. No partition, driver or installation changes executed.'
