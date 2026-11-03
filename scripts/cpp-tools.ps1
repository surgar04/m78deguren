# 只读检测；不安装 Visual Studio、不修改注册表或系统环境。
function Find-ProjectCppTools([string]$MsvcSource,[string]$SdkSource,[string]$SdkVersion){
    $msvcLocal=@('.tools/msvc/bin/cl.exe','.tools/msvc/bin/link.exe','.tools/msvc/include/vector','.tools/msvc/lib/libcmt.lib')
    $sdkLocal=@('.tools/winsdk/bin/rc.exe','.tools/winsdk/lib/um/kernel32.lib','.tools/winsdk/lib/ucrt/ucrt.lib','.tools/winsdk/include/um/Windows.h')
    $msvcReady=@($msvcLocal|Where-Object{-not (Test-Path -LiteralPath (Join-Path $projectRoot $_))}).Count -eq 0
    $sdkReady=@($sdkLocal|Where-Object{-not (Test-Path -LiteralPath (Join-Path $projectRoot $_))}).Count -eq 0
    if(-not $msvcReady -and -not $MsvcSource){
        $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
        if(Test-Path -LiteralPath $vswhere){
            $installation=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
            if($installation){$MsvcSource=(Get-ChildItem -LiteralPath (Join-Path $installation 'VC/Tools/MSVC') -Directory |Where-Object{$_.Name -match '^\d+(\.\d+)+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'bin/Hostx64/x64/cl.exe'))}|Sort-Object {[version]$_.Name} -Descending|Select-Object -First 1).FullName}
        }
    }
    if(-not $sdkReady){
        if(-not $SdkSource){
            # SDK 可能安装在其他磁盘；先读取官方安装记录，再采用系统默认位置。
            foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
                $base=$null;$key=$null
                try{
                    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
                    $key=$base.OpenSubKey('SOFTWARE\Microsoft\Windows Kits\Installed Roots',$false)
                    if($key){$candidate=$key.GetValue('KitsRoot10');if($candidate -is [string] -and (Test-Path -LiteralPath $candidate)){$SdkSource=$candidate;break}}
                }finally{if($key){$key.Dispose()};if($base){$base.Dispose()}}
            }
            if(-not $SdkSource){$SdkSource=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'}
        }
        if(-not $SdkVersion -and (Test-Path -LiteralPath (Join-Path $SdkSource 'Lib'))){
            $SdkVersion=(Get-ChildItem -LiteralPath (Join-Path $SdkSource 'Lib') -Directory |Where-Object{
                $_.Name -match '^\d+(\.\d+)+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'um/x64/kernel32.lib')) -and (Test-Path -LiteralPath (Join-Path $SdkSource ('Include/'+$_.Name+'/um/Windows.h'))) -and (Test-Path -LiteralPath (Join-Path $SdkSource ('bin/'+$_.Name+'/x64/rc.exe')))
            }|Sort-Object {[version]$_.Name} -Descending|Select-Object -First 1).Name
        }
    }
    $missing=@()
    if(-not $msvcReady -and (-not $MsvcSource -or -not (Test-Path -LiteralPath (Join-Path $MsvcSource 'bin/Hostx64/x64/cl.exe')))){$missing+='MSVC C++ 编译工具'}
    if(-not $sdkReady -and (-not $SdkVersion -or -not (Test-Path -LiteralPath (Join-Path $SdkSource ('Lib/'+$SdkVersion+'/um/x64/kernel32.lib'))))){$missing+='Windows SDK'}
    return [pscustomobject]@{Ready=($missing.Count -eq 0);MsvcLocal=$msvcReady;SdkLocal=$sdkReady;MsvcSource=$MsvcSource;SdkSource=$SdkSource;SdkVersion=$SdkVersion;Missing=$missing}
}
