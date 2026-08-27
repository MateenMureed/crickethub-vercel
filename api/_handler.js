const { app, db, mediaStorage } = require('../server/server');

let initialized = null;
function initialize() {
  if (!initialized) initialized = Promise.all([db.initStorage(), mediaStorage.init()]);
  return initialized;
}

module.exports = async (req, res) => {
  try {
    await initialize();
    const originalEnd = res.end.bind(res);
    let ending = false;
    res.end = function (...args) {
      if (ending) return originalEnd(...args);
      ending = true;
      db.flushStorage()
        .catch((error) => console.error('Vercel KV persist failed:', error.message))
        .finally(() => originalEnd(...args));
      return res;
    };
    return app(req, res);
  } catch (error) {
    console.error('Serverless initialization failed:', error);
    return res.status(500).json({ error: 'Serverless API initialization failed' });
  }
};
