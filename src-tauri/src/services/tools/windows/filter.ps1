# 滤镜是独立的恢复进程，主应用退出后仍负责恢复原始曲线。
function Assert-FilterTarget($target) {
    if([string]$target.id -notmatch '^[a-f0-9]{64}$' -or [string]$target.device -notmatch '^\\\\\.\\DISPLAY\d+$'){throw '滤镜显示器标识无效'}
    if([Zhenjing.Native]::Identity([string]$target.device) -ne [string]$target.identity -or (Get-StableId ([string]$target.identity)) -ne [string]$target.id){throw '显示器拓扑已变化，拒绝写入其他显示器'}
    if(@($target.ramp).Count -ne 768 -or @($target.ramp | Where-Object {[long]$_ -lt 0 -or [long]$_ -gt 65535}).Count){throw '滤镜曲线维度或数值无效'}
}
function Restore-FilterCurve($entry,$last,[bool]$force=$false) {
    Assert-FilterTarget $entry
    $current=[Zhenjing.Native]::Gamma([string]$entry.device)
    if(-not $force -and $null -ne $last -and (Get-Fingerprint @($current)) -ne $last){throw '曲线已由其他程序更改，保留其设置；原始曲线仍在 应用备份中'}
    [Zhenjing.Native]::SetGamma([string]$entry.device,[uint16[]]@($entry.ramp))
    if((Get-Fingerprint @([Zhenjing.Native]::Gamma([string]$entry.device))) -ne (Get-Fingerprint @($entry.ramp))){throw '原始 Gamma 曲线回读验证失败'}
}
function Invoke-FilterWorker {
    $root=[string]$arguments[0];if((-not (Test-LocalPath $root)) -or (Split-Path -Leaf $root) -notmatch '^filter-[a-f0-9-]{36}$'){throw '滤镜恢复目录无效'}
    $requestPath=Join-Path $root 'request.json';$requestGuard=[IO.File]::Open($requestPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $owner=$null;$matrix=$null;$backup=@{};$owned=@{};$last=@{};$failure='';$active=$null
    $snapshotPath=Join-Path $root 'snapshot.json'
    try {
        if((Get-FileHash -LiteralPath $requestPath -Algorithm SHA256).Hash -ne [string]$arguments[1]){throw '滤镜请求内容已变化'}
        $config=Get-Content -LiteralPath $requestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $owner=[Diagnostics.Process]::GetProcessById([int]$arguments[2]);Initialize-Native
        if(@($config.plans).Count -lt 1 -or @($config.plans).Count -gt 21){throw '滤镜计划数量无效'}
        $plans=@{};foreach($plan in $config.plans){if([double]$plan.saturation -lt 0 -or [double]$plan.saturation -gt 2){throw '滤镜饱和度无效'};$plans[[string]$plan.id]=$plan;foreach($target in $plan.targets){Assert-FilterTarget $target;if(-not $backup.ContainsKey([string]$target.id)){$backup[[string]$target.id]=@{id=$target.id;device=$target.device;identity=$target.identity;ramp=@([Zhenjing.Native]::Gamma([string]$target.device))}}}}
        if(@($config.plans | Where-Object {[Math]::Abs([double]$_.saturation-1.0) -gt 0.0001}).Count){$matrix=[Zhenjing.ColorMatrix]::new()}
        Write-AtomicJson (Join-Path $root 'backup.json') @{targets=@($backup.Values);matrix=$(if($matrix){@($matrix.Original)}else{$null})}
        $timer=[Diagnostics.Stopwatch]::StartNew();$preview=[bool]$config.preview;$iteration=0
        while(-not $owner.HasExited -and -not (Test-Path -LiteralPath (Join-Path $root 'stop.json'))){
            if($preview -and (Test-Path -LiteralPath (Join-Path $root 'keep.json'))){$decision=Get-Content -LiteralPath (Join-Path $root 'keep.json') -Raw -Encoding UTF8 | ConvertFrom-Json;if($decision.keep){$preview=$false}}
            if($preview -and $timer.Elapsed.TotalSeconds -ge 10){break}
            $wanted='base'
            if($config.autoGame){$wanted=$null;$processName=[Zhenjing.Native]::ForegroundProcess();$rule=@($config.rules | Where-Object {[string]$_.process -eq $processName}) | Select-Object -First 1;if($rule){$wanted=[string]$rule.preset}}
            if($wanted -ne $active){
                foreach($key in @($owned.Keys)){Restore-FilterCurve $backup[$key] $last[$key];$owned.Remove($key);$last.Remove($key)}
                if($matrix){$matrix.Restore()}
                if($null -ne $wanted){
                    $plan=$plans[$wanted];if(-not $plan){throw '自动规则引用了不存在的曲线计划'}
                    if($matrix){$matrix.Saturation([double]$plan.saturation)}
                    foreach($target in $plan.targets){Assert-FilterTarget $target;$key=[string]$target.id;$owned[$key]=$true;$last[$key]=$null;[Zhenjing.Native]::SetGamma([string]$target.device,[uint16[]]@($target.ramp));$last[$key]=Get-Fingerprint @([Zhenjing.Native]::Gamma([string]$target.device))}
                }
                $active=$wanted
            }
            # 其他色彩程序接管后主动退让，不进行持续重写争夺。
            if($iteration%4 -eq 0){foreach($key in @($owned.Keys)){Assert-FilterTarget $backup[$key];if((Get-Fingerprint @([Zhenjing.Native]::Gamma([string]$backup[$key].device))) -ne $last[$key]){throw '显示曲线已被其他程序接管，滤镜自动停止'}}}
            $remaining=if($preview){[Math]::Max(0,10-[int][Math]::Floor($timer.Elapsed.TotalSeconds))}else{0}
            Write-AtomicJson $snapshotPath @{phase=$(if($null -eq $active){'waiting'}else{'active'});message=$(if($null -eq $active){'等待匹配的前台游戏'}else{'滤镜已应用；退出或停用时恢复原始曲线'});activePreset=$active;previewRemaining=$remaining}
            $iteration++;Start-Sleep -Milliseconds 250
        }
    }catch{$failure=[string]$_}
    finally {
        $restoreErrors=@();foreach($key in @($owned.Keys)){try{Restore-FilterCurve $backup[$key] $last[$key]}catch{$restoreErrors+=([string]$_)}}
        if($matrix){try{$matrix.Dispose()}catch{$restoreErrors+=([string]$_)}}
        $message=if($restoreErrors.Count){($failure+'；'+($restoreErrors -join '；')).Trim('；')}elseif($failure){$failure+'；已恢复本次拥有的原始曲线'}else{'已恢复原始显示曲线'}
        Write-AtomicJson $snapshotPath @{phase=$(if($restoreErrors.Count -or $failure){'failed'}else{'restored'});message=$message;activePreset=$null;previewRemaining=0}
        if($owner){$owner.Dispose()};$requestGuard.Dispose()
    }
}
function Invoke-FilterRecovery {
    $root=[string]$arguments[0];if((-not (Test-LocalPath $root)) -or (Split-Path -Leaf $root) -notmatch '^filter-[a-f0-9-]{36}$'){throw '滤镜备份目录无效'}
    Initialize-Native;$saved=Get-Content -LiteralPath (Join-Path $root 'backup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $monitors=@((Get-DisplaySnapshot).monitors);$errors=@()
    foreach($target in $saved.targets){try{$connected=@($monitors | Where-Object {$_.id -eq $target.id}) | Select-Object -First 1;if(-not $connected){throw '原始显示器尚未重新连接'};$target.device=$connected.device;Restore-FilterCurve $target $null $true}catch{$errors+=[string]$_}}
    if($saved.matrix){try{[Zhenjing.ColorMatrix]::RestoreSnapshot([single[]]@($saved.matrix))}catch{$errors+=[string]$_}}
    if($errors.Count){throw ($errors -join '；')};Write-AtomicJson (Join-Path $root 'snapshot.json') @{phase='restored';message='已按用户确认恢复原始曲线及颜色矩阵';activePreset=$null;previewRemaining=0};Output-Json @{message='已按用户确认恢复原始曲线及颜色矩阵'}
}
