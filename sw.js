// Bump VERSION on each release (and APP_VERSION in js/app.js; a unit test checks they match).
// User data lives in localStorage, which a service-worker update never touches.
const VERSION = '7.0.0';
const CACHE = 'zentry-' + VERSION;
const OLD = ['zyntry-', 'solo-leveling-'];             // caches from the app's previous names
const VENDOR = 'zentry-vendor';                         // large, versioned libraries: kept across app updates
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'fonts/fredoka.woff2', 'fonts/nunito.woff2',
  'js/app.js', 'js/zynvoice.js', 'js/rpg.js', 'js/store.js', 'js/timer.js', 'js/audio.js', 'js/wolf.js', 'js/voice.js', 'js/catalog.js', 'js/analytics.js',
  'js/ai/nlu.js', 'js/ai/validate.js', 'js/ai/assistant.js', 'js/ai/engines.js', 'js/ui/chat.js', 'js/ui/track.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png', 'icons/favicon-32.png'
];
// The on-device AI library (js/vendor, ~6 MB) is NOT precached: it is cached the first time the user enables the model.

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // also clears caches left by the app's previous name
      .then(keys => Promise.all(keys.filter(k => (k.startsWith('zentry-') || OLD.some(o => k.startsWith(o))) && k !== CACHE && k !== VENDOR).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first (revalidated) so updates arrive automatically; falls back to the cache when offline or slow.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.includes('/js/vendor/')) {        // cache-first: file names carry the version
    e.respondWith(caches.open(VENDOR).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
    return;
  }
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
