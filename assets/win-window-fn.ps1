# Window lifecycle helper for the win-node-app HTTP API (thin loader).
# The actual Win32 code lives in W11Win.cs and is compiled with the in-box .NET
# Framework csc on first use: Add-Type -MemberDefinition silently produces no type
# on minimal images (Tiny11), while Add-Type -Path only loads a precompiled assembly.
param(
  [Parameter(Mandatory=$true)][string]$Action,
  [long]$Id = 0
)
$cs = Join-Path $PSScriptRoot 'W11Win.cs'
if (-not (Test-Path $cs)) { Write-Output ('error=missing ' + $cs); exit 2 }
$dll = Join-Path $env:TEMP 'midscene-pc-W11Win.dll'
if ((-not (Test-Path $dll)) -or ((Get-Item $dll).LastWriteTime -lt (Get-Item $cs).LastWriteTime)) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
  if (-not (Test-Path $csc)) { Write-Output 'error=csc.exe not found'; exit 3 }
  if (Test-Path $dll) { Remove-Item $dll -Force }
  $co = & $csc /nologo /target:library /out:$dll $cs 2>&1
  if (-not (Test-Path $dll)) { Write-Output ('error=compile failed: ' + (($co | Select-Object -First 2) -join ' ; ')); exit 4 }
}
Add-Type -Path $dll
[W11Win]::Run($Action, $Id)
