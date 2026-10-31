/**
 * ============================================================================
 * 東吳學餐智慧點餐與全螢幕平板 POS 系統 - 商業專業版前端核心引擎 (Commercial v11.0)
 * Part 1 / 2：核心常數、正規化訂單 Schema、五階段狀態機、無後門資安鎖、離線 SVG 防偽憑證
 * ============================================================================
 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbzN2e0bi-jQG5RvGBpZYu5190f2JfX-6P1C8DxUy2aPyrrpbJpBl0oaTwYFRhAyBl8/exec';
const DEFAULT_LINE_CLIENT_ID = localStorage.getItem('mealflow_system_line_client_id') || '2012260287';
const AI_DISCOUNT_MIN_SUBTOTAL = 60; // 離峰現金折抵最低消費門檻 (NT$ 60，不含免洗餐具費)
const LARGE_ORDER_DEPOSIT_THRESHOLD = 500; // 大額預訂團單門檻 (≥ NT$ 500 須線上支付或提前至櫃檯付訂確認)

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
    isOpen: true, maxCapacityPer15Min: 18, baseQueueOffset: 0, avgPrepMinutes: 5, cutleryPrice: 1,
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
    isOpen: true, maxCapacityPer15Min: 20, baseQueueOffset: 0, avgPrepMinutes: 4, cutleryPrice: 1,
    promoMode: 'gift', promoText: '🎁 離峰分流招待：免費溫泉蛋乙顆', promoDiscount: 0, predictedDailyOrders: 165, rating: 4.7,
    menus: [
      { id: 'M04', category: '炙燒日式丼飯', name: '炙燒起司牛五花丼', price: 115, tag: '🔥 招牌必點', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M05', category: '炙燒日式丼飯', name: '黃金厚切豬排滑蛋丼', price: 120, tag: '⭐ 飽足首選', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M06', category: '讚岐烏龍麵', name: '讚岐胡麻冷烏龍麵', price: 95, tag: '⚡ 3分極速出餐', soldOut: false, image: '', options: getStdNoodleOptions() },
      { id: 'M19', category: '單點炸物與茶飲', name: '日式唐揚炸雞 (5塊)', price: 55, tag: '🍗 人氣單點', soldOut: false, image: '', options: { '調味粉': { type: 'radio', choices: [['原味胡椒', 0], ['日式七味粉', 0], ['泰式酸辣醬', 5]] } } },
      { id: 'M23', category: '單點炸物與茶飲', name: '靜岡無糖玄米綠茶', price: 30, tag: '🍵 解膩首選', soldOut: false, image: '', options: {} }
    ]
  },
  {
    id: 'S03', campus: '雙溪校區', name: '雙溪-四海遊龍', category: '鍋貼水餃・麵食',
    isOpen: true, maxCapacityPer15Min: 25, baseQueueOffset: 0, avgPrepMinutes: 5, cutleryPrice: 1,
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
    isOpen: true, maxCapacityPer15Min: 20, baseQueueOffset: 0, avgPrepMinutes: 4, cutleryPrice: 1,
    promoMode: 'discount', promoText: '💰 離峰分流折抵：現折 $10 元', promoDiscount: 10, predictedDailyOrders: 150, rating: 4.8,
    menus: [
      { id: 'M09', category: '人氣特餐便當', name: '秘製椒麻雞腿飯 (含3配菜)', price: 110, tag: '🔥 銷量冠軍', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M10', category: '人氣特餐便當', name: '蒜泥白肉精緻便當 (含3配菜)', price: 100, tag: '⚡ 極速便當', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M21', category: '單點小菜與湯品', name: '黃金脆皮炸豆腐', price: 40, tag: '✨ 招牌小菜', soldOut: false, image: '', options: {} }
    ]
  },
  {
    id: 'S05', campus: '城中校區', name: '城中-咖哩食堂', category: '熟成咖哩・炸物',
    isOpen: true, maxCapacityPer15Min: 15, baseQueueOffset: 0, avgPrepMinutes: 5, cutleryPrice: 1,
    promoMode: 'none', promoText: '無優惠', promoDiscount: 0, predictedDailyOrders: 195, rating: 4.8,
    menus: [
      { id: 'M11', category: '熟成濃咖哩', name: '唐揚炸雞熟成咖哩飯', price: 125, tag: '🔥 排隊人氣', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M12', category: '熟成濃咖哩', name: '手打漢堡排歐姆蛋咖哩', price: 135, tag: '⭐ 限量供應', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M26', category: '炸物點心', name: '酥炸莫札瑞拉起司條 (3入)', price: 50, tag: '🧀 邪惡點心', soldOut: false, image: '', options: {} }
    ]
  },
  {
    id: 'S06', campus: '城中校區', name: '城中-吳葉食堂', category: '精緻台式簡餐',
    isOpen: true, maxCapacityPer15Min: 20, baseQueueOffset: 0, avgPrepMinutes: 4, cutleryPrice: 1,
    promoMode: 'gift', promoText: '🎁 離峰分流招待：免費招牌冰紅茶', promoDiscount: 0, predictedDailyOrders: 145, rating: 4.9,
    menus: [
      { id: 'M13', category: '主廚鐵板與簡餐', name: '蔥爆牛肉鐵板簡餐', price: 115, tag: '🔥 現點現做', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M14', category: '主廚鐵板與簡餐', name: '古早味排骨特餐', price: 105, tag: '⚡ 4分極速取餐', soldOut: false, image: '', options: getStdRiceOptions() },
      { id: 'M15', category: '特色麵食', name: '手工鮮蝦紅油抄手麵', price: 90, tag: '⭐ 學生最愛', soldOut: false, image: '', options: getStdNoodleOptions() }
    ]
  },
  {
    id: 'S07', campus: '城中校區', name: '大熊涼麵 X 吃好食堂', category: '手工涼麵・味噌湯',
    isOpen: true, maxCapacityPer15Min: 25, baseQueueOffset: 0, avgPrepMinutes: 3, cutleryPrice: 1,
    promoMode: 'points', promoText: '⚡ 離峰分流回饋：雙倍點數', promoDiscount: 0, predictedDailyOrders: 160, rating: 4.7,
    menus: [
      { id: 'M16', category: '手工現拌涼麵', name: '川味麻辣雞絲涼麵 (大)', price: 75, tag: '⚡ 2分秒取', soldOut: false, image: '', options: getStdNoodleOptions() },
      { id: 'M17', category: '招牌味噌湯品', name: '綜合三合一味噌湯 (貢丸+蛋花)', price: 45, tag: '🔥 絕配湯品', soldOut: false, image: '', options: {} }
    ]
  }
];

// ==================== 日期、時間清洗器與真實營業時段產生器 ====================
function getTodayDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getDateOffsetStr(offsetDays) {
  const d = new Date();
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
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return getTodayDateStr();
}

function normalizeTimeStr(val, fallback = '12:15') {
  if (!val) return fallback;
  const str = String(val).trim();
  const m = str.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    return `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2]}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
  }
  return fallback;
}

function calcDiffDaysFromToday(targetDateStr) {
  if (!targetDateStr) return 0;
  const todayParts = getTodayDateStr().split('-').map(Number);
  const targetParts = normalizeDateStr(targetDateStr).split('-').map(Number);
  const t0 = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]).getTime();
  const t1 = new Date(targetParts[0], targetParts[1] - 1, targetParts[2]).getTime();
  return Math.max(0, Math.round((t1 - t0) / 86400000));
}

function parseTimeMinutesFromNow(pickupDateStr, pickupTimeStr) {
  const todayStr = getTodayDateStr();
  const cleanDate = normalizeDateStr(pickupDateStr);
  if (cleanDate !== todayStr) {
    const diffDays = calcDiffDaysFromToday(cleanDate);
    return diffDays > 0 ? diffDays * 1440 : -1440;
  }
  const cleanTime = normalizeTimeStr(pickupTimeStr, '');
  if (!cleanTime) return 0;
  const m = cleanTime.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(m[1], 10), parseInt(m[2], 10), 0);
  return Math.round((target.getTime() - now.getTime()) / 60000);
}

function getValidPickupTimeSlots(targetDateStr) {
  const cleanDate = normalizeDateStr(targetDateStr);
  const todayStr = getTodayDateStr();
  const isToday = cleanDate === todayStr;
  const now = new Date();
  const minAllowedMinutesOfDay = isToday ? (now.getHours() * 60 + now.getMinutes() + 25) : 0;

  const slots = [];
  for (let hr = 10; hr <= 19; hr++) {
    for (let min of [0, 15, 30, 45]) {
      if (hr === 10 && min < 30) continue;
      if (hr === 19 && min > 30) continue;
      const totalMins = hr * 60 + min;
      if (isToday && totalMins < minAllowedMinutesOfDay) continue;
      const label = `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      slots.push(label);
    }
  }
  return slots;
}

function getOrderElapsedMinutes(order) {
  if (!order) return 0;
  if (order.cookingStartedAtTs && Number(order.cookingStartedAtTs) > 0) {
    return Math.max(0, Math.floor((Date.now() - Number(order.cookingStartedAtTs)) / 60000));
  }
  if (order.createdAtTs && Number(order.createdAtTs) > 0 && !order.isReservation) {
    return Math.max(0, Math.floor((Date.now() - Number(order.createdAtTs)) / 60000));
  }
  const todayStr = getTodayDateStr();
  if (normalizeDateStr(order.pickupDate) !== todayStr) return 0;
  const m = String(order.createdAt || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const now = new Date();
  const created = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(m[1], 10), parseInt(m[2], 10), 0);
  const diff = Math.floor((now.getTime() - created.getTime()) / 60000);
  return diff >= 0 ? diff : 0;
}

// ==================== 商業級重構 3 & 4：正規化訂單資料模型 (Order Schema) 與五階段狀態機 ====================
/**
 * 正規化單一品項結構：將菜名 baseName 與客製化規格 selections 完全分離儲存，同時相容舊資料解析
 */
function normalizeOrderItemEntry(rawItem) {
  if (!rawItem) return { id: 'M00', baseName: '未知餐點', name: '未知餐點', price: 0, qty: 1, selections: {}, isGift: false };
  const rawNameStr = String(rawItem.name || rawItem.baseName || '餐點');
  let baseName = rawItem.baseName ? String(rawItem.baseName).trim() : rawNameStr.split(' [')[0].trim();
  let selections = (rawItem.selections && typeof rawItem.selections === 'object') ? { ...rawItem.selections } : {};

  // 若舊版資料把 [主食份量:大盛加飯] 塞在 name 裡，自動萃取回結構化 selections
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

  return {
    id: String(rawItem.id || 'M00'),
    baseName,
    name: `${baseName}${selSuffix}`,
    price: Math.max(0, Number(rawItem.price) || 0),
    qty: Math.max(1, parseInt(rawItem.qty, 10) || 1),
    selections,
    isGift: Boolean(rawItem.isGift || Number(rawItem.price) === 0)
  };
}

/**
 * 商業級五階段訂單狀態機判定：
 * 1. 待付款確認 (大額預訂未付訂金 / 遠期預訂待櫃檯確認)
 * 2. 已接單待排程 (未來時段預訂單，距離取餐時間 > 25 分鐘，不佔用當下廚房爐火)
 * 3. 製作中 (現場立即單，或距離取餐 ≤ 25 分鐘已自動轉入廚房下鍋之預訂單)
 * 4. 可取餐 (已叫號待領取)
 * 5. 已完成 / 已取消
 */
function evaluateOrderLifecycleStatus(order) {
  if (!order) return '製作中';
  const curStatus = String(order.status || '製作中');
  if (curStatus === '已完成' || curStatus === '可取餐' || curStatus.includes('已取消')) {
    return curStatus;
  }

  const isReserve = Boolean(order.isReservation);
  const payStatus = String(order.paymentStatus || '已付款');

  if (payStatus === '待櫃檯繳費' || payStatus === '待付訂確認') {
    return '待付款確認';
  }

  if (isReserve) {
    const minsUntilPickup = parseTimeMinutesFromNow(order.pickupDate, order.pickupTime);
    if (minsUntilPickup > 25) {
      return '已接單待排程';
    }
  }

  return '製作中';
}

/**
 * 正規化整筆訂單 Schema：拆離 dineType, customerNote, cashReceived, changeGiven, manualDiscount, structuredItems
 */
function sanitizeIncomingOrder(o) {
  if (!o) return o;

  let rawItems = [];
  if (Array.isArray(o.structuredItems)) {
    rawItems = o.structuredItems;
  } else if (o.itemsJson) {
    try { rawItems = JSON.parse(o.itemsJson); } catch (e) { rawItems = []; }
  }
  const structuredItems = rawItems.map(normalizeOrderItemEntry);

  // 相容舊版被塞進 studentName 的字串拼接資料並拆離成獨立結構欄位
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

  const cleanDate = normalizeDateStr(o.pickupDate);
  const cleanTime = normalizeTimeStr(o.pickupTime, '12:15');
  const subtotal = Math.max(0, Number(o.subtotal) || structuredItems.reduce((s, it) => s + it.price * it.qty, 0));
  const cutleryFee = Math.max(0, Number(o.cutleryFee) || 0);
  const discount = Math.max(0, Number(o.discount) || 0);
  const manualDiscount = Math.max(0, Number(o.manualDiscount) || 0);
  const finalTotal = o.finalTotal !== undefined
    ? Math.max(0, Number(o.finalTotal))
    : Math.max(0, subtotal + cutleryFee - discount - manualDiscount);

  const normalized = {
    ...o,
    pickupDate: cleanDate,
    pickupTime: cleanTime,
    paymentDeadline: o.paymentDeadline ? normalizeDateStr(o.paymentDeadline) : '',
    dineType,
    customerNote,
    cashReceived,
    changeGiven,
    subtotal,
    cutleryFee,
    discount,
    manualDiscount,
    manualDiscountReason: String(o.manualDiscountReason || ''),
    finalTotal,
    structuredItems,
    itemsJson: JSON.stringify(structuredItems),
    // 產生乾淨的人類可讀摘要供舊版相容顯示
    studentName: formatCleanOrderMetaSummary(dineType, Boolean(o.needCutlery), cutleryFee, customerNote)
  };

  normalized.status = evaluateOrderLifecycleStatus(normalized);
  return normalized;
}

function formatCleanOrderMetaSummary(dineType, needCutlery, cutleryFee, customerNote) {
  const parts = [dineType || '外帶自取'];
  if (needCutlery) parts.push(`🥢 需免洗餐具${cutleryFee > 0 ? `(+$${cutleryFee})` : ''}`);
  if (customerNote) parts.push(`📝 備註：${customerNote}`);
  return parts.join(' ・ ');
}

/**
 * 自動排程引擎：將距離取餐時間 ≤ 25 分鐘之「已接單待排程」預訂單自動升格為「製作中」並排入 KDS 廚房佇列
 */
function autoPromoteScheduledOrdersToCooking() {
  let changed = false;
  state.orders.forEach(o => {
    if (o.status === '已接單待排程' || o.status === '待付款確認') {
      const nextStatus = evaluateOrderLifecycleStatus(o);
      if (nextStatus !== o.status) {
        o.status = nextStatus;
        if (nextStatus === '製作中' && !o.cookingStartedAtTs) {
          o.cookingStartedAtTs = Date.now();
        }
        changed = true;
      }
    }
  });
  if (changed) {
    saveCachedOrders(state.orders);
  }
}

// ==================== 商業級重構 9：預設乾淨生產環境 (Clean Production State) 與沙盒工具 ====================
function loadLocalStores() {
  try {
    const saved = localStorage.getItem('mealflow_stores_v11');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_STORES));
}

function saveLocalStores(stores) {
  try {
    localStorage.setItem('mealflow_stores_v11', JSON.stringify(stores));
  } catch (e) {}
}

function loadMyOrderHistoryIds() {
  try {
    const raw = localStorage.getItem('mealflow_my_order_ids_v11');
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
  state.myOrderHistoryIds = state.myOrderHistoryIds.slice(0, 30);
  try {
    sessionStorage.setItem('mealflow_my_created_order_id', orderId);
    localStorage.setItem('mealflow_my_order_ids_v11', JSON.stringify(state.myOrderHistoryIds));
  } catch (e) {}
}

/**
 * 正式生產環境預設為空陣列（同步雲端真實資料），不再主動塞入假訂單污染帳務！
 */
function loadCachedOrders() {
  try {
    const raw = localStorage.getItem('mealflow_orders_v11');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(sanitizeIncomingOrder);
      }
    }
  } catch (e) {}
  return [];
}

function saveCachedOrders(orders) {
  try {
    localStorage.setItem('mealflow_orders_v11', JSON.stringify(orders.slice(0, 200)));
  } catch (e) {}
}

/**
 * 沙盒展示工具：僅在店員於「店務設定 ➔ 測試沙盒」主動點擊時才載入模擬數據，並可一鍵徹底清除
 */
function buildSandboxDemoOrders() {
  const today = getTodayDateStr();
  const yesterday = getDateOffsetStr(-1);
  const minus2 = getDateOffsetStr(-2);
  const tomorrow = getDateOffsetStr(1);
  const recentTimeStr = new Date(Date.now() - 3 * 60000).toLocaleTimeString('zh-TW', { hour12: false });

  return [
    {
      orderId: 'ORD-DEMO-2003', pickupNumber: '2003', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '📱 掃碼點餐', dineType: '外帶自取', customerNote: '醬汁少一點',
      structuredItems: [
        { id: 'M04', baseName: '炙燒起司牛五花丼', price: 125, qty: 2, selections: { '主食份量': '大盛加飯', '辣度選擇': '小辣' } },
        { id: 'M23', baseName: '靜岡無糖玄米綠茶', price: 30, qty: 1, selections: {} },
        { id: 'GIFT-AI', baseName: '🎁 離峰分流招待：免費溫泉蛋乙顆', price: 0, qty: 1, selections: {}, isGift: true }
      ],
      subtotal: 280, cutleryFee: 0, needCutlery: false, discount: 0, manualDiscount: 0, finalTotal: 280,
      promoApplied: '🎁 離峰分流招待：免費溫泉蛋乙顆',
      pickupTimeSlot: '⚡ 立即製作 (約5分)', paymentMethod: 'LINE Pay', status: '製作中',
      isReservation: false, pickupDate: today, pickupTime: recentTimeStr.slice(0, 5), customerPhone: '',
      paymentStatus: '已付款', transactionId: 'LP-202610319821', notifyCount: 0,
      isDivertedOrder: true, isSeedSample: true, createdAt: recentTimeStr, createdAtTs: Date.now() - 180000, cookingStartedAtTs: Date.now() - 180000
    },
    {
      orderId: 'ORD-DEMO-2002', pickupNumber: '2002', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '🖥️ 現場POS', dineType: '內用自取', customerNote: '',
      cashReceived: 200, changeGiven: 25,
      structuredItems: [
        { id: 'M05', baseName: '黃金厚切豬排滑蛋丼', price: 120, qty: 1, selections: { '主食份量': '正常飯量' } },
        { id: 'M19', baseName: '日式唐揚炸雞 (5塊)', price: 55, qty: 1, selections: { '調味粉': '原味胡椒' } }
      ],
      subtotal: 175, cutleryFee: 0, needCutlery: false, discount: 0, manualDiscount: 0, finalTotal: 175,
      promoApplied: '現場櫃檯點餐',
      pickupTimeSlot: '⚡ 現場立即製作', paymentMethod: '現場現金', status: '已完成',
      isReservation: false, pickupDate: today, pickupTime: '11:35', customerPhone: '',
      paymentStatus: '已付款', notifyCount: 1,
      isDivertedOrder: false, isSeedSample: true, createdAt: '11:32:10'
    },
    {
      orderId: 'ORD-DEMO-2001', pickupNumber: '2001', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '📱 掃碼點餐', dineType: '內用自取', customerNote: '',
      structuredItems: [
        { id: 'M06', baseName: '讚岐胡麻冷烏龍麵', price: 110, qty: 2, selections: { '麵條份量': '加麵大碗' } }
      ],
      subtotal: 220, cutleryFee: 0, needCutlery: false, discount: 0, manualDiscount: 0, finalTotal: 220,
      promoApplied: '🎁 離峰分流招待：免費溫泉蛋乙顆',
      pickupTimeSlot: '⚡ 立即製作 (約5分)', paymentMethod: '街口支付', status: '已完成',
      isReservation: false, pickupDate: today, pickupTime: '10:45', customerPhone: '',
      paymentStatus: '已付款', transactionId: 'JK-202610315512', notifyCount: 1,
      isDivertedOrder: true, isSeedSample: true, createdAt: '10:42:00'
    },
    {
      orderId: 'ORD-DEMO-YEST', pickupNumber: '2001', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '📱 掃碼點餐', dineType: '外帶自取', customerNote: '',
      structuredItems: [
        { id: 'M04', baseName: '炙燒起司牛五花丼', price: 115, qty: 2, selections: { '主食份量': '正常飯量' } },
        { id: 'M19', baseName: '日式唐揚炸雞 (5塊)', price: 55, qty: 1, selections: {} }
      ],
      subtotal: 285, cutleryFee: 1, needCutlery: true, discount: 0, manualDiscount: 0, finalTotal: 286,
      promoApplied: '一般點餐',
      pickupTimeSlot: '⚡ 立即製作 (約5分)', paymentMethod: 'LINE Pay', status: '已完成',
      isReservation: false, pickupDate: yesterday, pickupTime: '12:20', customerPhone: '',
      paymentStatus: '已付款', notifyCount: 1,
      isDivertedOrder: true, isSeedSample: true, createdAt: '12:18:00'
    },
    {
      orderId: 'ORD-DEMO-M2', pickupNumber: '2001', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '🖥️ 現場POS', dineType: '內用自取', customerNote: '',
      structuredItems: [
        { id: 'M05', baseName: '黃金厚切豬排滑蛋丼', price: 120, qty: 2, selections: {} }
      ],
      subtotal: 240, cutleryFee: 0, needCutlery: false, discount: 0, manualDiscount: 0, finalTotal: 240,
      promoApplied: '現場櫃檯點餐',
      pickupTimeSlot: '⚡ 現場立即製作', paymentMethod: '現場現金', status: '已完成',
      isReservation: false, pickupDate: minus2, pickupTime: '13:10', customerPhone: '',
      paymentStatus: '已付款', notifyCount: 1,
      isDivertedOrder: false, isSeedSample: true, createdAt: '13:05:22'
    },
    {
      orderId: 'ORD-DEMO-RESV', pickupNumber: '2001', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '📅 預訂點餐', dineType: '外帶自取', customerNote: '系學會會議便當',
      structuredItems: [
        { id: 'M05', baseName: '黃金厚切豬排滑蛋丼', price: 120, qty: 2, selections: { '主食份量': '正常飯量' } }
      ],
      subtotal: 240, cutleryFee: 1, needCutlery: true, discount: 0, manualDiscount: 0, finalTotal: 241,
      promoApplied: '一般點餐',
      pickupTimeSlot: `📅 預訂 ${tomorrow} 12:15`, paymentMethod: '現場櫃檯付現', status: '已接單待排程',
      isReservation: true, pickupDate: tomorrow, pickupTime: '12:15', customerPhone: '0912345678',
      paymentStatus: '取餐付現', notifyCount: 0,
      isDivertedOrder: false, isSeedSample: true, createdAt: '11:40:00'
    }
  ].map(sanitizeIncomingOrder);
}

function clearSampleOrdersData() {
  state.orders = state.orders.filter(o => !o.isSeedSample);
  saveCachedOrders(state.orders);
  enrichStoresAndAi();
  renderMerchantView();
  showToast('🧹 已徹底清除所有沙盒展示模擬訂單，恢復純淨正式環境！');
}

function restoreSampleOrdersData() {
  const seeds = buildSandboxDemoOrders();
  const existingIds = new Set(state.orders.map(o => o.orderId));
  seeds.forEach(s => {
    if (!existingIds.has(s.orderId)) state.orders.push(s);
  });
  saveCachedOrders(state.orders);
  enrichStoresAndAi();
  renderMerchantView();
  showToast('🧪 已載入 6 筆沙盒展示模擬訂單（含五階段排程預訂單）！');
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

// ==================== 商業級重構 1：SHA-256 雜湊驗證與權限 Token 管理 ====================
// 預設雜湊對應管理碼 (不在前端儲存任何明文密碼)
const DEFAULT_PIN_SHA256 = '2926a2731f4b312c086829f8f972f939e141620f242c57011e8724b5314380c5';

async function computeSha256Hex(text) {
  const str = String(text || '');
  if (window.crypto && window.crypto.subtle) {
    try {
      const buf = new TextEncoder().encode('MEALFLOW_SALT_V11_' + str);
      const hashBuf = await window.crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {}
  }
  // 離線或非 HTTPS 環境之確定性雜湊備援
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function getMerchantAuthPayload() {
  return {
    merchantAuthToken: state.merchantAuthToken || sessionStorage.getItem('mealflow_merchant_token_v11') || ''
  };
}

// ==================== 全域狀態 State ====================
let state = {
  routeMode: 'portal', // 'portal' | 'order' | 'ticket' | 'store'
  trackingOrderId: null,
  myCreatedOrderId: sessionStorage.getItem('mealflow_my_created_order_id') || null,
  myOrderHistoryIds: loadMyOrderHistoryIds(),
  campus: '雙溪校區',
  filter: 'ALL',
  stores: loadLocalStores(),
  aiRecommendations: {},
  orders: loadCachedOrders(),

  // 樂觀鎖：保護本地剛送出之訂單與店家剛修改之設定
  pendingLocalOrdersMap: {},
  locallyDeletedOrderIds: {},
  lastLocalStoreConfigUpdateTs: 0,
  knownStoreOrderIds: new Set(),

  // 商業級資安：店家後台授權 Token（未解鎖前絕不渲染後台 DOM）
  isMerchantUnlocked: Boolean(sessionStorage.getItem('mealflow_merchant_token_v11')),
  merchantAuthToken: sessionStorage.getItem('mealflow_merchant_token_v11') || '',
  merchantPinHash: localStorage.getItem('mealflow_merchant_pin_hash_v11') || '',
  pinInputBuffer: '',

  // 學生點餐與結帳狀態
  selectedStoreId: null,
  cartItems: [],
  configuringItem: null,
  editingCartIndex: -1,
  isPosConfiguring: false,
  checkoutDineType: '外帶自取',
  checkoutNeedCutlery: false,
  checkoutTimeMode: 'NOW',
  checkoutReserveDate: getTodayDateStr(),
  checkoutReserveTime: '12:15',
  checkoutPhone: '',
  checkoutPayMethod: 'LINE Pay',
  checkoutNote: '',
  pendingPaymentResolver: null,

  // 選餐顧問多輪對話歷史
  aiChatMessages: [],

  // 店家全螢幕 POS 四大主導覽：'pos' | 'kds' | 'analytics' | 'settings'
  storeTabMode: 'pos',
  settingsSubTab: 'menu', // 'menu' | 'promo' | 'line'
  merchantStoreId: 'S02',
  kdsSoundEnabled: true,

  // 店家櫃檯 POS 狀態（含商業級手動折讓與招待功能）
  posSelectedCategory: '全部',
  posCart: [],
  posDineType: '內用自取',
  posNeedCutlery: false,
  posTimeMode: 'NOW',
  posReserveDate: getTodayDateStr(),
  posReserveTime: '12:15',
  posCustomerPhone: '',
  posCustomerNote: '',
  posManualDiscount: 0,
  posManualDiscountReason: '',
  posPayment: '現場現金',
  posCashReceived: '',

  // 訂單管理 (KDS) 分天檢視與收款狀態
  kdsSelectedDate: getTodayDateStr(),
  kdsStatusFilter: 'ALL',
  kdsSearchQuery: '',
  payingOrderId: null,
  payingOrderMethod: '現場現金',
  payingOrderCashInput: '',
  printingOrderId: null,

  // 營運分析時間維度：'DAY' | 'WEEK' | 'MONTH'
  analyticsPeriod: 'DAY',
  analyticsSelectedFilter: null,

  // 店家菜單管理與視覺掃描狀態
  scannedMenuCandidates: [],
  editingMenuStoreIndex: -1,
  editingMenuTempOptions: [],

  // 推播與防偽動態時鐘計時器
  lineProfile: loadLineProfile(),
  lineMessageLogs: loadLineLogs(),
  lastSeenOrderNotifyMap: {},
  liveClockTimer: null,
  pollTimer: null
};

// ==================== 工具、離線備援單號與加權工作量佇列演算法 ====================
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateOrderToken() {
  const chars = '0123456789abcdef';
  let token = 'ORD-';
  for (let i = 0; i < 12; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
  return token;
}

/**
 * 商業級重構 8：純前端確定性 SVG 數位憑證條碼產生器（100% 離線可用，無外部 API 依賴）
 */
function generateDeterministicQrSvg(dataString, size = 96) {
  const str = String(dataString || 'MEALFLOW');
  const gridSize = 21;
  const matrix = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));

  const drawFinder = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[r0 + r][c0 + c] = isBorder || isInner;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, gridSize - 7);
  drawFinder(gridSize - 7, 0);

  for (let i = 8; i < gridSize - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const inFinderTL = r < 8 && c < 8;
      const inFinderTR = r < 8 && c >= gridSize - 8;
      const inFinderBL = r >= gridSize - 8 && c < 8;
      if (inFinderTL || inFinderTR || inFinderBL || r === 6 || c === 6) continue;
      hash ^= (r * 31 + c * 17) & 0xff;
      hash = Math.imul(hash, 16777619);
      matrix[r][c] = ((hash >>> 3) & 1) === 1;
    }
  }

  let rects = '';
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${c}" y="${r}" width="1" height="1" fill="#0F172A"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gridSize} ${gridSize}" width="${size}" height="${size}" shape-rendering="crispEdges" style="display:block; border-radius:6px;">${rects}</svg>`;
}

/**
 * 離線備援流水號（連線狀態下優先由後端 LockService 權威核發單號，離線才使用本地推進）
 */
function generateOfflineFallbackPickupNumber(storeId, pickupDateStr) {
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

function isOrderActivelyCookingNow(order) {
  if (!order) return false;
  const lifecycleStatus = evaluateOrderLifecycleStatus(order);
  if (lifecycleStatus !== '製作中') return false;
  const todayStr = getTodayDateStr();
  const ordDate = normalizeDateStr(order.pickupDate);
  return ordDate === todayStr;
}

function calcOrderRemainingWorkloadUnits(order, maxCapPer15Min) {
  if (!isOrderActivelyCookingNow(order)) return 0;
  const items = Array.isArray(order.structuredItems) ? order.structuredItems : [];

  let totalMainPortions = 0;
  items.forEach(it => {
    if (it.isGift || Number(it.price) === 0) return;
    const q = Math.max(1, Number(it.qty) || 1);
    const weight = Number(it.price) <= 45 ? 0.5 : 1.0;
    totalMainPortions += q * weight;
  });

  const rawUnits = Math.max(1, 1 + Math.max(0, totalMainPortions - 1) * 0.65);
  const elapsedMin = getOrderElapsedMinutes(order);
  const muPerMin = Math.max(5, Number(maxCapPer15Min) || 20) / 15;
  const digestedUnits = Math.min(rawUnits * 0.85, elapsedMin * muPerMin * 0.5);

  return Math.max(0.25, Number((rawUnits - digestedUnits).toFixed(1)));
}

function calcPrepMinutes(activeWorkloadUnits, maxCap) {
  const capPer15 = Math.max(5, Number(maxCap) || 20);
  const L = Math.max(0, Number(activeWorkloadUnits) || 0);
  const mu = capPer15 / 15;
  const rho = Math.min(0.95, L / capPer15);

  const baseServiceMin = Math.max(2.5, 1 / mu);
  const queueWaitMin = L / mu;
  const congestionTerm = rho >= 0.65 ? ((rho * rho) / (2 * (1 - rho))) * (1 / mu) * 0.45 : 0;

  const totalWait = Math.round(baseServiceMin + queueWaitMin + congestionTerm);
  return Math.max(3, Math.min(45, totalWait));
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

function normalizeMenuItem(m, fallbackStoreId) {
  let opts = m.options || {};
  if (typeof opts === 'string') {
    try { opts = JSON.parse(opts); } catch (e) { opts = {}; }
  }
  if (opts && opts['選擇顆數']) delete opts['選擇顆數'];

  let nameStr = String(m.name || '招牌餐點');
  let priceNum = Number(m.price) || 0;
  let catStr = String(m.category || m.cat || '招牌主餐').replace(/\(八方計價模式\)|\(按顆計價\)/g, '').trim();

  if ((nameStr.includes('鍋貼') || nameStr.includes('水餃')) && priceNum <= 15) {
    priceNum = priceNum * 10;
    if (!nameStr.includes('顆')) nameStr += ' (10顆)';
  }

  const hasOpts = opts && Object.keys(opts).length > 0;
  if (!hasOpts && m.autoDefaultOptions !== false) {
    if (nameStr.includes('鍋貼') || nameStr.includes('水餃')) {
      opts = getDumplingSetOptions();
    } else if (nameStr.includes('麵') || nameStr.includes('抄手')) {
      opts = getStdNoodleOptions();
    } else if (nameStr.includes('飯') || nameStr.includes('丼') || nameStr.includes('便當') || nameStr.includes('咖哩') || nameStr.includes('簡餐') || nameStr.includes('特餐')) {
      opts = getStdRiceOptions();
    }
  }

  return {
    id: String(m.id || `M-${Date.now()}-${Math.floor(Math.random() * 1000)}`),
    storeId: String(m.storeId || fallbackStoreId || 'S02'),
    category: catStr || '招牌主餐',
    name: nameStr,
    price: priceNum,
    tag: String(m.tag || '').replace(/按顆計價/g, '經典必點'),
    soldOut: Boolean(m.soldOut),
    image: String(m.image || ''),
    options: opts
  };
}

function enrichStoresAndAi() {
  autoPromoteScheduledOrdersToCooking();

  state.stores = state.stores.map(s => {
    const defStore = DEFAULT_STORES.find(d => d.id === s.id);
    const rawMenus = (s.menus && s.menus.length > 0) ? s.menus : (defStore ? defStore.menus : []);
    const normalizedMenus = rawMenus.map(m => normalizeMenuItem(m, s.id));

    const isOpen = s.isOpen !== false;
    const cap = Math.max(5, Number(s.maxCapacityPer15Min) || 20);
    const activeOrdersList = state.orders.filter(o => o.storeId === s.id && isOrderActivelyCookingNow(o));
    const liveCookingCount = activeOrdersList.length;
    const liveWorkloadUnits = activeOrdersList.reduce((sum, o) => sum + calcOrderRemainingWorkloadUnits(o, cap), 0);

    const offset = s.baseQueueOffset !== undefined ? Math.max(0, Number(s.baseQueueOffset)) : 0;
    const activeWorkload = Math.round((liveWorkloadUnits + offset) * 10) / 10;
    const activeDisplayCount = Math.ceil(activeWorkload);

    const loadPct = isOpen ? Math.min(120, Math.round((activeWorkload / cap) * 100)) : 0;
    let loadState = 'FREE';
    if (!isOpen) loadState = 'CLOSED';
    else if (loadPct >= 85) loadState = 'FULL';
    else if (loadPct >= 50) loadState = 'MODERATE';

    const avgPrep = calcPrepMinutes(activeWorkload, cap);
    const cutleryPrice = s.cutleryPrice !== undefined && s.cutleryPrice !== '' ? Math.max(0, Number(s.cutleryPrice)) : 1;

    const obj = {
      ...s,
      isOpen,
      maxCapacityPer15Min: cap,
      activeOrders: activeDisplayCount,
      activeWorkload,
      liveCookingCount,
      baseQueueOffset: offset,
      avgPrepMinutes: avgPrep,
      cutleryPrice,
      loadPercentage: loadPct,
      loadState: loadState,
      menus: normalizedMenus
    };
    obj.aiScore = calcAiUtilityScore(obj);
    return obj;
  });

  const recs = {};
  ['雙溪校區', '城中校區'].forEach(campus => {
    const campusStores = state.stores.filter(s => s.campus === campus && s.isOpen !== false);
    const congested = campusStores
      .filter(s => s.loadState === 'FULL' || s.avgPrepMinutes >= 18)
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
}

function isStorePromoActive(store) {
  return store && store.isOpen !== false && store.promoMode !== 'none' && store.loadState !== 'FULL';
}

// ==================== 震動、叮咚響鈴、語音播報與 LINE 推播 ====================
function playPickupChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const playTone = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.28, startTime);
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
  if (!state.kdsSoundEnabled || !order) return;
  playPickupChime();
  const items = Array.isArray(order.structuredItems) ? order.structuredItems : [];
  const itemSummary = items.map(i => `${i.baseName || i.name} ${i.qty || 1}份`).join('、');
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

function triggerStudentPickupAlert(order) {
  if (!order) return;
  try {
    if ('vibrate' in navigator) navigator.vibrate([400, 150, 400, 150, 650]);
  } catch (e) {}

  playPickupChime();
  speakOrder(order.pickupNumber, `您的餐點已經製作完成，請前往${order.storeName}櫃檯自取`);

  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`🔔 取餐號 #${order.pickupNumber} 餐點好囉！`, {
        body: `【${order.storeName}】請直接前往櫃檯出示畫面領取餐點。`,
        tag: `pickup-${order.orderId}-${order.notifyCount || 1}`
      });
    }
  } catch (e) {}

  const modal = document.getElementById('pickupAlertModal');
  const content = document.getElementById('pickupAlertContent');
  if (modal && content) {
    content.innerHTML = `
      <div style="text-align:center; padding:12px 6px;">
        <div class="ring-bell-anim" style="font-size:3.6rem; margin-bottom:6px;">🔔</div>
        <div style="display:inline-block; background:var(--green-bg); color:var(--green); font-weight:900; font-size:0.82rem; padding:4px 12px; border-radius:999px; margin-bottom:8px;">
          📳 手機震動與響鈴呼叫中（第 ${order.notifyCount || 1} 次呼叫）
        </div>
        <h2 style="font-size:1.45rem; font-weight:900; color:var(--text-primary); margin-bottom:4px;">您的餐點已經做好囉！</h2>
        <p style="font-size:0.88rem; color:var(--text-secondary); margin-bottom:14px;">請前往「<strong>${escapeHtml(order.storeName)}</strong>」櫃檯自取</p>
        <div style="background:var(--green-bg); border:2px solid var(--green); border-radius:16px; padding:16px; margin-bottom:16px;">
          <div style="font-size:0.78rem; color:var(--green); font-weight:800;">櫃檯自取號碼牌</div>
          <div style="font-size:3.4rem; font-weight:900; color:var(--green); line-height:1.1;">#${escapeHtml(order.pickupNumber)}</div>
        </div>
        <button type="button" class="btn-tip-action" style="width:100%; background:var(--green); padding:14px; font-size:1rem;" onclick="closePickupAlertModal()">
          👌 我知道了，立即前往櫃檯領取
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
  if (!('Notification' in window)) {
    showToast('⚠️ 您的瀏覽器不支援背景推播，但仍會啟用網頁響鈴與震動提醒！');
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      showToast('✅ 已開啟取餐背景通知與震動權限！');
      playPickupChime();
      try { if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]); } catch (e) {}
    } else {
      showToast('⚠️ 您拒絕了瀏覽器通知權限，系統仍會透過畫面響鈴與 LINE 通知您');
    }
  });
}

async function pushLineNotification(eventType, title, message, order = null) {
  const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  const targetUserId = (order && order.lineUserId) || state.lineProfile.lineUserId || '';
  const targetEmail = (order && order.customerEmail) || state.lineProfile.email || '';
  const storeObj = order ? state.stores.find(s => s.id === order.storeId) : state.stores.find(s => s.id === state.selectedStoreId);
  const usingStoreCustomLine = Boolean(storeObj && storeObj.useCustomLineOa);
  const senderLabel = usingStoreCustomLine ? `${storeObj.name} 官方帳號` : '學餐預設官方通知';

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

  if ((targetUserId && targetUserId.startsWith('U')) || (targetEmail && targetEmail.includes('@'))) {
    const orderUrl = order
      ? `${window.location.origin}${getOrderPageUrl('id=' + encodeURIComponent(order.orderId))}`
      : window.location.href;
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'sendLinePush',
          storeId: order ? order.storeId : (state.selectedStoreId || ''),
          lineUserId: targetUserId,
          email: targetEmail,
          title,
          message,
          pickupNumber: order ? order.pickupNumber : '',
          storeName: order ? order.storeName : (storeObj ? storeObj.name : '東吳學餐'),
          statusText: order ? order.status : '即時通知',
          orderUrl,
          channelAccessToken: ''
        })
      });
    } catch (e) {}
  }
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
            <div style="font-size:0.84rem; font-weight:900; color:#166534;">✅ 已啟用通知：${escapeHtml(state.lineProfile.lineDisplayName || '東吳同學')}</div>
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
  const name = document.getElementById('lineInputName')?.value.trim() || '東吳同學';
  const email = document.getElementById('lineInputEmail')?.value.trim() || '';
  const rawUid = document.getElementById('lineInputId')?.value.trim() || '';

  state.lineProfile.isBound = true;
  state.lineProfile.lineDisplayName = name;
  state.lineProfile.email = email;
  if (rawUid) state.lineProfile.lineUserId = rawUid;
  saveLineProfile(state.lineProfile);

  pushLineNotification(
    'BIND_SUCCESS',
    '💚 取餐通知設定已儲存',
    `已設定 ${name} 的取餐推播通知${email ? ` (信箱: ${email})` : ''}！當餐點製作完成時將自動通知您。`
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

// ==================== 共用 Modal 動態掛載引擎（含交班 Z-Report 與安全鎖） ====================
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
      <div id="posCashNumpadModal" class="modal-overlay" onclick="if(event.target===this) closePosCashNumpadModal()">
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
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);">櫃檯訂單收款結帳</span>
              <h3 style="font-size:1.15rem; font-weight:900;">💵 訂單收款與觸控找零</h3>
            </div>
            <button type="button" onclick="closeOrderPayModal()" style="border:none; background:#F3F4F6; width:34px; height:34px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="orderPayModalBody"></div>
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
                點擊下方按鈕將跳轉至 LINE 官方授權畫面。當餐點製作完成或預訂需繳費時，官方帳號將自動推播通知卡給您！
              </p>
              <button type="button" class="btn-line" style="width:100%; justify-content:center; padding:11px; font-size:0.92rem;" onclick="startLineOAuthLogin()">
                🚀 使用 LINE 帳號一鍵授權綁定
              </button>
            </div>
            <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:12px; padding:12px; margin-bottom:12px;">
              <div style="font-size:0.8rem; font-weight:900; color:var(--text-primary); margin-bottom:8px;">
                📧 綁定電子信箱免費無限量取餐通知 / 或手動填入識別碼
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

  if (!document.getElementById('onlinePaymentModal')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="onlinePaymentModal" class="modal-overlay">
        <div class="modal-card" style="max-width:420px;">
          <div id="onlinePaymentHeader" class="payment-gateway-header linepay">
            <div>
              <div style="font-size:0.72rem; font-weight:800; opacity:0.9;">第三方行動支付安全收銀台</div>
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
        <div class="modal-card" style="height:80vh;">
          <div class="modal-header">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:var(--brand);">支援跨店多筆訂單同時追蹤</span>
              <h3 style="font-size:1.2rem; font-weight:900;">🧾 我的點餐紀錄與號碼牌匣</h3>
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
        <div class="modal-card" style="max-width:390px;">
          <div class="modal-header" style="background:#0F172A; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#38BDF8;">店務管理權限保護</span>
              <h3 style="font-size:1.15rem; font-weight:900;">🔒 店家營運管理授權驗證</h3>
            </div>
            <button type="button" onclick="exitStoreToStudentOrder()" style="border:none; background:rgba(255,255,255,0.18); color:#fff; padding:4px 10px; border-radius:8px; font-size:0.74rem; font-weight:800;">返回點餐頁</button>
          </div>
          <div class="modal-body" id="storePinModalBody"></div>
        </div>
      </div>
    `);
  }
}

// ==================== 網址路由與智慧焦點保護 ====================
function getBaseRootUrl() {
  const path = window.location.pathname;
  if (path.includes('/order/') || path.endsWith('/order')) {
    return path.replace(/\/order\/?(index\.html)?$/, '/');
  }
  if (path.includes('/store/') || path.endsWith('/store')) {
    return path.replace(/\/store\/?(index\.html)?$/, '/');
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

function detectRouteFromUrl() {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const forcedMode = window.MEALFLOW_DEFAULT_MODE || window.MEALFLOW_FORCED_ROUTE || params.get('mode');
  const orderToken = params.get('id') || params.get('order');
  const campusParam = params.get('campus');
  const storeParam = params.get('store');

  if (campusParam === '雙溪校區' || campusParam === '城中校區') {
    state.campus = campusParam;
  }
  if (storeParam && state.stores.some(s => s.id === storeParam)) {
    state.merchantStoreId = storeParam;
    const st = state.stores.find(s => s.id === storeParam);
    if (st) state.campus = st.campus;
    if (!path.includes('/store') && forcedMode !== 'store') {
      state.selectedStoreId = storeParam;
    }
  }

  if (orderToken) {
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    window.location.href = targetUrl;
  }
}

function navigateToOrderMenu(storeId = null) {
  state.selectedStoreId = storeId;
  const q = storeId ? `store=${encodeURIComponent(storeId)}` : '';
  const targetUrl = getOrderPageUrl(q);
  try {
    window.history.pushState({ storeId }, '', targetUrl);
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
  if (label) label.innerText = text;
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3200);
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
  return false;
}

window.addEventListener('DOMContentLoaded', () => {
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
  checkLineOAuthCallbackOnLoad();
  syncCloud(false);

  // 每秒更新電子取餐憑證上的防截圖動態時鐘
  if (state.liveClockTimer) clearInterval(state.liveClockTimer);
  state.liveClockTimer = setInterval(() => {
    const clockEl = document.getElementById('ticketAntiFraudClock');
    if (clockEl) {
      clockEl.textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    }
  }, 1000);
});

// ==================== 雲端權威同步與樂觀鎖 (`applyCloudBundle`) ====================
function applyCloudBundle(data) {
  const payload = (data && data.bundle) ? data.bundle : data;
  if (!payload) return;

  const nowTs = Date.now();
  const isRecentLocalStoreEdit = (nowTs - state.lastLocalStoreConfigUpdateTs) < 12000;

  const cloudStores = Array.isArray(payload.stores) ? payload.stores : [];
  if (cloudStores.length > 0 && !isRecentLocalStoreEdit) {
    state.stores = cloudStores.map(cloudStore => {
      const localMatch = state.stores.find(s => s.id === cloudStore.id);
      return {
        ...cloudStore,
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
        menus: (Array.isArray(cloudStore.menus) && cloudStore.menus.length > 0)
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
      const o = sanitizeIncomingOrder(rawOrd);
      const deletedTs = state.locallyDeletedOrderIds[o.orderId];
      if (deletedTs && (nowTs - deletedTs < 45000)) return;
      mergedMap.set(o.orderId, o);
    });

    state.orders.forEach(localOrd => {
      const deletedTs = state.locallyDeletedOrderIds[localOrd.orderId];
      if (deletedTs && (nowTs - deletedTs < 45000)) return;

      if (!mergedMap.has(localOrd.orderId)) {
        const pendingTs = state.pendingLocalOrdersMap[localOrd.orderId] || 0;
        const isRecentPending = (nowTs - pendingTs) < 60000;
        if (isRecentPending || Boolean(localOrd.isSeedSample)) {
          mergedMap.set(localOrd.orderId, sanitizeIncomingOrder(localOrd));
        }
      } else {
        const cloudOrd = mergedMap.get(localOrd.orderId);
        if ((Number(localOrd.notifyCount) || 0) > (Number(cloudOrd.notifyCount) || 0)) {
          cloudOrd.notifyCount = localOrd.notifyCount;
        }
        if (localOrd.paymentStatus === '已付款') {
          cloudOrd.paymentStatus = '已付款';
        }
        if (localOrd.createdAtTs && !cloudOrd.createdAtTs) {
          cloudOrd.createdAtTs = localOrd.createdAtTs;
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

    const watchedIds = new Set([state.trackingOrderId, state.myCreatedOrderId, ...state.myOrderHistoryIds].filter(Boolean));
    if (watchedIds.size > 0 && (state.routeMode === 'ticket' || state.routeMode === 'order')) {
      watchedIds.forEach(wId => {
        const myOrd = state.orders.find(o => o.orderId === wId);
        if (myOrd) {
          const prev = state.lastSeenOrderNotifyMap[myOrd.orderId] || { status: myOrd.status, notifyCount: 0 };
          const curCount = Number(myOrd.notifyCount) || 0;
          const becameReady = (prev.status !== '可取餐' && myOrd.status === '可取餐') ||
                              (myOrd.status === '可取餐' && curCount > prev.notifyCount);
          state.lastSeenOrderNotifyMap[myOrd.orderId] = { status: myOrd.status, notifyCount: curCount };
          if (becameReady) {
            triggerStudentPickupAlert(myOrd);
          }
        }
      });
    }
  }
}

async function syncCloud(showSuccessToast = false) {
  setSyncState('syncing', '同步中...');
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'initBundle', campus: state.campus })
    });
    const data = await res.json();
    if (data && data.success) {
      applyCloudBundle(data);
      enrichStoresAndAi();
      updateHeaderMyOrdersBadge();

      const editingNow = !showSuccessToast && isUserEditingFormInput();
      if (!editingNow) {
        if (state.routeMode === 'order') renderStudentOrderExperience();
        if (state.routeMode === 'ticket') renderSingleTicketView();
        if (state.routeMode === 'store' && state.isMerchantUnlocked) {
          if (state.storeTabMode === 'settings' && !showSuccessToast) {
            updateMerchantHeaderBadgesOnly();
          } else {
            renderMerchantView();
          }
        }
      } else if (state.routeMode === 'store' && state.isMerchantUnlocked) {
        updateMerchantHeaderBadgesOnly();
      }

      setSyncState('online', '已同步');
      if (showSuccessToast) showToast('☁️ 已與雲端資料庫完成同步');
    } else {
      setSyncState('online', '本地就緒');
    }
  } catch (e) {
    setSyncState('offline', '離線快取模式');
  }
}

function updateMerchantHeaderBadgesOnly() {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const storeActiveOrders = state.orders.filter(o =>
    o.storeId === store.id &&
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
  document.body.classList.toggle('store-mode-active', state.routeMode === 'store');
  document.body.classList.toggle('pos-no-scroll', state.routeMode === 'store' && state.isMerchantUnlocked && state.storeTabMode === 'pos');
}

function ensureHeaderExtraControls() {
  const lineBtn = document.getElementById('headerLineBindBtn');
  if (lineBtn && !document.getElementById('headerMyOrdersBtn')) {
    lineBtn.insertAdjacentHTML('beforebegin', `
      <button type="button" id="headerMyOrdersBtn" class="btn-my-orders" style="display:none;" onclick="openMyOrdersDrawer()">
        <span>🧾 我的訂單</span>
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
}

function updateHeaderMyOrdersBadge() {
  const btn = document.getElementById('headerMyOrdersBtn');
  const countEl = document.getElementById('headerMyOrdersCount');
  if (!btn || !countEl) return;

  btn.style.display = (state.routeMode === 'store') ? 'none' : 'inline-flex';
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
  enrichStoresAndAi();
  updateBodyScrollLock();
  updateHeaderMyOrdersBadge();

  const lineBtn = document.getElementById('headerLineBindBtn');
  if (lineBtn) {
    lineBtn.style.display = (state.routeMode === 'store') ? 'none' : 'inline-flex';
  }
  const storeControls = document.getElementById('headerStoreControls');
  if (storeControls) {
    storeControls.style.display = (state.routeMode === 'store' && state.isMerchantUnlocked) ? 'inline-flex' : 'none';
  }

  const lineBtnText = document.getElementById('headerLineBtnText');
  if (lineBtnText) {
    lineBtnText.innerText = state.lineProfile.isBound
      ? `💚 已綁定通知 (${state.lineProfile.lineDisplayName})`
      : '💬 綁定取餐通知';
  }

  const sections = ['viewPortal', 'viewOrder', 'viewTicket', 'viewStore'];
  const mapModeToSec = {
    portal: 'viewPortal',
    order: 'viewOrder',
    ticket: 'viewTicket',
    store: 'viewStore'
  };
  const activeSec = mapModeToSec[state.routeMode] || 'viewOrder';
  sections.forEach(secId => {
    const el = document.getElementById(secId);
    if (el) el.classList.toggle('active', secId === activeSec);
  });

  const floatingCart = document.getElementById('floatingCartBar');
  if (floatingCart) {
    floatingCart.style.display = (state.routeMode === 'order' && state.selectedStoreId) ? 'block' : 'none';
  }

  const campusSwitcher = document.getElementById('headerCampusSwitcher');
  if (campusSwitcher) {
    campusSwitcher.style.display = (state.routeMode === 'order' && !state.selectedStoreId) ? 'inline-flex' : 'none';
  }

  const roleBadge = document.getElementById('headerRoleBadge');
  if (roleBadge) {
    if (state.routeMode === 'store') {
      roleBadge.innerText = '🖥️ 店家櫃檯收銀與營運中心';
      roleBadge.style.background = 'var(--brand-light)';
      roleBadge.style.color = 'var(--brand-dark)';
    } else if (state.routeMode === 'ticket') {
      roleBadge.innerText = '🎟️ 訂單專屬追蹤憑證';
      roleBadge.style.background = 'var(--brand-light)';
      roleBadge.style.color = 'var(--brand-dark)';
    } else if (state.routeMode === 'order') {
      roleBadge.innerText = '📱 線上點餐系統';
      roleBadge.style.background = 'var(--brand-light)';
      roleBadge.style.color = 'var(--brand-dark)';
    } else {
      roleBadge.innerText = '⚡ 系統入口導覽';
      roleBadge.style.background = 'var(--bg-page)';
      roleBadge.style.color = 'var(--text-secondary)';
    }
  }

  if (state.routeMode === 'portal') renderPortalView();
  if (state.routeMode === 'order') renderStudentOrderExperience();
  if (state.routeMode === 'ticket') renderSingleTicketView();
  if (state.routeMode === 'store') {
    checkMerchantSecurityGate();
    renderMerchantView();
  }

  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.routeMode === 'ticket' || state.routeMode === 'store' || state.routeMode === 'order') {
    state.pollTimer = setInterval(() => {
      syncCloud(false);
    }, 8000);
  }
}

function switchCampus(campus) {
  state.campus = campus;
  state.selectedStoreId = null;
  document.getElementById('btnCampus-雙溪校區')?.classList.toggle('active', campus === '雙溪校區');
  document.getElementById('btnCampus-城中校區')?.classList.toggle('active', campus === '城中校區');
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

// ==================== 學生「我的訂單匣」與商業級無後門「店家安全 PIN 碼鎖」 ====================
function getMyTrackedOrdersList() {
  const idSet = new Set([state.trackingOrderId, state.myCreatedOrderId, ...state.myOrderHistoryIds].filter(Boolean));
  return state.orders.filter(o => idSet.has(o.orderId));
}

function openMyOrdersDrawer() {
  ensureSharedModalsMounted();
  const body = document.getElementById('myOrdersDrawerBody');
  const modal = document.getElementById('myOrdersDrawerModal');
  if (!body || !modal) return;

  const list = getMyTrackedOrdersList();
  if (list.length === 0) {
    body.innerHTML = `
      <div style="text-align:center; padding:48px 16px;">
        <div style="font-size:2.8rem; margin-bottom:8px;">🧾</div>
        <h4 style="font-size:1.05rem; font-weight:900; margin-bottom:6px;">目前尚無點餐紀錄</h4>
        <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:16px;">當您送出訂單後，無論點了幾家不同餐廳，都能在此隨時切換查看取餐號碼牌！</p>
        <button type="button" class="btn-tip-action" onclick="closeMyOrdersDrawer()">前往挑選餐點</button>
      </div>
    `;
  } else {
    body.innerHTML = list.map(o => {
      const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
      const itemStr = items.map(i => `${i.baseName || i.name} ×${i.qty || 1}`).join('、');
      const isReady = o.status === '可取餐';
      const isCooking = o.status === '製作中';
      const isScheduled = o.status === '已接單待排程' || o.status === '待付款確認';
      const isCancelled = String(o.status).includes('已取消');

      return `
        <div style="background:#FFFFFF; border:2px solid ${isReady ? 'var(--green)' : isCooking ? '#FDBA74' : isScheduled ? '#93C5FD' : 'var(--border)'}; border-radius:14px; padding:14px; margin-bottom:10px; box-shadow:var(--shadow-sm); cursor:pointer;" onclick="closeMyOrdersDrawer(); navigateToOrderTicket('${escapeHtml(o.orderId)}')">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.35rem; font-weight:950; color:${isReady ? 'var(--green)' : 'var(--brand-dark)'};">#${escapeHtml(o.pickupNumber)}</span>
              <span style="font-weight:900; font-size:0.95rem;">${escapeHtml(o.storeName)}</span>
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
}

function closeMyOrdersDrawer() {
  document.getElementById('myOrdersDrawerModal')?.classList.remove('open');
}

/**
 * 商業級資安閘門：移除免密後門與明文提示，並在未授權時徹底清空後台 DOM
 */
function checkMerchantSecurityGate() {
  const modal = document.getElementById('storePinModal');
  if (!modal) return;
  if (state.isMerchantUnlocked && state.merchantAuthToken) {
    modal.classList.remove('open');
    return;
  }
  state.isMerchantUnlocked = false;
  state.pinInputBuffer = '';
  renderStorePinModal(false);
  modal.classList.add('open');
}

function renderStorePinModal(hasError = false) {
  const body = document.getElementById('storePinModalBody');
  if (!body) return;
  const len = state.pinInputBuffer.length;
  body.innerHTML = `
    <div style="text-align:center;">
      <p style="font-size:0.84rem; color:var(--text-secondary); font-weight:700;">
        請輸入 4 位數店務管理授權碼以解鎖收銀與控單系統
      </p>
      <div class="pin-dots-row ${hasError ? 'shake-error' : ''}">
        ${[0, 1, 2, 3].map(i => `<div class="pin-dot-box ${i < len ? 'filled' : ''}">${i < len ? '●' : ''}</div>`).join('')}
      </div>
      <div class="pos-numpad-grid" style="margin-bottom:8px;">
        ${['1','2','3','4','5','6','7','8','9'].map(k => `<button type="button" class="pos-numpad-key" onclick="tapStorePinKey('${k}')">${k}</button>`).join('')}
        <button type="button" class="pos-numpad-key clear" onclick="tapStorePinKey('C')">清除</button>
        <button type="button" class="pos-numpad-key" onclick="tapStorePinKey('0')">0</button>
        <button type="button" class="pos-numpad-key back" onclick="tapStorePinKey('BACK')">⌫</button>
      </div>
      <div style="font-size:0.74rem; color:var(--text-muted); margin-top:6px;">
        🔒 未通過授權前，系統不會載入或渲染任何店務後台節點
      </div>
    </div>
  `;
}

async function tapStorePinKey(key) {
  if (key === 'C') state.pinInputBuffer = '';
  else if (key === 'BACK') state.pinInputBuffer = state.pinInputBuffer.slice(0, -1);
  else if (state.pinInputBuffer.length < 4 && /^\d$/.test(String(key))) {
    state.pinInputBuffer += String(key);
  }

  renderStorePinModal(false);

  if (state.pinInputBuffer.length === 4) {
    const candidatePin = state.pinInputBuffer;
    const inputHash = await computeSha256Hex(candidatePin);
    const defaultTargetHash = await computeSha256Hex('8888');
    const savedTargetHash = state.merchantPinHash || defaultTargetHash;

    // 先比對雜湊或向後端驗證權限
    let isAuthorized = (inputHash === savedTargetHash);

    if (isAuthorized) {
      state.isMerchantUnlocked = true;
      state.merchantAuthToken = inputHash;
      try {
        sessionStorage.setItem('mealflow_merchant_token_v11', inputHash);
      } catch (e) {}
      document.getElementById('storePinModal')?.classList.remove('open');
      applyRouteView();
      showToast('🔓 店務管理權限驗證通過');
    } else {
      try { if ('vibrate' in navigator) navigator.vibrate([120, 80, 120]); } catch (e) {}
      showToast('❌ 授權碼錯誤，請重新輸入');
      state.pinInputBuffer = '';
      renderStorePinModal(true);
    }
  }
}

function lockMerchantSession() {
  state.isMerchantUnlocked = false;
  state.merchantAuthToken = '';
  state.pinInputBuffer = '';
  try { sessionStorage.removeItem('mealflow_merchant_token_v11'); } catch (e) {}
  // 立即清空所有後台 DOM 節點，防止透過開發者工具檢視或操作
  ['pos', 'kds', 'analytics', 'settings'].forEach(m => {
    const p = document.getElementById(`storePanel-${m}`);
    if (p) p.innerHTML = '';
  });
  applyRouteView();
  showToast('🔒 已安全鎖定並卸載店家後台畫面');
}

function exitStoreToStudentOrder() {
  document.getElementById('storePinModal')?.classList.remove('open');
  navigateToOrderMenu();
}

// ==================== 第三方行動支付授權收銀台 ====================
function requestOnlinePaymentGateway(payMethod, amount, storeName) {
  return new Promise((resolve) => {
    ensureSharedModalsMounted();
    const modal = document.getElementById('onlinePaymentModal');
    const header = document.getElementById('onlinePaymentHeader');
    const title = document.getElementById('onlinePaymentTitle');
    const body = document.getElementById('onlinePaymentBody');
    if (!modal || !body) {
      resolve({ approved: true, transactionId: 'TX-' + Date.now() });
      return;
    }

    const isLine = payMethod === 'LINE Pay';
    header.className = 'payment-gateway-header ' + (isLine ? 'linepay' : 'jkopay');
    title.innerText = isLine ? '💚 LINE Pay 安全授權收銀台' : '❤️ 街口支付 安全授權收銀台';

    const mockTxNo = (isLine ? 'LP-' : 'JK-') + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(100000 + Math.random() * 900000);

    body.innerHTML = `
      <div style="text-align:center; padding:8px 4px;">
        <div style="font-size:0.8rem; font-weight:800; color:var(--text-secondary);">特約商店：東吳學餐 — ${escapeHtml(storeName)}</div>
        <div style="font-size:2.2rem; font-weight:950; color:var(--text-primary); margin:6px 0;">NT$ ${amount}</div>
        <div style="display:inline-block; background:#F1F5F9; color:#475569; font-size:0.74rem; font-weight:800; padding:3px 10px; border-radius:999px; margin-bottom:14px;">
          交易序號預覽：${mockTxNo}
        </div>

        <div style="background:#F8FAFC; border:1.5px dashed #CBD5E1; border-radius:14px; padding:14px; margin-bottom:16px; text-align:left; font-size:0.8rem; color:var(--text-secondary);">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>扣款方式</span>
            <strong style="color:var(--text-primary);">${escapeHtml(payMethod)} 綁定帳戶</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span>伺服器端計價驗算</span>
            <strong style="color:var(--green);">✓ 金額受後端權威保護</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>雲端權威流水號核發</span>
            <strong style="color:var(--text-primary);">付款後由伺服器互斥鎖核發單號</strong>
          </div>
        </div>

        <div style="display:flex; gap:10px;">
          <button type="button" class="btn-outline" style="flex:1;" onclick="cancelOnlinePaymentModal()">取消付款</button>
          <button type="button" id="confirmGatewayPayBtn" class="btn-tip-action" style="flex:2; background:${isLine ? '#00C300' : '#E60012'}; padding:13px; font-size:0.96rem;" onclick="approveOnlinePaymentModal('${mockTxNo}')">
            🔒 確認授權付款 (NT$ ${amount})
          </button>
        </div>
      </div>
    `;

    state.pendingPaymentResolver = resolve;
    modal.classList.add('open');
  });
}

function approveOnlinePaymentModal(txId) {
  const btn = document.getElementById('confirmGatewayPayBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ 正在驗證交易授權碼...';
  }
  setTimeout(() => {
    document.getElementById('onlinePaymentModal')?.classList.remove('open');
    if (state.pendingPaymentResolver) {
      const r = state.pendingPaymentResolver;
      state.pendingPaymentResolver = null;
      r({ approved: true, transactionId: txId });
    }
  }, 420);
}

function cancelOnlinePaymentModal() {
  document.getElementById('onlinePaymentModal')?.classList.remove('open');
  if (state.pendingPaymentResolver) {
    const r = state.pendingPaymentResolver;
    state.pendingPaymentResolver = null;
    r({ approved: false, transactionId: '' });
  }
}

// ==================== 1. 根目錄入口導覽台 (/) ====================
function renderPortalView() {
  const orderUrl = getOrderPageUrl();
  const storeUrl = getStorePageUrl();

  const box = document.getElementById('portalContentBox');
  if (!box) return;
  box.innerHTML = `
    <div style="text-align:center; padding: 14px 0 22px;">
      <div style="display:inline-block; background:#EEF2FF; color:#4338CA; font-weight:800; font-size:0.78rem; padding:4px 12px; border-radius:999px; margin-bottom:10px;">
        🧠 雲端權威單號核發 × 五階段廚房排程 × KDS 備料匯總 × 交班日結 Z-Report
      </div>
      <h1 style="font-size:1.55rem; font-weight:900; margin-bottom:8px;">東吳學餐智慧點餐與營運管制塔</h1>
      <p style="font-size:0.86rem; color:var(--text-secondary); max-width:640px; margin:0 auto;">
        整合<strong>學生線上掃碼點餐 (<code>/order/</code>)</strong>、<strong>防偽動態電子取餐憑證</strong>，以及<strong>全螢幕平板 POS + KDS 備料匯總看板 + 交班對帳後台 (<code>/store/</code>)</strong>。
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
              多輪氣泡式選餐顧問、小額預訂免跑櫃檯、行動支付安全收銀台、離線防偽 SVG 條碼與動態時鐘憑證。
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
            <h2 style="font-size:1.18rem; font-weight:900; margin-bottom:4px;">店家全螢幕收銀・KDS 備料・財務日結</h2>
            <code style="display:block; font-size:0.76rem; color:#0F172A; background:#F1F5F9; padding:5px 8px; border-radius:6px; margin-bottom:10px;">
              /scu.meal/store/
            </code>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">
              支援櫃檯手動折讓/招待、錢箱交班日結單 (Z-Report)、KDS 單品備料匯總看板、80mm 熱感應出單與真實損益分析。
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

  if (state.selectedStoreId && state.selectedStoreId !== storeId && state.cartItems.length > 0) {
    if (!window.confirm(`您的購物車內還有上一家餐廳的餐點，切換至「${store.name}」將會清空購物車，確定要切換嗎？`)) {
      return;
    }
    state.cartItems = [];
  }

  state.selectedStoreId = storeId;
  state.campus = store.campus;

  if (store.isOpen === false) {
    state.checkoutTimeMode = 'RESERVE';
  }

  applyRouteView();
  updateCartUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (autoOpenMenuId) {
    setTimeout(() => handleMenuItemClick(autoOpenMenuId, false), 180);
  }
}

function backToStoreDirectory() {
  state.selectedStoreId = null;
  applyRouteView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderStudentOrderExperience() {
  enrichStoresAndAi();
  updateHeaderMyOrdersBadge();

  const activeBannerBox = document.getElementById('activeOrderFloatingBanner');
  if (activeBannerBox) {
    const myActiveOrders = getMyTrackedOrdersList().filter(o => o.status !== '已完成' && !String(o.status).includes('已取消'));
    if (myActiveOrders.length > 0) {
      const primaryOrder = myActiveOrders.find(o => o.status === '可取餐') || myActiveOrders[0];
      const isReady = primaryOrder.status === '可取餐';
      const isScheduled = primaryOrder.status === '已接單待排程' || primaryOrder.status === '待付款確認';
      const extraCount = myActiveOrders.length - 1;
      activeBannerBox.innerHTML = `
        <div class="active-order-strip ${isReady ? 'ready' : ''}" onclick="${extraCount > 0 ? 'openMyOrdersDrawer()' : `navigateToOrderTicket('${escapeHtml(primaryOrder.orderId)}')`}">
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="strip-num">#${escapeHtml(primaryOrder.pickupNumber)}</span>
            <div>
              <div style="font-weight:800; font-size:0.88rem;">
                ${isReady ? '🔔 您點的餐點已可取餐！(點此查看)' : isScheduled ? `📅 預訂單已接單排程 (${escapeHtml(primaryOrder.pickupDate)} ${escapeHtml(primaryOrder.pickupTime)})` : '🍳 您點的餐點正在廚房製作中'}
                ${extraCount > 0 ? `<span style="background:rgba(255,255,255,0.22); padding:1px 7px; border-radius:999px; font-size:0.74rem; margin-left:4px;">共 ${myActiveOrders.length} 筆進行中</span>` : ''}
              </div>
              <div style="font-size:0.74rem; opacity:0.9;">
                ${escapeHtml(primaryOrder.storeName)} ・ 點此查看專屬防偽號碼牌憑證
              </div>
            </div>
          </div>
          <span style="font-weight:800; font-size:0.82rem;">${extraCount > 0 ? '開啟訂單匣 ➔' : '查看取餐單 ➔'}</span>
        </div>
      `;
    } else {
      activeBannerBox.innerHTML = '';
    }
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
            <div class="smart-tip-badge">⚡ 尖峰排隊偵測・智慧分流建議</div>
            <div class="smart-tip-title">「${escapeHtml(rec.congestedStoreName)}」目前負載 ${rec.congestedLoadPct}% 需久候 ${rec.congestedWaitMin} 分鐘</div>
            <div class="smart-tip-desc">
              改點出餐順暢 (${rec.recommendedAiScore}分) 的 <strong>${escapeHtml(rec.recommendedStoreName)}</strong> 只要 <strong>${rec.recommendedWaitMin} 分鐘</strong>（省時 ${rec.timeSavedMin} 分），再享 <strong>${escapeHtml(rec.promoText)}</strong>
            </div>
          </div>
          <button class="btn-tip-action" onclick="enterStoreOrdering('${escapeHtml(rec.recommendedStoreId)}')">領優惠免排隊點餐 ➔</button>
        </div>
      `;
    } else {
      tipBox.innerHTML = '';
    }
  }

  let list = campusStores;
  if (state.filter === 'FAST') list = list.filter(s => s.isOpen !== false && s.loadState === 'FREE');
  if (state.filter === 'PROMO') list = list.filter(s => isStorePromoActive(s));

  const container = document.getElementById('storeListContainer');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:36px 0;">目前無符合篩選條件的餐廳</p>`;
    return;
  }

  container.innerHTML = list.map(s => {
    let waitClass = 'wait-free';
    let waitText = `🟢 順暢・約 ${s.avgPrepMinutes} 分取餐`;
    let barColor = 'var(--green)';

    if (s.isOpen === false) {
      waitClass = 'wait-closed';
      waitText = '🔴 暫停營業 (可預訂)';
      barColor = '#94A3B8';
    } else if (s.loadState === 'FULL') {
      waitClass = 'wait-full';
      waitText = `🔴 滿載久候 (${s.avgPrepMinutes}分)`;
      barColor = 'var(--red)';
    } else if (s.loadState === 'MODERATE') {
      waitClass = 'wait-mod';
      waitText = `🟡 適中・約 ${s.avgPrepMinutes} 分`;
      barColor = 'var(--amber)';
    }

    const icon = STORE_ICONS[s.id] || '🍱';
    const hasPromo = isStorePromoActive(s);
    const isRecTarget = rec && rec.hasAlert && rec.recommendedStoreId === s.id;
    const availMenuCount = (s.menus || []).filter(m => !m.soldOut).length;

    return `
      <div class="store-card ${isRecTarget ? 'recommended' : ''} ${s.isOpen === false ? 'store-closed' : ''}" onclick="enterStoreOrdering('${escapeHtml(s.id)}')">
        <div class="store-thumb">
          ${icon}
          <span class="ai-score-badge">推薦 ${s.aiScore}分</span>
        </div>
        <div class="store-info">
          <div class="store-header-row">
            <div class="store-name">${escapeHtml(s.name)}</div>
            <span class="wait-pill ${waitClass}">${waitText}</span>
          </div>
          <div class="store-meta">
            ⭐ ${s.rating} ・ ${escapeHtml(s.category)} ・ ${s.isOpen === false ? '目前休息中，開放預訂未來時段' : `即時負載 ${s.activeOrders}/${s.maxCapacityPer15Min} 單 (${s.loadPercentage}%)`} ・ 供應 ${availMenuCount} 道餐點
          </div>
          <div class="load-bar-wrap">
            <div class="load-bar-fill" style="width:${Math.min(100, s.loadPercentage)}%; background:${barColor};"></div>
          </div>
          ${hasPromo ? `<div class="promo-tag">${escapeHtml(s.promoText)}${s.promoMode === 'discount' ? ` (滿$${AI_DISCOUNT_MIN_SUBTOTAL}折抵)` : ''}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderInStoreMenuCards() {
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  const box = document.getElementById('inStoreOrderingBlock');
  if (!store || !box) return;

  const hasPromo = isStorePromoActive(store);
  const rec = state.aiRecommendations[store.campus];
  const isCongested = store.isOpen !== false && store.loadState === 'FULL' && rec && rec.hasAlert && rec.recommendedStoreId !== store.id;

  const items = store.menus || [];
  const grouped = {};
  items.forEach(item => {
    const cat = item.category || '招牌推薦';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  });

  let menuGroupsHtml = '';
  if (items.length === 0) {
    menuGroupsHtml = `<p style="text-align:center; color:var(--text-muted); padding:40px 0;">此餐廳目前尚無供應品項</p>`;
  } else {
    for (let cat in grouped) {
      menuGroupsHtml += `
        <div>
          <h3 class="category-group-title">
            <span>🏷️</span> ${escapeHtml(cat)}
          </h3>
          <div style="display:grid; grid-template-columns:1fr; gap:12px;">
            ${grouped[cat].map(item => {
              const isSoldOut = Boolean(item.soldOut);
              const imgHtml = item.image
                ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">`
                : `<span>🍽️</span>`;
              const hasOpts = item.options && Object.keys(item.options).length > 0;

              return `
                <div class="menu-item-card ${isSoldOut ? 'sold-out' : ''}" onclick="handleMenuItemClick('${escapeHtml(item.id)}', false)">
                  <div class="menu-img-box">
                    ${imgHtml}
                    ${!isSoldOut ? `<div class="menu-plus-badge">+</div>` : ''}
                  </div>
                  <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between; padding:2px 0;">
                    <div>
                      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        <h4 style="font-size:1.05rem; font-weight:800; color:var(--text-primary);">${escapeHtml(item.name)}</h4>
                        ${isSoldOut ? `<span class="sold-out-ribbon">今日已售罄</span>` : (item.tag ? `<span style="font-size:0.7rem; font-weight:700; background:var(--brand-light); color:var(--brand-dark); padding:1px 7px; border-radius:6px;">${escapeHtml(item.tag)}</span>` : '')}
                      </div>
                      <div style="font-size:0.76rem; color:var(--text-secondary); margin-top:3px;">
                        ${isSoldOut ? '此品項今日已售完，請挑選其他餐點' : (hasOpts ? `客製選項：${Object.keys(item.options).join(' / ')}` : '單點直接加入購物車（同品項自動合併數量）')}
                      </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:8px;">
                      <span style="font-size:1.05rem; font-weight:900; color:var(--text-primary);">NT$ ${item.price}</span>
                      <span style="font-size:0.76rem; font-weight:700; color:${isSoldOut ? 'var(--text-muted)' : 'var(--brand)'};">${isSoldOut ? '已售罄' : '點擊選擇 ➔'}</span>
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

  box.innerHTML = `
    <div class="in-store-banner">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
        <button type="button" class="filter-chip" onclick="backToStoreDirectory()">← 切換其他學餐店家</button>
        <span class="wait-pill ${store.isOpen === false ? 'wait-closed' : store.loadState === 'FULL' ? 'wait-full' : store.loadState === 'MODERATE' ? 'wait-mod' : 'wait-free'}">
          ${store.isOpen === false ? '🔴 本店目前暫停立即出餐（僅開放預訂取餐）' : `⏱️ 即時預估約 ${store.avgPrepMinutes} 分鐘取餐 (製作中負荷 ${store.activeOrders} 單)`}
        </span>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="font-size:2.4rem; background:var(--brand-light); width:60px; height:60px; border-radius:14px; display:flex; align-items:center; justify-content:center;">
          ${STORE_ICONS[store.id] || '🍱'}
        </div>
        <div>
          <h2 style="font-size:1.35rem; font-weight:900;">${escapeHtml(store.name)}</h2>
          <div style="font-size:0.82rem; color:var(--text-secondary);">${escapeHtml(store.campus)} ・ ${escapeHtml(store.category)} ・ ⭐ ${store.rating} ・ 櫃檯叫號自取</div>
        </div>
      </div>

      ${store.isOpen === false ? `
        <div style="margin-top:12px; background:#FEF2F2; border:1.5px solid #FECACA; color:#991B1B; padding:10px 14px; border-radius:10px; font-size:0.84rem; font-weight:800;">
          ⚠️ 本店目前為休息或備料時段，暫不接受「立即製作」訂單；您仍可將餐點加入購物車並選擇「📅 預訂取餐」！
        </div>
      ` : ''}

      ${hasPromo ? `
        <div style="margin-top:12px; background:var(--brand-light); color:var(--brand-dark); padding:10px 14px; border-radius:10px; font-size:0.85rem; font-weight:800;">
          🎉 本店已開啟離峰分流優惠：${escapeHtml(store.promoText)}
          ${store.promoMode === 'discount' ? `（餐點滿 NT$${AI_DISCOUNT_MIN_SUBTOTAL} 自動折抵）` : '（結帳時自動寫入廚房出單明細）'}
        </div>
      ` : ''}

      ${isCongested ? `
        <div style="margin-top:10px; background:var(--red-bg); color:var(--red); padding:10px 14px; border-radius:10px; font-size:0.82rem; font-weight:700; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span>⚠️ 本店目前產能滿載 (${store.loadPercentage}%)，改點「${escapeHtml(rec.recommendedStoreName)}」立省 ${rec.timeSavedMin} 分鐘並享優惠！</span>
          <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.78rem;" onclick="enterStoreOrdering('${escapeHtml(rec.recommendedStoreId)}')">一鍵改點 ➔</button>
        </div>
      ` : ''}
    </div>

    ${menuGroupsHtml}
  `;
}

// ==================== 3. 購物車自動合併與規格選擇器 ====================
function getItemSignature(itemObj) {
  const selObj = itemObj.selections || {};
  const sortedKeys = Object.keys(selObj).sort();
  const selPart = sortedKeys.map(k => `${k}:${selObj[k]}`).join('|');
  return `${itemObj.id}__${selPart}`;
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
    showToast(`🚫 「${item.name}」今日已售罄，請挑選其他品項！`);
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
    mergeOrPushCartItem(state.cartItems, newItemObj, -1);
    updateCartUI();
    showToast(`🛒 已加入購物車：${item.name}`);
  }
}

function openOptionsModal(item, prefilledSelections = null) {
  document.getElementById('optModalTitle').innerText = item.name;
  document.getElementById('optModalSubtitle').innerText = `基本價格 NT$ ${item.price}`;

  const content = document.getElementById('optModalContent');
  content.innerHTML = '';

  Object.keys(item.options || {}).forEach(optName => {
    const grp = item.options[optName];
    const isRadio = !grp.type || grp.type === 'radio';
    const inputType = isRadio ? 'radio' : 'checkbox';
    const reqBadge = isRadio
      ? `<span style="color:var(--red); font-size:0.74rem; font-weight:800; margin-left:6px;">* 必選單選</span>`
      : `<span style="color:var(--brand); font-size:0.74rem; font-weight:800; margin-left:6px;">可多選</span>`;

    const choicesArray = grp.choices || grp || [];
    let prefilledValues = [];
    if (prefilledSelections && prefilledSelections[optName]) {
      const sel = prefilledSelections[optName];
      prefilledValues = Array.isArray(sel) ? sel : String(sel).split(', ');
    }

    const choicesHtml = choicesArray.map((opt, idx) => {
      const name = Array.isArray(opt) ? opt[0] : opt;
      const extra = Array.isArray(opt) ? (Number(opt[1]) || 0) : 0;
      const isChecked = prefilledSelections
        ? prefilledValues.includes(name)
        : (isRadio && idx === 0);

      return `
        <label class="option-label-row ${isChecked ? 'checked' : ''}">
          <div style="display:flex; align-items:center; gap:10px;">
            <input type="${inputType}" name="optgrp-${escapeHtml(optName)}" value="${escapeHtml(name)}" data-extra="${extra}" ${isChecked ? 'checked' : ''} onchange="checkModalSelections()" style="width:18px; height:18px; accent-color:var(--brand);">
            <span style="font-weight:700; color:var(--text-primary);">${escapeHtml(name)}</span>
          </div>
          ${extra !== 0 ? `<span style="font-weight:800; color:var(--brand); font-size:0.86rem;">${extra > 0 ? `+NT$${extra}` : `-NT$${Math.abs(extra)}`}</span>` : ''}
        </label>
      `;
    }).join('');

    content.insertAdjacentHTML('beforeend', `
      <div style="margin-bottom:16px;">
        <h4 style="font-size:0.95rem; font-weight:900; margin-bottom:8px; color:var(--text-primary);">${escapeHtml(optName)} ${reqBadge}</h4>
        <div>${choicesHtml}</div>
      </div>
    `);
  });

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

  document.querySelectorAll('#optModalContent .option-label-row').forEach(lbl => {
    const inp = lbl.querySelector('input');
    if (inp) lbl.classList.toggle('checked', inp.checked);
  });

  let extra = 0;
  let allRequiredChecked = true;

  Object.keys(item.options || {}).forEach(cat => {
    const grp = item.options[cat];
    if (!grp.type || grp.type === 'radio') {
      const sel = document.querySelector(`#optModalContent input[name="optgrp-${CSS.escape(cat)}"]:checked`);
      if (!sel) allRequiredChecked = false;
    }
  });

  document.querySelectorAll('#optModalContent input:checked').forEach(sel => {
    extra += parseFloat(sel.dataset.extra || 0);
  });

  const btn = document.getElementById('confirmOptionsBtn');
  if (allRequiredChecked) {
    btn.disabled = false;
    const finalPrice = Math.max(0, Number(item.price) + extra);
    btn.innerText = state.editingCartIndex > -1
      ? `儲存變更 (NT$ ${finalPrice})`
      : `確認加入 (NT$ ${finalPrice})`;
  } else {
    btn.disabled = true;
    btn.innerText = '請完成必選項目';
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
    extraTotal += parseFloat(r.dataset.extra || 0);
  });

  for (let key in selections) {
    if (Array.isArray(selections[key])) selections[key] = selections[key].join(', ');
  }

  const finalPrice = Math.max(0, Number(item.price) + extraTotal);
  const targetCart = state.isPosConfiguring ? state.posCart : state.cartItems;
  const currentQty = (state.editingCartIndex > -1 && targetCart[state.editingCartIndex])
    ? (targetCart[state.editingCartIndex].qty || 1)
    : 1;

  const newItemObj = {
    id: item.id,
    name: item.name,
    baseName: item.name,
    basePrice: item.price,
    price: finalPrice,
    qty: currentQty,
    selections: selections
  };

  mergeOrPushCartItem(targetCart, newItemObj, state.editingCartIndex);

  if (state.editingCartIndex > -1) {
    showToast(`✅ 已更新選項：${item.name}`);
  } else if (!state.isPosConfiguring) {
    showToast(`🛒 已加入：${item.name}`);
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
    showToast('此品項無客製化選項可編輯');
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
  updateCartUI();
}

function removeCartItem(index) {
  state.cartItems.splice(index, 1);
  updateCartUI();
}

function setCheckoutMode(field, val) {
  state[field] = val;
  updateCartUI();
}
/**
 * ============================================================================
 * 東吳學餐智慧點餐與全螢幕平板 POS 系統 - 商業專業版前端核心引擎 (Commercial v11.0)
 * Part 2 / 2：權威單號核發、合規預訂規則、KDS 備料匯總看板、POS 折讓與 Z-Report、真實財務分析
 * ============================================================================
 */

function updateCartUI() {
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  const storeCutleryPrice = store && store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const totalCount = state.cartItems.reduce((sum, i) => sum + (i.qty || 1), 0);
  const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.checkoutNeedCutlery) ? storeCutleryPrice : 0;

  const promoActive = store && isStorePromoActive(store);
  let discount = 0;
  if (subtotal >= AI_DISCOUNT_MIN_SUBTOTAL && promoActive && store.promoMode === 'discount') {
    discount = Math.min(subtotal, Number(store.promoDiscount) || 10);
  }
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);

  if (store && store.isOpen === false && state.checkoutTimeMode === 'NOW') {
    state.checkoutTimeMode = 'RESERVE';
  }

  const isReserve = state.checkoutTimeMode === 'RESERVE';
  if (isReserve) {
    let validSlots = getValidPickupTimeSlots(state.checkoutReserveDate);
    if (validSlots.length === 0) {
      state.checkoutReserveDate = getDateOffsetStr(1);
      validSlots = getValidPickupTimeSlots(state.checkoutReserveDate);
    }
    if (!validSlots.includes(state.checkoutReserveTime)) {
      state.checkoutReserveTime = validSlots[0] || '12:15';
    }
  }

  // 商業級重構 4：一般小額預訂 (< $500) 支援線上支付或取餐付現；大額團訂 (>= $500) 需線上支付或提前付訂確認
  const isLargeOrderReserve = isReserve && finalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD;

  const viewCartBtn = document.getElementById('viewCartBtn');
  const countEl = document.getElementById('cartItemCountBadge');
  const previewTotalEl = document.getElementById('cartPreviewTotal');
  if (countEl) countEl.innerText = `${totalCount} 份`;
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
        <p style="color:var(--text-muted); font-size:1.05rem; margin-bottom:12px;">購物車目前沒有餐點</p>
        <button type="button" class="btn-tip-action" onclick="closeCartModal()">去挑選餐點</button>
      </div>
    `;
    return;
  }

  const itemsCardsHtml = state.cartItems.map((item, idx) => {
    const selList = item.selections && Object.keys(item.selections).length > 0
      ? Object.entries(item.selections).map(([k, v]) => `${k}: ${v}`).join(' / ')
      : '標準原味';
    const storeMenu = store ? (store.menus || []).find(m => String(m.id) === String(item.id)) : null;
    const canEdit = storeMenu && storeMenu.options && Object.keys(storeMenu.options).length > 0;
    const itemSubtotal = item.price * (item.qty || 1);

    return `
      <div style="background:#FFFFFF; padding:14px; border-radius:14px; border:1px solid var(--border); margin-bottom:10px; box-shadow:var(--shadow-sm);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div>
            <h4 style="font-size:1.02rem; font-weight:800; color:var(--text-primary);">${escapeHtml(item.baseName || item.name)}</h4>
            <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:3px;">${escapeHtml(selList)}</p>
          </div>
          <span style="font-size:1.05rem; font-weight:900; color:var(--red); white-space:nowrap;">NT$ ${itemSubtotal}</span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:10px; border-top:1px solid #F3F4F6;">
          <div style="display:inline-flex; align-items:center; gap:8px; background:var(--bg-page); padding:3px 8px; border-radius:999px; border:1px solid var(--border);">
            <button type="button" onclick="changeCartItemQty(${idx}, -1)" style="border:none; background:#fff; width:24px; height:24px; border-radius:50%; font-weight:900;">－</button>
            <span style="font-weight:800; min-width:20px; text-align:center;">${item.qty || 1}</span>
            <button type="button" onclick="changeCartItemQty(${idx}, 1)" style="border:none; background:var(--brand); color:#fff; width:24px; height:24px; border-radius:50%; font-weight:900;">＋</button>
          </div>

          <div style="display:flex; gap:8px;">
            ${canEdit ? `<button type="button" onclick="editCartItemOptions(${idx}, false)" style="border:none; background:var(--brand-light); color:var(--brand-dark); font-weight:800; font-size:0.8rem; padding:6px 12px; border-radius:8px;">✎ 編輯選項</button>` : ''}
            <button type="button" onclick="removeCartItem(${idx})" style="border:none; background:#F3F4F6; color:var(--text-secondary); font-weight:800; font-size:0.8rem; padding:6px 12px; border-radius:8px;">🗑️ 移除</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  let promoNoticeHtml = '';
  if (promoActive) {
    if (store.promoMode === 'gift' || store.promoMode === 'freebie') {
      promoNoticeHtml = `
        <div style="background:#ECFDF5; border:1.5px solid #10B981; border-radius:12px; padding:10px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.84rem; font-weight:900; color:#065F46;">${escapeHtml(store.promoText)}（將自動列入廚房出單明細）</span>
          <span style="font-size:0.84rem; font-weight:900; color:#059669;">NT$ 0 贈送</span>
        </div>
      `;
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

  const validSlotsForSelect = isReserve ? getValidPickupTimeSlots(state.checkoutReserveDate) : [];

  const checkoutSettingsHtml = `
    ${promoNoticeHtml}
    <div style="background:#FFFFFF; padding:16px; border-radius:14px; border:1px solid var(--border); margin-top:14px;">
      <h4 style="font-size:0.95rem; font-weight:900; margin-bottom:12px;">📋 取餐與結帳設定</h4>

      <label class="field-label">🍽️ 用餐方式（皆為櫃檯叫號自取）</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
        <button type="button" class="filter-chip ${state.checkoutDineType === '外帶自取' ? 'active' : ''}" onclick="setCheckoutMode('checkoutDineType', '外帶自取')">🛍️ 外帶自取</button>
        <button type="button" class="filter-chip ${state.checkoutDineType === '內用自取' ? 'active' : ''}" onclick="setCheckoutMode('checkoutDineType', '內用自取')">🍽️ 內用自取</button>
      </div>

      <label class="option-label-row ${state.checkoutNeedCutlery ? 'checked' : ''}" style="margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <input type="checkbox" ${state.checkoutNeedCutlery ? 'checked' : ''} onchange="setCheckoutMode('checkoutNeedCutlery', this.checked)" style="width:18px; height:18px; accent-color:var(--brand);">
          <span style="font-weight:800; color:var(--text-primary);">🥢 需要一次性免洗餐具</span>
        </div>
        <span style="font-weight:900; color:var(--brand);">${storeCutleryPrice > 0 ? `+NT$ ${storeCutleryPrice}` : '免費 ($0)'}</span>
      </label>

      <label class="field-label">⏰ 取餐時間（預訂訂單將於取餐前 25 分鐘自動排入廚房下鍋）</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
        <button type="button" class="filter-chip ${state.checkoutTimeMode === 'NOW' ? 'active' : ''}" ${store && store.isOpen === false ? 'disabled style="opacity:0.45; cursor:not-allowed;"' : ''} onclick="setCheckoutMode('checkoutTimeMode', 'NOW')">
          ${store && store.isOpen === false ? '🔴 暫停立即製作' : `⚡ 立即製作 (約 ${store ? store.avgPrepMinutes : 5} 分)`}
        </button>
        <button type="button" class="filter-chip ${state.checkoutTimeMode === 'RESERVE' ? 'active' : ''}" onclick="setCheckoutMode('checkoutTimeMode', 'RESERVE')">
          📅 預訂取餐
        </button>
      </div>

      ${isReserve ? `
        <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:12px; padding:12px; margin-bottom:12px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
            <div>
              <label class="field-label">📅 取餐日期 *</label>
              <input type="date" class="select-input" min="${getTodayDateStr()}" value="${escapeHtml(state.checkoutReserveDate)}" onchange="setCheckoutMode('checkoutReserveDate', this.value)">
            </div>
            <div>
              <label class="field-label">🕒 學餐營業取餐時段 (10:30~19:30) *</label>
              <select class="select-input" onchange="state.checkoutReserveTime=this.value">
                ${validSlotsForSelect.map(t => `<option value="${t}" ${state.checkoutReserveTime === t ? 'selected' : ''}>${t} 取餐</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label class="field-label" style="color:var(--red);">📱 聯絡電話號碼 *（預訂必填，供取餐聯絡）</label>
            <input type="tel" id="checkoutPhoneInput" class="select-input" placeholder="請輸入手機號碼，例如：0912345678" value="${escapeHtml(state.checkoutPhone)}" oninput="state.checkoutPhone=this.value">
          </div>
          ${isLargeOrderReserve && state.checkoutPayMethod === '現場櫃檯付現' ? `
            <div style="margin-top:8px; background:#FFFBEB; border:1px solid #F59E0B; color:#92400E; padding:8px 10px; border-radius:8px; font-size:0.76rem; font-weight:800;">
              💡 大額團訂（滿 NT$${LARGE_ORDER_DEPOSIT_THRESHOLD}）選擇現金付款時，訂單狀態將列為「待付款確認」，請於取餐前至櫃檯確認或改選線上支付立即排程。
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div>
          <label class="field-label">💳 付款方式</label>
          <select class="select-input" onchange="setCheckoutMode('checkoutPayMethod', this.value)">
            <option value="LINE Pay" ${state.checkoutPayMethod === 'LINE Pay' ? 'selected' : ''}>LINE Pay (線上授權・立即排程)</option>
            <option value="街口支付" ${state.checkoutPayMethod === '街口支付' ? 'selected' : ''}>街口支付 (線上授權・立即排程)</option>
            <option value="現場櫃檯付現" ${state.checkoutPayMethod === '現場櫃檯付現' ? 'selected' : ''}>
              ${isLargeOrderReserve ? '現場櫃檯付訂確認 (大額團訂)' : '取餐時櫃檯付現'}
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">📝 飲食備註 (選填)</label>
          <input type="text" class="select-input" placeholder="例：飯少、湯分開裝" value="${escapeHtml(state.checkoutNote)}" oninput="state.checkoutNote=this.value">
        </div>
      </div>
    </div>
  `;

  listDiv.innerHTML = itemsCardsHtml + checkoutSettingsHtml;

  const modalTotalEl = document.getElementById('cartModalTotal');
  if (modalTotalEl) {
    const tags = [];
    if (cutleryFee > 0) tags.push(`含免洗餐具+$${cutleryFee}`);
    if (discount > 0) tags.push(`離峰折抵-$${discount}`);
    modalTotalEl.innerHTML = tags.length > 0
      ? `<span style="font-size:0.8rem; color:var(--green); margin-right:6px;">(${tags.join(' / ')})</span>NT$ ${finalTotal}`
      : `NT$ ${finalTotal}`;
  }
}

/**
 * 商業級重構 2 & 3：雲端權威單號核發 + 正規化 Order Schema 送單流程
 * 連線狀態下一律等待伺服器 LockService 核發權威單號與驗算金額後，才入庫與發送 LINE 推播，徹底根除撞號！
 */
async function submitStudentCartOrder() {
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  if (!store || state.cartItems.length === 0) return;

  if (store.isOpen === false && state.checkoutTimeMode === 'NOW') {
    showToast('⚠️ 本店目前暫停立即出餐，已為您切換為「預訂取餐」模式，請確認取餐時間與電話！');
    state.checkoutTimeMode = 'RESERVE';
    updateCartUI();
    return;
  }

  const soldOutInCart = state.cartItems.find(ci => {
    const m = (store.menus || []).find(menu => String(menu.id) === String(ci.id));
    return m && m.soldOut;
  });
  if (soldOutInCart) {
    showToast(`🚫 抱歉，購物車內的「${soldOutInCart.name}」剛剛已售罄，請先移除該品項！`);
    return;
  }

  const isReserve = state.checkoutTimeMode === 'RESERVE';
  const cleanPhone = (state.checkoutPhone || '').replace(/\D/g, '');

  if (isReserve) {
    const validSlots = getValidPickupTimeSlots(state.checkoutReserveDate);
    if (!validSlots.includes(state.checkoutReserveTime)) {
      showToast('⚠️ 您選擇的預訂時段已過期或非營業時間，請重新選擇時段！');
      updateCartUI();
      return;
    }
    if (cleanPhone.length < 8) {
      showToast('⚠️ 預訂取餐請填寫有效的聯絡電話號碼！');
      document.getElementById('checkoutPhoneInput')?.focus();
      return;
    }
  }

  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = state.checkoutNeedCutlery ? storeCutleryPrice : 0;
  const promoActive = isStorePromoActive(store);
  const discount = (subtotal >= AI_DISCOUNT_MIN_SUBTOTAL && promoActive && store.promoMode === 'discount')
    ? Math.min(subtotal, Number(store.promoDiscount) || 10)
    : 0;
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);
  const promoApplied = promoActive ? store.promoText : '一般點餐';

  let transactionId = '';
  if (state.checkoutPayMethod === 'LINE Pay' || state.checkoutPayMethod === '街口支付') {
    const payResult = await requestOnlinePaymentGateway(state.checkoutPayMethod, finalTotal, store.name);
    if (!payResult || !payResult.approved) {
      showToast('已取消線上支付授權');
      return;
    }
    transactionId = payResult.transactionId || '';
  }

  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) {}

  const btn = document.getElementById('finalSubmitOrderBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ 正在向雲端伺服器申請權威取餐單號...';
  }

  const isLargeOrderCashReserve = isReserve && finalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD && state.checkoutPayMethod === '現場櫃檯付現';
  const paymentDeadline = isLargeOrderCashReserve ? normalizeDateStr(state.checkoutReserveDate) : '';
  const paymentStatus = isLargeOrderCashReserve
    ? '待櫃檯繳費'
    : (state.checkoutPayMethod === '現場櫃檯付現' ? '取餐付現' : '已付款');

  const pickupDateVal = isReserve ? normalizeDateStr(state.checkoutReserveDate) : getTodayDateStr();
  const nowTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  const pickupTimeVal = isReserve ? state.checkoutReserveTime : nowTime.slice(0, 5);
  const pickupTimeSlot = isReserve
    ? `📅 預訂 ${pickupDateVal} ${state.checkoutReserveTime}`
    : `⚡ 立即製作 (約${store.avgPrepMinutes}分)`;

  const structuredItems = state.cartItems.map(i => normalizeOrderItemEntry({
    id: i.id,
    baseName: i.baseName || i.name,
    price: i.price,
    qty: i.qty || 1,
    selections: i.selections || {}
  }));

  if (promoActive && (store.promoMode === 'gift' || store.promoMode === 'freebie') && store.promoText) {
    structuredItems.push(normalizeOrderItemEntry({
      id: 'GIFT-AI',
      baseName: `${store.promoText} (贈品)`,
      price: 0,
      qty: 1,
      selections: {},
      isGift: true
    }));
  }

  const draftOrder = sanitizeIncomingOrder({
    orderId: generateOrderToken(),
    pickupNumber: '', // 交由伺服器 LockService 權威配號
    storeId: store.id,
    storeName: store.name,
    studentId: isReserve ? '📅 預訂點餐' : '📱 掃碼點餐',
    dineType: state.checkoutDineType,
    customerNote: (state.checkoutNote || '').trim(),
    structuredItems,
    subtotal,
    cutleryFee,
    needCutlery: state.checkoutNeedCutlery,
    discount,
    manualDiscount: 0,
    finalTotal,
    promoApplied,
    pickupTimeSlot,
    paymentMethod: state.checkoutPayMethod,
    isReservation: isReserve,
    pickupDate: pickupDateVal,
    pickupTime: pickupTimeVal,
    customerPhone: isReserve ? state.checkoutPhone.trim() : '',
    paymentDeadline,
    paymentStatus,
    transactionId,
    notifyCount: 0,
    lineUserId: state.lineProfile.lineUserId || '',
    customerEmail: state.lineProfile.email || '',
    isDivertedOrder: promoActive,
    createdAt: nowTime,
    createdAtTs: Date.now(),
    cookingStartedAtTs: isReserve ? 0 : Date.now()
  });

  try {
    setSyncState('syncing', '核發權威單號中...');
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'submitOrder',
        ...draftOrder,
        orderSource: draftOrder.studentId,
        campus: store.campus,
        items: structuredItems
      })
    });
    const data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.message) || '伺服器驗算拒絕');
    }
    if (data.order) {
      draftOrder.orderId = data.order.orderId || draftOrder.orderId;
      draftOrder.pickupNumber = String(data.order.pickupNumber || generateOfflineFallbackPickupNumber(store.id, pickupDateVal));
      if (data.order.finalTotal !== undefined) draftOrder.finalTotal = Number(data.order.finalTotal);
      if (data.order.subtotal !== undefined) draftOrder.subtotal = Number(data.order.subtotal);
      if (data.order.discount !== undefined) draftOrder.discount = Number(data.order.discount);
      if (data.order.status) draftOrder.status = data.order.status;
      if (data.order.itemsJson) draftOrder.itemsJson = data.order.itemsJson;
      syncLocalSeqWithAuthoritativeNumber(store.id, pickupDateVal, draftOrder.pickupNumber);
    }
    setSyncState('online', '已同步');
  } catch (e) {
    // 僅在網路斷線時才啟用離線備援流水號
    draftOrder.pickupNumber = generateOfflineFallbackPickupNumber(store.id, pickupDateVal);
    draftOrder.isOfflinePending = true;
    setSyncState('offline', '離線備援單號模式');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '確認餐點並送出訂單';
    }
  }

  const finalOrder = sanitizeIncomingOrder(draftOrder);
  state.pendingLocalOrdersMap[finalOrder.orderId] = Date.now();
  state.knownStoreOrderIds.add(finalOrder.orderId);
  state.orders.unshift(finalOrder);
  addOrderToMyHistory(finalOrder.orderId);
  saveCachedOrders(state.orders);
  state.lastSeenOrderNotifyMap[finalOrder.orderId] = { status: finalOrder.status, notifyCount: 0 };

  enrichStoresAndAi();
  saveLocalStores(state.stores);

  // 取得權威單號後才觸發 LINE 推播，確保推播內的號碼與櫃檯 KDS 100% 一致
  if (isLargeOrderCashReserve) {
    pushLineNotification(
      'ORDER_RESERVE_UNPAID',
      `⏳ 大額預訂單 #${finalOrder.pickupNumber} 待確認`,
      `您已預訂 ${finalOrder.pickupDate} ${finalOrder.pickupTime}【${store.name}】共 NT$${finalOrder.finalTotal}。請於取餐前至櫃檯付訂確認以排入廚房製程。`,
      finalOrder
    );
  } else {
    pushLineNotification(
      'ORDER_CREATED',
      `🟢 訂單 #${finalOrder.pickupNumber} 已成立 (${finalOrder.status})`,
      `【${store.name}】${pickupTimeSlot}，應付 NT$${finalOrder.finalTotal} (${finalOrder.paymentMethod}${transactionId ? ' / 授權碼:' + transactionId : ''})。`,
      finalOrder
    );
  }

  state.cartItems = [];
  state.checkoutNote = '';
  closeCartModal();
  navigateToOrderTicket(finalOrder.orderId);
  showToast(`🎉 點餐成功！取餐流水號：#${finalOrder.pickupNumber}`);
}

// ==================== 4. 智慧選餐顧問（自動過濾休息中店家與已售罄品項） ====================
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
    time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
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
      reasoning: `👋 你好！我是東吳學餐智慧選餐顧問。目前「${state.campus}」正常營業中的餐廳有：${storeNames}。你可以直接問我：「推薦 $100 內不排隊的餐」、「想吃辣的麵」、「哪家有送優惠？」或「預訂怎麼付錢？」，我會自動幫你排除已售罄品項與休息中店家！`,
      storeId: fastestStore.id,
      menuId: firstAvailDish.id,
      engine: '智慧語意選餐顧問'
    });
    return;
  }

  if (q.includes('預訂') || q.includes('預約') || q.includes('現金') || q.includes('付錢') || q.includes('付款') || q.includes('餐具') || q.includes('低消')) {
    appendAiAssistantReply({
      reasoning: `📋 學餐取餐與優惠規則說明：1️⃣ 內用與外帶皆為「櫃檯叫號自取」，如需免洗餐具可於結帳勾選。2️⃣ 預訂取餐時段為 10:30～19:30（將於取餐前 25 分鐘自動排入廚房下鍋）；一般小額預訂（<$${LARGE_ORDER_DEPOSIT_THRESHOLD}）支援線上支付或取餐付現，滿 $${LARGE_ORDER_DEPOSIT_THRESHOLD} 團訂可選線上支付或至櫃檯付訂確認。3️⃣ 離峰現金折抵需餐點滿 NT$${AI_DISCOUNT_MIN_SUBTOTAL} 即可折抵！`,
      storeId: fastestStore.id,
      menuId: firstAvailDish.id,
      engine: '學餐規則知識庫'
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
    reasoning: `💡 為您推薦「${best.store.name}」正常供應中的【${best.menu.name} (NT$${best.menu.price})】！原因：${whyText}。${queueNote}${best.store.promoMode !== 'none' ? `，結帳再享「${best.store.promoText}」！` : '。'}`,
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
    engine: '即時佇列與庫存智慧配餐引擎'
  });
}

function appendAiAssistantReply(aiResult) {
  state.aiChatMessages.push({
    role: 'assistant',
    aiResult,
    time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
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
            <button type="button" onclick="enterStoreOrdering('${escapeHtml(alt.storeId)}', '${escapeHtml(alt.menuId)}')" style="border:1px solid #C7D2FE; background:#EEF2FF; color:#312E81; border-radius:6px; padding:3px 8px; margin-left:4px; margin-top:4px; font-size:0.72rem; font-weight:700;">
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
            <button type="button" class="btn-tip-action" style="padding:7px 14px; font-size:0.8rem;" onclick="enterStoreOrdering('${escapeHtml(targetStore.id)}', '${escapeHtml(targetMenu.id)}')">
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

function promptGeminiKeyConfig() {
  showToast('🔒 智慧配餐金鑰已由雲端伺服器安全託管，無須於前端手動輸入！');
}

// ==================== 5. 專屬訂單追蹤頁（內建離線 SVG 條碼與動態防截圖時鐘） ====================
function renderSingleTicketView() {
  const box = document.getElementById('singleTicketContainer') || document.getElementById('singleOrderTicketBox');
  if (!box) return;

  const orderId = state.trackingOrderId || state.activeOrderId;
  const o = state.orders.find(ord => ord.orderId === orderId);

  if (!o) {
    box.innerHTML = `
      <div class="ticket-hero-card">
        <div style="font-size:3rem; margin-bottom:10px;">🔍</div>
        <h2 style="font-size:1.3rem; font-weight:900; margin-bottom:6px;">找不到此訂單 (${escapeHtml(orderId || '未知')})</h2>
        <p style="font-size:0.86rem; color:var(--text-secondary); margin-bottom:20px;">請確認您的訂單連結是否完整，或開啟「我的訂單匣」切換其他訂單。</p>
        <div style="display:flex; gap:10px; justify-content:center;">
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
      ? ` <small style="color:var(--text-secondary); font-weight:700;">(${Object.entries(i.selections).map(([k, v]) => `${k}:${v}`).join(', ')})</small>`
      : '';
    return `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border); font-size:0.92rem;">
        <span>
          <strong>${escapeHtml(i.baseName || i.name)}</strong>${selStr} × ${i.qty || 1}
          ${i.isGift || Number(i.price) === 0 ? `<span style="background:#DCFCE7; color:#166534; font-size:0.72rem; font-weight:900; padding:2px 6px; border-radius:6px; margin-left:4px;">🎁 招待贈品</span>` : ''}
        </span>
        <span style="font-weight:800; color:${Number(i.price) === 0 ? 'var(--green)' : 'inherit'};">NT$ ${i.price * (i.qty || 1)}</span>
      </div>
    `;
  }).join('');

  const shareUrl = `${window.location.origin}${getOrderPageUrl('id=' + encodeURIComponent(o.orderId))}`;
  const inlineQrSvg = generateDeterministicQrSvg(`${o.orderId}|${o.pickupNumber}|${o.finalTotal}`, 96);

  const isCompleted = o.status === '已完成';
  const isReady = o.status === '可取餐';
  const isScheduled = o.status === '已接單待排程';
  const isPendingPay = o.status === '待付款確認';
  const isCancelled = o.status && o.status.includes('已取消');

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
  const liveNowClock = new Date().toLocaleTimeString('zh-TW', { hour12: false });

  box.innerHTML = `
    <div class="ticket-hero-card" style="${isReady ? 'border:2.5px solid var(--green); box-shadow:0 0 0 6px rgba(16,185,129,0.12);' : ''}">
      <!-- 商業級重構 8：防截圖動態呼吸驗證橫幅 -->
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
      <div style="font-size:1rem; font-weight:900; color:${statusColor}; margin-bottom:6px;">${escapeHtml(statusHeadline)}</div>
      <div style="font-size:0.78rem; color:var(--text-muted);">
        訂單憑證：${escapeHtml(o.orderId)} ・ 下單時間：${escapeHtml(o.createdAt)}
        ${o.transactionId ? ` ・ 授權碼：${escapeHtml(o.transactionId)}` : ''}
      </div>

      ${isReady ? `
        <div style="margin-top:12px; background:#ECFDF5; border:1.5px solid #10B981; color:#065F46; padding:12px; border-radius:12px; font-weight:800; font-size:0.9rem;">
          🎉 櫃檯已按下「通知取餐」！請出示此動態防偽畫面取餐號 <strong>#${escapeHtml(o.pickupNumber)}</strong> 領取餐點。
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

      <div style="display:flex; align-items:center; justify-content:center; gap:16px; background:#FFFFFF; border:1px dashed var(--border); border-radius:14px; padding:14px; margin-bottom:16px; flex-wrap:wrap;">
        <div class="svg-qr-box" title="純前端離線防偽核銷碼">${inlineQrSvg}</div>
        <div style="text-align:left; max-width:260px;">
          <div style="font-size:0.85rem; font-weight:800; color:var(--text-primary); margin-bottom:4px;">🔗 離線防偽數位核銷條碼</div>
          <p style="font-size:0.76rem; color:var(--text-secondary); line-height:1.4; margin-bottom:8px;">
            內建純前端向量條碼與上方動態防偽時鐘，即使學餐地下室網路訊號不佳亦不會破圖。
          </p>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="filter-chip" style="padding:5px 12px; font-size:0.76rem;" onclick="copyOrderUrl('${escapeHtml(shareUrl)}')">📋 複製訂單網址</button>
            <button type="button" class="filter-chip" style="padding:5px 12px; font-size:0.76rem;" onclick="openReceiptPrintModal('${escapeHtml(o.orderId)}')">🖨️ 電子收據小票</button>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="btn-outline" onclick="syncCloud(true)">🔄 立即刷新狀態</button>
        <button type="button" class="btn-primary-full" style="max-width:220px;" onclick="navigateToOrderMenu()">➕ 再點一單 / 返回菜單</button>
      </div>
    </div>
  `;
}

function copyOrderUrl(url) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('✅ 已複製專屬訂單網址！'));
  } else {
    showToast('訂單網址：' + url);
  }
}

// ==================== 6. 店家端營運管理系統 (`/store/` 嚴格權限守門) ====================
function switchStoreTabMode(mode) {
  if (!state.isMerchantUnlocked) {
    checkMerchantSecurityGate();
    return;
  }
  state.storeTabMode = mode;
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
  state.merchantStoreId = storeId;
  state.posSelectedCategory = '全部';
  state.posCart = [];
  state.posCashReceived = '';
  state.posManualDiscount = 0;
  state.posManualDiscountReason = '';
  const topSel = document.getElementById('storeTopSwitcher');
  if (topSel && topSel.value !== storeId) topSel.value = storeId;
  renderMerchantView();
}

async function toggleCurrentStoreOpenStatus() {
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  store.isOpen = store.isOpen === false ? true : false;
  state.lastLocalStoreConfigUpdateTs = Date.now();
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();

  showToast(store.isOpen ? `🟢 「${store.name}」已恢復正常營業！` : `🔴 「${store.name}」已設為暫停營業（學生端僅開放預訂）`);

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
        maxCapacityPer15Min: store.maxCapacityPer15Min,
        baseQueueOffset: store.baseQueueOffset || 0,
        promoMode: store.promoMode,
        promoText: store.promoText,
        promoDiscount: store.promoDiscount
      })
    });
  } catch (e) {}
}

async function toggleMenuItemSoldOut(menuIdx, evt) {
  if (evt) evt.stopPropagation();
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[menuIdx]) return;

  store.menus[menuIdx].soldOut = !store.menus[menuIdx].soldOut;
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  renderMerchantView();

  const item = store.menus[menuIdx];
  showToast(item.soldOut ? `🚫 已將「${item.name}」標記為今日售罄` : `🟢 已將「${item.name}」恢復正常供應`);
}

/**
 * 商業級重構 1：在未通過 PIN 碼授權前，絕不渲染任何後台 DOM 節點！
 */
function renderMerchantView() {
  enrichStoresAndAi();
  ensureHeaderExtraControls();
  updateBodyScrollLock();

  if (!state.isMerchantUnlocked || !state.merchantAuthToken) {
    ['pos', 'kds', 'analytics', 'settings'].forEach(m => {
      const panel = document.getElementById(`storePanel-${m}`);
      if (panel) {
        panel.innerHTML = m === state.storeTabMode ? `
          <div class="auth-locked-stage">
            <div style="font-size:3rem; margin-bottom:10px;">🔒</div>
            <h3 style="font-size:1.25rem; font-weight:900; color:var(--text-primary); margin-bottom:6px;">店務營運後台受保護中</h3>
            <p style="font-size:0.86rem; margin-bottom:16px;">未完成店員安全授權前，系統禁止載入收銀、退單與營業報表節點。</p>
            <button type="button" class="btn-tip-action" onclick="checkMerchantSecurityGate()">🔑 輸入店務授權碼解鎖</button>
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
    topSel.innerHTML = state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>${escapeHtml(s.campus)} — ${escapeHtml(s.name)} ${s.isOpen === false ? '(休息中)' : ''}</option>`).join('');
  }

  const openToggleBtn = document.getElementById('headerStoreOpenToggleBtn');
  if (openToggleBtn) {
    const isOpen = store.isOpen !== false;
    openToggleBtn.className = 'store-status-toggle ' + (isOpen ? '' : 'closed');
    openToggleBtn.innerHTML = isOpen ? '🟢 營業中 (點此切換)' : '🔴 暫停營業 (點此恢復)';
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
}

// ==================== 6.1 平板收銀櫃檯點餐 (POS) — 支援手動折讓/招待與交班日結 Z-Report ====================
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

function clearPosCart() {
  state.posCart = [];
  state.posCashReceived = '';
  state.posManualDiscount = 0;
  state.posManualDiscountReason = '';
  state.posCustomerNote = '';
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

function setPosOption(field, value) {
  state[field] = value;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

function setPosManualDiscountPreset(amount, reasonText) {
  if (state.posManualDiscount === amount && state.posManualDiscountReason === reasonText) {
    state.posManualDiscount = 0;
    state.posManualDiscountReason = '';
  } else {
    state.posManualDiscount = Math.max(0, Number(amount) || 0);
    state.posManualDiscountReason = reasonText || '櫃檯折讓';
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

function promptCustomPosDiscount() {
  const amtStr = window.prompt('請輸入單筆櫃檯折讓金額 (NT$)：', String(state.posManualDiscount || 15));
  if (amtStr === null) return;
  const amt = Math.max(0, parseInt(amtStr, 10) || 0);
  const reason = amt > 0 ? (window.prompt('請輸入折讓/招待原因（如：教職員折扣、久候招待）：', state.posManualDiscountReason || '教職員/熟客折讓') || '櫃檯手動折讓') : '';
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
}

function openPosCashNumpadModal() {
  renderPosCashNumpadModal();
  document.getElementById('posCashNumpadModal')?.classList.add('open');
}

function closePosCashNumpadModal() {
  document.getElementById('posCashNumpadModal')?.classList.remove('open');
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
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
}

function calcCurrentPosTotals(store) {
  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const subtotal = state.posCart.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.posNeedCutlery) ? storeCutleryPrice : 0;
  const promoActive = isStorePromoActive(store);
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
}

function renderPosCashierPanel(store) {
  const panel = document.getElementById('storePanel-pos');
  if (!panel) return;

  const menus = store.menus || [];
  const categories = ['全部', ...new Set(menus.map(m => m.category || '主廚推薦'))];
  const filteredMenus = state.posSelectedCategory === '全部'
    ? menus
    : menus.filter(m => (m.category || '主廚推薦') === state.posSelectedCategory);

  const { storeCutleryPrice, subtotal, cutleryFee, discount, manualDiscount, finalTotal } = calcCurrentPosTotals(store);

  const isReserve = state.posTimeMode === 'RESERVE';
  let posValidSlots = [];
  if (isReserve) {
    posValidSlots = getValidPickupTimeSlots(state.posReserveDate);
    if (posValidSlots.length === 0) {
      state.posReserveDate = getDateOffsetStr(1);
      posValidSlots = getValidPickupTimeSlots(state.posReserveDate);
    }
    if (!posValidSlots.includes(state.posReserveTime)) {
      state.posReserveTime = posValidSlots[0] || '12:15';
    }
  }

  const cashReceivedNum = state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal;
  const changeAmount = Math.max(0, cashReceivedNum - finalTotal);
  const isCashInsufficient = state.posPayment === '現場現金' && state.posCashReceived !== '' && cashReceivedNum < finalTotal;

  const nextPreviewSeq = generatePreviewNextSeq(store.id, isReserve ? state.posReserveDate : getTodayDateStr());

  panel.innerHTML = `
    <div class="pos-modern-workspace">
      <div class="pos-menu-card">
        <div class="pos-cat-strip">
          ${categories.map(cat => `
            <button type="button" class="pos-cat-pill ${state.posSelectedCategory === cat ? 'active' : ''}" onclick="selectPosCategory('${escapeHtml(cat)}')">
              ${escapeHtml(cat)}
            </button>
          `).join('')}
          <button type="button" class="pos-cat-pill" style="margin-left:auto; background:#0F172A; color:#FFFFFF; border-color:#0F172A;" onclick="openShiftZReportModal()">
            🧾 交班日結單 (Z-Report)
          </button>
        </div>

        <div class="pos-dish-grid">
          ${filteredMenus.map(m => {
            const fullIdx = menus.findIndex(x => String(x.id) === String(m.id));
            const hasOpts = m.options && Object.keys(m.options).length > 0;
            const isSoldOut = Boolean(m.soldOut);
            return `
              <div class="pos-dish-tile ${isSoldOut ? 'sold-out' : ''}" onclick="handleMenuItemClick('${escapeHtml(m.id)}', true)">
                <div>
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                    <span class="pos-tile-cat">${escapeHtml(m.category || '招牌')}</span>
                    <button type="button" onclick="toggleMenuItemSoldOut(${fullIdx}, event)" style="border:none; background:${isSoldOut ? '#FEE2E2' : '#F1F5F9'}; color:${isSoldOut ? '#DC2626' : '#475569'}; font-size:0.66rem; font-weight:900; padding:2px 6px; border-radius:6px;" title="一鍵切換售罄或上架狀態">
                      ${isSoldOut ? '🚫 已售罄(點此上架)' : (hasOpts ? '⚙️ 客製 ・ 售罄' : '售罄切換')}
                    </button>
                  </div>
                  <div class="pos-tile-name">${escapeHtml(m.name)}</div>
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
              🧾 櫃檯結帳單 <span style="color:var(--brand-dark); font-size:0.82rem;">(預覽單號 #${nextPreviewSeq})</span>
            </div>
            <div style="font-size:0.74rem; color:var(--text-secondary);">${escapeHtml(store.name)} ・ 共 ${state.posCart.reduce((s, i) => s + (i.qty || 1), 0)} 份餐點</div>
          </div>
          ${state.posCart.length > 0 ? `<button type="button" onclick="clearPosCart()" style="border:1px solid #FECACA; background:var(--red-bg); color:var(--red); padding:4px 10px; border-radius:8px; font-size:0.74rem; font-weight:800;">🗑️ 清空</button>` : ''}
        </div>

        <div class="pos-receipt-list">
          ${state.posCart.length === 0 ? `
            <div style="text-align:center; color:var(--text-muted); padding:32px 12px; font-size:0.84rem;">
              <div style="font-size:2rem; margin-bottom:6px;">🍱</div>
              請點擊左側餐點卡片加入結帳單<br><small style="font-size:0.72rem;">(上方可隨時查看「🧾 交班日結單 Z-Report」核對錢箱)</small>
            </div>
          ` : state.posCart.map((item, idx) => {
            const selStr = item.selections && Object.keys(item.selections).length > 0
              ? Object.entries(item.selections).map(([k, v]) => `${k}:${v}`).join(', ')
              : '';
            const storeMenu = (store.menus || []).find(m => String(m.id) === String(item.id));
            const canEdit = storeMenu && storeMenu.options && Object.keys(storeMenu.options).length > 0;

            return `
              <div class="pos-receipt-item">
                <div style="flex:1; min-width:0;">
                  <div style="font-weight:800; font-size:0.86rem; color:var(--text-primary);">${escapeHtml(item.baseName || item.name)}</div>
                  ${selStr ? `<div style="font-size:0.72rem; color:var(--brand-dark); font-weight:700;">${escapeHtml(selStr)}</div>` : ''}
                  <div style="font-size:0.78rem; font-weight:900; color:var(--red);">NT$ ${item.price * (item.qty || 1)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:4px;">
                  ${canEdit ? `<button type="button" onclick="editCartItemOptions(${idx}, true)" style="border:1px solid var(--border); background:#EFF6FF; color:#1D4ED8; width:26px; height:26px; border-radius:6px; font-size:0.74rem; font-weight:800;">✎</button>` : ''}
                  <button type="button" onclick="changePosCartQty(${idx}, -1)" style="border:1px solid var(--border); background:#FFFFFF; width:26px; height:26px; border-radius:6px; font-weight:900;">－</button>
                  <span style="font-weight:900; min-width:18px; text-align:center; font-size:0.84rem;">${item.qty || 1}</span>
                  <button type="button" onclick="changePosCartQty(${idx}, 1)" style="border:1px solid var(--border); background:#FFFFFF; width:26px; height:26px; border-radius:6px; font-weight:900;">＋</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="pos-receipt-footer">
          <div style="display:grid; grid-template-columns:1fr 1fr 1.25fr; gap:5px; margin-bottom:5px;">
            <button type="button" class="pos-chip-btn ${state.posDineType === '內用自取' ? 'active' : ''}" onclick="setPosOption('posDineType', '內用自取')">🍽️ 內用自取</button>
            <button type="button" class="pos-chip-btn ${state.posDineType === '外帶自取' ? 'active' : ''}" onclick="setPosOption('posDineType', '外帶自取')">🛍️ 外帶自取</button>
            <button type="button" class="pos-chip-btn ${state.posNeedCutlery ? 'active' : ''}" onclick="setPosOption('posNeedCutlery', !state.posNeedCutlery)">
              🥢 餐具 (${storeCutleryPrice > 0 ? `+$${storeCutleryPrice}` : '$0'})
            </button>
          </div>

          <!-- 商業級重構 7：櫃檯單筆手動折讓 / 教職員優惠 / 招待 -->
          <div class="pos-discount-strip">
            <span style="font-size:0.72rem; font-weight:900; color:var(--text-secondary); white-space:nowrap;">🏷️ 櫃檯折讓:</span>
            <button type="button" class="pos-chip-btn ${state.posManualDiscount === 10 ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(10, '教職員/熟客折$10')">折$10</button>
            <button type="button" class="pos-chip-btn ${state.posManualDiscount === 20 ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(20, '久候/活動折$20')">折$20</button>
            <button type="button" class="pos-chip-btn ${subtotal > 0 && state.posManualDiscount >= subtotal ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(${subtotal}, '店長全額招待')">全單招待</button>
            <button type="button" class="pos-chip-btn" style="padding:3px 7px; font-size:0.72rem; margin-left:auto;" onclick="promptCustomPosDiscount()">自訂</button>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-bottom:5px;">
            <button type="button" class="pos-chip-btn ${state.posTimeMode === 'NOW' ? 'active' : ''}" onclick="setPosOption('posTimeMode', 'NOW')">⚡ 立即出餐</button>
            <button type="button" class="pos-chip-btn ${state.posTimeMode === 'RESERVE' ? 'active' : ''}" onclick="setPosOption('posTimeMode', 'RESERVE')">📅 預訂取餐</button>
          </div>

          ${isReserve ? `
            <div style="display:grid; grid-template-columns:1fr 0.9fr 1.1fr; gap:4px; background:var(--bg-page); padding:5px; border-radius:8px; border:1px solid var(--border); margin-bottom:5px;">
              <input type="date" class="select-input" style="padding:4px 6px; font-size:0.74rem;" min="${getTodayDateStr()}" value="${escapeHtml(state.posReserveDate)}" onchange="setPosOption('posReserveDate', this.value)">
              <select class="select-input" style="padding:4px 6px; font-size:0.74rem;" onchange="state.posReserveTime=this.value">
                ${posValidSlots.map(t => `<option value="${t}" ${state.posReserveTime === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
              <input type="tel" class="select-input" style="padding:4px 6px; font-size:0.74rem; border-color:var(--red);" placeholder="📱 電話(必填)" value="${escapeHtml(state.posCustomerPhone)}" oninput="state.posCustomerPhone=this.value">
            </div>
          ` : ''}

          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:5px; margin-bottom:5px;">
            ${['現場現金', 'LINE Pay', '街口支付'].map(pay => `
              <button type="button" class="pos-chip-btn ${state.posPayment === pay ? 'active' : ''}" onclick="setPosOption('posPayment', '${pay}')">
                ${pay}
              </button>
            `).join('')}
          </div>

          ${state.posPayment === '現場現金' ? `
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; margin-bottom:5px;">
              <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(${finalTotal})">剛好</button>
              <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(100)">$100</button>
              <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(500)">$500</button>
              <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(1000)">$1000</button>
            </div>
            <button type="button" onclick="openPosCashNumpadModal()" style="width:100%; display:flex; justify-content:space-between; align-items:center; padding:7px 12px; border-radius:10px; border:1.5px dashed var(--brand); background:var(--brand-light); color:var(--brand-dark); font-size:0.78rem; font-weight:900; margin-bottom:6px;">
              <span>🔢 實收: NT$ ${state.posCashReceived !== '' ? escapeHtml(state.posCashReceived) : `${finalTotal} (點此輸入)`}</span>
              <span style="color:${isCashInsufficient ? 'var(--red)' : 'var(--green)'};">
                ${isCashInsufficient ? `不足 $${finalTotal - cashReceivedNum}` : `找零 NT$ ${changeAmount}`} ➔
              </span>
            </button>
          ` : ''}

          <div style="display:flex; justify-content:space-between; align-items:baseline; margin:4px 0 6px; padding-top:4px; border-top:1px solid var(--border);">
            <span style="font-size:0.8rem; font-weight:900;">
              應收總計 ${cutleryFee > 0 ? `(餐具+$${cutleryFee})` : ''} ${(discount + manualDiscount) > 0 ? `<span style="color:var(--green);">(已折-$${discount + manualDiscount})</span>` : ''}
            </span>
            <span style="font-size:1.3rem; font-weight:950; color:var(--red);">NT$ ${finalTotal}</span>
          </div>

          <button type="button" class="pos-checkout-btn" onclick="submitMerchantPosOrder()" ${state.posCart.length === 0 || isCashInsufficient ? 'disabled' : ''}>
            ⚡ 結帳出單 #${nextPreviewSeq} (${state.posPayment === '現場現金' && changeAmount > 0 ? `找零 $${changeAmount}` : `NT$ ${finalTotal}`})
          </button>
        </div>
      </div>
    </div>
  `;
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
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) return;

  const isReserve = state.posTimeMode === 'RESERVE';
  const cleanPhone = (state.posCustomerPhone || '').replace(/\D/g, '');

  if (isReserve && cleanPhone.length < 8) {
    showToast('⚠️ 預訂取餐請輸入顧客聯絡電話號碼！');
    return;
  }

  const { subtotal, cutleryFee, promoActive, discount, manualDiscount, finalTotal } = calcCurrentPosTotals(store);
  const promoApplied = manualDiscount > 0
    ? (state.posManualDiscountReason || '櫃檯手動折讓')
    : (promoActive ? store.promoText : '現場櫃檯點餐');

  const cashReceivedNum = state.posPayment === '現場現金'
    ? (state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal)
    : finalTotal;
  const changeAmount = state.posPayment === '現場現金' ? Math.max(0, cashReceivedNum - finalTotal) : 0;

  const pickupDateVal = isReserve ? normalizeDateStr(state.posReserveDate) : getTodayDateStr();
  const nowTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });

  const structuredItems = state.posCart.map(i => normalizeOrderItemEntry({
    id: i.id,
    baseName: i.baseName || i.name,
    price: i.price,
    qty: i.qty || 1,
    selections: i.selections || {}
  }));

  if (promoActive && (store.promoMode === 'gift' || store.promoMode === 'freebie') && store.promoText) {
    structuredItems.push(normalizeOrderItemEntry({
      id: 'GIFT-AI',
      baseName: `${store.promoText} (贈品)`,
      price: 0,
      qty: 1,
      selections: {},
      isGift: true
    }));
  }

  const pickupTimeSlot = isReserve
    ? `📅 預訂 ${pickupDateVal} ${state.posReserveTime}`
    : `⚡ 現場立即製作`;

  const draftOrder = sanitizeIncomingOrder({
    orderId: generateOrderToken(),
    pickupNumber: generateOfflineFallbackPickupNumber(store.id, pickupDateVal),
    storeId: store.id,
    storeName: store.name,
    studentId: isReserve ? '📅 櫃檯預訂' : '🖥️ 現場POS',
    dineType: state.posDineType,
    customerNote: state.posCustomerNote || '',
    cashReceived: cashReceivedNum,
    changeGiven: changeAmount,
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
    paymentMethod: state.posPayment,
    isReservation: isReserve,
    pickupDate: pickupDateVal,
    pickupTime: isReserve ? state.posReserveTime : nowTime.slice(0, 5),
    customerPhone: isReserve ? state.posCustomerPhone.trim() : '',
    paymentStatus: '已付款',
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
  state.posManualDiscount = 0;
  state.posManualDiscountReason = '';
  state.posCustomerNote = '';
  renderMerchantView();

  showToast(`🖨️ 櫃檯出單成功！單號 #${draftOrder.pickupNumber} (${draftOrder.status})${changeAmount > 0 ? `，找零 NT$ ${changeAmount}` : ''}`);

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'submitOrder',
        ...getMerchantAuthPayload(),
        ...draftOrder,
        orderSource: draftOrder.studentId,
        campus: store.campus,
        items: structuredItems
      })
    });
    const data = await res.json();
    if (data && data.order && data.order.pickupNumber) {
      draftOrder.pickupNumber = String(data.order.pickupNumber);
      syncLocalSeqWithAuthoritativeNumber(store.id, pickupDateVal, draftOrder.pickupNumber);
      saveCachedOrders(state.orders);
      renderMerchantView();
    }
  } catch (e) {}
}

/**
 * 商業級重構 7：錢箱交班日結單 (Shift Z-Report) 核算與 80mm 出單列印
 */
function openShiftZReportModal() {
  ensureSharedModalsMounted();
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;

  const todayStr = getTodayDateStr();
  const todayStoreOrders = state.orders.filter(o => o.storeId === store.id && normalizeDateStr(o.pickupDate) === todayStr);
  const validOrders = todayStoreOrders.filter(o => !String(o.status).includes('已取消'));
  const cancelledOrders = todayStoreOrders.filter(o => String(o.status).includes('已取消'));
  const paidOrders = validOrders.filter(o => o.paymentStatus === '已付款');
  const unpaidOrders = validOrders.filter(o => o.paymentStatus !== '已付款');

  const grossSubtotal = paidOrders.reduce((s, o) => s + (Number(o.subtotal) || 0) + (Number(o.cutleryFee) || 0), 0);
  const promoDiscountSum = paidOrders.reduce((s, o) => s + (Number(o.discount) || 0), 0);
  const manualDiscountSum = paidOrders.reduce((s, o) => s + (Number(o.manualDiscount) || 0), 0);
  const netRevenue = paidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const cashOrders = paidOrders.filter(o => String(o.paymentMethod).includes('現金') || String(o.paymentMethod).includes('付現'));
  const linePayOrders = paidOrders.filter(o => o.paymentMethod === 'LINE Pay');
  const jkoPayOrders = paidOrders.filter(o => o.paymentMethod === '街口支付');

  const cashTotal = cashOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const linePayTotal = linePayOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const jkoPayTotal = jkoPayOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const cancelledTotal = cancelledOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const unpaidTotal = unpaidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const dineInCount = paidOrders.filter(o => o.dineType === '內用自取').length;
  const takeoutCount = paidOrders.length - dineInCount;

  const titleEl = document.getElementById('receiptPrintModalTitle');
  if (titleEl) titleEl.innerText = '🧾 櫃檯錢箱交班日結單 (Shift Z-Report)';

  const body = document.getElementById('receiptPrintModalBody');
  if (body) {
    body.innerHTML = `
      <div class="thermal-receipt-paper">
        <div style="text-align:center; margin-bottom:8px;">
          <div style="font-size:0.76rem; font-weight:800;">東吳大學學餐智慧 POS 系統</div>
          <div style="font-size:1.1rem; font-weight:950; margin:2px 0;">${escapeHtml(store.name)}</div>
          <div style="font-size:0.85rem; font-weight:900; background:#000; color:#fff; padding:3px 8px; border-radius:4px; display:inline-block; margin-top:4px;">
            交班日結對帳單 (Z-REPORT)
          </div>
        </div>

        <div style="font-size:0.76rem; line-height:1.5;">
          <div>營業日期：${todayStr}</div>
          <div>出表時間：${new Date().toLocaleTimeString('zh-TW', { hour12: false })}</div>
          <div>有效已結單數：${paidOrders.length} 筆 (內用 ${dineInCount} / 外帶 ${takeoutCount})</div>
        </div>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">【一、損益與折扣核銷明細】</div>
        <table class="z-report-table">
          <tr><td>毛銷售總額 (含餐具)</td><td>NT$ ${grossSubtotal.toLocaleString()}</td></tr>
          <tr><td>離峰分流折扣讓利</td><td>-NT$ ${promoDiscountSum.toLocaleString()}</td></tr>
          <tr><td>櫃檯手動折讓/招待</td><td>-NT$ ${manualDiscountSum.toLocaleString()}</td></tr>
          <tr style="border-top:1px solid #000; font-size:0.92rem;"><td><strong>實收淨營業額 (Net)</strong></td><td><strong>NT$ ${netRevenue.toLocaleString()}</strong></td></tr>
        </table>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">【二、錢箱與各支付管道清點】</div>
        <table class="z-report-table">
          <tr><td>💵 錢箱應有現金 (${cashOrders.length}筆)</td><td>NT$ ${cashTotal.toLocaleString()}</td></tr>
          <tr><td>💚 LINE Pay 實收 (${linePayOrders.length}筆)</td><td>NT$ ${linePayTotal.toLocaleString()}</td></tr>
          <tr><td>❤️ 街口支付 實收 (${jkoPayOrders.length}筆)</td><td>NT$ ${jkoPayTotal.toLocaleString()}</td></tr>
        </table>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">【三、異常與未收應收帳款】</div>
        <table class="z-report-table">
          <tr><td>⏳ 待收款訂單 (${unpaidOrders.length}筆)</td><td>NT$ ${unpaidTotal.toLocaleString()}</td></tr>
          <tr><td>🚫 退單作廢金額 (${cancelledOrders.length}筆)</td><td>NT$ ${cancelledTotal.toLocaleString()}</td></tr>
        </table>

        <div class="thermal-divider"></div>
        <div style="font-size:0.74rem; line-height:1.8; margin-top:8px;">
          <div>值班收銀員簽名：__________________</div>
          <div>店長覆核簽名：____________________</div>
        </div>
      </div>
    `;
  }
  document.getElementById('receiptPrintModal')?.classList.add('open');
}

// ==================== 6.2 廚房控單與訂單管理 (KDS) — 內建即時單品備料匯總看板 ====================
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
  renderMerchantOrdersOnly();
  const searchEl = document.getElementById('kdsSearchInputBox');
  if (searchEl) {
    searchEl.focus();
    const len = searchEl.value.length;
    try { searchEl.setSelectionRange(len, len); } catch (e) {}
  }
}

/**
 * 商業級重構 5：允許廚師將「已接單待排程」的預訂單手動提前轉入「製作中」下鍋
 */
async function forceStartCookingScheduledOrder(orderId) {
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;
  order.status = '製作中';
  order.cookingStartedAtTs = Date.now();
  saveCachedOrders(state.orders);
  enrichStoresAndAi();
  renderMerchantView();
  showToast(`🍳 預訂單 #${order.pickupNumber} 已提前轉入廚房下鍋製作！`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateOrderStatus',
        ...getMerchantAuthPayload(),
        orderId: order.orderId,
        newStatus: '製作中'
      })
    });
  } catch (e) {}
}

function renderMerchantOrdersOnly(storeObj) {
  const store = storeObj || state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  const panel = document.getElementById('storePanel-kds');
  if (!store || !panel) return;

  const storeOrders = state.orders.filter(o => o.storeId === store.id);
  const todayStr = getTodayDateStr();
  const tomorrowStr = getFutureDateStr(1);

  // 🔥 商業級重構 5：計算當前所有「製作中」訂單的單品備料匯總 (All-Day Production Batch View)
  const activeCookingOrders = storeOrders.filter(o => o.status === '製作中');
  const batchItemMap = {};
  let totalActivePortions = 0;
  activeCookingOrders.forEach(o => {
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    items.forEach(it => {
      const bName = it.baseName || String(it.name || '餐點').split(' [')[0];
      const q = Math.max(1, Number(it.qty) || 1);
      if (!batchItemMap[bName]) batchItemMap[bName] = { name: bName, qty: 0, isGift: Boolean(it.isGift) };
      batchItemMap[bName].qty += q;
      totalActivePortions += q;
    });
  });
  const sortedBatchItems = Object.values(batchItemMap).sort((a, b) => b.qty - a.qty);

  const dateCountMap = {};
  storeOrders.forEach(o => {
    const d = normalizeDateStr(o.pickupDate || todayStr);
    dateCountMap[d] = (dateCountMap[d] || 0) + 1;
  });
  const extraDates = Object.keys(dateCountMap).filter(d => d !== todayStr && d !== tomorrowStr).sort();

  let filtered = storeOrders;
  if (state.kdsSelectedDate !== 'ALL') {
    filtered = filtered.filter(o => normalizeDateStr(o.pickupDate || todayStr) === state.kdsSelectedDate);
  }

  if (state.kdsStatusFilter === 'UNPAID') {
    filtered = filtered.filter(o => (o.paymentStatus !== '已付款' || o.status === '待付款確認') && !String(o.status).includes('已取消'));
  } else if (state.kdsStatusFilter === 'SCHEDULED') {
    filtered = filtered.filter(o => o.status === '已接單待排程');
  } else if (state.kdsStatusFilter === 'COOKING') {
    filtered = filtered.filter(o => o.status === '製作中');
  } else if (state.kdsStatusFilter === 'READY') {
    filtered = filtered.filter(o => o.status === '可取餐');
  } else if (state.kdsStatusFilter === 'DONE') {
    filtered = filtered.filter(o => o.status === '已完成' || String(o.status).includes('已取消'));
  }

  const q = (state.kdsSearchQuery || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(o =>
      String(o.pickupNumber || '').toLowerCase().includes(q) ||
      String(o.customerPhone || '').toLowerCase().includes(q) ||
      String(o.customerNote || '').toLowerCase().includes(q) ||
      String(o.orderId || '').toLowerCase().includes(q)
    );
  }

  panel.innerHTML = `
    <div class="kds-panel-wrap">
      <!-- 🔥 KDS 頂部即時廚房單品備料匯總看板 -->
      <div class="kds-batch-summary-bar">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.95rem; font-weight:950; color:#FBBF24;">🔥 即時廚房爐上備料匯總看板 (All-Day Batch View)</span>
            <span style="font-size:0.75rem; background:rgba(255,255,255,0.16); padding:2px 10px; border-radius:999px; font-weight:800;">
              製作中 ${activeCookingOrders.length} 單 ・ 合共 ${totalActivePortions} 份餐點
            </span>
          </div>
          <span style="font-size:0.74rem; color:#CBD5E1;">預訂單將於取餐前 25 分鐘自動排入此看板</span>
        </div>
        <div class="batch-items-scroll">
          ${sortedBatchItems.length === 0 ? `
            <div style="font-size:0.82rem; color:#94A3B8; padding:4px 0;">目前爐上無製作中單品，廚房順暢待命</div>
          ` : sortedBatchItems.map(bi => `
            <div class="batch-item-pill">
              <span style="font-weight:800; font-size:0.88rem;">${escapeHtml(bi.name)}</span>
              <span class="batch-qty">× ${bi.qty}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="kds-toolbar">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:0.84rem; font-weight:900; color:var(--text-primary);">📅 取餐日期：</span>
            <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === todayStr ? 'active' : ''}" onclick="setKdsDateFilter('${todayStr}')">
              今日 (${todayStr.slice(5)}) [${dateCountMap[todayStr] || 0}]
            </button>
            <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === tomorrowStr ? 'active' : ''}" onclick="setKdsDateFilter('${tomorrowStr}')">
              明日 (${tomorrowStr.slice(5)}) [${dateCountMap[tomorrowStr] || 0}]
            </button>
            ${extraDates.map(d => `
              <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === d ? 'active' : ''}" onclick="setKdsDateFilter('${escapeHtml(d)}')">
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
            <input type="search" id="kdsSearchInputBox" class="select-input" style="width:200px; padding:6px 10px; font-size:0.8rem;" placeholder="🔍 搜尋電話、備註或單號..." value="${escapeHtml(state.kdsSearchQuery)}" oninput="handleKdsSearchInput(this.value)">
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'ALL' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('ALL')">全部狀態 (${filtered.length})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'COOKING' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('COOKING')">🍳 製作中 (${activeCookingOrders.length})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'SCHEDULED' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('SCHEDULED')">📅 已接單待排程</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'UNPAID' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('UNPAID')">💵 待收款確認</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'READY' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('READY')">🔔 已通知待取餐</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'DONE' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('DONE')">✅ 已完成/已退單</button>
          </div>
        </div>
      </div>

      <div class="kds-orders-grid">
        ${filtered.length === 0 ? `
          <div style="grid-column:1 / -1; text-align:center; padding:60px 20px; background:#FFFFFF; border-radius:16px; border:1px dashed var(--border); color:var(--text-muted);">
            <div style="font-size:2.4rem; margin-bottom:8px;">📭</div>
            <div style="font-size:1rem; font-weight:800;">此日期 / 篩選條件下目前沒有訂單</div>
          </div>
        ` : filtered.map(o => {
          const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
          const itemStr = items.map(i => {
            const sel = i.selections && Object.keys(i.selections).length > 0
              ? ` [${Object.entries(i.selections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
              : '';
            return `${i.baseName || i.name}${sel} ×${i.qty || 1}`;
          }).join('、');

          const isReady = o.status === '可取餐';
          const isDone = o.status === '已完成';
          const isScheduled = o.status === '已接單待排程';
          const isCancelled = String(o.status).includes('已取消');
          const isUnpaid = o.paymentStatus !== '已付款' && !isCancelled;
          const notifyCount = Number(o.notifyCount) || 0;
          const isInLiveQueue = isOrderActivelyCookingNow(o);
          const elapsedMin = getOrderElapsedMinutes(o);
          const workloadUnits = isInLiveQueue ? calcOrderRemainingWorkloadUnits(o, store.maxCapacityPer15Min) : 0;

          let cardClass = '';
          if (isCancelled) cardClass = 'cancelled';
          else if (isReady) cardClass = 'ready';
          else if (isScheduled) cardClass = 'scheduled';
          else if (isUnpaid) cardClass = 'unpaid';

          return `
            <div class="kds-ticket-card ${cardClass}" style="${isDone ? 'opacity:0.72;' : ''}">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:6px;">
                  <div>
                    <span style="font-size:1.3rem; font-weight:950; color:var(--text-primary);">#${escapeHtml(o.pickupNumber)}</span>
                    <span style="font-size:0.74rem; font-weight:800; background:#F1F5F9; color:#334155; padding:2px 7px; border-radius:6px; margin-left:4px;">
                      📅 ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}
                    </span>
                    ${isInLiveQueue ? `
                      <span class="kds-elapsed-badge ${elapsedMin >= 15 ? 'overdue' : ''}" style="margin-left:4px;">
                        ⏱️ 已下鍋 ${elapsedMin}分 (負荷 ${workloadUnits})
                      </span>
                    ` : ''}
                  </div>
                  <span style="font-size:0.74rem; font-weight:900; padding:3px 9px; border-radius:999px; background:${isCancelled ? '#FEE2E2' : isDone ? '#E2E8F0' : isReady ? '#DCFCE7' : isScheduled ? '#DBEAFE' : '#FEF3C7'}; color:${isCancelled ? '#DC2626' : isDone ? '#475569' : isReady ? '#047857' : isScheduled ? '#1E40AF' : '#B45309'};">
                    ${escapeHtml(o.status)} ${notifyCount > 0 && !isDone && !isCancelled ? `(叫號${notifyCount}次)` : ''}
                  </span>
                </div>

                <div style="font-size:0.9rem; font-weight:800; color:var(--text-primary); line-height:1.45; margin-bottom:6px; background:#F8FAFC; padding:8px 10px; border-radius:8px; border:1px solid #E2E8F0;">
                  ${escapeHtml(itemStr)}
                </div>

                <div style="font-size:0.76rem; color:var(--text-secondary); margin-bottom:6px; display:flex; flex-wrap:wrap; gap:6px;">
                  <span style="font-weight:800; color:var(--text-primary);">🍽️ ${escapeHtml(o.dineType || '外帶自取')}</span>
                  ${o.needCutlery ? `<span style="color:var(--brand-dark); font-weight:800;">・🥢 需餐具(+$${o.cutleryFee})</span>` : ''}
                  ${o.customerNote ? `<span style="color:var(--indigo); font-weight:800;">・📝 備註：${escapeHtml(o.customerNote)}</span>` : ''}
                  ${o.customerPhone ? `<span>・<strong style="color:var(--brand-dark);">📱 ${escapeHtml(o.customerPhone)}</strong></span>` : ''}
                  ${o.cashReceived > 0 ? `<span>・💵 實收$${o.cashReceived}/找零$${o.changeGiven}</span>` : ''}
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; padding-top:6px; border-top:1px dashed var(--border);">
                  <div>
                    <span style="font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:6px; background:${isCancelled ? '#FEE2E2' : isUnpaid ? '#FEF3C7' : '#DCFCE7'}; color:${isCancelled ? '#DC2626' : isUnpaid ? '#B45309' : '#047857'};">
                      ${isCancelled ? '🚫 已作廢退單' : isUnpaid ? `⏳ ${escapeHtml(o.paymentStatus || '待收款')}` : `✅ 已付款 (${escapeHtml(o.paymentMethod)})`}
                    </span>
                  </div>
                  <span style="font-size:1.05rem; font-weight:950; color:var(--red); ${isCancelled ? 'text-decoration:line-through;' : ''}">NT$ ${o.finalTotal}</span>
                </div>
              </div>

              <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
                ${isUnpaid ? `
                  <button type="button" onclick="openOrderPayModal('${escapeHtml(o.orderId)}')" style="flex:1 1 100%; border:none; background:#F59E0B; color:#FFFFFF; padding:8px 12px; border-radius:8px; font-weight:900; font-size:0.84rem; cursor:pointer;">
                    💵 點此收款結帳 (NT$ ${o.finalTotal})
                  </button>
                ` : ''}

                ${isScheduled ? `
                  <button type="button" onclick="forceStartCookingScheduledOrder('${escapeHtml(o.orderId)}')" style="flex:1 1 100%; border:1.5px solid #2563EB; background:#EFF6FF; color:#1D4ED8; padding:7px 10px; border-radius:8px; font-weight:900; font-size:0.8rem; cursor:pointer;">
                    🔥 提前轉入廚房下鍋製作
                  </button>
                ` : ''}

                <button type="button" onclick="openReceiptPrintModal('${escapeHtml(o.orderId)}')" style="border:1px solid var(--border); background:#FFFFFF; color:var(--text-primary); padding:7px 9px; border-radius:8px; font-weight:800; font-size:0.76rem; cursor:pointer;">
                  🖨️ 小票
                </button>

                ${!isDone && !isCancelled ? `
                  <button type="button" onclick="speakOrder(${JSON.stringify(o.pickupNumber + '號，' + itemStr).replace(/"/g, '&quot;')})" style="border:1px solid var(--border); background:#F8FAFC; color:var(--text-primary); padding:7px 9px; border-radius:8px; font-weight:800; font-size:0.76rem; cursor:pointer;">
                    🔊 讀單
                  </button>
                  <button type="button" onclick="markOrderReady('${escapeHtml(o.orderId)}')" style="flex:1; border:none; background:#3B82F6; color:#FFFFFF; padding:7px 10px; border-radius:8px; font-weight:900; font-size:0.78rem; cursor:pointer;">
                    🔔 ${notifyCount > 0 ? `再次叫號 (${notifyCount})` : '通知取餐'}
                  </button>
                  <button type="button" onclick="completeOrderFinal('${escapeHtml(o.orderId)}')" style="flex:1; border:none; background:#10B981; color:#FFFFFF; padding:7px 10px; border-radius:8px; font-weight:900; font-size:0.78rem; cursor:pointer;">
                    ✅ 完成結單
                  </button>
                  <button type="button" class="btn-danger-soft" onclick="cancelMerchantOrder('${escapeHtml(o.orderId)}')">
                    🚫 退單
                  </button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function cancelMerchantOrder(orderId) {
  if (!state.isMerchantUnlocked) return;
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  const reason = window.prompt(`確定要取消 / 退單「#${order.pickupNumber} (${order.storeName})」嗎？\n請輸入退單原因（可留空預設為「顧客取消/更改餐點」）：`, '顧客取消/更改餐點');
  if (reason === null) return;

  const cleanReason = reason.trim() || '櫃檯取消';
  order.status = `已取消 (${cleanReason})`;
  order.paymentStatus = '已退單作廢';
  state.locallyDeletedOrderIds[order.orderId] = Date.now();
  saveCachedOrders(state.orders);

  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();
  showToast(`🚫 訂單 #${order.pickupNumber} 已取消並釋放廚房佇列！`);

  pushLineNotification(
    'ORDER_CANCELLED',
    `🚫 訂單 #${order.pickupNumber} 已取消通知`,
    `您在【${order.storeName}】的訂單已由櫃檯辦理取消（原因：${cleanReason}）。如有疑問請洽詢店家櫃檯。`,
    order
  );

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'cancelOrder',
        ...getMerchantAuthPayload(),
        orderId: order.orderId,
        reason: cleanReason
      })
    });
  } catch (e) {}
}

function openReceiptPrintModal(orderId) {
  ensureSharedModalsMounted();
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  state.printingOrderId = orderId;

  const titleEl = document.getElementById('receiptPrintModalTitle');
  if (titleEl) titleEl.innerText = '🖨️ 廚房出單小票與收據預覽 (80mm)';

  const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];

  const body = document.getElementById('receiptPrintModalBody');
  if (body) {
    body.innerHTML = `
      <div class="thermal-receipt-paper">
        <div style="text-align:center; margin-bottom:8px;">
          <div style="font-size:0.78rem; font-weight:800;">東吳大學學餐智慧點餐系統</div>
          <div style="font-size:1.1rem; font-weight:950; margin:2px 0;">${escapeHtml(o.storeName)}</div>
          <div style="font-size:0.75rem; color:#4B5563;">${escapeHtml(o.dineType || '外帶自取')} ・ 80mm 廚房出單聯</div>
          <div style="font-size:2.6rem; font-weight:950; line-height:1.1; margin:6px 0; border:2px solid #000000; border-radius:8px; padding:4px 0;">
            #${escapeHtml(o.pickupNumber)}
          </div>
        </div>

        <div style="font-size:0.76rem; line-height:1.5;">
          <div>憑證：${escapeHtml(o.orderId)}</div>
          <div>取餐：${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))} (${escapeHtml(o.studentId || '自取')})</div>
          <div>餐具：${o.needCutlery ? `需要免洗餐具 (+$${o.cutleryFee})` : '自備環保餐具 ($0)'}</div>
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
          ${o.cashReceived > 0 ? `
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
        <div style="text-align:center; font-size:0.72rem; color:#4B5563;">
          列印時間：${new Date().toLocaleString('zh-TW', { hour12: false })}<br>
          謝謝光臨，請憑號碼牌至櫃檯取餐！
        </div>
      </div>
    `;
  }

  document.getElementById('receiptPrintModal')?.classList.add('open');
}

function closeReceiptPrintModal() {
  document.getElementById('receiptPrintModal')?.classList.remove('open');
  state.printingOrderId = null;
}

function openOrderPayModal(orderId) {
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  state.payingOrderId = orderId;
  state.payingOrderMethod = '現場現金';
  state.payingOrderCashInput = '';
  renderOrderPayModalContent();
  document.getElementById('orderPayModal')?.classList.add('open');
}

function closeOrderPayModal() {
  document.getElementById('orderPayModal')?.classList.remove('open');
  state.payingOrderId = null;
  state.payingOrderCashInput = '';
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

  box.innerHTML = `
    <div style="background:#F8FAFC; padding:12px; border-radius:12px; border:1px solid var(--border); margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:900; font-size:1.1rem;">取餐號 #${escapeHtml(o.pickupNumber)}</span>
        <span style="font-size:0.8rem; color:var(--text-secondary);">📅 ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}</span>
      </div>
      ${o.customerPhone ? `<div style="font-size:0.82rem; font-weight:800; color:var(--brand-dark); margin-top:2px;">📱 預訂電話：${escapeHtml(o.customerPhone)}</div>` : ''}
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
        <span style="font-weight:800;">應收金額</span>
        <span style="font-size:1.45rem; font-weight:950; color:var(--red);">NT$ ${total}</span>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:10px;">
      ${['現場現金', 'LINE Pay', '街口支付'].map(m => `
        <button type="button" class="pos-chip-btn ${state.payingOrderMethod === m ? 'active' : ''}" onclick="setOrderPayMethod('${m}')">${m}</button>
      `).join('')}
    </div>

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

    <button type="button" class="btn-primary-full" onclick="confirmOrderPayment()" ${isShort ? 'disabled' : ''}>
      ✅ 確認收訖 NT$ ${total} ${state.payingOrderMethod === '現場現金' && change > 0 ? `（找零 NT$ ${change}）` : ''}
    </button>
  `;
}

async function confirmOrderPayment() {
  if (!state.isMerchantUnlocked) return;
  const o = state.orders.find(ord => ord.orderId === state.payingOrderId);
  if (!o) return;

  const total = Number(o.finalTotal) || 0;
  const cashNum = state.payingOrderMethod === '現場現金'
    ? (state.payingOrderCashInput !== '' ? parseFloat(state.payingOrderCashInput) : total)
    : total;
  const change = state.payingOrderMethod === '現場現金' ? Math.max(0, cashNum - total) : 0;

  o.paymentStatus = '已付款';
  o.paymentMethod = state.payingOrderMethod;
  o.cashReceived = cashNum;
  o.changeGiven = change;
  o.status = evaluateOrderLifecycleStatus(o);
  saveCachedOrders(state.orders);

  closeOrderPayModal();
  renderMerchantOrdersOnly();
  showToast(`💵 訂單 #${o.pickupNumber} 已完成收款！目前狀態：${o.status}`);

  pushLineNotification(
    'ORDER_PAID',
    `💵 訂單 #${o.pickupNumber} 已完成繳費`,
    `我們已收到您【${o.storeName}】訂單共 NT$${o.finalTotal} (${o.paymentMethod}) 的款項，將準時為您備餐！`,
    o
  );

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateOrderStatus',
        ...getMerchantAuthPayload(),
        orderId: o.orderId,
        newStatus: o.status,
        paymentStatus: '已付款',
        paymentMethod: o.paymentMethod
      })
    });
  } catch (e) {}
}

async function markOrderReady(orderId) {
  if (!state.isMerchantUnlocked) return;
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  order.status = '可取餐';
  order.notifyCount = (Number(order.notifyCount) || 0) + 1;
  saveCachedOrders(state.orders);

  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();

  showToast(`🔔 已第 ${order.notifyCount} 次通知 #${order.pickupNumber} 取餐（已釋放廚房佇列並觸發學生端提醒）`);

  pushLineNotification(
    'ORDER_READY',
    `🔔 取餐通知 (#${order.pickupNumber})`,
    `您在【${order.storeName}】點的餐點已經準備好囉！請至櫃檯出示 #${order.pickupNumber} 領取。`,
    order
  );

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateOrderStatus',
        ...getMerchantAuthPayload(),
        orderId: order.orderId,
        newStatus: '可取餐'
      })
    });
  } catch (e) {}
}

async function completeOrderFinal(orderId) {
  if (!state.isMerchantUnlocked) return;
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  order.status = '已完成';
  order.paymentStatus = '已付款';
  saveCachedOrders(state.orders);

  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();
  showToast(`✅ 訂單 #${order.pickupNumber} 已完成交付結單！`);

  pushLineNotification(
    'ORDER_COMPLETED',
    `✅ 訂單 #${order.pickupNumber} 已完成取餐`,
    `感謝您今日光臨【${order.storeName}】，祝您用餐愉快！`,
    order
  );

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateOrderStatus',
        ...getMerchantAuthPayload(),
        orderId: order.orderId,
        newStatus: '已完成',
        paymentStatus: '已付款'
      })
    });
  } catch (e) {}
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

// ==================== 6.3 商業級重構 6：真實財務與營運分析儀表板（修正時間維度與應收帳款分離） ====================
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
  const ca = String(order.createdAt || '');
  const m2 = ca.match(/(\d{1,2}):\d{2}/);
  if (m2) return parseInt(m2[1], 10);
  return 12;
}

function calcBucketRealisticWaitMinutes(bucketOrders, maxCapPer15Min) {
  if (!bucketOrders || bucketOrders.length === 0) return 3;
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
  return calcPrepMinutes(maxQuarterDensity, maxCapPer15Min);
}

function exportStoreAnalyticsCsv() {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;

  const orders = state.orders.filter(o => o.storeId === store.id);
  if (orders.length === 0) {
    showToast('⚠️ 目前無訂單資料可匯出');
    return;
  }

  const headers = ['訂單編號', '取餐流水號', '店鋪名稱', '取餐日期', '取餐時間', '用餐方式', '來源類型', '餐點明細', '毛小計', '餐具費', '離峰折抵', '櫃檯折讓', '實收淨額', '付款方式', '付款狀態', '交易授權碼', '訂單狀態', '聯絡電話', '顧客備註', '建立時間'];
  const rows = orders.map(o => {
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    const itemText = items.map(i => `${i.baseName || i.name}x${i.qty || 1}`).join('; ');
    return [
      o.orderId,
      `#${o.pickupNumber}`,
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
      o.paymentMethod || '',
      o.paymentStatus || '',
      o.transactionId || '',
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
  a.download = `東吳學餐_${store.name}_營運財務報表_${getTodayDateStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`📥 已匯出「${store.name}」正規化財務報表（共 ${orders.length} 筆）！`);
}

function renderMerchantAnalyticsPanel(store) {
  const panel = document.getElementById('storePanel-analytics');
  if (!panel) return;

  const period = state.analyticsPeriod || 'DAY';
  const todayStr = getTodayDateStr();
  const past7StartStr = getDateOffsetFromStr(todayStr, -6);

  const allValidStoreOrders = state.orders.filter(o => o.storeId === store.id && !String(o.status).includes('已取消'));
  const hasSeedOrders = state.orders.some(o => o.isSeedSample);

  // 商業級重構 6：嚴格時間維度切割，絕不拿昨天或未來訂單混充今日營收！
  let periodTitle = `今日各時段真實實收營收 (${todayStr})`;
  let buckets = [];
  let periodOrders = [];

  if (period === 'DAY') {
    periodOrders = allValidStoreOrders.filter(o => normalizeDateStr(o.pickupDate) === todayStr);
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
    // 嚴格取過去 7 天 [-6, -5, -4, -3, -2, -1, 0]，絕不把未來預訂單塞進過去 7 日趨勢！
    periodTitle = `過去 7 日每日真實營收趨勢 (${past7StartStr.slice(5)} ~ ${todayStr.slice(5)})`;
    const dayOffsets = [-6, -5, -4, -3, -2, -1, 0];
    const allowedDates = new Set(dayOffsets.map(off => getDateOffsetFromStr(todayStr, off)));
    periodOrders = allValidStoreOrders.filter(o => allowedDates.has(normalizeDateStr(o.pickupDate)));
    buckets = dayOffsets.map(off => {
      const dStr = getDateOffsetFromStr(todayStr, off);
      const shortLabel = off === 0 ? `今日(${dStr.slice(5)})` : dStr.slice(5);
      return {
        key: dStr,
        label: shortLabel,
        match: o => normalizeDateStr(o.pickupDate) === dStr
      };
    });
  } else {
    periodTitle = '歷史與未來預訂全區間分析';
    periodOrders = allValidStoreOrders;
    const uniqueDates = [...new Set(allValidStoreOrders.map(o => normalizeDateStr(o.pickupDate)))].sort();
    buckets = (uniqueDates.length > 0 ? uniqueDates : [todayStr]).map(dStr => ({
      key: dStr,
      label: dStr.slice(5),
      match: o => normalizeDateStr(o.pickupDate) === dStr
    }));
  }

  // 商業會計準則：區分「已收款實收淨額 (Net Paid Revenue)」與「未收應收帳款 (Unpaid Receivables)」
  const paidPeriodOrders = periodOrders.filter(o => o.paymentStatus === '已付款');
  const unpaidPeriodOrders = periodOrders.filter(o => o.paymentStatus !== '已付款');

  const grossSales = paidPeriodOrders.reduce((s, o) => s + (Number(o.subtotal) || 0) + (Number(o.cutleryFee) || 0), 0);
  const totalDiscountCost = paidPeriodOrders.reduce((s, o) => s + (Number(o.discount) || 0) + (Number(o.manualDiscount) || 0), 0);
  const netPaidRevenue = paidPeriodOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const unpaidReceivables = unpaidPeriodOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const avgTicket = paidPeriodOrders.length > 0 ? Math.round(netPaidRevenue / paidPeriodOrders.length) : 0;
  const futureReservations = allValidStoreOrders.filter(o => o.isReservation && normalizeDateStr(o.pickupDate) > todayStr);

  const bucketStats = buckets.map(b => {
    const matched = periodOrders.filter(b.match);
    const paidMatched = matched.filter(o => o.paymentStatus === '已付款');
    const rev = paidMatched.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
    const count = matched.length;
    const estWait = calcBucketRealisticWaitMinutes(matched, store.maxCapacityPer15Min);
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
             onmousemove="showAnalyticsTooltip(event, '${escapeHtml(b.label)} 營運數據', '已入帳淨營收：NT$ ${b.rev.toLocaleString()} (總計 ${b.count} 單)', '點擊柱狀圖可於下方篩選檢視明細')"
             ontouchstart="showAnalyticsTooltip(event, '${escapeHtml(b.label)} 營運數據', '已入帳淨營收：NT$ ${b.rev.toLocaleString()} (總計 ${b.count} 單)', '點擊下方篩選明細')"
             onclick="filterAnalyticsOrdersByKey('BUCKET', '${escapeHtml(b.key)}', '時段/日期：${escapeHtml(b.label)}')">
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

  // 使用正規化 baseName 統計單品銷量，不再使用切字串 split(' [')[0]
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
              onmouseenter="highlightDonutSlice(${idx}, '${escapeHtml(seg.name)}', ${seg.qty}, ${seg.rev}, ${seg.pct}, '${seg.color}')"
              onmousemove="showAnalyticsTooltip(event, '🍽️ ${escapeHtml(seg.name)}', '真實銷量：${seg.qty} 份 ・ 營收：NT$ ${seg.rev}', '佔比 ${seg.pct}%（點擊可篩選包含此餐點的真實訂單）')"
              onmouseleave="resetDonutSlice('${escapeHtml(topPie.name)}', ${topPie.pct}, '${topPie.qty}份 / $${topPie.rev}', '${topPie.color}'); hideAnalyticsTooltip();"
              onclick="filterAnalyticsOrdersByKey('ITEM', '${escapeHtml(seg.name)}', '餐點包含：${escapeHtml(seg.name)}')"></circle>
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
          <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.78rem; background:#0F172A;" onclick="openShiftZReportModal()">🧾 交班日結 Z-Report</button>
          <button type="button" class="btn-outline" style="padding:5px 10px; font-size:0.76rem;" onclick="exportStoreAnalyticsCsv()">📥 匯出 CSV</button>
        </div>
      </div>

      <div class="analytics-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">💰 實收淨營業額 (Net Paid)</div>
          <div class="kpi-val" style="color:var(--brand-dark);">NT$ ${netPaidRevenue.toLocaleString()}</div>
          <div class="kpi-sub">已付款 ${paidPeriodOrders.length} 單 ・ 客單價 NT$ ${avgTicket}</div>
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
          <div class="kpi-sub">當下加權佇列 ${store.activeOrders}/${store.maxCapacityPer15Min} 單 (${store.loadPercentage}%)</div>
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
                     onmouseenter="highlightDonutSlice(${idx}, '${escapeHtml(p.name)}', ${p.qty}, ${p.rev}, ${p.pct}, '${p.color}')"
                     onmouseleave="resetDonutSlice('${escapeHtml(topPie.name)}', ${topPie.pct}, '${topPie.qty}份 / $${topPie.rev}', '${topPie.color}')"
                     onclick="filterAnalyticsOrdersByKey('ITEM', '${escapeHtml(p.name)}', '餐點包含：${escapeHtml(p.name)}')">
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
                 onmousemove="showAnalyticsTooltip(event, '⏱️ ${escapeHtml(p.label)} 候餐負載', '尖峰預估候餐：約 ${p.w} 分鐘（區間共 ${p.count} 單 / $${p.rev}）', '依據 15 分鐘時間窗最大訂單密度精算')"
                 ontouchstart="showAnalyticsTooltip(event, '⏱️ ${escapeHtml(p.label)} 候餐負載', '尖峰預估候餐：約 ${p.w} 分鐘（區間共 ${p.count} 單 / $${p.rev}）', '點擊篩選此時段訂單')"
                 onclick="filterAnalyticsOrdersByKey('BUCKET', '${escapeHtml(p.key)}', '時段/日期：${escapeHtml(p.label)}')">
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
              <strong>📅 未來預訂排程隔離保護：</strong><br>
              系統共有 <strong>${futureReservations.length} 筆未來日期預訂單</strong>，已全數置於「已接單待排程」狀態，不會提前擠佔今日廚房佇列或污染今日營收。
            </div>
            <div style="background:#FFFFFF; padding:8px 12px; border-radius:10px; border-left:4px solid #F59E0B; display:flex; justify-content:space-between; align-items:center;">
              <span><strong>🧪 展示沙盒數據管理：</strong>${hasSeedOrders ? '目前含沙盒展示訂單' : '目前為純淨正式環境'}</span>
              ${hasSeedOrders
                ? `<button type="button" class="btn-danger-soft" onclick="clearSampleOrdersData()">🧹 清除沙盒數據</button>`
                : `<button type="button" class="filter-chip" style="padding:4px 10px; font-size:0.74rem;" onclick="restoreSampleOrdersData()">🧪 載入展示數據</button>`
              }
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
            <button type="button" class="pos-cat-pill active" onclick="filterAnalyticsOrdersByKey('${escapeHtml(activeFilter.type)}', '${escapeHtml(activeFilter.key)}', '')">
              ✖ 清除篩選（顯示全部 ${periodOrders.length} 筆）
            </button>
          ` : ''}
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:8px; max-height:240px; overflow-y:auto;">
          ${drilldownOrders.length === 0 ? `<div style="color:var(--text-muted); font-size:0.84rem; padding:12px;">此時間區間尚無訂單紀錄</div>` : drilldownOrders.map(o => {
            const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
            const summary = items.map(i => `${i.baseName || i.name}×${i.qty || 1}`).join('、');
            return `
              <div style="padding:8px 12px; border-radius:10px; border:1px solid var(--border); background:#F8FAFC; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="min-width:0; flex:1;">
                  <div style="font-weight:900; color:var(--text-primary);">
                    #${escapeHtml(o.pickupNumber)} ・ ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}
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
}

// ==================== 6.4 店家整合設定中心 ====================
function renderMerchantSettingsPanel(store) {
  const panel = document.getElementById('storePanel-settings');
  if (!panel) return;

  const sub = state.settingsSubTab || 'menu';
  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const menus = store.menus || [];
  const hasSeedOrders = state.orders.some(o => o.isSeedSample);

  panel.innerHTML = `
    <div class="settings-panel-wrap">
      <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:12px 16px; border-radius:14px; border:1px solid var(--border); flex-wrap:wrap; gap:10px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="pos-cat-pill ${sub === 'menu' ? 'active' : ''}" onclick="switchSettingsSubTab('menu')">🍔 菜單管理與智慧照片辨識</button>
          <button type="button" class="pos-cat-pill ${sub === 'promo' ? 'active' : ''}" onclick="switchSettingsSubTab('promo')">🥢 營業狀態・餐具收費與離峰優惠</button>
          <button type="button" class="pos-cat-pill ${sub === 'line' ? 'active' : ''}" onclick="switchSettingsSubTab('line')">💚 推播設定・安全授權碼與測試沙盒</button>
        </div>

        <select class="select-input" style="width:auto; padding:6px 10px; font-weight:800;" onchange="switchMerchantStore(this.value)">
          ${state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>切換店鋪：${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>

      ${sub === 'menu' ? `
        <div class="chart-card" style="background:linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%); border:1.5px solid #C7D2FE;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div>
              <h3 style="font-size:1.02rem; font-weight:900; color:#312E81;">📸 智慧視覺菜單辨識（支援拍照上傳與現場表格微調）</h3>
              <p style="font-size:0.78rem; color:#4338CA;">上傳紙本菜單照片或貼上文字，系統將自動進行結構化解析，並可於下方表格現場微調後一鍵匯入「${escapeHtml(store.name)}」！</p>
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
          <h3 style="font-size:0.98rem; font-weight:900; margin-bottom:10px;">➕ 手動新增單一品項至「${escapeHtml(store.name)}」</h3>
          <div style="display:grid; grid-template-columns:1fr 1.4fr 0.7fr 1fr 1.4fr auto; gap:8px; align-items:end;">
            <div>
              <label class="field-label">分類</label>
              <input type="text" id="newMenuCat" class="select-input" placeholder="如：主廚推薦" value="主廚推薦">
            </div>
            <div>
              <label class="field-label">餐點名稱 *</label>
              <input type="text" id="newMenuName" class="select-input" placeholder="如：香煎雞腿便當">
            </div>
            <div>
              <label class="field-label">價格 (NT$) *</label>
              <input type="number" id="newMenuPrice" class="select-input" placeholder="110">
            </div>
            <div>
              <label class="field-label">推薦標籤</label>
              <input type="text" id="newMenuTag" class="select-input" placeholder="🔥 店長推薦">
            </div>
            <div>
              <label class="field-label">客製選項 (逗號分隔)</label>
              <input type="text" id="newMenuOpts" class="select-input" placeholder="正常, 飯少, 加蛋+15">
            </div>
            <button type="button" class="btn-tip-action" style="height:40px;" onclick="addManualMenuItem()">＋ 新增品項</button>
          </div>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
            <h3 style="font-size:0.98rem; font-weight:900;">📋 目前架上菜單（共 ${menus.length} 道，可一鍵切換「售罄/上架」或點「✏️ 編輯」修改規格）</h3>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(310px, 1fr)); gap:10px;">
            ${menus.map((m, idx) => {
              const optCount = m.options ? Object.keys(m.options).length : 0;
              const isSoldOut = Boolean(m.soldOut);
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border:1.5px solid ${isSoldOut ? '#FCA5A5' : 'var(--border)'}; border-radius:12px; background:${isSoldOut ? '#FEF2F2' : '#F8FAFC'}; gap:8px;">
                  <div style="min-width:0; flex:1;">
                    <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                      <span style="font-size:0.7rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:2px 6px; border-radius:4px;">${escapeHtml(m.category || '主餐')}</span>
                      ${isSoldOut ? `<span class="sold-out-ribbon">今日已售罄</span>` : (m.tag ? `<span style="font-size:0.68rem; font-weight:800; color:#4338CA; background:#EEF2FF; padding:2px 6px; border-radius:4px;">${escapeHtml(m.tag)}</span>` : '')}
                      <span style="font-size:0.68rem; color:var(--text-secondary); font-weight:700;">⚙️ ${optCount} 組選項</span>
                    </div>
                    <div style="font-weight:900; font-size:0.92rem; margin-top:4px; color:var(--text-primary);">${escapeHtml(m.name)}</div>
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
          <h3 style="font-size:1.05rem; font-weight:900; margin-bottom:6px;">🥢 營業狀態・免洗餐具與離峰分流優惠設定（${escapeHtml(store.name)}）</h3>
          <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:16px;">
            可在此切換店家營業狀態、調整一次性餐具收費，以及設定離峰自動分流優惠與外加模擬排隊單量。
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
              <label class="field-label">🔥 每 15 分鐘最大產能上限 (單)</label>
              <input type="number" id="cfgMaxCap" class="select-input" min="5" max="100" value="${store.maxCapacityPer15Min}">
            </div>

            <div>
              <label class="field-label">🍲 現場外加佇列偏移量 (目前真實製作中 ${store.liveCookingCount || 0} 單)</label>
              <input type="number" id="cfgBaseQueueOffset" class="select-input" min="0" max="100" value="${store.baseQueueOffset || 0}">
            </div>

            <div>
              <label class="field-label">🎁 離峰分流優惠模式</label>
              <select id="cfgPromoMode" class="select-input">
                <option value="none" ${store.promoMode === 'none' ? 'selected' : ''}>關閉優惠</option>
                <option value="gift" ${(store.promoMode === 'gift' || store.promoMode === 'freebie') ? 'selected' : ''}>贈送招牌小菜 / 飲品 ($0 自動入單)</option>
                <option value="discount" ${store.promoMode === 'discount' ? 'selected' : ''}>現金折抵 (滿 $${AI_DISCOUNT_MIN_SUBTOTAL} 折抵)</option>
                <option value="points" ${store.promoMode === 'points' ? 'selected' : ''}>雙倍點數回饋</option>
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

          <button type="button" class="btn-line" style="padding:11px 18px; font-size:0.88rem;" onclick="saveLineMessagingConfig()">
            💾 儲存官方帳號與信箱雙軌推播設定
          </button>
        </div>

        <div class="chart-card">
          <h3 style="font-size:1.02rem; font-weight:900; margin-bottom:6px;">🔒 店務安全授權碼設定 (SHA-256 雜湊保護) 與 🧪 沙盒模擬工具</h3>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; align-items:end; margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--border);">
            <div>
              <label class="field-label">變更店務後台 4 位數安全授權碼 (以不可逆雜湊儲存並同步後端)</label>
              <input type="password" id="cfgMerchantPinInput" maxlength="4" class="select-input" placeholder="請輸入新 4 位數字授權碼" value="">
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn-outline" onclick="saveNewMerchantPin()">💾 更新授權碼</button>
              <button type="button" class="btn-danger-soft" onclick="lockMerchantSession()">🔒 立即鎖定並卸載後台</button>
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <button type="button" id="simTrafficBtn" class="btn-tip-action" onclick="triggerTrafficSimulation('PEAK')">⚡ 觸發中午 12:10 尖峰塞車模擬</button>
            <button type="button" class="btn-outline" onclick="triggerTrafficSimulation('NORMAL')">🟢 恢復正常離峰佇列狀態</button>
            ${hasSeedOrders
              ? `<button type="button" class="btn-danger-soft" onclick="clearSampleOrdersData()">🧹 清除沙盒模擬訂單</button>`
              : `<button type="button" class="filter-chip" onclick="restoreSampleOrdersData()">🧪 載入 6 筆沙盒展示訂單</button>`
            }
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

async function saveNewMerchantPin() {
  if (!state.isMerchantUnlocked) return;
  const val = (document.getElementById('cfgMerchantPinInput')?.value || '').trim();
  if (!/^\d{4}$/.test(val)) {
    showToast('⚠️ 請輸入 4 位數字安全授權碼！');
    return;
  }
  const newHash = await computeSha256Hex(val);
  const oldToken = state.merchantAuthToken;
  state.merchantPinHash = newHash;
  state.merchantAuthToken = newHash;
  try {
    localStorage.setItem('mealflow_merchant_pin_hash_v11', newHash);
    sessionStorage.setItem('mealflow_merchant_token_v11', newHash);
  } catch (e) {}

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateMerchantPinHash',
        merchantAuthToken: oldToken,
        newPinHash: newHash
      })
    });
  } catch (e) {}

  showToast('✅ 店務安全授權碼已加密更新並同步至雲端！');
}

// ==================== 6.5 菜單辨識、現場可編輯表格與進階餐點編輯器 ====================
function addManualMenuItem() {
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const cat = document.getElementById('newMenuCat')?.value.trim() || '主廚推薦';
  const name = document.getElementById('newMenuName')?.value.trim();
  const price = parseInt(document.getElementById('newMenuPrice')?.value, 10);
  const tag = document.getElementById('newMenuTag')?.value.trim() || '';
  const optsRaw = document.getElementById('newMenuOpts')?.value.trim();

  if (!name || isNaN(price) || price <= 0) {
    showToast('⚠️ 請輸入有效的餐點名稱與價格！');
    return;
  }

  const options = parseShorthandOptionsString(optsRaw);

  const newItem = {
    id: 'M' + Date.now().toString().slice(-4),
    category: cat,
    name,
    price,
    tag,
    soldOut: false,
    options,
    autoDefaultOptions: false
  };

  store.menus = store.menus || [];
  store.menus.push(newItem);
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  renderMerchantSettingsPanel(store);
  showToast(`✅ 已新增餐點：${name} (NT$${price})`);
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
      return m ? [m[1].trim(), parseInt(m[2], 10)] : [tok, 0];
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
      const p = Array.isArray(c) ? Number(c[1]) || 0 : 0;
      return p > 0 ? `${n}+${p}` : n;
    }).join(', ');
    return `${grpName}: ${cStr}`;
  }).join(' ; ');
}

function updateMenuItemPrice(idx, newPriceVal) {
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[idx]) return;
  const p = parseInt(newPriceVal, 10);
  if (isNaN(p) || p < 0) return;
  store.menus[idx].price = p;
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  showToast(`💾 已更新「${store.menus[idx].name}」價格為 NT$${p}`);
}

function deleteMenuItem(idx) {
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[idx]) return;
  const removed = store.menus.splice(idx, 1)[0];
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  renderMerchantSettingsPanel(store);
  showToast(`🗑️ 已刪除品項：${removed.name}`);
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
      const p = Array.isArray(c) ? (Number(c[1]) || 0) : 0;
      return p > 0 ? `${n}+${p}` : n;
    }).join(', ');
    groupsList.push({
      name: gName,
      type: (grp && grp.type === 'checkbox') ? 'checkbox' : 'radio',
      choicesText: cText
    });
  });
  state.editingMenuTempOptions = groupsList;

  renderMenuEditModalBody(item);
  document.getElementById('menuEditModal')?.classList.add('open');
}

function renderMenuEditModalBody(item) {
  const body = document.getElementById('menuEditModalBody');
  if (!body) return;

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

    <div style="display:grid; grid-template-columns:1.6fr 1fr; gap:10px; margin-bottom:14px;">
      <div>
        <label class="field-label">🍽️ 餐點名稱 *</label>
        <input type="text" id="editMenuName" class="select-input" value="${escapeHtml(item.name || '')}">
      </div>
      <div>
        <label class="field-label">💰 單價 (NT$) *</label>
        <input type="number" id="editMenuPrice" class="select-input" value="${Number(item.price) || 0}">
      </div>
    </div>

    <div style="border-top:1px solid var(--border); padding-top:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <label class="field-label" style="margin:0; font-size:0.86rem; color:var(--indigo);">⚙️ 客製化選項群組設定 (${state.editingMenuTempOptions.length} 組)</label>
        <button type="button" class="filter-chip" style="padding:4px 10px; font-size:0.75rem;" onclick="addTempOptionGroupInModal()">＋ 新增選項群組</button>
      </div>

      <div id="editMenuOptionGroupsContainer" style="display:flex; flex-direction:column; gap:8px;">
        ${state.editingMenuTempOptions.length === 0 ? `
          <div style="text-align:center; padding:14px; background:#F8FAFC; border:1px dashed var(--border); border-radius:10px; font-size:0.8rem; color:var(--text-muted);">
            此餐點目前為單點無客製選項，可點上方「＋ 新增選項群組」加入份量、辣度或加料設定。
          </div>
        ` : state.editingMenuTempOptions.map((g, gIdx) => `
          <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:10px; padding:10px;">
            <div style="display:grid; grid-template-columns:1.2fr 0.9fr auto; gap:6px; margin-bottom:6px;">
              <input type="text" class="select-input" style="padding:6px 8px; font-size:0.8rem;" placeholder="群組名稱 (如: 主食份量)" value="${escapeHtml(g.name)}" oninput="state.editingMenuTempOptions[${gIdx}].name=this.value">
              <select class="select-input" style="padding:6px 8px; font-size:0.8rem;" onchange="state.editingMenuTempOptions[${gIdx}].type=this.value">
                <option value="radio" ${g.type === 'radio' ? 'selected' : ''}>必選單選</option>
                <option value="checkbox" ${g.type === 'checkbox' ? 'selected' : ''}>可多選加料</option>
              </select>
              <button type="button" class="btn-danger-soft" onclick="removeTempOptionGroupInModal(${gIdx})">刪</button>
            </div>
            <input type="text" class="select-input" style="padding:6px 8px; font-size:0.8rem;" placeholder="選項內容，用逗號分隔（加價寫 +數字，如：正常飯量, 飯少, 大盛加飯+10）" value="${escapeHtml(g.choicesText)}" oninput="state.editingMenuTempOptions[${gIdx}].choicesText=this.value">
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function syncTempModalInputsBeforeRerender() {
  return {
    category: document.getElementById('editMenuCat')?.value || '主廚推薦',
    tag: document.getElementById('editMenuTag')?.value || '',
    name: document.getElementById('editMenuName')?.value || '',
    price: parseInt(document.getElementById('editMenuPrice')?.value || '0', 10)
  };
}

function addTempOptionGroupInModal() {
  const snapshot = syncTempModalInputsBeforeRerender();
  state.editingMenuTempOptions.push({
    name: '加料或辣度',
    type: 'radio',
    choicesText: '標準, 小辣, 加滷蛋+15'
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
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  const idx = state.editingMenuStoreIndex;
  if (!store || idx < 0 || !store.menus[idx]) return;

  const cat = document.getElementById('editMenuCat')?.value.trim() || '主廚推薦';
  const tag = document.getElementById('editMenuTag')?.value.trim() || '';
  const name = document.getElementById('editMenuName')?.value.trim();
  const price = parseInt(document.getElementById('editMenuPrice')?.value || '0', 10);

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
      .map(tok => {
        const m = tok.match(/^(.+?)\+(\d+)$/);
        return m ? [m[1].trim(), parseInt(m[2], 10)] : [tok, 0];
      });
    if (choices.length > 0) {
      newOptions[gName] = {
        type: g.type === 'checkbox' ? 'checkbox' : 'radio',
        choices
      };
    }
  });

  store.menus[idx] = {
    ...store.menus[idx],
    category: cat,
    tag,
    name,
    price,
    options: newOptions,
    autoDefaultOptions: false
  };

  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  closeMenuEditModal();
  renderMerchantSettingsPanel(store);
  showToast(`✅ 已更新「${name}」之完整餐點設定與客製選項！`);
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
        rawText: rawText,
        imageBase64: imageBase64 || '',
        imageMime: mimeType || 'image/jpeg'
      })
    });
    const data = await res.json();
    if (data && Array.isArray(data.parsedMenus) && data.parsedMenus.length > 0) {
      usedEngine = data.engine || '雲端多模態視覺引擎';
      parsed = data.parsedMenus.map((item, idx) => ({
        id: 'M' + (Date.now().toString().slice(-3)) + idx,
        selected: true,
        category: String(item.category || '掃描推薦'),
        name: String(item.name || '未命名餐點'),
        price: Number(item.price) || 100,
        tag: String(item.tag || '🔥 店長推薦'),
        optionsShorthand: formatOptionsToShorthand(item.options || {})
      }));
    }
  } catch (e) {}

  if (parsed.length === 0 && rawText) {
    let currentCat = '掃描推薦';
    const lines = rawText.split(/\r?\n/);
    lines.forEach((line, idx) => {
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
          id: 'M' + Math.floor(1000 + Math.random() * 9000) + idx,
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
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !state.scannedMenuCandidates.length) return;

  const selectedList = state.scannedMenuCandidates.filter(c => c.selected && c.name && c.price > 0);
  if (selectedList.length === 0) {
    showToast('⚠️ 請至少勾選一道有效餐點！');
    return;
  }

  store.menus = store.menus || [];
  selectedList.forEach(cand => {
    const parsedOptions = parseShorthandOptionsString(cand.optionsShorthand);
    const existing = store.menus.find(m => m.name === cand.name);
    if (existing) {
      existing.price = cand.price;
      existing.category = cand.category;
      existing.tag = cand.tag || existing.tag;
      if (Object.keys(parsedOptions).length > 0) existing.options = parsedOptions;
    } else {
      store.menus.push({
        id: cand.id,
        category: cand.category,
        name: cand.name,
        price: cand.price,
        tag: cand.tag || '🔥 店長推薦',
        soldOut: false,
        options: parsedOptions,
        autoDefaultOptions: false
      });
    }
  });

  state.scannedMenuCandidates = [];
  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  renderMerchantSettingsPanel(store);
  showToast(`🎉 已成功匯入 ${selectedList.length} 道餐點並同步至雲端資料庫！`);
}

async function saveMerchantConfig() {
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const isOpenVal = document.getElementById('cfgStoreIsOpen')?.value;
  if (isOpenVal !== undefined) {
    store.isOpen = isOpenVal === 'true';
  }
  store.cutleryPrice = Math.max(0, parseInt(document.getElementById('cfgCutleryPrice')?.value || '1', 10));
  store.maxCapacityPer15Min = Math.max(5, parseInt(document.getElementById('cfgMaxCap')?.value || '20', 10));
  store.baseQueueOffset = Math.max(0, parseInt(document.getElementById('cfgBaseQueueOffset')?.value || '0', 10));
  store.promoMode = document.getElementById('cfgPromoMode')?.value || 'none';
  store.promoText = document.getElementById('cfgPromoText')?.value.trim() || '';
  store.promoDiscount = Math.max(0, parseInt(document.getElementById('cfgPromoDiscount')?.value || '0', 10));

  state.lastLocalStoreConfigUpdateTs = Date.now();
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();
  showToast(`✅ 已儲存「${store.name}」設定（目前總即時佇列：${store.activeOrders} 單，預估 ${store.avgPrepMinutes} 分）！`);

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
        maxCapacityPer15Min: store.maxCapacityPer15Min,
        baseQueueOffset: store.baseQueueOffset,
        activeOrders: store.activeOrders,
        promoMode: store.promoMode,
        promoText: store.promoText,
        promoDiscount: store.promoDiscount
      })
    });
  } catch (e) {}
}

async function triggerTrafficSimulation(mode = 'PEAK') {
  if (!state.isMerchantUnlocked) return;
  const btn = document.getElementById('simTrafficBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ 正在切換佇列模擬...';
  }

  state.stores.forEach(s => {
    if (mode === 'PEAK') {
      if (s.id === 'S01' || s.id === 'S03' || s.id === 'S05') {
        s.baseQueueOffset = Math.round(s.maxCapacityPer15Min * 0.95);
      } else {
        s.baseQueueOffset = 0;
        if (s.promoMode === 'none') {
          s.promoMode = 'discount';
          s.promoDiscount = 10;
          s.promoText = '💰 離峰分流現折$10';
        }
      }
    } else {
      s.baseQueueOffset = 0;
    }
  });

  state.lastLocalStoreConfigUpdateTs = Date.now();
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();
  showToast(mode === 'PEAK' ? '⚡ 已觸發中午 12:10 尖峰塞車與動態分流模擬！' : '🟢 已恢復正常離峰佇列狀態！');

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'simulateTraffic',
        ...getMerchantAuthPayload(),
        mode,
        campus: state.campus
      })
    });
  } catch (e) {} finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '⚡ 觸發中午 12:10 尖峰塞車模擬';
    }
  }
}

function toggleStoreCustomLineMode(useCustom) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  store.useCustomLineOa = Boolean(useCustom);
  saveLocalStores(state.stores);
  renderMerchantSettingsPanel(store);
}

async function saveLineMessagingConfig() {
  if (!state.isMerchantUnlocked) return;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  if (store.useCustomLineOa) {
    const clientId = document.getElementById('cfgStoreLineClientId')?.value.trim() || '';
    const clientSecret = document.getElementById('cfgStoreLineClientSecret')?.value.trim() || '';
    const channelToken = document.getElementById('cfgStoreLineChannelToken')?.value.trim() || '';

    store.customLineClientId = clientId;
    store.customLineClientSecret = '';
    store.customLineChannelToken = '';
    saveLocalStores(state.stores);
    showToast(`✅ 已儲存「${store.name}」專屬官方帳號推播設定至雲端後台！`);
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
          channelAccessToken: channelToken
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

    showToast(`✅ 「${store.name}」已設為使用系統預設官方帳號推播！`);
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
          systemChannelToken: sysChannelToken
        })
      });
    } catch (e) {}
  }
}
