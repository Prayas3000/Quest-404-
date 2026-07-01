// Quest 404 Caching Service Worker
const CACHE_NAME = 'quest404-v1.3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/play.html',
  '/admin.html',
  '/leaderboard.html',
  '/css/design-system.css',
  '/css/components.css',
  '/css/admin.css',
  '/css/player.css',
  '/css/leaderboard.css',
  '/js/config.js',
  '/js/utils.js',
  '/js/auth.js',
  '/js/admin/admin.js',
  '/js/admin/sessions.js',
  '/js/admin/teams.js',
  '/js/admin/players.js',
  '/js/admin/checkpoints.js',
  '/js/admin/questions.js',
  '/js/admin/routes.js',
  '/js/admin/dashboard.js',
  '/js/player/game.js',
  '/js/player/scanner.js',
  '/js/player/questions.js',
  '/js/leaderboard/live.js',
  '/manifest.json'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching App Shell Assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Service Worker: Purging Outdated Cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Intercept Event (Network first, fallback to Cache)
self.addEventListener('fetch', (e) => {
  // Avoid caching Supabase API or external CDN calls dynamically, use network only
  if (e.request.url.includes('supabase.co') || e.request.method !== 'GET') {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Cache the freshly loaded file
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, clone);
        });
        return response;
      })
      .catch(async () => {
        // Fallback to cache if network fails
        const cached = await caches.match(e.request);
        if (cached) return cached;
        return new Response('Network request failed', { status: 408 });
      })
  );
});
