using System.Security.Cryptography;
using System.Text;
using EndfieldChargePlus.Customization;

/// <summary>音乐进程的窄 DPAPI 入口：凭据仅走标准输入输出，不使用命令行参数或明文临时文件。</summary>
internal static class MusicCrypt
{
    /// <summary>只读浏览器文件版本，不通过 --version 启动默认档案，避免授权身份与随机 UA 不一致。</summary>
    internal static int BrowserVersion()
    {
        try
        {
            string file = Console.In.ReadLine() ?? "";
            if (file.Length > 1024 || !Path.IsPathFullyQualified(file) || !File.Exists(file)
                || Path.GetFileName(file).ToLowerInvariant() is not ("chrome.exe" or "msedge.exe" or "brave.exe")) return 2;
            int major = System.Diagnostics.FileVersionInfo.GetVersionInfo(file).FileMajorPart;
            if (major < 80 || major > 300) return 3;
            Console.Write(major.ToString(System.Globalization.CultureInfo.InvariantCulture));
            return 0;
        }
        catch { return 3; }
    }
    /// <summary>
    /// 逐地址只读解析当前用户的系统代理（包含 Windows PAC/WPAD）。地址由标准输入传入，
    /// 不将带签名的媒体 URL 放入命令行或日志；超时由调用方终止本次独立辅助进程。
    /// 这里不安装代理、不修改注册表，也不自动尝试其他用户的网络凭据。
    /// </summary>
    internal static int Route()
    {
        try
        {
            string input = Console.In.ReadLine() ?? "";
            if (input.Length > 16384 || !Uri.TryCreate(input, UriKind.Absolute, out Uri? target)
                || target.Scheme != "https" || target.UserInfo.Length != 0 || !target.IsDefaultPort) return 2;
            string[] domains = ["youtube.com", "google.com", "googleapis.com", "googlevideo.com", "ytimg.com", "ggpht.com", "googleusercontent.com", "gstatic.com"];
            if (!domains.Any(host => target.Host.Equals(host, StringComparison.OrdinalIgnoreCase)
                || target.Host.EndsWith('.' + host, StringComparison.OrdinalIgnoreCase))) return 2;
            var proxy = System.Net.Http.HttpClient.DefaultProxy;
            Uri? endpoint = proxy.GetProxy(target);
            Console.OutputEncoding = new UTF8Encoding(false);
            if (endpoint is null || endpoint == target)
                Console.Write("{\"mode\":\"direct\"}");
            else
            {
                if (endpoint.Scheme is not ("http" or "https") || endpoint.UserInfo.Length != 0) return 3;
                Console.Write(System.Text.Json.JsonSerializer.Serialize(new { mode = "proxy", proxy = endpoint.AbsoluteUri }));
            }
            return 0;
        }
        catch { return 3; }
    }
    /// <summary>只读当前用户的显式 Windows HTTP 代理，不改系统设置，也不输出任何凭据。</summary>
    internal static int Proxy()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", false);
            if (key?.GetValue("ProxyEnable") is not int enabled || enabled != 1 || key.GetValue("ProxyServer") is not string configured || configured.Length > 4096) return 0;
            string[] fields = configured.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            string? endpoint = fields.FirstOrDefault(value => value.StartsWith("https=", StringComparison.OrdinalIgnoreCase))?[6..]
                ?? fields.FirstOrDefault(value => value.StartsWith("http=", StringComparison.OrdinalIgnoreCase))?[5..]
                ?? (fields.Length == 1 && !fields[0].Contains('=') ? fields[0] : null);
            if (endpoint is null) return 0;
            if (!endpoint.Contains("://", StringComparison.Ordinal)) endpoint = "http://" + endpoint;
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out Uri? uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0) return 0;
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.Write(uri.AbsoluteUri);
            return 0;
        }
        catch { return 0; }
    }
    internal static int Run(string operation)
    {
        if (operation is not ("protect" or "unprotect")) return 2;
        byte[] buffer = new byte[131073];
        try
        {
            using var input = Console.OpenStandardInput();
            int length = 0;
            while (length < buffer.Length)
            {
                int read = input.Read(buffer, length, buffer.Length - length);
                if (read == 0) break;
                length += read;
            }
            if (length > 131072) return 2;
            string value = new UTF8Encoding(false, true).GetString(buffer, 0, length);
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.Write(operation == "protect" ? SecretStore.Protect(value) : SecretStore.Unprotect(value));
            return 0;
        }
        catch
        {
            // 不把异常中的输入、账户票据或明文凭据写到诊断通道。
            Console.Error.WriteLine("音乐会话的 Windows 用户保护不可用");
            return 3;
        }
        finally { CryptographicOperations.ZeroMemory(buffer); }
    }
}
