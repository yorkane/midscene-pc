# Window lifecycle helpers for the win-node-app HTTP API.
param(
  [Parameter(Mandatory=$true)][string]$Action,
  [long]$Id = 0
)
$dq = [char]34
$lines = @()
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool ShowWindow(IntPtr h, int c);')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool SetForegroundWindow(IntPtr h);')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool IsIconic(IntPtr h);')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern IntPtr GetForegroundWindow();')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);')
$lines += ('[DllImport(' + $dq + 'kernel32.dll' + $dq + ')] public static extern uint GetCurrentThreadId();')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool AttachThreadInput(uint a, uint b, bool flag);')
Add-Type -Name W11Api -MemberDefinition ($lines -join ' ')
$h = [IntPtr]$Id
function Bring-Front([IntPtr]$hwnd) {
  # 前台锁规避：模拟一次 ALT 按下+释放，再把调用线程输入队列附加到前台线程
  [void][W11Api]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [void][W11Api]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  $fg = [W11Api]::GetForegroundWindow()
  $tidCur = [W11Api]::GetCurrentThreadId()
  $tidFg = [W11Api]::GetWindowThreadProcessId($fg, [ref]([uint32]0))
  if ($tidFg -ne $tidCur) { [void][W11Api]::AttachThreadInput($tidCur, $tidFg, $true) }
  $ok = [W11Api]::SetForegroundWindow($hwnd)
  if ($tidFg -ne $tidCur) { [void][W11Api]::AttachThreadInput($tidCur, $tidFg, $false) }
  for ($i = 0; $i -lt 10; $i++) {
    if ([long][W11Api]::GetForegroundWindow() -eq [long]$hwnd) { return $true }
    Start-Sleep -Milliseconds 200
    [void][W11Api]::SetForegroundWindow($hwnd)
  }
  return ($ok -and (([long][W11Api]::GetForegroundWindow()) -eq [long]$hwnd))
}
switch ($Action) {
  'focus'      { [void][W11Api]::ShowWindow($h, 9); Write-Output (Bring-Front $h) }
  'minimize'   { [void][W11Api]::ShowWindow($h, 6); Write-Output 'True' }
  'restore'    { if ([W11Api]::IsIconic($h)) { [void][W11Api]::ShowWindow($h, 9) }; Write-Output (Bring-Front $h) }
  'foreground' { Write-Output ([long][W11Api]::GetForegroundWindow()) }
  default      { Write-Error ('unknown action ' + $Action); exit 2 }
}
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);')
Add-Type -Name W11Api -MemberDefinition ($lines -join ' ')
# 解除前台锁：把 SetForegroundWindow 锁定时长清零（本会话内生效）
[void][W11Api]::SystemParametersInfo(0x2001, 0, [IntPtr]::Zero, 0)
