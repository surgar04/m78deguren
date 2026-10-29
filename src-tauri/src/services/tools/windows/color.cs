// 真正的饱和度需要跨通道颜色矩阵，不能用三条独立 Gamma 曲线冒充。
// Windows Magnification 矩阵作用于整个桌面，因此界面明确标注全局范围。
namespace Zhenjing {
 public sealed class ColorMatrix:System.IDisposable {
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]struct Effect{[System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.ByValArray,SizeConst=25)]public float[] Values;}
  [System.Runtime.InteropServices.DllImport("Magnification.dll",SetLastError=true)]static extern bool MagInitialize();
  [System.Runtime.InteropServices.DllImport("Magnification.dll")]static extern bool MagUninitialize();
  [System.Runtime.InteropServices.DllImport("Magnification.dll",SetLastError=true)]static extern bool MagGetFullscreenColorEffect(out Effect effect);
  [System.Runtime.InteropServices.DllImport("Magnification.dll",SetLastError=true)]static extern bool MagSetFullscreenColorEffect(ref Effect effect);
  Effect original,last;bool initialized,changed;
  public ColorMatrix(){if(!MagInitialize())throw new System.ComponentModel.Win32Exception("系统不支持全桌面颜色矩阵");initialized=true;if(!MagGetFullscreenColorEffect(out original)){Dispose();throw new System.ComponentModel.Win32Exception("无法读取桌面颜色矩阵");}last=original;}
  public float[] Original{get{return (float[])original.Values.Clone();}}
  public static void RestoreSnapshot(float[] values){if(values==null||values.Length!=25)throw new System.ArgumentException("颜色矩阵备份维度无效");foreach(float value in values)if(System.Single.IsNaN(value)||System.Single.IsInfinity(value)||System.Math.Abs(value)>64)throw new System.ArgumentException("颜色矩阵备份超出范围");if(!MagInitialize())throw new System.ComponentModel.Win32Exception("无法初始化颜色恢复");try{Effect effect=new Effect{Values=values};if(!MagSetFullscreenColorEffect(ref effect))throw new System.ComponentModel.Win32Exception("无法恢复颜色矩阵备份");}finally{MagUninitialize();}}
  public void Saturation(double saturation){if(saturation<0||saturation>2||System.Double.IsNaN(saturation))throw new System.ArgumentException("饱和度参数无效");Effect current;if(!MagGetFullscreenColorEffect(out current))throw new System.InvalidOperationException("无法检查颜色矩阵状态");if(changed&&!Equal(current,last))throw new System.InvalidOperationException("颜色矩阵已被其他程序接管，已停止自动覆盖");
   float[] matrix=new float[25];double[] weight={0.2126,0.7152,0.0722};for(int row=0;row<3;row++)for(int column=0;column<3;column++)matrix[row*5+column]=(float)(weight[row]*(1-saturation)+(row==column?saturation:0));matrix[18]=1;matrix[24]=1;
   Effect effect=new Effect{Values=new float[25]};for(int row=0;row<5;row++)for(int column=0;column<5;column++)for(int k=0;k<5;k++)effect.Values[row*5+column]+=original.Values[row*5+k]*matrix[k*5+column];
   if(!MagSetFullscreenColorEffect(ref effect))throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error(),"系统拒绝全桌面饱和度设置");last=effect;changed=true;
  }
  static bool Equal(Effect a,Effect b){for(int i=0;i<25;i++)if(System.Math.Abs(a.Values[i]-b.Values[i])>0.00001)return false;return true;}
  public void Restore(){if(changed){Effect current;if(!MagGetFullscreenColorEffect(out current))throw new System.InvalidOperationException("无法验证颜色矩阵恢复");if(!Equal(current,last))throw new System.InvalidOperationException("颜色矩阵已被其他程序修改，保留其设置");if(!MagSetFullscreenColorEffect(ref original))throw new System.ComponentModel.Win32Exception("桌面颜色矩阵恢复失败");changed=false;}}
  public void Dispose(){try{Restore();}finally{if(initialized){MagUninitialize();initialized=false;}}}
 }
}
