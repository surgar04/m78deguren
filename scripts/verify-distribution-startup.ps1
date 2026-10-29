# 发行 EXE 的搬迁验收，不生成便携包；全部夹具、模拟用户目录和证据仍位于 D 盘。
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$binary=Join-Path $env:CARGO_TARGET_DIR 'release/zhenjing.exe'
$expected=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw|ConvertFrom-Json).version
if([Diagnostics.FileVersionInfo]::GetVersionInfo($binary).ProductVersion -ne $expected){throw '请先构建当前版本 Release'}
$fixture=Join-Path $projectRoot ('.cache/verification/distribution-machine/独立 电脑-'+[Guid]::NewGuid().ToString('N'))
$install=Join-Path $fixture 'Program Files/臻境';$profile=Join-Path $fixture 'Users/测试 用户'
$local=Join-Path $profile 'AppData/Local';$data=Join-Path $local 'Zhenjing';$temp=Join-Path $local 'Temp'
foreach($folder in @($install,$local,$temp,(Join-Path $profile 'AppData/Roaming'))){[IO.Directory]::CreateDirectory($folder)|Out-Null}
$copy=Join-Path $install 'zhenjing.exe';[IO.File]::Copy($binary,$copy,$false)
$start=[Diagnostics.ProcessStartInfo]::new($copy)
$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$start.WorkingDirectory=$fixture
foreach($key in @($start.EnvironmentVariables.Keys)){
    if($key -match '^(CARGO_|RUSTUP_|PNPM_|NUGET_|DOTNET_|npm_config_)' -or $key -in @('ZHENJING_DATA_DIR','XINJING_DATA_DIR','NODE_PATH','MSBuildSDKsPath','MSBUILD_EXE_PATH','INCLUDE','LIB','LIBPATH','WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')){$start.EnvironmentVariables.Remove($key)}
}
$start.EnvironmentVariables['PATH']=(Join-Path $env:SystemRoot 'System32')+';'+$env:SystemRoot
$start.EnvironmentVariables['USERPROFILE']=$profile
$start.EnvironmentVariables['LOCALAPPDATA']=$local
$start.EnvironmentVariables['APPDATA']=Join-Path $profile 'AppData/Roaming'
$start.EnvironmentVariables['TEMP']=$temp;$start.EnvironmentVariables['TMP']=$temp
$start.EnvironmentVariables['PSModuleAnalysisCachePath']=Join-Path $temp 'ModuleAnalysisCache'
$process=$null;$passed=$false;$message='';$helper=$false;$configPresent=$false;$historyRecorded=$false;$firstRun=$false
function Read-SharedText([string]$path){
    # 日志写入器保持文件打开；验收读取必须显式共享写入与轮转，不能制造 Windows 分享冲突。
    $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$true)
    try{return $reader.ReadToEnd()}finally{$reader.Dispose()}
}
try{
    $process=[Diagnostics.Process]::Start($start)
    Write-Output '已从独立中文/空格目录启动实际 Release；未传 --data-dir，未继承开发 PATH。'
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while($watch.Elapsed.TotalSeconds -lt 90){
        if($process.HasExited){throw ('Release 提前退出：'+$process.ExitCode)}
        $log=Join-Path $data 'logs/zhenjing.log';$config=Join-Path $data 'settings/config.json'
        $helper=[bool]@(Get-ChildItem -LiteralPath (Join-Path $data 'hardware') -Filter 'ZhenjingMonitor.exe' -Recurse -File -ErrorAction SilentlyContinue).Count
        $configPresent=Test-Path -LiteralPath $config
        $historyRecorded=[bool]@(Get-ChildItem -LiteralPath (Join-Path $data 'hardware/history') -Filter '*.jsonl' -File -ErrorAction SilentlyContinue | Where-Object {$_.Length -gt 0}).Count
        $progressFile=Join-Path $data 'onboarding/progress.json'
        if(Test-Path -LiteralPath $progressFile){$progress=[IO.File]::ReadAllText($progressFile)|ConvertFrom-Json;$firstRun=(-not $progress.complete -and $progress.stage -eq 'storage')}
        if((Test-Path -LiteralPath $log) -and (($helper -and $historyRecorded) -or $firstRun)){
            if((Read-SharedText $log).Contains('臻境已启动')){
                # 全新配置采用惰性持久化；不能把“尚未修改偏好”误判为启动失败。
                if($configPresent){
                    $settings=[IO.File]::ReadAllText($config)|ConvertFrom-Json
                    if(-not $settings.confirmActions){throw '全新档案默认二次确认未开启'}
                }
                $passed=$true;break
            }
        }
        Start-Sleep -Milliseconds 500
    }
    if(-not $passed){throw '限定时间内未完成默认档案和内嵌硬件助手启动'}
    Write-Output '默认按用户目录启动验证通过；全新档案进入独立向导，硬件助手由硬件步骤按需启动。无开发工具链依赖。'
}catch{$message=$_.Exception.Message;throw}finally{
    # 只结束本脚本启动的隔离实例；不按进程名结束用户程序。未启用系统控制，助手遵循父进程退出看门狗。
    if($process -and -not $process.HasExited){$process.Kill();$process.WaitForExit()}
    $report=@{passed=$passed;version=$expected;relocatedExecutable=$copy;defaultDataRoot=$data;explicitDataDirectory=$false;developerPathRemoved=$true;developerSdkVariablesRemoved=$true;hardwareHelperExtracted=$helper;hardwareHistoryRecorded=$historyRecorded;configFilePresent=$configPresent;systemChangesExecuted=$false;installerExecuted=$false;message=$message}
    [IO.File]::WriteAllText((Join-Path $projectRoot '.cache/verification/distribution-startup.json'),($report|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
}
