# Only pure geometry, input ABI and isolated metadata fixtures. No keyboard hook, SendInput or game launch.
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
function Check($condition,[string]$message){if(-not $condition){throw $message}}
Add-Type -Path (Join-Path $projectRoot 'src-tauri/resources/windows-bridge/Zhenjing.Windows.dll')
$type=[Zhenjing.Home.Native].Assembly.GetType('Zhenjing.Home.WheelController',$true)
$direction=$type.GetMethod('Direction',[Reflection.BindingFlags]'Public,Static')
for($i=0;$i -lt 8;$i++){$angle=($i*45-90)*[math]::PI/180;$x=[math]::Cos($angle)*70;$y=[math]::Sin($angle)*70;$actual=$direction.Invoke($null,@($x,$y,100.0));Check ($actual -eq $i) ('Incorrect direction '+$i)}
Check ($direction.Invoke($null,@(0.0,0.0,100.0)) -eq -1) 'Center must cancel'
Check ($direction.Invoke($null,@(35.0,0.0,100.0)) -eq -1) 'Entire visible center must cancel'
Check ($direction.Invoke($null,@(1000.0,0.0,100.0)) -eq -1) 'Outside circle must cancel'
$trigger=$type.GetMethod('TriggerCode',[Reflection.BindingFlags]'Public,Static')
Check ($trigger.Invoke($null,@('G')) -eq 71) 'Default trigger must be G'
Check ($trigger.Invoke($null,@('R')) -eq 82) 'Configured letter must use its own virtual key'
foreach($key in @('Tab','Ctrl+G','g','')){Check ($trigger.Invoke($null,@($key)) -eq 0) 'Non-letter trigger accepted'}
# 直接调用纯钩子入口验证 Tab 透传；不安装系统钩子、不注入键盘事件。
$keyboard=$type.GetMethod('Keyboard',[Reflection.BindingFlags]'Public,Static')
$eventData=[Runtime.InteropServices.Marshal]::AllocHGlobal(24)
try{
 for($offset=0;$offset -lt 24;$offset+=4){[Runtime.InteropServices.Marshal]::WriteInt32($eventData,$offset,0)}
 [Runtime.InteropServices.Marshal]::WriteInt32($eventData,9)
 foreach($message in @(0x100,0x101)){Check (-not $keyboard.Invoke($null,@(0,[IntPtr]$message,$eventData))) 'Tab must always pass through'}
}finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($eventData)}
$inputType=$type.GetNestedType('Input',[Reflection.BindingFlags]::NonPublic)
Check ([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($inputType)) -eq 40) 'Incorrect x64 INPUT ABI'
# Windows metadata parser runs as a child with temporary files exclusively on D.
$fixture=Join-Path $projectRoot ('.cache/verification/launcher-metadata-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture)|Out-Null
$source=[IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/other_games/windows.ps1'))
$tokens=$null;$parseErrors=$null;$null=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
Check ($parseErrors.Count -eq 0) 'Invalid game-discovery PowerShell source'
$scriptPath=Join-Path $fixture 'reader.ps1';$testSource=$source.Replace('        }catch{}','        }catch{[Console]::Error.WriteLine($_.Exception.Message)}');[IO.File]::WriteAllText($scriptPath,$testSource,[Text.UTF8Encoding]::new($true))
$paths=@()
foreach($region in @('cn','sg')){
 $folder=Join-Path $fixture $region;[IO.Directory]::CreateDirectory($folder)|Out-Null
 $path=Join-Path $folder 'Endfield.exe';[IO.File]::WriteAllText($path,'metadata fixture; never execute');$paths+=$path
 $aes=[Security.Cryptography.Aes]::Create()
 try{
  $aes.Key=[byte[]](0xC0,0xF3,0x0E,0x1C,0xE7,0x63,0xBB,0xC2,0x1C,0xC3,0x55,0xA3,0x43,0x03,0xAC,0x50,0x39,0x94,0x44,0xBF,0xF6,0x8C,0x4A,0x22,0xAF,0x39,0x8C,0x0A,0x16,0x6E,0xE1,0x43)
  $aes.IV=[byte[]](0x33,0x46,0x78,0x61,0x19,0x27,0x50,0x64,0x95,0x01,0x93,0x72,0x64,0x60,0x84,0)
  $bytes=[Text.Encoding]::UTF8.GetBytes("[game]`nregion=$region`nversion=1.0.0`n")
  $encoder=$aes.CreateEncryptor();try{[IO.File]::WriteAllBytes((Join-Path $folder 'config.ini'),$encoder.TransformFinalBlock($bytes,0,$bytes.Length))}finally{$encoder.Dispose()}
 }finally{$aes.Dispose()}
}
$json=ConvertTo-Json -InputObject $paths -Compress
$info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$escaped=$json.Replace("'","''");$escapedScript=$scriptPath.Replace("'","''")
$command="& '$escapedScript' -Operation game-configs -ArgumentJson '$escaped'"
$info.Arguments='-NoProfile -ExecutionPolicy Bypass -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WindowStyle='Hidden';$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.StandardOutputEncoding=[Text.Encoding]::UTF8
$process=[Diagnostics.Process]::Start($info);$text=$process.StandardOutput.ReadToEnd();$details=$process.StandardError.ReadToEnd();$process.WaitForExit()
Check ($process.ExitCode -eq 0) ('Metadata reader failed: '+$details)
$decoded=$text|ConvertFrom-Json;$rows=@($decoded);Check ($rows.Count -eq 2) ('Both metadata fixtures must be detected: '+$details)
Check (@($rows|Where-Object {$_.region -eq 'cn'}).Count -eq 1) 'CN metadata was not recognized'
Check (@($rows|Where-Object {$_.region -eq 'global'}).Count -eq 1) 'SG global metadata was not recognized'
# 再以助手相同的隔离用户环境读取真实安装线索，防止 Known Folder 空值导致整次扫描失败。
$command="& '$escapedScript' -Operation games-hints"
$info.Arguments='-NoProfile -ExecutionPolicy Bypass -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
foreach($name in @('APPDATA','LOCALAPPDATA','USERPROFILE')){$folder=Join-Path $fixture $name;[IO.Directory]::CreateDirectory($folder)|Out-Null;$info.EnvironmentVariables[$name]=$folder}
$process=[Diagnostics.Process]::Start($info);$text=$process.StandardOutput.ReadToEnd();$details=$process.StandardError.ReadToEnd();$process.WaitForExit()
Check ($process.ExitCode -eq 0) ('Isolated discovery failed: '+$details)
$hints=$text|ConvertFrom-Json;Check (@($hints.drives).Count -gt 0) 'Discovery must return actual fixed disks'
Check (@($hints.roots|Where-Object {$_.source -eq '用户启动器目录' -and $_.path.StartsWith($fixture,[StringComparison]::OrdinalIgnoreCase)}).Count -eq 0) 'Discovery used isolated process folders instead of player folders'
Write-Output 'Wheel: 8 directions, center/outside cancellation, letter trigger, Tab pass-through and x64 INPUT ABI passed. Encrypted CN/global metadata fixtures passed. No hook or game executed.'
