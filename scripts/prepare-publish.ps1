# 只准备一个可审查的 D 盘提交，不推送、不重写历史、不删除 Releases。
$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Text.UTF8Encoding]::new($false)
$git=Get-Command git -ErrorAction Stop
$mirror=Join-Path $projectRoot '.cache\backups\m78deguren-before-zhenjing.git'
$destination=Join-Path $projectRoot '.cache\publish\m78deguren'
if(-not (Test-Path -LiteralPath $mirror)){throw '缺少替换前的镜像备份'}
if(Test-Path -LiteralPath $destination){throw '发布准备目录已存在；请检查已有提交，不自动覆盖'}
# 写入前逐层拒绝目录联接，字符串路径在 D 盘并不足以证明实际目标仍在 D 盘。
$ancestor=Split-Path -Parent $destination
while($ancestor){
    if(Test-Path -LiteralPath $ancestor){if(((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '发布目录不能经过重解析点'}}
    $ancestor=[IO.Path]::GetDirectoryName($ancestor)
}
[IO.Directory]::CreateDirectory((Split-Path -Parent $destination))|Out-Null
& $git.Source clone --no-hardlinks $mirror $destination
if($LASTEXITCODE -ne 0){throw '镜像克隆失败'}
$resolved=[IO.Path]::GetFullPath($destination)
if($resolved -cne [IO.Path]::GetFullPath((Join-Path $projectRoot '.cache\publish\m78deguren')) -or [IO.Path]::GetPathRoot($resolved) -ine 'D:\'){throw '发布目录范围异常'}
$old=@(& $git.Source -C $destination -c core.quotepath=false ls-files)
foreach($relative in $old){
    $target=[IO.Path]::GetFullPath((Join-Path $destination $relative))
    if(-not $target.StartsWith($resolved+'\',[StringComparison]::OrdinalIgnoreCase)){throw '旧仓库路径越界'}
    # 单文件删除，保留 .git 与所有提交历史；不执行跨 shell 或递归删除。
    if(Test-Path -LiteralPath $target -PathType Leaf){Remove-Item -LiteralPath $target}
}
$files=@(& $git.Source -C $projectRoot -c core.quotepath=false ls-files --cached --others --exclude-standard)
foreach($relative in $files){
    if($relative -match '(^|/)(\.git|\.cache|\.local|\.tools|node_modules|dist)(/|$)'){throw '待发布文件包含运行时或依赖目录'}
    $source=Join-Path $projectRoot $relative;$target=[IO.Path]::GetFullPath((Join-Path $destination $relative))
    if(-not $target.StartsWith($resolved+'\',[StringComparison]::OrdinalIgnoreCase)){throw '新源码路径越界'}
    if(-not (Test-Path -LiteralPath $source -PathType Leaf)){continue}
    [IO.Directory]::CreateDirectory((Split-Path -Parent $target))|Out-Null
    [IO.File]::Copy($source,$target,$false)
}
& $git.Source -C $destination remote set-url origin 'https://github.com/surgar04/m78deguren.git'
& $git.Source -C $destination switch -c 'codex/zhenjing-settings'
& $git.Source -C $destination add --all
& $git.Source -C $destination -c 'user.name=Codex' -c 'user.email=codex@openai.com' commit -m 'feat: replace repository contents with Zhenjing desktop toolbox'
if($LASTEXITCODE -ne 0){throw '发布快照提交失败'}
& $git.Source -C $destination log -1 --format='%H %s'
