param([string]$Operation,[string]$ArgumentJson)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
# 本文件作为 Rust 内嵌资源保持 UTF-8 无 BOM；原生桥接负责写入单个 BOM。
# __STORAGE_POLICY__
$arguments=ConvertFrom-Json $ArgumentJson
if($Operation -ne 'developer-workspace' -or $arguments.Count -ne 3){[Console]::Error.WriteLine('Invalid developer workspace operation');exit 2}
$workspace=Assert-LocalPath ([string]$arguments[0])
$control=Assert-LocalPath ([string]$arguments[1])
$ownerId=[int]$arguments[2]
$ownerStart=[Diagnostics.Process]::GetProcessById($ownerId).StartTime.Ticks
$repository='https://github.com/surgar04/m78deguren.git'
$branch='codex/develop'
$commit=$null
$logDirectory=Join-Path $workspace '.zhenjing-setup'
[IO.Directory]::CreateDirectory($logDirectory)|Out-Null
$runId=[Guid]::NewGuid().ToString('N')
$step=0

function Check-Cancel {
    $alive=$false
    try{$alive=[Diagnostics.Process]::GetProcessById($ownerId).StartTime.Ticks -eq $ownerStart}catch{}
    if(-not $alive -or (Test-Path -LiteralPath (Join-Path $control 'cancel.json'))){throw [OperationCanceledException]::new('开发环境准备已取消；已有源码和下载缓存保留，可重新准备')}
}
function Progress([string]$message){
    Check-Cancel
    $value=@{phase='preparing';message=$message;commit=$null}|ConvertTo-Json -Compress
    $temporary=Join-Path $control 'progress.tmp'
    [IO.File]::WriteAllText($temporary,$value,[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination (Join-Path $control 'progress.json') -Force
}
function Quote-Native([string]$value){
    # Windows CRT 参数编码，不经过 -Command 或 cmd /c，路径中的字符不作为代码解释。
    return '"'+[regex]::Replace([regex]::Replace($value,'(\\*)"','$1$1\"'),'(\\+)$','$1$1')+'"'
}
function Run-Tool([string]$executable,[string[]]$values,[string]$cwd){
    Check-Cancel
    $script:step++
    $output=Join-Path $logDirectory ($runId+'-'+$script:step+'.out.log')
    $errors=Join-Path $logDirectory ($runId+'-'+$script:step+'.err.log')
    $line=(@($values|ForEach-Object{Quote-Native $_}) -join ' ')
    $process=Start-Process -FilePath $executable -ArgumentList $line -WorkingDirectory $cwd -RedirectStandardOutput $output -RedirectStandardError $errors -PassThru -WindowStyle Hidden
    $null=$process.Handle
    $watch=[Diagnostics.Stopwatch]::StartNew()
    try{
        while(-not $process.HasExited){
            Check-Cancel
            if($watch.Elapsed.TotalMinutes -gt 60){throw '开发工具执行超时，可查看工作区日志后重试'}
            foreach($log in @($output,$errors)){if((Get-Item -LiteralPath $log -ErrorAction SilentlyContinue).Length -gt 16777216){throw '工具输出超过日志上限，已停止任务'}}
            Start-Sleep -Milliseconds 500
            $process.Refresh()
        }
        $process.WaitForExit()
        if($process.ExitCode -ne 0){throw ('开发工具执行失败，请查看日志：'+$errors)}
        return [IO.File]::ReadAllText($output)
    }finally{
        if(-not $process.HasExited){
            # 只结束本次启动且仍存活的子进程树，不按名称结束用户的其他 Git / Node / Rust。
            & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID ([string]$process.Id) /T /F 2>&1|Out-Null
            $process.WaitForExit(5000)|Out-Null
        }
        $process.Dispose()
    }
}
function Expand-SafeZip([string]$archive,[string]$destination){
    $destination=Assert-LocalPath $destination
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try{foreach($entry in $zip.Entries){
        $target=[IO.Path]::GetFullPath((Join-Path $destination $entry.FullName))
        if(-not $target.StartsWith($destination.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw '便携工具压缩包包含越界路径或链接'}
        $null=Assert-LocalPath $target
    }}finally{$zip.Dispose()}
    [IO.Directory]::CreateDirectory($destination)|Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
}
function Download-Git([string]$url,[string]$destination,[string]$sha256){
    Add-Type -AssemblyName System.Net.Http
    $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
    $client=[Net.Http.HttpClient]::new($handler);$client.Timeout=[TimeSpan]::FromMinutes(10)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('Zhenjing-Developer-Workspace/1')
    $partial=$destination+'.part'
    try{
        for($redirect=0;$redirect -lt 8;$redirect++){
            Check-Cancel
            $uri=[uri]$url
            if($uri.Scheme -ne 'https' -or $uri.Port -ne 443 -or $uri.Host -notin @('github.com','release-assets.githubusercontent.com','objects.githubusercontent.com')){throw 'Git 下载重定向越过官方白名单'}
            $response=$client.GetAsync($uri,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            if([int]$response.StatusCode -in @(301,302,303,307,308)){$url=[uri]::new($uri,$response.Headers.Location).AbsoluteUri;$response.Dispose();continue}
            $response.EnsureSuccessStatusCode()|Out-Null
            if($response.Content.Headers.ContentLength -gt 209715200){throw 'Git ZIP 超过大小上限'}
            $downloadStream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $file=[IO.File]::Open($partial,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try{
                $buffer=New-Object byte[] 65536;$total=0
                while($true){
                    Check-Cancel
                    $timeout=[Threading.CancellationTokenSource]::new(30000)
                    try{$read=$downloadStream.ReadAsync($buffer,0,$buffer.Length,$timeout.Token).GetAwaiter().GetResult()}finally{$timeout.Dispose()}
                    if($read -eq 0){break};$total+=$read
                    if($total -gt 209715200){throw 'Git ZIP 超过大小上限'}
                    $file.Write($buffer,0,$read)
                }
            }finally{$file.Dispose();$downloadStream.Dispose();$response.Dispose()}
            if((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $sha256){throw 'Git 官方资产摘要不匹配，未解压或执行'}
            Move-Item -LiteralPath $partial -Destination $destination -Force
            return
        }
        throw 'Git 下载重定向次数过多'
    }finally{$client.Dispose();$handler.Dispose()}
}
function Sync-Source([string]$git,[string]$source){
    if(Test-Path -LiteralPath $source){
        $null=Assert-LocalPath $source
        if((Run-Tool $git ($gitOptions+@('-C',$source,'remote','get-url','origin')) $workspace).Trim() -cne $repository){throw '已有源码的 origin 不属于固定仓库'}
        if((Run-Tool $git ($gitOptions+@('-C',$source,'branch','--show-current')) $workspace).Trim() -cne $branch){throw '源码已切换到其他分支，请自行处理后重试'}
        if((Run-Tool $git ($gitOptions+@('-C',$source,'status','--porcelain')) $workspace).Trim()){throw '已有源码包含未提交改动，未覆盖；请提交或保存改动后重试'}
        $null=Run-Tool $git ($gitOptions+@('-C',$source,'fetch','origin',$branch)) $workspace
        $null=Run-Tool $git ($gitOptions+@('-C',$source,'merge','--ff-only','FETCH_HEAD')) $workspace
    }else{
        $stage=Join-Path $workspace ('.clone-'+$runId)
        $null=Run-Tool $git ($gitOptions+@('clone','--single-branch','--no-recurse-submodules','--depth','100','--branch',$branch,'--',$repository,$stage)) $workspace
        Move-Item -LiteralPath $stage -Destination $source
    }
    $commit=(Run-Tool $git ($gitOptions+@('-C',$source,'rev-parse','HEAD')) $workspace).Trim()
    if($commit -notmatch '^[a-f0-9]{40}$'){throw '源码提交标识无效'}
    return $commit
}
try{
    # 清除可能改变子工具行为的凭据和注入配置；所有修改仅作用于此工作进程。
    foreach($entry in @(Get-ChildItem Env:)){if($entry.Name -match '^(GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS|NPM_TOKEN)$|^GIT_'){[Environment]::SetEnvironmentVariable($entry.Name,$null,'Process')}}
    $marker=Join-Path $workspace '.zhenjing-workspace.json'
    if(Test-Path -LiteralPath $marker){
        $owned=[IO.File]::ReadAllText($marker)|ConvertFrom-Json
        if($owned.repository -cne $repository -or $owned.branch -cne $branch){throw '工作区归属不匹配'}
    }else{
        if(@(Get-ChildItem -LiteralPath $workspace -Force |Where-Object{$_.Name -ne '.zhenjing-setup'}).Count){throw '目标目录不为空，未覆盖已有文件'}
        [IO.File]::WriteAllText($marker,(@{repository=$repository;branch=$branch}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    }
    $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($workspace))
    if($drive.AvailableFreeSpace -lt 16106127360){throw '开发工作区至少需要 15 GiB 可用空间，请更换目录'}
    $downloads=Join-Path $logDirectory 'downloads';[IO.Directory]::CreateDirectory($downloads)|Out-Null
    Progress '正在准备便携 Git（不会安装到系统或修改全局 PATH）…'
    $git=Join-Path $logDirectory 'git/cmd/git.exe'
    if(-not (Test-Path -LiteralPath $git)){
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        $release=Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{'User-Agent'='Zhenjing-Developer-Workspace/1'} -TimeoutSec 60
        $asset=@($release.assets|Where-Object{$_.name -match '^MinGit-[0-9][0-9.]*-64-bit\.zip$'}|Select-Object -First 1)
        if($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:([a-f0-9]{64})$'){throw 'Git 官方资产缺少可校验的 SHA256，未使用未验证的下载'}
        $digest=([string]$asset[0].digest).Substring(7);$url=[string]$asset[0].browser_download_url
        if(-not $url.StartsWith('https://github.com/git-for-windows/git/releases/download/',[StringComparison]::Ordinal)){throw 'Git 资产来源不匹配'}
        $archive=Join-Path $downloads 'mingit.zip'
        Download-Git $url $archive $digest
        Expand-SafeZip $archive (Join-Path $logDirectory 'git')
    }
    if(-not (Test-Path -LiteralPath $git)){throw '便携 Git 布局不完整'}
    $empty=Join-Path $logDirectory 'git-empty';[IO.Directory]::CreateDirectory($empty)|Out-Null
    $env:GIT_CONFIG_NOSYSTEM='1';$env:GIT_CONFIG_GLOBAL=Join-Path $empty 'config';$env:GIT_CONFIG_SYSTEM=$env:GIT_CONFIG_GLOBAL
    $env:GIT_TEMPLATE_DIR=$empty;$env:GIT_TERMINAL_PROMPT='0'
    [IO.File]::WriteAllText($env:GIT_CONFIG_GLOBAL,'',[Text.UTF8Encoding]::new($false))
    $gitOptions=@('-c',('core.hooksPath='+$empty),'-c','core.symlinks=false','-c','credential.helper=','-c','protocol.allow=never','-c','protocol.https.allow=always')
    $source=Join-Path $workspace 'source'
    Progress '正在读取固定仓库 codex/develop 最新源码…'
    $commit=Sync-Source $git $source
    if(-not [IO.File]::ReadAllText((Join-Path $source 'scripts/env.ps1')).Contains('ZHENJING_WORKSPACE_ROOT')){throw '开发分支尚未包含工作区支持，请先审核并推送相应源码后重试'}
    $env:ZHENJING_WORKSPACE_ROOT=$source
    if($env:ZHENJING_RESTRICT_WRITES_TO_D -ne '1'){$env:ZHENJING_RESTRICT_WRITES_TO_D='0'}
    $env:PATH=(Split-Path $git)+';'+$env:PATH
    $env:DOTNET_CLI_USE_MSBUILD_SERVER='0'
    $local=Join-Path $source '.local';[IO.Directory]::CreateDirectory($local)|Out-Null
    [IO.File]::WriteAllText((Join-Path $local 'workspace-profile.json'),(@{root=$source;repository=$repository;branch=$branch}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $powershell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    Progress '正在准备项目内 Node、pnpm 和 Rust 工具链…'
    $null=Run-Tool $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $source 'scripts/bootstrap.ps1'),'-ToolsOnly') $source
    Progress '正在准备项目内 .NET SDK…'
    $null=Run-Tool $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $source 'scripts/prepare-dotnet.ps1')) $source
    $launcher=@'
$ErrorActionPreference='Stop'
$env:ZHENJING_WORKSPACE_ROOT=Join-Path $PSScriptRoot 'source'
if($env:ZHENJING_RESTRICT_WRITES_TO_D -ne '1'){$env:ZHENJING_RESTRICT_WRITES_TO_D='0'}
. (Join-Path $env:ZHENJING_WORKSPACE_ROOT 'scripts/env.ps1')
Write-Host '臻境开发终端：工具和缓存均在此工作区；运行 .\dev.ps1 desktop:dev 启动开发。'
'@
    [IO.File]::WriteAllText((Join-Path $workspace 'Start-DeveloperShell.ps1'),$launcher,[Text.UTF8Encoding]::new($true))
    [IO.File]::WriteAllText((Join-Path $workspace 'Open-DeveloperShell.cmd'),'@powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0Start-DeveloperShell.ps1"',[Text.Encoding]::ASCII)
    Progress '正在检测 C++ 编译器和 Windows SDK，并按锁文件安装依赖…'
    $probe=Join-Path $source 'scripts/find-cpp-tools.ps1'
    if(-not (Test-Path -LiteralPath $probe)){throw '开发分支缺少编译器检测入口'}
    try{$null=Run-Tool $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',$probe) $source}catch [OperationCanceledException]{throw}catch{
        @{phase='action-required';message='便携工具已准备。缺少 MSVC / Windows SDK，请通过微软官方入口安装“使用 C++ 的桌面开发”及 Windows SDK，然后重新准备；未执行任何系统安装。';commit=$commit}|ConvertTo-Json -Compress
        exit 0
    }
    $null=Run-Tool $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $source 'scripts/bootstrap.ps1')) $source
    Progress '正在准备音乐原生依赖和引擎资源（不构建桌面应用或安装包）…'
    $null=Run-Tool $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $source 'dev.ps1'),'music:prepare') $source
    Progress '正在检查开发工具链…'
    $null=Run-Tool $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $source 'dev.ps1'),'env:check') $source
    @{phase='ready';message='源码、隔离工具链和依赖已准备。打开工作区中的 Open-DeveloperShell.cmd 即可开始开发。';commit=$commit}|ConvertTo-Json -Compress
}catch [OperationCanceledException]{
    @{phase='cancelled';message=$_.Exception.Message;commit=$commit}|ConvertTo-Json -Compress
}catch{
    @{phase='failed';message=($_.Exception.Message|Out-String).Trim();commit=$commit}|ConvertTo-Json -Compress
}
