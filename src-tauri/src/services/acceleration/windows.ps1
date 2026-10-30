param([string]$Operation,[string]$ArgumentJson='[]')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ProgressPreference='SilentlyContinue'
trap { @{failure=([string]$_.Exception.Message)} | ConvertTo-Json -Compress; exit 1 }
# Windows PowerShell 5.1 保留 JSON 数组本身；不要再套 @()，否则双参数会变成嵌套数组。
$values=ConvertFrom-Json -InputObject $ArgumentJson
# 这里只读安装记录与签名。厂商账号、节点配置和凭据始终由官方客户端管理。
function Read-Client([string]$candidate) {
    if($candidate -notmatch '^[a-zA-Z]:[\\/]' -or $candidate.Substring(2).Contains(':')){throw '请选择本地磁盘上的 QuickFox.exe'}
    $file=Get-Item -LiteralPath $candidate -ErrorAction Stop
    if($file.PSIsContainer -or $file.Name -ine 'QuickFox.exe'){throw '请选择已安装客户端的 QuickFox.exe，不能选择安装器'}
    $parent=$file.FullName
    while($parent){
        if(((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '客户端路径不能包含目录联接或符号链接'}
        $parent=[IO.Path]::GetDirectoryName($parent)
    }
    $meta=$file.VersionInfo
    if($meta.ProductName -ine 'QuickFox' -or $meta.FileDescription -match '(?i)setup|install|update|uninstall'){throw '这不是已安装的 QuickFox 客户端'}
    # 此组织来自官网 Windows 安装器的有效 EV 签名；不信任仅有相同文件名的程序。
    # 按组织及有效证书链验证，允许厂商正常续期证书，不导入任何证书信任。
    $signature=Get-AuthenticodeSignature -LiteralPath $file.FullName
    if($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
       $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=厦门科臻赛科技有限公司(,|$)'){
        throw 'QuickFox 签名无法验证或发布者不匹配，请从官网重新安装后重试'
    }
    return @{path=$file.FullName;version=[string]$meta.ProductVersion;publisher='厦门科臻赛科技有限公司';sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
if($Operation -eq 'acceleration-verify'){
    Read-Client ([string]$values[0]) | ConvertTo-Json -Compress; exit
}
if($Operation -eq 'acceleration-open'){
    # 开发验收不启动会自行写入系统盘的第三方软件；发布版由用户点击后正常打开。
    if($env:ZHENJING_RESTRICT_WRITES_TO_D -eq '1'){throw 'D 盘保护已开启：开发验收不启动第三方加速器，请在日常安装版中操作'}
    # 持有不可写/不可删除的句柄直到启动请求提交，缩小验证后被替换的竞态窗口。
    $guard=[IO.File]::Open([string]$values[0],[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try{
        $client=Read-Client ([string]$values[0])
        if($client.sha256 -cne [string]$values[1]){throw '客户端在确认后发生变化，请重新检测'}
        $info=[Diagnostics.ProcessStartInfo]::new()
        $info.FileName=$client.path; $info.WorkingDirectory=[IO.Path]::GetDirectoryName($client.path)
        $info.UseShellExecute=$true
        $process=[Diagnostics.Process]::Start($info)
        if($null -ne $process){$process.Dispose()}
    }finally{$guard.Dispose()}
    'null'; exit
}
if($Operation -ne 'acceleration-discover'){throw '未知加速准备操作'}
$paths=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
if($values.Count -gt 0 -and $values[0]){$null=$paths.Add([string]$values[0])}
# 同时读取每用户和全机、32/64 位安装记录；不依赖开发机 USERPROFILE。
foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
 foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
  $base=$null;$key=$null
  try{
   $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
   $key=$base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',$false)
   if($null -eq $key){continue}
   foreach($name in $key.GetSubKeyNames()){
    $entry=$null
    try{
     $entry=$key.OpenSubKey($name,$false)
     if([string]$entry.GetValue('DisplayName') -notmatch '(?i)quickfox'){continue}
     $location=[string]$entry.GetValue('InstallLocation')
     if($location){$null=$paths.Add([IO.Path]::Combine($location,'QuickFox.exe'))}
     $icon=[string]$entry.GetValue('DisplayIcon')
     if($icon -match '^"([^"]+\.exe)"(?:,\s*-?\d+)?$'){$null=$paths.Add($Matches[1])}
     elseif($icon -match '^([^"<>|]+\.exe)(?:,\s*-?\d+)?$'){$null=$paths.Add($Matches[1])}
     $uninstall=[string]$entry.GetValue('UninstallString')
     # 仅提取卸载器所在目录，不执行卸载字符串，也不保留其中参数。
     $uninstaller=$null
     if($uninstall -match '^"([^"]+\.exe)"'){$uninstaller=$Matches[1]}
     elseif($uninstall -match '^([^"<>|]+\.exe)(?:\s|$)'){$uninstaller=$Matches[1]}
     if($uninstaller){$null=$paths.Add([IO.Path]::Combine([IO.Path]::GetDirectoryName($uninstaller),'QuickFox.exe'))}
    }catch{}finally{if($null -ne $entry){$entry.Dispose()}}
   }
  }catch{}finally{if($null -ne $key){$key.Dispose()};if($null -ne $base){$base.Dispose()}}
 }
}
foreach($folder in @([Environment]::GetFolderPath('ProgramFiles'),[Environment]::GetFolderPath('ProgramFilesX86'))){
 if($folder){foreach($part in @('QuickFox\QuickFox.exe','QuickFox加速器\QuickFox.exe')){$null=$paths.Add([IO.Path]::Combine($folder,$part))}}
}
$shell=$null
try{
 $shell=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders',$false)
 $local=[string]$shell.GetValue('Local AppData')
 if($local){foreach($part in @('Programs\QuickFox\QuickFox.exe','QuickFox\QuickFox.exe')){$null=$paths.Add([IO.Path]::Combine($local,$part))}}
}catch{}finally{if($null -ne $shell){$shell.Dispose()}}
foreach($process in @(Get-Process -Name QuickFox -ErrorAction SilentlyContinue)){
 try{if($process.Path){$null=$paths.Add($process.Path)}}catch{}finally{$process.Dispose()}
}
$clients=[Collections.Generic.List[object]]::new();$warnings=[Collections.Generic.List[string]]::new()
foreach($candidate in $paths){
 if($clients.Count -ge 8){break}
 if(Test-Path -LiteralPath $candidate -PathType Leaf){
  try{$clients.Add((Read-Client $candidate))}catch{$warnings.Add('某个 QuickFox 安装位置未通过身份验证；请手动定位已安装的官方客户端。')}
 }
}
@{clients=@($clients.ToArray());warnings=@($warnings.ToArray()|Select-Object -Unique)}|ConvertTo-Json -Depth 5 -Compress
