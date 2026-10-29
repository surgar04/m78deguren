using System.Globalization;
using System.Management;
using System.Runtime.InteropServices;
using LibreHardwareMonitor.Hardware;

namespace ZhenjingMonitor;

/// <summary>DXGI 提供 64 位专用显存；Windows GPU 计数器补足无需底层驱动的核显监测。</summary>
internal static class WindowsGpu
{
    internal sealed record Adapter(string Id, string Name, uint Vendor, ulong Dedicated, ulong Shared);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Description
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Name;
        public uint Vendor, Device, Subsystem, Revision;
        public nuint DedicatedVideo, DedicatedSystem, Shared;
        public uint LuidLow; public int LuidHigh; public uint Flags;
    }
    // 完整声明前置 COM 槽位以保持 ABI；本模块只调用 EnumAdapters1 / GetDesc1。
    [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface Factory
    {
        [PreserveSig] int SetPrivateData(nint a, uint b, nint c); [PreserveSig] int SetPrivateInterface(nint a, nint b);
        [PreserveSig] int GetPrivateData(nint a, nint b, nint c); [PreserveSig] int GetParent(nint a, nint b);
        [PreserveSig] int EnumAdapters(uint index, nint adapter); [PreserveSig] int MakeWindowAssociation(nint window, uint flags);
        [PreserveSig] int GetWindowAssociation(nint window); [PreserveSig] int CreateSwapChain(nint device, nint description, nint swapchain);
        [PreserveSig] int CreateSoftwareAdapter(nint module, nint adapter);
        [PreserveSig] int EnumAdapters1(uint index, out AdapterInterface adapter); [PreserveSig] bool IsCurrent();
    }
    [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface AdapterInterface
    {
        [PreserveSig] int SetPrivateData(nint a, uint b, nint c); [PreserveSig] int SetPrivateInterface(nint a, nint b);
        [PreserveSig] int GetPrivateData(nint a, nint b, nint c); [PreserveSig] int GetParent(nint a, nint b);
        [PreserveSig] int EnumOutputs(uint index, nint output); [PreserveSig] int GetDesc(nint description);
        [PreserveSig] int CheckInterfaceSupport(nint guid, nint version); [PreserveSig] int GetDesc1(out Description description);
    }
    [DllImport("dxgi.dll")] private static extern int CreateDXGIFactory1(ref Guid iid, out Factory factory);
    internal static List<Adapter> Enumerate(List<Device> devices)
    {
        var result = new List<Adapter>();
        var iid = typeof(Factory).GUID;
        if (CreateDXGIFactory1(ref iid, out var factory) < 0)
            return result;
        try
        {
            for (uint index = 0; index < 32; index++)
            {
                if (factory.EnumAdapters1(index, out var adapter) < 0)
                    break;
                try
                {
                    if (adapter.GetDesc1(out var description) < 0 || (description.Flags & 2) != 0)
                        continue;
                    // DXGI 固定宽度描述可能带尾空格，必须在与 WMI / LHM 对应前规范化。
                    description.Name = description.Name.Trim();
                    var id = $"luid_0x{unchecked((uint)description.LuidHigh):x8}_0x{description.LuidLow:x8}";
                    result.Add(new Adapter(id, description.Name, description.Vendor, description.DedicatedVideo, description.Shared));
                    var fields = new List<Field> { new("DXGI LUID", id), new("专用显存 (bytes)", description.DedicatedVideo.ToString(CultureInfo.InvariantCulture)), new("共享内存上限 (bytes)", description.Shared.ToString(CultureInfo.InvariantCulture)), new("PCI 厂商 ID", description.Vendor.ToString("X4", CultureInfo.InvariantCulture)), new("PCI 设备 ID", description.Device.ToString("X4", CultureInfo.InvariantCulture)) };
                    var matching = devices.Where(device => device.Kind == "gpu" && device.Name.Trim().Equals(description.Name, StringComparison.OrdinalIgnoreCase)).ToArray();
                    var existing = matching.Length == 1 ? devices.IndexOf(matching[0]) : -1;
                    if (existing >= 0)
                        devices[existing].Fields.AddRange(fields);
                    else if (matching.Length == 0)
                        devices.Add(new Device("dxgi:" + id, "gpu", description.Name, fields));
                }
                finally { Marshal.ReleaseComObject(adapter); }
            }
        }
        finally { Marshal.ReleaseComObject(factory); }
        return result;
    }
    private static Sensor[] _latest = [];
    private static long _updated;
    private static Task? _reader;
    internal static void Collect(List<Sensor> sensors, IReadOnlyList<Adapter> adapters)
    {
        // GPU 性能计数器可能在 WMI provider 内阻塞。单独线程串行查询，绝不拖住主采样循环。
        _reader ??= Task.Run(async () =>
        {
            while (true)
            {
                try
                {
                    var latest = new List<Sensor>();
                    ReadCounters(latest, adapters);
                    Volatile.Write(ref _latest, latest.ToArray());
                    Interlocked.Exchange(ref _updated, Environment.TickCount64);
                }
                catch (Exception cause) { Console.Error.WriteLine("Windows GPU 计数器：" + cause.Message); }
                await Task.Delay(1000);
            }
        });
        var fresh = Environment.TickCount64 - Interlocked.Read(ref _updated) < 5000;
        var values = fresh ? Volatile.Read(ref _latest) : [];
        foreach (var adapter in adapters)
        {
            var matching = sensors.Where(sensor => sensor.HardwareType.StartsWith("Gpu", StringComparison.Ordinal) && sensor.Hardware.Trim().Equals(adapter.Name, StringComparison.OrdinalIgnoreCase)).GroupBy(sensor => sensor.HardwareId).ToArray();
            // 同型号多卡不能仅凭名称套用另一块卡的 OS 读数；保留 LHM 自己的独立标识与原始数据。
            if (matching.Length > 1 || adapters.Count(item => item.Name.Equals(adapter.Name, StringComparison.OrdinalIgnoreCase)) > 1)
                continue;
            var known = matching.FirstOrDefault()?.FirstOrDefault();
            var id = known?.HardwareId ?? "/windowsgpu/" + adapter.Id;
            var kind = known?.HardwareType ?? (adapter.Vendor == 0x10de ? "GpuNvidia" : adapter.Vendor == 0x1002 ? "GpuAmd" : adapter.Vendor == 0x8086 ? "GpuIntel" : "GpuUnknown");
            foreach (var sensor in values.Where(sensor => sensor.HardwareId == "/windowsgpu/" + adapter.Id && sensor.SensorType != "Data" || sensor.HardwareId == "/windowsgpu/" + adapter.Id && sensor.Name == "GPU Dedicated Memory Used (Windows)"))
                sensors.Add(sensor with
                {
                    HardwareId = id,
                    HardwareType = kind
                });
            sensors.Add(new Sensor("/windowsgpu/" + adapter.Id + "/total", id, adapter.Name, kind, "GPU Memory Total (DXGI)", "Data", "GB", adapter.Dedicated / 1073741824d));
        }
    }
    private static void ReadCounters(List<Sensor> sensors, IReadOnlyList<Adapter> adapters)
    {
        // 同一物理引擎的各进程负载相加，再取最忙引擎。不能把多个独立引擎的百分比直接相加。
        var engines = new Dictionary<string, Dictionary<string, double>>();
        var memory = new Dictionary<string, double>();
        try
        {
            using var search = new ManagementObjectSearcher(new ManagementScope(@"root\cimv2"), new ObjectQuery("SELECT Name,UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine"), new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(3), ReturnImmediately = false });
            using var rows = search.Get();
            foreach (ManagementObject row in rows)
                using (row)
                {
                    var name = Convert.ToString(row["Name"], CultureInfo.InvariantCulture) ?? "";
                    foreach (var adapter in adapters)
                    {
                        if (!name.Contains(adapter.Id, StringComparison.OrdinalIgnoreCase))
                            continue;
                        var offset = name.IndexOf("_eng_", StringComparison.Ordinal);
                        if (offset < 0)
                            continue;
                        var key = name[offset..];
                        var load = Convert.ToDouble(row["UtilizationPercentage"], CultureInfo.InvariantCulture);
                        if (!double.IsFinite(load))
                            continue;
                        if (!engines.TryGetValue(adapter.Id, out var group))
                        {
                            group = [];
                            engines[adapter.Id] = group;
                        }
                        group[key] = group.GetValueOrDefault(key) + Math.Max(0, load);
                    }
                }
            using var memorySearch = new ManagementObjectSearcher(new ManagementScope(@"root\cimv2"), new ObjectQuery("SELECT Name,DedicatedUsage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory"), new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(3), ReturnImmediately = false });
            using var memoryRows = memorySearch.Get();
            foreach (ManagementObject row in memoryRows)
                using (row)
                {
                    var name = Convert.ToString(row["Name"], CultureInfo.InvariantCulture) ?? "";
                    foreach (var adapter in adapters)
                        if (name.Contains(adapter.Id, StringComparison.OrdinalIgnoreCase))
                            memory[adapter.Id] = memory.GetValueOrDefault(adapter.Id) + Convert.ToDouble(row["DedicatedUsage"], CultureInfo.InvariantCulture) / 1073741824d;
                }
        }
        catch (Exception cause) when (cause is ManagementException or COMException or UnauthorizedAccessException) { /* 计数器禁用时只缺失该来源，不影响 LHM 读数。 */ }
        foreach (var adapter in adapters)
        {
            var known = sensors.FirstOrDefault(sensor => sensor.HardwareType.StartsWith("Gpu", StringComparison.Ordinal) && sensor.Hardware.Equals(adapter.Name, StringComparison.OrdinalIgnoreCase));
            var hardwareId = known?.HardwareId ?? "/windowsgpu/" + adapter.Id;
            var kind = known?.HardwareType ?? (adapter.Vendor == 0x10de ? "GpuNvidia" : adapter.Vendor == 0x1002 ? "GpuAmd" : adapter.Vendor == 0x8086 ? "GpuIntel" : "GpuUnknown");
            void Add(string suffix, string name, string type, string unit, double? value) => sensors.Add(new Sensor("/windowsgpu/" + adapter.Id + "/" + suffix, hardwareId, adapter.Name, kind, name, type, unit, value));
            if (engines.TryGetValue(adapter.Id, out var group) && group.Count > 0)
                Add("load", "GPU Engine (Windows)", "Load", "%", Math.Clamp(group.Values.Max(), 0, 100));
            Add("total", "GPU Memory Total (DXGI)", "Data", "GB", adapter.Dedicated / 1073741824d);
            if (memory.TryGetValue(adapter.Id, out var used) && double.IsFinite(used))
                Add("used", "GPU Dedicated Memory Used (Windows)", "Data", "GB", used);
        }
    }
}
