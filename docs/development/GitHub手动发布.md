# GitHub 手动发布

按当前选择，`dev.ps1 desktop:build` 生成本地 MSI 及完整 Release 资产，不索取 GitHub 令牌，不自动上传，也不将本地打包成功称为线上更新已生效。

1. 在 `surgar04/m78deguren` 创建稳定 Release，标签为 `v` 加当前版本号，例如 `v0.9.0`。不要设为预发布。
2. 上传 `dist/desktop` 的全部六个文件：当前版本 MSI、`zhenjing-update.json`、`SHA256SUMS.txt`、`publisher.json`、`build-info.json`、`INSTALL.md`。文件名保持原样，不能只上传 MSI。
3. 发布并将其标为 Latest。更新源为该仓库的 `releases/latest/download/zhenjing-update.json`。
4. 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 release:verify`，核对公开版本、全部资产的 GitHub SHA256、文件长度和更新清单的 Ed25519 签名。

标签中的 `v` 不能省略：`0.9.0` 和 `v0.9.0` 是两个不同的下载地址。安装说明统一采用 ASCII 文件名 `INSTALL.md`，避免 GitHub 将特殊字符文件名改成 `default.md`。发布前检查资产名称与本地完全一致；不要编辑已签名的更新清单来迁就错误标签。

已经发布的同一版本不应替换安装包。修复后提升版本号再重新构建，避免 MSI 产品身份和客户端缓存不一致。发布清单和 MSI 必须来自同一次构建；不要手工改动签名 JSON。

首次启动迁移会获取与当前应用完全相同版本的签名清单和 MSI。该版本尚未发布、资产缺失或网络不可用时，迁移不会卸载原应用；用户可稍后重试或保留当前安装位置。

私钥、PFX、口令、`.local`、开发工具及缓存不上传。MSI 使用 Sur方糖自签名证书，不代表公共 CA 认证，不要求用户导入证书。若以后自行配置发布凭据，可显式使用 `desktop:release` 或 `release:publish`；普通构建仍按手动上传流程执行。
