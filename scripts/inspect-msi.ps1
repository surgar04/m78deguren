param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
$msiInspectionInput=[IO.Path]::GetFullPath($Path)
$msiInspectionOutput=[IO.Path]::GetFullPath($Output)
. "$PSScriptRoot\env.ps1"
# 批量读取相同的只读 MSI 接口，避免万级文件逐字段跨 COM/PowerShell 调度。
# 编译仅在 D 盘临时目录进行；该构建工具不进入应用安装包。
Add-Type -ReferencedAssemblies System.Web.Extensions -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'msi-inspector.cs')))
[Zhenjing.Build.MsiInspector]::ReadToFile($msiInspectionInput,$msiInspectionOutput)
