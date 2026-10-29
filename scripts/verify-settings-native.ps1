# 原生只读验收：解析桥接脚本、检测启动项/PawnIO、读取 WinRT 媒体会话；不执行安装、注册表写入或输入注入。
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
$directory=Join-Path $projectRoot '.cache\verification\settings-native'
[IO.Directory]::CreateDirectory($directory)|Out-Null
$source=Join-Path $projectRoot 'src-tauri\src\services\settings'
# 仅从语法树取出维护助手的目录函数，测试 D 盘隔离夹具；不运行宿主退出、EXE 替换或 Windows 修改。
$maintenanceText=[IO.File]::ReadAllText((Join-Path $source 'maintenance.ps1'))
$maintenanceText=$maintenanceText.Replace('# __STORAGE_POLICY__',[IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/tools/windows/storage-policy.ps1')) )
$maintenanceTokens=$null;$maintenanceErrors=$null
$maintenanceAst=[Management.Automation.Language.Parser]::ParseInput($maintenanceText,[ref]$maintenanceTokens,[ref]$maintenanceErrors)
foreach($function in $maintenanceAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
    if($function.Name -in @('Assert-LocalPath','Save-Json','Move-Owned','Copy-Owned')){Invoke-Expression $function.Extent.Text}
}
$fixture=Join-Path $directory ([Guid]::NewGuid().ToString())
$from=Join-Path $fixture 'data';$backup=Join-Path $fixture 'backup';$restored=Join-Path $fixture 'restored'
$owned=@('settings','tools','webview','logs','reports','profile','tmp');$moved=@()
[IO.Directory]::CreateDirectory((Join-Path $from 'settings'))|Out-Null
[IO.Directory]::CreateDirectory((Join-Path $from 'foreign'))|Out-Null
[IO.Directory]::CreateDirectory($backup)|Out-Null
[IO.Directory]::CreateDirectory($restored)|Out-Null
[IO.File]::WriteAllText((Join-Path $from 'settings/config.json'),'real-fixture')
[IO.File]::WriteAllText((Join-Path $from 'foreign/personal.txt'),'preserved')
Move-Owned $from $backup
if(-not (Test-Path -LiteralPath (Join-Path $from 'foreign/personal.txt'))){throw '维护函数越过所属目录'}
Copy-Owned $backup $restored
if([IO.File]::ReadAllText((Join-Path $restored 'settings/config.json')) -cne 'real-fixture'){throw '恢复副本内容不一致'}
if(-not (Test-Path -LiteralPath (Join-Path $backup 'settings/config.json'))){throw '恢复不应移动原备份'}
$rejected=$false
try{$null=Assert-LocalPath 'C:\Windows'}catch{$rejected=$true}
if(-not $rejected){throw '维护函数错误接受 C 盘'}
$syntax=@()
foreach($script in Get-ChildItem -LiteralPath $source -Filter '*.ps1'){
    $tokens=$null;$errors=$null
    $null=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($script.FullName),[ref]$tokens,[ref]$errors)
    if($errors.Count){throw ($script.Name+': '+($errors.Message -join '; '))}
    $syntax+=,$script.Name
}
function Invoke-Read([string]$operation,[string]$json){
    $path=Join-Path $directory 'native.ps1'
    [IO.File]::WriteAllText($path,([IO.File]::ReadAllText((Join-Path $source 'native.ps1')).Replace('# __STORAGE_POLICY__',[IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/tools/windows/storage-policy.ps1')))),[Text.UTF8Encoding]::new($true))
    $json=ConvertTo-Json -InputObject @($json) -Compress
    $safeJson=$json.Replace("'","''");$readCommand="& '$path' -Operation '$operation' -ArgumentJson '$safeJson'"
    $readEncoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($readCommand))
    $value=& powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $readEncoded
    if($LASTEXITCODE -ne 0){throw ('只读检测失败：'+$operation)}
    return (($value -join "`n")|ConvertFrom-Json)
}
$pawn=Invoke-Read 'pawn-status' 'null'
$start=Invoke-Read 'autostart-status' ((@{exe=(Join-Path $projectRoot '.cache\cargo\target\release\zhenjing.exe');dataRoot=(Join-Path $projectRoot '.local\data')}|ConvertTo-Json -Compress))
$mediaPath=Join-Path $directory 'media.ps1'
[IO.File]::WriteAllText($mediaPath,[IO.File]::ReadAllText((Join-Path $source 'media.ps1')),[Text.UTF8Encoding]::new($true))
$argumentJson=ConvertTo-Json -InputObject @([string]$PID) -Compress
$command="& '$mediaPath' -Operation 'settings-media' -ArgumentJson '$argumentJson'"
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$info=[Diagnostics.ProcessStartInfo]::new('powershell',('-NoProfile -ExecutionPolicy Bypass -EncodedCommand '+$encoded))
$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
$process=[Diagnostics.Process]::Start($info)
try{
    $line=$process.StandardOutput.ReadLineAsync()
    if(-not $line.Wait(20000)){throw 'WinRT 媒体只读检测超时'}
    $media=$line.Result|ConvertFrom-Json
    if($media.type -ne 'state'){throw '媒体检测未返回实际状态'}
    if($media.media.error){throw ('媒体接口初始化失败：'+$media.media.error)}
    $process.StandardInput.Close()
    if(-not $process.WaitForExit(5000)){$process.Kill()}
    $result=@{syntax=$syntax;pawn=$pawn;autostart=$start;media=$media.media;maintenanceFixturePassed=$true;mutationsExecuted=$false}
    $json=ConvertTo-Json -InputObject $result -Depth 10
    [IO.File]::WriteAllText((Join-Path $directory 'result.json'),$json,[Text.UTF8Encoding]::new($false))
    Write-Output $json
}finally{if(-not $process.HasExited){$process.Kill()};$process.Dispose()}
