# 安装组件与 DLL 布局（0.9.1）

MSI 显式安装应用组件，C# 源码不再内嵌后动态编译，硬件助手不再作为 Rust 内嵌单文件程序解包到用户数据目录。

```text
安装目录/
  zhenjing.exe
  zhenjing-install.ini
  zhenjing-profile.ini
  THIRD_PARTY_NOTICES.md
  components/
    windows-bridge/
      Zhenjing.Windows.dll
      manifest.json
    monitor/
      ZhenjingMonitor.exe
      ZhenjingMonitor.dll
      ZhenjingMonitor.deps.json
      ZhenjingMonitor.runtimeconfig.json
      LibreHardwareMonitorLib.dll
      System.Management.dll
      hostfxr.dll / hostpolicy.dll / coreclr.dll
      其余自包含 .NET 8 运行库 DLL
      ECPFrames-x64.exe
  licenses/
    MiSans-License.pdf
    Sysinfo-MIT.txt
    其他组件许可及 hardware/ 子目录
```

`Zhenjing.Windows.dll` 集中提供首页控制、轮盘、图标、显示、NVIDIA、驱动、注册表值适配、按键状态、连点输入和媒体 stdin 读取等固定接口。构建使用 D 盘固定 SDK 的 Roslyn，生成确定性 .NET Framework DLL，只读引用 Windows 已有框架程序集。生产运行不需要编译器。

`ZhenjingMonitor.dll` 承载 C# 硬件和 HUD 引擎。`ZhenjingMonitor.exe` 是必要的 .NET 自包含进程宿主，另外保留原生帧采集器和 .NET 原生诊断组件；不能将进程入口简单重命名为 DLL。所有 .NET 8 依赖随 MSI 安装，用户不需要 SDK 或全局 .NET 运行时。

## 加载与完整性

- 发布版只从当前 EXE 所在安装目录的 `components` 加载；开发工作区回退只编译进调试版。
- 组件清单包含源文件摘要和全部发布文件摘要。Cargo 构建校验来源、组件版本和文件 SHA256，不允许仅改清单绕过重新编译。
- Rust 在启动硬件进程前校验并锁定整个组件集合。PowerShell 调度只加载已预编译 DLL，加载前再次验证摘要并持有只读句柄，覆盖 UAC 等待阶段的替换竞态。
- 组件缺失或损坏时明确要求修复 MSI，不从用户缓存找其他 DLL，也不回退运行时编译。
- 固定 PowerShell 调度脚本仍按内容哈希生成到应用数据目录；脚本不再包含 C# 源码。设置、日志、下载、备份和监测历史保持位于用户数据目录。
- 旧版本遗留缓存不参与新组件加载，升级继续保留用户数据。

## MSI 与发布

安装文件逐项进入 MSI File/Component/Directory 表，组件 GUID 由稳定安装相对路径确定；采用当前用户 HKCU 登记和标准卸载目录清理。升级标识、应用 ID、Sur方糖自签 MSI 证书以及 Ed25519 更新信任保持不变。

`scripts/generate-msi-components.ts` 从受校验的发布清单生成安装条目，并补全现有模板遗漏的 MiSans/Sysinfo 许可。安装器测试从真实 CAB 文件和 MSI 表重建安装布局，再核对每一个 DLL 的摘要；此过程不执行安装动作或修改系统登记。

所有构建、依赖、暂存、解包和独立运行验收文件均留在 D 盘。正式发行仍仅生成 MSI，不生成便携版或 MSIX。
