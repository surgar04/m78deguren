$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
$target=Join-Path $projectRoot '.local\github-release-token.txt'
if(-not (Test-Path -LiteralPath $target)){return}
for($current=$target;$current;$current=[IO.Path]::GetDirectoryName($current)){if((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Release token path must not contain reparse points'}}
$acl=[Security.AccessControl.FileSecurity]::new()
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
foreach($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','Allow'))}
Set-Acl -LiteralPath $target -AclObject $acl
# 不读取、不输出令牌内容；仅收紧本项目忽略目录内这一文件的 ACL。
