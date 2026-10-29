// 独立实现 NVIDIA 官方 NVAPI DRS ABI；常量和布局依据公开 SDK，不依赖第三方配置导入器。
namespace Zhenjing {
 public sealed class Nvidia : System.IDisposable {
  [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)] static extern System.IntPtr LoadLibraryEx(string path,System.IntPtr file,uint flags);
  [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Ansi)] static extern System.IntPtr GetProcAddress(System.IntPtr module,string name);
  [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool FreeLibrary(System.IntPtr module);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate System.IntPtr Query(uint id);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate int Simple();
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate int Session(out System.IntPtr session);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate int SessionOp(System.IntPtr session);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate int Profile(System.IntPtr session,out System.IntPtr profile);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl,CharSet=System.Runtime.InteropServices.CharSet.Unicode)] delegate int FindProfile(System.IntPtr session,string name,out System.IntPtr profile);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate int Get(System.IntPtr session,System.IntPtr profile,uint id,System.IntPtr setting);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate int Set(System.IntPtr session,System.IntPtr profile,System.IntPtr setting);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate int Delete(System.IntPtr session,System.IntPtr profile,uint id);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)] delegate int Values(uint id,ref uint count,System.IntPtr values);
  System.IntPtr library,session,profile; Query query;
  T Api<T>(uint id) where T:class {System.IntPtr pointer=query(id);if(pointer==System.IntPtr.Zero)throw new System.NotSupportedException("驱动未提供 NVAPI 0x"+id.ToString("X8"));return System.Runtime.InteropServices.Marshal.GetDelegateForFunctionPointer(pointer,typeof(T)) as T;}
  static void Check(int status,string action) {if(status!=0)throw new System.InvalidOperationException(action+"失败，NVAPI "+status);}
  public Nvidia(string scope) {
   if(scope!="global" && scope!="delta")throw new System.ArgumentException("驱动配置范围无效");
   try {
    library=LoadLibraryEx(System.IO.Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.System),"nvapi64.dll"),System.IntPtr.Zero,0x800);
    if(library==System.IntPtr.Zero)throw new System.NotSupportedException("未安装可用的 NVIDIA 64 位驱动");
    System.IntPtr entry=GetProcAddress(library,"nvapi_QueryInterface");if(entry==System.IntPtr.Zero)throw new System.NotSupportedException("驱动未提供 NVAPI");
    query=(Query)System.Runtime.InteropServices.Marshal.GetDelegateForFunctionPointer(entry,typeof(Query));Check(Api<Simple>(0x0150e828)(),"初始化 NVAPI");
    Check(Api<Session>(0x0694d52e)(out session),"创建驱动会话");Check(Api<SessionOp>(0x375dbd6b)(session),"读取驱动数据库");
    if(scope=="global")Check(Api<Profile>(0xda8466a0)(session,out profile),"读取全局基础配置");
    else {
     int status=-163;foreach(string name in new[]{"Delta Force","Delta Force: Hawk Ops","DeltaForce","DeltaForceClient-Win64-Shipping","三角洲行动","三角洲"}){status=Api<FindProfile>(0x7e4a9a0b)(session,name,out profile);if(status==0)break;}
     if(status!=0)throw new System.NotSupportedException("驱动中没有三角洲行动配置，请先安装支持该游戏的 NVIDIA 驱动并启动游戏一次");
    }
   } catch {Dispose();throw;}
  }
  public sealed class Setting {public uint Id,Current,Default,Location;public bool Supported,Predefined;public string Name,Reason;public uint[] Values;}
  public Setting Read(uint id) {
   System.IntPtr buffer=System.Runtime.InteropServices.Marshal.AllocHGlobal(12320);
   try {
    byte[] zero=new byte[12320];System.Runtime.InteropServices.Marshal.Copy(zero,0,buffer,zero.Length);System.Runtime.InteropServices.Marshal.WriteInt32(buffer,12320|(1<<16));
    int status=Api<Get>(0x73bf8338)(session,profile,id,buffer);
    uint defaultValue;uint[] allowed=Allowed(id,out defaultValue);
    // SETTING_NOT_FOUND 也可能只表示尚无覆盖。只有驱动枚举支持时才使用其真实默认值。
    if(status==-160 && allowed.Length>0)return new Setting{Id=id,Supported=true,Reason="使用驱动默认值",Values=allowed,Name="",Current=defaultValue,Default=defaultValue,Location=3,Predefined=true};
    if(status!=0)return new Setting{Id=id,Supported=false,Reason="驱动不支持或未定义此项（"+status+"）",Values=new uint[0],Name=""};
    uint type=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,4104));
    if(type!=0)return new Setting{Id=id,Supported=false,Reason="此项不是 DWORD 类型",Values=new uint[0],Name=""};
    return new Setting{Id=id,Supported=true,Reason="",Name=System.Runtime.InteropServices.Marshal.PtrToStringUni(System.IntPtr.Add(buffer,4),2048).TrimEnd('\0'),Current=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,8220)),Default=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,4120)),Location=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,4108)),Predefined=System.Runtime.InteropServices.Marshal.ReadInt32(buffer,4112)!=0,Values=allowed};
   } finally{System.Runtime.InteropServices.Marshal.FreeHGlobal(buffer);}
  }
  uint[] Allowed(uint id,out uint defaultValue) {
   defaultValue=0;
   const int size=12+4100*101;System.IntPtr buffer=System.Runtime.InteropServices.Marshal.AllocHGlobal(size);
   try {
    byte[] zero=new byte[size];System.Runtime.InteropServices.Marshal.Copy(zero,0,buffer,size);System.Runtime.InteropServices.Marshal.WriteInt32(buffer,size|(1<<16));uint count=100;
    if(Api<Values>(0x2ec39f90)(id,ref count,buffer)!=0 || count>100 || System.Runtime.InteropServices.Marshal.ReadInt32(buffer,8)!=0)return new uint[0];
    uint actual=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,4));if(actual>100)return new uint[0];
    defaultValue=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,12));uint[] rows=new uint[actual];for(int i=0;i<rows.Length;i++)rows[i]=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,4112+i*4100));return rows;
   }finally{System.Runtime.InteropServices.Marshal.FreeHGlobal(buffer);}
  }
  public void Write(uint id,uint value,bool reset,bool restoring) {
   Setting before=Read(id);if(!before.Supported)throw new System.NotSupportedException(before.Reason);
   if(reset){int result=Api<Delete>(0xe4a26362)(session,profile,id);if(result!=0 && result!=-160)Check(result,"移除驱动覆盖");return;}
   // 正常写入必须来自驱动枚举值；数值型 FPS 设置使用 SDK 定义的显式范围。
   bool allowed=false;foreach(uint candidate in before.Values)if(candidate==value)allowed=true;
   if(id==0x10835002 && value<=1000)allowed=true;
   if(!restoring && !allowed)throw new System.ArgumentException("驱动未声明支持此设置值");
   System.IntPtr buffer=System.Runtime.InteropServices.Marshal.AllocHGlobal(12320);
   try{byte[] zero=new byte[12320];System.Runtime.InteropServices.Marshal.Copy(zero,0,buffer,zero.Length);System.Runtime.InteropServices.Marshal.WriteInt32(buffer,12320|(1<<16));System.Runtime.InteropServices.Marshal.WriteInt32(buffer,4100,unchecked((int)id));System.Runtime.InteropServices.Marshal.WriteInt32(buffer,8220,unchecked((int)value));Check(Api<Set>(0x577dd202)(session,profile,buffer),"写入驱动配置");}
   finally{System.Runtime.InteropServices.Marshal.FreeHGlobal(buffer);}
  }
  public void Save(){Check(Api<SessionOp>(0xfcbc7e14)(session),"保存驱动数据库");}
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)]delegate int Gpus([System.Runtime.InteropServices.Out]System.IntPtr[] gpus,out uint count);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)]delegate int GpuStructure(System.IntPtr gpu,System.IntPtr value);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)]delegate int GpuValue(System.IntPtr gpu,out uint value);
  [System.Runtime.InteropServices.UnmanagedFunctionPointer(System.Runtime.InteropServices.CallingConvention.Cdecl)]delegate int GpuThermal(System.IntPtr gpu,uint sensor,System.IntPtr value);
  public System.Collections.Generic.Dictionary<string,object> Hardware(){
   var result=new System.Collections.Generic.Dictionary<string,object>();foreach(string name in new[]{"gpu","gpuTemperature","gpuClock","gpuMemoryClock","gpuFan","vramUsed","vramTotal","gpuPower","gpuVoltage"})result[name]=null;
   System.IntPtr[] handles=new System.IntPtr[64];uint count;if(Api<Gpus>(0xe5ac921f)(handles,out count)!=0||count==0)return result;System.IntPtr gpu=handles[0];
   System.IntPtr buffer=System.Runtime.InteropServices.Marshal.AllocHGlobal(264);
   try{
    System.Action<int,int> initialize=(size,version)=>{byte[] zero=new byte[264];System.Runtime.InteropServices.Marshal.Copy(zero,0,buffer,264);System.Runtime.InteropServices.Marshal.WriteInt32(buffer,size|(version<<16));};
    initialize(68,2);if(Api<GpuThermal>(0xe3640a56)(gpu,0,buffer)==0&&System.Runtime.InteropServices.Marshal.ReadInt32(buffer,4)>0)result["gpuTemperature"]=System.Runtime.InteropServices.Marshal.ReadInt32(buffer,20);
    initialize(72,1);if(Api<GpuStructure>(0x60ded2ed)(gpu,buffer)==0&&(System.Runtime.InteropServices.Marshal.ReadInt32(buffer,8)&1)!=0)result["gpu"]=System.Runtime.InteropServices.Marshal.ReadInt32(buffer,12);
    initialize(264,2);if(Api<GpuStructure>(0xdcb616c3)(gpu,buffer)==0){if((System.Runtime.InteropServices.Marshal.ReadInt32(buffer,8)&1)!=0)result["gpuClock"]=System.Runtime.InteropServices.Marshal.ReadInt32(buffer,12)/1000.0;if((System.Runtime.InteropServices.Marshal.ReadInt32(buffer,40)&1)!=0)result["gpuMemoryClock"]=System.Runtime.InteropServices.Marshal.ReadInt32(buffer,44)/1000.0;}
    initialize(24,2);if(Api<GpuStructure>(0x07f9b368)(gpu,buffer)==0){double total=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,4))/1048576.0,free=unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(buffer,20))/1048576.0;result["vramTotal"]=total;result["vramUsed"]=System.Math.Max(0,total-free);}
    uint rpm;if(Api<GpuValue>(0x5f608315)(gpu,out rpm)==0)result["gpuFan"]=rpm;
   }finally{System.Runtime.InteropServices.Marshal.FreeHGlobal(buffer);}return result;
  }
  public void Dispose(){if(session!=System.IntPtr.Zero){try{Api<SessionOp>(0xdad9cff8)(session);}finally{session=System.IntPtr.Zero;}}if(library!=System.IntPtr.Zero){FreeLibrary(library);library=System.IntPtr.Zero;}}
 }
}
