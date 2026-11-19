// =========================================================================
// MealFlow v25.0 — 潔淨高效 PWA Service Worker
// 三-2：徹底移除易遭瀏覽器強殺的 5 分鐘遞迴 setTimeout 輪詢迴圈；專注離線快取、Web Push 與通知點擊導航
// =========================================================================
const CACHE_NAME = 'mealflow-pwa-v25';
const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './order/',
  './order/index.html',
  './store/',
  './store/index.html',
  './board/',
  './board/index.html',
  './board/qr.js?v=25.0',
  './board/manifest.json',
  './styles.css?v=25.0',
  './i18n.js?v=25.0',
  './app.js?v=25.0',
  './merchant.js?v=25.0',
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

async function showSwOrderNotification(title, body, tag, targetUrl, orderId) {
  try {
    await self.registration.showNotification(title, {
      body: body || '',
      icon: './logo-icon.jpg',
      badge: './logo-icon.jpg',
      tag: tag || ('mealflow-notify-' + Date.now()),
      renotify: true,
      requireInteraction: true,
      vibrate: [450, 150, 450, 150, 700],
      data: {
        url: targetUrl || './order/',
        orderId: orderId || ''
      },
      actions: [
        { action: 'open', title: '🎟️ 查看取餐單' },
        { action: 'dismiss', title: '稍後' }
      ]
    });
  } catch (e) {}
}

self.addEventListener('push', (event) => {
  let payload = {
    title: '🔔 MealFlow 餐點狀態通知',
    body: '您的訂單狀態已更新，請點擊查看最新進度。',
    tag: 'mealflow-push-' + Date.now(),
    url: './order/'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch (e) {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    showSwOrderNotification(
      payload.title,
      payload.body,
      payload.tag || 'mealflow-order-alert',
      payload.url || './order/',
      payload.orderId || ''
    )
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SHOW_SYSTEM_NOTIFICATION') {
    const title = data.title || '🔔 MealFlow 即時通知';
    const tag = data.tag || ('mealflow-notify-' + Date.now());
    event.waitUntil(
      showSwOrderNotification(title, data.body || '', tag, data.url || './order/', data.orderId || '')
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : './order/';
  const targetOrderId = (event.notification.data && event.notification.data.orderId) || '';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            url: targetUrl,
            orderId: targetOrderId
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
    return;
  }

  // Network-First + 版本號容錯快取比對 (ignoreSearch: true)
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200 && url.origin === self.location.origin) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return networkRes;
      })
      .catch(() =>
        caches.match(req)
          .then((exact) => exact || caches.match(req, { ignoreSearch: true }))
          .then((cached) => cached || caches.match('./index.html'))
      )
  );
});
