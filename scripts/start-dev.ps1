$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

function Test-Command {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-PortListening {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-ForPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [int]$TimeoutSeconds = 60,
    [int]$IntervalSeconds = 2
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortListening -Port $Port) {
      return $true
    }

    Start-Sleep -Seconds $IntervalSeconds
  }

  return $false
}

if (-not (Test-Command -Name 'docker')) {
  throw 'docker command not found. Please start Docker Desktop first.'
}

Write-Host 'Starting PostgreSQL and Redis...' -ForegroundColor Cyan
Push-Location $projectRoot
try {
  docker compose up -d
} finally {
  Pop-Location
}

Write-Host 'Waiting for PostgreSQL (5432)...' -ForegroundColor Cyan
if (-not (Wait-ForPort -Port 5432 -TimeoutSeconds 90)) {
  throw 'PostgreSQL did not become ready on port 5432. Please confirm Docker Desktop is fully started.'
}

Write-Host 'Waiting for Redis (6379)...' -ForegroundColor Cyan
if (-not (Wait-ForPort -Port 6379 -TimeoutSeconds 90)) {
  throw 'Redis did not become ready on port 6379. Please confirm Docker Desktop is fully started.'
}

$backendDir = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'

if (Test-PortListening -Port 3001) {
  Write-Host 'Backend is already listening on port 3001. Skipping.' -ForegroundColor Yellow
} else {
  Write-Host 'Starting backend dev server...' -ForegroundColor Cyan
  Start-Process powershell.exe -ArgumentList '-NoExit', '-Command', "Set-Location '$backendDir'; npm run start:dev" | Out-Null

  if (-not (Wait-ForPort -Port 3001 -TimeoutSeconds 30 -IntervalSeconds 1)) {
    throw 'Backend did not start on port 3001. Please check the backend terminal window for the exact error.'
  }
}

if (Test-PortListening -Port 3000) {
  Write-Host 'Frontend is already listening on port 3000. Skipping.' -ForegroundColor Yellow
} else {
  Write-Host 'Starting frontend dev server...' -ForegroundColor Cyan
  Start-Process powershell.exe -ArgumentList '-NoExit', '-Command', "Set-Location '$frontendDir'; npm run dev" | Out-Null
}

Write-Host ''
Write-Host 'Startup commands were sent.' -ForegroundColor Green
Write-Host 'Frontend: http://localhost:3000'
Write-Host 'Backend: http://localhost:3001/api'
