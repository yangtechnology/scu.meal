/**
 * MealFlow Cloudflare Workers — Isolate 記憶體層 60 秒快取 (stores / menus / kv_settings)
 * 目的：消除每次 initBundle / getPendingPrintJobs / submitOrder 重複全表掃描 menus 與 kv_settings
 */

const CACHE_TTL_MS = 60 * 1000;

let catalogCache = {
  expiresAt: 0,
  stores: null,
  menus: null,
  storeById: null,
  menusByStoreId: null
};

let kvCache = {
  expiresAt: 0,
  map: null
};

// ==================== Stores & Menus 60s Cache ====================

export async function getCachedStoresAndMenus(db, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && catalogCache.stores && now < catalogCache.expiresAt) {
    return {
      stores: catalogCache.stores,
      menus: catalogCache.menus,
      storeById: catalogCache.storeById,
      menusByStoreId: catalogCache.menusByStoreId
    };
  }

  const [storesRes, menusRes] = await Promise.all([
    db.prepare('SELECT * FROM stores WHERE deleted_at IS NULL ORDER BY id ASC').all(),
    db.prepare('SELECT * FROM menus ORDER BY store_id ASC, sort_order ASC, id ASC').all()
  ]);

  const stores = storesRes.results || [];
  const menus = menusRes.results || [];
  const storeById = new Map();
  const menusByStoreId = new Map();

  for (const s of stores) {
    storeById.set(String(s.id).trim().toUpperCase(), s);
  }
  for (const m of menus) {
    const sid = String(m.store_id || '').trim().toUpperCase();
    if (!menusByStoreId.has(sid)) menusByStoreId.set(sid, []);
    menusByStoreId.get(sid).push(m);
  }

  catalogCache = {
    expiresAt: now + CACHE_TTL_MS,
    stores,
    menus,
    storeById,
    menusByStoreId
  };

  return { stores, menus, storeById, menusByStoreId };
}

export function invalidateCatalogCache() {
  catalogCache.expiresAt = 0;
  catalogCache.stores = null;
  catalogCache.menus = null;
  catalogCache.storeById = null;
  catalogCache.menusByStoreId = null;
}

// ==================== kv_settings 60s Cache ====================

export async function getCachedKvMap(db, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && kvCache.map && now < kvCache.expiresAt) {
    return kvCache.map;
  }

  const res = await db.prepare('SELECT key, value FROM kv_settings').all();
  const map = new Map();
  for (const r of (res.results || [])) {
    if (r && r.key !== undefined) {
      map.set(String(r.key), String(r.value ?? ''));
    }
  }

  kvCache = {
    expiresAt: now + CACHE_TTL_MS,
    map
  };
  return map;
}

export function setKvCacheEntry(key, value) {
  if (kvCache.map && Date.now() < kvCache.expiresAt) {
    kvCache.map.set(String(key), String(value));
  }
}

export function deleteKvCacheEntry(key) {
  if (kvCache.map) {
    kvCache.map.delete(String(key));
  }
}

export function invalidateKvCache() {
  kvCache.expiresAt = 0;
  kvCache.map = null;
}
