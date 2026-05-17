param(
  [Parameter(Mandatory=$true)][string]$ServerName,
  [Parameter(Mandatory=$true)][string]$DatabaseName,
  [Parameter(Mandatory=$true)][string]$AdminUser,
  [Parameter(Mandatory=$true)][string]$Password
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
  throw "sqlcmd is required to apply this schema from PowerShell. You can also paste the SQL into Azure Portal Query Editor."
}

$scriptPath = Join-Path $PSScriptRoot "001_create_crickethub_schema.sql"

sqlcmd `
  -S "$ServerName.database.windows.net" `
  -d $DatabaseName `
  -U $AdminUser `
  -P $Password `
  -i $scriptPath `
  -b

Write-Host "CricketHub schema applied to $DatabaseName."
