param([Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PGDevelopmentIcon {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr instance, string file, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr type, IntPtr icon, uint flags, uint timeout, out IntPtr result);
}
'@
$iconFile = Join-Path $PSScriptRoot 'icon.ico'
$large = [PGDevelopmentIcon]::LoadImage([IntPtr]::Zero, $iconFile, 1, 32, 32, 0x10)
$small = [PGDevelopmentIcon]::LoadImage([IntPtr]::Zero, $iconFile, 1, 16, 16, 0x10)
if ($large -eq [IntPtr]::Zero -or $small -eq [IntPtr]::Zero) { throw '无法读取 PG 开发版图标。' }
$deadline = (Get-Date).AddSeconds(120)
do {
    $process = Get-Process -Id $TargetProcessId -ErrorAction Stop
    $window = $process.MainWindowHandle
    if ($window -ne [IntPtr]::Zero -and $process.MainWindowTitle -like '*开发版*') {
        $result = [IntPtr]::Zero
        $null = [PGDevelopmentIcon]::SendMessageTimeout($window, 0x80, [IntPtr]1, $large, 2, 2000, [ref]$result)
        $null = [PGDevelopmentIcon]::SendMessageTimeout($window, 0x80, [IntPtr]0, $small, 2, 2000, [ref]$result)
        exit 0
    }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
throw '等待 PG 开发版窗口图标超时。'
