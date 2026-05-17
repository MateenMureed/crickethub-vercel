const { CosmosClient } = require('@azure/cosmos');
const fs = require('fs');

const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const COSMOS_DB_NAME = process.env.COSMOS_DB_NAME || 'league-db';
const COSMOS_CONTAINER_NAME = process.env.COSMOS_CONTAINER_NAME || 'app-state';
const COSMOS_PARTITION_KEY = process.env.COSMOS_PARTITION_KEY || 'default';
const COSMOS_DOC_ID = process.env.COSMOS_DOC_ID || 'state';

let initialized = false;
let disabledReason = '';
let containerRef = null;
let pendingPersist = null;

function isEnabled() {
  return !!(COSMOS_ENDPOINT && COSMOS_KEY);
}

async function ensureContainer() {
  if (containerRef) return containerRef;
  if (!isEnabled()) {
    disabledReason = 'COSMOS_ENDPOINT/COSMOS_KEY not set';
    return null;
  }

  const client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
  const { database } = await client.databases.createIfNotExists({ id: COSMOS_DB_NAME });
  const { container } = await database.containers.createIfNotExists({
    id: COSMOS_CONTAINER_NAME,
    partitionKey: { paths: ['/pk'] },
  });

  containerRef = container;
  return containerRef;
}

async function hydrateLocalFile(dbFilePath, defaultData) {
  if (initialized) return;
  initialized = true;

  if (!isEnabled()) {
    console.log('Azure DB sync disabled:', disabledReason || 'missing credentials');
    return;
  }

  try {
    const container = await ensureContainer();
    if (!container) return;

    let remoteData = null;
    try {
      const { resource } = await container.item(COSMOS_DOC_ID, COSMOS_PARTITION_KEY).read();
      if (resource && resource.state && typeof resource.state === 'object') {
        remoteData = resource.state;
      }
    } catch (error) {
      if (error && error.code !== 404) throw error;
    }

    if (!remoteData) {
      await container.items.upsert({
        id: COSMOS_DOC_ID,
        pk: COSMOS_PARTITION_KEY,
        state: defaultData,
        updatedAt: new Date().toISOString(),
      });
      console.log('Azure DB sync: initialized remote state document');
      return;
    }

    fs.writeFileSync(dbFilePath, JSON.stringify(remoteData, null, 2));
    console.log('Azure DB sync: local state hydrated from Cosmos DB');
  } catch (error) {
    console.error('Azure DB hydrate failed:', error.message);
  }
}

function queuePersist(state) {
  if (!isEnabled()) return;

  if (pendingPersist) clearTimeout(pendingPersist);
  pendingPersist = setTimeout(async () => {
    try {
      const container = await ensureContainer();
      if (!container) return;
      await container.items.upsert({
        id: COSMOS_DOC_ID,
        pk: COSMOS_PARTITION_KEY,
        state,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Azure DB persist failed:', error.message);
    }
  }, 300);
}

module.exports = {
  isEnabled,
  hydrateLocalFile,
  queuePersist,
};
