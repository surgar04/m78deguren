using System.Diagnostics;
using System.Runtime.InteropServices;

namespace ZhenjingMonitor.Hud;

internal sealed record GameCandidate(uint ProcessId, string Name, string Reason);

/// <summary>
/// 不注入游戏、不依赖 Steam 启动。优先使用用户/Steam 的真实路径，其次检查前台渲染程序。
/// 图形程序并不必然是游戏，因此保留排除规则和手动模式，不把浏览器视频误报成游戏。
/// </summary>
internal static class GameDetector
{
    private static long _next;
    private static GameCandidate? _current;
    internal static string[] Paths { get; set; } = [];
    internal static string[] Include { get; set; } = [];
    internal static string[] Exclude { get; set; } = [];
    internal static bool Enabled { get; set; }
    private static readonly HashSet<string> NonGames = new(StringComparer.OrdinalIgnoreCase)
    { "explorer", "dwm", "zhenjing", "zhenjingmonitor", "chrome", "msedge", "firefox", "msedgewebview2", "steam", "steamwebhelper", "wallpaper32", "wallpaper64", "obs64", "vlc", "code", "devenv", "discord", "wechat", "qq", "powershell", "pwsh", "applicationframehost", "searchhost", "shellexperiencehost", "taskmgr" };
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out uint pid);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint window, out Rect rect);
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint window, uint flags);
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public uint Size; public Rect Monitor,Work; public uint Flags; }
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    internal static GameCandidate? Read()
    {
        if (!Enabled) { _current=null; return null; }
        if (Environment.TickCount64 < _next) return _current;
        _next = Environment.TickCount64 + 3000;
        try
        {
            GetWindowThreadProcessId(GetForegroundWindow(), out uint pid);
            using var foreground = Process.GetProcessById(checked((int)pid));
            var found = Inspect(foreground);
            if (found is not null) return _current = found;
            if (_current is not null)
            {
                using var previous = Process.GetProcessById(checked((int)_current.ProcessId));
                if (!previous.HasExited) return _current;
            }
        }
        catch (Exception cause) when (cause is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or OverflowException) { }
        _current = null;
        return null;
    }
    private static GameCandidate? Inspect(Process process)
    {
        string name = process.ProcessName;
        if (Exclude.Any(item => SameName(item, name))) return null;
        if (Include.Any(item => SameName(item, name))) return new((uint)process.Id, name, "用户游戏规则");
        if (NonGames.Contains(name) || process.MainWindowHandle == 0) return null;
        string? path = process.MainModule?.FileName;
        if (path is not null && Paths.Any(item => path.Equals(item, StringComparison.OrdinalIgnoreCase)
            || path.StartsWith(item.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)))
            return new((uint)process.Id, name, "已登记游戏路径");
        bool graphics = false, engine = false;
        foreach (ProcessModule module in process.Modules)
        {
            string file = module.ModuleName;
            graphics |= file.Equals("dxgi.dll", StringComparison.OrdinalIgnoreCase) || file.Equals("d3d9.dll", StringComparison.OrdinalIgnoreCase)
                || file.Equals("vulkan-1.dll", StringComparison.OrdinalIgnoreCase) || file.Equals("opengl32.dll", StringComparison.OrdinalIgnoreCase);
            engine |= file.Equals("UnityPlayer.dll", StringComparison.OrdinalIgnoreCase) || file.StartsWith("steam_api", StringComparison.OrdinalIgnoreCase)
                || file.StartsWith("EOSSDK-", StringComparison.OrdinalIgnoreCase) || file.Equals("SDL2.dll", StringComparison.OrdinalIgnoreCase)
                || file.Equals("SDL3.dll", StringComparison.OrdinalIgnoreCase) || file.Equals("GameAssembly.dll", StringComparison.OrdinalIgnoreCase);
        }
        string original = process.MainModule?.FileVersionInfo.OriginalFilename ?? "";
        engine |= name.EndsWith("-Shipping", StringComparison.OrdinalIgnoreCase) || original.Contains("Godot", StringComparison.OrdinalIgnoreCase);
        var monitor = new MonitorInfo {Size=(uint)Marshal.SizeOf<MonitorInfo>()};
        bool fullscreen=GetWindowRect(process.MainWindowHandle,out var window)
            && GetMonitorInfo(MonitorFromWindow(process.MainWindowHandle,2),ref monitor)
            && Math.Abs(window.Right-window.Left-(monitor.Monitor.Right-monitor.Monitor.Left))<=16
            && Math.Abs(window.Bottom-window.Top-(monitor.Monitor.Bottom-monitor.Monitor.Top))<=16;
        return graphics && (engine || fullscreen) ? new((uint)process.Id, name, engine ? "图形接口与游戏引擎" : "全屏图形程序") : null;
    }
    private static bool SameName(string rule, string name) => Path.GetFileNameWithoutExtension(rule).Equals(name, StringComparison.OrdinalIgnoreCase);
}
