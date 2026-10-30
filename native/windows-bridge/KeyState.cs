// 固定键状态查询，供按住显示功能复用；不在运行时编译，也不安装驱动。
public static class ZhenjingInput {
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int key);
}
