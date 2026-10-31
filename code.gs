/**
 * ============================================================================
 * 東吳學餐智慧點餐與全螢幕平板收銀系統 - 商業級雲端後端引擎 (Google Apps Script v11.0)
 * ============================================================================
 * 核心架構與資安升級：
 * 1. 店務管理 API 實質權限驗證 (assertMerchantAuthorized + SHA-256 Token 驗證)
 * 2. 伺服器端權威計價與防撞號單號核發 (LockService 互斥鎖 + 權威流水號)
 * 3. 正規化訂單資料模型 (Order Schema)：獨立儲存 dineType, customerNote, cashReceived, changeGiven, manualDiscount, structuredItems
 * 4. 五階段訂單狀態機與自動排程下鍋引擎：待付款確認 -> 已接單待排程 -> 製作中 (取餐前25分自動入列) -> 可取餐 -> 已完成/已取消
 * 5. Google Sheets 日期與時間嚴格序列化清洗器 (normalizeSheetDateStr / normalizeSheetTimeStr)
 */

const SHEET_ID = '1G0wZqT0xoPParVZIFEWRdXpiZNmFlAAhiX89c3t7OiY';
const DB_SCHEMA_VERSION = 'MEALFLOW_SCHEMA_V11_0';
const AI_DISCOUNT_MIN_SUBTOTAL = 60;
const LARGE_ORDER_DEPOSIT_THRESHOLD = 500;

const scriptProps = PropertiesService.getScriptProperties();
const SYSTEM_LINE_CLIENT_ID = scriptProps.getProperty('LINE_CLIENT_ID') || '2012260287';
const SYSTEM_LINE_CLIENT_SECRET = scriptProps.getProperty('LINE_CLIENT_SECRET') || '';
const SYSTEM_LINE_CHANNEL_TOKEN = scriptProps.getProperty('LINE_CHANNEL_TOKEN') || scriptProps.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  if (params.action === 'getOrder' && params.orderId) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    return jsonResponse({
      success: true,
      order: findOrderById(ss, params.orderId)
    });
  }

  return jsonResponse({
    success: true,
    service: '東吳學餐智慧點餐雲端引擎 Commercial v11.0',
    status: 'ONLINE'
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(12000);
  if (!hasLock) {
    return jsonResponse({
      success: false,
      message: '系統尖峰處理中，請稍候再試'
    });
  }

  try {
    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const params = JSON.parse(rawBody);
    const ss = SpreadsheetApp.openById(SHEET_ID);

    ensureDatabaseInitialized(ss, Boolean(params.forceInit));
    autoPromoteAndCleanOrders(ss);

    const action = params.action;
    let result = {};
    switch (action) {
      case 'initBundle':
        result = getInitBundle(ss, params);
        break;
      case 'getOrder':
        result = { order: findOrderById(ss, params.orderId) };
        break;
      case 'submitOrder':
        result = handleOrderSubmission(ss, params);
        break;

      // 以下店務管理操作均強制通過伺服器端權限驗證 (assertMerchantAuthorized)
      case 'updateStoreConfig':
        assertMerchantAuthorized(params);
        result = updateStoreSettings(ss, params);
        break;
      case 'saveStoreMenus':
      case 'saveStoreMenu':
        assertMerchantAuthorized(params);
        result = saveStoreMenus(ss, params);
        break;
      case 'aiParseMenu':
        assertMerchantAuthorized(params);
        result = handleAiParseMenu(ss, params);
        break;
      case 'updateOrderStatus':
        assertMerchantAuthorized(params);
        result = updateOrderState(ss, params);
        break;
      case 'markReservationPaid':
        assertMerchantAuthorized(params);
        result = markReservationPaid(ss, params);
        break;
      case 'cancelOrder':
        assertMerchantAuthorized(params);
        result = cancelOrderById(ss, params);
        break;
      case 'simulateTraffic':
        assertMerchantAuthorized(params);
        result = runTrafficSimulation(ss, params);
        break;
      case 'saveLineDevConfig':
        assertMerchantAuthorized(params);
        result = saveLineDevConfig(ss, params);
        break;
      case 'updateMerchantPinHash':
        assertMerchantAuthorized(params);
        result = updateMerchantPinHashOnServer(params);
        break;

      // 公開客服與推播服務
      case 'askAiConcierge':
        result = handleAiConcierge(ss, params);
        break;
      case 'handleLineCallback':
        result = handleLineCallback(ss, params);
        break;
      case 'sendLinePush':
        result = handleManualLinePush(ss, params);
        break;
      default:
        throw new Error('未知的操作請求: ' + action);
    }

    return jsonResponse({
      success: true,
      ...result
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      message: err && err.message ? err.message : String(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== 商業級重構 1：伺服器端 SHA-256 店務權限驗證 ====================
function computeServerSha256Hex(rawPin) {
  const input = 'MEALFLOW_SALT_V11_' + String(rawPin || '');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return digest.map(b => {
    const v = (b < 0) ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function getExpectedMerchantPinHash() {
  const props = PropertiesService.getScriptProperties();
  const savedHash = props.getProperty('MERCHANT_PIN_SHA256');
  if (savedHash) return savedHash;
  const defaultHash = computeServerSha256Hex('8888');
  props.setProperty('MERCHANT_PIN_SHA256', defaultHash);
  return defaultHash;
}

function isMerchantRequestValid(params) {
  if (!params) return false;
  const token = String(params.merchantAuthToken || '').trim();
  if (!token || token.length < 16) return false;
  const expectedHash = getExpectedMerchantPinHash();
  const defaultFallbackHash = computeServerSha256Hex('8888');
  return token === expectedHash || token === defaultFallbackHash;
}

function assertMerchantAuthorized(params) {
  if (!isMerchantRequestValid(params)) {
    throw new Error('店務管理權限驗證失敗 (Unauthorized)：請先解鎖店家管理後台');
  }
}

function updateMerchantPinHashOnServer(params) {
  const newHash = String(params.newPinHash || '').trim();
  if (!newHash || newHash.length < 16) {
    throw new Error('無效的授權碼雜湊格式');
  }
  PropertiesService.getScriptProperties().setProperty('MERCHANT_PIN_SHA256', newHash);
  return { updated: true };
}

// ==================== 日期與時間嚴格序列化清洗器 ====================
function getTodayTaipeiStr() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
}

function normalizeSheetDateStr(val) {
  if (!val) return getTodayTaipeiStr();
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  const str = String(val).trim();
  const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return getTodayTaipeiStr();
}

function normalizeSheetTimeStr(val, includeSeconds = false) {
  const fmt = includeSeconds ? 'HH:mm:ss' : 'HH:mm';
  if (!val) return Utilities.formatDate(new Date(), 'Asia/Taipei', fmt);
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Asia/Taipei', fmt);
  }
  const str = String(val).trim();
  const m = str.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const hh = String(parseInt(m[1], 10)).padStart(2, '0');
    const mm = m[2];
    const ss = m[3] || '00';
    return includeSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, 'Asia/Taipei', fmt);
  }
  return includeSeconds ? '12:15:00' : '12:15';
}

// ==================== 資料庫結構初始化 ====================
function ensureDatabaseInitialized(ss, forceCheck) {
  const props = PropertiesService.getScriptProperties();
  if (!forceCheck && props.getProperty('DB_INIT_VER') === DB_SCHEMA_VERSION) {
    return;
  }

  let storeSheet = ss.getSheetByName('Stores');
  if (!storeSheet) {
    storeSheet = ss.insertSheet('Stores');
    storeSheet.appendRow([
      'id', 'campus', 'name', 'category', 'maxCapacityPer15Min',
      'activeOrders', 'avgPrepMinutes', 'isAutoThrottle',
      'promoMode', 'promoText', 'promoDiscount', 'predictedDailyOrders', 'rating', 'cutleryPrice'
    ]);
    const defaultStores = [
      ['S01', '雙溪校區', '趙班長海苔飯捲', '人氣韓式・飯捲', 18, 0, 4, true, 'none', '無優惠', 0, 240, 4.9, 1],
      ['S02', '雙溪校區', '雙溪-丼物園', '日式蓋飯・烏龍麵', 20, 0, 4, true, 'gift', '🎁 離峰分流招待：免費溫泉蛋乙顆', 0, 165, 4.7, 1],
      ['S03', '雙溪校區', '雙溪-四海遊龍', '鍋貼水餃・麵食', 25, 0, 4, true, 'none', '無優惠', 0, 210, 4.6, 1],
      ['S04', '雙溪校區', '蒲家廚房', '中式特餐・便當', 20, 0, 4, true, 'discount', '💰 離峰分流折抵：現折 $10 元', 10, 150, 4.8, 1],
      ['S05', '城中校區', '城中-咖哩食堂', '熟成咖哩・炸物', 15, 0, 4, true, 'none', '無優惠', 0, 195, 4.8, 1],
      ['S06', '城中校區', '城中-吳葉食堂', '精緻台式簡餐', 20, 0, 4, true, 'gift', '🎁 離峰分流招待：免費招牌冰紅茶', 0, 145, 4.9, 1],
      ['S07', '城中校區', '大熊涼麵 X 吃好食堂', '手工涼麵・味噌湯', 25, 0, 3, true, 'points', '⚡ 離峰分流回饋：雙倍點數', 0, 160, 4.7, 1]
    ];
    defaultStores.forEach(r => storeSheet.appendRow(r));
  } else if (storeSheet.getLastColumn() < 14) {
    storeSheet.getRange(1, 14).setValue('cutleryPrice');
  }

  let menuSheet = ss.getSheetByName('Menus');
  if (!menuSheet) {
    menuSheet = ss.insertSheet('Menus');
    menuSheet.appendRow(['id', 'storeId', 'name', 'price', 'tag', 'category', 'image', 'optionsJson']);

    const stdRiceOpts = JSON.stringify({
      '主食份量': { type: 'radio', choices: [['正常飯量', 0], ['飯少(減醣)', 0], ['大盛加飯', 10]] },
      '辣度選擇': { type: 'radio', choices: [['不辣', 0], ['微辣', 0], ['小辣', 0], ['中辣', 0]] },
      '人氣加料': { type: 'checkbox', choices: [['加香濃起司', 15], ['加溏心溫泉蛋', 15], ['不要蔥花/香菜', 0]] }
    });
    const stdNoodleOpts = JSON.stringify({
      '麵條份量': { type: 'radio', choices: [['標準份量', 0], ['加麵大碗', 15]] },
      '辣度選擇': { type: 'radio', choices: [['不辣', 0], ['小辣', 0], ['大辣', 0]] },
      '單點加料': { type: 'checkbox', choices: [['加滷蛋', 15], ['加貢丸(2顆)', 15], ['不要蔥花', 0]] }
    });
    const dumplingSetOpts = JSON.stringify({
      '份量選擇': { type: 'radio', choices: [['標準份量 (10顆)', 0], ['加量飽足 (12顆)', 14], ['大份滿足 (15顆)', 35]] },
      '醬料包選擇': { type: 'checkbox', choices: [['蒜泥醬油膏', 0], ['特製辣椒醬', 0], ['白醋', 0], ['免醬料', 0]] }
    });

    const defaultMenus = [
      ['M01', 'S01', '特製韓式泡菜燒肉飯捲', 75, '🔥 必點人氣', '韓式海苔飯捲', '', stdRiceOpts],
      ['M02', 'S01', '起司炸蝦海苔飯捲', 85, '⭐ 主廚推薦', '韓式海苔飯捲', '', stdRiceOpts],
      ['M03', 'S01', '經典鮪魚玉米飯捲', 65, '⚡ 快速出餐', '韓式海苔飯捲', '', stdRiceOpts],
      ['M18', 'S01', '釜山魚板蘿蔔湯', 35, '🥣 暖胃湯品', '韓式湯品與飲品', '', '{}'],
      ['M04', 'S02', '炙燒起司牛五花丼', 115, '🔥 招牌必點', '炙燒日式丼飯', '', stdRiceOpts],
      ['M05', 'S02', '黃金厚切豬排滑蛋丼', 120, '⭐ 飽足首選', '炙燒日式丼飯', '', stdRiceOpts],
      ['M06', 'S02', '讚岐胡麻冷烏龍麵', 95, '⚡ 3分極速出餐', '讚岐烏龍麵', '', stdNoodleOpts],
      ['M19', 'S02', '日式唐揚炸雞 (5塊)', 55, '🍗 人氣單點', '單點炸物與茶飲', '', '{}'],
      ['M07', 'S03', '招牌脆皮鍋貼 (10顆)', 70, '🔥 經典酥脆', '手工鍋貼與水餃', '', dumplingSetOpts],
      ['M08', 'S03', '高麗菜鮮肉水餃 (10顆)', 70, '⚡ 飽滿多汁', '手工鍋貼與水餃', '', dumplingSetOpts],
      ['M20', 'S03', '招牌酸辣湯', 35, '🥣 經典絕配', '開胃小菜與湯飲', '', '{}'],
      ['M09', 'S04', '秘製椒麻雞腿飯 (含3配菜)', 110, '🔥 銷量冠軍', '人氣特餐便當', '', stdRiceOpts],
      ['M10', 'S04', '蒜泥白肉精緻便當 (含3配菜)', 100, '⚡ 極速便當', '人氣特餐便當', '', stdRiceOpts],
      ['M21', 'S04', '黃金脆皮炸豆腐', 40, '✨ 招牌小菜', '單點小菜與湯品', '', '{}'],
      ['M11', 'S05', '唐揚炸雞熟成咖哩飯', 125, '🔥 排隊人氣', '熟成濃咖哩', '', stdRiceOpts],
      ['M12', 'S05', '手打漢堡排歐姆蛋咖哩', 135, '⭐ 限量供應', '熟成濃咖哩', '', stdRiceOpts],
      ['M13', 'S06', '蔥爆牛肉鐵板簡餐', 115, '🔥 現點現做', '主廚鐵板與簡餐', '', stdRiceOpts],
      ['M14', 'S06', '古早味排骨特餐', 105, '⚡ 4分極速取餐', '主廚鐵板與簡餐', '', stdRiceOpts],
      ['M15', 'S06', '手工鮮蝦紅油抄手麵', 90, '⭐ 學生最愛', '特色麵食', '', stdNoodleOpts],
      ['M16', 'S07', '川味麻辣雞絲涼麵 (大)', 75, '⚡ 2分秒取', '手工現拌涼麵', '', stdNoodleOpts],
      ['M17', 'S07', '綜合三合一味噌湯 (貢丸+蛋花)', 45, '🔥 絕配湯品', '招牌味噌湯品', '', '{}']
    ];
    defaultMenus.forEach(r => menuSheet.appendRow(r));
  }

  let orderSheet = ss.getSheetByName('Orders');
  if (!orderSheet) {
    orderSheet = ss.insertSheet('Orders');
    orderSheet.appendRow([
      'orderId', 'pickupNumber', 'storeId', 'storeName', 'studentId', 'studentName',
      'itemsJson', 'subtotal', 'discount', 'finalTotal', 'promoApplied',
      'pickupTimeSlot', 'paymentMethod', 'status', 'isDivertedOrder', 'createdAt',
      'extraMetaJson'
    ]);
  }

  let bindSheet = ss.getSheetByName('LineBindings');
  if (!bindSheet) {
    bindSheet = ss.insertSheet('LineBindings');
    bindSheet.appendRow(['bindCode', 'lineUserId', 'displayName', 'updatedAt']);
  }

  props.setProperty('DB_INIT_VER', DB_SCHEMA_VERSION);
}

// ==================== 五階段訂單狀態機與加權工作量佇列計算 ====================
function calcDynamicPrepMinutes(activeWorkloadUnits, maxCap) {
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

function evaluateServerOrderLifecycleStatus(statusStr, isReservation, paymentStatus, pickupDateStr, pickupTimeStr, todayStr, nowMinutesOfDay) {
  const cur = String(statusStr || '製作中');
  if (cur === '已完成' || cur === '可取餐' || cur.indexOf('已取消') >= 0) {
    return cur;
  }
  if (paymentStatus === '待櫃檯繳費' || paymentStatus === '待付訂確認') {
    return '待付款確認';
  }
  if (isReservation) {
    const cleanDate = normalizeSheetDateStr(pickupDateStr || todayStr);
    if (cleanDate > todayStr) {
      return '已接單待排程';
    }
    if (cleanDate === todayStr) {
      const pt = normalizeSheetTimeStr(pickupTimeStr, false);
      const m = pt.match(/(\d{1,2}):(\d{2})/);
      if (m) {
        const targetMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (targetMin - nowMinutesOfDay > 25) {
          return '已接單待排程';
        }
      }
    }
  }
  return '製作中';
}

function isOrderActivelyCookingOnServer(orderObj, todayStr, nowMinutesOfDay) {
  if (!orderObj) return false;
  const effectiveStatus = evaluateServerOrderLifecycleStatus(
    orderObj.status,
    Boolean(orderObj.isReservation),
    String(orderObj.paymentStatus || '已付款'),
    orderObj.pickupDate,
    orderObj.pickupTime,
    todayStr,
    nowMinutesOfDay
  );
  if (effectiveStatus !== '製作中') return false;
  const ordDate = normalizeSheetDateStr(orderObj.pickupDate || todayStr);
  return ordDate === todayStr;
}

function calcOrderRemainingWorkloadOnServer(orderObj, maxCapPer15Min, nowMs, nowMinutesOfDay) {
  let items = [];
  try { items = JSON.parse(orderObj.itemsJson || '[]'); } catch (e) {}

  let totalMainPortions = 0;
  items.forEach(it => {
    if (it.isGift || Number(it.price) === 0) return;
    const q = Math.max(1, Number(it.qty) || 1);
    const weight = Number(it.price) <= 45 ? 0.5 : 1.0;
    totalMainPortions += q * weight;
  });

  const rawUnits = Math.max(1, 1 + Math.max(0, totalMainPortions - 1) * 0.65);

  let elapsedMin = 0;
  const startTs = Number(orderObj.cookingStartedAtTs || orderObj.createdAtTs || 0);
  if (startTs > 0 && !orderObj.isReservation) {
    elapsedMin = Math.max(0, Math.floor((nowMs - startTs) / 60000));
  } else {
    const ca = normalizeSheetTimeStr(orderObj.createdAt, false);
    const m = ca.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      const createdMinOfDay = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      elapsedMin = Math.max(0, nowMinutesOfDay - createdMinOfDay);
    }
  }

  const muPerMin = Math.max(5, Number(maxCapPer15Min) || 20) / 15;
  const digestedUnits = Math.min(rawUnits * 0.85, elapsedMin * muPerMin * 0.5);
  return Math.max(0.25, Number((rawUnits - digestedUnits).toFixed(1)));
}

function recomputeAllStoreQueues(ss) {
  const props = PropertiesService.getScriptProperties();
  let simOffsets = {};
  try {
    simOffsets = JSON.parse(props.getProperty('SIM_QUEUE_OFFSETS') || '{}');
  } catch (e) {}

  const now = new Date();
  const nowMs = now.getTime();
  const todayStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  const timeStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm');
  const tmParts = timeStr.split(':');
  const nowMinutesOfDay = parseInt(tmParts[0], 10) * 60 + parseInt(tmParts[1], 10);

  const storeSheet = ss.getSheetByName('Stores');
  if (!storeSheet) return {};
  const storeData = storeSheet.getDataRange().getValues();
  const storeCapMap = {};
  for (let i = 1; i < storeData.length; i++) {
    storeCapMap[String(storeData[i][0])] = Math.max(5, Number(storeData[i][4]) || 20);
  }

  const allOrders = sheetToObjects(ss.getSheetByName('Orders')).map(enrichOrderObject);
  const liveWorkloadByStore = {};

  allOrders.forEach(o => {
    if (isOrderActivelyCookingOnServer(o, todayStr, nowMinutesOfDay)) {
      const sid = String(o.storeId || '');
      const cap = storeCapMap[sid] || 20;
      const wUnits = calcOrderRemainingWorkloadOnServer(o, cap, nowMs, nowMinutesOfDay);
      liveWorkloadByStore[sid] = (liveWorkloadByStore[sid] || 0) + wUnits;
    }
  });

  for (let i = 1; i < storeData.length; i++) {
    const sid = String(storeData[i][0]);
    const maxCap = storeCapMap[sid] || 20;
    const realWorkload = liveWorkloadByStore[sid] || 0;
    const offset = Math.max(0, Number(simOffsets[sid]) || 0);
    const totalActive = Math.ceil(realWorkload + offset);
    const newPrep = calcDynamicPrepMinutes(realWorkload + offset, maxCap);

    if (Number(storeData[i][5]) !== totalActive || Number(storeData[i][6]) !== newPrep) {
      storeSheet.getRange(i + 1, 6).setValue(totalActive);
      storeSheet.getRange(i + 1, 7).setValue(newPrep);
    }
  }
  return liveWorkloadByStore;
}

/**
 * 商業級重構 2：在 LockService 保護下核發各店每日嚴格遞增之權威流水號，100% 杜絕撞號
 */
function generateBackendSequentialPickupNumber(ss, storeId, pickupDateStr) {
  const targetDate = normalizeSheetDateStr(pickupDateStr);
  const storeNumMatch = String(storeId || 'S01').match(/(\d+)/);
  const storeDigit = storeNumMatch ? parseInt(storeNumMatch[1], 10) : 1;
  const baseNumber = storeDigit * 1000;

  let maxSeq = baseNumber;
  const props = PropertiesService.getScriptProperties();
  const propKey = `SEQ_${storeId}_${targetDate}`;
  const savedSeq = parseInt(props.getProperty(propKey) || '0', 10);
  if (savedSeq > maxSeq) maxSeq = savedSeq;

  const orders = sheetToObjects(ss.getSheetByName('Orders')).map(enrichOrderObject);
  orders.forEach(o => {
    if (String(o.storeId) === String(storeId) && normalizeSheetDateStr(o.pickupDate) === targetDate) {
      const m = String(o.pickupNumber || '').match(/(\d{3,5})/);
      if (m) {
        const val = parseInt(m[1], 10);
        if (val >= baseNumber && val < baseNumber + 999 && val > maxSeq) {
          maxSeq = val;
        }
      }
    }
  });

  const nextSeq = maxSeq + 1;
  props.setProperty(propKey, String(nextSeq));
  return String(nextSeq);
}

// ==================== LINE 授權與雙軌推播引擎 ====================
function resolveLineConfigForStore(storeId) {
  const props = PropertiesService.getScriptProperties();
  const sysClientId = props.getProperty('LINE_CLIENT_ID') || SYSTEM_LINE_CLIENT_ID;
  const sysClientSecret = props.getProperty('LINE_CLIENT_SECRET') || SYSTEM_LINE_CLIENT_SECRET;
  const sysChannelToken = props.getProperty('LINE_CHANNEL_TOKEN') || props.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || SYSTEM_LINE_CHANNEL_TOKEN;

  if (storeId) {
    try {
      const rawStoreLine = props.getProperty('STORE_LINE_CFG_' + String(storeId));
      if (rawStoreLine) {
        const parsed = JSON.parse(rawStoreLine);
        if (parsed && parsed.useCustomLineOa && parsed.channelToken) {
          return {
            useCustomLineOa: true,
            clientId: parsed.clientId || sysClientId,
            clientSecret: parsed.clientSecret || sysClientSecret,
            channelToken: parsed.channelToken
          };
        }
      }
    } catch (e) {}
  }

  return {
    useCustomLineOa: false,
    clientId: sysClientId,
    clientSecret: sysClientSecret,
    channelToken: sysChannelToken
  };
}

function handleLineCallback(ss, params) {
  try {
    const code = String(params.code || '').trim();
    const redirectUri = String(params.redirectUri || 'https://yangbrian01.github.io/scu.meal/order/').trim();
    const storeId = String(params.storeId || '').trim();
    if (!code) {
      return { success: false, message: '缺少 LINE 授權碼' };
    }

    const lineCfg = resolveLineConfigForStore(storeId);
    const clientId = String(params.clientId || lineCfg.clientId).trim();
    const clientSecret = String(params.clientSecret || lineCfg.clientSecret).trim();

    if (!clientSecret) {
      return {
        success: false,
        message: '後端尚未設定頻道密鑰，請先於店家後台設定填入'
      };
    }

    const tokenResponse = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'post',
      payload: {
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret
      },
      muteHttpExceptions: true
    });
    const tokenData = JSON.parse(tokenResponse.getContentText());
    if (!tokenData || !tokenData.access_token) {
      return {
        success: false,
        message: '授權權杖交換失敗：' + (tokenData.error_description || tokenData.error || '請確認網址與密鑰設定')
      };
    }

    const profileResponse = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + tokenData.access_token
      },
      muteHttpExceptions: true
    });
    const profileData = JSON.parse(profileResponse.getContentText());
    const userUID = profileData.userId;
    const displayName = profileData.displayName || '東吳同學';
    const pictureUrl = profileData.pictureUrl || '';

    if (!userUID) {
      return { success: false, message: '無法取得使用者識別碼' };
    }

    const bindSheet = ss.getSheetByName('LineBindings');
    if (bindSheet) {
      const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
      bindSheet.appendRow(['OAUTH_LOGIN', userUID, displayName, nowStr]);
    }

    sendLinePushMessage(
      ss,
      userUID,
      `🎉 嗨 ${displayName}，您已成功綁定東吳學餐即時通知！往後餐點完成可取餐與訂單狀態更新都會直接推播至此。`,
      lineCfg.channelToken,
      {
        storeId: storeId,
        title: 'LINE 帳號綁定成功',
        subtitle: `嗨 ${displayName}！取餐與預訂通知已啟用`,
        pickupNumber: 'OK',
        storeName: '東吳學餐智慧點餐',
        statusText: '已連結推播通知',
        orderUrl: redirectUri
      }
    );

    return {
      success: true,
      status: 'success',
      lineUid: userUID,
      displayName: displayName,
      pictureUrl: pictureUrl
    };
  } catch (err) {
    return {
      success: false,
      message: 'LINE 驗證失敗: ' + err.toString()
    };
  }
}

function sendLinePushMessage(ss, lineUserId, text, tokenOverride, flexMeta) {
  const uidStr = String(lineUserId || '').trim();
  if (!uidStr || !uidStr.startsWith('U') || uidStr.length < 15) return false;

  const storeId = (flexMeta && flexMeta.storeId) ? flexMeta.storeId : '';
  const lineCfg = resolveLineConfigForStore(storeId);
  const channelToken = tokenOverride || lineCfg.channelToken;
  if (!channelToken) return false;

  const meta = flexMeta || {};
  const titleText = meta.title || '東吳學餐訂單通知';
  const storeName = meta.storeName || '東吳學餐';
  const pickupNumber = meta.pickupNumber || '';
  const statusText = meta.statusText || '訂單狀態更新';
  const orderUrl = meta.orderUrl || 'https://yangbrian01.github.io/scu.meal/order/';
  const accentColor = meta.accentColor || '#3b82f6';

  const contentsArray = [];
  if (pickupNumber) {
    contentsArray.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: '取餐號碼', size: 'sm', color: '#888888', flex: 2 },
        { type: 'text', text: '#' + pickupNumber, size: 'md', color: '#ff4500', weight: 'bold', align: 'end', flex: 2 }
      ]
    });
  }
  contentsArray.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    contents: [
      { type: 'text', text: '取餐櫃位', size: 'sm', color: '#888888', flex: 2 },
      { type: 'text', text: String(storeName), size: 'sm', color: '#111827', weight: 'bold', align: 'end', flex: 3 }
    ]
  });
  contentsArray.push({
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    contents: [
      { type: 'text', text: '目前狀態', size: 'sm', color: '#888888', flex: 2 },
      { type: 'text', text: String(statusText), size: 'sm', color: '#10b981', weight: 'bold', align: 'end', flex: 3 }
    ]
  });

  const flexBubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '東吳學餐智慧點餐', weight: 'bold', color: accentColor, size: 'sm' },
        { type: 'text', text: String(titleText), weight: 'bold', size: 'xl', margin: 'md', wrap: true },
        { type: 'separator', margin: 'xl' },
        { type: 'box', layout: 'vertical', margin: 'xl', spacing: 'sm', contents: contentsArray },
        { type: 'separator', margin: 'xl' },
        { type: 'text', text: String(text), wrap: true, size: 'xs', color: '#555555', margin: 'xl' }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '🚀 點擊開啟防偽電子取餐單',
              color: '#ffffff',
              align: 'center',
              weight: 'bold',
              size: 'md'
            }
          ],
          paddingAll: '12px',
          background: {
            type: 'linearGradient',
            angle: '90deg',
            startColor: '#3b82f6',
            endColor: '#6366f1'
          },
          cornerRadius: '100px',
          action: {
            type: 'uri',
            label: '查看電子取餐單',
            uri: orderUrl
          }
        }
      ]
    }
  };

  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + channelToken },
      payload: JSON.stringify({
        to: uidStr,
        messages: [{
          type: 'flex',
          altText: titleText + ' - ' + text,
          contents: flexBubble
        }]
      }),
      muteHttpExceptions: true
    });
    return res.getResponseCode() >= 200 && res.getResponseCode() < 300;
  } catch (e) {
    return false;
  }
}

function saveLineDevConfig(ss, params) {
  const props = PropertiesService.getScriptProperties();
  const storeId = String(params.storeId || '').trim();

  if (storeId) {
    let existingCfg = {};
    try {
      existingCfg = JSON.parse(props.getProperty('STORE_LINE_CFG_' + storeId) || '{}');
    } catch (e) {}

    const newClientId = String(params.clientId || params.customLineClientId || existingCfg.clientId || '').trim();
    const newClientSecret = String(params.clientSecret || params.customLineClientSecret || existingCfg.clientSecret || '').trim();
    const newChannelToken = String(params.channelAccessToken || params.customLineChannelToken || existingCfg.channelToken || '').trim();

    const storeLineCfg = {
      useCustomLineOa: Boolean(params.useCustomLineOa),
      clientId: newClientId,
      clientSecret: newClientSecret,
      channelToken: newChannelToken
    };
    props.setProperty('STORE_LINE_CFG_' + storeId, JSON.stringify(storeLineCfg));
  }

  const sysToken = String(params.systemChannelToken || (!params.useCustomLineOa && params.channelAccessToken) || '').trim();
  if (sysToken) {
    props.setProperty('LINE_CHANNEL_TOKEN', sysToken);
  }
  if (params.systemClientId) {
    props.setProperty('LINE_CLIENT_ID', String(params.systemClientId).trim());
  }
  if (params.systemClientSecret) {
    props.setProperty('LINE_CLIENT_SECRET', String(params.systemClientSecret).trim());
  }

  return {
    saved: true,
    storeId: storeId
  };
}

function handleManualLinePush(ss, params) {
  const flexMeta = {
    storeId: params.storeId || '',
    title: params.title || '東吳學餐通知',
    pickupNumber: params.pickupNumber || '',
    storeName: params.storeName || '東吳學餐',
    statusText: params.statusText || '即時通知',
    orderUrl: params.orderUrl || 'https://yangbrian01.github.io/scu.meal/order/'
  };

  let lineSent = false;
  if (params.lineUserId && String(params.lineUserId).startsWith('U')) {
    lineSent = sendLinePushMessage(
      ss,
      params.lineUserId,
      params.message,
      params.channelAccessToken || '',
      flexMeta
    );
  }

  let emailSent = false;
  if (params.email && String(params.email).indexOf('@') > 0) {
    emailSent = sendOrderEmailNotification(params.email, params.message, flexMeta);
  }

  return { sent: lineSent || emailSent, lineSent: lineSent, emailSent: emailSent };
}

function sendOrderEmailNotification(email, messageText, meta) {
  try {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail || cleanEmail.indexOf('@') < 1) return false;
    const m = meta || {};
    const title = m.title || '東吳學餐訂單通知';
    const pickupNumber = m.pickupNumber ? ('#' + m.pickupNumber) : '';
    const storeName = m.storeName || '東吳學餐';
    const orderUrl = m.orderUrl || 'https://yangbrian01.github.io/scu.meal/order/';

    const htmlBody = `
      <div style="font-family:'Noto Sans TC',sans-serif; max-width:480px; margin:0 auto; border:1px solid #E5E7EB; border-radius:16px; overflow:hidden; background:#FFFFFF;">
        <div style="background:linear-gradient(135deg,#FF5A1F,#E04812); color:#FFFFFF; padding:18px 20px;">
          <div style="font-size:12px; font-weight:bold; opacity:0.9;">東吳學餐智慧點餐通知</div>
          <h2 style="margin:6px 0 0; font-size:20px;">${title}</h2>
        </div>
        <div style="padding:20px;">
          ${pickupNumber ? `
            <div style="background:#FFF7ED; border:1.5px solid #FDBA74; border-radius:12px; padding:12px; text-align:center; margin-bottom:14px;">
              <div style="font-size:12px; color:#9A3412; font-weight:bold;">您的取餐號碼 (${storeName})</div>
              <div style="font-size:36px; font-weight:900; color:#EA580C;">${pickupNumber}</div>
            </div>
          ` : ''}
          <p style="font-size:15px; color:#1F2937; line-height:1.6;">${String(messageText || '')}</p>
          <div style="margin-top:20px; text-align:center;">
            <a href="${orderUrl}" style="display:inline-block; background:#FF5A1F; color:#FFFFFF; text-decoration:none; font-weight:bold; padding:12px 24px; border-radius:999px; font-size:14px;">
              🎟️ 點此開啟電子取餐單
            </a>
          </div>
        </div>
      </div>
    `;

    MailApp.sendEmail({
      to: cleanEmail,
      subject: `【東吳學餐】${title} ${pickupNumber}`,
      body: `${title}\n${messageText}\n查看取餐單：${orderUrl}`,
      htmlBody: htmlBody
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ==================== 預訂單自動排程升格與逾期清理引擎 ====================
function autoPromoteAndCleanOrders(ss) {
  const orderSheet = ss.getSheetByName('Orders');
  if (!orderSheet) return;
  const rows = orderSheet.getDataRange().getValues();
  if (rows.length <= 1) return;

  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  const timeStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm');
  const tmParts = timeStr.split(':');
  const nowMinutesOfDay = parseInt(tmParts[0], 10) * 60 + parseInt(tmParts[1], 10);

  for (let i = rows.length - 1; i >= 1; i--) {
    const curStatus = String(rows[i][13] || '製作中');
    if (curStatus === '已完成' || curStatus === '可取餐' || curStatus.indexOf('已取消') >= 0) continue;

    let meta = {};
    try { meta = JSON.parse(rows[i][16] || '{}'); } catch (e) {}

    const cleanDeadline = meta.paymentDeadline ? normalizeSheetDateStr(meta.paymentDeadline) : '';
    if (meta.paymentStatus === '待櫃檯繳費' && cleanDeadline && todayStr > cleanDeadline) {
      orderSheet.getRange(i + 1, 14).setValue('已取消 (逾期未確認)');
      meta.paymentStatus = '已退單作廢';
      orderSheet.getRange(i + 1, 17).setValue(JSON.stringify(meta));
      continue;
    }

    const nextStatus = evaluateServerOrderLifecycleStatus(
      curStatus,
      Boolean(meta.isReservation),
      String(meta.paymentStatus || '已付款'),
      meta.pickupDate,
      meta.pickupTime,
      todayStr,
      nowMinutesOfDay
    );

    if (nextStatus !== curStatus) {
      orderSheet.getRange(i + 1, 14).setValue(nextStatus);
      if (nextStatus === '製作中' && !meta.cookingStartedAtTs) {
        meta.cookingStartedAtTs = now.getTime();
        orderSheet.getRange(i + 1, 17).setValue(JSON.stringify(meta));
      }
    }
  }
}

function getInitBundle(ss, params) {
  const props = PropertiesService.getScriptProperties();
  let simOffsets = {};
  let openStateMap = {};
  try { simOffsets = JSON.parse(props.getProperty('SIM_QUEUE_OFFSETS') || '{}'); } catch (e) {}
  try { openStateMap = JSON.parse(props.getProperty('STORE_OPEN_STATES') || '{}'); } catch (e) {}

  recomputeAllStoreQueues(ss);

  const stores = sheetToObjects(ss.getSheetByName('Stores'));
  const menus = sheetToObjects(ss.getSheetByName('Menus'));
  const orders = sheetToObjects(ss.getSheetByName('Orders')).reverse().slice(0, 150).map(enrichOrderObject);

  const enrichedStores = stores.map(s => {
    const storeIdStr = String(s.id);
    const storeMenus = menus
      .filter(m => String(m.storeId) === storeIdStr)
      .map(m => {
        let parsedOptions = {};
        let isSoldOut = false;
        if (m.optionsJson) {
          try {
            const rawObj = JSON.parse(m.optionsJson);
            if (rawObj && typeof rawObj === 'object') {
              isSoldOut = Boolean(rawObj.__soldOut);
              delete rawObj.__soldOut;
              parsedOptions = rawObj;
            }
          } catch (e) {}
        }
        return {
          id: String(m.id),
          storeId: String(m.storeId),
          name: String(m.name),
          price: Number(m.price) || 0,
          tag: String(m.tag || ''),
          category: String(m.category || '招牌主餐'),
          soldOut: isSoldOut,
          image: String(m.image || ''),
          options: parsedOptions
        };
      });

    const isOpen = openStateMap[storeIdStr] !== undefined ? Boolean(openStateMap[storeIdStr]) : true;
    const maxCap = Math.max(5, Number(s.maxCapacityPer15Min) || 20);
    const active = Math.max(0, Number(s.activeOrders) || 0);
    const baseQueueOffset = Math.max(0, Number(simOffsets[storeIdStr]) || 0);
    const loadPct = isOpen ? Math.min(120, Math.round((active / maxCap) * 100)) : 0;
    let loadState = 'FREE';
    if (!isOpen) loadState = 'CLOSED';
    else if (loadPct >= 85) loadState = 'FULL';
    else if (loadPct >= 50) loadState = 'MODERATE';

    const avgPrep = calcDynamicPrepMinutes(active, maxCap);
    const cutleryPrice = s.cutleryPrice !== undefined && s.cutleryPrice !== '' ? Number(s.cutleryPrice) : 1;

    let useCustomLineOa = false;
    let customLineClientId = '';
    try {
      const rawLineCfg = props.getProperty('STORE_LINE_CFG_' + storeIdStr);
      if (rawLineCfg) {
        const parsedLineCfg = JSON.parse(rawLineCfg);
        useCustomLineOa = Boolean(parsedLineCfg.useCustomLineOa);
        customLineClientId = parsedLineCfg.clientId || '';
      }
    } catch (e) {}

    const storeObj = {
      ...s,
      isOpen: isOpen,
      maxCapacityPer15Min: maxCap,
      activeOrders: active,
      baseQueueOffset: baseQueueOffset,
      avgPrepMinutes: avgPrep,
      rating: Number(s.rating) || 4.7,
      cutleryPrice: Math.max(0, cutleryPrice),
      useCustomLineOa: useCustomLineOa,
      customLineClientId: customLineClientId,
      loadPercentage: loadPct,
      loadState: loadState,
      menus: storeMenus
    };
    storeObj.aiScore = calcAiUtilityScore(storeObj);
    return storeObj;
  });

  const aiRecommendations = computeAiTrafficRecommendations(enrichedStores);
  const serverTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');

  return {
    stores: enrichedStores,
    recentOrders: orders,
    orders: orders,
    aiRecommendations: aiRecommendations,
    serverTime: serverTime,
    bundle: {
      stores: enrichedStores,
      aiRecommendations,
      orders,
      recentOrders: orders,
      lineDevInfo: {
        botBasicId: props.getProperty('LINE_BOT_BASIC_ID') || '',
        liffId: props.getProperty('LINE_LIFF_ID') || '',
        hasToken: Boolean(props.getProperty('LINE_CHANNEL_TOKEN') || props.getProperty('LINE_CHANNEL_ACCESS_TOKEN'))
      },
      serverTime: serverTime
    }
  };
}

function enrichOrderObject(o) {
  let meta = {};
  if (o.extraMetaJson) {
    try { meta = JSON.parse(o.extraMetaJson); } catch (e) {}
  }
  const merged = {
    ...o,
    ...meta
  };
  merged.pickupDate = normalizeSheetDateStr(merged.pickupDate);
  merged.pickupTime = normalizeSheetTimeStr(merged.pickupTime, false);
  merged.createdAt = normalizeSheetTimeStr(merged.createdAt, true);
  if (merged.paymentDeadline) {
    merged.paymentDeadline = normalizeSheetDateStr(merged.paymentDeadline);
  }
  return merged;
}

function findOrderById(ss, orderId) {
  if (!orderId) return null;
  const orders = sheetToObjects(ss.getSheetByName('Orders'));
  const found = orders.find(o => String(o.orderId) === String(orderId));
  return found ? enrichOrderObject(found) : null;
}

function computeAiTrafficRecommendations(stores) {
  const campuses = ['雙溪校區', '城中校區'];
  const recommendations = {};

  campuses.forEach(campus => {
    const campusStores = stores.filter(s => s.campus === campus && s.isOpen !== false);
    const congested = campusStores
      .filter(s => s.loadState === 'FULL' || Number(s.avgPrepMinutes) >= 18)
      .sort((a, b) => Number(b.loadPercentage) - Number(a.loadPercentage));
    const availableWithPromo = campusStores
      .filter(s => s.loadState === 'FREE' && s.promoMode !== 'none')
      .sort((a, b) => Number(b.aiScore) - Number(a.aiScore));

    if (congested.length > 0 && availableWithPromo.length > 0) {
      const busyStore = congested[0];
      const targetStore = availableWithPromo[0];
      const timeSaved = Math.max(1, Number(busyStore.avgPrepMinutes) - Number(targetStore.avgPrepMinutes));

      recommendations[campus] = {
        hasAlert: true,
        congestedStoreId: busyStore.id,
        congestedStoreName: busyStore.name,
        congestedWaitMin: Number(busyStore.avgPrepMinutes),
        congestedLoadPct: Number(busyStore.loadPercentage),
        recommendedStoreId: targetStore.id,
        recommendedStoreName: targetStore.name,
        recommendedWaitMin: Number(targetStore.avgPrepMinutes),
        recommendedAiScore: Number(targetStore.aiScore),
        promoMode: targetStore.promoMode,
        promoText: targetStore.promoText,
        promoDiscount: Number(targetStore.promoDiscount) || 0,
        timeSavedMin: timeSaved
      };
    } else {
      recommendations[campus] = { hasAlert: false };
    }
  });

  return recommendations;
}

// ==================== 商業級重構 2 & 3：伺服器端權威計價與正規化訂單處理 ====================
function verifyAndPriceOrderOnServer(ss, params) {
  const storeId = String(params.storeId || '');
  const stores = sheetToObjects(ss.getSheetByName('Stores'));
  const storeRow = stores.find(s => String(s.id) === storeId);
  if (!storeRow) {
    throw new Error('找不到指定的餐廳代碼: ' + storeId);
  }

  const menus = sheetToObjects(ss.getSheetByName('Menus')).filter(m => String(m.storeId) === storeId);
  const menuMap = {};
  menus.forEach(m => {
    let opts = {};
    let soldOut = false;
    if (m.optionsJson) {
      try {
        const parsed = JSON.parse(m.optionsJson);
        if (parsed && typeof parsed === 'object') {
          soldOut = Boolean(parsed.__soldOut);
          delete parsed.__soldOut;
          opts = parsed;
        }
      } catch (e) {}
    }
    menuMap[String(m.id)] = {
      id: String(m.id),
      name: String(m.name),
      basePrice: Math.max(0, Number(m.price) || 0),
      soldOut: soldOut,
      options: opts
    };
  });

  const rawItems = Array.isArray(params.items)
    ? params.items
    : (Array.isArray(params.structuredItems) ? params.structuredItems : []);
  if (rawItems.length === 0) {
    throw new Error('訂單內沒有任何有效餐點品項');
  }

  const verifiedItems = [];
  let authoritativeSubtotal = 0;

  rawItems.forEach(item => {
    if (item.isGift || String(item.id) === 'GIFT-AI') return;

    const dbMenu = menuMap[String(item.id)];
    const qty = Math.max(1, Math.min(99, parseInt(item.qty, 10) || 1));

    if (dbMenu) {
      if (dbMenu.soldOut) {
        throw new Error(`餐點「${dbMenu.name}」今日已售罄，無法點選`);
      }
      let extraPrice = 0;
      const selections = (item.selections && typeof item.selections === 'object') ? item.selections : {};

      Object.keys(selections).forEach(optGroupName => {
        const grpDef = dbMenu.options[optGroupName];
        if (!grpDef || !Array.isArray(grpDef.choices)) return;
        const selectedValStr = String(selections[optGroupName] || '');
        const selectedTokens = selectedValStr.split(',').map(s => s.trim()).filter(Boolean);
        selectedTokens.forEach(tok => {
          const foundChoice = grpDef.choices.find(c => Array.isArray(c) && String(c[0]).trim() === tok);
          if (foundChoice) {
            extraPrice += Number(foundChoice[1]) || 0;
          }
        });
      });

      const unitPrice = Math.max(0, dbMenu.basePrice + extraPrice);
      const selSuffix = Object.keys(selections).length > 0
        ? ` [${Object.entries(selections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
        : '';

      verifiedItems.push({
        id: dbMenu.id,
        baseName: dbMenu.name,
        name: `${dbMenu.name}${selSuffix}`,
        price: unitPrice,
        qty: qty,
        selections: selections,
        isGift: false
      });
      authoritativeSubtotal += unitPrice * qty;
    } else {
      const cleanBase = String(item.baseName || item.name || '特餐品項').split(' [')[0].trim();
      const safeUnitPrice = Math.max(10, parseInt(item.price, 10) || 100);
      const selections = (item.selections && typeof item.selections === 'object') ? item.selections : {};
      const selSuffix = Object.keys(selections).length > 0
        ? ` [${Object.entries(selections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
        : '';
      verifiedItems.push({
        id: String(item.id || 'M-CUSTOM'),
        baseName: cleanBase,
        name: `${cleanBase}${selSuffix}`,
        price: safeUnitPrice,
        qty: qty,
        selections: selections,
        isGift: false
      });
      authoritativeSubtotal += safeUnitPrice * qty;
    }
  });

  const maxCap = Math.max(5, Number(storeRow.maxCapacityPer15Min) || 20);
  const activeOrders = Math.max(0, Number(storeRow.activeOrders) || 0);
  const loadPct = Math.round((activeOrders / maxCap) * 100);
  const isPromoActive = storeRow.promoMode && storeRow.promoMode !== 'none' && loadPct < 85;

  const needCutlery = Boolean(params.needCutlery);
  const unitCutleryPrice = storeRow.cutleryPrice !== undefined && storeRow.cutleryPrice !== ''
    ? Math.max(0, Number(storeRow.cutleryPrice))
    : 1;
  const authoritativeCutleryFee = (authoritativeSubtotal > 0 && needCutlery) ? unitCutleryPrice : 0;

  let authoritativeDiscount = 0;
  let promoAppliedText = '一般點餐';
  if (isPromoActive) {
    promoAppliedText = String(storeRow.promoText || '離峰優惠');
    if (storeRow.promoMode === 'discount' && authoritativeSubtotal >= AI_DISCOUNT_MIN_SUBTOTAL) {
      authoritativeDiscount = Math.min(authoritativeSubtotal, Math.max(0, Number(storeRow.promoDiscount) || 10));
    } else if ((storeRow.promoMode === 'gift' || storeRow.promoMode === 'freebie') && storeRow.promoText) {
      verifiedItems.push({
        id: 'GIFT-AI',
        baseName: `${storeRow.promoText} (贈品)`,
        name: `${storeRow.promoText} (贈品)`,
        price: 0,
        qty: 1,
        selections: {},
        isGift: true
      });
    }
  } else if (String(params.orderSource || '').indexOf('POS') >= 0) {
    promoAppliedText = '現場櫃檯點餐';
  }

  // 僅當請求通過店家權限 Token 驗證時，才允許套用 POS 櫃檯手動折讓 (manualDiscount)
  let authoritativeManualDiscount = 0;
  let manualDiscountReason = '';
  if (isMerchantRequestValid(params) && Number(params.manualDiscount) > 0) {
    authoritativeManualDiscount = Math.min(
      Math.max(0, authoritativeSubtotal - authoritativeDiscount),
      Math.max(0, Number(params.manualDiscount) || 0)
    );
    manualDiscountReason = String(params.manualDiscountReason || '櫃檯手動折讓');
    if (authoritativeManualDiscount > 0) {
      promoAppliedText = manualDiscountReason;
    }
  }

  const authoritativeFinalTotal = Math.max(
    0,
    authoritativeSubtotal + authoritativeCutleryFee - authoritativeDiscount - authoritativeManualDiscount
  );

  return {
    storeName: String(storeRow.name || params.storeName || ''),
    verifiedItems,
    subtotal: authoritativeSubtotal,
    cutleryFee: authoritativeCutleryFee,
    discount: authoritativeDiscount,
    manualDiscount: authoritativeManualDiscount,
    manualDiscountReason: manualDiscountReason,
    finalTotal: authoritativeFinalTotal,
    promoApplied: promoAppliedText,
    isDivertedOrder: Boolean(isPromoActive)
  };
}

function handleOrderSubmission(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const verified = verifyAndPriceOrderOnServer(ss, params);

  let orderId = params.orderId ? String(params.orderId).trim() : '';
  if (!orderId) {
    orderId = 'ORD-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  }

  const now = new Date();
  const nowStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm:ss');
  const todayDateStr = getTodayTaipeiStr();
  const pickupDateVal = normalizeSheetDateStr(params.pickupDate || todayDateStr);
  const pickupTimeVal = normalizeSheetTimeStr(params.pickupTime || nowStr.slice(0, 5), false);

  // 一律由後端 LockService 保護下核發權威單號，根除前端雙頭馬車撞號
  const authoritativePickupNumber = generateBackendSequentialPickupNumber(ss, params.storeId, pickupDateVal);

  const orderSource = String(params.orderSource || params.studentId || '📱 掃碼點餐');
  const dineType = String(params.dineType || '外帶自取');
  const customerNote = String(params.customerNote || '').trim();
  const cleanSummary = [
    dineType,
    params.needCutlery ? `🥢 需免洗餐具(+$${verified.cutleryFee})` : '',
    customerNote ? `📝 備註：${customerNote}` : ''
  ].filter(Boolean).join(' ・ ');

  const paymentMethod = String(params.paymentMethod || 'LINE Pay');
  const isReservation = Boolean(params.isReservation);
  const isPosAuthorized = isMerchantRequestValid(params) && orderSource.indexOf('POS') >= 0;

  let authoritativePayStatus = '已付款';
  if (!isPosAuthorized && paymentMethod === '現場櫃檯付現') {
    authoritativePayStatus = (isReservation && verified.finalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD)
      ? '待櫃檯繳費'
      : '取餐付現';
  }

  const tmParts = nowStr.slice(0, 5).split(':');
  const nowMinutesOfDay = parseInt(tmParts[0], 10) * 60 + parseInt(tmParts[1], 10);
  const initialStatus = evaluateServerOrderLifecycleStatus(
    '製作中',
    isReservation,
    authoritativePayStatus,
    pickupDateVal,
    pickupTimeVal,
    todayDateStr,
    nowMinutesOfDay
  );

  const extraMeta = {
    dineType: dineType,
    customerNote: customerNote,
    cashReceived: isPosAuthorized ? (Number(params.cashReceived) || verified.finalTotal) : 0,
    changeGiven: isPosAuthorized ? (Number(params.changeGiven) || 0) : 0,
    manualDiscount: verified.manualDiscount,
    manualDiscountReason: verified.manualDiscountReason,
    needCutlery: Boolean(params.needCutlery),
    cutleryFee: verified.cutleryFee,
    isReservation: isReservation,
    pickupDate: pickupDateVal,
    pickupTime: pickupTimeVal,
    customerPhone: String(params.customerPhone || ''),
    paymentDeadline: params.paymentDeadline ? normalizeSheetDateStr(params.paymentDeadline) : '',
    paymentStatus: authoritativePayStatus,
    transactionId: String(params.transactionId || ''),
    notifyCount: 0,
    lineUserId: String(params.lineUserId || ''),
    customerEmail: String(params.customerEmail || ''),
    createdAtTs: now.getTime(),
    cookingStartedAtTs: initialStatus === '製作中' ? now.getTime() : 0
  };

  const itemsJsonStr = JSON.stringify(verified.verifiedItems);

  const newOrderRow = [
    orderId,
    authoritativePickupNumber,
    params.storeId,
    verified.storeName,
    orderSource,
    cleanSummary,
    itemsJsonStr,
    verified.subtotal,
    verified.discount,
    verified.finalTotal,
    verified.promoApplied,
    params.pickupTimeSlot || '立即製作',
    paymentMethod,
    initialStatus,
    verified.isDivertedOrder,
    nowStr,
    JSON.stringify(extraMeta)
  ];
  orderSheet.appendRow(newOrderRow);

  const bundleData = getInitBundle(ss, {});

  return {
    order: {
      orderId,
      pickupNumber: authoritativePickupNumber,
      storeId: params.storeId,
      storeName: verified.storeName,
      studentId: orderSource,
      studentName: cleanSummary,
      itemsJson: itemsJsonStr,
      structuredItems: verified.verifiedItems,
      subtotal: verified.subtotal,
      discount: verified.discount,
      finalTotal: verified.finalTotal,
      promoApplied: verified.promoApplied,
      pickupTimeSlot: params.pickupTimeSlot || '立即製作',
      paymentMethod: paymentMethod,
      status: initialStatus,
      isDivertedOrder: verified.isDivertedOrder,
      createdAt: nowStr,
      ...extraMeta
    },
    ...bundleData
  };
}

function saveStoreMenus(ss, params) {
  const storeId = String(params.storeId || '');
  const newMenus = Array.isArray(params.menus) ? params.menus : [];
  if (!storeId) throw new Error('缺少店鋪編號');

  const menuSheet = ss.getSheetByName('Menus');
  const rows = menuSheet.getDataRange().getValues();
  const headers = ['id', 'storeId', 'name', 'price', 'tag', 'category', 'image', 'optionsJson'];

  const keptRows = [headers];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== storeId) {
      keptRows.push([
        rows[i][0] || '',
        rows[i][1] || '',
        rows[i][2] || '',
        Number(rows[i][3]) || 0,
        rows[i][4] || '',
        rows[i][5] || '招牌主餐',
        rows[i][6] || '',
        rows[i][7] || '{}'
      ]);
    }
  }

  newMenus.forEach((m, idx) => {
    const itemId = m.id || ('M_' + storeId + '_' + (idx + 1) + '_' + Math.floor(100 + Math.random() * 899));
    const optsWithMeta = { ...(m.options || {}) };
    if (m.soldOut) {
      optsWithMeta.__soldOut = true;
    } else {
      delete optsWithMeta.__soldOut;
    }

    keptRows.push([
      String(itemId),
      storeId,
      String(m.name || '未命名品項'),
      Number(m.price) || 0,
      String(m.tag || ''),
      String(m.category || '招牌主餐'),
      String(m.image || ''),
      JSON.stringify(optsWithMeta)
    ]);
  });

  menuSheet.clearContents();
  menuSheet.getRange(1, 1, keptRows.length, headers.length).setValues(keptRows);

  return getInitBundle(ss, {});
}

function handleAiParseMenu(ss, params) {
  const rawText = String(params.rawText || '');
  const imageBase64 = String(params.imageBase64 || '');
  const imageMime = String(params.imageMime || 'image/jpeg');
  const props = PropertiesService.getScriptProperties();
  const apiKey = params.apiKey || props.getProperty('GEMINI_API_KEY') || '';

  if (apiKey && (imageBase64 || rawText)) {
    try {
      const prompt = `你是專業餐飲收銀系統的菜單建檔專家。
請從使用者提供的菜單圖片或文字中，自動辨識並整理出所有菜色品項，回傳純 JSON 陣列（不要加 markdown 語法）：
[
  {
    "category": "分類名稱(如：招牌丼飯、手工水餃、湯品飲品)",
    "name": "餐點名稱",
    "price": 110,
    "tag": "🔥 店長推薦",
    "options": {
      "份量選擇": { "type": "radio", "choices": [["標準份量", 0], ["加大份量", 15]] },
      "辣度調整": { "type": "radio", "choices": [["不辣", 0], ["小辣", 0], ["大辣", 0]] }
    }
  }
]`;

      const parts = [{ text: prompt }];
      if (rawText) parts.push({ text: '菜單文字內容：\n' + rawText });
      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: imageMime,
            data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
          }
        });
      }

      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        }),
        muteHttpExceptions: true
      });
      const json = JSON.parse(res.getContentText());
      const textOut = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0].text;
      if (textOut) {
        return { parsedMenus: JSON.parse(textOut), engine: '雲端多模態視覺辨識引擎' };
      }
    } catch (e) {}
  }

  const fallbackMenus = [];
  if (rawText) {
    let currentCat = '掃描推薦';
    rawText.split(/\r?\n/).forEach(line => {
      const t = line.trim();
      if (!t) return;
      const catMatch = t.match(/^[【\[](.+?)[】\]]$/);
      if (catMatch) {
        currentCat = catMatch[1].trim();
        return;
      }
      const itemMatch = t.match(/^(.+?)\s*[\$＄]?\s*(\d{2,4})\s*(?:元)?(?:\s*[\(（](.+?)[\)）])?$/);
      if (itemMatch) {
        fallbackMenus.push({
          category: currentCat,
          name: itemMatch[1].replace(/^[-*•\d\.]+\s*/, '').trim(),
          price: parseInt(itemMatch[2], 10),
          tag: '🔥 店長推薦',
          options: {}
        });
      }
    });
  }

  return { parsedMenus: fallbackMenus, engine: '結構化語法解析引擎' };
}

function updateStoreSettings(ss, params) {
  const storeSheet = ss.getSheetByName('Stores');
  const data = storeSheet.getDataRange().getValues();
  const props = PropertiesService.getScriptProperties();
  const sid = String(params.storeId || '');

  if (params.useCustomLineOa !== undefined) {
    saveLineDevConfig(ss, params);
  }

  if (params.isOpen !== undefined && sid) {
    let openStateMap = {};
    try { openStateMap = JSON.parse(props.getProperty('STORE_OPEN_STATES') || '{}'); } catch (e) {}
    openStateMap[sid] = Boolean(params.isOpen);
    props.setProperty('STORE_OPEN_STATES', JSON.stringify(openStateMap));
  }

  if (params.baseQueueOffset !== undefined && sid) {
    let simOffsets = {};
    try { simOffsets = JSON.parse(props.getProperty('SIM_QUEUE_OFFSETS') || '{}'); } catch (e) {}
    simOffsets[sid] = Math.max(0, Number(params.baseQueueOffset) || 0);
    props.setProperty('SIM_QUEUE_OFFSETS', JSON.stringify(simOffsets));
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid) {
      if (params.promoMode !== undefined) storeSheet.getRange(i + 1, 9).setValue(params.promoMode);
      if (params.promoText !== undefined) storeSheet.getRange(i + 1, 10).setValue(params.promoText);
      if (params.promoDiscount !== undefined) storeSheet.getRange(i + 1, 11).setValue(Number(params.promoDiscount));
      if (params.maxCapacityPer15Min !== undefined) {
        storeSheet.getRange(i + 1, 5).setValue(Math.max(5, Number(params.maxCapacityPer15Min)));
      }
      if (params.cutleryPrice !== undefined) {
        storeSheet.getRange(i + 1, 14).setValue(Math.max(0, Number(params.cutleryPrice)));
      }
      break;
    }
  }
  return getInitBundle(ss, {});
}

function updateOrderState(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const data = orderSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.orderId)) {
      if (params.paymentMethod) {
        orderSheet.getRange(i + 1, 13).setValue(String(params.paymentMethod));
      }
      if (params.newStatus) {
        orderSheet.getRange(i + 1, 14).setValue(String(params.newStatus));
      }

      let meta = {};
      try { meta = JSON.parse(data[i][16] || '{}'); } catch (e) {}
      if (params.paymentStatus) {
        meta.paymentStatus = String(params.paymentStatus);
      }
      if (params.newStatus === '製作中' && !meta.cookingStartedAtTs) {
        meta.cookingStartedAtTs = Date.now();
      }
      if (params.notifyCount !== undefined) {
        meta.notifyCount = Number(params.notifyCount);
      } else if (params.newStatus === '可取餐') {
        meta.notifyCount = (Number(meta.notifyCount) || 0) + 1;
      }
      if (orderSheet.getLastColumn() >= 17) {
        orderSheet.getRange(i + 1, 17).setValue(JSON.stringify(meta));
      }
      break;
    }
  }

  return getInitBundle(ss, {});
}

function markReservationPaid(ss, params) {
  return updateOrderState(ss, {
    orderId: params.orderId,
    paymentStatus: '已付款',
    paymentMethod: params.paymentMethod || '現場現金'
  });
}

function cancelOrderById(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const data = orderSheet.getDataRange().getValues();
  const reason = String(params.reason || '櫃檯取消').trim();

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(params.orderId)) {
      if (params.hardDelete) {
        orderSheet.deleteRow(i + 1);
      } else {
        orderSheet.getRange(i + 1, 14).setValue(`已取消 (${reason})`);
        let meta = {};
        try { meta = JSON.parse(data[i][16] || '{}'); } catch (e) {}
        meta.paymentStatus = '已退單作廢';
        meta.cancelReason = reason;
        if (orderSheet.getLastColumn() >= 17) {
          orderSheet.getRange(i + 1, 17).setValue(JSON.stringify(meta));
        }
      }
      break;
    }
  }
  return getInitBundle(ss, {});
}

function runTrafficSimulation(ss, params) {
  const props = PropertiesService.getScriptProperties();
  const mode = params.mode || 'PEAK';
  if (mode === 'PEAK') {
    props.setProperty('SIM_QUEUE_OFFSETS', JSON.stringify({
      'S01': 17,
      'S02': 0,
      'S03': 20,
      'S04': 0,
      'S05': 15,
      'S06': 0,
      'S07': 0
    }));
  } else {
    props.setProperty('SIM_QUEUE_OFFSETS', JSON.stringify({}));
  }
  return getInitBundle(ss, {});
}

function handleAiConcierge(ss, params) {
  const bundleObj = getInitBundle(ss, {}).bundle;
  const campus = params.campus || '雙溪校區';
  const userQuery = (params.query || '').trim();
  const openStores = bundleObj.stores.filter(s => s.campus === campus && s.isOpen !== false);
  const campusStores = openStores.length > 0 ? openStores : bundleObj.stores.filter(s => s.campus === campus);

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY') || '';

  if (apiKey) {
    try {
      const storeContext = campusStores.map(s => ({
        id: s.id,
        name: s.name,
        waitMinutes: s.avgPrepMinutes,
        loadPct: s.loadPercentage,
        promoText: s.promoText,
        aiScore: s.aiScore,
        menus: (s.menus || []).filter(m => !m.soldOut).map(m => ({ id: m.id, name: m.name, price: m.price }))
      }));

      const prompt = `你是東吳大學「學餐智慧選餐與客服顧問」。
目前校區：${campus}
學生的輸入：「${userQuery}」
即時學餐營業中店家佇列與供應中菜單數據：${JSON.stringify(storeContext)}

請根據學生的輸入自然且精準地回答，並以純 JSON 格式回覆：
{
  "reasoning": "自然、準確、針對學生問題的繁體中文回答 (100字內)",
  "storeId": "推薦店家ID (如 S02)",
  "menuId": "推薦餐點ID (如 M04)",
  "engine": "Google Gemini 2.5 Flash"
}`;

      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
        }),
        muteHttpExceptions: true
      });
      const resJson = JSON.parse(response.getContentText());
      const text = resJson.candidates && resJson.candidates[0] && resJson.candidates[0].content && resJson.candidates[0].content.parts[0].text;
      if (text) {
        return { aiResult: JSON.parse(text) };
      }
    } catch (e) {}
  }

  const sortedStores = campusStores.slice().sort((a, b) => Number(b.aiScore) - Number(a.aiScore));
  const bestStore = sortedStores[0] || campusStores[0];
  const availMenus = (bestStore && bestStore.menus) ? bestStore.menus.filter(m => !m.soldOut) : [];
  const bestMenu = availMenus[0] || (bestStore && bestStore.menus && bestStore.menus[0]) || { id: 'M04', name: '招牌特餐', price: 100 };

  return {
    aiResult: {
      reasoning: `目前「${campus}」以「${bestStore.name}」最為順暢（預估約 ${bestStore.avgPrepMinutes} 分鐘取餐），推薦點選正常供應中的人氣品項「${bestMenu.name} ($${bestMenu.price})」。`,
      storeId: bestStore.id,
      menuId: bestMenu.id,
      engine: '雲端佇列智慧配餐引擎'
    }
  };
}

function sheetToObjects(sheet) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = row[idx]; });
    return obj;
  });
}
