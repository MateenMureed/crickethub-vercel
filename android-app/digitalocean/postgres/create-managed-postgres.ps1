param(
  [string]$ClusterName = "crickethub-db",
  [string]$Region = "nyc1",
  [string]$Size = "db-s-1vcpu-1gb",
  [int]$NumNodes = 1,
  [string]$DatabaseName = "crickethub"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command doctl -ErrorAction SilentlyContinue)) {
  throw "doctl is required. Install it from DigitalOcean, then run: doctl auth init"
}

Write-Host "Creating DigitalOcean Managed PostgreSQL cluster '$ClusterName'."
Write-Host "Plan: $Size, nodes: $NumNodes, region: $Region"
Write-Host "This creates only the database cluster. It does not deploy the app."

doctl databases create $ClusterName `
  --engine pg `
  --region $Region `
  --size $Size `
  --num-nodes $NumNodes `
  --wait

$clusterId = doctl databases list --format ID,Name --no-header |
  ForEach-Object {
    $parts = ($_ -replace '\s+', ' ').Trim().Split(' ')
    if ($parts.Length -ge 2 -and $parts[1] -eq $ClusterName) { $parts[0] }
  } |
  Select-Object -First 1

if (-not $clusterId) {
  throw "Cluster created, but the cluster ID could not be resolved from doctl databases list."
}

doctl databases db create $clusterId $DatabaseName

Write-Host "Created database '$DatabaseName' on cluster '$ClusterName' ($clusterId)."
Write-Host "Next: apply schema with .\apply-schema.ps1 -ClusterName $ClusterName -DatabaseName $DatabaseName"
