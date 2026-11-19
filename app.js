/**
 * ============================================================================
 * MealFlow - 前端核心引擎
 * Part 1 / 2：ISO/IEC 18004 真實 QR 編碼器、鏡頭掃碼核銷、時段配額模型、安全 PIN 閘門、最小權限同步
 * ============================================================================
 */

const BRAND_CONFIG = {
  name: 'MealFlow',
  subtitle: 'MealFlow',
  fullTitle: 'MealFlow',
  posTitle: 'MealFlow POS',
  merchantTitle: 'MealFlow 特約商店'
};

const GAS_URL = 'https://script.google.com/macros/s/AKfycbzN2e0bi-jQG5RvGBpZYu5190f2JfX-6P1C8DxUy2aPyrrpbJpBl0oaTwYFRhAyBl8/exec';
const DEFAULT_LINE_CLIENT_ID = localStorage.getItem('mealflow_system_line_client_id') || '2012260287';
const AI_DISCOUNT_MIN_SUBTOTAL = 60; // 離峰現金折抵最低消費門檻 (NT$ 60，不含免洗餐具費)
const LARGE_ORDER_DEPOSIT_THRESHOLD = 500; // 大額預訂團單門檻 (≥ NT$ 500 須線上支付或提前至櫃檯付訂確認)

// 商業級流量防護常數 (Page Visibility + Exponential Backoff + Active Watch Fast Poll)
const POLL_INTERVAL_ACTIVE_WATCH_MS = 4500; // 有進行中訂單 / 叫號看板 / KDS 接單時之極速輪詢：4.5 秒
const POLL_INTERVAL_FOREGROUND_MS = 10000;  // 一般前景瀏覽基礎輪詢：10 秒
const POLL_INTERVAL_BACKGROUND_MS = 15000;  // 一般背景分頁輪詢：15 秒
const POLL_MAX_BACKOFF_MS = 60000;          // 異常退避上限：60 秒

const STORE_ICONS = {
  'S01': '🍙', 'S02': '🍱', 'S03': '🥟', 'S04': '🍗',
  'S05': '🍛', 'S06': '🥩', 'S07': '🍜'
};

function getStdRiceOptions() {
  return {
    '主食份量': { type: 'radio', choices: [['正常飯量', 0], ['飯少(減醣)', 0], ['大盛加飯', 10]] },
    '辣度選擇': { type: 'radio', choices: [['不辣', 0], ['微辣', 0], ['小辣', 0], ['中辣', 0]] },
    '人氣加料': { type: 'checkbox', choices: [['加香濃起司', 15], ['加溏心溫泉蛋', 15], ['不要蔥花/香菜', 0]] }
  };
}

function getStdNoodleOptions() {
  return {
    '麵條份量': { type: 'radio', choices: [['標準份量', 0], ['加麵大碗', 15]] },
    '辣度選擇': { type: 'radio', choices: [['不辣', 0], ['小辣', 0], ['大辣', 0]] },
    '單點加料': { type: 'checkbox', choices: [['加滷蛋', 15], ['加貢丸(2顆)', 15], ['不要蔥花', 0]] }
  };
}

function getDumplingSetOptions() {
  return {
    '份量選擇': {
      type: 'radio',
      choices: [['標準份量 (10顆)', 0], ['加量飽足 (12顆)', 14], ['大份滿足 (15顆)', 35]]
    },
    '醬料包選擇': {
      type: 'checkbox',
      choices: [['蒜泥醬油膏', 0], ['特製辣椒醬', 0], ['白醋', 0], ['免醬料', 0]]
    }
  };
}

const DEFAULT_STORES = [
  {
    id: 'S01', campus: '雙溪校區', name: '趙班長海苔飯捲', category: '人氣韓式・飯捲',
    isOpen: true, maxCapacityPer15Min: 18, baseQueueOffset: 0, basePrepMinutes: 4, avgPrepMinutes: 4, cutleryPrice: 1,
    promoMode: 'none', promoText: '無優惠', promoDiscount: 0, predictedDailyOrders: 240, rating: 4.9,
    menus: [
      { id: 'M01', category: '韓式海苔飯捲', name: '特製韓式泡菜燒肉飯捲', price: 75, tag: '🔥 必點人氣', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M02', category: '韓式海苔飯捲', name: '起司炸蝦海苔飯捲', price: 85, tag: '⭐ 主廚推薦', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M03', category: '韓式海苔飯捲', name: '經典鮪魚玉米飯捲', price: 65, tag: '⚡ 快速出餐', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M18', category: '韓式湯品與飲品', name: '釜山魚板蘿蔔湯', price: 35, tag: '🥣 暖胃湯品', soldOut: false, image: '', options: {} },
      { id: 'M22', category: '韓式湯品與飲品', name: '韓國水蜜桃果粒飲', price: 40, tag: '🥤 人氣飲品', soldOut: false, image: '', options: { '冰塊調整': { type: 'radio', choices: [['正常冰', 0], ['去冰', 0]] } } }
    ]
  },
  {
    id: 'S02', campus: '雙溪校區', name: '雙溪-丼物園', category: '日式蓋飯・烏龍麵',
    isOpen: true, maxCapacityPer15Min: 20, baseQueueOffset: 0, basePrepMinutes: 5, avgPrepMinutes: 5, cutleryPrice: 1,
    promoMode: 'gift', promoText: '🎁 離峰分流招待：免費溫泉蛋乙顆', promoDiscount: 0, predictedDailyOrders: 165, rating: 4.7,
    menus: [
      { id: 'M04', category: '炙燒日式丼飯', name: '炙燒起司牛五花丼', price: 115, tag: '🔥 招牌必點', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M05', category: '黃金厚切豬排滑蛋丼', name: '黃金厚切豬排滑蛋丼', price: 120, tag: '⭐ 飽足首選', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M06', category: '讚岐烏龍麵', name: '讚岐胡麻冷烏龍麵', price: 95, tag: '⚡ 3分極速出餐', soldOut: false, image: '', options: getStdNoodleOptions() },
      { id: 'M19', category: '單點炸物與茶飲', name: '日式唐揚炸雞 (5塊)', price: 55, tag: '🍗 人氣單點', soldOut: false, image: '', options: { '調味粉': { type: 'radio', choices: [['原味胡椒', 0], ['日式七味粉', 0], ['泰式酸辣醬', 5]] } } },
      { id: 'M23', category: '單點炸物與茶飲', name: '靜岡無糖玄米綠茶', price: 30, tag: '🍵 解膩首選', soldOut: false, image: '', options: {} }
    ]
  },
  {
    id: 'S03', campus: '雙溪校區', name: '雙溪-四海遊龍', category: '鍋貼水餃・麵食',
    isOpen: true, maxCapacityPer15Min: 25, baseQueueOffset: 0, basePrepMinutes: 6, avgPrepMinutes: 6, cutleryPrice: 1,
    promoMode: 'none', promoText: '無優惠', promoDiscount: 0, predictedDailyOrders: 210, rating: 4.6,
    menus: [
      { id: 'M07', category: '手工鍋貼與水餃', name: '招牌脆皮鍋貼 (10顆)', price: 70, tag: '🔥 經典酥脆', soldOut: false, image: '', options: getDumplingSetOptions() },
      { id: 'M08', category: '手工鍋貼與水餃', name: '高麗菜鮮肉水餃 (10顆)', price: 70, tag: '⚡ 飽滿多汁', soldOut: false, image: '', options: getDumplingSetOptions() },
      { id: 'M25', category: '手工鍋貼與水餃', name: '韓式辣味鮮肉水餃 (10顆)', price: 75, tag: '🌶️ 香辣過癮', soldOut: false, image: '', options: getDumplingSetOptions() },
      { id: 'M24', category: '開胃小菜與湯飲', name: '招牌酸辣湯', price: 35, tag: '🥣 經典絕配', soldOut: false, image: '', options: { '胡椒與醋': { type: 'radio', choices: [['正常', 0], ['加辣油', 0], ['不加蔥香菜', 0]] } } },
      { id: 'M20', category: '開胃小菜與湯飲', name: '非基改冰鎮豆漿', price: 25, tag: '🥛 清涼飲品', soldOut: false, image: '', options: { '甜度': { type: 'radio', choices: [['微糖', 0], ['無糖', 0]] } } }
    ]
  },
  {
    id: 'S04', campus: '雙溪校區', name: '蒲家廚房', category: '中式特餐・便當',
    isOpen: true, maxCapacityPer15Min: 20, baseQueueOffset: 0, basePrepMinutes: 4, avgPrepMinutes: 4, cutleryPrice: 1,
    promoMode: 'discount', promoText: '💰 離峰分流折抵：現折 $10 元', promoDiscount: 10, predictedDailyOrders: 150, rating: 4.8,
    menus: [
      { id: 'M09', category: '人氣特餐便當', name: '秘製椒麻雞腿飯 (含3配菜)', price: 110, tag: '🔥 銷量冠軍', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M10', category: '人氣特餐便當', name: '蒜泥白肉精緻便當 (含3配菜)', price: 100, tag: '⚡ 極速便當', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M21', category: '單點小菜與湯品', name: '黃金脆皮炸豆腐', price: 40, tag: '✨ 招牌小菜', soldOut: false, image: '', options: {} }
    ]
  },
  {
    id: 'S05', campus: '城中校區', name: '城中-咖哩食堂', category: '熟成咖哩・炸物',
    isOpen: true, maxCapacityPer15Min: 15, baseQueueOffset: 0, basePrepMinutes: 5, avgPrepMinutes: 5, cutleryPrice: 1,
    promoMode: 'none', promoText: '無優惠', promoDiscount: 0, predictedDailyOrders: 195, rating: 4.8,
    menus: [
      { id: 'M11', category: '熟成濃咖哩', name: '唐揚炸雞熟成咖哩飯', price: 125, tag: '🔥 排隊人氣', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M12', category: '熟成濃咖哩', name: '手打漢堡排歐姆蛋咖哩', price: 135, tag: '⭐ 限量供應', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M26', category: '炸物點心', name: '酥炸莫札瑞拉起司條 (3入)', price: 50, tag: '🧀 邪惡點心', soldOut: false, image: '', options: {} }
    ]
  },
  {
    id: 'S06', campus: '城中校區', name: '城中-吳葉食堂', category: '精緻台式簡餐',
    isOpen: true, maxCapacityPer15Min: 20, baseQueueOffset: 0, basePrepMinutes: 6, avgPrepMinutes: 6, cutleryPrice: 1,
    promoMode: 'gift', promoText: '🎁 離峰分流招待：免費招牌冰紅茶', promoDiscount: 0, predictedDailyOrders: 145, rating: 4.9,
    menus: [
      { id: 'M13', category: '主廚鐵板與簡餐', name: '蔥爆牛肉鐵板簡餐', price: 115, tag: '🔥 現點現做', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M14', category: '主廚鐵板與簡餐', name: '古早味排骨特餐', price: 105, tag: '⚡ 4分極速取餐', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M15', category: '特色麵食', name: '手工鮮蝦紅油抄手麵', price: 90, tag: '⭐ 學生最愛', soldOut: false, image: '', options: getStdNoodleOptions() }
    ]
  },
  {
    id: 'S07', campus: '城中校區', name: '大熊涼麵 X 吃好食堂', category: '手工涼麵・味噌湯',
    isOpen: true, maxCapacityPer15Min: 25, baseQueueOffset: 0, basePrepMinutes: 2, avgPrepMinutes: 2, cutleryPrice: 1,
    promoMode: 'discount', promoText: '💰 離峰分流折抵：現折 $5 元', promoDiscount: 5, predictedDailyOrders: 160, rating: 4.7,
    menus: [
      { id: 'M16', category: '手工現拌涼麵', name: '川味麻辣雞絲涼麵 (大)', price: 75, tag: '⚡ 2分秒取', soldOut: false, image: '', options: getStdNoodleOptions() },
      { id: 'M17', category: '招牌味噌湯品', name: '綜合三合一味噌湯 (貢丸+蛋花)', price: 45, tag: '🔥 絕配湯品', soldOut: false, image: '', options: {} }
    ]
  }
];

// ==================== #18 標準 Asia/Taipei 日期與伺服器時間偏移校正計算器 (Safari 安全 Intl.DateTimeFormat) ====================
function getCalibratedNowMs() {
  const offset = (typeof state !== 'undefined' && state && typeof state.serverTimeOffsetMs === 'number')
    ? state.serverTimeOffsetMs
    : 0;
  return Date.now() + offset;
}

const TAIPEI_INTL_FORMATTER = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
  ? new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  : null;

function getTaipeiDateObj(sourceDate = null) {
  const baseDate = (sourceDate instanceof Date && !isNaN(sourceDate.getTime()))
    ? sourceDate
    : new Date(getCalibratedNowMs());
  try {
    if (TAIPEI_INTL_FORMATTER && typeof TAIPEI_INTL_FORMATTER.formatToParts === 'function') {
      const parts = TAIPEI_INTL_FORMATTER.formatToParts(baseDate);
      const map = {};
      for (let i = 0; i < parts.length; i++) {
        map[parts[i].type] = parts[i].value;
      }
      const yr = parseInt(map.year, 10);
      const mo = parseInt(map.month, 10) - 1;
      const da = parseInt(map.day, 10);
      let hr = parseInt(map.hour, 10);
      if (hr === 24) hr = 0;
      const mi = parseInt(map.minute, 10);
      const sc = parseInt(map.second, 10);
      if (!isNaN(yr) && !isNaN(mo) && !isNaN(da)) {
        return new Date(yr, mo, da, hr || 0, mi || 0, sc || 0);
      }
    }
    const str = baseDate.toLocaleString('en-US', { timeZone: 'Asia/Taipei' });
    const fallbackParsed = new Date(str);
    return isNaN(fallbackParsed.getTime()) ? new Date(baseDate.getTime()) : fallbackParsed;
  } catch (e) {
    return new Date(baseDate.getTime());
  }
}

function getTodayDateStr() {
  const d = getTaipeiDateObj();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTaipeiTimeHHMMSS(sourceDate = null) {
  const d = getTaipeiDateObj(sourceDate);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getTaipeiTimeHHMM(sourceDate = null) {
  return getTaipeiTimeHHMMSS(sourceDate).slice(0, 5);
}

function getDateOffsetStr(offsetDays) {
  const d = getTaipeiDateObj();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getFutureDateStr(offsetDays) {
  return getDateOffsetStr(offsetDays);
}

function getDateOffsetFromStr(baseDateStr, offsetDays) {
  const cleanBase = normalizeDateStr(baseDateStr);
  const parts = cleanBase.split('-').map(Number);
  const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDateStr(val) {
  if (!val) return getTodayDateStr();
  const str = String(val).trim();
  const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const td = getTaipeiDateObj(parsed);
    const yyyy = td.getFullYear();
    const mm = String(td.getMonth() + 1).padStart(2, '0');
    const dd = String(td.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return getTodayDateStr();
}

function normalizeTimeStr(val, fallback = '12:15') {
  if (!val) return fallback;
  const str = String(val).trim();
  const isPM = /下午|PM|pm/.test(str);
  const isAM = /上午|AM|am/.test(str);
  const m = str.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    let hh = parseInt(m[1], 10);
    if (isPM && hh < 12) hh += 12;
    if (isAM && hh === 12) hh = 0;
    if (hh === 24) hh = 0;
    return `${String(hh).padStart(2, '0')}:${m[2]}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return getTaipeiTimeHHMM(parsed);
  }
  return fallback;
}

function calcDiffDaysFromToday(targetDateStr) {
  if (!targetDateStr) return 0;
  const todayParts = getTodayDateStr().split('-').map(Number);
  const targetParts = normalizeDateStr(targetDateStr).split('-').map(Number);
  const t0 = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]).getTime();
  const t1 = new Date(targetParts[0], targetParts[1] - 1, targetParts[2]).getTime();
  return Math.round((t1 - t0) / 86400000);
}

function parseTimeMinutesFromNow(pickupDateStr, pickupTimeStr) {
  const todayStr = getTodayDateStr();
  const cleanDate = normalizeDateStr(pickupDateStr);
  if (cleanDate !== todayStr) {
    const diffDays = calcDiffDaysFromToday(cleanDate);
    return diffDays * 1440;
  }
  const cleanTime = normalizeTimeStr(pickupTimeStr, '');
  if (!cleanTime) return 0;
  const m = cleanTime.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const now = getTaipeiDateObj();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const targetMins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return targetMins - nowMins;
}

/**
 * 判斷指定時段是否屬於學餐大尖峰時段 (11:45 ~ 12:45)
 * 預訂尖峰時段不適用「離峰分流折扣/贈品」，防止套利漏洞
 */
function isPeakHourTimeSlot(timeStr) {
  const clean = normalizeTimeStr(timeStr, '');
  const m = clean.match(/(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return mins >= (11 * 60 + 45) && mins <= (12 * 60 + 45);
}

/**
 * #26 計算指定訂單之「餐點總份數 (Portion Units)」，排除贈品
 */
function calcOrderTotalPortions(order) {
  if (!order) return 1;
  const items = Array.isArray(order.structuredItems) ? order.structuredItems : [];
  if (items.length === 0) return 1;
  let total = 0;
  items.forEach(it => {
    if (!it || it.isGift || String(it.id) === 'GIFT-AI') return;
    total += Math.max(1, parseInt(it.qty, 10) || 1);
  });
  return Math.max(1, total);
}

/**
 * #26 計算指定店家、指定日期與 15 分鐘時段區間已接單之「餐點總份數」（結合雲端 slotQuotaMap 與本機訂單）
 */
function getSlotBookedCount(storeId, dateStr, timeStr) {
  if (!storeId) return 0;
  const cleanDate = normalizeDateStr(dateStr);
  const cleanTime = normalizeTimeStr(timeStr, '12:15');
  const slotKey = `${storeId}_${cleanDate}_${cleanTime}`;
  const serverCount = (state.slotQuotaMap && state.slotQuotaMap[slotKey]) ? Number(state.slotQuotaMap[slotKey]) : 0;

  const localPortions = state.orders
    .filter(o =>
      o.storeId === storeId &&
      !String(o.status).includes('已取消') &&
      normalizeDateStr(o.pickupDate) === cleanDate &&
      normalizeTimeStr(o.pickupTime) === cleanTime
    )
    .reduce((sum, o) => sum + calcOrderTotalPortions(o), 0);

  return Math.max(serverCount, localPortions);
}

/**
 * 商業級時段配額產生器 (B7)：支援依各店獨立設定之 openTime、closeTime、午休時段 (breakStartTime~breakEndTime) 與公休日 (closedDays) 動態產生時段
 */
function parseTimeToMins(tStr, fallbackMins) {
  const m = String(tStr || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallbackMins;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function isStoreClosedOnDate(store, dateStr) {
  if (!store || !store.closedDays) return false;
  const cleanDate = normalizeDateStr(dateStr);
  const parts = cleanDate.split('-').map(Number);
  if (parts.length !== 3) return false;
  const dayOfWeek = new Date(parts[0], parts[1] - 1, parts[2]).getDay(); // 0=週日, 6=週六
  const closedArr = Array.isArray(store.closedDays)
    ? store.closedDays.map(Number)
    : String(store.closedDays || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  return closedArr.includes(dayOfWeek);
}

/**
 * #21 完整營業時段、午休時段與公休日控制器：
 * 自動判斷店家當下是否允許「⚡ 立即製作」，若在開門前、打烊後、午休中或公休日，自動封鎖立即製作並引導預訂
 */
function getStoreBusinessHoursStatus(store) {
  if (!store) {
    return {
      canOrderNow: false,
      reasonCode: 'MANUAL_CLOSED',
      statusLabel: t('暫停營業（僅開放預訂）', 'Closed (Pre-order open)', '準備中（予約のみ受付）', '휴식 중 (예약만 가능)'),
      shortPillText: t('🔴 暫停營業 (可預訂)', '🔴 Closed (Pre-order)', '🔴 準備中 (予約可)', '🔴 휴식 중 (예약 가능)')
    };
  }
  if (store.isOpen === false) {
    return {
      canOrderNow: false,
      reasonCode: 'MANUAL_CLOSED',
      statusLabel: t('本店目前為休息或備料時段，暫停「立即製作」（開放預訂未來時段）', 'Store is currently on break (Pre-order open)', '現在準備中です（予約受付中）', '현재 브레이크 타임입니다 (예약 가능)'),
      shortPillText: t('🔴 暫停營業 (可預訂)', '🔴 Closed (Pre-order)', '🔴 準備中 (予約可)', '🔴 휴식 중 (예약 가능)')
    };
  }
  const now = getTaipeiDateObj();
  const todayStr = getTodayDateStr();
  if (isStoreClosedOnDate(store, todayStr)) {
    return {
      canOrderNow: false,
      reasonCode: 'CLOSED_DAY',
      statusLabel: t('今日為本店固定公休日，暫不提供立即製作（可預訂其他營業日）', 'Closed today for scheduled day off (Pre-order open)', '本日は定休日です（別日の予約可）', '오늘은 정기 휴무일입니다 (다른 날 예약 가능)'),
      shortPillText: t('🗓️ 今日公休 (可預訂)', '🗓️ Day Off (Pre-order)', '🗓️ 定休日 (予約可)', '🗓️ 휴무 (예약 가능)')
    };
  }
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const openStr = String(store.openTime || '10:30').trim();
  const closeStr = String(store.closeTime || '19:30').trim();
  const openMins = parseTimeToMins(openStr, 10 * 60 + 30);
  const closeMins = parseTimeToMins(closeStr, 19 * 60 + 30);

  if (nowMins < openMins) {
    return {
      canOrderNow: false,
      reasonCode: 'BEFORE_OPEN',
      statusLabel: t(`尚未開門（營業時間 ${openStr}~${closeStr}），歡迎先預訂今日取餐時段！`, `Opens at ${openStr} (Pre-order available)`, `${openStr}開店（予約受付中）`, `${openStr} 오픈 (예약 가능)`),
      shortPillText: t(`🌅 ${openStr} 開門 (可預訂)`, `🌅 Opens ${openStr} (Pre-order)`, `🌅 ${openStr}開店 (予約可)`, `🌅 ${openStr} 오픈`)
    };
  }
  if (nowMins > closeMins) {
    return {
      canOrderNow: false,
      reasonCode: 'AFTER_CLOSE',
      statusLabel: t(`今日已打烊（營業時間 ${openStr}~${closeStr}），歡迎預訂明日取餐時段！`, `Closed for today (${openStr}~${closeStr}), pre-order for tomorrow!`, `本日営業終了（${openStr}~${closeStr}）・明日分予約可`, `오늘 영업 종료 (${openStr}~${closeStr})・내일 예약 가능`),
      shortPillText: t('🌙 今日已打烊 (可預訂)', '🌙 Closed (Pre-order)', '🌙 営業終了 (予約可)', '🌙 영업 종료 (예약 가능)')
    };
  }

  const breakStartStr = String(store.breakStartTime || '').trim();
  const breakEndStr = String(store.breakEndTime || '').trim();
  if (breakStartStr && breakEndStr) {
    const bStart = parseTimeToMins(breakStartStr, -1);
    const bEnd = parseTimeToMins(breakEndStr, -1);
    if (bStart >= 0 && bEnd > bStart && nowMins >= bStart && nowMins < bEnd) {
      return {
        canOrderNow: false,
        reasonCode: 'ON_BREAK',
        statusLabel: t(`目前為午休備料時段（${breakStartStr}~${breakEndStr}），暫停立即製作，可預訂 ${breakEndStr} 後取餐！`, `Afternoon break (${breakStartStr}~${breakEndStr}), pre-order available!`, `休憩中（${breakStartStr}~${breakEndStr}）・予約受付中`, `브레이크 타임 (${breakStartStr}~${breakEndStr})・예약 가능`),
        shortPillText: t(`☕ 午休中 ${breakEndStr}開鍋 (可預訂)`, `☕ Break until ${breakEndStr}`, `☕ 休憩中 ${breakEndStr}再開`, `☕ 휴식 중 ${breakEndStr} 재개`)
      };
    }
  }

  return {
    canOrderNow: true,
    reasonCode: 'OPEN',
    statusLabel: t('正常營業中', 'Open Now', '営業中', '영업 중'),
    shortPillText: t(`🟢 順暢・約 ${store.avgPrepMinutes || 5} 分取餐`, `🟢 ~${store.avgPrepMinutes || 5} min wait`, `🟢 約${store.avgPrepMinutes || 5}分`, `🟢 약 ${store.avgPrepMinutes || 5}분`)
  };
}

function getValidPickupTimeSlotsWithQuota(targetDateStr, storeId = null) {
  const todayStr = getTodayDateStr();
  let cleanDate = normalizeDateStr(targetDateStr);
  if (cleanDate < todayStr) {
    cleanDate = todayStr;
  }
  const isToday = cleanDate === todayStr;
  const now = getTaipeiDateObj();
  const store = storeId ? state.stores.find(s => s.id === storeId) : null;
  if (store && isStoreClosedOnDate(store, cleanDate)) {
    return [];
  }

  const leadMins = store && store.reserveLeadMinutes ? Math.max(10, Number(store.reserveLeadMinutes)) : 25;
  const minAllowedMinutesOfDay = isToday ? (now.getHours() * 60 + now.getMinutes() + leadMins) : 0;
  const maxCap = store ? Math.max(5, Number(store.maxCapacityPer15Min) || 20) : 20;

  const openMins = parseTimeToMins(store ? store.openTime : '10:30', 10 * 60 + 30);
  const closeMins = parseTimeToMins(store ? store.closeTime : '19:30', 19 * 60 + 30);
  const breakStartMins = (store && store.breakStartTime) ? parseTimeToMins(store.breakStartTime, -1) : -1;
  const breakEndMins = (store && store.breakEndTime) ? parseTimeToMins(store.breakEndTime, -1) : -1;

  const result = [];
  for (let hr = 6; hr <= 22; hr++) {
    for (let min of [0, 15, 30, 45]) {
      const totalMins = hr * 60 + min;
      if (totalMins < openMins || totalMins > closeMins) continue;
      if (breakStartMins >= 0 && breakEndMins > breakStartMins && totalMins >= breakStartMins && totalMins < breakEndMins) {
        continue;
      }
      if (isToday && totalMins < minAllowedMinutesOfDay) continue;
      const timeLabel = `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      const booked = storeId ? getSlotBookedCount(storeId, cleanDate, timeLabel) : 0;
      const remaining = Math.max(0, maxCap - booked);
      const isFull = booked >= maxCap;
      const isPeak = isPeakHourTimeSlot(timeLabel);
      result.push({
        time: timeLabel,
        booked,
        maxCap,
        remaining,
        isFull,
        isPeak
      });
    }
  }
  return result;
}

function getValidPickupTimeSlots(targetDateStr, storeId = null) {
  return getValidPickupTimeSlotsWithQuota(targetDateStr, storeId)
    .filter(s => !s.isFull)
    .map(s => s.time);
}

function getOrderElapsedMinutes(order) {
  if (!order) return 0;
  const nowCalibratedMs = getCalibratedNowMs();
  if (order.cookingStartedAtTs && Number(order.cookingStartedAtTs) > 0) {
    return Math.max(0, Math.floor((nowCalibratedMs - Number(order.cookingStartedAtTs)) / 60000));
  }
  const todayStr = getTodayDateStr();
  if (normalizeDateStr(order.pickupDate) !== todayStr) return 0;
  const now = getTaipeiDateObj();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (order.isReservation) {
    const cleanPickup = normalizeTimeStr(order.pickupTime || '', '');
    const mp = cleanPickup.match(/(\d{1,2}):(\d{2})/);
    if (mp) {
      const store = (typeof state !== 'undefined' && state && Array.isArray(state.stores))
        ? state.stores.find(s => s.id === order.storeId)
        : null;
      const leadMins = store && store.reserveLeadMinutes ? Math.max(10, Math.min(90, Number(store.reserveLeadMinutes))) : 25;
      const pickupMins = parseInt(mp[1], 10) * 60 + parseInt(mp[2], 10);
      const scheduledCookStartMins = pickupMins - leadMins;
      return Math.max(0, nowMins - scheduledCookStartMins);
    }
    return 0;
  }

  if (order.createdAtTs && Number(order.createdAtTs) > 0) {
    return Math.max(0, Math.floor((nowCalibratedMs - Number(order.createdAtTs)) / 60000));
  }
  const cleanCreated = normalizeTimeStr(order.createdAt || '', '');
  const m = cleanCreated.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const createdMins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const diff = nowMins - createdMins;
  return diff >= 0 ? diff : 0;
}

// ==================== 伺服器 HMAC 6 碼防偽碼、穩定菜單 ID 與個資脫敏相容 ====================
function formatVerificationCodeDisplay(order) {
  const code = String(order?.verificationCode || '').trim();
  if (code && code !== 'PENDING') {
    return code;
  }
  return '待雲端核發';
}

function isOrderServerVerified(order) {
  const code = String(order?.verificationCode || '').trim();
  return Boolean(code && code.length === 6 && !order?.isOfflinePending);
}

function generateStableMenuItemId(storeId, itemName, existingMenus = []) {
  const cleanName = String(itemName || '').trim();
  const cleanStore = String(storeId || 'S00').trim().toUpperCase();

  if (Array.isArray(existingMenus)) {
    const matched = existingMenus.find(m => String(m.name || '').trim() === cleanName && m.id);
    if (matched) return String(matched.id);
  }

  let h = 2166136261;
  const raw = `${cleanStore}::${cleanName}`;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hexSuffix = (h >>> 0).toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
  return `M-${cleanStore}-${hexSuffix}`;
}

function extractPhoneLast3(phoneVal) {
  const digits = String(phoneVal || '').replace(/\D/g, '');
  if (digits.length >= 3) {
    return digits.slice(-3);
  }
  return '';
}

function getClientDeviceId() {
  try {
    let devId = localStorage.getItem('mealflow_client_device_id_v17');
    if (!devId || devId.length < 12) {
      const chars = '0123456789abcdef';
      let rand = 'DEV-';
      for (let i = 0; i < 20; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
      devId = rand + '-' + Date.now().toString(36);
      localStorage.setItem('mealflow_client_device_id_v17', devId);
    }
    return devId;
  } catch (e) {
    return 'DEV-SESSION-' + Math.floor(Math.random() * 1000000);
  }
}

function normalizeOrderItemEntry(rawItem) {
  if (!rawItem) return { id: 'M00', baseName: '未知餐點', name: '未知餐點', basePrice: 0, unitExtra: 0, price: 0, qty: 1, lineSubtotal: 0, selections: {}, isGift: false };
  const rawNameStr = String(rawItem.name || rawItem.baseName || '餐點');
  let baseName = rawItem.baseName ? String(rawItem.baseName).trim() : rawNameStr.split(' [')[0].trim();
  let selections = (rawItem.selections && typeof rawItem.selections === 'object') ? { ...rawItem.selections } : {};

  if (Object.keys(selections).length === 0 && rawNameStr.includes(' [')) {
    const bracketMatch = rawNameStr.match(/\[(.+?)\]/);
    if (bracketMatch) {
      bracketMatch[1].split(',').map(s => s.trim()).forEach(pair => {
        const kv = pair.split(':');
        if (kv.length >= 2) {
          selections[kv[0].trim()] = kv.slice(1).join(':').trim();
        }
      });
    }
  }

  const selSuffix = Object.keys(selections).length > 0
    ? ` [${Object.entries(selections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
    : '';
  const unitPrice = Math.max(0, Number(rawItem.price) || 0);
  const qty = Math.max(1, parseInt(rawItem.qty, 10) || 1);
  const basePrice = rawItem.basePrice !== undefined ? Math.max(0, Number(rawItem.basePrice) || 0) : unitPrice;
  const unitExtra = rawItem.unitExtra !== undefined ? Math.max(0, Number(rawItem.unitExtra) || 0) : Math.max(0, unitPrice - basePrice);
  const lineSubtotal = rawItem.lineSubtotal !== undefined ? Math.max(0, Number(rawItem.lineSubtotal) || 0) : (unitPrice * qty);

  const itemNote = String(rawItem.itemNote || '').trim().slice(0, 60);

  // #40：完整保留歷史訂單成立當下的單價、加購價與小計快照，絕不回頭查詢事後可能改價的菜單
  return {
    id: String(rawItem.id || 'M00'),
    baseName,
    name: `${baseName}${selSuffix}`,
    basePrice,
    unitExtra,
    price: unitPrice,
    qty,
    lineSubtotal,
    selections,
    itemNote,
    isGift: Boolean(rawItem.isGift || unitPrice === 0),
    snapshotAtTs: Number(rawItem.snapshotAtTs || 0)
  };
}

function evaluateOrderLifecycleStatus(order) {
  if (!order) return '製作中';
  const curStatus = String(order.status || '製作中');
  if (curStatus === '已完成' || curStatus.includes('已取消')) {
    return curStatus;
  }

  const todayStr = getTodayDateStr();
  const cleanOrderDate = normalizeDateStr(order.pickupDate || todayStr);
  const payStatus = String(order.paymentStatus || '已付款');

  // 跨日自動日結與逾期歸檔：過去日期 (例如 10/31、11/01、11/12) 的訂單絕不可在今日仍停留於「製作中」或「可取餐」
  if (cleanOrderDate < todayStr) {
    if (payStatus === '待櫃檯繳費' || payStatus === '待付訂確認' || payStatus === '取餐付現') {
      return '已取消 (歷史逾期未取)';
    }
    return '已完成';
  }

  if (curStatus === '可取餐') {
    return curStatus;
  }

  const isReserve = Boolean(order.isReservation);

  if (payStatus === '待櫃檯繳費' || payStatus === '待付訂確認') {
    return '待付款確認';
  }

  if (isReserve) {
    const store = (typeof state !== 'undefined' && state && Array.isArray(state.stores))
      ? state.stores.find(s => s.id === order.storeId)
      : null;
    const leadMins = store && store.reserveLeadMinutes ? Math.max(10, Math.min(90, Number(store.reserveLeadMinutes))) : 25;
    const minsUntilPickup = parseTimeMinutesFromNow(order.pickupDate, order.pickupTime);
    if (minsUntilPickup > leadMins) {
      return '已接單待排程';
    }
  }

  return '製作中';
}

function sanitizeIncomingOrder(o) {
  if (!o) return o;

  let rawItems = [];
  if (Array.isArray(o.structuredItems)) {
    rawItems = o.structuredItems;
  } else if (o.itemsJson) {
    try { rawItems = JSON.parse(o.itemsJson); } catch (e) { rawItems = []; }
  }
  const structuredItems = rawItems.map(normalizeOrderItemEntry);

  const legacyStr = String(o.studentName || '');
  let dineType = o.dineType || (legacyStr.includes('內用') ? '內用自取' : '外帶自取');
  let customerNote = o.customerNote !== undefined ? String(o.customerNote) : '';
  if (!customerNote && legacyStr.includes('備註:')) {
    const m = legacyStr.match(/備註:([^・)]+)/);
    if (m) customerNote = m[1].trim();
  }

  let cashReceived = o.cashReceived !== undefined ? Number(o.cashReceived) : 0;
  let changeGiven = o.changeGiven !== undefined ? Number(o.changeGiven) : 0;
  if (!cashReceived && legacyStr.includes('實收$')) {
    const mCash = legacyStr.match(/實收\$(\d+)\/找零\$(\d+)/);
    if (mCash) {
      cashReceived = Number(mCash[1]) || 0;
      changeGiven = Number(mCash[2]) || 0;
    }
  }

  let rawPickupTimeSlot = String(o.pickupTimeSlot || '');
  let rawPaymentMethod = String(o.paymentMethod || '');
  if ((rawPaymentMethod.includes('立即製作') || rawPaymentMethod.includes('預訂')) &&
      (rawPickupTimeSlot.includes('現金') || rawPickupTimeSlot.includes('付現') || rawPickupTimeSlot.includes('Pay') || !rawPickupTimeSlot)) {
    const tmp = rawPickupTimeSlot;
    rawPickupTimeSlot = rawPaymentMethod;
    rawPaymentMethod = tmp || 'LINE Pay';
  }

  let isReservationFlag = Boolean(o.isReservation);
  if (!isReservationFlag && rawPickupTimeSlot.includes('預訂')) {
    isReservationFlag = true;
  }

  let inferredDate = o.pickupDate;
  let inferredTime = o.pickupTime;
  const slotDateMatch = rawPickupTimeSlot.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
  if (slotDateMatch) {
    if (!inferredDate) inferredDate = slotDateMatch[1];
    if (!inferredTime) inferredTime = slotDateMatch[2];
  }

  const cleanDate = normalizeDateStr(inferredDate);
  const cleanTime = normalizeTimeStr(inferredTime || o.createdAt, '12:15');
  const subtotal = Math.max(0, Number(o.subtotal) || structuredItems.reduce((s, it) => s + it.price * it.qty, 0));
  const cutleryFee = Math.max(0, Number(o.cutleryFee) || 0);
  const discount = Math.max(0, Number(o.discount) || 0);
  const manualDiscount = Math.max(0, Number(o.manualDiscount) || 0);
  const finalTotal = o.finalTotal !== undefined
    ? Math.max(0, Number(o.finalTotal))
    : Math.max(0, subtotal + cutleryFee - discount - manualDiscount);

  const serverVerCode = String(o.verificationCode || '').trim();
  const isOfflinePending = Boolean(o.isOfflinePending || !serverVerCode);
  let defaultPayStatus = '已付款';
  if (rawPaymentMethod.includes('付現') && !rawPaymentMethod.includes('現場現金')) {
    defaultPayStatus = '取餐付現';
  }
  const rawPayStatus = String(o.paymentStatus || defaultPayStatus).replace(/\s*\(沙盒授權\)/g, '');

  const normalized = {
    ...o,
    isReservation: isReservationFlag,
    pickupTimeSlot: rawPickupTimeSlot || (isReservationFlag ? `📅 預訂 ${cleanDate} ${cleanTime}` : '⚡ 立即製作'),
    paymentMethod: rawPaymentMethod || '現場櫃檯付現',
    pickupDate: cleanDate,
    pickupTime: cleanTime,
    paidAtDate: o.paidAtDate ? normalizeDateStr(o.paidAtDate) : cleanDate,
    paymentDeadline: o.paymentDeadline ? normalizeDateStr(o.paymentDeadline) : '',
    paymentStatus: rawPayStatus,
    dineType,
    customerNote,
    taxId: String(o.taxId || '').replace(/\D/g, '').slice(0, 8),
    customerPhone: String(o.customerPhone || '').trim(),
    customerPhoneLast3: String(o.customerPhoneLast3 || extractPhoneLast3(o.customerPhone)),
    cashReceived,
    changeGiven,
    subtotal,
    cutleryFee,
    discount,
    manualDiscount,
    manualDiscountReason: String(o.manualDiscountReason || ''),
    finalTotal,
    refundAmount: Math.max(0, Number(o.refundAmount) || 0),
    refundMethod: String(o.refundMethod || ''),
    verificationCode: serverVerCode,
    isOfflinePending,
    readyAtTs: Number(o.readyAtTs || 0),
    autoFiredAtTs: Number(o.autoFiredAtTs || 0),
    paymentSplit: (o.paymentSplit && typeof o.paymentSplit === 'object') ? o.paymentSplit : null,
    merchantMessage: String(o.merchantMessage || ''),
    merchantMessageAt: String(o.merchantMessageAt || ''),
    merchantMessages: Array.isArray(o.merchantMessages) ? o.merchantMessages : [],
    statusTimeline: Array.isArray(o.statusTimeline) ? o.statusTimeline : [],
    structuredItems,
    itemsJson: JSON.stringify(structuredItems),
    studentName: formatCleanOrderMetaSummary(dineType, Boolean(o.needCutlery), cutleryFee, customerNote)
  };

  normalized.status = evaluateOrderLifecycleStatus(normalized);
  if (normalized.status.includes('歷史逾期未取') && normalized.paymentStatus !== '已退單作廢') {
    normalized.paymentStatus = '已退單作廢';
  }
  return normalized;
}

function formatCleanOrderMetaSummary(dineType, needCutlery, cutleryFee, customerNote) {
  const parts = [dineType || '外帶自取'];
  if (needCutlery) parts.push(`🥢 需免洗餐具${cutleryFee > 0 ? `(+$${cutleryFee})` : ''}`);
  if (customerNote) parts.push(`📝 備註：${customerNote}`);
  return parts.join(' ・ ');
}

function autoPromoteScheduledOrdersToCooking() {
  let changed = false;
  const newlyAutoFired = [];
  state.orders.forEach(o => {
    if (o.status !== '已完成' && !String(o.status || '').includes('已取消')) {
      const prevStatus = o.status;
      const nextStatus = evaluateOrderLifecycleStatus(o);
      if (nextStatus !== prevStatus) {
        o.status = nextStatus;
        if (nextStatus === '製作中' && !o.cookingStartedAtTs) {
          o.cookingStartedAtTs = getCalibratedNowMs();
          if (prevStatus === '已接單待排程' && o.isReservation) {
            o.autoFiredAtTs = getCalibratedNowMs();
            if (!Array.isArray(o.statusTimeline)) o.statusTimeline = [];
            o.statusTimeline.push({
              ts: getCalibratedNowMs(),
              timeStr: getTaipeiTimeHHMMSS(),
              status: '製作中',
              label: `預訂單到時自動推入廚房 (預計 ${o.pickupTime} 取餐)`
            });
            newlyAutoFired.push(o);
          }
        }
        changed = true;
      }
    }
  });
  if (changed) {
    saveCachedOrders(state.orders);
  }
  // #38 預訂單到時自動推單 (Auto-fire) 廚房提醒
  if (newlyAutoFired.length > 0 && state.routeMode === 'store' && isMerchantSessionValidNow()) {
    const storeFired = newlyAutoFired.filter(o => o.storeId === state.merchantStoreId);
    if (storeFired.length > 0) {
      storeFired.forEach(fo => {
        state.unacknowledgedOrderIds.add(fo.orderId);
        if (state.recentlyAutoFiredOrderIds) state.recentlyAutoFiredOrderIds.add(fo.orderId);
      });
      ensureUnacknowledgedOrderReminderLoop();
      if (state.kdsSoundEnabled && acquireCrossTabSoundLock('AUTOFIRE_' + storeFired.map(x => x.orderId).join('_'), 10000)) {
        playPickupChime();
        try {
          if ('speechSynthesis' in window) {
            const nums = storeFired.map(x => `${x.pickupNumber}號，${x.pickupTime}取餐`).join('、');
            const utter = new SpeechSynthesisUtterance(`預訂單到時自動下鍋！${nums}，請廚房開始製作！`);
            utter.lang = 'zh-TW';
            utter.rate = 1.02;
            window.speechSynthesis.speak(utter);
          }
        } catch (e) {}
      }
      showToast(`🔥 預訂單到時自動推入廚房：${storeFired.map(x => `#${x.pickupNumber} (${x.pickupTime}取餐)`).join('、')}`);
      renderMerchantView();
    }
  }
}

// ==================== 本地儲存與壓力測試模擬訂單工具 ====================
function loadLocalStores() {
  try {
    const saved = localStorage.getItem('mealflow_stores_v14') || localStorage.getItem('mealflow_stores_v13');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_STORES));
}

function saveLocalStores(stores) {
  try {
    localStorage.setItem('mealflow_stores_v14', JSON.stringify(stores));
  } catch (e) {}
}

function loadMyOrderHistoryIds() {
  try {
    const raw = localStorage.getItem('mealflow_my_order_ids_v14') || localStorage.getItem('mealflow_my_order_ids_v13');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {}
  const legacy = sessionStorage.getItem('mealflow_my_created_order_id');
  return legacy ? [legacy] : [];
}

function addOrderToMyHistory(orderId) {
  if (!orderId) return;
  state.myCreatedOrderId = orderId;
  if (!state.myOrderHistoryIds.includes(orderId)) {
    state.myOrderHistoryIds.unshift(orderId);
  }
  state.myOrderHistoryIds = state.myOrderHistoryIds.slice(0, 35);
  try {
    sessionStorage.setItem('mealflow_my_created_order_id', orderId);
    localStorage.setItem('mealflow_my_order_ids_v14', JSON.stringify(state.myOrderHistoryIds));
  } catch (e) {}
}

function isCorruptedOrMockOrder(o) {
  if (!o) return true;
  if (o.isSeedSample) return true;
  const oid = String(o.orderId || '');
  if (oid.startsWith('ORD-DEMO-') || /^ORD-\d+$/.test(oid)) return true;
  const pNum = String(o.pickupNumber || '');
  if (/^[SCP]\d{3}$/.test(pNum)) return true;
  return false;
}

function loadCachedOrders() {
  try {
    const raw = localStorage.getItem('mealflow_orders_v14') || localStorage.getItem('mealflow_orders_v13');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleanList = parsed.filter(o => !isCorruptedOrMockOrder(o));
        if (cleanList.length !== parsed.length) {
          localStorage.setItem('mealflow_orders_v14', JSON.stringify(cleanList.slice(0, 1500)));
        }
        return cleanList.map(sanitizeIncomingOrder);
      }
    }
  } catch (e) {}
  return [];
}

function saveCachedOrders(orders) {
  try {
    const cleanOrders = (orders || []).filter(o => !isCorruptedOrMockOrder(o));
    localStorage.setItem('mealflow_orders_v14', JSON.stringify(cleanOrders.slice(0, 1500)));
  } catch (e) {}
}

function clearSampleOrdersData() {
  state.orders = state.orders.filter(o => !isCorruptedOrMockOrder(o));
  saveCachedOrders(state.orders);
  enrichStoresAndAi();
  renderMerchantView();
  showToast('🧹 已清除測試模擬訂單，恢復正式環境！');
}

function restoreSampleOrdersData() {
  showToast('🛡️ 正式營運環境已停用假單塞入功能');
}

function loadLineProfile() {
  try {
    const raw = localStorage.getItem('mealflow_line_profile_v8');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        isBound: Boolean(parsed.isBound),
        lineDisplayName: parsed.lineDisplayName || '',
        lineUserId: parsed.lineUserId || '',
        email: parsed.email || '',
        customClientId: parsed.customClientId || DEFAULT_LINE_CLIENT_ID,
        channelAccessToken: ''
      };
    }
  } catch (e) {}
  return {
    isBound: false,
    lineDisplayName: '',
    lineUserId: '',
    email: '',
    customClientId: DEFAULT_LINE_CLIENT_ID,
    channelAccessToken: ''
  };
}

function saveLineProfile(profile) {
  try {
    localStorage.setItem('mealflow_line_profile_v8', JSON.stringify(profile));
  } catch (e) {}
}

function loadLineLogs() {
  try {
    const raw = localStorage.getItem('mealflow_line_logs_v7');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveLineLogs(logs) {
  try {
    localStorage.setItem('mealflow_line_logs_v7', JSON.stringify(logs.slice(0, 30)));
  } catch (e) {}
}

function loadStudentCartDraft() {
  try {
    const raw = localStorage.getItem('mealflow_cart_draft_v14');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const todayStr = getTodayDateStr();
        if (!parsed.checkoutReserveDate || normalizeDateStr(parsed.checkoutReserveDate) < todayStr) {
          parsed.checkoutReserveDate = todayStr;
        }
        return parsed;
      }
    }
  } catch (e) {}
  return null;
}

function saveStudentCartDraft() {
  try {
    const todayStr = getTodayDateStr();
    const cleanResDate = (!state.checkoutReserveDate || normalizeDateStr(state.checkoutReserveDate) < todayStr)
      ? todayStr
      : normalizeDateStr(state.checkoutReserveDate);
    if (!state.cartByStoreMap || typeof state.cartByStoreMap !== 'object') {
      state.cartByStoreMap = {};
    }
    if (state.selectedStoreId) {
      if (Array.isArray(state.cartItems) && state.cartItems.length > 0) {
        state.cartByStoreMap[state.selectedStoreId] = state.cartItems;
      } else {
        delete state.cartByStoreMap[state.selectedStoreId];
      }
    }
    const draft = {
      selectedStoreId: state.selectedStoreId || null,
      campus: state.campus || '雙溪校區',
      cartItems: Array.isArray(state.cartItems) ? state.cartItems : [],
      cartByStoreMap: state.cartByStoreMap,
      checkoutDineType: state.checkoutDineType || '外帶自取',
      checkoutNeedCutlery: Boolean(state.checkoutNeedCutlery),
      checkoutTimeMode: state.checkoutTimeMode || 'NOW',
      checkoutReserveDate: cleanResDate,
      checkoutReserveTime: state.checkoutReserveTime || '12:15',
      checkoutPayMethod: state.checkoutPayMethod || 'LINE Pay',
      checkoutNote: state.checkoutNote || '',
      checkoutTaxId: state.checkoutTaxId || '',
      savedAt: Date.now()
    };
    localStorage.setItem('mealflow_cart_draft_v14', JSON.stringify(draft));
  } catch (e) {}
}

function loadMerchantAuditLogs() {
  try {
    const raw = localStorage.getItem('mealflow_audit_logs_v15');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {}
  return [];
}

function recordMerchantAuditLog(actionTitle, detailText) {
  try {
    const storeId = state.merchantStoreId || 'S01';
    const entry = {
      ts: `${getTodayDateStr()} ${getTaipeiTimeHHMMSS()}`,
      storeId: storeId,
      action: String(actionTitle || ''),
      detail: String(detailText || '')
    };
    state.merchantAuditLogs = [entry, ...(state.merchantAuditLogs || [])].slice(0, 120);
    localStorage.setItem('mealflow_audit_logs_v15', JSON.stringify(state.merchantAuditLogs));

    // #13：同步寫入雲端伺服器持久化，防止店員清除瀏覽器快取或換平板抹除稽核紀錄
    if (isMerchantSessionValidNow()) {
      fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveMerchantAuditLog',
          ...getMerchantAuthPayload(),
          storeId: storeId,
          ts: entry.ts,
          actionTitle: entry.action,
          detail: entry.detail
        })
      }).catch(() => {});
    }
  } catch (e) {}
}

function getShiftPettyCashEntries(storeId, dateStr) {
  const cleanDate = normalizeDateStr(dateStr);
  if (state.pettyCashMap && state.pettyCashMap[storeId] && Array.isArray(state.pettyCashMap[storeId][cleanDate])) {
    return state.pettyCashMap[storeId][cleanDate];
  }
  try {
    const raw = localStorage.getItem(`mealflow_petty_cash_${storeId}_${cleanDate}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function saveShiftPettyCashEntries(storeId, dateStr, entries) {
  const cleanDate = normalizeDateStr(dateStr);
  const safeList = Array.isArray(entries) ? entries.slice(0, 50) : [];
  if (!state.pettyCashMap) state.pettyCashMap = {};
  if (!state.pettyCashMap[storeId]) state.pettyCashMap[storeId] = {};
  state.pettyCashMap[storeId][cleanDate] = safeList;
  try {
    localStorage.setItem(`mealflow_petty_cash_${storeId}_${cleanDate}`, JSON.stringify(safeList));
  } catch (e) {}
  if (isMerchantSessionValidNow()) {
    fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveShiftPettyCash',
        ...getMerchantAuthPayload(),
        storeId: storeId,
        shiftDate: cleanDate,
        entries: safeList
      })
    }).catch(() => {});
  }
}

function getLockedShiftRecord(storeId, dateStr) {
  const cleanDate = normalizeDateStr(dateStr);
  if (state.lockedShiftsMap && state.lockedShiftsMap[storeId] && state.lockedShiftsMap[storeId][cleanDate]) {
    return state.lockedShiftsMap[storeId][cleanDate];
  }
  try {
    const raw = localStorage.getItem(`mealflow_shift_locked_${storeId}_${cleanDate}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function getOpenedShiftRecord(storeId, dateStr) {
  const cleanDate = normalizeDateStr(dateStr);
  if (state.openShiftsMap && state.openShiftsMap[storeId] && state.openShiftsMap[storeId][cleanDate]) {
    return state.openShiftsMap[storeId][cleanDate];
  }
  try {
    const raw = localStorage.getItem(`mealflow_shift_opened_${storeId}_${cleanDate}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function loadPosHeldOrders() {
  try {
    const raw = localStorage.getItem('mealflow_pos_held_orders_v19');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function savePosHeldOrders(list) {
  try {
    localStorage.setItem('mealflow_pos_held_orders_v19', JSON.stringify((list || []).slice(0, 30)));
  } catch (e) {}
}

// ==================== 後端簽發時效性 HMAC Session Token (含嚴格單一店家範圍檢查 #7, #8, #16) ====================
function isMerchantSessionValidNow() {
  const token = state.merchantAuthToken || sessionStorage.getItem('mealflow_merchant_session_v13') || '';
  const exp = Number(state.merchantSessionExpiresAt || sessionStorage.getItem('mealflow_merchant_exp_v13') || 0);
  // #16：嚴格禁止 OFFLINE_ 本地偽造憑證繞過伺服器驗證
  if (!token || !token.includes('.') || token.startsWith('OFFLINE_') || exp <= Date.now()) {
    return false;
  }
  // #7 & #8：嚴格檢查當前選擇的店鋪必須與該 Session Token 授權的單一店鋪完全相符，禁止跨店免密碼切換！
  const authorizedScope = state.merchantAuthorizedStoreScope || sessionStorage.getItem('mealflow_merchant_scope_v13') || '';
  if (!authorizedScope || authorizedScope === 'ALL' || authorizedScope !== state.merchantStoreId) {
    return false;
  }
  return true;
}

function getMerchantAuthPayload() {
  if (!isMerchantSessionValidNow()) {
    return { merchantAuthToken: '' };
  }
  return {
    merchantAuthToken: state.merchantAuthToken || sessionStorage.getItem('mealflow_merchant_session_v13') || ''
  };
}

// ==================== 全域狀態 State ====================
function loadPendingOrderMutationsQueue() {
  try {
    const raw = localStorage.getItem('mealflow_pending_mutations_v14');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function savePendingOrderMutationsQueue(queue) {
  try {
    localStorage.setItem('mealflow_pending_mutations_v14', JSON.stringify((queue || []).slice(0, 100)));
  } catch (e) {}
}

var state = {
  routeMode: 'portal', // 'portal' | 'order' | 'ticket' | 'store'
  lang: localStorage.getItem('mealflow_lang') || 'zh-TW', // 'zh-TW' | 'en' (A3 多國語系)
  trackingOrderId: null,
  myCreatedOrderId: sessionStorage.getItem('mealflow_my_created_order_id') || null,
  myOrderHistoryIds: loadMyOrderHistoryIds(),
  savedCustomerPhone: localStorage.getItem('mealflow_saved_customer_phone_v12') || '',
  studentLookupQuery: '',
  studentLookupPhoneLast3: '',
  campus: '雙溪校區',
  filter: 'ALL',
  stores: loadLocalStores(),
  hasLoadedCloudStores: Boolean(localStorage.getItem('mealflow_has_cloud_stores_v14')),
  slotQuotaMap: {}, // 各店各時段已預訂配額映射表
  aiRecommendations: {},
  orders: loadCachedOrders(),
  merchantAuditLogs: loadMerchantAuditLogs(),

  // 樂觀鎖與離線補送佇列：保護本地剛送出之訂單、狀態變更與店家剛修改之設定
  pendingLocalOrdersMap: {},
  pendingOrderMutationsQueue: loadPendingOrderMutationsQueue(),
  locallyDeletedOrderIds: {},
  lastLocalStoreConfigUpdateTs: 0,
  knownStoreOrderIds: new Set(),
  unacknowledgedOrderIds: new Set(),
  unackReminderTimer: null,
  lastStudentSubmitTs: 0,

  // 商業級資安：後端核發之具備時效性與單一店家權限範圍之 HMAC Session Token + 閒置自動上鎖 (#7, #8, #16)
  clientDeviceId: getClientDeviceId(),
  merchantAuthToken: sessionStorage.getItem('mealflow_merchant_session_v13') || '',
  merchantSessionExpiresAt: Number(sessionStorage.getItem('mealflow_merchant_exp_v13') || 0),
  merchantAuthorizedStoreScope: sessionStorage.getItem('mealflow_merchant_scope_v13') || '',
  isMerchantUnlocked: false,
  pinInputBuffer: '',
  isVerifyingPin: false,
  pinFailCount: 0,
  pinLockoutUntilTs: 0,
  boundMerchantStoreId: localStorage.getItem('mealflow_bound_store_id') || '',
  lastMerchantActivityTs: Date.now(),
  merchantHiddenSinceTs: 0,
  merchantAutoLockMinutes: Math.max(1, parseInt(localStorage.getItem('mealflow_auto_lock_mins') || '15', 10) || 15),

  // #41 & #42：音效自動播放解鎖狀態與 POS / KDS 防連點 In-flight 鎖
  isAudioUnlocked: false,
  isPosSubmitting: false,
  mutatingOrderIds: {},

  // 學生點餐與結帳狀態（支援跨店獨立購物車暫存與重整自動保留）
  selectedStoreId: (loadStudentCartDraft()?.selectedStoreId) || null,
  studentMenuCategory: '全部',
  studentMenuSearch: '',
  cartByStoreMap: (function () {
    const d = loadStudentCartDraft();
    const map = (d && d.cartByStoreMap && typeof d.cartByStoreMap === 'object') ? { ...d.cartByStoreMap } : {};
    if (d && d.selectedStoreId && Array.isArray(d.cartItems) && d.cartItems.length > 0 && !map[d.selectedStoreId]) {
      map[d.selectedStoreId] = d.cartItems;
    }
    return map;
  })(),
  cartItems: Array.isArray(loadStudentCartDraft()?.cartItems) ? loadStudentCartDraft().cartItems : [],
  studentAlertSoundMode: localStorage.getItem('mealflow_student_alert_mode') || 'CHIME', // 'CHIME' | 'MUTE' | 'VOICE'
  appDialogResolver: null,
  appDialogMode: null,
  appDialogFields: [],
  configuringItem: null,
  editingCartIndex: -1,
  isPosConfiguring: false,
  checkoutDineType: loadStudentCartDraft()?.checkoutDineType || '外帶自取',
  checkoutNeedCutlery: Boolean(loadStudentCartDraft()?.checkoutNeedCutlery),
  checkoutWantGift: true,
  checkoutTimeMode: loadStudentCartDraft()?.checkoutTimeMode || 'NOW',
  checkoutReserveDate: loadStudentCartDraft()?.checkoutReserveDate || getTodayDateStr(),
  checkoutReserveTime: loadStudentCartDraft()?.checkoutReserveTime || '12:15',
  checkoutPhone: localStorage.getItem('mealflow_saved_customer_phone_v12') || '',
  checkoutPayMethod: loadStudentCartDraft()?.checkoutPayMethod || 'LINE Pay',
  checkoutNote: loadStudentCartDraft()?.checkoutNote || '',
  checkoutTaxId: loadStudentCartDraft()?.checkoutTaxId || '',
  checkoutErrorBannerMsg: '',
  pendingPaymentResolver: null,
  autoFetchedMissingOrderIds: {},
  fetchingOrderInFlightMap: {},

  // 選餐顧問多輪對話歷史
  aiChatMessages: [],

  // 店家全螢幕 POS 四大主導覽：'pos' | 'kds' | 'analytics' | 'settings'
  storeTabMode: 'pos',
  settingsSubTab: 'menu', // 'menu' | 'promo' | 'storeProfile' | 'line'
  merchantStoreId: localStorage.getItem('mealflow_bound_store_id') || localStorage.getItem('mealflow_last_merchant_store_id') || 'S01',
  kdsSoundEnabled: true,
  kdsAutoPrintNewOrder: Boolean(localStorage.getItem('mealflow_auto_print_new') === '1'),

  // 店家櫃檯 POS 狀態
  posSelectedCategory: '全部',
  posCart: [],
  posHeldOrders: loadPosHeldOrders(),
  posShowExtraPanel: false,
  posDineType: '內用自取',
  posNeedCutlery: false,
  posTimeMode: 'NOW',
  posReserveDate: getTodayDateStr(),
  posReserveTime: '12:15',
  posCustomerPhone: '',
  posCustomerNote: '',
  posTaxId: '',
  posManualDiscount: 0,
  posManualDiscountReason: '',
  posPayment: '現場現金',
  posCashReceived: '',
  posSplitCashAmount: '',

  // 班別交班日結狀態 (B5)
  shiftOpeningFloat: parseInt(localStorage.getItem('mealflow_shift_float') || '2000', 10) || 2000,
  shiftActualCountedCash: '',
  shiftCashierName: localStorage.getItem('mealflow_shift_cashier') || '',

  // 訂單管理 (KDS) 分天檢視、分站過濾、智慧排序、改單與收款攔截狀態
  kdsSelectedDate: getTodayDateStr(),
  kdsStatusFilter: 'ALL',
  kdsStationFilter: 'ALL', // #12 廚房分站過濾：'ALL' | 'MAIN' | 'SIDE' | 'DRINK'
  kdsSortMode: 'FIFO',     // #31 KDS 排序模式：'FIFO' (最緊急/先下單優先) | 'NEWEST'
  kdsSearchQuery: '',
  kdsVerifyCodeInput: '',
  scannerStream: null,
  scannerRafId: null,
  payingOrderId: null,
  payingOrderMethod: '現場現金',
  payingOrderCashInput: '',
  payingOrderSplitCashInput: '',
  completeAfterPay: false,
  printingOrderId: null,
  receiptPrintMode: 'CUSTOMER', // #32 'CUSTOMER' | 'KITCHEN' | 'STICKER'
  modifyingOrderId: null,
  modifyingOrderItemsDraft: [],
  recentlyAutoFiredOrderIds: new Set(),

  // 營運分析時間維度：'DAY' | 'WEEK' | 'MONTH'
  analyticsPeriod: 'DAY',
  analyticsSelectedFilter: null,

  // 店家菜單管理與視覺掃描狀態
  scannedMenuCandidates: [],
  editingMenuStoreIndex: -1,
  editingMenuTempOptions: [],

  // 推播、防偽動態時鐘與智慧退避輪詢計時器
  lineProfile: loadLineProfile(),
  lineMessageLogs: loadLineLogs(),
  lastSeenOrderNotifyMap: {},
  lastSeenBoardReadyNumbersMap: {},
  lockedShiftsMap: {},
  openShiftsMap: {},
  pettyCashMap: {},
  serverTimeOffsetMs: 0,
  lastCloudSyncDoneTs: 0,
  liveClockTimer: null,
  pollTimer: null,
  pollFailureCount: 0,
  isSyncInFlight: false
};

state.isMerchantUnlocked = isMerchantSessionValidNow();

// ==================== 標準 ISO/IEC 18004 真實可掃描 QR Code 編碼引擎 ====================
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 安全用於 HTML inline onclick="..." 雙引號屬性內的 JavaScript 字串字面量編碼器
 * 先以 JSON.stringify 跳脫單雙引號、反斜線與換行，再將雙引號與 HTML 特殊字元轉為實體，徹底杜絕單引號破版與 XSS 注入
 */
function escapeJsAttr(val) {
  return escapeHtml(JSON.stringify(String(val ?? '')));
}

function generateOrderToken() {
  const chars = '0123456789abcdef';
  let token = 'ORD-';
  for (let i = 0; i < 12; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
  return token;
}

/**
 * 【商業級改造 2】真實 ISO/IEC 18004 QR Code 編碼器 (Byte Mode, Error Correction Level L, Versions 1~6)
 * 內建完整 GF(256) 伽羅瓦域多項式除法、定位圖形、對齊圖形、Format Info BCH 與最佳 Mask 選擇，
 * 任何手機原生相機、LINE 掃碼器或條碼槍 100% 可直接掃描解析！
 */
function encodeRealIsoQrMatrix(rawText) {
  const utf8Bytes = Array.from(new TextEncoder().encode(String(rawText || 'MEALFLOW')));
  // Version 1~6 (EC Level L, 單一 Block) 參數表: [version, totalCodewords, dataCodewords, ecCodewords, alignCenters]
  const VERSION_TABLE = [
    [1, 26, 19, 7, []],
    [2, 44, 34, 10, [6, 18]],
    [3, 70, 55, 15, [6, 22]],
    [4, 100, 80, 20, [6, 26]],
    [5, 134, 108, 26, [6, 30]],
    [6, 172, 136, 36, [6, 34]] // V6 採單一或雙區塊相容容錯保護
  ];

  // 選取足以容納 utf8Bytes + 2 bytes header 的最小版本 (上限截斷保護於 106 bytes)
  const maxBytes = 106;
  const payloadBytes = utf8Bytes.slice(0, maxBytes);
  let verEntry = VERSION_TABLE.find(v => payloadBytes.length + 2 <= v[2] && v[0] <= 5) || VERSION_TABLE[4];
  const [ver, totalCw, dataCw, ecCw, alignList] = verEntry;
  const size = 17 + ver * 4;

  // 1. 編碼 Data Bits (Byte mode = 0100, 8-bit length)
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payloadBytes.length, 8);
  payloadBytes.forEach(b => pushBits(b, 8));

  const maxDataBits = dataCw * 8;
  const termLen = Math.min(4, maxDataBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataBytes.push(b);
  }
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (dataBytes.length < dataCw) {
    dataBytes.push(padBytes[padIdx % 2]);
    padIdx++;
  }

  // 2. GF(256) Reed-Solomon 糾錯碼計算 (Primitive Polynomial 0x11D)
  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
  const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : gfExp[gfLog[a] + gfLog[b]];

  let gen = [1];
  for (let i = 0; i < ecCw; i++) {
    const nextGen = new Array(gen.length + 1).fill(0);
    const factor = gfExp[i];
    for (let j = 0; j < gen.length; j++) {
      nextGen[j] ^= gen[j];
      nextGen[j + 1] ^= gfMul(gen[j], factor);
    }
    gen = nextGen;
  }

  const msgPoly = new Uint8Array(dataCw + ecCw);
  for (let i = 0; i < dataCw; i++) msgPoly[i] = dataBytes[i];
  for (let i = 0; i < dataCw; i++) {
    const coef = msgPoly[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msgPoly[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  const ecBytes = Array.from(msgPoly.slice(dataCw));
  const allCodewords = [...dataBytes, ...ecBytes];

  // 3. 建立矩陣與功能圖形 (Finder / Separator / Timing / Alignment / Dark Module)
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFuncModule = (r, c, dark) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    matrix[r][c] = Boolean(dark);
    isFunc[r][c] = true;
  };

  const drawFinder = (r0, c0) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const r = r0 + dy, c = c0 + dx;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = (dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6);
        const isBorder = (dy === 0 || dy === 6 || dx === 0 || dx === 6);
        const isInner = (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4);
        setFuncModule(r, c, inOuter && (isBorder || isInner));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFuncModule(6, i, i % 2 === 0);
    setFuncModule(i, 6, i % 2 === 0);
  }

  if (alignList.length > 0) {
    for (const rCenter of alignList) {
      for (const cCenter of alignList) {
        if ((rCenter === 6 && cCenter === 6) ||
            (rCenter === 6 && cCenter === size - 7) ||
            (rCenter === size - 7 && cCenter === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
            setFuncModule(rCenter + dy, cCenter + dx, dark);
          }
        }
      }
    }
  }

  // 預留 Format Info 與設定 Dark Module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFuncModule(8, i, false);
      setFuncModule(i, 8, false);
    }
    if (i < 8) {
      setFuncModule(8, size - 1 - i, false);
      setFuncModule(size - 1 - i, 8, false);
    }
  }
  setFuncModule(size - 8, 8, true);

  // 4. Zig-Zag 填入資料位元
  const fullBits = [];
  allCodewords.forEach(b => {
    for (let i = 7; i >= 0; i--) fullBits.push((b >>> i) & 1);
  });

  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? (size - 1 - vert) : vert;
      for (let j = 0; j < 2; j++) {
        const c = rightCol - j;
        if (!isFunc[r][c]) {
          matrix[r][c] = bitIdx < fullBits.length ? Boolean(fullBits[bitIdx++]) : false;
        }
      }
    }
    upward = !upward;
  }

  // 5. 評估全部 8 種 ISO Mask Pattern (0~7) 並挑選懲罰分數最低之最佳遮罩與對應 BCH(15,5) Format Info
  const FORMAT_BITS_LEVEL_L = [
    0x77C4, 0x72F3, 0x7DAA, 0x789D,
    0x662F, 0x6318, 0x6C41, 0x6976
  ];
  const maskConds = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  const writeFormatInfoToMatrix = (mat, maskIdx) => {
    const formatBits = FORMAT_BITS_LEVEL_L[maskIdx] || 0x77C4;
    // 左上角 Format Info: bit 0 (LSB) 在 (0,8) 向下至 (8,8) 為 bit 7，再向左至 (8,0) 為 bit 14 (MSB)
    for (let i = 0; i <= 5; i++) mat[i][8] = ((formatBits >>> i) & 1) === 1;
    mat[7][8] = ((formatBits >>> 6) & 1) === 1;
    mat[8][8] = ((formatBits >>> 7) & 1) === 1;
    mat[8][7] = ((formatBits >>> 8) & 1) === 1;
    for (let i = 9; i < 15; i++) mat[8][14 - i] = ((formatBits >>> i) & 1) === 1;

    // 右上與左下 Format Info: bit 0 (LSB) 在 (8, size-1) 向左至 (8, size-8)，bit 8 在 (size-7, 8) 向下至 (size-1, 8) 為 bit 14 (MSB)
    for (let i = 0; i < 8; i++) mat[8][size - 1 - i] = ((formatBits >>> i) & 1) === 1;
    for (let i = 8; i < 15; i++) mat[size - 15 + i][8] = ((formatBits >>> i) & 1) === 1;
  };

  const scoreQrMatrixPenalty = (mat) => {
    let penalty = 0;
    // N1: 同色連續 >= 5 格
    for (let r = 0; r < size; r++) {
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (mat[r][c] === mat[r][c - 1]) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty += 1;
        } else {
          runLen = 1;
        }
      }
    }
    for (let c = 0; c < size; c++) {
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (mat[r][c] === mat[r - 1][c]) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty += 1;
        } else {
          runLen = 1;
        }
      }
    }
    // N2: 2x2 同色方塊
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = mat[r][c];
        if (mat[r][c + 1] === v && mat[r + 1][c] === v && mat[r + 1][c + 1] === v) {
          penalty += 3;
        }
      }
    }
    // N3: 1:1:3:1:1 類定位圖形比例懲罰 (搭配前後 4 格留白)
    const isN3Match = (arr, idx) => {
      if (idx + 7 > size) return false;
      if (!(arr[idx] && !arr[idx + 1] && arr[idx + 2] && arr[idx + 3] && arr[idx + 4] && !arr[idx + 5] && arr[idx + 6])) {
        return false;
      }
      const leftWhite = idx >= 4 && !arr[idx - 1] && !arr[idx - 2] && !arr[idx - 3] && !arr[idx - 4];
      const rightWhite = idx + 11 <= size && !arr[idx + 7] && !arr[idx + 8] && !arr[idx + 9] && !arr[idx + 10];
      return leftWhite || rightWhite;
    };
    for (let r = 0; r < size; r++) {
      for (let c = 0; c <= size - 7; c++) {
        if (isN3Match(mat[r], c)) penalty += 40;
      }
    }
    for (let c = 0; c < size; c++) {
      const colArr = mat.map(row => row[c]);
      for (let r = 0; r <= size - 7; r++) {
        if (isN3Match(colArr, r)) penalty += 40;
      }
    }
    // N4: 深色模組比例偏離 50%
    let darkCount = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (mat[r][c]) darkCount++;
      }
    }
    const totalMods = size * size;
    const k = Math.floor(Math.abs(darkCount * 20 - totalMods * 10) / totalMods);
    penalty += k * 10;
    return penalty;
  };

  let bestMatrix = null;
  let lowestPenalty = Infinity;

  for (let m = 0; m < 8; m++) {
    const candidate = matrix.map((row, r) =>
      row.map((val, c) => (!isFunc[r][c] && maskConds[m](r, c)) ? !val : val)
    );
    writeFormatInfoToMatrix(candidate, m);
    const p = scoreQrMatrixPenalty(candidate);
    if (p < lowestPenalty) {
      lowestPenalty = p;
      bestMatrix = candidate;
    }
  }

  return bestMatrix || matrix;
}

function generateDeterministicQrSvg(dataString, targetSize = 188) {
  const matrix = encodeRealIsoQrMatrix(String(dataString || 'MEALFLOW'));
  const gridSize = matrix.length;
  const quietZone = 4;
  const totalView = gridSize + quietZone * 2;

  // 強制使用整數格寬 (Integer Module Scale)，避免非整數像素在 crispEdges 下造成寬度不均與鋸齒，大幅提升手機相機與平板掃描成功率
  const scale = Math.max(3, Math.round(targetSize / totalView));
  const exactSize = totalView * scale;

  let pathData = '';
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (matrix[r][c]) {
        pathData += `M${c + quietZone},${r + quietZone}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalView} ${totalView}" width="${exactSize}" height="${exactSize}" shape-rendering="crispEdges" style="display:block; background:#FFFFFF; max-width:100%; height:auto;"><path d="${pathData}" fill="#000000"/></svg>`;
}

/**
 * 僅供「已授權登入之門市 POS 機」於店內網路瞬斷時產生本地暫時單號（學生端嚴禁使用）
 */
function generateMerchantPosOfflinePickupNumber(storeId, pickupDateStr) {
  const targetDate = normalizeDateStr(pickupDateStr);
  const storeNumMatch = String(storeId || 'S01').match(/(\d+)/);
  const storeDigit = storeNumMatch ? parseInt(storeNumMatch[1], 10) : 1;
  const baseNumber = storeDigit * 1000;

  const storageKey = `mealflow_seq_${storeId}_${targetDate}`;
  let maxSeq = baseNumber;

  try {
    const savedSeq = parseInt(localStorage.getItem(storageKey) || '0', 10);
    if (savedSeq > maxSeq) maxSeq = savedSeq;
  } catch (e) {}

  state.orders.forEach(o => {
    if (o.storeId === storeId && normalizeDateStr(o.pickupDate) === targetDate) {
      const numMatch = String(o.pickupNumber || '').match(/(\d{3,5})/);
      if (numMatch) {
        const val = parseInt(numMatch[1], 10);
        if (val >= baseNumber && val < baseNumber + 999 && val > maxSeq) {
          maxSeq = val;
        }
      }
    }
  });

  const nextSeq = maxSeq + 1;
  try {
    localStorage.setItem(storageKey, String(nextSeq));
  } catch (e) {}
  return String(nextSeq);
}

function syncLocalSeqWithAuthoritativeNumber(storeId, pickupDateStr, authNumStr) {
  const targetDate = normalizeDateStr(pickupDateStr);
  const storageKey = `mealflow_seq_${storeId}_${targetDate}`;
  const numVal = parseInt(String(authNumStr || '').replace(/\D/g, ''), 10);
  if (!isNaN(numVal) && numVal > 0) {
    try {
      const cur = parseInt(localStorage.getItem(storageKey) || '0', 10);
      if (numVal > cur) localStorage.setItem(storageKey, String(numVal));
    } catch (e) {}
  }
}

/**
 * 【商業級改造 6 & B13】排隊負載模型：
 * 除了「製作中」訂單外，剛按「可取餐」3 分鐘內擺在出餐口待領的訂單亦保留緩衝權重；
 * 若「製作中」已超過 45 分鐘（店員忙碌未按結單），自動排除於即時排隊負荷外，避免造成學生端假性滿載久候！
 */
function isOrderActivelyCookingNow(order) {
  if (!order) return false;
  const todayStr = getTodayDateStr();
  const ordDate = normalizeDateStr(order.pickupDate);
  if (ordDate !== todayStr) return false;

  const lifecycleStatus = evaluateOrderLifecycleStatus(order);
  if (lifecycleStatus === '製作中') {
    return getOrderElapsedMinutes(order) <= 45;
  }
  if (lifecycleStatus === '可取餐' && order.readyAtTs && (Date.now() - Number(order.readyAtTs)) < 180000) {
    return true;
  }
  return false;
}

function calcItemComplexityWeight(item) {
  if (!item || item.isGift || Number(item.price) === 0) return 0.15;
  const name = String(item.baseName || item.name || '');
  const selCount = item.selections ? Object.keys(item.selections).length : 0;
  const customFactor = Math.min(0.35, selCount * 0.08);

  if (name.includes('茶') || name.includes('飲') || name.includes('豆漿')) {
    return 0.25 + customFactor;
  }
  if (name.includes('湯') || name.includes('豆腐') || name.includes('起司條') || name.includes('炸雞')) {
    return 0.55 + customFactor;
  }
  if (name.includes('鐵板') || name.includes('鍋貼') || name.includes('水餃') || name.includes('炸蝦') || name.includes('豬排') || name.includes('漢堡排')) {
    return 1.25 + customFactor;
  }
  if (name.includes('涼麵')) {
    return 0.65 + customFactor;
  }
  return 1.0 + customFactor;
}

function calcOrderRemainingWorkloadUnits(order, maxCapPer15Min) {
  if (!isOrderActivelyCookingNow(order)) return 0;
  // 若已出餐在櫃檯等待領取（3分鐘緩衝期內），僅計入 0.35 裝袋交付緩衝負荷
  if (order.status === '可取餐') return 0.35;

  const items = Array.isArray(order.structuredItems) ? order.structuredItems : [];

  let totalWeightedUnits = 0;
  items.forEach(it => {
    const q = Math.max(1, Number(it.qty) || 1);
    const w = calcItemComplexityWeight(it);
    totalWeightedUnits += q * w;
  });

  const rawUnits = Math.max(0.6, 0.7 + totalWeightedUnits * 0.75);
  const elapsedMin = getOrderElapsedMinutes(order);
  const muPerMin = Math.max(5, Number(maxCapPer15Min) || 20) / 15;
  const digestedUnits = Math.min(rawUnits * 0.85, elapsedMin * muPerMin * 0.6);

  return Math.max(0.25, Number((rawUnits - digestedUnits).toFixed(2)));
}

function calcPrepMinutes(activeWorkloadUnits, maxCap, storeBasePrepMin = 4) {
  const capPer15 = Math.max(5, Number(maxCap) || 20);
  const L = Math.max(0, Number(activeWorkloadUnits) || 0);
  const muPerMin = capPer15 / 15;
  const baseMin = Math.max(2, Number(storeBasePrepMin) || 4);

  if (L <= 0.1) {
    return Math.round(baseMin);
  }

  const rho = Math.min(0.96, L / capPer15);
  const queueWaitMin = (L / muPerMin) * 0.78;
  const congestionPenalty = rho >= 0.6 ? ((rho * rho) / (1.05 - rho)) * 1.35 : 0;

  const totalWait = Math.round(baseMin + queueWaitMin + congestionPenalty);
  return Math.max(baseMin, Math.min(50, totalWait));
}

function calcAiUtilityScore(store) {
  if (store.isOpen === false) return 10;
  const waitScore = Math.max(0, 100 - (Number(store.avgPrepMinutes) || 5) * 3.4);
  let promoBonus = 0;
  if (store.promoMode === 'discount') promoBonus = 95;
  else if (store.promoMode === 'gift' || store.promoMode === 'freebie') promoBonus = 90;
  else if (store.promoMode === 'points') promoBonus = 75;
  const ratingScore = ((Number(store.rating) || 4.7) / 5.0) * 100;
  const raw = waitScore * 0.55 + promoBonus * 0.25 + ratingScore * 0.20;
  return Math.max(35, Math.min(99, Math.round(raw)));
}

function t(zhText, enText, jaText, koText) {
  const lang = (state && state.lang) || 'zh-TW';
  if (lang === 'en') return enText !== undefined ? enText : zhText;
  if (lang === 'ja') return jaText !== undefined ? jaText : (enText !== undefined ? enText : zhText);
  if (lang === 'ko') return koText !== undefined ? koText : (enText !== undefined ? enText : zhText);
  return zhText;
}

const I18N_DICTIONARY = {
  '雙溪校區': { en: 'Waishuangxi', ja: '双渓キャンパス', ko: '솽시 캠퍼스' },
  '城中校區': { en: 'Downtown', ja: '城中キャンパス', ko: '청중 캠퍼스' },
  '趙班長海苔飯捲': { en: "Capt. Zhao's Kimbap", ja: '趙班長キンパ', ko: '조반장 김밥' },
  '雙溪-丼物園': { en: 'Donburi Garden', ja: '丼物園', ko: '돈부리 가든' },
  '丼物園': { en: 'Donburi Garden', ja: '丼物園', ko: '돈부리 가든' },
  '雙溪-四海遊龍': { en: 'Sihai Youlong Dumplings', ja: '四海遊龍（餃子）', ko: '스하이요우룽 만두' },
  '四海遊龍': { en: 'Sihai Youlong Dumplings', ja: '四海遊龍（餃子）', ko: '스하이요우룽 만두' },
  '蒲家廚房': { en: 'Pu Family Kitchen', ja: '蒲家キッチン', ko: '푸가 키친' },
  '城中-咖哩食堂': { en: 'Curry House', ja: 'カレー食堂', ko: '카레 식당' },
  '咖哩食堂': { en: 'Curry House', ja: 'カレー食堂', ko: '카레 식당' },
  '城中-吳葉食堂': { en: 'Wuye Bento & Grill', ja: '呉葉食堂', ko: '우예 식당' },
  '林娘食堂': { en: "Lin's Noodle Kitchen", ja: '林娘食堂', ko: '린냥 식당' },
  '海音咖啡': { en: 'Haiyin Cafe', ja: '海音カフェ', ko: '하이인 카페' },
  '奕香咖啡': { en: 'Yixiang Coffee', ja: '奕香コーヒー', ko: '이샹 커피' },
  '夠健康廚房': { en: 'Go Healthy Kitchen', ja: 'ヘルシーキッチン', ko: '고 헬시 키친' },
  '醬心獨辣': { en: 'Spicy Malatang & Braised', ja: '醤心麻辣湯', ko: '마라탕・루웨이' },
  '醬心獨辣麻辣燙': { en: 'Spicy Malatang & Braised', ja: '醤心麻辣湯', ko: '마라탕・루웨이' },
  '東吳涼麵': { en: 'SCU Cold Noodles', ja: '東呉冷麺', ko: '둥우 냉면' },
  '拉手-捲鑫酥': { en: 'Crispy Wraps & Bakery', ja: 'ラショウ・ラップサンド', ko: '크리스피 랩・베이커리' },
  '大熊涼麵 X 吃好食堂': { en: 'Big Bear Cold Noodles', ja: '大熊冷麺食堂', ko: '빅베어 냉면' },
  '人氣韓式・飯捲': { en: 'Korean Kimbap & Rolls', ja: '韓国キンパ・海苔巻き', ko: '김밥・한식' },
  '人氣飯捲・抓餅輕食': { en: 'Kimbap & Crispy Pancakes', ja: 'キンパ・ネギパイ軽食', ko: '김밥・총좌빙' },
  '日式蓋飯・烏龍麵': { en: 'Donburi & Udon', ja: '丼・うどん', ko: '덮밥・우동' },
  '日式丼飯・咖哩定食': { en: 'Japanese Donburi & Curry', ja: '和風丼・カレー定食', ko: '일본 덮밥・카레' },
  '鍋貼水餃・麵食': { en: 'Potstickers & Dumplings', ja: '焼餃子・水餃子', ko: '군만두・물만두' },
  '中式特餐・便當': { en: 'Signature Bento', ja: '中華弁当', ko: '중식 도시락' },
  '熟成咖哩・炸物': { en: 'Aged Curry & Cutlets', ja: '熟成カレー・揚げ物', ko: '숙성 카레・돈카츠' },
  '風味咖哩・特色蓋飯': { en: 'Curry & Rice Bowls', ja: '風味カレー・丼ぶり', ko: '카레・덮밥' },
  '台式麵食・手工餃': { en: 'Taiwanese Noodles & Dumplings', ja: '台湾麺・手作り餃子', ko: '대만 면・수제 만두' },
  '港式便當・秘製涼麵': { en: 'HK Bento & Cold Noodles', ja: '香港弁当・特製冷麺', ko: '홍콩 도시락・냉면' },
  '特調飲品・手作輕食': { en: 'Craft Drinks & Light Bites', ja: '特製ドリンク・軽食', ko: '음료・가벼운 식사' },
  '特調咖啡・輕食簡餐': { en: 'Specialty Coffee & Meals', ja: '特製コーヒー・軽食', ko: '스페셜티 커피・식사' },
  '健康廚房・低GI餐盒': { en: 'Low-GI Healthy Bento', ja: '低GIヘルシー弁当', ko: '저혈당 건강 도시락' },
  '麻辣燙・乾拌滷味': { en: 'Malatang & Braised Dishes', ja: '麻辣湯・台湾煮込み', ko: '마라탕・루웨이' },
  '招牌涼麵・各式熱麵': { en: 'Cold & Hot Noodles', ja: '名物冷麺・温かい麺', ko: '냉면・온면' },
  '酥脆捲餅・法式麵包': { en: 'Crispy Wraps & French Bread', ja: 'サクサク巻餅・フランスパン', ko: '바삭한 랩・바게트' },
  '精緻台式簡餐': { en: 'Taiwanese Set Meals', ja: '台湾定食', ko: '대만 정식' },
  '手工涼麵・味噌湯': { en: 'Cold Noodles & Miso Soup', ja: '手打ち冷麺・味噌汁', ko: '냉면・미소국' },
  '韓式海苔飯捲': { en: 'Korean Kimbap Rolls', ja: '韓国海苔巻き', ko: '김밥류' },
  '韓式湯品與飲品': { en: 'Soups & Drinks', ja: 'スープ・ドリンク', ko: '국・음료' },
  '炙燒日式丼飯': { en: 'Flame-Seared Donburi', ja: '炙り丼', ko: '직화 덮밥' },
  '讚岐烏龍麵': { en: 'Sanuki Udon', ja: '讃岐うどん', ko: '사누키 우동' },
  '單點炸物與茶飲': { en: 'Fried Sides & Tea', ja: '揚げ物・お茶', ko: '튀김・차' },
  '手工鍋貼與水餃': { en: 'Potstickers & Dumplings', ja: '手作り餃子', ko: '수제 만두' },
  '開胃小菜與湯飲': { en: 'Sides, Soups & Drinks', ja: '小鉢・スープ', ko: '반찬・국・음료' },
  '人氣特餐便當': { en: 'Signature Bento Box', ja: '人気弁当', ko: '인기 도시락' },
  '單點小菜與湯品': { en: 'Side Dishes & Soups', ja: 'サイド・スープ', ko: '사이드・국' },
  '熟成濃咖哩': { en: 'Rich Aged Curry', ja: '熟成濃厚カレー', ko: '숙성 진한 카레' },
  '炸物點心': { en: 'Fried Snacks', ja: '揚げ物スナック', ko: '튀김류' },
  '主廚鐵板與簡餐': { en: 'Teppanyaki & Sets', ja: '鉄板焼き定食', ko: '철판 정식' },
  '特色麵食': { en: 'Specialty Noodles', ja: '特製麺', ko: '특선 면류' },
  '手工現拌涼麵': { en: 'Handmade Cold Noodles', ja: '特製冷麺', ko: '수제 냉면' },
  '招牌味噌湯品': { en: 'Signature Miso Soup', ja: '特製味噌汁', ko: '미소국' },
  '丼飯(3菜)': { en: 'Donburi (with 3 Sides)', ja: '丼ぶり（副菜3品付）', ko: '덮밥 (반찬 3종)' },
  '咖哩(3菜)': { en: 'Curry Rice (with 3 Sides)', ja: 'カレー（副菜3品付）', ko: '카레 (반찬 3종)' },
  '定食(3菜)': { en: 'Set Meal (with 3 Sides)', ja: '定食（副菜3品付）', ko: '정식 (반찬 3종)' },
  '單點': { en: 'À La Carte', ja: '単品', ko: '단품' },
  '抓餅類': { en: 'Scallion Pancakes', ja: '台湾風ネギパイ', ko: '총좌빙' },
  '飯捲類': { en: 'Rice Rolls', ja: 'ライスロール', ko: '라이스롤' },
  '主食份量': { en: 'Rice Portion', ja: 'ご飯の量', ko: '밥 양' },
  '正常飯量': { en: 'Regular Rice', ja: '普通盛り', ko: '보통' },
  '飯少(減醣)': { en: 'Less Rice', ja: '少なめ', ko: '밥 적게' },
  '大盛加飯': { en: 'Extra Rice', ja: '大盛り', ko: '밥 추가' },
  '辣度選擇': { en: 'Spice Level', ja: '辛さ選択', ko: '맵기 선택' },
  '不辣': { en: 'Non-Spicy', ja: '辛さなし', ko: '안 맵게' },
  '微辣': { en: 'Mild Spicy', ja: '微辛', ko: '약간 맵게' },
  '小辣': { en: 'Medium Spicy', ja: '小辛', ko: '덜 맵게' },
  '中辣': { en: 'Spicy', ja: '中辛', ko: '중간 매운맛' },
  '大辣': { en: 'Extra Hot', ja: '大辛', ko: '아주 맵게' },
  '人氣加料': { en: 'Add-ons', ja: 'トッピング', ko: '토핑 추가' },
  '加香濃起司': { en: 'Add Cheese', ja: 'チーズ追加', ko: '치즈 추가' },
  '加溏心溫泉蛋': { en: 'Add Onsen Egg', ja: '温泉卵追加', ko: '온천계란 추가' },
  '不要蔥花/香菜': { en: 'No Scallions/Cilantro', ja: 'ネギ・パクチー抜き', ko: '파/고수 빼기' },
  '麵條份量': { en: 'Noodle Portion', ja: '麺の量', ko: '면 양' },
  '標準份量': { en: 'Regular Noodles', ja: '普通', ko: '보통' },
  '加麵大碗': { en: 'Extra Noodles', ja: '麺大盛り', ko: '면 추가' },
  '單點加料': { en: 'Add-ons', ja: '追加トッピング', ko: '추가 토핑' },
  '加滷蛋': { en: 'Add Braised Egg', ja: '煮卵追加', ko: '간장계란 추가' },
  '加貢丸(2顆)': { en: 'Add 2 Pork Balls', ja: '肉団子2個追加', ko: '완자 2알 추가' },
  '不要蔥花': { en: 'No Scallions', ja: 'ネギ抜き', ko: '파 빼기' },
  '甜度調整': { en: 'Sweetness', ja: '甘さ', ko: '당도' },
  '冰塊調整': { en: 'Ice Level', ja: '氷の量', ko: '얼음량' },
  '正常甜': { en: 'Regular Sugar', ja: '通常の甘さ', ko: '기본 당도' },
  '少糖': { en: 'Less Sugar', ja: '甘さ控えめ', ko: '덜 달게' },
  '微糖': { en: 'Light Sugar', ja: '微糖', ko: '약간 달게' },
  '無糖': { en: 'Unsweetened', ja: '無糖', ko: '무가당' },
  '正常冰': { en: 'Regular Ice', ja: '氷普通', ko: '얼음 보통' },
  '少冰': { en: 'Less Ice', ja: '氷少なめ', ko: '얼음 적게' },
  '微冰': { en: 'Light Ice', ja: '微氷', ko: '얼음 아주 적게' },
  '去冰': { en: 'No Ice', ja: '氷なし', ko: '얼음 빼기' },
  '外帶自取': { en: 'Takeout Pickup', ja: 'テイクアウト', ko: '포장 픽업' },
  '內用自取': { en: 'Dine-in Pickup', ja: '店内飲食', ko: '매장 식사' },
  '製作中': { en: 'Preparing', ja: '調理中', ko: '조리 중' },
  '可取餐': { en: 'Ready for Pickup', ja: '受取可能', ko: '픽업 가능' },
  '已接單待排程': { en: 'Scheduled', ja: '予約受付済', ko: '예약 접수됨' },
  '待付款確認': { en: 'Pending Payment', ja: 'お支払い待ち', ko: '결제 대기' },
  '已完成': { en: 'Completed', ja: '完了', ko: '완료' },
  '已付款': { en: 'Paid', ja: '支払済', ko: '결제 완료' },
  '取餐付現': { en: 'Pay Cash at Pickup', ja: '受取時現金払い', ko: '픽업 시 현금 결제' },
  '現場櫃檯付現': { en: 'Pay Cash at Counter', ja: '店頭現金払い', ko: '카운터 현금 결제' },
  '全部': { en: 'All', ja: 'すべて', ko: '전체' }
};

// 全系統介面多語詞彙庫（覆蓋學生端、店家 POS、KDS、日結單、營運分析、設定、彈窗與 Toast；保留店家自訂菜名交由店家編輯 nameEn）
const SYSTEM_UI_PHRASES = [
  ['瀏覽器接單鈴聲尚未解鎖（👉 點此立即啟用接單音效）', 'Order alarm audio locked (Tap to unlock sound)', '受注アラーム未解除（タップして音声を有効化）', '주문 알림음 잠금됨 (탭하여 알림음 켜기)'],
  ['店務營運後台受雲端時效憑證保護中', 'Merchant Console Protected by Cloud Session', '店舗管理画面はクラウド認証で保護されています', '매장 관리 콘솔이 보안 세션으로 보호 중입니다'],
  ['未持有該店有效 HMAC Session Token 前，系統禁止渲染收銀、退單與營業報表節點。', 'Verify your store PIN to access POS, orders, and reports.', '店舗PIN認証後、レジ・注文・売上レポートをご利用いただけます。', '매장 PIN 인증 후 POS, 주문 및 매출 리포트에 접근할 수 있습니다.'],
  ['輸入店務授權碼驗證', 'Unlock with Store PIN', '店舗PINで解除', '매장 PIN 인증'],
  ['請點擊左側餐點卡片加入點餐單', 'Tap a dish on the left to add to order', '左のメニューをタップして追加', '왼쪽 메뉴를 탭하여 주문에 추가하세요'],
  ['支援「⏸️ 掛單暫存」與兩段式防誤觸收銀結帳', 'Supports Hold Order & Two-Step Checkout', '保留注文・2段階会計に対応', '주문 보류 및 2단계 결제 지원'],
  ['班別錢箱清點・中途零用金收支與關班鎖定（列印時自動隱藏此設定框）', 'Cash Drawer Count, Petty Cash & Shift Lock (hidden when printing)', 'レジ点検・小口現金・締めロック（印刷時は非表示）', '시재 점검・소액 현금・마감 잠금 (인쇄 시 숨김)'],
  ['確認購物車明細與預訂設定', 'Review Cart & Pickup Options', 'カート明細と受取設定の確認', '장바구니 및 픽업 설정 확인'],
  ['查看購物車・選取餐與預訂時間', 'View Cart & Pickup Time', 'カートを見る・受取時間選択', '장바구니 보기・픽업 시간'],
  ['我的點餐紀錄與跨裝置訂單查詢', 'My Orders & Cross-Device Lookup', '注文履歴・他端末照会', '내 주문 내역・다른 기기 조회'],
  ['支援雙重驗證跨裝置安全找回', 'Secure cross-device order recovery', '二重認証で他端末からも安全に照会', '이중 인증으로 안전하게 주문 조회'],
  ['確認金額・收款找零與出單', 'Confirm Amount, Payment & Print', '金額確認・お会計・発券', '금액 확인・결제 및 발행'],
  ['櫃檯收銀確認・多元付款找零', 'Counter Checkout & Split Payment', 'レジ確認・複数決済対応', '카운터 결제・복합 결제'],
  ['暫存掛單清單（隨時取回結帳）', 'Held Orders (Resume Anytime)', '保留注文リスト（いつでも再開）', '보류된 주문 목록 (언제든 재개)'],
  ['目前本店沒有暫存中的掛單', 'No held orders for this store', '保留中の注文はありません', '보류 중인 주문이 없습니다'],
  ['櫃檯掛單暫存佇列', 'POS Held Orders Queue', 'レジ保留キュー', 'POS 보류 주문'],
  ['點選輸入顧客實收金額', 'Enter Cash Tendered', 'お預かり金額を入力', '받은 현금 입력'],
  ['櫃檯收銀數字鍵盤', 'POS Cash Numpad', 'レジ数字キーパッド', 'POS 현금 키패드'],
  ['櫃檯錢箱交班日結單 (Z-Report)', 'Shift Z-Report & Cash Reconciliation', 'シフト精算・日次レポート (Z-Report)', '교대 정산・일일 마감 (Z-Report)'],
  ['櫃檯錢箱交班日結單', 'Shift Z-Report', 'シフト日次精算', '교대 일일 정산'],
  ['廚房出單小票與日結單預覽', 'Receipt & Kitchen Ticket Preview', 'レシート・キッチン伝票プレビュー', '영수증・주방 주문서 미리보기'],
  ['80mm 熱感應出單機格式', '80mm Thermal Printer Format', '80mmサーマルプリンタ形式', '80mm 감열지 인쇄 형식'],
  ['立即列印 80mm 單據', 'Print 80mm Ticket', '80mm伝票を印刷', '80mm 전표 인쇄'],
  ['顧客收據與追蹤 QR 憑證聯 (80mm)', 'Customer Receipt & QR (80mm)', 'お客様レシート・QR (80mm)', '고객 영수증 및 QR (80mm)'],
  ['廚房大字工單聯 (Kitchen Work Ticket)', 'Kitchen Work Ticket', 'キッチン調理伝票', '주방 조리 주문서'],
  ['餐盒 / 飲料杯貼紙聯 (Meal Stickers)', 'Meal Box & Cup Stickers', '弁当・カップ用ラベル', '도시락・음료 스티커'],
  ['店家營運管理授權驗證', 'Merchant PIN Authorization', '店舗管理PIN認証', '매장 관리자 PIN 인증'],
  ['雲端 HMAC 時效簽章驗證 (4碼)', 'Cloud HMAC Session Auth', 'クラウドHMAC認証', '클라우드 HMAC 인증'],
  ['選擇收款方式（支援現金、行動支付與複合付款）', 'Payment Method (Cash / LINE Pay / Split)', 'お支払い方法（現金・LINE Pay・併用）', '결제 수단 (현금 / LINE Pay / 복합결제)'],
  ['複合付款拆帳（現金入錢箱 + LINE Pay 入行動支付）', 'Split Payment (Cash Drawer + LINE Pay)', '併用払い内訳（現金＋LINE Pay）', '복합 결제 분할 (현금 + LINE Pay)'],
  ['掃描顧客電子取餐憑證 QR Code', 'Scan Customer Pickup QR Code', '受取用QRコードをスキャン', '고객 픽업 QR 코드 스캔'],
  ['未完成訂單修改與單品作廢', 'Modify Active Order / Void Item', '注文変更・単品取消', '주문 수정 / 단품 취소'],
  ['編輯餐點與客製化選項', 'Edit Dish & Modifiers', 'メニュー・オプション編集', '메뉴 및 옵션 편집'],
  ['餐點規格與選項設定', 'Dish Specs & Modifiers', 'メニュー仕様設定', '메뉴 옵션 설정'],
  ['儲存餐點設定並同步雲端', 'Save Dish & Sync', '保存してクラウド同期', '저장 및 클라우드 동기화'],
  ['依即時排隊狀況幫你快速選餐', 'Quick meal suggestions by live wait time', 'リアルタイム待ち時間からおすすめ提案', '실시간 대기시간 기반 메뉴 추천'],
  ['MealFlow 智慧選餐與免排隊助手', 'MealFlow Smart Meal Assistant', 'MealFlow 食事アシスタント', 'MealFlow 메뉴 도우미'],
  ['MealFlow 快速條件篩選助手', 'MealFlow Quick Filter Assistant', 'MealFlow クイック検索アシスタント', 'MealFlow 빠른 필터 도우미'],
  ['一鍵透過 LINE 帳號授權綁定', 'One-Tap LINE Notification Binding', 'LINEアカウントで簡単通知連携', 'LINE 계정 원클릭 알림 연동'],
  ['使用 LINE 帳號一鍵授權綁定', 'Connect with LINE', 'LINEで連携する', 'LINE으로 연동하기'],
  ['綁定電子信箱免費取餐通知 / 或手動填入識別碼', 'Bind Email for Free Pickup Alerts', 'メール通知設定 / ID手動入力', '이메일 무료 픽업 알림 설정'],
  ['綁定取餐推播通知', 'Bind Pickup Notifications', '受取通知を連携', '픽업 알림 연동'],
  ['營業中 (點此切換)', 'Open (Tap to Pause)', '営業中 (切替)', '영업 중 (전환)'],
  ['暫停營業 (點此恢復)', 'Paused (Tap to Open)', '準備中 (再開)', '휴식 중 (재개)'],
  ['店家櫃檯收銀與營運中心', 'Merchant POS & Operations', '店舗POS・管理センター', '매장 POS・운영 센터'],
  ['顧客即時取餐叫號大螢幕看板', 'Live Pickup Call Board', '受取番号ディスプレイ', '실시간 픽업 호출 전광판'],
  ['訂單專屬追蹤憑證', 'Order Pickup Ticket', '受取電子チケット', '주문 픽업 티켓'],
  ['線上點餐系統', 'Campus Ordering', 'オンライン注文', '온라인 주문'],
  ['系統入口導覽', 'Portal Home', 'ポータルホーム', '포털 홈'],
  ['即時取餐叫號看板', 'Live Pickup Board', '受取番号ボード', '실시간 호출판'],
  ['廚房準備中 (Preparing)', 'Preparing', '調理中 (Preparing)', '조리 중 (Preparing)'],
  ['請至櫃檯取餐 (Ready for Pickup)', 'Ready for Pickup', '受取可能 (Ready)', '픽업 가능 (Ready)'],
  ['啟用叫號音效', 'Enable Sound', '音声ON', '알림음 켜기'],
  ['關閉看板', 'Close Board', '閉じる', '닫기'],
  ['切換看板店鋪：', 'Switch Store: ', '店舗切替：', '매장 전환: '],
  ['目前無準備中單號', 'No orders preparing', '調理中の注文はありません', '조리 중인 주문 없음'],
  ['請稍候，餐點完成將立即顯示並語音叫號', 'Ready numbers will appear here', '出来上がり次第ここに表示されます', '완료되면 여기에 번호가 표시됩니다'],
  ['前往收銀確認', 'Proceed to Checkout', 'お会計へ進む', '결제 확인으로 이동'],
  ['確認收款並立即出單', 'Confirm & Issue Order', '会計確定・発券', '결제 확정 및 발행'],
  ['結帳出單', 'Checkout', '会計確定', '결제 완료'],
  ['返回修改', 'Back', '戻って修正', '돌아가기'],
  ['進階選項（預訂 / 折讓 / 備註 / 電話 / 統編）', 'More Options (Pre-order / Discount / Note)', '詳細オプション（予約・割引・メモ）', '추가 옵션 (예약 / 할인 / 메모)'],
  ['進階選項', 'More Options', '詳細オプション', '추가 옵션'],
  ['立即出餐', 'Make Now', '今すぐ調理', '즉시 조리'],
  ['預訂取餐', 'Pre-order', '予約受取', '예약 픽업'],
  ['全單招待', 'Comp Order', '全額サービス', '전액 무료'],
  ['顧客實收現金', 'Cash Received', 'お預かり現金', '받은 현금'],
  ['顧客實收金額', 'Cash Tendered', 'お預かり金額', '받은 금액'],
  ['應找零錢', 'Change Due', 'お釣り', '거스름돈'],
  ['應收總計', 'Total Due', '合計金額', '결제 합계'],
  ['應付總計金額', 'Order Total', 'お支払い合計', '총 결제 금액'],
  ['確認餐點並送出訂單', 'Place Order', '注文を確定する', '주문하기'],
  ['現場立即製作', 'Immediate Order', '即時調理', '즉시 조리'],
  ['預覽單號', 'Preview #', 'プレビュー #', '미리보기 #'],
  ['櫃檯點餐單', 'Counter Order', 'レジ注文票', '카운터 주문서'],
  ['現場現金', 'Cash', '現金', '현금'],
  ['複合付款', 'Split Pay', '併用払い', '복합 결제'],
  ['現金支付金額 ($)', 'Cash Portion ($)', '現金金額 ($)', '현금 금액 ($)'],
  ['LINE Pay 補差額 ($)', 'LINE Pay Balance ($)', 'LINE Pay残額 ($)', 'LINE Pay 잔액 ($)'],
  ['開班點鈔登記', 'Open Shift Float', '開店準備金登録', '개점 시재 등록'],
  ['已開班', 'Shift Open', '開局済', '개점 완료'],
  ['開班點鈔', 'Open Shift', '開店点検', '개점 시재'],
  ['交班日結單', 'Z-Report', '日次精算', '일일 마감'],
  ['交班日結', 'Z-Report', '日次精算', '일일 마감'],
  ['同步雲端', 'Sync', '同期', '동기화'],
  ['鎖定後台', 'Lock', 'ロック', '잠금'],
  ['叫號看板', 'Call Board', '呼出画面', '호출판'],
  ['售罄切換', 'Sold Out', '売切切替', '품절 전환'],
  ['已售罄(點此上架)', 'Sold Out (Restore)', '売切 (再販)', '품절 (재판매)'],
  ['客製 ・ 售罄', 'Opts · Sold Out', '設定・売切', '옵션·품절'],
  ['掛單', 'Hold', '保留', '보류'],
  ['拆單', 'Split', '分割', '분할'],
  ['清空', 'Clear', 'クリア', '비우기'],
  ['收合', 'Hide', '閉じる', '접기'],
  ['展開', 'Show', '開く', '펼치기'],
  ['剛好', 'Exact', '丁度', '정확히'],
  ['鍵盤', 'Keypad', 'テンキー', '키패드'],
  ['折讓', 'Discount', '割引', '할인'],
  ['自訂', 'Custom', 'カスタム', '직접입력'],
  ['餐具', 'Cutlery', 'カトラリー', '수저'],
  ['內用', 'Dine-in', '店内', '매장'],
  ['外帶', 'Takeout', '持ち帰り', '포장'],
  ['備註', 'Note', 'メモ', '메모'],
  ['電話/末3碼', 'Phone', '電話番号', '전화번호'],
  ['統編(8碼)', 'Tax ID', '法人番号', '사업자번호'],
  ['全部站點', 'All Stations', '全ステーション', '전체 파트'],
  ['主食飯麵', 'Mains', 'メイン', '메인 요리'],
  ['炸物小菜', 'Sides & Fried', '揚げ物・副菜', '튀김・사이드'],
  ['湯品飲品', 'Soups & Drinks', 'スープ・飲物', '국・음료'],
  ['最緊急優先 (FIFO)', 'Urgent First (FIFO)', '緊急順 (FIFO)', '긴급순 (FIFO)'],
  ['最新下單優先', 'Newest First', '新着順', '최신순'],
  ['全部狀態', 'All Status', '全ステータス', '전체 상태'],
  ['預約待排程', 'Scheduled', '予約待機', '예약 대기'],
  ['待付款', 'Unpaid', '未払い', '미결제'],
  ['製作中', 'Preparing', '調理中', '조리 중'],
  ['可取餐', 'Ready', '受取可', '픽업 가능'],
  ['已完成', 'Done', '完了', '완료'],
  ['已取消', 'Cancelled', '取消済', '취소됨'],
  ['鏡頭掃碼', 'Scan QR', 'QRスキャン', 'QR 스캔'],
  ['確認核銷', 'Verify', '認証', '인증'],
  ['現場單', 'POS', '店頭', '매장'],
  ['線上預訂', 'Pre-order', 'ネット予約', '온라인 예약'],
  ['線上單', 'Online', 'オンライン', '온라인'],
  ['預訂轉入', 'Auto-Fired', '予約投入', '예약 투입'],
  ['通知取餐', 'Call Ready', '呼出通知', '픽업 호출'],
  ['再次叫號', 'Recall', '再呼出', '재호출'],
  ['完成結單', 'Complete', '受取完了', '픽업 완료'],
  ['退回製作', 'Back to Prep', '調理に戻す', '조리로 복원'],
  ['復原為待取餐', 'Undo to Ready', '受取可に戻す', '픽업대기 복원'],
  ['改單 / 單品作廢', 'Modify / Void', '変更・取消', '수정 / 취소'],
  ['改單', 'Modify', '変更', '수정'],
  ['留言', 'Message', '連絡', '메시지'],
  ['印單', 'Print', '印刷', '인쇄'],
  ['退單', 'Cancel', '取消', '취소'],
  ['收款', 'Pay', '会計', '결제'],
  ['廚房備料拆解統計', 'Kitchen Prep Summary', 'キッチン仕込み集計', '주방 조리 집계'],
  ['顧客收據聯', 'Customer Receipt', 'お客様用', '고객 영수증'],
  ['廚房大字工單', 'Kitchen Ticket', 'キッチン用', '주방 주문서'],
  ['餐盒貼紙聯', 'Meal Stickers', 'ラベル用', '스티커'],
  ['菜單管理', 'Menu', 'メニュー管理', '메뉴 관리'],
  ['產能與優惠', 'Capacity & Deals', 'キャパ・割引', '생산량・할인'],
  ['餐廳資料', 'Store Info', '店舗情報', '매장 정보'],
  ['推播與安全', 'Alerts & Security', '通知・セキュリティ', '알림・보안'],
  ['批次加料售罄開關', 'Bulk Modifier Sold-Out', 'トッピング一括売切', '토핑 일괄 품절'],
  ['目前架上菜單', 'Active Menu', '登録メニュー', '등록된 메뉴'],
  ['手動新增單一品項', 'Add New Dish', 'メニュー手動追加', '메뉴 수동 추가'],
  ['新增選項群組', 'Add Option Group', 'グループ追加', '옵션 그룹 추가'],
  ['套用範本', 'Presets', 'テンプレ', '템플릿'],
  ['必選單選', 'Required (Single)', '必須（単一）', '필수 (단일)'],
  ['可多選加料', 'Optional (Multi)', '複数選択可', '다중 선택'],
  ['每日限量', 'Daily Limit', '1日限定数', '일일 한정'],
  ['上傳照片 (自動壓縮)', 'Upload Photo', '写真をアップロード', '사진 업로드'],
  ['移除照片', 'Remove Photo', '写真削除', '사진 삭제'],
  ['編輯', 'Edit', '編集', '편집'],
  ['上架', 'Restore', '再販', '판매'],
  ['售罄', 'Sold Out', '売切', '품절'],
  ['刪除', 'Delete', '削除', '삭제'],
  ['儲存設定並同步雲端', 'Save & Sync', '保存・同期', '저장 및 동기화'],
  ['開店找零零用金 ($)', 'Opening Float ($)', '開店準備金 ($)', '개점 시재 ($)'],
  ['櫃檯實際清點現金 ($)', 'Counted Cash ($)', '実査現金 ($)', '실제 현금 ($)'],
  ['交班收銀員姓名', 'Cashier Name', '担当者名', '담당자 이름'],
  ['中途零用金收支登記', 'Petty Cash Log', '小口現金入出金', '소액 현금 입출금'],
  ['錢箱支出', 'Payout (-)', '出金 (-)', '지출 (-)'],
  ['錢箱補入', 'Pay-in (+)', '入金 (+)', '입금 (+)'],
  ['新增收支', 'Add Entry', '登録', '등록'],
  ['確認關班並鎖定今日日結', 'Lock & Close Shift', '締め確定・ロック', '마감 확정 및 잠금'],
  ['店長解除鎖定', 'Unlock Shift', 'ロック解除', '잠금 해제'],
  ['實收淨營業額', 'Net Paid Revenue', '実収純売上', '순 매출'],
  ['應有現金總額', 'Expected Cash', '理論現金残高', '예상 현금'],
  ['短溢差額', 'Cash Variance', '過不足差額', '현금 과부족'],
  ['今日', 'Today', '本日', '오늘'],
  ['近 7 日', '7 Days', '直近7日', '최근 7일'],
  ['全區間', 'All Time', '全期間', '전체 기간'],
  ['匯出 CSV 報表', 'Export CSV', 'CSV出力', 'CSV 내보내기'],
  ['熱銷餐點排行', 'Top Selling Dishes', '人気メニューランキング', '인기 메뉴 순위'],
  ['返回點餐頁', 'Back to Order', '注文画面へ', '주문 화면으로'],
  ['返回點餐首頁', 'Back to Menu', 'メニューへ戻る', '메뉴로 돌아가기'],
  ['防偽動態電子取餐憑證', 'Verified Pickup Ticket', '電子受取チケット', '전자 픽업 티켓'],
  ['您的專屬取餐流水號', 'Your Pickup Number', 'お客様の受取番号', '픽업 번호'],
  ['目前叫號', 'Now Calling', '呼出番号', '현재 호출'],
  ['前方等候', 'Ahead', '待ち組数', '앞 대기'],
  ['預估剩餘', 'Est. Left', '残り目安', '예상 남은시간'],
  ['準備中', 'Prep', '準備中', '준비 중'],
  ['輪到您了', 'Your Turn', 'お呼び出し中', '차례입니다'],
  ['立即取餐', 'Pick Up Now', '今すぐ受取', '즉시 픽업'],
  ['預約排程', 'Scheduled', '予約済', '예약됨'],
  ['防偽核銷碼', 'Verification Code', '認証コード', '인증코드'],
  ['訂單狀態歷程時間軸', 'Order Status Timeline', '注文ステータス履歴', '주문 상태 타임라인'],
  ['店家櫃檯即時通知', 'Message from Store', '店舗からのメッセージ', '매장 메시지'],
  ['分享 / 複製取餐網址', 'Copy Ticket Link', 'チケットURLをコピー', '티켓 링크 복사'],
  ['再點一單', 'Order Again', 'もう一度注文', '다시 주문'],
  ['取消預約', 'Cancel Pre-order', '予約キャンセル', '예약 취소'],
  ['儲存通知設定', 'Save Settings', '設定を保存', '알림 설정 저장'],
  ['開啟網頁震動響鈴', 'Enable Web Alerts', 'ブラウザ通知ON', '웹 알림 켜기'],
  ['解除綁定', 'Unbind', '連携解除', '연동 해제'],
  ['最近推播紀錄匣', 'Recent Notification Log', '最近の通知履歴', '최근 알림 내역'],
  ['關閉', 'Close', '閉じる', '닫기'],
  ['確定', 'Confirm', '確認', '확인'],
  ['取消', 'Cancel', 'キャンセル', '취소'],
  ['點餐', 'POS', 'レジ', '포스'],
  ['訂單', 'Orders', '注文', '주문'],
  ['分析', 'Analytics', '分析', '분석'],
  ['設定', 'Settings', '設定', '설정'],
  ['即時廚房爐上備料與規格拆解看板', 'Live Kitchen Prep & Modifier Breakdown', 'リアルタイム調理・仕様集計ボード', '실시간 주방 조리・옵션 집계판'],
  ['同時顯示主餐總數與飯量/辣度/內外帶拆解，方便師傅批次下鍋盛飯', 'Groups dishes by portion, spice & dine-in/takeout for batch cooking', 'ご飯量・辛さ・店内/持帰別に集計し調理を効率化', '밥 양・맵기・매장/포장별로 집계해 일괄 조리 지원'],
  ['目前爐上無製作中單品，廚房順暢待命', 'No dishes currently preparing — kitchen clear', '現在調理中の品目はありません', '현재 조리 중인 메뉴가 없습니다'],
  ['目前爐上無製作中單品', 'No dishes currently preparing', '現在調理中の品目はありません', '현재 조리 중인 메뉴 없음'],
  ['廚房順暢待命', 'Kitchen ready', 'キッチン待機中', '주방 대기 중'],
  ['櫃檯快速核銷取餐：', 'Quick Pickup Verify: ', 'クイック受取認証：', '빠른 픽업 인증: '],
  ['支援鏡頭掃描顧客 QR 憑證，或輸入 6 碼防偽核銷碼（未收款單將自動彈出收銀視窗）', 'Scan customer QR code or enter 6-char code (unpaid orders open cashier automatically)', 'QRスキャンまたは6桁コード入力（未払いは自動でレジ表示）', '고객 QR 스캔 또는 6자리 코드 입력 (미결제 시 결제창 자동 오픈)'],
  ['支援鏡頭掃描顧客 QR 憑證', 'Scan customer QR code', 'QRコードをスキャン', '고객 QR 코드 스캔'],
  ['或輸入 6 碼防偽核銷碼（未收款將自動彈出收銀視窗）', 'or enter 6-char code (unpaid orders open cashier)', 'または6桁コード入力（未払いはレジ起動）', '또는 6자리 코드 입력 (미결제 시 결제창 표시)'],
  ['合共 ', 'Total ', '合計 ', '합계 '],
  ['・共 ', ' · ', '・計 ', ' · '],
  ['已退單', 'Cancelled', '取消済', '취소됨'],
  ['站點', 'Station', 'ステーション', '파트'],
  ['收款後退單退款', 'Paid Refunds', '支払済返金', '결제 후 환불'],
  ['未收款退單作廢', 'Unpaid Voids', '未払い取消', '미결제 취소'],
  ['此時間區間尚無訂單紀錄', 'No orders in this time range', 'この期間の注文履歴はありません', '이 기간의 주문 내역이 없습니다'],
  ['區間真實訂單明細', 'Order Details in Period', '期間内注文明細', '기간 내 주문 상세'],
  ['上傳紙本菜單照片或貼上文字，系統將自動進行結構化解析並綁定確定性品項 ID，絕不破壞進行中訂單關聯', 'Upload a menu photo or paste text to parse dishes with stable IDs without breaking active orders', '紙メニューの写真またはテキストから自動解析し、既存注文を壊さず登録します', '종이 메뉴 사진이나 텍스트를 업로드하면 기존 주문을 유지한 채 자동 등록합니다'],
  ['點擊一次即同步全店所有含該加料的主餐', 'Tap once to sync across all dishes with this add-on', 'ワンタップで全該当メニューに同期', '한 번 탭하여 모든 해당 메뉴에 일괄 적용'],
  ['支援每日限量自動扣減售罄與客製加料規則', 'Supports daily limits & modifier rules', '1日限定数・オプション対応', '일일 한정 및 옵션 규칙 지원'],
  ['紅虛線：15分鐘警戒', 'Red dashed: 15m alert', '赤破線：15分警戒', '빨간 점선: 15분 경고'],
  ['本區間人氣王備料建議：', 'Top Seller Prep Insight: ', '人気メニュー仕込み提案：', '인기 메뉴 준비 제안: '],
  ['排程與配額隔離保護：', 'Schedule & Quota Isolation: ', '予約枠・負荷分離保護：', '예약 및 생산량 분리 보호: '],
  ['筆)', ')', '件)', '건)'],
  ['單)', ')', '件)', '건)'],
  ['共 ', 'Total ', '計 ', '총 '],
  ['櫃檯快速核銷取餐：支援鏡頭掃描顧客 QR 憑證，或輸入 6 碼防偽核銷碼（未收款單將自動彈出收銀視窗）', 'Quick Pickup Verify: scan customer QR code or enter 6-char code (unpaid orders open cashier automatically)', 'クイック受取認証：QRスキャンまたは6桁コード入力（未払いは自動でレジ表示）', '빠른 픽업 인증: 고객 QR 스캔 또는 6자리 코드 입력 (미결제 시 결제창 자동 오픈)'],
  ['開啟鏡頭掃碼', 'Open QR Scanner', 'QRスキャナ起動', 'QR 스캐너 열기'],
  ['核銷取餐', 'Verify Pickup', '受取認証', '픽업 인증'],
  ['取餐日期：', 'Pickup Date: ', '受取日：', '픽업 날짜: '],
  ['新單語音播報: 開', 'New Order Voice: ON', '新着音声案内: ON', '신규 주문 음성: ON'],
  ['新單語音播報: 關', 'New Order Voice: OFF', '新着音声案内: OFF', '신규 주문 음성: OFF'],
  ['預訂待發送', 'Scheduled', '予約待機', '예약 대기'],
  ['待收款確認', 'Unpaid', '未払い確認', '미결제 확인'],
  ['已通知待取餐', 'Called / Ready', '呼出済・受取待', '호출됨・픽업대기'],
  ['明日', 'Tomorrow', '明日', '내일'],
  ['日期', 'Date', '日付', '날짜'],
  ['商業會計損益與真實訂單分析', 'Revenue P&L & Real Order Analytics', '売上損益・注文分析レポート', '매출 손익 및 실시간 주문 분석'],
  ['嚴格區分「今日逐時」、「過去 7 日趨勢」與「應收/實收帳款」，絕不混入未來預訂單造成帳務失真。', 'Separates Today, 7-Day Trend & Paid vs Receivable accurately without mixing future pre-orders.', '本日・直近7日・実収/売掛を正確に分離し集計します。', '오늘・최근 7일・실수입/미수금을 정확하게 분리하여 집계합니다.'],
  ['今日逐時', 'Today Hourly', '本日時間別', '오늘 시간별'],
  ['過去 7 日趨勢', '7-Day Trend', '過去7日推移', '최근 7일 추이'],
  ['過去7日趨勢', '7-Day Trend', '過去7日推移', '최근 7일 추이'],
  ['全區間含未來預訂', 'All Time + Pre-orders', '全期間(予約含)', '전체(예약 포함)'],
  ['含未來預訂', 'Incl. Pre-orders', '予約含む', '예약 포함'],
  ['匯出 CSV', 'Export CSV', 'CSV出力', 'CSV 내보내기'],
  ['毛銷售額 vs 折扣讓利成本', 'Gross Sales vs Discount Cost', '総売上 vs 割引コスト', '총 매출 vs 할인 비용'],
  ['總折讓成本', 'Total Discounts', '割引合計', '총 할인액'],
  ['未收應收帳款', 'Unpaid Receivables', '未収売掛金', '미수금'],
  ['未來預訂', 'Future Pre-orders', '今後の予約', '향후 예약'],
  ['區間待收', 'Unpaid in Period', '期間内未収', '기간 내 미수'],
  ['目前即時出餐等候 / 產能負載', 'Live Wait Time / Kitchen Load', '現在の待ち時間・負荷率', '실시간 대기시간 / 주방 부하'],
  ['各時段真實實收營收', 'Real Paid Revenue by Period', '時間帯別実収売上', '시간대별 실매출'],
  ['點擊柱狀圖篩選明細', 'Click bar to filter orders', '棒グラフをクリックして絞込', '막대를 클릭하여 내역 필터'],
  ['已收款', 'Paid', '支払済', '결제 완료'],
  ['客單價', 'Avg Ticket', '客単価', '객단가'],
  ['菜單管理與智慧照片辨識', 'Menu & Smart OCR Import', 'メニュー管理・AI読取', '메뉴 관리 및 스마트 인식'],
  ['營業狀態・餐具收費與離峰優惠', 'Hours, Cutlery & Off-Peak Deals', '営業状態・容器代・割引', '영업상태・수저비・할인'],
  ['餐廳與校區管理', 'Store & Campus Info', '店舗・キャンパス管理', '매장 및 캠퍼스 관리'],
  ['推播設定・安全鎖與稽核紀錄', 'Alerts, Security & Audit Log', '通知・セキュリティ・履歴', '알림・보안・감사 로그'],
  ['切換店鋪：', 'Switch Store: ', '店舗切替：', '매장 전환: '],
  ['智慧視覺菜單辨識（支援拍照上傳與穩定品項 ID 匯入）', 'Smart Menu Photo Scanner (Stable Item ID Import)', 'メニュー写真AI読取（安定IDインポート）', '스마트 메뉴 사진 인식 (안정 ID 가져오기)'],
  ['上傳紙本菜單照片或貼上文字，系統將自動進行結構化解析並綁定確定性品項 ID，絕不破壞進行中訂單關聯。', 'Upload a menu photo or paste text to parse dishes with stable IDs without breaking active orders.', '紙メニューの写真またはテキストから自動解析し、既存注文を壊さず登録します。', '종이 메뉴 사진이나 텍스트를 업로드하면 기존 주문을 유지한 채 자동 등록합니다.'],
  ['拍照 / 上傳菜單圖片', 'Take / Upload Menu Photo', 'メニュー写真をアップロード', '메뉴 사진 촬영/업로드'],
  ['執行結構化解析與預覽', 'Parse & Preview Menu', '解析してプレビュー', '구조화 분석 및 미리보기'],
  ['載入範例新菜單測試', 'Load Sample Menu', 'サンプル読込', '샘플 메뉴 불러오기'],
  ['自動產生穩定品項 ID・支援每日限量', 'Auto Stable ID · Daily Limit Supported', '安定ID自動生成・1日限定数対応', '안정 ID 자동생성・일일 한정 지원'],
  ['確認完成本班日結並鎖定當日帳務 (防篡改)', 'Confirm Z-Report & Lock Shift (Tamper-Proof)', '本シフト精算確定・当日帳簿ロック', '교대 정산 확정 및 당일 장부 잠금'],
  ['尚無中途零用金支出或補入紀錄', 'No petty cash entries yet', '小口現金の入出金記録はありません', '소액 현금 입출금 내역이 없습니다'],
  ['如：買冰塊、買免洗袋、採買食材或臨時補零錢，自動計入錢箱應有現金', 'e.g. ice, bags, ingredients, or change refill — auto-applied to expected drawer cash', '例：氷・袋・食材購入や釣銭補充（理論残高に自動反映）', '예: 얼음, 봉투, 식자재 구매 또는 거스름돈 보충 (예상 현금 자동 반영)'],
  ['營業收款日：', 'Settlement Date: ', '営業精算日：', '정산 일자: '],
  ['出表時間：', 'Printed At: ', '出力時刻：', '출력 시간: '],
  ['值班人員：', 'Cashier: ', '担当者：', '담당자: '],
  ['當班收銀員', 'On-Duty Cashier', '当番スタッフ', '당번 캐셔'],
  ['當日收款單數：', 'Paid Orders Today: ', '本日精算件数：', '당일 결제 건수: '],
  ['平均客單價：', 'Avg Order Value: ', '平均客単価：', '평균 객단가: '],
  ['當日收款損益與代收費用拆解', 'Daily Revenue & Fee Breakdown', '本日売上・手数料内訳', '당일 매출 및 비용 내역'],
  ['餐點商品毛銷售額', 'Gross Food Sales', '商品総売上', '음식 총 매출'],
  ['一次性環保餐具費', 'Disposable Cutlery Fee', '使い捨てカトラリー代', '일회용 수저비'],
  ['離峰分流折扣讓利', 'Off-Peak Promo Discounts', 'オフピーク割引額', '오프피크 할인액'],
  ['櫃檯手動折讓/招待', 'Counter Discounts / Comps', '店頭手動割引・サービス', '카운터 수동 할인/무료'],
  ['當日實收淨營業額', 'Daily Net Paid Revenue', '本日実収純売上', '당일 실매출 순수익'],
  ['錢箱現金收付與盤點核對', 'Cash Drawer Reconciliation', 'レジ現金収支・点検照合', '현금 시재 정산 및 대조'],
  ['開店找零準備金 (零用金)', 'Opening Float (Petty Cash)', '開店釣銭準備金', '개점 시재 준비금'],
  ['現金交易顧客實收總額', 'Cash Tendered Total', '現金お預かり合計', '현금 수령 총액'],
  ['現金交易找零總額', 'Cash Change Given Total', 'お釣り支払合計', '거스름돈 지급 총액'],
  ['現金已收後退單退款', 'Cash Order Refunds', '現金注文返金', '현금 주문 환불'],
  ['現金營業淨入帳', 'Net Cash Sales', '現金純売上', '현금 순매출'],
  ['錢箱應有現金總額 (含零用金收支)', 'Expected Cash in Drawer (incl. Petty Cash)', 'レジ理論現金残高（小口現金込）', '예상 현금 시재 (소액 현금 포함)'],
  ['櫃檯實際清點現金', 'Actual Counted Cash', '実査現金合計', '실제 점검 현금'],
  ['盤點差額 (短溢)', 'Cash Variance', '現金過不足', '시재 과부족'],
  ['帳實相符', 'Balanced', '一致', '일치'],
  ['行動支付與無現金清點', 'Digital & Cashless Payments', 'キャッシュレス決済集計', '모바일・비현금 결제'],
  ['當日入帳', 'Settled Today', '当日入金', '당일 정산'],
  ['非現金支付小計', 'Cashless Subtotal', 'キャッシュレス小計', '비현금 소계'],
  ['退款、作廢與跨日預收履約對帳', 'Refunds, Voids & Cross-Day Pre-Orders', '返金・取消・事前決済照合', '환불・취소 및 사전결제 대조'],
  ['待收款訂單', 'Unpaid Orders', '未払い注文', '미결제 주문'],
  ['已付款後退單退款', 'Paid Order Refunds', '支払済返金', '결제 후 환불'],
  ['未付款取消作廢', 'Unpaid Cancelled', '未払い取消', '미결제 취소'],
  ['跨日預收今日取餐', 'Prepaid Earlier / Pickup Today', '事前決済・本日受取', '사전결제 오늘 픽업'],
  ['不重複入錢箱', 'Not counted in cash drawer', '現金重複計上なし', '현금 중복 미계산'],
  ['值班收銀員簽名：', 'Cashier Signature:', '担当者署名：', '캐셔 서명:'],
  ['店長覆核簽名：', 'Manager Approval:', '店長確認署名：', '점장 확인 서명:'],
  ['廚房分站過濾:', 'Kitchen Station:', 'ステーション:', '주방 파트:'],
  ['排序:', 'Sort:', '並び順:', '정렬:'],
  ['此日期 / 分站 / 篩選條件下目前沒有訂單', 'No orders match the current date / station / filter', '該当する注文はありません', '조건에 맞는 주문이 없습니다'],
  ['結構化單品營收佔比', 'Itemized Revenue Share', '品目別売上構成比', '품목별 매출 비중'],
  ['各時段 15 分鐘尖峰密度與候餐時間曲線', '15-Min Peak Load & Wait Time Curve', '時間帯別ピーク負荷・待ち時間推移', '시간대별 피크 부하・대기시간 추이'],
  ['商業財務與廚房排程診斷', 'Financial & Kitchen Capacity Insights', '財務・キッチン稼働診断', '재무 및 주방 스케줄 진단'],
  ['餐點總計', 'Total Items', '合計点数', '총 메뉴 수'],
  ['此區間無紀錄', 'No records in this period', 'データなし', '기록 없음'],
  ['餐點名稱', 'Dish Name', 'メニュー名', '메뉴 이름'],
  ['價格', 'Price', '価格', '가격'],
  ['推薦標籤', 'Tag', 'タグ', '추천 태그'],
  ['客製選項 (逗號分隔)', 'Options (comma-separated)', 'オプション (カンマ区切り)', '옵션 (쉼표 구분)'],
  ['新增', 'Add', '追加', '추가'],
  ['必點人氣', 'Popular', '人気', '인기'],
  ['主廚推薦', "Chef's Pick", 'おすすめ', '셰프 추천'],
  ['快速出餐', 'Express', 'スピード', '빠른 제공'],
  ['暖胃湯品', 'Hot Soup', '温かいスープ', '따뜻한 국'],
  ['人氣飲品', 'Popular Drink', '人気ドリンク', '인기 음료'],
  ['合計 ', 'Total ', '合計 ', '합계 '],
  ['合計', 'Total', '合計', '합계'],
  ['基礎 ', 'Base ', '基本 ', '기본 '],
  ['佇列 ', 'Queue ', '待機 ', '대기 '],
  ['分類', 'Category', 'カテゴリ', '카테고리'],
  ['預覽', 'Preview', 'プレビュー', '미리보기'],
  ['登記', 'Log', '登録', '등록'],
  ['狀態', 'Status', '状態', '상태'],
  [' 筆', ' orders', '件', '건'],
  [' 單', ' orders', '件', '건'],
  ['組選項', ' option groups', 'グループ', '개 옵션'],
  ['離峰分流招待：免費招牌冰紅茶', 'Off-Peak Deal: Free Iced Black Tea', 'オフピーク特典：アイス紅茶無料', '오프피크 혜택: 아이스 홍차 무료'],
  ['離峰分流招待：免費溫泉蛋乙顆', 'Off-Peak Deal: Free Onsen Egg', 'オフピーク特典：温泉卵無料', '오프피크 혜택: 온천계란 무료'],
  ['離峰分流招待：免費溏心溫泉蛋', 'Off-Peak Deal: Free Onsen Egg', 'オフピーク特典：温泉卵無料', '오프피크 혜택: 온천계란 무료'],
  ['離峰分流招待：', 'Off-Peak Freebie: ', 'オフピーク特典：', '오프피크 증정: '],
  ['離峰分流折抵：', 'Off-Peak Discount: ', 'オフピーク割引：', '오프피크 할인: '],
  ['離峰分流優惠：', 'Off-Peak Deal: ', 'オフピーク割引：', '오프피크 할인: '],
  ['離峰優惠：', 'Off-Peak Deal: ', 'オフピーク割引：', '오프피크 할인: '],
  ['全單現折', 'Order Off', '全品割引', '전체 할인'],
  ['滿額現折', 'Min Spend Off', '割引', '할인'],
  ['免費招待', 'Free Gift', '無料サービス', '무료 증정'],
  ['現折', 'Off', '割引', '할인'],
  ['已同步', 'Synced', '同期済', '동기화됨'],
  ['同步中...', 'Syncing...', '同期中...', '동기화 중...'],
  ['連線中', 'Live', '接続中', '연결됨'],
  ['離線中', 'Offline', 'オフライン', '오프라인'],
  ['份餐點', ' items', '点', '개'],
  ['・共 ', ' · Total ', '・計 ', ' · 총 '],
  [' 單', ' orders', '件', '건'],
  [' 分鐘', ' min', '分', '분'],
  [' 份', ' pcs', '点', '개']
].sort((a, b) => b[0].length - a[0].length);

const DOM_I18N_ORIGINALS = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
const DOM_ATTR_ORIGINALS = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

function translateSystemText(rawStr) {
  const s = String(rawStr == null ? '' : rawStr);
  const lang = (state && state.lang) || 'zh-TW';
  if (lang === 'zh-TW' || !s || !/[\u4e00-\u9fff]/.test(s)) return s;
  const idx = lang === 'en' ? 1 : (lang === 'ja' ? 2 : 3);
  let out = s;
  // 先套用 I18N_DICTIONARY 精確店名與分類
  for (const [zhKey, valObj] of Object.entries(I18N_DICTIONARY)) {
    if (out.includes(zhKey)) {
      const rep = typeof valObj === 'string' ? valObj : (valObj[lang] || valObj.en || zhKey);
      out = out.split(zhKey).join(rep);
    }
  }
  // 再套用全系統詞彙庫（最長詞優先）
  for (let i = 0; i < SYSTEM_UI_PHRASES.length; i++) {
    const row = SYSTEM_UI_PHRASES[i];
    if (out.includes(row[0])) {
      out = out.split(row[0]).join(row[idx] || row[1]);
    }
  }
  return out;
}

let _isTranslatingDom = false;
let _i18nObserverInstalled = false;

function ensureDomI18nObserver() {
  if (_i18nObserverInstalled || typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body) return;
  _i18nObserverInstalled = true;
  const obs = new MutationObserver(mutations => {
    if (_isTranslatingDom || !state || state.lang === 'zh-TW') return;
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (m.addedNodes && m.addedNodes.length > 0) {
        m.addedNodes.forEach(n => {
          if (n && (n.nodeType === 1 || n.nodeType === 3)) applyDomSystemTranslation(n);
        });
      }
    }
  });
  try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
}

function applyDomSystemTranslation(rootEl) {
  if (typeof document === 'undefined' || _isTranslatingDom) return;
  ensureDomI18nObserver();
  const target = rootEl || document.body;
  if (!target) return;
  const lang = (state && state.lang) || 'zh-TW';
  _isTranslatingDom = true;

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      const parent = node.parentNode;
      if (parent && parent.tagName && /^(SCRIPT|STYLE|CODE|TEXTAREA)$/i.test(parent.tagName)) return;
      if (parent && parent.dataset && (parent.dataset.noI18n === '1' || parent.dataset.dishName === '1')) return;
      const curVal = node.nodeValue || '';
      let orig = DOM_I18N_ORIGINALS ? DOM_I18N_ORIGINALS.get(node) : undefined;
      if (orig === undefined) {
        if (lang === 'zh-TW') return;
        orig = curVal;
        if (DOM_I18N_ORIGINALS) DOM_I18N_ORIGINALS.set(node, orig);
      }
      const nextVal = lang === 'zh-TW' ? orig : translateSystemText(orig);
      if (nextVal !== curVal) node.nodeValue = nextVal;
      return;
    }
    if (node.nodeType === 1) {
      if (/^(SCRIPT|STYLE|SVG)$/i.test(node.tagName || '')) return;
      if (node.dataset && (node.dataset.noI18n === '1' || node.dataset.dishName === '1')) return;
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
        ['placeholder', 'title'].forEach(attr => {
          const curA = node.getAttribute ? node.getAttribute(attr) : node[attr];
          if (!curA) return;
          let rec = DOM_ATTR_ORIGINALS ? DOM_ATTR_ORIGINALS.get(node) : null;
          if (!rec) { rec = {}; if (DOM_ATTR_ORIGINALS) DOM_ATTR_ORIGINALS.set(node, rec); }
          if (rec[attr] === undefined) {
            if (lang === 'zh-TW') return;
            rec[attr] = curA;
          }
          const nextA = lang === 'zh-TW' ? rec[attr] : translateSystemText(rec[attr]);
          if (nextA !== curA && node.setAttribute) node.setAttribute(attr, nextA);
        });
        return;
      }
      const kids = node.childNodes || [];
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    }
  }
  try { walk(target); } catch (e) {} finally { _isTranslatingDom = false; }
}

function trTerm(rawStr) {
  const s = String(rawStr || '');
  const lang = (state && state.lang) || 'zh-TW';
  if (lang === 'zh-TW') return s;
  const entry = I18N_DICTIONARY[s];
  if (entry) {
    if (typeof entry === 'string') return entry;
    return entry[lang] || entry.en || s;
  }
  if (s.includes('🔥')) return s.replace('必點人氣', t('必點人氣', 'Popular', '人気', '인기')).replace('店長推薦', t('店長推薦', "Chef's Pick", '店長おすすめ', '추천')).replace('招牌必點', t('招牌必點', 'Signature', '看板メニュー', '시그니처')).replace('銷量冠軍', t('銷量冠軍', 'Best Seller', '人気No.1', '베스트')).replace('排隊人氣', t('排隊人氣', 'Top Pick', '人気', '인기')).replace('現點現做', t('現點現做', 'Made to Order', '作りたて', '즉시 조리')).replace('經典酥脆', t('經典酥脆', 'Crispy Classic', 'サクサク定番', '바삭 클래식'));
  if (s.includes('⭐')) return s.replace('主廚推薦', t('主廚推薦', "Chef's Special", 'おすすめ', '셰프 추천')).replace('飽足首選', t('飽足首選', 'Hearty Choice', '満腹メニュー', '든든한 메뉴')).replace('限量供應', t('限量供應', 'Limited', '数量限定', '한정 수량')).replace('學生最愛', t('學生最愛', 'Student Favorite', '学生人気', '학생 인기'));
  if (s.includes('⚡')) return s.replace('快速出餐', t('快速出餐', 'Express', 'スピード提供', '빠른 제공')).replace('極速出餐', t('極速出餐', 'Express', 'スピード提供', '빠른 제공')).replace('極速便當', t('極速便當', 'Fast Bento', 'スピード弁当', '빠른 도시락')).replace('秒取', t('秒取', 'Fast Pickup', '即受取', '빠른 픽업'));
  return translateSystemText(s);
}

function trDishName(item) {
  if (!item) return '';
  const lang = (state && state.lang) || 'zh-TW';
  if (lang !== 'zh-TW' && item.nameEn && String(item.nameEn).trim()) {
    return String(item.nameEn).trim();
  }
  // 餐點名稱交由店家自行輸入 nameEn，不強制翻譯未設定英文名的自訂菜名
  return String(item.baseName || item.name || '');
}

function syncHeaderLanguageControls() {
  const lang = (state && state.lang) || 'zh-TW';
  const sel = document.getElementById('headerLangSelect');
  if (sel && sel.value !== lang) sel.value = lang;
  const legacyBtn = document.getElementById('headerLangToggleBtn');
  if (legacyBtn) {
    const labelMap = { 'zh-TW': '🌐 繁中', 'en': '🌐 EN', 'ja': '🌐 日本語', 'ko': '🌐 한국어' };
    legacyBtn.innerText = labelMap[lang] || '🌐 繁中';
  }
  const fAll = document.getElementById('filter-ALL');
  const fFast = document.getElementById('filter-FAST');
  const fPromo = document.getElementById('filter-PROMO');
  const btnLookup = document.getElementById('btnOpenOrderLookup');
  const btnAdvisor = document.getElementById('btnOpenAiAdvisor');
  if (fAll) fAll.innerText = t('全部櫃位', 'All', 'すべて', '전체');
  if (fFast) fFast.innerText = t('免排隊', 'Fast', '待ちなし', '빠른 픽업');
  if (fPromo) fPromo.innerText = t('離峰優惠', 'Deals', '割引', '할인');
  if (btnLookup) btnLookup.innerText = t('🔍 查單', '🔍 Lookup', '🔍 注文照会', '🔍 주문조회');
  if (btnAdvisor) btnAdvisor.innerText = t('✨ 選餐助手', '✨ Advisor', '✨ おすすめ', '✨ 추천');
  const myOrdersBtn = document.getElementById('headerMyOrdersBtn');
  if (myOrdersBtn) {
    const labelSpan = myOrdersBtn.querySelector ? myOrdersBtn.querySelector('span:first-child') : null;
    if (labelSpan) labelSpan.innerText = `🧾 ${t('我的訂單', 'Orders', '注文履歴', '주문내역')}`;
  }
  const railLabels = {
    'railBtn-pos': t('點餐', 'POS', 'レジ', '포스'),
    'railBtn-kds': t('訂單', 'Orders', '注文', '주문'),
    'railBtn-analytics': t('分析', 'Stats', '分析', '분석'),
    'railBtn-settings': t('設定', 'Settings', '設定', '설정')
  };
  Object.entries(railLabels).forEach(([id, lbl]) => {
    const btn = document.getElementById(id);
    if (btn && btn.querySelectorAll) {
      const spans = btn.querySelectorAll('span');
      if (spans[1]) spans[1].innerText = lbl;
    }
  });
  const headerEl = document.querySelector ? document.querySelector('.app-header') : null;
  if (headerEl) applyDomSystemTranslation(headerEl);
}

function setAppLanguage(nextLang) {
  const allowed = ['zh-TW', 'en', 'ja', 'ko'];
  state.lang = allowed.includes(nextLang) ? nextLang : 'zh-TW';
  try { localStorage.setItem('mealflow_lang', state.lang); } catch (e) {}
  syncHeaderLanguageControls();
  applyRouteView();
  updateCartUI();
  applyDomSystemTranslation(document.body);
  const msgMap = {
    'zh-TW': '🌐 已切換為繁體中文介面',
    'en': '🌐 Switched to English interface',
    'ja': '🌐 日本語インターフェースに切り替えました',
    'ko': '🌐 한국어 인터페이스로 변경되었습니다'
  };
  showToast(msgMap[state.lang] || msgMap['zh-TW']);
}

function toggleAppLanguage() {
  const order = ['zh-TW', 'en', 'ja', 'ko'];
  const idx = order.indexOf(state.lang || 'zh-TW');
  setAppLanguage(order[(idx + 1) % order.length]);
}

function normalizeMenuItem(m, fallbackStoreId) {
  let opts = m.options || {};
  if (typeof opts === 'string') {
    try { opts = JSON.parse(opts); } catch (e) { opts = {}; }
  }
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
    opts = {};
  }
  if (opts['__soldOut'] !== undefined) {
    delete opts['__soldOut'];
  }

  const nameStr = String(m.name || '招牌餐點').trim();
  const priceNum = Math.max(0, Number(m.price) || 0);
  const storeIdStr = String(m.storeId || fallbackStoreId || 'S02');
  const itemId = String(m.id || generateStableMenuItemId(storeIdStr, nameStr));

  let catStr = String(m.category || m.cat || '招牌主餐').replace(/\(八方計價模式\)|\(按顆計價\)/g, '').trim();
  let tagStr = String(m.tag || '').trim();
  let rawImg = String(m.image || '').trim();

  // 防護與修復舊版試算表欄位錯位 (例如 image 為 "true" / "false"、tag 為純數字出餐時間 "4"、category 為推薦標籤 "🔥 必點人氣")
  if (!/^(https?:\/\/|data:image\/)/i.test(rawImg)) {
    rawImg = '';
  }

  let defMatchedItem = null;
  for (const ds of DEFAULT_STORES) {
    const found = (ds.menus || []).find(dm => dm.id === itemId || dm.name === nameStr);
    if (found) {
      defMatchedItem = found;
      break;
    }
  }

  if (/^\d+$/.test(tagStr)) {
    if (defMatchedItem) {
      tagStr = defMatchedItem.tag || '';
      catStr = defMatchedItem.category || '招牌主餐';
      if (Object.keys(opts).length === 0 && defMatchedItem.options) {
        opts = JSON.parse(JSON.stringify(defMatchedItem.options));
      }
    } else if (/^[🔥⭐⚡🥣🥤🍗🍵🌶️🥛✨🧀🎁]/.test(catStr)) {
      tagStr = catStr;
      catStr = '招牌推薦';
    } else {
      tagStr = '';
    }
  }

  return {
    id: itemId,
    storeId: storeIdStr,
    category: catStr || '招牌主餐',
    name: nameStr,
    nameEn: String(m.nameEn || opts.__nameEn || '').trim(),
    price: priceNum,
    tag: tagStr,
    soldOut: Boolean(m.soldOut),
    dailyLimit: m.dailyLimit !== undefined && m.dailyLimit !== '' ? Math.max(0, parseInt(m.dailyLimit, 10) || 0) : 0,
    soldToday: m.soldToday !== undefined ? Number(m.soldToday) || 0 : 0,
    remainingToday: m.remainingToday !== undefined ? m.remainingToday : null,
    image: rawImg,
    options: opts
  };
}

function getStoreIconDisplay(store) {
  if (!store) return '🍱';
  const customIcon = String(store.icon || '').trim();
  if (customIcon) {
    if (/^(https?:\/\/|data:image\/|\.?\.?\/)/i.test(customIcon)) {
      return `<img src="${escapeHtml(customIcon)}" alt="${escapeHtml(store.name || '')}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;">`;
    }
    return escapeHtml(customIcon);
  }
  if (STORE_ICONS[store.id]) return STORE_ICONS[store.id];
  const text = `${store.name || ''} ${store.category || ''}`;
  if (text.includes('咖啡') || text.includes('飲') || text.includes('茶')) return '☕';
  if (text.includes('健康') || text.includes('蔬') || text.includes('輕食')) return '🥗';
  if (text.includes('飯捲') || text.includes('韓')) return '🍙';
  if (text.includes('水餃') || text.includes('鍋貼') || text.includes('遊龍')) return '🥟';
  if (text.includes('咖哩')) return '🍛';
  if (text.includes('涼麵') || text.includes('麵')) return '🍜';
  if (text.includes('鐵板') || text.includes('排')) return '🥩';
  if (text.includes('便當') || text.includes('廚房')) return '🍗';
  return '🍱';
}

function updateDynamicCampusSwitcherButtons() {
  const switcher = document.getElementById('headerCampusSwitcher');
  if (!switcher) return;
  const campuses = Array.from(new Set(state.stores.map(s => String(s.campus || '').trim()).filter(Boolean)));
  if (campuses.length === 0) return;
  if (!campuses.includes(state.campus)) {
    state.campus = campuses[0];
  }
  switcher.innerHTML = campuses.map(c => {
    const icon = c.includes('雙溪') ? '⛰️' : c.includes('城中') ? '🏙️' : '🏫';
    const label = state.lang === 'zh-TW' ? c : trTerm(c);
    return `<button type="button" id="btnCampus-${escapeHtml(c)}" class="campus-btn ${state.campus === c ? 'active' : ''}" onclick="switchCampus(${escapeJsAttr(c)})">${icon} ${escapeHtml(label)}</button>`;
  }).join('');
}

function enrichStoresAndAi() {
  autoPromoteScheduledOrdersToCooking();

  state.stores = state.stores.map(s => {
    const defStore = DEFAULT_STORES.find(d => d.id === s.id);
    const rawMenus = Array.isArray(s.menus)
      ? (s.menus.length > 0 || state.hasLoadedCloudStores ? s.menus : (defStore ? defStore.menus : []))
      : (defStore ? defStore.menus : []);
    const normalizedMenus = rawMenus.map(m => normalizeMenuItem(m, s.id));

    const isOpen = s.isOpen !== false;
    const cap = Math.max(5, Number(s.maxCapacityPer15Min) || 20);
    const storeBasePrep = Number(s.basePrepMinutes) || (defStore ? defStore.basePrepMinutes : 4);

    // 若學生端為最小權限模式（本機無全校他人訂單），優先使用雲端權威統計 activeOrders，否則合併本地計算
    const activeOrdersList = state.orders.filter(o => o.storeId === s.id && isOrderActivelyCookingNow(o));
    const liveCookingCount = activeOrdersList.filter(o => o.status === '製作中').length;
    const localWorkloadUnits = activeOrdersList.reduce((sum, o) => sum + calcOrderRemainingWorkloadUnits(o, cap), 0);

    const offset = s.baseQueueOffset !== undefined ? Math.max(0, Number(s.baseQueueOffset)) : 0;
    const serverReportedActive = (!state.isMerchantUnlocked && typeof s.serverActiveOrders === 'number')
      ? Math.max(0, s.serverActiveOrders)
      : 0;
    const activeWorkload = Math.max(serverReportedActive, Math.round((localWorkloadUnits + offset) * 10) / 10);
    const activeDisplayCount = Math.ceil(activeWorkload);

    const loadPct = isOpen ? Math.min(120, Math.round((activeWorkload / cap) * 100)) : 0;
    const theoreticalPrep = calcPrepMinutes(activeWorkload, cap, storeBasePrep);
    // #19：結合該店今日已完成／可取餐之真實歷史備餐耗時（滑動近 15 筆樣本）自我校正預估候餐時間
    const todayStrForPrep = getTodayDateStr();
    const recentActualDurations = state.orders
      .filter(o => o.storeId === s.id && normalizeDateStr(o.pickupDate || todayStrForPrep) === todayStrForPrep && Number(o.readyAtTs) > Number(o.cookingStartedAtTs || 0))
      .slice(0, 15)
      .map(o => Math.round((Number(o.readyAtTs) - Number(o.cookingStartedAtTs)) / 60000))
      .filter(mins => mins >= 2 && mins <= 35);
    const actualCalibratedPrepMin = recentActualDurations.length >= 2
      ? Math.round(recentActualDurations.reduce((a, b) => a + b, 0) / recentActualDurations.length)
      : null;
    const avgPrep = actualCalibratedPrepMin !== null
      ? Math.max(2, Math.round(theoreticalPrep * 0.65 + actualCalibratedPrepMin * 0.35))
      : theoreticalPrep;
    const cutleryPrice = s.cutleryPrice !== undefined && s.cutleryPrice !== '' ? Math.max(0, Number(s.cutleryPrice)) : 1;

    const draftObj = {
      ...s,
      icon: s.icon || '',
      openTime: s.openTime || '10:30',
      closeTime: s.closeTime || '19:30',
      breakStartTime: s.breakStartTime || '',
      breakEndTime: s.breakEndTime || '',
      closedDays: s.closedDays || [],
      isOpen,
      maxCapacityPer15Min: cap,
      basePrepMinutes: storeBasePrep,
      activeOrders: activeDisplayCount,
      activeWorkload,
      liveCookingCount,
      baseQueueOffset: offset,
      avgPrepMinutes: avgPrep,
      cutleryPrice,
      loadPercentage: loadPct,
      menus: normalizedMenus
    };

    // #21：以真實營業時間、午休時段、公休日與手動開關綜合判斷是否開放「立即製作」
    const bizStatus = getStoreBusinessHoursStatus(draftObj);
    let loadState = 'FREE';
    if (!bizStatus.canOrderNow) loadState = 'CLOSED';
    else if (loadPct >= 85) loadState = 'FULL';
    else if (loadPct >= 50) loadState = 'MODERATE';

    const obj = {
      ...draftObj,
      canOrderNow: bizStatus.canOrderNow,
      businessStatusReason: bizStatus.reasonCode,
      businessStatusLabel: bizStatus.statusLabel,
      businessShortPillText: bizStatus.shortPillText,
      loadState: loadState
    };
    obj.aiScore = calcAiUtilityScore(obj);
    return obj;
  });

  const recs = {};
  const campuses = Array.from(new Set(state.stores.map(s => String(s.campus || '').trim()).filter(Boolean)));
  if (campuses.length === 0) campuses.push('雙溪校區', '城中校區');

  campuses.forEach(campus => {
    const campusStores = state.stores.filter(s => s.campus === campus && s.canOrderNow !== false);
    const congested = campusStores
      .filter(s => s.loadState === 'FULL' || s.avgPrepMinutes >= 16)
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
      } else {
        recs[campus] = { hasAlert: false };
      }
    } else {
      recs[campus] = { hasAlert: false };
    }
  });
  state.aiRecommendations = recs;
  updateDynamicCampusSwitcherButtons();
}

/**
 * 【商業級改造 5 & #21】離峰分流優惠判定：
 * 若顧客選擇「預訂取餐」且取餐時段落在 11:45~12:45 尖峰區間，嚴格禁止套用離峰分流折扣與贈品！
 * 若選擇「立即製作」但店家處於非營業時間/午休中/公休，亦不啟用立即製作優惠。
 */
function isStorePromoActive(store, isReserveMode = false, reserveTimeStr = '') {
  if (!store || store.isOpen === false || store.promoMode === 'none' || store.loadState === 'FULL') {
    return false;
  }
  if (!isReserveMode && store.canOrderNow === false) {
    return false;
  }
  if (isReserveMode && isPeakHourTimeSlot(reserveTimeStr)) {
    return false;
  }
  return true;
}

// ==================== 震動、叮咚響鈴、語音播報、多分頁防重複響鈴、iOS/Android 背景保活與 Service Worker 自治系統通知 (#1, #11, #41) ====================
let sharedAudioContext = null;
let screenWakeLockSentinel = null;
let merchantBroadcastChannel = null;
let backgroundKeepAliveWorker = null;
let silentKeepAliveAudioEl = null;
let silentKeepAliveOscNode = null;

function hasActiveWatchedStudentOrders() {
  if (!state || !Array.isArray(state.orders)) return false;
  const watchedIds = new Set([state.trackingOrderId, state.myCreatedOrderId, ...(state.myOrderHistoryIds || [])].filter(Boolean));
  if (watchedIds.size === 0) return false;
  return state.orders.some(o => o && watchedIds.has(o.orderId) && o.status !== '已完成' && !String(o.status || '').includes('已取消'));
}

function shouldKeepBackgroundRuntimeAwake() {
  if (state.routeMode === 'board') return true;
  if (state.routeMode === 'store' && state.isMerchantUnlocked) return true;
  if (document.getElementById('customerPickupBoardModal')?.classList.contains('open')) return true;
  if (hasActiveWatchedStudentOrders()) return true;
  if (state.routeMode === 'ticket' && state.trackingOrderId) {
    const tracked = state.orders.find(o => o.orderId === state.trackingOrderId);
    if (!tracked || (tracked.status !== '已完成' && !String(tracked.status || '').includes('已取消'))) {
      return true;
    }
  }
  return false;
}

/**
 * #1 核心保活層 A：產生合法的 0.5 秒 8000Hz 8-bit 靜音 WAV Data URI，
 * 當學生有「進行中待取餐訂單」或店家開啟 KDS 時，於背景循環播放極低音量 (0.01) 靜音音軌。
 * 此機制使 iOS Safari (iPhone/iPad) 與 Android Chrome 將分頁視為活躍媒體階段，切換 App 或鎖屏 5~30 分鐘也不會凍結輪詢與響鈴！
 */
function buildSilentWavDataUri() {
  const sampleRate = 8000;
  const numSamples = 4000; // 0.5 sec
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit
  writeStr(36, 'data');
  view.setUint32(40, numSamples, true);
  for (let i = 0; i < numSamples; i++) {
    view.setUint8(44 + i, 128); // 8-bit PCM silence midpoint = 128
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

function updateBackgroundSilentAudioKeepAlive() {
  try {
    const needAwake = shouldKeepBackgroundRuntimeAwake();
    if (!needAwake) {
      if (silentKeepAliveAudioEl && !silentKeepAliveAudioEl.paused) {
        silentKeepAliveAudioEl.pause();
      }
      return;
    }
    if (!silentKeepAliveAudioEl) {
      silentKeepAliveAudioEl = new Audio(buildSilentWavDataUri());
      silentKeepAliveAudioEl.loop = true;
      silentKeepAliveAudioEl.volume = 0.01;
      silentKeepAliveAudioEl.setAttribute('playsinline', 'true');
    }
    if (silentKeepAliveAudioEl.paused) {
      silentKeepAliveAudioEl.play().catch(() => {});
    }
    if (sharedAudioContext && sharedAudioContext.state === 'running' && !silentKeepAliveOscNode) {
      const osc = sharedAudioContext.createOscillator();
      const gain = sharedAudioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1, sharedAudioContext.currentTime);
      gain.gain.setValueAtTime(0.0001, sharedAudioContext.currentTime);
      osc.connect(gain);
      gain.connect(sharedAudioContext.destination);
      osc.start();
      silentKeepAliveOscNode = osc;
    }
  } catch (e) {}
}

/**
 * #1 核心保活層 B：建立獨立 Web Worker 背景計時器 (不受主執行緒背景分頁 throttling 凍結影響)
 */
function initBackgroundKeepAliveWorker() {
  if (backgroundKeepAliveWorker || typeof Worker === 'undefined' || typeof Blob === 'undefined') return;
  try {
    const workerCode = `
      let timer = setInterval(() => {
        self.postMessage({ type: 'BG_WORKER_TICK', ts: Date.now() });
      }, 4500);
      self.onmessage = (e) => {
        if (e.data === 'FAST') {
          clearInterval(timer);
          timer = setInterval(() => self.postMessage({ type: 'BG_WORKER_TICK', ts: Date.now() }), 4500);
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    backgroundKeepAliveWorker = new Worker(URL.createObjectURL(blob));
    backgroundKeepAliveWorker.onmessage = () => {
      if (shouldKeepBackgroundRuntimeAwake() && navigator.onLine !== false) {
        syncWatchedOrdersToServiceWorker(true);
        const sinceLastSync = Date.now() - (state.lastCloudSyncDoneTs || 0);
        if (sinceLastSync >= 4000 && !state.isSyncInFlight) {
          syncCloud(false);
        }
      }
    };
  } catch (e) {}
}

/**
 * #1 核心保活層 C：即時將進行中訂單同步給 Service Worker (sw.js)，由 sw.js 背景執行緒獨立輪詢 GAS 並直接觸發系統通知
 */
async function syncWatchedOrdersToServiceWorker(sendPingOnly = false) {
  if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const targetSw = (reg && reg.active) || navigator.serviceWorker.controller;
    if (!targetSw) return;

    const allWatchedIds = Array.from(new Set([
      state.trackingOrderId,
      state.myCreatedOrderId,
      ...(state.myOrderHistoryIds || [])
    ].filter(Boolean)));

    // 篩選尚未完成且未取消之活躍訂單（加上當前正在查看的 trackingOrderId）
    const activeWatchedIds = allWatchedIds.filter(id => {
      const localOrd = state.orders.find(o => o.orderId === id);
      if (!localOrd) return true; // 若本機尚未載入該單，必須交給 SW 追蹤
      return localOrd.status !== '已完成' && !String(localOrd.status || '').includes('已取消');
    }).slice(0, 15);

    const knownStateMap = {};
    activeWatchedIds.forEach(id => {
      const ord = state.orders.find(o => o.orderId === id);
      const seen = state.lastSeenOrderNotifyMap[id];
      if (ord || seen) {
        knownStateMap[id] = {
          status: (seen && seen.status) || (ord && ord.status) || '製作中',
          notifyCount: Math.max(0, Number((seen && seen.notifyCount) ?? (ord && ord.notifyCount) ?? 0)),
          pickupNumber: (ord && ord.pickupNumber) || '',
          storeName: (ord && ord.storeName) || ''
        };
      }
    });

    const isStoreActive = state.routeMode === 'store' && isMerchantSessionValidNow();

    targetSw.postMessage({
      type: 'SYNC_WATCHED_ORDERS',
      gasUrl: GAS_URL,
      clientDeviceId: state.clientDeviceId,
      watchedOrderIds: activeWatchedIds,
      knownStateMap: knownStateMap,
      storeMode: isStoreActive,
      merchantAuthToken: isStoreActive ? (state.merchantAuthToken || sessionStorage.getItem('mealflow_merchant_session_v13') || '') : '',
      merchantStoreId: isStoreActive ? state.merchantStoreId : '',
      knownStoreOrderIds: isStoreActive ? Array.from(state.knownStoreOrderIds).slice(-200) : []
    });

    if (sendPingOnly) {
      targetSw.postMessage({ type: 'KEEP_ALIVE_PING' });
    }
  } catch (e) {}
}

function initMerchantBroadcastChannel() {
  if (merchantBroadcastChannel || typeof BroadcastChannel === 'undefined') return;
  try {
    merchantBroadcastChannel = new BroadcastChannel('mealflow_merchant_sync_v17');
    merchantBroadcastChannel.onmessage = (evt) => {
      const msg = evt.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ACK_KDS_ORDERS') {
        acknowledgeAllNewKdsOrders(msg.orderId || null, true);
      } else if (msg.type === 'CLOUD_BUNDLE_SYNCED' && msg.data && msg.tabId !== state.tabInstanceId) {
        // #11：同瀏覽器多分頁共享最新雲端同步資料，避免多分頁重複向 GAS 發起相同請求
        state.lastCloudSyncDoneTs = Date.now();
        applyCloudBundle(msg.data, true);
      }
    };
  } catch (e) {}
}

/**
 * #41 同裝置多分頁防重複響鈴鎖：
 * 利用 localStorage 時間戳記互斥鎖，確保開了多個店家分頁時，同一筆新單或同一輪 15 秒提醒只會由單一分頁發聲
 */
function acquireCrossTabSoundLock(lockKey, ttlMs = 8000) {
  try {
    const storageKey = 'mealflow_sound_lock_' + lockKey;
    const now = Date.now();
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.expiresAt > now && parsed.tabId !== state.tabInstanceId) {
        return false;
      }
    }
    if (!state.tabInstanceId) {
      state.tabInstanceId = 'TAB-' + Math.random().toString(36).slice(2, 10) + '-' + now;
    }
    localStorage.setItem(storageKey, JSON.stringify({
      tabId: state.tabInstanceId,
      expiresAt: now + ttlMs
    }));
    return true;
  } catch (e) {
    return true;
  }
}

/**
 * #1 委派 Service Worker 發出系統級通知（支援背景分頁、最小化與點擊通知自動聚焦對應訂單/後台）
 */
async function dispatchSystemSwNotification(title, body, tag, targetUrl, orderId = '', extraMeta = {}) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.active) {
        reg.active.postMessage({
          type: 'SHOW_SYSTEM_NOTIFICATION',
          title,
          body,
          tag,
          url: targetUrl || window.location.href,
          orderId,
          requireInteraction: true,
          ...extraMeta
        });
        return;
      }
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: './logo-icon.jpg',
          badge: './logo-icon.jpg',
          tag: tag || ('mealflow-' + Date.now()),
          renotify: true,
          requireInteraction: true,
          vibrate: [450, 150, 450, 150, 700],
          data: { url: targetUrl || window.location.href, orderId }
        });
        return;
      }
    }
    new Notification(title, { body, tag });
  } catch (e) {}
}

function ensureAudioContextUnlocked(playTestBeep = false) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioContext) {
      sharedAudioContext = new AudioCtx();
    }
    if (sharedAudioContext.state === 'suspended') {
      sharedAudioContext.resume().then(() => {
        state.isAudioUnlocked = (sharedAudioContext.state === 'running');
        updateMerchantAudioUnlockBanner();
        updateBackgroundSilentAudioKeepAlive();
      }).catch(() => {});
    } else if (sharedAudioContext.state === 'running') {
      state.isAudioUnlocked = true;
    }
    updateMerchantAudioUnlockBanner();
    updateBackgroundSilentAudioKeepAlive();
    if (playTestBeep && sharedAudioContext) {
      playPickupChime();
      showToast('🔊 已成功啟用即時鈴聲、語音播報與背景防休眠通知！');
    }
    return sharedAudioContext;
  } catch (e) {
    return null;
  }
}

/**
 * #41 瀏覽器音效 Autoplay 被阻擋時之醒目警示遮罩橫幅
 * 若店員重新整理網頁後尚未點擊畫面，AudioContext 會處於 suspended，此時在店家端頂部顯示強制點擊橫幅防止靜音漏單
 */
function updateMerchantAudioUnlockBanner() {
  let banner = document.getElementById('merchantAudioUnlockBanner');
  const isStoreUnlocked = (state.routeMode === 'store' && state.isMerchantUnlocked) || state.routeMode === 'board';
  const audioRunning = Boolean(sharedAudioContext && sharedAudioContext.state === 'running');
  state.isAudioUnlocked = audioRunning;

  if (!isStoreUnlocked || audioRunning || !state.kdsSoundEnabled) {
    if (banner) banner.style.display = 'none';
    return;
  }

  if (!banner) {
    const headerEl = document.querySelector('header.app-header');
    if (!headerEl) return;
    headerEl.insertAdjacentHTML('afterend', `
      <div id="merchantAudioUnlockBanner" onclick="ensureAudioContextUnlocked(true)" style="background:linear-gradient(90deg, #B91C1C 0%, #D97706 100%); color:#FFFFFF; padding:10px 16px; text-align:center; font-size:0.88rem; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(185,28,28,0.28); z-index:190; position:relative; display:flex; justify-content:center; align-items:center; gap:10px;">
        <span>🔇 瀏覽器接單/叫號鈴聲尚未解鎖（重整頁面後需點擊一次畫面才能發出聲音）</span>
        <span style="background:#FFFFFF; color:#B91C1C; padding:4px 12px; border-radius:999px; font-size:0.8rem; font-weight:950;">👉 點此立即啟用音效</span>
      </div>
    `);
  } else {
    banner.style.display = 'flex';
  }
}

/**
 * #1 & #2 螢幕防休眠鎖 (Screen Wake Lock)：
 * 不僅保護店家端 `/store/`，亦保護「叫號大看板 (`board`)」與「學生正在等候取餐 (`shouldKeepBackgroundRuntimeAwake()`)」的手機與平板不自動暗屏斷網
 */
async function requestMerchantWakeLock() {
  if (!('wakeLock' in navigator)) return;
  if (!shouldKeepBackgroundRuntimeAwake()) return;
  try {
    if (!screenWakeLockSentinel) {
      screenWakeLockSentinel = await navigator.wakeLock.request('screen');
      screenWakeLockSentinel.addEventListener('release', () => {
        screenWakeLockSentinel = null;
        if (document.visibilityState === 'visible' && shouldKeepBackgroundRuntimeAwake()) {
          setTimeout(() => requestMerchantWakeLock(), 1500);
        }
      });
    }
  } catch (e) {}
}

function playPickupChime() {
  try {
    const ctx = ensureAudioContextUnlocked();
    if (!ctx) return;
    const playTone = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.34, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const now = ctx.currentTime;
    playTone(659.25, now, 0.32);
    playTone(523.25, now + 0.32, 0.45);
    playTone(783.99, now + 0.9, 0.32);
    playTone(523.25, now + 1.22, 0.55);
  } catch (e) {}
}

function announceNewKdsOrder(order) {
  if (!order) return;
  state.unacknowledgedOrderIds.add(order.orderId);
  ensureUnacknowledgedOrderReminderLoop();

  const items = Array.isArray(order.structuredItems) ? order.structuredItems : [];
  const itemSummary = items.map(i => `${i.baseName || i.name} ${i.qty || 1}份`).join('、');

  // #41：跨分頁搶鎖，同一筆新進訂單只允許單一主分頁播放鈴聲、語音與系統通知
  if (!acquireCrossTabSoundLock('NEW_ORD_' + order.orderId, 12000)) {
    return;
  }

  // #1：同步透過 Service Worker 發出系統級新單通知，防止店家切換分頁或背景漏單
  dispatchSystemSwNotification(
    `🔔 新訂單進單 #${order.pickupNumber} (${order.storeName})`,
    `${itemSummary} ・ 應收 NT$${order.finalTotal} (${order.paymentMethod})`,
    `kds-new-${order.orderId}`,
    getStorePageUrl(`store=${encodeURIComponent(order.storeId)}&tab=kds`),
    order.orderId
  );

  if (!state.kdsSoundEnabled) return;
  playPickupChime();
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(`新訂單進單，取餐號 ${order.pickupNumber}，${itemSummary}`);
      utter.lang = 'zh-TW';
      utter.rate = 1.05;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }
}

function acknowledgeAllNewKdsOrders(orderId = null, fromBroadcast = false) {
  if (orderId) {
    state.unacknowledgedOrderIds.delete(orderId);
  } else {
    state.unacknowledgedOrderIds.clear();
  }
  if (state.unacknowledgedOrderIds.size === 0 && state.unackReminderTimer) {
    clearInterval(state.unackReminderTimer);
    state.unackReminderTimer = null;
  }
  if (!fromBroadcast && merchantBroadcastChannel) {
    try {
      merchantBroadcastChannel.postMessage({ type: 'ACK_KDS_ORDERS', orderId });
    } catch (e) {}
  }
  if (state.routeMode === 'store' && state.storeTabMode === 'kds') {
    const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
    if (store) renderMerchantOrdersOnly(store);
  }
}

function ensureUnacknowledgedOrderReminderLoop() {
  if (state.unackReminderTimer) return;
  state.unackReminderTimer = setInterval(() => {
    if (state.routeMode !== 'store' || !state.isMerchantUnlocked) return;
    // 自動清理已完成或非製作中的單
    Array.from(state.unacknowledgedOrderIds).forEach(oid => {
      const ord = state.orders.find(o => o.orderId === oid);
      if (!ord || ord.status !== '製作中' || ord.storeId !== state.merchantStoreId) {
        state.unacknowledgedOrderIds.delete(oid);
      }
    });
    if (state.unacknowledgedOrderIds.size === 0) {
      clearInterval(state.unackReminderTimer);
      state.unackReminderTimer = null;
      return;
    }
    if (state.kdsSoundEnabled && acquireCrossTabSoundLock('REMIND_' + state.merchantStoreId, 13500)) {
      playPickupChime();
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(`提醒您，廚房尚有 ${state.unacknowledgedOrderIds.size} 筆新進訂單待確認`);
          utter.lang = 'zh-TW';
          utter.rate = 1.05;
          window.speechSynthesis.speak(utter);
        } catch (e) {}
      }
    }
  }, 15000);
}

function setStudentAlertSoundMode(mode) {
  const allowed = ['CHIME', 'MUTE', 'VOICE'];
  state.studentAlertSoundMode = allowed.includes(mode) ? mode : 'CHIME';
  try { localStorage.setItem('mealflow_student_alert_mode', state.studentAlertSoundMode); } catch (e) {}
  if (state.studentAlertSoundMode !== 'MUTE') {
    ensureAudioContextUnlocked(true);
    updateBackgroundSilentAudioKeepAlive();
  }
  if (state.routeMode === 'ticket') renderSingleTicketView();
  const labelMap = {
    'CHIME': t('🔔 已設為「輕提示音＋震動」（不朗讀語音）', '🔔 Set to Chime & Vibrate (No Voice)', '🔔 チャイム＋振動（音声なし）', '🔔 알림음＋진동 (음성 없음)'),
    'MUTE': t('🔇 已設為「靜音僅震動與橫幅」（上課推薦）', '🔇 Set to Silent Vibrate Only', '🔇 サイレント振動のみ', '🔇 무음 진동 전용'),
    'VOICE': t('🗣️ 已設為「語音叫號播報＋提示音」', '🗣️ Set to Voice Announcement', '🗣️ 音声読み上げON', '🗣️ 음성 안내 ON')
  };
  showToast(labelMap[state.studentAlertSoundMode] || labelMap.CHIME);
}

function triggerStudentPickupAlert(order) {
  if (!order) return;
  const notifyCnt = Math.max(1, Number(order.notifyCount) || 1);
  const dedupKey = `STUDENT_PICKUP_${order.orderId}_${notifyCnt}`;
  if (!acquireCrossTabSoundLock(dedupKey, 4500)) {
    return;
  }

  const alertMode = state.studentAlertSoundMode || 'CHIME';

  try {
    if ('vibrate' in navigator) navigator.vibrate([450, 150, 450, 150, 700]);
  } catch (e) {}

  if (alertMode !== 'MUTE') {
    playPickupChime();
  }

  // #36：預設不自動開啟 TTS 語音朗讀避免課堂社死；僅當學生主動切換為「🗣️ 語音播報」模式才朗讀叫號
  if (alertMode === 'VOICE' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(`取餐通知，取餐號碼 ${order.pickupNumber} 號，您在 ${order.storeName || '學餐'} 點的餐點已經做好囉，請至櫃檯取餐`);
      utter.lang = 'zh-TW';
      utter.rate = 1.05;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  const verCodeText = formatVerificationCodeDisplay(order);
  const ticketUrl = getOrderPageUrl(`id=${encodeURIComponent(order.orderId)}&v=${encodeURIComponent(verCodeText)}`);

  // #1：透過 Service Worker 發出持久化系統通知（含震動與點擊喚醒，並同步更新 SW 的已通知計數避免重複彈窗）
  dispatchSystemSwNotification(
    `🔔 取餐號 #${order.pickupNumber} 餐點好囉！`,
    `【${order.storeName}】防偽核銷碼 ${verCodeText}，請前往櫃檯出示 QR Code 領取餐點。`,
    `pickup-ready-${order.orderId}-${notifyCnt}`,
    ticketUrl,
    order.orderId,
    {
      orderStatus: '可取餐',
      notifyCount: notifyCnt,
      pickupNumber: order.pickupNumber,
      storeName: order.storeName
    }
  );

  const modal = document.getElementById('pickupAlertModal');
  const content = document.getElementById('pickupAlertContent');
  if (modal && content) {
    const modeBadgeText = alertMode === 'MUTE'
      ? `📳 靜音震動提醒中（第 ${notifyCnt} 次呼叫）`
      : (alertMode === 'VOICE' ? `🗣️ 語音播報與震動呼叫中（第 ${notifyCnt} 次呼叫）` : `🔔 提示音與震動提醒中（第 ${notifyCnt} 次呼叫）`);
    content.innerHTML = `
      <div style="text-align:center; padding:12px 6px;">
        <div class="ring-bell-anim" style="font-size:3.6rem; margin-bottom:6px;">🔔</div>
        <div style="display:inline-block; background:var(--green-bg); color:var(--green); font-weight:900; font-size:0.82rem; padding:4px 12px; border-radius:999px; margin-bottom:8px;">
          ${modeBadgeText}
        </div>
        <h2 style="font-size:1.45rem; font-weight:900; color:var(--text-primary); margin-bottom:4px;">${t('您的餐點已經做好囉！', 'Your meal is ready!', 'ご注文が出来上がりました！', '주문하신 음식이 준비되었습니다!')}</h2>
        <p style="font-size:0.88rem; color:var(--text-secondary); margin-bottom:14px;">${t('請前往', 'Please pick up at')}「<strong>${escapeHtml(trTerm(order.storeName))}</strong>」${t('櫃檯出示核銷碼或 QR Code 自取', 'counter with your QR code')}</p>
        <div style="background:var(--green-bg); border:2px solid var(--green); border-radius:16px; padding:16px; margin-bottom:16px;">
          <div style="font-size:0.78rem; color:var(--green); font-weight:800;">${t('櫃檯自取號碼牌', 'Pickup Number', '受取番号', '픽업 번호')}</div>
          <div style="font-size:3.4rem; font-weight:900; color:var(--green); line-height:1.1;">#${escapeHtml(order.pickupNumber)}</div>
          <div style="margin-top:6px; font-size:0.84rem; font-weight:900; color:#065F46;">🛡️ ${t('防偽核銷碼', 'Code', '認証コード', '인증코드')}：${escapeHtml(verCodeText)}</div>
        </div>
        <button type="button" class="btn-tip-action" style="width:100%; background:var(--green); padding:14px; font-size:1rem;" onclick="closePickupAlertModal()">
          👌 ${t('我知道了，立即前往櫃檯領取', 'Got it, heading to counter', 'わかりました、受け取りに行きます', '확인, 픽업하러 가겠습니다')}
        </button>
      </div>
    `;
    modal.classList.add('open');
  }
}

function closePickupAlertModal() {
  const modal = document.getElementById('pickupAlertModal');
  if (modal) modal.classList.remove('open');
  try { if ('vibrate' in navigator) navigator.vibrate(0); } catch (e) {}
}

function requestBrowserNotificationPermission() {
  ensureAudioContextUnlocked(true);
  updateBackgroundSilentAudioKeepAlive();
  requestMerchantWakeLock();
  if (!('Notification' in window)) {
    showToast('🔊 已啟用背景防休眠語音叫號與震動提醒！（iPhone 建議點選分享 -> 加入主畫面以開啟橫幅推播）');
    if (state.routeMode === 'ticket') renderSingleTicketView();
    return;
  }
  try {
    Notification.requestPermission().then(perm => {
      syncWatchedOrdersToServiceWorker(true);
      if (state.routeMode === 'ticket') renderSingleTicketView();
      if (perm === 'granted') {
        showToast('✅ 已開啟取餐背景系統通知、防休眠語音播報與震動權限！');
        playPickupChime();
        try { if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]); } catch (e) {}
      } else {
        showToast('🔊 已啟用背景音軌保活與語音響鈴提醒！');
      }
    });
  } catch (e) {}
}

/**
 * 【商業級改造 7】廢除前端直接呼叫公開 sendLinePush 端點的資安漏洞！
 * 真實的 LINE 與 Email 推播已統一由雲端後端在 submitOrder / updateOrderStatus / cancelOrder 內部自動執行，
 * 前端此函式僅負責寫入本地推播紀錄匣供使用者檢視。
 */
function recordLocalPushNotificationLog(eventType, title, message, order = null) {
  const nowStr = getTaipeiTimeHHMMSS();
  const targetUserId = (order && order.lineUserId) || state.lineProfile.lineUserId || '';
  const targetEmail = (order && order.customerEmail) || state.lineProfile.email || '';
  const storeObj = order ? state.stores.find(s => s.id === order.storeId) : state.stores.find(s => s.id === state.selectedStoreId);
  const usingStoreCustomLine = Boolean(storeObj && storeObj.useCustomLineOa);
  const senderLabel = usingStoreCustomLine ? `${storeObj.name} 官方帳號` : 'MealFlow 官方通知';

  const channels = [];
  if (targetUserId && targetUserId.startsWith('U')) channels.push(`LINE (${targetUserId.slice(0, 8)}...)`);
  if (targetEmail && targetEmail.includes('@')) channels.push(`信箱 (${targetEmail})`);
  const recipient = channels.length > 0
    ? channels.join(' + ')
    : (order && order.customerPhone ? `手機 ${order.customerPhone}` : '尚未綁定');

  const logEntry = {
    id: 'LINE-' + Date.now() + '-' + Math.floor(Math.random() * 100),
    time: nowStr,
    eventType,
    title,
    message,
    senderLabel,
    recipient,
    orderId: order ? order.orderId : ''
  };

  state.lineMessageLogs.unshift(logEntry);
  saveLineLogs(state.lineMessageLogs);
}

function openLineBindModal() {
  const modal = document.getElementById('lineBindModal');
  if (!modal) return;

  const uidInput = document.getElementById('lineInputId');
  if (uidInput) uidInput.value = state.lineProfile.lineUserId || '';
  const nameInput = document.getElementById('lineInputName');
  if (nameInput) nameInput.value = state.lineProfile.lineDisplayName || '';
  const emailInput = document.getElementById('lineInputEmail');
  if (emailInput) emailInput.value = state.lineProfile.email || '';

  const statusBanner = document.getElementById('lineBindStatusBanner');
  if (statusBanner) {
    if (state.lineProfile.isBound && (state.lineProfile.lineUserId || state.lineProfile.email)) {
      statusBanner.innerHTML = `
        <div style="background:#DCFCE7; border:1.5px solid #22C55E; border-radius:10px; padding:10px 12px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <div style="font-size:0.84rem; font-weight:900; color:#166534;">✅ 已啟用通知：${escapeHtml(state.lineProfile.lineDisplayName || '顧客')}</div>
            ${state.lineProfile.lineUserId ? `<div style="font-size:0.72rem; color:#15803D; font-family:monospace;">識別碼: ${escapeHtml(state.lineProfile.lineUserId)}</div>` : ''}
            ${state.lineProfile.email ? `<div style="font-size:0.72rem; color:#15803D;">📧 信箱: ${escapeHtml(state.lineProfile.email)}</div>` : ''}
          </div>
          <button type="button" onclick="unbindLineAccount()" style="border:1px solid #DC2626; background:#FEF2F2; color:#DC2626; padding:5px 10px; border-radius:8px; font-size:0.74rem; font-weight:800;">解除綁定</button>
        </div>
      `;
    } else {
      statusBanner.innerHTML = '';
    }
  }

  renderLineLogsInModal();
  modal.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
}

function closeLineBindModal() {
  const modal = document.getElementById('lineBindModal');
  if (modal) modal.classList.remove('open');
}

function startLineOAuthLogin() {
  const activeStore = state.stores.find(s => s.id === (state.selectedStoreId || state.merchantStoreId));
  const useCustom = Boolean(activeStore && activeStore.useCustomLineOa && activeStore.customLineClientId);
  const clientId = useCustom
    ? activeStore.customLineClientId.trim()
    : (state.lineProfile.customClientId || DEFAULT_LINE_CLIENT_ID);

  const redirectUri = window.location.origin + window.location.pathname;
  const storeState = activeStore ? activeStore.id : 'SYSTEM';
  try {
    sessionStorage.setItem('mealflow_line_oauth_redirect', redirectUri);
    sessionStorage.setItem('mealflow_line_oauth_store', storeState);
  } catch (e) {}

  const authUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=bind_${encodeURIComponent(storeState)}&scope=profile%20openid`;
  window.location.href = authUrl;
}

async function checkLineOAuthCallbackOnLoad() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const oauthState = params.get('state') || '';
  if (!code || !oauthState.startsWith('bind')) return;

  const storeIdFromState = oauthState.includes('_') ? oauthState.split('_')[1] : (sessionStorage.getItem('mealflow_line_oauth_store') || '');
  const redirectUri = sessionStorage.getItem('mealflow_line_oauth_redirect') || (window.location.origin + window.location.pathname);

  showToast('⏳ 正在完成 LINE 帳號授權綁定...');
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'handleLineCallback',
        code,
        redirectUri,
        storeId: storeIdFromState
      })
    });
    const data = await res.json();
    if (data && data.status === 'success' && data.lineUid) {
      state.lineProfile.isBound = true;
      state.lineProfile.lineUserId = data.lineUid;
      state.lineProfile.lineDisplayName = data.displayName || 'LINE 用戶';
      saveLineProfile(state.lineProfile);
      applyRouteView();
      showToast(`🎉 LINE 綁定成功！歡迎 ${state.lineProfile.lineDisplayName}`);
    } else {
      showToast(`⚠️ LINE 授權換取失敗：${(data && data.message) || '請確認頻道編號與金鑰設定'}`);
    }
  } catch (e) {
    showToast('⚠️ 無法連線至後端交換授權憑證');
  } finally {
    params.delete('code');
    params.delete('state');
    params.delete('friendship_status_changed');
    const cleanSearch = params.toString();
    const cleanUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '');
    window.history.replaceState({}, '', cleanUrl);
  }
}

function saveLineBindConfig() {
  const name = document.getElementById('lineInputName')?.value.trim() || '顧客';
  const email = document.getElementById('lineInputEmail')?.value.trim() || '';
  const rawUid = document.getElementById('lineInputId')?.value.trim() || '';

  state.lineProfile.isBound = true;
  state.lineProfile.lineDisplayName = name;
  state.lineProfile.email = email;
  if (rawUid) state.lineProfile.lineUserId = rawUid;
  saveLineProfile(state.lineProfile);

  recordLocalPushNotificationLog(
    'BIND_SUCCESS',
    '💚 取餐通知設定已儲存',
    `已設定 ${name} 的取餐推播通知${email ? ` (信箱: ${email})` : ''}！當訂單成立或餐點製作完成時，雲端伺服器將自動推播通知您。`
  );
  openLineBindModal();
  applyRouteView();
  showToast('✅ 通知設定已儲存！');
}

function unbindLineAccount() {
  state.lineProfile.isBound = false;
  state.lineProfile.lineDisplayName = '';
  state.lineProfile.lineUserId = '';
  state.lineProfile.email = '';
  saveLineProfile(state.lineProfile);
  closeLineBindModal();
  applyRouteView();
  showToast('已解除通知綁定');
}

function renderLineLogsInModal() {
  const box = document.getElementById('lineLogsContainer');
  if (!box) return;
  if (state.lineMessageLogs.length === 0) {
    box.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:12px;">尚無推播紀錄</p>`;
    return;
  }
  box.innerHTML = state.lineMessageLogs.slice(0, 8).map(log => `
    <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px; padding:8px 12px; margin-bottom:6px; font-size:0.78rem;">
      <div style="display:flex; justify-content:space-between; font-weight:800; color:#166534;">
        <span>${escapeHtml(log.title)} <small style="color:#059669;">(${escapeHtml(log.senderLabel || '官方通知')})</small></span>
        <span>${escapeHtml(log.time)}</span>
      </div>
      <div style="color:#374151; margin-top:2px;">${escapeHtml(log.message)}</div>
    </div>
  `).join('');
}

// ==================== 共用 Modal 動態掛載引擎（含鏡頭掃描 Modal） ====================
function ensureSharedModalsMounted() {
  if (!document.getElementById('toast')) {
    document.body.insertAdjacentHTML('afterbegin', `<div id="toast" class="toast"></div>`);
  }
  if (!document.getElementById('analyticsChartTooltip')) {
    document.body.insertAdjacentHTML('afterbegin', `<div id="analyticsChartTooltip" class="chart-floating-tooltip"></div>`);
  }

  if (!document.getElementById('floatingCartBar')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="floatingCartBar" class="floating-cart-bar" style="display:none;">
        <div class="floating-cart-inner">
          <button type="button" id="viewCartBtn" class="btn-view-cart" onclick="openCartModal()" disabled>
            <span id="cartItemCountBadge" class="cart-count-pill">0 份</span>
            <span>🛒 查看購物車・選取餐與預訂時間</span>
            <span id="cartPreviewTotal" style="font-size:1.2rem; font-weight:900;">NT$ 0</span>
          </button>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('cartModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cartModal" class="modal-overlay bottom-sheet" onclick="if(event.target===this) closeCartModal()">
        <div class="modal-card">
          <div class="modal-header">
            <h2 style="font-size:1.3rem; font-weight:900; display:flex; align-items:center; gap:8px;">
              <span>🛒</span> 確認購物車明細與預訂設定
            </h2>
            <button type="button" onclick="closeCartModal()" style="border:none; background:#F3F4F6; width:36px; height:36px; border-radius:50%; font-size:1.2rem; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" style="background:var(--bg-page);" id="cartPageList"></div>
          <div class="modal-footer">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <span style="font-size:1.05rem; font-weight:800;">應付總計金額</span>
              <span id="cartModalTotal" style="font-size:1.55rem; font-weight:900; color:var(--red);">NT$ 0</span>
            </div>
            <button type="button" id="finalSubmitOrderBtn" class="btn-tip-action" style="width:100%; padding:15px; font-size:1.05rem;" onclick="submitStudentCartOrder()">
              確認餐點並送出訂單
            </button>
          </div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('optionsModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="optionsModal" class="modal-overlay" onclick="if(event.target===this) closeOptionsModal()">
        <div class="modal-card">
          <div class="modal-header">
            <div>
              <h3 style="font-size:1.2rem; font-weight:900;" id="optModalTitle">餐點名稱</h3>
              <div style="font-size:0.78rem; color:var(--text-secondary);" id="optModalSubtitle">基本價格</div>
            </div>
            <button type="button" onclick="closeOptionsModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-size:1.1rem; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="optModalContent"></div>
          <div class="modal-footer">
            <button type="button" id="confirmOptionsBtn" class="btn-tip-action" style="width:100%; padding:14px; font-size:1rem;" onclick="confirmOptionsModal()">
              確認加入
            </button>
          </div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('posCashNumpadModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="posCashNumpadModal" class="modal-overlay" style="z-index:1300;" onclick="if(event.target===this) closePosCashNumpadModal()">
        <div class="modal-card" style="max-width:420px;">
          <div class="modal-header">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);">櫃檯收銀數字鍵盤</span>
              <h3 style="font-size:1.15rem; font-weight:900;">🔢 點選輸入顧客實收金額</h3>
            </div>
            <button type="button" onclick="closePosCashNumpadModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="posCashNumpadBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('orderPayModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="orderPayModal" class="modal-overlay" onclick="if(event.target===this) closeOrderPayModal()">
        <div class="modal-card" style="max-width:440px;">
          <div class="modal-header">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);">櫃檯訂單收款與防呆結帳</span>
              <h3 style="font-size:1.15rem; font-weight:900;">💵 訂單收款與觸控找零</h3>
            </div>
            <button type="button" onclick="closeOrderPayModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="orderPayModalBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('kdsQrScannerModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="kdsQrScannerModal" class="modal-overlay" onclick="if(event.target===this) closeKdsCameraScannerModal()">
        <div class="modal-card" style="max-width:440px;">
          <div class="modal-header" style="background:#0F172A; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#34D399;">ISO/IEC 18004 光學條碼核銷</span>
              <h3 style="font-size:1.15rem; font-weight:900;">📷 掃描顧客電子取餐憑證 QR Code</h3>
            </div>
            <button type="button" onclick="closeKdsCameraScannerModal()" style="border:none; background:rgba(255,255,255,0.2); color:#fff; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="kdsQrScannerBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('lineBindModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="lineBindModal" class="modal-overlay" onclick="if(event.target===this) closeLineBindModal()">
        <div class="modal-card" style="max-width:500px;">
          <div class="modal-header" style="background:#06C755; color:#FFFFFF;">
            <div>
              <span style="font-size:0.7rem; font-weight:800; background:rgba(255,255,255,0.22); padding:2px 8px; border-radius:999px;">LINE 官方帳號與電子信箱即時通知</span>
              <h3 style="font-size:1.15rem; font-weight:900; margin-top:3px;">💬 綁定取餐推播通知</h3>
            </div>
            <button type="button" onclick="closeLineBindModal()" style="border:none; background:rgba(255,255,255,0.22); color:#fff; width:32px; height:32px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body">
            <div id="lineBindStatusBanner"></div>
            <div style="background:#F0FDF4; border:1.5px solid #86EFAC; border-radius:12px; padding:14px; margin-bottom:12px;">
              <div style="font-size:0.88rem; font-weight:900; color:#065F46; margin-bottom:6px;">
                📲 一鍵透過 LINE 帳號授權綁定
              </div>
              <p style="font-size:0.78rem; color:#047857; line-height:1.45; margin-bottom:10px;">
                點擊下方按鈕將跳轉至 LINE 官方授權畫面。當餐點製作完成或預訂需繳費時，雲端伺服器將自動推播通知卡給您！
              </p>
              <button type="button" class="btn-line" style="width:100%; justify-content:center; padding:11px; font-size:0.92rem;" onclick="startLineOAuthLogin()">
                🚀 使用 LINE 帳號一鍵授權綁定
              </button>
            </div>
            <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:12px; padding:12px; margin-bottom:12px;">
              <div style="font-size:0.8rem; font-weight:900; color:var(--text-primary); margin-bottom:8px;">
                📧 綁定電子信箱免費取餐通知 / 或手動填入識別碼
              </div>
              <div style="display:grid; grid-template-columns:1fr 1.3fr; gap:8px; margin-bottom:8px;">
                <div>
                  <label class="field-label">👤 顯示名稱</label>
                  <input type="text" id="lineInputName" class="select-input" placeholder="例如：王小明">
                </div>
                <div>
                  <label class="field-label">📧 電子信箱 (推薦綁定)</label>
                  <input type="email" id="lineInputEmail" class="select-input" placeholder="student@scu.edu.tw">
                </div>
              </div>
              <div style="margin-bottom:8px;">
                <label class="field-label">🆔 LINE 識別碼 (選填，若已用上方按鈕授權會自動帶入)</label>
                <input type="text" id="lineInputId" class="select-input" placeholder="U開頭之 33 碼識別碼">
              </div>
              <div style="display:flex; gap:8px;">
                <button type="button" class="btn-line" style="flex:1; justify-content:center; padding:9px;" onclick="saveLineBindConfig()">
                  💾 儲存通知設定
                </button>
                <button type="button" class="filter-chip" onclick="requestBrowserNotificationPermission()">
                  🔔 開啟網頁震動響鈴
                </button>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="font-size:0.84rem; color:#166534;">📬 最近推播紀錄匣</strong>
              <button type="button" onclick="unbindLineAccount()" style="border:none; background:transparent; color:var(--text-muted); font-size:0.74rem; text-decoration:underline; cursor:pointer;">解除綁定</button>
            </div>
            <div id="lineLogsContainer" style="max-height:140px; overflow-y:auto;"></div>
          </div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('pickupAlertModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="pickupAlertModal" class="modal-overlay" onclick="if(event.target===this) closePickupAlertModal()">
        <div class="modal-card" style="max-width:400px; border:3px solid var(--green);">
          <div class="modal-body" id="pickupAlertContent"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('menuEditModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="menuEditModal" class="modal-overlay" onclick="if(event.target===this) closeMenuEditModal()">
        <div class="modal-card" style="max-width:540px;">
          <div class="modal-header">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--indigo);">餐點規格與選項設定</span>
              <h3 style="font-size:1.18rem; font-weight:900;" id="menuEditModalTitle">✏️ 編輯餐點與客製化選項</h3>
            </div>
            <button type="button" onclick="closeMenuEditModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="menuEditModalBody"></div>
          <div class="modal-footer" style="display:flex; gap:10px;">
            <button type="button" class="btn-outline" style="flex:1;" onclick="closeMenuEditModal()">取消</button>
            <button type="button" class="btn-tip-action" style="flex:2;" onclick="saveEditedMenuItem()">💾 儲存餐點設定並同步雲端</button>
          </div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('receiptPrintModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="receiptPrintModal" class="modal-overlay" onclick="if(event.target===this) closeReceiptPrintModal()">
        <div class="modal-card" style="max-width:400px;">
          <div class="modal-header no-print">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);">80mm 熱感應出單機格式</span>
              <h3 style="font-size:1.12rem; font-weight:900;" id="receiptPrintModalTitle">🖨️ 廚房出單小票與日結單預覽</h3>
            </div>
            <button type="button" onclick="closeReceiptPrintModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="receiptPrintModalBody" style="background:#F1F5F9;"></div>
          <div class="modal-footer no-print" style="display:flex; gap:8px;">
            <button type="button" class="btn-outline" style="flex:1;" onclick="closeReceiptPrintModal()">關閉</button>
            <button type="button" class="btn-tip-action" style="flex:2; background:#0F172A;" onclick="window.print()">🖨️ 立即列印 80mm 單據</button>
          </div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('posTwoStepCheckoutModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="posTwoStepCheckoutModal" class="modal-overlay" style="z-index:1100;" onclick="if(event.target===this) closePosTwoStepCheckoutModal()">
        <div class="modal-card" style="max-width:480px;">
          <div class="modal-header" style="background:#0F172A; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#34D399;">櫃檯收銀確認・多元付款找零</span>
              <h3 style="font-size:1.15rem; font-weight:900;">💳 確認金額・收款找零與出單</h3>
            </div>
            <button type="button" onclick="closePosTwoStepCheckoutModal()" style="border:none; background:rgba(255,255,255,0.2); color:#fff; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="posTwoStepCheckoutBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('posHeldOrdersModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="posHeldOrdersModal" class="modal-overlay" onclick="if(event.target===this) closePosHeldOrdersModal()">
        <div class="modal-card" style="max-width:500px;">
          <div class="modal-header">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);">櫃檯掛單暫存佇列</span>
              <h3 style="font-size:1.15rem; font-weight:900;">⏸️ 暫存掛單清單（隨時取回結帳）</h3>
            </div>
            <button type="button" onclick="closePosHeldOrdersModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="posHeldOrdersBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('kdsModifyOrderModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="kdsModifyOrderModal" class="modal-overlay" onclick="if(event.target===this) closeKdsModifyOrderModal()">
        <div class="modal-card" style="max-width:520px;">
          <div class="modal-header" style="background:#1E293B; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#FBBF24;">未完成訂單修改與單品作廢</span>
              <h3 style="font-size:1.15rem; font-weight:900;" id="kdsModifyOrderTitle">✏️ 改單 / 單品作廢</h3>
            </div>
            <button type="button" onclick="closeKdsModifyOrderModal()" style="border:none; background:rgba(255,255,255,0.2); color:#fff; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="kdsModifyOrderBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('onlinePaymentModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="onlinePaymentModal" class="modal-overlay">
        <div class="modal-card" style="max-width:420px;">
          <div id="onlinePaymentHeader" class="payment-gateway-header linepay">
            <div>
              <div style="font-size:0.72rem; font-weight:800; opacity:0.9;">行動支付線上結帳收銀台</div>
              <h3 style="font-size:1.2rem; font-weight:900;" id="onlinePaymentTitle">LINE Pay 付款確認</h3>
            </div>
            <button type="button" onclick="cancelOnlinePaymentModal()" style="border:none; background:rgba(255,255,255,0.22); color:#fff; width:32px; height:32px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="onlinePaymentBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('myOrdersDrawerModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="myOrdersDrawerModal" class="modal-overlay bottom-sheet" onclick="if(event.target===this) closeMyOrdersDrawer()">
        <div class="modal-card" style="height:84vh;">
          <div class="modal-header">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);">支援雙重驗證跨裝置安全找回</span>
              <h3 style="font-size:1.2rem; font-weight:900;">🧾 我的點餐紀錄與跨裝置訂單查詢</h3>
            </div>
            <button type="button" onclick="closeMyOrdersDrawer()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" style="background:var(--bg-page);" id="myOrdersDrawerBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('storePinModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="storePinModal" class="modal-overlay">
        <div class="modal-card" style="max-width:400px;">
          <div class="modal-header" style="background:#0F172A; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#38BDF8;">雲端 HMAC 時效簽章驗證 (4碼)</span>
              <h3 style="font-size:1.15rem; font-weight:900;">🔒 店家營運管理授權驗證</h3>
            </div>
            <button type="button" onclick="exitStoreToStudentOrder()" style="border:none; background:rgba(255,255,255,0.18); color:#fff; padding:4px 10px; border-radius:8px; font-size:0.74rem; font-weight:800;">返回點餐頁</button>
          </div>
          <div class="modal-body" id="storePinModalBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('aiConciergeModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="aiConciergeModal" class="modal-overlay bottom-sheet" onclick="if(event.target===this) closeAiConciergeModal()">
        <div class="modal-card" style="max-width:620px;">
          <div class="modal-header" style="background:#0F172A; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#FDBA74;">MealFlow 智慧選餐與免排隊助手</span>
              <h3 style="font-size:1.12rem; font-weight:900; margin-top:2px;">✨ 依即時排隊狀況幫你快速選餐</h3>
            </div>
            <button type="button" onclick="closeAiConciergeModal()" style="border:none; background:rgba(255,255,255,0.18); color:#fff; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" style="background:#F8FAFC;">
            <div class="ai-chip-row" style="margin-bottom:10px;">
              <button type="button" class="filter-chip" style="font-size:0.78rem; padding:6px 11px;" onclick="askAiConcierge('我只剩 10 分鐘就要上課，推薦最快拿到的主餐')">⚡ 10分鐘內快取</button>
              <button type="button" class="filter-chip" style="font-size:0.78rem; padding:6px 11px;" onclick="askAiConcierge('預算 100 元以內、有分流優惠的超值正餐')">💰 100元內超值</button>
              <button type="button" class="filter-chip" style="font-size:0.78rem; padding:6px 11px;" onclick="askAiConcierge('運動完想吃高蛋白質的大份量肉食主餐')">🥩 高蛋白大份量</button>
              <button type="button" class="filter-chip" style="font-size:0.78rem; padding:6px 11px;" onclick="askAiConcierge('想吃韓式、椒麻或辣味，且不用排隊的餐點')">🌶️ 辣味免排隊</button>
            </div>
            <div style="display:flex; gap:8px; margin-bottom:10px;">
              <input type="text" id="aiUserQueryInput" class="select-input" style="flex:1; background:#FFFFFF;" placeholder="輸入想吃的口味、預算或「哪家最快？」..." onkeydown="if(event.key==='Enter') askAiConcierge()">
              <button type="button" class="btn-tip-action" onclick="askAiConcierge()">發送</button>
            </div>
            <div id="aiConciergeResponse" class="ai-response-card"></div>
          </div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('crossDeviceLookupModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="crossDeviceLookupModal" class="modal-overlay" onclick="if(event.target===this) closeCrossDeviceLookupModal()">
        <div class="modal-card" style="max-width:440px;">
          <div class="modal-header">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);">MealFlow 跨裝置查單</span>
              <h3 style="font-size:1.12rem; font-weight:900;">🔍 找回電子取餐憑證</h3>
            </div>
            <button type="button" onclick="closeCrossDeviceLookupModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="crossDeviceLookupBody"></div>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('appCustomDialogModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="appCustomDialogModal" class="modal-overlay" style="z-index:1600;" onclick="if(event.target===this) cancelAppCustomDialog()">
        <div class="modal-card app-dialog-card">
          <div class="modal-header" id="appDialogHeader">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);" id="appDialogEyebrow">MealFlow 系統確認</span>
              <h3 style="font-size:1.1rem; font-weight:900; margin-top:2px;" id="appDialogTitle">請確認操作</h3>
            </div>
            <button type="button" onclick="cancelAppCustomDialog()" style="border:none; background:#F3F4F6; width:32px; height:32px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="appDialogBody"></div>
          <div class="modal-footer" style="display:flex; gap:8px; justify-content:flex-end;" id="appDialogFooter"></div>
        </div>
      </div>
    `);
  }
}

// ==================== MealFlow 專屬品牌對話框系統（全面取代原生 prompt / confirm） ====================
function openAiConciergeModal() {
  ensureSharedModalsMounted();
  document.getElementById('aiConciergeModal')?.classList.add('open');
  setTimeout(() => document.getElementById('aiUserQueryInput')?.focus(), 100);
}

function closeAiConciergeModal() {
  document.getElementById('aiConciergeModal')?.classList.remove('open');
}

function openCrossDeviceLookupModal() {
  ensureSharedModalsMounted();
  const body = document.getElementById('crossDeviceLookupBody');
  if (body) {
    body.innerHTML = `
      <p style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:12px; line-height:1.5;">
        ${t('輸入「6 碼防偽核銷碼」即可直接找回訂單；或輸入「4 碼取餐號 + 手機末 3 碼」雙重驗證查詢。', 'Enter your 6-char verification code, or 4-digit pickup # with the last 3 digits of your phone.', '6桁の認証コード、または受取番号＋電話番号下3桁を入力してください。', '6자리 인증코드 또는 픽업번호+전화번호 뒷 3자리를 입력하세요.')}
      </p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div>
          <label class="field-label">${t('防偽核銷碼 或 4碼取餐號', 'Verification Code or Pickup #', '認証コード / 受取番号', '인증코드 또는 픽업번호')}</label>
          <input type="search" id="modalOrderLookupInput" class="select-input" placeholder="${t('例如：AB12CD 或 1008', 'e.g. AB12CD or 1008')}" value="${escapeHtml(state.studentLookupQuery)}" onkeydown="if(event.key==='Enter') submitModalCrossDeviceLookup()">
        </div>
        <div>
          <label class="field-label">${t('手機末 3 碼（使用取餐號查詢時填寫）', 'Phone Last 3 Digits (with Pickup #)', '電話番号下3桁（受取番号使用時）', '전화번호 뒷 3자리 (픽업번호 사용 시)')}</label>
          <input type="tel" id="modalOrderPhoneInput" maxlength="10" class="select-input" placeholder="${t('例如：456', 'e.g. 456')}" value="${escapeHtml(state.studentLookupPhoneLast3 || extractPhoneLast3(state.savedCustomerPhone))}" onkeydown="if(event.key==='Enter') submitModalCrossDeviceLookup()">
        </div>
        <button type="button" class="btn-tip-action" style="width:100%; padding:12px;" onclick="submitModalCrossDeviceLookup()">
          🔍 ${t('立即驗證並找回取餐單', 'Find My Order', '注文を検索', '주문 조회')}
        </button>
      </div>
    `;
  }
  document.getElementById('crossDeviceLookupModal')?.classList.add('open');
  setTimeout(() => document.getElementById('modalOrderLookupInput')?.focus(), 100);
}

function closeCrossDeviceLookupModal() {
  document.getElementById('crossDeviceLookupModal')?.classList.remove('open');
}

function submitModalCrossDeviceLookup() {
  const q = document.getElementById('modalOrderLookupInput')?.value || '';
  const p = document.getElementById('modalOrderPhoneInput')?.value || '';
  closeCrossDeviceLookupModal();
  searchOrderAcrossDevices(q, p);
}

function showAppConfirmModal(opts = {}) {
  ensureSharedModalsMounted();
  if (state.appDialogResolver) {
    try { state.appDialogResolver(null); } catch (e) {}
    state.appDialogResolver = null;
  }
  const title = opts.title || '確認操作';
  const message = opts.message || '';
  const confirmText = opts.confirmText || '確定';
  const cancelText = opts.cancelText || '取消';
  const danger = Boolean(opts.danger);

  return new Promise(resolve => {
    state.appDialogResolver = resolve;
    state.appDialogMode = 'confirm';
    state.appDialogFields = [];

    const eyebrow = document.getElementById('appDialogEyebrow');
    const titleEl = document.getElementById('appDialogTitle');
    const bodyEl = document.getElementById('appDialogBody');
    const footerEl = document.getElementById('appDialogFooter');

    if (eyebrow) eyebrow.innerText = danger ? 'MealFlow 安全確認' : 'MealFlow 操作確認';
    if (titleEl) titleEl.innerText = title;
    if (bodyEl) {
      bodyEl.innerHTML = `<div style="font-size:0.9rem; color:var(--text-primary); line-height:1.6; white-space:pre-line;">${escapeHtml(message)}</div>`;
    }
    if (footerEl) {
      footerEl.innerHTML = `
        <button type="button" class="btn-outline" style="flex:1; padding:10px 14px; font-weight:800;" onclick="cancelAppCustomDialog()">${escapeHtml(cancelText)}</button>
        <button type="button" class="${danger ? 'btn-danger-soft' : 'btn-tip-action'}" style="flex:1.4; padding:10px 14px; font-weight:900; ${danger ? 'background:#EF4444; color:#FFFFFF; border-color:#EF4444;' : ''}" onclick="resolveAppCustomDialog()">${escapeHtml(confirmText)}</button>
      `;
    }
    document.getElementById('appCustomDialogModal')?.classList.add('open');
    if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('appCustomDialogModal'));
  });
}

function showAppPromptModal(opts = {}) {
  ensureSharedModalsMounted();
  if (state.appDialogResolver) {
    try { state.appDialogResolver(null); } catch (e) {}
    state.appDialogResolver = null;
  }
  const title = opts.title || '請輸入資訊';
  const message = opts.message || '';
  const defaultValue = opts.defaultValue !== undefined ? String(opts.defaultValue) : '';
  const placeholder = opts.placeholder || '';
  const inputType = opts.inputType || 'text';
  const confirmText = opts.confirmText || '確定送出';
  const cancelText = opts.cancelText || '取消';
  const danger = Boolean(opts.danger);

  return new Promise(resolve => {
    state.appDialogResolver = resolve;
    state.appDialogMode = 'prompt';
    state.appDialogFields = [{ key: 'value', type: inputType }];

    const eyebrow = document.getElementById('appDialogEyebrow');
    const titleEl = document.getElementById('appDialogTitle');
    const bodyEl = document.getElementById('appDialogBody');
    const footerEl = document.getElementById('appDialogFooter');

    if (eyebrow) eyebrow.innerText = danger ? 'MealFlow 重要確認' : 'MealFlow 輸入視窗';
    if (titleEl) titleEl.innerText = title;
    if (bodyEl) {
      bodyEl.innerHTML = `
        ${message ? `<div style="font-size:0.86rem; color:var(--text-secondary); line-height:1.55; margin-bottom:12px; white-space:pre-line;">${escapeHtml(message)}</div>` : ''}
        <input type="${escapeHtml(inputType)}" id="appDialogField-value" class="select-input" style="font-size:0.94rem; padding:11px 12px;" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}" onkeydown="if(event.key==='Enter'){ event.preventDefault(); resolveAppCustomDialog(); }">
      `;
    }
    if (footerEl) {
      footerEl.innerHTML = `
        <button type="button" class="btn-outline" style="flex:1; padding:10px 14px; font-weight:800;" onclick="cancelAppCustomDialog()">${escapeHtml(cancelText)}</button>
        <button type="button" class="btn-tip-action" style="flex:1.4; padding:10px 14px; font-weight:900; ${danger ? 'background:#EF4444; box-shadow:none;' : ''}" onclick="resolveAppCustomDialog()">${escapeHtml(confirmText)}</button>
      `;
    }
    document.getElementById('appCustomDialogModal')?.classList.add('open');
    setTimeout(() => {
      const inp = document.getElementById('appDialogField-value');
      if (inp) { inp.focus(); if (inp.select) inp.select(); }
    }, 60);
  });
}

function showAppFormModal(opts = {}) {
  ensureSharedModalsMounted();
  if (state.appDialogResolver) {
    try { state.appDialogResolver(null); } catch (e) {}
    state.appDialogResolver = null;
  }
  const title = opts.title || '表單設定';
  const message = opts.message || '';
  const fields = Array.isArray(opts.fields) ? opts.fields : [];
  const confirmText = opts.confirmText || '確定儲存';
  const cancelText = opts.cancelText || '取消';

  return new Promise(resolve => {
    state.appDialogResolver = resolve;
    state.appDialogMode = 'form';
    state.appDialogFields = fields;

    const eyebrow = document.getElementById('appDialogEyebrow');
    const titleEl = document.getElementById('appDialogTitle');
    const bodyEl = document.getElementById('appDialogBody');
    const footerEl = document.getElementById('appDialogFooter');

    if (eyebrow) eyebrow.innerText = 'MealFlow 櫃檯表單';
    if (titleEl) titleEl.innerText = title;
    if (bodyEl) {
      bodyEl.innerHTML = `
        ${message ? `<div style="font-size:0.84rem; color:var(--text-secondary); line-height:1.5; margin-bottom:12px; white-space:pre-line;">${escapeHtml(message)}</div>` : ''}
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${fields.map((f, idx) => `
            <div>
              <label class="field-label">${escapeHtml(f.label || f.key)}</label>
              <input type="${escapeHtml(f.type || 'text')}" id="appDialogField-${escapeHtml(f.key)}" class="select-input" style="font-size:0.92rem; padding:10px 12px;" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} placeholder="${escapeHtml(f.placeholder || '')}" value="${escapeHtml(f.value !== undefined ? String(f.value) : '')}" onkeydown="if(event.key==='Enter'){ event.preventDefault(); ${idx === fields.length - 1 ? 'resolveAppCustomDialog()' : `document.getElementById('appDialogField-${escapeHtml(fields[idx + 1].key)}')?.focus()`}; }">
            </div>
          `).join('')}
        </div>
      `;
    }
    if (footerEl) {
      footerEl.innerHTML = `
        <button type="button" class="btn-outline" style="flex:1; padding:10px 14px; font-weight:800;" onclick="cancelAppCustomDialog()">${escapeHtml(cancelText)}</button>
        <button type="button" class="btn-tip-action" style="flex:1.4; padding:10px 14px; font-weight:900;" onclick="resolveAppCustomDialog()">${escapeHtml(confirmText)}</button>
      `;
    }
    document.getElementById('appCustomDialogModal')?.classList.add('open');
    setTimeout(() => {
      if (fields[0]) {
        const inp = document.getElementById(`appDialogField-${fields[0].key}`);
        if (inp) { inp.focus(); if (inp.select) inp.select(); }
      }
    }, 60);
  });
}

function resolveAppCustomDialog() {
  const modal = document.getElementById('appCustomDialogModal');
  const resolver = state.appDialogResolver;
  const mode = state.appDialogMode;
  const fields = state.appDialogFields || [];
  let result = true;
  if (mode === 'confirm') {
    result = true;
  } else if (mode === 'prompt') {
    result = String(document.getElementById('appDialogField-value')?.value ?? '');
  } else if (mode === 'form') {
    const obj = {};
    fields.forEach(f => {
      obj[f.key] = String(document.getElementById(`appDialogField-${f.key}`)?.value ?? '');
    });
    result = obj;
  }
  if (modal) modal.classList.remove('open');
  state.appDialogResolver = null;
  state.appDialogMode = null;
  state.appDialogFields = [];
  if (typeof resolver === 'function') resolver(result);
}

function cancelAppCustomDialog() {
  const modal = document.getElementById('appCustomDialogModal');
  const resolver = state.appDialogResolver;
  const mode = state.appDialogMode;
  if (modal) modal.classList.remove('open');
  state.appDialogResolver = null;
  state.appDialogMode = null;
  state.appDialogFields = [];
  if (typeof resolver === 'function') {
    resolver(mode === 'confirm' ? false : null);
  }
}

// ==================== 網址路由與智慧焦點保護 ====================
function getBaseRootUrl() {
  const path = window.location.pathname;
  if (path.includes('/order/') || path.endsWith('/order')) {
    return path.replace(/\/order\/?(index\.html)?$/, '/');
  }
  if (path.includes('/store/') || path.endsWith('/store')) {
    return path.replace(/\/store(?:\/S\d+)?\/?(index\.html)?$/i, '/');
  }
  return path.replace(/index\.html$/, '');
}

function getOrderPageUrl(queryStr = '') {
  const base = getBaseRootUrl();
  if (window.location.protocol === 'file:') {
    const sep = queryStr ? '&' + queryStr.replace(/^\?/, '') : '';
    return `${base}index.html?mode=order${sep}`;
  }
  const q = queryStr ? (queryStr.startsWith('?') ? queryStr : '?' + queryStr) : '';
  return `${base}order/${q}`;
}

function getStorePageUrl(queryStr = '') {
  const base = getBaseRootUrl();
  if (window.location.protocol === 'file:') {
    const sep = queryStr ? '&' + queryStr.replace(/^\?/, '') : '';
    return `${base}index.html?mode=store${sep}`;
  }
  const q = queryStr ? (queryStr.startsWith('?') ? queryStr : '?' + queryStr) : '';
  return `${base}store/${q}`;
}

function syncUrlStateWithHistory(usePush = false) {
  if (window.location.protocol === 'file:') return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (state.routeMode === 'board') {
      params.set('mode', 'board');
      params.set('store', state.merchantStoreId || 'S01');
      params.delete('id');
      params.delete('tab');
    } else if (state.routeMode === 'store') {
      if (params.get('mode') === 'board') params.set('mode', 'store');
      params.set('store', state.merchantStoreId || 'S01');
      params.set('tab', state.storeTabMode || 'pos');
      params.delete('id');
    } else if (state.routeMode === 'order') {
      params.delete('id');
      params.delete('tab');
      if (state.selectedStoreId) {
        params.set('store', state.selectedStoreId);
      } else if (!state.urlLockedStoreId) {
        params.delete('store');
      }
      if (state.campus) {
        params.set('campus', state.campus);
      }
    }
    const qs = params.toString();
    const nextUrl = window.location.pathname + (qs ? '?' + qs : '');
    const curUrl = window.location.pathname + window.location.search;
    if (nextUrl !== curUrl) {
      if (usePush) {
        window.history.pushState({ routeMode: state.routeMode, storeId: state.selectedStoreId || state.merchantStoreId, tab: state.storeTabMode }, '', nextUrl);
      } else {
        window.history.replaceState({ routeMode: state.routeMode, storeId: state.selectedStoreId || state.merchantStoreId, tab: state.storeTabMode }, '', nextUrl);
      }
    }
  } catch (e) {}
}

function detectRouteFromUrl() {
  const rawPath = window.location.pathname;
  const path = rawPath.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const forcedMode = window.MEALFLOW_DEFAULT_MODE || window.MEALFLOW_FORCED_ROUTE || params.get('mode');
  const orderToken = params.get('id') || params.get('order');
  const campusParam = params.get('campus');
  const tabParam = (params.get('tab') || '').toLowerCase();

  // 支援 ?store=S01、#S01 或 /store/S01 專屬店家路由 (#39)
  const pathStoreMatch = rawPath.match(/\/store\/(S\d{2,3})/i);
  const hashStoreMatch = (window.location.hash || '').match(/^#?(S\d{2,3})$/i);
  const urlStoreParam = (params.get('store') || (pathStoreMatch ? pathStoreMatch[1] : '') || (hashStoreMatch ? hashStoreMatch[1] : '')).toUpperCase();

  if (campusParam && state.stores.some(s => s.campus === campusParam)) {
    state.campus = campusParam;
  }
  if (urlStoreParam && state.stores.some(s => s.id === urlStoreParam)) {
    state.merchantStoreId = urlStoreParam;
    if (pathStoreMatch || hashStoreMatch || params.get('lock') === '1') {
      state.urlLockedStoreId = urlStoreParam;
    }
    try { localStorage.setItem('mealflow_last_merchant_store_id', urlStoreParam); } catch (e) {}
    const st = state.stores.find(s => s.id === urlStoreParam);
    if (st) state.campus = st.campus;
    if (!path.includes('/store') && forcedMode !== 'store' && forcedMode !== 'board') {
      state.selectedStoreId = urlStoreParam;
    }
  } else if (!urlStoreParam && !path.includes('/store') && forcedMode !== 'store') {
    // 若網址未帶 ?store=，則在點餐首頁顯示校區餐廳列表 (#39 支援上一頁返回列表)
    if (params.has('campus')) {
      state.selectedStoreId = null;
    }
  } else if (state.boundMerchantStoreId && state.stores.some(s => s.id === state.boundMerchantStoreId)) {
    state.merchantStoreId = state.boundMerchantStoreId;
  }

  if (['pos', 'kds', 'analytics', 'settings'].includes(tabParam)) {
    state.storeTabMode = tabParam;
  }

  if (forcedMode === 'board') {
    state.routeMode = 'board';
  } else if (orderToken) {
    state.routeMode = 'ticket';
    state.trackingOrderId = orderToken;
    addOrderToMyHistory(orderToken);
  } else if (path.includes('/store') || forcedMode === 'store') {
    state.routeMode = 'store';
  } else if (path.includes('/order') || forcedMode === 'order') {
    state.routeMode = 'order';
  } else {
    state.routeMode = 'portal';
  }
}

function navigateToOrderTicket(orderId) {
  addOrderToMyHistory(orderId);
  const targetUrl = getOrderPageUrl(`id=${encodeURIComponent(orderId)}`);
  try {
    window.history.pushState({ orderId }, '', targetUrl);
    state.routeMode = 'ticket';
    state.trackingOrderId = orderId;
    applyRouteView();
    syncWatchedOrdersToServiceWorker(true);
    updateBackgroundSilentAudioKeepAlive();
    requestMerchantWakeLock();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    window.location.href = targetUrl;
  }
}

function navigateToOrderMenu(storeId = null) {
  state.selectedStoreId = storeId;
  const qParts = [];
  if (storeId) qParts.push(`store=${encodeURIComponent(storeId)}`);
  if (state.campus) qParts.push(`campus=${encodeURIComponent(state.campus)}`);
  const targetUrl = getOrderPageUrl(qParts.join('&'));
  try {
    window.history.pushState({ storeId, campus: state.campus }, '', targetUrl);
    state.routeMode = 'order';
    state.trackingOrderId = null;
    applyRouteView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    window.location.href = targetUrl;
  }
}

window.addEventListener('popstate', () => {
  detectRouteFromUrl();
  applyRouteView();
});

function setSyncState(mode, text) {
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncText');
  if (dot) dot.className = 'sync-dot ' + (mode === 'syncing' ? 'syncing' : mode === 'offline' ? 'offline' : '');
  if (label) label.innerText = translateSystemText(text);
}

let toastTimer = null;
function showToast(msg) {
  const tEl = document.getElementById('toast');
  if (!tEl) return;
  tEl.innerText = translateSystemText(msg);
  tEl.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { tEl.style.display = 'none'; }, 3500);
}

function isUserEditingFormInput() {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
    if (active.type !== 'button' && active.type !== 'checkbox' && active.type !== 'radio') {
      return true;
    }
  }
  if (document.getElementById('menuEditModal')?.classList.contains('open')) return true;
  if (document.getElementById('onlinePaymentModal')?.classList.contains('open')) return true;
  if (document.getElementById('orderPayModal')?.classList.contains('open')) return true;
  if (document.getElementById('posCashNumpadModal')?.classList.contains('open')) return true;
  if (document.getElementById('kdsQrScannerModal')?.classList.contains('open')) return true;
  return false;
}

// ==================== Page Visibility 智慧輪詢、網路恢復重連與指數退避引擎 ====================
function scheduleAdaptiveCloudPoll() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.routeMode !== 'ticket' && state.routeMode !== 'store' && state.routeMode !== 'order' && state.routeMode !== 'board') {
    return;
  }

  const isFastWatch = shouldKeepBackgroundRuntimeAwake();
  const isHidden = document.visibilityState === 'hidden';
  const baseDelay = isFastWatch
    ? POLL_INTERVAL_ACTIVE_WATCH_MS
    : (isHidden ? POLL_INTERVAL_BACKGROUND_MS : POLL_INTERVAL_FOREGROUND_MS);
  const backoffFactor = Math.pow(1.5, Math.min(4, state.pollFailureCount || 0));
  const jitter = Math.floor(Math.random() * 600);
  const nextDelay = Math.min(POLL_MAX_BACKOFF_MS, Math.round(baseDelay * backoffFactor) + jitter);

  state.pollTimer = setTimeout(async () => {
    if (navigator.onLine !== false) {
      await syncCloud(false);
    } else {
      setSyncState('offline', '網路離線待命');
    }
    scheduleAdaptiveCloudPoll();
  }, nextDelay);
}

async function flushPendingMerchantOfflineOrders() {
  if (!isMerchantSessionValidNow()) return;
  const pendingList = state.orders.filter(o => o.isOfflinePending && !o.isSeedSample && !String(o.orderId || '').startsWith('ORD-DEMO-'));

  for (const ord of pendingList) {
    try {
      const store = state.stores.find(s => s.id === ord.storeId);
      const oldOfflineNum = String(ord.pickupNumber || '');
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'submitOrder',
          ...getMerchantAuthPayload(),
          ...ord,
          isOfflineSync: true,
          orderSource: ord.studentId || '🖥️ 現場POS',
          campus: store ? store.campus : state.campus,
          items: ord.structuredItems || []
        })
      });
      const data = await res.json();
      if (data && data.success && data.order) {
        const authNum = String(data.order.pickupNumber || ord.pickupNumber);
        // #25 & #44：若離線期間建立的單號與雲端線上單撞號而被重新編號，明確保留原離線單號並寫入稽核警示，防止店員與顧客手上的熱感紙單號對不上
        if (oldOfflineNum && authNum !== oldOfflineNum) {
          ord.originalOfflinePickupNumber = oldOfflineNum;
          recordMerchantAuditLog('離線補送單號防撞號調整', `原離線暫時單號 #${oldOfflineNum} 因雲端同號已佔用，自動調整為正式單號 #${authNum} (訂單 ${ord.orderId})`);
          showToast(`⚠️ 離線單 #${oldOfflineNum} 已同步雲端，因防撞號更新為 #${authNum}（KDS 已標註原單號）`);
        }
        ord.pickupNumber = authNum;
        ord.verificationCode = String(data.order.verificationCode || '');
        ord.isOfflinePending = false;
        syncLocalSeqWithAuthoritativeNumber(ord.storeId, ord.pickupDate, ord.pickupNumber);
      }
    } catch (e) {
      break;
    }
  }
  saveCachedOrders(state.orders);

  // 補送離線期間累積的訂單狀態變更 / 收款 / 退單佇列 (B3)
  if (Array.isArray(state.pendingOrderMutationsQueue) && state.pendingOrderMutationsQueue.length > 0) {
    const remaining = [];
    for (let i = 0; i < state.pendingOrderMutationsQueue.length; i++) {
      const item = state.pendingOrderMutationsQueue[i];
      try {
        const res = await fetch(GAS_URL, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            ...item.payload,
            ...getMerchantAuthPayload()
          })
        });
        const data = await res.json();
        if (!data || !data.success) {
          // 若伺服器明確拒絕（如已退單），不再重試
          delete state.pendingLocalOrdersMap[item.orderId];
        } else {
          delete state.pendingLocalOrdersMap[item.orderId];
        }
      } catch (netErr) {
        remaining.push(...state.pendingOrderMutationsQueue.slice(i));
        break;
      }
    }
    state.pendingOrderMutationsQueue = remaining;
    savePendingOrderMutationsQueue(state.pendingOrderMutationsQueue);
  }
}

function registerPwaServiceWorker() {
  if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;
  const swPath = getBaseRootUrl() + 'sw.js';
  navigator.serviceWorker.register(swPath).then(() => {
    setTimeout(() => syncWatchedOrdersToServiceWorker(true), 800);
  }).catch(() => {});
  // #1：監聽來自 Service Worker 通知點擊與背景自治輪詢發現之「可取餐 / 新進訂單」即時推播訊息
  navigator.serviceWorker.addEventListener('message', (evt) => {
    const msg = evt.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'NOTIFICATION_CLICKED') {
      if (msg.orderId && state.routeMode !== 'store') {
        navigateToOrderTicket(msg.orderId);
      } else if (state.routeMode === 'store') {
        syncCloud(false);
      }
    } else if (msg.type === 'SW_ORDER_READY_ALERT' && msg.order) {
      const cleanOrd = sanitizeIncomingOrder(msg.order);
      if (cleanOrd) {
        const idx = state.orders.findIndex(o => o.orderId === cleanOrd.orderId);
        if (idx >= 0) state.orders[idx] = { ...state.orders[idx], ...cleanOrd };
        else state.orders.unshift(cleanOrd);
        saveCachedOrders(state.orders);
        state.lastSeenOrderNotifyMap[cleanOrd.orderId] = {
          status: '可取餐',
          notifyCount: Math.max(1, Number(cleanOrd.notifyCount) || 1)
        };
        triggerStudentPickupAlert(cleanOrd);
        if (state.routeMode === 'ticket') renderSingleTicketView();
        if (state.routeMode === 'order') renderStudentOrderExperience();
      }
    } else if (msg.type === 'SW_NEW_KDS_ORDER' && msg.order) {
      syncCloud(false);
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.routeMode === 'store' && state.isMerchantUnlocked && state.merchantHiddenSinceTs > 0) {
      // #2：若目前正開啟「叫號大螢幕看板」，不觸發背景自動上鎖，避免電視看板斷線
      const isBoardModalOpen = Boolean(document.getElementById('customerPickupBoardModal')?.classList.contains('open'));
      const hiddenElapsedMs = Date.now() - state.merchantHiddenSinceTs;
      state.merchantHiddenSinceTs = 0;
      if (!isBoardModalOpen && hiddenElapsedMs > Math.min(3 * 60 * 1000, state.merchantAutoLockMinutes * 60 * 1000)) {
        lockMerchantSession('畫面切換背景逾時，系統已自動上鎖保護');
        return;
      }
    }
    state.pollFailureCount = 0;
    requestMerchantWakeLock();
    updateBackgroundSilentAudioKeepAlive();
    syncWatchedOrdersToServiceWorker(true);
    syncCloud(false);
    scheduleAdaptiveCloudPoll();
  } else {
    if (state.routeMode === 'store' && state.isMerchantUnlocked) {
      state.merchantHiddenSinceTs = Date.now();
    }
    updateBackgroundSilentAudioKeepAlive();
    syncWatchedOrdersToServiceWorker(true);
    scheduleAdaptiveCloudPoll();
  }
});

window.addEventListener('online', () => {
  state.pollFailureCount = 0;
  showToast('🌐 網路已恢復連線，正在同步雲端最新訂單狀態...');
  flushPendingMerchantOfflineOrders().then(() => syncCloud(false));
  scheduleAdaptiveCloudPoll();
});

window.addEventListener('offline', () => {
  setSyncState('offline', '網路已中斷');
  showToast('⚠️ 偵測到網路中斷，線上結帳需恢復網路後方可送出');
});

window.addEventListener('DOMContentLoaded', () => {
  registerPwaServiceWorker();
  initMerchantBroadcastChannel();
  initBackgroundKeepAliveWorker();

  // 使用者首次點擊或觸控畫面時自動解鎖 Web Audio、背景靜音保活音軌、語音引擎與防休眠 Wake Lock (#1, #41)
  const unlockMediaAndWakeLock = () => {
    state.lastMerchantActivityTs = Date.now();
    ensureAudioContextUnlocked(false);
    updateBackgroundSilentAudioKeepAlive();
    requestMerchantWakeLock();
    syncWatchedOrdersToServiceWorker(true);
  };
  document.addEventListener('pointerdown', unlockMediaAndWakeLock, { passive: true });
  document.addEventListener('keydown', unlockMediaAndWakeLock, { passive: true });
  document.addEventListener('touchstart', unlockMediaAndWakeLock, { passive: true });

  // 閒置自動上鎖巡檢器 (A8 & #2)：當店家後台解鎖且超過設定分鐘數無任何操作時自動鎖定（開啟叫號看板時豁免上鎖）
  setInterval(() => {
    if (state.routeMode === 'store' && state.isMerchantUnlocked) {
      const isBoardModalOpen = Boolean(document.getElementById('customerPickupBoardModal')?.classList.contains('open'));
      if (isBoardModalOpen) {
        state.lastMerchantActivityTs = Date.now();
        return;
      }
      const idleLimitMs = Math.max(1, Number(state.merchantAutoLockMinutes) || 15) * 60 * 1000;
      if (Date.now() - (state.lastMerchantActivityTs || Date.now()) > idleLimitMs) {
        lockMerchantSession(`已閒置超過 ${state.merchantAutoLockMinutes} 分鐘，POS 已自動上鎖保護`);
      }
    }
  }, 15000);

  ensureSharedModalsMounted();
  detectRouteFromUrl();
  state.orders.forEach(o => {
    state.knownStoreOrderIds.add(o.orderId);
    state.lastSeenOrderNotifyMap[o.orderId] = {
      status: o.status,
      notifyCount: Number(o.notifyCount) || 0
    };
  });
  applyRouteView();
  updateCartUI();
  checkLineOAuthCallbackOnLoad();
  syncWatchedOrdersToServiceWorker(true);
  syncCloud(false);

  // #24 修復：支援實體鍵盤操作數字鍵盤 (PIN 解鎖視窗、POS 現金找零視窗、KDS 收款視窗與 Esc 關閉)
  window.addEventListener('keydown', (evt) => {
    const activeEl = document.activeElement;
    const isTypingInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
    if (isTypingInput && evt.key !== 'Escape') return;

    if (document.getElementById('storePinModal')?.classList.contains('open')) {
      if (/^\d$/.test(evt.key)) {
        evt.preventDefault();
        tapStorePinKey(evt.key);
      } else if (evt.key === 'Backspace') {
        evt.preventDefault();
        tapStorePinKey('BACK');
      } else if (evt.key === 'Enter' && state.pinInputBuffer.length >= 4) {
        evt.preventDefault();
        submitStorePinAuth();
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        exitStoreToStudentOrder();
      }
      return;
    }

    if (document.getElementById('posCashNumpadModal')?.classList.contains('open')) {
      if (/^\d$/.test(evt.key)) {
        evt.preventDefault();
        posTapNumpad(evt.key);
      } else if (evt.key === 'Backspace') {
        evt.preventDefault();
        posTapNumpad('BACK');
      } else if (evt.key === 'Enter' || evt.key === 'Escape') {
        evt.preventDefault();
        closePosCashNumpadModal();
      }
      return;
    }

    if (document.getElementById('orderPayModal')?.classList.contains('open')) {
      if (/^\d$/.test(evt.key)) {
        evt.preventDefault();
        orderPayTapKey(evt.key);
      } else if (evt.key === 'Backspace') {
        evt.preventDefault();
        orderPayTapKey('BACK');
      } else if (evt.key === 'Enter') {
        evt.preventDefault();
        confirmOrderPayment();
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        closeOrderPayModal();
      }
    }
  });

  if (state.liveClockTimer) clearInterval(state.liveClockTimer);
  state.liveClockTimer = setInterval(() => {
    const clockEl = document.getElementById('ticketAntiFraudClock');
    if (clockEl) {
      clockEl.textContent = getTaipeiTimeHHMMSS();
    }
    const boardClockEl = document.getElementById('pickupBoardLiveClock');
    if (boardClockEl) {
      boardClockEl.textContent = getTaipeiTimeHHMMSS();
    }
  }, 1000);
});

// ==================== 雲端權威同步與最小權限原則 (`applyCloudBundle`) ====================
function checkAndAlertWatchedStudentOrders() {
  const watchedIds = new Set([state.trackingOrderId, state.myCreatedOrderId, ...(state.myOrderHistoryIds || [])].filter(Boolean));
  if (watchedIds.size === 0 || state.routeMode === 'store' || state.routeMode === 'board') return;

  const todayStr = getTodayDateStr();
  watchedIds.forEach(wId => {
    const myOrd = state.orders.find(o => o.orderId === wId);
    if (!myOrd) return;
    if (normalizeDateStr(myOrd.pickupDate || todayStr) !== todayStr) return;

    const prev = state.lastSeenOrderNotifyMap[myOrd.orderId];
    const curCount = Math.max(0, Number(myOrd.notifyCount) || (myOrd.status === '可取餐' ? 1 : 0));

    let becameReady = false;
    if (!prev) {
      // 首次載入時若該單剛轉為可取餐，紀錄狀態；若先前已在製作中則會在轉態時觸發
      state.lastSeenOrderNotifyMap[myOrd.orderId] = { status: myOrd.status, notifyCount: curCount };
    } else {
      becameReady = (prev.status !== '可取餐' && myOrd.status === '可取餐') ||
                    (myOrd.status === '可取餐' && curCount > (prev.notifyCount || 0));
      state.lastSeenOrderNotifyMap[myOrd.orderId] = { status: myOrd.status, notifyCount: curCount };
    }

    if (becameReady) {
      triggerStudentPickupAlert(myOrd);
    }
  });
}

function applyCloudBundle(data, fromBroadcast = false) {
  const payload = (data && data.bundle) ? data.bundle : data;
  if (!payload) return;

  // #18：同步伺服器時間偏移量 (Server Time Offset Calibration)，確保前端倒數、候餐與跨日判定與伺服器完全一致
  if (payload.serverTimeTs && Number(payload.serverTimeTs) > 1700000000000) {
    state.serverTimeOffsetMs = Number(payload.serverTimeTs) - Date.now();
  }

  if (payload.slotQuotaMap && typeof payload.slotQuotaMap === 'object') {
    state.slotQuotaMap = payload.slotQuotaMap;
  }
  if (payload.storeQueueProgressMap && typeof payload.storeQueueProgressMap === 'object') {
    state.storeQueueProgressMap = payload.storeQueueProgressMap;
  }

  // #13 & #45：合併雲端稽核紀錄、交班日結鎖定狀態與中途零用金收支紀錄
  if (Array.isArray(payload.merchantAuditLogs) && payload.merchantAuditLogs.length > 0) {
    const existingKeys = new Set((state.merchantAuditLogs || []).map(l => `${l.ts}_${l.action}_${l.detail}`));
    const mergedLogs = [...(state.merchantAuditLogs || [])];
    payload.merchantAuditLogs.forEach(cl => {
      if (!cl) return;
      const k = `${cl.ts}_${cl.action}_${cl.detail}`;
      if (!existingKeys.has(k)) {
        existingKeys.add(k);
        mergedLogs.push(cl);
      }
    });
    mergedLogs.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    state.merchantAuditLogs = mergedLogs.slice(0, 120);
    try { localStorage.setItem('mealflow_audit_logs_v15', JSON.stringify(state.merchantAuditLogs)); } catch (e) {}
  }

  if (payload.lockedShiftsMap && typeof payload.lockedShiftsMap === 'object' && state.merchantStoreId) {
    if (!state.lockedShiftsMap) state.lockedShiftsMap = {};
    state.lockedShiftsMap[state.merchantStoreId] = {
      ...(state.lockedShiftsMap[state.merchantStoreId] || {}),
      ...payload.lockedShiftsMap
    };
    Object.entries(payload.lockedShiftsMap).forEach(([dStr, lockRec]) => {
      try {
        localStorage.setItem(`mealflow_shift_locked_${state.merchantStoreId}_${dStr}`, JSON.stringify(lockRec));
      } catch (e) {}
    });
  }

  if (payload.openShiftsMap && typeof payload.openShiftsMap === 'object' && state.merchantStoreId) {
    if (!state.openShiftsMap) state.openShiftsMap = {};
    state.openShiftsMap[state.merchantStoreId] = {
      ...(state.openShiftsMap[state.merchantStoreId] || {}),
      ...payload.openShiftsMap
    };
    Object.entries(payload.openShiftsMap).forEach(([dStr, openRec]) => {
      try {
        localStorage.setItem(`mealflow_shift_opened_${state.merchantStoreId}_${dStr}`, JSON.stringify(openRec));
      } catch (e) {}
    });
  }

  if (payload.pettyCashMap && typeof payload.pettyCashMap === 'object' && state.merchantStoreId) {
    if (!state.pettyCashMap) state.pettyCashMap = {};
    state.pettyCashMap[state.merchantStoreId] = {
      ...(state.pettyCashMap[state.merchantStoreId] || {}),
      ...payload.pettyCashMap
    };
    Object.entries(payload.pettyCashMap).forEach(([dStr, entries]) => {
      try {
        localStorage.setItem(`mealflow_petty_cash_${state.merchantStoreId}_${dStr}`, JSON.stringify(entries));
      } catch (e) {}
    });
  }

  const nowTs = Date.now();
  const isRecentLocalStoreEdit = (nowTs - state.lastLocalStoreConfigUpdateTs) < 12000;

  const cloudStores = Array.isArray(payload.stores) ? payload.stores : [];
  if (cloudStores.length > 0 && !isRecentLocalStoreEdit) {
    state.hasLoadedCloudStores = true;
    try { localStorage.setItem('mealflow_has_cloud_stores_v14', '1'); } catch (e) {}
    state.stores = cloudStores.map(cloudStore => {
      const localMatch = state.stores.find(s => s.id === cloudStore.id);
      return {
        ...cloudStore,
        icon: cloudStore.icon || (localMatch ? localMatch.icon : '') || '',
        openTime: cloudStore.openTime || (localMatch ? localMatch.openTime : '') || '10:30',
        closeTime: cloudStore.closeTime || (localMatch ? localMatch.closeTime : '') || '19:30',
        breakStartTime: cloudStore.breakStartTime !== undefined ? cloudStore.breakStartTime : (localMatch ? localMatch.breakStartTime : ''),
        breakEndTime: cloudStore.breakEndTime !== undefined ? cloudStore.breakEndTime : (localMatch ? localMatch.breakEndTime : ''),
        closedDays: cloudStore.closedDays !== undefined ? cloudStore.closedDays : (localMatch ? localMatch.closedDays : []),
        serverActiveOrders: Number(cloudStore.activeOrders || 0),
        isOpen: cloudStore.isOpen !== undefined
          ? Boolean(cloudStore.isOpen)
          : (localMatch && localMatch.isOpen !== undefined ? Boolean(localMatch.isOpen) : true),
        baseQueueOffset: cloudStore.baseQueueOffset !== undefined
          ? Number(cloudStore.baseQueueOffset)
          : (localMatch ? (localMatch.baseQueueOffset || 0) : 0),
        cutleryPrice: cloudStore.cutleryPrice !== undefined
          ? Number(cloudStore.cutleryPrice)
          : (localMatch && localMatch.cutleryPrice !== undefined ? Number(localMatch.cutleryPrice) : 1),
        useCustomLineOa: cloudStore.useCustomLineOa !== undefined
          ? Boolean(cloudStore.useCustomLineOa)
          : Boolean(localMatch && localMatch.useCustomLineOa),
        customLineClientId: cloudStore.customLineClientId || (localMatch ? localMatch.customLineClientId : '') || '',
        customLineClientSecret: '',
        customLineChannelToken: '',
        linePayChannelId: cloudStore.linePayChannelId || (localMatch ? localMatch.linePayChannelId : '') || '',
        hasLinePaySecret: cloudStore.hasLinePaySecret !== undefined ? Boolean(cloudStore.hasLinePaySecret) : Boolean(localMatch && localMatch.hasLinePaySecret),
        linePaySandbox: cloudStore.linePaySandbox !== undefined ? Boolean(cloudStore.linePaySandbox) : (localMatch && localMatch.linePaySandbox !== undefined ? Boolean(localMatch.linePaySandbox) : true),
        menus: Array.isArray(cloudStore.menus)
          ? cloudStore.menus.map(cm => {
              const localMenu = localMatch && Array.isArray(localMatch.menus)
                ? localMatch.menus.find(lm => String(lm.id) === String(cm.id))
                : null;
              return {
                ...cm,
                soldOut: cm.soldOut !== undefined ? Boolean(cm.soldOut) : Boolean(localMenu && localMenu.soldOut)
              };
            })
          : (localMatch ? localMatch.menus : [])
      };
    });
    saveLocalStores(state.stores);
  }

  const cloudOrders = Array.isArray(payload.orders)
    ? payload.orders
    : (Array.isArray(payload.recentOrders) ? payload.recentOrders : null);

  if (cloudOrders) {
    const mergedMap = new Map();

    cloudOrders.forEach(rawOrd => {
      if (isCorruptedOrMockOrder(rawOrd)) return;
      const o = sanitizeIncomingOrder(rawOrd);
      if (isCorruptedOrMockOrder(o)) return;
      const deletedTs = state.locallyDeletedOrderIds[o.orderId];
      if (deletedTs && (nowTs - deletedTs < 45000)) return;
      mergedMap.set(o.orderId, o);
    });

    state.orders.forEach(localOrd => {
      if (isCorruptedOrMockOrder(localOrd)) return;
      const deletedTs = state.locallyDeletedOrderIds[localOrd.orderId];
      if (deletedTs && (nowTs - deletedTs < 45000)) return;

      if (!mergedMap.has(localOrd.orderId)) {
        const pendingTs = state.pendingLocalOrdersMap[localOrd.orderId] || 0;
        const isRecentPending = (nowTs - pendingTs) < 60000;
        const isMyOwnWatchedOrder = state.myOrderHistoryIds.includes(localOrd.orderId) || state.trackingOrderId === localOrd.orderId;
        if (isRecentPending || Boolean(localOrd.isOfflinePending) || isMyOwnWatchedOrder) {
          mergedMap.set(localOrd.orderId, sanitizeIncomingOrder(localOrd));
        }
      } else {
        const cloudOrd = mergedMap.get(localOrd.orderId);
        // 僅在本地剛操作完 15 秒內的樂觀鎖期間才允許本地 notifyCount 覆蓋雲端，否則一律以雲端 notifyCount 為準，確保店員再次叫號能觸發學生端通知
        const isLocalMutationPending = (nowTs - (state.pendingLocalOrdersMap[localOrd.orderId] || 0)) < 15000;
        if (isLocalMutationPending && (Number(localOrd.notifyCount) || 0) > (Number(cloudOrd.notifyCount) || 0)) {
          cloudOrd.notifyCount = localOrd.notifyCount;
        }
        if (localOrd.paymentStatus === '已付款') {
          cloudOrd.paymentStatus = '已付款';
        }
        if (localOrd.createdAtTs && !cloudOrd.createdAtTs) {
          cloudOrd.createdAtTs = localOrd.createdAtTs;
        }
        if (localOrd.readyAtTs && !cloudOrd.readyAtTs) {
          cloudOrd.readyAtTs = localOrd.readyAtTs;
        }
        if (localOrd.originalOfflinePickupNumber && !cloudOrd.originalOfflinePickupNumber) {
          cloudOrd.originalOfflinePickupNumber = localOrd.originalOfflinePickupNumber;
        }
        if (localOrd.customerPhone && !localOrd.customerPhone.includes('*') && (!cloudOrd.customerPhone || cloudOrd.customerPhone.includes('*'))) {
          cloudOrd.customerPhone = localOrd.customerPhone;
        }
      }
    });

    const newOrdersList = Array.from(mergedMap.values());

    if (state.routeMode === 'store' && state.isMerchantUnlocked) {
      newOrdersList.forEach(ord => {
        if (!state.knownStoreOrderIds.has(ord.orderId)) {
          state.knownStoreOrderIds.add(ord.orderId);
          if (ord.storeId === state.merchantStoreId && ord.status === '製作中') {
            announceNewKdsOrder(ord);
          }
        }
      });
    } else {
      newOrdersList.forEach(ord => state.knownStoreOrderIds.add(ord.orderId));
    }

    state.orders = newOrdersList;
    saveCachedOrders(state.orders);
    checkAndAlertWatchedStudentOrders();
  }

  // #2：每次雲端資料同步後，若叫號看板彈窗開啟中或處於獨立電視看板路由 (?mode=board)，立即動態重繪看板並對新出餐單號響鈴！
  refreshCustomerPickupBoardIfOpen(true);
  syncWatchedOrdersToServiceWorker(false);
  updateBackgroundSilentAudioKeepAlive();

  if (!fromBroadcast && merchantBroadcastChannel) {
    try {
      merchantBroadcastChannel.postMessage({
        type: 'CLOUD_BUNDLE_SYNCED',
        tabId: state.tabInstanceId,
        data: data
      });
    } catch (e) {}
  }
}

/**
 * #1 關鍵後端相容補抓器：
 * 當學生在 iPhone / Android 平板點餐後，若雲端部署的 initBundle 處於最小權限且未回傳該學生的進行中訂單 (cloudOrdersArr 為空)，
 * 自動針對學生本機所有「進行中未結單 (製作中 / 已接單待排程 / 可取餐)」逐筆呼叫 getOrder 拉取最新雲端狀態與 notifyCount！
 * 徹底解決因 initBundle 未帶回訂單導致本機永遠停在舊「製作中」狀態而不響鈴的問題！
 */
async function pollActiveWatchedOrdersDirectFallback(watchedIds, cloudOrdersArr) {
  if (state.routeMode === 'store' || state.routeMode === 'board') return false;
  const returnedIdSet = new Set((cloudOrdersArr || []).map(o => String(o && o.orderId)));
  const todayStr = getTodayDateStr();

  const missingActiveIds = (watchedIds || []).filter(id => {
    if (!id || returnedIdSet.has(String(id))) return false;
    const localOrd = state.orders.find(o => o.orderId === id);
    if (!localOrd) return id === state.trackingOrderId;
    if (normalizeDateStr(localOrd.pickupDate || todayStr) !== todayStr) return false;
    return localOrd.status !== '已完成' && !String(localOrd.status || '').includes('已取消');
  }).slice(0, 4);

  if (missingActiveIds.length === 0) return false;

  let anyUpdated = false;
  await Promise.all(missingActiveIds.map(async (ordId) => {
    try {
      const localOrd = state.orders.find(o => o.orderId === ordId);
      const verCode = (localOrd && localOrd.verificationCode && localOrd.verificationCode !== '******') ? localOrd.verificationCode : '';
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'getOrder',
          orderId: ordId,
          v: verCode,
          clientDeviceId: state.clientDeviceId
        })
      });
      const data = await res.json();
      if (data && data.success && data.order) {
        const freshOrd = sanitizeIncomingOrder(data.order);
        if (freshOrd) {
          const idx = state.orders.findIndex(o => o.orderId === freshOrd.orderId);
          if (idx >= 0) {
            // 保留本機完整電話與防偽碼
            if (state.orders[idx].customerPhone && !state.orders[idx].customerPhone.includes('*') && (!freshOrd.customerPhone || freshOrd.customerPhone.includes('*'))) {
              freshOrd.customerPhone = state.orders[idx].customerPhone;
            }
            if (state.orders[idx].verificationCode && state.orders[idx].verificationCode !== '******' && (!freshOrd.verificationCode || freshOrd.verificationCode === '******')) {
              freshOrd.verificationCode = state.orders[idx].verificationCode;
            }
            state.orders[idx] = freshOrd;
          } else {
            state.orders.unshift(freshOrd);
          }
          anyUpdated = true;
        }
      }
    } catch (e) {}
  }));

  if (anyUpdated) {
    saveCachedOrders(state.orders);
    checkAndAlertWatchedStudentOrders();
    syncWatchedOrdersToServiceWorker(false);
  }
  return anyUpdated;
}

async function recoverStoreOrdersIfInitBundleEmpty() {
  if (state.routeMode !== 'store' || !state.isMerchantUnlocked) return false;
  const storeNumMatch = String(state.merchantStoreId || 'S01').match(/(\d+)/);
  const storeDigit = storeNumMatch ? parseInt(storeNumMatch[1], 10) : 1;
  const baseNum = storeDigit * 1000;
  // 針對尚未更新 GAS 後端版本時，透過已授權 lookupOrders 自動補回該店近期單號 (如 1001~1015)
  const probeNums = Array.from({ length: 15 }, (_, i) => String(baseNum + i + 1));
  try {
    const results = await Promise.all(
      probeNums.map(q =>
        fetch(GAS_URL, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'lookupOrders',
            ...getMerchantAuthPayload(),
            query: q
          })
        }).then(r => r.json()).catch(() => null)
      )
    );
    const recovered = [];
    const seen = new Set(state.orders.map(o => o.orderId));
    results.forEach(d => {
      if (d && Array.isArray(d.orders)) {
        d.orders.forEach(rawOrd => {
          const clean = sanitizeIncomingOrder(rawOrd);
          if (clean && !isCorruptedOrMockOrder(clean) && !seen.has(clean.orderId)) {
            seen.add(clean.orderId);
            recovered.push(clean);
            syncLocalSeqWithAuthoritativeNumber(clean.storeId, clean.pickupDate, clean.pickupNumber);
          }
        });
      }
    });
    if (recovered.length > 0) {
      state.orders = [...recovered, ...state.orders];
      saveCachedOrders(state.orders);
      return true;
    }
  } catch (e) {}
  return false;
}

async function syncCloud(showSuccessToast = false) {
  if (state.isSyncInFlight && !showSuccessToast) return;
  state.isSyncInFlight = true;

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  setSyncState('syncing', '同步中...');
  try {
    const authPayload = (state.routeMode === 'store' && isMerchantSessionValidNow())
      ? { ...getMerchantAuthPayload(), storeId: state.merchantStoreId }
      : {};

    // 【最小權限原則】學生端主動帶入自己的 myOrderIds，讓後端只回傳該學生本人的訂單狀態
    const watchedIds = Array.from(new Set([state.trackingOrderId, state.myCreatedOrderId, ...state.myOrderHistoryIds].filter(Boolean))).slice(0, 30);

    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'initBundle',
        campus: state.campus,
        myOrderIds: watchedIds,
        clientDeviceId: state.clientDeviceId,
        ...authPayload
      })
    });
    const data = await res.json();
    if (data && data.success) {
      state.pollFailureCount = 0;
      state.lastCloudSyncDoneTs = Date.now();
      applyCloudBundle(data, false);

      const cloudOrdersArr = (data.bundle && Array.isArray(data.bundle.orders)) ? data.bundle.orders : (Array.isArray(data.orders) ? data.orders : []);

      // #1 關鍵雙保險：若學生端有進行中待取餐訂單且未出現在 initBundle 回傳清單中，立即逐筆透過 getOrder 查詢最新狀態與叫號次數
      await pollActiveWatchedOrdersDirectFallback(watchedIds, cloudOrdersArr);

      // 若在訂單憑證頁且本機仍無該筆訂單，立即透過 getOrder 單筆補抓
      if (state.routeMode === 'ticket' && state.trackingOrderId && !state.orders.some(o => o.orderId === state.trackingOrderId)) {
        await tryAutoFetchMissingOrderById(state.trackingOrderId, true);
      }

      // 若在店家後台且雲端尚未重新部署新版 code.gs 導致 initBundle 回傳空陣列，自動啟動授權補抓
      if (state.routeMode === 'store' && state.isMerchantUnlocked && cloudOrdersArr.length === 0) {
        await recoverStoreOrdersIfInitBundleEmpty();
      }

      enrichStoresAndAi();
      updateHeaderMyOrdersBadge();

      const editingNow = !showSuccessToast && isUserEditingFormInput();
      if (!editingNow) {
        if (state.routeMode === 'order') renderStudentOrderExperience();
        if (state.routeMode === 'ticket') renderSingleTicketView();
        if (state.routeMode === 'board') refreshCustomerPickupBoardIfOpen(true);
        if (state.routeMode === 'store' && state.isMerchantUnlocked) {
          if ((state.storeTabMode === 'settings' || state.storeTabMode === 'pos') && !showSuccessToast) {
            updateMerchantHeaderBadgesOnly();
          } else {
            renderMerchantView();
          }
        }
        if (!showSuccessToast) {
          window.scrollTo(scrollX, scrollY);
        }
      } else if (state.routeMode === 'store' && state.isMerchantUnlocked) {
        updateMerchantHeaderBadgesOnly();
      }

      setSyncState('online', '已同步');
      if (showSuccessToast) showToast('☁️ 已與雲端資料庫完成同步');
    } else {
      state.pollFailureCount = Math.min(6, (state.pollFailureCount || 0) + 1);
      setSyncState('online', '本地就緒');
    }
  } catch (e) {
    state.pollFailureCount = Math.min(6, (state.pollFailureCount || 0) + 1);
    setSyncState('offline', '離線快取模式');
  } finally {
    state.isSyncInFlight = false;
  }
}

function updateMerchantHeaderBadgesOnly() {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const todayStr = getTodayDateStr();
  const storeActiveOrders = state.orders.filter(o =>
    o.storeId === store.id &&
    normalizeDateStr(o.pickupDate || todayStr) >= todayStr &&
    !String(o.status).includes('已取消') &&
    o.status !== '已完成'
  );
  const badgeEl = document.getElementById('railKdsBadge');
  if (badgeEl) {
    badgeEl.innerText = storeActiveOrders.length;
    badgeEl.style.display = storeActiveOrders.length > 0 ? 'inline-block' : 'none';
  }
}

function updateBodyScrollLock() {
  document.body.classList.remove('store-fullscreen');
  document.body.classList.toggle('store-mode-active', state.routeMode === 'store' || state.routeMode === 'board');
  document.body.classList.toggle('pos-no-scroll', state.routeMode === 'store' && state.isMerchantUnlocked && state.storeTabMode === 'pos');
}

function ensureHeaderExtraControls() {
  const lineBtn = document.getElementById('headerLineBindBtn');
  if (lineBtn && !document.getElementById('headerMyOrdersBtn')) {
    lineBtn.insertAdjacentHTML('beforebegin', `
      <button type="button" id="headerLangToggleBtn" class="btn-my-orders" style="padding:5px 10px;" onclick="toggleAppLanguage()" title="Switch Language / 切換語系">
        ${state.lang === 'en' ? '🌐 中文' : '🌐 EN'}
      </button>
      <button type="button" id="headerMyOrdersBtn" class="btn-my-orders" style="display:none;" onclick="openMyOrdersDrawer()">
        <span>🧾 ${t('我的訂單 / 查單', 'My Orders')}</span>
        <span id="headerMyOrdersCount" class="my-orders-count-badge" style="display:none;">0</span>
      </button>
    `);
  }

  const storeControls = document.getElementById('headerStoreControls');
  if (storeControls && !document.getElementById('headerStoreOpenToggleBtn')) {
    storeControls.insertAdjacentHTML('afterbegin', `
      <button type="button" id="headerStoreOpenToggleBtn" class="store-status-toggle" onclick="toggleCurrentStoreOpenStatus()">
        🟢 營業中
      </button>
    `);
  }
  if (storeControls && !document.getElementById('headerPickupBoardBtn')) {
    storeControls.insertAdjacentHTML('beforeend', `
      <button type="button" id="headerPickupBoardBtn" class="filter-chip" style="padding:6px 12px; font-size:0.78rem; background:#0F172A; color:#FFFFFF; border-color:#0F172A;" onclick="openCustomerPickupBoardModal()" title="開啟顧客叫號大螢幕看板">
        📺 叫號看板
      </button>
    `);
  }
}

function updateHeaderMyOrdersBadge() {
  const btn = document.getElementById('headerMyOrdersBtn');
  const countEl = document.getElementById('headerMyOrdersCount');
  if (!btn || !countEl) return;

  btn.style.display = (state.routeMode === 'store' || state.routeMode === 'board') ? 'none' : 'inline-flex';
  const myOrders = getMyTrackedOrdersList();
  const activeCount = myOrders.filter(o => o.status !== '已完成' && !String(o.status).includes('已取消')).length;
  const totalCount = myOrders.length;

  if (totalCount > 0) {
    countEl.style.display = 'inline-block';
    countEl.innerText = activeCount > 0 ? `${activeCount}進行中` : `${totalCount}`;
  } else {
    countEl.style.display = 'none';
  }
}

function applyRouteView() {
  ensureSharedModalsMounted();
  ensureHeaderExtraControls();
  syncHeaderLanguageControls();
  enrichStoresAndAi();
  state.isMerchantUnlocked = isMerchantSessionValidNow();
  updateBodyScrollLock();
  updateHeaderMyOrdersBadge();

  const lineBtn = document.getElementById('headerLineBindBtn');
  if (lineBtn) {
    lineBtn.style.display = (state.routeMode === 'store' || state.routeMode === 'board') ? 'none' : 'inline-flex';
  }
  const storeControls = document.getElementById('headerStoreControls');
  if (storeControls) {
    storeControls.style.display = (state.routeMode === 'store' && state.isMerchantUnlocked) ? 'inline-flex' : 'none';
  }

  const lineBtnText = document.getElementById('headerLineBtnText');
  if (lineBtnText) {
    lineBtnText.innerText = state.lineProfile.isBound
      ? t(`💚 已綁定 (${state.lineProfile.lineDisplayName})`, `💚 Alerts On`, `💚 通知ON`, `💚 알림ON`)
      : t('💬 綁定取餐通知', '💬 Pickup Alerts', '💬 受取通知連携', '💬 픽업 알림');
  }

  const sections = ['viewPortal', 'viewOrder', 'viewTicket', 'viewStore'];
  const mapModeToSec = {
    portal: 'viewPortal',
    order: 'viewOrder',
    ticket: 'viewTicket',
    store: 'viewStore',
    board: 'viewStore'
  };
  const activeSec = mapModeToSec[state.routeMode] || 'viewOrder';
  sections.forEach(secId => {
    const el = document.getElementById(secId);
    if (el) el.classList.toggle('active', secId === activeSec);
  });

  // #39：同步左側導覽列與分頁顯示狀態 (支援 ?tab=kds / ?tab=analytics 直接進入目標分頁)
  if (state.routeMode === 'store') {
    ['pos', 'kds', 'analytics', 'settings'].forEach(m => {
      document.getElementById(`railBtn-${m}`)?.classList.toggle('active', m === state.storeTabMode);
      const panel = document.getElementById(`storePanel-${m}`);
      if (panel) panel.style.display = (m === state.storeTabMode) ? 'block' : 'none';
    });
  }

  const floatingCart = document.getElementById('floatingCartBar');
  if (floatingCart) {
    floatingCart.style.display = (state.routeMode === 'order' && state.selectedStoreId) ? 'block' : 'none';
  }

  const campusSwitcher = document.getElementById('headerCampusSwitcher');
  if (campusSwitcher) {
    const isLockedSingleStore = Boolean(state.urlLockedStoreId && state.selectedStoreId === state.urlLockedStoreId);
    campusSwitcher.style.display = (state.routeMode === 'order' && !state.selectedStoreId && !isLockedSingleStore) ? 'inline-flex' : 'none';
  }

  const roleBadge = document.getElementById('headerRoleBadge');
  if (roleBadge) {
    if (state.routeMode === 'board') {
      roleBadge.innerText = '📺 ' + t('顧客即時取餐叫號大螢幕看板', 'Live Pickup Call Board', '受取番号ディスプレイ', '실시간 픽업 호출 전광판');
      roleBadge.style.background = '#0F172A';
      roleBadge.style.color = '#34D399';
    } else if (state.routeMode === 'store') {
      roleBadge.innerText = '🖥️ ' + t('店家櫃檯收銀與營運中心', 'Merchant POS & Operations', '店舗POS・管理センター', '매장 POS・운영 센터');
      roleBadge.style.background = 'var(--brand-light)';
      roleBadge.style.color = 'var(--brand-dark)';
    } else if (state.routeMode === 'ticket') {
      roleBadge.innerText = '🎟️ ' + t('訂單專屬追蹤憑證', 'Order Pickup Ticket', '受取電子チケット', '주문 픽업 티켓');
      roleBadge.style.background = 'var(--brand-light)';
      roleBadge.style.color = 'var(--brand-dark)';
    } else if (state.routeMode === 'order') {
      roleBadge.innerText = '📱 ' + t('線上點餐系統', 'Campus Ordering', 'オンライン注文', '온라인 주문');
      roleBadge.style.background = 'var(--brand-light)';
      roleBadge.style.color = 'var(--brand-dark)';
    } else {
      roleBadge.innerText = '⚡ ' + t('系統入口導覽', 'Portal Home', 'ポータルホーム', '포털 홈');
      roleBadge.style.background = 'var(--bg-page)';
      roleBadge.style.color = 'var(--text-secondary)';
    }
  }

  if (state.routeMode === 'portal') renderPortalView();
  if (state.routeMode === 'order') renderStudentOrderExperience();
  if (state.routeMode === 'ticket') renderSingleTicketView();
  if (state.routeMode === 'board') {
    document.getElementById('storePinModal')?.classList.remove('open');
    openCustomerPickupBoardModal(true);
    requestMerchantWakeLock();
  }
  if (state.routeMode === 'store') {
    checkMerchantSecurityGate();
    renderMerchantView();
  }

  if (state.lang && state.lang !== 'zh-TW') {
    applyDomSystemTranslation(document.body);
  }

  updateBackgroundSilentAudioKeepAlive();
  syncWatchedOrdersToServiceWorker(false);
  scheduleAdaptiveCloudPoll();
}

function switchCampus(campus) {
  state.campus = campus;
  state.selectedStoreId = null;
  document.getElementById('btnCampus-雙溪校區')?.classList.toggle('active', campus === '雙溪校區');
  document.getElementById('btnCampus-城中校區')?.classList.toggle('active', campus === '城中校區');
  syncUrlStateWithHistory(true);
  applyRouteView();
}

function setFilter(f) {
  state.filter = f;
  ['ALL', 'FAST', 'PROMO'].forEach(k => {
    const el = document.getElementById('filter-' + k);
    if (el) el.classList.toggle('active', k === f);
  });
  renderStudentOrderExperience();
}

// ==================== 【商業級改造 3】雙重驗證精準跨裝置查單 (杜絕 001~999 盲猜遍歷) ====================
function getMyTrackedOrdersList() {
  const idSet = new Set([state.trackingOrderId, state.myCreatedOrderId, ...state.myOrderHistoryIds].filter(Boolean));
  return state.orders.filter(o => idSet.has(o.orderId));
}

/**
 * 支援兩種安全查單憑據：
 * 1. 直接輸入「6 碼 HMAC 防偽核銷碼 (如 8K9P2M)」或「完整訂單編號 (ORD-...)」
 * 2. 輸入「4 碼取餐號 + 手機末 3 碼」雙重吻合（如 `2003 678` 或分別填入兩個輸入框）
 */
async function searchOrderAcrossDevices(rawQuery, rawPhoneLast3) {
  const qInput = String(rawQuery ?? document.getElementById('drawerOrderSearchInput')?.value ?? state.studentLookupQuery ?? '').trim();
  const phoneInput = String(rawPhoneLast3 ?? document.getElementById('drawerOrderPhoneInput')?.value ?? state.studentLookupPhoneLast3 ?? '').trim();

  if (!qInput) {
    showToast('🔍 請輸入「6 碼防偽核銷碼」，或「4 碼取餐號 + 手機末 3 碼」！');
    return;
  }

  state.studentLookupQuery = qInput;
  state.studentLookupPhoneLast3 = phoneInput;

  // 解析是否為複合輸入 (例如 "2003 678" 或 "10012-678")
  let tokenPart = qInput.toUpperCase().replace(/^#/, '').trim();
  let last3Part = extractPhoneLast3(phoneInput || state.savedCustomerPhone);

  const comboMatch = tokenPart.match(/^(\d{4,5})[\s\-_,/]+(\d{3})$/);
  if (comboMatch) {
    tokenPart = comboMatch[1];
    last3Part = comboMatch[2];
  }

  const isFullOrderId = tokenPart.startsWith('ORD-') && tokenPart.length >= 10;
  const isSixCharHmacCode = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(tokenPart);
  const isFourDigitPickup = /^\d{4,5}$/.test(tokenPart);

  if (!isFullOrderId && !isSixCharHmacCode) {
    if (isFourDigitPickup && last3Part.length !== 3) {
      showToast('🛡️ 為保護點餐隱私，使用「取餐號」查詢時請一併輸入「手機末 3 碼」雙重驗證！');
      return;
    }
    if (!isFourDigitPickup) {
      showToast('⚠️ 格式不符：請輸入「6 碼防偽核銷碼」、「完整 ORD 訂單號」或「4 碼取餐號 + 手機末 3 碼」');
      return;
    }
  }

  const matchedLocal = state.orders.filter(o => {
    const ordId = String(o.orderId || '').toUpperCase();
    const verCode = String(o.verificationCode || '').toUpperCase();
    const pickNum = String(o.pickupNumber || '').toUpperCase();
    const ordLast3 = String(o.customerPhoneLast3 || extractPhoneLast3(o.customerPhone));

    if (isFullOrderId && ordId === tokenPart) return true;
    if (isSixCharHmacCode && verCode === tokenPart) return true;
    if (isFourDigitPickup && pickNum === tokenPart && ordLast3 === last3Part) return true;
    return false;
  });

  if (matchedLocal.length > 0) {
    matchedLocal.forEach(m => addOrderToMyHistory(m.orderId));
    updateHeaderMyOrdersBadge();
    closeMyOrdersDrawer();
    navigateToOrderTicket(matchedLocal[0].orderId);
    showToast(`🎉 驗證通過！已找回訂單 #${matchedLocal[0].pickupNumber}`);
    return;
  }

  try {
    showToast('⏳ 正在向雲端伺服器進行安全查單驗證...');
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'lookupOrders',
        query: tokenPart,
        phoneLast3: last3Part,
        clientDeviceId: state.clientDeviceId
      })
    });
    const data = await res.json();
    const foundList = (data && Array.isArray(data.orders)) ? data.orders.map(sanitizeIncomingOrder) : [];
    if (foundList.length > 0) {
      foundList.forEach(fo => {
        if (!state.orders.some(x => x.orderId === fo.orderId)) {
          state.orders.unshift(fo);
        }
        addOrderToMyHistory(fo.orderId);
      });
      saveCachedOrders(state.orders);
      updateHeaderMyOrdersBadge();
      closeMyOrdersDrawer();
      navigateToOrderTicket(foundList[0].orderId);
      showToast(`🎉 雲端雙重驗證通過！成功找回訂單 #${foundList[0].pickupNumber}`);
    } else {
      showToast((data && data.message) || '⚠️ 查無相符訂單，請確認「6 碼防偽碼」或「取餐號 + 手機末 3 碼」是否正確');
    }
  } catch (e) {
    showToast('⚠️ 目前處於離線模式，僅能查詢本機已儲存訂單');
  }
}

function openMyOrdersDrawer() {
  ensureSharedModalsMounted();
  const body = document.getElementById('myOrdersDrawerBody');
  const modal = document.getElementById('myOrdersDrawerModal');
  if (!body || !modal) return;

  const list = getMyTrackedOrdersList();
  const searchBarHtml = `
    <div style="background:#FFFFFF; border:1.5px solid #CBD5E1; border-radius:14px; padding:12px; margin-bottom:14px; box-shadow:var(--shadow-sm);">
      <div style="font-size:0.8rem; font-weight:900; color:var(--text-primary); margin-bottom:6px;">
        🔍 跨裝置安全找回訂單（輸入「6 碼防偽核銷碼」，或「4 碼取餐號 + 手機末 3 碼」）
      </div>
      <div style="display:grid; grid-template-columns:1.3fr 0.9fr auto; gap:6px;">
        <input type="search" id="drawerOrderSearchInput" class="select-input" placeholder="6碼防偽碼 或 4碼取餐號" value="${escapeHtml(state.studentLookupQuery)}" onkeydown="if(event.key==='Enter') searchOrderAcrossDevices()">
        <input type="tel" id="drawerOrderPhoneInput" maxlength="10" class="select-input" placeholder="手機末3碼 (若用取餐號)" value="${escapeHtml(state.studentLookupPhoneLast3 || extractPhoneLast3(state.savedCustomerPhone))}" onkeydown="if(event.key==='Enter') searchOrderAcrossDevices()">
        <button type="button" class="btn-tip-action" style="white-space:nowrap; padding:8px 14px;" onclick="searchOrderAcrossDevices()">驗證找回</button>
      </div>
    </div>
  `;

  if (list.length === 0) {
    body.innerHTML = searchBarHtml + `
      <div style="text-align:center; padding:36px 16px;">
        <div style="font-size:2.8rem; margin-bottom:8px;">🧾</div>
        <h4 style="font-size:1.05rem; font-weight:900; margin-bottom:6px;">目前本機尚無進行中或歷史點餐紀錄</h4>
        <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:16px;">若您剛才使用其他裝置或無痕視窗點餐，請在上方輸入「6 碼防偽核銷碼」或「取餐號 + 手機末 3 碼」安全找回！</p>
        <button type="button" class="btn-tip-action" onclick="closeMyOrdersDrawer()">前往挑選餐點</button>
      </div>
    `;
  } else {
    body.innerHTML = searchBarHtml + list.map(o => {
      const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
      const itemStr = items.map(i => `${i.baseName || i.name} ×${i.qty || 1}`).join('、');
      const isReady = o.status === '可取餐';
      const isCooking = o.status === '製作中';
      const isScheduled = o.status === '已接單待排程' || o.status === '待付款確認';
      const isCancelled = String(o.status).includes('已取消');
      const verDisplay = formatVerificationCodeDisplay(o);

      return `
        <div style="background:#FFFFFF; border:2px solid ${isReady ? 'var(--green)' : isCooking ? '#FDBA74' : isScheduled ? '#93C5FD' : 'var(--border)'}; border-radius:14px; padding:14px; margin-bottom:10px; box-shadow:var(--shadow-sm); cursor:pointer;" onclick="closeMyOrdersDrawer(); navigateToOrderTicket(${escapeJsAttr(o.orderId)})">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.35rem; font-weight:950; color:${isReady ? 'var(--green)' : 'var(--brand-dark)'};">#${escapeHtml(o.pickupNumber)}</span>
              <span style="font-weight:900; font-size:0.95rem;">${escapeHtml(o.storeName)}</span>
              <span style="font-family:monospace; font-size:0.72rem; font-weight:900; background:#EEF2FF; color:#312E81; padding:2px 6px; border-radius:6px;">核銷碼:${escapeHtml(verDisplay)}</span>
            </div>
            <span style="font-size:0.74rem; font-weight:900; padding:3px 10px; border-radius:999px; background:${isCancelled ? '#FEE2E2' : isReady ? '#DCFCE7' : isCooking ? '#FEF3C7' : isScheduled ? '#DBEAFE' : '#E2E8F0'}; color:${isCancelled ? '#DC2626' : isReady ? '#047857' : isCooking ? '#B45309' : isScheduled ? '#1E40AF' : '#475569'};">
              ${isReady ? '🔔 可取餐！' : escapeHtml(o.status)}
            </span>
          </div>
          <div style="font-size:0.84rem; color:var(--text-primary); font-weight:700; margin-bottom:6px;">${escapeHtml(itemStr)}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.76rem; color:var(--text-secondary);">
            <span>⏰ ${escapeHtml(o.pickupTimeSlot || o.pickupDate)} (${escapeHtml(o.paymentMethod)})</span>
            <strong style="font-size:0.95rem; color:var(--red);">NT$ ${o.finalTotal} ・ 查看憑證 ➔</strong>
          </div>
        </div>
      `;
    }).join('');
  }
  modal.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
}

function closeMyOrdersDrawer() {
  document.getElementById('myOrdersDrawerModal')?.classList.remove('open');
}

// ==================== 【商業級資安 #7, #8, #16】支援 4~8 碼各店獨立 PIN 驗證、移除本地雜湊繞過後門、伺服器端登出註銷 ====================
function checkMerchantSecurityGate() {
  const modal = document.getElementById('storePinModal');
  if (!modal) return;
  if (isMerchantSessionValidNow()) {
    state.isMerchantUnlocked = true;
    modal.classList.remove('open');
    updateMerchantAudioUnlockBanner();
    return;
  }
  state.isMerchantUnlocked = false;
  state.merchantAuthToken = '';
  state.pinInputBuffer = '';
  renderStorePinModal(false);
  modal.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
}

function renderStorePinModal(hasError = false) {
  const body = document.getElementById('storePinModalBody');
  if (!body) return;
  const len = state.pinInputBuffer.length;
  const targetStore = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  const isStoreLocked = Boolean(state.urlLockedStoreId || state.boundMerchantStoreId);
  const lockoutRemainSec = state.pinLockoutUntilTs > Date.now()
    ? Math.ceil((state.pinLockoutUntilTs - Date.now()) / 1000)
    : 0;
  const dotSlots = Math.max(4, Math.min(8, len < 4 ? 4 : len));

  body.innerHTML = `
    <div style="text-align:center;">
      <div style="margin-bottom:10px;">
        <label class="field-label" style="text-align:left;">🏪 選擇並驗證單一店鋪櫃位（各店獨立密碼）</label>
        ${isStoreLocked && targetStore ? `
          <div style="background:#F8FAFC; border:1.5px solid var(--border); border-radius:10px; padding:10px 12px; font-weight:900; color:var(--text-primary); display:flex; justify-content:space-between; align-items:center;">
            <span>${getStoreIconDisplay(targetStore)} ${escapeHtml(targetStore.campus)} — ${escapeHtml(targetStore.name)}</span>
            ${state.boundMerchantStoreId && !state.urlLockedStoreId ? `<button type="button" onclick="unbindDeviceMerchantStore()" style="border:none; background:transparent; color:var(--text-secondary); font-size:0.72rem; text-decoration:underline; cursor:pointer;">切換店鋪</button>` : `<span style="font-size:0.7rem; color:var(--indigo);">專屬網址鎖定</span>`}
          </div>
        ` : `
          <select class="select-input" style="font-weight:800;" onchange="state.merchantStoreId=this.value; state.pinInputBuffer=''; try{localStorage.setItem('mealflow_last_merchant_store_id', this.value);}catch(e){} renderStorePinModal(false)">
            ${state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === (targetStore ? targetStore.id : '') ? 'selected' : ''}>${escapeHtml(s.campus)} — ${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`).join('')}
          </select>
        `}
      </div>
      <p style="font-size:0.82rem; color:${lockoutRemainSec > 0 ? 'var(--red)' : 'var(--text-secondary)'}; font-weight:700;">
        ${lockoutRemainSec > 0
          ? `🛑 連續錯誤達上限，請等候 ${lockoutRemainSec} 秒後再試`
          : (state.isVerifyingPin ? '⏳ 正在向雲端伺服器請求單店 HMAC 簽章授權...' : `請輸入「${escapeHtml(targetStore ? targetStore.name : '本店')}」專屬 4～8 位數授權碼`)}
      </p>
      <div class="pin-dots-row ${hasError ? 'shake-error' : ''}" style="justify-content:center; gap:8px;">
        ${Array.from({ length: dotSlots }).map((_, i) => `
          <div class="pin-dot-box ${i < len ? 'filled' : ''}">${i < len ? '●' : ''}</div>
        `).join('')}
      </div>
      <div class="pos-numpad-grid" style="margin-bottom:10px;">
        ${['1','2','3','4','5','6','7','8','9'].map(k => `<button type="button" class="pos-numpad-key" ${state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="tapStorePinKey('${k}')">${k}</button>`).join('')}
        <button type="button" class="pos-numpad-key clear" ${state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="tapStorePinKey('C')">清除</button>
        <button type="button" class="pos-numpad-key" ${state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="tapStorePinKey('0')">0</button>
        <button type="button" class="pos-numpad-key back" ${state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="tapStorePinKey('BACK')">⌫</button>
      </div>
      <button type="button" class="btn-primary-full" style="background:${len >= 4 && len <= 8 && lockoutRemainSec === 0 ? 'var(--green)' : '#9CA3AF'}; box-shadow:none;" ${len < 4 || len > 8 || state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="submitStorePinAuth()">
        🔓 確認解鎖「${escapeHtml(targetStore ? targetStore.name : '本店')}」(${len} 碼)
      </button>
      <div style="font-size:0.72rem; color:var(--text-muted); margin-top:8px;">
        🛡️ 各店獨立授權憑證・切換店鋪須重新驗證・閒置 ${state.merchantAutoLockMinutes} 分鐘自動上鎖
      </div>
    </div>
  `;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('storePinModal'));
}

function unbindDeviceMerchantStore() {
  state.boundMerchantStoreId = '';
  try { localStorage.removeItem('mealflow_bound_store_id'); } catch (e) {}
  renderStorePinModal(false);
}

function tapStorePinKey(key) {
  if (state.isVerifyingPin || state.pinLockoutUntilTs > Date.now()) return;
  ensureAudioContextUnlocked(false);
  if (key === 'C') state.pinInputBuffer = '';
  else if (key === 'BACK') state.pinInputBuffer = state.pinInputBuffer.slice(0, -1);
  else if (state.pinInputBuffer.length < 8 && /^\d$/.test(String(key))) {
    state.pinInputBuffer += String(key);
  }
  renderStorePinModal(false);
}

async function submitStorePinAuth() {
  if (state.isVerifyingPin || state.pinInputBuffer.length < 4 || state.pinInputBuffer.length > 8 || state.pinLockoutUntilTs > Date.now()) return;
  const candidatePin = state.pinInputBuffer;
  const targetStoreId = state.merchantStoreId || 'S01';
  state.isVerifyingPin = true;
  renderStorePinModal(false);

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'verifyMerchantPin',
        pin: candidatePin,
        storeId: targetStoreId
      })
    });
    const data = await res.json();

    if (data && data.success && data.sessionToken) {
      const expiresAt = Number(data.expiresAt) || (Date.now() + 8 * 3600 * 1000);
      // #7 & #8：嚴格綁定單一授權店鋪 ID，絕不使用 'ALL'
      const scope = String(data.authorizedStoreId && data.authorizedStoreId !== 'ALL' ? data.authorizedStoreId : targetStoreId);
      state.isMerchantUnlocked = true;
      state.merchantAuthToken = data.sessionToken;
      state.merchantSessionExpiresAt = expiresAt;
      state.merchantAuthorizedStoreScope = scope;
      state.pinFailCount = 0;
      state.pinLockoutUntilTs = 0;
      state.lastMerchantActivityTs = Date.now();
      try {
        sessionStorage.setItem('mealflow_merchant_session_v13', data.sessionToken);
        sessionStorage.setItem('mealflow_merchant_exp_v13', String(expiresAt));
        sessionStorage.setItem('mealflow_merchant_scope_v13', scope);
        localStorage.setItem('mealflow_last_merchant_store_id', targetStoreId);
        // #16：徹底清除舊版留在 localStorage 的不安全離線 PIN 雜湊
        localStorage.removeItem(`mealflow_offline_pin_digest_${targetStoreId}`);
        localStorage.removeItem('mealflow_offline_pin_backup_v14');
      } catch (e) {}
      state.isVerifyingPin = false;
      state.pinInputBuffer = '';
      document.getElementById('storePinModal')?.classList.remove('open');
      requestMerchantWakeLock();
      applyRouteView();
      updateMerchantAudioUnlockBanner();
      syncCloud(false);
      const storeObj = state.stores.find(s => s.id === scope);
      showToast(`🔓 已解鎖「${storeObj ? storeObj.name : scope}」獨立店務憑證！`);
    } else {
      throw new Error((data && data.message) || '授權碼驗證失敗');
    }
  } catch (err) {
    state.pinFailCount = (state.pinFailCount || 0) + 1;
    if (state.pinFailCount >= 5) {
      state.pinLockoutUntilTs = Date.now() + 180000;
      state.pinFailCount = 0;
      setTimeout(() => {
        if (document.getElementById('storePinModal')?.classList.contains('open')) {
          renderStorePinModal(false);
        }
      }, 180500);
    }

    state.isVerifyingPin = false;
    state.pinInputBuffer = '';
    try { if ('vibrate' in navigator) navigator.vibrate([120, 80, 120]); } catch (e) {}
    showToast(`❌ ${err.message || '本店授權碼錯誤或無法連線至驗證伺服器'}`);
    renderStorePinModal(true);
  }
}

function lockMerchantSession(customToastMsg = '') {
  const tokenToRevoke = state.merchantAuthToken || sessionStorage.getItem('mealflow_merchant_session_v13') || '';
  state.isMerchantUnlocked = false;
  state.merchantAuthToken = '';
  state.merchantSessionExpiresAt = 0;
  state.merchantAuthorizedStoreScope = '';
  state.pinInputBuffer = '';
  try {
    sessionStorage.removeItem('mealflow_merchant_session_v13');
    sessionStorage.removeItem('mealflow_merchant_exp_v13');
    sessionStorage.removeItem('mealflow_merchant_scope_v13');
  } catch (e) {}

  // #16：主動通知伺服器端撤銷該 Session Token (Revoke Nonce)，防止登出後舊 Token 仍可被重放使用
  if (tokenToRevoke && tokenToRevoke.includes('.')) {
    fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'logoutMerchantSession',
        merchantAuthToken: tokenToRevoke
      })
    }).catch(() => {});
  }

  ['pos', 'kds', 'analytics', 'settings'].forEach(m => {
    const p = document.getElementById(`storePanel-${m}`);
    if (p) p.innerHTML = '';
  });
  updateMerchantAudioUnlockBanner();
  applyRouteView();
  showToast(customToastMsg ? `🔒 ${customToastMsg}` : '🔒 已安全登出並於雲端註銷時效憑證');
}

function exitStoreToStudentOrder() {
  document.getElementById('storePinModal')?.classList.remove('open');
  navigateToOrderMenu();
}

// ==================== #6 & #10 各店獨立 LINE Pay 商家串接 (Request -> Confirm 兩階段核實、逾時倒數、防重複扣款) ====================
function requestOnlinePaymentGateway(payMethod, amount, storeName, storeId, orderId = '') {
  return new Promise((resolve) => {
    ensureSharedModalsMounted();
    const modal = document.getElementById('onlinePaymentModal');
    const header = document.getElementById('onlinePaymentHeader');
    const title = document.getElementById('onlinePaymentTitle');
    const body = document.getElementById('onlinePaymentBody');
    if (!modal || !body) {
      resolve({ approved: false, transactionId: '', paymentAuthToken: '' });
      return;
    }

    const storeObj = state.stores.find(s => s.id === storeId);
    const customChannelId = storeObj && storeObj.linePayChannelId ? String(storeObj.linePayChannelId) : '';
    const maskedChannelDisplay = customChannelId
      ? `${customChannelId.slice(0, 4)}****${customChannelId.slice(-2)} (本店獨立特店帳號)`
      : '平台代收特店通道 (未設定獨立 Channel ID)';
    const envBadgeText = (storeObj && storeObj.linePaySandbox === false && customChannelId)
      ? '🟢 LINE Pay V3 正式環境 (Production)'
      : '🧪 LINE Pay V3 商家沙盒環境 (Sandbox)';

    header.className = 'payment-gateway-header linepay';
    title.innerText = '💚 LINE Pay 商家特店收銀台 (Request ➔ Confirm)';

    if (state.linePayCountdownTimer) {
      clearInterval(state.linePayCountdownTimer);
      state.linePayCountdownTimer = null;
    }
    let remainSec = 900; // 15 分鐘付款逾時保護

    body.innerHTML = `
      <div style="text-align:center; padding:8px 4px;">
        <div style="font-size:0.8rem; font-weight:800; color:var(--text-secondary);">${escapeHtml(BRAND_CONFIG.merchantTitle)} — ${escapeHtml(storeName)}</div>
        <div style="font-size:2.2rem; font-weight:950; color:var(--text-primary); margin:6px 0;">NT$ ${amount}</div>
        <div style="display:inline-flex; align-items:center; gap:6px; background:#ECFDF5; color:#047857; font-size:0.74rem; font-weight:800; padding:3px 10px; border-radius:999px; margin-bottom:12px;">
          <span>🛡️ ${escapeHtml(envBadgeText)}</span>
          <span>・</span>
          <span id="linePayTimeoutCountdown" style="font-family:monospace; color:#065F46;">有效倒數 15:00</span>
        </div>

        <div style="background:#F8FAFC; border:1.5px solid #E2E8F0; border-radius:14px; padding:14px; margin-bottom:14px; text-align:left; font-size:0.8rem; color:var(--text-secondary);">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>收款特店櫃位</span>
            <strong style="color:var(--text-primary);">${escapeHtml(storeName)} (${escapeHtml(storeId || '')})</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>商家 Channel ID</span>
            <strong style="color:var(--indigo); font-family:monospace;">${escapeHtml(maskedChannelDisplay)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>交易流程驗證</span>
            <strong id="linePayFlowStepLabel" style="color:var(--brand-dark);">1. 待發起 Request 授權 ➔ 2. Confirm 請款</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>防重複付款保護</span>
            <strong style="color:var(--green);">✓ 綁定單號防重放 + HMAC 金額核實</strong>
          </div>
        </div>

        <div style="display:flex; gap:10px;">
          <button type="button" class="btn-outline" style="flex:1;" onclick="cancelOnlinePaymentModal()">取消付款</button>
          <button type="button" id="confirmGatewayPayBtn" class="btn-tip-action" style="flex:2; background:#00C300; padding:13px; font-size:0.94rem;" onclick="approveOnlinePaymentModal(${escapeJsAttr(storeId || '')}, ${Number(amount) || 0}, ${escapeJsAttr(orderId || '')})">
            🔒 確認授權並請款 (NT$ ${amount})
          </button>
        </div>
      </div>
    `;

    state.linePayCountdownTimer = setInterval(() => {
      remainSec--;
      const cdEl = document.getElementById('linePayTimeoutCountdown');
      if (cdEl) {
        const mm = String(Math.floor(Math.max(0, remainSec) / 60)).padStart(2, '0');
        const ss = String(Math.max(0, remainSec) % 60).padStart(2, '0');
        cdEl.textContent = `有效倒數 ${mm}:${ss}`;
      }
      if (remainSec <= 0) {
        clearInterval(state.linePayCountdownTimer);
        state.linePayCountdownTimer = null;
        showToast('⏰ LINE Pay 付款授權已逾時，請重新發起結帳');
        cancelOnlinePaymentModal();
      }
    }, 1000);

    state.pendingPaymentResolver = resolve;
    modal.classList.add('open');
  });
}

async function approveOnlinePaymentModal(storeId, amount, orderId = '') {
  // #1：趁使用者點擊「確認授權付款」手勢當下（任何 await 之前），同步解鎖音訊保活與請求系統通知權限！
  ensureAudioContextUnlocked(false);
  updateBackgroundSilentAudioKeepAlive();
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) {}

  const btn = document.getElementById('confirmGatewayPayBtn');
  const stepEl = document.getElementById('linePayFlowStepLabel');
  if (btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.innerText = '⏳ 步驟 1/2：發起商家 Request 授權...';
  }
  try {
    // 步驟 1：呼叫各店獨立 LINE Pay Request 端點取得 transactionId 與 requestToken
    const reqRes = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'requestLinePayCheckout',
        storeId: storeId,
        amount: amount,
        orderId: orderId,
        clientDeviceId: state.clientDeviceId
      })
    });
    const reqData = await reqRes.json();
    if (!reqData || !reqData.success || !reqData.transactionId) {
      throw new Error((reqData && reqData.message) || '雲端金流 Request 授權請求失敗');
    }

    if (stepEl) {
      stepEl.textContent = `✓ 已取得交易號 ${reqData.transactionId} ➔ 正在執行 Confirm 請款...`;
      stepEl.style.color = '#059669';
    }
    if (btn) {
      btn.innerText = '⏳ 步驟 2/2：執行 Confirm 交易請款核實...';
    }

    // 步驟 2：呼叫 Confirm 端點完成請款核實（若舊版 GAS 尚未部署 confirmLinePayCheckout，自動相容使用 reqData.paymentAuthToken）
    let finalAuthToken = reqData.paymentAuthToken || '';
    let finalTxId = reqData.transactionId;
    if (reqData.requestToken) {
      try {
        const confRes = await fetch(GAS_URL, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'confirmLinePayCheckout',
            storeId: storeId,
            amount: amount,
            transactionId: reqData.transactionId,
            requestToken: reqData.requestToken,
            clientDeviceId: state.clientDeviceId
          })
        });
        const confData = await confRes.json();
        if (confData && confData.success && confData.paymentAuthToken) {
          finalAuthToken = confData.paymentAuthToken;
          finalTxId = confData.transactionId || finalTxId;
        } else if (confData && !confData.success && !String(confData.message || '').includes('未知的操作請求')) {
          throw new Error(confData.message || 'LINE Pay Confirm 請款失敗');
        }
      } catch (confErr) {
        if (confErr && confErr.message && confErr.message.includes('LINE Pay')) {
          throw confErr;
        }
      }
    }

    if (!finalAuthToken) {
      throw new Error('無法取得有效金流簽章憑證');
    }

    if (state.linePayCountdownTimer) {
      clearInterval(state.linePayCountdownTimer);
      state.linePayCountdownTimer = null;
    }
    document.getElementById('onlinePaymentModal')?.classList.remove('open');
    if (state.pendingPaymentResolver) {
      const r = state.pendingPaymentResolver;
      state.pendingPaymentResolver = null;
      r({
        approved: true,
        transactionId: finalTxId,
        paymentAuthToken: finalAuthToken
      });
    }
  } catch (err) {
    showToast(`🚫 金流授權失敗：${err.message || '請檢查網路連線後重試'}`);
    if (btn) {
      btn.disabled = false;
      btn.innerText = `🔒 重新授權付款 (NT$ ${amount})`;
    }
  }
}

function cancelOnlinePaymentModal() {
  if (state.linePayCountdownTimer) {
    clearInterval(state.linePayCountdownTimer);
    state.linePayCountdownTimer = null;
  }
  document.getElementById('onlinePaymentModal')?.classList.remove('open');
  if (state.pendingPaymentResolver) {
    const r = state.pendingPaymentResolver;
    state.pendingPaymentResolver = null;
    r({ approved: false, transactionId: '', paymentAuthToken: '' });
  }
}

// ==================== 1. 根目錄入口導覽台 (/) ====================
function renderPortalView() {
  const orderUrl = getOrderPageUrl();
  const storeUrl = getStorePageUrl();

  const box = document.getElementById('portalContentBox') || document.getElementById('viewPortal');
  if (!box) return;
  box.innerHTML = `
    <div style="text-align:center; padding: 18px 0 22px;">
      <div style="display:flex; justify-content:center; align-items:center; gap:12px; margin-bottom:12px;">
        <img src="./logo-icon.jpg" alt="MealFlow Icon" style="width:52px; height:52px; object-fit:contain; border-radius:12px;">
        <img src="./logo-text.png" alt="MealFlow" style="height:38px; width:auto; object-fit:contain;">
      </div>
      <div style="display:inline-block; background:#EEF2FF; color:#4338CA; font-weight:800; font-size:0.78rem; padding:4px 12px; border-radius:999px; margin-bottom:8px;">
        🛡️ ISO/IEC 18004 真實 QR 核銷 × 時段配額控管 × KDS 鏡頭掃碼 × 會計級交班日結單
      </div>
      <p style="font-size:0.86rem; color:var(--text-secondary); max-width:640px; margin:0 auto;">
        整合<strong>線上掃碼點餐 (<code>/order/</code>)</strong>、<strong>標準可掃描防偽 QR 電子憑證</strong>，以及<strong>全螢幕平板 POS + KDS 鏡頭掃碼核銷 + 會計日結後台 (<code>/store/</code>)</strong>。
      </p>
    </div>

    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin-bottom:20px;">
      <a href="${escapeHtml(orderUrl)}" style="text-decoration:none; color:inherit;">
        <div class="portal-card" style="border:2px solid var(--brand); background:linear-gradient(180deg, #FFFFFF 0%, #FFF9F6 100%);">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:2.2rem;">📱</span>
              <span class="wait-pill wait-free">學生掃碼點餐入口</span>
            </div>
            <h2 style="font-size:1.18rem; font-weight:900; margin-bottom:4px;">學生掃碼點餐端</h2>
            <code style="display:block; font-size:0.76rem; color:var(--brand-dark); background:var(--brand-light); padding:5px 8px; border-radius:6px; margin-bottom:10px;">
              /scu.meal/order/
            </code>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">
              支援 15 分鐘時段配額預訂、動態產能候餐預估、多輪智慧選餐顧問與標準 ISO QR Code 防偽電子取餐單。
            </p>
          </div>
          <div class="btn-tip-action" style="text-align:center; width:100%;">進入學生掃碼點餐 ➔</div>
        </div>
      </a>

      <a href="${escapeHtml(storeUrl)}" style="text-decoration:none; color:inherit;">
        <div class="portal-card" style="border:2px solid #0F172A; background:#FFFFFF;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:2.2rem;">🖥️</span>
              <span class="wait-pill" style="background:#E2E8F0; color:#0F172A;">商用全螢幕平板收銀</span>
            </div>
            <h2 style="font-size:1.18rem; font-weight:900; margin-bottom:4px;">店家全螢幕收銀・KDS 鏡頭核銷・會計日結</h2>
            <code style="display:block; font-size:0.76rem; color:#0F172A; background:#F1F5F9; padding:5px 8px; border-radius:6px; margin-bottom:10px;">
              /scu.meal/store/
            </code>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">
              具備 4 碼雲端 HMAC Session 保護、KDS 鏡頭掃碼核銷、未收款結單強制防呆攔截與完整錢箱交班日結單。
            </p>
          </div>
          <div class="btn-tip-action" style="text-align:center; width:100%; background:#0F172A; box-shadow:none;">進入店家營運中心 ➔</div>
        </div>
      </a>
    </div>
  `;
}

// ==================== 2. 學生掃碼點餐頁 (/order/) ====================
function enterStoreOrdering(storeId, autoOpenMenuId = null) {
  const store = state.stores.find(s => s.id === storeId);
  if (!store) return;

  // #35：各店獨立保留購物車草稿，瀏覽他店不清空也不跳確認彈窗
  if (!state.cartByStoreMap || typeof state.cartByStoreMap !== 'object') {
    state.cartByStoreMap = {};
  }
  if (state.selectedStoreId && state.selectedStoreId !== storeId) {
    if (Array.isArray(state.cartItems) && state.cartItems.length > 0) {
      state.cartByStoreMap[state.selectedStoreId] = state.cartItems;
    } else {
      delete state.cartByStoreMap[state.selectedStoreId];
    }
    state.cartItems = Array.isArray(state.cartByStoreMap[storeId])
      ? state.cartByStoreMap[storeId]
      : [];
  } else if (!state.selectedStoreId) {
    state.cartItems = Array.isArray(state.cartByStoreMap[storeId])
      ? state.cartByStoreMap[storeId]
      : [];
  }

  closeAiConciergeModal();
  state.selectedStoreId = storeId;
  state.studentMenuCategory = '全部';
  state.studentMenuSearch = '';
  state.campus = store.campus;
  state.checkoutErrorBannerMsg = '';

  if (store.canOrderNow === false) {
    state.checkoutTimeMode = 'RESERVE';
  }

  saveStudentCartDraft();
  syncUrlStateWithHistory(true);
  applyRouteView();
  updateCartUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (autoOpenMenuId) {
    setTimeout(() => handleMenuItemClick(autoOpenMenuId, false), 180);
  }
}

function backToStoreDirectory() {
  if (state.selectedStoreId) {
    if (!state.cartByStoreMap || typeof state.cartByStoreMap !== 'object') state.cartByStoreMap = {};
    if (Array.isArray(state.cartItems) && state.cartItems.length > 0) {
      state.cartByStoreMap[state.selectedStoreId] = state.cartItems;
    } else {
      delete state.cartByStoreMap[state.selectedStoreId];
    }
  }
  state.selectedStoreId = null;
  state.studentMenuCategory = '全部';
  state.studentMenuSearch = '';
  saveStudentCartDraft();
  syncUrlStateWithHistory(true);
  applyRouteView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setStudentMenuCategory(cat) {
  state.studentMenuCategory = cat || '全部';
  renderInStoreMenuCards();
}

function handleStudentMenuSearch(val) {
  state.studentMenuSearch = String(val || '');
  renderInStoreMenuCards(true);
}

function renderStudentOrderExperience() {
  enrichStoresAndAi();
  updateHeaderMyOrdersBadge();

  const activeBannerBox = document.getElementById('activeOrderFloatingBanner');
  if (activeBannerBox) {
    const myActiveOrders = getMyTrackedOrdersList().filter(o => o.status !== '已完成' && !String(o.status).includes('已取消'));
    let bannerHtml = '';

    if (myActiveOrders.length > 0) {
      const primaryOrder = myActiveOrders.find(o => o.status === '可取餐') || myActiveOrders[0];
      const isReady = primaryOrder.status === '可取餐';
      const isScheduled = primaryOrder.status === '已接單待排程' || primaryOrder.status === '待付款確認';
      const extraCount = myActiveOrders.length - 1;
      const verDisplay = formatVerificationCodeDisplay(primaryOrder);
      bannerHtml += `
        <div class="active-order-strip ${isReady ? 'ready' : ''}" onclick="${extraCount > 0 ? 'openMyOrdersDrawer()' : `navigateToOrderTicket(${escapeJsAttr(primaryOrder.orderId)})`}">
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="strip-num">#${escapeHtml(primaryOrder.pickupNumber)}</span>
            <div>
              <div style="font-weight:800; font-size:0.88rem;">
                ${isReady ? t('🔔 您點的餐點已可取餐！(點此開啟 QR 憑證)', '🔔 Your order is ready for pickup! (Tap for QR)') : isScheduled ? t(`📅 預訂單已接單排程 (${escapeHtml(primaryOrder.pickupDate)} ${escapeHtml(primaryOrder.pickupTime)})`, `📅 Scheduled (${escapeHtml(primaryOrder.pickupDate)} ${escapeHtml(primaryOrder.pickupTime)})`) : t('🍳 您點的餐點正在廚房製作中', '🍳 Kitchen is preparing your meal')}
                ${extraCount > 0 ? `<span style="background:rgba(255,255,255,0.22); padding:1px 7px; border-radius:999px; font-size:0.74rem; margin-left:4px;">${t(`共 ${myActiveOrders.length} 筆進行中`, `${myActiveOrders.length} active`)}</span>` : ''}
              </div>
              <div style="font-size:0.74rem; opacity:0.9;">
                ${escapeHtml(trTerm(primaryOrder.storeName))} ・ ${t('核銷碼', 'Code')} ${escapeHtml(verDisplay)} ・ ${t('點此查看憑證', 'Tap to view ticket')}
              </div>
            </div>
          </div>
          <span style="font-weight:800; font-size:0.82rem;">${extraCount > 0 ? t('開啟訂單匣 ➔', 'My Orders ➔') : t('查看取餐單 ➔', 'Ticket ➔')}</span>
        </div>
      `;
    }

    activeBannerBox.innerHTML = bannerHtml;
  }

  const directoryBlock = document.getElementById('storeDirectoryBlock');
  const inStoreBlock = document.getElementById('inStoreOrderingBlock');
  if (!directoryBlock || !inStoreBlock) return;

  if (!state.selectedStoreId) {
    directoryBlock.style.display = 'block';
    inStoreBlock.style.display = 'none';
    renderStoreDirectoryList();
  } else {
    directoryBlock.style.display = 'none';
    inStoreBlock.style.display = 'block';
    renderInStoreMenuCards();
    updateCartUI();
  }
}

function renderStoreDirectoryList() {
  const campusStores = state.stores.filter(s => s.campus === state.campus);
  const rec = state.aiRecommendations[state.campus];
  const tipBox = document.getElementById('aiSmartTipBox');

  if (tipBox) {
    if (rec && rec.hasAlert) {
      tipBox.innerHTML = `
        <div class="smart-tip-card">
          <div style="flex:1; min-width:220px;">
            <div class="smart-tip-badge">⚡ ${t('尖峰排隊偵測・智慧分流建議', 'Smart Queue Alert')}</div>
            <div class="smart-tip-title">「${escapeHtml(trTerm(rec.congestedStoreName))}」${t(`目前負載 ${rec.congestedLoadPct}% 需久候 ${rec.congestedWaitMin} 分鐘`, `is busy (${rec.congestedWaitMin}m wait)`)}</div>
            <div class="smart-tip-desc">
              ${t(`改點出餐順暢的`, `Switch to`)} <strong>${escapeHtml(trTerm(rec.recommendedStoreName))}</strong> ${t(`只要`, `for only`)} <strong>${rec.recommendedWaitMin} ${t('分鐘', 'min')}</strong>（${t(`省時 ${rec.timeSavedMin} 分`, `save ${rec.timeSavedMin}m`)}），${t('立即製作再享', 'plus')} <strong>${escapeHtml(rec.promoText)}</strong>
            </div>
          </div>
          <button class="btn-tip-action" onclick="enterStoreOrdering(${escapeJsAttr(rec.recommendedStoreId)})">${t('領優惠免排隊點餐 ➔', 'Order Now ➔')}</button>
        </div>
      `;
    } else {
      tipBox.innerHTML = '';
    }
  }

  let list = campusStores;
  if (state.filter === 'FAST') list = list.filter(s => s.isOpen !== false && s.loadState === 'FREE');
  if (state.filter === 'PROMO') list = list.filter(s => isStorePromoActive(s, false, ''));

  const container = document.getElementById('storeListContainer');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:36px 0;">${t('目前無符合篩選條件的餐廳', 'No matching restaurants found')}</p>`;
    return;
  }

  container.innerHTML = list.map(s => {
    let waitClass = 'wait-free';
    let waitText = t(`約 ${s.avgPrepMinutes} 分取餐`, `~${s.avgPrepMinutes} min`, `約${s.avgPrepMinutes}分`, `약 ${s.avgPrepMinutes}분`);
    let barColor = 'var(--green)';

    if (s.canOrderNow === false) {
      waitClass = 'wait-closed';
      waitText = s.businessShortPillText || t('僅開放預訂', 'Pre-order Only', '予約のみ', '예약 전용');
      barColor = '#94A3B8';
    } else if (s.loadState === 'FULL') {
      waitClass = 'wait-full';
      waitText = t(`忙碌・約 ${s.avgPrepMinutes} 分`, `Busy ~${s.avgPrepMinutes}m`, `混雑 約${s.avgPrepMinutes}分`, `혼잡 약 ${s.avgPrepMinutes}분`);
      barColor = 'var(--red)';
    } else if (s.loadState === 'MODERATE') {
      waitClass = 'wait-mod';
      waitText = t(`適中・約 ${s.avgPrepMinutes} 分`, `~${s.avgPrepMinutes} min`, `約${s.avgPrepMinutes}分`, `약 ${s.avgPrepMinutes}분`);
      barColor = 'var(--amber)';
    }

    const icon = getStoreIconDisplay(s);
    const hasPromo = isStorePromoActive(s, false, '');
    const isRecTarget = rec && rec.hasAlert && rec.recommendedStoreId === s.id;
    const availMenuCount = (s.menus || []).filter(m => !m.soldOut).length;
    const savedCartArr = (state.cartByStoreMap && Array.isArray(state.cartByStoreMap[s.id])) ? state.cartByStoreMap[s.id] : [];
    const savedCartQty = savedCartArr.reduce((sum, ci) => sum + (Number(ci.qty) || 1), 0);

    return `
      <div class="store-card ${isRecTarget ? 'recommended' : ''} ${s.canOrderNow === false ? 'store-closed' : ''}" onclick="enterStoreOrdering(${escapeJsAttr(s.id)})">
        <div class="store-thumb">
          ${icon}
        </div>
        <div class="store-info">
          <div class="store-header-row">
            <div class="store-name">${escapeHtml(trTerm(s.name))}</div>
            <span class="wait-pill ${waitClass}">${waitText}</span>
          </div>
          <div class="store-meta">
            ★ ${s.rating} ・ ${escapeHtml(trTerm(s.category))} ・ ${s.canOrderNow === false ? escapeHtml(s.businessStatusLabel || t('開放預訂取餐', 'Pre-order open', '予約受付中', '예약 가능')) : t(`${availMenuCount} 道供應中`, `${availMenuCount} dishes`, `${availMenuCount}品提供中`, `${availMenuCount}개 메뉴`)}
          </div>
          <div class="load-bar-wrap">
            <div class="load-bar-fill" style="width:${Math.min(100, s.loadPercentage)}%; background:${barColor};"></div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${hasPromo ? `<span class="promo-tag">${escapeHtml(s.promoText)}${s.promoMode === 'discount' ? ` (${t(`滿$${AI_DISCOUNT_MIN_SUBTOTAL}`, `Min $${AI_DISCOUNT_MIN_SUBTOTAL}`)})` : ''}</span>` : ''}
            ${savedCartQty > 0 ? `<span class="store-cart-pill">🛒 ${t(`購物車 ${savedCartQty} 份`, `${savedCartQty} in cart`, `カート ${savedCartQty}点`, `장바구니 ${savedCartQty}개`)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderInStoreMenuCards(onlyUpdateGrid = false) {
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  const box = document.getElementById('inStoreOrderingBlock');
  if (!store || !box) return;

  const hasPromo = isStorePromoActive(store, false, '');
  const rec = state.aiRecommendations[store.campus];
  const isCongested = store.isOpen !== false && store.loadState === 'FULL' && rec && rec.hasAlert && rec.recommendedStoreId !== store.id;

  const items = store.menus || [];
  const allCategories = ['全部', ...Array.from(new Set(items.map(it => it.category || '招牌推薦')))];
  if (!allCategories.includes(state.studentMenuCategory)) {
    state.studentMenuCategory = '全部';
  }
  const searchKw = (state.studentMenuSearch || '').trim().toLowerCase();

  // 統計購物車內各單品已點總份數
  const inCartCountByItemId = {};
  (state.cartItems || []).forEach(ci => {
    const cid = String(ci.id);
    inCartCountByItemId[cid] = (inCartCountByItemId[cid] || 0) + (Number(ci.qty) || 1);
  });

  const filteredItems = items.filter(item => {
    const cat = item.category || '招牌推薦';
    if (state.studentMenuCategory !== '全部' && cat !== state.studentMenuCategory) return false;
    if (searchKw) {
      const matchName = String(item.name || '').toLowerCase().includes(searchKw);
      const matchTag = String(item.tag || '').toLowerCase().includes(searchKw);
      const matchCat = String(cat).toLowerCase().includes(searchKw);
      if (!matchName && !matchTag && !matchCat) return false;
    }
    return true;
  });

  const grouped = {};
  filteredItems.forEach(item => {
    const cat = item.category || '招牌推薦';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  const menuFilterToolbarHtml = items.length > 0 ? `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px; background:#FFFFFF; padding:11px 14px; border-radius:16px; border:1px solid var(--border); box-shadow:0 4px 14px rgba(15,23,42,0.03);">
      <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
        ${allCategories.map(cat => `
          <button type="button" class="pos-cat-pill ${state.studentMenuCategory === cat ? 'active' : ''}" onclick="setStudentMenuCategory(${escapeJsAttr(cat)})">
            ${cat === '全部' ? t('🍽️ 全部餐點', '🍽️ All Dishes') : escapeHtml(trTerm(cat))}
          </button>
        `).join('')}
      </div>
      <div style="display:flex; align-items:center; gap:6px; min-width:200px; flex:1; max-width:290px;">
        <input type="search" id="studentMenuSearchInput" class="select-input" style="padding:7px 12px; font-size:0.82rem; border-radius:999px; background:#F8FAFC;" placeholder="🔍 ${t('搜尋餐點名稱或標籤...', 'Search menu...')}" value="${escapeHtml(state.studentMenuSearch || '')}" oninput="handleStudentMenuSearch(this.value)">
      </div>
    </div>
  ` : '';

  let menuGroupsHtml = '';
  if (items.length === 0) {
    menuGroupsHtml = `<p style="text-align:center; color:var(--text-muted); padding:40px 0;">${t('此餐廳目前尚無供應品項', 'No menu items available right now')}</p>`;
  } else if (filteredItems.length === 0) {
    menuGroupsHtml = `
      <div style="text-align:center; color:var(--text-muted); padding:36px 16px; background:#FFFFFF; border-radius:16px; border:1px dashed var(--border);">
        <div style="font-size:2rem; margin-bottom:6px;">🔍</div>
        <div style="font-weight:800; margin-bottom:8px;">${t(`找不到符合「${escapeHtml(state.studentMenuSearch || state.studentMenuCategory)}」的餐點`, 'No matching dishes found')}</div>
        <button type="button" class="filter-chip" onclick="state.studentMenuCategory='全部'; state.studentMenuSearch=''; renderInStoreMenuCards();">${t('顯示全部餐點', 'Show All Dishes')}</button>
      </div>
    `;
  } else {
    for (let cat in grouped) {
      menuGroupsHtml += `
        <div style="margin-bottom:8px;">
          <h3 class="category-group-title">
            <span style="display:inline-flex; width:26px; height:26px; border-radius:8px; background:var(--brand-light); align-items:center; justify-content:center; font-size:0.86rem;">🍽️</span>
            <span>${escapeHtml(trTerm(cat))}</span>
            <span style="font-size:0.74rem; font-weight:700; color:var(--text-muted); margin-left:auto;">${grouped[cat].length} ${t('道餐點', 'items')}</span>
          </h3>
          <div style="display:grid; grid-template-columns:1fr; gap:12px;">
            ${grouped[cat].map(item => {
              const isSoldOut = Boolean(item.soldOut);
              const inCartQty = inCartCountByItemId[String(item.id)] || 0;
              const hasValidImg = Boolean(item.image && /^(https?:\/\/|data:image\/)/i.test(item.image));
              const imgHtml = hasValidImg
                ? `<img src="${escapeHtml(item.image)}" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline';"><span style="display:none;">🍽️</span>`
                : `<span>🍽️</span>`;
              const hasOpts = item.options && Object.keys(item.options).length > 0;
              const optKeysTranslated = hasOpts ? Object.keys(item.options).map(k => trTerm(k)).join('・') : '';
              const displayDishName = trDishName(item);
              const secondaryNameSub = (state.lang !== 'zh-TW' && item.nameEn && displayDishName !== item.name)
                ? item.name
                : '';
              const subtitleText = isSoldOut
                ? t('今日已售罄', 'Sold out today', '本日完売', '오늘 품절')
                : (hasOpts
                    ? t(`可選規格：${optKeysTranslated}`, `Options: ${optKeysTranslated}`, `オプション：${optKeysTranslated}`, `옵션: ${optKeysTranslated}`)
                    : secondaryNameSub);

              return `
                <div class="menu-item-card ${isSoldOut ? 'sold-out' : ''} ${inCartQty > 0 ? 'in-cart-active' : ''}" onclick="handleMenuItemClick(${escapeJsAttr(item.id)}, false)">
                  <div class="menu-img-box">
                    ${imgHtml}
                    ${!isSoldOut ? `<div class="menu-plus-badge">${inCartQty > 0 ? inCartQty : '＋'}</div>` : ''}
                  </div>
                  <div style="flex:1; min-width:0; display:flex; flex-direction:column; justify-content:space-between; gap:6px;">
                    <div>
                      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        <h4 data-dish-name="1" style="font-size:1.02rem; font-weight:850; color:var(--text-primary); letter-spacing:-0.01em;">${escapeHtml(displayDishName)}</h4>
                        ${isSoldOut
                          ? `<span class="sold-out-ribbon">${t('已售罄', 'Sold Out', '完売', '품절')}</span>`
                          : (item.tag ? `<span style="font-size:0.7rem; font-weight:800; background:linear-gradient(135deg, #FFF3EE 0%, #FFEDD5 100%); color:#C2410C; border:1px solid #FED7AA; padding:2px 8px; border-radius:999px;">${escapeHtml(trTerm(item.tag))}</span>` : '')}
                        ${!isSoldOut && Number(item.dailyLimit) > 0 && item.remainingToday !== null && item.remainingToday !== undefined
                          ? `<span style="font-size:0.7rem; font-weight:900; background:#FEF2F2; color:#DC2626; border:1px solid #FECACA; padding:2px 8px; border-radius:999px;">${t(`剩 ${item.remainingToday} 份`, `${item.remainingToday} left`, `残${item.remainingToday}`, `${item.remainingToday}개 남음`)}</span>`
                          : ''}
                        ${inCartQty > 0 ? `<span style="font-size:0.7rem; font-weight:900; background:var(--brand); color:#FFFFFF; padding:2px 8px; border-radius:999px;">${t(`已選 ${inCartQty}`, `${inCartQty} in cart`, `${inCartQty}点`, `${inCartQty}개`)}</span>` : ''}
                      </div>
                      ${subtitleText ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:3px; line-height:1.35;">${escapeHtml(subtitleText)}</div>` : ''}
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                      <div style="display:flex; align-items:baseline; gap:3px;">
                        <span style="font-size:0.76rem; font-weight:800; color:var(--brand-dark);">NT$</span>
                        <span style="font-size:1.15rem; font-weight:950; color:var(--text-primary);">${item.price}</span>
                      </div>
                      <span class="menu-action-pill" style="${isSoldOut ? 'background:#E2E8F0; color:#94A3B8; border-color:#CBD5E1;' : ''}">
                        ${isSoldOut ? t('已售罄', 'Sold Out', '完売', '품절') : (inCartQty > 0 ? t('＋ 再加一份', '+ Add More', '＋ 追加', '＋ 추가') : (hasOpts ? t('選規格', 'Options', '選択', '옵션') : t('＋ 加入', '+ Add', '＋ 追加', '＋ 담기')))}
                      </span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
  }

  const gridBox = document.getElementById('studentMenuGroupsResultBox');
  if (onlyUpdateGrid && gridBox) {
    gridBox.innerHTML = menuGroupsHtml;
    return;
  }

  const isSingleStoreLocked = Boolean(state.urlLockedStoreId && state.urlLockedStoreId === store.id);
  box.innerHTML = `
    <div class="in-store-banner">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px;">
        ${isSingleStoreLocked
          ? `<span style="font-size:0.75rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:4px 10px; border-radius:999px;">📌 ${t('專屬門市掃碼點餐', 'Booth Exclusive Ordering', '店舗専用注文', '매장 전용 주문')}</span>`
          : `<button type="button" class="filter-chip" style="background:#FFFFFF; padding:5px 11px; font-size:0.78rem; font-weight:800; box-shadow:0 2px 6px rgba(15,23,42,0.04);" onclick="backToStoreDirectory()">← ${t('返回餐廳列表', 'Restaurants', '店舗一覧', '매장 목록')}</button>`}
        <span class="wait-pill ${store.canOrderNow === false ? 'wait-closed' : store.loadState === 'FULL' ? 'wait-full' : store.loadState === 'MODERATE' ? 'wait-mod' : 'wait-free'}">
          ${store.canOrderNow === false ? escapeHtml(store.businessShortPillText || t('僅開放預訂', 'Pre-order only', '予約のみ', '예약 전용')) : t(`約 ${store.avgPrepMinutes} 分取餐`, `Est. ${store.avgPrepMinutes}m`, `約${store.avgPrepMinutes}分`, `약 ${store.avgPrepMinutes}분`)}
        </span>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <div class="store-avatar-lg" style="font-size:2rem; background:linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%); border:1.5px solid #FED7AA; width:54px; height:54px; border-radius:14px; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
          ${getStoreIconDisplay(store)}
        </div>
        <div style="min-width:0; flex:1;">
          <h2 style="font-size:1.25rem; font-weight:950; color:#0F172A; letter-spacing:-0.02em;">${escapeHtml(trTerm(store.name))}</h2>
          <div style="font-size:0.78rem; color:var(--text-secondary); margin-top:2px; display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
            <span>${escapeHtml(trTerm(store.category))}</span>
            <span>・</span>
            <span style="color:#D97706; font-weight:800;">★ ${store.rating}</span>
            <span>・</span>
            <span>${escapeHtml(store.openTime || '10:30')}~${escapeHtml(store.closeTime || '19:30')}${store.breakStartTime && store.breakEndTime ? ` (休 ${escapeHtml(store.breakStartTime)}~${escapeHtml(store.breakEndTime)})` : ''}</span>
          </div>
        </div>
      </div>

      ${store.canOrderNow === false ? `
        <div style="margin-top:10px; background:#FEF2F2; border:1px solid #FECACA; color:#991B1B; padding:8px 12px; border-radius:10px; font-size:0.78rem; font-weight:800;">
          ${escapeHtml(store.businessStatusLabel || t('目前非立即出餐時段，可加入購物車選擇「預訂取餐」', 'Outside immediate hours. Scheduled pre-orders are open.'))}
        </div>
      ` : ''}

      ${hasPromo ? `
        <div style="margin-top:10px; background:#FFF7ED; border:1px solid #FED7AA; color:var(--brand-dark); padding:7px 11px; border-radius:10px; font-size:0.78rem; font-weight:800;">
          ${t('離峰優惠：', 'Offer: ')}${escapeHtml(store.promoText)}${store.promoMode === 'discount' ? t(`（滿$${AI_DISCOUNT_MIN_SUBTOTAL}）`, ` (Min $${AI_DISCOUNT_MIN_SUBTOTAL})`) : ''}
        </div>
      ` : ''}

      ${isCongested ? `
        <div style="margin-top:8px; background:var(--red-bg); color:var(--red); padding:8px 12px; border-radius:10px; font-size:0.78rem; font-weight:700; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <span>${t(`目前較忙碌 (${store.loadPercentage}%)，改點「${escapeHtml(rec.recommendedStoreName)}」省 ${rec.timeSavedMin} 分`, `Busy (${store.loadPercentage}%). Switch to ${escapeHtml(trTerm(rec.recommendedStoreName))} to save ${rec.timeSavedMin}m.`)}</span>
          <button type="button" class="btn-tip-action" style="padding:5px 10px; font-size:0.74rem;" onclick="enterStoreOrdering(${escapeJsAttr(rec.recommendedStoreId)})">${t('改點他店 ➔', 'Switch ➔')}</button>
        </div>
      ` : ''}
    </div>

    ${menuFilterToolbarHtml}
    <div id="studentMenuGroupsResultBox">${menuGroupsHtml}</div>
  `;
}

// ==================== 3. 購物車自動合併與規格選擇器 ====================
function getItemSignature(itemObj) {
  const selObj = itemObj.selections || {};
  const sortedKeys = Object.keys(selObj).sort();
  const selPart = sortedKeys.map(k => `${k}:${selObj[k]}`).join('|');
  const notePart = String(itemObj.itemNote || '').trim();
  return `${itemObj.id}__${selPart}__${notePart}`;
}

function mergeOrPushCartItem(targetCart, newItemObj, editingIndex = -1) {
  const newSig = getItemSignature(newItemObj);

  if (editingIndex > -1 && targetCart[editingIndex]) {
    const duplicateIdx = targetCart.findIndex((it, idx) => idx !== editingIndex && getItemSignature(it) === newSig);
    if (duplicateIdx > -1) {
      targetCart[duplicateIdx].qty = (targetCart[duplicateIdx].qty || 1) + (newItemObj.qty || 1);
      targetCart.splice(editingIndex, 1);
    } else {
      targetCart[editingIndex] = newItemObj;
    }
    return;
  }

  const existingIdx = targetCart.findIndex(it => getItemSignature(it) === newSig);
  if (existingIdx > -1) {
    targetCart[existingIdx].qty = (targetCart[existingIdx].qty || 1) + (newItemObj.qty || 1);
  } else {
    targetCart.push(newItemObj);
  }
}

function handleMenuItemClick(itemId, isPos = false) {
  const storeId = isPos ? state.merchantStoreId : state.selectedStoreId;
  const store = state.stores.find(s => s.id === storeId);
  if (!store) return;

  const item = (store.menus || []).find(i => String(i.id) === String(itemId));
  if (!item) return;

  if (item.soldOut) {
    showToast(t(`🚫 「${item.name}」今日已售罄，請挑選其他品項！`, `🚫 "${item.name}" is sold out today!`));
    return;
  }

  state.isPosConfiguring = isPos;
  state.editingCartIndex = -1;

  if (item.options && Object.keys(item.options).length > 0) {
    state.configuringItem = item;
    openOptionsModal(item, null);
  } else {
    addSimpleItemToCart(item, isPos);
  }
}

function addSimpleItemToCart(item, isPos) {
  const newItemObj = {
    id: item.id,
    name: item.name,
    baseName: item.name,
    basePrice: item.price,
    price: item.price,
    qty: 1,
    selections: {}
  };
  if (isPos) {
    mergeOrPushCartItem(state.posCart, newItemObj, -1);
    const store = state.stores.find(s => s.id === state.merchantStoreId);
    if (store) renderPosCashierPanel(store);
  } else {
    state.checkoutErrorBannerMsg = '';
    mergeOrPushCartItem(state.cartItems, newItemObj, -1);
    updateCartUI();
    showToast(t(`🛒 已加入購物車：${item.name}`, `🛒 Added to cart: ${trTerm(item.name)}`));
  }
}

function openOptionsModal(item, prefilledSelections = null) {
  document.getElementById('optModalTitle').innerText = trTerm(item.name);
  document.getElementById('optModalSubtitle').innerText = `${t('基本價格', 'Base Price')} NT$ ${item.price}`;

  const content = document.getElementById('optModalContent');
  content.innerHTML = '';

  Object.keys(item.options || {}).forEach(optName => {
    const grp = item.options[optName];
    const isRadio = !grp.type || grp.type === 'radio';
    const inputType = isRadio ? 'radio' : 'checkbox';
    const minSel = Math.max(0, parseInt(grp.minSelect || (isRadio ? 1 : 0), 10) || 0);
    const maxSel = Math.max(0, parseInt(grp.maxSelect || 0, 10) || 0);

    let ruleLabel = isRadio ? `* ${t('必選單選', 'Required')}` : t('可多選', 'Optional');
    if (!isRadio) {
      const hints = [];
      if (minSel > 0) hints.push(t(`最少選 ${minSel} 項`, `Min ${minSel}`));
      if (maxSel > 0) hints.push(t(`最多選 ${maxSel} 項`, `Max ${maxSel}`));
      if (hints.length > 0) ruleLabel = `${minSel > 0 ? '* ' : ''}${hints.join('・')}`;
    }
    const reqBadge = `<span style="color:${(isRadio || minSel > 0) ? 'var(--red)' : 'var(--brand)'}; font-size:0.74rem; font-weight:800; margin-left:6px;">${ruleLabel}</span>`;

    const choicesArray = grp.choices || grp || [];
    let prefilledValues = [];
    if (prefilledSelections && prefilledSelections[optName]) {
      const sel = prefilledSelections[optName];
      prefilledValues = Array.isArray(sel) ? sel : String(sel).split(', ');
    }

    let firstAvailIdx = choicesArray.findIndex(opt => !(Array.isArray(opt) && Boolean(opt[2])));
    if (firstAvailIdx < 0) firstAvailIdx = 0;

    const choicesHtml = choicesArray.map((opt, idx) => {
      const name = Array.isArray(opt) ? opt[0] : opt;
      const extra = Array.isArray(opt) ? Math.max(0, Number(opt[1]) || 0) : 0;
      const isChoiceSoldOut = Array.isArray(opt) ? Boolean(opt[2]) : false;
      const isChecked = !isChoiceSoldOut && (
        prefilledSelections
          ? prefilledValues.includes(name)
          : (isRadio && idx === firstAvailIdx)
      );

      return `
        <label class="option-label-row ${isChecked ? 'checked' : ''}" style="${isChoiceSoldOut ? 'opacity:0.5; background:#F1F5F9; cursor:not-allowed;' : ''}">
          <div style="display:flex; align-items:center; gap:10px;">
            <input type="${inputType}" name="optgrp-${escapeHtml(optName)}" value="${escapeHtml(name)}" data-extra="${extra}" data-soldout="${isChoiceSoldOut ? '1' : '0'}" ${isChecked ? 'checked' : ''} ${isChoiceSoldOut ? 'disabled' : ''} onchange="checkModalSelections()" style="width:18px; height:18px; accent-color:var(--brand);">
            <span style="font-weight:700; color:var(--text-primary); ${isChoiceSoldOut ? 'text-decoration:line-through;' : ''}">${escapeHtml(trTerm(name))}</span>
            ${isChoiceSoldOut ? `<span style="font-size:0.7rem; font-weight:900; background:#FEE2E2; color:#DC2626; padding:1px 6px; border-radius:4px;">🚫 已售罄</span>` : ''}
          </div>
          ${extra > 0 ? `<span style="font-weight:800; color:var(--brand); font-size:0.86rem;">+NT$${extra}</span>` : ''}
        </label>
      `;
    }).join('');

    content.insertAdjacentHTML('beforeend', `
      <div style="margin-bottom:16px;" data-opt-group="${escapeHtml(optName)}">
        <h4 style="font-size:0.95rem; font-weight:900; margin-bottom:8px; color:var(--text-primary);">${escapeHtml(trTerm(optName))} ${reqBadge}</h4>
        <div>${choicesHtml}</div>
      </div>
    `);
  });

  content.insertAdjacentHTML('beforeend', `
    <div style="margin-top:6px; padding-top:12px; border-top:1px dashed var(--border);">
      <label class="field-label" style="margin-bottom:5px;">📝 ${t('單品客製備註（選填，例如：不要蔥、醬料分開、去冰）', 'Item Note (Optional: e.g. no scallions, sauce on side)', '個別メモ（任意：ネギ抜き・ソース別添えなど）', '개별 요청사항 (선택: 파 빼기, 소스 따로 등)')}</label>
      <input type="text" id="optItemNoteInput" maxlength="60" class="select-input" placeholder="${t('僅針對此道餐點之特別需求...', 'Special request for this dish...')}" value="${escapeHtml((state.editingCartIndex > -1 && (state.isPosConfiguring ? state.posCart : state.cartItems)[state.editingCartIndex]?.itemNote) || '')}">
    </div>
  `);

  checkModalSelections();
  document.getElementById('optionsModal').classList.add('open');
}

function closeOptionsModal() {
  document.getElementById('optionsModal').classList.remove('open');
  state.configuringItem = null;
  state.editingCartIndex = -1;
}

function checkModalSelections() {
  const item = state.configuringItem;
  if (!item) return;

  let extra = 0;
  let allRequiredChecked = true;
  let constraintWarning = '';

  Object.keys(item.options || {}).forEach(cat => {
    const grp = item.options[cat];
    const isRadio = !grp.type || grp.type === 'radio';
    const minSel = Math.max(0, parseInt(grp.minSelect || (isRadio ? 1 : 0), 10) || 0);
    const maxSel = Math.max(0, parseInt(grp.maxSelect || 0, 10) || 0);
    const selector = `#optModalContent input[name="optgrp-${CSS.escape(cat)}"]`;
    const allInputs = Array.from(document.querySelectorAll(selector));
    const checkedInputs = allInputs.filter(inp => inp.checked);

    if (isRadio) {
      if (checkedInputs.length === 0) allRequiredChecked = false;
    } else {
      if (minSel > 0 && checkedInputs.length < minSel) {
        allRequiredChecked = false;
        constraintWarning = `「${cat}」請至少選擇 ${minSel} 項`;
      }
      if (maxSel > 0) {
        if (checkedInputs.length > maxSel) {
          allRequiredChecked = false;
          constraintWarning = `「${cat}」最多只能選擇 ${maxSel} 項`;
        }
        // #29 達到最多選擇數時，自動暫時鎖定其餘未勾選加料選項防誤選
        const reachedMax = checkedInputs.length >= maxSel;
        allInputs.forEach(inp => {
          if (inp.dataset.soldout === '1') {
            inp.disabled = true;
          } else {
            inp.disabled = reachedMax && !inp.checked;
          }
        });
      }
    }
  });

  document.querySelectorAll('#optModalContent .option-label-row').forEach(lbl => {
    const inp = lbl.querySelector('input');
    if (inp) lbl.classList.toggle('checked', inp.checked);
  });

  document.querySelectorAll('#optModalContent input:checked').forEach(sel => {
    extra += Math.max(0, parseFloat(sel.dataset.extra || 0));
  });

  const btn = document.getElementById('confirmOptionsBtn');
  if (allRequiredChecked) {
    btn.disabled = false;
    const finalPrice = Math.max(0, Number(item.price) + extra);
    btn.innerText = state.editingCartIndex > -1
      ? `${t('儲存變更', 'Save Changes')} (NT$ ${finalPrice})`
      : `${t('確認加入', 'Add to Cart')} (NT$ ${finalPrice})`;
  } else {
    btn.disabled = true;
    btn.innerText = constraintWarning || t('請完成必選項目', 'Please select required options');
  }
}

function confirmOptionsModal() {
  const item = state.configuringItem;
  if (!item) return;

  let extraTotal = 0;
  const selections = {};

  document.querySelectorAll('#optModalContent input:checked').forEach(r => {
    const cat = r.name.replace(/^optgrp-/, '');
    const grp = item.options[cat];
    const isCheckbox = grp && grp.type === 'checkbox';
    if (isCheckbox) {
      if (!selections[cat]) selections[cat] = [];
      selections[cat].push(r.value);
    } else {
      selections[cat] = r.value;
    }
    extraTotal += Math.max(0, parseFloat(r.dataset.extra || 0));
  });

  for (let key in selections) {
    if (Array.isArray(selections[key])) selections[key] = selections[key].join(', ');
  }

  const finalPrice = Math.max(0, Number(item.price) + extraTotal);
  const targetCart = state.isPosConfiguring ? state.posCart : state.cartItems;
  const currentQty = (state.editingCartIndex > -1 && targetCart[state.editingCartIndex])
    ? (targetCart[state.editingCartIndex].qty || 1)
    : 1;

  const itemNoteVal = String(document.getElementById('optItemNoteInput')?.value || '').trim().slice(0, 60);
  const newItemObj = {
    id: item.id,
    name: item.name,
    baseName: item.name,
    basePrice: item.price,
    price: finalPrice,
    qty: currentQty,
    selections: selections,
    itemNote: itemNoteVal
  };

  mergeOrPushCartItem(targetCart, newItemObj, state.editingCartIndex);

  if (state.editingCartIndex > -1) {
    showToast(t(`✅ 已更新選項：${item.name}`, `✅ Updated: ${trTerm(item.name)}`));
  } else if (!state.isPosConfiguring) {
    state.checkoutErrorBannerMsg = '';
    showToast(t(`🛒 已加入：${item.name}`, `🛒 Added: ${trTerm(item.name)}`));
  }

  if (state.isPosConfiguring) {
    const store = state.stores.find(s => s.id === state.merchantStoreId);
    if (store) renderPosCashierPanel(store);
  } else {
    updateCartUI();
  }
  closeOptionsModal();
}

function openCartModal() {
  if (state.cartItems.length === 0) return;
  ensureAudioContextUnlocked(false);
  state.checkoutErrorBannerMsg = '';
  const todayStr = getTodayDateStr();
  if (!state.checkoutReserveDate || normalizeDateStr(state.checkoutReserveDate) < todayStr) {
    state.checkoutReserveDate = todayStr;
  }
  updateCartUI();
  document.getElementById('cartModal').classList.add('open');
}

function closeCartModal() {
  document.getElementById('cartModal').classList.remove('open');
}

function editCartItemOptions(index, isPos = false) {
  const targetCart = isPos ? state.posCart : state.cartItems;
  const cartItem = targetCart[index];
  if (!cartItem) return;

  const storeId = isPos ? state.merchantStoreId : state.selectedStoreId;
  const store = state.stores.find(s => s.id === storeId);
  const originalMenuItem = store ? (store.menus || []).find(i => String(i.id) === String(cartItem.id)) : null;

  if (!originalMenuItem || !originalMenuItem.options || Object.keys(originalMenuItem.options).length === 0) {
    showToast(t('此品項無客製化選項可編輯', 'No customizable options for this item'));
    return;
  }

  state.isPosConfiguring = isPos;
  state.editingCartIndex = index;
  state.configuringItem = originalMenuItem;
  openOptionsModal(originalMenuItem, cartItem.selections);
}

function changeCartItemQty(index, delta) {
  if (!state.cartItems[index]) return;
  state.cartItems[index].qty = (state.cartItems[index].qty || 1) + delta;
  if (state.cartItems[index].qty <= 0) {
    state.cartItems.splice(index, 1);
  }
  state.checkoutErrorBannerMsg = '';
  updateCartUI();
}

function removeCartItem(index) {
  state.cartItems.splice(index, 1);
  state.checkoutErrorBannerMsg = '';
  updateCartUI();
}

function updateCartItemNote(index, noteVal) {
  if (!state.cartItems[index]) return;
  state.cartItems[index].itemNote = String(noteVal || '').trim().slice(0, 60);
  saveStudentCartDraft();
}

function setCheckoutMode(field, val) {
  state[field] = val;
  state.checkoutErrorBannerMsg = '';
  updateCartUI();
}
/**
 * ============================================================================
 * MealFlow - 前端核心引擎
 * Part 2A：時段配額購物車、白名單計價結帳、ISO QR 電子憑證、POS 收銀與會計級交班日結單
 * ============================================================================
 */

function updateCartUI() {
  const todayStr = getTodayDateStr();
  if (!state.checkoutReserveDate || normalizeDateStr(state.checkoutReserveDate) < todayStr) {
    state.checkoutReserveDate = todayStr;
  }
  saveStudentCartDraft();
  if (state.routeMode === 'order' && state.selectedStoreId) {
    renderInStoreMenuCards();
  }
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  const storeCutleryPrice = store && store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const totalCount = state.cartItems.reduce((sum, i) => sum + (i.qty || 1), 0);
  const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.checkoutNeedCutlery) ? storeCutleryPrice : 0;

  if (store && store.canOrderNow === false && state.checkoutTimeMode === 'NOW') {
    state.checkoutTimeMode = 'RESERVE';
  }

  const isReserve = state.checkoutTimeMode === 'RESERVE';
  let slotsWithQuota = [];
  if (isReserve) {
    slotsWithQuota = getValidPickupTimeSlotsWithQuota(state.checkoutReserveDate, store ? store.id : null);
    let availableTimes = slotsWithQuota.filter(s => !s.isFull).map(s => s.time);
    if (availableTimes.length === 0) {
      for (let off = 1; off <= 7; off++) {
        const candidateDate = getDateOffsetStr(off);
        const candSlots = getValidPickupTimeSlotsWithQuota(candidateDate, store ? store.id : null);
        const candAvail = candSlots.filter(s => !s.isFull).map(s => s.time);
        if (candAvail.length > 0) {
          state.checkoutReserveDate = candidateDate;
          slotsWithQuota = candSlots;
          availableTimes = candAvail;
          break;
        }
      }
    }
    if (!availableTimes.includes(state.checkoutReserveTime)) {
      state.checkoutReserveTime = availableTimes[0] || '12:15';
    }
  }

  // 【商業級改造 5】預訂 11:45~12:45 尖峰時段不套用離峰分流折扣與贈品
  const promoActive = store && isStorePromoActive(store, isReserve, state.checkoutReserveTime);
  const isPeakBlockedPromo = Boolean(
    store &&
    store.promoMode !== 'none' &&
    isReserve &&
    isPeakHourTimeSlot(state.checkoutReserveTime)
  );

  let discount = 0;
  if (subtotal >= AI_DISCOUNT_MIN_SUBTOTAL && promoActive && store.promoMode === 'discount') {
    discount = Math.min(subtotal, Number(store.promoDiscount) || 10);
  }
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);
  const isLargeOrderReserve = isReserve && finalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD;

  const viewCartBtn = document.getElementById('viewCartBtn');
  const countEl = document.getElementById('cartItemCountBadge');
  const previewTotalEl = document.getElementById('cartPreviewTotal');
  if (countEl) countEl.innerText = t(`${totalCount} 份`, `${totalCount} items`);
  if (previewTotalEl) previewTotalEl.innerText = `NT$ ${finalTotal}`;
  if (viewCartBtn) viewCartBtn.disabled = totalCount === 0;

  if (totalCount === 0 && document.getElementById('cartModal')?.classList.contains('open')) {
    closeCartModal();
  }

  const listDiv = document.getElementById('cartPageList');
  if (!listDiv) return;

  if (state.cartItems.length === 0) {
    listDiv.innerHTML = `
      <div style="text-align:center; padding:40px 0;">
        <p style="color:var(--text-muted); font-size:1.05rem; margin-bottom:12px;">${t('購物車目前沒有餐點', 'Your cart is empty')}</p>
        <button type="button" class="btn-tip-action" onclick="closeCartModal()">${t('去挑選餐點', 'Browse Menu')}</button>
      </div>
    `;
    return;
  }

  const errorBannerHtml = state.checkoutErrorBannerMsg ? `
    <div style="background:#FEF2F2; border:2px solid #EF4444; color:#991B1B; padding:12px 14px; border-radius:12px; margin-bottom:12px; font-size:0.84rem; font-weight:800; line-height:1.45;">
      <div style="font-size:0.92rem; font-weight:950; margin-bottom:3px;">🛑 ${t('雲端結帳檢核未通過', 'Checkout Validation Error')}</div>
      <div>${escapeHtml(state.checkoutErrorBannerMsg)}</div>
    </div>
  ` : '';

  const itemsCardsHtml = state.cartItems.map((item, idx) => {
    const selList = item.selections && Object.keys(item.selections).length > 0
      ? Object.entries(item.selections).map(([k, v]) => `${trTerm(k)}: ${trTerm(v)}`).join(' / ')
      : t('標準原味', 'Standard');
    const storeMenu = store ? (store.menus || []).find(m => String(m.id) === String(item.id)) : null;
    const canEdit = storeMenu && storeMenu.options && Object.keys(storeMenu.options).length > 0;
    const itemSubtotal = item.price * (item.qty || 1);

    return `
      <div style="background:#FFFFFF; padding:14px; border-radius:14px; border:1px solid var(--border); margin-bottom:10px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div style="min-width:0; flex:1;">
            <h4 style="font-size:1.02rem; font-weight:800; color:var(--text-primary);">${escapeHtml(storeMenu ? trDishName(storeMenu) : trTerm(item.baseName || item.name))}</h4>
            <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:3px;">${escapeHtml(selList)}</p>
          </div>
          <span style="font-size:1.05rem; font-weight:900; color:var(--red); white-space:nowrap;">NT$ ${itemSubtotal}</span>
        </div>

        <input type="text" maxlength="60" class="item-note-inline-input" placeholder="📝 ${t('單品備註（如：不要蔥、醬分開...）', 'Item note (e.g. no scallions, sauce on side)...', '個別メモ（ネギ抜きなど）...', '개별 요청 (파 빼기 등)...')}" value="${escapeHtml(item.itemNote || '')}" oninput="updateCartItemNote(${idx}, this.value)">

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:10px; border-top:1px solid #F3F4F6;">
          <div style="display:inline-flex; align-items:center; gap:8px; background:var(--bg-page); padding:3px 8px; border-radius:999px; border:1px solid var(--border);">
            <button type="button" onclick="changeCartItemQty(${idx}, -1)" style="border:none; background:#fff; width:24px; height:24px; border-radius:50%; font-weight:900;">－</button>
            <span style="font-weight:800; min-width:20px; text-align:center;">${item.qty || 1}</span>
            <button type="button" onclick="changeCartItemQty(${idx}, 1)" style="border:none; background:var(--brand); color:#fff; width:24px; height:24px; border-radius:50%; font-weight:900;">＋</button>
          </div>

          <div style="display:flex; gap:8px;">
            ${canEdit ? `<button type="button" onclick="editCartItemOptions(${idx}, false)" style="border:none; background:var(--brand-light); color:var(--brand-dark); font-weight:800; font-size:0.8rem; padding:6px 12px; border-radius:8px;">✎ ${t('編輯選項', 'Edit', '編集', '수정')}</button>` : ''}
            <button type="button" onclick="removeCartItem(${idx})" style="border:none; background:#F3F4F6; color:var(--text-secondary); font-weight:800; font-size:0.8rem; padding:6px 12px; border-radius:8px;">🗑️ ${t('移除', 'Remove', '削除', '삭제')}</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  let promoNoticeHtml = '';
  if (isPeakBlockedPromo) {
    promoNoticeHtml = `
      <div style="background:#FFFBEB; border:1.5px solid #F59E0B; border-radius:12px; padding:10px 14px; margin-bottom:10px; font-size:0.82rem; font-weight:800; color:#92400E;">
        ⚠️ 您選擇的預訂時段（${escapeHtml(state.checkoutReserveTime)}）為學餐午間尖峰（11:45~12:45），不適用「離峰分流優惠」。若改選 11:30 前或 13:00 後離峰時段即可享優惠！
      </div>
    `;
  } else if (promoActive) {
    if (store.promoMode === 'gift' || store.promoMode === 'freebie') {
      const giftKeywords = ['溫泉蛋', '溏心蛋', '滷蛋', '紅茶', '綠茶', '奶茶', '冬瓜茶', '豆漿', '味噌湯', '玉米濃湯', '酸辣湯', '豆腐', '小菜'];
      const matchedGiftKw = giftKeywords.find(kw => String(store.promoText || '').includes(kw));
      const isGiftMenuSoldOut = Boolean(matchedGiftKw && (store.menus || []).some(m => String(m.name || '').includes(matchedGiftKw) && m.soldOut));
      if (isGiftMenuSoldOut) {
        promoNoticeHtml = `
          <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:12px; padding:10px 14px; margin-bottom:10px; font-size:0.8rem; font-weight:800; color:var(--text-secondary);">
            ℹ️ ${t(`今日離峰贈品「${store.promoText}」已贈畢/售罄`, `Today's off-peak freebie is currently sold out`)}
          </div>
        `;
      } else if (subtotal < AI_DISCOUNT_MIN_SUBTOTAL) {
        promoNoticeHtml = `
          <div style="background:#FFFBEB; border:1.5px solid #F59E0B; border-radius:12px; padding:10px 14px; margin-bottom:10px; font-size:0.82rem; font-weight:800; color:#B45309;">
            💡 差 <strong>NT$ ${AI_DISCOUNT_MIN_SUBTOTAL - subtotal}</strong> 即可免費獲贈「${escapeHtml(store.promoText)}」（滿 $${AI_DISCOUNT_MIN_SUBTOTAL} 低消招待）
          </div>
        `;
      } else {
        promoNoticeHtml = `
          <label class="option-label-row ${state.checkoutWantGift !== false ? 'checked' : ''}" style="background:#ECFDF5; border:1.5px solid #10B981; border-radius:12px; padding:10px 14px; margin-bottom:10px; cursor:pointer;">
            <div style="display:flex; align-items:center; gap:10px;">
              <input type="checkbox" ${state.checkoutWantGift !== false ? 'checked' : ''} onchange="setCheckoutMode('checkoutWantGift', this.checked)" style="width:18px; height:18px; accent-color:#059669;">
              <div>
                <div style="font-size:0.84rem; font-weight:900; color:#065F46;">${escapeHtml(store.promoText)}</div>
                <div style="font-size:0.74rem; color:#047857; font-weight:700;">如對食材過敏或不需要贈品，可取消勾選</div>
              </div>
            </div>
            <span style="font-size:0.82rem; font-weight:900; color:#059669; white-space:nowrap;">${state.checkoutWantGift !== false ? 'NT$ 0 贈送' : '已取消贈品'}</span>
          </label>
        `;
      }
    } else if (store.promoMode === 'discount') {
      if (subtotal < AI_DISCOUNT_MIN_SUBTOTAL) {
        promoNoticeHtml = `
          <div style="background:#FFFBEB; border:1.5px solid #F59E0B; border-radius:12px; padding:10px 14px; margin-bottom:10px; font-size:0.82rem; font-weight:800; color:#B45309;">
            💡 差 <strong>NT$ ${AI_DISCOUNT_MIN_SUBTOTAL - subtotal}</strong> 即可享「${escapeHtml(store.promoText)}」（低消滿 $${AI_DISCOUNT_MIN_SUBTOTAL} 折抵）
          </div>
        `;
      } else {
        promoNoticeHtml = `
          <div style="background:#ECFDF5; border:1.5px solid #10B981; border-radius:12px; padding:10px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:0.84rem; font-weight:900; color:#065F46;">${escapeHtml(store.promoText)} (已達滿額 $${AI_DISCOUNT_MIN_SUBTOTAL})</span>
            <span style="font-size:0.88rem; font-weight:900; color:#059669;">-NT$ ${discount}</span>
          </div>
        `;
      }
    }
  }

  const selectedSlotMeta = isReserve
    ? (slotsWithQuota.find(s => s.time === state.checkoutReserveTime) || null)
    : null;

  const isCashSelected = state.checkoutPayMethod === '現場櫃檯付現';

  const checkoutSettingsHtml = `
    ${promoNoticeHtml}
    <div style="background:#FFFFFF; padding:16px; border-radius:14px; border:1px solid var(--border); margin-top:14px;">
      <h4 style="font-size:0.95rem; font-weight:900; margin-bottom:12px;">📋 ${t('取餐與結帳設定', 'Pickup & Checkout Options')}</h4>

      <label class="field-label">🍽️ ${t('用餐方式（皆為櫃檯叫號自取）', 'Dining Mode')}</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
        <button type="button" class="filter-chip ${state.checkoutDineType === '外帶自取' ? 'active' : ''}" onclick="setCheckoutMode('checkoutDineType', '外帶自取')">🛍️ ${t('外帶自取', 'Takeout')}</button>
        <button type="button" class="filter-chip ${state.checkoutDineType === '內用自取' ? 'active' : ''}" onclick="setCheckoutMode('checkoutDineType', '內用自取')">🍽️ ${t('內用自取', 'Dine-in')}</button>
      </div>

      <label class="option-label-row ${state.checkoutNeedCutlery ? 'checked' : ''}" style="margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <input type="checkbox" ${state.checkoutNeedCutlery ? 'checked' : ''} onchange="setCheckoutMode('checkoutNeedCutlery', this.checked)" style="width:18px; height:18px; accent-color:var(--brand);">
          <span style="font-weight:800; color:var(--text-primary);">🥢 ${t('需要一次性免洗餐具', 'Need Disposable Cutlery')}</span>
        </div>
        <span style="font-weight:900; color:var(--brand);">${storeCutleryPrice > 0 ? `+NT$ ${storeCutleryPrice}` : t('免費 ($0)', 'Free ($0)')}</span>
      </label>

      <label class="field-label">⏰ ${t('取餐時間（預訂訂單受 15 分鐘產能配額保護，於取餐前 25 分鐘自動排入廚房）', 'Pickup Time')}</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
        <button type="button" class="filter-chip ${state.checkoutTimeMode === 'NOW' ? 'active' : ''}" ${store && store.canOrderNow === false ? 'disabled style="opacity:0.45; cursor:not-allowed;"' : ''} onclick="setCheckoutMode('checkoutTimeMode', 'NOW')">
          ${store && store.canOrderNow === false ? escapeHtml(store.businessShortPillText || t('🔴 暫停立即製作', '🔴 Closed Now')) : t(`⚡ 立即製作 (約 ${store ? store.avgPrepMinutes : 5} 分)`, `⚡ Make Now (~${store ? store.avgPrepMinutes : 5}m)`)}
        </button>
        <button type="button" class="filter-chip ${state.checkoutTimeMode === 'RESERVE' ? 'active' : ''}" onclick="setCheckoutMode('checkoutTimeMode', 'RESERVE')">
          📅 ${t('預訂取餐', 'Pre-order')}
        </button>
      </div>

      ${isReserve ? `
        <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:12px; padding:12px; margin-bottom:12px;">
          <div class="checkout-reserve-grid">
            <div>
              <label class="field-label">📅 ${t('取餐日期 *', 'Pickup Date *')}</label>
              <input type="date" class="select-input" min="${getTodayDateStr()}" max="${getDateOffsetStr(14)}" value="${escapeHtml(state.checkoutReserveDate)}" onchange="setCheckoutMode('checkoutReserveDate', this.value)">
            </div>
            <div>
              <label class="field-label">🕒 ${t('預訂取餐時段 *', 'Time Slot (15m Quota) *')}</label>
              <select class="select-input" onchange="setCheckoutMode('checkoutReserveTime', this.value)">
                ${slotsWithQuota.map(s => `
                  <option value="${s.time}" ${state.checkoutReserveTime === s.time ? 'selected' : ''} ${s.isFull || s.remaining < totalCount ? 'disabled' : ''}>
                    ${s.time} ${s.isFull ? t('(已額滿)', '(Full)') : s.remaining < totalCount ? t(`(剩 ${s.remaining} 份，不足本次 ${totalCount} 份)`, `(${s.remaining} left < ${totalCount})`) : t(`(剩餘 ${s.remaining} 份產能${s.isPeak ? '・尖峰' : '・離峰'})`, `(${s.remaining} portions left)`)}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
          ${selectedSlotMeta ? `
            <div class="slot-quota-info">
              <span class="slot-quota-badge ${selectedSlotMeta.remaining <= 5 ? 'busy' : 'free'}">
                📊 ${t(`時段產能配額：已預訂 ${selectedSlotMeta.booked}/${selectedSlotMeta.maxCap} 份（尚餘 ${selectedSlotMeta.remaining} 份・本次點 ${totalCount} 份）`, `Slot Quota: ${selectedSlotMeta.booked}/${selectedSlotMeta.maxCap} portions (${selectedSlotMeta.remaining} left)`)}
              </span>
              <span style="color:var(--text-secondary);">
                ${selectedSlotMeta.isPeak ? t('🔥 午間尖峰時段（原價供應）', '🔥 Peak Hours') : t('🟢 離峰順暢時段（適用分流優惠）', '🟢 Off-Peak')}
              </span>
            </div>
          ` : ''}
          ${isLargeOrderReserve && state.checkoutPayMethod === '現場櫃檯付現' ? `
            <div style="margin-top:8px; background:#FFFBEB; border:1px solid #F59E0B; color:#92400E; padding:8px 10px; border-radius:8px; font-size:0.76rem; font-weight:800;">
              💡 大額團訂（滿 NT$${LARGE_ORDER_DEPOSIT_THRESHOLD}）選擇現金付款時，訂單狀態將列為「待付款確認」，請於取餐前至櫃檯確認或改選行動支付。
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div style="margin-bottom:12px;">
        <label class="field-label" style="color:${(isReserve || isCashSelected) ? 'var(--red)' : 'var(--brand-dark)'};">
          📱 ${t('聯絡手機號碼', 'Mobile Phone')} ${(isReserve || isCashSelected) ? t('*（預訂與付現必填完整手機號碼）', '* (Required for Pre-order / Cash)') : t('（選填，搭配取餐號可跨裝置找回取餐單）', '(Optional)')}
        </label>
        <input type="tel" id="checkoutPhoneInput" class="select-input" placeholder="${(isReserve || isCashSelected) ? '請輸入完整手機號碼，例如：0912345678' : '輸入手機號碼或末 3 碼（如 678），清除快取也能驗證找回'}" value="${escapeHtml(state.checkoutPhone)}" oninput="state.checkoutPhone=this.value">
      </div>

      <div class="checkout-two-col-grid" style="margin-bottom:10px;">
        <div>
          <label class="field-label">💳 ${t('付款方式', 'Payment Method')}</label>
          <select class="select-input" onchange="setCheckoutMode('checkoutPayMethod', this.value)">
            <option value="LINE Pay" ${state.checkoutPayMethod === 'LINE Pay' ? 'selected' : ''}>LINE Pay 行動支付</option>
            <option value="現場櫃檯付現" ${state.checkoutPayMethod === '現場櫃檯付現' ? 'selected' : ''}>
              ${isLargeOrderReserve ? t('現場櫃檯付訂確認 (大額團訂)', 'Cash Deposit at Counter') : t('取餐時櫃檯付現', 'Pay Cash at Pickup')}
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">🧾 ${t('統一編號 (8碼，選填)', 'Tax ID (8 digits, optional)')}</label>
          <input type="text" maxlength="8" inputmode="numeric" class="select-input" placeholder="如：12345678" value="${escapeHtml(state.checkoutTaxId || '')}" oninput="state.checkoutTaxId=this.value.replace(/\\D/g,'').slice(0,8)">
        </div>
      </div>

      <div>
        <label class="field-label">📝 ${t('飲食備註 (選填)', 'Order Notes (Optional)')}</label>
        <input type="text" class="select-input" placeholder="${t('例：飯少、湯分開裝、不要蔥', 'e.g. Less rice, sauce on side')}" value="${escapeHtml(state.checkoutNote)}" oninput="state.checkoutNote=this.value">
      </div>
    </div>
  `;

  listDiv.innerHTML = errorBannerHtml + itemsCardsHtml + checkoutSettingsHtml;

  const modalTotalEl = document.getElementById('cartModalTotal');
  if (modalTotalEl) {
    const tags = [];
    if (cutleryFee > 0) tags.push(`含免洗餐具+$${cutleryFee}`);
    if (discount > 0) tags.push(`離峰折抵-$${discount}`);
    modalTotalEl.innerHTML = tags.length > 0
      ? `<span style="font-size:0.8rem; color:var(--green); margin-right:6px;">(${tags.join(' / ')})</span>NT$ ${finalTotal}`
      : `NT$ ${finalTotal}`;
  }
  if (state.lang && state.lang !== 'zh-TW') {
    applyDomSystemTranslation(document.getElementById('cartModal'));
    applyDomSystemTranslation(document.getElementById('floatingCartBar'));
  }
}

async function submitStudentCartOrder() {
  let store = state.stores.find(s => s.id === state.selectedStoreId);
  if (!store || state.cartItems.length === 0) return;

  // #1 關鍵修正：必須在使用者點擊「確認餐點並送出訂單」手勢當下（任何 await 之前）同步解鎖音訊與請求通知權限，否則 iOS Safari / Android Chrome 會在 await 後丟失 User Gesture！
  ensureAudioContextUnlocked(false);
  updateBackgroundSilentAudioKeepAlive();
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) {}

  state.checkoutErrorBannerMsg = '';

  if (navigator.onLine === false) {
    state.checkoutErrorBannerMsg = '偵測到您目前處於離線或飛航模式。為確保交易安全與廚房即時接單，線上點餐必須保持網路連線，請恢復網路後再試！';
    updateCartUI();
    showToast('🚫 網路已中斷，無法進行線上結帳！');
    return;
  }

  // 防濫用與頻率限制 (B2)：防止短時間重複連點或腳本洗單
  if (state.lastStudentSubmitTs && (Date.now() - state.lastStudentSubmitTs) < 6000) {
    showToast('⏳ 訂單剛送出處理中，請勿短時間重複點擊！');
    return;
  }

  // #43 結帳前即時購物車有效性與菜單變更同步檢查 (Pre-Checkout Cart Validation)
  const btn = document.getElementById('finalSubmitOrderBtn');
  if (Date.now() - (state.lastCloudSyncDoneTs || 0) > 3500) {
    if (btn) {
      btn.disabled = true;
      btn.innerText = '⏳ 正在與店家同步最新菜單庫存與營業狀態...';
    }
    try {
      await syncCloud(false);
    } catch (e) {}
    if (btn) {
      btn.disabled = false;
      btn.innerText = '確認餐點並送出訂單';
    }
    store = state.stores.find(s => s.id === state.selectedStoreId) || store;
  }

  // #21 & #43：檢查店家是否剛打烊、進入午休時段或公休
  if (store.canOrderNow === false && state.checkoutTimeMode === 'NOW') {
    state.checkoutTimeMode = 'RESERVE';
    state.checkoutErrorBannerMsg = `「${store.name}」${store.businessStatusLabel || '目前已暫停立即出餐'}，系統已自動為您切換為「📅 預訂取餐」模式，請確認預訂時段與聯絡電話後再次送出！`;
    updateCartUI();
    showToast('⚠️ 店家目前非立即出餐時段，已為您切換為「預訂取餐」模式！');
    return;
  }

  // #43：逐一檢查購物車內每個品項是否已下架、已售罄或單價/加購價已調整
  const priceChangedNotices = [];
  for (let i = 0; i < state.cartItems.length; i++) {
    const ci = state.cartItems[i];
    const dbMenu = (store.menus || []).find(menu => String(menu.id) === String(ci.id) || String(menu.name).trim() === String(ci.baseName || ci.name).trim());
    if (!dbMenu) {
      state.checkoutErrorBannerMsg = `購物車內的「${ci.baseName || ci.name}」已被店家下架或停售，請先移除該品項後再結帳。`;
      updateCartUI();
      showToast(`🚫 抱歉，「${ci.baseName || ci.name}」已停售！`);
      return;
    }
    if (dbMenu.soldOut) {
      state.checkoutErrorBannerMsg = `購物車內的「${dbMenu.name}」剛剛已售罄，請先移除該品項後再結帳。`;
      updateCartUI();
      showToast(`🚫 抱歉，「${dbMenu.name}」今日已售罄！`);
      return;
    }
    // #14 檢查每日限量剩餘庫存
    if (Number(dbMenu.dailyLimit) > 0 && dbMenu.remainingToday !== null && dbMenu.remainingToday !== undefined) {
      const reqQtyForMenu = state.cartItems
        .filter(x => String(x.id) === String(dbMenu.id))
        .reduce((s, x) => s + (Number(x.qty) || 1), 0);
      if (reqQtyForMenu > Number(dbMenu.remainingToday)) {
        state.checkoutErrorBannerMsg = `「${dbMenu.name}」今日限量 ${dbMenu.dailyLimit} 份，目前僅剩 ${dbMenu.remainingToday} 份（您的購物車共有 ${reqQtyForMenu} 份），請減少數量後再送出！`;
        updateCartUI();
        showToast(`⚠️ 「${dbMenu.name}」今日限量僅剩 ${dbMenu.remainingToday} 份！`);
        return;
      }
    }
    // 重新計算最新白名單單價與選項加價
    let calcExtra = 0;
    const selObj = ci.selections || {};
    const dbOpts = dbMenu.options || {};
    Object.keys(dbOpts).forEach(grpName => {
      const grp = dbOpts[grpName];
      const choices = Array.isArray(grp.choices) ? grp.choices : (Array.isArray(grp) ? grp : []);
      const priceMap = {};
      choices.forEach(c => {
        const cName = String(Array.isArray(c) ? c[0] : c).trim();
        priceMap[cName] = Array.isArray(c) ? Math.max(0, Number(c[1]) || 0) : 0;
      });
      const chosenVal = selObj[grpName];
      if (chosenVal) {
        String(chosenVal).split(',').map(s => s.trim()).filter(Boolean).forEach(sName => {
          if (priceMap[sName] !== undefined) calcExtra += priceMap[sName];
        });
      }
    });
    const latestUnitPrice = Math.max(0, Number(dbMenu.price || 0) + calcExtra);
    if (Number(ci.price) !== latestUnitPrice) {
      priceChangedNotices.push(`「${dbMenu.name}」單價由 NT$${ci.price} 更新為 NT$${latestUnitPrice}`);
      ci.basePrice = Number(dbMenu.price || 0);
      ci.price = latestUnitPrice;
    }
  }

  if (priceChangedNotices.length > 0) {
    saveStudentCartDraft();
    state.checkoutErrorBannerMsg = `店家剛剛調整了菜單價格（${priceChangedNotices.join('、')}），系統已自動更新購物車最新金額，請確認無誤後再次點擊「確認餐點並送出訂單」！`;
    updateCartUI();
    showToast('⚠️ 菜單價格有異動，已自動更新購物車總金額，請確認後再按送出！');
    return;
  }

  const isReserve = state.checkoutTimeMode === 'RESERVE';
  const isCashOrder = state.checkoutPayMethod === '現場櫃檯付現';
  const cleanPhone = (state.checkoutPhone || '').replace(/\D/g, '');
  const cleanTaxId = (state.checkoutTaxId || '').replace(/\D/g, '');

  if (cleanTaxId && cleanTaxId.length !== 8) {
    state.checkoutErrorBannerMsg = '統一編號格式錯誤，請輸入 8 位數字或留空。';
    updateCartUI();
    showToast('⚠️ 統一編號須為 8 位數字！');
    return;
  }

  // #20 防棄單保護：預訂取餐或選擇「取餐時櫃檯付現」皆強制驗證有效 10 碼台灣手機號碼 (09xxxxxxxx)
  if (isReserve || isCashOrder) {
    if (!/^09\d{8}$/.test(cleanPhone)) {
      state.checkoutErrorBannerMsg = isCashOrder
        ? '選擇「取餐時櫃檯付現」必須填寫有效的 10 碼手機號碼（09xxxxxxxx），以利櫃檯核對並防止惡作劇棄單。'
        : '預訂取餐必須填寫有效的 10 碼聯絡手機號碼（09xxxxxxxx）。';
      updateCartUI();
      showToast('⚠️ 請填寫有效的 10 碼手機號碼（如 0912345678）！');
      document.getElementById('checkoutPhoneInput')?.focus();
      return;
    }
    if (isCashOrder) {
      const todayStr = getTodayDateStr();
      const myUnpaidActiveCashOrders = getMyTrackedOrdersList().filter(o =>
        normalizeDateStr(o.pickupDate) === todayStr &&
        !String(o.status).includes('已取消') &&
        o.status !== '已完成' &&
        !isOrderConsiderPaid(o)
      );
      if (myUnpaidActiveCashOrders.length >= 2) {
        state.checkoutErrorBannerMsg = '您目前已有 2 筆尚未至櫃檯付款領取的現金訂單，請先完成領取付款或改用 LINE Pay 結帳。';
        updateCartUI();
        showToast('🛑 未付款現金單已達上限 (2筆)，請先至櫃檯取餐付款！');
        return;
      }
    }
  }

  if (isReserve) {
    const slotsWithQuota = getValidPickupTimeSlotsWithQuota(state.checkoutReserveDate, store.id);
    const targetSlot = slotsWithQuota.find(s => s.time === state.checkoutReserveTime);
    const totalReqPortions = state.cartItems.reduce((s, i) => s + (Number(i.qty) || 1), 0);
    if (!targetSlot || targetSlot.isFull || targetSlot.remaining < totalReqPortions) {
      state.checkoutErrorBannerMsg = targetSlot && (targetSlot.isFull || targetSlot.remaining < totalReqPortions)
        ? `抱歉，${state.checkoutReserveDate} ${state.checkoutReserveTime} 時段僅剩 ${targetSlot.remaining} 份產能配額（本次購物車共 ${totalReqPortions} 份，上限 ${targetSlot.maxCap} 份），請改選相鄰可用時段！`
        : '您選擇的預訂時段已過期或非營業時間，系統已重新調整時段，請確認後再次送出。';
      updateCartUI();
      showToast('⚠️ 該預訂時段產能配額不足或已過期，請重新選擇時段！');
      return;
    }
  }

  if (cleanPhone.length >= 3) {
    state.savedCustomerPhone = state.checkoutPhone.trim();
    try { localStorage.setItem('mealflow_saved_customer_phone_v12', state.savedCustomerPhone); } catch (e) {}
  }

  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = state.checkoutNeedCutlery ? storeCutleryPrice : 0;
  const promoActive = isStorePromoActive(store, isReserve, state.checkoutReserveTime);
  const discount = (subtotal >= AI_DISCOUNT_MIN_SUBTOTAL && promoActive && store.promoMode === 'discount')
    ? Math.min(subtotal, Number(store.promoDiscount) || 10)
    : 0;
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);
  const promoApplied = promoActive ? store.promoText : '一般點餐';
  const generatedOrderId = generateOrderToken();

  let transactionId = '';
  let paymentAuthToken = '';
  if (state.checkoutPayMethod === 'LINE Pay') {
    const payResult = await requestOnlinePaymentGateway(state.checkoutPayMethod, finalTotal, store.name, store.id, generatedOrderId);
    if (!payResult || !payResult.approved || !payResult.paymentAuthToken) {
      showToast('已取消線上支付授權');
      return;
    }
    transactionId = payResult.transactionId || '';
    paymentAuthToken = payResult.paymentAuthToken || '';
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ 正在向雲端伺服器進行白名單計價與防偽簽章...';
  }

  const isLargeOrderCashReserve = isReserve && finalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD && state.checkoutPayMethod === '現場櫃檯付現';
  const paymentDeadline = isLargeOrderCashReserve ? normalizeDateStr(state.checkoutReserveDate) : '';
  const paymentStatus = isLargeOrderCashReserve
    ? '待櫃檯繳費'
    : (state.checkoutPayMethod === '現場櫃檯付現' ? '取餐付現' : '已付款');

  const pickupDateVal = isReserve ? normalizeDateStr(state.checkoutReserveDate) : getTodayDateStr();
  const nowTime = getTaipeiTimeHHMMSS();
  const pickupTimeVal = isReserve ? state.checkoutReserveTime : nowTime.slice(0, 5);
  const pickupTimeSlot = isReserve
    ? `📅 預訂 ${pickupDateVal} ${state.checkoutReserveTime}`
    : `⚡ 立即製作 (約${store.avgPrepMinutes}分)`;

  const structuredItems = state.cartItems.map(i => normalizeOrderItemEntry({
    id: i.id,
    baseName: i.baseName || i.name,
    basePrice: i.basePrice !== undefined ? i.basePrice : i.price,
    price: i.price,
    qty: i.qty || 1,
    selections: i.selections || {},
    snapshotAtTs: Date.now()
  }));

  if (promoActive && (store.promoMode === 'gift' || store.promoMode === 'freebie') && store.promoText && subtotal >= AI_DISCOUNT_MIN_SUBTOTAL && state.checkoutWantGift !== false) {
    structuredItems.push(normalizeOrderItemEntry({
      id: 'GIFT-AI',
      baseName: `${store.promoText} (贈品)`,
      basePrice: 0,
      price: 0,
      qty: 1,
      selections: {},
      isGift: true,
      snapshotAtTs: Date.now()
    }));
  }

  const requestOrderPayload = {
    orderId: generatedOrderId,
    storeId: store.id,
    storeName: store.name,
    studentId: isReserve ? '📅 預訂點餐' : '📱 掃碼點餐',
    dineType: state.checkoutDineType,
    customerNote: (state.checkoutNote || '').trim(),
    taxId: cleanTaxId,
    structuredItems,
    subtotal,
    cutleryFee,
    needCutlery: state.checkoutNeedCutlery,
    wantGift: state.checkoutWantGift !== false,
    discount,
    manualDiscount: 0,
    finalTotal,
    promoApplied,
    pickupTimeSlot,
    paymentMethod: state.checkoutPayMethod,
    isReservation: isReserve,
    pickupDate: pickupDateVal,
    pickupTime: pickupTimeVal,
    paidAtDate: getTodayDateStr(),
    customerPhone: (state.checkoutPhone || '').trim(),
    paymentDeadline,
    paymentStatus,
    transactionId,
    paymentAuthToken,
    clientDeviceId: state.clientDeviceId,
    notifyCount: 0,
    lineUserId: state.lineProfile.lineUserId || '',
    customerEmail: state.lineProfile.email || '',
    isDivertedOrder: promoActive,
    createdAt: nowTime,
    createdAtTs: getCalibratedNowMs(),
    cookingStartedAtTs: isReserve ? 0 : getCalibratedNowMs()
  };

  let authoritativeOrder = null;

  try {
    setSyncState('syncing', '雲端驗算與核發防偽碼中...');
    let data = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 16000) : null;
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          action: 'submitOrder',
          ...requestOrderPayload,
          orderSource: requestOrderPayload.studentId,
          campus: store.campus,
          items: structuredItems
        })
      });
      if (timeoutId) clearTimeout(timeoutId);
      data = await res.json();
      if (data && !data.success && String(data.message || '').includes('系統尖峰') && attempt < 2) {
        await new Promise(r => setTimeout(r, 1100 * (attempt + 1)));
        continue;
      }
      break;
    }

    if (!data || !data.success || !data.order || !data.order.pickupNumber || !data.order.verificationCode) {
      throw new Error((data && data.message) || '雲端伺服器白名單計價驗算或防偽簽章未通過');
    }

    authoritativeOrder = sanitizeIncomingOrder({
      ...requestOrderPayload,
      ...data.order,
      customerPhone: requestOrderPayload.customerPhone,
      taxId: cleanTaxId,
      isOfflinePending: false
    });

    state.lastStudentSubmitTs = Date.now();
    syncLocalSeqWithAuthoritativeNumber(store.id, pickupDateVal, authoritativeOrder.pickupNumber);
    setSyncState('online', '已同步');
  } catch (err) {
    setSyncState('offline', '結帳連線異常');
    const rawMsg = (err && err.name === 'AbortError')
      ? '連線雲端伺服器超時（超過 16 秒）。請檢查網路連線後重試。'
      : ((err && err.message) ? err.message : '無法連線至雲端點餐伺服器');

    state.checkoutErrorBannerMsg = `結帳未完成：${rawMsg}（您的購物車內容已完整保留，請確認後再試一次）`;
    updateCartUI();
    showToast(`🚫 結帳失敗：${rawMsg}`);
    if (btn) {
      btn.disabled = false;
      btn.innerText = '確認餐點並送出訂單';
    }
    return;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '確認餐點並送出訂單';
    }
  }

  state.pendingLocalOrdersMap[authoritativeOrder.orderId] = Date.now();
  state.knownStoreOrderIds.add(authoritativeOrder.orderId);
  state.orders.unshift(authoritativeOrder);
  addOrderToMyHistory(authoritativeOrder.orderId);
  saveCachedOrders(state.orders);
  state.lastSeenOrderNotifyMap[authoritativeOrder.orderId] = { status: authoritativeOrder.status, notifyCount: 0 };

  enrichStoresAndAi();
  saveLocalStores(state.stores);

  recordLocalPushNotificationLog(
    isLargeOrderCashReserve ? 'ORDER_RESERVE_UNPAID' : 'ORDER_CREATED',
    isLargeOrderCashReserve ? `⏳ 大額預訂單 #${authoritativeOrder.pickupNumber} 待確認` : `🟢 訂單 #${authoritativeOrder.pickupNumber} 已成立 (${authoritativeOrder.status})`,
    `【${store.name}】${pickupTimeSlot}，應付 NT$${authoritativeOrder.finalTotal} (${authoritativeOrder.paymentMethod})，防偽核銷碼：${authoritativeOrder.verificationCode}。`,
    authoritativeOrder
  );

  state.cartItems = [];
  if (state.cartByStoreMap && store && store.id) {
    delete state.cartByStoreMap[store.id];
  }
  state.checkoutNote = '';
  state.checkoutErrorBannerMsg = '';
  saveStudentCartDraft();
  closeCartModal();
  navigateToOrderTicket(authoritativeOrder.orderId);
  syncWatchedOrdersToServiceWorker(true);
  updateBackgroundSilentAudioKeepAlive();
  requestMerchantWakeLock();
  showToast(`🎉 點餐成功！單號 #${authoritativeOrder.pickupNumber}（核銷碼 ${authoritativeOrder.verificationCode}）`);
}

// ==================== 4. 智慧選餐顧問 ====================
async function askAiConcierge(presetQuery) {
  const inputEl = document.getElementById('aiUserQueryInput');
  const query = (presetQuery || (inputEl ? inputEl.value.trim() : '')).trim();
  if (!query) {
    showToast('💬 請輸入您的問題或點擊上方快捷標籤！');
    inputEl?.focus();
    return;
  }
  if (inputEl) inputEl.value = '';

  state.aiChatMessages.push({
    role: 'user',
    text: query,
    time: getTaipeiTimeHHMM()
  });

  const respBox = document.getElementById('aiConciergeResponse');
  if (!respBox) return;
  respBox.classList.add('show');
  renderAiChatRoom(true);

  enrichStoresAndAi();
  const openCampusStores = state.stores.filter(s => s.campus === state.campus && s.isOpen !== false);
  const fallbackCampusStores = state.stores.filter(s => s.campus === state.campus);
  const activeStoresPool = openCampusStores.length > 0 ? openCampusStores : fallbackCampusStores;
  if (activeStoresPool.length === 0) return;

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'askAiConcierge',
        campus: state.campus,
        query: query
      })
    });
    const data = await res.json();
    if (data && data.success && data.aiResult && data.aiResult.engine && data.aiResult.engine.includes('Gemini')) {
      appendAiAssistantReply(data.aiResult);
      return;
    }
  } catch (e) {}

  const q = query.toLowerCase();
  const fastestStore = activeStoresPool.slice().sort((a, b) => a.avgPrepMinutes - b.avgPrepMinutes || b.aiScore - a.aiScore)[0];
  const busiestStore = activeStoresPool.slice().sort((a, b) => b.avgPrepMinutes - a.avgPrepMinutes)[0];
  const actualWaitDiff = busiestStore.avgPrepMinutes - fastestStore.avgPrepMinutes;
  const firstAvailDish = (fastestStore.menus || []).find(m => !m.soldOut) || fastestStore.menus[0];

  if (/^(你好|您好|哈囉|嗨|hi|hello|hey|在嗎|你是誰|測試|早安|午安|晚安|幹嘛|能做什麼)[！!？?\s]*$/i.test(q)) {
    const storeNames = activeStoresPool.map(s => `${s.name}(約${s.avgPrepMinutes}分)`).join('、');
    appendAiAssistantReply({
      reasoning: `👋 你好！我是 MealFlow 智慧選餐顧問。目前「${state.campus}」正常營業中的餐廳有：${storeNames}。你可以直接問我：「推薦 $100 內不排隊的餐」、「想吃辣的麵」、「哪家有送優惠？」或「無痕模式怎麼找回訂單？」，我會自動幫你排除已售罄品項與休息中店家！`,
      storeId: fastestStore.id,
      menuId: firstAvailDish.id,
      engine: 'MealFlow 快速條件篩選助手'
    });
    return;
  }

  if (q.includes('預訂') || q.includes('預約') || q.includes('現金') || q.includes('付錢') || q.includes('付款') || q.includes('餐具') || q.includes('找回') || q.includes('查單') || q.includes('無痕')) {
    appendAiAssistantReply({
      reasoning: `📋 取餐與查單說明：1️⃣ 為保護點餐隱私，跨裝置或無痕視窗查單請輸入「6 碼防偽核銷碼」，或「4 碼取餐號 + 手機末 3 碼」雙重驗證找回。2️⃣ 每張電子取餐單與現場小票皆附有標準可掃描 ISO QR Code 供手機追蹤進度與櫃檯鏡頭秒速核銷。3️⃣ 離峰優惠限「立即製作」或「非 11:45~12:45 尖峰之預訂時段」使用！`,
      storeId: fastestStore.id,
      menuId: firstAvailDish.id,
      engine: 'MealFlow 快速條件篩選助手'
    });
    return;
  }

  const candidates = [];
  activeStoresPool.forEach(s => {
    (s.menus || []).forEach(m => {
      if (m.soldOut) return;
      const isDrinkOrSide = m.price <= 45 && (m.name.includes('茶') || m.name.includes('湯') || m.name.includes('飲') || m.name.includes('豆漿') || m.name.includes('豆腐'));
      let score = s.aiScore + (isDrinkOrSide ? -20 : 10);
      const hitReasons = [];

      if (q.includes('趕') || q.includes('10分') || q.includes('快') || q.includes('免排隊') || q.includes('不排隊')) {
        score += Math.max(0, (22 - s.avgPrepMinutes) * 3.5);
        hitReasons.push(`目前佇列順暢僅需約 ${s.avgPrepMinutes} 分鐘`);
      }

      const budgetMatch = q.match(/(\d{2,3})\s*(?:元|塊|以內|內)/) || (q.includes('100') ? [null, '100'] : null);
      if (budgetMatch || q.includes('預算') || q.includes('便宜') || q.includes('cp') || q.includes('優惠') || q.includes('折')) {
        const limit = budgetMatch ? parseInt(budgetMatch[1], 10) : 100;
        const netPrice = m.price - (m.price >= AI_DISCOUNT_MIN_SUBTOTAL ? (s.promoDiscount || 0) : 0);
        if (netPrice <= limit && !isDrinkOrSide) {
          score += 42;
          hitReasons.push(`價格 NT$${m.price} 符合 $${limit} 內高划算度預算`);
        } else if (netPrice > limit) {
          score -= 30;
        }
        if (s.promoMode !== 'none') {
          score += 20;
          hitReasons.push(`搭配「${s.promoText}」`);
        }
      }

      if (q.includes('辣') || q.includes('韓') || q.includes('椒麻') || q.includes('重口味') || q.includes('泡菜') || q.includes('紅油') || q.includes('川味')) {
        if (m.name.includes('椒麻') || m.name.includes('泡菜') || m.name.includes('辣') || m.name.includes('紅油') || m.name.includes('蔥爆') || m.name.includes('咖哩')) {
          score += 55;
          hitReasons.push(`香辣夠味符合您的重口味偏好`);
        }
      }

      if (q.includes('肉') || q.includes('蛋白') || q.includes('運動') || q.includes('大份') || q.includes('飽') || q.includes('牛') || q.includes('豬') || q.includes('雞')) {
        if (m.name.includes('牛') || m.name.includes('豬排') || m.name.includes('雞腿') || m.name.includes('白肉') || m.name.includes('排骨') || m.name.includes('漢堡排')) {
          score += 48;
          hitReasons.push(`大份量肉食主餐、蛋白質充足`);
        }
      }

      ['烏龍', '麵', '水餃', '鍋貼', '飯捲', '丼', '便當', '咖哩', '涼麵', '抄手', '炸雞', '豆腐', '湯', '茶', '豆漿'].forEach(kw => {
        if (q.includes(kw) && (m.name.includes(kw) || (m.category && m.category.includes(kw)))) {
          score += 65;
          hitReasons.push(`精準命中您想吃的「${kw}」`);
        }
      });

      candidates.push({ store: s, menu: m, totalScore: Math.round(score), hitReasons });
    });
  });

  candidates.sort((a, b) => b.totalScore - a.totalScore);
  const best = candidates[0] || { store: fastestStore, menu: firstAvailDish, hitReasons: ['店內熱銷且目前正常供應中'] };
  const alternatives = candidates.slice(1, 3);

  let queueNote = `目前「${best.store.name}」佇列順暢，約 ${best.store.avgPrepMinutes} 分鐘即可取餐`;
  if (busiestStore.id !== best.store.id && actualWaitDiff >= 4) {
    queueNote = `目前「${busiestStore.name}」需等候約 ${busiestStore.avgPrepMinutes} 分鐘，改點「${best.store.name}」僅需 ${best.store.avgPrepMinutes} 分鐘（省下 ${actualWaitDiff} 分鐘）`;
  }

  const whyText = best.hitReasons.length > 0
    ? best.hitReasons.join('，且')
    : `為校區內綜合評價 (${best.store.rating}★) 與出餐效率最佳的主廚招牌`;

  appendAiAssistantReply({
    reasoning: `💡 為您推薦「${best.store.name}」正常供應中的【${best.menu.name} (NT$${best.menu.price})】！原因：${whyText}。${queueNote}${best.store.promoMode !== 'none' ? `，立即製作再享「${best.store.promoText}」！` : '。'}`,
    storeId: best.store.id,
    menuId: best.menu.id,
    alternatives: alternatives.map(a => ({
      storeId: a.store.id,
      storeName: a.store.name,
      waitMin: a.store.avgPrepMinutes,
      menuId: a.menu.id,
      menuName: a.menu.name,
      price: a.menu.price
    })),
    engine: 'MealFlow 快速條件篩選助手'
  });
}

function appendAiAssistantReply(aiResult) {
  state.aiChatMessages.push({
    role: 'assistant',
    aiResult,
    time: getTaipeiTimeHHMM()
  });
  renderAiChatRoom(false);
}

function clearAiChatHistory() {
  state.aiChatMessages = [];
  const respBox = document.getElementById('aiConciergeResponse');
  if (respBox) {
    respBox.classList.remove('show');
    respBox.innerHTML = '';
  }
}

function renderAiChatRoom(isLoading = false) {
  const respBox = document.getElementById('aiConciergeResponse');
  if (!respBox) return;

  const campusStores = state.stores.filter(s => s.campus === state.campus);

  const historyHtml = state.aiChatMessages.map(msg => {
    if (msg.role === 'user') {
      return `
        <div class="chat-msg-row user">
          <div class="chat-bubble">${escapeHtml(msg.text)}</div>
        </div>
      `;
    }

    const aiResult = msg.aiResult || {};
    const targetStore = state.stores.find(s => s.id === aiResult.storeId || s.name === aiResult.storeId) || campusStores[0] || state.stores[0];
    const targetMenu = (targetStore.menus || []).find(m => (m.id === aiResult.menuId || m.name === aiResult.menuId) && !m.soldOut)
      || (targetStore.menus || []).find(m => !m.soldOut)
      || (targetStore.menus && targetStore.menus[0])
      || { id: 'M01', name: '招牌主餐', price: 100 };

    const altHtml = Array.isArray(aiResult.alternatives) && aiResult.alternatives.length > 0
      ? `
        <div style="margin-top:8px; padding-top:6px; border-top:1px dashed var(--border); font-size:0.75rem; color:var(--text-secondary);">
          <strong style="color:#4338CA;">💡 其他快取選擇：</strong>
          ${aiResult.alternatives.map(alt => `
            <button type="button" onclick="enterStoreOrdering(${escapeJsAttr(alt.storeId)}, ${escapeJsAttr(alt.menuId)})" style="border:1px solid #C7D2FE; background:#EEF2FF; color:#312E81; border-radius:6px; padding:3px 8px; margin-left:4px; margin-top:4px; font-size:0.72rem; font-weight:700;">
              ${escapeHtml(alt.storeName)}・${escapeHtml(alt.menuName)} ($${alt.price} / 約${alt.waitMin}分) ➔
            </button>
          `).join('')}
        </div>
      `
      : '';

    return `
      <div class="chat-msg-row assistant">
        <div class="chat-bubble">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:6px;">
            <span style="font-size:0.7rem; font-weight:800; color:#4338CA; background:#EEF2FF; padding:2px 8px; border-radius:999px;">
              🤖 ${escapeHtml(aiResult.engine || '智慧選餐顧問')}
            </span>
            <span style="font-size:0.72rem; font-weight:800; color:var(--green);">⚡ ${escapeHtml(targetStore.name)} 約 ${targetStore.avgPrepMinutes} 分鐘取餐</span>
          </div>
          <p style="font-size:0.85rem; color:var(--text-primary); line-height:1.5; margin-bottom:8px;">
            ${escapeHtml(aiResult.reasoning)}
          </p>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#FFF7ED; padding:8px 12px; border-radius:10px; border:1.5px solid #FDBA74; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="font-size:0.7rem; font-weight:800; color:var(--brand-dark);">🍽️ 推薦一鍵點餐</div>
              <strong style="font-size:0.9rem; color:var(--text-primary);">${escapeHtml(targetStore.name)} — ${escapeHtml(targetMenu.name)}</strong>
              <span style="color:var(--red); font-weight:900; margin-left:6px; font-size:0.95rem;">NT$ ${targetMenu.price}</span>
            </div>
            <button type="button" class="btn-tip-action" style="padding:7px 14px; font-size:0.8rem;" onclick="enterStoreOrdering(${escapeJsAttr(targetStore.id)}, ${escapeJsAttr(targetMenu.id)})">
              ⚡ 點選此餐點 ➔
            </button>
          </div>
          ${altHtml}
        </div>
      </div>
    `;
  }).join('');

  const loadingHtml = isLoading ? `
    <div class="chat-msg-row assistant">
      <div class="chat-bubble" style="display:flex; align-items:center; gap:8px; color:#4338CA; font-weight:800;">
        <span class="sync-dot syncing" style="width:9px; height:9px;"></span>
        <span>🧠 正在分析「${escapeHtml(state.campus)}」營業中店家佇列與供應中菜單...</span>
      </div>
    </div>
  ` : '';

  respBox.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid var(--border);">
      <span style="font-size:0.75rem; font-weight:900; color:var(--indigo);">💬 選餐顧問多輪對話紀錄 (${state.aiChatMessages.length} 則)</span>
      <button type="button" onclick="clearAiChatHistory()" style="border:none; background:transparent; color:var(--text-muted); font-size:0.72rem; font-weight:700; cursor:pointer;">🗑️ 清空對話</button>
    </div>
    <div class="ai-chat-history">${historyHtml}${loadingHtml}</div>
  `;
  respBox.scrollTop = respBox.scrollHeight;
}

// ==================== 5. 專屬訂單追蹤頁（100% 真實 ISO QR Code + 伺服器 HMAC 6 碼防偽核銷碼） ====================
async function tryAutoFetchMissingOrderById(orderId, forceRetry = false) {
  if (!orderId) return null;
  if (state.fetchingOrderInFlightMap[orderId]) return null;
  if (!forceRetry && state.autoFetchedMissingOrderIds[orderId]) return null;

  state.fetchingOrderInFlightMap[orderId] = true;
  state.autoFetchedMissingOrderIds[orderId] = true;
  if (state.routeMode === 'ticket') renderSingleTicketView();

  let foundOrder = null;
  const urlParams = new URLSearchParams(window.location.search);
  const urlVerCode = (urlParams.get('v') || urlParams.get('code') || '').trim().toUpperCase();
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getOrder',
        orderId: orderId,
        v: urlVerCode,
        clientDeviceId: state.clientDeviceId,
        ...getMerchantAuthPayload()
      })
    });
    const data = await res.json();
    if (data && data.success && data.order) {
      foundOrder = sanitizeIncomingOrder(data.order);
    }
  } catch (e) {}

  if (!foundOrder) {
    try {
      const resGet = await fetch(`${GAS_URL}?action=getOrder&orderId=${encodeURIComponent(orderId)}&v=${encodeURIComponent(urlVerCode)}&clientDeviceId=${encodeURIComponent(state.clientDeviceId)}`);
      const dataGet = await resGet.json();
      if (dataGet && dataGet.success && dataGet.order) {
        foundOrder = sanitizeIncomingOrder(dataGet.order);
      }
    } catch (e) {}
  }

  state.fetchingOrderInFlightMap[orderId] = false;

  if (foundOrder) {
    state.pendingLocalOrdersMap[foundOrder.orderId] = Date.now();
    const existingIdx = state.orders.findIndex(x => x.orderId === foundOrder.orderId);
    if (existingIdx >= 0) {
      state.orders[existingIdx] = foundOrder;
    } else {
      state.orders.unshift(foundOrder);
    }
    addOrderToMyHistory(foundOrder.orderId);
    saveCachedOrders(state.orders);
    updateHeaderMyOrdersBadge();
    if (state.routeMode === 'ticket') renderSingleTicketView();
    showToast(`🎉 已從雲端同步載入訂單 #${foundOrder.pickupNumber}`);
    return foundOrder;
  } else {
    if (state.routeMode === 'ticket') renderSingleTicketView();
    return null;
  }
}

function reorderFromTicket(orderId) {
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  const store = state.stores.find(s => s.id === o.storeId);
  if (!store) {
    showToast('⚠️ 找不到此訂單對應的學餐店家');
    return;
  }

  const validItems = (Array.isArray(o.structuredItems) ? o.structuredItems : [])
    .filter(it => !it.isGift && Number(it.price) > 0)
    .map(it => ({
      id: it.id,
      name: it.baseName || it.name,
      baseName: it.baseName || it.name,
      basePrice: it.price,
      price: it.price,
      qty: Number(it.qty) || 1,
      selections: it.selections || {}
    }));

  if (validItems.length === 0) {
    navigateToOrderMenu();
    return;
  }

  state.campus = store.campus;
  state.selectedStoreId = store.id;
  state.cartItems = validItems;
  state.checkoutDineType = o.dineType || '外帶自取';
  state.checkoutNeedCutlery = Boolean(o.needCutlery);
  saveStudentCartDraft();
  navigateToOrderMenu();
  setTimeout(() => {
    updateCartUI();
    openCartModal();
    showToast(`🛒 已將訂單 #${o.pickupNumber} 的餐點一鍵加回購物車！`);
  }, 120);
}

async function cancelMyScheduledOrder(orderId) {
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  const canSelfCancel = (
    o.status === '已接單待排程' ||
    o.status === '待付款確認' ||
    (o.status === '製作中' && o.paymentStatus !== '已付款' && o.isReservation)
  );
  if (!canSelfCancel) {
    showToast('⚠️ 此訂單已進入廚房備餐階段，無法線上取消，請洽詢店家櫃檯！');
    return;
  }
  const confirmed = await showAppConfirmModal({
    title: '取消預訂訂單',
    message: `確定要取消在【${o.storeName}】的預訂單 #${o.pickupNumber} 嗎？`,
    confirmText: '確定取消訂單',
    danger: true
  });
  if (!confirmed) {
    return;
  }

  o.status = '已取消 (顧客自助取消預約)';
  o.paymentStatus = '已退單作廢';
  saveCachedOrders(state.orders);
  enrichStoresAndAi();
  renderSingleTicketView();
  updateHeaderMyOrdersBadge();
  showToast(`🚫 已取消訂單 #${o.pickupNumber}`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'cancelOrder',
        orderId: o.orderId,
        verificationCode: o.verificationCode || '',
        studentCancel: true,
        reason: '顧客自助取消預約'
      })
    });
  } catch (e) {}
}

function renderSingleTicketView() {
  const box = document.getElementById('singleTicketContainer') || document.getElementById('singleOrderTicketBox');
  if (!box) return;

  const orderId = state.trackingOrderId || state.activeOrderId;
  const o = state.orders.find(ord => ord.orderId === orderId);

  if (!o) {
    if (orderId && String(orderId).startsWith('ORD-') && !state.autoFetchedMissingOrderIds[orderId]) {
      tryAutoFetchMissingOrderById(orderId);
    }
    const isFetchingNow = Boolean(orderId && (state.fetchingOrderInFlightMap[orderId] || state.isSyncInFlight));
    if (isFetchingNow) {
      box.innerHTML = `
        <div class="ticket-hero-card">
          <div style="font-size:2.8rem; margin-bottom:10px;">⏳</div>
          <h2 style="font-size:1.25rem; font-weight:900; margin-bottom:6px;">正在從雲端載入您的電子取餐憑證...</h2>
          <p style="font-size:0.86rem; color:var(--text-secondary);">憑證編號：<code>${escapeHtml(orderId || '')}</code>，請稍候片刻</p>
        </div>
      `;
      return;
    }
    box.innerHTML = `
      <div class="ticket-hero-card">
        <div style="font-size:3rem; margin-bottom:10px;">🔍</div>
        <h2 style="font-size:1.3rem; font-weight:900; margin-bottom:6px;">尚未同步到此訂單 (${escapeHtml(orderId || '未知')})</h2>
        <p style="font-size:0.86rem; color:var(--text-secondary); margin-bottom:14px;">您可以點擊「重試雲端同步」，或直接輸入「6 碼防偽核銷碼」/「取餐號 + 手機末 3 碼」找回：</p>
        <div style="display:flex; gap:8px; max-width:420px; margin:0 auto 14px; flex-wrap:wrap;">
          <input type="search" id="ticketMissingLookupInput" class="select-input" style="flex:1.2;" placeholder="6碼防偽碼 或 4碼取餐號" value="${escapeHtml(orderId || '')}">
          <input type="tel" id="ticketMissingPhoneInput" class="select-input" style="flex:0.8;" placeholder="手機末3碼">
          <button type="button" class="btn-tip-action" style="white-space:nowrap;" onclick="searchOrderAcrossDevices(document.getElementById('ticketMissingLookupInput')?.value, document.getElementById('ticketMissingPhoneInput')?.value)">找回</button>
        </div>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          ${orderId ? `<button class="btn-outline" onclick="tryAutoFetchMissingOrderById(${escapeJsAttr(orderId)}, true)">🔄 重新向雲端拉取此單</button>` : ''}
          <button class="btn-outline" onclick="openMyOrdersDrawer()">🧾 開啟我的訂單匣</button>
          <button class="btn-primary-full" style="max-width:200px;" onclick="navigateToOrderMenu()">← 返回點餐首頁</button>
        </div>
      </div>
    `;
    return;
  }

  const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
  const itemsHtml = items.map(i => {
    const selStr = i.selections && Object.keys(i.selections).length > 0
      ? ` <small style="color:var(--text-secondary); font-weight:700;">(${Object.entries(i.selections).map(([k, v]) => `${trTerm(k)}:${trTerm(v)}`).join(', ')})</small>`
      : '';
    const itemNoteHtml = i.itemNote
      ? `<div style="font-size:0.76rem; color:var(--indigo); font-weight:800; margin-top:2px;">📝 ${escapeHtml(i.itemNote)}</div>`
      : '';
    return `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border); font-size:0.92rem;">
        <div>
          <span>
            <strong>${escapeHtml(trTerm(i.baseName || i.name))}</strong>${selStr} × ${i.qty || 1}
            ${i.isGift || Number(i.price) === 0 ? `<span style="background:#DCFCE7; color:#166534; font-size:0.72rem; font-weight:900; padding:2px 6px; border-radius:6px; margin-left:4px;">🎁 招待贈品</span>` : ''}
          </span>
          ${itemNoteHtml}
        </div>
        <span style="font-weight:800; color:${Number(i.price) === 0 ? 'var(--green)' : 'inherit'}; white-space:nowrap;">NT$ ${i.price * (i.qty || 1)}</span>
      </div>
    `;
  }).join('');

  const verCodeDisplay = formatVerificationCodeDisplay(o);
  const isServerVerified = isOrderServerVerified(o);
  const shareUrl = `${window.location.origin}${getOrderPageUrl('id=' + encodeURIComponent(o.orderId) + (isServerVerified ? '&v=' + encodeURIComponent(verCodeDisplay) : ''))}`;
  // 真實可掃描之 ISO/IEC 18004 QR Code 內容：直接編碼為訂單追蹤網址 shareUrl，讓顧客用手機相機一掃即開網頁，同時店員 KDS 掃描亦可解析核銷
  const qrPayloadText = shareUrl;
  const inlineQrSvg = generateDeterministicQrSvg(qrPayloadText, 225);

  const isCompleted = o.status === '已完成';
  const isReady = o.status === '可取餐';
  const isScheduled = o.status === '已接單待排程';
  const isPendingPay = o.status === '待付款確認';
  const isCancelled = o.status && o.status.includes('已取消');
  const isCooking = o.status === '製作中';

  // 計算此店家目前叫號進度與前方等候單數 (結合雲端 storeQueueProgressMap 與本機訂單)
  const storeObj = state.stores.find(s => s.id === o.storeId);
  const cloudProg = (state.storeQueueProgressMap && state.storeQueueProgressMap[o.storeId]) || null;
  const todayStoreActive = state.orders.filter(ord =>
    ord.storeId === o.storeId &&
    normalizeDateStr(ord.pickupDate) === normalizeDateStr(o.pickupDate) &&
    !String(ord.status).includes('已取消')
  );
  const readyNumsLocal = todayStoreActive.filter(ord => ord.status === '可取餐').map(ord => String(ord.pickupNumber));
  const cookingOrdersLocal = todayStoreActive.filter(ord => ord.status === '製作中');

  const readyNumbersList = (cloudProg && Array.isArray(cloudProg.readyNumbers) && cloudProg.readyNumbers.length > 0)
    ? cloudProg.readyNumbers
    : readyNumsLocal;
  const latestCalledNum = readyNumbersList[0] || (cloudProg && cloudProg.latestCalledNumber) || (cookingOrdersLocal[0] ? cookingOrdersLocal[0].pickupNumber : '--');

  let ordersAheadCount = 0;
  if (isCooking) {
    if (cloudProg && Array.isArray(cloudProg.cookingOrderIds) && cloudProg.cookingOrderIds.length > 0) {
      const idxInQueue = cloudProg.cookingOrderIds.indexOf(o.orderId);
      ordersAheadCount = idxInQueue >= 0 ? idxInQueue : Math.max(0, cloudProg.cookingOrderIds.length - 1);
    } else {
      const myNumVal = parseInt(String(o.pickupNumber || '0').replace(/\D/g, ''), 10) || 0;
      ordersAheadCount = cookingOrdersLocal.filter(ord => {
        if (ord.orderId === o.orderId) return false;
        const otherVal = parseInt(String(ord.pickupNumber || '0').replace(/\D/g, ''), 10) || 0;
        return otherVal > 0 && myNumVal > 0 ? otherVal < myNumVal : (Number(ord.createdAtTs || 0) < Number(o.createdAtTs || 0));
      }).length;
    }
  }
  const basePrepMin = storeObj ? (Number(storeObj.basePrepMinutes) || 4) : 4;
  const estRemainingMins = isReady ? 0 : Math.max(1, Math.min(45, basePrepMin + ordersAheadCount * 2 - getOrderElapsedMinutes(o)));

  const step1Class = isCancelled ? '' : 'done';
  const step2Class = isCancelled ? '' : (isScheduled ? 'active' : (o.status === '製作中' || isReady || isCompleted ? 'done' : ''));
  const step3Class = isCancelled ? '' : (o.status === '製作中' ? 'active' : (isReady || isCompleted ? 'done' : ''));
  const step4Class = isCompleted ? 'done' : (isReady ? 'active' : '');

  let statusHeadline = '🍳 廚房正為您製作餐點中';
  let statusColor = 'var(--brand)';
  if (isCancelled) {
    statusHeadline = `🚫 ${o.status}`;
    statusColor = 'var(--red)';
  } else if (isPendingPay) {
    statusHeadline = '⏳ 待櫃檯確認付款後排程';
    statusColor = 'var(--amber)';
  } else if (isScheduled) {
    statusHeadline = `📅 已接單待排程（將於取餐前 25 分鐘自動下鍋）`;
    statusColor = 'var(--blue)';
  } else if (isReady) {
    statusHeadline = `🔔 您的餐點已備妥！請至櫃檯取餐 (已叫號 ${Math.max(1, o.notifyCount || 1)} 次)`;
    statusColor = 'var(--green)';
  } else if (isCompleted) {
    statusHeadline = '✅ 已完成取餐，祝您用餐愉快！';
    statusColor = 'var(--text-secondary)';
  }

  const myTrackedCount = getMyTrackedOrdersList().length;
  const liveNowClock = getTaipeiTimeHHMMSS();
  const phoneLast3 = o.customerPhoneLast3 || extractPhoneLast3(o.customerPhone);

  box.innerHTML = `
    <div class="ticket-hero-card" style="${isReady ? 'border:2.5px solid var(--green); box-shadow:0 0 0 6px rgba(16,185,129,0.12);' : ''}">
      <div class="live-verify-banner">
        <span><span class="live-clock-pulse"></span>防偽動態電子取餐憑證 (${escapeHtml(o.pickupDate)})</span>
        <span id="ticketAntiFraudClock" style="font-family:monospace; font-size:0.9rem; letter-spacing:0.5px;">${liveNowClock}</span>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
        <span style="font-size:0.76rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:4px 12px; border-radius:999px;">
          📍 ${escapeHtml(o.storeName)}（${escapeHtml(o.dineType || '外帶自取')}）
        </span>
        <div style="display:flex; gap:6px;">
          ${myTrackedCount > 1 ? `
            <button type="button" onclick="openMyOrdersDrawer()" style="border:1.5px solid var(--brand); background:var(--brand-light); color:var(--brand-dark); padding:4px 10px; border-radius:999px; font-size:0.75rem; font-weight:900; cursor:pointer;">
              🧾 切換我的其他訂單 (${myTrackedCount})
            </button>
          ` : ''}
          <button type="button" onclick="openLineBindModal()" style="border:1px solid #86EFAC; background:${state.lineProfile.isBound ? '#DCFCE7' : '#F0FDF4'}; color:#065F46; padding:4px 10px; border-radius:999px; font-size:0.75rem; font-weight:800; cursor:pointer;">
            💚 ${state.lineProfile.isBound ? '推播已綁定' : '綁定取餐推播'}
          </button>
        </div>
      </div>

      <div style="font-size:0.84rem; color:var(--text-secondary); margin-top:12px; font-weight:700;">您的專屬取餐流水號</div>
      <div class="ticket-Serial" style="color:${statusColor};">#${escapeHtml(o.pickupNumber)}</div>
      <div style="font-size:1rem; font-weight:900; color:${statusColor}; margin-bottom:10px;">${escapeHtml(statusHeadline)}</div>

      ${!isCompleted && !isCancelled && (('Notification' in window && Notification.permission !== 'granted') || !state.isAudioUnlocked) ? `
        <div style="margin:10px 0; background:linear-gradient(135deg, #FEF3C7 0%, #FFFBEB 100%); border:2px solid #F59E0B; border-radius:14px; padding:12px 14px; text-align:left; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; box-shadow:0 4px 12px rgba(245,158,11,0.18);">
          <div style="flex:1; min-width:210px;">
            <div style="font-size:0.86rem; font-weight:950; color:#92400E;">🔔 ${t('防漏單必開：啟用取餐背景通知與震動', 'Enable background pickup alerts')}</div>
            <div style="font-size:0.75rem; color:#B45309; font-weight:700; margin-top:2px;">${t('開啟後即使切換 App 或鎖屏，餐點做好時手機會立刻通知提醒（預設不播語音，不打擾上課）。', 'Get instant alerts even when screen is off (silent-safe by default).')}</div>
          </div>
          <button type="button" onclick="requestBrowserNotificationPermission(); renderSingleTicketView(${escapeJsAttr(o.orderId)});" style="border:none; background:#D97706; color:#FFFFFF; padding:9px 16px; border-radius:999px; font-size:0.82rem; font-weight:950; cursor:pointer; white-space:nowrap; box-shadow:0 3px 10px rgba(217,119,6,0.3);">
            🔔 ${t('一鍵開啟取餐提醒', 'Enable Alerts')}
          </button>
        </div>
      ` : ''}

      ${!isCompleted && !isCancelled ? `
        <div style="text-align:left; margin:8px 0;">
          <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary); margin-bottom:4px;">${t('取餐提醒音效模式（預設關閉語音，避免課堂尷尬）', 'Pickup Alert Mode (Voice off by default)')}</div>
          <div class="alert-mode-bar" style="margin:0;">
            <button type="button" class="alert-mode-btn ${(state.studentAlertSoundMode || 'CHIME') === 'CHIME' ? 'active' : ''}" onclick="setStudentAlertSoundMode('CHIME')">🔔 ${t('提示音', 'Chime', 'チャイム', '알림음')}</button>
            <button type="button" class="alert-mode-btn ${state.studentAlertSoundMode === 'MUTE' ? 'active' : ''}" onclick="setStudentAlertSoundMode('MUTE')">🔇 ${t('靜音震動', 'Silent', 'サイレント', '무음진동')}</button>
            <button type="button" class="alert-mode-btn ${state.studentAlertSoundMode === 'VOICE' ? 'active' : ''}" onclick="setStudentAlertSoundMode('VOICE')">🗣️ ${t('語音播報', 'Voice', '音声案内', '음성안내')}</button>
          </div>
        </div>
      ` : ''}

      ${!isCompleted && !isCancelled ? `
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; background:#F8FAFC; border:1.5px solid #E2E8F0; border-radius:14px; padding:12px 10px; margin:10px 0;">
          <div>
            <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary);">📢 目前叫號</div>
            <div style="font-size:1.25rem; font-weight:950; color:var(--green); margin-top:2px;">
              ${latestCalledNum !== '--' ? `#${escapeHtml(latestCalledNum)}` : '準備中'}
            </div>
          </div>
          <div style="border-left:1px solid #E2E8F0; border-right:1px solid #E2E8F0;">
            <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary);">🍳 前方等候</div>
            <div style="font-size:1.25rem; font-weight:950; color:${isReady ? 'var(--green)' : 'var(--brand-dark)'}; margin-top:2px;">
              ${isReady ? '輪到您了' : isScheduled ? '預約排程' : `${ordersAheadCount} 單`}
            </div>
          </div>
          <div>
            <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary);">⏱️ 預估剩餘</div>
            <div style="font-size:1.25rem; font-weight:950; color:var(--indigo); margin-top:2px;">
              ${isReady ? '立即取餐' : isScheduled ? escapeHtml(o.pickupTime) : `約 ${estRemainingMins} 分`}
            </div>
          </div>
        </div>
      ` : ''}

      <div class="hmac-verify-badge-box ${isServerVerified ? '' : 'unverified-warning'}">
        <div style="text-align:left;">
          <div style="font-size:0.74rem; font-weight:900; color:${isServerVerified ? '#4338CA' : '#B45309'};">
            ${isServerVerified ? '🛡️ 伺服器 HMAC 簽章防偽核銷碼' : '⚠️ 門市離線單（待雲端同步核發防偽碼）'}
          </div>
          <div style="font-size:0.72rem; color:#475569;">
            ${isServerVerified ? '領餐時請供店員掃描下方 QR Code 或核對此 6 碼' : '此單為店內 POS 離線建立，將於連線後自動補發雲端簽章'}
          </div>
        </div>
        <div class="hmac-code-digits" style="${isServerVerified ? '' : 'color:#B45309; border-color:#F59E0B; font-size:1.05rem;'}">${escapeHtml(verCodeDisplay)}</div>
      </div>

      <div style="font-size:0.78rem; color:var(--text-muted);">
        訂單憑證：${escapeHtml(o.orderId)} ・ 下單時間：${escapeHtml(o.createdAt)}
        ${phoneLast3 ? ` ・ 手機末碼：${escapeHtml(phoneLast3)}` : ''}
      </div>

      ${isReady ? `
        <div style="margin-top:12px; background:#ECFDF5; border:1.5px solid #10B981; color:#065F46; padding:12px; border-radius:12px; font-weight:800; font-size:0.9rem;">
          🎉 櫃檯已按下「通知取餐」！請出示下方 QR Code 或核銷碼 <strong>${escapeHtml(verCodeDisplay)}</strong> 領取餐點。
        </div>
      ` : ''}

      ${(o.merchantMessage || (Array.isArray(o.merchantMessages) && o.merchantMessages.length > 0)) ? `
        <div style="margin-top:12px; background:#EFF6FF; border:2px solid #3B82F6; color:#1E3A8A; padding:12px 14px; border-radius:14px; text-align:left;">
          <div style="font-size:0.82rem; font-weight:950; margin-bottom:4px;">💬 店家櫃檯即時通知</div>
          ${Array.isArray(o.merchantMessages) && o.merchantMessages.length > 0 ? o.merchantMessages.map(m => `
            <div style="font-size:0.86rem; font-weight:800; margin-top:4px;">
              「${escapeHtml(m.text)}」 <span style="font-size:0.72rem; color:#64748B; font-family:monospace;">(${escapeHtml(m.timeStr || '')})</span>
            </div>
          `).join('') : `
            <div style="font-size:0.88rem; font-weight:800;">「${escapeHtml(o.merchantMessage)}」 ${o.merchantMessageAt ? `<span style="font-size:0.72rem; color:#64748B;">(${escapeHtml(o.merchantMessageAt)})</span>` : ''}</div>
          `}
        </div>
      ` : ''}

      <div class="status-stepper">
        <div class="step-item ${step1Class}">
          <div class="step-dot">✓</div>
          <div class="step-label">已接單</div>
        </div>
        <div class="step-item ${step2Class}">
          <div class="step-dot">2</div>
          <div class="step-label">排程候鍋</div>
        </div>
        <div class="step-item ${step3Class}">
          <div class="step-dot">3</div>
          <div class="step-label">廚房製作</div>
        </div>
        <div class="step-item ${step4Class}">
          <div class="step-dot">4</div>
          <div class="step-label">叫號取餐</div>
        </div>
      </div>

      ${Array.isArray(o.statusTimeline) && o.statusTimeline.length > 0 ? `
        <div style="text-align:left; background:#F8FAFC; border:1px solid var(--border); border-radius:12px; padding:10px 14px; margin:10px 0;">
          <div style="font-size:0.76rem; font-weight:900; color:var(--text-secondary); margin-bottom:6px;">⏱️ 訂單狀態歷程時間軸</div>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${o.statusTimeline.slice(-6).reverse().map(ev => `
              <div style="display:flex; justify-content:space-between; gap:8px; font-size:0.76rem;">
                <span style="font-weight:800; color:var(--text-primary);">• ${escapeHtml(ev.label || ev.status || '')}</span>
                <span style="font-family:monospace; color:var(--text-muted); white-space:nowrap;">${escapeHtml(ev.timeStr || '')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div style="text-align:left; background:var(--bg-page); padding:16px; border-radius:14px; border:1px solid var(--border); margin:16px 0;">
        <div style="font-size:0.8rem; font-weight:800; color:var(--text-secondary); margin-bottom:8px;">
          📋 點餐明細（${escapeHtml(o.dineType || '自取')}${o.customerNote ? ` ・ 備註：${escapeHtml(o.customerNote)}` : ''}）
        </div>
        ${itemsHtml}
        ${o.cutleryFee > 0 ? `
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:0.84rem; color:var(--text-secondary);">
            <span>🥢 一次性免洗餐具</span>
            <span>+NT$ ${o.cutleryFee}</span>
          </div>
        ` : ''}
        ${o.discount > 0 ? `
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:0.84rem; color:var(--green); font-weight:700;">
            <span>🎁 離峰分流優惠 (${escapeHtml(o.promoApplied)})</span>
            <span>-NT$ ${o.discount}</span>
          </div>
        ` : ''}
        ${o.manualDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:0.84rem; color:var(--indigo); font-weight:700;">
            <span>🏷️ 櫃檯手動折讓 (${escapeHtml(o.manualDiscountReason || '專案折扣')})</span>
            <span>-NT$ ${o.manualDiscount}</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; padding-top:10px; margin-top:6px; border-top:1px solid var(--border); font-size:1.05rem; font-weight:900;">
          <span>總計金額 (${escapeHtml(o.paymentMethod)}・${escapeHtml(o.paymentStatus || '已確認')})</span>
          <span style="color:var(--red);">NT$ ${o.finalTotal}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px;">
          ⏰ 取餐時段：${escapeHtml(o.pickupTimeSlot)}
        </div>
      </div>

      <div style="display:flex; align-items:center; justify-content:center; gap:18px; background:#FFFFFF; border:1.5px solid #CBD5E1; border-radius:14px; padding:16px; margin-bottom:16px; flex-wrap:wrap;">
        <div class="svg-qr-box" title="ISO/IEC 18004 標準追蹤與核銷條碼">${inlineQrSvg}</div>
        <div style="text-align:left; max-width:270px;">
          <div style="font-size:0.9rem; font-weight:900; color:var(--text-primary); margin-bottom:4px;">📷 顧客追蹤 & 櫃檯核銷 QR Code</div>
          <p style="font-size:0.78rem; color:var(--text-secondary); line-height:1.45; margin-bottom:10px;">
            手機相機直接掃描即可<strong>開啟此訂單即時追蹤網頁</strong>；取餐時出示供店家平板鏡頭或掃碼槍掃描即可秒速核銷。
          </p>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="filter-chip" style="padding:5px 12px; font-size:0.76rem;" onclick="copyOrderUrl(${escapeJsAttr(shareUrl)})">📋 複製訂單網址</button>
            <button type="button" class="filter-chip" style="padding:5px 12px; font-size:0.76rem;" onclick="openReceiptPrintModal(${escapeJsAttr(o.orderId)})">🖨️ 電子收據小票</button>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="btn-outline" onclick="syncCloud(true)">🔄 立即刷新狀態</button>
        <button type="button" class="btn-outline" style="border-color:var(--brand); color:var(--brand-dark);" onclick="reorderFromTicket(${escapeJsAttr(o.orderId)})">🔁 再買一次相同餐點</button>
        ${(isScheduled || isPendingPay) && !isCancelled ? `
          <button type="button" class="btn-danger-soft" style="padding:10px 14px; font-size:0.86rem; border-radius:12px;" onclick="cancelMyScheduledOrder(${escapeJsAttr(o.orderId)})">🚫 取消此預訂單</button>
        ` : ''}
        <button type="button" class="btn-primary-full" style="max-width:210px;" onclick="navigateToOrderMenu()">➕ 返回學餐菜單</button>
      </div>
    </div>
  `;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(box);
}

function copyOrderUrl(url) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('✅ 已複製專屬訂單網址！'));
  } else {
    showToast('訂單網址：' + url);
  }
}

// ==================== 6. 店家端營運管理系統 (`/store/` 嚴格權限與範圍守門) ====================
function switchStoreTabMode(mode) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  state.storeTabMode = mode;
  syncUrlStateWithHistory(true);
  updateBodyScrollLock();
  ['pos', 'kds', 'analytics', 'settings'].forEach(m => {
    document.getElementById(`railBtn-${m}`)?.classList.toggle('active', m === mode);
    const panel = document.getElementById(`storePanel-${m}`);
    if (panel) panel.style.display = (m === mode) ? 'block' : 'none';
  });
  renderMerchantView();
}

function switchSettingsSubTab(sub) {
  state.settingsSubTab = sub;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderMerchantSettingsPanel(store);
}

function switchMerchantStore(storeId) {
  const prevStoreId = state.merchantStoreId;
  state.merchantStoreId = storeId;
  try { localStorage.setItem('mealflow_last_merchant_store_id', storeId); } catch (e) {}
  state.posSelectedCategory = '全部';
  state.posCart = [];
  state.posCashReceived = '';
  state.posManualDiscount = 0;
  state.posManualDiscountReason = '';
  const topSel = document.getElementById('storeTopSwitcher');
  if (topSel && topSel.value !== storeId) topSel.value = storeId;
  syncUrlStateWithHistory(true);

  // #7：各店獨立密碼保護 — 切換店鋪時，若目標店鋪與目前 Session 授權之單一店鋪不符，立即銷毀舊店憑證並強制要求輸入新店密碼
  if (prevStoreId !== storeId || !isMerchantSessionValidNow()) {
    const targetStore = state.stores.find(s => s.id === storeId);
    showToast(`🔒 已切換至「${targetStore ? targetStore.name : storeId}」，請輸入該店專屬授權碼解鎖`);
    checkMerchantSecurityGate();
    renderMerchantView();
    return;
  }
  renderMerchantView();
  syncCloud(false);
}

async function toggleCurrentStoreOpenStatus() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const prevOpen = store.isOpen !== false;
  store.isOpen = !prevOpen;
  state.lastLocalStoreConfigUpdateTs = Date.now();
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStoreConfig',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        isOpen: store.isOpen,
        cutleryPrice: store.cutleryPrice,
        maxCapacityPer15Min: store.maxCapacityPer15Min,
        baseQueueOffset: store.baseQueueOffset || 0,
        promoMode: store.promoMode,
        promoText: store.promoText,
        promoDiscount: store.promoDiscount
      })
    });
    const data = await res.json();
    if (!data || !data.success) {
      store.isOpen = prevOpen;
      enrichStoresAndAi();
      saveLocalStores(state.stores);
      renderMerchantView();
      showToast(`❌ 營業狀態切換失敗已還原：${(data && data.message) || '權限不足或伺服器拒絕'}`);
      return;
    }
    showToast(store.isOpen ? `🟢 「${store.name}」已恢復正常營業！` : `🔴 「${store.name}」已設為暫停營業（學生端僅開放預訂）`);
  } catch (e) {
    showToast(store.isOpen ? `⚠️ 網路暫時離線，「${store.name}」已先於本機設為營業中` : `⚠️ 網路暫時離線，「${store.name}」已先於本機設為暫停營業`);
  }
}

async function toggleMenuItemSoldOut(menuIdx, evt) {
  if (evt) evt.stopPropagation();
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[menuIdx]) return;

  const item = store.menus[menuIdx];
  const prevSoldOut = Boolean(item.soldOut);
  item.soldOut = !prevSoldOut;
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  renderMerchantView();

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'toggleMenuSoldOut',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        menuId: item.id,
        soldOut: item.soldOut
      })
    });
    const data = await res.json();
    if (!data || !data.success) {
      // 若舊版後端尚未部署 toggleMenuSoldOut，回退呼叫 saveStoreMenu
      if (data && String(data.message || '').includes('未知的操作請求')) {
        await syncStoreMenuToCloud(store);
      } else {
        item.soldOut = prevSoldOut;
        saveLocalStores(state.stores);
        renderMerchantView();
        showToast(`❌ 切換售罄狀態失敗已還原：${(data && data.message) || '請重試'}`);
        return;
      }
    }
    showToast(item.soldOut ? `🚫 已將「${item.name}」標記為今日售罄` : `🟢 已將「${item.name}」恢復正常供應`);
  } catch (e) {
    showToast(item.soldOut ? `⚠️ 離線中：已先於本機將「${item.name}」標記售罄` : `⚠️ 離線中：已先於本機將「${item.name}」恢復供應`);
  }
}

function renderMerchantView() {
  enrichStoresAndAi();
  ensureHeaderExtraControls();
  state.isMerchantUnlocked = isMerchantSessionValidNow();
  updateBodyScrollLock();
  updateMerchantAudioUnlockBanner();

  if (!state.isMerchantUnlocked) {
    ['pos', 'kds', 'analytics', 'settings'].forEach(m => {
      const panel = document.getElementById(`storePanel-${m}`);
      if (panel) {
        panel.innerHTML = m === state.storeTabMode ? `
          <div class="auth-locked-stage">
            <div style="font-size:3rem; margin-bottom:10px;">🔒</div>
            <h3 style="font-size:1.25rem; font-weight:900; color:var(--text-primary); margin-bottom:6px;">店務營運後台受雲端時效憑證保護中</h3>
            <p style="font-size:0.86rem; margin-bottom:16px;">未持有該店有效 HMAC Session Token 前，系統禁止渲染收銀、退單與營業報表節點。</p>
            <button type="button" class="btn-tip-action" onclick="checkMerchantSecurityGate()">🔑 輸入店務授權碼驗證</button>
          </div>
        ` : '';
      }
    });
    return;
  }

  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;

  const topSel = document.getElementById('storeTopSwitcher');
  if (topSel) {
    topSel.innerHTML = state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>${escapeHtml(trTerm(s.campus))} — ${escapeHtml(trTerm(s.name))} ${s.isOpen === false ? `(${t('休息中', 'Closed', '準備中', '휴식중')})` : ''}</option>`).join('');
  }

  const openToggleBtn = document.getElementById('headerStoreOpenToggleBtn');
  if (openToggleBtn) {
    const isOpen = store.isOpen !== false;
    openToggleBtn.className = 'store-status-toggle ' + (isOpen ? '' : 'closed');
    openToggleBtn.innerHTML = isOpen
      ? '🟢 ' + t('營業中 (點此切換)', 'Open (Tap to Pause)', '営業中 (切替)', '영업 중 (전환)')
      : '🔴 ' + t('暫停營業 (點此恢復)', 'Paused (Tap to Open)', '準備中 (再開)', '휴식 중 (재개)');
  }

  updateMerchantHeaderBadgesOnly();

  if (state.storeTabMode === 'pos') {
    renderPosCashierPanel(store);
  } else if (state.storeTabMode === 'kds') {
    renderMerchantOrdersOnly(store);
  } else if (state.storeTabMode === 'analytics') {
    renderMerchantAnalyticsPanel(store);
  } else if (state.storeTabMode === 'settings') {
    renderMerchantSettingsPanel(store);
  }
  if (state.lang && state.lang !== 'zh-TW') {
    applyDomSystemTranslation(document.getElementById('viewStore'));
    applyDomSystemTranslation(document.querySelector('.app-header'));
  }
}

// ==================== 6.1 平板收銀櫃檯點餐 (POS) & 會計級交班日結單 ====================
function selectPosCategory(cat) {
  state.posSelectedCategory = cat;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

function changePosCartQty(idx, delta) {
  if (!state.posCart[idx]) return;
  state.posCart[idx].qty = (state.posCart[idx].qty || 1) + delta;
  if (state.posCart[idx].qty <= 0) state.posCart.splice(idx, 1);
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

async function clearPosCart(skipConfirm = false) {
  if (!skipConfirm && state.posCart.length > 0) {
    const ok = await showAppConfirmModal({
      title: '清空櫃檯點餐單',
      message: `確定要清空目前結帳單上的 ${state.posCart.length} 項餐點嗎？`,
      confirmText: '確定清空',
      danger: true
    });
    if (!ok) return;
  }
  state.posCart = [];
  state.posCashReceived = '';
  state.posSplitCashAmount = '';
  state.posManualDiscount = 0;
  state.posManualDiscountReason = '';
  state.posCustomerNote = '';
  state.posTaxId = '';
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

// #27 POS 掛單 / 暫存訂單 (Hold / Park Order)
async function holdCurrentPosOrder() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) {
    showToast('⚠️ 目前結帳單內沒有餐點可掛單');
    return;
  }
  const label = await showAppPromptModal({
    title: '⏸️ 暫存目前點餐單（掛單）',
    message: '請輸入掛單備註（如：桌號、戴紅帽同學、等找零，留空自動標記時間）：',
    defaultValue: state.posCustomerNote || '',
    placeholder: '例如：A3 桌 / 等同學找零',
    confirmText: '暫存掛單'
  });
  if (label === null) return;
  const { finalTotal } = calcCurrentPosTotals(store);
  const heldEntry = {
    holdId: 'HOLD-' + Date.now().toString(36).toUpperCase(),
    storeId: store.id,
    label: label.trim() || `掛單 ${getTaipeiTimeHHMM()}`,
    createdAt: getTaipeiTimeHHMMSS(),
    cart: JSON.parse(JSON.stringify(state.posCart)),
    dineType: state.posDineType,
    needCutlery: state.posNeedCutlery,
    timeMode: state.posTimeMode,
    reserveDate: state.posReserveDate,
    reserveTime: state.posReserveTime,
    customerPhone: state.posCustomerPhone,
    customerNote: state.posCustomerNote,
    taxId: state.posTaxId,
    manualDiscount: state.posManualDiscount,
    manualDiscountReason: state.posManualDiscountReason,
    previewTotal: finalTotal
  };
  state.posHeldOrders = [heldEntry, ...(state.posHeldOrders || [])].slice(0, 30);
  savePosHeldOrders(state.posHeldOrders);
  clearPosCart(true);
  showToast(`⏸️ 已暫存掛單「${heldEntry.label}」(NT$${finalTotal})，可先結帳下一位顧客！`);
}

// #12 POS 拆單結帳：將點餐單拆出一半或指定份數至獨立掛單分開收款
async function splitPosCartToHeldOrder() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  const totalQty = (state.posCart || []).reduce((s, i) => s + (Number(i.qty) || 1), 0);
  if (!store || totalQty < 2) {
    showToast('⚠️ 至少需有 2 份餐點才可拆單結帳');
    return;
  }
  const splitTargetLabel = await showAppPromptModal({
    title: '✂️ 櫃檯拆單分帳',
    message: `目前點餐單共 ${totalQty} 份餐點。\n系統將自動拆出後半部餐點至獨立「掛單」供下一位分開結帳，請輸入拆單標籤：`,
    defaultValue: `拆單分帳 ${getTaipeiTimeHHMM()}`,
    placeholder: '例如：B位同學分開付',
    confirmText: '確認拆出獨立掛單'
  });
  if (splitTargetLabel === null) return;

  const stayCart = [];
  const splitCart = [];
  if (state.posCart.length >= 2) {
    const mid = Math.ceil(state.posCart.length / 2);
    state.posCart.forEach((it, idx) => {
      if (idx < mid) stayCart.push(it);
      else splitCart.push(it);
    });
  } else {
    const single = state.posCart[0];
    const stayQty = Math.ceil((single.qty || 2) / 2);
    const splitQty = (single.qty || 2) - stayQty;
    stayCart.push({ ...single, qty: stayQty });
    splitCart.push({ ...single, qty: splitQty });
  }

  const splitTotal = splitCart.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const heldEntry = {
    holdId: 'SPLIT-' + Date.now().toString(36).toUpperCase(),
    storeId: store.id,
    label: splitTargetLabel.trim() || `拆單 ${getTaipeiTimeHHMM()}`,
    createdAt: getTaipeiTimeHHMMSS(),
    cart: JSON.parse(JSON.stringify(splitCart)),
    dineType: state.posDineType,
    needCutlery: state.posNeedCutlery,
    timeMode: state.posTimeMode,
    reserveDate: state.posReserveDate,
    reserveTime: state.posReserveTime,
    customerPhone: '',
    customerNote: state.posCustomerNote,
    taxId: '',
    manualDiscount: 0,
    manualDiscountReason: '',
    previewTotal: splitTotal
  };
  state.posHeldOrders = [heldEntry, ...(state.posHeldOrders || [])].slice(0, 30);
  savePosHeldOrders(state.posHeldOrders);
  state.posCart = stayCart;
  renderPosCashierPanel(store);
  showToast(`✂️ 已拆出 ${splitCart.reduce((s, i) => s + (i.qty || 1), 0)} 份 (NT$${splitTotal}) 至「掛單：${heldEntry.label}」，可先結目前這筆！`);
}

function openPosHeldOrdersModal() {
  ensureSharedModalsMounted();
  renderPosHeldOrdersModal();
  document.getElementById('posHeldOrdersModal')?.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('posHeldOrdersModal'));
}

function closePosHeldOrdersModal() {
  document.getElementById('posHeldOrdersModal')?.classList.remove('open');
}

function renderPosHeldOrdersModal() {
  const box = document.getElementById('posHeldOrdersBody');
  if (!box) return;
  const list = (state.posHeldOrders || []).filter(h => h.storeId === state.merchantStoreId);
  if (list.length === 0) {
    box.innerHTML = `<div style="text-align:center; padding:32px 12px; color:var(--text-muted); font-weight:800;">📭 目前本店沒有暫存中的掛單</div>`;
    return;
  }
  box.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${list.map(h => {
        const summary = (h.cart || []).map(i => `${i.baseName || i.name}×${i.qty || 1}`).join('、');
        return `
          <div style="background:#F8FAFC; border:1.5px solid var(--border); border-radius:12px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong style="font-size:0.94rem; color:var(--text-primary);">⏸️ ${escapeHtml(h.label)}</strong>
              <span style="font-size:0.76rem; color:var(--text-muted); font-family:monospace;">${escapeHtml(h.createdAt)}</span>
            </div>
            <div style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:8px;">${escapeHtml(summary)}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <span style="font-weight:950; color:var(--red); font-size:0.98rem;">NT$ ${h.previewTotal || 0}</span>
              <div style="display:flex; gap:6px;">
                <button type="button" class="btn-danger-soft" style="padding:6px 10px; font-size:0.78rem;" onclick="deletePosHeldOrder(${escapeJsAttr(h.holdId)})">🗑️ 刪除</button>
                <button type="button" class="btn-tip-action" style="padding:6px 14px; font-size:0.82rem;" onclick="restorePosHeldOrder(${escapeJsAttr(h.holdId)})">▶️ 取回結帳</button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function restorePosHeldOrder(holdId) {
  const idx = (state.posHeldOrders || []).findIndex(h => h.holdId === holdId);
  if (idx < 0) return;
  if (state.posCart.length > 0) {
    const ok = await showAppConfirmModal({
      title: '覆蓋並取回掛單',
      message: '目前結帳單內還有未結餐點，確定要覆蓋並取回這筆掛單嗎？（建議可先將目前這筆也按「掛單」）',
      confirmText: '覆蓋並取回',
      danger: true
    });
    if (!ok) return;
  }
  const h = state.posHeldOrders.splice(idx, 1)[0];
  savePosHeldOrders(state.posHeldOrders);
  state.posCart = Array.isArray(h.cart) ? h.cart : [];
  state.posDineType = h.dineType || '內用自取';
  state.posNeedCutlery = Boolean(h.needCutlery);
  state.posTimeMode = h.timeMode || 'NOW';
  state.posReserveDate = h.reserveDate || getTodayDateStr();
  state.posReserveTime = h.reserveTime || '12:15';
  state.posCustomerPhone = h.customerPhone || '';
  state.posCustomerNote = h.customerNote || '';
  state.posTaxId = h.taxId || '';
  state.posManualDiscount = Number(h.manualDiscount) || 0;
  state.posManualDiscountReason = h.manualDiscountReason || '';
  closePosHeldOrdersModal();
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
  showToast(`▶️ 已取回掛單「${h.label}」，可繼續點餐或收銀結帳！`);
}

async function deletePosHeldOrder(holdId) {
  const ok = await showAppConfirmModal({
    title: '刪除暫存掛單',
    message: '確定要永久刪除此筆暫存掛單嗎？',
    confirmText: '確定刪除',
    danger: true
  });
  if (!ok) return;
  state.posHeldOrders = (state.posHeldOrders || []).filter(h => h.holdId !== holdId);
  savePosHeldOrders(state.posHeldOrders);
  renderPosHeldOrdersModal();
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

// #12 開班點鈔登記流程 (Shift Open)
async function promptOpenShiftFloatModal() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const todayStr = getTodayDateStr();
  const formRes = await showAppFormModal({
    title: `🔓 開班點鈔登記（${todayStr}）`,
    message: `請登記「${store.name}」今日當班收銀員與錢箱找零準備金：`,
    fields: [
      { key: 'cashier', label: '👤 值班開班收銀員姓名', value: state.shiftCashierName || '早班店長', placeholder: '例如：早班店長' },
      { key: 'openingFloat', label: '💵 錢箱找零準備金 (NT$)', type: 'number', min: 0, value: String(state.shiftOpeningFloat || 2000), placeholder: '2000' }
    ],
    confirmText: '✅ 完成開班登記'
  });
  if (!formRes) return;
  const openingFloat = Math.max(0, parseInt(formRes.openingFloat, 10) || 0);
  const cleanCashier = String(formRes.cashier || '').trim() || '當班人員';

  state.shiftCashierName = cleanCashier;
  state.shiftOpeningFloat = openingFloat;
  try {
    localStorage.setItem('mealflow_shift_cashier', cleanCashier);
    localStorage.setItem('mealflow_shift_float', String(openingFloat));
  } catch (e) {}

  const openRec = {
    openedAt: `${todayStr} ${getTaipeiTimeHHMMSS()}`,
    cashier: cleanCashier,
    openingFloat
  };
  if (!state.openShiftsMap) state.openShiftsMap = {};
  if (!state.openShiftsMap[store.id]) state.openShiftsMap[store.id] = {};
  state.openShiftsMap[store.id][todayStr] = openRec;
  try { localStorage.setItem(`mealflow_shift_opened_${store.id}_${todayStr}`, JSON.stringify(openRec)); } catch (e) {}

  recordMerchantAuditLog('完成開班點鈔登記', `值班人員：${cleanCashier}，開班找零準備金 NT$${openingFloat}`);
  renderPosCashierPanel(store);
  showToast(`🔓 開班完成！${cleanCashier} 已登記錢箱找零底金 NT$${openingFloat}`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'openShiftRecord',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        shiftDate: todayStr,
        cashier: cleanCashier,
        openingFloat
      })
    });
  } catch (e) {}
}

// #9 兩段式收銀防呆確認 Modal & #12 複合付款 (現金 + LINE Pay)
function openPosTwoStepCheckoutModal() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) return;

  const isReserve = state.posTimeMode === 'RESERVE';
  const todayStr = getTodayDateStr();
  if (getLockedShiftRecord(store.id, todayStr) && !isReserve) {
    showToast(`🔒 本店今日 (${todayStr}) 已完成交班日結鎖定！請先於「交班日結單」解鎖。`);
    openShiftZReportModal();
    return;
  }
  const cleanPhone = (state.posCustomerPhone || '').replace(/\D/g, '');
  if (isReserve && cleanPhone.length < 8) {
    state.posShowExtraPanel = true;
    renderPosCashierPanel(store);
    showToast('⚠️ 預訂取餐請先填寫顧客聯絡電話號碼！');
    return;
  }

  ensureSharedModalsMounted();
  renderPosTwoStepCheckoutModal();
  document.getElementById('posTwoStepCheckoutModal')?.classList.add('open');
}

function closePosTwoStepCheckoutModal() {
  document.getElementById('posTwoStepCheckoutModal')?.classList.remove('open');
}

function renderPosTwoStepCheckoutModal() {
  const box = document.getElementById('posTwoStepCheckoutBody');
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!box || !store) return;

  const { subtotal, cutleryFee, discount, manualDiscount, finalTotal } = calcCurrentPosTotals(store);
  const isReserve = state.posTimeMode === 'RESERVE';
  const nextPreviewSeq = generatePreviewNextSeq(store.id, isReserve ? state.posReserveDate : getTodayDateStr());
  const cashReceivedNum = state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal;
  const changeAmount = Math.max(0, cashReceivedNum - finalTotal);
  const isCashShort = state.posPayment === '現場現金' && state.posCashReceived !== '' && cashReceivedNum < finalTotal;

  const splitCashNum = Math.min(finalTotal, Math.max(0, parseInt(state.posSplitCashAmount || '0', 10) || 0));
  const splitLinePayNum = Math.max(0, finalTotal - splitCashNum);
  const isSplitInvalid = state.posPayment === '複合付款' && (splitCashNum <= 0 || splitLinePayNum <= 0);

  box.innerHTML = `
    <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:12px; padding:12px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="font-weight:950; font-size:0.96rem;">🧾 預覽單號 #${nextPreviewSeq}（${escapeHtml(state.posDineType)}）</span>
        <span style="font-size:0.76rem; font-weight:800; color:var(--brand-dark);">${isReserve ? `📅 預訂 ${state.posReserveDate} ${state.posReserveTime}` : '⚡ 現場立即製作'}</span>
      </div>
      <div style="max-height:110px; overflow-y:auto; font-size:0.8rem; color:var(--text-secondary); border-top:1px dashed var(--border); padding-top:6px;">
        ${state.posCart.map(i => `<div style="display:flex; justify-content:space-between;"><span>${escapeHtml(i.baseName || i.name)} ×${i.qty || 1}</span><strong>$${i.price * (i.qty || 1)}</strong></div>`).join('')}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px; padding-top:8px; border-top:1.5px solid var(--border);">
        <span style="font-weight:900; font-size:0.9rem;">應收總計 ${cutleryFee > 0 ? `(餐具+$${cutleryFee})` : ''} ${(discount + manualDiscount) > 0 ? `(折-$${discount + manualDiscount})` : ''}</span>
        <span style="font-size:1.55rem; font-weight:950; color:var(--red);">NT$ ${finalTotal}</span>
      </div>
    </div>

    <label class="field-label">💳 選擇收款方式（支援現金、行動支付與複合付款）</label>
    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:12px;">
      ${['現場現金', 'LINE Pay', '複合付款'].map(pay => `
        <button type="button" class="pos-chip-btn ${state.posPayment === pay ? 'active' : ''}" style="padding:10px 6px; font-size:0.82rem;" onclick="state.posPayment=${escapeJsAttr(pay)}; renderPosTwoStepCheckoutModal(); renderPosCashierPanel(state.stores.find(s=>s.id===state.merchantStoreId));">
          ${pay === 'LINE Pay' ? '💚 LINE Pay' : pay === '複合付款' ? '🔀 複合付款' : '💵 現場現金'}
        </button>
      `).join('')}
    </div>

    ${state.posPayment === '現場現金' ? `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#0F172A; color:#FFFFFF; padding:10px 14px; border-radius:10px; margin-bottom:8px;">
        <div>
          <div style="font-size:0.72rem; color:#94A3B8;">💵 顧客實收現金</div>
          <div style="font-size:1.25rem; font-weight:950; color:#38BDF8;">NT$ ${state.posCashReceived !== '' ? escapeHtml(state.posCashReceived) : `${finalTotal} (剛好)`}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.72rem; color:#94A3B8;">🪙 應找零錢</div>
          <div style="font-size:1.35rem; font-weight:950; color:${isCashShort ? '#F87171' : '#34D399'};">${isCashShort ? `不足 $${finalTotal - cashReceivedNum}` : `NT$ ${changeAmount}`}</div>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:5px; margin-bottom:12px;">
        <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(${finalTotal}); renderPosTwoStepCheckoutModal();">剛好</button>
        <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(100); renderPosTwoStepCheckoutModal();">$100</button>
        <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(500); renderPosTwoStepCheckoutModal();">$500</button>
        <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(1000); renderPosTwoStepCheckoutModal();">$1000</button>
        <button type="button" class="pos-chip-btn" style="background:#EFF6FF; color:#1D4ED8;" onclick="openPosCashNumpadModal()">🔢 鍵盤</button>
      </div>
    ` : ''}

    ${state.posPayment === '複合付款' ? `
      <div style="background:#FFFBEB; border:1.5px solid #F59E0B; border-radius:12px; padding:12px; margin-bottom:12px;">
        <div style="font-size:0.8rem; font-weight:900; color:#92400E; margin-bottom:8px;">🔀 複合付款拆帳（現金入錢箱 + LINE Pay 入行動支付）</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div>
            <label class="field-label">💵 現金支付金額 ($)</label>
            <input type="number" class="select-input" min="1" max="${Math.max(1, finalTotal - 1)}" placeholder="如：${Math.floor(finalTotal / 2)}" value="${escapeHtml(state.posSplitCashAmount)}" oninput="state.posSplitCashAmount=this.value; renderPosTwoStepCheckoutModal();">
          </div>
          <div>
            <label class="field-label">💚 LINE Pay 補差額 ($)</label>
            <input type="text" class="select-input" disabled value="NT$ ${splitLinePayNum}" style="font-weight:900; color:#059669; background:#ECFDF5;">
          </div>
        </div>
        ${isSplitInvalid ? `<div style="font-size:0.74rem; color:var(--red); font-weight:800; margin-top:6px;">⚠️ 請輸入大於 $0 且小於 $${finalTotal} 的現金金額</div>` : ''}
      </div>
    ` : ''}

    <div style="display:grid; grid-template-columns:1fr 2fr; gap:8px;">
      <button type="button" class="btn-outline" style="padding:12px; font-weight:900;" onclick="closePosTwoStepCheckoutModal()">← 返回修改</button>
      <button type="button" id="posFinalConfirmCheckoutBtn" class="pos-checkout-btn" style="padding:12px; font-size:0.96rem;" onclick="closePosTwoStepCheckoutModal(); submitMerchantPosOrder();" ${isCashShort || isSplitInvalid || state.isPosSubmitting ? 'disabled' : ''}>
        ✅ 確認收款並立即出單 #${nextPreviewSeq}
      </button>
    </div>
  `;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('posTwoStepCheckoutModal'));
}

function updatePosOptionButtonsOnly(store) {
  const { storeCutleryPrice, subtotal, cutleryFee, discount, manualDiscount, finalTotal } = calcCurrentPosTotals(store);
  const cashReceivedNum = state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal;
  const changeAmount = Math.max(0, cashReceivedNum - finalTotal);
  const isCashInsufficient = state.posPayment === '現場現金' && state.posCashReceived !== '' && cashReceivedNum < finalTotal;
  const isReserve = state.posTimeMode === 'RESERVE';
  const nextPreviewSeq = generatePreviewNextSeq(store.id, isReserve ? state.posReserveDate : getTodayDateStr());

  const footerEl = document.querySelector('#storePanel-pos .pos-receipt-footer');
  if (footerEl) {
    footerEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
        <span style="font-size:0.8rem; font-weight:900;">
          應收總計 ${cutleryFee > 0 ? `(餐具+$${cutleryFee})` : ''} ${(discount + manualDiscount) > 0 ? `<span style="color:var(--green);">(已折-$${discount + manualDiscount})</span>` : ''}
        </span>
        <span style="font-size:1.25rem; font-weight:950; color:var(--red);">NT$ ${finalTotal}</span>
      </div>

      <button type="button" class="pos-checkout-btn" onclick="submitMerchantPosOrder()" ${state.posCart.length === 0 || isCashInsufficient ? 'disabled' : ''}>
        ⚡ 結帳出單 #${nextPreviewSeq} (${state.posPayment === '現場現金' && changeAmount > 0 ? `找零 $${changeAmount}` : `NT$ ${finalTotal}`})
      </button>
    `;
  }
}

function setPosOption(field, value) {
  state[field] = value;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

async function setPosManualDiscountPreset(amount, reasonText) {
  if (state.posManualDiscount === amount && state.posManualDiscountReason === reasonText) {
    state.posManualDiscount = 0;
    state.posManualDiscountReason = '';
  } else {
    const numAmt = Math.max(0, Number(amount) || 0);
    if (numAmt >= 50) {
      const customReason = await showAppPromptModal({
        title: '高金額折讓 / 招待確認',
        message: `折讓金額達 NT$${numAmt}，請確認或輸入折讓原因（將寫入店務稽核紀錄）：`,
        defaultValue: reasonText || '店長核准折讓',
        placeholder: '例如：店長招待、熟客折扣',
        confirmText: '套用折讓'
      });
      if (customReason === null) return;
      reasonText = customReason.trim() || reasonText || '店長核准折讓';
    }
    state.posManualDiscount = numAmt;
    state.posManualDiscountReason = reasonText || '櫃檯折讓';
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

async function promptCustomPosDiscount() {
  const formRes = await showAppFormModal({
    title: '🏷️ 自訂櫃檯折讓 / 招待金額',
    message: '輸入折讓金額（填 0 可清除折讓）與折讓原因：',
    fields: [
      { key: 'amount', label: '💰 折讓金額 (NT$)', type: 'number', min: 0, value: String(state.posManualDiscount || 15), placeholder: '15' },
      { key: 'reason', label: '📝 折讓 / 招待原因', value: state.posManualDiscountReason || '教職員/熟客折讓', placeholder: '如：教職員折扣、久候招待' }
    ],
    confirmText: '套用折讓'
  });
  if (!formRes) return;
  const amt = Math.max(0, parseInt(formRes.amount, 10) || 0);
  const reason = amt > 0 ? (String(formRes.reason || '').trim() || '櫃檯手動折讓') : '';
  state.posManualDiscount = amt;
  state.posManualDiscountReason = reason;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

function setPosQuickCash(val) {
  state.posCashReceived = String(val);
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
  if (document.getElementById('posCashNumpadModal')?.classList.contains('open')) {
    renderPosCashNumpadModal();
  }
  if (document.getElementById('posTwoStepCheckoutModal')?.classList.contains('open')) {
    renderPosTwoStepCheckoutModal();
  }
}

function openPosCashNumpadModal() {
  ensureSharedModalsMounted();
  renderPosCashNumpadModal();
  const modal = document.getElementById('posCashNumpadModal');
  if (modal) {
    modal.style.zIndex = '1300';
    modal.classList.add('open');
  }
}

function closePosCashNumpadModal() {
  document.getElementById('posCashNumpadModal')?.classList.remove('open');
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
  if (document.getElementById('posTwoStepCheckoutModal')?.classList.contains('open')) {
    renderPosTwoStepCheckoutModal();
  }
}

function posTapNumpad(key) {
  let cur = String(state.posCashReceived || '');
  if (key === 'C') {
    cur = '';
  } else if (key === 'BACK') {
    cur = cur.slice(0, -1);
  } else {
    if (cur.length < 6) {
      cur = (cur === '0') ? String(key) : cur + String(key);
    }
  }
  state.posCashReceived = cur;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
  renderPosCashNumpadModal();
  if (document.getElementById('posTwoStepCheckoutModal')?.classList.contains('open')) {
    renderPosTwoStepCheckoutModal();
  }
}

function calcCurrentPosTotals(store) {
  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const subtotal = state.posCart.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.posNeedCutlery) ? storeCutleryPrice : 0;
  const isReserve = state.posTimeMode === 'RESERVE';
  const promoActive = isStorePromoActive(store, isReserve, state.posReserveTime);
  const discount = (subtotal >= AI_DISCOUNT_MIN_SUBTOTAL && promoActive && store.promoMode === 'discount')
    ? Math.min(subtotal, Number(store.promoDiscount) || 10)
    : 0;
  const manualDiscount = Math.min(Math.max(0, subtotal - discount), Math.max(0, Number(state.posManualDiscount) || 0));
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount - manualDiscount);
  return { storeCutleryPrice, subtotal, cutleryFee, promoActive, discount, manualDiscount, finalTotal };
}

function renderPosCashNumpadModal() {
  const box = document.getElementById('posCashNumpadBody');
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!box || !store) return;

  const { finalTotal } = calcCurrentPosTotals(store);
  const cashReceivedNum = state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal;
  const changeAmount = Math.max(0, cashReceivedNum - finalTotal);
  const isShort = state.posCashReceived !== '' && cashReceivedNum < finalTotal;

  box.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
      <div style="background:var(--bg-page); padding:10px 12px; border-radius:12px; border:1px solid var(--border);">
        <div style="font-size:0.75rem; color:var(--text-secondary); font-weight:800;">🧾 應收總計</div>
        <div style="font-size:1.35rem; font-weight:950; color:var(--text-primary);">NT$ ${finalTotal}</div>
      </div>
      <div style="background:${isShort ? 'var(--red-bg)' : 'var(--green-bg)'}; padding:10px 12px; border-radius:12px; border:1.5px solid ${isShort ? 'var(--red)' : 'var(--green)'};">
        <div style="font-size:0.75rem; color:${isShort ? 'var(--red)' : 'var(--green)'}; font-weight:800;">🪙 應找零錢</div>
        <div style="font-size:1.35rem; font-weight:950; color:${isShort ? 'var(--red)' : 'var(--green)'};">
          ${isShort ? `不足 $${finalTotal - cashReceivedNum}` : `NT$ ${changeAmount}`}
        </div>
      </div>
    </div>

    <div style="background:#FFF7ED; border:2px solid var(--brand); border-radius:12px; padding:10px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size:0.84rem; font-weight:900; color:var(--brand-dark);">💵 顧客實收金額</span>
      <span style="font-size:1.6rem; font-weight:950; color:var(--brand-dark);">
        NT$ ${state.posCashReceived !== '' ? escapeHtml(state.posCashReceived) : `${finalTotal} (剛好)`}
      </span>
    </div>

    <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-bottom:10px;">
      <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(${finalTotal})">剛好 ($${finalTotal})</button>
      <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(100)">$100</button>
      <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(500)">$500</button>
      <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(1000)">$1000</button>
    </div>

    <div class="pos-numpad-grid" style="margin-bottom:12px;">
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('7')">7</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('8')">8</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('9')">9</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('4')">4</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('5')">5</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('6')">6</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('1')">1</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('2')">2</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('3')">3</button>
      <button type="button" class="pos-numpad-key clear" onclick="posTapNumpad('C')">清空</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('0')">0</button>
      <button type="button" class="pos-numpad-key back" onclick="posTapNumpad('BACK')">⌫</button>
    </div>

    <button type="button" class="btn-primary-full" onclick="closePosCashNumpadModal()">
      ✅ 確認實收金額 (找零 NT$ ${changeAmount})
    </button>
  `;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('posCashNumpadModal'));
}

function renderPosCashierPanel(store) {
  const panel = document.getElementById('storePanel-pos');
  if (!panel) return;

  const todayStr = getTodayDateStr();
  if (!state.posReserveDate || normalizeDateStr(state.posReserveDate) < todayStr) {
    state.posReserveDate = todayStr;
  }

  const prevMenuGridScroll = document.querySelector('#storePanel-pos .pos-dish-grid')?.scrollTop || 0;
  const prevReceiptScroll = document.querySelector('#storePanel-pos .pos-receipt-scroll-body')?.scrollTop || 0;

  const menus = store.menus || [];
  const categories = ['全部', ...new Set(menus.map(m => m.category || '主廚推薦'))];
  const filteredMenus = state.posSelectedCategory === '全部'
    ? menus
    : menus.filter(m => (m.category || '主廚推薦') === state.posSelectedCategory);

  const { storeCutleryPrice, subtotal, cutleryFee, discount, manualDiscount, finalTotal } = calcCurrentPosTotals(store);

  const isReserve = state.posTimeMode === 'RESERVE';
  let posValidSlots = [];
  if (isReserve) {
    posValidSlots = getValidPickupTimeSlots(state.posReserveDate, store.id);
    if (posValidSlots.length === 0) {
      state.posReserveDate = getDateOffsetStr(1);
      posValidSlots = getValidPickupTimeSlots(state.posReserveDate, store.id);
    }
    if (!posValidSlots.includes(state.posReserveTime)) {
      state.posReserveTime = posValidSlots[0] || '12:15';
    }
  }

  const cashReceivedNum = state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal;
  const changeAmount = Math.max(0, cashReceivedNum - finalTotal);
  const isCashInsufficient = state.posPayment === '現場現金' && state.posCashReceived !== '' && cashReceivedNum < finalTotal;

  const nextPreviewSeq = generatePreviewNextSeq(store.id, isReserve ? state.posReserveDate : todayStr);
  const lockedShiftInfo = getLockedShiftRecord(store.id, todayStr);
  const openedShiftInfo = getOpenedShiftRecord(store.id, todayStr);
  const isBlockedByShiftLock = Boolean(lockedShiftInfo && !isReserve);
  const heldCount = (state.posHeldOrders || []).filter(h => h.storeId === store.id).length;

  panel.innerHTML = `
    <div class="pos-modern-workspace">
      <div class="pos-menu-card">
        ${lockedShiftInfo ? `
          <div style="background:#FEF2F2; border:1.5px solid #EF4444; color:#991B1B; padding:8px 12px; border-radius:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size:0.78rem; font-weight:900;">
            <span>🔒 本店今日 (${todayStr}) 已由「${escapeHtml(lockedShiftInfo.cashier || '店長')}」完成交班日結鎖定，禁止補開當日立即單（可開立未來預訂單）</span>
            <button type="button" onclick="openShiftZReportModal()" style="border:1px solid #DC2626; background:#FFFFFF; color:#DC2626; padding:4px 10px; border-radius:6px; font-size:0.74rem; font-weight:900; cursor:pointer;">🧾 檢視日結 / 店長解鎖</button>
          </div>
        ` : ''}
        <div class="pos-cat-strip">
          ${categories.map(cat => `
            <button type="button" class="pos-cat-pill ${state.posSelectedCategory === cat ? 'active' : ''}" onclick="selectPosCategory(${escapeJsAttr(cat)})">
              ${escapeHtml(cat)}
            </button>
          `).join('')}
          <div style="margin-left:auto; display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="pos-cat-pill" style="background:${heldCount > 0 ? '#FEF3C7' : '#F8FAFC'}; color:${heldCount > 0 ? '#B45309' : '#475569'}; border-color:${heldCount > 0 ? '#F59E0B' : '#CBD5E1'};" onclick="openPosHeldOrdersModal()">
              ⏸️ 掛單 (${heldCount})
            </button>
            <button type="button" class="pos-cat-pill" style="background:${openedShiftInfo ? '#ECFDF5' : '#FFF7ED'}; color:${openedShiftInfo ? '#065F46' : '#C2410C'}; border-color:${openedShiftInfo ? '#10B981' : '#FB923C'};" onclick="promptOpenShiftFloatModal()">
              ${openedShiftInfo ? `🔓 已開班($${openedShiftInfo.openingFloat})` : '🔓 開班點鈔'}
            </button>
            <button type="button" class="pos-cat-pill" style="background:#0F172A; color:#FFFFFF; border-color:#0F172A;" onclick="openShiftZReportModal()">
              🧾 交班日結單
            </button>
          </div>
        </div>

        <div class="pos-dish-grid">
          ${filteredMenus.map(m => {
            const fullIdx = menus.findIndex(x => String(x.id) === String(m.id));
            const hasOpts = m.options && Object.keys(m.options).length > 0;
            const isSoldOut = Boolean(m.soldOut);
            const hasDailyLimit = Number(m.dailyLimit) > 0 && m.remainingToday !== null && m.remainingToday !== undefined;
            return `
              <div class="pos-dish-tile ${isSoldOut ? 'sold-out' : ''}" onclick="handleMenuItemClick(${escapeJsAttr(m.id)}, true)">
                <div>
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                    <span class="pos-tile-cat">${escapeHtml(m.category || '招牌')}${hasDailyLimit && !isSoldOut ? ` ・剩${m.remainingToday}` : ''}</span>
                    <button type="button" onclick="toggleMenuItemSoldOut(${fullIdx}, event)" style="border:none; background:${isSoldOut ? '#FEE2E2' : '#F1F5F9'}; color:${isSoldOut ? '#DC2626' : '#475569'}; font-size:0.66rem; font-weight:900; padding:2px 6px; border-radius:6px;" title="一鍵切換售罄或上架狀態">
                      ${isSoldOut ? '🚫 已售罄(點此上架)' : (hasOpts ? '⚙️ 客製 ・ 售罄' : '售罄切換')}
                    </button>
                  </div>
                  <div class="pos-tile-name" data-dish-name="1">${escapeHtml(trDishName(m))}</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span class="pos-tile-price">NT$ ${m.price}</span>
                  <span style="width:22px; height:22px; border-radius:50%; background:${isSoldOut ? '#E2E8F0' : 'var(--brand-light)'}; color:${isSoldOut ? '#94A3B8' : 'var(--brand-dark)'}; display:inline-flex; align-items:center; justify-content:center; font-weight:900; font-size:0.85rem;">${isSoldOut ? '✕' : '＋'}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="pos-receipt-column">
        <div class="pos-receipt-header">
          <div>
            <div style="font-size:0.95rem; font-weight:900; color:var(--text-primary);">
              🧾 櫃檯點餐單 <span style="color:var(--brand-dark); font-size:0.82rem;">(#${nextPreviewSeq})</span>
            </div>
            <div style="font-size:0.74rem; color:var(--text-secondary);">${escapeHtml(store.name)} ・ 共 ${state.posCart.reduce((s, i) => s + (i.qty || 1), 0)} 份餐點</div>
          </div>
          ${state.posCart.length > 0 ? `
            <div style="display:flex; gap:5px;">
              ${state.posCart.reduce((s, i) => s + (i.qty || 1), 0) >= 2 ? `<button type="button" onclick="splitPosCartToHeldOrder()" style="border:1px solid #6366F1; background:#EEF2FF; color:#3730A3; padding:4px 8px; border-radius:8px; font-size:0.74rem; font-weight:900;">✂️ 拆單</button>` : ''}
              <button type="button" onclick="holdCurrentPosOrder()" style="border:1px solid #F59E0B; background:#FFFBEB; color:#B45309; padding:4px 9px; border-radius:8px; font-size:0.74rem; font-weight:900;">⏸️ 掛單</button>
              <button type="button" onclick="clearPosCart()" style="border:1px solid #FECACA; background:var(--red-bg); color:var(--red); padding:4px 9px; border-radius:8px; font-size:0.74rem; font-weight:800;">🗑️ 清空</button>
            </div>
          ` : ''}
        </div>

        <div class="pos-receipt-scroll-body">
          <div class="pos-receipt-list" style="min-height:190px;">
            ${state.posCart.length === 0 ? `
              <div style="text-align:center; color:var(--text-muted); padding:32px 12px; font-size:0.84rem;">
                <div style="font-size:2rem; margin-bottom:6px;">🍱</div>
                請點擊左側餐點卡片加入點餐單<br><small style="font-size:0.74rem;">支援「⏸️ 掛單暫存」與兩段式防誤觸收銀結帳</small>
              </div>
            ` : state.posCart.map((item, idx) => {
              const selStr = item.selections && Object.keys(item.selections).length > 0
                ? Object.entries(item.selections).map(([k, v]) => `${k}:${v}`).join(', ')
                : '';
              const storeMenu = (store.menus || []).find(m => String(m.id) === String(item.id));
              const canEdit = storeMenu && storeMenu.options && Object.keys(storeMenu.options).length > 0;

              return `
                <div class="pos-receipt-item" style="padding:9px 8px;">
                  <div style="flex:1; min-width:0;">
                    <div style="font-weight:900; font-size:0.9rem; color:var(--text-primary);">${escapeHtml(item.baseName || item.name)}</div>
                    ${selStr ? `<div style="font-size:0.74rem; color:var(--brand-dark); font-weight:700;">${escapeHtml(selStr)}</div>` : ''}
                    <div style="font-size:0.82rem; font-weight:950; color:var(--red);">NT$ ${item.price * (item.qty || 1)}</div>
                  </div>
                  <div style="display:flex; align-items:center; gap:5px;">
                    ${canEdit ? `<button type="button" onclick="editCartItemOptions(${idx}, true)" style="border:1px solid var(--border); background:#EFF6FF; color:#1D4ED8; width:30px; height:30px; border-radius:8px; font-size:0.78rem; font-weight:800;">✎</button>` : ''}
                    <button type="button" onclick="changePosCartQty(${idx}, -1)" style="border:1px solid var(--border); background:#FFFFFF; width:30px; height:30px; border-radius:8px; font-weight:900;">－</button>
                    <span style="font-weight:950; min-width:20px; text-align:center; font-size:0.88rem;">${item.qty || 1}</span>
                    <button type="button" onclick="changePosCartQty(${idx}, 1)" style="border:1px solid var(--border); background:#FFFFFF; width:30px; height:30px; border-radius:8px; font-weight:900;">＋</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="pos-receipt-controls">
            <div style="display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:6px; margin-bottom:6px;">
              <button type="button" class="pos-chip-btn ${state.posDineType === '內用自取' ? 'active' : ''}" style="padding:8px 6px;" onclick="setPosOption('posDineType', '內用自取')">🍽️ 內用</button>
              <button type="button" class="pos-chip-btn ${state.posDineType === '外帶自取' ? 'active' : ''}" style="padding:8px 6px;" onclick="setPosOption('posDineType', '外帶自取')">🛍️ 外帶</button>
              <button type="button" class="pos-chip-btn ${state.posNeedCutlery ? 'active' : ''}" style="padding:8px 6px;" onclick="setPosOption('posNeedCutlery', !state.posNeedCutlery)">
                🥢 餐具(${storeCutleryPrice > 0 ? `+$${storeCutleryPrice}` : '$0'})
              </button>
            </div>

            <button type="button" onclick="state.posShowExtraPanel=!state.posShowExtraPanel; renderPosCashierPanel(state.stores.find(s=>s.id===state.merchantStoreId));" style="width:100%; display:flex; justify-content:space-between; align-items:center; padding:7px 10px; border-radius:8px; border:1px solid var(--border); background:#F8FAFC; color:#334155; font-size:0.76rem; font-weight:800; margin-bottom:6px; cursor:pointer;">
              <span>⚙️ 進階選項（預訂 / 折讓 / 備註 / 電話 / 統編）${(isReserve || state.posManualDiscount > 0 || state.posCustomerNote) ? '・已設定' : ''}</span>
              <span>${state.posShowExtraPanel || isReserve ? '▲ 收合' : '▼ 展開'}</span>
            </button>

            ${(state.posShowExtraPanel || isReserve) ? `
              <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:8px; margin-bottom:6px;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-bottom:6px;">
                  <button type="button" class="pos-chip-btn ${state.posTimeMode === 'NOW' ? 'active' : ''}" onclick="setPosOption('posTimeMode', 'NOW')">⚡ 立即出餐</button>
                  <button type="button" class="pos-chip-btn ${state.posTimeMode === 'RESERVE' ? 'active' : ''}" onclick="setPosOption('posTimeMode', 'RESERVE')">📅 預訂取餐</button>
                </div>

                ${isReserve ? `
                  <div style="display:grid; grid-template-columns:1fr 0.9fr 1.1fr; gap:4px; background:#FFFFFF; padding:5px; border-radius:8px; border:1px solid var(--border); margin-bottom:6px;">
                    <input type="date" class="select-input" style="padding:4px 6px; font-size:0.74rem;" min="${todayStr}" value="${escapeHtml(state.posReserveDate)}" onchange="setPosOption('posReserveDate', this.value)">
                    <select class="select-input" style="padding:4px 6px; font-size:0.74rem;" onchange="setPosOption('posReserveTime', this.value)">
                      ${posValidSlots.map(t => `<option value="${t}" ${state.posReserveTime === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                    <input type="tel" id="posReservePhoneInput" class="select-input" style="padding:4px 6px; font-size:0.74rem; border-color:var(--red);" placeholder="📱 電話(必填)" value="${escapeHtml(state.posCustomerPhone)}" oninput="state.posCustomerPhone=this.value">
                  </div>
                ` : ''}

                <div class="pos-discount-strip" style="margin-bottom:6px;">
                  <span style="font-size:0.72rem; font-weight:900; color:var(--text-secondary); white-space:nowrap;">🏷️ 折讓:</span>
                  <button type="button" class="pos-chip-btn ${state.posManualDiscount === 10 ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(10, '教職員/熟客折$10')">-$10</button>
                  <button type="button" class="pos-chip-btn ${state.posManualDiscount === 20 ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(20, '久候/活動折$20')">-$20</button>
                  <button type="button" class="pos-chip-btn ${subtotal > 0 && state.posManualDiscount >= subtotal ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(${subtotal}, '店長全額招待')">全單招待</button>
                  <button type="button" class="pos-chip-btn" style="padding:3px 7px; font-size:0.72rem; margin-left:auto;" onclick="promptCustomPosDiscount()">自訂</button>
                </div>

                <div style="display:grid; grid-template-columns:${isReserve ? '1.2fr 0.8fr' : '1.1fr 0.8fr 0.7fr'}; gap:4px;">
                  <input type="text" id="posNoteInput" class="select-input" style="padding:5px 8px; font-size:0.75rem;" placeholder="📝 備註 (飯少/分袋)" value="${escapeHtml(state.posCustomerNote || '')}" oninput="state.posCustomerNote=this.value">
                  ${!isReserve ? `
                    <input type="tel" id="posPhoneInput" class="select-input" style="padding:5px 8px; font-size:0.75rem;" placeholder="📱 電話/末3碼" value="${escapeHtml(state.posCustomerPhone || '')}" oninput="state.posCustomerPhone=this.value">
                  ` : ''}
                  <input type="text" maxlength="8" inputmode="numeric" id="posTaxIdInput" class="select-input" style="padding:5px 8px; font-size:0.75rem;" placeholder="🧾 統編(8碼)" value="${escapeHtml(state.posTaxId || '')}" oninput="state.posTaxId=this.value.replace(/\\D/g,'').slice(0,8)">
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="pos-receipt-footer">
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px;">
            <span style="font-size:0.84rem; font-weight:900;">
              應收總計 ${cutleryFee > 0 ? `(餐具+$${cutleryFee})` : ''} ${(discount + manualDiscount) > 0 ? `<span style="color:var(--green);">(折-$${discount + manualDiscount})</span>` : ''}
            </span>
            <span style="font-size:1.4rem; font-weight:950; color:var(--red);">NT$ ${finalTotal}</span>
          </div>

          <button type="button" id="posCheckoutSubmitBtn" class="pos-checkout-btn" style="padding:13px; font-size:1rem;" onclick="openPosTwoStepCheckoutModal()" ${state.posCart.length === 0 || state.isPosSubmitting || isBlockedByShiftLock ? 'disabled' : ''}>
            ${isBlockedByShiftLock ? '🔒 今日已交班日結鎖定 (僅開放預訂單)' : (state.isPosSubmitting ? '⏳ 結帳出單處理中...' : `💳 前往收銀確認 (NT$ ${finalTotal}) ➔`)}
          </button>
        </div>
      </div>
    </div>
  `;

  const newMenuGrid = document.querySelector('#storePanel-pos .pos-dish-grid');
  if (newMenuGrid && prevMenuGridScroll > 0) newMenuGrid.scrollTop = prevMenuGridScroll;
  const newReceiptBody = document.querySelector('#storePanel-pos .pos-receipt-scroll-body');
  if (newReceiptBody && prevReceiptScroll > 0) newReceiptBody.scrollTop = prevReceiptScroll;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(panel);
}

function generatePreviewNextSeq(storeId, pickupDateStr) {
  const targetDate = normalizeDateStr(pickupDateStr);
  const storeNumMatch = String(storeId || 'S01').match(/(\d+)/);
  const storeDigit = storeNumMatch ? parseInt(storeNumMatch[1], 10) : 1;
  const baseNumber = storeDigit * 1000;
  const storageKey = `mealflow_seq_${storeId}_${targetDate}`;
  let maxSeq = baseNumber;
  try {
    const savedSeq = parseInt(localStorage.getItem(storageKey) || '0', 10);
    if (savedSeq > maxSeq) maxSeq = savedSeq;
  } catch (e) {}
  state.orders.forEach(o => {
    if (o.storeId === storeId && normalizeDateStr(o.pickupDate) === targetDate) {
      const numMatch = String(o.pickupNumber || '').match(/(\d{3,5})/);
      if (numMatch) {
        const val = parseInt(numMatch[1], 10);
        if (val >= baseNumber && val < baseNumber + 999 && val > maxSeq) maxSeq = val;
      }
    }
  });
  return String(maxSeq + 1);
}

async function submitMerchantPosOrder() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  // #42 防連點保護 (Debounce / In-flight Lock)：防止店員濕手或因網路延遲連按兩下產生重複幽靈單
  if (state.isPosSubmitting) {
    showToast('⏳ 櫃檯訂單正在出單處理中，請勿重複點擊！');
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) return;

  const isReserve = state.posTimeMode === 'RESERVE';
  // #13 交班日結鎖定強制攔截：當日已關班鎖定後禁止再開立當日立即單
  const todayStr = getTodayDateStr();
  const lockedShiftInfo = getLockedShiftRecord(store.id, todayStr);
  if (lockedShiftInfo && !isReserve) {
    showToast(`🔒 本店今日 (${todayStr}) 已完成交班日結鎖定！如需補開當日帳單，請先至「交班日結單」由店長解鎖。`);
    openShiftZReportModal();
    return;
  }

  const cleanPhone = (state.posCustomerPhone || '').replace(/\D/g, '');
  const cleanTaxId = (state.posTaxId || '').replace(/\D/g, '');

  if (cleanTaxId && cleanTaxId.length !== 8) {
    showToast('⚠️ 統一編號須為 8 位數字！');
    return;
  }

  if (isReserve && cleanPhone.length < 8) {
    showToast('⚠️ 預訂取餐請輸入顧客聯絡電話號碼！');
    return;
  }

  state.isPosSubmitting = true;
  const posBtn = document.getElementById('posCheckoutSubmitBtn');
  if (posBtn) {
    posBtn.disabled = true;
    posBtn.innerText = '⏳ 結帳出單處理中...';
  }

  try {
    const { subtotal, cutleryFee, promoActive, discount, manualDiscount, finalTotal } = calcCurrentPosTotals(store);
    const promoApplied = manualDiscount > 0
      ? (state.posManualDiscountReason || '櫃檯手動折讓')
      : (promoActive ? store.promoText : '現場櫃檯點餐');

    if (manualDiscount > 0) {
      recordMerchantAuditLog('櫃檯手動折讓', `單筆折讓 -NT$${manualDiscount}（原因：${state.posManualDiscountReason || '未填寫'}，原價 $${subtotal}）`);
    }

    const isSplitPay = state.posPayment === '複合付款';
    const splitCashAmt = isSplitPay ? Math.min(finalTotal, Math.max(0, parseInt(state.posSplitCashAmount || '0', 10) || 0)) : 0;
    const splitLineAmt = isSplitPay ? Math.max(0, finalTotal - splitCashAmt) : 0;
    const paymentSplitObj = isSplitPay ? { cash: splitCashAmt, linePay: splitLineAmt } : null;

    const cashReceivedNum = state.posPayment === '現場現金'
      ? (state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal)
      : (isSplitPay ? splitCashAmt : finalTotal);
    const changeAmount = state.posPayment === '現場現金' ? Math.max(0, cashReceivedNum - finalTotal) : 0;

    const pickupDateVal = isReserve ? normalizeDateStr(state.posReserveDate) : getTodayDateStr();
    const nowTime = getTaipeiTimeHHMMSS();

    const structuredItems = state.posCart.map(i => normalizeOrderItemEntry({
      id: i.id,
      baseName: i.baseName || i.name,
      basePrice: i.basePrice !== undefined ? i.basePrice : i.price,
      price: i.price,
      qty: i.qty || 1,
      selections: i.selections || {},
      snapshotAtTs: Date.now()
    }));

    if (promoActive && (store.promoMode === 'gift' || store.promoMode === 'freebie') && store.promoText && subtotal >= AI_DISCOUNT_MIN_SUBTOTAL) {
      structuredItems.push(normalizeOrderItemEntry({
        id: 'GIFT-AI',
        baseName: `${store.promoText} (贈品)`,
        basePrice: 0,
        price: 0,
        qty: 1,
        selections: {},
        isGift: true,
        snapshotAtTs: Date.now()
      }));
    }

    const pickupTimeSlot = isReserve
      ? `📅 預訂 ${pickupDateVal} ${state.posReserveTime}`
      : `⚡ 現場立即製作`;

    const draftOrder = sanitizeIncomingOrder({
      orderId: generateOrderToken(),
      pickupNumber: generateMerchantPosOfflinePickupNumber(store.id, pickupDateVal),
      storeId: store.id,
      storeName: store.name,
      studentId: isReserve ? '📅 櫃檯預訂' : '🖥️ 現場POS',
      dineType: state.posDineType,
      customerNote: state.posCustomerNote || '',
      taxId: cleanTaxId,
      cashReceived: cashReceivedNum,
      changeGiven: changeAmount,
      paymentSplit: paymentSplitObj,
      structuredItems,
      subtotal,
      cutleryFee,
      needCutlery: state.posNeedCutlery,
      discount,
      manualDiscount,
      manualDiscountReason: state.posManualDiscountReason || '',
      finalTotal,
      promoApplied,
      pickupTimeSlot,
      paymentMethod: isSplitPay ? `複合付款 (現金$${splitCashAmt}+LP$${splitLineAmt})` : state.posPayment,
      isReservation: isReserve,
      pickupDate: pickupDateVal,
      pickupTime: isReserve ? state.posReserveTime : nowTime.slice(0, 5),
      paidAtDate: getTodayDateStr(),
      customerPhone: (state.posCustomerPhone || '').trim(),
      paymentStatus: '已付款',
      verificationCode: '',
      isOfflinePending: true,
      notifyCount: 0,
      isDivertedOrder: false,
      createdAt: nowTime,
      createdAtTs: Date.now(),
      cookingStartedAtTs: isReserve ? 0 : Date.now()
    });

    state.pendingLocalOrdersMap[draftOrder.orderId] = Date.now();
    state.knownStoreOrderIds.add(draftOrder.orderId);
    state.orders.unshift(draftOrder);
    saveCachedOrders(state.orders);

    enrichStoresAndAi();
    saveLocalStores(state.stores);

    state.posCart = [];
    state.posCashReceived = '';
    state.posSplitCashAmount = '';
    state.posManualDiscount = 0;
    state.posManualDiscountReason = '';
    state.posCustomerNote = '';
    state.posTaxId = '';
    renderMerchantView();

    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'submitOrder',
          ...getMerchantAuthPayload(),
          ...draftOrder,
          clientDeviceId: state.clientDeviceId,
          orderSource: draftOrder.studentId,
          campus: store.campus,
          items: structuredItems
        })
      });
      const data = await res.json();
      if (data && data.success && data.order && data.order.pickupNumber) {
        const prevOfflineNum = String(draftOrder.pickupNumber || '');
        const authNum = String(data.order.pickupNumber);
        if (prevOfflineNum && prevOfflineNum !== authNum) {
          draftOrder.originalOfflinePickupNumber = prevOfflineNum;
        }
        draftOrder.pickupNumber = authNum;
        draftOrder.verificationCode = String(data.order.verificationCode || '');
        draftOrder.isOfflinePending = false;
        syncLocalSeqWithAuthoritativeNumber(store.id, pickupDateVal, draftOrder.pickupNumber);
        saveCachedOrders(state.orders);
        renderMerchantView();
        openReceiptPrintModal(draftOrder.orderId);
        showToast(`🖨️ 櫃檯出單成功！單號 #${draftOrder.pickupNumber} (已開啟含顧客追蹤 QR 之小票)${changeAmount > 0 ? `，找零 NT$ ${changeAmount}` : ''}`);
        return;
      }
    } catch (e) {}

    openReceiptPrintModal(draftOrder.orderId);
    showToast(`⚠️ 門市網路暫時離線：已開立單號 #${draftOrder.pickupNumber} 並開啟小票預覽，連線恢復後將自動同步！`);
  } finally {
    state.isPosSubmitting = false;
    renderMerchantView();
  }
}

function isOrderConsiderPaid(order) {
  const ps = String(order?.paymentStatus || '');
  return ps.startsWith('已付款');
}

function updateShiftSettlementField(field, val) {
  if (field === 'shiftOpeningFloat') {
    state.shiftOpeningFloat = Math.max(0, parseInt(val || '0', 10) || 0);
    try { localStorage.setItem('mealflow_shift_float', String(state.shiftOpeningFloat)); } catch (e) {}
  } else if (field === 'shiftActualCountedCash') {
    state.shiftActualCountedCash = val === '' ? '' : String(Math.max(0, parseInt(val, 10) || 0));
  } else if (field === 'shiftCashierName') {
    state.shiftCashierName = String(val || '').trim();
    try { localStorage.setItem('mealflow_shift_cashier', state.shiftCashierName); } catch (e) {}
  }
  openShiftZReportModal();
}

async function lockTodayShiftSettlement(expectedDrawerCash, actualCounted, varianceAmt) {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const todayStr = getTodayDateStr();
  const cashier = state.shiftCashierName || '值班店長';
  const lockKey = `mealflow_shift_locked_${store.id}_${todayStr}`;
  const lockRecord = {
    lockedAt: `${todayStr} ${getTaipeiTimeHHMMSS()}`,
    cashier,
    openingFloat: state.shiftOpeningFloat,
    expectedDrawerCash,
    actualCounted,
    varianceAmt
  };
  if (!state.lockedShiftsMap || typeof state.lockedShiftsMap !== 'object') {
    state.lockedShiftsMap = {};
  }
  if (!state.lockedShiftsMap[store.id]) state.lockedShiftsMap[store.id] = {};
  state.lockedShiftsMap[store.id][todayStr] = lockRecord;
  try {
    localStorage.setItem(lockKey, JSON.stringify(lockRecord));
  } catch (e) {}

  recordMerchantAuditLog('完成交班日結關班', `經手人：${cashier}，應有錢箱現金 $${expectedDrawerCash}，實點 $${actualCounted}，差額 $${varianceAmt}`);
  openShiftZReportModal();
  renderMerchantView();
  showToast(`🔒 已完成「${store.name}」今日 (${todayStr}) 交班日結鎖定並同步雲端稽核紀錄！`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'lockShiftZReport',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        dateStr: todayStr,
        lockRecord
      })
    });
  } catch (e) {}
}

async function unlockTodayShiftSettlement() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const todayStr = getTodayDateStr();
  const reason = await showAppPromptModal({
    title: '🔓 解除今日交班日結鎖定',
    message: `確定要解除「${store.name}」今日 (${todayStr}) 的交班日結鎖定嗎？\n請輸入店長解鎖原因（將永久寫入雲端稽核紀錄）：`,
    defaultValue: '補登漏單 / 重新盤點錢箱',
    placeholder: '請輸入解鎖原因',
    confirmText: '確定解除鎖定',
    danger: true
  });
  if (reason === null) return;
  const cleanReason = reason.trim() || '店長手動解鎖重結';

  const lockKey = `mealflow_shift_locked_${store.id}_${todayStr}`;
  try { localStorage.removeItem(lockKey); } catch (e) {}
  if (state.lockedShiftsMap && state.lockedShiftsMap[store.id]) {
    delete state.lockedShiftsMap[store.id][todayStr];
  }

  recordMerchantAuditLog('解除交班日結鎖定', `店長解除 ${todayStr} 關班鎖定，原因：${cleanReason}`);
  openShiftZReportModal();
  renderMerchantView();
  showToast(`🔓 已解除「${store.name}」今日關班鎖定，可繼續調整帳務或重新日結！`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'unlockShiftZReport',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        dateStr: todayStr,
        reason: cleanReason
      })
    });
  } catch (e) {}
}

function addShiftPettyCashEntry() {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const todayStr = getTodayDateStr();
  if (getLockedShiftRecord(store.id, todayStr)) {
    showToast('🔒 本班已完成關班鎖定，如需新增零用金收支請先解鎖！');
    return;
  }
  const typeVal = document.getElementById('pettyCashTypeSelect')?.value || 'OUT';
  const amtVal = Math.max(0, parseInt(document.getElementById('pettyCashAmountInput')?.value || '0', 10) || 0);
  const noteVal = (document.getElementById('pettyCashNoteInput')?.value || '').trim();
  if (amtVal <= 0) {
    showToast('⚠️ 請輸入大於 0 的零用金收支金額！');
    return;
  }
  if (!noteVal) {
    showToast('⚠️ 請輸入零用金用途或事由（例如：買冰塊、買塑膠袋、補百元鈔）！');
    return;
  }
  const entries = [...getShiftPettyCashEntries(store.id, todayStr)];
  const newEntry = {
    id: 'PC-' + Date.now().toString(36).toUpperCase(),
    type: typeVal === 'IN' ? 'IN' : 'OUT',
    amount: amtVal,
    reason: noteVal,
    cashier: state.shiftCashierName || '值班人員',
    time: getTaipeiTimeHHMMSS()
  };
  entries.push(newEntry);
  saveShiftPettyCashEntries(store.id, todayStr, entries);
  recordMerchantAuditLog(
    newEntry.type === 'OUT' ? '錢箱零用金支出 (Payout)' : '錢箱零用金補入 (Pay-in)',
    `${newEntry.type === 'OUT' ? '-' : '+'}NT$${amtVal}（事由：${noteVal}）`
  );
  openShiftZReportModal();
  showToast(`🪙 已記錄錢箱零用金${newEntry.type === 'OUT' ? '支出 -$' : '補入 +$'}${amtVal} (${noteVal})！`);
}

function removeShiftPettyCashEntry(entryId) {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const todayStr = getTodayDateStr();
  if (getLockedShiftRecord(store.id, todayStr)) {
    showToast('🔒 本班已完成關班鎖定，無法刪除零用金紀錄！');
    return;
  }
  const entries = getShiftPettyCashEntries(store.id, todayStr).filter(e => e.id !== entryId);
  saveShiftPettyCashEntries(store.id, todayStr, entries);
  recordMerchantAuditLog('刪除錢箱零用金紀錄', `已移除零用金紀錄 (${entryId})`);
  openShiftZReportModal();
}

/**
 * 【商業級改造 9 & B5 & #13 & #33 & #45】會計級櫃檯錢箱交班日結單
 * 支援：開店找零準備金 (Opening Float)、中途零用金收支 (Petty Cash Payout/Pay-in)、嚴格收款日歸屬 (防止跨日預訂單重複計算營收)、雲端同步關班鎖定與店長解鎖
 */
function openShiftZReportModal() {
  ensureSharedModalsMounted();
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;

  const todayStr = getTodayDateStr();
  const lockedShiftInfo = getLockedShiftRecord(store.id, todayStr);

  // #33 修正跨日預訂單重複計算問題：
  // 1. 已收款訂單與退款訂單嚴格以「實際收款日期 (paidAtDate)」歸屬當日營業額與錢箱現金，絕不因 pickupDate 到了今日又重複算進今日錢箱！
  // 2. 跨日預收且於今日取餐履約的訂單獨立列出「今日取餐之跨日預收單」供對帳參考。
  const storeAllOrders = state.orders.filter(o => o.storeId === store.id);

  const paidOrders = storeAllOrders.filter(o =>
    !String(o.status).includes('已取消') &&
    isOrderConsiderPaid(o) &&
    normalizeDateStr(o.paidAtDate || o.pickupDate) === todayStr
  );
  const unpaidOrders = storeAllOrders.filter(o =>
    !String(o.status).includes('已取消') &&
    !isOrderConsiderPaid(o) &&
    normalizeDateStr(o.pickupDate) === todayStr
  );
  const cancelledOrders = storeAllOrders.filter(o =>
    String(o.status).includes('已取消') &&
    normalizeDateStr(o.paidAtDate || o.pickupDate) === todayStr
  );
  const refundedOrders = cancelledOrders.filter(o => Number(o.refundAmount) > 0 || String(o.paymentStatus).includes('已退款'));
  const voidUnpaidOrders = cancelledOrders.filter(o => !(Number(o.refundAmount) > 0 || String(o.paymentStatus).includes('已退款')));

  // 跨日預收、今日履約取餐之訂單（已於原收款日入帳，今日僅供廚房履約核對，不重複計入今日錢箱）
  const crossDayPrepaidFulfilledToday = storeAllOrders.filter(o =>
    !String(o.status).includes('已取消') &&
    isOrderConsiderPaid(o) &&
    normalizeDateStr(o.pickupDate) === todayStr &&
    normalizeDateStr(o.paidAtDate || o.pickupDate) !== todayStr
  );
  const crossDayPrepaidTotal = crossDayPrepaidFulfilledToday.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const foodGrossSubtotal = paidOrders.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
  const cutleryFeeSum = paidOrders.reduce((s, o) => s + (Number(o.cutleryFee) || 0), 0);
  const promoDiscountSum = paidOrders.reduce((s, o) => s + (Number(o.discount) || 0), 0);
  const manualDiscountSum = paidOrders.reduce((s, o) => s + (Number(o.manualDiscount) || 0), 0);
  const netRevenue = paidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const avgOrderValue = paidOrders.length > 0 ? Math.round(netRevenue / paidOrders.length) : 0;

  // #12 支援複合付款 (paymentSplit) 精準拆算至現金錢箱與行動支付入帳
  const cashOrders = paidOrders.filter(o =>
    (o.paymentSplit && Number(o.paymentSplit.cash) > 0) ||
    (!o.paymentSplit && (String(o.paymentMethod).includes('現金') || String(o.paymentMethod).includes('付現')))
  );
  const linePayOrders = paidOrders.filter(o =>
    (o.paymentSplit && Number(o.paymentSplit.linePay) > 0) ||
    (!o.paymentSplit && o.paymentMethod === 'LINE Pay')
  );

  const cashNetTotal = cashOrders.reduce((s, o) => s + (o.paymentSplit ? (Number(o.paymentSplit.cash) || 0) : (Number(o.finalTotal) || 0)), 0);
  const cashTenderedSum = cashOrders.reduce((s, o) => {
    if (o.paymentSplit) return s + (Number(o.paymentSplit.cash) || 0);
    return s + (Number(o.cashReceived) > 0 ? Number(o.cashReceived) : (Number(o.finalTotal) || 0));
  }, 0);
  const cashChangeSum = cashOrders.reduce((s, o) => s + (o.paymentSplit ? 0 : (Number(o.changeGiven) || 0)), 0);
  const cashRefundSum = refundedOrders
    .filter(o => String(o.refundMethod || o.paymentMethod).includes('現金') || String(o.refundMethod || o.paymentMethod).includes('付現'))
    .reduce((s, o) => s + (Number(o.refundAmount) || Number(o.finalTotal) || 0), 0);
  const partialCashRefundSum = paidOrders
    .filter(o => Number(o.partialRefundTotal) > 0 && (String(o.paymentMethod).includes('現金') || String(o.paymentMethod).includes('付現') || (o.paymentSplit && Number(o.paymentSplit.cash) > 0)))
    .reduce((s, o) => s + (Number(o.partialRefundTotal) || 0), 0);

  // #45 中途零用金支出 (Payout) 與補入 (Pay-in) 納入錢箱應有現金公式
  const pettyEntries = getShiftPettyCashEntries(store.id, todayStr);
  const pettyCashInSum = pettyEntries.filter(e => e.type === 'IN').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pettyCashOutSum = pettyEntries.filter(e => e.type === 'OUT').reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const openingFloat = Math.max(0, Number(state.shiftOpeningFloat) || 0);
  const expectedTotalCashInDrawer = Math.max(0, openingFloat + cashNetTotal + pettyCashInSum - pettyCashOutSum - cashRefundSum - partialCashRefundSum);
  const actualCountedNum = state.shiftActualCountedCash !== '' ? Math.max(0, Number(state.shiftActualCountedCash) || 0) : expectedTotalCashInDrawer;
  const cashVariance = actualCountedNum - expectedTotalCashInDrawer;

  const linePayTotal = linePayOrders.reduce((s, o) => s + (o.paymentSplit ? (Number(o.paymentSplit.linePay) || 0) : (Number(o.finalTotal) || 0)), 0);
  const refundedTotal = refundedOrders.reduce((s, o) => s + (Number(o.refundAmount) || Number(o.finalTotal) || 0), 0);
  const voidUnpaidTotal = voidUnpaidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const unpaidTotal = unpaidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const dineInCount = paidOrders.filter(o => o.dineType === '內用自取').length;
  const takeoutCount = paidOrders.length - dineInCount;

  const titleEl = document.getElementById('receiptPrintModalTitle');
  if (titleEl) titleEl.innerText = '🧾 櫃檯錢箱交班日結單 (Z-Report)';

  const body = document.getElementById('receiptPrintModalBody');
  if (body) {
    body.innerHTML = `
      <div class="no-print" style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:12px; padding:12px; margin-bottom:14px;">
        <div style="font-size:0.82rem; font-weight:900; color:#0F172A; margin-bottom:8px;">
          🪙 班別錢箱清點・中途零用金收支與關班鎖定（列印時自動隱藏此設定框）
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(145px, 1fr)); gap:8px; margin-bottom:10px;">
          <div>
            <label class="field-label">開店找零零用金 ($)</label>
            <input type="number" class="select-input" style="padding:6px 8px; font-size:0.82rem;" value="${openingFloat}" ${lockedShiftInfo ? 'disabled' : ''} onchange="updateShiftSettlementField('shiftOpeningFloat', this.value)">
          </div>
          <div>
            <label class="field-label">櫃檯實際清點現金 ($)</label>
            <input type="number" class="select-input" style="padding:6px 8px; font-size:0.82rem;" placeholder="應有 $${expectedTotalCashInDrawer}" value="${escapeHtml(state.shiftActualCountedCash)}" ${lockedShiftInfo ? 'disabled' : ''} onchange="updateShiftSettlementField('shiftActualCountedCash', this.value)">
          </div>
          <div>
            <label class="field-label">交班收銀員姓名</label>
            <input type="text" class="select-input" style="padding:6px 8px; font-size:0.82rem;" placeholder="如：王店長 / 早班" value="${escapeHtml(state.shiftCashierName)}" ${lockedShiftInfo ? 'disabled' : ''} onchange="updateShiftSettlementField('shiftCashierName', this.value)">
          </div>
        </div>

        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px; margin-bottom:10px;">
          <div style="font-size:0.78rem; font-weight:900; color:#334155; margin-bottom:6px;">
            💸 中途零用金收支登記（如：買冰塊、買免洗袋、採買食材或臨時補零錢，自動計入錢箱應有現金）
          </div>
          ${!lockedShiftInfo ? `
            <div style="display:grid; grid-template-columns:0.9fr 0.8fr 1.6fr auto; gap:6px; align-items:center; margin-bottom:8px;">
              <select id="pettyCashTypeSelect" class="select-input" style="padding:5px 8px; font-size:0.78rem;">
                <option value="OUT">📤 錢箱支出 (-$)</option>
                <option value="IN">📥 錢箱補入 (+$)</option>
              </select>
              <input type="number" id="pettyCashAmountInput" class="select-input" style="padding:5px 8px; font-size:0.78rem;" placeholder="金額 ($)">
              <input type="text" id="pettyCashNoteInput" class="select-input" style="padding:5px 8px; font-size:0.78rem;" placeholder="事由 (如: 買冰塊、買塑膠袋)">
              <button type="button" class="btn-tip-action" style="padding:6px 10px; font-size:0.76rem;" onclick="addShiftPettyCashEntry()">＋ 登記</button>
            </div>
          ` : ''}
          ${pettyEntries.length === 0 ? `
            <div style="font-size:0.74rem; color:var(--text-muted);">今日尚無中途零用金支出或補入紀錄</div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:4px; max-height:110px; overflow-y:auto;">
              ${pettyEntries.map(e => `
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; background:#F8FAFC; padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0;">
                  <span>
                    <strong style="color:${e.type === 'OUT' ? 'var(--red)' : 'var(--green)'};">${e.type === 'OUT' ? '支出 -$' : '補入 +$'}${e.amount}</strong>
                    ・ ${escapeHtml(e.reason)} <span style="color:var(--text-muted);">(${escapeHtml(e.time)})</span>
                  </span>
                  ${!lockedShiftInfo ? `<button type="button" onclick="removeShiftPettyCashEntry(${escapeJsAttr(e.id)})" style="border:none; background:transparent; color:var(--red); font-weight:900; cursor:pointer; font-size:0.74rem;">✕</button>` : ''}
                </div>
              `).join('')}
            </div>
          `}
        </div>

        ${lockedShiftInfo ? `
          <div style="background:#ECFDF5; border:1.5px solid #10B981; color:#065F46; padding:10px 12px; border-radius:10px; font-size:0.78rem; font-weight:800; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              🔒 本班已完成關班鎖定並禁止補開當日立即單（時間：${escapeHtml(lockedShiftInfo.lockedAt)} ・ 經手人：${escapeHtml(lockedShiftInfo.cashier)}）
            </div>
            <button type="button" onclick="unlockTodayShiftSettlement()" style="border:1px solid #059669; background:#FFFFFF; color:#065F46; padding:5px 10px; border-radius:6px; font-size:0.74rem; font-weight:900; cursor:pointer;">
              🔓 店長授權解鎖重結
            </button>
          </div>
        ` : `
          <button type="button" class="btn-tip-action" style="width:100%; background:#0F172A; padding:9px;" onclick="lockTodayShiftSettlement(${expectedTotalCashInDrawer}, ${actualCountedNum}, ${cashVariance})">
            🔒 確認完成本班日結並鎖定當日帳務 (防篡改)
          </button>
        `}
      </div>

      <div class="thermal-receipt-paper">
        <div style="text-align:center; margin-bottom:8px;">
          <div style="font-size:0.76rem; font-weight:800;">${escapeHtml(BRAND_CONFIG.posTitle)}</div>
          <div style="font-size:1.1rem; font-weight:950; margin:2px 0;">${escapeHtml(store.name)}</div>
          <div style="font-size:0.85rem; font-weight:900; background:#000; color:#fff; padding:3px 10px; border-radius:4px; display:inline-block; margin-top:4px;">
            櫃檯錢箱交班日結單 ${lockedShiftInfo ? '(已關班鎖定)' : '(預覽)'}
          </div>
        </div>

        <div style="font-size:0.76rem; line-height:1.5;">
          <div>營業收款日：${todayStr}</div>
          <div>出表時間：${getTaipeiTimeHHMMSS()}</div>
          <div>值班人員：${escapeHtml(state.shiftCashierName || (lockedShiftInfo && lockedShiftInfo.cashier) || '當班收銀員')}</div>
          <div>當日收款單數：${paidOrders.length} 筆 (內用 ${dineInCount} / 外帶 ${takeoutCount})</div>
          <div>平均客單價：NT$ ${avgOrderValue.toLocaleString()}</div>
        </div>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">【一、當日收款損益與代收費用拆解】</div>
        <table class="z-report-table">
          <tr><td>餐點商品毛銷售額</td><td>NT$ ${foodGrossSubtotal.toLocaleString()}</td></tr>
          <tr><td>一次性環保餐具費</td><td>+NT$ ${cutleryFeeSum.toLocaleString()}</td></tr>
          <tr><td>離峰分流折扣讓利</td><td>-NT$ ${promoDiscountSum.toLocaleString()}</td></tr>
          <tr><td>櫃檯手動折讓/招待</td><td>-NT$ ${manualDiscountSum.toLocaleString()}</td></tr>
          <tr style="border-top:1px solid #000; font-size:0.92rem;"><td><strong>當日實收淨營業額</strong></td><td><strong>NT$ ${netRevenue.toLocaleString()}</strong></td></tr>
        </table>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">【二、錢箱現金收付與盤點核對】</div>
        <table class="z-report-table">
          <tr><td>開店找零準備金 (零用金)</td><td>NT$ ${openingFloat.toLocaleString()}</td></tr>
          <tr><td>現金交易顧客實收總額</td><td>+NT$ ${cashTenderedSum.toLocaleString()}</td></tr>
          <tr><td>現金交易找零總額</td><td>-NT$ ${cashChangeSum.toLocaleString()}</td></tr>
          <tr><td>現金已收後退單退款</td><td>-NT$ ${cashRefundSum.toLocaleString()}</td></tr>
          ${pettyCashInSum > 0 ? `<tr><td>中途零用金補入 (Pay-in)</td><td>+NT$ ${pettyCashInSum.toLocaleString()}</td></tr>` : ''}
          ${pettyCashOutSum > 0 ? `<tr><td>中途零用金支出 (Payout)</td><td>-NT$ ${pettyCashOutSum.toLocaleString()}</td></tr>` : ''}
          <tr style="border-top:1px dashed #000;"><td><strong>💵 現金營業淨入帳 (${cashOrders.length}筆)</strong></td><td><strong>NT$ ${cashNetTotal.toLocaleString()}</strong></td></tr>
          <tr><td><strong>🏦 錢箱應有現金總額 (含零用金收支)</strong></td><td><strong>NT$ ${expectedTotalCashInDrawer.toLocaleString()}</strong></td></tr>
          <tr><td>櫃檯實際清點現金</td><td>NT$ ${actualCountedNum.toLocaleString()}</td></tr>
          <tr style="border-top:1px solid #000;"><td><strong>盤點差額 (短溢)</strong></td><td><strong>${cashVariance === 0 ? 'NT$ 0 (帳實相符)' : (cashVariance > 0 ? `+NT$ ${cashVariance} (溢收)` : `-NT$ ${Math.abs(cashVariance)} (短少)`)}</strong></td></tr>
        </table>
        ${pettyEntries.length > 0 ? `
          <div style="font-size:0.72rem; margin-top:4px; border-top:1px dotted #666; padding-top:4px;">
            <div style="font-weight:900;">零用金收支明細：</div>
            ${pettyEntries.map(e => `<div>・[${e.type === 'OUT' ? '支出' : '補入'}] ${escapeHtml(e.reason)}: ${e.type === 'OUT' ? '-' : '+'}NT$${e.amount} (${escapeHtml(e.time)})</div>`).join('')}
          </div>
        ` : ''}

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">【三、行動支付與無現金清點】</div>
        <table class="z-report-table">
          <tr><td>💚 LINE Pay 當日入帳 (${linePayOrders.length}筆)</td><td>NT$ ${linePayTotal.toLocaleString()}</td></tr>
          <tr style="border-top:1px dashed #000;"><td><strong>非現金支付小計</strong></td><td><strong>NT$ ${linePayTotal.toLocaleString()}</strong></td></tr>
        </table>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">【四、退款、作廢與跨日預收履約對帳】</div>
        <table class="z-report-table">
          <tr><td>⏳ 今日待收款訂單 (${unpaidOrders.length}筆)</td><td>NT$ ${unpaidTotal.toLocaleString()}</td></tr>
          <tr><td>💸 已付款後退單退款 (${refundedOrders.length}筆)</td><td>NT$ ${refundedTotal.toLocaleString()}</td></tr>
          <tr><td>🚫 未收款取消作廢 (${voidUnpaidOrders.length}筆)</td><td>NT$ ${voidUnpaidTotal.toLocaleString()}</td></tr>
          <tr><td>📦 跨日預收今日取餐 (${crossDayPrepaidFulfilledToday.length}筆・不重複入錢箱)</td><td>NT$ ${crossDayPrepaidTotal.toLocaleString()}</td></tr>
        </table>

        <div class="thermal-divider"></div>
        <div style="font-size:0.74rem; line-height:1.8; margin-top:8px;">
          <div>值班收銀員簽名：<u>&nbsp;&nbsp;${escapeHtml(state.shiftCashierName || '__________________')}&nbsp;&nbsp;</u></div>
          <div>店長覆核簽名：____________________</div>
        </div>
      </div>
    `;
  }
  document.getElementById('receiptPrintModal')?.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('receiptPrintModal'));
}
// ==================== 6.2 廚房控單 (KDS) — 規格拆解看板 + 鏡頭光學掃碼核銷 ====================
function setKdsDateFilter(dateVal) {
  state.kdsSelectedDate = dateVal === 'ALL' ? 'ALL' : normalizeDateStr(dateVal);
  renderMerchantOrdersOnly();
}

function setKdsStatusFilter(statusVal) {
  state.kdsStatusFilter = statusVal;
  renderMerchantOrdersOnly();
}

function toggleKdsSound() {
  state.kdsSoundEnabled = !state.kdsSoundEnabled;
  renderMerchantOrdersOnly();
  showToast(state.kdsSoundEnabled ? '🔊 已開啟新訂單自動語音播報' : '🔇 已靜音新訂單語音播報');
}

function handleKdsSearchInput(val) {
  state.kdsSearchQuery = val;
  renderMerchantOrdersOnly(null, true);
}

/**
 * 【商業級改造 B8 & #2】開啟顧客叫號大螢幕看板 (Customer Pickup Display Board)
 * 支援：
 * 1. 每次 syncCloud / applyCloudBundle / 狀態更新後自動即時重繪 (`refreshCustomerPickupBoardIfOpen`)，絕非靜態快照
 * 2. 支援獨立大螢幕電視模式網址 (`?mode=board&store=S01`)，免登入店家 PIN 即可透過 `storeQueueProgressMap` + `orders` 即時顯示並保持螢幕常亮 (WakeLock)
 * 3. 新號碼進入「請至櫃檯取餐」綠區時自動播放叫號音效與語音播報
 */
function openStandalonePickupBoardWindow(storeId) {
  const targetStoreId = storeId || state.pickupBoardStoreId || state.merchantStoreId || 'S01';
  const url = `${window.location.origin}${window.location.pathname}?mode=board&store=${encodeURIComponent(targetStoreId)}`;
  window.open(url, '_blank', 'noopener');
}

function switchPickupBoardStore(newStoreId) {
  if (!newStoreId) return;
  state.pickupBoardStoreId = newStoreId;
  state.merchantStoreId = newStoreId;
  syncUrlStateWithHistory(true);
  renderCustomerPickupBoardContent(false);
}

function closeCustomerPickupBoardModal() {
  document.getElementById('customerPickupBoardModal')?.classList.remove('open');
  if (state.routeMode === 'board') {
    state.routeMode = 'student';
    applyRouteView();
    syncUrlStateWithHistory(true);
  }
}

function refreshCustomerPickupBoardIfOpen(playChimeOnNew = false) {
  const boardModal = document.getElementById('customerPickupBoardModal');
  if (state.routeMode === 'board' || (boardModal && boardModal.classList.contains('open'))) {
    renderCustomerPickupBoardContent(playChimeOnNew);
  }
}

function openCustomerPickupBoardModal() {
  ensureSharedModalsMounted();
  if (!state.pickupBoardStoreId) {
    state.pickupBoardStoreId = state.merchantStoreId || (state.stores[0] && state.stores[0].id) || 'S01';
  }
  let boardModal = document.getElementById('customerPickupBoardModal');
  if (!boardModal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="customerPickupBoardModal" class="modal-overlay" style="z-index:260; padding:16px; background:rgba(15,23,42,0.96);">
        <div style="width:100%; max-width:1240px; background:#0F172A; color:#FFFFFF; border-radius:24px; border:1.5px solid #334155; padding:24px; box-shadow:0 24px 60px rgba(0,0,0,0.6);">
          <div id="customerPickupBoardBody"></div>
        </div>
      </div>
    `);
    boardModal = document.getElementById('customerPickupBoardModal');
  }
  renderCustomerPickupBoardContent(false);
  boardModal.classList.add('open');
  requestMerchantWakeLock();
}

function renderCustomerPickupBoardContent(playChimeOnNew = false) {
  const targetStoreId = state.pickupBoardStoreId || state.merchantStoreId || (state.stores[0] && state.stores[0].id) || 'S01';
  const store = state.stores.find(s => s.id === targetStoreId) || state.stores[0];
  if (!store) return;

  const todayStr = getTodayDateStr();
  const todayOrders = state.orders.filter(o => o.storeId === store.id && normalizeDateStr(o.pickupDate || todayStr) === todayStr);

  // 合併本機已同步訂單與雲端公開叫號摘要 (storeQueueProgressMap)，確保獨立電視看板 (?mode=board) 免登入也能即時顯示號碼
  const cookingNumSet = new Set();
  const readyNumSet = new Set();

  todayOrders.forEach(o => {
    const pNum = String(o.pickupNumber || '').trim();
    if (!pNum) return;
    if (o.status === '製作中') cookingNumSet.add(pNum);
    else if (o.status === '可取餐') readyNumSet.add(pNum);
  });

  const qProg = (state.storeQueueProgressMap && state.storeQueueProgressMap[store.id]) || null;
  if (qProg) {
    if (Array.isArray(qProg.readyNumbers)) {
      qProg.readyNumbers.forEach(n => {
        const clean = String(n || '').trim();
        if (clean) {
          readyNumSet.add(clean);
          cookingNumSet.delete(clean);
        }
      });
    }
    if (Array.isArray(qProg.cookingNumbers)) {
      qProg.cookingNumbers.forEach(n => {
        const clean = String(n || '').trim();
        if (clean && !readyNumSet.has(clean)) cookingNumSet.add(clean);
      });
    }
  }

  const cookingNumbers = Array.from(cookingNumSet).sort();
  const readyNumbers = Array.from(readyNumSet).sort();

  // 檢查是否有新出爐的取餐號碼，若有則在看板端自動發聲叮咚與語音叫號
  if (!state.lastSeenBoardReadyNumbersMap) state.lastSeenBoardReadyNumbersMap = {};
  const prevReadySet = state.lastSeenBoardReadyNumbersMap[store.id] || new Set();
  const newlyCalledNums = readyNumbers.filter(n => !prevReadySet.has(n));
  state.lastSeenBoardReadyNumbersMap[store.id] = new Set(readyNumbers);

  if (playChimeOnNew && newlyCalledNums.length > 0) {
    playPickupChime();
    try {
      if ('speechSynthesis' in window) {
        const numText = newlyCalledNums.join('號、');
        const utter = new SpeechSynthesisUtterance(`請 ${numText} 號至 ${store.name} 櫃檯取餐`);
        utter.lang = 'zh-TW';
        utter.rate = 1.0;
        window.speechSynthesis.speak(utter);
      }
    } catch (e) {}
  }

  const body = document.getElementById('customerPickupBoardBody');
  if (body) {
    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:16px; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="font-size:2.4rem;">${getStoreIconDisplay(store)}</span>
          <div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <h2 style="font-size:1.65rem; font-weight:950; color:#FFFFFF; letter-spacing:0.02em; margin:0;">${escapeHtml(store.name)} — 即時取餐叫號看板</h2>
              <span style="font-size:0.75rem; font-weight:900; background:#065F46; color:#6EE7B7; padding:3px 10px; border-radius:999px; border:1px solid #10B981;">
                ● LIVE 雲端即時同步中 (<span id="pickupBoardLiveClock">${getTaipeiTimeHHMMSS()}</span>)
              </span>
            </div>
            <div style="font-size:0.85rem; color:#94A3B8; margin-top:3px;">請留意您的 4 碼取餐流水號，顯示於右側綠區即可憑 QR Code 至櫃檯取餐</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <select class="select-input" style="width:auto; background:#1E293B; color:#FFFFFF; border-color:#475569; padding:7px 12px; font-size:0.82rem; font-weight:800;" onchange="switchPickupBoardStore(this.value)">
            ${state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>切換看板店鋪：${escapeHtml(s.name)}</option>`).join('')}
          </select>
          <button type="button" onclick="ensureAudioContextUnlocked(true); showToast('🔊 已啟用叫號看板語音與叮咚音效！');" style="border:1px solid #10B981; background:#065F46; color:#FFFFFF; padding:8px 14px; border-radius:999px; font-weight:800; font-size:0.82rem; cursor:pointer;">
            🔊 啟用叫號音效
          </button>
          <button type="button" onclick="closeCustomerPickupBoardModal()" style="border:1px solid #475569; background:#1E293B; color:#FFFFFF; padding:8px 16px; border-radius:999px; font-weight:800; font-size:0.85rem; cursor:pointer;">
            ✕ ${state.routeMode === 'board' ? '返回點餐首頁' : '關閉看板'}
          </button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; min-height:410px;">
        <div style="background:#1E293B; border:1.5px solid #334155; border-radius:18px; padding:18px;">
          <div style="font-size:1.15rem; font-weight:900; color:#FBBF24; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
            <span>🍳 廚房準備中 (Preparing)</span>
            <span style="font-size:0.85rem; background:rgba(251,191,36,0.15); padding:3px 10px; border-radius:999px;">${cookingNumbers.length} 單</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(125px, 1fr)); gap:12px;">
            ${cookingNumbers.length === 0 ? `<div style="grid-column:1/-1; color:#64748B; text-align:center; padding:60px 0; font-weight:700;">目前無準備中單號</div>` : cookingNumbers.map(num => `
              <div style="background:#0F172A; border:1.5px solid #475569; border-radius:14px; padding:14px 10px; text-align:center; font-size:1.85rem; font-weight:950; color:#F8FAFC;">
                #${escapeHtml(num)}
              </div>
            `).join('')}
          </div>
        </div>

        <div style="background:rgba(16,185,129,0.1); border:2px solid #10B981; border-radius:18px; padding:18px;">
          <div style="font-size:1.15rem; font-weight:900; color:#34D399; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
            <span>🔔 請至櫃檯取餐 (Ready for Pickup)</span>
            <span style="font-size:0.85rem; background:rgba(16,185,129,0.25); padding:3px 10px; border-radius:999px;">${readyNumbers.length} 單</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:12px;">
            ${readyNumbers.length === 0 ? `<div style="grid-column:1/-1; color:#6EE7B7; opacity:0.65; text-align:center; padding:60px 0; font-weight:700;">請稍候，餐點完成將立即顯示並語音叫號</div>` : readyNumbers.map(num => {
              const isNew = newlyCalledNums.includes(num);
              return `
                <div style="background:#10B981; color:#FFFFFF; border-radius:14px; padding:16px 10px; text-align:center; font-size:2.15rem; font-weight:950; box-shadow:0 8px 24px rgba(16,185,129,0.35); ${isNew ? 'animation:pulse 1s infinite; border:3px solid #FDE047;' : ''}">
                  #${escapeHtml(num)}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('customerPickupBoardModal'));
}

/**
 * 支援解析「訂單追蹤網址 (?id=ORD-...&v=...)」、「6 碼防偽碼」、「取餐號」、「訂單號」或「MEALFLOW|核銷碼|取餐號|訂單號」QR 掃描字串；
 * 若本機尚未同步到該筆新訂單，自動即時向雲端補查，並支援跨店提示或自動切換店鋪核銷！
 */
async function quickVerifyAndCompleteByCode(rawInput) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  let raw = String(rawInput ?? document.getElementById('kdsQuickVerifyInput')?.value ?? '').trim();
  if (!raw) {
    showToast('🛡️ 請輸入或掃描顧客憑證上的 QR Code 或 6 碼防偽核銷碼！');
    return;
  }

  let candidateVerCode = '';
  let candidatePickup = '';
  let candidateOrdId = '';

  // 1. 優先檢查是否為訂單追蹤網址 (例如 https://.../order/?id=ORD-xxxx&v=XXXXXX)
  if (/^https?:\/\//i.test(raw) || raw.includes('id=ORD-') || raw.includes('order=')) {
    try {
      const urlObj = new URL(raw, window.location.origin);
      const idParam = (urlObj.searchParams.get('id') || urlObj.searchParams.get('order') || '').trim().toUpperCase();
      const vParam = (urlObj.searchParams.get('v') || urlObj.searchParams.get('code') || '').trim().toUpperCase();
      if (idParam) candidateOrdId = idParam;
      if (vParam) candidateVerCode = vParam;
    } catch (e) {
      const mId = raw.match(/[?&](?:id|order)=(ORD-[A-Za-z0-9\-]+)/i);
      const mV = raw.match(/[?&](?:v|code)=([A-Za-z0-9]{6})/i);
      if (mId) candidateOrdId = mId[1].toUpperCase();
      if (mV) candidateVerCode = mV[1].toUpperCase();
    }
  }

  // 2. 若非網址，檢查是否為 MEALFLOW|... 分隔字串或純單號/防偽碼
  if (!candidateOrdId && !candidateVerCode) {
    const upper = raw.toUpperCase();
    if (upper.startsWith('MEALFLOW|') || upper.includes('|')) {
      const parts = upper.split('|').map(s => s.trim());
      if (parts[0] === 'MEALFLOW') {
        candidateVerCode = parts[1] || '';
        candidatePickup = parts[2] || '';
        candidateOrdId = parts[3] || '';
      } else {
        candidateOrdId = parts[0] || '';
        candidatePickup = parts[1] || '';
        candidateVerCode = parts[2] || '';
      }
    } else {
      const clean = upper.replace(/^#/, '');
      candidateVerCode = clean;
      candidatePickup = clean;
      candidateOrdId = clean;
    }
  }

  const displayToken = candidateVerCode || candidateOrdId || candidatePickup || raw.slice(0, 24);
  const todayStr = getTodayDateStr();
  const matchesCandidate = (o) => {
    const vCode = String(o.verificationCode || '').toUpperCase();
    const pNum = String(o.pickupNumber || '').toUpperCase();
    const oId = String(o.orderId || '').toUpperCase();
    if (candidateVerCode && vCode && vCode === candidateVerCode) return true;
    if (candidateOrdId && oId && oId === candidateOrdId) return true;
    if (candidatePickup && pNum && pNum === candidatePickup) return true;
    return false;
  };

  // 若本機 state.orders 內尚無此單（例如顧客剛在手機下單 1 秒即拿給平板掃描），立即向雲端查詢補入！
  if (!state.orders.some(matchesCandidate)) {
    showToast(`⏳ 正在向雲端即時查驗憑證 (${displayToken})...`);
    let fetchedOrd = null;
    if (candidateOrdId && candidateOrdId.startsWith('ORD-')) {
      fetchedOrd = await tryAutoFetchMissingOrderById(candidateOrdId, true);
    }
    if (!fetchedOrd) {
      const lookupQ = candidateOrdId.startsWith('ORD-') ? candidateOrdId : (candidateVerCode || candidatePickup);
      if (lookupQ) {
        try {
          const res = await fetch(GAS_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'lookupOrders',
              ...getMerchantAuthPayload(),
              query: lookupQ
            })
          });
          const data = await res.json();
          if (data && Array.isArray(data.orders) && data.orders.length > 0) {
            data.orders.forEach(ro => {
              const clean = sanitizeIncomingOrder(ro);
              if (clean && !state.orders.some(x => x.orderId === clean.orderId)) {
                state.orders.unshift(clean);
                state.pendingLocalOrdersMap[clean.orderId] = Date.now();
              }
            });
            saveCachedOrders(state.orders);
          }
        } catch (e) {}
      }
    }
  }

  let allStoreOrders = state.orders.filter(o => o.storeId === state.merchantStoreId);

  // 若在目前選擇的店鋪找不到，但該單屬於另一家學餐店鋪（如平板選在 S02 丼物園，掃描 S01 趙班長海苔飯捲的訂單）
  if (!allStoreOrders.some(matchesCandidate)) {
    const crossStoreMatch = state.orders.find(o => o.storeId !== state.merchantStoreId && matchesCandidate(o));
    if (crossStoreMatch) {
      const authScope = state.merchantAuthorizedStoreScope || sessionStorage.getItem('mealflow_merchant_scope_v13') || 'ALL';
      if (authScope === 'ALL' || authScope === crossStoreMatch.storeId) {
        state.merchantStoreId = crossStoreMatch.storeId;
        try { localStorage.setItem('mealflow_last_merchant_store_id', crossStoreMatch.storeId); } catch (e) {}
        allStoreOrders = state.orders.filter(o => o.storeId === state.merchantStoreId);
        renderMerchantView();
        showToast(`🔄 偵測到此單屬於「${crossStoreMatch.storeName}」，已自動切換店鋪並執行核銷！`);
      } else {
        showToast(`⚠️ 此訂單 #${crossStoreMatch.pickupNumber} 屬於「${crossStoreMatch.storeName}」，非目前店鋪訂單！`);
        return;
      }
    }
  }

  // 優先比對今日且尚未完成/尚未取消之有效訂單，避免跨日同號 (#2001) 誤碰撞或舊憑證重複領餐
  const activeTodayMatch = allStoreOrders.find(o =>
    !String(o.status).includes('已取消') &&
    o.status !== '已完成' &&
    normalizeDateStr(o.pickupDate || todayStr) === todayStr &&
    matchesCandidate(o)
  );
  const activeAnyDayMatch = activeTodayMatch || allStoreOrders.find(o =>
    !String(o.status).includes('已取消') &&
    o.status !== '已完成' &&
    matchesCandidate(o)
  );

  if (activeAnyDayMatch) {
    state.kdsVerifyCodeInput = '';
    acknowledgeAllNewKdsOrders(activeAnyDayMatch.orderId);
    completeOrderFinal(activeAnyDayMatch.orderId);
    return;
  }

  // 防偽攔截：檢查是否為「已經核銷完成過」的憑證重複出示，或「已退單作廢」的訂單
  const alreadyCompletedMatch = allStoreOrders.find(o => o.status === '已完成' && matchesCandidate(o));
  if (alreadyCompletedMatch) {
    try { if ('vibrate' in navigator) navigator.vibrate([160, 80, 160, 80, 160]); } catch (e) {}
    showToast(`🛑 防偽攔截：訂單 #${alreadyCompletedMatch.pickupNumber} (核銷碼 ${formatVerificationCodeDisplay(alreadyCompletedMatch)}) 已於先前核銷領取過了，請勿重複給餐！`);
    return;
  }

  const cancelledMatch = allStoreOrders.find(o => String(o.status).includes('已取消') && matchesCandidate(o));
  if (cancelledMatch) {
    try { if ('vibrate' in navigator) navigator.vibrate([160, 80, 160]); } catch (e) {}
    showToast(`🚫 警告：訂單 #${cancelledMatch.pickupNumber} 已退單作廢 (${cancelledMatch.status})，不可核銷交付！`);
    return;
  }

  showToast(`❌ 查無核銷碼或單號為「${displayToken}」的有效本店訂單！`);
}

/**
 * 【商業級改造 2】開啟 KDS 平板/手機鏡頭即時光學 QR Code 掃描器
 * 支援原生 BarcodeDetector API 與 jsQR (Canvas 跨平台解碼引擎，完整相容 iOS Safari / iPad / Firefox / 桌面瀏覽器)
 */
// #22 延遲動態載入 jsQR.min.js（僅在店家開啟 KDS 鏡頭掃碼器時按需載入，學生點餐頁零負擔）
function ensureJsQrLoaded() {
  if (typeof jsQR === 'function') return Promise.resolve(true);
  if (window.__jsQrLoadingPromise) return window.__jsQrLoadingPromise;
  window.__jsQrLoadingPromise = new Promise(resolve => {
    try {
      const script = document.createElement('script');
      script.src = `${getBaseRootUrl()}jsQR.min.js`;
      script.async = true;
      script.onload = () => resolve(typeof jsQR === 'function');
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    } catch (e) {
      resolve(false);
    }
  });
  return window.__jsQrLoadingPromise;
}

async function openKdsCameraScannerModal() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  ensureSharedModalsMounted();
  ensureJsQrLoaded();
  const modal = document.getElementById('kdsQrScannerModal');
  const body = document.getElementById('kdsQrScannerBody');
  if (!modal || !body) return;

  stopKdsCameraStream();

  body.innerHTML = `
    <div class="qr-scanner-viewport">
      <video id="kdsScannerVideo" autoplay playsinline muted></video>
      <canvas id="kdsScannerCanvas" style="display:none;"></canvas>
      <div class="qr-scanner-frame"></div>
      <div class="qr-scanner-laser"></div>
    </div>
    <p id="kdsScannerStatusText" style="font-size:0.82rem; font-weight:800; color:var(--text-secondary); text-align:center; margin-bottom:12px;">
      📷 正在啟動相機鏡頭，請將顧客手機或小票上的取餐單 QR Code 對準綠框中央...
    </p>
    <div style="display:flex; gap:8px;">
      <input type="text" id="kdsModalManualVerifyInput" class="select-input" style="flex:1; font-family:monospace; font-weight:900; text-transform:uppercase;" placeholder="或直接在此輸入 6 碼核銷碼 / 取餐號" onkeydown="if(event.key==='Enter'){ const v=this.value; closeKdsCameraScannerModal(); quickVerifyAndCompleteByCode(v); }">
      <button type="button" class="btn-tip-action" onclick="const v=document.getElementById('kdsModalManualVerifyInput')?.value; closeKdsCameraScannerModal(); quickVerifyAndCompleteByCode(v);">確認核銷</button>
    </div>
  `;

  modal.classList.add('open');

  const videoEl = document.getElementById('kdsScannerVideo');
  const canvasEl = document.getElementById('kdsScannerCanvas');
  const statusEl = document.getElementById('kdsScannerStatusText');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (statusEl) statusEl.innerText = '⚠️ 此瀏覽器環境不支援調用相機（需 HTTPS 安全連線），請使用下方輸入框或外接掃碼槍核銷。';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    state.scannerStream = stream;
    if (videoEl) {
      videoEl.srcObject = stream;
      videoEl.setAttribute('playsinline', 'true');
      await videoEl.play();
    }

    let nativeDetector = null;
    if ('BarcodeDetector' in window) {
      try {
        nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {
        nativeDetector = null;
      }
    }

    const hasJsQr = typeof window.jsQR === 'function';
    const ctx2d = (canvasEl && hasJsQr) ? canvasEl.getContext('2d', { willReadFrequently: true }) : null;

    if (nativeDetector || ctx2d) {
      if (statusEl) {
        statusEl.innerText = nativeDetector
          ? '🟢 原生光學掃描引擎運作中：請將顧客 QR Code 對準取景框...'
          : '🟢 跨平台光學掃描引擎 (iOS/iPad 相容) 運作中：請將顧客 QR Code 對準取景框...';
      }

      const scanTick = async () => {
        if (!state.scannerStream || !modal.classList.contains('open')) return;
        try {
          if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
            if (nativeDetector) {
              const barcodes = await nativeDetector.detect(videoEl);
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                const rawVal = barcodes[0].rawValue;
                playPickupChime();
                closeKdsCameraScannerModal();
                quickVerifyAndCompleteByCode(rawVal);
                return;
              }
            }
            if (ctx2d && canvasEl) {
              canvasEl.width = videoEl.videoWidth;
              canvasEl.height = videoEl.videoHeight;
              ctx2d.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
              const imgData = ctx2d.getImageData(0, 0, canvasEl.width, canvasEl.height);
              const codeObj = window.jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: 'dontInvert'
              });
              if (codeObj && codeObj.data) {
                playPickupChime();
                closeKdsCameraScannerModal();
                quickVerifyAndCompleteByCode(codeObj.data);
                return;
              }
            }
          }
        } catch (e) {}
        state.scannerRafId = requestAnimationFrame(scanTick);
      };
      state.scannerRafId = requestAnimationFrame(scanTick);
    } else {
      if (statusEl) {
        statusEl.innerText = '💡 鏡頭已開啟，請搭配外接掃碼槍或於下方輸入 6 碼核銷碼。';
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerText = '⚠️ 無法取得相機權限，請允許瀏覽器使用相機或直接於下方輸入 6 碼核銷碼。';
    }
  }
}

function stopKdsCameraStream() {
  if (state.scannerRafId) {
    cancelAnimationFrame(state.scannerRafId);
    state.scannerRafId = null;
  }
  if (state.scannerStream) {
    try {
      state.scannerStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    state.scannerStream = null;
  }
}

function closeKdsCameraScannerModal() {
  stopKdsCameraStream();
  document.getElementById('kdsQrScannerModal')?.classList.remove('open');
}

async function executeMerchantOrderMutation(order, prevSnapshot, apiPayload, successToastMsg) {
  if (!order || !order.orderId) return false;
  // #42 防連點保護：若該訂單已有狀態變更請求在飛行中，直接拒絕重複發送
  if (state.mutatingOrderIds[order.orderId]) {
    showToast('⏳ 此訂單狀態正在同步雲端中，請勿重複連點！');
    return false;
  }
  state.mutatingOrderIds[order.orderId] = true;
  state.pendingLocalOrdersMap[order.orderId] = Date.now();
  acknowledgeAllNewKdsOrders(order.orderId);
  saveCachedOrders(state.orders);
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();
  refreshCustomerPickupBoardIfOpen(true);

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        ...apiPayload,
        ...getMerchantAuthPayload()
      })
    });
    const data = await res.json();
    if (!data || !data.success) {
      // 伺服器明確拒絕：立即回滾本機狀態並告知店員真實原因 (B3)
      Object.assign(order, prevSnapshot);
      delete state.pendingLocalOrdersMap[order.orderId];
      saveCachedOrders(state.orders);
      enrichStoresAndAi();
      saveLocalStores(state.stores);
      renderMerchantView();
      const errMsg = (data && data.message) || '雲端伺服器拒絕此操作';
      showToast(`❌ 雲端同步失敗已還原狀態：${errMsg}`);
      if (String(errMsg).includes('Unauthorized') || String(errMsg).includes('權限')) {
        checkMerchantSecurityGate();
      }
      return false;
    }
    showToast(successToastMsg);
    return true;
  } catch (netErr) {
    // 網路瞬斷：排入離線狀態變更重試佇列，確保網路恢復後自動補送 (B3)
    state.pendingOrderMutationsQueue.push({
      orderId: order.orderId,
      payload: apiPayload,
      queuedAt: Date.now()
    });
    savePendingOrderMutationsQueue(state.pendingOrderMutationsQueue);
    showToast(`${successToastMsg} (⚠️ 網路瞬斷已排入待命佇列，連線後自動補送雲端)`);
    return true;
  } finally {
    delete state.mutatingOrderIds[order.orderId];
    renderMerchantView();
  }
}

async function forceStartCookingScheduledOrder(orderId) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  if (state.mutatingOrderIds[orderId]) return;
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;
  const prevSnapshot = {
    status: order.status,
    cookingStartedAtTs: order.cookingStartedAtTs
  };
  order.status = '製作中';
  order.cookingStartedAtTs = Date.now();

  await executeMerchantOrderMutation(
    order,
    prevSnapshot,
    {
      action: 'updateOrderStatus',
      orderId: order.orderId,
      newStatus: '製作中'
    },
    `🍳 預訂單 #${order.pickupNumber} 已提前轉入廚房下鍋製作！`
  );
}

// #12 廚房工作站自動分類 (MAIN: 主食飯麵 / SIDE: 炸物小菜 / DRINK: 湯品飲品)
function classifyItemKitchenStation(item) {
  const txt = `${item?.baseName || item?.name || ''} ${item?.category || ''}`;
  if (/(湯|茶|飲|豆漿|紅茶|綠茶|果汁|汽水|咖啡|鮮奶|冬瓜)/.test(txt)) return 'DRINK';
  if (/(炸|豆腐|起司條|唐揚|小菜|滷蛋|溫泉蛋|貢丸|泡菜|薯條|雞塊|點心|配菜)/.test(txt)) return 'SIDE';
  return 'MAIN';
}

function setKdsStationFilter(station) {
  state.kdsStationFilter = station || 'ALL';
  renderMerchantOrdersOnly();
}

function setKdsSortMode(mode) {
  state.kdsSortMode = mode === 'NEWEST' ? 'NEWEST' : 'FIFO';
  renderMerchantOrdersOnly();
}

// #23 KDS 訂單狀態退回上一狀態 / 復原 (Recall / Undo)
async function recallMerchantOrderStatus(orderId, targetStatus) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  if (state.mutatingOrderIds[orderId]) return;
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  const prevStatus = order.status;
  const ok = await showAppConfirmModal({
    title: '↩️ 復原訂單狀態',
    message: `確定要將訂單 #${order.pickupNumber} 由「${prevStatus}」退回至「${targetStatus}」嗎？（將寫入稽核紀錄與訂單時間軸）`,
    confirmText: '確定退回復原'
  });
  if (!ok) {
    return;
  }
  const prevSnapshot = { status: order.status };
  order.status = targetStatus;
  if (!Array.isArray(order.statusTimeline)) order.statusTimeline = [];
  order.statusTimeline.push({
    ts: getCalibratedNowMs(),
    timeStr: getTaipeiTimeHHMMSS(),
    status: targetStatus,
    label: `店員復原狀態：${prevStatus} ➔ ${targetStatus}`
  });

  recordMerchantAuditLog('KDS狀態退回復原', `單號 #${order.pickupNumber}：${prevStatus} ➔ ${targetStatus}`);

  await executeMerchantOrderMutation(
    order,
    prevSnapshot,
    {
      action: 'updateOrderStatus',
      orderId: order.orderId,
      newStatus: targetStatus,
      isRecall: true,
      suppressPush: true
    },
    `↩️ 已將訂單 #${order.pickupNumber} 退回復原為「${targetStatus}」！`
  );
}

// #37 店家櫃檯傳送即時留言通知給顧客
async function promptSendMerchantOrderMessage(orderId) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;
  const msg = await showAppPromptModal({
    title: `💬 傳送櫃檯留言給 #${order.pickupNumber}`,
    message: '留言將立即顯示於顧客電子取餐單上：',
    defaultValue: order.merchantMessage || '溫泉蛋已售完，幫您免費升級改為滷蛋可以嗎？',
    placeholder: '請輸入給顧客的訊息...',
    confirmText: '立即發送留言'
  });
  if (msg === null) return;
  const cleanMsg = msg.trim();
  if (!cleanMsg) return;

  const nowStr = getTaipeiTimeHHMMSS();
  const prevSnapshot = {
    merchantMessage: order.merchantMessage,
    merchantMessageAt: order.merchantMessageAt,
    merchantMessages: Array.isArray(order.merchantMessages) ? [...order.merchantMessages] : []
  };
  order.merchantMessage = cleanMsg;
  order.merchantMessageAt = nowStr;
  if (!Array.isArray(order.merchantMessages)) order.merchantMessages = [];
  order.merchantMessages.push({ ts: getCalibratedNowMs(), timeStr: nowStr, text: cleanMsg });

  recordMerchantAuditLog('傳送顧客櫃檯留言', `單號 #${order.pickupNumber}：${cleanMsg}`);

  await executeMerchantOrderMutation(
    order,
    prevSnapshot,
    {
      action: 'addMerchantOrderNote',
      orderId: order.orderId,
      message: cleanMsg
    },
    `💬 已將櫃檯留言發送至 #${order.pickupNumber} 電子取餐單！`
  );
}

// #12 未完成訂單改單 / 單品作廢 Modal
function openKdsModifyOrderModal(orderId) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  ensureSharedModalsMounted();
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;
  if (order.status === '已完成' || String(order.status).includes('已取消')) {
    showToast('⚠️ 已完成或已作廢訂單無法改單');
    return;
  }
  state.modifyingOrderId = orderId;
  state.modifyingOrderItemsDraft = JSON.parse(JSON.stringify(Array.isArray(order.structuredItems) ? order.structuredItems : []));
  renderKdsModifyOrderModal();
  document.getElementById('kdsModifyOrderModal')?.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('kdsModifyOrderModal'));
}

function closeKdsModifyOrderModal() {
  document.getElementById('kdsModifyOrderModal')?.classList.remove('open');
  state.modifyingOrderId = null;
  state.modifyingOrderItemsDraft = [];
}

function modifyOrderDraftQty(idx, delta) {
  const draft = state.modifyingOrderItemsDraft;
  if (!draft[idx]) return;
  const nextQty = (Number(draft[idx].qty) || 1) + delta;
  if (nextQty <= 0) {
    if (draft.length <= 1) {
      showToast('⚠️ 至少須保留 1 項餐點；如需整單取消請使用「退單」功能');
      return;
    }
    draft.splice(idx, 1);
  } else {
    draft[idx].qty = nextQty;
  }
  renderKdsModifyOrderModal();
}

function renderKdsModifyOrderModal() {
  const box = document.getElementById('kdsModifyOrderBody');
  const titleEl = document.getElementById('kdsModifyOrderTitle');
  const order = state.orders.find(o => o.orderId === state.modifyingOrderId);
  if (!box || !order) return;
  if (titleEl) titleEl.innerText = `✏️ 改單 / 單品作廢 (#${order.pickupNumber})`;

  const draft = state.modifyingOrderItemsDraft || [];
  const newSubtotal = draft.reduce((s, it) => s + (it.isGift ? 0 : (Number(it.price) || 0) * (Number(it.qty) || 1)), 0);
  const discount = Math.min(newSubtotal, Number(order.discount) || 0);
  const manualDiscount = Math.min(Math.max(0, newSubtotal - discount), Number(order.manualDiscount) || 0);
  const newTotal = Math.max(0, newSubtotal + (Number(order.cutleryFee) || 0) - discount - manualDiscount);
  const diffAmt = newTotal - (Number(order.finalTotal) || 0);

  box.innerHTML = `
    <div style="background:#FFFBEB; border:1px solid #F59E0B; color:#92400E; padding:9px 12px; border-radius:10px; font-size:0.78rem; font-weight:800; margin-bottom:12px;">
      💡 可直接減量或作廢缺貨單品；若為已付款訂單，儲存後請依下方差額辦理現場退/補差價。
    </div>
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
      ${draft.map((it, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:#F8FAFC; border:1px solid var(--border); padding:10px 12px; border-radius:10px;">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:900; font-size:0.88rem;">${escapeHtml(it.baseName || it.name)} ${it.isGift ? '(贈品)' : ''}</div>
            <div style="font-size:0.76rem; color:var(--text-secondary);">單價 NT$${it.price} ・ 小計 NT$${(Number(it.price) || 0) * (Number(it.qty) || 1)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" onclick="modifyOrderDraftQty(${idx}, -1)" style="border:1px solid var(--border); background:#FFFFFF; width:30px; height:30px; border-radius:8px; font-weight:900;">－</button>
            <span style="font-weight:950; min-width:22px; text-align:center;">${it.qty || 1}</span>
            <button type="button" onclick="modifyOrderDraftQty(${idx}, 1)" style="border:1px solid var(--border); background:#FFFFFF; width:30px; height:30px; border-radius:8px; font-weight:900;">＋</button>
            <button type="button" class="btn-danger-soft" style="padding:5px 8px; font-size:0.74rem;" onclick="modifyOrderDraftQty(${idx}, -999)">作廢</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div style="background:#F1F5F9; padding:10px 12px; border-radius:10px; margin-bottom:12px; font-size:0.84rem;">
      <div style="display:flex; justify-content:space-between;"><span>原訂單總額</span><strong>NT$ ${order.finalTotal}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:1rem;"><span>修改後總額</span><strong style="color:var(--red);">NT$ ${newTotal} (${diffAmt === 0 ? '無差額' : diffAmt < 0 ? `退差額 $${Math.abs(diffAmt)}` : `補差額 +$${diffAmt}`})</strong></div>
    </div>
    <div style="margin-bottom:12px;">
      <label class="field-label">📝 改單 / 單品作廢原因（將寫入稽核紀錄）</label>
      <input type="text" id="kdsModifyReasonInput" class="select-input" value="單品缺貨作廢 / 顧客改單" placeholder="如：單品售罄作廢、顧客減量">
    </div>
    <div style="display:flex; gap:8px;">
      <button type="button" class="btn-outline" style="flex:1;" onclick="closeKdsModifyOrderModal()">取消</button>
      <button type="button" class="btn-tip-action" style="flex:2;" onclick="commitKdsModifyOrder()">💾 確認改單並重算金額</button>
    </div>
  `;
}

async function commitKdsModifyOrder() {
  const order = state.orders.find(o => o.orderId === state.modifyingOrderId);
  if (!order) return;
  const draft = state.modifyingOrderItemsDraft || [];
  if (draft.length === 0) {
    showToast('⚠️ 至少須保留 1 項餐點');
    return;
  }
  const reason = (document.getElementById('kdsModifyReasonInput')?.value || '櫃檯改單/單品作廢').trim();
  const prevSnapshot = {
    structuredItems: JSON.parse(JSON.stringify(order.structuredItems || [])),
    subtotal: order.subtotal,
    discount: order.discount,
    manualDiscount: order.manualDiscount,
    finalTotal: order.finalTotal
  };

  const newSubtotal = draft.reduce((s, it) => s + (it.isGift ? 0 : (Number(it.price) || 0) * (Number(it.qty) || 1)), 0);
  const newDiscount = Math.min(newSubtotal, Number(order.discount) || 0);
  const newManualDisc = Math.min(Math.max(0, newSubtotal - newDiscount), Number(order.manualDiscount) || 0);
  const newTotal = Math.max(0, newSubtotal + (Number(order.cutleryFee) || 0) - newDiscount - newManualDisc);

  order.structuredItems = draft.map(normalizeOrderItemEntry);
  order.itemsJson = JSON.stringify(order.structuredItems);
  order.subtotal = newSubtotal;
  order.discount = newDiscount;
  order.manualDiscount = newManualDisc;
  order.finalTotal = newTotal;

  recordMerchantAuditLog('訂單改單/單品作廢', `單號 #${order.pickupNumber}，金額 $${prevSnapshot.finalTotal} ➔ $${newTotal}，原因：${reason}`);
  closeKdsModifyOrderModal();

  await executeMerchantOrderMutation(
    order,
    prevSnapshot,
    {
      action: 'modifyOrderItems',
      orderId: order.orderId,
      structuredItems: order.structuredItems,
      reason
    },
    `✏️ 訂單 #${order.pickupNumber} 已完成改單！最新金額 NT$${newTotal}`
  );
}

function renderMerchantOrdersOnly(storeObj, onlyUpdateGrid = false) {
  const store = storeObj || state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  const panel = document.getElementById('storePanel-kds');
  if (!store || !panel) return;

  const storeOrders = state.orders.filter(o => o.storeId === store.id);
  const todayStr = getTodayDateStr();
  const tomorrowStr = getFutureDateStr(1);

  const activeCookingOrders = storeOrders.filter(o => o.status === '製作中');
  const stationFilter = state.kdsStationFilter || 'ALL';
  const batchItemMap = {};
  let totalActivePortions = 0;

  activeCookingOrders.forEach(o => {
    const dineShort = (o.dineType && o.dineType.includes('內用')) ? '內用' : '外帶';
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    items.forEach(it => {
      if (stationFilter !== 'ALL' && classifyItemKitchenStation(it) !== stationFilter) return;
      const bName = it.baseName || String(it.name || '餐點').split(' [')[0];
      const q = Math.max(1, Number(it.qty) || 1);
      if (!batchItemMap[bName]) {
        batchItemMap[bName] = { name: bName, qty: 0, isGift: Boolean(it.isGift), specsMap: {} };
      }
      batchItemMap[bName].qty += q;
      totalActivePortions += q;

      const selValues = (it.selections && Object.keys(it.selections).length > 0)
        ? Object.values(it.selections).join('/')
        : '標準原味';
      const specKey = `${dineShort}・${selValues}`;
      batchItemMap[bName].specsMap[specKey] = (batchItemMap[bName].specsMap[specKey] || 0) + q;
    });
  });
  const sortedBatchItems = Object.values(batchItemMap).sort((a, b) => b.qty - a.qty);

  const dateCountMap = {};
  storeOrders.forEach(o => {
    const d = normalizeDateStr(o.pickupDate || todayStr);
    dateCountMap[d] = (dateCountMap[d] || 0) + 1;
  });
  // 僅於快捷膠囊列顯示「未來預訂日期 (d > tomorrowStr)」或目前透過日曆手動選取的單一查詢日，不再把歷史舊日期塞滿頂部列
  const extraDates = Object.keys(dateCountMap)
    .filter(d => d > tomorrowStr || (state.kdsSelectedDate === d && d !== todayStr && d !== tomorrowStr))
    .sort();

  let dateScopedOrders = storeOrders;
  if (state.kdsSelectedDate !== 'ALL') {
    dateScopedOrders = dateScopedOrders.filter(o => normalizeDateStr(o.pickupDate || todayStr) === state.kdsSelectedDate);
  }

  const countAll = dateScopedOrders.length;
  const countCooking = dateScopedOrders.filter(o => o.status === '製作中').length;
  const countScheduled = dateScopedOrders.filter(o => o.status === '已接單待排程').length;
  const countUnpaid = dateScopedOrders.filter(o => (!isOrderConsiderPaid(o) || o.status === '待付款確認') && !String(o.status).includes('已取消')).length;
  const countReady = dateScopedOrders.filter(o => o.status === '可取餐').length;
  const countDone = dateScopedOrders.filter(o => o.status === '已完成' || String(o.status).includes('已取消')).length;

  let filtered = dateScopedOrders.slice();

  if (state.kdsStatusFilter === 'UNPAID') {
    filtered = filtered.filter(o => (!isOrderConsiderPaid(o) || o.status === '待付款確認') && !String(o.status).includes('已取消'));
  } else if (state.kdsStatusFilter === 'SCHEDULED') {
    filtered = filtered.filter(o => o.status === '已接單待排程');
  } else if (state.kdsStatusFilter === 'COOKING') {
    filtered = filtered.filter(o => o.status === '製作中');
  } else if (state.kdsStatusFilter === 'READY') {
    filtered = filtered.filter(o => o.status === '可取餐');
  } else if (state.kdsStatusFilter === 'DONE') {
    filtered = filtered.filter(o => o.status === '已完成' || String(o.status).includes('已取消'));
  }

  // #12 廚房分站過濾：只顯示包含該分站品項的訂單
  if (stationFilter !== 'ALL') {
    filtered = filtered.filter(o => {
      const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
      return items.some(it => classifyItemKitchenStation(it) === stationFilter);
    });
  }

  const q = (state.kdsSearchQuery || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(o =>
      String(o.pickupNumber || '').toLowerCase().includes(q) ||
      String(o.verificationCode || '').toLowerCase().includes(q) ||
      String(o.customerPhone || '').toLowerCase().includes(q) ||
      String(o.customerNote || '').toLowerCase().includes(q) ||
      String(o.orderId || '').toLowerCase().includes(q)
    );
  }

  // #31 & #38 KDS 智慧排序：FIFO 模式下，製作中/預訂轉入依「應取餐時間 / 下鍋先後 (最緊急在最前)」排序
  const getOrderUrgencyTs = (o) => {
    if (o.status === '製作中') {
      if (o.isReservation) {
        return parseTimeToMins(o.pickupTime, 12 * 60) * 60000;
      }
      return Number(o.cookingStartedAtTs || o.createdAtTs || 0);
    }
    if (o.status === '已接單待排程') {
      return 1e13 + parseTimeToMins(o.pickupTime, 12 * 60) * 60000;
    }
    if (o.status === '可取餐') {
      return 2e13 + Number(o.readyAtTs || o.createdAtTs || 0);
    }
    return 3e13 - Number(o.createdAtTs || 0);
  };
  if (state.kdsSortMode === 'FIFO') {
    filtered.sort((a, b) => getOrderUrgencyTs(a) - getOrderUrgencyTs(b));
  } else {
    filtered.sort((a, b) => Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0));
  }

  const kdsOrdersCardsHtml = filtered.length === 0 ? `
    <div style="grid-column:1 / -1; text-align:center; padding:60px 20px; background:#FFFFFF; border-radius:16px; border:1px dashed var(--border); color:var(--text-muted);">
      <div style="font-size:2.4rem; margin-bottom:8px;">📭</div>
      <div style="font-size:1rem; font-weight:800;">此日期 / 分站 / 篩選條件下目前沒有訂單</div>
    </div>
  ` : filtered.map(o => {
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    const visibleItems = stationFilter === 'ALL'
      ? items
      : items.filter(it => classifyItemKitchenStation(it) === stationFilter);
    const itemStr = visibleItems.map(i => {
      const sel = i.selections && Object.keys(i.selections).length > 0
        ? ` [${Object.entries(i.selections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
        : '';
      const noteTag = i.itemNote ? ` (📝${i.itemNote})` : '';
      return `${i.baseName || i.name}${sel}${noteTag} ×${i.qty || 1}`;
    }).join('、');

    const isReady = o.status === '可取餐';
    const isDone = o.status === '已完成';
    const isScheduled = o.status === '已接單待排程';
    const isCancelled = String(o.status).includes('已取消');
    const isUnpaid = !isOrderConsiderPaid(o) && !isCancelled;
    const notifyCount = Number(o.notifyCount) || 0;
    const isInLiveQueue = o.status === '製作中' && normalizeDateStr(o.pickupDate) === todayStr;
    const isAutoFiredReserve = Boolean(o.isReservation && o.status === '製作中');
    const elapsedMin = getOrderElapsedMinutes(o);
    const workloadUnits = isInLiveQueue ? calcOrderRemainingWorkloadUnits(o, store.maxCapacityPer15Min) : 0;
    const isServerVerified = isOrderServerVerified(o);
    const verBadgeText = isServerVerified ? `🛡️ ${o.verificationCode}` : '⚠️ 離線待同步';

    let cardClass = '';
    if (isCancelled) cardClass = 'cancelled';
    else if (isReady) cardClass = 'ready';
    else if (isScheduled) cardClass = 'scheduled';
    else if (isUnpaid) cardClass = 'unpaid';

    return `
      <div class="kds-ticket-card ${cardClass}" style="${isDone ? 'opacity:0.72;' : ''}${isAutoFiredReserve ? 'border:2px solid #7C3AED; box-shadow:0 4px 16px rgba(124,58,237,0.16);' : ''}">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:6px;">
            <div>
              <span style="font-size:1.3rem; font-weight:950; color:var(--text-primary);">#${escapeHtml(o.pickupNumber)}</span>
              ${isAutoFiredReserve ? `
                <span style="font-size:0.72rem; font-weight:950; background:linear-gradient(135deg,#7C3AED,#A855F7); color:#FFFFFF; padding:2px 8px; border-radius:6px; margin-left:4px;">
                  🔥 預訂轉入・${escapeHtml(normalizeTimeStr(o.pickupTime))}取餐
                </span>
              ` : ''}
              ${o.originalOfflinePickupNumber ? `
                <span style="font-size:0.72rem; font-weight:900; background:#FEF3C7; color:#B45309; border:1px solid #F59E0B; padding:2px 6px; border-radius:6px; margin-left:4px;" title="離線開單小票上之原始號碼，雲端撞號自動校正">
                  原離線小票 #${escapeHtml(o.originalOfflinePickupNumber)}
                </span>
              ` : ''}
              <span style="font-size:0.72rem; font-weight:900; background:${String(o.studentId || '').includes('POS') || String(o.studentId || '').includes('櫃檯') ? '#F1F5F9' : '#EFF6FF'}; color:${String(o.studentId || '').includes('POS') || String(o.studentId || '').includes('櫃檯') ? '#0F172A' : '#1D4ED8'}; padding:2px 7px; border-radius:6px; margin-left:4px;">
                ${String(o.studentId || '').includes('POS') || String(o.studentId || '').includes('櫃檯') ? '🖥️ 現場單' : (o.isReservation ? '📅 線上預訂' : '📱 線上單')}
              </span>
              <span style="font-family:monospace; font-size:0.74rem; font-weight:900; background:${isServerVerified ? '#EEF2FF' : '#FEF3C7'}; color:${isServerVerified ? '#312E81' : '#92400E'}; padding:2px 7px; border-radius:6px; margin-left:4px;">
                ${escapeHtml(verBadgeText)}
              </span>
              <span style="font-size:0.74rem; font-weight:800; background:#F1F5F9; color:#334155; padding:2px 7px; border-radius:6px; margin-left:4px;">
                📅 ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}
              </span>
              ${isInLiveQueue ? `
                <span class="kds-elapsed-badge ${elapsedMin >= 15 ? 'overdue' : ''}" style="margin-left:4px;">
                  ⏱️ ${elapsedMin > 45 ? `逾時 ${elapsedMin}分 (已排除排隊負荷)` : `已下鍋 ${elapsedMin}分 (負荷 ${workloadUnits})`}
                </span>
              ` : ''}
            </div>
            <span style="font-size:0.74rem; font-weight:900; padding:3px 9px; border-radius:999px; background:${isCancelled ? '#FEE2E2' : isDone ? '#E2E8F0' : isReady ? '#DCFCE7' : isScheduled ? '#DBEAFE' : '#FEF3C7'}; color:${isCancelled ? '#DC2626' : isDone ? '#475569' : isReady ? '#047857' : isScheduled ? '#1E40AF' : '#B45309'};">
              ${escapeHtml(o.status)} ${notifyCount > 0 && !isDone && !isCancelled ? `(叫號${notifyCount}次)` : ''}
            </span>
          </div>

          <div style="font-size:0.9rem; font-weight:800; color:var(--text-primary); line-height:1.45; margin-bottom:6px; background:#F8FAFC; padding:8px 10px; border-radius:8px; border:1px solid #E2E8F0;">
            ${escapeHtml(itemStr)}
            ${stationFilter !== 'ALL' && visibleItems.length < items.length ? `<div style="font-size:0.7rem; color:var(--text-muted); margin-top:3px;">(僅顯示本分站品項・全單共 ${items.length} 項)</div>` : ''}
          </div>

          ${o.merchantMessage ? `
            <div style="font-size:0.75rem; font-weight:800; color:#1E40AF; background:#EFF6FF; border:1px solid #BFDBFE; padding:5px 8px; border-radius:6px; margin-bottom:6px;">
              💬 已傳送櫃檯留言：「${escapeHtml(o.merchantMessage)}」
            </div>
          ` : ''}

          <div style="font-size:0.76rem; color:var(--text-secondary); margin-bottom:6px; display:flex; flex-wrap:wrap; gap:6px;">
            <span style="font-weight:800; color:var(--text-primary);">🍽️ ${escapeHtml(o.dineType || '外帶自取')}</span>
            ${o.needCutlery ? `<span style="color:var(--brand-dark); font-weight:800;">・🥢 需餐具(+$${o.cutleryFee})</span>` : ''}
            ${o.taxId ? `<span style="color:#0F172A; font-weight:900;">・🧾 統編：${escapeHtml(o.taxId)}</span>` : ''}
            ${o.customerNote ? `<span style="color:var(--indigo); font-weight:800;">・📝 備註：${escapeHtml(o.customerNote)}</span>` : ''}
            ${o.customerPhone ? `<span>・<strong style="color:var(--brand-dark);">📱 ${escapeHtml(o.customerPhone)}</strong></span>` : ''}
            ${o.cashReceived > 0 && !o.paymentSplit ? `<span>・💵 實收$${o.cashReceived}/找零$${o.changeGiven}</span>` : ''}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; padding-top:6px; border-top:1px dashed var(--border);">
            <div>
              <span style="font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:6px; background:${isCancelled ? '#FEE2E2' : isUnpaid ? '#FEF3C7' : '#DCFCE7'}; color:${isCancelled ? '#DC2626' : isUnpaid ? '#B45309' : '#047857'};">
                ${isCancelled ? `🚫 ${escapeHtml(o.paymentStatus || '已作廢退單')}` : isUnpaid ? `⏳ ${escapeHtml(o.paymentStatus || '待收款')}` : `✅ ${escapeHtml(o.paymentStatus)} (${escapeHtml(o.paymentMethod)})`}
              </span>
            </div>
            <span style="font-size:1.05rem; font-weight:950; color:var(--red); ${isCancelled ? 'text-decoration:line-through;' : ''}">NT$ ${o.finalTotal}</span>
          </div>
        </div>

        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
          ${isUnpaid ? `
            <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="openOrderPayModal(${escapeJsAttr(o.orderId)}, false)" style="flex:1 1 100%; border:none; background:#F59E0B; color:#FFFFFF; padding:8px 12px; border-radius:8px; font-weight:900; font-size:0.84rem; cursor:pointer;">
              💵 點此收款結帳 (NT$ ${o.finalTotal})
            </button>
          ` : ''}

          ${isScheduled ? `
            <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="forceStartCookingScheduledOrder(${escapeJsAttr(o.orderId)})" style="flex:1 1 100%; border:1.5px solid #2563EB; background:#EFF6FF; color:#1D4ED8; padding:7px 10px; border-radius:8px; font-weight:900; font-size:0.8rem; cursor:pointer;">
              ${state.mutatingOrderIds[o.orderId] ? '⏳ 處理中...' : '🔥 提前轉入廚房下鍋製作'}
            </button>
          ` : ''}

          <button type="button" onclick="openReceiptPrintModal(${escapeJsAttr(o.orderId)})" style="border:1px solid var(--border); background:#FFFFFF; color:var(--text-primary); padding:7px 9px; border-radius:8px; font-weight:800; font-size:0.76rem; cursor:pointer;">
            🖨️ 小票/工單
          </button>

          ${!isDone && !isCancelled ? `
            <button type="button" onclick="openKdsModifyOrderModal(${escapeJsAttr(o.orderId)})" style="border:1px solid #F59E0B; background:#FFFBEB; color:#B45309; padding:7px 9px; border-radius:8px; font-weight:800; font-size:0.76rem; cursor:pointer;" title="#12 改單或單品作廢">
              ✏️ 改單
            </button>
            <button type="button" onclick="promptSendMerchantOrderMessage(${escapeJsAttr(o.orderId)})" style="border:1px solid #93C5FD; background:#EFF6FF; color:#1D4ED8; padding:7px 9px; border-radius:8px; font-weight:800; font-size:0.76rem; cursor:pointer;" title="#37 傳送即時留言至顧客取餐單">
              💬 留言
            </button>
            <button type="button" onclick="speakOrder(${escapeJsAttr(o.pickupNumber + '號，' + itemStr)})" style="border:1px solid var(--border); background:#F8FAFC; color:var(--text-primary); padding:7px 9px; border-radius:8px; font-weight:800; font-size:0.76rem; cursor:pointer;">
              🔊 讀單
            </button>
            ${isReady ? `
              <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="recallMerchantOrderStatus(${escapeJsAttr(o.orderId)}, '製作中')" style="border:1px solid #94A3B8; background:#F1F5F9; color:#334155; padding:7px 9px; border-radius:8px; font-weight:800; font-size:0.76rem; cursor:pointer;" title="#23 誤按叫號時退回製作中">
                ↩️ 退回製作
              </button>
            ` : ''}
            <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="markOrderReady(${escapeJsAttr(o.orderId)})" style="flex:1; border:none; background:#3B82F6; color:#FFFFFF; padding:7px 10px; border-radius:8px; font-weight:900; font-size:0.78rem; cursor:pointer;">
              ${state.mutatingOrderIds[o.orderId] ? '⏳...' : `🔔 ${notifyCount > 0 ? `再次叫號 (${notifyCount})` : '通知取餐'}`}
            </button>
            <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="completeOrderFinal(${escapeJsAttr(o.orderId)})" style="flex:1; border:none; background:#10B981; color:#FFFFFF; padding:7px 10px; border-radius:8px; font-weight:900; font-size:0.78rem; cursor:pointer;">
              ${state.mutatingOrderIds[o.orderId] ? '⏳...' : `✅ ${isUnpaid ? '收款並結單' : '完成結單'}`}
            </button>
            <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} class="btn-danger-soft" onclick="cancelMerchantOrder(${escapeJsAttr(o.orderId)})">
              🚫 退單
            </button>
          ` : ''}

          ${isDone ? `
            <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="recallMerchantOrderStatus(${escapeJsAttr(o.orderId)}, '可取餐')" style="border:1px solid #F59E0B; background:#FFFBEB; color:#B45309; padding:7px 10px; border-radius:8px; font-weight:800; font-size:0.76rem; cursor:pointer;" title="#23 誤按完成結單時復原為可取餐">
              ↩️ 復原為待取餐
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  const gridEl = document.getElementById('kdsOrdersGridBox');
  if (onlyUpdateGrid && gridEl) {
    gridEl.innerHTML = kdsOrdersCardsHtml;
    return;
  }

  const unackCountForStore = Array.from(state.unacknowledgedOrderIds).filter(oid => {
    const ord = state.orders.find(o => o.orderId === oid);
    return ord && ord.storeId === store.id && ord.status === '製作中';
  }).length;

  panel.innerHTML = `
    <div class="kds-panel-wrap">
      ${unackCountForStore > 0 ? `
        <div style="background:linear-gradient(90deg, #DC2626 0%, #EA580C 100%); color:#FFFFFF; padding:12px 16px; border-radius:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; box-shadow:0 6px 18px rgba(220,38,38,0.28); animation:pulse 1.5s infinite;">
          <div style="display:flex; align-items:center; gap:10px; font-weight:900; font-size:0.95rem;">
            <span style="font-size:1.4rem;">🔔</span>
            <span>新單持續提醒中：目前有 <strong>${unackCountForStore} 筆新進訂單</strong>尚未確認（每 15 秒自動語音響鈴提醒）</span>
          </div>
          <button type="button" onclick="acknowledgeAllNewKdsOrders()" style="border:none; background:#FFFFFF; color:#DC2626; padding:8px 16px; border-radius:999px; font-weight:950; font-size:0.84rem; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.15);">
            👌 我看到了，停止重複響鈴
          </button>
        </div>
      ` : ''}

      <div class="kds-batch-summary-bar">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.95rem; font-weight:950; color:#FBBF24;">🔥 即時廚房爐上備料與規格拆解看板 (All-Day Batch View)</span>
            <span style="font-size:0.75rem; background:rgba(255,255,255,0.16); padding:2px 10px; border-radius:999px; font-weight:800;">
              製作中 ${activeCookingOrders.length} 單 ・ 合共 ${totalActivePortions} 份餐點
            </span>
          </div>
          <span style="font-size:0.74rem; color:#CBD5E1;">同時顯示主餐總數與飯量/辣度/內外帶拆解，方便師傅批次下鍋盛飯</span>
        </div>
        <div class="batch-items-scroll">
          ${sortedBatchItems.length === 0 ? `
            <div style="font-size:0.82rem; color:#94A3B8; padding:4px 0;">目前爐上無製作中單品，廚房順暢待命</div>
          ` : sortedBatchItems.map(bi => {
            const specEntries = Object.entries(bi.specsMap || {});
            return `
              <div class="batch-item-pill">
                <div class="batch-item-header">
                  <span style="font-weight:900; font-size:0.9rem; color:#FFFFFF;">${escapeHtml(bi.name)}</span>
                  <span class="batch-qty">共 ×${bi.qty}</span>
                </div>
                <div class="batch-spec-list">
                  ${specEntries.map(([specLabel, cnt]) => `
                    <span class="batch-spec-chip">${escapeHtml(specLabel)} ×${cnt}</span>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="kds-toolbar">
        <div class="kds-verify-bar">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.82rem; font-weight:900; color:#312E81;">🛡️ 櫃檯快速核銷取餐：</span>
            <span style="font-size:0.75rem; color:#4338CA;">支援鏡頭掃描顧客 QR 憑證，或輸入 6 碼防偽核銷碼（未收款將自動彈出收銀視窗）</span>
          </div>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.8rem; background:#0F172A;" onclick="openKdsCameraScannerModal()">📷 開啟鏡頭掃碼</button>
            <input type="text" id="kdsQuickVerifyInput" class="select-input" style="width:190px; padding:5px 10px; font-family:monospace; font-weight:900; text-transform:uppercase;" placeholder="輸入6碼防偽碼或取餐號" value="${escapeHtml(state.kdsVerifyCodeInput)}" oninput="state.kdsVerifyCodeInput=this.value" onkeydown="if(event.key==='Enter') quickVerifyAndCompleteByCode(this.value)">
            <button type="button" class="btn-tip-action" style="padding:6px 14px; font-size:0.8rem; background:#4F46E5;" onclick="quickVerifyAndCompleteByCode()">⚡ 核銷取餐</button>
            <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.8rem; background:#059669;" onclick="openCustomerPickupBoardModal()">📺 叫號看板</button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:0.84rem; font-weight:900; color:var(--text-primary);">📅 取餐日期：</span>
            <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === todayStr ? 'active' : ''}" onclick="setKdsDateFilter(${escapeJsAttr(todayStr)})">
              今日 (${todayStr.slice(5)}) [${dateCountMap[todayStr] || 0}]
            </button>
            <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === tomorrowStr ? 'active' : ''}" onclick="setKdsDateFilter(${escapeJsAttr(tomorrowStr)})">
              明日 (${tomorrowStr.slice(5)}) [${dateCountMap[tomorrowStr] || 0}]
            </button>
            ${extraDates.map(d => `
              <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === d ? 'active' : ''}" onclick="setKdsDateFilter(${escapeJsAttr(d)})">
                📅 ${escapeHtml(d.slice(5))} [${dateCountMap[d] || 0}]
              </button>
            `).join('')}
            <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === 'ALL' ? 'active' : ''}" onclick="setKdsDateFilter('ALL')">
              🗂️ 全部日期 [${storeOrders.length}]
            </button>
            <input type="date" class="select-input" style="width:auto; padding:4px 8px; font-size:0.78rem;" value="${state.kdsSelectedDate === 'ALL' ? todayStr : escapeHtml(state.kdsSelectedDate)}" onchange="setKdsDateFilter(this.value)">
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" class="filter-chip ${state.kdsSoundEnabled ? 'active' : ''}" style="padding:5px 10px; font-size:0.76rem;" onclick="toggleKdsSound()">
              ${state.kdsSoundEnabled ? '🔊 新單語音播報: 開' : '🔇 新單語音播報: 關'}
            </button>
            <input type="search" id="kdsSearchInputBox" class="select-input" style="width:210px; padding:6px 10px; font-size:0.8rem;" placeholder="🔍 搜尋電話、核銷碼或單號..." value="${escapeHtml(state.kdsSearchQuery)}" oninput="handleKdsSearchInput(this.value)">
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'ALL' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('ALL')">全部狀態 (${countAll})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'COOKING' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('COOKING')">🍳 製作中 (${countCooking})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'SCHEDULED' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('SCHEDULED')">📅 預訂待發送 (${countScheduled})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'UNPAID' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('UNPAID')">💵 待收款確認 (${countUnpaid})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'READY' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('READY')">🔔 已通知待取餐 (${countReady})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'DONE' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('DONE')">✅ 已完成/已退單 (${countDone})</button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding-top:6px; border-top:1px dashed var(--border);">
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <span style="font-size:0.76rem; font-weight:900; color:var(--text-secondary);">🔪 廚房分站過濾:</span>
            <button type="button" class="pos-cat-pill ${stationFilter === 'ALL' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsStationFilter('ALL')">全部站點</button>
            <button type="button" class="pos-cat-pill ${stationFilter === 'MAIN' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsStationFilter('MAIN')">🍳 主食飯麵</button>
            <button type="button" class="pos-cat-pill ${stationFilter === 'SIDE' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsStationFilter('SIDE')">🍗 炸物小菜</button>
            <button type="button" class="pos-cat-pill ${stationFilter === 'DRINK' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsStationFilter('DRINK')">🥤 湯品飲品</button>
          </div>
          <div style="display:flex; gap:5px; align-items:center;">
            <span style="font-size:0.76rem; font-weight:900; color:var(--text-secondary);">⇅ 排序:</span>
            <button type="button" class="pos-cat-pill ${state.kdsSortMode === 'FIFO' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsSortMode('FIFO')">⚡ 最緊急優先 (FIFO)</button>
            <button type="button" class="pos-cat-pill ${state.kdsSortMode === 'NEWEST' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsSortMode('NEWEST')">🕒 最新下單優先</button>
          </div>
        </div>
      </div>

      <div id="kdsOrdersGridBox" class="kds-orders-grid">
        ${kdsOrdersCardsHtml}
      </div>
    </div>
  `;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(panel);
}

async function cancelMerchantOrder(orderId) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  if (state.mutatingOrderIds[orderId]) return;
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  const wasPaid = isOrderConsiderPaid(order);
  const isLinePayOrder = order.paymentMethod === 'LINE Pay';
  const reason = await showAppPromptModal({
    title: `🚫 取消 / 退單 #${order.pickupNumber}`,
    message:
      `確定要取消 / 退單「#${order.pickupNumber} (${order.storeName})」嗎？\n` +
      (wasPaid
        ? (isLinePayOrder
            ? `⚠️ 此單已由 LINE Pay 收款 NT$${order.finalTotal}，退單將標記為「已退款 (LINE Pay退刷)」！（不扣減櫃檯現金錢箱）\n`
            : `⚠️ 此單已收現金 NT$${order.finalTotal}，退單將記錄為「已退款 (櫃檯退現)」並從錢箱應有現金扣除！\n`)
        : '') +
      `請輸入退單/退款原因（如：顧客取消、品項售罄、製作失誤）：`,
    defaultValue: '顧客取消/更改餐點',
    placeholder: '請輸入退單原因',
    confirmText: '確定取消退單',
    danger: true
  });
  if (reason === null) return;

  const cleanReason = reason.trim() || '櫃檯取消';
  const prevSnapshot = {
    status: order.status,
    paymentStatus: order.paymentStatus,
    refundAmount: order.refundAmount,
    refundMethod: order.refundMethod
  };
  order.status = `已取消 (${cleanReason})`;
  order.refundAmount = wasPaid ? Number(order.finalTotal) || 0 : 0;
  order.refundMethod = wasPaid ? (isLinePayOrder ? 'LINE Pay 原路退刷' : String(order.paymentMethod || '現場現金')) : '';
  order.paymentStatus = wasPaid
    ? (isLinePayOrder ? '已退款 (LINE Pay退刷)' : '已退款 (櫃檯退現)')
    : '已退單作廢';

  recordMerchantAuditLog(
    wasPaid ? (isLinePayOrder ? 'LINE Pay訂單退刷作廢' : '現金訂單退現作廢') : '未付款訂單取消作廢',
    `單號 #${order.pickupNumber}，金額 NT$${order.finalTotal} (${order.paymentMethod})，原因：${cleanReason}`
  );

  const ok = await executeMerchantOrderMutation(
    order,
    prevSnapshot,
    {
      action: 'cancelOrder',
      orderId: order.orderId,
      reason: cleanReason,
      wasPaidRefund: wasPaid,
      refundAmount: order.refundAmount,
      refundMethod: order.refundMethod,
      paymentStatus: order.paymentStatus
    },
    `🚫 訂單 #${order.pickupNumber} 已取消${wasPaid ? `並記錄 ${order.paymentStatus} NT$${order.refundAmount}` : ''}！`
  );

  if (ok) {
    recordLocalPushNotificationLog(
      'ORDER_CANCELLED',
      `🚫 訂單 #${order.pickupNumber} 已取消通知`,
      `您在【${order.storeName}】的訂單已由櫃檯辦理取消（原因：${cleanReason}）。如有疑問請洽詢店家櫃檯。`,
      order
    );
  }
}

function setReceiptPrintMode(mode) {
  state.receiptPrintMode = mode || 'CUSTOMER';
  if (state.printingOrderId) {
    openReceiptPrintModal(state.printingOrderId);
  }
}

function openReceiptPrintModal(orderId) {
  ensureSharedModalsMounted();
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  state.printingOrderId = orderId;
  const mode = state.receiptPrintMode || 'CUSTOMER';

  const titleEl = document.getElementById('receiptPrintModalTitle');
  if (titleEl) {
    titleEl.innerText = mode === 'KITCHEN'
      ? '🍳 廚房大字工單聯 (Kitchen Work Ticket)'
      : (mode === 'STICKER' ? '🏷️ 餐盒 / 飲料杯貼紙聯 (Meal Stickers)' : '🧾 顧客收據與追蹤 QR 憑證聯 (80mm)');
  }

  const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
  const verDisplay = formatVerificationCodeDisplay(o);
  const isServerVerified = isOrderServerVerified(o);
  const receiptTrackUrl = `${window.location.origin}${getOrderPageUrl('id=' + encodeURIComponent(o.orderId) + (isServerVerified ? '&v=' + encodeURIComponent(verDisplay) : ''))}`;
  const receiptQrSvg = generateDeterministicQrSvg(receiptTrackUrl, 148);

  // #32 收據聯 / 廚房大字工單聯 / 餐盒貼紙聯 三模式切換列
  const modeTabsHtml = `
    <div class="no-print" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:12px;">
      <button type="button" class="pos-chip-btn ${mode === 'CUSTOMER' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('CUSTOMER')">🧾 顧客收據聯</button>
      <button type="button" class="pos-chip-btn ${mode === 'KITCHEN' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('KITCHEN')">🍳 廚房大字工單</button>
      <button type="button" class="pos-chip-btn ${mode === 'STICKER' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('STICKER')">🏷️ 餐盒貼紙聯</button>
    </div>
  `;

  let paperHtml = '';
  if (mode === 'KITCHEN') {
    paperHtml = `
      <div class="thermal-receipt-paper" style="font-family:sans-serif;">
        <div style="text-align:center; border-bottom:3px solid #000; padding-bottom:8px; margin-bottom:10px;">
          <div style="font-size:0.9rem; font-weight:950; background:#000; color:#fff; padding:3px 10px; display:inline-block; border-radius:4px;">廚房製作工單 (KITCHEN)</div>
          <div style="font-size:3.2rem; font-weight:950; line-height:1.05; margin:6px 0;">#${escapeHtml(o.pickupNumber)}</div>
          <div style="font-size:1.2rem; font-weight:950;">【${escapeHtml(o.dineType || '外帶自取')}】${o.isReservation ? ` 📅 預訂 ${escapeHtml(normalizeTimeStr(o.pickupTime))}` : ' ⚡ 立即製作'}</div>
          <div style="font-size:0.84rem; font-weight:800; margin-top:4px;">餐具：${o.needCutlery ? '✅ 需要免洗餐具' : '❌ 不需餐具'} ・ 出單 ${getTaipeiTimeHHMM()}</div>
        </div>
        ${o.customerNote ? `
          <div style="border:2px solid #000; padding:8px; margin-bottom:10px; font-size:1.1rem; font-weight:950; background:#F8FAFC;">
            ⚠️ 備註：${escapeHtml(o.customerNote)}
          </div>
        ` : ''}
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${items.map(it => {
            const selText = it.selections && Object.keys(it.selections).length > 0
              ? Object.entries(it.selections).map(([k, v]) => `${k}：${v}`).join(' / ')
              : '';
            return `
              <div style="border-bottom:1.5px dashed #000; padding-bottom:8px;">
                <div style="display:flex; justify-content:space-between; align-items:baseline; font-size:1.25rem; font-weight:950;">
                  <span>${escapeHtml(it.baseName || it.name)}</span>
                  <span style="font-size:1.45rem;">×${it.qty || 1}</span>
                </div>
                ${selText ? `<div style="font-size:1.02rem; font-weight:900; margin-top:4px; padding-left:6px;">▶ ${escapeHtml(selText)}</div>` : ''}
                ${it.itemNote ? `<div style="font-size:1rem; font-weight:950; margin-top:4px; padding:3px 6px; border:1.5px solid #000; background:#F8FAFC;">📝 單品備註：${escapeHtml(it.itemNote)}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } else if (mode === 'STICKER') {
    const stickerUnits = [];
    items.forEach(it => {
      const q = Math.max(1, parseInt(it.qty, 10) || 1);
      for (let k = 0; k < q; k++) {
        stickerUnits.push(it);
      }
    });
    const totalStickers = stickerUnits.length;
    paperHtml = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${stickerUnits.map((it, sIdx) => {
          const selText = it.selections && Object.keys(it.selections).length > 0
            ? Object.entries(it.selections).map(([k, v]) => `${v}`).join(' / ')
            : '標準原味';
          return `
            <div class="thermal-receipt-paper" style="padding:10px 12px; border:2px solid #000; border-radius:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid #000; padding-bottom:4px; margin-bottom:6px;">
                <span style="font-size:1.4rem; font-weight:950;">#${escapeHtml(o.pickupNumber)}</span>
                <span style="font-size:0.78rem; font-weight:900;">${escapeHtml(o.dineType || '外帶')} (${sIdx + 1}/${totalStickers})</span>
              </div>
              <div style="font-size:1.1rem; font-weight:950; margin-bottom:3px;">${escapeHtml(it.baseName || it.name)}</div>
              <div style="font-size:0.86rem; font-weight:800;">規格：${escapeHtml(selText)}</div>
              ${it.itemNote ? `<div style="font-size:0.84rem; font-weight:950; margin-top:2px;">📝 單品：${escapeHtml(it.itemNote)}</div>` : ''}
              ${o.customerNote ? `<div style="font-size:0.82rem; font-weight:900; margin-top:3px;">備註：${escapeHtml(o.customerNote)}</div>` : ''}
              <div style="display:flex; justify-content:space-between; font-size:0.72rem; margin-top:6px; border-top:1px dotted #666; padding-top:3px;">
                <span>${escapeHtml(o.storeName)}</span>
                <span>${escapeHtml(normalizeTimeStr(o.pickupTime))}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } else {
    paperHtml = `
      <div class="thermal-receipt-paper">
        <div style="text-align:center; margin-bottom:8px;">
          <div style="font-size:0.82rem; font-weight:900; letter-spacing:0.5px;">${escapeHtml(BRAND_CONFIG.name)}</div>
          <div style="font-size:1.1rem; font-weight:950; margin:2px 0;">${escapeHtml(o.storeName)}</div>
          <div style="font-size:0.75rem; color:#4B5563;">${escapeHtml(o.dineType || '外帶自取')} ・ 80mm 顧客收據聯</div>
          <div style="font-size:2.6rem; font-weight:950; line-height:1.1; margin:6px 0; border:2px solid #000000; border-radius:8px; padding:4px 0;">
            #${escapeHtml(o.pickupNumber)}
          </div>
          ${o.originalOfflinePickupNumber ? `
            <div style="font-size:0.76rem; font-weight:900; margin-bottom:3px;">(原離線開單小票號：#${escapeHtml(o.originalOfflinePickupNumber)})</div>
          ` : ''}
          <div style="font-family:monospace; font-size:0.84rem; font-weight:900;">防偽核銷碼：${escapeHtml(verDisplay)}</div>
        </div>

        <div style="font-size:0.76rem; line-height:1.5;">
          <div>憑證：${escapeHtml(o.orderId)}</div>
          <div>取餐：${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))} (${escapeHtml(o.studentId || '自取')})</div>
          <div>餐具：${o.needCutlery ? `需要免洗餐具 (+$${o.cutleryFee})` : '自備環保餐具 ($0)'}</div>
          ${o.taxId ? `<div><strong>買方統一編號：${escapeHtml(o.taxId)}</strong></div>` : ''}
          ${o.customerNote ? `<div><strong>顧客備註：${escapeHtml(o.customerNote)}</strong></div>` : ''}
          ${o.customerPhone ? `<div>聯絡電話：${escapeHtml(o.customerPhone)}</div>` : ''}
          ${o.transactionId ? `<div>支付授權碼：${escapeHtml(o.transactionId)}</div>` : ''}
        </div>

        <div class="thermal-divider"></div>

        <div style="font-size:0.82rem;">
          ${items.map(it => {
            const sel = it.selections && Object.keys(it.selections).length > 0
              ? `<div style="font-size:0.72rem; font-weight:700; padding-left:8px;">└ ${escapeHtml(Object.entries(it.selections).map(([k, v]) => `${k}:${v}`).join(', '))}</div>`
              : '';
            return `
              <div style="margin-bottom:6px;">
                <div style="display:flex; justify-content:space-between; font-weight:900;">
                  <span style="flex:1; padding-right:8px;">${escapeHtml(it.baseName || it.name)} x${it.qty || 1}</span>
                  <span>$${it.price * (it.qty || 1)}</span>
                </div>
                ${sel}
                ${it.itemNote ? `<div style="font-size:0.72rem; font-weight:800; padding-left:8px;">└ 📝 ${escapeHtml(it.itemNote)}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem;">
          <div style="display:flex; justify-content:space-between;">
            <span>餐點小計</span>
            <span>NT$ ${o.subtotal || o.finalTotal}</span>
          </div>
          ${o.cutleryFee > 0 ? `
            <div style="display:flex; justify-content:space-between;">
              <span>一次性免洗餐具</span>
              <span>+NT$ ${o.cutleryFee}</span>
            </div>
          ` : ''}
          ${o.discount > 0 ? `
            <div style="display:flex; justify-content:space-between;">
              <span>離峰分流折抵</span>
              <span>-NT$ ${o.discount}</span>
            </div>
          ` : ''}
          ${o.manualDiscount > 0 ? `
            <div style="display:flex; justify-content:space-between;">
              <span>櫃檯手動折讓 (${escapeHtml(o.manualDiscountReason || '折扣')})</span>
              <span>-NT$ ${o.manualDiscount}</span>
            </div>
          ` : ''}
          <div style="display:flex; justify-content:space-between; font-size:1.08rem; font-weight:950; margin-top:6px;">
            <span>實收總計 (${escapeHtml(o.paymentMethod)})</span>
            <span>NT$ ${o.finalTotal}</span>
          </div>
          ${o.cashReceived > 0 && !o.paymentSplit ? `
            <div style="display:flex; justify-content:space-between; font-size:0.76rem; margin-top:2px;">
              <span>現金實收 $${o.cashReceived}</span>
              <span>找零 $${o.changeGiven}</span>
            </div>
          ` : ''}
          <div style="text-align:right; font-size:0.75rem; font-weight:800; margin-top:2px;">
            付款狀態：${escapeHtml(o.paymentStatus || '已付款')}
          </div>
        </div>

        <div class="thermal-divider"></div>
        <div style="text-align:center; padding:4px 0;">
          <div style="font-size:0.78rem; font-weight:900; margin-bottom:4px;">📱 手機掃碼即時看叫號進度 & 取餐通知</div>
          <div style="display:inline-flex; justify-content:center; padding:6px; border:1.5px solid #000; border-radius:6px; background:#fff; margin-bottom:4px;">
            ${receiptQrSvg}
          </div>
          <div style="font-size:0.68rem; color:#111827; font-weight:700;">
            免站櫃檯久候！相機掃描上方 QR 即可在手機追蹤製作進度與綁定 LINE 響鈴通知
          </div>
        </div>

        <div class="thermal-divider"></div>
        <div style="text-align:center; font-size:0.72rem; color:#4B5563;">
          列印時間：${getTodayDateStr()} ${getTaipeiTimeHHMMSS()}<br>
          謝謝光臨，請憑號碼牌與防偽碼至櫃檯取餐！
        </div>
      </div>
    `;
  }

  const body = document.getElementById('receiptPrintModalBody');
  if (body) {
    body.innerHTML = modeTabsHtml + paperHtml;
  }

  document.getElementById('receiptPrintModal')?.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('receiptPrintModal'));
}

function closeReceiptPrintModal() {
  document.getElementById('receiptPrintModal')?.classList.remove('open');
  state.printingOrderId = null;
}

function openOrderPayModal(orderId, autoCompleteAfterPay = false) {
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  state.payingOrderId = orderId;
  state.payingOrderMethod = '現場現金';
  state.payingOrderCashInput = '';
  state.completeAfterPay = Boolean(autoCompleteAfterPay);
  renderOrderPayModalContent();
  document.getElementById('orderPayModal')?.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('orderPayModal'));
}

function closeOrderPayModal() {
  document.getElementById('orderPayModal')?.classList.remove('open');
  state.payingOrderId = null;
  state.payingOrderCashInput = '';
  state.completeAfterPay = false;
}

function orderPayTapKey(key) {
  let cur = String(state.payingOrderCashInput || '');
  if (key === 'C') cur = '';
  else if (key === 'BACK') cur = cur.slice(0, -1);
  else if (cur.length < 6) cur = (cur === '0') ? String(key) : cur + String(key);
  state.payingOrderCashInput = cur;
  renderOrderPayModalContent();
}

function setOrderPayQuickCash(val) {
  state.payingOrderCashInput = String(val);
  renderOrderPayModalContent();
}

function setOrderPayMethod(method) {
  state.payingOrderMethod = method;
  renderOrderPayModalContent();
}

function renderOrderPayModalContent() {
  const box = document.getElementById('orderPayModalBody');
  const o = state.orders.find(ord => ord.orderId === state.payingOrderId);
  if (!box || !o) return;

  const total = Number(o.finalTotal) || 0;
  const cashNum = state.payingOrderCashInput !== '' ? parseFloat(state.payingOrderCashInput) : total;
  const change = Math.max(0, cashNum - total);
  const isShort = state.payingOrderMethod === '現場現金' && state.payingOrderCashInput !== '' && cashNum < total;
  const splitCashNum = Math.min(total, Math.max(0, parseInt(state.payingOrderSplitCashInput || '0', 10) || 0));
  const splitLineNum = Math.max(0, total - splitCashNum);
  const isSplitInvalid = state.payingOrderMethod === '複合付款' && (splitCashNum <= 0 || splitLineNum <= 0);
  const verDisplay = formatVerificationCodeDisplay(o);

  box.innerHTML = `
    ${state.completeAfterPay ? `
      <div style="background:#FEF2F2; border:1.5px solid #EF4444; color:#991B1B; padding:10px 12px; border-radius:10px; font-size:0.8rem; font-weight:900; margin-bottom:10px;">
        🛑 結單防呆攔截：此訂單為「${escapeHtml(o.paymentStatus || '取餐付現')}」，嚴禁未收款直接結單！請先完成收款找零。
      </div>
    ` : ''}

    <div style="background:#F8FAFC; padding:12px; border-radius:12px; border:1px solid var(--border); margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:900; font-size:1.1rem;">取餐號 #${escapeHtml(o.pickupNumber)} (核銷碼 ${escapeHtml(verDisplay)})</span>
        <span style="font-size:0.8rem; color:var(--text-secondary);">📅 ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}</span>
      </div>
      ${o.customerPhone ? `<div style="font-size:0.82rem; font-weight:800; color:var(--brand-dark); margin-top:2px;">📱 聯絡電話：${escapeHtml(o.customerPhone)}</div>` : ''}
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
        <span style="font-weight:800;">應收金額</span>
        <span style="font-size:1.45rem; font-weight:950; color:var(--red);">NT$ ${total}</span>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:10px;">
      ${['現場現金', 'LINE Pay', '複合付款'].map(m => `
        <button type="button" class="pos-chip-btn ${state.payingOrderMethod === m ? 'active' : ''}" onclick="setOrderPayMethod(${escapeJsAttr(m)})">${m === 'LINE Pay' ? '💚 LINE Pay' : m === '複合付款' ? '🔀 複合付款' : '💵 現場現金'}</button>
      `).join('')}
    </div>

    ${state.payingOrderMethod === '複合付款' ? `
      <div style="background:#FFFBEB; border:1.5px solid #F59E0B; border-radius:10px; padding:10px; margin-bottom:12px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div>
            <label class="field-label">💵 實收現金 ($)</label>
            <input type="number" class="select-input" min="1" max="${Math.max(1, total - 1)}" placeholder="如：${Math.floor(total / 2)}" value="${escapeHtml(state.payingOrderSplitCashInput)}" oninput="state.payingOrderSplitCashInput=this.value; renderOrderPayModalContent();">
          </div>
          <div>
            <label class="field-label">💚 LINE Pay ($)</label>
            <input type="text" class="select-input" disabled value="NT$ ${splitLineNum}" style="font-weight:900; color:#059669; background:#ECFDF5;">
          </div>
        </div>
      </div>
    ` : ''}

    ${state.payingOrderMethod === '現場現金' ? `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#0F172A; color:#FFFFFF; padding:10px 14px; border-radius:10px; margin-bottom:8px;">
        <div>
          <div style="font-size:0.72rem; color:#94A3B8;">💵 實收現金</div>
          <div style="font-size:1.25rem; font-weight:950; color:#38BDF8;">NT$ ${state.payingOrderCashInput !== '' ? escapeHtml(state.payingOrderCashInput) : `${total} (剛好)`}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.72rem; color:#94A3B8;">🪙 應找零錢</div>
          <div style="font-size:1.25rem; font-weight:950; color:${isShort ? '#F87171' : '#34D399'};">
            ${isShort ? `不足 $${total - cashNum}` : `NT$ ${change}`}
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-bottom:8px;">
        <button type="button" class="pos-chip-btn" onclick="setOrderPayQuickCash(${total})">剛好 ($${total})</button>
        <button type="button" class="pos-chip-btn" onclick="setOrderPayQuickCash(100)">$100</button>
        <button type="button" class="pos-chip-btn" onclick="setOrderPayQuickCash(500)">$500</button>
        <button type="button" class="pos-chip-btn" onclick="setOrderPayQuickCash(1000)">$1000</button>
      </div>

      <div class="pos-numpad-grid" style="height:175px; margin-bottom:12px;">
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('7')">7</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('8')">8</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('9')">9</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('4')">4</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('5')">5</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('6')">6</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('1')">1</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('2')">2</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('3')">3</button>
        <button type="button" class="pos-numpad-key clear" onclick="orderPayTapKey('C')">清空</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('0')">0</button>
        <button type="button" class="pos-numpad-key back" onclick="orderPayTapKey('BACK')">⌫</button>
      </div>
    ` : ''}

    <button type="button" class="btn-primary-full" onclick="confirmOrderPayment()" ${isShort || isSplitInvalid ? 'disabled' : ''}>
      ✅ ${state.completeAfterPay ? '確認收訖並立即完成結單' : `確認收訖 NT$ ${total}`} ${state.payingOrderMethod === '現場現金' && change > 0 ? `（找零 NT$ ${change}）` : ''}
    </button>
  `;
}

async function confirmOrderPayment() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const o = state.orders.find(ord => ord.orderId === state.payingOrderId);
  if (!o) return;

  const shouldComplete = state.completeAfterPay;
  const total = Number(o.finalTotal) || 0;
  const isSplit = state.payingOrderMethod === '複合付款';
  const splitCashNum = isSplit ? Math.min(total, Math.max(0, parseInt(state.payingOrderSplitCashInput || '0', 10) || 0)) : 0;
  const splitLineNum = isSplit ? Math.max(0, total - splitCashNum) : 0;
  const paymentSplitObj = isSplit ? { cash: splitCashNum, linePay: splitLineNum } : null;

  const cashNum = state.payingOrderMethod === '現場現金'
    ? (state.payingOrderCashInput !== '' ? parseFloat(state.payingOrderCashInput) : total)
    : (isSplit ? splitCashNum : total);
  const change = state.payingOrderMethod === '現場現金' ? Math.max(0, cashNum - total) : 0;

  const prevSnapshot = {
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    paymentSplit: o.paymentSplit,
    cashReceived: o.cashReceived,
    changeGiven: o.changeGiven,
    status: o.status
  };

  o.paymentStatus = '已付款';
  o.paymentMethod = isSplit ? `複合付款 (現金$${splitCashNum}+LP$${splitLineNum})` : state.payingOrderMethod;
  o.paymentSplit = paymentSplitObj;
  o.cashReceived = cashNum;
  o.changeGiven = change;
  o.status = shouldComplete ? '已完成' : evaluateOrderLifecycleStatus(o);

  state.payingOrderSplitCashInput = '';
  closeOrderPayModal();

  const ok = await executeMerchantOrderMutation(
    o,
    prevSnapshot,
    {
      action: 'updateOrderStatus',
      orderId: o.orderId,
      newStatus: o.status,
      paymentStatus: '已付款',
      paymentMethod: o.paymentMethod,
      paymentSplit: paymentSplitObj,
      cashReceived: cashNum,
      changeGiven: change
    },
    shouldComplete
      ? `✅ 訂單 #${o.pickupNumber} 已收款（找零 $${change}）並完成交付結單！`
      : `💵 訂單 #${o.pickupNumber} 已完成收款！目前狀態：${o.status}`
  );

  if (ok) {
    recordLocalPushNotificationLog(
      shouldComplete ? 'ORDER_COMPLETED' : 'ORDER_PAID',
      shouldComplete ? `✅ 訂單 #${o.pickupNumber} 已收款並完成取餐` : `💵 訂單 #${o.pickupNumber} 已完成繳費`,
      `我們已收到您【${o.storeName}】訂單共 NT$${o.finalTotal} (${o.paymentMethod}) 的款項，感謝您的光臨！`,
      o
    );
  }
}

async function markOrderReady(orderId) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  const prevSnapshot = {
    status: order.status,
    readyAtTs: order.readyAtTs,
    notifyCount: order.notifyCount
  };

  order.status = '可取餐';
  order.readyAtTs = order.readyAtTs || Date.now(); // 記錄出餐時間，維持 3 分鐘出餐口緩衝權重
  order.notifyCount = (Number(order.notifyCount) || 0) + 1;

  const ok = await executeMerchantOrderMutation(
    order,
    prevSnapshot,
    {
      action: 'updateOrderStatus',
      orderId: order.orderId,
      newStatus: '可取餐'
    },
    `🔔 已第 ${order.notifyCount} 次通知 #${order.pickupNumber} 取餐（雲端自動推播中）`
  );

  if (ok) {
    recordLocalPushNotificationLog(
      'ORDER_READY',
      `🔔 取餐通知 (#${order.pickupNumber})`,
      `您在【${order.storeName}】點的餐點已經準備好囉！請至櫃檯出示 #${order.pickupNumber}（核銷碼 ${formatVerificationCodeDisplay(order)}）領取。`,
      order
    );
  }
}

async function completeOrderFinal(orderId) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  if (String(order.status).includes('已取消')) {
    showToast(`🚫 訂單 #${order.pickupNumber} 已退單作廢，不可核銷交付！`);
    return;
  }
  if (order.status === '已完成') {
    showToast(`🛑 訂單 #${order.pickupNumber} 先前已完成核銷取餐，請勿重複交付！`);
    return;
  }

  if (!isOrderConsiderPaid(order)) {
    try { if ('vibrate' in navigator) navigator.vibrate([100, 60, 100]); } catch (e) {}
    showToast(`🛑 訂單 #${order.pickupNumber} 尚未收款（${order.paymentStatus}），請先於彈出視窗完成收銀找零！`);
    openOrderPayModal(orderId, true);
    return;
  }

  const prevSnapshot = {
    status: order.status
  };
  order.status = '已完成';

  const ok = await executeMerchantOrderMutation(
    order,
    prevSnapshot,
    {
      action: 'updateOrderStatus',
      orderId: order.orderId,
      newStatus: '已完成',
      paymentStatus: order.paymentStatus
    },
    `✅ 訂單 #${order.pickupNumber} 已完成核銷交付！`
  );

  if (ok) {
    recordLocalPushNotificationLog(
      'ORDER_COMPLETED',
      `✅ 訂單 #${order.pickupNumber} 已完成取餐`,
      `感謝您今日光臨【${order.storeName}】，祝您用餐愉快！`,
      order
    );
  }
}

function speakOrder(text, extraText = '') {
  if (!('speechSynthesis' in window)) {
    showToast('您的瀏覽器不支援語音播報');
    return;
  }
  window.speechSynthesis.cancel();
  const msg = extraText ? `取餐號碼 ${text}，${extraText}` : `請 ${text} 至櫃檯取餐`;
  const utter = new SpeechSynthesisUtterance(msg);
  utter.lang = 'zh-TW';
  utter.rate = 1.0;
  window.speechSynthesis.speak(utter);
}

// ==================== 6.3 商業級真實財務與營運分析儀表板 ====================
function setAnalyticsPeriod(period) {
  state.analyticsPeriod = period;
  state.analyticsSelectedFilter = null;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderMerchantAnalyticsPanel(store);
}

function showAnalyticsTooltip(evt, title, line1, line2 = '') {
  const tip = document.getElementById('analyticsChartTooltip');
  if (!tip) return;
  tip.innerHTML = `
    <div style="font-weight:900; color:#FBBF24; margin-bottom:2px;">${escapeHtml(title)}</div>
    <div>${escapeHtml(line1)}</div>
    ${line2 ? `<div style="font-size:0.72rem; color:#CBD5E1; margin-top:2px;">${escapeHtml(line2)}</div>` : ''}
  `;
  tip.classList.add('show');
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
  const left = Math.min(window.innerWidth - 230, Math.max(12, clientX + 14));
  const top = Math.max(12, clientY - 68);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideAnalyticsTooltip() {
  const tip = document.getElementById('analyticsChartTooltip');
  if (tip) tip.classList.remove('show');
}

function highlightDonutSlice(idx, name, qty, rev, pct, color) {
  const titleEl = document.getElementById('donutCenterTitle');
  const valEl = document.getElementById('donutCenterVal');
  const subEl = document.getElementById('donutCenterSub');
  if (titleEl) titleEl.textContent = name.slice(0, 7);
  if (valEl) {
    valEl.textContent = `${pct}%`;
    valEl.setAttribute('fill', color || '#3B82F6');
  }
  if (subEl) subEl.textContent = `${qty}份 / $${rev}`;
  document.querySelectorAll('.legend-interactive-row').forEach((row, i) => {
    row.classList.toggle('active', i === idx);
    row.classList.toggle('active-legend', i === idx);
  });
}

function resetDonutSlice(defaultName, defaultPct, defaultSub, defaultColor) {
  const titleEl = document.getElementById('donutCenterTitle');
  const valEl = document.getElementById('donutCenterVal');
  const subEl = document.getElementById('donutCenterSub');
  if (titleEl) titleEl.textContent = defaultName.slice(0, 7);
  if (valEl) {
    valEl.textContent = `${defaultPct}%`;
    valEl.setAttribute('fill', defaultColor || '#3B82F6');
  }
  if (subEl) subEl.textContent = defaultSub;
  document.querySelectorAll('.legend-interactive-row').forEach(row => {
    row.classList.remove('active');
    row.classList.remove('active-legend');
  });
}

function filterAnalyticsOrdersByKey(type, key, label) {
  if (state.analyticsSelectedFilter && state.analyticsSelectedFilter.type === type && state.analyticsSelectedFilter.key === key) {
    state.analyticsSelectedFilter = null;
  } else {
    state.analyticsSelectedFilter = { type, key, label };
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderMerchantAnalyticsPanel(store);
}

function parseOrderHour(order) {
  const pt = normalizeTimeStr(order.pickupTime, '');
  const m1 = pt.match(/(\d{1,2}):\d{2}/);
  if (m1) return parseInt(m1[1], 10);
  const ca = normalizeTimeStr(order.createdAt || '', '');
  const m2 = ca.match(/(\d{1,2}):\d{2}/);
  if (m2) return parseInt(m2[1], 10);
  return 12;
}

function calcBucketRealisticWaitMinutes(bucketOrders, maxCapPer15Min, storeBasePrepMin = 4) {
  if (!bucketOrders || bucketOrders.length === 0) return storeBasePrepMin;
  const quarterCounts = {};
  bucketOrders.forEach(o => {
    const d = normalizeDateStr(o.pickupDate);
    const tStr = normalizeTimeStr(o.pickupTime || o.createdAt, '12:00');
    const m = tStr.match(/(\d{1,2}):(\d{2})/);
    const hr = m ? parseInt(m[1], 10) : 12;
    const min = m ? parseInt(m[2], 10) : 0;
    const qKey = `${d}_${hr}_Q${Math.floor(min / 15)}`;
    quarterCounts[qKey] = (quarterCounts[qKey] || 0) + 1;
  });
  const maxQuarterDensity = Math.max(...Object.values(quarterCounts), 1);
  return calcPrepMinutes(maxQuarterDensity, maxCapPer15Min, storeBasePrepMin);
}

function exportStoreAnalyticsCsv() {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;

  const orders = state.orders.filter(o => o.storeId === store.id);
  if (orders.length === 0) {
    showToast('⚠️ 目前無訂單資料可匯出');
    return;
  }

  const headers = ['訂單編號', '取餐流水號', '防偽核銷碼', '店鋪名稱', '取餐日期', '取餐時間', '用餐方式', '來源類型', '餐點明細', '商品毛額', '餐具費', '離峰折抵', '櫃檯折讓', '實收淨額', '退款金額', '付款方式', '實收現金', '找零金額', '付款狀態', '交易授權碼', '買方統編', '訂單狀態', '聯絡電話', '顧客備註', '建立時間'];
  const rows = orders.map(o => {
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    const itemText = items.map(i => `${i.baseName || i.name}x${i.qty || 1}`).join('; ');
    return [
      o.orderId,
      `#${o.pickupNumber}`,
      formatVerificationCodeDisplay(o),
      o.storeName,
      normalizeDateStr(o.pickupDate),
      normalizeTimeStr(o.pickupTime),
      o.dineType || '外帶自取',
      o.studentId || '',
      itemText,
      o.subtotal || o.finalTotal,
      o.cutleryFee || 0,
      o.discount || 0,
      o.manualDiscount || 0,
      o.finalTotal,
      o.refundAmount || 0,
      o.paymentMethod || '',
      o.cashReceived || 0,
      o.changeGiven || 0,
      o.paymentStatus || '',
      o.transactionId || '',
      o.taxId || '',
      o.status || '',
      o.customerPhone || '',
      o.customerNote || '',
      o.createdAt || ''
    ].map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',');
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MealFlow_${store.name}_營運財務報表_${getTodayDateStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`📥 已匯出「${store.name}」正規化會計報表（共 ${orders.length} 筆）！`);
}

function renderMerchantAnalyticsPanel(store) {
  const panel = document.getElementById('storePanel-analytics');
  if (!panel) return;

  const period = state.analyticsPeriod || 'DAY';
  const todayStr = getTodayDateStr();
  const past7StartStr = getDateOffsetFromStr(todayStr, -6);

  const allValidStoreOrders = state.orders.filter(o => o.storeId === store.id && !String(o.status).includes('已取消'));
  const hasSeedOrders = state.orders.some(o => o.isSeedSample);

  let periodTitle = `今日各時段真實實收營收 (${todayStr})`;
  let buckets = [];
  let periodOrders = [];

  // #33 營收分析歸屬日期與交班日結單 (Z-Report) 完全對齊：已付款訂單以實際收款日 (paidAtDate) 歸屬，未付款訂單以取餐日歸屬
  const getOrderAccountingDate = (o) => {
    if (isOrderConsiderPaid(o) && o.paidAtDate) return normalizeDateStr(o.paidAtDate);
    return normalizeDateStr(o.pickupDate);
  };

  if (period === 'DAY') {
    periodOrders = allValidStoreOrders.filter(o => getOrderAccountingDate(o) === todayStr);
    buckets = [
      { key: '10', label: '10-11時', match: o => parseOrderHour(o) <= 10 },
      { key: '11', label: '11-12時', match: o => parseOrderHour(o) === 11 },
      { key: '12', label: '12-13時', match: o => parseOrderHour(o) === 12 },
      { key: '13', label: '13-14時', match: o => parseOrderHour(o) === 13 },
      { key: '14', label: '14-16時', match: o => parseOrderHour(o) >= 14 && parseOrderHour(o) <= 15 },
      { key: '16', label: '16-18時', match: o => parseOrderHour(o) >= 16 && parseOrderHour(o) <= 17 },
      { key: '18', label: '18時後', match: o => parseOrderHour(o) >= 18 }
    ];
  } else if (period === 'WEEK') {
    periodTitle = `過去 7 日每日真實營收趨勢 (${past7StartStr.slice(5)} ~ ${todayStr.slice(5)})`;
    const dayOffsets = [-6, -5, -4, -3, -2, -1, 0];
    const allowedDates = new Set(dayOffsets.map(off => getDateOffsetFromStr(todayStr, off)));
    periodOrders = allValidStoreOrders.filter(o => allowedDates.has(getOrderAccountingDate(o)));
    buckets = dayOffsets.map(off => {
      const dStr = getDateOffsetFromStr(todayStr, off);
      const shortLabel = off === 0 ? `今日(${dStr.slice(5)})` : dStr.slice(5);
      return {
        key: dStr,
        label: shortLabel,
        match: o => getOrderAccountingDate(o) === dStr
      };
    });
  } else {
    periodTitle = '歷史與未來預訂全區間分析';
    periodOrders = allValidStoreOrders;
    const uniqueDates = [...new Set(allValidStoreOrders.map(o => getOrderAccountingDate(o)))].sort();
    buckets = (uniqueDates.length > 0 ? uniqueDates : [todayStr]).map(dStr => ({
      key: dStr,
      label: dStr.slice(5),
      match: o => getOrderAccountingDate(o) === dStr
    }));
  }

  const paidPeriodOrders = periodOrders.filter(o => isOrderConsiderPaid(o));
  const unpaidPeriodOrders = periodOrders.filter(o => !isOrderConsiderPaid(o));

  const grossSales = paidPeriodOrders.reduce((s, o) => s + (Number(o.subtotal) || 0) + (Number(o.cutleryFee) || 0), 0);
  const totalDiscountCost = paidPeriodOrders.reduce((s, o) => s + (Number(o.discount) || 0) + (Number(o.manualDiscount) || 0), 0);
  const netPaidRevenue = paidPeriodOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const unpaidReceivables = unpaidPeriodOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const avgTicket = paidPeriodOrders.length > 0 ? Math.round(netPaidRevenue / paidPeriodOrders.length) : 0;
  const futureReservations = allValidStoreOrders.filter(o => o.isReservation && normalizeDateStr(o.pickupDate) > todayStr);

  const bucketStats = buckets.map(b => {
    const matched = periodOrders.filter(b.match);
    const paidMatched = matched.filter(o => isOrderConsiderPaid(o));
    const rev = paidMatched.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
    const count = matched.length;
    const estWait = calcBucketRealisticWaitMinutes(matched, store.maxCapacityPer15Min, store.basePrepMinutes || 4);
    return { ...b, orders: matched, rev, count, estWait };
  });

  const maxBar = Math.max(...bucketStats.map(b => b.rev), 100);
  const barSvgHtml = `
    <svg viewBox="0 0 460 195" style="width:100%; height:190px; overflow:visible;" onmouseleave="hideAnalyticsTooltip()">
      ${bucketStats.map((b, i) => {
        const colW = 390 / bucketStats.length;
        const barW = Math.min(42, colW - 12);
        const x = 40 + i * colW + (colW - barW) / 2;
        const h = b.rev > 0 ? Math.max(14, Math.round((b.rev / maxBar) * 128)) : 6;
        const y = 152 - h;
        const isSelected = state.analyticsSelectedFilter?.type === 'BUCKET' && state.analyticsSelectedFilter?.key === b.key;
        return `
          <g class="chart-interactive-bar ${isSelected ? 'active-bar' : ''}"
             onmousemove="showAnalyticsTooltip(event, ${escapeJsAttr(b.label + ' 營運數據')}, ${escapeJsAttr('已入帳淨營收：NT$ ' + b.rev.toLocaleString() + ' (總計 ' + b.count + ' 單)')}, '點擊柱狀圖可於下方篩選檢視明細')"
             ontouchstart="showAnalyticsTooltip(event, ${escapeJsAttr(b.label + ' 營運數據')}, ${escapeJsAttr('已入帳淨營收：NT$ ' + b.rev.toLocaleString() + ' (總計 ' + b.count + ' 單)')}, '點擊下方篩選明細')"
             onclick="filterAnalyticsOrdersByKey('BUCKET', ${escapeJsAttr(b.key)}, ${escapeJsAttr('時段/日期：' + b.label)})">
            <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6"
                  fill="${isSelected ? '#F97316' : (b.rev > 0 ? 'url(#barGrad)' : '#E2E8F0')}"
                  stroke="${isSelected ? '#C2410C' : 'none'}" stroke-width="2" />
            <text x="${x + barW / 2}" y="${y - 16}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#64748B">${b.count}單</text>
            <text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="10.5" font-weight="900" fill="${isSelected ? '#C2410C' : '#0F172A'}">$${b.rev}</text>
            <text x="${x + barW / 2}" y="170" text-anchor="middle" font-size="10.5" font-weight="800" fill="${isSelected ? '#EA580C' : '#475569'}">${escapeHtml(b.label)}</text>
          </g>
        `;
      }).join('')}
      <line x1="30" y1="152" x2="440" y2="152" stroke="#CBD5E1" stroke-width="1.5" />
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3B82F6" />
          <stop offset="100%" stop-color="#1D4ED8" />
        </linearGradient>
      </defs>
    </svg>
  `;

  const itemStatsMap = {};
  let totalItemRevenue = 0;
  periodOrders.forEach(o => {
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    items.forEach(it => {
      if (it.isGift || Number(it.price) === 0) return;
      const cleanBaseName = it.baseName || String(it.name || '餐點').split(' [')[0].trim();
      const qty = Number(it.qty) || 1;
      const rev = (Number(it.price) || 0) * qty;
      if (!itemStatsMap[cleanBaseName]) itemStatsMap[cleanBaseName] = { name: cleanBaseName, qty: 0, rev: 0 };
      itemStatsMap[cleanBaseName].qty += qty;
      itemStatsMap[cleanBaseName].rev += rev;
      totalItemRevenue += rev;
    });
  });

  const palette = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
  const sortedItems = Object.values(itemStatsMap).sort((a, b) => b.rev - a.rev);
  let pieItems = [];
  if (sortedItems.length === 0) {
    pieItems = [{ name: '此區間無紀錄', qty: 0, rev: 0, pct: 100, color: '#CBD5E1' }];
  } else {
    const top4 = sortedItems.slice(0, 4);
    const others = sortedItems.slice(4);
    pieItems = top4.map((it, idx) => ({
      name: it.name,
      qty: it.qty,
      rev: it.rev,
      pct: Math.max(1, Math.round((it.rev / Math.max(1, totalItemRevenue)) * 100)),
      color: palette[idx % palette.length]
    }));
    if (others.length > 0) {
      const otherQty = others.reduce((s, i) => s + i.qty, 0);
      const otherRev = others.reduce((s, i) => s + i.rev, 0);
      pieItems.push({
        name: '其他餐點合計',
        qty: otherQty,
        rev: otherRev,
        pct: Math.max(1, Math.round((otherRev / Math.max(1, totalItemRevenue)) * 100)),
        color: palette[4]
      });
    }
    const sumPct = pieItems.reduce((s, i) => s + i.pct, 0);
    if (sumPct !== 100 && pieItems.length > 0) {
      pieItems[0].pct = Math.max(1, pieItems[0].pct + (100 - sumPct));
    }
  }

  const topPie = pieItems[0];
  let cumPct = 0;
  const donutCircles = pieItems.map((seg, idx) => {
    const dashArray = `${seg.pct} ${100 - seg.pct}`;
    const dashOffset = 25 - cumPct;
    cumPct += seg.pct;
    return `
      <circle class="chart-interactive-slice"
              r="15.915" cx="21" cy="21" fill="transparent"
              stroke="${seg.color}" stroke-width="6.5"
              stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}"
              onmouseenter="highlightDonutSlice(${idx}, ${escapeJsAttr(seg.name)}, ${seg.qty}, ${seg.rev}, ${seg.pct}, ${escapeJsAttr(seg.color)})"
              onmousemove="showAnalyticsTooltip(event, ${escapeJsAttr('🍽️ ' + seg.name)}, ${escapeJsAttr('真實銷量：' + seg.qty + ' 份 ・ 營收：NT$ ' + seg.rev)}, ${escapeJsAttr('佔比 ' + seg.pct + '%（點擊可篩選包含此餐點的真實訂單）')})"
              onmouseleave="resetDonutSlice(${escapeJsAttr(topPie.name)}, ${topPie.pct}, ${escapeJsAttr(topPie.qty + '份 / $' + topPie.rev)}, ${escapeJsAttr(topPie.color)}); hideAnalyticsTooltip();"
              onclick="filterAnalyticsOrdersByKey('ITEM', ${escapeJsAttr(seg.name)}, ${escapeJsAttr('餐點包含：' + seg.name)})"></circle>
    `;
  }).join('');

  const maxWait = Math.max(20, ...bucketStats.map(b => b.estWait));
  const pts = bucketStats.map((b, i) => {
    const x = 45 + (i * (370 / Math.max(1, bucketStats.length - 1)));
    const y = 145 - Math.round((b.estWait / maxWait) * 110);
    return { x, y, w: b.estWait, count: b.count, rev: b.rev, label: b.label, key: b.key };
  });
  const polylinePoints = pts.map(p => `${p.x},${p.y}`).join(' ');
  const areaPoints = `45,145 ${polylinePoints} ${pts[pts.length - 1].x},145`;

  let drilldownOrders = periodOrders;
  const activeFilter = state.analyticsSelectedFilter;
  if (activeFilter) {
    if (activeFilter.type === 'BUCKET') {
      const targetBucket = bucketStats.find(b => b.key === activeFilter.key);
      if (targetBucket) drilldownOrders = targetBucket.orders;
    } else if (activeFilter.type === 'ITEM') {
      drilldownOrders = periodOrders.filter(o =>
        Array.isArray(o.structuredItems) && o.structuredItems.some(it => (it.baseName || it.name) === activeFilter.key)
      );
    }
  }

  panel.innerHTML = `
    <div class="analytics-panel-wrap">
      <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:12px 16px; border-radius:14px; border:1px solid var(--border); flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:1.08rem; font-weight:950; color:var(--text-primary);">
            📊 ${escapeHtml(store.name)} — 商業會計損益與真實訂單分析
          </h3>
          <div style="font-size:0.78rem; color:var(--text-secondary);">
            💡 嚴格區分「今日逐時」、「過去 7 日趨勢」與「應收/實收帳款」，絕不混入未來預訂單造成帳務失真。
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <button type="button" class="pos-cat-pill ${period === 'DAY' ? 'active' : ''}" onclick="setAnalyticsPeriod('DAY')">📅 今日逐時 (${allValidStoreOrders.filter(o => normalizeDateStr(o.pickupDate) === todayStr).length}單)</button>
          <button type="button" class="pos-cat-pill ${period === 'WEEK' ? 'active' : ''}" onclick="setAnalyticsPeriod('WEEK')">📆 過去7日趨勢</button>
          <button type="button" class="pos-cat-pill ${period === 'MONTH' ? 'active' : ''}" onclick="setAnalyticsPeriod('MONTH')">🗓️ 全區間含未來預訂 (${allValidStoreOrders.length}單)</button>
          <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.78rem; background:#0F172A;" onclick="openShiftZReportModal()">🧾 交班日結單</button>
          <button type="button" class="btn-outline" style="padding:5px 10px; font-size:0.76rem;" onclick="exportStoreAnalyticsCsv()">📥 匯出 CSV</button>
        </div>
      </div>

      <div class="analytics-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">💰 實收淨營業額 (Net Paid)</div>
          <div class="kpi-val" style="color:var(--brand-dark);">NT$ ${netPaidRevenue.toLocaleString()}</div>
          <div class="kpi-sub">已收款 ${paidPeriodOrders.length} 單 ・ 客單價 NT$ ${avgTicket}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">📈 毛銷售額 vs 折扣讓利成本</div>
          <div class="kpi-val">NT$ ${grossSales.toLocaleString()}</div>
          <div class="kpi-sub" style="color:var(--indigo);">總折讓成本 -NT$ ${totalDiscountCost.toLocaleString()}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">⏳ 未收應收帳款 & 未來預訂</div>
          <div class="kpi-val" style="color:var(--amber);">NT$ ${unpaidReceivables.toLocaleString()}</div>
          <div class="kpi-sub" style="color:var(--text-secondary);">區間待收 ${unpaidPeriodOrders.length} 單 ・ 未來預訂 ${futureReservations.length} 單</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">⏱️ 目前即時出餐等候 / 產能負載</div>
          <div class="kpi-val">${store.avgPrepMinutes} 分鐘</div>
          <div class="kpi-sub">基礎 ${store.basePrepMinutes}分 ・ 佇列 ${store.activeOrders}/${store.maxCapacityPer15Min} 單 (${store.loadPercentage}%)</div>
        </div>
      </div>

      <div class="charts-grid">
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:4px;">
            <span style="font-weight:900; font-size:0.94rem;">📊 ${escapeHtml(periodTitle)}</span>
            <span style="font-size:0.74rem; color:var(--brand-dark); font-weight:800;">🖱️ 點擊柱狀圖篩選明細</span>
          </div>
          ${barSvgHtml}
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span style="font-weight:900; font-size:0.94rem;">🍩 結構化單品營收佔比 (正規化 baseName)</span>
            <span style="font-size:0.72rem; color:var(--text-secondary); font-weight:700;">餐點總計 $${totalItemRevenue}</span>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-around; gap:12px; flex-wrap:wrap;">
            <svg width="155" height="155" viewBox="0 0 42 42" style="overflow:visible;">
              <circle r="15.915" cx="21" cy="21" fill="transparent" stroke="#F1F5F9" stroke-width="6.5"></circle>
              ${donutCircles}
              <text id="donutCenterTitle" x="21" y="18.5" text-anchor="middle" font-size="3.3" font-weight="900" fill="#0F172A">${escapeHtml(topPie.name.slice(0, 7))}</text>
              <text id="donutCenterVal" x="21" y="23.8" text-anchor="middle" font-size="4.6" font-weight="900" fill="${topPie.color}">${topPie.pct}%</text>
              <text id="donutCenterSub" x="21" y="27.5" text-anchor="middle" font-size="2.6" font-weight="800" fill="#64748B">${topPie.qty}份 / $${topPie.rev}</text>
            </svg>
            <div style="flex:1; min-width:170px; display:flex; flex-direction:column; gap:5px;">
              ${pieItems.map((p, idx) => `
                <div class="legend-interactive-row ${state.analyticsSelectedFilter?.type === 'ITEM' && state.analyticsSelectedFilter?.key === p.name ? 'active active-legend' : ''}"
                     onmouseenter="highlightDonutSlice(${idx}, ${escapeJsAttr(p.name)}, ${p.qty}, ${p.rev}, ${p.pct}, ${escapeJsAttr(p.color)})"
                     onmouseleave="resetDonutSlice(${escapeJsAttr(topPie.name)}, ${topPie.pct}, ${escapeJsAttr(topPie.qty + '份 / $' + topPie.rev)}, ${escapeJsAttr(topPie.color)})"
                     onclick="filterAnalyticsOrdersByKey('ITEM', ${escapeJsAttr(p.name)}, ${escapeJsAttr('餐點包含：' + p.name)})">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="width:10px; height:10px; border-radius:3px; background:${p.color}; display:inline-block;"></span>
                    <span style="font-weight:800; font-size:0.8rem; color:var(--text-primary);">${escapeHtml(p.name)}</span>
                  </div>
                  <span style="font-weight:900; font-size:0.78rem; color:var(--text-secondary);">${p.qty}份 ($${p.rev} / ${p.pct}%)</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="charts-grid">
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:900; font-size:0.94rem;">📈 各時段 15 分鐘尖峰密度與候餐時間曲線</span>
            <span style="font-size:0.74rem; color:var(--red); font-weight:800;">紅虛線：15分鐘警戒</span>
          </div>
          <svg viewBox="0 0 460 175" style="width:100%; height:170px; overflow:visible;" onmouseleave="hideAnalyticsTooltip()">
            <line x1="35" y1="62" x2="435" y2="62" stroke="#FCA5A5" stroke-dasharray="4 4" stroke-width="1.5" />
            <polygon points="${areaPoints}" fill="rgba(16, 185, 129, 0.14)" />
            <polyline fill="none" stroke="#10B981" stroke-width="3" points="${polylinePoints}" />
            ${pts.map(p => `
              <g style="cursor:pointer;"
                 onmousemove="showAnalyticsTooltip(event, ${escapeJsAttr('⏱️ ' + p.label + ' 候餐負載')}, ${escapeJsAttr('尖峰預估候餐：約 ' + p.w + ' 分鐘（區間共 ' + p.count + ' 單 / $' + p.rev + '）')}, '依據店家基礎出餐時間與 15 分鐘最大密度精算')"
                 ontouchstart="showAnalyticsTooltip(event, ${escapeJsAttr('⏱️ ' + p.label + ' 候餐負載')}, ${escapeJsAttr('尖峰預估候餐：約 ' + p.w + ' 分鐘（區間共 ' + p.count + ' 單 / $' + p.rev + '）')}, '點擊篩選此時段訂單')"
                 onclick="filterAnalyticsOrdersByKey('BUCKET', ${escapeJsAttr(p.key)}, ${escapeJsAttr('時段/日期：' + p.label)})">
                <circle class="chart-interactive-point" cx="${p.x}" cy="${p.y}" r="5.5" fill="#FFFFFF" stroke="#059669" stroke-width="3" />
                <text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="10" font-weight="900" fill="#065F46">${p.w}分(${p.count}單)</text>
                <text x="${p.x}" y="164" text-anchor="middle" font-size="10.5" font-weight="700" fill="#64748B">${escapeHtml(p.label)}</text>
              </g>
            `).join('')}
            <line x1="35" y1="145" x2="435" y2="145" stroke="#CBD5E1" stroke-width="1.5" />
          </svg>
        </div>

        <div class="chart-card" style="background:linear-gradient(135deg, #EEF2FF 0%, #FFFFFF 100%); border-color:#C7D2FE;">
          <div style="font-weight:900; font-size:0.95rem; color:#312E81; margin-bottom:10px;">
            🧠 商業財務與廚房排程診斷
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; font-size:0.82rem; color:#1E293B; line-height:1.5;">
            <div style="background:#FFFFFF; padding:8px 12px; border-radius:10px; border-left:4px solid #4F46E5;">
              <strong>🥇 本區間人氣王備料建議：</strong><br>
              銷量第一名為「<strong>${escapeHtml(topPie.name)}</strong>」（售出 <strong>${topPie.qty} 份 / NT$ ${topPie.rev}</strong>，佔比 ${topPie.pct}%）。
            </div>
            <div style="background:#FFFFFF; padding:8px 12px; border-radius:10px; border-left:4px solid #10B981;">
              <strong>📅 未來預訂排程與配額隔離保護：</strong><br>
              系統共有 <strong>${futureReservations.length} 筆未來日期預訂單</strong>，已全數納入 15 分鐘時段配額控管並置於「已接單待排程」狀態，不會提前擠佔今日廚房佇列或污染今日營收。
            </div>
          </div>
        </div>
      </div>

      <div class="chart-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div>
            <span style="font-weight:900; font-size:0.95rem;">
              🔍 區間真實訂單明細 (${activeFilter ? `已篩選：【${escapeHtml(activeFilter.label)}】共 ${drilldownOrders.length} 筆` : `本區間共 ${drilldownOrders.length} 筆訂單`})
            </span>
          </div>
          ${activeFilter ? `
            <button type="button" class="pos-cat-pill active" onclick="filterAnalyticsOrdersByKey(${escapeJsAttr(activeFilter.type)}, ${escapeJsAttr(activeFilter.key)}, '')">
              ✖ 清除篩選（顯示全部 ${periodOrders.length} 筆）
            </button>
          ` : ''}
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:8px; max-height:240px; overflow-y:auto;">
          ${drilldownOrders.length === 0 ? `<div style="color:var(--text-muted); font-size:0.84rem; padding:12px;">此時間區間尚無訂單紀錄</div>` : drilldownOrders.map(o => {
            const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
            const summary = items.map(i => `${i.baseName || i.name}×${i.qty || 1}`).join('、');
            const verDisplay = formatVerificationCodeDisplay(o);
            return `
              <div style="padding:8px 12px; border-radius:10px; border:1px solid var(--border); background:#F8FAFC; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="min-width:0; flex:1;">
                  <div style="font-weight:900; color:var(--text-primary);">
                    #${escapeHtml(o.pickupNumber)} (🛡️${escapeHtml(verDisplay)}) ・ ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}
                    <span style="font-size:0.7rem; color:var(--brand-dark);">(${escapeHtml(o.status)} / ${escapeHtml(o.paymentStatus)})</span>
                  </div>
                  <div style="color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(summary)}</div>
                </div>
                <div style="font-weight:950; color:var(--red); white-space:nowrap;">NT$ ${o.finalTotal}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(panel);
}

// ==================== 6.4 店家整合設定中心 ====================
function renderMerchantSettingsPanel(store) {
  const panel = document.getElementById('storePanel-settings');
  if (!panel) return;

  const sub = state.settingsSubTab || 'menu';
  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const menus = store.menus || [];
  const remainMins = Math.max(0, Math.round((state.merchantSessionExpiresAt - Date.now()) / 60000));
  const storeAuditLogs = (state.merchantAuditLogs || []).filter(l => !l.storeId || l.storeId === store.id).slice(0, 30);

  panel.innerHTML = `
    <div class="settings-panel-wrap">
      <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:12px 16px; border-radius:14px; border:1px solid var(--border); flex-wrap:wrap; gap:10px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="pos-cat-pill ${sub === 'menu' ? 'active' : ''}" onclick="switchSettingsSubTab('menu')">🍔 菜單管理與智慧照片辨識</button>
          <button type="button" class="pos-cat-pill ${sub === 'promo' ? 'active' : ''}" onclick="switchSettingsSubTab('promo')">🥢 營業狀態・餐具收費與離峰優惠</button>
          <button type="button" class="pos-cat-pill ${sub === 'storeProfile' ? 'active' : ''}" onclick="switchSettingsSubTab('storeProfile')">🏪 餐廳與校區管理</button>
          <button type="button" class="pos-cat-pill ${sub === 'line' ? 'active' : ''}" onclick="switchSettingsSubTab('line')">💚 推播設定・安全鎖與稽核紀錄</button>
        </div>

        <select class="select-input" style="width:auto; padding:6px 10px; font-weight:800;" onchange="switchMerchantStore(this.value)">
          ${state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>切換店鋪：${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>

      ${sub === 'menu' ? `
        <div class="chart-card" style="background:linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%); border:1.5px solid #C7D2FE;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div>
              <h3 style="font-size:1.02rem; font-weight:900; color:#312E81;">📸 智慧視覺菜單辨識（支援拍照上傳與穩定品項 ID 匯入）</h3>
              <p style="font-size:0.78rem; color:#4338CA;">上傳紙本菜單照片或貼上文字，系統將自動進行結構化解析並綁定確定性品項 ID，絕不破壞進行中訂單關聯！</p>
            </div>
            <label style="background:#4F46E5; color:#FFFFFF; padding:8px 14px; border-radius:10px; font-size:0.82rem; font-weight:800; cursor:pointer; box-shadow:0 4px 12px rgba(79,70,229,0.25);">
              📷 拍照 / 上傳菜單圖片
              <input type="file" id="aiMenuImageInput" accept="image/*" style="display:none;" onchange="handleMenuImageUpload(event)">
            </label>
          </div>

          <textarea id="aiMenuRawText" class="select-input" rows="3" placeholder="或在此直接貼上菜單文字（例如：招牌牛肉麵 120 (加麵+15/小辣)、紅油抄手 65、燙青菜 40）..." style="background:#FFFFFF; margin-bottom:8px; font-size:0.84rem;"></textarea>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn-tip-action" style="background:#4F46E5;" onclick="runAiMenuRecognition()">✨ 執行結構化解析與預覽</button>
            <button type="button" class="filter-chip" onclick="loadSampleMenuTextForAi()">📋 載入範例新菜單測試</button>
          </div>
          <div id="aiScannedPreviewArea" style="display:none; margin-top:12px;"></div>
        </div>

        <div class="chart-card">
          <h3 style="font-size:0.98rem; font-weight:900; margin-bottom:10px;">➕ 手動新增單一品項至「${escapeHtml(store.name)}」（自動產生穩定品項 ID・支援每日限量）</h3>
          <div style="display:grid; grid-template-columns:0.9fr 1.3fr 0.65fr 0.65fr 0.9fr 1.2fr auto; gap:8px; align-items:end;">
            <div>
              <label class="field-label">分類</label>
              <input type="text" id="newMenuCat" class="select-input" placeholder="如：主廚推薦" value="主廚推薦">
            </div>
            <div>
              <label class="field-label">餐點名稱 *</label>
              <input type="text" id="newMenuName" class="select-input" placeholder="如：香煎雞腿便當">
            </div>
            <div>
              <label class="field-label">價格 *</label>
              <input type="number" id="newMenuPrice" class="select-input" placeholder="110">
            </div>
            <div>
              <label class="field-label">每日限量</label>
              <input type="number" id="newMenuDailyLimit" class="select-input" min="0" placeholder="0=不限" value="0">
            </div>
            <div>
              <label class="field-label">推薦標籤</label>
              <input type="text" id="newMenuTag" class="select-input" placeholder="🔥 店長推薦">
            </div>
            <div>
              <label class="field-label">客製選項 (逗號分隔)</label>
              <input type="text" id="newMenuOpts" class="select-input" placeholder="正常, 飯少">
            </div>
            <button type="button" class="btn-tip-action" style="height:40px;" onclick="addManualMenuItem()">＋ 新增</button>
          </div>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
            <h3 style="font-size:0.98rem; font-weight:900;">📋 目前架上菜單（共 ${menus.length} 道，支援每日限量自動扣減售罄與客製加料規則）</h3>
          </div>
          ${(function () {
            const modMap = {};
            menus.forEach(m => {
              Object.values(m.options || {}).forEach(grp => {
                (grp && Array.isArray(grp.choices) ? grp.choices : []).forEach(c => {
                  const cName = String(Array.isArray(c) ? c[0] : c).trim();
                  if (!cName) return;
                  if (!modMap[cName]) modMap[cName] = { total: 0, soldOut: 0 };
                  modMap[cName].total++;
                  if (Array.isArray(c) && Boolean(c[2])) modMap[cName].soldOut++;
                });
              });
            });
            const sharedMods = Object.entries(modMap).filter(([, info]) => info.total >= 2).slice(0, 16);
            if (sharedMods.length === 0) return '';
            return `
              <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; padding:10px 12px; margin-bottom:12px;">
                <div style="font-size:0.78rem; font-weight:900; color:#92400E; margin-bottom:6px;">⚡ 批次加料售罄開關（點擊一次即同步全店所有含該加料的主餐）</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                  ${sharedMods.map(([cName, info]) => {
                    const allOut = info.soldOut >= info.total;
                    return `<button type="button" onclick="bulkToggleModifierChoiceSoldOut(${escapeJsAttr(cName)})" style="border:1px solid ${allOut ? '#EF4444' : '#D97706'}; background:${allOut ? '#FEE2E2' : '#FFFFFF'}; color:${allOut ? '#B91C1C' : '#92400E'}; padding:4px 10px; border-radius:999px; font-size:0.74rem; font-weight:800;">${allOut ? '🚫 ' : '🟢 '}${escapeHtml(cName)} (${info.total})${allOut ? ' [已售罄]' : ''}</button>`;
                  }).join('')}
                </div>
              </div>
            `;
          })()}
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(310px, 1fr)); gap:10px;">
            ${menus.map((m, idx) => {
              const optCount = m.options ? Object.keys(m.options).length : 0;
              const isSoldOut = Boolean(m.soldOut);
              const dLimit = Number(m.dailyLimit) || 0;
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border:1.5px solid ${isSoldOut ? '#FCA5A5' : 'var(--border)'}; border-radius:12px; background:${isSoldOut ? '#FEF2F2' : '#F8FAFC'}; gap:8px;">
                  <div style="min-width:0; flex:1;">
                    <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                      <span style="font-size:0.7rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:2px 6px; border-radius:4px;">${escapeHtml(m.category || '主餐')}</span>
                      ${isSoldOut ? `<span class="sold-out-ribbon">今日已售罄</span>` : (m.tag ? `<span style="font-size:0.68rem; font-weight:800; color:#4338CA; background:#EEF2FF; padding:2px 6px; border-radius:4px;">${escapeHtml(m.tag)}</span>` : '')}
                      ${dLimit > 0 ? `<span style="font-size:0.68rem; font-weight:900; color:#DC2626; background:#FEE2E2; padding:2px 6px; border-radius:4px;">📦 限量 ${dLimit} 份${m.remainingToday !== null && m.remainingToday !== undefined ? ` (剩${m.remainingToday})` : ''}</span>` : ''}
                      <span style="font-size:0.68rem; color:var(--text-secondary); font-weight:700;">⚙️ ${optCount} 組選項 (ID:${escapeHtml(m.id)})</span>
                    </div>
                    <div data-dish-name="1" style="font-weight:900; font-size:0.92rem; margin-top:4px; color:var(--text-primary);">${escapeHtml(trDishName(m))}</div>
                  </div>
                  <div style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
                    <span style="font-size:0.8rem; font-weight:800;">$</span>
                    <input type="number" value="${m.price}" onchange="updateMenuItemPrice(${idx}, this.value)" style="width:58px; padding:4px 6px; border:1px solid var(--border); border-radius:6px; font-weight:900;">
                    <button type="button" onclick="toggleMenuItemSoldOut(${idx})" style="border:1px solid ${isSoldOut ? '#10B981' : '#CBD5E1'}; background:${isSoldOut ? '#DCFCE7' : '#FFFFFF'}; color:${isSoldOut ? '#065F46' : '#475569'}; padding:5px 7px; border-radius:6px; font-weight:800; font-size:0.74rem;">
                      ${isSoldOut ? '上架' : '售罄'}
                    </button>
                    <button type="button" onclick="openMenuEditModal(${idx})" style="border:1px solid #C7D2FE; background:#EEF2FF; color:#312E81; padding:5px 8px; border-radius:6px; font-weight:800; font-size:0.76rem;">✏️ 編輯</button>
                    <button type="button" onclick="deleteMenuItem(${idx})" style="border:none; background:#FEE2E2; color:#DC2626; padding:5px 8px; border-radius:6px; font-weight:800; font-size:0.76rem;">刪</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${sub === 'promo' ? `
        <div class="chart-card">
          <h3 style="font-size:1.05rem; font-weight:900; margin-bottom:6px;">🥢 營業狀態・基礎出餐時間・預訂備餐前置・餐具與離峰優惠設定（${escapeHtml(store.name)}）</h3>
          <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:16px;">
            可在此調整每 15 分鐘餐點份數產能上限、預訂單自動推入廚房前置時間與離峰折抵/招待優惠。
          </p>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:16px;">
            <div>
              <label class="field-label">🏪 本店目前營業狀態</label>
              <select id="cfgStoreIsOpen" class="select-input">
                <option value="true" ${store.isOpen !== false ? 'selected' : ''}>🟢 正常營業中 (開放立即製作與預訂)</option>
                <option value="false" ${store.isOpen === false ? 'selected' : ''}>🔴 暫停營業 / 備料中 (僅開放預訂取餐)</option>
              </select>
            </div>

            <div>
              <label class="field-label" style="color:var(--brand-dark);">🥢 一次性免洗餐具收費金額 (NT$)</label>
              <input type="number" id="cfgCutleryPrice" class="select-input" min="0" max="50" value="${storeCutleryPrice}">
            </div>

            <div>
              <label class="field-label">⏱️ 空閒時基礎出餐時間 (分鐘)</label>
              <input type="number" id="cfgBasePrepMin" class="select-input" min="1" max="25" value="${store.basePrepMinutes || 4}">
            </div>

            <div>
              <label class="field-label">🔥 每 15 分鐘產能與預訂配額上限 (份數)</label>
              <input type="number" id="cfgMaxCap" class="select-input" min="5" max="200" value="${store.maxCapacityPer15Min}">
            </div>

            <div>
              <label class="field-label">📅 預訂單提前自動推入廚房時間 (分鐘)</label>
              <input type="number" id="cfgReserveLeadMins" class="select-input" min="10" max="90" value="${store.reserveLeadMinutes || 25}">
            </div>

            <div>
              <label class="field-label">🎁 離峰分流優惠模式（滿 $${AI_DISCOUNT_MIN_SUBTOTAL} 適用・尖峰排除）</label>
              <select id="cfgPromoMode" class="select-input">
                <option value="none" ${store.promoMode === 'none' ? 'selected' : ''}>關閉優惠</option>
                <option value="gift" ${(store.promoMode === 'gift' || store.promoMode === 'freebie') ? 'selected' : ''}>贈送招牌小菜 / 飲品 (滿 $${AI_DISCOUNT_MIN_SUBTOTAL} 免費贈送，顧客可取消)</option>
                <option value="discount" ${(store.promoMode === 'discount' || store.promoMode === 'points') ? 'selected' : ''}>現金折抵 (滿 $${AI_DISCOUNT_MIN_SUBTOTAL} 立即現折)</option>
              </select>
            </div>

            <div>
              <label class="field-label">🏷️ 優惠顯示文案</label>
              <input type="text" id="cfgPromoText" class="select-input" value="${escapeHtml(store.promoText || '')}" placeholder="例：🎁 離峰分流招待：免費溫泉蛋乙顆">
            </div>

            <div>
              <label class="field-label">💸 現金折抵金額 (NT$)</label>
              <input type="number" id="cfgPromoDiscount" class="select-input" min="0" max="100" value="${store.promoDiscount || 0}">
            </div>
          </div>

          <button type="button" class="btn-primary-full" style="max-width:320px;" onclick="saveMerchantConfig()">💾 儲存營業狀態與分流優惠設定</button>
        </div>
      ` : ''}

      ${sub === 'storeProfile' ? `
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
            <div>
              <h3 style="font-size:1.05rem; font-weight:900;">🏪 編輯餐廳基本資料・代表圖示・營業時間與公休日（${escapeHtml(store.name)} / ${escapeHtml(store.id)}）</h3>
              <p style="font-size:0.78rem; color:var(--text-secondary);">支援動態修改店名、所屬校區、營業時間、午休時段與每週公休日，免改程式碼即可即時更新全站預訂時段！</p>
            </div>
            <button type="button" class="btn-danger-soft" onclick="deleteCurrentMerchantStore()">🗑️ 刪除此餐廳櫃位</button>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:16px;">
            <div>
              <label class="field-label">🏫 所屬校區 (可自由輸入新校區)</label>
              <input type="text" id="cfgProfileCampus" class="select-input" value="${escapeHtml(store.campus || '雙溪校區')}" placeholder="如：雙溪校區、城中校區">
            </div>
            <div>
              <label class="field-label">🏷️ 餐廳名稱 *</label>
              <input type="text" id="cfgProfileName" class="select-input" value="${escapeHtml(store.name || '')}" placeholder="如：趙班長海苔飯捲">
            </div>
            <div>
              <label class="field-label">🍜 餐點類型標語</label>
              <input type="text" id="cfgProfileCategory" class="select-input" value="${escapeHtml(store.category || '')}" placeholder="如：人氣韓式・飯捲">
            </div>
            <div>
              <label class="field-label">🎨 餐廳代表圖示 (Emoji 或圖片網址)</label>
              <input type="text" id="cfgProfileIcon" class="select-input" value="${escapeHtml(store.icon || STORE_ICONS[store.id] || '🍱')}" placeholder="如：🍙、🍱 或 https://...">
            </div>
            <div>
              <label class="field-label">🌅 每日開始營業時間</label>
              <input type="time" id="cfgProfileOpenTime" class="select-input" value="${escapeHtml(store.openTime || '10:30')}">
            </div>
            <div>
              <label class="field-label">🌙 每日結束營業時間</label>
              <input type="time" id="cfgProfileCloseTime" class="select-input" value="${escapeHtml(store.closeTime || '19:30')}">
            </div>
            <div>
              <label class="field-label">☕ 午休開始時間 (選填，無午休留空)</label>
              <input type="time" id="cfgProfileBreakStart" class="select-input" value="${escapeHtml(store.breakStartTime || '')}">
            </div>
            <div>
              <label class="field-label">🔔 午休結束時間 (選填)</label>
              <input type="time" id="cfgProfileBreakEnd" class="select-input" value="${escapeHtml(store.breakEndTime || '')}">
            </div>
            <div>
              <label class="field-label">🗓️ 每週固定公休日 (0=日,6=六，逗號分隔)</label>
              <input type="text" id="cfgProfileClosedDays" class="select-input" value="${escapeHtml(store.closedDays || '')}" placeholder="如：0,6 代表週六日公休">
            </div>
          </div>

          <button type="button" class="btn-primary-full" style="max-width:300px;" onclick="saveStoreProfileConfig()">💾 儲存餐廳資料與營業時段設定</button>
        </div>

        <div class="chart-card" style="background:#F8FAFC; border:1.5px dashed #94A3B8;">
          <h3 style="font-size:1.02rem; font-weight:900; margin-bottom:8px;">➕ 新增學餐合作餐廳櫃位（須設定獨立店務 PIN 碼）</h3>
          <div style="display:grid; grid-template-columns:1fr 1.2fr 1.1fr 0.6fr 1fr auto; gap:8px; align-items:end; flex-wrap:wrap;">
            <div>
              <label class="field-label">所屬校區 *</label>
              <input type="text" id="newStoreCampusInput" class="select-input" value="${escapeHtml(store.campus || '雙溪校區')}" placeholder="雙溪校區">
            </div>
            <div>
              <label class="field-label">新餐廳名稱 *</label>
              <input type="text" id="newStoreNameInput" class="select-input" placeholder="如：阿宏鐵板燒">
            </div>
            <div>
              <label class="field-label">分類說明</label>
              <input type="text" id="newStoreCatInput" class="select-input" placeholder="現炒鐵板・簡餐" value="人氣特餐・便當">
            </div>
            <div>
              <label class="field-label">圖示</label>
              <input type="text" id="newStoreIconInput" class="select-input" value="🍱" placeholder="🍱">
            </div>
            <div>
              <label class="field-label" style="color:var(--red);">🔒 專屬管理 PIN (4~8碼) *</label>
              <input type="password" id="newStorePinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="請設定4~8位數字" value="">
            </div>
            <button type="button" class="btn-tip-action" style="height:40px;" onclick="createNewMerchantStore()">＋ 建立新餐廳</button>
          </div>
        </div>
      ` : ''}

      ${sub === 'line' ? `
        <div class="chart-card" style="border:1.5px solid #86EFAC; background:#F0FDF4;">
          <h3 style="font-size:1.05rem; font-weight:900; color:#065F46; margin-bottom:6px;">
            💚 官方帳號 + 📧 電子信箱雙軌推播設定（${escapeHtml(store.name)}）
          </h3>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
            <label class="option-label-row ${store.useCustomLineOa ? 'checked' : ''}" style="background:#FFFFFF; margin-bottom:0;" onclick="toggleStoreCustomLineMode(true)">
              <div style="display:flex; align-items:center; gap:10px;">
                <input type="radio" name="storeLineOaMode" ${store.useCustomLineOa ? 'checked' : ''} style="width:18px; height:18px; accent-color:#06C755;">
                <div>
                  <div style="font-weight:900; color:var(--text-primary);">🏪 綁定「${escapeHtml(store.name)}」專屬官方帳號</div>
                  <div style="font-size:0.74rem; color:var(--text-secondary);">各店獨立計算每月免費推播額度</div>
                </div>
              </div>
            </label>

            <label class="option-label-row ${!store.useCustomLineOa ? 'checked' : ''}" style="background:#FFFFFF; margin-bottom:0;" onclick="toggleStoreCustomLineMode(false)">
              <div style="display:flex; align-items:center; gap:10px;">
                <input type="radio" name="storeLineOaMode" ${!store.useCustomLineOa ? 'checked' : ''} style="width:18px; height:18px; accent-color:#06C755;">
                <div>
                  <div style="font-weight:900; color:var(--text-primary);">🏆 使用平台預設官方帳號 (2012260287)</div>
                  <div style="font-size:0.74rem; color:var(--text-secondary);">免設定即可推播，並自動啟用電子信箱備援通知</div>
                </div>
              </div>
            </label>
          </div>

          ${store.useCustomLineOa ? `
            <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1px solid #86EFAC; margin-bottom:12px;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                  <label class="field-label">LINE 授權頻道編號</label>
                  <input type="text" id="cfgStoreLineClientId" class="select-input" placeholder="例如：2012260287" value="${escapeHtml(store.customLineClientId || '')}">
                </div>
                <div>
                  <label class="field-label">LINE 授權頻道密鑰</label>
                  <input type="password" id="cfgStoreLineClientSecret" class="select-input" placeholder="輸入新密鑰以更新後端設定" value="">
                </div>
              </div>
              <div>
                <label class="field-label">訊息推播存取權杖</label>
                <input type="password" id="cfgStoreLineChannelToken" class="select-input" placeholder="貼上本店推播權杖" value="">
              </div>
            </div>
          ` : `
            <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1px solid #A7F3D0; margin-bottom:12px;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                  <label class="field-label">預設授權頻道編號</label>
                  <input type="text" id="cfgSysLineClientId" class="select-input" placeholder="預設：2012260287" value="${escapeHtml(state.lineProfile.customClientId || DEFAULT_LINE_CLIENT_ID)}">
                </div>
                <div>
                  <label class="field-label">預設授權頻道密鑰</label>
                  <input type="password" id="cfgSysLineClientSecret" class="select-input" placeholder="由雲端伺服器安全託管">
                </div>
              </div>
              <div>
                <label class="field-label">預設訊息推播存取權杖</label>
                <input type="password" id="cfgLineAccessToken" class="select-input" placeholder="由雲端伺服器安全託管">
              </div>
            </div>
          `}

          <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1.5px solid #06C755; margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
              <div style="font-weight:900; font-size:0.88rem; color:#065F46;">
                💳 各店獨立 LINE Pay 商家金流串接設定（款項直接入「${escapeHtml(store.name)}」商店帳戶）
              </div>
              <span style="font-size:0.74rem; font-weight:800; background:#DCFCE7; color:#065F46; padding:2px 8px; border-radius:999px;">
                ${store.linePayChannelId ? `✅ 已綁定商店 Channel (${escapeHtml(store.linePayChannelId)})` : '⚡ 預設學餐專屬沙盒收銀台'}
              </span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 0.9fr; gap:10px;">
              <div>
                <label class="field-label">本店 LINE Pay Channel ID (商家金流代號)</label>
                <input type="text" id="cfgStoreLinePayChannelId" class="select-input" placeholder="如：1657000123 (留空使用各店獨立沙盒)" value="${escapeHtml(store.linePayChannelId || '')}">
              </div>
              <div>
                <label class="field-label">本店 LINE Pay Channel Secret Key</label>
                <input type="password" id="cfgStoreLinePayChannelSecret" class="select-input" placeholder="${store.hasLinePaySecret ? '已於雲端加密託管 (輸入可更新)' : '貼上商家金流 Secret Key'}" value="">
              </div>
              <div>
                <label class="field-label">金流環境模式 (Request ➔ Confirm)</label>
                <select id="cfgStoreLinePaySandbox" class="select-input">
                  <option value="true" ${store.linePaySandbox !== false ? 'selected' : ''}>🧪 Sandbox 測試環境 / 學餐模擬授權</option>
                  <option value="false" ${store.linePaySandbox === false ? 'selected' : ''}>🏦 Production 正式環境 (真實扣款 API V3)</option>
                </select>
              </div>
            </div>
          </div>

          <button type="button" class="btn-line" style="padding:11px 18px; font-size:0.88rem;" onclick="saveLineMessagingConfig()">
            💾 儲存本店 LINE Pay 商家金流與官方帳號推播設定
          </button>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
            <h3 style="font-size:1.02rem; font-weight:900;">🔒 店務 4 碼安全鎖・平板專屬店鋪綁定與閒置自動上鎖設定</h3>
            <span style="font-size:0.75rem; font-weight:800; color:var(--green); background:var(--green-bg); padding:3px 10px; border-radius:999px;">
              🛡️ 目前 Session 憑證有效（範圍: ${escapeHtml(state.merchantAuthorizedStoreScope)} ・ 剩餘約 ${remainMins} 分鐘）
            </span>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:14px; padding-bottom:14px; border-bottom:1px dashed var(--border);">
            <div>
              <label class="field-label">⏱️ POS 閒置自動上鎖時間</label>
              <select id="cfgAutoLockMinsSelect" class="select-input" onchange="updateMerchantAutoLockMinutes(this.value)">
                <option value="5" ${state.merchantAutoLockMinutes === 5 ? 'selected' : ''}>閒置 5 分鐘自動上鎖 (高安全性)</option>
                <option value="15" ${state.merchantAutoLockMinutes === 15 ? 'selected' : ''}>閒置 15 分鐘自動上鎖 (推薦標準)</option>
                <option value="30" ${state.merchantAutoLockMinutes === 30 ? 'selected' : ''}>閒置 30 分鐘自動上鎖</option>
                <option value="60" ${state.merchantAutoLockMinutes === 60 ? 'selected' : ''}>閒置 60 分鐘自動上鎖</option>
              </select>
            </div>
            <div>
              <label class="field-label">📌 此平板專屬店鋪鎖定模式</label>
              <button type="button" class="btn-outline" style="width:100%; height:40px; font-weight:900; border-color:${state.boundMerchantStoreId === store.id ? 'var(--green)' : 'var(--border)'}; color:${state.boundMerchantStoreId === store.id ? 'var(--green)' : 'var(--text-primary)'};" onclick="toggleBindDeviceToCurrentStore()">
                ${state.boundMerchantStoreId === store.id ? `✅ 已綁定為「${escapeHtml(store.name)}」專用機 (點此解除)` : `📌 將此平板綁定為「${escapeHtml(store.name)}」專用機`}
              </button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr auto; gap:10px; align-items:end; flex-wrap:wrap;">
            <div>
              <label class="field-label">輸入「${escapeHtml(store.name)}」目前舊授權碼 (4~8碼) *</label>
              <input type="password" id="cfgOldMerchantPinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="驗證本店舊密碼" value="">
            </div>
            <div>
              <label class="field-label">設定「${escapeHtml(store.name)}」新專屬授權碼 (4~8碼) *</label>
              <input type="password" id="cfgMerchantPinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="輸入新 4~8 位數字 (更新後預設 8888 立即失效)" value="">
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn-outline" style="height:40px;" onclick="saveNewMerchantPin()">💾 驗證並更新本店密碼</button>
              <button type="button" class="btn-danger-soft" style="height:40px;" onclick="lockMerchantSession()">🔒 立即上鎖</button>
            </div>
          </div>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3 style="font-size:0.98rem; font-weight:900;">🛡️ 店務敏感操作稽核紀錄（折讓、退單退款、改價、關班日結）</h3>
            <span style="font-size:0.74rem; color:var(--text-secondary);">最近 ${storeAuditLogs.length} 筆紀錄</span>
          </div>
          ${storeAuditLogs.length === 0 ? `
            <div style="font-size:0.82rem; color:var(--text-muted); padding:12px;">尚無敏感操作稽核紀錄</div>
          ` : `
            <div style="max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
              ${storeAuditLogs.map(log => `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 12px; background:#F8FAFC; border:1px solid var(--border); border-radius:8px; font-size:0.78rem;">
                  <div>
                    <strong style="color:var(--indigo);">[${escapeHtml(log.action)}]</strong>
                    <span style="color:var(--text-primary); margin-left:6px;">${escapeHtml(log.detail)}</span>
                  </div>
                  <span style="color:var(--text-muted); font-family:monospace; white-space:nowrap;">${escapeHtml(log.ts)}</span>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      ` : ''}
    </div>
  `;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(panel);
}

function updateMerchantAutoLockMinutes(val) {
  const mins = Math.max(1, parseInt(val || '15', 10) || 15);
  state.merchantAutoLockMinutes = mins;
  state.lastMerchantActivityTs = Date.now();
  try { localStorage.setItem('mealflow_auto_lock_mins', String(mins)); } catch (e) {}
  showToast(`🛡️ 已將 POS 閒置自動上鎖時間設為 ${mins} 分鐘！`);
}

function toggleBindDeviceToCurrentStore() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  if (state.boundMerchantStoreId === store.id) {
    state.boundMerchantStoreId = '';
    try { localStorage.removeItem('mealflow_bound_store_id'); } catch (e) {}
    showToast('🔓 已解除此平板的單一店鋪綁定');
  } else {
    state.boundMerchantStoreId = store.id;
    try {
      localStorage.setItem('mealflow_bound_store_id', store.id);
      localStorage.setItem('mealflow_last_merchant_store_id', store.id);
    } catch (e) {}
    showToast(`📌 已將此平板綁定為「${store.name}」專用收銀機！`);
  }
  renderMerchantSettingsPanel(store);
}

async function saveStoreProfileConfig() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const campus = document.getElementById('cfgProfileCampus')?.value.trim() || store.campus;
  const name = document.getElementById('cfgProfileName')?.value.trim() || '';
  const category = document.getElementById('cfgProfileCategory')?.value.trim() || store.category;
  const icon = document.getElementById('cfgProfileIcon')?.value.trim() || '🍱';
  const openTime = document.getElementById('cfgProfileOpenTime')?.value.trim() || '10:30';
  const closeTime = document.getElementById('cfgProfileCloseTime')?.value.trim() || '19:30';
  const breakStartTime = document.getElementById('cfgProfileBreakStart')?.value.trim() || '';
  const breakEndTime = document.getElementById('cfgProfileBreakEnd')?.value.trim() || '';
  const closedDays = document.getElementById('cfgProfileClosedDays')?.value.trim() || '';

  if (!name) {
    showToast('⚠️ 餐廳名稱不可為空！');
    return;
  }

  store.campus = campus;
  store.name = name;
  store.category = category;
  store.icon = icon;
  store.openTime = openTime;
  store.closeTime = closeTime;
  store.breakStartTime = breakStartTime;
  store.breakEndTime = breakEndTime;
  store.closedDays = closedDays;

  recordMerchantAuditLog('修改餐廳與營業時間設定', `${name} (${openTime}~${closeTime}${breakStartTime ? ` 午休:${breakStartTime}~${breakEndTime}` : ''})`);

  state.lastLocalStoreConfigUpdateTs = Date.now();
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveStoreProfile',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        campus,
        name,
        category,
        icon,
        openTime,
        closeTime,
        breakStartTime,
        breakEndTime,
        closedDays
      })
    });
    const data = await res.json();
    if (data && data.success) {
      showToast(`✅ 已更新「${name}」之餐廳名稱、圖示與營業時間並同步雲端！`);
    } else {
      showToast(`⚠️ 本機已更新，雲端回應：${(data && data.message) || '請確認後端已更新部署'}`);
    }
  } catch (e) {
    showToast('⚠️ 本機已儲存餐廳設定，待網路恢復後同步');
  }
}

async function createNewMerchantStore() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const campus = document.getElementById('newStoreCampusInput')?.value.trim() || '雙溪校區';
  const name = document.getElementById('newStoreNameInput')?.value.trim() || '';
  const category = document.getElementById('newStoreCatInput')?.value.trim() || '人氣特餐・便當';
  const icon = document.getElementById('newStoreIconInput')?.value.trim() || '🍱';
  const newStorePin = (document.getElementById('newStorePinInput')?.value || '').trim();

  if (!name) {
    showToast('⚠️ 請輸入新餐廳名稱！');
    return;
  }
  // #7：建立新店家強制設定該店專屬 4~8 位數 PIN 碼
  if (!/^\d{4,8}$/.test(newStorePin)) {
    showToast('⚠️ 請為新餐廳設定 4 至 8 位數字的專屬管理 PIN 碼！');
    document.getElementById('newStorePinInput')?.focus();
    return;
  }

  let maxNum = 0;
  state.stores.forEach(s => {
    const m = String(s.id || '').match(/^S(\d+)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const nextId = 'S' + String(maxNum + 1).padStart(2, '0');

  const newStoreObj = {
    id: nextId,
    campus,
    name,
    category,
    icon,
    openTime: '10:30',
    closeTime: '19:30',
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
  };

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'createStore',
        ...getMerchantAuthPayload(),
        campus,
        name,
        category,
        icon,
        newStorePin
      })
    });
    const data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.message) || '建立新餐廳失敗');
    }
    if (data.store && data.store.id) {
      newStoreObj.id = data.store.id;
    }
    state.stores.push(newStoreObj);
    state.merchantStoreId = newStoreObj.id;
    if (data.sessionToken) {
      const expiresAt = Number(data.expiresAt) || (Date.now() + 8 * 3600 * 1000);
      state.merchantAuthToken = data.sessionToken;
      state.merchantSessionExpiresAt = expiresAt;
      state.merchantAuthorizedStoreScope = newStoreObj.id;
      try {
        sessionStorage.setItem('mealflow_merchant_session_v13', data.sessionToken);
        sessionStorage.setItem('mealflow_merchant_exp_v13', String(expiresAt));
        sessionStorage.setItem('mealflow_merchant_scope_v13', newStoreObj.id);
      } catch (e) {}
    }
    state.lastLocalStoreConfigUpdateTs = Date.now();
    enrichStoresAndAi();
    saveLocalStores(state.stores);
    renderMerchantView();
    showToast(`🎉 已建立新餐廳「${name} (${newStoreObj.id})」並設定專屬 PIN 碼！`);
  } catch (e) {
    showToast(`❌ 建立新餐廳失敗：${e.message || '請檢查網路連線'}`);
  }
}

async function deleteCurrentMerchantStore() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  if (state.stores.length <= 1) {
    showToast('⚠️ 系統至少需保留一間餐廳，無法刪除最後一間！');
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const ok = await showAppConfirmModal({
    title: '刪除餐廳櫃位',
    message: `確定要永久刪除餐廳「${store.name} (${store.id})」嗎？此操作將從系統移除該餐廳櫃位。`,
    confirmText: '永久刪除餐廳',
    danger: true
  });
  if (!ok) {
    return;
  }

  const deletedId = store.id;
  state.stores = state.stores.filter(s => s.id !== deletedId);
  state.merchantStoreId = state.stores[0].id;
  state.lastLocalStoreConfigUpdateTs = Date.now();
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'deleteStore',
        ...getMerchantAuthPayload(),
        storeId: deletedId
      })
    });
    showToast(`🗑️ 已刪除餐廳「${store.name}」並同步雲端！`);
  } catch (e) {
    showToast(`🗑️ 已從本機移除餐廳「${store.name}」`);
  }
}

async function saveNewMerchantPin() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const oldVal = (document.getElementById('cfgOldMerchantPinInput')?.value || '').trim();
  const val = (document.getElementById('cfgMerchantPinInput')?.value || '').trim();
  if (!/^\d{4,8}$/.test(oldVal)) {
    showToast('⚠️ 請先輸入目前使用的舊 4～8 位數字授權碼以驗證身分！');
    return;
  }
  if (!/^\d{4,8}$/.test(val)) {
    showToast('⚠️ 新授權碼必須為 4 至 8 位數字！');
    return;
  }

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateMerchantPin',
        ...getMerchantAuthPayload(),
        storeId: state.merchantStoreId,
        oldPin: oldVal,
        newPin: val
      })
    });
    const data = await res.json();
    if (data && data.success && data.sessionToken) {
      const expiresAt = Number(data.expiresAt) || (Date.now() + 8 * 3600 * 1000);
      const scope = String(data.authorizedStoreId || state.merchantStoreId);
      state.merchantAuthToken = data.sessionToken;
      state.merchantSessionExpiresAt = expiresAt;
      state.merchantAuthorizedStoreScope = scope;
      try {
        sessionStorage.setItem('mealflow_merchant_session_v13', data.sessionToken);
        sessionStorage.setItem('mealflow_merchant_exp_v13', String(expiresAt));
        sessionStorage.setItem('mealflow_merchant_scope_v13', scope);
        localStorage.removeItem(`mealflow_offline_pin_digest_${state.merchantStoreId}`);
      } catch (e) {}
      const oldInp = document.getElementById('cfgOldMerchantPinInput');
      if (oldInp) oldInp.value = '';
      const inp = document.getElementById('cfgMerchantPinInput');
      if (inp) inp.value = '';
      showToast(`✅ 本店專屬授權碼已更新（預設 8888 已於本店失效）並換發新 Session 憑證！`);
    } else {
      showToast(`⚠️ 更新失敗：${(data && data.message) || '請確認舊授權碼是否正確'}`);
    }
  } catch (e) {
    showToast('⚠️ 無法連線至雲端伺服器更新授權碼');
  }
}

// ==================== 6.5 菜單辨識、穩定品項 ID 保護與進階餐點編輯器 ====================
function addManualMenuItem() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const cat = document.getElementById('newMenuCat')?.value.trim() || '主廚推薦';
  const name = document.getElementById('newMenuName')?.value.trim();
  const price = parseInt(document.getElementById('newMenuPrice')?.value, 10);
  const dailyLimit = Math.max(0, parseInt(document.getElementById('newMenuDailyLimit')?.value || '0', 10) || 0);
  const tag = document.getElementById('newMenuTag')?.value.trim() || '';
  const optsRaw = document.getElementById('newMenuOpts')?.value.trim();

  if (!name || isNaN(price) || price <= 0) {
    showToast('⚠️ 請輸入有效的餐點名稱與價格！');
    return;
  }

  const options = parseShorthandOptionsString(optsRaw);
  store.menus = store.menus || [];

  const existingIdx = store.menus.findIndex(m => String(m.name || '').trim() === name);
  const stableId = generateStableMenuItemId(store.id, name, store.menus);

  if (existingIdx > -1) {
    store.menus[existingIdx] = {
      ...store.menus[existingIdx],
      id: stableId,
      category: cat,
      name,
      price,
      dailyLimit,
      tag: tag || store.menus[existingIdx].tag,
      options: Object.keys(options).length > 0 ? options : store.menus[existingIdx].options
    };
  } else {
    store.menus.push({
      id: stableId,
      storeId: store.id,
      category: cat,
      name,
      price,
      dailyLimit,
      remainingToday: dailyLimit > 0 ? dailyLimit : null,
      tag,
      soldOut: false,
      options
    });
  }

  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  const targetSavedItem = existingIdx > -1 ? store.menus[existingIdx] : store.menus[store.menus.length - 1];
  // #34 改用單一品項原子更新 (upsertSingleMenuItem)，避免兩台裝置同時改菜單時整份陣列互相覆蓋
  syncSingleMenuItemToCloud(store, targetSavedItem);
  recordMerchantAuditLog(existingIdx > -1 ? '更新菜單品項' : '新增菜單品項', `${name} (NT$${price} / ID:${stableId})`);
  renderMerchantSettingsPanel(store);
  showToast(`✅ 已儲存餐點：${name} (NT$${price} / ID:${stableId})`);
}

function parseShorthandOptionsString(optsRaw) {
  const options = {};
  if (!optsRaw) return options;
  const groups = String(optsRaw).split(/[;；]/).map(s => s.trim()).filter(Boolean);
  groups.forEach((grpStr, idx) => {
    let groupTitle = idx === 0 ? '客製化選項' : `選項群組 ${idx + 1}`;
    let choicesBody = grpStr;
    let isRadio = false;
    if (grpStr.includes(':')) {
      const parts = grpStr.split(':');
      groupTitle = parts[0].trim();
      choicesBody = parts.slice(1).join(':').trim();
    }
    if (groupTitle.includes('份量') || groupTitle.includes('辣') || groupTitle.includes('冰') || groupTitle.includes('甜')) {
      isRadio = true;
    }
    const choices = choicesBody.split(/[,，/]/).map(s => s.trim()).filter(Boolean).map(tok => {
      const m = tok.match(/^(.+?)\+(\d+)$/);
      return m ? [m[1].trim(), Math.max(0, parseInt(m[2], 10))] : [tok, 0];
    });
    if (choices.length > 0) {
      options[groupTitle] = { type: isRadio ? 'radio' : 'checkbox', choices };
    }
  });
  return options;
}

function formatOptionsToShorthand(optionsObj) {
  if (!optionsObj || typeof optionsObj !== 'object') return '';
  return Object.entries(optionsObj).map(([grpName, grp]) => {
    const arr = (grp && grp.choices) ? grp.choices : (Array.isArray(grp) ? grp : []);
    const cStr = arr.map(c => {
      const n = Array.isArray(c) ? c[0] : c;
      const p = Array.isArray(c) ? Math.max(0, Number(c[1]) || 0) : 0;
      return p > 0 ? `${n}+${p}` : n;
    }).join(', ');
    return `${grpName}: ${cStr}`;
  }).join(' ; ');
}

async function updateMenuItemPrice(idx, newPriceVal) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[idx]) return;
  const item = store.menus[idx];
  const oldPrice = Number(item.price) || 0;
  const p = parseInt(newPriceVal, 10);
  if (isNaN(p) || p < 0 || p === oldPrice) {
    renderMerchantSettingsPanel(store);
    return;
  }
  const ok = await showAppConfirmModal({
    title: '變更餐點單價',
    message: `確定要將「${item.name}」的價格由 NT$${oldPrice} 變更為 NT$${p} 嗎？`,
    confirmText: '確定改價'
  });
  if (!ok) {
    renderMerchantSettingsPanel(store);
    return;
  }
  item.price = p;
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  await syncSingleMenuItemToCloud(store, item);
  showToast(`💾 已更新「${item.name}」價格為 NT$${p}`);
}

async function deleteMenuItem(idx) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[idx]) return;
  const targetItem = store.menus[idx];
  const ok = await showAppConfirmModal({
    title: '刪除菜單品項',
    message: `確定要永久刪除「${targetItem.name} (NT$${targetItem.price})」嗎？`,
    confirmText: '確定刪除',
    danger: true
  });
  if (!ok) {
    return;
  }
  const removed = store.menus.splice(idx, 1)[0];
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  renderMerchantSettingsPanel(store);

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'deleteSingleMenuItem',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        menuId: removed.id
      })
    });
    const data = await res.json();
    if (data && String(data.message || '').includes('未知的操作請求')) {
      await syncStoreMenuToCloud(store);
    }
  } catch (e) {}
  showToast(`🗑️ 已刪除品項：${removed.name}`);
}

// #29 全店批次加料售罄切換（一鍵把所有含該加料選項的菜色同步設為售罄或恢復）
async function bulkToggleModifierChoiceSoldOut(choiceName) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !Array.isArray(store.menus)) return;
  const target = String(choiceName || '').trim();
  if (!target) return;

  let matchCount = 0;
  let soldOutCount = 0;
  store.menus.forEach(m => {
    Object.values(m.options || {}).forEach(grp => {
      (grp && Array.isArray(grp.choices) ? grp.choices : []).forEach(c => {
        if (String(Array.isArray(c) ? c[0] : c).trim() === target) {
          matchCount++;
          if (Array.isArray(c) && Boolean(c[2])) soldOutCount++;
        }
      });
    });
  });
  const nextSoldOut = soldOutCount < matchCount;
  const modifiedItems = [];
  store.menus.forEach(m => {
    let touched = false;
    Object.values(m.options || {}).forEach(grp => {
      if (!grp || !Array.isArray(grp.choices)) return;
      grp.choices = grp.choices.map(c => {
        const n = String(Array.isArray(c) ? c[0] : c).trim();
        const p = Array.isArray(c) ? Math.max(0, Number(c[1]) || 0) : 0;
        if (n === target) {
          touched = true;
          return nextSoldOut ? [n, p, true] : [n, p];
        }
        return c;
      });
    });
    if (touched) modifiedItems.push(m);
  });

  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  renderMerchantSettingsPanel(store);
  recordMerchantAuditLog('批次加料售罄切換', `${target} ➔ ${nextSoldOut ? '售罄' : '恢復供應'}（共 ${modifiedItems.length} 道餐點）`);
  showToast(nextSoldOut ? `🚫 已將全店 ${modifiedItems.length} 道餐點的「${target}」設為售罄！` : `✅ 已恢復全店 ${modifiedItems.length} 道餐點的「${target}」供應！`);

  for (const item of modifiedItems) {
    try { await syncSingleMenuItemToCloud(store, item); } catch (e) {}
  }
}

async function syncSingleMenuItemToCloud(store, item) {
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'upsertSingleMenuItem',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        item: item
      })
    });
    const data = await res.json();
    if (data && String(data.message || '').includes('未知的操作請求')) {
      await syncStoreMenuToCloud(store);
    }
  } catch (e) {}
}

function openMenuEditModal(menuIdx) {
  ensureSharedModalsMounted();
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[menuIdx]) return;

  state.editingMenuStoreIndex = menuIdx;
  const item = store.menus[menuIdx];

  const groupsList = [];
  Object.entries(item.options || {}).forEach(([gName, grp]) => {
    const choicesArr = (grp && grp.choices) ? grp.choices : [];
    const cText = choicesArr.map(c => {
      const n = Array.isArray(c) ? c[0] : c;
      const p = Array.isArray(c) ? Math.max(0, Number(c[1]) || 0) : 0;
      const so = Array.isArray(c) ? Boolean(c[2]) : false;
      const base = p > 0 ? `${n}+${p}` : n;
      return so ? `${base}[售罄]` : base;
    }).join(', ');
    groupsList.push({
      name: gName,
      type: (grp && grp.type === 'checkbox') ? 'checkbox' : 'radio',
      minSelect: Math.max(0, parseInt((grp && grp.minSelect) || 0, 10) || 0),
      maxSelect: Math.max(0, parseInt((grp && grp.maxSelect) || 0, 10) || 0),
      choicesText: cText
    });
  });
  state.editingMenuTempOptions = groupsList;

  renderMenuEditModalBody(item);
  document.getElementById('menuEditModal')?.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('menuEditModal'));
}

// #29 常用客製選項範本一鍵套用
function applyModifierPresetToModal(presetKey) {
  const snapshot = syncTempModalInputsBeforeRerender();
  let presetObj = {};
  if (presetKey === 'rice') presetObj = getStdRiceOptions();
  else if (presetKey === 'noodle') presetObj = getStdNoodleOptions();
  else if (presetKey === 'dumpling') presetObj = getDumplingSetOptions();
  else if (presetKey === 'drink') {
    presetObj = {
      '甜度調整': { type: 'radio', choices: [['正常甜', 0], ['少糖', 0], ['微糖', 0], ['無糖', 0]] },
      '冰塊調整': { type: 'radio', choices: [['正常冰', 0], ['少冰', 0], ['微冰', 0], ['去冰', 0]] }
    };
  }
  Object.entries(presetObj).forEach(([gName, grp]) => {
    const choicesText = (grp.choices || []).map(c => {
      const n = Array.isArray(c) ? c[0] : c;
      const p = Array.isArray(c) ? Math.max(0, Number(c[1]) || 0) : 0;
      return p > 0 ? `${n}+${p}` : n;
    }).join(', ');
    state.editingMenuTempOptions.push({
      name: gName,
      type: grp.type === 'checkbox' ? 'checkbox' : 'radio',
      minSelect: 0,
      maxSelect: 0,
      choicesText
    });
  });
  renderMenuEditModalBody(snapshot);
  showToast('⚡ 已套用常用客製選項範本（可再微調或標記 [售罄]）');
}

function handleDishPhotoFileSelect(event) {
  const file = event && event.target && event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    showToast('⚠️ 請選擇圖片檔案 (JPG / PNG / WebP)');
    return;
  }
  const reader = new FileReader();
  reader.onload = function (ev) {
    const img = new Image();
    img.onload = function () {
      const maxDim = 480;
      let w = img.width || maxDim;
      let h = img.height || maxDim;
      if (w > maxDim || h > maxDim) {
        if (w >= h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      if (dataUrl.length > 42000) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.52);
      }
      const urlInput = document.getElementById('editMenuImage');
      if (urlInput) urlInput.value = dataUrl;
      updateEditMenuPhotoPreview(dataUrl);
      showToast(`📷 已壓縮並載入餐點實拍圖（${Math.round(dataUrl.length / 1024)} KB）`);
    };
    img.onerror = function () {
      showToast('⚠️ 圖片讀取失敗，請改用其他圖片或貼上網址');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function updateEditMenuPhotoPreview(imgSrc) {
  const prevBox = document.getElementById('editMenuImgPreview');
  if (!prevBox) return;
  const clean = String(imgSrc || '').trim();
  if (/^(https?:\/\/|data:image\/)/i.test(clean)) {
    prevBox.innerHTML = `<img src="${escapeHtml(clean)}" alt="" style="width:100%; height:100%; object-fit:cover;">`;
  } else {
    prevBox.innerHTML = `<span style="font-size:1.8rem;">🍽️</span>`;
  }
}

function clearEditMenuPhoto() {
  const urlInput = document.getElementById('editMenuImage');
  if (urlInput) urlInput.value = '';
  updateEditMenuPhotoPreview('');
}

function renderMenuEditModalBody(item) {
  const body = document.getElementById('menuEditModalBody');
  if (!body) return;
  const imgUrl = String(item.image || '').trim();
  const hasImg = /^(https?:\/\/|data:image\/)/i.test(imgUrl);

  body.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
      <div>
        <label class="field-label">🏷️ 餐點分類 *</label>
        <input type="text" id="editMenuCat" class="select-input" value="${escapeHtml(item.category || '主廚推薦')}">
      </div>
      <div>
        <label class="field-label">✨ 人氣/推薦標籤 (選填)</label>
        <input type="text" id="editMenuTag" class="select-input" placeholder="如：🔥 招牌必點" value="${escapeHtml(item.tag || '')}">
      </div>
    </div>

    <div style="display:grid; grid-template-columns:1.4fr 0.8fr 0.8fr; gap:10px; margin-bottom:10px;">
      <div>
        <label class="field-label">🍽️ 餐點名稱 * (ID: ${escapeHtml(item.id || '')})</label>
        <input type="text" id="editMenuName" class="select-input" value="${escapeHtml(item.name || '')}">
      </div>
      <div>
        <label class="field-label">💰 單價 ($) *</label>
        <input type="number" id="editMenuPrice" class="select-input" value="${Number(item.price) || 0}">
      </div>
      <div>
        <label class="field-label">📦 每日限量 (0=不限)</label>
        <input type="number" id="editMenuDailyLimit" class="select-input" min="0" value="${Number(item.dailyLimit) || 0}">
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <label class="field-label">🌐 英文 / 國際菜名 (選填，供外籍生切換英文/日韓介面顯示)</label>
      <input type="text" id="editMenuNameEn" class="select-input" placeholder="如：Spicy Kimchi Pork Kimbap" value="${escapeHtml(item.nameEn || '')}">
    </div>

    <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:12px; padding:10px; margin-bottom:14px;">
      <label class="field-label" style="margin-bottom:6px;">📷 餐點實拍照片（支援直接上傳壓縮或貼上圖片網址）</label>
      <div style="display:flex; align-items:center; gap:10px;">
        <div id="editMenuImgPreview" style="width:62px; height:62px; border-radius:12px; background:#FFF7ED; border:1px solid #FED7AA; overflow:hidden; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          ${hasImg ? `<img src="${escapeHtml(imgUrl)}" alt="" style="width:100%; height:100%; object-fit:cover;">` : `<span style="font-size:1.8rem;">🍽️</span>`}
        </div>
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:6px;">
          <input type="text" id="editMenuImage" class="select-input" style="padding:6px 9px; font-size:0.78rem;" placeholder="貼上 https:// 圖片網址或點擊下方上傳" value="${escapeHtml(imgUrl)}" oninput="updateEditMenuPhotoPreview(this.value)">
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <label class="filter-chip" style="padding:4px 10px; font-size:0.75rem; cursor:pointer; margin:0;">
              📷 上傳照片 (自動壓縮)
              <input type="file" accept="image/*" style="display:none;" onchange="handleDishPhotoFileSelect(event)">
            </label>
            <button type="button" class="btn-danger-soft" style="padding:4px 9px; font-size:0.74rem;" onclick="clearEditMenuPhoto()">🗑️ 移除照片</button>
          </div>
        </div>
      </div>
    </div>

    <div style="border-top:1px solid var(--border); padding-top:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
        <label class="field-label" style="margin:0; font-size:0.86rem; color:var(--indigo);">⚙️ 客製化選項群組設定 (${state.editingMenuTempOptions.length} 組・選項後加 [售罄] 可單獨停售加料)</label>
        <button type="button" class="filter-chip" style="padding:4px 10px; font-size:0.75rem;" onclick="addTempOptionGroupInModal()">＋ 新增選項群組</button>
      </div>

      <div style="display:flex; gap:5px; flex-wrap:wrap; margin-bottom:10px;">
        <span style="font-size:0.72rem; font-weight:800; color:var(--text-secondary); align-self:center;">⚡ 套用範本:</span>
        <button type="button" class="pos-chip-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="applyModifierPresetToModal('rice')">🍚 飯類標準</button>
        <button type="button" class="pos-chip-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="applyModifierPresetToModal('noodle')">🍜 麵類標準</button>
        <button type="button" class="pos-chip-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="applyModifierPresetToModal('drink')">🥤 飲品甜冰</button>
        <button type="button" class="pos-chip-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="applyModifierPresetToModal('dumpling')">🥟 鍋貼水餃</button>
      </div>

      <div id="editMenuOptionGroupsContainer" style="display:flex; flex-direction:column; gap:8px;">
        ${state.editingMenuTempOptions.length === 0 ? `
          <div style="text-align:center; padding:14px; background:#F8FAFC; border:1px dashed var(--border); border-radius:10px; font-size:0.8rem; color:var(--text-muted);">
            此餐點目前為單點無客製選項（可點擊上方範本一鍵套用）。
          </div>
        ` : state.editingMenuTempOptions.map((g, gIdx) => `
          <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:10px; padding:10px;">
            <div style="display:grid; grid-template-columns:1.1fr 0.85fr auto; gap:6px; margin-bottom:6px;">
              <input type="text" class="select-input" style="padding:6px 8px; font-size:0.8rem;" placeholder="群組名稱 (如: 主食份量)" value="${escapeHtml(g.name)}" oninput="state.editingMenuTempOptions[${gIdx}].name=this.value">
              <select class="select-input" style="padding:6px 8px; font-size:0.8rem;" onchange="state.editingMenuTempOptions[${gIdx}].type=this.value; renderMenuEditModalBody(syncTempModalInputsBeforeRerender());">
                <option value="radio" ${g.type === 'radio' ? 'selected' : ''}>必選單選</option>
                <option value="checkbox" ${g.type === 'checkbox' ? 'selected' : ''}>可多選加料</option>
              </select>
              <button type="button" class="btn-danger-soft" onclick="removeTempOptionGroupInModal(${gIdx})">刪</button>
            </div>
            ${g.type === 'checkbox' ? `
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
                <input type="number" min="0" class="select-input" style="padding:4px 8px; font-size:0.74rem;" placeholder="最少必選數 (0=選填)" value="${g.minSelect || 0}" oninput="state.editingMenuTempOptions[${gIdx}].minSelect=parseInt(this.value||'0',10)||0">
                <input type="number" min="0" class="select-input" style="padding:4px 8px; font-size:0.74rem;" placeholder="最多可選數 (0=不限)" value="${g.maxSelect || 0}" oninput="state.editingMenuTempOptions[${gIdx}].maxSelect=parseInt(this.value||'0',10)||0">
              </div>
            ` : ''}
            <input type="text" class="select-input" style="padding:6px 8px; font-size:0.8rem;" placeholder="逗號分隔，加價寫+數字、單品售罄加[售罄]（例：加起司+15, 加溫泉蛋+15[售罄]）" value="${escapeHtml(g.choicesText)}" oninput="state.editingMenuTempOptions[${gIdx}].choicesText=this.value">
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function syncTempModalInputsBeforeRerender() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  const orig = (store && store.menus && store.menus[state.editingMenuStoreIndex]) || {};
  return {
    id: orig.id || '',
    category: document.getElementById('editMenuCat')?.value || '主廚推薦',
    tag: document.getElementById('editMenuTag')?.value || '',
    name: document.getElementById('editMenuName')?.value || '',
    nameEn: document.getElementById('editMenuNameEn')?.value || '',
    image: document.getElementById('editMenuImage')?.value || '',
    price: parseInt(document.getElementById('editMenuPrice')?.value || '0', 10),
    dailyLimit: Math.max(0, parseInt(document.getElementById('editMenuDailyLimit')?.value || '0', 10) || 0)
  };
}

function addTempOptionGroupInModal() {
  const snapshot = syncTempModalInputsBeforeRerender();
  state.editingMenuTempOptions.push({
    name: '加料或辣度',
    type: 'checkbox',
    minSelect: 0,
    maxSelect: 0,
    choicesText: '加滷蛋+15, 加起司+15, 不要蔥'
  });
  renderMenuEditModalBody(snapshot);
}

function removeTempOptionGroupInModal(gIdx) {
  const snapshot = syncTempModalInputsBeforeRerender();
  state.editingMenuTempOptions.splice(gIdx, 1);
  renderMenuEditModalBody(snapshot);
}

function closeMenuEditModal() {
  document.getElementById('menuEditModal')?.classList.remove('open');
  state.editingMenuStoreIndex = -1;
}

function saveEditedMenuItem() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  const idx = state.editingMenuStoreIndex;
  if (!store || idx < 0 || !store.menus[idx]) return;

  const cat = document.getElementById('editMenuCat')?.value.trim() || '主廚推薦';
  const tag = document.getElementById('editMenuTag')?.value.trim() || '';
  const name = document.getElementById('editMenuName')?.value.trim();
  const nameEn = (document.getElementById('editMenuNameEn')?.value || '').trim().slice(0, 80);
  const rawImg = (document.getElementById('editMenuImage')?.value || '').trim();
  const cleanImg = /^(https?:\/\/|data:image\/)/i.test(rawImg) ? rawImg : '';
  const price = parseInt(document.getElementById('editMenuPrice')?.value || '0', 10);
  const dailyLimit = Math.max(0, parseInt(document.getElementById('editMenuDailyLimit')?.value || '0', 10) || 0);

  if (!name || isNaN(price) || price < 0) {
    showToast('⚠️ 請填寫有效的餐點名稱與價格！');
    return;
  }

  const newOptions = {};
  state.editingMenuTempOptions.forEach(g => {
    const gName = (g.name || '').trim();
    if (!gName) return;
    const choices = String(g.choicesText || '')
      .split(/[,，/]/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(rawTok => {
        const isSoldOut = /\[售罄\]|（售罄）|\(售罄\)/.test(rawTok);
        const tok = rawTok.replace(/\[售罄\]|（售罄）|\(售罄\)/g, '').trim();
        const m = tok.match(/^(.+?)\+(\d+)$/);
        const cName = m ? m[1].trim() : tok;
        const cPrice = m ? Math.max(0, parseInt(m[2], 10)) : 0;
        return isSoldOut ? [cName, cPrice, true] : [cName, cPrice];
      });
    if (choices.length > 0) {
      const grpObj = {
        type: g.type === 'checkbox' ? 'checkbox' : 'radio',
        choices
      };
      if (grpObj.type === 'checkbox') {
        if (Number(g.minSelect) > 0) grpObj.minSelect = Math.max(0, parseInt(g.minSelect, 10));
        if (Number(g.maxSelect) > 0) grpObj.maxSelect = Math.max(0, parseInt(g.maxSelect, 10));
      }
      newOptions[gName] = grpObj;
    }
  });

  store.menus[idx] = {
    ...store.menus[idx],
    id: store.menus[idx].id || generateStableMenuItemId(store.id, name, store.menus),
    category: cat,
    tag,
    name,
    nameEn,
    image: cleanImg,
    price,
    dailyLimit,
    remainingToday: dailyLimit > 0 ? Math.max(0, dailyLimit - (Number(store.menus[idx].soldToday) || 0)) : null,
    options: newOptions
  };

  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  // #34 改用單一品項原子更新 (upsertSingleMenuItem)，避免覆蓋其他店員剛修改的售罄或新增品項
  syncSingleMenuItemToCloud(store, store.menus[idx]);
  recordMerchantAuditLog('編輯菜單與客製選項', `${name} (NT$${price}${dailyLimit > 0 ? `・限量${dailyLimit}份` : ''} / ID:${store.menus[idx].id})`);
  closeMenuEditModal();
  renderMerchantSettingsPanel(store);
  showToast(`✅ 已更新「${name}」之完整餐點設定、限量庫存與客製選項！`);
}

async function syncStoreMenuToCloud(store) {
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveStoreMenu',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        menus: store.menus
      })
    });
  } catch (e) {}
}

function loadSampleMenuTextForAi() {
  const el = document.getElementById('aiMenuRawText');
  if (el) {
    el.value = `【主廚新上市】
炙燒起司牛五花丼 $145 (主食:正常/飯少, 加料:溫泉蛋+20/泡菜+25)
川味椒麻雞腿便當 $125 (辣度:小辣/中辣/大辣, 加料:加滷蛋+15)
【精選單點與湯品】
黃金炸豆腐 $45
鮮魚味噌湯 $35`;
  }
  runAiMenuRecognition();
}

function handleMenuImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const parts = String(dataUrl).split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const base64Data = parts[1];
    showToast('📸 已載入菜單照片，正在傳送至雲端進行多模態視覺辨識...');
    await runAiMenuRecognition(base64Data, mimeType);
  };
  reader.readAsDataURL(file);
}

async function runAiMenuRecognition(imageBase64 = null, mimeType = 'image/jpeg') {
  const rawText = document.getElementById('aiMenuRawText')?.value.trim() || '';
  const previewBox = document.getElementById('aiScannedPreviewArea');
  if (!previewBox) return;

  if (!rawText && !imageBase64) {
    showToast('⚠️ 請先上傳菜單照片或貼上菜單文字！');
    return;
  }

  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];

  previewBox.style.display = 'block';
  previewBox.innerHTML = `
    <div style="padding:14px; background:#FFFFFF; border-radius:12px; border:1px solid #C7D2FE; display:flex; align-items:center; gap:10px; font-weight:800; color:#4338CA;">
      <span class="sync-dot syncing" style="width:10px; height:10px;"></span>
      <span>🧠 正在呼叫雲端視覺辨識引擎解析菜單結構...</span>
    </div>
  `;

  let parsed = [];
  let usedEngine = '智慧語法解析引擎';

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'aiParseMenu',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        rawText: rawText,
        imageBase64: imageBase64 || '',
        imageMime: mimeType || 'image/jpeg'
      })
    });
    const data = await res.json();
    if (data && Array.isArray(data.parsedMenus) && data.parsedMenus.length > 0) {
      usedEngine = data.engine || '雲端多模態視覺引擎';
      parsed = data.parsedMenus.map(item => {
        const cleanName = String(item.name || '未命名餐點').trim();
        return {
          id: generateStableMenuItemId(store.id, cleanName, store.menus),
          selected: true,
          category: String(item.category || '掃描推薦'),
          name: cleanName,
          price: Number(item.price) || 100,
          tag: String(item.tag || '🔥 店長推薦'),
          optionsShorthand: formatOptionsToShorthand(item.options || {})
        };
      });
    }
  } catch (e) {}

  if (parsed.length === 0 && rawText) {
    let currentCat = '掃描推薦';
    const lines = rawText.split(/\r?\n/);
    lines.forEach(line => {
      const t = line.trim();
      if (!t) return;
      const catMatch = t.match(/^[【\[](.+?)[】\]]$/);
      if (catMatch) {
        currentCat = catMatch[1].trim();
        return;
      }
      const itemMatch = t.match(/^(.+?)\s*[\$＄]?\s*(\d{2,4})\s*(?:元)?(?:\s*[\(（](.+?)[\)）])?$/);
      if (itemMatch) {
        const name = itemMatch[1].replace(/^[-*•\d\.]+\s*/, '').trim();
        const price = parseInt(itemMatch[2], 10);
        const optStr = itemMatch[3] || '';
        parsed.push({
          id: generateStableMenuItemId(store.id, name, store.menus),
          selected: true,
          category: currentCat,
          name,
          price,
          tag: '🔥 新上市',
          optionsShorthand: optStr
        });
      }
    });
  }

  state.scannedMenuCandidates = parsed;

  if (parsed.length === 0) {
    previewBox.innerHTML = `
      <div style="background:#FEF2F2; border:1px solid #FECACA; color:var(--red); padding:12px; border-radius:10px; font-weight:800; font-size:0.84rem;">
        ⚠️ 無法從目前的圖片或文字中辨識出有效品項。請確認圖片清晰度，或於上方文字框輸入「品名 價格」格式。
      </div>
    `;
    return;
  }

  renderScannedCandidatesTable(usedEngine);
}

function renderScannedCandidatesTable(usedEngine = '智慧解析引擎') {
  const previewBox = document.getElementById('aiScannedPreviewArea');
  if (!previewBox) return;

  previewBox.innerHTML = `
    <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1.5px solid #C7D2FE;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <div style="font-weight:900; font-size:0.88rem; color:#312E81;">
          ✅ 透過【${escapeHtml(usedEngine)}】共辨識出 ${state.scannedMenuCandidates.length} 道餐點（可直接於表格內微調內容後匯入）：
        </div>
        <button type="button" class="btn-tip-action" style="background:#10B981; padding:8px 16px;" onclick="commitScannedMenusToStore()">
          📥 將勾選品項匯入本店菜單
        </button>
      </div>

      <div class="ai-scan-table-wrap">
        <table class="ai-scan-table">
          <thead>
            <tr>
              <th style="width:42px;">匯入</th>
              <th style="width:125px;">分類</th>
              <th>餐點名稱</th>
              <th style="width:85px;">單價($)</th>
              <th style="width:115px;">推薦標籤</th>
              <th>客製化選項 (逗號分隔，加價寫+數字)</th>
            </tr>
          </thead>
          <tbody>
            ${state.scannedMenuCandidates.map((c, idx) => `
              <tr>
                <td style="text-align:center;">
                  <input type="checkbox" ${c.selected ? 'checked' : ''} onchange="state.scannedMenuCandidates[${idx}].selected=this.checked" style="width:17px; height:17px; accent-color:#4F46E5;">
                </td>
                <td>
                  <input type="text" class="select-input" style="padding:5px 8px; font-size:0.8rem;" value="${escapeHtml(c.category)}" oninput="state.scannedMenuCandidates[${idx}].category=this.value">
                </td>
                <td>
                  <input type="text" class="select-input" style="padding:5px 8px; font-size:0.8rem; font-weight:800;" value="${escapeHtml(c.name)}" oninput="state.scannedMenuCandidates[${idx}].name=this.value">
                </td>
                <td>
                  <input type="number" class="select-input" style="padding:5px 8px; font-size:0.8rem; font-weight:900; color:var(--red);" value="${c.price}" oninput="state.scannedMenuCandidates[${idx}].price=parseInt(this.value||'0',10)">
                </td>
                <td>
                  <input type="text" class="select-input" style="padding:5px 8px; font-size:0.78rem;" value="${escapeHtml(c.tag || '')}" oninput="state.scannedMenuCandidates[${idx}].tag=this.value">
                </td>
                <td>
                  <input type="text" class="select-input" style="padding:5px 8px; font-size:0.78rem;" placeholder="如: 正常, 飯少, 加蛋+15" value="${escapeHtml(c.optionsShorthand || '')}" oninput="state.scannedMenuCandidates[${idx}].optionsShorthand=this.value">
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function commitScannedMenusToStore() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !state.scannedMenuCandidates.length) return;

  const selectedList = state.scannedMenuCandidates.filter(c => c.selected && c.name && c.price > 0);
  if (selectedList.length === 0) {
    showToast('⚠️ 請至少勾選一道有效餐點！');
    return;
  }

  store.menus = store.menus || [];
  selectedList.forEach(cand => {
    const cleanName = String(cand.name || '').trim();
    const parsedOptions = parseShorthandOptionsString(cand.optionsShorthand);
    const stableId = generateStableMenuItemId(store.id, cleanName, store.menus);
    const existing = store.menus.find(m => String(m.id) === stableId || String(m.name).trim() === cleanName);

    if (existing) {
      existing.id = existing.id || stableId;
      existing.price = cand.price;
      existing.category = cand.category;
      existing.tag = cand.tag || existing.tag;
      if (Object.keys(parsedOptions).length > 0) existing.options = parsedOptions;
    } else {
      store.menus.push({
        id: stableId,
        storeId: store.id,
        category: cand.category,
        name: cleanName,
        price: cand.price,
        tag: cand.tag || '🔥 店長推薦',
        soldOut: false,
        options: parsedOptions
      });
    }
  });

  state.scannedMenuCandidates = [];
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  renderMerchantSettingsPanel(store);
  showToast(`🎉 已成功匯入 ${selectedList.length} 道餐點（並保持穩定品項 ID）同步至雲端資料庫！`);
}

async function saveMerchantConfig() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const isOpenVal = document.getElementById('cfgStoreIsOpen')?.value;
  if (isOpenVal !== undefined) {
    store.isOpen = isOpenVal === 'true';
  }
  store.cutleryPrice = Math.max(0, parseInt(document.getElementById('cfgCutleryPrice')?.value || '1', 10));
  store.basePrepMinutes = Math.max(1, parseInt(document.getElementById('cfgBasePrepMin')?.value || '4', 10));
  store.maxCapacityPer15Min = Math.max(5, parseInt(document.getElementById('cfgMaxCap')?.value || '20', 10));
  store.reserveLeadMinutes = Math.max(10, Math.min(90, parseInt(document.getElementById('cfgReserveLeadMins')?.value || '25', 10) || 25));
  store.baseQueueOffset = 0;
  store.promoMode = document.getElementById('cfgPromoMode')?.value || 'none';
  store.promoText = document.getElementById('cfgPromoText')?.value.trim() || '';
  store.promoDiscount = Math.max(0, parseInt(document.getElementById('cfgPromoDiscount')?.value || '0', 10));

  state.lastLocalStoreConfigUpdateTs = Date.now();
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();
  showToast(`✅ 已儲存「${store.name}」設定（每 15 分上限 ${store.maxCapacityPer15Min} 份，預訂提前 ${store.reserveLeadMinutes} 分進廚房）！`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStoreConfig',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        isOpen: store.isOpen,
        cutleryPrice: store.cutleryPrice,
        basePrepMinutes: store.basePrepMinutes,
        maxCapacityPer15Min: store.maxCapacityPer15Min,
        reserveLeadMinutes: store.reserveLeadMinutes,
        baseQueueOffset: store.baseQueueOffset,
        activeOrders: store.activeOrders,
        promoMode: store.promoMode,
        promoText: store.promoText,
        promoDiscount: store.promoDiscount
      })
    });
  } catch (e) {}
}

async function triggerTrafficSimulation(mode = 'NORMAL') {
  showToast('🛡️ 正式營運環境已停用壓力模擬與假負載注入功能');
}

function toggleStoreCustomLineMode(useCustom) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  store.useCustomLineOa = Boolean(useCustom);
  saveLocalStores(state.stores);
  renderMerchantSettingsPanel(store);
}

async function saveLineMessagingConfig() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const linePayChannelId = document.getElementById('cfgStoreLinePayChannelId')?.value.trim() || '';
  const linePayChannelSecret = document.getElementById('cfgStoreLinePayChannelSecret')?.value.trim() || '';
  const linePaySandbox = document.getElementById('cfgStoreLinePaySandbox')?.value !== 'false';

  store.linePayChannelId = linePayChannelId;
  if (linePayChannelSecret) store.hasLinePaySecret = true;
  store.linePaySandbox = linePaySandbox;

  if (store.useCustomLineOa) {
    const clientId = document.getElementById('cfgStoreLineClientId')?.value.trim() || '';
    const clientSecret = document.getElementById('cfgStoreLineClientSecret')?.value.trim() || '';
    const channelToken = document.getElementById('cfgStoreLineChannelToken')?.value.trim() || '';

    store.customLineClientId = clientId;
    store.customLineClientSecret = '';
    store.customLineChannelToken = '';
    saveLocalStores(state.stores);
    recordMerchantAuditLog('更新本店金流與官方帳號設定', `LINE OA:${clientId || '未變更'} / LINE Pay Channel:${linePayChannelId || '預設沙盒'}`);
    showToast(`✅ 已儲存「${store.name}」專屬 LINE Pay 金流與官方帳號推播設定至雲端後台！`);
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveLineDevConfig',
          ...getMerchantAuthPayload(),
          storeId: store.id,
          useCustomLineOa: true,
          clientId,
          clientSecret,
          channelAccessToken: channelToken,
          linePayChannelId,
          linePayChannelSecret,
          linePaySandbox
        })
      });
    } catch (e) {}
  } else {
    const sysClientId = document.getElementById('cfgSysLineClientId')?.value.trim() || DEFAULT_LINE_CLIENT_ID;
    const sysClientSecret = document.getElementById('cfgSysLineClientSecret')?.value.trim() || '';
    const sysChannelToken = document.getElementById('cfgLineAccessToken')?.value.trim() || '';

    state.lineProfile.customClientId = sysClientId;
    state.lineProfile.channelAccessToken = '';
    try { localStorage.setItem('mealflow_system_line_client_id', sysClientId); } catch (e) {}
    saveLineProfile(state.lineProfile);
    store.useCustomLineOa = false;
    saveLocalStores(state.stores);
    recordMerchantAuditLog('更新本店 LINE Pay 金流與推播設定', `使用系統預設 OA / 本店 LINE Pay Channel:${linePayChannelId || '預設沙盒'}`);

    showToast(`✅ 已儲存「${store.name}」LINE Pay 商家金流與官方帳號推播設定！`);
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveLineDevConfig',
          ...getMerchantAuthPayload(),
          storeId: store.id,
          useCustomLineOa: false,
          systemClientId: sysClientId,
          systemClientSecret: sysClientSecret,
          systemChannelToken: sysChannelToken,
          linePayChannelId,
          linePayChannelSecret,
          linePaySandbox
        })
      });
    } catch (e) {}
  }
  renderMerchantSettingsPanel(store);
}