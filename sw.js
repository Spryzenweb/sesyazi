// Sayfayı ve kütüphaneyi önbelleğe alır ki internetsiz de açılsın.
// Modelleri transformers.js kendi önbelleğinde tutar, burada ellemiyoruz.
const CACHE = 'sesyazi-v7';
const CORE = ['./', 'index.html', 'worker.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// GitHub Pages bu başlıkları gönderemiyor; çok çekirdekli işlem (SharedArrayBuffer)
// için sayfa "cross-origin isolated" olmalı, başlıkları burada ekliyoruz.
function isolate(res) {
  if (!res || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('huggingface.co') || url.hostname.endsWith('hf.co')) return;
  const same = url.origin === self.location.origin;
  // önce ağ (güncel kalsın), olmazsa önbellek
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
      .then((res) => (same ? isolate(res) : res))
  );
});
