using System.Text;
namespace ZhenjingMonitor.Hud;
internal static class HudHttp
{
    /// <summary>自定义接口不受信任；限制解码后的内存用量与整个响应体的读取时间。</summary>
    internal static async Task<string> ReadLimitedAsync(HttpContent content,CancellationToken stop)
    {
        const int limit=1048576;
        if(content.Headers.ContentLength is > limit)throw new FormatException("HUD HTTP 响应超过 1 MiB");
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(stop);timeout.CancelAfter(TimeSpan.FromSeconds(8));
        await using var stream=await content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
        using var memory=new MemoryStream();var buffer=new byte[8192];
        while(true){int count=await stream.ReadAsync(buffer,timeout.Token).ConfigureAwait(false);if(count==0)break;
            if(memory.Length+count>limit)throw new FormatException("HUD HTTP 响应超过 1 MiB");memory.Write(buffer,0,count);}
        return Encoding.UTF8.GetString(memory.ToArray());
    }
}
