using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

/// <summary>受信任父进程指定的本地故障日志。仅记录固定事件和异常类型，不记录参数、异常正文、账号或路径。</summary>
internal static class DiagnosticLog
{
    private static string? directory;
    private static string session = "managed";
    internal static void Initialize()
    {
        try
        {
            string? selected = Environment.GetEnvironmentVariable("ZHENJING_DIAGNOSTIC_DIR");
            if (selected is null || !Path.IsPathFullyQualified(selected) || !Directory.Exists(selected)) return;
            if (Environment.GetEnvironmentVariable("ZHENJING_RESTRICT_WRITES_TO_D") == "1" && !string.Equals(Path.GetPathRoot(selected), @"D:\", StringComparison.OrdinalIgnoreCase)) return;
            for (DirectoryInfo? parent = new(selected); parent is not null; parent = parent.Parent)
                if ((parent.Attributes & FileAttributes.ReparsePoint) != 0) return;
            directory = selected;
            if (Guid.TryParse(Environment.GetEnvironmentVariable("ZHENJING_DIAGNOSTIC_SESSION"), out Guid id)) session = id.ToString();
            AppDomain.CurrentDomain.UnhandledException += (_, e) => Write("managed.unhandled", e.ExceptionObject as Exception);
            TaskScheduler.UnobservedTaskException += (_, e) => Write("managed.unobserved", e.Exception);
        }
        catch { /* 日志自身不可用时不改变硬件/媒体服务协议，也不回退到系统盘。 */ }
    }
    internal static void Write(string eventName, Exception? cause)
    {
        if (directory is null) return;
        try
        {
            string key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(directory)))[..16];
            using var mutex = new Mutex(false, @"Local\ZhenjingManagedLog-" + key);
            bool entered;
            try { entered = mutex.WaitOne(250); } catch (AbandonedMutexException) { entered = true; }
            if (!entered) return;
            try
            {
                string file = Path.Combine(directory, "managed.log");
                if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) return;
                // 四份 256 KiB 上限；只轮转当前日志，既不遍历也不删除其他用户数据。
                if (File.Exists(file) && new FileInfo(file).Length > 256 * 1024)
                    for (int n = 3; n >= 0; n--)
                    {
                        string from = n == 0 ? file : Path.Combine(directory, $"managed.{n}.log");
                        string next = Path.Combine(directory, $"managed.{n + 1}.log");
                        if (n == 3) { if (File.Exists(from)) File.Delete(from); }
                        else if (File.Exists(from)) File.Move(from, next, true);
                    }
                var row = new { schema = 1, at = DateTimeOffset.UtcNow.ToString("o"), session, version = typeof(DiagnosticLog).Assembly.GetName().Version?.ToString(3), level = "error", source = "managed", @event = eventName, operation = (string?)null, trace = (string?)null, durationMs = (long?)null, message = cause?.GetType().Name ?? "UnknownException" };
                File.AppendAllText(file, JsonSerializer.Serialize(row) + "\n", new UTF8Encoding(false));
            }
            finally { mutex.ReleaseMutex(); }
        }
        catch { /* 故障记录不可再引发递归异常或输出原始凭据。 */ }
    }
}
