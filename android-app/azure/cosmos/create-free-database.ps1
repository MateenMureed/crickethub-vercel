param(
  [string]$ResourceGroup = "rg-cricket-android-uae",
  [string]$Location = "uaenorth",
  [string]$AccountName = "",
  [string]$DatabaseName = "league-db-crickethub",
  [string]$ContainerName = "app-state-crickethub",
  [string]$PartitionKeyValue = "crickethub",
  [string]$DocumentId = "state-crickethub"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI is required. Install it, then run 'az login'."
}

if ([string]::IsNullOrWhiteSpace($AccountName)) {
  $AccountName = "crickethubdb$(Get-Random -Minimum 10000 -Maximum 99999)"
}

Write-Host "Using Cosmos DB account: $AccountName"
Write-Host "Resource group: $ResourceGroup"
Write-Host "Location: $Location"

$groupExists = az group exists -n $ResourceGroup | ConvertFrom-Json
if (-not $groupExists) {
  az group create -n $ResourceGroup -l $Location -o none
}

az provider register -n Microsoft.DocumentDB -o none

az cosmosdb create `
  -g $ResourceGroup `
  -n $AccountName `
  --locations regionName=$Location failoverPriority=0 isZoneRedundant=False `
  --enable-free-tier true `
  --default-consistency-level Session `
  --backup-redundancy Local `
  -o none

az cosmosdb sql database create `
  -g $ResourceGroup `
  -a $AccountName `
  -n $DatabaseName `
  --throughput 400 `
  -o none

az cosmosdb sql container create `
  -g $ResourceGroup `
  -a $AccountName `
  -d $DatabaseName `
  -n $ContainerName `
  --partition-key-path "/pk" `
  -o none

$endpoint = az cosmosdb show -g $ResourceGroup -n $AccountName --query documentEndpoint -o tsv

@"
COSMOS_ENDPOINT=$endpoint
COSMOS_KEY=<run: az cosmosdb keys list -g $ResourceGroup -n $AccountName --type keys --query primaryMasterKey -o tsv>
COSMOS_DB_NAME=$DatabaseName
COSMOS_CONTAINER_NAME=$ContainerName
COSMOS_PARTITION_KEY=$PartitionKeyValue
COSMOS_DOC_ID=$DocumentId
"@ | Set-Content -Path (Join-Path $PSScriptRoot ".env.azure-cosmos.example") -Encoding utf8

Write-Host "Created Cosmos DB database and container."
Write-Host "Wrote .env.azure-cosmos.example next to this script."
Write-Host "The app server will initialize the remote state document on first start when these env vars are set."
