$ErrorActionPreference = 'Stop'
$taskRoot = Join-Path $PSScriptRoot ('profile-test-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($taskRoot)
$script = Join-Path $PSScriptRoot 'pg11-import-profile.ps1'
function Assert-True([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
try {
    $source = Join-Path $taskRoot 'PG1.0'
    $destination = Join-Path $taskRoot 'PG1.1'
    $null = [IO.Directory]::CreateDirectory($source)
    $null = [IO.Directory]::CreateDirectory($destination)
    [IO.File]::WriteAllText((Join-Path $source 'settings.json'), '{"aiApiKey":"fixture-only","textNodeMaxWidth":15}')
    [IO.File]::WriteAllText((Join-Path $source 'keybinds2.json'), '{"delete":{"key":"Backspace","isEnabled":true}}')
    [IO.File]::WriteAllText((Join-Path $source 'colors.json'), '{"source":true}')
    [IO.File]::WriteAllText((Join-Path $destination 'colors.json'), '{"existing":true}')
    [IO.File]::WriteAllText((Join-Path $source 'chatgpt-auth.dpapi'), 'do-not-copy')
    [IO.File]::WriteAllText((Join-Path $source 'unrelated.prg'), 'do-not-copy')
    [IO.File]::WriteAllText((Join-Path $source 'user.json'), '{"session":{"token":"do-not-copy"}}')
    $extension = Join-Path $source 'extensions\fixture'
    $null = [IO.Directory]::CreateDirectory($extension)
    [IO.File]::WriteAllText((Join-Path $extension 'main.js'), 'fixture extension')
    $before = (Get-FileHash -LiteralPath (Join-Path $source 'settings.json')).Hash
    & $script -SourceDirectory $source -DestinationDirectory $destination
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $destination 'settings.json')).Hash -eq $before) 'Settings bytes changed during copy.'
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $source 'settings.json')).Hash -eq $before) 'PG1.0 source was changed.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $destination 'keybinds2.json')).Contains('Backspace')) 'Shortcut configuration was lost.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $destination 'colors.json')) -eq '{"existing":true}') 'Existing PG1.1 settings were overwritten.'
    Assert-True (!(Test-Path -LiteralPath (Join-Path $destination 'chatgpt-auth.dpapi'))) 'Authentication material was imported.'
    Assert-True (!(Test-Path -LiteralPath (Join-Path $destination 'unrelated.prg'))) 'Project file was imported.'
    Assert-True (!(Test-Path -LiteralPath (Join-Path $destination 'user.json'))) 'Legacy login session was imported.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $destination 'extensions\fixture\main.js')) -eq 'fixture extension') 'Installed extension was lost.'
    [IO.File]::WriteAllText((Join-Path $destination 'settings.json'), '{"userChanged":true}')
    Remove-Item -LiteralPath (Join-Path $destination 'keybinds2.json')
    & $script -SourceDirectory $source -DestinationDirectory $destination
    Assert-True ([IO.File]::ReadAllText((Join-Path $destination 'settings.json')) -eq '{"userChanged":true}') 'Reinstallation overwrote user settings.'
    Assert-True (!(Test-Path -LiteralPath (Join-Path $destination 'keybinds2.json'))) 'Repeated import restored intentionally removed settings.'
    $invalid = Join-Path $taskRoot 'invalid-source'
    $invalidDestination = Join-Path $taskRoot 'invalid-destination'
    $null = [IO.Directory]::CreateDirectory($invalid)
    [IO.File]::WriteAllText((Join-Path $invalid 'settings.json'), '{invalid secret-fixture')
    $rejected = $false
    try { & $script -SourceDirectory $invalid -DestinationDirectory $invalidDestination } catch {
        $rejected = $true
        Assert-True (!$_.ToString().Contains('secret-fixture')) 'An error disclosed setting contents.'
    }
    Assert-True $rejected 'Invalid settings were accepted.'
    Assert-True (!(Test-Path -LiteralPath (Join-Path $invalidDestination 'pg11-profile-import-complete'))) 'Failed import was marked complete.'
    $rejected = $false
    try { & $script -SourceDirectory $source -DestinationDirectory $source } catch { $rejected = $true }
    Assert-True $rejected 'Same source and destination were accepted.'
    $rejected = $false
    try { & $script -SourceDirectory $source -DestinationDirectory (Join-Path $source 'nested') } catch { $rejected = $true }
    Assert-True $rejected 'Nested profile destination was accepted.'
    Write-Output 'PASS: exact settings copy, original preservation, shortcuts, no overwrite, one-time import, credential exclusion, invalid JSON, path isolation.'
} finally {
    $resolved = [IO.Path]::GetFullPath($taskRoot)
    $allowed = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notmatch '^profile-test-[0-9a-f]{32}$') {
        throw 'Refusing to clean an unexpected test directory.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

