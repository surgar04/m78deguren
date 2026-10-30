# 第三方组件说明

## sysinfo 0.37.2 / QuickFox 协作

加速准备使用 [sysinfo](https://github.com/GuillaumeGomez/sysinfo) 的 system 最小特性只读进程路径、PID 与创建时间。MIT，Copyright (c) 2015 Guillaume Gomez；许可全文随安装资源保留在 `src-tauri/resources/licenses/Sysinfo-MIT.txt`。QuickFox 为用户自行安装的第三方软件，其安装包、驱动、账户及节点配置不随本项目分发，相关商标与服务归属其权利人。

## MiSans

界面使用小米 MiSans 可变字体，保留原始字体文件，用于本应用界面。许可原文随项目保留在 `src-tauri/resources/licenses/MiSans-License.pdf`，供后续构建随许可目录分发。官方来源及协议：https://hyperos.mi.com/font/zh/download/ 。本项目不将该字体声明为自身的开源代码或作为独立字体包出售。

## Intel PresentMon

HUD 的显示器／指定窗口 FPS 方案按需使用 ECPFrames，它基于 Intel PresentMon 2.6.0；游戏 FPS、1% Low 和 0.1% Low 使用本项目 Rust ETW 服务。旧的完整 PresentMon EXE 已移除，避免重复打包。

- ECPFrames 固定 SHA256：`2a0f046b1f384bf3f2cb9e19c9a629a3b75eb9153553148c4c23830a8c690259`。运行前验证哈希；其上游发布件没有公共 CA 签名，不宣称 Intel 签名。
- ECPFrames 原生源代码在 `native/ECPFrames`；许可原文在 `src-tauri/resources/licenses/ECPFrames-MIT.txt`，PresentMon 原许可亦随包保留。
- 源项目：[Intel PresentMon](https://github.com/GameTechDev/PresentMon)。

## Endfield Charge Plus HUD 与 Inter

- HUD 的数据引擎、模板、变量、图标及视觉动画迁移自 [GlacierGlimmer/zmd-charge-plus](https://github.com/GlacierGlimmer/zmd-charge-plus)，固定提交 `dd17813e682215f3b91d17b40963c34cb8c64a95`，MIT，Copyright (c) 2026 GlacierGlimmer_冰川雪貓。保留其对 QinAnze/zmd-charge 的来源说明。许可原文：`src-tauri/resources/licenses/EndfieldChargePlus-MIT.txt`。
- 本项目修改：复用已有硬件快照和媒体服务、Rust 统一窗口与权限、GSAP 动画、游戏视图、条件触发、受限 IPC、DPAPI 凭据、采集上限及生命周期管理；不分发上游 Avalonia UI 运行时。
- HUD 英文字体 Inter 4.1 来自 [rsms/inter](https://github.com/rsms/inter/tree/v4.1)，SIL Open Font License 1.1；未修改字体文件，原许可随包包含在 `licenses/Inter-OFL.txt`。

## 运行时外部组件与数据

- PawnIO 安装器不随应用打包，按需从 [官方 PawnIO.Setup 2.2.0](https://github.com/namazso/PawnIO.Setup/releases/tag/2.2.0) 下载；仅接受固定 SHA256 和有效 namazso Authenticode 签名，界面逐项确认后才可执行。安装器本身使用上游许可，应用不修改或重新签名。
- Ed25519 验签使用 ed25519-dalek，字体结构校验使用 ttf-parser；许可随各 Rust crate 元数据提供。应用不分发发布签名私钥。

- FxSound 虚拟声卡不随应用打包。在用户准备安装时，按固定上游提交下载 INF、SYS、CAT，验证固定 SHA256 与微软 WHQL 签名。必须由用户在界面单独确认后才安装。上游：[FxSound](https://github.com/fxsound2/fxsound-app)。
- Windows 隐藏功能名称字典由用户主动更新，从 [ViVe FeatureDictionary](https://github.com/thebookisclosed/ViVe) 获取并保存在 D 盘，不内嵌第三方字典。
- NVIDIA NVAPI 来自用户已安装的 NVIDIA 驱动。本项目独立实现受限 ABI 适配，不分发 NVIDIA DLL 或第三方驱动配置导入器。
- 三角洲密码显示固定社区接口的实际响应，明确显示来源与获取时间，不将其称为游戏官方数据。

## 功能参考

工具功能范围参考 [NexBox](https://github.com/MuLiuSaMa/NexBox) 的 `5e77875933d751e7661cb2ad54202f98a989dc63` 源码快照。NexBox 采用 GPL-3.0，其中下载引擎另有 AGPL 许可。本次按功能重写本项目领域服务、界面和互操作适配；系统优化配置事实的映射见下文，未嵌入或执行上游应用及下载引擎代码。参考仓库仅存于不发布的 D 盘缓存目录。

系统优化配置映射同样参照该快照的 `src/config/system-optimizer.ts`、中文名称及 `aq_registry` / `aq_registry_restore`，抽取 201 个配置标识、简短名称和注册表目标事实，记录在编译期 `optimizer-catalog.json`。导入脚本仅静态解析固定文件，未执行或打包参考项目的脚本、注册表文件或下载引擎。风险说明、扫描、事务、备份恢复和界面为本项目实现；修正的共享值冲突及显卡定位差异见《系统优化全量实现与验收》。

其他 npm 与 Cargo 依赖的版本、来源及许可证以 `pnpm-lock.yaml`、`src-tauri/Cargo.lock` 和各依赖包许可为准。

## 硬件页面与传感器

- 硬件功能参考本地 NexBox 的硬件、传感器、报告、远程监控与 ETW 模块；本项目独立实现 Rust 服务、协议、统计、报告、页面及 C# 桥接，未嵌入上游 GPL 应用代码。
- LibreHardwareMonitorLib **0.9.6**（MPL-2.0），使用 NuGet 原版，来源提交 `3d331e3370efb858411f19511373eff65a218701`：https://github.com/LibreHardwareMonitor/LibreHardwareMonitor 。未修改库源码。其 PawnIO 模块与其他内部组件的声明见随附 `hardware-licenses`，不自动安装驱动。
- DiskInfoToolkit **1.1.2**（MPL-2.0）：https://github.com/Blacktempel/DiskInfoToolkit/tree/25319eae5781e75bcf141e844ceab2afe94d40ea 。RAMSPDToolkit-NDD **1.4.2**（MPL-2.0）：https://github.com/Blacktempel/RAMSPDToolkit/tree/3b47b960e0830fef344624ad5e389675d5f0a1ce 。BlackSharp.Core **1.0.7**（MPL-2.0）：https://github.com/Blacktempel/BlackSharp/tree/c70b735c6cec123ee8a046ac4a0bc6c606f52cf0 。均使用原版组件，具体依赖及内容哈希见 `native/hardware-monitor/packages.lock.json`。
- HidSharp **2.6.4**（Apache-2.0）、随附 .NET 8 运行环境（MIT 及对应第三方许可）的原文保留在 `src-tauri/resources/hardware-monitor/licenses`；安装包附同一目录，桥接源码在 `native/hardware-monitor`，可独立重新编译与替换。
- Rust ETW 使用 ferrisetw **1.2.0** 的安全封装（MIT：https://github.com/n4r1b/ferrisetw）；硬件页不调用外部 PresentMon。二维码使用 qrcode **0.14.1**（MIT 或 Apache-2.0，此处采用 MIT）。

## roxmltree 0.21.2

Steam 公开列表 XML 解析使用 roxmltree，项目选择 MIT 许可。源码：https://github.com/RazrFalcon/roxmltree。以下保留许可全文。

The MIT License (MIT)

Copyright (c) 2018 Yevhenii Reizner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 安装引导依赖

安装引导使用 rfd 0.16.1（MIT）呈现原生错误提示，使用 sha2 0.10.9（MIT/Apache-2.0，此处采用 MIT）验证负载完整性。以下保留许可原文。

### rfd

MIT License

Copyright (c) 2022 Bartłomiej Maryńczak

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### sha2

Copyright (c) 2006-2009 Graydon Hoare
Copyright (c) 2009-2013 Mozilla Foundation
Copyright (c) 2016 Artyom Pavlov

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
