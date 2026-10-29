param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
trap { @{failure=[string]$_.Exception.Message}|ConvertTo-Json -Compress|Write-Output; exit 1 }
# __STORAGE_POLICY__
$parameters=ConvertFrom-Json -InputObject $ArgumentJson
function Storage-Info {
    $system=[IO.Path]::GetPathRoot($env:SystemRoot).Substring(0,1)
    $volumes=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object {$_.Size -gt 0} | ForEach-Object {@{letter=([string]$_.DeviceID).Substring(0,1);name=[string]$_.VolumeName;totalBytes=[uint64]$_.Size;freeBytes=[uint64]$_.FreeSpace}})
    $volume=$volumes|Where-Object {$_.letter -eq $system}|Select-Object -First 1
    $reason='';$max=0;$allowed=$false
    if($volumes.Count -ne 1){$reason='已存在独立数据卷，无需自动分区。'}
    elseif(Test-Path 'D:\'){$reason='D 盘符已被占用，不会修改已有分区。'}
    else{
        try{
            $part=Get-Partition -DriveLetter $system
            $disk=Get-Disk -Number $part.DiskNumber
            if($disk.PartitionStyle -ne 'GPT' -or $disk.IsReadOnly -or $disk.IsOffline){throw '只支持在线、可写的基本 GPT 磁盘。'}
            $bitlocker=Get-BitLockerVolume -MountPoint ($system+':') -ErrorAction Stop
            if([string]$bitlocker.VolumeStatus -ne 'FullyDecrypted'){throw '系统卷启用了 BitLocker/设备加密；请先自行备份恢复密钥并完成解密。臻境不会关闭保护。'}
            $size=Get-PartitionSupportedSize -DiskNumber $part.DiskNumber -PartitionNumber $part.PartitionNumber
            $minimum=[math]::Max([double]$size.SizeMin,[math]::Max(128GB,([double]$volume.totalBytes-[double]$volume.freeBytes+60GB)))
            $max=[math]::Floor(([double]$part.Size-$minimum)/1GB)
            if($max -lt 32){throw '可收缩空间不足；需要保留至少 128 GiB 系统卷和 60 GiB 可用空间，新卷至少 32 GiB。'}
            $allowed=$true
        }catch{$reason=$_.Exception.Message}
    }
    @{systemDrive=$system;volumes=$volumes;onlySystemVolume=($volumes.Count -eq 1);canSplit=$allowed;maxNewGiB=[uint64][math]::Max(0,$max);minNewGiB=32;systemSizeGiB=[uint64][math]::Floor([double]$volume.totalBytes/1GB);reason=$reason}
}
function Driver-Updates {
    # Windows Update 按真实 PnP 硬件匹配驱动，覆盖 NVIDIA/AMD/Intel 和 OEM 机型。
    # 只查询 Display 类；不把所有驱动、可选应用或品牌新闻称为“最新显卡驱动”。
    $session=New-Object -ComObject Microsoft.Update.Session
    $session.ClientApplicationID='Zhenjing first-run'
    $search=$session.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver' and IsHidden=0")
    $items=@()
    for($i=0;$i -lt $search.Updates.Count;$i++){
        $update=$search.Updates.Item($i)
        if([string]$update.DriverClass -ne 'Display'){continue}
        $items+=@{id=[string]$update.Identity.UpdateID;revision=[int]$update.Identity.RevisionNumber;title=[string]$update.Title;manufacturer=[string]$update.DriverManufacturer;model=[string]$update.DriverModel;date=$update.DriverVerDate.ToUniversalTime().ToString('o');downloaded=[bool]$update.IsDownloaded}
    }
    return @($items|Select-Object -First 64)
}
function Invoke-Elevated([string]$childAction,[object[]]$payload,[string]$folder){
    if($childAction -notin @('storage-admin','partition-write') -or -not (Test-LocalPath $folder)){throw '管理员操作范围无效'}
    function Quote-Literal([string]$value){return "'"+$value.Replace("'","''")+"'"}
    $resultFile=Join-Path $folder ('storage-result-'+[guid]::NewGuid().ToString('N')+'.json')
    $json=ConvertTo-Json -InputObject $payload -Depth 10 -Compress
    $command='$env:TEMP='+(Quote-Literal $folder)+';$env:TMP='+(Quote-Literal $folder)+';$env:PSModuleAnalysisCachePath='+(Quote-Literal (Join-Path $folder 'ModuleAnalysisCache'))+';& '+(Quote-Literal $PSCommandPath)+' -Operation '+$childAction+' -ArgumentJson '+(Quote-Literal $json)+' | Out-File -LiteralPath '+(Quote-Literal $resultFile)+' -Encoding utf8'
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $process=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -Verb RunAs -WindowStyle Hidden -PassThru -Wait
    if(-not (Test-Path -LiteralPath $resultFile)){throw '未取得管理员操作结果，请检查磁盘管理；不会自动重试。'}
    $result=Get-Content -LiteralPath $resultFile -Raw|ConvertFrom-Json
    if($process.ExitCode -ne 0 -or $result.failure){throw ([string]$result.failure)}
    return $result
}
switch($Operation){
    'migration-target' {
        $letter=[string]$parameters[0]
        if($letter -notmatch '^[A-Z]$' -or $letter -ieq ([IO.Path]::GetPathRoot($env:SystemRoot).Substring(0,1))){throw '请选择非系统盘'}
        $volume=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='"+$letter+":'")
        $required=[uint64]$parameters[1]
        if($required -lt 2GB -or $volume.DriveType -ne 3 -or $volume.FileSystem -ne 'NTFS' -or $volume.FreeSpace -lt $required){throw ('迁移需要 NTFS 固定磁盘，可用空间至少为档案大小加 2 GiB，当前要求：'+[math]::Ceiling($required/1GB)+' GiB')}
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
        $base=Assert-LocalPath (Join-Path ($letter+':\') ('Zhenjing\'+$sid.Value))
        if((Test-Path -LiteralPath $base) -and @(Get-ChildItem -LiteralPath $base -Force).Count -gt 0 -and -not (Test-Path -LiteralPath (Join-Path $base '.zhenjing-owner.json'))){throw '迁移目录包含未识别文件，不会覆盖'}
        [IO.Directory]::CreateDirectory($base)|Out-Null
        $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
        foreach($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
        Set-Acl -LiteralPath $base -AclObject $acl
        [IO.File]::WriteAllText((Join-Path $base '.zhenjing-owner.json'),(@{appId='dev.zhenjing.desktop';sid=$sid.Value}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
        foreach($name in @('Application','Data')){$target=Join-Path $base $name;if((Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Force).Count -gt 0){throw ('目标 '+$target+' 非空。请先检查 .xinjing-maintenance 中的上次恢复记录，保留文件后再重试。')}}
        @{path=$base}|ConvertTo-Json -Compress
    }
    'msi-info' {
        $path=Assert-LocalPath ([string]$parameters[0]);$engine=New-Object -ComObject WindowsInstaller.Installer
        $database=$engine.OpenDatabase($path,0)
        function Msi-Property([string]$name){
            if($name -notin @('ProductCode','ProductVersion','ProductName','Manufacturer','UpgradeCode')){throw 'MSI 属性不在白名单'}
            $view=$database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property``='$name'");$null=$view.Execute();$record=$view.Fetch()
            try{if($record){return [string]$record.StringData(1)};return ''}finally{if($record){$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($record)};$null=$view.Close();$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($view)}
        }
        try{@{product=(Msi-Property 'ProductCode');version=(Msi-Property 'ProductVersion');name=(Msi-Property 'ProductName');manufacturer=(Msi-Property 'Manufacturer');upgrade=(Msi-Property 'UpgradeCode')}|ConvertTo-Json -Compress}finally{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($database);$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($engine)}
    }
    'storage-elevate' { Invoke-Elevated 'storage-admin' @() ([string]$parameters[0]) | ConvertTo-Json -Depth 12 -Compress }
    'storage-admin' {
        $info=Storage-Info;$diskInfo=$null
        if($info.canSplit){
            $part=Get-Partition -DriveLetter $info.systemDrive;$disk=Get-Disk -Number $part.DiskNumber
            $diskInfo=@{number=[uint32]$disk.Number;partition=[uint32]$part.PartitionNumber;uniqueId=([string]$disk.UniqueId).Trim();offset=[uint64]$part.Offset;beforeBytes=[uint64]$part.Size}
        }
        @{public=$info;disk=$diskInfo}|ConvertTo-Json -Depth 12 -Compress
    }
    'partition-apply' { Invoke-Elevated 'partition-write' @([string]$parameters[0]) ([string]$parameters[1]) | ConvertTo-Json -Depth 12 -Compress }
    'partition-write' {
        if($env:ZHENJING_RESTRICT_WRITES_TO_D -eq '1'){throw '开发验收禁止真实磁盘修改'}
        $plan=[string]$parameters[0]|ConvertFrom-Json;$null=[guid]::Parse([string]$plan.token)
        $info=Storage-Info
        if(-not $info.canSplit -or $info.systemDrive -cne [string]$plan.systemDrive -or [uint64]$plan.newGiB -lt 32 -or [uint64]$plan.newGiB -gt $info.maxNewGiB){throw ('安全预检未通过：'+$info.reason)}
        $part=Get-Partition -DriveLetter $info.systemDrive;$disk=Get-Disk -Number $part.DiskNumber
        if(([string]$disk.UniqueId).Trim() -cne [string]$plan.disk.uniqueId -or $disk.Number -ne $plan.disk.number -or $part.PartitionNumber -ne $plan.disk.partition -or [uint64]$part.Size -ne [uint64]$plan.disk.beforeBytes -or [uint64]$part.Offset -ne [uint64]$plan.disk.offset){throw '磁盘或分区身份已变化，请重新预检。'}
        $expectedAfter=[uint64]([math]::Floor(([double]$part.Size-([double]$plan.newGiB*1GB))/1MB)*1MB)
        if($expectedAfter -lt 128GB -or $expectedAfter -ne [uint64]$plan.afterBytes){throw '收缩容量校验不通过'}
        $volume=Get-Volume -DriveLetter $info.systemDrive
        if($volume.HealthStatus -ne 'Healthy' -or $volume.FileSystem -ne 'NTFS' -or ([string]$part.GptType).Trim('{','}') -ine 'EBD0A0A2-B9E5-4433-87C0-68B6B72699C7'){throw '仅支持健康的基本 GPT NTFS 数据分区'}
        $battery=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
        if($battery.Count -gt 0){Add-Type -AssemblyName System.Windows.Forms;if([System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus -ne 'Online'){throw '请连接外部电源后再执行分区。'}}
        $backup=Assert-LocalPath ([string]$plan.backupPath)
        if(Test-Path -LiteralPath $backup){throw '分区记录已存在，不能重放计划'}
        $layout=@(Get-Partition -DiskNumber $disk.Number|Select-Object DiskNumber,PartitionNumber,DriveLetter,Offset,Size,GptType)
        [IO.File]::WriteAllText($backup,(@{plan=$plan;layout=$layout;state='prepared';isFileBackup=$false}|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
        $shrunk=$false;$created=$null
        try{
            Resize-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -Size $expectedAfter -ErrorAction Stop;$shrunk=$true
            # 指定刚释放的偏移，不使用其他未分配区域；从不删除或重用已有分区。
            $created=New-Partition -DiskNumber $disk.Number -Offset ([uint64]$part.Offset+$expectedAfter) -Size ([uint64]$plan.newGiB*1GB) -DriveLetter D -ErrorAction Stop
            $null=Format-Volume -Partition $created -FileSystem NTFS -NewFileSystemLabel 'Games' -Confirm:$false -ErrorAction Stop
            [IO.File]::WriteAllText($backup,(@{plan=$plan;layout=$layout;state='complete';newPartition=$created.PartitionNumber;isFileBackup=$false}|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
            @{ok=$true;drive='D'}|ConvertTo-Json -Compress
        }catch{
            $failure=$_.Exception.Message;$recovery='未自动删除分区。请打开磁盘管理检查新卷；完成的新卷只能先备份文件再手动合并。'
            # 只有还没创建新分区时才尝试扩回原大小；一旦创建过分区，绝不自动删除它。
            if($shrunk -and -not $created){try{Resize-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -Size ([uint64]$plan.disk.beforeBytes) -ErrorAction Stop;$recovery='新分区未创建，系统卷已扩回原大小。'}catch{$recovery='系统卷收缩后恢复未完成，请在磁盘管理中检查未分配空间；不要格式化原系统分区。'}}
            [IO.File]::WriteAllText($backup,(@{plan=$plan;layout=$layout;state='needs-review';message=$failure;recovery=$recovery;isFileBackup=$false}|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
            throw ($failure+'；'+$recovery)
        }
    }
    'gpu-info' {
        $gpus=@(Get-CimInstance Win32_VideoController|ForEach-Object {@{name=[string]$_.Name;vendor=[string]$_.AdapterCompatibility;version=[string]$_.DriverVersion;pnpId=[string]$_.PNPDeviceID}})
        @{gpus=$gpus;updates=@();message='当前为受限验收模式，仅检测硬件，不执行在线驱动扫描或安装。';checked=$false;source='Windows Update 兼容驱动通道'}|ConvertTo-Json -Compress -Depth 8
    }
    'steam-install' {
        $installer=[string]$parameters[0];$expected=[string]$parameters[1];$target=[string]$parameters[2]
        if(-not (Test-LocalPath $installer) -or -not (Test-LocalPath $target) -or $target -notmatch '^[A-Z]:\\Steam$'){throw 'Steam 安装目录无效'}
        $drive=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='"+$target.Substring(0,2)+"'")
        if($drive.DriveType -ne 3 -or $drive.FreeSpace -lt 2GB){throw '安装盘必须为固定磁盘且至少有 2 GiB 可用空间。'}
        if((Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Force).Count -gt 0){throw 'Steam 目标目录非空；请先手动定位已有 Steam，不会覆盖用户文件。'}
        $signature=Get-AuthenticodeSignature -LiteralPath $installer
        if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Valve (Corp\.|Corporation)(,|$)' -or (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ine $expected){throw 'Steam 安装器签名或哈希已变化'}
        # NSIS 的 /D 必须作为最后参数；路径固定为盘符加 Steam，不接受外部命令行。
        $process=Start-Process -FilePath $installer -ArgumentList @('/S',('/D='+$target)) -Verb RunAs -PassThru -Wait -WindowStyle Hidden
        if($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $target 'steam.exe') -PathType Leaf)){throw 'Steam 安装未完成，请查看官方安装器结果；可以从系统应用列表卸载。'}
        @{ok=$true}|ConvertTo-Json -Compress
    }
    'driver-apply' {
        $id=[string]$parameters[0];$null=[guid]::Parse($id);$revision=[int]$parameters[1];$folder=[string]$parameters[2]
        if(-not (Test-LocalPath $folder)){throw '操作日志目录无效'}
        $resultFile=Join-Path $folder ('driver-result-'+[guid]::NewGuid().ToString('N')+'.json')
        # UAC 子进程显式继承 D 盘临时目录，脚本及结果均留在应用控制目录。
        function Literal([string]$value){return "'"+$value.Replace("'","''")+"'"}
        $json=ConvertTo-Json -InputObject @($id,$revision,$folder) -Compress
        $command='$env:TEMP='+ (Literal $folder)+';$env:TMP='+(Literal $folder)+';$env:PSModuleAnalysisCachePath='+(Literal (Join-Path $folder 'ModuleAnalysisCache'))+';& '+(Literal $PSCommandPath)+' -Operation driver-install -ArgumentJson '+(Literal $json)+' | Out-File -LiteralPath '+(Literal $resultFile)+' -Encoding utf8'
        $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $shell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        try{$child=Start-Process -FilePath $shell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded) -Verb RunAs -WindowStyle Hidden -PassThru -Wait}catch{throw '管理员授权取消或驱动操作未能启动；没有自动重试。'}
        if(-not (Test-Path -LiteralPath $resultFile)){throw '未取得驱动结果；请查看 Windows Update，不能认定为安装成功。'}
        $result=Get-Content -LiteralPath $resultFile -Raw|ConvertFrom-Json
        if($child.ExitCode -ne 0 -or $result.failure){throw ([string]$result.failure)}
        $result|ConvertTo-Json -Compress -Depth 8
    }
    'storage' { Storage-Info|ConvertTo-Json -Compress -Depth 8 }
    'drivers' {
        $gpus=@(Get-CimInstance Win32_VideoController|ForEach-Object {@{name=[string]$_.Name;vendor=[string]$_.AdapterCompatibility;version=[string]$_.DriverVersion;pnpId=[string]$_.PNPDeviceID}})
        $updates=@();$message=''
        try{$updates=@(Driver-Updates)}catch{$message='Windows Update 检查失败：'+$_.Exception.Message}
        @{gpus=$gpus;updates=$updates;message=$message;checked=($message -eq '');source='Windows Update 兼容驱动通道（不等同于厂商全部测试版）'}|ConvertTo-Json -Compress -Depth 8
    }
    'driver-install' {
        $id=[string]$parameters[0];$revision=[int]$parameters[1]
        $null=[guid]::Parse($id)
        $session=New-Object -ComObject Microsoft.Update.Session
        $session.ClientApplicationID='Zhenjing first-run'
        $search=$session.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver' and IsHidden=0")
        $collection=New-Object -ComObject Microsoft.Update.UpdateColl
        for($i=0;$i -lt $search.Updates.Count;$i++){
            $update=$search.Updates.Item($i)
            if($update.Identity.UpdateID -eq $id -and $update.Identity.RevisionNumber -eq $revision -and [string]$update.DriverClass -eq 'Display'){
                if(-not $update.EulaAccepted){$update.AcceptEula()};$null=$collection.Add($update)
            }
        }
        if($collection.Count -ne 1){throw '驱动目录已变化，必须重新扫描并确认。'}
        # 更新前导出当前第三方显示驱动；备份失败时不开始更新。
        $backup=Assert-LocalPath (Join-Path ([string]$parameters[2]) ('driver-backups\'+[guid]::NewGuid().ToString('N')))
        if([IO.DriveInfo]::new([IO.Path]::GetPathRoot($backup)).AvailableFreeSpace -lt 4GB){throw '驱动备份盘至少需要 4 GiB 可用空间；未开始更新。'}
        [IO.Directory]::CreateDirectory($backup)|Out-Null
        $previous=@(Get-CimInstance Win32_PnPSignedDriver -Filter "DeviceClass='DISPLAY'" | Select-Object InfName,DeviceName,DriverVersion,DriverProviderName | Sort-Object InfName -Unique)
        $pnputil=Join-Path $env:SystemRoot 'System32/pnputil.exe'
        foreach($row in $previous){if([string]$row.InfName -match '^oem\d+\.inf$'){& $pnputil /export-driver ([string]$row.InfName) $backup | Out-Null;if($LASTEXITCODE -ne 0){throw ('无法导出旧显卡驱动，更新已取消。备份位置：'+$backup)}}}
        [IO.File]::WriteAllText((Join-Path $backup 'manifest.json'),(@{updateId=$id;revision=$revision;previous=$previous;time=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $backup '恢复说明.txt'),"优先使用设备管理器 → 显示适配器 → 属性 → 驱动程序 → 回退驱动程序。若无回退按钮，可在更新驱动程序时选择浏览我的计算机，并从此目录中的原始 INF 从磁盘安装。Windows 会再次验证驱动签名。微软内置基本显示驱动不导出，可由 Windows 自行恢复。不要删除当前驱动库或绕过签名强制安装。",[Text.UTF8Encoding]::new($false))
        $downloader=$session.CreateUpdateDownloader();$downloader.Updates=$collection
        $download=$downloader.Download()
        if([int]$download.ResultCode -ne 2){throw ('驱动下载未成功，结果码：'+$download.ResultCode)}
        $installer=$session.CreateUpdateInstaller();$installer.Updates=$collection
        $result=$installer.Install()
        if([int]$result.ResultCode -ne 2){throw ('驱动安装未成功，结果码：'+$result.ResultCode+'；可在设备管理器中回退驱动。')}
        @{ok=$true;restartRequired=[bool]$result.RebootRequired;message=('驱动已通过 Windows Update 安装；旧驱动备份：'+$backup+'。恢复入口：设备管理器 → 显示适配器 → 驱动程序 → 回退驱动程序。')}|ConvertTo-Json -Compress
    }
    default {throw '不支持的首次启动操作'}
}
