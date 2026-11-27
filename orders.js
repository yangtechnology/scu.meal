/**
 * MealFlow Cloudflare Workers — 核心訂單、無鎖原子單號、KDS 狀態、出單佇列、店鋪/菜單 MVP 模組
 * 100% 相容原 code.gs action 介面與回傳結構
 */

import {
  AI_DISCOUNT_MIN_SUBTOTAL,
  LARGE_ORDER_DEPOSIT_THRESHOLD,
  buildDailyMenuSoldMap,
  buildSlotQuotaMap,
  buildStoreQueueProgressMap,
  calcAiUtilityScore,
  calcDynamicPrepMinutes,
  calcOrderRemainingWorkload,
  computeAiTrafficRecommendations,
  dbRowToOrderObject,
  evaluateComboDiscounts,
  evaluateEffectiveSoldOut,
  evaluateOrderLifecycleStatus,
  evaluateStoreBusinessHours,
  extractPhoneLast3,
  getDayOfWeekForDateStr,
  getTaipeiDateParts,
  getTodayTaipeiStr,
  isCorruptedOrMockOrder,
  isOrderActivelyCooking,
  isPeakHourSlot,
  normalizeClosedDaysList,
  normalizeComboDiscounts,
  normalizeDateStr,
  normalizeTimeStr,
  normalizeWeeklyHours,
  parseMenuRowOptionsAndSoldOut,
  parseTimeStrToMins,
  resolveStoreDaySchedule,
  safeJsonParse,
  sanitizeOrderForClientOutput,
  validateTaiwanTaxId
} from './utils.js';

import {
  appendSystemAuditEntry,
  assertManagerAuthorized,
  assertMerchantAuthorized,
  assertPrinterBridgeAuthorized,
  generateOrderVerificationCodeOnServer,
  getOrCreateStorePrinterKey,
  getPublicStaffAccounts,
  getStoreStaffList,
  getStoredStoreStaffPinHash,
  isMerchantRequestValid,
  kvGet,
  kvSet,
  parseVerifiedMerchantSession
} from './auth.js';

import {
  buildPrintJobPayload,
  removePrintQueueDoc,
  syncOrderToFirestore
} from './firestore.js';

import {
  dispatchOrderNotification,
  refundLinePayTransaction,
  updateMemberStatsFromOrder,
  verifyLinePayAuthToken
} from './integrations.js';

import {
  getCachedStoresAndMenus,
  invalidateCatalogCache
} from './cache.js';

// 輕量記憶體滑動視窗限流（每個 Worker Isolate 獨立防刷單；不浪費 D1 寫入配額）
const rateBuckets = new Map();

function checkAndIncrementRateBucket(key, limit, windowMs) {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, count: 1 };
  }
  if (entry.count >= limit) {
    return { allowed: false, count: entry.count };
  }
  entry.count += 1;
  return { allowed: true, count: entry.count };
}

// ==================== 1. 無鎖 SQL 原子單號循環產生器 ====================

/**
 * 徹底取代 GAS ScriptLock：100 人同時下單零撞號
 * - POS (isPos=true):  001 ~ 100 循環（滿 100 接回 001）
 * - 線上 (isPos=false): 101 ~ 200 循環（滿 200 接回 101）
 */
export async function getNextPickupNumber(db, storeId, pickupDate, isPos) {
  const channel = isPos ? 'POS' : 'ONLINE';
  const row = await db.prepare(`
    INSERT INTO pickup_counters (store_id, pickup_date, channel, seq_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT (store_id, pickup_date, channel)
    DO UPDATE SET seq_count = seq_count + 1
    RETURNING seq_count
  `).bind(String(storeId), String(pickupDate), channel).first();

  const seq = Math.max(1, Number(row && row.seq_count) || 1);
  const idx = ((seq - 1) % 100) + 1; // 1 ~ 100
  const finalNum = isPos ? idx : (100 + idx); // POS: 1..100, ONLINE: 101..200
  return String(finalNum).padStart(3, '0');
}

// ==================== 2. 內部資料庫讀取與佇列計算輔助 ====================

async function loadActiveStoresAndMenus(db, forceRefresh = false) {
  return getCachedStoresAndMenus(db, forceRefresh);
}

async function loadRecentOrders(db, limit = 80, storeId = '', maxAgeDays = 3) {
  const safeLimit = Math.max(10, Math.min(500, Number(limit) || 80));
  const cutoffTs = maxAgeDays > 0 ? (Date.now() - maxAgeDays * 86400 * 1000) : 0;
  let res;
  if (storeId && cutoffTs > 0) {
    res = await db.prepare(
      'SELECT * FROM orders WHERE store_id = ? AND created_at_ts >= ? ORDER BY created_at_ts DESC LIMIT ?'
    ).bind(String(storeId), cutoffTs, safeLimit).all();
  } else if (storeId) {
    res = await db.prepare(
      'SELECT * FROM orders WHERE store_id = ? ORDER BY created_at_ts DESC LIMIT ?'
    ).bind(String(storeId), safeLimit).all();
  } else if (cutoffTs > 0) {
    res = await db.prepare(
      'SELECT * FROM orders WHERE created_at_ts >= ? ORDER BY created_at_ts DESC LIMIT ?'
    ).bind(cutoffTs, safeLimit).all();
  } else {
    res = await db.prepare(
      'SELECT * FROM orders ORDER BY created_at_ts DESC LIMIT ?'
    ).bind(safeLimit).all();
  }
  return (res.results || [])
    .map(dbRowToOrderObject)
    .filter(o => o && !isCorruptedOrMockOrder(o));
}

async function loadOrderById(db, orderId) {
  const cleanId = String(orderId || '').trim();
  if (!cleanId) return null;
  const row = await db.prepare('SELECT * FROM orders WHERE order_id = ?').bind(cleanId).first();
  return row ? dbRowToOrderObject(row) : null;
}

function getStoreAutoCompleteMinutes(customMeta) {
  const raw = parseInt(customMeta && customMeta.autoCompleteMinutes, 10);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(5, Math.min(240, raw));
}

function shouldAutoCompleteOrder(ord, autoCompleteMinutes, nowMs, nowP) {
  const limitMins = Math.max(0, Math.min(240, parseInt(autoCompleteMinutes || 0, 10) || 0));
  if (limitMins <= 0 || !ord) return false;
  const st = String(ord.status || '').trim();
  if (st !== '製作中' && st !== '可取餐') return false;

  const ordDate = normalizeDateStr(ord.pickupDate || nowP.dateStr);
  if (ordDate > nowP.dateStr) return false;
  if (ordDate < nowP.dateStr) return true;

  if (ord.isReservation) {
    const pt = normalizeTimeStr(ord.pickupTime, false);
    const m = pt.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      const pickupMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      return (nowP.minutesOfDay - pickupMin) >= limitMins;
    }
  }

  const baseTs = Number(ord.cookingStartedAtTs || 0) || Number(ord.createdAtTs || 0);
  if (baseTs <= 0) return false;
  return (nowMs - baseTs) >= limitMins * 60 * 1000;
}

async function autoCompleteExpiredOrders(env, storesRows, ordersList, ctx = null) {
  if (!Array.isArray(storesRows) || !Array.isArray(ordersList) || ordersList.length === 0) {
    return { completedCount: 0, completedOrderIds: [] };
  }

  const storeAutoMinMap = {};
  let hasAnyEnabledStore = false;
  for (const s of storesRows) {
    if (!s || !s.id) continue;
    const meta = typeof s.custom_meta_json === 'string'
      ? safeJsonParse(s.custom_meta_json, {})
      : (s.customMeta || {});
    const mins = getStoreAutoCompleteMinutes(meta);
    if (mins > 0) {
      storeAutoMinMap[String(s.id)] = mins;
      hasAnyEnabledStore = true;
    }
  }
  if (!hasAnyEnabledStore) {
    return { completedCount: 0, completedOrderIds: [] };
  }

  const db = env.DB;
  const nowMs = Date.now();
  const nowP = getTaipeiDateParts(nowMs);
  const stmts = [];
  const completedOrders = [];

  for (const ord of ordersList) {
    if (!ord) continue;
    const limitMins = storeAutoMinMap[String(ord.storeId || '')] || 0;
    if (limitMins <= 0) continue;
    if (!shouldAutoCompleteOrder(ord, limitMins, nowMs, nowP)) continue;

    const meta = safeJsonParse(ord.extraMetaJson, {});
    if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
    const tlEntry = {
      ts: nowMs,
      timeStr: nowP.timeFullStr,
      status: '已完成',
      label: `系統逾時自動結單（超過 ${limitMins} 分鐘）`
    };
    meta.statusTimeline.push(tlEntry);
    meta.statusTimeline = meta.statusTimeline.slice(-25);
    meta.autoCompletedAtTs = nowMs;
    meta.autoCompletedMinutes = limitMins;
    const nextMetaStr = JSON.stringify(meta);

    stmts.push(
      db.prepare(`
        UPDATE orders
        SET status = '已完成', needs_print = 0, extra_meta_json = ?
        WHERE order_id = ? AND status IN ('製作中', '可取餐')
      `).bind(nextMetaStr, ord.orderId)
    );

    ord.status = '已完成';
    ord.extraMetaJson = nextMetaStr;
    ord.statusTimeline = meta.statusTimeline;
    ord.autoCompletedAtTs = nowMs;
    completedOrders.push(ord);
  }

  if (stmts.length === 0) {
    return { completedCount: 0, completedOrderIds: [] };
  }

  await db.batch(stmts);

  // 背景同步 Firestore（絕不重複推播列印任務）
  const syncAll = Promise.allSettled(
    completedOrders.slice(0, 30).map(ord => syncOrderToFirestore(env, ord, { pushPrintJob: false }))
  );
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(syncAll);
  } else {
    await syncAll;
  }

  return {
    completedCount: completedOrders.length,
    completedOrderIds: completedOrders.map(o => o.orderId)
  };
}

function computeStoreQueueStats(storesRows, recentOrders, simOffsetsMap = {}) {
  const nowMs = Date.now();
  const nowP = getTaipeiDateParts();
  const storeMetaMap = {};
  storesRows.forEach(s => {
    storeMetaMap[String(s.id)] = {
      maxCap: Math.max(5, Number(s.max_capacity_per_15min) || 20),
      basePrep: Number(s.base_prep_minutes) || 4
    };
  });

  const liveWorkloadByStore = {};
  recentOrders.forEach(o => {
    if (isOrderActivelyCooking(o, nowP.dateStr, nowP.minutesOfDay, nowMs)) {
      const sid = String(o.storeId || '');
      const cap = storeMetaMap[sid] ? storeMetaMap[sid].maxCap : 20;
      const wUnits = calcOrderRemainingWorkload(o, cap, nowMs, nowP.minutesOfDay);
      liveWorkloadByStore[sid] = (liveWorkloadByStore[sid] || 0) + wUnits;
    }
  });

  const computedMap = {};
  storesRows.forEach(s => {
    const sid = String(s.id);
    const { maxCap, basePrep } = storeMetaMap[sid];
    const realWorkload = liveWorkloadByStore[sid] || 0;
    const offset = Math.max(0, Number(simOffsetsMap[sid]) || 0);
    computedMap[sid] = {
      activeOrders: Math.ceil(realWorkload + offset),
      avgPrepMinutes: calcDynamicPrepMinutes(realWorkload + offset, maxCap, basePrep),
      basePrepMinutes: basePrep
    };
  });
  return computedMap;
}

async function getStoreCustomMetaAndConfig(db, storeId, forceRefresh = false) {
  const sm = await getCachedStoresAndMenus(db, forceRefresh);
  const row = sm.storeById.get(String(storeId || '').trim().toUpperCase()) || null;
  if (!row) return null;
  const customMeta = safeJsonParse(row.custom_meta_json, {});
  const frontCategories = Array.isArray(customMeta.printerFrontCategories) && customMeta.printerFrontCategories.length > 0
    ? customMeta.printerFrontCategories.map(c => String(c || '').trim()).filter(Boolean)
    : ['飯捲類', '飲料類', '飲品類'];
  return { row, customMeta, frontCategories };
}

async function isStoreShiftLocked(db, storeId, dateStr) {
  const row = await db.prepare(`
    SELECT status FROM shift_reports
    WHERE store_id = ? AND date_str = ? AND status = 'LOCKED'
    LIMIT 1
  `).bind(String(storeId), String(dateStr)).first();
  return Boolean(row);
}

// ==================== 3. 公開查詢與初始化 Bundle ====================

export async function handleInitBundle(env, params = {}, ctx = null) {
  const db = env.DB;
  const session = await parseVerifiedMerchantSession(env, params);
  const forceRefresh = Boolean(params && params.forceRefresh);

  const [sm, rawRecentOrders, simOffsetsRaw, lineBotBasicId, lineLiffId] = await Promise.all([
    loadActiveStoresAndMenus(db, forceRefresh),
    loadRecentOrders(db, 80, '', 3),
    kvGet(db, 'SIM_QUEUE_OFFSETS'),
    kvGet(db, 'LINE_BOT_BASIC_ID'),
    kvGet(db, 'LINE_LIFF_ID')
  ]);

  // 即時執行已啟用「自動結單時間」店家的逾時結單，避免學生端預估等候時間失真
  await autoCompleteExpiredOrders(env, sm.stores, rawRecentOrders, ctx);

  const simOffsets = safeJsonParse(simOffsetsRaw, {});
  const activeNonPendingOrders = rawRecentOrders.filter(o => String(o.status || '') !== '待付款 (LINE Pay 授權中)');
  const queueStatsMap = computeStoreQueueStats(sm.stores, activeNonPendingOrders, simOffsets);
  const slotQuotaMap = buildSlotQuotaMap(activeNonPendingOrders);
  const storeQueueProgressMap = buildStoreQueueProgressMap(activeNonPendingOrders);
  const todayStr = getTodayTaipeiStr();
  const dailyMenuSoldMap = buildDailyMenuSoldMap(activeNonPendingOrders, todayStr);

  // 最小權限原則：決定要回傳哪些訂單
  const clientDeviceId = String(params.clientDeviceId || '').trim();
  const requestedLineUid = String(params.lineUserId || '').trim();
  const effectiveMerchantStoreId = session
    ? (session.role === 'DEVELOPER' ? String(params.storeId || 'S01').trim() : session.storeScope)
    : '';

  let clientOrders = [];
  const wantIncludeHistory = Boolean(
    session &&
    effectiveMerchantStoreId &&
    (params.includeHistory === true || params.includeHistory === 1 || String(params.includeHistory || '').trim() === '1')
  );

  if (session) {
    if (wantIncludeHistory) {
      // 僅在店家主動帶 includeHistory=1 時透過 idx_orders_store_date 撈該店完整歷史單；一般輪詢維持輕量化 80 筆
      const histRes = await db.prepare(`
        SELECT * FROM orders
        WHERE store_id = ?
          AND pickup_date BETWEEN '2020-01-01' AND '2099-12-31'
        ORDER BY pickup_date DESC
        LIMIT 3000
      `).bind(effectiveMerchantStoreId).all();
      clientOrders = (histRes.results || [])
        .map(dbRowToOrderObject)
        .filter(ord => ord && !isCorruptedOrMockOrder(ord) && String(ord.status || '') !== '待付款 (LINE Pay 授權中)')
        .sort((a, b) => Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0))
        .map(ord => sanitizeOrderForClientOutput(ord, true, true));
    } else {
      clientOrders = activeNonPendingOrders
        .filter(ord => String(ord.storeId) === effectiveMerchantStoreId)
        .slice(0, 1200)
        .map(ord => sanitizeOrderForClientOutput(ord, true, true));
    }
  } else {
    const rawIds = Array.isArray(params.myOrderIds)
      ? params.myOrderIds
      : (params.myOrderIds ? String(params.myOrderIds).split(',') : []);
    const requestedIds = rawIds.map(id => String(id || '').trim()).filter(Boolean).slice(0, 35);
    const reqSet = new Set(requestedIds);
    const foundMap = {};

    if (requestedIds.length > 0 || (requestedLineUid && requestedLineUid.startsWith('U'))) {
      activeNonPendingOrders.forEach(ord => {
        const oid = String(ord.orderId);
        const matchById = reqSet.has(oid);
        const matchByLine = Boolean(requestedLineUid && requestedLineUid.startsWith('U') && ord.lineUserId === requestedLineUid);
        if (matchById || matchByLine) {
          const isOwnDevice = Boolean(matchByLine || (clientDeviceId && ord.clientDeviceId && clientDeviceId === String(ord.clientDeviceId)));
          foundMap[oid] = sanitizeOrderForClientOutput(ord, false, isOwnDevice);
        }
      });

      // 若有指定 myOrderIds 不在最近 1500 筆內，單筆補查
      for (const reqId of requestedIds) {
        if (!foundMap[reqId]) {
          const singleOrd = await loadOrderById(db, reqId);
          if (singleOrd && !isCorruptedOrMockOrder(singleOrd) && singleOrd.status !== '待付款 (LINE Pay 授權中)') {
            const isOwn = Boolean(clientDeviceId && singleOrd.clientDeviceId && clientDeviceId === String(singleOrd.clientDeviceId));
            foundMap[reqId] = sanitizeOrderForClientOutput(singleOrd, false, isOwn);
          }
        }
      }
      clientOrders = Object.values(foundMap).slice(0, 50);
    }
  }

  // 組裝 enrichedStores
  const enrichedStores = await Promise.all(sm.stores.map(async s => {
    const storeIdStr = String(s.id);
    const customMeta = safeJsonParse(s.custom_meta_json, {});
    const morningSoldOutPolicy = String(customMeta.morningSoldOutPolicy || 'ASK_MORNING').toUpperCase() === 'AUTO_RESTORE'
      ? 'AUTO_RESTORE'
      : 'ASK_MORNING';

    const storeMenus = sm.menus
      .filter(m => String(m.store_id) === storeIdStr)
      .map(m => {
        const parsedRowMeta = parseMenuRowOptionsAndSoldOut(m);
        const soldOutEval = evaluateEffectiveSoldOut(parsedRowMeta, morningSoldOutPolicy, todayStr);
        const mId = String(m.id);
        const mName = String(m.name || '').trim();
        const idSold = dailyMenuSoldMap[`${storeIdStr}::ID::${mId}`];
        const soldToday = idSold !== undefined
          ? Number(idSold || 0)
          : Number(dailyMenuSoldMap[`${storeIdStr}::NAME::${mName}`] || 0);
        const remainingToday = parsedRowMeta.dailyLimit > 0 ? Math.max(0, parsedRowMeta.dailyLimit - soldToday) : null;
        const dailyLimitSoldOut = Boolean(parsedRowMeta.dailyLimit > 0 && remainingToday <= 0);
        const effectiveSoldOut = Boolean(soldOutEval.effectiveManualSoldOut || dailyLimitSoldOut);

        let rawImg = String(m.image || '').trim();
        if (!/^https?:\/\/|^data:image\//i.test(rawImg)) rawImg = '';

        return {
          id: mId,
          storeId: storeIdStr,
          name: mName,
          nameEn: parsedRowMeta.nameEn || '',
          description: parsedRowMeta.description || '',
          dietaryTags: parsedRowMeta.dietaryTags || [],
          price: Number(m.price) || 0,
          tag: String(m.tag || '').trim(),
          category: String(m.category || '招牌主餐').trim(),
          station: parsedRowMeta.station || 'AUTO',
          tileColor: parsedRowMeta.tileColor || '',
          sortOrder: parsedRowMeta.sortOrder,
          soldOutGroup: parsedRowMeta.soldOutGroup || '',
          soldOut: effectiveSoldOut,
          manualSoldOut: Boolean(soldOutEval.effectiveManualSoldOut),
          soldOutType: soldOutEval.soldOutType,
          soldOutDate: soldOutEval.soldOutDate,
          needsMorningReview: Boolean(soldOutEval.needsMorningReview),
          dailyLimitSoldOut,
          dailyLimit: parsedRowMeta.dailyLimit,
          soldToday,
          remainingToday,
          image: rawImg,
          options: parsedRowMeta.parsedOptions
        };
      })
      .sort((a, b) => (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999));

    // 全系統各分類內統一依價格由低到高排序（同價再依 sortOrder 與名稱），同時保留原本分類順序
    const catOrder = [];
    const menusByCat = new Map();
    for (const item of storeMenus) {
      const catKey = item.category || '招牌主餐';
      if (!menusByCat.has(catKey)) {
        menusByCat.set(catKey, []);
        catOrder.push(catKey);
      }
      menusByCat.get(catKey).push(item);
    }
    const sortedStoreMenus = [];
    for (const catKey of catOrder) {
      const group = menusByCat.get(catKey);
      group.sort((a, b) => {
        const pa = Number(a.price) || 0;
        const pb = Number(b.price) || 0;
        if (pa !== pb) return pa - pb;
        const sa = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 999;
        const sb = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 999;
        if (sa !== sb) return sa - sb;
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
      });
      for (const item of group) sortedStoreMenus.push(item);
    }
    storeMenus.length = 0;
    for (const item of sortedStoreMenus) storeMenus.push(item);

    const isOpen = s.is_open !== undefined && s.is_open !== null ? Boolean(s.is_open) : true;
    const visibleToStudents = customMeta.visibleToStudents !== undefined
      ? Boolean(customMeta.visibleToStudents)
      : (storeIdStr === 'S01');
    const maxCap = Math.max(5, Number(s.max_capacity_per_15min) || 20);
    const qInfo = queueStatsMap[storeIdStr] || {};
    const active = qInfo.activeOrders !== undefined ? qInfo.activeOrders : 0;
    const basePrepMinutes = Number(s.base_prep_minutes) || 4;
    const baseQueueOffset = Math.max(0, Number(simOffsets[storeIdStr]) || 0);
    const loadPct = isOpen ? Math.min(120, Math.round((active / maxCap) * 100)) : 0;

    let loadState = 'FREE';
    if (!isOpen) loadState = 'CLOSED';
    else if (loadPct >= 85) loadState = 'FULL';
    else if (loadPct >= 50) loadState = 'MODERATE';

    const avgPrep = calcDynamicPrepMinutes(active, maxCap, basePrepMinutes);
    const cutleryPrice = s.cutlery_price !== undefined && s.cutlery_price !== null ? Math.max(0, Number(s.cutlery_price)) : 1;

    const lineCfg = safeJsonParse(await kvGet(db, 'STORE_LINE_CFG_' + storeIdStr), {});
    const bizStatus = evaluateStoreBusinessHours(customMeta, isOpen);
    const printerFrontCategories = Array.isArray(customMeta.printerFrontCategories) && customMeta.printerFrontCategories.length > 0
      ? customMeta.printerFrontCategories.map(c => String(c || '').trim()).filter(Boolean)
      : ['飯捲類', '飲料類', '飲品類'];
    const printerAutoEnabled = customMeta.printerAutoEnabled !== undefined ? Boolean(customMeta.printerAutoEnabled) : true;
    const isAuthorizedForStore = Boolean(session && (session.role === 'DEVELOPER' || session.storeScope === 'ALL' || session.storeScope === storeIdStr));

    const [hasStaffPin, staffList, staffAccounts, printerBridgeKey] = await Promise.all([
      getStoredStoreStaffPinHash(env, storeIdStr).then(Boolean),
      getStoreStaffList(env, storeIdStr),
      getPublicStaffAccounts(env, storeIdStr),
      isAuthorizedForStore ? getOrCreateStorePrinterKey(env, storeIdStr) : Promise.resolve('')
    ]);

    const storeObj = {
      id: storeIdStr,
      campus: String(s.campus || ''),
      name: String(s.name || ''),
      category: String(s.category || ''),
      promoMode: String(s.promo_mode || 'none'),
      promoText: String(s.promo_text || ''),
      promoDiscount: Math.max(0, Number(s.promo_discount) || 0),
      icon: String(customMeta.icon || ''),
      openTime: String(customMeta.openTime || '10:30'),
      closeTime: String(customMeta.closeTime || '19:30'),
      breakStartTime: String(customMeta.breakStartTime || ''),
      breakEndTime: String(customMeta.breakEndTime || ''),
      closedDays: normalizeClosedDaysList(customMeta.closedDays),
      weeklyHours: normalizeWeeklyHours(customMeta.weeklyHours),
      comboDiscounts: normalizeComboDiscounts(customMeta.comboDiscounts),
      morningSoldOutPolicy,
      enableOnlineLinePay: Boolean(customMeta.enableOnlineLinePay),
      printerFrontCategories,
      printerAutoEnabled,
      printerBridgeKey,
      reserveLeadMinutes: Math.max(10, Math.min(90, Number(customMeta.reserveLeadMinutes) || 25)),
      autoCompleteMinutes: getStoreAutoCompleteMinutes(customMeta),
      promoMinSubtotal: customMeta.promoMinSubtotal !== undefined ? Math.max(0, Number(customMeta.promoMinSubtotal) || 0) : AI_DISCOUNT_MIN_SUBTOTAL,
      promoScope: customMeta.promoScope === 'ALL_DAY' ? 'ALL_DAY' : 'OFF_PEAK',
      giftMenuItemId: String(customMeta.giftMenuItemId || '').trim(),
      secondItemDiscount: Math.max(0, Number(customMeta.secondItemDiscount) || 0),
      coupons: Array.isArray(customMeta.coupons) ? customMeta.coupons : [],
      allowDineInPostPay: Boolean(customMeta.allowDineInPostPay),
      visibleToStudents,
      linePayFeeRate: customMeta.linePayFeeRate !== undefined ? Math.max(0, Math.min(10, Number(customMeta.linePayFeeRate) || 0)) : 2.2,
      hasStaffPin,
      staffList,
      staffAccounts,
      isOpen,
      canOrderNow: bizStatus.canOrderNow,
      canPreOrder: bizStatus.canPreOrder,
      businessStatusReason: bizStatus.reasonCode,
      businessStatusLabel: bizStatus.statusLabel,
      maxCapacityPer15Min: maxCap,
      basePrepMinutes,
      activeOrders: active,
      baseQueueOffset,
      avgPrepMinutes: avgPrep,
      rating: Number(s.rating) || 4.7,
      cutleryPrice,
      useCustomLineOa: Boolean(lineCfg.useCustomLineOa),
      customLineClientId: String(lineCfg.clientId || ''),
      linePayChannelId: String(lineCfg.linePayChannelId || ''),
      hasLinePaySecret: Boolean(lineCfg.linePayChannelSecret),
      linePaySandbox: lineCfg.linePaySandbox !== undefined ? Boolean(lineCfg.linePaySandbox) : true,
      loadPercentage: loadPct,
      loadState: !bizStatus.canOrderNow ? 'CLOSED' : loadState,
      menus: storeMenus
    };
    storeObj.aiScore = calcAiUtilityScore(storeObj);
    return storeObj;
  }));

  const aiRecommendations = computeAiTrafficRecommendations(enrichedStores);
  const nowP = getTaipeiDateParts();
  const serverTime = nowP.dateTimeStr;
  const serverTimeTs = Date.now();

  // 店家已解鎖時回傳稽核紀錄與交班狀態
  let storeAuditLogs = [];
  const lockedShiftsMap = {};
  const openShiftsMap = {};
  const pettyCashMap = {};

  if (session && effectiveMerchantStoreId) {
    const [auditRes, shiftRes] = await Promise.all([
      db.prepare('SELECT * FROM audit_logs WHERE store_id = ? ORDER BY ts DESC LIMIT 30').bind(effectiveMerchantStoreId).all(),
      db.prepare('SELECT * FROM shift_reports WHERE store_id = ? ORDER BY updated_at DESC LIMIT 30').bind(effectiveMerchantStoreId).all()
    ]);

    storeAuditLogs = (auditRes.results || []).map(r => ({
      ts: String(r.ts || ''),
      storeId: effectiveMerchantStoreId,
      staffName: String(r.staff_name || ''),
      staffRole: String(r.staff_role || ''),
      approvedBy: String(r.approved_by || ''),
      action: String(r.action || ''),
      detail: String(r.detail || '')
    }));

    (shiftRes.results || []).forEach(r => {
      const dStr = normalizeDateStr(r.date_str || '');
      const slot = String(r.shift_slot || 'FULL').trim().toUpperCase();
      const compositeKey = `${dStr}_${slot}`;
      const summaryObj = safeJsonParse(r.summary_json, {});
      const pettyArr = safeJsonParse(r.petty_cash_json, []);
      if (Array.isArray(pettyArr)) pettyCashMap[compositeKey] = pettyArr;
      if (r.status === 'OPEN' || Number(r.opening_float) > 0) {
        openShiftsMap[compositeKey] = {
          openedAt: String(summaryObj.openedAt || r.updated_at || ''),
          cashier: String(r.cashier_name || ''),
          openingFloat: Number(r.opening_float) || 0,
          shiftSlot: slot
        };
      }
      if (r.status === 'LOCKED') {
        lockedShiftsMap[compositeKey] = {
          locked: true,
          lockedAt: String(r.updated_at || ''),
          cashier: String(r.cashier_name || ''),
          shiftSlot: slot,
          openingFloat: Number(r.opening_float) || 0,
          expectedDrawerCash: Number(r.expected_cash) || 0,
          actualCounted: Number(r.actual_counted_cash) || 0,
          varianceAmt: Number(r.variance) || 0,
          ...summaryObj
        };
      }
    });
  }

  const hasLineToken = Boolean(env.LINE_CHANNEL_TOKEN);
  const sharedFields = {
    stores: enrichedStores,
    slotQuotaMap,
    storeQueueProgressMap,
    recentOrders: clientOrders,
    orders: clientOrders,
    aiRecommendations,
    merchantAuditLogs: storeAuditLogs,
    lockedShiftsMap,
    openShiftsMap,
    pettyCashMap,
    merchantSessionRole: session ? session.role : '',
    merchantSessionStaffName: session ? session.staffName : '',
    serverTime,
    serverTimeTs
  };

  return {
    ...sharedFields,
    bundle: {
      ...sharedFields,
      lineDevInfo: {
        botBasicId: lineBotBasicId || '',
        liffId: lineLiffId || '',
        hasToken: hasLineToken
      }
    }
  };
}

export async function handleGetPickupBoard(env, params = {}, ctx = null) {
  const db = env.DB;
  const requestedStoreId = String(params.storeId || params.store || '').trim().toUpperCase();
  const sm = await getCachedStoresAndMenus(db, Boolean(params.forceRefresh));
  const stores = sm.stores || [];
  if (stores.length === 0) throw new Error('查無店鋪資料');

  const targetRow = sm.storeById.get(requestedStoreId) || stores[0];
  const targetId = String(targetRow.id);
  const customMeta = safeJsonParse(targetRow.custom_meta_json, {});
  const isOpen = targetRow.is_open !== undefined && targetRow.is_open !== null ? Boolean(targetRow.is_open) : true;
  const bizStatus = evaluateStoreBusinessHours(customMeta, isOpen);

  const todayStr = getTodayTaipeiStr();
  const todayRes = await db.prepare(
    'SELECT * FROM orders WHERE store_id = ? AND pickup_date = ? ORDER BY created_at_ts DESC LIMIT 120'
  ).bind(targetId, todayStr).all();
  const recentOrders = (todayRes.results || [])
    .map(dbRowToOrderObject)
    .filter(o => o && !isCorruptedOrMockOrder(o));
  await autoCompleteExpiredOrders(env, [targetRow], recentOrders, ctx);
  const qMap = buildStoreQueueProgressMap(recentOrders);
  const qStats = computeStoreQueueStats([targetRow], recentOrders);
  const myQueue = qMap[targetId] || { readyNumbers: [], readyDetails: [], cookingNumbers: [], latestCalledNumber: '', completedCount: 0 };
  const myStat = qStats[targetId] || {};
  const nowP = getTaipeiDateParts();

  return {
    store: {
      id: targetId,
      name: String(targetRow.name || ''),
      campus: String(targetRow.campus || ''),
      category: String(targetRow.category || ''),
      icon: String(customMeta.icon || ''),
      isOpen,
      canOrderNow: bizStatus.canOrderNow,
      canPreOrder: bizStatus.canPreOrder,
      businessStatusReason: bizStatus.reasonCode,
      businessStatusLabel: bizStatus.statusLabel,
      openTime: String(customMeta.openTime || '10:30'),
      closeTime: String(customMeta.closeTime || '19:30'),
      avgPrepMinutes: Number(myStat.avgPrepMinutes || targetRow.base_prep_minutes || 5)
    },
    storesList: stores.map(s => {
      const m = safeJsonParse(s.custom_meta_json, {});
      return { id: String(s.id), name: String(s.name || ''), campus: String(s.campus || ''), icon: String(m.icon || '') };
    }),
    preparingNumbers: Array.from(new Set(myQueue.cookingNumbers || [])),
    readyNumbers: myQueue.readyDetails || [],
    latestCalledNumber: myQueue.latestCalledNumber || '',
    completedCount: myQueue.completedCount || 0,
    serverTime: nowP.dateTimeStr,
    serverTimeTs: Date.now()
  };
}

export async function handleGetOrder(env, params = {}, ctx = null) {
  const orderId = String(params.orderId || '').trim();
  if (!orderId) return { order: null };
  const order = await loadOrderById(env.DB, orderId);
  if (!order) return { order: null };

  if (order.status === '製作中' || order.status === '可取餐') {
    const sm = await getCachedStoresAndMenus(env.DB);
    const storeRow = sm.storeById.get(String(order.storeId || '').trim().toUpperCase()) || null;
    if (storeRow) {
      await autoCompleteExpiredOrders(env, [storeRow], [order], ctx);
    }
  }

  const hasMerchantAuth = await isMerchantRequestValid(env, params, '');
  const cleanProvidedV = String(params.v || params.verificationCode || '').trim().toUpperCase();
  const cleanExpectedV = String(order.verificationCode || '').trim().toUpperCase();
  const cleanDevId = String(params.clientDeviceId || '').trim();
  const orderDevId = String(order.clientDeviceId || '').trim();
  const canRevealCode = Boolean(
    hasMerchantAuth ||
    (cleanProvidedV && cleanProvidedV === cleanExpectedV) ||
    (cleanDevId && orderDevId && cleanDevId === orderDevId)
  );
  return {
    order: sanitizeOrderForClientOutput(order, hasMerchantAuth, canRevealCode)
  };
}

export async function handleLookupOrders(env, params = {}) {
  const session = await parseVerifiedMerchantSession(env, params);
  const hasMerchantAuth = Boolean(session);
  const merchantStoreScope = session
    ? (session.role === 'DEVELOPER' ? String(params.storeId || '').trim() : session.storeScope)
    : '';
  const rawInput = String(params.query || '').trim();
  let rawQ = rawInput.toUpperCase().replace(/^#/, '');
  let rawPhoneLast3 = extractPhoneLast3(params.phoneLast3 || '');
  const clientDeviceId = String(params.clientDeviceId || 'ANON_DEV').trim().slice(0, 36);

  if (!rawQ) return { orders: [] };

  const comboMatch = rawQ.match(/^([A-Z]?\d{3,5})[\s\-_,/]+(\d{3})$/);
  if (comboMatch) {
    rawQ = comboMatch[1];
    rawPhoneLast3 = comboMatch[2];
  }

  if (!hasMerchantAuth && env.DISABLE_RATE_LIMIT !== '1') {
    const devR = checkAndIncrementRateBucket('LOOKUP_DEV_' + clientDeviceId, 6, 60000);
    const phR = checkAndIncrementRateBucket('LOOKUP_PH3_' + (rawPhoneLast3 || 'NONE'), 6, 60000);
    const globR = checkAndIncrementRateBucket('LOOKUP_GLOBAL_BUCKET', 45, 30000);
    if (!devR.allowed || !phR.allowed || !globR.allowed) {
      throw new Error('查單嘗試次數過於頻繁，為防止訂單號枚舉，系統已暫時鎖定查詢 60 秒，請稍後再試');
    }
  }

  const isFullOrderId = rawQ.startsWith('ORD-') && rawQ.length >= 10;
  const isPartialOrderId = rawQ.startsWith('ORD-') && rawQ.length >= 6;
  const isSixCharHmacCode = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(rawQ);
  const isFourDigitPickup = /^([AB]\d{3,4}|\d{3,5})$/.test(rawQ);
  const digitsOnly = rawQ.replace(/\D/g, '');
  const isShortPickup = /^\d{1,3}$/.test(rawQ);
  const isPhoneLike = digitsOnly.length >= 6 && digitsOnly.length <= 12;

  if (!hasMerchantAuth && !isSixCharHmacCode) {
    if ((!isFourDigitPickup && !isFullOrderId) || rawPhoneLast3.length !== 3) {
      throw new Error('為保護點餐隱私，跨裝置查詢請輸入「6 碼防偽核銷碼」，或「4 碼取餐號 + 手機末 3 碼」雙重驗證');
    }
  }

  let rows = [];
  const rowMap = new Map();
  const collectRows = (list) => {
    for (const r of (list || [])) {
      if (r && r.order_id && !rowMap.has(r.order_id)) {
        rowMap.set(r.order_id, r);
      }
    }
  };

  if (isFullOrderId) {
    const res = await env.DB.prepare('SELECT * FROM orders WHERE UPPER(order_id) = ? LIMIT 5').bind(rawQ).all();
    collectRows(res.results);
  } else if (hasMerchantAuth && isPartialOrderId) {
    const res = merchantStoreScope
      ? await env.DB.prepare('SELECT * FROM orders WHERE store_id = ? AND UPPER(order_id) LIKE ? ORDER BY created_at_ts DESC LIMIT 30').bind(merchantStoreScope, rawQ + '%').all()
      : await env.DB.prepare('SELECT * FROM orders WHERE UPPER(order_id) LIKE ? ORDER BY created_at_ts DESC LIMIT 30').bind(rawQ + '%').all();
    collectRows(res.results);
  } else if (isSixCharHmacCode) {
    const res = await env.DB.prepare('SELECT * FROM orders WHERE UPPER(verification_code) = ? ORDER BY created_at_ts DESC LIMIT 10').bind(rawQ).all();
    collectRows(res.results);
  }

  if (hasMerchantAuth && isPhoneLike) {
    // 優先走 idx_orders_phone 索引精準比對手機號碼
    const exactPhoneRes = await env.DB.prepare(
      'SELECT * FROM orders WHERE customer_phone = ? ORDER BY created_at_ts DESC LIMIT 50'
    ).bind(digitsOnly).all();
    collectRows(exactPhoneRes.results);
    if (rowMap.size === 0 && rawInput !== digitsOnly) {
      const rawPhoneRes = await env.DB.prepare(
        'SELECT * FROM orders WHERE customer_phone = ? ORDER BY created_at_ts DESC LIMIT 50'
      ).bind(rawInput).all();
      collectRows(rawPhoneRes.results);
    }
    if (rowMap.size === 0 && merchantStoreScope) {
      const likePhoneRes = await env.DB.prepare(
        'SELECT * FROM orders WHERE store_id = ? AND customer_phone LIKE ? ORDER BY created_at_ts DESC LIMIT 50'
      ).bind(merchantStoreScope, `%${digitsOnly}%`).all();
      collectRows(likePhoneRes.results);
    }
  }

  if (isFourDigitPickup || (hasMerchantAuth && isShortPickup)) {
    const padded3 = /^\d{1,3}$/.test(rawQ) ? rawQ.padStart(3, '0') : rawQ;
    if (hasMerchantAuth && merchantStoreScope) {
      const res = padded3 !== rawQ
        ? await env.DB.prepare('SELECT * FROM orders WHERE store_id = ? AND UPPER(pickup_number) IN (?, ?) ORDER BY created_at_ts DESC LIMIT 50').bind(merchantStoreScope, rawQ, padded3).all()
        : await env.DB.prepare('SELECT * FROM orders WHERE store_id = ? AND UPPER(pickup_number) = ? ORDER BY created_at_ts DESC LIMIT 50').bind(merchantStoreScope, rawQ).all();
      collectRows(res.results);
    } else {
      const res = await env.DB.prepare('SELECT * FROM orders WHERE UPPER(pickup_number) = ? ORDER BY created_at_ts DESC LIMIT 20').bind(rawQ).all();
      collectRows(res.results);
    }
    // 商家輸入 3~5 位數字時，同步嘗試比對該店手機末碼（不漏掉以手機末 3~4 碼查單情境）
    if (hasMerchantAuth && merchantStoreScope && /^\d{3,5}$/.test(digitsOnly)) {
      const phSuffixRes = await env.DB.prepare(
        'SELECT * FROM orders WHERE store_id = ? AND customer_phone LIKE ? ORDER BY created_at_ts DESC LIMIT 30'
      ).bind(merchantStoreScope, `%${digitsOnly}`).all();
      collectRows(phSuffixRes.results);
    }
  } else if (hasMerchantAuth && rowMap.size === 0 && merchantStoreScope && rawQ.length >= 2) {
    // 商家模糊搜尋核銷碼 / 訂單編號 / 手機 / 備註
    const likePattern = `%${rawInput}%`;
    const fallbackRes = await env.DB.prepare(`
      SELECT * FROM orders
      WHERE store_id = ?
        AND (
          UPPER(pickup_number) LIKE ?
          OR UPPER(verification_code) LIKE ?
          OR customer_phone LIKE ?
          OR UPPER(order_id) LIKE ?
        )
      ORDER BY created_at_ts DESC
      LIMIT 40
    `).bind(merchantStoreScope, `%${rawQ}%`, `%${rawQ}%`, likePattern, `%${rawQ}%`).all();
    collectRows(fallbackRes.results);
  }

  rows = Array.from(rowMap.values());

  const matched = rows
    .map(dbRowToOrderObject)
    .filter(o => {
      if (!o || isCorruptedOrMockOrder(o)) return false;
      if (String(o.status || '') === '待付款 (LINE Pay 授權中)') return false;
      if (hasMerchantAuth && merchantStoreScope && String(o.storeId || '') !== merchantStoreScope) return false;
      const ordLast3 = extractPhoneLast3(o.customerPhone);
      if (isSixCharHmacCode && String(o.verificationCode).toUpperCase() === rawQ) return true;
      if (hasMerchantAuth) return true;
      return rawPhoneLast3.length === 3 && ordLast3 === rawPhoneLast3;
    })
    .sort((a, b) => Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0));

  const maxResults = hasMerchantAuth ? 50 : 5;
  return {
    authoritative: true,
    totalMatched: matched.length,
    orders: matched.slice(0, maxResults).map(o => sanitizeOrderForClientOutput(o, hasMerchantAuth, true))
  };
}

/**
 * 按需日期區間歷史訂單查詢 (getOrdersByDateRange)
 * 嚴格使用 idx_orders_store_date (store_id, pickup_date) 索引精準區間掃描，
 * 讓一般 initBundle 輪詢保持輕量、對帳／分析／KDS 查詢歷史日仍看得到全部訂單。
 */
export async function handleGetOrdersByDateRange(env, params = {}) {
  const db = env.DB;
  const session = await assertMerchantAuthorized(env, params, params.storeId || '');
  const storeId = session.role === 'DEVELOPER'
    ? String(params.storeId || 'S01').trim()
    : String(params.storeId || session.storeScope || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');

  const todayStr = getTodayTaipeiStr();
  const isAllHistory = Boolean(
    params.includeAllHistory ||
    params.includeHistory === true ||
    params.includeHistory === 1 ||
    String(params.includeHistory || '').trim() === '1' ||
    String(params.range || '').trim().toUpperCase() === 'ALL'
  );

  let startDate = (isAllHistory && !params.startDate)
    ? '2020-01-01'
    : (normalizeDateStr(params.startDate || todayStr) || todayStr);
  let endDate = (isAllHistory && !params.endDate)
    ? '2099-12-31'
    : (normalizeDateStr(params.endDate || startDate) || startDate);
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];

  const safeLimit = Math.max(1, Math.min(5000, Number(params.limit) || 2000));
  const includePendingPayment = Boolean(params.includePendingPayment);

  const res = await db.prepare(`
    SELECT * FROM orders
    WHERE store_id = ?
      AND pickup_date BETWEEN ? AND ?
    ORDER BY pickup_date DESC
    LIMIT ?
  `).bind(storeId, startDate, endDate, safeLimit).all();

  const rawRows = res.results || [];
  const orders = rawRows
    .map(dbRowToOrderObject)
    .filter(o => {
      if (!o || isCorruptedOrMockOrder(o)) return false;
      if (!includePendingPayment && String(o.status || '') === '待付款 (LINE Pay 授權中)') return false;
      return true;
    })
    .sort((a, b) => Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0))
    .map(o => sanitizeOrderForClientOutput(o, true, true));

  return {
    authoritative: true,
    storeId,
    startDate,
    endDate,
    count: orders.length,
    truncated: rawRows.length >= safeLimit,
    orders
  };
}

// ==================== 4. 核心下單 (submitOrder) ====================

export async function handleSubmitOrder(env, ctx, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');

  const isMerchantPosRequest = await isMerchantRequestValid(env, params, storeId);
  const clientDeviceId = String(params.clientDeviceId || '').trim().slice(0, 48);
  const clientReqId = String(params.clientRequestId || '').trim().slice(0, 64);
  const incomingOrderId = String(params.orderId || ('ORD-' + crypto.randomUUID().slice(0, 12))).trim();

  // 1. 冪等性防重單 (clientRequestId 優先，其次 orderId)
  if (clientReqId) {
    const idemRow = await db.prepare('SELECT order_id FROM idempotency_keys WHERE req_id = ?').bind(clientReqId).first();
    if (idemRow && idemRow.order_id) {
      const existingOrder = await loadOrderById(db, idemRow.order_id);
      if (existingOrder) {
        return { order: sanitizeOrderForClientOutput(existingOrder, isMerchantPosRequest, true) };
      }
    }
  }
  const existingById = await loadOrderById(db, incomingOrderId);
  if (existingById) {
    return { order: sanitizeOrderForClientOutput(existingById, isMerchantPosRequest, true) };
  }

  // 2. 查店家與設定
  const storeCtx = await getStoreCustomMetaAndConfig(db, storeId);
  if (!storeCtx) throw new Error('查無此學餐店家: ' + storeId);
  const { row: storeRow, customMeta: storeCustomMeta, frontCategories } = storeCtx;
  const isStoreOpen = storeRow.is_open !== undefined && storeRow.is_open !== null ? Boolean(storeRow.is_open) : true;

  const isReservation = Boolean(params.isReservation);
  const paymentMethod = String(params.paymentMethod || '現場櫃檯付現').trim();
  const isCashPayment = paymentMethod.includes('付現') || paymentMethod.includes('現金');
  const rawPhoneDigits = String(params.customerPhone || '').replace(/\D/g, '');

  if (!isStoreOpen && !isMerchantPosRequest) {
    throw new Error(`「${storeRow.name}」目前為「暫停營業」狀態，暫停現場點餐與所有預訂服務，請稍後再試或改選其他櫃位。`);
  }

  // 3. 線上點餐防棄單與速率限制
  if (!isMerchantPosRequest) {
    if ((isCashPayment || isReservation) && !/^09\d{8}$/.test(rawPhoneDigits)) {
      throw new Error('選擇「現場櫃檯付現」或「預訂取餐」必須填寫有效的 10 碼手機號碼（09xxxxxxxx），以防止匿名棄單！');
    }
    if (env.DISABLE_RATE_LIMIT !== '1') {
      if (clientDeviceId) {
        const dLim = checkAndIncrementRateBucket(`SUB_DEV_${clientDeviceId}`, 3, 60000);
        if (!dLim.allowed) throw new Error('您送出訂單的頻率過高（60 秒內上限 3 筆），請稍候再試');
      }
      if (rawPhoneDigits) {
        const pLim = checkAndIncrementRateBucket(`SUB_PHONE_${rawPhoneDigits}`, 3, 60000);
        if (!pLim.allowed) throw new Error('您送出訂單的頻率過高（60 秒內上限 3 筆），請稍候再試');
      }
      const bLim = checkAndIncrementRateBucket(`SUB_BURST_${storeId}`, 30, 20000);
      if (!bLim.allowed) throw new Error('此櫃位瞬間湧入大量線上訂單，系統啟動防洗單保護，請稍候 15 秒再試');
    }
  }

  const nowMs = Date.now();
  const nowP = getTaipeiDateParts(nowMs);
  const todayStr = nowP.dateStr;
  let pickupDateVal = isReservation ? normalizeDateStr(params.pickupDate) : todayStr;
  if (pickupDateVal < todayStr) pickupDateVal = todayStr;
  const createdAtStr = nowP.timeFullStr;
  const pickupTimeVal = isReservation ? normalizeTimeStr(params.pickupTime, false) : nowP.timeStr;

  // 4. POS 關班日結鎖定檢核
  if (isMerchantPosRequest && pickupDateVal === todayStr) {
    if (await isStoreShiftLocked(db, storeId, todayStr)) {
      throw new Error(`「${storeRow.name}」今日 (${todayStr}) 班別已完成關班日結鎖定！如需補開帳單，請先於「交班日結單」由店長解除關班鎖定。`);
    }
  }

  // 5. 營業時間與公休日檢核（僅限非 POS）
  if (!isMerchantPosRequest && env.BYPASS_BUSINESS_HOURS !== '1') {
    const bizCheck = evaluateStoreBusinessHours(storeCustomMeta, isStoreOpen);
    if (!bizCheck.canPreOrder) {
      throw new Error(`「${storeRow.name}」目前為「暫停營業」狀態，暫停現場點餐與所有預訂服務，請稍後再試或改選其他櫃位。`);
    }
    if (!isReservation && !bizCheck.canOrderNow) {
      throw new Error(`「${storeRow.name}」${bizCheck.statusLabel}，目前無法選擇「立即製作」，請切換為「📅 預訂取餐」！`);
    }
    const daySched = resolveStoreDaySchedule(storeCustomMeta, getDayOfWeekForDateStr(pickupDateVal));
    if (daySched.isClosed) {
      throw new Error(`「${storeRow.name}」於 ${pickupDateVal} 公休，請選擇其他營業日期！`);
    }
    if (isReservation) {
      const reqMins = parseTimeStrToMins(pickupTimeVal, -1);
      const oMins = parseTimeStrToMins(daySched.openTime, 10 * 60 + 30);
      const cMins = parseTimeStrToMins(daySched.closeTime, 19 * 60 + 30);
      if (reqMins >= 0 && (reqMins < oMins || reqMins > cMins)) {
        throw new Error(`「${storeRow.name}」於 ${pickupDateVal} 營業時間為 ${daySched.openTime}~${daySched.closeTime}，請選擇營業時段內取餐！`);
      }
    }
  }

  // 6. 載入近期訂單（檢查防棄單、時段配額、每日限量、佇列負載）與本店快取菜單
  const [recentOrders, sm] = await Promise.all([
    loadRecentOrders(db, 100, storeId, 3),
    getCachedStoresAndMenus(db)
  ]);
  const allMenus = sm.menusByStoreId.get(storeId.toUpperCase()) || [];
  const maxCap = Math.max(5, Number(storeRow.max_capacity_per_15min) || 20);

  if (!isMerchantPosRequest && isCashPayment && env.DISABLE_RATE_LIMIT !== '1') {
    const activeUnpaidCashOrders = recentOrders.filter(o => {
      if (!o || String(o.status || '').includes('已取消') || o.status === '已完成') return false;
      if (normalizeDateStr(o.pickupDate) !== todayStr) return false;
      if (String(o.paymentStatus || '') === '已付款') return false;
      const ordPhoneDigits = String(o.customerPhone || '').replace(/\D/g, '');
      const samePhone = rawPhoneDigits && ordPhoneDigits === rawPhoneDigits;
      const sameDevice = clientDeviceId && o.clientDeviceId && String(o.clientDeviceId) === clientDeviceId;
      return Boolean(samePhone || sameDevice);
    });
    if (activeUnpaidCashOrders.length >= 2) {
      throw new Error('伺服器查核：您目前已有 2 筆尚未至櫃檯付款領取的現金訂單，為防止棄單，請先完成取餐付款或改用 LINE Pay 線上結帳！');
    }
    if (rawPhoneDigits) {
      const noShowCount = recentOrders.filter(o => {
        if (!o) return false;
        const stStr = String(o.status || '');
        if (!stStr.includes('逾期') && !stStr.includes('逾時未取') && !stStr.includes('棄單')) return false;
        return String(o.customerPhone || '').replace(/\D/g, '') === rawPhoneDigits;
      }).length;
      if (noShowCount >= 2) {
        throw new Error('系統風控通知：此手機號碼近期累計多筆現金單逾時未取棄單紀錄，已暫停使用「現場付現」功能，請改以 LINE Pay 線上付款點餐。');
      }
    }
  }

  const rawItems = Array.isArray(params.items)
    ? params.items
    : (Array.isArray(params.structuredItems) ? params.structuredItems : []);
  const nonGiftItems = rawItems.filter(it => it && !it.isGift && String(it.id) !== 'GIFT-AI');
  if (nonGiftItems.length === 0) throw new Error('購物車內無有效付費餐點，拒絕結帳');

  const totalRequestedPortions = nonGiftItems.reduce((sum, it) => sum + Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1)), 0);
  if (isReservation && !isMerchantPosRequest) {
    const slotQuotaMap = buildSlotQuotaMap(recentOrders);
    const slotKey = `${storeId}_${pickupDateVal}_${pickupTimeVal}`;
    const bookedPortionsInSlot = Number(slotQuotaMap[slotKey] || 0);
    if (bookedPortionsInSlot + totalRequestedPortions > maxCap) {
      const remainPortions = Math.max(0, maxCap - bookedPortionsInSlot);
      throw new Error(`抱歉，「${storeRow.name}」於 ${pickupDateVal} ${pickupTimeVal} 時段目前僅剩 ${remainPortions} 份產能配額（您的訂單共 ${totalRequestedPortions} 份，每 15 分鐘上限 ${maxCap} 份），請改選相鄰時段或分批下單！`);
    }
  }

  // 7. 白名單計價 + 選項/子規格驗算 + 每日限量檢查
  const dailySoldMap = buildDailyMenuSoldMap(recentOrders, pickupDateVal);
  const morningPolicy = String(storeCustomMeta.morningSoldOutPolicy || 'ASK_MORNING').toUpperCase();
  const menuById = {};
  const menuByCatName = {};
  const menuByName = {};

  allMenus.forEach(m => {
    const parsedMeta = parseMenuRowOptionsAndSoldOut(m);
    const soldOutEval = evaluateEffectiveSoldOut(parsedMeta, morningPolicy, todayStr);
    const mId = String(m.id);
    const mName = String(m.name || '').trim();
    const mCat = String(m.category || '招牌主餐').trim();
    const idSold = dailySoldMap[`${storeId}::ID::${mId}`];
    const soldToday = idSold !== undefined
      ? Number(idSold || 0)
      : Number(dailySoldMap[`${storeId}::NAME::${mName}`] || 0);
    const itemObj = {
      id: mId,
      name: mName,
      category: mCat,
      price: Math.max(0, Number(m.price) || 0),
      soldOut: soldOutEval.effectiveManualSoldOut,
      dailyLimit: parsedMeta.dailyLimit,
      soldToday,
      options: parsedMeta.parsedOptions
    };
    menuById[itemObj.id] = itemObj;
    menuByCatName[`${mCat}::${mName}`] = itemObj;
    if (!menuByName[itemObj.name]) menuByName[itemObj.name] = itemObj;
  });

  const verifiedItems = [];
  let authoritativeSubtotal = 0;
  const itemQtyAccumulator = {};

  for (const reqItem of nonGiftItems) {
    const reqId = String(reqItem.id || '').trim();
    const reqBaseName = String(reqItem.baseName || reqItem.name || '').split(' [')[0].trim();
    const reqCat = String(reqItem.category || '').trim();
    const qty = Math.max(1, Math.min(99, parseInt(reqItem.qty, 10) || 1));

    const dbMenu = menuById[reqId] || (reqCat ? menuByCatName[`${reqCat}::${reqBaseName}`] : null) || menuByName[reqBaseName];
    if (!dbMenu) throw new Error(`白名單計價拒絕：查無品項「${reqBaseName || reqId}」，請重新整理菜單`);
    if (dbMenu.soldOut && !isMerchantPosRequest) {
      throw new Error(`抱歉，品項「${dbMenu.name}」今日已售罄，請先從購物車移除後再結帳`);
    }

    itemQtyAccumulator[dbMenu.id] = (itemQtyAccumulator[dbMenu.id] || 0) + qty;
    if (dbMenu.dailyLimit > 0 && pickupDateVal === todayStr) {
      const nextTotalSold = dbMenu.soldToday + itemQtyAccumulator[dbMenu.id];
      if (nextTotalSold > dbMenu.dailyLimit && !isMerchantPosRequest) {
        const remain = Math.max(0, dbMenu.dailyLimit - dbMenu.soldToday);
        throw new Error(`抱歉，「${dbMenu.name}」今日限量 ${dbMenu.dailyLimit} 份，目前僅剩 ${remain} 份，請調整數量！`);
      }
    }

    let unitExtra = 0;
    const verifiedSelections = {};
    const clientSelections = (reqItem.selections && typeof reqItem.selections === 'object') ? reqItem.selections : {};
    const dbOptions = dbMenu.options || {};

    for (const optGroupName of Object.keys(dbOptions)) {
      const grp = dbOptions[optGroupName];
      const grpType = grp && grp.type ? String(grp.type) : 'radio';
      const isRadio = grpType === 'radio';
      const isQtyMode = grpType === 'qty';
      const choices = Array.isArray(grp.choices) ? grp.choices : (Array.isArray(grp) ? grp : []);
      if (choices.length === 0) continue;

      const minSelect = Math.max(0, parseInt(grp.minSelect || (isRadio ? 1 : 0), 10) || 0);
      const maxSelect = Math.max(0, parseInt(grp.maxSelect || 0, 10) || 0);
      const maxPerChoice = Math.max(1, parseInt(grp.maxPerChoice || 5, 10) || 5);

      const choicePriceMap = {};
      const choiceSoldOutMap = {};
      const choiceSubOptionsMap = {};
      choices.forEach(c => {
        const cName = String(Array.isArray(c) ? c[0] : (c && (c.label || c.name) ? (c.label || c.name) : c)).trim();
        const cExtra = Array.isArray(c)
          ? Math.max(0, Number(c[1]) || 0)
          : (c && (c.priceDelta !== undefined || c.price !== undefined) ? Math.max(0, Number(c.priceDelta !== undefined ? c.priceDelta : c.price) || 0) : 0);
        const cSoldOut = Array.isArray(c) ? Boolean(c[2]) : Boolean(c && c.soldOut);
        const cSubOpts = (Array.isArray(c) && c[3] && typeof c[3] === 'object')
          ? c[3]
          : (c && c.subOptions && typeof c.subOptions === 'object' ? c.subOptions : null);
        choicePriceMap[cName] = cExtra;
        choiceSoldOutMap[cName] = cSoldOut;
        if (cSubOpts) choiceSubOptionsMap[cName] = cSubOpts;
      });

      const rawSelected = clientSelections[optGroupName];
      if (isQtyMode) {
        const parsedTokens = Array.isArray(rawSelected)
          ? rawSelected
          : String(rawSelected || '').split(',').map(s => s.trim()).filter(Boolean);
        let totalQtyChosen = 0;
        const validParts = [];
        for (const tok of parsedTokens) {
          const qMatch = String(tok).match(/^(.+?)(?:[×xX*]\s*(\d+))?$/);
          if (!qMatch) continue;
          const cName = qMatch[1].trim();
          const cQty = Math.max(1, Math.min(maxPerChoice, parseInt(qMatch[2] || '1', 10) || 1));
          if (choicePriceMap[cName] === undefined) {
            throw new Error(`品項「${dbMenu.name}」的數量加購選項「${cName}」無效，請重新點選`);
          }
          if (choiceSoldOutMap[cName] && !isMerchantPosRequest) {
            throw new Error(`品項「${dbMenu.name}」的加購選項「${cName}」今日已售罄`);
          }
          totalQtyChosen += cQty;
          unitExtra += choicePriceMap[cName] * cQty;
          validParts.push(cQty > 1 ? `${cName}×${cQty}` : cName);
        }
        if (!isMerchantPosRequest && minSelect > 0 && totalQtyChosen < minSelect) {
          throw new Error(`品項「${dbMenu.name}」的「${optGroupName}」至少需選擇 ${minSelect} 份`);
        }
        if (!isMerchantPosRequest && maxSelect > 0 && totalQtyChosen > maxSelect) {
          throw new Error(`品項「${dbMenu.name}」的「${optGroupName}」最多只能選擇 ${maxSelect} 份`);
        }
        if (validParts.length > 0) verifiedSelections[optGroupName] = validParts.join(', ');
      } else if (isRadio) {
        let chosenStr = Array.isArray(rawSelected) ? String(rawSelected[0] || '').trim() : String(rawSelected || '').trim();
        if (chosenStr && choicePriceMap[chosenStr] === undefined) {
          throw new Error(`品項「${dbMenu.name}」的必選規格「${optGroupName}: ${chosenStr}」無效或已變更，請重新選擇`);
        }
        if (chosenStr && choiceSoldOutMap[chosenStr] && !isMerchantPosRequest) {
          throw new Error(`品項「${dbMenu.name}」的規格選項「${chosenStr}」目前已售罄，請改選其他選項`);
        }
        if (!chosenStr) {
          if (isMerchantPosRequest || env.ALLOW_DEFAULT_RADIO === '1') {
            const firstAvail = choices.find(c => !(Array.isArray(c) ? c[2] : Boolean(c && c.soldOut))) || choices[0];
            chosenStr = String(Array.isArray(firstAvail) ? firstAvail[0] : (firstAvail && (firstAvail.label || firstAvail.name) ? (firstAvail.label || firstAvail.name) : firstAvail)).trim();
          } else {
            throw new Error(`請為「${dbMenu.name}」選擇必選規格「${optGroupName}」`);
          }
        }
        verifiedSelections[optGroupName] = chosenStr;
        unitExtra += choicePriceMap[chosenStr];

        const subOptsRaw = choiceSubOptionsMap[chosenStr];
        if (subOptsRaw && typeof subOptsRaw === 'object') {
          const subGroupList = Array.isArray(subOptsRaw)
            ? subOptsRaw.map((sg, idx) => ({ name: String(sg.name || sg.title || `子規格${idx + 1}`), choices: Array.isArray(sg.choices) ? sg.choices : [] }))
            : Object.keys(subOptsRaw).map(k => ({ name: k, choices: Array.isArray(subOptsRaw[k]?.choices) ? subOptsRaw[k].choices : [] }));
          for (const subGrp of subGroupList) {
            if (subGrp.choices.length === 0) continue;
            const subKeyDot = `${chosenStr}・${subGrp.name}`;
            const subKeyArrow = `${optGroupName}▸${subGrp.name}`;
            const subSelRaw = String(clientSelections[subKeyDot] || clientSelections[subKeyArrow] || clientSelections[subGrp.name] || '').trim();
            const subPriceMap = {};
            subGrp.choices.forEach(sc => {
              const sn = String(Array.isArray(sc) ? sc[0] : (sc && (sc.label || sc.name) ? (sc.label || sc.name) : sc)).trim();
              const sp = Array.isArray(sc) ? Math.max(0, Number(sc[1]) || 0) : (sc && (sc.priceDelta !== undefined || sc.price !== undefined) ? Math.max(0, Number(sc.priceDelta !== undefined ? sc.priceDelta : sc.price) || 0) : 0);
              subPriceMap[sn] = sp;
            });
            let finalSubVal = subSelRaw;
            if (!finalSubVal) {
              const firstSub = subGrp.choices[0];
              finalSubVal = String(Array.isArray(firstSub) ? firstSub[0] : (firstSub && (firstSub.label || firstSub.name) ? (firstSub.label || firstSub.name) : firstSub)).trim();
            }
            if (subPriceMap[finalSubVal] === undefined) {
              throw new Error(`品項「${dbMenu.name}」的套餐次級選項「${subGrp.name}: ${finalSubVal}」無效`);
            }
            verifiedSelections[subKeyDot] = finalSubVal;
            unitExtra += subPriceMap[finalSubVal];
          }
        }
      } else {
        const selectedArr = Array.isArray(rawSelected)
          ? rawSelected.map(s => String(s).trim()).filter(Boolean)
          : String(rawSelected || '').split(',').map(s => s.trim()).filter(Boolean);
        const validChosen = [];
        for (const sName of selectedArr) {
          if (choicePriceMap[sName] === undefined) {
            throw new Error(`品項「${dbMenu.name}」的加料選項「${sName}」無效，請重新點選`);
          }
          if (choiceSoldOutMap[sName] && !isMerchantPosRequest) {
            throw new Error(`品項「${dbMenu.name}」的加料選項「${sName}」今日已售罄，請取消勾選`);
          }
          validChosen.push(sName);
          unitExtra += choicePriceMap[sName];
        }
        if (!isMerchantPosRequest && minSelect > 0 && validChosen.length < minSelect) {
          throw new Error(`品項「${dbMenu.name}」的「${optGroupName}」至少需選擇 ${minSelect} 項`);
        }
        if (!isMerchantPosRequest && maxSelect > 0 && validChosen.length > maxSelect) {
          throw new Error(`品項「${dbMenu.name}」的「${optGroupName}」最多只能選擇 ${maxSelect} 項`);
        }
        if (validChosen.length > 0) verifiedSelections[optGroupName] = validChosen.join(', ');
      }
    }

    const authoritativeUnitPrice = Math.max(0, dbMenu.price + unitExtra);
    const lineSubtotal = authoritativeUnitPrice * qty;
    const selSuffix = Object.keys(verifiedSelections).length > 0
      ? ` [${Object.entries(verifiedSelections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
      : '';

    verifiedItems.push({
      id: dbMenu.id,
      category: dbMenu.category || '招牌主餐',
      baseName: dbMenu.name,
      name: `${dbMenu.name}${selSuffix}`,
      basePrice: dbMenu.price,
      unitExtra,
      price: authoritativeUnitPrice,
      qty,
      lineSubtotal,
      selections: verifiedSelections,
      itemNote: String(reqItem.itemNote || '').trim().slice(0, 60),
      isGift: false,
      snapshotAtTs: nowMs
    });
    authoritativeSubtotal += lineSubtotal;
  }

  // 8. 促銷、贈品、組合折扣、優惠碼、手動折讓、餐具費、外帶 +$1、服務費
  await autoCompleteExpiredOrders(env, [storeRow], recentOrders, ctx);
  const queueStats = computeStoreQueueStats([storeRow], recentOrders);
  const storeActiveCount = (queueStats[storeId] && queueStats[storeId].activeOrders) || 0;
  const isFullLoad = Math.round((storeActiveCount / maxCap) * 100) >= 85;
  const promoMode = String(storeRow.promo_mode || 'none');
  const promoText = String(storeRow.promo_text || '');
  const promoScope = storeCustomMeta.promoScope === 'ALL_DAY' ? 'ALL_DAY' : 'OFF_PEAK';
  const promoMinSubtotal = storeCustomMeta.promoMinSubtotal !== undefined
    ? Math.max(0, Number(storeCustomMeta.promoMinSubtotal) || 0)
    : AI_DISCOUNT_MIN_SUBTOTAL;
  const isPeakReservation = isReservation && isPeakHourSlot(pickupTimeVal);
  const promoActive = isStoreOpen && promoMode !== 'none' && (promoScope === 'ALL_DAY' || (!isFullLoad && !isPeakReservation));

  const customerWantsGift = params.wantGift !== false;
  let giftSoldOut = false;
  if (promoActive && (promoMode === 'gift' || promoMode === 'freebie') && promoText) {
    const explicitGiftId = String(storeCustomMeta.giftMenuItemId || '').trim();
    if (explicitGiftId && menuById[explicitGiftId]) {
      const gm = menuById[explicitGiftId];
      if (gm.soldOut || (gm.dailyLimit > 0 && gm.soldToday >= gm.dailyLimit)) giftSoldOut = true;
    }
  }
  if (promoActive && (promoMode === 'gift' || promoMode === 'freebie') && promoText && authoritativeSubtotal >= promoMinSubtotal && customerWantsGift && !giftSoldOut) {
    verifiedItems.push({
      id: 'GIFT-AI',
      baseName: `${promoText} (贈品)`,
      name: `${promoText} (贈品)`,
      basePrice: 0,
      unitExtra: 0,
      price: 0,
      qty: 1,
      lineSubtotal: 0,
      selections: {},
      isGift: true,
      snapshotAtTs: nowMs
    });
  }

  const needCutlery = Boolean(params.needCutlery);
  const storeCutleryPrice = storeRow.cutlery_price !== undefined && storeRow.cutlery_price !== null
    ? Math.max(0, Number(storeRow.cutlery_price))
    : 1;
  const cutleryFee = needCutlery ? storeCutleryPrice : 0;

  let authoritativeDiscount = 0;
  const totalNonGiftQty = verifiedItems.reduce((s, it) => s + (it.isGift ? 0 : (Number(it.qty) || 1)), 0);
  if (promoActive && promoMode === 'discount' && authoritativeSubtotal >= promoMinSubtotal) {
    authoritativeDiscount = Math.min(authoritativeSubtotal, Math.max(0, Number(storeRow.promo_discount) || 0));
  } else if (promoActive && promoMode === 'second_discount' && totalNonGiftQty >= 2 && authoritativeSubtotal >= promoMinSubtotal) {
    const pairCount = Math.floor(totalNonGiftQty / 2);
    const perPairOff = Math.max(0, Number(storeCustomMeta.secondItemDiscount || storeRow.promo_discount) || 10);
    authoritativeDiscount = Math.min(authoritativeSubtotal, pairCount * perPairOff);
  }

  const comboEval = evaluateComboDiscounts(verifiedItems, storeCustomMeta.comboDiscounts, menuById);
  const comboDiscount = Math.min(Math.max(0, authoritativeSubtotal - authoritativeDiscount), comboEval.totalComboDiscount);
  authoritativeDiscount += comboDiscount;

  let appliedCouponCode = '';
  let couponDiscount = 0;
  const reqCouponCode = String(params.couponCode || '').trim().toUpperCase();
  if (reqCouponCode) {
    const storeCoupons = Array.isArray(storeCustomMeta.coupons) ? storeCustomMeta.coupons : [];
    const matchedCoupon = storeCoupons.find(c => c && c.active !== false && String(c.code || '').trim().toUpperCase() === reqCouponCode);
    if (!matchedCoupon) throw new Error(`折扣碼「${reqCouponCode}」無效或已停用，請重新確認`);
    const cMin = Math.max(0, Number(matchedCoupon.minSubtotal) || 0);
    if (authoritativeSubtotal < cMin) throw new Error(`折扣碼「${reqCouponCode}」需消費滿 NT$${cMin} 方可使用`);
    const remainAfterPromo = Math.max(0, authoritativeSubtotal - authoritativeDiscount);
    if (matchedCoupon.type === 'PERCENT') {
      const pctOff = Math.max(1, Math.min(90, Number(matchedCoupon.value) || 10));
      couponDiscount = Math.min(remainAfterPromo, Math.round(remainAfterPromo * (pctOff / 100)));
    } else {
      couponDiscount = Math.min(remainAfterPromo, Math.max(0, Number(matchedCoupon.value) || 0));
    }
    authoritativeDiscount += couponDiscount;
    appliedCouponCode = reqCouponCode;
  }

  let itemDiscountSum = 0;
  if (isMerchantPosRequest) {
    nonGiftItems.forEach((reqIt, idx) => {
      const vi = verifiedItems[idx];
      if (!vi) return;
      if (reqIt.isComped) {
        itemDiscountSum += vi.lineSubtotal;
        vi.isComped = true;
        vi.itemDiscount = vi.lineSubtotal;
        vi.price = 0;
        vi.lineSubtotal = 0;
      } else if (Number(reqIt.itemDiscount) > 0) {
        const dAmt = Math.min(vi.lineSubtotal, Math.max(0, Math.round(Number(reqIt.itemDiscount) || 0)));
        itemDiscountSum += dAmt;
        vi.itemDiscount = dAmt;
        vi.lineSubtotal = Math.max(0, vi.lineSubtotal - dAmt);
      }
    });
  }

  let manualDiscount = 0;
  let manualDiscountReason = '';
  const effectiveAfterItemComp = Math.max(0, authoritativeSubtotal - itemDiscountSum);
  if (isMerchantPosRequest && (Number(params.manualDiscount) > 0 || Number(params.discountPercentOff) > 0 || itemDiscountSum > 0)) {
    const pctOff = Math.max(0, Math.min(100, Number(params.discountPercentOff) || 0));
    const pctDiscAmt = pctOff > 0 ? Math.round(Math.max(0, effectiveAfterItemComp - authoritativeDiscount) * (pctOff / 100)) : 0;
    const reqManualDisc = Math.max(0, Number(params.manualDiscount) || 0) + pctDiscAmt + itemDiscountSum;
    if (reqManualDisc >= 10) {
      await assertManagerAuthorized(env, params, storeId);
    }
    manualDiscount = Math.min(Math.max(0, authoritativeSubtotal - authoritativeDiscount), reqManualDisc);
    manualDiscountReason = String(params.manualDiscountReason || (pctOff > 0 ? `${Math.round(100 - pctOff)}折優惠` : (itemDiscountSum > 0 ? '單品招待/折讓' : '櫃檯手動折讓'))).trim();
  }

  const serviceFeeRate = (isMerchantPosRequest && Number(params.serviceFeeRate) > 0)
    ? Math.min(20, Math.max(0, Number(params.serviceFeeRate) || 0))
    : 0;

  // 外帶加收 NT$1：POS 現場維持原規則；學生線上點餐僅在含麵類品項且選外帶時才計入
  const dineType = String(params.dineType || '外帶自取').trim();
  const hasNoodleItem = verifiedItems.some(it => {
    if (!it || it.isGift) return false;
    return String(it.category || '').includes('麵') || String(it.baseName || it.name || '').includes('麵');
  });
  const takeoutFee = (authoritativeSubtotal > 0 && dineType.includes('外帶') && (isMerchantPosRequest || hasNoodleItem)) ? 1 : 0;

  const netBeforeService = Math.max(0, authoritativeSubtotal + cutleryFee + takeoutFee - authoritativeDiscount - manualDiscount);
  const serviceFee = serviceFeeRate > 0 ? Math.round(netBeforeService * (serviceFeeRate / 100)) : 0;
  const authoritativeFinalTotal = Math.max(0, netBeforeService + serviceFee);

  const isDineInPostPay = Boolean(!isMerchantPosRequest && dineType === '內用自取' && storeCustomMeta.allowDineInPostPay && params.paymentMethod === '內用餐後結帳');
  const isLargeCashReserve = isReservation && authoritativeFinalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD && isCashPayment;

  let paymentStatus = '取餐付現';
  let verifiedTransactionId = '';
  let linePayVerifiedMode = '';
  if (isMerchantPosRequest) {
    paymentStatus = '已付款';
    verifiedTransactionId = String(params.transactionId || ('POS-' + nowMs));
    if (paymentMethod.includes('LINE Pay') || (params.paymentSplit && Number(params.paymentSplit.linePay) > 0)) {
      linePayVerifiedMode = String(params.linePayVerifiedMode || 'MANUAL_CONFIRMED').trim();
    }
  } else if (isDineInPostPay) {
    paymentStatus = '內用餐後結帳';
  } else if (paymentMethod === 'LINE Pay') {
    const lpVerify = await verifyLinePayAuthToken(env, params.paymentAuthToken, storeId, authoritativeFinalTotal);
    if (!lpVerify || !lpVerify.verified) {
      throw new Error('線上行動支付 (LINE Pay) 金流簽章驗證失敗、金額不符或交易憑證已過期，拒絕偽造已付款訂單！請重新發起付款授權。');
    }
    paymentStatus = '已付款';
    verifiedTransactionId = lpVerify.transactionId;
    linePayVerifiedMode = 'API_VERIFIED';
  } else if (isLargeCashReserve) {
    paymentStatus = '待櫃檯繳費';
  }

  // 9. 無鎖原子取餐號（POS: 001~100, ONLINE: 101~200）
  let pickupNumber = '';
  const requestedPosNum = String(params.pickupNumber || '').trim();
  const isOfflineResync = Boolean(params.isOfflineSync);
  if (isMerchantPosRequest && isOfflineResync && /^\d{3}$/.test(requestedPosNum)) {
    const nVal = parseInt(requestedPosNum, 10);
    if (nVal >= 1 && nVal <= 100) pickupNumber = requestedPosNum;
  }
  let originalOfflinePickupNumber = '';
  if (!pickupNumber) {
    pickupNumber = await getNextPickupNumber(db, storeId, pickupDateVal, isMerchantPosRequest);
    if (isMerchantPosRequest && isOfflineResync && requestedPosNum && requestedPosNum !== pickupNumber) {
      originalOfflinePickupNumber = requestedPosNum;
    }
  }

  const verificationCode = await generateOrderVerificationCodeOnServer(env, incomingOrderId, pickupNumber, authoritativeFinalTotal);
  const storeLeadMins = Math.max(10, Math.min(90, Number(storeCustomMeta.reserveLeadMinutes) || 25));
  const initialStatus = evaluateOrderLifecycleStatus(
    '製作中',
    isReservation,
    paymentStatus,
    pickupDateVal,
    pickupTimeVal,
    todayStr,
    nowP.minutesOfDay,
    storeLeadMins
  );

  const customerNote = String(params.customerNote || '').trim();
  const customerPhone = String(params.customerPhone || '').trim();
  const taxId = String(params.taxId || '').trim().replace(/\D/g, '').slice(0, 8);
  if (taxId && !validateTaiwanTaxId(taxId)) {
    throw new Error('統一編號檢查碼驗證失敗，請輸入正確的 8 位台灣統一編號或留空');
  }
  const paidAtDate = paymentStatus === '已付款' ? todayStr : '';
  const studentNameSummary = [
    dineType,
    needCutlery ? `🥢 需免洗餐具${cutleryFee > 0 ? `(+$${cutleryFee})` : ''}` : '',
    taxId ? `🧾 統編:${taxId}` : '',
    customerNote ? `📝 備註：${customerNote}` : ''
  ].filter(Boolean).join(' ・ ');

  const promoAppliedText = [
    manualDiscount > 0 ? manualDiscountReason : (promoActive ? promoText : ''),
    comboDiscount > 0 ? comboEval.matchedDetails.map(d => `${d.name}(-$${d.discount})`).join('+') : '',
    appliedCouponCode ? `折扣碼:${appliedCouponCode}(-$${couponDiscount})` : ''
  ].filter(Boolean).join(' + ') || String(params.promoApplied || '一般點餐');

  const pickupTimeSlot = isReservation
    ? `📅 預訂 ${pickupDateVal} ${pickupTimeVal}`
    : String(params.pickupTimeSlot || '⚡ 立即製作');

  const extraMeta = {
    dineType,
    comboDiscount,
    comboDetails: comboEval.matchedDetails,
    printStatus: 'PENDING',
    printedAtTs: 0,
    couponCode: appliedCouponCode,
    couponDiscount,
    isDineInPostPay,
    itemCheckedMap: {},
    needCutlery,
    cutleryFee,
    takeoutFee,
    serviceFee,
    serviceFeeRate,
    taxId,
    manualDiscount,
    manualDiscountReason,
    linePayVerifiedMode,
    isReservation,
    pickupDate: pickupDateVal,
    pickupTime: pickupTimeVal,
    customerPhone,
    customerNote,
    paymentDeadline: isLargeCashReserve ? pickupDateVal : '',
    paymentStatus,
    paidAtDate,
    transactionId: verifiedTransactionId,
    paymentVerifiedByHmac: Boolean(paymentStatus === '已付款'),
    clientDeviceId,
    cashReceived: isMerchantPosRequest ? (Number(params.cashReceived) || 0) : 0,
    changeGiven: isMerchantPosRequest ? (Number(params.changeGiven) || 0) : 0,
    paymentSplit: (isMerchantPosRequest && params.paymentSplit && typeof params.paymentSplit === 'object') ? params.paymentSplit : null,
    originalOfflinePickupNumber,
    giftSoldOutSkipped: Boolean(giftSoldOut),
    notifyCount: 0,
    lineUserId: String(params.lineUserId || ''),
    customerEmail: String(params.customerEmail || ''),
    verificationCode,
    createdAtTs: nowMs,
    cookingStartedAtTs: initialStatus === '製作中' ? nowMs : 0,
    readyAtTs: 0,
    merchantMessage: '',
    merchantMessages: [],
    statusTimeline: [{
      ts: nowMs,
      timeStr: createdAtStr,
      status: initialStatus,
      label: isReservation ? `預約訂單成立 (預計 ${pickupDateVal} ${pickupTimeVal} 取餐)` : '訂單成立並送入廚房'
    }]
  };

  const itemsJsonStr = JSON.stringify(verifiedItems);
  const extraMetaJsonStr = JSON.stringify(extraMeta);
  const orderSource = String(params.orderSource || params.studentId || '📱 掃碼點餐');

  const insertOrderStmt = db.prepare(`
    INSERT INTO orders (
      order_id, pickup_number, store_id, store_name, student_id, student_name,
      items_json, subtotal, discount, cutlery_fee, takeout_fee, service_fee, final_total,
      promo_applied, dine_type, pickup_date, pickup_time, pickup_time_slot,
      payment_method, payment_status, paid_at_date, status, is_reservation,
      print_status, preprint_done, needs_print, customer_phone, line_user_id, verification_code,
      created_at, created_at_ts, extra_meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 1, ?, ?, ?, ?, ?, ?)
  `).bind(
    incomingOrderId, pickupNumber, storeId, String(storeRow.name || ''), orderSource, studentNameSummary,
    itemsJsonStr, authoritativeSubtotal, authoritativeDiscount, cutleryFee, takeoutFee, serviceFee, authoritativeFinalTotal,
    promoAppliedText, dineType, pickupDateVal, pickupTimeVal, pickupTimeSlot,
    paymentMethod, paymentStatus, paidAtDate, initialStatus, isReservation ? 1 : 0,
    customerPhone, String(params.lineUserId || ''), verificationCode,
    createdAtStr, nowMs, extraMetaJsonStr
  );

  const batchStmts = [insertOrderStmt];
  if (clientReqId) {
    batchStmts.push(
      db.prepare(`
        INSERT INTO idempotency_keys (req_id, order_id, created_at_ts)
        VALUES (?, ?, ?)
        ON CONFLICT (req_id) DO NOTHING
      `).bind(clientReqId, incomingOrderId, nowMs)
    );
  }
  await db.batch(batchStmts);

  const savedOrderObj = await loadOrderById(db, incomingOrderId);

  // 背景即時推送至 Firestore、會員點數累積與 LINE Flex 通知（完全不拖慢 API 回應）
  const autoPrintEnabled = storeCustomMeta.printerAutoEnabled !== undefined ? Boolean(storeCustomMeta.printerAutoEnabled) : true;
  const printMode = (initialStatus === '製作中' || initialStatus === '可取餐') ? 'NORMAL' : 'PREORDER_COUNTER_ONLY';
  const pushTitle = isLargeCashReserve
    ? `⏳ 大額預訂單 #${pickupNumber} 待確認`
    : `🟢 訂單 #${pickupNumber} 已成立 (${initialStatus})`;
  const pushBody = `【${storeRow.name}】${pickupTimeSlot}，應付 NT$${authoritativeFinalTotal} (${paymentMethod})，防偽核銷碼：${verificationCode}。`;

  const bgTasks = Promise.allSettled([
    syncOrderToFirestore(env, savedOrderObj, { pushPrintJob: autoPrintEnabled, printMode, frontCategories }),
    updateMemberStatsFromOrder(db, savedOrderObj),
    dispatchOrderNotification(env, savedOrderObj, pushTitle, pushBody, initialStatus)
  ]);
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(bgTasks);
  } else {
    await bgTasks;
  }

  return {
    order: sanitizeOrderForClientOutput(savedOrderObj, isMerchantPosRequest, true)
  };
}

// ==================== 5. 訂單狀態更新、取消與備註 ====================

export async function handleUpdateOrderStatus(env, ctx, params = {}) {
  const db = env.DB;
  const orderId = String(params.orderId || '').trim();
  if (!orderId) throw new Error('缺少訂單編號');

  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到該筆訂單: ' + orderId);

  const orderStoreId = String(curOrder.storeId || '').trim();
  await assertMerchantAuthorized(env, params, orderStoreId);

  const prevStatus = String(curOrder.status || '').trim();
  if (prevStatus.includes('已取消')) {
    throw new Error(`此訂單已退單作廢 (${prevStatus})，不可變更狀態或核銷交付`);
  }

  const meta = safeJsonParse(curOrder.extraMetaJson, {});
  let paymentStatus = curOrder.paymentStatus;
  let paidAtDate = curOrder.paidAtDate;
  let paymentMethod = curOrder.paymentMethod;

  if (params.paymentStatus) {
    paymentStatus = String(params.paymentStatus).trim();
    meta.paymentStatus = paymentStatus;
    if (paymentStatus === '已付款') {
      if (!paidAtDate) paidAtDate = getTodayTaipeiStr();
      meta.paidAtDate = paidAtDate;
      if (Number(meta.pendingAddOnAmount) > 0) {
        meta.extraChargeTotal = Math.max(0, Number(meta.extraChargeTotal) || 0) + Number(meta.pendingAddOnAmount);
        meta.extraChargeMethod = String(params.paymentMethod || paymentMethod || '現金').trim();
        meta.extraChargeAtDate = getTodayTaipeiStr();
        meta.pendingAddOnAmount = 0;
      }
    }
  }
  if (params.paidAtDate) {
    paidAtDate = normalizeDateStr(params.paidAtDate);
    meta.paidAtDate = paidAtDate;
  }

  const nextStatus = String(params.newStatus || prevStatus || '製作中').trim();
  if (nextStatus === '已完成' && String(paymentStatus || '已付款') !== '已付款') {
    throw new Error('此訂單尚未完成付款確認，請先收款後再核銷交付');
  }

  const isRecall = Boolean(params.isRecall);
  const nowMs = Date.now();
  if (nextStatus === '可取餐' && !isRecall) {
    meta.notifyCount = (Number(meta.notifyCount) || 0) + 1;
    if (!meta.readyAtTs) meta.readyAtTs = nowMs;
    meta.lastCalledAtTs = nowMs;
  }
  if (nextStatus === '製作中' && !meta.cookingStartedAtTs) {
    meta.cookingStartedAtTs = nowMs;
  }
  if (params.paymentMethod) {
    paymentMethod = String(params.paymentMethod).trim();
    if (!paymentMethod.includes('複合') && !params.paymentSplit) {
      meta.paymentSplit = null;
    }
  }
  if (params.linePayVerifiedMode !== undefined) meta.linePayVerifiedMode = String(params.linePayVerifiedMode || '').trim();
  if (params.transactionId) meta.transactionId = String(params.transactionId).trim();
  if (params.paymentSplit && typeof params.paymentSplit === 'object') meta.paymentSplit = params.paymentSplit;
  if (params.cashReceived !== undefined) meta.cashReceived = Number(params.cashReceived) || 0;
  if (params.changeGiven !== undefined) meta.changeGiven = Number(params.changeGiven) || 0;

  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  const nowStr = getTaipeiDateParts(nowMs).timeFullStr;
  const tlLabel = isRecall
    ? `店員復原狀態：${prevStatus} ➔ ${nextStatus}`
    : (nextStatus === '可取餐'
      ? `櫃檯第 ${meta.notifyCount || 1} 次叫號通知取餐`
      : (nextStatus === '已完成' ? '已完成核銷交付取餐' : `狀態變更為：${nextStatus}`));
  meta.statusTimeline.push({ ts: nowMs, timeStr: nowStr, status: nextStatus, label: tlLabel });
  meta.statusTimeline = meta.statusTimeline.slice(-25);

  // 若預訂單被店員手動提前切為「製作中」且尚未印正常三聯，重新標記 needs_print = 1 並推播 NORMAL 任務
  const promotedToCooking = prevStatus !== '製作中' && nextStatus === '製作中' && String(curOrder.printStatus || '').toUpperCase() !== 'PRINTED';
  const isTerminalNext = nextStatus === '已完成' || nextStatus.includes('已取消') || nextStatus === '已退單';

  if (isTerminalNext) {
    await db.prepare(`
      UPDATE orders
      SET status = ?, payment_status = ?, paid_at_date = ?, payment_method = ?, needs_print = 0, extra_meta_json = ?
      WHERE order_id = ?
    `).bind(nextStatus, paymentStatus, paidAtDate, paymentMethod, JSON.stringify(meta), orderId).run();
  } else if (promotedToCooking) {
    await db.prepare(`
      UPDATE orders
      SET status = ?, payment_status = ?, paid_at_date = ?, payment_method = ?, needs_print = 1, extra_meta_json = ?
      WHERE order_id = ?
    `).bind(nextStatus, paymentStatus, paidAtDate, paymentMethod, JSON.stringify(meta), orderId).run();
  } else {
    await db.prepare(`
      UPDATE orders
      SET status = ?, payment_status = ?, paid_at_date = ?, payment_method = ?, extra_meta_json = ?
      WHERE order_id = ?
    `).bind(nextStatus, paymentStatus, paidAtDate, paymentMethod, JSON.stringify(meta), orderId).run();
  }

  const updatedOrderObj = await loadOrderById(db, orderId);

  const storeCtx = promotedToCooking ? await getStoreCustomMetaAndConfig(db, orderStoreId) : null;
  const bgList = [
    syncOrderToFirestore(env, updatedOrderObj, {
      pushPrintJob: promotedToCooking,
      printMode: 'NORMAL',
      frontCategories: storeCtx ? storeCtx.frontCategories : undefined
    })
  ];
  if (!isRecall && !params.suppressPush) {
    if (nextStatus === '可取餐') {
      bgList.push(dispatchOrderNotification(
        env, updatedOrderObj,
        `🔔 取餐通知 (#${updatedOrderObj.pickupNumber})`,
        `您在【${updatedOrderObj.storeName}】點的餐點已經準備好囉！請至櫃檯出示 #${updatedOrderObj.pickupNumber}（核銷碼 ${updatedOrderObj.verificationCode}）領取。`,
        '餐點備妥可取餐'
      ));
    } else if (nextStatus === '已完成') {
      bgList.push(dispatchOrderNotification(
        env, updatedOrderObj,
        `✅ 訂單 #${updatedOrderObj.pickupNumber} 已完成取餐`,
        `感謝您光臨【${updatedOrderObj.storeName}】，祝您用餐愉快！`,
        '已完成取餐'
      ));
    }
  }
  const syncPromise = Promise.allSettled(bgList);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncPromise);
  else await syncPromise;

  return { updated: true, order: updatedOrderObj };
}

export async function handleMarkReservationPaid(env, ctx, params = {}) {
  return handleUpdateOrderStatus(env, ctx, { ...params, paymentStatus: '已付款' });
}

export async function handleCancelOrder(env, ctx, params = {}) {
  const db = env.DB;
  const orderId = String(params.orderId || '').trim();
  if (!orderId) throw new Error('缺少訂單編號');

  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到該筆訂單: ' + orderId);

  const orderStoreId = String(curOrder.storeId || '').trim();
  const isMerchantAuth = await isMerchantRequestValid(env, params, orderStoreId);
  let approverLabel = '';

  if (!isMerchantAuth) {
    const providedCode = String(params.verificationCode || '').trim().toUpperCase();
    const expectedCode = String(curOrder.verificationCode || '').trim().toUpperCase();
    if (!providedCode || providedCode !== expectedCode) {
      throw new Error('核銷碼驗證失敗，請確認 6 碼取餐核銷碼後再試');
    }
    const curStatus = String(curOrder.status || '');
    const canSelfCancel = (
      curStatus === '已接單待排程' ||
      curStatus === '待付款確認' ||
      (curStatus === '製作中' && curOrder.paymentStatus !== '已付款' && curOrder.isReservation)
    );
    if (!canSelfCancel) {
      throw new Error('訂單已進入廚房備餐或完成階段，無法由線上自助取消，請洽詢店家櫃檯處理。');
    }
  } else {
    const mgrAuth = await assertManagerAuthorized(env, params, orderStoreId);
    approverLabel = mgrAuth.approvedBy || '';
  }

  const reason = String(params.reason || (isMerchantAuth ? '櫃檯取消' : '顧客自助取消預約')).trim();
  const meta = safeJsonParse(curOrder.extraMetaJson, {});
  const wasOriginallyPaid = curOrder.paymentStatus === '已付款';
  const nextStatus = `已取消 (${reason})`;
  let nextPaymentStatus = '已退單作廢';

  if (wasOriginallyPaid || params.wasPaidRefund || Number(params.refundAmount) > 0) {
    const isLinePayOrder = curOrder.paymentMethod === 'LINE Pay';
    const refundAmt = Math.max(0, Number(params.refundAmount) || Number(curOrder.finalTotal) || 0);
    let gatewayRefundNote = '';
    if (isLinePayOrder && meta.transactionId) {
      try {
        const refRes = await refundLinePayTransaction(env, orderStoreId, meta.transactionId, refundAmt);
        if (refRes.attempted) {
          gatewayRefundNote = refRes.returnCode ? `API:${refRes.returnCode}` : '';
          meta.refundGatewayCode = refRes.returnCode || '';
          meta.refundGatewayMessage = refRes.returnMessage || '';
        }
      } catch (e) {
        meta.refundGatewayMessage = e && e.message ? e.message : String(e);
      }
    }
    nextPaymentStatus = isLinePayOrder ? '已退款 (LINE Pay退刷)' : '已退款 (櫃檯退現)';
    meta.refundAmount = refundAmt;
    meta.refundMethod = isLinePayOrder
      ? `LINE Pay 原路退刷${gatewayRefundNote ? ' ' + gatewayRefundNote : ''}`
      : String(params.refundMethod || curOrder.paymentMethod || '現金').trim();
    meta.refundTransactionId = isLinePayOrder
      ? ('REF-' + (meta.transactionId || crypto.randomUUID().slice(0, 8).toUpperCase()))
      : ('CASH-REF-' + Date.now());
    meta.refundedAtDate = getTodayTaipeiStr();
  }
  meta.paymentStatus = nextPaymentStatus;

  const nowMs = Date.now();
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({
    ts: nowMs,
    timeStr: getTaipeiDateParts(nowMs).timeFullStr,
    status: nextStatus,
    label: `訂單已取消作廢 (${reason})`
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);

  await db.prepare(`
    UPDATE orders SET status = ?, payment_status = ?, needs_print = 0, extra_meta_json = ?
    WHERE order_id = ?
  `).bind(nextStatus, nextPaymentStatus, JSON.stringify(meta), orderId).run();

  const cancelledOrderObj = await loadOrderById(db, orderId);

  if (isMerchantAuth) {
    const sess = await parseVerifiedMerchantSession(env, params);
    await appendSystemAuditEntry(
      db,
      orderStoreId,
      sess ? sess.staffName : '',
      sess ? sess.role : 'MANAGER',
      approverLabel,
      '櫃檯退單作廢',
      `單號 #${cancelledOrderObj.pickupNumber} (${orderId})・原因：${reason}・退款狀態：${nextPaymentStatus}`
    );
  }

  const syncPromise = Promise.allSettled([
    syncOrderToFirestore(env, cancelledOrderObj, { removePrintJob: true }),
    dispatchOrderNotification(
      env,
      cancelledOrderObj,
      `🚫 訂單 #${cancelledOrderObj.pickupNumber} 已取消通知`,
      `您在【${cancelledOrderObj.storeName}】的訂單已辦理取消（原因：${reason}）。如有疑問請洽詢店家櫃檯。`,
      nextStatus
    )
  ]);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncPromise);
  else await syncPromise;

  return {
    cancelled: true,
    order: sanitizeOrderForClientOutput(cancelledOrderObj, isMerchantAuth, true)
  };
}

export async function handleModifyOrderItems(env, ctx, params = {}) {
  const db = env.DB;
  const orderId = String(params.orderId || '').trim();
  if (!orderId) throw new Error('缺少訂單編號');

  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到該筆訂單: ' + orderId);

  const orderStoreId = String(curOrder.storeId || '').trim();
  const sess = await assertMerchantAuthorized(env, params, orderStoreId);

  const curStatus = String(curOrder.status || '').trim();
  if (curStatus === '已完成' || curStatus.includes('已取消')) {
    throw new Error('已完成或已作廢之訂單不可改單');
  }

  const incomingItems = Array.isArray(params.structuredItems) ? params.structuredItems : [];
  if (incomingItems.length === 0) {
    throw new Error('改單後至少須保留 1 項餐點（若欲整單取消請使用「退單」功能）');
  }

  const meta = safeJsonParse(curOrder.extraMetaJson, {});
  if (!meta.sealedVerificationCode) {
    meta.sealedVerificationCode = curOrder.verificationCode || await generateOrderVerificationCodeOnServer(env, orderId, curOrder.pickupNumber, curOrder.finalTotal);
  }

  const cleanItems = incomingItems.map(it => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const price = Math.max(0, Number(it.price) || 0);
    return { ...it, qty, price, lineSubtotal: price * qty };
  });

  const newSubtotal = cleanItems.reduce((sum, it) => sum + (it.isGift ? 0 : it.price * it.qty), 0);
  const cutleryFee = Math.max(0, Number(curOrder.cutleryFee) || 0);
  const takeoutFee = Math.max(0, Number(curOrder.takeoutFee) || 0);
  const discount = Math.min(newSubtotal, Math.max(0, Number(curOrder.discount) || 0));
  const manualDiscount = Math.min(Math.max(0, newSubtotal - discount), Math.max(0, Number(meta.manualDiscount) || 0));
  const newFinalTotal = Math.max(0, newSubtotal + cutleryFee + takeoutFee - discount - manualDiscount);
  const oldFinalTotal = Math.max(0, Number(curOrder.finalTotal) || 0);

  const origItems = Array.isArray(curOrder.structuredItems) ? curOrder.structuredItems : [];
  const origQtyByKey = {};
  origItems.forEach(it => {
    if (!it || it.isGift) return;
    const k = String(it.id || it.baseName || it.name || '').trim();
    origQtyByKey[k] = (origQtyByKey[k] || 0) + (Number(it.qty) || 1);
  });
  const newQtyByKey = {};
  cleanItems.forEach(it => {
    if (!it || it.isGift) return;
    const k = String(it.id || it.baseName || it.name || '').trim();
    newQtyByKey[k] = (newQtyByKey[k] || 0) + (Number(it.qty) || 1);
  });
  const hasRemovedOrReducedItem = Object.keys(origQtyByKey).some(k => (newQtyByKey[k] || 0) < origQtyByKey[k]);

  let mgrApprover = '';
  if (newFinalTotal < oldFinalTotal || hasRemovedOrReducedItem) {
    const mgrAuth = await assertManagerAuthorized(env, params, orderStoreId);
    mgrApprover = mgrAuth.approvedBy || '';
  }

  const modifyReason = String(params.reason || '櫃檯改單/單品作廢').trim();
  const wasPaid = curOrder.paymentStatus === '已付款';
  let diffLabel = '';
  const todayStr = getTodayTaipeiStr();

  if (wasPaid && newFinalTotal < oldFinalTotal) {
    const partialDiff = oldFinalTotal - newFinalTotal;
    meta.partialRefundTotal = Math.max(0, Number(meta.partialRefundTotal) || 0) + partialDiff;
    meta.refundedAtDate = todayStr;
    diffLabel = `・部分退現 $${partialDiff}`;
  } else if (wasPaid && newFinalTotal > oldFinalTotal) {
    const extraDiff = newFinalTotal - oldFinalTotal;
    const extraMethod = String(params.extraChargeMethod || '現金').trim();
    meta.extraChargeTotal = Math.max(0, Number(meta.extraChargeTotal) || 0) + extraDiff;
    meta.extraChargeMethod = extraMethod;
    meta.extraChargeAtDate = todayStr;
    if (!Array.isArray(meta.extraChargeHistory)) meta.extraChargeHistory = [];
    meta.extraChargeHistory.push({
      ts: Date.now(),
      amount: extraDiff,
      method: extraMethod,
      cashier: sess.staffName || '櫃檯人員',
      dateStr: todayStr
    });
    diffLabel = `・補收差額 $${extraDiff}(${extraMethod})`;
  }

  const nowMs = Date.now();
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({
    ts: nowMs,
    timeStr: getTaipeiDateParts(nowMs).timeFullStr,
    status: curStatus,
    label: `改單 (${modifyReason}・金額 $${oldFinalTotal} ➔ $${newFinalTotal}${diffLabel})`
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);
  meta.lastModifiedReason = modifyReason;

  await db.prepare(`
    UPDATE orders
    SET items_json = ?, subtotal = ?, discount = ?, final_total = ?, extra_meta_json = ?
    WHERE order_id = ?
  `).bind(JSON.stringify(cleanItems), newSubtotal, discount, newFinalTotal, JSON.stringify(meta), orderId).run();

  const updatedOrderObj = await loadOrderById(db, orderId);
  await appendSystemAuditEntry(
    db, orderStoreId, sess.staffName || '櫃檯人員', sess.role || 'STAFF', mgrApprover,
    '訂單改單/單品作廢',
    `單號 #${updatedOrderObj.pickupNumber} (${orderId})・原因：${modifyReason}・金額 $${oldFinalTotal} → $${newFinalTotal}${diffLabel}`
  );

  const syncPromise = syncOrderToFirestore(env, updatedOrderObj);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncPromise);
  else await syncPromise;

  return { updated: true, order: updatedOrderObj };
}

export async function handleAppendOrderItems(env, ctx, params = {}) {
  const db = env.DB;
  const orderId = String(params.orderId || '').trim();
  if (!orderId) throw new Error('缺少訂單編號');

  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到欲加點的原訂單: ' + orderId);

  const orderStoreId = String(curOrder.storeId || '').trim();
  const curStatus = String(curOrder.status || '');
  if (curStatus === '已完成' || curStatus.includes('已取消')) {
    throw new Error('原訂單已完成或取消，無法併單加點，請重新下單');
  }

  const isMerchantAuth = await isMerchantRequestValid(env, params, orderStoreId);
  if (!isMerchantAuth) {
    const providedCode = String(params.verificationCode || '').trim().toUpperCase();
    const expectedCode = String(curOrder.verificationCode || '').trim().toUpperCase();
    if (!providedCode || providedCode !== expectedCode) {
      throw new Error('核銷碼驗證失敗，無法併入此筆桌單');
    }
  }

  const appendItemsRaw = Array.isArray(params.items) ? params.items : [];
  if (appendItemsRaw.length === 0) throw new Error('請至少選擇 1 項加點餐點');

  const menusRes = await db.prepare('SELECT * FROM menus WHERE store_id = ?').bind(orderStoreId).all();
  const menuById = {};
  const menuByName = {};
  (menusRes.results || []).forEach(m => {
    const parsed = parseMenuRowOptionsAndSoldOut(m);
    const entry = {
      id: String(m.id),
      name: String(m.name || '').trim(),
      category: String(m.category || '招牌主餐').trim(),
      price: Number(m.price) || 0,
      soldOut: parsed.isSoldOut,
      options: parsed.parsedOptions || {}
    };
    menuById[entry.id] = entry;
    menuByName[entry.name] = entry;
  });

  const existingItems = Array.isArray(curOrder.structuredItems) ? curOrder.structuredItems : [];
  const meta = safeJsonParse(curOrder.extraMetaJson, {});
  if (!meta.sealedVerificationCode) {
    meta.sealedVerificationCode = curOrder.verificationCode || await generateOrderVerificationCodeOnServer(env, orderId, curOrder.pickupNumber, curOrder.finalTotal);
  }

  let addedSubtotal = 0;
  const nowMs = Date.now();
  const nowStr = getTaipeiDateParts(nowMs).timeFullStr;
  const verifiedAddOns = appendItemsRaw.map(it => {
    const qty = Math.max(1, Math.min(30, parseInt(it.qty, 10) || 1));
    const lookup = (it.menuId && menuById[String(it.menuId)]) || (it.id && menuById[String(it.id)]) || menuByName[String(it.name || '').trim()];
    if (!lookup) throw new Error(`加點品項「${it.name || ''}」不存在於菜單中`);
    if (lookup.soldOut) throw new Error(`加點品項「${lookup.name}」目前已售罄`);

    let extraDelta = 0;
    const rawMods = Array.isArray(it.modifiers) ? it.modifiers : [];
    const safeMods = [];
    const validChoiceMap = {};
    Object.values(lookup.options || {}).forEach(grp => {
      if (!grp || !Array.isArray(grp.choices)) return;
      grp.choices.forEach(ch => {
        const cLbl = Array.isArray(ch) ? String(ch[0] || '').trim() : String((ch && (ch.label || ch.name)) || ch || '').trim();
        const cDelta = Array.isArray(ch) ? Math.max(0, Number(ch[1]) || 0) : Math.max(0, Number((ch && (ch.priceDelta ?? ch.price)) || 0));
        if (cLbl) validChoiceMap[cLbl] = cDelta;
      });
    });
    rawMods.forEach(mod => {
      const modStr = String(mod || '').trim();
      if (!modStr) return;
      const qm = modStr.match(/^(.+?)\s*[×x]\s*(\d+)$/i);
      const baseLbl = qm ? qm[1].trim() : modStr;
      const mult = qm ? Math.max(1, Math.min(10, parseInt(qm[2], 10) || 1)) : 1;
      if (validChoiceMap[baseLbl] !== undefined) {
        extraDelta += validChoiceMap[baseLbl] * mult;
        safeMods.push(mult > 1 ? `${baseLbl} ×${mult}` : baseLbl);
      }
    });

    const unitPrice = lookup.price + extraDelta;
    addedSubtotal += unitPrice * qty;
    return {
      id: lookup.id,
      menuId: lookup.id,
      category: lookup.category,
      baseName: lookup.name,
      name: lookup.name,
      qty,
      price: unitPrice,
      basePrice: lookup.price,
      lineSubtotal: unitPrice * qty,
      modifiers: safeMods,
      itemNote: String(it.itemNote || '').trim().slice(0, 80),
      isAddOn: true,
      addedAt: nowStr
    };
  });

  const combinedItems = existingItems.concat(verifiedAddOns);
  const newSubtotal = curOrder.subtotal + addedSubtotal;
  const newFinalTotal = curOrder.finalTotal + addedSubtotal;
  const nextStatus = curStatus === '可取餐' ? '製作中' : curStatus;
  let nextPaymentStatus = curOrder.paymentStatus;

  if (nextPaymentStatus === '已付款') {
    nextPaymentStatus = '尚有加點待補款';
    meta.paymentStatus = nextPaymentStatus;
    meta.pendingAddOnAmount = Math.max(0, Number(meta.pendingAddOnAmount) || 0) + addedSubtotal;
  }
  if (params.tableNumber && !meta.tableNumber) {
    meta.tableNumber = String(params.tableNumber).trim().slice(0, 20);
  }
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({
    ts: nowMs,
    timeStr: nowStr,
    status: nextStatus,
    label: `同桌加點併單 (+${verifiedAddOns.length} 品項，+$${addedSubtotal}，累計 $${newFinalTotal})`
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);

  await db.prepare(`
    UPDATE orders
    SET items_json = ?, subtotal = ?, final_total = ?, status = ?, payment_status = ?, extra_meta_json = ?
    WHERE order_id = ?
  `).bind(JSON.stringify(combinedItems), newSubtotal, newFinalTotal, nextStatus, nextPaymentStatus, JSON.stringify(meta), orderId).run();

  const updatedOrderObj = await loadOrderById(db, orderId);
  const syncPromise = syncOrderToFirestore(env, updatedOrderObj);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncPromise);
  else await syncPromise;

  return { updated: true, addedSubtotal, order: sanitizeOrderForClientOutput(updatedOrderObj, isMerchantAuth, true) };
}

export async function handleUpdateOrderItemCheckState(env, ctx, params = {}) {
  const db = env.DB;
  const orderId = String(params.orderId || '').trim();
  if (!orderId) throw new Error('缺少訂單編號');
  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到該筆訂單: ' + orderId);
  await assertMerchantAuthorized(env, params, curOrder.storeId);

  const meta = safeJsonParse(curOrder.extraMetaJson, {});
  if (!meta.itemCheckedMap || typeof meta.itemCheckedMap !== 'object') meta.itemCheckedMap = {};
  if (params.itemCheckedMap && typeof params.itemCheckedMap === 'object') {
    Object.assign(meta.itemCheckedMap, params.itemCheckedMap);
  } else if (params.itemKey !== undefined) {
    meta.itemCheckedMap[String(params.itemKey)] = Boolean(params.checked);
  }

  await db.prepare('UPDATE orders SET extra_meta_json = ? WHERE order_id = ?').bind(JSON.stringify(meta), orderId).run();
  const updatedOrder = await loadOrderById(db, orderId);
  return { updated: true, order: updatedOrder };
}

export async function handleAddMerchantOrderNote(env, ctx, params = {}) {
  const db = env.DB;
  const orderId = String(params.orderId || '').trim();
  const message = String(params.message || '').trim().slice(0, 200);
  if (!orderId) throw new Error('缺少訂單編號');
  if (!message) throw new Error('請輸入給顧客的訊息內容');

  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到該筆訂單: ' + orderId);
  await assertMerchantAuthorized(env, params, curOrder.storeId);

  const nowMs = Date.now();
  const timeStr = getTaipeiDateParts(nowMs).timeFullStr;
  const meta = safeJsonParse(curOrder.extraMetaJson, {});
  meta.merchantMessage = message;
  meta.merchantMessageAt = timeStr;
  if (!Array.isArray(meta.merchantMessages)) meta.merchantMessages = [];
  meta.merchantMessages.push({ ts: nowMs, timeStr, text: message });
  meta.merchantMessages = meta.merchantMessages.slice(-10);
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({ ts: nowMs, timeStr, status: curOrder.status, label: `店家留言：${message}` });
  meta.statusTimeline = meta.statusTimeline.slice(-25);

  await db.prepare('UPDATE orders SET extra_meta_json = ? WHERE order_id = ?').bind(JSON.stringify(meta), orderId).run();
  const updatedOrder = await loadOrderById(db, orderId);

  const syncPromise = Promise.allSettled([
    syncOrderToFirestore(env, updatedOrder),
    dispatchOrderNotification(
      env,
      updatedOrder,
      `💬 店家櫃檯留言通知 (#${updatedOrder.pickupNumber})`,
      `【${updatedOrder.storeName}】櫃檯留言：「${message}」`,
      '店家櫃檯通知'
    )
  ]);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncPromise);
  else await syncPromise;

  return { updated: true, order: updatedOrder };
}

export async function handleChangeOrderPaymentMethod(env, ctx, params = {}) {
  const db = env.DB;
  const orderId = String(params.orderId || '').trim();
  if (!orderId) throw new Error('缺少訂單編號');
  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到訂單: ' + orderId);
  const sess = await assertMerchantAuthorized(env, params, curOrder.storeId);

  const prevMethod = curOrder.paymentMethod;
  const newMethod = String(params.paymentMethod || params.newPaymentMethod || '').trim();
  if (!newMethod) throw new Error('請選擇要變更的付款方式');

  const meta = safeJsonParse(curOrder.extraMetaJson, {});
  if (params.paymentSplit && typeof params.paymentSplit === 'object') {
    meta.paymentSplit = {
      cash: Math.max(0, Number(params.paymentSplit.cash) || 0),
      linePay: Math.max(0, Number(params.paymentSplit.linePay) || 0)
    };
  } else {
    meta.paymentSplit = null;
  }
  if (/LINE\s*Pay/i.test(newMethod) || (meta.paymentSplit && meta.paymentSplit.linePay > 0)) {
    meta.linePayVerifiedMode = String(params.linePayVerifiedMode || 'COUNTER_STANDEE').trim();
  } else {
    meta.linePayVerifiedMode = '';
  }

  let paymentStatus = curOrder.paymentStatus;
  let paidAtDate = curOrder.paidAtDate;
  if (params.markPaid) {
    paymentStatus = '已付款';
    meta.paymentStatus = paymentStatus;
    if (!paidAtDate) paidAtDate = getTodayTaipeiStr();
    meta.paidAtDate = paidAtDate;
  }

  const nowMs = Date.now();
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({
    ts: nowMs,
    timeStr: getTaipeiDateParts(nowMs).timeFullStr,
    status: curOrder.status,
    label: `櫃檯修正付款方式：${prevMethod} ➔ ${newMethod}`
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);

  await db.prepare(`
    UPDATE orders SET payment_method = ?, payment_status = ?, paid_at_date = ?, extra_meta_json = ?
    WHERE order_id = ?
  `).bind(newMethod, paymentStatus, paidAtDate, JSON.stringify(meta), orderId).run();

  const updatedOrder = await loadOrderById(db, orderId);
  await appendSystemAuditEntry(
    db,
    curOrder.storeId,
    sess ? sess.staffName : '',
    sess ? sess.role : 'MANAGER',
    '',
    '修正訂單付款方式',
    `單號 #${updatedOrder.pickupNumber} (${orderId})：${prevMethod} ➔ ${newMethod}`
  );

  const syncPromise = syncOrderToFirestore(env, updatedOrder);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncPromise);
  else await syncPromise;

  return { updated: true, storeId: curOrder.storeId, newPaymentMethod: newMethod, order: updatedOrder };
}

// ==================== 6. 出單佇列 (getPendingPrintJobs / ackPrintJob / requeuePrintJob) ====================

export async function handleGetPendingPrintJobs(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || params.store || 'S01').trim().toUpperCase();
  await assertPrinterBridgeAuthorized(env, params, storeId);

  const storeCtx = await getStoreCustomMetaAndConfig(db, storeId);
  if (!storeCtx) throw new Error('查無店家: ' + storeId);
  const { row: storeRow, customMeta, frontCategories } = storeCtx;
  const autoPrintEnabled = customMeta.printerAutoEnabled !== undefined ? Boolean(customMeta.printerAutoEnabled) : true;
  const nowMs = Date.now();

  if (!autoPrintEnabled) {
    return { storeId, storeName: storeRow.name, frontCategories, autoPrintEnabled: false, jobs: [], serverTimeTs: nowMs };
  }

  const todayStr = getTodayTaipeiStr();
  // 只用精準索引撈出 needs_print = 1 且取餐日 >= 今日之待印單（無新單時 rows_read = 0）
  const pendingRes = await db.prepare(`
    SELECT * FROM orders
    WHERE store_id = ? AND needs_print = 1 AND pickup_date >= ?
    ORDER BY created_at_ts DESC
    LIMIT 50
  `).bind(storeId, todayStr).all();

  const rawRows = pendingRes.results || [];
  // 無待印訂單時立刻回傳，絕不查詢 menus！
  if (rawRows.length === 0) {
    return { storeId, storeName: storeRow.name, frontCategories, autoPrintEnabled: true, jobs: [], serverTimeTs: nowMs };
  }

  // 有待印單時也直接從 60 秒記憶體快取取得菜單分類，零額外 D1 查詢
  const sm = await getCachedStoresAndMenus(db);
  const storeMenus = sm.menusByStoreId.get(storeId) || [];
  const menuCatById = {};
  const menuCatByName = {};
  for (const m of storeMenus) {
    const c = String(m.category || '其他').trim();
    if (m.id) menuCatById[String(m.id)] = c;
    if (m.name && !menuCatByName[String(m.name).trim()]) menuCatByName[String(m.name).trim()] = c;
  }

  const maxAgeMs = 12 * 3600 * 1000;
  const jobs = [];
  const staleClearIds = [];

  for (const row of rawRows) {
    const o = dbRowToOrderObject(row);
    if (!o || isCorruptedOrMockOrder(o)) continue;

    const st = String(o.status || '').trim();
    if (st === '待付款 (LINE Pay 授權中)' || st.includes('已取消') || st === '已退單' || st === '已完成') {
      staleClearIds.push(o.orderId);
      continue;
    }

    let printMode = '';
    if (st === '製作中' || st === '可取餐') {
      if (String(o.printStatus || '').toUpperCase() === 'PRINTED') {
        staleClearIds.push(o.orderId);
        continue;
      }
      printMode = 'NORMAL';
    } else if (o.isReservation || st.includes('預訂') || st.includes('預約') || st.includes('排程')) {
      if (o.preprintDone) {
        staleClearIds.push(o.orderId);
        continue;
      }
      printMode = 'PREORDER_COUNTER_ONLY';
    } else {
      staleClearIds.push(o.orderId);
      continue;
    }

    if (o.pickupDate < todayStr) {
      staleClearIds.push(o.orderId);
      continue;
    }
    if (!o.isReservation && o.createdAtTs > 0 && (nowMs - o.createdAtTs) > maxAgeMs && String(o.printStatus || '').toUpperCase() !== 'PENDING') {
      staleClearIds.push(o.orderId);
      continue;
    }

    const enrichedItems = (o.structuredItems || []).map(it => ({
      ...it,
      category: String(it.category || menuCatById[String(it.id || '')] || menuCatByName[String(it.baseName || it.name || '').trim()] || '其他').trim()
    }));
    jobs.push(buildPrintJobPayload({ ...o, structuredItems: enrichedItems }, frontCategories, printMode));
  }

  // 若有舊狀態殘留 needs_print = 1，自動清除避免下次輪詢重複讀取
  if (staleClearIds.length > 0) {
    const clearStmts = staleClearIds.map(oid =>
      db.prepare('UPDATE orders SET needs_print = 0 WHERE order_id = ?').bind(oid)
    );
    await db.batch(clearStmts).catch(() => {});
  }

  return { storeId, storeName: storeRow.name, frontCategories, autoPrintEnabled: true, jobs, serverTimeTs: nowMs };
}

export async function handleAckPrintJob(env, ctx, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || 'S01').trim().toUpperCase();
  const orderId = String(params.orderId || '').trim();
  const printMode = String(params.printMode || 'NORMAL').trim().toUpperCase();
  await assertPrinterBridgeAuthorized(env, params, storeId);
  if (!orderId) throw new Error('缺少訂單編號 (orderId)');

  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到訂單: ' + orderId);
  if (String(curOrder.storeId || '').toUpperCase() !== storeId) {
    throw new Error('無權限確認他店訂單之列印狀態');
  }

  const nowTs = Date.now();
  if (printMode === 'PREORDER_COUNTER_ONLY') {
    await db.prepare('UPDATE orders SET preprint_done = 1, needs_print = 0 WHERE order_id = ?').bind(orderId).run();
  } else {
    const meta = safeJsonParse(curOrder.extraMetaJson, {});
    meta.printStatus = 'PRINTED';
    meta.printedAtTs = nowTs;
    await db.prepare(`
      UPDATE orders SET print_status = 'PRINTED', needs_print = 0, extra_meta_json = ?
      WHERE order_id = ?
    `).bind(JSON.stringify(meta), orderId).run();
  }

  // 列印完成後立刻從 Firestore print_queue 移除，避免重複列印並省額度
  const rmPromise = removePrintQueueDoc(env, storeId, orderId);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(rmPromise);
  else await rmPromise;

  return { acked: true, storeId, orderId, printMode, printedAtTs: nowTs };
}

export async function handleRequeuePrintJob(env, ctx, params = {}) {
  const db = env.DB;
  const orderId = String(params.orderId || '').trim();
  if (!orderId) throw new Error('缺少訂單編號 (orderId)');
  const curOrder = await loadOrderById(db, orderId);
  if (!curOrder) throw new Error('找不到訂單: ' + orderId);

  const orderStoreId = String(curOrder.storeId || '').trim().toUpperCase();
  await assertMerchantAuthorized(env, params, orderStoreId);

  const meta = safeJsonParse(curOrder.extraMetaJson, {});
  meta.printStatus = 'PENDING';
  meta.printedAtTs = 0;
  meta.reprintRequestedAtTs = Date.now();

  await db.prepare(`
    UPDATE orders SET print_status = 'PENDING', needs_print = 1, extra_meta_json = ?
    WHERE order_id = ?
  `).bind(JSON.stringify(meta), orderId).run();

  const updatedOrder = await loadOrderById(db, orderId);
  const storeCtx = await getStoreCustomMetaAndConfig(db, orderStoreId);
  const syncPromise = syncOrderToFirestore(env, updatedOrder, {
    pushPrintJob: true,
    printMode: 'NORMAL',
    frontCategories: storeCtx ? storeCtx.frontCategories : undefined
  });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncPromise);
  else await syncPromise;

  return { requeued: true, storeId: orderStoreId, orderId };
}

// ==================== 7. MVP 店務設定與售罄快速切換 ====================

export async function handleUpdateStoreConfig(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');

  const sensitiveFields = [
    'cutleryPrice', 'promoMode', 'promoDiscount', 'promoMinSubtotal', 'promoScope',
    'secondItemDiscount', 'coupons', 'allowDineInPostPay', 'maxCapacityPer15Min', 'basePrepMinutes',
    'autoCompleteMinutes'
  ];
  const touchesSensitive = sensitiveFields.some(f => params[f] !== undefined);
  if (touchesSensitive) {
    await assertManagerAuthorized(env, params, storeId);
  } else {
    await assertMerchantAuthorized(env, params, storeId);
  }

  const storeCtx = await getStoreCustomMetaAndConfig(db, storeId);
  if (!storeCtx) throw new Error('查無店家: ' + storeId);
  const { row, customMeta } = storeCtx;

  const nextMeta = { ...customMeta };
  const metaKeys = [
    'icon', 'openTime', 'closeTime', 'breakStartTime', 'breakEndTime',
    'closedDays', 'weeklyHours', 'comboDiscounts', 'morningSoldOutPolicy',
    'enableOnlineLinePay', 'printerFrontCategories', 'printerAutoEnabled',
    'reserveLeadMinutes', 'autoCompleteMinutes', 'promoMinSubtotal', 'promoScope', 'giftMenuItemId',
    'secondItemDiscount', 'coupons', 'allowDineInPostPay', 'visibleToStudents', 'linePayFeeRate'
  ];
  for (const k of metaKeys) {
    if (params[k] !== undefined) nextMeta[k] = params[k];
  }
  if (params.autoCompleteMinutes !== undefined) {
    const rawAuto = parseInt(params.autoCompleteMinutes, 10);
    nextMeta.autoCompleteMinutes = (Number.isFinite(rawAuto) && rawAuto > 0)
      ? Math.max(5, Math.min(240, rawAuto))
      : 0;
  }

  if (params.baseQueueOffset !== undefined) {
    const simOffsets = safeJsonParse(await kvGet(db, 'SIM_QUEUE_OFFSETS'), {});
    simOffsets[storeId] = Math.max(0, Number(params.baseQueueOffset) || 0);
    await kvSet(db, 'SIM_QUEUE_OFFSETS', JSON.stringify(simOffsets));
  }

  const nextIsOpen = params.isOpen !== undefined ? (params.isOpen ? 1 : 0) : row.is_open;
  const nextMaxCap = params.maxCapacityPer15Min !== undefined ? Math.max(5, Number(params.maxCapacityPer15Min) || 20) : row.max_capacity_per_15min;
  const nextBasePrep = params.basePrepMinutes !== undefined ? Math.max(1, Number(params.basePrepMinutes) || 4) : row.base_prep_minutes;
  const nextCutlery = params.cutleryPrice !== undefined ? Math.max(0, Number(params.cutleryPrice) || 0) : row.cutlery_price;
  const nextPromoMode = params.promoMode !== undefined ? String(params.promoMode) : row.promo_mode;
  const nextPromoText = params.promoText !== undefined ? String(params.promoText) : row.promo_text;
  const nextPromoDisc = params.promoDiscount !== undefined ? Math.max(0, Number(params.promoDiscount) || 0) : row.promo_discount;

  await db.prepare(`
    UPDATE stores
    SET is_open = ?, max_capacity_per_15min = ?, base_prep_minutes = ?,
        cutlery_price = ?, promo_mode = ?, promo_text = ?, promo_discount = ?,
        custom_meta_json = ?
    WHERE id = ?
  `).bind(
    nextIsOpen, nextMaxCap, nextBasePrep,
    nextCutlery, nextPromoMode, nextPromoText, nextPromoDisc,
    JSON.stringify(nextMeta), storeId
  ).run();
  invalidateCatalogCache();

  return { updated: true, storeId };
}

export async function handleToggleMenuSoldOut(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  const menuId = String(params.menuId || '').trim();
  if (!storeId || !menuId) throw new Error('缺少 storeId 或 menuId');
  await assertMerchantAuthorized(env, params, storeId);

  const row = await db.prepare('SELECT * FROM menus WHERE id = ? AND store_id = ?').bind(menuId, storeId).first();
  if (!row) throw new Error('找不到該菜單品項: ' + menuId);

  const soldOut = Boolean(params.soldOut);
  const soldOutType = soldOut
    ? (String(params.soldOutType || 'TODAY').toUpperCase() === 'PERMANENT' ? 'PERMANENT' : 'TODAY')
    : 'NONE';
  const soldOutDate = soldOut ? normalizeDateStr(params.soldOutDate || getTodayTaipeiStr()) : '';

  const rawOpts = safeJsonParse(row.options_json, {});
  const soldOutGroup = String(rawOpts.__soldOutGroup || '').trim();
  const affectedMenuIds = [];

  if (soldOutGroup) {
    const storeMenusRes = await db.prepare('SELECT id, options_json FROM menus WHERE store_id = ?').bind(storeId).all();
    const batchStmts = [];
    for (const mRow of (storeMenusRes.results || [])) {
      const mOpts = safeJsonParse(mRow.options_json, {});
      const mGroup = String(mOpts.__soldOutGroup || '').trim();
      if (String(mRow.id) === menuId || (mGroup && mGroup === soldOutGroup)) {
        mOpts.__soldOut = soldOut;
        mOpts.__soldOutType = soldOutType;
        mOpts.__soldOutDate = soldOutDate;
        batchStmts.push(
          db.prepare('UPDATE menus SET sold_out = ?, options_json = ? WHERE id = ? AND store_id = ?')
            .bind(soldOut ? 1 : 0, JSON.stringify(mOpts), String(mRow.id), storeId)
        );
        affectedMenuIds.push(String(mRow.id));
      }
    }
    if (batchStmts.length > 0) {
      await db.batch(batchStmts);
    }
  } else {
    rawOpts.__soldOut = soldOut;
    rawOpts.__soldOutType = soldOutType;
    rawOpts.__soldOutDate = soldOutDate;

    await db.prepare(`
      UPDATE menus SET sold_out = ?, options_json = ?
      WHERE id = ? AND store_id = ?
    `).bind(soldOut ? 1 : 0, JSON.stringify(rawOpts), menuId, storeId).run();
    affectedMenuIds.push(menuId);
  }
  invalidateCatalogCache();

  return { updated: true, storeId, menuId, soldOut, soldOutType, soldOutDate, soldOutGroup, affectedMenuIds };
}

export async function handleRestoreSoldOutMenusBatch(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少 storeId');
  await assertMerchantAuthorized(env, params, storeId);

  const menuIds = Array.isArray(params.menuIds) ? params.menuIds.map(String) : [];
  const res = await db.prepare('SELECT * FROM menus WHERE store_id = ? AND sold_out = 1').bind(storeId).all();
  const targets = (res.results || []).filter(m => menuIds.length === 0 || menuIds.includes(String(m.id)));

  const stmts = [];
  for (const row of targets) {
    const rawOpts = safeJsonParse(row.options_json, {});
    rawOpts.__soldOut = false;
    rawOpts.__soldOutType = 'NONE';
    rawOpts.__soldOutDate = '';
    stmts.push(
      db.prepare('UPDATE menus SET sold_out = 0, options_json = ? WHERE id = ? AND store_id = ?')
        .bind(JSON.stringify(rawOpts), String(row.id), storeId)
    );
  }
  if (stmts.length > 0) {
    await db.batch(stmts);
    invalidateCatalogCache();
  }
  return { restored: true, storeId, count: stmts.length };
}

// ==================== 8. Cron 排程：到期預訂單自動推入廚房出單 ====================

export async function runScheduledReservationPromotion(env, ctx) {
  const db = env.DB;
  const nowMs = Date.now();
  const nowP = getTaipeiDateParts(nowMs);

  // 利用 idx_orders_active_status 精準只撈進行中/待排程訂單，絕不掃歷史已完成與已取消單
  const [sm, ordersRes] = await Promise.all([
    getCachedStoresAndMenus(db),
    db.prepare(`
      SELECT * FROM orders
      WHERE status IN ('製作中', '可取餐', '已接單待排程', '待付款確認', '待付款 (LINE Pay 授權中)')
      ORDER BY created_at_ts DESC LIMIT 200
    `).all()
  ]);

  const storesList = sm.stores || [];
  const storeMetaMap = {};
  storesList.forEach(s => {
    const meta = safeJsonParse(s.custom_meta_json, {});
    const frontCats = Array.isArray(meta.printerFrontCategories) && meta.printerFrontCategories.length > 0
      ? meta.printerFrontCategories
      : ['飯捲類', '飲料類', '飲品類'];
    storeMetaMap[String(s.id)] = {
      leadMins: Math.max(10, Math.min(90, Number(meta.reserveLeadMinutes) || 25)),
      autoPrintEnabled: meta.printerAutoEnabled !== undefined ? Boolean(meta.printerAutoEnabled) : true,
      frontCategories: frontCats
    };
  });

  let promotedCount = 0;
  let cleanedCount = 0;
  const activeOrdersForAutoComplete = [];

  for (const row of (ordersRes.results || [])) {
    const ord = dbRowToOrderObject(row);
    if (!ord) continue;
    const sInfo = storeMetaMap[ord.storeId] || { leadMins: 25, autoPrintEnabled: true, frontCategories: ['飯捲類', '飲料類', '飲品類'] };
    const meta = safeJsonParse(ord.extraMetaJson, {});

    // 1. 清理逾時 20 分鐘之 LINE Pay 未授權預建單
    if (ord.status === '待付款 (LINE Pay 授權中)') {
      if (ord.createdAtTs > 0 && (nowMs - ord.createdAtTs) > 20 * 60 * 1000) {
        meta.paymentStatus = '已退單作廢';
        if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
        meta.statusTimeline.push({ ts: nowMs, timeStr: nowP.timeFullStr, status: '已取消 (LINE Pay 付款逾時未完成)', label: 'LINE Pay 逾時未授權自動取消' });
        await db.prepare(`
          UPDATE orders SET status = '已取消 (LINE Pay 付款逾時未完成)', payment_status = '已退單作廢', needs_print = 0, extra_meta_json = ?
          WHERE order_id = ?
        `).bind(JSON.stringify(meta), ord.orderId).run();
        cleanedCount++;
      }
      continue;
    }

    // 2. 評估到期預訂單推入廚房或歷史歸檔
    const nextStatus = evaluateOrderLifecycleStatus(
      ord.status,
      ord.isReservation,
      ord.paymentStatus,
      ord.pickupDate,
      ord.pickupTime,
      nowP.dateStr,
      nowP.minutesOfDay,
      sInfo.leadMins
    );

    if (nextStatus !== ord.status) {
      if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
      let nextPaymentStatus = ord.paymentStatus;
      let shouldPushNormalPrint = false;
      let nextNeedsPrint = 0;

      if (nextStatus.includes('已取消')) {
        nextPaymentStatus = '已退單作廢';
        meta.paymentStatus = nextPaymentStatus;
        meta.statusTimeline.push({ ts: nowMs, timeStr: nowP.timeFullStr, status: nextStatus, label: '系統自動歸檔作廢' });
        nextNeedsPrint = 0;
        cleanedCount++;
      } else if (nextStatus === '製作中') {
        meta.cookingStartedAtTs = meta.cookingStartedAtTs || nowMs;
        meta.autoFiredAtTs = nowMs;
        meta.statusTimeline.push({ ts: nowMs, timeStr: nowP.timeFullStr, status: '製作中', label: '預訂單到時自動推入廚房 (Auto-fire)' });
        shouldPushNormalPrint = sInfo.autoPrintEnabled && ord.printStatus !== 'PRINTED';
        nextNeedsPrint = ord.printStatus !== 'PRINTED' ? 1 : 0;
        promotedCount++;
      }

      await db.prepare(`
        UPDATE orders SET status = ?, payment_status = ?, needs_print = ?, extra_meta_json = ?
        WHERE order_id = ?
      `).bind(nextStatus, nextPaymentStatus, nextNeedsPrint, JSON.stringify(meta), ord.orderId).run();

      const updatedOrd = await loadOrderById(db, ord.orderId);
      const syncPromise = syncOrderToFirestore(env, updatedOrd, {
        pushPrintJob: shouldPushNormalPrint,
        printMode: 'NORMAL',
        frontCategories: sInfo.frontCategories
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(syncPromise);
      else await syncPromise;

      if (updatedOrd && (updatedOrd.status === '製作中' || updatedOrd.status === '可取餐')) {
        activeOrdersForAutoComplete.push(updatedOrd);
      }
    } else if (ord.status === '製作中' || ord.status === '可取餐') {
      activeOrdersForAutoComplete.push(ord);
    }
  }

  // 3. 針對有開啟「自動結單時間」的忙碌店家，將超過設定分鐘數的進行中訂單自動結單為「已完成」
  const autoRes = await autoCompleteExpiredOrders(env, storesList, activeOrdersForAutoComplete, ctx);

  return {
    promotedCount,
    cleanedCount,
    autoCompletedCount: autoRes.completedCount,
    checkedAt: nowP.dateTimeStr
  };
}
