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
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool flag);
    [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    private delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] private static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId2(IntPtr h, out uint p);
    private static System.Text.StringBuilder _enumSink;
    private static int _enumTotal;
    private static bool EnumCb(IntPtr h, IntPtr l)
    {
        if (!IsWindowVisible(h)) { return true; }
        _enumTotal++;
        var t = new System.Text.StringBuilder(256);
        GetWindowTextW(h, t, 256);
        string title = t.ToString();
        if (title.Length == 0) { return true; }
        uint pid = 0; GetWindowThreadProcessId2(h, out pid);
        _enumSink.Append((long)h).Append('|').Append(title.Replace(' ', '_')).Append(';');
        return true;
    }

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
    // un-minimize, then retry SetForegroundWindow a few times.
    //
    // Hard-earned lesson from a real Win11(Tiny11) VM: ALT-key injection,
    // AttachThreadInput and SwitchToThisWindow all *look* effective in the
    // moment (GetForegroundWindow briefly returns the target) but leave the
    // Chromium top-level hidden and the desktop foreground stuck at 0 seconds
    // later. The gentle sequence is slightly less aggressive and does not
    // corrupt the caller's view of the desktop.
    private static bool BringFront(IntPtr h)
    {
        SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, IntPtr.Zero, 0);
        if (IsIconic(h)) { ShowWindow(h, SW_RESTORE); } else { ShowWindow(h, SW_SHOW); }
        BringWindowToTop(h);
        SetForegroundWindow(h);
        for (int i = 0; i < 10; i++)
        {
            if (IsFront(h)) { return true; }
            System.Threading.Thread.Sleep(100);
            SetForegroundWindow(h);
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
            case "list":
            {
                // Independent enumerator: tells "window really gone" apart from
                // "some library's window enumeration broke".
                _enumSink = new System.Text.StringBuilder();
                _enumTotal = 0;
                EnumWindows(EnumCb, IntPtr.Zero);
                return "total=" + _enumTotal + " named=" + _enumSink.ToString();
            }
            case "close":
                // WM_CLOSE: polite close (same as the X button), no force-kill.
                PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
                for (int i = 0; i < 10; i++)
                {
                    if (!IsWindow(h)) { return "closed=true"; }
                    System.Threading.Thread.Sleep(150);
                }
                return "closed=" + B(!IsWindow(h));
            case "state":
                return "iconic=" + B(IsIconic(h)) + " visible=" + B(IsWindowVisible(h)) + " fg=" + GetForegroundWindow().ToInt64();
            default:
                return "error=unknown action " + action;
        }
    }
}
