$ErrorActionPreference='Stop'
. "$PSScriptRoot\env.ps1"
# 与 Tauri 上游固定的 WiX 3.14.1 工具一致；只解压便携工具，不安装系统软件。
$directory=Join-Path $projectRoot '.tools\tauri-bundler\WixTools314'
if(Test-Path -LiteralPath (Join-Path $directory 'light.exe')){return}
$download=Join-Path $projectRoot '.tools\downloads\wix314-binaries.zip'
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($download))|Out-Null
if(-not (Test-Path -LiteralPath $download)){
    Invoke-WebRequest -Uri 'https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip' -OutFile $download
}
if((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ine '6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31'){throw 'WiX 官方工具包 SHA256 不匹配'}
Expand-Archive -LiteralPath $download -DestinationPath $directory -Force
foreach($name in @('candle.exe','light.exe','darice.cub','WixUIExtension.dll','WixUtilExtension.dll')){
    if(-not (Test-Path -LiteralPath (Join-Path $directory $name))){throw ('WiX 缺少工具：'+$name)}
}
Write-Output '已准备 D 盘 WiX 3.14.1 便携工具，下载哈希通过。'
