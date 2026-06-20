param(
  [string]$ProjectName = "glimpse"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "glimpse - Railway deploy" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
  throw "Railway CLI not found. Install: npm i -g @railway/cli"
}

$whoami = railway whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Log in to Railway first:" -ForegroundColor Yellow
  railway login
}

if (-not (Test-Path ".railway")) {
  Write-Host "Linking new Railway project: $ProjectName"
  railway init --name $ProjectName
}

Write-Host ""
Write-Host "Set variables in Railway dashboard (see railway.env.template), then deploy..."
Write-Host ""

railway up --detach

Write-Host ""
Write-Host "Generate domain: Railway dashboard -> Settings -> Networking -> Generate Domain"
Write-Host "Then set APP_BASE_URL to that URL and redeploy if needed."
Write-Host ""
