// 一次提交完整的按下/抬起对；失败也尝试释放，不向游戏进程注入模块。
using System;
using System.Runtime.InteropServices;
public static class ZhenjingClicker {
    [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public IntPtr Extra; }
    [StructLayout(LayoutKind.Explicit, Size=40)] public struct Input { [FieldOffset(0)] public uint Type; [FieldOffset(8)] public Mouse Mouse; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    public static bool Click(bool right) {
        Input down = new Input(); Input up = new Input();
        down.Mouse.Flags = right ? 8u : 2u; up.Mouse.Flags = right ? 16u : 4u;
        uint sent=SendInput(2, new Input[]{down,up}, 40);
        if(sent!=2)SendInput(1,new Input[]{up},40);
        return sent==2;
    }
    public static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    public static System.Threading.Tasks.Task<string> ReadCommand() { return System.Threading.Tasks.Task.Run(() => Console.ReadLine()); }
}
