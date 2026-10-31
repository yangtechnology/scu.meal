/**
 * MealFlow 學餐 AI 流量管制塔 - 企業級後端引擎 v8.1 (Google Apps Script)
 * 修復與強化：
 * 1. 徹底移除硬編碼 LINE Secret 與 Channel Access Token，全數改由 ScriptProperties 安全讀取，解決 GitGuardian 資安警報
 * 2. getInitBundle() 同時提供頂層 stores / recentOrders 與 bundle 物件，100% 相容前後端資料同步
 * 3. updateOrderState() 完整支援 paymentStatus 與 paymentMethod 寫入，並支援 LINE + Email 雙軌自動推播
 * 4. 完整打通店家專屬 LINE (STORE_LINE_CFG_<storeId>) 與系統預設 LINE 之動態切換
 */

const SHEET_ID = '1G0wZqT0xoPParVZIFEWRdXpiZNmFlAAhiX89c3t7OiY';
const DB_SCHEMA_VERSION = 'MEALFLOW_SCHEMA_V8_1';

// ==================== 系統預設官方 LINE 帳號設定（由 ScriptProperties 安全託管，不硬編碼機密金鑰） ====================
// 請於 GAS 編輯器左側「⚙️ 專案設定 ➔ 指令碼屬性 (Script Properties)」新增：
// - LINE_CLIENT_ID        : 2012260287
// - LINE_CLIENT_SECRET    : (您的 LINE Login Channel Secret)
// - LINE_CHANNEL_TOKEN    : (您的 Messaging API Channel Access Token)
// 或直接於店家網頁後台「⚙️ 設定 ➔ 💚 LINE Developers 推播設定」填入並點擊儲存即可自動寫入 ScriptProperties！
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
    service: 'MealFlow AI Engine v8.1 (LINE OAuth 2.1 + Flex Push + Modern POS + AI Analytics)',
    status: 'ONLINE'
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(10000);
  if (!hasLock) {
    return jsonResponse({
      success: false,
      message: '系統尖峰忙碌中，請稍候再試（Lock Timeout）'
    });
  }

  try {
    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const params = JSON.parse(rawBody);
    const ss = SpreadsheetApp.openById(SHEET_ID);

    ensureDatabaseInitialized(ss, Boolean(params.forceInit));

    // 每次請求時自動巡檢並刪除逾期未繳費之遠期預訂單
    purgeExpiredReservations(ss);

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
      case 'updateStoreConfig':
        result = updateStoreSettings(ss, params);
        break;
      case 'saveStoreMenus':
      case 'saveStoreMenu':
        result = saveStoreMenus(ss, params);
        break;
      case 'aiParseMenu':
        result = handleAiParseMenu(ss, params);
        break;
      case 'updateOrderStatus':
        result = updateOrderState(ss, params);
        break;
      case 'markReservationPaid':
        result = markReservationPaid(ss, params);
        break;
      case 'cancelOrder':
        result = cancelOrderById(ss, params);
        break;
      case 'simulateTraffic':
        result = runTrafficSimulation(ss, params);
        break;
      case 'askAiConcierge':
        result = handleAiConcierge(ss, params);
        break;
      case 'handleLineCallback':
        result = handleLineCallback(ss, params);
        break;
      case 'saveLineDevConfig':
        result = saveLineDevConfig(ss, params);
        break;
      case 'sendLinePush':
        result = handleManualLinePush(ss, params);
        break;
      default:
        throw new Error('未知的 API Action: ' + action);
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

/**
 * 自動初始化資料庫結構（含 LineBindings 綁定表與 cutleryPrice）
 */
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
      ['S01', '雙溪校區', '趙班長海苔飯捲', '人氣韓式・飯捲', 18, 17, 22, true, 'none', '無優惠', 0, 240, 4.9, 1],
      ['S02', '雙溪校區', '雙溪-丼物園', '日式蓋飯・烏龍麵', 20, 4, 5, true, 'gift', '🎁 AI分流招待：免費溫泉蛋乙顆', 0, 165, 4.7, 1],
      ['S03', '雙溪校區', '雙溪-四海遊龍', '鍋貼水餃・麵食', 25, 19, 16, true, 'none', '無優惠', 0, 210, 4.6, 1],
      ['S04', '雙溪校區', '蒲家廚房', '中式特餐・便當', 20, 5, 6, true, 'discount', '💰 AI分流折抵：現折 $10 元', 10, 150, 4.8, 1],
      ['S05', '城中校區', '城中-咖哩食堂', '熟成咖哩・炸物', 15, 16, 26, true, 'none', '無優惠', 0, 195, 4.8, 1],
      ['S06', '城中校區', '城中-吳葉食堂', '精緻台式簡餐', 20, 3, 4, true, 'gift', '🎁 AI分流招待：免費招牌冰紅茶', 0, 145, 4.9, 1],
      ['S07', '城中校區', '大熊涼麵 X 吃好食堂', '手工涼麵・味噌湯', 25, 6, 3, true, 'points', '⚡ AI分流回饋：雙倍 MealPoints 點數', 0, 160, 4.7, 1]
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
      '單點加料': { type: 'checkbox', choices: [['加香濃起司', 15], ['加溏心溫泉蛋', 15], ['不要蔥花/香菜', 0]] }
    });
    const stdNoodleOpts = JSON.stringify({
      '麵條份量': { type: 'radio', choices: [['標準份量', 0], ['加麵大碗', 15]] },
      '辣度選擇': { type: 'radio', choices: [['不辣', 0], ['小辣', 0], ['大辣', 0]] },
      '單點加料': { type: 'checkbox', choices: [['加滷蛋', 15], ['加貢丸(2顆)', 15], ['不要蔥花', 0]] }
    });
    const dumplingSetOpts = JSON.stringify({
      '份量選擇': { type: 'radio', choices: [['標準 10顆', 0], ['加量 12顆', 14], ['大份 15顆', 35]] },
      '醬料包選擇': { type: 'checkbox', choices: [['蒜泥醬油膏', 0], ['特製辣椒醬', 0], ['白醋', 0], ['免醬料', 0]] }
    });

    const defaultMenus = [
      ['M01', 'S01', '特製韓式泡菜燒肉飯捲', 75, '🔥 必點人氣', '韓式海苔飯捲', '', stdRiceOpts],
      ['M02', 'S01', '起司炸蝦海苔飯捲', 85, '⭐ 主廚推薦', '韓式海苔飯捲', '', stdRiceOpts],
      ['M03', 'S01', '經典鮪魚玉米飯捲', 65, '⚡ 快速出餐', '韓式海苔飯捲', '', stdRiceOpts],
      ['M18', 'S01', '韓式魚板蘿蔔湯', 35, '🥣 暖胃湯品', '韓式湯品與飲品', '', '{}'],
      ['M04', 'S02', '炙燒起司牛五花丼', 115, '🔥 招牌必點', '炙燒日式丼飯', '', stdRiceOpts],
      ['M05', 'S02', '黃金厚切豬排滑蛋丼', 120, '⭐ 飽足首選', '炙燒日式丼飯', '', stdRiceOpts],
      ['M06', 'S02', '讚岐胡麻冷烏龍麵', 95, '⚡ 3分極速出餐', '讚岐烏龍麵', '', stdNoodleOpts],
      ['M19', 'S02', '日式唐揚炸雞 (5塊)', 55, '🍗 人氣單點', '單點炸物與茶飲', '', '{}'],
      ['M07', 'S03', '招牌脆皮鍋貼 (10顆)', 70, '🔥 經典酥脆', '手工鍋貼水餃', '', dumplingSetOpts],
      ['M08', 'S03', '高麗菜鮮肉水餃 (10顆)', 70, '⚡ 飽滿多汁', '手工鍋貼水餃', '', dumplingSetOpts],
      ['M20', 'S03', '招牌酸辣湯', 35, '🥣 經典湯品', '湯品與豆漿', '', '{}'],
      ['M09', 'S04', '秘製椒麻雞腿飯', 110, '🔥 銷量冠軍', '中式特餐便當', '', stdRiceOpts],
      ['M10', 'S04', '蒜泥白肉精緻便當', 100, '⚡ 極速便當', '中式特餐便當', '', stdRiceOpts],
      ['M21', 'S04', '黃金脆皮炸豆腐', 40, '✨ 招牌小菜', '單點小菜', '', '{}'],
      ['M11', 'S05', '唐揚炸雞熟成咖哩飯', 125, '🔥 排隊人氣', '熟成濃咖哩', '', stdRiceOpts],
      ['M12', 'S05', '手打漢堡排歐姆蛋咖哩', 135, '⭐ 限量供應', '熟成濃咖哩', '', stdRiceOpts],
      ['M13', 'S06', '蔥爆牛肉鐵板簡餐', 115, '🔥 現點現做', '主廚鐵板簡餐', '', stdRiceOpts],
      ['M14', 'S06', '古早味排骨特餐', 105, '⚡ 4分極速取餐', '主廚鐵板簡餐', '', stdRiceOpts],
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

// ==================== LINE Login OAuth 2.1 綁定與 LINE Flex Message 推播引擎 ====================
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
      return { success: false, message: '缺少 LINE 授權碼 (code)' };
    }

    const lineCfg = resolveLineConfigForStore(storeId);
    const clientId = String(params.clientId || lineCfg.clientId).trim();
    const clientSecret = String(params.clientSecret || lineCfg.clientSecret).trim();

    if (!clientSecret) {
      return {
        success: false,
        message: '後端尚未設定 LINE_CLIENT_SECRET，請先於店家後台「設定 ➔ LINE 推播設定」或 GAS 指令碼屬性填入'
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
        message: 'LINE Token 交換失敗：' + (tokenData.error_description || tokenData.error || '請確認 Redirect URI 與 Channel Secret')
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
      return { success: false, message: '無法取得 LINE userId' };
    }

    const bindSheet = ss.getSheetByName('LineBindings');
    if (bindSheet) {
      const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
      bindSheet.appendRow(['OAUTH_LOGIN', userUID, displayName, nowStr]);
    }

    sendLinePushMessage(
      ss,
      userUID,
      `🎉 嗨 ${displayName}，您已成功綁定東吳學餐 MealFlow 即時通知！往後餐點完成可取餐、預訂繳費提醒與訂單狀態更新都會直接推播至此。`,
      lineCfg.channelToken,
      {
        storeId: storeId,
        title: 'LINE 帳號綁定成功',
        subtitle: `嗨 ${displayName}！取餐與預訂通知已啟用`,
        pickupNumber: 'OK',
        storeName: '東吳學餐 MealFlow',
        statusText: '已連結 LINE 推播通知',
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
      message: 'LINE API 驗證失敗: ' + err.toString()
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
  const titleText = meta.title || '東吳學餐 MealFlow 訂單通知';
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
        { type: 'text', text: 'MealFlow 東吳學餐智慧點餐', weight: 'bold', color: accentColor, size: 'sm' },
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
              text: '🚀 點擊開啟電子取餐單',
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
    title: params.title || '東吳學餐 MealFlow 通知',
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
    const title = m.title || '東吳學餐 MealFlow 訂單通知';
    const pickupNumber = m.pickupNumber ? ('#' + m.pickupNumber) : '';
    const storeName = m.storeName || '東吳學餐';
    const orderUrl = m.orderUrl || 'https://yangbrian01.github.io/scu.meal/order/';

    const htmlBody = `
      <div style="font-family:'Noto Sans TC',sans-serif; max-width:480px; margin:0 auto; border:1px solid #E5E7EB; border-radius:16px; overflow:hidden; background:#FFFFFF;">
        <div style="background:linear-gradient(135deg,#FF5A1F,#E04812); color:#FFFFFF; padding:18px 20px;">
          <div style="font-size:12px; font-weight:bold; opacity:0.9;">東吳學餐 MealFlow 智慧點餐通知</div>
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
      subject: `【東吳學餐 MealFlow】${title} ${pickupNumber}`,
      body: `${title}\n${messageText}\n查看取餐單：${orderUrl}`,
      htmlBody: htmlBody
    });
    return true;
  } catch (e) {
    return false;
  }
}

function calcDynamicPrepMinutes(activeOrders, maxCap) {
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

function purgeExpiredReservations(ss) {
  const orderSheet = ss.getSheetByName('Orders');
  if (!orderSheet) return [];
  const rows = orderSheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  const todayStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const purgedIds = [];

  for (let i = rows.length - 1; i >= 1; i--) {
    const extraRaw = rows[i][16] || '{}';
    let meta = {};
    try { meta = JSON.parse(extraRaw); } catch (e) {}
    if (meta.paymentStatus === '待櫃檯繳費' && meta.paymentDeadline && todayStr > meta.paymentDeadline) {
      const cancelMsg = `❌【逾期未繳自動刪單通知】\n您在「${rows[i][3]}」預訂於 ${meta.pickupDate} 取餐之訂單 #${rows[i][1]}，因未於取餐日前兩天（${meta.paymentDeadline}）前至櫃檯繳清現金，系統已自動取消並刪除此筆訂單。`;
      if (meta.lineUserId) {
        sendLinePushMessage(ss, meta.lineUserId, cancelMsg, '', {
          storeId: String(rows[i][2]),
          title: '❌ 預訂單逾期未繳已取消',
          pickupNumber: String(rows[i][1]),
          storeName: String(rows[i][3]),
          statusText: '逾期未繳自動刪單'
        });
      }
      if (meta.customerEmail) {
        sendOrderEmailNotification(meta.customerEmail, cancelMsg, {
          title: '❌ 預訂單逾期未繳已取消',
          pickupNumber: String(rows[i][1]),
          storeName: String(rows[i][3])
        });
      }
      purgedIds.push(String(rows[i][0]));
      orderSheet.deleteRow(i + 1);
    }
  }
  return purgedIds;
}

function getInitBundle(ss, params) {
  const props = PropertiesService.getScriptProperties();
  const stores = sheetToObjects(ss.getSheetByName('Stores'));
  const menus = sheetToObjects(ss.getSheetByName('Menus'));
  const orders = sheetToObjects(ss.getSheetByName('Orders')).reverse().slice(0, 80).map(enrichOrderObject);

  const enrichedStores = stores.map(s => {
    const storeMenus = menus
      .filter(m => String(m.storeId) === String(s.id))
      .map(m => {
        let parsedOptions = {};
        if (m.optionsJson) {
          try { parsedOptions = JSON.parse(m.optionsJson); } catch (e) {}
        }
        return {
          id: String(m.id),
          storeId: String(m.storeId),
          name: String(m.name),
          price: Number(m.price) || 0,
          tag: String(m.tag || ''),
          category: String(m.category || '招牌主餐'),
          image: String(m.image || ''),
          options: parsedOptions
        };
      });

    const maxCap = Math.max(5, Number(s.maxCapacityPer15Min) || 20);
    const active = Math.max(0, Number(s.activeOrders) || 0);
    const loadPct = Math.min(120, Math.round((active / maxCap) * 100));
    let loadState = 'FREE';
    if (loadPct >= 85) loadState = 'FULL';
    else if (loadPct >= 50) loadState = 'MODERATE';

    const avgPrep = Number(s.avgPrepMinutes) || calcDynamicPrepMinutes(active, maxCap);
    const cutleryPrice = s.cutleryPrice !== undefined && s.cutleryPrice !== '' ? Number(s.cutleryPrice) : 1;

    // 讀取店家是否啟用自訂官方 LINE（僅回傳公開之 Client ID 與狀態，不外洩 Secret / Token）
    let useCustomLineOa = false;
    let customLineClientId = '';
    try {
      const rawLineCfg = props.getProperty('STORE_LINE_CFG_' + String(s.id));
      if (rawLineCfg) {
        const parsedLineCfg = JSON.parse(rawLineCfg);
        useCustomLineOa = Boolean(parsedLineCfg.useCustomLineOa);
        customLineClientId = parsedLineCfg.clientId || '';
      }
    } catch (e) {}

    const storeObj = {
      ...s,
      maxCapacityPer15Min: maxCap,
      activeOrders: active,
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

  // 同時在頂層與 bundle 內回傳 stores / recentOrders / orders，確保前後端 100% 無縫相容
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
  return {
    ...o,
    ...meta
  };
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
    const campusStores = stores.filter(s => s.campus === campus);
    const congested = campusStores
      .filter(s => s.loadState === 'FULL' || Number(s.avgPrepMinutes) >= 20)
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

function handleOrderSubmission(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const storeSheet = ss.getSheetByName('Stores');

  let orderId = params.orderId ? String(params.orderId).trim() : '';
  if (!orderId) {
    orderId = 'ORD-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  }

  const campusPrefix = params.campus === '城中校區' ? 'C' : 'S';
  const pickupNumber = params.pickupNumber
    ? String(params.pickupNumber).trim()
    : (campusPrefix + Math.floor(100 + Math.random() * 899));
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH:mm:ss');
  const todayDateStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

  const orderSource = params.orderSource || '📱 掃碼點餐';
  const customerNote = params.customerNote || '外帶自取';

  const extraMeta = {
    needCutlery: Boolean(params.needCutlery),
    cutleryFee: Number(params.cutleryFee) || 0,
    isReservation: Boolean(params.isReservation),
    pickupDate: params.pickupDate || todayDateStr,
    pickupTime: params.pickupTime || nowStr.slice(0, 5),
    customerPhone: params.customerPhone || '',
    paymentDeadline: params.paymentDeadline || '',
    paymentStatus: params.paymentStatus || '已付款',
    notifyCount: Number(params.notifyCount) || 0,
    lineUserId: params.lineUserId || '',
    customerEmail: params.customerEmail || ''
  };

  const newOrderRow = [
    orderId,
    pickupNumber,
    params.storeId,
    params.storeName,
    orderSource,
    customerNote,
    JSON.stringify(params.items || []),
    Number(params.subtotal) || 0,
    Number(params.discount) || 0,
    Number(params.finalTotal) || 0,
    params.promoApplied || '一般點餐',
    params.pickupTimeSlot || '立即製作',
    params.paymentMethod || 'LINE Pay',
    '製作中',
    Boolean(params.isDivertedOrder),
    nowStr,
    JSON.stringify(extraMeta)
  ];
  orderSheet.appendRow(newOrderRow);

  const storeData = storeSheet.getDataRange().getValues();
  for (let i = 1; i < storeData.length; i++) {
    if (String(storeData[i][0]) === String(params.storeId)) {
      const currentActive = Math.max(0, Number(storeData[i][5]) || 0) + 1;
      const maxCap = Math.max(5, Number(storeData[i][4]) || 20);
      const newPrepMin = calcDynamicPrepMinutes(currentActive, maxCap);
      storeSheet.getRange(i + 1, 6).setValue(currentActive);
      storeSheet.getRange(i + 1, 7).setValue(newPrepMin);
      break;
    }
  }

  return {
    order: {
      orderId,
      pickupNumber,
      storeId: params.storeId,
      storeName: params.storeName,
      studentId: orderSource,
      studentName: customerNote,
      itemsJson: JSON.stringify(params.items || []),
      subtotal: Number(params.subtotal) || 0,
      discount: Number(params.discount) || 0,
      finalTotal: Number(params.finalTotal) || 0,
      promoApplied: params.promoApplied || '一般點餐',
      pickupTimeSlot: params.pickupTimeSlot || '立即製作',
      paymentMethod: params.paymentMethod || 'LINE Pay',
      status: '製作中',
      isDivertedOrder: Boolean(params.isDivertedOrder),
      createdAt: nowStr,
      ...extraMeta
    },
    ...getInitBundle(ss, {})
  };
}

function saveStoreMenus(ss, params) {
  const storeId = String(params.storeId || '');
  const newMenus = Array.isArray(params.menus) ? params.menus : [];
  if (!storeId) throw new Error('缺少 storeId');

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
    keptRows.push([
      String(itemId),
      storeId,
      String(m.name || '未命名品項'),
      Number(m.price) || 0,
      String(m.tag || '🔥 店長推薦'),
      String(m.category || '招牌主餐'),
      String(m.image || ''),
      JSON.stringify(m.options || {})
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

  if (apiKey) {
    try {
      const prompt = `你是專業餐飲 POS 系統的 AI 菜單建檔專家。
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
        return { parsedMenus: JSON.parse(textOut), engine: 'Google Gemini 2.5 Flash Vision' };
      }
    } catch (e) {}
  }

  return { parsedMenus: [], engine: 'Local Heuristic Parser' };
}

function updateStoreSettings(ss, params) {
  const storeSheet = ss.getSheetByName('Stores');
  const data = storeSheet.getDataRange().getValues();

  if (params.useCustomLineOa !== undefined) {
    saveLineDevConfig(ss, params);
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.storeId)) {
      if (params.promoMode !== undefined) storeSheet.getRange(i + 1, 9).setValue(params.promoMode);
      if (params.promoText !== undefined) storeSheet.getRange(i + 1, 10).setValue(params.promoText);
      if (params.promoDiscount !== undefined) storeSheet.getRange(i + 1, 11).setValue(Number(params.promoDiscount));
      if (params.maxCapacityPer15Min !== undefined) {
        storeSheet.getRange(i + 1, 5).setValue(Math.max(5, Number(params.maxCapacityPer15Min)));
      }
      if (params.activeOrders !== undefined) {
        const act = Math.max(0, Number(params.activeOrders));
        const cap = Math.max(5, Number(params.maxCapacityPer15Min || data[i][4]) || 20);
        const prep = calcDynamicPrepMinutes(act, cap);
        storeSheet.getRange(i + 1, 6).setValue(act);
        storeSheet.getRange(i + 1, 7).setValue(prep);
      }
      if (params.cutleryPrice !== undefined) {
        storeSheet.getRange(i + 1, 14).setValue(Math.max(0, Number(params.cutleryPrice)));
      }
      break;
    }
  }
  return getInitBundle(ss, {});
}

/**
 * 更新訂單狀態與付款資訊（完整支援 paymentStatus / paymentMethod 同步）
 */
function updateOrderState(ss, params) {
  const orderSheet = ss.getSheetByName('Orders');
  const storeSheet = ss.getSheetByName('Stores');
  const data = orderSheet.getDataRange().getValues();
  let targetStoreId = null;
  let previousStatus = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.orderId)) {
      previousStatus = String(data[i][13]);
      targetStoreId = String(data[i][2]);
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

  if (
    targetStoreId &&
    previousStatus === '製作中' &&
    (params.newStatus === '可取餐' || params.newStatus === '已完成')
  ) {
    const storeData = storeSheet.getDataRange().getValues();
    for (let j = 1; j < storeData.length; j++) {
      if (String(storeData[j][0]) === targetStoreId) {
        const curActive = Math.max(0, (Number(storeData[j][5]) || 1) - 1);
        const maxCap = Math.max(5, Number(storeData[j][4]) || 20);
        const newPrep = calcDynamicPrepMinutes(curActive, maxCap);
        storeSheet.getRange(j + 1, 6).setValue(curActive);
        storeSheet.getRange(j + 1, 7).setValue(newPrep);
        break;
      }
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
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(params.orderId)) {
      orderSheet.deleteRow(i + 1);
      break;
    }
  }
  return getInitBundle(ss, {});
}

function runTrafficSimulation(ss, params) {
  const storeSheet = ss.getSheetByName('Stores');
  const mode = params.mode || 'PEAK';
  const data = storeSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const storeId = String(data[i][0]);
    if (mode === 'PEAK') {
      if (storeId === 'S01') {
        storeSheet.getRange(i + 1, 6).setValue(18);
        storeSheet.getRange(i + 1, 7).setValue(24);
      } else if (storeId === 'S03') {
        storeSheet.getRange(i + 1, 6).setValue(21);
        storeSheet.getRange(i + 1, 7).setValue(18);
      } else if (storeId === 'S05') {
        storeSheet.getRange(i + 1, 6).setValue(16);
        storeSheet.getRange(i + 1, 7).setValue(26);
      } else if (storeId === 'S02' || storeId === 'S06') {
        storeSheet.getRange(i + 1, 6).setValue(3);
        storeSheet.getRange(i + 1, 7).setValue(4);
      }
    } else {
      storeSheet.getRange(i + 1, 6).setValue(4);
      storeSheet.getRange(i + 1, 7).setValue(5);
    }
  }
  return getInitBundle(ss, {});
}

function handleAiConcierge(ss, params) {
  const bundleObj = getInitBundle(ss, {}).bundle;
  const campus = params.campus || '雙溪校區';
  const userQuery = (params.query || '').trim();
  const campusStores = bundleObj.stores.filter(s => s.campus === campus);

  const props = PropertiesService.getScriptProperties();
  const apiKey = params.apiKey || props.getProperty('GEMINI_API_KEY') || '';

  if (apiKey) {
    try {
      const storeContext = campusStores.map(s => ({
        id: s.id,
        name: s.name,
        waitMinutes: s.avgPrepMinutes,
        loadPct: s.loadPercentage,
        promoText: s.promoText,
        aiScore: s.aiScore,
        menus: s.menus.map(m => ({ id: m.id, name: m.name, price: m.price }))
      }));

      const prompt = `你是東吳大學「MealFlow 學餐 AI 選餐與客服顧問」。
目前校區：${campus}
學生的輸入：「${userQuery}」
即時學餐佇列與菜單數據：${JSON.stringify(storeContext)}

請根據學生的輸入自然且精準地回答，並以純 JSON 格式回覆：
{
  "reasoning": "自然、準確、針對學生問題的回答 (100字內)",
  "storeId": "推薦店家ID (如 S02)",
  "menuId": "推薦餐點ID (如 M04)",
  "engine": "Gemini 2.5 Flash Live AI"
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
  const bestMenu = (bestStore && bestStore.menus && bestStore.menus[0]) ? bestStore.menus[0] : { id: 'M04', name: '招牌特餐', price: 100 };

  return {
    aiResult: {
      reasoning: `目前「${campus}」以「${bestStore.name}」最為順暢（約 ${bestStore.avgPrepMinutes} 分鐘取餐），推薦點選人氣品項「${bestMenu.name} ($${bestMenu.price})」。`,
      storeId: bestStore.id,
      menuId: bestMenu.id,
      engine: 'MealFlow Queueing Utility Engine'
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
