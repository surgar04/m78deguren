$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$binary=Join-Path $env:CARGO_TARGET_DIR 'release\zhenjing.exe'
if(-not (Test-Path -LiteralPath $binary -PathType Leaf)){throw '请先完成 desktop:build'}
$directory=Join-Path $projectRoot ('.cache\verification\tools-release-start-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($directory)|Out-Null
$env:ZHENJING_DATA_DIR=$directory
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReleaseWindowBounds {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll",SetLastError=true)] static extern bool GetWindowRect(IntPtr window,out Rect rect);
 public static Rect Read(IntPtr window){Rect rect;if(!GetWindowRect(window,out rect))throw new System.ComponentModel.Win32Exception();return rect;}
}
'@
$bounds=$null;$area=$null
$process=$null;$healthy=$false;$title='';$window=0
try{
    # 仅验证独立数据目录的启动，不调用任何系统修改工具。
    $process=Start-Process -FilePath $binary -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    for($attempt=0;$attempt -lt 45;$attempt++){
        $process.Refresh()
        if($process.HasExited){throw ('发布程序过早退出：'+$process.ExitCode)}
        $window=$process.MainWindowHandle.ToInt64();$title=$process.MainWindowTitle
        if($window -ne 0 -and (Test-Path -LiteralPath (Join-Path $directory 'webview'))){
            $bounds=[ReleaseWindowBounds]::Read($process.MainWindowHandle)
            $area=[Windows.Forms.Screen]::FromHandle($process.MainWindowHandle).WorkingArea
            if($bounds.Left -lt $area.Left-16 -or $bounds.Top -lt $area.Top-16 -or $bounds.Right -gt $area.Right+16 -or $bounds.Bottom -gt $area.Bottom+16){throw '发布窗口超出当前显示器工作区'}
            $healthy=$true;break
        }
        Start-Sleep -Seconds 1
    }
    if(-not $healthy){throw '发布程序没有在限定时间创建原生窗口及 D 盘 WebView 数据'}
}finally{
    # 只关闭本脚本启动的实例，绝不按进程名关闭用户的应用。
    if($process -and -not $process.HasExited){$null=$process.CloseMainWindow();if(-not $process.WaitForExit(5000)){$process.Kill();$process.WaitForExit()}}
    $artifact=Get-Item -LiteralPath $binary
    $report=@{passed=$healthy;checkedAt=[DateTimeOffset]::UtcNow.ToString('o');binary=$binary;bytes=$artifact.Length;modifiedUtc=$artifact.LastWriteTimeUtc.ToString('o');sha256=(Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash;data=$directory;windowHandle=$window;title=$title;windowBounds=$bounds;workingArea=$area;systemChangesExecuted=$false}
    [IO.File]::WriteAllText((Join-Path $projectRoot '.cache\verification\tools-release-startup-current.json'),(ConvertTo-Json -InputObject $report -Depth 5),[Text.UTF8Encoding]::new($false))
}
Write-Output '发布 EXE 原生窗口与 D 盘数据目录启动验证通过。'
