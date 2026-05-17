const STATIC_CACHE = 'ch-static-v2';
const API_CACHE = 'ch-api-v2';
const IMAGE_CACHE = 'ch-images-v3';
const APP_SHELL = ['/', '/index.html'];
const API_CACHE_MAX = 100;
const IMAGE_CACHE_MAX = 200;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([STATIC_CACHE, API_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (keep.has(key) ? Promise.resolve() : caches.delete(key))))
    ).then(() => self.clients.claim())
  );
});

/**
 * Prune a cache to a maximum number of entries (FIFO).
 */
const pruneCache = async (cacheName, maxEntries) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const toDelete = keys.slice(0, keys.length - maxEntries);
  await Promise.all(toDelete.map((key) => cache.delete(key)));
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isApi = url.pathname.includes('/api/');
  const isImage = req.destination === 'image' || url.pathname.includes('/media/') || url.pathname.includes('/uploads/');

  // ── API calls: Stale-While-Revalidate ──────────────────────────────────
  // Return cached response instantly, then update cache from network in background.
  // This makes the app feel instant while keeping data fresh.
  if (isApi) {
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        const cached = await cache.match(req);

        // Always start a background network fetch to update the cache
        const networkPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes.ok) {
              cache.put(req, networkRes.clone()).catch(() => {});
              pruneCache(API_CACHE, API_CACHE_MAX).catch(() => {});
            }
            return networkRes;
          })
          .catch(() => null);

        // If we have a cached response, return it immediately
        if (cached) return cached;

        // No cache — wait for network
        const networkRes = await networkPromise;
        if (networkRes) return networkRes;

        // Both failed — return empty JSON
        return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // ── Images: Cache-first with network fallback ──────────────────────────
  // Images rarely change, so cache-first is ideal for performance.
  if (isImage) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;

        try {
          const networkRes = await fetch(req);
          if (networkRes.ok) {
            cache.put(req, networkRes.clone()).catch(() => {});
            pruneCache(IMAGE_CACHE, IMAGE_CACHE_MAX).catch(() => {});
          }
          return networkRes;
        } catch {
          return new Response('', { status: 404 });
        }
      })
    );
    return;
  }

  // ── Static assets: Network-first with offline fallback ─────────────────
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});
