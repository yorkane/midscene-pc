# Window lifecycle helpers for the win-node-app HTTP API.
# Uses -MemberDefinition (no here-string) so the file survives any line-ending transport.
param(
  [Parameter(Mandatory=$true)][string]$Action,
  [long]$Id = 0
)
$dq = [char]34
$lines = @()
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool ShowWindow(IntPtr h, int c);')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool SetForegroundWindow(IntPtr h);')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool IsIconic(IntPtr h);')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern IntPtr GetForegroundWindow();')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'kernel32.dll' + $dq + ')] public static extern uint GetCurrentThreadId();')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool AttachThreadInput(uint a, uint b, bool flag);')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);')
$lines += ('[System.Runtime.InteropServices.DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);')
Add-Type -Name W11Api -MemberDefinition ($lines -join ' ')
# Foreground-lock workaround: clear the SetForegroundWindow lock timeout.
[void][W11Api]::SystemParametersInfo(0x2001, 0, [IntPtr]::Zero, 0)
$h = [IntPtr]$Id
function Bring-Front([IntPtr]$hwnd) {
  [void][W11Api]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [void][W11Api]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  $fg = [W11Api]::GetForegroundWindow()
  $tidCur = [W11Api]::GetCurrentThreadId()
  $dummy = [uint32]0
  $tidFg = [W11Api]::GetWindowThreadProcessId($fg, [ref]$dummy)
  if ($tidFg -ne $tidCur) { [void][W11Api]::AttachThreadInput($tidCur, $tidFg, $true) }
  [void][W11Api]::SetForegroundWindow($hwnd)
  for ($i = 0; $i -lt 6; $i++) {
    if ([long][W11Api]::GetForegroundWindow() -eq [long]$hwnd) {
      if ($tidFg -ne $tidCur) { [void][W11Api]::AttachThreadInput($tidCur, $tidFg, $false) }
      return $true
    }
    Start-Sleep -Milliseconds 150
    [void][W11Api]::SetForegroundWindow($hwnd)
  }
  if ($tidFg -ne $tidCur) { [void][W11Api]::AttachThreadInput($tidCur, $tidFg, $false) }
  for ($i = 0; $i -lt 6; $i++) {
    [void][W11Api]::SwitchToThisWindow($hwnd, $true)
    Start-Sleep -Milliseconds 200
    if ([long][W11Api]::GetForegroundWindow() -eq [long]$hwnd) { return $true }
  }
  return (([long][W11Api]::GetForegroundWindow()) -eq [long]$hwnd)
}
switch ($Action) {
  'focus'      { [void][W11Api]::ShowWindow($h, 9); Write-Output (Bring-Front $h) }
  'minimize'   { [void][W11Api]::ShowWindow($h, 6); Write-Output 'True' }
  'restore'    { if ([W11Api]::IsIconic($h)) { [void][W11Api]::ShowWindow($h, 9) }; Write-Output (Bring-Front $h) }
  'foreground' { Write-Output ([long][W11Api]::GetForegroundWindow()) }
  default      { Write-Error ('unknown action ' + $Action); exit 2 }
}
