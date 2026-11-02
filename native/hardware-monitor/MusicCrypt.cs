using System.Security.Cryptography;
using System.Text;
using EndfieldChargePlus.Customization;

/// <summary>音乐进程的窄 DPAPI 入口：凭据仅走标准输入输出，不使用命令行参数或明文临时文件。</summary>
internal static class MusicCrypt
{
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
