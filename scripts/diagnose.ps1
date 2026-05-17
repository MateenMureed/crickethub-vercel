param(
  [Parameter(Mandatory = $true)][string]$ResourceGroup,
  [string]$WebAppName = 'crickethub'
)

$ErrorActionPreference = 'Continue'

function Write-Section($msg) {
  Write-Host ""
  Write-Host "===========================================" -ForegroundColor Cyan
  Write-Host "  $msg" -ForegroundColor Cyan
  Write-Host "===========================================" -ForegroundColor Cyan
}

# ===========================================================================
Write-Section "APP STATE"
# ===========================================================================
$state = az webapp show --name $WebAppName --resource-group $ResourceGroup --query "{state:state, nodeVersion:siteConfig.nodeVersion, startupCmd:siteConfig.appCommandLine}" -o json | ConvertFrom-Json
Write-Host "  State         : $($state.state)" -ForegroundColor $(if ($state.state -eq 'Running') { 'Green' } else { 'Red' })
Write-Host "  Node version  : $($state.nodeVersion)"
Write-Host "  Startup cmd   : $($state.startupCmd)"

# ===========================================================================
Write-Section "APP SETTINGS (redacted secrets)"
# ===========================================================================
$settings = az webapp config appsettings list --name $WebAppName --resource-group $ResourceGroup -o json | ConvertFrom-Json
foreach ($s in $settings) {
  $val = if ($s.name -match 'KEY|SECRET|PASSWORD|CONN') { '*** redacted ***' } else { $s.value }
  Write-Host ("  {0,-40} = {1}" -f $s.name, $val)
}

# ===========================================================================
Write-Section "RECENT DEPLOYMENT LOGS (Kudu)"
# ===========================================================================
try {
  $deployments = az webapp deployment list --name $WebAppName --resource-group $ResourceGroup -o json | ConvertFrom-Json
  $latest = $deployments | Sort-Object lastSuccessEndTime -Descending | Select-Object -First 1
  if ($latest) {
    Write-Host "  Latest deployment ID : $($latest.id)"
    Write-Host "  Status               : $($latest.status) - $($latest.statusText)"
    Write-Host "  Active               : $($latest.active)"
    Write-Host "  End time             : $($latest.lastSuccessEndTime)"
    if ($latest.message) { Write-Host "  Message              : $($latest.message)" -ForegroundColor Yellow }
  }
} catch {
  Write-Host "  Could not retrieve deployment list: $_" -ForegroundColor Yellow
}

# ===========================================================================
Write-Section "CONTAINER / STDOUT LOGS"
# ===========================================================================
Write-Host "  Enabling logging on the app (if not already on)..." -ForegroundColor DarkYellow
az webapp log config --name $WebAppName --resource-group $ResourceGroup `
  --docker-container-logging filesystem `
  --application-logging filesystem `
  --level information | Out-Null

Write-Host "  Downloading log files..." -ForegroundColor DarkYellow
$logZip = Join-Path $env:TEMP 'webapp_logs.zip'
if (Test-Path $logZip) { Remove-Item $logZip }

try {
  az webapp log download --name $WebAppName --resource-group $ResourceGroup --log-file $logZip | Out-Null
  $logDir = Join-Path $env:TEMP 'webapp_logs'
  if (Test-Path $logDir) { Remove-Item -Recurse -Force $logDir }
  Expand-Archive -Path $logZip -DestinationPath $logDir

  # Print docker/container logs
  $dockerLogs = Get-ChildItem -Recurse $logDir -Filter '*.log' |
    Where-Object { $_.Name -match 'docker|container|default_docker' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 3

  if ($dockerLogs) {
    foreach ($logFile in $dockerLogs) {
      Write-Host ""
      Write-Host "  --- $($logFile.Name) (last 60 lines) ---" -ForegroundColor DarkGray
      Get-Content $logFile.FullName | Select-Object -Last 60 | ForEach-Object {
        $color = 'DarkCyan'
        if ($_ -match 'error|fail|exception|crash|ENOENT|EACCES|Cannot find|MODULE_NOT_FOUND' ) { $color = 'Red' }
        elseif ($_ -match 'warn|warning') { $color = 'Yellow' }
        elseif ($_ -match 'listen|started|ready|port') { $color = 'Green' }
        Write-Host "  $_" -ForegroundColor $color
      }
    }
  } else {
    Write-Host "  No docker/container log files found in download." -ForegroundColor Yellow
    Write-Host "  All log files found:" -ForegroundColor DarkGray
    Get-ChildItem -Recurse $logDir -Filter '*.log' | ForEach-Object { Write-Host "    $($_.FullName)" }
  }
} catch {
  Write-Host "  Log download failed: $_" -ForegroundColor Red
  Write-Host "  Falling back to live log tail (15 seconds)..." -ForegroundColor Yellow
  az webapp log tail --name $WebAppName --resource-group $ResourceGroup --timeout 15 2>&1 |
    ForEach-Object {
      $color = 'DarkCyan'
      if ($_ -match 'error|fail|exception|crash|ENOENT|EACCES|Cannot find|MODULE_NOT_FOUND') { $color = 'Red' }
      elseif ($_ -match 'warn|warning') { $color = 'Yellow' }
      elseif ($_ -match 'listen|started|ready|port') { $color = 'Green' }
      Write-Host "  $_" -ForegroundColor $color
    }
}

# ===========================================================================
Write-Section "WHAT TO LOOK FOR"
# ===========================================================================
Write-Host "  Common causes of 503 on Azure Linux Node apps:" -ForegroundColor White
Write-Host ""
Write-Host "  [1] Wrong port - app must listen on process.env.PORT (Azure sets this)" -ForegroundColor Yellow
Write-Host "      Fix: ensure server listens on process.env.PORT || 3001"
Write-Host ""
Write-Host "  [2] Missing module - a require() fails because node_modules is incomplete" -ForegroundColor Yellow
Write-Host "      Look for: 'MODULE_NOT_FOUND' or 'Cannot find module' in logs"
Write-Host ""
Write-Host "  [3] App crashes before listening - unhandled exception at startup" -ForegroundColor Yellow
Write-Host "      Look for: Error stack traces near the top of the log"
Write-Host ""
Write-Host "  [4] Startup timeout - app takes >230s to start (default Azure limit)" -ForegroundColor Yellow
Write-Host "      WEBSITES_CONTAINER_START_TIME_LIMIT is set to 1800 - should be OK"
Write-Host ""
Write-Host "  [5] dist/ not found - server tries to serve dist/ but path is wrong" -ForegroundColor Yellow
Write-Host "      Check that server.js serves from __dirname + '/dist' not '../dist'"
Write-Host ""
Write-Host "  Kudu console (run commands live): https://$WebAppName.scm.azurewebsites.net/DebugConsole" -ForegroundColor DarkCyan
Write-Host "  Log stream (live):                https://$WebAppName.scm.azurewebsites.net/api/logstream" -ForegroundColor DarkCyan
