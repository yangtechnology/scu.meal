/**
 * MealFlow Cloudflare Workers — 店鋪與菜單完整管理模組 (Phase 5)
 * 對應 code.gs:
 * - saveStoreMenus / saveStoreMenu
 * - upsertSingleMenuItem / deleteSingleMenuItem
 * - saveStoreProfile / createStore / deleteStore
 * - updateStoresVisibility / simulateTraffic
 */

import {
  generateStableMenuItemId,
  getTodayTaipeiStr,
  normalizeClosedDaysList,
  normalizeWeeklyHours,
  safeJsonParse
} from './utils.js';

import {
  assertManagerAuthorized,
  assertMerchantAuthorized,
  hashMerchantPinWithServerSalt,
  issueMerchantSessionToken,
  kvSet
} from './auth.js';
import { invalidateCatalogCache } from './cache.js';

function packMenuOptionsMeta(m, todayStr) {
  const cleanOpts = (m.options && typeof m.options === 'object' && !Array.isArray(m.options)) ? { ...m.options } : {};
  delete cleanOpts.__soldOut;

  const isSoldOutBool = Boolean(m.soldOut);
  if (isSoldOutBool) {
    cleanOpts.__soldOutType = String(m.soldOutType || 'TODAY').toUpperCase() === 'PERMANENT' ? 'PERMANENT' : 'TODAY';
    cleanOpts.__soldOutDate = String(m.soldOutDate || todayStr).trim();
  } else {
    delete cleanOpts.__soldOutType;
    delete cleanOpts.__soldOutDate;
  }

  const dailyLimitVal = Math.max(0, parseInt(m.dailyLimit || 0, 10) || 0);
  if (dailyLimitVal > 0) cleanOpts.__dailyLimit = dailyLimitVal;
  else delete cleanOpts.__dailyLimit;

  const nameEnVal = String(m.nameEn || '').trim().slice(0, 80);
  if (nameEnVal) cleanOpts.__nameEn = nameEnVal;
  else delete cleanOpts.__nameEn;

  const stationVal = String(m.station || 'AUTO').trim().toUpperCase();
  if (stationVal && stationVal !== 'AUTO') cleanOpts.__station = stationVal;
  else delete cleanOpts.__station;

  const tileColorVal = String(m.tileColor || '').trim().slice(0, 20);
  if (tileColorVal) cleanOpts.__tileColor = tileColorVal;
  else delete cleanOpts.__tileColor;

  const sortOrderVal = m.sortOrder !== undefined && m.sortOrder !== '' ? Number(m.sortOrder) : NaN;
  const finalSortOrder = Number.isFinite(sortOrderVal) ? Math.round(sortOrderVal) : 999;
  if (Number.isFinite(sortOrderVal)) cleanOpts.__sortOrder = finalSortOrder;
  else delete cleanOpts.__sortOrder;

  const descVal = String(m.description || '').trim().slice(0, 160);
  if (descVal) cleanOpts.__description = descVal;
  else delete cleanOpts.__description;

  const tagsVal = Array.isArray(m.dietaryTags)
    ? m.dietaryTags.map(t => String(t).trim()).filter(Boolean).slice(0, 10)
    : [];
  if (tagsVal.length > 0) cleanOpts.__dietaryTags = tagsVal;
  else delete cleanOpts.__dietaryTags;

  const soldOutGroupVal = String(m.soldOutGroup || cleanOpts.__soldOutGroup || '').trim().slice(0, 40);
  if (soldOutGroupVal) cleanOpts.__soldOutGroup = soldOutGroupVal;
  else delete cleanOpts.__soldOutGroup;

  return { cleanOpts, isSoldOutBool, finalSortOrder };
}

export async function handleSaveStoreMenus(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  await assertManagerAuthorized(env, params, storeId);

  const incomingMenus = Array.isArray(params.menus) ? params.menus : [];
  const existingRes = await db.prepare('SELECT id, name, category FROM menus WHERE store_id = ?').bind(storeId).all();
  const existingIdByCatName = {};
  (existingRes.results || []).forEach(r => {
    const k = `${String(r.category || '招牌主餐').trim()}::${String(r.name || '').trim()}`;
    if (r.id) existingIdByCatName[k] = String(r.id);
  });

  const todayStr = getTodayTaipeiStr();
  const usedIds = new Set();
  const preparedRows = [];

  for (const m of incomingMenus) {
    if (!m || !String(m.name || '').trim()) continue;
    const cleanName = String(m.name || '').trim();
    const cleanCat = String(m.category || '招牌主餐').trim();
    const incomingId = String(m.id || '').trim();

    let itemId = (incomingId && !/^M\d{4}$/.test(incomingId) && !usedIds.has(incomingId))
      ? incomingId
      : (existingIdByCatName[`${cleanCat}::${cleanName}`] || generateStableMenuItemId(storeId, cleanName, cleanCat));
    if (usedIds.has(itemId)) {
      itemId = generateStableMenuItemId(storeId, `${cleanName}_${usedIds.size}`, cleanCat);
    }
    usedIds.add(itemId);

    const { cleanOpts, isSoldOutBool, finalSortOrder } = packMenuOptionsMeta(m, todayStr);
    preparedRows.push({
      id: itemId,
      storeId,
      name: cleanName,
      price: Math.max(0, Number(m.price) || 0),
      tag: String(m.tag || '').trim(),
      category: cleanCat,
      image: String(m.image || '').trim(),
      optionsJson: JSON.stringify(cleanOpts),
      soldOut: isSoldOutBool ? 1 : 0,
      sortOrder: finalSortOrder
    });
  }

  // 在 D1 transaction batch 中原子替換該店所有菜單（零斷層）
  const stmts = [db.prepare('DELETE FROM menus WHERE store_id = ?').bind(storeId)];
  for (const r of preparedRows) {
    stmts.push(
      db.prepare(`
        INSERT OR REPLACE INTO menus (id, store_id, name, price, tag, category, image, options_json, sold_out, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(r.id, r.storeId, r.name, r.price, r.tag, r.category, r.image, r.optionsJson, r.soldOut, r.sortOrder)
    );
  }
  await db.batch(stmts);
  invalidateCatalogCache();

  return { saved: true, storeId, menuCount: preparedRows.length };
}

export async function handleUpsertSingleMenuItem(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  const item = params.item || {};
  const cleanName = String(item.name || '').trim();
  const cleanCat = String(item.category || '招牌主餐').trim();
  if (!storeId || !cleanName) throw new Error('缺少店家編號或餐點名稱');
  await assertManagerAuthorized(env, params, storeId);

  let menuId = String(item.id || '').trim();
  if (menuId) {
    const ex = await db.prepare('SELECT id FROM menus WHERE id = ? AND store_id = ?').bind(menuId, storeId).first();
    if (!ex) {
      const byCatName = await db.prepare('SELECT id FROM menus WHERE store_id = ? AND category = ? AND name = ?').bind(storeId, cleanCat, cleanName).first();
      if (byCatName && byCatName.id) menuId = String(byCatName.id);
    }
  } else {
    const byCatName = await db.prepare('SELECT id FROM menus WHERE store_id = ? AND category = ? AND name = ?').bind(storeId, cleanCat, cleanName).first();
    menuId = (byCatName && byCatName.id) ? String(byCatName.id) : generateStableMenuItemId(storeId, cleanName, cleanCat);
  }

  const todayStr = getTodayTaipeiStr();
  const { cleanOpts, isSoldOutBool, finalSortOrder } = packMenuOptionsMeta(item, todayStr);

  await db.prepare(`
    INSERT INTO menus (id, store_id, name, price, tag, category, image, options_json, sold_out, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      price = excluded.price,
      tag = excluded.tag,
      category = excluded.category,
      image = excluded.image,
      options_json = excluded.options_json,
      sold_out = excluded.sold_out,
      sort_order = excluded.sort_order
  `).bind(
    menuId,
    storeId,
    cleanName,
    Math.max(0, Number(item.price) || 0),
    String(item.tag || '').trim(),
    cleanCat,
    String(item.image || '').trim(),
    JSON.stringify(cleanOpts),
    isSoldOutBool ? 1 : 0,
    finalSortOrder
  ).run();
  invalidateCatalogCache();

  return { updated: true, storeId, menuId };
}

export async function handleDeleteSingleMenuItem(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  const menuId = String(params.menuId || '').trim();
  if (!storeId || !menuId) throw new Error('缺少店家編號或品項 ID');
  await assertManagerAuthorized(env, params, storeId);

  const res = await db.prepare('DELETE FROM menus WHERE id = ? AND store_id = ?').bind(menuId, storeId).run();
  const changed = Number(res && res.meta && res.meta.changes) || 0;
  if (changed > 0) invalidateCatalogCache();
  return { deleted: changed > 0, storeId, menuId };
}

export async function handleBatchApplyMenuOptions(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  await assertManagerAuthorized(env, params, storeId);

  const rawTargetIds = Array.isArray(params.targetMenuIds) ? params.targetMenuIds : [];
  const targetMenuIds = Array.from(
    new Set(rawTargetIds.map(id => String(id || '').trim()).filter(Boolean))
  );
  if (targetMenuIds.length === 0) {
    throw new Error('請至少選擇 1 項要套用客製化選項的餐點');
  }

  const incomingOptions = params.options;
  if (!incomingOptions || typeof incomingOptions !== 'object' || Array.isArray(incomingOptions)) {
    throw new Error('客製化選項格式無效 (options 須為物件)');
  }

  const cleanIncomingOptions = {};
  for (const [k, v] of Object.entries(incomingOptions)) {
    if (!k || k.startsWith('__')) continue;
    cleanIncomingOptions[k] = v;
  }

  const mode = String(params.mode || 'replace').trim().toLowerCase() === 'merge' ? 'merge' : 'replace';

  const existingRes = await db
    .prepare('SELECT id, options_json FROM menus WHERE store_id = ?')
    .bind(storeId)
    .all();

  const targetSet = new Set(targetMenuIds);
  const stmts = [];
  const updatedMenuIds = [];

  for (const row of (existingRes.results || [])) {
    const rowId = String(row.id || '').trim();
    if (!rowId || !targetSet.has(rowId)) continue;

    const existingRaw = safeJsonParse(row.options_json, {});
    const preservedMeta = {};
    const existingCustomOpts = {};

    if (existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)) {
      for (const [k, v] of Object.entries(existingRaw)) {
        if (k.startsWith('__')) {
          preservedMeta[k] = v;
        } else {
          existingCustomOpts[k] = v;
        }
      }
    }

    const nextOptionsObj = mode === 'merge'
      ? { ...existingCustomOpts, ...cleanIncomingOptions, ...preservedMeta }
      : { ...cleanIncomingOptions, ...preservedMeta };

    stmts.push(
      db.prepare('UPDATE menus SET options_json = ? WHERE id = ? AND store_id = ?')
        .bind(JSON.stringify(nextOptionsObj), rowId, storeId)
    );
    updatedMenuIds.push(rowId);
  }

  if (stmts.length === 0) {
    throw new Error('找不到符合的目標餐點，請先重新同步雲端菜單後再試');
  }

  await db.batch(stmts);

  return {
    updated: true,
    storeId,
    mode,
    updatedCount: updatedMenuIds.length,
    updatedMenuIds
  };
}

export async function handleSaveStoreProfile(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  await assertManagerAuthorized(env, params, storeId);

  const row = await db.prepare('SELECT * FROM stores WHERE id = ? AND deleted_at IS NULL').bind(storeId).first();
  if (!row) throw new Error('找不到店家: ' + storeId);

  const nextCampus = (params.campus !== undefined && String(params.campus).trim()) ? String(params.campus).trim() : row.campus;
  const nextName = (params.name !== undefined && String(params.name).trim()) ? String(params.name).trim() : row.name;
  const nextCategory = (params.category !== undefined && String(params.category).trim()) ? String(params.category).trim() : row.category;

  const prevMeta = safeJsonParse(row.custom_meta_json, {});
  const nextWeeklyHours = params.weeklyHours !== undefined
    ? normalizeWeeklyHours(params.weeklyHours)
    : normalizeWeeklyHours(prevMeta.weeklyHours);
  let nextClosedDays = params.closedDays !== undefined
    ? normalizeClosedDaysList(params.closedDays)
    : normalizeClosedDaysList(prevMeta.closedDays);

  if (params.weeklyHours !== undefined) {
    const cSet = new Set(nextClosedDays);
    for (let d = 0; d <= 6; d++) {
      const rule = nextWeeklyHours[String(d)];
      if (rule && rule.closed) cSet.add(d);
      else if (rule && !rule.closed) cSet.delete(d);
    }
    nextClosedDays = Array.from(cSet).sort((a, b) => a - b);
  }

  const nextMeta = {
    ...prevMeta,
    icon: params.icon !== undefined ? String(params.icon).trim() : (prevMeta.icon || ''),
    openTime: params.openTime !== undefined ? String(params.openTime).trim() : (prevMeta.openTime || '10:30'),
    closeTime: params.closeTime !== undefined ? String(params.closeTime).trim() : (prevMeta.closeTime || '19:30'),
    breakStartTime: params.breakStartTime !== undefined ? String(params.breakStartTime).trim() : (prevMeta.breakStartTime || ''),
    breakEndTime: params.breakEndTime !== undefined ? String(params.breakEndTime).trim() : (prevMeta.breakEndTime || ''),
    closedDays: nextClosedDays,
    weeklyHours: nextWeeklyHours,
    reserveLeadMinutes: params.reserveLeadMinutes !== undefined
      ? Math.max(10, Math.min(90, Number(params.reserveLeadMinutes) || 25))
      : (prevMeta.reserveLeadMinutes || 25)
  };

  await db.prepare(`
    UPDATE stores SET campus = ?, name = ?, category = ?, custom_meta_json = ?
    WHERE id = ?
  `).bind(nextCampus, nextName, nextCategory, JSON.stringify(nextMeta), storeId).run();
  invalidateCatalogCache();

  return { updated: true, storeId, closedDays: nextClosedDays, weeklyHours: nextWeeklyHours };
}

export async function handleCreateStore(env, params = {}) {
  const db = env.DB;
  await assertManagerAuthorized(env, params, '');

  const name = String(params.name || '').trim();
  const campus = String(params.campus || '雙溪校區').trim();
  const category = String(params.category || '人氣特餐・便當').trim();
  const icon = String(params.icon || '🍱').trim();
  const newStorePin = String(params.newStorePin || '').trim();
  if (!name) throw new Error('請輸入新餐廳名稱');
  if (!/^\d{4,8}$/.test(newStorePin)) {
    throw new Error('建立新餐廳時請設定該店專屬的 4 至 8 位數字管理密碼 (PIN)');
  }

  const rowsRes = await db.prepare('SELECT id FROM stores').all();
  let maxNum = 0;
  (rowsRes.results || []).forEach(r => {
    const m = String(r.id || '').match(/^S(\d+)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const nextId = 'S' + String(maxNum + 1).padStart(2, '0');
  const openTime = String(params.openTime || '10:30').trim();
  const closeTime = String(params.closeTime || '19:30').trim();
  const customMeta = { icon, openTime, closeTime, visibleToStudents: false };

  await db.prepare(`
    INSERT INTO stores (
      id, campus, name, category, max_capacity_per_15min, base_prep_minutes,
      cutlery_price, promo_mode, promo_text, promo_discount, rating, is_open, custom_meta_json, deleted_at
    ) VALUES (?, ?, ?, ?, 20, 4, 1, 'none', '無優惠', 0, 4.8, 1, ?, NULL)
  `).bind(nextId, campus, name, category, JSON.stringify(customMeta)).run();

  await kvSet(db, 'MERCHANT_PIN_HMAC_STORE_' + nextId, await hashMerchantPinWithServerSalt(env, newStorePin));
  invalidateCatalogCache();
  const newStoreToken = await issueMerchantSessionToken(env, nextId, 'MANAGER', '店長');

  return {
    created: true,
    sessionToken: newStoreToken.sessionToken,
    expiresAt: newStoreToken.expiresAt,
    authorizedStoreId: newStoreToken.authorizedStoreId,
    store: {
      id: nextId,
      campus,
      name,
      category,
      icon,
      openTime,
      closeTime,
      isOpen: true,
      maxCapacityPer15Min: 20,
      basePrepMinutes: 4,
      avgPrepMinutes: 4,
      cutleryPrice: 1,
      promoMode: 'none',
      promoText: '無優惠',
      promoDiscount: 0,
      rating: 4.8,
      menus: []
    }
  };
}

export async function handleDeleteStore(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號');
  await assertManagerAuthorized(env, params, storeId);

  await db.prepare('UPDATE stores SET deleted_at = ? WHERE id = ?').bind(Date.now(), storeId).run();
  invalidateCatalogCache();
  return { deleted: true, storeId };
}

export async function handleUpdateStoresVisibility(env, params = {}) {
  const db = env.DB;
  await assertManagerAuthorized(env, params, '');

  const visMap = (params.visibilityMap && typeof params.visibilityMap === 'object') ? params.visibilityMap : {};
  const visibleIds = Array.isArray(params.visibleStoreIds) ? params.visibleStoreIds.map(s => String(s).trim()) : null;

  const res = await db.prepare('SELECT id, custom_meta_json FROM stores WHERE deleted_at IS NULL').all();
  const stmts = [];
  const updatedVisibility = {};

  for (const row of (res.results || [])) {
    const sid = String(row.id);
    const meta = safeJsonParse(row.custom_meta_json, {});
    let nextVis;
    if (visibleIds !== null) {
      nextVis = visibleIds.includes(sid);
    } else if (visMap[sid] !== undefined) {
      nextVis = Boolean(visMap[sid]);
    } else {
      continue;
    }
    meta.visibleToStudents = nextVis;
    updatedVisibility[sid] = nextVis;
    stmts.push(
      db.prepare('UPDATE stores SET custom_meta_json = ? WHERE id = ?').bind(JSON.stringify(meta), sid)
    );
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
    invalidateCatalogCache();
  }
  return { updated: true, visibilityMap: updatedVisibility };
}

export async function handleSimulateTraffic(env, params = {}) {
  await assertManagerAuthorized(env, params, '');
  await kvSet(env.DB, 'SIM_QUEUE_OFFSETS', JSON.stringify({}));
  return { simulated: false, mode: 'NORMAL' };
}
