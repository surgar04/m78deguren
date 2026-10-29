param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($Operation -ne 'settings-media'){throw '未知媒体操作'}
$parameters=ConvertFrom-Json -InputObject $ArgumentJson
$owner=[Diagnostics.Process]::GetProcessById([int]$parameters[0])
function Out-Message($value){ConvertTo-Json -InputObject $value -Depth 8 -Compress|Write-Output;[Console]::Out.Flush()}
function Empty-Media([string]$errorText){return @{available=$false;title='';artist='';source='';status='stopped';error=$errorText}}
function Media-Text([string]$value){$clean=[regex]::Replace($value,'\p{Cc}','');return $clean.Substring(0,[Math]::Min(512,$clean.Length))}
$manager=$null;$initializationError=$null
try{
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $managerType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
    $propertiesType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
    $script:asTask=@([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Length -eq 1 -and $_.GetParameters().Length -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
    function Await-Result($pendingAction,[Type]$resultType){
        $task=$script:asTask.MakeGenericMethod($resultType).Invoke($null,@($pendingAction))
        if(-not $task.Wait(5000)){throw 'Windows 媒体接口响应超时'}
        return $task.GetAwaiter().GetResult()
    }
    $manager=Await-Result ($managerType::RequestAsync()) $managerType
}catch{$initializationError='当前 Windows 媒体接口不可用：'+[string]$_.Exception.Message}
function Snapshot-Media {
    if(-not $manager){return Empty-Media $initializationError}
    $session=$manager.GetCurrentSession()
    if(-not $session){return Empty-Media $null}
    try{
        $properties=Await-Result ($session.TryGetMediaPropertiesAsync()) $propertiesType
        $status=([string]$session.GetPlaybackInfo().PlaybackStatus).ToLowerInvariant()
        $position=$null;$duration=$null
        try{$timeline=$session.GetTimelineProperties();$length=($timeline.EndTime-$timeline.StartTime).TotalSeconds
            if($length -gt 0 -and $length -le 10000000){$duration=$length;$position=[Math]::Min([Math]::Max(($timeline.Position-$timeline.StartTime).TotalSeconds,0),$length)}}catch{}
        return @{available=$true;title=(Media-Text ([string]$properties.Title));artist=(Media-Text ([string]$properties.Artist));album=(Media-Text ([string]$properties.AlbumTitle));source=(Media-Text ([string]$session.SourceAppUserModelId));status=$status;error=$null;positionSeconds=$position;durationSeconds=$duration}
    }catch{return Empty-Media ([string]$_.Exception.Message)}
}
# stdin 仅接收三种固定动作；不生成媒体键输入，避免拦截后再注入同键造成反馈循环。
# Windows PowerShell 5 的同步 TextReader.ReadLineAsync 可能阻塞调用线程；用 CLR 线程池读取。
Add-Type -TypeDefinition 'public static class XinjingMediaInput { public static System.Threading.Tasks.Task<string> Next() { return System.Threading.Tasks.Task.Run(() => System.Console.ReadLine()); } }'
$read=[XinjingMediaInput]::Next();$next=[DateTime]::UtcNow
while(-not $owner.HasExited){
    if($read.IsCompleted){
        $line=$read.GetAwaiter().GetResult();if($null -eq $line){break}
        $command=$null
        try{
            $command=$line|ConvertFrom-Json;$null=[Guid]::Parse([string]$command.id)
            if(-not $manager){throw $initializationError}
            $session=$manager.GetCurrentSession();if(-not $session){throw '没有可控制的 Windows 媒体会话'}
            # Operation 是入口的 string 参数，不能复用：PowerShell 会把异步对象强制转成字符串。
            $mediaAsyncAction=switch([string]$command.action){'previous'{$session.TrySkipPreviousAsync()}'next'{$session.TrySkipNextAsync()}'play-pause'{$session.TryTogglePlayPauseAsync()}default{throw '不支持该媒体操作'}}
            if(-not (Await-Result $mediaAsyncAction ([bool]))){throw '播放器拒绝了本次媒体操作'}
            Out-Message @{type='ack';id=[string]$command.id;media=(Snapshot-Media);error=$null}
        }catch{Out-Message @{type='ack';id=$(if($command){[string]$command.id}else{''});media=(Empty-Media $null);error=[string]$_.Exception.Message}}
        $read=[XinjingMediaInput]::Next()
    }
    if([DateTime]::UtcNow -ge $next){Out-Message @{type='state';id='';media=(Snapshot-Media);error=$null};$next=[DateTime]::UtcNow.AddSeconds(2)}
    Start-Sleep -Milliseconds 100
}
