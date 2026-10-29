param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]')
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($Operation -ne 'migrate' -or $env:ZHENJING_RESTRICT_WRITES_TO_D -eq '1'){throw '当前模式不允许执行 MSI 迁移'}
# __STORAGE_POLICY__
$parameters=ConvertFrom-Json -InputObject $ArgumentJson
$plan=([string]$parameters[0])|ConvertFrom-Json
$null=[guid]::Parse([string]$plan.token);$null=[guid]::Parse([string]$plan.product)
$oldExe=Assert-LocalPath ([string]$plan.oldExe);$newExe=Assert-LocalPath ([string]$plan.newExe)
$oldData=Assert-LocalPath ([string]$plan.oldData);$newData=Assert-LocalPath ([string]$plan.newData)
$control=Assert-LocalPath ([string]$plan.control);$package=Assert-LocalPath ([string]$plan.package)
$oldApp=[IO.Path]::GetDirectoryName($oldExe);$newApp=[IO.Path]::GetDirectoryName($newExe)
if([IO.Path]::GetFileName($oldExe) -cne 'zhenjing.exe' -or [IO.Path]::GetFileName($newExe) -cne 'zhenjing.exe' -or $oldApp -ieq $newApp -or $oldData -ieq $newData){throw '迁移路径重叠或程序身份无效'}
if([IO.Path]::GetDirectoryName($newData) -cne [IO.Path]::GetDirectoryName($newApp) -or $control -cne (Join-Path ([IO.Path]::GetDirectoryName($newData)) '.xinjing-maintenance')){throw '迁移目标不在同一受控范围'}
if((Test-Path -LiteralPath $newApp) -and @(Get-ChildItem -LiteralPath $newApp -Force).Count){throw '目标安装目录非空，拒绝覆盖'}
if((Test-Path -LiteralPath $newData) -and @(Get-ChildItem -LiteralPath $newData -Force).Count){throw '目标档案目录非空，请先查看上次恢复记录'}
$owned=@('settings','tools','webview','logs','reports','profile','tmp','hardware','steam','home','onboarding')
if(@($plan.owned|Sort-Object) -join '|' -cne (@($owned|Sort-Object) -join '|')){throw '用户目录白名单无效'}
$sourceGuard=[IO.File]::Open($PSCommandPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
$packageGuard=[IO.File]::Open($package,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
if((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ine [string]$plan.sha256){throw '完整 MSI 哈希不匹配'}
$owner=[Diagnostics.Process]::GetProcessById([int]$plan.owner)
if($owner.MainModule.FileName -ine $oldExe){throw '迁移宿主身份不匹配'}
$receipt=Join-Path $control ($plan.token+'.migration.json');$manifestPath=Join-Path $control ($plan.token+'.data-files.json')
$recovery=Join-Path $control ($plan.token+'-恢复说明.txt')
$msi=Join-Path $env:SystemRoot 'System32/msiexec.exe'
$copied=[Collections.Generic.List[object]]::new();$uninstalled=$false;$newInstalled=$false;$healthy=$false;$newProcess=$null;$rootLock=$null
$markerBackup=Join-Path $control ($plan.token+'-original-marker.ini')
function Save-Receipt([string]$state,[string]$message){[IO.File]::WriteAllText($receipt,(@{state=$state;message=$message;plan=$plan;time=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))}
function Run-Msi([string]$mode,[string]$location,[string]$log){
    $targetProfile=if($location -ieq $newApp){$newData}else{$oldData}
    $arguments=if($mode -eq 'remove'){'/x '+[string]$plan.product+' /qn /norestart /l*v "'+$log+'"'}else{'/i "'+$package+'" INSTALLDIR="'+$location+'" PROFILEDIR="'+$targetProfile+'" /qn /norestart /l*v "'+$log+'"'}
    $process=Start-Process -FilePath $msi -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
    if($process.ExitCode -notin @(0,3010)){throw ('Windows Installer 失败：'+$process.ExitCode+'；日志：'+$log)}
}
function Launch-App([string]$exe,[string]$data,[bool]$health){
    # 恢复用户真实环境，不能将助手隔离的 TEMP/APPDATA 当成迁移后的 Windows 用户档案。
    foreach($key in @('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE')){[Environment]::SetEnvironmentVariable($key,[string]$plan.launchEnvironment.$key,'Process')}
    $env:ZHENJING_DATA_DIR=$data;$env:XINJING_DATA_DIR=$null
    $arguments='--data-dir "'+$data+'"';if($health){$arguments+=' --maintenance-ticket '+$plan.token}
    return Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory ([IO.Path]::GetDirectoryName($exe)) -WindowStyle Normal -PassThru
}
function Copy-Profile {
    $stack=[Collections.Generic.Stack[object]]::new()
    foreach($name in $owned){$from=Join-Path $oldData $name;if(Test-Path -LiteralPath $from){$stack.Push(@{from=$from;to=(Join-Path $newData $name)})}}
    while($stack.Count){
        $entry=$stack.Pop();$from=Assert-LocalPath $entry.from;$to=Assert-LocalPath $entry.to
        $item=Get-Item -LiteralPath $from -Force
        if($item.PSIsContainer){[IO.Directory]::CreateDirectory($to)|Out-Null;foreach($child in Get-ChildItem -LiteralPath $from -Force){$stack.Push(@{from=$child.FullName;to=(Join-Path $to $child.Name)})}}
        else{
            # 文件有后台关闭延迟时只有限重试；复制不完整绝不先卸载旧应用。
            $watch=[Diagnostics.Stopwatch]::StartNew()
            while($true){try{[IO.File]::Copy($from,$to,$false);break}catch{if($watch.Elapsed.TotalSeconds -gt 15){throw};Start-Sleep -Milliseconds 300}}
            $hash=(Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash
            if((Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash -cne $hash){throw '迁移文件校验失败'}
            $copied.Add(@{source=$from;target=$to;sha256=$hash})
            if($copied.Count -gt 100000){throw '档案文件过多，请先清理应用缓存后重试'}
        }
    }
    [IO.File]::WriteAllText($manifestPath,(ConvertTo-Json -InputObject @($copied.ToArray()) -Depth 5),[Text.UTF8Encoding]::new($false))
}
try{
    [IO.File]::Copy((Join-Path $oldApp 'zhenjing-install.ini'),$markerBackup,$false)
    Save-Receipt 'prepared' '尚未卸载或移动任何文件。'
    [IO.File]::WriteAllText($recovery,"臻境 MSI 迁移恢复说明`r`n原应用：$oldApp`r`n原数据：$oldData`r`n新应用：$newApp`r`n新数据：$newData`r`n完整安装包：$package`r`n失败时先查看本目录迁移记录和 MSI 日志。若自动恢复未完成，使用此完整 MSI 重新安装到原应用目录，再以 --data-dir 指定原数据目录启动。不要删除原数据或未核实的新数据。系统分区不会由此助手修改。",[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $control ($plan.token+'.migration-ready')),'ready')
    if(-not $owner.WaitForExit(120000)){throw '宿主未退出，没有开始迁移'}
    $lockPath=Assert-LocalPath ([string]$plan.oldLock)
    if([IO.Path]::GetDirectoryName($lockPath) -cne (Join-Path ([IO.Path]::GetDirectoryName($oldData)) '.xinjing-maintenance') -or [IO.Path]::GetFileName($lockPath) -notmatch '^data-[a-f0-9]{64}\.lock$'){throw '原档案锁范围无效'}
    $rootLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    Start-Sleep -Milliseconds 1000
    [IO.Directory]::CreateDirectory($newData)|Out-Null;Copy-Profile
    Save-Receipt 'profile-copied' '数据已复制并逐文件核对；原数据仍保留。'
    Run-Msi 'remove' $oldApp (Join-Path $control ($plan.token+'-remove.log'));$uninstalled=$true
    Run-Msi 'install' $newApp (Join-Path $control ($plan.token+'-install.log'));$newInstalled=$true
    if(-not (Test-Path -LiteralPath $newExe)){throw '新位置缺少主程序'}
    $progressFile=Join-Path $newData 'onboarding/progress.json';$progress=Get-Content -LiteralPath $progressFile -Raw|ConvertFrom-Json
    $progress.stage='hardware';$progress.completed=@(@($progress.completed)+'migration'|Select-Object -Unique)
    [IO.File]::WriteAllText($progressFile,($progress|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $newData 'onboarding/job.json'),(@{phase='complete';kind='migration';message='应用与档案已迁移到新位置。';restartRequired=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $newProcess=Launch-App $newExe $newData $true;$watch=[Diagnostics.Stopwatch]::StartNew()
    $ready=Join-Path $control ($plan.token+'.app-ready')
    while(-not (Test-Path -LiteralPath $ready)){
        if($newProcess.HasExited -or $watch.Elapsed.TotalSeconds -gt 90){throw '新位置启动健康检查未通过；原数据尚未清理'}
        Start-Sleep -Milliseconds 300
    }
    $healthy=$true
    $retained=0
    if($plan.cleanupSource){
        # 只删除复制清单中哈希仍相同的旧文件；任何新增或变化的内容都保留，不递归删除用户目录。
        foreach($file in $copied){try{$source=Assert-LocalPath ([string]$file.source);if(-not $source.StartsWith($oldData.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw '清理路径越过原档案'};if(Test-Path -LiteralPath $source){if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ceq $file.sha256){Remove-Item -LiteralPath $source -Force}else{$retained++}}}catch{$retained++}}
    }
    Save-Receipt 'complete' ('新位置启动已确认；旧目录变化或占用而保留的文件数：'+$retained+'。安装恢复包和日志留在此目录。')
}catch{
    $failure=$_.Exception.Message
    # 新实例通过健康检查后，不能因清理或日志失败回滚到已部分清理的旧档案。
    if($healthy){try{Save-Receipt 'complete-with-warnings' ('新位置已正常启动，旧目录清理或记录需检查：'+$failure)}catch{};return}
    if($newProcess -and -not $newProcess.HasExited){$newProcess.Kill();$newProcess.WaitForExit()}
    if($newInstalled){try{Run-Msi 'remove' $newApp (Join-Path $control ($plan.token+'-rollback-remove.log'))}catch{$failure+='；新位置卸载失败：'+$_.Exception.Message}}
    if($uninstalled){try{[IO.Directory]::CreateDirectory($oldApp)|Out-Null;[IO.File]::Copy($markerBackup,(Join-Path $oldApp 'zhenjing-install.ini'),$true);Run-Msi 'install' $oldApp (Join-Path $control ($plan.token+'-rollback-install.log'))}catch{$failure+='；原位置恢复安装失败：'+$_.Exception.Message}}
    Save-Receipt 'needs-review' $failure
    if($rootLock){$rootLock.Dispose();$rootLock=$null}
    if(Test-Path -LiteralPath $oldExe){try{$null=Launch-App $oldExe $oldData $false}catch{}}
}finally{if($rootLock){$rootLock.Dispose()};$packageGuard.Dispose();$sourceGuard.Dispose()}
