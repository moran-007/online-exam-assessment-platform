$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root "runtime"
$PgBin = "D:\PostgreSQL\pgsql\bin"
$PgData = "D:\PostgreSQL\data"
$BackendUrl = "http://localhost:3000/api/v1/health"
$FrontendUrl = "http://localhost:5173"

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
Set-Location -Path $Root

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
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

Stop-Port 3000
Stop-Port 5173
Stop-Port 5174

function Wait-Http($Url, $Name) {
  for ($i = 0; $i -lt 40; $i++) {
    try {
      Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 2 | Out-Null
      Write-Host "$Name ready: $Url"
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  Write-Host "$Name is starting. Try later: $Url"
}

function Ensure-Postgres {
  $pgCtl = Join-Path $PgBin "pg_ctl.exe"
  $createdb = Join-Path $PgBin "createdb.exe"
  $psql = Join-Path $PgBin "psql.exe"

  if (!(Test-Path $pgCtl)) {
    Write-Host "PostgreSQL not found: $PgBin"
    Write-Host "Please check D:\PostgreSQL."
    return
  }

  & $pgCtl -D $PgData status *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting PostgreSQL..."
    & $pgCtl -D $PgData -l (Join-Path $Runtime "postgres.log") start | Out-Host
  } else {
    Write-Host "PostgreSQL is already running."
  }

  $env:PGPASSWORD = "postgres"
  & $psql -h localhost -p 5432 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='online_exam'" | Out-String | ForEach-Object {
    if ($_.Trim() -ne "1") {
      & $createdb -h localhost -p 5432 -U postgres online_exam
    }
  }
}

Ensure-Postgres

if (!(Test-Path (Join-Path $Root "node_modules"))) {
  Write-Host "Installing dependencies..."
  pnpm install
}

Write-Host "Syncing database..."
pnpm prisma:generate
pnpm exec prisma migrate deploy
pnpm db:seed

Write-Host "Building backend..."
pnpm build

Write-Host "Starting backend and frontend..."
$BackendOut = Join-Path $Runtime "backend.out.log"
$BackendErr = Join-Path $Runtime "backend.err.log"
$FrontendOut = Join-Path $Runtime "frontend.out.log"
$FrontendErr = Join-Path $Runtime "frontend.err.log"

$Backend = Start-Process -FilePath "pnpm.cmd" -ArgumentList "start" -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $BackendOut -RedirectStandardError $BackendErr -PassThru
$Frontend = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev" -WorkingDirectory (Join-Path $Root "frontend") -WindowStyle Hidden -RedirectStandardOutput $FrontendOut -RedirectStandardError $FrontendErr -PassThru

Set-Content -Path (Join-Path $Runtime "backend.pid") -Value $Backend.Id
Set-Content -Path (Join-Path $Runtime "frontend.pid") -Value $Frontend.Id

Wait-Http $BackendUrl "Backend"
Start-Sleep -Seconds 2
Start-Process $FrontendUrl

Write-Host ""
Write-Host "Platform started"
Write-Host "Frontend: $FrontendUrl"
Write-Host "API: http://localhost:3000/api/v1"
Write-Host "Swagger: http://localhost:3000/api/docs"
Write-Host "Logs: $Runtime"
