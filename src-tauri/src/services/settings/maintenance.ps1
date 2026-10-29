param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]')
$ErrorActionPreference='Stop'
if($Operation -ne 'settings-maintenance'){throw '未知维护操作'}
$parameters=ConvertFrom-Json -InputObject $ArgumentJson;$plan=[string]$parameters[0]|ConvertFrom-Json
$null=[Guid]::Parse([string]$plan.ticket)
# __STORAGE_POLICY__
$data=Assert-LocalPath ([string]$plan.dataRoot);$control=Assert-LocalPath ([string]$plan.control);$exe=Assert-LocalPath ([string]$plan.exe)
if($data.TrimEnd('\').Length -lt 4 -or [IO.Path]::GetDirectoryName($data) -cne [IO.Path]::GetDirectoryName($control)){throw '维护目录不在数据目录的同级受限范围'}
$sourceGuard=[IO.File]::Open($PSCommandPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
$owner=[Diagnostics.Process]::GetProcessById([int]$plan.owner)
$owned=@('settings','tools','webview','logs','reports','profile','tmp','hardware','steam','home','onboarding')
$backup=Assert-LocalPath (Join-Path $control ('backup-'+$plan.ticket));$moved=@();$newProcess=$null;$archived=$false
$lockPath=Assert-LocalPath ([string]$plan.lockFile);$rootLock=$null
if([IO.Path]::GetDirectoryName($lockPath) -cne $control -or [IO.Path]::GetFileName($lockPath) -notmatch '^data-[a-f0-9]{64}\.lock$'){throw '数据独占锁范围无效'}
$receipt=Join-Path $control ($plan.ticket+'.receipt.json')
function Save-Json([string]$path,$value){[IO.File]::WriteAllText((Assert-LocalPath $path),(ConvertTo-Json -InputObject $value -Depth 10),[Text.UTF8Encoding]::new($false))}
function Move-Owned([string]$from,[string]$to){
    foreach($name in $owned){
        $source=Assert-LocalPath (Join-Path $from $name);$target=Assert-LocalPath (Join-Path $to $name)
        if(Test-Path -LiteralPath $source){
            if(Test-Path -LiteralPath $target){throw '备份目标已存在，未覆盖'}
            $watch=[Diagnostics.Stopwatch]::StartNew()
            while($true){try{[IO.Directory]::Move($source,$target);break}catch{if($watch.Elapsed.TotalSeconds -ge 20){throw};Start-Sleep -Milliseconds 250}}
            $script:moved+=,$name
        }
    }
}
function Copy-Owned([string]$from,[string]$to){
    foreach($name in $owned){
        $source=Assert-LocalPath (Join-Path $from $name);if(-not (Test-Path -LiteralPath $source)){continue}
        $stack=[Collections.Generic.Stack[object]]::new();$stack.Push(@{source=$source;target=(Join-Path $to $name)})
        while($stack.Count){
            $entry=$stack.Pop();$sourcePath=Assert-LocalPath $entry.source;$targetPath=Assert-LocalPath $entry.target
            $item=Get-Item -LiteralPath $sourcePath -Force
            if($item.PSIsContainer){[IO.Directory]::CreateDirectory($targetPath)|Out-Null;foreach($child in Get-ChildItem -LiteralPath $sourcePath -Force){$stack.Push(@{source=$child.FullName;target=(Join-Path $targetPath $child.Name)})}}
            else{[IO.File]::Copy($sourcePath,$targetPath,$false)}
        }
    }
}
function Launch-App([bool]$health){
    $arguments='--data-dir "'+$data+'"'
    if($health){$arguments+=' --maintenance-ticket '+$plan.ticket}
    $env:ZHENJING_DATA_DIR=$data
    # 助手的缓存隔离不应成为重启后主应用和快捷启动程序的新用户档案。
    $saved=@{};$keys=@('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE')
    try{
        foreach($name in $keys){
            $saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
            $value=$plan.launchEnvironment.$name
            if($null -ne $value){
                if($env:ZHENJING_RESTRICT_WRITES_TO_D -eq '1'){$null=Assert-LocalPath ([string]$value)}
                [Environment]::SetEnvironmentVariable($name,[string]$value,'Process')
            }else{[Environment]::SetEnvironmentVariable($name,$null,'Process')}
        }
        return Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory ([IO.Path]::GetDirectoryName($exe)) -WindowStyle Hidden -PassThru
    }finally{foreach($name in $keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}}
}
try{
    if($plan.kind -notin @('reset','restore','update')){throw '不支持的维护类型'}
    if($plan.kind -eq 'restore'){
        $null=[Guid]::Parse([string]$plan.restoreId)
        $restore=Assert-LocalPath (Join-Path $control ('backup-'+$plan.restoreId))
        $record=[IO.File]::ReadAllText((Join-Path $restore 'manifest.json'))|ConvertFrom-Json
        if($record.state -ne 'completed' -or $record.id -cne $plan.restoreId -or $record.path -cne $restore -or $record.dataRoot -cne $data){throw '恢复来源未完整提交或身份不匹配'}
    }
    # 主进程只有见到助手已锁定源码且已核对范围，才会退出。
    [IO.File]::WriteAllText((Join-Path $control ($plan.ticket+'.helper-ready')),'ready')
    if(-not $owner.WaitForExit(120000)){throw '宿主没有按预期退出，未执行维护'}
    $rootLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    Start-Sleep -Milliseconds 800
    if($plan.kind -in @('reset','restore')){
        [IO.Directory]::CreateDirectory($backup)|Out-Null
        Move-Owned $data $backup
        $archived=$true
        Save-Json (Join-Path $backup 'manifest.json') @{id=[string]$plan.ticket;createdAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();path=$backup;dataRoot=$data;state='completed';message='维护前的数据备份，仅包含臻境所属目录'}
        if($plan.kind -eq 'restore'){Copy-Owned $restore $data}
    }else{
        $package=Assert-LocalPath ([string]$plan.source)
        if((Get-Item -LiteralPath $package).Length -ne [long]$plan.bytes -or (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ine [string]$plan.sha256){throw '更新包在重启前发生变化，未替换程序'}
        $oldExe=Assert-LocalPath ($exe+'.before-'+$plan.ticket)
        # 0.6.0 起由 Windows Installer 负责事务升级，不能将 MSI 当成主 EXE 复制。
        $installDirectory=Assert-LocalPath ([IO.Path]::GetDirectoryName($exe))
        $marker=Join-Path $installDirectory 'zhenjing-install.ini'
        if(-not (Test-Path -LiteralPath $marker) -or -not ([IO.File]::ReadAllText($marker) -match '(?m)^Format=msi\s*$')){throw '当前不是 MSI 安装。请先卸载旧 EXE 安装版并保留用户数据，再手动安装 MSI；不会覆盖开发目录'}
        if([IO.Path]::GetExtension($package) -ine '.msi'){throw '新版本仅接受 MSI 更新包'}
        [IO.File]::Copy($exe,$oldExe,$false)
        $installerGuard=[IO.File]::Open($package,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try{
            # MSI 参数必须逐项正确引用；日志仍在应用控制目录，不交由系统默认临时路径。
            $msiLog=Assert-LocalPath (Join-Path $control ($plan.ticket+'.msi.log'))
            $msiexec=Join-Path $env:SystemRoot 'System32/msiexec.exe'
            $arguments='/i "'+$package+'" /norestart INSTALLDIR="'+$installDirectory+'" /L*v "'+$msiLog+'"'
            $installer=Start-Process -FilePath $msiexec -ArgumentList $arguments -WindowStyle Normal -PassThru
            $installer.WaitForExit()
            if($installer.ExitCode -notin @(0,3010)){throw ('MSI 被取消或安装失败（'+$installer.ExitCode+'），安装事务已回滚')}
        }finally{$installerGuard.Dispose()}
        if(-not (Test-Path -LiteralPath $exe) -or [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion -ne [string]$plan.version){throw '安装后的主程序版本不匹配，需从已验证的 MSI 修复安装'}
    }
    $rootLock.Dispose();$rootLock=$null
    $newProcess=Launch-App $true
    $ready=Join-Path $control ($plan.ticket+'.app-ready');$watch=[Diagnostics.Stopwatch]::StartNew()
    while($watch.Elapsed.TotalSeconds -lt 60){
        if(Test-Path -LiteralPath $ready){break}
        if($newProcess.HasExited){throw '新进程提前退出，执行恢复'}
        Start-Sleep -Milliseconds 250
    }
    if(-not (Test-Path -LiteralPath $ready)){throw '新进程未通过界面就绪检查，执行恢复'}
    Save-Json $receipt @{state='completed';message='维护完成，应用已重新启动';backup=$backup;kind=[string]$plan.kind}
}catch{
    $message=[string]$_.Exception.Message
    # 只关闭本助手创建的进程；从不按名称杀掉用户的其他应用。
    if($newProcess -and -not $newProcess.HasExited){$newProcess.Kill();$newProcess.WaitForExit()}
    try{
        if($owner.HasExited){
            if(-not $rootLock){$rootLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)}
            # MSI 的登记、文件及快捷方式必须保持同一事务；禁止只换回旧 EXE 破坏产品一致性。
            # 失败安装由 MSI 回滚；若安装成功但健康检查失败，保留备份和 MSI 日志供修复。
            if($plan.kind -ne 'update' -and $moved.Count){
                # 把未通过健康检查的新数据另行保留，再恢复本次操作前的目录。
                $failed=Assert-LocalPath (Join-Path $control ('failed-'+$plan.ticket));[IO.Directory]::CreateDirectory($failed)|Out-Null
                $rollbackTargets=if($archived){$owned}else{$moved}
                foreach($name in $rollbackTargets){$current=Assert-LocalPath (Join-Path $data $name);if(Test-Path -LiteralPath $current){[IO.Directory]::Move($current,(Assert-LocalPath (Join-Path $failed $name)))}}
                foreach($name in $moved){$current=Assert-LocalPath (Join-Path $data $name);$prior=Assert-LocalPath (Join-Path $backup $name);if(Test-Path -LiteralPath $prior){[IO.Directory]::Move($prior,$current)}}
                if(Test-Path -LiteralPath (Join-Path $backup 'manifest.json')){Save-Json (Join-Path $backup 'manifest.json') @{id=[string]$plan.ticket;createdAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();path=$backup;dataRoot=$data;state='rolled-back';message='维护失败，数据已放回原处'}}
            }
            $rootLock.Dispose();$rootLock=$null
            $null=Launch-App $false
        }
    }catch{$message+='；恢复步骤失败：'+[string]$_.Exception.Message}
    Save-Json $receipt @{state='failed';message=$message;backup=$backup;kind=[string]$plan.kind}
}finally{if($rootLock){$rootLock.Dispose()};$sourceGuard.Dispose()}
