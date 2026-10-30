// 使用线程池等待 stdin，避免 Windows PowerShell 5 的同步 TextReader 阻塞媒体采样。
public static class XinjingMediaInput {
    public static System.Threading.Tasks.Task<string> Next() {
        return System.Threading.Tasks.Task.Run(() => System.Console.ReadLine());
    }
}
