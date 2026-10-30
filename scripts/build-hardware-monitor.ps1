param()
$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
$sdk=Join-Path $projectRoot '.tools/dotnet/dotnet.exe'
if(-not (Test-Path -LiteralPath $sdk)){throw '缺少 D 盘便携 .NET SDK，请先按工程说明准备 8.0.426；禁止运行系统安装器。'}
$project=Join-Path $projectRoot 'native/hardware-monitor/ZhenjingMonitor.csproj'
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw|ConvertFrom-Json).version
$publish=Join-Path $projectRoot ('.cache/dotnet/hardware/publish-'+[Guid]::NewGuid().ToString('N'))
& $sdk publish $project -c Release -o $publish --configfile (Join-Path $projectRoot 'native/hardware-monitor/NuGet.Config') -p:RestoreLockedMode=true ('-p:Version='+$version)
if($LASTEXITCODE -ne 0){throw '硬件桥接编译失败'}
& (Join-Path $projectRoot '.tools/node/node.exe') (Join-Path $projectRoot 'node_modules/prettier/bin/prettier.cjs') --write (Join-Path $projectRoot 'native/hardware-monitor/packages.lock.json')
if($LASTEXITCODE -ne 0){throw '依赖锁文件格式检查失败'}
$target=Join-Path $projectRoot 'src-tauri/resources/hardware-monitor'
[IO.Directory]::CreateDirectory($target)|Out-Null
$runtime=Join-Path $target 'runtime'
[IO.Directory]::CreateDirectory($runtime)|Out-Null
$files=@{}
foreach($file in Get-ChildItem -LiteralPath $publish -File -Recurse){
    if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '发布组件不能包含链接'}
    $name=$file.FullName.Substring($publish.Length+1).Replace('\','/')
    if($file.Extension -in @('.cs','.pdb','.csproj')){throw '发布目录含源码或调试文件'}
    $destination=Join-Path $runtime $name
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))|Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    $files[$name]=(Get-FileHash -LiteralPath $destination).Hash.ToLowerInvariant()
}
foreach($required in @('ZhenjingMonitor.exe','ZhenjingMonitor.dll','ZhenjingMonitor.deps.json','ZhenjingMonitor.runtimeconfig.json','hostfxr.dll','hostpolicy.dll','coreclr.dll','ECPFrames-x64.exe','vcruntime140.dll')){
    if(-not $files.ContainsKey($required)){throw ('自包含组件缺失：'+$required)}
}
$sources=@{}
$sourceRoot=Join-Path $projectRoot 'native/hardware-monitor'
foreach($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/](obj|bin)[\\/]' -and ($_.Extension -in @('.cs','.csproj','.props','.json','.exe','.dll') -or $_.Name -eq 'NuGet.Config') }){
    if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '硬件助手来源不能包含链接'}
    $name=$file.FullName.Substring($sourceRoot.Length+1).Replace('\','/')
    $sources[$name]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
$value=@{schema=2;sdk='8.0.426';libreHardwareMonitor='0.9.6';layout='self-contained-dll';entryPoint='ZhenjingMonitor.exe';sha256=$files['ZhenjingMonitor.exe'];files=$files;sources=$sources}
[IO.File]::WriteAllText((Join-Path $target 'manifest.json'),(ConvertTo-Json -InputObject $value -Depth 5),[Text.UTF8Encoding]::new($false))
& (Join-Path $projectRoot '.tools/node/node.exe') (Join-Path $projectRoot 'node_modules/prettier/bin/prettier.cjs') --write (Join-Path $target 'manifest.json')
Write-Output '硬件/HUD DLL、自包含运行库及逐文件校验清单已更新到 D 盘。'
