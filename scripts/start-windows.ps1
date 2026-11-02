# Start Flockence on a Windows PC for testing: database, camera service, app, browser.
#
#   cd D:\Flockence\chicken-op
#   powershell -ExecutionPolicy Bypass -File scripts\start-windows.ps1
#
# Options:
#   -Rebuild      build the app again (do this after every "git pull")
#   -Port 3001    the app's port (3000 belongs to another app on this PC)
#   -NoCameras    do not start the camera service
#
# Settings come from .env in this folder (never typed here, never printed). The app listens on 127.0.0.1 only,
# so nothing else on your network can reach it.
param(
  [switch]$Rebuild,
  [int]$Port = 3001,
  [switch]$NoCameras
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }

if (-not (Test-Path ".env")) { Fail "No .env file in $root. Copy .env.example to .env and fill it in first." }

# Load .env into this window's environment, so the camera service gets the same token as the app.
Get-Content ".env" | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
    $name, $value = $line.Split("=", 2)
    $value = $value.Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($name.Trim(), $value, "Process")
  }
}
if (-not $env:AUTH_SECRET -or $env:AUTH_SECRET.Length -lt 32) { Fail "AUTH_SECRET in .env must be at least 32 characters." }
$env:AUTH_COOKIE_SECURE = "true"
$env:NODE_ENV = "production"

# 1. Database (Docker)
Say "Starting the database (Docker container flockence-postgres-dev)"
$dockerOk = $true
try { docker start flockence-postgres-dev 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { $dockerOk = $false } } catch { $dockerOk = $false }
if (-not $dockerOk) {
  Fail "Docker did not start the database. Open Docker Desktop and wait until it says it is running, then run this again. If it still fails, run: docker ps -a   and send Claude the list."
}
Start-Sleep -Seconds 3

# 2. Camera service
if (-not $NoCameras) {
  $venv = Join-Path $root "services\blink\.venv\Scripts\python.exe"
  if (-not (Test-Path $venv)) {
    Write-Host "    The camera service is not installed here (services\blink\.venv); starting without cameras." -ForegroundColor Yellow
  } elseif (-not $env:BLINK_SIDECAR_TOKEN) {
    Write-Host "    BLINK_SIDECAR_TOKEN is not set in .env; starting without cameras." -ForegroundColor Yellow
  } else {
    Say "Starting the camera service in its own window (127.0.0.1:8765)"
    Start-Process powershell -ArgumentList @(
      "-NoExit", "-Command",
      "Set-Location '$root\services\blink'; .\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8765"
    ) | Out-Null
  }
}

# 3. Build (first time, or when asked)
if ($Rebuild -or -not (Test-Path ".next\BUILD_ID")) {
  # New tables (for example the thermometer readings) are added to the local test database; nothing is deleted.
  Say "Updating the local database tables"
  npx prisma db push
  if ($LASTEXITCODE -ne 0) { Fail "The database could not be updated. Copy the red lines above and send them to Claude." }
  Say "Building the app (a few minutes the first time)"
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail "The build failed. Copy the red lines above and send them to Claude." }
}

# 4. App, then the browser once it answers
Say "Starting Flockence on http://127.0.0.1:$Port (keep this window open; Ctrl+C stops it)"
Start-Job -ScriptBlock {
  param($p)
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$p/login" -TimeoutSec 2 | Out-Null; Start-Process "http://127.0.0.1:$p"; return } catch { Start-Sleep -Seconds 1 }
  }
} -ArgumentList $Port | Out-Null
npm run start -- -H 127.0.0.1 -p $Port
