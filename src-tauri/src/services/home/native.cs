// Windows 原生边界：Rust 禁止 unsafe；此助手只处理固定 API，不执行任意脚本或键鼠远控。
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Threading;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

namespace Zhenjing.Home {
 public sealed class Configuration {
  public string id;
  public bool? manual;
  public bool autoGameMode, disableWinInGame, restore, stop;
  public string[] paths = new string[0], directories = new string[0], names = new string[0];
  public int[] launched = new int[0];
  public WheelSettings wheel=new WheelSettings();
  public bool wheelPreview;
 }
 public sealed class Original {
  public int pid;
  public long created;
  public uint priority;
  public int? io, memory;
  public uint? ecoControl, ecoState;
 }
 internal sealed class ProcessRow {
  internal int pid, parent;
  internal long created;
  internal string path, name;
  internal double cpu;
 }
 [StructLayout(LayoutKind.Sequential)] internal struct FileTime { public uint low, high; public long Value {get {return ((long)high<<32)|low;}} }
 [StructLayout(LayoutKind.Sequential)] internal struct Throttling { public uint version, control, state; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] internal struct ProcessEntry {
  public uint size,usage,pid; public UIntPtr heap; public uint module,threads,parent; public int priority; public uint flags;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string name;
 }
 public static class Native {
  [DllImport("kernel32.dll",SetLastError=true)] static extern SafeFileHandle OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(SafeFileHandle h,out FileTime created,out FileTime exit,out FileTime kernel,out FileTime user);
  [DllImport("kernel32.dll")] static extern uint GetPriorityClass(SafeFileHandle h);
  [DllImport("kernel32.dll")] static extern bool SetPriorityClass(SafeFileHandle h,uint priority);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(SafeFileHandle h,uint flags,StringBuilder path,ref uint size);
  [DllImport("kernel32.dll")] static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32First(SafeFileHandle h,ref ProcessEntry e);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32Next(SafeFileHandle h,ref ProcessEntry e);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessInformation(SafeFileHandle h,int cls,ref Throttling data,uint size);
  [DllImport("kernel32.dll")] static extern bool SetProcessInformation(SafeFileHandle h,int cls,ref Throttling data,uint size);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(SafeFileHandle h,int cls,out int value,int size,out int returned);
  [DllImport("ntdll.dll")] static extern int NtSetInformationProcess(SafeFileHandle h,int cls,ref int value,int size);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(SafeFileHandle h,uint access,out SafeFileHandle token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(SafeFileHandle h,int cls,IntPtr data,int size,out int needed);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type,Hook callback,IntPtr module,uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string module);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SHDefExtractIcon(string file,int index,uint flags,out IntPtr large,out IntPtr small,uint size);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
  static JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=1048576};
  static ConcurrentQueue<string> queue=new ConcurrentQueue<string>();
  static Dictionary<int,Original> owned=new Dictionary<int,Original>();
  static Dictionary<int,ProcessRow> last=new Dictionary<int,ProcessRow>();
  static HashSet<int> gameFamily=new HashSet<int>();
  static HashSet<int> keyboardGames=new HashSet<int>();
  static HashSet<int> suppressedKeys=new HashSet<int>(),forwardedKeys=new HashSet<int>();
  static Configuration config=new Configuration();
  static volatile bool ending;
  static bool manual, effective, manualOverride, hadGame;
  static string message="",root,journal,ownSid;
  static Process owner;
  static IntPtr keyboard=IntPtr.Zero;
  static volatile bool hookWanted;
  static Thread hookThread;
  static ManualResetEventSlim hookReady=new ManualResetEventSlim(false);
  static Hook callback=Keyboard;
  static Mutex lease;
  static bool leased;
  static DateTime sampled=DateTime.UtcNow;
  static List<Original> recovery=new List<Original>();
  // 永不调整系统、平台、反作弊、输入、音频、网络、安全及硬件控制程序。
  static string[] protectedNames={"system","idle","registry","smss","csrss","wininit","winlogon","services","lsass","svchost","dwm","explorer","sihost","taskhostw","ctfmon","textinputhost","startmenuexperiencehost","shellexperiencehost","runtimebroker","fontdrvhost","audiodg","conhost","dllhost","searchhost","securityhealthservice","msmpeng","nissrv","taskmgr","zhenjing","powershell","pwsh","steam","steamwebhelper","epicgameslauncher","eadesktop","origin","riotclientservices","battle.net","goggalaxy","galaxyclient","ubisoftconnect","upc","easyanticheat","beservice","vgc","vgtray","ace","aceservice","anticheat","gamebar","gamingservices","xbox","msiafterburner","rtss","nvidia","nvcontainer","amd","radeon","intel","realtek","nahimic","dolby","logi","razer","corsair","icue","steelseries","armoury","asus","lenovo","vantage","omen","awcc","msicenter","dragon","wegame","qqpc","huorong","360","uu","qiyou","leigod","clash","v2ray","openvpn","wireguard"};
  static readonly object outputGate=new object();
  static void Output(object value){lock(outputGate){try {Console.WriteLine(json.Serialize(value));Console.Out.Flush();}catch(IOException){ending=true;hookWanted=false;}}}
  static void AssertLocal(string path){
   string full=Path.GetFullPath(path);
   if(!Path.IsPathRooted(path)||full.Length<4||full[1]!=':'||full[2]!='\\'||full.StartsWith("\\\\",StringComparison.Ordinal))throw new IOException("恢复记录必须位于本地磁盘目录");
   if(Environment.GetEnvironmentVariable("ZHENJING_RESTRICT_WRITES_TO_D")=="1"&&!full.StartsWith("D:\\",StringComparison.OrdinalIgnoreCase))throw new IOException("开发环境仅允许 D 盘");
   for(string current=full;!String.IsNullOrEmpty(current);current=Path.GetDirectoryName(current)){
    if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new IOException("恢复目录不能包含链接");
   }
  }
  static void Save(){
   AssertLocal(journal);string temp=Path.Combine(root,"recovery-"+Guid.NewGuid().ToString("N")+".tmp");
   // 写前保存完整原值；崩溃后可通过界面恢复，不在下一次启动时偷偷改写进程。
   var rows=recovery.Concat(owned.Values).GroupBy(x=>x.pid+":"+x.created).Select(x=>x.First()).ToArray();
   byte[] bytes=new UTF8Encoding(false).GetBytes(json.Serialize(rows));
   using(var file=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)){file.Write(bytes,0,bytes.Length);file.Flush(true);}
   if(File.Exists(journal))File.Replace(temp,journal,null);else File.Move(temp,journal);
  }
  static long Created(SafeFileHandle h){FileTime c,e,k,u;return GetProcessTimes(h,out c,out e,out k,out u)?c.Value:0;}
  static int? Query(SafeFileHandle h,int cls){int value,len;return NtQueryInformationProcess(h,cls,out value,4,out len)==0?(int?)value:null;}
  static bool SameUser(SafeFileHandle h){
   SafeFileHandle token;if(!OpenProcessToken(h,8,out token))return false;
   using(token){int size;GetTokenInformation(token,1,IntPtr.Zero,0,out size);if(size<1||size>65536)return false;
    IntPtr bytes=Marshal.AllocHGlobal(size);try {if(!GetTokenInformation(token,1,bytes,size,out size))return false;return new SecurityIdentifier(Marshal.ReadIntPtr(bytes)).Value==ownSid;}finally {Marshal.FreeHGlobal(bytes);}}
  }
  static List<ProcessRow> Processes(){
   var result=new List<ProcessRow>();using(var snap=CreateToolhelp32Snapshot(2,0)){
    if(snap.IsInvalid)return result;var entry=new ProcessEntry {size=(uint)Marshal.SizeOf(typeof(ProcessEntry))};
    if(!Process32First(snap,ref entry))return result;
    do {try {int pid=checked((int)entry.pid);if(pid<=4)continue;using(var h=OpenProcess(0x1000,false,pid)){
     if(h.IsInvalid)continue;uint length=32768;var path=new StringBuilder((int)length);
     FileTime c,e,k,u;if(!QueryFullProcessImageName(h,0,path,ref length)||!GetProcessTimes(h,out c,out e,out k,out u))continue;
     result.Add(new ProcessRow {pid=pid,parent=(int)entry.parent,name=Path.GetFileNameWithoutExtension(entry.name).ToLowerInvariant(),path=path.ToString(),created=c.Value,cpu=(k.Value+u.Value)/10000.0});
    }}catch {}}while(Process32Next(snap,ref entry));
   }return result;
  }
  static HashSet<int> Descendants(HashSet<int> seed,List<ProcessRow> rows){
   bool changed;do {changed=false;foreach(var row in rows)if(seed.Contains(row.parent)&&seed.Add(row.pid))changed=true;}while(changed);return seed;
  }
  static bool Game(ProcessRow row){
   return config.paths.Any(x=>String.Equals(x,row.path,StringComparison.OrdinalIgnoreCase))
    ||config.directories.Any(x=>row.path.StartsWith(x.TrimEnd('\\','/')+"\\",StringComparison.OrdinalIgnoreCase))
    ||config.names.Any(x=>String.Equals(x,row.name+".exe",StringComparison.OrdinalIgnoreCase));
  }
  static IntPtr Keyboard(int code,IntPtr keyMessage,IntPtr data){
   if(WheelController.Keyboard(code,keyMessage,data))return (IntPtr)1;
   if(code>=0){int key=Marshal.ReadInt32(data);if(key==0x5b||key==0x5c){
    long kind=keyMessage.ToInt64();bool down=kind==0x100||kind==0x104;
    if(!down){bool swallowed=suppressedKeys.Remove(key);forwardedKeys.Remove(key);if(swallowed)return (IntPtr)1;}
    else {if(suppressedKeys.Contains(key))return (IntPtr)1;if(!forwardedKeys.Contains(key)){uint pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);if(hookWanted&&Volatile.Read(ref keyboardGames).Contains((int)pid)){suppressedKeys.Add(key);return (IntPtr)1;}forwardedKeys.Add(key);}}
   }
   }return CallNextHookEx(keyboard,code,keyMessage,data);
  }
  static void HookState(){
   hookWanted=config.disableWinInGame;
   if((hookWanted||WheelController.Requested)!=(keyboard!=IntPtr.Zero)){hookReady.Reset();if(!hookReady.Wait(2000))message="键盘钩子状态确认超时，关闭策略可停止拦截";}
   if(hookWanted&&keyboard==IntPtr.Zero)message="Win 键钩子创建失败，未拦截输入";
  }
  // 独立消息线程只做按键判定；进程扫描、磁盘写入不能阻塞低级钩子回调而导致 Windows 超时移除钩子。
  static void HookLoop(){
   var pulse=new System.Windows.Forms.Timer {Interval=50};pulse.Tick+=delegate {
    try {
    if(owner.HasExited){ending=true;hookWanted=false;}
    WheelController.Pulse(ending);
    bool needed=hookWanted||WheelController.Requested;
    if(needed&&!ending&&keyboard==IntPtr.Zero)keyboard=SetWindowsHookEx(13,callback,GetModuleHandle(null),0);
    if((!needed||ending)&&keyboard!=IntPtr.Zero&&UnhookWindowsHookEx(keyboard)){keyboard=IntPtr.Zero;suppressedKeys.Clear();forwardedKeys.Clear();}
    WheelController.HookReady(keyboard!=IntPtr.Zero);
    hookReady.Set();if(ending)Application.ExitThread();
    }catch(Exception){hookWanted=false;ending=true;hookReady.Set();Application.ExitThread();}
   };
   try {pulse.Start();Application.Run();}finally {pulse.Stop();if(keyboard!=IntPtr.Zero)UnhookWindowsHookEx(keyboard);keyboard=IntPtr.Zero;hookReady.Set();}
  }
  static void Restore(Original row){
   using(var h=OpenProcess(0x1200,false,row.pid)){
    if(h.IsInvalid){if(Marshal.GetLastWin32Error()==87)return;throw new IOException("无法打开待恢复进程，已保留原值");}
    long created=Created(h);if(created==0)throw new IOException("无法核对待恢复进程创建时间");if(created!=row.created)return;
    if(!SameUser(h))throw new IOException("不能恢复其他用户的进程，已保留原值");
    // 只恢复仍等于本工具写入值的字段，保留其他程序或用户后来主动修改的值。
    uint priority=GetPriorityClass(h);if(priority==0)throw new IOException("无法读取待恢复的优先级");if(priority==0x4000&&row.priority!=0x4000&&!SetPriorityClass(h,row.priority))throw new IOException("进程优先级恢复失败");
    if(row.io.HasValue){var current=Query(h,33);if(!current.HasValue)throw new IOException("无法读取待恢复的 I/O 优先级");if(current==1){int value=row.io.Value;if(NtSetInformationProcess(h,33,ref value,4)!=0)throw new IOException("I/O 优先级恢复失败");}}
    if(row.memory.HasValue){var current=Query(h,39);if(!current.HasValue)throw new IOException("无法读取待恢复的内存优先级");if(current==3){int value=row.memory.Value;if(NtSetInformationProcess(h,39,ref value,4)!=0)throw new IOException("内存优先级恢复失败");}}
    if(row.ecoState.HasValue){var current=new Throttling {version=1};if(!GetProcessInformation(h,4,ref current,12))throw new IOException("无法读取待恢复的 EcoQoS 状态");if((current.control&1)!=0&&(current.state&1)!=0){var original=new Throttling {version=1,control=(current.control&~1u)|(row.ecoControl.Value&1u),state=(current.state&~1u)|(row.ecoState.Value&1u)};if(!SetProcessInformation(h,4,ref original,12))throw new IOException("EcoQoS 恢复失败");}}
   }
  }
  static void RestoreOwned(HashSet<int> keep){
   foreach(var row in owned.Values.ToArray())if(!keep.Contains(row.pid)){try {Restore(row);owned.Remove(row.pid);}catch(Exception e){message=e.Message;}}
   Save();
  }
  static void Acquire(ProcessRow row){
   if(owned.ContainsKey(row.pid))return;
   using(var h=OpenProcess(0x1200,false,row.pid)){
    if(h.IsInvalid||Created(h)!=row.created||!SameUser(h)||GetPriorityClass(h)!=0x20)return;
    var eco=new Throttling {version=1};bool hasEco=GetProcessInformation(h,4,ref eco,12);
    int? io=Query(h,33),memory=Query(h,39);bool changeEco=hasEco&&((eco.control&1)==0||(eco.state&1)==0);
    var original=new Original {pid=row.pid,created=row.created,priority=GetPriorityClass(h),io=io>1?io:null,memory=memory>3?memory:null,ecoControl=changeEco?(uint?)eco.control:null,ecoState=changeEco?(uint?)eco.state:null};
    owned.Add(row.pid,original);Save();
    if(!SetPriorityClass(h,0x4000)){owned.Remove(row.pid);Save();return;}
    if(original.io.HasValue){int value=1;NtSetInformationProcess(h,33,ref value,4);}
    if(original.memory.HasValue){int value=3;NtSetInformationProcess(h,39,ref value,4);}
    if(changeEco){var next=new Throttling {version=1,control=eco.control|1,state=eco.state|1};SetProcessInformation(h,4,ref next,12);}
   }
  }
  static void Tick(){
   var rows=Processes();var previousFamily=gameFamily;
   gameFamily=Descendants(new HashSet<int>(rows.Where(x=>{ProcessRow prior;return Game(x)||(previousFamily.Contains(x.pid)&&last.TryGetValue(x.pid,out prior)&&prior.created==x.created);}).Select(x=>x.pid)),rows);
   // 记录由快捷启动创建的家族；PID 只用于本次会话，重启后不会复用。
   foreach(var pid in config.launched)if(rows.Any(x=>x.pid==pid&&Game(x)))gameFamily.Add(pid);
   gameFamily=Descendants(gameFamily,rows);
   if(hadGame&&gameFamily.Count==0&&config.autoGameMode){manualOverride=false;manual=false;}
   hadGame=gameFamily.Count>0;
   bool active=manualOverride?manual:(config.autoGameMode&&hadGame);effective=active;
   uint foreground;GetWindowThreadProcessId(GetForegroundWindow(),out foreground);
   var exempt=Descendants(new HashSet<int>(new[]{(int)foreground,owner.Id,Process.GetCurrentProcess().Id}.Concat(gameFamily)),rows);
   // 加速链路必须保留调度能力；连同 QuickFox 的服务/子进程一并排除后台压制。
   // 此处只放宽压制范围，不以进程名称认定其官方身份；客户端启动仍由签名校验网关负责。
   exempt.UnionWith(Descendants(new HashSet<int>(rows.Where(x=>x.name.StartsWith("quickfox",StringComparison.OrdinalIgnoreCase)||x.path.IndexOf("\\QuickFox\\",StringComparison.OrdinalIgnoreCase)>=0).Select(x=>x.pid)),rows));
   bool discarded=false;foreach(var original in owned.Values.ToArray())if(!rows.Any(x=>x.pid==original.pid&&x.created==original.created)){owned.Remove(original.pid);discarded=true;}if(discarded)Save();
   double elapsed=Math.Max(1,(DateTime.UtcNow-sampled).TotalMilliseconds);var keep=new HashSet<int>();
   if(active){foreach(var row in rows){
    if(exempt.Contains(row.pid)||row.path.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.Windows)+"\\",StringComparison.OrdinalIgnoreCase)||protectedNames.Any(x=>row.name.StartsWith(x,StringComparison.OrdinalIgnoreCase)))continue;
    ProcessRow previous;
    // 常规档只压制 CPU 占用持续超过 5% 的同用户后台普通进程；不隔离、不终止进程。
    if(owned.ContainsKey(row.pid))keep.Add(row.pid);
    else if(last.TryGetValue(row.pid,out previous)&&row.created==previous.created&&(row.cpu-previous.cpu)/elapsed/Environment.ProcessorCount>0.05){Acquire(row);if(owned.ContainsKey(row.pid))keep.Add(row.pid);}
   }}
   if(owned.Keys.Any(x=>!keep.Contains(x)))RestoreOwned(keep);
   last=rows.GroupBy(x=>x.pid).ToDictionary(x=>x.Key,x=>x.First());sampled=DateTime.UtcNow;
   Volatile.Write(ref keyboardGames,new HashSet<int>(gameFamily));HookState();Status();
  }
  static void Status(){uint foreground;GetWindowThreadProcessId(GetForegroundWindow(),out foreground);Output(new {kind="status",runtime=new {ready=true,manual=manual,effective=effective,gameRunning=gameFamily.Count>0,winKeyBlocked=hookWanted&&keyboard!=IntPtr.Zero&&gameFamily.Contains((int)foreground),suppressedCount=owned.Count,recoverableCount=recovery.Count,message=message}});}
  static void Configure(string text){
   string id="";try {
    var next=json.Deserialize<Configuration>(text);id=next.id;
    if(next.wheelPreview){WheelController.Preview();Output(new {kind="ack",id=id,ok=true,message=""});return;}
    if(next.paths.Length>128||next.directories.Length>30000||next.names.Length>512)throw new IOException("识别名单超过限制");
    if(!next.restore&&recovery.Count>0&&(next.manual==true||next.autoGameMode||next.disableWinInGame))throw new IOException("存在未恢复的进程记录，请先使用恢复入口");
    if((next.manual==true||next.autoGameMode||next.disableWinInGame||next.restore)&&!leased){try {if(!lease.WaitOne(0))throw new IOException("另一臻境实例正在控制游戏模式，请先在该实例关闭");}catch(AbandonedMutexException){}leased=true;}
    if(next.restore){foreach(var row in recovery.ToArray()){try {Restore(row);recovery.Remove(row);}catch(Exception e){message=e.Message;}}Save();if(recovery.Count>0)throw new IOException("部分进程未能恢复，原值已保留，可稍后重试："+message);}
    if(next.manual.HasValue){manual=next.manual.Value;manualOverride=true;}
    else if(next.autoGameMode!=config.autoGameMode){manualOverride=false;manual=false;}
    config=next;WheelController.Configure(next.wheel);message="";if(next.stop){manual=false;config.autoGameMode=false;config.disableWinInGame=false;ending=true;}
    Tick();if(config.disableWinInGame&&keyboard==IntPtr.Zero)throw new IOException("Win 键钩子未就绪，策略未成功应用");if(!effective&&owned.Count>0)throw new IOException("仍有部分进程未能恢复，原值保留在应用数据目录，可再次使用恢复入口");
    if(!manual&&!config.autoGameMode&&!config.disableWinInGame&&leased){lease.ReleaseMutex();leased=false;}
    Output(new {kind="ack",id=id,ok=true,message=""});
   }catch(Exception e){message=e.Message;Status();Output(new {kind="ack",id=id,ok=false,message=e.Message});}
  }
  public static string Icon(string file){
   IntPtr large,small;int result=SHDefExtractIcon(file,0,0,out large,out small,256);
   try {if(result!=0||large==IntPtr.Zero)return null;using(var icon=System.Drawing.Icon.FromHandle(large))using(var bitmap=icon.ToBitmap())using(var output=new MemoryStream()){bitmap.Save(output,System.Drawing.Imaging.ImageFormat.Png);return "data:image/png;base64,"+Convert.ToBase64String(output.ToArray());}}
   finally {if(large!=IntPtr.Zero)DestroyIcon(large);if(small!=IntPtr.Zero)DestroyIcon(small);}
  }
  /// 尊重客户端的管理员清单，由 Windows 显示正常 UAC；不拼接命令行、不传入第三方参数。
  public static int? LaunchExecutable(string file,string environment){
   string path=Path.GetFullPath(file);
   if(path.Length<4||path[1]!=':'||path[2]!='\\'||!path.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)||!File.Exists(path))throw new IOException("启动程序路径无效");
   var values=json.Deserialize<Dictionary<string,string>>(environment);var before=new Dictionary<string,string>();
   try{foreach(string key in new[]{"TEMP","TMP","APPDATA","LOCALAPPDATA","USERPROFILE"}){string value;if(values.TryGetValue(key,out value)){before[key]=Environment.GetEnvironmentVariable(key);Environment.SetEnvironmentVariable(key,value);}}
    using(var process=Process.Start(new ProcessStartInfo {FileName=path,WorkingDirectory=Path.GetDirectoryName(path),UseShellExecute=true})){return process==null?(int?)null:process.Id;}
   }finally{foreach(var item in before)Environment.SetEnvironmentVariable(item.Key,item.Value);}
  }
  /// 只读 ABI 探测，开发验收不调用任何 Set API、安装钩子或调整其他进程。
  public static string Probe(){
   ownSid=WindowsIdentity.GetCurrent().User.Value;
   using(var h=OpenProcess(0x1000,false,Process.GetCurrentProcess().Id)){
    var eco=new Throttling {version=1};bool supported=GetProcessInformation(h,4,ref eco,12);
    return json.Serialize(new {priority=GetPriorityClass(h),created=Created(h)>0,sameUser=SameUser(h),io=Query(h,33),memory=Query(h,39),ecoSupported=supported});
   }
  }
  public static void Run(int ownerPid,string directory){
   root=Path.GetFullPath(directory);AssertLocal(root);journal=Path.Combine(root,"process-recovery.json");AssertLocal(journal);
   owner=Process.GetProcessById(ownerPid);ownSid=WindowsIdentity.GetCurrent().User.Value;
   WheelController.Initialize(Output,root);
   // 跨版本控制锁保持同一技术标识，改名后也不能与旧版同时调整进程或键盘钩子。
   lease=new Mutex(false,"Local\\XinjingHomeControl-"+Process.GetCurrentProcess().SessionId);
   if(File.Exists(journal)){if(new FileInfo(journal).Length>1048576)throw new IOException("恢复记录过大");recovery=json.Deserialize<List<Original>>(File.ReadAllText(journal))??new List<Original>();}
   // 只接受本助手能生成的快照；损坏文件保留原件，不能把可编辑 JSON 当作任意进程配置命令。
   if(recovery.Count>4096||recovery.Any(x=>x==null||x.pid<=4||x.created<=0||x.priority!=0x20||(x.io.HasValue&&(x.io<2||x.io>4))||(x.memory.HasValue&&(x.memory<4||x.memory>5))||x.ecoControl.HasValue!=x.ecoState.HasValue))throw new IOException("进程恢复记录无效，原文件已保留");
   // 读线程只入队；钩子、状态变更和恢复全部在消息线程顺序执行。
   hookThread=new Thread(HookLoop);hookThread.IsBackground=true;hookThread.SetApartmentState(ApartmentState.STA);hookThread.Start();
   var reader=new Thread(delegate(){try {string line;while((line=Console.ReadLine())!=null){if(line.Length>1048576)break;queue.Enqueue(line);}}finally {ending=true;hookWanted=false;}});reader.IsBackground=true;reader.Start();
   var timer=new System.Windows.Forms.Timer {Interval=1000};
   int ticks=0;timer.Tick+=delegate {try {if(owner.HasExited)ending=true;if(ending){Application.ExitThread();return;}string line;while(queue.TryDequeue(out line)){Configure(line);if(ending)break;}if(ending){Application.ExitThread();return;}if(++ticks%3==0)Tick();}catch(Exception e){message=e.Message;Status();}};
   try {timer.Start();Status();Application.Run();}
   finally {timer.Stop();ending=true;manual=false;hookWanted=false;config.disableWinInGame=false;config.autoGameMode=false;HookState();try {RestoreOwned(new HashSet<int>());}catch(Exception e){message=e.Message;}hookThread.Join(2000);if(leased)lease.ReleaseMutex();lease.Dispose();owner.Dispose();}
  }
 }
}
