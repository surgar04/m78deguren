$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
function Assert-PackagePath([string]$path){
    $full=[IO.Path]::GetFullPath($path)
    if(-not $full.StartsWith($projectRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetPathRoot($full) -ine 'D:\'){throw "清理目标越过 D 盘工程边界：$full"}
    $current=$full
    while($current){if(Test-Path -LiteralPath $current){if(((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '清理目标包含重解析点'}};$parent=[IO.Path]::GetDirectoryName($current);if($parent -eq $current){break};$current=$parent}
    return $full
}
# 旧便携 staging 可能被实际运行过；先保留运行数据，绝不把用户数据当成缓存删除。
$staging=Assert-PackagePath (Join-Path $projectRoot '.cache\package')
if(Test-Path -LiteralPath $staging){
    foreach($folder in Get-ChildItem -LiteralPath $staging -Directory){
        foreach($name in @('data','settings','tools','steam','hardware','webview','logs','profile','tmp')){
            $source=Assert-PackagePath (Join-Path $folder.FullName $name)
            if(Test-Path -LiteralPath $source){
                $destination=Assert-PackagePath (Join-Path $projectRoot ('.local\preserved-packaging-data\'+$folder.Name+'-'+[Guid]::NewGuid().ToString('N')+'\'+$name))
                New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($destination))|Out-Null
                Move-Item -LiteralPath $source -Destination $destination
                Write-Output "已保留旧便携运行数据：$destination"
            }
        }
    }
}
# 固定清理列表；不删除 Cargo 编译缓存、NSIS 工具、依赖、签名密钥或发布仓库。
foreach($relative in @('.cache\package','.cache\msi','dist\desktop','.cache\cargo\target\release\bundle','.cache\cargo\target\release\nsis','.cache\cargo\target\debug\bundle','.cache\cargo\target\debug\nsis')){
    $target=Assert-PackagePath (Join-Path $projectRoot $relative)
    if(Test-Path -LiteralPath $target){
        # 递归前检查所有后代，防止遇到链接后删除或移动到工程外。
        foreach($entry in Get-ChildItem -LiteralPath $target -Recurse -Force){Assert-PackagePath $entry.FullName|Out-Null}
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-Output "已清理打包产物：$target"
    }
}
