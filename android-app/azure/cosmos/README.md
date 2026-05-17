# CricketHub Azure Database

This app already has Azure Cosmos DB support in `deploy_site/server/azureStateStore.js`.
The remote database shape is one Cosmos DB NoSQL container with a single state document.

## Free Tier Shape

- Cosmos account: free tier enabled
- Database: `league-db-crickethub`
- Shared throughput: `400` RU/s
- Container: `app-state-crickethub`
- Partition key: `/pk`
- State document: `state-crickethub` with `pk = crickethub`

The free tier is intended to stay inside the first `1000` RU/s and `25 GB` storage on the account.

## Files

- `default-state.json`: empty app state document matching the backend data model.
- `state-schema.json`: JSON Schema for the state document.
- `create-free-database.ps1`: creates the remote Azure Cosmos DB account, database, and container only.
- `initialize-state.mjs`: seeds the empty state document after the database exists.

## Run After Azure Subscription Is Re-Enabled

```powershell
.\azure\cosmos\create-free-database.ps1
```

Then get the real key:

```powershell
az cosmosdb keys list -g rg-cricket-android-uae -n <account-name> --type keys --query primaryMasterKey -o tsv
```

Use those values as the server environment variables:

```env
COSMOS_ENDPOINT=https://<account-name>.documents.azure.com:443/
COSMOS_KEY=<primary key>
COSMOS_DB_NAME=league-db-crickethub
COSMOS_CONTAINER_NAME=app-state-crickethub
COSMOS_PARTITION_KEY=crickethub
COSMOS_DOC_ID=state-crickethub
```

No frontend, backend, or Android app deployment is required by this script.

## Optional State Initialization

After setting `COSMOS_ENDPOINT` and `COSMOS_KEY`, run this from a project folder that has `@azure/cosmos` installed, for example `deploy_site`:

```powershell
cd ..\deploy_site
npm install
$env:COSMOS_ENDPOINT="https://<account-name>.documents.azure.com:443/"
$env:COSMOS_KEY="<primary key>"
$env:COSMOS_DB_NAME="league-db-crickethub"
$env:COSMOS_CONTAINER_NAME="app-state-crickethub"
$env:COSMOS_PARTITION_KEY="crickethub"
$env:COSMOS_DOC_ID="state-crickethub"
node ..\android-app\azure\cosmos\initialize-state.mjs
```
