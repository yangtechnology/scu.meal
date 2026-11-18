const CACHE_NAME = 'mealflow-pwa-v19';
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

// ==================== #1 背景自治輪詢與系統級推播引擎 (iPhone / Android 鎖屏與背景通知保障) ====================
const swWatchState = {
  gasUrl: '',
  clientDeviceId: '',
  watchedOrderIds: [],
  knownOrderStateMap: {}, // orderId -> { status, notifyCount, pickupNumber, storeName, verificationCode }
  storeMode: false,
  merchantAuthToken: '',
  merchantStoreId: '',
  knownStoreOrderIds: {},
  isLoopRunning: false,
  lastLoopActiveTs: 0,
  pollTimerId: null
};

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
        { action: 'open', title: '🎟️ 立即開啟查看取餐單' },
        { action: 'dismiss', title: '稍後' }
      ]
    });
  } catch (e) {}
}

async function broadcastToWindowClients(payload) {
  try {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      try {
        client.postMessage(payload);
      } catch (e) {}
    }
  } catch (e) {}
}

async function checkSingleWatchedOrderFromSw(orderId) {
  if (!swWatchState.gasUrl || !orderId) return null;
  try {
    const res = await fetch(swWatchState.gasUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getOrder',
        orderId: orderId,
        clientDeviceId: swWatchState.clientDeviceId || ''
      })
    });
    const data = await res.json();
    if (data && data.success && data.order) {
      return data.order;
    }
  } catch (e) {}
  return null;
}

async function pollCloudOrdersFromServiceWorker() {
  if (!swWatchState.gasUrl) return;
  const hasStudentOrders = Array.isArray(swWatchState.watchedOrderIds) && swWatchState.watchedOrderIds.length > 0;
  const hasStoreWatch = Boolean(swWatchState.storeMode && swWatchState.merchantAuthToken && swWatchState.merchantStoreId);
  if (!hasStudentOrders && !hasStoreWatch) return;

  try {
    const reqBody = {
      action: 'initBundle',
      myOrderIds: swWatchState.watchedOrderIds.slice(0, 20),
      clientDeviceId: swWatchState.clientDeviceId || ''
    };
    if (hasStoreWatch) {
      reqBody.merchantAuthToken = swWatchState.merchantAuthToken;
      reqBody.storeId = swWatchState.merchantStoreId;
    }

    const res = await fetch(swWatchState.gasUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(reqBody)
    });
    const data = await res.json();
    const payload = (data && data.bundle) ? data.bundle : data;
    let cloudOrders = (payload && Array.isArray(payload.orders))
      ? payload.orders
      : ((payload && Array.isArray(payload.recentOrders)) ? payload.recentOrders : []);

    // 若學生端追蹤中的訂單未出現在 initBundle (例如舊版後端部署)，逐筆透過 getOrder 查詢最新狀態
    if (hasStudentOrders) {
      const returnedIds = new Set(cloudOrders.map((o) => String(o && o.orderId)));
      for (const wid of swWatchState.watchedOrderIds.slice(0, 5)) {
        if (!returnedIds.has(String(wid))) {
          const singleOrd = await checkSingleWatchedOrderFromSw(wid);
          if (singleOrd) {
            cloudOrders.push(singleOrd);
          }
        }
      }
    }

    // 1. 檢查學生端追蹤訂單是否轉為「可取餐」或再次叫號 (notifyCount 增加)
    if (hasStudentOrders && cloudOrders.length > 0) {
      for (const wid of swWatchState.watchedOrderIds) {
        const ord = cloudOrders.find((o) => o && String(o.orderId) === String(wid));
        if (!ord) continue;

        const curStatus = String(ord.status || '');
        const curNotifyCount = Math.max(0, Number(ord.notifyCount) || (curStatus === '可取餐' ? 1 : 0));
        const prev = swWatchState.knownOrderStateMap[wid];

        const transitionedToReady = curStatus === '可取餐' && (!prev || prev.status !== '可取餐' || curNotifyCount > (prev.notifyCount || 0));

        swWatchState.knownOrderStateMap[wid] = {
          status: curStatus,
          notifyCount: curNotifyCount,
          pickupNumber: ord.pickupNumber || '',
          storeName: ord.storeName || 'MealFlow'
        };

        if (transitionedToReady) {
          const verCode = (ord.verificationCode && ord.verificationCode !== '******') ? ord.verificationCode : '';
          const targetUrl = `./order/?id=${encodeURIComponent(ord.orderId)}${verCode ? '&v=' + encodeURIComponent(verCode) : ''}`;
          await showSwOrderNotification(
            `🔔 取餐號 #${ord.pickupNumber} 餐點好囉！`,
            `【${ord.storeName || '學餐櫃位'}】已呼叫您取餐（第 ${Math.max(1, curNotifyCount)} 次通知），請前往櫃檯出示憑證領取！`,
            `pickup-ready-${ord.orderId}-${curNotifyCount}`,
            targetUrl,
            ord.orderId
          );
          await broadcastToWindowClients({
            type: 'SW_ORDER_READY_ALERT',
            order: ord
          });
        }
      }
    }

    // 2. 檢查店家端是否有新進「製作中」訂單
    if (hasStoreWatch && cloudOrders.length > 0) {
      for (const ord of cloudOrders) {
        if (!ord || !ord.orderId) continue;
        if (String(ord.storeId) !== String(swWatchState.merchantStoreId)) continue;
        if (!swWatchState.knownStoreOrderIds[ord.orderId]) {
          swWatchState.knownStoreOrderIds[ord.orderId] = true;
          if (ord.status === '製作中') {
            await showSwOrderNotification(
              `🔔 新訂單進單 #${ord.pickupNumber} (${ord.storeName || ''})`,
              `應收 NT$${ord.finalTotal} (${ord.paymentMethod || '現場'}) ・ 點擊返回 KDS 廚房控單`,
              `kds-new-${ord.orderId}`,
              `./store/?store=${encodeURIComponent(ord.storeId)}&tab=kds`,
              ord.orderId
            );
            await broadcastToWindowClients({
              type: 'SW_NEW_KDS_ORDER',
              order: ord
            });
          }
        }
      }
    }
  } catch (e) {}
}

function startSwAutonomousWatchChunk(event) {
  const hasWork = (Array.isArray(swWatchState.watchedOrderIds) && swWatchState.watchedOrderIds.length > 0) ||
                  Boolean(swWatchState.storeMode && swWatchState.merchantAuthToken);
  if (!hasWork || !swWatchState.gasUrl) return;

  // 若已在執行中，僅刷新時間戳記
  const now = Date.now();
  if (swWatchState.isLoopRunning && (now - swWatchState.lastLoopActiveTs) < 8000) {
    return;
  }

  swWatchState.isLoopRunning = true;
  swWatchState.lastLoopActiveTs = now;

  // 每次透過 waitUntil 維持 Service Worker 背景執行緒甦醒進行連續巡檢 (支援鎖屏與背景切出長達數十分鐘)
  const watchPromise = (async () => {
    try {
      for (let step = 0; step < 60; step++) {
        const stillHasWork = (Array.isArray(swWatchState.watchedOrderIds) && swWatchState.watchedOrderIds.length > 0) ||
                             Boolean(swWatchState.storeMode && swWatchState.merchantAuthToken);
        if (!stillHasWork) break;
        swWatchState.lastLoopActiveTs = Date.now();
        await pollCloudOrdersFromServiceWorker();
        await new Promise((r) => setTimeout(r, 4500));
      }
    } finally {
      swWatchState.isLoopRunning = false;
    }
  })();

  if (event && typeof event.waitUntil === 'function') {
    event.waitUntil(watchPromise);
  }
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

// 接收前端同步之追蹤清單、背景心跳與即時系統通知請求
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SHOW_SYSTEM_NOTIFICATION') {
    const title = data.title || '🔔 MealFlow 即時通知';
    const tag = data.tag || ('mealflow-notify-' + Date.now());
    if (data.orderId && data.orderStatus) {
      swWatchState.knownOrderStateMap[data.orderId] = {
        status: data.orderStatus,
        notifyCount: Math.max(1, Number(data.notifyCount) || 1),
        pickupNumber: data.pickupNumber || '',
        storeName: data.storeName || ''
      };
    }
    event.waitUntil(
      showSwOrderNotification(title, data.body || '', tag, data.url || './order/', data.orderId || '')
    );
    return;
  }

  if (data.type === 'SYNC_WATCHED_ORDERS') {
    if (data.gasUrl) swWatchState.gasUrl = String(data.gasUrl);
    if (data.clientDeviceId) swWatchState.clientDeviceId = String(data.clientDeviceId);
    if (Array.isArray(data.watchedOrderIds)) {
      swWatchState.watchedOrderIds = data.watchedOrderIds.map((id) => String(id)).filter(Boolean);
    }
    if (data.knownStateMap && typeof data.knownStateMap === 'object') {
      Object.keys(data.knownStateMap).forEach((oid) => {
        const entry = data.knownStateMap[oid];
        if (!entry) return;
        const existing = swWatchState.knownOrderStateMap[oid];
        if (!existing || (Number(entry.notifyCount) || 0) >= (Number(existing.notifyCount) || 0)) {
          swWatchState.knownOrderStateMap[oid] = {
            status: String(entry.status || ''),
            notifyCount: Math.max(0, Number(entry.notifyCount) || 0),
            pickupNumber: String(entry.pickupNumber || ''),
            storeName: String(entry.storeName || '')
          };
        }
      });
    }
    swWatchState.storeMode = Boolean(data.storeMode);
    swWatchState.merchantAuthToken = String(data.merchantAuthToken || '');
    swWatchState.merchantStoreId = String(data.merchantStoreId || '');
    if (Array.isArray(data.knownStoreOrderIds)) {
      data.knownStoreOrderIds.forEach((oid) => {
        if (oid) swWatchState.knownStoreOrderIds[oid] = true;
      });
    }
    startSwAutonomousWatchChunk(event);
    return;
  }

  if (data.type === 'KEEP_ALIVE_PING') {
    startSwAutonomousWatchChunk(event);
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
