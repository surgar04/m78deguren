param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]',[string]$TaskBase64='')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
trap { @{failure=[string]$_.Exception.Message}|ConvertTo-Json -Compress|Write-Output; exit 1 }
$parameters=ConvertFrom-Json -InputObject $ArgumentJson
$inputValue=if($TaskBase64){[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TaskBase64))|ConvertFrom-Json}elseif($parameters.Count){[string]$parameters[0]|ConvertFrom-Json}else{$null}
$runKey='Software\Microsoft\Windows\CurrentVersion\Run'
# 保留既有启动项的技术标识；用户确认修复时更新 EXE 路径，避免留下两个开机启动项。
$runName='XinjingDesktop'
$pawnHash='1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'
function Out-Json($value){ConvertTo-Json -InputObject $value -Depth 12 -Compress|Write-Output}
# __STORAGE_POLICY__
function Pawn-Status {
    $version=$null;$installed=$false;$errorText=$null
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
        $root=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
        try{
            $key=$root.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO',$false)
            if($key){try{$value=$key.GetValue('DisplayVersion',$null);if($value){$version=[string]$value;$installed=$true}}finally{$key.Dispose()}}
        }catch{$errorText=[string]$_.Exception.Message}finally{$root.Dispose()}
    }
    $service=Get-Service -Name 'PawnIO' -ErrorAction SilentlyContinue
    return @{installed=($installed -or $null -ne $service);version=$version;service=$(if($service){[string]$service.Status}else{'not-installed'});error=$errorText}
}
function Read-Run {
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($runKey,$false)
    if(-not $key){return @{exists=$false;kind=$null;value=$null}}
    try {
        if($key.GetValueNames() -notcontains $runName){return @{exists=$false;kind=$null;value=$null}}
        $kind=[string]$key.GetValueKind($runName)
        $value=$key.GetValue($runName,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if($kind -notin @('String','ExpandString')){throw '同名启动项类型异常，未覆盖'}
        return @{exists=$true;kind=$kind;value=[string]$value}
    }finally{$key.Dispose()}
}
function Desired-Run($request){
    $exe=Assert-LocalPath ([string]$request.exe);$data=Assert-LocalPath ([string]$request.dataRoot)
    if([IO.Path]::GetExtension($exe) -ine '.exe'){throw '启动程序无效'}
    return ('"'+$exe+'" --autostart --data-dir "'+$data+'"')
}
function Write-Json([string]$path,$value){
    $path=Assert-LocalPath $path;$temporary=$path+'.tmp'
    [IO.File]::WriteAllText($temporary,(ConvertTo-Json -InputObject $value -Depth 12),[Text.UTF8Encoding]::new($false))
    if(Test-Path -LiteralPath $path){[IO.File]::Replace($temporary,$path,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($temporary,$path)}
}
switch($Operation){
    'autostart-status' {
        $actual=Read-Run;$expected=Desired-Run $inputValue
        Out-Json @{enabled=[bool]$actual.exists;matches=($actual.exists -and $actual.value -ceq $expected);error=$null}
    }
    'autostart-set' {
        # 只修改当前用户的固定值，不触碰其他启动项。原值先保存到本地目录供单独恢复。
        $directory=Assert-LocalPath ([string]$inputValue.backups);[IO.Directory]::CreateDirectory($directory)|Out-Null
        $id=[Guid]::NewGuid().ToString();$before=Read-Run;$target=Desired-Run $inputValue
        $after=@{exists=[bool]$inputValue.enabled;kind=$(if($inputValue.enabled){'String'}else{$null});value=$(if($inputValue.enabled){$target}else{$null})}
        $record=@{id=$id;createdAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();before=$before;after=$after;state='prepared';message='启动项变更尚未执行'}
        $path=Join-Path $directory ($id+'.json');Write-Json $path $record
        $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($runKey,$true)
        try {
            if($inputValue.enabled){$key.SetValue($runName,$target,[Microsoft.Win32.RegistryValueKind]::String)}else{$key.DeleteValue($runName,$false)}
        }finally{$key.Dispose()}
        $actual=Read-Run
        if($actual.exists -ne $after.exists -or ($after.exists -and $actual.value -cne $after.value)){throw '启动项写入回读不一致，请检查 应用备份'}
        $record.state='completed';$record.message='启动项已修改，可恢复变更前原值';Write-Json $path $record
        Out-Json @{state='completed';message=$record.message;backupId=$id}
    }
    'autostart-restore' {
        $id=[Guid]::Parse([string]$inputValue.id).ToString();$directory=Assert-LocalPath ([string]$inputValue.backups)
        $path=Assert-LocalPath (Join-Path $directory ($id+'.json'));$record=[IO.File]::ReadAllText($path)|ConvertFrom-Json
        $actual=Read-Run
        if($actual.exists -ne $record.after.exists -or ($actual.exists -and ($actual.value -cne $record.after.value -or $actual.kind -cne $record.after.kind))){throw '启动项已被后续操作改变，恢复未覆盖当前配置'}
        $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($runKey,$true)
        try{
            if($record.before.exists){
                if($record.before.kind -notin @('String','ExpandString') -or ([string]$record.before.value).Length -gt 32768){throw '备份启动项类型或长度不合法'}
                $kind=[Enum]::Parse([Microsoft.Win32.RegistryValueKind],[string]$record.before.kind)
                $key.SetValue($runName,[string]$record.before.value,$kind)
            }else{$key.DeleteValue($runName,$false)}
        }finally{$key.Dispose()}
        $restored=Read-Run
        if($restored.exists -ne $record.before.exists -or ($restored.exists -and ($restored.value -cne $record.before.value -or $restored.kind -cne $record.before.kind))){throw '启动项恢复后回读不一致，请保留备份'}
        $record.state='restored';$record.message='启动项已恢复到该次修改前的原值';Write-Json $path $record
        Out-Json @{state='completed';message=$record.message;backupId=$id}
    }
    'pawn-status' {Out-Json (Pawn-Status)}
    'pawn-apply' {
        $directory=Assert-LocalPath ([string]$inputValue.backup);[IO.Directory]::CreateDirectory($directory)|Out-Null
        $payload=ConvertTo-Json -InputObject $inputValue -Compress
        $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
        $sourceGuard=[IO.File]::Open($PSCommandPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try{
            try {
                $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Operation pawn-elevated -TaskBase64 '+$encoded
                $process=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -ArgumentList $args -Verb RunAs -WindowStyle Hidden -Wait -PassThru
            }catch{
                if($_.Exception.NativeErrorCode -eq 1223){Out-Json @{state='cancelled';message='用户取消了管理员授权';backupId=$inputValue.id};break};throw
            }
            $receipt=Join-Path $directory 'receipt.json'
            if(-not (Test-Path -LiteralPath $receipt)){throw '驱动操作未返回回执，请刷新实际安装状态核实'}
            Out-Json ([IO.File]::ReadAllText($receipt)|ConvertFrom-Json)
        }finally{$sourceGuard.Dispose()}
    }
    'pawn-elevated' {
        $directory=Assert-LocalPath ([string]$inputValue.backup);[IO.Directory]::CreateDirectory($directory)|Out-Null
        $receipt=Join-Path $directory 'receipt.json'
        $sourceGuard=[IO.File]::Open($PSCommandPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        $installerGuard=$null
        try{
            # 提权后再次限路径、验哈希与 Authenticode；不采用注册表中的卸载命令。
            $file=Assert-LocalPath ([string]$inputValue.file)
            $installerGuard=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
            if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $pawnHash){throw 'PawnIO 安装器哈希不符'}
            $signature=Get-AuthenticodeSignature -LiteralPath $file
            if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=namazso(,|$)'){throw 'PawnIO 安装器发布者签名无效'}
            foreach($name in @('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE')){
                $folder=Join-Path $directory $name;[IO.Directory]::CreateDirectory($folder)|Out-Null;[Environment]::SetEnvironmentVariable($name,$folder,'Process')
            }
            $before=Pawn-Status;Write-Json (Join-Path $directory 'before.json') $before
            # 备份只读导出，不在验收时运行；恢复入口使用同一签名安装器执行相反动作。
            foreach($key in @('HKLM\SYSTEM\CurrentControlSet\Services\PawnIO','HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO')){
                $name=if($key -match 'Services'){'service.reg'}else{'uninstall.reg'}
                if(Test-Path -LiteralPath ('Registry::'+$key.Replace('HKLM\','HKEY_LOCAL_MACHINE\'))){
                    & reg.exe export $key (Join-Path $directory $name) /y | Out-Null
                    if($LASTEXITCODE -ne 0){throw 'PawnIO 注册表备份失败，未执行驱动操作'}
                }
            }
            $installedDriver=Join-Path $env:SystemRoot 'System32\drivers\PawnIO.sys'
            if(Test-Path -LiteralPath $installedDriver){Copy-Item -LiteralPath $installedDriver -Destination (Join-Path $directory 'PawnIO.sys') -ErrorAction Stop}
            $flag=if($inputValue.install){'-install'}else{'-uninstall'}
            $child=Start-Process -FilePath $file -ArgumentList $flag -WindowStyle Hidden -Wait -PassThru
            if($child.ExitCode -notin @(0,3010)){throw ('PawnIO 安装器退出码：'+$child.ExitCode)}
            $after=Pawn-Status;Write-Json (Join-Path $directory 'after.json') $after
            if([bool]$after.installed -ne [bool]$inputValue.install){throw '驱动操作完成后实际状态未匹配，请保留备份并重启后核实'}
            Write-Json $receipt @{state='completed';message='驱动实际状态已回读验证；如有其他程序依赖此驱动，请按需重启。';backupId=$inputValue.id}
        }catch{Write-Json $receipt @{state='failed';message=[string]$_.Exception.Message;backupId=$inputValue.id}}finally{if($installerGuard){$installerGuard.Dispose()};$sourceGuard.Dispose()}
    }
    default {throw '未知设置原生操作'}
}
