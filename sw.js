const CACHE_NAME = 'mealflow-pwa-v16';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './order/',
  './order/index.html',
  './store/',
  './store/index.html',
  './styles.css',
  './app.js',
  './jsQR.min.js',
  './logo-icon.jpg',
  './logo-text.png',
  './manifest.json',
  './order/manifest.json',
  './store/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
    return;
  }

  // 採用 Network-First 搭配離線快取備援，確保有網路時永遠載入最新程式碼，斷網時可離線開啟 POS / 點餐頁
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200 && url.origin === self.location.origin) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return networkRes;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
