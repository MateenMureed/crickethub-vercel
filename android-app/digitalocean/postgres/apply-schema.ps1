param(
  [Parameter(Mandatory=$true)][string]$ClusterName,
  [string]$DatabaseName = "crickethub"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command doctl -ErrorAction SilentlyContinue)) {
  throw "doctl is required. Install it from DigitalOcean, then run: doctl auth init"
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw "psql is required to apply the schema locally. Install PostgreSQL client tools first."
}

$clusterId = doctl databases list --format ID,Name --no-header |
  ForEach-Object {
    $parts = ($_ -replace '\s+', ' ').Trim().Split(' ')
    if ($parts.Length -ge 2 -and $parts[1] -eq $ClusterName) { $parts[0] }
  } |
  Select-Object -First 1

if (-not $clusterId) {
  throw "Could not find DigitalOcean database cluster named '$ClusterName'."
}

$conn = doctl databases connection $clusterId --format Host,Port,User,Password,SSL --no-header
$parts = ($conn -replace '\s+', ' ').Trim().Split(' ')
if ($parts.Length -lt 5) {
  throw "Could not parse database connection details from doctl."
}

$hostName = $parts[0]
$port = $parts[1]
$user = $parts[2]
$password = $parts[3]
$sslMode = "require"
$scriptPath = Join-Path $PSScriptRoot "001_create_crickethub_schema.sql"

$env:PGPASSWORD = $password
try {
  psql "host=$hostName port=$port dbname=$DatabaseName user=$user sslmode=$sslMode" -v ON_ERROR_STOP=1 -f $scriptPath
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host "CricketHub schema applied to DigitalOcean PostgreSQL database '$DatabaseName'."
