param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
trap { @{failure=[string]$_.Exception.Message}|ConvertTo-Json -Compress|Write-Output; exit 1 }
$parameters=ConvertFrom-Json -InputObject $ArgumentJson
function Read-Login {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Valve\Steam',$false)
    try { return @{autoLogin=$(if($key){$key.GetValue('AutoLoginUser',$null)}else{$null});remember=$(if($key){$key.GetValue('RememberPassword',$null)}else{$null})} }
    finally {if($key){$key.Dispose()}}
}
function Write-Login($key,$value){
    if($null -eq $value.autoLogin){$key.DeleteValue('AutoLoginUser',$false)}else{$key.SetValue('AutoLoginUser',[string]$value.autoLogin,[Microsoft.Win32.RegistryValueKind]::String)}
    if($null -eq $value.remember){$key.DeleteValue('RememberPassword',$false)}else{$key.SetValue('RememberPassword',[int]$value.remember,[Microsoft.Win32.RegistryValueKind]::DWord)}
}
if($Operation -eq 'steam-discover') {
    $paths=[Collections.Generic.List[string]]::new()
    if($parameters.Count -gt 0 -and [string]$parameters[0]){$paths.Add([string]$parameters[0])}
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Valve\Steam',$false)
    if($key){try{$value=$key.GetValue('SteamPath',$null);if($value){$paths.Add([string]$value)}}finally{$key.Dispose()}}
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
        try{$key=$base.OpenSubKey('SOFTWARE\Valve\Steam',$false);if($key){try{$value=$key.GetValue('InstallPath',$null);if($value){$paths.Add([string]$value)}}finally{$key.Dispose()}}}finally{$base.Dispose()}
    }
    $processes=@(Get-Process -Name 'steam' -ErrorAction SilentlyContinue)
    foreach($process in $processes){try{if($process.Path){$paths.Add([IO.Path]::GetDirectoryName($process.Path))}}catch{}}
    # 注册表和运行进程优先；回退从系统目录及实际存在的固定磁盘推导，不假定 C/D 盘布局。
    $programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
    if($programFiles){$paths.Add((Join-Path $programFiles 'Steam'))}
    foreach($drive in [IO.DriveInfo]::GetDrives()){
        if($drive.IsReady -and $drive.DriveType -eq [IO.DriveType]::Fixed){
            $paths.Add((Join-Path $drive.RootDirectory.FullName 'Steam'))
            $paths.Add((Join-Path $drive.RootDirectory.FullName 'Program Files (x86)/Steam'))
            $paths.Add((Join-Path $drive.RootDirectory.FullName 'Program Files/Steam'))
        }
    }
    $path=$null
    foreach($candidate in $paths){if([IO.Path]::IsPathRooted($candidate) -and (Test-Path -LiteralPath (Join-Path $candidate 'steam.exe') -PathType Leaf)){$path=[IO.Path]::GetFullPath($candidate);break}}
    if(-not $path){
        # 注册表、进程和常见目录均未命中后做有界广度扫描；跳过系统/游戏内容及重解析点。
        # 不能无限递归整盘导致首次启动卡死，超出边界仍提供原生目录选择器。
        $queue=[Collections.Generic.Queue[object]]::new();$watch=[Diagnostics.Stopwatch]::StartNew();$visited=0
        foreach($drive in [IO.DriveInfo]::GetDrives()){if($drive.IsReady -and $drive.DriveType -eq [IO.DriveType]::Fixed){$queue.Enqueue(@{path=$drive.RootDirectory.FullName;depth=0})}}
        while($queue.Count -gt 0 -and $watch.Elapsed.TotalSeconds -lt 20 -and $visited -lt 40000 -and -not $path){
            $entry=$queue.Dequeue();$visited++
            if(Test-Path -LiteralPath (Join-Path $entry.path 'steam.exe') -PathType Leaf){$path=[IO.Path]::GetFullPath($entry.path);break}
            if($entry.depth -ge 5){continue}
            foreach($folder in Get-ChildItem -LiteralPath $entry.path -Directory -Force -ErrorAction SilentlyContinue){
                if($folder.Name -in @('Windows','Recovery','System Volume Information','$Recycle.Bin','node_modules','.git','steamapps','WindowsApps') -or ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)){continue}
                $queue.Enqueue(@{path=$folder.FullName;depth=($entry.depth+1)})
            }
        }
    }
    $active=$null;$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Valve\Steam\ActiveProcess',$false)
    if($key){try{$value=$key.GetValue('ActiveUser',$null);if($null -ne $value){$unsigned=[uint32]([long]$value -band 0xffffffffL);if($unsigned -gt 0){$active=$unsigned}}}finally{$key.Dispose()}}
    $disks=@();try{$disks=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {@{drive=[string]$_.DeviceID;total=[uint64]$_.Size;free=[uint64]$_.FreeSpace}})}catch{}
    @{path=$path;running=($processes.Count -gt 0);activeId=$active;disks=$disks;registry=(Read-Login)} | ConvertTo-Json -Depth 8 -Compress
} elseif($Operation -eq 'steam-registry') {
    $request=[string]$parameters[0]|ConvertFrom-Json
    $current=Read-Login
    if($current.autoLogin -cne $request.expected.autoLogin -or $current.remember -ne $request.expected.remember){throw 'Steam 注册表配置已变化，请刷新后重试'}
    $name=$request.desired.autoLogin
    if($null -ne $name -and ([string]$name).Length -gt 128){throw 'Steam 账号名称无效'}
    if($null -ne $request.desired.remember -and $request.desired.remember -notin @(0,1)){throw 'Steam 登录偏好无效'}
    $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Valve\Steam',$true)
    try{
        try{Write-Login $key $request.desired}catch{$failure=$_.Exception.Message;try{Write-Login $key $current}catch{throw 'Steam 注册表提交与恢复均失败，请使用操作备份检查登录设置'};throw $failure}
    }finally{$key.Dispose()}
    @{ok=$true}|ConvertTo-Json -Compress
} else {throw '不支持的 Steam 平台操作'}
