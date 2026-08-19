const CACHE = 'qrpass-shell-v1.3.1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/styles.css',
  './assets/css/company.css',
  './assets/css/header-fix.css',
  './assets/css/auth.css',
  './assets/css/employees.css',
  './assets/css/audit.css',
  './assets/css/archive.css',
  './assets/css/history-admin.css',
  './assets/css/account.css',
  './assets/css/pilot.css',
  './assets/css/legal.css',
  './assets/css/inspections.css',
  './assets/css/import.css',
  './assets/css/reminders.css',
  './assets/js/legal-config.js',
  './assets/js/pilot.js',
  './assets/js/qr-flow.js',
  './assets/js/auth.js',
  './assets/js/recovery.js',
  './assets/js/employees.js',
  './assets/js/logo-processor.js',
  './assets/js/company.js',
  './assets/js/contrast.js',
  './assets/js/app.js',
  './assets/js/audit-ui.js',
  './assets/js/archive-ui.js',
  './assets/js/inspections.js',
  './assets/js/history-admin.js',
  './assets/js/account.js',
  './assets/js/import.js',
  './assets/js/reminders.js',
  './assets/js/legal.js',
  './assets/js/terminology.js'
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
