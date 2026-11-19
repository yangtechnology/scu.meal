// =========================================================================
// MealFlow v23.0 — 店家 POS / KDS / 財務日結 / 設定 / 硬體出單模組 (四-2 模組拆分)
// 僅於 /store/ 頁面載入（或根目錄切入店務模式時動態載入），學生點餐端不下載此模組
// =========================================================================

// ==================== 二-2 真實熱感應出單機 ESC/POS 靜默直印與錢箱彈開引擎 (WebUSB / WebSerial + 分站派單) ====================
var MerchantHardwarePrinter = {
  routes: {
    COUNTER: { label: '櫃檯收據與錢箱機', device: null, port: null, transport: '', endpointOut: 1 },
    KITCHEN: { label: '廚房熱菜工單機', device: null, port: null, transport: '', endpointOut: 1 },
    DRINK: { label: '飲料/貼紙機', device: null, port: null, transport: '', endpointOut: 1 }
  },

  isConnected(routeKey = 'COUNTER') {
    const r = this.routes[routeKey];
    return Boolean(r && (r.device || r.port));
  },

  getStatusSummary(routeKey = 'COUNTER') {
    const r = this.routes[routeKey];
    if (!r) return '未連線';
    if (r.device) return `🟢 WebUSB (${r.device.productName || 'ESC/POS'})`;
    if (r.port) return `🟢 WebSerial (已連線)`;
    return '⚪ 未配對（降級為瀏覽器列印）';
  },

  async connect(routeKey = 'COUNTER', transport = 'usb') {
    const r = this.routes[routeKey];
    if (!r) return false;
    try {
      if (transport === 'serial') {
        if (!('serial' in navigator)) {
          showToast('⚠️ 此瀏覽器不支援 WebSerial（請使用桌面版或平板 Chrome / Edge）');
          return false;
        }
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        r.port = port;
        r.device = null;
        r.transport = 'serial';
        showToast(`✅ 已透過 WebSerial 連接「${r.label}」`);
        return true;
      }
      if (!('usb' in navigator)) {
        showToast('⚠️ 此瀏覽器不支援 WebUSB（請使用 Chrome / Edge，或改用 WebSerial）');
        return false;
      }
      const device = await navigator.usb.requestDevice({ filters: [] });
      await device.open();
      if (device.configuration === null) await device.selectConfiguration(1);
      const iface = device.configuration.interfaces[0];
      await device.claimInterface(iface.interfaceNumber);
      const outEp = (iface.alternate.endpoints || []).find(ep => ep.direction === 'out');
      r.device = device;
      r.port = null;
      r.transport = 'usb';
      r.endpointOut = outEp ? outEp.endpointNumber : 1;
      showToast(`✅ 已透過 WebUSB 連接「${r.label}」(${device.productName || '熱感印表機'})`);
      return true;
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        showToast(`⚠️ 印表機連線失敗：${err.message || err}`);
      }
      return false;
    }
  },

  async sendBytes(routeKey, uint8Data) {
    const r = this.routes[routeKey] || this.routes.COUNTER;
    if (!r || (!r.device && !r.port)) return false;
    try {
      if (r.transport === 'usb' && r.device) {
        await r.device.transferOut(r.endpointOut || 1, uint8Data);
        return true;
      }
      if (r.transport === 'serial' && r.port && r.port.writable) {
        const writer = r.port.writable.getWriter();
        try {
          await writer.write(uint8Data);
        } finally {
          writer.releaseLock();
        }
        return true;
      }
    } catch (e) {
      showToast(`⚠️ 硬體出單傳輸異常：${e.message || e}`);
    }
    return false;
  },

  buildEscPosTicketBytes(order, ticketKind = 'COUNTER', kickDrawer = false) {
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    const chunks = [];
    const pushRaw = (arr) => chunks.push(new Uint8Array(arr));
    const pushLine = (str) => {
      const txt = String(str || '') + '\n';
      if (encoder) chunks.push(encoder.encode(txt));
      else {
        const b = new Uint8Array(txt.length);
        for (let i = 0; i < txt.length; i++) b[i] = txt.charCodeAt(i) & 0x7f;
        chunks.push(b);
      }
    };

    pushRaw([0x1B, 0x40]); // ESC @ 初始化印表機
    if (kickDrawer) {
      pushRaw([0x1B, 0x70, 0x00, 0x19, 0xFA]); // ESC p 0 25 250 彈開現金錢箱
    }
    pushRaw([0x1B, 0x61, 0x01]); // 置中對齊
    pushRaw([0x1D, 0x21, 0x11]); // 2x 放大字體
    pushLine(`#${order.pickupNumber || 'A001'}`);
    pushRaw([0x1D, 0x21, 0x00]); // 恢復一般字體
    pushLine(`${order.storeName || 'MealFlow'} [${ticketKind === 'KITCHEN' ? 'KITCHEN' : ticketKind === 'DRINK' ? 'DRINK' : 'RECEIPT'}]`);
    pushLine(`${order.dineType || '取餐'}${order.tableNumber ? ' | Table: ' + order.tableNumber : ''}`);
    pushRaw([0x1B, 0x61, 0x00]); // 靠左對齊
    pushLine('--------------------------------');
    const items = Array.isArray(order.structuredItems) ? order.structuredItems : [];
    items.forEach(it => {
      const lineTitle = `${it.baseName || it.name} x${it.qty || 1}`;
      const linePrice = ticketKind === 'COUNTER' ? `  $${(Number(it.price) || 0) * (Number(it.qty) || 1)}` : '';
      pushLine(lineTitle + linePrice);
      const sels = it.selections && Object.keys(it.selections).length > 0 ? Object.values(it.selections).join(' / ') : '';
      if (sels) pushLine(`  (${sels})`);
      if (it.itemNote) pushLine(`  NOTE: ${it.itemNote}`);
    });
    pushLine('--------------------------------');
    if (ticketKind === 'COUNTER') {
      pushLine(`TOTAL: NT$ ${order.finalTotal || 0} (${order.paymentMethod || 'CASH'})`);
      if (order.carrierCode) pushLine(`CARRIER: ${order.carrierCode}`);
      if (order.verificationCode) pushLine(`VERIFY CODE: ${order.verificationCode}`);
    }
    pushLine(`TIME: ${order.pickupDate || ''} ${order.createdAt || ''}`);
    pushLine('\n\n\n');
    pushRaw([0x1D, 0x56, 0x42, 0x00]); // GS V 66 0 局部自動切紙

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(totalLen);
    let offset = 0;
    chunks.forEach(c => { out.set(c, offset); offset += c.length; });
    return out;
  },

  async kickCashDrawer() {
    const kickBytes = new Uint8Array([0x1B, 0x40, 0x1B, 0x70, 0x00, 0x19, 0xFA]);
    return this.sendBytes('COUNTER', kickBytes);
  },

  async printOrderByStationRoutes(order, openDrawerIfCash = false) {
    let anyPrinted = false;
    const isCash = String(order.paymentMethod || '').includes('現金') || Boolean(order.paymentSplit && Number(order.paymentSplit.cash) > 0);
    if (this.isConnected('COUNTER')) {
      const bytes = this.buildEscPosTicketBytes(order, 'COUNTER', openDrawerIfCash && isCash);
      if (await this.sendBytes('COUNTER', bytes)) anyPrinted = true;
    }
    const store = state.stores.find(s => s.id === order.storeId);
    const items = Array.isArray(order.structuredItems) ? order.structuredItems : [];
    const kitchenItems = items.filter(it => classifyItemKitchenStation(it, store) !== 'DRINK');
    const drinkItems = items.filter(it => classifyItemKitchenStation(it, store) === 'DRINK');

    if (kitchenItems.length > 0 && this.isConnected('KITCHEN')) {
      const kBytes = this.buildEscPosTicketBytes({ ...order, structuredItems: kitchenItems }, 'KITCHEN', false);
      if (await this.sendBytes('KITCHEN', kBytes)) anyPrinted = true;
    }
    if (drinkItems.length > 0 && this.isConnected('DRINK')) {
      const dBytes = this.buildEscPosTicketBytes({ ...order, structuredItems: drinkItems }, 'DRINK', false);
      if (await this.sendBytes('DRINK', dBytes)) anyPrinted = true;
    }
    return anyPrinted;
  }
};

async function triggerHardwareCashDrawerKick() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const ok = await MerchantHardwarePrinter.kickCashDrawer();
  recordMerchantAuditLog('手動開啟錢箱 (Cash Drawer)', ok ? 'ESC/POS 指令已觸發開箱' : '尚未連接硬體錢箱（僅記錄手動開箱動作）');
  if (ok) {
    showToast('💵 已送出 ESC/POS 開錢箱脈衝指令！');
  } else {
    showToast('ℹ️ 尚未配對 WebUSB / WebSerial 出單機（可至「設定 → 推播與硬體出單」連線後啟用一鍵開錢箱）');
  }
}

async function connectHardwarePrinterUi(routeKey, transport) {
  const ok = await MerchantHardwarePrinter.connect(routeKey, transport);
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (ok && store) renderMerchantSettingsPanel(store);
}

async function testHardwarePrinterUi(routeKey) {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || { name: 'MealFlow POS' };
  const sampleOrder = {
    pickupNumber: 'A001',
    storeName: store.name,
    dineType: '測試出單',
    finalTotal: 100,
    paymentMethod: '現場現金',
    verificationCode: 'TEST88',
    pickupDate: getTodayDateStr(),
    createdAt: getTaipeiTimeHHMMSS(),
    structuredItems: [{ baseName: 'ESC/POS 靜默出單測試品項', qty: 1, price: 100 }]
  };
  const bytes = MerchantHardwarePrinter.buildEscPosTicketBytes(sampleOrder, routeKey, routeKey === 'COUNTER');
  const ok = await MerchantHardwarePrinter.sendBytes(routeKey, bytes);
  if (ok) showToast(`✅ 「${MerchantHardwarePrinter.routes[routeKey].label}」靜默測試單列印指令已送出！`);
  else showToast('⚠️ 請先點擊 WebUSB 或 WebSerial 配對該站點出單機');
}

// ==================== 6. 店家端營運管理系統 (`/store/` 嚴格權限與範圍守門) ====================
async function switchStoreTabMode(mode) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  // 二-1：一般收銀員 (STAFF) 欲進入財務營運分析或後台設定前，須經店長 PIN 現場覆核
  if ((mode === 'analytics' || mode === 'settings') && !isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride(mode === 'analytics' ? '檢視財務損益分析報表' : '進入店家核心設定中心');
    if (!mgrAuth) return;
    state.tempManagerOverridePin = mgrAuth.managerOverridePin;
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
  const isSingleTerminalLocked = Boolean(state.boundMerchantStoreId || state.urlLockedStoreId || state.merchantAuthorizedStoreScope === store.id);
  let nameplateEl = document.getElementById('storeTerminalNameplate');
  const roleTagStr = isCurrentMerchantManager()
    ? `👑 ${escapeHtml(state.merchantStaffName || '店長')}`
    : `👤 ${escapeHtml(state.merchantStaffName || '收銀員')}`;

  if (topSel) {
    if (isSingleTerminalLocked) {
      topSel.style.display = 'none';
      if (!nameplateEl) {
        topSel.insertAdjacentHTML('afterend', `<span id="storeTerminalNameplate" class="store-terminal-nameplate"></span>`);
        nameplateEl = document.getElementById('storeTerminalNameplate');
      }
      if (nameplateEl) {
        nameplateEl.style.display = 'inline-flex';
        nameplateEl.innerHTML = `<span>🏪 ${escapeHtml(trTerm(store.name))}</span><span class="terminal-role-pill ${isCurrentMerchantManager() ? 'mgr' : 'staff'}">${roleTagStr}</span>`;
      }
    } else {
      topSel.style.display = 'inline-block';
      if (nameplateEl) nameplateEl.style.display = 'none';
      topSel.innerHTML = state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>${escapeHtml(trTerm(s.campus))} — ${escapeHtml(trTerm(s.name))} ${s.isOpen === false ? `(${t('休息中', 'Closed', '準備中', '휴식중')})` : ''}</option>`).join('');
    }
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

// #12 & 一-5 多班別開班點鈔登記流程 (Shift Open — 早班 / 晚班 / 全日)
async function promptOpenShiftFloatModal() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const todayStr = getTodayDateStr();
  const curSlot = state.activeShiftSlot || 'FULL';
  const slotLabelMap = { MORNING: '早班 (00:00~14:59)', EVENING: '晚班 (15:00~23:59)', FULL: '全日班' };
  const formRes = await showAppFormModal({
    title: `🔓 開班點鈔登記（${todayStr}・${slotLabelMap[curSlot] || '全日班'}）`,
    message: `請登記「${store.name}」本班別值班人員與錢箱找零準備金：`,
    fields: [
      { key: 'cashier', label: '👤 值班開班收銀員姓名', value: state.shiftCashierName || state.merchantStaffName || '早班店長', placeholder: '例如：早班店長' },
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

  const compKey = makeShiftCompositeKey(todayStr, curSlot);
  const openRec = {
    openedAt: `${todayStr} ${getTaipeiTimeHHMMSS()}`,
    cashier: cleanCashier,
    openingFloat,
    shiftSlot: curSlot
  };
  if (!state.openShiftsMap) state.openShiftsMap = {};
  if (!state.openShiftsMap[store.id]) state.openShiftsMap[store.id] = {};
  state.openShiftsMap[store.id][compKey] = openRec;
  try { localStorage.setItem(`mealflow_shift_opened_${store.id}_${compKey}`, JSON.stringify(openRec)); } catch (e) {}

  recordMerchantAuditLog('完成開班點鈔登記', `班別[${curSlot}] 值班人員：${cleanCashier}，開班找零準備金 NT$${openingFloat}`);
  renderPosCashierPanel(store);
  showToast(`🔓 [${slotLabelMap[curSlot] || curSlot}] 開班完成！${cleanCashier} 已登記找零底金 NT$${openingFloat}`);

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
        shiftSlot: curSlot,
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
    state.posDiscountOverridePin = '';
  } else {
    const numAmt = Math.max(0, Number(amount) || 0);
    // 二-1：收銀員 (STAFF) 執行折讓 ≥ $10 或全單招待須經店長 PIN 現場覆核
    if (numAmt >= 10 && !isCurrentMerchantManager()) {
      const mgrAuth = await requestManagerPinOverride(`櫃檯折讓 -NT$${numAmt}`);
      if (!mgrAuth) return;
      state.posDiscountOverridePin = mgrAuth.managerOverridePin;
    }
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
  if (amt >= 10 && !isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride(`自訂櫃檯折讓 -NT$${amt}`);
    if (!mgrAuth) return;
    state.posDiscountOverridePin = mgrAuth.managerOverridePin;
  }
  const reason = amt > 0 ? (String(formRes.reason || '').trim() || '櫃檯手動折讓') : '';
  state.posManualDiscount = amt;
  state.posManualDiscountReason = reason;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

function setPosQtyMultiplier(mult) {
  state.posQtyMultiplier = Math.max(1, Math.min(10, parseInt(mult, 10) || 1));
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

  const menus = (store.menus || []).slice().sort((a, b) => (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999));
  const categories = ['全部', ...new Set(menus.map(m => m.category || '主廚推薦'))];
  const filteredMenus = state.posSelectedCategory === '全部'
    ? menus
    : menus.filter(m => (m.category || '主廚推薦') === state.posSelectedCategory);
  const activeMult = Math.max(1, Number(state.posQtyMultiplier) || 1);

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
              ${escapeHtml(trTerm(cat))}
            </button>
          `).join('')}
          <div style="margin-left:auto; display:flex; gap:5px; flex-wrap:wrap; align-items:center;">
            <div class="pos-mult-bar" title="${t('點選份數乘數後再點菜，一次加入多份', 'Tap multiplier then tap dish')}">
              ${[1, 2, 3, 5].map(n => `
                <button type="button" class="pos-mult-btn ${activeMult === n ? 'active' : ''}" onclick="setPosQtyMultiplier(${n})">×${n}</button>
              `).join('')}
            </div>
            <button type="button" class="pos-cat-pill" style="background:#EFF6FF; color:#1D4ED8; border-color:#93C5FD;" onclick="triggerHardwareCashDrawerKick()" title="送出 ESC/POS 開錢箱指令">
              💵 ${t('開錢箱', 'Drawer')}
            </button>
            <button type="button" class="pos-cat-pill" style="background:${heldCount > 0 ? '#FEF3C7' : '#F8FAFC'}; color:${heldCount > 0 ? '#B45309' : '#475569'}; border-color:${heldCount > 0 ? '#F59E0B' : '#CBD5E1'};" onclick="openPosHeldOrdersModal()">
              ⏸️ ${t('掛單', 'Hold')} (${heldCount})
            </button>
            <button type="button" class="pos-cat-pill" style="background:${openedShiftInfo ? '#ECFDF5' : '#FFF7ED'}; color:${openedShiftInfo ? '#065F46' : '#C2410C'}; border-color:${openedShiftInfo ? '#10B981' : '#FB923C'};" onclick="promptOpenShiftFloatModal()">
              ${openedShiftInfo ? `🔓 ${t('已開班', 'Open')}($${openedShiftInfo.openingFloat})` : `🔓 ${t('開班點鈔', 'Open Shift')}`}
            </button>
            <button type="button" class="pos-cat-pill" style="background:#0F172A; color:#FFFFFF; border-color:#0F172A;" onclick="openShiftZReportModal()">
              🧾 ${t('交班日結', 'Z-Report')}
            </button>
          </div>
        </div>

        <div class="pos-dish-grid">
          ${filteredMenus.map(m => {
            const fullIdx = (store.menus || []).findIndex(x => String(x.id) === String(m.id));
            const hasOpts = m.options && Object.keys(m.options).length > 0;
            const isSoldOut = Boolean(m.soldOut);
            const hasDailyLimit = Number(m.dailyLimit) > 0 && m.remainingToday !== null && m.remainingToday !== undefined;
            const tileAccent = m.tileColor ? `border-top:4px solid ${escapeHtml(m.tileColor)};` : '';
            return `
              <div class="pos-dish-tile ${isSoldOut ? 'sold-out' : ''}" style="${tileAccent}" onclick="handleMenuItemClick(${escapeJsAttr(m.id)}, true)">
                <div>
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                    <span class="pos-tile-cat">${escapeHtml(trTerm(m.category || '招牌'))}${hasDailyLimit && !isSoldOut ? ` ・剩${m.remainingToday}` : ''}</span>
                    <button type="button" onclick="toggleMenuItemSoldOut(${fullIdx}, event)" style="border:none; background:${isSoldOut ? '#FEE2E2' : '#F1F5F9'}; color:${isSoldOut ? '#DC2626' : '#475569'}; font-size:0.66rem; font-weight:900; padding:2px 6px; border-radius:6px;" title="一鍵切換售罄或上架狀態">
                      ${isSoldOut ? t('🚫 已售罄', '🚫 Out') : (hasOpts ? t('⚙️ 客製', '⚙️ Opts') : t('售罄', 'Out'))}
                    </button>
                  </div>
                  <div class="pos-tile-name" data-dish-name="1">${escapeHtml(trDishName(m))}</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span class="pos-tile-price">NT$ ${m.price}</span>
                  <span style="min-width:22px; height:22px; padding:0 5px; border-radius:999px; background:${isSoldOut ? '#E2E8F0' : (activeMult > 1 ? '#EA580C' : 'var(--brand-light)')}; color:${isSoldOut ? '#94A3B8' : (activeMult > 1 ? '#FFFFFF' : 'var(--brand-dark)')}; display:inline-flex; align-items:center; justify-content:center; font-weight:900; font-size:0.78rem;">${isSoldOut ? '✕' : (activeMult > 1 ? `×${activeMult}` : '＋')}</span>
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

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:4px;">
                  <input type="text" id="posTableNumInput" maxlength="20" class="select-input" style="padding:5px 8px; font-size:0.75rem;" placeholder="🪑 桌號 (如: A3)" value="${escapeHtml(state.posTableNumber || '')}" oninput="state.posTableNumber=this.value.trim().slice(0,20)">
                  <input type="text" id="posCarrierCodeInput" maxlength="8" class="select-input" style="padding:5px 8px; font-size:0.75rem; font-family:monospace; text-transform:uppercase;" placeholder="📱 載具 (如: /AB12345)" value="${escapeHtml(state.posCarrierCode || '')}" oninput="state.posCarrierCode=this.value.trim().toUpperCase().slice(0,8)">
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

// 一-4：POS 現場預覽單號統一採用 A001+ 專屬區間，與線上 B001+ 徹底隔離不撞號
function generatePreviewNextSeq(storeId, pickupDateStr) {
  return previewNextMerchantPosPickupNumber(storeId, pickupDateStr);
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
      tableNumber: state.posDineType === '內用自取' ? (state.posTableNumber || '') : '',
      carrierCode: state.posCarrierCode || '',
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

    const discountOverridePin = state.posDiscountOverridePin || '';
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
    state.posDiscountOverridePin = '';
    state.posCustomerNote = '';
    state.posTableNumber = '';
    state.posCarrierCode = '';
    state.posTaxId = '';
    state.posQtyMultiplier = 1;
    renderMerchantView();

    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'submitOrder',
          ...getMerchantAuthPayload(),
          managerOverridePin: discountOverridePin,
          ...draftOrder,
          clientDeviceId: state.clientDeviceId,
          orderSource: draftOrder.studentId,
          campus: store.campus,
          items: structuredItems
        })
      });
      const data = await res.json();
      if (data && data.success && data.order && data.order.pickupNumber) {
        draftOrder.pickupNumber = String(data.order.pickupNumber);
        draftOrder.verificationCode = String(data.order.verificationCode || '');
        draftOrder.isOfflinePending = false;
        syncLocalSeqWithAuthoritativeNumber(store.id, pickupDateVal, draftOrder.pickupNumber);
        saveCachedOrders(state.orders);
        renderMerchantView();
        // 二-2：若已配對 WebUSB/WebSerial 熱感印表機，直接 ESC/POS 靜默分站出單並彈開錢箱；否則開啟 80mm 預覽視窗
        const silentPrinted = await MerchantHardwarePrinter.printOrderByStationRoutes(draftOrder, true);
        if (!silentPrinted) openReceiptPrintModal(draftOrder.orderId);
        showToast(`🖨️ 櫃檯出單成功！單號 #${draftOrder.pickupNumber}${silentPrinted ? '（已 ESC/POS 靜默直印出單）' : ''}${changeAmount > 0 ? `，找零 NT$ ${changeAmount}` : ''}`);
        return;
      }
    } catch (e) {}

    const offlineSilentPrinted = await MerchantHardwarePrinter.printOrderByStationRoutes(draftOrder, true);
    if (!offlineSilentPrinted) openReceiptPrintModal(draftOrder.orderId);
    showToast(`⚠️ 門市網路暫時離線：已開立現場專屬號 #${draftOrder.pickupNumber}（連線恢復後原號同步不改號）！`);
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

// 一-5：多班別交班切換 (MORNING: 00:00~14:59 / EVENING: 15:00~23:59 / FULL: 全日)
function setActiveShiftSlot(slot) {
  const clean = ['MORNING', 'EVENING', 'FULL'].includes(String(slot).toUpperCase()) ? String(slot).toUpperCase() : 'FULL';
  state.activeShiftSlot = clean;
  try { localStorage.setItem('mealflow_active_shift_slot', clean); } catch (e) {}
  openShiftZReportModal();
}

function isOrderInShiftSlot(order, shiftSlot) {
  if (!shiftSlot || shiftSlot === 'FULL') return true;
  const h = parseOrderHour(order);
  if (shiftSlot === 'MORNING') return h < 15;
  if (shiftSlot === 'EVENING') return h >= 15;
  return true;
}

async function lockTodayShiftSettlement(expectedDrawerCash, actualCounted, varianceAmt) {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;
  const todayStr = getTodayDateStr();
  const slot = state.activeShiftSlot || 'FULL';
  const compKey = makeShiftCompositeKey(todayStr, slot);
  const cashier = state.shiftCashierName || state.merchantStaffName || '值班店長';
  const lockKey = `mealflow_shift_locked_${store.id}_${compKey}`;
  const pettyEntries = getShiftPettyCashEntries(store.id, todayStr, slot);
  const pettyCashInSum = pettyEntries.filter(e => e.type === 'IN').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pettyCashOutSum = pettyEntries.filter(e => e.type === 'OUT').reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const lockRecord = {
    locked: true,
    lockedAt: `${todayStr} ${getTaipeiTimeHHMMSS()}`,
    shiftSlot: slot,
    cashier,
    openingFloat: state.shiftOpeningFloat,
    pettyCashInSum,
    pettyCashOutSum,
    expectedDrawerCash,
    actualCounted,
    varianceAmt
  };
  if (!state.lockedShiftsMap || typeof state.lockedShiftsMap !== 'object') {
    state.lockedShiftsMap = {};
  }
  if (!state.lockedShiftsMap[store.id]) state.lockedShiftsMap[store.id] = {};
  state.lockedShiftsMap[store.id][compKey] = lockRecord;
  try {
    localStorage.setItem(lockKey, JSON.stringify(lockRecord));
  } catch (e) {}

  recordMerchantAuditLog('完成交班日結關班', `班別[${slot}] 經手人：${cashier}，應有錢箱現金 $${expectedDrawerCash}，實點 $${actualCounted}，差額 $${varianceAmt}`);
  openShiftZReportModal();
  renderMerchantView();
  showToast(`🔒 已完成「${store.name}」${todayStr} [${slot}] 交班日結鎖定並寫入雲端 ShiftReports 工作表！`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'lockShiftZReport',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        shiftDate: todayStr,
        shiftSlot: slot,
        ...lockRecord
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

  // 二-1：解除日結鎖定須店長授權覆核
  let mgrOverridePin = '';
  if (!isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride('解除交班日結鎖定', store.id);
    if (!mgrAuth) return;
    mgrOverridePin = mgrAuth.managerOverridePin;
  }

  const todayStr = getTodayDateStr();
  const slot = state.activeShiftSlot || 'FULL';
  const compKey = makeShiftCompositeKey(todayStr, slot);
  const reason = await showAppPromptModal({
    title: `🔓 解除交班日結鎖定 (${todayStr}・${slot})`,
    message: `確定要解除「${store.name}」${todayStr} [${slot}] 的交班日結鎖定嗎？\n請輸入店長解鎖原因（將永久寫入雲端 AuditLogs）：`,
    defaultValue: '補登漏單 / 重新盤點錢箱',
    placeholder: '請輸入解鎖原因',
    confirmText: '確定解除鎖定',
    danger: true
  });
  if (reason === null) return;
  const cleanReason = reason.trim() || '店長手動解鎖重結';

  try {
    localStorage.removeItem(`mealflow_shift_locked_${store.id}_${compKey}`);
    if (slot === 'FULL') localStorage.removeItem(`mealflow_shift_locked_${store.id}_${todayStr}`);
  } catch (e) {}
  if (state.lockedShiftsMap && state.lockedShiftsMap[store.id]) {
    delete state.lockedShiftsMap[store.id][compKey];
    if (slot === 'FULL') delete state.lockedShiftsMap[store.id][todayStr];
  }

  recordMerchantAuditLog('解除交班日結鎖定', `店長解除 ${todayStr} [${slot}] 關班鎖定，原因：${cleanReason}`);
  openShiftZReportModal();
  renderMerchantView();
  showToast(`🔓 已解除「${store.name}」[${slot}] 關班鎖定，可繼續調整帳務或重新日結！`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'unlockShiftZReport',
        ...getMerchantAuthPayload(),
        managerOverridePin: mgrOverridePin,
        storeId: store.id,
        shiftDate: todayStr,
        shiftSlot: slot,
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
  const curSlot = state.activeShiftSlot || 'FULL';
  const slotLabel = curSlot === 'MORNING' ? '早班 (00:00~14:59)' : (curSlot === 'EVENING' ? '晚班 (15:00~23:59)' : '全日總結');
  const lockedShiftInfo = getLockedShiftRecord(store.id, todayStr, curSlot);

  // 一-5 & #33：支援多班別過濾 (早班 / 晚班 / 全日) + 嚴格收款日歸屬 + 改單向上補差額獨立對帳
  const storeAllOrders = state.orders.filter(o => o.storeId === store.id);

  const paidOrders = storeAllOrders.filter(o =>
    !String(o.status).includes('已取消') &&
    isOrderConsiderPaid(o) &&
    normalizeDateStr(o.paidAtDate || o.pickupDate) === todayStr &&
    isOrderInShiftSlot(o, curSlot)
  );
  const unpaidOrders = storeAllOrders.filter(o =>
    !String(o.status).includes('已取消') &&
    !isOrderConsiderPaid(o) &&
    normalizeDateStr(o.pickupDate) === todayStr &&
    isOrderInShiftSlot(o, curSlot)
  );
  const cancelledOrders = storeAllOrders.filter(o =>
    String(o.status).includes('已取消') &&
    normalizeDateStr(o.paidAtDate || o.pickupDate) === todayStr &&
    isOrderInShiftSlot(o, curSlot)
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

  // #12 & 一-5：支援複合付款 (paymentSplit) 與改單向上補收差額 (extraChargeTotal) 精準拆算至現金錢箱與行動支付
  const cashOrders = paidOrders.filter(o =>
    (o.paymentSplit && Number(o.paymentSplit.cash) > 0) ||
    (!o.paymentSplit && (String(o.paymentMethod).includes('現金') || String(o.paymentMethod).includes('付現')))
  );
  const linePayOrders = paidOrders.filter(o =>
    (o.paymentSplit && Number(o.paymentSplit.linePay) > 0) ||
    (!o.paymentSplit && o.paymentMethod === 'LINE Pay')
  );

  // 若為 LINE Pay 訂單改單向上加價且現場補收「現金」，將補收差額計入現金錢箱並自 LINE Pay 扣減差額避免錯帳
  const cashExtraSurchargeOnNonCash = paidOrders
    .filter(o => Number(o.extraChargeTotal) > 0 && String(o.extraChargeMethod || '').includes('現金') && !String(o.paymentMethod).includes('現金') && !String(o.paymentMethod).includes('付現'))
    .reduce((s, o) => s + (Number(o.extraChargeTotal) || 0), 0);
  const lineExtraSurchargeOnCash = paidOrders
    .filter(o => Number(o.extraChargeTotal) > 0 && String(o.extraChargeMethod || '').includes('LINE') && (String(o.paymentMethod).includes('現金') || String(o.paymentMethod).includes('付現')))
    .reduce((s, o) => s + (Number(o.extraChargeTotal) || 0), 0);

  const cashNetTotal = cashOrders.reduce((s, o) => s + (o.paymentSplit ? (Number(o.paymentSplit.cash) || 0) : (Number(o.finalTotal) || 0)), 0) + cashExtraSurchargeOnNonCash - lineExtraSurchargeOnCash;
  const cashTenderedSum = cashOrders.reduce((s, o) => {
    if (o.paymentSplit) return s + (Number(o.paymentSplit.cash) || 0);
    return s + (Number(o.cashReceived) > 0 ? Number(o.cashReceived) : (Number(o.finalTotal) || 0));
  }, 0) + cashExtraSurchargeOnNonCash;
  const cashChangeSum = cashOrders.reduce((s, o) => s + (o.paymentSplit ? 0 : (Number(o.changeGiven) || 0)), 0);
  const cashRefundSum = refundedOrders
    .filter(o => String(o.refundMethod || o.paymentMethod).includes('現金') || String(o.refundMethod || o.paymentMethod).includes('付現'))
    .reduce((s, o) => s + (Number(o.refundAmount) || Number(o.finalTotal) || 0), 0);
  const partialCashRefundSum = paidOrders
    .filter(o => Number(o.partialRefundTotal) > 0 && (String(o.paymentMethod).includes('現金') || String(o.paymentMethod).includes('付現') || (o.paymentSplit && Number(o.paymentSplit.cash) > 0)))
    .reduce((s, o) => s + (Number(o.partialRefundTotal) || 0), 0);

  const pettyEntries = getShiftPettyCashEntries(store.id, todayStr, curSlot);
  const pettyCashInSum = pettyEntries.filter(e => e.type === 'IN').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pettyCashOutSum = pettyEntries.filter(e => e.type === 'OUT').reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const openingFloat = Math.max(0, Number(state.shiftOpeningFloat) || 0);
  const expectedTotalCashInDrawer = Math.max(0, openingFloat + cashNetTotal + pettyCashInSum - pettyCashOutSum - cashRefundSum - partialCashRefundSum);
  const actualCountedNum = state.shiftActualCountedCash !== '' ? Math.max(0, Number(state.shiftActualCountedCash) || 0) : expectedTotalCashInDrawer;
  const cashVariance = actualCountedNum - expectedTotalCashInDrawer;

  const linePayTotal = linePayOrders.reduce((s, o) => s + (o.paymentSplit ? (Number(o.paymentSplit.linePay) || 0) : (Number(o.finalTotal) || 0)), 0) - cashExtraSurchargeOnNonCash + lineExtraSurchargeOnCash;
  const totalExtraSurchargeSum = paidOrders.reduce((s, o) => s + (Number(o.extraChargeTotal) || 0), 0);
  const refundedTotal = refundedOrders.reduce((s, o) => s + (Number(o.refundAmount) || Number(o.finalTotal) || 0), 0);
  const voidUnpaidTotal = voidUnpaidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const unpaidTotal = unpaidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const dineInCount = paidOrders.filter(o => o.dineType === '內用自取').length;
  const takeoutCount = paidOrders.length - dineInCount;

  const titleEl = document.getElementById('receiptPrintModalTitle');
  if (titleEl) titleEl.innerText = `🧾 櫃檯錢箱交班日結單 (${slotLabel})`;

  const body = document.getElementById('receiptPrintModalBody');
  if (body) {
    body.innerHTML = `
      <div class="no-print" style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:12px; padding:12px; margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
          <div style="font-size:0.82rem; font-weight:900; color:#0F172A;">
            🪙 多班別錢箱清點・中途零用金收支與關班鎖定
          </div>
          <div style="display:flex; gap:4px;">
            <button type="button" class="pos-cat-pill ${curSlot === 'MORNING' ? 'active' : ''}" style="padding:4px 10px; font-size:0.74rem;" onclick="setActiveShiftSlot('MORNING')">☀️ 早班 (~15:00)</button>
            <button type="button" class="pos-cat-pill ${curSlot === 'EVENING' ? 'active' : ''}" style="padding:4px 10px; font-size:0.74rem;" onclick="setActiveShiftSlot('EVENING')">🌙 晚班 (15:00~)</button>
            <button type="button" class="pos-cat-pill ${curSlot === 'FULL' ? 'active' : ''}" style="padding:4px 10px; font-size:0.74rem;" onclick="setActiveShiftSlot('FULL')">📅 全日</button>
          </div>
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
          ${partialCashRefundSum > 0 ? `<tr><td>改單部分退現折讓</td><td>-NT$ ${partialCashRefundSum.toLocaleString()}</td></tr>` : ''}
          ${totalExtraSurchargeSum > 0 ? `<tr><td>改單向上加價補收 (合計)</td><td>+NT$ ${totalExtraSurchargeSum.toLocaleString()}</td></tr>` : ''}
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

// 二-3：廚房工作站分類（優先讀取菜單明確設定的 station: MAIN / SIDE / DRINK，若為 AUTO 才降級關鍵字分類）
function classifyItemKitchenStation(item, storeObj = null) {
  const direct = String(item?.station || '').trim().toUpperCase();
  if (direct === 'MAIN' || direct === 'SIDE' || direct === 'DRINK') return direct;
  const st = storeObj || state.stores.find(s => s.id === state.merchantStoreId);
  if (st && Array.isArray(st.menus)) {
    const matched = st.menus.find(m => (item?.id && String(m.id) === String(item.id)) || (item?.menuId && String(m.id) === String(item.menuId)) || String(m.name).trim() === String(item?.baseName || item?.name || '').trim());
    const ms = String(matched?.station || '').trim().toUpperCase();
    if (ms === 'MAIN' || ms === 'SIDE' || ms === 'DRINK') return ms;
  }
  const txt = `${item?.baseName || item?.name || ''} ${item?.category || ''}`;
  if (/(湯|茶|飲|豆漿|紅茶|綠茶|果汁|汽水|咖啡|鮮奶|冬瓜)/.test(txt)) return 'DRINK';
  if (/(炸|豆腐|起司條|唐揚|小菜|滷蛋|溫泉蛋|貢丸|泡菜|薯條|雞塊|點心|配菜)/.test(txt)) return 'SIDE';
  return 'MAIN';
}

// 二-3：KDS 廚房單品逐項劃單（點擊打勾/取消並即時雲端同步）
async function toggleKdsOrderItemChecked(orderId, itemKey) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const order = state.orders.find(o => o.orderId === orderId);
  if (!order) return;
  if (!order.itemCheckedMap || typeof order.itemCheckedMap !== 'object') {
    order.itemCheckedMap = {};
  }
  const nextVal = !Boolean(order.itemCheckedMap[itemKey]);
  order.itemCheckedMap[itemKey] = nextVal;
  saveCachedOrders(state.orders);
  renderMerchantOrdersOnly(null, true);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateOrderItemCheckState',
        ...getMerchantAuthPayload(),
        orderId: order.orderId,
        itemKey: itemKey,
        checked: nextVal
      })
    });
  } catch (e) {}
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

function addDishToModifyDraft(menuId) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !menuId) return;
  const m = (store.menus || []).find(x => String(x.id) === String(menuId));
  if (!m) return;
  state.modifyingOrderItemsDraft.push({
    id: m.id,
    name: m.name,
    baseName: m.name,
    basePrice: m.price,
    price: m.price,
    qty: 1,
    selections: {},
    isAddOn: true
  });
  renderKdsModifyOrderModal();
}

function renderKdsModifyOrderModal() {
  const box = document.getElementById('kdsModifyOrderBody');
  const titleEl = document.getElementById('kdsModifyOrderTitle');
  const order = state.orders.find(o => o.orderId === state.modifyingOrderId);
  const store = state.stores.find(s => s.id === (order ? order.storeId : state.merchantStoreId));
  if (!box || !order) return;
  if (titleEl) titleEl.innerText = `✏️ 改單 / 加點 / 單品作廢 (#${order.pickupNumber})`;

  const draft = state.modifyingOrderItemsDraft || [];
  const newSubtotal = draft.reduce((s, it) => s + (it.isGift ? 0 : (Number(it.price) || 0) * (Number(it.qty) || 1)), 0);
  const discount = Math.min(newSubtotal, Number(order.discount) || 0);
  const manualDiscount = Math.min(Math.max(0, newSubtotal - discount), Number(order.manualDiscount) || 0);
  const newTotal = Math.max(0, newSubtotal + (Number(order.cutleryFee) || 0) - discount - manualDiscount);
  const diffAmt = newTotal - (Number(order.finalTotal) || 0);
  const wasPaid = isOrderConsiderPaid(order);
  const availMenus = store ? (store.menus || []).filter(m => !m.soldOut) : [];

  box.innerHTML = `
    <div style="background:#FFFBEB; border:1px solid #F59E0B; color:#92400E; padding:9px 12px; border-radius:10px; font-size:0.78rem; font-weight:800; margin-bottom:12px;">
      💡 可直接加點、增減份數或作廢缺貨單品；若已付款且修改後金額上升，請於下方選擇補收差額方式以確保交班帳務零誤差。
    </div>
    ${availMenus.length > 0 ? `
      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <select id="kdsModifyAddMenuSelect" class="select-input" style="flex:1; padding:6px 8px; font-size:0.8rem;">
          <option value="">＋ 選擇本店品項加點入此單...</option>
          ${availMenus.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (NT$${m.price})</option>`).join('')}
        </select>
        <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.78rem;" onclick="addDishToModifyDraft(document.getElementById('kdsModifyAddMenuSelect')?.value)">＋ 加入</button>
      </div>
    ` : ''}
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px; max-height:220px; overflow-y:auto;">
      ${draft.map((it, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:#F8FAFC; border:1px solid var(--border); padding:10px 12px; border-radius:10px;">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:900; font-size:0.88rem;">${escapeHtml(it.baseName || it.name)} ${it.isGift ? '(贈品)' : ''}${it.isAddOn ? ' <span style="color:#4F46E5; font-size:0.72rem;">[加點]</span>' : ''}</div>
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
      <div style="display:flex; justify-content:space-between;"><span>原訂單總額 (${escapeHtml(order.paymentStatus || '')})</span><strong>NT$ ${order.finalTotal}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:1rem;"><span>修改後總額</span><strong style="color:var(--red);">NT$ ${newTotal} (${diffAmt === 0 ? '無差額' : diffAmt < 0 ? `退差額 -$${Math.abs(diffAmt)}` : `補差額 +$${diffAmt}`})</strong></div>
    </div>
    ${wasPaid && diffAmt > 0 ? `
      <div style="background:#ECFDF5; border:1.5px solid #10B981; border-radius:10px; padding:10px 12px; margin-bottom:12px;">
        <label class="field-label" style="color:#065F46; margin-bottom:6px;">💰 此單已付款，向上加價須補收差額 <strong>NT$ ${diffAmt}</strong> — 請選擇補款方式（計入交班日結帳務）：</label>
        <select id="kdsModifyExtraChargeMethod" class="select-input" style="font-weight:800;">
          <option value="現場現金">💵 現場現金補收差額 (+NT$${diffAmt} 入錢箱)</option>
          <option value="LINE Pay">💚 LINE Pay 補收差額 (+NT$${diffAmt} 入行動支付)</option>
        </select>
      </div>
    ` : ''}
    <div style="margin-bottom:12px;">
      <label class="field-label">📝 改單 / 加點 / 單品作廢原因（將寫入稽核紀錄）</label>
      <input type="text" id="kdsModifyReasonInput" class="select-input" value="${diffAmt > 0 ? '顧客加點補差額' : '單品缺貨作廢 / 顧客改單'}" placeholder="如：顧客加點、單品售罄作廢">
    </div>
    <div style="display:flex; gap:8px;">
      <button type="button" class="btn-outline" style="flex:1;" onclick="closeKdsModifyOrderModal()">取消</button>
      <button type="button" class="btn-tip-action" style="flex:2;" onclick="commitKdsModifyOrder()">💾 確認改單${wasPaid && diffAmt > 0 ? `並補收 +$${diffAmt}` : '並重算金額'}</button>
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
  const extraChargeMethod = document.getElementById('kdsModifyExtraChargeMethod')?.value || '現場現金';
  const prevSnapshot = {
    structuredItems: JSON.parse(JSON.stringify(order.structuredItems || [])),
    subtotal: order.subtotal,
    discount: order.discount,
    manualDiscount: order.manualDiscount,
    finalTotal: order.finalTotal,
    extraChargeTotal: order.extraChargeTotal || 0,
    extraChargeMethod: order.extraChargeMethod || ''
  };

  const newSubtotal = draft.reduce((s, it) => s + (it.isGift ? 0 : (Number(it.price) || 0) * (Number(it.qty) || 1)), 0);
  const newDiscount = Math.min(newSubtotal, Number(order.discount) || 0);
  const newManualDisc = Math.min(Math.max(0, newSubtotal - newDiscount), Number(order.manualDiscount) || 0);
  const newTotal = Math.max(0, newSubtotal + (Number(order.cutleryFee) || 0) - newDiscount - newManualDisc);
  const diffAmt = newTotal - (Number(prevSnapshot.finalTotal) || 0);
  const wasPaid = isOrderConsiderPaid(order);

  order.structuredItems = draft.map(normalizeOrderItemEntry);
  order.itemsJson = JSON.stringify(order.structuredItems);
  order.subtotal = newSubtotal;
  order.discount = newDiscount;
  order.manualDiscount = newManualDisc;
  order.finalTotal = newTotal;
  if (wasPaid && diffAmt > 0) {
    order.extraChargeTotal = (Number(order.extraChargeTotal) || 0) + diffAmt;
    order.extraChargeMethod = extraChargeMethod;
    order.extraChargeAtDate = getTodayDateStr();
  } else if (wasPaid && diffAmt < 0) {
    order.partialRefundTotal = (Number(order.partialRefundTotal) || 0) + Math.abs(diffAmt);
  }

  recordMerchantAuditLog('訂單改單/單品作廢', `單號 #${order.pickupNumber}，金額 $${prevSnapshot.finalTotal} ➔ $${newTotal}${wasPaid && diffAmt > 0 ? `（補收差額 $${diffAmt}/${extraChargeMethod}）` : ''}，原因：${reason}`);
  closeKdsModifyOrderModal();

  await executeMerchantOrderMutation(
    order,
    prevSnapshot,
    {
      action: 'modifyOrderItems',
      orderId: order.orderId,
      structuredItems: order.structuredItems,
      extraChargeMethod: extraChargeMethod,
      reason
    },
    `✏️ 訂單 #${order.pickupNumber} 已完成改單！最新金額 NT$${newTotal}${wasPaid && diffAmt > 0 ? ` (已記錄 ${extraChargeMethod} 補收 $${diffAmt})` : ''}`
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
      : items.filter(it => classifyItemKitchenStation(it, store) === stationFilter);
    const checkedMap = (o.itemCheckedMap && typeof o.itemCheckedMap === 'object') ? o.itemCheckedMap : {};
    const checkedCount = visibleItems.reduce((cnt, it, iIdx) => cnt + (checkedMap[`item_${iIdx}`] ? 1 : 0), 0);
    const itemStr = visibleItems.map(i => {
      const sel = i.selections && Object.keys(i.selections).length > 0
        ? ` [${Object.entries(i.selections).map(([k, v]) => `${k}:${v}`).join(', ')}]`
        : '';
      const noteTag = i.itemNote ? ` (📝${i.itemNote})` : '';
      return `${i.baseName || i.name}${sel}${noteTag} ×${i.qty || 1}`;
    }).join('、');

    const kdsCheckableItemsHtml = visibleItems.map((i, iIdx) => {
      const itemKey = `item_${iIdx}`;
      const isChecked = Boolean(checkedMap[itemKey]);
      const sel = i.selections && Object.keys(i.selections).length > 0
        ? ` <span style="color:#475569; font-weight:700; font-size:0.78rem;">[${escapeHtml(Object.entries(i.selections).map(([k, v]) => `${k}:${v}`).join(', '))}]</span>`
        : '';
      const noteTag = i.itemNote ? ` <span style="color:#4338CA; font-size:0.76rem;">(📝${escapeHtml(i.itemNote)})</span>` : '';
      const addOnBadge = i.isAddOn ? `<span style="background:#EEF2FF; color:#4338CA; font-size:0.68rem; font-weight:900; padding:1px 5px; border-radius:4px; margin-left:4px;">➕加點</span>` : '';
      return `
        <div class="kds-check-item-row ${isChecked ? 'checked' : ''}" onclick="toggleKdsOrderItemChecked(${escapeJsAttr(o.orderId)}, ${escapeJsAttr(itemKey)})">
          <span class="kds-check-box">${isChecked ? '✅' : '⬜'}</span>
          <span style="flex:1;"><strong>${escapeHtml(i.baseName || i.name)}</strong> ×${i.qty || 1}${addOnBadge}${sel}${noteTag}</span>
        </div>
      `;
    }).join('');

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
            ${!isDone && !isCancelled ? `
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; color:${checkedCount >= visibleItems.length && visibleItems.length > 0 ? '#059669' : '#64748B'}; font-weight:900; margin-bottom:5px;">
                <span>☑️ 點擊單品逐項劃單出餐</span>
                <span>已備齊 ${checkedCount}/${visibleItems.length} 項</span>
              </div>
              ${kdsCheckableItemsHtml}
            ` : escapeHtml(itemStr)}
            ${stationFilter !== 'ALL' && visibleItems.length < items.length ? `<div style="font-size:0.7rem; color:var(--text-muted); margin-top:3px;">(僅顯示本分站品項・全單共 ${items.length} 項)</div>` : ''}
          </div>

          ${o.merchantMessage ? `
            <div style="font-size:0.75rem; font-weight:800; color:#1E40AF; background:#EFF6FF; border:1px solid #BFDBFE; padding:5px 8px; border-radius:6px; margin-bottom:6px;">
              💬 已傳送櫃檯留言：「${escapeHtml(o.merchantMessage)}」
            </div>
          ` : ''}

          <div style="font-size:0.76rem; color:var(--text-secondary); margin-bottom:6px; display:flex; flex-wrap:wrap; gap:6px;">
            <span style="font-weight:800; color:var(--text-primary);">🍽️ ${escapeHtml(o.dineType || '外帶自取')}</span>
            ${o.tableNumber ? `<span style="background:#ECFDF5; color:#065F46; border:1px solid #86EFAC; padding:0 6px; border-radius:5px; font-weight:950;">🪑 桌號 ${escapeHtml(o.tableNumber)}</span>` : ''}
            ${o.carrierCode ? `<span style="color:#0F172A; font-family:monospace; font-weight:800;">・📱 ${escapeHtml(o.carrierCode)}</span>` : ''}
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

  // 二-1：收銀員執行退單 / 退款須由店長輸入 PIN 現場覆核授權
  let mgrOverridePin = '';
  if (!isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride(`櫃檯退單與退款 (#${order.pickupNumber})`, order.storeId);
    if (!mgrAuth) return;
    mgrOverridePin = mgrAuth.managerOverridePin;
  }

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
      managerOverridePin: mgrOverridePin,
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

  // #32 & 二-2：收據聯 / 廚房大字工單聯 / 餐盒貼紙聯 三模式切換 + ESC/POS 硬體靜默直印快捷鍵
  const modeTabsHtml = `
    <div class="no-print" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:8px;">
      <button type="button" class="pos-chip-btn ${mode === 'CUSTOMER' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('CUSTOMER')">🧾 顧客收據聯</button>
      <button type="button" class="pos-chip-btn ${mode === 'KITCHEN' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('KITCHEN')">🍳 廚房大字工單</button>
      <button type="button" class="pos-chip-btn ${mode === 'STICKER' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('STICKER')">🏷️ 餐盒貼紙聯</button>
    </div>
    ${MerchantHardwarePrinter.isConnected('COUNTER') || MerchantHardwarePrinter.isConnected('KITCHEN') ? `
      <div class="no-print" style="margin-bottom:10px;">
        <button type="button" class="btn-tip-action" style="width:100%; background:#059669; padding:8px; font-size:0.82rem;" onclick="MerchantHardwarePrinter.printOrderByStationRoutes(state.orders.find(x=>x.orderId===${escapeJsAttr(o.orderId)}), false).then(ok=>showToast(ok?'✅ ESC/POS 靜默直印已送出！':'⚠️ 印表機未回應'))">
          ⚡ ESC/POS 熱感機直接靜默出單（免經瀏覽器列印視窗）
        </button>
      </div>
    ` : ''}
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
              <label class="field-label">🎁 行銷優惠模式（三-2 彈性設定）</label>
              <select id="cfgPromoMode" class="select-input">
                <option value="none" ${store.promoMode === 'none' ? 'selected' : ''}>關閉優惠</option>
                <option value="gift" ${(store.promoMode === 'gift' || store.promoMode === 'freebie') ? 'selected' : ''}>🎁 滿額贈送指定餐點 / 飲品</option>
                <option value="discount" ${store.promoMode === 'discount' ? 'selected' : ''}>💸 滿額現金現折</option>
                <option value="second_discount" ${store.promoMode === 'second_discount' ? 'selected' : ''}>✌️ 第二件折價 (每 2 件折抵)</option>
              </select>
            </div>

            <div>
              <label class="field-label">🕒 優惠適用時段</label>
              <select id="cfgPromoScope" class="select-input">
                <option value="OFF_PEAK" ${store.promoScope !== 'ALL_DAY' ? 'selected' : ''}>🟢 僅離峰順暢時段適用 (分流專用)</option>
                <option value="ALL_DAY" ${store.promoScope === 'ALL_DAY' ? 'selected' : ''}>🌟 全天候營業時段皆適用</option>
              </select>
            </div>

            <div>
              <label class="field-label">💰 優惠最低消費門檻 (NT$)</label>
              <input type="number" id="cfgPromoMinSubtotal" class="select-input" min="0" max="1000" value="${store.promoMinSubtotal !== undefined ? Number(store.promoMinSubtotal) : AI_DISCOUNT_MIN_SUBTOTAL}">
            </div>

            <div>
              <label class="field-label">🏷️ 優惠顯示文案</label>
              <input type="text" id="cfgPromoText" class="select-input" value="${escapeHtml(store.promoText || '')}" placeholder="例：🎁 滿百贈招牌紅茶">
            </div>

            <div>
              <label class="field-label">💸 現金折抵 / 第二件折抵金額 (NT$)</label>
              <input type="number" id="cfgPromoDiscount" class="select-input" min="0" max="200" value="${store.promoDiscount || store.secondItemDiscount || 0}">
            </div>

            <div>
              <label class="field-label">🎁 指定贈品品項（滿額贈送專用・售罄自動停贈）</label>
              <select id="cfgGiftMenuItemId" class="select-input">
                <option value="">（不指定特定品項，依文案顯示）</option>
                ${menus.map(m => `<option value="${escapeHtml(m.id)}" ${String(store.giftMenuItemId || '') === String(m.id) ? 'selected' : ''}>${escapeHtml(m.name)} (NT$${m.price})${m.soldOut ? ' [售罄]' : ''}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="field-label">🪑 內用掃碼「餐後結帳」模式（三-3）</label>
              <select id="cfgAllowDineInPostPay" class="select-input">
                <option value="false" ${!store.allowDineInPostPay ? 'selected' : ''}>關閉（學生須先付或取餐付現）</option>
                <option value="true" ${store.allowDineInPostPay ? 'selected' : ''}>✅ 開啟內用餐後至櫃檯結帳</option>
              </select>
            </div>
          </div>

          <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:12px; padding:12px; margin-bottom:14px;">
            <div style="font-size:0.86rem; font-weight:900; color:var(--indigo); margin-bottom:8px;">🎟️ 本店專屬優惠券 / 折扣碼管理（學生於購物車輸入立即核實折抵）</div>
            <div style="display:grid; grid-template-columns:1fr 0.85fr 0.7fr 0.75fr auto; gap:6px; align-items:end; margin-bottom:10px;">
              <div>
                <label class="field-label">折扣碼 *</label>
                <input type="text" id="newCouponCodeInput" maxlength="20" class="select-input" style="text-transform:uppercase; font-family:monospace;" placeholder="如 SCU15">
              </div>
              <div>
                <label class="field-label">類型</label>
                <select id="newCouponTypeSelect" class="select-input">
                  <option value="AMOUNT">折現金 ($)</option>
                  <option value="PERCENT">打折 (% off)</option>
                </select>
              </div>
              <div>
                <label class="field-label">面額/折數</label>
                <input type="number" id="newCouponValInput" class="select-input" min="1" value="15">
              </div>
              <div>
                <label class="field-label">低消 ($)</label>
                <input type="number" id="newCouponMinInput" class="select-input" min="0" value="80">
              </div>
              <button type="button" class="btn-tip-action" style="height:38px;" onclick="addStoreCouponItem()">＋ 新增</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${(Array.isArray(store.coupons) && store.coupons.length > 0) ? store.coupons.map((c, cIdx) => `
                <div style="display:inline-flex; align-items:center; gap:6px; background:#FFFFFF; border:1px solid #C7D2FE; padding:4px 10px; border-radius:999px; font-size:0.76rem; font-weight:800;">
                  <span style="font-family:monospace; color:#4338CA;">${escapeHtml(c.code)}</span>
                  <span>${c.type === 'PERCENT' ? `-${c.value}%` : `-NT$${c.value}`} (滿$${c.minSubtotal || 0})</span>
                  <button type="button" onclick="deleteStoreCouponItem(${cIdx})" style="border:none; background:transparent; color:var(--red); font-weight:900; cursor:pointer;">✕</button>
                </div>
              `).join('') : `<span style="font-size:0.76rem; color:var(--text-muted);">目前尚未建立優惠券（新增後請點下方「儲存設定」）</span>`}
            </div>
          </div>

          <button type="button" class="btn-primary-full" style="max-width:340px;" onclick="saveMerchantConfig()">💾 儲存營業狀態、行銷優惠與優惠券設定</button>
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

          <div style="display:grid; grid-template-columns:1fr 1fr auto; gap:10px; align-items:end; flex-wrap:wrap; margin-bottom:14px; padding-bottom:14px; border-bottom:1px dashed var(--border);">
            <div>
              <label class="field-label">輸入「${escapeHtml(store.name)}」目前舊店長 PIN (4~8碼) *</label>
              <input type="password" id="cfgOldMerchantPinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="驗證本店舊密碼" value="">
            </div>
            <div>
              <label class="field-label">設定「${escapeHtml(store.name)}」新店長 PIN (4~8碼) *</label>
              <input type="password" id="cfgMerchantPinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="輸入新 4~8 位數字 (更新後預設 8888 立即失效)" value="">
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn-outline" style="height:40px;" onclick="saveNewMerchantPin()">💾 驗證並更新店長密碼</button>
              <button type="button" class="btn-danger-soft" style="height:40px;" onclick="lockMerchantSession()">🔒 立即上鎖</button>
            </div>
          </div>

          <div style="background:#EFF6FF; border:1.5px solid #93C5FD; border-radius:12px; padding:12px; margin-bottom:14px;">
            <div style="font-size:0.9rem; font-weight:950; color:#1E3A8A; margin-bottom:6px;">👥 員工分級權限設定（二-1：收銀員獨立 PIN 與具名打卡名單）</div>
            <p style="font-size:0.75rem; color:#1D4ED8; margin-bottom:10px;">
              以「收銀員 PIN」登入時僅能收銀點餐與廚房出餐；執行退單退款、大額折讓、查看財務損益或解鎖日結時，將自動彈出「店長 PIN 覆核視窗」。
            </p>
            <div style="display:grid; grid-template-columns:0.85fr 1.4fr auto; gap:8px; align-items:end;">
              <div>
                <label class="field-label">收銀員專屬 PIN (4~8碼) ${store.hasStaffPin ? '✅已設定' : ''}</label>
                <input type="password" id="cfgStaffPinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="${store.hasStaffPin ? '輸入新碼可更新（留空不變）' : '例如：1234'}">
              </div>
              <div>
                <label class="field-label">具名員工清單（逗號分隔，登入時下拉選取）</label>
                <input type="text" id="cfgStaffListInput" class="select-input" value="${escapeHtml(Array.isArray(store.staffList) ? store.staffList.join(', ') : '值班店長, 早班收銀員, 晚班收銀員')}" placeholder="王店長, 小明, 小美">
              </div>
              <button type="button" class="btn-tip-action" style="height:40px; background:#1D4ED8;" onclick="saveStaffSecurityConfig()">💾 儲存員工權限</button>
            </div>
          </div>

          <div style="background:#F8FAFC; border:1.5px solid #CBD5E1; border-radius:12px; padding:12px;">
            <div style="font-size:0.9rem; font-weight:950; color:#0F172A; margin-bottom:6px;">🖨️ ESC/POS 熱感應出單機靜默直印 & 錢箱分站派單設定（二-2）</div>
            <p style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:10px;">
              支援透過瀏覽器 WebUSB 或 WebSerial 直接連線 80mm / 58mm 熱感印表機，結帳完成自動靜默切紙出單、依廚房站點分流派單並彈開 RJ-11 現金錢箱！
            </p>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:8px;">
              ${['COUNTER', 'KITCHEN', 'DRINK'].map(rKey => {
                const routeInfo = MerchantHardwarePrinter.routes[rKey];
                return `
                  <div style="background:#FFFFFF; border:1px solid var(--border); border-radius:10px; padding:10px;">
                    <div style="font-weight:900; font-size:0.84rem; margin-bottom:3px;">${escapeHtml(routeInfo.label)}</div>
                    <div style="font-size:0.73rem; color:var(--text-secondary); margin-bottom:8px;">狀態：${escapeHtml(MerchantHardwarePrinter.getStatusSummary(rKey))}</div>
                    <div style="display:flex; gap:5px; flex-wrap:wrap;">
                      <button type="button" class="pos-chip-btn" style="padding:4px 8px; font-size:0.72rem;" onclick="connectHardwarePrinterUi('${rKey}', 'usb')">🔌 WebUSB</button>
                      <button type="button" class="pos-chip-btn" style="padding:4px 8px; font-size:0.72rem;" onclick="connectHardwarePrinterUi('${rKey}', 'serial')">🔗 Serial</button>
                      <button type="button" class="pos-chip-btn" style="padding:4px 8px; font-size:0.72rem; background:#ECFDF5; color:#065F46;" onclick="testHardwarePrinterUi('${rKey}')">🧪 測試出單</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3 style="font-size:0.98rem; font-weight:900;">🛡️ 店務敏感操作稽核紀錄（雲端 AuditLogs 工作表持久化・含具名人員與店長覆核紀錄）</h3>
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
                    ${log.staffName ? `<span style="background:#EEF2FF; color:#312E81; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:800; margin-left:4px;">👤 ${escapeHtml(log.staffName)}${log.approvedBy ? ` (覆核:${escapeHtml(log.approvedBy)})` : ''}</span>` : ''}
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
      type: (grp && (grp.type === 'checkbox' || grp.type === 'qty')) ? grp.type : 'radio',
      minSelect: Math.max(0, parseInt((grp && grp.minSelect) || 0, 10) || 0),
      maxSelect: Math.max(0, parseInt((grp && grp.maxSelect) || 0, 10) || 0),
      choicesText: cText,
      rawSubOptionsByLabel: choicesArr.reduce((acc, c) => {
        if (Array.isArray(c) && Array.isArray(c[3]) && c[3].length > 0) acc[String(c[0])] = c[3];
        else if (c && typeof c === 'object' && Array.isArray(c.subOptions) && c.subOptions.length > 0) acc[String(c.label || c.name)] = c.subOptions;
        return acc;
      }, {})
    });
  });
  state.editingMenuTempOptions = groupsList;

  renderMenuEditModalBody(item);
  document.getElementById('menuEditModal')?.classList.add('open');
}

// #29 & 三-1：常用客製選項範本一鍵套用（新增：套餐附餐飲料含巢狀甜冰子規格 + 多數量加料計數器）
function applyModifierPresetToModal(presetKey) {
  const snapshot = syncTempModalInputsBeforeRerender();
  if (presetKey === 'combo_drink') {
    const drinkSubs = [
      { name: '甜度', choices: [['正常甜', 0], ['少糖', 0], ['微糖', 0], ['無糖', 0]] },
      { name: '冰塊', choices: [['正常冰', 0], ['少冰', 0], ['微冰', 0], ['去冰', 0]] }
    ];
    state.editingMenuTempOptions.push({
      name: '套餐附餐飲料',
      type: 'radio',
      minSelect: 1,
      maxSelect: 1,
      choicesText: '招牌紅茶, 四季青茶, 鮮奶茶+15, 不需飲料',
      rawSubOptionsByLabel: {
        '招牌紅茶': drinkSubs,
        '四季青茶': drinkSubs,
        '鮮奶茶': drinkSubs
      }
    });
    renderMenuEditModalBody(snapshot);
    showToast('⚡ 已套用「套餐附餐飲料（含巢狀甜度/冰塊子規格）」範本！');
    return;
  }
  if (presetKey === 'qty_addons') {
    state.editingMenuTempOptions.push({
      name: '多數量人氣加料',
      type: 'qty',
      minSelect: 0,
      maxSelect: 5,
      choicesText: '加香濃起司+15, 加溏心溫泉蛋+20, 加滷蛋+15'
    });
    renderMenuEditModalBody(snapshot);
    showToast('⚡ 已套用「多數量加料計數器（可加點 ×2、×3）」範本！');
    return;
  }

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
      type: grp.type === 'checkbox' ? 'checkbox' : (grp.type === 'qty' ? 'qty' : 'radio'),
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

    <div style="display:grid; grid-template-columns:1fr 0.7fr 1.1fr; gap:10px; margin-bottom:12px;">
      <div>
        <label class="field-label">🔪 廚房出餐站點（二-3）</label>
        <select id="editMenuStation" class="select-input">
          <option value="AUTO" ${(!item.station || item.station === 'AUTO') ? 'selected' : ''}>自動偵測 (AUTO)</option>
          <option value="MAIN" ${item.station === 'MAIN' ? 'selected' : ''}>🍳 主食飯麵 (MAIN)</option>
          <option value="SIDE" ${item.station === 'SIDE' ? 'selected' : ''}>🍗 炸物小菜 (SIDE)</option>
          <option value="DRINK" ${item.station === 'DRINK' ? 'selected' : ''}>🥤 湯品飲品 (DRINK)</option>
        </select>
      </div>
      <div>
        <label class="field-label">🔢 POS 排序權重</label>
        <input type="number" id="editMenuSortOrder" class="select-input" min="1" max="999" value="${Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 999}" placeholder="越小越前面">
      </div>
      <div>
        <label class="field-label">🎨 POS 色塊標記（二-4）</label>
        <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap; padding-top:4px;">
          <input type="hidden" id="editMenuTileColor" value="${escapeHtml(item.tileColor || '')}">
          ${['', '#EA580C', '#DC2626', '#D97706', '#059669', '#2563EB', '#7C3AED'].map(col => `
            <button type="button" onclick="document.getElementById('editMenuTileColor').value='${col}'; this.parentNode.querySelectorAll('button').forEach(b=>b.style.outline='none'); this.style.outline='2.5px solid #0F172A';" style="width:24px; height:24px; border-radius:6px; border:1px solid #CBD5E1; background:${col || '#FFFFFF'}; cursor:pointer; outline:${(item.tileColor || '') === col ? '2.5px solid #0F172A' : 'none'};" title="${col || '預設無色'}">${col ? '' : '✕'}</button>
          `).join('')}
        </div>
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
        <button type="button" class="pos-chip-btn" style="padding:3px 8px; font-size:0.72rem; background:#EEF2FF; color:#4338CA;" onclick="applyModifierPresetToModal('combo_drink')">🧋 套餐飲料(巢狀甜冰)</button>
        <button type="button" class="pos-chip-btn" style="padding:3px 8px; font-size:0.72rem; background:#FEF3C7; color:#92400E;" onclick="applyModifierPresetToModal('qty_addons')">🔢 多數量加料(×N)</button>
      </div>

      <div id="editMenuOptionGroupsContainer" style="display:flex; flex-direction:column; gap:8px;">
        ${state.editingMenuTempOptions.length === 0 ? `
          <div style="text-align:center; padding:14px; background:#F8FAFC; border:1px dashed var(--border); border-radius:10px; font-size:0.8rem; color:var(--text-muted);">
            此餐點目前為單點無客製選項（可點擊上方範本一鍵套用）。
          </div>
        ` : state.editingMenuTempOptions.map((g, gIdx) => `
          <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:10px; padding:10px;">
            <div style="display:grid; grid-template-columns:1.1fr 0.95fr auto; gap:6px; margin-bottom:6px;">
              <input type="text" class="select-input" style="padding:6px 8px; font-size:0.8rem;" placeholder="群組名稱 (如: 主食份量)" value="${escapeHtml(g.name)}" oninput="state.editingMenuTempOptions[${gIdx}].name=this.value">
              <select class="select-input" style="padding:6px 8px; font-size:0.8rem;" onchange="state.editingMenuTempOptions[${gIdx}].type=this.value; renderMenuEditModalBody(syncTempModalInputsBeforeRerender());">
                <option value="radio" ${g.type === 'radio' ? 'selected' : ''}>必選單選</option>
                <option value="checkbox" ${g.type === 'checkbox' ? 'selected' : ''}>可多選加料</option>
                <option value="qty" ${g.type === 'qty' ? 'selected' : ''}>多數量加購 (×N)</option>
              </select>
              <button type="button" class="btn-danger-soft" onclick="removeTempOptionGroupInModal(${gIdx})">刪</button>
            </div>
            ${(g.type === 'checkbox' || g.type === 'qty') ? `
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
                <input type="number" min="0" class="select-input" style="padding:4px 8px; font-size:0.74rem;" placeholder="最少必選數 (0=選填)" value="${g.minSelect || 0}" oninput="state.editingMenuTempOptions[${gIdx}].minSelect=parseInt(this.value||'0',10)||0">
                <input type="number" min="0" class="select-input" style="padding:4px 8px; font-size:0.74rem;" placeholder="最多可選數 (0=不限)" value="${g.maxSelect || 0}" oninput="state.editingMenuTempOptions[${gIdx}].maxSelect=parseInt(this.value||'0',10)||0">
              </div>
            ` : ''}
            <input type="text" class="select-input" style="padding:6px 8px; font-size:0.8rem;" placeholder="逗號分隔，加價寫+數字、單品售罄加[售罄]（例：加起司+15, 加溫泉蛋+15[售罄]）" value="${escapeHtml(g.choicesText)}" oninput="state.editingMenuTempOptions[${gIdx}].choicesText=this.value">
            ${g.rawSubOptionsByLabel && Object.keys(g.rawSubOptionsByLabel).length > 0 ? `<div style="font-size:0.72rem; color:#4338CA; font-weight:800; margin-top:4px;">↳ 已內嵌巢狀子規格（${escapeHtml(Object.keys(g.rawSubOptionsByLabel).join('、'))} 將動態展開甜度/冰塊）</div>` : ''}
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
    station: document.getElementById('editMenuStation')?.value || 'AUTO',
    tileColor: document.getElementById('editMenuTileColor')?.value || '',
    sortOrder: parseInt(document.getElementById('editMenuSortOrder')?.value || '999', 10),
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

async function saveEditedMenuItem() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  const idx = state.editingMenuStoreIndex;
  if (!store || idx < 0 || !store.menus[idx]) return;

  if (!isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride('修改餐點價格與規格', store.id);
    if (!mgrAuth) return;
    state.tempManagerOverridePin = mgrAuth.managerOverridePin;
  }

  const cat = document.getElementById('editMenuCat')?.value.trim() || '主廚推薦';
  const tag = document.getElementById('editMenuTag')?.value.trim() || '';
  const name = document.getElementById('editMenuName')?.value.trim();
  const nameEn = (document.getElementById('editMenuNameEn')?.value || '').trim().slice(0, 80);
  const station = document.getElementById('editMenuStation')?.value || 'AUTO';
  const tileColor = (document.getElementById('editMenuTileColor')?.value || '').trim().slice(0, 20);
  const sortOrderRaw = parseInt(document.getElementById('editMenuSortOrder')?.value || '999', 10);
  const sortOrder = Number.isFinite(sortOrderRaw) ? sortOrderRaw : 999;
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
    const subMap = (g.rawSubOptionsByLabel && typeof g.rawSubOptionsByLabel === 'object') ? g.rawSubOptionsByLabel : {};
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
        const subOpts = subMap[cName];
        if (Array.isArray(subOpts) && subOpts.length > 0) {
          return { label: cName, priceDelta: cPrice, soldOut: isSoldOut, subOptions: subOpts };
        }
        return isSoldOut ? [cName, cPrice, true] : [cName, cPrice];
      });
    if (choices.length > 0) {
      const grpObj = {
        type: (g.type === 'checkbox' || g.type === 'qty') ? g.type : 'radio',
        choices
      };
      if (grpObj.type === 'checkbox' || grpObj.type === 'qty') {
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
    station,
    tileColor,
    sortOrder,
    image: cleanImg,
    price,
    dailyLimit,
    remainingToday: dailyLimit > 0 ? Math.max(0, dailyLimit - (Number(store.menus[idx].soldToday) || 0)) : null,
    options: newOptions
  };

  state.lastLocalStoreConfigUpdateTs = Date.now();
  saveLocalStores(state.stores);
  syncSingleMenuItemToCloud(store, store.menus[idx]);
  recordMerchantAuditLog('編輯菜單與客製選項', `${name} (NT$${price}・站點:${station}${dailyLimit > 0 ? `・限量${dailyLimit}份` : ''})`);
  closeMenuEditModal();
  renderMerchantSettingsPanel(store);
  showToast(`✅ 已更新「${name}」之餐點設定、站點與客製選項！`);
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

function addStoreCouponItem() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  const code = String(document.getElementById('newCouponCodeInput')?.value || '').trim().toUpperCase().slice(0, 20);
  const type = document.getElementById('newCouponTypeSelect')?.value === 'PERCENT' ? 'PERCENT' : 'AMOUNT';
  const value = Math.max(1, parseInt(document.getElementById('newCouponValInput')?.value || '10', 10) || 10);
  const minSubtotal = Math.max(0, parseInt(document.getElementById('newCouponMinInput')?.value || '0', 10) || 0);
  if (!code) {
    showToast('⚠️ 請輸入優惠折扣碼（如 SCU15）');
    return;
  }
  if (!Array.isArray(store.coupons)) store.coupons = [];
  const existingIdx = store.coupons.findIndex(c => String(c.code).toUpperCase() === code);
  const item = { code, type, value, minSubtotal, active: true };
  if (existingIdx >= 0) store.coupons[existingIdx] = item;
  else store.coupons.push(item);
  saveLocalStores(state.stores);
  renderMerchantSettingsPanel(store);
  showToast(`🎟️ 已新增優惠碼「${code}」，請記得點擊下方「儲存設定」同步雲端！`);
}

function deleteStoreCouponItem(idx) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !Array.isArray(store.coupons)) return;
  store.coupons.splice(idx, 1);
  saveLocalStores(state.stores);
  renderMerchantSettingsPanel(store);
}

async function saveStaffSecurityConfig() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  let mgrPin = '';
  if (!isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride('設定員工收銀 PIN 與名單', store.id);
    if (!mgrAuth) return;
    mgrPin = mgrAuth.managerOverridePin;
  }
  const staffPin = String(document.getElementById('cfgStaffPinInput')?.value || '').trim();
  if (staffPin && !/^\d{4,8}$/.test(staffPin)) {
    showToast('⚠️ 收銀員 PIN 須為 4 至 8 位數字（或留空不變更）');
    return;
  }
  const staffListRaw = String(document.getElementById('cfgStaffListInput')?.value || '');
  const staffList = staffListRaw.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean).slice(0, 30);

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStaffSecurityConfig',
        ...getMerchantAuthPayload(),
        managerOverridePin: mgrPin,
        storeId: store.id,
        staffPin: staffPin || undefined,
        staffList: staffList
      })
    });
    const data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.message) || '更新員工權限設定失敗');
    }
    store.staffList = data.staffList || staffList;
    if (staffPin) store.hasStaffPin = true;
    saveLocalStores(state.stores);
    renderMerchantSettingsPanel(store);
    showToast(`✅ 已更新「${store.name}」員工分級權限與具名打卡名單！`);
  } catch (err) {
    showToast(`❌ ${translateServerError(err.message || '員工權限更新失敗')}`);
  }
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
  store.promoScope = document.getElementById('cfgPromoScope')?.value === 'ALL_DAY' ? 'ALL_DAY' : 'OFF_PEAK';
  store.promoMinSubtotal = Math.max(0, parseInt(document.getElementById('cfgPromoMinSubtotal')?.value || String(AI_DISCOUNT_MIN_SUBTOTAL), 10) || 0);
  store.promoText = document.getElementById('cfgPromoText')?.value.trim() || '';
  store.promoDiscount = Math.max(0, parseInt(document.getElementById('cfgPromoDiscount')?.value || '0', 10));
  store.secondItemDiscount = store.promoMode === 'second_discount' ? store.promoDiscount : (store.secondItemDiscount || 0);
  store.giftMenuItemId = document.getElementById('cfgGiftMenuItemId')?.value || '';
  store.allowDineInPostPay = document.getElementById('cfgAllowDineInPostPay')?.value === 'true';

  state.lastLocalStoreConfigUpdateTs = Date.now();
  enrichStoresAndAi();
  saveLocalStores(state.stores);
  renderMerchantView();
  showToast(`✅ 已儲存「${store.name}」行銷優惠、優惠券與內用設定！`);

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStoreConfig',
        ...getMerchantAuthPayload(),
        managerOverridePin: state.tempManagerOverridePin || '',
        storeId: store.id,
        isOpen: store.isOpen,
        cutleryPrice: store.cutleryPrice,
        basePrepMinutes: store.basePrepMinutes,
        maxCapacityPer15Min: store.maxCapacityPer15Min,
        reserveLeadMinutes: store.reserveLeadMinutes,
        baseQueueOffset: store.baseQueueOffset,
        activeOrders: store.activeOrders,
        promoMode: store.promoMode,
        promoScope: store.promoScope,
        promoMinSubtotal: store.promoMinSubtotal,
        promoText: store.promoText,
        promoDiscount: store.promoDiscount,
        secondItemDiscount: store.secondItemDiscount,
        giftMenuItemId: store.giftMenuItemId,
        coupons: Array.isArray(store.coupons) ? store.coupons : [],
        allowDineInPostPay: store.allowDineInPostPay
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