param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]')
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
# __STORAGE_POLICY__
if($Operation -eq 'game-configs'){
    $parameters=ConvertFrom-Json -InputObject $ArgumentJson
    if($parameters.Count -gt 128){throw '配置探测数量超限'}
    $rows=[Collections.Generic.List[object]]::new()
    foreach($path in $parameters){
        try{
            $path=[string]$path
            if($path -notmatch '^[a-zA-Z]:[\\/]' -or [IO.Path]::GetFileName($path) -notin @('Arknights.exe','Endfield.exe')){continue}
            $file=Join-Path ([IO.Path]::GetDirectoryName($path)) 'config.ini'
            if(-not [IO.File]::Exists($file) -or [IO.FileInfo]::new($file).Length -gt 262144){continue}
            $linked=$false;for($ancestor=[IO.Path]::GetDirectoryName($file);$ancestor;$ancestor=[IO.Path]::GetDirectoryName($ancestor)){if(([IO.File]::GetAttributes($ancestor) -band [IO.FileAttributes]::ReparsePoint) -ne 0){$linked=$true;break}}
            if($linked -or ([IO.File]::GetAttributes($file) -band [IO.FileAttributes]::ReparsePoint) -ne 0){continue}
            $bytes=[IO.File]::ReadAllBytes($file);$plain=$null
            try{$plain=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)}catch{}
            if(-not $plain -or $plain -notmatch '(?m)^\s*(region|appcode)\s*='){
                # 鹰角公开安装元数据的 AES-CBC 格式；仅解码 config.ini，不读取或改写账号文件。
                # 格式依据：https://github.com/Small-Ku/griffr/blob/main/crates/griffr-hypergryph-api/src/crypto.rs
                $aes=[Security.Cryptography.Aes]::Create()
                try{
                    $aes.Key=[byte[]](0xC0,0xF3,0x0E,0x1C,0xE7,0x63,0xBB,0xC2,0x1C,0xC3,0x55,0xA3,0x43,0x03,0xAC,0x50,0x39,0x94,0x44,0xBF,0xF6,0x8C,0x4A,0x22,0xAF,0x39,0x8C,0x0A,0x16,0x6E,0xE1,0x43)
                    $aes.IV=[byte[]](0x33,0x46,0x78,0x61,0x19,0x27,0x50,0x64,0x95,0x01,0x93,0x72,0x64,0x60,0x84,0)
                    $aes.Mode='CBC';$aes.Padding='PKCS7';$decoder=$aes.CreateDecryptor()
                    try{$plain=[Text.UTF8Encoding]::new($false,$true).GetString($decoder.TransformFinalBlock($bytes,0,$bytes.Length))}finally{$decoder.Dispose()}
                }finally{$aes.Dispose()}
            }
            $fields=@{};foreach($line in $plain -split '[\r\n]+'){if($line -match '^\s*([a-z_]+)\s*=\s*(.*?)\s*$'){$fields[$Matches[1]]=$Matches[2]}}
            $region=switch([string]$fields.region){'cn'{'cn'}'global'{'global'}'sg'{'global'}'en'{'global'}'os'{'global'}'jp'{'jp'}'kr'{'kr'}'tw'{'tw'}default{'unknown'}}
            $family=if([IO.Path]::GetFileName($path) -ieq 'Endfield.exe'){'endfield'}else{'arknights'}
            $rows.Add(@{path=$path;region=$region;family=$family;source='鹰角安装 config.ini 的 region 字段';steamAppId=$null})
        }catch{}
    }
    ConvertTo-Json -InputObject @($rows.ToArray()) -Depth 5 -Compress;exit
}
if($Operation -ne 'games-hints'){throw '未知本地游戏探测操作'}
# 只读注册表/快捷方式/启动器元数据；不递归个人文档，不读取登录令牌和账号存档。
$roots=[Collections.Generic.List[object]]::new();$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$warnings=[Collections.Generic.List[string]]::new()
# 助手的 USERPROFILE/APPDATA 被隔离到应用目录，不能用它们定位玩家的启动器。
# 从 Windows 当前身份及只读 Known Folder 注册记录解析真实目录；不创建这些目录。
$profilePath=$null;$profileKey=$null;$shellFolders=$null
try{
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $profileKey=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\'+$sid)
 if($profileKey){$profilePath=[Environment]::ExpandEnvironmentVariables([string]$profileKey.GetValue('ProfileImagePath'))}
 $shellFolders=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders')
}catch{$warnings.Add('当前用户目录记录不可读取')}finally{if($profileKey){$profileKey.Dispose()}}
function Get-PlayerFolder([string]$key,[string]$fallback){
 $value=if($shellFolders){[string]$shellFolders.GetValue($key,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{''}
 if($value -and $profilePath){$value=$value.Replace('%USERPROFILE%',$profilePath).Replace('%userprofile%',$profilePath)}
 if($value){$value=[Environment]::ExpandEnvironmentVariables($value)}elseif($profilePath){$value=Join-Path $profilePath $fallback}
 if($value -match '^[a-zA-Z]:[\\/]'){return $value};return $null
}
function Add-Hint([string]$path,[string]$source,[string]$family='',[string]$region='unknown'){
    if([string]::IsNullOrWhiteSpace($path) -or $path.Length -gt 4096){return}
    $path=[Environment]::ExpandEnvironmentVariables($path.Trim().Trim('"'))
    if($path -notmatch '^[a-zA-Z]:[\\/]'){return}
    if(-not $seen.Add($path)){if($region -ne 'unknown'){foreach($existing in $roots){if($existing.path -ieq $path -and $existing.region -eq 'unknown'){$existing.region=$region;$existing.family=$family;$existing.source=$source;break}}};return}
    if($roots.Count -lt 2048){$roots.Add(@{path=$path;source=$source;family=$family;region=$region;steamAppId=$null})}
}
$match='(?i)Genshin|YuanShen|原神|崩坏|崩壊|붕괴|Honkai|Star.?Rail|HoYoPlay|miHoYo|Cognosphere|Hypergryph|GRYPH|Yostar|Arknights|明日方舟|终末地|Endfield|三角洲|Delta.?Force|Wuthering|鸣潮|Kuro|KRLauncher|WeGame|异环|\bNTE\b|Neverness|Hotta'
foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
 foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
  $base=$null;$uninstall=$null
  try{
   $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
   $uninstall=$base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
   if($uninstall){foreach($name in $uninstall.GetSubKeyNames()){$key=$null;try{
    $key=$uninstall.OpenSubKey($name);if(-not $key){continue};$display=[string]$key.GetValue('DisplayName')
    if(($name+' '+$display) -notmatch $match){continue}
    foreach($field in @('InstallLocation','InstallPath','Path')){Add-Hint ([string]$key.GetValue($field)) ('安装记录：'+$display)}
    $icon=[string]$key.GetValue('DisplayIcon');if($icon){$icon=$icon -replace ',\s*-?\d+$','';Add-Hint $icon ('安装图标：'+$display)}
   }catch{}finally{if($key){$key.Dispose()}}}}
   # HoYoPlay 按单个 game_biz 保存的路径，明确区分共用 StarRail/BH3.exe 的区服。
   foreach($root in @('Software\miHoYo\HYP\1_1','Software\miHoYo\HYP\1_0','Software\Cognosphere\HYP\1_0')){
    $hyp=$base.OpenSubKey($root);if(-not $hyp){continue}
    try{foreach($biz in $hyp.GetSubKeyNames()){
      if($biz -notmatch '^(hk4e|hkrpg|bh3)_(cn|global|os|overseas|jp|kr|asia|tw)$'){continue}
      $family=switch($Matches[1]){'hk4e'{'genshin'}'hkrpg'{'starrail'}'bh3'{'honkai3'}}
      $region=switch($Matches[2]){'cn'{'cn'}'jp'{'jp'}'kr'{'kr'}'asia'{'tw'}'tw'{'tw'}default{'global'}};$game=$hyp.OpenSubKey($biz)
      try{Add-Hint ([string]$game.GetValue('GameInstallPath')) ('HoYoPlay 注册表 '+$biz) $family $region}finally{$game.Dispose()}
    }}finally{$hyp.Dispose()}
   }
  }catch{$warnings.Add('部分安装记录不可读取：'+[string]$hive+'/'+[string]$view)}finally{if($uninstall){$uninstall.Dispose()};if($base){$base.Dispose()}}
 }
}
$drives=@([IO.DriveInfo]::GetDrives()|Where-Object {$_.IsReady -and $_.DriveType -eq 'Fixed'}|ForEach-Object {$_.RootDirectory.FullName})
foreach($drive in $drives){foreach($name in @('Games','Game','Program Files','Program Files (x86)','miHoYo','HoYoPlay','HoYoPlay/games','Genshin Impact','Star Rail','Honkai Impact 3rd','Hypergryph Launcher','GRYPHLINK','YostarGames','WeGameApps','WeGame','Wuthering Waves','KuroGame','Neverness To Everness','异环','鸣潮','明日方舟','终末地','三角洲行动')){Add-Hint (Join-Path $drive $name) '常见游戏目录'}}
$appdata=Get-PlayerFolder 'AppData' 'AppData/Roaming';$local=Get-PlayerFolder 'Local AppData' 'AppData/Local'
foreach($name in @('KRLauncher','KuroGame','HoYoPlay','Hypergryph','GRYPHLINK','YostarGames','NTEGlobal','NTE')){if($appdata){Add-Hint (Join-Path $appdata $name) '用户启动器目录'};if($local){Add-Hint (Join-Path $local $name) '用户启动器目录'}}
if($local){Add-Hint (Join-Path $local 'Programs') '当前用户程序目录'}
# 快捷方式由 Windows 自己解析，只取目标路径；不重放来源不明的 Arguments。
$shell=$null
try{
 $shell=New-Object -ComObject WScript.Shell
 foreach($folder in @((Get-PlayerFolder 'Desktop' 'Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'),(Get-PlayerFolder 'Start Menu' 'AppData/Roaming/Microsoft/Windows/Start Menu'),[Environment]::GetFolderPath('CommonStartMenu'))){
  if(-not $folder -or -not [IO.Directory]::Exists($folder)){continue}
  $queue=[Collections.Generic.Queue[object]]::new();$queue.Enqueue(@{path=$folder;depth=0});$count=0
  while($queue.Count -gt 0 -and $count -lt 3000){$row=$queue.Dequeue();foreach($item in Get-ChildItem -LiteralPath $row.path -Force -ErrorAction SilentlyContinue){$count++;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){continue};if($item.PSIsContainer -and $row.depth -lt 4){$queue.Enqueue(@{path=$item.FullName;depth=$row.depth+1})}elseif($item.Extension -ieq '.lnk' -and $item.BaseName -match $match){$shortcut=$shell.CreateShortcut($item.FullName);try{Add-Hint ([string]$shortcut.TargetPath) ('快捷方式：'+$item.BaseName)}finally{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut)}}}}
 }
}catch{$warnings.Add('部分快捷方式不可读取')}finally{if($shell){$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}}
if($shellFolders){$shellFolders.Dispose()}
try{foreach($process in Get-CimInstance Win32_Process -Filter "Name='YuanShen.exe' OR Name='GenshinImpact.exe' OR Name='BH3.exe' OR Name='StarRail.exe' OR Name='Arknights.exe' OR Name='Endfield.exe' OR Name='DeltaForceClient-Win64-Shipping.exe' OR Name='HTGame.exe' OR Name='Client-Win64-Shipping.exe'"){Add-Hint ([string]$process.ExecutablePath) '当前运行的游戏进程'}}catch{$warnings.Add('部分运行进程不可读取')}
# Epic 只读取公开安装清单中的目录；不访问登录配置。
$common=[Environment]::GetFolderPath('CommonApplicationData','DoNotVerify')
$manifest=if($common){Join-Path $common 'Epic/EpicGamesLauncher/Data/Manifests'}else{$null}
if($manifest -and [IO.Directory]::Exists($manifest)){foreach($file in Get-ChildItem -LiteralPath $manifest -Filter '*.item' -File -ErrorAction SilentlyContinue|Select-Object -First 512){if($file.Length -gt 262144){continue};try{$item=[IO.File]::ReadAllText($file.FullName)|ConvertFrom-Json;if([string]$item.DisplayName -match $match){Add-Hint ([string]$item.InstallLocation) ('Epic 安装清单：'+[string]$item.DisplayName)}}catch{}}}
@{roots=@($roots.ToArray());drives=$drives;warnings=@($warnings.ToArray())}|ConvertTo-Json -Depth 6 -Compress
