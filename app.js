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

const GAS_URL = (window.MEALFLOW_REALTIME_CONFIG && typeof window.MEALFLOW_REALTIME_CONFIG.resolveApiUrl === 'function')
  ? window.MEALFLOW_REALTIME_CONFIG.resolveApiUrl()
  : 'https://script.google.com/macros/s/AKfycbzN2e0bi-jQG5RvGBpZYu5190f2JfX-6P1C8DxUy2aPyrrpbJpBl0oaTwYFRhAyBl8/exec';
const DEFAULT_LINE_CLIENT_ID = localStorage.getItem('mealflow_system_line_client_id') || '2012260287';
const AI_DISCOUNT_MIN_SUBTOTAL = 60; // 離峰現金折抵最低消費門檻 (NT$ 60，不含免洗餐具費)
const LARGE_ORDER_DEPOSIT_THRESHOLD = 500; // 大額預訂團單門檻 (≥ NT$ 500 須線上支付或提前至櫃檯付訂確認)

// 四-1：商業級單一節流輪詢常數（啟用 Firestore 即時推播時，自動降速為 60 秒斷線保底）
const POLL_INTERVAL_ACTIVE_WATCH_MS = 12000;     // 學生有進行中訂單 / KDS / 叫號看板前景輪詢（GAS 模式）：12 秒
const POLL_INTERVAL_REALTIME_FALLBACK_MS = 60000; // 啟用 Firestore onSnapshot 即時監聽時之保底輪詢：60 秒
const POLL_INTERVAL_FOREGROUND_MS = 25000;       // 一般點餐頁瀏覽前景輪詢：25 秒
const POLL_INTERVAL_BACKGROUND_MS = 45000;       // 背景分頁輪詢上限（隱藏時優先交由 Web Push / SW 推播）
const POLL_MAX_BACKOFF_MS = 60000;               // 異常退避上限：60 秒

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
    id: 'S01', campus: '雙溪校區', name: '趙班長海苔飯捲', category: '人氣韓式・飯捲', visibleToStudents: true,
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
    id: 'S02', campus: '雙溪校區', name: '雙溪-丼物園', category: '日式蓋飯・烏龍麵', visibleToStudents: false,
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
    id: 'S03', campus: '雙溪校區', name: '雙溪-四海遊龍', category: '鍋貼水餃・麵食', visibleToStudents: false,
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
    id: 'S04', campus: '雙溪校區', name: '蒲家廚房', category: '中式特餐・便當', visibleToStudents: false,
    isOpen: true, maxCapacityPer15Min: 20, baseQueueOffset: 0, basePrepMinutes: 4, avgPrepMinutes: 4, cutleryPrice: 1,
    promoMode: 'discount', promoText: '💰 離峰分流折抵：現折 $10 元', promoDiscount: 10, predictedDailyOrders: 150, rating: 4.8,
    menus: [
      { id: 'M09', category: '人氣特餐便當', name: '秘製椒麻雞腿飯 (含3配菜)', price: 110, tag: '🔥 銷量冠軍', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M10', category: '人氣特餐便當', name: '蒜泥白肉精緻便當 (含3配菜)', price: 100, tag: '⚡ 極速便當', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M21', category: '單點小菜與湯品', name: '黃金脆皮炸豆腐', price: 40, tag: '✨ 招牌小菜', soldOut: false, image: '', options: {} }
    ]
  },
  {
    id: 'S05', campus: '城中校區', name: '城中-咖哩食堂', category: '熟成咖哩・炸物', visibleToStudents: false,
    isOpen: true, maxCapacityPer15Min: 15, baseQueueOffset: 0, basePrepMinutes: 5, avgPrepMinutes: 5, cutleryPrice: 1,
    promoMode: 'none', promoText: '無優惠', promoDiscount: 0, predictedDailyOrders: 195, rating: 4.8,
    menus: [
      { id: 'M11', category: '熟成濃咖哩', name: '唐揚炸雞熟成咖哩飯', price: 125, tag: '🔥 排隊人氣', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M12', category: '熟成濃咖哩', name: '手打漢堡排歐姆蛋咖哩', price: 135, tag: '⭐ 限量供應', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M26', category: '炸物點心', name: '酥炸莫札瑞拉起司條 (3入)', price: 50, tag: '🧀 邪惡點心', soldOut: false, image: '', options: {} }
    ]
  },
  {
    id: 'S06', campus: '城中校區', name: '城中-吳葉食堂', category: '精緻台式簡餐', visibleToStudents: false,
    isOpen: true, maxCapacityPer15Min: 20, baseQueueOffset: 0, basePrepMinutes: 6, avgPrepMinutes: 6, cutleryPrice: 1,
    promoMode: 'gift', promoText: '🎁 離峰分流招待：免費招牌冰紅茶', promoDiscount: 0, predictedDailyOrders: 145, rating: 4.9,
    menus: [
      { id: 'M13', category: '主廚鐵板與簡餐', name: '蔥爆牛肉鐵板簡餐', price: 115, tag: '🔥 現點現做', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M14', category: '主廚鐵板與簡餐', name: '古早味排骨特餐', price: 105, tag: '⚡ 4分極速取餐', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M15', category: '特色麵食', name: '手工鮮蝦紅油抄手麵', price: 90, tag: '⭐ 學生最愛', soldOut: false, image: '', options: getStdNoodleOptions() }
    ]
  },
  {
    id: 'S07', campus: '城中校區', name: '大熊涼麵 X 吃好食堂', category: '手工涼麵・味噌湯', visibleToStudents: false,
    isOpen: true, maxCapacityPer15Min: 25, baseQueueOffset: 0, basePrepMinutes: 2, avgPrepMinutes: 2, cutleryPrice: 1,
    promoMode: 'discount', promoText: '💰 離峰分流折抵：現折 $5 元', promoDiscount: 5, predictedDailyOrders: 160, rating: 4.7,
    menus: [
      { id: 'M16', category: '手工現拌涼麵', name: '川味麻辣雞絲涼麵 (大)', price: 75, tag: '⚡ 2分秒取', soldOut: false, image: '', options: getStdNoodleOptions() },
      { id: 'M17', category: '招牌味噌湯品', name: '綜合三合一味噌湯 (貢丸+蛋花)', price: 45, tag: '🔥 絕配湯品', soldOut: false, image: '', options: {} }
    ]
  }
];

// A1 / 三-4：台灣財政部 8 碼營利事業統一編號官方邏輯檢查碼驗證
function validateTaiwanTaxId(rawTaxId) {
  const s = String(rawTaxId || '').trim();
  if (!/^\d{8}$/.test(s)) return false;
  if (/^0{8}$/.test(s)) return false;
  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const p = parseInt(s[i], 10) * weights[i];
    sum += Math.floor(p / 10) + (p % 10);
  }
  if (sum % 5 === 0) return true;
  if (s[6] === '7' && ((sum + 1) % 5 === 0)) return true;
  return false;
}

// A7：取得目前開放於學生端顯示的餐廳清單（預設僅 S01 開放，餘於後台設定中自由勾選）
function getVisibleStudentStores() {
  const all = Array.isArray(state.stores) ? state.stores : [];
  const visible = all.filter(s => s && s.visibleToStudents !== false);
  return visible.length > 0 ? visible : all.slice(0, 1);
}

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

// B4 & B8：支援各星期彈性營業時間 (weeklyHours，例：週六提早打烊) 與每週公休日 (陣列或逗號字串皆相容)
function normalizeClosedDaysListClient(rawClosed) {
  if (rawClosed === undefined || rawClosed === null) return [];
  const rawArr = Array.isArray(rawClosed) ? rawClosed : String(rawClosed).split(/[,，、\s]+/);
  const dayZhMap = { '日': 0, '週日': 0, '一': 1, '週一': 1, '二': 2, '週二': 2, '三': 3, '週三': 3, '四': 4, '週四': 4, '五': 5, '週五': 5, '六': 6, '週六': 6 };
  const set = new Set();
  rawArr.forEach(tok => {
    const s = String(tok == null ? '' : tok).trim();
    if (!s) return;
    if (dayZhMap[s] !== undefined) { set.add(dayZhMap[s]); return; }
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 0 && n <= 6) set.add(n);
  });
  return Array.from(set).sort((a, b) => a - b);
}

function getStoreDaySchedule(store, dateOrDow) {
  const baseOpen = String((store && store.openTime) || '10:30').trim();
  const baseClose = String((store && store.closeTime) || '19:30').trim();
  if (!store) return { isClosed: false, closed: false, openTime: baseOpen, closeTime: baseClose, open: baseOpen, close: baseClose, dayOfWeek: 1 };
  let dayOfWeek;
  if (typeof dateOrDow === 'number' && Number.isInteger(dateOrDow) && dateOrDow >= 0 && dateOrDow <= 6) {
    dayOfWeek = dateOrDow;
  } else {
    const cleanDate = normalizeDateStr(dateOrDow || getTodayDateStr());
    const parts = cleanDate.split('-').map(Number);
    dayOfWeek = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]).getDay() : getTaipeiDateObj().getDay();
  }
  const closedArr = normalizeClosedDaysListClient(store.closedDays);
  const weekly = (store.weeklyHours && typeof store.weeklyHours === 'object') ? store.weeklyHours : {};
  const dayRule = weekly[String(dayOfWeek)] || weekly[dayOfWeek] || null;
  const isClosed = Boolean((dayRule && dayRule.closed) || closedArr.includes(dayOfWeek));
  const openTime = (dayRule && /^\d{1,2}:\d{2}$/.test(String(dayRule.open || ''))) ? String(dayRule.open).trim() : baseOpen;
  const closeTime = (dayRule && /^\d{1,2}:\d{2}$/.test(String(dayRule.close || ''))) ? String(dayRule.close).trim() : baseClose;
  return { isClosed, closed: isClosed, openTime, closeTime, open: openTime, close: closeTime, dayOfWeek };
}

function isStoreClosedOnDate(store, dateStr) {
  if (!store) return false;
  return getStoreDaySchedule(store, dateStr).isClosed;
}

/**
 * #21 & v24 完整營業時段、午休時段、公休日與「暫停營業禁止預訂」控制器：
 * - 暫停營業 (store.isOpen === false)：全面禁止「立即製作」與「預訂取餐」(canOrderNow: false, canPreOrder: false)
 * - 已打烊 / 尚未開門 / 午休 / 公休 (store.isOpen !== false)：禁止立即製作，但開放預訂未來營業時段 (canOrderNow: false, canPreOrder: true)
 */
function getStoreBusinessHoursStatus(store) {
  if (!store || store.isOpen === false) {
    return {
      canOrderNow: false,
      canPreOrder: false,
      reasonCode: 'MANUAL_CLOSED',
      statusLabel: t('本店目前暫停營業中（暫停點餐與預訂）', 'Temporarily paused (Ordering & pre-orders unavailable)', '現在営業休止中（注文・予約停止）', '임시 영업 중지 (주문 및 예약 불가)'),
      shortPillText: t('⛔ 暫停營業', '⛔ Paused', '⛔ 営業休止', '⛔ 영업 중지')
    };
  }
  const now = getTaipeiDateObj();
  const todayStr = getTodayDateStr();
  if (isStoreClosedOnDate(store, todayStr)) {
    return {
      canOrderNow: false,
      canPreOrder: true,
      reasonCode: 'CLOSED_DAY',
      statusLabel: t('今日為本店固定公休日，暫不提供立即製作（可預訂其他營業日）', 'Closed today for scheduled day off (Pre-order open)', '本日は定休日です（別日の予約可）', '오늘은 정기 휴무일입니다 (다른 날 예약 가능)'),
      shortPillText: t('🗓️ 今日公休 (可預訂)', '🗓️ Day Off (Pre-order)', '🗓️ 定休日 (予約可)', '🗓️ 휴무 (예약 가능)')
    };
  }
  const todaySched = getStoreDaySchedule(store, todayStr);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const openStr = todaySched.openTime;
  const closeStr = todaySched.closeTime;
  const openMins = parseTimeToMins(openStr, 10 * 60 + 30);
  const closeMins = parseTimeToMins(closeStr, 19 * 60 + 30);

  if (nowMins < openMins) {
    return {
      canOrderNow: false,
      canPreOrder: true,
      reasonCode: 'BEFORE_OPEN',
      statusLabel: t(`尚未開門（營業時間 ${openStr}~${closeStr}），歡迎先預訂今日取餐時段！`, `Opens at ${openStr} (Pre-order available)`, `${openStr}開店（予約受付中）`, `${openStr} 오픈 (예약 가능)`),
      shortPillText: t(`🌅 ${openStr} 開門 (可預訂)`, `🌅 Opens ${openStr} (Pre-order)`, `🌅 ${openStr}開店 (予約可)`, `🌅 ${openStr} 오픈`)
    };
  }
  if (nowMins > closeMins) {
    return {
      canOrderNow: false,
      canPreOrder: true,
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
        canPreOrder: true,
        reasonCode: 'ON_BREAK',
        statusLabel: t(`目前為午休備料時段（${breakStartStr}~${breakEndStr}），暫停立即製作，可預訂 ${breakEndStr} 後取餐！`, `Afternoon break (${breakStartStr}~${breakEndStr}), pre-order available!`, `休憩中（${breakStartStr}~${breakEndStr}）・予約受付中`, `브레이크 타임 (${breakStartStr}~${breakEndStr})・예약 가능`),
        shortPillText: t(`☕ 午休中 ${breakEndStr}開鍋 (可預訂)`, `☕ Break until ${breakEndStr}`, `☕ 休憩中 ${breakEndStr}再開`, `☕ 휴식 중 ${breakEndStr} 재개`)
      };
    }
  }

  return {
    canOrderNow: true,
    canPreOrder: true,
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
  const daySched = store ? getStoreDaySchedule(store, cleanDate) : { isClosed: false, openTime: '10:30', closeTime: '19:30' };
  if (daySched.isClosed) {
    return [];
  }

  const leadMins = store && store.reserveLeadMinutes ? Math.max(10, Number(store.reserveLeadMinutes)) : 25;
  const minAllowedMinutesOfDay = isToday ? (now.getHours() * 60 + now.getMinutes() + leadMins) : 0;
  const maxCap = store ? Math.max(5, Number(store.maxCapacityPer15Min) || 20) : 20;

  const openMins = parseTimeToMins(daySched.openTime, 10 * 60 + 30);
  const closeMins = parseTimeToMins(daySched.closeTime, 19 * 60 + 30);
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
      const isPeak = isPeakHourTimeSlot(timeLabel);
      result.push({
        time: timeLabel,
        booked: 0,
        maxCap,
        remaining: maxCap,
        isFull: false,
        isPeak
      });
    }
  }
  return result;
}

function getValidPickupTimeSlots(targetDateStr, storeId = null) {
  return getValidPickupTimeSlotsWithQuota(targetDateStr, storeId)
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

// B1：納入 category 分類雜湊，確保同店不同分類之同名餐點（如「酥炸類・雞米花」與「飯捲類・雞米花」）絕對獨立不互相覆蓋！
function generateStableMenuItemId(storeId, itemName, existingMenus = [], category = '') {
  const cleanName = String(itemName || '').trim();
  const cleanCat = String(category || '').trim();
  const cleanStore = String(storeId || 'S00').trim().toUpperCase();

  if (Array.isArray(existingMenus)) {
    const matched = cleanCat
      ? existingMenus.find(m => String(m.category || '').trim() === cleanCat && String(m.name || '').trim() === cleanName && m.id)
      : existingMenus.find(m => String(m.name || '').trim() === cleanName && m.id);
    if (matched) return String(matched.id);
  }

  let h = 2166136261;
  const raw = cleanCat ? `${cleanStore}::${cleanCat}::${cleanName}` : `${cleanStore}::${cleanName}`;
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

  // #40 & B1：完整保留歷史訂單成立當下的分類、單價、加購價與小計快照，絕不回頭查詢事後可能改價的菜單
  return {
    id: String(rawItem.id || 'M00'),
    category: String(rawItem.category || '').trim(),
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
      if (!state.xpMode && !state.xp2Mode && state.kdsSoundEnabled && acquireCrossTabSoundLock('AUTOFIRE_' + storeFired.map(x => x.orderId).join('_'), 10000)) {
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
      // A2：永遠不將 RESERVE 跨工作階段持久化，確保每次進入點餐都預設為「立即製作 (NOW)」
      checkoutTimeMode: 'NOW',
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

function makeShiftCompositeKey(dateStr, shiftSlot = 'FULL') {
  const cleanDate = normalizeDateStr(dateStr);
  const slot = String(shiftSlot || state?.activeShiftSlot || 'FULL').trim().toUpperCase();
  return `${cleanDate}_${slot}`;
}

function getShiftPettyCashEntries(storeId, dateStr, shiftSlot = null) {
  const cleanDate = normalizeDateStr(dateStr);
  const slot = String(shiftSlot || state?.activeShiftSlot || 'FULL').trim().toUpperCase();
  const compKey = `${cleanDate}_${slot}`;
  const mapObj = state.pettyCashMap && state.pettyCashMap[storeId];
  if (mapObj && Array.isArray(mapObj[compKey])) return mapObj[compKey];
  if (slot === 'FULL' && mapObj && Array.isArray(mapObj[cleanDate])) return mapObj[cleanDate];
  try {
    const raw = localStorage.getItem(`mealflow_petty_cash_${storeId}_${compKey}`) || (slot === 'FULL' ? localStorage.getItem(`mealflow_petty_cash_${storeId}_${cleanDate}`) : null);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function saveShiftPettyCashEntries(storeId, dateStr, entries, shiftSlot = null) {
  const cleanDate = normalizeDateStr(dateStr);
  const slot = String(shiftSlot || state?.activeShiftSlot || 'FULL').trim().toUpperCase();
  const compKey = `${cleanDate}_${slot}`;
  const safeList = Array.isArray(entries) ? entries.slice(0, 100) : [];
  if (!state.pettyCashMap) state.pettyCashMap = {};
  if (!state.pettyCashMap[storeId]) state.pettyCashMap[storeId] = {};
  state.pettyCashMap[storeId][compKey] = safeList;
  try {
    localStorage.setItem(`mealflow_petty_cash_${storeId}_${compKey}`, JSON.stringify(safeList));
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
        shiftSlot: slot,
        entries: safeList
      })
    }).catch(() => {});
  }
}

function getLockedShiftRecord(storeId, dateStr, shiftSlot = null) {
  const cleanDate = normalizeDateStr(dateStr);
  const slot = String(shiftSlot || state?.activeShiftSlot || 'FULL').trim().toUpperCase();
  const compKey = `${cleanDate}_${slot}`;
  const mapObj = state.lockedShiftsMap && state.lockedShiftsMap[storeId];
  if (mapObj && mapObj[compKey]) return mapObj[compKey];
  if (slot === 'FULL' && mapObj && mapObj[cleanDate]) return mapObj[cleanDate];
  try {
    const raw = localStorage.getItem(`mealflow_shift_locked_${storeId}_${compKey}`) || (slot === 'FULL' ? localStorage.getItem(`mealflow_shift_locked_${storeId}_${cleanDate}`) : null);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function getOpenedShiftRecord(storeId, dateStr, shiftSlot = null) {
  const cleanDate = normalizeDateStr(dateStr);
  const slot = String(shiftSlot || state?.activeShiftSlot || 'FULL').trim().toUpperCase();
  const compKey = `${cleanDate}_${slot}`;
  const mapObj = state.openShiftsMap && state.openShiftsMap[storeId];
  if (mapObj && mapObj[compKey]) return mapObj[compKey];
  if (slot === 'FULL' && mapObj && mapObj[cleanDate]) return mapObj[cleanDate];
  try {
    const raw = localStorage.getItem(`mealflow_shift_opened_${storeId}_${compKey}`) || (slot === 'FULL' ? localStorage.getItem(`mealflow_shift_opened_${storeId}_${cleanDate}`) : null);
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

// ==================== 後端簽發時效性 HMAC Session Token (含嚴格單一店家範圍檢查與開發者全店模式 #7, #8, #16, A8) ====================
function isMerchantSessionValidNow() {
  const token = state.merchantAuthToken || sessionStorage.getItem('mealflow_merchant_session_v13') || '';
  const exp = Number(state.merchantSessionExpiresAt || sessionStorage.getItem('mealflow_merchant_exp_v13') || 0);
  // #16：嚴格禁止 OFFLINE_ 本地偽造憑證繞過伺服器驗證
  if (!token || !token.includes('.') || token.startsWith('OFFLINE_') || exp <= Date.now()) {
    return false;
  }
  const role = String(state.merchantStaffRole || sessionStorage.getItem('mealflow_merchant_staff_role') || '').toUpperCase();
  const authorizedScope = state.merchantAuthorizedStoreScope || sessionStorage.getItem('mealflow_merchant_scope_v13') || '';
  // A8：系統開發者角色 (DEVELOPER) 持有後端簽發之 ALL 範圍憑證，可無縫切換全校各店維護
  if (role === 'DEVELOPER' && authorizedScope === 'ALL') {
    return true;
  }
  // #7 & #8：非開發者嚴格檢查當前選擇的店鋪必須與該 Session Token 授權的單一店鋪完全相符，禁止跨店免密碼切換！
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
    merchantAuthToken: state.merchantAuthToken || sessionStorage.getItem('mealflow_merchant_session_v13') || '',
    staffName: state.merchantStaffName || sessionStorage.getItem('mealflow_merchant_staff_name') || '',
    staffRole: state.merchantStaffRole || sessionStorage.getItem('mealflow_merchant_staff_role') || 'MANAGER'
  };
}

// 二-1 & A8：角色權限分級檢查（MANAGER 與 DEVELOPER 均具備最高管理權限）與店長 PIN 現場覆核彈窗
function isCurrentMerchantManager() {
  const role = String(state.merchantStaffRole || sessionStorage.getItem('mealflow_merchant_staff_role') || 'MANAGER').toUpperCase();
  return role === 'MANAGER' || role === 'DEVELOPER';
}

function isCurrentMerchantDeveloper() {
  const role = String(state.merchantStaffRole || sessionStorage.getItem('mealflow_merchant_staff_role') || '').toUpperCase();
  return role === 'DEVELOPER';
}

async function requestManagerPinOverride(actionLabel = '高風險店務操作', storeId = '') {
  if (isCurrentMerchantManager()) {
    return { managerOverridePin: '', approvedBy: state.merchantStaffName || '店長' };
  }
  const targetStoreId = storeId || state.merchantStoreId || 'S01';
  const pinVal = await showAppPromptModal({
    title: `🔐 店長權限覆核：${actionLabel}`,
    message: `目前以【收銀員：${state.merchantStaffName || '值班人員'}】身分操作，執行「${actionLabel}」須請店長輸入管理 PIN 碼覆核授權：`,
    placeholder: '請輸入店長 4~8 位數 PIN 碼',
    inputType: 'password',
    confirmText: '驗證並授權'
  });
  if (!pinVal || !String(pinVal).trim()) return null;
  const cleanPin = String(pinVal).trim();
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'verifyManagerOverride',
        ...getMerchantAuthPayload(),
        storeId: targetStoreId,
        managerOverridePin: cleanPin,
        actionLabel: actionLabel
      })
    });
    const data = await res.json();
    if (data && data.success && data.authorized) {
      showToast(`✅ 店長覆核授權通過 (${actionLabel})`);
      return { managerOverridePin: cleanPin, approvedBy: data.approvedBy || '店長覆核' };
    }
    showToast(`🚫 ${translateServerError((data && data.message) || '店長覆核 PIN 碼錯誤')}`);
    return null;
  } catch (e) {
    showToast('⚠️ 無法連線驗證店長覆核碼，請檢查網路狀態');
    return null;
  }
}

// 四-2：按需動態載入 merchant.js（學生點餐頁不下載，僅在需要店務或列印小票時載入）
let _merchantModuleLoadingPromise = null;
function ensureMerchantModuleLoaded() {
  if (typeof renderMerchantView === 'function') return Promise.resolve(true);
  if (_merchantModuleLoadingPromise) return _merchantModuleLoadingPromise;
  _merchantModuleLoadingPromise = new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false);
      return;
    }
    const script = document.createElement('script');
    const base = typeof getBaseRootUrl === 'function' ? getBaseRootUrl() : './';
    script.src = `${base}merchant.js?v=26.13`;
    script.async = false;
    script.onload = () => resolve(true);
    script.onerror = () => {
      _merchantModuleLoadingPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return _merchantModuleLoadingPromise;
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
  merchantStaffRole: sessionStorage.getItem('mealflow_merchant_staff_role') || 'MANAGER',
  merchantStaffName: sessionStorage.getItem('mealflow_merchant_staff_name') || '值班店長',
  pinSelectedStaffName: localStorage.getItem('mealflow_last_staff_name') || '',
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
  studentMenuSearchOpen: false,
  memberProfile: null,
  memberFavoriteDishes: [],
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
  // A2：預設永遠為「立即製作 (NOW)」，絕不從舊草稿還原成預訂點餐
  checkoutTimeMode: 'NOW',
  checkoutReserveDate: loadStudentCartDraft()?.checkoutReserveDate || getTodayDateStr(),
  checkoutReserveTime: loadStudentCartDraft()?.checkoutReserveTime || '12:15',
  checkoutPhone: localStorage.getItem('mealflow_saved_customer_phone_v12') || '',
  checkoutPayMethod: loadStudentCartDraft()?.checkoutPayMethod || 'LINE Pay',
  checkoutNote: loadStudentCartDraft()?.checkoutNote || '',
  checkoutFriedBagPref: '',
  checkoutTaxId: loadStudentCartDraft()?.checkoutTaxId || '',
  checkoutCouponCode: '',
  checkoutAppliedCoupon: null,
  checkoutAppendToOrderId: '',
  checkoutErrorBannerMsg: '',
  cartStep: 1,
  cartOpenNoteIdx: -1,
  cartShowExtras: false,
  pendingPaymentResolver: null,
  autoFetchedMissingOrderIds: {},
  fetchingOrderInFlightMap: {},

  // 選餐顧問多輪對話歷史
  aiChatMessages: [],

  // 店家全螢幕 POS 四大主導覽：'pos' | 'kds' | 'analytics' | 'settings'
  storeTabMode: 'pos',
  xpMode: false,
  xp2Mode: false,
  xpModeExited: false,
  xpDefaultCategoryAppliedForStore: '',
  xp2SelectedCartIdx: -1,
  xp2KeypadBuffer: '',
  xp2CatPage: 0,
  xp2DishPage: 0,
  xp2ModPage: 0,
  xp2CheckoutPayMethod: '現場現金',
  xp2TaxIdDraft: '',
  settingsSubTab: 'menu', // 'menu' | 'promo' | 'storeProfile' | 'line'
  merchantStoreId: localStorage.getItem('mealflow_bound_store_id') || localStorage.getItem('mealflow_last_merchant_store_id') || 'S01',
  kdsSoundEnabled: true,
  kdsAutoPrintNewOrder: Boolean(localStorage.getItem('mealflow_auto_print_new') === '1'),

  // 店家櫃檯 POS 狀態 (v25.0 快餐一鍵結帳、百分比折讓、服務費、無載具無桌號)
  posSelectedCategory: '全部',
  posQtyMultiplier: 1, // 二-4：點餐前預選份數乘數 (×1 / ×2 / ×3 / ×5)
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
  posFriedBagPref: '',
  posTaxId: '',
  posManualDiscount: 0,
  posDiscountPercent: 0,
  posServiceFeeRate: 0,
  posManualDiscountReason: '',
  posPayment: '現場現金',
  posCashReceived: '',
  posSplitCashAmount: '',
  posAutoShowReceiptModal: localStorage.getItem('mealflow_pos_auto_receipt') === '1',
  posFontSize: localStorage.getItem('mealflow_pos_font_size') || 'normal',
  posLastChangeBanner: null,
  posLinePayOneTimeKey: '',
  posLinePayManualConfirmed: false,
  posLinePayManualRef: '',

  // 班別交班日結狀態 (一-5 & 二-3 支援 CURRENT_OPEN / MORNING / EVENING / FULL)
  activeShiftSlot: localStorage.getItem('mealflow_active_shift_slot') || 'CURRENT_OPEN',
  shiftOpeningFloat: parseInt(localStorage.getItem('mealflow_shift_float') || '2000', 10) || 2000,
  shiftActualCountedCash: '',
  shiftCashierName: localStorage.getItem('mealflow_shift_cashier') || '',
  shiftZReportCloudData: null,

  // 訂單管理 (KDS) 分天檢視、分站過濾、智慧排序、改單與收款攔截狀態
  kdsSelectedDate: getTodayDateStr(),
  kdsStatusFilter: 'ALL',
  kdsStationFilter: 'ALL', // #12 廚房分站過濾：'ALL' | 'MAIN' | 'SIDE' | 'DRINK'
  kdsSortMode: 'FIFO',     // #31 KDS 排序模式：'FIFO' (最緊急/先下單優先) | 'NEWEST'
  kdsSearchQuery: '',
  kdsVerifyCodeInput: '',
  kdsExpandedMoreOrderId: '',
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

  // 營運分析時間維度與全區間後端統計 (二-5) + 按需歷史訂單區間快取
  analyticsPeriod: 'DAY',
  analyticsStartDate: getTodayDateStr(),
  analyticsEndDate: getTodayDateStr(),
  analyticsCloudData: null,
  analyticsRangeOrders: null,
  analyticsOrdersLoading: false,
  analyticsOrdersError: '',
  analyticsRangeReqSeq: 0,
  analyticsSelectedFilter: null,

  // 訂單管理 (KDS) 按需日期區間與雲端查單快取（預設 LIVE_TODAY 吃輕量 initBundle，按需才查 D1）
  kdsDateMode: 'LIVE_TODAY', // 'LIVE_TODAY' | 'FULL_TODAY' | 'DATE' | 'RANGE' | 'ALL_HISTORY'
  kdsStartDate: getTodayDateStr(),
  kdsEndDate: getTodayDateStr(),
  kdsRangeOrders: null,      // { storeId, mode, startDate, endDate, orders: [], truncated: false, loading: false, error: '', loadedAt: 0 }
  kdsRangeReqSeq: 0,
  kdsSearchOrders: null,     // { storeId, query, orders: [], loading: false, error: '' }
  kdsSearchReqSeq: 0,
  kdsSearchDebounceTimer: null,

  // 交班日結營業日選擇與雲端權威請求序號
  shiftReportDate: getTodayDateStr(),
  shiftZReportReqSeq: 0,

  // 店家菜單管理與視覺掃描狀態
  scannedMenuCandidates: [],
  editingMenuStoreIndex: -1,
  editingMenuTempOptions: [],
  batchApplyOptionsState: null,
  xpInlineModTargetCartIdx: -1,
  xpInlineModPreselect: {},

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
/**
 * 一-4：現場 POS 離線接單專屬編號區間（前綴 A001 起跳），與線上點餐（B001 起跳）完全物理隔離，
 * 即使斷網後補送雲端也絕不與線上單撞號或被迫改號！
 */
function generateMerchantPosOfflinePickupNumber(storeId, pickupDateStr) {
  const targetDate = normalizeDateStr(pickupDateStr);
  const storageKey = `mealflow_pos_seq_cycle_${storeId}_${targetDate}`;
  let curCount = 0;
  try {
    curCount = parseInt(localStorage.getItem(storageKey) || '0', 10) || 0;
  } catch (e) {}
  const nextNum = (curCount % 100) + 1;
  try {
    localStorage.setItem(storageKey, String(nextNum));
  } catch (e) {}
  return String(nextNum).padStart(3, '0');
}

function previewNextMerchantPosPickupNumber(storeId, pickupDateStr) {
  const targetDate = normalizeDateStr(pickupDateStr);
  const storageKey = `mealflow_pos_seq_cycle_${storeId}_${targetDate}`;
  let curCount = 0;
  try {
    curCount = parseInt(localStorage.getItem(storageKey) || '0', 10) || 0;
  } catch (e) {}
  const nextNum = (curCount % 100) + 1;
  return String(nextNum).padStart(3, '0');
}

function syncLocalSeqWithAuthoritativeNumber(storeId, pickupDateStr, authNumStr) {
  const targetDate = normalizeDateStr(pickupDateStr);
  const numVal = parseInt(String(authNumStr || '').replace(/\D/g, ''), 10);
  if (!isNaN(numVal) && numVal >= 1 && numVal <= 100) {
    const storageKey = `mealflow_pos_seq_cycle_${storeId}_${targetDate}`;
    try {
      localStorage.setItem(storageKey, String(numVal));
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
  const storeObj = state.stores.find(s => s.id === order.storeId);
  const storeAutoMins = storeObj ? Math.max(0, parseInt(storeObj.autoCompleteMinutes || 0, 10) || 0) : 0;
  if (lifecycleStatus === '製作中') {
    const maxCookMins = storeAutoMins > 0 ? Math.min(45, storeAutoMins) : 45;
    return getOrderElapsedMinutes(order) <= maxCookMins;
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
  else if (store.promoMode === 'second_discount') promoBonus = 88;
  const ratingScore = ((Number(store.rating) || 4.7) / 5.0) * 100;
  const raw = waitScore * 0.55 + promoBonus * 0.25 + ratingScore * 0.20;
  return Math.max(35, Math.min(99, Math.round(raw)));
}

// (I18N 核心已抽離至獨立模組 i18n.js — 四-2)
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
  let catStr = String(m.category || m.cat || '招牌主餐').replace(/\(八方計價模式\)|\(按顆計價\)/g, '').trim();
  const itemId = String(m.id || generateStableMenuItemId(storeIdStr, nameStr, [], catStr));
  let tagStr = String(m.tag || '').trim();
  let rawImg = String(m.image || '').trim();

  // 防護與修復舊版試算表欄位錯位 (例如 image 為 "true" / "false"、tag 為純數字出餐時間 "4"、category 為推薦標籤 "🔥 必點人氣")
  if (!/^(https?:\/\/|data:image\/)/i.test(rawImg)) {
    rawImg = '';
  }

  let defMatchedItem = null;
  for (const ds of DEFAULT_STORES) {
    const found = (ds.menus || []).find(dm => dm.id === itemId || (dm.category === catStr && dm.name === nameStr));
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

  const rawStation = String(m.station || opts.__station || 'AUTO').trim().toUpperCase();
  const rawTileColor = String(m.tileColor || opts.__tileColor || '').trim();
  const rawSortOrder = m.sortOrder !== undefined && m.sortOrder !== '' ? Number(m.sortOrder) : (opts.__sortOrder !== undefined ? Number(opts.__sortOrder) : 999);
  const rawDesc = String(m.description || opts.__description || '').trim();
  const rawDietary = Array.isArray(m.dietaryTags)
    ? m.dietaryTags
    : (Array.isArray(opts.__dietaryTags) ? opts.__dietaryTags : []);
  const rawSoldOutType = String(m.soldOutType || opts.__soldOutType || (m.soldOut ? 'TODAY' : 'NONE')).trim().toUpperCase();
  const rawSoldOutDate = String(m.soldOutDate || opts.__soldOutDate || '').trim();
  const rawSoldOutGroup = String(m.soldOutGroup || opts.__soldOutGroup || '').trim().slice(0, 40);
  delete opts.__station;
  delete opts.__tileColor;
  delete opts.__sortOrder;
  delete opts.__dailyLimit;
  delete opts.__nameEn;
  delete opts.__description;
  delete opts.__dietaryTags;
  delete opts.__soldOutType;
  delete opts.__soldOutDate;
  delete opts.__soldOutGroup;

  return {
    id: itemId,
    storeId: storeIdStr,
    category: catStr || '招牌主餐',
    name: nameStr,
    nameEn: String(m.nameEn || '').trim(),
    description: rawDesc,
    dietaryTags: rawDietary.map(x => String(x || '').trim().toUpperCase()).filter(Boolean),
    price: priceNum,
    tag: tagStr,
    station: rawStation || 'AUTO',
    tileColor: rawTileColor,
    sortOrder: Number.isFinite(rawSortOrder) ? rawSortOrder : 999,
    soldOutGroup: rawSoldOutGroup,
    soldOut: Boolean(m.soldOut),
    manualSoldOut: m.manualSoldOut !== undefined ? Boolean(m.manualSoldOut) : Boolean(m.soldOut && !m.dailyLimitSoldOut),
    soldOutType: m.soldOut ? (rawSoldOutType === 'PERMANENT' ? 'PERMANENT' : 'TODAY') : 'NONE',
    soldOutDate: m.soldOut ? rawSoldOutDate : '',
    needsMorningReview: Boolean(m.needsMorningReview),
    dailyLimitSoldOut: Boolean(m.dailyLimitSoldOut),
    dailyLimit: m.dailyLimit !== undefined && m.dailyLimit !== '' ? Math.max(0, parseInt(m.dailyLimit, 10) || 0) : 0,
    soldToday: m.soldToday !== undefined ? Number(m.soldToday) || 0 : 0,
    remainingToday: m.remainingToday !== undefined ? m.remainingToday : null,
    image: rawImg,
    options: opts
  };
}

// 全系統菜單統一排序：各分類內優先依價格由低到高，同價再依 sortOrder 與品名排序
function compareMenuItemsByPrice(a, b) {
  const pa = Number(a && a.price) || 0;
  const pb = Number(b && b.price) || 0;
  if (pa !== pb) return pa - pb;
  const sa = (a && a.sortOrder !== undefined && a.sortOrder !== '' && Number.isFinite(Number(a.sortOrder)))
    ? Number(a.sortOrder)
    : 999;
  const sb = (b && b.sortOrder !== undefined && b.sortOrder !== '' && Number.isFinite(Number(b.sortOrder)))
    ? Number(b.sortOrder)
    : 999;
  if (sa !== sb) return sa - sb;
  return String((a && a.name) || '').trim().localeCompare(String((b && b.name) || '').trim(), 'zh-Hant');
}

function sortMenusByCategoryPrice(menus, defaultCat = '主廚推薦') {
  if (!Array.isArray(menus) || menus.length <= 1) return Array.isArray(menus) ? menus.slice() : [];
  const catOrder = [];
  const byCat = {};
  for (let i = 0; i < menus.length; i++) {
    const m = menus[i];
    const cat = String((m && m.category) || defaultCat).trim() || defaultCat;
    if (!byCat[cat]) {
      byCat[cat] = [];
      catOrder.push(cat);
    }
    byCat[cat].push(m);
  }
  const result = [];
  for (let c = 0; c < catOrder.length; c++) {
    const group = byCat[catOrder[c]];
    group.sort(compareMenuItemsByPrice);
    for (let j = 0; j < group.length; j++) {
      result.push(group[j]);
    }
  }
  return result;
}

// 判斷購物車內是否含麵類（分類或品名含「麵」字）
function cartHasNoodleItems(cartItems, store) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return false;
  const menus = (store && Array.isArray(store.menus)) ? store.menus : [];
  for (let i = 0; i < cartItems.length; i++) {
    const it = cartItems[i];
    if (!it || it.isGift) continue;
    const matchedMenu = menus.find(m => String(m.id) === String(it.id));
    const cat = String(it.category || (matchedMenu && matchedMenu.category) || '');
    const nm = String(it.baseName || it.name || (matchedMenu && matchedMenu.name) || '');
    if (cat.includes('麵') || nm.includes('麵')) return true;
  }
  return false;
}

// 統計購物車內酥炸／炸物類總份數
function cartCountFriedItems(cartItems, store) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return 0;
  const menus = (store && Array.isArray(store.menus)) ? store.menus : [];
  let count = 0;
  for (let i = 0; i < cartItems.length; i++) {
    const it = cartItems[i];
    if (!it || it.isGift) continue;
    const matchedMenu = menus.find(m => String(m.id) === String(it.id));
    const cat = String(it.category || (matchedMenu && matchedMenu.category) || '');
    if (cat.includes('酥炸') || cat.includes('炸')) {
      count += Math.max(1, Number(it.qty) || 1);
    }
  }
  return count;
}

// 合併炸物分裝備註至訂單備註（不重複疊加）
function mergeFriedBagPrefIntoNote(rawNote, pref) {
  const cleanPref = String(pref || '').trim();
  const base = String(rawNote || '')
    .replace(/(?:^|[、，,／\/\s]+)炸物(?:裝一袋|分開裝)/g, '')
    .replace(/^炸物(?:裝一袋|分開裝)(?:[、，,／\/\s]+|$)/g, '')
    .trim();
  if (!cleanPref) return base;
  return base ? `${cleanPref}、${base}` : cleanPref;
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
  const visibleStores = getVisibleStudentStores();
  const campuses = Array.from(new Set(visibleStores.map(s => String(s.campus || '').trim()).filter(Boolean)));
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
    const normalizedMenus = sortMenusByCategoryPrice(rawMenus.map(m => normalizeMenuItem(m, s.id)));

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
      closedDays: normalizeClosedDaysListClient(s.closedDays),
      weeklyHours: (s.weeklyHours && typeof s.weeklyHours === 'object') ? s.weeklyHours : {},
      comboDiscounts: Array.isArray(s.comboDiscounts) ? s.comboDiscounts : [],
      morningSoldOutPolicy: String(s.morningSoldOutPolicy || 'ASK_MORNING').toUpperCase() === 'AUTO_RESTORE' ? 'AUTO_RESTORE' : 'ASK_MORNING',
      enableOnlineLinePay: s.enableOnlineLinePay === true,
      printerFrontCategories: Array.isArray(s.printerFrontCategories) && s.printerFrontCategories.length > 0 ? s.printerFrontCategories : ['飯捲類', '飲料類', '飲品類'],
      printerAutoEnabled: s.printerAutoEnabled !== false,
      printerBridgeKey: s.printerBridgeKey || '',
      autoCompleteMinutes: Math.max(0, Math.min(240, parseInt(s.autoCompleteMinutes || 0, 10) || 0)),
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
      canPreOrder: bizStatus.canPreOrder,
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
 * 三-2：彈性行銷優惠判定（支援 ALL_DAY 全天候活動 或 OFF_PEAK 離峰分流活動）
 */
function isStorePromoActive(store, isReserveMode = false, reserveTimeStr = '') {
  if (!store || store.isOpen === false || !store.promoMode || store.promoMode === 'none') {
    return false;
  }
  const scope = store.promoScope === 'ALL_DAY' ? 'ALL_DAY' : 'OFF_PEAK';
  if (scope === 'ALL_DAY') {
    return true;
  }
  if (store.loadState === 'FULL') return false;
  if (!isReserveMode && store.canOrderNow === false) return false;
  if (isReserveMode && isPeakHourTimeSlot(reserveTimeStr)) return false;
  return true;
}

// ==================== 震動、叮咚響鈴、語音播報、多分頁防重複響鈴與 Service Worker 系統通知（四-1：徹底移除劫持系統音訊之靜音 WAV 音軌與冗餘 Worker） ====================
let sharedAudioContext = null;
let screenWakeLockSentinel = null;
let merchantBroadcastChannel = null;

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

// 四-1：保留相容空殼函數，絕不建立靜音 <audio> 音軌或振盪器打斷學生 Spotify/YouTube/Podcast
function updateBackgroundSilentAudioKeepAlive() {}
function initBackgroundKeepAliveWorker() {}

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
  if (state.xpMode || state.xp2Mode) return;
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
  if (state.xpMode || state.xp2Mode) return;
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
  if (state.xpMode || state.xp2Mode) return;
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
  if (state.xpMode || state.xp2Mode) return;
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
  if (state.xpMode || state.xp2Mode) return;
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
  if (state.xpMode || state.xp2Mode) return;
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
      syncMemberProfileFromCloud(true);
      applyRouteView();
      showToast(`🎉 ${t(`LINE 綁定成功！歡迎 ${state.lineProfile.lineDisplayName}`, `LINE linked! Welcome ${state.lineProfile.lineDisplayName}`, `LINE連携完了！ようこそ ${state.lineProfile.lineDisplayName}`, `LINE 연동 완료! 환영합니다 ${state.lineProfile.lineDisplayName}`)}`);
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
  state.memberProfile = null;
  state.memberFavoriteDishes = [];
  saveLineProfile(state.lineProfile);
  closeLineBindModal();
  applyRouteView();
  showToast(t('已解除通知綁定', 'Notifications unlinked', '通知連携を解除しました', '알림 연동이 해제되었습니다'));
}

// 三-4：LINE 跨裝置會員同步（取回點數、歷史訂單、儲存手機/統編與常點餐點快速再點）
async function syncMemberProfileFromCloud(force = false) {
  const uid = String((state.lineProfile && state.lineProfile.lineUserId) || '').trim();
  if (!uid || !uid.startsWith('U')) return;
  if (state._memberSyncInFlight && !force) return;
  state._memberSyncInFlight = true;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getMemberProfile', lineUserId: uid })
    });
    const data = await res.json();
    if (data && data.success) {
      state.memberProfile = data.profile || null;
      state.memberFavoriteDishes = Array.isArray(data.favoriteDishes) ? data.favoriteDishes : [];
      if (data.profile) {
        if (data.profile.phone && !state.checkoutPhone) {
          state.checkoutPhone = data.profile.phone;
          state.savedCustomerPhone = data.profile.phone;
          try { localStorage.setItem('mealflow_saved_customer_phone_v12', data.profile.phone); } catch (e) {}
        }
        if (data.profile.taxId && !state.checkoutTaxId) {
          state.checkoutTaxId = data.profile.taxId;
        }
      }
      if (Array.isArray(data.memberOrders) && data.memberOrders.length > 0) {
        let added = 0;
        data.memberOrders.forEach(rawO => {
          const o = sanitizeIncomingOrder(rawO);
          if (!o || !o.orderId) return;
          addOrderToMyHistory(o.orderId);
          const idx = state.orders.findIndex(x => x.orderId === o.orderId);
          if (idx >= 0) state.orders[idx] = { ...state.orders[idx], ...o };
          else { state.orders.push(o); added++; }
        });
        if (added > 0) {
          saveCachedOrders(state.orders);
          updateHeaderMyOrdersBadge();
        }
      }
      if (state.routeMode === 'order' && state.selectedStoreId) {
        renderInStoreMenuCards();
      }
    }
  } catch (e) {} finally {
    state._memberSyncInFlight = false;
  }
}

async function saveMemberProfileToCloud() {
  const uid = String((state.lineProfile && state.lineProfile.lineUserId) || '').trim();
  if (!uid || !uid.startsWith('U')) return;
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveMemberProfile',
        lineUserId: uid,
        displayName: state.lineProfile.lineDisplayName || '',
        phone: state.checkoutPhone || state.savedCustomerPhone || '',
        taxId: state.checkoutTaxId || ''
      })
    });
  } catch (e) {}
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
            <span style="white-space:nowrap;">🛒 查看購物車</span>
            <span id="cartPreviewTotal" style="font-size:1.2rem; font-weight:900;">NT$ 0</span>
          </button>
        </div>
      </div>
    `);
  }

  if (!document.getElementById('cartModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cartModal" class="modal-overlay bottom-sheet" onclick="if(event.target===this) closeCartModal()">
        <div class="modal-card cart-modal-card">
          <div class="modal-header cart-modal-header">
            <div class="cart-header-top">
              <h2 id="cartModalTitle" class="cart-modal-title">🛒 確認餐點</h2>
              <button type="button" class="cart-close-btn" onclick="closeCartModal()" aria-label="關閉">✕</button>
            </div>
            <div class="cart-stepper" id="cartModalStepper"></div>
          </div>
          <div class="modal-body cart-modal-body" id="cartPageList"></div>
          <div class="modal-footer cart-modal-footer" id="cartModalFooter"></div>
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
              <h3 data-dish-name="1" style="font-size:1.2rem; font-weight:900;" id="optModalTitle">餐點名稱</h3>
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

  if (!document.getElementById('batchApplyOptionsModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="batchApplyOptionsModal" class="modal-overlay" style="z-index:1150;" onclick="if(event.target===this) closeBatchApplyOptionsModal()">
        <div class="modal-card" style="max-width:560px;">
          <div class="modal-header">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--indigo);">批次同步至 Cloudflare D1 菜單資料庫</span>
              <h3 style="font-size:1.15rem; font-weight:900;" id="batchApplyOptionsModalTitle">📋 批次套用客製化選項</h3>
            </div>
            <button type="button" onclick="closeBatchApplyOptionsModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="batchApplyOptionsModalBody"></div>
          <div class="modal-footer" id="batchApplyOptionsModalFooter" style="display:flex; gap:10px;">
            <button type="button" class="btn-outline" style="flex:1;" onclick="closeBatchApplyOptionsModal()">取消</button>
            <button type="button" id="batchApplyOptionsConfirmBtn" class="btn-tip-action" style="flex:2;" onclick="confirmBatchApplyMenuOptions()">🚀 批次套用並寫入雲端</button>
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
        <div class="modal-card" style="max-width:400px;">
          <div id="onlinePaymentHeader" class="payment-gateway-header linepay">
            <h3 style="font-size:1.12rem; font-weight:900; margin:0;" id="onlinePaymentTitle">💚 LINE Pay 付款</h3>
            <button type="button" onclick="cancelOnlinePaymentModal()" aria-label="關閉" style="border:none; background:rgba(255,255,255,0.22); color:#fff; width:32px; height:32px; border-radius:50%; font-weight:900; flex-shrink:0;">✕</button>
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
              <button type="button" class="filter-chip" style="font-size:0.78rem; padding:6px 11px;" onclick="askAiConciergePreset('FAST')">⚡ 10分鐘內快取</button>
              <button type="button" class="filter-chip" style="font-size:0.78rem; padding:6px 11px;" onclick="askAiConciergePreset('BUDGET')">💰 100元內超值</button>
              <button type="button" class="filter-chip" style="font-size:0.78rem; padding:6px 11px;" onclick="askAiConciergePreset('PROTEIN')">🥩 高蛋白大份量</button>
              <button type="button" class="filter-chip" style="font-size:0.78rem; padding:6px 11px;" onclick="askAiConciergePreset('SPICY')">🌶️ 辣味免排隊</button>
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
  const modal = document.getElementById('aiConciergeModal');
  modal?.classList.add('open');
  if (modal && state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
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
  const modal = document.getElementById('crossDeviceLookupModal');
  modal?.classList.add('open');
  if (modal && state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
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

function getXpUrlVersion() {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = String(params.get('xp') || '').trim();
    if (v === '1' || v === '2') return v;
  } catch (e) {}
  const search = window.location.search || '';
  if (/(?:^\?|&)xp=2(?:&|$)/.test(search)) return '2';
  if (/(?:^\?|&)xp=1(?:&|$)/.test(search)) return '1';
  return '';
}

function isXpUrlParamActive() {
  return getXpUrlVersion() === '1';
}

function isXp2UrlParamActive() {
  return getXpUrlVersion() === '2';
}

function ensureXpExitButton() {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('xpExitModeBtn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'xpExitModeBtn';
  btn.className = 'xp-exit-btn';
  btn.textContent = '退出滿版 / 回後台';
  btn.title = '退出 XP 滿版模式，返回後台查看日結與設定';
  btn.onclick = exitXpMode;
  document.body.appendChild(btn);
}

function exitXpMode() {
  state.xpMode = false;
  state.xp2Mode = false;
  state.xpModeExited = true;
  if (window._xp2ClockTimer) {
    try { clearInterval(window._xp2ClockTimer); } catch (e) {}
    window._xp2ClockTimer = null;
  }
  window._xp2RenderCache = null;
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.remove('xp-mode');
    document.body.classList.remove('xp2-mode');
  }
  updateBodyScrollLock();
  if (typeof renderMerchantView === 'function' && state.routeMode === 'store') {
    renderMerchantView();
  }
  if (typeof showToast === 'function') {
    showToast('已切換回一般版後台，可查看訂單、交班日結與設定');
  }
}

function detectRouteFromUrl() {
  const rawPath = window.location.pathname;
  const path = rawPath.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const forcedMode = window.MEALFLOW_DEFAULT_MODE || window.MEALFLOW_FORCED_ROUTE || params.get('mode');
  const orderToken = params.get('id') || params.get('order');
  const campusParam = params.get('campus');
  const tabParam = (params.get('tab') || '').toLowerCase();

  // 支援 ?store=S01、#S01、/store/S01 專屬門市直達路由（學餐僅分內用自取/外帶自取，已移除桌號概念）
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

  // XP 專屬純 POS 滿版模式：?xp=1（既有精簡滿版）與 ?xp=2（傳統 POS 復刻模式）
  const xpVer = getXpUrlVersion();
  if (state.routeMode === 'store' && xpVer === '2' && !state.xpModeExited) {
    state.xpMode = false;
    state.xp2Mode = true;
    state.storeTabMode = 'pos';
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('xp-mode');
      document.body.classList.add('xp2-mode');
    }
  } else if (state.routeMode === 'store' && xpVer === '1' && !state.xpModeExited) {
    state.xpMode = true;
    state.xp2Mode = false;
    state.storeTabMode = 'pos';
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('xp2-mode');
      document.body.classList.add('xp-mode');
      ensureXpExitButton();
    }
  } else if (state.routeMode !== 'store') {
    state.xpMode = false;
    state.xp2Mode = false;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('xp-mode');
      document.body.classList.remove('xp2-mode');
    }
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

function safeTranslateUiText(text) {
  try {
    if (typeof translateSystemText === 'function') return translateSystemText(text);
  } catch (e) {}
  return String(text == null ? '' : text);
}

function setSyncState(mode, text, detailTitle) {
  try {
    const dot = document.getElementById('syncDot');
    const label = document.getElementById('syncText');
    const pill = label ? label.closest('.sync-status') : null;
    if (dot) dot.className = 'sync-dot ' + (mode === 'syncing' ? 'syncing' : mode === 'offline' ? 'offline' : '');
    if (label) label.innerText = safeTranslateUiText(text);
    if (pill && detailTitle) pill.setAttribute('title', safeTranslateUiText(detailTitle));
  } catch (e) {}
}

let toastTimer = null;
function showToast(msg) {
  try {
    const tEl = document.getElementById('toast');
    if (!tEl) return;
    tEl.innerText = safeTranslateUiText(msg);
    tEl.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { tEl.style.display = 'none'; }, 3500);
  } catch (e) {}
}

// ==================== v24.0 全域按鈕即時觸控回饋與防連點轉圈反灰引擎 ====================
const __mfButtonBusyTimers = new WeakMap();
const __mfButtonOrigHtml = new WeakMap();
let __mfLastActiveClickBtn = null;
let __mfLastActiveClickTs = 0;
let __mfGlobalBtnFeedbackInitialized = false;

function isRapidTapButton(btn) {
  if (!btn || !btn.classList) return false;
  return btn.classList.contains('pos-dish-tile') ||
    btn.classList.contains('pos-numpad-key') ||
    btn.classList.contains('stepper-btn') ||
    btn.classList.contains('pos-mult-btn') ||
    btn.classList.contains('menu-cat-pill');
}

function setButtonBusy(btn, isBusy, busyLabel) {
  if (!btn || btn.nodeType !== 1) return;
  const prevTimer = __mfButtonBusyTimers.get(btn);
  if (prevTimer) {
    clearTimeout(prevTimer);
    __mfButtonBusyTimers.delete(btn);
  }
  if (isBusy) {
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.classList.add('mf-btn-busy');
    if ('disabled' in btn && !btn.disabled) {
      btn.dataset.mfAutoDisabled = '1';
      btn.disabled = true;
    }
    if (!__mfButtonOrigHtml.has(btn)) {
      __mfButtonOrigHtml.set(btn, btn.innerHTML);
    }
    if (busyLabel) {
      btn.innerHTML = `<span class="mf-btn-spinner" aria-hidden="true"></span><span>${escapeHtml(safeTranslateUiText(busyLabel))}</span>`;
    } else if (!btn.querySelector('.mf-btn-spinner')) {
      btn.insertAdjacentHTML('afterbegin', '<span class="mf-btn-spinner" aria-hidden="true"></span>');
    }
    // 最長 16 秒安全自動復原保護，絕不永久卡死任何按鈕
    const failSafe = setTimeout(() => setButtonBusy(btn, false), 16000);
    __mfButtonBusyTimers.set(btn, failSafe);
  } else {
    delete btn.dataset.busy;
    btn.classList.remove('mf-btn-busy');
    if (btn.dataset.mfAutoDisabled === '1') {
      delete btn.dataset.mfAutoDisabled;
      if ('disabled' in btn) btn.disabled = false;
    }
    if (__mfButtonOrigHtml.has(btn)) {
      if (btn.isConnected && btn.querySelector('.mf-btn-spinner')) {
        btn.innerHTML = __mfButtonOrigHtml.get(btn);
      }
      __mfButtonOrigHtml.delete(btn);
    } else {
      btn.querySelectorAll('.mf-btn-spinner').forEach(sp => sp.remove());
    }
  }
}

async function withButtonBusy(btn, asyncFn, busyLabel) {
  setButtonBusy(btn, true, busyLabel);
  try {
    return await asyncFn();
  } finally {
    setButtonBusy(btn, false);
  }
}

// B3 & B11：取得最近點擊之按鈕（供所有 async 儲存／結帳函式統一顯示即時轉圈反灰，且絕不在 capture 階段禁用按鈕導致 onclick 被取消！）
function getRecentClickedButton(explicitBtn) {
  if (explicitBtn && explicitBtn.nodeType === 1) return explicitBtn;
  if (__mfLastActiveClickBtn && __mfLastActiveClickBtn.isConnected && (Date.now() - __mfLastActiveClickTs) < 1200) {
    return __mfLastActiveClickBtn;
  }
  return null;
}

async function withActiveButtonBusy(arg1, arg2, arg3) {
  let asyncFn = null;
  let busyLabel = '';
  let explicitBtn = null;
  if (typeof arg1 === 'function') {
    asyncFn = arg1;
    busyLabel = arg2;
    explicitBtn = arg3 || null;
  } else {
    explicitBtn = arg1 || null;
    busyLabel = arg2;
    asyncFn = arg3;
  }
  if (typeof asyncFn !== 'function') return;
  const targetBtn = getRecentClickedButton(explicitBtn);
  if (!targetBtn) return await asyncFn();
  return await withButtonBusy(targetBtn, asyncFn, busyLabel);
}

function initGlobalButtonFeedbackEngine() {
  if (__mfGlobalBtnFeedbackInitialized || typeof document === 'undefined') return;
  __mfGlobalBtnFeedbackInitialized = true;

  // 1. 全域即時按壓觸感（每顆按鈕按下瞬間立即縮小變暗回饋）
  document.addEventListener('pointerdown', (evt) => {
    const btn = evt.target && evt.target.closest ? evt.target.closest('button, .sync-status, [role="button"]') : null;
    if (!btn || btn.disabled || btn.dataset.busy === '1') return;
    btn.classList.add('mf-btn-pressed');
    setTimeout(() => btn.classList.remove('mf-btn-pressed'), 180);
  }, { capture: true, passive: true });

  // 2. Capture 階段：僅負責「已忙碌按鈕防連點攔截」＋「記錄點擊按鈕」，絕對不在 capture 階段設 btn.disabled=true（否則瀏覽器會直接取消目標 onclick 執行！）
  document.addEventListener('click', (evt) => {
    const btn = evt.target && evt.target.closest ? evt.target.closest('button, .sync-status') : null;
    if (!btn) return;
    if (btn.dataset.busy === '1' || btn.classList.contains('mf-btn-busy')) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      return;
    }

    btn.classList.add('mf-btn-pressed');
    setTimeout(() => btn.classList.remove('mf-btn-pressed'), 220);

    if (isRapidTapButton(btn)) return;

    __mfLastActiveClickBtn = btn;
    __mfLastActiveClickTs = Date.now();
  }, true);

  // 3. Bubble 階段（於目標 onclick 已確實啟動之後才觸發）：若目標是未自行管理轉圈的 async 函式，自動補上即時轉圈視覺回饋
  document.addEventListener('click', (evt) => {
    const btn = evt.target && evt.target.closest ? evt.target.closest('button, .sync-status') : null;
    if (!btn || isRapidTapButton(btn)) return;
    if (btn.dataset.busy === '1' || btn.disabled) return;
    const onclickCode = btn.getAttribute ? (btn.getAttribute('onclick') || '') : '';
    const fnMatch = onclickCode.match(/\b([A-Za-z_$][\w$]*)\s*\(/);
    if (!fnMatch) return;
    const fnRef = window[fnMatch[1]];
    const isAsyncHandler = fnRef && fnRef.constructor && fnRef.constructor.name === 'AsyncFunction';
    if (isAsyncHandler) {
      setButtonBusy(btn, true);
      setTimeout(() => {
        if (btn.isConnected && btn.dataset.busy === '1') {
          setButtonBusy(btn, false);
        }
      }, 950);
    }
  }, false);
}

// B6：動態量測頂部 header 真實高度，讓學生端 sticky 分類標籤始終保有舒適留白，絕不緊貼或被遮擋
function syncStickyHeaderOffset() {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const header = document.querySelector('header.app-header');
    const h = header && header.offsetHeight ? Math.round(header.offsetHeight) : (window.innerWidth <= 640 ? 98 : 68);
    document.documentElement.style.setProperty('--app-header-h', `${h}px`);
  } catch (e) {}
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', syncStickyHeaderOffset);
}

function isUserEditingFormInput() {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
    if (active.type !== 'button' && active.type !== 'checkbox' && active.type !== 'radio') {
      return true;
    }
  }
  if (document.getElementById('menuEditModal')?.classList.contains('open')) return true;
  if (document.getElementById('batchApplyOptionsModal')?.classList.contains('open')) return true;
  if (document.getElementById('onlinePaymentModal')?.classList.contains('open')) return true;
  if (document.getElementById('orderPayModal')?.classList.contains('open')) return true;
  if (document.getElementById('posCashNumpadModal')?.classList.contains('open')) return true;
  if (document.getElementById('kdsQrScannerModal')?.classList.contains('open')) return true;
  return false;
}

// ==================== 四-1：單一智慧節流輪詢、背景休眠與網路恢復重連引擎 ====================
function scheduleAdaptiveCloudPoll() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.routeMode !== 'ticket' && state.routeMode !== 'store' && state.routeMode !== 'order' && state.routeMode !== 'board') {
    return;
  }
  // 四-1：頁面切入背景隱藏時暫停主執行緒輪詢（由 Service Worker 推播與回來時瞬間同步接手），徹底節電並降低 GAS 壓力
  if (document.visibilityState === 'hidden') {
    return;
  }

  let nextDelay;
  if (state.xpMode || state.xp2Mode) {
    nextDelay = 60000;
  } else {
    const isFastWatch = shouldKeepBackgroundRuntimeAwake();
    const hasActiveFirestoreWatch = Boolean(
      window.__mfRealtimeState &&
      (window.__mfRealtimeState.studentUnsub || window.__mfRealtimeState.merchantUnsub)
    );
    const baseDelay = hasActiveFirestoreWatch
      ? POLL_INTERVAL_REALTIME_FALLBACK_MS
      : (isFastWatch ? POLL_INTERVAL_ACTIVE_WATCH_MS : POLL_INTERVAL_FOREGROUND_MS);
    const backoffFactor = Math.pow(1.5, Math.min(4, state.pollFailureCount || 0));
    const jitter = Math.floor(Math.random() * 800);
    nextDelay = Math.min(POLL_MAX_BACKOFF_MS, Math.round(baseDelay * backoffFactor) + jitter);
  }

  state.pollTimer = setTimeout(async () => {
    if (document.visibilityState === 'hidden') return;
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
  const swPath = getBaseRootUrl() + 'sw.js?v=26.0';
  navigator.serviceWorker.register(swPath, { updateViaCache: 'none' }).then((reg) => {
    try { if (reg && typeof reg.update === 'function') reg.update(); } catch (e) {}
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
  initGlobalButtonFeedbackEngine();
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
  checkLinePayCallbackOnLoad();
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

function applyCloudBundle(data, fromBroadcast = false, forceApply = false) {
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
  const isRecentLocalStoreEdit = !forceApply && (nowTs - state.lastLocalStoreConfigUpdateTs) < 12000;

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
        closedDays: cloudStore.closedDays !== undefined ? normalizeClosedDaysListClient(cloudStore.closedDays) : (localMatch ? normalizeClosedDaysListClient(localMatch.closedDays) : []),
        weeklyHours: (cloudStore.weeklyHours && typeof cloudStore.weeklyHours === 'object') ? cloudStore.weeklyHours : (localMatch && localMatch.weeklyHours ? localMatch.weeklyHours : {}),
        comboDiscounts: Array.isArray(cloudStore.comboDiscounts) ? cloudStore.comboDiscounts : (localMatch && Array.isArray(localMatch.comboDiscounts) ? localMatch.comboDiscounts : []),
        morningSoldOutPolicy: cloudStore.morningSoldOutPolicy || (localMatch ? localMatch.morningSoldOutPolicy : 'ASK_MORNING') || 'ASK_MORNING',
        enableOnlineLinePay: cloudStore.enableOnlineLinePay !== undefined ? Boolean(cloudStore.enableOnlineLinePay) : Boolean(localMatch && localMatch.enableOnlineLinePay),
        printerFrontCategories: Array.isArray(cloudStore.printerFrontCategories) && cloudStore.printerFrontCategories.length > 0
          ? cloudStore.printerFrontCategories
          : (localMatch && Array.isArray(localMatch.printerFrontCategories) && localMatch.printerFrontCategories.length > 0 ? localMatch.printerFrontCategories : ['飯捲類', '飲料類', '飲品類']),
        printerAutoEnabled: cloudStore.printerAutoEnabled !== undefined ? Boolean(cloudStore.printerAutoEnabled) : (localMatch && localMatch.printerAutoEnabled !== undefined ? Boolean(localMatch.printerAutoEnabled) : true),
        printerBridgeKey: cloudStore.printerBridgeKey || (localMatch ? localMatch.printerBridgeKey : '') || '',
        autoCompleteMinutes: cloudStore.autoCompleteMinutes !== undefined
          ? Math.max(0, Math.min(240, parseInt(cloudStore.autoCompleteMinutes || 0, 10) || 0))
          : (localMatch && localMatch.autoCompleteMinutes !== undefined ? Math.max(0, Math.min(240, parseInt(localMatch.autoCompleteMinutes || 0, 10) || 0)) : 0),
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
        visibleToStudents: cloudStore.visibleToStudents !== undefined
          ? Boolean(cloudStore.visibleToStudents)
          : (localMatch && localMatch.visibleToStudents !== undefined ? Boolean(localMatch.visibleToStudents) : String(cloudStore.id) === 'S01'),
        staffAccounts: Array.isArray(cloudStore.staffAccounts) ? cloudStore.staffAccounts : (localMatch && Array.isArray(localMatch.staffAccounts) ? localMatch.staffAccounts : []),
        linePayFeeRate: cloudStore.linePayFeeRate !== undefined ? Number(cloudStore.linePayFeeRate) : (localMatch && localMatch.linePayFeeRate !== undefined ? Number(localMatch.linePayFeeRate) : 2.2),
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
    state.orders = newOrdersList;
    saveCachedOrders(state.orders);

    if (state.xpMode || state.xp2Mode) {
      newOrdersList.forEach(ord => state.knownStoreOrderIds.add(ord.orderId));
    } else if (state.routeMode === 'store' && state.isMerchantUnlocked) {
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

    checkAndAlertWatchedStudentOrders();
  }

  // #2：每次雲端資料同步後，若叫號看板彈窗開啟中或處於獨立看板路由，立即動態重繪看板
  if (typeof refreshCustomerPickupBoardIfOpen === 'function') {
    refreshCustomerPickupBoardIfOpen(true);
  }
  syncWatchedOrdersToServiceWorker(false);

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

function getStoreDataFingerprint(storeId) {
  const s = (state.stores || []).find(st => st.id === storeId);
  if (!s) return '';
  const mSig = (s.menus || []).map(m => `${m.id}:${m.name}:${m.price}:${m.soldOut ? 1 : 0}:${m.category}:${m.remainingToday}`).join('|');
  return `${s.name}|${s.isOpen}|${s.openTime}|${s.closeTime}|${s.promoMode}|${s.promoText}|${mSig}`;
}

async function fetchJsonWithTimeout(url, options, timeoutMs = 18000) {
  if (typeof AbortController === 'undefined') {
    const res = await fetch(url, options);
    return await res.json();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 四-1 & v24：高可靠雲端同步引擎（含 18s 逾時保護、手動強制穿透試算表快取、GET 備援與 POS 菜單即時更新）
async function syncCloud(showSuccessToast = false) {
  if (state.isSyncInFlight && !showSuccessToast) return;
  state.isSyncInFlight = true;

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const prevMerchantFp = (state.routeMode === 'store' && state.merchantStoreId)
    ? getStoreDataFingerprint(state.merchantStoreId)
    : '';

  try {
    setSyncState('syncing', t('同步中...', 'Syncing...', '同期中...', '동기화 중...'));

    const authPayload = (state.routeMode === 'store' && isMerchantSessionValidNow())
      ? { ...getMerchantAuthPayload(), storeId: state.merchantStoreId }
      : {};

    // 【最小權限原則】學生端主動帶入自己的 myOrderIds，讓後端只回傳該學生本人的訂單狀態
    const watchedIds = Array.from(new Set([state.trackingOrderId, state.myCreatedOrderId, ...state.myOrderHistoryIds].filter(Boolean))).slice(0, 30);

    let data = null;
    try {
      data = await fetchJsonWithTimeout(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'initBundle',
          campus: state.campus,
          myOrderIds: watchedIds,
          lineUserId: (state.lineProfile && state.lineProfile.lineUserId && String(state.lineProfile.lineUserId).startsWith('U')) ? state.lineProfile.lineUserId : '',
          clientDeviceId: state.clientDeviceId,
          forceRefresh: Boolean(showSuccessToast),
          ...authPayload
        })
      }, 18000);
    } catch (postErr) {
      // POST 逾時或跨網域異常時自動走 GET initBundle 唯讀備援通道
      const qs = new URLSearchParams({
        action: 'initBundle',
        campus: state.campus || '',
        myOrderIds: watchedIds.join(','),
        clientDeviceId: state.clientDeviceId || '',
        forceRefresh: showSuccessToast ? '1' : '0'
      });
      if (authPayload.merchantAuthToken) qs.set('merchantAuthToken', authPayload.merchantAuthToken);
      if (authPayload.storeId) qs.set('storeId', authPayload.storeId);
      data = await fetchJsonWithTimeout(`${GAS_URL}?${qs.toString()}`, { method: 'GET', mode: 'cors' }, 15000);
    }

    if (data && data.success) {
      state.pollFailureCount = 0;
      state.lastCloudSyncDoneTs = Date.now();
      applyCloudBundle(data, false, Boolean(showSuccessToast));

      const cloudOrdersArr = (data.bundle && Array.isArray(data.bundle.orders)) ? data.bundle.orders : (Array.isArray(data.orders) ? data.orders : []);

      // 若學生端有進行中待取餐訂單未出現在 initBundle，僅針對最多 4 筆活躍單做直接狀態查核
      await pollActiveWatchedOrdersDirectFallback(watchedIds, cloudOrdersArr);

      // 若在訂單憑證頁且本機仍無該筆訂單，透過 getOrder 單筆補抓
      if (state.routeMode === 'ticket' && state.trackingOrderId && !state.orders.some(o => o.orderId === state.trackingOrderId)) {
        await tryAutoFetchMissingOrderById(state.trackingOrderId, true);
      }

      enrichStoresAndAi();
      updateHeaderMyOrdersBadge();

      const nextMerchantFp = (state.routeMode === 'store' && state.merchantStoreId)
        ? getStoreDataFingerprint(state.merchantStoreId)
        : '';
      const merchantStoreChangedFromCloud = Boolean(prevMerchantFp && nextMerchantFp && prevMerchantFp !== nextMerchantFp);

      const editingNow = !showSuccessToast && isUserEditingFormInput();
      if (!editingNow) {
        if (state.routeMode === 'order') renderStudentOrderExperience();
        if (state.routeMode === 'ticket') renderSingleTicketView();
        if (state.routeMode === 'board' && typeof refreshCustomerPickupBoardIfOpen === 'function') refreshCustomerPickupBoardIfOpen(true);
        if (state.routeMode === 'store' && state.isMerchantUnlocked) {
          if ((state.storeTabMode === 'settings' || state.storeTabMode === 'pos') && !showSuccessToast && !merchantStoreChangedFromCloud) {
            updateMerchantHeaderBadgesOnly();
          } else if (typeof renderMerchantView === 'function') {
            renderMerchantView();
          }
        }
        if (!showSuccessToast) {
          window.scrollTo(scrollX, scrollY);
        }
      } else if (state.routeMode === 'store' && state.isMerchantUnlocked) {
        updateMerchantHeaderBadgesOnly();
      }

      const syncTimeLabel = getTaipeiTimeHHMMSS();
      setSyncState('online', t('已同步', 'Synced', '同期済', '동기화됨'), `${t('最後同步時間', 'Last synced', '最終同期', '마지막 동기화')}: ${syncTimeLabel}`);
      if (showSuccessToast) showToast(t('☁️ 已從試算表完成最新資料同步', '☁️ Synced latest data from cloud', '☁️ クラウドと同期しました', '☁️ 클라우드 최신 데이터 동기화 완료'));
    } else {
      state.pollFailureCount = Math.min(6, (state.pollFailureCount || 0) + 1);
      const errMsg = (data && data.message) ? translateServerError(data.message) : t('伺服器回應異常', 'Server error');
      setSyncState('offline', t('同步失敗(點此重試)', 'Sync Failed (Retry)', '同期失敗(再試行)', '동기화 실패(재시도)'), errMsg);
      if (showSuccessToast) showToast(`⚠️ ${errMsg}`);
    }
  } catch (e) {
    state.pollFailureCount = Math.min(6, (state.pollFailureCount || 0) + 1);
    setSyncState('offline', t('離線模式', 'Offline', 'オフライン', '오프라인'), String(e && e.message ? e.message : 'Network error'));
    if (showSuccessToast) showToast(t('⚠️ 無法連線至雲端試算表，請檢查網路後重試', '⚠️ Cannot reach cloud server. Please check connection.'));
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

function applyPosFontSizeClass() {
  const root = document.documentElement;
  if (!root) return;
  const validSizes = ['normal', 'large', 'xlarge'];
  const size = validSizes.includes(state.posFontSize) ? state.posFontSize : 'normal';
  root.classList.remove('pos-font-normal', 'pos-font-large', 'pos-font-xlarge');
  if (state.routeMode === 'store' && size !== 'normal') {
    root.classList.add(`pos-font-${size}`);
  }
}

function updateBodyScrollLock() {
  document.body.classList.remove('store-fullscreen');
  document.body.classList.toggle('store-mode-active', state.routeMode === 'store' || state.routeMode === 'board');
  document.body.classList.toggle('pos-no-scroll', state.routeMode === 'store' && state.isMerchantUnlocked && state.storeTabMode === 'pos');
  const isXpActive = Boolean(state.xpMode && state.routeMode === 'store');
  const isXp2Active = Boolean(state.xp2Mode && state.routeMode === 'store');
  document.body.classList.toggle('xp-mode', isXpActive);
  document.body.classList.toggle('xp2-mode', isXp2Active);
  if (isXpActive) ensureXpExitButton();
  applyPosFontSizeClass();
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
    countEl.innerText = activeCount > 0
      ? t(`${activeCount}進行中`, `${activeCount}`, `${activeCount}件`, `${activeCount}건`)
      : `${totalCount}`;
  } else {
    countEl.style.display = 'none';
  }
}

function applyRouteView() {
  ensureSharedModalsMounted();
  ensureHeaderExtraControls();
  syncHeaderLanguageControls();
  syncStickyHeaderOffset();
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

  // A7：若學生端目前僅開放 1 間餐廳（如預設僅 S01 趙班長海苔飯捲），掃碼直接進入該店點餐，免多點一層餐廳目錄！
  if (state.routeMode === 'order') {
    const visibleStores = getVisibleStudentStores();
    if (visibleStores.length === 1) {
      const onlyStore = visibleStores[0];
      if (state.selectedStoreId !== onlyStore.id) {
        state.selectedStoreId = onlyStore.id;
        state.campus = onlyStore.campus;
        state.cartItems = (state.cartByStoreMap && Array.isArray(state.cartByStoreMap[onlyStore.id])) ? state.cartByStoreMap[onlyStore.id] : state.cartItems;
        if (onlyStore.canOrderNow !== false) state.checkoutTimeMode = 'NOW';
      }
    } else if (state.selectedStoreId && !visibleStores.some(s => s.id === state.selectedStoreId)) {
      state.selectedStoreId = null;
    }
    if (state.lineProfile && state.lineProfile.lineUserId && String(state.lineProfile.lineUserId).startsWith('U') && !state._memberSyncedOnce) {
      state._memberSyncedOnce = true;
      syncMemberProfileFromCloud(false);
    }
  }

  const floatingCart = document.getElementById('floatingCartBar');
  if (floatingCart) {
    floatingCart.style.display = (state.routeMode === 'order' && state.selectedStoreId) ? 'block' : 'none';
  }

  const campusSwitcher = document.getElementById('headerCampusSwitcher');
  if (campusSwitcher) {
    const visibleStores = getVisibleStudentStores();
    const visibleCampuses = new Set(visibleStores.map(s => String(s.campus || '').trim()).filter(Boolean));
    const isLockedSingleStore = Boolean((state.urlLockedStoreId && state.selectedStoreId === state.urlLockedStoreId) || visibleStores.length <= 1);
    campusSwitcher.style.display = (state.routeMode === 'order' && !state.selectedStoreId && !isLockedSingleStore && visibleCampuses.size > 1) ? 'inline-flex' : 'none';
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
    ensureMerchantModuleLoaded().then(() => {
      if (typeof openCustomerPickupBoardModal === 'function') openCustomerPickupBoardModal(true);
    });
    requestMerchantWakeLock();
  }
  if (state.routeMode === 'store') {
    checkMerchantSecurityGate();
    ensureMerchantModuleLoaded().then(() => {
      if (typeof renderMerchantView === 'function') renderMerchantView();
    });
  }

  syncHeaderLanguageControls();
  if (state.lang && state.lang !== 'zh-TW') {
    applyDomSystemTranslation(document.body);
  }
  syncWatchedOrdersToServiceWorker(false);
  if (!state.xpMode && !state.xp2Mode && typeof syncMealFlowRealtimeSubscriptions === 'function') {
    syncMealFlowRealtimeSubscriptions();
  } else if (state.xpMode || state.xp2Mode) {
    if (typeof stopStudentOrderFirestoreWatch === 'function') stopStudentOrderFirestoreWatch();
    if (typeof stopMerchantLiveOrdersFirestoreWatch === 'function') stopMerchantLiveOrdersFirestoreWatch();
  }
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

  const comboMatch = tokenPart.match(/^([AB]?\d{3,5})[\s\-_,/]+(\d{3})$/);
  if (comboMatch) {
    tokenPart = comboMatch[1];
    last3Part = comboMatch[2];
  }

  const isFullOrderId = tokenPart.startsWith('ORD-') && tokenPart.length >= 10;
  const isSixCharHmacCode = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(tokenPart);
  const isFourDigitPickup = /^([AB]\d{3,4}|\d{3,5})$/.test(tokenPart);

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
        🔍 ${t('跨裝置安全找回訂單（輸入「6 碼防偽核銷碼」，或「4 碼取餐號 + 手機末 3 碼」）', 'Find order across devices (6-char code OR Pickup # + last 3 phone digits)', '他端末から注文照会（6桁認証コードまたは受取番号＋携帯下3桁）', '다른 기기 주문 찾기 (6자리 인증코드 또는 픽업번호+전화 뒤 3자리)')}
      </div>
      <div style="display:grid; grid-template-columns:1.3fr 0.9fr auto; gap:6px;">
        <input type="search" id="drawerOrderSearchInput" class="select-input" placeholder="${t('6碼防偽碼 或 4碼取餐號', '6-char Code or Pickup #', '6桁コードまたは受取番号', '6자리 코드 또는 픽업번호')}" value="${escapeHtml(state.studentLookupQuery)}" onkeydown="if(event.key==='Enter') searchOrderAcrossDevices()">
        <input type="tel" id="drawerOrderPhoneInput" maxlength="10" class="select-input" placeholder="${t('手機末3碼 (若用取餐號)', 'Last 3 phone digits', '携帯下3桁', '전화 뒤 3자리')}" value="${escapeHtml(state.studentLookupPhoneLast3 || extractPhoneLast3(state.savedCustomerPhone))}" onkeydown="if(event.key==='Enter') searchOrderAcrossDevices()">
        <button type="button" class="btn-tip-action" style="white-space:nowrap; padding:8px 14px;" onclick="searchOrderAcrossDevices()">${t('驗證找回', 'Find', '照会', '조회')}</button>
      </div>
    </div>
  `;

  if (list.length === 0) {
    body.innerHTML = searchBarHtml + `
      <div style="text-align:center; padding:36px 16px;">
        <div style="font-size:2.8rem; margin-bottom:8px;">🧾</div>
        <h4 style="font-size:1.05rem; font-weight:900; margin-bottom:6px;">${t('目前本機尚無進行中或歷史點餐紀錄', 'No orders on this device yet', 'この端末にはまだ注文履歴がありません', '이 기기에 아직 주문 내역이 없습니다')}</h4>
        <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:16px;">${t('若您剛才使用其他裝置或無痕視窗點餐，請在上方輸入「6 碼防偽核銷碼」或「取餐號 + 手機末 3 碼」安全找回！', 'Ordered on another device? Enter your 6-char verification code above to recover your ticket.', '別端末で注文した場合は上の検索欄から6桁認証コードで照会できます。', '다른 기기에서 주문한 경우 위에서 6자리 인증코드로 조회하세요.')}</p>
        <button type="button" class="btn-tip-action" onclick="closeMyOrdersDrawer()">${t('前往挑選餐點', 'Browse Menu', 'メニューを見る', '메뉴 보러 가기')}</button>
      </div>
    `;
  } else {
    body.innerHTML = searchBarHtml + list.map(o => {
      const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
      const itemStr = items.map(i => `${trDishName(i)} ×${i.qty || 1}`).join('、');
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
              <span style="font-weight:900; font-size:0.95rem;">${escapeHtml(trTerm(o.storeName))}</span>
              <span style="font-family:monospace; font-size:0.72rem; font-weight:900; background:#EEF2FF; color:#312E81; padding:2px 6px; border-radius:6px;">${t('核銷碼', 'Code', '認証', '코드')}:${escapeHtml(verDisplay)}</span>
            </div>
            <span style="font-size:0.74rem; font-weight:900; padding:3px 10px; border-radius:999px; background:${isCancelled ? '#FEE2E2' : isReady ? '#DCFCE7' : isCooking ? '#FEF3C7' : isScheduled ? '#DBEAFE' : '#E2E8F0'}; color:${isCancelled ? '#DC2626' : isReady ? '#047857' : isCooking ? '#B45309' : isScheduled ? '#1E40AF' : '#475569'};">
              ${isReady ? `🔔 ${t('可取餐！', 'Ready!', '受取可!', '픽업 가능!')}` : escapeHtml(trTerm(o.status))}
            </span>
          </div>
          <div data-dish-name="1" style="font-size:0.84rem; color:var(--text-primary); font-weight:700; margin-bottom:6px;">${escapeHtml(itemStr)}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.76rem; color:var(--text-secondary);">
            <span>⏰ ${escapeHtml(o.isReservation ? `${o.pickupDate} ${o.pickupTime}` : t('立即製作', 'Make Now', '今すぐ調理', '바로 조리'))} (${escapeHtml(trTerm(o.paymentMethod))})</span>
            <strong style="font-size:0.95rem; color:var(--red);">NT$ ${o.finalTotal} ・ ${t('查看憑證 ➔', 'View Ticket ➔', 'チケット ➔', '티켓 보기 ➔')}</strong>
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
  const staffAccountsNames = (targetStore && Array.isArray(targetStore.staffAccounts) && targetStore.staffAccounts.length > 0)
    ? targetStore.staffAccounts.filter(a => a && a.active !== false).map(a => a.name).filter(Boolean)
    : [];
  const legacyStaffNames = (targetStore && Array.isArray(targetStore.staffList) && targetStore.staffList.length > 0)
    ? targetStore.staffList
    : ['值班店長', '早班收銀', '晚班收銀'];
  const staffCandidates = Array.from(new Set([...staffAccountsNames, ...legacyStaffNames]));
  const DEV_OPTION_VAL = '開發者';
  const curStaffName = state.pinSelectedStaffName || staffCandidates[0] || '值班店長';
  const isDevSelected = curStaffName === DEV_OPTION_VAL;

  const canSubmit = len >= 4 && len <= 8 && !state.isVerifyingPin && lockoutRemainSec === 0;
  const submitBtnInner = state.isVerifyingPin
    ? `<span class="mf-btn-spinner"></span> ${t('驗證中，請稍候...', 'Verifying...', '認証中...', '확인 중...')}`
    : (isDevSelected
        ? `🛠️ ${t('確認以開發者身分登入', 'Unlock as Developer', '開発者として解除', '개발자로 잠금 해제')} (${len})`
        : `🔓 ${t('確認解鎖', 'Unlock', '解除', '잠금 해제')}「${escapeHtml(targetStore ? trTerm(targetStore.name) : '')}」(${len})`);

  body.innerHTML = `
    <div style="text-align:center;">
      <div style="margin-bottom:10px;">
        <label class="field-label" style="text-align:left;">🏪 ${t('選擇並驗證單一店鋪櫃位（各店獨立密碼）', 'Select Store Terminal', '店舗端末を選択', '매장 단말기 선택')}</label>
        ${isStoreLocked && targetStore ? `
          <div style="background:#F8FAFC; border:1.5px solid var(--border); border-radius:10px; padding:10px 12px; font-weight:900; color:var(--text-primary); display:flex; justify-content:space-between; align-items:center;">
            <span>${getStoreIconDisplay(targetStore)} ${escapeHtml(trTerm(targetStore.campus))} — ${escapeHtml(trTerm(targetStore.name))}</span>
            ${state.boundMerchantStoreId && !state.urlLockedStoreId ? `<button type="button" onclick="unbindDeviceMerchantStore()" style="border:none; background:transparent; color:var(--text-secondary); font-size:0.72rem; text-decoration:underline; cursor:pointer;">${t('切換店鋪', 'Switch', '切替', '전환')}</button>` : `<span style="font-size:0.7rem; color:var(--indigo);">${t('專屬終端鎖定', 'Terminal Locked', '専用端末固定', '전용 단말 고정')}</span>`}
          </div>
        ` : `
          <select class="select-input" style="font-weight:800;" onchange="state.merchantStoreId=this.value; state.pinInputBuffer=''; try{localStorage.setItem('mealflow_last_merchant_store_id', this.value);}catch(e){} renderStorePinModal(false)">
            ${state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === (targetStore ? targetStore.id : '') ? 'selected' : ''}>${escapeHtml(trTerm(s.campus))} — ${escapeHtml(trTerm(s.name))} (${escapeHtml(s.id)})</option>`).join('')}
          </select>
        `}
      </div>
      <div style="margin-bottom:10px; text-align:left;">
        <label class="field-label">👤 ${t('值班人員打卡（店長 / 收銀員 / 開發者）', 'On-Duty Staff Clock-In (Manager / Staff / Developer)', '担当スタッフ打刻（店長 / スタッフ / 開発者）', '근무 직원 출근 (점장 / 직원 / 개발자)')}</label>
        <div style="display:flex; gap:6px;">
          <select id="storePinStaffSelect" class="select-input" style="flex:1; font-weight:800;" onchange="state.pinSelectedStaffName=this.value; try{localStorage.setItem('mealflow_last_staff_name', this.value);}catch(e){} renderStorePinModal(false)">
            ${staffCandidates.map(stName => `<option value="${escapeHtml(stName)}" ${stName === curStaffName ? 'selected' : ''}>${escapeHtml(trTerm(stName))}</option>`).join('')}
            <option value="${DEV_OPTION_VAL}" ${isDevSelected ? 'selected' : ''}>🛠️ ${t('開發者 (Developer)', 'Developer', '開発者 (Developer)', '개발자 (Developer)')}</option>
            ${!staffCandidates.includes(curStaffName) && !isDevSelected ? `<option value="${escapeHtml(curStaffName)}" selected>${escapeHtml(trTerm(curStaffName))}</option>` : ''}
          </select>
          <input type="text" id="storePinCustomStaffInput" maxlength="20" class="select-input" style="flex:0.85;" placeholder="${t('或自填姓名', 'Or type name', 'または氏名入力', '또는 이름 입력')}" oninput="if(this.value.trim()){ state.pinSelectedStaffName=this.value.trim(); }">
        </div>
        ${isDevSelected ? `
          <div style="margin-top:6px; font-size:0.74rem; color:#4338CA; background:#EEF2FF; border:1px solid #C7D2FE; padding:6px 10px; border-radius:8px; font-weight:800;">
            🛠️ ${t('開發者模式：輸入系統開發者專屬 PIN 即可免店家密碼直接進入並自由切換所有餐廳進行維護。', 'Developer Mode: Enter Developer PIN to access and switch across all stores without store passwords.', '開発者モード：開発者PINで全店舗の保守管理にアクセス可能です。', '개발자 모드: 개발자 PIN으로 매장 비밀번호 없이 모든 매장을 관리할 수 있습니다.')}
          </div>
        ` : ''}
      </div>
      <p style="font-size:0.82rem; color:${lockoutRemainSec > 0 ? 'var(--red)' : (state.isVerifyingPin ? 'var(--indigo)' : 'var(--text-secondary)')}; font-weight:700;">
        ${lockoutRemainSec > 0
          ? `🛑 ${t(`連續錯誤達上限，請等候 ${lockoutRemainSec} 秒後再試`, `Too many attempts. Wait ${lockoutRemainSec}s.`, `連続エラー上限に達しました。${lockoutRemainSec}秒後に再試行してください。`, `연속 오류 한도 초과. ${lockoutRemainSec}초 후 다시 시도하세요.`)}`
          : (state.isVerifyingPin
              ? t('⏳ 正在向雲端伺服器請求分級 HMAC 簽章授權...', '⏳ Verifying PIN with cloud server...', '⏳ クラウドサーバーでPIN認証中...', '⏳ 클라우드 서버에서 PIN 인증 중...')
              : (isDevSelected
                  ? t('請輸入開發者專屬 PIN 碼 (4～8 位數)', 'Enter Developer PIN (4-8 digits)', '開発者PINを入力 (4〜8桁)', '개발자 전용 PIN 입력 (4~8자리)')
                  : t('請輸入店長 PIN、個人員工 PIN 或開發者 PIN (4～8 位數)', 'Enter Manager, Staff, or Developer PIN (4-8 digits)', '店長・スタッフ・開発者PINを入力 (4〜8桁)', '점장 / 직원 / 개발자 PIN 입력 (4~8자리)')))}
      </p>
      <div class="pin-dots-row ${hasError ? 'shake-error' : ''}" style="justify-content:center; gap:8px;">
        ${Array.from({ length: dotSlots }).map((_, i) => `
          <div class="pin-dot-box ${i < len ? 'filled' : ''}">${i < len ? '●' : ''}</div>
        `).join('')}
      </div>
      <div class="pos-numpad-grid" style="margin-bottom:10px;">
        ${['1','2','3','4','5','6','7','8','9'].map(k => `<button type="button" class="pos-numpad-key" ${state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="tapStorePinKey('${k}')">${k}</button>`).join('')}
        <button type="button" class="pos-numpad-key clear" ${state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="tapStorePinKey('C')">${t('清除', 'Clr', '消去', '지움')}</button>
        <button type="button" class="pos-numpad-key" ${state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="tapStorePinKey('0')">0</button>
        <button type="button" class="pos-numpad-key back" ${state.isVerifyingPin || lockoutRemainSec > 0 ? 'disabled' : ''} onclick="tapStorePinKey('BACK')">⌫</button>
      </div>
      <button type="button" id="storePinSubmitBtn" class="btn-primary-full ${state.isVerifyingPin ? 'pin-submit-busy' : ''}" style="background:${state.isVerifyingPin ? '#475569' : (canSubmit ? (isDevSelected ? '#4F46E5' : 'var(--green)') : '#9CA3AF')}; box-shadow:none; display:inline-flex; align-items:center; justify-content:center; gap:8px;" ${!canSubmit ? 'disabled' : ''} onclick="submitStorePinAuth()">
        ${submitBtnInner}
      </button>
      <div style="font-size:0.72rem; color:var(--text-muted); margin-top:8px;">
        🛡️ ${t(`一人一碼具名打卡・開發者全店維護・閒置 ${state.merchantAutoLockMinutes} 分鐘自動上鎖`, `Per-staff PIN · Developer Access · Auto-lock after ${state.merchantAutoLockMinutes}m`, `個別スタッフPIN・開発者保守・${state.merchantAutoLockMinutes}分無操作で自動施錠`, `개별 직원 PIN · 개발자 모드 · ${state.merchantAutoLockMinutes}분 미사용 시 자동 잠금`)}
      </div>
    </div>
  `;
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
  const customStaff = document.getElementById('storePinCustomStaffInput')?.value.trim() || '';
  const selectedStaff = customStaff || document.getElementById('storePinStaffSelect')?.value || state.pinSelectedStaffName || '值班人員';
  state.pinSelectedStaffName = selectedStaff;
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
        storeId: targetStoreId,
        staffName: selectedStaff
      })
    });
    const data = await res.json();

    if (data && data.success && data.sessionToken) {
      const expiresAt = Number(data.expiresAt) || (Date.now() + 8 * 3600 * 1000);
      const staffRole = String(data.staffRole || 'MANAGER').toUpperCase();
      const isDeveloper = staffRole === 'DEVELOPER' || Boolean(data.canSwitchAnyStore);
      const scope = isDeveloper
        ? 'ALL'
        : String(data.authorizedStoreId && data.authorizedStoreId !== 'ALL' ? data.authorizedStoreId : targetStoreId);
      const staffName = String(
        data.staffName || selectedStaff || (isDeveloper ? '系統開發者' : (staffRole === 'MANAGER' ? '值班店長' : '收銀員'))
      ).trim();

      state.isMerchantUnlocked = true;
      state.merchantAuthToken = data.sessionToken;
      state.merchantSessionExpiresAt = expiresAt;
      state.merchantAuthorizedStoreScope = scope;
      state.merchantStaffRole = staffRole;
      state.merchantStaffName = staffName;
      state.shiftCashierName = staffName;
      state.pinFailCount = 0;
      state.pinLockoutUntilTs = 0;
      state.lastMerchantActivityTs = Date.now();
      try {
        sessionStorage.setItem('mealflow_merchant_session_v13', data.sessionToken);
        sessionStorage.setItem('mealflow_merchant_exp_v13', String(expiresAt));
        sessionStorage.setItem('mealflow_merchant_scope_v13', scope);
        sessionStorage.setItem('mealflow_merchant_staff_role', staffRole);
        sessionStorage.setItem('mealflow_merchant_staff_name', staffName);
        localStorage.setItem('mealflow_last_staff_name', staffName);
        localStorage.setItem('mealflow_last_merchant_store_id', targetStoreId);
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
      const storeObj = state.stores.find(s => s.id === targetStoreId);
      const roleTag = isDeveloper
        ? `🛠️ ${t('開發者', 'Developer', '開発者', '개발자')}`
        : (staffRole === 'MANAGER' ? `👑 ${t('店長', 'Manager', '店長', '점장')}` : `👤 ${t('收銀員', 'Cashier', 'スタッフ', '캐셔')}`);
      showToast(`🔓 ${t('已解鎖', 'Unlocked', '解除しました', '잠금 해제')}「${storeObj ? trTerm(storeObj.name) : targetStoreId}」(${roleTag}：${trTerm(staffName)})`);
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
    showToast(`❌ ${translateServerError(err.message || '本店授權碼錯誤或無法連線至驗證伺服器')}`);
    renderStorePinModal(true);
  }
}

function lockMerchantSession(customToastMsg = '') {
  const tokenToRevoke = state.merchantAuthToken || sessionStorage.getItem('mealflow_merchant_session_v13') || '';
  state.isMerchantUnlocked = false;
  state.merchantAuthToken = '';
  state.merchantSessionExpiresAt = 0;
  state.merchantAuthorizedStoreScope = '';
  state.merchantStaffRole = 'MANAGER';
  state.merchantStaffName = '';
  state.pinInputBuffer = '';
  try {
    sessionStorage.removeItem('mealflow_merchant_session_v13');
    sessionStorage.removeItem('mealflow_merchant_exp_v13');
    sessionStorage.removeItem('mealflow_merchant_scope_v13');
    sessionStorage.removeItem('mealflow_merchant_staff_role');
    sessionStorage.removeItem('mealflow_merchant_staff_name');
  } catch (e) {}
  if (typeof stopMerchantLiveOrdersFirestoreWatch === 'function') {
    stopMerchantLiveOrdersFirestoreWatch();
  }

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

// ==================== 一-1 真實 LINE Pay V3 跳轉付款與回調 Confirm 嚴格核實引擎 ====================
const PENDING_LINEPAY_STORAGE_KEY = 'mealflow_pending_lp_v23';

function requestOnlinePaymentGateway(payMethod, amount, storeName, storeId, orderId = '', pendingOrderDraft = null) {
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
    const hasConfiguredLp = Boolean(storeObj && storeObj.linePayChannelId && storeObj.hasLinePaySecret);

    state.pendingLinePayDraftContext = pendingOrderDraft || null;
    header.className = 'payment-gateway-header linepay';
    title.innerText = '💚 ' + t('LINE Pay 付款', 'LINE Pay', 'LINE Pay 決済', 'LINE Pay 결제');

    if (state.linePayCountdownTimer) {
      clearInterval(state.linePayCountdownTimer);
      state.linePayCountdownTimer = null;
    }

    body.innerHTML = `
      <div style="text-align:center; padding:10px 4px 4px;">
        <div style="font-size:0.86rem; font-weight:800; color:var(--text-secondary);">${escapeHtml(trTerm(storeName))}</div>
        <div style="font-size:2.35rem; font-weight:950; color:var(--text-primary); margin:8px 0 12px; letter-spacing:-0.02em;">NT$ ${amount}</div>

        ${hasConfiguredLp ? `
          <div id="linePayFlowStepLabel" style="font-size:0.84rem; font-weight:700; color:var(--text-secondary); margin-bottom:20px; line-height:1.45;">
            ${t('點擊下方按鈕將跳轉至 LINE Pay 完成付款', 'Tap below to continue to LINE Pay', '下のボタンから LINE Pay へ進み決済を完了してください', '아래 버튼을 눌러 LINE Pay에서 결제를 완료하세요')}
          </div>
        ` : `
          <div style="background:#FFFBEB; border:1.5px solid #F59E0B; color:#92400E; padding:10px 12px; border-radius:10px; font-size:0.82rem; font-weight:800; margin-bottom:18px; line-height:1.45;">
            ${t('本店尚未開通線上 LINE Pay，請改用現場櫃檯付現。', 'Online LINE Pay is not enabled for this store. Please pay at the counter.')}
          </div>
        `}

        <div style="display:flex; gap:10px; align-items:stretch;">
          <button type="button" class="btn-outline" style="flex:0 0 auto; min-width:84px; white-space:nowrap;" onclick="cancelOnlinePaymentModal()">${t('取消', 'Cancel', 'キャンセル', '취소')}</button>
          ${hasConfiguredLp ? `
            <button type="button" id="confirmGatewayPayBtn" class="btn-tip-action" style="flex:1; min-width:0; background:#00C300; padding:13px 14px; font-size:0.98rem;" onclick="approveOnlinePaymentModal(${escapeJsAttr(storeId || '')}, ${Number(amount) || 0}, ${escapeJsAttr(orderId || '')})">
              ${t('前往付款', 'Pay Now', '支払う', '결제하기')} · NT$ ${amount}
            </button>
          ` : `
            <button type="button" class="btn-tip-action" style="flex:1; min-width:0; background:var(--brand); padding:13px 14px; font-size:0.95rem;" onclick="cancelOnlinePaymentModal(); setCheckoutMode('checkoutPayMethod', '現場櫃檯付現'); showToast('已切換為現場櫃檯付現');">
              💵 ${t('改用現場櫃檯付現', 'Switch to Cash at Pickup')}
            </button>
          `}
        </div>
      </div>
    `;

    state.pendingPaymentResolver = resolve;
    modal.classList.add('open');
  });
}

async function approveOnlinePaymentModal(storeId, amount, orderId = '') {
  ensureAudioContextUnlocked(false);
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
    btn.innerText = t('⏳ 正在前往 LINE Pay...', '⏳ Redirecting to LINE Pay...', '⏳ LINE Pay へ移動中...', '⏳ LINE Pay로 이동 중...');
  }
  try {
    const cleanReturnBase = `${window.location.origin}${window.location.pathname}`;
    const confirmUrl = `${cleanReturnBase}?lpCallback=1&store=${encodeURIComponent(storeId)}`;
    const cancelUrl = `${cleanReturnBase}?lpCancel=1&store=${encodeURIComponent(storeId)}`;

    const reqRes = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'requestLinePayCheckout',
        storeId: storeId,
        amount: amount,
        orderId: orderId,
        useRealLinePayApi: true,
        confirmUrl: confirmUrl,
        cancelUrl: cancelUrl,
        clientDeviceId: state.clientDeviceId,
        // 三-1：將訂單草稿一併交由伺服器預先寫入 PENDING_PAYMENT 訂單，徹底免除跨瀏覽器 localStorage 遺失風險！
        orderDraft: state.pendingLinePayDraftContext || null
      })
    });
    const reqData = await reqRes.json();
    if (!reqData || !reqData.success || !reqData.transactionId) {
      throw new Error((reqData && reqData.message) || 'LINE Pay Request 建立失敗');
    }

    // 三-1：伺服器已預先建立 PENDING_PAYMENT 訂單；本地 localStorage 僅作輔助快取，跨 App 跳轉完全不依賴它
    if (reqData.requiresRedirect && reqData.paymentUrlWeb) {
      const pendingPack = {
        storeId: storeId,
        amount: Number(reqData.amount || amount) || 0,
        orderId: reqData.orderId || orderId || reqData.lpOrderId || '',
        transactionId: String(reqData.transactionId),
        requestToken: String(reqData.requestToken || ''),
        orderDraft: state.pendingLinePayDraftContext || null,
        createdAtTs: Date.now()
      };
      try { localStorage.setItem(PENDING_LINEPAY_STORAGE_KEY, JSON.stringify(pendingPack)); } catch (e) {}
      if (stepEl) {
        stepEl.textContent = t('✓ 已建立 LINE Pay 交易，正在導向官方付款頁面...', '✓ Redirecting to LINE Pay...', '✓ LINE Pay決済ページへ移動中...', '✓ LINE Pay 결제 페이지로 이동 중...');
        stepEl.style.color = '#059669';
      }
      if (state.linePayCountdownTimer) {
        clearInterval(state.linePayCountdownTimer);
        state.linePayCountdownTimer = null;
      }
      window.location.href = reqData.paymentUrlWeb;
      return;
    }

    throw new Error('後端未回傳有效 LINE Pay 官方付款連結，請確認本店金流設定');
  } catch (err) {
    showToast(`🚫 ${translateServerError(err.message || 'LINE Pay 交易建立失敗')}`);
    if (btn) {
      btn.disabled = false;
      btn.innerText = `${t('重新前往付款', 'Retry Payment', '再試行', '다시 시도')} · NT$ ${amount}`;
    }
  }
}

// 一-1 & 三-1：跨瀏覽器安全回調（Safari → LINE App 內建瀏覽器零依賴 localStorage，直接透過 URL transactionId + orderId 向後端核實並轉正訂單！）
async function checkLinePayCallbackOnLoad() {
  try {
    const params = new URLSearchParams(window.location.search);
    const isLpCallback = params.get('lpCallback') === '1';
    const isLpCancel = params.get('lpCancel') === '1';
    if (!isLpCallback && !isLpCancel) return;

    const txId = String(params.get('transactionId') || '').trim();
    const urlOrderId = String(params.get('orderId') || '').trim();
    const urlStoreId = String(params.get('store') || '').trim();

    const cleanParams = new URLSearchParams(window.location.search);
    ['lpCallback', 'lpCancel', 'transactionId', 'orderId'].forEach(k => cleanParams.delete(k));
    const cleanUrl = window.location.pathname + (cleanParams.toString() ? '?' + cleanParams.toString() : '');
    try { window.history.replaceState({}, '', cleanUrl); } catch (e) {}

    if (isLpCancel) {
      try { localStorage.removeItem(PENDING_LINEPAY_STORAGE_KEY); } catch (e) {}
      showToast(t('ℹ️ 您已取消 LINE Pay 付款，購物車餐點已為您保留', 'ℹ️ LINE Pay cancelled. Your cart has been preserved.', 'ℹ️ LINE Pay決済をキャンセルしました。カートは保持されています。', 'ℹ️ LINE Pay 결제가 취소되었습니다. 장바구니가 유지됩니다.'));
      return;
    }

    let pendingPack = null;
    try {
      const rawSaved = localStorage.getItem(PENDING_LINEPAY_STORAGE_KEY);
      if (rawSaved) pendingPack = JSON.parse(rawSaved);
    } catch (e) {}

    const resolvedStoreId = urlStoreId || (pendingPack && pendingPack.storeId) || '';
    const resolvedOrderId = urlOrderId || (pendingPack && pendingPack.orderId) || '';
    if (!txId || (!resolvedOrderId && !pendingPack)) {
      showToast(t('⚠️ 找不到對應的待付款 LINE Pay 交易紀錄，請重新結帳', '⚠️ Pending LINE Pay checkout record not found.', '⚠️ LINE Pay取引記録が見つかりません。再度お試しください。', '⚠️ 대기 중인 LINE Pay 결제 기록을 찾을 수 없습니다.'));
      return;
    }

    showToast(t('⏳ 正在向 LINE Pay 官方請款核實 (Confirm)...', '⏳ Confirming LINE Pay settlement...', '⏳ LINE Pay決済を確認中...', '⏳ LINE Pay 결제 승인 확인 중...'));

    const confRes = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'confirmLinePayCheckout',
        storeId: resolvedStoreId,
        orderId: resolvedOrderId,
        amount: pendingPack ? pendingPack.amount : 0,
        transactionId: txId,
        requestToken: (pendingPack && pendingPack.requestToken) || '',
        clientDeviceId: state.clientDeviceId
      })
    });
    const confData = await confRes.json();
    if (!confData || !confData.success) {
      throw new Error((confData && confData.message) || 'LINE Pay 請款核實未通過，未扣款或請聯繫店家');
    }

    // 三-1：後端已直接從雲端 PENDING_PAYMENT 訂單轉正並配發正式 B001+ 單號，完全不依賴本機 localStorage！
    let authOrder = null;
    if (confData.order && confData.order.orderId) {
      authOrder = sanitizeIncomingOrder({ ...confData.order, isOfflinePending: false });
    } else if (pendingPack && pendingPack.orderDraft && confData.paymentAuthToken) {
      // 向下相容舊版後端回應
      const finalPayload = {
        ...pendingPack.orderDraft,
        transactionId: confData.transactionId || txId,
        paymentAuthToken: confData.paymentAuthToken,
        paymentStatus: '已付款'
      };
      const subRes = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'submitOrder',
          ...finalPayload
        })
      });
      const subData = await subRes.json();
      if (!subData || !subData.success || !subData.order) {
        throw new Error((subData && subData.message) || '款項已核實但建單失敗，請出示交易號洽櫃檯補單：' + txId);
      }
      authOrder = sanitizeIncomingOrder({ ...finalPayload, ...subData.order, isOfflinePending: false });
    }

    if (authOrder) {
      try { localStorage.removeItem(PENDING_LINEPAY_STORAGE_KEY); } catch (e) {}
      state.pendingLocalOrdersMap[authOrder.orderId] = Date.now();
      const exIdx = state.orders.findIndex(x => x.orderId === authOrder.orderId);
      if (exIdx >= 0) state.orders[exIdx] = authOrder;
      else state.orders.unshift(authOrder);
      addOrderToMyHistory(authOrder.orderId);
      saveCachedOrders(state.orders);
      state.cartItems = [];
      if (state.cartByStoreMap && resolvedStoreId) delete state.cartByStoreMap[resolvedStoreId];
      saveStudentCartDraft();
      navigateToOrderTicket(authOrder.orderId);
      showToast(`🎉 ${t(`LINE Pay 付款成功！單號 #${authOrder.pickupNumber}`, `LINE Pay settled! Pickup #${authOrder.pickupNumber}`, `LINE Pay決済完了！番号 #${authOrder.pickupNumber}`, `LINE Pay 결제 완료! 픽업번호 #${authOrder.pickupNumber}`)}`);
    }
  } catch (err) {
    showToast(`🚫 ${t('LINE Pay 回調核實異常', 'LINE Pay confirmation error', 'LINE Pay確認エラー', 'LINE Pay 승인 오류')}：${translateServerError(err.message || err)}`);
  }
}

function cancelOnlinePaymentModal() {
  if (state.linePayCountdownTimer) {
    clearInterval(state.linePayCountdownTimer);
    state.linePayCountdownTimer = null;
  }
  state.pendingLinePayDraftContext = null;
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
        🛡️ ${t('ISO/IEC 18004 真實 QR 核銷 × 時段配額控管 × KDS 鏡頭掃碼 × 會計級交班日結單', 'ISO/IEC 18004 QR Verification × Slot Quota × KDS Scanner × Accounting Z-Report', 'ISO/IEC 18004 QR認証 × 予約枠制御 × KDSスキャン × 会計日次精算', 'ISO/IEC 18004 QR 인증 × 시간대 정원 관리 × KDS 스캔 × 회계 마감 정산')}
      </div>
      <p style="font-size:0.86rem; color:var(--text-secondary); max-width:640px; margin:0 auto;">
        ${t('整合線上掃碼點餐 (<code>/order/</code>)、標準可掃描防偽 QR 電子憑證，以及全螢幕平板 POS + KDS 鏡頭掃碼核銷 + 會計日結後台 (<code>/store/</code>)。', 'Integrated QR Mobile Ordering (<code>/order/</code>), Verified Pickup QR Tickets, and Full-Screen Tablet POS + KDS + Z-Report Operations (<code>/store/</code>).', 'スマホQR注文 (<code>/order/</code>)、偽造防止QRチケット、タブレットPOS＋KDS＋日次精算管理 (<code>/store/</code>) を統合。', '모바일 QR 주문 (<code>/order/</code>), 위조 방지 QR 티켓, 태블릿 POS + KDS + 회계 마감 시스템 (<code>/store/</code>) 통합.')}
      </p>
    </div>

    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin-bottom:20px;">
      <a href="${escapeHtml(orderUrl)}" style="text-decoration:none; color:inherit;">
        <div class="portal-card" style="border:2px solid var(--brand); background:linear-gradient(180deg, #FFFFFF 0%, #FFF9F6 100%);">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:2.2rem;">📱</span>
              <span class="wait-pill wait-free">${t('學生掃碼點餐入口', 'Student Ordering Portal', '学生QR注文入口', '학생 QR 주문 입구')}</span>
            </div>
            <h2 style="font-size:1.18rem; font-weight:900; margin-bottom:4px;">${t('學生掃碼點餐端', 'Student Mobile Ordering', '学生モバイル注文', '학생 모바일 주문')}</h2>
            <code style="display:block; font-size:0.76rem; color:var(--brand-dark); background:var(--brand-light); padding:5px 8px; border-radius:6px; margin-bottom:10px;">
              /scu.meal/order/
            </code>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">
              ${t('支援 15 分鐘時段配額預訂、動態產能候餐預估、多輪智慧選餐顧問與標準 ISO QR Code 防偽電子取餐單。', '15-min slot pre-orders, real-time wait estimates, AI meal advisor, and ISO QR verified pickup tickets.', '15分単位の予約枠、リアルタイム待ち時間予測、AIメニュー案内、ISO QR電子チケットに対応。', '15분 단위 예약 정원, 실시간 대기 시간 예측, AI 메뉴 추천, ISO QR 픽업 티켓 지원.')}
            </p>
          </div>
          <div class="btn-tip-action" style="text-align:center; width:100%;">${t('進入學生掃碼點餐 ➔', 'Start Student Ordering ➔', '学生注文ページへ ➔', '학생 주문 시작 ➔')}</div>
        </div>
      </a>

      <a href="${escapeHtml(storeUrl)}" style="text-decoration:none; color:inherit;">
        <div class="portal-card" style="border:2px solid #0F172A; background:#FFFFFF;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:2.2rem;">🖥️</span>
              <span class="wait-pill" style="background:#E2E8F0; color:#0F172A;">${t('商用全螢幕平板收銀', 'Commercial Tablet POS', '業務用タブレットPOS', '상업용 태블릿 POS')}</span>
            </div>
            <h2 style="font-size:1.18rem; font-weight:900; margin-bottom:4px;">${t('店家全螢幕收銀・KDS 鏡頭核銷・會計日結', 'Merchant POS・KDS Scanner・Z-Report', '店舗POS・KDSスキャン・日次精算', '매장 POS・KDS 스캔・마감 정산')}</h2>
            <code style="display:block; font-size:0.76rem; color:#0F172A; background:#F1F5F9; padding:5px 8px; border-radius:6px; margin-bottom:10px;">
              /scu.meal/store/
            </code>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">
              ${t('具備雲端 HMAC Session 保護、一鍵快結收銀、KDS 鏡頭掃碼核銷、未收款防呆攔截與完整錢箱交班日結單。', 'Cloud HMAC session protection, 1-tap fast checkout, KDS QR verification, unpaid guards & accounting Z-report.', 'クラウドHMAC認証、1タップ高速会計、KDS QR検収、未収防止ガード、完全な日次精算機能を搭載。', '클라우드 HMAC 세션 보안, 원탭 고속 결제, KDS QR 인증, 미수금 방지 및 회계 마감 정산 지원.')}
            </p>
          </div>
          <div class="btn-tip-action" style="text-align:center; width:100%; background:#0F172A; box-shadow:none;">${t('進入店家營運中心 ➔', 'Open Merchant POS ➔', '店舗管理センターへ ➔', '매장 운영 센터 열기 ➔')}</div>
        </div>
      </a>

      <a href="${escapeHtml(getBaseRootUrl() + 'board/?store=' + encodeURIComponent(state.merchantStoreId || 'S01'))}" style="text-decoration:none; color:inherit;">
        <div class="portal-card" style="border:2px solid #059669; background:linear-gradient(180deg, #ECFDF5 0%, #FFFFFF 100%);">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:2.2rem;">📺</span>
              <span class="wait-pill" style="background:#DCFCE7; color:#047857;">${t('麥當勞風格免登入大螢幕', 'Zero-Login TV Call Board', 'ログイン不要テレビ画面', '로그인 불필요 TV 전광판')}</span>
            </div>
            <h2 style="font-size:1.18rem; font-weight:900; margin-bottom:4px;">${t('電視即時取餐叫號大看板', 'Live TV Pickup Call Board', 'テレビ即時呼出ディスプレイ', '실시간 TV 픽업 호출 전광판')}</h2>
            <code style="display:block; font-size:0.76rem; color:#047857; background:#D1FAE5; padding:5px 8px; border-radius:6px; margin-bottom:10px;">
              /scu.meal/board/?store=S01
            </code>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">
              ${t('專為大尺寸電視與投屏設計，特大號製作中／請取餐雙欄、新叫號語音叮咚提醒、免登入自動防休眠。', 'Designed for TV screens & casting. Giant Preparing / Now Serving split screen with voice chimes & WakeLock.', '大画面テレビ・キャスト専用設計。調理中／呼出中の2画面表示・音声案内・スリープ防止機能付き。', '대형 TV 및 미러링 전용. 조리 중/호출 중 2분할 화면, 음성 안내, 절전 방지 지원.')}
            </p>
          </div>
          <div class="btn-tip-action" style="text-align:center; width:100%; background:#059669; box-shadow:none;">${t('開啟電視投屏大看板 ➔', 'Open TV Call Board ➔', 'テレビ看板を開く ➔', 'TV 호출 전광판 열기 ➔')}</div>
        </div>
      </a>
    </div>
  `;
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(box);
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
  state.studentMenuSearchOpen = false;
  state.campus = store.campus;
  state.checkoutErrorBannerMsg = '';

  if (store.canPreOrder === false) {
    // 暫停營業：禁止點餐與預訂，保持唯讀瀏覽
    state.checkoutTimeMode = 'NOW';
  } else if (store.canOrderNow === false) {
    state.checkoutTimeMode = 'RESERVE';
  } else {
    // A2：正常營業時每次進店一律預設「立即製作 (NOW)」
    state.checkoutTimeMode = 'NOW';
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

let _studentScrollSpyBound = false;
let _studentScrollSpyRaf = null;

function setStudentMenuCategory(cat) {
  const targetCat = cat || '全部';
  state.studentMenuCategory = targetCat;
  if (state.studentMenuSearch) {
    state.studentMenuSearch = '';
    const inp = document.getElementById('studentMenuSearchInput');
    if (inp) inp.value = '';
    renderInStoreMenuCards(true);
  }
  // 三-4：點擊分類錨點平滑滾動至該分類區塊，而非硬切換隱藏其餘分類
  document.querySelectorAll('#stickyMenuCatTabs .pos-cat-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === targetCat);
  });
  if (targetCat === '全部') {
    const topAnchor = document.getElementById('studentMenuGroupsResultBox');
    if (topAnchor && typeof topAnchor.scrollIntoView === 'function') {
      topAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
  const secEl = document.querySelector(`.menu-cat-section[data-menu-cat="${CSS.escape(targetCat)}"]`);
  if (secEl && typeof secEl.scrollIntoView === 'function') {
    secEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function initStudentMenuScrollSpy() {
  if (_studentScrollSpyBound || typeof window === 'undefined') return;
  _studentScrollSpyBound = true;
  window.addEventListener('scroll', () => {
    if (state.routeMode !== 'order' || !state.selectedStoreId || state.studentMenuSearch) return;
    if (_studentScrollSpyRaf) return;
    _studentScrollSpyRaf = window.requestAnimationFrame(() => {
      _studentScrollSpyRaf = null;
      const sections = Array.from(document.querySelectorAll('#studentMenuGroupsResultBox .menu-cat-section'));
      if (sections.length === 0) return;
      let activeCat = sections[0].dataset.menuCat || '全部';
      for (let i = 0; i < sections.length; i++) {
        const rect = sections[i].getBoundingClientRect();
        if (rect.top <= 165) {
          activeCat = sections[i].dataset.menuCat || activeCat;
        }
      }
      if (activeCat && state.studentMenuCategory !== activeCat) {
        state.studentMenuCategory = activeCat;
        document.querySelectorAll('#stickyMenuCatTabs .pos-cat-pill').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.cat === activeCat);
        });
      }
    });
  }, { passive: true });
}

// 三-4：卡片內嵌快速加減 [－ qty ＋]（無須彈窗即可 1 秒微調無規格單品份數）
function adjustSimpleItemInCart(itemId, delta, evt) {
  if (evt && typeof evt.stopPropagation === 'function') evt.stopPropagation();
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  if (!store) return;
  if (delta > 0 && (store.isOpen === false || store.canPreOrder === false)) {
    showToast(t('⛔ 本店目前暫停營業中，暫停現場點餐與預訂服務', '⛔ Store is currently paused. Ordering & pre-orders unavailable.', '⛔ 現在営業休止中のため注文・予約できません', '⛔ 현재 영업 중지 상태입니다 (주문・예약 불가)'));
    return;
  }
  const item = (store.menus || []).find(m => String(m.id) === String(itemId));
  if (!item || item.soldOut) return;

  const existingIdx = state.cartItems.findIndex(ci =>
    String(ci.id) === String(item.id) &&
    (!ci.selections || Object.keys(ci.selections).length === 0) &&
    !ci.itemNote
  );
  if (delta > 0) {
    if (existingIdx >= 0) {
      state.cartItems[existingIdx].qty = (state.cartItems[existingIdx].qty || 1) + delta;
    } else {
      state.cartItems.push({
        id: item.id,
        name: item.name,
        baseName: item.name,
        basePrice: item.price,
        price: item.price,
        qty: delta,
        selections: {}
      });
    }
  } else if (delta < 0 && existingIdx >= 0) {
    state.cartItems[existingIdx].qty = (state.cartItems[existingIdx].qty || 1) + delta;
    if (state.cartItems[existingIdx].qty <= 0) {
      state.cartItems.splice(existingIdx, 1);
    }
  }
  state.checkoutErrorBannerMsg = '';
  updateCartUI();
}

// 三-4：零閃爍局部 DOM 修補（僅更新購物車角標與內嵌加減器數字，絕不重繪整份菜單卡片、不重載圖片、不跳動滾軸）
function patchInStoreMenuCardBadges() {
  const gridBox = document.getElementById('studentMenuGroupsResultBox');
  if (!gridBox) return;
  const countMap = {};
  (state.cartItems || []).forEach(ci => {
    const cid = String(ci.id);
    countMap[cid] = (countMap[cid] || 0) + (Number(ci.qty) || 1);
  });
  gridBox.querySelectorAll('.menu-item-card[data-menu-id]').forEach(card => {
    const mid = card.dataset.menuId;
    const isSoldOut = card.dataset.soldOut === '1';
    const hasOpts = card.dataset.hasOpts === '1';
    const qty = countMap[mid] || 0;
    card.classList.toggle('in-cart-active', qty > 0);
    const plusBadge = card.querySelector('.menu-plus-badge');
    if (plusBadge) plusBadge.textContent = qty > 0 ? String(qty) : '＋';
    const countPill = card.querySelector('.menu-in-cart-pill');
    if (countPill) {
      countPill.style.display = qty > 0 ? 'inline-block' : 'none';
      countPill.textContent = t(`已選 ${qty}`, `${qty} in cart`, `${qty}点`, `${qty}개`);
    }
    const stepperWrap = card.querySelector('.card-inline-stepper-wrap');
    if (stepperWrap && !isSoldOut && !hasOpts) {
      stepperWrap.innerHTML = qty > 0
        ? `<div class="card-inline-stepper" onclick="event.stopPropagation()">
             <button type="button" class="stepper-btn minus" onclick="adjustSimpleItemInCart(${escapeJsAttr(mid)}, -1, event)">－</button>
             <span class="stepper-qty">${qty}</span>
             <button type="button" class="stepper-btn plus" onclick="adjustSimpleItemInCart(${escapeJsAttr(mid)}, 1, event)">＋</button>
           </div>`
        : `<span class="menu-action-pill">${t('＋ 加入', '+ Add', '＋ 追加', '＋ 담기')}</span>`;
    }
  });
}

function handleStudentMenuSearch(val) {
  state.studentMenuSearch = String(val || '');
  renderInStoreMenuCards(true);
}

function openStudentMenuSearch() {
  state.studentMenuSearchOpen = true;
  renderInStoreMenuCards(false);
  setTimeout(() => document.getElementById('studentMenuSearchInput')?.focus(), 40);
}

function closeStudentMenuSearch() {
  state.studentMenuSearchOpen = false;
  state.studentMenuSearch = '';
  renderInStoreMenuCards(false);
}

function renderStudentOrderExperience() {
  enrichStoresAndAi();
  updateHeaderMyOrdersBadge();

  // A7：若目前開放於學生端的餐廳僅有 1 家，自動直達該店菜單頁
  const visibleStores = getVisibleStudentStores();
  if (visibleStores.length === 1 && state.selectedStoreId !== visibleStores[0].id) {
    state.selectedStoreId = visibleStores[0].id;
    state.campus = visibleStores[0].campus;
    if (visibleStores[0].canOrderNow !== false) state.checkoutTimeMode = 'NOW';
  }

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
  const campusStores = getVisibleStudentStores().filter(s => s.campus === state.campus);
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
    const liveBiz = getStoreBusinessHoursStatus(s);
    let waitClass = 'wait-free';
    let waitText = t(`約 ${s.avgPrepMinutes} 分取餐`, `~${s.avgPrepMinutes} min`, `約${s.avgPrepMinutes}分`, `약 ${s.avgPrepMinutes}분`);
    let barColor = 'var(--green)';

    const isStorePaused = s.isOpen === false || liveBiz.canPreOrder === false;
    if (isStorePaused) {
      waitClass = 'wait-paused';
      waitText = liveBiz.shortPillText || t('⛔ 暫停營業', '⛔ Paused', '⛔ 営業休止', '⛔ 영업 중지');
      barColor = '#EF4444';
    } else if (liveBiz.canOrderNow === false) {
      waitClass = 'wait-closed';
      waitText = liveBiz.shortPillText || t('🌙 今日已打烊 (可預訂)', '🌙 Closed (Pre-order)', '🌙 営業終了 (予約可)', '🌙 영업 종료 (예약 가능)');
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
    const hasPromo = !isStorePaused && isStorePromoActive(s, false, '');
    const isRecTarget = !isStorePaused && rec && rec.hasAlert && rec.recommendedStoreId === s.id;
    const availMenuCount = (s.menus || []).filter(m => !m.soldOut).length;
    const savedCartArr = (state.cartByStoreMap && Array.isArray(state.cartByStoreMap[s.id])) ? state.cartByStoreMap[s.id] : [];
    const savedCartQty = savedCartArr.reduce((sum, ci) => sum + (Number(ci.qty) || 1), 0);

    return `
      <div class="store-card ${isRecTarget ? 'recommended' : ''} ${isStorePaused ? 'store-paused' : (liveBiz.canOrderNow === false ? 'store-closed' : '')}" onclick="enterStoreOrdering(${escapeJsAttr(s.id)})">
        <div class="store-thumb">
          ${icon}
        </div>
        <div class="store-info">
          <div class="store-header-row">
            <div class="store-name">${escapeHtml(trTerm(s.name))}</div>
            <span class="wait-pill ${waitClass}">${waitText}</span>
          </div>
          <div class="store-meta">
            ★ ${s.rating} ・ ${escapeHtml(trTerm(s.category))} ・ ${isStorePaused ? escapeHtml(liveBiz.statusLabel || t('暫停點餐與預訂', 'Ordering & pre-orders paused')) : (liveBiz.canOrderNow === false ? escapeHtml(liveBiz.statusLabel || t('開放預訂取餐', 'Pre-order open', '予約受付中', '예약 가능')) : t(`${availMenuCount} 道供應中`, `${availMenuCount} dishes`, `${availMenuCount}品提供中`, `${availMenuCount}개 메뉴`))}
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
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(container);
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
    if (searchKw) {
      const matchName = String(item.name || '').toLowerCase().includes(searchKw) || String(item.nameEn || '').toLowerCase().includes(searchKw);
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
  Object.keys(grouped).forEach(cat => {
    grouped[cat].sort(compareMenuItemsByPrice);
  });

  const isSearchExpanded = Boolean(state.studentMenuSearchOpen || (state.studentMenuSearch && state.studentMenuSearch.trim()));
  const menuFilterToolbarHtml = items.length > 0 ? `
    <div class="sticky-menu-cat-bar" style="display:flex; align-items:center; gap:8px;">
      ${isSearchExpanded ? `
        <div class="menu-search-expanded-wrap">
          <input type="search" id="studentMenuSearchInput" placeholder="🔍 ${t('搜尋餐點名稱或分類...', 'Search dishes...', 'メニュー検索...', '메뉴 검색...')}" value="${escapeHtml(state.studentMenuSearch || '')}" oninput="handleStudentMenuSearch(this.value)">
          <button type="button" class="menu-search-close-btn" aria-label="${t('關閉搜尋', 'Close search', '検索を閉じる', '검색 닫기')}" onclick="closeStudentMenuSearch()">✕</button>
        </div>
      ` : `
        <div id="stickyMenuCatTabs" class="sticky-menu-cat-tabs" style="flex:1; min-width:0;">
          ${allCategories.map(cat => `
            <button type="button" data-cat="${escapeHtml(cat)}" class="pos-cat-pill ${state.studentMenuCategory === cat ? 'active' : ''}" onclick="setStudentMenuCategory(${escapeJsAttr(cat)})">
              ${cat === '全部' ? t('🍽️ 全部', '🍽️ All', '🍽️ すべて', '🍽️ 전체') : escapeHtml(trTerm(cat))}
            </button>
          `).join('')}
        </div>
        <button type="button" id="studentMenuSearchToggleBtn" class="menu-search-toggle-btn" title="${t('搜尋餐點', 'Search menu', 'メニュー検索', '메뉴 검색')}" aria-label="${t('搜尋餐點', 'Search menu', 'メニュー検索', '메뉴 검색')}" onclick="openStudentMenuSearch()">🔍</button>
      `}
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
        <section class="menu-cat-section" data-menu-cat="${escapeHtml(cat)}" style="margin-bottom:14px; scroll-margin-top:138px;">
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
                ? `<img src="${escapeHtml(item.image)}" loading="lazy" alt="" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline';"><span style="display:none;">🍽️</span>`
                : `<span>🍽️</span>`;
              const hasOpts = item.options && Object.keys(item.options).length > 0;
              const optKeysTranslated = hasOpts ? Object.keys(item.options).map(k => trTerm(k)).join('・') : '';
              const displayDishName = trDishName(item);
              const secondaryNameSub = (state.lang !== 'zh-TW' && item.nameEn && displayDishName !== item.name)
                ? item.name
                : '';
              const soldOutLabelText = item.dailyLimitSoldOut
                ? t('今日限量已售罄（明日自動補貨）', 'Daily limit reached (restocks tomorrow)', '本日限定数終了', '오늘 한정 수량 소진')
                : (item.soldOutType === 'PERMANENT'
                  ? t('暫時缺貨（待廠商補貨）', 'Temporarily out of stock', '長期品切れ（入荷待ち）', '장기 품절 (재입고 대기)')
                  : t('本日已售完', 'Sold out today', '本日完売', '오늘 품절'));
              const subtitleText = isSoldOut
                ? soldOutLabelText
                : (hasOpts
                    ? t(`可選規格：${optKeysTranslated}`, `Options: ${optKeysTranslated}`, `オプション：${optKeysTranslated}`, `옵션: ${optKeysTranslated}`)
                    : secondaryNameSub);

              const isStorePaused = store.isOpen === false || store.canPreOrder === false;
              const actionAreaHtml = isStorePaused
                ? `<span class="menu-action-pill" style="background:#FEE2E2; color:#B91C1C; border-color:#FECACA;">${t('暫停點餐', 'Paused', '休止中', '중지됨')}</span>`
                : (isSoldOut
                ? `<span class="menu-action-pill" style="background:#E2E8F0; color:#94A3B8; border-color:#CBD5E1;">${item.soldOutType === 'PERMANENT' ? t('長期缺貨', 'Out of Stock', '長期品切', '장기 품절') : t('本日售完', 'Sold Out Today', '本日売切', '오늘 품절')}</span>`
                : (!hasOpts
                    ? `<div class="card-inline-stepper-wrap">${inCartQty > 0
                        ? `<div class="card-inline-stepper" onclick="event.stopPropagation()">
                             <button type="button" class="stepper-btn minus" onclick="adjustSimpleItemInCart(${escapeJsAttr(item.id)}, -1, event)">－</button>
                             <span class="stepper-qty">${inCartQty}</span>
                             <button type="button" class="stepper-btn plus" onclick="adjustSimpleItemInCart(${escapeJsAttr(item.id)}, 1, event)">＋</button>
                           </div>`
                        : `<span class="menu-action-pill">${t('＋ 加入', '+ Add', '＋ 追加', '＋ 담기')}</span>`}</div>`
                    : `<span class="menu-action-pill">${inCartQty > 0 ? t('＋ 再選一份', '+ Add Another', '＋ 追加', '＋ 추가') : t('選規格', 'Options', '選択', '옵션')}</span>`));

              return `
                <div class="menu-item-card ${isSoldOut ? 'sold-out' : ''} ${inCartQty > 0 ? 'in-cart-active' : ''}" data-menu-id="${escapeHtml(item.id)}" data-sold-out="${isSoldOut ? '1' : '0'}" data-has-opts="${hasOpts ? '1' : '0'}" onclick="handleMenuItemClick(${escapeJsAttr(item.id)}, false)">
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
                        <span class="menu-in-cart-pill" style="display:${inCartQty > 0 ? 'inline-block' : 'none'}; font-size:0.7rem; font-weight:900; background:var(--brand); color:#FFFFFF; padding:2px 8px; border-radius:999px;">${t(`已選 ${inCartQty}`, `${inCartQty} in cart`, `${inCartQty}点`, `${inCartQty}개`)}</span>
                      </div>
                      ${item.description ? `<div class="dish-desc-text" data-dish-name="1">${escapeHtml(item.description)}</div>` : ''}
                      ${Array.isArray(item.dietaryTags) && item.dietaryTags.length > 0 ? `
                        <div class="dietary-tags-row">
                          ${item.dietaryTags.map(code => `<span class="dietary-tag-pill">${escapeHtml(typeof trDietaryTag === 'function' ? trDietaryTag(code) : code)}</span>`).join('')}
                        </div>
                      ` : ''}
                      ${subtitleText ? `<div style="font-size:0.75rem; color:var(--text-secondary); margin-top:3px; line-height:1.35;">${escapeHtml(subtitleText)}</div>` : ''}
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                      <div style="display:flex; align-items:baseline; gap:3px;">
                        <span style="font-size:0.76rem; font-weight:800; color:var(--brand-dark);">NT$</span>
                        <span style="font-size:1.15rem; font-weight:950; color:var(--text-primary);">${item.price}</span>
                      </div>
                      ${actionAreaHtml}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }
  }

  const gridBox = document.getElementById('studentMenuGroupsResultBox');
  if (onlyUpdateGrid && gridBox) {
    gridBox.innerHTML = menuGroupsHtml;
    initStudentMenuScrollSpy();
    if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(gridBox);
    return;
  }

  const visibleStoresCount = getVisibleStudentStores().length;
  const isSingleStoreLocked = Boolean((state.urlLockedStoreId && state.urlLockedStoreId === store.id) || visibleStoresCount <= 1);
  const liveStoreBiz = getStoreBusinessHoursStatus(store);
  const isStorePausedBanner = store.isOpen === false || liveStoreBiz.canPreOrder === false;
  const storeFavDishes = (Array.isArray(state.memberFavoriteDishes) ? state.memberFavoriteDishes : [])
    .filter(f => f && String(f.storeId) === String(store.id))
    .map(f => (store.menus || []).find(m => !m.soldOut && (String(m.id) === String(f.menuId) || String(m.name) === String(f.name))))
    .filter(Boolean)
    .slice(0, 4);
  const memberReorderBarHtml = (state.memberProfile && (storeFavDishes.length > 0 || Number(state.memberProfile.points) > 0)) ? `
    <div class="member-reorder-bar">
      <span style="font-size:0.74rem; font-weight:900; color:#15803D; white-space:nowrap;">
        💚 ${t(`會員 ${state.memberProfile.points || 0} 點`, `Member ${state.memberProfile.points || 0} pts`, `会員 ${state.memberProfile.points || 0}pt`, `회원 ${state.memberProfile.points || 0}P`)}${storeFavDishes.length > 0 ? `・${t('常點快選', 'Quick Reorder', 'いつもの注文', '자주 시킨 메뉴')}：` : ''}
      </span>
      ${storeFavDishes.map(m => `
        <button type="button" class="member-reorder-chip" data-dish-name="1" onclick="handleMenuItemClick(${escapeJsAttr(m.id)}, false)">🔁 ${escapeHtml(trDishName(m))} $${m.price}</button>
      `).join('')}
    </div>
  ` : '';

  box.innerHTML = `
    <div class="in-store-banner">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:8px;">
        ${isSingleStoreLocked
          ? `<span style="font-size:0.75rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:4px 10px; border-radius:999px;">📌 ${t('專屬門市掃碼點餐', 'Booth Exclusive Ordering', '店舗専用注文', '매장 전용 주문')}</span>`
          : `<button type="button" class="filter-chip" style="background:#FFFFFF; padding:5px 11px; font-size:0.78rem; font-weight:800; box-shadow:0 2px 6px rgba(15,23,42,0.04);" onclick="backToStoreDirectory()">← ${t('返回餐廳列表', 'Restaurants', '店舗一覧', '매장 목록')}</button>`}
        <span class="wait-pill ${isStorePausedBanner ? 'wait-paused' : (liveStoreBiz.canOrderNow === false ? 'wait-closed' : store.loadState === 'FULL' ? 'wait-full' : store.loadState === 'MODERATE' ? 'wait-mod' : 'wait-free')}">
          ${isStorePausedBanner ? escapeHtml(liveStoreBiz.shortPillText || t('⛔ 暫停營業', '⛔ Paused', '⛔ 営業休止', '⛔ 영업 중지')) : (liveStoreBiz.canOrderNow === false ? escapeHtml(liveStoreBiz.shortPillText || t('🌙 今日已打烊 (可預訂)', '🌙 Closed (Pre-order)', '🌙 営業終了 (予約可)', '🌙 영업 종료 (예약 가능)')) : t(`約 ${store.avgPrepMinutes} 分取餐`, `Est. ${store.avgPrepMinutes}m`, `約${store.avgPrepMinutes}分`, `약 ${store.avgPrepMinutes}분`))}
        </span>
      </div>
      ${memberReorderBarHtml}
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
            <span>${escapeHtml(store.openTime || '10:30')}~${escapeHtml(store.closeTime || '19:30')}${store.breakStartTime && store.breakEndTime ? ` (${t('午休', 'Break', '休憩', '휴식')} ${escapeHtml(store.breakStartTime)}~${escapeHtml(store.breakEndTime)})` : ''}</span>
          </div>
        </div>
      </div>

      ${isStorePausedBanner ? `
        <div class="store-paused-blocker" style="margin-top:10px;">
          ⛔ ${escapeHtml(liveStoreBiz.statusLabel || t('本店目前暫停營業中（暫停現場點餐與預訂服務），僅供瀏覽菜單。', 'Store is temporarily paused. Ordering and pre-orders are disabled; menu is browse-only.', '現在一時営業休止中です（注文・予約不可、メニュー閲覧のみ）。', '현재 임시 영업 중지 상태입니다 (주문・예약 불가, 메뉴 열람만 가능).'))}
        </div>
      ` : (liveStoreBiz.canOrderNow === false ? `
        <div style="margin-top:10px; background:#EEF2FF; border:1px solid #C7D2FE; color:#312E81; padding:8px 12px; border-radius:10px; font-size:0.78rem; font-weight:800;">
          🌙 ${escapeHtml(liveStoreBiz.statusLabel || t('目前已打烊／非立即出餐時段，可加入購物車選擇「預訂取餐」', 'Currently closed for immediate pickup. Scheduled pre-orders are open!'))}
        </div>
      ` : '')}

      ${hasPromo ? `
        <div style="margin-top:10px; background:#FFF7ED; border:1px solid #FED7AA; color:var(--brand-dark); padding:7px 11px; border-radius:10px; font-size:0.78rem; font-weight:800;">
          ${t('離峰優惠：', 'Offer: ')}${escapeHtml(store.promoText)}${store.promoMode === 'discount' ? t(`（滿$${AI_DISCOUNT_MIN_SUBTOTAL}）`, ` (Min $${AI_DISCOUNT_MIN_SUBTOTAL})`) : ''}
        </div>
      ` : ''}

      ${Array.isArray(store.comboDiscounts) && store.comboDiscounts.some(r => r && r.active !== false) ? `
        <div style="margin-top:8px; background:#ECFDF5; border:1px solid #A7F3D0; color:#065F46; padding:7px 11px; border-radius:10px; font-size:0.78rem; font-weight:850; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
          <span>🎁 ${t('組合優惠：', 'Combo Deals: ', 'セット割引：', '세트 할인: ')}</span>
          ${store.comboDiscounts.filter(r => r && r.active !== false).map(r => `<span style="background:#FFFFFF; border:1px solid #6EE7B7; padding:2px 8px; border-radius:999px; font-size:0.74rem;"><span data-dish-name="1">${escapeHtml(r.name || `${r.matchA} + ${r.matchB}`)}</span> ${t(`折 $${r.discountAmount}`, `-$${r.discountAmount}`, `$${r.discountAmount}引き`, `$${r.discountAmount} 할인`)}</span>`).join('')}
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
  initStudentMenuScrollSpy();
  syncStickyHeaderOffset();
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(box);
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

function isXpInlineModCategory(catName) {
  const c = String(catName || '').trim();
  return c.includes('飯捲') || c.includes('蔥抓');
}

function handleMenuItemClick(itemId, isPos = false) {
  const storeId = isPos ? state.merchantStoreId : state.selectedStoreId;
  const store = state.stores.find(s => s.id === storeId);
  if (!store) return;

  if (!isPos && (store.isOpen === false || store.canPreOrder === false)) {
    showToast(t('⛔ 本店目前暫停營業中，暫停現場點餐與預訂服務', '⛔ Store is currently paused. Ordering & pre-orders unavailable.', '⛔ 現在営業休止中のため注文・予約できません', '⛔ 현재 영업 중지 상태입니다 (주문・예약 불가)'));
    return;
  }

  const item = (store.menus || []).find(i => String(i.id) === String(itemId));
  if (!item) return;

  if (item.soldOut) {
    showToast(t(`🚫 「${item.name}」今日已售罄，請挑選其他品項！`, `🚫 "${item.name}" is sold out today!`));
    return;
  }

  // XP=2 傳統 POS 復刻模式：點擊任何餐點皆不跳客製彈窗，直接帶入預設規格加入左側點單並選中
  if (isPos && state.xp2Mode && typeof handleXp2DishClick === 'function') {
    handleXp2DishClick(item);
    return;
  }

  // XP 模式：飯捲類 / 蔥抓餅類客製化為非必選，改於右側直接展開，點擊餐點不跳彈窗直接加入點餐單
  if (isPos && state.xpMode && isXpInlineModCategory(item.category) && typeof handleXpInlineModDishClick === 'function') {
    handleXpInlineModDishClick(item);
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
  const addQty = isPos ? Math.max(1, Number(state.posQtyMultiplier) || 1) : 1;
  const newItemObj = {
    id: item.id,
    category: item.category || '招牌主餐',
    name: item.name,
    baseName: item.name,
    basePrice: item.price,
    price: item.price,
    qty: addQty,
    selections: {}
  };
  if (isPos) {
    mergeOrPushCartItem(state.posCart, newItemObj, -1);
    state.posQtyMultiplier = 1;
    const store = state.stores.find(s => s.id === state.merchantStoreId);
    if (store && typeof renderPosCashierPanel === 'function') renderPosCashierPanel(store);
  } else {
    state.checkoutErrorBannerMsg = '';
    mergeOrPushCartItem(state.cartItems, newItemObj, -1);
    updateCartUI();
    showToast(t(`🛒 已加入購物車：${item.name}`, `🛒 Added to cart: ${trDishName(item)}`));
  }
}

// 三-1：解析多元規格項目（支援舊版陣列 [label, price, soldOut, subOptions] 與物件 { label, priceDelta, soldOut, subOptions }）
function normalizeChoiceSpec(raw) {
  if (Array.isArray(raw)) {
    return {
      label: String(raw[0] || '').trim(),
      extra: Math.max(0, Number(raw[1]) || 0),
      soldOut: Boolean(raw[2]),
      subOptions: Array.isArray(raw[3]) ? raw[3] : []
    };
  }
  if (raw && typeof raw === 'object') {
    return {
      label: String(raw.label || raw.name || '').trim(),
      extra: Math.max(0, Number(raw.priceDelta ?? raw.price ?? 0) || 0),
      soldOut: Boolean(raw.soldOut),
      subOptions: Array.isArray(raw.subOptions) ? raw.subOptions : []
    };
  }
  return { label: String(raw || '').trim(), extra: 0, soldOut: false, subOptions: [] };
}

function adjustOptQtyChoice(btnEl, delta) {
  const row = btnEl && btnEl.closest ? btnEl.closest('.opt-qty-row') : null;
  if (!row) return;
  const valEl = row.querySelector('.opt-qty-val');
  const maxQty = Math.max(1, parseInt(row.dataset.maxQty || '10', 10) || 10);
  const cur = Math.max(0, parseInt(row.dataset.qty || '0', 10) || 0);
  const next = Math.max(0, Math.min(maxQty, cur + delta));
  row.dataset.qty = String(next);
  if (valEl) valEl.textContent = String(next);
  row.classList.toggle('checked', next > 0);
  checkModalSelections();
}

function openOptionsModal(item, prefilledSelections = null) {
  document.getElementById('optModalTitle').innerText = trDishName(item);
  document.getElementById('optModalSubtitle').innerText = `${t('基本價格', 'Base Price', '基本価格', '기본 가격')} NT$ ${item.price}`;

  const content = document.getElementById('optModalContent');
  content.innerHTML = '';

  if (item.description || (Array.isArray(item.dietaryTags) && item.dietaryTags.length > 0)) {
    content.insertAdjacentHTML('beforeend', `
      <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-bottom:14px;">
        ${item.description ? `<div data-dish-name="1" style="font-size:0.82rem; color:var(--text-secondary); line-height:1.45;">${escapeHtml(item.description)}</div>` : ''}
        ${Array.isArray(item.dietaryTags) && item.dietaryTags.length > 0 ? `
          <div class="dietary-tags-row" style="margin-top:${item.description ? '6px' : '0'};">
            ${item.dietaryTags.map(code => `<span class="dietary-tag-pill">${escapeHtml(typeof trDietaryTag === 'function' ? trDietaryTag(code) : code)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `);
  }

  Object.keys(item.options || {}).forEach((optName, gIdx) => {
    const grp = item.options[optName];
    const gType = (grp && grp.type) || 'radio';
    const isQty = gType === 'qty';
    const isRadio = gType === 'radio';
    const inputType = isRadio ? 'radio' : 'checkbox';
    const minSel = Math.max(0, parseInt((grp && grp.minSelect) || (isRadio ? 1 : 0), 10) || 0);
    const maxSel = Math.max(0, parseInt((grp && grp.maxSelect) || 0, 10) || 0);

    let ruleLabel = isQty
      ? t('可選數量加購', 'Multi-Qty Add-on', '数量指定可', '수량 선택 가능')
      : (isRadio ? `* ${t('必選單選', 'Required', '必須', '필수')}` : t('可多選', 'Optional', '複数可', '다중선택'));
    if (!isRadio) {
      const hints = [];
      if (minSel > 0) hints.push(t(`最少選 ${minSel} 份`, `Min ${minSel}`));
      if (maxSel > 0) hints.push(t(`最多選 ${maxSel} 份`, `Max ${maxSel}`));
      if (hints.length > 0) ruleLabel = `${minSel > 0 ? '* ' : ''}${hints.join('・')}`;
    }
    const reqBadge = `<span style="color:${(isRadio || minSel > 0) ? 'var(--red)' : 'var(--brand)'}; font-size:0.74rem; font-weight:800; margin-left:6px;">${ruleLabel}</span>`;

    const choicesArray = (Array.isArray(grp && grp.choices) ? grp.choices : (Array.isArray(grp) ? grp : [])).map(normalizeChoiceSpec);
    let prefilledValues = [];
    const prefilledQtyMap = {};
    if (prefilledSelections && prefilledSelections[optName]) {
      const sel = prefilledSelections[optName];
      const parts = Array.isArray(sel) ? sel : String(sel).split(',').map(s => s.trim()).filter(Boolean);
      parts.forEach(p => {
        const qm = p.match(/^(.+?)\s*[×x]\s*(\d+)$/i);
        if (qm) {
          prefilledValues.push(qm[1].trim());
          prefilledQtyMap[qm[1].trim()] = Math.max(1, parseInt(qm[2], 10) || 1);
        } else {
          prefilledValues.push(p);
          prefilledQtyMap[p] = 1;
        }
      });
    }

    let firstAvailIdx = choicesArray.findIndex(c => !c.soldOut);
    if (firstAvailIdx < 0) firstAvailIdx = 0;

    let choicesHtml = '';
    if (isQty) {
      choicesHtml = choicesArray.map((ch) => {
        const initQty = ch.soldOut ? 0 : (prefilledQtyMap[ch.label] || 0);
        return `
          <div class="option-label-row opt-qty-row ${initQty > 0 ? 'checked' : ''}" data-group="${escapeHtml(optName)}" data-label="${escapeHtml(ch.label)}" data-extra="${ch.extra}" data-qty="${initQty}" data-max-qty="${maxSel > 0 ? maxSel : 10}" style="${ch.soldOut ? 'opacity:0.5; background:#F1F5F9;' : ''}">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-weight:750; color:var(--text-primary); ${ch.soldOut ? 'text-decoration:line-through;' : ''}">${escapeHtml(trTerm(ch.label))}</span>
              ${ch.extra > 0 ? `<span style="font-weight:800; color:var(--brand); font-size:0.84rem;">+NT$${ch.extra}/份</span>` : ''}
              ${ch.soldOut ? `<span style="font-size:0.7rem; font-weight:900; background:#FEE2E2; color:#DC2626; padding:1px 6px; border-radius:4px;">🚫 ${t('已售罄', 'Sold Out')}</span>` : ''}
            </div>
            ${!ch.soldOut ? `
              <div class="card-inline-stepper">
                <button type="button" class="stepper-btn minus" onclick="adjustOptQtyChoice(this, -1)">－</button>
                <span class="stepper-qty opt-qty-val">${initQty}</span>
                <button type="button" class="stepper-btn plus" onclick="adjustOptQtyChoice(this, 1)">＋</button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    } else {
      choicesHtml = choicesArray.map((ch, idx) => {
        const isChecked = !ch.soldOut && (
          prefilledSelections
            ? prefilledValues.includes(ch.label)
            : (isRadio && idx === firstAvailIdx)
        );
        const subBoxId = `subOptBox_${gIdx}_${idx}`;
        const hasSub = Array.isArray(ch.subOptions) && ch.subOptions.length > 0;
        const subHtml = hasSub ? `
          <div id="${subBoxId}" class="nested-sub-options-box" data-parent-group="${escapeHtml(optName)}" data-parent-choice="${escapeHtml(ch.label)}" style="display:${isChecked ? 'block' : 'none'};">
            ${ch.subOptions.map((subGrp, sIdx) => {
              const subName = String(subGrp.name || subGrp.title || `子規格 ${sIdx + 1}`);
              const subChoices = (subGrp.choices || []).map(normalizeChoiceSpec);
              const preSubVal = prefilledSelections && prefilledSelections[`${ch.label}・${subName}`];
              return `
                <div class="nested-sub-group">
                  <div class="nested-sub-title">↳ ${escapeHtml(trTerm(subName))} <span style="color:var(--red); font-size:0.7rem;">*</span></div>
                  <div class="nested-sub-pills">
                    ${subChoices.map((sch, scIdx) => {
                      const subChecked = preSubVal ? (String(preSubVal) === sch.label) : (scIdx === 0);
                      return `
                        <label class="nested-sub-pill ${subChecked ? 'active' : ''}">
                          <input type="radio" name="subopt-${gIdx}-${idx}-${sIdx}" data-sub-parent-key="${escapeHtml(`${ch.label}・${subName}`)}" data-extra="${sch.extra}" value="${escapeHtml(sch.label)}" ${subChecked ? 'checked' : ''} onchange="checkModalSelections()">
                          <span>${escapeHtml(trTerm(sch.label))}${sch.extra > 0 ? ` +$${sch.extra}` : ''}</span>
                        </label>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : '';

        return `
          <div>
            <label class="option-label-row ${isChecked ? 'checked' : ''}" style="${ch.soldOut ? 'opacity:0.5; background:#F1F5F9; cursor:not-allowed;' : ''}">
              <div style="display:flex; align-items:center; gap:10px;">
                <input type="${inputType}" name="optgrp-${escapeHtml(optName)}" value="${escapeHtml(ch.label)}" data-extra="${ch.extra}" data-soldout="${ch.soldOut ? '1' : '0'}" data-subbox="${hasSub ? subBoxId : ''}" ${isChecked ? 'checked' : ''} ${ch.soldOut ? 'disabled' : ''} onchange="checkModalSelections()" style="width:18px; height:18px; accent-color:var(--brand);">
                <span style="font-weight:700; color:var(--text-primary); ${ch.soldOut ? 'text-decoration:line-through;' : ''}">${escapeHtml(trTerm(ch.label))}</span>
                ${ch.soldOut ? `<span style="font-size:0.7rem; font-weight:900; background:#FEE2E2; color:#DC2626; padding:1px 6px; border-radius:4px;">🚫 ${t('已售罄', 'Sold Out')}</span>` : ''}
              </div>
              ${ch.extra > 0 ? `<span style="font-weight:800; color:var(--brand); font-size:0.86rem;">+NT$${ch.extra}</span>` : ''}
            </label>
            ${subHtml}
          </div>
        `;
      }).join('');
    }

    content.insertAdjacentHTML('beforeend', `
      <div style="margin-bottom:16px;" data-opt-group="${escapeHtml(optName)}">
        <h4 style="font-size:0.95rem; font-weight:900; margin-bottom:8px; color:var(--text-primary);">${escapeHtml(trTerm(optName))} ${reqBadge}</h4>
        <div>${choicesHtml}</div>
      </div>
    `);
  });

  content.insertAdjacentHTML('beforeend', `
    <div style="margin-top:6px; padding-top:12px; border-top:1px dashed var(--border);">
      <label class="field-label" style="margin-bottom:5px;">📝 ${t('單品客製備註（選填，例如：不要蔥、醬料分開、去冰）', 'Item Note (Optional)', '個別メモ（任意）', '개별 요청사항 (선택)')}</label>
      <input type="text" id="optItemNoteInput" maxlength="60" class="select-input" placeholder="${t('僅針對此道餐點之特別需求...', 'Special request for this dish...')}" value="${escapeHtml((state.editingCartIndex > -1 && (state.isPosConfiguring ? state.posCart : state.cartItems)[state.editingCartIndex]?.itemNote) || '')}">
    </div>
  `);

  checkModalSelections();
  const optModal = document.getElementById('optionsModal');
  optModal.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(optModal);
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
    const gType = (grp && grp.type) || 'radio';
    const isQty = gType === 'qty';
    const isRadio = gType === 'radio';
    const minSel = Math.max(0, parseInt((grp && grp.minSelect) || (isRadio ? 1 : 0), 10) || 0);
    const maxSel = Math.max(0, parseInt((grp && grp.maxSelect) || 0, 10) || 0);

    if (isQty) {
      const qtyRows = Array.from(document.querySelectorAll(`#optModalContent .opt-qty-row[data-group="${CSS.escape(cat)}"]`));
      let groupQtyTotal = 0;
      qtyRows.forEach(row => {
        const q = Math.max(0, parseInt(row.dataset.qty || '0', 10) || 0);
        const unitExtra = Math.max(0, parseFloat(row.dataset.extra || '0') || 0);
        groupQtyTotal += q;
        extra += q * unitExtra;
      });
      if (minSel > 0 && groupQtyTotal < minSel) {
        allRequiredChecked = false;
        constraintWarning = t(`「${cat}」請至少選擇 ${minSel} 份`, `Select at least ${minSel} in ${trTerm(cat)}`);
      }
      if (maxSel > 0 && groupQtyTotal > maxSel) {
        allRequiredChecked = false;
        constraintWarning = t(`「${cat}」最多選擇 ${maxSel} 份`, `Max ${maxSel} in ${trTerm(cat)}`);
      }
      return;
    }

    const selector = `#optModalContent input[name="optgrp-${CSS.escape(cat)}"]`;
    const allInputs = Array.from(document.querySelectorAll(selector));
    const checkedInputs = allInputs.filter(inp => inp.checked);

    // 展開/收合巢狀套餐子規格 (三-1)
    allInputs.forEach(inp => {
      const subId = inp.dataset.subbox;
      if (subId) {
        const subBox = document.getElementById(subId);
        if (subBox) subBox.style.display = inp.checked ? 'block' : 'none';
      }
    });

    if (isRadio) {
      if (checkedInputs.length === 0) allRequiredChecked = false;
    } else {
      if (minSel > 0 && checkedInputs.length < minSel) {
        allRequiredChecked = false;
        constraintWarning = t(`「${cat}」請至少選擇 ${minSel} 項`, `Select at least ${minSel} in ${trTerm(cat)}`);
      }
      if (maxSel > 0) {
        if (checkedInputs.length > maxSel) {
          allRequiredChecked = false;
          constraintWarning = t(`「${cat}」最多只能選擇 ${maxSel} 項`, `Max ${maxSel} in ${trTerm(cat)}`);
        }
        const reachedMax = checkedInputs.length >= maxSel;
        allInputs.forEach(inp => {
          inp.disabled = inp.dataset.soldout === '1' ? true : (reachedMax && !inp.checked);
        });
      }
    }
  });

  document.querySelectorAll('#optModalContent .option-label-row').forEach(lbl => {
    const inp = lbl.querySelector('input');
    if (inp) lbl.classList.toggle('checked', inp.checked);
  });

  document.querySelectorAll('#optModalContent input[name^="optgrp-"]:checked').forEach(sel => {
    extra += Math.max(0, parseFloat(sel.dataset.extra || 0));
  });

  // 僅累加目前展開顯示中的巢狀子規格加價與樣式
  document.querySelectorAll('#optModalContent .nested-sub-options-box').forEach(box => {
    const isVisible = box.style.display !== 'none';
    box.querySelectorAll('.nested-sub-pill').forEach(pill => {
      const r = pill.querySelector('input');
      pill.classList.toggle('active', Boolean(r && r.checked));
      if (isVisible && r && r.checked) {
        extra += Math.max(0, parseFloat(r.dataset.extra || 0));
      }
    });
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

  // 1. 讀取單選與多選規格
  document.querySelectorAll('#optModalContent input[name^="optgrp-"]:checked').forEach(r => {
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

  // 2. 讀取多數量加購規格 (三-1: type === 'qty')
  document.querySelectorAll('#optModalContent .opt-qty-row').forEach(row => {
    const q = Math.max(0, parseInt(row.dataset.qty || '0', 10) || 0);
    if (q <= 0) return;
    const cat = row.dataset.group;
    const lbl = row.dataset.label;
    const unitExtra = Math.max(0, parseFloat(row.dataset.extra || '0') || 0);
    if (!selections[cat]) selections[cat] = [];
    selections[cat].push(q > 1 ? `${lbl} ×${q}` : lbl);
    extraTotal += q * unitExtra;
  });

  // 3. 讀取已展開的巢狀套餐子規格 (三-1: subOptions)
  document.querySelectorAll('#optModalContent .nested-sub-options-box').forEach(box => {
    if (box.style.display === 'none') return;
    box.querySelectorAll('input[type="radio"]:checked').forEach(sr => {
      const subKey = sr.dataset.subParentKey || '子規格';
      selections[subKey] = sr.value;
      extraTotal += Math.max(0, parseFloat(sr.dataset.extra || 0));
    });
  });

  for (let key in selections) {
    if (Array.isArray(selections[key])) selections[key] = selections[key].join(', ');
  }

  const finalPrice = Math.max(0, Number(item.price) + extraTotal);
  const targetCart = state.isPosConfiguring ? state.posCart : state.cartItems;
  const addQty = state.isPosConfiguring ? Math.max(1, Number(state.posQtyMultiplier) || 1) : 1;
  const currentQty = (state.editingCartIndex > -1 && targetCart[state.editingCartIndex])
    ? (targetCart[state.editingCartIndex].qty || 1)
    : addQty;

  const itemNoteVal = String(document.getElementById('optItemNoteInput')?.value || '').trim().slice(0, 60);
  const newItemObj = {
    id: item.id,
    category: item.category || '招牌主餐',
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
    showToast(t(`✅ 已更新選項：${item.name}`, `✅ Updated: ${trDishName(item)}`));
  } else if (!state.isPosConfiguring) {
    state.checkoutErrorBannerMsg = '';
    showToast(t(`🛒 已加入：${item.name}`, `🛒 Added: ${trDishName(item)}`));
  }

  if (state.isPosConfiguring) {
    state.posQtyMultiplier = 1;
    const store = state.stores.find(s => s.id === state.merchantStoreId);
    if (store && typeof renderPosCashierPanel === 'function') renderPosCashierPanel(store);
  } else {
    updateCartUI();
  }
  closeOptionsModal();
}

function openCartModal() {
  if (state.cartItems.length === 0) return;
  ensureAudioContextUnlocked(false);
  state.checkoutErrorBannerMsg = '';
  state.cartStep = 1;
  state.cartOpenNoteIdx = -1;
  state.cartShowExtras = false;
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  // A2：每次開啟購物車時，若店家營業中可立即製作，預設「立即製作 (NOW)」而非預訂
  if (store && store.canOrderNow !== false && store.canPreOrder !== false) {
    state.checkoutTimeMode = 'NOW';
  }
  const todayStr = getTodayDateStr();
  if (!state.checkoutReserveDate || normalizeDateStr(state.checkoutReserveDate) < todayStr) {
    state.checkoutReserveDate = todayStr;
  }
  updateCartUI();
  const listDiv = document.getElementById('cartPageList');
  if (listDiv) listDiv.scrollTop = 0;
  document.getElementById('cartModal').classList.add('open');
}

function closeCartModal() {
  document.getElementById('cartModal').classList.remove('open');
}

function setCartStep(step) {
  const nextStep = step === 2 ? 2 : 1;
  state.cartStep = nextStep;
  state.cartOpenNoteIdx = -1;
  state.checkoutErrorBannerMsg = '';
  updateCartUI();
  const listDiv = document.getElementById('cartPageList');
  if (listDiv) listDiv.scrollTop = 0;
}

function toggleCartItemNoteEditor(index) {
  state.cartOpenNoteIdx = state.cartOpenNoteIdx === index ? -1 : index;
  updateCartUI();
  if (state.cartOpenNoteIdx === index) {
    setTimeout(() => {
      const inp = document.getElementById(`cartItemNoteInput-${index}`);
      if (inp) {
        inp.focus();
        try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {}
      }
    }, 30);
  }
}

function toggleCartExtras() {
  state.cartShowExtras = !state.cartShowExtras;
  updateCartUI();
}

function onCheckoutTaxIdInput(rawVal) {
  const digits = String(rawVal || '').replace(/\D/g, '').slice(0, 8);
  state.checkoutTaxId = digits;
  const inp = document.getElementById('checkoutTaxIdInput');
  if (inp && inp.value !== digits) inp.value = digits;
  saveStudentCartDraft();
  const hintEl = document.getElementById('cartTaxIdHint');
  if (hintEl) {
    if (!digits) {
      hintEl.innerHTML = '';
    } else if (validateTaiwanTaxId(digits)) {
      hintEl.innerHTML = `<span class="cart-hint-ok">✓ ${t('統一編號格式正確', 'Valid Taiwan Tax ID', '統一番号OK', '유효한 사업자번호')}</span>`;
    } else {
      hintEl.innerHTML = `<span class="cart-hint-err">⚠️ ${t('請輸入有效 8 碼台灣統一編號', 'Must be a valid 8-digit Taiwan Tax ID', '有効な8桁の統一番号を入力', '유효한 8자리 사업자번호를 입력하세요')}</span>`;
    }
  }
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
  state.currentCartRequestId = null;
  if (!state.cartItems[index]) return;
  state.cartItems[index].qty = (state.cartItems[index].qty || 1) + delta;
  if (state.cartItems[index].qty <= 0) {
    state.cartItems.splice(index, 1);
    if (state.cartOpenNoteIdx === index) state.cartOpenNoteIdx = -1;
    else if (state.cartOpenNoteIdx > index) state.cartOpenNoteIdx--;
  }
  state.checkoutErrorBannerMsg = '';
  updateCartUI();
}

function removeCartItem(index) {
  state.currentCartRequestId = null;
  state.cartItems.splice(index, 1);
  if (state.cartOpenNoteIdx === index) state.cartOpenNoteIdx = -1;
  else if (state.cartOpenNoteIdx > index) state.cartOpenNoteIdx--;
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

// B7：組合搭配折扣試算引擎（例：買雞排 + 飲料折 $5；支援分類或關鍵字配對，與後端 evaluateComboDiscountsOnServer 100% 同步）
function evaluateComboDiscounts(store, cartItems) {
  const rules = (store && Array.isArray(store.comboDiscounts))
    ? store.comboDiscounts.filter(r => r && r.active !== false && Number(r.discountAmount) > 0)
    : [];
  if (rules.length === 0 || !Array.isArray(cartItems) || cartItems.length === 0) {
    return { totalDiscount: 0, appliedRules: [] };
  }
  const menus = Array.isArray(store.menus) ? store.menus : [];
  const units = [];
  cartItems.forEach(item => {
    if (!item || item.isGift) return;
    const qty = Math.max(1, parseInt(item.qty || 1, 10) || 1);
    const dbMenu = menus.find(m => String(m.id) === String(item.id))
      || menus.find(m => item.category && String(m.category) === String(item.category) && String(m.name) === String(item.baseName || item.name))
      || menus.find(m => String(m.name) === String(item.baseName || item.name));
    const unitName = String(item.baseName || item.name || (dbMenu && dbMenu.name) || '').trim();
    const unitCat = String(item.category || (dbMenu && dbMenu.category) || '').trim();
    for (let q = 0; q < qty; q++) {
      units.push({ name: unitName, category: unitCat, used: false });
    }
  });
  const matchesCond = (unit, condStr) => {
    const raw = String(condStr || '').trim();
    if (!raw) return false;
    const tokens = raw.split(/[\/|,、]+/).map(s => s.trim()).filter(Boolean);
    return tokens.some(tok => {
      if (/^cat:/i.test(tok)) {
        const cTarget = tok.slice(4).trim();
        return cTarget && unit.category.includes(cTarget);
      }
      return unit.category.includes(tok) || unit.name.includes(tok);
    });
  };
  let totalDiscount = 0;
  const appliedRules = [];
  rules.forEach(rule => {
    const condA = String(rule.matchA || '').trim();
    const condB = String(rule.matchB || '').trim();
    const discPerSet = Math.max(0, Number(rule.discountAmount) || 0);
    if (!condA || !condB || discPerSet <= 0) return;
    let pairs = 0;
    while (true) {
      const idxA = units.findIndex(u => !u.used && matchesCond(u, condA));
      if (idxA < 0) break;
      const idxB = units.findIndex((u, i) => !u.used && i !== idxA && matchesCond(u, condB));
      if (idxB < 0) break;
      units[idxA].used = true;
      units[idxB].used = true;
      pairs++;
    }
    if (pairs > 0) {
      const amt = pairs * discPerSet;
      totalDiscount += amt;
      appliedRules.push({
        id: rule.id || '',
        name: rule.name || `${condA} + ${condB}`,
        pairs,
        discountPerSet: discPerSet,
        amount: amt
      });
    }
  });
  return { totalDiscount, appliedRules };
}

// 三-2：彈性行銷優惠、組合搭配折扣與優惠碼試算（與後端 handleOrderSubmission 規則 100% 同步）
function evaluateStudentPromoAndCoupon(store, cartItems, subtotal, isReserve, reserveTime) {
  if (!store) return { promoActive: false, minSpend: AI_DISCOUNT_MIN_SUBTOTAL, promoDiscount: 0, comboDiscount: 0, comboAppliedRules: [], couponDiscount: 0, couponError: '', matchedCoupon: null, giftMenuObj: null, isGiftSoldOut: false };
  const promoActive = isStorePromoActive(store, isReserve, reserveTime);
  const minSpend = store.promoMinSubtotal !== undefined ? Math.max(0, Number(store.promoMinSubtotal) || 0) : AI_DISCOUNT_MIN_SUBTOTAL;
  const totalQty = (cartItems || []).reduce((s, i) => s + (Number(i.qty) || 1), 0);

  let promoDiscount = 0;
  let giftMenuObj = null;
  let isGiftSoldOut = false;

  if (promoActive) {
    if (store.promoMode === 'discount' && subtotal >= minSpend) {
      promoDiscount = Math.min(subtotal, Math.max(0, Number(store.promoDiscount) || 10));
    } else if (store.promoMode === 'second_discount' && totalQty >= 2 && subtotal >= minSpend) {
      const pairs = Math.floor(totalQty / 2);
      const perPairOff = Math.max(1, Number(store.secondItemDiscount || store.promoDiscount || 10));
      promoDiscount = Math.min(subtotal, pairs * perPairOff);
    } else if (store.promoMode === 'gift' || store.promoMode === 'freebie') {
      if (store.giftMenuItemId) {
        giftMenuObj = (store.menus || []).find(m => String(m.id) === String(store.giftMenuItemId)) || null;
        isGiftSoldOut = Boolean(giftMenuObj && giftMenuObj.soldOut);
      } else {
        const giftKeywords = ['溫泉蛋', '溏心蛋', '滷蛋', '紅茶', '綠茶', '奶茶', '冬瓜茶', '豆漿', '味噌湯', '玉米濃湯', '酸辣湯', '豆腐', '小菜'];
        const matchedKw = giftKeywords.find(kw => String(store.promoText || '').includes(kw));
        giftMenuObj = matchedKw ? (store.menus || []).find(m => String(m.name || '').includes(matchedKw)) : null;
        isGiftSoldOut = Boolean(giftMenuObj && giftMenuObj.soldOut);
      }
    }
  }

  // B7：組合搭配折扣試算（例：雞排 + 飲料 折 $5）
  const comboEval = evaluateComboDiscounts(store, cartItems);
  const comboDiscount = Math.min(Math.max(0, subtotal - promoDiscount), comboEval.totalDiscount);
  const comboAppliedRules = comboEval.appliedRules;

  let couponDiscount = 0;
  let couponError = '';
  let matchedCoupon = null;
  const rawCode = String(state.checkoutCouponCode || '').trim().toUpperCase();
  if (rawCode) {
    const coupons = Array.isArray(store.coupons) ? store.coupons : [];
    const found = coupons.find(c => c && c.active !== false && String(c.code || '').toUpperCase() === rawCode);
    if (!found) {
      couponError = t(`找不到有效優惠碼「${rawCode}」`, `Invalid coupon code "${rawCode}"`);
    } else if (subtotal < (Number(found.minSubtotal) || 0)) {
      couponError = t(`優惠碼「${rawCode}」需滿 NT$${found.minSubtotal} 方可使用`, `Coupon "${rawCode}" requires min spend NT$${found.minSubtotal}`);
    } else {
      matchedCoupon = found;
      if (String(found.type).toUpperCase() === 'PERCENT') {
        const pct = Math.min(90, Math.max(1, Number(found.value) || 10));
        couponDiscount = Math.min(Math.max(0, subtotal - promoDiscount - comboDiscount), Math.round(subtotal * (pct / 100)));
      } else {
        couponDiscount = Math.min(Math.max(0, subtotal - promoDiscount - comboDiscount), Math.max(0, Number(found.value) || 0));
      }
    }
  }

  return { promoActive, minSpend, promoDiscount, comboDiscount, comboAppliedRules, couponDiscount, couponError, matchedCoupon, giftMenuObj, isGiftSoldOut };
}

function applyStudentCouponCode() {
  const inp = document.getElementById('checkoutCouponInput');
  state.checkoutCouponCode = String(inp ? inp.value : state.checkoutCouponCode || '').trim().toUpperCase();
  updateCartUI();
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const evalRes = evaluateStudentPromoAndCoupon(store, state.cartItems, subtotal, state.checkoutTimeMode === 'RESERVE', state.checkoutReserveTime);
  if (evalRes.matchedCoupon) {
    showToast(`🎟️ ${t(`已套用優惠碼 ${evalRes.matchedCoupon.code}，現折 NT$${evalRes.couponDiscount}`, `Coupon ${evalRes.matchedCoupon.code} applied (-NT$${evalRes.couponDiscount})`)}`);
  } else if (evalRes.couponError) {
    showToast(`⚠️ ${evalRes.couponError}`);
  }
}

// 三-3：尋找學生在本店尚未結單之進行中內用桌單（供一鍵加點併單使用）
function findActiveDineInOrderForStore(storeId) {
  if (!storeId) return null;
  const todayStr = getTodayDateStr();
  return getMyTrackedOrdersList().find(o =>
    o &&
    String(o.storeId) === String(storeId) &&
    normalizeDateStr(o.pickupDate || todayStr) === todayStr &&
    String(o.dineType || '').includes('內用') &&
    o.status !== '已完成' &&
    !String(o.status || '').includes('已取消')
  ) || null;
}

function startAddOnFromTicket(orderId) {
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  state.checkoutDineType = o.dineType || '內用自取';
  enterStoreOrdering(o.storeId);
}

async function submitAppendToExistingDineInOrder(targetOrderId) {
  const existingOrd = state.orders.find(o => o.orderId === targetOrderId);
  if (!existingOrd || state.cartItems.length === 0) return;
  const btn = document.getElementById('appendToTableOrderBtn');
  if (btn) { btn.disabled = true; btn.innerText = t('⏳ 正在將加點餐點併入訂單...', '⏳ Merging add-on items...', '⏳ 追加注文を反映中...', '⏳ 추가 주문을 합치는 중...'); }
  try {
    const itemsPayload = state.cartItems.map(ci => {
      const modifiers = [];
      Object.values(ci.selections || {}).forEach(v => {
        String(v || '').split(',').map(x => x.trim()).filter(Boolean).forEach(m => modifiers.push(m));
      });
      return {
        menuId: ci.id,
        name: ci.baseName || ci.name,
        qty: ci.qty || 1,
        modifiers: modifiers,
        itemNote: ci.itemNote || ''
      };
    });
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'appendOrderItems',
        orderId: existingOrd.orderId,
        verificationCode: existingOrd.verificationCode || '',
        items: itemsPayload
      })
    });
    const data = await res.json();
    if (!data || !data.success || !data.order) {
      throw new Error((data && data.message) || '加點併單失敗');
    }
    const updatedOrd = sanitizeIncomingOrder(data.order);
    const idx = state.orders.findIndex(x => x.orderId === updatedOrd.orderId);
    if (idx >= 0) state.orders[idx] = updatedOrd;
    else state.orders.unshift(updatedOrd);
    saveCachedOrders(state.orders);
    state.cartItems = [];
    if (state.cartByStoreMap && existingOrd.storeId) delete state.cartByStoreMap[existingOrd.storeId];
    state.checkoutAppendToOrderId = '';
    saveStudentCartDraft();
    closeCartModal();
    navigateToOrderTicket(updatedOrd.orderId);
    showToast(`🎉 ${t(`加點成功！已併入訂單 #${updatedOrd.pickupNumber}（新增 +NT$${data.addedSubtotal || 0}）`, `Added to #${updatedOrd.pickupNumber} (+NT$${data.addedSubtotal || 0})`, `#${updatedOrd.pickupNumber} に追加しました (+NT$${data.addedSubtotal || 0})`, `#${updatedOrd.pickupNumber}에 추가되었습니다 (+NT$${data.addedSubtotal || 0})`)}`);
  } catch (err) {
    showToast(`🚫 ${translateServerError(err.message || '加點併單失敗')}`);
    if (btn) { btn.disabled = false; btn.innerText = t(`➕ 加點併入訂單 #${existingOrd.pickupNumber}`, `➕ Add to Order #${existingOrd.pickupNumber}`, `➕ #${existingOrd.pickupNumber} に追加`, `➕ 주문 #${existingOrd.pickupNumber}에 추가`); }
  }
}

function updateCartUI() {
  const todayStr = getTodayDateStr();
  if (!state.checkoutReserveDate || normalizeDateStr(state.checkoutReserveDate) < todayStr) {
    state.checkoutReserveDate = todayStr;
  }
  saveStudentCartDraft();
  // 三-4：局部修補卡片角標與內嵌數量，不再清空整份菜單重繪造成畫面閃爍與滾軸跳動！
  if (state.routeMode === 'order' && state.selectedStoreId) {
    patchInStoreMenuCardBadges();
  }
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  const storeCutleryPrice = store && store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const totalCount = state.cartItems.reduce((sum, i) => sum + (i.qty || 1), 0);
  const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.checkoutNeedCutlery) ? storeCutleryPrice : 0;
  const hasNoodleInCart = cartHasNoodleItems(state.cartItems, store);
  const friedCountInCart = cartCountFriedItems(state.cartItems, store);
  if (!hasNoodleInCart && state.checkoutDineType === '外帶自取') {
    state.checkoutDineType = '內用自取';
  }
  if (friedCountInCart <= 1 && state.checkoutFriedBagPref) {
    state.checkoutFriedBagPref = '';
  }
  const takeoutFee = (subtotal > 0 && hasNoodleInCart && state.checkoutDineType === '外帶自取') ? 1 : 0;

  const isStorePausedCart = Boolean(store && (store.isOpen === false || store.canPreOrder === false));
  if (store && !isStorePausedCart && store.canOrderNow === false && state.checkoutTimeMode === 'NOW') {
    state.checkoutTimeMode = 'RESERVE';
  }

  const isReserve = !isStorePausedCart && state.checkoutTimeMode === 'RESERVE';
  let reserveTimeSlots = [];
  if (isReserve) {
    reserveTimeSlots = getValidPickupTimeSlots(state.checkoutReserveDate, store ? store.id : null);
    if (reserveTimeSlots.length === 0) {
      for (let off = 1; off <= 7; off++) {
        const candidateDate = getDateOffsetStr(off);
        const candTimes = getValidPickupTimeSlots(candidateDate, store ? store.id : null);
        if (candTimes.length > 0) {
          state.checkoutReserveDate = candidateDate;
          reserveTimeSlots = candTimes;
          break;
        }
      }
    }
    if (!reserveTimeSlots.includes(state.checkoutReserveTime)) {
      state.checkoutReserveTime = reserveTimeSlots[0] || '12:15';
    }
  }

  const evalPromo = evaluateStudentPromoAndCoupon(store, state.cartItems, subtotal, isReserve, state.checkoutReserveTime);
  const promoActive = evalPromo.promoActive;
  const minSpend = evalPromo.minSpend;
  const isPeakBlockedPromo = Boolean(
    store &&
    store.promoMode !== 'none' &&
    store.promoScope !== 'ALL_DAY' &&
    isReserve &&
    isPeakHourTimeSlot(state.checkoutReserveTime)
  );

  const discount = Math.min(subtotal, evalPromo.promoDiscount + (evalPromo.comboDiscount || 0) + evalPromo.couponDiscount);
  const finalTotal = Math.max(0, subtotal + cutleryFee + takeoutFee - discount);
  const isLargeOrderReserve = isReserve && finalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD;

  const viewCartBtn = document.getElementById('viewCartBtn');
  const countEl = document.getElementById('cartItemCountBadge');
  const previewTotalEl = document.getElementById('cartPreviewTotal');
  if (countEl) countEl.innerText = t(`${totalCount} 份`, `${totalCount} items`, `${totalCount}点`, `${totalCount}개`);
  if (previewTotalEl) previewTotalEl.innerText = `NT$ ${finalTotal}`;
  if (viewCartBtn) viewCartBtn.disabled = totalCount === 0 || isStorePausedCart;

  if (totalCount === 0 && document.getElementById('cartModal')?.classList.contains('open')) {
    closeCartModal();
  }

  const listDiv = document.getElementById('cartPageList');
  const titleEl = document.getElementById('cartModalTitle');
  const stepperEl = document.getElementById('cartModalStepper');
  const footerEl = document.getElementById('cartModalFooter');
  if (!listDiv) return;

  if (state.cartItems.length === 0) {
    listDiv.innerHTML = `
      <div style="text-align:center; padding:40px 0;">
        <p style="color:var(--text-muted); font-size:1.05rem; margin-bottom:12px;">${t('購物車目前沒有餐點', 'Your cart is empty')}</p>
        <button type="button" class="btn-tip-action" onclick="closeCartModal()">${t('去挑選餐點', 'Browse Menu')}</button>
      </div>
    `;
    if (footerEl) footerEl.innerHTML = '';
    return;
  }

  const currentStep = state.cartStep === 2 ? 2 : 1;

  if (titleEl) {
    titleEl.innerHTML = currentStep === 1
      ? `🛒 ${t('確認餐點', 'Review Order', '注文内容の確認', '주문 확인')}`
      : `💳 ${t('取餐與付款', 'Pickup & Payment', '受取とお支払い', '픽업 및 결제')}`;
  }

  if (stepperEl) {
    stepperEl.innerHTML = `
      <button type="button" class="cart-step-pill ${currentStep === 1 ? 'active' : 'done'}" onclick="setCartStep(1)">
        <span class="cart-step-num">${currentStep > 1 ? '✓' : '1'}</span>
        <span>${t('確認餐點', 'Items', '商品確認', '메뉴 확인')}</span>
      </button>
      <span class="cart-step-arrow">→</span>
      <button type="button" class="cart-step-pill ${currentStep === 2 ? 'active' : ''}" ${isStorePausedCart ? 'disabled' : ''} onclick="setCartStep(2)">
        <span class="cart-step-num">2</span>
        <span>${t('取餐付款', 'Checkout', '受取・決済', '픽업·결제')}</span>
      </button>
    `;
  }

  const errorBannerHtml = state.checkoutErrorBannerMsg ? `
    <div class="cart-error-banner">
      <div class="cart-error-title">⚠️ ${t('請檢查以下資訊', 'Please check your order')}</div>
      <div>${escapeHtml(state.checkoutErrorBannerMsg)}</div>
    </div>
  ` : '';

  const pausedBannerHtml = isStorePausedCart ? `
    <div class="store-paused-blocker" style="margin-bottom:10px;">
      ⛔ ${t('本店目前暫停營業中，暫時無法點餐或預訂。', 'This store is currently paused.')}
    </div>
  ` : '';

  // B14：若店家尚未開通線上 LINE Pay 金流，隱藏線上 LINE Pay，預設為「現場櫃檯付現」
  const onlineLinePayEnabled = Boolean(store && store.enableOnlineLinePay === true);
  if (!onlineLinePayEnabled && state.checkoutPayMethod === 'LINE Pay') {
    state.checkoutPayMethod = '現場櫃檯付現';
  }
  const allowPostPayHere = Boolean(store && store.allowDineInPostPay && state.checkoutDineType === '內用自取' && !isReserve);
  if (!allowPostPayHere && state.checkoutPayMethod === '內用餐後結帳') {
    state.checkoutPayMethod = '現場櫃檯付現';
  }
  const isCashSelected = state.checkoutPayMethod === '現場櫃檯付現';

  if (currentStep === 1) {
    const itemsCardsHtml = state.cartItems.map((item, idx) => {
      const hasSelections = item.selections && Object.keys(item.selections).length > 0;
      const selList = hasSelections
        ? Object.entries(item.selections).map(([k, v]) => `${trTerm(k)}: ${trTerm(v)}`).join(' · ')
        : '';
      const storeMenu = store ? (store.menus || []).find(m => String(m.id) === String(item.id)) : null;
      const canEdit = Boolean(storeMenu && storeMenu.options && Object.keys(storeMenu.options).length > 0);
      const itemSubtotal = item.price * (item.qty || 1);
      const savedNote = String(item.itemNote || '').trim();
      const isNoteOpen = state.cartOpenNoteIdx === idx;
      const notePreview = savedNote.length > 10 ? savedNote.slice(0, 10) + '…' : savedNote;

      return `
        <div class="cart-item-card">
          <div class="cart-item-top">
            <div class="cart-item-info">
              <div data-dish-name="1" class="cart-item-name">${escapeHtml(storeMenu ? trDishName(storeMenu) : trTerm(item.baseName || item.name))}</div>
              ${selList ? `<div class="cart-item-opts">${escapeHtml(selList)}</div>` : ''}
            </div>
            <div class="cart-item-price">NT$ ${itemSubtotal}</div>
          </div>

          <div class="cart-item-actions">
            <div class="cart-qty-stepper">
              <button type="button" class="cart-qty-btn" onclick="changeCartItemQty(${idx}, -1)" aria-label="減少">－</button>
              <span class="cart-qty-num">${item.qty || 1}</span>
              <button type="button" class="cart-qty-btn plus" onclick="changeCartItemQty(${idx}, 1)" aria-label="增加">＋</button>
            </div>
            <div class="cart-item-pills">
              <button type="button" class="cart-mini-pill ${savedNote || isNoteOpen ? 'has-val' : ''}" onclick="toggleCartItemNoteEditor(${idx})">
                ${savedNote ? `📝 ${escapeHtml(notePreview)}` : `＋ ${t('備註', 'Note', 'メモ', '메모')}`}
              </button>
              ${canEdit ? `<button type="button" class="cart-mini-pill edit" onclick="editCartItemOptions(${idx}, false)">${t('改規格', 'Edit', '変更', '옵션')}</button>` : ''}
              <button type="button" class="cart-mini-pill del" onclick="removeCartItem(${idx})">${t('刪除', 'Delete', '削除', '삭제')}</button>
            </div>
          </div>

          ${isNoteOpen ? `
            <div class="cart-item-note-editor">
              <input type="text" id="cartItemNoteInput-${idx}" maxlength="60" class="cart-inline-input" placeholder="${t('輸入單品備註（如：不要蔥、醬分開）', 'Item note (e.g. no scallions)', '個別メモ（ネギ抜きなど）', '개별 요청 (파 빼기 등)')}" value="${escapeHtml(item.itemNote || '')}" oninput="updateCartItemNote(${idx}, this.value)">
              <button type="button" class="cart-note-done-btn" onclick="toggleCartItemNoteEditor(${idx})">${t('完成', 'Done', '完了', '완료')}</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    let promoNoticeHtml = '';
    if (isPeakBlockedPromo) {
      promoNoticeHtml = `<div class="cart-promo-strip muted">⏰ ${t('尖峰時段（11:45–12:45）不適用離峰優惠', 'Off-peak promo unavailable during 11:45–12:45')}</div>`;
    } else if (promoActive) {
      if (store.promoMode === 'gift' || store.promoMode === 'freebie') {
        const giftDisplayName = evalPromo.giftMenuObj ? trDishName(evalPromo.giftMenuObj) : store.promoText;
        if (evalPromo.isGiftSoldOut) {
          promoNoticeHtml = `<div class="cart-promo-strip muted">ℹ️ ${t(`今日贈品「${giftDisplayName}」已贈畢`, `Freebie "${giftDisplayName}" sold out`)}</div>`;
        } else if (subtotal < minSpend) {
          promoNoticeHtml = `<div class="cart-promo-strip hint">💡 ${t(`再差 NT$${minSpend - subtotal} 即贈「${giftDisplayName}」`, `Add NT$${minSpend - subtotal} for free "${giftDisplayName}"`)}</div>`;
        } else {
          promoNoticeHtml = `
            <label class="cart-promo-gift-row">
              <div class="cart-check-left">
                <input type="checkbox" ${state.checkoutWantGift !== false ? 'checked' : ''} onchange="setCheckoutMode('checkoutWantGift', this.checked)">
                <span>🎁 ${escapeHtml(giftDisplayName)}</span>
              </div>
              <span class="cart-promo-val">${state.checkoutWantGift !== false ? 'NT$ 0' : t('不需贈品', 'Skipped')}</span>
            </label>
          `;
        }
      } else if (store.promoMode === 'discount' || store.promoMode === 'second_discount') {
        if (evalPromo.promoDiscount <= 0) {
          const hintMsg = store.promoMode === 'second_discount' && totalCount < 2
            ? t(`再點 1 份即享「${store.promoText}」`, `Add 1 more item for ${store.promoText}`)
            : t(`再差 NT$${Math.max(0, minSpend - subtotal)} 享「${store.promoText}」`, `Add NT$${Math.max(0, minSpend - subtotal)} for ${store.promoText}`);
          promoNoticeHtml = `<div class="cart-promo-strip hint">💡 ${escapeHtml(hintMsg)}</div>`;
        } else {
          promoNoticeHtml = `
            <div class="cart-promo-strip ok">
              <span>🎉 ${escapeHtml(store.promoText)}</span>
              <strong>-NT$ ${evalPromo.promoDiscount}</strong>
            </div>
          `;
        }
      }
    }

    if (evalPromo.comboDiscount > 0 && Array.isArray(evalPromo.comboAppliedRules) && evalPromo.comboAppliedRules.length > 0) {
      promoNoticeHtml += evalPromo.comboAppliedRules.map(cr => `
        <div class="cart-promo-strip ok">
          <span>🎁 ${escapeHtml(cr.name)}${cr.pairs > 1 ? ` ×${cr.pairs}` : ''}</span>
          <strong>-NT$ ${cr.amount}</strong>
        </div>
      `).join('');
    }

    const packagingCardHtml = `
      <div class="cart-section-card">
        <label class="cart-cutlery-row ${state.checkoutNeedCutlery ? 'checked' : ''}">
          <div class="cart-check-left">
            <input type="checkbox" ${state.checkoutNeedCutlery ? 'checked' : ''} onchange="setCheckoutMode('checkoutNeedCutlery', this.checked)">
            <span>🥢 ${t('需要免洗餐具', 'Disposable Cutlery', '使い捨てカトラリー', '일회용 수저')}</span>
          </div>
          <span class="cart-cutlery-fee">${storeCutleryPrice > 0 ? `+NT$ ${storeCutleryPrice}` : t('免費', 'Free', '無料', '무료')}</span>
        </label>

        ${hasNoodleInCart ? `
          <div class="cart-sub-group">
            <div class="cart-sub-label">${t('用餐方式', 'Dining Mode', '受取方法', '식사 방식')}</div>
            <div class="cart-seg-row">
              <button type="button" class="cart-seg-btn ${state.checkoutDineType === '內用自取' ? 'active' : ''}" onclick="setCheckoutMode('checkoutDineType', '內用自取')">🍽️ ${t('內用', 'Dine-in', '店内', '매장')}</button>
              <button type="button" class="cart-seg-btn ${state.checkoutDineType === '外帶自取' ? 'active' : ''}" onclick="state.currentCartRequestId=null; setCheckoutMode('checkoutDineType', '外帶自取')">🛍️ ${t('外帶 +$1', 'Takeout +$1', 'テイクアウト +$1', '포장 +$1')}</button>
            </div>
          </div>
        ` : ''}

        ${friedCountInCart > 1 ? `
          <div class="cart-sub-group">
            <div class="cart-sub-label">🍟 ${t(`炸物裝袋（共 ${friedCountInCart} 份）`, `Fried items (${friedCountInCart}): Bagging`)}</div>
            <div class="cart-seg-row">
              <button type="button" class="cart-seg-btn ${state.checkoutFriedBagPref === '炸物裝一袋' ? 'active' : ''}" onclick="state.checkoutFriedBagPref = (state.checkoutFriedBagPref === '炸物裝一袋' ? '' : '炸物裝一袋'); updateCartUI();">${state.checkoutFriedBagPref === '炸物裝一袋' ? '✓ ' : ''}🍟 ${t('裝同一袋', 'One Bag')}</button>
              <button type="button" class="cart-seg-btn ${state.checkoutFriedBagPref === '炸物分開裝' ? 'active' : ''}" onclick="state.checkoutFriedBagPref = (state.checkoutFriedBagPref === '炸物分開裝' ? '' : '炸物分開裝'); updateCartUI();">${state.checkoutFriedBagPref === '炸物分開裝' ? '✓ ' : ''}🍟 ${t('分開裝', 'Separate')}</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    listDiv.innerHTML = errorBannerHtml + pausedBannerHtml + itemsCardsHtml + promoNoticeHtml + packagingCardHtml;

    if (footerEl) {
      footerEl.innerHTML = `
        <div class="cart-footer-summary">
          <span class="cart-footer-label">${t('總計', 'Total', '合計', '총액')} (${totalCount} ${t('份', 'items', '点', '개')})</span>
          <span id="cartModalTotal" class="cart-footer-total">${discount > 0 ? `<small class="cart-footer-saved">-${discount}</small>` : ''}NT$ ${finalTotal}</span>
        </div>
        <button type="button" class="btn-tip-action cart-btn-next" ${isStorePausedCart ? 'disabled' : ''} onclick="setCartStep(2)">
          ${isStorePausedCart
            ? t('⛔ 本店暫停營業中', '⛔ Store Paused', '⛔ 営業休止中', '⛔ 영업 중지 중')
            : t('下一步 · 去結帳 ➔', 'Next · Checkout ➔', '次へ · お会計 ➔', '다음 · 결제하기 ➔')}
        </button>
      `;
    }
  } else {
    const hasActiveStoreCoupons = Boolean(store && Array.isArray(store.coupons) && store.coupons.some(c => c && c.active !== false));
    const hasFilledExtras = Boolean(
      String(state.checkoutNote || '').trim() ||
      String(state.checkoutTaxId || '').trim() ||
      (hasActiveStoreCoupons && String(state.checkoutCouponCode || '').trim())
    );
    const rawTaxDigits = String(state.checkoutTaxId || '').replace(/\D/g, '');
    const taxIdHintInner = rawTaxDigits
      ? (validateTaiwanTaxId(rawTaxDigits)
          ? `<span class="cart-hint-ok">✓ ${t('統一編號格式正確', 'Valid Taiwan Tax ID', '統一番号OK', '유효한 사업자번호')}</span>`
          : `<span class="cart-hint-err">⚠️ ${t('請輸入有效 8 碼台灣統一編號', 'Must be a valid 8-digit Taiwan Tax ID', '有効な8桁の統一番号を入力', '유효한 8자리 사업자번호를 입력하세요')}</span>`)
      : '';

    const timeCardHtml = `
      <div class="cart-section-card">
        <div class="cart-section-title">⏰ ${t('取餐時間', 'Pickup Time', '受取時間', '픽업 시간')}</div>
        <div class="cart-seg-row">
          <button type="button" class="cart-seg-btn ${!isStorePausedCart && state.checkoutTimeMode === 'NOW' ? 'active' : ''}" ${(isStorePausedCart || (store && store.canOrderNow === false)) ? 'disabled' : ''} onclick="setCheckoutMode('checkoutTimeMode', 'NOW')">
            ${isStorePausedCart
              ? t('⛔ 暫停營業', '⛔ Paused')
              : (store && store.canOrderNow === false
                ? escapeHtml(getStoreBusinessHoursStatus(store).shortPillText || t('🌙 今日已打烊', '🌙 Closed'))
                : t(`⚡ 立即製作（約 ${store ? store.avgPrepMinutes : 5} 分）`, `⚡ Now (~${store ? store.avgPrepMinutes : 5}m)`, `⚡ 今すぐ (約${store ? store.avgPrepMinutes : 5}分)`, `⚡ 바로 조리 (약 ${store ? store.avgPrepMinutes : 5}분)`))}
          </button>
          <button type="button" class="cart-seg-btn ${!isStorePausedCart && state.checkoutTimeMode === 'RESERVE' ? 'active' : ''}" ${isStorePausedCart ? 'disabled' : ''} onclick="setCheckoutMode('checkoutTimeMode', 'RESERVE')">
            📅 ${t('預訂取餐', 'Pre-order', '予約受取', '예약 픽업')}
          </button>
        </div>

        ${isReserve ? `
          <div class="cart-reserve-box">
            <div class="checkout-reserve-grid">
              <div>
                <label class="cart-mini-field-lbl">${t('日期', 'Date', '日付', '날짜')}</label>
                <input type="date" class="select-input" min="${getTodayDateStr()}" max="${getDateOffsetStr(14)}" value="${escapeHtml(state.checkoutReserveDate)}" onchange="setCheckoutMode('checkoutReserveDate', this.value)">
              </div>
              <div>
                <label class="cart-mini-field-lbl">${t('時段', 'Time', '時間', '시간')}</label>
                <select class="select-input" onchange="setCheckoutMode('checkoutReserveTime', this.value)">
                  ${reserveTimeSlots.map(timeStr => `
                    <option value="${timeStr}" ${state.checkoutReserveTime === timeStr ? 'selected' : ''}>${timeStr}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            ${isLargeOrderReserve && isCashSelected ? `
              <div class="cart-quota-tiny warn">${t(`滿 $${LARGE_ORDER_DEPOSIT_THRESHOLD} 現金預訂請於取餐前至櫃檯確認`, `Cash pre-orders $${LARGE_ORDER_DEPOSIT_THRESHOLD}+ require counter confirmation`)}</div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;

    const phoneRequired = isReserve || isCashSelected;
    const phoneCardHtml = `
      <div class="cart-section-card">
        <div class="cart-section-head">
          <span class="cart-section-title">📱 ${t('手機號碼', 'Mobile Phone', '携帯番号', '휴대폰 번호')}</span>
          <span class="${phoneRequired ? 'cart-badge-req' : 'cart-badge-opt'}">${phoneRequired ? t('必填', 'Required', '必須', '필수') : t('選填', 'Optional', '任意', '선택')}</span>
        </div>
        <input type="tel" id="checkoutPhoneInput" inputmode="tel" class="select-input" placeholder="0912345678" value="${escapeHtml(state.checkoutPhone)}" oninput="state.checkoutPhone=this.value">
      </div>
    `;

    const paymentCardHtml = `
      <div class="cart-section-card">
        <div class="cart-section-title">💳 ${t('付款方式', 'Payment Method', 'お支払い方法', '결제 수단')}</div>
        <div class="cart-pay-list">
          <button type="button" class="cart-pay-card ${state.checkoutPayMethod === '現場櫃檯付現' ? 'active' : ''}" onclick="setCheckoutMode('checkoutPayMethod', '現場櫃檯付現')">
            <div class="cart-pay-card-left">
              <span class="cart-pay-radio"></span>
              <div>
                <div class="cart-pay-name">💵 ${t('現金／現場付款', 'Cash / Pay at Counter', '現金／店頭払い', '현금 / 현장 결제')}</div>
                <div class="cart-pay-desc">${!onlineLinePayEnabled ? t('現場付現或掃立牌 LINE Pay', 'Cash or counter LINE Pay QR') : t('取餐時於櫃檯付款', 'Pay at counter upon pickup')}</div>
              </div>
            </div>
          </button>

          ${onlineLinePayEnabled ? `
            <button type="button" class="cart-pay-card ${state.checkoutPayMethod === 'LINE Pay' ? 'active' : ''}" onclick="setCheckoutMode('checkoutPayMethod', 'LINE Pay')">
              <div class="cart-pay-card-left">
                <span class="cart-pay-radio"></span>
                <div>
                  <div class="cart-pay-name">💚 ${t('線上 LINE Pay', 'Online LINE Pay', 'LINE Pay オンライン', '온라인 LINE Pay')}</div>
                  <div class="cart-pay-desc">${t('立即線上付款，免排隊結帳', 'Pay online now')}</div>
                </div>
              </div>
            </button>
          ` : ''}

          ${allowPostPayHere ? `
            <button type="button" class="cart-pay-card ${state.checkoutPayMethod === '內用餐後結帳' ? 'active' : ''}" onclick="setCheckoutMode('checkoutPayMethod', '內用餐後結帳')">
              <div class="cart-pay-card-left">
                <span class="cart-pay-radio"></span>
                <div>
                  <div class="cart-pay-name">🍽️ ${t('內用餐後結帳', 'Pay After Meal (Dine-in)', '食後カウンター会計', '식후 카운터 결제')}</div>
                  <div class="cart-pay-desc">${t('用餐完畢後至櫃檯結帳', 'Pay at counter after dining')}</div>
                </div>
              </div>
            </button>
          ` : ''}
        </div>
      </div>
    `;

    const extrasLabel = hasActiveStoreCoupons
      ? t('備註 / 統一編號 / 優惠碼', 'Note / Tax ID / Promo Code', 'メモ / 統一番号 / クーポン', '메모 / 사업자번호 / 쿠폰')
      : t('備註 / 統一編號', 'Note / Tax ID', 'メモ / 統一番号', '메모 / 사업자번호');

    const extrasHtml = `
      <div class="cart-extras-wrap">
        <button type="button" class="cart-extras-toggle" onclick="toggleCartExtras()">
          <span>${state.cartShowExtras ? '－' : '＋'} ${state.cartShowExtras ? t('收合', 'Hide') : t('新增', 'Add')} ${extrasLabel}</span>
          ${!state.cartShowExtras && hasFilledExtras ? `<span class="cart-extras-filled">${t('已填寫', 'Added')}</span>` : ''}
        </button>

        ${state.cartShowExtras ? `
          <div class="cart-section-card cart-extras-body">
            <div class="cart-extra-field">
              <label class="cart-mini-field-lbl">📝 ${t('訂單備註', 'Order Note', 'メモ', '주문 메모')}</label>
              <input type="text" class="select-input" placeholder="${t('例：飯少、湯分開、不要蔥', 'e.g. Less rice, sauce on side')}" value="${escapeHtml(state.checkoutNote)}" oninput="state.checkoutNote=this.value">
            </div>

            <div class="cart-extra-field">
              <label class="cart-mini-field-lbl">🏢 ${t('統一編號（8 碼）', 'Tax ID (8 digits)', '統一番号 (8桁)', '사업자번호 (8자리)')}</label>
              <input type="tel" id="checkoutTaxIdInput" maxlength="8" inputmode="numeric" class="select-input" style="font-family:monospace;" placeholder="24536806" value="${escapeHtml(state.checkoutTaxId || '')}" oninput="onCheckoutTaxIdInput(this.value)">
              <div id="cartTaxIdHint" class="cart-tax-hint">${taxIdHintInner}</div>
            </div>

            ${hasActiveStoreCoupons ? `
              <div class="cart-extra-field">
                <label class="cart-mini-field-lbl">🎟️ ${t('優惠碼', 'Promo Code', 'クーポンコード', '쿠폰 코드')}</label>
                <div style="display:flex; gap:6px;">
                  <input type="text" id="checkoutCouponInput" maxlength="24" class="select-input" style="text-transform:uppercase; font-family:monospace; font-weight:800;" placeholder="${t('輸入優惠碼', 'Enter code')}" value="${escapeHtml(state.checkoutCouponCode || '')}" oninput="state.checkoutCouponCode=this.value.trim().toUpperCase()">
                  <button type="button" class="btn-tip-action" style="white-space:nowrap; padding:8px 14px; background:#0F172A;" onclick="applyStudentCouponCode()">${t('套用', 'Apply', '適用', '적용')}</button>
                </div>
                ${evalPromo.matchedCoupon ? `<div class="cart-tax-hint"><span class="cart-hint-ok">✓ ${escapeHtml(evalPromo.matchedCoupon.code)} -NT$${evalPromo.couponDiscount}</span></div>` : ''}
                ${evalPromo.couponError ? `<div class="cart-tax-hint"><span class="cart-hint-err">⚠️ ${escapeHtml(evalPromo.couponError)}</span></div>` : ''}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;

    const breakdownHtml = `
      <div class="cart-breakdown-card">
        <div class="cart-breakdown-row">
          <span>${t('餐點小計', 'Subtotal', '小計', '소계')}</span>
          <span>NT$ ${subtotal}</span>
        </div>
        ${takeoutFee > 0 ? `
          <div class="cart-breakdown-row">
            <span>${t('外帶盒', 'Takeout Container', '容器代', '포장 용기')}</span>
            <span>+NT$ ${takeoutFee}</span>
          </div>
        ` : ''}
        ${cutleryFee > 0 ? `
          <div class="cart-breakdown-row">
            <span>${t('免洗餐具', 'Cutlery', 'カトラリー', '일회용 수저')}</span>
            <span>+NT$ ${cutleryFee}</span>
          </div>
        ` : ''}
        ${discount > 0 ? `
          <div class="cart-breakdown-row discount">
            <span>${t('優惠折抵', 'Discount', '割引', '할인')}</span>
            <span>-NT$ ${discount}</span>
          </div>
        ` : ''}
      </div>
    `;

    listDiv.innerHTML = errorBannerHtml + pausedBannerHtml + timeCardHtml + phoneCardHtml + paymentCardHtml + extrasHtml + breakdownHtml;

    if (footerEl) {
      const submitBtnLabel = state.isStudentSubmittingOrder
        ? t('⏳ 訂單傳送中...', '⏳ Submitting...', '⏳ 送信中...', '⏳ 전송 중...')
        : (isStorePausedCart
          ? t('⛔ 暫停營業中', '⛔ Store Paused', '⛔ 営業休止中', '⛔ 영업 중지 중')
          : `${t('確認送出訂單', 'Place Order', '注文を確定', '주문하기')} · NT$ ${finalTotal}`);
      footerEl.innerHTML = `
        <div class="cart-footer-step2">
          <button type="button" class="cart-btn-back" ${state.isStudentSubmittingOrder ? 'disabled' : ''} onclick="setCartStep(1)">← ${t('返回', 'Back', '戻る', '뒤로')}</button>
          <button type="button" id="finalSubmitOrderBtn" class="btn-tip-action cart-btn-submit ${state.isStudentSubmittingOrder ? 'btn-is-busy' : ''}" ${(isStorePausedCart || state.isStudentSubmittingOrder) ? 'disabled' : ''} onclick="submitStudentCartOrder()">
            ${submitBtnLabel}
          </button>
        </div>
      `;
    }
  }

  if (state.checkoutErrorBannerMsg) {
    listDiv.scrollTop = 0;
  }

  if (state.lang && state.lang !== 'zh-TW') {
    applyDomSystemTranslation(document.getElementById('cartModal'));
    applyDomSystemTranslation(document.getElementById('floatingCartBar'));
  }
}

async function submitStudentCartOrder() {
  if (state.isStudentSubmittingOrder) return; // 硬鎖：連點直接無視
  let store = state.stores.find(s => s.id === state.selectedStoreId);
  if (!store || state.cartItems.length === 0) return;

  ensureAudioContextUnlocked(false);
  updateBackgroundSilentAudioKeepAlive();
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) {}

  state.checkoutErrorBannerMsg = '';
  if (navigator.onLine === false) {
    state.cartStep = 2;
    state.checkoutErrorBannerMsg = '偵測到您目前處於離線模式，請恢復網路連線後再送出訂單！';
    updateCartUI();
    return;
  }

  state.isStudentSubmittingOrder = true;
  state.lastStudentSubmitTs = Date.now();
  if (!state.currentCartRequestId) {
    state.currentCartRequestId = 'REQ_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  const btn = document.getElementById('finalSubmitOrderBtn');
  const unlockSubmitBtnOnError = () => {
    state.isStudentSubmittingOrder = false;
    state.lastStudentSubmitTs = 0;
    if (btn) {
      btn.classList.remove('btn-is-busy');
      btn.disabled = false;
      btn.innerText = t('確認餐點並送出訂單', 'Place Order', '注文を確定する', '주문 확정하기');
    }
  };

  if (btn) {
    btn.classList.add('btn-is-busy');
    btn.disabled = true;
    btn.innerText = t('⏳ 訂單傳送中，請勿重複點擊...', '⏳ Submitting order, please wait...', '⏳ 送信中です。連打しないでください...', '⏳ 주문 전송 중입니다...');
  }

  try {
    if (Date.now() - (state.lastCloudSyncDoneTs || 0) > 3500) {
      try { await syncCloud(false); } catch (e) {}
      store = state.stores.find(s => s.id === state.selectedStoreId) || store;
    }

    if (store.enableOnlineLinePay !== true && state.checkoutPayMethod === 'LINE Pay') {
      state.checkoutPayMethod = '現場櫃檯付現';
    }

    if (store.isOpen === false || store.canPreOrder === false) {
      state.checkoutErrorBannerMsg = `「${store.name}」目前為暫停營業狀態，暫停現場點餐與預訂。`;
      unlockSubmitBtnOnError();
      updateCartUI();
      return;
    }

    const isReserve = state.checkoutTimeMode === 'RESERVE';
    const isCashOrder = state.checkoutPayMethod === '現場櫃檯付現';
    const cleanPhone = (state.checkoutPhone || '').replace(/\D/g, '');
    const cleanTaxId = (state.checkoutTaxId || '').replace(/\D/g, '');

    if (cleanTaxId && !validateTaiwanTaxId(cleanTaxId)) {
      state.cartStep = 2;
      state.cartShowExtras = true;
      state.checkoutErrorBannerMsg = '統一編號格式錯誤，請輸入有效之 8 碼台灣統一編號或留空。';
      unlockSubmitBtnOnError();
      updateCartUI();
      return;
    }

    if ((isReserve || isCashOrder) && !/^09\d{8}$/.test(cleanPhone)) {
      state.cartStep = 2;
      state.checkoutErrorBannerMsg = '選擇「現金／現場付款」或「預訂取餐」請填寫完整的 10 碼手機號碼（09xxxxxxxx）！';
      unlockSubmitBtnOnError();
      updateCartUI();
      return;
    }

    if (cleanPhone) {
      state.savedCustomerPhone = cleanPhone;
      try { localStorage.setItem('mealflow_saved_customer_phone_v12', cleanPhone); } catch (e) {}
    }

    const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
    const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
    const cutleryFee = (subtotal > 0 && state.checkoutNeedCutlery) ? storeCutleryPrice : 0;
    const hasNoodleInCart = cartHasNoodleItems(state.cartItems, store);
    const friedCountInCart = cartCountFriedItems(state.cartItems, store);
    const effectiveDineType = hasNoodleInCart ? (state.checkoutDineType || '內用自取') : '內用自取';
    const takeoutFee = (subtotal > 0 && hasNoodleInCart && effectiveDineType === '外帶自取') ? 1 : 0;
    const finalCustomerNote = mergeFriedBagPrefIntoNote(state.checkoutNote, friedCountInCart > 1 ? state.checkoutFriedBagPref : '');
    const evalPromo = evaluateStudentPromoAndCoupon(store, state.cartItems, subtotal, isReserve, state.checkoutReserveTime);
    const discount = Math.min(subtotal, evalPromo.promoDiscount + (evalPromo.comboDiscount || 0) + evalPromo.couponDiscount);
    const finalTotal = Math.max(0, subtotal + cutleryFee + takeoutFee - discount);
    const pickupDateVal = isReserve ? normalizeDateStr(state.checkoutReserveDate) : getTodayDateStr();

    const structuredItems = state.cartItems.map(i => normalizeOrderItemEntry({
      id: i.id,
      category: i.category || '',
      baseName: i.baseName || i.name,
      basePrice: i.basePrice !== undefined ? i.basePrice : i.price,
      price: i.price,
      qty: i.qty || 1,
      selections: i.selections || {},
      itemNote: i.itemNote || '',
      snapshotAtTs: Date.now()
    }));

    const orderDraft = {
      orderId: generateOrderToken(),
      clientRequestId: state.currentCartRequestId,
      storeId: store.id,
      storeName: store.name,
      campus: store.campus,
      studentId: isReserve ? '📅 線上預訂' : '📱 掃碼點餐',
      dineType: effectiveDineType,
      needCutlery: Boolean(state.checkoutNeedCutlery),
      cutleryFee: cutleryFee,
      takeoutFee: takeoutFee,
      subtotal: subtotal,
      discount: discount,
      finalTotal: finalTotal,
      couponCode: state.checkoutCouponCode || '',
      wantGift: state.checkoutWantGift !== false,
      isReservation: isReserve,
      pickupDate: pickupDateVal,
      pickupTime: isReserve ? state.checkoutReserveTime : getTaipeiTimeHHMM(),
      pickupTimeSlot: isReserve ? `📅 預訂 ${pickupDateVal} ${state.checkoutReserveTime}` : '⚡ 立即製作',
      paymentMethod: state.checkoutPayMethod,
      customerPhone: cleanPhone,
      customerNote: finalCustomerNote,
      taxId: cleanTaxId,
      lineUserId: (state.lineProfile && state.lineProfile.lineUserId) || '',
      customerEmail: (state.lineProfile && state.lineProfile.email) || '',
      clientDeviceId: state.clientDeviceId,
      items: structuredItems,
      structuredItems: structuredItems
    };

    if (state.checkoutPayMethod === 'LINE Pay') {
      const payRes = await requestOnlinePaymentGateway('LINE Pay', finalTotal, store.name, store.id, orderDraft.orderId, orderDraft);
      if (!payRes || !payRes.approved) {
        unlockSubmitBtnOnError();
        updateCartUI();
        return;
      }
      orderDraft.paymentAuthToken = payRes.paymentAuthToken;
      orderDraft.transactionId = payRes.transactionId;
    }

    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'submitOrder',
        ...orderDraft
      })
    });
    const data = await res.json();
    if (!data || !data.success || !data.order) {
      throw new Error((data && data.message) || '送出訂單失敗，請稍後再試');
    }

    const savedOrder = sanitizeIncomingOrder({ ...orderDraft, ...data.order, isOfflinePending: false });
    state.pendingLocalOrdersMap[savedOrder.orderId] = Date.now();
    const existIdx = state.orders.findIndex(x => x.orderId === savedOrder.orderId);
    if (existIdx >= 0) state.orders[existIdx] = savedOrder;
    else state.orders.unshift(savedOrder);
    addOrderToMyHistory(savedOrder.orderId);
    saveCachedOrders(state.orders);

    // 成功：先清空購物車與請求碼並跳轉取餐單（跳轉完成前絕不恢復按鈕）
    state.currentCartRequestId = null;
    state.cartItems = [];
    state.checkoutFriedBagPref = '';
    state.cartStep = 1;
    state.cartOpenNoteIdx = -1;
    state.cartShowExtras = false;
    if (state.cartByStoreMap && store.id) delete state.cartByStoreMap[store.id];
    saveStudentCartDraft();
    closeCartModal();
    navigateToOrderTicket(savedOrder.orderId);
    showToast(`🎉 送單成功！您的取餐號碼是 #${savedOrder.pickupNumber}`);

    setTimeout(() => {
      state.isStudentSubmittingOrder = false;
      if (btn) {
        btn.classList.remove('btn-is-busy');
        btn.disabled = false;
        btn.innerText = t('確認送出訂單', 'Place Order', '注文を確定する', '주문 확정하기');
      }
    }, 800);
  } catch (err) {
    // 失敗才解鎖按鈕，並保留 currentCartRequestId，學生重試也不會重複下單
    state.cartStep = 2;
    state.checkoutErrorBannerMsg = translateServerError(err.message || '網路異常，請再按一次確認送出');
    unlockSubmitBtnOnError();
    updateCartUI();
    showToast(`⚠️ ${state.checkoutErrorBannerMsg}`);
  }
}

// ==================== 4. 智慧選餐顧問 (v25.0 完整 4 語系支援 zh-TW / en / ja / ko) ====================
function askAiConciergePreset(presetKey) {
  const map = {
    FAST: t('我只剩 10 分鐘就要上課，推薦最快拿到的主餐', 'I only have 10 minutes before class, recommend the fastest meal', '授業まであと10分、一番早く受け取れるメニューを教えて', '수업까지 10분 남았는데 가장 빨리 나오는 메뉴 추천해 줘'),
    BUDGET: t('預算 100 元以內、有優惠的超值正餐', 'Recommend a budget meal under NT$100 with great value', '予算NT$100以内でお得なメニューをおすすめして', '예산 NT$100 이하 가성비 좋은 메뉴 추천해 줘'),
    PROTEIN: t('運動完想吃高蛋白質的大份量肉食主餐', 'High-protein, hearty meat meal after workout', '運動後に高タンパクでボリュームのある肉料理が食べたい', '운동 후 먹기 좋은 고단백 든든한 고기 메뉴 추천해 줘'),
    SPICY: t('想吃韓式、椒麻或辣味，且不用排隊的餐點', 'Something spicy or Korean-style with a short wait', '韓国風やピリ辛で並ばずにすぐ買えるメニューは？', '줄 서지 않고 먹을 수 있는 매콤하거나 한식 메뉴 추천해 줘')
  };
  return askAiConcierge(map[presetKey] || presetKey);
}

async function askAiConcierge(presetQuery) {
  const inputEl = document.getElementById('aiUserQueryInput');
  const query = (presetQuery || (inputEl ? inputEl.value.trim() : '')).trim();
  if (!query) {
    showToast(`💬 ${t('請輸入您的問題或點擊上方快捷標籤！', 'Please enter a question or tap a quick tag!', '質問を入力するか上のタグを選んでください！', '질문을 입력하거나 위 태그를 눌러 주세요!')}`);
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
  const visiblePool = getVisibleStudentStores();
  const openVisible = visiblePool.filter(s => s.isOpen !== false);
  const openCampusStores = openVisible.filter(s => s.campus === state.campus);
  const activeStoresPool = openCampusStores.length > 0 ? openCampusStores : (openVisible.length > 0 ? openVisible : visiblePool);
  if (activeStoresPool.length === 0) return;

  const curLang = getCurrentAppLang();
  const localEngineName = t('MealFlow 快速條件篩選助手', 'MealFlow Smart Meal Advisor', 'MealFlow スマートメニュー案内', 'MealFlow 스마트 메뉴 도우미');

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'askAiConcierge',
        campus: state.campus,
        query: query,
        lang: curLang
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
  const firstAvailDish = (fastestStore.menus || []).find(m => !m.soldOut) || (fastestStore.menus && fastestStore.menus[0]) || { id: 'M01', name: '招牌主餐', price: 75 };

  if (/^(你好|您好|哈囉|嗨|hi|hello|hey|help|who are you|test|在嗎|你是誰|測試|早安|午安|晚安|こんにちは|こんばんは|おはよう|안녕|안녕하세요)[！!？?\s]*$/i.test(q)) {
    const storeNames = activeStoresPool.map(s => `${trTerm(s.name)} (~${s.avgPrepMinutes}${t('分', 'm', '分', '분')})`).join(curLang === 'zh-TW' ? '、' : ', ');
    appendAiAssistantReply({
      reasoning: t(
        `👋 你好！我是 MealFlow 智慧選餐顧問。目前營業中的餐廳有：${storeNames}。你可以問我「100元內快取」、「想吃辣的」或「怎麼找回訂單？」，我會自動排除售罄品項！`,
        `👋 Hi! I'm MealFlow Smart Advisor. Open stores right now: ${storeNames}. Ask me for meals under NT$100, spicy picks, fastest pickup, or how to look up an order — sold-out items are excluded automatically!`,
        `👋 こんにちは！MealFlowメニュー案内です。現在営業中：${storeNames}。「NT$100以内」「一番早いメニュー」「ピリ辛」など気軽に聞いてください！`,
        `👋 안녕하세요! MealFlow 스마트 메뉴 도우미입니다. 현재 영업 중인 매장: ${storeNames}. "NT$100 이하", "가장 빠른 메뉴", "매콤한 메뉴" 등을 물어보세요!`
      ),
      storeId: fastestStore.id,
      menuId: firstAvailDish.id,
      engine: localEngineName
    });
    return;
  }

  if (/(預訂|預約|現金|付錢|付款|餐具|找回|查單|無痕|pre-?order|reserve|cash|pay|lookup|find order|cancel|cutlery|予約|現金|照会|예약|현금|조회)/.test(q)) {
    appendAiAssistantReply({
      reasoning: t(
        `📋 點餐與查單說明：1️⃣ 跨裝置找回訂單請輸入「6 碼防偽核銷碼」或「取餐號 + 手機末 3 碼」。2️⃣ 每張電子取餐憑證皆附有可掃描 ISO QR Code 供櫃檯秒速核銷。3️⃣ 預設為立即製作，也可於購物車切換預訂取餐！`,
        `📋 Ordering & Lookup Guide: 1) Find orders across devices using your 6-char verification code or Pickup # + last 3 phone digits. 2) Every digital ticket includes a scannable QR code for fast counter pickup. 3) Default mode is Make Now, and you can switch to Pre-order in Cart.`,
        `📋 注文・照会ガイド：1) 他端末からの照会は6桁認証コードまたは受取番号＋携帯下3桁をご利用ください。2) 電子チケットのQRコードを店頭で提示して素早く受取できます。3) 標準は即時調理で、カート内で時間指定予約も選択できます。`,
        `📋 주문 및 조회 안내: 1) 다른 기기에서 주문 조회 시 6자리 인증코드 또는 픽업번호+전화 뒤 3자리를 입력하세요. 2) 전자 티켓의 QR 코드를 카운터에 보여주면 빠르게 픽업할 수 있습니다. 3) 기본은 바로 조리이며 장바구니에서 예약 픽업으로 변경할 수 있습니다.`
      ),
      storeId: fastestStore.id,
      menuId: firstAvailDish.id,
      engine: localEngineName
    });
    return;
  }

  const candidates = [];
  activeStoresPool.forEach(s => {
    (s.menus || []).forEach(m => {
      if (m.soldOut) return;
      const nm = `${m.name || ''} ${m.nameEn || ''}`.toLowerCase();
      const cat = String(m.category || '').toLowerCase();
      const isDrinkOrSide = m.price <= 45 && /(茶|湯|飲|豆漿|豆腐|tea|soup|drink|soy milk)/.test(nm);
      let score = s.aiScore + (isDrinkOrSide ? -20 : 10);
      const hitReasons = [];

      if (/(趕|10分|快|免排隊|不排隊|fast|quick|10\s*min|hurry|short wait|早い|10分|빨리|빠른)/.test(q)) {
        score += Math.max(0, (22 - s.avgPrepMinutes) * 3.5);
        hitReasons.push(t(
          `目前佇列順暢僅需約 ${s.avgPrepMinutes} 分鐘`,
          `fast queue (~${s.avgPrepMinutes} min wait)`,
          `待ち時間わずか約${s.avgPrepMinutes}分`,
          `현재 대기 시간 약 ${s.avgPrepMinutes}분으로 빠름`
        ));
      }

      const budgetMatch = q.match(/(?:nt\$|\$)?\s*(\d{2,3})\s*(?:元|塊|以內|內|ntd|twd|bucks|dollars)?/i) || (q.includes('100') ? [null, '100'] : null);
      if (budgetMatch || /(預算|便宜|cp|優惠|折|budget|cheap|value|under|deal|promo|安い|お得|予算|예산|가성비|저렴)/.test(q)) {
        const limit = budgetMatch ? parseInt(budgetMatch[1], 10) : 100;
        const netPrice = m.price - (m.price >= AI_DISCOUNT_MIN_SUBTOTAL ? (s.promoDiscount || 0) : 0);
        if (netPrice <= limit && !isDrinkOrSide) {
          score += 42;
          hitReasons.push(t(
            `價格 NT$${m.price} 符合 $${limit} 內高划算度預算`,
            `great value at NT$${m.price} (within NT$${limit} budget)`,
            `NT$${m.price}で予算NT$${limit}以内の高コスパ`,
            `NT$${m.price}로 NT$${limit} 예산 내 가성비 우수`
          ));
        } else if (netPrice > limit) {
          score -= 30;
        }
        if (s.promoMode !== 'none' && s.promoText) {
          score += 20;
          hitReasons.push(t(`搭配「${s.promoText}」`, `with store promo`, `店舗割引あり`, `매장 할인 혜택 포함`));
        }
      }

      if (/(辣|韓|椒麻|重口味|泡菜|紅油|川味|spicy|hot|kimchi|korean|chili|辛い|ピリ辛|キムチ|매운|매콤|김치)/.test(q)) {
        const hasSpicyTag = Array.isArray(m.dietaryTags) && m.dietaryTags.includes('SPICY');
        if (hasSpicyTag || /(椒麻|泡菜|辣|紅油|蔥爆|咖哩|spicy|kimchi|curry|chili)/.test(nm)) {
          score += 55;
          hitReasons.push(t(
            `香辣夠味符合您的重口味偏好`,
            `matches your spicy & bold flavor craving`,
            `ピリ辛でしっかりした味わい`,
            `매콤하고 진한 맛 취향에 딱 맞음`
          ));
        }
      }

      if (/(肉|蛋白|運動|大份|飽|牛|豬|雞|protein|meat|workout|hearty|beef|pork|chicken|beef|タンパク|肉|満腹|단백|고기|든든)/.test(q)) {
        if (/(牛|豬|雞|燒肉|鮪魚|肉鬆|培根|火腿|卡拉|排骨|漢堡|beef|pork|chicken|tuna|bacon|ham)/.test(nm)) {
          score += 48;
          hitReasons.push(t(
            `蛋白質充足、份量飽足`,
            `protein-rich & filling main choice`,
            `タンパク質豊富で食べ応え抜群`,
            `단백질이 풍부하고 든든한 메뉴`
          ));
        }
      }

      const keywordPairs = [
        ['飯捲', 'kimbap', 'roll', 'キンパ', '김밥'],
        ['抓餅', 'pancake', 'ネギパイ', '총좌빙'],
        ['烏龍', 'udon', 'うどん', '우동'],
        ['麵', 'noodle', '麺', '면'],
        ['水餃', '鍋貼', 'dumpling', 'potsticker', '餃子', '만두'],
        ['丼', 'donburi', 'rice bowl', '丼', '덮밥'],
        ['便當', 'bento', '弁当', '도시락'],
        ['咖哩', 'curry', 'カレー', '카레'],
        ['炸', 'crispy', 'fried', '揚げ', '튀김'],
        ['湯', 'soup', 'スープ', '국'],
        ['茶', 'tea', '茶', '차']
      ];
      keywordPairs.forEach(group => {
        const matchedQ = group.find(kw => q.includes(kw));
        if (matchedQ && group.some(kw => nm.includes(kw) || cat.includes(kw))) {
          score += 65;
          hitReasons.push(t(
            `精準命中您想吃的「${matchedQ}」`,
            `matches your "${matchedQ}" craving`,
            `ご希望の「${matchedQ}」にぴったり`,
            `원하시는 "${matchedQ}" 메뉴에 정확히 일치`
          ));
        }
      });

      candidates.push({ store: s, menu: m, totalScore: Math.round(score), hitReasons });
    });
  });

  candidates.sort((a, b) => b.totalScore - a.totalScore);
  const best = candidates[0] || {
    store: fastestStore,
    menu: firstAvailDish,
    hitReasons: [t('店內熱銷且目前正常供應中', 'popular in-stock house favorite', '人気の提供中メニュー', '현재 주문 가능한 인기 메뉴')]
  };
  const alternatives = candidates.slice(1, 3);
  const bestStoreName = trTerm(best.store.name);
  const bestDishName = trDishName(best.menu);

  let queueNote = t(
    `目前「${bestStoreName}」佇列順暢，約 ${best.store.avgPrepMinutes} 分鐘即可取餐`,
    `${bestStoreName} is moving smoothly (~${best.store.avgPrepMinutes} min wait)`,
    `現在「${bestStoreName}」はスムーズで約${best.store.avgPrepMinutes}分で受取可能`,
    `현재 "${bestStoreName}" 대기 시간이 약 ${best.store.avgPrepMinutes}분으로 원활합니다`
  );
  if (busiestStore.id !== best.store.id && actualWaitDiff >= 4) {
    queueNote = t(
      `目前「${trTerm(busiestStore.name)}」需等約 ${busiestStore.avgPrepMinutes} 分，改點「${bestStoreName}」僅需 ${best.store.avgPrepMinutes} 分（省 ${actualWaitDiff} 分）`,
      `Save ~${actualWaitDiff} min vs ${trTerm(busiestStore.name)} (${busiestStore.avgPrepMinutes}m) — ${bestStoreName} is ready in ~${best.store.avgPrepMinutes}m`,
      `「${trTerm(busiestStore.name)}」(${busiestStore.avgPrepMinutes}分)より${actualWaitDiff}分短縮、約${best.store.avgPrepMinutes}分で受取可能`,
      `"${trTerm(busiestStore.name)}"(${busiestStore.avgPrepMinutes}분)보다 ${actualWaitDiff}분 절약되어 약 ${best.store.avgPrepMinutes}분 만에 픽업 가능`
    );
  }

  const whyText = best.hitReasons.length > 0
    ? best.hitReasons.join(curLang === 'zh-TW' ? '，且' : ', ')
    : t(
        `為校區內綜合評價 (${best.store.rating}★) 與出餐效率最佳的主廚招牌`,
        `top-rated (${best.store.rating}★) fast house signature`,
        `高評価(${best.store.rating}★)＆スピード提供の看板メニュー`,
        `높은 평점(${best.store.rating}★)과 빠른 조리 속도의 대표 메뉴`
      );

  appendAiAssistantReply({
    reasoning: t(
      `💡 為您推薦「${bestStoreName}」的【${bestDishName} (NT$${best.menu.price})】！原因：${whyText}。${queueNote}。`,
      `💡 Recommended: ${bestDishName} (NT$${best.menu.price}) from ${bestStoreName}! Why: ${whyText}. ${queueNote}.`,
      `💡 おすすめ：「${bestStoreName}」の【${bestDishName} (NT$${best.menu.price})】！理由：${whyText}。${queueNote}。`,
      `💡 추천 메뉴: "${bestStoreName}"의 [${bestDishName} (NT$${best.menu.price})]! 이유: ${whyText}. ${queueNote}.`
    ),
    storeId: best.store.id,
    menuId: best.menu.id,
    alternatives: alternatives.map(a => ({
      storeId: a.store.id,
      storeName: a.store.name,
      waitMin: a.store.avgPrepMinutes,
      menuId: a.menu.id,
      menuName: trDishName(a.menu),
      price: a.menu.price
    })),
    engine: localEngineName
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

  const visibleStores = getVisibleStudentStores();

  const historyHtml = state.aiChatMessages.map(msg => {
    if (msg.role === 'user') {
      return `
        <div class="chat-msg-row user">
          <div class="chat-bubble">${escapeHtml(msg.text)}</div>
        </div>
      `;
    }

    const aiResult = msg.aiResult || {};
    const targetStore = state.stores.find(s => s.id === aiResult.storeId || s.name === aiResult.storeId) || visibleStores[0] || state.stores[0];
    const targetMenu = (targetStore.menus || []).find(m => (m.id === aiResult.menuId || m.name === aiResult.menuId) && !m.soldOut)
      || (targetStore.menus || []).find(m => !m.soldOut)
      || (targetStore.menus && targetStore.menus[0])
      || { id: 'M01', name: '招牌主餐', price: 75 };

    const altHtml = Array.isArray(aiResult.alternatives) && aiResult.alternatives.length > 0
      ? `
        <div style="margin-top:8px; padding-top:6px; border-top:1px dashed var(--border); font-size:0.75rem; color:var(--text-secondary);">
          <strong style="color:#4338CA;">💡 ${t('其他快取選擇：', 'Other Fast Picks:', 'その他のおすすめ：', '다른 빠른 추천:')}</strong>
          ${aiResult.alternatives.map(alt => `
            <button type="button" onclick="enterStoreOrdering(${escapeJsAttr(alt.storeId)}, ${escapeJsAttr(alt.menuId)})" style="border:1px solid #C7D2FE; background:#EEF2FF; color:#312E81; border-radius:6px; padding:3px 8px; margin-left:4px; margin-top:4px; font-size:0.72rem; font-weight:700;">
              ${escapeHtml(trTerm(alt.storeName))}・<span data-dish-name="1">${escapeHtml(alt.menuName)}</span> ($${alt.price} / ~${alt.waitMin}${t('分', 'm', '分', '분')}) ➔
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
              🤖 ${escapeHtml(aiResult.engine || t('智慧選餐顧問', 'Smart Meal Advisor', 'AIメニュー案内', '스마트 메뉴 도우미'))}
            </span>
            <span style="font-size:0.72rem; font-weight:800; color:var(--green);">⚡ ${escapeHtml(trTerm(targetStore.name))} ${t(`約 ${targetStore.avgPrepMinutes} 分鐘取餐`, `~${targetStore.avgPrepMinutes} min pickup`, `約${targetStore.avgPrepMinutes}分`, `약 ${targetStore.avgPrepMinutes}분`)}</span>
          </div>
          <p style="font-size:0.85rem; color:var(--text-primary); line-height:1.5; margin-bottom:8px;">
            ${escapeHtml(aiResult.reasoning)}
          </p>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#FFF7ED; padding:8px 12px; border-radius:10px; border:1.5px solid #FDBA74; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="font-size:0.7rem; font-weight:800; color:var(--brand-dark);">🍽️ ${t('推薦一鍵點餐', '1-Tap Recommended Order', 'おすすめワンタップ注文', '추천 원클릭 주문')}</div>
              <strong style="font-size:0.9rem; color:var(--text-primary);">${escapeHtml(trTerm(targetStore.name))} — <span data-dish-name="1">${escapeHtml(trDishName(targetMenu))}</span></strong>
              <span style="color:var(--red); font-weight:900; margin-left:6px; font-size:0.95rem;">NT$ ${targetMenu.price}</span>
            </div>
            <button type="button" class="btn-tip-action" style="padding:7px 14px; font-size:0.8rem;" onclick="enterStoreOrdering(${escapeJsAttr(targetStore.id)}, ${escapeJsAttr(targetMenu.id)})">
              ⚡ ${t('點選此餐點 ➔', 'Order This ➔', 'これを注文 ➔', '이 메뉴 주문 ➔')}
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
        <span>🧠 ${t(`正在分析「${state.campus}」營業中店家佇列與供應中菜單...`, `Analyzing live wait times and in-stock menus...`, `リアルタイムの待ち時間と提供中メニューを分析中...`, `실시간 대기 시간과 주문 가능한 메뉴를 분석 중...`)}</span>
      </div>
    </div>
  ` : '';

  respBox.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid var(--border);">
      <span style="font-size:0.75rem; font-weight:900; color:var(--indigo);">💬 ${t(`選餐顧問對話紀錄 (${state.aiChatMessages.length} 則)`, `Advisor Chat (${state.aiChatMessages.length})`, `相談履歴 (${state.aiChatMessages.length}件)`, `추천 대화 기록 (${state.aiChatMessages.length})`)}</span>
      <button type="button" onclick="clearAiChatHistory()" style="border:none; background:transparent; color:var(--text-muted); font-size:0.72rem; font-weight:700; cursor:pointer;">🗑️ ${t('清空對話', 'Clear', 'クリア', '비우기')}</button>
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

// 一-2：顧客自助取消預約單必須等待後端明確核准 (data.success === true) 後才更新本地狀態，徹底杜絕「幽靈退單」
async function cancelMyScheduledOrder(orderId) {
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  const canSelfCancel = (
    o.status === '已接單待排程' ||
    o.status === '待付款確認' ||
    (o.status === '製作中' && o.paymentStatus !== '已付款' && o.isReservation)
  );
  if (!canSelfCancel) {
    showToast(t('⚠️ 此訂單已進入廚房備餐階段，無法線上取消，請洽詢店家櫃檯！', '⚠️ Already preparing — please contact counter to cancel.'));
    return;
  }
  const confirmed = await showAppConfirmModal({
    title: t('取消預訂訂單', 'Cancel Pre-order'),
    message: t(`確定要取消在【${o.storeName}】的預訂單 #${o.pickupNumber} 嗎？取消後將即時通知雲端並釋放限量庫存。`, `Cancel pre-order #${o.pickupNumber} at ${trTerm(o.storeName)}?`),
    confirmText: t('確定取消訂單', 'Confirm Cancel'),
    danger: true
  });
  if (!confirmed) return;

  showToast(t('⏳ 正在向雲端伺服器送出退單申請...', '⏳ Sending cancellation request...'));
  try {
    const res = await fetch(GAS_URL, {
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
    const data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.message) || '雲端伺服器拒絕取消此筆訂單');
    }
    if (data.order) {
      const idx = state.orders.findIndex(x => x.orderId === o.orderId);
      if (idx >= 0) state.orders[idx] = sanitizeIncomingOrder({ ...o, ...data.order });
    } else {
      o.status = '已取消 (顧客自助取消預約)';
      o.paymentStatus = '已退單作廢';
    }
    saveCachedOrders(state.orders);
    enrichStoresAndAi();
    renderSingleTicketView();
    updateHeaderMyOrdersBadge();
    showToast(t(`✅ 雲端已確認取消訂單 #${o.pickupNumber}`, `✅ Order #${o.pickupNumber} cancelled`));
  } catch (err) {
    showToast(`🚫 ${t('取消失敗', 'Cancel failed')}：${translateServerError(err.message || '請檢查網路連線後重試')}`);
  }
}

async function openReceiptPrintModalSafe(orderId) {
  await ensureMerchantModuleLoaded();
  if (typeof openReceiptPrintModal === 'function') {
    openReceiptPrintModal(orderId);
  }
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
            <strong data-dish-name="1">${escapeHtml(trDishName(i))}</strong>${selStr} × ${i.qty || 1}
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

  let statusHeadline = t('🍳 廚房正為您製作餐點中', '🍳 Kitchen is preparing your meal', '🍳 キッチンで調理中です', '🍳 주방에서 음식을 조리 중입니다');
  let statusColor = 'var(--brand)';
  if (isCancelled) {
    statusHeadline = `🚫 ${trTerm(o.status)}`;
    statusColor = 'var(--red)';
  } else if (isPendingPay) {
    statusHeadline = t('⏳ 待櫃檯確認付款後排程', '⏳ Pending counter payment confirmation', '⏳ 店頭での支払い確認待ち', '⏳ 카운터 결제 확인 대기 중');
    statusColor = 'var(--amber)';
  } else if (isScheduled) {
    statusHeadline = t('📅 已接單待排程（將於取餐前自動推入廚房）', '📅 Scheduled (auto-fires to kitchen before pickup)', '📅 予約受付済（受取前に自動で調理開始）', '📅 예약 접수됨 (픽업 전 자동으로 주방에 투입됩니다)');
    statusColor = 'var(--blue)';
  } else if (isReady) {
    const callN = Math.max(1, o.notifyCount || 1);
    statusHeadline = t(`🔔 您的餐點已備妥！請至櫃檯取餐 (已叫號 ${callN} 次)`, `🔔 Ready for pickup! Please come to the counter (Call #${callN})`, `🔔 お待たせしました！店頭へお越しください (${callN}回目呼出)`, `🔔 음식이 준비되었습니다! 카운터에서 픽업하세요 (${callN}회 호출)`);
    statusColor = 'var(--green)';
  } else if (isCompleted) {
    statusHeadline = t('✅ 已完成取餐，祝您用餐愉快！', '✅ Picked up! Enjoy your meal!', '✅ 受取完了！ごゆっくりお召し上がりください。', '✅ 픽업 완료! 맛있게 드세요!');
    statusColor = 'var(--text-secondary)';
  }

  const myTrackedCount = getMyTrackedOrdersList().length;
  const liveNowClock = getTaipeiTimeHHMMSS();
  const phoneLast3 = o.customerPhoneLast3 || extractPhoneLast3(o.customerPhone);

  box.innerHTML = `
    <div class="ticket-hero-card" style="${isReady ? 'border:2.5px solid var(--green); box-shadow:0 0 0 6px rgba(16,185,129,0.12);' : ''}">
      <div class="live-verify-banner">
        <span><span class="live-clock-pulse"></span>${t('防偽動態電子取餐憑證', 'Verified Live Pickup Ticket', '偽造防止リアルタイム受取チケット', '위조 방지 실시간 픽업 티켓')} (${escapeHtml(o.pickupDate)})</span>
        <span id="ticketAntiFraudClock" style="font-family:monospace; font-size:0.9rem; letter-spacing:0.5px;">${liveNowClock}</span>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
        <span style="font-size:0.76rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:4px 12px; border-radius:999px;">
          📍 ${escapeHtml(trTerm(o.storeName))}（${escapeHtml(trTerm(o.dineType || '外帶自取'))}）
        </span>
        <div style="display:flex; gap:6px;">
          ${myTrackedCount > 1 ? `
            <button type="button" onclick="openMyOrdersDrawer()" style="border:1.5px solid var(--brand); background:var(--brand-light); color:var(--brand-dark); padding:4px 10px; border-radius:999px; font-size:0.75rem; font-weight:900; cursor:pointer;">
              🧾 ${t(`切換其他訂單 (${myTrackedCount})`, `Other Orders (${myTrackedCount})`, `他の注文 (${myTrackedCount})`, `다른 주문 (${myTrackedCount})`)}
            </button>
          ` : ''}
          <button type="button" onclick="openLineBindModal()" style="border:1px solid #86EFAC; background:${state.lineProfile.isBound ? '#DCFCE7' : '#F0FDF4'}; color:#065F46; padding:4px 10px; border-radius:999px; font-size:0.75rem; font-weight:800; cursor:pointer;">
            💚 ${state.lineProfile.isBound ? t('推播已綁定', 'Alerts Linked', '通知連携済', '알림 연동됨') : t('綁定取餐推播', 'Link Pickup Alerts', '受取通知を連携', '픽업 알림 연동')}
          </button>
        </div>
      </div>

      <div style="font-size:0.84rem; color:var(--text-secondary); margin-top:12px; font-weight:700;">${t('您的專屬取餐流水號', 'Your Pickup Number', 'あなたの受取番号', '나의 픽업 번호')}</div>
      <div class="ticket-Serial" style="color:${statusColor};">#${escapeHtml(o.pickupNumber)}</div>
      <div style="font-size:1rem; font-weight:900; color:${statusColor}; margin-bottom:10px;">${escapeHtml(statusHeadline)}</div>

      ${!isCompleted && !isCancelled && (('Notification' in window && Notification.permission !== 'granted') || !state.isAudioUnlocked) ? `
        <div style="margin:10px 0; background:linear-gradient(135deg, #FEF3C7 0%, #FFFBEB 100%); border:2px solid #F59E0B; border-radius:14px; padding:12px 14px; text-align:left; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; box-shadow:0 4px 12px rgba(245,158,11,0.18);">
          <div style="flex:1; min-width:210px;">
            <div style="font-size:0.86rem; font-weight:950; color:#92400E;">🔔 ${t('防漏單必開：啟用取餐背景通知與震動', 'Enable background pickup alerts', 'バックグラウンド通知・バイブを有効化', '백그라운드 픽업 알림 및 진동 켜기')}</div>
            <div style="font-size:0.75rem; color:#B45309; font-weight:700; margin-top:2px;">${t('開啟後即使切換 App 或鎖屏，餐點做好時手機會立刻通知提醒（預設不播語音，不打擾上課）。', 'Get instant alerts even when screen is off (silent-safe by default).', '画面オフでも出来上がり時に通知されます（標準では音声なし）。', '화면이 꺼져 있어도 준비 완료 시 즉시 알림을 받습니다.')}</div>
          </div>
          <button type="button" onclick="requestBrowserNotificationPermission(); renderSingleTicketView(${escapeJsAttr(o.orderId)});" style="border:none; background:#D97706; color:#FFFFFF; padding:9px 16px; border-radius:999px; font-size:0.82rem; font-weight:950; cursor:pointer; white-space:nowrap; box-shadow:0 3px 10px rgba(217,119,6,0.3);">
            🔔 ${t('一鍵開啟取餐提醒', 'Enable Alerts', '通知を有効にする', '알림 켜기')}
          </button>
        </div>
      ` : ''}

      ${!isCompleted && !isCancelled ? `
        <div style="text-align:left; margin:8px 0;">
          <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary); margin-bottom:4px;">${t('取餐提醒音效模式（預設關閉語音，避免課堂尷尬）', 'Pickup Alert Mode (Voice off by default)', '通知サウンド設定', '알림 소리 모드')}</div>
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
            <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary);">📢 ${t('目前叫號', 'Now Serving', '現在呼出中', '현재 호출')}</div>
            <div style="font-size:1.25rem; font-weight:950; color:var(--green); margin-top:2px;">
              ${latestCalledNum !== '--' ? `#${escapeHtml(latestCalledNum)}` : t('準備中', 'Preparing', '準備中', '준비 중')}
            </div>
          </div>
          <div style="border-left:1px solid #E2E8F0; border-right:1px solid #E2E8F0;">
            <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary);">🍳 ${t('前方等候', 'Ahead of You', '前の待ち件数', '앞 대기')}</div>
            <div style="font-size:1.25rem; font-weight:950; color:${isReady ? 'var(--green)' : 'var(--brand-dark)'}; margin-top:2px;">
              ${isReady ? t('輪到您了', 'Your Turn', 'お呼び出中', '순서입니다') : isScheduled ? t('預約排程', 'Scheduled', '予約待機', '예약 대기') : t(`${ordersAheadCount} 單`, `${ordersAheadCount}`, `${ordersAheadCount}件`, `${ordersAheadCount}건`)}
            </div>
          </div>
          <div>
            <div style="font-size:0.72rem; font-weight:800; color:var(--text-secondary);">⏱️ ${t('預估剩餘', 'Est. Wait', '予想残り', '예상 대기')}</div>
            <div style="font-size:1.25rem; font-weight:950; color:var(--indigo); margin-top:2px;">
              ${isReady ? t('立即取餐', 'Pick Up Now', '今すぐ受取', '지금 픽업') : isScheduled ? escapeHtml(o.pickupTime) : t(`約 ${estRemainingMins} 分`, `~${estRemainingMins} min`, `約${estRemainingMins}分`, `약 ${estRemainingMins}분`)}
            </div>
          </div>
        </div>
      ` : ''}

      <div class="hmac-verify-badge-box ${isServerVerified ? '' : 'unverified-warning'}">
        <div style="text-align:left;">
          <div style="font-size:0.74rem; font-weight:900; color:${isServerVerified ? '#4338CA' : '#B45309'};">
            ${isServerVerified ? `🛡️ ${t('伺服器 HMAC 簽章防偽核銷碼', 'Server-Verified 6-Char Code', 'サーバー認証6桁コード', '서버 인증 6자리 코드')}` : `⚠️ ${t('門市離線單（待雲端同步核發防偽碼）', 'Offline POS Ticket (Syncing)', 'オフライン伝票（同期待ち）', '오프라인 전표 (동기화 대기)')}`}
          </div>
          <div style="font-size:0.72rem; color:#475569;">
            ${isServerVerified ? t('領餐時請供店員掃描下方 QR Code 或核對此 6 碼', 'Show QR code below or this 6-char code at pickup', '受取時に下のQRコードまたは6桁コードを提示してください', '픽업 시 아래 QR 코드 또는 6자리 코드를 제시하세요') : t('此單為店內 POS 離線建立，將於連線後自動補發雲端簽章', 'Created offline on POS; cloud signature syncs once online', 'オフライン作成済・接続後に自動同期されます', '오프라인 생성됨・연결 후 자동 동기화됩니다')}
          </div>
        </div>
        <div class="hmac-code-digits" style="${isServerVerified ? '' : 'color:#B45309; border-color:#F59E0B; font-size:1.05rem;'}">${escapeHtml(verCodeDisplay)}</div>
      </div>

      <div style="font-size:0.78rem; color:var(--text-muted);">
        ${t('訂單憑證', 'Order ID', '注文ID', '주문번호')}：${escapeHtml(o.orderId)} ・ ${t('下單時間', 'Ordered', '注文時刻', '주문시각')}：${escapeHtml(o.createdAt)}
        ${phoneLast3 ? ` ・ ${t('手機末碼', 'Phone Last 3', '携帯下3桁', '전화 뒤 3자리')}：${escapeHtml(phoneLast3)}` : ''}
      </div>

      ${isReady ? `
        <div style="margin-top:12px; background:#ECFDF5; border:1.5px solid #10B981; color:#065F46; padding:12px; border-radius:12px; font-weight:800; font-size:0.9rem;">
          🎉 ${t(`櫃檯已叫號！請出示下方 QR Code 或核銷碼 ${verCodeDisplay} 領取餐點。`, `Counter called your order! Show QR or code ${verCodeDisplay} to pick up.`, `呼出されました！QRコードまたは認証コード ${verCodeDisplay} をご提示ください。`, `호출되었습니다! QR 코드 또는 인증코드 ${verCodeDisplay}를 제시하여 픽업하세요.`)}
        </div>
      ` : ''}

      ${(o.merchantMessage || (Array.isArray(o.merchantMessages) && o.merchantMessages.length > 0)) ? `
        <div style="margin-top:12px; background:#EFF6FF; border:2px solid #3B82F6; color:#1E3A8A; padding:12px 14px; border-radius:14px; text-align:left;">
          <div style="font-size:0.82rem; font-weight:950; margin-bottom:4px;">💬 ${t('店家櫃檯即時通知', 'Message from Store Counter', '店舗からのメッセージ', '매장 카운터 메시지')}</div>
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
          <div class="step-label">${t('已接單', 'Confirmed', '受付済', '접수됨')}</div>
        </div>
        <div class="step-item ${step2Class}">
          <div class="step-dot">2</div>
          <div class="step-label">${t('排程候鍋', 'Scheduled', '予約待機', '예약 대기')}</div>
        </div>
        <div class="step-item ${step3Class}">
          <div class="step-dot">3</div>
          <div class="step-label">${t('廚房製作', 'Preparing', '調理中', '조리 중')}</div>
        </div>
        <div class="step-item ${step4Class}">
          <div class="step-dot">4</div>
          <div class="step-label">${t('叫號取餐', 'Pickup', '受取呼出', '호출 픽업')}</div>
        </div>
      </div>

      ${Array.isArray(o.statusTimeline) && o.statusTimeline.length > 0 ? `
        <div style="text-align:left; background:#F8FAFC; border:1px solid var(--border); border-radius:12px; padding:10px 14px; margin:10px 0;">
          <div style="font-size:0.76rem; font-weight:900; color:var(--text-secondary); margin-bottom:6px;">⏱️ ${t('訂單狀態歷程時間軸', 'Order Timeline', '注文ステータス履歴', '주문 진행 타임라인')}</div>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${o.statusTimeline.slice(-6).reverse().map(ev => `
              <div style="display:flex; justify-content:space-between; gap:8px; font-size:0.76rem;">
                <span style="font-weight:800; color:var(--text-primary);">• ${escapeHtml(trTerm(ev.label || ev.status || ''))}</span>
                <span style="font-family:monospace; color:var(--text-muted); white-space:nowrap;">${escapeHtml(ev.timeStr || '')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div style="text-align:left; background:var(--bg-page); padding:16px; border-radius:14px; border:1px solid var(--border); margin:16px 0;">
        <div style="font-size:0.8rem; font-weight:800; color:var(--text-secondary); margin-bottom:8px;">
          📋 ${t('點餐明細', 'Order Details', '注文明細', '주문 내역')}（${escapeHtml(trTerm(o.dineType || '外帶自取'))}${o.taxId ? ` ・ 🏢 ${t('統編', 'Tax ID', '統一番号', '사업자번호')} ${escapeHtml(o.taxId)}` : ''}${o.customerNote ? ` ・ ${t('備註', 'Note', 'メモ', '메모')}：${escapeHtml(o.customerNote)}` : ''}）
        </div>
        ${itemsHtml}
        ${o.cutleryFee > 0 ? `
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:0.84rem; color:var(--text-secondary);">
            <span>🥢 ${t('一次性免洗餐具', 'Disposable Cutlery', '使い捨てカトラリー', '일회용 수저')}</span>
            <span>+NT$ ${o.cutleryFee}</span>
          </div>
        ` : ''}
        ${o.discount > 0 ? `
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:0.84rem; color:var(--green); font-weight:700;">
            <span>🎁 ${t('優惠折抵', 'Promo Discount', '割引', '할인')}</span>
            <span>-NT$ ${o.discount}</span>
          </div>
        ` : ''}
        ${o.manualDiscount > 0 ? `
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:0.84rem; color:var(--indigo); font-weight:700;">
            <span>🏷️ ${t('櫃檯手動折讓', 'Counter Discount', '店頭割引', '카운터 할인')}</span>
            <span>-NT$ ${o.manualDiscount}</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; padding-top:10px; margin-top:6px; border-top:1px solid var(--border); font-size:1.05rem; font-weight:900;">
          <span>${t('總計金額', 'Total', '合計金額', '총 금액')} (${escapeHtml(trTerm(o.paymentMethod))}・${escapeHtml(trTerm(o.paymentStatus || '已付款'))})</span>
          <span style="color:var(--red);">NT$ ${o.finalTotal}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:8px;">
          ⏰ ${t('取餐時段', 'Pickup Slot', '受取時間', '픽업 시간')}：${escapeHtml(o.isReservation ? `${o.pickupDate} ${o.pickupTime}` : t('立即製作', 'Make Now', '今すぐ調理', '바로 조리'))}
        </div>
      </div>

      <div style="display:flex; align-items:center; justify-content:center; gap:18px; background:#FFFFFF; border:1.5px solid #CBD5E1; border-radius:14px; padding:16px; margin-bottom:16px; flex-wrap:wrap;">
        <div class="svg-qr-box" title="ISO/IEC 18004 QR Code">${inlineQrSvg}</div>
        <div style="text-align:left; max-width:270px;">
          <div style="font-size:0.9rem; font-weight:900; color:var(--text-primary); margin-bottom:4px;">📷 ${t('顧客追蹤 & 櫃檯核銷 QR Code', 'Live Tracking & Pickup QR Code', '追跡・店頭検収 QRコード', '실시간 추적 및 픽업 QR 코드')}</div>
          <p style="font-size:0.78rem; color:var(--text-secondary); line-height:1.45; margin-bottom:10px;">
            ${t('手機相機掃描即可開啟此訂單即時追蹤網頁；取餐時出示供店家平板鏡頭掃描秒速核銷。', 'Scan with phone camera to track live status, or show at the counter for instant pickup verification.', 'スマホでスキャンして進捗確認、受取時に店頭でスキャンして素早く受領できます。', '카메라로 스캔하여 실시간 상태를 확인하고 픽업 시 카운터에 제시하세요.')}
          </p>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="filter-chip" style="padding:5px 12px; font-size:0.76rem;" onclick="copyOrderUrl(${escapeJsAttr(shareUrl)})">📋 ${t('複製訂單網址', 'Copy Link', 'リンクコピー', '링크 복사')}</button>
            <button type="button" class="filter-chip" style="padding:5px 12px; font-size:0.76rem;" onclick="openReceiptPrintModalSafe(${escapeJsAttr(o.orderId)})">🖨️ ${t('電子收據小票', 'Receipt', 'レシート', '영수증')}</button>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="btn-outline" onclick="syncCloud(true)">🔄 ${t('立即刷新狀態', 'Refresh', '更新', '새로고침')}</button>
        <button type="button" class="btn-outline" style="border-color:var(--brand); color:var(--brand-dark);" onclick="reorderFromTicket(${escapeJsAttr(o.orderId)})">🔁 ${t('再買一次', 'Order Again', 'もう一度注文', '다시 주문')}</button>
        ${(isScheduled || isPendingPay) && !isCancelled ? `
          <button type="button" class="btn-danger-soft" style="padding:10px 14px; font-size:0.86rem; border-radius:12px;" onclick="cancelMyScheduledOrder(${escapeJsAttr(o.orderId)})">🚫 ${t('取消此預訂單', 'Cancel Pre-order', '予約キャンセル', '예약 취소')}</button>
        ` : ''}
        <button type="button" class="btn-primary-full" style="max-width:210px;" onclick="navigateToOrderMenu()">➕ ${t('返回學餐菜單', 'Back to Menu', 'メニューへ戻る', '메뉴로 돌아가기')}</button>
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

// ==================== 階段 3：Firebase Firestore 0.5 秒即時推播監聽引擎 ====================
window.__mfRealtimeState = {
  db: null,
  studentUnsub: null,
  studentWatchedOrderId: '',
  merchantUnsub: null,
  merchantWatchedStoreId: ''
};

function initMealFlowFirestore() {
  if (window.__mfRealtimeState.db) return window.__mfRealtimeState.db;
  const cfg = window.MEALFLOW_REALTIME_CONFIG;
  if (!cfg || !cfg.isFirebaseConfigured || !cfg.isFirebaseConfigured()) return null;
  if (!cfg.isCloudflareMode || !cfg.isCloudflareMode()) return null;
  if (typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') return null;

  try {
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(cfg.FIREBASE_CONFIG);
    }
    window.__mfRealtimeState.db = firebase.firestore();
    return window.__mfRealtimeState.db;
  } catch (err) {
    console.warn('[MealFlow Firestore] init skipped:', err);
    return null;
  }
}

function stopStudentOrderFirestoreWatch() {
  const rt = window.__mfRealtimeState;
  if (rt.studentUnsub) {
    try { rt.studentUnsub(); } catch (e) {}
    rt.studentUnsub = null;
  }
  rt.studentWatchedOrderId = '';
}

function startStudentOrderFirestoreWatch(orderId) {
  const cleanId = String(orderId || '').trim();
  const rt = window.__mfRealtimeState;
  if (!cleanId) {
    stopStudentOrderFirestoreWatch();
    return;
  }
  if (rt.studentWatchedOrderId === cleanId && rt.studentUnsub) return;

  stopStudentOrderFirestoreWatch();
  const db = initMealFlowFirestore();
  if (!db) return;

  rt.studentWatchedOrderId = cleanId;
  rt.studentUnsub = db.collection('order_status').doc(cleanId).onSnapshot(
    (snap) => {
      if (!snap || !snap.exists) return;
      const d = snap.data() || {};
      const idx = state.orders.findIndex(o => String(o.orderId) === cleanId);
      if (idx >= 0) {
        const cur = state.orders[idx];
        const nextStatus = d.status || cur.status;
        const nextNotify = Number(d.notifyCount ?? cur.notifyCount ?? 0);
        const changed = (
          cur.status !== nextStatus ||
          cur.paymentStatus !== (d.paymentStatus || cur.paymentStatus) ||
          Number(cur.notifyCount || 0) !== nextNotify
        );
        state.orders[idx] = {
          ...cur,
          status: nextStatus,
          paymentStatus: d.paymentStatus || cur.paymentStatus,
          notifyCount: nextNotify,
          readyAtTs: Number(d.readyAtTs || cur.readyAtTs || 0),
          lastCalledAtTs: Number(d.lastCalledAtTs || cur.lastCalledAtTs || 0)
        };
        saveCachedOrders(state.orders);
        checkAndAlertWatchedStudentOrders();
        updateHeaderMyOrdersBadge();
        if (changed) {
          if (state.routeMode === 'ticket' && state.trackingOrderId === cleanId) {
            renderSingleTicketView();
          } else if (state.routeMode === 'order') {
            renderStudentOrderExperience();
          }
        }
      } else {
        // 本機尚未快取此訂單明細時，立即補查完整訂單
        if (typeof tryAutoFetchMissingOrderById === 'function') {
          tryAutoFetchMissingOrderById(cleanId);
        }
      }
    },
    (err) => {
      console.warn('[MealFlow Firestore] order_status listener error:', err);
    }
  );
}

function stopMerchantLiveOrdersFirestoreWatch() {
  const rt = window.__mfRealtimeState;
  if (rt.merchantUnsub) {
    try { rt.merchantUnsub(); } catch (e) {}
    rt.merchantUnsub = null;
  }
  rt.merchantWatchedStoreId = '';
}

function startMerchantLiveOrdersFirestoreWatch(storeId) {
  const cleanStore = String(storeId || '').trim().toUpperCase();
  const rt = window.__mfRealtimeState;
  if (!cleanStore) {
    stopMerchantLiveOrdersFirestoreWatch();
    return;
  }
  if (rt.merchantWatchedStoreId === cleanStore && rt.merchantUnsub) return;

  stopMerchantLiveOrdersFirestoreWatch();
  const db = initMealFlowFirestore();
  if (!db) return;

  rt.merchantWatchedStoreId = cleanStore;
  let initialSnapshotDone = false;

  rt.merchantUnsub = db.collection('live_orders').doc(cleanStore).collection('active').onSnapshot(
    (snap) => {
      if (!snap) return;
      let anyChanged = false;

      snap.docChanges().forEach((change) => {
        const docData = change.doc.data() || {};
        const oid = String(docData.orderId || change.doc.id || '').trim();
        if (!oid) return;

        if (change.type === 'removed') {
          // 訂單已完成或取消被移出 live_orders；下一次保底 syncCloud 會同步最終歷史狀態
          anyChanged = true;
          return;
        }

        let structuredItems = [];
        try {
          structuredItems = Array.isArray(docData.structuredItems)
            ? docData.structuredItems
            : JSON.parse(docData.itemsJson || '[]');
        } catch (e) {}

        const incomingOrder = {
          ...docData,
          orderId: oid,
          structuredItems
        };

        const idx = state.orders.findIndex(o => String(o.orderId) === oid);
        if (idx >= 0) {
          state.orders[idx] = { ...state.orders[idx], ...incomingOrder };
        } else {
          state.orders.unshift(incomingOrder);
        }
        anyChanged = true;

        if (initialSnapshotDone && state.routeMode === 'store' && state.isMerchantUnlocked) {
          if (!state.knownStoreOrderIds.has(oid)) {
            state.knownStoreOrderIds.add(oid);
            if (String(incomingOrder.storeId).toUpperCase() === cleanStore && incomingOrder.status === '製作中') {
              if (typeof announceNewKdsOrder === 'function') {
                announceNewKdsOrder(incomingOrder);
              }
            }
          }
        } else {
          state.knownStoreOrderIds.add(oid);
        }
      });

      initialSnapshotDone = true;
      if (!anyChanged) return;

      saveCachedOrders(state.orders);
      if (typeof updateMerchantHeaderBadgesOnly === 'function') {
        updateMerchantHeaderBadgesOnly();
      }
      if (typeof refreshCustomerPickupBoardIfOpen === 'function') {
        refreshCustomerPickupBoardIfOpen(true);
      }
      if (state.routeMode === 'store' && state.isMerchantUnlocked && state.storeTabMode === 'kds') {
        const storeObj = state.stores.find(s => String(s.id).toUpperCase() === cleanStore);
        if (typeof renderMerchantOrdersOnly === 'function') {
          renderMerchantOrdersOnly(storeObj);
        }
      }
    },
    (err) => {
      console.warn('[MealFlow Firestore] live_orders listener error:', err);
    }
  );
}

function syncMealFlowRealtimeSubscriptions() {
  if (state.xpMode || state.xp2Mode) {
    stopStudentOrderFirestoreWatch();
    stopMerchantLiveOrdersFirestoreWatch();
    return;
  }
  const cfg = window.MEALFLOW_REALTIME_CONFIG;
  if (!cfg || !cfg.isCloudflareMode || !cfg.isCloudflareMode() || !cfg.isFirebaseConfigured || !cfg.isFirebaseConfigured()) {
    stopStudentOrderFirestoreWatch();
    stopMerchantLiveOrdersFirestoreWatch();
    return;
  }

  // 1. 學生憑證頁 / 追蹤單：監聽單一 order_status/{orderId}
  const activeStudentOrderId = state.routeMode === 'ticket'
    ? state.trackingOrderId
    : (state.routeMode === 'order' ? (state.myCreatedOrderId || '') : '');
  if (activeStudentOrderId) {
    startStudentOrderFirestoreWatch(activeStudentOrderId);
  } else {
    stopStudentOrderFirestoreWatch();
  }

  // 2. 店家後台解鎖後（或店內看板模式）：監聽 live_orders/{storeId}/active
  if ((state.routeMode === 'store' && isMerchantSessionValidNow()) || state.routeMode === 'board') {
    startMerchantLiveOrdersFirestoreWatch(state.merchantStoreId || 'S01');
  } else {
    stopMerchantLiveOrdersFirestoreWatch();
  }
}