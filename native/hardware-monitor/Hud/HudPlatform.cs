using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32;

// 上游数据引擎的宿主适配层；不加载 Avalonia，不创建额外硬件/媒体采样进程。
namespace EndfieldChargePlus
{
    public enum AppLanguage { SimplifiedChinese, English, TraditionalChinese, Japanese, German, French }
    public static class LocalizationManager
    {
        public static AppLanguage Current { get; set; } = AppLanguage.SimplifiedChinese;
        public static bool UsesChineseSource => Current == AppLanguage.SimplifiedChinese;
        public static bool IsEnglish => Current == AppLanguage.English;
        public static CultureInfo DataCulture => CultureInfo.GetCultureInfo(UsesChineseSource ? "zh-CN" : "en-US");
        public static string Text(string zh, string en) => UsesChineseSource ? zh : TranslateEnglish(en);
        public static string Formatted(string zh, FormattableString en) => UsesChineseSource ? zh : TranslateEnglish(en.ToString(DataCulture));
        public static string Formatted(string zh, string en) => Text(zh, en);
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<AppLanguage,Dictionary<string,string>> Dictionaries=new();
        public static string TranslateEnglish(string value, AppLanguage? language = null)
        {
            var selected=language??Current;if(selected is AppLanguage.English or AppLanguage.SimplifiedChinese)return value;
            var dictionary=Dictionaries.GetOrAdd(selected,key=>{
                string locale=key switch {AppLanguage.TraditionalChinese=>"zh-TW",AppLanguage.Japanese=>"ja-JP",AppLanguage.German=>"de-DE",_=>"fr-FR"};
                using var resource=typeof(LocalizationManager).Assembly.GetManifestResourceStream("Zhenjing.Hud.Locale."+locale);
                return resource is null ? new() : System.Text.Json.JsonSerializer.Deserialize<Dictionary<string,string>>(resource)??new();
            });return dictionary.GetValueOrDefault(value,value);
        }
    }
}
namespace EndfieldChargePlus.Diagnostics
{
    internal static class AppLog
    {
        public static void Warn(string message) => Console.Error.WriteLine("HUD: " + message);
        public static void Error(string message, Exception cause) => Warn(message + " " + cause.GetType().Name);
    }
}
namespace EndfieldChargePlus.Interop
{
    internal static class AppPaths
    {
        public static string DataDirectory => Environment.GetEnvironmentVariable("ZHENJING_HUD_DIR")
            ?? throw new InvalidOperationException("HUD 数据目录未由宿主配置");
    }
    internal sealed record SensorDriverState(bool Installed, string Version, bool Elevated, string Status, string Description);
    internal static class HardwareSensorDriver
    {
        // 只报告已获授权的现有桥接状态；检测到驱动不等于允许自行开启低层传感器。
        public static bool Privileged { get; set; }
        public static SensorDriverState Inspect()
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO");
            bool installed = key is not null;
            return new(installed, Convert.ToString(key?.GetValue("DisplayVersion")) ?? "", Privileged,
                Privileged ? "Ready" : installed ? "NeedsPermission" : "NotInstalled",
                Privileged ? "已连接共享传感器" : "低层传感器尚未授权");
        }
    }
}
namespace ZhenjingMonitor.Hud
{
    internal static class HudPlatform
    {
        [StructLayout(LayoutKind.Sequential)] private struct PowerStatus { public byte Ac,Flag,Percent,Saver; public uint Remaining,Full; }
        [DllImport("kernel32.dll")] private static extern bool GetSystemPowerStatus(out PowerStatus status);
        internal static object Power()=>GetSystemPowerStatus(out var status)
            ? new {acOnline=(bool?)(status.Ac==255 ? null : status.Ac==1),hasBattery=status.Flag!=128&&status.Flag!=255,percent=status.Percent<=100 ? (int?)status.Percent : null}
            : new {acOnline=(bool?)null,hasBattery=false,percent=(int?)null};
        [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct MonitorInfo
        {
            public int Size; public Rect Monitor, Work; public uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device;
        }
        private delegate bool MonitorCallback(nint monitor, nint dc, ref Rect rect, nint data);
        [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(nint dc, nint clip, MonitorCallback callback, nint data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
        public static void AddDisplay(IDictionary<string, object?> values)
        {
            int count = 0;
            MonitorCallback callback = (nint monitor, nint dc, ref Rect rect, nint data) =>
            {
                count++;
                var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>(), Device = "" };
                if (GetMonitorInfo(monitor, ref info) && (info.Flags & 1) != 0)
                {
                    values["display.primary.width"] = info.Monitor.Right - info.Monitor.Left;
                    values["display.primary.height"] = info.Monitor.Bottom - info.Monitor.Top;
                    values["display.primary.name"] = info.Device;
                    values["display.primary.resolution"] = $"{info.Monitor.Right-info.Monitor.Left}×{info.Monitor.Bottom-info.Monitor.Top}";
                }
                return true;
            };
            EnumDisplayMonitors(0, 0, callback, 0);
            values["display.count"] = count;
        }
    }
}
