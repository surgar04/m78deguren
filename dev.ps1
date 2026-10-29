# 在独立 PowerShell 进程运行，确保环境变量不污染调用方。
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\scripts\env.ps1"
if($args.Count -gt 0 -and $args[0] -eq 'desktop:launchers:dev'){
    # 专用桌面验收档案：只跳过已经单独验收的首次准备，不注入游戏、账号或硬件模拟数据。
    $taskRoot=Join-Path $PSScriptRoot ('.cache\verification\launchers-'+[Guid]::NewGuid().ToString('N'))
    $env:ZHENJING_DATA_DIR=$taskRoot;$env:XINJING_DATA_DIR=$taskRoot
    [IO.Directory]::CreateDirectory((Join-Path $taskRoot 'onboarding'))|Out-Null
    [IO.File]::WriteAllText((Join-Path $taskRoot 'onboarding/progress.json'),'{"version":1,"complete":true,"stage":"done","completed":[],"identity":null}',[Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot '.cache/verification/launchers-test-root.json'),(ConvertTo-Json @{path=$taskRoot}),[Text.UTF8Encoding]::new($false))
}
if($args.Count -gt 0 -and $args[0] -eq 'desktop:first-run:dev'){
    # 每次创建独立全新档案，不删除或改写已有用户和桌面验收数据。
    $env:ZHENJING_DATA_DIR=Join-Path $PSScriptRoot ('.cache\verification\first-run-'+[Guid]::NewGuid().ToString('N'))
    $env:XINJING_DATA_DIR=$env:ZHENJING_DATA_DIR
    [IO.Directory]::CreateDirectory($env:ZHENJING_DATA_DIR)|Out-Null
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot '.cache\verification\first-run-test-root.json'),(ConvertTo-Json @{path=$env:ZHENJING_DATA_DIR}),[Text.UTF8Encoding]::new($false))
}
if($args.Count -gt 0 -and $args[0] -eq 'desktop:test:dev'){
    # 原生验收与日常数据隔离；只给测试目录注入真实视频所在的白名单目录。
    $env:XINJING_DATA_DIR=Join-Path $PSScriptRoot '.cache\verification\tools-desktop-data'
    $env:ZHENJING_DATA_DIR=$env:XINJING_DATA_DIR
    $recordings=Join-Path $env:XINJING_DATA_DIR 'tools\recordings'
    $videos=Join-Path $PSScriptRoot '.cache\verification\tools-video-library'
    [IO.Directory]::CreateDirectory($recordings)|Out-Null
    [IO.Directory]::CreateDirectory($videos)|Out-Null
    $roots=Join-Path $recordings 'roots.json'
    if(-not (Test-Path -LiteralPath $roots)){
        $value=@(@{id=[Guid]::NewGuid().ToString();path=$videos})
        [IO.File]::WriteAllText($roots,(ConvertTo-Json -InputObject $value),[Text.UTF8Encoding]::new($false))
    }
}
if (-not (Test-Path "$PSScriptRoot\.tools\node\node.exe")) {
    throw '缺少本地工具链，请先运行 scripts/bootstrap.ps1。'
}
& "$PSScriptRoot\scripts\pnpm.cmd" @args
exit $LASTEXITCODE
