// 原生八向轮盘：复用首页助手的消息线程与键盘钩子，不创建额外 WebView/采样进程。
// 输入回调只更新标志；图标 IO、绘制、配置和输出均由消息定时器完成。
namespace Zhenjing.Home
{
  public sealed class WheelSlot { public string label, icon; public bool available, game; }
  public sealed class WheelSettings { public bool enabled, desktopOnly = true; public int holdMs = 350, size = 420; public double opacity = 0.94; public string position = "cursor", triggerKey = "G"; public WheelSlot[] slots = new WheelSlot[8]; }
  internal static class WheelController
  {
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr GetForegroundWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] static extern int GetClassName(System.IntPtr window, System.Text.StringBuilder text, int count);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr SetThreadDpiAwarenessContext(System.IntPtr context);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern uint GetDpiForWindow(System.IntPtr window);
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct Mouse { public int x, y; public uint data, flags, time; public System.UIntPtr extra; }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct Key { public ushort vk, scan; public uint flags, time; public System.UIntPtr extra; }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Explicit)] struct Union { [System.Runtime.InteropServices.FieldOffset(0)] public Mouse mouse; [System.Runtime.InteropServices.FieldOffset(0)] public Key key; }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct Input { public uint type; public Union data; }
    static WheelSettings pending, config = new WheelSettings();
    static volatile bool requested, preview;
    static bool held, released, cancelled, visible, dpiSet, ready;
    static long pressed;
    static int heldKey;
    static System.IntPtr foreground;
    static WheelForm form;
    static System.Action<object> output;
    static string root;
    static System.Threading.Mutex ownership;
    static bool owns;
    public static bool Requested { get { return requested; } }
    public static void Initialize(System.Action<object> writer, string directory) { output = writer; root = directory; }
    public static void Configure(WheelSettings next) { if (next == null) next = new WheelSettings(); requested = next.enabled; System.Threading.Interlocked.Exchange(ref pending, next); }
    public static void Preview() { preview = true; }
    static bool Modifiers() { return (GetAsyncKeyState(0x10) & 0x8000) != 0 || (GetAsyncKeyState(0x11) & 0x8000) != 0 || (GetAsyncKeyState(0x12) & 0x8000) != 0 || (GetAsyncKeyState(0x5b) & 0x8000) != 0 || (GetAsyncKeyState(0x5c) & 0x8000) != 0; }
    static bool Desktop() { var name = new System.Text.StringBuilder(128); GetClassName(GetForegroundWindow(), name, name.Capacity); return name.ToString() == "Progman" || name.ToString() == "WorkerW"; }
    /// 只允许独立字母键。Tab 及组合键始终透传，不改变 Windows 的焦点导航。
    public static int TriggerCode(string key) { return key != null && key.Length == 1 && key[0] >= 'A' && key[0] <= 'Z' ? key[0] : 0; }
    /// 短按在原前台窗口重放完整按下/释放；使用按下时的键码，避免配置切换后误发其他字符。
    static void Replay() { if (GetForegroundWindow() != foreground || Modifiers()) return; var input = new Input[2]; input[0].type = input[1].type = 1; input[0].data.key.vk = input[1].data.key.vk = (ushort)heldKey; input[1].data.key.flags = 2; SendInput(2, input, System.Runtime.InteropServices.Marshal.SizeOf(typeof(Input))); }
    public static bool Keyboard(int code, System.IntPtr message, System.IntPtr data)
    {
      if (code < 0) return false; int key = System.Runtime.InteropServices.Marshal.ReadInt32(data); int flags = System.Runtime.InteropServices.Marshal.ReadInt32(data, 8);
      if ((flags & 0x10) != 0) return false; long kind = message.ToInt64(); bool down = kind == 0x100 || kind == 0x104;
      if (key == 27 && down && held) { cancelled = true; return true; }
      // 配置更新时仍正确吞掉原按键的重复/释放事件，不占用新触发键的释放事件。
      if (held && key == heldKey) { if (!down) { held = false; released = true; } return true; }
      if (key != TriggerCode(config.triggerKey) || !down || held) return false;
      if (!requested || !ready || Modifiers() || (config.desktopOnly && !Desktop())) return false;
      foreground = GetForegroundWindow(); heldKey = key; held = true; released = false; cancelled = false; pressed = System.Diagnostics.Stopwatch.GetTimestamp(); return true;
    }
    static double Elapsed() { return (System.Diagnostics.Stopwatch.GetTimestamp() - pressed) * 1000.0 / System.Diagnostics.Stopwatch.Frequency; }
    static void Status(string message) { if (output != null) output(new { kind = "wheel-state", runtime = new { ready = ready, visible = visible, message = message } }); }
    public static void HookReady(bool installed) { bool next = installed && requested && owns; if (ready != next) { ready = next; Status(requested && !next ? "轮盘键盘钩子不可用或已有另一实例占用" : ""); } }
    public static void Pulse(bool ending)
    {
      if (!dpiSet) { try { SetThreadDpiAwarenessContext((System.IntPtr)(-4)); } catch (System.EntryPointNotFoundException) { } dpiSet = true; }
      var next = System.Threading.Interlocked.Exchange(ref pending, null);
      if (next != null)
      {
        if (next.slots == null || next.slots.Length != 8 || TriggerCode(next.triggerKey) == 0 || next.holdMs < 200 || next.holdMs > 1500 || next.size < 300 || next.size > 640 || double.IsNaN(next.opacity) || next.opacity < 0.35 || next.opacity > 1) throw new System.IO.IOException("轮盘原生配置超出限制");
        if (held || released) cancelled = true;
        if (form != null) { form.Dispose(); form = null; }
        visible = false; config = next;
        if (config.enabled && !owns) { if (ownership == null) ownership = new System.Threading.Mutex(false, "Local\\ZhenjingWheel-" + System.Security.Principal.WindowsIdentity.GetCurrent().User.Value); try { owns = ownership.WaitOne(0); } catch (System.Threading.AbandonedMutexException) { owns = true; } }
        if (!config.enabled && owns) { ownership.ReleaseMutex(); owns = false; }
      }
      if (ending) { requested = false; held = false; released = false; preview = false; if (form != null) { form.Dispose(); form = null; } visible = false; if (owns) { ownership.ReleaseMutex(); owns = false; } if (ownership != null) { ownership.Dispose(); ownership = null; } return; }
      if (cancelled && visible) { form.Hide(); visible = false; Status(""); }
      if ((held && !cancelled && !visible && Elapsed() >= config.holdMs && GetForegroundWindow() == foreground) || preview)
      {
        bool isPreview = preview; preview = false;
        if (form == null) form = new WheelForm(config, root); form.Open(isPreview); visible = true; Status(isPreview ? "预览不会执行槽位动作" : "");
      }
      if (visible && form != null && !form.Visible) { visible = false; Status(""); }
      if (released)
      {
        released = false;
        // 释放和焦点变化可能发生在同一计时周期，必须在派发前再检查前台和修饰键。
        if (visible) { int selection = form.Selection; form.Hide(); visible = false; Status(""); if (!cancelled && GetForegroundWindow() == foreground && !Modifiers() && selection >= 0 && config.slots[selection] != null && config.slots[selection].available && output != null) output(new { kind = "wheel-launch", slot = selection }); }
        else if (!cancelled && Elapsed() < config.holdMs) Replay();
        cancelled = false;
      }
      if (visible && held && (GetForegroundWindow() != foreground || Modifiers())) { cancelled = true; form.Hide(); visible = false; Status(""); }
    }
    // 纯几何函数可单元验收，中心和圆外均取消；方向 0 为北，顺时针共 8 项。
    public static int Direction(double x, double y, double radius) { double distance = System.Math.Sqrt(x * x + y * y); if (distance < radius * (0.19 / 0.47) || distance > radius) return -1; double angle = System.Math.Atan2(y, x) * 180 / System.Math.PI + 90; return ((int)System.Math.Floor((angle + 360 + 22.5) / 45)) % 8; }
    internal sealed class WheelForm : System.Windows.Forms.Form
    {
      [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct Point { public int x, y; public Point(int x, int y) { this.x = x; this.y = y; } }
      [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct NativeSize { public int w, h; public NativeSize(int w, int h) { this.w = w; this.h = h; } }
      [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, Pack = 1)] struct Blend { public byte operation, flags, alpha, format; }
      [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr GetDC(System.IntPtr window);
      [System.Runtime.InteropServices.DllImport("user32.dll")] static extern int ReleaseDC(System.IntPtr window, System.IntPtr dc);
      [System.Runtime.InteropServices.DllImport("gdi32.dll")] static extern System.IntPtr CreateCompatibleDC(System.IntPtr dc);
      [System.Runtime.InteropServices.DllImport("gdi32.dll")] static extern System.IntPtr SelectObject(System.IntPtr dc, System.IntPtr obj);
      [System.Runtime.InteropServices.DllImport("gdi32.dll")] static extern bool DeleteObject(System.IntPtr obj);
      [System.Runtime.InteropServices.DllImport("gdi32.dll")] static extern bool DeleteDC(System.IntPtr dc);
      [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)] static extern bool UpdateLayeredWindow(System.IntPtr window, System.IntPtr destination, ref Point target, ref NativeSize size, System.IntPtr source, ref Point offset, int key, ref Blend blend, int flags);
      readonly WheelSettings settings; readonly System.Drawing.Image[] icons = new System.Drawing.Image[8];
      readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 16 };
      System.Diagnostics.Stopwatch animation = new System.Diagnostics.Stopwatch();
      bool previewMode; System.Drawing.Point initialMouse; int previous = -2; public int Selection { get; private set; }
      public WheelForm(WheelSettings settings, string directory)
      {
        this.settings = settings; Text = "臻境 · 快捷轮盘"; FormBorderStyle = System.Windows.Forms.FormBorderStyle.None; ShowInTaskbar = false; TopMost = true; StartPosition = System.Windows.Forms.FormStartPosition.Manual;
        for (int i = 0; i < 8; i++)
        {
          var slot = settings.slots[i]; if (slot == null || string.IsNullOrWhiteSpace(slot.icon)) continue;
          try
          {
            string path = System.IO.Path.GetFullPath(slot.icon); string allowed = System.IO.Path.GetFullPath(System.IO.Path.Combine(directory, "icons")) + "\\";
            if (!path.StartsWith(allowed, System.StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(path) || new System.IO.FileInfo(path).Length > 393216) continue;
            if ((System.IO.File.GetAttributes(path) & System.IO.FileAttributes.ReparsePoint) != 0) continue;
            using (var stream = System.IO.File.OpenRead(path)) using (var image = System.Drawing.Image.FromStream(stream)) { if (image.Width <= 512 && image.Height <= 512) icons[i] = new System.Drawing.Bitmap(image); }
          }
          catch (System.Exception) { }
        }
        timer.Tick += delegate
        {
          if (!Visible) { timer.Stop(); return; }
          var mouse = System.Windows.Forms.Control.MousePosition; double moved = System.Math.Sqrt(System.Math.Pow(mouse.X - initialMouse.X, 2) + System.Math.Pow(mouse.Y - initialMouse.Y, 2)); Selection = moved < System.Math.Max(12, Width * 0.03) ? -1 : Direction(mouse.X - (Left + Width / 2.0), mouse.Y - (Top + Height / 2.0), Width * 0.47);
          if (previewMode && animation.ElapsedMilliseconds > 8000) { Hide(); timer.Stop(); return; }
          if (animation.ElapsedMilliseconds < 180 || Selection != previous) { previous = Selection; Render(); }
        };
        MouseDown += delegate { Hide(); };
      }
      protected override bool ShowWithoutActivation { get { return true; } }
      protected override System.Windows.Forms.CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x80000 | 0x80 | 0x08000000; return p; } }
      public void Open(bool preview)
      {
        previewMode = preview; var mouse = System.Windows.Forms.Control.MousePosition; var screen = System.Windows.Forms.Screen.FromPoint(mouse); var area = screen.WorkingArea;
        double dpi = 96; try { uint value = GetDpiForWindow(GetForegroundWindow()); if (value >= 96 && value <= 768) dpi = value; } catch (System.EntryPointNotFoundException) { }
        int size = System.Math.Min((int)(settings.size * dpi / 96), System.Math.Min(area.Width, area.Height) - 24); size = System.Math.Max(200, size);
        int x = settings.position == "center" ? area.Left + (area.Width - size) / 2 : mouse.X - size / 2; int y = settings.position == "center" ? area.Top + (area.Height - size) / 2 : mouse.Y - size / 2;
        SetBounds(System.Math.Max(area.Left + 8, System.Math.Min(area.Right - size - 8, x)), System.Math.Max(area.Top + 8, System.Math.Min(area.Bottom - size - 8, y)), size, size);
        initialMouse = mouse; Selection = -1; previous = -2; animation.Restart(); Show(); Render(); timer.Start();
      }
      static System.Drawing.Drawing2D.GraphicsPath Sector(float center, float outer, float inner, float angle) { var path = new System.Drawing.Drawing2D.GraphicsPath(); path.AddArc(center - outer, center - outer, outer * 2, outer * 2, angle, 45); path.AddArc(center - inner, center - inner, inner * 2, inner * 2, angle + 45, -45); path.CloseFigure(); return path; }
      void DrawLabel(System.Drawing.Graphics g, string text, float size, System.Drawing.Color color, System.Drawing.RectangleF box) { using (var font = new System.Drawing.Font("Microsoft YaHei UI", size, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Pixel)) using (var brush = new System.Drawing.SolidBrush(color)) using (var format = new System.Drawing.StringFormat { Alignment = System.Drawing.StringAlignment.Center, LineAlignment = System.Drawing.StringAlignment.Center, Trimming = System.Drawing.StringTrimming.EllipsisCharacter }) { g.DrawString(text, font, brush, box, format); } }
      void Render() { try { RenderFrame(); } catch (System.Exception error) { timer.Stop(); Hide(); ready = false; requested = false; Status("轮盘绘制失败，已停止捕获触发键：" + error.Message); } }
      void RenderFrame()
      {
        if (Width < 1 || Height < 1) return; using (var bitmap = new System.Drawing.Bitmap(Width, Height, System.Drawing.Imaging.PixelFormat.Format32bppPArgb)) using (var g = System.Drawing.Graphics.FromImage(bitmap))
        {
          g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit; g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
          float size = Width, c = size / 2, outer = size * 0.47f, inner = size * 0.19f; float p = System.Math.Min(1, animation.ElapsedMilliseconds / 160f); float scale = 0.88f + 0.12f * (1 - (float)System.Math.Pow(1 - p, 3)); g.TranslateTransform(c, c); g.ScaleTransform(scale, scale); g.TranslateTransform(-c, -c);
          for (int i = 0; i < 8; i++)
          {
            var slot = settings.slots[i]; bool available = slot != null && slot.available; bool selected = Selection == i && available;
            using (var path = Sector(c, outer, inner, -112.5f + i * 45)) using (var brush = new System.Drawing.SolidBrush(selected ? System.Drawing.Color.FromArgb(245, 171, 245, 226) : System.Drawing.Color.FromArgb(238, 245, 253, 252))) using (var pen = new System.Drawing.Pen(selected ? System.Drawing.Color.FromArgb(255, 46, 190, 159) : System.Drawing.Color.FromArgb(160, 255, 255, 255), selected ? 2 : 1)) { g.FillPath(brush, path); g.DrawPath(pen, path); }
            double angle = (-90 + i * 45) * System.Math.PI / 180; float x = c + (float)System.Math.Cos(angle) * size * 0.33f, y = c + (float)System.Math.Sin(angle) * size * 0.33f;
            // 图标以扇区径向中点为中心，文字独立排在下方，不再把图标挤到区域上沿。
            if (icons[i] != null) { float imageSize = size * 0.08f; g.DrawImage(icons[i], x - imageSize / 2, y - imageSize / 2, imageSize, imageSize); }
            // 没有 EXE 图标的固定功能使用 Windows 自带图形字体，不用文字冒充图标，也不增加打包字体。
            // 字形来源：https://learn.microsoft.com/windows/apps/design/iconography/segoe-ui-symbol-font
            else if (available) { using (var font = new System.Drawing.Font("Segoe MDL2 Assets", size * 0.07f, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Pixel)) using (var brush = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(24, 136, 119))) using (var format = new System.Drawing.StringFormat { Alignment = System.Drawing.StringAlignment.Center, LineAlignment = System.Drawing.StringAlignment.Center }) { g.DrawString(slot.game ? "\uE7FC" : "\uE90F", font, brush, new System.Drawing.RectangleF(x - size * 0.05f, y - size * 0.05f, size * 0.1f, size * 0.1f), format); } }
            else { using (var pen = new System.Drawing.Pen(System.Drawing.Color.FromArgb(140, 165, 174), size * 0.005f)) { float r = size * 0.022f; g.DrawLine(pen, x - r, y, x + r, y); g.DrawLine(pen, x, y - r, x, y + r); } }
            DrawLabel(g, available ? slot.label : "未配置", size * 0.027f, available ? System.Drawing.Color.FromArgb(24, 55, 65) : System.Drawing.Color.FromArgb(130, 151, 156), new System.Drawing.RectangleF(x - size * 0.1f, y + size * 0.055f, size * 0.2f, size * 0.05f));
          }
          using (var brush = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(245, 243, 253, 250))) using (var pen = new System.Drawing.Pen(System.Drawing.Color.FromArgb(180, 159, 223, 211), 1)) { g.FillEllipse(brush, c - inner + 3, c - inner + 3, inner * 2 - 6, inner * 2 - 6); g.DrawEllipse(pen, c - inner + 3, c - inner + 3, inner * 2 - 6, inner * 2 - 6); }
          string title = Selection >= 0 && settings.slots[Selection] != null && settings.slots[Selection].available ? settings.slots[Selection].label : "快捷轮盘";
          DrawLabel(g, title, size * 0.04f, System.Drawing.Color.FromArgb(25, 57, 65), new System.Drawing.RectangleF(c - inner + 10, c - size * 0.08f, inner * 2 - 20, size * 0.13f));
          DrawLabel(g, previewMode ? "预览 · 不执行操作" : "松开 " + settings.triggerKey + " 启动", size * 0.025f, System.Drawing.Color.FromArgb(79, 119, 124), new System.Drawing.RectangleF(c - inner + 6, c + size * 0.05f, inner * 2 - 12, size * 0.06f));
          DrawLabel(g, "中心取消 · Esc 关闭", size * 0.023f, System.Drawing.Color.FromArgb(108, 140, 144), new System.Drawing.RectangleF(c - inner + 3, c + size * 0.11f, inner * 2 - 6, size * 0.05f));
          System.IntPtr screenDc = GetDC(System.IntPtr.Zero), memoryDc = System.IntPtr.Zero, image = System.IntPtr.Zero, old = System.IntPtr.Zero;
          try { memoryDc = CreateCompatibleDC(screenDc); image = bitmap.GetHbitmap(System.Drawing.Color.FromArgb(0)); old = SelectObject(memoryDc, image); var target = new Point(Left, Top); var dimensions = new NativeSize(Width, Height); var offset = new Point(0, 0); var blend = new Blend { alpha = (byte)(255 * settings.opacity * p), format = 1 }; if (!UpdateLayeredWindow(Handle, screenDc, ref target, ref dimensions, memoryDc, ref offset, 0, ref blend, 2)) throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error()); }
          finally { if (old != System.IntPtr.Zero) SelectObject(memoryDc, old); if (image != System.IntPtr.Zero) DeleteObject(image); if (memoryDc != System.IntPtr.Zero) DeleteDC(memoryDc); if (screenDc != System.IntPtr.Zero) ReleaseDC(System.IntPtr.Zero, screenDc); }
        }
      }
      protected override void Dispose(bool disposing) { if (disposing) { timer.Stop(); timer.Dispose(); foreach (var icon in icons) if (icon != null) icon.Dispose(); } base.Dispose(disposing); }
    }
  }
}
