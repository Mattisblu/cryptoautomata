<#
start-dev-environment.ps1
PowerShell script to start a local Postgres (Docker), start Ollama model, and start the background server.
Usage (from repo root):
  .\scripts\start-dev-environment.ps1 [-OllamaModel <model>] [-PostgresContainerName <name>] [-PostgresPort <port>] [-StartServer]

This script does NOT assume admin rights for Docker. It checks for Docker and Ollama.
#>
param(
  [string]$OllamaModel = 'kimi-k2.5:cloud',
  [string]$PostgresContainerName = 'crypto_pg',
  [int]$PostgresPort = 5432,
  [switch]$StartServer = $true
)

function Write-Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m){ Write-Host "[ERROR] $m" -ForegroundColor Red }

Write-Info "Starting dev environment orchestration"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..'))
Push-Location $repoRoot

# -- Check Docker --
$dockerOk = $false
try {
  $null = & docker version --format '{{.Server.Version}}' 2>$null
  if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
} catch { $dockerOk = $false }

Write-Info "Checking for existing server/model processes and Docker containers to stop"

# Stop local node processes that look like our server (dist/index.js or npm run dev)
try {
  $nodeCandidates = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'dist\\index.js' -or $_.CommandLine -match 'npm run dev' -or $_.CommandLine -match 'index-dev.ts') }
  if ($nodeCandidates) {
    foreach ($p in $nodeCandidates) {
      Write-Info "Stopping Node process PID $($p.ProcessId)"
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  Write-Warn "Unable to enumerate/stop Node processes: $_"
}

# Stop any running Ollama CLI processes
try {
  $ollamaProcs = Get-Process -Name ollama -ErrorAction SilentlyContinue
  if ($ollamaProcs) {
    foreach ($op in $ollamaProcs) {
      Write-Info "Stopping Ollama PID $($op.Id)"
      Stop-Process -Id $op.Id -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  Write-Warn "Unable to stop Ollama processes: $_"
}

# If Docker is available, stop a running Postgres container with the requested name
if ($dockerOk) {
  try {
    $running = (& docker ps --filter "name=$PostgresContainerName" --format "{{.Names}}") -ne ''
    if ($running) {
      Write-Info "Stopping existing Docker container '$PostgresContainerName'"
      & docker stop $PostgresContainerName | Out-Null
      & docker rm $PostgresContainerName | Out-Null
    }
  } catch {
    Write-Warn ("Could not stop/remove Docker container " + $PostgresContainerName + ": " + $_)
  }
}

if (-not $dockerOk) {
  Write-Warn "Docker not available or not running. Postgres container steps will be skipped."
} else {
  Write-Info "Docker detected. Ensuring Postgres container '$PostgresContainerName' is running on port $PostgresPort"

  # Check if container exists
  $exists = (& docker ps -a --filter "name=$PostgresContainerName" --format "{{.Names}}") -ne ''
  if ($exists) {
    Write-Info "Container exists. Starting if not running..."
    & docker start $PostgresContainerName | Out-Null
    } else {
      Write-Info "Creating Postgres container '$PostgresContainerName' (postgres:15)"
      & docker run --name $PostgresContainerName -e POSTGRES_USER=dev -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=crypto -p ${PostgresPort}:5432 -v "${PWD}\pgdata:/var/lib/postgresql/data" -d postgres:15 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "Failed to create Postgres container. Check Docker logs."
    }
  }

  # Wait for Postgres port to accept connections
  Write-Info "Waiting for Postgres to be ready on 127.0.0.1:$PostgresPort"
  $tries = 0
  while ($tries -lt 30) {
    try {
      $sock = New-Object System.Net.Sockets.TcpClient
      $async = $sock.BeginConnect('127.0.0.1', $PostgresPort, $null, $null)
      $wait = $async.AsyncWaitHandle.WaitOne(1000)
      if ($wait -and $sock.Connected) { $sock.Close(); break }
      $sock.Close()
    } catch {}
    Start-Sleep -Seconds 1
    $tries++
  }
  if ($tries -ge 30) { Write-Warn "Postgres did not become available within timeout." } else { Write-Info "Postgres seems up." }
}

# -- Start Ollama model --
function Start-OllamaModel($model) {
  Write-Info "Checking Ollama availability..."
  try {
    $ollamaPath = (Get-Command ollama -ErrorAction Stop).Source
  } catch {
    Write-Err "'ollama' CLI not found in PATH. Please install Ollama and authenticate."
    return $false
  }

  # Check running models
  $running = & ollama list 2>$null | Select-String 'Run' -Quiet
  # We'll just attempt to run the model; Ollama will reuse if already running
  Write-Info "Starting Ollama model: $model"
  # Use Start-Process to run in background and keep stdout/stderr hidden
  $arg = "run $model --keep-alive 60s --kv-cache q8_0"
  try {
    Start-Process -NoNewWindow -FilePath 'ollama' -ArgumentList $arg -WorkingDirectory $repoRoot -WindowStyle Hidden
    Start-Sleep -Seconds 2
    Write-Info "Issued 'ollama run' for $model (background)."
    return $true
  } catch {
    Write-Warn "Failed to start Ollama model: $_"
    return $false
  }
}

Start-OllamaModel -model $OllamaModel | Out-Null

# -- Start Server --
if ($StartServer) {
  Write-Info "Starting server (attempting 'npm run dev' in server/)."
  Push-Location (Join-Path $repoRoot 'server')

  # Prefer 'npm run dev' if available
  if (Test-Path package.json) {
    try {
      # Run in new background PowerShell window so this script can exit
      $devCmd = "npm run dev"
      Write-Info "Launching: $devCmd"
      Start-Process -FilePath powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command \"$devCmd\"" -WorkingDirectory (Get-Location) -NoNewWindow
      Write-Info "Server dev command started in background. Check server logs in that shell." 
    } catch {
      Write-Warn "Failed to start via 'npm run dev', falling back to node dist/index.js"
      try {
        Start-Process -FilePath node -ArgumentList 'dist/index.js' -WorkingDirectory (Get-Location) -NoNewWindow
        Write-Info "Started node dist/index.js in background."
      } catch {
        Write-Err "Failed to start server: $_"
      }
    }
  } else {
    Write-Warn "server/package.json not found; attempting to run dist/index.js directly"
    try {
      Start-Process -FilePath node -ArgumentList 'dist/index.js' -WorkingDirectory (Get-Location) -NoNewWindow
      Write-Info "Started node dist/index.js in background."
    } catch {
      Write-Err "Failed to start dist/index.js: $_"
    }
  }

  Pop-Location
}

Pop-Location
Write-Info "Dev environment start sequence complete."
Write-Info "Suggestions: verify Ollama model with 'ollama ls' and server health at http://127.0.0.1:5000/api/llm/health"
