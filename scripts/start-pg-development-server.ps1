$ErrorActionPreference = 'Stop'
function Resolve-DevelopmentNode([string]$Directory, [string]$ConfiguredPath) {
    if (!$ConfiguredPath) { throw '开发版配置缺少Node运行环境路径。' }
    $node = if ([IO.Path]::IsPathRooted($ConfiguredPath)) { $ConfiguredPath } else { Join-Path $Directory $ConfiguredPath }
    if (!(Test-Path -LiteralPath $node) -and [IO.Path]::IsPathRooted($ConfiguredPath)) {
        # Old configs may point into a packaged application's virtual LOCALAPPDATA.
        $version = Split-Path (Split-Path $ConfiguredPath -Parent) -Leaf
        $node = Join-Path $Directory ('runtime\' + $version + '\node.exe')
    }
    if (!(Test-Path -LiteralPath $node -PathType Leaf)) { throw ('找不到开发版的Node运行环境：' + $node) }
    return (Resolve-Path -LiteralPath $node).ProviderPath
}
$mutex = New-Object Threading.Mutex($false, 'Local\ProjectGraphDevelopmentServer')
$locked = $false
try {
    $nativeProcessId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
    $iconScript = Join-Path $PSScriptRoot 'set-pg-development-icon.ps1'
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $iconScript + '"'), '-TargetProcessId', $nativeProcessId)
    $locked = $mutex.WaitOne(180000)
    if (!$locked) { throw '等待开发服务器启动超时。' }
    $config = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'development.json') | ConvertFrom-Json
    $workspace = (Resolve-Path -LiteralPath $config.workspace).ProviderPath
    $endpoint = 'http://localhost:1420/__pg_development'
    function Test-DevelopmentServer {
        try {
            $identity = Invoke-RestMethod $endpoint -TimeoutSec 3
            return [IO.Path]::GetFullPath($identity.workspace) -eq $workspace
        } catch { return $false }
    }
    if (Test-DevelopmentServer) { exit 0 }
    $port = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
    if ($port) { throw '开发端口1420已被其他程序占用，请联系Codex检查。' }
    $node = Resolve-DevelopmentNode $PSScriptRoot $config.nodeExecutable
    $logs = Join-Path $PSScriptRoot 'logs'
    $null = New-Item -ItemType Directory -Force -Path $logs
    $env:LR_PG_DEVELOPMENT_SESSION = '1'
    $vite = Join-Path $workspace 'app\node_modules\vite\bin\vite.js'
    $process = Start-Process -FilePath $node -ArgumentList ('"' + $vite + '" --host localhost') -WorkingDirectory (Join-Path $workspace 'app') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-errors.log') -PassThru
    $deadline = (Get-Date).AddSeconds(150)
    while ((Get-Date) -lt $deadline) {
        if (Test-DevelopmentServer) { exit 0 }
        if ($process.HasExited) { throw '开发服务器启动失败，请联系Codex检查开发版日志。' }
        Start-Sleep -Milliseconds 500
    }
    throw '开发服务器启动超时，请联系Codex检查。'
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    $null = [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Project Graph 开发版启动失败')
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
