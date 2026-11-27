/**
 * MealFlow Cloudflare Workers — 共用時間、計價、排隊演算法、脫敏與資料模型轉換工具
 * 100% 對齊原 Google Apps Script (code.gs) 商業邏輯與欄位格式
 */

export const BRAND_NAME = 'MealFlow';
export const DB_SCHEMA_VERSION = 'MEALFLOW_CF_D1_V1';
export const AI_DISCOUNT_MIN_SUBTOTAL = 60;
export const LARGE_ORDER_DEPOSIT_THRESHOLD = 500;
export const SESSION_TTL_MS = 8 * 3600 * 1000;

// ==================== 1. 台北時區 (UTC+8, 無夏令時間) 工具 ====================

export function getTaipeiDateParts(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const ms = isNaN(d.getTime()) ? Date.now() : d.getTime();
  // Asia/Taipei 固定為 UTC+8
  const t = new Date(ms + 8 * 3600 * 1000);
  const year = t.getUTCFullYear();
  const month = String(t.getUTCMonth() + 1).padStart(2, '0');
  const day = String(t.getUTCDate()).padStart(2, '0');
  const hours = String(t.getUTCHours()).padStart(2, '0');
  const minutes = String(t.getUTCMinutes()).padStart(2, '0');
  const seconds = String(t.getUTCSeconds()).padStart(2, '0');
  const dayOfWeek = t.getUTCDay(); // 0=日..6=六
  return {
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    dayOfWeek,
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${hours}:${minutes}`,
    timeFullStr: `${hours}:${minutes}:${seconds}`,
    dateTimeStr: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
    minutesOfDay: parseInt(hours, 10) * 60 + parseInt(minutes, 10)
  };
}

export function getTodayTaipeiStr() {
  return getTaipeiDateParts().dateStr;
}

export function normalizeDateStr(val) {
  if (!val) return getTodayTaipeiStr();
  if (val instanceof Date && !isNaN(val.getTime())) {
    return getTaipeiDateParts(val).dateStr;
  }
  const str = String(val).trim();
  const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return getTaipeiDateParts(parsed).dateStr;
  }
  return getTodayTaipeiStr();
}

export function normalizeTimeStr(val, includeSeconds = false) {
  if (!val) {
    const p = getTaipeiDateParts();
    return includeSeconds ? p.timeFullStr : p.timeStr;
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    const p = getTaipeiDateParts(val);
    return includeSeconds ? p.timeFullStr : p.timeStr;
  }
  const str = String(val).trim();
  const isPM = /下午|PM|pm/.test(str);
  const isAM = /上午|AM|am/.test(str);
  const m = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    let hhNum = parseInt(m[1], 10);
    if (isPM && hhNum < 12) hhNum += 12;
    if (isAM && hhNum === 12) hhNum = 0;
    if (hhNum === 24) hhNum = 0;
    const hh = String(hhNum).padStart(2, '0');
    const mm = m[2];
    const ss = m[3] || '00';
    return includeSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const p = getTaipeiDateParts(parsed);
    return includeSeconds ? p.timeFullStr : p.timeStr;
  }
  return includeSeconds ? '12:15:00' : '12:15';
}

export function parseTimeStrToMins(tStr, fallbackMins) {
  const m = String(tStr || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallbackMins;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function isPeakHourSlot(timeStr) {
  const clean = normalizeTimeStr(timeStr, false);
  const m = clean.match(/(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return mins >= (11 * 60 + 45) && mins <= (12 * 60 + 45);
}

export function getDayOfWeekForDateStr(dateStr) {
  const dParts = String(dateStr || '').split('-');
  if (dParts.length !== 3) return getTaipeiDateParts().dayOfWeek;
  return new Date(Date.UTC(Number(dParts[0]), Number(dParts[1]) - 1, Number(dParts[2]))).getUTCDay();
}

// ==================== 2. 驗證、遮蔽與 JSON 工具 ====================

export function safeJsonParse(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

export function validateTaiwanTaxId(rawTaxId) {
  const s = String(rawTaxId || '').trim();
  if (!s) return true;
  if (!/^\d{8}$/.test(s) || s === '00000000') return false;
  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const prod = parseInt(s.charAt(i), 10) * weights[i];
    sum += Math.floor(prod / 10) + (prod % 10);
  }
  if (sum % 5 === 0) return true;
  if (s.charAt(6) === '7' && (sum + 1) % 5 === 0) return true;
  return false;
}

export function generateStableMenuItemId(storeId, itemName, category) {
  const cleanName = String(itemName || '').trim();
  const cleanCat = String(category || '').trim();
  const cleanStore = String(storeId || 'S00').trim().toUpperCase();
  let h = 2166136261;
  const raw = cleanCat ? `${cleanStore}::${cleanCat}::${cleanName}` : `${cleanStore}::${cleanName}`;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hexSuffix = (h >>> 0).toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
  return `M-${cleanStore}-${hexSuffix}`;
}

export function extractPhoneLast3(phoneVal) {
  const digits = String(phoneVal || '').replace(/\D/g, '');
  return digits.length >= 3 ? digits.slice(-3) : '';
}

export function maskPhoneForPublic(phoneVal) {
  const raw = String(phoneVal || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 7) {
    return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
  }
  if (digits.length >= 3) {
    return `***${digits.slice(-3)}`;
  }
  return '***';
}

export function sanitizeOrderForClientOutput(orderObj, hasMerchantFullAccess, canRevealVerificationCode = true) {
  if (!orderObj) return null;
  const clone = { ...orderObj };
  clone.customerPhoneLast3 = extractPhoneLast3(clone.customerPhone);
  if (!hasMerchantFullAccess) {
    clone.customerPhone = maskPhoneForPublic(clone.customerPhone);
    delete clone.lineUserId;
    delete clone.customerEmail;
    delete clone.clientDeviceId;
    if (!canRevealVerificationCode) {
      clone.verificationCode = '******';
    }
  }
  return clone;
}

export function isCorruptedOrMockOrder(o) {
  if (!o) return true;
  if (o.isSeedSample) return true;
  const oid = String(o.orderId || '');
  if (oid.startsWith('ORD-DEMO-') || /^ORD-\d+$/.test(oid)) return true;
  const pNum = String(o.pickupNumber || '');
  if (/^[SCP]\d{3}$/.test(pNum)) return true;
  return false;
}

// ==================== 3. 營業時間、公休、組合折扣與菜單選項 ====================

export function normalizeClosedDaysList(rawClosed) {
  if (rawClosed === undefined || rawClosed === null) return [];
  const rawArr = Array.isArray(rawClosed)
    ? rawClosed
    : String(rawClosed).split(/[,，、\s]+/);
  const dayZhMap = { '日': 0, '週日': 0, '一': 1, '週一': 1, '二': 2, '週二': 2, '三': 3, '週三': 3, '四': 4, '週四': 4, '五': 5, '週五': 5, '六': 6, '週六': 6 };
  const set = new Set();
  rawArr.forEach(tok => {
    const s = String(tok === undefined || tok === null ? '' : tok).trim();
    if (!s) return;
    if (dayZhMap[s] !== undefined) {
      set.add(dayZhMap[s]);
      return;
    }
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 0 && n <= 6) set.add(n);
  });
  return Array.from(set).sort((a, b) => a - b);
}

export function normalizeWeeklyHours(rawWeekly) {
  const out = {};
  if (!rawWeekly || typeof rawWeekly !== 'object' || Array.isArray(rawWeekly)) return out;
  for (let d = 0; d <= 6; d++) {
    const entry = rawWeekly[String(d)] !== undefined ? rawWeekly[String(d)] : rawWeekly[d];
    if (!entry || typeof entry !== 'object') continue;
    const isClosed = Boolean(entry.closed);
    const open = /^\d{1,2}:\d{2}$/.test(String(entry.open || '').trim()) ? String(entry.open).trim() : '';
    const close = /^\d{1,2}:\d{2}$/.test(String(entry.close || '').trim()) ? String(entry.close).trim() : '';
    if (isClosed || open || close) {
      out[String(d)] = { closed: isClosed, open, close };
    }
  }
  return out;
}

export function resolveStoreDaySchedule(customMeta, dayOfWeek) {
  const baseOpen = String((customMeta && customMeta.openTime) || '10:30').trim();
  const baseClose = String((customMeta && customMeta.closeTime) || '19:30').trim();
  const closedArr = normalizeClosedDaysList(customMeta && customMeta.closedDays);
  const weekly = normalizeWeeklyHours(customMeta && customMeta.weeklyHours);
  const dayRule = weekly[String(dayOfWeek)] || null;
  const isClosed = Boolean((dayRule && dayRule.closed) || closedArr.includes(dayOfWeek));
  const openTime = (dayRule && dayRule.open) ? dayRule.open : baseOpen;
  const closeTime = (dayRule && dayRule.close) ? dayRule.close : baseClose;
  return { isClosed, openTime, closeTime };
}

export function evaluateStoreBusinessHours(customMeta, isManualOpen) {
  if (isManualOpen === false) {
    return {
      canOrderNow: false,
      canPreOrder: false,
      reasonCode: 'MANUAL_CLOSED',
      statusLabel: '本店目前暫停營業中（暫停現場點餐與預訂服務）'
    };
  }
  const nowParts = getTaipeiDateParts();
  const nowMins = nowParts.minutesOfDay;
  const todaySched = resolveStoreDaySchedule(customMeta, nowParts.dayOfWeek);
  if (todaySched.isClosed) {
    return { canOrderNow: false, canPreOrder: true, reasonCode: 'CLOSED_DAY', statusLabel: '今日為本店固定公休日（開放預訂其他營業日）' };
  }

  const openTimeStr = todaySched.openTime;
  const closeTimeStr = todaySched.closeTime;
  const openMins = parseTimeStrToMins(openTimeStr, 10 * 60 + 30);
  const closeMins = parseTimeStrToMins(closeTimeStr, 19 * 60 + 30);

  if (nowMins < openMins) {
    return { canOrderNow: false, canPreOrder: true, reasonCode: 'BEFORE_OPEN', statusLabel: `尚未開門（今日營業時間 ${openTimeStr}~${closeTimeStr}，可先預訂）` };
  }
  if (nowMins > closeMins) {
    return { canOrderNow: false, canPreOrder: true, reasonCode: 'AFTER_CLOSE', statusLabel: `今日已打烊（今日營業時間 ${openTimeStr}~${closeTimeStr}，開放預訂明日取餐）` };
  }

  const breakStartStr = String((customMeta && customMeta.breakStartTime) || '').trim();
  const breakEndStr = String((customMeta && customMeta.breakEndTime) || '').trim();
  if (breakStartStr && breakEndStr) {
    const bStart = parseTimeStrToMins(breakStartStr, -1);
    const bEnd = parseTimeStrToMins(breakEndStr, -1);
    if (bStart >= 0 && bEnd > bStart && nowMins >= bStart && nowMins < bEnd) {
      return { canOrderNow: false, canPreOrder: true, reasonCode: 'ON_BREAK', statusLabel: `目前為午休時段（${breakStartStr}~${breakEndStr}，可預訂午休後取餐）` };
    }
  }

  return { canOrderNow: true, canPreOrder: true, reasonCode: 'OPEN', statusLabel: '正常營業中' };
}

export function normalizeComboDiscounts(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter(r => r && Number(r.discountAmount) > 0 && (String(r.matchA || r.matchValA || '').trim()) && (String(r.matchB || r.matchValB || '').trim()))
    .slice(0, 20)
    .map((r, idx) => {
      const mA = String(r.matchA || r.matchValA || '').trim().slice(0, 40);
      const mB = String(r.matchB || r.matchValB || '').trim().slice(0, 40);
      return {
        id: String(r.id || ('CB-' + (idx + 1))).trim().slice(0, 32),
        name: String(r.name || `${mA} + ${mB}`).trim().slice(0, 40),
        matchA: mA,
        matchB: mB,
        matchTypeA: String(r.matchTypeA || 'KEYWORD').toUpperCase() === 'CATEGORY' ? 'CATEGORY' : 'KEYWORD',
        matchValA: mA,
        matchTypeB: String(r.matchTypeB || 'KEYWORD').toUpperCase() === 'CATEGORY' ? 'CATEGORY' : 'KEYWORD',
        matchValB: mB,
        discountAmount: Math.max(1, Math.min(500, Math.round(Number(r.discountAmount) || 5))),
        active: r.active !== false
      };
    });
}

export function evaluateComboDiscounts(verifiedItems, comboRules, menuMetaById) {
  const rules = normalizeComboDiscounts(comboRules).filter(r => r.active !== false);
  if (rules.length === 0 || !Array.isArray(verifiedItems) || verifiedItems.length === 0) {
    return { totalComboDiscount: 0, matchedDetails: [] };
  }
  const units = [];
  verifiedItems.forEach(it => {
    if (!it || it.isGift || it.isComped) return;
    const q = Math.max(1, parseInt(it.qty, 10) || 1);
    const meta = (menuMetaById && menuMetaById[String(it.id || '')]) || {};
    const cat = String(it.category || meta.category || '').trim();
    const nm = String(it.baseName || it.name || '').trim();
    for (let k = 0; k < q; k++) {
      units.push({ cat, name: nm, used: false });
    }
  });
  const matchesCond = (u, mType, mVal) => {
    const raw = String(mVal || '').trim().toLowerCase();
    if (!raw) return false;
    const tokens = raw.split(/[\/|,、]+/).map(s => s.trim()).filter(Boolean);
    return tokens.some(tok => {
      if (mType === 'CATEGORY' || tok.startsWith('cat:')) {
        const cTarget = tok.startsWith('cat:') ? tok.slice(4).trim() : tok;
        return cTarget && (u.cat.toLowerCase() === cTarget || u.cat.toLowerCase().includes(cTarget));
      }
      return u.name.toLowerCase().includes(tok) || u.cat.toLowerCase().includes(tok);
    });
  };

  let totalComboDiscount = 0;
  const matchedDetails = [];
  rules.forEach(rule => {
    let pairs = 0;
    while (true) {
      const idxA = units.findIndex(u => !u.used && matchesCond(u, rule.matchTypeA, rule.matchValA));
      if (idxA < 0) break;
      units[idxA].used = true;
      const idxB = units.findIndex(u => !u.used && matchesCond(u, rule.matchTypeB, rule.matchValB));
      if (idxB < 0) {
        units[idxA].used = false;
        break;
      }
      units[idxB].used = true;
      pairs++;
    }
    if (pairs > 0) {
      const off = pairs * rule.discountAmount;
      totalComboDiscount += off;
      matchedDetails.push({ id: rule.id, name: rule.name, pairs, discount: off });
    }
  });
  return { totalComboDiscount, matchedDetails };
}

export function parseMenuRowOptionsAndSoldOut(menuRow) {
  let parsedOptions = {};
  let legacySoldOut = false;
  let soldOutType = '';
  let soldOutDate = '';
  let dailyLimit = 0;
  let nameEn = '';
  let station = 'AUTO';
  let tileColor = '';
  let sortOrder = Number(menuRow.sort_order ?? menuRow.sortOrder ?? 999);
  if (isNaN(sortOrder)) sortOrder = 999;
  let description = '';
  let dietaryTags = [];
  let soldOutGroup = '';

  const rawJson = menuRow.options_json !== undefined ? menuRow.options_json : menuRow.optionsJson;
  if (rawJson) {
    const rawObj = safeJsonParse(rawJson, null);
    if (rawObj && typeof rawObj === 'object' && !Array.isArray(rawObj)) {
      const cloned = { ...rawObj };
      legacySoldOut = Boolean(cloned.__soldOut);
      soldOutType = String(cloned.__soldOutType || '').trim().toUpperCase();
      soldOutDate = String(cloned.__soldOutDate || '').trim();
      dailyLimit = Math.max(0, parseInt(cloned.__dailyLimit || 0, 10) || 0);
      nameEn = String(cloned.__nameEn || '').trim();
      station = ['MAIN', 'SIDE', 'DRINK'].includes(String(cloned.__station || '').toUpperCase())
        ? String(cloned.__station).toUpperCase()
        : 'AUTO';
      tileColor = String(cloned.__tileColor || '').trim();
      if (cloned.__sortOrder !== undefined && cloned.__sortOrder !== '') {
        sortOrder = parseInt(cloned.__sortOrder, 10) || sortOrder;
      }
      description = String(cloned.__description || '').trim().slice(0, 160);
      dietaryTags = Array.isArray(cloned.__dietaryTags)
        ? cloned.__dietaryTags.map(t => String(t).trim()).filter(Boolean).slice(0, 10)
        : [];
      soldOutGroup = String(cloned.__soldOutGroup || '').trim().slice(0, 40);
      delete cloned.__soldOut;
      delete cloned.__soldOutType;
      delete cloned.__soldOutDate;
      delete cloned.__dailyLimit;
      delete cloned.__nameEn;
      delete cloned.__station;
      delete cloned.__tileColor;
      delete cloned.__sortOrder;
      delete cloned.__description;
      delete cloned.__dietaryTags;
      delete cloned.__soldOutGroup;
      parsedOptions = cloned;
    }
  }

  const rawSold = menuRow.sold_out !== undefined ? menuRow.sold_out : menuRow.soldOut;
  const explicitSoldOut = (rawSold !== undefined && rawSold !== '' && rawSold !== null)
    ? (rawSold === true || rawSold === 1 || String(rawSold).toLowerCase() === 'true' || String(rawSold) === '1')
    : legacySoldOut;

  if (!explicitSoldOut) {
    soldOutType = 'NONE';
    soldOutDate = '';
  } else if (soldOutType !== 'PERMANENT' && soldOutType !== 'TODAY') {
    soldOutType = 'TODAY';
  }

  return {
    parsedOptions,
    isSoldOut: explicitSoldOut,
    soldOutType,
    soldOutDate,
    dailyLimit,
    nameEn,
    station,
    tileColor,
    sortOrder,
    description,
    dietaryTags,
    soldOutGroup
  };
}

export function evaluateEffectiveSoldOut(parsedMenuMeta, morningPolicy, todayStr) {
  const rawSoldOut = Boolean(parsedMenuMeta.isSoldOut);
  if (!rawSoldOut) {
    return { effectiveManualSoldOut: false, soldOutType: 'NONE', soldOutDate: '', needsMorningReview: false };
  }
  const sType = String(parsedMenuMeta.soldOutType || 'TODAY').toUpperCase() === 'PERMANENT' ? 'PERMANENT' : 'TODAY';
  const sDate = String(parsedMenuMeta.soldOutDate || '').trim();
  if (sType === 'PERMANENT') {
    return { effectiveManualSoldOut: true, soldOutType: 'PERMANENT', soldOutDate: sDate, needsMorningReview: false };
  }
  if (sDate && sDate < todayStr) {
    if (String(morningPolicy || 'AUTO_RESTORE').toUpperCase() === 'ASK_MORNING') {
      return { effectiveManualSoldOut: true, soldOutType: 'TODAY', soldOutDate: sDate, needsMorningReview: true };
    }
    return { effectiveManualSoldOut: false, soldOutType: 'NONE', soldOutDate: '', needsMorningReview: false };
  }
  return { effectiveManualSoldOut: true, soldOutType: 'TODAY', soldOutDate: sDate || todayStr, needsMorningReview: false };
}

// ==================== 4. 訂單生命週期、排隊負荷與 AI 推薦 ====================

export function evaluateOrderLifecycleStatus(statusStr, isReservation, paymentStatus, pickupDateStr, pickupTimeStr, todayStr, nowMinutesOfDay, leadMinsParam) {
  const cur = String(statusStr || '製作中');
  if (cur.includes('已取消') || cur === '已完成' || cur === '待付款 (LINE Pay 授權中)') {
    return cur;
  }
  const cleanDate = normalizeDateStr(pickupDateStr || todayStr);
  if (cleanDate < todayStr) {
    if (paymentStatus === '待櫃檯繳費' || paymentStatus === '待付訂確認' || paymentStatus === '取餐付現') {
      return '已取消 (歷史逾期未取)';
    }
    return '已完成';
  }
  if (cur === '可取餐') return cur;
  if (paymentStatus === '待櫃檯繳費' || paymentStatus === '待付訂確認') {
    return '待付款確認';
  }
  const leadMinutes = Math.max(10, Math.min(90, Number(leadMinsParam) || 25));
  if (isReservation) {
    if (cleanDate > todayStr) return '已接單待排程';
    if (cleanDate === todayStr) {
      const pt = normalizeTimeStr(pickupTimeStr, false);
      const m = pt.match(/(\d{1,2}):(\d{2})/);
      if (m) {
        const targetMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (targetMin - nowMinutesOfDay > leadMinutes) {
          return '已接單待排程';
        }
      }
    }
  }
  return '製作中';
}

export function calcItemComplexityWeight(item) {
  if (!item || item.isGift || Number(item.price) === 0) return 0.15;
  const name = String(item.baseName || item.name || '');
  const selCount = item.selections ? Object.keys(item.selections).length : 0;
  const customFactor = Math.min(0.35, selCount * 0.08);
  if (name.includes('茶') || name.includes('飲') || name.includes('豆漿')) return 0.25 + customFactor;
  if (name.includes('湯') || name.includes('豆腐') || name.includes('起司條') || name.includes('炸雞')) return 0.55 + customFactor;
  if (name.includes('鐵板') || name.includes('鍋貼') || name.includes('水餃') || name.includes('炸蝦') || name.includes('豬排') || name.includes('漢堡排')) return 1.25 + customFactor;
  if (name.includes('涼麵')) return 0.65 + customFactor;
  return 1.0 + customFactor;
}

export function calcDynamicPrepMinutes(activeWorkloadUnits, maxCap, storeBasePrepMin) {
  const capPer15 = Math.max(5, Number(maxCap) || 20);
  const L = Math.max(0, Number(activeWorkloadUnits) || 0);
  const muPerMin = capPer15 / 15;
  const baseMin = Math.max(2, Number(storeBasePrepMin) || 4);
  if (L <= 0.1) return Math.round(baseMin);
  const rho = Math.min(0.96, L / capPer15);
  const queueWaitMin = (L / muPerMin) * 0.78;
  const congestionPenalty = rho >= 0.6 ? ((rho * rho) / (1.05 - rho)) * 1.35 : 0;
  const totalWait = Math.round(baseMin + queueWaitMin + congestionPenalty);
  return Math.max(baseMin, Math.min(50, totalWait));
}

export function calcAiUtilityScore(store) {
  if (store.isOpen === false) return 10;
  const waitScore = Math.max(0, 100 - (Number(store.avgPrepMinutes) || 5) * 3.4);
  let promoBonus = 0;
  if (store.promoMode === 'discount') promoBonus = 95;
  else if (store.promoMode === 'gift' || store.promoMode === 'freebie') promoBonus = 90;
  else if (store.promoMode === 'second_discount') promoBonus = 80;
  const ratingScore = ((Number(store.rating) || 4.7) / 5.0) * 100;
  const raw = waitScore * 0.55 + promoBonus * 0.25 + ratingScore * 0.20;
  return Math.max(35, Math.min(99, Math.round(raw)));
}

export function getOrderElapsedMinutes(orderObj, nowMs, nowMinutesOfDay) {
  if (!orderObj) return 0;
  const cookTs = Number(orderObj.cookingStartedAtTs || 0);
  if (cookTs > 0) return Math.max(0, Math.floor((nowMs - cookTs) / 60000));
  if (orderObj.isReservation) {
    const pt = normalizeTimeStr(orderObj.pickupTime, false);
    const m = pt.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      const pickupMinOfDay = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      return Math.max(0, nowMinutesOfDay - (pickupMinOfDay - 25));
    }
    return 0;
  }
  const createTs = Number(orderObj.createdAtTs || 0);
  if (createTs > 0) return Math.max(0, Math.floor((nowMs - createTs) / 60000));
  return 0;
}

export function isOrderActivelyCooking(orderObj, todayStr, nowMinutesOfDay, nowMs) {
  if (!orderObj) return false;
  if (normalizeDateStr(orderObj.pickupDate || todayStr) !== todayStr) return false;
  const effectiveStatus = evaluateOrderLifecycleStatus(
    orderObj.status,
    Boolean(orderObj.isReservation),
    String(orderObj.paymentStatus || '已付款'),
    orderObj.pickupDate,
    orderObj.pickupTime,
    todayStr,
    nowMinutesOfDay
  );
  if (effectiveStatus === '製作中') {
    return getOrderElapsedMinutes(orderObj, nowMs, nowMinutesOfDay) <= 45;
  }
  if (effectiveStatus === '可取餐' && orderObj.readyAtTs && (nowMs - Number(orderObj.readyAtTs)) < 180000) {
    return true;
  }
  return false;
}

export function calcOrderRemainingWorkload(orderObj, maxCapPer15Min, nowMs, nowMinutesOfDay) {
  if (String(orderObj.status) === '可取餐') return 0.35;
  const items = Array.isArray(orderObj.structuredItems) ? orderObj.structuredItems : safeJsonParse(orderObj.itemsJson, []);
  let totalWeightedUnits = 0;
  items.forEach(it => {
    const q = Math.max(1, Number(it.qty) || 1);
    totalWeightedUnits += q * calcItemComplexityWeight(it);
  });
  const rawUnits = Math.max(0.6, 0.7 + totalWeightedUnits * 0.75);
  const elapsedMin = getOrderElapsedMinutes(orderObj, nowMs, nowMinutesOfDay);
  if (elapsedMin > 45) return 0;
  const muPerMin = Math.max(5, Number(maxCapPer15Min) || 20) / 15;
  const digestedUnits = Math.min(rawUnits * 0.85, elapsedMin * muPerMin * 0.6);
  return Math.max(0.25, Number((rawUnits - digestedUnits).toFixed(2)));
}

export function calcOrderTotalPortions(orderObj) {
  if (!orderObj) return 1;
  const items = Array.isArray(orderObj.structuredItems)
    ? orderObj.structuredItems
    : safeJsonParse(orderObj.itemsJson, []);
  let total = 0;
  items.forEach(it => {
    if (!it || it.isGift || String(it.id) === 'GIFT-AI') return;
    total += Math.max(1, parseInt(it.qty, 10) || 1);
  });
  return Math.max(1, total);
}

export function buildSlotQuotaMap(ordersList) {
  const quotaMap = {};
  (ordersList || []).forEach(o => {
    if (!o || String(o.status || '').includes('已取消')) return;
    const sid = String(o.storeId || '');
    const dStr = normalizeDateStr(o.pickupDate);
    const tStr = normalizeTimeStr(o.pickupTime, false);
    if (!sid || !dStr || !tStr) return;
    const key = `${sid}_${dStr}_${tStr}`;
    quotaMap[key] = (quotaMap[key] || 0) + calcOrderTotalPortions(o);
  });
  return quotaMap;
}

export function buildDailyMenuSoldMap(ordersList, todayStr) {
  const soldMap = {};
  const targetDay = todayStr || getTodayTaipeiStr();
  (ordersList || []).forEach(o => {
    if (!o || String(o.status || '').includes('已取消')) return;
    if (normalizeDateStr(o.pickupDate) !== targetDay) return;
    const sid = String(o.storeId || '');
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : safeJsonParse(o.itemsJson, []);
    items.forEach(it => {
      if (!it || it.isGift || String(it.id) === 'GIFT-AI') return;
      const mid = String(it.id || '').trim();
      const bName = String(it.baseName || it.name || '').split(' [')[0].trim();
      const q = Math.max(1, parseInt(it.qty, 10) || 1);
      if (mid) soldMap[`${sid}::ID::${mid}`] = (soldMap[`${sid}::ID::${mid}`] || 0) + q;
      if (bName) soldMap[`${sid}::NAME::${bName}`] = (soldMap[`${sid}::NAME::${bName}`] || 0) + q;
    });
  });
  return soldMap;
}

export function buildStoreQueueProgressMap(ordersList) {
  const todayStr = getTodayTaipeiStr();
  const map = {};
  (ordersList || []).forEach(o => {
    if (!o || isCorruptedOrMockOrder(o)) return;
    if (String(o.status || '').includes('已取消')) return;
    if (normalizeDateStr(o.pickupDate) !== todayStr) return;
    const sid = String(o.storeId || '');
    if (!sid) return;
    if (!map[sid]) {
      map[sid] = { readyNumbers: [], readyDetails: [], cookingNumbers: [], cookingOrderIds: [], latestCalledNumber: '', completedCount: 0 };
    }
    const pNum = String(o.pickupNumber || '').trim();
    if (o.status === '可取餐' && pNum) {
      map[sid].readyNumbers.push(pNum);
      map[sid].readyDetails.push({
        pickupNumber: pNum,
        readyAtTs: Number(o.readyAtTs || o.createdAtTs || 0),
        lastCalledAtTs: Number(o.lastCalledAtTs || o.readyAtTs || o.createdAtTs || 0),
        notifyCount: Math.max(1, Number(o.notifyCount) || 1)
      });
      if (!map[sid].latestCalledNumber) map[sid].latestCalledNumber = pNum;
    } else if (o.status === '製作中') {
      if (pNum) map[sid].cookingNumbers.push(pNum);
      map[sid].cookingOrderIds.push(String(o.orderId));
    } else if (o.status === '已完成') {
      map[sid].completedCount += 1;
    }
  });
  Object.keys(map).forEach(sid => {
    map[sid].cookingOrderIds.reverse();
    map[sid].cookingNumbers.reverse();
    map[sid].readyDetails.sort((a, b) => (b.lastCalledAtTs - a.lastCalledAtTs) || (b.notifyCount - a.notifyCount));
    if (map[sid].readyDetails.length > 0) {
      map[sid].latestCalledNumber = map[sid].readyDetails[0].pickupNumber;
    }
  });
  return map;
}

export function computeAiTrafficRecommendations(enrichedStores) {
  const recs = {};
  const campuses = Array.from(new Set((enrichedStores || []).map(s => String(s.campus || '').trim()).filter(Boolean)));
  if (campuses.length === 0) campuses.push('雙溪校區', '城中校區');
  campuses.forEach(campus => {
    const campusStores = (enrichedStores || []).filter(s => s.campus === campus && s.isOpen !== false);
    const congested = campusStores
      .filter(s => s.loadState === 'FULL' || Number(s.avgPrepMinutes) >= 16)
      .sort((a, b) => b.loadPercentage - a.loadPercentage || b.avgPrepMinutes - a.avgPrepMinutes);
    const availableWithPromo = campusStores
      .filter(s => s.loadState === 'FREE' && s.promoMode !== 'none')
      .sort((a, b) => b.aiScore - a.aiScore);

    if (congested.length > 0 && availableWithPromo.length > 0) {
      const busyStore = congested[0];
      const targetStore = availableWithPromo[0];
      const diffWait = busyStore.avgPrepMinutes - targetStore.avgPrepMinutes;
      if (diffWait >= 3) {
        recs[campus] = {
          hasAlert: true,
          congestedStoreId: busyStore.id,
          congestedStoreName: busyStore.name,
          congestedWaitMin: busyStore.avgPrepMinutes,
          congestedLoadPct: busyStore.loadPercentage,
          recommendedStoreId: targetStore.id,
          recommendedStoreName: targetStore.name,
          recommendedWaitMin: targetStore.avgPrepMinutes,
          recommendedAiScore: targetStore.aiScore,
          promoMode: targetStore.promoMode,
          promoText: targetStore.promoText,
          promoDiscount: Number(targetStore.promoDiscount) || 0,
          timeSavedMin: diffWait
        };
        return;
      }
    }
    recs[campus] = { hasAlert: false };
  });
  return recs;
}

// ==================== 5. D1 Row ⇄ MealFlow Order Object 轉換 ====================

export function dbRowToOrderObject(row) {
  if (!row) return null;
  const meta = safeJsonParse(row.extra_meta_json, {});
  const structuredItems = safeJsonParse(row.items_json, []);
  const order = {
    ...meta,
    orderId: String(row.order_id),
    pickupNumber: String(row.pickup_number),
    storeId: String(row.store_id),
    storeName: String(row.store_name || ''),
    studentId: String(row.student_id || ''),
    studentName: String(row.student_name || ''),
    itemsJson: JSON.stringify(structuredItems),
    structuredItems,
    subtotal: Math.max(0, Number(row.subtotal) || 0),
    discount: Math.max(0, Number(row.discount) || 0),
    cutleryFee: Math.max(0, Number(row.cutlery_fee ?? meta.cutleryFee ?? 0) || 0),
    takeoutFee: Math.max(0, Number(row.takeout_fee ?? meta.takeoutFee ?? 0) || 0),
    serviceFee: Math.max(0, Number(row.service_fee ?? meta.serviceFee ?? 0) || 0),
    finalTotal: Math.max(0, Number(row.final_total) || 0),
    promoApplied: String(row.promo_applied || ''),
    dineType: String(row.dine_type || meta.dineType || '外帶自取'),
    pickupDate: normalizeDateStr(row.pickup_date),
    pickupTime: normalizeTimeStr(row.pickup_time, false),
    pickupTimeSlot: String(row.pickup_time_slot || ''),
    paymentMethod: String(row.payment_method || '現場櫃檯付現'),
    paymentStatus: String(row.payment_status || meta.paymentStatus || '取餐付現'),
    paidAtDate: String(row.paid_at_date || meta.paidAtDate || ''),
    status: String(row.status || '製作中'),
    isReservation: Boolean(row.is_reservation),
    printStatus: String(row.print_status || meta.printStatus || 'PENDING'),
    preprintDone: Boolean(row.preprint_done),
    customerPhone: String(row.customer_phone || meta.customerPhone || ''),
    lineUserId: String(row.line_user_id || meta.lineUserId || ''),
    verificationCode: String(meta.sealedVerificationCode || row.verification_code || ''),
    createdAt: normalizeTimeStr(row.created_at, true),
    createdAtTs: Number(row.created_at_ts || meta.createdAtTs || 0),
    notifyCount: Math.max(0, Number(meta.notifyCount) || 0),
    readyAtTs: Number(meta.readyAtTs || 0),
    lastCalledAtTs: Number(meta.lastCalledAtTs || 0),
    cookingStartedAtTs: Number(meta.cookingStartedAtTs || 0),
    manualDiscount: Math.max(0, Number(meta.manualDiscount) || 0),
    partialRefundTotal: Math.max(0, Number(meta.partialRefundTotal) || 0),
    extraChargeTotal: Math.max(0, Number(meta.extraChargeTotal) || 0),
    pendingAddOnAmount: Math.max(0, Number(meta.pendingAddOnAmount) || 0),
    originalOfflinePickupNumber: String(meta.originalOfflinePickupNumber || ''),
    couponCode: String(meta.couponCode || ''),
    couponDiscount: Math.max(0, Number(meta.couponDiscount) || 0),
    isDineInPostPay: Boolean(meta.isDineInPostPay),
    itemCheckedMap: (meta.itemCheckedMap && typeof meta.itemCheckedMap === 'object') ? meta.itemCheckedMap : {},
    statusTimeline: Array.isArray(meta.statusTimeline) ? meta.statusTimeline : [],
    needCutlery: Boolean(meta.needCutlery || Number(row.cutlery_fee) > 0),
    customerNote: String(meta.customerNote || ''),
    taxId: String(meta.taxId || ''),
    reprintRequestedAtTs: Number(meta.reprintRequestedAtTs || 0),
    extraMetaJson: typeof row.extra_meta_json === 'string' ? row.extra_meta_json : JSON.stringify(meta)
  };

  // #20：現金單逾時未取自動作廢保護（已叫號超過 60 分鐘且仍為未付款現金單）
  if (
    order.status === '可取餐' &&
    order.readyAtTs > 0 &&
    order.paymentStatus !== '已付款' &&
    (Date.now() - order.readyAtTs) > 60 * 60 * 1000
  ) {
    order.status = '已取消 (現金單逾時未取自動作廢)';
    order.paymentStatus = '已退單作廢';
  }

  return order;
}
