# 设置页素材来源

- 设计基准：用户附件 D:\Android\Temp\codex-clipboard-d92c7495-b722-436f-aaa2-563f1b631836.png，1487 × 1058；本目录 reference-selected.png 为原样副本。
- 基准 SHA256：BD7AE2332C587C39869CC30ACC6AF47A6560C88BEC4197D235A61D74A790D0E1。
- 预览位图：从用户提供的设计图中提取无遮挡、无界面文字的壁纸图片区域，矩形 (524,407)–(1125,635)，601 × 228，不重绘、不把图中设置控件/文字当作素材，不将整张截图铺成界面。位置为 public/assets/settings/wallpaper-preview.png。
- 预览 SHA256：4B16271C8440B08566E8072C85C6179EF6E3A9834E9B4F2F2DAE274E6E579932。
- 完整背景、品牌和头像：复用 public/assets/home 的既有独立素材；与其他页面一致。更换壁纸后由真实用户本地图替换。
- 文本、按钮、开关、导航、色板均为实际 React 控件；图标为显式 Font Awesome 导入。
- 本轮不调用图像生成器，因此没有新增 C 盘生成输出。
- 最终预览：../设置页面实现预览.png；最终整页并排：qa-comparison-full.png，左原稿、右实现。
