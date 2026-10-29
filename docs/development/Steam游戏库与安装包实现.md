# Steam 游戏库与安装包实现

## 功能与来源

| 功能                 | 真实数据或执行链路                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| 客户端检测与运行状态 | HKCU/HKLM（32/64 位视图）、Steam 进程路径及常见目录；启动仅使用后端已探测的 steam.exe                      |
| 库与容量             | 新旧 libraryfolders.vdf、实际逻辑磁盘总量/可用量、安装清单 SizeOnDisk 汇总；离线目录明确显示不可用         |
| 已安装与游玩记录     | appmanifest_*.acf、实际安装目录、当前/最近账号 userdata 的 localconfig.vdf；不混合其他账号记录             |
| 未安装缓存与名称     | 当前账号 librarycache 的应用 ID、appinfo.vdf v39/v40/v41 名称；名称无法解析时保留 App ID，不猜测名称       |
| 真实库存             | 本地缓存明确标为可能不完整且所有权未知；可同步 Steam 接口可见的游戏库，临时 Web API Key 只在当前请求内使用 |
| 游戏操作             | 启动、目录、固定商店 URL；安装/卸载交给 Steam 原生流程并由用户确认，程序不直接删除游戏文件                 |
| 本机账号与头像       | loginusers.vdf 和本机 avatarcache，未读取密码或共享登录令牌                                                |
| 切换/移除            | 逐项确认、配置指纹、正常退出 Steam、D 盘备份、VDF 局部修改、AutoLoginUser CAS 提交；切换后重启 Steam       |
| 恢复                 | 仅允许已完成操作的 UUID 备份，核对目录、写前/写后摘要与注册表状态；新配置发生变化时拒绝覆盖                |
| 刷新与分页           | 单一 TanStack Query、原生 15 秒缓存、手动刷新；每页 24 项，组合名称/App ID/安装状态/收藏/库筛选及排序      |

Steam 是否安装、是否运行、是否记住账号和该账号能否自动通过授权是不同状态。切换不绕过密码、Steam Guard 或许可检查。移除只删除本机保存的账号选择记录和对应自动登录设置，不注销云端账号、不删除游戏/存档、不遍历清除共享认证文件。

## 工程与边界

- `src-tauri/src/services/steam` 分离文本 VDF、二进制 appinfo、扫描、账号事务和服务状态；`commands/steam.rs` 只允许主窗口访问。
- 前端 IPC 统一经过 `src/lib/desktop.ts`，请求/响应使用 Zod，Rust 再次验证 ID、动作、同意标记和文件边界。前端不传任意命令、URL、安装路径或注册表键。
- Windows 固定脚本内容寻址并持有只读锁；系统读写和文件操作有超时与大小限制。同步的文件锁/CAS 在阻塞线程中运行。
- appinfo 名称缓存按路径、修改时间、文件长度与查询集合失效，避免每次刷新扫描大文件。图片按可见页面读取本机缓存，备用封面仅使用 Valve 固定 CDN。
- 报告和 GUI 不包含登录文件原文；公开同步失败、私密资料和缺失数据不会标为成功空列表。Steam Web API 的空私密响应与明确 `game_count=0` 分开处理。
- 所有应用文件、备份、下载、缓存与运行数据在 D 盘。当前实现对 C 盘 Steam 文件仅支持只读查看，账号修改需要 Steam 位于 D 盘。开发验收不执行真实账号切换、移除、安装、卸载或注册表写入。

## 安装包与更新

`dev.ps1 desktop:build` 与 `desktop:bundle` 统一执行 `scripts/package.ps1`，打包前使用固定路径白名单清理产物。旧便携目录中的运行数据移入 `.local/preserved-packaging-data`，不当成缓存删除。保留 `.tools`、NuGet/pnpm/Cargo 依赖及编译缓存。

Tauri 使用项目 NSIS 模板，默认 `D:\Applications\Zhenjing`，检查 D 盘独立目录及重解析点；以当前用户安装，创建卸载注册表和快捷方式。不会下载或安装 WebView2/Visual Studio。卸载入口通过主程序的 `--uninstall` 模式先向子进程传入 D 盘 TEMP/TMP，再启动卸载引擎，避免 NSIS 自复制时使用系统盘临时目录。卸载仅删除白名单文件和登记项，保留 D 盘数据。

安装器使用 `native/installer-bootstrap` 的独立 Rust 引导器。NSIS 的 `$TEMP` 是只读变量，且启动早期即可能解压插件；因此不能仅在向导初始化后修改环境。引导器先验证嵌入负载的长度、标记与 SHA256，再在 `D:\ZhenjingInstallerTemp` 下创建唯一目录，设置子进程 TEMP/TMP 后启动 NSIS；等待向导退出并仅清理本次临时目录。负载启动期间持有拒绝写入/替换的文件句柄。引导器与应用分别具有 Cargo 锁文件，禁止使用系统盘或符号链接回退。

NSIS 的 `/D=` 目录参数要求处于末尾且不能整段加引号；引导器专门处理包含空格的 D 盘路径，兼容直接启动和 PowerShell 更新入口，并在传给 NSIS 前再次检查磁盘与目录边界。

`scripts/collect-installer.ps1` 可在主 EXE 已完成链接、NSIS 已完成生成后单独收集，避免验收脚本调整导致重复全量链接；正常发布仍必须走 `desktop:build`。收集器核对主程序版本、写入安装包摘要与 `build-info.json`；签名脚本拒绝 Debug 构建和摘要不符的安装包。`test:installer` 只解析 PE、引导负载及 NSIS 归档，并对比包内主 EXE 的摘要，不执行安装向导。Tauri 归档内 EXE 的安装类型标记为 `NSS`，构建目录保留 `UNK`；校验仅允许唯一固定标记的这 3 字节差异，其余所有字节必须匹配，并分别记录两份哈希。当前提供 Ed25519 更新清单签名，尚无 Windows Authenticode 代码签名。

发布文件为 `zhenjing-<版本>-windows-x64-setup.exe`。发布清单依旧使用 Ed25519 与 SHA256，更新验证安装包名称及固定仓库；维护助手等待应用退出，再启动安装向导并核对安装后版本，不再将安装程序复制成主 EXE。开发/旧便携目录需要手动选择新的安装目录。

## 验收入口

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 check
. .\scripts\env.ps1
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib services::steam:: -- --include-ignored --nocapture
# ignored Steam 测试仅做本机读取，不修改 Steam。
# 独立测试配置和 D 盘测试档案启动后运行：
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 test:steam:desktop
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 desktop:build
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 installer:check
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 test:installer
```

真实账号修改和安装器执行不作为自动验收。公开游戏库依赖 Steam 服务与可见权限；无 API Key 时，社区入口目前可能返回登录页，界面会明确提示。

## 本次真实数据验收（2026-10-26）

- 本机只读扫描：检测到 D 盘 Steam、1 个保存账号、1 个游戏库、1 款已安装游戏和 41 条当前/最近账号的游戏及应用缓存。缓存条目并不等同于完整许可证清单。
- 原生测试：59 项通过、6 项需要环境或显式启用的测试默认忽略；Steam 专项额外显式运行了只读本机扫描。前端 18 个测试文件、63 项通过。
- Windows 桌面交互：在独立 D 盘档案中验证搜索、24 项分页、安装状态筛选、详情、安装/卸载与账号操作的逐项确认门槛、备份入口、磁盘展示及 1200/760 宽度布局；无页面脚本错误。
- 验收前后账号文件摘要和 Steam 运行状态一致。没有执行真实切换、移除、安装、卸载，也没有实际安装或卸载本应用；未在远程执行 CI。
- GUI 证据位于 `.cache/verification/steam-desktop`；安装包静态验收记录位于 `.cache/verification/installer-artifact.json`。证据属于本地验证资料，不作为应用数据或生产模拟数据打包。
