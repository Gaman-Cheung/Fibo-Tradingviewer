param(
    [ValidateSet('smoke','daily','backfill','repair')]
    [string]$Mode = 'daily',
    [string]$StartDate = '',
    [string]$EndDate = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repoRoot '.env.local'
$configTemplate = Join-Path $repoRoot '.env.local.example'
$venvPath = Join-Path $repoRoot '.venv'
$venvPython = Join-Path $venvPath 'Scripts\python.exe'
$requirements = Join-Path $PSScriptRoot 'requirements.txt'
$syncScript = Join-Path $PSScriptRoot 'sync_baostock.py'

function Stop-Sync([string]$message, [int]$code = 1) {
    Write-Host "[ERROR] $message" -ForegroundColor Red
    exit $code
}

function Import-LocalEnvironment([string]$path) {
    foreach ($rawLine in Get-Content -LiteralPath $path -Encoding UTF8) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) { Stop-Sync "Invalid line in .env.local: $rawLine" }
        $name = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

function Start-NativeProcess([string]$filePath, [string[]]$arguments) {
    $process = Start-Process -FilePath $filePath -ArgumentList $arguments -NoNewWindow -Wait -PassThru
    return $process.ExitCode
}

try {
    Set-Location -LiteralPath $repoRoot
    Write-Host '=== Fibo TradingViewer - BaoStock Full-Market Sync ===' -ForegroundColor Cyan

    if ($Mode -eq 'repair' -and (-not $StartDate -or -not $EndDate)) {
        Stop-Sync 'Repair mode requires: SyncBaoStock.cmd repair YYYY-MM-DD YYYY-MM-DD'
    }

    if ($Mode -ne 'smoke' -and -not (Test-Path -LiteralPath $configPath)) {
        Copy-Item -LiteralPath $configTemplate -Destination $configPath
        Write-Host '[SETUP] Created .env.local. Fill in the two Supabase values, save it, then run again.' -ForegroundColor Yellow
        Start-Process -FilePath 'notepad.exe' -ArgumentList $configPath
        exit 2
    }

    if (Test-Path -LiteralPath $configPath) { Import-LocalEnvironment $configPath }
    if ($Mode -ne 'smoke') {
        $supabaseUrl = [Environment]::GetEnvironmentVariable('SUPABASE_URL', 'Process')
        $serviceKey = [Environment]::GetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY', 'Process')
        if (-not $supabaseUrl -or $supabaseUrl -notmatch '^https://.+\.supabase\.co/?$' -or $supabaseUrl -match 'YOUR_PROJECT') {
            Stop-Sync 'SUPABASE_URL in .env.local is missing or invalid.'
        }
        if (-not $serviceKey -or $serviceKey -match 'PASTE_YOUR_' -or $serviceKey.Length -lt 20) {
            Stop-Sync 'SUPABASE_SERVICE_ROLE_KEY in .env.local is missing or invalid.'
        }
    }

    if (-not (Test-Path -LiteralPath $venvPython)) {
        $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($launcher) {
            Write-Host '[SETUP] Creating the local Python environment...'
            $setupExit = Start-NativeProcess $launcher.Source @('-3', '-m', 'venv', ('"' + $venvPath + '"'))
        } else {
            $launcher = Get-Command python.exe -ErrorAction SilentlyContinue
            if (-not $launcher) { Stop-Sync 'Python 3 is not installed. Install Python 3 and enable Add Python to PATH.' }
            Write-Host '[SETUP] Creating the local Python environment...'
            $setupExit = Start-NativeProcess $launcher.Source @('-m', 'venv', ('"' + $venvPath + '"'))
        }
        if ($setupExit -ne 0 -or -not (Test-Path -LiteralPath $venvPython)) { Stop-Sync 'Could not create .venv.' }
    }

    Write-Host '[SETUP] Verifying BaoStock 0.9.3 dependencies...'
    $installExit = Start-NativeProcess $venvPython @('-m', 'pip', 'install', '--disable-pip-version-check', '-r', ('"' + $requirements + '"'))
    if ($installExit -ne 0) { Stop-Sync "Dependency installation failed with code $installExit." }

    $env:PYTHONUTF8 = '1'
    Write-Host "[SYNC] Running shared mode: $Mode" -ForegroundColor Cyan
    $syncArguments = @(('"' + $syncScript + '"'), '--mode', $Mode, '--sessions', '400')
    if ($Mode -eq 'repair') { $syncArguments += @('--start', $StartDate, '--end', $EndDate) }
    $syncExit = Start-NativeProcess $venvPython $syncArguments
    if ($syncExit -ne 0) { Stop-Sync "sync_baostock.py exited with code $syncExit." }

    if ($Mode -eq 'smoke') {
        Write-Host '[OK] BaoStock connectivity and QFQ reconstruction passed. Supabase was not used.' -ForegroundColor Green
    } else {
        Write-Host '[OK] Full-market rows were uploaded directly to Supabase.' -ForegroundColor Green
    }
    exit 0
} catch {
    Stop-Sync $_.Exception.Message
}
