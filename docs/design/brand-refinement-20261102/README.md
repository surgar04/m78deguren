# 臻境标志细化与应用素材

- `zhenjing-logo-refinement.png`：用户确认的设计展示板，不作为运行时图片使用。
- `logo-lockup.png`：从确认方向生成的独立透明标志与中英文字标。
- `app-icon.png`：独立的桌面应用图标源图，不含文字。
- `prompt.txt`：设计展示板的生成提示词。

正式图片由 `scripts/build-brand-assets.ps1` 从上述源图整理生成；透明边缘去除孤立杂点，再等比缩放。保留源图便于以后复核，程序运行时不需要这些设计文件。

在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev.ps1 brand:build
```

入口统一使用 D 盘工具链和缓存。桌面多分辨率 ICO 使用锁文件固定版本的 Tauri CLI 生成。临时生成的其他平台图标仅位于 `.cache/branding`；正式同步范围限定为 `src-tauri/icons` 原有的文件。

应用默认 Logo 为 `public/assets/home/brand.png`，深色主题使用 `brand-light.png`，仅改变字标颜色。侧栏、首次启动、关于页面及默认启动画面共用这些素材；不覆盖用户自定义的启动图。网站图标为 `public/favicon.png`。

Windows 可执行文件、任务栏、托盘和后续 MSI 桌面快捷方式共同使用 `src-tauri/icons/icon.ico` 及 Tauri 默认图标。已经安装的旧版本和已分发的 MSI 不会因修改源码而改变；需要新构建才能携带新图标。本次不改变版本号、不发布安装包，也不刷新全系统图标缓存。
