const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const APP_SCOPE = (process.env.APP_SCOPE || '').trim().toLowerCase() || 'default';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const idx = line.indexOf('=');
        return idx === -1 ? [line, ''] : [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      })
  );
}

const androidAppEnv = parseEnvFile(path.resolve(__dirname, '..', '..', 'android-app', '.env'));
const deploySiteEnv = parseEnvFile(path.resolve(__dirname, '..', '.env'));
const mergedEnv = { ...deploySiteEnv, ...androidAppEnv, ...process.env };

const DATABASE_URL = mergedEnv.DATABASE_URL || mergedEnv.SUPABASE_DB_URL;
const STATE_ID = mergedEnv.SUPABASE_STATE_ID || `state-${APP_SCOPE}`;

let initialized = false;
let poolRef = null;
let pendingPersist = null;

function isEnabled() {
  return !!DATABASE_URL;
}

function getPool() {
  if (!poolRef) {
    poolRef = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.SUPABASE_DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30000,
    });
  }
  return poolRef;
}

async function ensureTable() {
  const pool = getPool();
  await pool.query('CREATE SCHEMA IF NOT EXISTS app');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app.remote_state (
      id text PRIMARY KEY,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function hydrateLocalFile(dbFilePath, defaultData) {
  if (initialized) return;
  initialized = true;

  if (!isEnabled()) {
    console.log('Supabase DB sync disabled: DATABASE_URL/SUPABASE_DB_URL not set');
    return;
  }

  try {
    await ensureTable();
    const result = await getPool().query('SELECT state FROM app.remote_state WHERE id = $1', [STATE_ID]);

    if (result.rows.length === 0) {
      await getPool().query(
        'INSERT INTO app.remote_state (id, state, updated_at) VALUES ($1, $2::jsonb, now())',
        [STATE_ID, JSON.stringify(defaultData)]
      );
      console.log('Supabase DB sync: initialized remote state document');
      return;
    }

    fs.writeFileSync(dbFilePath, JSON.stringify(result.rows[0].state, null, 2));
    console.log('Supabase DB sync: local state hydrated from Supabase');
  } catch (error) {
    console.error('Supabase DB hydrate failed:', error.message);
  }
}

function queuePersist(state) {
  if (!isEnabled()) return;

  if (pendingPersist) clearTimeout(pendingPersist);
  pendingPersist = setTimeout(async () => {
    try {
      await ensureTable();
      await getPool().query(
        `INSERT INTO app.remote_state (id, state, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id)
         DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [STATE_ID, JSON.stringify(state)]
      );
    } catch (error) {
      console.error('Supabase DB persist failed:', error.message);
    }
  }, 300);
}

module.exports = {
  isEnabled,
  hydrateLocalFile,
  queuePersist,
};
