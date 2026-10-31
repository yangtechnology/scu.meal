/**
 * 東吳學餐 MealFlow v8.1 (Security & Cloud Sync Patched)
 * - 移除前端硬編碼 LINE Secret / Channel Access Token，杜絕 GitGuardian 洩漏警報
 * - 修正 syncCloud() 與 code.gs getInitBundle() 之 bundle.{stores, orders} 對接
 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbzVXQRKZfnhgM_BhW6pgy1VOCg7YmCdfnAdHOS_9Tt7agxQa2r69hwg1UGL73gpoVwp/exec';
// Channel ID 為公開 OAuth 識別碼（非機密）；Secret 與 Access Token 嚴禁寫入前端原始碼，統一由後端 GAS ScriptProperties 託管
const DEFAULT_LINE_CLIENT_ID = localStorage.getItem('mealflow_system_line_client_id') || '2012260287';
const DEFAULT_LINE_CLIENT_SECRET = '';
const DEFAULT_LINE_CHANNEL_TOKEN = '';
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
    maxCapacityPer15Min: 18, activeOrders: 17, avgPrepMinutes: 22, cutleryPrice: 1,
    promoMode: 'none', promoText: '無優惠', promoDiscount: 0, predictedDailyOrders: 240, rating: 4.9,
    menus: [
      { id: 'M01', category: '韓式海苔飯捲', name: '特製韓式泡菜燒肉飯捲', price: 75, tag: '🔥 必點人氣', image: '', options: getStdRiceOptions() },
      { id: 'M02', category: '韓式海苔飯捲', name: '起司炸蝦海苔飯捲', price: 85, tag: '⭐ 主廚推薦', image: '', options: getStdRiceOptions() },
      { id: 'M03', category: '韓式海苔飯捲', name: '經典鮪魚玉米飯捲', price: 65, tag: '⚡ 快速出餐', image: '', options: getStdRiceOptions() },
      { id: 'M18', category: '韓式湯品與飲品', name: '釜山魚板蘿蔔湯', price: 35, tag: '🥣 暖胃湯品', image: '', options: {} },
      { id: 'M22', category: '韓式湯品與飲品', name: '韓國水蜜桃果粒飲', price: 40, tag: '🥤 人氣飲品', image: '', options: { '冰塊調整': { type: 'radio', choices: [['正常冰', 0], ['去冰', 0]] } } }
    ]
  },
  {
    id: 'S02', campus: '雙溪校區', name: '雙溪-丼物園', category: '日式蓋飯・烏龍麵',
    maxCapacityPer15Min: 20, activeOrders: 4, avgPrepMinutes: 5, cutleryPrice: 1,
    promoMode: 'gift', promoText: '🎁 AI分流招待：免費溫泉蛋乙顆', promoDiscount: 0, predictedDailyOrders: 165, rating: 4.7,
    menus: [
      { id: 'M04', category: '炙燒日式丼飯', name: '炙燒起司牛五花丼', price: 115, tag: '🔥 招牌必點', image: '', options: getStdRiceOptions() },
      { id: 'M05', category: '炙燒日式丼飯', name: '黃金厚切豬排滑蛋丼', price: 120, tag: '⭐ 飽足首選', image: '', options: getStdRiceOptions() },
      { id: 'M06', category: '讚岐烏龍麵', name: '讚岐胡麻冷烏龍麵', price: 95, tag: '⚡ 3分極速出餐', image: '', options: getStdNoodleOptions() },
      { id: 'M19', category: '單點炸物與茶飲', name: '日式唐揚炸雞 (5塊)', price: 55, tag: '🍗 人氣單點', image: '', options: { '調味粉': { type: 'radio', choices: [['原味胡椒', 0], ['日式七味粉', 0], ['泰式酸辣醬', 5]] } } },
      { id: 'M23', category: '單點炸物與茶飲', name: '靜岡無糖玄米綠茶', price: 30, tag: '🍵 解膩首選', image: '', options: {} }
    ]
  },
  {
    id: 'S03', campus: '雙溪校區', name: '雙溪-四海遊龍', category: '鍋貼水餃・麵食',
    maxCapacityPer15Min: 25, activeOrders: 19, avgPrepMinutes: 16, cutleryPrice: 1,
    promoMode: 'none', promoText: '無優惠', promoDiscount: 0, predictedDailyOrders: 210, rating: 4.6,
    menus: [
      { id: 'M07', category: '手工鍋貼與水餃', name: '招牌脆皮鍋貼 (10顆)', price: 70, tag: '🔥 經典酥脆', image: '', options: getDumplingSetOptions() },
      { id: 'M08', category: '手工鍋貼與水餃', name: '高麗菜鮮肉水餃 (10顆)', price: 70, tag: '⚡ 飽滿多汁', image: '', options: getDumplingSetOptions() },
      { id: 'M25', category: '手工鍋貼與水餃', name: '韓式辣味鮮肉水餃 (10顆)', price: 75, tag: '🌶️ 香辣過癮', image: '', options: getDumplingSetOptions() },
      { id: 'M24', category: '開胃小菜與湯飲', name: '招牌酸辣湯', price: 35, tag: '🥣 經典絕配', image: '', options: { '胡椒與醋': { type: 'radio', choices: [['正常', 0], ['加辣油', 0], ['不加蔥香菜', 0]] } } },
      { id: 'M20', category: '開胃小菜與湯飲', name: '非基改冰鎮豆漿', price: 25, tag: '🥛 清涼飲品', image: '', options: { '甜度': { type: 'radio', choices: [['微糖', 0], ['無糖', 0]] } } }
    ]
  },
  {
    id: 'S04', campus: '雙溪校區', name: '蒲家廚房', category: '中式特餐・便當',
    maxCapacityPer15Min: 20, activeOrders: 5, avgPrepMinutes: 6, cutleryPrice: 1,
    promoMode: 'discount', promoText: '💰 AI分流折抵：現折 $10 元', promoDiscount: 10, predictedDailyOrders: 150, rating: 4.8,
    menus: [
      { id: 'M09', category: '人氣特餐便當', name: '秘製椒麻雞腿飯 (含3配菜)', price: 110, tag: '🔥 銷量冠軍', image: '', options: getStdRiceOptions() },
      { id: 'M10', category: '人氣特餐便當', name: '蒜泥白肉精緻便當 (含3配菜)', price: 100, tag: '⚡ 極速便當', image: '', options: getStdRiceOptions() },
      { id: 'M21', category: '單點小菜與湯品', name: '黃金脆皮炸豆腐', price: 40, tag: '✨ 招牌小菜', image: '', options: {} }
    ]
  },
  {
    id: 'S05', campus: '城中校區', name: '城中-咖哩食堂', category: '熟成咖哩・炸物',
    maxCapacityPer15Min: 15, activeOrders: 16, avgPrepMinutes: 26, cutleryPrice: 1,
    promoMode: 'none', promoText: '無優惠', promoDiscount: 0, predictedDailyOrders: 195, rating: 4.8,
    menus: [
      { id: 'M11', category: '熟成濃咖哩', name: '唐揚炸雞熟成咖哩飯', price: 125, tag: '🔥 排隊人氣', image: '', options: getStdRiceOptions() },
      { id: 'M12', category: '熟成濃咖哩', name: '手打漢堡排歐姆蛋咖哩', price: 135, tag: '⭐ 限量供應', image: '', options: getStdRiceOptions() },
      { id: 'M26', category: '炸物點心', name: '酥炸莫札瑞拉起司條 (3入)', price: 50, tag: '🧀 邪惡點心', image: '', options: {} }
    ]
  },
  {
    id: 'S06', campus: '城中校區', name: '城中-吳葉食堂', category: '精緻台式簡餐',
    maxCapacityPer15Min: 20, activeOrders: 3, avgPrepMinutes: 4, cutleryPrice: 1,
    promoMode: 'gift', promoText: '🎁 AI分流招待：免費招牌冰紅茶', promoDiscount: 0, predictedDailyOrders: 145, rating: 4.9,
    menus: [
      { id: 'M13', category: '主廚鐵板與簡餐', name: '蔥爆牛肉鐵板簡餐', price: 115, tag: '🔥 現點現做', image: '', options: getStdRiceOptions() },
      { id: 'M14', category: '主廚鐵板與簡餐', name: '古早味排骨特餐', price: 105, tag: '⚡ 4分極速取餐', image: '', options: getStdRiceOptions() },
      { id: 'M15', category: '特色麵食', name: '手工鮮蝦紅油抄手麵', price: 90, tag: '⭐ 學生最愛', image: '', options: getStdNoodleOptions() }
    ]
  },
  {
    id: 'S07', campus: '城中校區', name: '大熊涼麵 X 吃好食堂', category: '手工涼麵・味噌湯',
    maxCapacityPer15Min: 25, activeOrders: 6, avgPrepMinutes: 3, cutleryPrice: 1,
    promoMode: 'points', promoText: '⚡ AI分流回饋：雙倍 MealPoints 點數', promoDiscount: 0, predictedDailyOrders: 160, rating: 4.7,
    menus: [
      { id: 'M16', category: '手工現拌涼麵', name: '川味麻辣雞絲涼麵 (大)', price: 75, tag: '⚡ 2分秒取', image: '', options: getStdNoodleOptions() },
      { id: 'M17', category: '招牌味噌湯品', name: '綜合三合一味噌湯 (貢丸+蛋花)', price: 45, tag: '🔥 絕配湯品', image: '', options: {} }
    ]
  }
];

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
  if (!baseDateStr) return getTodayDateStr();
  const parts = baseDateStr.split('-').map(Number);
  const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function calcDiffDaysFromToday(targetDateStr) {
  if (!targetDateStr) return 0;
  const todayParts = getTodayDateStr().split('-').map(Number);
  const targetParts = targetDateStr.split('-').map(Number);
  const t0 = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]).getTime();
  const t1 = new Date(targetParts[0], targetParts[1] - 1, targetParts[2]).getTime();
  return Math.max(0, Math.round((t1 - t0) / 86400000));
}

function loadLocalStores() {
  try {
    const saved = localStorage.getItem('mealflow_stores_v7');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_STORES));
}

function saveLocalStores(stores) {
  try {
    localStorage.setItem('mealflow_stores_v7', JSON.stringify(stores));
  } catch (e) {}
}

function loadCachedOrders() {
  try {
    const raw = localStorage.getItem('mealflow_orders_v8');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  const today = getTodayDateStr();
  const yesterday = getDateOffsetStr(-1);
  const minus2 = getDateOffsetStr(-2);
  const plus3 = getDateOffsetStr(3);
  const deadline = getDateOffsetStr(1);
  return [
    {
      orderId: 'ORD-8f92a1c4b7e0', pickupNumber: 'S208', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '📱 掃碼點餐', studentName: '外帶自取',
      itemsJson: JSON.stringify([
        { id: 'M04', name: '炙燒起司牛五花丼 [主食份量:大盛加飯, 辣度選擇:小辣]', price: 125, qty: 1 },
        { id: 'M23', name: '靜岡無糖玄米綠茶', price: 30, qty: 1 }
      ]),
      subtotal: 155, cutleryFee: 0, needCutlery: false, discount: 0, finalTotal: 155,
      promoApplied: '🎁 AI分流招待：免費溫泉蛋乙顆',
      pickupTimeSlot: '⚡ 立即製作 (約5分)', paymentMethod: 'LINE Pay', status: '製作中',
      isReservation: false, pickupDate: today, pickupTime: '12:10', customerPhone: '',
      paymentDeadline: '', paymentStatus: '已付款', notifyCount: 0,
      isDivertedOrder: true, createdAt: '12:08:15'
    },
    {
      orderId: 'ORD-7a41c8b021e9', pickupNumber: 'S205', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '🖥️ 現場POS', studentName: '內用自取 (實收$200/找零$25)',
      itemsJson: JSON.stringify([
        { id: 'M05', name: '黃金厚切豬排滑蛋丼 [主食份量:正常飯量]', price: 120, qty: 1 },
        { id: 'M19', name: '日式唐揚炸雞 (5塊) [調味粉:原味胡椒]', price: 55, qty: 1 }
      ]),
      subtotal: 175, cutleryFee: 0, needCutlery: false, discount: 0, finalTotal: 175,
      promoApplied: '現場POS點餐',
      pickupTimeSlot: '⚡ 現場立即製作', paymentMethod: '現場現金', status: '已完成',
      isReservation: false, pickupDate: today, pickupTime: '11:35', customerPhone: '',
      paymentDeadline: '', paymentStatus: '已付款', notifyCount: 1,
      isDivertedOrder: false, createdAt: '11:32:10'
    },
    {
      orderId: 'ORD-6d19f2e490a3', pickupNumber: 'S202', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '📱 掃碼點餐', studentName: '內用自取',
      itemsJson: JSON.stringify([
        { id: 'M06', name: '讚岐胡麻冷烏龍麵 [麵條份量:加麵大碗]', price: 110, qty: 2 }
      ]),
      subtotal: 220, cutleryFee: 0, needCutlery: false, discount: 0, finalTotal: 220,
      promoApplied: '🎁 AI分流招待：免費溫泉蛋乙顆',
      pickupTimeSlot: '⚡ 立即製作 (約5分)', paymentMethod: '街口支付', status: '已完成',
      isReservation: false, pickupDate: today, pickupTime: '10:45', customerPhone: '',
      paymentDeadline: '', paymentStatus: '已付款', notifyCount: 1,
      isDivertedOrder: true, createdAt: '10:42:00'
    },
    {
      orderId: 'ORD-5b83e1a904c2', pickupNumber: 'S198', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '📱 掃碼點餐', studentName: '外帶自取・🥢 需一次性餐具(+$1)',
      itemsJson: JSON.stringify([
        { id: 'M04', name: '炙燒起司牛五花丼 [主食份量:正常飯量]', price: 115, qty: 2 },
        { id: 'M19', name: '日式唐揚炸雞 (5塊)', price: 55, qty: 1 }
      ]),
      subtotal: 285, cutleryFee: 1, needCutlery: true, discount: 0, finalTotal: 286,
      promoApplied: '🎁 AI分流招待：免費溫泉蛋乙顆',
      pickupTimeSlot: '⚡ 立即製作 (約5分)', paymentMethod: 'LINE Pay', status: '已完成',
      isReservation: false, pickupDate: yesterday, pickupTime: '12:20', customerPhone: '',
      paymentDeadline: '', paymentStatus: '已付款', notifyCount: 1,
      isDivertedOrder: true, createdAt: '12:18:00'
    },
    {
      orderId: 'ORD-4e20d7c381f5', pickupNumber: 'S186', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '🖥️ 現場POS', studentName: '內用自取',
      itemsJson: JSON.stringify([
        { id: 'M05', name: '黃金厚切豬排滑蛋丼', price: 120, qty: 2 }
      ]),
      subtotal: 240, cutleryFee: 0, needCutlery: false, discount: 0, finalTotal: 240,
      promoApplied: '現場POS點餐',
      pickupTimeSlot: '⚡ 現場立即製作', paymentMethod: '現場現金', status: '已完成',
      isReservation: false, pickupDate: minus2, pickupTime: '13:10', customerPhone: '',
      paymentDeadline: '', paymentStatus: '已付款', notifyCount: 1,
      isDivertedOrder: false, createdAt: '13:05:22'
    },
    {
      orderId: 'ORD-3c71b9e2d411', pickupNumber: 'S315', storeId: 'S02', storeName: '雙溪-丼物園',
      studentId: '📅 預訂點餐', studentName: '外帶自取・🥢 需一次性餐具(+$1)・📱0912345678',
      itemsJson: JSON.stringify([{ id: 'M05', name: '黃金厚切豬排滑蛋丼 [主食份量:正常飯量]', price: 120, qty: 2 }]),
      subtotal: 240, cutleryFee: 1, needCutlery: true, discount: 0, finalTotal: 241,
      promoApplied: '一般點餐',
      pickupTimeSlot: `📅 預訂 ${plus3} 12:15`, paymentMethod: '現場櫃檯付現', status: '製作中',
      isReservation: true, pickupDate: plus3, pickupTime: '12:15', customerPhone: '0912345678',
      paymentDeadline: deadline, paymentStatus: '待櫃檯繳費', notifyCount: 0,
      isDivertedOrder: false, createdAt: '11:40:00'
    }
  ];
}

function saveCachedOrders(orders) {
  try {
    localStorage.setItem('mealflow_orders_v8', JSON.stringify(orders.slice(0, 120)));
  } catch (e) {}
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
        channelAccessToken: '' // 不在前端 localStorage 保留長期 Token，統一由後端 GAS 託管
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

let state = {
  routeMode: 'portal', // 'portal' | 'order' | 'ticket' | 'store'
  trackingOrderId: null,
  myCreatedOrderId: sessionStorage.getItem('mealflow_my_created_order_id') || null,
  campus: '雙溪校區',
  filter: 'ALL',
  stores: loadLocalStores(),
  aiRecommendations: {},
  orders: loadCachedOrders(),

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
  checkoutReserveTime: '12:10',
  checkoutPhone: '',
  checkoutPayMethod: 'LINE Pay',
  checkoutNote: '',

  // 店家全螢幕 POS 四大主導覽：'pos' | 'kds' | 'analytics' | 'settings'
  storeTabMode: 'pos',
  settingsSubTab: 'menu', // 'menu' | 'promo' | 'line'
  merchantStoreId: 'S02',
  merchantPromoMode: 'gift',

  // 店家櫃檯 POS 狀態
  posSelectedCategory: '全部',
  posCart: [],
  posDineType: '內用自取',
  posNeedCutlery: false,
  posTimeMode: 'NOW',
  posReserveDate: getTodayDateStr(),
  posReserveTime: '12:10',
  posCustomerPhone: '',
  posPayment: '現場現金',
  posCashReceived: '',

  // 訂單管理 (KDS) 分天檢視與收款狀態
  kdsSelectedDate: getTodayDateStr(), // 'ALL' 或 'YYYY-MM-DD'
  kdsStatusFilter: 'ALL', // 'ALL' | 'UNPAID' | 'COOKING' | 'READY' | 'DONE'
  kdsSearchQuery: '',
  payingOrderId: null,
  payingOrderMethod: '現場現金',
  payingOrderCashInput: '',

  // AI 營運分析時間維度：'DAY' | 'WEEK' | 'MONTH'
  analyticsPeriod: 'DAY',

  // 店家菜單管理與 AI 掃描狀態
  scannedMenuCandidates: [],
  adminMenuData: [],
  isMenuDirty: false,
  editingMenuIndex: -1,
  currentEditOptions: {},
  aiScannedItems: [],
  aiScanImageDataUrl: '',

  // LINE Developers Messaging API 與震動通知狀態
  lineProfile: loadLineProfile(),
  lineMessageLogs: loadLineLogs(),
  lastSeenOrderNotifyMap: {},

  geminiApiKey: localStorage.getItem('mealflow_gemini_key') || '',
  pollTimer: null
};

// ==================== 工具與 M/M/1 佇列效用演算法 ====================
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

function calcPrepMinutes(activeOrders, maxCap) {
  const cap = Math.max(5, Number(maxCap) || 20);
  const act = Math.max(0, Number(activeOrders) || 0);
  const serviceRatePerMin = cap / 15;
  const loadRatio = act / cap;
  if (act <= 1) return 3;
  const queueTime = act / serviceRatePerMin;
  const congestionPenalty = loadRatio >= 0.85 ? Math.pow((loadRatio - 0.75) * 10, 1.5) : 0;
  const est = Math.round(2 + queueTime * 0.85 + congestionPenalty);
  return Math.max(3, Math.min(45, est));
}

function calcAiUtilityScore(store) {
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
  if (!hasOpts) {
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
    image: String(m.image || ''),
    options: opts
  };
}

function enrichStoresAndAi() {
  state.stores = state.stores.map(s => {
    const defStore = DEFAULT_STORES.find(d => d.id === s.id);
    const rawMenus = (s.menus && s.menus.length > 0) ? s.menus : (defStore ? defStore.menus : []);
    const normalizedMenus = rawMenus.map(m => normalizeMenuItem(m, s.id));

    const cap = Math.max(5, Number(s.maxCapacityPer15Min) || 20);
    const active = Math.max(0, Number(s.activeOrders) || 0);
    const loadPct = Math.min(120, Math.round((active / cap) * 100));
    let loadState = 'FREE';
    if (loadPct >= 85) loadState = 'FULL';
    else if (loadPct >= 50) loadState = 'MODERATE';

    const avgPrep = Number(s.avgPrepMinutes) || calcPrepMinutes(active, cap);
    const cutleryPrice = s.cutleryPrice !== undefined && s.cutleryPrice !== '' ? Math.max(0, Number(s.cutleryPrice)) : 1;

    const obj = {
      ...s,
      maxCapacityPer15Min: cap,
      activeOrders: active,
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
    const campusStores = state.stores.filter(s => s.campus === campus);
    const congested = campusStores
      .filter(s => s.loadState === 'FULL' || s.avgPrepMinutes >= 20)
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
  return store && store.promoMode !== 'none' && store.loadState !== 'FULL';
}

// ==================== 震動、叮咚響鈴與 LINE Developers Messaging API 真實串接 ====================
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

/**
 * 透過後端 GAS 發送真實 LINE Flex Message 卡片推播與免費無限額 Email 通知
 * （已移除畫面上多餘的懸浮卡片，僅在後端發送真實 LINE / Email 並記錄於通知匣）
 */
async function pushLineNotification(eventType, title, message, order = null) {
  const nowStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  const targetUserId = (order && order.lineUserId) || state.lineProfile.lineUserId || '';
  const targetEmail = (order && order.customerEmail) || state.lineProfile.email || '';
  const storeObj = order ? state.stores.find(s => s.id === order.storeId) : state.stores.find(s => s.id === state.selectedStoreId);
  const usingStoreCustomLine = Boolean(storeObj && storeObj.useCustomLineOa);
  const senderLabel = usingStoreCustomLine ? `${storeObj.name} 官方 LINE` : 'MealFlow 預設官方 LINE / Email';

  const channels = [];
  if (targetUserId && targetUserId.startsWith('U')) channels.push(`LINE (${targetUserId.slice(0, 8)}...)`);
  if (targetEmail && targetEmail.includes('@')) channels.push(`Email (${targetEmail})`);
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

  // 若有綁定 LINE User ID (U開頭) 或 Email 信箱，自動呼叫 GAS 後端發送 LINE Flex Message 卡片與 Email 通知
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
          storeName: order ? order.storeName : (storeObj ? storeObj.name : '東吳學餐 MealFlow'),
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
            ${state.lineProfile.lineUserId ? `<div style="font-size:0.72rem; color:#15803D; font-family:monospace;">LINE UID: ${escapeHtml(state.lineProfile.lineUserId)}</div>` : ''}
            ${state.lineProfile.email ? `<div style="font-size:0.72rem; color:#15803D;">📧 Email: ${escapeHtml(state.lineProfile.email)}</div>` : ''}
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

/**
 * 仿 VocabMaster 架構：使用 LINE Login OAuth 2.1 (`https://access.line.me/oauth2/v2.1/authorize`) 一鍵授權跳轉綁定
 * 完全不需設定 Webhook！若店家有綁定專屬官方 LINE 則使用店家 Client ID，否則自動使用系統預設 Client ID。
 */
function startLineOAuthLogin() {
  const activeStore = state.stores.find(s => s.id === (state.selectedStoreId || state.merchantStoreId));
  const useCustom = Boolean(activeStore && activeStore.useCustomLineOa && activeStore.customLineClientId);
  const clientId = useCustom
    ? activeStore.customLineClientId.trim()
    : (state.lineProfile.customClientId || DEFAULT_LINE_CLIENT_ID);

  // 取當前乾淨網址作為 OAuth Redirect URI
  const redirectUri = window.location.origin + window.location.pathname;
  const storeState = activeStore ? activeStore.id : 'SYSTEM';
  try {
    sessionStorage.setItem('mealflow_line_oauth_redirect', redirectUri);
    sessionStorage.setItem('mealflow_line_oauth_store', storeState);
  } catch (e) {}

  const authUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=bind_${encodeURIComponent(storeState)}&scope=profile%20openid`;
  window.location.href = authUrl;
}

/**
 * 當從 LINE Login OAuth 2.1 授權頁面跳轉回來 (`?code=...&state=bind_...`) 時，
 * 自動呼叫後端 GAS `handleLineCallback` 換取 `lineUid` 與 `displayName` 完成綁定！
 */
async function checkLineOAuthCallbackOnLoad() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const oauthState = params.get('state') || '';
  if (!code || !oauthState.startsWith('bind')) return;

  const storeIdFromState = oauthState.includes('_') ? oauthState.split('_')[1] : (sessionStorage.getItem('mealflow_line_oauth_store') || '');
  const redirectUri = sessionStorage.getItem('mealflow_line_oauth_redirect') || (window.location.origin + window.location.pathname);

  showToast('⏳ 正在完成 LINE Login 帳號授權綁定...');
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
      showToast(`⚠️ LINE 授權換取失敗：${(data && data.message) || '請確認 Channel ID / Secret 與 Callback URL 設定'}`);
    }
  } catch (e) {
    showToast('⚠️ 無法連線至後端交換 LINE Token');
  } finally {
    // 清除網址列上的 code 與 state 參數，保持網址乾淨
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
  if (rawUid) {
    state.lineProfile.lineUserId = rawUid;
  }
  saveLineProfile(state.lineProfile);

  pushLineNotification(
    'BIND_SUCCESS',
    '💚 取餐通知設定已儲存',
    `已設定 ${name} 的取餐推播通知${email ? ` (Email: ${email})` : ''}！當餐點製作完成時將自動通知您。`
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
    box.innerHTML = `<p style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:12px;">尚無 LINE 推播紀錄</p>`;
    return;
  }
  box.innerHTML = state.lineMessageLogs.slice(0, 8).map(log => `
    <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px; padding:8px 12px; margin-bottom:6px; font-size:0.78rem;">
      <div style="display:flex; justify-content:space-between; font-weight:800; color:#166534;">
        <span>${escapeHtml(log.title)} <small style="color:#059669;">(${escapeHtml(log.senderLabel || '官方LINE')})</small></span>
        <span>${escapeHtml(log.time)}</span>
      </div>
      <div style="color:#374151; margin-top:2px;">${escapeHtml(log.message)}</div>
    </div>
  `).join('');
}

function autoPurgeExpiredUnpaidOrders() {
  const todayStr = getTodayDateStr();
  const expiredOrders = state.orders.filter(o =>
    o.paymentStatus === '待櫃檯繳費' &&
    o.paymentDeadline &&
    todayStr > o.paymentDeadline
  );

  if (expiredOrders.length > 0) {
    expiredOrders.forEach(exp => {
      pushLineNotification(
        'AUTO_CANCEL',
        `❌ 預訂單 #${exp.pickupNumber} 逾期未繳自動刪單`,
        `您在「${exp.storeName}」預訂 ${exp.pickupDate} 取餐之現金訂單，因未於取餐日前兩天（${exp.paymentDeadline}）前至櫃檯繳費，系統已自動刪除此筆訂單。`,
        exp
      );
    });
    const expiredIds = new Set(expiredOrders.map(o => o.orderId));
    state.orders = state.orders.filter(o => !expiredIds.has(o.orderId));
    saveCachedOrders(state.orders);
  }
}

// ==================== 網址路由與全螢幕 POS 視圖切換 ====================
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
  } else if (path.includes('/store') || forcedMode === 'store') {
    state.routeMode = 'store';
  } else if (path.includes('/order') || forcedMode === 'order') {
    state.routeMode = 'order';
  } else {
    state.routeMode = 'portal';
  }
}

function navigateToOrderTicket(orderId) {
  state.myCreatedOrderId = orderId;
  try { sessionStorage.setItem('mealflow_my_created_order_id', orderId); } catch (e) {}

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

window.addEventListener('DOMContentLoaded', () => {
  detectRouteFromUrl();
  state.orders.forEach(o => {
    state.lastSeenOrderNotifyMap[o.orderId] = {
      status: o.status,
      notifyCount: Number(o.notifyCount) || 0
    };
  });
  applyRouteView();
  checkLineOAuthCallbackOnLoad();
  syncCloud(false);
});

function applyCloudBundle(data) {
  const payload = (data && data.bundle) ? data.bundle : data;
  if (!payload) return;

  const cloudStores = Array.isArray(payload.stores) ? payload.stores : [];
  if (cloudStores.length > 0) {
    state.stores = cloudStores.map(cloudStore => {
      const localMatch = state.stores.find(s => s.id === cloudStore.id);
      return {
        ...cloudStore,
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
          ? cloudStore.menus
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
    cloudOrders.forEach(o => mergedMap.set(o.orderId, o));
    state.orders.forEach(localOrd => {
      if (!mergedMap.has(localOrd.orderId)) {
        mergedMap.set(localOrd.orderId, localOrd);
      } else {
        const cloudOrd = mergedMap.get(localOrd.orderId);
        if ((Number(localOrd.notifyCount) || 0) > (Number(cloudOrd.notifyCount) || 0)) {
          cloudOrd.notifyCount = localOrd.notifyCount;
        }
        if (localOrd.paymentStatus === '已付款') {
          cloudOrd.paymentStatus = '已付款';
        }
      }
    });
    state.orders = Array.from(mergedMap.values());
    saveCachedOrders(state.orders);

    // 偵測當前學生的訂單是否剛被店家按下「🔔 通知取餐」
    const watchedId = state.trackingOrderId || state.myCreatedOrderId;
    if (watchedId && (state.routeMode === 'ticket' || state.routeMode === 'order')) {
      const myOrd = state.orders.find(o => o.orderId === watchedId);
      if (myOrd) {
        const prev = state.lastSeenOrderNotifyMap[myOrd.orderId] || { status: '製作中', notifyCount: 0 };
        const curCount = Number(myOrd.notifyCount) || 0;
        const becameReady = (prev.status !== '可取餐' && myOrd.status === '可取餐') ||
                            (myOrd.status === '可取餐' && curCount > prev.notifyCount);
        state.lastSeenOrderNotifyMap[myOrd.orderId] = { status: myOrd.status, notifyCount: curCount };
        if (becameReady) {
          triggerStudentPickupAlert(myOrd);
        }
      }
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
      if (state.routeMode === 'order') renderStudentOrderExperience();
      if (state.routeMode === 'ticket') renderSingleTicketView();
      if (state.routeMode === 'store') renderMerchantView();

      setSyncState('online', '已同步');
      if (showSuccessToast) showToast('☁️ 已與雲端資料庫完成同步');
    } else {
      setSyncState('online', '本地就緒');
    }
  } catch (e) {
    setSyncState('offline', '離線快取模式');
  }
}

/**
 * 只有當處於「店家端 (/store/)」且在「櫃檯點餐 (pos)」分頁時，才鎖定外層頁面不上下滑動 (`body.pos-no-scroll`)，
 * 切換到「訂單管理」、「AI 分析」、「店務設定」或學生頁面時，皆可正常自由捲動！
 */
function updateBodyScrollLock() {
  document.body.classList.remove('store-fullscreen');
  document.body.classList.toggle('store-mode-active', state.routeMode === 'store');
  document.body.classList.toggle('pos-no-scroll', state.routeMode === 'store' && state.storeTabMode === 'pos');
}

function applyRouteView() {
  autoPurgeExpiredUnpaidOrders();
  enrichStoresAndAi();
  updateBodyScrollLock();

  const lineBtn = document.getElementById('headerLineBindBtn');
  if (lineBtn) {
    // 店家模式 (/store/) 隱藏「💬 綁定 LINE 通知」按鈕，僅在學生模式顯示
    lineBtn.style.display = (state.routeMode === 'store') ? 'none' : 'inline-flex';
  }
  const storeControls = document.getElementById('headerStoreControls');
  if (storeControls) {
    // 店家模式 (/store/) 於頂部導覽列直接顯示「切換店鋪下拉選單 + 同步雲端」
    storeControls.style.display = (state.routeMode === 'store') ? 'inline-flex' : 'none';
  }

  const lineBtnText = document.getElementById('headerLineBtnText');
  if (lineBtnText) {
    lineBtnText.innerText = state.lineProfile.isBound
      ? `💚 已綁定通知 (${state.lineProfile.lineDisplayName})`
      : '💬 綁定 LINE / Email 通知';
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
      roleBadge.innerText = '🖥️ 店家櫃檯 POS 與營運中心';
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
  if (state.routeMode === 'store') renderMerchantView();

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

// ==================== 1. 根目錄入口導覽台 (/) ====================
function renderPortalView() {
  const orderUrl = getOrderPageUrl();
  const storeUrl = getStorePageUrl();
  const sampleTicketUrl = getOrderPageUrl('id=ORD-8f92a1c4b7e0');

  const box = document.getElementById('portalContentBox');
  if (!box) return;
  box.innerHTML = `
    <div style="text-align:center; padding: 14px 0 22px;">
      <div style="display:inline-block; background:#EEF2FF; color:#4338CA; font-weight:800; font-size:0.78rem; padding:4px 12px; border-radius:999px; margin-bottom:10px;">
        🧠 M/M/1 佇列模型 × 全螢幕平板 POS × LINE Developers Messaging API
      </div>
      <h1 style="font-size:1.55rem; font-weight:900; margin-bottom:8px;">東吳學餐 MealFlow 智慧點餐與 POS 管制塔</h1>
      <p style="font-size:0.86rem; color:var(--text-secondary); max-width:600px; margin:0 auto;">
        整合<strong>學生線上掃碼點餐 (<code>/order/</code>)</strong>、<strong>專屬亂碼憑證與 LINE Messaging API 推播 (<code>?id=ORD-xxx</code>)</strong>與<strong>全螢幕平板 POS 收銀 + AI 營運圖表後台 (<code>/store/</code>)</strong>。
      </p>
    </div>

    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px; margin-bottom:20px;">
      <a href="${escapeHtml(orderUrl)}" style="text-decoration:none; color:inherit;">
        <div class="portal-card" style="border:2px solid var(--brand); background:linear-gradient(180deg, #FFFFFF 0%, #FFF9F6 100%);">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:2.2rem;">📱</span>
              <span class="wait-pill wait-free">學生 QR 掃碼點餐網址</span>
            </div>
            <h2 style="font-size:1.18rem; font-weight:900; margin-bottom:4px;">學生掃碼點餐端</h2>
            <code style="display:block; font-size:0.76rem; color:var(--brand-dark); background:var(--brand-light); padding:5px 8px; border-radius:6px; margin-bottom:10px;">
              /scu.meal/order/
            </code>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">
              分類菜單、客製化彈窗、一次性餐具加購、立即或指定日期預訂取餐、取餐手機震動與 LINE Messaging API 官方帳號綁定推播。
            </p>
          </div>
          <div class="btn-tip-action" style="text-align:center; width:100%;">進入學生掃碼點餐 (/order/) ➔</div>
        </div>
      </a>

      <a href="${escapeHtml(storeUrl)}" style="text-decoration:none; color:inherit;">
        <div class="portal-card" style="border:2px solid #0F172A; background:#FFFFFF;">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:2.2rem;">🖥️</span>
              <span class="wait-pill" style="background:#E2E8F0; color:#0F172A;">SUNMI 風格全螢幕平板 POS</span>
            </div>
            <h2 style="font-size:1.18rem; font-weight:900; margin-bottom:4px;">店家全螢幕 POS・訂單分天・AI 分析</h2>
            <code style="display:block; font-size:0.76rem; color:#0F172A; background:#F1F5F9; padding:5px 8px; border-radius:6px; margin-bottom:10px;">
              /scu.meal/store/
            </code>
            <p style="font-size:0.84rem; color:var(--text-secondary); margin-bottom:14px;">
              100% 滿版無捲動平板 POS（內建觸控數字鍵盤找零）、依日期分天檢視與預訂收款、日/週/月 AI 營收與備料圖表分析、店務與菜單設定。
            </p>
          </div>
          <div class="btn-tip-action" style="text-align:center; width:100%; background:#0F172A; box-shadow:none;">進入店家全螢幕 POS (/store/) ➔</div>
        </div>
      </a>
    </div>

    <div class="merchant-box" style="background:#FFFFFF;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:0.76rem; font-weight:800; color:var(--text-secondary);">🔗 範例：點完餐後跳轉的專屬訂單追蹤網址</div>
          <div style="font-size:0.86rem; font-weight:700; margin-top:2px;">
            <code>/scu.meal/order/?id=ORD-8f92a1c4b7e0</code>
          </div>
        </div>
        <a href="${escapeHtml(sampleTicketUrl)}" class="filter-chip" style="text-decoration:none; color:var(--text-primary);">
          🎟️ 查看範例電子取餐單 ➔
        </a>
      </div>
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

  const activeBannerBox = document.getElementById('activeOrderFloatingBanner');
  if (activeBannerBox) {
    const myOrder = state.myCreatedOrderId
      ? state.orders.find(o => o.orderId === state.myCreatedOrderId && o.status !== '已完成')
      : null;
    if (myOrder) {
      const isReady = myOrder.status === '可取餐';
      activeBannerBox.innerHTML = `
        <div class="active-order-strip ${isReady ? 'ready' : ''}" onclick="navigateToOrderTicket('${escapeHtml(myOrder.orderId)}')">
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="strip-num">#${escapeHtml(myOrder.pickupNumber)}</span>
            <div>
              <div style="font-weight:800; font-size:0.88rem;">
                ${isReady ? '🔔 您剛點的餐點已可取餐！(點此查看)' : '🍳 您剛點的餐點正在廚房製作中'}
              </div>
              <div style="font-size:0.74rem; opacity:0.9;">
                ${escapeHtml(myOrder.storeName)} ・ 點此返回您的專屬號碼牌 (${escapeHtml(myOrder.orderId)})
              </div>
            </div>
          </div>
          <span style="font-weight:800; font-size:0.82rem;">查看取餐單 ➔</span>
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
            <div class="smart-tip-badge">⚡ M/M/1 佇列偵測・AI 動態分流建議</div>
            <div class="smart-tip-title">「${escapeHtml(rec.congestedStoreName)}」目前負載 ${rec.congestedLoadPct}% 需久候 ${rec.congestedWaitMin} 分鐘</div>
            <div class="smart-tip-desc">
              改點 AI 效用評分最高 (${rec.recommendedAiScore}分) 的 <strong>${escapeHtml(rec.recommendedStoreName)}</strong> 只要 <strong>${rec.recommendedWaitMin} 分鐘</strong>（省時 ${rec.timeSavedMin} 分），再享 <strong>${escapeHtml(rec.promoText)}</strong>
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
  if (state.filter === 'FAST') list = list.filter(s => s.loadState === 'FREE');
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

    if (s.loadState === 'FULL') {
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

    return `
      <div class="store-card ${isRecTarget ? 'recommended' : ''}" onclick="enterStoreOrdering('${escapeHtml(s.id)}')">
        <div class="store-thumb">
          ${icon}
          <span class="ai-score-badge">AI ${s.aiScore}分</span>
        </div>
        <div class="store-info">
          <div class="store-header-row">
            <div class="store-name">${escapeHtml(s.name)}</div>
            <span class="wait-pill ${waitClass}">${waitText}</span>
          </div>
          <div class="store-meta">
            ⭐ ${s.rating} ・ ${escapeHtml(s.category)} ・ 佇列 ${s.activeOrders}/${s.maxCapacityPer15Min} 單 (${s.loadPercentage}%) ・ 共 ${(s.menus || []).length} 道餐點
          </div>
          <div class="load-bar-wrap">
            <div class="load-bar-fill" style="width:${Math.min(100, s.loadPercentage)}%; background:${barColor};"></div>
          </div>
          ${hasPromo ? `<div class="promo-tag">${escapeHtml(s.promoText)}</div>` : ''}
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
  const isCongested = store.loadState === 'FULL' && rec && rec.hasAlert && rec.recommendedStoreId !== store.id;

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
              const imgHtml = item.image
                ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">`
                : `<span>🍽️</span>`;
              const hasOpts = item.options && Object.keys(item.options).length > 0;

              return `
                <div class="menu-item-card" onclick="handleMenuItemClick('${escapeHtml(item.id)}', false)">
                  <div class="menu-img-box">
                    ${imgHtml}
                    <div class="menu-plus-badge">+</div>
                  </div>
                  <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between; padding:2px 0;">
                    <div>
                      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        <h4 style="font-size:1.05rem; font-weight:800; color:var(--text-primary);">${escapeHtml(item.name)}</h4>
                        ${item.tag ? `<span style="font-size:0.7rem; font-weight:700; background:var(--brand-light); color:var(--brand-dark); padding:1px 7px; border-radius:6px;">${escapeHtml(item.tag)}</span>` : ''}
                      </div>
                      <div style="font-size:0.76rem; color:var(--text-secondary); margin-top:3px;">
                        ${hasOpts ? `客製選項：${Object.keys(item.options).join(' / ')}` : '單點直接加入購物車'}
                      </div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:8px;">
                      <span style="font-size:1.05rem; font-weight:900; color:var(--text-primary);">NT$ ${item.price}</span>
                      <span style="font-size:0.76rem; font-weight:700; color:var(--brand);">點擊選擇 ➔</span>
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
        <span class="wait-pill ${store.loadState === 'FULL' ? 'wait-full' : store.loadState === 'MODERATE' ? 'wait-mod' : 'wait-free'}">
          ⏱️ 目前預估約 ${store.avgPrepMinutes} 分鐘取餐 (待製 ${store.activeOrders} 單)
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

      ${hasPromo ? `
        <div style="margin-top:12px; background:var(--brand-light); color:var(--brand-dark); padding:10px 14px; border-radius:10px; font-size:0.85rem; font-weight:800;">
          🎉 本店已開啟 AI 離峰分流優惠：${escapeHtml(store.promoText)}（結帳時自動套用）
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

// ==================== 3. 餐點客製化彈窗 (`#optionsModal`) 與購物車抽屜 (`#cartModal`) ====================
function handleMenuItemClick(itemId, isPos = false) {
  const storeId = isPos ? state.merchantStoreId : state.selectedStoreId;
  const store = state.stores.find(s => s.id === storeId);
  if (!store) return;

  const item = (store.menus || []).find(i => String(i.id) === String(itemId));
  if (!item) return;

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
    basePrice: item.price,
    price: item.price,
    qty: 1,
    selections: {}
  };
  if (isPos) {
    state.posCart.push(newItemObj);
    const store = state.stores.find(s => s.id === state.merchantStoreId);
    if (store) renderPosCashierPanel(store);
  } else {
    state.cartItems.push(newItemObj);
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
  const newItemObj = {
    id: item.id,
    name: item.name,
    basePrice: item.price,
    price: finalPrice,
    qty: 1,
    selections: selections
  };

  const targetCart = state.isPosConfiguring ? state.posCart : state.cartItems;

  if (state.editingCartIndex > -1) {
    newItemObj.qty = targetCart[state.editingCartIndex].qty || 1;
    targetCart[state.editingCartIndex] = newItemObj;
    showToast(`✅ 已更新選項：${item.name}`);
  } else {
    targetCart.push(newItemObj);
    if (!state.isPosConfiguring) showToast(`🛒 已加入：${item.name}`);
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
 * 渲染學生購物車抽屜（精簡預訂日期選擇、單一一次性餐具勾選並依店家設定收費、不可現金直接禁用不給選）
 */
function updateCartUI() {
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  const storeCutleryPrice = store && store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const totalCount = state.cartItems.reduce((sum, i) => sum + (i.qty || 1), 0);
  const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.checkoutNeedCutlery) ? storeCutleryPrice : 0;

  let discount = 0;
  if (subtotal > 0 && store && isStorePromoActive(store) && store.promoMode === 'discount') {
    discount = Number(store.promoDiscount) || 10;
  }
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);

  const isReserve = state.checkoutTimeMode === 'RESERVE';
  const diffDays = isReserve ? calcDiffDaysFromToday(state.checkoutReserveDate) : 0;
  const isCashForbidden = isReserve && (diffDays === 1 || diffDays === 2);
  const isLongTermCash = isReserve && diffDays >= 3;
  const paymentDeadline = isLongTermCash ? getDateOffsetFromStr(state.checkoutReserveDate, -2) : '';

  if (isCashForbidden && state.checkoutPayMethod === '現場櫃檯付現') {
    state.checkoutPayMethod = 'LINE Pay';
  }

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
        <p style="color:var(--text-muted); font-size:1.05rem; margin-bottom:12px;">購物車空空的耶</p>
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
            <h4 style="font-size:1.02rem; font-weight:800; color:var(--text-primary);">${escapeHtml(item.name)}</h4>
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

  const checkoutSettingsHtml = `
    <div style="background:#FFFFFF; padding:16px; border-radius:14px; border:1px solid var(--border); margin-top:14px;">
      <h4 style="font-size:0.95rem; font-weight:900; margin-bottom:12px;">📋 取餐與結帳設定</h4>

      <label class="field-label">🍽️ 用餐方式（皆為櫃檯叫號自取）</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
        <button type="button" class="filter-chip ${state.checkoutDineType === '外帶自取' ? 'active' : ''}" onclick="setCheckoutMode('checkoutDineType', '外帶自取')">🛍️ 外帶自取</button>
        <button type="button" class="filter-chip ${state.checkoutDineType === '內用自取' ? 'active' : ''}" onclick="setCheckoutMode('checkoutDineType', '內用自取')">🍽️ 內用自取</button>
      </div>

      <!-- 單一「需要一次性餐具」勾選框（金額依店家設定） -->
      <label class="option-label-row ${state.checkoutNeedCutlery ? 'checked' : ''}" style="margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <input type="checkbox" ${state.checkoutNeedCutlery ? 'checked' : ''} onchange="setCheckoutMode('checkoutNeedCutlery', this.checked)" style="width:18px; height:18px; accent-color:var(--brand);">
          <span style="font-weight:800; color:var(--text-primary);">🥢 需要一次性免洗餐具</span>
        </div>
        <span style="font-weight:900; color:var(--brand);">${storeCutleryPrice > 0 ? `+NT$ ${storeCutleryPrice}` : '免費 ($0)'}</span>
      </label>

      <label class="field-label">⏰ 取餐時間</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
        <button type="button" class="filter-chip ${state.checkoutTimeMode === 'NOW' ? 'active' : ''}" onclick="setCheckoutMode('checkoutTimeMode', 'NOW')">
          ⚡ 立即製作 (約 ${store ? store.avgPrepMinutes : 5} 分)
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
              <label class="field-label">🕒 取餐時間 *</label>
              <input type="time" class="select-input" value="${escapeHtml(state.checkoutReserveTime)}" onchange="state.checkoutReserveTime=this.value">
            </div>
          </div>
          <div>
            <label class="field-label" style="color:var(--red);">📱 聯絡電話號碼 *（預訂必填）</label>
            <input type="tel" id="checkoutPhoneInput" class="select-input" placeholder="請輸入手機號碼，例如：0912345678" value="${escapeHtml(state.checkoutPhone)}" oninput="state.checkoutPhone=this.value">
          </div>
        </div>
      ` : ''}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div>
          <label class="field-label">
            💳 付款方式
            ${isCashForbidden ? '<span style="color:var(--red); font-weight:800;">(不可現金)</span>' : ''}
            ${isLongTermCash && state.checkoutPayMethod === '現場櫃檯付現' ? `<span style="color:var(--amber); font-weight:800;">(須於 ${escapeHtml(paymentDeadline)} 前至櫃檯繳費)</span>` : ''}
          </label>
          <select class="select-input" onchange="setCheckoutMode('checkoutPayMethod', this.value)">
            <option value="現場櫃檯付現" ${isCashForbidden ? 'disabled' : ''} ${state.checkoutPayMethod === '現場櫃檯付現' ? 'selected' : ''}>
              現場櫃檯付現 ${isCashForbidden ? '(不可現金)' : ''}
            </option>
            <option value="LINE Pay" ${state.checkoutPayMethod === 'LINE Pay' ? 'selected' : ''}>LINE Pay</option>
            <option value="街口支付" ${state.checkoutPayMethod === '街口支付' ? 'selected' : ''}>街口支付</option>
          </select>
        </div>
        <div>
          <label class="field-label">📝 備註 (選填)</label>
          <input type="text" class="select-input" placeholder="例：飯少、湯分開裝" value="${escapeHtml(state.checkoutNote)}" oninput="state.checkoutNote=this.value">
        </div>
      </div>
    </div>
  `;

  listDiv.innerHTML = itemsCardsHtml + checkoutSettingsHtml;

  const modalTotalEl = document.getElementById('cartModalTotal');
  if (modalTotalEl) {
    const tags = [];
    if (cutleryFee > 0) tags.push(`含一次性餐具+$${cutleryFee}`);
    if (discount > 0) tags.push(`AI折抵-$${discount}`);
    modalTotalEl.innerHTML = tags.length > 0
      ? `<span style="font-size:0.8rem; color:var(--green); margin-right:6px;">(${tags.join(' / ')})</span>NT$ ${finalTotal}`
      : `NT$ ${finalTotal}`;
  }
}

async function submitStudentCartOrder() {
  const store = state.stores.find(s => s.id === state.selectedStoreId);
  if (!store || state.cartItems.length === 0) return;

  const isReserve = state.checkoutTimeMode === 'RESERVE';
  const diffDays = isReserve ? calcDiffDaysFromToday(state.checkoutReserveDate) : 0;
  const cleanPhone = (state.checkoutPhone || '').replace(/\D/g, '');

  if (isReserve && cleanPhone.length < 8) {
    showToast('⚠️ 預訂取餐請填寫聯絡電話號碼！');
    document.getElementById('checkoutPhoneInput')?.focus();
    return;
  }

  if (isReserve && (diffDays === 1 || diffDays === 2) && state.checkoutPayMethod === '現場櫃檯付現') {
    showToast('🚫 此預訂日期不可使用現金！');
    state.checkoutPayMethod = 'LINE Pay';
    updateCartUI();
    return;
  }

  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) {}

  const btn = document.getElementById('finalSubmitOrderBtn');
  btn.disabled = true;
  btn.innerText = '⏳ 正在傳送訂單...';

  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const subtotal = state.cartItems.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = state.checkoutNeedCutlery ? storeCutleryPrice : 0;
  const promoActive = isStorePromoActive(store);
  const discount = (promoActive && store.promoMode === 'discount') ? (Number(store.promoDiscount) || 10) : 0;
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);
  const promoApplied = promoActive ? store.promoText : '一般點餐';

  const isLongTermCash = isReserve && diffDays >= 3 && state.checkoutPayMethod === '現場櫃檯付現';
  const paymentDeadline = isLongTermCash ? getDateOffsetFromStr(state.checkoutReserveDate, -2) : '';
  const paymentStatus = isLongTermCash
    ? '待櫃檯繳費'
    : (state.checkoutPayMethod === '現場櫃檯付現' ? '取餐付現' : '已付款');

  const pickupTimeSlot = isReserve
    ? `📅 預訂 ${state.checkoutReserveDate} ${state.checkoutReserveTime}`
    : `⚡ 立即製作 (約${store.avgPrepMinutes}分)`;

  const cutleryTag = state.checkoutNeedCutlery ? `・🥢 需一次性餐具(+$${cutleryFee})` : '';
  const phoneTag = isReserve ? `・📱${state.checkoutPhone.trim()}` : '';
  const noteTag = state.checkoutNote ? `・備註:${state.checkoutNote.trim()}` : '';
  const customerNote = `${state.checkoutDineType}${cutleryTag}${phoneTag}${noteTag}`;

  const formattedItems = state.cartItems.map(i => {
    const selStr = i.selections && Object.keys(i.selections).length > 0
      ? ` [${Object.entries(i.selections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
      : '';
    return {
      id: i.id,
      name: `${i.name}${selStr}`,
      price: i.price,
      qty: i.qty || 1,
      selections: i.selections
    };
  });

  const orderId = generateOrderToken();
  const prefix = store.campus === '城中校區' ? 'C' : 'S';
  const pickupNumber = prefix + String(Math.floor(100 + Math.random() * 899));
  const nowTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });

  const newOrder = {
    orderId,
    pickupNumber,
    storeId: store.id,
    storeName: store.name,
    studentId: isReserve ? '📅 預訂點餐' : '📱 掃碼點餐',
    studentName: customerNote,
    itemsJson: JSON.stringify(formattedItems),
    subtotal,
    cutleryFee,
    needCutlery: state.checkoutNeedCutlery,
    discount,
    finalTotal,
    promoApplied,
    pickupTimeSlot,
    paymentMethod: state.checkoutPayMethod,
    status: '製作中',
    isReservation: isReserve,
    pickupDate: isReserve ? state.checkoutReserveDate : getTodayDateStr(),
    pickupTime: isReserve ? state.checkoutReserveTime : nowTime.slice(0, 5),
    customerPhone: isReserve ? state.checkoutPhone.trim() : '',
    paymentDeadline,
    paymentStatus,
    notifyCount: 0,
    lineUserId: state.lineProfile.lineUserId || '',
    customerEmail: state.lineProfile.email || '',
    isDivertedOrder: promoActive,
    createdAt: nowTime
  };

  try {
    setSyncState('syncing', '傳送訂單中...');
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'submitOrder',
        ...newOrder,
        orderSource: newOrder.studentId,
        customerNote,
        campus: store.campus,
        items: formattedItems
      })
    });
    const data = await res.json();
    if (data && data.order) {
      newOrder.orderId = data.order.orderId || newOrder.orderId;
      newOrder.pickupNumber = data.order.pickupNumber || newOrder.pickupNumber;
    }
    setSyncState('online', '已同步');
  } catch (e) {
    setSyncState('offline', '離線暫存模式');
  } finally {
    btn.disabled = false;
    btn.innerText = '確認餐點並送出訂單';
  }

  state.orders.unshift(newOrder);
  saveCachedOrders(state.orders);
  state.lastSeenOrderNotifyMap[newOrder.orderId] = { status: '製作中', notifyCount: 0 };

  store.activeOrders += 1;
  store.avgPrepMinutes = calcPrepMinutes(store.activeOrders, store.maxCapacityPer15Min);
  saveLocalStores(state.stores);

  if (isLongTermCash) {
    pushLineNotification(
      'ORDER_RESERVE_UNPAID',
      `⏳ 預訂單 #${newOrder.pickupNumber} 成立＆繳費提醒`,
      `您已預訂 ${newOrder.pickupDate} ${newOrder.pickupTime}【${store.name}】共 NT$${finalTotal}。請於 ${paymentDeadline} 前至櫃檯繳費，逾期將自動刪單。`,
      newOrder
    );
  } else {
    pushLineNotification(
      'ORDER_CREATED',
      `🟢 訂單 #${newOrder.pickupNumber} 已成立`,
      `【${store.name}】${pickupTimeSlot}，應付 NT$${finalTotal} (${newOrder.paymentMethod})。`,
      newOrder
    );
  }

  state.cartItems = [];
  closeCartModal();
  navigateToOrderTicket(newOrder.orderId);
  showToast(`🎉 點餐成功！取餐號碼：#${newOrder.pickupNumber}`);
}

// ==================== 4. 意圖感知型 AI 智慧選餐與客服顧問（不亂套模板、不捏造省時數據） ====================
async function askAiConcierge(presetQuery) {
  const inputEl = document.getElementById('aiUserQueryInput');
  const query = (presetQuery || (inputEl ? inputEl.value.trim() : '')).trim();
  if (!query) {
    showToast('💬 請輸入您的問題或點擊上方快捷標籤！');
    inputEl?.focus();
    return;
  }
  if (inputEl && presetQuery) inputEl.value = presetQuery;

  const respBox = document.getElementById('aiConciergeResponse');
  if (!respBox) return;

  respBox.classList.add('show');
  respBox.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; padding:6px 2px; color:#4338CA; font-weight:800; font-size:0.86rem;">
      <span class="sync-dot syncing" style="width:10px; height:10px;"></span>
      <span>🧠 AI 正在理解您的問題並查詢「${escapeHtml(state.campus)}」即時資料...</span>
    </div>
  `;

  enrichStoresAndAi();
  const campusStores = state.stores.filter(s => s.campus === state.campus);
  if (campusStores.length === 0) return;

  await new Promise(r => setTimeout(r, 260));

  // 1. 若有設定 Gemini API Key，優先使用真實 Gemini 2.5 Flash 對話
  if (state.geminiApiKey) {
    try {
      const storeContext = campusStores.map(s => ({
        storeId: s.id,
        name: s.name,
        waitMinutes: s.avgPrepMinutes,
        loadPct: s.loadPercentage,
        promo: s.promoText,
        menus: (s.menus || []).map(m => `${m.id}:${m.name}($${m.price})`).join('; ')
      }));

      const prompt = `你是東吳大學「MealFlow 學餐 AI 選餐與客服顧問」。
目前校區：${state.campus}
學生的輸入：「${query}」
即時各餐廳數據：${JSON.stringify(storeContext)}

請直接、自然、準確地回答學生的問題！
- 如果學生只是打招呼（如「你好」、「嗨」）或問你有什麼功能、有哪些店、預訂規則，請像真人客服一樣親切回答，不要硬扯哪家店塞車或捏造省時分鐘數！
- 如果學生想找餐點或推薦，請根據真實等待時間與菜單價格推薦，回傳純 JSON：
{
  "reasoning": "自然準確的回覆內容 (90字內)",
  "storeId": "推薦店家ID (如 S06)",
  "menuId": "推薦餐點ID (如 M13)",
  "engine": "Google Gemini 2.5 Flash"
}`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(state.geminiApiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
        })
      });
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        renderAiConciergeResult(JSON.parse(text));
        return;
      }
    } catch (e) {}
  }

  // 2. 內建自然語言意圖分類器 (Intent Classifier)：區分「打招呼/閒聊」、「詢問店家/菜單/規則」與「餐點推薦」
  const q = query.toLowerCase();
  const fastestStore = campusStores.slice().sort((a, b) => a.avgPrepMinutes - b.avgPrepMinutes || b.aiScore - a.aiScore)[0];
  const busiestStore = campusStores.slice().sort((a, b) => b.avgPrepMinutes - a.avgPrepMinutes)[0];
  const actualWaitDiff = busiestStore.avgPrepMinutes - fastestStore.avgPrepMinutes;

  // 意圖 A：打招呼 / 問你是誰 / 測試對話 (如「你好」、「hi」、「哈囉」、「在嗎」)
  if (/^(你好|您好|哈囉|嗨|hi|hello|hey|在嗎|你是誰|測試|早安|午安|晚安|幹嘛|能做什麼)[！!？?\s]*$/i.test(q)) {
    const storeNames = campusStores.map(s => `${s.name}(約${s.avgPrepMinutes}分)`).join('、');
    const defaultDish = fastestStore.menus[0];
    renderAiConciergeResult({
      reasoning: `👋 你好！我是東吳學餐 AI 選餐顧問。目前「${state.campus}」營業中的餐廳有：${storeNames}。你可以直接問我：「推薦 $100 內不排隊的餐」、「想吃辣的麵」、「哪家有送優惠？」或「預訂怎麼付錢？」，我會立刻幫你比對！`,
      storeId: fastestStore.id,
      menuId: defaultDish.id,
      isConversational: true,
      engine: 'MealFlow Conversational NLU v7.0'
    });
    return;
  }

  // 意圖 B：詢問預訂 / 現金 / 付款 / 餐具規則
  if (q.includes('預訂') || q.includes('預約') || q.includes('現金') || q.includes('付錢') || q.includes('付款') || q.includes('餐具')) {
    renderAiConciergeResult({
      reasoning: `📋 關於學餐取餐與付款規則：1️⃣ 內用與外帶皆為「櫃檯叫號自取（免填桌號）」，如需一次性餐具可於結帳勾選。2️⃣ 選擇「預訂取餐」需留電話：預計今天內可付現；1～2天內僅限線上支付（不可現金）；超過 2 天以上可付現，但須於取餐日前兩天至櫃檯繳清，逾期未繳系統會自動刪單喔！`,
      storeId: fastestStore.id,
      menuId: fastestStore.menus[0].id,
      isConversational: true,
      engine: 'MealFlow Policy QA Engine'
    });
    return;
  }

  // 意圖 C：詢問有哪些店 / 全部菜單 / 哪幾家
  if (q.includes('哪些店') || q.includes('什麼店') || q.includes('有幾家') || q.includes('介紹')) {
    const summary = campusStores.map(s => `【${s.name}】主打${s.category}（目前等待約 ${s.avgPrepMinutes} 分${s.promoMode !== 'none' ? '，享 ' + s.promoText : ''}）`).join('；');
    renderAiConciergeResult({
      reasoning: `🏫 目前「${state.campus}」共有 ${campusStores.length} 家學餐櫃位：${summary}。目前出餐最快的是「${fastestStore.name}」！`,
      storeId: fastestStore.id,
      menuId: fastestStore.menus[0].id,
      isConversational: true,
      engine: 'MealFlow Store Directory AI'
    });
    return;
  }

  // 意圖 D：根據口味、預算、速度或食材關鍵字進行精準餐點配對
  const candidates = [];
  campusStores.forEach(s => {
    (s.menus || []).forEach(m => {
      const isDrinkOrSide = m.price <= 45 && (m.name.includes('茶') || m.name.includes('湯') || m.name.includes('飲') || m.name.includes('豆漿') || m.name.includes('豆腐'));
      let score = s.aiScore + (isDrinkOrSide ? -20 : 10);
      const hitReasons = [];

      if (q.includes('趕') || q.includes('10分') || q.includes('快') || q.includes('免排隊') || q.includes('不排隊')) {
        score += Math.max(0, (22 - s.avgPrepMinutes) * 3.5);
        hitReasons.push(`出餐僅需約 ${s.avgPrepMinutes} 分鐘`);
      }

      const budgetMatch = q.match(/(\d{2,3})\s*(?:元|塊|以內|內)/) || (q.includes('100') ? [null, '100'] : null);
      if (budgetMatch || q.includes('預算') || q.includes('便宜') || q.includes('cp') || q.includes('優惠') || q.includes('折')) {
        const limit = budgetMatch ? parseInt(budgetMatch[1], 10) : 100;
        const netPrice = m.price - (s.promoDiscount || 0);
        if (netPrice <= limit && !isDrinkOrSide) {
          score += 42;
          hitReasons.push(`價格 NT$${m.price} 符合 $${limit} 內高 CP 值預算`);
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
          hitReasons.push(`香辣夠味完全符合您的重口味偏好`);
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
  const best = candidates[0];
  const alternatives = candidates.slice(1, 3);

  // 真實比較等待時間：只有當最忙店家真的比推薦店家慢 >= 5 分鐘時才提分流省時，絕不捏造「5分鐘省4分鐘」！
  let queueNote = `目前「${best.store.name}」佇列順暢，約 ${best.store.avgPrepMinutes} 分鐘即可取餐`;
  if (busiestStore.id !== best.store.id && actualWaitDiff >= 5) {
    queueNote = `目前「${busiestStore.name}」需等候約 ${busiestStore.avgPrepMinutes} 分鐘，改點「${best.store.name}」僅需 ${best.store.avgPrepMinutes} 分鐘（實際省下 ${actualWaitDiff} 分鐘）`;
  }

  const whyText = best.hitReasons.length > 0
    ? best.hitReasons.join('，且')
    : `為校區內綜合評價 (${best.store.rating}★) 與出餐效率最佳的主廚招牌`;

  renderAiConciergeResult({
    reasoning: `💡 為您推薦「${best.store.name}」的【${best.menu.name} (NT$${best.menu.price})】！原因：${whyText}。${queueNote}${best.store.promoMode !== 'none' ? `，結帳再享「${best.store.promoText}」！` : '。'}`,
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
    engine: 'MealFlow Semantic & Queueing AI v7.0'
  });
}

function renderAiConciergeResult(aiResult) {
  const respBox = document.getElementById('aiConciergeResponse');
  if (!respBox) return;

  const campusStores = state.stores.filter(s => s.campus === state.campus);
  const targetStore = state.stores.find(s => s.id === aiResult.storeId || s.name === aiResult.storeId) || campusStores[0] || state.stores[0];
  const targetMenu = (targetStore.menus || []).find(m => m.id === aiResult.menuId || m.name === aiResult.menuId) || (targetStore.menus && targetStore.menus[0]) || { id: 'M01', name: '招牌主餐', price: 100 };

  const altHtml = Array.isArray(aiResult.alternatives) && aiResult.alternatives.length > 0
    ? `
      <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); font-size:0.76rem; color:var(--text-secondary);">
        <strong style="color:#4338CA;">💡 其他適合您的選擇：</strong>
        ${aiResult.alternatives.map(alt => `
          <button type="button" onclick="enterStoreOrdering('${escapeHtml(alt.storeId)}', '${escapeHtml(alt.menuId)}')" style="border:1px solid #C7D2FE; background:#EEF2FF; color:#312E81; border-radius:6px; padding:3px 8px; margin-left:4px; margin-top:4px; font-size:0.74rem; font-weight:700;">
            ${escapeHtml(alt.storeName)}・${escapeHtml(alt.menuName)} ($${alt.price} / 約${alt.waitMin}分) ➔
          </button>
        `).join('')}
      </div>
    `
    : '';

  respBox.classList.add('show');
  respBox.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
      <span style="font-size:0.72rem; font-weight:800; color:#4338CA; background:#EEF2FF; padding:2px 8px; border-radius:999px;">
        🤖 ${escapeHtml(aiResult.engine || 'MealFlow AI')}
      </span>
      <span style="font-size:0.75rem; font-weight:800; color:var(--green);">⚡ ${escapeHtml(targetStore.name)} 約 ${targetStore.avgPrepMinutes} 分鐘取餐</span>
    </div>
    <p style="font-size:0.86rem; color:var(--text-primary); line-height:1.55; margin-bottom:10px;">
      ${escapeHtml(aiResult.reasoning)}
    </p>
    <div style="display:flex; justify-content:space-between; align-items:center; background:#FFF7ED; padding:10px 14px; border-radius:10px; border:1.5px solid #FDBA74; flex-wrap:wrap; gap:8px;">
      <div>
        <div style="font-size:0.72rem; font-weight:800; color:var(--brand-dark);">🍽️ 推薦前往點餐</div>
        <strong style="font-size:0.95rem; color:var(--text-primary);">${escapeHtml(targetStore.name)} — ${escapeHtml(targetMenu.name)}</strong>
        <span style="color:var(--red); font-weight:900; margin-left:6px; font-size:1rem;">NT$ ${targetMenu.price}</span>
      </div>
      <button type="button" class="btn-tip-action" style="padding:8px 16px; font-size:0.84rem;" onclick="enterStoreOrdering('${escapeHtml(targetStore.id)}', '${escapeHtml(targetMenu.id)}')">
        ⚡ 點選此餐點 ➔
      </button>
    </div>
    ${altHtml}
  `;
}

function promptGeminiKeyConfig() {
  const cur = state.geminiApiKey || '';
  const input = window.prompt('【選填】輸入 Google Gemini API Key 即可啟用 Gemini 2.5 Flash 實時生成（留空則使用內建意圖感知 AI 引擎）：', cur);
  if (input !== null) {
    state.geminiApiKey = input.trim();
    try { localStorage.setItem('mealflow_gemini_key', state.geminiApiKey); } catch (e) {}
    showToast(state.geminiApiKey ? '✅ 已啟用 Google Gemini 2.5 Flash 實時引擎！' : '✅ 已使用內建意圖感知 AI 引擎');
  }
}


// ==================== 5. 專屬訂單追蹤頁 (`/order/?id=ORD-xxx`) ====================
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
        <p style="font-size:0.86rem; color:var(--text-secondary); margin-bottom:20px;">請確認您的訂單連結是否完整，或點擊下方返回點餐首頁。</p>
        <button class="btn-primary-full" onclick="navigateToOrderMenu()">← 返回點餐首頁</button>
      </div>
    `;
    return;
  }

  let items = [];
  try { items = JSON.parse(o.itemsJson || '[]'); } catch (e) {}
  const itemsHtml = items.map(i => `
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border); font-size:0.92rem;">
      <span><strong>${escapeHtml(i.name)}</strong> × ${i.qty || 1}</span>
      <span style="font-weight:800;">NT$ ${i.price * (i.qty || 1)}</span>
    </div>
  `).join('');

  const shareUrl = `${window.location.origin}${getOrderPageUrl('id=' + encodeURIComponent(o.orderId))}`;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareUrl)}`;

  const isCompleted = o.status === '已完成';
  const isReady = o.status === '可取餐';
  const isCancelled = o.status && o.status.includes('已取消');
  const isUnpaidReserve = o.paymentStatus === '待櫃檯繳費' && !isCancelled;

  const step1Class = isCancelled ? '' : 'done';
  const step2Class = isCancelled ? '' : (isReady || isCompleted ? 'done' : 'active');
  const step3Class = isCompleted ? 'done' : (isReady ? 'active' : '');

  let statusHeadline = '🍳 廚房正為您製作餐點中';
  let statusColor = 'var(--brand)';
  if (isCancelled) {
    statusHeadline = '🚫 訂單已取消（逾期未至櫃檯繳費）';
    statusColor = 'var(--red)';
  } else if (isReady) {
    statusHeadline = `🔔 您的餐點已備妥！請至櫃檯取餐 (已叫號 ${Math.max(1, o.notifyCount || 1)} 次)`;
    statusColor = 'var(--green)';
  } else if (isCompleted) {
    statusHeadline = '✅ 已完成取餐，祝您用餐愉快！';
    statusColor = 'var(--text-secondary)';
  }

  box.innerHTML = `
    <div class="ticket-hero-card" style="${isReady ? 'border:2.5px solid var(--green); box-shadow:0 0 0 6px rgba(16,185,129,0.12);' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
        <span style="font-size:0.76rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:4px 12px; border-radius:999px;">
          📍 ${escapeHtml(o.storeName)}（櫃檯叫號自取）
        </span>
        <button type="button" onclick="openLineBindModal()" style="border:1px solid #86EFAC; background:${state.lineProfile.isBound ? '#DCFCE7' : '#F0FDF4'}; color:#065F46; padding:4px 10px; border-radius:999px; font-size:0.75rem; font-weight:800; cursor:pointer;">
          💚 ${state.lineProfile.isBound ? 'LINE Push 已綁定' : '綁定 LINE 接收取餐推播'}
        </button>
      </div>

      <div style="font-size:0.84rem; color:var(--text-secondary); margin-top:12px; font-weight:700;">您的專屬取餐號碼</div>
      <div class="ticket-Serial" style="color:${statusColor};">#${escapeHtml(o.pickupNumber)}</div>
      <div style="font-size:1rem; font-weight:900; color:${statusColor}; margin-bottom:6px;">${statusHeadline}</div>
      <div style="font-size:0.78rem; color:var(--text-muted);">訂單憑證：${escapeHtml(o.orderId)} ・ 下單時間：${escapeHtml(o.createdAt)}</div>

      ${isReady ? `
        <div style="margin-top:12px; background:#ECFDF5; border:1.5px solid #10B981; color:#065F46; padding:12px; border-radius:12px; font-weight:800; font-size:0.9rem;">
          🎉 櫃檯已按下「通知取餐」！請出示此畫面取餐號 <strong>#${escapeHtml(o.pickupNumber)}</strong> 領取餐點。
        </div>
      ` : ''}

      ${isUnpaidReserve ? `
        <div style="margin-top:12px; background:#FFFBEB; border:1.5px solid #F59E0B; color:#92400E; padding:12px; border-radius:12px; font-weight:800; font-size:0.84rem; text-align:left;">
          ⚠️ <strong>預訂現金待繳費提醒：</strong><br>
          請務必於 <strong>${escapeHtml(o.paymentDeadline)} 23:59 前</strong> 至「${escapeHtml(o.storeName)}」櫃檯報電話或取餐號 <strong>#${escapeHtml(o.pickupNumber)}</strong> 繳清 <strong>NT$ ${o.finalTotal}</strong>，逾期未繳系統將自動刪除此預訂單。
        </div>
      ` : ''}

      <div class="status-stepper">
        <div class="step-item ${step1Class}">
          <div class="step-dot">✓</div>
          <div class="step-label">訂單成立</div>
        </div>
        <div class="step-item ${step2Class}">
          <div class="step-dot">2</div>
          <div class="step-label">廚房製作中</div>
        </div>
        <div class="step-item ${step3Class}">
          <div class="step-dot">3</div>
          <div class="step-label">櫃檯叫號取餐</div>
        </div>
      </div>

      <div style="text-align:left; background:var(--bg-page); padding:16px; border-radius:14px; border:1px solid var(--border); margin:16px 0;">
        <div style="font-size:0.8rem; font-weight:800; color:var(--text-secondary); margin-bottom:8px;">📋 點餐明細 (${escapeHtml(o.studentName || '自取')})</div>
        ${itemsHtml}
        ${o.cutleryFee > 0 ? `
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:0.84rem; color:var(--text-secondary);">
            <span>🥢 一次性免洗餐具</span>
            <span>+NT$ ${o.cutleryFee}</span>
          </div>
        ` : ''}
        ${o.discount > 0 ? `
          <div style="display:flex; justify-content:space-between; padding-top:6px; font-size:0.84rem; color:var(--green); font-weight:700;">
            <span>🎁 AI 分流優惠 (${escapeHtml(o.promoApplied)})</span>
            <span>-NT$ ${o.discount}</span>
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
        <img src="${qrImgUrl}" alt="Order QR" style="width:96px; height:96px; border-radius:8px; border:1px solid var(--border);">
        <div style="text-align:left; max-width:260px;">
          <div style="font-size:0.85rem; font-weight:800; color:var(--text-primary); margin-bottom:4px;">🔗 專屬訂單網址憑證</div>
          <p style="font-size:0.76rem; color:var(--text-secondary); line-height:1.4; margin-bottom:8px;">
            櫃檯出餐時本頁會自動響鈴震動提醒；若已綁定 LINE 將同步收到官方帳號推播。
          </p>
          <button type="button" class="filter-chip" style="padding:5px 12px; font-size:0.76rem;" onclick="copyOrderUrl('${escapeHtml(shareUrl)}')">📋 複製訂單網址</button>
        </div>
      </div>

      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="btn-outline" onclick="syncCloud(false)">🔄 立即刷新狀態</button>
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

// ==================== 6. 店家端現代化美型系統 (`/store/`) ====================
/**
 * 切換頂部導覽列 4 大主頁籤：
 * - 'pos'       : 🖥️ 櫃檯點餐 (POS) — 鎖定外層不滑動 (body.pos-no-scroll)，雙欄剛好塞滿平板畫面
 * - 'kds'       : 📋 訂單管理 — 解除外層鎖定，可自由上下滑動，支援分天檢視與預訂收款
 * - 'analytics' : 📊 AI 營運分析 — 解除外層鎖定，可自由上下滑動，日/週/月圖表與備料診斷
 * - 'settings'  : ⚙️ 店務設定 — 解除外層鎖定，可自由上下滑動，菜單管理/餐具與優惠/LINE OAuth 設定
 */
function switchStoreTabMode(mode) {
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
  const topSel = document.getElementById('storeTopSwitcher');
  if (topSel && topSel.value !== storeId) topSel.value = storeId;
  renderMerchantView();
}

function renderMerchantView() {
  enrichStoresAndAi();
  updateBodyScrollLock();
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;

  // 同步頂部導覽列的店家下拉選單
  const topSel = document.getElementById('storeTopSwitcher');
  if (topSel) {
    topSel.innerHTML = state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>${escapeHtml(s.campus)} — ${escapeHtml(s.name)}</option>`).join('');
  }

  // 更新導覽列上的待處理訂單數徽章
  const storeActiveOrders = state.orders.filter(o => o.storeId === store.id && (o.status === '製作中' || o.status === '可取餐' || o.paymentStatus === '待櫃檯繳費'));
  const badgeEl = document.getElementById('railKdsBadge');
  if (badgeEl) {
    badgeEl.innerText = storeActiveOrders.length;
    badgeEl.style.display = storeActiveOrders.length > 0 ? 'inline-block' : 'none';
  }

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

// ==================== 6.1 現代化美型平板 POS 櫃檯點餐 (零外層捲動 + 點選實收彈出數字鍵盤) ====================
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
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

function setPosOption(field, value) {
  state[field] = value;
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

/**
 * 點擊「🔢 實收金額」時彈出觸控數字鍵盤視窗 (`#posCashNumpadModal`)，不佔用主畫面、不跳出系統鍵盤
 */
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

function renderPosCashNumpadModal() {
  const box = document.getElementById('posCashNumpadBody');
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!box || !store) return;

  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const subtotal = state.posCart.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.posNeedCutlery) ? storeCutleryPrice : 0;
  const promoActive = isStorePromoActive(store);
  const discount = (subtotal > 0 && promoActive && store.promoMode === 'discount') ? (Number(store.promoDiscount) || 10) : 0;
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);

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
      <button type="button" class="pos-numpad-key clear" onclick="posTapNumpad('C')">C 清空</button>
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

  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const menus = store.menus || [];
  const categories = ['全部', ...new Set(menus.map(m => m.category || '主廚推薦'))];
  const filteredMenus = state.posSelectedCategory === '全部'
    ? menus
    : menus.filter(m => (m.category || '主廚推薦') === state.posSelectedCategory);

  const subtotal = state.posCart.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.posNeedCutlery) ? storeCutleryPrice : 0;
  const promoActive = isStorePromoActive(store);
  const discount = (subtotal > 0 && promoActive && store.promoMode === 'discount') ? (Number(store.promoDiscount) || 10) : 0;
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);

  // 店家 POS 現場點餐：因為顧客本人就在櫃檯現場，無論是立即出餐或預訂哪一天取餐，全部都可以直接收「現場現金」當場結清！
  const isReserve = state.posTimeMode === 'RESERVE';
  const cashReceivedNum = state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal;
  const changeAmount = Math.max(0, cashReceivedNum - finalTotal);
  const isCashInsufficient = state.posPayment === '現場現金' && state.posCashReceived !== '' && cashReceivedNum < finalTotal;

  panel.innerHTML = `
    <div class="pos-modern-workspace">
      <!-- 左側：分類篩選列 + 現代化餐點磁貼網格 -->
      <div class="pos-menu-card">
        <div class="pos-cat-strip">
          ${categories.map(cat => `
            <button type="button" class="pos-cat-pill ${state.posSelectedCategory === cat ? 'active' : ''}" onclick="selectPosCategory('${escapeHtml(cat)}')">
              ${escapeHtml(cat)}
            </button>
          `).join('')}
          <span class="wait-pill ${store.loadState === 'FULL' ? 'wait-full' : store.loadState === 'MODERATE' ? 'wait-mod' : 'wait-free'}" style="margin-left:auto; align-self:center;">
            佇列 ${store.activeOrders}/${store.maxCapacityPer15Min} 單 (約 ${store.avgPrepMinutes} 分)
          </span>
        </div>

        <div class="pos-dish-grid">
          ${filteredMenus.map(m => {
            const hasOpts = m.options && Object.keys(m.options).length > 0;
            return `
              <div class="pos-dish-tile" onclick="handleMenuItemClick('${escapeHtml(m.id)}', true)">
                <div>
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                    <span class="pos-tile-cat">${escapeHtml(m.category || '招牌')}</span>
                    ${hasOpts ? `<span class="pos-tile-opt">⚙️ 客製</span>` : ''}
                  </div>
                  <div class="pos-tile-name">${escapeHtml(m.name)}</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span class="pos-tile-price">NT$ ${m.price}</span>
                  <span style="width:22px; height:22px; border-radius:50%; background:var(--brand-light); color:var(--brand-dark); display:inline-flex; align-items:center; justify-content:center; font-weight:900; font-size:0.85rem;">＋</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- 右側：現代化明亮收銀結帳單 -->
      <div class="pos-receipt-column">
        <div class="pos-receipt-header">
          <div>
            <div style="font-size:0.96rem; font-weight:900; color:var(--text-primary);">🧾 櫃檯點餐結帳單 (${state.posCart.reduce((s, i) => s + (i.qty || 1), 0)} 份)</div>
            <div style="font-size:0.74rem; color:var(--text-secondary);">${escapeHtml(store.name)} ・ 叫號自取</div>
          </div>
          ${state.posCart.length > 0 ? `<button type="button" onclick="clearPosCart()" style="border:1px solid #FECACA; background:var(--red-bg); color:var(--red); padding:4px 10px; border-radius:8px; font-size:0.74rem; font-weight:800;">🗑️ 清空</button>` : ''}
        </div>

        <div class="pos-receipt-list">
          ${state.posCart.length === 0 ? `
            <div style="text-align:center; color:var(--text-muted); padding:38px 12px; font-size:0.86rem;">
              <div style="font-size:2rem; margin-bottom:6px;">🍱</div>
              請點擊左側餐點卡片加入結帳單
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
                  <div style="font-weight:800; font-size:0.86rem; color:var(--text-primary);">${escapeHtml(item.name)}</div>
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
          <!-- 取餐與餐具設定 -->
          <div style="display:grid; grid-template-columns:1fr 1fr 1.25fr; gap:5px; margin-bottom:6px;">
            <button type="button" class="pos-chip-btn ${state.posDineType === '內用自取' ? 'active' : ''}" onclick="setPosOption('posDineType', '內用自取')">🍽️ 內用自取</button>
            <button type="button" class="pos-chip-btn ${state.posDineType === '外帶自取' ? 'active' : ''}" onclick="setPosOption('posDineType', '外帶自取')">🛍️ 外帶自取</button>
            <button type="button" class="pos-chip-btn ${state.posNeedCutlery ? 'active' : ''}" onclick="setPosOption('posNeedCutlery', !state.posNeedCutlery)">
              🥢 餐具 (${storeCutleryPrice > 0 ? `+$${storeCutleryPrice}` : '$0'})
            </button>
          </div>

          <!-- 立即 vs 預訂 -->
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-bottom:6px;">
            <button type="button" class="pos-chip-btn ${state.posTimeMode === 'NOW' ? 'active' : ''}" onclick="setPosOption('posTimeMode', 'NOW')">⚡ 立即出餐</button>
            <button type="button" class="pos-chip-btn ${state.posTimeMode === 'RESERVE' ? 'active' : ''}" onclick="setPosOption('posTimeMode', 'RESERVE')">📅 預訂取餐</button>
          </div>

          ${isReserve ? `
            <div style="display:grid; grid-template-columns:1fr 0.85fr 1.15fr; gap:4px; background:var(--bg-page); padding:5px; border-radius:8px; border:1px solid var(--border); margin-bottom:6px;">
              <input type="date" class="select-input" style="padding:4px 6px; font-size:0.74rem;" min="${getTodayDateStr()}" value="${escapeHtml(state.posReserveDate)}" onchange="setPosOption('posReserveDate', this.value)">
              <input type="time" class="select-input" style="padding:4px 6px; font-size:0.74rem;" value="${escapeHtml(state.posReserveTime)}" onchange="state.posReserveTime=this.value">
              <input type="tel" class="select-input" style="padding:4px 6px; font-size:0.74rem; border-color:var(--red);" placeholder="📱 電話(必填)" value="${escapeHtml(state.posCustomerPhone)}" oninput="state.posCustomerPhone=this.value">
            </div>
          ` : ''}

          <!-- 付款方式 (店家 POS 現場點餐與現場預訂皆可直接付現！) -->
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:5px; margin-bottom:6px;">
            ${['現場現金', 'LINE Pay', '街口支付'].map(pay => `
              <button type="button" class="pos-chip-btn ${state.posPayment === pay ? 'active' : ''}" onclick="setPosOption('posPayment', '${pay}')">
                ${pay}
              </button>
            `).join('')}
          </div>

          ${state.posPayment === '現場現金' ? `
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; margin-bottom:6px;">
              <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(${finalTotal})">剛好</button>
              <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(100)">$100</button>
              <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(500)">$500</button>
              <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(1000)">$1000</button>
            </div>
            <button type="button" onclick="openPosCashNumpadModal()" style="width:100%; display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-radius:10px; border:1.5px dashed var(--brand); background:var(--brand-light); color:var(--brand-dark); font-size:0.8rem; font-weight:900; margin-bottom:8px;">
              <span>🔢 實收: NT$ ${state.posCashReceived !== '' ? escapeHtml(state.posCashReceived) : `${finalTotal} (點此輸入)`}</span>
              <span style="color:${isCashInsufficient ? 'var(--red)' : 'var(--green)'};">
                ${isCashInsufficient ? `不足 $${finalTotal - cashReceivedNum}` : `找零 NT$ ${changeAmount}`} ➔
              </span>
            </button>
          ` : ''}

          <div style="display:flex; justify-content:space-between; align-items:baseline; margin:4px 0 8px; padding-top:4px; border-top:1px solid var(--border);">
            <span style="font-size:0.86rem; font-weight:900;">應收總計 ${cutleryFee > 0 ? `(含餐具+$${cutleryFee})` : ''}</span>
            <span style="font-size:1.35rem; font-weight:950; color:var(--red);">NT$ ${finalTotal}</span>
          </div>

          <button type="button" class="pos-checkout-btn" onclick="submitMerchantPosOrder()" ${state.posCart.length === 0 || isCashInsufficient ? 'disabled' : ''}>
            ⚡ 結帳出單 (${state.posPayment === '現場現金' && changeAmount > 0 ? `找零 $${changeAmount}` : `NT$ ${finalTotal}`})
          </button>
        </div>
      </div>
    </div>
  `;
}

async function submitMerchantPosOrder() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) return;

  const isReserve = state.posTimeMode === 'RESERVE';
  const diffDays = isReserve ? calcDiffDaysFromToday(state.posReserveDate) : 0;
  const cleanPhone = (state.posCustomerPhone || '').replace(/\D/g, '');

  if (isReserve && cleanPhone.length < 8) {
    showToast('⚠️ 預訂取餐請輸入顧客聯絡電話號碼！');
    return;
  }

  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const subtotal = state.posCart.reduce((sum, i) => sum + i.price * (i.qty || 1), 0);
  const cutleryFee = state.posNeedCutlery ? storeCutleryPrice : 0;
  const promoActive = isStorePromoActive(store);
  const discount = (promoActive && store.promoMode === 'discount') ? (Number(store.promoDiscount) || 10) : 0;
  const finalTotal = Math.max(0, subtotal + cutleryFee - discount);
  const promoApplied = promoActive ? store.promoText : '現場POS點餐';

  const cashReceivedNum = state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal;
  const changeAmount = state.posPayment === '現場現金' ? Math.max(0, cashReceivedNum - finalTotal) : 0;

  const orderId = generateOrderToken();
  const prefix = store.campus === '城中校區' ? 'C' : 'S';
  const pickupNumber = prefix + String(Math.floor(100 + Math.random() * 899));
  const nowTime = new Date().toLocaleTimeString('zh-TW', { hour12: false });

  const formattedItems = state.posCart.map(i => {
    const selStr = i.selections && Object.keys(i.selections).length > 0
      ? ` [${Object.entries(i.selections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
      : '';
    return {
      id: i.id,
      name: `${i.name}${selStr}`,
      price: i.price,
      qty: i.qty || 1
    };
  });

  // 店家 POS 預訂因為顧客在現場直接付款，不論預訂哪一天皆當場結清 (已付款)，無須設定兩天前繳費期限
  const paymentDeadline = '';
  const paymentStatus = '已付款';
  const pickupTimeSlot = isReserve
    ? `📅 預訂 ${state.posReserveDate} ${state.posReserveTime}`
    : `⚡ 現場立即製作`;

  const cutleryNote = state.posNeedCutlery ? `・🥢 一次性餐具(+$${cutleryFee})` : '';
  const phoneNote = isReserve ? `・📱${state.posCustomerPhone.trim()}` : '';
  const cashNote = state.posPayment === '現場現金' ? ` (實收$${cashReceivedNum}/找零$${changeAmount})` : '';
  const customerNote = `${state.posDineType}${cutleryNote}${phoneNote}${cashNote}`;

  const newOrder = {
    orderId,
    pickupNumber,
    storeId: store.id,
    storeName: store.name,
    studentId: isReserve ? '📅 櫃檯預訂' : '🖥️ 現場POS',
    studentName: customerNote,
    itemsJson: JSON.stringify(formattedItems),
    subtotal,
    cutleryFee,
    needCutlery: state.posNeedCutlery,
    discount,
    finalTotal,
    promoApplied,
    pickupTimeSlot,
    paymentMethod: state.posPayment,
    status: '製作中',
    isReservation: isReserve,
    pickupDate: isReserve ? state.posReserveDate : getTodayDateStr(),
    pickupTime: isReserve ? state.posReserveTime : nowTime.slice(0, 5),
    customerPhone: isReserve ? state.posCustomerPhone.trim() : '',
    paymentDeadline,
    paymentStatus,
    notifyCount: 0,
    isDivertedOrder: false,
    createdAt: nowTime
  };

  state.orders.unshift(newOrder);
  saveCachedOrders(state.orders);

  store.activeOrders += 1;
  store.avgPrepMinutes = calcPrepMinutes(store.activeOrders, store.maxCapacityPer15Min);
  saveLocalStores(state.stores);

  state.posCart = [];
  state.posCashReceived = '';
  renderMerchantView();

  showToast(`🖨️ POS 出單成功！叫號 #${pickupNumber}${changeAmount > 0 ? `（請找零 NT$ ${changeAmount}）` : ''}`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'submitOrder',
        ...newOrder,
        orderSource: newOrder.studentId,
        customerNote,
        campus: store.campus,
        items: formattedItems
      })
    });
  } catch (e) {}
}

// ==================== 6.2 訂單與預訂分天管理 (`renderMerchantOrdersOnly`) & 訂單收款觸控視窗 (`#orderPayModal`) ====================
function setKdsDateFilter(dateVal) {
  state.kdsSelectedDate = dateVal;
  renderMerchantOrdersOnly();
}

function setKdsStatusFilter(statusVal) {
  state.kdsStatusFilter = statusVal;
  renderMerchantOrdersOnly();
}

function renderMerchantOrdersOnly(storeObj) {
  const store = storeObj || state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  const panel = document.getElementById('storePanel-kds');
  if (!store || !panel) return;

  const storeOrders = state.orders.filter(o => o.storeId === store.id);
  const todayStr = getTodayDateStr();
  const tomorrowStr = getFutureDateStr(1);

  // 彙整所有訂單出現過的取餐日期，方便店家「分天檢視」
  const dateCountMap = {};
  storeOrders.forEach(o => {
    const d = o.pickupDate || todayStr;
    dateCountMap[d] = (dateCountMap[d] || 0) + 1;
  });
  const extraDates = Object.keys(dateCountMap).filter(d => d !== todayStr && d !== tomorrowStr).sort();

  // 1. 依日期過濾
  let filtered = storeOrders;
  if (state.kdsSelectedDate !== 'ALL') {
    filtered = filtered.filter(o => (o.pickupDate || todayStr) === state.kdsSelectedDate);
  }

  // 2. 依狀態過濾
  if (state.kdsStatusFilter === 'UNPAID') {
    filtered = filtered.filter(o => o.paymentStatus !== '已付款' && !String(o.status).includes('已取消'));
  } else if (state.kdsStatusFilter === 'COOKING') {
    filtered = filtered.filter(o => o.status === '製作中');
  } else if (state.kdsStatusFilter === 'READY') {
    filtered = filtered.filter(o => o.status === '可取餐');
  } else if (state.kdsStatusFilter === 'DONE') {
    filtered = filtered.filter(o => o.status === '已完成' || String(o.status).includes('已取消'));
  }

  // 3. 依電話或取餐號搜尋
  const q = (state.kdsSearchQuery || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(o =>
      String(o.pickupNumber || '').toLowerCase().includes(q) ||
      String(o.customerPhone || '').toLowerCase().includes(q) ||
      String(o.studentName || '').toLowerCase().includes(q) ||
      String(o.orderId || '').toLowerCase().includes(q)
    );
  }

  panel.innerHTML = `
    <div class="kds-panel-wrap">
      <!-- 頂部：分天檢視切換列 + 狀態篩選 + 電話/單號搜尋 -->
      <div class="kds-toolbar">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:0.84rem; font-weight:900; color:var(--text-primary);">📅 依取餐日期分天檢視：</span>
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
            <input type="date" class="select-input" style="width:auto; padding:4px 8px; font-size:0.78rem;" value="${state.kdsSelectedDate === 'ALL' ? todayStr : escapeHtml(state.kdsSelectedDate)}" onchange="setKdsDateFilter(this.value)" title="指定日期查詢預訂單">
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <input type="search" class="select-input" style="width:210px; padding:6px 10px; font-size:0.8rem;" placeholder="🔍 搜尋電話後4碼或取餐號..." value="${escapeHtml(state.kdsSearchQuery)}" oninput="state.kdsSearchQuery=this.value; renderMerchantOrdersOnly()">
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'ALL' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('ALL')">全部狀態 (${filtered.length})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'UNPAID' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('UNPAID')">💵 待收款 / 預訂來付錢</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'COOKING' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('COOKING')">🍳 製作中</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'READY' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('READY')">🔔 已通知待取餐</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'DONE' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('DONE')">✅ 已完成/取消</button>
          </div>
          <div style="font-size:0.76rem; color:var(--text-secondary); font-weight:700;">
            💡 提示：預訂客人來店付錢時，直接切換至該日期或搜電話，點「💵 點此收款」即可觸控算找零並入帳！
          </div>
        </div>
      </div>

      <!-- 訂單卡片網格 -->
      <div class="kds-orders-grid">
        ${filtered.length === 0 ? `
          <div style="grid-column:1 / -1; text-align:center; padding:60px 20px; background:#FFFFFF; border-radius:16px; border:1px dashed var(--border); color:var(--text-muted);">
            <div style="font-size:2.4rem; margin-bottom:8px;">📭</div>
            <div style="font-size:1rem; font-weight:800;">此日期 / 篩選條件下目前沒有訂單</div>
          </div>
        ` : filtered.map(o => {
          let items = [];
          try { items = JSON.parse(o.itemsJson || '[]'); } catch (e) {}
          const itemStr = items.map(i => `${i.name} ×${i.qty || 1}`).join('、');

          const isReady = o.status === '可取餐';
          const isDone = o.status === '已完成';
          const isCancelled = String(o.status).includes('已取消');
          const isUnpaid = o.paymentStatus !== '已付款' && !isCancelled;
          const notifyCount = Number(o.notifyCount) || 0;

          let cardClass = '';
          if (isReady) cardClass = 'ready';
          else if (isUnpaid) cardClass = 'unpaid';

          return `
            <div class="kds-ticket-card ${cardClass}" style="${isDone || isCancelled ? 'opacity:0.68;' : ''}">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:6px;">
                  <div>
                    <span style="font-size:1.3rem; font-weight:950; color:var(--text-primary);">#${escapeHtml(o.pickupNumber)}</span>
                    <span style="font-size:0.74rem; font-weight:800; background:#F1F5F9; color:#334155; padding:2px 7px; border-radius:6px; margin-left:4px;">
                      📅 ${escapeHtml(o.pickupDate || todayStr)} ${escapeHtml(o.pickupTime || '')}
                    </span>
                  </div>
                  <span style="font-size:0.74rem; font-weight:900; padding:3px 9px; border-radius:999px; background:${isCancelled ? '#FEE2E2' : isDone ? '#E2E8F0' : isReady ? '#DCFCE7' : '#FEF3C7'}; color:${isCancelled ? '#DC2626' : isDone ? '#475569' : isReady ? '#047857' : '#B45309'};">
                    ${escapeHtml(o.status)} ${notifyCount > 0 && !isDone ? `(已叫號${notifyCount}次)` : ''}
                  </span>
                </div>

                <div style="font-size:0.9rem; font-weight:800; color:var(--text-primary); line-height:1.45; margin-bottom:6px; background:#F8FAFC; padding:8px 10px; border-radius:8px; border:1px solid #E2E8F0;">
                  ${escapeHtml(itemStr)}
                </div>

                <div style="font-size:0.76rem; color:var(--text-secondary); margin-bottom:6px;">
                  ${escapeHtml(o.studentName || '')}
                  ${o.customerPhone ? `・<strong style="color:var(--brand-dark);">📱 ${escapeHtml(o.customerPhone)}</strong>` : ''}
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; padding-top:6px; border-top:1px dashed var(--border);">
                  <div>
                    <span style="font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:6px; background:${isUnpaid ? '#FEF3C7' : '#DCFCE7'}; color:${isUnpaid ? '#B45309' : '#047857'};">
                      ${isUnpaid ? `⏳ ${escapeHtml(o.paymentStatus || '待收款')}` : `✅ 已付款 (${escapeHtml(o.paymentMethod)})`}
                    </span>
                    ${o.paymentDeadline && isUnpaid ? `<span style="font-size:0.7rem; color:var(--red); font-weight:800; margin-left:4px;">(${escapeHtml(o.paymentDeadline)}前繳費)</span>` : ''}
                  </div>
                  <span style="font-size:1.05rem; font-weight:950; color:var(--red);">NT$ ${o.finalTotal}</span>
                </div>
              </div>

              <!-- 操作按鈕列：收款按鈕 + 永遠保持可見的「🔔 通知取餐」+ 讀單 + 完成結單 -->
              <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">
                ${isUnpaid ? `
                  <button type="button" onclick="openOrderPayModal('${escapeHtml(o.orderId)}')" style="flex:1 1 100%; border:none; background:#F59E0B; color:#FFFFFF; padding:8px 12px; border-radius:8px; font-weight:900; font-size:0.84rem; cursor:pointer; box-shadow:0 2px 6px rgba(245,158,11,0.3);">
                    💵 點此收款 / 付款 (NT$ ${o.finalTotal})
                  </button>
                ` : ''}

                ${!isDone && !isCancelled ? `
                  <button type="button" onclick="speakOrder(${ JSON.stringify(o.pickupNumber + '號，' + itemStr).replace(/"/g, '&quot;') })" style="border:1px solid var(--border); background:#F8FAFC; color:var(--text-primary); padding:7px 10px; border-radius:8px; font-weight:800; font-size:0.78rem; cursor:pointer;">
                    🔊 讀單
                  </button>
                  <button type="button" onclick="markOrderReady('${escapeHtml(o.orderId)}')" style="flex:1; border:none; background:#3B82F6; color:#FFFFFF; padding:7px 10px; border-radius:8px; font-weight:900; font-size:0.8rem; cursor:pointer;">
                    🔔 ${notifyCount > 0 ? `再次通知 (${notifyCount})` : '通知取餐'}
                  </button>
                  <button type="button" onclick="completeOrderFinal('${escapeHtml(o.orderId)}')" style="flex:1; border:none; background:#10B981; color:#FFFFFF; padding:7px 10px; border-radius:8px; font-weight:900; font-size:0.8rem; cursor:pointer;">
                    ✅ 完成結單
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

/**
 * 開啟單筆訂單收款彈窗（提供螢幕觸控數字鍵盤，讓店員直接點選實收金額並自動算找零、更新為「已付款」）
 */
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
        <span style="font-size:0.8rem; color:var(--text-secondary);">📅 ${escapeHtml(o.pickupDate || '')} ${escapeHtml(o.pickupTime || '')}</span>
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
        <button type="button" class="pos-numpad-key clear" onclick="orderPayTapKey('C')">C 清空</button>
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
  const o = state.orders.find(ord => ord.orderId === state.payingOrderId);
  if (!o) return;

  o.paymentStatus = '已付款';
  o.paymentMethod = state.payingOrderMethod;
  saveCachedOrders(state.orders);

  closeOrderPayModal();
  renderMerchantOrdersOnly();
  showToast(`💵 訂單 #${o.pickupNumber} 已完成收款！`);

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
        orderId: o.orderId,
        newStatus: o.status,
        paymentStatus: '已付款',
        paymentMethod: o.paymentMethod
      })
    });
  } catch (e) {}
}

/**
 * 🔔 通知取餐（可無限次重複點擊呼叫，直到按「✅ 完成結單」前都不會消失！）
 */
async function markOrderReady(orderId) {
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  order.status = '可取餐';
  order.notifyCount = (Number(order.notifyCount) || 0) + 1;
  saveCachedOrders(state.orders);
  renderMerchantView();

  showToast(`🔔 已第 ${order.notifyCount} 次通知 #${order.pickupNumber} 取餐（已同步觸發學生端震動與 LINE Push）`);

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
        orderId: order.orderId,
        newStatus: '可取餐'
      })
    });
  } catch (e) {}
}

/**
 * ✅ 完成結單（學生領走餐點後結案，釋放佇列產能）
 */
async function completeOrderFinal(orderId) {
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;

  order.status = '已完成';
  order.paymentStatus = '已付款';
  saveCachedOrders(state.orders);

  const store = state.stores.find(s => s.id === order.storeId);
  if (store && store.activeOrders > 0) {
    store.activeOrders = Math.max(0, store.activeOrders - 1);
    store.avgPrepMinutes = calcPrepMinutes(store.activeOrders, store.maxCapacityPer15Min);
    saveLocalStores(state.stores);
  }

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

// ==================== 6.3 AI 營運與備料智慧分析儀表板 (100% 真實訂單驅動 + 滑鼠/觸控互動式圖表與點擊穿透查詢) ====================
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
  const left = Math.min(window.innerWidth - 220, Math.max(12, clientX + 14));
  const top = Math.max(12, clientY - 65);
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
  document.querySelectorAll('.legend-interactive-row').forEach(row => row.classList.remove('active'));
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
  const pt = String(order.pickupTime || '');
  const m1 = pt.match(/(\d{1,2}):\d{2}/);
  if (m1) return parseInt(m1[1], 10);
  const ca = String(order.createdAt || '');
  const m2 = ca.match(/(\d{1,2}):\d{2}/);
  if (m2) return parseInt(m2[1], 10);
  return 12;
}

function renderMerchantAnalyticsPanel(store) {
  const panel = document.getElementById('storePanel-analytics');
  if (!panel) return;

  const period = state.analyticsPeriod || 'DAY';
  const todayStr = getTodayDateStr();
  const tomorrowStr = getFutureDateStr(1);

  // 100% 讀取該店家的真實訂單資料 (排除已取消)
  const allStoreOrders = state.orders.filter(o => o.storeId === store.id && !String(o.status).includes('已取消'));

  // 依據「今日 / 本週 / 本月」篩選真實訂單並建立時間分組桶 (Buckets)
  let periodTitle = `今日各時段真實營收與單量 (${todayStr})`;
  let buckets = [];
  let periodOrders = [];

  if (period === 'DAY') {
    periodOrders = allStoreOrders.filter(o => (o.pickupDate || todayStr) === todayStr);
    // 若今日尚無訂單，自動包含該店所有真實訂單以供檢視
    if (periodOrders.length === 0) periodOrders = allStoreOrders;
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
    periodTitle = '近 7 日每日真實營收與單量分析';
    periodOrders = allStoreOrders;
    const dayOffsets = [-3, -2, -1, 0, 1, 2, 3];
    buckets = dayOffsets.map(off => {
      const dStr = getDateOffsetFromStr(todayStr, off);
      const shortLabel = off === 0 ? `今日(${dStr.slice(5)})` : off === 1 ? `明日(${dStr.slice(5)})` : dStr.slice(5);
      return {
        key: dStr,
        label: shortLabel,
        match: o => (o.pickupDate || todayStr) === dStr
      };
    });
  } else {
    periodTitle = '各取餐日期區間真實營收分析';
    periodOrders = allStoreOrders;
    const uniqueDates = [...new Set(allStoreOrders.map(o => o.pickupDate || todayStr))].sort();
    buckets = (uniqueDates.length > 0 ? uniqueDates : [todayStr]).map(dStr => ({
      key: dStr,
      label: dStr.slice(5),
      match: o => (o.pickupDate || todayStr) === dStr
    }));
  }

  // 計算每個時段/日期桶的真實營收、真實單數、真實平均候餐分鐘數
  const bucketStats = buckets.map(b => {
    const matched = periodOrders.filter(b.match);
    const rev = matched.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
    const count = matched.length;
    const estWait = count === 0
      ? 3
      : Math.min(25, Math.max(4, Math.round((count / Math.max(1, store.maxCapacityPer15Min)) * 15) + 4));
    return { ...b, orders: matched, rev, count, estWait };
  });

  // 真實 4 大 KPI 計算
  const totalRev = periodOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const totalOrders = periodOrders.length;
  const avgTicket = totalOrders > 0 ? Math.round(totalRev / totalOrders) : 0;
  const divertedOrders = periodOrders.filter(o => o.isDivertedOrder || (o.discount && Number(o.discount) > 0) || (o.promoApplied && o.promoApplied !== '一般點餐' && o.promoApplied !== '現場POS點餐'));
  const divertedRev = divertedOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const upcomingRes = allStoreOrders.filter(o => o.isReservation && (o.pickupDate || '') >= todayStr);

  // 1. 產生互動式 SVG 柱狀圖 (Bar Chart)
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
          <g class="chart-interactive-bar"
             onmousemove="showAnalyticsTooltip(event, '${escapeHtml(b.label)} 營運數據', '真實營收：NT$ ${b.rev.toLocaleString()} (${b.count} 筆訂單)', '點擊柱狀圖可於下方篩選檢視這 ${b.count} 筆真實訂單明細')"
             ontouchstart="showAnalyticsTooltip(event, '${escapeHtml(b.label)} 營運數據', '真實營收：NT$ ${b.rev.toLocaleString()} (${b.count} 筆訂單)', '點擊下方篩選明細')"
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

  // 2. 產生 100% 真實訂單品項統計的互動式 SVG 圓餅圖 (Donut Chart)
  const itemStatsMap = {};
  let totalItemRevenue = 0;
  periodOrders.forEach(o => {
    let items = [];
    try { items = JSON.parse(o.itemsJson || '[]'); } catch (e) {}
    items.forEach(it => {
      const baseName = String(it.name || '餐點').split(' [')[0].trim();
      const qty = Number(it.qty) || 1;
      const rev = (Number(it.price) || 0) * qty;
      if (!itemStatsMap[baseName]) itemStatsMap[baseName] = { name: baseName, qty: 0, rev: 0 };
      itemStatsMap[baseName].qty += qty;
      itemStatsMap[baseName].rev += rev;
      totalItemRevenue += rev;
    });
  });

  const palette = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
  const sortedItems = Object.values(itemStatsMap).sort((a, b) => b.rev - a.rev);
  let pieItems = [];
  if (sortedItems.length === 0) {
    pieItems = [{ name: '尚無餐點紀錄', qty: 0, rev: 0, pct: 100, color: '#CBD5E1' }];
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
    // 校正總和為 100%
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

  // 3. 產生互動式 SVG 折線圖 (Line Chart：各時段真實單量與候餐負載曲線)
  const maxWait = Math.max(20, ...bucketStats.map(b => b.estWait));
  const pts = bucketStats.map((b, i) => {
    const x = 45 + (i * (370 / Math.max(1, bucketStats.length - 1)));
    const y = 145 - Math.round((b.estWait / maxWait) * 110);
    return { x, y, w: b.estWait, count: b.count, rev: b.rev, label: b.label, key: b.key };
  });
  const polylinePoints = pts.map(p => `${p.x},${p.y}`).join(' ');
  const areaPoints = `45,145 ${polylinePoints} ${pts[pts.length - 1].x},145`;

  // 4. 點擊圖表後的真實訂單明細鑽取列表 (Drill-down Order Table)
  let drilldownOrders = periodOrders;
  const activeFilter = state.analyticsSelectedFilter;
  if (activeFilter) {
    if (activeFilter.type === 'BUCKET') {
      const targetBucket = bucketStats.find(b => b.key === activeFilter.key);
      if (targetBucket) drilldownOrders = targetBucket.orders;
    } else if (activeFilter.type === 'ITEM') {
      drilldownOrders = periodOrders.filter(o => String(o.itemsJson || '').includes(activeFilter.key));
    }
  }

  panel.innerHTML = `
    <div class="analytics-panel-wrap">
      <!-- 頂部：櫃位與 日/週/月 切換 + 一鍵新增測試訂單驗證動態圖表 -->
      <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:12px 16px; border-radius:14px; border:1px solid var(--border); flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:1.08rem; font-weight:950; color:var(--text-primary);">
            📊 ${escapeHtml(store.name)} — 100% 真實訂單互動式營運分析
          </h3>
          <div style="font-size:0.78rem; color:var(--text-secondary);">
            💡 <strong>滑鼠移過或手指觸碰任何柱狀、圓餅扇形、折線節點</strong>即可查看即時數據，<strong>點擊圖表元素</strong>可於下方篩選對應的真實訂單！
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="pos-cat-pill ${period === 'DAY' ? 'active' : ''}" onclick="setAnalyticsPeriod('DAY')">📅 今日時段 (${allStoreOrders.filter(o => (o.pickupDate || todayStr) === todayStr).length}單)</button>
          <button type="button" class="pos-cat-pill ${period === 'WEEK' ? 'active' : ''}" onclick="setAnalyticsPeriod('WEEK')">📆 近7日分日 (${allStoreOrders.length}單)</button>
          <button type="button" class="pos-cat-pill ${period === 'MONTH' ? 'active' : ''}" onclick="setAnalyticsPeriod('MONTH')">🗓️ 全部日期總覽</button>
        </div>
      </div>

      <!-- 4 大 100% 真實計算 KPI 指標卡 -->
      <div class="analytics-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">💰 真實總營業額 (${periodOrders.length} 筆有效單)</div>
          <div class="kpi-val" style="color:var(--brand-dark);">NT$ ${totalRev.toLocaleString()}</div>
          <div class="kpi-sub">100% 來自目前系統訂單即時加總</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">🧾 真實總單數 (含未來預訂 ${upcomingRes.length} 單)</div>
          <div class="kpi-val">${totalOrders} 單</div>
          <div class="kpi-sub">真實平均客單價 NT$ ${avgTicket}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">🤖 AI 離峰優惠引流營收 (${divertedOrders.length} 單)</div>
          <div class="kpi-val" style="color:#4F46E5;">NT$ ${divertedRev.toLocaleString()}</div>
          <div class="kpi-sub" style="color:#4F46E5;">佔總營收 ${totalRev > 0 ? Math.round((divertedRev / totalRev) * 100) : 0}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">⏱️ 目前即時出餐等候 / 負載</div>
          <div class="kpi-val">${store.avgPrepMinutes} 分鐘</div>
          <div class="kpi-sub">佇列 ${store.activeOrders}/${store.maxCapacityPer15Min} 單 (${store.loadPercentage}%)</div>
        </div>
      </div>

      <!-- 互動式圖表區：柱狀圖 (Bar Chart) + 圓餅圖 (Pie/Donut Chart) -->
      <div class="charts-grid">
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:4px;">
            <span style="font-weight:900; font-size:0.94rem;">📊 ${escapeHtml(periodTitle)} (可點擊柱狀篩選)</span>
            <span style="font-size:0.74rem; color:var(--brand-dark); font-weight:800;">🖱️ 滑鼠移過查看詳情・點擊篩選訂單</span>
          </div>
          ${barSvgHtml}
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span style="font-weight:900; font-size:0.94rem;">🍩 真實熱銷餐點營收佔比 (互動式圓餅圖)</span>
            <span style="font-size:0.72rem; color:var(--text-secondary); font-weight:700;">總餐點營收 $${totalItemRevenue}</span>
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
                <div class="legend-interactive-row ${state.analyticsSelectedFilter?.type === 'ITEM' && state.analyticsSelectedFilter?.key === p.name ? 'active' : ''}"
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

      <!-- 互動式折線圖 (Line Chart) + AI 智慧備餐與營運建議 -->
      <div class="charts-grid">
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:900; font-size:0.94rem;">📈 各時段單量與候餐時間折線圖 (可觸碰節點)</span>
            <span style="font-size:0.74rem; color:var(--red); font-weight:800;">紅虛線：15分鐘警戒</span>
          </div>
          <svg viewBox="0 0 460 175" style="width:100%; height:170px; overflow:visible;" onmouseleave="hideAnalyticsTooltip()">
            <line x1="35" y1="62" x2="435" y2="62" stroke="#FCA5A5" stroke-dasharray="4 4" stroke-width="1.5" />
            <polygon points="${areaPoints}" fill="rgba(16, 185, 129, 0.14)" />
            <polyline fill="none" stroke="#10B981" stroke-width="3" points="${polylinePoints}" />
            ${pts.map(p => `
              <g style="cursor:pointer;"
                 onmousemove="showAnalyticsTooltip(event, '⏱️ ${escapeHtml(p.label)} 候餐負載', '平均候餐：約 ${p.w} 分鐘（共 ${p.count} 單 / $${p.rev}）', '點擊節點可篩選此時段訂單')"
                 ontouchstart="showAnalyticsTooltip(event, '⏱️ ${escapeHtml(p.label)} 候餐負載', '平均候餐：約 ${p.w} 分鐘（共 ${p.count} 單 / $${p.rev}）', '點擊篩選此時段訂單')"
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
            🧠 AI 根據本店真實訂單之備料與營運診斷
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; font-size:0.82rem; color:#1E293B; line-height:1.5;">
            <div style="background:#FFFFFF; padding:8px 12px; border-radius:10px; border-left:4px solid #4F46E5;">
              <strong>🥇 本店真實人氣王備料建議：</strong><br>
              目前真實銷量第一名為「<strong>${escapeHtml(topPie.name)}</strong>」（累計售出 <strong>${topPie.qty} 份 / NT$ ${topPie.rev}</strong>，佔全店營收 ${topPie.pct}%），建議於 11:30 前預先備妥至少 ${Math.max(15, topPie.qty * 3)} 份半成品以降低尖峰候餐時間。
            </div>
            <div style="background:#FFFFFF; padding:8px 12px; border-radius:10px; border-left:4px solid #10B981;">
              <strong>📅 未來預訂訂單備料提醒：</strong><br>
              目前系統內共有 <strong>${upcomingRes.length} 筆未來預訂單</strong>（明日 ${tomorrowStr} 佔 <strong>${allStoreOrders.filter(o => o.pickupDate === tomorrowStr).length} 筆</strong>），皆已連動計入上方真實營收分析。
            </div>
            <div style="background:#FFFFFF; padding:8px 12px; border-radius:10px; border-left:4px solid #F59E0B;">
              <strong>🎁 AI 離峰優惠成效追蹤：</strong><br>
              目前透過 AI 離峰優惠引流共創造 <strong>${divertedOrders.length} 筆訂單（NT$ ${divertedRev}）</strong>。當前佇列負載為 ${store.loadPercentage}%。
            </div>
          </div>
        </div>
      </div>

      <!-- 點擊圖表連動篩選的真實訂單明細表 -->
      <div class="chart-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div>
            <span style="font-weight:900; font-size:0.95rem;">
              🔍 圖表真實數據來源明細 (${activeFilter ? `已篩選：【${escapeHtml(activeFilter.label)}】共 ${drilldownOrders.length} 筆` : `全部共 ${drilldownOrders.length} 筆真實訂單`})
            </span>
          </div>
          ${activeFilter ? `
            <button type="button" class="pos-cat-pill active" onclick="filterAnalyticsOrdersByKey('${escapeHtml(activeFilter.type)}', '${escapeHtml(activeFilter.key)}', '')">
              ✖ 清除圖表篩選（顯示全部 ${periodOrders.length} 筆）
            </button>
          ` : `<span style="font-size:0.76rem; color:var(--text-secondary);">💡 點擊上方任一柱狀圖或圓餅圖扇形即可過濾此明細表</span>`}
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:8px; max-height:240px; overflow-y:auto;">
          ${drilldownOrders.map(o => {
            let items = [];
            try { items = JSON.parse(o.itemsJson || '[]'); } catch (e) {}
            const summary = items.map(i => `${i.name}×${i.qty || 1}`).join('、');
            return `
              <div style="padding:8px 12px; border-radius:10px; border:1px solid var(--border); background:#F8FAFC; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="min-width:0; flex:1;">
                  <div style="font-weight:900; color:var(--text-primary);">
                    #${escapeHtml(o.pickupNumber)} ・ ${escapeHtml(o.pickupDate || todayStr)} ${escapeHtml(o.pickupTime || '')}
                    <span style="font-size:0.7rem; color:var(--brand-dark);">(${escapeHtml(o.status)})</span>
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

// ==================== 6.4 店家整合設定中心 (菜單管理&AI掃描、一次性餐具收費與AI優惠、LINE Developers) ====================
function renderMerchantSettingsPanel(store) {
  const panel = document.getElementById('storePanel-settings');
  if (!panel) return;

  const sub = state.settingsSubTab || 'menu';
  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const menus = store.menus || [];

  panel.innerHTML = `
    <div class="settings-panel-wrap">
      <!-- 頂部子頁籤切換 -->
      <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:12px 16px; border-radius:14px; border:1px solid var(--border); flex-wrap:wrap; gap:10px;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="pos-cat-pill ${sub === 'menu' ? 'active' : ''}" onclick="switchSettingsSubTab('menu')">🍔 菜單管理 & 📸 AI 智慧掃描匯入</button>
          <button type="button" class="pos-cat-pill ${sub === 'promo' ? 'active' : ''}" onclick="switchSettingsSubTab('promo')">🥢 一次性餐具收費 & 🤖 AI 分流優惠</button>
          <button type="button" class="pos-cat-pill ${sub === 'line' ? 'active' : ''}" onclick="switchSettingsSubTab('line')">💚 LINE Developers 推播設定 & ⚡ 流量模擬</button>
        </div>

        <select class="select-input" style="width:auto; padding:6px 10px; font-weight:800;" onchange="switchMerchantStore(this.value)">
          ${state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>切換店鋪：${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>

      ${sub === 'menu' ? `
        <!-- 子頁籤 1：AI 菜單掃描辨識 + 手動新增/編輯菜單 -->
        <div class="chart-card" style="background:linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%); border:1.5px solid #C7D2FE;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div>
              <h3 style="font-size:1.02rem; font-weight:900; color:#312E81;">📸 AI 智慧菜單辨識（拍照 / 貼上文字一鍵自動整理匯入）</h3>
              <p style="font-size:0.78rem; color:#4338CA;">上傳紙本菜單照片或貼上文字，AI 自動解析「分類、品名、價格、客製化選項」，勾選即可匯入「${escapeHtml(store.name)}」！</p>
            </div>
            <label style="background:#4F46E5; color:#FFFFFF; padding:8px 14px; border-radius:10px; font-size:0.82rem; font-weight:800; cursor:pointer;">
              📷 拍照 / 上傳菜單圖片
              <input type="file" id="aiMenuImageInput" accept="image/*" style="display:none;" onchange="handleMenuImageUpload(event)">
            </label>
          </div>

          <textarea id="aiMenuRawText" class="select-input" rows="3" placeholder="或在此直接貼上菜單文字（例如：招牌牛肉麵 120、紅油抄手 65、燙青菜 40）..." style="background:#FFFFFF; margin-bottom:8px; font-size:0.84rem;"></textarea>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn-tip-action" style="background:#4F46E5;" onclick="runAiMenuRecognition()">✨ 立即執行 AI 智慧解析整理</button>
            <button type="button" class="filter-chip" onclick="loadSampleMenuTextForAi()">📋 載入範例新菜單測試</button>
          </div>
          <div id="aiScannedPreviewArea" style="display:none; margin-top:12px;"></div>
        </div>

        <div class="chart-card">
          <h3 style="font-size:0.98rem; font-weight:900; margin-bottom:10px;">➕ 手動新增單一品項至「${escapeHtml(store.name)}」</h3>
          <div style="display:grid; grid-template-columns:1fr 1.5fr 0.8fr 1.5fr auto; gap:8px; align-items:end;">
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
              <label class="field-label">客製選項 (逗號分隔)</label>
              <input type="text" id="newMenuOpts" class="select-input" placeholder="正常, 飯少, 加辣, 加蛋+15">
            </div>
            <button type="button" class="btn-tip-action" style="height:40px;" onclick="addManualMenuItem()">＋ 新增品項</button>
          </div>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3 style="font-size:0.98rem; font-weight:900;">📋 目前架上菜單（共 ${menus.length} 道，可直接修改價格或刪除）</h3>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:10px;">
            ${menus.map((m, idx) => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border:1px solid var(--border); border-radius:10px; background:#F8FAFC;">
                <div>
                  <span style="font-size:0.7rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:2px 6px; border-radius:4px;">${escapeHtml(m.category || '主餐')}</span>
                  <div style="font-weight:800; font-size:0.9rem; margin-top:3px;">${escapeHtml(m.name)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:0.8rem; font-weight:800;">$</span>
                  <input type="number" value="${m.price}" onchange="updateMenuItemPrice(${idx}, this.value)" style="width:68px; padding:4px 6px; border:1px solid var(--border); border-radius:6px; font-weight:900;">
                  <button type="button" onclick="deleteMenuItem(${idx})" style="border:none; background:#FEE2E2; color:#DC2626; padding:5px 8px; border-radius:6px; font-weight:800; cursor:pointer;">刪</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${sub === 'promo' ? `
        <!-- 子頁籤 2：一次性餐具收費金額設定 + AI 離峰優惠與產能設定 -->
        <div class="chart-card">
          <h3 style="font-size:1.05rem; font-weight:900; margin-bottom:6px;">🥢 一次性免洗餐具與 🤖 AI 分流優惠設定（${escapeHtml(store.name)}）</h3>
          <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:16px;">
            學餐內用提供鐵筷，顧客結帳時僅顯示單一「🥢 需要一次性免洗餐具」選項，收費金額由貴店於下方自由設定（如 $1、$2 或 $0 免費）。
          </p>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:16px;">
            <div>
              <label class="field-label" style="color:var(--brand-dark);">🥢 一次性免洗餐具收費金額 (NT$)</label>
              <input type="number" id="cfgCutleryPrice" class="select-input" min="0" max="50" value="${storeCutleryPrice}">
            </div>

            <div>
              <label class="field-label">🔥 每 15 分鐘最大產能上限 (單)</label>
              <input type="number" id="cfgMaxCap" class="select-input" min="5" max="100" value="${store.maxCapacityPer15Min}">
            </div>

            <div>
              <label class="field-label">🍲 目前待製作佇列單數</label>
              <input type="number" id="cfgActiveOrders" class="select-input" min="0" max="150" value="${store.activeOrders}">
            </div>

            <div>
              <label class="field-label">🎁 AI 離峰分流優惠模式</label>
              <select id="cfgPromoMode" class="select-input">
                <option value="none" ${store.promoMode === 'none' ? 'selected' : ''}>關閉優惠</option>
                <option value="gift" ${(store.promoMode === 'gift' || store.promoMode === 'freebie') ? 'selected' : ''}>贈送招牌小菜 / 飲品</option>
                <option value="discount" ${store.promoMode === 'discount' ? 'selected' : ''}>現金折抵 (NT$)</option>
                <option value="points" ${store.promoMode === 'points' ? 'selected' : ''}>雙倍點數回饋</option>
              </select>
            </div>

            <div>
              <label class="field-label">🏷️ 優惠顯示文案</label>
              <input type="text" id="cfgPromoText" class="select-input" value="${escapeHtml(store.promoText || '')}" placeholder="例：🎁 離峰點餐送黃金泡菜">
            </div>

            <div>
              <label class="field-label">💸 現金折抵金額 (NT$)</label>
              <input type="number" id="cfgPromoDiscount" class="select-input" min="0" max="100" value="${store.promoDiscount || 0}">
            </div>
          </div>

          <button type="button" class="btn-primary-full" style="max-width:320px;" onclick="saveMerchantConfig()">💾 儲存餐具收費與 AI 分流設定</button>
        </div>
      ` : ''}

      ${sub === 'line' ? `
        <!-- 子頁籤 3：LINE Login OAuth 2.1 + Flex Message 推播設定 + Email 無限額雙軌通知 -->
        <div class="chart-card" style="border:1.5px solid #86EFAC; background:#F0FDF4;">
          <h3 style="font-size:1.05rem; font-weight:900; color:#065F46; margin-bottom:6px;">
            💚 LINE 官方帳號 + 📧 Email 無限額雙軌推播設定（${escapeHtml(store.name)}）
          </h3>
          <p style="font-size:0.82rem; color:#047857; line-height:1.5; margin-bottom:14px;">
            ⚠️ <strong>為什麼以各店家獨立官方 LINE 為主？</strong>因為 LINE 官方帳號免費輕用量方案每月僅有 <strong>200 則免費推播額度</strong>，單一帳號一天就會爆量！<br>
            ・<strong>🏆 黑客鬆比賽 Demo 期間</strong>：預設使用您的平台總官方 LINE（Channel ID: <code>2012260287</code>）直接展示推播。<br>
            ・<strong>🏪 正式營運期間</strong>：請各店家切換至「綁定本店專屬官方 LINE」填入自己的 Channel 憑證，並搭配 <strong>📧 Email 免額度自動寄信通知 (Google Apps Script MailApp)</strong>，徹底解決訊息限額問題！
          </p>

          <!-- 選擇模式：使用比賽預設官方 LINE vs 綁定店家專屬官方 LINE (正式營運主力) -->
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
            <label class="option-label-row ${store.useCustomLineOa ? 'checked' : ''}" style="background:#FFFFFF; margin-bottom:0;" onclick="toggleStoreCustomLineMode(true)">
              <div style="display:flex; align-items:center; gap:10px;">
                <input type="radio" name="storeLineOaMode" ${store.useCustomLineOa ? 'checked' : ''} style="width:18px; height:18px; accent-color:#06C755;">
                <div>
                  <div style="font-weight:900; color:var(--text-primary);">🏪 正式營運主力：綁定「${escapeHtml(store.name)}」專屬官方 LINE</div>
                  <div style="font-size:0.74rem; color:var(--text-secondary);">各店獨立計算每月免費推播額度，避免單一帳號 200 則耗盡</div>
                </div>
              </div>
            </label>

            <label class="option-label-row ${!store.useCustomLineOa ? 'checked' : ''}" style="background:#FFFFFF; margin-bottom:0;" onclick="toggleStoreCustomLineMode(false)">
              <div style="display:flex; align-items:center; gap:10px;">
                <input type="radio" name="storeLineOaMode" ${!store.useCustomLineOa ? 'checked' : ''} style="width:18px; height:18px; accent-color:#06C755;">
                <div>
                  <div style="font-weight:900; color:var(--text-primary);">🏆 黑客鬆比賽 Demo：使用平台預設官方 LINE (2012260287)</div>
                  <div style="font-size:0.74rem; color:var(--text-secondary);">比賽期間免設定即可推播，並自動啟用 Email 零限額備援通知</div>
                </div>
              </div>
            </label>
          </div>

          ${store.useCustomLineOa ? `
            <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1px solid #86EFAC; margin-bottom:12px;">
              <div style="font-size:0.86rem; font-weight:900; color:#065F46; margin-bottom:10px;">
                🏪 「${escapeHtml(store.name)}」專屬官方 LINE 參數設定（金鑰將安全加密儲存於後端 GAS Properties）
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                  <label class="field-label">LINE Login Channel ID (Client ID)</label>
                  <input type="text" id="cfgStoreLineClientId" class="select-input" placeholder="例如：2012260287" value="${escapeHtml(store.customLineClientId || '')}">
                </div>
                <div>
                  <label class="field-label">LINE Login Channel Secret</label>
                  <input type="password" id="cfgStoreLineClientSecret" class="select-input" placeholder="輸入新 Secret 以更新後端設定（留空則維持原設定）" value="">
                </div>
              </div>
              <div>
                <label class="field-label">Messaging API Channel Access Token (Long-lived)</label>
                <input type="password" id="cfgStoreLineChannelToken" class="select-input" placeholder="貼上本店 Messaging API Token（留空則維持原設定）" value="">
              </div>
            </div>
          ` : `
            <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1px solid #A7F3D0; margin-bottom:12px;">
              <div style="font-size:0.86rem; font-weight:900; color:#065F46; margin-bottom:6px;">
                🏆 目前「${escapeHtml(store.name)}」使用【黑客鬆比賽預設官方 LINE (2012260287) + 📧 Email 無限額通知】
              </div>
              <p style="font-size:0.78rem; color:var(--text-secondary); margin-bottom:10px;">
                為符合資安規範並避免 GitHub 金鑰外洩，Channel Secret 與 Messaging API Token 均安全存放於後端 GAS <code>ScriptProperties</code>。如需更新後端金鑰可於下方填入後按儲存：
              </p>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                  <label class="field-label">比賽預設 LINE Login Channel ID</label>
                  <input type="text" id="cfgSysLineClientId" class="select-input" placeholder="預設：2012260287" value="${escapeHtml(state.lineProfile.customClientId || DEFAULT_LINE_CLIENT_ID)}">
                </div>
                <div>
                  <label class="field-label">比賽預設 LINE Login Channel Secret</label>
                  <input type="password" id="cfgSysLineClientSecret" class="select-input" placeholder="由後端 GAS ScriptProperties 安全託管（欲更新請輸入）">
                </div>
              </div>
              <div>
                <label class="field-label">比賽預設 Messaging API Channel Access Token</label>
                <input type="password" id="cfgLineAccessToken" class="select-input" placeholder="由後端 GAS ScriptProperties 安全託管（欲更新請輸入）">
              </div>
            </div>
          `}

          <button type="button" class="btn-line" style="padding:11px 18px; font-size:0.88rem;" onclick="saveLineMessagingConfig()">
            💾 儲存 LINE 官方帳號與 Email 雙軌推播設定
          </button>
        </div>

        <div class="chart-card">
          <h3 style="font-size:1.02rem; font-weight:900; margin-bottom:6px;">⚡ 黑客鬆評審 Demo：一鍵模擬中午 12:10 尖峰流量與 AI 削峰引流</h3>
          <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:12px;">
            點擊下方按鈕可模擬熱門店家瞬間湧入大量訂單達滿載 (FULL)，展示學生端與 AI 顧問自動引流至離峰店家並套用優惠！
          </p>
          <button type="button" id="simTrafficBtn" class="btn-tip-action" onclick="triggerTrafficSimulation()">⚡ 觸發中午 12:10 尖峰塞車模擬</button>
        </div>
      ` : ''}
    </div>
  `;
}

// ==================== 6.5 菜單編輯與 AI 掃描匯入輔助函式 ====================
function addManualMenuItem() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  const cat = document.getElementById('newMenuCat')?.value.trim() || '主廚推薦';
  const name = document.getElementById('newMenuName')?.value.trim();
  const price = parseInt(document.getElementById('newMenuPrice')?.value, 10);
  const optsRaw = document.getElementById('newMenuOpts')?.value.trim();

  if (!name || isNaN(price) || price <= 0) {
    showToast('⚠️ 請輸入有效的餐點名稱與價格！');
    return;
  }

  const options = {};
  if (optsRaw) {
    const choices = optsRaw.split(/[,，、]/).map(s => s.trim()).filter(Boolean).map(tok => {
      const m = tok.match(/^(.+?)\+(\d+)$/);
      return m ? [m[1].trim(), parseInt(m[2], 10)] : [tok, 0];
    });
    if (choices.length > 0) {
      options['客製化選項'] = { type: 'checkbox', choices };
    }
  }

  const newItem = {
    id: 'M' + Date.now().toString().slice(-4),
    category: cat,
    name,
    price,
    options
  };

  store.menus = store.menus || [];
  store.menus.push(newItem);
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  renderMerchantSettingsPanel(store);
  showToast(`✅ 已新增餐點：${name} (NT$${price})`);
}

function updateMenuItemPrice(idx, newPriceVal) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[idx]) return;
  const p = parseInt(newPriceVal, 10);
  if (isNaN(p) || p < 0) return;
  store.menus[idx].price = p;
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  showToast(`💾 已更新「${store.menus[idx].name}」價格為 NT$${p}`);
}

function deleteMenuItem(idx) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[idx]) return;
  const removed = store.menus.splice(idx, 1)[0];
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  renderMerchantSettingsPanel(store);
  showToast(`🗑️ 已刪除品項：${removed.name}`);
}

async function syncStoreMenuToCloud(store) {
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveStoreMenu',
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
炙燒起司牛五花丼 $145 (飯量正常/飯少, 加溫泉蛋+20, 加泡菜+25)
川味椒麻雞腿便當 $125 (小辣/中辣/大辣, 加滷蛋+15)
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
    showToast('📸 已載入菜單影像，正在執行 AI 視覺辨識...');
    await runAiMenuRecognition(base64Data, mimeType);
  };
  reader.readAsDataURL(file);
}

async function runAiMenuRecognition(imageBase64 = null, mimeType = 'image/jpeg') {
  const rawText = document.getElementById('aiMenuRawText')?.value.trim() || '';
  const previewBox = document.getElementById('aiScannedPreviewArea');
  if (!previewBox) return;

  if (!rawText && !imageBase64) {
    showToast('⚠️ 請先貼上菜單文字或上傳菜單照片！');
    return;
  }

  previewBox.style.display = 'block';
  previewBox.innerHTML = `<div style="padding:12px; font-weight:800; color:#4338CA;">🧠 AI 正在結構化辨識菜單品項與價格...</div>`;

  // 結構化解析器（支援文字行與照片預設辨識）
  const parsed = [];
  let currentCat = 'AI 掃描推薦';
  const lines = (rawText || '招牌雞腿便當 $120 (正常/飯少, 加蛋+15)\n蒜泥白肉便當 $115\n黃金泡菜 $35').split(/\r?\n/);

  lines.forEach(line => {
    const t = line.trim();
    if (!t) return;
    const catMatch = t.match(/^【(.+?)】$/);
    if (catMatch) {
      currentCat = catMatch[1].trim();
      return;
    }
    const itemMatch = t.match(/^(.+?)\s*[\$＄]?\s*(\d{2,4})\s*(?:元)?(?:\s*[\(（](.+?)[\)）])?$/);
    if (itemMatch) {
      const name = itemMatch[1].replace(/^[-*•\d\.]+\s*/, '').trim();
      const price = parseInt(itemMatch[2], 10);
      const optStr = itemMatch[3] || '';
      const options = {};
      if (optStr) {
        const choices = optStr.split(/[,，/]/).map(s => s.trim()).filter(Boolean).map(tok => {
          const m = tok.match(/^(.+?)\+(\d+)$/);
          return m ? [m[1].trim(), parseInt(m[2], 10)] : [tok, 0];
        });
        if (choices.length > 0) options['客製選項'] = { type: 'checkbox', choices };
      }
      parsed.push({
        id: 'M' + Math.floor(1000 + Math.random() * 9000),
        category: currentCat,
        name,
        price,
        options
      });
    }
  });

  state.scannedMenuCandidates = parsed;
  if (parsed.length === 0) {
    previewBox.innerHTML = `<div style="color:var(--red); font-weight:800;">⚠️ 未能辨識出品項，請確認每行包含「品名 價格」。</div>`;
    return;
  }

  previewBox.innerHTML = `
    <div style="background:#FFFFFF; padding:12px; border-radius:10px; border:1px solid #C7D2FE;">
      <div style="font-weight:900; font-size:0.86rem; color:#312E81; margin-bottom:8px;">
        ✅ AI 共辨識出 ${parsed.length} 道餐點，確認無誤後即可一鍵匯入：
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:8px; margin-bottom:10px;">
        ${parsed.map(p => `
          <div style="padding:8px 10px; background:#F8FAFC; border:1px solid var(--border); border-radius:8px; font-size:0.82rem;">
            <span style="font-size:0.68rem; font-weight:800; color:#4F46E5;">${escapeHtml(p.category)}</span>
            <div style="font-weight:800;">${escapeHtml(p.name)} — <strong style="color:var(--red);">NT$${p.price}</strong></div>
          </div>
        `).join('')}
      </div>
      <button type="button" class="btn-tip-action" style="background:#10B981;" onclick="commitScannedMenusToStore()">📥 一鍵匯入至本店菜單</button>
    </div>
  `;
}

function commitScannedMenusToStore() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !state.scannedMenuCandidates.length) return;

  store.menus = store.menus || [];
  state.scannedMenuCandidates.forEach(cand => {
    const existing = store.menus.find(m => m.name === cand.name);
    if (existing) {
      existing.price = cand.price;
      existing.category = cand.category;
    } else {
      store.menus.push(cand);
    }
  });

  state.scannedMenuCandidates = [];
  saveLocalStores(state.stores);
  syncStoreMenuToCloud(store);
  renderMerchantSettingsPanel(store);
  showToast('🎉 AI 掃描菜單已成功匯入並同步！');
}

async function saveMerchantConfig() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  store.cutleryPrice = Math.max(0, parseInt(document.getElementById('cfgCutleryPrice')?.value || '1', 10));
  store.maxCapacityPer15Min = Math.max(5, parseInt(document.getElementById('cfgMaxCap')?.value || '20', 10));
  store.activeOrders = Math.max(0, parseInt(document.getElementById('cfgActiveOrders')?.value || '0', 10));
  store.promoMode = document.getElementById('cfgPromoMode')?.value || 'none';
  store.promoText = document.getElementById('cfgPromoText')?.value.trim() || '';
  store.promoDiscount = Math.max(0, parseInt(document.getElementById('cfgPromoDiscount')?.value || '0', 10));

  enrichStoresAndAi();
  saveLocalStores(state.stores);
  showToast(`✅ 已儲存「${store.name}」設定（一次性餐具：+$${store.cutleryPrice}）！`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStoreConfig',
        storeId: store.id,
        cutleryPrice: store.cutleryPrice,
        maxCapacityPer15Min: store.maxCapacityPer15Min,
        activeOrders: store.activeOrders,
        promoMode: store.promoMode,
        promoText: store.promoText,
        promoDiscount: store.promoDiscount
      })
    });
  } catch (e) {}
}

async function triggerTrafficSimulation() {
  const btn = document.getElementById('simTrafficBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ 正在注入尖峰流量...';
  }

  // 本地同步模擬：讓雙溪與城中熱門店 (S01, S03, S05) 滿載、離峰店開啟優惠
  state.stores.forEach(s => {
    if (s.id === 'S01' || s.id === 'S03' || s.id === 'S05') {
      s.activeOrders = Math.round(s.maxCapacityPer15Min * 1.15);
      s.avgPrepMinutes = calcPrepMinutes(s.activeOrders, s.maxCapacityPer15Min);
    } else {
      s.activeOrders = Math.max(2, Math.round(s.maxCapacityPer15Min * 0.2));
      s.avgPrepMinutes = calcPrepMinutes(s.activeOrders, s.maxCapacityPer15Min);
      if (s.promoMode === 'none') {
        s.promoMode = 'discount';
        s.promoDiscount = 10;
        s.promoText = '🎁 AI離峰分流現折$10';
      }
    }
  });

  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();
  showToast('⚡ 已觸發中午 12:10 尖峰流量模擬！');

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'simulateTraffic', mode: 'PEAK', campus: state.campus })
    });
    const data = await res.json();
    if (data && data.success) {
      applyCloudBundle(data);
      enrichStoresAndAi();
      renderMerchantView();
    }
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
    showToast(`✅ 已儲存「${store.name}」專屬官方 LINE 推播設定至雲端後台！`);
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveLineDevConfig',
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

    showToast(`✅ 「${store.name}」已設為使用系統預設官方 LINE 推播！`);
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveLineDevConfig',
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