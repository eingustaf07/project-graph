$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'start-pg-development-server.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Development launcher contains syntax errors.' }
$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-DevelopmentNode' }, $true)
. ([scriptblock]::Create($function.Extent.Text))
$directory = Join-Path $env:TEMP ('PG-node-resolution-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path (Join-Path $directory 'runtime\node-v26-test') -Force
$node = Join-Path $directory 'runtime\node-v26-test\node.exe'
[IO.File]::WriteAllBytes($node, [byte[]]@())
try {
    if ((Resolve-DevelopmentNode $directory 'runtime\node-v26-test\node.exe') -ne $node) { throw 'Relative runtime path failed.' }
    if ((Resolve-DevelopmentNode $directory $node) -ne $node) { throw 'Existing absolute runtime path failed.' }
    $old = Join-Path $directory 'old-install\runtime\node-v26-test\node.exe'
    if ((Resolve-DevelopmentNode $directory $old) -ne $node) { throw 'Legacy virtualized path recovery failed.' }
    $rejected = $false
    try { Resolve-DevelopmentNode $directory 'runtime\missing\node.exe' | Out-Null } catch { $rejected = $true }
    if (!$rejected) { throw 'Missing runtime must fail explicitly.' }
    'PASS: relative, absolute, legacy redirected and missing Node paths.'
} finally {
    Remove-Item -LiteralPath $node
    $version = Join-Path $directory 'runtime\node-v26-test'
    [IO.Directory]::Delete($version)
    [IO.Directory]::Delete((Join-Path $directory 'runtime'))
    [IO.Directory]::Delete($directory)
}
