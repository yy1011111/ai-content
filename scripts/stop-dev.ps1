$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

function Stop-PortProcess {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $processIds = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  if (-not $processIds) {
    Write-Host "No listening process found on port $Port." -ForegroundColor Yellow
    return
  }

  foreach ($processId in $processIds) {
    if ($processId -eq $PID) {
      continue
    }

    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-Host "Stopped process PID=$processId on port $Port." -ForegroundColor Green
    } catch {
      Write-Warning "Failed to stop PID=${processId}: $($_.Exception.Message)"
    }
  }
}

Write-Host 'Stopping frontend and backend dev processes...' -ForegroundColor Cyan
Stop-PortProcess -Port 3000
Stop-PortProcess -Port 3001

Write-Host 'Stopping PostgreSQL and Redis...' -ForegroundColor Cyan
Push-Location $projectRoot
try {
  docker compose down
} finally {
  Pop-Location
}

Write-Host 'Local dev services are stopped.' -ForegroundColor Green
