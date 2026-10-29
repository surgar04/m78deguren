$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$base=Join-Path $projectRoot 'src-tauri\src\services\tools\windows'
$directory=Join-Path $projectRoot '.cache\verification\optimization-transactions'
[IO.Directory]::CreateDirectory($directory)|Out-Null
# 提取真实函数但不运行入口。所有注册表写入、空键清理适配器均替换为内存实现。
foreach($name in @('storage-policy.ps1','native.ps1','system.ps1','optimizer.ps1')){
    $tokens=$null;$parseErrors=$null
    $tree=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText((Join-Path $base $name)),[ref]$tokens,[ref]$parseErrors)
    if($parseErrors.Count){throw ($parseErrors -join ';')}
    foreach($function in $tree.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){. ([ScriptBlock]::Create($function.Extent.Text))}
}
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $base 'optimizer.cs'))) -Language CSharp
$script:OptimizerCatalog=[IO.File]::ReadAllText((Join-Path $base 'optimizer-catalog.json'))|ConvertFrom-Json
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$script:FakeContext=@{sid=$sid;intelCpu=$true;adapters=@(@{vendor='nvidia';path='HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\9991'},@{vendor='amd';path='HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\9992'},@{vendor='intel';path='HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\9993'})}
function Get-OptimizerContext {return $script:FakeContext}
function Test-OptimizerKeyExists([string]$path){return $true}
function Get-OptimizerMissingKeys([string]$path){return @()}
function Remove-OptimizerEmptyKeys($row){$script:pruned++}
$script:values=@{};$script:writes=0;$script:pruned=0;$script:failPath='';$script:failOnce=$false
function Copy-Value($value){return ConvertFrom-Json -InputObject (ConvertTo-Json -InputObject $value -Depth 12)}
function Read-OptimizerState([string]$path,[string]$name){
    $key=($path+'|'+$name).ToLowerInvariant()
    if(-not $script:values.ContainsKey($key)){$script:values[$key]=@{exists=$true;kind='String';data='original';multi=@()}}
    return Copy-Value $script:values[$key]
}
function Write-OptimizerState($row,$value){
    $key=([string]$row.path+'|'+[string]$row.name).ToLowerInvariant();$script:writes++;$script:values[$key]=Copy-Value $value
    if($script:failOnce -and $key -eq $script:failPath){$script:failOnce=$false;throw '模拟写入后失败'}
}
function Check($condition,[string]$message){if(-not $condition){throw $message}}
function Run-Change($change,[string]$fingerprint=''){
    $plan=Get-SystemPlan $change $directory
    $id=[Guid]::NewGuid().ToString();$path=Join-Path $directory ($id+'.request.json')
    $task=@{id=$id;change=$change;root=$directory;fingerprint=$(if($fingerprint){$fingerprint}else{$plan.fingerprint});domain=$plan.domain;userSid=$plan.userSid}
    Write-AtomicJson $path $task
    return Invoke-SystemCommitCore $path (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
$cases=@()
$all=@($script:OptimizerCatalog.items|ForEach-Object {@{id=$_.id;value=$_.defaultValue}})
Check ($all.Count -eq 201) '目录数量不完整'
$plan=Get-OptimizationPlan $all
Check ($plan.entry.rows.Count -gt 350) '全量计划漏失目标'
Check (-not @($plan.entry.rows|Where-Object {$_.path -match '\\000[01](\\|$)'}).Count) '仍在使用固定显卡编号'
Assert-OptimizerOperation $plan.entry
$receipt=Run-Change @{kind='optimization';selections=$all}
Check ($receipt.state -eq 'completed' -and $receipt.itemIds.Count -eq 201 -and $receipt.domain -eq 'optimization') ('全量内存应用失败：'+$receipt.message)
$restored=Run-Change @{kind='restore';id=$receipt.id}
Check ($restored.state -eq 'completed') ('整批恢复失败：'+$restored.message)
foreach($row in $plan.entry.rows){Check (Test-OptimizerState (Read-OptimizerState $row.path $row.name) $row.before) '原值未完整恢复'}
$cases+='all-201-apply-and-backup-restore'
$cases+='actual-vendor-target-resolution'
$templateRestore=Run-Change @{kind='optimization';selections=@($all|ForEach-Object {@{id=$_.id;value='restore'}})}
Check ($templateRestore.state -eq 'completed') ('全量参考恢复失败：'+$templateRestore.message)
$templateUndo=Run-Change @{kind='restore';id=$templateRestore.id}
Check ($templateUndo.state -eq 'completed') '参考恢复无法撤销'
$cases+='all-201-reference-restore-and-undo'

$script:values=@{};$script:writes=0
$dx='hkey_users\'+$sid+'\software\microsoft\directx\usergpupreferences|directxuserglobalsettings'
$script:values[$dx]=@{exists=$true;kind='String';data='UnrelatedPreference=99;SwapEffectUpgradeEnable=0;';multi=@()}
$combined=Get-OptimizationPlan @(@{id='directXFlipModel';value='apply'},@{id='preferDedicatedGpu';value='apply'})
Check ($combined.entry.rows.Count -eq 1) '共享 DirectX 字符串没有合并'
$after=[string]$combined.entry.rows[0].after.data
Check ($after -match 'UnrelatedPreference=99;' -and $after -match 'SwapEffectUpgradeEnable=1;' -and $after -match 'GpuPreference=2;') 'DirectX 属性互相覆盖或丢失用户偏好'
$cases+='directx-property-merge'

foreach($item in $script:OptimizerCatalog.items){foreach($variant in $item.variants){$one=Get-OptimizationPlan @(@{id=$item.id;value=$variant.value});Assert-OptimizerOperation $one.entry}}
$cases+='all-item-and-select-variant-whitelists'
$tampered=Copy-Value $combined.entry;$tampered.rows[0].path='HKEY_LOCAL_MACHINE\SOFTWARE\Unrelated'
$rejected=$false;try{Assert-OptimizerOperation $tampered}catch{$rejected=$true};Check $rejected '任意注册表目标未拒绝'
$tampered=Copy-Value $combined.entry;$tampered.rows[0].after.data='Injected=1;'
$rejected=$false;try{Assert-OptimizerOperation $tampered}catch{$rejected=$true};Check $rejected '被篡改的目标值未拒绝'
$cases+='target-and-value-tamper-rejection'

$script:values=@{};$script:writes=0
$entry=(Get-OptimizationPlan @(@{id='mmcssGameConfig';value='apply'})).entry
$script:failPath=($entry.rows[0].path+'|'+$entry.rows[0].name).ToLowerInvariant();$script:failOnce=$true
$failed=Run-Change @{kind='optimization';selections=@(@{id='mmcssGameConfig';value='apply'})}
Check ($failed.state -eq 'failed') '写入失败被误报成功'
foreach($row in $entry.rows){Check (Test-OptimizerState (Read-OptimizerState $row.path $row.name) $row.before) '失败后原值未回滚'}
$cases+='post-write-failure-rollback'

$script:values=@{};$script:writes=0
$before=$script:writes;$rejected=$false;try{$null=Run-Change @{kind='optimization';selections=@(@{id='gameMode';value='apply'})} 'stale'}catch{$rejected=$true}
Check ($rejected -and $script:writes -eq $before) '过期指纹仍写入'
$cases+='stale-fingerprint-zero-writes'
$receipt=Run-Change @{kind='optimization';selections=@(@{id='mmcssGameConfig';value='apply'})}
$backup=Get-Content -LiteralPath (Join-Path $directory ($receipt.id+'.backup.json')) -Raw -Encoding UTF8|ConvertFrom-Json
$entry=$backup.operations[0];$row=$entry.rows[0];$key=($row.path+'|'+$row.name).ToLowerInvariant()
$script:values[$key]=@{exists=$true;kind='String';data='third-party-change';multi=@()};$before=$script:writes
$failed=Run-Change @{kind='restore';id=$receipt.id}
Check ($failed.state -eq 'failed' -and $script:writes -eq $before) '恢复预检覆盖了后续修改'
$cases+='restore-whole-batch-preflight'
$script:values[$key]=Copy-Value $row.after;$script:failPath=$key;$script:failOnce=$true
$failed=Run-Change @{kind='restore';id=$receipt.id}
Check ($failed.state -eq 'failed') '恢复失败被误报成功'
foreach($target in $entry.rows){Check (Test-OptimizerState (Read-OptimizerState $target.path $target.name) $target.after) '恢复失败没有回滚恢复动作'}
$cases+='restore-failure-rollback'

# 仅部分值写入的中断会话也可恢复；未写入项保持原值，第三方值始终拒绝覆盖。
foreach($target in $entry.rows){$script:values[($target.path+'|'+$target.name).ToLowerInvariant()]=Copy-Value $target.before}
$script:values[$key]=Copy-Value $row.after
Assert-OptimizerCurrent $entry;Set-OptimizationOperation $entry $true
foreach($target in $entry.rows){Check (Test-OptimizerState (Read-OptimizerState $target.path $target.name) $target.before) '中断恢复不完整'}
$cases+='interrupted-partial-session-recovery'
Write-AtomicJson (Join-Path $directory 'results.json') @{passed=$true;items=201;cases=$cases;actualSystemWrites=$false;checkedAt=[DateTimeOffset]::UtcNow.ToString('o')}
Write-Output ('系统优化 '+$cases.Count+' 项事务验证通过，覆盖 201 项及全部下拉变体；真实系统写入为零。')
