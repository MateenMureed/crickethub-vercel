const fs = require('fs');

// Vercel functions have an ephemeral filesystem.  The same store also works
// locally when KV_REST_API_URL/TOKEN are absent, using server/data.json.
const REST_URL = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const REST_TOKEN = process.env.KV_REST_API_TOKEN || '';
const STATE_KEY = process.env.KV_STATE_KEY || 'crickethub:state';
let pendingState = null;

function isEnabled() {
  return Boolean(REST_URL && REST_TOKEN);
}

async function request(command, body) {
  const response = await fetch(`${REST_URL}${command}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Vercel KV request failed (${response.status})`);
  return response.json();
}

async function hydrateLocalFile(dbFilePath, defaultData) {
  if (!isEnabled()) return;
  const result = await request(`/get/${encodeURIComponent(STATE_KEY)}`);
  let remoteState = result.result;
  if (typeof remoteState === 'string') {
    try { remoteState = JSON.parse(remoteState); } catch { remoteState = null; }
  }
  if (remoteState && typeof remoteState === 'object') {
    fs.writeFileSync(dbFilePath, JSON.stringify(remoteState, null, 2));
    return;
  }
  await request('/pipeline', [['SET', STATE_KEY, JSON.stringify(defaultData)]]);
}

function queuePersist(state) {
  pendingState = state;
}

async function flush() {
  if (!isEnabled() || !pendingState) return;
  const state = pendingState;
  pendingState = null;
  await request('/pipeline', [['SET', STATE_KEY, JSON.stringify(state)]]);
}

module.exports = { isEnabled, hydrateLocalFile, queuePersist, flush };
