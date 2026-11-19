/**
 * ============================================================================
 * MealFlow - 雲端後端引擎 (Google Apps Script)
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
const DB_SCHEMA_VERSION = 'MEALFLOW_SCHEMA_V23_0';
const BRAND_NAME = 'MealFlow';
const AI_DISCOUNT_MIN_SUBTOTAL = 60;
const LARGE_ORDER_DEPOSIT_THRESHOLD = 500;
const SESSION_TTL_MS = 8 * 3600 * 1000; // 店務 Session Token 效期 8 小時
const ORDERS_TAIL_WINDOW_SIZE = 2500;   // 【滑動視窗擴充 B4】掃描最近 2500 筆訂單，確保高單量下單店整日日結、7日分析與預約單完整不漏單

const scriptProps = PropertiesService.getScriptProperties();
const SYSTEM_LINE_CLIENT_ID = scriptProps.getProperty('LINE_CLIENT_ID') || '2012260287';
const SYSTEM_LINE_CLIENT_SECRET = scriptProps.getProperty('LINE_CLIENT_SECRET') || '';
const SYSTEM_LINE_CHANNEL_TOKEN = scriptProps.getProperty('LINE_CHANNEL_TOKEN') || scriptProps.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '';

function escapeHtmlOnServer(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==================== HTTP 路由入口 (讀寫分離架構) ====================
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  if (params.action === 'getOrder' && params.orderId) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const hasMerchantAuth = isMerchantRequestValid(params, '');
    const providedVerCode = String(params.v || params.verificationCode || '').trim().toUpperCase();
    const clientDeviceId = String(params.clientDeviceId || '').trim();
    return jsonResponse({
      success: true,
      order: findOrderById(ss, params.orderId, hasMerchantAuth, providedVerCode, clientDeviceId)
    });
  }

  return jsonResponse({
    success: true,
    service: BRAND_NAME + ' 雲端引擎',
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
      'logoutMerchantSession': true,
      'requestLinePayCheckout': true,
      'confirmLinePayCheckout': true,
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
      invalidatePublicBundleCache();
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
      return {
        order: findOrderById(
          ss,
          params.orderId,
          isMerchantRequestValid(params, ''),
          String(params.v || params.verificationCode || '').trim().toUpperCase(),
          String(params.clientDeviceId || '').trim()
        )
      };
    case 'lookupOrders':
      return lookupOrdersAcrossDevices(ss, params);
    case 'requestLinePayCheckout':
      return handleRequestLinePayCheckout(ss, params);
    case 'confirmLinePayCheckout':
      return handleConfirmLinePayCheckout(ss, params);
    case 'submitOrder':
      return handleOrderSubmission(ss, params);
    case 'askAiConcierge':
      return handleAiConcierge(ss, params);
    case 'handleLineCallback':
      return handleLineCallback(ss, params);

    // 店務授權端點 (核發、更新與伺服器端註銷具備單一 storeId 與角色權限之 HMAC Session Token)
    case 'verifyMerchantPin':
      return handleVerifyMerchantPin(params);
    case 'verifyManagerOverride':
      return handleVerifyManagerOverride(params);
    case 'logoutMerchantSession':
      return handleLogoutMerchantSession(params);
    case 'updateMerchantPin':
    case 'updateMerchantPinHash':
      assertManagerAuthorized(params, params.storeId || '');
      return handleUpdateMerchantPin(params);
    case 'updateStaffSecurityConfig':
      assertManagerAuthorized(params, params.storeId || '');
      return handleUpdateStaffSecurityConfig(params);

    // 受 HMAC Session Token 與店鋪權限範圍嚴格保護之店務寫入端點
    case 'updateStoreConfig':
      assertMerchantAuthorized(params, params.storeId || '');
      return updateStoreSettings(ss, params);
    case 'saveStoreProfile':
      assertManagerAuthorized(params, params.storeId || '');
      return saveStoreProfileOnServer(ss, params);
    case 'createStore':
      assertManagerAuthorized(params, '');
      return createNewStoreOnServer(ss, params);
    case 'deleteStore':
      assertManagerAuthorized(params, params.storeId || '');
      return deleteStoreOnServer(ss, params);
    case 'saveStoreMenus':
    case 'saveStoreMenu':
      assertManagerAuthorized(params, params.storeId || '');
      return saveStoreMenusAtomic(ss, params);
    case 'upsertSingleMenuItem':
      assertManagerAuthorized(params, params.storeId || '');
      return upsertSingleMenuItemOnServer(ss, params);
    case 'deleteSingleMenuItem':
      assertManagerAuthorized(params, params.storeId || '');
      return deleteSingleMenuItemOnServer(ss, params);
    case 'toggleMenuSoldOut':
      assertMerchantAuthorized(params, params.storeId || '');
      return toggleSingleMenuSoldOutOnServer(ss, params);
    case 'aiParseMenu':
      assertManagerAuthorized(params, params.storeId || '');
      return handleAiParseMenu(ss, params);
    case 'updateOrderStatus':
      assertMerchantAuthorized(params, '');
      return updateOrderStateBatch(ss, params);
    case 'updateOrderItemCheckState':
      assertMerchantAuthorized(params, '');
      return handleUpdateOrderItemCheckState(ss, params);
    case 'modifyOrderItems':
      assertMerchantAuthorized(params, '');
      return handleModifyOrderItems(ss, params);
    case 'appendOrderItems':
      // 三-3：允許同桌顧客（憑防偽核銷碼）或店家人員為進行中內用單加點併單
      return handleAppendOrderItems(ss, params);
    case 'addMerchantOrderNote':
      assertMerchantAuthorized(params, '');
      return handleAddMerchantOrderNote(ss, params);
    case 'openShiftRecord':
      assertMerchantAuthorized(params, params.storeId || '');
      return handleOpenShiftRecord(ss, params);
    case 'markReservationPaid':
      assertMerchantAuthorized(params, '');
      return markReservationPaid(ss, params);
    case 'cancelOrder':
      // 一-2 修復：交由 cancelOrderByIdBatch 內部執行雙路徑授權（店長/覆核授權 或 學生 6 碼防偽碼自助取消預約單），絕不在此預先踢掉學生
      return cancelOrderByIdBatch(ss, params);
    case 'simulateTraffic':
      assertManagerAuthorized(params, '');
      return runTrafficSimulation(ss, params);
    case 'saveLineDevConfig':
      assertManagerAuthorized(params, params.storeId || '');
      return saveLineDevConfig(ss, params);
    case 'saveMerchantAuditLog':
      assertMerchantAuthorized(params, params.storeId || '');
      return handleSaveMerchantAuditLog(ss, params);
    case 'lockShiftZReport':
      assertMerchantAuthorized(params, params.storeId || '');
      return handleLockShiftZReport(ss, params);
    case 'unlockShiftZReport':
      assertManagerAuthorized(params, params.storeId || '');
      return handleUnlockShiftZReport(ss, params);
    case 'saveShiftPettyCash':
      assertMerchantAuthorized(params, params.storeId || '');
      return handleSaveShiftPettyCash(ss, params);
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

function getStoredStoreStaffPinHash(storeId) {
  if (!storeId) return '';
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('MERCHANT_STAFF_PIN_HMAC_STORE_' + String(storeId).trim()) || '';
}

function getStoreStaffList(storeId) {
  if (!storeId) return ['早班人員', '晚班人員'];
  const props = PropertiesService.getScriptProperties();
  try {
    const arr = JSON.parse(props.getProperty('STORE_STAFF_LIST_' + String(storeId).trim()) || '[]');
    if (Array.isArray(arr) && arr.length > 0) return arr;
  } catch (e) {}
  return ['早班收銀', '晚班收銀'];
}

function verifyStoreManagerPinRaw(storeId, rawPin) {
  const pin = String(rawPin || '').trim();
  if (!/^\d{4,8}$/.test(pin)) return false;
  const candidateHash = hashMerchantPinWithServerSalt(pin);
  const storeSpecificHash = getStoredStorePinHash(storeId);
  const defaultInitialHash = getStoredMasterPinHash();
  return storeSpecificHash
    ? constantTimeEquals(candidateHash, storeSpecificHash)
    : constantTimeEquals(candidateHash, defaultInitialHash);
}

function issueMerchantSessionToken(storeScope, staffRole, staffName) {
  // #7 & #8 & 二-1：綁定單一授權店鋪 + 員工角色權限 (MANAGER / STAFF) + 具名操作者
  const cleanScope = String(storeScope || 'S01').trim() || 'S01';
  const cleanRole = (staffRole === 'STAFF') ? 'STAFF' : 'MANAGER';
  const cleanName = encodeURIComponent(String(staffName || (cleanRole === 'MANAGER' ? '店長' : '收銀員')).trim().slice(0, 20));
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const nonce = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const payloadStr = `${expiresAt}_${nonce}_${cleanScope}_${cleanRole}_${cleanName}`;
  const sigHex = computeHmacHex(payloadStr, getServerSecretKey());
  return {
    sessionToken: `${payloadStr}.${sigHex}`,
    expiresAt: expiresAt,
    authorizedStoreId: cleanScope,
    staffRole: cleanRole,
    staffName: decodeURIComponent(cleanName)
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
  const nonce = String(payloadParts[1] || '');
  const tokenScope = String(payloadParts[2] || '');
  const tokenRole = (payloadParts[3] === 'STAFF') ? 'STAFF' : 'MANAGER';
  let tokenStaffName = tokenRole === 'MANAGER' ? '店長' : '收銀員';
  if (payloadParts.length >= 5) {
    try { tokenStaffName = decodeURIComponent(payloadParts.slice(4).join('_')) || tokenStaffName; } catch (e) {}
  }
  if (!expiresAt || Date.now() > expiresAt || !tokenScope) {
    return null;
  }

  // #16：檢查該 Session Token 是否已於登出時被伺服器端註銷
  if (nonce) {
    const cache = CacheService.getScriptCache();
    if (cache && cache.get('REVOKED_SESSION_NONCE_' + nonce)) {
      return null;
    }
  }

  return { expiresAt: expiresAt, nonce: nonce, storeScope: tokenScope, role: tokenRole, staffName: tokenStaffName };
}

function assertManagerAuthorized(params, requiredStoreId) {
  const session = parseVerifiedMerchantSession(params);
  if (!session) {
    throw new Error('店務管理權限驗證失敗或時效憑證已過期 (Unauthorized)，請重新解鎖');
  }
  const targetStore = String(requiredStoreId || session.storeScope || '').trim();
  if (requiredStoreId && session.storeScope !== targetStore) {
    throw new Error('跨店操作越權拒絕，請先切換並驗證目標店鋪密碼');
  }
  if (session.role === 'MANAGER') {
    return { session: session, approvedBy: session.staffName || '店長' };
  }
  // 二-1：一般收銀員 (STAFF) 執行高風險操作時，必須提供店長授權覆核碼 (managerOverridePin)
  const overridePin = String(params.managerOverridePin || '').trim();
  if (overridePin && verifyStoreManagerPinRaw(targetStore, overridePin)) {
    return { session: session, approvedBy: '店長現場覆核授權' };
  }
  throw new Error('此為高風險管理操作（改價／退單／高折讓／解鎖日結／後台設定），需「店長權限」或輸入店長覆核授權碼 (MANAGER_REQUIRED)');
}

function handleVerifyManagerOverride(params) {
  const session = parseVerifiedMerchantSession(params);
  const targetStore = String(params.storeId || (session && session.storeScope) || '').trim();
  if (!targetStore) throw new Error('缺少店鋪編號');
  const pin = String(params.pin || params.managerOverridePin || '').trim();
  if (!verifyStoreManagerPinRaw(targetStore, pin)) {
    throw new Error('店長覆核授權碼錯誤');
  }
  return { approved: true, authorized: true, storeId: targetStore, approvedBy: '店長覆核授權' };
}

function handleUpdateStaffSecurityConfig(params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少目標店鋪編號');
  const props = PropertiesService.getScriptProperties();

  if (params.clearStaffPin) {
    props.deleteProperty('MERCHANT_STAFF_PIN_HMAC_STORE_' + storeId);
  } else if (params.staffPin !== undefined && String(params.staffPin).trim() !== '') {
    const cleanStaffPin = String(params.staffPin).trim();
    if (!/^\d{4,8}$/.test(cleanStaffPin)) {
      throw new Error('收銀員密碼必須為 4 至 8 位數字');
    }
    if (verifyStoreManagerPinRaw(storeId, cleanStaffPin)) {
      throw new Error('收銀員密碼不可與店長管理密碼相同，以確保權限分級！');
    }
    props.setProperty('MERCHANT_STAFF_PIN_HMAC_STORE_' + storeId, hashMerchantPinWithServerSalt(cleanStaffPin));
  }

  if (Array.isArray(params.staffList)) {
    const cleaned = params.staffList.map(s => String(s || '').trim().slice(0, 20)).filter(Boolean).slice(0, 20);
    props.setProperty('STORE_STAFF_LIST_' + storeId, JSON.stringify(cleaned));
  }

  return {
    updated: true,
    storeId: storeId,
    hasStaffPin: Boolean(getStoredStoreStaffPinHash(storeId)),
    staffList: getStoreStaffList(storeId)
  };
}

function handleLogoutMerchantSession(params) {
  const session = parseVerifiedMerchantSession(params);
  if (session && session.nonce) {
    const cache = CacheService.getScriptCache();
    if (cache) {
      // 保留註銷紀錄至 Token 原本到期為止 (最長 6 小時 CacheService 上限 21600 秒)
      cache.put('REVOKED_SESSION_NONCE_' + session.nonce, '1', 21600);
    }
  }
  return { loggedOut: true };
}

function isMerchantRequestValid(params, requiredStoreId) {
  const session = parseVerifiedMerchantSession(params);
  if (!session) return false;
  const targetStore = String(requiredStoreId || '').trim();
  // #7：嚴格檢查目標店鋪是否與 Token 授權店鋪完全一致
  if (targetStore && session.storeScope !== targetStore) {
    return false;
  }
  return true;
}

function assertMerchantAuthorized(params, requiredStoreId) {
  const session = parseVerifiedMerchantSession(params);
  const targetStore = String(requiredStoreId || '').trim();
  if (!session || (targetStore && session.storeScope !== targetStore)) {
    throw new Error('店務管理權限驗證失敗、跨店越權或時效憑證已過期/已登出註銷 (Unauthorized)，請輸入該店專屬授權碼解鎖');
  }
  return session;
}

function handleVerifyMerchantPin(params) {
  const rawPin = String(params.pin || '').trim();
  const requestedStoreId = String(params.storeId || 'S01').trim() || 'S01';
  // #16：支援 4~8 碼數字 PIN 授權碼
  if (!rawPin || !/^\d{4,8}$/.test(rawPin)) {
    throw new Error('請輸入有效的 4 至 8 位數店務管理授權碼');
  }

  // #16：防暴力破解升級 — 連續錯誤達 5 次鎖定 180 秒，累計再錯鎖定更久
  const cache = CacheService.getScriptCache();
  const rateKey = 'PIN_FAIL_' + requestedStoreId;
  const lockTierKey = 'PIN_LOCK_TIER_' + requestedStoreId;
  const failCount = cache ? Number(cache.get(rateKey) || 0) : 0;
  if (failCount >= 5) {
    throw new Error('授權碼連續輸入錯誤達 5 次，系統已啟動安全鎖定，請稍後再試');
  }

  const candidateHash = hashMerchantPinWithServerSalt(rawPin);
  const storeSpecificHash = getStoredStorePinHash(requestedStoreId);
  const storeStaffHash = getStoredStoreStaffPinHash(requestedStoreId);
  const defaultInitialHash = getStoredMasterPinHash();
  const chosenStaffName = String(params.staffName || '').trim().slice(0, 20);

  // #8 & 二-1：比對店長專屬密碼 (MANAGER) 或該店收銀員密碼 (STAFF)；已設專屬密碼時嚴格封鎖預設 8888！
  let matchedRole = '';
  if (storeSpecificHash) {
    if (constantTimeEquals(candidateHash, storeSpecificHash)) matchedRole = 'MANAGER';
  } else {
    if (constantTimeEquals(candidateHash, defaultInitialHash)) matchedRole = 'MANAGER';
  }
  if (!matchedRole && storeStaffHash && constantTimeEquals(candidateHash, storeStaffHash)) {
    matchedRole = 'STAFF';
  }

  if (matchedRole) {
    if (cache) {
      cache.remove(rateKey);
      cache.remove(lockTierKey);
    }
    const finalStaffName = chosenStaffName || (matchedRole === 'MANAGER' ? '當班店長' : '當班收銀員');
    const tokenObj = issueMerchantSessionToken(requestedStoreId, matchedRole, finalStaffName);
    return {
      verified: true,
      sessionToken: tokenObj.sessionToken,
      expiresAt: tokenObj.expiresAt,
      authorizedStoreId: tokenObj.authorizedStoreId,
      staffRole: tokenObj.staffRole,
      staffName: tokenObj.staffName,
      hasStaffPin: Boolean(storeStaffHash),
      staffList: getStoreStaffList(requestedStoreId),
      isUsingInitialDefaultPin: !storeSpecificHash && matchedRole === 'MANAGER'
    };
  }

  if (cache) {
    const nextFail = failCount + 1;
    const tier = Number(cache.get(lockTierKey) || 0) + (nextFail >= 5 ? 1 : 0);
    const lockSec = nextFail >= 5 ? Math.min(1800, 180 * Math.max(1, tier)) : 120;
    cache.put(rateKey, String(nextFail), lockSec);
    if (nextFail >= 5) cache.put(lockTierKey, String(tier), 3600);
  }
  throw new Error('本店專屬授權碼錯誤，拒絕存取');
}

function handleUpdateMerchantPin(params) {
  const oldPin = String(params.oldPin || '').trim();
  const newPin = String(params.newPin || '').trim();
  const targetStoreId = String(params.storeId || '').trim();
  if (!targetStoreId) {
    throw new Error('缺少目標店鋪編號 (storeId)');
  }
  // #16：支援設定 4~8 位數字新密碼
  if (!/^\d{4,8}$/.test(newPin)) {
    throw new Error('新授權碼必須為 4 至 8 位數字');
  }
  if (!oldPin) {
    throw new Error('請輸入目前使用的舊授權碼以驗證身分');
  }

  const oldCandidateHash = hashMerchantPinWithServerSalt(oldPin);
  const storeSpecificHash = getStoredStorePinHash(targetStoreId);
  const defaultInitialHash = getStoredMasterPinHash();

  // #8 核心修補：若該店已有專屬密碼，修改密碼時舊密碼必須吻合該店專屬密碼，禁止用預設 8888 覆寫！
  const isOldValid = storeSpecificHash
    ? constantTimeEquals(oldCandidateHash, storeSpecificHash)
    : constantTimeEquals(oldCandidateHash, defaultInitialHash);

  if (!isOldValid) {
    throw new Error('本店原授權碼驗證錯誤，無法變更密碼');
  }

  const newHash = hashMerchantPinWithServerSalt(newPin);
  const props = PropertiesService.getScriptProperties();
  props.setProperty('MERCHANT_PIN_HMAC_STORE_' + targetStoreId, newHash);

  // 換發新 Token 並註銷舊 Token
  handleLogoutMerchantSession(params);
  const tokenObj = issueMerchantSessionToken(targetStoreId);
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

function sanitizeOrderForClientOutput(orderObj, hasMerchantFullAccess, canRevealVerificationCode = true) {
  if (!orderObj) return null;
  const clone = { ...orderObj };
  const last3 = extractPhoneLast3OnServer(clone.customerPhone);
  clone.customerPhoneLast3 = last3;
  if (!hasMerchantFullAccess) {
    clone.customerPhone = maskPhoneForPublic(clone.customerPhone);
    delete clone.lineUserId;
    delete clone.customerEmail;
    delete clone.clientDeviceId;
    // #15 防憑證外流：若公開查詢未通過雙重驗證或未帶入正確防偽碼/本人裝置識別，遮蔽 6 碼防偽核銷碼
    if (!canRevealVerificationCode) {
      clone.verificationCode = '******';
    }
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
 * #26 彙整各店各 15 分鐘時段區間已接單之「餐點總份數 (Portion Units)」(Slot Quota Map)
 * 修正 1 筆 50 個便當只算 1 單的配額漏洞，讓大團單精準佔用廚房產能配額
 */
function calcOrderTotalPortionsOnServer(orderObj) {
  if (!orderObj) return 1;
  let items = Array.isArray(orderObj.structuredItems) ? orderObj.structuredItems : [];
  if (items.length === 0 && orderObj.itemsJson) {
    try { items = JSON.parse(orderObj.itemsJson || '[]'); } catch (e) { items = []; }
  }
  let total = 0;
  items.forEach(it => {
    if (!it || it.isGift || String(it.id) === 'GIFT-AI') return;
    total += Math.max(1, parseInt(it.qty, 10) || 1);
  });
  return Math.max(1, total);
}

function buildSlotQuotaMap(ordersList) {
  const quotaMap = {};
  (ordersList || []).forEach(o => {
    if (!o || String(o.status || '').indexOf('已取消') >= 0) return;
    const sid = String(o.storeId || '');
    const dStr = normalizeSheetDateStr(o.pickupDate);
    const tStr = normalizeSheetTimeStr(o.pickupTime, false);
    if (!sid || !dStr || !tStr) return;
    const key = `${sid}_${dStr}_${tStr}`;
    const portions = calcOrderTotalPortionsOnServer(o);
    quotaMap[key] = (quotaMap[key] || 0) + portions;
  });
  return quotaMap;
}

/**
 * #14 彙整今日各店各品項已售份數 (Daily Menu Sold Map)，供每日限量庫存扣減與自動售罄使用
 */
function buildDailyMenuSoldMap(ordersList, todayStr) {
  const soldMap = {};
  const targetDay = todayStr || getTodayTaipeiStr();
  (ordersList || []).forEach(o => {
    if (!o || String(o.status || '').indexOf('已取消') >= 0) return;
    if (normalizeSheetDateStr(o.pickupDate) !== targetDay) return;
    const sid = String(o.storeId || '');
    let items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    if (items.length === 0 && o.itemsJson) {
      try { items = JSON.parse(o.itemsJson || '[]'); } catch (e) { items = []; }
    }
    items.forEach(it => {
      if (!it || it.isGift || String(it.id) === 'GIFT-AI') return;
      const mid = String(it.id || '').trim();
      const bName = String(it.baseName || it.name || '').split(' [')[0].trim();
      const q = Math.max(1, parseInt(it.qty, 10) || 1);
      if (mid) {
        const kId = `${sid}::ID::${mid}`;
        soldMap[kId] = (soldMap[kId] || 0) + q;
      }
      if (bName) {
        const kName = `${sid}::NAME::${bName}`;
        soldMap[kName] = (soldMap[kName] || 0) + q;
      }
    });
  });
  return soldMap;
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
      ['S07', '城中校區', '大熊涼麵 X 吃好食堂', '手工涼麵・味噌湯', 25, 0, 2, true, 'discount', '💰 離峰分流折抵：現折 $10 元', 10, 160, 4.7, 1, 2]
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
  const expectedOrderHeaders = [
    'orderId', 'pickupNumber', 'storeId', 'storeName', 'studentId', 'studentName',
    'itemsJson', 'subtotal', 'discount', 'finalTotal', 'promoApplied',
    'pickupTimeSlot', 'paymentMethod', 'status', 'isDivertedOrder', 'createdAt',
    'extraMetaJson'
  ];
  if (!orderSheet) {
    orderSheet = ss.insertSheet('Orders');
    orderSheet.appendRow(expectedOrderHeaders);
  } else {
    orderSheet.getRange(1, 1, 1, expectedOrderHeaders.length).setValues([expectedOrderHeaders]);
  }

  let bindSheet = ss.getSheetByName('LineBindings');
  if (!bindSheet) {
    bindSheet = ss.insertSheet('LineBindings');
    bindSheet.appendRow(['bindCode', 'lineUserId', 'displayName', 'updatedAt']);
  }

  // 一-5：獨立持久化 AuditLogs 與 ShiftReports 工作表，擺脫 PropertiesService 9KB 上限與 80 筆截斷
  ensureSheetByNameWithHeaders(ss, 'AuditLogs', ['logId', 'ts', 'dateStr', 'storeId', 'staffName', 'staffRole', 'approvedBy', 'action', 'detail']);
  ensureSheetByNameWithHeaders(ss, 'ShiftReports', ['shiftKey', 'storeId', 'dateStr', 'shiftSlot', 'status', 'cashierName', 'openingFloat', 'expectedCash', 'actualCountedCash', 'variance', 'pettyCashJson', 'summaryJson', 'updatedAt']);

  props.setProperty('DB_INIT_VER', DB_SCHEMA_VERSION);
}

function invalidatePublicBundleCache() {
  try {
    const cache = CacheService.getScriptCache();
    if (cache) cache.remove('PUBLIC_BUNDLE_SNAP_V23');
  } catch (e) {}
}

function ensureSheetByNameWithHeaders(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  }
  return sh;
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

// ==================== #11 中午尖峰架構優化：Stores 與 Menus 記憶體快取層 ====================
function getCachedStoresAndMenus(ss) {
  const cache = CacheService.getScriptCache();
  if (cache) {
    try {
      const cachedRaw = cache.get('CACHE_STORES_MENUS_V18');
      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw);
        if (parsed && Array.isArray(parsed.stores) && Array.isArray(parsed.menus)) {
          return parsed;
        }
      }
    } catch (e) {}
  }
  const stores = sheetToObjects(ss.getSheetByName('Stores'));
  const menus = sheetToObjects(ss.getSheetByName('Menus'));
  if (cache) {
    try {
      cache.put('CACHE_STORES_MENUS_V18', JSON.stringify({ stores: stores, menus: menus }), 120);
    } catch (e) {}
  }
  return { stores: stores, menus: menus };
}

function invalidateStoresMenusCache() {
  const cache = CacheService.getScriptCache();
  if (cache) {
    try {
      cache.remove('CACHE_STORES_MENUS_V18');
      cache.remove('PUBLIC_BUNDLE_SNAP_V23');
    } catch (e) {}
  }
}

// ==================== #21 伺服器端營業時間、午休時段與公休日判定 ====================
function parseTimeStrToMinsOnServer(tStr, fallbackMins) {
  const m = String(tStr || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallbackMins;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function evaluateStoreBusinessHoursOnServer(customMeta, isManualOpen) {
  if (isManualOpen === false) {
    return { canOrderNow: false, reasonCode: 'MANUAL_CLOSED', statusLabel: '本店目前暫停營業（僅開放預訂取餐）' };
  }
  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  const timeStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm');
  const nowMins = parseTimeStrToMinsOnServer(timeStr, 12 * 60);

  const dParts = todayStr.split('-');
  const dayOfWeek = new Date(Number(dParts[0]), Number(dParts[1]) - 1, Number(dParts[2])).getDay();
  const rawClosed = customMeta && customMeta.closedDays ? customMeta.closedDays : [];
  const closedArr = Array.isArray(rawClosed)
    ? rawClosed.map(Number)
    : String(rawClosed || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  if (closedArr.indexOf(dayOfWeek) >= 0) {
    return { canOrderNow: false, reasonCode: 'CLOSED_DAY', statusLabel: '今日為本店固定公休日（開放預訂其他營業日）' };
  }

  const openTimeStr = String((customMeta && customMeta.openTime) || '10:30').trim();
  const closeTimeStr = String((customMeta && customMeta.closeTime) || '19:30').trim();
  const openMins = parseTimeStrToMinsOnServer(openTimeStr, 10 * 60 + 30);
  const closeMins = parseTimeStrToMinsOnServer(closeTimeStr, 19 * 60 + 30);

  if (nowMins < openMins) {
    return { canOrderNow: false, reasonCode: 'BEFORE_OPEN', statusLabel: `尚未開門（營業時間 ${openTimeStr}~${closeTimeStr}，可先預訂）` };
  }
  if (nowMins > closeMins) {
    return { canOrderNow: false, reasonCode: 'AFTER_CLOSE', statusLabel: `今日已打烊（營業時間 ${openTimeStr}~${closeTimeStr}，可預訂明日）` };
  }

  const breakStartStr = String((customMeta && customMeta.breakStartTime) || '').trim();
  const breakEndStr = String((customMeta && customMeta.breakEndTime) || '').trim();
  if (breakStartStr && breakEndStr) {
    const bStart = parseTimeStrToMinsOnServer(breakStartStr, -1);
    const bEnd = parseTimeStrToMinsOnServer(breakEndStr, -1);
    if (bStart >= 0 && bEnd > bStart && nowMins >= bStart && nowMins < bEnd) {
      return { canOrderNow: false, reasonCode: 'ON_BREAK', statusLabel: `目前為午休備料時段（${breakStartStr}~${breakEndStr}，可預訂午休後取餐）` };
    }
  }

  return { canOrderNow: true, reasonCode: 'OPEN', statusLabel: '正常營業中' };
}

function readSheetTailObjects(sheet, maxTailRows) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(17, sheet.getLastColumn());
  if (lastRow <= 1) return [];

  const limit = Math.max(10, Number(maxTailRows) || ORDERS_TAIL_WINDOW_SIZE);
  const startRow = Math.max(2, lastRow - limit + 1);
  const numRows = lastRow - startRow + 1;
  const rows = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
  const isOrdersSheet = sheet.getName() === 'Orders';
  const headers = isOrdersSheet ? [] : sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());

  const list = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    if (isOrdersSheet) {
      let col11 = row[11];
      let col12 = row[12];
      const s11 = String(col11 || '');
      const s12 = String(col12 || '');
      if ((s12.indexOf('立即製作') >= 0 || s12.indexOf('預訂') >= 0) && (s11.indexOf('現金') >= 0 || s11.indexOf('付現') >= 0 || s11.indexOf('Pay') >= 0)) {
        col11 = row[12];
        col12 = row[11];
      }
      list.push({
        __sheetRowIndex: startRow + i,
        orderId: row[0],
        pickupNumber: row[1],
        storeId: row[2],
        storeName: row[3],
        studentId: row[4],
        studentName: row[5],
        itemsJson: row[6],
        subtotal: row[7],
        discount: row[8],
        finalTotal: row[9],
        promoApplied: row[10],
        pickupTimeSlot: col11,
        paymentMethod: col12,
        status: row[13],
        isDivertedOrder: row[14],
        createdAt: row[15],
        extraMetaJson: row[16]
      });
    } else {
      const obj = { __sheetRowIndex: startRow + i };
      for (let c = 0; c < headers.length; c++) {
        if (headers[c]) obj[headers[c]] = row[c];
      }
      list.push(obj);
    }
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
  let col11 = rowVals[11];
  let col12 = rowVals[12];
  const s11 = String(col11 || '');
  const s12 = String(col12 || '');
  if ((s12.indexOf('立即製作') >= 0 || s12.indexOf('預訂') >= 0) && (s11.indexOf('現金') >= 0 || s11.indexOf('付現') >= 0 || s11.indexOf('Pay') >= 0)) {
    col11 = rowVals[12];
    col12 = rowVals[11];
  }
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
    pickupTimeSlot: col11,
    paymentMethod: col12,
    status: rowVals[13],
    isDivertedOrder: rowVals[14],
    createdAt: rowVals[15],
    extraMetaJson: rowVals[16]
  });
}

function findOrderById(ss, orderId, hasMerchantFullAccess = false, providedVerCode = '', clientDeviceId = '') {
  const orderSheet = ss.getSheetByName('Orders');
  const located = locateOrderRowById(orderSheet, orderId);
  if (!located) return null;
  const enriched = rowArrayToOrderObject(located.rowValues);
  if (!enriched) return null;

  // #15：檢查是否允許在公開 getOrder 請求中揭露 6 碼防偽核銷碼
  const cleanProvidedV = String(providedVerCode || '').trim().toUpperCase();
  const cleanExpectedV = String(enriched.verificationCode || '').trim().toUpperCase();
  const cleanDevId = String(clientDeviceId || '').trim();
  const orderDevId = String(enriched.clientDeviceId || '').trim();
  const canRevealCode = Boolean(
    hasMerchantFullAccess ||
    (cleanProvidedV && cleanProvidedV === cleanExpectedV) ||
    (cleanDevId && orderDevId && cleanDevId === orderDevId)
  );
  return sanitizeOrderForClientOutput(enriched, hasMerchantFullAccess, canRevealCode);
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
  else if (store.promoMode === 'second_discount') promoBonus = 80;
  const ratingScore = ((Number(store.rating) || 4.7) / 5.0) * 100;
  const raw = waitScore * 0.55 + promoBonus * 0.25 + ratingScore * 0.20;
  return Math.max(35, Math.min(99, Math.round(raw)));
}

function evaluateServerOrderLifecycleStatus(statusStr, isReservation, paymentStatus, pickupDateStr, pickupTimeStr, todayStr, nowMinutesOfDay, leadMinsParam) {
  const cur = String(statusStr || '製作中');
  if (cur.indexOf('已取消') >= 0 || cur === '已完成') {
    return cur;
  }
  const cleanDate = normalizeSheetDateStr(pickupDateStr || todayStr);
  // 【過期歷史訂單自動歸檔】早於今日之未結訂單自動轉為「已完成」或「已取消 (歷史逾期未取)」，絕不再卡在「製作中」或「可取餐」
  if (cleanDate < todayStr) {
    if (paymentStatus === '待櫃檯繳費' || paymentStatus === '待付訂確認' || paymentStatus === '取餐付現') {
      return '已取消 (歷史逾期未取)';
    }
    return '已完成';
  }
  if (cur === '可取餐') {
    return cur;
  }
  if (paymentStatus === '待櫃檯繳費' || paymentStatus === '待付訂確認') {
    return '待付款確認';
  }
  const leadMinutes = Math.max(10, Math.min(90, Number(leadMinsParam) || 25));
  if (isReservation) {
    if (cleanDate > todayStr) {
      return '已接單待排程';
    }
    if (cleanDate === todayStr) {
      const pt = normalizeSheetTimeStr(pickupTimeStr, false);
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

function getServerOrderElapsedMinutes(orderObj, nowMs, nowMinutesOfDay) {
  if (!orderObj) return 0;
  const cookTs = Number(orderObj.cookingStartedAtTs || 0);
  if (cookTs > 0) {
    return Math.max(0, Math.floor((nowMs - cookTs) / 60000));
  }
  if (orderObj.isReservation) {
    const pt = normalizeSheetTimeStr(orderObj.pickupTime, false);
    const m = pt.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      const pickupMinOfDay = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const scheduledCookStartMin = pickupMinOfDay - 25;
      return Math.max(0, nowMinutesOfDay - scheduledCookStartMin);
    }
    return 0;
  }
  const createTs = Number(orderObj.createdAtTs || 0);
  if (createTs > 0) {
    return Math.max(0, Math.floor((nowMs - createTs) / 60000));
  }
  const ca = normalizeSheetTimeStr(orderObj.createdAt, false);
  const m = ca.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const createdMinOfDay = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return Math.max(0, nowMinutesOfDay - createdMinOfDay);
  }
  return 0;
}

/**
 * 除「製作中」外，剛按「可取餐」3 分鐘內的出餐口待領訂單亦計入緩衝負荷；
 * 若「製作中」已逾 45 分鐘（店員忙碌未按結單），自動排除於即時排隊負荷外，避免造成假性滿載久候 (B13)
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
  if (effectiveStatus === '製作中') {
    const elapsedMin = getServerOrderElapsedMinutes(orderObj, nowMs, nowMinutesOfDay);
    return elapsedMin <= 45;
  }
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
  const elapsedMin = getServerOrderElapsedMinutes(orderObj, nowMs, nowMinutesOfDay);
  if (elapsedMin > 45) return 0;

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

  let customStoreMetaMap = {};
  try { customStoreMetaMap = JSON.parse(PropertiesService.getScriptProperties().getProperty('STORE_CUSTOM_META') || '{}'); } catch (e) {}

  for (let i = 0; i < rows.length; i++) {
    const curStatus = String(rows[i][13] || '製作中');
    if (curStatus === '已完成' || curStatus.indexOf('已取消') >= 0) continue;

    let meta = {};
    try { meta = JSON.parse(rows[i][16] || '{}'); } catch (e) {}
    const rowStoreId = String(rows[i][2] || '').trim();
    const storeLeadMins = (customStoreMetaMap[rowStoreId] && Number(customStoreMetaMap[rowStoreId].reserveLeadMinutes)) || 25;

    const cleanPickupDate = normalizeSheetDateStr(meta.pickupDate || todayStr);
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
      cleanPickupDate,
      meta.pickupTime,
      todayStr,
      nowMinutesOfDay,
      storeLeadMins
    );

    if (nextStatus !== curStatus) {
      const targetRowIdx = startRow + i;
      orderSheet.getRange(targetRowIdx, 14).setValue(nextStatus);
      if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
      if (nextStatus.indexOf('已取消') >= 0) {
        meta.paymentStatus = '已退單作廢';
        meta.statusTimeline.push({ ts: now.getTime(), timeStr: Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm:ss'), status: nextStatus, label: '系統自動歸檔作廢' });
        orderSheet.getRange(targetRowIdx, 17).setValue(JSON.stringify(meta));
      } else if (nextStatus === '製作中' && !meta.cookingStartedAtTs) {
        meta.cookingStartedAtTs = now.getTime();
        meta.autoFiredAtTs = now.getTime();
        meta.statusTimeline.push({ ts: now.getTime(), timeStr: Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm:ss'), status: '製作中', label: '預訂單到時自動推入廚房 (Auto-fire)' });
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

function generateBackendSequentialPickupNumber(ss, storeId, pickupDateStr, channelPrefix) {
  // 一-4 核心修正：POS 現場單 (A001+) 與線上學生單 (B001+) 採用完全分離之號碼命名空間，徹底杜絕離線補單撞號被迫改號！
  const prefix = (channelPrefix === 'A' || channelPrefix === 'B') ? channelPrefix : 'B';
  const targetDate = normalizeSheetDateStr(pickupDateStr);
  const props = PropertiesService.getScriptProperties();
  const propKey = `SEQ_${storeId}_${targetDate}_${prefix}`;
  let maxSeq = parseInt(props.getProperty(propKey) || '0', 10) || 0;

  const tailOrders = readSheetTailObjects(ss.getSheetByName('Orders'), 600).map(enrichOrderObject);
  const prefixRe = new RegExp('^' + prefix + '(\\d{3,4})$', 'i');
  tailOrders.forEach(o => {
    if (String(o.storeId) === String(storeId) && normalizeSheetDateStr(o.pickupDate) === targetDate) {
      const m = String(o.pickupNumber || '').trim().match(prefixRe);
      if (m) {
        const val = parseInt(m[1], 10);
        if (val > maxSeq && val < 9999) maxSeq = val;
      }
    }
  });

  const nextSeq = maxSeq + 1;
  props.setProperty(propKey, String(nextSeq));
  return prefix + String(nextSeq).padStart(3, '0');
}

// ==================== 5. 【資安修補 #15】雙重驗證跨裝置訂單查詢與防枚舉多重限流 ====================
function lookupOrdersAcrossDevices(ss, params) {
  const hasMerchantAuth = isMerchantRequestValid(params, '');
  let rawQ = String(params.query || '').trim().toUpperCase().replace(/^#/, '');
  let rawPhoneLast3 = extractPhoneLast3OnServer(params.phoneLast3 || '');
  const clientDeviceId = String(params.clientDeviceId || 'ANON_DEV').trim().slice(0, 36);

  if (!rawQ) return { orders: [] };

  // 支援 "A003 678" / "B005-678" / "2003 678" 複合格式先拆解
  const comboMatch = rawQ.match(/^([A-Z]?\d{3,5})[\s\-_,/]+(\d{3})$/);
  if (comboMatch) {
    rawQ = comboMatch[1];
    rawPhoneLast3 = comboMatch[2];
  }

  // 【#15 防暴力枚舉限流】同時針對「裝置識別碼」、「手機末 3 碼」與「全域查單桶」三重限流
  // 杜絕攻擊者固定手機末 3 碼、輪流換取餐號 (1001, 1002, 1003...) 逐一嘗試而不被限制的漏洞！
  if (!hasMerchantAuth) {
    const cache = CacheService.getScriptCache();
    if (cache) {
      const devRateKey = 'LOOKUP_DEV_' + clientDeviceId;
      const phoneRateKey = 'LOOKUP_PH3_' + (rawPhoneLast3 || 'NONE');
      const globalEnumKey = 'LOOKUP_GLOBAL_BUCKET';

      const devHits = Number(cache.get(devRateKey) || 0);
      const phoneHits = Number(cache.get(phoneRateKey) || 0);
      const globalHits = Number(cache.get(globalEnumKey) || 0);

      if (devHits >= 6 || phoneHits >= 6 || globalHits >= 45) {
        throw new Error('查單嘗試次數過於頻繁，為防止訂單號枚舉，系統已暫時鎖定查詢 60 秒，請稍後再試');
      }
      cache.put(devRateKey, String(devHits + 1), 60);
      cache.put(phoneRateKey, String(phoneHits + 1), 60);
      cache.put(globalEnumKey, String(globalHits + 1), 30);
    }
  }

  const isFullOrderId = rawQ.indexOf('ORD-') === 0 && rawQ.length >= 10;
  const isSixCharHmacCode = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(rawQ);
  const isFourDigitPickup = /^([AB]\d{3,4}|\d{4,5})$/.test(rawQ);

  // 未授權之公開查詢：嚴格要求「6 碼 HMAC 防偽碼」或「取餐號 + 手機末 3 碼雙重吻合」（若用 ORD 單號亦須搭配手機末 3 碼或防偽碼）
  if (!hasMerchantAuth && !isSixCharHmacCode) {
    if ((!isFourDigitPickup && !isFullOrderId) || rawPhoneLast3.length !== 3) {
      throw new Error('為保護點餐隱私，跨裝置查詢請輸入「6 碼防偽核銷碼」，或「4 碼取餐號 + 手機末 3 碼」雙重驗證');
    }
  }

  const tailOrders = readSheetTailObjects(ss.getSheetByName('Orders'), ORDERS_TAIL_WINDOW_SIZE)
    .reverse()
    .map(enrichOrderObject);

  const matched = tailOrders.filter(o => {
    if (!o) return false;
    const ordId = String(o.orderId || '').toUpperCase();
    const pickNum = String(o.pickupNumber || '').toUpperCase();
    const verCode = String(o.verificationCode || '').toUpperCase();
    const ordLast3 = extractPhoneLast3OnServer(o.customerPhone);

    if (isSixCharHmacCode && verCode === rawQ) return true;
    if (isFullOrderId && ordId === rawQ) {
      if (hasMerchantAuth) return true;
      if (rawPhoneLast3.length === 3 && ordLast3 === rawPhoneLast3) return true;
    }
    if (isFourDigitPickup) {
      if (hasMerchantAuth && pickNum === rawQ) return true;
      if (pickNum === rawQ && rawPhoneLast3.length === 3 && ordLast3 === rawPhoneLast3) return true;
    }
    return false;
  });

  // 若查無結果，加重該裝置與末碼的失敗計數
  if (!hasMerchantAuth && matched.length === 0) {
    const cache = CacheService.getScriptCache();
    if (cache) {
      const devRateKey = 'LOOKUP_DEV_' + clientDeviceId;
      const cur = Number(cache.get(devRateKey) || 0);
      cache.put(devRateKey, String(cur + 1), 90);
    }
  }

  return {
    orders: matched.slice(0, 5).map(o => sanitizeOrderForClientOutput(o, hasMerchantAuth, true))
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
    storeName: orderObj.storeName || BRAND_NAME,
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
      `🎉 嗨 ${displayName}，您已成功綁定 ${BRAND_NAME} 即時通知！往後餐點完成可取餐與訂單狀態更新都會直接推播至此。`,
      lineCfg.channelToken,
      {
        storeId: storeId,
        title: 'LINE 帳號綁定成功',
        subtitle: `嗨 ${displayName}！取餐與預訂通知已啟用`,
        pickupNumber: 'OK',
        storeName: BRAND_NAME,
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
  const titleText = meta.title || (BRAND_NAME + ' 訂單通知');
  const storeName = meta.storeName || BRAND_NAME;
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
        { type: 'text', text: BRAND_NAME, weight: 'bold', color: accentColor, size: 'sm' },
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
    // #6 各店獨立 LINE Pay 商家金流 Channel ID / Secret Key / Sandbox 設定
    const newLinePayChannelId = params.linePayChannelId !== undefined
      ? String(params.linePayChannelId || '').trim()
      : String(existingCfg.linePayChannelId || '');
    const newLinePayChannelSecret = (params.linePayChannelSecret && String(params.linePayChannelSecret).trim())
      ? String(params.linePayChannelSecret).trim()
      : String(existingCfg.linePayChannelSecret || '');
    const newLinePaySandbox = params.linePaySandbox !== undefined
      ? Boolean(params.linePaySandbox)
      : (existingCfg.linePaySandbox !== undefined ? Boolean(existingCfg.linePaySandbox) : true);

    const storeLineCfg = {
      useCustomLineOa: params.useCustomLineOa !== undefined ? Boolean(params.useCustomLineOa) : Boolean(existingCfg.useCustomLineOa),
      clientId: newClientId,
      clientSecret: newClientSecret,
      channelToken: newChannelToken,
      linePayChannelId: newLinePayChannelId,
      linePayChannelSecret: newLinePayChannelSecret,
      linePaySandbox: newLinePaySandbox
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
    title: params.title || (BRAND_NAME + ' 通知'),
    pickupNumber: params.pickupNumber || '',
    storeName: params.storeName || BRAND_NAME,
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
    const title = m.title || (BRAND_NAME + ' 訂單通知');
    const pickupNumber = m.pickupNumber ? ('#' + m.pickupNumber) : '';
    const storeName = m.storeName || BRAND_NAME;
    const orderUrl = m.orderUrl || 'https://yangbrian01.github.io/scu.meal/order/';

    const safeTitle = escapeHtmlOnServer(title);
    const safePickupNumber = escapeHtmlOnServer(pickupNumber);
    const safeStoreName = escapeHtmlOnServer(storeName);
    const safeMessageText = escapeHtmlOnServer(messageText || '');
    const safeOrderUrl = escapeHtmlOnServer(orderUrl);

    const htmlBody = `
      <div style="font-family:'Noto Sans TC',sans-serif; max-width:480px; margin:0 auto; border:1px solid #E5E7EB; border-radius:16px; overflow:hidden; background:#FFFFFF;">
        <div style="background:linear-gradient(135deg,#FF5A1F,#E04812); color:#FFFFFF; padding:18px 20px;">
          <div style="font-size:12px; font-weight:bold; opacity:0.9;">${escapeHtmlOnServer(BRAND_NAME)} 通知</div>
          <h2 style="margin:6px 0 0; font-size:20px;">${safeTitle}</h2>
        </div>
        <div style="padding:20px;">
          ${safePickupNumber ? `
            <div style="background:#FFF7ED; border:1.5px solid #FDBA74; border-radius:12px; padding:12px; text-align:center; margin-bottom:14px;">
              <div style="font-size:12px; color:#9A3412; font-weight:bold;">您的取餐號碼 (${safeStoreName})</div>
              <div style="font-size:36px; font-weight:900; color:#EA580C;">${safePickupNumber}</div>
            </div>
          ` : ''}
          <p style="font-size:15px; color:#1F2937; line-height:1.6;">${safeMessageText}</p>
          <div style="margin-top:20px; text-align:center;">
            <a href="${safeOrderUrl}" style="display:inline-block; background:#FF5A1F; color:#FFFFFF; text-decoration:none; font-weight:bold; padding:12px 24px; border-radius:999px; font-size:14px;">
              🎟️ 點此開啟電子取餐單
            </a>
          </div>
        </div>
      </div>
    `;

    MailApp.sendEmail({
      to: cleanEmail,
      subject: `【${BRAND_NAME}】${title} ${pickupNumber}`,
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
  let dailyLimit = 0;
  let nameEn = '';
  let station = 'AUTO';
  let tileColor = '';
  let sortOrder = 999;
  if (menuRowObj.optionsJson) {
    try {
      const rawObj = JSON.parse(menuRowObj.optionsJson);
      if (rawObj && typeof rawObj === 'object' && !Array.isArray(rawObj)) {
        legacySoldOut = Boolean(rawObj.__soldOut);
        dailyLimit = Math.max(0, parseInt(rawObj.__dailyLimit || 0, 10) || 0);
        nameEn = String(rawObj.__nameEn || '').trim();
        station = ['MAIN', 'SIDE', 'DRINK'].indexOf(String(rawObj.__station || '').toUpperCase()) >= 0 ? String(rawObj.__station).toUpperCase() : 'AUTO';
        tileColor = String(rawObj.__tileColor || '').trim();
        sortOrder = rawObj.__sortOrder !== undefined && rawObj.__sortOrder !== '' ? (parseInt(rawObj.__sortOrder, 10) || 999) : 999;
        delete rawObj.__soldOut;
        delete rawObj.__dailyLimit;
        delete rawObj.__nameEn;
        delete rawObj.__station;
        delete rawObj.__tileColor;
        delete rawObj.__sortOrder;
        parsedOptions = rawObj;
      }
    } catch (e) {}
  }
  const explicitSoldOut = (menuRowObj.soldOut !== undefined && menuRowObj.soldOut !== '')
    ? (menuRowObj.soldOut === true || String(menuRowObj.soldOut).toLowerCase() === 'true')
    : legacySoldOut;

  return { parsedOptions, isSoldOut: explicitSoldOut, dailyLimit: dailyLimit, nameEn: nameEn, station: station, tileColor: tileColor, sortOrder: sortOrder };
}

function isCorruptedOrMockOrderOnServer(o) {
  if (!o) return true;
  if (o.isSeedSample) return true;
  const oid = String(o.orderId || '');
  if (oid.indexOf('ORD-DEMO-') === 0 || /^ORD-\d+$/.test(oid)) return true;
  const pNum = String(o.pickupNumber || '');
  if (/^[SCP]\d{3}$/.test(pNum)) return true;
  return false;
}

function buildStoreQueueProgressMap(ordersList) {
  const todayStr = getTodayTaipeiStr();
  const map = {};
  (ordersList || []).forEach(o => {
    if (!o || isCorruptedOrMockOrderOnServer(o)) return;
    if (String(o.status || '').indexOf('已取消') >= 0) return;
    if (normalizeSheetDateStr(o.pickupDate) !== todayStr) return;
    const sid = String(o.storeId || '');
    if (!sid) return;
    if (!map[sid]) {
      map[sid] = { readyNumbers: [], cookingOrderIds: [], latestCalledNumber: '' };
    }
    if (o.status === '可取餐') {
      map[sid].readyNumbers.push(String(o.pickupNumber));
      if (!map[sid].latestCalledNumber) map[sid].latestCalledNumber = String(o.pickupNumber);
    } else if (o.status === '製作中') {
      map[sid].cookingOrderIds.push(String(o.orderId));
    }
  });
  Object.keys(map).forEach(sid => {
    map[sid].cookingOrderIds.reverse(); // 由先下單到後下單排序
  });
  return map;
}

function getInitBundle(ss, params, persistQueueUpdate = false) {
  const session = parseVerifiedMerchantSession(params);
  const requestedIdsCheck = Array.isArray(params && params.myOrderIds)
    ? params.myOrderIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];

  // 四-1 效能優化：純公開點餐瀏覽（無私人訂單與非店家端）共享 5 秒 CacheService 快照，大幅減少尖峰重複掃描 2,500 列試算表
  if (!session && requestedIdsCheck.length === 0 && !persistQueueUpdate) {
    try {
      const pubCache = CacheService.getScriptCache();
      const cachedPubRaw = pubCache ? pubCache.get('PUBLIC_BUNDLE_SNAP_V23') : null;
      if (cachedPubRaw) {
        const parsedSnap = JSON.parse(cachedPubRaw);
        if (parsedSnap && Array.isArray(parsedSnap.stores)) {
          const nowTs = Date.now();
          parsedSnap.serverTimeTs = nowTs;
          if (parsedSnap.bundle) parsedSnap.bundle.serverTimeTs = nowTs;
          return parsedSnap;
        }
      }
    } catch (e) {}
  }

  const props = PropertiesService.getScriptProperties();
  let simOffsets = {};
  let openStateMap = {};
  let customStoreMetaMap = {};
  let deletedStoreIdsMap = {};
  try { simOffsets = JSON.parse(props.getProperty('SIM_QUEUE_OFFSETS') || '{}'); } catch (e) {}
  try { openStateMap = JSON.parse(props.getProperty('STORE_OPEN_STATES') || '{}'); } catch (e) {}
  try { customStoreMetaMap = JSON.parse(props.getProperty('STORE_CUSTOM_META') || '{}'); } catch (e) {}
  try { deletedStoreIdsMap = JSON.parse(props.getProperty('DELETED_STORE_IDS') || '{}'); } catch (e) {}

  const orderSheet = ss.getSheetByName('Orders');
  // 滑動視窗讀取最近 ORDERS_TAIL_WINDOW_SIZE 筆訂單，並自動排除早期壓力測試假單
  const rawTailOrders = readSheetTailObjects(orderSheet, ORDERS_TAIL_WINDOW_SIZE)
    .reverse()
    .map(enrichOrderObject)
    .filter(o => o && !isCorruptedOrMockOrderOnServer(o));

  const queueStatsMap = recomputeAllStoreQueuesInMemory(ss, rawTailOrders, persistQueueUpdate);
  const slotQuotaMap = buildSlotQuotaMap(rawTailOrders);
  const storeQueueProgressMap = buildStoreQueueProgressMap(rawTailOrders);
  const todayStrForLimits = getTodayTaipeiStr();
  const dailyMenuSoldMap = buildDailyMenuSoldMap(rawTailOrders, todayStrForLimits);

  // 【最小權限原則】若為已授權之店家後台，僅回傳該單一授權店鋪訂單；若為未登入之學生端，回傳該學生傳入的 myOrderIds 訂單
  const clientDeviceId = String((params && params.clientDeviceId) || '').trim();
  let clientOrders = [];

  if (session) {
    clientOrders = rawTailOrders
      .filter(ord => String(ord.storeId) === session.storeScope)
      .slice(0, 1200)
      .map(ord => sanitizeOrderForClientOutput(ord, true, true));
  } else {
    const requestedIds = Array.isArray(params && params.myOrderIds)
      ? params.myOrderIds.map(id => String(id || '').trim()).filter(Boolean).slice(0, 35)
      : [];
    if (requestedIds.length > 0) {
      const reqSet = new Set(requestedIds);
      const foundMap = {};
      rawTailOrders.forEach(ord => {
        const oid = String(ord.orderId);
        if (reqSet.has(oid)) {
          const isOwnDevice = Boolean(clientDeviceId && ord.clientDeviceId && clientDeviceId === String(ord.clientDeviceId));
          foundMap[oid] = sanitizeOrderForClientOutput(ord, false, isOwnDevice);
        }
      });
      requestedIds.forEach(reqId => {
        if (!foundMap[reqId]) {
          const singleOrd = findOrderById(ss, reqId, false, '', clientDeviceId);
          if (singleOrd && !isCorruptedOrMockOrderOnServer(singleOrd)) {
            foundMap[reqId] = singleOrd;
          }
        }
      });
      clientOrders = Object.values(foundMap);
    }
  }

  // #11：使用 CacheService 快取之 Stores 與 Menus，降低中午尖峰 60% 以上試算表讀取次數
  const cachedSM = getCachedStoresAndMenus(ss);
  const stores = (cachedSM.stores || [])
    .filter(s => s && s.id && !deletedStoreIdsMap[String(s.id)]);
  const menus = cachedSM.menus || [];

  const enrichedStores = stores.map(s => {
    const storeIdStr = String(s.id);
    const customMeta = customStoreMetaMap[storeIdStr] || {};
    const storeMenus = menus
      .filter(m => String(m.storeId) === storeIdStr)
      .map(m => {
        const { parsedOptions, isSoldOut, dailyLimit, nameEn, station, tileColor, sortOrder } = parseMenuRowOptionsAndSoldOut(m);
        let rawTag = String(m.tag || '').trim();
        let rawCat = String(m.category || '招牌主餐').trim();
        let rawImg = String(m.image || '').trim();
        // 自動修復舊版試算表欄位錯位（如 tag='4', category='🔥 必點人氣', image='true'）
        if (!/^https?:\/\/|^data:image\//i.test(rawImg)) {
          rawImg = '';
        }
        if (/^\d+$/.test(rawTag)) {
          if (/^[🔥⭐⚡🥣🥤🍗🍵🌶️🥛✨🧀]/.test(rawCat)) {
            rawTag = rawCat;
            rawCat = '招牌主餐';
          } else {
            rawTag = '🔥 店長推薦';
          }
        }
        const mId = String(m.id);
        const mName = String(m.name).trim();
        const soldToday = Math.max(
          Number(dailyMenuSoldMap[`${storeIdStr}::ID::${mId}`] || 0),
          Number(dailyMenuSoldMap[`${storeIdStr}::NAME::${mName}`] || 0)
        );
        const remainingToday = dailyLimit > 0 ? Math.max(0, dailyLimit - soldToday) : null;
        // 一-3：每日限量售罄完全依當日未取消銷量動態推導，絕不永久寫死試算表 soldOut；跨日自動歸零恢復上架，退單即時補回
        const dailyLimitSoldOut = Boolean(dailyLimit > 0 && remainingToday <= 0);
        const effectiveSoldOut = Boolean(isSoldOut || dailyLimitSoldOut);
        return {
          id: mId,
          storeId: String(m.storeId),
          name: mName,
          nameEn: nameEn || '',
          price: Number(m.price) || 0,
          tag: rawTag,
          category: rawCat || '招牌主餐',
          station: station || 'AUTO',
          tileColor: tileColor || '',
          sortOrder: sortOrder,
          soldOut: effectiveSoldOut,
          manualSoldOut: Boolean(isSoldOut),
          dailyLimitSoldOut: dailyLimitSoldOut,
          dailyLimit: dailyLimit,
          soldToday: soldToday,
          remainingToday: remainingToday,
          image: rawImg,
          options: parsedOptions
        };
      })
      .sort((a, b) => (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999));

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
    let linePayChannelId = '';
    let hasLinePaySecret = false;
    let linePaySandbox = true;
    try {
      const rawLineCfg = props.getProperty('STORE_LINE_CFG_' + storeIdStr);
      if (rawLineCfg) {
        const parsedLineCfg = JSON.parse(rawLineCfg);
        useCustomLineOa = Boolean(parsedLineCfg.useCustomLineOa);
        customLineClientId = parsedLineCfg.clientId || '';
        linePayChannelId = parsedLineCfg.linePayChannelId || '';
        hasLinePaySecret = Boolean(parsedLineCfg.linePayChannelSecret);
        linePaySandbox = parsedLineCfg.linePaySandbox !== undefined ? Boolean(parsedLineCfg.linePaySandbox) : true;
      }
    } catch (e) {}

    // #21：計算該店目前是否處於可接「立即製作」之營業時段（考量手動開關、公休日、營業時間、午休時段）
    const bizStatus = evaluateStoreBusinessHoursOnServer(customMeta, isOpen);

    const storeObj = {
      ...s,
      icon: String(customMeta.icon || s.icon || ''),
      openTime: String(customMeta.openTime || s.openTime || '10:30'),
      closeTime: String(customMeta.closeTime || s.closeTime || '19:30'),
      breakStartTime: String(customMeta.breakStartTime || s.breakStartTime || ''),
      breakEndTime: String(customMeta.breakEndTime || s.breakEndTime || ''),
      closedDays: Array.isArray(customMeta.closedDays) ? customMeta.closedDays : (Array.isArray(s.closedDays) ? s.closedDays : []),
      reserveLeadMinutes: Math.max(10, Math.min(90, Number(customMeta.reserveLeadMinutes) || 25)),
      promoMinSubtotal: customMeta.promoMinSubtotal !== undefined ? Math.max(0, Number(customMeta.promoMinSubtotal) || 0) : AI_DISCOUNT_MIN_SUBTOTAL,
      promoScope: customMeta.promoScope === 'ALL_DAY' ? 'ALL_DAY' : 'OFF_PEAK',
      giftMenuItemId: String(customMeta.giftMenuItemId || '').trim(),
      secondItemDiscount: Math.max(0, Number(customMeta.secondItemDiscount) || 0),
      coupons: Array.isArray(customMeta.coupons) ? customMeta.coupons : [],
      allowDineInPostPay: Boolean(customMeta.allowDineInPostPay),
      hasStaffPin: Boolean(getStoredStoreStaffPinHash(storeIdStr)),
      staffList: getStoreStaffList(storeIdStr),
      isOpen: isOpen,
      canOrderNow: bizStatus.canOrderNow,
      businessStatusReason: bizStatus.reasonCode,
      businessStatusLabel: bizStatus.statusLabel,
      maxCapacityPer15Min: maxCap,
      basePrepMinutes: basePrepMinutes,
      activeOrders: active,
      baseQueueOffset: baseQueueOffset,
      avgPrepMinutes: avgPrep,
      rating: Number(s.rating) || 4.7,
      cutleryPrice: Math.max(0, cutleryPrice),
      useCustomLineOa: useCustomLineOa,
      customLineClientId: customLineClientId,
      linePayChannelId: linePayChannelId,
      hasLinePaySecret: hasLinePaySecret,
      linePaySandbox: linePaySandbox,
      loadPercentage: loadPct,
      loadState: !bizStatus.canOrderNow ? 'CLOSED' : loadState,
      menus: storeMenus
    };
    storeObj.aiScore = calcAiUtilityScore(storeObj);
    return storeObj;
  });

  const aiRecommendations = computeAiTrafficRecommendations(enrichedStores);
  const nowObj = new Date();
  const serverTime = Utilities.formatDate(nowObj, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  const serverTimeTs = nowObj.getTime();

  // 一-5 & #13：優先從專屬 AuditLogs / ShiftReports 工作表讀取（無 9KB 容量與 80 筆截斷限制），並相容合併舊版 PropertiesService 歷史資料
  let storeAuditLogs = [];
  let lockedShiftsMap = {};
  let openShiftsMap = {};
  let pettyCashMap = {};
  if (session && session.storeScope) {
    const scopeId = session.storeScope;
    try {
      const legacyLogs = JSON.parse(props.getProperty('AUDIT_LOGS_' + scopeId) || '[]');
      if (Array.isArray(legacyLogs)) storeAuditLogs = legacyLogs.slice();
    } catch (e) {}
    try {
      const auditSheet = ss.getSheetByName('AuditLogs');
      if (auditSheet && auditSheet.getLastRow() > 1) {
        const aRows = readSheetTailObjects(auditSheet, 300).reverse();
        const sheetLogs = aRows
          .filter(r => String(r.storeId || '') === scopeId)
          .map(r => ({
            ts: String(r.ts || ''),
            storeId: scopeId,
            staffName: String(r.staffName || ''),
            staffRole: String(r.staffRole || ''),
            approvedBy: String(r.approvedBy || ''),
            action: String(r.action || ''),
            detail: String(r.detail || '')
          }));
        if (sheetLogs.length > 0) storeAuditLogs = sheetLogs;
      }
    } catch (e) {}

    try { lockedShiftsMap = JSON.parse(props.getProperty('SHIFT_LOCKS_' + scopeId) || '{}'); } catch (e) {}
    try { openShiftsMap = JSON.parse(props.getProperty('SHIFT_OPENS_' + scopeId) || '{}'); } catch (e) {}
    try { pettyCashMap = JSON.parse(props.getProperty('PETTY_CASH_' + scopeId) || '{}'); } catch (e) {}

    try {
      const shiftSheet = ss.getSheetByName('ShiftReports');
      if (shiftSheet && shiftSheet.getLastRow() > 1) {
        const sRows = readSheetTailObjects(shiftSheet, 250);
        sRows.filter(r => String(r.storeId || '') === scopeId).forEach(r => {
          const dStr = normalizeSheetDateStr(r.dateStr || '');
          const slot = String(r.shiftSlot || 'FULL').trim().toUpperCase();
          const compositeKey = `${dStr}_${slot}`;
          let summaryObj = {};
          let pettyArr = [];
          try { summaryObj = JSON.parse(r.summaryJson || '{}'); } catch (e) {}
          try { pettyArr = JSON.parse(r.pettyCashJson || '[]'); } catch (e) {}
          if (Array.isArray(pettyArr)) pettyCashMap[compositeKey] = pettyArr;
          if (r.status === 'OPEN' || Number(r.openingFloat) > 0) {
            openShiftsMap[compositeKey] = {
              openedAt: String(summaryObj.openedAt || r.updatedAt || ''),
              cashier: String(r.cashierName || ''),
              openingFloat: Number(r.openingFloat) || 0,
              shiftSlot: slot
            };
          }
          if (r.status === 'LOCKED') {
            lockedShiftsMap[compositeKey] = {
              locked: true,
              lockedAt: String(r.updatedAt || ''),
              cashier: String(r.cashierName || ''),
              shiftSlot: slot,
              openingFloat: Number(r.openingFloat) || 0,
              expectedDrawerCash: Number(r.expectedCash) || 0,
              actualCounted: Number(r.actualCountedCash) || 0,
              varianceAmt: Number(r.variance) || 0,
              ...summaryObj
            };
          } else if (r.status === 'UNLOCKED') {
            delete lockedShiftsMap[compositeKey];
          }
        });
      }
    } catch (e) {}
  }

  const finalPayload = {
    stores: enrichedStores,
    slotQuotaMap: slotQuotaMap,
    storeQueueProgressMap: storeQueueProgressMap,
    recentOrders: clientOrders,
    orders: clientOrders,
    aiRecommendations: aiRecommendations,
    merchantAuditLogs: storeAuditLogs,
    lockedShiftsMap: lockedShiftsMap,
    openShiftsMap: openShiftsMap,
    pettyCashMap: pettyCashMap,
    merchantSessionRole: session ? session.role : '',
    merchantSessionStaffName: session ? session.staffName : '',
    serverTime: serverTime,
    serverTimeTs: serverTimeTs,
    bundle: {
      stores: enrichedStores,
      slotQuotaMap: slotQuotaMap,
      storeQueueProgressMap: storeQueueProgressMap,
      aiRecommendations: aiRecommendations,
      orders: clientOrders,
      recentOrders: clientOrders,
      merchantAuditLogs: storeAuditLogs,
      lockedShiftsMap: lockedShiftsMap,
      openShiftsMap: openShiftsMap,
      pettyCashMap: pettyCashMap,
      merchantSessionRole: session ? session.role : '',
      merchantSessionStaffName: session ? session.staffName : '',
      lineDevInfo: {
        botBasicId: props.getProperty('LINE_BOT_BASIC_ID') || '',
        liffId: props.getProperty('LINE_LIFF_ID') || '',
        hasToken: Boolean(props.getProperty('LINE_CHANNEL_TOKEN') || props.getProperty('LINE_CHANNEL_ACCESS_TOKEN'))
      },
      serverTime: serverTime,
      serverTimeTs: serverTimeTs
    }
  };

  if (!session && requestedIdsCheck.length === 0) {
    try {
      const pubCache = CacheService.getScriptCache();
      const rawJson = JSON.stringify(finalPayload);
      if (pubCache && rawJson.length < 95000) {
        pubCache.put('PUBLIC_BUNDLE_SNAP_V23', rawJson, 5);
      }
    } catch (e) {}
  }
  return finalPayload;
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
  merged.originalOfflinePickupNumber = String(merged.originalOfflinePickupNumber || '').trim();
  merged.partialRefundTotal = Math.max(0, Number(merged.partialRefundTotal) || 0);
  merged.extraChargeTotal = Math.max(0, Number(merged.extraChargeTotal) || 0);
  merged.pendingAddOnAmount = Math.max(0, Number(merged.pendingAddOnAmount) || 0);
  merged.tableNumber = String(merged.tableNumber || '').trim();
  merged.carrierCode = String(merged.carrierCode || '').trim();
  merged.couponCode = String(merged.couponCode || '').trim();
  merged.couponDiscount = Math.max(0, Number(merged.couponDiscount) || 0);
  merged.isDineInPostPay = Boolean(merged.isDineInPostPay);
  merged.itemCheckedMap = (merged.itemCheckedMap && typeof merged.itemCheckedMap === 'object') ? merged.itemCheckedMap : {};

  // #20：現金單逾時未取自動作廢保護（已叫號超過 60 分鐘且仍為未付款現金單）
  if (
    merged.status === '可取餐' &&
    merged.readyAtTs > 0 &&
    String(merged.paymentStatus || '') !== '已付款' &&
    (Date.now() - merged.readyAtTs) > 60 * 60 * 1000
  ) {
    merged.status = '已取消 (現金單逾時未取自動作廢)';
    merged.paymentStatus = '已退單作廢';
  }

  merged.verificationCode = (meta && meta.sealedVerificationCode)
    ? String(meta.sealedVerificationCode)
    : generateOrderVerificationCodeOnServer(
        merged.orderId,
        merged.pickupNumber,
        merged.finalTotal
      );

  return merged;
}

function computeAiTrafficRecommendations(enrichedStores) {
  const recs = {};
  const campuses = Array.from(new Set((enrichedStores || []).map(s => String(s.campus || '').trim()).filter(Boolean)));
  if (campuses.length === 0) {
    campuses.push('雙溪校區', '城中校區');
  }
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
      } else {
        recs[campus] = { hasAlert: false };
      }
    } else {
      recs[campus] = { hasAlert: false };
    }
  });
  return recs;
}

// ==================== 8. 【資安修補 #6, #10, #20, #40】各店獨立 LINE Pay Request/Confirm 金流、防洗單/防棄單上限、白名單計價與完整歷史快照 ====================
function resolveStoreLinePayConfig(storeId) {
  const props = PropertiesService.getScriptProperties();
  let cfg = {};
  if (storeId) {
    try {
      cfg = JSON.parse(props.getProperty('STORE_LINE_CFG_' + String(storeId)) || '{}');
    } catch (e) {}
  }
  const channelId = String(cfg.linePayChannelId || props.getProperty('LINE_PAY_CHANNEL_ID') || '').trim();
  const channelSecret = String(cfg.linePayChannelSecret || props.getProperty('LINE_PAY_CHANNEL_SECRET') || '').trim();
  const isSandbox = cfg.linePaySandbox !== undefined ? Boolean(cfg.linePaySandbox) : true;
  return {
    storeId: storeId,
    channelId: channelId,
    channelSecret: channelSecret,
    isSandbox: isSandbox,
    hasMerchantCredentials: Boolean(channelId && channelSecret)
  };
}

function handleRequestLinePayCheckout(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const amount = Math.max(0, Math.round(Number(params.amount) || 0));
  const orderId = String(params.orderId || ('ORD-LP-' + Utilities.getUuid().slice(0, 8))).trim();
  if (!storeId || amount <= 0) {
    throw new Error('金流請求參數錯誤：缺少店家編號或有效金額');
  }

  // 防重複發起付款鎖 (Anti-Duplicate Request Lock)
  const cache = CacheService.getScriptCache();
  if (cache && params.orderId && cache.get('LP_PAID_ORD_' + orderId)) {
    throw new Error('此訂單已完成付款授權，請勿重複扣款！');
  }

  const lpCfg = resolveStoreLinePayConfig(storeId);
  const todayCompact = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
  const txRand = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  let transactionId = `LP-${todayCompact}-${storeId}-${txRand}`;
  let paymentUrlWeb = '';
  let gatewayMode = lpCfg.hasMerchantCredentials
    ? (lpCfg.isSandbox ? 'LINE_PAY_V3_SANDBOX' : 'LINE_PAY_V3_PROD')
    : 'SANDBOX_DEMO_UNCONFIGURED';

  // 一-1 核心修復：若前端發起真實 LINE Pay 結帳且該店尚未設定金鑰，直接拒絕並引導改用現場付現，絕不放行假收銀台！
  if (params.useRealLinePayApi && !lpCfg.hasMerchantCredentials) {
    throw new Error('本店尚未設定真實 LINE Pay 商家金鑰，請改用「現場取餐付現」或洽店長設定。');
  }
  if (lpCfg.hasMerchantCredentials) {
    const apiBase = lpCfg.isSandbox ? 'https://sandbox-api-pay.line.me' : 'https://api-pay.line.me';
    const uri = '/v3/payments/request';
    const nonce = Utilities.getUuid();
    const confirmUrl = String(params.confirmUrl || 'https://yangtechnology.github.io/scu.meal/order/?lpCallback=1').trim();
    const cancelUrl = String(params.cancelUrl || 'https://yangtechnology.github.io/scu.meal/order/?lpCancel=1').trim();
    const bodyObj = {
      amount: amount,
      currency: 'TWD',
      orderId: orderId,
      packages: [{
        id: storeId,
        amount: amount,
        name: BRAND_NAME + ' - ' + storeId,
        products: [{ name: String(params.productSummary || '學餐餐點合計').slice(0, 80), quantity: 1, price: amount }]
      }],
      redirectUrls: {
        confirmUrl: confirmUrl,
        cancelUrl: cancelUrl
      }
    };
    const bodyStr = JSON.stringify(bodyObj);
    const sigRaw = lpCfg.channelSecret + uri + bodyStr + nonce;
    const sigBytes = Utilities.computeHmacSha256Signature(sigRaw, lpCfg.channelSecret, Utilities.Charset.UTF_8);
    const sigBase64 = Utilities.base64Encode(sigBytes);

    let lpData = {};
    try {
      const lpRes = UrlFetchApp.fetch(apiBase + uri, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'X-LINE-ChannelId': lpCfg.channelId,
          'X-LINE-Authorization-Nonce': nonce,
          'X-LINE-Authorization': sigBase64
        },
        payload: bodyStr,
        muteHttpExceptions: true
      });
      lpData = JSON.parse(lpRes.getContentText() || '{}');
    } catch (netErr) {
      throw new Error('無法連線至 LINE Pay 官方閘道發起付款請求：' + (netErr && netErr.message ? netErr.message : String(netErr)));
    }
    if (!lpData || lpData.returnCode !== '0000' || !lpData.info || !lpData.info.transactionId || !lpData.info.paymentUrl || !lpData.info.paymentUrl.web) {
      throw new Error(`LINE Pay Request 閘道拒絕（${lpData.returnCode || 'ERR'}）：${lpData.returnMessage || '請檢查本店 Channel ID / Secret 與回調網址設定'}`);
    }
    transactionId = String(lpData.info.transactionId);
    paymentUrlWeb = String(lpData.info.paymentUrl.web);
  }

  const expiresAt = Date.now() + 15 * 60 * 1000;
  const signingSecret = getServerSecretKey() + '|' + (lpCfg.channelSecret || 'SYS_LP');
  const reqTokenPayload = `${storeId}|${amount}|${transactionId}|${orderId}|${expiresAt}`;
  const reqTokenSig = computeHmacHex('LINEPAY_REQ_V18:' + reqTokenPayload, signingSecret);

  if (cache) {
    cache.put('LP_PENDING_TX_' + transactionId, JSON.stringify({
      storeId: storeId,
      amount: amount,
      orderId: orderId,
      expiresAt: expiresAt,
      requiresRealConfirm: Boolean(lpCfg.hasMerchantCredentials),
      status: 'REQUESTED'
    }), 900);
  }

  // 一-1：真實 LINE Pay 商家模式於 Request 階段【絕不提前核發 paymentAuthToken】，必須等顧客完成官方頁授權並通過 Confirm API 驗證 returnCode === '0000' 才核發！
  return {
    approved: false,
    step: lpCfg.hasMerchantCredentials ? 'REDIRECT_REQUIRED' : 'DEMO_SANDBOX_READY',
    requiresRedirect: Boolean(lpCfg.hasMerchantCredentials && paymentUrlWeb),
    requiresStoreCredentials: !lpCfg.hasMerchantCredentials,
    gatewayMode: gatewayMode,
    merchantChannelId: lpCfg.channelId ? (lpCfg.channelId.slice(0, 4) + '****' + lpCfg.channelId.slice(-2)) : '未設定商家金鑰（教學展示沙盒）',
    transactionId: transactionId,
    orderId: orderId,
    amount: amount,
    storeId: storeId,
    expiresAt: expiresAt,
    paymentUrlWeb: paymentUrlWeb,
    requestToken: `${reqTokenPayload}.${reqTokenSig}`,
    paymentAuthToken: ''
  };
}

function handleConfirmLinePayCheckout(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const amount = Math.max(0, Math.round(Number(params.amount) || 0));
  const transactionId = String(params.transactionId || '').trim();
  const rawReqToken = String(params.requestToken || '').trim();

  if (!storeId || amount <= 0 || !transactionId) {
    throw new Error('金流 Confirm 確認失敗：缺少必要交易參數');
  }

  const cache = CacheService.getScriptCache();
  // 斷線重整冪等對帳：若同一筆交易已完成官方請款但顧客斷線尚未送出訂單，允許憑相同 transactionId 取回尚未消耗的授權憑證
  if (cache) {
    const existingAuthRaw = cache.get('LP_CONFIRMED_AUTH_' + transactionId);
    if (existingAuthRaw && !cache.get('LP_USED_TX_' + transactionId)) {
      const existingAuth = JSON.parse(existingAuthRaw);
      if (existingAuth && existingAuth.storeId === storeId && Number(existingAuth.amount) === amount) {
        return existingAuth;
      }
    }
    if (cache.get('LP_USED_TX_' + transactionId)) {
      throw new Error('此筆 LINE Pay 交易單號已完成請款並建立訂單，嚴禁重複扣款！');
    }
  }

  const lpCfg = resolveStoreLinePayConfig(storeId);
  if (rawReqToken && rawReqToken.indexOf('.') > 0) {
    const [reqPayload, reqSig] = rawReqToken.split('.');
    const signingSecret = getServerSecretKey() + '|' + (lpCfg.channelSecret || 'SYS_LP');
    const expectedSig = computeHmacHex('LINEPAY_REQ_V18:' + reqPayload, signingSecret);
    if (!constantTimeEquals(reqSig, expectedSig)) {
      throw new Error('各店獨立金流 Request 簽章不符，拒絕 Confirm 請款授權');
    }
    const parts = reqPayload.split('|');
    const expTs = Number(parts[4] || 0);
    if (!expTs || Date.now() > expTs) {
      throw new Error('LINE Pay 付款授權已逾時（超過 15 分鐘），請重新發起結帳');
    }
  } else if (lpCfg.hasMerchantCredentials) {
    // 即使透過 URL 回調回來缺少 requestToken，也須檢查 cache 裡是否有對應的待請款紀錄 (防止偽造 transactionId)
    const pendingRaw = cache ? cache.get('LP_PENDING_TX_' + transactionId) : null;
    if (!pendingRaw) {
      throw new Error('查無對應的待請款交易紀錄或授權已逾時，請重新發起 LINE Pay 結帳');
    }
    const pendingObj = JSON.parse(pendingRaw);
    if (pendingObj.storeId !== storeId || Number(pendingObj.amount) !== amount) {
      throw new Error('交易回調金額或店鋪不符，拒絕請款');
    }
  }

  // 一-1 核心修復：嚴格驗證真實 LINE Pay Confirm API 回傳 returnCode === '0000'，徹底移除空 catch 放行漏洞！
  if (lpCfg.hasMerchantCredentials) {
    const apiBase = lpCfg.isSandbox ? 'https://sandbox-api-pay.line.me' : 'https://api-pay.line.me';
    const uri = `/v3/payments/${encodeURIComponent(transactionId)}/confirm`;
    const nonce = Utilities.getUuid();
    const bodyStr = JSON.stringify({ amount: amount, currency: 'TWD' });
    const sigRaw = lpCfg.channelSecret + uri + bodyStr + nonce;
    const sigBytes = Utilities.computeHmacSha256Signature(sigRaw, lpCfg.channelSecret, Utilities.Charset.UTF_8);
    const sigBase64 = Utilities.base64Encode(sigBytes);

    let confData = {};
    try {
      const confRes = UrlFetchApp.fetch(apiBase + uri, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'X-LINE-ChannelId': lpCfg.channelId,
          'X-LINE-Authorization-Nonce': nonce,
          'X-LINE-Authorization': sigBase64
        },
        payload: bodyStr,
        muteHttpExceptions: true
      });
      confData = JSON.parse(confRes.getContentText() || '{}');
    } catch (netErr) {
      throw new Error('LINE Pay Confirm 請款網路異常，尚未確認入帳，請勿重覆扣款並聯絡櫃檯對帳：' + (netErr && netErr.message ? netErr.message : String(netErr)));
    }
    if (!confData || (confData.returnCode !== '0000' && confData.returnCode !== '1172')) {
      throw new Error(`LINE Pay 官方請款驗證失敗（代碼 ${confData.returnCode || 'UNKNOWN'}）：${confData.returnMessage || '顧客尚未於 LINE Pay 頁面完成授權付款'}`);
    }
  } else if (!params.allowUnconfiguredDemo) {
    throw new Error('本店尚未於後台設定 LINE Pay 商家 Channel ID / Secret，請改選現場付現或通知店長完成金流設定');
  }

  const expiresAt = Date.now() + 15 * 60 * 1000;
  const payloadStr = `${storeId}|${amount}|${transactionId}|${expiresAt}`;
  const sigHex = computeHmacHex('LINEPAY_AUTH_V17:' + payloadStr, getServerSecretKey());
  const confirmedResult = {
    confirmed: true,
    approved: true,
    returnCode: '0000',
    verifiedWithOfficialApi: Boolean(lpCfg.hasMerchantCredentials),
    transactionId: transactionId,
    amount: amount,
    storeId: storeId,
    expiresAt: expiresAt,
    paymentAuthToken: `${payloadStr}.${sigHex}`
  };
  if (cache) {
    cache.put('LP_CONFIRMED_AUTH_' + transactionId, JSON.stringify(confirmedResult), 900);
  }
  return confirmedResult;
}

function verifyLinePayAuthTokenOnServer(paymentAuthToken, expectedStoreId, expectedAmount) {
  const rawToken = String(paymentAuthToken || '').trim();
  if (!rawToken || rawToken.indexOf('.') < 0) return null;
  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;

  const payloadStr = parts[0];
  const providedSig = parts[1];
  const expectedSig = computeHmacHex('LINEPAY_AUTH_V17:' + payloadStr, getServerSecretKey());
  if (!constantTimeEquals(providedSig, expectedSig)) return null;

  const fields = payloadStr.split('|');
  if (fields.length !== 4) return null;
  const [tokenStoreId, tokenAmtStr, transactionId, expStr] = fields;
  const tokenAmt = Number(tokenAmtStr || 0);
  const expiresAt = Number(expStr || 0);

  if (tokenStoreId !== String(expectedStoreId).trim()) return null;
  if (tokenAmt !== Number(expectedAmount)) return null;
  if (!expiresAt || Date.now() > expiresAt) return null;

  // 防重放攻擊 (Anti-Replay)：確保同一張金流交易單號不可被重複用於第二張訂單
  const cache = CacheService.getScriptCache();
  const replayKey = 'LP_USED_TX_' + transactionId;
  if (cache && cache.get(replayKey)) {
    return null;
  }
  if (cache) {
    cache.put(replayKey, '1', 3600);
  }

  return {
    verified: true,
    transactionId: transactionId,
    amount: tokenAmt
  };
}

function handleOrderSubmission(ss, params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) {
    throw new Error('缺少店家編號 (storeId)');
  }

  const orderSheet = ss.getSheetByName('Orders');
  const incomingOrderId = String(params.orderId || ('ORD-' + Utilities.getUuid().slice(0, 12))).trim();
  const clientDeviceId = String(params.clientDeviceId || '').trim().slice(0, 48);

  // 冪等性保護：若該 orderId 已存在，直接回傳既有權威訂單（經最小權限脫敏）
  const isMerchantPosRequest = isMerchantRequestValid(params, storeId);
  const existingLocated = locateOrderRowById(orderSheet, incomingOrderId);
  if (existingLocated) {
    const existingOrder = rowArrayToOrderObject(existingLocated.rowValues);
    return { order: sanitizeOrderForClientOutput(existingOrder, isMerchantPosRequest, true) };
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
  const paymentMethod = String(params.paymentMethod || '現場櫃檯付現').trim();
  const isCashPayment = paymentMethod.indexOf('付現') >= 0 || paymentMethod.indexOf('現金') >= 0;
  const rawPhoneDigits = String(params.customerPhone || '').replace(/\D/g, '');

  // 【#20 防惡意棄單與匿名假單轟炸】非櫃檯 POS 之線上點餐執行嚴格伺服器端檢核
  if (!isMerchantPosRequest) {
    // 1. 現金單或預訂單強制要求台灣手機號碼格式 (09開頭共10碼)
    if ((isCashPayment || isReservation) && !/^09\d{8}$/.test(rawPhoneDigits)) {
      throw new Error('選擇「現場櫃檯付現」或「預訂取餐」必須填寫有效的 10 碼手機號碼（09xxxxxxxx），以防止匿名棄單！');
    }

    // 2. 多維度速率限制：同時綁定裝置 clientDeviceId、完整手機號碼與店鋪全域流速，杜絕亂換手機末 3 碼洗單
    const cache = CacheService.getScriptCache();
    if (cache) {
      const devKey = `SUB_DEV_${clientDeviceId || 'NO_DEV'}`;
      const phoneKey = `SUB_PHONE_${rawPhoneDigits || 'ANON'}`;
      const storeBurstKey = `SUB_BURST_${storeId}`;

      const devHits = Number(cache.get(devKey) || 0);
      const phoneHits = Number(cache.get(phoneKey) || 0);
      const burstHits = Number(cache.get(storeBurstKey) || 0);

      if (devHits >= 3 || phoneHits >= 3) {
        throw new Error('您送出訂單的頻率過高（60 秒內上限 3 筆），請稍候再試');
      }
      if (burstHits >= 30) {
        throw new Error('此櫃位瞬間湧入大量線上訂單，系統啟動防洗單保護，請稍候 15 秒再試');
      }
      cache.put(devKey, String(devHits + 1), 60);
      cache.put(phoneKey, String(phoneHits + 1), 60);
      cache.put(storeBurstKey, String(burstHits + 1), 20);
    }
  }

  if (!isStoreOpen && !isReservation && !isMerchantPosRequest) {
    throw new Error(`「${storeRow.name}」目前暫停立即出餐，請改選「預訂取餐」模式！`);
  }

  const maxCap = Math.max(5, Number(storeRow.maxCapacityPer15Min) || 20);
  const recentOrders = readSheetTailObjects(orderSheet, 300).map(enrichOrderObject);
  const todayStr = getTodayTaipeiStr();

  // 【#20 伺服器端跨裝置未付款現金單上限 + 棄單黑名單攔截】
  // 即使學生清除 localStorage、換無痕視窗或換手機，只要同一手機號碼或同一裝置在當日已有 >= 2 筆未付款現金單，
  // 或該手機近期已有 >= 2 筆現金逾時未取 / 棄單作廢紀錄，後端強制拒絕現金單並要求改用 LINE Pay！
  if (!isMerchantPosRequest && isCashPayment) {
    const activeUnpaidCashOrders = recentOrders.filter(o => {
      if (!o || String(o.status || '').indexOf('已取消') >= 0 || o.status === '已完成') return false;
      if (normalizeSheetDateStr(o.pickupDate) !== todayStr) return false;
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
        if (stStr.indexOf('逾期') < 0 && stStr.indexOf('逾時未取') < 0 && stStr.indexOf('棄單') < 0) return false;
        const ordPhoneDigits = String(o.customerPhone || '').replace(/\D/g, '');
        return ordPhoneDigits === rawPhoneDigits;
      }).length;
      if (noShowCount >= 2) {
        throw new Error('系統風控通知：此手機號碼近期累計多筆現金單逾時未取棄單紀錄，已暫停使用「現場付現」功能，請改以 LINE Pay 線上付款點餐。');
      }
    }
  }

  let pickupDateVal = isReservation ? normalizeSheetDateStr(params.pickupDate) : todayStr;
  if (pickupDateVal < todayStr) {
    pickupDateVal = todayStr;
  }
  const now = new Date();
  const createdAtStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm:ss');
  const pickupTimeVal = isReservation ? normalizeSheetTimeStr(params.pickupTime, false) : createdAtStr.slice(0, 5);

  // 【商業級改造 B7 & #21】後端檢核店鋪公休日、營業時間與午休時段，以及 #13 交班日結關班鎖定保護
  let customStoreMetaMap = {};
  try { customStoreMetaMap = JSON.parse(props.getProperty('STORE_CUSTOM_META') || '{}'); } catch (e) {}
  const storeCustomMeta = customStoreMetaMap[storeId] || {};

  // #13：若該店今日已完成交班日結鎖定，攔截當日新現場 POS 帳單（除非先由店長於日結單解鎖）
  if (isMerchantPosRequest && pickupDateVal === todayStr) {
    let storeShiftLocks = {};
    try { storeShiftLocks = JSON.parse(props.getProperty('SHIFT_LOCKS_' + storeId) || '{}'); } catch (e) {}
    if (storeShiftLocks && storeShiftLocks[todayStr] && storeShiftLocks[todayStr].locked) {
      throw new Error(`「${storeRow.name}」今日 (${todayStr}) 班別已完成關班日結鎖定！如需補開帳單，請先於「交班日結單」由店長解除關班鎖定。`);
    }
  }

  // #21：若非預訂單（即學生選擇「立即製作」），後端嚴格檢查當前時間是否落在 openTime~closeTime 且非午休時段、非公休日
  if (!isReservation && !isMerchantPosRequest) {
    const bizCheck = evaluateStoreBusinessHoursOnServer(storeCustomMeta, isStoreOpen);
    if (!bizCheck.canOrderNow) {
      throw new Error(`「${storeRow.name}」${bizCheck.statusLabel}，目前無法選擇「立即製作」，請切換為「📅 預訂取餐」！`);
    }
  }

  const closedDays = Array.isArray(storeCustomMeta.closedDays)
    ? storeCustomMeta.closedDays.map(Number)
    : String(storeCustomMeta.closedDays || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  if (!isMerchantPosRequest && closedDays.length > 0) {
    const dParts = pickupDateVal.split('-');
    if (dParts.length === 3) {
      const dtObj = new Date(Number(dParts[0]), Number(dParts[1]) - 1, Number(dParts[2]));
      if (closedDays.includes(dtObj.getDay())) {
        throw new Error(`「${storeRow.name}」於 ${pickupDateVal} 公休，請選擇其他營業日期！`);
      }
    }
  }

  const rawItems = Array.isArray(params.items)
    ? params.items
    : (Array.isArray(params.structuredItems) ? params.structuredItems : []);
  const nonGiftItems = rawItems.filter(it => it && !it.isGift && String(it.id) !== 'GIFT-AI');

  if (nonGiftItems.length === 0) {
    throw new Error('購物車內無有效付費餐點，拒絕結帳');
  }

  // 【商業級改造 6 & #26】預訂時段 15 分鐘產能配額改以「餐點總份數 (Portion Units)」計算，防範大團單塞爆廚房
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

  const allMenus = sheetToObjects(ss.getSheetByName('Menus'))
    .filter(m => String(m.storeId) === storeId);
  const dailySoldMap = buildDailyMenuSoldMap(recentOrders, pickupDateVal);
  const menuById = {};
  const menuByName = {};
  allMenus.forEach(m => {
    const { parsedOptions, isSoldOut, dailyLimit } = parseMenuRowOptionsAndSoldOut(m);
    const mId = String(m.id);
    const mName = String(m.name).trim();
    const soldToday = Math.max(
      Number(dailySoldMap[`${storeId}::ID::${mId}`] || 0),
      Number(dailySoldMap[`${storeId}::NAME::${mName}`] || 0)
    );
    const itemObj = {
      id: mId,
      name: mName,
      price: Math.max(0, Number(m.price) || 0),
      soldOut: isSoldOut,
      dailyLimit: dailyLimit,
      soldToday: soldToday,
      options: parsedOptions
    };
    menuById[itemObj.id] = itemObj;
    menuByName[itemObj.name] = itemObj;
  });

  const verifiedItems = [];
  let authoritativeSubtotal = 0;
  const snapshotTimestamp = now.getTime();
  const itemQtyAccumulator = {};
  const autoSoldOutMenuIds = [];

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

    // #14 每日限量庫存檢核 (Daily Limit Inventory Check)
    itemQtyAccumulator[dbMenu.id] = (itemQtyAccumulator[dbMenu.id] || 0) + qty;
    if (dbMenu.dailyLimit > 0 && pickupDateVal === todayStr) {
      const nextTotalSold = dbMenu.soldToday + itemQtyAccumulator[dbMenu.id];
      if (nextTotalSold > dbMenu.dailyLimit && !isMerchantPosRequest) {
        const remain = Math.max(0, dbMenu.dailyLimit - dbMenu.soldToday);
        throw new Error(`抱歉，「${dbMenu.name}」今日限量 ${dbMenu.dailyLimit} 份，目前僅剩 ${remain} 份，請調整數量！`);
      }
      if (nextTotalSold >= dbMenu.dailyLimit && autoSoldOutMenuIds.indexOf(dbMenu.id) < 0) {
        autoSoldOutMenuIds.push(dbMenu.id);
      }
    }

    let unitExtra = 0;
    const verifiedSelections = {};
    const clientSelections = (reqItem.selections && typeof reqItem.selections === 'object') ? reqItem.selections : {};
    const dbOptions = dbMenu.options || {};

    Object.keys(dbOptions).forEach(optGroupName => {
      const grp = dbOptions[optGroupName];
      const grpType = grp && grp.type ? String(grp.type) : 'radio';
      const isRadio = grpType === 'radio';
      const isQtyMode = grpType === 'qty';
      const choices = Array.isArray(grp.choices) ? grp.choices : (Array.isArray(grp) ? grp : []);
      if (choices.length === 0) return;

      const minSelect = Math.max(0, parseInt(grp.minSelect || (isRadio ? 1 : 0), 10) || 0);
      const maxSelect = Math.max(0, parseInt(grp.maxSelect || 0, 10) || 0);
      const maxPerChoice = Math.max(1, parseInt(grp.maxPerChoice || 5, 10) || 5);

      const choicePriceMap = {};
      const choiceSoldOutMap = {};
      const choiceSubOptionsMap = {};
      choices.forEach(c => {
        const cName = String(Array.isArray(c) ? c[0] : (c && (c.label || c.name) ? (c.label || c.name) : c)).trim();
        const cExtra = Array.isArray(c) ? Math.max(0, Number(c[1]) || 0) : (c && (c.priceDelta !== undefined || c.price !== undefined) ? Math.max(0, Number(c.priceDelta !== undefined ? c.priceDelta : c.price) || 0) : 0);
        const cSoldOut = Array.isArray(c) ? Boolean(c[2]) : Boolean(c && c.soldOut);
        const cSubOpts = (Array.isArray(c) && c[3] && typeof c[3] === 'object') ? c[3] : (c && c.subOptions && typeof c.subOptions === 'object' ? c.subOptions : null);
        choicePriceMap[cName] = cExtra;
        choiceSoldOutMap[cName] = cSoldOut;
        if (cSubOpts) choiceSubOptionsMap[cName] = cSubOpts;
      });

      const rawSelected = clientSelections[optGroupName];
      if (isQtyMode) {
        // 三-1：支援多數量加購計費（例如「加香濃起司×2, 加溏心蛋×3」）
        const parsedTokens = Array.isArray(rawSelected)
          ? rawSelected
          : String(rawSelected || '').split(',').map(s => s.trim()).filter(Boolean);
        let totalQtyChosen = 0;
        const validParts = [];
        parsedTokens.forEach(tok => {
          const qMatch = String(tok).match(/^(.+?)(?:[×xX*]\s*(\d+))?$/);
          if (!qMatch) return;
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
        });
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
          if (isMerchantPosRequest) {
            const firstAvail = choices.find(c => !(Array.isArray(c) ? c[2] : Boolean(c && c.soldOut))) || choices[0];
            chosenStr = String(Array.isArray(firstAvail) ? firstAvail[0] : (firstAvail && (firstAvail.label || firstAvail.name) ? (firstAvail.label || firstAvail.name) : firstAvail)).trim();
          } else {
            throw new Error(`請為「${dbMenu.name}」選擇必選規格「${optGroupName}」`);
          }
        }
        verifiedSelections[optGroupName] = chosenStr;
        unitExtra += choicePriceMap[chosenStr];

        // 三-1：若所選套餐項目帶有巢狀次級規格 (subOptions，支援 Array [{name, choices}] 或 Object {name: {choices}})，於後端嚴格驗算
        const subOptsRaw = choiceSubOptionsMap[chosenStr];
        if (subOptsRaw && typeof subOptsRaw === 'object') {
          const subGroupList = Array.isArray(subOptsRaw)
            ? subOptsRaw.map((sg, idx) => ({ name: String(sg.name || sg.title || `子規格${idx + 1}`), choices: Array.isArray(sg.choices) ? sg.choices : [] }))
            : Object.keys(subOptsRaw).map(k => ({ name: k, choices: Array.isArray(subOptsRaw[k]?.choices) ? subOptsRaw[k].choices : [] }));
          subGroupList.forEach(subGrp => {
            const subGrpName = subGrp.name;
            const subChoices = subGrp.choices;
            if (subChoices.length === 0) return;
            const subKeyDot = `${chosenStr}・${subGrpName}`;
            const subKeyArrow = `${optGroupName}▸${subGrpName}`;
            const subSelRaw = String(clientSelections[subKeyDot] || clientSelections[subKeyArrow] || clientSelections[subGrpName] || '').trim();
            const subPriceMap = {};
            subChoices.forEach(sc => {
              const sn = String(Array.isArray(sc) ? sc[0] : (sc && (sc.label || sc.name) ? (sc.label || sc.name) : sc)).trim();
              const sp = Array.isArray(sc) ? Math.max(0, Number(sc[1]) || 0) : (sc && (sc.priceDelta !== undefined || sc.price !== undefined) ? Math.max(0, Number(sc.priceDelta !== undefined ? sc.priceDelta : sc.price) || 0) : 0);
              subPriceMap[sn] = sp;
            });
            let finalSubVal = subSelRaw;
            if (!finalSubVal) {
              const firstSub = subChoices[0];
              finalSubVal = String(Array.isArray(firstSub) ? firstSub[0] : (firstSub && (firstSub.label || firstSub.name) ? (firstSub.label || firstSub.name) : firstSub)).trim();
            }
            if (subPriceMap[finalSubVal] === undefined) {
              throw new Error(`品項「${dbMenu.name}」的套餐次級選項「${subGrpName}: ${finalSubVal}」無效`);
            }
            verifiedSelections[subKeyDot] = finalSubVal;
            unitExtra += subPriceMap[finalSubVal];
          });
        }
      } else {
        const selectedArr = Array.isArray(rawSelected)
          ? rawSelected.map(s => String(s).trim()).filter(Boolean)
          : String(rawSelected || '').split(',').map(s => s.trim()).filter(Boolean);
        const validChosen = [];
        selectedArr.forEach(sName => {
          if (choicePriceMap[sName] === undefined) {
            throw new Error(`品項「${dbMenu.name}」的加料選項「${sName}」無效，請重新點選`);
          }
          if (choiceSoldOutMap[sName] && !isMerchantPosRequest) {
            throw new Error(`品項「${dbMenu.name}」的加料選項「${sName}」今日已售罄，請取消勾選`);
          }
          validChosen.push(sName);
          unitExtra += choicePriceMap[sName];
        });
        if (!isMerchantPosRequest && minSelect > 0 && validChosen.length < minSelect) {
          throw new Error(`品項「${dbMenu.name}」的「${optGroupName}」至少需選擇 ${minSelect} 項`);
        }
        if (!isMerchantPosRequest && maxSelect > 0 && validChosen.length > maxSelect) {
          throw new Error(`品項「${dbMenu.name}」的「${optGroupName}」最多只能選擇 ${maxSelect} 項`);
        }
        if (validChosen.length > 0) {
          verifiedSelections[optGroupName] = validChosen.join(', ');
        }
      }
    });

    const authoritativeUnitPrice = Math.max(0, dbMenu.price + unitExtra);
    const lineSubtotal = authoritativeUnitPrice * qty;
    const selSuffix = Object.keys(verifiedSelections).length > 0
      ? ` [${Object.entries(verifiedSelections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
      : '';

    // 【#40 完整歷史價格與規格快照隔離】封存結帳當下的 basePrice, unitExtra, price 與 lineSubtotal
    verifiedItems.push({
      id: dbMenu.id,
      baseName: dbMenu.name,
      name: `${dbMenu.name}${selSuffix}`,
      basePrice: dbMenu.price,
      unitExtra: unitExtra,
      price: authoritativeUnitPrice,
      qty: qty,
      lineSubtotal: lineSubtotal,
      selections: verifiedSelections,
      itemNote: String(reqItem.itemNote || '').trim().slice(0, 60),
      isGift: false,
      snapshotAtTs: snapshotTimestamp
    });

    authoritativeSubtotal += lineSubtotal;
  }

  // 【商業級改造 5】計算佇列負載並檢查是否為「午間尖峰預訂單 (11:45~12:45)」
  const queueMap = recomputeAllStoreQueuesInMemory(ss, recentOrders, false);
  const storeActiveCount = (queueMap[storeId] && queueMap[storeId].activeOrders) || 0;
  const isFullLoad = Math.round((storeActiveCount / maxCap) * 100) >= 85;
  const promoMode = String(storeRow.promoMode || 'none');
  const promoText = String(storeRow.promoText || '');
  const promoScope = storeCustomMeta.promoScope === 'ALL_DAY' ? 'ALL_DAY' : 'OFF_PEAK';
  const promoMinSubtotal = storeCustomMeta.promoMinSubtotal !== undefined ? Math.max(0, Number(storeCustomMeta.promoMinSubtotal) || 0) : AI_DISCOUNT_MIN_SUBTOTAL;
  const isPeakReservation = isReservation && isPeakHourSlotOnServer(pickupTimeVal);
  // 三-2：支援「全天候常態促銷 (ALL_DAY)」與「離峰分流促銷 (OFF_PEAK)」彈性設定
  const promoActive = isStoreOpen && promoMode !== 'none' && (promoScope === 'ALL_DAY' || (!isFullLoad && !isPeakReservation));

  // #30 & 三-2：優先使用店家顯式綁定的贈品品項 ID (giftMenuItemId) 檢查庫存與售罄，僅在未綁定時回退舊制關鍵字檢查
  const customerWantsGift = params.wantGift !== false;
  let giftSoldOut = false;
  if (promoActive && (promoMode === 'gift' || promoMode === 'freebie') && promoText) {
    const explicitGiftId = String(storeCustomMeta.giftMenuItemId || '').trim();
    if (explicitGiftId && menuById[explicitGiftId]) {
      const gm = menuById[explicitGiftId];
      if (gm.soldOut || (gm.dailyLimit > 0 && gm.soldToday >= gm.dailyLimit)) giftSoldOut = true;
    } else {
      const giftKeywords = ['溫泉蛋', '溏心蛋', '滷蛋', '紅茶', '綠茶', '奶茶', '冬瓜茶', '豆漿', '味噌湯', '玉米濃湯', '酸辣湯', '豆腐', '小菜'];
      const matchedKw = giftKeywords.find(kw => promoText.indexOf(kw) >= 0);
      if (matchedKw) {
        const matchedMenu = allMenus.find(m => String(m.name || '').indexOf(matchedKw) >= 0);
        if (matchedMenu) {
          const parsedG = parseMenuRowOptionsAndSoldOut(matchedMenu);
          if (parsedG.isSoldOut) giftSoldOut = true;
        }
      }
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
      snapshotAtTs: snapshotTimestamp
    });
  }

  const needCutlery = Boolean(params.needCutlery);
  const storeCutleryPrice = storeRow.cutleryPrice !== undefined && storeRow.cutleryPrice !== ''
    ? Math.max(0, Number(storeRow.cutleryPrice))
    : 1;
  const cutleryFee = needCutlery ? storeCutleryPrice : 0;

  let authoritativeDiscount = 0;
  const totalNonGiftQty = verifiedItems.reduce((s, it) => s + (it.isGift ? 0 : (Number(it.qty) || 1)), 0);
  if (promoActive && promoMode === 'discount' && authoritativeSubtotal >= promoMinSubtotal) {
    authoritativeDiscount = Math.min(authoritativeSubtotal, Math.max(0, Number(storeRow.promoDiscount) || 0));
  } else if (promoActive && promoMode === 'second_discount' && totalNonGiftQty >= 2 && authoritativeSubtotal >= promoMinSubtotal) {
    const pairCount = Math.floor(totalNonGiftQty / 2);
    const perPairOff = Math.max(0, Number(storeCustomMeta.secondItemDiscount || storeRow.promoDiscount) || 10);
    authoritativeDiscount = Math.min(authoritativeSubtotal, pairCount * perPairOff);
  }

  // 三-2：優惠碼 / 折扣碼 (Coupon Code) 伺服器端白名單驗證與折抵
  let appliedCouponCode = '';
  let couponDiscount = 0;
  const reqCouponCode = String(params.couponCode || '').trim().toUpperCase();
  if (reqCouponCode) {
    const storeCoupons = Array.isArray(storeCustomMeta.coupons) ? storeCustomMeta.coupons : [];
    const matchedCoupon = storeCoupons.find(c => c && c.active !== false && String(c.code || '').trim().toUpperCase() === reqCouponCode);
    if (!matchedCoupon) {
      throw new Error(`折扣碼「${reqCouponCode}」無效或已停用，請重新確認`);
    }
    const cMin = Math.max(0, Number(matchedCoupon.minSubtotal) || 0);
    if (authoritativeSubtotal < cMin) {
      throw new Error(`折扣碼「${reqCouponCode}」需消費滿 NT$${cMin} 方可使用`);
    }
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

  let manualDiscount = 0;
  let manualDiscountReason = '';
  if (isMerchantPosRequest && Number(params.manualDiscount) > 0) {
    // 二-1：一般收銀員 (STAFF) 執行 >= $10 手動折讓或全單招待，強制需要店長覆核授權碼
    const reqManualDisc = Math.max(0, Number(params.manualDiscount) || 0);
    if (reqManualDisc >= 10) {
      assertManagerAuthorized(params, storeId);
    }
    manualDiscount = Math.min(
      Math.max(0, authoritativeSubtotal - authoritativeDiscount),
      reqManualDisc
    );
    manualDiscountReason = String(params.manualDiscountReason || '櫃檯手動折讓').trim();
  }

  const authoritativeFinalTotal = Math.max(0, authoritativeSubtotal + cutleryFee - authoritativeDiscount - manualDiscount);

  // 三-3：支援內用桌號 (tableNumber) 與內用「先吃後付 (餐後櫃檯結帳)」模式
  const dineType = String(params.dineType || '外帶自取').trim();
  const tableNumber = String(params.tableNumber || '').trim().slice(0, 16);
  const isDineInPostPay = Boolean(!isMerchantPosRequest && dineType === '內用自取' && storeCustomMeta.allowDineInPostPay && params.paymentMethod === '內用餐後結帳');

  const isLargeCashReserve = isReservation && authoritativeFinalTotal >= LARGE_ORDER_DEPOSIT_THRESHOLD && isCashPayment;
  let paymentStatus = '取餐付現';
  let verifiedTransactionId = '';

  if (isMerchantPosRequest) {
    paymentStatus = '已付款';
    verifiedTransactionId = String(params.transactionId || ('POS-' + now.getTime()));
  } else if (isDineInPostPay) {
    paymentStatus = '內用餐後結帳';
  } else if (paymentMethod === 'LINE Pay') {
    const lpVerify = verifyLinePayAuthTokenOnServer(params.paymentAuthToken, storeId, authoritativeFinalTotal);
    if (!lpVerify || !lpVerify.verified) {
      throw new Error('線上行動支付 (LINE Pay) 金流簽章驗證失敗、金額不符或交易憑證已過期，拒絕偽造已付款訂單！請重新發起付款授權。');
    }
    paymentStatus = '已付款';
    verifiedTransactionId = lpVerify.transactionId;
  } else if (isLargeCashReserve) {
    paymentStatus = '待櫃檯繳費';
  }

  // 一-4：POS 現場單 (A001+) 與線上學生單 (B001+) 通道完全分流，離線 POS 單號 Axxx 絕不與線上單 Bxxx 撞號！
  const channelPrefix = isMerchantPosRequest ? 'A' : 'B';
  let pickupNumber = '';
  const requestedPosNum = String(params.pickupNumber || '').trim().toUpperCase();
  const isOfflineResync = Boolean(params.isOfflineSync || params.isOfflinePending);
  if (isMerchantPosRequest && isOfflineResync && /^[A]?\d{3,5}$/.test(requestedPosNum)) {
    const normalizedOfflineNum = requestedPosNum.startsWith('A') ? requestedPosNum : ('A' + requestedPosNum.slice(-3).padStart(3, '0'));
    const isTaken = recentOrders.some(o =>
      o && String(o.storeId) === storeId &&
      normalizeSheetDateStr(o.pickupDate) === pickupDateVal &&
      String(o.pickupNumber || '').toUpperCase() === normalizedOfflineNum
    );
    if (!isTaken) {
      pickupNumber = normalizedOfflineNum;
      const propKey = `SEQ_${storeId}_${pickupDateVal}_A`;
      const curSaved = parseInt(props.getProperty(propKey) || '0', 10);
      const numVal = parseInt(normalizedOfflineNum.replace(/\D/g, ''), 10) || 0;
      if (numVal > curSaved) props.setProperty(propKey, String(numVal));
    }
  }
  let originalOfflinePickupNumber = '';
  if (!pickupNumber) {
    pickupNumber = generateBackendSequentialPickupNumber(ss, storeId, pickupDateVal, channelPrefix);
    if (isMerchantPosRequest && isOfflineResync && requestedPosNum && requestedPosNum !== pickupNumber) {
      originalOfflinePickupNumber = requestedPosNum;
    }
  }

  const verificationCode = generateOrderVerificationCodeOnServer(incomingOrderId, pickupNumber, authoritativeFinalTotal);

  const nowParts = createdAtStr.split(':');
  const nowMinutesOfDay = parseInt(nowParts[0], 10) * 60 + parseInt(nowParts[1], 10);
  const storeLeadMins = Math.max(10, Math.min(90, Number(storeCustomMeta.reserveLeadMinutes) || 25));
  const initialStatus = evaluateServerOrderLifecycleStatus(
    '製作中',
    isReservation,
    paymentStatus,
    pickupDateVal,
    pickupTimeVal,
    getTodayTaipeiStr(),
    nowMinutesOfDay,
    storeLeadMins
  );

  const customerNote = String(params.customerNote || '').trim();
  const customerPhone = String(params.customerPhone || '').trim();
  const taxId = String(params.taxId || '').trim().replace(/\D/g, '').slice(0, 8);
  const carrierCode = String(params.carrierCode || '').trim().toUpperCase().slice(0, 16);
  const paidAtDate = paymentStatus === '已付款' ? getTodayTaipeiStr() : '';
  const studentNameSummary = [
    dineType,
    tableNumber ? `🪑 桌號:${tableNumber}` : '',
    needCutlery ? `🥢 需免洗餐具${cutleryFee > 0 ? `(+$${cutleryFee})` : ''}` : '',
    taxId ? `🧾 統編:${taxId}` : '',
    carrierCode ? `📱 載具:${carrierCode}` : '',
    customerNote ? `📝 備註：${customerNote}` : ''
  ].filter(Boolean).join(' ・ ');

  const promoAppliedText = [
    manualDiscount > 0 ? manualDiscountReason : (promoActive ? promoText : ''),
    appliedCouponCode ? `折扣碼:${appliedCouponCode}(-$${couponDiscount})` : ''
  ].filter(Boolean).join(' + ') || String(params.promoApplied || '一般點餐');

  const pickupTimeSlot = isReservation
    ? `📅 預訂 ${pickupDateVal} ${pickupTimeVal}`
    : String(params.pickupTimeSlot || '⚡ 立即製作');

  const extraMeta = {
    dineType: dineType,
    tableNumber: tableNumber,
    carrierCode: carrierCode,
    couponCode: appliedCouponCode,
    couponDiscount: couponDiscount,
    isDineInPostPay: isDineInPostPay,
    itemCheckedMap: {},
    needCutlery: needCutlery,
    cutleryFee: cutleryFee,
    taxId: taxId,
    manualDiscount: manualDiscount,
    manualDiscountReason: manualDiscountReason,
    isReservation: isReservation,
    pickupDate: pickupDateVal,
    pickupTime: pickupTimeVal,
    customerPhone: customerPhone,
    customerNote: customerNote,
    paymentDeadline: isLargeCashReserve ? pickupDateVal : '',
    paymentStatus: paymentStatus,
    paidAtDate: paidAtDate,
    transactionId: verifiedTransactionId,
    paymentVerifiedByHmac: Boolean(paymentStatus === '已付款'),
    clientDeviceId: clientDeviceId,
    cashReceived: isMerchantPosRequest ? (Number(params.cashReceived) || 0) : 0,
    changeGiven: isMerchantPosRequest ? (Number(params.changeGiven) || 0) : 0,
    paymentSplit: (isMerchantPosRequest && params.paymentSplit && typeof params.paymentSplit === 'object') ? params.paymentSplit : null,
    originalOfflinePickupNumber: originalOfflinePickupNumber,
    giftSoldOutSkipped: Boolean(giftSoldOut),
    notifyCount: 0,
    lineUserId: String(params.lineUserId || ''),
    customerEmail: String(params.customerEmail || ''),
    verificationCode: verificationCode,
    createdAtTs: now.getTime(),
    cookingStartedAtTs: initialStatus === '製作中' ? now.getTime() : 0,
    readyAtTs: 0,
    merchantMessage: '',
    merchantMessages: [],
    statusTimeline: [{
      ts: now.getTime(),
      timeStr: createdAtStr,
      status: initialStatus,
      label: isReservation ? `預約訂單成立 (預計 ${pickupDateVal} ${pickupTimeVal} 取餐)` : '訂單成立並送入廚房'
    }]
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

  // 一-3 核心修正：每日限量達標時【絕不硬寫 Menus.soldOut = true】，改由 getInitBundle 動態計算今日剩餘量，
  // 確保退單立即自動補回庫存、隔日營業自動歸零重新上架！
  if (autoSoldOutMenuIds.length > 0) {
    invalidateStoresMenusCache();
  }

  const savedOrderObj = rowArrayToOrderObject(newRow);
  recomputeAllStoreQueuesInMemory(ss, [savedOrderObj, ...recentOrders], true);

  // 【商業級改造 7】於伺服器內部自動發送訂單成立 LINE / Email 通知
  const pushTitle = isLargeCashReserve
    ? `⏳ 大額預訂單 #${pickupNumber} 待確認`
    : `🟢 訂單 #${pickupNumber} 已成立 (${initialStatus})`;
  const pushBody = `【${storeRow.name}】${pickupTimeSlot}，應付 NT$${authoritativeFinalTotal} (${paymentMethod})，防偽核銷碼：${verificationCode}。`;
  dispatchOrderNotificationOnServer(ss, savedOrderObj, pushTitle, pushBody, initialStatus);

  return {
    order: sanitizeOrderForClientOutput(savedOrderObj, isMerchantPosRequest, true)
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
    if (meta.paymentStatus === '已付款') {
      if (!meta.paidAtDate) meta.paidAtDate = getTodayTaipeiStr();
      if (Number(meta.pendingAddOnAmount) > 0) {
        meta.extraChargeTotal = Math.max(0, Number(meta.extraChargeTotal) || 0) + Number(meta.pendingAddOnAmount);
        meta.extraChargeMethod = String(params.paymentMethod || rowVals[12] || '現金').trim();
        meta.extraChargeAtDate = getTodayTaipeiStr();
        meta.pendingAddOnAmount = 0;
      }
    }
  }
  if (params.paidAtDate) {
    meta.paidAtDate = normalizeSheetDateStr(params.paidAtDate);
  }
  const nextStatus = String(params.newStatus || rowVals[13] || '製作中').trim();
  if (nextStatus === '已完成' && String(meta.paymentStatus || '已付款') !== '已付款') {
    throw new Error('此訂單尚未完成付款確認，請先收款後再核銷交付');
  }
  rowVals[13] = nextStatus;

  const isRecall = Boolean(params.isRecall);
  if (nextStatus === '可取餐') {
    if (!isRecall) {
      meta.notifyCount = (Number(meta.notifyCount) || 0) + 1;
      if (!meta.readyAtTs) meta.readyAtTs = Date.now();
    }
  }
  if (nextStatus === '製作中' && !meta.cookingStartedAtTs) {
    meta.cookingStartedAtTs = Date.now();
  }
  if (params.paymentMethod) {
    rowVals[12] = String(params.paymentMethod).trim();
  }
  if (params.paymentSplit && typeof params.paymentSplit === 'object') {
    meta.paymentSplit = params.paymentSplit;
  }
  if (params.cashReceived !== undefined) {
    meta.cashReceived = Number(params.cashReceived) || 0;
  }
  if (params.changeGiven !== undefined) {
    meta.changeGiven = Number(params.changeGiven) || 0;
  }

  // #37 記錄訂單狀態時間軸 (Status Timeline Log)
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  const nowStrTimeline = Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH:mm:ss');
  const tlLabel = isRecall
    ? `店員復原狀態：${prevStatus} ➔ ${nextStatus}`
    : (nextStatus === '可取餐'
      ? `櫃檯第 ${meta.notifyCount || 1} 次叫號通知取餐`
      : (nextStatus === '已完成' ? '已完成核銷交付取餐' : `狀態變更為：${nextStatus}`));
  meta.statusTimeline.push({
    ts: Date.now(),
    timeStr: nowStrTimeline,
    status: nextStatus,
    label: tlLabel
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);

  rowVals[16] = JSON.stringify(meta);
  orderSheet.getRange(located.sheetRowIndex, 1, 1, 17).setValues([rowVals]);

  const updatedOrderObj = rowArrayToOrderObject(rowVals);
  const recentOrders = readSheetTailObjects(orderSheet, 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);

  // 於伺服器內部自動發送取餐或結單通知（若為 #23 狀態退回/復原則不重複推播叫號通知）
  if (!isRecall && !params.suppressPush) {
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
  }

  return {
    updated: true,
    order: updatedOrderObj
  };
}

// #12 & 一-5 未完成訂單「改單 / 單品作廢 / 加價補差額」後端原子寫入與金額重算
function handleModifyOrderItems(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const orderId = String(params.orderId || '').trim();
  const located = locateOrderRowById(orderSheet, orderId);
  if (!located) throw new Error('找不到該筆訂單: ' + orderId);

  const rowVals = located.rowValues;
  const orderStoreId = String(rowVals[2] || '').trim();
  const sess = assertMerchantAuthorized(params, orderStoreId);

  const curStatus = String(rowVals[13] || '').trim();
  if (curStatus === '已完成' || curStatus.indexOf('已取消') >= 0) {
    throw new Error('已完成或已作廢之訂單不可改單');
  }

  const incomingItems = Array.isArray(params.structuredItems) ? params.structuredItems : [];
  if (incomingItems.length === 0) {
    throw new Error('改單後至少須保留 1 項餐點（若欲整單取消請使用「退單」功能）');
  }

  let meta = {};
  try { meta = JSON.parse(rowVals[16] || '{}'); } catch (e) {}
  // 改單前封存原 6 碼防偽核銷碼，避免改單變動金額後導致顧客紙本小票 / QR Code 核銷碼失效
  if (!meta.sealedVerificationCode) {
    meta.sealedVerificationCode = generateOrderVerificationCodeOnServer(rowVals[0], rowVals[1], Number(rowVals[9]) || 0);
  }

  const cleanItems = incomingItems.map(it => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const price = Math.max(0, Number(it.price) || 0);
    return {
      ...it,
      qty: qty,
      price: price,
      lineSubtotal: price * qty
    };
  });

  const newSubtotal = cleanItems.reduce((sum, it) => sum + (it.isGift ? 0 : it.price * it.qty), 0);
  const cutleryFee = Math.max(0, Number(meta.cutleryFee) || 0);
  const discount = Math.min(newSubtotal, Math.max(0, Number(rowVals[8]) || 0));
  const manualDiscount = Math.min(Math.max(0, newSubtotal - discount), Math.max(0, Number(meta.manualDiscount) || 0));
  const newFinalTotal = Math.max(0, newSubtotal + cutleryFee - discount - manualDiscount);
  const oldFinalTotal = Math.max(0, Number(rowVals[9]) || 0);

  rowVals[6] = JSON.stringify(cleanItems);
  rowVals[7] = newSubtotal;
  rowVals[8] = discount;
  rowVals[9] = newFinalTotal;

  const modifyReason = String(params.reason || '櫃檯改單/單品作廢').trim();
  const wasPaid = String(meta.paymentStatus || '') === '已付款';
  let diffLabel = '';
  if (wasPaid && newFinalTotal < oldFinalTotal) {
    const partialDiff = oldFinalTotal - newFinalTotal;
    meta.partialRefundTotal = Math.max(0, Number(meta.partialRefundTotal) || 0) + partialDiff;
    meta.refundedAtDate = getTodayTaipeiStr();
    diffLabel = `・部分退現 $${partialDiff}`;
  } else if (wasPaid && newFinalTotal > oldFinalTotal) {
    // 一-5：改單向上加價時明確紀錄補收差額與補款方式（現金 / LINE Pay），交班日結實收帳務零誤差
    const extraDiff = newFinalTotal - oldFinalTotal;
    const extraMethod = String(params.extraChargeMethod || '現金').trim();
    meta.extraChargeTotal = Math.max(0, Number(meta.extraChargeTotal) || 0) + extraDiff;
    meta.extraChargeMethod = extraMethod;
    meta.extraChargeAtDate = getTodayTaipeiStr();
    if (!Array.isArray(meta.extraChargeHistory)) meta.extraChargeHistory = [];
    meta.extraChargeHistory.push({
      ts: Date.now(),
      amount: extraDiff,
      method: extraMethod,
      cashier: sess.staffName || '櫃檯人員',
      dateStr: getTodayTaipeiStr()
    });
    diffLabel = `・補收差額 $${extraDiff}(${extraMethod})`;
  }
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({
    ts: Date.now(),
    timeStr: Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH:mm:ss'),
    status: curStatus,
    label: `改單 (${modifyReason}・金額 $${oldFinalTotal} ➔ $${newFinalTotal}${diffLabel})`
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);
  meta.lastModifiedReason = modifyReason;
  rowVals[16] = JSON.stringify(meta);

  orderSheet.getRange(located.sheetRowIndex, 1, 1, 17).setValues([rowVals]);
  const updatedOrderObj = rowArrayToOrderObject(rowVals);
  const recentOrders = readSheetTailObjects(orderSheet, 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);
  invalidateStoresMenusCache();

  return { updated: true, order: updatedOrderObj };
}

// 二-3：KDS 廚房單品逐項劃單狀態持久化（多平板即時同步）
function handleUpdateOrderItemCheckState(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const orderId = String(params.orderId || '').trim();
  const located = locateOrderRowById(orderSheet, orderId);
  if (!located) throw new Error('找不到該筆訂單: ' + orderId);

  const rowVals = located.rowValues;
  const orderStoreId = String(rowVals[2] || '').trim();
  assertMerchantAuthorized(params, orderStoreId);

  let meta = {};
  try { meta = JSON.parse(rowVals[16] || '{}'); } catch (e) {}
  if (!meta.itemCheckedMap || typeof meta.itemCheckedMap !== 'object') {
    meta.itemCheckedMap = {};
  }

  if (params.itemCheckedMap && typeof params.itemCheckedMap === 'object') {
    meta.itemCheckedMap = { ...meta.itemCheckedMap, ...params.itemCheckedMap };
  } else if (params.itemKey !== undefined) {
    const key = String(params.itemKey).trim();
    if (key) meta.itemCheckedMap[key] = Boolean(params.checked);
  }

  rowVals[16] = JSON.stringify(meta);
  orderSheet.getRange(located.sheetRowIndex, 1, 1, 17).setValues([rowVals]);
  return { updated: true, order: rowArrayToOrderObject(rowVals) };
}

// 三-3：同桌內用加點併單（顧客憑核銷碼或櫃檯人員均可觸發，由後端強制查表驗算新加點品項單價）
function handleAppendOrderItems(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const orderId = String(params.orderId || '').trim();
  const located = locateOrderRowById(orderSheet, orderId);
  if (!located) throw new Error('找不到欲加點的原訂單: ' + orderId);

  const rowVals = located.rowValues;
  const orderStoreId = String(rowVals[2] || '').trim();
  const curOrderObj = rowArrayToOrderObject(rowVals);
  const curStatus = String(curOrderObj.status || '');
  if (curStatus === '已完成' || curStatus.indexOf('已取消') >= 0) {
    throw new Error('原訂單已完成或取消，無法併單加點，請重新下單');
  }

  const isMerchantAuth = isMerchantRequestValid(params, orderStoreId);
  if (!isMerchantAuth) {
    const providedCode = String(params.verificationCode || '').trim().toUpperCase();
    const expectedCode = String(curOrderObj.verificationCode || '').trim().toUpperCase();
    if (!providedCode || providedCode !== expectedCode) {
      throw new Error('核銷碼驗證失敗，無法併入此筆桌單');
    }
  }

  const appendItemsRaw = Array.isArray(params.items) ? params.items : [];
  if (appendItemsRaw.length === 0) throw new Error('請至少選擇 1 項加點餐點');

  const cachedSM = getCachedStoresAndMenus(ss);
  const storeMenus = (cachedSM.menus || []).filter(m => String(m.storeId) === orderStoreId);
  const menuById = {};
  const menuByName = {};
  storeMenus.forEach(m => {
    const parsed = parseMenuRowOptionsAndSoldOut(m);
    const entry = {
      id: String(m.id),
      name: String(m.name).trim(),
      price: Number(m.price) || 0,
      soldOut: parsed.isSoldOut,
      options: parsed.parsedOptions || {}
    };
    menuById[entry.id] = entry;
    menuByName[entry.name] = entry;
  });

  let existingItems = [];
  try { existingItems = JSON.parse(rowVals[6] || '[]'); } catch (e) { existingItems = []; }
  if (!Array.isArray(existingItems)) existingItems = [];

  let meta = {};
  try { meta = JSON.parse(rowVals[16] || '{}'); } catch (e) {}
  // 加點併單前封存原 6 碼防偽核銷碼，確保原桌單 QR 憑證持續有效
  if (!meta.sealedVerificationCode) {
    meta.sealedVerificationCode = generateOrderVerificationCodeOnServer(rowVals[0], rowVals[1], Number(rowVals[9]) || 0);
  }

  let addedSubtotal = 0;
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH:mm:ss');
  const verifiedAddOns = appendItemsRaw.map(it => {
    const qty = Math.max(1, Math.min(30, parseInt(it.qty, 10) || 1));
    const lookup = (it.menuId && menuById[String(it.menuId)]) || menuByName[String(it.name || '').trim()];
    if (!lookup) throw new Error(`加點品項「${it.name || ''}」不存在於菜單中`);
    if (lookup.soldOut) throw new Error(`加點品項「${lookup.name}」目前已售罄`);

    let extraDelta = 0;
    const rawMods = Array.isArray(it.modifiers) ? it.modifiers : [];
    const safeMods = [];
    const optDefs = lookup.options || {};
    const validChoiceMap = {};
    Object.keys(optDefs).forEach(gKey => {
      const grp = optDefs[gKey];
      if (!grp || !Array.isArray(grp.choices)) return;
      grp.choices.forEach(ch => {
        const cLbl = Array.isArray(ch) ? String(ch[0] || '').trim() : String((ch && (ch.label || ch.name)) || ch || '').trim();
        const cDelta = Array.isArray(ch) ? Math.max(0, Number(ch[1]) || 0) : Math.max(0, Number((ch && (ch.priceDelta !== undefined ? ch.priceDelta : ch.price)) || 0) || 0);
        if (cLbl) validChoiceMap[cLbl] = cDelta;
        const subArr = Array.isArray(ch) ? (Array.isArray(ch[3]) ? ch[3] : []) : (ch && Array.isArray(ch.subOptions) ? ch.subOptions : []);
        subArr.forEach(sub => {
          if (sub && Array.isArray(sub.choices)) {
            sub.choices.forEach(sch => {
              const sLbl = Array.isArray(sch) ? String(sch[0] || '').trim() : String((sch && (sch.label || sch.name)) || sch || '').trim();
              const sDelta = Array.isArray(sch) ? Math.max(0, Number(sch[1]) || 0) : Math.max(0, Number((sch && (sch.priceDelta !== undefined ? sch.priceDelta : sch.price)) || 0) || 0);
              if (sLbl) validChoiceMap[sLbl] = sDelta;
            });
          }
        });
      });
    });
    rawMods.forEach(mod => {
      const modStr = String(mod || '').trim();
      if (!modStr) return;
      const qtyMatch = modStr.match(/^(.+?)\s*[×x]\s*(\d+)$/i);
      const baseLbl = qtyMatch ? qtyMatch[1].trim() : modStr;
      const mult = qtyMatch ? Math.max(1, Math.min(10, parseInt(qtyMatch[2], 10) || 1)) : 1;
      if (validChoiceMap[baseLbl] !== undefined) {
        extraDelta += validChoiceMap[baseLbl] * mult;
        safeMods.push(mult > 1 ? `${baseLbl} ×${mult}` : baseLbl);
      }
    });

    const unitPrice = lookup.price + extraDelta;
    addedSubtotal += unitPrice * qty;
    return {
      menuId: lookup.id,
      name: lookup.name,
      qty: qty,
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
  const oldSubtotal = Math.max(0, Number(rowVals[7]) || 0);
  const oldFinalTotal = Math.max(0, Number(rowVals[9]) || 0);
  const newSubtotal = oldSubtotal + addedSubtotal;
  const newFinalTotal = oldFinalTotal + addedSubtotal;

  rowVals[6] = JSON.stringify(combinedItems);
  rowVals[7] = newSubtotal;
  rowVals[9] = newFinalTotal;
  // 若原本已經叫號可取餐，併入加點後自動回到「製作中」提醒廚房出新菜
  if (String(rowVals[13] || '') === '可取餐') {
    rowVals[13] = '製作中';
  }
  if (String(meta.paymentStatus || '') === '已付款') {
    meta.paymentStatus = '尚有加點待補款';
    meta.pendingAddOnAmount = Math.max(0, Number(meta.pendingAddOnAmount) || 0) + addedSubtotal;
  }
  if (params.tableNumber && !meta.tableNumber) {
    meta.tableNumber = String(params.tableNumber).trim().slice(0, 20);
  }
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({
    ts: Date.now(),
    timeStr: nowStr,
    status: String(rowVals[13] || '製作中'),
    label: `同桌加點併單 (+${verifiedAddOns.length} 品項，+$${addedSubtotal}，累計 $${newFinalTotal})`
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);
  rowVals[16] = JSON.stringify(meta);

  orderSheet.getRange(located.sheetRowIndex, 1, 1, 17).setValues([rowVals]);
  const updatedOrderObj = rowArrayToOrderObject(rowVals);
  const recentOrders = readSheetTailObjects(orderSheet, 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);
  invalidateStoresMenusCache();

  return { updated: true, addedSubtotal: addedSubtotal, order: sanitizeOrderForClientOutput(updatedOrderObj, isMerchantAuth, true) };
}

// #37 店家櫃檯傳送即時留言通知給顧客（顯示於顧客取餐憑證頁並觸發推播）
function handleAddMerchantOrderNote(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const orderId = String(params.orderId || '').trim();
  const noteMsg = String(params.message || '').trim().slice(0, 200);
  if (!noteMsg) throw new Error('請輸入要通知顧客的櫃檯留言內容');

  const located = locateOrderRowById(orderSheet, orderId);
  if (!located) throw new Error('找不到該筆訂單: ' + orderId);

  const rowVals = located.rowValues;
  const orderStoreId = String(rowVals[2] || '').trim();
  assertMerchantAuthorized(params, orderStoreId);

  let meta = {};
  try { meta = JSON.parse(rowVals[16] || '{}'); } catch (e) {}
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH:mm:ss');

  meta.merchantMessage = noteMsg;
  meta.merchantMessageAt = nowStr;
  if (!Array.isArray(meta.merchantMessages)) meta.merchantMessages = [];
  meta.merchantMessages.push({ ts: Date.now(), timeStr: nowStr, text: noteMsg });
  meta.merchantMessages = meta.merchantMessages.slice(-10);

  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({
    ts: Date.now(),
    timeStr: nowStr,
    status: String(rowVals[13] || '製作中'),
    label: `店家櫃檯留言：${noteMsg}`
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);

  rowVals[16] = JSON.stringify(meta);
  orderSheet.getRange(located.sheetRowIndex, 1, 1, 17).setValues([rowVals]);
  const updatedOrderObj = rowArrayToOrderObject(rowVals);

  dispatchOrderNotificationOnServer(
    ss,
    updatedOrderObj,
    `💬 店家櫃檯留言通知 (#${updatedOrderObj.pickupNumber})`,
    `【${updatedOrderObj.storeName}】櫃檯留言：「${noteMsg}」`,
    '店家櫃檯通知'
  );

  return { updated: true, order: updatedOrderObj };
}

// #12 & 一-5 多班別開班點鈔登記雲端持久化（寫入專屬 ShiftReports 工作表）
function normalizeShiftSlotCode(rawSlot) {
  const s = String(rawSlot || 'FULL').trim().toUpperCase();
  if (s === 'MORNING' || s === 'AM' || s === '早班') return 'MORNING';
  if (s === 'EVENING' || s === 'PM' || s === '晚班') return 'EVENING';
  return 'FULL';
}

function upsertShiftReportRowOnServer(ss, storeId, shiftDate, shiftSlot, patch) {
  const shiftSheet = ensureSheetByNameWithHeaders(
    ss,
    'ShiftReports',
    ['shiftKey', 'storeId', 'dateStr', 'shiftSlot', 'status', 'cashierName', 'openingFloat', 'expectedCash', 'actualCountedCash', 'variance', 'pettyCashJson', 'summaryJson', 'updatedAt']
  );
  const slot = normalizeShiftSlotCode(shiftSlot);
  const shiftKey = `${storeId}__${shiftDate}__${slot}`;
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  const lastRow = shiftSheet.getLastRow();
  let foundRowIdx = -1;
  let curRow = [shiftKey, storeId, shiftDate, slot, 'OPEN', '', 0, 0, 0, 0, '[]', '{}', nowStr];

  if (lastRow > 1) {
    const vals = shiftSheet.getRange(2, 1, lastRow - 1, 13).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][0] || '').trim() === shiftKey) {
        foundRowIdx = i + 2;
        curRow = vals[i].slice(0, 13);
        break;
      }
    }
  }

  let summaryObj = {};
  try { summaryObj = JSON.parse(curRow[11] || '{}'); } catch (e) { summaryObj = {}; }
  if (patch.summaryPatch && typeof patch.summaryPatch === 'object') {
    summaryObj = { ...summaryObj, ...patch.summaryPatch };
  }

  const nextRow = [
    shiftKey,
    storeId,
    shiftDate,
    slot,
    patch.status !== undefined ? String(patch.status) : String(curRow[4] || 'OPEN'),
    patch.cashierName !== undefined ? String(patch.cashierName) : String(curRow[5] || ''),
    patch.openingFloat !== undefined ? Math.max(0, Number(patch.openingFloat) || 0) : (Number(curRow[6]) || 0),
    patch.expectedCash !== undefined ? Number(patch.expectedCash) || 0 : (Number(curRow[7]) || 0),
    patch.actualCountedCash !== undefined ? Number(patch.actualCountedCash) || 0 : (Number(curRow[8]) || 0),
    patch.variance !== undefined ? Number(patch.variance) || 0 : (Number(curRow[9]) || 0),
    patch.pettyCashJson !== undefined ? String(patch.pettyCashJson) : String(curRow[10] || '[]'),
    JSON.stringify(summaryObj),
    nowStr
  ];

  if (foundRowIdx > 0) {
    shiftSheet.getRange(foundRowIdx, 1, 1, 13).setValues([nextRow]);
  } else {
    shiftSheet.appendRow(nextRow);
  }
  return { shiftKey, slot, nowStr, summaryObj };
}

function handleOpenShiftRecord(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const shiftDate = normalizeSheetDateStr(params.shiftDate || getTodayTaipeiStr());
  const shiftSlot = normalizeShiftSlotCode(params.shiftSlot);
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  const sess = assertMerchantAuthorized(params, storeId);

  const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  const record = {
    openedAt: nowStr,
    cashier: String(params.cashier || sess.staffName || '值班人員'),
    openingFloat: Math.max(0, Number(params.openingFloat) || 0),
    shiftSlot: shiftSlot
  };
  upsertShiftReportRowOnServer(ss, storeId, shiftDate, shiftSlot, {
    status: 'OPEN',
    cashierName: record.cashier,
    openingFloat: record.openingFloat,
    summaryPatch: { openedAt: nowStr, shiftSlot: shiftSlot }
  });

  handleSaveMerchantAuditLog(ss, {
    ...params,
    actionTitle: '完成開班點鈔登記',
    detail: `營業日 ${shiftDate} [${shiftSlot}]・值班人員：${record.cashier}，開班錢箱找零準備金 NT$${record.openingFloat}`
  });

  return { opened: true, storeId: storeId, shiftDate: shiftDate, shiftSlot: shiftSlot, compositeKey: `${shiftDate}_${shiftSlot}`, record: record };
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
  let approverLabel = '';

  if (!isMerchantAuth) {
    // 一-2：允許學生憑本人 6 碼防偽核銷碼 (verificationCode) 在尚未進入廚房製作前自助取消預約單/未付款單
    const providedCode = String(params.verificationCode || '').trim().toUpperCase();
    const expectedCode = String(curOrderObj.verificationCode || '').trim().toUpperCase();
    if (!providedCode || providedCode !== expectedCode) {
      throw new Error('核銷碼驗證失敗，請確認 6 碼取餐核銷碼後再試');
    }
    const canSelfCancel = (
      curStatus === '已接單待排程' ||
      curStatus === '待付款確認' ||
      (curStatus === '製作中' && curOrderObj.paymentStatus !== '已付款' && curOrderObj.isReservation)
    );
    if (!canSelfCancel) {
      throw new Error('訂單已進入廚房備餐或完成階段，無法由線上自助取消，請洽詢店家櫃檯處理。');
    }
  } else {
    // 二-1：店家櫃檯執行退單 / 退款屬高風險帳務操作，若目前登入者為一般收銀員 (STAFF)，須店長 PIN 現場覆核授權
    const mgrAuth = assertManagerAuthorized(params, orderStoreId, '櫃檯退單與退款');
    approverLabel = mgrAuth.approvedBy || mgrAuth.staffName || '';
  }

  const reason = String(params.reason || (isMerchantAuth ? '櫃檯取消' : '顧客自助取消預約')).trim();
  let meta = {};
  try { meta = JSON.parse(rowVals[16] || '{}'); } catch (e) {}

  const origPayMethod = String(rowVals[12] || '現金').trim();
  const wasOriginallyPaid = String(meta.paymentStatus || '') === '已付款';

  rowVals[13] = `已取消 (${reason})`;
  if (wasOriginallyPaid || params.wasPaidRefund || Number(params.refundAmount) > 0) {
    const isLinePayOrder = origPayMethod === 'LINE Pay';
    // #10：明確區分線上 LINE Pay 退刷狀態與現場現金退款；若本店有設定 LINE Pay 商家金鑰且為真實交易單號，主動呼叫 LINE Pay v3 Refund API
    const refundAmt = Math.max(0, Number(params.refundAmount) || Number(rowVals[9]) || 0);
    let gatewayRefundNote = '';
    if (isLinePayOrder && meta.transactionId && /^\d{10,24}$/.test(String(meta.transactionId).trim())) {
      try {
        const lpCfg = resolveStoreLinePayConfig(orderStoreId);
        if (lpCfg.hasMerchantCredentials) {
          const baseUrl = lpCfg.isSandbox ? 'https://sandbox-api-pay.line.me' : 'https://api-pay.line.me';
          const reqUri = `/v3/payments/${String(meta.transactionId).trim()}/refund`;
          const bodyStr = JSON.stringify({ refundAmount: refundAmt });
          const nonce = Utilities.getUuid();
          const sigBytes = Utilities.computeHmacSha256Signature(lpCfg.channelSecret + reqUri + bodyStr + nonce, lpCfg.channelSecret);
          const sigB64 = Utilities.base64Encode(sigBytes);
          const refRes = UrlFetchApp.fetch(baseUrl + reqUri, {
            method: 'post',
            contentType: 'application/json',
            headers: {
              'X-LINE-ChannelId': lpCfg.channelId,
              'X-LINE-Authorization-Nonce': nonce,
              'X-LINE-Authorization': sigB64
            },
            payload: bodyStr,
            muteHttpExceptions: true
          });
          const refJson = JSON.parse(refRes.getContentText() || '{}');
          gatewayRefundNote = refJson.returnCode ? `API:${refJson.returnCode}` : '';
          meta.refundGatewayCode = String(refJson.returnCode || '');
          meta.refundGatewayMessage = String(refJson.returnMessage || '');
        }
      } catch (e) {
        meta.refundGatewayMessage = String(e.message || e);
      }
    }
    meta.paymentStatus = isLinePayOrder ? '已退款 (LINE Pay退刷)' : '已退款 (櫃檯退現)';
    meta.refundAmount = refundAmt;
    meta.refundMethod = isLinePayOrder ? (`LINE Pay 原路退刷${gatewayRefundNote ? ' ' + gatewayRefundNote : ''}`) : String(params.refundMethod || origPayMethod || '現金').trim();
    meta.refundTransactionId = isLinePayOrder
      ? ('REF-' + (meta.transactionId || Utilities.getUuid().slice(0, 8).toUpperCase()))
      : ('CASH-REF-' + Date.now());
    meta.refundedAtDate = getTodayTaipeiStr();
  } else {
    meta.paymentStatus = '已退單作廢';
  }
  if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
  meta.statusTimeline.push({
    ts: Date.now(),
    timeStr: Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH:mm:ss'),
    status: rowVals[13],
    label: `訂單已取消作廢 (${reason})`
  });
  meta.statusTimeline = meta.statusTimeline.slice(-25);
  rowVals[16] = JSON.stringify(meta);

  orderSheet.getRange(located.sheetRowIndex, 1, 1, 17).setValues([rowVals]);

  const cancelledOrderObj = rowArrayToOrderObject(rowVals);
  const recentOrders = readSheetTailObjects(orderSheet, 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);
  // 一-3：退單完成後立即清除菜單與公開快取，讓當日限量餘額即時釋放回補！
  invalidateStoresMenusCache();

  if (isMerchantAuth) {
    try {
      handleSaveMerchantAuditLog(ss, {
        ...params,
        storeId: orderStoreId,
        approvedBy: approverLabel,
        actionTitle: '櫃檯退單作廢',
        detail: `單號 #${cancelledOrderObj.pickupNumber} (${orderId})・原因：${reason}・退款狀態：${meta.paymentStatus}`
      });
    } catch (e) {}
  }

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
  const isSensitiveConfigChange = (
    params.cutleryPrice !== undefined ||
    params.promoMode !== undefined ||
    params.promoDiscount !== undefined ||
    params.promoMinSubtotal !== undefined ||
    params.promoScope !== undefined ||
    params.secondItemDiscount !== undefined ||
    params.coupons !== undefined ||
    params.allowDineInPostPay !== undefined ||
    params.maxCapacityPer15Min !== undefined ||
    params.basePrepMinutes !== undefined
  );
  if (isSensitiveConfigChange) {
    assertManagerAuthorized(params, storeId, '修改店家優惠、費率與營運設定');
  } else {
    assertMerchantAuthorized(params, storeId);
  }

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

  if (
    params.reserveLeadMinutes !== undefined ||
    params.promoMinSubtotal !== undefined ||
    params.promoScope !== undefined ||
    params.giftMenuItemId !== undefined ||
    params.secondItemDiscount !== undefined ||
    params.coupons !== undefined ||
    params.allowDineInPostPay !== undefined
  ) {
    let customMetaMap = {};
    try { customMetaMap = JSON.parse(props.getProperty('STORE_CUSTOM_META') || '{}'); } catch (e) {}
    const curMeta = customMetaMap[storeId] || {};
    const nextMeta = { ...curMeta };
    if (params.reserveLeadMinutes !== undefined) {
      nextMeta.reserveLeadMinutes = Math.max(10, Math.min(90, Number(params.reserveLeadMinutes) || 25));
    }
    if (params.promoMinSubtotal !== undefined) {
      nextMeta.promoMinSubtotal = Math.max(0, Number(params.promoMinSubtotal) || 0);
    }
    if (params.promoScope !== undefined) {
      nextMeta.promoScope = String(params.promoScope) === 'ALL_DAY' ? 'ALL_DAY' : 'OFF_PEAK';
    }
    if (params.giftMenuItemId !== undefined) {
      nextMeta.giftMenuItemId = String(params.giftMenuItemId || '').trim();
    }
    if (params.secondItemDiscount !== undefined) {
      nextMeta.secondItemDiscount = Math.max(0, Number(params.secondItemDiscount) || 0);
    }
    if (Array.isArray(params.coupons)) {
      nextMeta.coupons = params.coupons
        .filter(c => c && String(c.code || '').trim())
        .slice(0, 30)
        .map(c => ({
          code: String(c.code || '').trim().toUpperCase().slice(0, 24),
          type: String(c.type || 'AMOUNT').toUpperCase() === 'PERCENT' ? 'PERCENT' : 'AMOUNT',
          value: Math.max(1, Number(c.value) || 0),
          minSubtotal: Math.max(0, Number(c.minSubtotal) || 0),
          active: c.active !== false
        }));
    }
    if (params.allowDineInPostPay !== undefined) {
      nextMeta.allowDineInPostPay = Boolean(params.allowDineInPostPay);
    }
    customMetaMap[storeId] = nextMeta;
    props.setProperty('STORE_CUSTOM_META', JSON.stringify(customMetaMap));
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
  invalidateStoresMenusCache();

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

      let cleanOpts = (m.options && typeof m.options === 'object' && !Array.isArray(m.options)) ? { ...m.options } : {};
      if (cleanOpts['__soldOut'] !== undefined) delete cleanOpts['__soldOut'];
      const dailyLimitVal = Math.max(0, parseInt(m.dailyLimit || 0, 10) || 0);
      if (dailyLimitVal > 0) cleanOpts['__dailyLimit'] = dailyLimitVal;
      else delete cleanOpts['__dailyLimit'];
      const nameEnVal = String(m.nameEn || '').trim().slice(0, 80);
      if (nameEnVal) cleanOpts['__nameEn'] = nameEnVal;
      else delete cleanOpts['__nameEn'];
      const stationVal = String(m.station || 'AUTO').trim().toUpperCase();
      if (stationVal && stationVal !== 'AUTO') cleanOpts['__station'] = stationVal;
      else delete cleanOpts['__station'];
      const tileColorVal = String(m.tileColor || '').trim().slice(0, 20);
      if (tileColorVal) cleanOpts['__tileColor'] = tileColorVal;
      else delete cleanOpts['__tileColor'];
      const sortOrderVal = m.sortOrder !== undefined && m.sortOrder !== '' ? Number(m.sortOrder) : NaN;
      if (Number.isFinite(sortOrderVal)) cleanOpts['__sortOrder'] = sortOrderVal;
      else delete cleanOpts['__sortOrder'];

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
  invalidateStoresMenusCache();

  return {
    saved: true,
    storeId: storeId,
    menuCount: newStoreRows.length
  };
}

/**
 * 【單一菜單品項原子更新 B12】避免多台平板同時修改價格或切換售罄時整份菜單互相覆蓋
 */
function toggleSingleMenuSoldOutOnServer(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const menuId = String(params.menuId || '').trim();
  if (!storeId || !menuId) throw new Error('缺少店家編號或品項 ID');
  assertMerchantAuthorized(params, storeId);

  const menuSheet = ss.getSheetByName('Menus');
  const lastRow = menuSheet.getLastRow();
  if (lastRow <= 1) throw new Error('Menus 資料表為空');

  const rows = menuSheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === storeId && String(rows[i][0]).trim() === menuId) {
      const nextSoldOut = Boolean(params.soldOut);
      menuSheet.getRange(i + 2, 9).setValue(nextSoldOut);
      invalidateStoresMenusCache();
      return { updated: true, storeId: storeId, menuId: menuId, soldOut: nextSoldOut };
    }
  }
  throw new Error('找不到該菜單品項: ' + menuId);
}

function upsertSingleMenuItemOnServer(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const item = params.item || {};
  const cleanName = String(item.name || '').trim();
  if (!storeId || !cleanName) throw new Error('缺少店家編號或餐點名稱');
  assertMerchantAuthorized(params, storeId);

  const menuId = String(item.id || generateStableMenuItemIdOnServer(storeId, cleanName)).trim();
  let cleanOpts = (item.options && typeof item.options === 'object' && !Array.isArray(item.options)) ? { ...item.options } : {};
  if (cleanOpts['__soldOut'] !== undefined) delete cleanOpts['__soldOut'];
  const dailyLimitVal = Math.max(0, parseInt(item.dailyLimit || 0, 10) || 0);
  if (dailyLimitVal > 0) cleanOpts['__dailyLimit'] = dailyLimitVal;
  else delete cleanOpts['__dailyLimit'];
  const nameEnVal = String(item.nameEn || '').trim().slice(0, 80);
  if (nameEnVal) cleanOpts['__nameEn'] = nameEnVal;
  else delete cleanOpts['__nameEn'];
  const stationVal = String(item.station || 'AUTO').trim().toUpperCase();
  if (stationVal && stationVal !== 'AUTO') cleanOpts['__station'] = stationVal;
  else delete cleanOpts['__station'];
  const tileColorVal = String(item.tileColor || '').trim().slice(0, 20);
  if (tileColorVal) cleanOpts['__tileColor'] = tileColorVal;
  else delete cleanOpts['__tileColor'];
  const sortOrderVal = item.sortOrder !== undefined && item.sortOrder !== '' ? Number(item.sortOrder) : NaN;
  if (Number.isFinite(sortOrderVal)) cleanOpts['__sortOrder'] = sortOrderVal;
  else delete cleanOpts['__sortOrder'];

  const rowValues = [
    menuId,
    storeId,
    cleanName,
    Math.max(0, Number(item.price) || 0),
    String(item.tag || '').trim(),
    String(item.category || '招牌主餐').trim(),
    String(item.image || '').trim(),
    JSON.stringify(cleanOpts),
    Boolean(item.soldOut)
  ];

  const menuSheet = ss.getSheetByName('Menus');
  const lastRow = menuSheet.getLastRow();
  if (lastRow > 1) {
    const rows = menuSheet.getRange(2, 1, lastRow - 1, 9).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][1]).trim() === storeId && (String(rows[i][0]).trim() === menuId || String(rows[i][2]).trim() === cleanName)) {
        rowValues[0] = String(rows[i][0]).trim() || menuId;
        menuSheet.getRange(i + 2, 1, 1, 9).setValues([rowValues]);
        invalidateStoresMenusCache();
        return { updated: true, storeId: storeId, menuId: rowValues[0] };
      }
    }
  }
  menuSheet.appendRow(rowValues);
  invalidateStoresMenusCache();
  return { updated: true, storeId: storeId, menuId: menuId };
}

function deleteSingleMenuItemOnServer(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const menuId = String(params.menuId || '').trim();
  if (!storeId || !menuId) throw new Error('缺少店家編號或品項 ID');
  assertMerchantAuthorized(params, storeId);

  const menuSheet = ss.getSheetByName('Menus');
  const lastRow = menuSheet.getLastRow();
  if (lastRow <= 1) return { deleted: false };

  const rows = menuSheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1]).trim() === storeId && String(rows[i][0]).trim() === menuId) {
      menuSheet.deleteRow(i + 2);
      invalidateStoresMenusCache();
      return { deleted: true, storeId: storeId, menuId: menuId };
    }
  }
  return { deleted: false, storeId: storeId, menuId: menuId };
}

/**
 * 【動態餐廳與校區管理 A6】支援修改餐廳名稱、分類、校區、圖示、營業時間，以及新增與刪除餐廳
 */
function saveStoreProfileOnServer(ss, params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  assertMerchantAuthorized(params, storeId);

  const storeSheet = ss.getSheetByName('Stores');
  const range = storeSheet.getDataRange();
  const rows = range.getValues();
  let found = false;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === storeId) {
      if (params.campus !== undefined && String(params.campus).trim()) {
        rows[i][1] = String(params.campus).trim();
      }
      if (params.name !== undefined && String(params.name).trim()) {
        rows[i][2] = String(params.name).trim();
      }
      if (params.category !== undefined && String(params.category).trim()) {
        rows[i][3] = String(params.category).trim();
      }
      storeSheet.getRange(i + 1, 1, 1, rows[i].length).setValues([rows[i]]);
      found = true;
      break;
    }
  }
  if (!found) throw new Error('找不到店家: ' + storeId);

  const props = PropertiesService.getScriptProperties();
  let customMetaMap = {};
  try { customMetaMap = JSON.parse(props.getProperty('STORE_CUSTOM_META') || '{}'); } catch (e) {}
  customMetaMap[storeId] = {
    ...(customMetaMap[storeId] || {}),
    icon: params.icon !== undefined ? String(params.icon).trim() : (customMetaMap[storeId]?.icon || ''),
    openTime: params.openTime !== undefined ? String(params.openTime).trim() : (customMetaMap[storeId]?.openTime || '10:30'),
    closeTime: params.closeTime !== undefined ? String(params.closeTime).trim() : (customMetaMap[storeId]?.closeTime || '19:30'),
    breakStartTime: params.breakStartTime !== undefined ? String(params.breakStartTime).trim() : (customMetaMap[storeId]?.breakStartTime || ''),
    breakEndTime: params.breakEndTime !== undefined ? String(params.breakEndTime).trim() : (customMetaMap[storeId]?.breakEndTime || ''),
    closedDays: Array.isArray(params.closedDays) ? params.closedDays.map(Number) : (customMetaMap[storeId]?.closedDays || []),
    reserveLeadMinutes: params.reserveLeadMinutes !== undefined
      ? Math.max(10, Math.min(90, Number(params.reserveLeadMinutes) || 25))
      : (customMetaMap[storeId]?.reserveLeadMinutes || 25)
  };
  props.setProperty('STORE_CUSTOM_META', JSON.stringify(customMetaMap));
  invalidateStoresMenusCache();

  return { updated: true, storeId: storeId };
}

function createNewStoreOnServer(ss, params) {
  const name = String(params.name || '').trim();
  const campus = String(params.campus || '雙溪校區').trim();
  const category = String(params.category || '人氣特餐・便當').trim();
  const icon = String(params.icon || '🍱').trim();
  const newStorePin = String(params.newStorePin || '').trim();
  if (!name) throw new Error('請輸入新餐廳名稱');
  // #7：建立新店家時強制要求設定該店獨立的 4~8 碼 PIN 授權碼
  if (!/^\d{4,8}$/.test(newStorePin)) {
    throw new Error('建立新餐廳時請設定該店專屬的 4 至 8 位數字管理密碼 (PIN)');
  }

  const storeSheet = ss.getSheetByName('Stores');
  const rows = storeSheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < rows.length; i++) {
    const m = String(rows[i][0] || '').match(/^S(\d+)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const nextId = 'S' + String(maxNum + 1).padStart(2, '0');
  const newStoreRow = [
    nextId, campus, name, category, 20, 0, 4, true, 'none', '無優惠', 0, 120, 4.8, 1, 4
  ];
  storeSheet.appendRow(newStoreRow);

  const props = PropertiesService.getScriptProperties();
  // #7：立即為新餐廳寫入獨立 PIN HMAC 雜湊，拒絕無主密碼新店
  props.setProperty('MERCHANT_PIN_HMAC_STORE_' + nextId, hashMerchantPinWithServerSalt(newStorePin));

  let customMetaMap = {};
  try { customMetaMap = JSON.parse(props.getProperty('STORE_CUSTOM_META') || '{}'); } catch (e) {}
  customMetaMap[nextId] = {
    icon: icon,
    openTime: String(params.openTime || '10:30').trim(),
    closeTime: String(params.closeTime || '19:30').trim()
  };
  props.setProperty('STORE_CUSTOM_META', JSON.stringify(customMetaMap));

  let deletedMap = {};
  try { deletedMap = JSON.parse(props.getProperty('DELETED_STORE_IDS') || '{}'); } catch (e) {}
  if (deletedMap[nextId]) {
    delete deletedMap[nextId];
    props.setProperty('DELETED_STORE_IDS', JSON.stringify(deletedMap));
  }

  const newStoreToken = issueMerchantSessionToken(nextId);
  invalidateStoresMenusCache();

  return {
    created: true,
    sessionToken: newStoreToken.sessionToken,
    expiresAt: newStoreToken.expiresAt,
    authorizedStoreId: newStoreToken.authorizedStoreId,
    store: {
      id: nextId,
      campus: campus,
      name: name,
      category: category,
      icon: icon,
      openTime: customMetaMap[nextId].openTime,
      closeTime: customMetaMap[nextId].closeTime,
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

function deleteStoreOnServer(ss, params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號');
  assertMerchantAuthorized(params, storeId);

  const storeSheet = ss.getSheetByName('Stores');
  const lastRow = storeSheet.getLastRow();
  if (lastRow > 1) {
    const rows = storeSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][0]).trim() === storeId) {
        storeSheet.deleteRow(i + 2);
      }
    }
  }

  const props = PropertiesService.getScriptProperties();
  let deletedMap = {};
  try { deletedMap = JSON.parse(props.getProperty('DELETED_STORE_IDS') || '{}'); } catch (e) {}
  deletedMap[storeId] = Date.now();
  props.setProperty('DELETED_STORE_IDS', JSON.stringify(deletedMap));
  invalidateStoresMenusCache();

  return { deleted: true, storeId: storeId };
}

// ==================== 一-5 & #13 & #45 店務敏感操作稽核紀錄、多班別交班日結關班鎖定與零用金（獨立 Sheet 持久化） ====================
function handleSaveMerchantAuditLog(ss, params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  const sess = assertMerchantAuthorized(params, storeId);

  const auditSheet = ensureSheetByNameWithHeaders(
    ss,
    'AuditLogs',
    ['logId', 'ts', 'dateStr', 'storeId', 'staffName', 'staffRole', 'approvedBy', 'action', 'detail']
  );

  const nowTs = String(params.ts || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'));
  const dateStr = nowTs.slice(0, 10);
  const logId = 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 900 + 100);
  const staffName = String(params.staffName || sess.staffName || '值班人員').trim().slice(0, 40);
  const staffRole = String(params.staffRole || sess.role || 'MANAGER').trim().toUpperCase();
  const approvedBy = String(params.approvedBy || '').trim().slice(0, 40);
  const actionTitle = String(params.actionTitle || params.logAction || '').trim().slice(0, 120);
  const detailText = String(params.detail || '').trim().slice(0, 600);

  auditSheet.appendRow([logId, nowTs, dateStr, storeId, staffName, staffRole, approvedBy, actionTitle, detailText]);
  return { saved: true, storeId: storeId, logId: logId };
}

function handleLockShiftZReport(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const shiftDate = normalizeSheetDateStr(params.shiftDate || getTodayTaipeiStr());
  const shiftSlot = normalizeShiftSlotCode(params.shiftSlot);
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  const sess = assertMerchantAuthorized(params, storeId);

  const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  const record = {
    locked: true,
    lockedAt: nowStr,
    shiftSlot: shiftSlot,
    cashier: String(params.cashier || sess.staffName || '值班店長'),
    openingFloat: Number(params.openingFloat) || 0,
    pettyCashInSum: Number(params.pettyCashInSum) || 0,
    pettyCashOutSum: Number(params.pettyCashOutSum) || 0,
    expectedDrawerCash: Number(params.expectedDrawerCash) || 0,
    actualCounted: Number(params.actualCounted) || 0,
    varianceAmt: Number(params.varianceAmt) || 0
  };
  upsertShiftReportRowOnServer(ss, storeId, shiftDate, shiftSlot, {
    status: 'LOCKED',
    cashierName: record.cashier,
    openingFloat: record.openingFloat,
    expectedCash: record.expectedDrawerCash,
    actualCountedCash: record.actualCounted,
    variance: record.varianceAmt,
    summaryPatch: record
  });

  handleSaveMerchantAuditLog(ss, {
    ...params,
    actionTitle: '完成交班日結關班(雲端鎖定)',
    detail: `營業日 ${shiftDate} [${shiftSlot}]・經手人：${record.cashier}，應有錢箱現金 $${record.expectedDrawerCash}，實點 $${record.actualCounted}，差額 $${record.varianceAmt}`
  });

  return { locked: true, storeId: storeId, shiftDate: shiftDate, shiftSlot: shiftSlot, compositeKey: `${shiftDate}_${shiftSlot}`, record: record };
}

function handleUnlockShiftZReport(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const shiftDate = normalizeSheetDateStr(params.shiftDate || getTodayTaipeiStr());
  const shiftSlot = normalizeShiftSlotCode(params.shiftSlot);
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  const mgrAuth = assertManagerAuthorized(params, storeId, '解除交班日結鎖定');

  upsertShiftReportRowOnServer(ss, storeId, shiftDate, shiftSlot, {
    status: 'UNLOCKED',
    summaryPatch: {
      locked: false,
      unlockedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
      unlockedBy: mgrAuth.approvedBy || mgrAuth.staffName || '店長',
      unlockReason: String(params.reason || '店長授權重開帳務')
    }
  });

  // 相容清除舊版 PropertiesService 鎖定殘留
  try {
    const props = PropertiesService.getScriptProperties();
    const lockPropKey = 'SHIFT_LOCKS_' + storeId;
    const locksMap = JSON.parse(props.getProperty(lockPropKey) || '{}');
    delete locksMap[shiftDate];
    delete locksMap[`${shiftDate}_${shiftSlot}`];
    props.setProperty(lockPropKey, JSON.stringify(locksMap));
  } catch (e) {}

  handleSaveMerchantAuditLog(ss, {
    ...params,
    approvedBy: mgrAuth.approvedBy || mgrAuth.staffName || '',
    actionTitle: '店長解除交班日結鎖定',
    detail: `營業日 ${shiftDate} [${shiftSlot}]・原因：${String(params.reason || '店長授權重開帳務')}`
  });

  return { unlocked: true, storeId: storeId, shiftDate: shiftDate, shiftSlot: shiftSlot, compositeKey: `${shiftDate}_${shiftSlot}` };
}

function handleSaveShiftPettyCash(ss, params) {
  const storeId = String(params.storeId || '').trim();
  const shiftDate = normalizeSheetDateStr(params.shiftDate || getTodayTaipeiStr());
  const shiftSlot = normalizeShiftSlotCode(params.shiftSlot);
  if (!storeId) throw new Error('缺少店家編號 (storeId)');
  assertMerchantAuthorized(params, storeId);

  const entries = Array.isArray(params.entries) ? params.entries.slice(0, 100) : [];
  upsertShiftReportRowOnServer(ss, storeId, shiftDate, shiftSlot, {
    pettyCashJson: JSON.stringify(entries)
  });

  return { saved: true, storeId: storeId, shiftDate: shiftDate, shiftSlot: shiftSlot, compositeKey: `${shiftDate}_${shiftSlot}`, entries: entries };
}

function runTrafficSimulation(ss, params) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SIM_QUEUE_OFFSETS', JSON.stringify({}));
  const recentOrders = readSheetTailObjects(ss.getSheetByName('Orders'), 150).map(enrichOrderObject);
  recomputeAllStoreQueuesInMemory(ss, recentOrders, true);

  return {
    simulated: false,
    mode: 'NORMAL'
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