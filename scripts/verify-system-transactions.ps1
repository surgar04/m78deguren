$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$destination=Join-Path $projectRoot '.cache\verification\system-transactions'
[IO.Directory]::CreateDirectory($destination)|Out-Null
# 只提取函数定义；不执行脚本入口。系统写入适配器被内存实现替代，验收不修改真实系统。
foreach($name in @('storage-policy.ps1','native.ps1','system.ps1')){
    $path=Join-Path $projectRoot ('src-tauri\src\services\tools\windows\'+$name)
    $tokens=$null;$parseErrors=$null
    $tree=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($path),[ref]$tokens,[ref]$parseErrors)
    if($parseErrors.Count){throw ($parseErrors -join ';')}
    foreach($function in $tree.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){
        . ([ScriptBlock]::Create($function.Extent.Text))
    }
}
function Check($condition,[string]$message){if(-not $condition){throw $message}}
# 白名单和空备份边界使用真实校验逻辑。
$rejected=$false;try{Assert-RegistryOperation @{path='Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Unrelated';name='Start'} 'gpu-rename'}catch{$rejected=$true};Check $rejected '跨领域注册表写入未被拒绝'
Assert-FeatureOperation @{id=1;store=0;priority=8;before=$null;after=@{state=2;variant=0;payloadKind=0;payload=0};bootBefore=$null}
$script:values=@{};$script:writes=0;$script:failName='';$script:failRestore=$false
function Read-RegistryValue([string]$path,[string]$name){return $script:values[$name]}
function Set-RegOperation($entry,[bool]$restore){$script:writes++;$script:values[$entry.name]=$(if($restore){$entry.before}else{$entry.after});if($entry.name -eq $script:failName -and $restore -eq $script:failRestore){throw '预期的写入后验证失败'}}
function Get-SystemPlan($change,[string]$root){return $script:plan}
function Run-Case([string]$kind,[string]$fingerprint='expected'){
    $id=[Guid]::NewGuid().ToString();$task=@{id=$id;change=@{kind=$kind;id=$script:originalId};root=$destination;fingerprint=$fingerprint}
    $request=Join-Path $destination ($id+'.request.json');Write-AtomicJson $request $task
    return Invoke-SystemCommit $request (Get-FileHash -LiteralPath $request -Algorithm SHA256).Hash
}
$entries=@(@{type='registry';path='test';name='a';before=1;after=2},@{type='registry';path='test';name='b';before=1;after=2})
$script:plan=@{fingerprint='expected';preview=@{title='事务测试';restartRequired=$false;reversible=$true};operations=$entries;target=$null}
$script:values=@{a=1;b=1};$script:failName='b';$script:failRestore=$false
$receipt=Run-Case 'test';Check ($receipt.state -eq 'failed' -and $script:values.a -eq 1 -and $script:values.b -eq 1) '写入后失败未恢复全部原值'
$script:writes=0;$rejected=$false;try{$null=Run-Case 'test' 'stale'}catch{$rejected=$true};Check ($rejected -and $script:writes -eq 0) '过期状态仍执行写入'
$script:originalId=[Guid]::NewGuid().ToString();Write-AtomicJson (Join-Path $destination ($script:originalId+'.receipt.json')) @{reversible=$true}
$script:plan=@{fingerprint='expected';preview=@{title='恢复测试';restartRequired=$false;reversible=$false};operations=@();target=@{operations=$entries}}
$script:values=@{a=2;b=9};$script:writes=0;$script:failName=''
$receipt=Run-Case 'restore';Check ($receipt.state -eq 'failed' -and $script:writes -eq 0 -and $script:values.b -eq 9) '恢复预检没有保护后续修改'
$script:values=@{a=2;b=2};$script:writes=0;$script:failName='a';$script:failRestore=$true
$receipt=Run-Case 'restore';Check ($receipt.state -eq 'failed' -and $script:values.a -eq 2 -and $script:values.b -eq 2) '恢复过程中失败未回滚恢复动作'
$script:failName='';$receipt=Run-Case 'restore';Check ($receipt.state -eq 'completed' -and $script:values.a -eq 1 -and $script:values.b -eq 1) '恢复成功路径失败'
Write-AtomicJson (Join-Path $destination 'results.json') @{passed=$true;cases=@('domain-whitelist','empty-feature-backup','apply-failure-rollback','stale-fingerprint','restore-preflight','restore-failure-rollback','successful-restore');actualSystemWrites=$false}
Write-Output '系统事务 7 项验证通过；真实系统写入为零。'
