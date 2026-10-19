// Sayfayı önbelleğe alır ki internet zayıfken de açılsın.
const CACHE = 'sesyazi-v12';
const CORE = ['./', 'index.html', 'admin.html', 'spiral.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // GitHub API ve key.json her zaman ağdan gelsin
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('key.json')) return;
  // önce ağ (güncel kalsın), olmazsa önbellek
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
