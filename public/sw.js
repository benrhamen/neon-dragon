// Offline support: network-first (so updates show up), falling back to the cache when offline.
const CACHE = 'neon-gamebook-v1';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/engine.js', 'js/avatar.js', 'js/sound.js',
  'data/neon-dragon.json', 'fonts/PressStart2P-Regular.ttf', 'fonts/VT323-Regular.ttf', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'img/arcade.svg', 'img/harbour.svg', 'img/market.svg', 'img/ferry.svg', 'img/tunnel.svg', 'img/robot.svg', 'img/king.svg', 'img/dragon.svg', 'img/victory.svg',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
