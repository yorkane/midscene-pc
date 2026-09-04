# Window lifecycle helpers for the win-node-app HTTP API.
# Usage: powershell -File win-window-fn.ps1 -Action focus|minimize|restore|foreground -Id <hwnd>
param(
  [Parameter(Mandatory=$true)][string]$Action,
  [long]$Id = 0
)
# -MemberDefinition 形式（无 here-string），文件经过任何换行/编码传输都不会碎
$dq = [char]34
$lines = @()
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool ShowWindow(IntPtr h, int c);')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool SetForegroundWindow(IntPtr h);')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern bool IsIconic(IntPtr h);')
$lines += ('[DllImport(' + $dq + 'user32.dll' + $dq + ')] public static extern IntPtr GetForegroundWindow();')
Add-Type -Name W11Api -MemberDefinition ($lines -join ' ')
$h = [IntPtr]$Id
switch ($Action) {
  'focus'      { [void][W11Api]::ShowWindow($h, 9); Write-Output ([W11Api]::SetForegroundWindow($h)) }
  'minimize'   { [void][W11Api]::ShowWindow($h, 6); Write-Output 'True' }
  'restore'    { if ([W11Api]::IsIconic($h)) { [void][W11Api]::ShowWindow($h, 9) }; [void][W11Api]::SetForegroundWindow($h); Write-Output 'True' }
  'foreground' { Write-Output ([long][W11Api]::GetForegroundWindow()) }
  default      { Write-Error ('unknown action ' + $Action); exit 2 }
}
