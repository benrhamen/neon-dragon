// Offline support: network-first (so updates show up), falling back to the cache when offline.
// Only same-origin GETs are handled: the online leaderboard (Supabase) always goes to the network.
// Bump CACHE on every release: the new worker installs, skips waiting, claims open tabs and the
// page offers a one-tap reload.
const CACHE = 'neon-gamebook-v5';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/engine.js', 'js/avatar.js', 'js/sound.js', 'js/leaderboard.js', 'js/voucher.js', 'js/config.js',
  'data/neon-dragon.json', 'data/riddles.json', 'fonts/PressStart2P-Regular.ttf', 'fonts/VT323-Regular.ttf', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'img/arcade.svg',
  'img/bubbletea.svg',
  'img/causeway.svg',
  'img/dimsum.svg',
  'img/dragon.svg',
  'img/ferry.svg',
  'img/fireworks.svg',
  'img/harbour.svg',
  'img/king.svg',
  'img/manmo.svg',
  'img/market.svg',
  'img/mtr.svg',
  'img/park.svg',
  'img/peak.svg',
  'img/racecourse.svg',
  'img/robot.svg',
  'img/taxi.svg',
  'img/tram.svg',
  'img/trapped.svg',
  'img/tunnel.svg',
  'img/vault.svg',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((res) => { // revalidate with the server, never a stale HTTP-cache copy
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
