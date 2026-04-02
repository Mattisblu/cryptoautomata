# Run dev server with simulated exchanges (USE_LIVE_API=false)
$env:USE_LIVE_API = 'false'
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Definition)
Write-Host "Starting dev server in simulated mode (USE_LIVE_API=$env:USE_LIVE_API)"
npm run dev
