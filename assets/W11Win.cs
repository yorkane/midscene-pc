// Win32 window lifecycle helper for the midscene-pc Windows node app.
// Compiled on demand with the in-box .NET Framework csc (Add-Type -MemberDefinition
// silently produces no type on some minimal Windows images).
using System;
using System.Runtime.InteropServices;

public static class W11Win
{
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool flag);
    [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);

    private const uint SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001;
    private const int SW_SHOW = 5;
    private const int SW_MINIMIZE = 6;
    private const int SW_RESTORE = 9;

    private static string B(bool v) { return v ? "true" : "false"; }

    private static bool IsFront(IntPtr h)
    {
        return GetForegroundWindow() == h;
    }

    // Best-effort foreground acquisition: clear the foreground-lock timeout,
    // tap ALT, share input with the current foreground thread, then retry
    // SetForegroundWindow and finally SwitchToThisWindow.
    private static bool BringFront(IntPtr h)
    {
        SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, IntPtr.Zero, 0);
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        uint pid;
        uint tidCur = GetCurrentThreadId();
        uint tidFg = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        bool attached = false;
        if (tidFg != 0 && tidFg != tidCur) { attached = AttachThreadInput(tidCur, tidFg, true); }
        try
        {
            BringWindowToTop(h);
            SetForegroundWindow(h);
            for (int i = 0; i < 10; i++)
            {
                if (IsFront(h)) { return true; }
                System.Threading.Thread.Sleep(100);
                SetForegroundWindow(h);
            }
            for (int i = 0; i < 8; i++)
            {
                SwitchToThisWindow(h, true);
                System.Threading.Thread.Sleep(150);
                if (IsFront(h)) { return true; }
            }
        }
        finally
        {
            if (attached) { AttachThreadInput(tidCur, tidFg, false); }
        }
        return IsFront(h);
    }

    // Returns a single line of space-separated key=value pairs; never throws.
    public static string Run(string action, long id)
    {
        IntPtr h = new IntPtr(id);
        if (h == IntPtr.Zero) { return "error=id required"; }
        switch (action)
        {
            case "focus":
                if (IsIconic(h)) { ShowWindow(h, SW_RESTORE); } else { ShowWindow(h, SW_SHOW); }
                bool fok = BringFront(h);
                return "focus=" + B(fok) + " fg=" + GetForegroundWindow().ToInt64() + " iconic=" + B(IsIconic(h));
            case "minimize":
                ShowWindow(h, SW_MINIMIZE);
                for (int i = 0; i < 10; i++)
                {
                    if (IsIconic(h)) { break; }
                    System.Threading.Thread.Sleep(100);
                    ShowWindow(h, SW_MINIMIZE);
                }
                return "minimized=" + B(IsIconic(h));
            case "restore":
                ShowWindow(h, SW_RESTORE);
                bool rok = BringFront(h);
                return "restored=" + B(!IsIconic(h)) + " focus=" + B(rok) + " fg=" + GetForegroundWindow().ToInt64();
            case "foreground":
                return "fg=" + GetForegroundWindow().ToInt64();
            case "state":
                return "iconic=" + B(IsIconic(h)) + " visible=" + B(IsWindowVisible(h)) + " fg=" + GetForegroundWindow().ToInt64();
            default:
                return "error=unknown action " + action;
        }
    }
}
