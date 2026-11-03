$ErrorActionPreference='Stop'
. "$PSScriptRoot/env.ps1"
. "$PSScriptRoot/cpp-tools.ps1"
$tools=Find-ProjectCppTools
if(-not $tools.Ready){throw ('缺少：'+($tools.Missing -join '、')+'。请安装微软官方 C++ 桌面开发工具后重试。')}
Write-Output 'C++ 编译工具与 Windows SDK 已找到；仅只读检测，未执行系统安装。'
