param([ValidateRange(1,999999)][int]$DeveloperBuild=1)
$ErrorActionPreference='Stop'
# 成对产物顺序生成，避免 MSI staging 及本机资源竞争；两个分发目录相互独立。
& "$PSScriptRoot\package.ps1" -Edition stable
& "$PSScriptRoot\package.ps1" -Edition developer -DeveloperBuild $DeveloperBuild
Write-Output '稳定版与开发者版 MSI 已分别生成；上传仍须按分支及审核流程执行。'
