# 发布路径与维护重启环境的隔离验收：仅在 D 盘写证据，不运行应用/安装器或修改注册表。
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$base=Join-Path $projectRoot 'src-tauri/src/services/tools/windows'
. ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $base 'storage-policy.ps1'))))
function Check($condition,[string]$message){if(-not $condition){throw $message}}
$restriction=$env:ZHENJING_RESTRICT_WRITES_TO_D
try{
    $env:ZHENJING_RESTRICT_WRITES_TO_D=$null
    foreach($path in @('C:\Users\发布验收\AppData\Local\Zhenjing','E:\Games\臻境')){Check (Test-LocalPath $path) ('发布路径被错误拒绝：'+$path)}
    foreach($path in @('E:relative','C:\','\\server\share\data','E:\data\..\Windows','E:\data:stream','E:\NUL.txt')){Check (-not (Test-LocalPath $path)) ('危险路径被错误接受：'+$path)}
    $env:ZHENJING_RESTRICT_WRITES_TO_D='1'
    Check (-not (Test-LocalPath 'C:\Users\发布验收\AppData\Local\Zhenjing')) '开发约束失效'
}finally{$env:ZHENJING_RESTRICT_WRITES_TO_D=$restriction}

# 编译真实 C# 助手，仅反射调用路径验证；不调用 Run、键盘钩子或进程调整。
Add-Type -Path (Join-Path $projectRoot 'src-tauri/resources/windows-bridge/Zhenjing.Windows.dll')
$validator=[Zhenjing.Home.Native].GetMethod('AssertLocal',([Reflection.BindingFlags]::Static -bor [Reflection.BindingFlags]::NonPublic))
Check ($null -ne $validator) '原生路径验证函数缺失'
try{
    $env:ZHENJING_RESTRICT_WRITES_TO_D=$null
    foreach($path in @('C:\Users\发布验收\AppData\Local\Zhenjing\home\recovery.json','E:\用户 数据\Zhenjing\home\recovery.json')){$null=$validator.Invoke($null,@($path))}
    $env:ZHENJING_RESTRICT_WRITES_TO_D='1';$denied=$false
    try{$null=$validator.Invoke($null,@('C:\Users\发布验收\AppData\Local\Zhenjing\home\recovery.json'))}catch{$denied=$true}
    Check $denied 'C# 开发写入约束失效'
}finally{$env:ZHENJING_RESTRICT_WRITES_TO_D=$restriction}

# 只抽取真实重启函数；Start-Process 用内存适配器替代，不启动任何程序。
$tokens=$null;$errors=$null
$text=[IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/settings/maintenance.ps1'))
$tree=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
Check ($errors.Count -eq 0) '维护脚本语法错误'
$launch=@($tree.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Launch-App'},$false))
Check ($launch.Count -eq 1) '重启函数不唯一'
. ([ScriptBlock]::Create($launch[0].Extent.Text))
$keys=@('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE');$original=@{}
foreach($name in $keys){$original[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$plan=@{ticket=[Guid]::NewGuid().ToString();launchEnvironment=@{TEMP='E:\缓存\Temp';TMP='E:\缓存\Temp';APPDATA='E:\用户\小明\AppData\Roaming';LOCALAPPDATA='E:\用户\小明\AppData\Local';USERPROFILE='E:\用户\小明'}}
$exe=Join-Path $projectRoot '.cache/verification/not-executed.exe';$data=Join-Path $projectRoot '.cache/verification/not-created-data'
function Start-Process {
    param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru)
    $script:observed=@{}
    foreach($name in $keys){$script:observed[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
    return @{mock=$true}
}
try{
    $env:ZHENJING_RESTRICT_WRITES_TO_D=$null
    $null=Launch-App $false
    foreach($name in $keys){
        Check ($script:observed[$name] -ceq $plan.launchEnvironment[$name]) ('应用没有继承原用户环境：'+$name)
        Check ([Environment]::GetEnvironmentVariable($name,'Process') -ceq $original[$name]) ('助手环境没有恢复：'+$name)
    }
}finally{
    foreach($name in $keys){[Environment]::SetEnvironmentVariable($name,$original[$name],'Process')}
    $env:ZHENJING_RESTRICT_WRITES_TO_D=$restriction
}
$evidence=Join-Path $projectRoot '.cache/verification/distribution-native.json'
[IO.File]::WriteAllText($evidence,(@{releasePaths=$true;csharpPaths=$true;unsafePathsRejected=$true;developmentRestriction=$true;relaunchEnvironment=$true;processStarted=$false;registryModified=$false}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Output '发布路径、开发隔离和维护重启环境验证通过；未执行安装或系统修改。'
