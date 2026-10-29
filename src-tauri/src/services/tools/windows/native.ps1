# __STORAGE_POLICY__
function Initialize-Native {
    if('Zhenjing.Native' -as [type]){return}
    Add-Type -TypeDefinition @'
// __NATIVE_CS__
// __NVIDIA_CS__
// __DRIVER_CS__
// __TELEMETRY_CS__
// __COLOR_CS__
'@ -Language CSharp
}
function Get-FeatureSnapshot([uint32]$store) {
    Initialize-Native
    $data=[Zhenjing.Native]::Features($store)
    $rows=@($data.Rows | ForEach-Object {@{id=[long]$_.Id;priority=[int]($_.Compact -band 15);state=[int](($_.Compact -shr 4) -band 3);wexp=[bool]($_.Compact -band 64);variant=[int](($_.Compact -shr 8) -band 63);payloadKind=[int](($_.Compact -shr 14) -band 3);payload=[long]$_.Payload}})
    if($store -eq 0){
        # API 返回本次启动的快照；合并持久覆盖，避免写入后仍显示旧缓存值。
        $base='Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FeatureManagement\Overrides'
        foreach($priorityKey in @(Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue)){
            $priority=0;if(-not [int]::TryParse($priorityKey.PSChildName,[ref]$priority) -or $priority -lt 0 -or $priority -gt 15){continue}
            foreach($featureKey in @(Get-ChildItem -LiteralPath $priorityKey.PSPath -ErrorAction SilentlyContinue)){
                $encoded=[uint32]0;if(-not [uint32]::TryParse($featureKey.PSChildName,[ref]$encoded)){continue};$id=[Zhenjing.Native]::Deobfuscate($encoded);$override=Get-FeatureOverride $id ([uint32]$priority)
                if(-not $override){continue};$values=@{};foreach($value in $override.values){$values[[string]$value.name]=$value.value}
                $rows=@($rows | Where-Object {-not ($_.id -eq $id -and $_.priority -eq $priority)})
                $rows+=@{id=[long]$id;priority=$priority;state=[int]$values['EnabledState'];variant=[int]$values['Variant'];payloadKind=[int]$values['VariantPayloadKind'];payload=[long]$values['VariantPayload'];wexp=$false;fromOverride=$true}
            }
        }
    }
    return @{store=$store;stamp=$data.Stamp;features=$rows;admin=(Is-Admin)}
}
function Get-DisplaySnapshot {
    Initialize-Native
    return @{monitors=@([Zhenjing.Native]::Monitors() | ForEach-Object {@{id=(Get-StableId $_.Identity);identity=$_.Identity;device=$_.Name;name=$_.Description;primary=$_.Primary;width=[int]$_.Current.Width;height=[int]$_.Current.Height;refresh=[int]$_.Current.Frequency;modes=@($_.Modes | Where-Object {$_.BitsPerPixel -ge 24} | ForEach-Object {@{width=[int]$_.Width;height=[int]$_.Height;refresh=[int]$_.Frequency}})}})}
}
function Get-NvidiaDefinitions([string]$scope) {
    $json=@'
__NVIDIA_SETTINGS__
'@
    return @((ConvertFrom-Json -InputObject $json) | Where-Object {$_.scope -eq $scope})
}
function Get-NvidiaSnapshot([string]$scope) {
    Initialize-Native
    $api=[Zhenjing.Nvidia]::new($scope)
    try {
        $rows=@(foreach($definition in (Get-NvidiaDefinitions $scope)) {
            $id=[Convert]::ToUInt32($definition.id,16);$data=$api.Read($id)
            @{id=[long]$id;label=$definition.label;group=$definition.group;name=$data.Name;current=[long]$data.Current;default=[long]$data.Default;location=[int]$data.Location;predefined=$data.Predefined;supported=$data.Supported;reason=$data.Reason;values=@($data.Values | ForEach-Object {[long]$_})}
        })
        return @{scope=$scope;settings=$rows;admin=(Is-Admin);indicator=(Read-RegistryValue 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\NVIDIA Corporation\Global\NGXCore' 'ShowDlssIndicator')}
    }finally{$api.Dispose()}
}
function Assert-NvidiaOperation($entry) {
    if($entry.scope -notin @('global','delta')){throw '驱动范围无效'}
    $allowed=@(Get-NvidiaDefinitions ([string]$entry.scope) | ForEach-Object {[Convert]::ToUInt32($_.id,16)})
    foreach($item in @($entry.before)+@($entry.after)){if([uint32]$item.id -notin $allowed){throw '驱动配置项不在白名单中'}}
}
function Set-NvidiaOperation($entry,[bool]$restore) {
    Assert-NvidiaOperation $entry;Initialize-Native
    $api=[Zhenjing.Nvidia]::new([string]$entry.scope)
    try {
        $items=if($restore){@($entry.before)}else{@($entry.after)}
        foreach($item in $items){$api.Write([uint32]$item.id,[uint32]$item.value,[bool]$item.reset,$restore)}
        $api.Save()
        # 必须重新创建会话读磁盘，不能把尚未持久化的内存值当作验证结果。
    }finally{$api.Dispose()}
    $api=[Zhenjing.Nvidia]::new([string]$entry.scope)
    try {foreach($item in $items){$actual=$api.Read([uint32]$item.id);if(-not $actual.Supported -or (-not $item.reset -and $actual.Current -ne [uint32]$item.value)){throw '驱动配置回读验证失败'}}}finally{$api.Dispose()}
}
function Get-FeatureOverride([uint32]$id,[uint32]$priority) {
    Initialize-Native
    $path='Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FeatureManagement\Overrides\'+$priority+'\'+[Zhenjing.Native]::Obfuscate($id)
    $key=Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if(-not $key){return $null}
    try {
        if($key.SubKeyCount){throw '功能覆盖包含未知子项'}
        $values=@();foreach($name in $key.GetValueNames()){$kind=[string]$key.GetValueKind($name);$raw=$key.GetValue($name);if($kind -eq 'DWord'){$raw=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$raw),0)};$values+=@{name=$name;kind=$kind;value=$raw}}
        return @{values=@($values | Sort-Object name)}
    }finally{$key.Close()}
}
function Assert-FeatureOperation($entry) {
    if([long]$entry.id -le 0 -or [long]$entry.id -gt [uint32]::MaxValue -or [int]$entry.store -notin @(0,1) -or [int]$entry.priority -notin @(2,4,5,6,7,8,10,11,12,13,14)){throw '功能修改参数无效'}
    foreach($item in @($entry.before)+@($entry.after)){
        if($null -ne $item -and ([int]$item.state -notin @(0,1,2) -or [int]$item.variant -lt 0 -or [int]$item.variant -gt 63 -or [int]$item.payloadKind -notin @(0,1,2,3))){throw '功能状态参数无效'}
    }
    foreach($value in @($entry.bootBefore.values | Where-Object {$null -ne $_})){
        if($value.name -notin @('EnabledState','EnabledStateOptions','Variant','VariantPayload','VariantPayloadKind') -or $value.kind -ne 'DWord' -or [long]$value.value -lt 0 -or [long]$value.value -gt [uint32]::MaxValue){throw '功能备份包含未知或无效注册值'}
    }
}
function Set-FeatureOperation($entry,[bool]$restore) {
    Assert-FeatureOperation $entry;Initialize-Native
    $value=if($restore){$entry.before}else{$entry.after}
    if([int]$entry.store -eq 1){
        $snapshot=Get-FeatureSnapshot 1
        $state=0;$variant=0;$kind=0;$payload=0
        if($value){$state=[uint32]$value.state;$variant=[uint32]$value.variant;$kind=[uint32]$value.payloadKind;$payload=[uint32]$value.payload}
        [Zhenjing.Native]::SetFeature(1,[uint32]$entry.id,[uint32]$entry.priority,$state,$variant,$kind,$payload,($null -eq $value),[string]$snapshot.stamp)
    }else{
        # Boot 持久化需写系统覆盖存储；RtlSetFeatureConfigurations 只负责 Runtime，不能混用。
        $path='Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FeatureManagement\Overrides\'+$entry.priority+'\'+[Zhenjing.Native]::Obfuscate([uint32]$entry.id)
        $data=if($restore){$entry.bootBefore}else{Feature-BootData $value}
        if(Test-Path -LiteralPath $path){$key=Get-Item -LiteralPath $path;try{if($key.SubKeyCount){throw '拒绝递归删除未知功能配置'}}finally{$key.Close()};Remove-Item -LiteralPath $path -ErrorAction Stop}
        if($data){$key=New-Item -Path $path -Force;try{foreach($row in $data.values){$bits=[BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$row.value),0);$key.SetValue([string]$row.name,$bits,[Microsoft.Win32.RegistryValueKind]::DWord)}}finally{$key.Close()}}
        [Zhenjing.Native]::MarkBootPending()
        if((Get-Fingerprint (Get-FeatureOverride ([uint32]$entry.id) ([uint32]$entry.priority))) -ne (Get-Fingerprint $data)){throw 'Boot 功能配置回读验证失败'}
    }
}
function Feature-BootData($value){
    if($null -eq $value){return $null}
    return @{values=@(@{name='EnabledState';kind='DWord';value=$value.state},@{name='EnabledStateOptions';kind='DWord';value=0},@{name='Variant';kind='DWord';value=$value.variant},@{name='VariantPayload';kind='DWord';value=$value.payload},@{name='VariantPayloadKind';kind='DWord';value=$value.payloadKind}) | Sort-Object name}
}
function Get-AudioDriverDevices {
    return @(Get-CimInstance Win32_PnPEntity | Where-Object {$_.Service -eq 'FXVAD' -or @($_.HardwareID) -contains 'ROOT\FXVAD'} | ForEach-Object {@{id=[string]$_.PNPDeviceID;name=[string]$_.Name;status=[string]$_.Status}})
}
function Get-VacService([string]$name) {
    if($name -notin @('Netman','RasMan','TapiSrv','MpsSvc','Steam Client Service')){throw '服务不在 VAC 白名单中'}
    $service=Get-Service -Name $name -ErrorAction Stop
    $path='Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\'+$name
    return @{start=[int](Read-RegistryValue $path 'Start');delayed=(Read-RegistryValue $path 'DelayedAutoStart');running=($service.Status -eq 'Running')}
}
function Set-VacService($entry,[bool]$restore) {
    $current=Get-VacService ([string]$entry.name);$value=if($restore){$entry.before}else{$entry.after}
    if([int]$value.start -notin @(2,3,4) -or ($null -ne $value.delayed -and [int]$value.delayed -notin @(0,1))){throw '服务备份无效'}
    $mode=switch([int]$value.start){2{'Automatic'}3{'Manual'}4{'Disabled'}}
    # 先经 SCM 更改启动类型，再恢复延迟标志；不强制停止其他依赖服务。
    Set-Service -Name $entry.name -StartupType $mode -ErrorAction Stop
    $path='Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\'+$entry.name
    $key=Get-Item -LiteralPath $path;try{if($null -eq $value.delayed){$key.DeleteValue('DelayedAutoStart',$false)}else{$key.SetValue('DelayedAutoStart',[int]$value.delayed,[Microsoft.Win32.RegistryValueKind]::DWord)}}finally{$key.Close()}
    if($value.running){Start-Service -Name $entry.name -ErrorAction Stop}else{Stop-Service -Name $entry.name -ErrorAction Stop}
    if((Get-Fingerprint (Get-VacService $entry.name)) -ne (Get-Fingerprint $value)){throw '服务状态回读验证失败'}
}
function Get-VacBcd {
    $rows=& "$env:SystemRoot\System32\bcdedit.exe" /enum '{current}' 2>&1
    if($LASTEXITCODE -ne 0){throw '无法读取 VAC 启动配置'}
    $result=@{};foreach($name in @('nointegritychecks','loadoptions','nx','debug')){$line=@($rows | Where-Object {[string]$_ -match ('^\s*'+$name+'\s+')}) | Select-Object -First 1;$result[$name]=if($line){([string]$line -replace ('^\s*'+$name+'\s+'),'').Trim()}else{$null}}
    return $result
}
function Set-VacBcd($entry,[bool]$restore){
    if($entry.name -notin @('nointegritychecks','loadoptions','nx','debug')){throw '启动项不在 VAC 白名单中'}
    $value=if($restore){$entry.before}else{$entry.after}
    if($null -eq $value){if($null -ne (Get-VacBcd)[$entry.name]){Invoke-Checked "$env:SystemRoot\System32\bcdedit.exe" @('/deletevalue','{current}',[string]$entry.name)|Out-Null}}
    else{if(([string]$value).Length -gt 256 -or [string]$value -match '[\x00-\x1f]'){throw '启动项值无效'};Invoke-Checked "$env:SystemRoot\System32\bcdedit.exe" @('/set','{current}',[string]$entry.name,[string]$value)|Out-Null}
    if((Get-Fingerprint (Get-VacBcd)[$entry.name]) -ne (Get-Fingerprint $value)){throw '启动项回读验证失败'}
}
function Get-VacFirewall {
    return @(Get-NetFirewallProfile -PolicyStore PersistentStore -ErrorAction Stop | Sort-Object Name | ForEach-Object {@{name=[string]$_.Name;enabled=[int]$_.Enabled}})
}
function Set-VacFirewall($entry,[bool]$restore){
    $rows=if($restore){@($entry.before)}else{@($entry.after)}
    foreach($row in $rows){if($row.name -notin @('Domain','Private','Public') -or [int]$row.enabled -notin @(0,1,2)){throw '防火墙备份无效'};Set-NetFirewallProfile -Name ([string]$row.name) -Enabled ([int]$row.enabled) -PolicyStore PersistentStore -ErrorAction Stop}
    if((Get-Fingerprint (Get-VacFirewall)) -ne (Get-Fingerprint $rows)){throw '防火墙状态回读验证失败'}
}
function Assert-AudioDriverPackage([string]$root) {
    $directory=Join-Path (Split-Path -Parent $root) 'eq-driver'
    $hashes=@{'fxvad.inf'='B7049BFCE3BD60EDE027518785D3087C48F546E0FF082AF634EB9D819C81D273';'fxvad.sys'='425629B6309000013E8CD1A9B827BEE365D21C9F743873AADD0C3BC96A999D2A';'fxvadntamd64.cat'='25C8DAE186155D20F74FEEDEFB4F84161E4215925B8FD0C898F68F3E50EBCD7D'}
    foreach($name in $hashes.Keys){$file=Join-Path $directory $name;if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hashes[$name]){throw '音频驱动包哈希不匹配，请重新准备'};if($name -ne 'fxvad.inf'){$signature=Get-AuthenticodeSignature -LiteralPath $file;if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Windows Hardware Compatibility Publisher'){throw '音频驱动 WHQL 签名无效'}}}
    return $directory
}
function Set-AudioDriverOperation($entry,[bool]$restore,[string]$root) {
    if($entry.type -ne 'audio-driver'){throw '音频驱动操作无效'}
    $directory=Join-Path (Split-Path -Parent $root) 'eq-driver';$guards=@()
    try {
    foreach($name in @('fxvad.inf','fxvad.sys','fxvadntamd64.cat')){$guards+=,[IO.File]::Open((Join-Path $directory $name),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)}
    $directory=Assert-AudioDriverPackage $root;$install=if($restore){[bool]$entry.before}else{[bool]$entry.after}
    $devices=@(Get-AudioDriverDevices)
    if($install){if(-not $devices.Count){Initialize-Native;$reboot=[Zhenjing.AudioDriver]::Install((Join-Path $directory 'fxvad.inf'));if($reboot){Write-Verbose 'Windows 请求重启以完成设备安装'}}}
    else {foreach($device in $devices){if($device.id -notmatch '^ROOT\\(MEDIA|FXVAD)\\[a-fA-F0-9]+$'){throw '音频设备实例不符合预期'};Invoke-Checked "$env:SystemRoot\System32\pnputil.exe" @('/remove-device',[string]$device.id)|Out-Null}}
    $actual=@(Get-AudioDriverDevices)
    if([bool]$actual.Count -ne $install){throw '音频驱动设备回读不符合预期，可能需要重启，请检查 Windows 设备管理器'}
    }finally{foreach($guard in $guards){$guard.Dispose()}}
}
