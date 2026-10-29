# 臻境

Tauri 2 桌面工程，React + TypeScript 前端，Rust 后端，pnpm 管理前端依赖。

0.6.0 起只发布 MSI，署名 Sur方糖，不再生成 NSIS 或便携包。MSI 使用自签名代码签名证书；不会修改用户的证书信任，公共 CA 信任尚未配置。当前发布流程及验收边界见 [MSI 发布与签名](docs/development/MSI发布与签名.md)。

设置页使用真实 Rust 服务，包含外观、通用、全局热键、高级、网络和关于。更新源固定为 [surgar04/m78deguren Releases](https://github.com/surgar04/m78deguren/releases)，只接受本项目发布签名。

## 安装与用户数据

面向 Windows 10/11 x64 用户分发 MSI 安装包，不需要安装 Node、Rust、pnpm、.NET SDK 或 Visual Studio。硬件监控助手以自包含单文件随主程序提供；部分温度、驱动和系统优化能力仍取决于设备支持和用户授权。

0.5.1 起默认按当前用户安装到 %LOCALAPPDATA%\\Programs\\Zhenjing，可在向导中选择其他本地磁盘的独立空目录，不再要求存在 D 盘。默认配置、壁纸、WebView 缓存、下载、日志和备份保存在当前用户的 %LOCALAPPDATA%\\Zhenjing，不再读取开发机工作区。可使用 --data-dir 或 ZHENJING_DATA_DIR 显式沿用原有档案；兼容旧变量 XINJING_DATA_DIR，不会自动移动或清空旧数据。卸载保留用户数据。

需要 Microsoft Edge WebView2 运行时。安装器检测缺失时提供微软官方下载入口，由用户自行安装后重新运行；不会静默安装系统组件。主程序与安装引导不直接依赖额外的 VC++ Redistributable；打包会检查实际二进制导入表。

开发机的 D 盘约定仅约束开发和本机验收。下文工具链、缓存及 .local/data 表均属于开发环境，不是对用户电脑盘符的要求。审查与验证说明见 [对外发布适配审查](docs/development/对外发布适配审查.md)。

## 开始开发

项目固定在 `D:\新境`。所有命令在项目根目录执行；使用入口脚本，环境变量仅对当前进程及其子进程生效。

```powershell
# 启动完整桌面应用
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 desktop:dev

# 启动前端页面预览；原生窗口操作需要桌面应用
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 dev

# 查看工具链与目录
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 env:check

# 全量质量检查
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 check

# 构建 Windows MSI 安装包（构建过程不执行安装）
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 desktop:build

# 兼容入口，同样只构建安装包，输出 dist/desktop/
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 desktop:bundle
```

首页专注本机快捷启动：系统或自定义用户名问候、公告、一言、随机图片、硬件型号、EXE 图标提取及启动、移除和排序。公共顶栏提供常规游戏模式开关、游戏启动自动启用及恢复入口；Win 键仅在识别到的前台游戏中拦截。相关策略均须逐项确认，手机远程功能不在本次实现范围。见 [首页实现说明](docs/development/首页实现说明.md)。

独立游戏库位于 `/#/library`，使用真实 Steam 客户端、账号、目录、安装清单和当前账号缓存，提供搜索、筛选、分页、启动、安装/卸载请求及账号备份恢复。需要完整可见库存时可临时提供官方 Web API Key；密钥不落盘，私密或不可见数据不伪造。见 [Steam 游戏库与安装包说明](docs/development/Steam游戏库与安装包实现.md)。

0.9.0 新增 `/#/library/other`，识别八款游戏及其对应区服、提取本机图标并同步首页快捷启动。设置 → 快捷键可配置八个自定义导航和桌面八向轮盘；轮盘支持长按 Tab、鼠标选择、大小、位置及透明度，主窗口收至托盘后仍可运行。识别证据、搜索边界和验收范围见 [其他游戏与桌面轮盘](docs/development/其他游戏与快捷轮盘.md)。

系统与硬件位于 `/#/hardware`，使用真实硬件服务，包含设备详情、实时传感器、趋势图、独立传感器窗口与远程监测入口。HTML 硬件报告包含时序图表及时间范围筛选，保存到应用数据目录，详见[硬件页面实现说明](docs/development/硬件页面实现说明.md)。

工具箱位于 `/#/tools`，23 项内置工具已接入 Rust，并按 `/#/tools/:toolId` 提供独立页面，覆盖显示滤镜、准心、性能叠加、显卡/显示/NVIDIA、音频 EQ、网络/下载、运行库、虚拟化、隐藏功能、菜单、录屏、VAC、应用、校时、屏幕测试及蓝屏证据。外部工具单独提供官方来源目录。运行结果来自本机或真实网络；完整能力与实际硬件边界见[内置工具全量重构验收](docs/development/内置工具全量重构验收.md)。

系统优化位于 `/#/optimization`，完整覆盖 NexBox 的 201 项配置、11 个分类，接入本机真实扫描、风险筛选、枚举选择、修改前后值预览、逐项确认、执行回执及应用备份撤销。安全、增强、全部和批量恢复只生成待审阅清单；最终确认后才执行系统写入。目录为编译期白名单，不接收任意路径、命令或外部 `.reg`。已移除优化页的模拟数据，详见[系统优化全量实现与验收](docs/development/系统优化全量实现与验收.md)。

首页、工具页、优化页、硬件页、设置页及独立 Steam 游戏库均通过原生服务读取真实数据。首页演示种子及旧的游戏库布局已移除；原生能力不可用时显示错误或空状态，不生成替代读数。历史视觉验收见 [design-qa.md](design-qa.md)，该历史文档不代表当前业务数据。

```powershell
# 历史兼容入口：当前已无首页演示种子，仅将普通前端构建输出到 .cache/build-empty
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 build:empty
```

## 本机环境与磁盘约束

| 内容                                        | 位置                                              |
| ------------------------------------------- | ------------------------------------------------- |
| 源码、锁文件、依赖                          | `D:\新境`、`node_modules`                         |
| Node 24.22.1 LTS、pnpm 10.33.0              | `.tools/node`、`.tools/pnpm`                      |
| Rust 1.96.0、rustfmt、Clippy、Rust Analyzer | `.tools/rustup`、`.tools/cargo/bin`               |
| MSVC 14.44.35207 / Windows SDK 10.0.26100.0 | `.tools/msvc`、`.tools/winsdk`                    |
| Cargo 注册表与 crate 下载                   | `.tools/cargo/registry`                           |
| Rust 编译、EXE                              | `.cache/cargo/target`                             |
| pnpm store / 下载 / 状态                    | `.cache/pnpm`                                     |
| 临时目录、工具用户目录                      | `.cache/tmp`、`.cache/profile`                    |
| Vite / Vitest / 覆盖率                      | `.cache/vite`、`.cache/vitest`、`.cache/coverage` |
| WebView、localStorage、应用数据、日志       | `.local/data`                                     |

本机已经有 WebView2，直接只读使用系统运行时。MSVC、SDK 与 Rust 从已有环境复制到 D 盘，Node 便携包使用官网 SHA256 校验。未修改全局 PATH、用户配置或注册表，未执行 Visual Studio / WebView2 系统安装器。系统自身及编辑器的后台写入不受项目脚本控制；这里约束的是项目及其工具进程的可配置文件位置。

开发入口将应用目录与工具环境全部指向 D 盘，并显式设置开发写入保护变量；越过本机 D 盘边界时启动或操作失败。对外发布版使用上文的每用户路径策略，不把开发盘符限制带给最终用户。当前只构建 MSI，不发布便携 EXE/ZIP。用户自行运行安装/卸载时允许注册卸载项及快捷方式；开发构建不运行安装器。

设计素材生成使用用户另行授权的 C 盘临时例外；工具输出已转存 D 盘并清理相关 C 盘残留。该例外不改变源码、依赖、缓存、构建及运行数据的 D 盘约束。

运行库修复另获逐项确认后的系统写入例外：仅已验证微软签名和哈希的白名单运行库，用户确认后方可启动安装器并写系统目录/注册表；安装包、缓存、应用日志仍在 D 盘。不用于安装开发环境或其他软件。

系统工具同样仅在应用运行时逐项确认后执行，提供应用数据目录中的备份、回执和适用的恢复入口；无法撤销的步骤明确说明。开发验收不自动安装驱动、修改系统配置、注入点击或改变显示颜色。第三方组件许可随安装包分发，见 [第三方组件说明](THIRD_PARTY_NOTICES.md)。

构建入口会清理旧安装包、便携 staging 和 NSIS 中间产物，保留编译缓存及工具链；旧 staging 中的运行数据先移动至 `.local/preserved-packaging-data`。卸载只删除安装文件及注册项，保留用户数据和备份。

`.tools`、`.cache`、`.local` 不提交。不要在开发中删除 `.tools`，它包含实际工具链与 Cargo 下载库。删除 `.cache` 会触发重新编译和下载。锁文件 `pnpm-lock.yaml` 与 `src-tauri/Cargo.lock` 必须提交。

恢复依赖或重新准备工具链：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
```

该脚本在 D 盘下载可校验的 Node/pnpm/Rust，并只读复用已安装的 MSVC/SDK。若它们位于其他目录，可传入 `-MsvcSource`、`-SdkSource`、`-SdkVersion`。若系统缺少这些源组件，脚本会报错；微软标准安装器无法保证不写 C 盘，所以脚本不会自动调用它。无需再次运行当前已完成的环境准备。

如需在同一终端手动执行 Cargo，可先运行 `. .\scripts\env.ps1`。不要直接调用全局 pnpm/rustup 安装环境；项目入口有 D 盘环境检查，但不能约束用户主动绕过入口的命令。

## 技术栈与边界

| 职责                       | 配置                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| 界面                       | React 19、Vite 8、TypeScript 6 严格模式                                    |
| 样式 / 图标 / 动画         | Tailwind CSS 4 Vite 插件、Font Awesome SVG、GSAP + `useGSAP`               |
| 路由 / 服务状态 / 本地状态 | React Router HashRouter、TanStack Query、Zustand                           |
| 表单 / 校验                | React Hook Form、Zod、resolvers                                            |
| 工具                       | clsx、tailwind-merge、date-fns                                             |
| 原生插件                   | dialog、fs、store、opener、log（已安装注册，按需授权）                     |
| Rust 基础库                | serde / serde_json、thiserror、Tokio、reqwest + Rustls、log                |
| 检查                       | ESLint 10 类型感知规则、Prettier、Vitest、Testing Library、rustfmt、Clippy |

TypeScript 固定为工具链当前支持的 6.0.3，避免 typescript-eslint 尚未支持的 7.x。React、Vite、Tailwind 等采用初始化时兼容版本，锁文件保证复现。Node 与 pnpm 固定版本，不依赖 C 盘的全局可执行文件。

```text
src/
  app/          应用布局、路由与按需加载
  pages/        首页、偏好设置页面
  features/home 首页组件、数据契约、集中演示数据、搜索与偏好状态
  components/   通用组件、错误边界
  lib/          IPC 校验、QueryClient、样式工具
  stores/       客户端偏好状态
  test/         测试初始化
src-tauri/
  src/commands.rs   IPC 接口与输入校验
  src/error.rs      可序列化错误
  src/services.rs   共享 HTTP 连接池，设置超时
  src/lib.rs        应用、日志、插件与按用户目录初始化
  capabilities/    前端权限边界
scripts/        D 盘环境、工具恢复、环境诊断、安装包构建
```

前端只通过 `src/lib/desktop.ts` 访问 Rust，并校验返回值。Rust 独立验证输入，不能信任前端校验。异步命令用于后续 I/O 服务；HTTP 使用共享连接池与连接/请求超时。插件已注册，但默认只授予 core 权限；没有开放文件系统、store、shell、任意 URL 等泛化权限。新增能力时修改 capability 并指定最小作用域，持久化优先通过限定路径的 Rust 命令实现。CSP 不允许远程脚本；Font Awesome 使用打包 CSS；GSAP 使用作用域和自动清理，并尊重减少动态效果设置。

## 质量检查

`check` 顺序执行格式、ESLint、类型、前端测试、Rust 格式、Clippy（警告即失败）和 Rust 测试。`build` 必须先通过类型检查。前端测试覆盖 IPC 边界、搜索归一化、筛选交集、不可变查询数据与偏好水合；Rust 测试覆盖输入边界、错误序列化及禁止回退到 C 盘的目录校验。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 format
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 test:coverage
```

原生界面检查使用 `playwright-core` 连接本机 WebView2 调试端口，不下载浏览器。先运行 `dev.ps1 desktop:test:dev`，待桌面窗口出现后，在另一终端运行 `dev.ps1 test:desktop`。该脚本已适配首页，覆盖真实 Rust IPC、键盘跳转、搜索与收藏、添加校验、弹窗焦点、路由、偏好持久化、布局及脚本/CSP 错误。是否实际运行以本次验收记录为准，截图与结果位于 `.cache/verification`。

调试端口由独立的 `src-tauri/tauri.test.conf.json` 显式配置，只监听 `127.0.0.1:9223`，普通开发和正式构建不加载它。当前 WebView2 与 Wry 组合不采用环境变量中的额外浏览器参数，因此使用独立配置；不修改注册表。完成检查后关闭验证进程即可释放端口。

GitHub Actions 配置在 `.github/workflows/check.yml`，执行相同质量检查及 Windows EXE 构建。远程 CI 需要推送到 GitHub 后才会运行。

官方参考：[Tauri Windows 环境](https://v2.tauri.app/start/prerequisites/)、[Tauri 目录与窗口配置](https://v2.tauri.app/reference/config/)、[Tailwind Vite 集成](https://tailwindcss.com/docs/installation/using-vite)、[GSAP React](https://gsap.com/resources/React)。

修改协议时同步更新 Rust 返回类型、Zod schema 和边界测试。日志不记录用户输入或凭据。发布前应再次审核原生权限并测试实际 Windows WebView2 行为。既有应用标识 `dev.zhenjing.desktop`、MSI UpgradeCode 和更新公钥必须保持升级兼容，不能为改名或发布新版本随意替换。

## 发布新版本

统一入口 `dev.ps1 desktop:build` 自动执行质量检查、清理旧产物、构建、MSI 签名和更新清单生成。输出位于 `dist/desktop`，包含 MSI、`zhenjing-update.json`、`SHA256SUMS.txt`、`publisher.json`、`build-info.json`、`INSTALL.md` 六个文件。上传到 GitHub Release 时必须使用 `v` 加版本号的标签，例如 `v0.9.0`，并将稳定版本标记为 Latest；详情见 [GitHub 手动发布](docs/development/GitHub手动发布.md)。

仓库不包含依赖目录、开发工具链、缓存、用户档案或签名私钥。硬件助手的可校验发布件及来源清单随源码保留，修改该助手源码后需通过 `scripts/build-hardware-monitor.ps1` 重新生成，不能仅修改清单绕过校验。第三方组件及字体许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
