# MSI 安装问题排查

## Config.Msi / 1926 / 系统错误 5

`X:\Config.Msi\*.rbf` 是 Windows Installer 的回滚备份，不是臻境缓存。旧包声明无需提升权限，在部分数据盘上无法设置回滚文件的安全描述符。修订后的包保留当前用户登记、升级标识和完整事务回滚，但通过标准 MSI 请求管理员授权。不要使用另一个账户手动启动应用，也不要更改 ALLUSERS。

关闭臻境，运行修订后的 MSI，接受 Windows 的 UAC 授权。如系统目录本身的 ACL 损坏或安全软件阻止，即使提升权限也可能失败；需要该机器的日志确认，不能仅凭截图断言已修复磁盘权限。

在安装包所在目录打开 PowerShell，可使用下面的命令记录日志。将版本文件名换成实际文件名；日志放在安装包旁边，不含账号令牌，但分享前仍应检查用户名和本地路径。

```powershell
$installer = (Resolve-Path -LiteralPath '.\zhenjing-VERSION-windows-x64.msi').Path
$installLog = Join-Path ([IO.Path]::GetDirectoryName($installer)) 'zhenjing-install.log'
& "$env:SystemRoot\System32\msiexec.exe" /i $installer /L*v $installLog
```

若错误仍指向 `X:\Config.Msi`，请管理员只读检查该目录、盘根的 SYSTEM / Administrators 权限、目录所有者及安全软件日志，定位 MSI 日志中 `Return value 3` 前后的具体错误。将 `X` 替换为错误里的磁盘：

```powershell
icacls X:\Config.Msi
icacls X:\
```

不要递归修改整个磁盘权限、授予 Everyone 完全控制、删除 Config.Msi 或设置 DisableRollback。其他软件安装可能共享该目录，删除它会破坏仍在执行的事务。权限确需修复时应由管理员备份 ACL 后根据该机器的实际状态处理。

## 音乐平台问题

- YouTube Music 使用网页版账号授权与独立隔离脚本窗口，不依赖不存在的官方原生桌面客户端，也不要求安装 PWA。
- 使用连接弹窗启动的浏览器完成授权；首次失败可直接重新连接，无需重启整个应用。保留当前账号原始浏览器资料，不手动复制 Cookie。
- Spotify 的 Folia 播放链路要求 Premium；能绑定账号不代表账号具有第三方播放权益。平台拒绝音频密钥、地区版权限制与网络失败会分别提示，不能通过重试无限绕过。
- Spotify 原生播放连接与网页 HTTP 请求是不同链路。仅浏览器/HTTP 代理可用不能证明原生 TCP 音频连接可用；中国大陆使用者需要确保网络方案实际覆盖 Spotify 播放连接。不得关闭证书验证或导出账号令牌来排障。

参考：[微软 MSI 错误码](https://learn.microsoft.com/en-us/windows/win32/msi/windows-installer-error-messages)、[MSI 回滚机制](https://learn.microsoft.com/en-us/windows/win32/msi/rollback-installation)、[WiX 3 Package 属性](https://docs.firegiant.com/wix3/xsd/wix/package/)、[Folia 源码](https://github.com/chthollyphile/folia-major)。
