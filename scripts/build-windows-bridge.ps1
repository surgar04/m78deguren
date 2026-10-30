# 构建期生成 .NET Framework DLL。最终用户不需要编译器；运行时仅加载已校验的安装文件。
$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw|ConvertFrom-Json).version
$relative=@(
 'src-tauri/src/services/home/native.cs','src-tauri/src/services/home/wheel.cs',
 'src-tauri/src/services/tools/windows/native.cs','src-tauri/src/services/tools/windows/nvidia.cs',
 'src-tauri/src/services/tools/windows/driver.cs','src-tauri/src/services/tools/windows/color.cs',
 'src-tauri/src/services/tools/windows/optimizer.cs',
 'native/windows-bridge/Clicker.cs','native/windows-bridge/KeyState.cs','native/windows-bridge/MediaInput.cs'
)
$stage=Join-Path $projectRoot ('.cache/dotnet/windows-bridge/'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($stage)|Out-Null
$metadata=Join-Path $stage 'AssemblyInfo.cs'
$assemblyInfo="[assembly:System.Reflection.AssemblyVersion(`"$version.0`")]`n[assembly:System.Reflection.AssemblyFileVersion(`"$version.0`")]`n[assembly:System.Reflection.AssemblyCompany(`"Sur方糖`")]`n[assembly:System.Reflection.AssemblyProduct(`"臻境 Windows 组件`")]"
[IO.File]::WriteAllText($metadata,$assemblyInfo,[Text.UTF8Encoding]::new($true))
$paths=@($relative|ForEach-Object{Join-Path $projectRoot $_})+@($metadata)
$output=Join-Path $stage 'Zhenjing.Windows.dll'
# 固定 SDK 的 Roslyn 生成确定性 DLL；仅只读引用 Windows 已有 .NET Framework 程序集。
$sdk=Join-Path $projectRoot '.tools/dotnet/dotnet.exe'
$compiler=Join-Path $projectRoot '.tools/dotnet/sdk/8.0.426/Roslyn/bincore/csc.dll'
$framework=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319'
$arguments=@($compiler,'/nologo','/target:library','/deterministic+','/debug-','/optimize+','/langversion:5','/utf8output',('/out:'+$output),('/pathmap:'+$stage+'=/_/generated,'+$projectRoot+'=/_/'))
foreach($name in @('mscorlib','System','System.Drawing','System.Windows.Forms','System.Web.Extensions','System.Core')){$arguments+=('/reference:'+(Join-Path $framework ($name+'.dll')))}
& $sdk @arguments @paths
if($LASTEXITCODE -ne 0){throw 'Windows DLL 编译失败'}
$target=Join-Path $projectRoot 'src-tauri/resources/windows-bridge'
[IO.Directory]::CreateDirectory($target)|Out-Null
Copy-Item -LiteralPath $output -Destination (Join-Path $target 'Zhenjing.Windows.dll') -Force
$sources=@{}
foreach($relativePath in $relative){$sources[$relativePath]=(Get-FileHash -LiteralPath (Join-Path $projectRoot $relativePath)).Hash.ToLowerInvariant()}
$sources['scripts/build-windows-bridge.ps1']=(Get-FileHash -LiteralPath $PSCommandPath).Hash.ToLowerInvariant()
$manifest=@{schema=1;version=$version;targetFramework='net48';files=@{'Zhenjing.Windows.dll'=(Get-FileHash -LiteralPath $output).Hash.ToLowerInvariant()};sources=$sources}
[IO.File]::WriteAllText((Join-Path $target 'manifest.json'),($manifest|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
& (Join-Path $projectRoot '.tools/node/node.exe') (Join-Path $projectRoot 'node_modules/prettier/bin/prettier.cjs') --write (Join-Path $target 'manifest.json')
if($LASTEXITCODE -ne 0){throw 'Windows DLL 清单格式处理失败'}
Write-Output 'Windows C# 组件已构建为显式 DLL。'
