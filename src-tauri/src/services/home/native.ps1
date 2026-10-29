param([Parameter(Mandatory=$true)][string]$Operation,[string]$ArgumentJson='[]')
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$parameters=ConvertFrom-Json -InputObject $ArgumentJson
if($Operation -notin @('home-icon','home-runtime','home-probe','home-launch')){throw '未知首页原生操作'}
Add-Type -TypeDefinition @'
// __HOME_CS__
'@ -ReferencedAssemblies @('System.Drawing','System.Windows.Forms','System.Web.Extensions','System.Core')
if($Operation -eq 'home-icon'){
    $value=[Zhenjing.Home.Native]::Icon([string]$parameters[0])
    # 部分控制台 EXE 没有图标。PowerShell 5 对空对象不输出 JSON，需显式返回 null，保持协议完整。
    if($null -eq $value){[Console]::WriteLine('null')}else{ConvertTo-Json -InputObject $value -Compress}
}elseif($Operation -eq 'home-launch'){
    if($env:ZHENJING_RESTRICT_WRITES_TO_D -eq '1'){throw '开发验收不提权启动外部程序'}
    $pidValue=[Zhenjing.Home.Native]::LaunchExecutable([string]$parameters[0],[string]$parameters[1])
    ConvertTo-Json -InputObject @{pid=$pidValue} -Compress
}elseif($Operation -eq 'home-probe'){
    [Zhenjing.Home.Native]::Probe()
}else{
    [Zhenjing.Home.Native]::Run([int]$parameters[0],[string]$parameters[1])
}
