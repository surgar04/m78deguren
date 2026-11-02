$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
Add-Type -AssemblyName System.Drawing

# 只做素材整理与格式转换：保留确认过的图形与字标，不从展示板截取整张图片。
# 生成器的透明图可能含孤立杂点；连通区域过滤后再高质量缩放，避免 ICO 出现白边。
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class ZhenjingBrandAssets {
    public static void Convert(string input, string output, int width, int height, bool icon, bool light) {
        using (var source = new Bitmap(input))
        using (var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb)) {
            using (var painter = Graphics.FromImage(bitmap)) painter.DrawImageUnscaled(source, 0, 0);
            int w = bitmap.Width, h = bitmap.Height, total = w * h;
            var rectangle = new Rectangle(0, 0, w, h);
            var data = bitmap.LockBits(rectangle, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            try {
                byte[] pixels = new byte[data.Stride * h];
                Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
                bool[] visited = new bool[total], keep = new bool[total];
                int[] queue = new int[total], largest = new int[0];
                for (int start = 0; start < total; start++) {
                    if (visited[start] || pixels[(start / w) * data.Stride + (start % w) * 4 + 3] < 128) continue;
                    int head = 0, count = 1;
                    queue[0] = start; visited[start] = true;
                    while (head < count) {
                        int current = queue[head++], x = current % w, y = current / w;
                        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                            int nx = x + dx, ny = y + dy;
                            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                            int next = ny * w + nx;
                            if (visited[next] || pixels[ny * data.Stride + nx * 4 + 3] < 128) continue;
                            visited[next] = true; queue[count++] = next;
                        }
                    }
                    if (icon) {
                        if (count > largest.Length) { largest = new int[count]; Array.Copy(queue, largest, count); }
                    } else if (count >= 64) {
                        for (int i = 0; i < count; i++) keep[queue[i]] = true;
                    }
                }
                if (icon) foreach (int position in largest) keep[position] = true;
                int left = w, top = h, right = -1, bottom = -1;
                for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
                    int offset = y * data.Stride + x * 4;
                    if (!keep[y * w + x]) { pixels[offset + 3] = 0; continue; }
                    left = Math.Min(left, x); top = Math.Min(top, y);
                    right = Math.Max(right, x); bottom = Math.Max(bottom, y);
                    // 深色主题仅调整深色字标；薄荷色的标志本体保持不变。
                    if (light && pixels[offset] < 100 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100) {
                        pixels[offset] = 247; pixels[offset + 1] = 251; pixels[offset + 2] = 250;
                    }
                }
                if (right < left || bottom < top) throw new InvalidOperationException("品牌素材没有有效像素");
                Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
                bitmap.UnlockBits(data); data = null;
                using (var result = new Bitmap(width, height, PixelFormat.Format32bppArgb))
                using (var painter = Graphics.FromImage(result)) {
                    painter.Clear(Color.Transparent);
                    painter.CompositingQuality = CompositingQuality.HighQuality;
                    painter.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    painter.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    // ICO 留 4% 安全边距；字标不额外增加空白，交由原有布局控制。
                    float margin = icon ? 0.04f : 0;
                    float scale = Math.Min(width * (1 - 2 * margin) / (right - left + 1), height * (1 - 2 * margin) / (bottom - top + 1));
                    float dw = (right - left + 1) * scale, dh = (bottom - top + 1) * scale;
                    painter.DrawImage(bitmap, new RectangleF((width - dw) / 2, (height - dh) / 2, dw, dh),
                        new RectangleF(left, top, right - left + 1, bottom - top + 1), GraphicsUnit.Pixel);
                    result.Save(output, ImageFormat.Png);
                }
            } finally { if (data != null) bitmap.UnlockBits(data); }
        }
    }
}
'@

$brandSources = Join-Path $projectRoot 'docs\design\brand-refinement-20261102'
$brandPublic = Join-Path $projectRoot 'public\assets\home'
$brandGenerated = Join-Path $projectRoot '.cache\branding'
New-Item -ItemType Directory -Path $brandGenerated -Force | Out-Null
[ZhenjingBrandAssets]::Convert((Join-Path $brandSources 'logo-lockup.png'), (Join-Path $brandPublic 'brand.png'), 560, 644, $false, $false)
[ZhenjingBrandAssets]::Convert((Join-Path $brandSources 'logo-lockup.png'), (Join-Path $brandPublic 'brand-light.png'), 560, 644, $false, $true)
[ZhenjingBrandAssets]::Convert((Join-Path $brandSources 'app-icon.png'), (Join-Path $brandGenerated 'app-icon.png'), 1024, 1024, $true, $false)
[ZhenjingBrandAssets]::Convert((Join-Path $brandSources 'app-icon.png'), (Join-Path $projectRoot 'public\favicon.png'), 64, 64, $true, $false)

# 使用项目锁定版本的 Tauri CLI 生成多分辨率 ICO；不安装全局工具、不触碰安装包。
$brandTauri = Join-Path $brandGenerated 'tauri-icons'
& pnpm exec tauri icon (Join-Path $brandGenerated 'app-icon.png') --output $brandTauri
if ($LASTEXITCODE -ne 0) { throw 'Tauri 图标生成失败' }
# 仅同步项目原有的桌面图标文件，不把其他平台的整套产物加入发行包。
foreach ($brandIcon in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src-tauri\icons') -File) {
    $brandCandidate = Join-Path $brandTauri $brandIcon.Name
    if (-not (Test-Path -LiteralPath $brandCandidate -PathType Leaf)) { throw "图标产物缺失：$($brandIcon.Name)" }
    Copy-Item -LiteralPath $brandCandidate -Destination $brandIcon.FullName -Force
}
Write-Host '已生成应用品牌图、深色版本、favicon 及桌面多尺寸图标。'
