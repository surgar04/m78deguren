# 仅解压微软官方便携 SDK 到项目 D 盘；不运行安装器、不改 PATH/注册表。
$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
$version='8.0.426';$directory=Join-Path $projectRoot '.tools/dotnet'
$executable=Join-Path $directory 'dotnet.exe'
if((Test-Path -LiteralPath $executable) -and (Test-Path -LiteralPath (Join-Path $directory ('sdk/'+$version)))){
    Write-Output ('已准备项目本地 .NET SDK '+$version);exit 0
}
$metadata=Invoke-RestMethod -Uri 'https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json' -TimeoutSec 60
$sdk=@($metadata.releases|ForEach-Object{@($_.sdks);$_.sdk}|Where-Object{$_.version -eq $version}|Select-Object -First 1)
if($sdk.Count -ne 1){throw '微软清单中缺少固定 SDK 版本'}
$artifact=@($sdk[0].files|Where-Object{$_.rid -eq 'win-x64' -and $_.url.EndsWith('.zip')}|Select-Object -First 1)
if($artifact.Count -ne 1 -or $artifact[0].hash -notmatch '^[a-fA-F0-9]{128}$'){throw 'SDK 下载记录或 SHA512 无效'}
$url=[uri]$artifact[0].url
if($url.Scheme -ne 'https' -or $url.Host -notin @('builds.dotnet.microsoft.com','download.visualstudio.microsoft.com')){throw 'SDK 来源不在微软白名单'}
$archive=Join-Path $projectRoot ('.cache/dotnet/sdk-'+$version+'-win-x64.zip')
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($archive))|Out-Null
if(-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash -ine $artifact[0].hash){
    Invoke-WebRequest -UseBasicParsing -Uri $url.AbsoluteUri -OutFile $archive -TimeoutSec 600
}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash -ine $artifact[0].hash){throw 'SDK ZIP 校验失败，未解压'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try{foreach($entry in $zip.Entries){
    $path=[IO.Path]::GetFullPath((Join-Path $directory $entry.FullName))
    if(-not $path.StartsWith($directory.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'SDK ZIP 包含越界路径'}
}}finally{$zip.Dispose()}
[IO.Directory]::CreateDirectory($directory)|Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
if(-not (Test-Path -LiteralPath (Join-Path $directory ('sdk/'+$version)))){throw 'SDK 解压后版本目录缺失'}
Remove-Item -LiteralPath $archive
Write-Output ('项目本地 .NET SDK '+$version+' 已校验并解压到 D 盘')
