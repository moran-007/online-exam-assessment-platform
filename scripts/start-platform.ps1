param(
  [switch]$Seed,
  [switch]$NoBrowser,
  [string]$PostgresBin = $env:POSTGRES_BIN_DIR,
  [string]$PostgresData = $env:POSTGRES_DATA_DIR
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root "runtime"
$BackendUrl = "http://127.0.0.1:3000/api/v1/health"
$FrontendUrl = "http://127.0.0.1:5173"

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
Set-Location -Path $Root

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message"
}

function Resolve-CommandPath($Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (!$command) {
    throw "$Name not found. Please install it or add it to PATH."
  }
  return $command.Source
}

function Invoke-Checked($FilePath, [string[]]$ArgumentList, $WorkingDirectory = $Root) {
  Push-Location -Path $WorkingDirectory
  try {
    Write-Host ("$FilePath " + ($ArgumentList -join " "))
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
    }
  } finally {
    Pop-Location
  }
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

function Stop-TrackedProcess($Name) {
  $pidFile = Join-Path $Runtime "$Name.pid"
  if (!(Test-Path $pidFile)) {
    return
  }

  $pidValue = Get-Content $pidFile | Select-Object -First 1
  if ($pidValue) {
    Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Wait-Http($Url, $Name, $Attempts = 60) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "$Name ready: $Url"
        return $true
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  Write-Warning "$Name is not ready after $Attempts seconds: $Url"
  return $false
}

function Show-LogTail($Path, $Title, $Lines = 80) {
  if (Test-Path $Path) {
    Write-Host ""
    Write-Host "----- $Title ($Path) -----"
    Get-Content $Path -Tail $Lines
  }
}

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

  throw "PostgreSQL not found. Set POSTGRES_BIN_DIR or install PostgreSQL under D:\PostgreSQL."
}

function Ensure-Postgres {
  $resolvedPgBin = Resolve-PostgresBin $PostgresBin
  $resolvedPgData = if ($PostgresData) { $PostgresData } else { "D:\PostgreSQL\data" }
  $pgCtl = Join-Path $resolvedPgBin "pg_ctl.exe"
  $createdb = Join-Path $resolvedPgBin "createdb.exe"
  $psql = Join-Path $resolvedPgBin "psql.exe"

  if (!(Test-Path $resolvedPgData)) {
    throw "PostgreSQL data directory not found: $resolvedPgData. Set POSTGRES_DATA_DIR if your data directory is elsewhere."
  }

  $env:POSTGRES_BIN_DIR = $resolvedPgBin
  & $pgCtl -D $resolvedPgData status *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting PostgreSQL from $resolvedPgData ..."
    & $pgCtl -D $resolvedPgData -l (Join-Path $Runtime "postgres.log") start | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to start PostgreSQL. See $(Join-Path $Runtime 'postgres.log')."
    }
  } else {
    Write-Host "PostgreSQL is already running."
  }

  $env:PGPASSWORD = "postgres"
  for ($i = 0; $i -lt 30; $i++) {
    & $psql -h localhost -p 5432 -U postgres -d postgres -tAc "SELECT 1" *> $null
    if ($LASTEXITCODE -eq 0) {
      break
    }
    Start-Sleep -Seconds 1
  }

  $exists = (& $psql -h localhost -p 5432 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='online_exam'").Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Cannot connect to local PostgreSQL as postgres. Please check the local password and DATABASE_URL."
  }
  if ($exists -ne "1") {
    Write-Host "Creating database online_exam ..."
    & $createdb -h localhost -p 5432 -U postgres online_exam
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create database online_exam."
    }
  }
}

function Ensure-EnvFile {
  $envFile = Join-Path $Root ".env"
  if (Test-Path $envFile) {
    return
  }

  $example = Join-Path $Root ".env.example"
  if (!(Test-Path $example)) {
    throw ".env is missing and .env.example was not found."
  }
  Copy-Item -Path $example -Destination $envFile
  Write-Host "Created local .env from .env.example."
}

function Get-UserCount {
  $psql = Join-Path $env:POSTGRES_BIN_DIR "psql.exe"
  $env:PGPASSWORD = "postgres"
  $count = (& $psql -h localhost -p 5432 -U postgres -d online_exam -tAc 'SELECT COUNT(*) FROM users;').Trim()
  if ($LASTEXITCODE -ne 0 -or !$count) {
    return 0
  }
  return [int]$count
}

try {
  $pnpm = Resolve-CommandPath "pnpm.cmd"
} catch {
  $pnpm = Resolve-CommandPath "pnpm"
}

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22 -or $nodeMajor -ge 25) {
  throw "Node.js 22-24 is required. Current major version: $nodeMajor."
}

Write-Step "Stopping old local processes"
foreach ($name in @("frontend", "backend")) {
  Stop-TrackedProcess $name
}
Stop-Port 3000
Stop-Port 5173
Stop-Port 5174

$CutoverStatePath = Join-Path $Runtime "cutover\worker-01-state.json"
if (Test-Path $CutoverStatePath) {
  $CutoverState = Get-Content -LiteralPath $CutoverStatePath -Raw | ConvertFrom-Json
  if ($CutoverState.phase -in @("FROZEN", "ACTIVE_MAIN", "ENTRY_ROLLED_BACK", "ARCHIVED")) {
    Write-Host "worker_01 cutover state: $($CutoverState.phase); stopping legacy service port 8000."
    Stop-Port 8000
  }
}

Write-Step "Preparing local PostgreSQL"
Ensure-Postgres
Ensure-EnvFile

if (!(Test-Path (Join-Path $Root "node_modules"))) {
  Write-Step "Installing dependencies"
  Invoke-Checked $pnpm -ArgumentList @("install")
}

Write-Step "Syncing database"
Invoke-Checked $pnpm -ArgumentList @("prisma:generate")
Invoke-Checked $pnpm -ArgumentList @("exec", "prisma", "migrate", "deploy")

$userCount = Get-UserCount
if ($Seed -or $userCount -eq 0) {
  Write-Step "Seeding database"
  Invoke-Checked $pnpm -ArgumentList @("db:seed")
} else {
  Write-Host "Skip seed: users table already has $userCount rows. Use -Seed to reseed explicitly."
}

Write-Step "Building backend"
Invoke-Checked $pnpm -ArgumentList @("build")

Write-Step "Starting backend and frontend"
$BackendOut = Join-Path $Runtime "backend.out.log"
$BackendErr = Join-Path $Runtime "backend.err.log"
$FrontendOut = Join-Path $Runtime "frontend.out.log"
$FrontendErr = Join-Path $Runtime "frontend.err.log"

$Backend = Start-Process -FilePath $pnpm -ArgumentList "start" -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $BackendOut -RedirectStandardError $BackendErr -PassThru
$Frontend = Start-Process -FilePath $pnpm -ArgumentList "dev" -WorkingDirectory (Join-Path $Root "frontend") -WindowStyle Hidden -RedirectStandardOutput $FrontendOut -RedirectStandardError $FrontendErr -PassThru

Set-Content -Path (Join-Path $Runtime "backend.pid") -Value $Backend.Id
Set-Content -Path (Join-Path $Runtime "frontend.pid") -Value $Frontend.Id

$backendReady = Wait-Http $BackendUrl "Backend"
$frontendReady = Wait-Http $FrontendUrl "Frontend"

if (!$backendReady -or !$frontendReady) {
  Show-LogTail $BackendErr "Backend stderr"
  Show-LogTail $BackendOut "Backend stdout"
  Show-LogTail $FrontendErr "Frontend stderr"
  Show-LogTail $FrontendOut "Frontend stdout"
  throw "Platform startup did not complete. Check logs under $Runtime."
}

if (!$NoBrowser) {
  try {
    Start-Process -FilePath $FrontendUrl -ErrorAction Stop
  } catch {
    Write-Warning "Platform is running, but the browser could not be opened automatically. Open $FrontendUrl manually."
  }
}

Write-Host ""
Write-Host "Platform started"
Write-Host "Frontend: $FrontendUrl"
Write-Host "API: http://localhost:3000/api/v1"
Write-Host "Swagger: http://localhost:3000/api/docs"
Write-Host "Logs: $Runtime"
