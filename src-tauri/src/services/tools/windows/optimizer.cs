// 注册表值适配器：明确使用 64 位视图，不展开环境变量，保留原值类型及原始二进制内容。
// 目录、白名单、事务与用户确认由 Rust/固定 PowerShell 协调；此处不运行命令或读取 .reg 文件。
namespace Zhenjing {
 public static class OptimizationRegistry {
  static Microsoft.Win32.RegistryKey Base(string path, out string relative) {
   // 所有调用显式选择 Registry64；用户根已由协调层转换为发起用户的 HKEY_USERS\SID。
   int separator=path.IndexOf('\\');
   if(separator<1 || path.IndexOf('\0')>=0) throw new System.ArgumentException("注册表路径不合法");
   relative=path.Substring(separator+1);
   if(relative.Length==0 || relative.Split('\\').Length>64 || relative.Contains("..")) throw new System.ArgumentException("注册表路径层级不合法");
   Microsoft.Win32.RegistryHive hive;
   switch(path.Substring(0,separator)) {
    case "HKEY_LOCAL_MACHINE": hive=Microsoft.Win32.RegistryHive.LocalMachine;break;
    case "HKEY_USERS": hive=Microsoft.Win32.RegistryHive.Users;break;
    case "HKEY_CLASSES_ROOT": hive=Microsoft.Win32.RegistryHive.ClassesRoot;break;
    default: throw new System.ArgumentException("注册表根不受支持");
   }
   return Microsoft.Win32.RegistryKey.OpenBaseKey(hive,Microsoft.Win32.RegistryView.Registry64);
  }
  public static bool KeyExists(string path) {
   string relative;using(var root=Base(path,out relative))using(var key=root.OpenSubKey(relative,false))return key!=null;
  }
  public static string[] Missing(string path) {
   // 从根向叶记录原本缺失的层级。恢复不凭当前目录猜测“哪些键由本次创建”。
   string relative;var result=new System.Collections.Generic.List<string>();
   using(var root=Base(path,out relative)) {
    string prefix=path.Substring(0,path.Length-relative.Length),current="";
    foreach(string part in relative.Split('\\')) {
     current=current.Length==0?part:current+"\\"+part;
     using(var key=root.OpenSubKey(current,false))if(key==null)result.Add(prefix+current);
    }
   }
   return result.ToArray();
  }
  public static System.Collections.Generic.Dictionary<string,object> Read(string path,string name) {
   // 先判断值是否存在：缺失、空字符串和数值零具有不同含义，不能使用默认值混淆。
   string relative;
   var result=new System.Collections.Generic.Dictionary<string,object> {{"exists",false},{"kind",null},{"data",null},{"multi",new string[0]}};
   using(var root=Base(path,out relative))using(var key=root.OpenSubKey(relative,false)) {
    if(key==null)return result;
    bool exists=false;foreach(string found in key.GetValueNames())if(System.String.Equals(found,name,System.StringComparison.OrdinalIgnoreCase)){exists=true;break;}
    if(!exists)return result;
    var kind=key.GetValueKind(name);
    // ExpandString 的原始 %变量% 必须完整备份，不能保存为当前进程展开后的路径。
    object value=key.GetValue(name,null,Microsoft.Win32.RegistryValueOptions.DoNotExpandEnvironmentNames);
    if(value==null)throw new System.IO.IOException("读取期间注册表值发生变化，请重新检测");
    result["exists"]=true;result["kind"]=kind.ToString();
    switch(kind) {
     // .NET 返回有符号整数，而 .reg DWORD 常用高位位掩码；序列化为无符号十进制保留全部位。
     case Microsoft.Win32.RegistryValueKind.DWord:result["data"]=unchecked((uint)(int)value).ToString(System.Globalization.CultureInfo.InvariantCulture);break;
     case Microsoft.Win32.RegistryValueKind.QWord:result["data"]=unchecked((ulong)(long)value).ToString(System.Globalization.CultureInfo.InvariantCulture);break;
     case Microsoft.Win32.RegistryValueKind.MultiString:result["multi"]=(string[])value;break;
     case Microsoft.Win32.RegistryValueKind.Binary:
     case Microsoft.Win32.RegistryValueKind.None:
      var bytes=(byte[])value;if(bytes.Length>1048576)throw new System.IO.IOException("原始注册表值超过备份上限");result["data"]=System.Convert.ToBase64String(bytes);break;
     case Microsoft.Win32.RegistryValueKind.String:
     case Microsoft.Win32.RegistryValueKind.ExpandString:result["data"]=(string)value;break;
     default:throw new System.IO.IOException("不能安全备份此注册表类型");
    }
   }
   return result;
  }
  public static void Write(string path,string name,bool exists,string kind,string data,string[] multi) {
   // 不调用 SetValue 的自动类型推断，恢复时必须采用备份中记录的精确类型。
   string relative;using(var root=Base(path,out relative)) {
    if(!exists){using(var existing=root.OpenSubKey(relative,true))if(existing!=null)existing.DeleteValue(name,false);return;}
    object value;Microsoft.Win32.RegistryValueKind target;
    switch(kind) {
     case "DWord":value=unchecked((int)uint.Parse(data,System.Globalization.CultureInfo.InvariantCulture));target=Microsoft.Win32.RegistryValueKind.DWord;break;
     case "QWord":value=unchecked((long)ulong.Parse(data,System.Globalization.CultureInfo.InvariantCulture));target=Microsoft.Win32.RegistryValueKind.QWord;break;
     case "MultiString":value=multi??new string[0];target=Microsoft.Win32.RegistryValueKind.MultiString;break;
     case "Binary":value=System.Convert.FromBase64String(data);target=Microsoft.Win32.RegistryValueKind.Binary;break;
     case "None":value=System.Convert.FromBase64String(data);target=Microsoft.Win32.RegistryValueKind.None;break;
     case "String":value=data;target=Microsoft.Win32.RegistryValueKind.String;break;
     case "ExpandString":value=data;target=Microsoft.Win32.RegistryValueKind.ExpandString;break;
     default:throw new System.ArgumentException("恢复值类型不受支持");
    }
    using(var key=root.CreateSubKey(relative,true)) {if(key==null)throw new System.IO.IOException("无法打开目标注册表键");key.SetValue(name,value,target);}
   }
  }
  /// 只清理本次新建且仍为空的键；绝不递归删除包含用户其他配置的子树。
  public static void Prune(string path,string[] missing) {
   for(int index=missing.Length-1;index>=0;index--) {
    string candidate=missing[index];
    if(!path.Equals(candidate,System.StringComparison.OrdinalIgnoreCase) && !path.StartsWith(candidate+"\\",System.StringComparison.OrdinalIgnoreCase))throw new System.ArgumentException("空键清理范围无效");
    string relative;using(var root=Base(candidate,out relative)) {
     bool empty;using(var key=root.OpenSubKey(relative,false))empty=key!=null&&key.SubKeyCount==0&&key.ValueCount==0;
     if(empty)root.DeleteSubKey(relative,false);
    }
   }
  }
  /// DirectX 设置共用一个字符串：仅替换指定属性，其余字段不丢失；备份仍保存完整原串。
  public static string Patch(string original,string patch,string[] remove) {
   var keys=new System.Collections.Generic.Dictionary<string,string>(System.StringComparer.OrdinalIgnoreCase);
   foreach(string segment in (patch??"").Split(';')) {
    if(segment.Trim().Length==0)continue;int equal=segment.IndexOf('=');
    if(equal<1)throw new System.ArgumentException("DirectX 属性格式错误");
    string key=segment.Substring(0,equal).Trim();
    if(!System.Text.RegularExpressions.Regex.IsMatch(key,"^[A-Za-z][A-Za-z0-9]{0,63}$"))throw new System.ArgumentException("DirectX 属性名不合法");
    keys[key]=segment.Trim();
   }
   var removed=new System.Collections.Generic.HashSet<string>(remove??new string[0],System.StringComparer.OrdinalIgnoreCase);
   var result=new System.Collections.Generic.List<string>();
   foreach(string segment in (original??"").Split(';')) {
    if(segment.Length==0)continue;int equal=segment.IndexOf('=');string key=equal<0?"":segment.Substring(0,equal).Trim();
    if(!keys.ContainsKey(key)&&!removed.Contains(key))result.Add(segment);
   }
   foreach(var pair in keys)result.Add(pair.Value);
   return result.Count==0?"":System.String.Join(";",result.ToArray())+";";
  }
 }
}
