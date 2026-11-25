/**
 * MealFlow Cloudflare Workers — LINE Pay V3、LINE Login / Flex Push、Gemini AI 與會員點數模組 (Phase 5)
 * 100% 相容原 code.gs 介面與安全機制（Web Crypto HMAC-SHA256 + D1 持久化）
 */

import {
  AI_DISCOUNT_MIN_SUBTOTAL,
  BRAND_NAME,
  dbRowToOrderObject,
  evaluateComboDiscounts,
  evaluateOrderLifecycleStatus,
  evaluateStoreBusinessHours,
  generateStableMenuItemId,
  getTaipeiDateParts,
  getTodayTaipeiStr,
  isPeakHourSlot,
  normalizeDateStr,
  normalizeTimeStr,
  parseMenuRowOptionsAndSoldOut,
  safeJsonParse,
  sanitizeOrderForClientOutput,
  validateTaiwanTaxId
} from './utils.js';

import {
  assertManagerAuthorized,
  assertMerchantAuthorized,
  computeHmacHex,
  constantTimeEquals,
  generateOrderVerificationCodeOnServer,
  getServerSecretKey,
  kvGet,
  kvSet
} from './auth.js';

import { syncOrderToFirestore } from './firestore.js';
import { getCachedStoresAndMenus } from './cache.js';

const SYSTEM_LINE_CLIENT_ID_DEFAULT = '2012260287';

async function computeHmacBase64(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(message || '')));
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ==================== 1. LINE & LINE Pay 設定解析 ====================

export async function resolveStoreLinePayConfig(env, storeId) {
  const db = env.DB;
  let cfg = {};
  if (storeId) {
    cfg = safeJsonParse(await kvGet(db, 'STORE_LINE_CFG_' + String(storeId).trim()), {});
  }
  const sysId = (await kvGet(db, 'LINE_PAY_CHANNEL_ID')) || String(env.LINE_PAY_CHANNEL_ID || '');
  const sysSecret = (await kvGet(db, 'LINE_PAY_CHANNEL_SECRET')) || String(env.LINE_PAY_CHANNEL_SECRET || '');
  const channelId = String(cfg.linePayChannelId || sysId || '').trim();
  const channelSecret = String(cfg.linePayChannelSecret || sysSecret || '').trim();
  const isSandbox = cfg.linePaySandbox !== undefined ? Boolean(cfg.linePaySandbox) : true;
  return {
    storeId: String(storeId || ''),
    channelId,
    channelSecret,
    isSandbox,
    hasMerchantCredentials: Boolean(channelId && channelSecret)
  };
}

export async function resolveLineConfigForStore(env, storeId) {
  const db = env.DB;
  const sysClientId = (await kvGet(db, 'LINE_CLIENT_ID')) || String(env.LINE_CLIENT_ID || SYSTEM_LINE_CLIENT_ID_DEFAULT);
  const sysClientSecret = (await kvGet(db, 'LINE_CLIENT_SECRET')) || String(env.LINE_CLIENT_SECRET || '');
  const sysChannelToken = (await kvGet(db, 'LINE_CHANNEL_TOKEN')) || String(env.LINE_CHANNEL_TOKEN || '');

  if (storeId) {
    const parsed = safeJsonParse(await kvGet(db, 'STORE_LINE_CFG_' + String(storeId).trim()), null);
    if (parsed && parsed.useCustomLineOa && parsed.channelToken) {
      return {
        useCustomLineOa: true,
        clientId: parsed.clientId || sysClientId,
        clientSecret: parsed.clientSecret || sysClientSecret,
        channelToken: parsed.channelToken
      };
    }
  }
  return {
    useCustomLineOa: false,
    clientId: sysClientId,
    clientSecret: sysClientSecret,
    channelToken: sysChannelToken
  };
}

// ==================== 2. LINE Flex Push 推播與 OAuth Callback ====================

export async function sendLinePushMessage(env, lineUserId, text, tokenOverride = '', flexMeta = {}) {
  try {
    const uidStr = String(lineUserId || '').trim();
    if (!uidStr.startsWith('U') || uidStr.length < 15) return false;

    const lineCfg = await resolveLineConfigForStore(env, flexMeta.storeId || '');
    const channelToken = String(tokenOverride || lineCfg.channelToken || '').trim();
    if (!channelToken) return false;

    const titleText = String(flexMeta.title || `${BRAND_NAME} 即時通知`);
    const storeName = String(flexMeta.storeName || BRAND_NAME);
    const statusText = String(flexMeta.statusText || '即時通知');
    const pickupNumber = String(flexMeta.pickupNumber || '');
    const orderUrl = String(flexMeta.orderUrl || 'https://yangbrian01.github.io/scu.meal/order/');

    const bodyContents = [
      { type: 'text', text: storeName, weight: 'bold', size: 'sm', color: '#EA580C' },
      { type: 'text', text: titleText, weight: 'bold', size: 'lg', margin: 'sm', wrap: true, color: '#111827' }
    ];

    if (pickupNumber) {
      bodyContents.push({
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFF7ED',
        cornerRadius: 'md',
        paddingAll: 'md',
        margin: 'md',
        contents: [
          { type: 'text', text: '取餐號碼', size: 'xs', color: '#9A3412', align: 'center' },
          { type: 'text', text: `#${pickupNumber}`, size: '3xl', weight: 'bold', color: '#EA580C', align: 'center' },
          { type: 'text', text: statusText, size: 'xs', color: '#C2410C', align: 'center', margin: 'xs' }
        ]
      });
    }

    bodyContents.push({
      type: 'text',
      text: String(text || ''),
      size: 'sm',
      color: '#374151',
      wrap: true,
      margin: 'md'
    });

    const flexBubble = {
      type: 'bubble',
      size: 'mega',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#FF5A1F',
          action: { type: 'uri', label: '🎟️ 開啟電子取餐憑證', uri: orderUrl }
        }]
      }
    };

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${channelToken}`
      },
      body: JSON.stringify({
        to: uidStr,
        messages: [{
          type: 'flex',
          altText: `${titleText} - ${String(text || '').slice(0, 120)}`,
          contents: flexBubble
        }]
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function dispatchOrderNotification(env, orderObj, titleText, messageText, statusLabel) {
  if (!orderObj) return;
  const uid = String(orderObj.lineUserId || '').trim();
  if (!uid.startsWith('U')) return;
  const orderUrl = `https://yangbrian01.github.io/scu.meal/order/?id=${encodeURIComponent(orderObj.orderId)}`;
  await sendLinePushMessage(env, uid, messageText, '', {
    storeId: orderObj.storeId || '',
    title: titleText,
    pickupNumber: orderObj.pickupNumber || '',
    storeName: orderObj.storeName || BRAND_NAME,
    statusText: statusLabel || orderObj.status || '即時通知',
    orderUrl
  });
}

export async function handleLineCallback(env, params = {}) {
  try {
    const code = String(params.code || '').trim();
    const redirectUri = String(params.redirectUri || 'https://yangbrian01.github.io/scu.meal/order/').trim();
    const storeId = String(params.storeId || '').trim();
    if (!code) return { success: false, message: '缺少 LINE 授權碼' };

    const lineCfg = await resolveLineConfigForStore(env, storeId);
    const clientId = String(params.clientId || lineCfg.clientId).trim();
    const clientSecret = String(params.clientSecret || lineCfg.clientSecret).trim();
    if (!clientSecret) {
      return { success: false, message: '後端尚未設定頻道密鑰，請先於店家後台設定填入' };
    }

    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret
      })
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenData || !tokenData.access_token) {
      return { success: false, message: tokenData.error_description || 'LINE Token 交換失敗' };
    }

    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const profData = await profRes.json().catch(() => ({}));
    const userUID = String(profData.userId || '').trim();
    const displayName = String(profData.displayName || '東吳同學').trim();
    const pictureUrl = String(profData.pictureUrl || '').trim();
    if (!userUID) return { success: false, message: '無法取得 LINE 使用者資料' };

    // 同步建檔會員資料
    await env.DB.prepare(`
      INSERT INTO members (line_user_id, display_name, phone, tax_id, points, order_count, favorite_items_json, updated_at)
      VALUES (?, ?, '', '', 0, 0, '{}', ?)
      ON CONFLICT (line_user_id) DO UPDATE SET
        display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE members.display_name END,
        updated_at = excluded.updated_at
    `).bind(userUID, displayName, new Date().toISOString()).run();

    await sendLinePushMessage(
      env,
      userUID,
      `歡迎 ${displayName}！已成功綁定 ${BRAND_NAME} 取餐通知，餐點備妥將即時推播提醒您。`,
      '',
      { storeId, title: '✅ 已綁定 LINE 取餐推播', storeName: BRAND_NAME, statusText: '綁定成功' }
    );

    return { success: true, status: 'success', lineUid: userUID, displayName, pictureUrl };
  } catch (err) {
    return { success: false, message: err && err.message ? err.message : String(err) };
  }
}

export async function handleSaveLineDevConfig(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  await assertManagerAuthorized(env, params, storeId);

  if (storeId) {
    const prev = safeJsonParse(await kvGet(db, 'STORE_LINE_CFG_' + storeId), {});
    const newSecret = String(params.linePayChannelSecret || '').trim();
    const newClientSecret = String(params.clientSecret || params.customLineClientSecret || '').trim();
    const newChannelToken = String(params.channelAccessToken || params.customLineChannelToken || '').trim();

    const nextCfg = {
      useCustomLineOa: params.useCustomLineOa !== undefined ? Boolean(params.useCustomLineOa) : Boolean(prev.useCustomLineOa),
      clientId: params.clientId !== undefined || params.customLineClientId !== undefined
        ? String(params.clientId || params.customLineClientId || '').trim()
        : (prev.clientId || ''),
      clientSecret: newClientSecret || prev.clientSecret || '',
      channelToken: newChannelToken || prev.channelToken || '',
      linePayChannelId: params.linePayChannelId !== undefined
        ? String(params.linePayChannelId || '').trim()
        : (prev.linePayChannelId || ''),
      linePayChannelSecret: newSecret || prev.linePayChannelSecret || '',
      linePaySandbox: params.linePaySandbox !== undefined
        ? Boolean(params.linePaySandbox)
        : (prev.linePaySandbox !== undefined ? Boolean(prev.linePaySandbox) : true)
    };
    await kvSet(db, 'STORE_LINE_CFG_' + storeId, JSON.stringify(nextCfg));
  }

  const sysToken = String(params.systemChannelToken || (!params.useCustomLineOa && params.channelAccessToken) || '').trim();
  if (sysToken) await kvSet(db, 'LINE_CHANNEL_TOKEN', sysToken);
  if (params.systemClientId) await kvSet(db, 'LINE_CLIENT_ID', String(params.systemClientId).trim());
  if (params.systemClientSecret) await kvSet(db, 'LINE_CLIENT_SECRET', String(params.systemClientSecret).trim());
  if (params.botBasicId !== undefined) await kvSet(db, 'LINE_BOT_BASIC_ID', String(params.botBasicId).trim());
  if (params.liffId !== undefined) await kvSet(db, 'LINE_LIFF_ID', String(params.liffId).trim());

  return { saved: true, storeId };
}

export async function handleManualLinePush(env, params = {}) {
  const storeId = String(params.storeId || '').trim();
  await assertMerchantAuthorized(env, params, storeId);

  let lineSent = false;
  if (params.lineUserId && String(params.lineUserId).startsWith('U')) {
    lineSent = await sendLinePushMessage(
      env,
      params.lineUserId,
      params.message || '',
      params.channelAccessToken || '',
      {
        storeId,
        title: params.title || `${BRAND_NAME} 訂單通知`,
        pickupNumber: params.pickupNumber || '',
        storeName: params.storeName || BRAND_NAME,
        statusText: params.statusText || '即時通知',
        orderUrl: params.orderUrl || 'https://yangbrian01.github.io/scu.meal/order/'
      }
    );
  }
  return { sent: lineSent, lineSent, emailSent: false };
}

// ==================== 3. LINE Pay V3 Request / Confirm / Refund / POS Charge ====================

export async function verifyLinePayAuthToken(env, paymentAuthToken, expectedStoreId, expectedAmount) {
  const tok = String(paymentAuthToken || '').trim();
  if (!tok || !tok.includes('.')) return null;
  const parts = tok.split('.');
  if (parts.length !== 2) return null;

  const [payloadStr, providedSig] = parts;
  const secret = await getServerSecretKey(env);
  const expectedSig = await computeHmacHex('LINEPAY_AUTH_V17:' + payloadStr, secret);
  if (!constantTimeEquals(providedSig, expectedSig)) return null;

  const f = payloadStr.split('|');
  if (f.length !== 4) return null;
  const [tokenStoreId, tokenAmtStr, transactionId, expStr] = f;
  const tokenAmt = Number(tokenAmtStr);
  const expiresAt = Number(expStr);
  if (String(tokenStoreId) !== String(expectedStoreId)) return null;
  if (tokenAmt !== Number(expectedAmount)) return null;
  if (!expiresAt || Date.now() > expiresAt) return null;

  const usedKey = 'LP_USED_TX_' + transactionId;
  if (await kvGet(env.DB, usedKey, { bypassCache: true })) return null;
  await kvSet(env.DB, usedKey, String(Date.now()));
  return { verified: true, transactionId, amount: tokenAmt };
}

export async function refundLinePayTransaction(env, storeId, transactionId, refundAmount) {
  const txId = String(transactionId || '').trim();
  if (!/^\d{10,24}$/.test(txId)) return { attempted: false };
  const lpCfg = await resolveStoreLinePayConfig(env, storeId);
  if (!lpCfg.hasMerchantCredentials) return { attempted: false };

  const baseUrl = lpCfg.isSandbox ? 'https://sandbox-api-pay.line.me' : 'https://api-pay.line.me';
  const reqUri = `/v3/payments/${txId}/refund`;
  const bodyStr = JSON.stringify({ refundAmount: Math.max(0, Math.round(Number(refundAmount) || 0)) });
  const nonce = crypto.randomUUID();
  const sigB64 = await computeHmacBase64(lpCfg.channelSecret + reqUri + bodyStr + nonce, lpCfg.channelSecret);

  const res = await fetch(baseUrl + reqUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LINE-ChannelId': lpCfg.channelId,
      'X-LINE-Authorization-Nonce': nonce,
      'X-LINE-Authorization': sigB64
    },
    body: bodyStr
  });
  const json = await res.json().catch(() => ({}));
  return {
    attempted: true,
    returnCode: String(json.returnCode || ''),
    returnMessage: String(json.returnMessage || '')
  };
}

async function prepareVerifiedOrderDraft(env, params, isMerchantPosRequest) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  const sm = await getCachedStoresAndMenus(db);
  const storeRow = sm.storeById.get(storeId.toUpperCase()) || null;
  if (!storeRow) throw new Error('查無此學餐店家: ' + storeId);

  const customMeta = safeJsonParse(storeRow.custom_meta_json, {});
  const isStoreOpen = storeRow.is_open !== undefined && storeRow.is_open !== null ? Boolean(storeRow.is_open) : true;
  const isReservation = Boolean(params.isReservation);

  if (!isMerchantPosRequest && env.BYPASS_BUSINESS_HOURS !== '1') {
    const biz = evaluateStoreBusinessHours(customMeta, isStoreOpen);
    if (!biz.canPreOrder) throw new Error(`「${storeRow.name}」目前為「暫停營業」狀態`);
    if (!isReservation && !biz.canOrderNow) throw new Error(`「${storeRow.name}」${biz.statusLabel}，請改用預訂取餐`);
  }

  const taxId = String(params.taxId || '').trim().replace(/\D/g, '').slice(0, 8);
  if (taxId && !validateTaiwanTaxId(taxId)) throw new Error('統一編號檢查碼驗證失敗');

  const rawItems = Array.isArray(params.items) ? params.items : (Array.isArray(params.structuredItems) ? params.structuredItems : []);
  const nonGift = rawItems.filter(it => it && !it.isGift && String(it.id) !== 'GIFT-AI');
  if (nonGift.length === 0) throw new Error('購物車內無有效付費餐點');

  const storeMenus = sm.menusByStoreId.get(storeId.toUpperCase()) || [];
  const menuById = {};
  const menuByCatName = {};
  const menuByName = {};
  storeMenus.forEach(m => {
    const parsed = parseMenuRowOptionsAndSoldOut(m);
    const obj = {
      id: String(m.id),
      name: String(m.name || '').trim(),
      category: String(m.category || '招牌主餐').trim(),
      price: Math.max(0, Number(m.price) || 0),
      soldOut: parsed.isSoldOut,
      options: parsed.parsedOptions
    };
    menuById[obj.id] = obj;
    menuByCatName[`${obj.category}::${obj.name}`] = obj;
    if (!menuByName[obj.name]) menuByName[obj.name] = obj;
  });

  const nowMs = Date.now();
  const nowP = getTaipeiDateParts(nowMs);
  const todayStr = nowP.dateStr;
  let pickupDateVal = isReservation ? normalizeDateStr(params.pickupDate) : todayStr;
  if (pickupDateVal < todayStr) pickupDateVal = todayStr;
  const pickupTimeVal = isReservation ? normalizeTimeStr(params.pickupTime, false) : nowP.timeStr;

  const verifiedItems = [];
  let authoritativeSubtotal = 0;

  for (const reqItem of nonGift) {
    const reqId = String(reqItem.id || '').trim();
    const reqBaseName = String(reqItem.baseName || reqItem.name || '').split(' [')[0].trim();
    const reqCat = String(reqItem.category || '').trim();
    const qty = Math.max(1, Math.min(99, parseInt(reqItem.qty, 10) || 1));
    const dbMenu = menuById[reqId] || (reqCat ? menuByCatName[`${reqCat}::${reqBaseName}`] : null) || menuByName[reqBaseName];
    if (!dbMenu) throw new Error(`查無品項「${reqBaseName || reqId}」`);
    if (dbMenu.soldOut && !isMerchantPosRequest) throw new Error(`品項「${dbMenu.name}」目前已售罄`);

    let unitExtra = 0;
    const verifiedSelections = {};
    const clientSel = (reqItem.selections && typeof reqItem.selections === 'object') ? reqItem.selections : {};
    const dbOpts = dbMenu.options || {};

    for (const [optGroup, grp] of Object.entries(dbOpts)) {
      const choices = Array.isArray(grp && grp.choices) ? grp.choices : (Array.isArray(grp) ? grp : []);
      const priceMap = {};
      choices.forEach(c => {
        const cn = String(Array.isArray(c) ? c[0] : (c && (c.label || c.name) ? (c.label || c.name) : c)).trim();
        const cp = Array.isArray(c) ? Math.max(0, Number(c[1]) || 0) : Math.max(0, Number((c && (c.priceDelta ?? c.price)) || 0));
        if (cn) priceMap[cn] = cp;
      });
      const rawVal = clientSel[optGroup];
      if (!rawVal) continue;
      const tokens = Array.isArray(rawVal) ? rawVal : String(rawVal).split(',').map(s => s.trim()).filter(Boolean);
      const valid = [];
      for (const tok of tokens) {
        const m = String(tok).match(/^(.+?)(?:[×xX*]\s*(\d+))?$/);
        if (!m) continue;
        const cn = m[1].trim();
        const cq = Math.max(1, Math.min(10, parseInt(m[2] || '1', 10) || 1));
        if (priceMap[cn] !== undefined) {
          unitExtra += priceMap[cn] * cq;
          valid.push(cq > 1 ? `${cn}×${cq}` : cn);
        }
      }
      if (valid.length > 0) verifiedSelections[optGroup] = valid.join(', ');
    }
    // 保留巢狀次級規格鍵 (含 '・')
    for (const [k, v] of Object.entries(clientSel)) {
      if (k.includes('・') && v) verifiedSelections[k] = String(v).trim();
    }

    const unitPrice = Math.max(0, dbMenu.price + unitExtra);
    const lineSubtotal = unitPrice * qty;
    const selSuffix = Object.keys(verifiedSelections).length > 0
      ? ` [${Object.entries(verifiedSelections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
      : '';
    verifiedItems.push({
      id: dbMenu.id,
      category: dbMenu.category,
      baseName: dbMenu.name,
      name: `${dbMenu.name}${selSuffix}`,
      basePrice: dbMenu.price,
      unitExtra,
      price: unitPrice,
      qty,
      lineSubtotal,
      selections: verifiedSelections,
      itemNote: String(reqItem.itemNote || '').trim().slice(0, 60),
      isGift: false,
      snapshotAtTs: nowMs
    });
    authoritativeSubtotal += lineSubtotal;
  }

  const promoMode = String(storeRow.promo_mode || 'none');
  const promoText = String(storeRow.promo_text || '');
  const promoScope = customMeta.promoScope === 'ALL_DAY' ? 'ALL_DAY' : 'OFF_PEAK';
  const promoMin = customMeta.promoMinSubtotal !== undefined ? Math.max(0, Number(customMeta.promoMinSubtotal) || 0) : AI_DISCOUNT_MIN_SUBTOTAL;
  const promoActive = isStoreOpen && promoMode !== 'none' && (promoScope === 'ALL_DAY' || !(isReservation && isPeakHourSlot(pickupTimeVal)));

  let authoritativeDiscount = 0;
  const nonGiftQty = verifiedItems.reduce((s, it) => s + (Number(it.qty) || 1), 0);
  if (promoActive && promoMode === 'discount' && authoritativeSubtotal >= promoMin) {
    authoritativeDiscount = Math.min(authoritativeSubtotal, Math.max(0, Number(storeRow.promo_discount) || 0));
  } else if (promoActive && promoMode === 'second_discount' && nonGiftQty >= 2 && authoritativeSubtotal >= promoMin) {
    authoritativeDiscount = Math.min(authoritativeSubtotal, Math.floor(nonGiftQty / 2) * (Number(customMeta.secondItemDiscount || storeRow.promo_discount) || 10));
  }

  const comboEval = evaluateComboDiscounts(verifiedItems, customMeta.comboDiscounts, menuById);
  const comboDiscount = Math.min(Math.max(0, authoritativeSubtotal - authoritativeDiscount), comboEval.totalComboDiscount);
  authoritativeDiscount += comboDiscount;

  let appliedCouponCode = '';
  let couponDiscount = 0;
  const reqCoupon = String(params.couponCode || '').trim().toUpperCase();
  if (reqCoupon) {
    const matched = (Array.isArray(customMeta.coupons) ? customMeta.coupons : []).find(
      c => c && c.active !== false && String(c.code || '').trim().toUpperCase() === reqCoupon
    );
    if (!matched) throw new Error(`折扣碼「${reqCoupon}」無效或已停用`);
    if (authoritativeSubtotal < (Number(matched.minSubtotal) || 0)) throw new Error(`折扣碼「${reqCoupon}」未達消費門檻`);
    const remain = Math.max(0, authoritativeSubtotal - authoritativeDiscount);
    couponDiscount = matched.type === 'PERCENT'
      ? Math.min(remain, Math.round(remain * (Math.max(1, Math.min(90, Number(matched.value) || 10)) / 100)))
      : Math.min(remain, Math.max(0, Number(matched.value) || 0));
    authoritativeDiscount += couponDiscount;
    appliedCouponCode = reqCoupon;
  }

  const needCutlery = Boolean(params.needCutlery);
  const cutleryFee = needCutlery ? Math.max(0, Number(storeRow.cutlery_price ?? 1)) : 0;
  const dineType = String(params.dineType || '外帶自取').trim();
  const takeoutFee = (authoritativeSubtotal > 0 && dineType.includes('外帶')) ? 1 : 0;
  const authoritativeFinalTotal = Math.max(0, authoritativeSubtotal + cutleryFee + takeoutFee - authoritativeDiscount);

  const customerNote = String(params.customerNote || '').trim();
  const studentNameSummary = [
    dineType,
    needCutlery ? `🥢 需免洗餐具${cutleryFee > 0 ? `(+$${cutleryFee})` : ''}` : '',
    taxId ? `🧾 統編:${taxId}` : '',
    customerNote ? `📝 備註：${customerNote}` : ''
  ].filter(Boolean).join(' ・ ');

  const promoAppliedText = [
    promoActive ? promoText : '',
    comboDiscount > 0 ? comboEval.matchedDetails.map(d => `${d.name}(-$${d.discount})`).join('+') : '',
    appliedCouponCode ? `折扣碼:${appliedCouponCode}(-$${couponDiscount})` : ''
  ].filter(Boolean).join(' + ') || '一般點餐';

  const pickupTimeSlot = isReservation ? `📅 預訂 ${pickupDateVal} ${pickupTimeVal}` : '⚡ 立即製作';

  return {
    storeRow,
    customMeta,
    verifiedItems,
    authoritativeSubtotal,
    authoritativeDiscount,
    cutleryFee,
    takeoutFee,
    authoritativeFinalTotal,
    promoActive,
    promoAppliedText,
    pickupTimeSlot,
    pickupDateVal,
    pickupTimeVal,
    createdAtStr: nowP.timeFullStr,
    orderSource: String(params.orderSource || params.studentId || '📱 掃碼點餐'),
    studentNameSummary,
    extraMeta: {
      dineType,
      couponCode: appliedCouponCode,
      couponDiscount,
      itemCheckedMap: {},
      needCutlery,
      cutleryFee,
      takeoutFee,
      taxId,
      manualDiscount: 0,
      manualDiscountReason: '',
      isReservation,
      pickupDate: pickupDateVal,
      pickupTime: pickupTimeVal,
      customerPhone: String(params.customerPhone || '').trim(),
      customerNote,
      clientDeviceId: String(params.clientDeviceId || '').trim(),
      lineUserId: String(params.lineUserId || '').trim(),
      customerEmail: String(params.customerEmail || '').trim(),
      notifyCount: 0,
      createdAtTs: nowMs,
      cookingStartedAtTs: 0,
      readyAtTs: 0,
      merchantMessage: '',
      merchantMessages: []
    }
  };
}

export async function handleRequestLinePayCheckout(env, params = {}) {
  const db = env.DB;
  const storeId = String(params.storeId || '').trim();
  if (!storeId) throw new Error('金流請求參數錯誤：缺少店家編號');

  let amount = Math.max(0, Math.round(Number(params.amount) || 0));
  const orderId = String(params.orderId || ('ORD-LP-' + crypto.randomUUID().slice(0, 8))).trim();

  if (await kvGet(db, 'LP_PAID_ORD_' + orderId, { bypassCache: true })) {
    throw new Error('此訂單已完成付款授權，請勿重複扣款！');
  }

  let prebuilt = null;
  const draftPayload = (params.orderDraft && typeof params.orderDraft === 'object') ? params.orderDraft : null;
  if (draftPayload && Array.isArray(draftPayload.items || draftPayload.structuredItems) && (draftPayload.items || draftPayload.structuredItems).length > 0) {
    prebuilt = await prepareVerifiedOrderDraft(env, { ...draftPayload, orderId, storeId, paymentMethod: 'LINE Pay' }, false);
    amount = prebuilt.authoritativeFinalTotal;
  }

  if (amount <= 0) throw new Error('金流請求參數錯誤：缺少有效結帳金額');

  const lpCfg = await resolveStoreLinePayConfig(env, storeId);
  if (params.useRealLinePayApi && !lpCfg.hasMerchantCredentials) {
    throw new Error('本店尚未設定真實 LINE Pay 商家金鑰，請改用「現場取餐付現」或洽店長設定。');
  }

  const todayCompact = getTodayTaipeiStr().replace(/-/g, '');
  const txRand = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  let transactionId = `LP-${todayCompact}-${storeId}-${txRand}`;
  let paymentUrlWeb = '';
  const gatewayMode = lpCfg.hasMerchantCredentials
    ? (lpCfg.isSandbox ? 'LINE_PAY_V3_SANDBOX' : 'LINE_PAY_V3_PROD')
    : 'SANDBOX_DEMO_UNCONFIGURED';

  if (lpCfg.hasMerchantCredentials) {
    const apiBase = lpCfg.isSandbox ? 'https://sandbox-api-pay.line.me' : 'https://api-pay.line.me';
    const uri = '/v3/payments/request';
    const nonce = crypto.randomUUID();
    let confirmUrl = String(params.confirmUrl || 'https://yangtechnology.github.io/scu.meal/order/?lpCallback=1').trim();
    if (!confirmUrl.includes('orderId=')) {
      confirmUrl += (confirmUrl.includes('?') ? '&' : '?') + 'orderId=' + encodeURIComponent(orderId);
    }
    const cancelUrl = String(params.cancelUrl || 'https://yangtechnology.github.io/scu.meal/order/?lpCancel=1').trim();
    const bodyStr = JSON.stringify({
      amount,
      currency: 'TWD',
      orderId,
      packages: [{
        id: storeId,
        amount,
        name: String(params.productSummary || `${BRAND_NAME} 線上點餐`),
        products: [{ name: String(params.productSummary || `${BRAND_NAME} 餐點訂單`), quantity: 1, price: amount }]
      }],
      redirectUrls: { confirmUrl, cancelUrl }
    });
    const sigB64 = await computeHmacBase64(lpCfg.channelSecret + uri + bodyStr + nonce, lpCfg.channelSecret);
    const lpRes = await fetch(apiBase + uri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LINE-ChannelId': lpCfg.channelId,
        'X-LINE-Authorization-Nonce': nonce,
        'X-LINE-Authorization': sigB64
      },
      body: bodyStr
    });
    const lpData = await lpRes.json().catch(() => ({}));
    if (!lpData || lpData.returnCode !== '0000' || !lpData.info) {
      throw new Error(`LINE Pay 付款請求失敗 (${lpData.returnCode || lpRes.status}): ${lpData.returnMessage || '請檢查商家金鑰'}`);
    }
    transactionId = String(lpData.info.transactionId);
    paymentUrlWeb = String((lpData.info.paymentUrl && lpData.info.paymentUrl.web) || '');
  }

  if (prebuilt) {
    const exists = await db.prepare('SELECT order_id FROM orders WHERE order_id = ?').bind(orderId).first();
    if (!exists) {
      const nowMs = Date.now();
      const meta = {
        ...prebuilt.extraMeta,
        paymentStatus: '待付款 (LINE Pay)',
        paidAtDate: '',
        transactionId,
        paymentVerifiedByHmac: false,
        linePayVerifiedMode: 'PENDING_REDIRECT',
        statusTimeline: [{ ts: nowMs, timeStr: prebuilt.createdAtStr, status: '待付款 (LINE Pay 授權中)', label: '已發起 LINE Pay 結帳授權' }]
      };
      await db.prepare(`
        INSERT INTO orders (
          order_id, pickup_number, store_id, store_name, student_id, student_name,
          items_json, subtotal, discount, cutlery_fee, takeout_fee, service_fee, final_total,
          promo_applied, dine_type, pickup_date, pickup_time, pickup_time_slot,
          payment_method, payment_status, paid_at_date, status, is_reservation,
          print_status, preprint_done, needs_print, customer_phone, line_user_id, verification_code,
          created_at, created_at_ts, extra_meta_json
        ) VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'LINE Pay', '待付款 (LINE Pay)', '', '待付款 (LINE Pay 授權中)', ?, 'PENDING', 0, 0, ?, ?, '', ?, ?, ?)
      `).bind(
        orderId, storeId, String(prebuilt.storeRow.name || ''), prebuilt.orderSource, prebuilt.studentNameSummary,
        JSON.stringify(prebuilt.verifiedItems), prebuilt.authoritativeSubtotal, prebuilt.authoritativeDiscount,
        prebuilt.cutleryFee, prebuilt.takeoutFee, prebuilt.authoritativeFinalTotal,
        prebuilt.promoAppliedText, prebuilt.extraMeta.dineType, prebuilt.pickupDateVal, prebuilt.pickupTimeVal,
        prebuilt.pickupTimeSlot, prebuilt.extraMeta.isReservation ? 1 : 0,
        prebuilt.extraMeta.customerPhone, prebuilt.extraMeta.lineUserId,
        prebuilt.createdAtStr, nowMs, JSON.stringify(meta)
      ).run();
    }
  }

  const expiresAt = Date.now() + 20 * 60 * 1000;
  const serverSecret = await getServerSecretKey(env);
  const signingSecret = `${serverSecret}|${lpCfg.channelSecret || 'SYS_LP'}`;
  const reqTokenPayload = `${storeId}|${amount}|${transactionId}|${orderId}|${expiresAt}`;
  const reqTokenSig = await computeHmacHex('LINEPAY_REQ_V18:' + reqTokenPayload, signingSecret);
  const requestToken = `${reqTokenPayload}.${reqTokenSig}`;

  await kvSet(db, 'LP_PENDING_TX_' + transactionId, JSON.stringify({
    storeId, amount, orderId, expiresAt, requiresRealConfirm: lpCfg.hasMerchantCredentials, status: 'REQUESTED'
  }));

  return {
    approved: false,
    step: lpCfg.hasMerchantCredentials ? 'REDIRECT_REQUIRED' : 'DEMO_SANDBOX_READY',
    requiresRedirect: Boolean(lpCfg.hasMerchantCredentials && paymentUrlWeb),
    requiresStoreCredentials: !lpCfg.hasMerchantCredentials,
    preCreatedOrder: Boolean(prebuilt),
    gatewayMode,
    merchantChannelId: lpCfg.channelId ? (lpCfg.channelId.slice(0, 4) + '****' + lpCfg.channelId.slice(-2)) : '未設定商家金鑰（教學展示沙盒）',
    transactionId,
    orderId,
    amount,
    storeId,
    expiresAt,
    paymentUrlWeb,
    requestToken,
    paymentAuthToken: ''
  };
}

export async function handleConfirmLinePayCheckout(env, ctx, params = {}, getNextPickupNumberFn) {
  const db = env.DB;
  const transactionId = String(params.transactionId || '').trim();
  if (!transactionId) throw new Error('缺少 LINE Pay 交易編號 (transactionId)');

  let orderId = String(params.orderId || '').trim();
  let pendingRow = orderId
    ? await db.prepare('SELECT * FROM orders WHERE order_id = ?').bind(orderId).first()
    : null;
  if (!pendingRow) {
    const searchRes = await db.prepare('SELECT * FROM orders WHERE extra_meta_json LIKE ? ORDER BY created_at_ts DESC LIMIT 5')
      .bind(`%${transactionId}%`).all();
    pendingRow = (searchRes.results || []).find(r => safeJsonParse(r.extra_meta_json, {}).transactionId === transactionId) || null;
  }

  const pendingOrderObj = pendingRow ? dbRowToOrderObject(pendingRow) : null;
  const storeId = String(params.storeId || (pendingOrderObj && pendingOrderObj.storeId) || '').trim();
  const amount = Math.max(0, Math.round(Number(params.amount || (pendingOrderObj && pendingOrderObj.finalTotal) || 0)));
  if (!orderId && pendingOrderObj) orderId = pendingOrderObj.orderId;
  if (!storeId || amount <= 0) throw new Error('金流核實參數不完整（缺少 storeId 或金額）');

  if (pendingOrderObj && pendingOrderObj.status !== '待付款 (LINE Pay 授權中)' && pendingOrderObj.paymentStatus === '已付款') {
    return {
      confirmed: true,
      approved: true,
      alreadyConfirmed: true,
      returnCode: '0000',
      transactionId,
      storeId,
      amount,
      order: sanitizeOrderForClientOutput(pendingOrderObj, false, true)
    };
  }

  const lpCfg = await resolveStoreLinePayConfig(env, storeId);
  const serverSecret = await getServerSecretKey(env);

  if (params.requestToken) {
    const [pStr, pSig] = String(params.requestToken).split('.');
    const signingSecret = `${serverSecret}|${lpCfg.channelSecret || 'SYS_LP'}`;
    const expectedSig = await computeHmacHex('LINEPAY_REQ_V18:' + pStr, signingSecret);
    if (!constantTimeEquals(pSig, expectedSig)) throw new Error('LINE Pay 請求簽章驗證失敗');
  }

  if (lpCfg.hasMerchantCredentials) {
    const apiBase = lpCfg.isSandbox ? 'https://sandbox-api-pay.line.me' : 'https://api-pay.line.me';
    const uri = `/v3/payments/${encodeURIComponent(transactionId)}/confirm`;
    const nonce = crypto.randomUUID();
    const bodyStr = JSON.stringify({ amount, currency: 'TWD' });
    const sigB64 = await computeHmacBase64(lpCfg.channelSecret + uri + bodyStr + nonce, lpCfg.channelSecret);
    const res = await fetch(apiBase + uri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LINE-ChannelId': lpCfg.channelId,
        'X-LINE-Authorization-Nonce': nonce,
        'X-LINE-Authorization': sigB64
      },
      body: bodyStr
    });
    const lpData = await res.json().catch(() => ({}));
    if (!lpData || (lpData.returnCode !== '0000' && lpData.returnCode !== '1172')) {
      throw new Error(`LINE Pay Confirm 失敗 (${lpData.returnCode || res.status}): ${lpData.returnMessage || '核實未通過'}`);
    }
  } else if (!params.allowUnconfiguredDemo) {
    throw new Error('本店尚未設定 LINE Pay 商家金鑰，拒絕非沙盒核實');
  }

  const expiresAt = Date.now() + 15 * 60 * 1000;
  const payloadStr = `${storeId}|${amount}|${transactionId}|${expiresAt}`;
  const sigHex = await computeHmacHex('LINEPAY_AUTH_V17:' + payloadStr, serverSecret);
  const paymentAuthToken = `${payloadStr}.${sigHex}`;

  let finalizedOrderObj = null;
  if (pendingOrderObj && pendingOrderObj.status === '待付款 (LINE Pay 授權中)') {
    const nowMs = Date.now();
    const nowP = getTaipeiDateParts(nowMs);
    const sm = await getCachedStoresAndMenus(db);
    const storeRow = sm.storeById.get(storeId.toUpperCase()) || null;
    const storeMeta = safeJsonParse(storeRow && storeRow.custom_meta_json, {});
    const leadMins = Math.max(10, Math.min(90, Number(storeMeta.reserveLeadMinutes) || 25));

    const pickupNumber = await getNextPickupNumberFn(db, storeId, pendingOrderObj.pickupDate, false);
    const verificationCode = await generateOrderVerificationCodeOnServer(env, pendingOrderObj.orderId, pickupNumber, pendingOrderObj.finalTotal);
    const nextStatus = evaluateOrderLifecycleStatus(
      '製作中', pendingOrderObj.isReservation, '已付款',
      pendingOrderObj.pickupDate, pendingOrderObj.pickupTime,
      nowP.dateStr, nowP.minutesOfDay, leadMins
    );

    const meta = safeJsonParse(pendingOrderObj.extraMetaJson, {});
    meta.paymentStatus = '已付款';
    meta.paidAtDate = nowP.dateStr;
    meta.transactionId = transactionId;
    meta.paymentVerifiedByHmac = true;
    meta.linePayVerifiedMode = lpCfg.hasMerchantCredentials ? 'API_VERIFIED' : 'DEMO_CONFIRMED';
    meta.printStatus = 'PENDING';
    meta.printedAtTs = 0;
    meta.verificationCode = verificationCode;
    if (nextStatus === '製作中') meta.cookingStartedAtTs = nowMs;
    if (!Array.isArray(meta.statusTimeline)) meta.statusTimeline = [];
    meta.statusTimeline.push({ ts: nowMs, timeStr: nowP.timeFullStr, status: nextStatus, label: `LINE Pay 付款完成 (${transactionId})` });

    await db.prepare(`
      UPDATE orders
      SET pickup_number = ?, verification_code = ?, status = ?, payment_status = '已付款',
          paid_at_date = ?, print_status = 'PENDING', needs_print = 1, extra_meta_json = ?
      WHERE order_id = ?
    `).bind(pickupNumber, verificationCode, nextStatus, nowP.dateStr, JSON.stringify(meta), pendingOrderObj.orderId).run();

    await Promise.all([
      kvSet(db, 'LP_PAID_ORD_' + pendingOrderObj.orderId, String(nowMs)),
      kvSet(db, 'LP_USED_TX_' + transactionId, String(nowMs))
    ]);

    const updatedRow = await db.prepare('SELECT * FROM orders WHERE order_id = ?').bind(pendingOrderObj.orderId).first();
    finalizedOrderObj = dbRowToOrderObject(updatedRow);

    const frontCategories = Array.isArray(storeMeta.printerFrontCategories) && storeMeta.printerFrontCategories.length > 0
      ? storeMeta.printerFrontCategories
      : ['飯捲類', '飲料類', '飲品類'];
    const autoPrintEnabled = storeMeta.printerAutoEnabled !== undefined ? Boolean(storeMeta.printerAutoEnabled) : true;
    const printMode = (nextStatus === '製作中' || nextStatus === '可取餐') ? 'NORMAL' : 'PREORDER_COUNTER_ONLY';

    const bgTask = Promise.allSettled([
      updateMemberStatsFromOrder(env.DB, finalizedOrderObj),
      syncOrderToFirestore(env, finalizedOrderObj, { pushPrintJob: autoPrintEnabled, printMode, frontCategories }),
      dispatchOrderNotification(
        env, finalizedOrderObj,
        `🟢 LINE Pay 付款成功 #${pickupNumber}`,
        `【${finalizedOrderObj.storeName}】已收到 NT$${finalizedOrderObj.finalTotal}，核銷碼：${verificationCode}`,
        nextStatus
      )
    ]);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(bgTask);
    else await bgTask;
  }

  return {
    confirmed: true,
    approved: true,
    returnCode: '0000',
    verifiedWithOfficialApi: Boolean(lpCfg.hasMerchantCredentials),
    transactionId,
    amount,
    storeId,
    expiresAt,
    paymentAuthToken,
    order: finalizedOrderObj ? sanitizeOrderForClientOutput(finalizedOrderObj, false, true) : null
  };
}

export async function handlePosLinePayOneTimeKeyCharge(env, params = {}) {
  const storeId = String(params.storeId || '').trim();
  const amount = Math.max(0, Math.round(Number(params.amount) || 0));
  if (!storeId || amount <= 0) throw new Error('POS LINE Pay 扣款缺少 storeId 或有效金額');
  await assertMerchantAuthorized(env, params, storeId);

  const oneTimeKey = String(params.oneTimeKey || '').replace(/\D/g, '');
  if (oneTimeKey) {
    if (!/^\d{18}$/.test(oneTimeKey)) throw new Error('LINE Pay 條碼必須為 18 位數字');
    const lpCfg = await resolveStoreLinePayConfig(env, storeId);
    if (!lpCfg.hasMerchantCredentials) throw new Error('本店尚未設定 LINE Pay 商家金鑰，無法執行條碼掃描扣款');

    const apiBase = lpCfg.isSandbox ? 'https://sandbox-api-pay.line.me' : 'https://api-pay.line.me';
    const orderId = String(params.orderId || ('POS-LP-' + crypto.randomUUID().slice(0, 8))).trim();
    const res = await fetch(`${apiBase}/v2/payments/oneTimeKeys/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LINE-ChannelId': lpCfg.channelId,
        'X-LINE-ChannelSecret': lpCfg.channelSecret
      },
      body: JSON.stringify({
        productName: String(params.productSummary || `${BRAND_NAME} 櫃檯結帳`),
        amount,
        currency: 'TWD',
        orderId,
        oneTimeKey
      })
    });
    const lpData = await res.json().catch(() => ({}));
    if (!lpData || lpData.returnCode !== '0000') {
      throw new Error(`LINE Pay 條碼扣款失敗 (${lpData.returnCode || res.status}): ${lpData.returnMessage || ''}`);
    }
    const txId = String((lpData.info && lpData.info.transactionId) || ('LP-' + Date.now()));
    return { approved: true, linePayVerifiedMode: 'API_VERIFIED', returnCode: '0000', transactionId: txId, amount, storeId };
  }

  const manualOk = Boolean(params.manualVerified || params.manualConfirmed);
  const cleanRef = String(params.manualRefCode || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);
  if (!manualOk || cleanRef.length < 4) {
    throw new Error('請確認顧客已完成立牌掃碼付款並輸入至少 4 碼交易後碼');
  }
  return {
    approved: true,
    linePayVerifiedMode: 'MANUAL_CONFIRMED',
    returnCode: 'MANUAL',
    transactionId: 'LP-MAN-' + cleanRef.toUpperCase(),
    amount,
    storeId
  };
}

// ==================== 4. Gemini AI 智慧選餐與多模態菜單辨識 ====================

export async function handleAiConcierge(env, params = {}, initBundleFn) {
  const campus = String(params.campus || '雙溪校區').trim();
  const query = String(params.query || '').trim();
  const lang = String(params.lang || 'zh-TW').trim();
  const apiKey = String(env.GEMINI_API_KEY || '').trim();
  if (!apiKey || !query) return { aiResult: null };

  const bundle = await initBundleFn(env, {});
  const visibleStores = (bundle.stores || []).filter(s => s && s.visibleToStudents !== false && s.isOpen !== false);
  let targetStores = visibleStores.filter(s => s.campus === campus);
  if (targetStores.length === 0) targetStores = visibleStores;
  if (targetStores.length === 0) return { aiResult: null };

  const catalogSummary = targetStores.map(s => ({
    storeId: s.id,
    storeName: s.name,
    avgPrepMinutes: s.avgPrepMinutes,
    promoText: s.promoText,
    menus: (s.menus || []).filter(m => !m.soldOut).slice(0, 30).map(m => ({ id: m.id, name: m.name, price: m.price, category: m.category }))
  }));

  const prompt = `你是 ${BRAND_NAME} 校園餐廳 AI 選餐顧問。請根據顧客需求「${query}」與以下即時營業菜單，選出最適合的 1 道餐點，並用 ${lang} 回覆簡短推薦理由。
只回傳純 JSON：{"reasoning":"...","storeId":"...","menuId":"..."}
菜單資料：${JSON.stringify(catalogSummary)}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });
    if (!res.ok) return { aiResult: null };
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = safeJsonParse(rawText, null);
    if (!parsed || !parsed.storeId || !parsed.menuId) return { aiResult: null };

    const engineMap = {
      en: 'Gemini 2.5 Flash Cloud Advisor',
      ja: 'Gemini 2.5 Flash クラウド顧問',
      ko: 'Gemini 2.5 Flash 클라우드 추천',
      'zh-TW': 'Gemini 2.5 Flash 雲端智慧顧問'
    };
    return {
      aiResult: {
        reasoning: String(parsed.reasoning || ''),
        storeId: String(parsed.storeId),
        menuId: String(parsed.menuId),
        engine: engineMap[lang] || engineMap['zh-TW']
      }
    };
  } catch {
    return { aiResult: null };
  }
}

export async function handleAiParseMenu(env, params = {}) {
  const storeId = String(params.storeId || 'S02').trim();
  await assertManagerAuthorized(env, params, storeId);

  const rawText = String(params.rawText || '').trim();
  const imageBase64 = String(params.imageBase64 || '').trim();
  const imageMime = String(params.imageMime || 'image/jpeg').trim();
  const apiKey = String(env.GEMINI_API_KEY || '').trim();

  if (apiKey && (imageBase64 || rawText)) {
    try {
      const parts = [{
        text: `請將這份餐廳菜單辨識為 JSON 陣列，每筆包含 { "category": "分類名稱", "name": "菜名", "price": 整數價格, "tag": "🔥 新上市", "options": {} }。只回傳 JSON 陣列。${rawText ? '\n文字內容：\n' + rawText : ''}`
      }];
      if (imageBase64) {
        parts.push({ inlineData: { mimeType: imageMime, data: imageBase64.replace(/^data:[^;]+;base64,/, '') } });
      }
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const arr = safeJsonParse(txt, null);
        if (Array.isArray(arr) && arr.length > 0) {
          return {
            engine: 'Gemini 2.5 Flash 多模態視覺引擎',
            parsedMenus: arr.filter(it => it && it.name).map(it => ({
              id: generateStableMenuItemId(storeId, it.name, it.category || '主廚推薦'),
              category: String(it.category || '主廚推薦').trim(),
              name: String(it.name).trim(),
              price: Number(it.price) || 100,
              tag: String(it.tag || '🔥 新上市').trim(),
              options: (it.options && typeof it.options === 'object') ? it.options : {}
            }))
          };
        }
      }
    } catch {}
  }

  // 結構化語法解析備援（免 API Key 也可解析純文字菜單）
  const fallbackParsed = [];
  let currentCat = '掃描推薦';
  rawText.split(/\r?\n/).forEach(line => {
    const clean = line.trim();
    if (!clean) return;
    const catMatch = clean.match(/^[【\[](.+?)[】\]]$/);
    if (catMatch) {
      currentCat = catMatch[1].trim();
      return;
    }
    const itemMatch = clean.replace(/^[-*•\d.]+\s*/, '').match(/^(.+?)\s*[$＄]?\s*(\d{2,4})\s*(?:元)?/);
    if (itemMatch) {
      const name = itemMatch[1].trim();
      const price = parseInt(itemMatch[2], 10) || 100;
      if (name) {
        fallbackParsed.push({
          id: generateStableMenuItemId(storeId, name, currentCat),
          category: currentCat,
          name,
          price,
          tag: '🔥 新上市',
          options: {}
        });
      }
    }
  });

  return {
    engine: '雲端結構化語法解析引擎',
    parsedMenus: fallbackParsed
  };
}

// ==================== 5. 會員點數與常點紀錄 (members 表) ====================

export async function updateMemberStatsFromOrder(db, orderObj) {
  if (!db || !orderObj) return;
  const uid = String(orderObj.lineUserId || '').trim();
  if (!uid.startsWith('U')) return;

  const existing = await db.prepare('SELECT * FROM members WHERE line_user_id = ?').bind(uid).first();
  const earnedPoints = Math.max(1, Math.floor(Math.max(0, Number(orderObj.finalTotal) || 0) / 10));
  const nextPoints = (Number(existing && existing.points) || 0) + earnedPoints;
  const nextOrderCount = (Number(existing && existing.order_count) || 0) + 1;
  const nextName = String((existing && existing.display_name) || orderObj.customerName || '').trim();
  const nextPhone = String(orderObj.customerPhone || (existing && existing.phone) || '').trim();
  const nextTaxId = String(orderObj.taxId || (existing && existing.tax_id) || '').trim();

  const favMap = safeJsonParse(existing && existing.favorite_items_json, {});
  const items = Array.isArray(orderObj.structuredItems) ? orderObj.structuredItems : [];
  items.forEach(it => {
    if (!it || it.isGift) return;
    const mid = String(it.id || it.menuId || '');
    const nm = String(it.baseName || it.name || '').trim();
    if (!nm) return;
    const key = `${orderObj.storeId}::${mid || nm}`;
    if (!favMap[key]) favMap[key] = { storeId: orderObj.storeId, menuId: mid, name: nm, count: 0 };
    favMap[key].count += Math.max(1, Number(it.qty) || 1);
  });

  const topEntries = Object.entries(favMap)
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
    .slice(0, 20);
  const trimmedFav = Object.fromEntries(topEntries);

  await db.prepare(`
    INSERT INTO members (line_user_id, display_name, phone, tax_id, points, order_count, favorite_items_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (line_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      phone = excluded.phone,
      tax_id = excluded.tax_id,
      points = excluded.points,
      order_count = excluded.order_count,
      favorite_items_json = excluded.favorite_items_json,
      updated_at = excluded.updated_at
  `).bind(uid, nextName, nextPhone, nextTaxId, nextPoints, nextOrderCount, JSON.stringify(trimmedFav), new Date().toISOString()).run();
}

export async function handleGetMemberProfile(env, params = {}) {
  const uid = String(params.lineUserId || '').trim();
  if (!uid || !uid.startsWith('U')) {
    return { found: false, profile: null, favoriteDishes: [], memberOrders: [] };
  }

  const [row, ordRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM members WHERE line_user_id = ?').bind(uid).first(),
    env.DB.prepare(`
      SELECT * FROM orders
      WHERE line_user_id = ? AND status != '待付款 (LINE Pay 授權中)'
      ORDER BY created_at_ts DESC LIMIT 20
    `).bind(uid).all()
  ]);

  const found = Boolean(row);
  const favMap = safeJsonParse(row && row.favorite_items_json, {});
  const favoriteDishes = Object.values(favMap)
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, 6);

  const profile = {
    lineUserId: uid,
    displayName: String((row && row.display_name) || ''),
    phone: String((row && row.phone) || ''),
    taxId: String((row && row.tax_id) || ''),
    points: Number((row && row.points) || 0),
    orderCount: Number((row && row.order_count) || 0),
    updatedAt: String((row && row.updated_at) || '')
  };

  const memberOrders = (ordRes.results || []).map(r => sanitizeOrderForClientOutput(dbRowToOrderObject(r), false, true));
  return { found, profile, favoriteDishes, memberOrders };
}

export async function handleSaveMemberProfile(env, params = {}) {
  const uid = String(params.lineUserId || '').trim();
  if (!uid || !uid.startsWith('U')) throw new Error('無效的 LINE 會員識別碼');

  const existing = await env.DB.prepare('SELECT * FROM members WHERE line_user_id = ?').bind(uid).first();
  const displayName = params.displayName !== undefined ? String(params.displayName).trim().slice(0, 40) : String((existing && existing.display_name) || '');
  const phone = params.phone !== undefined ? String(params.phone).trim().slice(0, 20) : String((existing && existing.phone) || '');
  const taxId = params.taxId !== undefined ? String(params.taxId).trim().replace(/\D/g, '').slice(0, 8) : String((existing && existing.tax_id) || '');
  if (taxId && !validateTaiwanTaxId(taxId)) throw new Error('統一編號檢查碼驗證失敗');

  const points = Number((existing && existing.points) || 0);
  const orderCount = Number((existing && existing.order_count) || 0);
  const favJson = String((existing && existing.favorite_items_json) || '{}');
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO members (line_user_id, display_name, phone, tax_id, points, order_count, favorite_items_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (line_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      phone = excluded.phone,
      tax_id = excluded.tax_id,
      updated_at = excluded.updated_at
  `).bind(uid, displayName, phone, taxId, points, orderCount, favJson, updatedAt).run();

  return {
    saved: true,
    profile: { lineUserId: uid, displayName, phone, taxId, points, orderCount, updatedAt }
  };
}
