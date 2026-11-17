param([Parameter(Mandatory=$true)][int]$TargetProcessId, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PGDevelopmentIcon {
    public delegate bool EnumWindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr instance, string file, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr type, IntPtr icon, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
    public static IntPtr[] Windows(uint target) {
        var windows = new List<IntPtr>();
        EnumWindows((window, parameter) => {
            uint process;
            GetWindowThreadProcessId(window, out process);
            if (process == target) windows.Add(window);
            return true;
        }, IntPtr.Zero);
        var main = System.Diagnostics.Process.GetProcessById((int)target).MainWindowHandle;
        if (main != IntPtr.Zero && !windows.Contains(main)) windows.Add(main);
        return windows.ToArray();
    }
    public static IntPtr GetIcon(IntPtr window, int type) {
        IntPtr result;
        if (SendMessageTimeout(window, 0x7f, (IntPtr)type, IntPtr.Zero, 2, 500, out result) == IntPtr.Zero) return IntPtr.Zero;
        return result;
    }
    public static bool SetIcon(IntPtr window, int type, IntPtr icon) {
        IntPtr result;
        return SendMessageTimeout(window, 0x80, (IntPtr)type, icon, 2, 500, out result) != IntPtr.Zero;
    }
}
'@
$target = Get-Process -Id $TargetProcessId -ErrorAction Stop
$started = $target.StartTime
if ($target.ProcessName -ne 'project-graph-pg11') { throw '目标不是 PG 开发版进程。' }
if ($VerifyOnly) {
    [PGDevelopmentIcon]::Windows($TargetProcessId) | ForEach-Object {
        [pscustomobject]@{ ProcessId = $TargetProcessId; Window = $_.ToInt64(); LargeIcon = [PGDevelopmentIcon]::GetIcon($_, 1).ToInt64(); SmallIcon = [PGDevelopmentIcon]::GetIcon($_, 0).ToInt64() }
    } | ConvertTo-Json
    exit 0
}
$mutex = New-Object Threading.Mutex($false, "Local\PGDevelopmentIcon-$TargetProcessId")
$locked = $false
$large = [IntPtr]::Zero
$small = [IntPtr]::Zero
try {
    $locked = $mutex.WaitOne(0)
    if (!$locked) { exit 0 }
    $iconFile = Join-Path $PSScriptRoot 'icon.ico'
    $large = [PGDevelopmentIcon]::LoadImage([IntPtr]::Zero, $iconFile, 1, 32, 32, 0x10)
    $small = [PGDevelopmentIcon]::LoadImage([IntPtr]::Zero, $iconFile, 1, 16, 16, 0x10)
    if ($large -eq [IntPtr]::Zero -or $small -eq [IntPtr]::Zero) { throw '无法读取 PG 开发版图标。' }
    # Keep the icon owner alive and cover detached windows and later icon resets.
    while ($true) {
        $current = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
        if (!$current -or $current.StartTime -ne $started) { break }
        foreach ($window in [PGDevelopmentIcon]::Windows($TargetProcessId)) {
            if ([PGDevelopmentIcon]::GetIcon($window, 1) -ne $large) {
                if (![PGDevelopmentIcon]::SetIcon($window, 1, $large)) { Write-Warning "无法更新窗口 $window 的大图标，将重试。" }
            }
            if ([PGDevelopmentIcon]::GetIcon($window, 0) -ne $small) {
                if (![PGDevelopmentIcon]::SetIcon($window, 0, $small)) { Write-Warning "无法更新窗口 $window 的小图标，将重试。" }
            }
        }
        Start-Sleep -Seconds 2
    }
} finally {
    if ($large -ne [IntPtr]::Zero) { $null = [PGDevelopmentIcon]::DestroyIcon($large) }
    if ($small -ne [IntPtr]::Zero) { $null = [PGDevelopmentIcon]::DestroyIcon($small) }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
