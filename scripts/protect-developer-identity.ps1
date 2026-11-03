$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env.ps1"
# 仅收紧工程忽略目录的 ACL；不添加证书信任，不修改系统目录或用户配置。
$directory=Join-Path $projectRoot '.local/developer-identity'
for($parent=$directory;$parent;$parent=[IO.Path]::GetDirectoryName($parent)){
    if((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '开发者密钥路径不能经过重解析点'}
}
[IO.Directory]::CreateDirectory($directory)|Out-Null
foreach($entry in @((Get-Item -LiteralPath $directory)) + @(Get-ChildItem -LiteralPath $directory -Force -Recurse)){
    if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '开发者密钥目录不能包含链接'}
}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl -LiteralPath $directory -AclObject $acl
