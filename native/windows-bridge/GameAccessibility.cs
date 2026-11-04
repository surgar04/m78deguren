// 游戏辅助功能保护。仅临时更改 StickyKeys 的开启/热键位，不持久化系统配置，不修改注册表。
// 原值先写入 D 盘恢复记录；父进程看门狗及正常退出均执行条件恢复，避免覆盖用户后续手动修改。
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Zhenjing.Home {
 public static class GameAccessibility {
  [StructLayout(LayoutKind.Sequential)] public struct StickyKeys { public uint size,flags; }
  [DllImport("user32.dll",SetLastError=true)] static extern bool SystemParametersInfo(uint action,uint parameter,ref StickyKeys value,uint flags);
  sealed class Record { public uint original,applied; }
  const uint OwnedMask=0x0d;
  static Record owned;
  static string journal;
  static NotifyIcon notification;
  static bool notified;
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
  static bool Restricted {get{return Environment.GetEnvironmentVariable("ZHENJING_RESTRICT_WRITES_TO_D")=="1";}}
  public static uint ReadFlags(){var value=new StickyKeys{size=8};if(!SystemParametersInfo(0x003a,8,ref value,0))throw new IOException("Windows 无法读取粘滞键状态");return value.flags;}
  static void WriteFlags(uint flags){if(Restricted)throw new IOException("开发验收不修改系统辅助功能");var value=new StickyKeys{size=8,flags=flags};if(!SystemParametersInfo(0x003b,8,ref value,0))throw new IOException("Windows 未能应用粘滞键保护");}
  static void Validate(string path){
   string full=Path.GetFullPath(path);if(!Path.IsPathRooted(full)||full.Length<4||full[1]!=':'||full.StartsWith("\\\\",StringComparison.Ordinal))throw new IOException("辅助功能恢复记录目录无效");
   if(Restricted&&!full.StartsWith("D:\\",StringComparison.OrdinalIgnoreCase))throw new IOException("开发环境只允许 D 盘");
   for(string current=full;!String.IsNullOrEmpty(current);current=Path.GetDirectoryName(current))if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new IOException("辅助功能恢复记录不能经过链接");
  }
  public static void Initialize(string directory){
   journal=Path.Combine(directory,"sticky-keys-recovery.json");Validate(journal);
   if(File.Exists(journal)){var info=new FileInfo(journal);if(info.Length>4096)throw new IOException("粘滞键恢复记录异常");var value=Json.Deserialize<Record>(File.ReadAllText(journal));if(value==null||value.applied!=(value.original&~OwnedMask))throw new IOException("粘滞键恢复记录无效，原件已保留");owned=value;if(!Restricted)Restore(false);}
  }
  static void Save(){
   Validate(journal);string temp=journal+"."+Guid.NewGuid().ToString("N")+".tmp";
   using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)){var bytes=new UTF8Encoding(false).GetBytes(Json.Serialize(owned));stream.Write(bytes,0,bytes.Length);stream.Flush(true);}
   if(File.Exists(journal))File.Replace(temp,journal,null);else File.Move(temp,journal);
  }
  public static void Update(bool running,bool enabled){
   if(Restricted)return;
   if(!running||!enabled){Restore(false);notified=false;if(notification!=null)notification.Visible=false;return;}
   if(owned!=null)return;
   uint original=ReadFlags(),applied=original&~OwnedMask;
   if(original==applied){if(!notified){Show("游戏辅助保护已就绪","粘滞键及连续按 Shift 的激活热键已处于关闭状态，本次无需修改。");notified=true;}return;}
   owned=new Record{original=original,applied=applied};Save();
   WriteFlags(applied);
   Show("游戏辅助保护已开启","已临时屏蔽粘滞键及连续按 Shift 的激活热键。退出所有游戏后恢复；可在游戏空间设置中关闭。");
   notified=true;
  }
  public static void Restore(bool force){
   if(owned==null||Restricted)return;
   uint current=ReadFlags();
   if(!force&&(current&OwnedMask)!=(owned.applied&OwnedMask)&&(current&OwnedMask)!=(owned.original&OwnedMask))throw new IOException("粘滞键设置已被其他程序修改，原值保留；请在游戏空间使用恢复入口");
   if((current&OwnedMask)!=(owned.original&OwnedMask))WriteFlags((current&~OwnedMask)|(owned.original&OwnedMask));
   Validate(journal);if(File.Exists(journal))File.Delete(journal);owned=null;
   if(notification!=null)notification.Visible=false;
  }
  static void Show(string title,string text){
   // NotifyIcon 由 Windows Shell 呈现原生通知，沿用当前用户的系统通知开关；不创建网页提示冒充通知。
   try {if(notification==null)notification=new NotifyIcon{Icon=System.Drawing.SystemIcons.Information,Text="臻境 · 游戏辅助保护"};notification.Visible=true;notification.ShowBalloonTip(6000,title,text,ToolTipIcon.Info);}catch { /* 通知被系统禁用不影响恢复能力。 */ }
  }
  public static void Shutdown(){try{Restore(false);}finally{if(notification!=null){notification.Visible=false;notification.Dispose();notification=null;}}}
 }
}
