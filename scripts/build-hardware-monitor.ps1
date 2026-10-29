param()
$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
$sdk=Join-Path $projectRoot '.tools/dotnet/dotnet.exe'
if(-not (Test-Path -LiteralPath $sdk)){throw '缺少 D 盘便携 .NET SDK，请先按工程说明准备 8.0.426；禁止运行系统安装器。'}
$project=Join-Path $projectRoot 'native/hardware-monitor/ZhenjingMonitor.csproj'
& $sdk publish $project -c Release -o (Join-Path $projectRoot '.cache/dotnet/hardware/publish') --configfile (Join-Path $projectRoot 'native/hardware-monitor/NuGet.Config') -p:RestoreLockedMode=true
if($LASTEXITCODE -ne 0){throw '硬件桥接编译失败'}
& (Join-Path $projectRoot '.tools/node/node.exe') (Join-Path $projectRoot 'node_modules/prettier/bin/prettier.cjs') --write (Join-Path $projectRoot 'native/hardware-monitor/packages.lock.json')
if($LASTEXITCODE -ne 0){throw '依赖锁文件格式检查失败'}
$target=Join-Path $projectRoot 'src-tauri/resources/hardware-monitor'
[IO.Directory]::CreateDirectory($target)|Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot '.cache/dotnet/hardware/publish/ZhenjingMonitor.exe') -Destination (Join-Path $target 'ZhenjingMonitor.exe') -Force
$sources=@{}
$sourceRoot=Join-Path $projectRoot 'native/hardware-monitor'
foreach($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/](obj|bin)[\\/]' -and ($_.Extension -in @('.cs','.csproj','.props','.json','.exe') -or $_.Name -eq 'NuGet.Config') }){
    if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '硬件助手来源不能包含链接'}
    $name=$file.FullName.Substring($sourceRoot.Length+1).Replace('\','/')
    $sources[$name]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
$value=@{sdk='8.0.426';libreHardwareMonitor='0.9.6';sha256=(Get-FileHash -LiteralPath (Join-Path $target 'ZhenjingMonitor.exe') -Algorithm SHA256).Hash.ToLowerInvariant();sources=$sources}
[IO.File]::WriteAllText((Join-Path $target 'manifest.json'),(ConvertTo-Json -InputObject $value -Depth 5),[Text.UTF8Encoding]::new($false))
& (Join-Path $projectRoot '.tools/node/node.exe') (Join-Path $projectRoot 'node_modules/prettier/bin/prettier.cjs') --write (Join-Path $target 'manifest.json')
Write-Output '硬件桥接程序与来源校验清单已更新到 D 盘。'
