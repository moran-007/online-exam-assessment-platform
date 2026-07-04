param(
  [switch]$KeepPostgres,
  [string]$PostgresBin = $env:POSTGRES_BIN_DIR,
  [string]$PostgresData = $env:POSTGRES_DATA_DIR
)

$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root "runtime"

function Resolve-PostgresBin($ConfiguredBin) {
  $candidates = @()
  if ($ConfiguredBin) { $candidates += $ConfiguredBin }
  $candidates += @(
    "D:\PostgreSQL\pgsql\bin",
    "D:\PostgreSQL\bin"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path (Join-Path $candidate "pg_ctl.exe"))) {
      return $candidate
    }
  }

  $pgCtl = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  if ($pgCtl) {
    return Split-Path -Parent $pgCtl.Source
  }

  return $null
}

function Stop-Port($Port) {
  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
  foreach ($connection in $connections) {
    $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "unknown" }
    Write-Host "Stopping process on port ${Port}: PID $($connection.OwningProcess) ($name)"
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

foreach ($name in @("frontend", "backend")) {
  $pidFile = Join-Path $Runtime "$name.pid"
  if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile | Select-Object -First 1
    if ($pidValue) {
      Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
      Write-Host "$name launcher stopped."
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

Stop-Port 3000
Stop-Port 5173
Stop-Port 5174

if (!$KeepPostgres) {
  $resolvedPgBin = Resolve-PostgresBin $PostgresBin
  $resolvedPgData = if ($PostgresData) { $PostgresData } else { "D:\PostgreSQL\data" }
  if ($resolvedPgBin -and (Test-Path $resolvedPgData)) {
    $pgCtl = Join-Path $resolvedPgBin "pg_ctl.exe"
    & $pgCtl -D $resolvedPgData status *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Stopping PostgreSQL..."
      & $pgCtl -D $resolvedPgData stop | Out-Host
    }
  }
}

Write-Host "Stopped."
