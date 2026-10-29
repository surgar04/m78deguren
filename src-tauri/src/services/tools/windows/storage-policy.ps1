# 内嵌发布路径策略：不依赖工作区、当前目录或 D 盘。开发入口显式开启限制。
# 本函数只验证路径；授权范围仍由 Rust 的操作票据、固定根目录和文件白名单决定。
function Assert-LocalPath([string]$path) {
    if([string]::IsNullOrWhiteSpace($path) -or $path -notmatch '^[a-zA-Z]:[\\/]'){throw '请选择本地磁盘的绝对路径'}
    foreach($part in @($path.Substring(3) -split '[\\/]')) {
        if($part -eq ''){continue}
        if($part -in @('.','..') -or $part -match '[\x00-\x1f:<>"|?*]' -or $part -match '[. ]$' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)'){throw '路径包含不安全的名称或相对目录'}
    }
    $full=[IO.Path]::GetFullPath($path)
    if($full.TrimEnd('\','/').Length -le 2){throw '不能使用整个磁盘作为目标目录'}
    if($env:ZHENJING_RESTRICT_WRITES_TO_D -eq '1' -and [IO.Path]::GetPathRoot($full) -ine 'D:\'){throw '开发环境仅允许写入 D 盘'}
    $current=$full
    while($current) {
        if(Test-Path -LiteralPath $current){
            if(((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '路径不能包含符号链接或目录联接'}
        }
        $parent=[IO.Path]::GetDirectoryName($current)
        if($parent -eq $current){break}
        $current=$parent
    }
    return $full
}
function Test-LocalPath([string]$path) {
    try{$null=Assert-LocalPath $path;return $true}catch{return $false}
}
