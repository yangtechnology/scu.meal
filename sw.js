const CACHE_NAME = 'mealflow-pwa-v17';
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

// ==================== #1 Web Push 與系統層級背景通知處理 ====================
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

  const options = {
    body: payload.body,
    icon: './logo-icon.jpg',
    badge: './logo-icon.jpg',
    tag: payload.tag || 'mealflow-order-alert',
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 600],
    data: {
      url: payload.url || './order/',
      orderId: payload.orderId || ''
    },
    actions: [
      { action: 'open', title: '🎟️ 查看取餐單 / 處理訂單' },
      { action: 'dismiss', title: '關閉' }
    ]
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// 接收前端或背景輪詢委派之高優先級系統通知（支援手機鎖屏前/背景分頁狀態）
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SHOW_SYSTEM_NOTIFICATION') {
    const title = data.title || '🔔 MealFlow 即時通知';
    const options = {
      body: data.body || '',
      icon: './logo-icon.jpg',
      badge: './logo-icon.jpg',
      tag: data.tag || ('mealflow-notify-' + Date.now()),
      renotify: true,
      requireInteraction: Boolean(data.requireInteraction !== false),
      vibrate: Array.isArray(data.vibrate) ? data.vibrate : [350, 120, 350, 120, 500],
      data: {
        url: data.url || './order/',
        orderId: data.orderId || ''
      },
      actions: [
        { action: 'open', title: data.actionTitle || '🚀 立即開啟查看' }
      ]
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : './order/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            url: targetUrl,
            orderId: (event.notification.data && event.notification.data.orderId) || ''
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
