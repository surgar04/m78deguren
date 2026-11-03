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
- 音乐页仅提供网易云音乐、QQ 音乐、YouTube Music 三个在线平台；第四个入口为本地曲库，支持导入音频、收藏及在线匹配封面和歌词，不需要绑定平台账号。
- 旧版选择了 Spotify 的用户会转到本地曲库；其他平台的登录会话、播放偏好和本地原始文件保留。曲目会员、地区和版权限制仍由各在线平台决定，不提供绕过方式。

参考：[微软 MSI 错误码](https://learn.microsoft.com/en-us/windows/win32/msi/windows-installer-error-messages)、[MSI 回滚机制](https://learn.microsoft.com/en-us/windows/win32/msi/rollback-installation)、[WiX 3 Package 属性](https://docs.firegiant.com/wix3/xsd/wix/package/)、[Folia 源码](https://github.com/chthollyphile/folia-major)。
