import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'))
const { CosmosClient } = requireFromCwd('@azure/cosmos')

const here = path.dirname(fileURLToPath(import.meta.url))
const statePath = path.join(here, 'default-state.json')

const endpoint = process.env.COSMOS_ENDPOINT
const key = process.env.COSMOS_KEY
const databaseId = process.env.COSMOS_DB_NAME || 'league-db-crickethub'
const containerId = process.env.COSMOS_CONTAINER_NAME || 'app-state-crickethub'
const partitionKey = process.env.COSMOS_PARTITION_KEY || 'crickethub'
const documentId = process.env.COSMOS_DOC_ID || 'state-crickethub'

if (!endpoint || !key) {
  throw new Error('COSMOS_ENDPOINT and COSMOS_KEY must be set before initializing state.')
}

const raw = await fs.readFile(statePath, 'utf8')
const document = JSON.parse(raw)
document.id = documentId
document.pk = partitionKey
document.updatedAt = new Date().toISOString()

const client = new CosmosClient({ endpoint, key })
const { database } = await client.databases.createIfNotExists({ id: databaseId })
const { container } = await database.containers.createIfNotExists({
  id: containerId,
  partitionKey: { paths: ['/pk'] },
})

await container.items.upsert(document)

console.log(`Initialized ${databaseId}/${containerId}/${documentId}.`)
