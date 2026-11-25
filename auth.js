/**
 * MealFlow Cloudflare Workers — 資安驗證模組 (Web Crypto HMAC-SHA256)
 * 完整對齊 code.gs：
 * - 常數時間比對 (constantTimeEquals)
 * - 4~8 碼 PIN (DEVELOPER / 一人一碼 STAFF&MANAGER / 店鋪店長 PIN / 共用收銀員 PIN / 預設 8888)
 * - 8 小時時效 HMAC Session Token + 登出註銷 (kv_settings)
 * - 6 碼防偽核銷碼 + 各店獨立出單機金鑰 (printerKey)
 * - 店務稽核紀錄 (audit_logs)
 */

import { SESSION_TTL_MS, getTaipeiDateParts, safeJsonParse } from './utils.js';
import { deleteKvCacheEntry, getCachedKvMap, setKvCacheEntry } from './cache.js';

// ==================== KV Settings (D1 kv_settings 表 + 60 秒記憶體快取) ====================

export async function kvGet(db, key, options = {}) {
  const k = String(key);
  if (options && options.bypassCache) {
    const row = await db.prepare('SELECT value FROM kv_settings WHERE key = ?').bind(k).first();
    return row ? String(row.value) : null;
  }
  const kvMap = await getCachedKvMap(db);
  return kvMap.has(k) ? kvMap.get(k) : null;
}

export async function kvSet(db, key, value) {
  const k = String(key);
  const v = String(value);
  await db.prepare(`
    INSERT INTO kv_settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).bind(k, v).run();
  setKvCacheEntry(k, v);
}

export async function kvDelete(db, key) {
  const k = String(key);
  await db.prepare('DELETE FROM kv_settings WHERE key = ?').bind(k).run();
  deleteKvCacheEntry(k);
}

// ==================== Web Crypto HMAC-SHA256 & Constant-Time ====================

export async function computeHmacHex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(message || '')));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEquals(a, b) {
  const strA = String(a || '');
  const strB = String(b || '');
  if (strA.length !== strB.length || strA.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= (strA.charCodeAt(i) ^ strB.charCodeAt(i));
  }
  return diff === 0;
}

export async function getServerSecretKey(env) {
  const envSecret = String(env.HMAC_SECRET || '').trim();
  if (envSecret) return envSecret;

  let stored = await kvGet(env.DB, 'MEALFLOW_SERVER_HMAC_SECRET_V12');
  if (!stored) {
    stored = `${crypto.randomUUID()}_${crypto.randomUUID()}_${Date.now()}`;
    await kvSet(env.DB, 'MEALFLOW_SERVER_HMAC_SECRET_V12', stored);
  }
  return stored;
}

export async function hashMerchantPinWithServerSalt(env, rawPin) {
  const secret = await getServerSecretKey(env);
  return computeHmacHex('PIN_AUTH_V12:' + String(rawPin || '').trim(), secret);
}

// ==================== 6 碼防偽核銷碼 & 出單機金鑰 ====================

export async function generateOrderVerificationCodeOnServer(env, orderId, pickupNumber, finalTotal) {
  const secret = await getServerSecretKey(env);
  const sig = await computeHmacHex(`${orderId || ''}|${pickupNumber || ''}|${Number(finalTotal) || 0}`, secret);
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    const byteVal = parseInt(sig.slice(i * 2, i * 2 + 2), 16) || 0;
    code += alphabet[byteVal % alphabet.length];
  }
  return code;
}

export async function getOrCreateStorePrinterKey(env, storeId) {
  const cleanStore = String(storeId || '').trim().toUpperCase();
  if (!cleanStore) return '';
  const propKey = 'PRINTER_KEY_' + cleanStore;
  const existing = String((await kvGet(env.DB, propKey)) || '').trim();
  if (existing && existing.length >= 12) return existing;

  const secret = await getServerSecretKey(env);
  const hash = await computeHmacHex(`PRINTER_KEY_V26:${cleanStore}:${crypto.randomUUID()}`, secret);
  const generated = 'MFPR-' + hash.slice(0, 16).toUpperCase();
  await kvSet(env.DB, propKey, generated);
  return generated;
}

// ==================== PIN & 員工帳號查詢 ====================

async function getStoredMasterPinHash(env) {
  const defaultPin = String(env.DEFAULT_MERCHANT_PIN || '8888').trim();
  let savedHash = await kvGet(env.DB, 'MERCHANT_PIN_HMAC_V12');
  if (!savedHash) {
    savedHash = await hashMerchantPinWithServerSalt(env, defaultPin);
    await kvSet(env.DB, 'MERCHANT_PIN_HMAC_V12', savedHash);
  }
  return savedHash;
}

async function getStoredStorePinHash(env, storeId) {
  if (!storeId) return '';
  return (await kvGet(env.DB, 'MERCHANT_PIN_HMAC_STORE_' + String(storeId).trim())) || '';
}

export async function getStoredStoreStaffPinHash(env, storeId) {
  if (!storeId) return '';
  return (await kvGet(env.DB, 'MERCHANT_STAFF_PIN_HMAC_STORE_' + String(storeId).trim())) || '';
}

async function getStoredDeveloperPinHash(env) {
  const rawDevPin = String(env.DEVELOPER_PIN || '').trim();
  if (/^\d{4,8}$/.test(rawDevPin)) {
    return hashMerchantPinWithServerSalt(env, rawDevPin);
  }
  let savedHash = await kvGet(env.DB, 'DEVELOPER_PIN_HMAC_V25');
  if (!savedHash) {
    savedHash = await hashMerchantPinWithServerSalt(env, '999999');
    await kvSet(env.DB, 'DEVELOPER_PIN_HMAC_V25', savedHash);
  }
  return savedHash;
}

export async function verifyDeveloperPinRaw(env, rawPin) {
  const pin = String(rawPin || '').trim();
  if (!/^\d{4,8}$/.test(pin)) return false;
  const cand = await hashMerchantPinWithServerSalt(env, pin);
  const devHash = await getStoredDeveloperPinHash(env);
  return constantTimeEquals(cand, devHash);
}

export async function getStoreStaffAccounts(env, storeId) {
  if (!storeId) return [];
  const raw = await kvGet(env.DB, 'STORE_STAFF_ACCOUNTS_' + String(storeId).trim());
  const arr = safeJsonParse(raw, []);
  return Array.isArray(arr) ? arr.filter(a => a && a.id && a.name && a.pinHash) : [];
}

export async function getPublicStaffAccounts(env, storeId) {
  const accounts = await getStoreStaffAccounts(env, storeId);
  return accounts.map(a => ({
    id: String(a.id),
    name: String(a.name),
    role: a.role === 'MANAGER' ? 'MANAGER' : 'STAFF',
    active: a.active !== false,
    createdAt: String(a.createdAt || '')
  }));
}

export async function getStoreStaffList(env, storeId) {
  const accounts = (await getStoreStaffAccounts(env, storeId)).filter(a => a.active !== false);
  const accountNames = accounts.map(a => String(a.name));
  let legacyList = [];
  if (storeId) {
    const raw = await kvGet(env.DB, 'STORE_STAFF_LIST_' + String(storeId).trim());
    const arr = safeJsonParse(raw, []);
    if (Array.isArray(arr) && arr.length > 0) legacyList = arr;
  }
  const combined = Array.from(new Set([...accountNames, ...legacyList])).filter(Boolean);
  return combined.length > 0 ? combined : ['值班店長', '早班收銀員', '晚班收銀員'];
}

export async function verifyStoreManagerPinRaw(env, storeId, rawPin) {
  const pin = String(rawPin || '').trim();
  if (!/^\d{4,8}$/.test(pin)) return false;
  if (await verifyDeveloperPinRaw(env, pin)) return true;

  const candidateHash = await hashMerchantPinWithServerSalt(env, pin);
  const staffAccounts = await getStoreStaffAccounts(env, storeId);
  for (const acc of staffAccounts) {
    if (acc && acc.active !== false && acc.role === 'MANAGER' && constantTimeEquals(candidateHash, acc.pinHash)) {
      return true;
    }
  }
  const storeSpecificHash = await getStoredStorePinHash(env, storeId);
  const defaultInitialHash = await getStoredMasterPinHash(env);
  return storeSpecificHash
    ? constantTimeEquals(candidateHash, storeSpecificHash)
    : constantTimeEquals(candidateHash, defaultInitialHash);
}

// ==================== 稽核紀錄 (audit_logs 表) ====================

export async function appendSystemAuditEntry(db, storeId, staffName, staffRole, approvedBy, actionTitle, detailText) {
  try {
    if (!db || !storeId) return;
    const nowP = getTaipeiDateParts();
    const logId = 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 900 + 100);
    await db.prepare(`
      INSERT INTO audit_logs (log_id, ts, date_str, store_id, staff_name, staff_role, approved_by, action, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      logId,
      nowP.dateTimeStr,
      nowP.dateStr,
      String(storeId).trim(),
      String(staffName || '值班人員').trim().slice(0, 40),
      String(staffRole || 'MANAGER').trim().toUpperCase(),
      String(approvedBy || '').trim().slice(0, 40),
      String(actionTitle || '').trim().slice(0, 120),
      String(detailText || '').trim().slice(0, 600)
    ).run();
  } catch (e) {
    console.error('[AuditLog] insert failed:', e);
  }
}

// ==================== HMAC Session Token 簽發與驗證 ====================

export async function issueMerchantSessionToken(env, storeScope, staffRole, staffName) {
  const cleanRole = staffRole === 'DEVELOPER' ? 'DEVELOPER' : (staffRole === 'STAFF' ? 'STAFF' : 'MANAGER');
  const cleanScope = cleanRole === 'DEVELOPER'
    ? (String(storeScope || 'ALL').trim() || 'ALL')
    : (String(storeScope || 'S01').trim() || 'S01');
  const defaultName = cleanRole === 'DEVELOPER' ? '開發者' : (cleanRole === 'MANAGER' ? '店長' : '收銀員');
  const cleanName = encodeURIComponent(String(staffName || defaultName).trim().slice(0, 20));
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const payloadStr = `${expiresAt}_${nonce}_${cleanScope}_${cleanRole}_${cleanName}`;
  const secret = await getServerSecretKey(env);
  const sigHex = await computeHmacHex(payloadStr, secret);
  return {
    sessionToken: `${payloadStr}.${sigHex}`,
    expiresAt,
    authorizedStoreId: cleanScope,
    staffRole: cleanRole,
    staffName: decodeURIComponent(cleanName)
  };
}

export async function parseVerifiedMerchantSession(env, params) {
  if (!params) return null;
  const token = String(params.merchantAuthToken || '').trim();
  if (!token || !token.includes('.')) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadStr, providedSig] = parts;
  const secret = await getServerSecretKey(env);
  const expectedSig = await computeHmacHex(payloadStr, secret);
  if (!constantTimeEquals(providedSig, expectedSig)) return null;

  const payloadParts = payloadStr.split('_');
  const expiresAt = Number(payloadParts[0] || 0);
  const nonce = String(payloadParts[1] || '');
  const tokenScope = String(payloadParts[2] || '');
  const tokenRole = payloadParts[3] === 'DEVELOPER' ? 'DEVELOPER' : (payloadParts[3] === 'STAFF' ? 'STAFF' : 'MANAGER');
  let tokenStaffName = tokenRole === 'DEVELOPER' ? '開發者' : (tokenRole === 'MANAGER' ? '店長' : '收銀員');
  if (payloadParts.length >= 5) {
    try { tokenStaffName = decodeURIComponent(payloadParts.slice(4).join('_')) || tokenStaffName; } catch {}
  }
  if (!expiresAt || Date.now() > expiresAt || !tokenScope) return null;

  if (nonce) {
    const revoked = await kvGet(env.DB, 'REVOKED_SESSION_NONCE_' + nonce);
    if (revoked) return null;
  }

  return { expiresAt, nonce, storeScope: tokenScope, role: tokenRole, staffName: tokenStaffName };
}

export async function isMerchantRequestValid(env, params, requiredStoreId = '') {
  const session = await parseVerifiedMerchantSession(env, params);
  if (!session) return false;
  if (session.role === 'DEVELOPER') return true;
  const targetStore = String(requiredStoreId || '').trim();
  if (targetStore && session.storeScope !== targetStore) return false;
  return true;
}

export async function assertMerchantAuthorized(env, params, requiredStoreId = '') {
  const session = await parseVerifiedMerchantSession(env, params);
  if (!session) {
    throw new Error('店務管理權限驗證失敗或時效憑證已過期/已登出註銷 (Unauthorized)，請輸入該店專屬授權碼解鎖');
  }
  if (session.role === 'DEVELOPER') return session;
  const targetStore = String(requiredStoreId || '').trim();
  if (targetStore && session.storeScope !== targetStore) {
    throw new Error('跨店操作越權拒絕 (Unauthorized)，請輸入該店專屬授權碼解鎖');
  }
  return session;
}

export async function assertManagerAuthorized(env, params, requiredStoreId = '') {
  const session = await parseVerifiedMerchantSession(env, params);
  if (!session) {
    throw new Error('店務管理權限驗證失敗或時效憑證已過期 (Unauthorized)，請重新解鎖');
  }
  const targetStore = String(requiredStoreId || session.storeScope || '').trim();
  if (session.role === 'DEVELOPER') {
    return { session, approvedBy: session.staffName || '開發者' };
  }
  if (requiredStoreId && session.storeScope !== targetStore) {
    throw new Error('跨店操作越權拒絕，請先切換並驗證目標店鋪密碼');
  }
  if (session.role === 'MANAGER') {
    return { session, approvedBy: session.staffName || '店長' };
  }
  const overridePin = String(params.managerOverridePin || '').trim();
  if (overridePin && (await verifyStoreManagerPinRaw(env, targetStore, overridePin))) {
    return { session, approvedBy: '店長現場覆核授權' };
  }
  throw new Error('此為高風險管理操作（改價／減項改單／退單／高折讓／解鎖日結／後台設定），需「店長或開發者權限」或輸入店長覆核授權碼 (MANAGER_REQUIRED)');
}

export async function assertPrinterBridgeAuthorized(env, params, storeId) {
  const cleanStore = String(storeId || '').trim().toUpperCase();
  if (!cleanStore) throw new Error('缺少店家編號 (storeId)');
  if (await isMerchantRequestValid(env, params, cleanStore)) return true;
  const providedKey = String(params.printerKey || params.key || '').trim();
  const expectedKey = await getOrCreateStorePrinterKey(env, cleanStore);
  if (providedKey && expectedKey && constantTimeEquals(providedKey, expectedKey)) {
    return true;
  }
  throw new Error('出單機金鑰 (printerKey) 驗證失敗，請至 MealFlow 後台「設定 → 硬體出單」複製最新金鑰');
}

// ==================== Auth Action Handlers ====================

export async function handleVerifyMerchantPin(env, params) {
  const rawPin = String(params.pin || '').trim();
  const requestedStoreId = String(params.storeId || 'S01').trim() || 'S01';
  if (!rawPin || !/^\d{4,8}$/.test(rawPin)) {
    throw new Error('請輸入有效的 4 至 8 位數店務管理授權碼');
  }

  // 防暴力破解鎖定（存於 kv_settings）
  const rateKey = 'PIN_FAIL_STATE_' + requestedStoreId;
  const rateState = safeJsonParse(await kvGet(env.DB, rateKey), { count: 0, tier: 0, lockUntilTs: 0 });
  const nowMs = Date.now();
  if (rateState.lockUntilTs > nowMs && rateState.count >= 5) {
    throw new Error('授權碼連續輸入錯誤達 5 次，系統已啟動安全鎖定，請稍後再試');
  }
  if (rateState.lockUntilTs <= nowMs && rateState.count >= 5) {
    rateState.count = 0;
  }

  const candidateHash = await hashMerchantPinWithServerSalt(env, rawPin);
  const storeSpecificHash = await getStoredStorePinHash(env, requestedStoreId);
  const storeStaffHash = await getStoredStoreStaffPinHash(env, requestedStoreId);
  const defaultInitialHash = await getStoredMasterPinHash(env);
  const chosenStaffName = String(params.staffName || '').trim().slice(0, 20);

  let matchedRole = '';
  let authoritativeStaffName = '';
  let matchedByIndividualPin = false;

  if (await verifyDeveloperPinRaw(env, rawPin)) {
    matchedRole = 'DEVELOPER';
    authoritativeStaffName = (chosenStaffName && chosenStaffName !== '值班店長' && chosenStaffName !== '當班店長')
      ? chosenStaffName
      : '系統開發者';
  }

  if (!matchedRole) {
    const staffAccounts = await getStoreStaffAccounts(env, requestedStoreId);
    for (const acc of staffAccounts) {
      if (acc && acc.active !== false && constantTimeEquals(candidateHash, acc.pinHash)) {
        matchedRole = acc.role === 'MANAGER' ? 'MANAGER' : 'STAFF';
        authoritativeStaffName = String(acc.name);
        matchedByIndividualPin = true;
        break;
      }
    }
  }

  if (!matchedRole) {
    if (storeSpecificHash) {
      if (constantTimeEquals(candidateHash, storeSpecificHash)) matchedRole = 'MANAGER';
    } else if (constantTimeEquals(candidateHash, defaultInitialHash)) {
      matchedRole = 'MANAGER';
    }
  }
  if (!matchedRole && storeStaffHash && constantTimeEquals(candidateHash, storeStaffHash)) {
    matchedRole = 'STAFF';
  }

  if (matchedRole) {
    await kvDelete(env.DB, rateKey);
    const finalStaffName = authoritativeStaffName || chosenStaffName || (matchedRole === 'MANAGER' ? '當班店長' : '當班收銀員');
    const tokenScope = matchedRole === 'DEVELOPER' ? 'ALL' : requestedStoreId;
    const tokenObj = await issueMerchantSessionToken(env, tokenScope, matchedRole, finalStaffName);

    await appendSystemAuditEntry(
      env.DB,
      requestedStoreId,
      tokenObj.staffName,
      tokenObj.staffRole,
      matchedByIndividualPin ? '個人專屬PIN核實' : '',
      '員工上班打卡 (Clock-In)',
      `角色[${tokenObj.staffRole}] 解鎖店鋪 ${requestedStoreId}${matchedByIndividualPin ? '（一人一碼實名驗證）' : ''}`
    );

    return {
      verified: true,
      sessionToken: tokenObj.sessionToken,
      expiresAt: tokenObj.expiresAt,
      authorizedStoreId: tokenObj.authorizedStoreId,
      canSwitchAnyStore: matchedRole === 'DEVELOPER',
      staffRole: tokenObj.staffRole,
      staffName: tokenObj.staffName,
      matchedByIndividualPin,
      hasStaffPin: Boolean(storeStaffHash),
      staffList: await getStoreStaffList(env, requestedStoreId),
      staffAccounts: await getPublicStaffAccounts(env, requestedStoreId),
      isUsingInitialDefaultPin: !storeSpecificHash && matchedRole === 'MANAGER' && !matchedByIndividualPin
    };
  }

  const nextFail = (rateState.count || 0) + 1;
  const nextTier = (rateState.tier || 0) + (nextFail >= 5 ? 1 : 0);
  const lockSec = nextFail >= 5 ? Math.min(1800, 180 * Math.max(1, nextTier)) : 120;
  await kvSet(env.DB, rateKey, JSON.stringify({
    count: nextFail,
    tier: nextTier,
    lockUntilTs: nowMs + lockSec * 1000
  }));
  throw new Error('本店專屬授權碼錯誤，拒絕存取');
}

export async function handleVerifyManagerOverride(env, params) {
  const session = await parseVerifiedMerchantSession(env, params);
  const targetStore = String(params.storeId || (session && session.storeScope) || '').trim();
  if (!targetStore) throw new Error('缺少店鋪編號');
  const pin = String(params.pin || params.managerOverridePin || '').trim();
  if (!(await verifyStoreManagerPinRaw(env, targetStore, pin))) {
    throw new Error('店長覆核授權碼錯誤');
  }
  const isDev = await verifyDeveloperPinRaw(env, pin);
  return {
    approved: true,
    authorized: true,
    storeId: targetStore,
    approvedBy: isDev ? '開發者覆核授權' : '店長覆核授權'
  };
}

export async function handleLogoutMerchantSession(env, params) {
  const session = await parseVerifiedMerchantSession(env, params);
  if (session && session.nonce) {
    await kvSet(env.DB, 'REVOKED_SESSION_NONCE_' + session.nonce, String(Date.now()));
    const logStore = String((params && params.storeId) || session.storeScope || 'S01').trim();
    if (logStore && logStore !== 'ALL') {
      await appendSystemAuditEntry(
        env.DB,
        logStore,
        session.staffName,
        session.role,
        '',
        '員工下班打卡 (Clock-Out)',
        `主動鎖定登出後台 (${session.role})`
      );
    }
  }
  return { loggedOut: true };
}

export async function handleUpdateMerchantPin(env, params) {
  const oldPin = String(params.oldPin || '').trim();
  const newPin = String(params.newPin || '').trim();
  const targetStoreId = String(params.storeId || '').trim();
  if (!targetStoreId) throw new Error('缺少目標店鋪編號 (storeId)');
  if (!/^\d{4,8}$/.test(newPin)) throw new Error('新授權碼必須為 4 至 8 位數字');

  const curSess = await parseVerifiedMerchantSession(env, params);
  const isDeveloper = Boolean(curSess && curSess.role === 'DEVELOPER');
  if (!isDeveloper && !oldPin) throw new Error('請輸入目前使用的舊授權碼以驗證身分');

  const oldCandidateHash = await hashMerchantPinWithServerSalt(env, oldPin);
  const storeSpecificHash = await getStoredStorePinHash(env, targetStoreId);
  const defaultInitialHash = await getStoredMasterPinHash(env);

  const isOldValid = isDeveloper || (storeSpecificHash
    ? constantTimeEquals(oldCandidateHash, storeSpecificHash)
    : constantTimeEquals(oldCandidateHash, defaultInitialHash));

  if (!isOldValid) throw new Error('本店原授權碼驗證錯誤，無法變更密碼');

  const newHash = await hashMerchantPinWithServerSalt(env, newPin);
  await kvSet(env.DB, 'MERCHANT_PIN_HMAC_STORE_' + targetStoreId, newHash);
  const newTok = await issueMerchantSessionToken(
    env,
    isDeveloper ? 'ALL' : targetStoreId,
    isDeveloper ? 'DEVELOPER' : 'MANAGER',
    curSess ? curSess.staffName : '店長'
  );
  return {
    updated: true,
    storeId: targetStoreId,
    sessionToken: newTok.sessionToken,
    expiresAt: newTok.expiresAt
  };
}

export async function handleUpdateStaffSecurityConfig(env, params) {
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('缺少目標店鋪編號');

  if (params.clearStaffPin) {
    await kvDelete(env.DB, 'MERCHANT_STAFF_PIN_HMAC_STORE_' + storeId);
  } else if (params.staffPin !== undefined && String(params.staffPin).trim() !== '') {
    const cleanStaffPin = String(params.staffPin).trim();
    if (!/^\d{4,8}$/.test(cleanStaffPin)) throw new Error('收銀員密碼必須為 4 至 8 位數字');
    if (await verifyStoreManagerPinRaw(env, storeId, cleanStaffPin)) {
      throw new Error('收銀員密碼不可與店長或開發者密碼相同，以確保權限分級！');
    }
    await kvSet(env.DB, 'MERCHANT_STAFF_PIN_HMAC_STORE_' + storeId, await hashMerchantPinWithServerSalt(env, cleanStaffPin));
  }

  let accounts = await getStoreStaffAccounts(env, storeId);
  let accountsChanged = false;
  if (params.addStaffAccount && typeof params.addStaffAccount === 'object') {
    const sName = String(params.addStaffAccount.name || '').trim().slice(0, 20);
    const sPin = String(params.addStaffAccount.pin || '').trim();
    const sRole = String(params.addStaffAccount.role || 'STAFF').toUpperCase() === 'MANAGER' ? 'MANAGER' : 'STAFF';
    if (!sName) throw new Error('請輸入員工姓名');
    if (!/^\d{4,8}$/.test(sPin)) throw new Error('員工個人 PIN 必須為 4 至 8 位數字');
    if (await verifyDeveloperPinRaw(env, sPin)) throw new Error('個人 PIN 不可與系統開發者 PIN 相同');
    const pinHash = await hashMerchantPinWithServerSalt(env, sPin);
    if (accounts.some(a => a.active !== false && constantTimeEquals(a.pinHash, pinHash))) {
      throw new Error('此 PIN 碼已由本店另一名員工使用，請設定不重複的個人專屬 PIN 碼');
    }
    const storeMgrHash = await getStoredStorePinHash(env, storeId);
    const storeSharedStaffHash = await getStoredStoreStaffPinHash(env, storeId);
    if ((storeMgrHash && constantTimeEquals(pinHash, storeMgrHash)) || (storeSharedStaffHash && constantTimeEquals(pinHash, storeSharedStaffHash))) {
      throw new Error('個人 PIN 不可與店鋪共用主密碼重複');
    }
    const existingIdx = accounts.findIndex(a => String(a.name).trim() === sName);
    const nowP = getTaipeiDateParts();
    const newRec = {
      id: existingIdx >= 0 ? accounts[existingIdx].id : ('STF-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()),
      name: sName,
      role: sRole,
      pinHash,
      active: true,
      createdAt: `${nowP.dateStr} ${nowP.timeStr}`
    };
    if (existingIdx >= 0) accounts[existingIdx] = newRec;
    else accounts.push(newRec);
    accountsChanged = true;
  }
  if (params.removeStaffAccountId) {
    const rmId = String(params.removeStaffAccountId).trim();
    accounts = accounts.filter(a => String(a.id) !== rmId);
    accountsChanged = true;
  }
  if (params.toggleStaffAccountId) {
    const tgId = String(params.toggleStaffAccountId).trim();
    accounts.forEach(a => {
      if (String(a.id) === tgId) a.active = (a.active === false);
    });
    accountsChanged = true;
  }
  if (accountsChanged) {
    await kvSet(env.DB, 'STORE_STAFF_ACCOUNTS_' + storeId, JSON.stringify(accounts.slice(0, 40)));
  }
  if (Array.isArray(params.staffList)) {
    const cleaned = params.staffList.map(s => String(s || '').trim().slice(0, 20)).filter(Boolean).slice(0, 20);
    await kvSet(env.DB, 'STORE_STAFF_LIST_' + storeId, JSON.stringify(cleaned));
  }

  return {
    updated: true,
    storeId,
    hasStaffPin: Boolean(await getStoredStoreStaffPinHash(env, storeId)),
    staffList: await getStoreStaffList(env, storeId),
    staffAccounts: await getPublicStaffAccounts(env, storeId)
  };
}
