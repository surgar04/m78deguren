using System.Diagnostics;
using System.Globalization;
using System.Management;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;
using Microsoft.Win32;

namespace ZhenjingMonitor;

internal sealed record Field(string Label, string Value);
internal sealed record Device(string Id, string Kind, string Name, List<Field> Fields);
internal sealed record Sensor(string Id, string HardwareId, string Hardware, string HardwareType,
    string Name, string SensorType, string Unit, double? Value);

/// <summary>只读硬件桥接。Rust 负责超时、重启、记录和窗口权限；本进程不接受命令或文件路径。</summary>
internal static class Program
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly List<string> Warnings = [];
    private static readonly Dictionary<string, (long Received, long Sent)> Network = [];
    private static ulong _idle, _kernel, _user;
    private static long _networkTime = Stopwatch.GetTimestamp();
    [DllImport("kernel32.dll")] private static extern bool GetSystemTimes(out ulong idle, out ulong kernel, out ulong user);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out uint process);
    [StructLayout(LayoutKind.Sequential)]
    private struct Memory
    {
        public uint Length, Load;
        public ulong Physical, Available, Page, PageAvailable, Virtual, VirtualAvailable, Extended;
    }
    [DllImport("kernel32.dll")] private static extern bool GlobalMemoryStatusEx(ref Memory memory);

    private static void Send(object value)
    {
        Console.WriteLine(JsonSerializer.Serialize(value, Json));
        Console.Out.Flush();
    }
    private static string Text(object? value)
    {
        if (value is ushort[] characters)
            return new string(characters.Where(character => character != 0 && !char.IsControl((char)character)).Select(character => (char)character).ToArray()).Trim();
        var text = value is Array array ? string.Join(", ", array.Cast<object>()) : Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
        return new string(text.Where(character => !char.IsControl(character)).Take(1024).ToArray()).Trim();
    }
    private static string Read(ManagementBaseObject row, string name)
    {
        try
        {
            return Text(row[name]);
        }
        catch (Exception cause) when (cause is ManagementException or COMException) { return ""; }
    }
    private static void Query(List<Device> devices, string kind, string className, string nameField,
        (string Property, string Label)[] properties, string scope = @"root\cimv2", string where = "")
    {
        try
        {
            var options = new System.Management.EnumerationOptions { ReturnImmediately = false, Timeout = TimeSpan.FromSeconds(8) };
            using var search = new ManagementObjectSearcher(new ManagementScope(scope), new ObjectQuery("SELECT * FROM " + className + where), options);
            using var rows = search.Get();
            foreach (ManagementObject row in rows)
            {
                using (row)
                {
                    if (devices.Count >= 256)
                        break;
                    var fields = properties.Select(property => new Field(property.Label, Read(row, property.Property)))
                        .Where(field => field.Value.Length > 0).ToList();
                    string? decoded = className switch
                    {
                        "Win32_Processor" => Read(row, "Architecture") switch { "0" => "x86", "5" => "ARM", "6" => "IA64", "9" => "x64", "12" => "ARM64", _ => null },
                        "Win32_PhysicalMemory" => Read(row, "SMBIOSMemoryType") switch { "20" => "DDR", "21" => "DDR2", "24" => "DDR3", "26" => "DDR4", "30" => "LPDDR4", "34" => "DDR5", "35" => "LPDDR5", _ => null },
                        "MSFT_PhysicalDisk" => Read(row, "BusType") switch { "1" => "SCSI", "7" => "USB", "8" => "RAID", "11" => "SATA", "17" => "NVMe", _ => null },
                        _ => null
                    };
                    if (decoded is not null)
                        fields.Add(new Field(className == "Win32_PhysicalMemory" ? "内存类型" : className == "Win32_Processor" ? "架构" : "接口类型", decoded));
                    if (className == "Win32_PhysicalMemory")
                    {
                        var form = Read(row, "FormFactor") switch
                        {
                            "8" => "DIMM",
                            "12" => "SO-DIMM",
                            _ => null
                        };
                        if (form is not null)
                            fields.Add(new Field("内存规格", form));
                    }
                    devices.Add(new Device(kind + ":" + devices.Count, kind, Read(row, nameField), fields));
                }
            }
        }
        catch (Exception cause) when (cause is ManagementException or UnauthorizedAccessException or COMException)
        {
            Warnings.Add(className + "：" + Text(cause.Message)[..Math.Min(160, Text(cause.Message).Length)]);
        }
    }
    private static List<Device> Inventory()
    {
        var devices = new List<Device>();
        Query(devices, "cpu", "Win32_Processor", "Name", [
            ("Manufacturer","制造商"),("NumberOfCores","核心数"),("NumberOfLogicalProcessors","线程数"),
            ("NumberOfEnabledCore","已启用核心"),("MaxClockSpeed","最大频率 (MHz)"),("CurrentClockSpeed","当前频率 (MHz)"),
            ("ExtClock","外频 (MHz)"),("L2CacheSize","L2 缓存 (KiB)"),("L3CacheSize","L3 缓存 (KiB)"),
            ("Architecture","架构代码"),("AddressWidth","地址宽度 (bit)"),("SocketDesignation","插槽"),
            ("ProcessorId","处理器标识"),("Family","家族"),("Stepping","步进"),("Revision","修订")]);
        Query(devices, "gpu", "Win32_VideoController", "Name", [
            ("AdapterCompatibility","制造商"),("VideoProcessor","芯片"),("PNPDeviceID","PnP 设备标识"),
            ("DeviceID","设备标识"),("DriverVersion","驱动版本"),("DriverDate","驱动日期"),
            ("InfFilename","INF 文件"),("InstalledDisplayDrivers","驱动组件"),("VideoArchitecture","视频架构代码"),("VideoMemoryType","显存类型代码"),("VideoModeDescription","显示模式"),("CurrentHorizontalResolution","当前宽度"),
            ("CurrentVerticalResolution","当前高度"),("CurrentRefreshRate","刷新率 (Hz)"),("Status","设备状态")]);
        // Win32_VideoController.AdapterRAM 是 32 位字段；不把大显存截断值作为真实总显存展示。
        Query(devices, "memory", "Win32_PhysicalMemory", "PartNumber", [
            ("Manufacturer","制造商"),("PartNumber","型号"),("Capacity","容量 (bytes)"),
            ("Speed","标称速率 (MT/s)"),("ConfiguredClockSpeed","当前速率 (MT/s)"),("SMBIOSMemoryType","内存类型代码"),
            ("FormFactor","规格代码"),("DeviceLocator","插槽"),("BankLabel","通道"),("DataWidth","数据宽度 (bit)"),
            ("TotalWidth","总宽度 (bit)"),("ConfiguredVoltage","当前电压 (mV)"),("SerialNumber","序列号")]);
        Query(devices, "motherboard", "Win32_BaseBoard", "Product", [
            ("Manufacturer","制造商"),("Product","型号"),("Version","版本"),("SerialNumber","序列号")]);
        Query(devices, "bios", "Win32_BIOS", "Name", [
            ("Manufacturer","制造商"),("SMBIOSBIOSVersion","固件版本"),("ReleaseDate","发布日期"),
            ("SMBIOSMajorVersion","SMBIOS 主版本"),("SMBIOSMinorVersion","SMBIOS 次版本"),("SerialNumber","序列号")]);
        Query(devices, "disk", "Win32_DiskDrive", "Model", [
            ("Model","型号"),("Size","容量 (bytes)"),("InterfaceType","接口"),("MediaType","介质"),
            ("FirmwareRevision","固件"),("SerialNumber","序列号"),("PNPDeviceID","PnP 设备标识"),("Status","状态")]);
        Query(devices, "disk", "MSFT_PhysicalDisk", "FriendlyName", [
            ("BusType","总线类型代码"),("MediaType","介质代码"),("Size","容量 (bytes)"),
            ("HealthStatus","健康状态代码"),("OperationalStatus","运行状态"),("SerialNumber","序列号")], @"root\Microsoft\Windows\Storage");
        foreach (var drive in DriveInfo.GetDrives().Where(drive => drive.IsReady && drive.DriveType == DriveType.Fixed))
            devices.Add(new Device("volume:" + drive.Name, "volume", drive.Name + " " + drive.VolumeLabel, [
                new("文件系统", drive.DriveFormat), new("总容量 (bytes)", drive.TotalSize.ToString(CultureInfo.InvariantCulture)),
                new("可用容量 (bytes)", drive.AvailableFreeSpace.ToString(CultureInfo.InvariantCulture))]));
        Query(devices, "audio", "Win32_SoundDevice", "Name", [
            ("Manufacturer","制造商"),("ProductName","产品名称"),("PNPDeviceID","PnP 设备标识"),("Status","状态")]);
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces().Take(64))
        {
            if (adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                continue;
            devices.Add(new Device("network:" + adapter.Id, "network", adapter.Description, [
                new("连接名称", adapter.Name), new("类型", adapter.NetworkInterfaceType.ToString()),
                new("链路速率 (Mbps)", (adapter.Speed / 1_000_000d).ToString("0.##", CultureInfo.InvariantCulture)),
                new("连接状态", adapter.OperationalStatus.ToString()), new("MAC", adapter.GetPhysicalAddress().ToString()),
                new("IP 地址", string.Join(", ", adapter.GetIPProperties().UnicastAddresses.Select(address => address.Address.ToString())))]));
        }
        Query(devices, "monitor", "WmiMonitorID", "InstanceName", [
            ("ManufacturerName","厂商 EDID"),("UserFriendlyName","型号 EDID"),("SerialNumberID","序列号 EDID"),
            ("WeekOfManufacture","生产周"),("YearOfManufacture","生产年"),("Active","活动状态")], @"root\wmi");
        Query(devices, "monitor", "Win32_DesktopMonitor", "Name", [
            ("MonitorManufacturer","厂商"),("MonitorType","类型"),("ScreenWidth","宽度"),("ScreenHeight","高度"),("PNPDeviceID","PnP 设备标识")]);
        AddDisplays(devices);
        Query(devices, "os", "Win32_OperatingSystem", "Caption", [
            ("Version","版本"),("BuildNumber","构建"),("OSArchitecture","架构"),("LastBootUpTime","最近启动时间")]);
        return devices;
    }

    // EnumDisplaySettings 按显示设备逐一读取当前模式，避免多显示器都显示主屏参数。
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        public int Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public int Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Key;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayMode
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        public ushort SpecVersion, DriverVersion, Size, DriverExtra;
        public uint Fields;
        public int X, Y;
        public uint Orientation, FixedOutput;
        public short Color, Duplex, YResolution, TTOption, Collate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Form;
        public ushort LogPixels;
        public uint Bits, Width, Height, DisplayFlags, Frequency, IcmMethod, IcmIntent, MediaType, DitherType, Reserved1, Reserved2, PanningWidth, PanningHeight;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplayDevices(string? device, uint index, ref DisplayDevice value, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplaySettings(string device, int index, ref DisplayMode mode);
    private static void AddDisplays(List<Device> devices)
    {
        for (uint index = 0; index < 32; index++)
        {
            var display = new DisplayDevice { Size = Marshal.SizeOf<DisplayDevice>() };
            if (!EnumDisplayDevices(null, index, ref display, 0))
                break;
            if ((display.Flags & 1) == 0)
                continue;
            var mode = new DisplayMode { Size = (ushort)Marshal.SizeOf<DisplayMode>() };
            if (EnumDisplaySettings(display.Name, -1, ref mode))
                devices.Add(new Device("display:" + display.Name, "monitor", display.Description + " " + display.Name,
                    [new("分辨率", mode.Width + " × " + mode.Height), new("刷新率 (Hz)", mode.Frequency.ToString(CultureInfo.InvariantCulture)),
                     new("色深 (bit)", mode.Bits.ToString(CultureInfo.InvariantCulture)), new("桌面位置", mode.X + ", " + mode.Y)]));
        }
    }
    private static string Unit(SensorType type) => type switch
    {
        SensorType.Temperature => "°C",
        SensorType.Load or SensorType.Control or SensorType.Level => "%",
        SensorType.Clock => "MHz",
        SensorType.Fan => "RPM",
        SensorType.Voltage => "V",
        SensorType.Power => "W",
        SensorType.Data => "GB",
        SensorType.SmallData => "MB",
        SensorType.Throughput => "B/s",
        SensorType.Frequency => "Hz",
        SensorType.Current => "A",
        SensorType.Flow => "L/h",
        SensorType.Factor => "×",
        SensorType.TimeSpan => "s",
        SensorType.Energy => "mWh",
        SensorType.Noise => "dBA",
        SensorType.Conductivity => "µS/cm",
        SensorType.Humidity => "%",
        _ => ""
    };
    private static void Collect(IHardware hardware, List<Sensor> sensors)
    {
        try
        {
            hardware.Update();
            foreach (var sensor in hardware.Sensors.Take(1024))
            {
                double? value = sensor.Value is float number && float.IsFinite(number) ? number : null;
                sensors.Add(new Sensor(sensor.Identifier.ToString(), hardware.Identifier.ToString(), Text(hardware.Name),
                    hardware.HardwareType.ToString(), Text(sensor.Name), sensor.SensorType.ToString(), Unit(sensor.SensorType), value));
            }
            foreach (var child in hardware.SubHardware)
                Collect(child, sensors);
        }
        catch (Exception cause) { Console.Error.WriteLine("传感器读取失败：" + cause.Message); }
    }
    private static Dictionary<string, object?> Metrics()
    {
        var metrics = new Dictionary<string, object?>();
        if (GetSystemTimes(out var idle, out var kernel, out var user))
        {
            var total = (kernel - _kernel) + (user - _user);
            metrics["cpu"] = _kernel == 0 || total == 0 ? null : Math.Clamp(100d * (total - (idle - _idle)) / total, 0, 100);
            (_idle, _kernel, _user) = (idle, kernel, user);
        }
        var memory = new Memory { Length = (uint)Marshal.SizeOf<Memory>() };
        if (GlobalMemoryStatusEx(ref memory))
        {
            metrics["memoryTotal"] = memory.Physical / 1073741824d;
            metrics["memoryUsed"] = (memory.Physical - memory.Available) / 1073741824d;
            metrics["memory"] = 100d * (memory.Physical - memory.Available) / memory.Physical;
        }
        long now = Stopwatch.GetTimestamp(), received = 0, sent = 0;
        var seconds = (now - _networkTime) / (double)Stopwatch.Frequency;
        bool comparable = false;
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (adapter.OperationalStatus != OperationalStatus.Up || adapter.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
                continue;
            try
            {
                var counters = adapter.GetIPStatistics();
                if (Network.TryGetValue(adapter.Id, out var previous))
                {
                    received += Math.Max(0, counters.BytesReceived - previous.Received);
                    sent += Math.Max(0, counters.BytesSent - previous.Sent);
                    comparable = true;
                }
                Network[adapter.Id] = (counters.BytesReceived, counters.BytesSent);
            }
            catch (NetworkInformationException) { /* 热拔插期间跳过该网卡，不伪造零速率。 */ }
        }
        _networkTime = now;
        metrics["download"] = comparable && seconds > 0 ? received / seconds / 1048576d : null;
        metrics["upload"] = comparable && seconds > 0 ? sent / seconds / 1048576d : null;
        GetWindowThreadProcessId(GetForegroundWindow(), out var pid);
        metrics["processId"] = pid;
        try
        {
            using var process = Process.GetProcessById((int)pid);
            metrics["processName"] = process.ProcessName;
        }
        catch (ArgumentException) { metrics["processName"] = null; }
        var game = Hud.GameDetector.Read();
        metrics["gameProcessId"] = game?.ProcessId ?? 0;
        metrics["gameName"] = game?.Name;
        metrics["gameReason"] = game?.Reason;
        return metrics;
    }
    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.Length == 1 && args[0] == "--hud-catalog")
            { Send(Hud.HudEngine.Catalog()); return 0; }
            if (args.Length == 1 && args[0] == "--hud-protect")
                return Hud.HudEngine.ProtectInput();
            if (args.Length != 2 || !int.TryParse(args[0], out var parentId))
                return 2;
            using var parent = Process.GetProcessById(parentId);
            var inventory = Inventory();
            var adapters = WindowsGpu.Enumerate(inventory);
            Send(new
            {
                type = "inventory",
                devices = inventory,
                warnings = Warnings.ToArray()
            });
            if (args[1] == "inventory-only")
                return 0;
            using var identity = WindowsIdentity.GetCurrent();
            bool administrator = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            using var pawn = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO");
            bool privileged = args[1] == "sensors" && administrator && pawn is not null;
            using var hud = Environment.GetEnvironmentVariable("ZHENJING_HUD_DIR") is null ? null : new Hud.HudEngine(Send);
            if (!privileged)
                Warnings.Add("CPU 温度/主板底层传感器未开启：需已安装 PawnIO、管理员权限及界面单项确认；不会自动安装驱动。");
            var computer = new Computer
            {
                IsCpuEnabled = privileged,
                IsMotherboardEnabled = privileged,
                IsGpuEnabled = true,
                IsMemoryEnabled = true,
                IsStorageEnabled = true,
                IsNetworkEnabled = true
            };
            // 初始化可能卡在第三方驱动，Rust 的看门狗会终止整个子进程，不并发访问半初始化的 Computer。
            try
            {
                computer.Open();
                Send(new
                {
                    type = "capabilities",
                    privileged
                });
                while (!parent.HasExited)
                {
                    var sensors = new List<Sensor>();
                    foreach (var hardware in computer.Hardware)
                        Collect(hardware, sensors);
                    WindowsGpu.Collect(sensors, adapters);
                    hud?.Tick(computer.Hardware, privileged);
                    Send(new
                    {
                        type = "sample",
                        capturedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        sensors = sensors.Take(8192).ToArray(),
                        metrics = Metrics(),
                        warnings = Warnings.ToArray()
                    });
                    await Task.Delay(1000);
                }
            }
            finally { computer.Close(); }
            return 0;
        }
        catch (Exception cause)
        {
            Send(new
            {
                type = "error",
                message = cause.GetType().Name + ": " + cause.Message
            });
            return 1;
        }
    }
}
