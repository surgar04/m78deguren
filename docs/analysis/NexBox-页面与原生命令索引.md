# NexBox 页面与原生命令索引

分析日期：2026-10-24。版本：10.2.1。固定源码提交：`e7ad6a0bb9197e206bb9a719ca86c6353a5cad43`。

配套阅读：[功能全景与实现分析](./NexBox-功能全景与实现分析.md)、[201 个系统优化配置项](./NexBox-系统优化配置项清单.md)。

## 1. 统计口径

本索引从 TypeScript AST、App.tsx 路由及 Rust 的 Tauri 命令声明/主程序注册表提取，随后核对关键入口。统计的是源码结构，不能等同于独立功能数或实测通过数。

- src/pages 直属 TSX 文件：60 个，包含内嵌面板和独立窗口。
- App.tsx 中声明式 Route 条目：53 个，包含别名、旧地址重定向和商店版条件路由。
- 此外有主页与工具页 2 个常驻挂载地址、5 个独立窗口分支。
- 主程序 generate_handler!：629 个不同的注册路径。不同编译条件、权限与平台限制会影响运行时可用性。
- 主程序 src-tauri/src 内检测到 637 处带 Tauri 命令属性的函数声明，含条件编译下的同名实现；多项目范围合计 649 处。声明数量与注册数量采用不同口径，不能据差值判断缺陷。
- 页面表只列该文件直接调用的字面量 invoke/safeInvoke。经 store、context、hook、组件或动态字符串间接调用的接口不会出现在该行；“无直接调用”不表示没有功能。

## 2. 主窗口声明式路由

| 地址                              | 元素                                                 | 定义位置                                                                                                      |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/hardware`                       | 硬件监控（HardwarePage）                             | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L146) |
| `/builtin-tools`                  | 内置工具入口（BuiltinToolsPage）                     | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L152) |
| `/optimization`                   | 优化工具入口（OptimizePage）                         | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L158) |
| `/optimize`                       | 优化工具入口（OptimizePage）                         | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L164) |
| `/optimize/memory-cleanup`        | 内存清理（MemoryCleanupPage）                        | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L170) |
| `/optimize/ace-optimize`          | AceOptimizePage（AceOptimizePage）                   | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L176) |
| `/optimize/game-process-optimize` | 游戏进程优化（GameProcessOptimizePage）              | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L182) |
| `/optimize/memory-limit`          | 系统可用内存限制（MemoryLimitPage）                  | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L188) |
| `/display-filter`                 | 显示滤镜（DisplayFilterPage）                        | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L194) |
| `/settings`                       | 设置（SettingsPage）                                 | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L200) |
| `/crosshair`                      | 辅助准心（CrosshairPage）                            | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L206) |
| `/autoclicker`                    | 连点器（AutoClickerPage）                            | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L212) |
| `/disk-health`                    | 磁盘健康（DiskHealthPage）                           | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L218) |
| `/overlay-panel`                  | 硬件悬浮框设置（OverlayPanelPage）                   | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L224) |
| `/delta-force`                    | 三角洲专区（DeltaForcePage）                         | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L230) |
| `/delta-force/other-platforms`    | 其他改枪码平台（OtherGunCodePlatformsPage）          | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L236) |
| `/delta-force/random-equipment`   | 随机装备（DeltaForceRoulettePage）                   | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L242) |
| `/delta-force/stats`              | 三角洲战绩分析（DeltaStatsPage）                     | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L248) |
| `/delta-force/streamers`          | 主播目录（StreamerDirectoryPage）                    | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L254) |
| `/delta-force/streamers/:id`      | 主播配置详情（StreamerProfilePage）                  | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L260) |
| `/gpu-rename`                     | 显卡名称修改（GpuRenamePage）                        | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L266) |
| `/resolution-converter`           | 分辨率换算/注入（ResolutionConverterPage）           | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L272) |
| `/optimize/shader-cache`          | 显卡着色器缓存（ShaderCachePage）                    | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L278) |
| `/optimize/pso-cache`             | UE PSO 缓存（PsoCachePage）                          | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L284) |
| `/optimize/power-management`      | 电源计划（PowerManagementPage）                      | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L290) |
| `/optimize/storage-clean`         | 存储清理（StorageCleanPage）                         | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L296) |
| `/optimize/startup-manager`       | 启动项与系统服务（StartupManagerPage）               | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L302) |
| `/system-optimizer`               | Windows 注册表优化（SystemOptimizerPage）            | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L308) |
| `/optimize/system-optimizer`      | Navigate（Navigate）                                 | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L315) |
| `/optimize/network-optimizer`     | 网络优化（NetworkOptimizerPage）                     | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L321) |
| `/optimize/peripheral-optimize`   | 外设参数优化（PeripheralOptimizePage）               | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L327) |
| `/optimize/windows-update`        | Windows 更新管理（WindowsUpdatePage）                | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L333) |
| `/optimize/cpu-scheduler`         | CPU 调度（CpuSchedulerPage）                         | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L339) |
| `/dlss-preset`                    | DLSS 预设（DLSSPresetPage）                          | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L345) |
| `/audio-eq`                       | 音频均衡器（AudioEqPage）                            | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L351) |
| `/nvidia-driver`                  | NVIDIA 驱动参数（NvidiaDriverPage）                  | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L357) |
| `/nvidia-driver-download`         | NVIDIA 驱动查找/官网入口（NvidiaDriverDownloadPage） | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L365) |
| `/steam`                          | Steam 管理（SteamPage）                              | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L372) |
| `/epic-free`                      | Epic 免费游戏（EpicFreePage）                        | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L378) |
| `/music`                          | 音乐播放器（MusicPage）                              | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L384) |
| `/custom`                         | 自定义快捷面板（CustomPage）                         | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L390) |
| `/speedtest`                      | 网络测速（SpeedTestPage）                            | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L396) |
| `/runtime-repair`                 | 运行库修复（RuntimeRepairPage）                      | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L402) |
| `/app-manager`                    | 应用管理（AppManagerPage）                           | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L408) |
| `/vtx-virtualization`             | VBS/HVCI/Hyper-V 设置（VtxVirtualizationPage）       | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L414) |
| `/hidden-features`                | Windows 隐藏特性（HiddenFeaturesPage）               | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L420) |
| `/context-menu`                   | 右键菜单/此电脑管理（ContextMenuManagerPage）        | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L426) |
| `/download-accelerator`           | 下载加速器（DownloadAcceleratorPage）                | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L432) |
| `/nvidia-recording`               | 已有录屏文件管理（NvidiaRecordingPage）              | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L438) |
| `/vac-repair`                     | VAC 修复（VacRepairPage）                            | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L444) |
| `/time-sync`                      | NTP 时间同步（TimeSyncPage）                         | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L450) |
| `/screen-test`                    | 屏幕测试（ScreenTestPage）                           | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L456) |
| `/bsod-log`                       | 蓝屏证据分析（BsodLogPage）                          | [App.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/App.tsx#L462) |

旧路径 /optimize/system-optimizer 的元素为 Navigate，跳转到 /system-optimizer。/nvidia-driver-download 仅在非 Store 构建分支注册。主页 / 与工具页 /tools 由常驻 Box 承载，不在上述 Route 表内；工具入口在 Store 导航隐藏。

独立分支：/dynamic-island、/desktop-lyrics、/vertical-overlay、/sensor-monitor、/mood。AdvancedPage 在设置页的 advanced 项渲染；CpuIsolationPanel 在 CPU 调度页渲染。

## 3. 全部页面文件及其直接 IPC 调用

### 高级设置内嵌面板

[src/pages/AdvancedPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L1)，688 行。

[`set_media_keys_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L127)、[`set_dynamic_island_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L154)、[`get_storage_sizes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L165)、[`check_pawnio_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L175)、[`get_game_filter_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L186)、[`uninstall_pawnio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L227)、[`restart_monitor_process`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L228)、[`clear_cache`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L242)、[`clear_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L256)、[`restart_app`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L259)、[`add_custom_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L294)、[`remove_custom_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AdvancedPage.tsx#L307)。

### 反作弊进程优化

[src/pages/AntiCheatOptimizePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AntiCheatOptimizePage.tsx#L1)，394 行。

[`anticheat_get_groups`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AntiCheatOptimizePage.tsx#L184)、[`anticheat_get_auto_detect_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AntiCheatOptimizePage.tsx#L207)、[`anticheat_set_auto_detect`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AntiCheatOptimizePage.tsx#L245)。

### 应用管理

[src/pages/AppManagerPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AppManagerPage.tsx#L1)，599 行。

[`list_installed_apps`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AppManagerPage.tsx#L160)、[`get_app_icons`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AppManagerPage.tsx#L165)、[`open_app`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AppManagerPage.tsx#L229)、[`uninstall_app`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AppManagerPage.tsx#L252)。

### 音频均衡器

[src/pages/AudioEqPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L1)，1685 行。

[`check_virtual_audio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L523)、[`get_eq_engine_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L693)、[`get_eq_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L525)、[`list_audio_devices`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L746)、[`install_virtual_audio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L629)、[`uninstall_virtual_audio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L655)、[`start_eq_engine`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L682)、[`update_eq_bands`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L1004)、[`update_eq_preamp`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L734)、[`update_eq_effects`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L1435)、[`stop_eq_engine`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L711)、[`apply_eq_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L779)、[`import_eq_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L942)、[`delete_eq_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L1041)、[`save_eq_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L1581)、[`export_fac_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AudioEqPage.tsx#L1603)。

### 连点器

[src/pages/AutoClickerPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AutoClickerPage.tsx#L1)，427 行。

[`autoclicker_get_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AutoClickerPage.tsx#L140)、[`get_autoclicker_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AutoClickerPage.tsx#L156)、[`autoclicker_update`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AutoClickerPage.tsx#L178)、[`set_autoclicker_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/AutoClickerPage.tsx#L200)。

### 蓝屏证据分析

[src/pages/BsodLogPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/BsodLogPage.tsx#L1)，714 行。

[`bsod_collect_evidence`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/BsodLogPage.tsx#L408)、[`bsod_open_dump_dir`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/BsodLogPage.tsx#L422)、[`bsod_reveal_dump`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/BsodLogPage.tsx#L425)。

### 内置工具入口

[src/pages/BuiltinToolsPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/BuiltinToolsPage.tsx#L1)，328 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### 右键菜单/此电脑管理

[src/pages/ContextMenuManagerPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ContextMenuManagerPage.tsx#L1)，783 行。

[`scan_context_menu_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ContextMenuManagerPage.tsx#L176)、[`scan_this_pc_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ContextMenuManagerPage.tsx#L197)、[`scan_drives`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ContextMenuManagerPage.tsx#L216)、[`hide_context_menu_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ContextMenuManagerPage.tsx#L233)、[`restore_context_menu_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ContextMenuManagerPage.tsx#L262)、[`hide_this_pc_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ContextMenuManagerPage.tsx#L293)、[`restore_this_pc_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ContextMenuManagerPage.tsx#L324)。

### CPU 隔离内嵌面板

[src/pages/CpuIsolationPanel.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuIsolationPanel.tsx#L1)，1014 行。

[`get_isolation_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuIsolationPanel.tsx#L196)、[`get_isolation_rules`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuIsolationPanel.tsx#L207)、[`apply_core_isolation`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuIsolationPanel.tsx#L308)、[`restore_core_isolation`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuIsolationPanel.tsx#L341)、[`save_isolation_rule`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuIsolationPanel.tsx#L384)、[`apply_isolation_rule_by_name`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuIsolationPanel.tsx#L416)、[`delete_isolation_rule`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuIsolationPanel.tsx#L447)。

### CPU 调度

[src/pages/CpuSchedulerPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L1)，961 行。

[`get_cpu_topology`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L184)、[`get_process_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L223)、[`get_saved_rules`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L208)、[`get_process_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L307)、[`set_process_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L290)、[`restore_process_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L305)、[`save_rule`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L326)、[`delete_rule`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L338)、[`apply_rule_by_name`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CpuSchedulerPage.tsx#L348)。

### 辅助准心

[src/pages/CrosshairPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L1)，1674 行。

[`get_crosshair_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L277)、[`update_crosshair_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L440)、[`get_crosshair_displays`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L297)、[`get_crosshair_hold_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L306)、[`get_crosshair_hold_key`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L308)、[`get_crosshair_hold_delay`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L310)、[`set_crosshair_hold_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L321)、[`set_crosshair_hold_delay`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L351)、[`set_crosshair_hold_key`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L372)、[`pick_crosshair_image`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L392)、[`get_preset_crosshair_path`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L403)、[`toggle_crosshair`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CrosshairPage.tsx#L458)。

### 自定义快捷面板

[src/pages/CustomPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/CustomPage.tsx#L1)，706 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### 三角洲专区

[src/pages/DeltaForcePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaForcePage.tsx#L1)，1392 行。

[`get_delta_passwords`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaForcePage.tsx#L147)、[`open_platform_window`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaForcePage.tsx#L391)。

### 随机装备

[src/pages/DeltaForceRoulettePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaForceRoulettePage.tsx#L1)，613 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### 三角洲战绩分析

[src/pages/DeltaStatsPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L1)，2373 行。

[`get_df_stats_cached_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L2213)、[`df_stats_qr_gen`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L259)、[`df_stats_qr_wx_gen`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L266)、[`df_stats_qr_poll`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L309)、[`df_stats_qr_wx_poll`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L328)、[`df_stats_battle_report_season`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L663)、[`refresh_df_stats_collect`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L2210)、[`df_stats_battle_detail`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L916)、[`df_stats_map_stats`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L1688)、[`check_df_stats_login`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L2346)、[`logout_df_stats`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DeltaStatsPage.tsx#L2262)。

### 独立桌面歌词窗

[src/pages/DesktopLyricsPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DesktopLyricsPage.tsx#L1)，344 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### 磁盘健康

[src/pages/DiskHealthPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DiskHealthPage.tsx#L1)，600 行。

[`optimize_disk`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DiskHealthPage.tsx#L108)、[`get_disk_health_info`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DiskHealthPage.tsx#L267)。

### 显示滤镜

[src/pages/DisplayFilterPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1)，3464 行。

[`check_icc_tools`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L886)、[`get_filter_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L542)、[`get_filter_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L575)、[`get_custom_filter_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L585)、[`get_icc_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L617)、[`get_user_filter_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L628)、[`get_displays`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L645)、[`set_active_display`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1775)、[`get_game_filter_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L670)、[`set_game_filter_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L682)、[`apply_filter_stack`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L940)、[`download_icc_tools`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L880)、[`check_gamma_support`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L915)、[`toggle_filter`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L944)、[`apply_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1015)、[`set_filter_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1218)、[`export_custom_filter`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1160)、[`save_user_filter_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1257)、[`apply_user_filter_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1298)、[`delete_user_filter_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1358)、[`apply_icc_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1496)、[`select_icc_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1461)、[`import_icc_profile`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1467)、[`export_preset_as_icc`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1531)、[`delete_icc_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DisplayFilterPage.tsx#L1555)。

### DLSS 预设

[src/pages/DLSSPresetPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DLSSPresetPage.tsx#L1)，659 行。

[`get_dlss_preset_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DLSSPresetPage.tsx#L212)、[`apply_dlss_model_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DLSSPresetPage.tsx#L249)、[`get_dlss_settings_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DLSSPresetPage.tsx#L503)、[`toggle_dlss_indicator`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DLSSPresetPage.tsx#L511)。

### 下载加速器

[src/pages/DownloadAcceleratorPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L1)，551 行。

[`accel_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L146)、[`accel_scan_unfinished`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L156)、[`accel_start`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L179)、[`accel_pause`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L195)、[`accel_resume`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L199)、[`accel_cancel`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L203)、[`accel_open_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L361)、[`accel_reveal_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L382)、[`accel_clear_learned`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DownloadAcceleratorPage.tsx#L486)。

### 独立灵动岛窗

[src/pages/DynamicIslandWindowPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DynamicIslandWindowPage.tsx#L1)，410 行。

[`cmd_get_proxy_port`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DynamicIslandWindowPage.tsx#L101)、[`dynamic_island_set_click_through`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DynamicIslandWindowPage.tsx#L333)、[`get_cursor_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/DynamicIslandWindowPage.tsx#L370)。

### Epic 免费游戏

[src/pages/EpicFreePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/EpicFreePage.tsx#L1)，237 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### 游戏进程优化

[src/pages/GameProcessOptimizePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L1)，1167 行。

[`check_game_optimize_admin`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L794)、[`get_affinity_topology`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L795)、[`get_game_optimize_configs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L798)、[`get_game_auto_optimize_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L810)、[`save_game_optimize_configs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L826)、[`optimize_game_priority`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L884)、[`optimize_game_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L885)、[`apply_game_ifeo`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L860)、[`restore_game_ifeo`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L872)、[`set_game_auto_optimize`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L920)、[`select_game_executable`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L961)、[`list_running_processes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L979)、[`get_game_filter_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GameProcessOptimizePage.tsx#L1002)。

### 显卡名称修改

[src/pages/GpuRenamePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GpuRenamePage.tsx#L1)，471 行。

[`get_gpu_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GpuRenamePage.tsx#L92)、[`get_gpu_options`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GpuRenamePage.tsx#L93)、[`apply_gpu_rename`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GpuRenamePage.tsx#L163)、[`restore_gpu_name`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GpuRenamePage.tsx#L202)、[`restart_graphics_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/GpuRenamePage.tsx#L238)。

### 硬件监控

[src/pages/HardwarePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HardwarePage.tsx#L1)，1122 行。

[`set_active_gpu_index`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HardwarePage.tsx#L421)、[`get_overlay_hardware_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HardwarePage.tsx#L438)、[`get_memory_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HardwarePage.tsx#L481)、[`get_disk_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HardwarePage.tsx#L492)、[`open_sensor_monitor`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HardwarePage.tsx#L823)、[`clear_hardware_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HardwarePage.tsx#L857)。

### Windows 隐藏特性

[src/pages/HiddenFeaturesPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HiddenFeaturesPage.tsx#L1)，714 行。

[`feature_flags_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HiddenFeaturesPage.tsx#L257)、[`feature_flags_query`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HiddenFeaturesPage.tsx#L258)、[`feature_flags_reset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HiddenFeaturesPage.tsx#L299)、[`feature_flags_set`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HiddenFeaturesPage.tsx#L304)。

### 主页

[src/pages/HomePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HomePage.tsx#L1)，279 行。

[`get_system_username`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/HomePage.tsx#L87)。

### 内存清理

[src/pages/MemoryCleanupPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L1)，897 行。

[`get_detailed_memory_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L108)、[`get_game_start_clean_config`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L138)、[`start_auto_clean`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L178)、[`stop_auto_clean`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L353)、[`set_game_start_clean_config`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L201)、[`get_pagefile_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L235)、[`set_pagefile`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L318)、[`clean_standby_memory`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L393)、[`trim_system_working_set`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryCleanupPage.tsx#L421)。

### 系统可用内存限制

[src/pages/MemoryLimitPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryLimitPage.tsx#L1)，486 行。

[`get_memory_limit_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryLimitPage.tsx#L93)、[`set_memory_limit`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryLimitPage.tsx#L183)、[`restore_memory_limit`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MemoryLimitPage.tsx#L213)。

### 心境网页窗

[src/pages/MoodPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MoodPage.tsx#L1)，66 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### 音乐播放器

[src/pages/MusicPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MusicPage.tsx#L1)，6645 行。

[`qishui_feed_modes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MusicPage.tsx#L4016)、[`music_mv_url`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/MusicPage.tsx#L4641)。

### 网络优化

[src/pages/NetworkOptimizerPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L1)，1397 行。

[`test_dns_latency`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L360)、[`check_network_tweak_states`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L540)、[`get_public_ip`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L483)、[`batch_network_enable`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L639)、[`batch_network_disable`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L672)、[`set_dns_servers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L703)、[`restore_dns_servers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L744)、[`clear_dns_cache`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L771)、[`reset_network`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L795)、[`fix_dhcp`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NetworkOptimizerPage.tsx#L819)。

### NVIDIA 驱动查找/官网入口

[src/pages/NvidiaDriverDownloadPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverDownloadPage.tsx#L1)，554 行。

[`detect_current_nvidia_gpu`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverDownloadPage.tsx#L93)、[`fetch_nvidia_drivers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverDownloadPage.tsx#L112)。

### NVIDIA 驱动参数

[src/pages/NvidiaDriverPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L1)，846 行。

[`get_hardware`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L175)、[`is_nvidia_gpu`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L176)、[`get_nvapi_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L184)、[`diagnose_nvapi`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L189)、[`get_nvidia_driver_version`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L201)、[`list_nvidia_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L214)、[`set_nvidia_setting`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L254)、[`reset_nvidia_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaDriverPage.tsx#L294)。

### 已有录屏文件管理

[src/pages/NvidiaRecordingPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L1)，1622 行。

[`open_video_with_system_player`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L509)、[`reveal_video_in_explorer`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L517)、[`get_video_thumbnails`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L588)、[`scan_nvidia_recordings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L609)、[`add_nvidia_recording_folder`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L663)、[`remove_nvidia_recording_folder`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L678)、[`delete_nvidia_recording_video`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L701)、[`copy_nvidia_recording_videos`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/NvidiaRecordingPage.tsx#L767)。

### 优化工具入口

[src/pages/OptimizePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OptimizePage.tsx#L1)，219 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### 其他改枪码平台

[src/pages/OtherGunCodePlatformsPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OtherGunCodePlatformsPage.tsx#L1)，154 行。

[`open_platform_window`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OtherGunCodePlatformsPage.tsx#L68)。

### 硬件悬浮框设置

[src/pages/OverlayPanelPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L1)，1065 行。

[`is_nvidia_gpu`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L353)、[`get_overlay_panel_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L381)、[`get_overlay_hardware_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L390)、[`start_overlay_panel`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L427)、[`stop_overlay_panel`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L454)、[`set_vertical_overlay_click_through`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L500)、[`set_overlay_drag_mode`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L519)、[`get_overlay_current_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L570)、[`reset_vertical_overlay_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L565)、[`reset_overlay_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L569)、[`get_delta_passwords`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/OverlayPanelPage.tsx#L664)。

### 外设参数优化

[src/pages/PeripheralOptimizePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PeripheralOptimizePage.tsx#L1)，404 行。

[`get_peripheral_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PeripheralOptimizePage.tsx#L71)、[`set_peripheral_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PeripheralOptimizePage.tsx#L104)、[`reset_peripheral_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PeripheralOptimizePage.tsx#L131)。

### 电源计划

[src/pages/PowerManagementPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L1)，773 行。

[`get_builtin_power_plans`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L318)、[`get_system_power_plans`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L319)、[`get_active_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L320)、[`get_laptop_power_lock_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L325)、[`import_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L515)、[`import_and_activate_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L377)、[`activate_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L406)、[`delete_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L442)、[`unlock_laptop_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PowerManagementPage.tsx#L472)。

### UE PSO 缓存

[src/pages/PsoCachePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PsoCachePage.tsx#L1)，448 行。

[`pso_scan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PsoCachePage.tsx#L106)、[`pso_detect`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PsoCachePage.tsx#L121)、[`pso_choose`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PsoCachePage.tsx#L165)、[`pso_clean`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/PsoCachePage.tsx#L186)。

### 分辨率换算/注入

[src/pages/ResolutionConverterPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ResolutionConverterPage.tsx#L1)，877 行。

[`get_nvidia_display_modes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ResolutionConverterPage.tsx#L409)、[`get_injected_resolutions`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ResolutionConverterPage.tsx#L435)、[`set_nvidia_display_resolution`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ResolutionConverterPage.tsx#L469)、[`list_nvidia_displays`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ResolutionConverterPage.tsx#L525)、[`remove_injected_resolution`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ResolutionConverterPage.tsx#L824)。

### 运行库修复

[src/pages/RuntimeRepairPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/RuntimeRepairPage.tsx#L1)，286 行。

[`get_runtime_statuses`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/RuntimeRepairPage.tsx#L114)、[`repair_runtime`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/RuntimeRepairPage.tsx#L131)。

### 屏幕测试

[src/pages/ScreenTestPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ScreenTestPage.tsx#L1)，936 行。

[`get_screen_modes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ScreenTestPage.tsx#L371)。

### 独立传感器窗

[src/pages/SensorMonitorPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SensorMonitorPage.tsx#L1)，794 行。

[`get_all_sensors`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SensorMonitorPage.tsx#L761)。

### 设置

[src/pages/SettingsPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L1)，3959 行。

[`check_nexbox_auto_start`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L510)、[`set_game_win_key_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L598)、[`game_mode_set_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L613)、[`set_nexbox_auto_start`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L812)、[`pick_video_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L1590)、[`get_sponsors`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L2712)、[`get_thanks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L2975)、[`open_system_browser`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SettingsPage.tsx#L3060)。

### 显卡着色器缓存

[src/pages/ShaderCachePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ShaderCachePage.tsx#L1)，430 行。

[`scan_shader_caches`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ShaderCachePage.tsx#L247)、[`clean_shader_cache`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ShaderCachePage.tsx#L296)。

### 网络测速

[src/pages/SpeedTestPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SpeedTestPage.tsx#L1)，602 行。

[`get_speedtest_servers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SpeedTestPage.tsx#L406)、[`start_speedtest`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SpeedTestPage.tsx#L436)、[`stop_speedtest`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SpeedTestPage.tsx#L445)。

### 启动项与系统服务

[src/pages/StartupManagerPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L1)，650 行。

[`get_startup_item_icon`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L109)、[`scan_services`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L130)、[`is_app_admin`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L131)、[`set_service_start_type`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L153)、[`scan_startup_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L184)、[`disable_startup_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L210)、[`enable_startup_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L239)、[`locate_startup_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L266)、[`find_startup_key_in_registry`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StartupManagerPage.tsx#L281)。

### Steam 管理

[src/pages/SteamPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L1)，1547 行。

[`get_steam_all_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L843)、[`get_steam_user_avatars`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L849)、[`get_steam_inventory`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L891)、[`launch_steam_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L998)、[`launch_steam_client`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L1011)、[`open_game_folder`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L1023)、[`open_steam_store_page`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L1031)、[`install_steam_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L1039)、[`switch_steam_account`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L1049)、[`uninstall_steam_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L1062)、[`delete_steam_account`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SteamPage.tsx#L1083)。

### 存储清理

[src/pages/StorageCleanPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L1)，1870 行。

[`scan_storage_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L771)、[`scan_junk_categories`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L814)、[`clean_storage_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L918)、[`delete_junk_files`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L988)、[`get_winapp2_rule_info`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L1024)、[`update_winapp2_rules`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L1048)、[`get_drive_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L1079)、[`scan_large_files`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L1144)、[`cancel_large_file_scan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L1163)、[`reveal_large_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L1174)、[`delete_large_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StorageCleanPage.tsx#L1199)。

### 主播目录

[src/pages/StreamerDirectoryPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StreamerDirectoryPage.tsx#L1)，263 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### 主播配置详情

[src/pages/StreamerProfilePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/StreamerProfilePage.tsx#L1)，695 行。

该文件未检出字面量直接 IPC；能力可能由子组件、状态层、网络请求或纯前端实现承载。

### Windows 注册表优化

[src/pages/SystemOptimizerPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SystemOptimizerPage.tsx#L1)，859 行。

[`scan_registry_tweaks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SystemOptimizerPage.tsx#L424)、[`apply_registry_tweak`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SystemOptimizerPage.tsx#L513)、[`batch_apply_registry_tweaks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SystemOptimizerPage.tsx#L558)、[`batch_restore_registry_tweaks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/SystemOptimizerPage.tsx#L594)。

### NTP 时间同步

[src/pages/TimeSyncPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/TimeSyncPage.tsx#L1)，412 行。

[`ntp_query`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/TimeSyncPage.tsx#L118)、[`get_ntp_servers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/TimeSyncPage.tsx#L140)、[`is_app_admin`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/TimeSyncPage.tsx#L157)、[`apply_time_offset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/TimeSyncPage.tsx#L181)。

### 外部/社区工具箱

[src/pages/ToolsPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ToolsPage.tsx#L1)，1809 行。

[`launch_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ToolsPage.tsx#L263)、[`run_tool`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ToolsPage.tsx#L265)、[`select_exe_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/ToolsPage.tsx#L302)。

### VAC 修复

[src/pages/VacRepairPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VacRepairPage.tsx#L1)，424 行。

[`get_vac_repair_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VacRepairPage.tsx#L104)、[`run_vac_repair`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VacRepairPage.tsx#L127)。

### 独立竖向悬浮窗

[src/pages/VerticalOverlayPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VerticalOverlayPage.tsx#L1)，566 行。

[`save_vertical_overlay_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VerticalOverlayPage.tsx#L299)、[`vertical_overlay_ready`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VerticalOverlayPage.tsx#L333)、[`get_overlay_current_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VerticalOverlayPage.tsx#L366)、[`set_vertical_overlay_click_through`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VerticalOverlayPage.tsx#L457)、[`resize_vertical_overlay`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VerticalOverlayPage.tsx#L410)。

### VBS/HVCI/Hyper-V 设置

[src/pages/VtxVirtualizationPage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VtxVirtualizationPage.tsx#L1)，374 行。

[`check_vtx_virtualization_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/VtxVirtualizationPage.tsx#L61)。

### Windows 更新管理

[src/pages/WindowsUpdatePage.tsx](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/WindowsUpdatePage.tsx#L1)，601 行。

[`check_windows_update_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/WindowsUpdatePage.tsx#L68)、[`check_pause_update_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/WindowsUpdatePage.tsx#L90)、[`apply_registry_tweak`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/WindowsUpdatePage.tsx#L170)、[`restore_registry_tweak`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/WindowsUpdatePage.tsx#L194)、[`check_defender_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/WindowsUpdatePage.tsx#L154)、[`disable_windows_update`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/WindowsUpdatePage.tsx#L218)、[`enable_windows_update`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src/pages/WindowsUpdatePage.tsx#L242)。

## 4. 主程序全部注册命令

以主程序 generate_handler! 中的注册路径分组；链接指向命令声明或函数实现。该表不是远程 API 权限表，Android 远程入口另受白名单约束。

### announcement

- [`announcement::get_announcements`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/announcement.rs#L125)
- [`announcement::get_important_announcements`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/announcement.rs#L143)

### auto_start

- [`auto_start::set_nexbox_auto_start`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/auto_start.rs#L181)
- [`auto_start::check_nexbox_auto_start`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/auto_start.rs#L251)

### hardware

- [`hardware::get_hardware`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware.rs#L2019)
- [`hardware::get_cpu_load`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware.rs#L2028)
- [`hardware::get_gpu_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware.rs#L2042)
- [`hardware::get_disk_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware.rs#L2192)
- [`hardware::is_nvidia_gpu`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware.rs#L2216)
- [`hardware::get_os_version`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware.rs#L2225)
- [`hardware::get_disk_health_info`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware.rs#L2767)

### disk_optimize

- [`disk_optimize::optimize_disk`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/disk_optimize.rs#L150)

### music

- [`music::get_music_files`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music.rs#L326)
- [`music::import_local_music`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music.rs#L444)
- [`music::import_local_music_folder`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music.rs#L532)
- [`music::get_local_lyric`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music.rs#L556)
- [`music::verify_local_covers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music.rs#L586)
- [`music::delete_cover_cache_files`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music.rs#L670)

### music_api

- [`music_api::music_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L23)
- [`music_api::music_song_url`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L29)
- [`music_api::music_login_qr_key`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L35)
- [`music_api::music_login_qr_create`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L41)
- [`music_api::music_login_qr_check`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L47)
- [`music_api::music_login_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L67)
- [`music_api::music_login_cookie`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L73)
- [`music_api::music_logout`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L87)
- [`music_api::music_user_playlist`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L94)
- [`music_api::music_playlist_tracks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L111)
- [`music_api::music_playlist_tracks_range`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L117)
- [`music_api::music_playlist_info_with_track_ids`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L123)
- [`music_api::music_playlist_detail`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L129)
- [`music_api::music_likelist`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L135)
- [`music_api::music_like`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L142)
- [`music_api::music_playlist_subscribe`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L148)
- [`music_api::music_lyric`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L154)
- [`music_api::music_song_comments`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L160)
- [`music_api::music_send_comment`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L166)
- [`music_api::music_personalized`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L172)
- [`music_api::music_recommend_songs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L178)
- [`music_api::music_recommend_resource`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L184)
- [`music_api::music_simi_song`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L191)
- [`music_api::music_artist_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L197)
- [`music_api::music_artist_songs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L209)
- [`music_api::music_artist_detail`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L215)
- [`music_api::music_artist_albums`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L221)
- [`music_api::music_artist_mvs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L227)
- [`music_api::music_album_detail`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L233)
- [`music_api::music_mv_url`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L239)
- [`music_api::music_playlist_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L203)
- [`music_api::music_open_login_window`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L937)
- [`music_api::kugou_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L249)
- [`music_api::kugou_artist_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L255)
- [`music_api::kugou_playlist_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L261)
- [`music_api::kugou_artist_songs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L267)
- [`music_api::kugou_song_url`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L273)
- [`music_api::kugou_lyric`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L298)
- [`music_api::kugou_login_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L307)
- [`music_api::kugou_login_cookie`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L313)
- [`music_api::kugou_logout`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L328)
- [`music_api::kugou_user_playlists`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L335)
- [`music_api::kugou_playlist_tracks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L341)
- [`music_api::kugou_playlist_tracks_range`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L347)
- [`music_api::kugou_guess_like`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L353)
- [`music_api::kugou_rank_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L359)
- [`music_api::kugou_rank_songs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L365)
- [`music_api::kugou_like_toggle`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L371)
- [`music_api::kugou_liked_hashes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L377)
- [`music_api::qq_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L387)
- [`music_api::qq_song_url`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L393)
- [`music_api::qq_lyric`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L404)
- [`music_api::qq_login_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L410)
- [`music_api::qq_login_cookie`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L416)
- [`music_api::qq_logout`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L431)
- [`music_api::qq_user_playlists`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L438)
- [`music_api::qq_playlist_tracks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L444)
- [`music_api::qq_playlist_tracks_range`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L450)
- [`music_api::qq_artist_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L456)
- [`music_api::qq_artist_songs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L462)
- [`music_api::qq_playlist_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L468)
- [`music_api::qq_rank_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L474)
- [`music_api::qq_rank_songs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L480)
- [`music_api::music_qq_recommend_playlists`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L486)
- [`music_api::qq_liked_hashes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L491)
- [`music_api::qq_like_toggle`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L497)
- [`music_api::migu_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L507)
- [`music_api::migu_playlist_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L513)
- [`music_api::migu_artist_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L519)
- [`music_api::migu_artist_songs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L524)
- [`music_api::migu_song_url`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L529)
- [`music_api::migu_lyric`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L548)
- [`music_api::migu_login_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L555)
- [`music_api::migu_logout`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L561)
- [`music_api::migu_user_playlists`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L569)
- [`music_api::migu_playlist_tracks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L575)
- [`music_api::migu_playlist_tracks_range`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L580)
- [`music_api::migu_rank_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L585)
- [`music_api::migu_rank_songs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L590)
- [`music_api::migu_recommend_playlists`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L595)
- [`music_api::music_get_login_statuses`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L605)
- [`music_api::music_switch_provider`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L661)
- [`music_api::music_get_playback_source`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/mod.rs#L674)

### external_player

- [`external_player::external_player_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/external_player.rs#L525)
- [`external_player::external_control`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/external_player.rs#L530)

### smtc

- [`smtc::smtc_update_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/smtc.rs#L555)
- [`smtc::smtc_clear`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/smtc.rs#L587)

### media_keys

- [`media_keys::set_media_keys_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/media_keys.rs#L368)

### music_api::qishui

- [`music_api::qishui::qishui_qr_get`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L309)
- [`music_api::qishui::qishui_qr_check`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L352)
- [`music_api::qishui::qishui_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L522)
- [`music_api::qishui::qishui_login_cookie`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L532)
- [`music_api::qishui::qishui_logout`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L548)
- [`music_api::qishui::qishui_user_playlists`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1255)
- [`music_api::qishui::qishui_playlist_tracks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1376)
- [`music_api::qishui::qishui_feed`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1659)
- [`music_api::qishui::qishui_feed_modes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1618)
- [`music_api::qishui::qishui_search`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1698)
- [`music_api::qishui::qishui_search_playlists`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1762)
- [`music_api::qishui::qishui_search_artists`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1789)
- [`music_api::qishui::qishui_song_url`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L2375)
- [`music_api::qishui::qishui_lyric`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L2591)
- [`music_api::qishui::qishui_deps_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L2049)
- [`music_api::qishui::qishui_deps_download`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L2055)
- [`music_api::qishui::qishui_liked_tracks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1567)
- [`music_api::qishui::qishui_like_toggle`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/qishui.rs#L1590)

### music_api::audio_proxy

- [`music_api::audio_proxy::cmd_get_proxy_port`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/music_api/audio_proxy.rs#L244)

### remote_monitor

- [`remote_monitor::cmd_get_remote_monitor`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_monitor.rs#L306)
- [`remote_monitor::cmd_enable_remote_monitor`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_monitor.rs#L311)
- [`remote_monitor::cmd_disable_remote_monitor`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_monitor.rs#L320)
- [`remote_monitor::cmd_set_remote_style`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_monitor.rs#L326)

### remote_access

- [`remote_access::cmd_get_remote_access`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/mod.rs#L254)
- [`remote_access::cmd_enable_remote_access`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/mod.rs#L263)
- [`remote_access::cmd_rotate_pairing_code`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/mod.rs#L280)
- [`remote_access::cmd_list_paired_devices`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/mod.rs#L286)
- [`remote_access::cmd_revoke_device`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/mod.rs#L292)
- [`remote_access::cmd_list_pair_requests`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/mod.rs#L303)
- [`remote_access::cmd_resolve_pair_request`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/mod.rs#L309)

### remote_access::transfer

- [`remote_access::transfer::cmd_transfer_add_files`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/transfer.rs#L433)
- [`remote_access::transfer::cmd_transfer_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/transfer.rs#L444)
- [`remote_access::transfer::cmd_transfer_remove`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/transfer.rs#L450)
- [`remote_access::transfer::cmd_transfer_save_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/transfer.rs#L459)
- [`remote_access::transfer::cmd_transfer_reveal`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/transfer.rs#L481)
- [`remote_access::transfer::cmd_transfer_unsaved_count`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/transfer.rs#L493)

### remote_access::clipboard_sync

- [`remote_access::clipboard_sync::cmd_get_clipboard_sync`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/clipboard_sync.rs#L190)
- [`remote_access::clipboard_sync::cmd_set_clipboard_sync`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/remote_access/clipboard_sync.rs#L196)

### downloader

- [`downloader::download_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L164)
- [`downloader::open_system_browser`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L43)
- [`downloader::open_installer`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L259)
- [`downloader::download_update`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L277)
- [`downloader::install_update`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L291)
- [`downloader::delete_download_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L345)
- [`downloader::mark_pending_install`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L320)
- [`downloader::clear_pending_install`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L334)
- [`downloader::cancel_download`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L306)
- [`downloader::reset_download_cancel`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/downloader.rs#L313)

### download_accelerator

- [`download_accelerator::accel_start`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L179)
- [`download_accelerator::accel_pause`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L268)
- [`download_accelerator::accel_resume`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L280)
- [`download_accelerator::accel_cancel`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L362)
- [`download_accelerator::accel_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L383)
- [`download_accelerator::accel_clear_learned`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L393)
- [`download_accelerator::accel_set_speed_limit`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L460)
- [`download_accelerator::accel_scan_unfinished`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L467)
- [`download_accelerator::accel_open_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L401)
- [`download_accelerator::accel_reveal_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/download_accelerator.rs#L436)

### optimization

- [`optimization::optimize_memory`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L609)
- [`optimization::get_memory_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L643)
- [`optimization::kill_wallpaper_engine`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L656)
- [`optimization::flush_dns`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1039)
- [`optimization::clean_temp_files`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L939)
- [`optimization::optimize_privacy_services`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L986)
- [`optimization::optimize_ace_processes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L798)
- [`optimization::set_high_performance_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L750)
- [`optimization::get_memory_limit_options`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1163)
- [`optimization::get_memory_limit_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1168)
- [`optimization::set_memory_limit`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1192)
- [`optimization::restore_memory_limit`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1223)
- [`optimization::get_detailed_memory_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1396)
- [`optimization::get_memory_list_sizes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1344)
- [`optimization::clean_standby_memory`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1716)
- [`optimization::trim_system_working_set`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1735)
- [`optimization::clean_memory_selected`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1756)
- [`optimization::get_memory_clean_config`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1920)
- [`optimization::set_memory_clean_config`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1930)
- [`optimization::start_auto_clean`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1838)
- [`optimization::stop_auto_clean`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1853)
- [`optimization::get_auto_clean_config`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L1861)
- [`optimization::get_game_start_clean_config`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2040)
- [`optimization::set_game_start_clean_config`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2048)
- [`optimization::get_pagefile_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L5312)
- [`optimization::set_pagefile`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L5347)
- [`optimization::boost_delta_force_priority`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2343)
- [`optimization::boost_delta_force_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2396)
- [`optimization::boost_delta_force_affinity_with_mask`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2632)
- [`optimization::limit_ace_priority`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2467)
- [`optimization::restrict_ace_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2501)
- [`optimization::restrict_ace_affinity_with_mask`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2511)
- [`optimization::set_ace_efficiency_mode`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L847)
- [`optimization::apply_ace_registry_limits`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2580)
- [`optimization::restore_ace_registry_limits`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2607)
- [`optimization::optimize_all_game_processes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2676)
- [`optimization::set_ace_auto_detect`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2254)
- [`optimization::get_ace_auto_detect_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2292)
- [`optimization::init_ace_auto_detect`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2309)
- [`optimization::get_builtin_power_plans`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L3067)
- [`optimization::get_system_power_plans`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L3108)
- [`optimization::get_active_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L3118)
- [`optimization::get_laptop_power_lock_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2862)
- [`optimization::unlock_laptop_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L2875)
- [`optimization::import_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L3130)
- [`optimization::activate_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L3204)
- [`optimization::import_and_activate_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L3253)
- [`optimization::apply_registry_tweak`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4677)
- [`optimization::restore_registry_tweak`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4705)
- [`optimization::batch_apply_registry_tweaks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4765)
- [`optimization::batch_restore_registry_tweaks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4831)
- [`optimization::scan_registry_tweaks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4562)
- [`optimization::disable_windows_update`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L3895)
- [`optimization::enable_windows_update`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L3971)
- [`optimization::check_windows_update_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4080)
- [`optimization::check_pause_update_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L5028)
- [`optimization::check_defender_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L5049)
- [`optimization::delete_power_plan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4126)
- [`optimization::get_peripheral_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4179)
- [`optimization::set_peripheral_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4204)
- [`optimization::reset_peripheral_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4239)
- [`optimization::restart_graphics_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/optimization.rs#L4899)

### anticheat

- [`anticheat::anticheat_get_groups`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/anticheat.rs#L434)
- [`anticheat::anticheat_limit_priority`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/anticheat.rs#L450)
- [`anticheat::anticheat_restrict_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/anticheat.rs#L465)
- [`anticheat::anticheat_set_efficiency`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/anticheat.rs#L481)
- [`anticheat::anticheat_apply_registry`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/anticheat.rs#L496)
- [`anticheat::anticheat_restore_registry`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/anticheat.rs#L505)
- [`anticheat::anticheat_set_auto_detect`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/anticheat.rs#L514)
- [`anticheat::anticheat_get_auto_detect_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/anticheat.rs#L539)

### power_settings

- [`power_settings::get_power_advanced_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/power_settings.rs#L360)
- [`power_settings::set_power_advanced_setting`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/power_settings.rs#L370)
- [`power_settings::unhide_power_advanced_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/power_settings.rs#L431)

### network_optimize

- [`network_optimize::set_tcp_congestion`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L119)
- [`network_optimize::restore_tcp_congestion`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L128)
- [`network_optimize::set_tcp_chimney_off`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L139)
- [`network_optimize::restore_tcp_chimney`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L148)
- [`network_optimize::set_nagle_optimization`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L159)
- [`network_optimize::restore_nagle_optimization`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L167)
- [`network_optimize::set_adapter_power_saving_off`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L177)
- [`network_optimize::restore_adapter_power_saving`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L185)
- [`network_optimize::set_dns_servers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L335)
- [`network_optimize::restore_dns_servers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L375)
- [`network_optimize::test_dns_latency`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L275)
- [`network_optimize::clear_dns_cache`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L388)
- [`network_optimize::reset_network`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L413)
- [`network_optimize::fix_dhcp`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L450)
- [`network_optimize::check_network_tweak_states`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L636)
- [`network_optimize::batch_network_enable`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L668)
- [`network_optimize::batch_network_disable`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L693)
- [`network_optimize::get_public_ip`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/network_optimize.rs#L767)

### startup_manager

- [`startup_manager::scan_startup_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/startup_manager.rs#L487)
- [`startup_manager::disable_startup_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/startup_manager.rs#L533)
- [`startup_manager::enable_startup_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/startup_manager.rs#L581)
- [`startup_manager::locate_startup_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/startup_manager.rs#L630)
- [`startup_manager::find_startup_key_in_registry`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/startup_manager.rs#L667)
- [`startup_manager::get_startup_item_icon`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/startup_manager.rs#L445)
- [`startup_manager::get_process_icons`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/startup_manager.rs#L436)

### service_manager

- [`service_manager::scan_services`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/service_manager.rs#L120)
- [`service_manager::set_service_start_type`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/service_manager.rs#L225)
- [`service_manager::is_app_admin`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/service_manager.rs#L272)

### context_menu

- [`context_menu::scan_context_menu_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L412)
- [`context_menu::hide_context_menu_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L425)
- [`context_menu::restore_context_menu_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L452)
- [`context_menu::scan_this_pc_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L663)
- [`context_menu::hide_this_pc_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L704)
- [`context_menu::restore_this_pc_item`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L711)
- [`context_menu::scan_drives`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L777)
- [`context_menu::hide_drive`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L844)
- [`context_menu::restore_drive`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/context_menu.rs#L854)

### display_filter

- [`display_filter::get_displays`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L2545)
- [`display_filter::get_screen_modes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L2580)
- [`display_filter::set_active_display`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L2653)
- [`display_filter::check_gamma_support`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L2671)
- [`display_filter::get_filter_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L2846)
- [`display_filter::set_filter_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L3015)
- [`display_filter::enable_filter`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L3124)
- [`display_filter::disable_filter`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L3197)
- [`display_filter::toggle_filter`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L3248)
- [`display_filter::get_filter_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L3341)
- [`display_filter::apply_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L3608)
- [`display_filter::get_custom_filter_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4003)
- [`display_filter::save_custom_filter_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4009)
- [`display_filter::export_custom_filter`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4032)
- [`display_filter::get_user_filter_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4055)
- [`display_filter::save_user_filter_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4072)
- [`display_filter::apply_user_filter_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4108)
- [`display_filter::delete_user_filter_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4124)
- [`display_filter::select_icc_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4140)
- [`display_filter::import_icc_profile`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4154)
- [`display_filter::get_icc_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4170)
- [`display_filter::apply_icc_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4187)
- [`display_filter::delete_icc_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4299)
- [`display_filter::export_preset_as_icc`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L4323)
- [`display_filter::apply_filter_stack`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L3713)
- [`display_filter::restore_filter_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L3933)
- [`display_filter::check_icc_tools`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L2704)
- [`display_filter::download_icc_tools`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/display_filter.rs#L2734)

### game_filter

- [`game_filter::get_game_filter_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_filter.rs#L940)
- [`game_filter::set_game_filter_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_filter.rs#L952)
- [`game_filter::add_custom_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_filter.rs#L1007)
- [`game_filter::remove_custom_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_filter.rs#L1052)

### app_manager

- [`app_manager::list_installed_apps`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/app_manager.rs#L253)
- [`app_manager::get_app_icons`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/app_manager.rs#L287)
- [`app_manager::open_app`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/app_manager.rs#L312)
- [`app_manager::uninstall_app`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/app_manager.rs#L407)

### advanced

- [`advanced::get_storage_sizes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/advanced.rs#L109)
- [`advanced::clear_cache`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/advanced.rs#L125)
- [`advanced::clear_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/advanced.rs#L196)
- [`advanced::restart_app`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/advanced.rs#L213)

### game_process_optimize

- [`game_process_optimize::get_game_optimize_configs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L555)
- [`game_process_optimize::save_game_optimize_configs`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L561)
- [`game_process_optimize::optimize_game_priority`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L603)
- [`game_process_optimize::optimize_game_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L724)
- [`game_process_optimize::apply_game_ifeo`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L644)
- [`game_process_optimize::restore_game_ifeo`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L684)
- [`game_process_optimize::set_game_auto_optimize`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L768)
- [`game_process_optimize::get_game_auto_optimize_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L818)
- [`game_process_optimize::select_game_executable`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L961)
- [`game_process_optimize::list_running_processes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L1019)
- [`game_process_optimize::check_game_optimize_admin`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L1066)
- [`game_process_optimize::get_affinity_topology`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_process_optimize.rs#L1056)

### game_mode

- [`game_mode::game_mode_get_config`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_mode.rs#L734)
- [`game_mode::game_mode_set_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_mode.rs#L739)
- [`game_mode::game_mode_set_manual`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_mode.rs#L760)
- [`game_mode::game_mode_set_auto`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_mode.rs#L772)
- [`game_mode::game_mode_set_auto_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_mode.rs#L783)
- [`game_mode::game_mode_get_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_mode.rs#L796)

### game_win_key

- [`game_win_key::get_game_win_key_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_win_key.rs#L235)
- [`game_win_key::set_game_win_key_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_win_key.rs#L241)

### audio_eq

- [`audio_eq::check_virtual_audio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L291)
- [`audio_eq::install_virtual_audio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L353)
- [`audio_eq::uninstall_virtual_audio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L577)
- [`audio_eq::start_eq_engine`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L721)
- [`audio_eq::stop_eq_engine`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1035)
- [`audio_eq::get_eq_engine_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1068)
- [`audio_eq::get_eq_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1113)
- [`audio_eq::apply_eq_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1170)
- [`audio_eq::import_eq_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1209)
- [`audio_eq::delete_eq_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1245)
- [`audio_eq::save_eq_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1272)
- [`audio_eq::export_fac_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1282)
- [`audio_eq::get_audio_levels`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1265)
- [`audio_eq::get_spectrum`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1257)
- [`audio_eq::get_default_audio_device`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L974)
- [`audio_eq::list_audio_devices`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L988)
- [`audio_eq::update_eq_bands`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1087)
- [`audio_eq::update_eq_preamp`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L1102)
- [`audio_eq::update_eq_effects`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L88)
- [`audio_eq::get_eq_effects`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/audio_eq.rs#L102)

### thirdparty_tools

- [`thirdparty_tools::get_thirdparty_tools`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/thirdparty_tools.rs#L303)
- [`thirdparty_tools::get_tool_install_path`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/thirdparty_tools.rs#L308)
- [`thirdparty_tools::get_tool_download_path`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/thirdparty_tools.rs#L392)
- [`thirdparty_tools::run_tool`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/thirdparty_tools.rs#L406)
- [`thirdparty_tools::download_tool`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/thirdparty_tools.rs#L445)
- [`thirdparty_tools::open_tool_installer`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/thirdparty_tools.rs#L496)

### community_tools

- [`community_tools::get_community_tools`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L643)
- [`community_tools::get_community_categories`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L664)
- [`community_tools::search_community_tools`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L677)
- [`community_tools::get_community_install_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L692)
- [`community_tools::invalidate_community_cache`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L110)
- [`community_tools::gitcode_login_start`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L792)
- [`community_tools::get_gitcode_login_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L850)
- [`community_tools::get_gitcode_avatar_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L823)
- [`community_tools::gitcode_logout`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L799)
- [`community_tools::submit_community_tool`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1181)
- [`community_tools::delete_community_tool`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1306)
- [`community_tools::get_community_download_dir`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1488)
- [`community_tools::set_community_download_dir`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1505)
- [`community_tools::pick_community_download_dir`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1521)
- [`community_tools::install_community_tool`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1650)
- [`community_tools::open_community_zip`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1741)
- [`community_tools::run_community_tool`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1767)
- [`community_tools::pick_community_package`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1791)
- [`community_tools::list_zip_entry_exes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1812)
- [`community_tools::pick_community_icon`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/community_tools.rs#L1801)

### overlay_panel

- [`overlay_panel::start_overlay_panel`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2484)
- [`overlay_panel::stop_overlay_panel`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2505)
- [`overlay_panel::get_overlay_panel_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2552)
- [`overlay_panel::set_active_gpu_index`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2557)
- [`overlay_panel::get_overlay_hardware_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2564)
- [`overlay_panel::update_overlay_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2574)
- [`overlay_panel::toggle_overlay_panel`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2531)
- [`overlay_panel::set_overlay_drag_mode`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2676)
- [`overlay_panel::get_overlay_current_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2755)
- [`overlay_panel::check_drag_mode_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2775)
- [`overlay_panel::reset_overlay_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/overlay_panel.rs#L2781)

### pawnio_driver

- [`pawnio_driver::check_pawnio_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/pawnio_driver.rs#L65)
- [`pawnio_driver::install_pawnio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/pawnio_driver.rs#L143)
- [`pawnio_driver::uninstall_pawnio_driver`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/pawnio_driver.rs#L163)

### peripheral_drivers

- [`peripheral_drivers::get_peripheral_drivers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/peripheral_drivers.rs#L164)
- [`peripheral_drivers::get_peripheral_driver_icon`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/peripheral_drivers.rs#L184)

### vertical_overlay

- [`vertical_overlay::start_vertical_overlay`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vertical_overlay.rs#L16)
- [`vertical_overlay::stop_vertical_overlay`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vertical_overlay.rs#L142)
- [`vertical_overlay::vertical_overlay_ready`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vertical_overlay.rs#L132)
- [`vertical_overlay::save_vertical_overlay_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vertical_overlay.rs#L191)
- [`vertical_overlay::set_vertical_overlay_click_through`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vertical_overlay.rs#L270)
- [`vertical_overlay::reset_vertical_overlay_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vertical_overlay.rs#L289)
- [`vertical_overlay::resize_vertical_overlay`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vertical_overlay.rs#L328)

### hardware_report

- [`hardware_report::export_hardware_report`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware_report.rs#L232)
- [`hardware_report::get_hardware_recording_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware_report.rs#L297)
- [`hardware_report::clear_hardware_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hardware_report.rs#L317)

### sensor

- [`sensor::get_lhm_cpu_load`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/sensor.rs#L250)
- [`sensor::get_lhm_cpu_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/sensor.rs#L275)
- [`sensor::get_lhm_gpu_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/sensor.rs#L315)
- [`sensor::restart_monitor_process`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/sensor.rs#L693)

### sensor_monitor

- [`sensor_monitor::open_sensor_monitor`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/sensor_monitor.rs#L44)
- [`sensor_monitor::get_all_sensors`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/sensor_monitor.rs#L65)

### game_ping

- [`game_ping::get_current_ping`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_ping.rs#L131)

### hotkey

- [`hotkey::get_overlay_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L859)
- [`hotkey::set_overlay_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L864)
- [`hotkey::get_crosshair_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L875)
- [`hotkey::set_crosshair_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L880)
- [`hotkey::get_filter_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L891)
- [`hotkey::set_filter_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L896)
- [`hotkey::get_autoclicker_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L907)
- [`hotkey::set_autoclicker_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L912)
- [`hotkey::get_music_prev_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L923)
- [`hotkey::set_music_prev_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L928)
- [`hotkey::get_music_next_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L939)
- [`hotkey::set_music_next_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L944)
- [`hotkey::get_music_playpause_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L955)
- [`hotkey::set_music_playpause_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L960)
- [`hotkey::get_lyrics_btn_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L974)
- [`hotkey::set_lyrics_btn_hotkey`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L979)
- [`hotkey::set_hotkeys_enabled_cmd`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L990)
- [`hotkey::get_hotkeys_enabled_cmd`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1007)
- [`hotkey::get_overlay_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1026)
- [`hotkey::set_overlay_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1015)
- [`hotkey::get_crosshair_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1047)
- [`hotkey::set_crosshair_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1031)
- [`hotkey::get_filter_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1063)
- [`hotkey::set_filter_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1052)
- [`hotkey::get_autoclicker_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1079)
- [`hotkey::set_autoclicker_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1068)
- [`hotkey::get_music_prev_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1095)
- [`hotkey::set_music_prev_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1084)
- [`hotkey::get_music_next_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1111)
- [`hotkey::set_music_next_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1100)
- [`hotkey::get_music_playpause_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1127)
- [`hotkey::set_music_playpause_hotkey_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/hotkey.rs#L1116)

### autoclicker

- [`autoclicker::autoclicker_start`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/autoclicker.rs#L230)
- [`autoclicker::autoclicker_stop`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/autoclicker.rs#L241)
- [`autoclicker::autoclicker_toggle`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/autoclicker.rs#L247)
- [`autoclicker::autoclicker_update`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/autoclicker.rs#L252)
- [`autoclicker::autoclicker_get_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/autoclicker.rs#L258)

### crosshair

- [`crosshair::toggle_crosshair`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair.rs#L1096)
- [`crosshair::get_crosshair_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair.rs#L1081)
- [`crosshair::update_crosshair_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair.rs#L1101)
- [`crosshair::get_crosshair_displays`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair.rs#L100)
- [`crosshair::pick_crosshair_image`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair.rs#L1145)
- [`crosshair::get_preset_crosshair_path`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair.rs#L1157)
- [`crosshair::get_crosshair_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair.rs#L1174)

### crosshair_hold

- [`crosshair_hold::get_crosshair_hold_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair_hold.rs#L283)
- [`crosshair_hold::set_crosshair_hold_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair_hold.rs#L288)
- [`crosshair_hold::get_crosshair_hold_key`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair_hold.rs#L304)
- [`crosshair_hold::set_crosshair_hold_key`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair_hold.rs#L309)
- [`crosshair_hold::get_crosshair_hold_delay`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair_hold.rs#L322)
- [`crosshair_hold::set_crosshair_hold_delay`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/crosshair_hold.rs#L327)

### delta_force

- [`delta_force::get_delta_passwords`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L189)
- [`delta_force::cache_delta_image`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L862)
- [`delta_force::get_weapon_codes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L260)
- [`delta_force::get_dlss_model_presets`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L294)
- [`delta_force::apply_dlss_model_preset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L447)
- [`delta_force::get_dlss_preset_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L802)
- [`delta_force::get_delta_maps`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L512)
- [`delta_force::toggle_dlss_indicator`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L547)
- [`delta_force::toggle_dlss_lock`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L591)
- [`delta_force::get_dlss_settings_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L790)
- [`delta_force::open_url_in_system_browser`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L812)
- [`delta_force::open_platform_window`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/delta_force.rs#L818)

### df_stats

- [`df_stats::open_df_stats_login`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L230)
- [`df_stats::close_df_stats_login`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L407)
- [`df_stats::check_df_stats_login`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L418)
- [`df_stats::logout_df_stats`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L494)
- [`df_stats::is_df_stats_window_open`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L532)
- [`df_stats::get_df_stats_cached_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L538)
- [`df_stats::refresh_df_stats_collect`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L557)
- [`df_stats::df_stats_qr_gen`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L714)
- [`df_stats::df_stats_qr_poll`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L804)
- [`df_stats::df_stats_qr_wx_gen`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L756)
- [`df_stats::df_stats_qr_wx_poll`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L985)
- [`df_stats::df_stats_finish_login`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L1059)
- [`df_stats::df_stats_battle_detail`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L1637)
- [`df_stats::df_stats_battle_report_season`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L1552)
- [`df_stats::df_stats_map_stats`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/df_stats.rs#L1747)

### (根模块)

- [`open_mood_window`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/lib.rs#L171)
- [`is_autostart_mode`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/lib.rs#L301)

### island_window

- [`island_window::set_dynamic_island_enabled`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/island_window.rs#L68)
- [`island_window::dynamic_island_set_click_through`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/island_window.rs#L91)

### game_launcher

- [`game_launcher::launch_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_launcher.rs#L25)
- [`game_launcher::search_delta_force_launcher`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_launcher.rs#L45)
- [`game_launcher::get_default_delta_force_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_launcher.rs#L87)
- [`game_launcher::select_exe_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_launcher.rs#L99)
- [`game_launcher::get_file_icon`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/game_launcher.rs#L112)

### gpu_rename

- [`gpu_rename::get_gpu_info`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/gpu_rename.rs#L655)
- [`gpu_rename::get_gpu_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/gpu_rename.rs#L649)
- [`gpu_rename::get_gpu_options`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/gpu_rename.rs#L665)
- [`gpu_rename::apply_gpu_rename`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/gpu_rename.rs#L821)
- [`gpu_rename::restore_gpu_name`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/gpu_rename.rs#L1020)

### video_bg

- [`video_bg::pick_video_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/video_bg.rs#L2)

### sponsor

- [`sponsor::get_sponsors`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/sponsor.rs#L78)

### thanks

- [`thanks::get_thanks`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/thanks.rs#L149)

### contributor

- [`contributor::get_contributors`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/contributor.rs#L27)

### qq_group

- [`qq_group::get_qq_groups`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/qq_group.rs#L128)
- [`qq_group::get_qq_group_icon`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/qq_group.rs#L148)

### ads

- [`ads::get_ads`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/ads.rs#L120)
- [`ads::get_ad_image`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/ads.rs#L140)

### shader_cache

- [`shader_cache::scan_shader_caches`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/shader_cache.rs#L262)
- [`shader_cache::clean_shader_cache`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/shader_cache.rs#L284)

### pso_cache

- [`pso_cache::pso_detect`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/pso_cache.rs#L480)
- [`pso_cache::pso_scan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/pso_cache.rs#L499)
- [`pso_cache::pso_choose`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/pso_cache.rs#L486)
- [`pso_cache::pso_clean`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/pso_cache.rs#L542)

### nvapi

- [`nvapi::get_nvapi_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L1227)
- [`nvapi::diagnose_nvapi`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L1296)
- [`nvapi::get_nvidia_driver_version`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L1437)
- [`nvapi::list_nvidia_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L1459)
- [`nvapi::set_nvidia_setting`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L1565)
- [`nvapi::reset_nvidia_settings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L1597)
- [`nvapi::list_nvidia_displays`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L1707)
- [`nvapi::get_nvidia_display_modes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L2148)
- [`nvapi::set_nvidia_display_resolution`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L2578)
- [`nvapi::get_injected_resolutions`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L2549)
- [`nvapi::remove_injected_resolution`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvapi.rs#L2555)

### nvidia_driver_download

- [`nvidia_driver_download::fetch_nvidia_drivers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_driver_download.rs#L226)
- [`nvidia_driver_download::detect_current_nvidia_gpu`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_driver_download.rs#L589)

### nvidia_recording

- [`nvidia_recording::scan_nvidia_recordings`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_recording.rs#L180)
- [`nvidia_recording::add_nvidia_recording_folder`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_recording.rs#L289)
- [`nvidia_recording::remove_nvidia_recording_folder`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_recording.rs#L312)
- [`nvidia_recording::delete_nvidia_recording_video`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_recording.rs#L409)
- [`nvidia_recording::copy_nvidia_recording_videos`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_recording.rs#L342)
- [`nvidia_recording::get_video_thumbnails`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_recording.rs#L509)
- [`nvidia_recording::open_video_with_system_player`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_recording.rs#L324)
- [`nvidia_recording::reveal_video_in_explorer`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/nvidia_recording.rs#L333)

### runtime_repair

- [`runtime_repair::get_runtime_statuses`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/runtime_repair.rs#L295)
- [`runtime_repair::repair_runtime`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/runtime_repair.rs#L441)

### vtx_virtualization

- [`vtx_virtualization::check_vtx_virtualization_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vtx_virtualization.rs#L192)
- [`vtx_virtualization::fix_vtx_virtualization_popup`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vtx_virtualization.rs#L212)
- [`vtx_virtualization::restore_vtx_virtualization`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vtx_virtualization.rs#L251)

### vac_repair

- [`vac_repair::get_vac_repair_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vac_repair.rs#L80)
- [`vac_repair::run_vac_repair`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/vac_repair.rs#L231)

### storage_clean

- [`storage_clean::scan_storage_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_clean.rs#L126)
- [`storage_clean::clean_storage_items`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_clean.rs#L412)
- [`storage_clean::empty_recycle_bin_cmd`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_clean.rs#L542)

### storage_scan

- [`storage_scan::scan_junk_categories`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L48)
- [`storage_scan::scan_junk_category`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L96)
- [`storage_scan::get_junk_categories`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L122)
- [`storage_scan::delete_junk_files`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L151)
- [`storage_scan::get_winapp2_rule_info`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L136)
- [`storage_scan::update_winapp2_rules`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L143)
- [`storage_scan::scan_large_files`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L170)
- [`storage_scan::cancel_large_file_scan`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L186)
- [`storage_scan::reveal_large_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L192)
- [`storage_scan::delete_large_file`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L230)
- [`storage_scan::get_drive_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/storage_scan/mod.rs#L258)

### utils::sys_info

- [`utils::sys_info::get_system_locale`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/sys_info.rs#L102)
- [`utils::sys_info::get_system_username`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/sys_info.rs#L107)

### tray

- [`tray::minimize_to_tray`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/tray.rs#L389)
- [`tray::show_window`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/tray.rs#L402)
- [`tray::get_close_behavior`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/tray.rs#L409)
- [`tray::set_close_behavior`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/tray.rs#L414)
- [`tray::get_dont_ask_again`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/tray.rs#L421)
- [`tray::set_dont_ask_again`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/tray.rs#L426)
- [`tray::exit_app`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/tray.rs#L431)
- [`tray::check_update_and_show`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/tray.rs#L436)

### utils::cursor

- [`utils::cursor::get_cursor_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/cursor.rs#L13)
- [`utils::cursor::set_desktop_lyrics_click_through`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/cursor.rs#L268)
- [`utils::cursor::clamp_lyrics_window_position`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/cursor.rs#L327)
- [`utils::cursor::center_lyrics_window`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/cursor.rs#L377)

### system_fonts

- [`system_fonts::get_system_fonts`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/system_fonts.rs#L113)

### utils::lyrics_btn

- [`utils::lyrics_btn::enable_lyrics_unlock_hook`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/lyrics_btn.rs#L191)
- [`utils::lyrics_btn::disable_lyrics_unlock_hook`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/lyrics_btn.rs#L198)
- [`utils::lyrics_btn::set_lyrics_unlock_hook_armed`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/utils/lyrics_btn.rs#L205)

### cpu_scheduler

- [`cpu_scheduler::get_cpu_topology`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L340)
- [`cpu_scheduler::get_process_list`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L370)
- [`cpu_scheduler::get_process_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L438)
- [`cpu_scheduler::set_process_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L486)
- [`cpu_scheduler::restore_process_affinity`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L513)
- [`cpu_scheduler::get_saved_rules`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L532)
- [`cpu_scheduler::save_rule`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L566)
- [`cpu_scheduler::delete_rule`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L587)
- [`cpu_scheduler::apply_rule_by_name`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L597)
- [`cpu_scheduler::apply_core_isolation`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L942)
- [`cpu_scheduler::restore_core_isolation`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L951)
- [`cpu_scheduler::get_isolation_state`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L961)
- [`cpu_scheduler::get_isolation_rules`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L970)
- [`cpu_scheduler::save_isolation_rule`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L1012)
- [`cpu_scheduler::delete_isolation_rule`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L1045)
- [`cpu_scheduler::apply_isolation_rule_by_name`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/cpu_scheduler.rs#L1057)

### steam

- [`steam::get_steam_install_info`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L958)
- [`steam::get_steam_users`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L976)
- [`steam::get_steam_libraries`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L986)
- [`steam::get_steam_games`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L996)
- [`steam::get_steam_all_data`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1015)
- [`steam::launch_steam_client`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1191)
- [`steam::launch_steam_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1212)
- [`steam::open_steam_store_page`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1234)
- [`steam::open_game_folder`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1256)
- [`steam::switch_steam_account`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1365)
- [`steam::delete_steam_account`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1511)
- [`steam::uninstall_steam_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1570)
- [`steam::install_steam_game`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1592)
- [`steam::format_file_size`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1614)
- [`steam::get_steam_stats`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1628)
- [`steam::get_library_disk_info`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1705)
- [`steam::steam_debug`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L1072)
- [`steam::get_steam_user_avatars`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L890)
- [`steam::get_steam_inventory`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/steam.rs#L2050)

### speedtest

- [`speedtest::start_speedtest`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/speedtest.rs#L512)
- [`speedtest::stop_speedtest`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/speedtest.rs#L652)
- [`speedtest::is_speedtest_running`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/speedtest.rs#L658)
- [`speedtest::get_speedtest_servers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/speedtest.rs#L140)

### time_sync

- [`time_sync::get_ntp_servers`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/time_sync.rs#L170)
- [`time_sync::ntp_query`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/time_sync.rs#L183)
- [`time_sync::apply_time_offset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/time_sync.rs#L203)

### uapi

- [`uapi::get_random_image`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/uapi.rs#L86)
- [`uapi::save_random_image_bytes`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/uapi.rs#L193)

### feature_flags

- [`feature_flags::feature_flags_status`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/feature_flags.rs#L548)
- [`feature_flags::feature_flags_query`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/feature_flags.rs#L603)
- [`feature_flags::feature_flags_set`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/feature_flags.rs#L734)
- [`feature_flags::feature_flags_reset`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/feature_flags.rs#L776)

### bsod_log

- [`bsod_log::bsod_collect_evidence`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/bsod_log.rs#L317)
- [`bsod_log::bsod_open_dump_dir`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/bsod_log.rs#L1088)
- [`bsod_log::bsod_reveal_dump`](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/bsod_log.rs#L1100)

主注册表：[src-tauri/src/lib.rs](https://github.com/MuLiuSaMa/NexBox/blob/e7ad6a0bb9197e206bb9a719ca86c6353a5cad43/src-tauri/src/lib.rs#L604)。索引仅反映本次固定提交，后续版本可能增删。
