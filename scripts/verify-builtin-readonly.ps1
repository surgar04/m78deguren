param([string[]]$Operations=@('apps','gpus','virtualization','disks','context','vac-status','displays','nvidia','features-runtime','features-boot','telemetry-probe'))
$Operations=@($Operations | ForEach-Object {$_ -split ','})
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$project=Split-Path -Parent $PSScriptRoot
$base=Join-Path $project 'src-tauri\src\services\tools\windows'
$source=[IO.File]::ReadAllText((Join-Path $base 'system.ps1'))
$parts=@{'# __NATIVE_HELPERS__'='native.ps1';'# __FILTER_HELPERS__'='filter.ps1';'// __NATIVE_CS__'='native.cs';'// __NVIDIA_CS__'='nvidia.cs';'// __DRIVER_CS__'='driver.cs';'// __TELEMETRY_CS__'='telemetry.cs';'// __COLOR_CS__'='color.cs';'__NVIDIA_SETTINGS__'='nvidia-settings.json'}
# 先展开 PowerShell 入口，再展开入口所包含的 C#；与 Rust 的编译期绑定顺序一致。
foreach($marker in @('# __NATIVE_HELPERS__','# __FILTER_HELPERS__','// __NATIVE_CS__','// __NVIDIA_CS__','// __DRIVER_CS__','// __TELEMETRY_CS__','// __COLOR_CS__','__NVIDIA_SETTINGS__')){$source=$source.Replace($marker,[IO.File]::ReadAllText((Join-Path $base $parts[$marker])))}
$directory=Join-Path $project '.cache\verification\builtin-readonly'
[IO.Directory]::CreateDirectory($directory)|Out-Null
$probe=Join-Path $directory 'system-probe.ps1'
 $source=$source.Replace('# __OPTIMIZATION_HELPERS__',[IO.File]::ReadAllText((Join-Path $base 'optimizer.ps1')))
 $source=$source.Replace('// __OPTIMIZER_CS__',[IO.File]::ReadAllText((Join-Path $base 'optimizer.cs')))
 $source=$source.Replace('__OPTIMIZER_CATALOG_BASE64__',[Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $base 'optimizer-catalog.json'))))
$source=$source.Replace('# __STORAGE_POLICY__',[IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/tools/windows/storage-policy.ps1')))
[IO.File]::WriteAllText($probe,$source,[Text.UTF8Encoding]::new($true))
$env:PSModulePath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'
$allowed=@('apps','gpus','virtualization','disks','context','vac-status','displays','nvidia','features-runtime','features-boot','telemetry-probe','filter-probe','optimizer-scan')
foreach($operation in $Operations){
    if($operation -notin $allowed){throw '验收脚本只允许固定只读查询，不允许执行安装、输入、颜色或系统配置修改'}
    $output=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe -Operation $operation -ArgumentJson '[]' 2> (Join-Path $directory ($operation+'.stderr.txt'))
    $exit=$LASTEXITCODE;$text=$output -join "`n"
    if($exit -ne 0){throw ($operation+' 查询失败：'+$text)}
    $null=ConvertFrom-Json -InputObject $text
    [IO.File]::WriteAllText((Join-Path $directory ($operation+'.json')),$text,[Text.UTF8Encoding]::new($false))
    Write-Output ($operation+': valid JSON')
}
