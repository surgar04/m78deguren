$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
$private=Join-Path $projectRoot '.local\package-signing'
[IO.Directory]::CreateDirectory($private)|Out-Null
# 私钥目录仅当前 Windows 用户和 SYSTEM 可访问；不导入系统/用户证书存储。
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
foreach($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
}
Set-Acl -LiteralPath $private -AclObject $acl
$pfx=Join-Path $private 'publisher.pfx';$secret=Join-Path $private 'password.secret'
if(-not (Test-Path -LiteralPath $pfx)){
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create();$random=New-Object byte[] 32;$rng.GetBytes($random);$rng.Dispose()
    $password=[Convert]::ToBase64String($random)
    $rsa=[Security.Cryptography.RSACng]::new(3072)
    try{
        $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Sur方糖',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,$true))
        $usage=[Security.Cryptography.OidCollection]::new();$null=$usage.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usage,$true))
        $certificate=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddYears(5))
        try{
            [IO.File]::WriteAllText($secret,$password,[Text.UTF8Encoding]::new($false))
            [IO.File]::WriteAllBytes($pfx,$certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$password))
        }finally{$certificate.Dispose()}
    }finally{$rsa.Dispose()}
}
if(-not (Test-Path -LiteralPath $secret)){throw '签名口令缺失，拒绝重新生成证书以免破坏已有用户的升级信任'}
$password=[IO.File]::ReadAllText($secret)
$certificate=[Security.Cryptography.X509Certificates.X509Certificate2]::new($pfx,$password,[Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
try{
    if($certificate.Subject -cne 'CN=Sur方糖' -or -not $certificate.HasPrivateKey -or $certificate.NotAfter -lt [DateTime]::Now.AddDays(90)){throw '签名证书主体、私钥或有效期不符合发布条件，请执行受控证书轮换'}
    if(@($certificate.Extensions | Where-Object {$_.Oid.Value -eq '2.5.29.19' -and $_.CertificateAuthority}).Count){throw '禁止使用 CA 证书签名和分发信任'}
    $directory=Join-Path $projectRoot 'dist\desktop';[IO.Directory]::CreateDirectory($directory)|Out-Null
    $cer=$certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $sha=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($sha.ComputeHash($cer))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    $metadata=@{subject=$certificate.Subject;thumbprint=$certificate.Thumbprint;sha256=$digest;notAfter=$certificate.NotAfter.ToUniversalTime().ToString('o');selfSigned=$true;certificateAuthority=$false}
    [IO.File]::WriteAllText((Join-Path $directory 'publisher.json'),($metadata|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Write-Output ('已准备自签名叶子证书；未写入信任存储。公钥 SHA256：'+$digest)
}finally{$certificate.Dispose();$password=$null}
