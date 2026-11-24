/**
 * MealFlow 雙軌後端與 Firebase Firestore 即時推播統一設定檔
 *
 * 零停機切換方式：
 * 1. 平行測試期（DEFAULT_BACKEND = 'gas'）：
 *    - 一般網址照舊連 Google Apps Script（完全不影響現場營業）
 *    - 網址帶 ?env=cf       ➔ 立刻切換連 Cloudflare Workers + Firestore 即時推播
 *    - 網址帶 ?env=local    ➔ 連本機 wrangler dev (http://127.0.0.1:8787)
 *    - 網址帶 ?env=gas      ➔ 強制退回 GAS 冷備援
 * 2. 正式上線期：
 *    - 把 CF_WORKER_URL 改成你的正式 Worker 網址
 *    - 把 FIREBASE_CONFIG 貼上 Firebase Console 的網頁設定
 *    - 將 DEFAULT_BACKEND 改為 'cf' 推上 GitHub Pages 即可！
 */
(function () {
  const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbzN2e0bi-jQG5RvGBpZYu5190f2JfX-6P1C8DxUy2aPyrrpbJpBl0oaTwYFRhAyBl8/exec';

  const CONFIG = {
    // 預設後端：'gas'（平行測試期）或 'cf'（正式切換 Cloudflare Workers）
    DEFAULT_BACKEND: 'cf',

    GAS_URL: DEFAULT_GAS_URL,
    CF_WORKER_URL: 'https://mealflow-api.mealflow-scu.workers.dev',
    LOCAL_WORKER_URL: 'http://127.0.0.1:8787',

    FIREBASE_CONFIG: {
      apiKey: 'AIzaSyCO9AMGu9jZdPpvNzScWOK97qnodZBGbIU',
      authDomain: 'mealflow-live.firebaseapp.com',
      projectId: 'mealflow-live',
      storageBucket: 'mealflow-live.firebasestorage.app',
      messagingSenderId: '879400731863',
      appId: '1:879400731863:web:5da69e8a34b1ea55c0dc92'
    }
  };

  function getSelectedEnvMode() {
    try {
      const sp = new URLSearchParams(window.location.search);
      const qEnv = String(sp.get('env') || '').trim().toLowerCase();
      if (qEnv === 'cf' || qEnv === 'local' || qEnv === 'gas') {
        try { sessionStorage.setItem('mealflow_env_mode', qEnv); } catch {}
        return qEnv;
      }
      const saved = String(sessionStorage.getItem('mealflow_env_mode') || '').trim().toLowerCase();
      if (saved === 'cf' || saved === 'local' || saved === 'gas') return saved;
    } catch {}
    return CONFIG.DEFAULT_BACKEND;
  }

  function resolveApiUrl() {
    try {
      const sp = new URLSearchParams(window.location.search);
      const customCfUrl = String(sp.get('cfUrl') || '').trim();
      if (customCfUrl && /^https?:\/\//i.test(customCfUrl)) {
        try { sessionStorage.setItem('mealflow_custom_cf_url', customCfUrl); } catch {}
        return customCfUrl;
      }
      const savedCustom = String(sessionStorage.getItem('mealflow_custom_cf_url') || '').trim();
      const mode = getSelectedEnvMode();
      if (mode === 'local') return CONFIG.LOCAL_WORKER_URL;
      if (mode === 'cf') return savedCustom || CONFIG.CF_WORKER_URL || CONFIG.GAS_URL;
    } catch {}
    return CONFIG.GAS_URL;
  }

  function isCloudflareMode() {
    const mode = getSelectedEnvMode();
    if (mode === 'local') return true;
    if (mode === 'cf') {
      const url = resolveApiUrl();
      return Boolean(url && url !== CONFIG.GAS_URL);
    }
    return false;
  }

  function isFirebaseConfigured() {
    const fc = CONFIG.FIREBASE_CONFIG;
    return Boolean(fc && String(fc.apiKey || '').trim() && String(fc.projectId || '').trim());
  }

  window.MEALFLOW_REALTIME_CONFIG = {
    ...CONFIG,
    getSelectedEnvMode,
    resolveApiUrl,
    isCloudflareMode,
    isFirebaseConfigured
  };
})();
