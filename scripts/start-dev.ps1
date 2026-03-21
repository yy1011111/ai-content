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

$backendDir = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'

if (Test-PortListening -Port 3001) {
  Write-Host 'Backend is already listening on port 3001. Skipping.' -ForegroundColor Yellow
} else {
  Write-Host 'Starting backend dev server...' -ForegroundColor Cyan
  Start-Process powershell.exe -ArgumentList '-NoExit', '-Command', "Set-Location '$backendDir'; npm run start:dev" | Out-Null
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
