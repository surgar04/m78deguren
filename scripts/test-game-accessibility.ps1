# 只读 ABI 与恢复记录验证：D 盘保护保持开启，绝不调用真实系统修改或弹出系统通知。
$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
if($env:ZHENJING_RESTRICT_WRITES_TO_D -ne '1'){throw '粘滞键验收必须在 D 盘保护模式下运行'}
$component=Join-Path $projectRoot 'src-tauri/resources/windows-bridge'
$assembly=Join-Path $component 'Zhenjing.Windows.dll'
$manifest=Get-Content -LiteralPath (Join-Path $component 'manifest.json') -Raw | ConvertFrom-Json
if((Get-FileHash -LiteralPath $assembly -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.files.'Zhenjing.Windows.dll'){throw 'Windows 组件摘要不一致'}
[void][Reflection.Assembly]::LoadFrom($assembly)
$before=[Zhenjing.Home.GameAccessibility]::ReadFlags()
$base=[IO.Path]::GetFullPath((Join-Path $projectRoot '.cache/verification'))
$scratch=[IO.Path]::GetFullPath((Join-Path $base ('game-accessibility-'+[Guid]::NewGuid().ToString('N'))))
if(-not $scratch.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)){throw '测试目录越界'}
[IO.Directory]::CreateDirectory($scratch)|Out-Null
try {
    $journal=Join-Path $scratch 'sticky-keys-recovery.json'
    [IO.File]::WriteAllText($journal,'{"original":7,"applied":2}',[Text.UTF8Encoding]::new($false))
    [Zhenjing.Home.GameAccessibility]::Initialize($scratch)
    [Zhenjing.Home.GameAccessibility]::Update($true,$true)
    [Zhenjing.Home.GameAccessibility]::Restore($true)
    if([Zhenjing.Home.GameAccessibility]::ReadFlags() -ne $before){throw '开发验收不得修改真实粘滞键状态'}
    if(-not (Test-Path -LiteralPath $journal)){throw '受限模式不得执行恢复或删除原值记录'}
    [IO.File]::WriteAllText($journal,'{"original":7,"applied":999}',[Text.UTF8Encoding]::new($false))
    $rejected=$false
    try{[Zhenjing.Home.GameAccessibility]::Initialize($scratch)}catch{$rejected=$true}
    if(-not $rejected){throw '损坏的恢复记录没有被拒绝'}
    Write-Output '粘滞键 Win32 只读 ABI、恢复记录校验及开发保护通过；真实设置未改变。'
} finally {
    $resolved=[IO.Path]::GetFullPath($scratch)
    if($resolved.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
