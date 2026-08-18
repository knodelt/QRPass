const CACHE = 'qrpass-shell-v0.9';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './company.css',
  './header-fix.css',
  './auth.css',
  './employees.css',
  './audit.css',
  './archive.css',
  './history-admin.css',
  './account.css',
  './qr-flow.js',
  './auth.js',
  './recovery.js',
  './employees.js',
  './logo-processor.js',
  './company.js',
  './contrast.js',
  './app.js',
  './audit-ui.js',
  './archive-ui.js',
  './history-admin.js',
  './account.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(hit => hit || caches.match('./index.html'))
      )
  );
});
