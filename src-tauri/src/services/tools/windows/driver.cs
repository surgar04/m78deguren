// 使用 Windows SetupAPI 创建设备，不执行上游未签名的 fxdevcon 辅助程序。
namespace Zhenjing {
 public static class AudioDriver {
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct DeviceInfo {public uint Size;public System.Guid ClassGuid;public uint Instance;public System.IntPtr Reserved;}
  [System.Runtime.InteropServices.DllImport("setupapi.dll",SetLastError=true)]static extern System.IntPtr SetupDiCreateDeviceInfoList(ref System.Guid guid,System.IntPtr window);
  [System.Runtime.InteropServices.DllImport("setupapi.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]static extern bool SetupDiCreateDeviceInfo(System.IntPtr set,string name,ref System.Guid guid,string description,System.IntPtr window,uint flags,ref DeviceInfo info);
  [System.Runtime.InteropServices.DllImport("setupapi.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]static extern bool SetupDiSetDeviceRegistryProperty(System.IntPtr set,ref DeviceInfo info,uint property,byte[] data,uint length);
  [System.Runtime.InteropServices.DllImport("setupapi.dll",SetLastError=true)]static extern bool SetupDiCallClassInstaller(uint action,System.IntPtr set,ref DeviceInfo info);
  [System.Runtime.InteropServices.DllImport("setupapi.dll",SetLastError=true)]static extern bool SetupDiDestroyDeviceInfoList(System.IntPtr set);
  [System.Runtime.InteropServices.DllImport("newdev.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]static extern bool UpdateDriverForPlugAndPlayDevices(System.IntPtr window,string hardware,string inf,uint flags,out bool reboot);
  static void Check(bool success,string action){if(!success)throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error(),action);}
  public static bool Install(string inf){
   if(!System.IO.Path.IsPathRooted(inf)||inf.Length<4||inf[1]!=':'||inf[2]!='\\'||System.IO.Path.GetFileName(inf)!="fxvad.inf")throw new System.ArgumentException("驱动来源无效");
   if(System.Environment.GetEnvironmentVariable("ZHENJING_RESTRICT_WRITES_TO_D")=="1"&&!inf.StartsWith("D:\\",System.StringComparison.OrdinalIgnoreCase))throw new System.ArgumentException("开发环境仅允许 D 盘");
   System.Guid media=new System.Guid("4d36e96c-e325-11ce-bfc1-08002be10318");System.IntPtr set=SetupDiCreateDeviceInfoList(ref media,System.IntPtr.Zero);
   if(set==new System.IntPtr(-1))throw new System.ComponentModel.Win32Exception();
   DeviceInfo info=new DeviceInfo{Size=(uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(DeviceInfo))};bool registered=false;
   try{
    Check(SetupDiCreateDeviceInfo(set,"MEDIA",ref media,"FxSound Audio Enhancer",System.IntPtr.Zero,1,ref info),"创建设备信息失败");
    byte[] ids=System.Text.Encoding.Unicode.GetBytes("Root\\FXVAD\0\0");Check(SetupDiSetDeviceRegistryProperty(set,ref info,1,ids,(uint)ids.Length),"配置硬件 ID 失败");
    Check(SetupDiCallClassInstaller(0x19,set,ref info),"注册音频设备失败");registered=true;
    bool reboot;Check(UpdateDriverForPlugAndPlayDevices(System.IntPtr.Zero,"Root\\FXVAD",inf,1,out reboot),"安装签名音频驱动失败");return reboot;
   }catch{if(registered)SetupDiCallClassInstaller(5,set,ref info);throw;}
   finally{SetupDiDestroyDeviceInfoList(set);}
  }
 }
}
