$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
# 只运行 debug EXE 内固定的隔离沙箱检查；不启动音乐账号、系统工具或真实安装。
$executable=Join-Path $env:CARGO_TARGET_DIR 'debug/zhenjing.exe'
if(-not (Test-Path -LiteralPath $executable)){throw '请先在 D 盘环境中执行 cargo build --manifest-path src-tauri/Cargo.toml --locked'}
$control=Join-Path $projectRoot ('.cache\verification\music-sandbox-run-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($control)|Out-Null
$stdout=Join-Path $control 'stdout.log';$stderr=Join-Path $control 'stderr.log'
$process=Start-Process -FilePath $executable -ArgumentList '--verify-music-sandbox' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
# Windows PowerShell 5 必须在退出前持有进程句柄，否则 WaitForExit 后 ExitCode 可能为 null。
$null=$process.Handle
try{
    if(-not $process.WaitForExit(120000)){$process.Kill();throw '音乐脚本沙箱原生验收超时，已停止本次测试进程'}
    $process.Refresh()
    Get-Content -LiteralPath $stdout -Encoding UTF8
    if($process.ExitCode -ne 0){Get-Content -LiteralPath $stderr -Encoding UTF8;throw ('音乐脚本沙箱原生验收未通过：'+$control)}
}finally{$process.Dispose()}
