# One-time Supabase setup (database + storage buckets)
Set-Location $PSScriptRoot\..

Write-Host ""
Write-Host "glimpse - Supabase setup" -ForegroundColor Cyan
Write-Host ""

node scripts/setup-database.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "If you added SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env, press Enter to create storage buckets (or Ctrl+C to skip)."
Read-Host

node scripts/setup-supabase-storage.cjs
