$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root "runtime"
$PgCtl = "D:\PostgreSQL\pgsql\bin\pg_ctl.exe"
$PgData = "D:\PostgreSQL\data"

function Stop-Port($Port) {
  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
  foreach ($connection in $connections) {
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

foreach ($name in @("frontend", "backend")) {
  $pidFile = Join-Path $Runtime "$name.pid"
  if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile | Select-Object -First 1
    if ($pidValue) {
      Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
      Write-Host "$name stopped."
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

Stop-Port 3000
Stop-Port 5173
Stop-Port 5174

if (Test-Path $PgCtl) {
  & $PgCtl -D $PgData status *> $null
  if ($LASTEXITCODE -eq 0) {
    & $PgCtl -D $PgData stop | Out-Host
  }
}

Write-Host "Stopped."
