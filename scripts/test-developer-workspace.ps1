$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
$testRoot=Join-Path $projectRoot ('.cache/verification/workspace-native-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot)|Out-Null
$control=Join-Path $testRoot 'control';$logDirectory=Join-Path $testRoot 'logs'
foreach($folder in @($control,$logDirectory)){[IO.Directory]::CreateDirectory($folder)|Out-Null}
$ownerId=$PID;$ownerStart=[Diagnostics.Process]::GetCurrentProcess().StartTime.Ticks;$runId='fixture';$step=0
# 只加载固定工作区脚本的纯辅助函数，不执行下载、安装或仓库 bootstrap。
$tokens=$null;$errors=$null
$workerPath=Join-Path $projectRoot 'src-tauri/src/services/developer/workspace.ps1'
$workerText=[Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($workerPath))
$ast=[Management.Automation.Language.Parser]::ParseInput($workerText,[ref]$tokens,[ref]$errors)
if($errors.Count){throw '工作区脚本语法错误'}
# 按原生桥接的 UTF-8 BOM 包装方式交给真实 PowerShell 解析；无效操作在任何写入前退出。
$embedded=Join-Path $testRoot 'embedded-worker.ps1'
$policy=[IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/tools/windows/storage-policy.ps1'))
[IO.File]::WriteAllText($embedded,$workerText.Replace('# __STORAGE_POLICY__',$policy),[Text.UTF8Encoding]::new($true))
$powershell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$frame=Start-Process -FilePath $powershell -ArgumentList @('-NoProfile','-File',('"'+$embedded+'"'),'-Operation','invalid','-ArgumentJson','[]') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $testRoot 'frame.out') -RedirectStandardError (Join-Path $testRoot 'frame.err')
$null=$frame.Handle;$frame.WaitForExit()
if($frame.ExitCode -ne 2){throw '原生脚本编码或参数入口未能正确解析'}
$frame.Dispose()
foreach($name in @('Check-Cancel','Quote-Native','Run-Tool','Expand-SafeZip','Sync-Source')){
    $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    if(-not $function){throw ('缺少固定测试函数：'+$name)}
    . ([ScriptBlock]::Create($function.Extent.Text))
}
. ([ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $projectRoot 'src-tauri/src/services/tools/windows/storage-policy.ps1'))))
$node=Join-Path $projectRoot '.tools/node/node.exe'
$probe=Join-Path $testRoot 'argv.cjs'
[IO.File]::WriteAllText($probe,'process.stdout.write(JSON.stringify(process.argv.slice(2)))',[Text.UTF8Encoding]::new($false))
$values=@('带 空格 & 字符','quote"inside','trailing\','$(not-code)','')
$result=Run-Tool $node (@($probe)+$values) $testRoot
$parsed=ConvertFrom-Json ('{"items":'+$result+'}')
$actual=@($parsed.items)
if($actual.Count -ne $values.Count){throw 'Windows 参数数量错误'}
for($index=0;$index -lt $values.Count;$index++){if($values[$index] -cne $actual[$index]){throw 'Windows 参数编码未保持字面值'}}
$cancelProbe=Join-Path $testRoot 'cancel.cjs'
[IO.File]::WriteAllText($cancelProbe,'const fs=require("node:fs");fs.writeFileSync(process.argv[2],String(process.pid));setTimeout(()=>fs.writeFileSync(process.argv[3],"true"),200);setInterval(()=>{},1000);',[Text.UTF8Encoding]::new($false))
$pidFile=Join-Path $testRoot 'owned-pid.txt'
$cancelFile=Join-Path $control 'cancel.json'
$cancelled=$false
try{$null=Run-Tool $node @($cancelProbe,$pidFile,$cancelFile) $testRoot}catch [OperationCanceledException]{$cancelled=$true}
if(-not $cancelled){throw '取消未生效'}
$ownedPid=[int][IO.File]::ReadAllText($pidFile)
if(Get-Process -Id $ownedPid -ErrorAction SilentlyContinue){throw '取消后本次子进程仍存活'}
Remove-Item -LiteralPath $cancelFile
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$archive=Join-Path $testRoot 'unsafe.zip';$zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
try{$entry=$zip.CreateEntry('../escape.txt');$writer=[IO.StreamWriter]::new($entry.Open());try{$writer.Write('must not escape')}finally{$writer.Dispose()}}finally{$zip.Dispose()}
$blocked=$false
try{Expand-SafeZip $archive (Join-Path $testRoot 'extracted')}catch{$blocked=$true}
if(-not $blocked -or (Test-Path -LiteralPath (Join-Path $testRoot 'escape.txt'))){throw 'ZIP 路径越界未拦截'}
. "$PSScriptRoot/cpp-tools.ps1"
$savedRoot=$projectRoot
try{
    $projectRoot=Join-Path $testRoot 'cpp-fixture'
    foreach($relative in @('.tools/msvc/bin/cl.exe','.tools/msvc/bin/link.exe','.tools/msvc/include/vector','.tools/msvc/lib/libcmt.lib','.tools/winsdk/bin/rc.exe','.tools/winsdk/lib/um/kernel32.lib','.tools/winsdk/lib/ucrt/ucrt.lib','.tools/winsdk/include/um/Windows.h')){
        $path=Join-Path $projectRoot $relative;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))|Out-Null;[IO.File]::WriteAllText($path,'fixture')
    }
    $cpp=Find-ProjectCppTools
    if(-not $cpp.Ready -or -not $cpp.MsvcLocal -or -not $cpp.SdkLocal){throw '本地工具检测错误'}
}finally{$projectRoot=$savedRoot}
$git=Get-Command git.exe -CommandType Application|Select-Object -First 1 -ExpandProperty Path
$empty=Join-Path $testRoot 'git-config';[IO.Directory]::CreateDirectory($empty)|Out-Null
$env:GIT_CONFIG_NOSYSTEM='1';$env:GIT_CONFIG_GLOBAL=Join-Path $empty 'config';$env:GIT_CONFIG_SYSTEM=$env:GIT_CONFIG_GLOBAL
[IO.File]::WriteAllText($env:GIT_CONFIG_GLOBAL,'')
$gitOptions=@('-c',('core.hooksPath='+$empty),'-c','commit.gpgsign=false','-c','user.name=WorkspaceTest','-c','user.email=test@example.com','-c','protocol.file.allow=always')
$repository=Join-Path $testRoot '上游源码';$branch='codex/develop'
$null=Run-Tool $git ($gitOptions+@('init','--initial-branch',$branch,'--',$repository)) $testRoot
[IO.File]::WriteAllText((Join-Path $repository 'entry.txt'),'first')
$null=Run-Tool $git ($gitOptions+@('-C',$repository,'add','.')) $testRoot
$null=Run-Tool $git ($gitOptions+@('-C',$repository,'commit','-m','first')) $testRoot
$workspace=Join-Path $testRoot '工作区 空间 & literal'
[IO.Directory]::CreateDirectory($workspace)|Out-Null
$source=Join-Path $workspace 'source'
$initial=Sync-Source $git $source
[IO.File]::WriteAllText((Join-Path $repository 'entry.txt'),'second')
$null=Run-Tool $git ($gitOptions+@('-C',$repository,'add','.')) $testRoot
$null=Run-Tool $git ($gitOptions+@('-C',$repository,'commit','-m','second')) $testRoot
$latest=Sync-Source $git $source
if($initial -eq $latest -or [IO.File]::ReadAllText((Join-Path $source 'entry.txt')) -cne 'second'){throw '源码快进更新未生效'}
[IO.File]::WriteAllText((Join-Path $source 'local-edit.txt'),'user content')
$refused=$false
try{$null=Sync-Source $git $source}catch{$refused=$true}
if(-not $refused -or [IO.File]::ReadAllText((Join-Path $source 'local-edit.txt')) -cne 'user content'){throw '本地改动未保护'}
Write-Output ('工作区原生辅助测试通过：参数编码、取消进程树、ZIP 越界、本地工具发现、真实 Git 克隆与快进、改动保护。夹具：'+$testRoot)
