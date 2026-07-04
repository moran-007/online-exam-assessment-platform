param(
  [string]$Server = "aliyun",
  [string]$Repo = "https://github.com/moran-007/online-exam-assessment-platform.git",
  [string]$Branch = "main",
  [string]$ServerName = "47.99.132.82",
  [switch]$ChinaMirror,
  [switch]$Seed
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root "runtime"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LocalArchive = Join-Path $Runtime "source-$Stamp.tar"
$LocalInstaller = Join-Path $Runtime "install-$Stamp.sh"
$RemoteArchive = "/tmp/online-exam-source-$Stamp.tar"
$RemoteInstaller = "/tmp/online-exam-install-$Stamp.sh"

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
Set-Location -Path $Root

function Invoke-Checked($FilePath, [string[]]$ArgumentList) {
  Write-Host ("$FilePath " + ($ArgumentList -join " "))
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
  }
}

$head = (& git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or !$head) {
  throw "Cannot read current git commit."
}

$dirty = (& git status --porcelain).Trim()
if ($dirty) {
  Write-Warning "Working tree has uncommitted changes. This script packages committed HEAD only: $head"
}

Write-Host "Packaging git HEAD $head ..."
Invoke-Checked "git" -ArgumentList @("archive", "--format=tar", "-o", $LocalArchive, "HEAD")

$installer = (Get-Content -Raw -Path (Join-Path $Root "deploy/install.sh")) -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($LocalInstaller, $installer, [System.Text.UTF8Encoding]::new($false))

Write-Host "Uploading source archive and installer to $Server ..."
Invoke-Checked "scp" -ArgumentList @($LocalArchive, "${Server}:$RemoteArchive")
Invoke-Checked "scp" -ArgumentList @($LocalInstaller, "${Server}:$RemoteInstaller")

$remoteArgs = @(
  "--source-archive", $RemoteArchive,
  "--repo", $Repo,
  "--branch", $Branch,
  "--server-name", $ServerName
)
if ($ChinaMirror) {
  $remoteArgs += "--china-mirror"
}
if ($Seed) {
  $remoteArgs += "--seed"
}

$remoteCommand = "chmod +x $RemoteInstaller && bash $RemoteInstaller " + ($remoteArgs -join " ")
Write-Host "Running remote deployment via uploaded archive ..."
Invoke-Checked "ssh" -ArgumentList @($Server, $remoteCommand)

Write-Host ""
Write-Host "Deployment finished from local archive."
Write-Host "Commit: $head"
Write-Host "Server: $Server"
