param(
  [Parameter(Mandatory = $true)][string]$ResourceGroup,
  [string]$WebAppName = 'crickethub',
  [string]$CosmosAccountName = '',
  [string]$Location = 'uaenorth',
  [string]$AppScope = 'default'
)

$ErrorActionPreference = 'Stop'

$normalizedScope = [string]$AppScope
if ([string]::IsNullOrWhiteSpace($normalizedScope)) {
  $normalizedScope = 'default'
}
$normalizedScope = $normalizedScope.Trim().ToLower()
if (-not $normalizedScope) { $normalizedScope = 'default' }
$scopeSuffix = if ($normalizedScope -eq 'default') { '' } else { "-$normalizedScope" }
$frontendSubdir = if ($normalizedScope -eq 'android') { 'android-app' } else { '' }
$appDataDir = "/home/site/data/crickethub$scopeSuffix"
$cosmosDbName = "league-db$scopeSuffix"
$cosmosContainerName = "app-state$scopeSuffix"
$cosmosPartitionKey = $normalizedScope
$cosmosDocId = "state$scopeSuffix"

# ---------------------------------------------------------------------------
# Helper: Section Header
# ---------------------------------------------------------------------------
function Write-Section($msg) {
  Write-Host ""
  Write-Host "===========================================" -ForegroundColor Cyan
  Write-Host "  $msg" -ForegroundColor Cyan
  Write-Host "===========================================" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# Helper: Post-Deployment Health Check
# ---------------------------------------------------------------------------
function Test-AppHealth {
  param([string]$AppUrl, [int]$MaxAttempts = 8, [int]$DelaySeconds = 20)

  Write-Host ""
  Write-Host "  Waiting for app to become reachable (first boot installs deps, allow ~2 min)..." -ForegroundColor Yellow

  for ($i = 1; $i -le $MaxAttempts; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $AppUrl -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
      if ($response.StatusCode -eq 200) {
        return @{ Success = $true; StatusCode = $response.StatusCode }
      }
      return @{ Success = $false; StatusCode = $response.StatusCode }
    } catch {
      $msg = $_.Exception.Message
      Write-Host ("  Attempt {0}/{1} - {2}" -f $i, $MaxAttempts, $msg) -ForegroundColor DarkYellow
      if ($i -lt $MaxAttempts) { Start-Sleep -Seconds $DelaySeconds }
    }
  }
  return @{ Success = $false; StatusCode = 0; Error = "Unreachable after $MaxAttempts attempts" }
}

# ---------------------------------------------------------------------------
# Deployment state tracking
# ---------------------------------------------------------------------------
$deploymentErrors   = [System.Collections.Generic.List[string]]::new()
$deploymentWarnings = [System.Collections.Generic.List[string]]::new()
$stepResults        = [ordered]@{}

function Record-Step($name, $ok, $detail = '') {
  $stepResults[$name] = @{ OK = $ok; Detail = $detail }
}

# ===========================================================================
Write-Section "AZURE LOGIN"
# ===========================================================================
try {
  az account show | Out-Null
  $subName = (az account show --query "name" -o tsv 2>$null)
  Write-Host "  Logged in. Subscription: $subName" -ForegroundColor Green
  Record-Step "Azure Login" $true $subName
} catch {
  Write-Host "  Not logged in. Running az login..." -ForegroundColor Yellow
  az login | Out-Null
  Record-Step "Azure Login" $true "Logged in via az login"
}

# ===========================================================================
Write-Section "INFRASTRUCTURE PROVISIONING"
# ===========================================================================
try {
  Write-Host "  Creating resource group '$ResourceGroup' in $Location..."
  az group create --name $ResourceGroup --location $Location | Out-Null
  Record-Step "Resource Group" $true $ResourceGroup
} catch {
  $err = "Resource group creation failed: $_"
  $deploymentErrors.Add($err)
  Record-Step "Resource Group" $false $err
  throw
}

$planName = "$WebAppName-plan"
try {
  Write-Host "  Creating App Service plan '$planName'..."
  az appservice plan create --name $planName --resource-group $ResourceGroup --location $Location --is-linux --sku B1 | Out-Null
  Record-Step "App Service Plan" $true $planName
} catch {
  $err = "App Service plan creation failed: $_"
  $deploymentErrors.Add($err)
  Record-Step "App Service Plan" $false $err
  throw
}

try {
  Write-Host "  Creating Web App '$WebAppName'..."
  az webapp create --name $WebAppName --resource-group $ResourceGroup --plan $planName --runtime "NODE:22-lts" | Out-Null
  Record-Step "Web App Creation" $true $WebAppName
} catch {
  $err = "Web App creation failed: $_"
  $deploymentErrors.Add($err)
  Record-Step "Web App Creation" $false $err
  throw
}

# ===========================================================================
Write-Section "COSMOS DB SETUP"
# ===========================================================================
$cosmosEndpoint = ''
$cosmosKey      = ''

if ($CosmosAccountName) {
  try {
    Write-Host "  Registering Microsoft.DocumentDB provider..."
    az provider register --namespace Microsoft.DocumentDB | Out-Null
  } catch {
    $warn = "Could not register Microsoft.DocumentDB provider."
    $deploymentWarnings.Add($warn)
    Write-Host "  Warning: $warn" -ForegroundColor Yellow
  }

  try {
    $existingCosmos = az cosmosdb show --name $CosmosAccountName --resource-group $ResourceGroup --query "name" -o tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and $existingCosmos) {
      Write-Host "  Cosmos DB account '$CosmosAccountName' already exists. Reusing it." -ForegroundColor Green
    } else {
      Write-Host "  Creating Cosmos DB account '$CosmosAccountName'..."
      az cosmosdb create --name $CosmosAccountName --resource-group $ResourceGroup `
        --locations regionName=$Location failoverPriority=0 isZoneRedundant=false `
        --default-consistency-level Session | Out-Null
    }

    Write-Host "  Creating database and container..."
    az cosmosdb sql database create --account-name $CosmosAccountName --resource-group $ResourceGroup --name $cosmosDbName | Out-Null
    az cosmosdb sql container create --account-name $CosmosAccountName --resource-group $ResourceGroup `
      --database-name $cosmosDbName --name $cosmosContainerName --partition-key-path "/pk" | Out-Null

    $cosmosEndpoint = az cosmosdb show --name $CosmosAccountName --resource-group $ResourceGroup --query "documentEndpoint" -o tsv
    $cosmosKey      = az cosmosdb keys list --name $CosmosAccountName --resource-group $ResourceGroup --query "primaryMasterKey" -o tsv

    Record-Step "Cosmos DB" $true "$CosmosAccountName - endpoint acquired"
  } catch {
    $warn = "Cosmos DB setup failed: $_. Continuing without Cosmos settings."
    $deploymentWarnings.Add($warn)
    Write-Host "  Warning: $warn" -ForegroundColor Yellow
    Record-Step "Cosmos DB" $false $warn
  }
} else {
  Write-Host "  Skipped (no CosmosAccountName provided)." -ForegroundColor DarkGray
  Record-Step "Cosmos DB" $true "Skipped"
}

# ===========================================================================
Write-Section "WEB APP CONFIGURATION"
# ===========================================================================
# Startup command explained:
#
# Azure sets CWD to "/" by default, not "/home/site/wwwroot", which causes
# "ENOENT: no such file or directory, open '/package.json'" crashes.
#
# The startup command:
#   1. cd to the known absolute wwwroot path (fixes the CWD bug absolutely)
#   2. npm ci --omit=dev  -> installs prod deps natively on Linux (no Windows
#      backslash path issues; runs only when node_modules is absent)
#   3. npm start          -> runs "node server/startup.js" per package.json
#
# DISABLE_ORYX_BUILD=true  -> prevents Oryx running "npm run build" which
#   would fail because index.html (Vite source entry) is not in the zip.
#   The build already ran locally; dist/ is pre-built and included in the zip.
# SCM_DO_BUILD_DURING_DEPLOYMENT=false -> consistent with Oryx being disabled.
# ---------------------------------------------------------------------------
try {
  $allowedOrigins = "https://$WebAppName.azurewebsites.net"

  $startupCmd = "cd /home/site/wwwroot && if [ ! -d node_modules ]; then npm ci --omit=dev --no-audit; fi && npm start"

  Write-Host "  Setting app settings..."
  az webapp config appsettings set --name $WebAppName --resource-group $ResourceGroup --settings `
    WEBSITES_PORT=3001 `
    SCM_DO_BUILD_DURING_DEPLOYMENT=false `
    DISABLE_ORYX_BUILD=true `
    APP_SCOPE=$normalizedScope `
    APP_DATA_DIR=$appDataDir `
    WEBSITES_CONTAINER_START_TIME_LIMIT=1800 `
    ALLOWED_ORIGINS=$allowedOrigins `
    COSMOS_ENDPOINT=$cosmosEndpoint `
    COSMOS_KEY=$cosmosKey `
    COSMOS_DB_NAME=$cosmosDbName `
    COSMOS_CONTAINER_NAME=$cosmosContainerName `
    COSMOS_PARTITION_KEY=$cosmosPartitionKey `
    COSMOS_DOC_ID=$cosmosDocId | Out-Null

  Write-Host "  Setting startup command..."
  az webapp config set --name $WebAppName --resource-group $ResourceGroup `
    --startup-file $startupCmd | Out-Null

  Write-Host "  Startup: $startupCmd" -ForegroundColor DarkGray
  Record-Step "App Configuration" $true "Oryx disabled, absolute-path startup set"
} catch {
  $err = "App configuration failed: $_"
  $deploymentErrors.Add($err)
  Record-Step "App Configuration" $false $err
  throw
}

# ===========================================================================
Write-Section "BUILD"
# ===========================================================================
try {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $frontendRoot = if ($frontendSubdir) { Join-Path $repoRoot $frontendSubdir } else { $repoRoot }

  Write-Host "  Building frontend from: $frontendRoot" -ForegroundColor DarkGray
  Push-Location $frontendRoot
  try {
    Write-Host "  Running npm install (local, for Vite build tooling only)..."
    npm install
    Write-Host "  Running npm run build (compiles React/Vite into dist/)..."
    npm run build
  } finally {
    Pop-Location
  }

  $distPath = Join-Path $frontendRoot 'dist'
  if (-not (Test-Path $distPath)) {
    throw "dist/ folder not found after build. Vite build may have silently failed."
  }
  $distFiles = (Get-ChildItem $distPath -Recurse -File).Count
  Record-Step "Build" $true "dist/ produced ($distFiles files)"
  Write-Host "  dist/ ready with $distFiles files." -ForegroundColor Green
} catch {
  $err = "Build failed: $_"
  $deploymentErrors.Add($err)
  Record-Step "Build" $false $err
  throw
}

# ===========================================================================
Write-Section "PACKAGE PREPARATION"
# ===========================================================================
try {
  $repoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $frontendRoot = if ($frontendSubdir) { Join-Path $repoRoot $frontendSubdir } else { $repoRoot }
  $frontendDist = Join-Path $frontendRoot 'dist'
  $deployDir = Join-Path $repoRoot 'deploy_site'
  $deployZip = Join-Path $repoRoot 'deploy_live.zip'

  if (Test-Path $deployDir) { Remove-Item -Recurse -Force $deployDir }
  if (Test-Path $deployZip) { Remove-Item -Force $deployZip }

  New-Item -ItemType Directory -Path $deployDir | Out-Null

  # Required files
  Copy-Item -Recurse -Force (Join-Path $repoRoot 'server') (Join-Path $deployDir 'server')
  Copy-Item -Recurse -Force $frontendDist (Join-Path $deployDir 'dist')
  Copy-Item -Force (Join-Path $repoRoot 'package.json')      (Join-Path $deployDir 'package.json')
  Copy-Item -Force (Join-Path $repoRoot 'package-lock.json') (Join-Path $deployDir 'package-lock.json')

  # node_modules intentionally excluded:
  # Running npm ci on Windows produces backslash paths that break Linux rsync.
  # The startup command installs deps natively on Linux on first boot.
  Write-Host "  node_modules excluded - startup command installs on Linux." -ForegroundColor DarkYellow

  # Safety guards
  if (Test-Path (Join-Path $deployDir 'android-app')) {
    throw "android-app must not be included in the deployment payload."
  }
  if (Test-Path (Join-Path $deployDir 'node_modules')) {
    throw "node_modules must not be in the deployment package (Windows paths break Linux rsync)."
  }
  if (-not (Test-Path (Join-Path $deployDir 'dist'))) {
    throw "dist/ is missing from deploy package."
  }
  if (-not (Test-Path (Join-Path $deployDir 'package.json'))) {
    throw "package.json is missing from deploy package."
  }

  # Verify the entry point that npm start will call actually exists
  $startupJs = Join-Path (Join-Path $deployDir 'server') 'startup.js'
  if (-not (Test-Path $startupJs)) {
    throw "server/startup.js not found in deploy package. 'npm start' runs 'node server/startup.js' per package.json - this file must exist."
  }
  Write-Host "  server/startup.js confirmed present." -ForegroundColor Green

  # Check package.json start script matches what we expect
  $pkgJson = Get-Content (Join-Path $deployDir 'package.json') | ConvertFrom-Json
  $startScript = $pkgJson.scripts.start
  Write-Host "  package.json start script: $startScript" -ForegroundColor DarkGray
  if ($startScript -notmatch 'node') {
    $warn = "package.json start script '$startScript' does not call node directly - verify this is correct."
    $deploymentWarnings.Add($warn)
    Write-Host "  Warning: $warn" -ForegroundColor Yellow
  }

  # Use tar to preserve POSIX path separators in zip entries for Linux App Service.
  tar -a -c -f $deployZip -C $deployDir .
  $zipSizeMB = [math]::Round((Get-Item $deployZip).Length / 1MB, 2)
  Record-Step "Package" $true "deploy_live.zip created (${zipSizeMB} MB)"
  Write-Host "  Package ready: $deployZip ($zipSizeMB MB)" -ForegroundColor Green
} catch {
  $err = "Packaging failed: $_"
  $deploymentErrors.Add($err)
  Record-Step "Package" $false $err
  throw
}

# ===========================================================================
Write-Section "DEPLOYING TO AZURE"
# ===========================================================================
$deployOk = $false
try {
  Write-Host "  Uploading zip to Azure Web App..."
  az webapp deploy --name $WebAppName --resource-group $ResourceGroup --src-path $deployZip --type zip --clean true | Out-Null
  Write-Host "  Restarting app..."
  az webapp restart --name $WebAppName --resource-group $ResourceGroup | Out-Null
  $deployOk = $true
  Record-Step "Azure Deploy" $true "Zip uploaded and app restarted"
} catch {
  $err = "Azure deployment failed: $_"
  $deploymentErrors.Add($err)
  Record-Step "Azure Deploy" $false $err
}

# ===========================================================================
Write-Section "POST-DEPLOYMENT STATUS"
# ===========================================================================

$appUrl = "https://$WebAppName.azurewebsites.net"

# Step results table
Write-Host ""
Write-Host "  Step Results:" -ForegroundColor White
Write-Host "  ------------------------------------------" -ForegroundColor DarkGray
foreach ($step in $stepResults.Keys) {
  $r      = $stepResults[$step]
  $icon   = if ($r.OK) { "[OK]  " } else { "[FAIL]" }
  $color  = if ($r.OK) { "Green" } else { "Red" }
  $detail = if ($r.Detail) { " - $($r.Detail)" } else { "" }
  Write-Host ("  {0} {1,-26}{2}" -f $icon, $step, $detail) -ForegroundColor $color
}

# Warnings
if ($deploymentWarnings.Count -gt 0) {
  Write-Host ""
  Write-Host "  Warnings ($($deploymentWarnings.Count)):" -ForegroundColor Yellow
  foreach ($w in $deploymentWarnings) {
    Write-Host "  [WARN] $w" -ForegroundColor Yellow
  }
}

# Errors
if ($deploymentErrors.Count -gt 0) {
  Write-Host ""
  Write-Host "  Errors ($($deploymentErrors.Count)):" -ForegroundColor Red
  foreach ($e in $deploymentErrors) {
    Write-Host "  [ERR]  $e" -ForegroundColor Red
  }
}

# HTTP health check
if ($deployOk) {
  $health = Test-AppHealth -AppUrl $appUrl

  Write-Host ""
  if ($health.Success) {
    Write-Host "  [OK]   App is reachable at $appUrl (HTTP $($health.StatusCode))" -ForegroundColor Green
  } else {
    $httpDetail = if ($health.StatusCode -gt 0) { "HTTP $($health.StatusCode)" } else { $health.Error }
    Write-Host "  [FAIL] App health check failed - $httpDetail" -ForegroundColor Red
    $deploymentErrors.Add("Health check failed: $httpDetail")

    Write-Host ""
    Write-Host "  Fetching recent application logs for diagnostics..." -ForegroundColor Yellow
    try {
      $logs = az webapp log tail --name $WebAppName --resource-group $ResourceGroup --timeout 15 2>&1 | Select-Object -Last 50
      Write-Host ""
      Write-Host "  --- Last 50 log lines ---" -ForegroundColor DarkGray
      $logs | ForEach-Object {
        $color = 'DarkCyan'
        if ($_ -match 'error|fail|exception|crash|ENOENT|EACCES|Cannot find|MODULE_NOT_FOUND') { $color = 'Red' }
        elseif ($_ -match 'warn') { $color = 'Yellow' }
        elseif ($_ -match 'listen|started|ready|port') { $color = 'Green' }
        Write-Host "  $_" -ForegroundColor $color
      }
      Write-Host "  -------------------------" -ForegroundColor DarkGray
    } catch {
      Write-Host "  Could not retrieve logs: $_" -ForegroundColor DarkYellow
    }
  }

  Write-Host ""
  Write-Host "  Kudu log:     https://$WebAppName.scm.azurewebsites.net/api/deployments" -ForegroundColor DarkCyan
  Write-Host "  Live stream:  https://$WebAppName.scm.azurewebsites.net/api/logstream" -ForegroundColor DarkCyan
  Write-Host "  SSH console:  https://$WebAppName.scm.azurewebsites.net/DebugConsole" -ForegroundColor DarkCyan
}

# Final summary banner
Write-Host ""
if ($deploymentErrors.Count -eq 0) {
  Write-Host "===========================================" -ForegroundColor Green
  Write-Host "  DEPLOYMENT SUCCESSFUL" -ForegroundColor Green
  Write-Host "  Website/API URL: $appUrl" -ForegroundColor Green
  Write-Host "===========================================" -ForegroundColor Green
} else {
  Write-Host "===========================================" -ForegroundColor Red
  Write-Host "  DEPLOYMENT COMPLETED WITH ERRORS ($($deploymentErrors.Count))" -ForegroundColor Red
  Write-Host "  Website/API URL: $appUrl" -ForegroundColor DarkYellow
  Write-Host "  Review errors above and check Kudu logs." -ForegroundColor Red
  Write-Host "===========================================" -ForegroundColor Red
  exit 1
}