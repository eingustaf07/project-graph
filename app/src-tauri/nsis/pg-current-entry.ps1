param(
    [Parameter(Mandatory=$true)][string]$ExecutablePath,
    [string]$DisplayName,
    [string]$ClassesRoot = 'HKCU:\Software\Classes',
    [string]$StateRoot = 'HKCU:\Software\ProjectGraphCustom',
    [string]$RegisteredApplicationsRoot = 'HKCU:\Software\RegisteredApplications',
    [string]$StartMenuDirectory = [Environment]::GetFolderPath('Programs'),
    [string]$PinnedDirectory = (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
)
$ErrorActionPreference = 'Stop'
$ExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).ProviderPath
if ([IO.Path]::GetFileName($ExecutablePath) -ne 'project-graph-pg11.exe') { throw 'Unexpected Project Graph executable.' }
if (!$DisplayName) { $DisplayName = [Diagnostics.FileVersionInfo]::GetVersionInfo($ExecutablePath).ProductName }
if (!$DisplayName -or $DisplayName -notlike 'Project Graph*') { throw 'Missing Project Graph product name.' }

if (!('PGEntryShell' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct PGPropertyKey { public Guid format; public uint id; public PGPropertyKey(uint id) { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); this.id = id; } }
[StructLayout(LayoutKind.Explicit, Size=24)] public struct PGPropertyValue { [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr text; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface PGPropertyStore {
 void GetCount(out uint count); void GetAt(uint index, out PGPropertyKey key); void GetValue(ref PGPropertyKey key, out PGPropertyValue value);
 void SetValue(ref PGPropertyKey key, ref PGPropertyValue value); void Commit();
}
public static class PGEntryShell {
 [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr context, uint flags, ref Guid iid, out PGPropertyStore store);
 [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern void SHChangeNotify(uint action, uint flags, string first, string second);
 public static void SetShortcutIdentity(string path, string displayName) {
  Guid iid = typeof(PGPropertyStore).GUID; PGPropertyStore store;
  Marshal.ThrowExceptionForHR(SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 2, ref iid, out store));
  try { Set(store,5,"eingustaf07.project-graph-pg11"); Set(store,4,displayName); store.Commit(); }
  finally { Marshal.ReleaseComObject(store); }
 }
 static void Set(PGPropertyStore store, uint id, string text) {
  var key = new PGPropertyKey(id); var value = new PGPropertyValue { type=31, text=Marshal.StringToCoTaskMemUni(text) };
  try { store.SetValue(ref key,ref value); } finally { Marshal.FreeCoTaskMem(value.text); }
 }
}
'@
}

function Set-EntryValue([string]$Path, [string]$Name, [string]$Value) {
    if (!(Test-Path -LiteralPath $Path)) { $null = New-Item -Path $Path -Force }
    if ($Name) { Set-ItemProperty -Path $Path -Name $Name -Value $Value }
    else { Set-Item -Path $Path -Value $Value }
}
$command = '"' + $ExecutablePath + '" "%1"'
$icon = '"' + $ExecutablePath + '",0'
$programId = 'ProjectGraph.Current.File'
Set-EntryValue $StateRoot 'CurrentExecutable' $ExecutablePath
Set-EntryValue $StateRoot 'DisplayName' $DisplayName
foreach ($id in @($programId, 'ProjectGraph.PG11.File', 'ProjectGraph.PG13.File', 'ProjectGraph.PG14.File')) {
    Set-EntryValue "$ClassesRoot\$id" '' ($DisplayName + ' ' + [char]0x9879 + [char]0x76ee)
    Set-EntryValue "$ClassesRoot\$id\shell\open\command" '' $command
    Set-EntryValue "$ClassesRoot\$id\DefaultIcon" '' $icon
}
Set-EntryValue "$ClassesRoot\.prg" '' $programId
if (!(Test-Path -LiteralPath "$ClassesRoot\.prg\OpenWithProgids")) { $null = New-Item -Path "$ClassesRoot\.prg\OpenWithProgids" -Force }
$null = New-ItemProperty -Path "$ClassesRoot\.prg\OpenWithProgids" -Name $programId -PropertyType None -Value ([byte[]]@()) -Force
Set-EntryValue "$ClassesRoot\Applications\project-graph-pg11.exe" 'FriendlyAppName' $DisplayName
Set-EntryValue "$ClassesRoot\Applications\project-graph-pg11.exe\shell\open\command" '' $command
$capabilities = $StateRoot + '\Capabilities'
Set-EntryValue $capabilities 'ApplicationName' $DisplayName
Set-EntryValue $capabilities 'ApplicationIcon' $icon
Set-EntryValue ($capabilities+'\FileAssociations') '.prg' $programId
Set-EntryValue $RegisteredApplicationsRoot 'Project Graph' $capabilities.Substring(6)

$shell = New-Object -ComObject WScript.Shell
$null = [IO.Directory]::CreateDirectory($StartMenuDirectory)
$currentLink = Join-Path $StartMenuDirectory 'Project Graph (Current).lnk'
$links = @($currentLink)
if (Test-Path -LiteralPath $PinnedDirectory) {
    foreach ($file in Get-ChildItem -LiteralPath $PinnedDirectory -Filter '*.lnk') {
        $link = $shell.CreateShortcut($file.FullName)
        if ([IO.Path]::GetFileName($link.TargetPath) -eq 'project-graph-pg11.exe') { $links += $file.FullName }
    }
}
foreach ($path in $links) {
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $ExecutablePath
    $link.WorkingDirectory = [IO.Path]::GetDirectoryName($ExecutablePath)
    $link.Arguments = ''
    $link.Description = $DisplayName
    $link.IconLocation = $ExecutablePath + ',0'
    $link.Save()
    [PGEntryShell]::SetShortcutIdentity($path,$DisplayName)
    [PGEntryShell]::SHChangeNotify(0x2000,5,$path,$null)
    if ((Split-Path $path -Parent) -eq $PinnedDirectory -and (Split-Path $path -Leaf) -ne ($DisplayName+'.lnk')) {
        $newPath = Join-Path $PinnedDirectory ($DisplayName+'.lnk')
        if (!(Test-Path -LiteralPath $newPath)) {
            # Shell rename keeps Explorer informed of its pinned shortcut's new name.
            $folder = (New-Object -ComObject Shell.Application).NameSpace($PinnedDirectory)
            $item = $folder.ParseName((Split-Path $path -Leaf))
            $item.Name = $DisplayName
            if (!(Test-Path -LiteralPath $newPath)) { throw 'Pinned shortcut rename failed.' }
            [PGEntryShell]::SHChangeNotify(1,5,$path,$newPath)
        }
    }
}
[PGEntryShell]::SHChangeNotify(0x08000000,0,$null,$null)
Write-Output ('Current Project Graph entry: ' + $DisplayName + ' -> ' + $ExecutablePath)
