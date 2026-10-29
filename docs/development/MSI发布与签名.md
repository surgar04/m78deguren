# MSI 发布与签名

0.6.0 起只构建 MSI。入口为 dev.ps1 desktop:build / desktop:bundle，执行清理、前端与实际 Release 链接、WiX MSI、代码签名及独立 Ed25519 发布清单生成，不生成便携包或 EXE 安装引导。

WiX 3.14.1 使用固定 SHA256 的官方便携工具，全部位于 D 盘。自定义 C++ 即时动作只验证本地目录及 WebView2，不执行系统写入；文件、快捷方式和登记交由 Windows Installer 标准组件与事务处理。固定组件 GUID、UpgradeCode 与当前用户安装范围保持版本兼容，不允许降级，支持 MSI 维护重装。ICE91 关于目录不随 ALLUSERS 改变的提示对应本项目有意固定的 per-user 安装；运行时条件拒绝 ALLUSERS，未关闭 ICE 验证。

安装路径拒绝覆盖非应用用户目录、系统和数据根、目录联接或符号链接。卸载只移除 MSI 所属文件及登记，保留用户数据及安装目录中的非应用文件。不自动安装 WebView2，不修改 PATH。旧 NSIS 安装版先卸载并保留数据，再手动安装 MSI；0.5.x 客户端只识别 EXE 更新，第一次转换格式不能由旧更新器自动完成。

发布者与证书主体为 Sur方糖 / CN=Sur方糖。使用非 CA 自签名代码签名证书，私钥和口令在 .local/package-signing，ACL 仅允许当前 Windows 用户与 SYSTEM。此目录被 Git 忽略，不随发布分发；已有证书不能每次构建重新生成。证书临近到期会阻止签名，需受控轮换。当前没有公共 CA 认证及可信时间戳，不能承诺消除 Windows / SmartScreen 提示，也不能依赖时间戳延长过期后的信任。

构建和安装均不导入证书信任，不提供证书导入脚本。用户选择保留 MSI 后，已撤销另一种格式的打包、部署、应用安装程序清单、独立更新通道与相关产物。本机未曾执行该格式的安装或证书信任导入；既有 Windows 应用卷未修改。用于 MSI 签名的私钥继续安全保留。

MSI 更新清单固定为 zhenjing-update.json，使用与 Windows 代码签名独立的 Ed25519 私钥；客户端先验证仓库、平台、版本及清单签名，再验证下载长度和 SHA256，用户确认后退出并调用 msiexec。MSI 失败由事务回滚，安装后的健康检查异常会保存备份和日志供修复，不仅恢复单个 EXE 而导致版本登记失配。

公开目录仅包含当前版本 MSI、zhenjing-update.json、SHA256SUMS.txt、publisher.json、build-info.json、INSTALL.md。工具链、依赖、私钥、编译缓存与用户数据不作为发布包分发。

env:check、TypeScript、ESLint、前端测试、Rust fmt/Clippy/tests、installer:check 和真实 Windows Release 链接按适用范围验收。test:installer 只读查询 MSI 数据库、检查签名清单与哈希、核对包内主程序只允许 Tauri 安装类型标记的三个字节变化。test-package-lifecycle.ps1 仅在明确授权并传入 AllowInstall 时执行本机真实安装、维护重装、正常启动退出和卸载，并核验用户数据及文件保留；测试后清理本次应用登记、快捷方式和隔离目录。

本机实测不等于所有 Windows 版本、设备、驱动和高风险工具操作均已验收；远程 CI、干净 Windows 兼容性与线上更新必须分别记录。公开 CI 只构建实际 EXE，不生成或获取正式发布签名凭据。
