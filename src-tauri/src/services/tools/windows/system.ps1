param([Parameter(Mandatory=$true)][string]$Operation, [string]$ArgumentJson = '[]', [string]$TaskBase64 = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
trap {
    # 仅固定领域脚本产生的错误可进入 IPC；不将 PowerShell 调用栈和整段脚本文本交给界面。
    $message=[string]$_.Exception.Message
    ConvertTo-Json -InputObject @{failure=$message.Substring(0,[Math]::Min(2000,$message.Length))} -Compress | Write-Output
    exit 1
}
$arguments = ConvertFrom-Json -InputObject $ArgumentJson
if ($TaskBase64) { $arguments = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TaskBase64))) }
# __NATIVE_HELPERS__
# __FILTER_HELPERS__
# __OPTIMIZATION_HELPERS__

# 所有查询只读使用 Windows 自带组件；不得在探测失败时伪造健康值、版本或安装状态。
function Output-Json($value) { ConvertTo-Json -InputObject $value -Depth 18 -Compress | Write-Output }
function Get-StableId([string]$value) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
}
function Is-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
function Read-RegistryValue([string]$path, [string]$name) {
    $key = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if ($null -eq $key) { return $null }
    try { $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Close() }
}
function Get-InstalledApps {
    $rows = @(); $seen = @{}
    foreach ($hive in @('LocalMachine','CurrentUser')) {
        foreach ($view in @('Registry64','Registry32')) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$hive, [Microsoft.Win32.RegistryView]::$view)
            try {
                $parent = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
                if ($null -eq $parent) { continue }
                try {
                    foreach ($name in $parent.GetSubKeyNames()) {
                        $key = $parent.OpenSubKey($name)
                        if ($null -eq $key) { continue }
                        try {
                            $title = [string]$key.GetValue('DisplayName')
                            if ([string]::IsNullOrWhiteSpace($title) -or $key.GetValue('SystemComponent',0) -eq 1) { continue }
                            $uninstall = [string]$key.GetValue('UninstallString')
                            $identity = "$hive|$view|$name"
                            $dedup = "$title|$($key.GetValue('DisplayVersion'))|$uninstall"
                            if ($seen.ContainsKey($dedup)) { continue }; $seen[$dedup] = $true
                            $rows += @{
                                id=(Get-StableId $identity); name=$title; version=[string]$key.GetValue('DisplayVersion'); publisher=[string]$key.GetValue('Publisher')
                                installedOn=[string]$key.GetValue('InstallDate'); bytes=([long]$key.GetValue('EstimatedSize',0)*1024)
                                location=[string]$key.GetValue('InstallLocation'); uninstallable=(-not [string]::IsNullOrWhiteSpace($uninstall))
                            }
                        } finally { $key.Close() }
                    }
                } finally { $parent.Close() }
            } finally { $base.Close() }
        }
    }
    return @($rows | Sort-Object name)
}
function Get-Gpus {
    $rows = @()
    foreach ($gpu in @(Get-CimInstance Win32_VideoController)) {
        if ([string]::IsNullOrWhiteSpace($gpu.PNPDeviceID)) { continue }
        $rows += @{id=(Get-StableId ([string]$gpu.PNPDeviceID));name=[string]$gpu.Name;instance=[string]$gpu.PNPDeviceID;driver=[string]$gpu.DriverVersion;status=[string]$gpu.Status;enabled=($null -ne $gpu.ConfigManagerErrorCode -and [int]$gpu.ConfigManagerErrorCode -eq 0)}
    }
    return $rows
}
function Get-Virtualization {
    $boot = & "$env:SystemRoot\System32\bcdedit.exe" /enum '{current}' 2>&1
    $launch = $null;$explicit=$false
    if ($LASTEXITCODE -eq 0) {
        $line = @($boot | Where-Object { [string]$_ -match '^\s*hypervisorlaunchtype\s+' }) | Select-Object -First 1
        $explicit=[bool]$line;$launch = if ($line) { ([string]$line -split '\s+')[-1] } else { 'Auto' }
    }
    $guard = @(Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard -ClassName Win32_DeviceGuard -ErrorAction SilentlyContinue) | Select-Object -First 1
    return @{admin=(Is-Admin);memoryIntegrity=(Read-RegistryValue 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled');vbs=(Read-RegistryValue 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\DeviceGuard' 'EnableVirtualizationBasedSecurity');hypervisorLaunch=$launch;hypervisorExplicit=$explicit;vbsRunning=$(if ($guard) {[int]$guard.VirtualizationBasedSecurityStatus} else {$null});restartRequired=$true}
}
function Get-DiskHealth {
    $physical = @(Get-PhysicalDisk -ErrorAction SilentlyContinue)
    $rows = @()
    foreach ($disk in @(Get-CimInstance Win32_DiskDrive)) {
        # DeviceId 与 Win32 磁盘编号匹配，匹配不到时保留空值，不能按列表顺序猜盘。
        $match = @($physical | Where-Object { [string]$_.DeviceId -eq [string]$disk.Index }) | Select-Object -First 1
        $counter = if ($match) { $match | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue } else { $null }
        $volumes = @()
        foreach ($partition in @(Get-CimAssociatedInstance -InputObject $disk -Association Win32_DiskDriveToDiskPartition -ErrorAction SilentlyContinue)) {
            foreach ($volume in @(Get-CimAssociatedInstance -InputObject $partition -Association Win32_LogicalDiskToPartition -ErrorAction SilentlyContinue)) {
                $volumes += @{drive=[string]$volume.DeviceID;label=[string]$volume.VolumeName;bytes=[long]$volume.Size;freeBytes=[long]$volume.FreeSpace}
            }
        }
        $rows += @{id=(Get-StableId ([string]$disk.DeviceID));index=[int]$disk.Index;name=[string]$disk.Model;serial=([string]$disk.SerialNumber).Trim();bytes=[long]$disk.Size;interface=[string]$disk.InterfaceType;firmware=[string]$disk.FirmwareRevision;mediaType=$(if($match){[string]$match.MediaType}else{[string]$disk.MediaType});health=$(if($match){[string]$match.HealthStatus}else{$null});temperature=$(if($counter){$counter.Temperature}else{$null});powerOnHours=$(if($counter){$counter.PowerOnHours}else{$null});wear=$(if($counter){$counter.Wear}else{$null});readErrors=$(if($counter){$counter.ReadErrorsTotal}else{$null});writeErrors=$(if($counter){$counter.WriteErrorsTotal}else{$null});volumes=$volumes}
    }
    return @{admin=(Is-Admin);disks=$rows}
}
function Get-ContextEntries {
    $rows = @()
    $types = @(@('file','*'),@('folder','Directory'),@('desktop','Directory\Background'),@('drive','Drive'),@('all-files','AllFilesystemObjects'))
    foreach ($hive in @('HKEY_CURRENT_USER','HKEY_LOCAL_MACHINE')) {
        foreach ($type in $types) {
            $base = "Registry::$hive\SOFTWARE\Classes\$($type[1])"
            foreach ($kind in @('shell','shellex\ContextMenuHandlers')) {
                $parent = "$base\$kind"
                foreach ($entry in @(Get-ChildItem -LiteralPath $parent -ErrorAction SilentlyContinue)) {
                    try {
                        $name = [string]$entry.GetValue('MUIVerb'); if (-not $name) { $name = [string]$entry.GetValue('') }; if (-not $name) { $name=$entry.PSChildName }
                        $command = Read-RegistryValue ("Registry::"+$entry.Name+'\command') ''
                        $hidden = $entry.GetValueNames() -contains 'LegacyDisable' -or $entry.GetValueNames() -contains 'ProgrammaticAccessOnly'
                        if ($kind -ne 'shell') { $hidden = ([string]$entry.GetValue('')).StartsWith('-') }
                        $rows += @{id=(Get-StableId $entry.Name);name=$name;category=[string]$type[0];source=$hive;kind=$kind;command=[string]$command;hidden=[bool]$hidden;registryPath=("Registry::"+$entry.Name)}
                    } finally { $entry.Close() }
                }
            }
        }
    }
    return $rows
}
function Get-Namespaces([string]$root) {
    $rows=@();$seen=@{}
    $parents=@('Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\MyComputer\NameSpace','Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Explorer\MyComputer\NameSpace',(User-RegistryPath 'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\MyComputer\NameSpace'))
    foreach($parent in $parents){foreach($key in @(Get-ChildItem -LiteralPath $parent -ErrorAction SilentlyContinue)){
        try{
            $path='Registry::'+$key.Name;$id=Get-StableId $path;$label=[string]$key.GetValue('')
            if(-not $label){$label=[string](Read-RegistryValue ('Registry::HKEY_CLASSES_ROOT\CLSID\'+$key.PSChildName) '')}
            if(-not $label){$label=$key.PSChildName}
            $rows+=@{id=$id;name=$label;hidden=$false;registryPath=$path;clsid=$key.PSChildName};$seen[$id]=$true
        }finally{$key.Close()}
    }}
    # 隐藏后注册项不再存在，通过自己的备份恢复列表；只展示曾由本工具隐藏的条目。
    if((Test-LocalPath $root) -and (Test-Path -LiteralPath $root)){
        foreach($file in @(Get-ChildItem -LiteralPath $root -Filter '*.backup.json' -File -ErrorAction SilentlyContinue)){
            $backup=Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
            if($backup.originalKind -ne 'namespace-toggle'){continue}
            foreach($entry in @($backup.operations)){
                if($entry.type -ne 'namespace' -or (Test-Path -LiteralPath $entry.path)){continue}
                $id=Get-StableId $entry.path;if($seen.ContainsKey($id)){continue}
                $rows+=@{id=$id;name=[string]$entry.label;hidden=$true;registryPath=[string]$entry.path;clsid=([string]$entry.path -split '\\')[-1];saved=$entry};$seen[$id]=$true
            }
        }
    }
    return $rows
}
function Get-DriveEntries {
    $mask=Read-RegistryValue 'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer' 'NoDrives';if($null -eq $mask){$mask=0}
    return @(Get-CimInstance Win32_LogicalDisk | ForEach-Object {@{letter=[string]$_.DeviceID;name=[string]$_.VolumeName;hidden=(([int]$mask -band (1 -shl ([int][char]([string]$_.DeviceID)[0]-65))) -ne 0);type=[int]$_.DriveType}})
}

# 对象键按序归一化，确保两次独立 PowerShell 查询的指纹不受哈希表枚举顺序影响。
function Convert-Canonical($value) {
    if ($null -eq $value) { return $null }
    if ($value -is [Collections.IDictionary]) { $result=[ordered]@{}; foreach($key in @($value.Keys | Sort-Object)){ $result[[string]$key]=Convert-Canonical $value[$key] };return $result }
    if ($value -is [Management.Automation.PSCustomObject]) { $result=[ordered]@{};foreach($property in @($value.PSObject.Properties | Sort-Object Name)){ $result[$property.Name]=Convert-Canonical $property.Value };return $result }
    if ($value -is [Collections.IEnumerable] -and $value -isnot [string]) { $items=@();foreach($item in $value){$items+=,(Convert-Canonical $item)};return ,$items }
    return $value
}
function Get-Fingerprint($value) { Get-StableId (ConvertTo-Json -InputObject (Convert-Canonical $value) -Depth 25 -Compress) }
function User-RegistryPath([string]$path) {
    if ($path.StartsWith('Registry::HKEY_CURRENT_USER\')) { return $path.Replace('Registry::HKEY_CURRENT_USER\', ('Registry::HKEY_USERS\'+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value+'\')) }
    return $path
}
function New-RegOperation([string]$path,[string]$name,[string]$kind,$value,[bool]$remove=$false) {
    $path=User-RegistryPath $path
    $key=Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    $exists=$false;$old=$null;$oldKind=$null
    if ($key) {try {$exists=$key.GetValueNames() -contains $name;if($exists){$old=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);$oldKind=[string]$key.GetValueKind($name)}}finally{$key.Close()}}
    return [ordered]@{type='registry';path=$path;name=$name;beforeExists=$exists;before=$old;beforeKind=$oldKind;afterExists=(-not $remove);after=$value;afterKind=$kind}
}
function Assert-RegistryOperation($entry,[string]$domain) {
    $path=[string]$entry.path;$name=[string]$entry.name
    if ($path -match '\.\.' -or $name -match '[\\\x00-\x1f]') { throw '注册表目标不合法' }
    $allowed=$false
    switch ($domain) {
        'gpu-rename' { $allowed=($path -match '^Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\(Enum\\PCI\\[^\\]+\\[^\\]+|Control\\Class\\\{4d36e968-e325-11ce-bfc1-08002be10318\}\\\d{4})$') -and $name -in @('FriendlyName','DeviceDesc','DriverDesc') }
        'virtualization' { $allowed=($path -eq 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\DeviceGuard' -and $name -eq 'EnableVirtualizationBasedSecurity') -or ($path -eq 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' -and $name -eq 'Enabled') }
        'context-toggle' { $allowed=($path -match '^Registry::(HKEY_LOCAL_MACHINE|HKEY_USERS\\S-1-[0-9-]+)\\SOFTWARE\\Classes\\(\*|Directory|Directory\\Background|Drive|AllFilesystemObjects)\\(shell\\[^\\]+|shellex\\ContextMenuHandlers\\[^\\]+)$') -and $name -in @('LegacyDisable','') }
        'drive-visibility' { $allowed=($path -match '^Registry::HKEY_USERS\\S-1-[0-9-]+\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer$') -and $name -eq 'NoDrives' }
        'dlss-indicator' {$allowed=$path -eq 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\NVIDIA Corporation\Global\NGXCore' -and $name -eq 'ShowDlssIndicator'}
    }
    if (-not $allowed) { throw '拒绝不属于当前工具的注册表修改' }
}
function Assert-NamespaceOperation($entry) {
    if([string]$entry.path -notmatch '^Registry::(HKEY_LOCAL_MACHINE|HKEY_USERS\\S-1-[0-9-]+)\\SOFTWARE\\(WOW6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace\\\{[a-fA-F0-9-]{36}\}$'){throw '命名空间目标不合法'}
    foreach($value in @($entry.values)){if([string]$value.name -match '[\\\x00-\x1f]' -or [string]$value.kind -notin @('String','ExpandString','DWord','QWord','MultiString','Binary')){throw '命名空间备份不合法'}}
}
function Set-NamespaceOperation($entry,[bool]$restore) {
    Assert-NamespaceOperation $entry
    $visible=if($restore){$entry.beforeExists}else{$entry.afterExists}
    if($visible){
        $key=New-Item -Path $entry.path -Force
        try{foreach($value in @($entry.values)){
            $data=$value.value
            switch([string]$value.kind){'DWord'{$data=[int]$data}'QWord'{$data=[long]$data}'MultiString'{$data=[string[]]$data}'Binary'{$data=[byte[]]$data}default{$data=[string]$data}}
            $registryKind=[Enum]::Parse([Microsoft.Win32.RegistryValueKind],[string]$value.kind)
            $key.SetValue([string]$value.name,$data,$registryKind)
        }}finally{$key.Close()}
    }elseif(Test-Path -LiteralPath $entry.path){
        $key=Get-Item -LiteralPath $entry.path;try{if($key.SubKeyCount -ne 0){throw '条目包含子配置，不允许递归删除'}}finally{$key.Close()}
        Remove-Item -LiteralPath $entry.path -ErrorAction Stop
    }
    if((Test-Path -LiteralPath $entry.path) -ne [bool]$visible){throw '命名空间操作回读验证失败'}
}
function Set-RegOperation($entry,[bool]$restore) {
    $exists=if($restore){$entry.beforeExists}else{$entry.afterExists}
    $value=if($restore){$entry.before}else{$entry.after}
    $kind=if($restore){$entry.beforeKind}else{$entry.afterKind}
    if ($exists) {
        $key=Get-Item -LiteralPath $entry.path -ErrorAction SilentlyContinue
        if (-not $key) { $key=New-Item -Path $entry.path -Force }
        try {
            switch ([string]$kind) { 'DWord' {$value=[int]$value} 'QWord' {$value=[long]$value} 'MultiString' {$value=[string[]]$value} 'Binary' {$value=[byte[]]$value} default {$value=[string]$value} }
            $key.SetValue([string]$entry.name,$value,[Microsoft.Win32.RegistryValueKind]::$kind)
        } finally { $key.Close() }
    } else {
        $key=Get-Item -LiteralPath $entry.path -ErrorAction SilentlyContinue
        if($key){try{$key.DeleteValue([string]$entry.name,$false)}finally{$key.Close()}}
    }
    # 每个值写入后立即回读；不能仅因注册表 API 没抛异常就返回“成功”。
    $actual=Read-RegistryValue $entry.path $entry.name
    if($exists -and (Get-Fingerprint $actual) -ne (Get-Fingerprint $value)){throw '注册表回读验证失败'}
    if(-not $exists -and $null -ne $actual){throw '注册表删除验证失败'}
}
function Get-AppTarget([string]$id) {
    foreach($hive in @('LocalMachine','CurrentUser')) {foreach($view in @('Registry64','Registry32')) {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$hive,[Microsoft.Win32.RegistryView]::$view)
        try{
            $parent=$base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
            if(-not $parent){continue}
            try{foreach($name in $parent.GetSubKeyNames()){
                if((Get-StableId "$hive|$view|$name") -ne $id){continue}
                $key=$parent.OpenSubKey($name)
                if(-not $key){continue}
                try{return [ordered]@{id=$id;name=[string]$key.GetValue('DisplayName');publisher=[string]$key.GetValue('Publisher');version=[string]$key.GetValue('DisplayVersion');command=[string]$key.GetValue('UninstallString');location=[string]$key.GetValue('InstallLocation');icon=[string]$key.GetValue('DisplayIcon')}}finally{$key.Close()}
            }}finally{$parent.Close()}
        }finally{$base.Close()}
    }}
    throw '应用已变化或不存在，请刷新后重试'
}
function Get-SystemPlan($change,[string]$root) {
    $operations=@();$restart=$false;$reversible=$true;$summary=@();$title='系统修改';$target=$null
    switch ([string]$change.kind) {
        'optimization' {
            $target=Get-OptimizationPlan @($change.selections)
            $operations=@($target.entry);$title=('系统优化：'+$target.count+' 项配置')
            $summary=@('仅写入已确认的内置白名单；逐值备份、回读验证，失败时回滚。','恢复参考预设与撤销本次修改不是同一操作。配置匹配不代表系统已采用，建议保存工作后自行重启。')+@($target.summary)
            $restart=$true
        }
        'gpu-rename' {
            if ([string]$change.name -match '[\x00-\x1f]' -or ([string]$change.name).Length -gt 80 -or [string]::IsNullOrWhiteSpace($change.name)){throw '显卡名称不合法'}
            $target=@(Get-Gpus | Where-Object {$_.id -eq $change.id}) | Select-Object -First 1
            if(-not $target -or $target.instance -notmatch '^PCI\\[^\\]+\\[^\\]+$'){throw '显卡设备已变化'}
            $path='Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\'+$target.instance
            $operations+=New-RegOperation $path 'FriendlyName' 'String' ([string]$change.name)
            $operations+=New-RegOperation $path 'DeviceDesc' 'String' ([string]$change.name)
            $driver=Read-RegistryValue $path 'Driver'
            if($driver -match '^\{4d36e968-e325-11ce-bfc1-08002be10318\}\\\d{4}$'){$operations+=New-RegOperation ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\'+$driver) 'DriverDesc' 'String' ([string]$change.name)}
            $title='改写显卡显示名称';$summary=@("$($target.name) → $($change.name)",'仅改变 Windows 显示名称，不改变硬件性能。','保留原始注册表值，可从操作记录恢复。');$restart=$true
        }
        'gpu-restart' { $target=@(Get-Gpus | Where-Object {$_.enabled -and $_.instance -match '^PCI\\[^\\]+\\[^\\]+$'});if(-not $target.Count){throw '没有可重启的已启用 PCI 显卡'};$title='重启显卡驱动';$summary=@('只重启已启用的 PCI 显卡，跳过虚拟显示适配器和原本禁用的设备。','屏幕会短暂黑屏，请先保存工作；异常时在设备管理器重新启用显卡。');$reversible=$false }
        'virtualization' {
            $target=Get-Virtualization
            $value=if($change.enabled){1}else{0}
            $operations+=New-RegOperation 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\DeviceGuard' 'EnableVirtualizationBasedSecurity' 'DWord' $value
            $operations+=New-RegOperation 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled' 'DWord' $value
            if($null -eq $target.hypervisorLaunch){throw '无法读取启动配置，请以管理员身份运行后重试'}
            $operations+=[ordered]@{type='bcd';before=[string]$target.hypervisorLaunch;beforeExists=[bool]$target.hypervisorExplicit;after=$(if($change.enabled){'Auto'}else{'Off'})}
            $title=if($change.enabled){'启用虚拟化安全相关设置'}else{'关闭虚拟化安全相关设置'}
            $summary=@('修改 VBS、内存完整性及 Hyper-V 启动类型。','会影响依赖虚拟化的软件及系统安全功能。','原值保存在应用数据目录，可按操作记录恢复；需重启生效。');$restart=$true
        }
        'context-toggle' {
            $target=@(Get-ContextEntries | Where-Object {$_.id -eq $change.id}) | Select-Object -First 1
            if(-not $target){throw '菜单项已变化，请刷新后重试'}
            if($target.kind -eq 'shell'){$operations+=New-RegOperation $target.registryPath 'LegacyDisable' 'String' '' (-not [bool]$change.hidden)}
            else{$current=[string](Read-RegistryValue $target.registryPath '');$value=if($change.hidden){'-'+$current.TrimStart('-')}else{$current.TrimStart('-')};$operations+=New-RegOperation $target.registryPath '' 'String' $value}
            $title=if($change.hidden){'隐藏右键菜单项'}else{'恢复右键菜单项'};$summary=@([string]$target.name,'只修改所选条目，不卸载对应软件。')
        }
        'drive-visibility' {
            $path='Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer'
            $before=Read-RegistryValue $path 'NoDrives';$mask=if($null -eq $before){0}else{[int]$before}
            if([string]$change.letter -notmatch '^[A-Z]:$'){throw '盘符不合法'}
            $bit=1 -shl ([int][char]([string]$change.letter)[0]-65)
            $after=if($change.hidden){$mask -bor $bit}else{$mask -band (-bnot $bit)}
            $operations+=New-RegOperation $path 'NoDrives' 'DWord' $after
            $target=@{letter=$change.letter;mask=$mask};$title='修改此电脑盘符显示';$summary=@("$($change.letter) · $(if($change.hidden){'隐藏'}else{'显示'})",'只改变资源管理器显示，不删除磁盘或分区。')
        }
        'namespace-toggle' {
            $target=@(Get-Namespaces $root | Where-Object {$_.id -eq $change.id}) | Select-Object -First 1
            if(-not $target){throw '此电脑条目不存在，请重新扫描'}
            $values=@()
            if($target.hidden){$values=@($target.saved.values)}else{
                $key=Get-Item -LiteralPath $target.registryPath
                try{if($key.SubKeyCount -ne 0){throw '条目包含子配置，不能隐藏'};foreach($name in $key.GetValueNames()){$values+=@{name=$name;kind=[string]$key.GetValueKind($name);value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}}}finally{$key.Close()}
            }
            $entry=@{type='namespace';path=$target.registryPath;label=$target.name;beforeExists=(-not $target.hidden);afterExists=(-not $change.hidden);values=$values}
            Assert-NamespaceOperation $entry;$operations+=,$entry
            $title=if($change.hidden){'隐藏此电脑条目'}else{'恢复此电脑条目'};$summary=@([string]$target.name,'保留注册值备份，只管理所选命名空间注册项。')
        }
        'app-uninstall' {
            $target=Get-AppTarget $change.id
            if([string]::IsNullOrWhiteSpace($target.command)){throw '此应用没有可用的卸载器'}
            $title='启动应用卸载器';$summary=@([string]$target.name,"版本：$($target.version)；发布者：$($target.publisher)",'将启动软件自己的卸载流程；卸载无法由臻境撤销，请自行保留安装包和重要数据。');$reversible=$false
        }
        'disk-optimize' {
            $target=@((Get-DiskHealth).disks | Where-Object {$_.id -eq $change.id}) | Select-Object -First 1
            if(-not $target -or -not @($target.volumes | Where-Object {$_.drive -eq $change.drive}).Count){throw '所选卷不属于该磁盘，请重新扫描'}
            if([string]$change.drive -notmatch '^[A-Z]:$'){throw '盘符不合法'}
            if(-not $change.trim -and $target.mediaType -ne 'HDD'){throw '仅允许对已识别的机械硬盘执行碎片整理'}
            $title=if($change.trim){'执行卷 TRIM'}else{'执行卷碎片整理'};$summary=@("$($target.name) · $($change.drive)",'操作将由 Windows 存储服务执行，不会主动删除用户文件。');$reversible=$false
        }
        'vac-repair' {
            $steam=Read-RegistryValue 'Registry::HKEY_CURRENT_USER\SOFTWARE\Valve\Steam' 'SteamPath'
            if(-not $steam){$steam=Read-RegistryValue 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam' 'InstallPath'}
            if(-not $steam -or -not (Test-Path -LiteralPath (Join-Path $steam 'bin\SteamService.exe'))){throw '未找到完整的 Steam 服务安装'}
            $signature=Get-AuthenticodeSignature -LiteralPath (Join-Path $steam 'bin\SteamService.exe');if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Valve'){throw 'Steam 服务签名无效，停止修复'}
            $target=@{steam=[string]$steam;serviceHash=(Get-FileHash -LiteralPath (Join-Path $steam 'bin\SteamService.exe') -Algorithm SHA256).Hash}
            foreach($name in @('Netman','RasMan','TapiSrv','MpsSvc','Steam Client Service')){if(Get-Service -Name $name -ErrorAction SilentlyContinue){$operations+=@{type='vac-service';name=$name;before=(Get-VacService $name);after=@{start=2;delayed=0;running=$true}}}}
            $firewall=@(Get-VacFirewall);$operations+=@{type='vac-firewall';before=$firewall;after=@($firewall | ForEach-Object {@{name=$_.name;enabled=1}})}
            $boot=Get-VacBcd;foreach($name in @('nointegritychecks','loadoptions','nx','debug')){$operations+=@{type='vac-bcd';name=$name;before=$boot[$name];after=$null}}
            $title='修复 Steam VAC 本地环境';$summary=@('关闭 Steam 并修复 Steam Client Service。','启用相关网络服务、防火墙并移除 BCD 调试覆盖。系统配置原值备份到应用数据目录，可从操作记录恢复。','恢复入口仅撤销这些服务、防火墙和启动配置；Valve 服务安装/修复及 Steam 运行会话不能撤销。不会解除账号封禁，请先退出游戏并保存工作。');$restart=$true
        }
        'nvidia' {
            $snapshot=Get-NvidiaSnapshot ([string]$change.scope)
            $before=@();$after=@();$target=@()
            foreach($item in @($change.settings)){
                $row=@($snapshot.settings | Where-Object {$_.id -eq $item.id}) | Select-Object -First 1
                if(-not $row -or -not $row.supported){throw '驱动不支持所选配置项，请刷新'}
                if($null -ne $item.value -and [uint32]$item.value -notin @($row.values) -and -not ($row.id -eq 0x10835002 -and [uint32]$item.value -le 1000)){throw '驱动未声明支持此设置值'}
                $before+=@{id=$row.id;value=$row.current;reset=($row.location -ne 0 -or $row.predefined)}
                $after+=@{id=$row.id;value=$(if($null -eq $item.value){0}else{[long]$item.value});reset=($null -eq $item.value)}
                $target+=@{id=$row.id;current=$row.current;location=$row.location;predefined=$row.predefined}
                $summary+=($row.label+'：'+$row.current+' → '+$(if($null -eq $item.value){'驱动默认'}else{[string]$item.value}))
            }
            $operations+=@{type='nvidia';scope=$change.scope;before=$before;after=$after}
            $title=if($change.scope -eq 'delta'){'修改三角洲行动 DLSS 配置'}else{'修改 NVIDIA 全局 3D 配置'}
            $summary+=@('原始覆盖值保存在应用数据目录；可在操作记录中恢复。','需要重新启动相关游戏，实际效果取决于 GPU、驱动与游戏支持。')
        }
        'dlss-indicator' {
            $capability=Get-NvidiaSnapshot 'delta';if(-not @($capability.settings | Where-Object {$_.id -eq 0x10E41E01 -and $_.supported}).Count){throw '当前驱动未声明支持 DLSS 覆盖'}
            $entry=New-RegOperation 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\NVIDIA Corporation\Global\NGXCore' 'ShowDlssIndicator' 'DWord' $(if($change.enabled){1024}else{0});$operations+=,$entry;$target=@{before=$entry.before;enabled=$change.enabled}
            $title='修改 NVIDIA DLSS 状态指示器';$summary=@($(if($change.enabled){'启用 DLSS 调试状态叠加'}else{'关闭 DLSS 调试状态叠加'}),'修改 NVIDIA 全局 NGX 标志，重启相关游戏后生效；原始值保存在应用数据目录，可恢复。')
        }
        'feature' {
            $snapshot=Get-FeatureSnapshot ([uint32]$change.store)
            $target=@($snapshot.features | Where-Object {$_.id -eq $change.id})
            $before=@($target | Where-Object {$_.priority -eq $change.priority}) | Select-Object -First 1
            $after=if($change.reset){$null}else{@{state=$change.state;variant=$change.variant;payloadKind=$change.payloadKind;payload=$change.payload}}
            $entry=@{type='feature';id=$change.id;priority=$change.priority;store=$change.store;before=$before;after=$after;bootBefore=(Get-FeatureOverride ([uint32]$change.id) ([uint32]$change.priority))}
            Assert-FeatureOperation $entry;$operations+=,$entry
            $title='修改 Windows 隐藏功能';$restart=([int]$change.store -eq 0)
            $summary=@("功能 ID：$($change.id)；优先级：$($change.priority)","存储：$(if($restart){'Boot（重启后生效）'}else{'Runtime'})；动作：$(if($change.reset){'重置所选优先级覆盖'}else{'设置状态 '+$change.state})",'隐藏功能属于系统实验开关，可能影响系统稳定性；仅更改所选 ID 与优先级，并保留恢复记录。')
        }
        'audio-driver' {
            $directory=Assert-AudioDriverPackage $root;$target=@(Get-AudioDriverDevices)
            if([bool]$target.Count -eq [bool]$change.install){throw '虚拟音频设备已经处于目标状态，请刷新'}
            $operations+=@{type='audio-driver';before=[bool]$target.Count;after=[bool]$change.install}
            $title=if($change.install){'安装 FxSound 虚拟音频设备'}else{'移除 FxSound 虚拟音频设备'}
            $summary=@('使用固定 SHA256 的官方驱动包，并验证微软 WHQL 签名。','Windows 设备安装服务会写系统驱动目录和注册表；安装包和记录仍在应用数据目录。','移除前停止 EQ；可从操作记录恢复设备状态。不会自动改变默认播放设备，系统如请求重启，请保存工作后自行重启。');$restart=$true
        }
        'restore' {
            if([string]$change.id -notmatch '^[a-f0-9-]{36}$'){throw '备份标识无效'}
            $backupPath=Join-Path $root ($change.id+'.backup.json')
            $target=Get-Content -LiteralPath $backupPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $originalReceipt=Get-Content -LiteralPath (Join-Path $root ($change.id+'.receipt.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
            if(-not $target.reversible -or -not $originalReceipt.reversible -or $target.originalKind -notin @('gpu-rename','virtualization','context-toggle','namespace-toggle','drive-visibility','nvidia','feature','audio-driver','dlss-indicator','vac-repair','optimization')){throw '此操作没有可恢复的配置备份或已恢复'}
            foreach($entry in @($target.operations)){if($entry.type -eq 'optimizer-batch' -and $target.originalKind -eq 'optimization'){Assert-OptimizerOperation $entry}elseif($entry.type -eq 'registry'){Assert-RegistryOperation $entry $target.originalKind}elseif($entry.type -eq 'namespace'){Assert-NamespaceOperation $entry}elseif($entry.type -eq 'nvidia' -and $target.originalKind -eq 'nvidia'){Assert-NvidiaOperation $entry}elseif($entry.type -eq 'feature' -and $target.originalKind -eq 'feature'){Assert-FeatureOperation $entry}elseif($entry.type -eq 'audio-driver' -and $target.originalKind -eq 'audio-driver'){Assert-AudioDriverPackage $root|Out-Null}elseif($entry.type -in @('vac-service','vac-firewall','vac-bcd') -and $target.originalKind -eq 'vac-repair'){if($entry.type -eq 'vac-service'){Get-VacService ([string]$entry.name)|Out-Null}elseif($entry.type -eq 'vac-bcd' -and $entry.name -notin @('nointegritychecks','loadoptions','nx','debug')){throw '启动项不在白名单中'}}elseif($entry.type -ne 'bcd' -or $target.originalKind -ne 'virtualization' -or $entry.before -notin @('Auto','Off')){throw '备份包含不支持的操作'}}
            $title='恢复操作前的配置';$summary=@([string]$target.title,'恢复前将检查当前值是否仍为本次操作写入的值，避免覆盖后续人工修改。');$reversible=$false;$restart=[bool]$target.restartRequired
            if($target.originalKind -eq 'optimization'){foreach($batch in $target.operations){foreach($selection in $batch.selections){$item=Get-OptimizerItem ([string]$selection.id);$summary+=('撤销 '+$item.name+' → 备份原值（'+$item.risk+'）')}}}
        }
        default { throw '不支持的系统变更' }
    }
    foreach($entry in $operations){if($entry.type -eq 'registry'){Assert-RegistryOperation $entry $change.kind}}
    $identity=$target
    if($change.kind -eq 'disk-optimize'){$identity=@{id=$target.id;serial=$target.serial;bytes=$target.bytes;volumes=@($target.volumes | ForEach-Object {$_.drive})}}
    $optimization=($change.kind -eq 'optimization' -or ($change.kind -eq 'restore' -and $target.originalKind -eq 'optimization'))
    $changes=@()
    if($optimization){$batches=if($change.kind -eq 'optimization'){@($target.entry)}else{@($target.operations)};foreach($batch in $batches){foreach($row in $batch.rows){$changes+=@{path=$row.path;name=$row.name;before=$(if($change.kind -eq 'optimization'){$row.before}else{Read-OptimizerState $row.path $row.name});after=$(if($change.kind -eq 'optimization'){$row.after}else{$row.before});owners=@($row.owners)}}}}
    return @{preview=@{title=$title;summary=$summary;requiresAdmin=$true;restartRequired=$restart;reversible=$reversible;changes=$changes};fingerprint=(Get-Fingerprint @{change=$change;target=$identity;operations=$operations});target=$target;operations=$operations;domain=$(if($optimization){'optimization'}else{$null});userSid=$(if($optimization){(Get-OptimizerContext).sid}else{$null})}
}
function Write-AtomicJson([string]$path,$value) {
    if((-not (Test-LocalPath $path))){throw '日志及备份必须保存在应用数据目录'}
    $temporary=$path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $value -Depth 25))
    $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    if(Test-Path -LiteralPath $path){[IO.File]::Replace($temporary,$path,[Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($temporary,$path)}
}
function Invoke-Checked([string]$file,[string[]]$parameters) {
    $text=& $file @parameters 2>&1
    if($LASTEXITCODE -ne 0){throw ("原生工具执行失败（$LASTEXITCODE）："+($text -join ' '))}
    return ($text -join "`n")
}
function Invoke-StoredOperation($entry,[bool]$restore,[string]$root) {
    switch([string]$entry.type){
        'optimizer-batch' {Set-OptimizationOperation $entry $restore}
        'registry' {Set-RegOperation $entry $restore}
        'namespace' {Set-NamespaceOperation $entry $restore}
        'nvidia' {Set-NvidiaOperation $entry $restore}
        'feature' {Set-FeatureOperation $entry $restore}
        'audio-driver' {Set-AudioDriverOperation $entry $restore $root}
        'vac-service' {Set-VacService $entry $restore}
        'vac-firewall' {Set-VacFirewall $entry $restore}
        'vac-bcd' {Set-VacBcd $entry $restore}
        'bcd' {
            if($restore -and $null -ne $entry.beforeExists -and -not $entry.beforeExists){Invoke-Checked "$env:SystemRoot\System32\bcdedit.exe" @('/deletevalue','{current}','hypervisorlaunchtype')|Out-Null}
            else{$value=if($restore){$entry.before}else{$entry.after};Invoke-Checked "$env:SystemRoot\System32\bcdedit.exe" @('/set','{current}','hypervisorlaunchtype',[string]$value)|Out-Null}
        }
        default {throw '备份包含未知操作类型'}
    }
}
function Assert-CurrentOperation($entry) {
    switch([string]$entry.type){
        'optimizer-batch' {Assert-OptimizerCurrent $entry}
        'registry' {if((Get-Fingerprint (Read-RegistryValue $entry.path $entry.name)) -ne (Get-Fingerprint $entry.after)){throw '配置已被其他操作修改，拒绝覆盖'}}
        'namespace' {
            if((Test-Path -LiteralPath $entry.path) -ne [bool]$entry.afterExists){throw '此电脑条目状态已变化，拒绝覆盖'}
            if($entry.afterExists){$key=Get-Item -LiteralPath $entry.path;try{if($key.SubKeyCount){throw '命名空间出现额外子配置'};$values=@();foreach($name in $key.GetValueNames()){$values+=@{name=$name;kind=[string]$key.GetValueKind($name);value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}}}finally{$key.Close()};if((Get-Fingerprint @($values | Sort-Object name)) -ne (Get-Fingerprint @($entry.values | Sort-Object name))){throw '此电脑条目内容已被后续修改'}}
        }
        'bcd' {if((Get-Virtualization).hypervisorLaunch -ne [string]$entry.after){throw 'Hyper-V 启动类型已被后续修改'}}
        'nvidia' {$current=Get-NvidiaSnapshot ([string]$entry.scope);foreach($row in @($entry.after)){$actual=@($current.settings | Where-Object {$_.id -eq $row.id}) | Select-Object -First 1;if(-not $actual -or (-not $row.reset -and $actual.current -ne $row.value) -or ($row.reset -and -not $actual.predefined -and $actual.location -eq 0)){throw '驱动配置已被后续操作修改，拒绝覆盖'}}}
        'feature' {
            if([int]$entry.store -eq 0){$actual=Get-FeatureOverride ([uint32]$entry.id) ([uint32]$entry.priority);$expected=Feature-BootData $entry.after;if((Get-Fingerprint $actual) -ne (Get-Fingerprint $expected)){throw 'Boot 功能覆盖已被后续修改'}}
            else{$snapshot=Get-FeatureSnapshot 1;$row=@($snapshot.features | Where-Object {$_.id -eq $entry.id -and $_.priority -eq $entry.priority}) | Select-Object -First 1;$actual=if($row){@{state=$row.state;variant=$row.variant;payloadKind=$row.payloadKind;payload=$row.payload}}else{$null};if((Get-Fingerprint $actual) -ne (Get-Fingerprint $entry.after)){throw 'Runtime 功能覆盖已被后续修改'}}
        }
        'audio-driver' {if([bool]@(Get-AudioDriverDevices).Count -ne [bool]$entry.after){throw '音频设备状态已变化，请重新扫描'}}
        'vac-service' {if((Get-Fingerprint (Get-VacService $entry.name)) -ne (Get-Fingerprint $entry.after)){throw '服务状态已被后续修改'}}
        'vac-firewall' {if((Get-Fingerprint (Get-VacFirewall)) -ne (Get-Fingerprint $entry.after)){throw '防火墙状态已被后续修改'}}
        'vac-bcd' {if((Get-Fingerprint (Get-VacBcd)[$entry.name]) -ne (Get-Fingerprint $entry.after)){throw '启动配置已被后续修改'}}
    }
}
function Invoke-SystemCommitCore([string]$requestPath,[string]$expectedHash) {
    if((-not (Test-LocalPath $requestPath)) -or (Get-FileHash -LiteralPath $requestPath -Algorithm SHA256).Hash -ne $expectedHash){throw '系统变更请求校验失败'}
    $task=Get-Content -LiteralPath $requestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if($task.id -notmatch '^[a-f0-9-]{36}$' -or (-not (Test-LocalPath ([string]$task.root)))){throw '系统变更存储目录不合法'}
    $root=[string]$task.root
    if($task.domain -eq 'optimization'){
        if([string]$task.userSid -notmatch '^S-1-(5-21|12-1)-[0-9-]+$'){throw '优化请求缺少原始用户标识'}
        $script:OptimizationSid=[string]$task.userSid;$script:OptimizerContext=$null
    }
    $plan=Get-SystemPlan $task.change $root
    if($plan.fingerprint -ne $task.fingerprint){throw '系统状态在预览后发生变化，请重新生成预览'}
    $receipt=@{id=$task.id;title=$plan.preview.title;state='running';message='正在执行';restartRequired=$plan.preview.restartRequired;reversible=($task.domain -eq 'optimization' -and $plan.preview.reversible);createdAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();domain=$task.domain}
    $receipt.itemIds=@();if($task.domain -eq 'optimization'){$batches=if($task.change.kind -eq 'optimization'){@($plan.target.entry)}else{@($plan.target.operations)};foreach($batch in $batches){foreach($selection in $batch.selections){$receipt.itemIds+=,[string]$selection.id}}}
    $receiptPath=Join-Path $root ($task.id+'.receipt.json')
    $backup=@{originalKind=$task.change.kind;title=$plan.preview.title;operations=$plan.operations;restartRequired=$plan.preview.restartRequired;reversible=$plan.preview.reversible}
    Write-AtomicJson (Join-Path $root ($task.id+'.backup.json')) $backup
    Write-AtomicJson $receiptPath $receipt
    $applied=@();$restoreApplied=@()
    try {
        foreach($entry in $plan.operations) {
            # 先登记当前项，即使写入后的回读验证失败，也必须尝试恢复这一次写入。
            $applied+=,$entry
            Invoke-StoredOperation $entry $false $root
        }
        switch([string]$task.change.kind) {
            'gpu-restart' {
                foreach($gpu in $plan.target) {try{Disable-PnpDevice -InstanceId $gpu.instance -Confirm:$false -ErrorAction Stop;Start-Sleep -Milliseconds 700}finally{Enable-PnpDevice -InstanceId $gpu.instance -Confirm:$false -ErrorAction Stop}}
            }
            'disk-optimize' {
                $letter=([string]$task.change.drive)[0]
                if($task.change.trim){Optimize-Volume -DriveLetter $letter -ReTrim -ErrorAction Stop}else{Optimize-Volume -DriveLetter $letter -Defrag -ErrorAction Stop}
            }
            'app-uninstall' {
                $command=[string]$plan.target.command
                if($command -match '^\s*"([^"]+\.exe)"\s*(.*)$'){$exe=$Matches[1];$argsText=$Matches[2]}
                elseif($command -match '^\s*(.+?\.exe)(?:\s+(.*))?$'){$exe=$Matches[1];$argsText=$Matches[2]}
                else{throw '卸载命令格式不受支持，请使用 Windows 应用设置'}
                $name=[IO.Path]::GetFileName($exe).ToLowerInvariant()
                if($name -in @('cmd.exe','powershell.exe','pwsh.exe','wscript.exe','cscript.exe','mshta.exe')){throw '不允许执行脚本型卸载器，请使用 Windows 应用设置'}
                if($name -eq 'msiexec.exe'){$exe="$env:SystemRoot\System32\msiexec.exe";$argsText=$argsText -replace '(?i)^/I','/X'}
                if(-not [IO.Path]::IsPathRooted($exe) -or -not (Test-Path -LiteralPath $exe -PathType Leaf)){throw '未找到卸载器文件'}
                $start=@{FilePath=$exe;PassThru=$true;ErrorAction='Stop'};if($argsText){$start.ArgumentList=$argsText}
                $process=Start-Process @start
                $receipt.message='已启动软件自身的卸载器，请按其界面完成。此回执不等同于已卸载。'
            }
            'vac-repair' {
                $steam=[string]$plan.target.steam;$service=Join-Path $steam 'bin\SteamService.exe'
                $serviceGuard=[IO.File]::Open($service,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
                try{
                $signature=Get-AuthenticodeSignature -LiteralPath $service
                if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Valve'){throw 'Steam 服务签名无效，停止修复'}
                Get-Process -Name steam -ErrorAction SilentlyContinue | Stop-Process -Force
                Invoke-Checked $service @('/install')|Out-Null;Invoke-Checked $service @('/repair')|Out-Null
                Set-Service -Name 'Steam Client Service' -StartupType Automatic -ErrorAction Stop;Start-Service -Name 'Steam Client Service' -ErrorAction Stop
                Start-Process -FilePath (Join-Path $steam 'steam.exe') -ErrorAction Stop|Out-Null
                }finally{$serviceGuard.Dispose()}
            }
            'restore' {
                # 先检查整批项目，再按相反顺序恢复；恢复失败本身也要回滚已恢复的项目。
                $entries=@($plan.target.operations);foreach($entry in $entries){Assert-CurrentOperation $entry};[array]::Reverse($entries)
                foreach($entry in $entries){$restoreApplied+=,$entry;Invoke-StoredOperation $entry $true $root}
                $originalPath=Join-Path $root ($task.change.id+'.receipt.json');$original=Get-Content -LiteralPath $originalPath -Raw -Encoding UTF8 | ConvertFrom-Json;$original.reversible=$false;Write-AtomicJson $originalPath $original
            }
        }
        $receipt.state='completed';if($receipt.message -eq '正在执行'){$receipt.message='操作执行并验证完成'};$receipt.reversible=$plan.preview.reversible
    } catch {
        $failure=[string]$_;$rollbackFailed=$false
        # 可回滚的值按相反顺序恢复，完整备份仍保留，失败不假报“已恢复”。
        [array]::Reverse($applied)
        foreach($entry in $applied){try{Invoke-StoredOperation $entry $true $root}catch{$rollbackFailed=$true}}
        [array]::Reverse($restoreApplied);foreach($entry in $restoreApplied){try{Invoke-StoredOperation $entry $false $root}catch{$rollbackFailed=$true}}
        $receipt.state='failed';$receipt.message=$failure+$(if($rollbackFailed){'；自动恢复未完全成功，请保留备份并检查系统状态。'}elseif($applied.Count){'；已恢复本次写入前的配置。'}else{''});$receipt.reversible=$rollbackFailed -and $plan.preview.reversible
    }
    Write-AtomicJson $receiptPath $receipt
    return $receipt
}
function Invoke-SystemCommit([string]$requestPath,[string]$expectedHash) {
    # 跨应用实例串行化；UAC 子进程获取同一把锁，防止两个预览同时写入相互依赖的配置。
    $mutex=[Threading.Mutex]::new($false,'Local\Zhenjing-SystemChanges-v1');$locked=$false
    try{
        try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
        if(-not $locked){throw '另一个实例正在执行系统修改，请稍后重新生成预览'}
        return Invoke-SystemCommitCore $requestPath $expectedHash
    }finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
}
switch ($Operation) {
    'optimizer-scan' {Output-Json (Get-OptimizationSnapshot)}
    'filter-probe' {
        Initialize-Native;$monitors=@((Get-DisplaySnapshot).monitors);$rows=@()
        foreach($monitor in $monitors){$target=@{id=$monitor.id;device=$monitor.device;identity=$monitor.identity;ramp=@([Zhenjing.Native]::Gamma([string]$monitor.device))};Assert-FilterTarget $target;$rows+=@{id=$monitor.id;gammaEntries=$target.ramp.Count}}
        $matrixReadable=$false;$matrixError=$null;try{$matrix=[Zhenjing.ColorMatrix]::new();$matrixReadable=$true;$matrix.Dispose()}catch{$matrixError=[string]$_}
        Output-Json @{monitors=$rows;matrixReadable=$matrixReadable;matrixError=$matrixError}
    }
    'filter-run' {Invoke-FilterWorker}
    'filter-recover' {Invoke-FilterRecovery}
    'telemetry-probe' {Initialize-Native;$sensor=[Zhenjing.Sensors]::new($null,'',0);try{Start-Sleep -Milliseconds 300;Output-Json ($sensor.Read(0,$false))}finally{$sensor.Dispose()}}
    'telemetry-elevated' {Invoke-TelemetryWorker}
    'display-watch' {
        Initialize-Native
        $config=ConvertFrom-Json -InputObject ([string]$arguments[0]);$control=[string]$arguments[1]
        if((-not (Test-LocalPath $control)) -or [IO.Path]::GetExtension($control) -ne '.json'){throw '显示模式恢复目录无效'}
        if([Zhenjing.Native]::Identity([string]$config.device) -ne [string]$config.identity){throw '原显示器已断开，拒绝切换其他显示器'}
        $owner=[Diagnostics.Process]::GetProcessById([int]$arguments[2]);$before=[Zhenjing.Native]::ReadMode([string]$config.device,-1)
        $changed=$false;$kept=$false;$persistAttempted=$false;$recoveryState='prepared'
        try {
            Write-AtomicJson ($control+'.backup.json') @{device=$config.device;identity=$config.identity;width=$before.Width;height=$before.Height;refresh=$before.Frequency;state='prepared'}
            $changed=$true;[Zhenjing.Native]::SetMode([string]$config.device,[uint32]$config.width,[uint32]$config.height,[uint32]$config.refresh,$false)
            $timer=[Diagnostics.Stopwatch]::StartNew()
            while($timer.Elapsed.TotalSeconds -lt 15 -and -not $owner.HasExited){
                if([Zhenjing.Native]::Identity([string]$config.device) -ne [string]$config.identity){throw '原显示器已断开，停止模式确认'}
                $remaining=[Math]::Max(0,15-[int][Math]::Floor($timer.Elapsed.TotalSeconds))
                Output-Json @{phase='confirming';remaining=$remaining;message='请确认屏幕显示正常，超时将自动恢复'}
                if(Test-Path -LiteralPath $control){$decision=Get-Content -LiteralPath $control -Raw -Encoding UTF8 | ConvertFrom-Json;if($decision.decision -eq 'keep'){$persistAttempted=$true;[Zhenjing.Native]::SetMode([string]$config.device,[uint32]$config.width,[uint32]$config.height,[uint32]$config.refresh,$true);$kept=$true;break}else{break}}
                Start-Sleep -Milliseconds 200
            }
            if($kept){$recoveryState='kept';Output-Json @{phase='kept';remaining=0;message='已保留并持久化显示模式'}}
        }catch{Output-Json @{phase='failed';remaining=0;message=[string]$_}}
        finally {
            if($changed -and -not $kept){
                try{if([Zhenjing.Native]::Identity([string]$config.device) -ne [string]$config.identity){throw '原显示器未连接，未覆盖其他显示器'};[Zhenjing.Native]::SetMode([string]$config.device,$before.Width,$before.Height,$before.Frequency,$persistAttempted);$recoveryState='restored';Output-Json @{phase='restored';remaining=0;message='已恢复切换前的显示模式'}}catch{$recoveryState='failed';Output-Json @{phase='failed';remaining=0;message=('自动恢复失败，请在 Windows 显示设置中恢复：'+[string]$_)}}
            }
            Write-AtomicJson ($control+'.backup.json') @{device=$config.device;identity=$config.identity;width=$before.Width;height=$before.Height;refresh=$before.Frequency;state=$recoveryState}
            $owner.Dispose()
        }
    }
    'displays' {Output-Json (Get-DisplaySnapshot)}
    'nvidia' {Output-Json (Get-NvidiaSnapshot 'global')}
    'dlss' {Output-Json (Get-NvidiaSnapshot 'delta')}
    'features-runtime' {Output-Json (Get-FeatureSnapshot 1)}
    'features-boot' {Output-Json (Get-FeatureSnapshot 0)}
    'apps' { Output-Json @{apps=@(Get-InstalledApps)} }
    'gpus' { Output-Json @{admin=(Is-Admin);gpus=@(Get-Gpus)} }
    'virtualization' { Output-Json (Get-Virtualization) }
    'disks' { Output-Json (Get-DiskHealth) }
    'context' { Output-Json @{admin=(Is-Admin);entries=@(Get-ContextEntries);namespaces=@(Get-Namespaces ([string]$arguments[0]));drives=@(Get-DriveEntries)} }
    'vac-status' {
        $steam=Read-RegistryValue 'Registry::HKEY_CURRENT_USER\SOFTWARE\Valve\Steam' 'SteamPath'
        if(-not $steam){$steam=Read-RegistryValue 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam' 'InstallPath'}
        $serviceExists=$false;if($steam){$serviceExists=Test-Path -LiteralPath (Join-Path $steam 'bin\SteamService.exe') -PathType Leaf}
        Output-Json @{admin=(Is-Admin);installed=[bool]$steam;path=$(if($steam){[string]$steam}else{$null});serviceExists=[bool]$serviceExists;running=[bool](Get-Process -Name steam -ErrorAction SilentlyContinue)}
    }
    'app-path' {
        $target=Get-AppTarget ([string]$arguments[0]);$path=$null
        if($arguments[1] -eq 'reveal' -and (Test-Path -LiteralPath $target.location -PathType Container)){$path=$target.location}
        elseif($target.icon -match '^"?(.+?\.exe)"?(?:,\s*-?\d+)?$'){$candidate=$Matches[1];if((Test-Path -LiteralPath $candidate -PathType Leaf) -and [IO.Path]::GetFileName($candidate) -notmatch '(?i)unins|uninstall|setup'){$path=$candidate}}
        if(-not $path){throw '没有检测到可靠的程序路径，请使用软件自身的快捷方式'}
        Output-Json @{path=[string]$path}
    }
    'preview' { $plan=Get-SystemPlan (ConvertFrom-Json -InputObject ([string]$arguments[0])) ([string]$arguments[1]);Output-Json @{preview=$plan.preview;fingerprint=$plan.fingerprint;domain=$plan.domain;userSid=$plan.userSid} }
    'commit' {
        if(Is-Admin){Output-Json (Invoke-SystemCommit ([string]$arguments[0]) ([string]$arguments[1]))}
        else {
            $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $arguments -Compress)))
            try {
                $process=Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Operation','elevated-commit','-TaskBase64',$encoded) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
                $task=Get-Content -LiteralPath $arguments[0] -Raw -Encoding UTF8 | ConvertFrom-Json
                $path=Join-Path $task.root ($task.id+'.receipt.json')
                if(-not (Test-Path -LiteralPath $path)){throw '管理员操作未生成回执，请检查实际状态'}
                Output-Json (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
            } catch [ComponentModel.Win32Exception] {
                if($_.Exception.NativeErrorCode -ne 1223){throw}
                $task=Get-Content -LiteralPath $arguments[0] -Raw -Encoding UTF8 | ConvertFrom-Json
                Output-Json @{id=$task.id;title=$task.title;state='cancelled';message='已取消管理员授权，未执行系统修改';restartRequired=$false;reversible=$false;createdAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
            }
        }
    }
    'elevated-commit' {
        $task=Get-Content -LiteralPath $arguments[0] -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach($key in @('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE')){$directory=Join-Path $task.root ('process\'+$key);[IO.Directory]::CreateDirectory($directory)|Out-Null;[Environment]::SetEnvironmentVariable($key,$directory,'Process')}
        Invoke-SystemCommit ([string]$arguments[0]) ([string]$arguments[1]) | Out-Null
    }
    default { throw '不支持的系统工具操作' }
}
