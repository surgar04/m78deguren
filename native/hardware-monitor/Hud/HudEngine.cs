using System.Text.Json;
using EndfieldChargePlus.Customization;
using LibreHardwareMonitor.Hardware;

namespace ZhenjingMonitor.Hud;

/// <summary>
/// 与硬件采样同进程的上游 HUD 数据引擎。仅采集当前方案需要的变量；慢 WMI/HTTP
/// 在单个后台任务中执行，永不阻塞硬件主循环，也不会按定时器无限堆积任务。
/// </summary>
internal sealed class HudEngine : IDisposable
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    private sealed record Input(bool Enabled, bool Active, bool FrameSampling, int SamplingMs, string Locale, CustomHudSettings Settings,
        Dictionary<string, JsonElement>? External, string[]? GamePaths, string[]? IncludeProcesses, string[]? ExcludeProcesses);
    private readonly Action<object> _send;
    private readonly VariableHub _hub = new();
    private readonly CancellationTokenSource _stop = new();
    private Input? _input;
    private Task _pending = Task.CompletedTask;
    private long _nextRead;
    private bool _catalogSent;
    private long _nextCatalog;
    private bool _framesWanted;
    private readonly HudTriggerEvaluator _triggers = new();

    internal HudEngine(Action<object> send)
    {
        _send = send;
        // Console.In 的同步包装器可能在 ReadLineAsync 返回前阻塞；不能在构造线程启动读循环。
        // 独立线程池任务确保无输入/输入未变化时也不阻塞硬件初始化和采样。
        _ = Task.Run(ReceiveAsync);
    }
    private async Task ReceiveAsync()
    {
        try
        {
            while (!_stop.IsCancellationRequested)
            {
                var line = await Console.In.ReadLineAsync(_stop.Token).ConfigureAwait(false);
                if (line is null) return;
                if (line.Length > 524288) throw new FormatException("HUD IPC 超出大小限制");
                try {
                    var input = JsonSerializer.Deserialize<Input>(line, Json);
                    Volatile.Write(ref _input, input);
                } catch(JsonException cause) {
                    // 只报告字段路径，不输出含密钥的原始消息；错误帧不终止后续控制。
                    _send(new{type="hud",data=new{error="HUD 控制字段无效："+cause.Path}});
                }
            }
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        catch (Exception cause) { _send(new { type = "hud", data = new { error = "HUD 控制通道异常：" + cause.GetType().Name } }); }
    }
    internal static object Catalog() => new
    {
        profiles = CustomHudSettings.CreateDefaultProfiles().Select(p => p with { Id = p.BuiltInKey }),
        variables = VariableCatalog.AllBuiltIns,
        timeZones = WorldClockTimeZones.All,
        gpus=GpuAdapterCatalog.GetAdapters().Select(g=>new {id=g.Id,name=g.Name}),
        frameWindows=FrameRateBackend.Windows(),frameDisplays=FrameRateBackend.Displays()
    };
    internal void Tick(IEnumerable<IHardware> hardware, bool privileged)
    {
        try
        {
            var input = Volatile.Read(ref _input);
            GameDetector.Enabled=input?.Active==true;
            GameDetector.Paths = input?.GamePaths?.Take(4096).ToArray() ?? [];
            GameDetector.Include = input?.IncludeProcesses?.Take(128).ToArray() ?? [];
            GameDetector.Exclude = input?.ExcludeProcesses?.Take(128).ToArray() ?? [];
            var active=input?.Settings.Profiles.FirstOrDefault(p=>p.Id==input.Settings.ActiveProfileId);
            bool frameDemand=input?.Active==true&&input.FrameSampling&&active is not null&&HudProfileRenderer.GetRequiredVariables(active).Any(k=>k.StartsWith("frame.",StringComparison.Ordinal));
            if(!frameDemand&&_framesWanted)FrameRateBackend.Stop();_framesWanted=frameDemand;
            if (input?.Active==true) _send(new {type="hud",data=new {power=HudPlatform.Power()}});
            if (input is not { Active: true } current || !_pending.IsCompleted || Environment.TickCount64 < _nextRead) return;
            _nextRead = Environment.TickCount64 + Math.Clamp(current.SamplingMs, 500, 1000);
            // 共享已更新的传感器值；后台任务只读取快照，不并发访问 Computer。
            EndfieldChargePlus.Interop.HardwareSensorDriver.Privileged = privileged;
            AdvancedVariableProvider.PublishShared(hardware, privileged);
            // Catalog 内含设备枚举，同样留在唯一后台任务，不能卡住硬件主循环。
            _pending = Task.Run(()=>SampleAsync(current));
        }
        catch (Exception cause) when (cause is IOException or JsonException or FormatException)
        { _send(new { type = "hud", data = new { error = "HUD 配置读取失败：" + cause.GetType().Name } }); }
    }
    private async Task SampleAsync(Input input)
    {
        try
        {
            if (!_catalogSent || Environment.TickCount64>=_nextCatalog) { _send(new { type = "hud", data = new { catalog = Catalog() } }); _catalogSent = true; _nextCatalog=Environment.TickCount64+30000; }
            if(!input.Enabled)return;
            var profile = input.Settings.Profiles.FirstOrDefault(p => p.Id == input.Settings.ActiveProfileId);
            if (profile is null) return;
            var requested = HudProfileRenderer.GetRequiredVariables(profile).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach(var trigger in input.Settings.Triggers.Where(t=>t.Enabled))requested.Add(trigger.Variable);
            EndfieldChargePlus.LocalizationManager.Current = input.Locale switch {
                "zh-CN"=>EndfieldChargePlus.AppLanguage.SimplifiedChinese,"zh-TW"=>EndfieldChargePlus.AppLanguage.TraditionalChinese,
                "ja"=>EndfieldChargePlus.AppLanguage.Japanese,"de"=>EndfieldChargePlus.AppLanguage.German,"fr"=>EndfieldChargePlus.AppLanguage.French,
                _=>EndfieldChargePlus.AppLanguage.English};
            _hub.SamplingIntervalSeconds = Math.Clamp(input.SamplingMs / 1000d, 0.5, 60);
            var variables = await _hub.SnapshotAsync(input.Settings, requested, profile.GpuAdapterId,
                profile.PingTarget, profile.ProbeProtocol, profile.ProbePort, _stop.Token).ConfigureAwait(false);
            // 媒体与帧数据从 Rust 唯一服务传入，不另起 GSMTC/PresentMon。
            if (input.External is not null)
                foreach (var pair in input.External.Take(256))
                    variables[pair.Key] = pair.Value.ValueKind switch
                    {
                        JsonValueKind.Number when pair.Value.TryGetDouble(out var number) && double.IsFinite(number) => number,
                        JsonValueKind.String => pair.Value.GetString(),
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        _ => null
                    };
            if(input.FrameSampling)
                foreach(string kind in new[]{"display","window"})
                    if(requested.Any(k=>k.StartsWith($"frame.{kind}.",StringComparison.Ordinal)))
                        FrameRateMetrics.Add(variables,kind,FrameRateBackend.Read(kind,kind=="display"?profile.FrameDisplayId:profile.FrameWindowId),profile.FrameFullScaleFps);
            // 不让远程 JSON 的超长文本经 concat/格式化放大到无限内存。
            foreach(var key in variables.Keys.ToArray())
                if(variables[key] is string text&&text.Length>4096)variables[key]=text[..4096];
            var rendered = HudProfileRenderer.Render(profile, variables);
            var now=Environment.TickCount64;
            var fired=_triggers.Evaluate(input.Settings.Triggers,variables,now);
            if(fired.Count>0){
                _triggers.Presented(fired,now);
                _send(new{type="hud",data=new{triggeredAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}});
            }
            _send(new
            {
                type = "hud", data = new
                {
                    capturedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), profileId = profile.Id,
                    render = rendered, missing = HudProfileRenderer.GetUnavailableVariables(profile, variables),
                    variables = variables.Where(p => requested.Contains(p.Key)).Take(256)
                        .ToDictionary(p => p.Key, p => p.Value is double d && !double.IsFinite(d) ? null : p.Value)
                }
            });
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        catch (Exception cause) { _send(new { type = "hud", data = new { error = "HUD 数据采集失败：" + cause.GetType().Name } }); }
    }
    public void Dispose() { _stop.Cancel(); FrameRateBackend.Stop(); _hub.Dispose(); }
    internal static int ProtectInput()
    {
        string line = Console.ReadLine() ?? "";
        if (line.Length > 65536) return 2;
        var secrets = JsonSerializer.Deserialize<Dictionary<string, string>>(line, Json) ?? throw new FormatException("机密格式无效");
        if (secrets.Count > 64) return 2;
        Console.WriteLine(JsonSerializer.Serialize(secrets.ToDictionary(p => p.Key, p => SecretStore.Protect(p.Value)), Json));
        return 0;
    }
}
