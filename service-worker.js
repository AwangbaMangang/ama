// service-worker.js
const CACHE_VERSION = 'v2'; // bump this when you update assets
const CACHE_NAME = `meetei-replacer-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',                 // for many static servers this maps to index.html
  '/index.html',
  '/style.css',
  '/app.js',
  '/dictionary.json',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  // Activate new SW immediately after install
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => {
        console.warn('SW precache failed:', err);
      })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Claim clients immediately so the SW controls pages ASAP
      await self.clients.claim();

      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })()
  );
});

// Helper: is this a navigation request (SPA client-side route)?
function isNavigationRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

// Fetch handler: network-first for JSON and app.js, cache-first for assets, navigation fallback to index.html
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip cross-origin requests for caching logic (let them go to network)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Always try network-first for dynamic assets that we want fresh:
  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('.json')) {
    event.respondWith(
      (async () => {
        try {
          const networkResp = await fetch(req);
          // Update cache (so we have a fallback next time)
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, networkResp.clone()).catch(() => {});
          return networkResp;
        } catch (err) {
          // Network failed -> try cache
          const cached = await caches.match(req);
          if (cached) return cached;
          // If there's nothing, and this is navigation, fallback to index.html below
          if (isNavigationRequest(req)) {
            return caches.match('/index.html');
          }
          return new Response(null, { status: 503, statusText: 'Service Unavailable' });
        }
      })()
    );
    return;
  }

  // For navigation requests (SPA) -> serve index.html from cache first, then network
  if (isNavigationRequest(req)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        // If exactly matched (rare for navigation), return it. Otherwise network-first with index fallback.
        return cached || fetch(req).catch(() => caches.match('/index.html'));
      })
    );
    return;
  }

  // For other GET requests (static assets) -> cache-first, with network fallback and cache update
  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then(async (cached) => {
        if (cached) return cached;
        try {
          const networkResp = await fetch(req);
          // Save a copy in cache for next time
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, networkResp.clone()).catch(() => {});
          return networkResp;
        } catch (err) {
          // If nothing in cache and network failed, return a  fallback (index.html for HTML or generic 503)
          const offlineFallback = await caches.match('/index.html');
          if (offlineFallback && req.headers.get('accept')?.includes('text/html')) return offlineFallback;
          return new Response(null, { status: 503, statusText: 'Service Unavailable' });
        }
      })
    );
    return;
  }

  // For non-GET (POST/PUT) — just go to network (don't intercept)
});

// Listen for messages from the page (e.g., to trigger skipWaiting)
self.addEventListener('message', (event) => {
  if (!event.data) return;
  const { type } = event.data;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Optional: respond with cached index.html for navigation fallback on offline
// (already handled above but this extra code ensures offline SPA fallback)
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match('/index.html');
      })
    );
  }
});
