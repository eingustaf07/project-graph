param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$DestinationDirectory
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\', '/')
$destinationRoot = [IO.Path]::GetFullPath($DestinationDirectory).TrimEnd('\', '/')
$comparison = [StringComparison]::OrdinalIgnoreCase
if ($sourceRoot.Equals($destinationRoot, $comparison) -or
    $sourceRoot.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, $comparison) -or
    $destinationRoot.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, $comparison)) {
    throw 'PG1.0 and PG1.1 profile directories must be separate.'
}

function Assert-NoReparsePoint([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Profile import does not follow links or junctions.'
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

Assert-NoReparsePoint $sourceRoot
Assert-NoReparsePoint $destinationRoot
$marker = Join-Path $destinationRoot 'pg11-profile-import-complete'
if (Test-Path -LiteralPath $marker) { return }

$files = @(
    'settings.json', 'keybinds2.json', 'quick-settings.json', 'colors.json',
    'tourials.json', 'start-files.json', 'recent-files2.json',
    'ai-mcp-servers.json', 'ai-chat-sessions.json', 'ai-skill-trust.json'
)
$pending = @()
foreach ($name in $files) {
    $source = Join-Path $sourceRoot $name
    $destination = Join-Path $destinationRoot $name
    Assert-NoReparsePoint $source
    Assert-NoReparsePoint $destination
    if ((Test-Path -LiteralPath $destination) -or !(Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $bytes = [IO.File]::ReadAllBytes($source)
    try {
        $jsonText = [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF)
        $null = ConvertFrom-Json -InputObject $jsonText -ErrorAction Stop
        if (!$jsonText.TrimStart().StartsWith('{')) { throw 'Expected a settings object.' }
    } catch {
        throw "PG1.0 settings file is not valid JSON: $name. The original file was not changed."
    }
    $pending += @{ Destination = $destination; Bytes = $bytes }
}

$extensions = Join-Path $sourceRoot 'extensions'
Assert-NoReparsePoint $extensions
if (Test-Path -LiteralPath $extensions -PathType Container) {
    foreach ($item in Get-ChildItem -LiteralPath $extensions -Recurse -Force) {
        Assert-NoReparsePoint $item.FullName
        if ($item.PSIsContainer) { continue }
        $relative = $item.FullName.Substring($sourceRoot.Length + 1)
        $destination = Join-Path $destinationRoot $relative
        Assert-NoReparsePoint $destination
        if (!(Test-Path -LiteralPath $destination)) {
            $pending += @{ Destination = $destination; Bytes = [IO.File]::ReadAllBytes($item.FullName) }
        }
    }
}

function Write-NewFile([string]$Destination, [byte[]]$Bytes) {
    Assert-NoReparsePoint $Destination
    if (Test-Path -LiteralPath $Destination) { return }
    $parent = [IO.Path]::GetDirectoryName($Destination)
    $null = [IO.Directory]::CreateDirectory($parent)
    $temporary = Join-Path $parent ('.pg11-import-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        [IO.File]::Move($temporary, $Destination)
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

foreach ($entry in $pending) { Write-NewFile $entry.Destination $entry.Bytes }
Write-NewFile $marker ([Text.Encoding]::UTF8.GetBytes('PG1.0 settings copied without changing source files.'))

