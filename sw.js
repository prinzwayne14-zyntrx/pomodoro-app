// Bump VERSION on each release (and APP_VERSION in js/app.js; a unit test checks they match).
// User data lives in localStorage, which a service-worker update never touches.
const VERSION = '5.0.0';
const CACHE = 'zyntry-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'js/app.js',
  'js/rpg.js',
  'js/store.js',
  'js/timer.js',
  'js/audio.js',
  'js/wolf.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // also clears caches left by the app's previous name
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('zyntry-') || k.startsWith('solo-leveling-')) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first (revalidated) so updates arrive automatically; falls back to the cache when offline or slow.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const network = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  });
  const timeout = new Promise((_, rej) => setTimeout(rej, 4000));
  e.respondWith(
    Promise.race([network, timeout]).catch(() =>
      caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match(req.mode === 'navigate' ? 'index.html' : req))
    )
  );
});

// Tapping a notification opens (or focuses) the app.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow ? self.clients.openWindow('./') : null;
  }));
});
