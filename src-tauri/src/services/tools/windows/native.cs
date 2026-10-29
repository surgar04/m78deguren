// Windows 固定 ABI 适配层。只暴露领域方法，前端无法传入 DLL、函数指针或任意结构体。
// 每个句柄与原生缓冲都在 finally 中释放；旧系统缺少导出时仅该功能不可用。
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
[assembly:DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

namespace Zhenjing {
 public static class Native {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr module,string name);
  static T Function<T>(string name) where T:class {
   IntPtr address=GetProcAddress(GetModuleHandle("ntdll.dll"),name);
   if(address==IntPtr.Zero) throw new NotSupportedException("当前 Windows 未提供 "+name);
   return Marshal.GetDelegateForFunctionPointer(address,typeof(T)) as T;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Feature { public uint Id, Compact, Payload; }
  [StructLayout(LayoutKind.Sequential)] struct Update { public uint Id, Priority, State, Options, Variant, PayloadKind, Payload, Operation; }
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int QueryAll(uint store,out ulong stamp,IntPtr rows,ref ulong count);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int SetFeatures(ref ulong stamp,uint store,[In]Update[] rows,int count);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int BootStatus(int type,ref int value,int length,out int returned);
  public sealed class FeatureList { public string Stamp; public Feature[] Rows; }
  static void Check(int code,string action) { if(code<0) throw new InvalidOperationException(action+"失败，NTSTATUS 0x"+unchecked((uint)code).ToString("X8")); }
  public static FeatureList Features(uint store) {
   if(store>1) throw new ArgumentOutOfRangeException("store");
   QueryAll query=Function<QueryAll>("RtlQueryAllFeatureConfigurations");
   // 某些系统不接受空缓冲探测。首次即提供真实缓冲，并限制扩容，避免计数异常导致失控分配。
   ulong capacity=8192;
   for(int attempt=0;attempt<5;attempt++) {
    IntPtr buffer=Marshal.AllocHGlobal(checked((int)capacity*12));
    try {
     ulong count=capacity, stamp; int status=query(store,out stamp,buffer,ref count);
     if(unchecked((uint)status)==0x80000005 || unchecked((uint)status)==0xC0000023) {
      capacity=Math.Max(capacity*2,count); if(capacity>131072) throw new InvalidOperationException("功能数量超出安全上限"); continue;
     }
     Check(status,"读取功能配置"); if(count>capacity) throw new InvalidOperationException("功能数量无效");
     Feature[] rows=new Feature[(int)count]; for(int i=0;i<rows.Length;i++) rows[i]=(Feature)Marshal.PtrToStructure(IntPtr.Add(buffer,i*12),typeof(Feature));
     return new FeatureList {Stamp=stamp.ToString(),Rows=rows};
    } finally {Marshal.FreeHGlobal(buffer);}
   }
   throw new InvalidOperationException("功能列表持续变化，请稍后重试");
  }
  public static void SetFeature(uint store,uint id,uint priority,uint state,uint variant,uint payloadKind,uint payload,bool reset,string expectedStamp) {
   if(store>1 || id==0 || priority>15 || priority==0 || priority==1 || priority==3 || priority==9 || priority==15 || state>2 || variant>63 || payloadKind>3) throw new ArgumentException("功能参数超出允许范围");
   ulong stamp; if(!UInt64.TryParse(expectedStamp,out stamp)) throw new ArgumentException("变更标记无效");
   Update update=new Update{Id=id,Priority=priority,State=state,Variant=variant,PayloadKind=payloadKind,Payload=payload,Operation=reset?4u:3u};
   Check(Function<SetFeatures>("RtlSetFeatureConfigurations")(ref stamp,store,new Update[]{update},1),"写入功能配置");
  }
  public static void MarkBootPending() {int value=1, returned; Check(Function<BootStatus>("RtlSetSystemBootStatus")(17,ref value,4,out returned),"标记下次启动应用配置");}
  public static uint Obfuscate(uint id) {
   uint value=id^0x74161A4E; value=(value>>24)|((value>>8)&0x0000FF00)|((value<<8)&0x00FF0000)|(value<<24);value^=0x8FB23D4F;return ((value<<1)|(value>>31))^0x833EA8FF;
  }
  public static uint Deobfuscate(uint id){uint value=id^0x833EA8FF;value=(value>>1)|(value<<31);value^=0x8FB23D4F;value=(value>>24)|((value>>8)&0x0000FF00)|((value<<8)&0x00FF0000)|(value<<24);return value^0x74161A4E;}

  // DEVMODEW 的显示设备分支；Unicode 字符数组长度与 Win32 结构保持一致。
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Mode {
   [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string DeviceName;
   public ushort SpecVersion,DriverVersion,Size,DriverExtra; public uint Fields;
   public int PositionX,PositionY; public uint Orientation,FixedOutput;
   public short Color,Duplex,YResolution,TTOption,Collate;
   [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string FormName;
   public ushort LogPixels; public uint BitsPerPixel,Width,Height,DisplayFlags,Frequency,ICMMethod,ICMIntent,MediaType,DitherType,Reserved1,Reserved2,PanningWidth,PanningHeight;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Display {
   public uint Size;
   [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string Name;
   [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string Description;
   public uint Flags;
   [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string DeviceId;
   [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string DeviceKey;
  }
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string device,uint index,ref Display display,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool EnumDisplaySettingsEx(string device,int index,ref Mode mode,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string device,ref Mode mode,IntPtr window,uint flags,IntPtr parameter);
  [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateDC(string driver,string device,string output,IntPtr init);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool GetDeviceGammaRamp(IntPtr dc,[Out]ushort[] ramp);
  [DllImport("gdi32.dll")] static extern bool SetDeviceGammaRamp(IntPtr dc,[In]ushort[] ramp);
  public sealed class Monitor {public string Name,Description,Identity;public bool Primary;public Mode Current;public Mode[] Modes;}
  public static string Identity(string device){Display monitor=new Display{Size=(uint)Marshal.SizeOf(typeof(Display))};if(!EnumDisplayDevices(device,0,ref monitor,1))throw new InvalidOperationException("显示器已断开或没有稳定标识");return monitor.DeviceId;}
  public static string ForegroundProcess(){uint pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);try{using(var process=System.Diagnostics.Process.GetProcessById((int)pid))return process.ProcessName+".exe";}catch{return "";}}
  [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  public static Monitor[] Monitors() {
   List<Monitor> result=new List<Monitor>();
   for(uint i=0;i<64;i++) {
    Display display=new Display{Size=(uint)Marshal.SizeOf(typeof(Display))}; if(!EnumDisplayDevices(null,i,ref display,0)) break;
    if((display.Flags&1)==0 || (display.Flags&8)!=0) continue;
    Mode current=ReadMode(display.Name,-1); List<Mode> modes=new List<Mode>(); HashSet<string> seen=new HashSet<string>();
    for(int n=0;n<4096;n++){Mode mode=new Mode{Size=(ushort)Marshal.SizeOf(typeof(Mode))};if(!EnumDisplaySettingsEx(display.Name,n,ref mode,0))break;string id=mode.Width+"x"+mode.Height+"@"+mode.Frequency+"/"+mode.BitsPerPixel;if(seen.Add(id))modes.Add(mode);}
    result.Add(new Monitor{Name=display.Name,Identity=Identity(display.Name),Description=display.Description,Primary=(display.Flags&4)!=0,Current=current,Modes=modes.ToArray()});
   }
   return result.ToArray();
  }
  public static Mode ReadMode(string device,int index) {Mode mode=new Mode{Size=(ushort)Marshal.SizeOf(typeof(Mode))};if(!EnumDisplaySettingsEx(device,index,ref mode,0))throw new Win32Exception("无法读取显示模式");return mode;}
  public static void SetMode(string device,uint width,uint height,uint frequency,bool persist) {
   bool exists=false;foreach(Monitor monitor in Monitors())if(monitor.Name==device)exists=true;
   if(!exists || width<320 || width>16384 || height<200 || height>16384 || frequency<20 || frequency>1000)throw new ArgumentException("显示器或显示模式无效");
   Mode mode=ReadMode(device,-1);mode.Width=width;mode.Height=height;mode.Frequency=frequency;mode.Fields=0x00080000|0x00100000|0x00400000;
   int test=ChangeDisplaySettingsEx(device,ref mode,IntPtr.Zero,2,IntPtr.Zero);if(test!=0)throw new InvalidOperationException("驱动拒绝此显示模式，代码 "+test);
   int result=ChangeDisplaySettingsEx(device,ref mode,IntPtr.Zero,persist?1u:0u,IntPtr.Zero);if(result!=0)throw new InvalidOperationException("切换显示模式失败，代码 "+result);
  }
  public static ushort[] Gamma(string device) {IntPtr dc=CreateDC("DISPLAY",device,null,IntPtr.Zero);if(dc==IntPtr.Zero)throw new Win32Exception("无法访问显示器");try{ushort[] ramp=new ushort[768];if(!GetDeviceGammaRamp(dc,ramp))throw new InvalidOperationException("驱动不支持读取 Gamma，HDR 下可能不可用");return ramp;}finally{DeleteDC(dc);}}
  public static void SetGamma(string device,ushort[] ramp) {if(ramp==null||ramp.Length!=768)throw new ArgumentException("Gamma 曲线无效");IntPtr dc=CreateDC("DISPLAY",device,null,IntPtr.Zero);if(dc==IntPtr.Zero)throw new Win32Exception("无法访问显示器");try{if(!SetDeviceGammaRamp(dc,ramp))throw new InvalidOperationException("驱动拒绝 Gamma 曲线，HDR 或颜色管理可能覆盖此设置");}finally{DeleteDC(dc);}}
 }
}
