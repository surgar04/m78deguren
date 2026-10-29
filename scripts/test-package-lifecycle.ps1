param([switch]$AllowInstall)
$ErrorActionPreference='Stop'
if(-not $AllowInstall){throw '真实安装测试必须明确传入 -AllowInstall；质量检查不会自动执行此脚本'}
. "$PSScriptRoot\env.ps1"
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw|ConvertFrom-Json).version
$root=Join-Path $projectRoot ('.cache\verification\msi-lifecycle-'+[Guid]::NewGuid().ToString('N'))
$install=Join-Path $root '程序\臻境 MSI';$data=Join-Path $root '用户 数据';$temp=Join-Path $root 'Temp'
$msi=Join-Path $projectRoot ('dist\desktop\zhenjing-'+$version+'-windows-x64.msi')
$msiexec=Join-Path $env:SystemRoot 'System32\msiexec.exe'
$shellKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders',$false)
try{$actualLocal=[string]$shellKey.GetValue('Local AppData');$actualRoaming=[string]$shellKey.GetValue('AppData');$desktop=[string]$shellKey.GetValue('Desktop');$programs=[string]$shellKey.GetValue('Programs')}finally{$shellKey.Dispose()}
$links=@((Join-Path $desktop '臻境.lnk'),(Join-Path $programs '臻境.lnk'))
$steps=[Collections.Generic.List[object]]::new();$owned=[Collections.Generic.List[Diagnostics.Process]]::new()
$product='';$passed=$false;$cleanup=$false;$failure='';$active=$false
function Check($condition,[string]$message){if(-not $condition){throw $message}}
function Wait-Until([scriptblock]$test,[int]$seconds,[string]$message){$watch=[Diagnostics.Stopwatch]::StartNew();while($watch.Elapsed.TotalSeconds -lt $seconds){if(& $test){return};Start-Sleep -Milliseconds 250};throw $message}
function Read-Shared([string]$path){$stream=[IO.File]::Open($path,'Open','Read',([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete));$reader=[IO.StreamReader]::new($stream);try{return $reader.ReadToEnd()}finally{$reader.Dispose()}}
function Process-Info([string]$file,[string]$arguments,[switch]$Installer){
    $info=[Diagnostics.ProcessStartInfo]::new($file,$arguments);$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WindowStyle='Hidden';$info.WorkingDirectory=$root
    foreach($key in @($info.EnvironmentVariables.Keys)){if($key -match '^(CARGO_|RUSTUP_|PNPM_|DOTNET_|NUGET_)' -or $key -in @('INCLUDE','LIB','LIBPATH','NODE_PATH')){$info.EnvironmentVariables.Remove($key)}}
    $info.EnvironmentVariables['PATH']=(Join-Path $env:SystemRoot 'System32')+';'+$env:SystemRoot
    $info.EnvironmentVariables['TEMP']=$temp;$info.EnvironmentVariables['TMP']=$temp
    $info.EnvironmentVariables['ZHENJING_DATA_DIR']=$data;$info.EnvironmentVariables['XINJING_DATA_DIR']=$data
    if($Installer){$info.EnvironmentVariables['LOCALAPPDATA']=$actualLocal;$info.EnvironmentVariables['APPDATA']=$actualRoaming}
    else{$info.EnvironmentVariables['LOCALAPPDATA']=Join-Path $root 'Profile\Local';$info.EnvironmentVariables['APPDATA']=Join-Path $root 'Profile\Roaming';$info.EnvironmentVariables['USERPROFILE']=Join-Path $root 'Profile'}
    return $info
}
function Run-Msi([string]$arguments,[string]$label,[int[]]$Accept=@(0,3010)){
    $process=[Diagnostics.Process]::Start((Process-Info $msiexec $arguments -Installer));$owned.Add($process)
    Wait-Until {$process.HasExited} 180 ($label+' 超时')
    Check ($process.ExitCode -in $Accept) ($label+' 返回 '+$process.ExitCode)
    $steps.Add(@{step=$label;exitCode=$process.ExitCode});Write-Output ($label+' 完成：'+$process.ExitCode)
}
function Test-App([string]$file,[string]$format){
    Check (([Diagnostics.FileVersionInfo]::GetVersionInfo($file).ProductVersion) -eq $version) '已安装 EXE 版本不匹配'
    $start=[DateTime]::UtcNow;$process=[Diagnostics.Process]::Start((Process-Info $file ('--data-dir "'+$data+'"')));$owned.Add($process)
    $log=Join-Path $data 'logs\zhenjing.log'
    Wait-Until {if($process.HasExited){throw '已安装应用提前退出'};return (Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).LastWriteTimeUtc -ge $start.AddSeconds(-1) -and (Read-Shared $log).Contains('已启动')} 90 '已安装应用启动超时'
    $null=$process.CloseMainWindow();Wait-Until {$process.HasExited} 35 '应用未正常退出'
    $steps.Add(@{step='application-start-and-exit';format=$format;version=$version;graceful=$true;developerSdkRemoved=$true})
    Start-Sleep -Seconds 2
}
function Marker-Product {
    $text=[IO.File]::ReadAllText((Join-Path $install 'zhenjing-install.ini'))
    $match=[regex]::Match($text,'(?m)^ProductCode=(\{[A-Fa-f0-9-]{36}\})\s*$')
    Check $match.Success 'MSI 安装标记没有产品 GUID';return $match.Groups[1].Value
}
try{
    foreach($link in $links){Check (-not (Test-Path -LiteralPath $link)) '已有臻境快捷方式，未覆盖'}
    Check (-not (Test-Path 'HKCU:\Software\SurFangTang\Zhenjing')) '已有 MSI 安装，停止验收以免覆盖'
    foreach($path in @($root,$temp,$data,(Join-Path $root 'Profile\Local'),(Join-Path $root 'Profile\Roaming'))){[IO.Directory]::CreateDirectory($path)|Out-Null}
    $active=$true
    [IO.File]::WriteAllText((Join-Path $data 'preserve.txt'),'user-data-must-survive')
    & (Join-Path $PSScriptRoot 'inspect-msi.ps1') -Path $msi -Output (Join-Path $root 'msi-source.json')
    $metadata=Get-Content -LiteralPath (Join-Path $root 'msi-source.json') -Raw|ConvertFrom-Json
    $product=[string]$metadata.properties.ProductCode
    Check ([Guid]::TryParse($product,[ref]([Guid]::Empty))) '源 MSI 的产品 GUID 无效'
    # 失败路径应退出并保留用户文件，不能用安装成功状态掩盖路径保护失效。
    $occupied=Join-Path $root '已有文件';[IO.Directory]::CreateDirectory($occupied)|Out-Null;[IO.File]::WriteAllText((Join-Path $occupied 'keep.txt'),'preserve')
    Run-Msi ('/i "'+$msi+'" /qn /norestart INSTALLDIR="'+$occupied+'" /L*v "'+(Join-Path $root 'reject.log')+'"') 'MSI 拒绝占用目录' @(1603)
    Check ((Read-Shared (Join-Path $occupied 'keep.txt')) -eq 'preserve') '失败安装损坏用户文件'
    Run-Msi ('/i "'+$msi+'" /qn /norestart INSTALLDIR="'+$install+'" /L*v "'+(Join-Path $root 'install.log')+'"') 'MSI 全新安装'
    Check ((Marker-Product) -ieq $product) '安装登记与源 MSI 产品标识不一致'
    foreach($link in $links){Check (Test-Path -LiteralPath $link) 'MSI 缺少快捷方式'}
    Test-App (Join-Path $install 'zhenjing.exe') 'msi'
    [IO.File]::WriteAllText((Join-Path $data 'preserve.txt'),'user-data-must-survive')
    [IO.File]::WriteAllText((Join-Path $install 'user-file.txt'),'user-file-must-survive')
    Run-Msi ('/i "'+$msi+'" /qn /norestart REINSTALL=ALL REINSTALLMODE=vomus /L*v "'+(Join-Path $root 'repair.log')+'"') 'MSI 维护重装'
    Test-App (Join-Path $install 'zhenjing.exe') 'msi'
    Run-Msi ('/x '+$product+' /qn /norestart /L*v "'+(Join-Path $root 'uninstall.log')+'"') 'MSI 卸载'
    $product=''
    Check (-not (Test-Path -LiteralPath (Join-Path $install 'zhenjing.exe'))) '卸载遗留主程序'
    Check (Test-Path -LiteralPath (Join-Path $install 'user-file.txt')) '卸载误删用户文件'
    Check ((Read-Shared (Join-Path $data 'preserve.txt')) -eq 'user-data-must-survive') '卸载误删数据'
    foreach($link in $links){Check (-not (Test-Path -LiteralPath $link)) '卸载遗留快捷方式'}
    $passed=$true
}catch{$failure=$_.Exception.Message;Write-Output ('真实验收失败：'+$failure)}finally{
    if($active){try{
        foreach($process in $owned){if(-not $process.HasExited){$process.Kill();$process.WaitForExit()}}
        if($product){Run-Msi ('/x '+$product+' /qn /norestart') '失败后的 MSI 清理' @(0,1605,3010)}
        Start-Sleep -Seconds 3
        # 先核对绝对路径及每个后代，再逐个删除本次隔离文件与空目录，不递归删除用户路径。
        $absolute=[IO.Path]::GetFullPath($root);Check ($absolute -eq $root -and $root.StartsWith($projectRoot+'\.cache\verification\msi-lifecycle-',[StringComparison]::OrdinalIgnoreCase)) '测试清理范围越界'
        $entries=@(Get-Item -LiteralPath $root -Force)+@(Get-ChildItem -LiteralPath $root -Recurse -Force)
        foreach($entry in $entries){Check (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) '测试清理遇到链接'}
        foreach($entry in $entries|Where-Object {-not $_.PSIsContainer}){
            # WebView2 正常退出后可能短暂持有档案锁；有限重试，不按进程名杀其他浏览器。
            $watch=[Diagnostics.Stopwatch]::StartNew()
            while($true){try{[IO.File]::Delete($entry.FullName);break}catch{if($watch.Elapsed.TotalSeconds -ge 25){throw};Start-Sleep -Milliseconds 300}}
        }
        foreach($entry in $entries|Where-Object {$_.PSIsContainer}|Sort-Object {$_.FullName.Length} -Descending){[IO.Directory]::Delete($entry.FullName,$false)}
        foreach($link in $links){Check (-not (Test-Path -LiteralPath $link)) '测试快捷方式未清理'}
        Check (-not (Test-Path 'HKCU:\Software\SurFangTang\Zhenjing')) 'MSI 登记未清理'
        $cleanup=$true
    }catch{$failure+='；清理失败：'+$_.Exception.Message}}
    $report=@{version=$version;passed=$passed;cleanupPassed=$cleanup;steps=@($steps.ToArray());failure=$failure;testRoot=$root;checkedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    [IO.File]::WriteAllText((Join-Path $projectRoot '.cache\verification\msi-lifecycle.json'),($report|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
    $report|ConvertTo-Json -Depth 7|Write-Output
}
if(-not $passed -or -not $cleanup){exit 1}
