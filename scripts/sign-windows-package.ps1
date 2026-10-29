param([Parameter(Mandatory=$true)][Alias('Path')][string]$TargetPath)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
$full=[IO.Path]::GetFullPath($TargetPath)
if(-not $full.StartsWith($projectRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetPathRoot($full) -ine 'D:\' -or [IO.Path]::GetExtension($full) -notin @('.msi','.exe','.dll')){throw '签名目标越过工程或格式边界'}
for($parent=$full;$parent;$parent=[IO.Path]::GetDirectoryName($parent)){if((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw '签名路径含重解析点'}}
$pfx=Join-Path $projectRoot '.local\package-signing\publisher.pfx'
$password=[IO.File]::ReadAllText((Join-Path $projectRoot '.local\package-signing\password.secret'))
try{
    # 不输出命令行、口令或私钥；私密输入均来自 D 盘受 ACL 保护且被 Git 忽略的目录。
    & (Join-Path $projectRoot '.tools\winsdk\bin\signtool.exe') sign /fd SHA256 /f $pfx /p $password $full
    if($LASTEXITCODE -ne 0){throw 'Windows 包签名失败'}
    $signature=Get-AuthenticodeSignature -LiteralPath $full
    $publisher=Get-Content -LiteralPath (Join-Path $projectRoot 'dist\desktop\publisher.json') -Raw|ConvertFrom-Json
    if(-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -cne $publisher.thumbprint -or $signature.Status -eq 'HashMismatch'){throw '签名回读的证书或文件摘要不匹配'}
    Write-Output ('签名完成：'+[IO.Path]::GetFileName($full)+'；证书信任状态：'+$signature.Status)
}finally{$password=$null}
