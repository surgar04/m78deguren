# 许可选择与第三方边界

本项目选择 **AGPL-3.0-only**，完整协议位于根目录 [LICENSE](../LICENSE)。`package.json` 和 Cargo package 元数据使用对应 SPDX 标识。

选择依据是项目已经集成 Folia 与 AMLL 的 AGPL 代码，而非只作截图或功能参考。MIT 等宽松协议不能替这些代码消除原有义务。GPLv3 与 AGPLv3 的组合规则见 [GNU 官方兼容说明](https://www.gnu.org/licenses/license-compatibility.html)，许可原文及常见问题以 [GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html) 和 [GNU FAQ](https://www.gnu.org/licenses/gpl-faq.html) 为准。

## 分发要求

发布安装包时保留版权及许可，提供该版本完整对应源码、锁文件、改动和必要构建材料。Git 标签应对应实际发布源码。通过网络运行修改版本时，还需遵守 AGPL 对远程交互源码提供的约定。私人的发布签名密钥不是源码的一部分，不随包公开。

根协议不将第三方代码、字体、图标、微软运行库、图片、游戏商标或外部服务重新许可。详细版本、来源提交、改动及许可文件见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。主要边界如下：

| 内容                                          | 处理方式                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Folia / AMLL                                  | 保留 AGPL 来源和许可，提供组合程序的对应源码                                                  |
| NexBox                                        | 记录功能及配置事实参考，不把上游应用或下载引擎打包为本项目组件                                |
| Endfield Charge Plus / PresentMon             | 保留 MIT 版权与许可；说明本项目适配范围                                                       |
| LibreHardwareMonitor 及硬件依赖               | 保留 MPL / Apache 等原许可与来源；未修改库不冒称本项目原创                                    |
| MiSans / Inter / Noto Serif SC / Font Awesome | 分别遵守字体、图标和代码许可；不声称全部属于 AGPL                                             |
| GSAP                                          | 使用其 Standard no-charge license，非 OSI 开源协议；按其分发条款使用，不能将其重新许可为 AGPL |
| Node.js / .NET / VC Runtime                   | 保留各自及第三方声明；微软运行库按其再分发条款处理                                            |

以上是本仓库采用的许可及来源整理，不代表第三方权利人对所有未来修改授予了额外授权。引入新组件或改动分发方式时，必须重新核对兼容性。

开发者身份仅用于官方预发布渠道和应用内模式，不添加限制复制、修改或再分发的许可条款。标志、账号服务与游戏素材也不因源码开放而自动获得任意用途授权。
