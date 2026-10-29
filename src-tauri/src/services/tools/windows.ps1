param([Parameter(Mandatory=$true)][string]$Operation, [string]$ArgumentJson = '[]')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# PowerShell 5.1已经将JSON数组作为单个数组返回，再套@()会产生嵌套数组，破坏多参数操作。
$arguments = ConvertFrom-Json -InputObject $ArgumentJson
function Output-Json($value) { ConvertTo-Json -InputObject $value -Depth 12 -Compress | Write-Output }
function Is-Admin { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
switch ($Operation) {
    'admin' { Output-Json (Is-Admin) }
    'hold' {
        # 只读取指定按键状态，不安装驱动、不发送输入、不读取其他程序内存。
        Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class ZhenjingInput {
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
}
'@
        $key = [int]$arguments[0]; $delay = [int]$arguments[1]
        # 即使宿主异常退出，也不留下无限轮询的PowerShell子进程；句柄对应实际进程实例。
        $owner = [Diagnostics.Process]::GetProcessById([int]$arguments[2])
        if ($key -notin @(1,2,4,5,6,16,17,18) -or $delay -lt 0 -or $delay -gt 2000) { throw '按住参数无效' }
        $started = $null; $visible = $false
        while (-not $owner.HasExited) {
            $down = ([ZhenjingInput]::GetAsyncKeyState($key) -band 0x8000) -ne 0
            if ($down -and $null -eq $started) { $started = [Diagnostics.Stopwatch]::StartNew() }
            if (-not $down) { $started = $null }
            $next = $down -and $null -ne $started -and $started.ElapsedMilliseconds -ge $delay
            if ($next -ne $visible) { [Console]::WriteLine($(if ($next) {'1'} else {'0'})); [Console]::Out.Flush(); $visible = $next }
            Start-Sleep -Milliseconds 16
        }
    }
    'clock' {
        if (-not (Is-Admin)) { throw '校时需要管理员权限' }
        $offset = [double]::Parse($arguments[0], [Globalization.CultureInfo]::InvariantCulture)
        if ([double]::IsNaN($offset) -or [math]::Abs($offset) -gt 86400000) { throw '校时偏差超出安全范围' }
        Set-Date -Adjust ([TimeSpan]::FromMilliseconds($offset)) | Out-Null
        Output-Json ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    }
    'display' {
        $items = @(Get-CimInstance Win32_VideoController | ForEach-Object {
            @{name=[string]$_.Name; width=$_.CurrentHorizontalResolution; height=$_.CurrentVerticalResolution; refreshRate=$_.CurrentRefreshRate}
        })
        Output-Json $items
    }
    'runtimes' {
        # 注册表只读：同时检查两个架构，不能把x64系统中的x86组件误判为重复。
        $entries = @()
        foreach ($registry in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
            $entries += @(Get-ItemProperty $registry -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Microsoft Visual C\+\+' })
        }
        $release = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue).Release
        $components = @()
        foreach ($year in @('2008','2010','2012','2013','v14')) {
            foreach ($arch in @('x64','x86')) {
                $pattern = if ($year -eq 'v14') { '2015|2017|2019|2022|2026|v14|Visual C\+\+.*14\.' } else { $year }
                $installed = @($entries | Where-Object { $_.DisplayName -match $pattern -and $_.DisplayName -match $arch })
                $folder = if ($arch -eq 'x86' -and [Environment]::Is64BitOperatingSystem) { "$env:SystemRoot\SysWOW64" } else { "$env:SystemRoot\System32" }
                $dlls = switch ($year) { '2010' {@('msvcr100.dll','msvcp100.dll')} '2012' {@('msvcr110.dll','msvcp110.dll')} '2013' {@('msvcr120.dll','msvcp120.dll')} 'v14' {@('vcruntime140.dll','msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','concrt140.dll','vcomp140.dll','ucrtbase.dll')} default {@()} }
                $missing = @($dlls | Where-Object { -not (Test-Path -LiteralPath (Join-Path $folder $_)) })
                $complete = $installed.Count -gt 0 -and $missing.Count -eq 0
                if ($year -eq '2008') {
                    $sxsArch = if ($arch -eq 'x64') {'amd64'} else {'x86'}
                    $sxs = @(Get-ChildItem -LiteralPath "$env:SystemRoot\WinSxS" -Directory -Filter "$sxsArch`_microsoft.vc90.crt_*" -ErrorAction SilentlyContinue | Where-Object { (Test-Path -LiteralPath (Join-Path $_.FullName 'msvcr90.dll')) -and (Test-Path -LiteralPath (Join-Path $_.FullName 'msvcp90.dll')) })
                    $complete = $installed.Count -gt 0 -and $sxs.Count -gt 0
                }
                $components += @{id="vc-$year-$arch"; name="Visual C++ $year $arch"; installed=($installed.Count -gt 0); version=([string](($installed | Select-Object -First 1).DisplayVersion)); complete=$complete}
            }
        }
        $components += @{id='dotnet481';name='.NET Framework 4.8.1';installed=($null -ne $release -and $release -ge 533320);version=[string]$release;complete=($null -ne $release -and $release -ge 533320)}
        $dx = @('d3dx9_43.dll','d3dx11_43.dll','XAudio2_7.dll')
        $dxMissing = @($dx | Where-Object { -not (Test-Path -LiteralPath (Join-Path "$env:SystemRoot\System32" $_)) -or ([Environment]::Is64BitOperatingSystem -and -not (Test-Path -LiteralPath (Join-Path "$env:SystemRoot\SysWOW64" $_))) })
        $components += @{id='directx';name='DirectX 旧版兼容组件';installed=($dxMissing.Count -eq 0);version='June 2010 compatibility';complete=($dxMissing.Count -eq 0)}
        Output-Json @{components=$components; admin=(Is-Admin); operatingSystem=[Environment]::OSVersion.VersionString}
    }
    'signature' {
        $signature = Get-AuthenticodeSignature -LiteralPath $arguments[0]
        Output-Json @{valid=($signature.Status -eq 'Valid');subject=[string]$signature.SignerCertificate.Subject;thumbprint=[string]$signature.SignerCertificate.Thumbprint}
    }
    'install-runtime' {
        # 路径由Rust白名单生成，签名与哈希在提权前再次验证；此处不接收任意命令。
        $installer = $arguments[0]
        $expected = $arguments[1]
        $kind = $arguments[2]
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') { throw '不是有效的微软签名' }
        if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $expected) { throw '安装包校验失败' }
        # VC 2012及之后的Burn安装器明确区分修复/安装，不能仅运行一个无动作参数的安装器。
        $installed = $false
        if ($kind -match '^vc-(v14|2008|2010|2012|2013)-(x64|x86)$') {
            $version = $Matches[1]; $architecture = $Matches[2]
            $pattern = if ($version -eq 'v14') { '2015|2017|2019|2022|2026|v14|Visual C\+\+.*14\.' } else { $version }
            foreach ($key in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
                if (@(Get-ItemProperty $key -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Microsoft Visual C\+\+' -and $_.DisplayName -match $pattern -and $_.DisplayName -match $architecture }).Count -gt 0) { $installed = $true }
            }
        }
        $installArgs = switch -Regex ($kind) {
            '^directx$' { @('/Q'); break }
            '^vc-(v14|2012|2013)-' { @($(if ($installed) {'/repair'} else {'/install'}),'/passive','/norestart'); break }
            '^vc-(2008|2010)-' { if ($installed) { @('/repair','/quiet','/norestart') } else { @('/q','/norestart') }; break }
            '^dotnet481$' {
                $release = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue).Release
                if ($null -ne $release -and $release -ge 533320) { @('/repair','/passive','/norestart') } else { @('/passive','/norestart') }; break
            }
            default { throw '不支持的安装包类型' }
        }
        try { $process = Start-Process -FilePath $installer -ArgumentList $installArgs -Verb RunAs -PassThru -Wait -WindowStyle Hidden }
        catch { if ($_.Exception.NativeErrorCode -eq 1223) { Output-Json @{exitCode=1223;restartRequired=$false;success=$false}; break }; throw }
        Output-Json @{exitCode=$process.ExitCode;restartRequired=($process.ExitCode -in @(3010,1641));success=($process.ExitCode -in @(0,3010,1641))}
    }
    'recording-locations' {
        $shell=Get-ItemProperty -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction SilentlyContinue
        $video=[Environment]::ExpandEnvironmentVariables([string]$shell.'My Video')
        $rows=@();if($video -match '^[a-zA-Z]:[\\/]'){$rows+=@($video,(Join-Path $video 'NVIDIA App'),(Join-Path $video 'NVIDIA'))}
        Output-Json @($rows | Select-Object -Unique | Where-Object {Test-Path -LiteralPath $_ -PathType Container})
    }
    'crashes' {
        $events = @()
        try {
            $events = @(Get-WinEvent -FilterHashtable @{LogName='System';Id=@(1001,41,18,19,7,51,55,129,153,157,161,46,6008,219);StartTime=(Get-Date).AddDays(-30)} -MaxEvents 160 -ErrorAction Stop | ForEach-Object {
                $record=$_;$data=@{};$xml=[Xml.XmlDocument]::new();$xml.XmlResolver=$null;$xml.LoadXml($record.ToXml())
                foreach($field in @($xml.GetElementsByTagName('Data') | Select-Object -First 10)){$fieldName=$field.GetAttribute('Name');if($fieldName){$text=[string]$field.InnerText;$data[$fieldName]=$text.Substring(0,[Math]::Min(256,$text.Length))}}
                @{id=$record.Id;time=$record.TimeCreated.ToUniversalTime().ToString('o');provider=$record.ProviderName;message=([string]$record.Message).Substring(0,[math]::Min(4000,([string]$record.Message).Length));data=$data}
            })
        } catch { if ($_.FullyQualifiedErrorId -notmatch 'NoMatchingEventsFound') { throw } }
        $dumpRoot = Join-Path $env:SystemRoot 'Minidump'
        $dumps = @()
        if (Test-Path -LiteralPath $dumpRoot) {
            $dumps = @(Get-ChildItem -LiteralPath $dumpRoot -File -Filter '*.dmp' -ErrorAction Stop | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 100 | ForEach-Object {
                @{name=$_.Name;path=$_.FullName;bytes=$_.Length;modified=$_.LastWriteTimeUtc.ToString('o')}
            })
        }
        $system=Get-CimInstance Win32_OperatingSystem
        $control=Get-ItemProperty -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\CrashControl' -ErrorAction SilentlyContinue
        $fullDump=[Environment]::ExpandEnvironmentVariables([string]$control.DumpFile)
        if($fullDump -and (Test-Path -LiteralPath $fullDump -PathType Leaf)){$file=Get-Item -LiteralPath $fullDump;$dumps+=@{name=$file.Name;path=$file.FullName;bytes=$file.Length;modified=$file.LastWriteTimeUtc.ToString('o')}}
        $liveRoot=Join-Path $env:SystemRoot 'LiveKernelReports'
        if(Test-Path -LiteralPath $liveRoot){$dumps+=@(Get-ChildItem -LiteralPath $liveRoot -File -Filter '*.dmp' -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 30 | ForEach-Object {@{name=$_.Name;path=$_.FullName;bytes=$_.Length;modified=$_.LastWriteTimeUtc.ToString('o')}})}
        Output-Json @{events=$events;dumps=$dumps;admin=(Is-Admin);capturedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();system=@{name=[string]$system.Caption;version=[string]$system.Version;lastBoot=$system.LastBootUpTime.ToUniversalTime().ToString('o');dumpMode=$control.CrashDumpEnabled;autoReboot=$control.AutoReboot;dumpFile=[string]$control.DumpFile;minidumpDirectory=[string]$control.MinidumpDir}}
    }
    default { throw '不支持的系统操作' }
}
