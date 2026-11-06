$ErrorActionPreference = 'Stop'
$testId = 'PGEntryTest-' + [Guid]::NewGuid().ToString('N')
$directory = Join-Path $env:TEMP $testId
$registry = 'HKCU:\Software\' + $testId
$null = New-Item -ItemType Directory -Path $directory
try {
    $pinned = Join-Path $directory 'Pinned'
    $menu = Join-Path $directory 'Menu'
    $null = New-Item -ItemType Directory -Path $pinned
    $shell = New-Object -ComObject WScript.Shell
    $null = New-Item -Path ($registry+'\Classes\.prg\OpenWithProgids') -Force
    $null = New-ItemProperty -Path ($registry+'\Classes\.prg\OpenWithProgids') -Name 'Unrelated.File' -PropertyType None -Value ([byte[]]@())
    $shortcut = Join-Path $pinned 'Project Graph PG1.lnk'
    foreach ($version in @('1.4','1.5')) {
        $install = Join-Path $directory ('PG' + $version)
        $null = New-Item -ItemType Directory -Path $install
        $exe = Join-Path $install 'project-graph-pg11.exe'
        [IO.File]::WriteAllBytes($exe,[byte[]]@())
        if ($version -eq '1.4') {
            $link = $shell.CreateShortcut($shortcut)
            $link.TargetPath = $exe
            $link.Save()
        }
        & (Join-Path $PSScriptRoot 'pg-current-entry.ps1') -ExecutablePath $exe -DisplayName ('Project Graph PG' + $version) -ClassesRoot ($registry+'\Classes') -StateRoot ($registry+'\Current') -RegisteredApplicationsRoot ($registry+'\RegisteredApps') -PinnedDirectory $pinned -StartMenuDirectory $menu
        $shortcut = Join-Path $pinned ('Project Graph PG'+$version+'.lnk')
        foreach ($id in @('ProjectGraph.Current.File','ProjectGraph.PG11.File','ProjectGraph.PG13.File','ProjectGraph.PG14.File')) {
            $command = (Get-Item ($registry+'\Classes\'+$id+'\shell\open\command')).GetValue('')
            if ($command -ne ('"'+$exe+'" "%1"')) { throw 'Association did not follow upgrade.' }
        }
        if ((Get-ItemProperty ($registry+'\Current')).CurrentExecutable -ne $exe) { throw 'Current entry stale.' }
        if ($shell.CreateShortcut($shortcut).TargetPath -ne $exe) { throw 'Pinned entry stale.' }
        $item = (New-Object -ComObject Shell.Application).NameSpace($pinned).ParseName((Split-Path $shortcut -Leaf))
        if ($item.ExtendedProperty('System.AppUserModel.ID') -ne 'eingustaf07.project-graph-pg11') { throw 'Pinned application identity stale.' }
        if ($item.ExtendedProperty('System.AppUserModel.RelaunchDisplayNameResource') -ne ('Project Graph PG'+$version)) { throw 'Pinned display name stale.' }
        if (!((Get-Item ($registry+'\Classes\.prg\OpenWithProgids')).GetValueNames() -contains 'Unrelated.File')) { throw 'Other file associations were removed.' }
        if ($shell.CreateShortcut((Join-Path $menu 'Project Graph (Current).lnk')).TargetPath -ne $exe) { throw 'Start menu entry stale.' }
    }
    Write-Output 'PASS: upgrade updates current entry, legacy associations, pinned link and start menu link.'
} finally {
    # Delete only the uniquely named test fixture created above.
    if ((Split-Path $registry -Leaf) -eq $testId) { Remove-Item -LiteralPath $registry -Recurse -Force -ErrorAction SilentlyContinue }
    if ((Split-Path $directory -Leaf) -eq $testId) { Remove-Item -LiteralPath $directory -Recurse -Force }
}
