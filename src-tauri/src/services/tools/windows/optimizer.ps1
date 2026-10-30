# 优化目录位于受保护脚本；注册表适配器由安装目录中的已验证 DLL 提供。
# __MANAGED_BRIDGE__
function Initialize-Optimizer {
    if(-not ('Zhenjing.OptimizationRegistry' -as [type])){Initialize-ZhenjingManaged}
    if(-not $script:OptimizerCatalog){$script:OptimizerCatalog=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__OPTIMIZER_CATALOG_BASE64__'))|ConvertFrom-Json}
    if(-not $script:OptimizerItems){
        $script:OptimizerItems=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
        foreach($item in $script:OptimizerCatalog.items){$script:OptimizerItems.Add([string]$item.id,$item)}
    }
}
function Get-OptimizerItem([string]$id) {
    Initialize-Optimizer
    if(-not $script:OptimizerItems.ContainsKey($id)){throw '优化项不在内置目录中'}
    return $script:OptimizerItems[$id]
}
function Get-OptimizerContext {
    # 提权进程可能属于另一管理员；HKCU 必须使用受保护任务传入的原始用户 SID。
    # 显卡实例的 Driver 属性是权威映射，不能假定显示类的 0000 就是目标厂商。
    Initialize-Optimizer
    if($script:OptimizerContext){return $script:OptimizerContext}
    $sid=if($script:OptimizationSid){[string]$script:OptimizationSid}else{[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}
    if($sid -notmatch '^S-1-(5-21|12-1)-[0-9-]+$'){throw '不能确认原始用户的注册表范围'}
    $adapters=@()
    foreach($gpu in @(Get-Gpus)){
        $vendor=if($gpu.instance -match 'VEN_10DE'){'nvidia'}elseif($gpu.instance -match 'VEN_1002'){'amd'}elseif($gpu.instance -match 'VEN_8086'){'intel'}else{''}
        $driver=Read-RegistryValue ('Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\'+$gpu.instance) 'Driver'
        if($vendor -and $driver -match '^\{4d36e968-e325-11ce-bfc1-08002be10318\}\\\d{4}$'){$adapters+=@{vendor=$vendor;path=('HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\'+$driver);name=$gpu.name}}
    }
    $cpu=@(Get-CimInstance Win32_Processor -ErrorAction Stop|Select-Object -ExpandProperty Manufacturer)
    $script:OptimizerContext=@{sid=$sid;adapters=$adapters;intelCpu=[bool]@($cpu|Where-Object {$_ -match 'Intel'}).Count}
    return $script:OptimizerContext
}
function Read-OptimizerState([string]$path,[string]$name) {
    $data=[Zhenjing.OptimizationRegistry]::Read($path,$name)
    return @{exists=[bool]$data['exists'];kind=$data['kind'];data=$data['data'];multi=@($data['multi'])}
}
function Test-OptimizerKeyExists([string]$path) {return [Zhenjing.OptimizationRegistry]::KeyExists($path)}
function Get-OptimizerMissingKeys([string]$path) {return @([Zhenjing.OptimizationRegistry]::Missing($path))}
function Test-OptimizerState($first,$second) {
    if([bool]$first.exists -ne [bool]$second.exists){return $false}
    if(-not $first.exists){return $true}
    return $first.kind -ceq $second.kind -and $first.data -ceq $second.data -and (Get-Fingerprint @($first.multi)) -eq (Get-Fingerprint @($second.multi))
}
function Get-OptimizerDefinitions($item,[string]$value) {
    # 将静态模板解析为当前设备可用目标；缺少服务不创建新服务，缺少厂商不写其他显卡。
    $context=Get-OptimizerContext;$skipped=@();$result=@();$seen=@{}
    if($item.vendor -and -not @($context.adapters|Where-Object {$_.vendor -eq $item.vendor}).Count){return @{operations=@();skipped=@('未检测到对应厂商的实际显卡')}}
    if($item.cpuVendor -eq 'intel' -and -not $context.intelCpu){return @{operations=@();skipped=@('本机不是 Intel 处理器')}}
    if($value -ceq 'restore'){$definitions=@($item.restore.operations)}
    else{$variant=@($item.variants|Where-Object {$_.value -ceq $value});if($variant.Count -ne 1){throw '优化目标值不在白名单中'};$definitions=@($variant[0].operations)}
    foreach($definition in $definitions){
        $paths=@([string]$definition.path)
        if($definition.path -match '^HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\\{4d36e968-e325-11ce-bfc1-08002be10318\}\\000[01](.*)$'){
            $suffix=$Matches[1];$paths=@($context.adapters|Where-Object {$_.vendor -eq $item.vendor}|ForEach-Object {$_.path+$suffix})
        }
        foreach($originalPath in $paths){
            $path=$originalPath.Replace('HKEY_CURRENT_USER\',('HKEY_USERS\'+$context.sid+'\'))
            if($path -match '^HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\([^\\]+)'){
                $service='HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\'+$Matches[1]
                if(-not (Test-OptimizerKeyExists $service)){$skipped+=('服务未安装：'+$Matches[1]);continue}
            }
            $key=($path+'|'+[string]$definition.name).ToLowerInvariant()
            $operation=@{path=$path;name=[string]$definition.name;kind=[string]$definition.kind;value=$definition.value;mode=[string]$definition.mode;itemId=[string]$item.id}
            if($seen.ContainsKey($key)){
                if((Get-Fingerprint $seen[$key]) -ne (Get-Fingerprint $operation)){throw '显卡模板存在相互冲突的目标，请检查配置目录'}
                continue
            }
            $seen[$key]=$operation;$result+=,$operation
        }
    }
    return @{operations=$result;skipped=@($skipped|Select-Object -Unique)}
}
function Get-OptimizerProperties([string]$text) {
    $result=@{};foreach($part in $text.Split(';')){if($part -match '^\s*([A-Za-z][A-Za-z0-9]{0,63})\s*=(.*?)\s*$'){$result[$Matches[1]]=$Matches[2]}}
    return $result
}
function Get-OptimizerMapKeys($item) {
    $keys=@();foreach($variant in $item.variants){foreach($operation in $variant.operations){if($operation.mode -eq 'string-map'){$keys+=@((Get-OptimizerProperties ([string]$operation.value)).Keys)}}};return @($keys|Select-Object -Unique)
}
function Get-OptimizerDesired($operation,$current) {
    # DirectX 两项共用一个字符串值，修改所属字段而非覆盖整串；完整原串仍进入备份。
    if($operation.mode -eq 'string-map'){
        $original=if($current.exists -and $current.kind -eq 'String'){[string]$current.data}else{''}
        $remove=if($null -eq $operation.value){@(Get-OptimizerMapKeys (Get-OptimizerItem $operation.itemId))}else{@()}
        $data=[Zhenjing.OptimizationRegistry]::Patch($original,[string]$operation.value,[string[]]$remove)
        return @{exists=($data.Length -gt 0);kind=$(if($data.Length){'String'}else{$null});data=$(if($data.Length){$data}else{$null});multi=@()}
    }
    return @{exists=($null -ne $operation.value);kind=$(if($null -ne $operation.value){$operation.kind}else{$null});data=$operation.value;multi=@()}
}
function Test-OptimizerMatch($operation,$current) {
    if($operation.mode -ne 'string-map'){return Test-OptimizerState $current (Get-OptimizerDesired $operation $current)}
    $properties=if($current.exists -and $current.kind -eq 'String'){Get-OptimizerProperties ([string]$current.data)}else{@{}}
    if($null -eq $operation.value){foreach($key in @(Get-OptimizerMapKeys (Get-OptimizerItem $operation.itemId))){if($properties.ContainsKey($key)){return $false}};return $true}
    if(-not $current.exists -or $current.kind -ne 'String'){return $false}
    $expected=Get-OptimizerProperties ([string]$operation.value)
    foreach($key in @($expected.Keys)){if(-not $properties.ContainsKey($key) -or $properties[$key] -cne $expected[$key]){return $false}}
    return $true
}
function Get-OptimizationSnapshot {
    # 同次扫描缓存相同目标的读数；每项独立捕获错误，不能把读取失败当成未设置。
    Initialize-Optimizer;$context=Get-OptimizerContext;$cache=@{};$rows=@()
    foreach($item in $script:OptimizerCatalog.items){
        try{
            $checks=@();$matched=@();$partial=$false;$skipped=@()
            foreach($variant in $item.variants){
                $resolved=Get-OptimizerDefinitions $item $variant.value;$skipped=@($resolved.skipped);$matches=0
                foreach($operation in $resolved.operations){
                    $key=($operation.path+'|'+$operation.name).ToLowerInvariant()
                    if(-not $cache.ContainsKey($key)){$cache[$key]=Read-OptimizerState $operation.path $operation.name}
                    $actual=$cache[$key];$match=Test-OptimizerMatch $operation $actual
                    if($match){$matches++}else{$partial=$partial -or $matches -gt 0}
                    if($variant.value -ceq $item.defaultValue){$checks+=@{path=$operation.path;name=$operation.name;current=$actual;target=(Get-OptimizerDesired $operation $actual);matches=$match}}
                }
                if($resolved.operations.Count -gt 0 -and $matches -eq $resolved.operations.Count){$matched+=,[string]$variant.value}
                if($matches -gt 0 -and $matches -lt $resolved.operations.Count){$partial=$true}
            }
            $baseline=Get-OptimizerDefinitions $item 'restore';$baselineMatches=$baseline.operations.Count -gt 0
            foreach($operation in $baseline.operations){$key=($operation.path+'|'+$operation.name).ToLowerInvariant();if(-not $cache.ContainsKey($key)){$cache[$key]=Read-OptimizerState $operation.path $operation.name};if(-not (Test-OptimizerMatch $operation $cache[$key])){$baselineMatches=$false}}
            $state=if(-not $checks.Count){'unsupported'}elseif($matched.Count){'configured'}elseif($baselineMatches){'baseline'}elseif($partial){'partial'}else{'custom'}
            $rows+=@{id=$item.id;state=$state;selectedValue=$(if($matched.Count){$matched[0]}else{$null});checks=$checks;skipped=$skipped;error=$null}
        }catch{$rows+=@{id=$item.id;state='error';selectedValue=$null;checks=@();skipped=@();error=[string]$_.Exception.Message}}
    }
    $build=Read-RegistryValue 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion' 'CurrentBuildNumber'
    return @{checkedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();osBuild=[string]$build;admin=(Is-Admin);rows=$rows}
}
function Get-OptimizationPlan($selections) {
    # 先合并、核对整批目标，再剔除无变化值。这里只构建计划，不产生系统写入。
    # missingKeys 记录原本不存在的祖先键，撤销时仅在其仍为空时清理。
    $context=Get-OptimizerContext;$rows=@{};$summary=@();$ids=@{}
    if(@($selections).Count -lt 1 -or @($selections).Count -gt 201){throw '一次只能选择 1–201 项配置'}
    foreach($selection in $selections){
        $item=Get-OptimizerItem ([string]$selection.id)
        if($ids.ContainsKey([string]$item.id)){throw '优化项重复'};$ids[$item.id]=$true
        $resolved=Get-OptimizerDefinitions $item ([string]$selection.value)
        if(-not $resolved.operations.Count){throw ($item.name+'：当前设备没有可应用目标；请重新扫描并移除此项')}
        $label=if($selection.value -ceq 'restore'){'恢复参考预设'}else{@($item.variants|Where-Object {$_.value -ceq $selection.value})[0].label}
        $summary+=($item.name+' → '+$label+'（'+$item.risk+'）')
        foreach($operation in $resolved.operations){
            $key=($operation.path+'|'+$operation.name).ToLowerInvariant()
            if(-not $rows.ContainsKey($key)){
                $actual=Read-OptimizerState $operation.path $operation.name
                $rows[$key]=@{path=$operation.path;name=$operation.name;before=$actual;after=$actual;missingKeys=@(Get-OptimizerMissingKeys $operation.path);owners=@();map=($operation.mode -eq 'string-map')}
            }
            $row=$rows[$key];$desired=Get-OptimizerDesired $operation $row.after
            if($row.owners.Count -and -not $row.map -and -not (Test-OptimizerState $row.after $desired)){throw ('所选配置相互冲突：'+($row.owners -join '、')+' 与 '+$item.id+'，请移除其中一项')}
            $row.after=$desired;$row.owners+=,[string]$item.id
        }
        if($resolved.skipped.Count){$summary+=('跳过不存在的目标：'+($resolved.skipped -join '、'))}
    }
    $changed=@($rows.Values|Where-Object {-not (Test-OptimizerState $_.before $_.after)}|Sort-Object path,name)
    if(-not $changed.Count){throw '所选配置已匹配目标，无需重复写入'}
    $entry=@{type='optimizer-batch';version=1;userSid=$context.sid;selections=@($selections);rows=$changed}
    return @{entry=$entry;summary=$summary;count=@($selections).Count}
}
function Assert-OptimizerState($value) {
    if(-not $value.exists){return}
    if($value.kind -notin @('String','ExpandString','DWord','QWord','Binary','None','MultiString')){throw '备份类型无效'}
    if(([string]$value.data).Length -gt 1398104 -or @($value.multi).Count -gt 4096){throw '备份值过大'}
    switch([string]$value.kind){'DWord'{$null=[uint32]::Parse([string]$value.data)}'QWord'{$null=[uint64]::Parse([string]$value.data)}'Binary'{$null=[Convert]::FromBase64String([string]$value.data)}'None'{$null=[Convert]::FromBase64String([string]$value.data)}}
}
function Assert-OptimizerOperation($entry) {
    # 备份是恢复输入而非可信命令：重新解析当前编译期目录，逐值推导并核对目标。
    # 不接受备份携带的任意路径、额外键或修改过的目标值。
    if($entry.version -ne 1 -or $entry.userSid -cne (Get-OptimizerContext).sid -or @($entry.rows).Count -lt 1 -or @($entry.rows).Count -gt 1024){throw '优化备份范围无效'}
    $allowed=@{};$seenIds=@{}
    foreach($selection in @($entry.selections)){
        $item=Get-OptimizerItem ([string]$selection.id);if($seenIds.ContainsKey($item.id)){throw '备份包含重复项目'};$seenIds[$item.id]=$true
        foreach($operation in (Get-OptimizerDefinitions $item ([string]$selection.value)).operations){$key=($operation.path+'|'+$operation.name).ToLowerInvariant();if(-not $allowed.ContainsKey($key)){$allowed[$key]=@()};$allowed[$key]+=,$operation}
    }
    $seen=@{}
    foreach($row in @($entry.rows)){
        $key=([string]$row.path+'|'+[string]$row.name).ToLowerInvariant()
        if(-not $allowed.ContainsKey($key) -or $seen.ContainsKey($key)){throw '备份包含目录外目标或重复目标'};$seen[$key]=$true
        Assert-OptimizerState $row.before;Assert-OptimizerState $row.after
        $expected=$row.before;foreach($operation in $allowed[$key]){$expected=Get-OptimizerDesired $operation $expected}
        if(-not (Test-OptimizerState $expected $row.after)){throw '备份中的目标值与内置配置不符'}
        if(@($row.missingKeys).Count -gt 64){throw '备份空键范围过大'}
        foreach($path in @($row.missingKeys)){if(-not ([string]$row.path).Equals([string]$path,[StringComparison]::OrdinalIgnoreCase) -and -not ([string]$row.path).StartsWith(([string]$path+'\'),[StringComparison]::OrdinalIgnoreCase)){throw '空键清理越界'}}
    }
}
function Assert-OptimizerCurrent($entry) {
    Assert-OptimizerOperation $entry
    # 支持进程意外终止后的部分执行恢复；只允许“原值”或“本次目标值”，第三种值整批拒绝。
    foreach($row in $entry.rows){$actual=Read-OptimizerState $row.path $row.name;if(-not (Test-OptimizerState $actual $row.after) -and -not (Test-OptimizerState $actual $row.before)){throw ('配置已被其他操作改变，未覆盖：'+$row.path+' / '+$row.name)}}
}
function Write-OptimizerState($row,$state) {
    [Zhenjing.OptimizationRegistry]::Write([string]$row.path,[string]$row.name,[bool]$state.exists,[string]$state.kind,[string]$state.data,[string[]]@($state.multi))
    if(-not (Test-OptimizerState (Read-OptimizerState $row.path $row.name) $state)){throw '优化写入回读验证失败'}
}
function Remove-OptimizerEmptyKeys($row) {[Zhenjing.OptimizationRegistry]::Prune([string]$row.path,[string[]]@($row.missingKeys))}
function Set-OptimizationOperation($entry,[bool]$restore) {
    # 正向执行采用 compare-before/write/readback；恢复逆序进行并收集所有失败。
    # 外层事务负责失败补偿及真实回执；这里绝不吞掉错误或报告虚假成功。
    Assert-OptimizerOperation $entry
    $rows=@($entry.rows);if($restore){[array]::Reverse($rows)}
    $failures=@()
    foreach($row in $rows){
        try{
            $actual=Read-OptimizerState $row.path $row.name
            $expected=if($restore){$row.after}else{$row.before};$desired=if($restore){$row.before}else{$row.after}
            if(Test-OptimizerState $actual $desired){if($restore){Remove-OptimizerEmptyKeys $row};continue}
            if(-not (Test-OptimizerState $actual $expected)){throw '配置在执行期间发生变化，拒绝覆盖'}
            Write-OptimizerState $row $desired
            if($restore){Remove-OptimizerEmptyKeys $row}
        }catch{if(-not $restore){throw};$failures+=($_.Exception.Message+'：'+$row.path+' / '+$row.name)}
    }
    if($failures.Count){throw ($failures -join '；')}
}
