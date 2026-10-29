# 臻境 {{VERSION}} 安装说明

请从官方仓库 surgar04/m78deguren 的 Releases 获取 zhenjing-{{VERSION}}-windows-x64.msi。本项目只分发 MSI 安装包。

需要 Windows 10/11 x64 和 Microsoft Edge WebView2。双击 MSI，按向导安装；默认按当前用户安装，可选择其他本地磁盘的独立目录。不需要安装 Node、Rust、pnpm、.NET SDK 或 Visual Studio。

发布者和代码签名主体为 Sur方糖，使用自签名代码签名证书，不是公共 CA 身份认证，Windows 仍可能显示未知发布者或安全提示。安装包不要求用户导入证书，不修改系统证书信任；请从可信发布源获取，并通过 SHA256SUMS.txt 核对文件。

旧 EXE 安装版请先卸载，再安装 MSI，用户数据会保留。0.5.x 更新器不识别新格式，需要手动迁移一次；后续版本继续使用 MSI 更新。

默认用户数据位于 %LOCALAPPDATA%\Zhenjing，卸载保留设置、备份、下载和硬件记录。沿用自定义目录时，可通过 --data-dir 指定原目录。可以从 Windows「设置 → 应用 → 安装的应用」中维护或卸载。

更新清单以独立的 Ed25519 发布密钥签名，下载后核验 SHA256 和长度，用户确认退出后才执行 Windows Installer 事务安装。安装失败由系统回滚；启动异常会保留维护记录供修复，不通过单独替换旧 EXE 破坏产品登记。

publisher.json 记录签名证书信息；build-info.json 记录构建版本和安装包摘要。发布文件不含 PFX、口令或更新签名私钥。没有发布至 Releases 时，本地生成不代表线上更新已可用。
