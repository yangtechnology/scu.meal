/**
 * ============================================================================
 * 東吳學餐智慧點餐與全螢幕平板收銀系統 - 商業企業版雲端後端引擎 (Google Apps Script v14.0 Pro)
 * ============================================================================
 * 核心架構與資安升級：
 * 1. 常數時間比對 (Constant-Time Comparison) + 4~8 碼店務 PIN + 綁定 storeId 之 HMAC Session Token
 * 2. 最小權限原則 (Least Privilege)：學生端僅回傳本人 myOrderIds 與時段配額統計，絕不廣播他人訂單
 * 3. 雙重驗證精準查單：強制要求「6碼防偽碼 / 完整ORD號」或「4碼取餐號 + 手機末3碼雙重吻合」
 * 4. 嚴格白名單計價 + 預訂時段 15 分鐘產能配額檢查 + 午間尖峰預訂排除離峰優惠
 * 5. 出餐口 3 分鐘緩衝權重模型 + 伺服器內部自動觸發 LINE / Email 推播（關閉公開濫發端點）
 * 6. 零斷層菜單原子更新（廢除先 clearContent 清空整張表的危險操作）
 */

const SHEET_ID = '1G0wZqT0xoPParVZIFEWRdXpiZNmFlAAhiX89c3t7OiY';
const DB_SCHEMA_VERSION = 'MEALFLOW_SCHEMA_V14_0';
const AI_DISCOUNT_MIN_SUBTOTAL = 60;
const LARGE_ORDER_DEPOSIT_THRESHOLD = 500;
const SESSION_TTL_MS = 8 * 3600 * 1000; // 店務 Session Token 效期 8 小時
const ORDERS_TAIL_WINDOW_SIZE = 400;    // 滑動視窗：僅掃描最近 400 筆活躍訂單，保護 GAS 記憶體與執行時間

const scriptProps = PropertiesService.getScriptProperties();
const SYSTEM_LINE_CLIENT_ID = scriptProps.getProperty('LINE_CLIENT_ID') || '2012260287';
const SYSTEM_LINE_CLIENT_SECRET = scriptProps.getProperty('LINE_CLIENT_SECRET') || '';
const SYSTEM_LINE_CHANNEL_TOKEN = scriptProps.getProperty('LINE_CHANNEL_TOKEN') || scriptProps.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';

// ==================== HTTP 路由入口 (讀寫分離架構) ====================
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  if (params.action === 'getOrder' && params.orderId) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const hasMerchantAuth = isMerchantRequestValid(params, '');
    return jsonResponse({
      success: true,
      order: findOrderById(ss, params.orderId, hasMerchantAuth)
    });
  }

  return jsonResponse({
    success: true,
    service: '東吳學餐智慧點餐雲端引擎 Commercial v14.0 Pro',
    status: 'ONLINE'
  });
}

function doPost(e) {
  try {
    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const params = JSON.parse(rawBody);
    const action = String(params.action || '').trim();
    const ss = SpreadsheetApp.openById(SHEET_ID);

    ensureDatabaseInitialized(ss, Boolean(params.forceInit));

    // 唯讀或非競爭型請求不搶用全域寫入鎖，大幅提升中午尖峰吞吐量
    const READ_ONLY_ACTIONS = {
      'initBundle': true,
      'getOrder': true,
      'lookupOrders': true,
      'askAiConcierge': true,
      'verifyMerchantPin': true,
      'aiParseMenu': true
    };

    if (READ_ONLY_ACTIONS[action]) {
      maybeRunBackgroundMaintenance(ss);
      const readResult = dispatchAction(ss, action, params);
      return jsonResponse({ success: true, ...readResult });
    }

    // 寫入型請求：進入互斥鎖保護區
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return jsonResponse({
        success: false,
        message: '系統尖峰結帳處理中，請稍候 2 秒再試'
      });
    }

    try {
      autoPromoteAndCleanOrdersBatch(ss);
      const writeResult = dispatchAction(ss, action, params);
      return jsonResponse({ success: true, ...writeResult });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({
      success: false,
      message: err && err.message ? err.message : String(err)
    });
  }
}

function dispatchAction(ss, action, params) {
  switch (action) {
    // 公開端點與安全驗證查詢端點
    case 'initBundle':
      return getInitBundle(ss, params);
    case 'getOrder':
      return { order: findOrderById(ss, params.orderId, isMerchantRequestValid(params, '')) };
    case 'lookupOrders':
      return lookupOrdersAcrossDevices(ss, params);
    case 'submitOrder':
      return handleOrderSubmission(ss, params);
    case 'askAiConcierge':
      return handleAiConcierge(ss, params);
    case 'handleLineCallback':
      return handleLineCallback(ss, params);

    // 店務授權端點 (核發與更新具備 storeId 範圍之 HMAC Session Token)
    case 'verifyMerchantPin':
      return handleVerifyMerchantPin(params);
    case 'updateMerchantPin':
    case 'updateMerchantPinHash':
      assertMerchantAuthorized(params, params.storeId || '');
      return handleUpdateMerchantPin(params);

    // 受 HMAC Session Token 與店鋪權限範圍嚴格保護之店務寫入端點
    case 'updateStoreConfig':
      assertMerchantAuthorized(params, params.storeId || '');
      return updateStoreSettings(ss, params);
    case 'saveStoreMenus':
    case 'saveStoreMenu':
      assertMerchantAuthorized(params, params.storeId || '');
      return saveStoreMenusAtomic(ss, params);
    case 'aiParseMenu':
      assertMerchantAuthorized(params, params.storeId || '');
      return handleAiParseMenu(ss, params);
    case 'updateOrderStatus':
      assertMerchantAuthorized(params, '');
      return updateOrderStateBatch(ss, params);
    case 'markReservationPaid':
      assertMerchantAuthorized(params, '');
      return markReservationPaid(ss, params);
    case 'cancelOrder':
      assertMerchantAuthorized(params, '');
      return cancelOrderByIdBatch(ss, params);
    case 'simulateTraffic':
      assertMerchantAuthorized(params, '');
      return runTrafficSimulation(ss, params);
    case 'saveLineDevConfig':
      assertMerchantAuthorized(params, params.storeId || '');
      return saveLineDevConfig(ss, params);
    case 'sendLinePush':
      // 【資安修補 7】關閉未授權公開推播，僅允許持有合法店務 Session Token 者手動觸發
      assertMerchantAuthorized(params, params.storeId || '');
      return handleManualLinePush(ss, params);

    default:
      throw new Error('未知的操作請求: ' + action);
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== 1. 常數時間比對、4~8 碼各店獨立 PIN 驗證與時效 HMAC Session Token ====================
function getServerSecretKey() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('MEALFLOW_SERVER_HMAC_SECRET_V12');
  if (!secret) {
    secret = Utilities.getUuid() + '_' + Utilities.getUuid() + '_' + Date.now();
    props.setProperty('MEALFLOW_SERVER_HMAC_SECRET_V12', secret);
  }
  return secret;
}

function computeHmacHex(message, keyStr) {
  const sig = Utilities.computeHmacSha256Signature(String(message || ''), String(keyStr || ''), Utilities.Charset.UTF_8);
  return sig.map(b => {
    const v = (b < 0) ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

/**
 * 常數時間字串比對 (Constant-Time String Comparison)，防止透過回應時間差猜測 HMAC 或 PIN Hash
 */
function constantTimeEquals(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  if (strA.length !== strB.length || strA.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= (strA.charCodeAt(i) ^ strB.charCodeAt(i));
  }
  return diff === 0;
}

function hashMerchantPinWithServerSalt(rawPin) {
  const secret = getServerSecretKey();
  return computeHmacHex('PIN_AUTH_V12:' + String(rawPin || '').trim(), secret);
}

function getStoredMasterPinHash() {
  const props = PropertiesService.getScriptProperties();
  let savedHash = props.getProperty('MERCHANT_PIN_HMAC_V12');
  if (!savedHash) {
    savedHash = hashMerchantPinWithServerSalt('8888');
    props.setProperty('MERCHANT_PIN_HMAC_V12', savedHash);
  }
  return savedHash;
}

function getStoredStorePinHash(storeId) {
  if (!storeId) return '';
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('MERCHANT_PIN_HMAC_STORE_' + String(storeId).trim()) || '';
}

function issueMerchantSessionToken(storeScope) {
  const cleanScope = String(storeScope || 'ALL').trim() || 'ALL';
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const nonce = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  const payloadStr = `${expiresAt}_${nonce}_${cleanScope}`;
  const sigHex = computeHmacHex(payloadStr, getServerSecretKey());
  return {
    sessionToken: `${payloadStr}.${sigHex}`,
    expiresAt: expiresAt,
    authorizedStoreId: cleanScope
  };
}

function parseVerifiedMerchantSession(params) {
  if (!params) return null;
  const token = String(params.merchantAuthToken || '').trim();
  if (!token || token.indexOf('.') < 0) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const payloadStr = parts[0];
  const providedSig = parts[1];
  const expectedSig = computeHmacHex(payloadStr, getServerSecretKey());
  if (!constantTimeEquals(providedSig, expectedSig)) return null;

  const payloadParts = payloadStr.split('_');
  const expiresAt = Number(payloadParts[0] || 0);
  const tokenScope = String(payloadParts[2] || 'ALL');
  if (!expiresAt || Date.now() > expiresAt) {
    return null;
  }
  return { expiresAt: expiresAt, storeScope: tokenScope };
}

function isMerchantRequestValid(params, requiredStoreId) {
  const session = parseVerifiedMerchantSession(params);
  if (!session) return false;
  const targetStore = String(requiredStoreId || '').trim();
  if (targetStore && session.storeScope !== 'ALL' && session.storeScope !== targetStore) {
    return false;
  }
  return true;
}

function assertMerchantAuthorized(params, requiredStoreId) {
  if (!isMerchantRequestValid(params, requiredStoreId)) {
    throw new Error('店務管理權限驗證失敗、跨店越權或時效憑證已過期 (Unauthorized)，請重新輸入該店授權碼解鎖');
  }
}

function handleVerifyMerchantPin(params) {
  const rawPin = String(params.pin || '').trim();
  const requestedStoreId = String(params.storeId || '').trim();
  if (!rawPin || !/^\d{4,8}$/.test(rawPin)) {
    throw new Error('請輸入有效的 4 至 8 位數店務管理授權碼');
  }

  const candidateHash = hashMerchantPinWithServerSalt(rawPin);
  const storeSpecificHash = getStoredStorePinHash(requestedStoreId);
  const masterHash = getStoredMasterPinHash();

  if (storeSpecificHash && constantTimeEquals(candidateHash, storeSpecificHash)) {
    const tokenObj = issueMerchantSessionToken(requestedStoreId);
    return {
      verified: true,
      sessionToken: tokenObj.sessionToken,
      expiresAt: tokenObj.expiresAt,
      authorizedStoreId: tokenObj.authorizedStoreId
    };
  }

  if (constantTimeEquals(candidateHash, masterHash)) {
    const tokenObj = issueMerchantSessionToken('ALL');
    return {
      verified: true,
      sessionToken: tokenObj.sessionToken,
      expiresAt: tokenObj.expiresAt,
      authorizedStoreId: tokenObj.authorizedStoreId
    };
  }

  throw new Error('店務授權碼錯誤，拒絕存取');
}

function handleUpdateMerchantPin(params) {
  const newPin = String(params.newPin || '').trim();
  const targetStoreId = String(params.storeId || '').trim();
  if (!/^\d{4,8}$/.test(newPin)) {
    throw new Error('新授權碼必須為 4 至 8 位數字');
  }

  const session = parseVerifiedMerchantSession(params);
  const newHash = hashMerchantPinWithServerSalt(newPin);
  const props = PropertiesService.getScriptProperties();

  if (!targetStoreId || (session && session.storeScope === 'ALL')) {
    props.setProperty('MERCHANT_PIN_HMAC_V12', newHash);
  }
  if (targetStoreId) {
    props.setProperty('MERCHANT_PIN_HMAC_STORE_' + targetStoreId, newHash);
  }

  const nextScope = (session && session.storeScope === 'ALL') ? 'ALL' : (targetStoreId || 'ALL');
  const tokenObj = issueMerchantSessionToken(nextScope);
  return {
    updated: true,
    sessionToken: tokenObj.sessionToken,
    expiresAt: tokenObj.expiresAt,
    authorizedStoreId: tokenObj.authorizedStoreId
  };
}

function generateOrderVerificationCodeOnServer(orderId, pickupNumber, finalTotal) {
  const sig = computeHmacHex(`${orderId || ''}|${pickupNumber || ''}|${Number(finalTotal) || 0}`, getServerSecretKey());
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    const byteVal = parseInt(sig.slice(i * 2, i * 2 + 2), 16) || 0;
    code += alphabet[byteVal % alphabet.length];
  }
  return code;
}

function generateStableMenuItemIdOnServer(storeId, itemName) {
  const cleanName = String(itemName || '').trim();
  const cleanStore = String(storeId || 'S00').trim().toUpperCase();
  let h = 2166136261;
  const raw = `${cleanStore}::${cleanName}`;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hexSuffix = (h >>> 0).toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
  return `M-${cleanStore}-${hexSuffix}`;
}

function extractPhoneLast3OnServer(phoneVal) {
  const digits = String(phoneVal || '').replace(/\D/g, '');
  return digits.length >= 3 ? digits.slice(-3) : '';
}

function maskPhoneForPublic(phoneVal) {
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

function sanitizeOrderForClientOutput(orderObj, hasMerchantFullAccess) {
  if (!orderObj) return null;
  const clone = { ...orderObj };
  const last3 = extractPhoneLast3OnServer(clone.customerPhone);
  clone.customerPhoneLast3 = last3;
  if (!hasMerchantFullAccess) {
    clone.customerPhone = maskPhoneForPublic(clone.customerPhone);
    delete clone.lineUserId;
    delete clone.customerEmail;
  }
  return clone;
}

// ==================== 2. 日期、時間與尖峰時段檢查工具 ====================
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
    return Utilities.formatDate(parsed, 'Asia/Taipei', fmt);
  }
  return includeSeconds ? '12:15:00' : '12:15';
}

/**
 * 判斷指定時段是否屬於學餐午間尖峰時段 (11:45 ~ 12:45)
 * 預訂午間尖峰時段不適用離峰分流折扣與贈品
 */
function isPeakHourSlotOnServer(timeStr) {
  const clean = normalizeSheetTimeStr(timeStr, false);
  const m = clean.match(/(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return mins >= (11 * 60 + 45) && mins <= (12 * 60 + 45);
}

/**
 * 彙整各店各 15 分鐘時段區間已接單數量 (Slot Quota Map)，供前端顯示剩餘配額與後端防超賣
 */
function buildSlotQuotaMap(ordersList) {
  const quotaMap = {};
  (ordersList || []).forEach(o => {
    if (!o || String(o.status || '').indexOf('已取消') >= 0) return;
    const sid = String(o.storeId || '');
    const dStr = normalizeSheetDateStr(o.pickupDate);
    const tStr = normalizeSheetTimeStr(o.pickupTime, false);
    if (!sid || !dStr || !tStr) return;
    const key = `${sid}_${dStr}_${tStr}`;
    quotaMap[key] = (quotaMap[key] || 0) + 1;
  });
  return quotaMap;
}

// ==================== 3. 資料庫結構初始化與高效能滑動視窗 I/O 工具 ====================
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
      'promoMode', 'promoText', 'promoDiscount', 'predictedDailyOrders', 'rating', 'cutleryPrice', 'basePrepMinutes'
    ]);
    const defaultStores = [
      ['S01', '雙溪校區', '趙班長海苔飯捲', '人氣韓式・飯捲', 18, 0, 4, true, 'none', '無優惠', 0, 240, 4.9, 1, 4],
      ['S02', '雙溪校區', '雙溪-丼物園', '日式蓋飯・烏龍麵', 20, 0, 5, true, 'gift', '🎁 離峰分流招待：免費溫泉蛋乙顆', 0, 165, 4.7, 1, 5],
      ['S03', '雙溪校區', '雙溪-四海遊龍', '鍋貼水餃・麵食', 25, 0, 6, true, 'none', '無優惠', 0, 210, 4.6, 1, 6],
      ['S04', '雙溪校區', '蒲家廚房', '中式特餐・便當', 20, 0, 4, true, 'discount', '💰 離峰分流折抵：現折 $10 元', 10, 150, 4.8, 1, 4],
      ['S05', '城中校區', '城中-咖哩食堂', '熟成咖哩・炸物', 15, 0, 5, true, 'none', '無優惠', 0, 195, 4.8, 1, 5],
      ['S06', '城中校區', '城中-吳葉食堂', '精緻台式簡餐', 20, 0, 6, true, 'gift', '🎁 離峰分流招待：免費招牌冰紅茶', 0, 145, 4.9, 1, 6],
      ['S07', '城中校區', '大熊涼麵 X 吃好食堂', '手工涼麵・味噌湯', 25, 0, 2, true, 'points', '⚡ 離峰分流回饋：雙倍點數', 0, 160, 4.7, 1, 2]
    ];
    storeSheet.getRange(2, 1, defaultStores.length, defaultStores[0].length).setValues(defaultStores);
  } else {
    if (storeSheet.getLastColumn() < 14) storeSheet.getRange(1, 14).setValue('cutleryPrice');
    if (storeSheet.getLastColumn() < 15) storeSheet.getRange(1, 15).setValue('basePrepMinutes');
  }

  let menuSheet = ss.getSheetByName('Menus');
  if (!menuSheet) {
    menuSheet = ss.insertSheet('Menus');
    menuSheet.appendRow(['id', 'storeId', 'name', 'price', 'tag', 'category', 'image', 'optionsJson', 'soldOut']);

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
      ['M01', 'S01', '特製韓式泡菜燒肉飯捲', 75, '🔥 必點人氣', '韓式海苔飯捲', '', stdRiceOpts, false],
      ['M02', 'S01', '起司炸蝦海苔飯捲', 85, '⭐ 主廚推薦', '韓式海苔飯捲', '', stdRiceOpts, false],
      ['M03', 'S01', '經典鮪魚玉米飯捲', 65, '⚡ 快速出餐', '韓式海苔飯捲', '', stdRiceOpts, false],
      ['M18', 'S01', '釜山魚板蘿蔔湯', 35, '🥣 暖胃湯品', '韓式湯品與飲品', '', '{}', false],
      ['M22', 'S01', '韓國水蜜桃果粒飲', 40, '🥤 人氣飲品', '韓式湯品與飲品', '', JSON.stringify({ '冰塊調整': { type: 'radio', choices: [['正常冰', 0], ['去冰', 0]] } }), false],
      ['M04', 'S02', '炙燒起司牛五花丼', 115, '🔥 招牌必點', '炙燒日式丼飯', '', stdRiceOpts, false],
      ['M05', 'S02', '黃金厚切豬排滑蛋丼', 120, '⭐ 飽足首選', '炙燒日式丼飯', '', stdRiceOpts, false],
      ['M06', 'S02', '讚岐胡麻冷烏龍麵', 95, '⚡ 3分極速出餐', '讚岐烏龍麵', '', stdNoodleOpts, false],
      ['M19', 'S02', '日式唐揚炸雞 (5塊)', 55, '🍗 人氣單點', '單點炸物與茶飲', '', JSON.stringify({ '調味粉': { type: 'radio', choices: [['原味胡椒', 0], ['日式七味粉', 0], ['泰式酸辣醬', 5]] } }), false],
      ['M23', 'S02', '靜岡無糖玄米綠茶', 30, '🍵 解膩首選', '單點炸物與茶飲', '', '{}', false],
      ['M07', 'S03', '招牌脆皮鍋貼 (10顆)', 70, '🔥 經典酥脆', '手工鍋貼與水餃', '', dumplingSetOpts, false],
      ['M08', 'S03', '高麗菜鮮肉水餃 (10顆)', 70, '⚡ 飽滿多汁', '手工鍋貼與水餃', '', dumplingSetOpts, false],
      ['M25', 'S03', '韓式辣味鮮肉水餃 (10顆)', 75, '🌶️ 香辣過癮', '手工鍋貼與水餃', '', dumplingSetOpts, false],
      ['M24', 'S03', '招牌酸辣湯', 35, '🥣 經典絕配', '開胃小菜與湯飲', '', JSON.stringify({ '胡椒與醋': { type: 'radio', choices: [['正常', 0], ['加辣油', 0], ['不加蔥香菜', 0]] } }), false],
      ['M20', 'S03', '非基改冰鎮豆漿', 25, '🥛 清涼飲品', '開胃小菜與湯飲', '', JSON.stringify({ '甜度': { type: 'radio', choices: [['微糖', 0], ['無糖', 0]] } }), false],
      ['M09', 'S04', '秘製椒麻雞腿飯 (含3配菜)', 110, '🔥 銷量冠軍', '人氣特餐便當', '', stdRiceOpts, false],
      ['M10', 'S04', '蒜泥白肉精緻便當 (含3配菜)', 100, '⚡ 極速便當', '人氣特餐便當', '', stdRiceOpts, false],
      ['M21', 'S04', '黃金脆皮炸豆腐', 40, '✨ 招牌小菜', '單點小菜與湯品', '', '{}', false],
      ['M11', 'S05', '唐揚炸雞熟成咖哩飯', 125, '🔥 排隊人氣', '熟成濃咖哩', '', stdRiceOpts, false],
      ['M12', 'S05', '手打漢堡排歐姆蛋咖哩', 135, '⭐ 限量供應', '熟成濃咖哩', '', stdRiceOpts, false],
      ['M26', 'S05', '酥炸莫札瑞拉起司條 (3入)', 50, '🧀 邪惡點心', '炸物點心', '', '{}', false],
      ['M13', 'S06', '蔥爆牛肉鐵板簡餐', 115, '🔥 現點現做', '主廚鐵板與簡餐', '', stdRiceOpts, false],
      ['M14', 'S06', '古早味排骨特餐', 105, '⚡ 4分極速取餐', '主廚鐵板與簡餐', '', stdRiceOpts, false],
      ['M15', 'S06', '手工鮮蝦紅油抄手麵', 90, '⭐ 學生最愛', '特色麵食', '', stdNoodleOpts, false],
      ['M16', 'S07', '川味麻辣雞絲涼麵 (大)', 75, '⚡ 2分秒取', '手工現拌涼麵', '', stdNoodleOpts, false],
      ['M17', 'S07', '綜合三合一味噌湯 (貢丸+蛋花)', 45, '🔥 絕配湯品', '招牌味噌湯品', '', '{}', false]
    ];
    menuSheet.getRange(2, 1, defaultMenus.length, defaultMenus[0].length).setValues(defaultMenus);
  } else if (menuSheet.getLastColumn() < 9) {
    menuSheet.getRange(1, 9).setValue('soldOut');
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

function sheetToObjects(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(h => String(h || '').trim());
  const list = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row[0] === '' || row[0] === null || row[0] === undefined) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = row[c];
    }
    list.push(obj);
  }
  return list;
}

function readSheetTailObjects(sheet, maxTailRows) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(17, sheet.getLastColumn());
  if (lastRow <= 1) return [];

  const limit = Math.max(10, Number(maxTailRows) || ORDERS_TAIL_WINDOW_SIZE);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const startRow = Math.max(2, lastRow - limit + 1);
  const numRows = lastRow - startRow + 1;
  const rows = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const obj = { __sheetRowIndex: startRow + i };
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = row[c];
    }
    list.push(obj);
  }
  return list;
}

function locateOrderRowById(orderSheet, orderId) {
  const cleanId = String(orderId || '').trim();
  if (!orderSheet || !cleanId) return null;

  const lastRow = orderSheet.getLastRow();
  if (lastRow <= 1) return null;

  const tailCount = Math.min(lastRow - 1, ORDERS_TAIL_WINDOW_SIZE);
  const startRow = lastRow - tailCount + 1;
  const rows = orderSheet.getRange(startRow, 1, tailCount, 17).getValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]).trim() === cleanId) {
      return {
        sheetRowIndex: startRow + i,
        rowValues: rows[i]
      };
    }
  }

  const finder = orderSheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(cleanId).matchEntireCell(true);
  const matchedCell = finder.findNext();
  if (matchedCell) {
    const rIdx = matchedCell.getRow();
    const rowVals = orderSheet.getRange(rIdx, 1, 1, 17).getValues()[0];
    return {
      sheetRowIndex: rIdx,
      rowValues: rowVals
    };
  }
  return null;
}

function rowArrayToOrderObject(rowVals) {
  if (!rowVals || !rowVals[0]) return null;
  return enrichOrderObject({
    orderId: rowVals[0],
    pickupNumber: rowVals[1],
    storeId: rowVals[2],
    storeName: rowVals[3],
    studentId: rowVals[4],
    studentName: rowVals[5],
    itemsJson: rowVals[6],
    subtotal: rowVals[7],
    discount: rowVals[8],
    finalTotal: rowVals[9],
    promoApplied: rowVals[10],
    pickupTimeSlot: rowVals[11],
    paymentMethod: rowVals[12],
    status: rowVals[13],
    isDivertedOrder: rowVals[14],
    createdAt: rowVals[15],
    extraMetaJson: rowVals[16]
  });
}

function findOrderById(ss, orderId, hasMerchantFullAccess = false) {
  const orderSheet = ss.getSheetByName('Orders');
  const located = locateOrderRowById(orderSheet, orderId);
  if (!located) return null;
  const enriched = rowArrayToOrderObject(located.rowValues);
  return sanitizeOrderForClientOutput(enriched, hasMerchantFullAccess);
}

// ==================== 4. 真實餐點複雜度、出餐口 3 分鐘緩衝與平滑等待時間演算法 ====================
function calcServerItemComplexityWeight(item) {
  if (!item || item.isGift || Number(item.price) === 0) return 0.15;
  const name = String(item.baseName || item.name || '');
  const selCount = item.selections ? Object.keys(item.selections).length : 0;
  const customFactor = Math.min(0.35, selCount * 0.08);

  if (name.indexOf('茶') >= 0 || name.indexOf('飲') >= 0 || name.indexOf('豆漿') >= 0) return 0.25 + customFactor;
  if (name.indexOf('湯') >= 0 || name.indexOf('豆腐') >= 0 || name.indexOf('起司條') >= 0 || name.indexOf('炸雞') >= 0) return 0.55 + customFactor;
  if (name.indexOf('鐵板') >= 0 || name.indexOf('鍋貼') >= 0 || name.indexOf('水餃') >= 0 || name.indexOf('炸蝦') >= 0 || name.indexOf('豬排') >= 0 || name.indexOf('漢堡排') >= 0) return 1.25 + customFactor;
  if (name.indexOf('涼麵') >= 0) return 0.65 + customFactor;
  return 1.0 + customFactor;
}

function calcDynamicPrepMinutes(activeWorkloadUnits, maxCap, storeBasePrepMin) {
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

/**
 * 除「製作中」外，剛按「可取餐」3 分鐘內的出餐口待領訂單亦計入緩衝負荷
 */
function isOrderActivelyCookingOnServer(orderObj, todayStr, nowMinutesOfDay, nowMs) {
  if (!orderObj) return false;
  const ordDate = normalizeSheetDateStr(orderObj.pickupDate || todayStr);
  if (ordDate !== todayStr) return false;

  const effectiveStatus = evaluateServerOrderLifecycleStatus(
    orderObj.status,
    Boolean(orderObj.isReservation),
    String(orderObj.paymentStatus || '已付款'),
    orderObj.pickupDate,
    orderObj.pickupTime,
    todayStr,
    nowMinutesOfDay
  );
  if (effectiveStatus === '製作中') return true;
  if (effectiveStatus === '可取餐' && orderObj.readyAtTs && (nowMs - Number(orderObj.readyAtTs)) < 180000) {
    return true;
  }
  return false;
}

function calcOrderRemainingWorkloadOnServer(orderObj, maxCapPer15Min, nowMs, nowMinutesOfDay) {
  if (String(orderObj.status) === '可取餐') {
    return 0.35; // 出餐口裝袋與交付緩衝權重
  }

  let items = [];
  try { items = JSON.parse(orderObj.itemsJson || '[]'); } catch (e) {}

  let totalWeightedUnits = 0;
  items.forEach(it => {
    const q = Math.max(1, Number(it.qty) || 1);
    totalWeightedUnits += q * calcServerItemComplexityWeight(it);
  });

  const rawUnits = Math.max(0.6, 0.7 + totalWeightedUnits * 0.75);

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
  const digestedUnits = Math.min(rawUnits * 0.85, elapsedMin * muPerMin * 0.6);
  return Math.max(0.25, Number((rawUnits - digestedUnits).toFixed(2)));
}

function maybeRunBackgroundMaintenance(ss) {
  const cache = CacheService.getScriptCache();
  if (cache && cache.get('MAINT_THROTTLE_V14')) {
    return;
  }
  const lock = LockService.getScriptLock();
  if (lock.tryLock(250)) {
    try {
      autoPromoteAndCleanOrdersBatch(ss);
      if (cache) cache.put('MAINT_THROTTLE_V14', '1', 45);
    } finally {
      lock.releaseLock();
    }
  }
}

function autoPromoteAndCleanOrdersBatch(ss) {
  const orderSheet = ss.getSheetByName('Orders');
  if (!orderSheet) return;
  const lastRow = orderSheet.getLastRow();
  if (lastRow <= 1) return;

  const tailCount = Math.min(lastRow - 1, ORDERS_TAIL_WINDOW_SIZE);
  const startRow = lastRow - tailCount + 1;
  const range = orderSheet.getRange(startRow, 1, tailCount, 17);
  const rows = range.getValues();

  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  const timeStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm');
  const tmParts = timeStr.split(':');
  const nowMinutesOfDay = parseInt(tmParts[0], 10) * 60 + parseInt(tmParts[1], 10);

  for (let i = 0; i < rows.length; i++) {
    const curStatus = String(rows[i][13] || '製作中');
    if (curStatus === '已完成' || curStatus === '可取餐' || curStatus.indexOf('已取消') >= 0) continue;

    let meta = {};
    try { meta = JSON.parse(rows[i][16] || '{}'); } catch (e) {}

    const cleanDeadline = meta.paymentDeadline ? normalizeSheetDateStr(meta.paymentDeadline) : '';
    if (meta.paymentStatus === '待櫃檯繳費' && cleanDeadline && todayStr > cleanDeadline) {
      const targetRowIdx = startRow + i;
      meta.paymentStatus = '已退單作廢';
      orderSheet.getRange(targetRowIdx, 14).setValue('已取消 (逾期未確認)');
      orderSheet.getRange(targetRowIdx, 17).setValue(JSON.stringify(meta));
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
      const targetRowIdx = startRow + i;
      orderSheet.getRange(targetRowIdx, 14).setValue(nextStatus);
      if (nextStatus === '製作中' && !meta.cookingStartedAtTs) {
        meta.cookingStartedAtTs = now.getTime();
        orderSheet.getRange(targetRowIdx, 17).setValue(JSON.stringify(meta));
      }
    }
  }
}

function recomputeAllStoreQueuesInMemory(ss, recentOrdersEnriched, persistToSheet = false) {
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
  const storeRange = storeSheet.getDataRange();
  const storeData = storeRange.getValues();

  const storeMetaMap = {};
  for (let i = 1; i < storeData.length; i++) {
    const sid = String(storeData[i][0]);
    storeMetaMap[sid] = {
      maxCap: Math.max(5, Number(storeData[i][4]) || 20),
      basePrep: Number(storeData[i][14]) || 4
    };
  }

  const liveWorkloadByStore = {};
  recentOrdersEnriched.forEach(o => {
    if (isOrderActivelyCookingOnServer(o, todayStr, nowMinutesOfDay, nowMs)) {
      const sid = String(o.storeId || '');
      const cap = storeMetaMap[sid] ? storeMetaMap[sid].maxCap : 20;
      const wUnits = calcOrderRemainingWorkloadOnServer(o, cap, nowMs, nowMinutesOfDay);
      liveWorkloadByStore[sid] = (liveWorkloadByStore[sid] || 0) + wUnits;
    }
  });

  const computedMap = {};
  let sheetChanged = false;

  for (let i = 1; i < storeData.length; i++) {
    const sid = String(storeData[i][0]);
    const maxCap = storeMetaMap[sid].maxCap;
    const basePrep = storeMetaMap[sid].basePrep;
    const realWorkload = liveWorkloadByStore[sid] || 0;
    const offset = Math.max(0, Number(simOffsets[sid]) || 0);
    const totalActive = Math.ceil(realWorkload + offset);
    const newPrep = calcDynamicPrepMinutes(realWorkload + offset, maxCap, basePrep);

    computedMap[sid] = { activeOrders: totalActive, avgPrepMinutes: newPrep, basePrepMinutes: basePrep };

    if (Number(storeData[i][5]) !== totalActive || Number(storeData[i][6]) !== newPrep) {
      storeData[i][5] = totalActive;
      storeData[i][6] = newPrep;
      sheetChanged = true;
    }
  }

  if (persistToSheet && sheetChanged) {
    storeRange.setValues(storeData);
  }
  return computedMap;
}

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

  const tailOrders = readSheetTailObjects(ss.getSheetByName('Orders'), ORDERS_TAIL_WINDOW_SIZE).map(enrichOrderObject);
  tailOrders.forEach(o => {
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

// ==================== 5. 【資安修補 3】雙重驗證跨裝置訂單查詢 (杜絕盲猜遍歷) ====================
function lookupOrdersAcrossDevices(ss, params) {
  const hasMerchantAuth = isMerchantRequestValid(params, '');
  let rawQ = String(params.query || '').trim().toUpperCase().replace(/^#/, '');
  let rawPhoneLast3 = extractPhoneLast3OnServer(params.phoneLast3 || '');

  if (!rawQ) return { orders: [] };

  // 支援 "2003 678" 或 "2003-678" 複合格式
  const comboMatch = rawQ.match(/^(\d{4,5})[\s\-_,/]+(\d{3})$/);
  if (comboMatch) {
    rawQ = comboMatch[1];
    rawPhoneLast3 = comboMatch[2];
  }

  const isFullOrderId = rawQ.indexOf('ORD-') === 0 && rawQ.length >= 10;
  const isSixCharHmacCode = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(rawQ);
  const isFourDigitPickup = /^\d{4,5}$/.test(rawQ);

  // 未授權之公開查詢：嚴格要求「完整 ORD 編號」、「6 碼 HMAC 防偽碼」或「取餐號 + 手機末 3 碼雙重吻合」
  if (!hasMerchantAuth && !isFullOrderId && !isSixCharHmacCode) {
    if (!isFourDigitPickup || rawPhoneLast3.length !== 3) {
      throw new Error('為保護點餐隱私，跨裝置查詢請輸入「6 碼防偽核銷碼」，或「4 碼取餐號 + 手機末 3 碼」雙重驗證');
    }
  }

  const tailOrders = readSheetTailObjects(ss.getSheetByName('Orders'), ORDERS_TAIL_WINDOW_SIZE)
    .reverse()
    .map(enrichOrderObject);

  const matched = tailOrders.filter(o => {
    const ordId = String(o.orderId || '').toUpperCase();
    const pickNum = String(o.pickupNumber || '').toUpperCase();
    const verCode = String(o.verificationCode || '').toUpperCase();
    const ordLast3 = extractPhoneLast3OnServer(o.customerPhone);

    if (isFullOrderId && ordId === rawQ) return true;
    if (isSixCharHmacCode && verCode === rawQ) return true;
    if (isFourDigitPickup) {
      if (hasMerchantAuth && pickNum === rawQ) return true;
      if (pickNum === rawQ && rawPhoneLast3.length === 3 && ordLast3 === rawPhoneLast3) return true;
    }
    return false;
  });

  return {
    orders: matched.slice(0, 10).map(o => sanitizeOrderForClientOutput(o, hasMerchantAuth))
  };
}

// ==================== 6. LINE 授權與伺服器內部雙軌自動推播引擎 ====================
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

/**
 * 伺服器內部自動觸發訂單狀態 LINE / Email 雙軌推播（無須前端暴露公開推播 API）
 */
function dispatchOrderNotificationOnServer(ss, orderObj, titleText, messageText, statusLabel) {
  if (!orderObj) return;
  const orderUrl = `https://yangbrian01.github.io/scu.meal/order/?id=${encodeURIComponent(orderObj.orderId)}`;
  const flexMeta = {
    storeId: orderObj.storeId || '',
    title: titleText,
    pickupNumber: orderObj.pickupNumber || '',
    storeName: orderObj.storeName || '東吳學餐',
    statusText: statusLabel || orderObj.status || '即時通知',
    orderUrl: orderUrl
  };

  if (orderObj.lineUserId && String(orderObj.lineUserId).indexOf('U') === 0) {
    sendLinePushMessage(ss, orderObj.lineUserId, messageText, '', flexMeta);
  }
  if (orderObj.customerEmail && String(orderObj.customerEmail).indexOf('@') > 0) {
    sendOrderEmailNotification(orderObj.customerEmail, messageText, flexMeta);
  }
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

// ==================== 7. 【資安修補 3】讀取系統 Bundle (最小權限原則 + 時段配額映射表) ====================
function parseMenuRowOptionsAndSoldOut(menuRowObj) {
  let parsedOptions = {};
  let legacySoldOut = false;
  if (menuRowObj.optionsJson) {
    try {
      const rawObj = JSON.parse(menuRowObj.optionsJson);
      if (rawObj && typeof rawObj === 'object' && !Array.isArray(rawObj)) {
        legacySoldOut = Boolean(rawObj.__soldOut);
        delete rawObj.__soldOut;
        parsedOptions = rawObj;
      }
    } catch (e) {}
  }
  const explicitSoldOut = (menuRowObj.soldOut !== undefined && menuRowObj.soldOut !== '')
    ? (menuRowObj.soldOut === true || String(menuRowObj.soldOut).toLowerCase() === 'true')
    : legacySoldOut;

  return { parsedOptions, isSoldOut: explicitSoldOut };
}

function getInitBundle(ss, params, persistQueueUpdate = false) {
  const props = PropertiesService.getScriptProperties();
  let simOffsets = {};
  let openStateMap = {};
  try { simOffsets = JSON.parse(props.getProperty('SIM_QUEUE_OFFSETS') || '{}'); } catch (e) {}
  try { openStateMap = JSON.parse(props.getProperty('STORE_OPEN_STATES') || '{}'); } catch (e) {}

  // 滑動視窗讀取最近 200 筆訂單以精算佇列負載與時段配額
  const rawTailOrders = readSheetTailObjects(ss.getSheetByName('Orders'), 200)
    .reverse()
    .map(enrichOrderObject);

  const queueStatsMap = recomputeAllStoreQueuesInMemory(ss, rawTailOrders, persistQueueUpdate);
  const slotQuotaMap = buildSlotQuotaMap(rawTailOrders);

  // 【最小權限原則】若為已授權之店家後台，回傳該店（或全區）訂單；若為未登入之學生端，僅回傳該學生傳入的 myOrderIds 訂單！
  const session = parseVerifiedMerchantSession(params);
  let clientOrders = [];

  if (session) {
    clientOrders = rawTailOrders
      .filter(ord => session.storeScope === 'ALL' || session.storeScope === String(ord.storeId))
      .map(ord => sanitizeOrderForClientOutput(ord, true));
  } else {
    const requestedIds = Array.isArray(params && params.myOrderIds)
      ? params.myOrderIds.map(id => String(id || '').trim()).filter(Boolean).slice(0, 30)
      : [];
    if (requestedIds.length > 0) {
      const reqSet = new Set(requestedIds);
      clientOrders = rawTailOrders
        .filter(ord => reqSet.has(String(ord.orderId)))
        .map(ord => sanitizeOrderForClientOutput(ord, false));
    }
  }

  const stores = sheetToObjects(ss.getSheetByName('Stores'));
  const menus = sheetToObjects(ss.getSheetByName('Menus'));

  const enrichedStores = stores.map(s => {
    const storeIdStr = String(s.id);
    const storeMenus = menus
      .filter(m => String(m.storeId) === storeIdStr)
      .map(m => {
        const { parsedOptions, isSoldOut } = parseMenuRowOptionsAndSoldOut(m);
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
    const qInfo = queueStatsMap[storeIdStr] || {};
    const active = qInfo.activeOrders !== undefined ? qInfo.activeOrders : Math.max(0, Number(s.activeOrders) || 0);
    const basePrepMinutes = Number(s.basePrepMinutes) || qInfo.basePrepMinutes || 4;
    const baseQueueOffset = Math.max(0, Number(simOffsets[storeIdStr]) || 0);
    const loadPct = isOpen ? Math.min(120, Math.round((active / maxCap) * 100)) : 0;

    let loadState = 'FREE';
    if (!isOpen) loadState = 'CLOSED';
    else if (loadPct >= 85) loadState = 'FULL';
    else if (loadPct >= 50) loadState = 'MODERATE';

    const avgPrep = calcDynamicPrepMinutes(active, maxCap, basePrepMinutes);
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
      basePrepMinutes: basePrepMinutes,
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
    slotQuotaMap: slotQuotaMap,
    recentOrders: clientOrders,
    orders: clientOrders,
    aiRecommendations: aiRecommendations,
    serverTime: serverTime,
    bundle: {
      stores: enrichedStores,
      slotQuotaMap: slotQuotaMap,
      aiRecommendations: aiRecommendations,
      orders: clientOrders,
      recentOrders: clientOrders,
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
  if (!o) return null;
  let meta = {};
  if (o.extraMetaJson) {
    try { meta = JSON.parse(o.extraMetaJson); } catch (e) {}
  }
  const merged = {
    ...o,
    ...meta
  };
  delete merged.__sheetRowIndex;

  merged.pickupDate = normalizeSheetDateStr(merged.pickupDate);
  merged.pickupTime = normalizeSheetTimeStr(merged.pickupTime, false);
  merged.createdAt = normalizeSheetTimeStr(merged.createdAt, true);
  if (merged.paymentDeadline) {
    merged.paymentDeadline = normalizeSheetDateStr(merged.paymentDeadline);
  } else {
    merged.paymentDeadline = '';
  }

  let structuredItems = [];
  if (Array.isArray(merged.structuredItems) && merged.structuredItems.length > 0) {
    structuredItems = merged.structuredItems;
  } else if (merged.itemsJson) {
    try { structuredItems = JSON.parse(merged.itemsJson); } catch (e) { structuredItems = []; }
  }
  merged.structuredItems = structuredItems;
  merged.itemsJson = JSON.stringify(structuredItems);

  merged.subtotal = Math.max(0, Number(merged.subtotal) || 0);
  merged.cutleryFee = Math.max(0, Number(merged.cutleryFee) || 0);
  merged.discount = Math.max(0, Number(merged.discount) || 0);
  merged.manualDiscount = Math.max(0, Number(merged.manualDiscount) || 0);
  merged.finalTotal = Math.max(0, Number(merged.finalTotal) || 0);
  merged.notifyCount = Math.max(0, Number(merged.notifyCount) || 0);
  merged.readyAtTs = Number(merged.readyAtTs || 0);

  merged.verificationCode = generateOrderVerificationCodeOnServer(
    merged.orderId,
    merged.pickupNumber,
    merged.finalTotal
  );

  return merged;
}

function computeAiTrafficRecommendations(enrichedStores) {
  const recs = {};
  ['雙溪校區', '城中校區'].forEach(campus => {
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
      } else {
        recs[campus] = { hasAlert: false };
      }
    } else {
      recs[campus] = { hasAlert: false };
    }
  });
  return recs;
}

// ==================== 8. 【商業級改造 5 & 6】嚴格白名單計價、時段配額防超賣與尖峰預訂檢核 ====================
function handleOrderSubmission(ss, params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) {
    throw new Error('缺少店家編號 (storeId)');
  }

  const orderSheet = ss.getSheetByName('Orders');
  const incomingOrderId = String(params.orderId || ('ORD-' + Utilities.getUuid().slice(0, 12))).trim();

  // 冪等性保護：若該 orderId 已存在，直接回傳既有權威訂單（經最小權限脫敏）
  const isMerchantPosRequest = isMerchantRequestValid(params, storeId);
  const existingLocated = locateOrderRowById(orderSheet, incomingOrderId);
  if (existingLocated) {
    const existingOrder = rowArrayToOrderObject(existingLocated.rowValues);
    return { order: sanitizeOrderForClientOutput(existingOrder, isMerchantPosRequest) };
  }

  const stores = sheetToObjects(ss.getSheetByName('Stores'));
  const storeRow = stores.find(s => String(s.id) === storeId);
  if (!storeRow) {
    throw new Error('查無此學餐店家: ' + storeId);
  }

  const props = PropertiesService.getScriptProperties();
  let openStateMap = {};
  try { openStateMap = JSON.parse(props.getProperty('STORE_OPEN_STATES') || '{}'); } catch (e) {}
  const isStoreOpen = openStateMap[storeId] !== undefined ? Boolean(openStateMap[storeId]) : true;
  const isReservation = Boolean(params.isReservation);

  if (!isStoreOpen && !isReservation && !isMerchantPosRequest) {
    throw new Error(`「${storeRow.name}」目前暫停立即出餐，請改選「預訂取餐」模式！`);
  }

  const maxCap = Math.max(5, Number(storeRow.maxCapacityPer15Min) || 20);
  const recentOrders = readSheetTailObjects(orderSheet, 200).map(enrichOrderObject);
  const pickupDateVal = isReservation ? normalizeSheetDateStr(params.pickupDate) : getTodayTaipeiStr();
  const now = new Date();
  const createdAtStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm:ss');
  const pickupTimeVal = isReservation ? normalizeSheetTimeStr(params.pickupTime, false) : createdAtStr.slice(0, 5);

  // 【商業級改造 6】預訂時段 15 分鐘產能配額檢查 (Slot Capacity Quota)
  if (isReservation && !isMerchantPosRequest) {
    const slotQuotaMap = buildSlotQuotaMap(recentOrders);
    const slotKey = `${storeId}_${pickupDateVal}_${pickupTimeVal}`;
    const bookedInSlot = Number(slotQuotaMap[slotKey] || 0);
    if (bookedInSlot >= maxCap) {
      throw new Error(`抱歉，「${storeRow.name}」於 ${pickupDateVal} ${pickupTimeVal} 時段預訂已額滿（上限 ${maxCap} 單），請改選相鄰時段！`);
    }
  }

  const allMenus = sheetToObjects(ss.getSheetByName('Menus'))
    .filter(m => String(m.storeId) === storeId);
  const menuById = {};
  const menuByName = {};
  allMenus.forEach(m => {
    const { parsedOptions, isSoldOut } = parseMenuRowOptionsAndSoldOut(m);
    const itemObj = {
      id: String(m.id),
      name: String(m.name).trim(),
      price: Math.max(0, Number(m.price) || 0),
      soldOut: isSoldOut,
      options: parsedOptions
    };
    menuById[itemObj.id] = itemObj;
    menuByName[itemObj.name] = itemObj;
  });

  const rawItems = Array.isArray(params.items)
    ? params.items
    : (Array.isArray(params.structuredItems) ? params.structuredItems : []);
  const nonGiftItems = rawItems.filter(it => it && !it.isGift && String(it.id) !== 'GIFT-AI');

  if (nonGiftItems.length === 0) {
    throw new Error('購物車內無有效付費餐點，拒絕結帳');
  }

  const verifiedItems = [];
  let authoritativeSubtotal = 0;

  for (let i = 0; i < nonGiftItems.length; i++) {
    const reqItem = nonGiftItems[i];
    const reqId = String(reqItem.id || '').trim();
    const reqBaseName = String(reqItem.baseName || reqItem.name || '').split(' [')[0].trim();
    const qty = Math.max(1, Math.min(99, parseInt(reqItem.qty, 10) || 1));

    const dbMenu = menuById[reqId] || menuByName[reqBaseName];
    if (!dbMenu) {
      throw new Error(`白名單計價拒絕：查無品項「${reqBaseName || reqId}」，請重新整理菜單`);
    }
    if (dbMenu.soldOut && !isMerchantPosRequest) {
      throw new Error(`抱歉，品項「${dbMenu.name}」今日已售罄，請先從購物車移除後再結帳`);
    }

    let unitExtra = 0;
    const verifiedSelections = {};
    const clientSelections = (reqItem.selections && typeof reqItem.selections === 'object') ? reqItem.selections : {};
    const dbOptions = dbMenu.options || {};

    Object.keys(dbOptions).forEach(optGroupName => {
      const grp = dbOptions[optGroupName];
      const isRadio = !grp.type || grp.type === 'radio';
      const choices = Array.isArray(grp.choices) ? grp.choices : (Array.isArray(grp) ? grp : []);
      if (choices.length === 0) return;

      const choicePriceMap = {};
      choices.forEach(c => {
        const cName = String(Array.isArray(c) ? c[0] : c).trim();
        // 【計價防呆】嚴格禁止負數加料價，防止負數加價折抵主餐漏洞
        const cExtra = Array.isArray(c) ? Math.max(0, Number(c[1]) || 0) : 0;
        choicePriceMap[cName] = cExtra;
      });

      const rawSelected = clientSelections[optGroupName];
      if (isRadio) {
        let chosenStr = Array.isArray(rawSelected) ? String(rawSelected[0] || '').trim() : String(rawSelected || '').trim();
        // 若前端有傳值但不在白名單內，直接報錯拒絕，絕不靜默降級成免費選項
        if (chosenStr && choicePriceMap[chosenStr] === undefined) {
          throw new Error(`品項「${dbMenu.name}」的必選規格「${optGroupName}: ${chosenStr}」無效或已變更，請重新選擇`);
        }
        if (!chosenStr) {
          if (isMerchantPosRequest) {
            chosenStr = String(Array.isArray(choices[0]) ? choices[0][0] : choices[0]).trim();
          } else {
            throw new Error(`請為「${dbMenu.name}」選擇必選規格「${optGroupName}」`);
          }
        }
        verifiedSelections[optGroupName] = chosenStr;
        unitExtra += choicePriceMap[chosenStr];
      } else {
        const selectedArr = Array.isArray(rawSelected)
          ? rawSelected.map(s => String(s).trim()).filter(Boolean)
          : String(rawSelected || '').split(',').map(s => s.trim()).filter(Boolean);
        const validChosen = [];
        selectedArr.forEach(sName => {
          if (choicePriceMap[sName] === undefined) {
            throw new Error(`品項「${dbMenu.name}」的加料選項「${sName}」無效，請重新點選`);
          }
          validChosen.push(sName);
          unitExtra += choicePriceMap[sName];
        });
        if (validChosen.length > 0) {
          verifiedSelections[optGroupName] = validChosen.join(', ');
        }
      }
    });

    const authoritativeUnitPrice = Math.max(0, dbMenu.price + unitExtra);
    const selSuffix = Object.keys(verifiedSelections).length > 0
      ? ` [${Object.entries(verifiedSelections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
      : '';

    verifiedItems.push({
      id: dbMenu.id,
      baseName: dbMenu.name,
      name: `${dbMenu.name}${selSuffix}`,
      price: authoritativeUnitPrice,
      qty: qty,
      selections: verifiedSelections,
      isGift: false
    });

    authoritativeSubtotal += authoritativeUnitPrice * qty;
  }

  // 【商業級改造 5】計算佇列負載並檢查是否為「午間尖峰預訂單 (11:45~12:45)」
  const queueMap = recomputeAllStoreQueuesInMemory(ss, recentOrders, false);
  const storeActiveCount = (queueMap[storeId] && queueMap[storeId].activeOrders) || 0;
  const isFullLoad = Math.round((storeActiveCount / maxCap) * 100) >= 85;
  const promoMode = String(storeRow.promoMode || 'none');
  const promoText = String(storeRow.promoText || '');
  const isPeakReservation = isReservation && isPeakHourSlotOnServer(pickupTimeVal);
  const promoActive = isStoreOpen && !isFullLoad && !isPeakReservation && promoMode !== 'none';

  if (promoActive && (promoMode === 'gift' || promoMode === 'freebie') && promoText) {
    verifiedItems.push({
      id: 'GIFT-AI',
      baseName: `${promoText} (贈品)`,
      name: `${promoText} (贈品)`,
      price: 0,
      qty: 1,
      selections: {},
      isGift: true
    });
  }

  const needCutlery = Boolean(params.needCutlery);
  const storeCutleryPrice = storeRow.cutleryPrice !== undefined && storeRow.cutleryPrice !== ''
    ? Math.max(0, Number(storeRow.cutleryPrice))
    : 1;
  const cutleryFee = needCutlery ? storeCutleryPrice : 0;

  let authoritativeDiscount = 0;
  if (promoActive && promoMode === 'discount' && authoritativeSubtotal >= AI_DISCOUNT_MIN_SUBTOTAL) {
    authoritativeDiscount = Math.min(authoritativeSubtotal, Math.max(0, Number(storeRow.promoDiscount) || 0));
  }

  let manualDiscount = 0;
  let manualDiscountReason = '';
  if (isMerchantPosRequest && Number(params.manualDiscount) > 0) {
    manualDiscount = Math.min(
      Math.max(0, authoritativeSubtotal - authoritativeDiscount),
      Math.max(0, Number(params.manualDiscount) || 0)
    );
    manualDiscountReason = String(params.manualDiscountReason || '櫃檯手動折讓').trim();
  }

  const authoritativeFinalTotal = Math.max(0, authoritativeSubtotal + cutleryFee - authoritativeDiscount - manualDiscount);

  let pickupNumber = '';
  if (isMerchantPosRequest && params.pickupNumber && /^\d{4,5}$/.test(String(params.pickupNumber))) {
    pickupNumber = String(params.pickupNumber);
  } else {
    pickupNumber = generateBackendSequentialPickupNumber(ss, storeId, pickupDateVal);
  }

  const verificationCode = generateOrderVerificationCodeOnServer(incomingOrderId, pickupNumber, authoritativeFinalTotal);

  const paymentMethod = String(params.paymentMethod || '現場櫃檯付現').trim();
  const isLargeCashReserve = isReservation && authoritativeFinalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD && paymentMethod.indexOf('付現') >= 0;
  let paymentStatus = '取餐付現';
  if (isMerchantPosRequest && params.paymentStatus === '已付款') {
    paymentStatus = '已付款';
  } else if (isLargeCashReserve) {
    paymentStatus = '待櫃檯繳費';
  } else if (paymentMethod === 'LINE Pay' || paymentMethod === '街口支付') {
    paymentStatus = '已付款';
  }

  const nowParts = createdAtStr.split(':');
  const nowMinutesOfDay = parseInt(nowParts[0], 10) * 60 + parseInt(nowParts[1], 10);
  const initialStatus = evaluateServerOrderLifecycleStatus(
    '製作中',
    isReservation,
    paymentStatus,
    pickupDateVal,
    pickupTimeVal,
    getTodayTaipeiStr(),
    nowMinutesOfDay
  );

  const dineType = String(params.dineType || '外帶自取').trim();
  const customerNote = String(params.customerNote || '').trim();
  const customerPhone = String(params.customerPhone || '').trim();
  const studentNameSummary = [
    dineType,
    needCutlery ? `🥢 需免洗餐具${cutleryFee > 0 ? `(+$${cutleryFee})` : ''}` : '',
    customerNote ? `📝 備註：${customerNote}` : ''
  ].filter(Boolean).join(' ・ ');

  const promoAppliedText = manualDiscount > 0
    ? manualDiscountReason
    : (promoActive ? promoText : String(params.promoApplied || '一般點餐'));

  const pickupTimeSlot = isReservation
    ? `📅 預訂 ${pickupDateVal} ${pickupTimeVal}`
    : String(params.pickupTimeSlot || '⚡ 立即製作');

  const extraMeta = {
    dineType: dineType,
    needCutlery: needCutlery,
    cutleryFee: cutleryFee,
    manualDiscount: manualDiscount,
    manualDiscountReason: manualDiscountReason,
    isReservation: isReservation,
    pickupDate: pickupDateVal,
    pickupTime: pickupTimeVal,
    customerPhone: customerPhone,
    customerNote: customerNote,
    paymentDeadline: isLargeCashReserve ? pickupDateVal : '',
    paymentStatus: paymentStatus,
    transactionId: String(params.transactionId || ''),
    cashReceived: isMerchantPosRequest ? (Number(params.cashReceived) || 0) : 0,
    changeGiven: isMerchantPosRequest ? (Number(params.changeGiven) || 0) : 0,
    notifyCount: 0,
    lineUserId: String(params.lineUserId || ''),
    customerEmail: String(params.customerEmail || ''),
    verificationCode: verificationCode,
    createdAtTs: now.getTime(),
    cookingStartedAtTs: initialStatus === '製作中' ? now.getTime() : 0,
    readyAtTs: 0
  };

  const itemsJsonStr = JSON.stringify(verifiedItems);
  const newRow = [
    incomingOrderId,
    pickupNumber,
    storeId,
    storeRow.name,
    String(params.orderSource || params.studentId || '📱 掃碼點餐'),
    studentNameSummary,
    itemsJsonStr,
    authoritativeSubtotal,
    authoritativeDiscount,
    authoritativeFinalTotal,
    promoAppliedText,
    pickupTimeSlot,
    paymentMethod,
    initialStatus,
    Boolean(promoActive),
    createdAtStr,
    JSON.stringify(extraMeta)
  ];

  orderSheet.appendRow(newRow);

  const savedOrderObj = rowArrayToOrderObject(newRow);
  recomputeAllStoreQueuesInMemory(ss, [savedOrderObj, ...recentOrders], true);

  // 【商業級改造 7】於伺服器內部自動發送訂單成立 LINE / Email 通知
  const pushTitle = isLargeCashReserve
    ? `⏳ 大額預訂單 #${pickupNumber} 待確認`
    : `🟢 訂單 #${pickupNumber} 已成立 (${initialStatus})`;
  const pushBody = `【${storeRow.name}】${pickupTimeSlot}，應付 NT$${authoritativeFinalTotal} (${paymentMethod})，防偽核銷碼：${verificationCode}。`;
  dispatchOrderNotificationOnServer(ss, savedOrderObj, pushTitle, pushBody, initialStatus);

  return {
    order: sanitizeOrderForClientOutput(savedOrderObj, isMerchantPosRequest)
  };
}

// ==================== 9. 店家 KDS 定點狀態更新與退單（含伺服器內部自動推播） ====================
function updateOrderStateBatch(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const orderId = String(params.orderId || '').trim();
  const located = locateOrderRowById(orderSheet, orderId);
  if (!located) {
    throw new Error('找不到該筆訂單: ' + orderId);
  }

  const rowVals = located.rowValues;
  const orderStoreId = String(rowVals[2] || '').trim();
  assertMerchantAuthorized(params, orderStoreId);

  const prevStatus = String(rowVals[13] || '').trim();
  if (prevStatus.indexOf('已取消') >= 0) {
    throw new Error('此訂單已退單作廢 (' + prevStatus + ')，不可變更狀態或核銷交付');
  }

  let meta = {};
  try { meta = JSON.parse(rowVals[16] || '{}'); } catch (e) {}

  if (params.paymentStatus) {
    meta.paymentStatus = String(params.paymentStatus).trim();
  }
  const nextStatus = String(params.newStatus || rowVals[13] || '製作中').trim();
  if (nextStatus === '已完成' && String(meta.paymentStatus || '已付款') !== '已付款') {
    throw new Error('此訂單尚未完成付款確認，請先收款後再核銷交付');
  }
  rowVals[13] = nextStatus;

  if (nextStatus === '可取餐') {
    meta.notifyCount = (Number(meta.notifyCount) || 0) + 1;
    if (!meta.readyAtTs) meta.readyAtTs = Date.now();
  }
  if (nextStatus === '製作中' && !meta.cookingStartedAtTs) {
    meta.cookingStartedAtTs = Date.now();
  }
  if (params.paymentMethod) {
    rowVals[12] = String(params.paymentMethod).trim();
  }
  if (params.cashReceived !== undefined) {
    meta.cashReceived = Number(params.cashReceived) || 0;
  }
  if (params.changeGiven !== undefined) {
    meta.changeGiven = Number(params.changeGiven) || 0;
  }

  rowVals[16] = JSON.stringify(meta);
  orderSheet.getRange(located.sheetRowIndex, 1, 1, 17).setValues([rowVals]);

  const updatedOrderObj = rowArrayToOrderObject(rowVals);
  const recentOrders = readSheetTailObjects(orderSheet, 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);

  // 於伺服器內部自動發送取餐或結單通知
  if (nextStatus === '可取餐') {
    dispatchOrderNotificationOnServer(
      ss,
      updatedOrderObj,
      `🔔 取餐通知 (#${updatedOrderObj.pickupNumber})`,
      `您在【${updatedOrderObj.storeName}】點的餐點已經準備好囉！請至櫃檯出示 #${updatedOrderObj.pickupNumber}（核銷碼 ${updatedOrderObj.verificationCode}）領取。`,
      '餐點備妥可取餐'
    );
  } else if (nextStatus === '已完成') {
    dispatchOrderNotificationOnServer(
      ss,
      updatedOrderObj,
      `✅ 訂單 #${updatedOrderObj.pickupNumber} 已完成取餐`,
      `感謝您光臨【${updatedOrderObj.storeName}】，祝您用餐愉快！`,
      '已完成取餐'
    );
  }

  return {
    updated: true,
    order: updatedOrderObj
  };
}

function markReservationPaid(ss, params) {
  params.paymentStatus = '已付款';
  return updateOrderStateBatch(ss, params);
}

function cancelOrderByIdBatch(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const orderId = String(params.orderId || '').trim();
  const located = locateOrderRowById(orderSheet, orderId);
  if (!located) {
    throw new Error('找不到該筆訂單: ' + orderId);
  }

  const rowVals = located.rowValues;
  const orderStoreId = String(rowVals[2] || '').trim();
  const curOrderObj = rowArrayToOrderObject(rowVals);
  const curStatus = String(curOrderObj.status || '');
  const isMerchantAuth = isMerchantRequestValid(params, orderStoreId);

  if (!isMerchantAuth) {
    // 允許學生憑本人防偽核銷碼 (verificationCode) 在尚未進入廚房製作前自助取消預約單/未付款單
    const providedCode = String(params.verificationCode || '').trim().toUpperCase();
    const expectedCode = String(curOrderObj.verificationCode || '').trim().toUpperCase();
    if (!providedCode || providedCode !== expectedCode) {
      assertMerchantAuthorized(params, orderStoreId);
    }
    const canSelfCancel = (
      curStatus === '已接單待排程' ||
      curStatus === '待付款確認' ||
      (curStatus === '製作中' && curOrderObj.paymentStatus !== '已付款' && curOrderObj.isReservation)
    );
    if (!canSelfCancel) {
      throw new Error('訂單已進入廚房備餐或完成階段，無法由線上自助取消，請洽詢店家櫃檯處理。');
    }
  }

  const reason = String(params.reason || (isMerchantAuth ? '櫃檯取消' : '顧客自助取消預約')).trim();
  let meta = {};
  try { meta = JSON.parse(rowVals[16] || '{}'); } catch (e) {}

  rowVals[13] = `已取消 (${reason})`;
  meta.paymentStatus = '已退單作廢';
  rowVals[16] = JSON.stringify(meta);

  orderSheet.getRange(located.sheetRowIndex, 1, 1, 17).setValues([rowVals]);

  const cancelledOrderObj = rowArrayToOrderObject(rowVals);
  const recentOrders = readSheetTailObjects(orderSheet, 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);

  dispatchOrderNotificationOnServer(
    ss,
    cancelledOrderObj,
    `🚫 訂單 #${cancelledOrderObj.pickupNumber} 已取消通知`,
    `您在【${cancelledOrderObj.storeName}】的訂單已辦理取消（原因：${reason}）。如有疑問請洽詢店家櫃檯。`,
    rowVals[13]
  );

  return {
    cancelled: true,
    order: sanitizeOrderForClientOutput(cancelledOrderObj, isMerchantAuth)
  };
}

// ==================== 10. 【商業級改造 8】店家設定更新與零斷層菜單原子儲存 ====================
function updateStoreSettings(ss, params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  assertMerchantAuthorized(params, storeId);

  const props = PropertiesService.getScriptProperties();

  if (params.isOpen !== undefined) {
    let openMap = {};
    try { openMap = JSON.parse(props.getProperty('STORE_OPEN_STATES') || '{}'); } catch (e) {}
    openMap[storeId] = Boolean(params.isOpen);
    props.setProperty('STORE_OPEN_STATES', JSON.stringify(openMap));
  }

  if (params.baseQueueOffset !== undefined) {
    let simOffsets = {};
    try { simOffsets = JSON.parse(props.getProperty('SIM_QUEUE_OFFSETS') || '{}'); } catch (e) {}
    simOffsets[storeId] = Math.max(0, Number(params.baseQueueOffset) || 0);
    props.setProperty('SIM_QUEUE_OFFSETS', JSON.stringify(simOffsets));
  }

  const storeSheet = ss.getSheetByName('Stores');
  const range = storeSheet.getDataRange();
  const rows = range.getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === storeId) {
      if (params.maxCapacityPer15Min !== undefined) {
        rows[i][4] = Math.max(5, Number(params.maxCapacityPer15Min) || 20);
      }
      if (params.promoMode !== undefined) {
        rows[i][8] = String(params.promoMode || 'none');
      }
      if (params.promoText !== undefined) {
        rows[i][9] = String(params.promoText || '');
      }
      if (params.promoDiscount !== undefined) {
        rows[i][10] = Math.max(0, Number(params.promoDiscount) || 0);
      }
      if (params.cutleryPrice !== undefined) {
        rows[i][13] = Math.max(0, Number(params.cutleryPrice) || 0);
      }
      if (params.basePrepMinutes !== undefined) {
        rows[i][14] = Math.max(1, Number(params.basePrepMinutes) || 4);
      }
      storeSheet.getRange(i + 1, 1, 1, rows[i].length).setValues([rows[i]]);
      break;
    }
  }

  const recentOrders = readSheetTailObjects(ss.getSheetByName('Orders'), 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);

  return { updated: true, storeId: storeId };
}

/**
 * 【商業級改造 8】零斷層菜單原子更新：
 * 先在記憶體完成資料結構驗證，再直接覆寫目標區塊，最後才清除尾端多餘舊列，絕不先 clearContent() 清空整張表！
 */
function saveStoreMenusAtomic(ss, params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  assertMerchantAuthorized(params, storeId);

  const incomingMenus = Array.isArray(params.menus) ? params.menus : [];
  const menuSheet = ss.getSheetByName('Menus');
  const prevLastRow = menuSheet.getLastRow();
  const prevDataRowCount = Math.max(0, prevLastRow - 1);
  const existingRows = prevDataRowCount > 0 ? menuSheet.getRange(2, 1, prevDataRowCount, 9).getValues() : [];

  const otherStoreRows = [];
  const existingStoreIdByName = {};

  existingRows.forEach(r => {
    const rStoreId = String(r[1] || '').trim();
    if (rStoreId !== storeId) {
      otherStoreRows.push(r);
    } else {
      const rId = String(r[0] || '').trim();
      const rName = String(r[2] || '').trim();
      if (rName && rId) {
        existingStoreIdByName[rName] = rId;
      }
    }
  });

  const usedIds = new Set();
  const newStoreRows = incomingMenus
    .filter(m => m && String(m.name || '').trim())
    .map(m => {
      const cleanName = String(m.name || '').trim();
      let itemId = existingStoreIdByName[cleanName] || String(m.id || '').trim();
      if (!itemId || /^M\d{4}$/.test(itemId)) {
        itemId = existingStoreIdByName[cleanName] || generateStableMenuItemIdOnServer(storeId, cleanName);
      }
      if (usedIds.has(itemId)) {
        itemId = generateStableMenuItemIdOnServer(storeId, cleanName + '_' + usedIds.size);
      }
      usedIds.add(itemId);

      let cleanOpts = (m.options && typeof m.options === 'object' && !Array.isArray(m.options)) ? m.options : {};
      if (cleanOpts['__soldOut'] !== undefined) delete cleanOpts['__soldOut'];

      return [
        itemId,
        storeId,
        cleanName,
        Math.max(0, Number(m.price) || 0),
        String(m.tag || '').trim(),
        String(m.category || '招牌主餐').trim(),
        String(m.image || '').trim(),
        JSON.stringify(cleanOpts),
        Boolean(m.soldOut)
      ];
    });

  const combinedRows = [...otherStoreRows, ...newStoreRows];

  // 先直接覆寫新資料，確保寫入途中即使發生異常也不會導致整張表空白
  if (combinedRows.length > 0) {
    menuSheet.getRange(2, 1, combinedRows.length, 9).setValues(combinedRows);
  }
  // 僅當舊資料列數多於新資料列數時，才清理尾端多餘的列
  if (prevDataRowCount > combinedRows.length) {
    const extraStartRow = 2 + combinedRows.length;
    const extraCount = prevDataRowCount - combinedRows.length;
    menuSheet.getRange(extraStartRow, 1, extraCount, 9).clearContent();
  }

  return {
    saved: true,
    storeId: storeId,
    menuCount: newStoreRows.length
  };
}

function runTrafficSimulation(ss, params) {
  const mode = String(params.mode || 'PEAK').toUpperCase();
  const props = PropertiesService.getScriptProperties();
  const stores = sheetToObjects(ss.getSheetByName('Stores'));
  const simOffsets = {};

  stores.forEach(s => {
    const sid = String(s.id);
    const maxCap = Math.max(5, Number(s.maxCapacityPer15Min) || 20);
    if (mode === 'PEAK') {
      if (sid === 'S01' || sid === 'S03' || sid === 'S05') {
        simOffsets[sid] = Math.round(maxCap * 0.95);
      } else {
        simOffsets[sid] = 0;
      }
    } else {
      simOffsets[sid] = 0;
    }
  });

  props.setProperty('SIM_QUEUE_OFFSETS', JSON.stringify(simOffsets));
  const recentOrders = readSheetTailObjects(ss.getSheetByName('Orders'), 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);

  return {
    simulated: true,
    mode: mode
  };
}

// ==================== 11. Gemini AI 智慧選餐顧問與多模態菜單辨識 ====================
function handleAiConcierge(ss, params) {
  const campus = String(params.campus || '雙溪校區').trim();
  const query = String(params.query || '').trim();
  const geminiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';

  const bundle = getInitBundle(ss, { campus: campus }, false);
  const openStores = (bundle.stores || []).filter(s => s.campus === campus && s.isOpen !== false);
  if (openStores.length === 0) {
    return { aiResult: null };
  }

  if (geminiKey && query) {
    try {
      const storeCatalog = openStores.map(s => ({
        storeId: s.id,
        storeName: s.name,
        waitMin: s.avgPrepMinutes,
        promoText: s.promoText,
        menus: (s.menus || []).filter(m => !m.soldOut).map(m => ({
          menuId: m.id,
          name: m.name,
          price: m.price
        }))
      }));

      const promptText = `你是東吳大學「${campus}」學餐智慧選餐顧問。請根據以下營業中店家與即時等待分鐘數，回答學生問題：「${query}」。
請回傳純 JSON 格式：{"reasoning":"推薦原因(60字內)","storeId":"推薦店家ID","menuId":"推薦餐點ID"}
可用菜單資料：${JSON.stringify(storeCatalog)}`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { responseMimeType: 'application/json' }
        }),
        muteHttpExceptions: true
      });

      const resData = JSON.parse(res.getContentText());
      const rawJsonText = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (rawJsonText) {
        const parsed = JSON.parse(rawJsonText);
        if (parsed && parsed.storeId && parsed.menuId) {
          return {
            aiResult: {
              reasoning: parsed.reasoning,
              storeId: parsed.storeId,
              menuId: parsed.menuId,
              engine: 'Gemini 2.5 Flash 雲端智慧顧問'
            }
          };
        }
      }
    } catch (e) {}
  }

  return { aiResult: null };
}

function handleAiParseMenu(ss, params) {
  const rawText = String(params.rawText || '').trim();
  const imageBase64 = String(params.imageBase64 || '').trim();
  const imageMime = String(params.imageMime || 'image/jpeg').trim();
  const storeId = String(params.storeId || 'S02').trim();
  const geminiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';

  if (geminiKey && (imageBase64 || rawText)) {
    try {
      const parts = [{
        text: `請將這份菜單解析為結構化 JSON 陣列，格式為：[{"category":"分類","name":"菜名","price":100,"tag":"🔥 店長推薦","options":{}}]。${rawText ? '補充文字：' + rawText : ''}`
      }];
      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: imageMime,
            data: imageBase64
          }
        });
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: parts }],
          generationConfig: { responseMimeType: 'application/json' }
        }),
        muteHttpExceptions: true
      });
      const resData = JSON.parse(res.getContentText());
      const rawJson = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (rawJson) {
        const arr = JSON.parse(rawJson);
        if (Array.isArray(arr) && arr.length > 0) {
          return {
            engine: 'Gemini 2.5 Flash 多模態視覺引擎',
            parsedMenus: arr.map(it => ({
              id: generateStableMenuItemIdOnServer(storeId, it.name),
              category: it.category || '主廚推薦',
              name: it.name,
              price: Number(it.price) || 100,
              tag: it.tag || '🔥 新上市',
              options: it.options || {}
            }))
          };
        }
      }
    } catch (e) {}
  }

  const fallbackParsed = [];
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
      const itemMatch = t.match(/^(.+?)\s*[\$＄]?\s*(\d{2,4})\s*(?:元)?/);
      if (itemMatch) {
        const cleanName = itemMatch[1].replace(/^[-*•\d\.]+\s*/, '').trim();
        fallbackParsed.push({
          id: generateStableMenuItemIdOnServer(storeId, cleanName),
          category: currentCat,
          name: cleanName,
          price: parseInt(itemMatch[2], 10),
          tag: '🔥 新上市',
          options: {}
        });
      }
    });
  }

  return {
    engine: '雲端結構化語法解析引擎',
    parsedMenus: fallbackParsed
  };
}