param([Parameter(Mandatory=$true)][string]$Operation, [string]$ArgumentJson = '[]')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($Operation -ne 'autoclicker') { throw '未知输入操作' }
$parameters = ConvertFrom-Json -InputObject $ArgumentJson
$config = ConvertFrom-Json -InputObject ([string]$parameters[0])
$owner = [Diagnostics.Process]::GetProcessById([int]$parameters[1])
if ($config.button -notin @('left','right') -or $config.intervalMs -lt 4 -or $config.intervalMs -gt 60000 -or $config.key -notin @(4,5,6,32,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,112,113,114,115,116,117,118,119,120,121,122,123)) { throw '输入参数无效' }

# SendInput 一次提交完整的按下/抬起对，停止或宿主退出不会留下被按住的鼠标键。
# 不安装驱动、不注入目标进程；Windows 的权限边界依然有效。
# __MANAGED_BRIDGE__
Initialize-ZhenjingManaged
$running = [bool]$config.immediate
$previous = $false
$count = [long]0
$clock = [Diagnostics.Stopwatch]::StartNew()
$next = $clock.ElapsedMilliseconds
function Report-State { @{running=$running;clicks=$count;ready=$true;message=''} | ConvertTo-Json -Compress | Write-Output; [Console]::Out.Flush() }
Report-State
$lastReport = [long]0
if(-not $config.externalHotkeys){throw '连点热键必须由设置服务统一管理'}
$commandRead=[ZhenjingClicker]::ReadCommand()
while (-not $owner.HasExited) {
    if($commandRead.IsCompleted){
        $command=$commandRead.GetAwaiter().GetResult();if($null -eq $command){break}
        if($command -cne 'toggle'){throw '未知连点控制指令'}
        $running=-not $running;$next=$clock.ElapsedMilliseconds;Report-State
        $commandRead=[ZhenjingClicker]::ReadCommand()
    }
    # Esc 是不依赖用户自定义热键的紧急停止，始终有效。
    if ([ZhenjingClicker]::Down(27) -and $running) { $running=$false; Report-State }
    if ($running -and $clock.ElapsedMilliseconds -ge $next) {
        if (-not [ZhenjingClicker]::Click($config.button -eq 'right')) { throw '输入被 Windows 拒绝，请检查目标程序权限' }
        $count++
        # 调度延迟时不补发一串点击，避免恢复前台后产生点击风暴。
        $next = $clock.ElapsedMilliseconds + [int]$config.intervalMs
    }
    if ($clock.ElapsedMilliseconds - $lastReport -ge 500) { Report-State; $lastReport=$clock.ElapsedMilliseconds }
    Start-Sleep -Milliseconds 2
}
