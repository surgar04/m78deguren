using System.Runtime.InteropServices;
using System.Text;

namespace EndfieldChargePlus.Customization;

/// <summary>使用当前 Windows 用户的 DPAPI，不持有自建主密钥；配置导出不包含机密。</summary>
public static class SecretStore
{
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Length; public nint Data; }
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CryptProtectData(ref Blob input, string? description, nint entropy, nint reserved, nint prompt, uint flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true)]
    private static extern bool CryptUnprotectData(ref Blob input, nint description, nint entropy, nint reserved, nint prompt, uint flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern nint LocalFree(nint handle);
    public static string Protect(string value) => "dpapi:" + Transform(value, true);
    public static string Unprotect(string value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (!value.StartsWith("dpapi:", StringComparison.Ordinal)) throw new FormatException("机密必须使用当前用户 DPAPI 加密");
        return Transform(value[6..], false);
    }
    private static string Transform(string value, bool encrypt)
    {
        byte[] bytes = encrypt ? Encoding.UTF8.GetBytes(value) : Convert.FromBase64String(value);
        if (bytes.Length > 65536) throw new FormatException("机密过长");
        var input = new Blob { Length = bytes.Length, Data = Marshal.AllocHGlobal(bytes.Length) };
        var output = new Blob();
        try
        {
            Marshal.Copy(bytes, 0, input.Data, bytes.Length);
            bool valid = encrypt ? CryptProtectData(ref input, null, 0, 0, 0, 1, out output)
                : CryptUnprotectData(ref input, 0, 0, 0, 0, 1, out output);
            if (!valid) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            var result = new byte[output.Length]; Marshal.Copy(output.Data, result, 0, result.Length);
            try { return encrypt ? Convert.ToBase64String(result) : Encoding.UTF8.GetString(result); }
            finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(result); }
        }
        finally
        {
            Marshal.Copy(new byte[bytes.Length], 0, input.Data, bytes.Length);
            Marshal.FreeHGlobal(input.Data); if (output.Data != 0) LocalFree(output.Data);
            System.Security.Cryptography.CryptographicOperations.ZeroMemory(bytes);
        }
    }
}
