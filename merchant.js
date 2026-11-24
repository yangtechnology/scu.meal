// =========================================================================
// MealFlow v25.0 — 店家 POS / KDS / 權威日結 / 全區間分析 / 設定 / ESC-POS 點陣直印模組
// 僅於 /store/ 頁面載入（或根目錄切入店務模式時動態載入），學生點餐端不下載此模組
// =========================================================================

// ==================== 二-1 套餐附餐/子項目自動拆站引擎（主餐留廚房、套餐飲料/湯品自動派至 DRINK/SIDE 站） ====================
function expandOrderItemsForStations(items, storeObj = null) {
  const list = Array.isArray(items) ? items : [];
  const expanded = [];
  list.forEach((it, idx) => {
    if (!it) return;
    const baseStation = typeof classifyItemKitchenStation === 'function' ? classifyItemKitchenStation(it, storeObj) : 'MAIN';
    expanded.push({
      ...it,
      __itemKey: `${idx}__${it.id || it.baseName || it.name || 'item'}`,
      __station: baseStation,
      isVirtualSubItem: false
    });
    const sels = it.selections && typeof it.selections === 'object' ? it.selections : {};
    Object.keys(sels).forEach((k, sIdx) => {
      const val = sels[k];
      if (!val) return;
      const valStr = Array.isArray(val) ? val.join(', ') : String(val);
      const isDrinkKey = /(套餐附餐飲料|附餐飲料|附餐飲品|飲品|飲料|Drink|Beverage)/i.test(k);
      const isSideKey = /(附餐小菜|套餐附餐|附湯|副餐|Side|Soup)/i.test(k) && !isDrinkKey;
      if ((isDrinkKey || isSideKey) && !/不需|不要|無|None/i.test(valStr)) {
        const cleanVal = valStr.replace(/\(\+\$?\d+\)/g, '').trim();
        if (!cleanVal) return;
        const subStation = isDrinkKey ? 'DRINK' : 'SIDE';
        // 若主品項本身不是同站點，才產生虛擬拆站子項目避免重複計算
        if (baseStation !== subStation) {
          expanded.push({
            id: `${it.id || 'COMBO'}_SUB_${sIdx}`,
            baseName: `${cleanVal} (${t('套餐附餐', 'Combo', 'セット', '세트')}: ${it.baseName || it.name})`,
            name: `${cleanVal} (${t('套餐附餐', 'Combo', 'セット', '세트')})`,
            qty: Number(it.qty) || 1,
            price: 0,
            selections: {},
            itemNote: it.itemNote || '',
            __itemKey: `${idx}_sub_${sIdx}`,
            __station: subStation,
            isVirtualSubItem: true,
            parentItemName: it.baseName || it.name || ''
          });
        }
      }
    });
  });
  return expanded;
}

// ==================== 一-3 真實熱感應出單機 ESC/POS 點陣圖中文直印 (GS v 0) + 自動重連 + 分站派單 ====================
const HW_PRINTER_STORAGE_KEY = 'mealflow_hw_printers_v25';

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
    if (!r) return t('未連線', 'Not Connected', '未接続', '미연결');
    if (r.device) return `🟢 WebUSB (${r.device.productName || 'ESC/POS'})`;
    if (r.port) return `🟢 WebSerial (${t('已連線', 'Connected', '接続済', '연결됨')})`;
    return t('⚪ 未配對（降級為瀏覽器列印）', '⚪ Not Paired (Browser Print Fallback)', '⚪ 未接続（ブラウザ印刷）', '⚪ 미연결 (브라우저 인쇄)');
  },

  savePairedMeta(routeKey, meta) {
    try {
      const cur = JSON.parse(localStorage.getItem(HW_PRINTER_STORAGE_KEY) || '{}');
      cur[routeKey] = { ...meta, savedAt: Date.now() };
      localStorage.setItem(HW_PRINTER_STORAGE_KEY, JSON.stringify(cur));
    } catch (e) {}
  },

  async autoReconnect() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(HW_PRINTER_STORAGE_KEY) || '{}'); } catch (e) {}
    const routeKeys = Object.keys(saved);
    if (routeKeys.length === 0) return 0;
    let reconnectedCount = 0;

    if (typeof navigator !== 'undefined' && navigator.usb && typeof navigator.usb.getDevices === 'function') {
      try {
        const devices = await navigator.usb.getDevices();
        for (const rk of routeKeys) {
          const meta = saved[rk];
          const r = this.routes[rk];
          if (!r || !meta || meta.transport !== 'usb' || r.device) continue;
          const match = devices.find(d => d.vendorId === meta.vendorId && d.productId === meta.productId);
          if (match) {
            try {
              if (!match.opened) await match.open();
              if (match.configuration === null) await match.selectConfiguration(1);
              const iface = match.configuration.interfaces[0];
              await match.claimInterface(iface.interfaceNumber);
              const outEp = (iface.alternate.endpoints || []).find(ep => ep.direction === 'out');
              r.device = match;
              r.port = null;
              r.transport = 'usb';
              r.endpointOut = outEp ? outEp.endpointNumber : 1;
              reconnectedCount++;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    if (typeof navigator !== 'undefined' && navigator.serial && typeof navigator.serial.getPorts === 'function') {
      try {
        const ports = await navigator.serial.getPorts();
        for (const rk of routeKeys) {
          const meta = saved[rk];
          const r = this.routes[rk];
          if (!r || !meta || meta.transport !== 'serial' || r.port) continue;
          const port = ports[meta.portIndex || 0];
          if (port) {
            try {
              if (!port.writable) await port.open({ baudRate: meta.baudRate || 9600 });
              r.port = port;
              r.device = null;
              r.transport = 'serial';
              reconnectedCount++;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
    return reconnectedCount;
  },

  async connect(routeKey = 'COUNTER', transport = 'usb') {
    const r = this.routes[routeKey];
    if (!r) return false;
    try {
      if (transport === 'serial') {
        if (!('serial' in navigator)) {
          showToast(t('⚠️ 此瀏覽器不支援 WebSerial（請使用桌面版或平板 Chrome / Edge）', '⚠️ WebSerial not supported in this browser (use Chrome / Edge)'));
          return false;
        }
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        r.port = port;
        r.device = null;
        r.transport = 'serial';
        this.savePairedMeta(routeKey, { transport: 'serial', baudRate: 9600, portIndex: 0 });
        showToast(`✅ ${t(`已透過 WebSerial 連接「${r.label}」`, `Connected via WebSerial (${routeKey})`)}`);
        return true;
      }
      if (!('usb' in navigator)) {
        showToast(t('⚠️ 此瀏覽器不支援 WebUSB（請使用 Chrome / Edge，或改用 WebSerial）', '⚠️ WebUSB not supported (use Chrome / Edge or WebSerial)'));
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
      this.savePairedMeta(routeKey, { transport: 'usb', vendorId: device.vendorId, productId: device.productId, productName: device.productName || '' });
      showToast(`✅ ${t(`已透過 WebUSB 連接「${r.label}」`, `Connected via WebUSB (${device.productName || routeKey})`)}`);
      return true;
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        showToast(`⚠️ ${t('印表機連線失敗', 'Printer connection failed')}：${err.message || err}`);
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
      showToast(`⚠️ ${t('硬體出單傳輸異常', 'Printer transfer error')}：${e.message || e}`);
    }
    return false;
  },

  // 一-3：HTML5 Canvas → 1-bit 黑白點陣圖 (ESC/POS GS v 0)，徹底根治繁體中文熱感機 Big5/UTF-8 亂碼！
  renderReceiptLinesToEscPosRaster(lines, paperWidthPx = 384) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    try {
      const canvas = document.createElement('canvas');
      if (!canvas || typeof canvas.getContext !== 'function') return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const widthPx = Math.ceil(paperWidthPx / 8) * 8;
      let totalHeight = 16;
      const specLines = (Array.isArray(lines) ? lines : []).map(entry => {
        const obj = typeof entry === 'string' ? { text: entry, size: 22, bold: false, align: 'left' } : entry;
        const lh = Math.round((obj.size || 22) * 1.4);
        totalHeight += lh;
        return { ...obj, lh };
      });
      totalHeight += 20;

      canvas.width = widthPx;
      canvas.height = Math.min(2400, Math.max(48, totalHeight));
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'top';

      let y = 10;
      specLines.forEach(line => {
        const fontSize = line.size || 22;
        ctx.font = `${line.bold ? 'bold ' : ''}${fontSize}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
        ctx.textAlign = line.align || 'left';
        const x = line.align === 'center' ? widthPx / 2 : (line.align === 'right' ? widthPx - 8 : 8);
        ctx.fillText(String(line.text || ''), x, y, widthPx - 16);
        y += line.lh;
      });

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const bytesPerRow = widthPx / 8;
      const height = canvas.height;
      const header = new Uint8Array([
        0x1D, 0x76, 0x30, 0x00,
        bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
        height & 0xFF, (height >> 8) & 0xFF
      ]);
      const bitmap = new Uint8Array(bytesPerRow * height);
      for (let row = 0; row < height; row++) {
        for (let bx = 0; bx < bytesPerRow; bx++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            const px = bx * 8 + bit;
            const idx = (row * widthPx + px) * 4;
            const gray = imgData[idx] * 0.299 + imgData[idx + 1] * 0.587 + imgData[idx + 2] * 0.114;
            if (gray < 160) byteVal |= (0x80 >> bit);
          }
          bitmap[row * bytesPerRow + bx] = byteVal;
        }
      }
      const out = new Uint8Array(header.length + bitmap.length);
      out.set(header, 0);
      out.set(bitmap, header.length);
      return out;
    } catch (e) {
      return null;
    }
  },

  buildEscPosTicketBytes(order, ticketKind = 'COUNTER', kickDrawer = false) {
    const chunks = [];
    const pushRaw = (arr) => chunks.push(new Uint8Array(arr));

    pushRaw([0x1B, 0x40]); // ESC @ 初始化印表機
    if (kickDrawer) {
      pushRaw([0x1B, 0x70, 0x00, 0x19, 0xFA]); // ESC p 0 25 250 彈開現金錢箱
    }

    const kindLabel = ticketKind === 'KITCHEN' ? '廚房工單' : ticketKind === 'DRINK' ? '飲品吧台單' : '顧客收據聯';
    const rasterLines = [
      { text: `#${order.pickupNumber || 'A001'}`, size: 44, bold: true, align: 'center' },
      { text: `${order.storeName || 'MealFlow'} [${kindLabel}]`, size: 22, bold: true, align: 'center' },
      { text: `${order.dineType || '取餐'}${order.isReservation ? ' (預訂 ' + (order.pickupTime || '') + ')' : ''}`, size: 20, bold: false, align: 'center' },
      { text: '--------------------------------', size: 18, bold: false, align: 'left' }
    ];
    const items = Array.isArray(order.structuredItems) ? order.structuredItems : [];
    items.forEach(it => {
      const qty = Number(it.qty) || 1;
      const linePrice = ticketKind === 'COUNTER' ? `  $${(Number(it.price) || 0) * qty}` : '';
      rasterLines.push({ text: `${it.baseName || it.name} ×${qty}${linePrice}`, size: 24, bold: true, align: 'left' });
      const sels = it.selections && Object.keys(it.selections).length > 0 ? Object.values(it.selections).join(' / ') : '';
      if (sels) rasterLines.push({ text: `  (${sels})`, size: 18, bold: false, align: 'left' });
      if (it.itemNote) rasterLines.push({ text: `  備註: ${it.itemNote}`, size: 18, bold: true, align: 'left' });
    });
    rasterLines.push({ text: '--------------------------------', size: 18, bold: false, align: 'left' });
    if (ticketKind === 'COUNTER') {
      if (Number(order.serviceFee) > 0) rasterLines.push({ text: `服務費: +NT$ ${order.serviceFee}`, size: 18, bold: false, align: 'left' });
      rasterLines.push({ text: `總計: NT$ ${order.finalTotal || 0} (${order.paymentMethod || '現金'})`, size: 24, bold: true, align: 'left' });
      if (order.taxId) rasterLines.push({ text: `統一編號: ${order.taxId}`, size: 18, bold: false, align: 'left' });
      if (order.verificationCode) rasterLines.push({ text: `防偽核銷碼: ${order.verificationCode}`, size: 20, bold: true, align: 'left' });
    }
    rasterLines.push({ text: `時間: ${order.pickupDate || ''} ${order.createdAt || ''}`, size: 18, bold: false, align: 'left' });

    const rasterBytes = this.renderReceiptLinesToEscPosRaster(rasterLines, 384);
    if (rasterBytes && rasterBytes.length > 8) {
      chunks.push(rasterBytes);
    } else {
      // 無 Canvas 環境降級為純文字 ESC/POS 指令（測試與 Headless 環境安全運作）
      const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
      const pushLine = (str) => {
        const txt = String(str || '') + '\n';
        if (encoder) chunks.push(encoder.encode(txt));
        else {
          const b = new Uint8Array(txt.length);
          for (let i = 0; i < txt.length; i++) b[i] = txt.charCodeAt(i) & 0x7f;
          chunks.push(b);
        }
      };
      rasterLines.forEach(l => pushLine(l.text));
    }

    pushRaw([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00]); // 進紙 + GS V 66 0 局部自動切紙

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
    // 二-1：套用套餐附餐拆站，讓套餐附餐飲料也能正確派至 DRINK 印表機！
    const expandedItems = expandOrderItemsForStations(Array.isArray(order.structuredItems) ? order.structuredItems : [], store);
    const kitchenItems = expandedItems.filter(it => it.__station !== 'DRINK');
    const drinkItems = expandedItems.filter(it => it.__station === 'DRINK');

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

// 載入 merchant.js 後於背景嘗試靜默重連先前已配對之 WebUSB / WebSerial 出單機
if (typeof window !== 'undefined') {
  setTimeout(() => { MerchantHardwarePrinter.autoReconnect().catch(() => {}); }, 800);
}

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
  state.posDiscountPercent = 0;
  state.posServiceFeeRate = 0;
  state.posManualDiscountReason = '';
  state.analyticsCloudData = null;
  state.shiftZReportCloudData = null;
  const topSel = document.getElementById('storeTopSwitcher');
  if (topSel && topSel.value !== storeId) topSel.value = storeId;
  syncUrlStateWithHistory(true);

  // A8：系統開發者角色 (DEVELOPER) 可無縫切換所有店鋪維護，不需重複輸入店家密碼！
  if (typeof isCurrentMerchantDeveloper === 'function' && isCurrentMerchantDeveloper() && isMerchantSessionValidNow()) {
    const targetStore = state.stores.find(s => s.id === storeId);
    showToast(`🛠️ ${t(`開發者已切換至「${targetStore ? targetStore.name : storeId}」`, `Developer switched to "${targetStore ? trTerm(targetStore.name) : storeId}"`)}`);
    renderMerchantView();
    if (typeof syncMealFlowRealtimeSubscriptions === 'function') syncMealFlowRealtimeSubscriptions();
    syncCloud(false);
    return;
  }

  // #7：各店獨立密碼保護 — 非開發者切換店鋪時強制輸入新店密碼
  if (prevStoreId !== storeId || !isMerchantSessionValidNow()) {
    const targetStore = state.stores.find(s => s.id === storeId);
    showToast(`🔒 ${t(`已切換至「${targetStore ? targetStore.name : storeId}」，請輸入該店專屬授權碼解鎖`, `Switched to "${targetStore ? trTerm(targetStore.name) : storeId}". Please enter store PIN.`)}`);
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
    showToast(store.isOpen ? `🟢 「${store.name}」已恢復正常營業！` : `⛔ 「${store.name}」已設為暫停營業（已全面停止現場點餐與預訂）`);
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
  if (item.soldOut) {
    // 已經售罄：點一下立即重新上架
    await applyMenuSoldOutChange(menuIdx, false, 'NONE');
    return;
  }
  // B13：目前供應中 → 跳出 1 秒快選視窗（本日售完 vs 完全售完/長期缺貨）
  openSoldOutTypeChoiceModal(menuIdx);
}

function openSoldOutTypeChoiceModal(menuIdx) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[menuIdx]) return;
  const item = store.menus[menuIdx];
  const policyDesc = store.morningSoldOutPolicy === 'AUTO_RESTORE'
    ? t('隔日自動恢復上架（可於設定改為早班開機詢問）', 'Auto-restocks tomorrow (changeable in Settings)', '翌日自動再開', '다음날 자동 재입고')
    : t('明日早班開機時自動跳出詢問是否恢復上架', 'Prompts for morning restock review tomorrow', '翌朝営業時に再開確認を表示', '내일 오전 오픈 시 재입고 확인 표시');

  let modal = document.getElementById('soldOutChoiceModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="soldOutChoiceModal" class="modal-overlay" style="z-index:1500;" onclick="if(event.target===this) closeSoldOutTypeChoiceModal()">
        <div class="modal-card" style="max-width:420px;">
          <div class="modal-header" style="background:#0F172A; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#FBBF24;">${t('品項售罄模式快選', 'Sold-Out Mode Selection', '品切れモード選択', '품절 모드 선택')}</span>
              <h3 id="soldOutChoiceTitle" style="font-size:1.08rem; font-weight:900; margin-top:2px;"></h3>
            </div>
            <button type="button" onclick="closeSoldOutTypeChoiceModal()" style="border:none; background:rgba(255,255,255,0.2); color:#fff; width:32px; height:32px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="soldOutChoiceBody"></div>
        </div>
      </div>
    `);
    modal = document.getElementById('soldOutChoiceModal');
  }
  const titleEl = document.getElementById('soldOutChoiceTitle');
  const bodyEl = document.getElementById('soldOutChoiceBody');
  if (titleEl) titleEl.innerText = `${trDishName(item)} (${trTerm(item.category || '')})`;
  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button type="button" class="pos-quick-choice-btn" style="background:#FFFBEB; border-color:#F59E0B; color:#92400E; text-align:left; padding:14px;" onclick="closeSoldOutTypeChoiceModal(); applyMenuSoldOutChange(${menuIdx}, true, 'TODAY');">
          <div style="font-size:1rem; font-weight:950;">📅 ${t('本日售完（今日暫停）', 'Sold Out Today', '本日完売', '오늘 품절')}</div>
          <div style="font-size:0.76rem; font-weight:700; margin-top:3px; opacity:0.9;">${escapeHtml(policyDesc)}</div>
        </button>
        <button type="button" class="pos-quick-choice-btn" style="background:#FEF2F2; border-color:#EF4444; color:#991B1B; text-align:left; padding:14px;" onclick="closeSoldOutTypeChoiceModal(); applyMenuSoldOutChange(${menuIdx}, true, 'PERMANENT');">
          <div style="font-size:1rem; font-weight:950;">🚫 ${t('完全售完 / 長期缺貨', 'Permanently Out of Stock', '長期品切れ（入荷待ち）', '장기 품절 (재입고 대기)')}</div>
          <div style="font-size:0.76rem; font-weight:700; margin-top:3px; opacity:0.9;">${t('跨日不會自動上架，直到您手動按「上架」才恢復供應', 'Stays sold out across days until manually restocked', '手動で再開するまで品切れを維持します', '수동으로 재입고할 때까지 품절이 유지됩니다')}</div>
        </button>
        <button type="button" class="btn-outline" style="width:100%;" onclick="closeSoldOutTypeChoiceModal()">${t('取消', 'Cancel', 'キャンセル', '취소')}</button>
      </div>
    `;
  }
  modal.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
}

function closeSoldOutTypeChoiceModal() {
  document.getElementById('soldOutChoiceModal')?.classList.remove('open');
}

async function applyMenuSoldOutChange(menuIdx, targetSoldOut, soldOutType = 'TODAY') {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !store.menus[menuIdx]) return;
  const item = store.menus[menuIdx];
  const prevState = {
    soldOut: Boolean(item.soldOut),
    soldOutType: item.soldOutType || 'NONE',
    soldOutDate: item.soldOutDate || '',
    needsMorningReview: Boolean(item.needsMorningReview)
  };
  const todayStr = getTodayDateStr();
  item.soldOut = Boolean(targetSoldOut);
  item.soldOutType = targetSoldOut ? (soldOutType === 'PERMANENT' ? 'PERMANENT' : 'TODAY') : 'NONE';
  item.soldOutDate = targetSoldOut ? todayStr : '';
  item.needsMorningReview = false;
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
        soldOut: item.soldOut,
        soldOutType: item.soldOutType,
        soldOutDate: item.soldOutDate
      })
    });
    const data = await res.json();
    if (!data || !data.success) {
      if (data && String(data.message || '').includes('未知的操作請求')) {
        await syncStoreMenuToCloud(store);
      } else {
        Object.assign(item, prevState);
        saveLocalStores(state.stores);
        renderMerchantView();
        showToast(`❌ 切換售罄狀態失敗已還原：${(data && data.message) || '請重試'}`);
        return;
      }
    }
    const modeLabel = item.soldOutType === 'PERMANENT' ? t('完全售完 / 長期缺貨', 'Permanently Out') : t('本日售完', 'Sold Out Today');
    showToast(item.soldOut ? `🚫 已將「${item.name}」標記為「${modeLabel}」` : `🟢 已將「${item.name}」恢復正常供應`);
  } catch (e) {
    showToast(item.soldOut ? `⚠️ 離線中：已先於本機標記「${item.name}」售罄` : `⚠️ 離線中：已先於本機恢復「${item.name}」供應`);
  }
}

// B13：每日早班開機自動詢問「昨日標記本日售完之品項是否今日恢復上架」
function checkAndPromptMorningSoldOutReview(store) {
  if (!store || !state.isMerchantUnlocked) return;
  if (store.morningSoldOutPolicy === 'AUTO_RESTORE') return;
  const todayStr = getTodayDateStr();
  const seenKey = `mealflow_morning_review_seen_${store.id}_${todayStr}`;
  try {
    if (localStorage.getItem(seenKey) === '1') return;
  } catch (e) {}
  const reviewItems = (store.menus || []).filter(m => m && m.soldOut && m.needsMorningReview === true);
  if (reviewItems.length === 0) return;

  try { localStorage.setItem(seenKey, '1'); } catch (e) {}
  let modal = document.getElementById('morningSoldOutReviewModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="morningSoldOutReviewModal" class="modal-overlay" style="z-index:1520;">
        <div class="modal-card" style="max-width:480px;">
          <div class="modal-header" style="background:linear-gradient(135deg, #EA580C 0%, #D97706 100%); color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; opacity:0.92;">🌅 ${t('早班開機補貨確認', 'Morning Restock Check', '朝の在庫再開確認', '오전 오픈 재입고 확인')}</span>
              <h3 style="font-size:1.1rem; font-weight:950; margin-top:2px;">${t('昨日「本日售完」品項今日要重新上架嗎？', 'Restock yesterday\'s sold-out items today?', '昨日の本日完売メニューを再開しますか？', '어제 품절 메뉴를 오늘 다시 판매할까요?')}</h3>
            </div>
            <button type="button" onclick="closeMorningSoldOutReviewModal()" style="border:none; background:rgba(255,255,255,0.22); color:#fff; width:32px; height:32px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="morningSoldOutReviewBody"></div>
        </div>
      </div>
    `);
    modal = document.getElementById('morningSoldOutReviewModal');
  }
  const body = document.getElementById('morningSoldOutReviewBody');
  if (body) {
    body.innerHTML = `
      <p style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:10px;">
        ${t('以下品項昨日曾標記「本日售完」，請勾選今日已備妥要重新上架販售的品項（未勾選將維持今日售完）：', 'Check items ready to restock today (unchecked items stay sold out today):')}
      </p>
      <div style="display:flex; flex-direction:column; gap:6px; max-height:260px; overflow-y:auto; margin-bottom:14px;">
        ${reviewItems.map(m => `
          <label style="display:flex; align-items:center; gap:10px; background:#F8FAFC; border:1.5px solid #FED7AA; border-radius:10px; padding:10px 12px; cursor:pointer;">
            <input type="checkbox" class="morning-restock-chk" value="${escapeHtml(m.id)}" checked style="width:19px; height:19px; accent-color:#059669;">
            <div style="flex:1;">
              <div data-dish-name="1" style="font-weight:900; font-size:0.92rem; color:var(--text-primary);">${escapeHtml(trDishName(m))}</div>
              <div style="font-size:0.74rem; color:var(--text-secondary);">${escapeHtml(trTerm(m.category || ''))} · NT$${m.price}</div>
            </div>
          </label>
        `).join('')}
      </div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn-outline" style="flex:1;" onclick="closeMorningSoldOutReviewModal()">${t('維持全部售完', 'Keep All Out')}</button>
        <button type="button" class="btn-primary-full" style="flex:1.6;" onclick="submitMorningSoldOutRestock()">🟢 ${t('確認並同步上架', 'Restock Selected')}</button>
      </div>
    `;
  }
  modal.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
}

function closeMorningSoldOutReviewModal() {
  document.getElementById('morningSoldOutReviewModal')?.classList.remove('open');
}

async function submitMorningSoldOutRestock() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  const checkedIds = Array.from(document.querySelectorAll('.morning-restock-chk:checked')).map(el => String(el.value || '').trim()).filter(Boolean);
  const allReviewIds = Array.from(document.querySelectorAll('.morning-restock-chk')).map(el => String(el.value || '').trim()).filter(Boolean);
  const keepSoldOutIds = allReviewIds.filter(id => !checkedIds.includes(id));

  await withActiveButtonBusy(async () => {
    const todayStr = getTodayDateStr();
    (store.menus || []).forEach(m => {
      if (checkedIds.includes(String(m.id))) {
        m.soldOut = false;
        m.soldOutType = 'NONE';
        m.soldOutDate = '';
        m.needsMorningReview = false;
      } else if (keepSoldOutIds.includes(String(m.id))) {
        m.soldOut = true;
        m.soldOutType = 'TODAY';
        m.soldOutDate = todayStr;
        m.needsMorningReview = false;
      }
    });
    state.lastLocalStoreConfigUpdateTs = Date.now();
    saveLocalStores(state.stores);
    closeMorningSoldOutReviewModal();
    renderMerchantView();

    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'restoreSoldOutMenusBatch',
          ...getMerchantAuthPayload(),
          storeId: store.id,
          restoreMenuIds: checkedIds,
          keepSoldOutIds: keepSoldOutIds
        })
      });
      showToast(`🌅 已恢復上架 ${checkedIds.length} 道餐點並同步雲端！`);
    } catch (e) {
      showToast(`⚠️ 已於本機恢復上架 ${checkedIds.length} 道餐點`);
    }
  }, t('⏳ 同步上架中...', '⏳ Restocking...'));
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
  const isDev = typeof isCurrentMerchantDeveloper === 'function' && isCurrentMerchantDeveloper();
  const isSingleTerminalLocked = !isDev && Boolean(state.boundMerchantStoreId || state.urlLockedStoreId || state.merchantAuthorizedStoreScope === store.id);
  let nameplateEl = document.getElementById('storeTerminalNameplate');
  const displayStaffName = trTerm(state.merchantStaffName || (isDev ? '系統開發者' : (isCurrentMerchantManager() ? '店長' : '收銀員')));
  const roleTagStr = isDev
    ? `🛠️ ${t('開發者', 'Developer', '開発者', '개발자')}`
    : (isCurrentMerchantManager()
        ? `👑 ${escapeHtml(displayStaffName)}`
        : `👤 ${escapeHtml(displayStaffName)}`);

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
      topSel.innerHTML = state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>${escapeHtml(trTerm(s.campus))} — ${escapeHtml(trTerm(s.name))} ${s.isOpen === false ? `(${t('暫停中', 'Paused', '休止中', '중지됨')})` : ''}</option>`).join('');
      if (isDev) {
        if (!nameplateEl) {
          topSel.insertAdjacentHTML('afterend', `<span id="storeTerminalNameplate" class="store-terminal-nameplate"></span>`);
          nameplateEl = document.getElementById('storeTerminalNameplate');
        }
        if (nameplateEl) {
          nameplateEl.style.display = 'inline-flex';
          nameplateEl.innerHTML = `<span class="dev-role-badge">${roleTagStr}</span>`;
        }
      } else if (nameplateEl) {
        nameplateEl.style.display = 'none';
      }
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
  checkAndPromptMorningSoldOutReview(store);
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
  state.posDiscountPercent = 0;
  state.posServiceFeeRate = 0;
  state.posManualDiscountReason = '';
  state.posCustomerNote = '';
  state.posTaxId = '';
  state.posLinePayOneTimeKey = '';
  state.posLinePayManualConfirmed = false;
  state.posLinePayManualRef = '';
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

// 一-4：POS 單品行內備註與單品招待 / 折扣
async function promptPosCartItemNote(idx) {
  const it = state.posCart[idx];
  if (!it) return;
  const val = await showAppPromptModal({
    title: `📝 ${t('單品廚房備註', 'Item Kitchen Note', '単品キッチンメモ', '단품 주방 메모')}：${trDishName(it)}`,
    message: t('輸入該品項專屬製作備註（如：不加蔥、醬料分開、去冰半糖），留空清除：', 'Enter item-specific kitchen note (blank to clear):', '調理メモを入力（空欄でクリア）：', '단품 조리 요청사항 입력 (비우면 삭제):'),
    defaultValue: it.itemNote || '',
    placeholder: t('例：不要香菜、辣醬分開', 'e.g. No cilantro, sauce on side'),
    confirmText: t('儲存備註', 'Save Note', 'メモ保存', '메모 저장')
  });
  if (val === null) return;
  it.itemNote = String(val || '').trim().slice(0, 60);
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

// B10：POS 單品招待 / 折扣全面改為「一鍵圖示按鈕」（徹底消除輸入 COMP / OFF / RESET 英文指令）
function openPosItemDiscountModal(idx) {
  const it = state.posCart[idx];
  if (!it) return;
  const origPrice = Number(it.origUnitPrice !== undefined ? it.origUnitPrice : it.price) || 0;

  let modal = document.getElementById('posItemDiscountModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="posItemDiscountModal" class="modal-overlay" style="z-index:1500;" onclick="if(event.target===this) closePosItemDiscountModal()">
        <div class="modal-card" style="max-width:420px;">
          <div class="modal-header" style="background:#0F172A; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#34D399;">🎁 ${t('單品招待 / 單品快速折讓', 'Quick Item Comp & Discount', '単品サービス・クイック割引', '단품 무료 / 빠른 할인')}</span>
              <h3 id="posItemDiscTitle" style="font-size:1.08rem; font-weight:900; margin-top:2px;"></h3>
            </div>
            <button type="button" onclick="closePosItemDiscountModal()" style="border:none; background:rgba(255,255,255,0.2); color:#fff; width:32px; height:32px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="posItemDiscBody"></div>
        </div>
      </div>
    `);
    modal = document.getElementById('posItemDiscountModal');
  }
  const titleEl = document.getElementById('posItemDiscTitle');
  const bodyEl = document.getElementById('posItemDiscBody');
  if (titleEl) titleEl.innerText = `${trDishName(it)} (${t('原價', 'Orig', '定価', '원가')} NT$${origPrice})`;
  if (bodyEl) {
    const disc90 = Math.max(0, origPrice - Math.round(origPrice * 0.9));
    const disc80 = Math.max(0, origPrice - Math.round(origPrice * 0.8));
    bodyEl.innerHTML = `
      <div class="pos-quick-choice-grid" style="margin-bottom:12px;">
        <button type="button" class="pos-quick-choice-btn ${it.itemComp ? 'active' : ''}" style="grid-column:1 / -1; background:#ECFDF5; border-color:#10B981; color:#065F46;" onclick="applyPosItemQuickDiscount(${idx}, 'COMP', ${origPrice})">
          🎁 ${t('全免招待 ($0)', 'Comp Free ($0)', '全額サービス ($0)', '전액 무료 ($0)')}
        </button>
        ${[5, 10, 15, 20].map(amt => `
          <button type="button" class="pos-quick-choice-btn ${!it.itemComp && Number(it.itemDiscountAmount) === amt ? 'active' : ''}" onclick="applyPosItemQuickDiscount(${idx}, 'OFF', ${amt})">
            💸 -$${amt}
          </button>
        `).join('')}
        <button type="button" class="pos-quick-choice-btn" onclick="applyPosItemQuickDiscount(${idx}, 'OFF', ${disc90})">
          🏷️ ${t('9 折', '10% Off', '10%割引', '10% 할인')} (-$${disc90})
        </button>
        <button type="button" class="pos-quick-choice-btn" onclick="applyPosItemQuickDiscount(${idx}, 'OFF', ${disc80})">
          🏷️ ${t('8 折', '20% Off', '20%割引', '20% 할인')} (-$${disc80})
        </button>
      </div>
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <input type="number" id="posItemCustomOffInput" min="0" max="${origPrice}" class="select-input" placeholder="${t('自訂折抵金額 (NT$)', 'Custom discount (NT$)', 'カスタム割引額 (NT$)', '직접 할인 금액 (NT$)')}" value="${Number(it.itemDiscountAmount) > 0 && !it.itemComp ? Number(it.itemDiscountAmount) : ''}">
        <button type="button" class="btn-tip-action" style="white-space:nowrap; padding:0 16px;" onclick="applyPosItemQuickDiscount(${idx}, 'CUSTOM', 0)">${t('套用', 'Apply', '適用', '적용')}</button>
      </div>
      <button type="button" class="btn-outline" style="width:100%;" onclick="applyPosItemQuickDiscount(${idx}, 'RESET', 0)">
        ↺ ${t(`恢復原價 (NT$${origPrice})`, `Restore Original Price (NT$${origPrice})`, `定価に戻す (NT$${origPrice})`, `원가 복원 (NT$${origPrice})`)}
      </button>
    `;
  }
  modal.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
}

function closePosItemDiscountModal() {
  document.getElementById('posItemDiscountModal')?.classList.remove('open');
}

async function applyPosItemQuickDiscount(idx, mode, presetVal = 0) {
  const it = state.posCart[idx];
  if (!it) return;
  const origPrice = Number(it.origUnitPrice !== undefined ? it.origUnitPrice : it.price) || 0;
  closePosItemDiscountModal();

  if (mode === 'RESET') {
    it.price = origPrice;
    it.itemComp = false;
    it.itemDiscountAmount = 0;
  } else if (mode === 'COMP') {
    if (!isCurrentMerchantManager()) {
      const mgr = await requestManagerPinOverride(t(`單品招待 (${it.baseName || it.name})`, `Item Comp (${it.baseName || it.name})`));
      if (!mgr) return;
      state.posDiscountOverridePin = mgr.managerOverridePin;
    }
    it.origUnitPrice = origPrice;
    it.price = 0;
    it.itemComp = true;
    it.itemDiscountAmount = origPrice;
  } else {
    const rawOff = mode === 'CUSTOM'
      ? parseInt(document.getElementById('posItemCustomOffInput')?.value || '0', 10)
      : Number(presetVal);
    const off = Math.min(origPrice, Math.max(0, isNaN(rawOff) ? 0 : rawOff));
    if (off >= 10 && !isCurrentMerchantManager()) {
      const mgr = await requestManagerPinOverride(t(`單品折扣 -NT$${off}`, `Item Discount -NT$${off}`));
      if (!mgr) return;
      state.posDiscountOverridePin = mgr.managerOverridePin;
    }
    it.origUnitPrice = origPrice;
    it.price = Math.max(0, origPrice - off);
    it.itemComp = it.price === 0 && origPrice > 0;
    it.itemDiscountAmount = off;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

// #27 POS 掛單 / 暫存訂單 (Hold / Park Order)
async function holdCurrentPosOrder() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) {
    showToast(`⚠️ ${t('目前結帳單內沒有餐點可掛單', 'No items in cart to hold')}`);
    return;
  }
  const label = await showAppPromptModal({
    title: `⏸️ ${t('暫存目前點餐單（掛單）', 'Hold / Park Order', '注文を一時保留', '주문 임시 보류')}`,
    message: t('請輸入掛單備註（如：戴紅帽同學、等找零，留空自動標記時間）：', 'Enter a note for this held order (blank for timestamp):', '保留メモを入力してください：', '보류 메모를 입력하세요:'),
    defaultValue: state.posCustomerNote || '',
    placeholder: t('例如：等同學拿錢包', 'e.g. Waiting for friend'),
    confirmText: t('暫存掛單', 'Hold Order', '一時保留', '임시 보류')
  });
  if (label === null) return;
  const { finalTotal } = calcCurrentPosTotals(store);
  const heldEntry = {
    holdId: 'HOLD-' + Date.now().toString(36).toUpperCase(),
    storeId: store.id,
    label: label.trim() || `${t('掛單', 'Hold')} ${getTaipeiTimeHHMM()}`,
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
    discountPercent: state.posDiscountPercent,
    serviceFeeRate: state.posServiceFeeRate,
    manualDiscountReason: state.posManualDiscountReason,
    previewTotal: finalTotal
  };
  state.posHeldOrders = [heldEntry, ...(state.posHeldOrders || [])].slice(0, 30);
  savePosHeldOrders(state.posHeldOrders);
  clearPosCart(true);
  showToast(`⏸️ ${t(`已暫存掛單「${heldEntry.label}」(NT$${finalTotal})`, `Order held: "${heldEntry.label}" (NT$${finalTotal})`)}`);
}

// 一-4：真實拆單分帳 Modal（支援「依品項自由勾選份數拆單」與「依人數 2~5 人 AA 均分」）
function ensurePosSplitBillModalMounted() {
  if (typeof document === 'undefined' || document.getElementById('posSplitBillModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="posSplitBillModal" class="modal-overlay" style="z-index:1350;" onclick="if(event.target===this) closePosSplitBillModal()">
      <div class="modal-card" style="max-width:480px;">
        <div class="modal-header">
          <div>
            <span style="font-size:0.72rem; font-weight:800; color:var(--indigo);">${t('POS 分帳收銀工具', 'POS Bill Split Tool', 'POS 会計分割ツール', 'POS 분할 결제 도구')}</span>
            <h3 style="font-size:1.1rem; font-weight:900;">✂️ ${t('品項自由拆單 & 人數 AA 均分', 'Split by Items or Split Equally (AA)', '品目別分割・割り勘 (AA)', '품목별 분할 & 인원별 N빵')}</h3>
          </div>
          <button type="button" onclick="closePosSplitBillModal()" style="border:none; background:#F3F4F6; width:32px; height:32px; border-radius:50%; font-weight:900;">✕</button>
        </div>
        <div class="modal-body" id="posSplitBillModalBody"></div>
      </div>
    </div>
  `);
}

function openPosSplitBillModal() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !state.posCart || state.posCart.length === 0) {
    showToast(`⚠️ ${t('目前結帳單內沒有餐點可拆單', 'No items in cart to split')}`);
    return;
  }
  ensurePosSplitBillModalMounted();
  state._posSplitTab = state._posSplitTab || 'ITEMS';
  state._posSplitAaWays = state._posSplitAaWays || 2;
  state._posSplitPickQtyMap = {};
  state.posCart.forEach((_, idx) => { state._posSplitPickQtyMap[idx] = 0; });
  renderPosSplitBillModal();
  document.getElementById('posSplitBillModal')?.classList.add('open');
}

function closePosSplitBillModal() {
  document.getElementById('posSplitBillModal')?.classList.remove('open');
}

function splitPosCartToHeldOrder() {
  openPosSplitBillModal();
}

function setPosSplitPickQty(idx, delta) {
  const item = state.posCart[idx];
  if (!item) return;
  const maxQ = Number(item.qty) || 1;
  const cur = Number((state._posSplitPickQtyMap && state._posSplitPickQtyMap[idx]) || 0);
  state._posSplitPickQtyMap[idx] = Math.max(0, Math.min(maxQ, cur + delta));
  renderPosSplitBillModal();
}

function renderPosSplitBillModal() {
  const body = document.getElementById('posSplitBillModalBody');
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!body || !store) return;
  const tab = state._posSplitTab || 'ITEMS';
  const totals = calcCurrentPosTotals(store);

  let pickedQtySum = 0;
  let pickedAmount = 0;
  const totalCartQty = state.posCart.reduce((s, i) => s + (Number(i.qty) || 1), 0);
  state.posCart.forEach((it, idx) => {
    const pq = Number((state._posSplitPickQtyMap && state._posSplitPickQtyMap[idx]) || 0);
    pickedQtySum += pq;
    pickedAmount += pq * (Number(it.price) || 0);
  });

  const aaWays = Math.max(2, Math.min(5, Number(state._posSplitAaWays) || 2));
  const perPerson = Math.floor(totals.finalTotal / aaWays);
  const remainder = totals.finalTotal - perPerson * aaWays;

  body.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:12px;">
      <button type="button" class="pos-chip-btn ${tab === 'ITEMS' ? 'active' : ''}" onclick="state._posSplitTab='ITEMS'; renderPosSplitBillModal();">📋 ${t('依品項勾選拆單', 'Split by Items', '品目別に分割', '품목별 분할')}</button>
      <button type="button" class="pos-chip-btn ${tab === 'AA' ? 'active' : ''}" onclick="state._posSplitTab='AA'; renderPosSplitBillModal();">👥 ${t('人數 AA 均分', 'Split Equally (AA)', '人数割り勘 (AA)', '인원별 N빵')}</button>
    </div>

    ${tab === 'ITEMS' ? `
      <div style="font-size:0.78rem; color:var(--text-secondary); margin-bottom:8px; font-weight:700;">
        ${t('點選要「拆出至新掛單」的品項份數，剩餘品項將留在本單直接收款：', 'Choose quantities to move to a separate held ticket; remaining items stay on this ticket:')}
      </div>
      <div style="max-height:240px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
        ${state.posCart.map((it, idx) => {
          const maxQ = Number(it.qty) || 1;
          const pq = Number((state._posSplitPickQtyMap && state._posSplitPickQtyMap[idx]) || 0);
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; background:${pq > 0 ? '#EEF2FF' : '#F8FAFC'}; border:1.5px solid ${pq > 0 ? '#6366F1' : 'var(--border)'}; border-radius:10px; padding:8px 10px;">
              <div style="min-width:0; flex:1;">
                <div data-dish-name="1" style="font-weight:900; font-size:0.86rem;">${escapeHtml(trDishName(it))}</div>
                <div style="font-size:0.74rem; color:var(--text-secondary);">NT$${it.price} × ${maxQ}</div>
              </div>
              <div style="display:flex; align-items:center; gap:6px;">
                <button type="button" onclick="setPosSplitPickQty(${idx}, -1)" style="width:28px; height:28px; border-radius:8px; border:1px solid var(--border); background:#FFF; font-weight:900;">－</button>
                <span style="min-width:34px; text-align:center; font-weight:950; color:${pq > 0 ? 'var(--indigo)' : 'var(--text-muted)'};">${pq}/${maxQ}</span>
                <button type="button" onclick="setPosSplitPickQty(${idx}, 1)" style="width:28px; height:28px; border-radius:8px; border:1px solid var(--border); background:#FFF; font-weight:900;">＋</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div style="margin-bottom:10px;">
        <label class="field-label">${t('新拆出掛單標籤', 'New Held Ticket Label')}</label>
        <input type="text" id="posSplitLabelInput" class="select-input" value="${t('拆單', 'Split')} ${getTaipeiTimeHHMM()}" placeholder="${t('例：B位同學分開付', 'e.g. Friend B')}">
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; padding:8px 12px; border-radius:10px; margin-bottom:10px; font-size:0.84rem; font-weight:900;">
        <span>${t(`拆出 ${pickedQtySum} 份`, `Moving ${pickedQtySum} items`)}</span>
        <span style="color:var(--indigo);">NT$ ${pickedAmount}</span>
      </div>
      <button type="button" class="btn-primary-full" ${pickedQtySum <= 0 || pickedQtySum >= totalCartQty ? 'disabled style="opacity:0.5;"' : ''} onclick="commitPosItemSplit()">
        ✂️ ${t(`確認拆出 ${pickedQtySum} 份 (NT$${pickedAmount}) 至獨立掛單`, `Move ${pickedQtySum} items (NT$${pickedAmount}) to Held Ticket`)}
      </button>
    ` : `
      <div style="margin-bottom:10px;">
        <label class="field-label">${t('選擇均分人數 (AA 制)', 'Number of People (Equal Split)')}</label>
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px;">
          ${[2, 3, 4, 5].map(w => `
            <button type="button" class="pos-chip-btn ${aaWays === w ? 'active' : ''}" onclick="state._posSplitAaWays=${w}; renderPosSplitBillModal();">${w} ${t('人', 'ppl', '名', '명')}</button>
          `).join('')}
        </div>
      </div>
      <div style="background:#EEF2FF; border:1.5px solid #818CF8; border-radius:12px; padding:12px; margin-bottom:12px; text-align:center;">
        <div style="font-size:0.78rem; color:#4338CA; font-weight:800;">${t(`原單總額 NT$${totals.finalTotal} ÷ ${aaWays} 人`, `Total NT$${totals.finalTotal} ÷ ${aaWays} people`)}</div>
        <div style="font-size:1.7rem; font-weight:950; color:#312E81; margin:4px 0;">NT$ ${perPerson} / ${t('人', 'person', '人', '인')}</div>
        ${remainder > 0 ? `<div style="font-size:0.74rem; color:#B45309; font-weight:800;">${t(`※ 尾數餘 NT$${remainder}（第 1 位收 NT$${perPerson + remainder}，其餘每人 NT$${perPerson}）`, `※ Remainder NT$${remainder} (Person 1 pays NT$${perPerson + remainder})`)}</div>` : ''}
      </div>
      <button type="button" class="btn-primary-full" onclick="commitPosAaSplit(${aaWays})">
        👥 ${t(`產生 ${aaWays} 份均分收款單（第 1 份留本單，其餘 ${aaWays - 1} 份存掛單）`, `Create ${aaWays} Equal Split Tickets (1 active + ${aaWays - 1} held)`)}
      </button>
    `}
  `;
}

function commitPosItemSplit() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  const label = document.getElementById('posSplitLabelInput')?.value.trim() || `${t('拆單', 'Split')} ${getTaipeiTimeHHMM()}`;
  const stayCart = [];
  const splitCart = [];
  state.posCart.forEach((it, idx) => {
    const totalQ = Number(it.qty) || 1;
    const pq = Math.max(0, Math.min(totalQ, Number((state._posSplitPickQtyMap && state._posSplitPickQtyMap[idx]) || 0)));
    if (pq > 0) splitCart.push({ ...JSON.parse(JSON.stringify(it)), qty: pq });
    if (totalQ - pq > 0) stayCart.push({ ...JSON.parse(JSON.stringify(it)), qty: totalQ - pq });
  });
  if (splitCart.length === 0 || stayCart.length === 0) {
    showToast(`⚠️ ${t('請至少保留 1 份在原單且至少拆出 1 份', 'Keep at least 1 item on current ticket and move at least 1 item')}`);
    return;
  }
  const splitTotal = splitCart.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const heldEntry = {
    holdId: 'SPLIT-' + Date.now().toString(36).toUpperCase(),
    storeId: store.id,
    label,
    createdAt: getTaipeiTimeHHMMSS(),
    cart: splitCart,
    dineType: state.posDineType,
    needCutlery: false,
    timeMode: state.posTimeMode,
    reserveDate: state.posReserveDate,
    reserveTime: state.posReserveTime,
    customerPhone: '',
    customerNote: state.posCustomerNote,
    taxId: '',
    manualDiscount: 0,
    discountPercent: 0,
    serviceFeeRate: 0,
    manualDiscountReason: '',
    previewTotal: splitTotal
  };
  state.posHeldOrders = [heldEntry, ...(state.posHeldOrders || [])].slice(0, 30);
  savePosHeldOrders(state.posHeldOrders);
  state.posCart = stayCart;
  closePosSplitBillModal();
  renderPosCashierPanel(store);
  showToast(`✂️ ${t(`已拆出 NT$${splitTotal} 至掛單「${label}」`, `Moved NT$${splitTotal} to held ticket "${label}"`)}`);
}

function commitPosAaSplit(ways) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) return;
  const n = Math.max(2, Math.min(5, parseInt(ways, 10) || 2));
  const totals = calcCurrentPosTotals(store);
  const perPerson = Math.floor(totals.finalTotal / n);
  const remainder = totals.finalTotal - perPerson * n;
  const origSummary = state.posCart.map(i => `${i.baseName || i.name}×${i.qty || 1}`).join('、');

  const newHeld = [];
  for (let i = 2; i <= n; i++) {
    newHeld.push({
      holdId: `AA-${i}-${Date.now().toString(36).toUpperCase()}`,
      storeId: store.id,
      label: `AA (${i}/${n}) ${getTaipeiTimeHHMM()}`,
      createdAt: getTaipeiTimeHHMMSS(),
      cart: [{ id: `AA_SPLIT_${i}`, name: `AA 分帳 (${i}/${n})`, baseName: `AA 分帳 (${i}/${n})`, basePrice: perPerson, price: perPerson, qty: 1, selections: {}, itemNote: origSummary.slice(0, 50) }],
      dineType: state.posDineType,
      needCutlery: false,
      timeMode: 'NOW',
      reserveDate: getTodayDateStr(),
      reserveTime: '12:15',
      customerPhone: '',
      customerNote: `AA ${i}/${n}`,
      taxId: '',
      manualDiscount: 0,
      discountPercent: 0,
      serviceFeeRate: 0,
      manualDiscountReason: '',
      previewTotal: perPerson
    });
  }
  state.posHeldOrders = [...newHeld, ...(state.posHeldOrders || [])].slice(0, 30);
  savePosHeldOrders(state.posHeldOrders);
  const firstShare = perPerson + remainder;
  state.posCart = [{ id: 'AA_SPLIT_1', name: `AA 分帳 (1/${n})`, baseName: `AA 分帳 (1/${n})`, basePrice: firstShare, price: firstShare, qty: 1, selections: {}, itemNote: origSummary.slice(0, 50) }];
  state.posManualDiscount = 0;
  state.posDiscountPercent = 0;
  state.posServiceFeeRate = 0;
  state.posNeedCutlery = false;
  closePosSplitBillModal();
  renderPosCashierPanel(store);
  showToast(`👥 ${t(`已完成 ${n} 人 AA 分帳！本單收 NT$${firstShare}，其餘 ${n - 1} 份已存至「掛單」`, `Split ${n} ways! Active: NT$${firstShare}, ${n - 1} held.`)}`);
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
    box.innerHTML = `<div style="text-align:center; padding:32px 12px; color:var(--text-muted); font-weight:800;">📭 ${t('目前本店沒有暫存中的掛單', 'No held orders for this store right now', '保留中の注文はありません', '보류 중인 주문이 없습니다')}</div>`;
    return;
  }
  box.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${list.map(h => {
        const summary = (h.cart || []).map(i => `${trDishName(i)}×${i.qty || 1}`).join(state.lang === 'zh-TW' ? '、' : ', ');
        return `
          <div style="background:#F8FAFC; border:1.5px solid var(--border); border-radius:12px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong style="font-size:0.94rem; color:var(--text-primary);">⏸️ <span data-dish-name="1">${escapeHtml(h.label)}</span></strong>
              <span style="font-size:0.76rem; color:var(--text-muted); font-family:monospace;">${escapeHtml(h.createdAt)}</span>
            </div>
            <div data-dish-name="1" style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:8px;">${escapeHtml(summary)}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <span style="font-weight:950; color:var(--red); font-size:0.98rem;">NT$ ${h.previewTotal || 0}</span>
              <div style="display:flex; gap:6px;">
                <button type="button" class="btn-danger-soft" style="padding:6px 10px; font-size:0.78rem;" onclick="deletePosHeldOrder(${escapeJsAttr(h.holdId)})">🗑️ ${t('刪除', 'Delete', '削除', '삭제')}</button>
                <button type="button" class="btn-tip-action" style="padding:6px 14px; font-size:0.82rem;" onclick="restorePosHeldOrder(${escapeJsAttr(h.holdId)})">▶️ ${t('取回結帳', 'Resume Order', '会計再開', '결제 재개')}</button>
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

  const { subtotal, cutleryFee, discount, percentDiscount, manualDiscount, serviceFee, finalTotal } = calcCurrentPosTotals(store);
  const totalDisc = discount + percentDiscount + manualDiscount;
  const isReserve = state.posTimeMode === 'RESERVE';
  const nextPreviewSeq = generatePreviewNextSeq(store.id, isReserve ? state.posReserveDate : getTodayDateStr());
  const cashReceivedNum = state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal;
  const changeAmount = Math.max(0, cashReceivedNum - finalTotal);
  const isCashShort = state.posPayment === '現場現金' && state.posCashReceived !== '' && cashReceivedNum < finalTotal;

  const splitCashNum = Math.min(finalTotal, Math.max(0, parseInt(state.posSplitCashAmount || '0', 10) || 0));
  const splitLinePayNum = Math.max(0, finalTotal - splitCashNum);
  const isSplitInvalid = state.posPayment === '複合付款' && (splitCashNum <= 0 || splitLinePayNum <= 0);

  const needsLinePayVerify = state.posPayment === 'LINE Pay' || state.posPayment === '複合付款';
  const hasConfiguredLp = Boolean(store.linePayChannelId && store.hasLinePaySecret);
  const cleanOtk = String(state.posLinePayOneTimeKey || '').replace(/\D/g, '');
  const cleanManualRef = String(state.posLinePayManualRef || '').trim();
  const isLinePayReady = !needsLinePayVerify
    || (cleanOtk.length === 18)
    || (Boolean(state.posLinePayManualConfirmed) && cleanManualRef.length >= 4);

  box.innerHTML = `
    <div style="background:#F8FAFC; border:1px solid var(--border); border-radius:12px; padding:12px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="font-weight:950; font-size:0.96rem;">🧾 ${t('預覽單號', 'Preview', 'プレビュー', '미리보기')} #${nextPreviewSeq}（${escapeHtml(trTerm(state.posDineType))}）</span>
        <span style="font-size:0.76rem; font-weight:800; color:var(--brand-dark);">${isReserve ? `📅 ${t('預訂', 'Pre-order')} ${state.posReserveDate} ${state.posReserveTime}` : `⚡ ${t('現場立即製作', 'Make Immediately', '即時調理', '즉시 조리')}`}</span>
      </div>
      <div style="max-height:105px; overflow-y:auto; font-size:0.8rem; color:var(--text-secondary); border-top:1px dashed var(--border); padding-top:6px;">
        ${state.posCart.map(i => `<div style="display:flex; justify-content:space-between;"><span data-dish-name="1">${escapeHtml(trDishName(i))} ×${i.qty || 1}${i.itemNote ? ` (${escapeHtml(i.itemNote)})` : ''}</span><strong>$${i.price * (i.qty || 1)}</strong></div>`).join('')}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px; padding-top:8px; border-top:1.5px solid var(--border);">
        <span style="font-weight:900; font-size:0.86rem;">
          ${t('應收總計', 'Total Due', '合計金額', '총 결제액')}
          ${cutleryFee > 0 ? ` (${t('餐具', 'Cutlery')}+$${cutleryFee})` : ''}
          ${serviceFee > 0 ? ` (${t('服務費', 'Svc')}+$${serviceFee})` : ''}
          ${totalDisc > 0 ? ` (${t('折', 'Off')}-$${totalDisc})` : ''}
        </span>
        <span style="font-size:1.55rem; font-weight:950; color:var(--red);">NT$ ${finalTotal}</span>
      </div>
    </div>

    <label class="field-label">💳 ${t('選擇收款方式（支援現金、LINE Pay 掃碼扣款與複合付款）', 'Payment Method (Cash, LINE Pay Scan & Split Pay)', 'お支払い方法（現金・LINE Pay・併用）', '결제 수단 (현금・LINE Pay・복합결제)')}</label>
    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:12px;">
      ${['現場現金', 'LINE Pay', '複合付款'].map(pay => `
        <button type="button" class="pos-chip-btn ${state.posPayment === pay ? 'active' : ''}" style="padding:10px 6px; font-size:0.82rem;" onclick="state.posPayment=${escapeJsAttr(pay)}; renderPosTwoStepCheckoutModal();">
          ${pay === 'LINE Pay' ? '💚 LINE Pay' : pay === '複合付款' ? `🔀 ${t('複合付款', 'Split Pay', '併用払い', '복합 결제')}` : `💵 ${t('現場現金', 'Cash', '現金', '현금')}`}
        </button>
      `).join('')}
    </div>

    ${state.posPayment === '現場現金' ? `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#0F172A; color:#FFFFFF; padding:10px 14px; border-radius:10px; margin-bottom:8px;">
        <div>
          <div style="font-size:0.72rem; color:#94A3B8;">💵 ${t('顧客實收現金', 'Cash Tendered', 'お預かり現金', '받은 현금')}</div>
          <div style="font-size:1.25rem; font-weight:950; color:#38BDF8;">NT$ ${state.posCashReceived !== '' ? escapeHtml(state.posCashReceived) : `${finalTotal} (${t('剛好', 'Exact', 'ぴったり', '정확히')})`}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.72rem; color:#94A3B8;">🪙 ${t('應找零錢', 'Change Due', 'お釣り', '거스름돈')}</div>
          <div style="font-size:1.35rem; font-weight:950; color:${isCashShort ? '#F87171' : '#34D399'};">${isCashShort ? `${t('不足', 'Short', '不足', '부족')} $${finalTotal - cashReceivedNum}` : `NT$ ${changeAmount}`}</div>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:5px; margin-bottom:12px;">
        <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(${finalTotal}); renderPosTwoStepCheckoutModal();">${t('剛好', 'Exact', 'ぴったり', '정확히')}</button>
        <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(100); renderPosTwoStepCheckoutModal();">$100</button>
        <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(500); renderPosTwoStepCheckoutModal();">$500</button>
        <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(1000); renderPosTwoStepCheckoutModal();">$1000</button>
        <button type="button" class="pos-chip-btn" style="background:#EFF6FF; color:#1D4ED8;" onclick="openPosCashNumpadModal()">🔢 ${t('鍵盤', 'Pad', '入力', '키패드')}</button>
      </div>
    ` : ''}

    ${state.posPayment === '複合付款' ? `
      <div style="background:#FFFBEB; border:1.5px solid #F59E0B; border-radius:12px; padding:12px; margin-bottom:12px;">
        <div style="font-size:0.8rem; font-weight:900; color:#92400E; margin-bottom:8px;">🔀 ${t('複合付款拆帳（現金入錢箱 + LINE Pay 入行動支付）', 'Split Payment (Cash + LINE Pay)', '併用払い内訳（現金＋LINE Pay）', '복합 결제 분할 (현금 + LINE Pay)')}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div>
            <label class="field-label">💵 ${t('現金支付金額 ($)', 'Cash Portion ($)', '現金 ($)', '현금 금액 ($)')}</label>
            <input type="number" class="select-input" min="1" max="${Math.max(1, finalTotal - 1)}" placeholder="${Math.floor(finalTotal / 2)}" value="${escapeHtml(state.posSplitCashAmount)}" oninput="state.posSplitCashAmount=this.value; renderPosTwoStepCheckoutModal();">
          </div>
          <div>
            <label class="field-label">💚 ${t('LINE Pay 補差額 ($)', 'LINE Pay Balance ($)', 'LINE Pay 残額 ($)', 'LINE Pay 차액 ($)')}</label>
            <input type="text" class="select-input" disabled value="NT$ ${splitLinePayNum}" style="font-weight:900; color:#059669; background:#ECFDF5;">
          </div>
        </div>
        ${isSplitInvalid ? `<div style="font-size:0.74rem; color:var(--red); font-weight:800; margin-top:6px;">⚠️ ${t(`請輸入大於 $0 且小於 $${finalTotal} 的現金金額`, `Enter cash between $1 and $${finalTotal - 1}`)}</div>` : ''}
      </div>
    ` : ''}

    ${needsLinePayVerify ? `
      <div style="background:#ECFDF5; border:1.5px solid #10B981; border-radius:12px; padding:12px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:8px; flex-wrap:wrap;">
          <span style="font-size:0.82rem; font-weight:950; color:#065F46;">💚 ${t('LINE Pay 真實收款核實（掃顧客付款碼或核對收款立牌）', 'LINE Pay Verification (Scan OneTimeKey or Manual Verify)', 'LINE Pay 決済確認（バーコードまたは手動確認）', 'LINE Pay 결제 확인 (바코드 스캔 또는 수동 확인)')}</span>
          <span style="font-size:0.7rem; font-weight:800; padding:2px 7px; border-radius:999px; background:${hasConfiguredLp ? '#059669' : '#D97706'}; color:#FFF;">
            ${hasConfiguredLp ? t('API 已連線', 'API Ready') : t('立牌核對模式', 'Manual Sign Mode')}
          </span>
        </div>

        <label class="field-label" style="color:#065F46;">📷 ${t('方式 A：掃描顧客 LINE Pay 18 碼付款條碼 (OneTimeKey)', 'Option A: Scan 18-digit LINE Pay OneTimeKey', '方法A：18桁決済バーコードをスキャン', '방법 A: 고객 18자리 결제 바코드 스캔')}</label>
        <div style="display:flex; gap:6px; margin-bottom:10px;">
          <input type="tel" id="posLpOneTimeKeyInput" maxlength="18" inputmode="numeric" class="select-input" style="flex:1; font-family:monospace; font-weight:900;" placeholder="${t('USB 掃碼槍直掃或輸入 18 碼', 'Scan or enter 18 digits')}" value="${escapeHtml(state.posLinePayOneTimeKey || '')}" oninput="state.posLinePayOneTimeKey=this.value.replace(/\\D/g,'').slice(0,18); renderPosTwoStepCheckoutModal();" onkeydown="if(event.key==='Enter' && this.value.replace(/\\D/g,'').length===18){ closePosTwoStepCheckoutModal(); submitMerchantPosOrder(); }">
          <button type="button" class="btn-tip-action" style="background:#065F46; white-space:nowrap; padding:8px 12px; font-size:0.78rem;" onclick="openPosLinePayScanner()">📷 ${t('鏡頭掃碼', 'Camera', 'カメラ', '카메라')}</button>
        </div>

        <div style="border-top:1px dashed #6EE7B7; padding-top:8px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:0.8rem; font-weight:900; color:#065F46; cursor:pointer; margin-bottom:6px;">
            <input type="checkbox" id="posLpManualConfirmChk" ${state.posLinePayManualConfirmed ? 'checked' : ''} onchange="state.posLinePayManualConfirmed=this.checked; renderPosTwoStepCheckoutModal();" style="width:18px; height:18px; accent-color:#059669;">
            <span>${t('方式 B（靜態立牌）：我已核對顧客手機畫面顯示 LINE Pay 付款成功', 'Option B (Static QR): I verified payment succeeded on customer screen', '方法B（店頭QR）：顧客画面の決済完了を目視確認済', '방법 B(매장 QR): 고객 화면 결제 완료 확인함')}</span>
          </label>
          ${state.posLinePayManualConfirmed ? `
            <input type="text" id="posLpManualRefInput" maxlength="12" class="select-input" style="font-family:monospace; font-weight:800;" placeholder="${t('輸入顧客交易編號末 4~8 碼 (必填防呆)', 'Last 4-8 digits of transaction ref (Required)')}" value="${escapeHtml(state.posLinePayManualRef || '')}" oninput="state.posLinePayManualRef=this.value.trim().slice(0,12); renderPosTwoStepCheckoutModal();">
          ` : ''}
        </div>
        ${!isLinePayReady ? `<div style="font-size:0.74rem; color:#B45309; font-weight:800; margin-top:6px;">⚠️ ${t('請掃描 18 碼付款條碼，或勾選確認並填入 4~8 碼交易末碼才可出單（防止未入帳誤點出單）', 'Scan 18-digit barcode OR confirm & enter 4-8 digit ref code to proceed.')}</div>` : ''}
      </div>
    ` : ''}

    <div style="display:grid; grid-template-columns:1fr 2fr; gap:8px;">
      <button type="button" class="btn-outline" style="padding:12px; font-weight:900;" onclick="closePosTwoStepCheckoutModal()">← ${t('返回修改', 'Back', '戻る', '돌아가기')}</button>
      <button type="button" id="posFinalConfirmCheckoutBtn" class="pos-checkout-btn" style="padding:12px; font-size:0.96rem;" onclick="closePosTwoStepCheckoutModal(); submitMerchantPosOrder({ fastMode: false });" ${isCashShort || isSplitInvalid || !isLinePayReady || state.isPosSubmitting ? 'disabled' : ''}>
        ✅ ${t('確認收款並立即出單', 'Confirm & Print', '会計確定・発券', '결제 확인 및 출식')} #${nextPreviewSeq}
      </button>
    </div>
  `;
}

async function openPosLinePayScanner() {
  state._qrScannerTargetMode = 'POS_LINEPAY_OTK';
  await openKdsCameraScannerModal();
}

function togglePosAutoReceiptPreview(checked) {
  state.posAutoShowReceiptModal = Boolean(checked);
  try { localStorage.setItem('mealflow_pos_auto_receipt', state.posAutoShowReceiptModal ? '1' : '0'); } catch (e) {}
  showToast(state.posAutoShowReceiptModal
    ? `🖨️ ${t('已開啟「結帳後自動彈出 80mm 小票預覽」', 'Auto 80mm receipt popup ON')}`
    : `⚡ ${t('已啟用「快餐極速模式」（結帳不彈視窗擋路，改由上方橫幅顯示找零與補印）', 'Fast-food mode ON (no blocking receipt popup)')}`);
}

async function setPosPercentDiscount(pctOff) {
  const numPct = Math.max(0, Math.min(90, Number(pctOff) || 0));
  if (state.posDiscountPercent === numPct) {
    state.posDiscountPercent = 0;
  } else {
    if (numPct >= 10 && !isCurrentMerchantManager()) {
      const mgr = await requestManagerPinOverride(t(`百分比折扣 ${100 - numPct}折 (-${numPct}%)`, `${numPct}% Order Discount`));
      if (!mgr) return;
      state.posDiscountOverridePin = mgr.managerOverridePin;
    }
    state.posDiscountPercent = numPct;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

function setPosServiceFeeRate(rate) {
  state.posServiceFeeRate = state.posServiceFeeRate === rate ? 0 : rate;
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (store) renderPosCashierPanel(store);
}

async function triggerPosFastCashCheckout(cashAmount) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) return;
  const { finalTotal } = calcCurrentPosTotals(store);
  state.posPayment = '現場現金';
  state.posCashReceived = String(cashAmount);
  if (cashAmount < finalTotal) {
    openPosTwoStepCheckoutModal();
    return;
  }
  await submitMerchantPosOrder({ fastMode: true });
}

function openPosLinePayCheckoutModal() {
  state.posPayment = 'LINE Pay';
  state.posLinePayOneTimeKey = '';
  state.posLinePayManualConfirmed = false;
  state.posLinePayManualRef = '';
  openPosTwoStepCheckoutModal();
}

function dismissPosChangeBanner() {
  state.posLastChangeBanner = null;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (store) renderPosCashierPanel(store);
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

function setPosFontSize(size) {
  const valid = ['normal', 'large', 'xlarge'];
  const next = valid.includes(size) ? size : 'normal';
  state.posFontSize = next;
  try { localStorage.setItem('mealflow_pos_font_size', next); } catch (e) {}
  if (typeof applyPosFontSizeClass === 'function') applyPosFontSizeClass();
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (store && state.storeTabMode === 'pos') renderPosCashierPanel(store);
  const labelMap = {
    normal: t('標準字體', 'Standard Text', '標準文字', '기본 글씨'),
    large: t('大字模式', 'Large Text', '大文字', '큰 글씨'),
    xlarge: t('特大老花友善模式', 'Extra-Large Text', '特大文字', '아주 큰 글씨')
  };
  showToast(`🔤 ${t('已切換為', 'Switched to')} ${labelMap[next]}`);
}

function calcCurrentPosTotals(store) {
  const storeCutleryPrice = store.cutleryPrice !== undefined ? Number(store.cutleryPrice) : 1;
  const subtotal = state.posCart.reduce((sum, i) => sum + (Number(i.price) || 0) * (i.qty || 1), 0);
  const cutleryFee = (subtotal > 0 && state.posNeedCutlery) ? storeCutleryPrice : 0;
  const takeoutFee = (subtotal > 0 && state.posDineType === '外帶自取') ? 1 : 0;
  const isReserve = state.posTimeMode === 'RESERVE';
  const promoActive = isStorePromoActive(store, isReserve, state.posReserveTime);
  const promoDiscount = (subtotal >= AI_DISCOUNT_MIN_SUBTOTAL && promoActive && store.promoMode === 'discount')
    ? Math.min(subtotal, Number(store.promoDiscount) || 10)
    : 0;
  const comboEval = typeof evaluateComboDiscounts === 'function'
    ? evaluateComboDiscounts(store, state.posCart)
    : { totalDiscount: 0, appliedRules: [] };
  const comboDiscount = Math.min(Math.max(0, subtotal - promoDiscount), comboEval.totalDiscount || 0);
  const comboAppliedRules = comboEval.appliedRules || [];
  const discount = promoDiscount + comboDiscount;
  const pctRate = Math.max(0, Math.min(90, Number(state.posDiscountPercent) || 0));
  const percentDiscount = pctRate > 0 ? Math.round(Math.max(0, subtotal - discount) * (pctRate / 100)) : 0;
  const manualDiscount = Math.min(Math.max(0, subtotal - discount - percentDiscount), Math.max(0, Number(state.posManualDiscount) || 0));
  const afterDisc = Math.max(0, subtotal - discount - percentDiscount - manualDiscount);
  const svcRate = Math.max(0, Math.min(20, Number(state.posServiceFeeRate) || 0));
  const serviceFee = svcRate > 0 ? Math.round(afterDisc * (svcRate / 100)) : 0;
  const finalTotal = Math.max(0, afterDisc + cutleryFee + takeoutFee + serviceFee);
  return { storeCutleryPrice, subtotal, cutleryFee, takeoutFee, promoActive, promoDiscount, comboDiscount, comboAppliedRules, discount, percentDiscount, manualDiscount, serviceFee, finalTotal };
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
        <div style="font-size:0.75rem; color:var(--text-secondary); font-weight:800;">🧾 ${t('應收總計', 'Total Due', 'お支払い合計', '총 결제 금액')}</div>
        <div style="font-size:1.35rem; font-weight:950; color:var(--text-primary);">NT$ ${finalTotal}</div>
      </div>
      <div style="background:${isShort ? 'var(--red-bg)' : 'var(--green-bg)'}; padding:10px 12px; border-radius:12px; border:1.5px solid ${isShort ? 'var(--red)' : 'var(--green)'};">
        <div style="font-size:0.75rem; color:${isShort ? 'var(--red)' : 'var(--green)'}; font-weight:800;">🪙 ${t('應找零錢', 'Change Due', 'お釣り', '거스름돈')}</div>
        <div style="font-size:1.35rem; font-weight:950; color:${isShort ? 'var(--red)' : 'var(--green)'};">
          ${isShort ? `${t('不足', 'Short', '不足', '부족')} $${finalTotal - cashReceivedNum}` : `NT$ ${changeAmount}`}
        </div>
      </div>
    </div>

    <div style="background:#FFF7ED; border:2px solid var(--brand); border-radius:12px; padding:10px 14px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size:0.84rem; font-weight:900; color:var(--brand-dark);">💵 ${t('顧客實收金額', 'Cash Tendered', 'お預かり金額', '받은 현금')}</span>
      <span style="font-size:1.6rem; font-weight:950; color:var(--brand-dark);">
        NT$ ${state.posCashReceived !== '' ? escapeHtml(state.posCashReceived) : `${finalTotal} (${t('剛好', 'Exact', 'ちょうど', '정확히')})`}
      </span>
    </div>

    <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-bottom:10px;">
      <button type="button" class="pos-chip-btn" onclick="setPosQuickCash(${finalTotal})">${t('剛好', 'Exact', 'ちょうど', '정확히')} ($${finalTotal})</button>
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
      <button type="button" class="pos-numpad-key clear" onclick="posTapNumpad('C')">${t('清空', 'CLR', 'クリア', '초기화')}</button>
      <button type="button" class="pos-numpad-key" onclick="posTapNumpad('0')">0</button>
      <button type="button" class="pos-numpad-key back" onclick="posTapNumpad('BACK')">⌫</button>
    </div>

    <button type="button" class="btn-primary-full" onclick="closePosCashNumpadModal()">
      ✅ ${t(`確認實收金額 (找零 NT$ ${changeAmount})`, `Confirm Cash (Change NT$ ${changeAmount})`, `お預かり確定 (お釣り NT$ ${changeAmount})`, `수령 금액 확인 (거스름돈 NT$ ${changeAmount})`)}
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
  if (state.xpMode && categories.length > 1) {
    if (state.xpDefaultCategoryAppliedForStore !== store.id) {
      state.posSelectedCategory = categories[1];
      state.xpDefaultCategoryAppliedForStore = store.id;
    } else if (!categories.includes(state.posSelectedCategory)) {
      state.posSelectedCategory = categories[1];
    }
  }
  const filteredMenus = state.posSelectedCategory === '全部'
    ? menus
    : menus.filter(m => (m.category || '主廚推薦') === state.posSelectedCategory);
  const activeMult = Math.max(1, Number(state.posQtyMultiplier) || 1);

  const { storeCutleryPrice, subtotal, cutleryFee, takeoutFee, comboDiscount, comboAppliedRules, discount, percentDiscount, manualDiscount, serviceFee, finalTotal } = calcCurrentPosTotals(store);
  const totalDiscountSum = discount + percentDiscount + manualDiscount;

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

  const nextPreviewSeq = generatePreviewNextSeq(store.id, isReserve ? state.posReserveDate : todayStr);
  const lockedShiftInfo = getLockedShiftRecord(store.id, todayStr);
  const openedShiftInfo = getOpenedShiftRecord(store.id, todayStr);
  const isBlockedByShiftLock = Boolean(lockedShiftInfo && !isReserve);
  const heldCount = (state.posHeldOrders || []).filter(h => h.storeId === store.id).length;
  const totalCartItems = state.posCart.reduce((s, i) => s + (i.qty || 1), 0);
  const canFastPay = state.posCart.length > 0 && !state.isPosSubmitting && !isBlockedByShiftLock;

  const changeBanner = state.posLastChangeBanner;
  const changeBannerHtml = changeBanner ? `
    <div class="pos-change-banner" id="posChangeBanner">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <span style="font-weight:950; font-size:0.9rem;">✅ ${t(`已出單 #${changeBanner.pickupNumber}`, `Order #${changeBanner.pickupNumber} Sent`, `発券済 #${changeBanner.pickupNumber}`, `출식 완료 #${changeBanner.pickupNumber}`)}</span>
        <span style="font-size:0.82rem; opacity:0.92;">${t('實收', 'Paid', '預り', '받은금액')} $${changeBanner.cashReceived}</span>
        <span class="pos-change-banner-amt">🪙 ${t('找零', 'Change', 'お釣り', '거스름돈')} NT$ ${changeBanner.changeAmount}</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <button type="button" onclick="requeueOrderPrintJob(${escapeJsAttr(changeBanner.orderId)})" style="border:1px solid rgba(255,255,255,0.45); background:rgba(255,255,255,0.22); color:#FFFFFF; padding:4px 10px; border-radius:8px; font-size:0.76rem; font-weight:900;">🖨️ ${t('出單機重印', 'Reprint', '再印刷', '재인쇄')}</button>
        <button type="button" onclick="openReceiptPrintModal(${escapeJsAttr(changeBanner.orderId)})" style="border:1px solid rgba(255,255,255,0.45); background:rgba(255,255,255,0.14); color:#FFFFFF; padding:4px 10px; border-radius:8px; font-size:0.76rem; font-weight:900;">🧾 ${t('小票預覽', 'Receipt', 'レシート', '영수증')}</button>
        <button type="button" onclick="dismissPosChangeBanner()" style="border:none; background:rgba(0,0,0,0.22); color:#FFFFFF; width:26px; height:26px; border-radius:50%; font-weight:900;">✕</button>
      </div>
    </div>
  ` : '';

  panel.innerHTML = `
    <div class="pos-modern-workspace">
      <div class="pos-menu-card">
        ${changeBannerHtml}
        ${lockedShiftInfo ? `
          <div style="background:#FEF2F2; border:1.5px solid #EF4444; color:#991B1B; padding:8px 12px; border-radius:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size:0.78rem; font-weight:900;">
            <span>🔒 ${t(`本店今日 (${todayStr}) 已完成交班日結鎖定，禁止補開當日立即單（可開立未來預訂單）`, `Shift locked for ${todayStr}. Immediate orders blocked (future pre-orders allowed).`)}</span>
            <button type="button" onclick="openShiftZReportModal()" style="border:1px solid #DC2626; background:#FFFFFF; color:#DC2626; padding:4px 10px; border-radius:6px; font-size:0.74rem; font-weight:900; cursor:pointer;">🧾 ${t('檢視日結 / 店長解鎖', 'View Z-Report / Unlock')}</button>
          </div>
        ` : ''}

        <!-- A4: 操作工具列獨立成列，徹底杜絕分類標籤被擠壓拉長變巨型橢圓！ -->
        <div class="pos-action-bar">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <div class="pos-mult-bar" title="${t('點選份數乘數後再點菜，一次加入多份', 'Tap multiplier then tap dish')}">
              ${[1, 2, 3, 5].map(n => `
                <button type="button" class="pos-mult-btn ${activeMult === n ? 'active' : ''}" onclick="setPosQtyMultiplier(${n})">×${n}</button>
              `).join('')}
            </div>
            <div class="pos-font-bar" title="${t('調整 POS 點餐畫面字體大小（會記住此平板設定）', 'Adjust POS text size (saved on this device)')}">
              <span class="pos-font-label">🔤</span>
              ${[
                ['normal', t('標準', 'Std', '標準', '기본')],
                ['large', t('大字', 'Large', '大', '크게')],
                ['xlarge', t('特大', 'XL', '特大', '특대')]
              ].map(([sz, lbl]) => `
                <button type="button" class="pos-font-btn ${(state.posFontSize || 'normal') === sz ? 'active' : ''}" onclick="setPosFontSize('${sz}')">${lbl}</button>
              `).join('')}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
            <button type="button" class="pos-cat-pill" style="background:#EFF6FF; color:#1D4ED8; border-color:#93C5FD;" onclick="triggerHardwareCashDrawerKick()" title="${t('送出 ESC/POS 開錢箱指令', 'Open cash drawer')}">
              💵 ${t('開錢箱', 'Drawer', 'ドロアー', '서랍열기')}
            </button>
            <button type="button" class="pos-cat-pill" style="background:${heldCount > 0 ? '#FEF3C7' : '#F8FAFC'}; color:${heldCount > 0 ? '#B45309' : '#475569'}; border-color:${heldCount > 0 ? '#F59E0B' : '#CBD5E1'};" onclick="openPosHeldOrdersModal()">
              ⏸️ ${t('掛單', 'Hold', '保留', '보류')} (${heldCount})
            </button>
            <button type="button" class="pos-cat-pill" style="background:${openedShiftInfo ? '#ECFDF5' : '#FFF7ED'}; color:${openedShiftInfo ? '#065F46' : '#C2410C'}; border-color:${openedShiftInfo ? '#10B981' : '#FB923C'};" onclick="promptOpenShiftFloatModal()">
              ${openedShiftInfo ? `🔓 ${t('已開班', 'Open', '開局済', '개시')}($${openedShiftInfo.openingFloat})` : `🔓 ${t('開班點鈔', 'Open Shift', '開局準備金', '개시 시재')}`}
            </button>
            <button type="button" class="pos-cat-pill" style="background:#0F172A; color:#FFFFFF; border-color:#0F172A;" onclick="openShiftZReportModal()">
              🧾 ${t('交班日結', 'Z-Report', 'レジ締め', '마감 정산')}
            </button>
          </div>
        </div>

        <div class="pos-cat-strip">
          ${categories.map(cat => `
            <button type="button" class="pos-cat-pill ${state.posSelectedCategory === cat ? 'active' : ''}" onclick="selectPosCategory(${escapeJsAttr(cat)})">
              ${escapeHtml(trTerm(cat))}
            </button>
          `).join('')}
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
                  <div class="pos-tile-meta-row" style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                    <span class="pos-tile-cat">${escapeHtml(trTerm(m.category || '主廚推薦'))}${hasDailyLimit && !isSoldOut ? ` · ${t(`剩${m.remainingToday}`, `${m.remainingToday} left`)}` : ''}</span>
                    <button type="button" class="pos-tile-soldout-btn" onclick="toggleMenuItemSoldOut(${fullIdx}, event)" style="border:none; background:${isSoldOut ? (m.soldOutType === 'PERMANENT' ? '#FEE2E2' : '#FEF3C7') : '#F1F5F9'}; color:${isSoldOut ? (m.soldOutType === 'PERMANENT' ? '#DC2626' : '#B45309') : '#475569'}; font-size:0.66rem; font-weight:900; padding:2px 6px; border-radius:6px;" title="${t('切換售罄或上架', 'Toggle Sold Out')}">
                      ${isSoldOut ? (m.soldOutType === 'PERMANENT' ? t('🚫 長期缺貨', '🚫 Out', '🚫 長期切', '🚫 장기품절') : t('📅 本日售完', '📅 Today Out', '📅 本日売切', '📅 오늘품절')) : (hasOpts ? t('⚙️ 客製', '⚙️ Opts', '⚙️ 選択', '⚙️ 옵션') : t('售罄', 'Out', '売切', '품절'))}
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
              🧾 ${t('櫃檯點餐單', 'Counter Ticket', 'レジ注文票', '카운터 주문서')} <span style="color:var(--brand-dark); font-size:0.82rem;">(#${nextPreviewSeq})</span>
            </div>
            <div style="font-size:0.74rem; color:var(--text-secondary);">${escapeHtml(trTerm(store.name))} · ${t(`共 ${totalCartItems} 份餐點`, `${totalCartItems} items`, `計 ${totalCartItems}点`, `총 ${totalCartItems}개`)}</div>
          </div>
          ${state.posCart.length > 0 ? `
            <div style="display:flex; gap:5px;">
              <button type="button" onclick="openPosSplitBillModal()" style="border:1px solid #6366F1; background:#EEF2FF; color:#3730A3; padding:4px 8px; border-radius:8px; font-size:0.74rem; font-weight:900;">✂️ ${t('拆單/AA', 'Split', '分割', '분할')}</button>
              <button type="button" onclick="holdCurrentPosOrder()" style="border:1px solid #F59E0B; background:#FFFBEB; color:#B45309; padding:4px 9px; border-radius:8px; font-size:0.74rem; font-weight:900;">⏸️ ${t('掛單', 'Hold', '保留', '보류')}</button>
              <button type="button" onclick="clearPosCart()" style="border:1px solid #FECACA; background:var(--red-bg); color:var(--red); padding:4px 9px; border-radius:8px; font-size:0.74rem; font-weight:800;">🗑️ ${t('清空', 'Clear', 'クリア', '비우기')}</button>
            </div>
          ` : ''}
        </div>

        <div class="pos-receipt-scroll-body">
          <div class="pos-receipt-list" style="min-height:175px;">
            ${state.posCart.length === 0 ? `
              <div style="text-align:center; color:var(--text-muted); padding:28px 12px; font-size:0.84rem;">
                <div style="font-size:2rem; margin-bottom:6px;">🍱</div>
                <div>${t('請點擊左側餐點卡片加入點餐單', 'Tap a dish on the left to add it to the ticket', '左のメニューをタップして注文票に追加', '왼쪽 메뉴를 탭하여 주문서에 추가하세요')}</div>
                <small style="font-size:0.74rem;">${t('支援一鍵快餐現金結帳、拆單 AA 與單品備註', '1-tap fast cash checkout, bill splitting & item notes', 'ワンタップ会計・割り勘・単品メモ対応', '원클릭 빠른 현금 결제・분할 결제・단품 메모 지원')}</small>
              </div>
            ` : state.posCart.map((item, idx) => {
              const selStr = item.selections && Object.keys(item.selections).length > 0
                ? Object.entries(item.selections).map(([k, v]) => `${trTerm(k)}:${trTerm(v)}`).join(', ')
                : '';
              const storeMenu = (store.menus || []).find(m => String(m.id) === String(item.id));
              const canEdit = storeMenu && storeMenu.options && Object.keys(storeMenu.options).length > 0;

              return `
                <div class="pos-receipt-item" style="padding:8px;">
                  <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                      <span data-dish-name="1" style="font-weight:900; font-size:0.88rem; color:var(--text-primary);">${escapeHtml(storeMenu ? trDishName(storeMenu) : trDishName(item))}</span>
                      ${item.itemComp ? `<span style="font-size:0.66rem; font-weight:900; background:#DCFCE7; color:#15803D; padding:1px 5px; border-radius:4px;">🎁 ${t('招待', 'Comp', 'サービス', '무료')}</span>` : (Number(item.itemDiscountAmount) > 0 ? `<span style="font-size:0.66rem; font-weight:900; background:#EEF2FF; color:#4338CA; padding:1px 5px; border-radius:4px;">-$${item.itemDiscountAmount}</span>` : '')}
                    </div>
                    ${selStr ? `<div style="font-size:0.72rem; color:var(--brand-dark); font-weight:700;">${escapeHtml(selStr)}</div>` : ''}
                    ${item.itemNote ? `<div style="font-size:0.72rem; color:#4338CA; font-weight:800;">📝 ${escapeHtml(item.itemNote)}</div>` : ''}
                    <div style="font-size:0.8rem; font-weight:950; color:var(--red);">NT$ ${(Number(item.price) || 0) * (item.qty || 1)}</div>
                  </div>
                  <div class="pos-receipt-item-actions" style="display:flex; align-items:center; gap:4px;">
                    <button type="button" onclick="promptPosCartItemNote(${idx})" title="${t('單品備註', 'Item Note')}" style="border:1px solid var(--border); background:${item.itemNote ? '#EEF2FF' : '#FFFFFF'}; color:#4338CA; width:28px; height:28px; border-radius:7px; font-size:0.75rem;">📝</button>
                    <button type="button" onclick="openPosItemDiscountModal(${idx})" title="${t('單品招待/折扣', 'Item Comp/Discount')}" style="border:1px solid var(--border); background:${item.itemComp || item.itemDiscountAmount > 0 ? '#DCFCE7' : '#FFFFFF'}; color:#059669; width:28px; height:28px; border-radius:7px; font-size:0.75rem;">🎁</button>
                    ${canEdit ? `<button type="button" onclick="editCartItemOptions(${idx}, true)" style="border:1px solid var(--border); background:#EFF6FF; color:#1D4ED8; width:28px; height:28px; border-radius:7px; font-size:0.76rem; font-weight:800;">✎</button>` : ''}
                    <button type="button" onclick="changePosCartQty(${idx}, -1)" style="border:1px solid var(--border); background:#FFFFFF; width:28px; height:28px; border-radius:7px; font-weight:900;">－</button>
                    <span style="font-weight:950; min-width:18px; text-align:center; font-size:0.86rem;">${item.qty || 1}</span>
                    <button type="button" onclick="changePosCartQty(${idx}, 1)" style="border:1px solid var(--border); background:#FFFFFF; width:28px; height:28px; border-radius:7px; font-weight:900;">＋</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- B9：進階選項移出捲動區並改為「向上展開浮層 (.pos-extra-popover)」，點一下立即完整看見所有選項免往下滑！ -->
        <div class="pos-receipt-controls">
          ${(state.posShowExtraPanel || isReserve) ? `
            <div class="pos-extra-popover" id="posExtraOptionsPopover">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #E2E8F0;">
                <span style="font-size:0.8rem; font-weight:950; color:#0F172A;">⚙️ ${t('進階結帳選項', 'Advanced Checkout Options', '詳細会計オプション', '추가 결제 옵션')}</span>
                <button type="button" onclick="state.posShowExtraPanel=false; renderPosCashierPanel(state.stores.find(s=>s.id===state.merchantStoreId));" style="border:1px solid #CBD5E1; background:#F8FAFC; color:#334155; padding:3px 10px; border-radius:999px; font-size:0.72rem; font-weight:900; cursor:pointer;">▼ ${t('收合', 'Hide', '閉じる', '접기')}</button>
              </div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-bottom:6px;">
                <button type="button" class="pos-chip-btn ${state.posTimeMode === 'NOW' ? 'active' : ''}" onclick="setPosOption('posTimeMode', 'NOW')">⚡ ${t('立即出餐', 'Make Now', '即時調理', '즉시 조리')}</button>
                <button type="button" class="pos-chip-btn ${state.posTimeMode === 'RESERVE' ? 'active' : ''}" onclick="setPosOption('posTimeMode', 'RESERVE')">📅 ${t('預訂取餐', 'Pre-order', '予約受取', '예약 픽업')}</button>
              </div>

              ${isReserve ? `
                <div style="display:grid; grid-template-columns:1fr 0.9fr 1.1fr; gap:4px; background:#F8FAFC; padding:5px; border-radius:8px; border:1px solid var(--border); margin-bottom:6px;">
                  <input type="date" class="select-input" style="padding:4px 6px; font-size:0.74rem;" min="${todayStr}" value="${escapeHtml(state.posReserveDate)}" onchange="setPosOption('posReserveDate', this.value)">
                  <select class="select-input" style="padding:4px 6px; font-size:0.74rem;" onchange="setPosOption('posReserveTime', this.value)">
                    ${posValidSlots.map(sl => `<option value="${sl}" ${state.posReserveTime === sl ? 'selected' : ''}>${sl}</option>`).join('')}
                  </select>
                  <input type="tel" id="posReservePhoneInput" class="select-input" style="padding:4px 6px; font-size:0.74rem; border-color:var(--red);" placeholder="📱 ${t('電話(必填)', 'Phone *')}" value="${escapeHtml(state.posCustomerPhone)}" oninput="state.posCustomerPhone=this.value">
                </div>
              ` : ''}

              <div class="pos-discount-strip" style="margin-bottom:5px; flex-wrap:wrap;">
                <span style="font-size:0.72rem; font-weight:900; color:var(--text-secondary); white-space:nowrap;">🏷️ ${t('折讓', 'Off', '割引', '할인')}:</span>
                <button type="button" class="pos-chip-btn ${state.posManualDiscount === 10 ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(10, '櫃檯折$10')">-$10</button>
                <button type="button" class="pos-chip-btn ${state.posManualDiscount === 20 ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(20, '櫃檯折$20')">-$20</button>
                <button type="button" class="pos-chip-btn ${subtotal > 0 && state.posManualDiscount >= subtotal ? 'active' : ''}" style="padding:3px 7px; font-size:0.72rem;" onclick="setPosManualDiscountPreset(${subtotal}, '全單招待')">${t('全單招待', 'Comp All', '全額サービス', '전액 무료')}</button>
                <button type="button" class="pos-chip-btn" style="padding:3px 7px; font-size:0.72rem; margin-left:auto;" onclick="promptCustomPosDiscount()">${t('自訂', 'Custom', 'カスタム', '직접')}</button>
              </div>

              <div class="pos-discount-strip" style="margin-bottom:6px; flex-wrap:wrap;">
                <span style="font-size:0.72rem; font-weight:900; color:var(--text-secondary); white-space:nowrap;">% ${t('折扣/費', '% / Fee', '％割引', '% 할인')}:</span>
                ${[[5, '95折', '5% off'], [10, '9折', '10% off'], [15, '85折', '15% off'], [20, '8折', '20% off']].map(([p, zhL, enL]) => `
                  <button type="button" class="pos-chip-btn ${state.posDiscountPercent === p ? 'active' : ''}" style="padding:3px 7px; font-size:0.7rem;" onclick="setPosPercentDiscount(${p})">${t(zhL, enL, `${p}%OFF`, `${p}%할인`)}</button>
                `).join('')}
                <button type="button" class="pos-chip-btn ${state.posServiceFeeRate === 10 ? 'active' : ''}" style="padding:3px 7px; font-size:0.7rem; margin-left:auto;" onclick="setPosServiceFeeRate(10)">+10% ${t('服務費', 'Svc', 'サ料', '봉사료')}</button>
              </div>

              <div style="display:grid; grid-template-columns:${isReserve ? '1.2fr 0.8fr' : '1.1fr 0.8fr 0.75fr'}; gap:4px; margin-bottom:6px;">
                <input type="text" id="posNoteInput" class="select-input" style="padding:5px 8px; font-size:0.75rem;" placeholder="📝 ${t('整單備註', 'Order Note', 'メモ', '메모')}" value="${escapeHtml(state.posCustomerNote || '')}" oninput="state.posCustomerNote=this.value">
                ${!isReserve ? `
                  <input type="tel" id="posPhoneInput" class="select-input" style="padding:5px 8px; font-size:0.75rem;" placeholder="📱 ${t('電話/末3碼', 'Phone', '電話', '전화번호')}" value="${escapeHtml(state.posCustomerPhone || '')}" oninput="state.posCustomerPhone=this.value">
                ` : ''}
                <input type="text" maxlength="8" inputmode="numeric" id="posTaxIdInput" class="select-input" style="padding:5px 8px; font-size:0.75rem; font-family:monospace;" placeholder="🏢 ${t('統編(8碼)', 'Tax ID (8)', '統一番号(8桁)', '사업자(8)')}" value="${escapeHtml(state.posTaxId || '')}" oninput="state.posTaxId=this.value.replace(/\\D/g,'').slice(0,8)">
              </div>

              <label style="display:flex; align-items:center; gap:6px; font-size:0.72rem; font-weight:800; color:var(--text-secondary); cursor:pointer;">
                <input type="checkbox" ${state.posAutoShowReceiptModal ? 'checked' : ''} onchange="togglePosAutoReceiptPreview(this.checked)" style="width:15px; height:15px; accent-color:var(--brand);">
                <span>🖨️ ${t('未接印表機時結帳後自動彈出 80mm 小票預覽（快餐尖峰建議關閉）', 'Auto-popup 80mm receipt preview after checkout (OFF recommended for rush)', '会計後に80mmレシートを自動表示（混雑時はOFF推奨）', '결제 후 80mm 영수증 자동 팝업 (피크 시 끄기 권장)')}</span>
              </label>
            </div>
          ` : ''}

          <div class="pos-dine-row" style="display:grid; grid-template-columns:1fr 1fr 1.2fr; gap:6px; margin-bottom:6px;">
            <button type="button" class="pos-chip-btn ${state.posDineType === '內用自取' ? 'active' : ''}" style="padding:7px 5px;" onclick="setPosOption('posDineType', '內用自取')">🍽️ ${t('內用自取', 'Dine-in', '店内', '매장')}</button>
            <button type="button" class="pos-chip-btn ${state.posDineType === '外帶自取' ? 'active' : ''}" style="padding:7px 5px;" onclick="setPosOption('posDineType', '外帶自取')">🛍️ ${t('外帶自取 (+$1)', 'Takeout (+$1)', '持帰 (+$1)', '포장 (+$1)')}</button>
            <button type="button" class="pos-chip-btn ${state.posNeedCutlery ? 'active' : ''}" style="padding:7px 5px;" onclick="setPosOption('posNeedCutlery', !state.posNeedCutlery)">
              🥢 ${t('餐具', 'Cutlery', '箸', '수저')}(${storeCutleryPrice > 0 ? `+$${storeCutleryPrice}` : '$0'})
            </button>
          </div>

          <button type="button" onclick="state.posShowExtraPanel=!state.posShowExtraPanel; renderPosCashierPanel(state.stores.find(s=>s.id===state.merchantStoreId));" style="width:100%; display:flex; justify-content:space-between; align-items:center; padding:6px 10px; border-radius:8px; border:1px solid ${state.posShowExtraPanel ? 'var(--brand)' : 'var(--border)'}; background:${state.posShowExtraPanel ? '#FFF7ED' : '#F8FAFC'}; color:${state.posShowExtraPanel ? 'var(--brand-dark)' : '#334155'}; font-size:0.75rem; font-weight:850; cursor:pointer;">
            <span>⚙️ ${t('進階選項（預訂 / 折讓 / 統編 / 備註）', 'Options (Pre-order / Discount / Tax ID / Note)', '詳細オプション（予約・割引・統一番号）', '추가 옵션 (예약 / 할인 / 사업자번호)')}${(isReserve || totalDiscountSum > 0 || serviceFee > 0 || state.posCustomerNote || state.posTaxId) ? ' · ✓' : ''}</span>
            <span>${state.posShowExtraPanel || isReserve ? `▼ ${t('收合', 'Hide', '閉じる', '접기')}` : `▲ ${t('向上展開', 'Expand Up', '上に開く', '위로 펼치기')}`}</span>
          </button>
        </div>

        <!-- 一-1：快餐一鍵結帳收銀列（免跳 3 層視窗，點一下剛好 / $100 / $500 / $1000 立即出單＋顯示非阻擋找零橫幅！） -->
        <div class="pos-receipt-footer">
          ${comboDiscount > 0 && comboAppliedRules.length > 0 ? `
            <div style="background:#ECFDF5; border:1px solid #6EE7B7; color:#065F46; border-radius:8px; padding:4px 8px; margin-bottom:6px; font-size:0.74rem; font-weight:900; display:flex; justify-content:space-between; align-items:center;">
              <span>🎁 ${t('組合優惠', 'Combo Deal')}: ${escapeHtml(comboAppliedRules.map(r => `${r.name}${r.pairs > 1 ? `×${r.pairs}` : ''}`).join('、'))}</span>
              <span>-NT$ ${comboDiscount}</span>
            </div>
          ` : ''}
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
            <span style="font-size:0.82rem; font-weight:900;">
              ${t('應收總計', 'Total Due', '合計金額', '총 결제액')}
              ${takeoutFee > 0 ? ` (${t('外帶', 'Takeout')}+$1)` : ''}
              ${cutleryFee > 0 ? ` (${t('餐具', 'Cutlery')}+$${cutleryFee})` : ''}
              ${serviceFee > 0 ? ` (+10% $${serviceFee})` : ''}
              ${totalDiscountSum > 0 ? `<span style="color:var(--green);"> (-$${totalDiscountSum})</span>` : ''}
            </span>
            <span style="font-size:1.38rem; font-weight:950; color:var(--red);">NT$ ${finalTotal}</span>
          </div>

          ${isBlockedByShiftLock ? `
            <button type="button" id="posCheckoutSubmitBtn" class="pos-checkout-btn" disabled>
              🔒 ${t('今日已交班日結鎖定 (僅開放預訂單)', 'Shift Locked (Pre-orders only)', '本日締め済（予約のみ）', '오늘 마감 잠금 (예약만 가능)')}
            </button>
          ` : `
            <div class="pos-fast-cash-grid">
              <button type="button" id="posFastExactBtn" class="pos-fast-cash-btn primary-exact" ${!canFastPay ? 'disabled style="opacity:0.45;"' : ''} onclick="triggerPosFastCashCheckout(${finalTotal})">
                ⚡ ${t('剛好', 'Exact', 'ぴったり', '정확히')}
              </button>
              <button type="button" class="pos-fast-cash-btn" ${!canFastPay || finalTotal > 100 ? 'disabled style="opacity:0.4;"' : ''} onclick="triggerPosFastCashCheckout(100)">$100</button>
              <button type="button" class="pos-fast-cash-btn" ${!canFastPay || finalTotal > 500 ? 'disabled style="opacity:0.4;"' : ''} onclick="triggerPosFastCashCheckout(500)">$500</button>
              <button type="button" class="pos-fast-cash-btn" ${!canFastPay || finalTotal > 1000 ? 'disabled style="opacity:0.4;"' : ''} onclick="triggerPosFastCashCheckout(1000)">$1000</button>
            </div>
            <div class="pos-fast-pay-row">
              <button type="button" id="posFastLinePayBtn" class="pos-fast-pay-btn" style="background:#00C300; color:#FFFFFF; border:none;" ${!canFastPay ? 'disabled style="opacity:0.45;"' : ''} onclick="openPosLinePayCheckoutModal()">
                💚 LINE Pay
              </button>
              <button type="button" id="posCheckoutSubmitBtn" class="pos-fast-pay-btn" style="background:#0F172A; color:#FFFFFF; border:none;" ${!canFastPay ? 'disabled style="opacity:0.45;"' : ''} onclick="openPosTwoStepCheckoutModal()">
                🔀 ${t('複合 / 鍵盤', 'Split / Pad', '併用・入力', '복합 / 키패드')}
              </button>
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  const newMenuGrid = document.querySelector('#storePanel-pos .pos-dish-grid');
  if (newMenuGrid && prevMenuGridScroll > 0) newMenuGrid.scrollTop = prevMenuGridScroll;
  const newReceiptBody = document.querySelector('#storePanel-pos .pos-receipt-scroll-body');
  if (newReceiptBody && prevReceiptScroll > 0) newReceiptBody.scrollTop = prevReceiptScroll;
}

// 一-4：POS 現場預覽單號統一採用 A001+ 專屬區間，與線上 B001+ 徹底隔離不撞號
function generatePreviewNextSeq(storeId, pickupDateStr) {
  return previewNextMerchantPosPickupNumber(storeId, pickupDateStr);
}

async function submitMerchantPosOrder(opts = {}) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  if (state.isPosSubmitting) {
    showToast(`⏳ ${t('櫃檯訂單正在出單處理中，請勿重複點擊！', 'Order is submitting, please wait...')}`);
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || state.posCart.length === 0) return;

  const isReserve = state.posTimeMode === 'RESERVE';
  const todayStr = getTodayDateStr();
  const lockedShiftInfo = getLockedShiftRecord(store.id, todayStr);
  if (lockedShiftInfo && !isReserve) {
    showToast(`🔒 ${t(`本店今日 (${todayStr}) 已完成交班日結鎖定！請先於日結單解鎖。`, `Shift locked for ${todayStr}. Unlock Z-Report first.`)}`);
    openShiftZReportModal();
    return;
  }

  const cleanPhone = (state.posCustomerPhone || '').replace(/\D/g, '');
  const cleanTaxId = (state.posTaxId || '').replace(/\D/g, '');

  if (cleanTaxId && !validateTaiwanTaxId(cleanTaxId)) {
    showToast(`⚠️ ${t('統一編號格式或邏輯檢核碼錯誤（請輸入有效 8 碼台灣統編）！', 'Invalid 8-digit Taiwan Tax ID checksum!')}`);
    return;
  }

  if (isReserve && cleanPhone.length < 8) {
    showToast(`⚠️ ${t('預訂取餐請輸入顧客聯絡電話號碼！', 'Phone number required for pre-orders!')}`);
    return;
  }

  state.isPosSubmitting = true;
  const posBtn = document.getElementById('posCheckoutSubmitBtn');
  if (posBtn) posBtn.disabled = true;

  try {
    const { subtotal, cutleryFee, takeoutFee, promoActive, comboDiscount, comboAppliedRules, discount, percentDiscount, manualDiscount, serviceFee, finalTotal } = calcCurrentPosTotals(store);
    const totalManualDisc = percentDiscount + manualDiscount;
    const discountReasons = [];
    if (comboDiscount > 0 && Array.isArray(comboAppliedRules)) {
      comboAppliedRules.forEach(cr => discountReasons.push(`組合折$${cr.amount}(${cr.name})`));
    }
    if (percentDiscount > 0) discountReasons.push(`${100 - state.posDiscountPercent}折 (-$${percentDiscount})`);
    if (manualDiscount > 0) discountReasons.push(state.posManualDiscountReason || `手動折讓 -$${manualDiscount}`);
    const combinedDiscountReason = discountReasons.join(' + ');

    const promoApplied = (totalManualDisc > 0 || comboDiscount > 0)
      ? (combinedDiscountReason || '櫃檯折讓')
      : (promoActive ? store.promoText : '現場櫃檯點餐');

    if (totalManualDisc > 0) {
      recordMerchantAuditLog('櫃檯折讓/折扣', `折讓 -NT$${totalManualDisc}（${combinedDiscountReason}，原價 $${subtotal}）`);
    }

    const isSplitPay = state.posPayment === '複合付款';
    const splitCashAmt = isSplitPay ? Math.min(finalTotal, Math.max(0, parseInt(state.posSplitCashAmount || '0', 10) || 0)) : 0;
    const splitLineAmt = isSplitPay ? Math.max(0, finalTotal - splitCashAmt) : 0;
    const paymentSplitObj = isSplitPay ? { cash: splitCashAmt, linePay: splitLineAmt } : null;

    const linePayDueAmt = state.posPayment === 'LINE Pay' ? finalTotal : (isSplitPay ? splitLineAmt : 0);
    let verifiedLinePayTxId = '';
    let verifiedLinePayMode = '';

    // 一-2：若含 LINE Pay 收款，先呼叫後端 posLinePayCharge 完成 OneTimeKey 真實請款或人工核對登錄！
    if (linePayDueAmt > 0) {
      const otk = String(state.posLinePayOneTimeKey || '').replace(/\D/g, '');
      const manualConfirmed = Boolean(state.posLinePayManualConfirmed);
      const manualRef = String(state.posLinePayManualRef || '').trim();
      if (otk.length !== 18 && !(manualConfirmed && manualRef.length >= 4)) {
        showToast(`⚠️ ${t('請先掃描顧客 18 碼 LINE Pay 付款碼，或勾選立牌核對並填入 4~8 碼交易末碼！', 'Please scan 18-digit LINE Pay barcode or confirm manual ref code!')}`);
        openPosTwoStepCheckoutModal();
        return;
      }
      const lpRes = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'posLinePayCharge',
          ...getMerchantAuthPayload(),
          storeId: store.id,
          amount: linePayDueAmt,
          oneTimeKey: otk,
          manualVerified: manualConfirmed,
          manualConfirmed: manualConfirmed,
          manualRefCode: manualRef
        })
      });
      const lpData = await lpRes.json();
      if (!lpData || !lpData.success) {
        showToast(`🚫 ${translateServerError((lpData && lpData.message) || 'LINE Pay 扣款核實失敗')}`);
        openPosTwoStepCheckoutModal();
        return;
      }
      verifiedLinePayTxId = String(lpData.transactionId || '');
      verifiedLinePayMode = String(lpData.linePayVerifiedMode || (otk.length === 18 ? 'API_VERIFIED' : 'MANUAL_CONFIRMED'));
    }

    const cashReceivedNum = state.posPayment === '現場現金'
      ? (state.posCashReceived !== '' ? parseFloat(state.posCashReceived) : finalTotal)
      : (isSplitPay ? splitCashAmt : finalTotal);
    const changeAmount = state.posPayment === '現場現金' ? Math.max(0, cashReceivedNum - finalTotal) : 0;

    const pickupDateVal = isReserve ? normalizeDateStr(state.posReserveDate) : getTodayDateStr();
    const nowTime = getTaipeiTimeHHMMSS();

    const structuredItems = state.posCart.map(i => {
      const mRef = (store.menus || []).find(m => String(m.id) === String(i.id));
      return normalizeOrderItemEntry({
        id: i.id,
        category: i.category || (mRef && mRef.category) || '',
        baseName: i.baseName || i.name,
        basePrice: i.origUnitPrice !== undefined ? i.origUnitPrice : (i.basePrice !== undefined ? i.basePrice : i.price),
        price: i.price,
        qty: i.qty || 1,
        selections: i.selections || {},
        itemNote: i.itemNote || '',
        itemComp: Boolean(i.itemComp),
        itemDiscountAmount: Number(i.itemDiscountAmount) || 0,
        snapshotAtTs: Date.now()
      });
    });

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
      customerNote: state.posCustomerNote || '',
      taxId: cleanTaxId,
      cashReceived: cashReceivedNum,
      changeGiven: changeAmount,
      paymentSplit: paymentSplitObj,
      splitCashAmount: splitCashAmt,
      splitLinePayAmount: splitLineAmt,
      linePayTransactionId: verifiedLinePayTxId,
      linePayVerifiedMode: verifiedLinePayMode,
      structuredItems,
      subtotal,
      cutleryFee,
      takeoutFee,
      needCutlery: state.posNeedCutlery,
      discount,
      manualDiscount: totalManualDisc,
      discountPercentOff: Number(state.posDiscountPercent) || 0,
      serviceFeeRate: Number(state.posServiceFeeRate) || 0,
      serviceFee: serviceFee,
      manualDiscountReason: combinedDiscountReason,
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

    // 一-1：立即設定非阻擋找零橫幅並清空購物車，店員 0 秒等待即可馬上點下一位！
    state.posLastChangeBanner = {
      orderId: draftOrder.orderId,
      pickupNumber: draftOrder.pickupNumber,
      cashReceived: cashReceivedNum,
      changeAmount: changeAmount,
      finalTotal: finalTotal,
      ts: Date.now()
    };

    state.posCart = [];
    state.posCashReceived = '';
    state.posSplitCashAmount = '';
    state.posManualDiscount = 0;
    state.posDiscountPercent = 0;
    state.posServiceFeeRate = 0;
    state.posManualDiscountReason = '';
    state.posDiscountOverridePin = '';
    state.posCustomerNote = '';
    state.posTaxId = '';
    state.posQtyMultiplier = 1;
    state.posLinePayOneTimeKey = '';
    state.posLinePayManualConfirmed = false;
    state.posLinePayManualRef = '';
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
        if (state.posLastChangeBanner && state.posLastChangeBanner.orderId === draftOrder.orderId) {
          state.posLastChangeBanner.pickupNumber = draftOrder.pickupNumber;
        }
        syncLocalSeqWithAuthoritativeNumber(store.id, pickupDateVal, draftOrder.pickupNumber);
        saveCachedOrders(state.orders);
        renderMerchantView();
        // 一-1 & 一-3：已配對印表機靜默點陣出單＋彈錢箱；未接印表機預設不跳阻擋小票窗（除非手動開啟自動預覽）
        const silentPrinted = await MerchantHardwarePrinter.printOrderByStationRoutes(draftOrder, true);
        if (!silentPrinted && state.posAutoShowReceiptModal) {
          openReceiptPrintModal(draftOrder.orderId);
        }
        showToast(`✅ ${t(`櫃檯出單 #${draftOrder.pickupNumber}`, `Order #${draftOrder.pickupNumber} placed`)}${silentPrinted ? ` (${t('已靜默出單', 'Printed')})` : ''}${changeAmount > 0 ? ` · ${t(`找零 NT$${changeAmount}`, `Change NT$${changeAmount}`)}` : ''}`);
        return;
      }
    } catch (e) {}

    const offlineSilentPrinted = await MerchantHardwarePrinter.printOrderByStationRoutes(draftOrder, true);
    if (!offlineSilentPrinted && state.posAutoShowReceiptModal) {
      openReceiptPrintModal(draftOrder.orderId);
    }
    showToast(`⚠️ ${t(`離線開單 #${draftOrder.pickupNumber}（連線恢復後原號同步）`, `Offline order #${draftOrder.pickupNumber} queued`)}`);
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
async function fetchAuthoritativeShiftZReport(storeId, shiftDate, shiftSlot) {
  if (!storeId || !isMerchantSessionValidNow()) return;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getShiftZReport',
        ...getMerchantAuthPayload(),
        storeId,
        shiftDate,
        shiftSlot
      })
    });
    const data = await res.json();
    if (data && data.success && data.authoritative) {
      state.shiftZReportCloudData = data;
      if (document.getElementById('receiptPrintModal')?.classList.contains('open')) {
        openShiftZReportModal(true);
      }
    }
  } catch (e) {}
}

function openShiftZReportModal(skipCloudFetch = false) {
  ensureSharedModalsMounted();
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;

  const todayStr = getTodayDateStr();
  const curSlot = state.activeShiftSlot || 'CURRENT_OPEN';
  const slotLabel = curSlot === 'CURRENT_OPEN'
    ? t('當班開班至今 (Open-to-Close)', 'Current Open Shift', '現在のシフト', '현재 개시 교대')
    : (curSlot === 'MORNING' ? t('早班 (~14:30)', 'Morning Shift', '早番', '오전 근무')
      : (curSlot === 'EVENING' ? t('晚班 (14:30~)', 'Evening Shift', '遅番', '오후 근무')
        : t('全日總結', 'Full Day', '終日集計', '종일 마감')));
  const lockedShiftInfo = getLockedShiftRecord(store.id, todayStr, curSlot === 'CURRENT_OPEN' ? 'FULL' : curSlot);

  if (!skipCloudFetch) {
    state.shiftZReportCloudData = null;
    fetchAuthoritativeShiftZReport(store.id, todayStr, curSlot);
  }

  const cloudZ = (state.shiftZReportCloudData && state.shiftZReportCloudData.storeId === store.id && state.shiftZReportCloudData.shiftSlot === curSlot)
    ? state.shiftZReportCloudData
    : null;

  // 本地即時預覽計算；一旦雲端全表權威掃描 (getShiftZReport) 回傳即自動升級為全試算表權威帳務數字！
  const storeAllOrders = state.orders.filter(o => o.storeId === store.id);
  const localSlotForFilter = curSlot === 'CURRENT_OPEN' ? 'FULL' : curSlot;
  const paidOrders = storeAllOrders.filter(o =>
    !String(o.status).includes('已取消') &&
    isOrderConsiderPaid(o) &&
    normalizeDateStr(o.paidAtDate || o.pickupDate) === todayStr &&
    isOrderInShiftSlot(o, localSlotForFilter)
  );
  const unpaidOrders = storeAllOrders.filter(o =>
    !String(o.status).includes('已取消') &&
    !isOrderConsiderPaid(o) &&
    normalizeDateStr(o.pickupDate) === todayStr &&
    isOrderInShiftSlot(o, localSlotForFilter)
  );
  const cancelledOrders = storeAllOrders.filter(o =>
    String(o.status).includes('已取消') &&
    normalizeDateStr(o.paidAtDate || o.pickupDate) === todayStr &&
    isOrderInShiftSlot(o, localSlotForFilter)
  );
  const refundedOrders = cancelledOrders.filter(o => Number(o.refundAmount) > 0 || String(o.paymentStatus).includes('已退款'));
  const voidUnpaidOrders = cancelledOrders.filter(o => !(Number(o.refundAmount) > 0 || String(o.paymentStatus).includes('已退款')));

  const crossDayPrepaidFulfilledToday = storeAllOrders.filter(o =>
    !String(o.status).includes('已取消') &&
    isOrderConsiderPaid(o) &&
    normalizeDateStr(o.pickupDate) === todayStr &&
    normalizeDateStr(o.paidAtDate || o.pickupDate) !== todayStr
  );
  const crossDayPrepaidTotal = crossDayPrepaidFulfilledToday.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const foodGrossSubtotal = cloudZ ? Number(cloudZ.grossSubtotal || 0) : paidOrders.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
  const cutleryFeeSum = paidOrders.reduce((s, o) => s + (Number(o.cutleryFee) || 0), 0);
  const serviceFeeSum = cloudZ ? Number(cloudZ.serviceFeeSum || 0) : paidOrders.reduce((s, o) => s + (Number(o.serviceFee) || 0), 0);
  const promoDiscountSum = cloudZ ? Number(cloudZ.discountTotal || 0) : paidOrders.reduce((s, o) => s + (Number(o.discount) || 0), 0);
  const manualDiscountSum = cloudZ ? 0 : paidOrders.reduce((s, o) => s + (Number(o.manualDiscount) || 0), 0);
  const netRevenue = cloudZ ? Number(cloudZ.netRevenue || 0) : paidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const paidOrderCount = cloudZ ? Number(cloudZ.validCount || 0) : paidOrders.length;
  const avgOrderValue = paidOrderCount > 0 ? Math.round(netRevenue / paidOrderCount) : 0;

  const cashOrders = paidOrders.filter(o =>
    (o.paymentSplit && Number(o.paymentSplit.cash) > 0) ||
    (!o.paymentSplit && (String(o.paymentMethod).includes('現金') || String(o.paymentMethod).includes('付現')))
  );
  const linePayOrders = paidOrders.filter(o =>
    (o.paymentSplit && Number(o.paymentSplit.linePay) > 0) ||
    (!o.paymentSplit && String(o.paymentMethod || '').includes('LINE Pay'))
  );

  const cashNetTotal = cloudZ
    ? Number(cloudZ.cashTotal || 0)
    : cashOrders.reduce((s, o) => s + (o.paymentSplit ? (Number(o.paymentSplit.cash) || 0) : (Number(o.finalTotal) || 0)), 0);
  const cashTenderedSum = cashOrders.reduce((s, o) => s + (o.paymentSplit ? (Number(o.paymentSplit.cash) || 0) : (Number(o.cashReceived) > 0 ? Number(o.cashReceived) : (Number(o.finalTotal) || 0))), 0);
  const cashChangeSum = cashOrders.reduce((s, o) => s + (o.paymentSplit ? 0 : (Number(o.changeGiven) || 0)), 0);
  const cashRefundSum = refundedOrders
    .filter(o => String(o.refundMethod || o.paymentMethod).includes('現金') || String(o.refundMethod || o.paymentMethod).includes('付現'))
    .reduce((s, o) => s + (Number(o.refundAmount) || Number(o.finalTotal) || 0), 0);
  const partialCashRefundSum = cloudZ ? Number(cloudZ.partialRefundTotal || 0) : paidOrders.reduce((s, o) => s + (Number(o.partialRefundTotal) || 0), 0);

  const pettyEntries = getShiftPettyCashEntries(store.id, todayStr, localSlotForFilter);
  const pettyCashInSum = cloudZ ? Number(cloudZ.pettyCashIn || 0) : pettyEntries.filter(e => e.type === 'IN').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pettyCashOutSum = cloudZ ? Number(cloudZ.pettyCashOut || 0) : pettyEntries.filter(e => e.type === 'OUT').reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const openingFloat = Math.max(0, Number(state.shiftOpeningFloat) || 0);
  const expectedTotalCashInDrawer = cloudZ
    ? Math.max(0, Number(cloudZ.expectedCash || 0))
    : Math.max(0, openingFloat + cashNetTotal + pettyCashInSum - pettyCashOutSum - cashRefundSum - partialCashRefundSum);
  const actualCountedNum = state.shiftActualCountedCash !== '' ? Math.max(0, Number(state.shiftActualCountedCash) || 0) : expectedTotalCashInDrawer;
  const cashVariance = actualCountedNum - expectedTotalCashInDrawer;

  const linePayTotal = cloudZ
    ? Number(cloudZ.linePayTotal || 0)
    : linePayOrders.reduce((s, o) => s + (o.paymentSplit ? (Number(o.paymentSplit.linePay) || 0) : (Number(o.finalTotal) || 0)), 0);
  const linePayFeeRate = cloudZ ? Number(cloudZ.linePayFeeRate || 2.2) : Number(store.linePayFeeRate !== undefined ? store.linePayFeeRate : 2.2);
  const linePayEstFee = cloudZ ? Number(cloudZ.linePayEstimatedFee || 0) : Math.round(linePayTotal * (linePayFeeRate / 100));
  const linePayNetSettlement = cloudZ ? Number(cloudZ.linePayNetSettlement || 0) : Math.max(0, linePayTotal - linePayEstFee);
  const linePayApiTotal = cloudZ ? Number(cloudZ.linePayApiVerifiedTotal || 0) : 0;
  const linePayManualTotal = cloudZ ? Number(cloudZ.linePayManualTotal || 0) : linePayTotal;

  const totalExtraSurchargeSum = cloudZ ? Number(cloudZ.extraChargeTotal || 0) : paidOrders.reduce((s, o) => s + (Number(o.extraChargeTotal) || 0), 0);
  const refundedTotal = refundedOrders.reduce((s, o) => s + (Number(o.refundAmount) || Number(o.finalTotal) || 0), 0);
  const voidUnpaidTotal = cloudZ ? Number(cloudZ.voidedTotal || 0) : voidUnpaidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
  const unpaidTotal = cloudZ ? Number(cloudZ.unpaidTotal || 0) : unpaidOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);

  const dineInCount = cloudZ ? Number(cloudZ.dineInCount || 0) : paidOrders.filter(o => o.dineType === '內用自取').length;
  const takeoutCount = cloudZ ? Number(cloudZ.takeoutCount || 0) : Math.max(0, paidOrderCount - dineInCount);

  const titleEl = document.getElementById('receiptPrintModalTitle');
  if (titleEl) titleEl.innerText = `🧾 ${t('櫃檯錢箱交班日結單', 'Shift Cash Drawer Z-Report', 'レジ精算書', '교대 마감 정산서')} (${slotLabel})`;

  const body = document.getElementById('receiptPrintModalBody');
  if (body) {
    body.innerHTML = `
      <div class="no-print" style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:12px; padding:12px; margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
          <div style="font-size:0.82rem; font-weight:900; color:#0F172A;">
            🪙 ${t('多班別錢箱清點・中途零用金收支與關班鎖定', 'Multi-Shift Drawer Count, Petty Cash & Lock', 'シフト精算・小口現金・締めロック', '교대 시재 점검・소액 현금 및 잠금')}
            <span style="margin-left:6px; font-size:0.7rem; padding:2px 7px; border-radius:999px; background:${cloudZ ? '#DCFCE7' : '#FEF3C7'}; color:${cloudZ ? '#166534' : '#92400E'};">
              ${cloudZ ? `☁️ ${t(`雲端全表權威 (${cloudZ.totalRowsScanned} 筆掃描)`, `Server Verified (${cloudZ.totalRowsScanned} rows)`)}` : `⏳ ${t('同步雲端全表中...', 'Syncing server...')}`}
            </span>
          </div>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            <button type="button" class="pos-cat-pill ${curSlot === 'CURRENT_OPEN' ? 'active' : ''}" style="padding:4px 10px; font-size:0.72rem;" onclick="setActiveShiftSlot('CURRENT_OPEN')">🕒 ${t('當班至今', 'Open Shift', '現在シフト', '현재 교대')}</button>
            <button type="button" class="pos-cat-pill ${curSlot === 'MORNING' ? 'active' : ''}" style="padding:4px 10px; font-size:0.72rem;" onclick="setActiveShiftSlot('MORNING')">☀️ ${t('早班', 'Morning', '早番', '오전')}</button>
            <button type="button" class="pos-cat-pill ${curSlot === 'EVENING' ? 'active' : ''}" style="padding:4px 10px; font-size:0.72rem;" onclick="setActiveShiftSlot('EVENING')">🌙 ${t('晚班', 'Evening', '遅番', '오후')}</button>
            <button type="button" class="pos-cat-pill ${curSlot === 'FULL' ? 'active' : ''}" style="padding:4px 10px; font-size:0.72rem;" onclick="setActiveShiftSlot('FULL')">📅 ${t('全日', 'Full Day', '終日', '종일')}</button>
          </div>
        </div>
        ${cloudZ ? `
          <div style="font-size:0.74rem; color:#1E40AF; background:#EFF6FF; border:1px solid #BFDBFE; padding:6px 10px; border-radius:8px; margin-bottom:10px; font-weight:800;">
            ⏱️ ${t('統計時間區間', 'Accounting Window', '集計期間', '정산 기간')}：${escapeHtml(cloudZ.windowStartStr)} ～ ${escapeHtml(cloudZ.windowEndStr)}
          </div>
        ` : ''}
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(145px, 1fr)); gap:8px; margin-bottom:10px;">
          <div>
            <label class="field-label">${t('開店找零零用金 ($)', 'Opening Float ($)', '開店準備金 ($)', '개시 시재 ($)')}</label>
            <input type="number" class="select-input" style="padding:6px 8px; font-size:0.82rem;" value="${openingFloat}" ${lockedShiftInfo ? 'disabled' : ''} onchange="updateShiftSettlementField('shiftOpeningFloat', this.value)">
          </div>
          <div>
            <label class="field-label">${t('櫃檯實際清點現金 ($)', 'Actual Cash Counted ($)', '実査現金合計 ($)', '실제 시재 현금 ($)')}</label>
            <input type="number" class="select-input" style="padding:6px 8px; font-size:0.82rem;" placeholder="${t(`應有 $${expectedTotalCashInDrawer}`, `Expected $${expectedTotalCashInDrawer}`)}" value="${escapeHtml(state.shiftActualCountedCash)}" ${lockedShiftInfo ? 'disabled' : ''} onchange="updateShiftSettlementField('shiftActualCountedCash', this.value)">
          </div>
          <div>
            <label class="field-label">${t('交班收銀員姓名', 'Cashier Name', '担当氏名', '캐셔 이름')}</label>
            <input type="text" class="select-input" style="padding:6px 8px; font-size:0.82rem;" placeholder="${t('如：王店長', 'e.g. Alex')}" value="${escapeHtml(state.shiftCashierName)}" ${lockedShiftInfo ? 'disabled' : ''} onchange="updateShiftSettlementField('shiftCashierName', this.value)">
          </div>
        </div>

        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px; margin-bottom:10px;">
          <div style="font-size:0.78rem; font-weight:900; color:#334155; margin-bottom:6px;">
            💸 ${t('中途零用金收支登記（買冰塊、塑膠袋或補零錢，自動計入應有現金）', 'Mid-Shift Petty Cash Log (auto-adjusted in expected cash)', '途中入出金記録', '근무 중 소액 현금 입출금')}
          </div>
          ${!lockedShiftInfo ? `
            <div style="display:grid; grid-template-columns:0.9fr 0.8fr 1.6fr auto; gap:6px; align-items:center; margin-bottom:8px;">
              <select id="pettyCashTypeSelect" class="select-input" style="padding:5px 8px; font-size:0.78rem;">
                <option value="OUT">📤 ${t('錢箱支出 (-$)', 'Cash Out (-$)')}</option>
                <option value="IN">📥 ${t('錢箱補入 (+$)', 'Cash In (+$)')}</option>
              </select>
              <input type="number" id="pettyCashAmountInput" class="select-input" style="padding:5px 8px; font-size:0.78rem;" placeholder="${t('金額 ($)', 'Amount ($)')}">
              <input type="text" id="pettyCashNoteInput" class="select-input" style="padding:5px 8px; font-size:0.78rem;" placeholder="${t('事由 (如: 買冰塊)', 'Reason (e.g. ice)')}">
              <button type="button" class="btn-tip-action" style="padding:6px 10px; font-size:0.76rem;" onclick="addShiftPettyCashEntry()">＋ ${t('登記', 'Add')}</button>
            </div>
          ` : ''}
          ${pettyEntries.length === 0 ? `
            <div style="font-size:0.74rem; color:var(--text-muted);">${t('今日尚無中途零用金支出或補入紀錄', 'No petty cash entries today', '本日の入出金記録なし', '오늘 소액 현금 기록 없음')}</div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:4px; max-height:110px; overflow-y:auto;">
              ${pettyEntries.map(e => `
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.75rem; background:#F8FAFC; padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0;">
                  <span>
                    <strong style="color:${e.type === 'OUT' ? 'var(--red)' : 'var(--green)'};">${e.type === 'OUT' ? `${t('支出', 'Out')} -$` : `${t('補入', 'In')} +$`}${e.amount}</strong>
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
              🔒 ${t(`本班已完成關班鎖定（時間：${lockedShiftInfo.lockedAt} ・ 經手人：${lockedShiftInfo.cashier}）`, `Shift locked (${lockedShiftInfo.lockedAt} · ${lockedShiftInfo.cashier})`)}
            </div>
            <button type="button" onclick="unlockTodayShiftSettlement()" style="border:1px solid #059669; background:#FFFFFF; color:#065F46; padding:5px 10px; border-radius:6px; font-size:0.74rem; font-weight:900; cursor:pointer;">
              🔓 ${t('店長授權解鎖重結', 'Manager Unlock')}
            </button>
          </div>
        ` : `
          <button type="button" class="btn-tip-action" style="width:100%; background:#0F172A; padding:9px;" onclick="lockTodayShiftSettlement(${expectedTotalCashInDrawer}, ${actualCountedNum}, ${cashVariance})">
            🔒 ${t('確認完成本班日結並鎖定當日帳務 (防篡改)', 'Confirm & Lock Shift Z-Report', 'シフト精算を確定してロック', '교대 정산 확정 및 장부 잠금')}
          </button>
        `}
      </div>

      <div class="thermal-receipt-paper">
        <div style="text-align:center; margin-bottom:8px;">
          <div style="font-size:0.76rem; font-weight:800;">${escapeHtml(BRAND_CONFIG.posTitle)}</div>
          <div style="font-size:1.1rem; font-weight:950; margin:2px 0;">${escapeHtml(trTerm(store.name))}</div>
          <div style="font-size:0.85rem; font-weight:900; background:#000; color:#fff; padding:3px 10px; border-radius:4px; display:inline-block; margin-top:4px;">
            ${t('櫃檯錢箱交班日結單', 'Cash Drawer Z-Report', 'レジ精算書', '교대 마감 정산서')} (${slotLabel})
          </div>
        </div>

        <div style="font-size:0.76rem; line-height:1.5;">
          <div>${t('營業收款日', 'Business Date')}：${todayStr}</div>
          <div>${t('出表時間', 'Generated')}：${getTaipeiTimeHHMMSS()}</div>
          <div>${t('值班人員', 'Cashier')}：${escapeHtml(trTerm(state.shiftCashierName || (lockedShiftInfo && lockedShiftInfo.cashier) || '當班收銀員'))}</div>
          <div>${t('當班收款單數', 'Paid Orders')}：${paidOrderCount} (${t('內用', 'Dine-in')} ${dineInCount} / ${t('外帶', 'Takeout')} ${takeoutCount})</div>
          <div>${t('平均客單價', 'Avg Order')}：NT$ ${avgOrderValue.toLocaleString()}</div>
        </div>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">${t('【一、當班收款損益與費用拆解】', '[1. Shift Revenue & Deductions]')}</div>
        <table class="z-report-table">
          <tr><td>${t('餐點商品毛銷售額', 'Gross Sales')}</td><td>NT$ ${foodGrossSubtotal.toLocaleString()}</td></tr>
          <tr><td>${t('一次性環保餐具費', 'Cutlery Fee')}</td><td>+NT$ ${cutleryFeeSum.toLocaleString()}</td></tr>
          ${serviceFeeSum > 0 ? `<tr><td>${t('服務費收入', 'Service Fee')}</td><td>+NT$ ${serviceFeeSum.toLocaleString()}</td></tr>` : ''}
          <tr><td>${t('優惠 / 折讓合計', 'Total Discounts')}</td><td>-NT$ ${(promoDiscountSum + manualDiscountSum).toLocaleString()}</td></tr>
          <tr style="border-top:1px solid #000; font-size:0.92rem;"><td><strong>${t('當班實收淨營業額', 'Net Paid Revenue')}</strong></td><td><strong>NT$ ${netRevenue.toLocaleString()}</strong></td></tr>
        </table>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">${t('【二、錢箱現金收付與盤點核對】', '[2. Cash Drawer Reconciliation]')}</div>
        <table class="z-report-table">
          <tr><td>${t('開店找零準備金', 'Opening Float')}</td><td>NT$ ${openingFloat.toLocaleString()}</td></tr>
          <tr><td>${t('現金營業淨入帳', 'Net Cash Sales')}</td><td>+NT$ ${cashNetTotal.toLocaleString()}</td></tr>
          ${cashRefundSum > 0 ? `<tr><td>${t('現金退單退款', 'Cash Refunds')}</td><td>-NT$ ${cashRefundSum.toLocaleString()}</td></tr>` : ''}
          ${partialCashRefundSum > 0 ? `<tr><td>${t('改單部分退現', 'Partial Refunds')}</td><td>-NT$ ${partialCashRefundSum.toLocaleString()}</td></tr>` : ''}
          ${totalExtraSurchargeSum > 0 ? `<tr><td>${t('改單補收差額', 'Add-on Extra')}</td><td>+NT$ ${totalExtraSurchargeSum.toLocaleString()}</td></tr>` : ''}
          ${pettyCashInSum > 0 ? `<tr><td>${t('中途零用金補入', 'Petty Cash In')}</td><td>+NT$ ${pettyCashInSum.toLocaleString()}</td></tr>` : ''}
          ${pettyCashOutSum > 0 ? `<tr><td>${t('中途零用金支出', 'Petty Cash Out')}</td><td>-NT$ ${pettyCashOutSum.toLocaleString()}</td></tr>` : ''}
          <tr style="border-top:1px dashed #000;"><td><strong>🏦 ${t('錢箱應有現金總額', 'Expected Drawer Cash')}</strong></td><td><strong>NT$ ${expectedTotalCashInDrawer.toLocaleString()}</strong></td></tr>
          <tr><td>${t('櫃檯實際清點現金', 'Actual Counted Cash')}</td><td>NT$ ${actualCountedNum.toLocaleString()}</td></tr>
          <tr style="border-top:1px solid #000;"><td><strong>${t('盤點差額 (短溢)', 'Drawer Variance')}</strong></td><td><strong>${cashVariance === 0 ? `NT$ 0 (${t('帳實相符', 'Balanced')})` : (cashVariance > 0 ? `+NT$ ${cashVariance} (${t('溢收', 'Over')})` : `-NT$ ${Math.abs(cashVariance)} (${t('短少', 'Short')})`)}</strong></td></tr>
        </table>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">${t('【三、LINE Pay 核實分類與預估實拿】', '[3. LINE Pay Verification & Net Settlement]')}</div>
        <table class="z-report-table">
          <tr><td>💚 ${t('LINE Pay 總額', 'LINE Pay Gross')}</td><td>NT$ ${linePayTotal.toLocaleString()}</td></tr>
          ${cloudZ ? `<tr><td>　└ ${t('API 系統核實 (Online/OneTimeKey)', 'API Verified')}</td><td>NT$ ${linePayApiTotal.toLocaleString()}</td></tr>` : ''}
          ${cloudZ ? `<tr><td>　└ ${t('立牌人工確認', 'Manual Confirmed')}</td><td>NT$ ${linePayManualTotal.toLocaleString()}</td></tr>` : ''}
          <tr><td>${t(`預估金流手續費 (${linePayFeeRate}%)`, `Est. Gateway Fee (${linePayFeeRate}%)`)}</td><td>-NT$ ${linePayEstFee.toLocaleString()}</td></tr>
          <tr style="border-top:1px dashed #000;"><td><strong>${t('預估實際撥款淨額', 'Est. Net Settlement')}</strong></td><td><strong>NT$ ${linePayNetSettlement.toLocaleString()}</strong></td></tr>
        </table>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem; font-weight:900; margin-bottom:4px;">${t('【四、待收款、作廢與跨日預收對帳】', '[4. Unpaid, Voids & Cross-Day Pre-orders]')}</div>
        <table class="z-report-table">
          <tr><td>⏳ ${t('當班待收款訂單', 'Unpaid Orders')}</td><td>NT$ ${unpaidTotal.toLocaleString()}</td></tr>
          <tr><td>💸 ${t('已付款退單退款', 'Refunded Voids')}</td><td>NT$ ${refundedTotal.toLocaleString()}</td></tr>
          <tr><td>🚫 ${t('未收款作廢取消', 'Unpaid Voids')}</td><td>NT$ ${voidUnpaidTotal.toLocaleString()}</td></tr>
          <tr><td>📦 ${t('跨日預收今日履約 (不重複入錢箱)', 'Prior-Day Prepaid Today')}</td><td>NT$ ${crossDayPrepaidTotal.toLocaleString()}</td></tr>
        </table>

        <div class="thermal-divider"></div>
        <div style="font-size:0.74rem; line-height:1.8; margin-top:8px;">
          <div>${t('值班收銀員簽名', 'Cashier Signature')}：<u>&nbsp;&nbsp;${escapeHtml(trTerm(state.shiftCashierName || '__________________'))}&nbsp;&nbsp;</u></div>
          <div>${t('店長覆核簽名', 'Manager Sign-off')}：____________________</div>
        </div>
      </div>
    `;
  }
  document.getElementById('receiptPrintModal')?.classList.add('open');
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
    state.routeMode = state.isMerchantUnlocked ? 'store' : 'order';
    applyRouteView();
    syncUrlStateWithHistory(true);
  } else if (state.routeMode === 'store' && state.isMerchantUnlocked) {
    renderMerchantView();
  }
  updateBodyScrollLock();
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
      <div id="customerPickupBoardModal" class="modal-overlay" style="z-index:1200; padding:16px; background:rgba(15,23,42,0.96);">
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

function getStandaloneTvBoardUrl(storeId) {
  const cleanId = String(storeId || state.pickupBoardStoreId || state.merchantStoreId || 'S01').trim().toUpperCase();
  if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
    return `${getBaseRootUrl()}board/index.html?store=${encodeURIComponent(cleanId)}`;
  }
  return `${getBaseRootUrl()}board/?store=${encodeURIComponent(cleanId)}`;
}

function openStandaloneTvBoardWindow(storeId) {
  const url = getStandaloneTvBoardUrl(storeId);
  const win = window.open(url, '_blank', 'noopener');
  if (!win) {
    window.location.href = url;
  } else {
    showToast('📺 已開啟麥當勞風格電視全螢幕大看板！可按 Chrome 投放或接電視 HDMI 全螢幕播放');
  }
}

function copyStandaloneTvBoardUrl(storeId) {
  const url = getStandaloneTvBoardUrl(storeId);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('✅ 已複製電視大看板專屬網址！可直接在智慧電視瀏覽器開啟或投放');
    }).catch(() => showToast('📺 電視看板網址：' + url));
  } else {
    showToast('📺 電視看板網址：' + url);
  }
}

function togglePickupBoardTvCastGuide() {
  state.showPickupBoardCastGuide = !state.showPickupBoardCastGuide;
  renderCustomerPickupBoardContent(false);
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
  const tvShareUrl = getStandaloneTvBoardUrl(store.id);
  const tvQrSvg = (state.showPickupBoardCastGuide && typeof generateDeterministicQrSvg === 'function')
    ? generateDeterministicQrSvg(tvShareUrl, 124)
    : '';

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
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:16px; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="font-size:2.4rem;">${getStoreIconDisplay(store)}</span>
          <div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <h2 style="font-size:1.55rem; font-weight:950; color:#FFFFFF; letter-spacing:0.02em; margin:0;">${escapeHtml(trTerm(store.name))} — ${t('即時取餐叫號看板', 'Live Pickup Call Board')}</h2>
              <span style="font-size:0.75rem; font-weight:900; background:#065F46; color:#6EE7B7; padding:3px 10px; border-radius:999px; border:1px solid #10B981;">
                ● LIVE ${t('雲端即時同步中', 'Cloud Sync')} (<span id="pickupBoardLiveClock">${getTaipeiTimeHHMMSS()}</span>)
              </span>
            </div>
            <div style="font-size:0.84rem; color:#94A3B8; margin-top:3px;">${t('請留意您的取餐號碼，顯示於右側綠區即可至櫃檯取餐；點擊右側按鈕即可免登入投上大電視！', 'Watch for your pickup number on the right green panel. Launch the TV mode on the right to cast!')}</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <select class="select-input" style="width:auto; background:#1E293B; color:#FFFFFF; border-color:#475569; padding:7px 12px; font-size:0.82rem; font-weight:800;" onchange="switchPickupBoardStore(this.value)">
            ${state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>${t('切換看板店鋪：', 'Store: ')}${escapeHtml(trTerm(s.name))}</option>`).join('')}
          </select>
          <button type="button" onclick="openStandaloneTvBoardWindow(${escapeJsAttr(store.id)})" style="border:1.5px solid #FF5A1F; background:#FF5A1F; color:#FFFFFF; padding:8px 14px; border-radius:999px; font-weight:900; font-size:0.82rem; cursor:pointer; box-shadow:0 4px 14px rgba(255,90,31,0.35);">
            📺 ${t('開啟全螢幕電視大看板', 'Open Fullscreen TV Board')}
          </button>
          <button type="button" onclick="copyStandaloneTvBoardUrl(${escapeJsAttr(store.id)})" style="border:1px solid #38BDF8; background:#0C4A6E; color:#E0F2FE; padding:8px 13px; border-radius:999px; font-weight:800; font-size:0.82rem; cursor:pointer;">
            📋 ${t('複製電視網址', 'Copy TV URL')}
          </button>
          <button type="button" onclick="togglePickupBoardTvCastGuide()" style="border:1px solid #A855F7; background:#3B0764; color:#F3E8FF; padding:8px 13px; border-radius:999px; font-weight:800; font-size:0.82rem; cursor:pointer;">
            📡 ${t('投上電視教學 / QR', 'Cast Guide / QR')}
          </button>
          <button type="button" onclick="ensureAudioContextUnlocked(true); showToast('🔊 已啟用叫號看板語音與叮咚音效！');" style="border:1px solid #10B981; background:#065F46; color:#FFFFFF; padding:8px 13px; border-radius:999px; font-weight:800; font-size:0.82rem; cursor:pointer;">
            🔊 ${t('啟用叫號音效', 'Enable Voice')}
          </button>
          <button type="button" onclick="closeCustomerPickupBoardModal()" style="border:1px solid #475569; background:#1E293B; color:#FFFFFF; padding:8px 16px; border-radius:999px; font-weight:800; font-size:0.85rem; cursor:pointer;">
            ✕ ${state.routeMode === 'board' ? t('返回點餐首頁', 'Home') : t('關閉看板', 'Close')}
          </button>
        </div>
      </div>

      ${state.showPickupBoardCastGuide ? `
        <div style="background:#1E293B; border:1.5px solid #38BDF8; border-radius:16px; padding:14px 16px; margin-bottom:16px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
          <div style="background:#FFFFFF; padding:6px; border-radius:10px; width:108px; height:108px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            ${tvQrSvg}
          </div>
          <div style="flex:1; min-width:240px;">
            <div style="font-size:0.95rem; font-weight:900; color:#38BDF8; margin-bottom:4px;">📺 ${t('免登入麥當勞風格電視投屏方案（永不過期・每 5 秒同步・防休眠）', 'Zero-Login McDonald-Style TV Casting (5s Live Sync & WakeLock)')}</div>
            <div style="font-size:0.8rem; color:#CBD5E1; line-height:1.55;">
              1️⃣ <strong>Chrome 投放 (Chromecast / Google TV)</strong>：點上方「📺 開啟全螢幕電視大看板」→ Chrome 右上角 ⋮ → 投放分頁至電視。<br>
              2️⃣ <strong>智慧電視 / 電視盒 / HDMI</strong>：掃左側 QR Code 或貼上網址於電視瀏覽器開啟並按全螢幕，POS 出餐立即放大顯示並語音叫號！
            </div>
            <div style="margin-top:6px; font-family:monospace; font-size:0.75rem; color:#6EE7B7; word-break:break-all;">${escapeHtml(tvShareUrl)}</div>
          </div>
        </div>
      ` : ''}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; min-height:390px;">
        <div style="background:#1E293B; border:1.5px solid #334155; border-radius:18px; padding:18px;">
          <div style="font-size:1.15rem; font-weight:900; color:#FBBF24; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
            <span>🍳 ${t('廚房準備中 (Preparing)', 'Preparing')}</span>
            <span style="font-size:0.85rem; background:rgba(251,191,36,0.15); padding:3px 10px; border-radius:999px;">${cookingNumbers.length} ${t('單', 'orders')}</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(125px, 1fr)); gap:12px;">
            ${cookingNumbers.length === 0 ? `<div style="grid-column:1/-1; color:#64748B; text-align:center; padding:60px 0; font-weight:700;">${t('目前無準備中單號', 'No orders preparing')}</div>` : cookingNumbers.map(num => `
              <div style="background:#0F172A; border:1.5px solid #475569; border-radius:14px; padding:14px 10px; text-align:center; font-size:1.85rem; font-weight:950; color:#F8FAFC;">
                #${escapeHtml(num)}
              </div>
            `).join('')}
          </div>
        </div>

        <div style="background:rgba(16,185,129,0.1); border:2px solid #10B981; border-radius:18px; padding:18px;">
          <div style="font-size:1.15rem; font-weight:900; color:#34D399; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
            <span>🔔 ${t('請至櫃檯取餐 (Ready for Pickup)', 'Now Serving')}</span>
            <span style="font-size:0.85rem; background:rgba(16,185,129,0.25); padding:3px 10px; border-radius:999px;">${readyNumbers.length} ${t('單', 'orders')}</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:12px;">
            ${readyNumbers.length === 0 ? `<div style="grid-column:1/-1; color:#6EE7B7; opacity:0.65; text-align:center; padding:60px 0; font-weight:700;">${t('請稍候，餐點完成將立即顯示並語音叫號', 'Ready numbers will appear here')}</div>` : readyNumbers.map(num => {
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
                if (state._qrScannerTargetMode === 'POS_LINEPAY_OTK') {
                  state._qrScannerTargetMode = '';
                  state.posLinePayOneTimeKey = String(rawVal || '').replace(/\D/g, '').slice(0, 18);
                  renderPosTwoStepCheckoutModal();
                  showToast(`📷 ${t('已掃入 LINE Pay 付款碼', 'LINE Pay barcode scanned')}`);
                } else {
                  quickVerifyAndCompleteByCode(rawVal);
                }
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
                if (state._qrScannerTargetMode === 'POS_LINEPAY_OTK') {
                  state._qrScannerTargetMode = '';
                  state.posLinePayOneTimeKey = String(codeObj.data || '').replace(/\D/g, '').slice(0, 18);
                  renderPosTwoStepCheckoutModal();
                  showToast(`📷 ${t('已掃入 LINE Pay 付款碼', 'LINE Pay barcode scanned')}`);
                } else {
                  quickVerifyAndCompleteByCode(codeObj.data);
                }
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

// 二-4：KDS 廚房單品逐項劃單（點擊打勾/取消並即時雲端同步；伺服器失敗或離線自動回滾避免廚房誤以為同步成功！）
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
  const prevVal = Boolean(order.itemCheckedMap[itemKey]);
  const nextVal = !prevVal;
  order.itemCheckedMap[itemKey] = nextVal;
  saveCachedOrders(state.orders);
  renderMerchantOrdersOnly(null, true);

  try {
    const res = await fetch(GAS_URL, {
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
    const data = await res.json();
    if (!data || !data.success) {
      throw new Error((data && data.message) || '劃單狀態同步失敗');
    }
  } catch (e) {
    // 失敗嚴格回滾，防止多台平板廚房進度不一致
    order.itemCheckedMap[itemKey] = prevVal;
    saveCachedOrders(state.orders);
    renderMerchantOrdersOnly(null, true);
    showToast(`⚠️ ${t('劃單同步失敗已還原，請檢查網路後重試', 'Item check sync failed — reverted')}`);
  }
}

function toggleKdsCardMoreMenu(orderId) {
  state.kdsExpandedMoreOrderId = state.kdsExpandedMoreOrderId === orderId ? '' : orderId;
  renderMerchantOrdersOnly(null, true);
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
  if (titleEl) titleEl.innerText = `✏️ ${t('改單 / 加點 / 單品作廢', 'Modify / Add / Void Item', '注文修正・追加・単品取消', '주문 수정 / 추가 / 단품 취소')} (#${order.pickupNumber})`;

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
      💡 ${t('可直接加點、增減份數或作廢缺貨單品；若已付款且修改後金額上升，請於下方選擇補收差額方式以確保交班帳務零誤差。', 'Add items, adjust quantities, or void out-of-stock items. If already paid and the total increases, select how to collect the difference below.', '追加・数量変更・品切れ単品の取消が可能です。決済済で増額する場合は差額精算方法を選択してください。', '메뉴 추가, 수량 변경 또는 품절 단품 취소가 가능합니다. 이미 결제된 주문이 증액되면 아래에서 차액 결제 방식을 선택하세요.')}
    </div>
    ${availMenus.length > 0 ? `
      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <select id="kdsModifyAddMenuSelect" class="select-input" style="flex:1; padding:6px 8px; font-size:0.8rem;">
          <option value="">＋ ${t('選擇本店品項加點入此單...', 'Select a store menu item to add...', '追加するメニューを選択...', '추가할 매장 메뉴 선택...')}</option>
          ${availMenus.map(m => `<option data-dish-name="1" value="${escapeHtml(m.id)}">${escapeHtml(trDishName(m))} (NT$${m.price})</option>`).join('')}
        </select>
        <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.78rem;" onclick="addDishToModifyDraft(document.getElementById('kdsModifyAddMenuSelect')?.value)">＋ ${t('加入', 'Add', '追加', '추가')}</button>
      </div>
    ` : ''}
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px; max-height:220px; overflow-y:auto;">
      ${draft.map((it, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; background:#F8FAFC; border:1px solid var(--border); padding:10px 12px; border-radius:10px;">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:900; font-size:0.88rem;"><span data-dish-name="1">${escapeHtml(trDishName(it))}</span> ${it.isGift ? `(${t('贈品', 'Gift', '特典', '사은품')})` : ''}${it.isAddOn ? ` <span style="color:#4F46E5; font-size:0.72rem;">[${t('加點', 'Add-on', '追加', '추가')}]</span>` : ''}</div>
            <div style="font-size:0.76rem; color:var(--text-secondary);">${t('單價', 'Unit', '単価', '단가')} NT$${it.price} ・ ${t('小計', 'Subtotal', '小計', '소계')} NT$${(Number(it.price) || 0) * (Number(it.qty) || 1)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" onclick="modifyOrderDraftQty(${idx}, -1)" style="border:1px solid var(--border); background:#FFFFFF; width:30px; height:30px; border-radius:8px; font-weight:900;">－</button>
            <span style="font-weight:950; min-width:22px; text-align:center;">${it.qty || 1}</span>
            <button type="button" onclick="modifyOrderDraftQty(${idx}, 1)" style="border:1px solid var(--border); background:#FFFFFF; width:30px; height:30px; border-radius:8px; font-weight:900;">＋</button>
            <button type="button" class="btn-danger-soft" style="padding:5px 8px; font-size:0.74rem;" onclick="modifyOrderDraftQty(${idx}, -999)">${t('作廢', 'Void', '取消', '취소')}</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div style="background:#F1F5F9; padding:10px 12px; border-radius:10px; margin-bottom:12px; font-size:0.84rem;">
      <div style="display:flex; justify-content:space-between;"><span>${t('原訂單總額', 'Original Total', '元の合計', '기존 합계')} (${escapeHtml(trTerm(order.paymentStatus || ''))})</span><strong>NT$ ${order.finalTotal}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:1rem;"><span>${t('修改後總額', 'Updated Total', '変更後合計', '수정 후 합계')}</span><strong style="color:var(--red);">NT$ ${newTotal} (${diffAmt === 0 ? t('無差額', 'No change', '差額なし', '차액 없음') : diffAmt < 0 ? `${t('退差額', 'Refund', '返金', '환불')} -$${Math.abs(diffAmt)}` : `${t('補差額', 'Collect', '追加請求', '추가 결제')} +$${diffAmt}`})</strong></div>
    </div>
    ${wasPaid && diffAmt > 0 ? `
      <div style="background:#ECFDF5; border:1.5px solid #10B981; border-radius:10px; padding:10px 12px; margin-bottom:12px;">
        <label class="field-label" style="color:#065F46; margin-bottom:6px;">💰 ${t(`此單已付款，向上加價須補收差額 NT$ ${diffAmt} — 請選擇補款方式：`, `Paid order increased by NT$ ${diffAmt} — select payment method:`, `決済済注文の差額 NT$ ${diffAmt} の精算方法：`, `결제 완료 주문 차액 NT$ ${diffAmt} 결제 방식 선택:`)}</label>
        <select id="kdsModifyExtraChargeMethod" class="select-input" style="font-weight:800;">
          <option value="現場現金">💵 ${t(`現場現金補收差額 (+NT$${diffAmt} 入錢箱)`, `Collect Cash (+NT$${diffAmt} to drawer)`, `現金で差額精算 (+NT$${diffAmt})`, `현금 차액 수령 (+NT$${diffAmt})`)}</option>
          <option value="LINE Pay">💚 ${t(`LINE Pay 補收差額 (+NT$${diffAmt})`, `Collect LINE Pay (+NT$${diffAmt})`, `LINE Payで差額精算 (+NT$${diffAmt})`, `LINE Pay 차액 결제 (+NT$${diffAmt})`)}</option>
        </select>
      </div>
    ` : ''}
    <div style="margin-bottom:12px;">
      <label class="field-label">📝 ${t('改單 / 加點 / 單品作廢原因（將寫入稽核紀錄）', 'Modification Reason (Recorded in Audit Log)', '修正・取消理由（監査ログ記録）', '수정 / 취소 사유 (감사 로그 기록)')}</label>
      <input type="text" id="kdsModifyReasonInput" class="select-input" value="${escapeHtml(diffAmt > 0 ? t('顧客加點補差額', 'Customer add-on', '追加注文', '고객 메뉴 추가') : t('單品缺貨作廢 / 顧客改單', 'Item out of stock / order edit', '品切れ・注文変更', '품절 취소 / 주문 변경'))}" placeholder="${t('如：顧客加點、單品售罄作廢', 'e.g. Add-on or item sold out', '例：追加注文・品切れ取消', '예: 추가 주문, 품절 취소')}">
    </div>
    <div style="display:flex; gap:8px;">
      <button type="button" class="btn-outline" style="flex:1;" onclick="closeKdsModifyOrderModal()">${t('取消', 'Cancel', 'キャンセル', '취소')}</button>
      <button type="button" class="btn-tip-action" style="flex:2;" onclick="commitKdsModifyOrder()">💾 ${t('確認改單', 'Save Modification', '修正を確定', '수정 확정')}${wasPaid && diffAmt > 0 ? ` (+$${diffAmt})` : ''}</button>
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

  // 二-2：防收銀員透過「改單減項／降價」繞過退單授權！任何減項或總價調降皆強制驗證店長 PIN 覆核
  const origQtyByKey = {};
  (prevSnapshot.structuredItems || []).forEach(it => {
    if (!it || it.isGift) return;
    const k = String(it.id || it.baseName || it.name || '').trim();
    origQtyByKey[k] = (origQtyByKey[k] || 0) + (Number(it.qty) || 1);
  });
  const newQtyByKey = {};
  draft.forEach(it => {
    if (!it || it.isGift) return;
    const k = String(it.id || it.baseName || it.name || '').trim();
    newQtyByKey[k] = (newQtyByKey[k] || 0) + (Number(it.qty) || 1);
  });
  const hasReducedOrRemovedItem = Object.keys(origQtyByKey).some(k => (newQtyByKey[k] || 0) < origQtyByKey[k]);
  let mgrOverridePin = '';
  if ((diffAmt < 0 || hasReducedOrRemovedItem) && !isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride(t(`改單減項 / 金額調降 (#${order.pickupNumber})`, `Order Item Void / Reduction (#${order.pickupNumber})`), order.storeId);
    if (!mgrAuth) return;
    mgrOverridePin = mgrAuth.managerOverridePin;
  }

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
      managerOverridePin: mgrOverridePin,
      reason
    },
    `✏️ ${t(`訂單 #${order.pickupNumber} 已完成改單！最新金額 NT$${newTotal}`, `Order #${order.pickupNumber} updated! New total: NT$${newTotal}`)}`
  );
}

function renderMerchantOrdersOnly(storeObj, onlyUpdateGrid = false) {
  const store = storeObj || state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  const panel = document.getElementById('storePanel-kds');
  if (!store || !panel) return;

  const storeOrders = state.orders.filter(o => o.storeId === store.id);
  if (typeof checkAndAutoPrint === 'function') {
    checkAndAutoPrint(storeOrders.filter(o => o.status !== '已完成' && !String(o.status).includes('已取消')));
  }
  const todayStr = getTodayDateStr();
  const tomorrowStr = getFutureDateStr(1);

  const activeCookingOrders = storeOrders.filter(o => o.status === '製作中');
  const stationFilter = state.kdsStationFilter || 'ALL';
  const batchItemMap = {};
  let totalActivePortions = 0;

  activeCookingOrders.forEach(o => {
    const dineShort = (o.dineType && o.dineType.includes('內用'))
      ? t('內用', 'Dine-in', '店内', '매장')
      : t('外帶', 'Takeout', '持帰', '포장');
    // 二-1：使用套餐拆站引擎，讓套餐附餐飲料同時彙整進 DRINK 分站備料看板
    const expandedItems = expandOrderItemsForStations(Array.isArray(o.structuredItems) ? o.structuredItems : [], store);
    expandedItems.forEach(it => {
      if (stationFilter === 'ALL' && it.isVirtualSubItem) return;
      if (stationFilter !== 'ALL' && it.__station !== stationFilter) return;
      const bName = it.baseName || String(it.name || '餐點').split(' [')[0];
      const q = Math.max(1, Number(it.qty) || 1);
      if (!batchItemMap[bName]) {
        batchItemMap[bName] = { name: bName, qty: 0, isGift: Boolean(it.isGift), specsMap: {} };
      }
      batchItemMap[bName].qty += q;
      totalActivePortions += q;

      const selValues = (it.selections && Object.keys(it.selections).length > 0)
        ? Object.values(it.selections).map(v => trTerm(v)).join('/')
        : t('標準原味', 'Standard', '標準', '기본');
      const specKey = `${dineShort} · ${selValues}`;
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

  // 二-1：廚房分站過濾支援套餐子項目（含套餐附餐飲料自動路由至 DRINK 站）
  if (stationFilter !== 'ALL') {
    filtered = filtered.filter(o => {
      const expanded = expandOrderItemsForStations(Array.isArray(o.structuredItems) ? o.structuredItems : [], store);
      return expanded.some(it => it.__station === stationFilter);
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
      <div style="font-size:1rem; font-weight:800;">${t('此日期 / 分站 / 篩選條件下目前沒有訂單', 'No orders matching this date / station / filter', 'この条件に一致する注文はありません', '해당 조건에 맞는 주문이 없습니다')}</div>
    </div>
  ` : filtered.map(o => {
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    const expandedItems = expandOrderItemsForStations(items, store);
    const visibleItems = stationFilter === 'ALL'
      ? expandedItems.filter(it => !it.isVirtualSubItem)
      : expandedItems.filter(it => it.__station === stationFilter);
    const checkedMap = (o.itemCheckedMap && typeof o.itemCheckedMap === 'object') ? o.itemCheckedMap : {};
    const checkedCount = visibleItems.reduce((cnt, it, iIdx) => cnt + (checkedMap[it.__itemKey || `item_${iIdx}`] ? 1 : 0), 0);
    const allItemsChecked = visibleItems.length > 0 && checkedCount >= visibleItems.length;
    const itemStr = visibleItems.map(i => {
      const sel = i.selections && Object.keys(i.selections).length > 0
        ? ` [${Object.entries(i.selections).map(([k, v]) => `${trTerm(k)}:${trTerm(v)}`).join(', ')}]`
        : '';
      const noteTag = i.itemNote ? ` (📝${i.itemNote})` : '';
      return `${trDishName(i)}${sel}${noteTag} ×${i.qty || 1}`;
    }).join('、');

    const kdsCheckableItemsHtml = visibleItems.map((i, iIdx) => {
      const itemKey = i.__itemKey || `item_${iIdx}`;
      const isChecked = Boolean(checkedMap[itemKey]);
      const sel = i.selections && Object.keys(i.selections).length > 0
        ? ` <span style="color:#475569; font-weight:700; font-size:0.78rem;">[${escapeHtml(Object.entries(i.selections).map(([k, v]) => `${trTerm(k)}:${trTerm(v)}`).join(', '))}]</span>`
        : '';
      const noteTag = i.itemNote ? ` <span style="color:#4338CA; font-size:0.76rem;">(📝${escapeHtml(i.itemNote)})</span>` : '';
      const addOnBadge = i.isAddOn ? `<span style="background:#EEF2FF; color:#4338CA; font-size:0.68rem; font-weight:900; padding:1px 5px; border-radius:4px; margin-left:4px;">➕ ${t('加點', 'Add-on')}</span>` : '';
      const comboSubBadge = i.isVirtualSubItem ? `<span style="background:#DBEAFE; color:#1D4ED8; font-size:0.66rem; font-weight:900; padding:1px 5px; border-radius:4px; margin-left:4px;">🥤 ${t('套餐附餐', 'Combo Sub')}</span>` : '';
      return `
        <div class="kds-check-item-row ${isChecked ? 'checked' : ''}" onclick="toggleKdsOrderItemChecked(${escapeJsAttr(o.orderId)}, ${escapeJsAttr(itemKey)})">
          <span class="kds-check-box">${isChecked ? '✅' : '⬜'}</span>
          <span style="flex:1;"><strong data-dish-name="1">${escapeHtml(trDishName(i))}</strong> ×${i.qty || 1}${addOnBadge}${comboSubBadge}${sel}${noteTag}</span>
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
    const verBadgeText = isServerVerified ? `🛡️ ${o.verificationCode}` : `⚠️ ${t('離線待同步', 'Offline')}`;
    const isMoreOpen = state.kdsExpandedMoreOrderId === o.orderId;
    const isPosSource = String(o.studentId || '').includes('POS') || String(o.studentId || '').includes('櫃檯');

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
                  🔥 ${t('預訂轉入', 'Auto-Fired')} · ${escapeHtml(normalizeTimeStr(o.pickupTime))}
                </span>
              ` : ''}
              ${o.originalOfflinePickupNumber ? `
                <span style="font-size:0.72rem; font-weight:900; background:#FEF3C7; color:#B45309; border:1px solid #F59E0B; padding:2px 6px; border-radius:6px; margin-left:4px;">
                  ${t('原離線號', 'Orig')} #${escapeHtml(o.originalOfflinePickupNumber)}
                </span>
              ` : ''}
              <span style="font-size:0.72rem; font-weight:900; background:${isPosSource ? '#F1F5F9' : '#EFF6FF'}; color:${isPosSource ? '#0F172A' : '#1D4ED8'}; padding:2px 7px; border-radius:6px; margin-left:4px;">
                ${isPosSource ? `🖥️ ${t('現場單', 'Counter', '店頭', '매장')}` : (o.isReservation ? `📅 ${t('線上預訂', 'Pre-order', '予約', '예약')}` : `📱 ${t('線上單', 'Online', 'オンライン', '온라인')}`)}
              </span>
              <span style="font-family:monospace; font-size:0.74rem; font-weight:900; background:${isServerVerified ? '#EEF2FF' : '#FEF3C7'}; color:${isServerVerified ? '#312E81' : '#92400E'}; padding:2px 7px; border-radius:6px; margin-left:4px;">
                ${escapeHtml(verBadgeText)}
              </span>
              <span style="font-size:0.74rem; font-weight:800; background:#F1F5F9; color:#334155; padding:2px 7px; border-radius:6px; margin-left:4px;">
                📅 ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}
              </span>
              ${isInLiveQueue ? `
                <span class="kds-elapsed-badge ${elapsedMin >= 15 ? 'overdue' : ''}" style="margin-left:4px;">
                  ⏱️ ${elapsedMin > 45 ? t(`逾時 ${elapsedMin}分`, `Overdue ${elapsedMin}m`) : t(`已下鍋 ${elapsedMin}分 (負荷 ${workloadUnits})`, `Cooking ${elapsedMin}m (Load ${workloadUnits})`)}
                </span>
              ` : ''}
            </div>
            <span style="font-size:0.74rem; font-weight:900; padding:3px 9px; border-radius:999px; background:${isCancelled ? '#FEE2E2' : isDone ? '#E2E8F0' : isReady ? '#DCFCE7' : isScheduled ? '#DBEAFE' : '#FEF3C7'}; color:${isCancelled ? '#DC2626' : isDone ? '#475569' : isReady ? '#047857' : isScheduled ? '#1E40AF' : '#B45309'};">
              ${escapeHtml(trTerm(o.status))}${notifyCount > 0 && !isDone && !isCancelled ? ` (${t(`叫號${notifyCount}次`, `#${notifyCount}`)})` : ''}
            </span>
          </div>

          <div style="font-size:0.9rem; font-weight:800; color:var(--text-primary); line-height:1.45; margin-bottom:6px; background:#F8FAFC; padding:8px 10px; border-radius:8px; border:1px solid #E2E8F0;">
            ${!isDone && !isCancelled ? `
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; color:${allItemsChecked ? '#059669' : '#64748B'}; font-weight:900; margin-bottom:5px;">
                <span>☑️ ${t('點擊單品逐項劃單出餐', 'Tap items to check off', '品目タップで調理済チェック', '메뉴를 탭하여 조리 체크')}</span>
                <span>${t(`已備齊 ${checkedCount}/${visibleItems.length} 項`, `Ready ${checkedCount}/${visibleItems.length}`, `準備済 ${checkedCount}/${visibleItems.length}`, `준비됨 ${checkedCount}/${visibleItems.length}`)}</span>
              </div>
              ${kdsCheckableItemsHtml}
              ${allItemsChecked && o.status === '製作中' ? `
                <div class="kds-all-ready-banner">
                  <span style="font-size:0.8rem; font-weight:950; color:#166534;">✨ ${t('全部品項已備齊！', 'All items ready!', '全品準備完了！', '모든 메뉴 준비 완료!')}</span>
                  <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="markOrderReady(${escapeJsAttr(o.orderId)})" style="border:none; background:#16A34A; color:#FFFFFF; padding:6px 12px; border-radius:8px; font-size:0.8rem; font-weight:950; cursor:pointer;">
                    🔔 ${t('立即叫號取餐', 'Call Pickup Now', '今すぐ呼出', '즉시 호출')}
                  </button>
                </div>
              ` : ''}
            ` : `<span data-dish-name="1">${escapeHtml(itemStr)}</span>`}
            ${stationFilter !== 'ALL' && visibleItems.length < items.length ? `<div style="font-size:0.7rem; color:var(--text-muted); margin-top:3px;">(${t(`僅顯示本分站品項 · 全單共 ${items.length} 項`, `Station view only · ${items.length} total`)})</div>` : ''}
          </div>

          ${o.merchantMessage ? `
            <div style="font-size:0.75rem; font-weight:800; color:#1E40AF; background:#EFF6FF; border:1px solid #BFDBFE; padding:5px 8px; border-radius:6px; margin-bottom:6px;">
              💬 ${t('已傳送櫃檯留言', 'Sent Message')}：「${escapeHtml(o.merchantMessage)}」
            </div>
          ` : ''}

          <div style="font-size:0.76rem; color:var(--text-secondary); margin-bottom:6px; display:flex; flex-wrap:wrap; gap:6px;">
            <span style="font-weight:800; color:var(--text-primary);">🍽️ ${escapeHtml(trTerm(o.dineType || '外帶自取'))}</span>
            ${o.needCutlery ? `<span style="color:var(--brand-dark); font-weight:800;">· 🥢 ${t('需餐具', 'Cutlery')}(+$${o.cutleryFee})</span>` : ''}
            ${o.taxId ? `<span style="color:#0F172A; font-weight:900;">· 🏢 ${t('統編', 'Tax ID')}：${escapeHtml(o.taxId)}</span>` : ''}
            ${o.customerNote ? `<span style="color:var(--indigo); font-weight:800;">· 📝 ${t('備註', 'Note')}：${escapeHtml(o.customerNote)}</span>` : ''}
            ${o.customerPhone ? `<span>· <strong style="color:var(--brand-dark);">📱 ${escapeHtml(o.customerPhone)}</strong></span>` : ''}
            ${o.cashReceived > 0 && !o.paymentSplit ? `<span>· 💵 ${t('實收', 'Paid')}$${o.cashReceived}/${t('找零', 'Chg')}$${o.changeGiven}</span>` : ''}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; padding-top:6px; border-top:1px dashed var(--border);">
            <div>
              <span style="font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:6px; background:${isCancelled ? '#FEE2E2' : isUnpaid ? '#FEF3C7' : '#DCFCE7'}; color:${isCancelled ? '#DC2626' : isUnpaid ? '#B45309' : '#047857'};">
                ${isCancelled ? `🚫 ${escapeHtml(trTerm(o.paymentStatus || '已退單作廢'))}` : isUnpaid ? `⏳ ${escapeHtml(trTerm(o.paymentStatus || '待付款確認'))}` : `✅ ${escapeHtml(trTerm(o.paymentStatus))} (${escapeHtml(trTerm(o.paymentMethod))})`}
              </span>
            </div>
            <span style="font-size:1.05rem; font-weight:950; color:var(--red); ${isCancelled ? 'text-decoration:line-through;' : ''}">NT$ ${o.finalTotal}</span>
          </div>
        </div>

        <!-- 二-4：防誤觸極簡主按鈕列（每卡僅顯示 1~2 顆大按鈕，次要與危險操作收折至「⋯」抽屜！） -->
        <div class="kds-primary-actions">
          ${isUnpaid ? `
            <button type="button" class="kds-primary-btn" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="openOrderPayModal(${escapeJsAttr(o.orderId)}, false)" style="background:#F59E0B; color:#FFFFFF;">
              💵 ${t('收款結帳', 'Collect', '会計', '수금')} (NT$ ${o.finalTotal})
            </button>
          ` : isScheduled ? `
            <button type="button" class="kds-primary-btn" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="forceStartCookingScheduledOrder(${escapeJsAttr(o.orderId)})" style="background:#2563EB; color:#FFFFFF;">
              🔥 ${t('提前下鍋製作', 'Fire to Kitchen', '今すぐ調理開始', '즉시 조리 투입')}
            </button>
          ` : !isDone && !isCancelled ? `
            <button type="button" class="kds-primary-btn" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="markOrderReady(${escapeJsAttr(o.orderId)})" style="background:#3B82F6; color:#FFFFFF;">
              ${state.mutatingOrderIds[o.orderId] ? '⏳...' : `🔔 ${notifyCount > 0 ? t(`再次叫號 (${notifyCount})`, `Call Again (${notifyCount})`, `再呼出 (${notifyCount})`, `재호출 (${notifyCount})`) : t('通知取餐', 'Call Pickup', '受取呼出', '픽업 호출')}`}
            </button>
            <button type="button" class="kds-primary-btn" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="completeOrderFinal(${escapeJsAttr(o.orderId)})" style="background:#10B981; color:#FFFFFF;">
              ${state.mutatingOrderIds[o.orderId] ? '⏳...' : `✅ ${t('完成結單', 'Complete', '完了', '완료')}`}
            </button>
          ` : isDone ? `
            <button type="button" class="kds-primary-btn" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="recallMerchantOrderStatus(${escapeJsAttr(o.orderId)}, '可取餐')" style="background:#FFFBEB; color:#B45309; border:1.5px solid #F59E0B;">
              ↩️ ${t('復原為待取餐', 'Recall to Ready', '受取待へ戻す', '픽업 대기로 복원')}
            </button>
          ` : `
            <button type="button" class="kds-primary-btn" onclick="openReceiptPrintModal(${escapeJsAttr(o.orderId)})" style="background:#F1F5F9; color:#334155;">
              🖨️ ${t('檢視小票紀錄', 'View Receipt', 'レシート表示', '영수증 보기')}
            </button>
          `}

          <button type="button" class="kds-more-toggle-btn" title="${t('更多操作（小票、改單、留言、退單）', 'More actions')}" onclick="toggleKdsCardMoreMenu(${escapeJsAttr(o.orderId)})">
            ${isMoreOpen ? '✕' : '⋯'}
          </button>
        </div>

        ${isMoreOpen ? `
          <div class="kds-more-drawer">
            <button type="button" onclick="openReceiptPrintModal(${escapeJsAttr(o.orderId)})" style="border:1px solid var(--border); background:#FFFFFF; color:var(--text-primary); padding:6px 10px; border-radius:8px; font-weight:800; font-size:0.76rem;">
              🧾 ${t('小票預覽', 'Receipt', 'レシート', '영수증')}
            </button>
            ${!isCancelled ? `
              <button type="button" onclick="requeueOrderPrintJob(${escapeJsAttr(o.orderId)})" style="border:1px solid #0EA5E9; background:#F0F9FF; color:#0369A1; padding:6px 10px; border-radius:8px; font-weight:800; font-size:0.76rem;">
                🖨️ ${t('補送出單機重印', 'Reprint Ticket', '再印刷送信', '프린터 재출력')}
              </button>
            ` : ''}
            ${!isCancelled && !isUnpaid ? `
              <button type="button" onclick="openChangeOrderPaymentMethodModal(${escapeJsAttr(o.orderId)})" style="border:1px solid #10B981; background:#ECFDF5; color:#065F46; padding:6px 10px; border-radius:8px; font-weight:800; font-size:0.76rem;">
                🔄 ${t('變更付款(現金⇄LP)', 'Change Pay Method', '支払方法変更', '결제수단 변경')}
              </button>
            ` : ''}
            ${!isDone && !isCancelled ? `
              <button type="button" onclick="openKdsModifyOrderModal(${escapeJsAttr(o.orderId)})" style="border:1px solid #F59E0B; background:#FFFBEB; color:#B45309; padding:6px 10px; border-radius:8px; font-weight:800; font-size:0.76rem;">
                ✏️ ${t('改單/作廢單品', 'Modify Order', '注文変更', '주문 수정')}
              </button>
              <button type="button" onclick="promptSendMerchantOrderMessage(${escapeJsAttr(o.orderId)})" style="border:1px solid #93C5FD; background:#EFF6FF; color:#1D4ED8; padding:6px 10px; border-radius:8px; font-weight:800; font-size:0.76rem;">
                💬 ${t('傳送留言', 'Message', 'メッセージ', '메시지')}
              </button>
              <button type="button" onclick="speakOrder(${escapeJsAttr(o.pickupNumber + '號，' + itemStr)})" style="border:1px solid var(--border); background:#FFFFFF; color:var(--text-primary); padding:6px 10px; border-radius:8px; font-weight:800; font-size:0.76rem;">
                🔊 ${t('語音讀單', 'Read Out', '読上', '읽어주기')}
              </button>
              ${isUnpaid ? `
                <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="markOrderReady(${escapeJsAttr(o.orderId)})" style="border:1px solid #3B82F6; background:#EFF6FF; color:#1D4ED8; padding:6px 10px; border-radius:8px; font-weight:800; font-size:0.76rem;">
                  🔔 ${t('通知取餐', 'Call Pickup', '受取呼出', '픽업 호출')}
                </button>
              ` : ''}
              ${isReady ? `
                <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} onclick="recallMerchantOrderStatus(${escapeJsAttr(o.orderId)}, '製作中')" style="border:1px solid #94A3B8; background:#FFFFFF; color:#334155; padding:6px 10px; border-radius:8px; font-weight:800; font-size:0.76rem;">
                  ↩️ ${t('退回製作中', 'Back to Prep', '調理中へ戻す', '조리 중으로 복원')}
                </button>
              ` : ''}
              <button type="button" ${state.mutatingOrderIds[o.orderId] ? 'disabled' : ''} class="btn-danger-soft" style="padding:6px 10px; font-size:0.76rem; margin-left:auto;" onclick="cancelMerchantOrder(${escapeJsAttr(o.orderId)})">
                🚫 ${t('整單退單', 'Void Order', '注文取消', '주문 취소')}
              </button>
            ` : ''}
          </div>
        ` : ''}
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
            <span>${t(`新單提醒中：目前有 ${unackCountForStore} 筆新進訂單尚未確認`, `New Orders Alert: ${unackCountForStore} unacknowledged orders`, `新規注文通知中：未確認 ${unackCountForStore}件`, `신규 주문 알림: 미확인 주문 ${unackCountForStore}건`)}</span>
          </div>
          <button type="button" onclick="acknowledgeAllNewKdsOrders()" style="border:none; background:#FFFFFF; color:#DC2626; padding:8px 16px; border-radius:999px; font-weight:950; font-size:0.84rem; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.15);">
            👌 ${t('我看到了，停止提醒', 'Acknowledge & Stop Alert', '確認しました', '확인함 (알림 중지)')}
          </button>
        </div>
      ` : ''}

      <div class="kds-batch-summary-bar">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.95rem; font-weight:950; color:#FBBF24;">🔥 ${t('即時廚房爐上備料與規格拆解看板', 'Live Kitchen Batch Prep & Spec Breakdown', 'リアルタイム厨房調理集計ボード', '실시간 주방 조리 합계 보드')}</span>
            <span style="font-size:0.75rem; background:rgba(255,255,255,0.16); padding:2px 10px; border-radius:999px; font-weight:800;">
              ${t(`製作中 ${activeCookingOrders.length} 單 · 合共 ${totalActivePortions} 份餐點`, `Preparing ${activeCookingOrders.length} orders · ${totalActivePortions} items`, `調理中 ${activeCookingOrders.length}件・計 ${totalActivePortions}点`, `조리 중 ${activeCookingOrders.length}건 · 총 ${totalActivePortions}개`)}
            </span>
          </div>
          <span style="font-size:0.74rem; color:#CBD5E1;">${t('彙整總數與飯量/辣度/內外帶拆解，方便師傅批次下鍋', 'Aggregates total counts & spec breakdown for fast batch cooking', '主菜数と詳細オプションを一括表示しバッチ調理を支援', '수량과 옵션을 한눈에 집계하여 빠른 일괄 조리 지원')}</span>
        </div>
        <div class="batch-items-scroll">
          ${sortedBatchItems.length === 0 ? `
            <div style="font-size:0.82rem; color:#94A3B8; padding:4px 0;">${t('目前爐上無製作中單品，廚房順暢待命', 'No active items cooking — kitchen is clear and ready', '現在調理中の品目はありません。キッチン待機中', '현재 조리 중인 메뉴가 없습니다. 주방 대기 중')}</div>
          ` : sortedBatchItems.map(bi => {
            const specEntries = Object.entries(bi.specsMap || {});
            return `
              <div class="batch-item-pill">
                <div class="batch-item-header">
                  <span data-dish-name="1" style="font-weight:900; font-size:0.9rem; color:#FFFFFF;">${escapeHtml(bi.name)}</span>
                  <span class="batch-qty">${t(`共 ×${bi.qty}`, `Total ×${bi.qty}`, `計 ×${bi.qty}`, `총 ×${bi.qty}`)}</span>
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
            <span style="font-size:0.82rem; font-weight:900; color:#312E81;">🛡️ ${t('櫃檯快速核銷取餐：', 'Quick Counter Pickup Verify:', '店頭スピード検収：', '카운터 빠른 픽업 확인:')}</span>
            <span style="font-size:0.75rem; color:#4338CA;">${t('支援鏡頭掃描顧客 QR 憑證，或輸入 6 碼防偽核銷碼', 'Scan customer QR or enter 6-char verification code', '顧客QRスキャンまたは6桁認証コード入力', '고객 QR 스캔 또는 6자리 코드 입력')}</span>
          </div>
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.8rem; background:#0F172A;" onclick="state._qrScannerTargetMode=''; openKdsCameraScannerModal()">📷 ${t('開啟鏡頭掃碼', 'Scan QR Camera', 'カメラQRスキャン', '카메라 QR 스캔')}</button>
            <input type="text" id="kdsQuickVerifyInput" class="select-input" style="width:190px; padding:5px 10px; font-family:monospace; font-weight:900; text-transform:uppercase;" placeholder="${t('輸入6碼防偽碼或取餐號', '6-char code or #', '6桁コードまたは番号', '6자리 코드 또는 번호')}" value="${escapeHtml(state.kdsVerifyCodeInput)}" oninput="state.kdsVerifyCodeInput=this.value" onkeydown="if(event.key==='Enter') quickVerifyAndCompleteByCode(this.value)">
            <button type="button" class="btn-tip-action" style="padding:6px 14px; font-size:0.8rem; background:#4F46E5;" onclick="quickVerifyAndCompleteByCode()">⚡ ${t('核銷取餐', 'Verify & Complete', '検収完了', '픽업 확인')}</button>
            <button type="button" class="btn-tip-action" style="padding:6px 12px; font-size:0.8rem; background:#059669;" onclick="openCustomerPickupBoardModal()">📺 ${t('叫號看板', 'Call Board', '呼出ボード', '호출 전광판')}</button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span style="font-size:0.84rem; font-weight:900; color:var(--text-primary);">📅 ${t('取餐日期：', 'Pickup Date:', '受取日：', '픽업 날짜:')}</span>
            <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === todayStr ? 'active' : ''}" onclick="setKdsDateFilter(${escapeJsAttr(todayStr)})">
              ${t('今日', 'Today', '本日', '오늘')} (${todayStr.slice(5)}) [${dateCountMap[todayStr] || 0}]
            </button>
            <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === tomorrowStr ? 'active' : ''}" onclick="setKdsDateFilter(${escapeJsAttr(tomorrowStr)})">
              ${t('明日', 'Tomorrow', '明日', '내일')} (${tomorrowStr.slice(5)}) [${dateCountMap[tomorrowStr] || 0}]
            </button>
            ${extraDates.map(d => `
              <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === d ? 'active' : ''}" onclick="setKdsDateFilter(${escapeJsAttr(d)})">
                📅 ${escapeHtml(d.slice(5))} [${dateCountMap[d] || 0}]
              </button>
            `).join('')}
            <button type="button" class="pos-cat-pill ${state.kdsSelectedDate === 'ALL' ? 'active' : ''}" onclick="setKdsDateFilter('ALL')">
              🗂️ ${t('全部日期', 'All Dates', 'すべての日付', '전체 날짜')} [${storeOrders.length}]
            </button>
            <input type="date" class="select-input" style="width:auto; padding:4px 8px; font-size:0.78rem;" value="${state.kdsSelectedDate === 'ALL' ? todayStr : escapeHtml(state.kdsSelectedDate)}" onchange="setKdsDateFilter(this.value)">
          </div>

          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" class="filter-chip ${state.kdsSoundEnabled ? 'active' : ''}" style="padding:5px 10px; font-size:0.76rem;" onclick="toggleKdsSound()">
              ${state.kdsSoundEnabled ? `🔊 ${t('新單語音播報：開', 'New Order Voice: ON', '新規音声：ON', '신규 음성: 켜짐')}` : `🔇 ${t('新單語音播報：關', 'New Order Voice: OFF', '新規音声：OFF', '신규 음성: 꺼짐')}`}
            </button>
            <input type="search" id="kdsSearchInputBox" class="select-input" style="width:210px; padding:6px 10px; font-size:0.8rem;" placeholder="🔍 ${t('搜尋電話、核銷碼或單號...', 'Search phone, code, or #...', '電話・認証コード・番号で検索...', '전화, 코드, 번호 검색...')}" value="${escapeHtml(state.kdsSearchQuery)}" oninput="handleKdsSearchInput(this.value)">
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'ALL' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('ALL')">${t('全部狀態', 'All Status', '全ステータス', '전체 상태')} (${countAll})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'COOKING' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('COOKING')">🍳 ${t('製作中', 'Preparing', '調理中', '조리 중')} (${countCooking})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'SCHEDULED' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('SCHEDULED')">📅 ${t('預訂待發送', 'Scheduled', '予約待機', '예약 대기')} (${countScheduled})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'UNPAID' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('UNPAID')">💵 ${t('待收款確認', 'Unpaid', '未会計', '미결제')} (${countUnpaid})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'READY' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('READY')">🔔 ${t('已通知待取餐', 'Ready for Pickup', '呼出済・受取待', '호출됨・픽업 대기')} (${countReady})</button>
            <button type="button" class="filter-chip ${state.kdsStatusFilter === 'DONE' ? 'active' : ''}" style="padding:5px 12px; font-size:0.78rem;" onclick="setKdsStatusFilter('DONE')">✅ ${t('已完成/已退單', 'Completed / Void', '完了・取消', '완료 / 취소')} (${countDone})</button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding-top:6px; border-top:1px dashed var(--border);">
          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <span style="font-size:0.76rem; font-weight:900; color:var(--text-secondary);">🔪 ${t('廚房分站過濾：', 'Kitchen Station:', 'キッチン担当：', '주방 파트:')}</span>
            <button type="button" class="pos-cat-pill ${stationFilter === 'ALL' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsStationFilter('ALL')">${t('全部站點', 'All Stations', '全ステーション', '전체 파트')}</button>
            <button type="button" class="pos-cat-pill ${stationFilter === 'MAIN' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsStationFilter('MAIN')">🍳 ${t('主食飯麵', 'Mains', '主食', '메인')}</button>
            <button type="button" class="pos-cat-pill ${stationFilter === 'SIDE' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsStationFilter('SIDE')">🍗 ${t('炸物小菜', 'Sides', 'サイド', '사이드')}</button>
            <button type="button" class="pos-cat-pill ${stationFilter === 'DRINK' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsStationFilter('DRINK')">🥤 ${t('湯品飲品', 'Drinks', 'ドリンク', '음료')}</button>
          </div>
          <div style="display:flex; gap:5px; align-items:center;">
            <span style="font-size:0.76rem; font-weight:900; color:var(--text-secondary);">⇅ ${t('排序：', 'Sort:', '並び順：', '정렬:')}</span>
            <button type="button" class="pos-cat-pill ${state.kdsSortMode === 'FIFO' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsSortMode('FIFO')">⚡ ${t('最緊急優先 (FIFO)', 'Most Urgent (FIFO)', '緊急度順 (FIFO)', '긴급 우선 (FIFO)')}</button>
            <button type="button" class="pos-cat-pill ${state.kdsSortMode === 'NEWEST' ? 'active' : ''}" style="padding:4px 10px; font-size:0.75rem;" onclick="setKdsSortMode('NEWEST')">🕒 ${t('最新下單優先', 'Newest First', '新着順', '최신 주문순')}</button>
          </div>
        </div>
      </div>

      <div id="kdsOrdersGridBox" class="kds-orders-grid">
        ${kdsOrdersCardsHtml}
      </div>
    </div>
  `;
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

function openReceiptPrintModal(orderId, forcedMode) {
  ensureSharedModalsMounted();
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  state.printingOrderId = orderId;
  if (forcedMode) state.receiptPrintMode = forcedMode;
  const mode = state.receiptPrintMode || 'CUSTOMER';

  const titleEl = document.getElementById('receiptPrintModalTitle');
  if (titleEl) {
    titleEl.innerText = mode === 'KITCHEN'
      ? `🍳 ${t('廚房大字工單聯', 'Kitchen Work Ticket', 'キッチン調理伝票', '주방 조리표')}`
      : (mode === 'STICKER'
        ? `🏷️ ${t('餐盒 / 飲料杯貼紙聯', 'Meal / Drink Stickers', '商品・ドリンクラベル', '음식 / 음료 라벨')}`
        : `🧾 ${t('顧客收據與追蹤 QR 憑證聯 (80mm)', 'Customer Receipt & QR Ticket (80mm)', 'お客様レシート・QR伝票 (80mm)', '고객 영수증 및 QR 티켓 (80mm)')}`);
  }

  const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
  const verDisplay = formatVerificationCodeDisplay(o);
  const isServerVerified = isOrderServerVerified(o);
  const receiptTrackUrl = `${window.location.origin}${getOrderPageUrl('id=' + encodeURIComponent(o.orderId) + (isServerVerified ? '&v=' + encodeURIComponent(verDisplay) : ''))}`;
  const receiptQrSvg = generateDeterministicQrSvg(receiptTrackUrl, 148);

  // #32 & 二-2：收據聯 / 廚房大字工單聯 / 餐盒貼紙聯 三模式切換 + ESC/POS 硬體靜默直印快捷鍵
  const modeTabsHtml = `
    <div class="no-print" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:8px;">
      <button type="button" class="pos-chip-btn ${mode === 'CUSTOMER' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('CUSTOMER')">🧾 ${t('顧客收據聯', 'Receipt', 'レシート', '영수증')}</button>
      <button type="button" class="pos-chip-btn ${mode === 'KITCHEN' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('KITCHEN')">🍳 ${t('廚房大字工單', 'Kitchen', 'キッチン', '주방표')}</button>
      <button type="button" class="pos-chip-btn ${mode === 'STICKER' ? 'active' : ''}" style="padding:7px 4px; font-size:0.76rem;" onclick="setReceiptPrintMode('STICKER')">🏷️ ${t('餐盒貼紙聯', 'Stickers', 'ラベル', '라벨')}</button>
    </div>
    ${MerchantHardwarePrinter.isConnected('COUNTER') || MerchantHardwarePrinter.isConnected('KITCHEN') ? `
      <div class="no-print" style="margin-bottom:10px;">
        <button type="button" class="btn-tip-action" style="width:100%; background:#059669; padding:8px; font-size:0.82rem;" onclick="MerchantHardwarePrinter.printOrderByStationRoutes(state.orders.find(x=>x.orderId===${escapeJsAttr(o.orderId)}), false).then(ok=>showToast(ok ? t('✅ ESC/POS 靜默直印已送出！', '✅ Sent to thermal printer!') : t('⚠️ 印表機未回應', '⚠️ Printer did not respond')))">
          ⚡ ${t('ESC/POS 熱感機直接靜默出單（免經瀏覽器列印視窗）', 'Silent Direct Print via ESC/POS Thermal Printer', 'ESC/POS サーマル直接印刷', 'ESC/POS 영수증 프린터 즉시 출력')}
        </button>
      </div>
    ` : ''}
  `;

  let paperHtml = '';
  if (mode === 'KITCHEN') {
    paperHtml = `
      <div class="thermal-receipt-paper" style="font-family:sans-serif;">
        <div style="text-align:center; border-bottom:3px solid #000; padding-bottom:8px; margin-bottom:10px;">
          <div style="font-size:0.9rem; font-weight:950; background:#000; color:#fff; padding:3px 10px; display:inline-block; border-radius:4px;">${t('廚房製作工單 (KITCHEN)', 'KITCHEN WORK TICKET', 'キッチン調理伝票', '주방 조리표 (KITCHEN)')}</div>
          <div style="font-size:3.2rem; font-weight:950; line-height:1.05; margin:6px 0;">#${escapeHtml(o.pickupNumber)}</div>
          <div style="font-size:1.2rem; font-weight:950;">[${escapeHtml(trTerm(o.dineType || '外帶自取'))}]${o.isReservation ? ` 📅 ${t('預訂', 'Pre-order', '予約', '예약')} ${escapeHtml(normalizeTimeStr(o.pickupTime))}` : ` ⚡ ${t('立即製作', 'Make Now', '今すぐ調理', '바로 조리')}`}</div>
          <div style="font-size:0.84rem; font-weight:800; margin-top:4px;">${t('餐具', 'Cutlery', 'カトラリー', '수저')}: ${o.needCutlery ? `✅ ${t('需要免洗餐具', 'Needed', '必要', '필요')}` : `❌ ${t('不需餐具', 'None', '不要', '불필요')}`} ・ ${t('出單', 'Printed', '出力', '출력')} ${getTaipeiTimeHHMM()}</div>
        </div>
        ${o.customerNote ? `
          <div style="border:2px solid #000; padding:8px; margin-bottom:10px; font-size:1.1rem; font-weight:950; background:#F8FAFC;">
            ⚠️ ${t('備註', 'Note', '備考', '메모')}: <span data-dish-name="1">${escapeHtml(o.customerNote)}</span>
          </div>
        ` : ''}
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${items.map(it => {
            const selText = it.selections && Object.keys(it.selections).length > 0
              ? Object.entries(it.selections).map(([k, v]) => `${trTerm(k)}: ${trTerm(v)}`).join(' / ')
              : '';
            return `
              <div style="border-bottom:1.5px dashed #000; padding-bottom:8px;">
                <div style="display:flex; justify-content:space-between; align-items:baseline; font-size:1.25rem; font-weight:950;">
                  <span data-dish-name="1">${escapeHtml(trDishName(it))}</span>
                  <span style="font-size:1.45rem;">×${it.qty || 1}</span>
                </div>
                ${selText ? `<div data-dish-name="1" style="font-size:1.02rem; font-weight:900; margin-top:4px; padding-left:6px;">▶ ${escapeHtml(selText)}</div>` : ''}
                ${it.itemNote ? `<div style="font-size:1rem; font-weight:950; margin-top:4px; padding:3px 6px; border:1.5px solid #000; background:#F8FAFC;">📝 ${t('單品備註', 'Item Note', '単品備考', '단품 메모')}: <span data-dish-name="1">${escapeHtml(it.itemNote)}</span></div>` : ''}
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
            ? Object.entries(it.selections).map(([k, v]) => `${trTerm(v)}`).join(' / ')
            : t('標準原味', 'Standard', '標準', '기본');
          return `
            <div class="thermal-receipt-paper" style="padding:10px 12px; border:2px solid #000; border-radius:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid #000; padding-bottom:4px; margin-bottom:6px;">
                <span style="font-size:1.4rem; font-weight:950;">#${escapeHtml(o.pickupNumber)}</span>
                <span style="font-size:0.78rem; font-weight:900;">${escapeHtml(trTerm(o.dineType || '外帶自取'))} (${sIdx + 1}/${totalStickers})</span>
              </div>
              <div data-dish-name="1" style="font-size:1.1rem; font-weight:950; margin-bottom:3px;">${escapeHtml(trDishName(it))}</div>
              <div style="font-size:0.86rem; font-weight:800;">${t('規格', 'Spec', '仕様', '옵션')}: <span data-dish-name="1">${escapeHtml(selText)}</span></div>
              ${it.itemNote ? `<div style="font-size:0.84rem; font-weight:950; margin-top:2px;">📝 ${t('單品', 'Item', '単品', '단품')}: <span data-dish-name="1">${escapeHtml(it.itemNote)}</span></div>` : ''}
              ${o.customerNote ? `<div style="font-size:0.82rem; font-weight:900; margin-top:3px;">${t('備註', 'Note', '備考', '메모')}: <span data-dish-name="1">${escapeHtml(o.customerNote)}</span></div>` : ''}
              <div style="display:flex; justify-content:space-between; font-size:0.72rem; margin-top:6px; border-top:1px dotted #666; padding-top:3px;">
                <span>${escapeHtml(trTerm(o.storeName))}</span>
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
          <div style="font-size:1.1rem; font-weight:950; margin:2px 0;">${escapeHtml(trTerm(o.storeName))}</div>
          <div style="font-size:0.75rem; color:#4B5563;">${escapeHtml(trTerm(o.dineType || '外帶自取'))} ・ ${t('80mm 顧客收據聯', '80mm Customer Receipt', '80mm お客様レシート', '80mm 고객 영수증')}</div>
          <div style="font-size:2.6rem; font-weight:950; line-height:1.1; margin:6px 0; border:2px solid #000000; border-radius:8px; padding:4px 0;">
            #${escapeHtml(o.pickupNumber)}
          </div>
          ${o.originalOfflinePickupNumber ? `
            <div style="font-size:0.76rem; font-weight:900; margin-bottom:3px;">(${t('原離線開單小票號', 'Offline Slip #', 'オフライン番号', '오프라인 번호')}: #${escapeHtml(o.originalOfflinePickupNumber)})</div>
          ` : ''}
          <div style="font-family:monospace; font-size:0.84rem; font-weight:900;">${t('防偽核銷碼', 'Verify Code', '認証コード', '인증코드')}: ${escapeHtml(verDisplay)}</div>
        </div>

        <div style="font-size:0.76rem; line-height:1.5;">
          <div>${t('憑證', 'Order ID', '注文ID', '주문 ID')}: ${escapeHtml(o.orderId)}</div>
          <div>${t('取餐', 'Pickup', '受取', '픽업')}: ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))} (${escapeHtml(trTerm(o.studentId || '自取'))})</div>
          <div>${t('餐具', 'Cutlery', 'カトラリー', '수저')}: ${o.needCutlery ? `${t('需要免洗餐具', 'Disposable Cutlery', '必要', '필요')} (+$${o.cutleryFee})` : `${t('自備環保餐具', 'No Cutlery', '不要', '불필요')} ($0)`}</div>
          ${o.taxId ? `<div><strong>${t('買方統一編號', 'Buyer Tax ID', '法人番号', '사업자 번호')}: ${escapeHtml(o.taxId)}</strong></div>` : ''}
          ${o.customerNote ? `<div><strong>${t('顧客備註', 'Note', '備考', '메모')}: <span data-dish-name="1">${escapeHtml(o.customerNote)}</span></strong></div>` : ''}
          ${o.customerPhone ? `<div>${t('聯絡電話', 'Phone', '電話', '전화')}: ${escapeHtml(o.customerPhone)}</div>` : ''}
          ${o.transactionId ? `<div>${t('支付授權碼', 'Tx ID', '取引ID', '결제 승인번호')}: ${escapeHtml(o.transactionId)}</div>` : ''}
        </div>

        <div class="thermal-divider"></div>

        <div style="font-size:0.82rem;">
          ${items.map(it => {
            const sel = it.selections && Object.keys(it.selections).length > 0
              ? `<div data-dish-name="1" style="font-size:0.72rem; font-weight:700; padding-left:8px;">└ ${escapeHtml(Object.entries(it.selections).map(([k, v]) => `${trTerm(k)}:${trTerm(v)}`).join(', '))}</div>`
              : '';
            return `
              <div style="margin-bottom:6px;">
                <div style="display:flex; justify-content:space-between; font-weight:900;">
                  <span data-dish-name="1" style="flex:1; padding-right:8px;">${escapeHtml(trDishName(it))} x${it.qty || 1}</span>
                  <span>$${it.price * (it.qty || 1)}</span>
                </div>
                ${sel}
                ${it.itemNote ? `<div style="font-size:0.72rem; font-weight:800; padding-left:8px;">└ 📝 <span data-dish-name="1">${escapeHtml(it.itemNote)}</span></div>` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div class="thermal-divider"></div>

        <div style="font-size:0.8rem;">
          <div style="display:flex; justify-content:space-between;">
            <span>${t('餐點小計', 'Subtotal', '小計', '소계')}</span>
            <span>NT$ ${o.subtotal || o.finalTotal}</span>
          </div>
          ${o.cutleryFee > 0 ? `
            <div style="display:flex; justify-content:space-between;">
              <span>${t('一次性免洗餐具', 'Cutlery Fee', 'カトラリー代', '일회용 수저')}</span>
              <span>+NT$ ${o.cutleryFee}</span>
            </div>
          ` : ''}
          ${o.discount > 0 ? `
            <div style="display:flex; justify-content:space-between;">
              <span>${t('離峰分流折抵', 'Promo Discount', '割引', '할인')}</span>
              <span>-NT$ ${o.discount}</span>
            </div>
          ` : ''}
          ${o.manualDiscount > 0 ? `
            <div style="display:flex; justify-content:space-between;">
              <span>${t('櫃檯手動折讓', 'Manual Discount', '手動割引', '수동 할인')}</span>
              <span>-NT$ ${o.manualDiscount}</span>
            </div>
          ` : ''}
          <div style="display:flex; justify-content:space-between; font-size:1.08rem; font-weight:950; margin-top:6px;">
            <span>${t('實收總計', 'Total Paid', '合計', '총 결제액')} (${escapeHtml(trTerm(o.paymentMethod))})</span>
            <span>NT$ ${o.finalTotal}</span>
          </div>
          ${o.cashReceived > 0 && !o.paymentSplit ? `
            <div style="display:flex; justify-content:space-between; font-size:0.76rem; margin-top:2px;">
              <span>${t('現金實收', 'Cash Paid', 'お預かり', '현금 수령')} $${o.cashReceived}</span>
              <span>${t('找零', 'Change', 'お釣り', '거스름돈')} $${o.changeGiven}</span>
            </div>
          ` : ''}
          <div style="text-align:right; font-size:0.75rem; font-weight:800; margin-top:2px;">
            ${t('付款狀態', 'Payment', '決済状況', '결제 상태')}: ${escapeHtml(trTerm(o.paymentStatus || '已付款'))}
          </div>
        </div>

        <div class="thermal-divider"></div>
        <div style="text-align:center; padding:4px 0;">
          <div style="font-size:0.78rem; font-weight:900; margin-bottom:4px;">📱 ${t('手機掃碼即時看叫號進度 & 取餐通知', 'Scan QR for Live Status & Pickup Alert', 'スマホでQR読取・進捗確認', 'QR 스캔으로 실시간 현황 및 알림')}</div>
          <div style="display:inline-flex; justify-content:center; padding:6px; border:1.5px solid #000; border-radius:6px; background:#fff; margin-bottom:4px;">
            ${receiptQrSvg}
          </div>
          <div style="font-size:0.68rem; color:#111827; font-weight:700;">
            ${t('免站櫃檯久候！相機掃描上方 QR 即可在手機追蹤製作進度與綁定 LINE 響鈴通知', 'No waiting at the counter! Scan above to track live prep progress on your phone.', 'カウンター前で待機不要！QRからスマホで調理状況と通知を確認できます。', '카운터 앞 대기 불필요! 위 QR을 스캔해 휴대폰으로 조리 현황을 확인하세요.')}
          </div>
        </div>

        <div class="thermal-divider"></div>
        <div style="text-align:center; font-size:0.72rem; color:#4B5563;">
          ${t('列印時間', 'Printed', '印刷日時', '출력 시간')}: ${getTodayDateStr()} ${getTaipeiTimeHHMMSS()}<br>
          ${t('謝謝光臨，請憑號碼牌與防偽碼至櫃檯取餐！', 'Thank you! Please show your pickup # and verify code at the counter.', 'ご来店ありがとうございます。番号と認証コードをカウンターでご提示ください。', '감사합니다! 픽업 번호와 인증코드를 카운터에 제시해 주세요.')}
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
        🛑 ${t(`結單防呆攔截：此訂單為「${o.paymentStatus || '取餐付現'}」，嚴禁未收款直接結單！請先完成收款找零。`, `Unpaid Guard: This order is "${trTerm(o.paymentStatus || '取餐付現')}". Collect payment before completing.`, `未収ガード：この注文は未決済です。お会計を完了してから引き渡してください。`, `미결제 방지: 이 주문은 미결제 상태입니다. 먼저 결제를 완료하세요.`)}
      </div>
    ` : ''}

    <div style="background:#F8FAFC; padding:12px; border-radius:12px; border:1px solid var(--border); margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:900; font-size:1.1rem;">${t('取餐號', 'Pickup #', '受取番号', '픽업 번호')} #${escapeHtml(o.pickupNumber)} (${t('核銷碼', 'Code', '認証コード', '인증코드')} ${escapeHtml(verDisplay)})</span>
        <span style="font-size:0.8rem; color:var(--text-secondary);">📅 ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}</span>
      </div>
      ${o.customerPhone ? `<div style="font-size:0.82rem; font-weight:800; color:var(--brand-dark); margin-top:2px;">📱 ${t('聯絡電話', 'Phone', '電話番号', '연락처')}: ${escapeHtml(o.customerPhone)}</div>` : ''}
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px; padding-top:8px; border-top:1px dashed var(--border);">
        <span style="font-weight:800;">${t('應收金額', 'Amount Due', '請求金額', '결제 금액')}</span>
        <span style="font-size:1.45rem; font-weight:950; color:var(--red);">NT$ ${total}</span>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin-bottom:10px;">
      ${['現場現金', 'LINE Pay', '複合付款'].map(m => `
        <button type="button" class="pos-chip-btn ${state.payingOrderMethod === m ? 'active' : ''}" onclick="setOrderPayMethod(${escapeJsAttr(m)})">${m === 'LINE Pay' ? '💚 LINE Pay' : m === '複合付款' ? `🔀 ${t('複合付款', 'Split Pay', '併用決済', '복합 결제')}` : `💵 ${t('現場現金', 'Cash', '現金', '현금')}`}</button>
      `).join('')}
    </div>

    ${state.payingOrderMethod === 'LINE Pay' ? `
      <div style="background:#ECFDF5; border:1.5px solid #10B981; color:#065F46; border-radius:10px; padding:10px 12px; margin-bottom:12px; font-size:0.8rem; font-weight:850; line-height:1.45;">
        💚 ${t('現場立牌 LINE Pay 收款：請確認顧客手機已顯示付款成功畫面。確認收訖後，本筆將自動歸類至日結單「LINE Pay 總額」（絕不計入現金錢箱）。', 'Counter LINE Pay Standee: Confirm customer payment screen. Recorded under LINE Pay in Z-Report (excluded from cash drawer).', '店頭LINE Pay決済：お客様画面を確認してください（現金レジには計上されません）。', '현장 LINE Pay 결제: 고객 화면을 확인하세요 (현금 시재에 합산되지 않음).')}
      </div>
    ` : ''}

    ${state.payingOrderMethod === '複合付款' ? `
      <div style="background:#FFFBEB; border:1.5px solid #F59E0B; border-radius:10px; padding:10px; margin-bottom:12px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div>
            <label class="field-label">💵 ${t('實收現金 ($)', 'Cash ($)', '現金 ($)', '현금 ($)')}</label>
            <input type="number" class="select-input" min="1" max="${Math.max(1, total - 1)}" placeholder="${Math.floor(total / 2)}" value="${escapeHtml(state.payingOrderSplitCashInput)}" oninput="state.payingOrderSplitCashInput=this.value; renderOrderPayModalContent();">
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
          <div style="font-size:0.72rem; color:#94A3B8;">💵 ${t('實收現金', 'Cash Tendered', 'お預かり', '받은 현금')}</div>
          <div style="font-size:1.25rem; font-weight:950; color:#38BDF8;">NT$ ${state.payingOrderCashInput !== '' ? escapeHtml(state.payingOrderCashInput) : `${total} (${t('剛好', 'Exact', 'ちょうど', '정확히')})`}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.72rem; color:#94A3B8;">🪙 ${t('應找零錢', 'Change Due', 'お釣り', '거스름돈')}</div>
          <div style="font-size:1.25rem; font-weight:950; color:${isShort ? '#F87171' : '#34D399'};">
            ${isShort ? `${t('不足', 'Short', '不足', '부족')} $${total - cashNum}` : `NT$ ${change}`}
          </div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-bottom:8px;">
        <button type="button" class="pos-chip-btn" onclick="setOrderPayQuickCash(${total})">${t('剛好', 'Exact', 'ちょうど', '정확히')} ($${total})</button>
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
        <button type="button" class="pos-numpad-key clear" onclick="orderPayTapKey('C')">${t('清空', 'CLR', 'クリア', '초기화')}</button>
        <button type="button" class="pos-numpad-key" onclick="orderPayTapKey('0')">0</button>
        <button type="button" class="pos-numpad-key back" onclick="orderPayTapKey('BACK')">⌫</button>
      </div>
    ` : ''}

    <button type="button" class="btn-primary-full" onclick="confirmOrderPayment()" ${isShort || isSplitInvalid ? 'disabled' : ''}>
      ✅ ${state.completeAfterPay ? t('確認收訖並立即完成結單', 'Confirm Paid & Complete Order', '受領確定して完了', '결제 확인 및 완료') : `${t('確認收訖', 'Confirm Paid', '受領確定', '결제 확인')} NT$ ${total}`} ${state.payingOrderMethod === '現場現金' && change > 0 ? `(${t('找零', 'Change', 'お釣り', '거스름돈')} NT$ ${change})` : ''}
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

  await withActiveButtonBusy(async () => {
    const shouldComplete = state.completeAfterPay;
    const total = Number(o.finalTotal) || 0;
    const isSplit = state.payingOrderMethod === '複合付款';
    const isLinePayStandee = state.payingOrderMethod === 'LINE Pay';
    const splitCashNum = isSplit ? Math.min(total, Math.max(0, parseInt(state.payingOrderSplitCashInput || '0', 10) || 0)) : 0;
    const splitLineNum = isSplit ? Math.max(0, total - splitCashNum) : 0;
    const paymentSplitObj = isSplit ? { cash: splitCashNum, linePay: splitLineNum } : null;

    const cashNum = state.payingOrderMethod === '現場現金'
      ? (state.payingOrderCashInput !== '' ? parseFloat(state.payingOrderCashInput) : total)
      : (isSplit ? splitCashNum : 0);
    const change = state.payingOrderMethod === '現場現金' ? Math.max(0, cashNum - total) : 0;

    const prevSnapshot = {
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      paymentSplit: o.paymentSplit,
      linePayVerifiedMode: o.linePayVerifiedMode,
      cashReceived: o.cashReceived,
      changeGiven: o.changeGiven,
      status: o.status
    };

    o.paymentStatus = '已付款';
    o.paymentMethod = isSplit ? `複合付款 (現金$${splitCashNum}+LP$${splitLineNum})` : state.payingOrderMethod;
    o.paymentSplit = paymentSplitObj;
    o.linePayVerifiedMode = isLinePayStandee ? 'COUNTER_STANDEE' : (isSplit ? 'SPLIT_COUNTER' : '');
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
        linePayVerifiedMode: o.linePayVerifiedMode,
        cashReceived: cashNum,
        changeGiven: change
      },
      shouldComplete
        ? (isLinePayStandee
            ? `💚 訂單 #${o.pickupNumber} 已確認現場 LINE Pay 收款並完成交付結單！`
            : `✅ 訂單 #${o.pickupNumber} 已收款（找零 $${change}）並完成交付結單！`)
        : (isLinePayStandee
            ? `💚 訂單 #${o.pickupNumber} 已確認現場 LINE Pay 收款（已記入 LINE Pay 帳目）！`
            : `💵 訂單 #${o.pickupNumber} 已完成收款！目前狀態：${o.status}`)
    );

    if (ok) {
      recordLocalPushNotificationLog(
        shouldComplete ? 'ORDER_COMPLETED' : 'ORDER_PAID',
        shouldComplete ? `✅ 訂單 #${o.pickupNumber} 已收款並完成取餐` : `💵 訂單 #${o.pickupNumber} 已完成繳費`,
        `我們已收到您【${o.storeName}】訂單共 NT$${o.finalTotal} (${o.paymentMethod}) 的款項，感謝您的光臨！`,
        o
      );
    }
  }, t('⏳ 收款處理中...', '⏳ Processing...'));
}

// B14：已付款訂單「事後變更付款方式 (現金 ⇄ LINE Pay)」，同步修正雲端帳務與日結單，杜絕現金對不上
function openChangeOrderPaymentMethodModal(orderId) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  let modal = document.getElementById('changeOrderPayMethodModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="changeOrderPayMethodModal" class="modal-overlay" style="z-index:1500;" onclick="if(event.target===this) closeChangeOrderPayMethodModal()">
        <div class="modal-card" style="max-width:420px;">
          <div class="modal-header" style="background:#0F172A; color:#FFFFFF;">
            <div>
              <span style="font-size:0.72rem; font-weight:800; color:#34D399;">🔄 ${t('帳務修正・變更付款方式', 'Accounting Fix · Change Payment Method', '支払方法変更', '결제 수단 변경')}</span>
              <h3 id="changePayMethodTitle" style="font-size:1.08rem; font-weight:900; margin-top:2px;"></h3>
            </div>
            <button type="button" onclick="closeChangeOrderPayMethodModal()" style="border:none; background:rgba(255,255,255,0.2); color:#fff; width:32px; height:32px; border-radius:50%; font-weight:900;">✕</button>
          </div>
          <div class="modal-body" id="changePayMethodBody"></div>
        </div>
      </div>
    `);
    modal = document.getElementById('changeOrderPayMethodModal');
  }
  const curMethod = String(o.paymentMethod || '現場現金');
  const titleEl = document.getElementById('changePayMethodTitle');
  const bodyEl = document.getElementById('changePayMethodBody');
  if (titleEl) titleEl.innerText = `#${o.pickupNumber} · NT$${o.finalTotal} (${t('目前', 'Current')}: ${curMethod})`;
  if (bodyEl) {
    bodyEl.innerHTML = `
      <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:12px;">
        ${t('顧客臨時改付現金或改掃現場立牌 LINE Pay 時，點下方切換即可自動同步修正交班日結單（Z-Report）之現金與 LINE Pay 金額並寫入稽核紀錄。', 'Switch between Cash and Counter LINE Pay to keep Z-Report totals accurate with full audit logging.')}
      </p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button type="button" class="pos-quick-choice-btn ${!curMethod.includes('LINE Pay') ? 'active' : ''}" style="padding:14px; text-align:left;" onclick="commitChangeOrderPaymentMethod(${escapeJsAttr(o.orderId)}, '現場現金')">
          <div style="font-size:0.98rem; font-weight:950;">💵 ${t('改為「現場現金」收款', 'Switch to Cash', '現金払いに変更', '현금 결제로 변경')}</div>
          <div style="font-size:0.74rem; opacity:0.85;">${t('歸類至日結單現金錢箱實收', 'Counts toward Z-Report Cash Drawer')}</div>
        </button>
        <button type="button" class="pos-quick-choice-btn ${curMethod.includes('LINE Pay') ? 'active' : ''}" style="padding:14px; text-align:left; border-color:#10B981; background:#ECFDF5; color:#065F46;" onclick="commitChangeOrderPaymentMethod(${escapeJsAttr(o.orderId)}, 'LINE Pay')">
          <div style="font-size:0.98rem; font-weight:950;">💚 ${t('改為「現場 LINE Pay」收款', 'Switch to Counter LINE Pay', '店頭LINE Payに変更', '현장 LINE Pay로 변경')}</div>
          <div style="font-size:0.74rem; opacity:0.85;">${t('歸類至日結單 LINE Pay 總額，不計入現金錢箱', 'Counts toward Z-Report LINE Pay (excluded from cash)')}</div>
        </button>
        <button type="button" class="btn-outline" style="width:100%;" onclick="closeChangeOrderPayMethodModal()">${t('取消', 'Cancel', 'キャンセル', '취소')}</button>
      </div>
    `;
  }
  modal.classList.add('open');
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(modal);
}

function closeChangeOrderPayMethodModal() {
  document.getElementById('changeOrderPayMethodModal')?.classList.remove('open');
}

async function commitChangeOrderPaymentMethod(orderId, newMethod) {
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  await withActiveButtonBusy(async () => {
    const prev = {
      paymentMethod: o.paymentMethod,
      paymentSplit: o.paymentSplit,
      linePayVerifiedMode: o.linePayVerifiedMode,
      cashReceived: o.cashReceived,
      changeGiven: o.changeGiven
    };
    const isLp = newMethod === 'LINE Pay';
    o.paymentMethod = newMethod;
    o.paymentSplit = null;
    o.linePayVerifiedMode = isLp ? 'COUNTER_STANDEE' : '';
    o.cashReceived = isLp ? 0 : (Number(o.finalTotal) || 0);
    o.changeGiven = 0;
    closeChangeOrderPayMethodModal();
    saveCachedOrders(state.orders);
    renderMerchantView();

    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'changeOrderPaymentMethod',
          ...getMerchantAuthPayload(),
          storeId: o.storeId,
          orderId: o.orderId,
          paymentMethod: newMethod,
          newPaymentMethod: newMethod,
          linePayVerifiedMode: o.linePayVerifiedMode
        })
      });
      const data = await res.json();
      if (!data || !data.success) {
        Object.assign(o, prev);
        saveCachedOrders(state.orders);
        renderMerchantView();
        showToast(`❌ 變更付款方式失敗已還原：${(data && data.message) || '請重試'}`);
        return;
      }
      recordMerchantAuditLog('變更訂單付款方式', `#${o.pickupNumber}: ${prev.paymentMethod} ➔ ${newMethod}`);
      showToast(`✅ 訂單 #${o.pickupNumber} 已變更為「${newMethod}」，日結單帳目已同步更新！`);
    } catch (e) {
      showToast(`⚠️ 網路異常：已先於本機將 #${o.pickupNumber} 改為「${newMethod}」`);
    }
  }, t('⏳ 更新帳務中...', '⏳ Updating...'));
}

// B15：補送訂單至 Windows 芯燁出單機佇列重印（顧客聯 + 前台 + 後台）
async function requeueOrderPrintJob(orderId) {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const o = state.orders.find(ord => ord.orderId === orderId);
  if (!o) return;
  await withActiveButtonBusy(async () => {
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'requeuePrintJob',
          ...getMerchantAuthPayload(),
          storeId: o.storeId,
          orderId: o.orderId
        })
      });
      const data = await res.json();
      if (!data || !data.success) {
        throw new Error((data && data.message) || '送出重印排程失敗');
      }
      showToast(`🖨️ 已將訂單 #${o.pickupNumber} 排入自動出單機佇列，約 3~5 秒內自動出紙切單！`);
    } catch (e) {
      showToast(`❌ 重印失敗：${e.message || '請確認網路與後端已更新部署'}`);
    }
  }, t('⏳ 排入出單中...', '⏳ Queueing Print...'));
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

async function fetchStoreAnalyticsFromCloud(storeId, startDate, endDate) {
  if (!storeId || !isMerchantSessionValidNow()) return;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getStoreAnalytics',
        ...getMerchantAuthPayload(),
        storeId,
        startDate,
        endDate
      })
    });
    const data = await res.json();
    if (data && data.success && data.authoritative) {
      state.analyticsCloudData = data;
      const store = state.stores.find(s => s.id === state.merchantStoreId);
      if (store && state.storeTabMode === 'analytics') {
        renderMerchantAnalyticsPanel(store, true);
      }
    }
  } catch (e) {}
}

function setAnalyticsQuickRange(rangeKey) {
  const todayStr = getTodayDateStr();
  if (rangeKey === 'DAY') {
    state.analyticsPeriod = 'DAY';
    state.analyticsStartDate = todayStr;
    state.analyticsEndDate = todayStr;
  } else if (rangeKey === 'WEEK') {
    state.analyticsPeriod = 'WEEK';
    state.analyticsStartDate = getDateOffsetFromStr(todayStr, -6);
    state.analyticsEndDate = todayStr;
  } else if (rangeKey === 'MONTH') {
    state.analyticsPeriod = 'MONTH';
    state.analyticsStartDate = getDateOffsetFromStr(todayStr, -29);
    state.analyticsEndDate = todayStr;
  }
  state.analyticsCloudData = null;
  state.analyticsSelectedFilter = null;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (store) renderMerchantAnalyticsPanel(store);
}

function applyAnalyticsCustomDateRange() {
  const sEl = document.getElementById('analyticsStartDateInput');
  const eEl = document.getElementById('analyticsEndDateInput');
  const todayStr = getTodayDateStr();
  let sVal = normalizeDateStr((sEl && sEl.value) || state.analyticsStartDate || todayStr) || todayStr;
  let eVal = normalizeDateStr((eEl && eEl.value) || state.analyticsEndDate || todayStr) || todayStr;
  if (sVal > eVal) { const tmp = sVal; sVal = eVal; eVal = tmp; }
  state.analyticsStartDate = sVal;
  state.analyticsEndDate = eVal;
  state.analyticsPeriod = sVal === eVal ? 'DAY' : 'CUSTOM';
  state.analyticsCloudData = null;
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (store) renderMerchantAnalyticsPanel(store);
}

function exportStoreAnalyticsCsv() {
  const store = state.stores.find(s => s.id === state.merchantStoreId) || state.stores[0];
  if (!store) return;

  const cloudA = (state.analyticsCloudData && state.analyticsCloudData.storeId === store.id && Array.isArray(state.analyticsCloudData.exportOrders))
    ? state.analyticsCloudData
    : null;

  if (cloudA && cloudA.exportOrders.length > 0) {
    const headers = ['訂單編號', '取餐號', '日期', '時間', '狀態', '用餐方式', '付款方式', '付款狀態', 'LINE Pay 核實模式', '商品毛額', '折讓', '服務費', '實收淨額', '經手人員', '餐點明細'];
    const rows = cloudA.exportOrders.map(o => [
      o.id, `#${o.dailyNo}`, o.dateStr, o.timeStr, o.status, o.dineType, o.paymentMethod,
      o.paymentStatus, o.linePayVerifiedMode || '', o.subtotal, o.discount, o.serviceFee || 0,
      o.finalTotal, o.cashierName || '', o.itemsText || ''
    ].map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MealFlow_${store.name}_全區間營運報表_${cloudA.startDate}_${cloudA.endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`📥 ${t(`已匯出全區間報表 (${cloudA.startDate} ~ ${cloudA.endDate}，共 ${cloudA.exportOrders.length} 筆)`, `Exported ${cloudA.exportOrders.length} orders CSV`)}`);
    return;
  }

  const orders = state.orders.filter(o => o.storeId === store.id);
  if (orders.length === 0) {
    showToast(`⚠️ ${t('目前無訂單資料可匯出', 'No orders to export')}`);
    return;
  }

  const headers = ['訂單編號', '取餐流水號', '防偽核銷碼', '店鋪名稱', '取餐日期', '取餐時間', '用餐方式', '來源類型', '餐點明細', '商品毛額', '餐具費', '離峰折抵', '櫃檯折讓', '實收淨額', '退款金額', '付款方式', '實收現金', '找零金額', '付款狀態', '交易授權碼', '買方統編', '訂單狀態', '聯絡電話', '顧客備註', '建立時間'];
  const rows = orders.map(o => {
    const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
    const itemText = items.map(i => `${i.baseName || i.name}x${i.qty || 1}`).join('; ');
    return [
      o.orderId, `#${o.pickupNumber}`, formatVerificationCodeDisplay(o), o.storeName,
      normalizeDateStr(o.pickupDate), normalizeTimeStr(o.pickupTime), o.dineType || '外帶自取',
      o.studentId || '', itemText, o.subtotal || o.finalTotal, o.cutleryFee || 0, o.discount || 0,
      o.manualDiscount || 0, o.finalTotal, o.refundAmount || 0, o.paymentMethod || '',
      o.cashReceived || 0, o.changeGiven || 0, o.paymentStatus || '', o.transactionId || '',
      o.taxId || '', o.status || '', o.customerPhone || '', o.customerNote || '', o.createdAt || ''
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
  showToast(`📥 ${t(`已匯出會計報表（共 ${orders.length} 筆）`, `Exported ${orders.length} orders CSV`)}`);
}

function renderMerchantAnalyticsPanel(store, skipCloudFetch = false) {
  const panel = document.getElementById('storePanel-analytics');
  if (!panel) return;

  const period = state.analyticsPeriod || 'DAY';
  const todayStr = getTodayDateStr();
  const startDate = state.analyticsStartDate || todayStr;
  const endDate = state.analyticsEndDate || todayStr;

  if (!skipCloudFetch) {
    const cachedOk = state.analyticsCloudData
      && state.analyticsCloudData.storeId === store.id
      && state.analyticsCloudData.startDate === startDate
      && state.analyticsCloudData.endDate === endDate;
    if (!cachedOk) {
      fetchStoreAnalyticsFromCloud(store.id, startDate, endDate);
    }
  }
  const cloudA = (state.analyticsCloudData && state.analyticsCloudData.storeId === store.id && state.analyticsCloudData.startDate === startDate && state.analyticsCloudData.endDate === endDate)
    ? state.analyticsCloudData
    : null;
  const past7StartStr = getDateOffsetFromStr(todayStr, -6);

  const allValidStoreOrders = state.orders.filter(o => o.storeId === store.id && !String(o.status).includes('已取消'));
  const hasSeedOrders = state.orders.some(o => o.isSeedSample);

  let periodTitle = t(`今日各時段真實實收營收 (${todayStr})`, `Today's Hourly Paid Revenue (${todayStr})`, `本日の時間帯別売上 (${todayStr})`, `오늘 시간대별 실수령 매출 (${todayStr})`);
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
      { key: '10', label: t('10-11時', '10-11h', '10-11時', '10-11시'), match: o => parseOrderHour(o) <= 10 },
      { key: '11', label: t('11-12時', '11-12h', '11-12時', '11-12시'), match: o => parseOrderHour(o) === 11 },
      { key: '12', label: t('12-13時', '12-13h', '12-13時', '12-13시'), match: o => parseOrderHour(o) === 12 },
      { key: '13', label: t('13-14時', '13-14h', '13-14時', '13-14시'), match: o => parseOrderHour(o) === 13 },
      { key: '14', label: t('14-16時', '14-16h', '14-16時', '14-16시'), match: o => parseOrderHour(o) >= 14 && parseOrderHour(o) <= 15 },
      { key: '16', label: t('16-18時', '16-18h', '16-18時', '16-18시'), match: o => parseOrderHour(o) >= 16 && parseOrderHour(o) <= 17 },
      { key: '18', label: t('18時後', '18h+', '18時以降', '18시 이후'), match: o => parseOrderHour(o) >= 18 }
    ];
  } else if (period === 'WEEK') {
    periodTitle = t(`過去 7 日每日真實營收趨勢 (${past7StartStr.slice(5)} ~ ${todayStr.slice(5)})`, `7-Day Revenue Trend (${past7StartStr.slice(5)}–${todayStr.slice(5)})`, `過去7日間の売上推移 (${past7StartStr.slice(5)}〜${todayStr.slice(5)})`, `최근 7일 매출 추이 (${past7StartStr.slice(5)}~${todayStr.slice(5)})`);
    const dayOffsets = [-6, -5, -4, -3, -2, -1, 0];
    const allowedDates = new Set(dayOffsets.map(off => getDateOffsetFromStr(todayStr, off)));
    periodOrders = allValidStoreOrders.filter(o => allowedDates.has(getOrderAccountingDate(o)));
    buckets = dayOffsets.map(off => {
      const dStr = getDateOffsetFromStr(todayStr, off);
      const shortLabel = off === 0 ? `${t('今日', 'Today', '本日', '오늘')}(${dStr.slice(5)})` : dStr.slice(5);
      return {
        key: dStr,
        label: shortLabel,
        match: o => getOrderAccountingDate(o) === dStr
      };
    });
  } else {
    periodTitle = t('歷史與未來預訂全區間分析', 'Full-Range & Future Pre-order Analytics', '全期間・未来予約分析', '전체 기간 및 예약 분석');
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

  const ordUnit = t('單', ' ord', '件', '건');
  const pcsUnit = t('份', ' pcs', '点', '개');
  const minUnit = t('分', 'm', '分', '분');

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
             onmousemove="showAnalyticsTooltip(event, ${escapeJsAttr(b.label)}, ${escapeJsAttr('NT$ ' + b.rev.toLocaleString() + ' (' + b.count + ordUnit + ')')}, ${escapeJsAttr(t('點擊柱狀圖可篩選檢視明細', 'Click bar to filter orders'))})"
             ontouchstart="showAnalyticsTooltip(event, ${escapeJsAttr(b.label)}, ${escapeJsAttr('NT$ ' + b.rev.toLocaleString() + ' (' + b.count + ordUnit + ')')}, ${escapeJsAttr(t('點擊篩選明細', 'Tap to filter'))})"
             onclick="filterAnalyticsOrdersByKey('BUCKET', ${escapeJsAttr(b.key)}, ${escapeJsAttr(b.label)})">
            <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6"
                  fill="${isSelected ? '#F97316' : (b.rev > 0 ? 'url(#barGrad)' : '#E2E8F0')}"
                  stroke="${isSelected ? '#C2410C' : 'none'}" stroke-width="2" />
            <text x="${x + barW / 2}" y="${y - 16}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#64748B">${b.count}${ordUnit}</text>
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
    pieItems = [{ name: t('此區間無紀錄', 'No records', 'データなし', '기록 없음'), qty: 0, rev: 0, pct: 100, color: '#CBD5E1' }];
  } else {
    const top4 = sortedItems.slice(0, 4);
    const others = sortedItems.slice(4);
    pieItems = top4.map((it, idx) => ({
      name: trTerm(it.name),
      rawKey: it.name,
      qty: it.qty,
      rev: it.rev,
      pct: Math.max(1, Math.round((it.rev / Math.max(1, totalItemRevenue)) * 100)),
      color: palette[idx % palette.length]
    }));
    if (others.length > 0) {
      const otherQty = others.reduce((s, i) => s + i.qty, 0);
      const otherRev = others.reduce((s, i) => s + i.rev, 0);
      pieItems.push({
        name: t('其他餐點合計', 'Other Items', 'その他の料理', '기타 메뉴'),
        rawKey: '__OTHERS__',
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
              onmousemove="showAnalyticsTooltip(event, ${escapeJsAttr('🍽️ ' + seg.name)}, ${escapeJsAttr(seg.qty + pcsUnit + ' · NT$ ' + seg.rev)}, ${escapeJsAttr(seg.pct + '%')})"
              onmouseleave="resetDonutSlice(${escapeJsAttr(topPie.name)}, ${topPie.pct}, ${escapeJsAttr(topPie.qty + pcsUnit + ' / $' + topPie.rev)}, ${escapeJsAttr(topPie.color)}); hideAnalyticsTooltip();"
              onclick="filterAnalyticsOrdersByKey('ITEM', ${escapeJsAttr(seg.rawKey || seg.name)}, ${escapeJsAttr(seg.name)})"></circle>
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

  const fmtDelta = (pct) => {
    const v = Number(pct) || 0;
    const cls = v > 0 ? 'color:#059669;' : (v < 0 ? 'color:#DC2626;' : 'color:#64748B;');
    const arrow = v > 0 ? '▲' : (v < 0 ? '▼' : '▬');
    return `<span style="font-size:0.74rem; font-weight:900; ${cls} margin-left:6px;">${arrow} ${v > 0 ? '+' : ''}${v}%</span>`;
  };
  const dispNetRev = cloudA ? Number(cloudA.totalRevenue || 0) : netPaidRevenue;
  const dispOrderCnt = cloudA ? Number(cloudA.orderCount || 0) : paidPeriodOrders.length;
  const dispAov = cloudA ? Number(cloudA.avgOrderValue || 0) : avgTicket;
  const dispLpGross = cloudA ? Number(cloudA.linePayGross || 0) : 0;
  const dispLpFeeRate = cloudA ? Number(cloudA.linePayFeeRate || 2.2) : Number(store.linePayFeeRate || 2.2);
  const dispLpFeeAmt = cloudA ? Number(cloudA.linePayFeeAmount || 0) : 0;
  const dispRealNet = cloudA ? Number(cloudA.realNetAfterFees || dispNetRev) : dispNetRev;
  const dispAddonRate = cloudA ? Number(cloudA.addonAttachmentRatePct || 0) : 0;

  panel.innerHTML = `
    <div class="analytics-panel-wrap">
      <div style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; padding:12px 16px; border-radius:14px; border:1px solid var(--border); flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="font-size:1.08rem; font-weight:950; color:var(--text-primary);">
            📊 ${escapeHtml(trTerm(store.name))} — ${t('全區間營運分析與實拿損益報表', 'Full-Range Analytics & Net Settlement P&L', '全期間売上・純利益分析', '전기간 매출 및 순수익 분석')}
          </h3>
          <div style="font-size:0.78rem; color:var(--text-secondary);">
            ${cloudA
              ? `☁️ ${t(`後端全試算表權威掃描 (${cloudA.totalRowsScanned} 筆) · 區間 ${cloudA.startDate} ~ ${cloudA.endDate}（對比前期 ${cloudA.prevStartDate} ~ ${cloudA.prevEndDate}）`, `Server full-sheet scan (${cloudA.totalRowsScanned} rows) · ${cloudA.startDate} to ${cloudA.endDate} vs ${cloudA.prevStartDate}–${cloudA.prevEndDate}`)}`
              : `⏳ ${t('正在從雲端載入全區間跨期營運統計（不受 2,500 筆限制）...', 'Loading full-range cloud analytics...')}`}
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <button type="button" class="pos-cat-pill ${period === 'DAY' ? 'active' : ''}" onclick="setAnalyticsQuickRange('DAY')">📅 ${t('今日', 'Today', '本日', '오늘')}</button>
          <button type="button" class="pos-cat-pill ${period === 'WEEK' ? 'active' : ''}" onclick="setAnalyticsQuickRange('WEEK')">📆 ${t('近7日', '7 Days', '7日間', '최근 7일')}</button>
          <button type="button" class="pos-cat-pill ${period === 'MONTH' ? 'active' : ''}" onclick="setAnalyticsQuickRange('MONTH')">🗓️ ${t('近30日', '30 Days', '30日間', '최근 30일')}</button>
          <input type="date" id="analyticsStartDateInput" class="select-input" style="width:auto; padding:4px 7px; font-size:0.76rem;" value="${escapeHtml(startDate)}">
          <span style="font-weight:800; font-size:0.76rem;">~</span>
          <input type="date" id="analyticsEndDateInput" class="select-input" style="width:auto; padding:4px 7px; font-size:0.76rem;" value="${escapeHtml(endDate)}">
          <button type="button" class="btn-tip-action" style="padding:5px 10px; font-size:0.75rem; background:#4F46E5;" onclick="applyAnalyticsCustomDateRange()">🔍 ${t('查詢', 'Query', '照会', '조회')}</button>
          <button type="button" class="btn-tip-action" style="padding:5px 10px; font-size:0.75rem; background:#0F172A;" onclick="openShiftZReportModal()">🧾 ${t('交班日結', 'Z-Report')}</button>
          <button type="button" class="btn-outline" style="padding:5px 10px; font-size:0.75rem;" onclick="exportStoreAnalyticsCsv()">📥 ${t('匯出 CSV', 'Export CSV')}</button>
        </div>
      </div>

      <div class="analytics-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">💰 ${t('區間總營收 (含跨期對比)', 'Period Revenue (PoP)', '期間売上 (前期比)', '기간 매출 (전기 대비)')}</div>
          <div class="kpi-val" style="color:var(--brand-dark);">NT$ ${dispNetRev.toLocaleString()}${cloudA ? fmtDelta(cloudA.revenueDeltaPct) : ''}</div>
          <div class="kpi-sub">${t(`有效 ${dispOrderCnt} 單 · 客單價 NT$${dispAov}`, `${dispOrderCnt} orders · Avg NT$${dispAov}`)}${cloudA ? fmtDelta(cloudA.orderCountDeltaPct) : ''}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">🏦 ${t(`扣除金流費實拿淨額 (LP ${dispLpFeeRate}%)`, `Real Net After Fees (LP ${dispLpFeeRate}%)`, `手数料控除後純額`, `수수료 차감 실수령액`)}</div>
          <div class="kpi-val" style="color:#059669;">NT$ ${dispRealNet.toLocaleString()}</div>
          <div class="kpi-sub" style="color:var(--indigo);">${t(`LINE Pay $${dispLpGross.toLocaleString()} · 手續費 -$${dispLpFeeAmt.toLocaleString()}`, `LINE Pay $${dispLpGross.toLocaleString()} · Fee -$${dispLpFeeAmt.toLocaleString()}`)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">🎯 ${t('加購/加料附著率 & 未來預訂', 'Add-on Attach Rate & Pre-orders', 'トッピング付帯率・予約', '추가 옵션 비율 & 예약')}</div>
          <div class="kpi-val" style="color:var(--indigo);">${dispAddonRate}%</div>
          <div class="kpi-sub">${t(`待收 $${unpaidReceivables.toLocaleString()} · 未來預訂 ${futureReservations.length} 單`, `Unpaid $${unpaidReceivables.toLocaleString()} · Future ${futureReservations.length}`)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">⏱️ ${t('即時出餐等候 / 產能負載', 'Live Wait / Capacity Load', '待ち時間・稼働率', '실시간 대기 / 부하')}</div>
          <div class="kpi-val">${store.avgPrepMinutes} ${t('分鐘', 'min', '分', '분')}</div>
          <div class="kpi-sub">${t(`基礎 ${store.basePrepMinutes}分 · 佇列 ${store.activeOrders}/${store.maxCapacityPer15Min} (${store.loadPercentage}%)`, `Base ${store.basePrepMinutes}m · Queue ${store.activeOrders}/${store.maxCapacityPer15Min} (${store.loadPercentage}%)`)}</div>
        </div>
      </div>

      ${cloudA && (cloudA.categoryBreakdown.length > 0 || cloudA.comboDrinkStats.length > 0) ? `
        <div class="charts-grid" style="margin-bottom:12px;">
          <div class="chart-card">
            <div style="font-weight:900; font-size:0.92rem; margin-bottom:8px;">📂 ${t('分類營收佔比分析 (Category Share)', 'Category Revenue Share', 'カテゴリ別売上構成', '카테고리별 매출 비중')}</div>
            <div style="display:flex; flex-direction:column; gap:7px;">
              ${cloudA.categoryBreakdown.slice(0, 6).map(cat => `
                <div>
                  <div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:800; margin-bottom:2px;">
                    <span>${escapeHtml(trTerm(cat.category))} (${cat.qty} ${t('份', 'pcs')})</span>
                    <span style="color:var(--brand-dark);">NT$ ${cat.revenue.toLocaleString()} (${cat.sharePct}%)</span>
                  </div>
                  <div style="height:7px; background:#F1F5F9; border-radius:999px; overflow:hidden;">
                    <div style="height:100%; width:${Math.min(100, cat.sharePct)}%; background:linear-gradient(90deg, #F97316, #EA580C); border-radius:999px;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="chart-card">
            <div style="font-weight:900; font-size:0.92rem; margin-bottom:8px;">🥤 ${t('套餐附餐飲料與加點統計', 'Combo Drinks & Add-on Breakdown', 'セットドリンク集計', '세트 음료 및 추가 집계')}</div>
            ${cloudA.comboDrinkStats.length === 0 ? `
              <div style="font-size:0.8rem; color:var(--text-muted); padding:10px 0;">${t('此區間無套餐附餐飲料紀錄', 'No combo drinks recorded in this period')}</div>
            ` : `
              <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${cloudA.comboDrinkStats.map(cd => `
                  <span style="background:#EFF6FF; border:1px solid #BFDBFE; color:#1E40AF; padding:5px 10px; border-radius:999px; font-size:0.78rem; font-weight:900;">
                    🥤 <span data-dish-name="1">${escapeHtml(trTerm(cd.name))}</span> ×${cd.qty}
                  </span>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      ` : ''}

      <div class="charts-grid">
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:4px;">
            <span style="font-weight:900; font-size:0.94rem;">📊 ${escapeHtml(periodTitle)}</span>
            <span style="font-size:0.74rem; color:var(--brand-dark); font-weight:800;">🖱️ ${t('點擊柱狀圖篩選明細', 'Click bar to filter', '棒グラフで絞り込み', '막대 클릭으로 필터링')}</span>
          </div>
          ${barSvgHtml}
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span style="font-weight:900; font-size:0.94rem;">🍩 ${t('單品營收佔比分析', 'Top Items Revenue Share', '商品別売上シェア', '메뉴별 매출 비중')}</span>
            <span style="font-size:0.72rem; color:var(--text-secondary); font-weight:700;">${t('餐點總計', 'Items Total', '商品合計', '메뉴 합계')} $${totalItemRevenue}</span>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-around; gap:12px; flex-wrap:wrap;">
            <svg width="155" height="155" viewBox="0 0 42 42" style="overflow:visible;">
              <circle r="15.915" cx="21" cy="21" fill="transparent" stroke="#F1F5F9" stroke-width="6.5"></circle>
              ${donutCircles}
              <text data-dish-name="1" id="donutCenterTitle" x="21" y="18.5" text-anchor="middle" font-size="3.3" font-weight="900" fill="#0F172A">${escapeHtml(topPie.name.slice(0, 7))}</text>
              <text id="donutCenterVal" x="21" y="23.8" text-anchor="middle" font-size="4.6" font-weight="900" fill="${topPie.color}">${topPie.pct}%</text>
              <text id="donutCenterSub" x="21" y="27.5" text-anchor="middle" font-size="2.6" font-weight="800" fill="#64748B">${topPie.qty}${pcsUnit} / $${topPie.rev}</text>
            </svg>
            <div style="flex:1; min-width:170px; display:flex; flex-direction:column; gap:5px;">
              ${pieItems.map((p, idx) => `
                <div class="legend-interactive-row ${state.analyticsSelectedFilter?.type === 'ITEM' && state.analyticsSelectedFilter?.key === (p.rawKey || p.name) ? 'active active-legend' : ''}"
                     onmouseenter="highlightDonutSlice(${idx}, ${escapeJsAttr(p.name)}, ${p.qty}, ${p.rev}, ${p.pct}, ${escapeJsAttr(p.color)})"
                     onmouseleave="resetDonutSlice(${escapeJsAttr(topPie.name)}, ${topPie.pct}, ${escapeJsAttr(topPie.qty + pcsUnit + ' / $' + topPie.rev)}, ${escapeJsAttr(topPie.color)})"
                     onclick="filterAnalyticsOrdersByKey('ITEM', ${escapeJsAttr(p.rawKey || p.name)}, ${escapeJsAttr(p.name)})">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="width:10px; height:10px; border-radius:3px; background:${p.color}; display:inline-block;"></span>
                    <span data-dish-name="1" style="font-weight:800; font-size:0.8rem; color:var(--text-primary);">${escapeHtml(p.name)}</span>
                  </div>
                  <span style="font-weight:900; font-size:0.78rem; color:var(--text-secondary);">${p.qty}${pcsUnit} ($${p.rev} / ${p.pct}%)</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="charts-grid">
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:900; font-size:0.94rem;">📈 ${t('各時段 15 分鐘尖峰密度與候餐時間曲線', '15-Min Peak Load & Wait Time Curve', '時間帯別ピーク・待ち時間推移', '시간대별 피크 부하 및 대기 시간 추이')}</span>
            <span style="font-size:0.74rem; color:var(--red); font-weight:800;">${t('紅虛線：15分鐘警戒', 'Red line: 15m alert', '赤破線: 15分警告', '빨간 점선: 15분 주의')}</span>
          </div>
          <svg viewBox="0 0 460 175" style="width:100%; height:170px; overflow:visible;" onmouseleave="hideAnalyticsTooltip()">
            <line x1="35" y1="62" x2="435" y2="62" stroke="#FCA5A5" stroke-dasharray="4 4" stroke-width="1.5" />
            <polygon points="${areaPoints}" fill="rgba(16, 185, 129, 0.14)" />
            <polyline fill="none" stroke="#10B981" stroke-width="3" points="${polylinePoints}" />
            ${pts.map(p => `
              <g style="cursor:pointer;"
                 onmousemove="showAnalyticsTooltip(event, ${escapeJsAttr('⏱️ ' + p.label)}, ${escapeJsAttr('~' + p.w + minUnit + ' (' + p.count + ordUnit + ' / $' + p.rev + ')')}, ${escapeJsAttr(t('點擊篩選此時段訂單', 'Click to filter'))})"
                 ontouchstart="showAnalyticsTooltip(event, ${escapeJsAttr('⏱️ ' + p.label)}, ${escapeJsAttr('~' + p.w + minUnit + ' (' + p.count + ordUnit + ' / $' + p.rev + ')')}, ${escapeJsAttr(t('點擊篩選此時段訂單', 'Tap to filter'))})"
                 onclick="filterAnalyticsOrdersByKey('BUCKET', ${escapeJsAttr(p.key)}, ${escapeJsAttr(p.label)})">
                <circle class="chart-interactive-point" cx="${p.x}" cy="${p.y}" r="5.5" fill="#FFFFFF" stroke="#059669" stroke-width="3" />
                <text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="10" font-weight="900" fill="#065F46">${p.w}${minUnit}(${p.count}${ordUnit})</text>
                <text x="${p.x}" y="164" text-anchor="middle" font-size="10.5" font-weight="700" fill="#64748B">${escapeHtml(p.label)}</text>
              </g>
            `).join('')}
            <line x1="35" y1="145" x2="435" y2="145" stroke="#CBD5E1" stroke-width="1.5" />
          </svg>
        </div>

        <div class="chart-card" style="background:linear-gradient(135deg, #EEF2FF 0%, #FFFFFF 100%); border-color:#C7D2FE;">
          <div style="font-weight:900; font-size:0.95rem; color:#312E81; margin-bottom:10px;">
            🧠 ${t('商業財務與廚房排程診斷', 'Operations & Kitchen Capacity Insights', '財務・キッチン稼働診断', '매출 및 주방 스케줄 진단')}
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; font-size:0.82rem; color:#1E293B; line-height:1.5;">
            <div style="background:#FFFFFF; padding:8px 12px; border-radius:10px; border-left:4px solid #4F46E5;">
              <strong>🥇 ${t('本區間人氣王備料建議：', 'Top Seller Prep Recommendation:', '人気1位 仕込み提案：', '인기 1위 재료 준비 제안:')}</strong><br>
              ${t('銷量第一名：', 'Top item: ', '売上1位：', '판매 1위: ')}<strong data-dish-name="1">${escapeHtml(topPie.name)}</strong> (<strong>${topPie.qty}${pcsUnit} / NT$ ${topPie.rev}</strong>, ${topPie.pct}%).
            </div>
            <div style="background:#FFFFFF; padding:8px 12px; border-radius:10px; border-left:4px solid #10B981;">
              <strong>📅 ${t('未來預訂排程與配額隔離保護：', 'Future Pre-order Quota Isolation:', '未来予約枠の分離保護：', '미래 예약 정원 격리 보호:')}</strong><br>
              ${t(`系統共有 ${futureReservations.length} 筆未來日期預訂單，已全數納入 15 分鐘時段配額控管並與今日廚房佇列隔離。`, `${futureReservations.length} future-date pre-orders are tracked in 15-min capacity slots and isolated from today's live kitchen queue.`, `${futureReservations.length} 件の未来予約は15分枠で管理され、本日の調理キューから分離されています。`, `${futureReservations.length}건의 미래 예약 주문이 15분 정원 관리 중이며 오늘 주방 대기열과 격리되어 있습니다.`)}
            </div>
          </div>
        </div>
      </div>

      <div class="chart-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div>
            <span style="font-weight:900; font-size:0.95rem;">
              🔍 ${t('區間真實訂單明細', 'Order Drilldown', '期間注文明細', '기간 주문 상세')} (${activeFilter ? `${t('篩選', 'Filter', '絞込', '필터')}: ${escapeHtml(activeFilter.label)} · ${drilldownOrders.length}` : `${drilldownOrders.length} ${t('筆', 'orders', '件', '건')}`})
            </span>
          </div>
          ${activeFilter ? `
            <button type="button" class="pos-cat-pill active" onclick="filterAnalyticsOrdersByKey(${escapeJsAttr(activeFilter.type)}, ${escapeJsAttr(activeFilter.key)}, '')">
              ✖ ${t(`清除篩選（顯示全部 ${periodOrders.length} 筆）`, `Clear Filter (Show all ${periodOrders.length})`, `解除（全${periodOrders.length}件）`, `필터 해제 (전체 ${periodOrders.length}건)`)}
            </button>
          ` : ''}
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:8px; max-height:240px; overflow-y:auto;">
          ${drilldownOrders.length === 0 ? `<div style="color:var(--text-muted); font-size:0.84rem; padding:12px;">${t('此時間區間尚無訂單紀錄', 'No orders recorded in this range', 'この期間の注文履歴はありません', '이 기간에 주문 기록이 없습니다')}</div>` : drilldownOrders.map(o => {
            const items = Array.isArray(o.structuredItems) ? o.structuredItems : [];
            const summary = items.map(i => `${trDishName(i)}×${i.qty || 1}`).join(state.lang === 'zh-TW' ? '、' : ', ');
            const verDisplay = formatVerificationCodeDisplay(o);
            return `
              <div style="padding:8px 12px; border-radius:10px; border:1px solid var(--border); background:#F8FAFC; font-size:0.78rem; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="min-width:0; flex:1;">
                  <div style="font-weight:900; color:var(--text-primary);">
                    #${escapeHtml(o.pickupNumber)} (🛡️${escapeHtml(verDisplay)}) ・ ${escapeHtml(normalizeDateStr(o.pickupDate))} ${escapeHtml(normalizeTimeStr(o.pickupTime))}
                    <span style="font-size:0.7rem; color:var(--brand-dark);">(${escapeHtml(trTerm(o.status))} / ${escapeHtml(trTerm(o.paymentStatus))})</span>
                  </div>
                  <div data-dish-name="1" style="color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(summary)}</div>
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
          <button type="button" class="pos-cat-pill ${sub === 'menu' ? 'active' : ''}" onclick="switchSettingsSubTab('menu')">🍔 ${t('菜單管理與智慧照片辨識', 'Menu & AI Scan', 'メニュー管理・AI認識', '메뉴 관리 & AI 스캔')}</button>
          <button type="button" class="pos-cat-pill ${sub === 'promo' ? 'active' : ''}" onclick="switchSettingsSubTab('promo')">🥢 ${t('營業狀態・餐具收費與離峰優惠', 'Hours, Cutlery & Promos', '営業・カトラリー・割引', '영업・수저・할인 설정')}</button>
          <button type="button" class="pos-cat-pill ${sub === 'storeProfile' ? 'active' : ''}" onclick="switchSettingsSubTab('storeProfile')">🏪 ${t('餐廳與校區管理', 'Store & Visibility', '店舗・表示制御', '매장 및 노출 관리')}</button>
          <button type="button" class="pos-cat-pill ${sub === 'line' ? 'active' : ''}" onclick="switchSettingsSubTab('line')">💚 ${t('推播設定・安全鎖與稽核紀錄', 'LINE, Security & Audit', 'LINE・セキュリティ・監査', 'LINE・보안 및 감사 로그')}</button>
        </div>

        <select class="select-input" style="width:auto; padding:6px 10px; font-weight:800;" onchange="switchMerchantStore(this.value)">
          ${state.stores.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === store.id ? 'selected' : ''}>${t('切換店鋪', 'Switch Store', '店舗切替', '매장 전환')}: ${escapeHtml(trTerm(s.name))}</option>`).join('')}
        </select>
      </div>

      ${sub === 'menu' ? `
        <div class="chart-card" style="background:linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%); border:1.5px solid #C7D2FE;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div>
              <h3 style="font-size:1.02rem; font-weight:900; color:#312E81;">📸 ${t('智慧視覺菜單辨識（支援拍照上傳與穩定品項 ID 匯入）', 'AI Visual Menu Import (Photo / Text)', 'AIメニュー認識（写真・テキスト読取）', 'AI 메뉴 인식 (사진 / 텍스트 가져오기)')}</h3>
              <p style="font-size:0.78rem; color:#4338CA;">${t('上傳紙本菜單照片或貼上文字，系統將自動進行結構化解析並綁定確定性品項 ID，絕不破壞進行中訂單關聯！', 'Upload a menu photo or paste text to import items with stable IDs without affecting active orders.', 'メニュー写真またはテキストから安定ID付きで構造化インポートできます。', '메뉴 사진이나 텍스트를 붙여넣으면 진행 중인 주문에 영향 없이 자동 등록됩니다.')}</p>
            </div>
            <label style="background:#4F46E5; color:#FFFFFF; padding:8px 14px; border-radius:10px; font-size:0.82rem; font-weight:800; cursor:pointer; box-shadow:0 4px 12px rgba(79,70,229,0.25);">
              📷 ${t('拍照 / 上傳菜單圖片', 'Upload Menu Photo', 'メニュー写真をアップロード', '메뉴 사진 업로드')}
              <input type="file" id="aiMenuImageInput" accept="image/*" style="display:none;" onchange="handleMenuImageUpload(event)">
            </label>
          </div>

          <textarea id="aiMenuRawText" class="select-input" rows="3" placeholder="${t('或在此直接貼上菜單文字（例如：招牌牛肉麵 120 (加麵+15/小辣)、紅油抄手 65、燙青菜 40）...', 'Or paste menu text here (e.g. Beef Noodles 120, Wonton 65)...', 'メニューテキストを貼り付け（例：牛肉麺 120）...', '메뉴 텍스트를 여기에 붙여넣으세요 (예: 소고기 국수 120)...')}" style="background:#FFFFFF; margin-bottom:8px; font-size:0.84rem;"></textarea>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn-tip-action" style="background:#4F46E5;" onclick="runAiMenuRecognition()">✨ ${t('執行結構化解析與預覽', 'Parse & Preview', '解析してプレビュー', '파싱 및 미리보기')}</button>
            <button type="button" class="filter-chip" onclick="loadSampleMenuTextForAi()">📋 ${t('載入範例新菜單測試', 'Load Sample Menu', 'サンプル読込', '샘플 메뉴 불러오기')}</button>
          </div>
          <div id="aiScannedPreviewArea" style="display:none; margin-top:12px;"></div>
        </div>

        <div class="chart-card">
          <h3 style="font-size:0.98rem; font-weight:900; margin-bottom:10px;">➕ ${t(`手動新增單一品項至「${store.name}」`, `Add Menu Item to ${trTerm(store.name)}`, `${trTerm(store.name)}にメニューを追加`, `${trTerm(store.name)}에 메뉴 추가`)}</h3>
          <div style="display:grid; grid-template-columns:0.9fr 1.3fr 0.65fr 0.65fr 0.9fr 1.2fr auto; gap:8px; align-items:end;">
            <div>
              <label class="field-label">${t('分類', 'Category', 'カテゴリ', '카테고리')}</label>
              <input type="text" id="newMenuCat" class="select-input" placeholder="${t('如：主廚推薦', 'e.g. Mains', '例：メイン', '예: 메인')}" value="${escapeHtml(t('主廚推薦', 'Mains', 'おすすめ', '추천 메뉴'))}">
            </div>
            <div>
              <label class="field-label">${t('餐點名稱 *', 'Dish Name *', '商品名 *', '메뉴명 *')}</label>
              <input type="text" id="newMenuName" class="select-input" placeholder="${t('如：香煎雞腿便當', 'e.g. Chicken Bento', '例：チキン弁当', '예: 치킨 도시락')}">
            </div>
            <div>
              <label class="field-label">${t('價格 *', 'Price *', '価格 *', '가격 *')}</label>
              <input type="number" id="newMenuPrice" class="select-input" placeholder="110">
            </div>
            <div>
              <label class="field-label">${t('每日限量', 'Daily Limit', '日次上限', '일일 한정')}</label>
              <input type="number" id="newMenuDailyLimit" class="select-input" min="0" placeholder="${t('0=不限', '0=Unlimited', '0=無制限', '0=무제한')}" value="0">
            </div>
            <div>
              <label class="field-label">${t('推薦標籤', 'Badge Tag', 'タグ', '추천 태그')}</label>
              <input type="text" id="newMenuTag" class="select-input" placeholder="${t('🔥 店長推薦', '🔥 Popular', '🔥 人気', '🔥 인기')}">
            </div>
            <div>
              <label class="field-label">${t('客製選項 (逗號分隔)', 'Options (comma)', 'オプション(カンマ区切)', '옵션 (쉼표 구분)')}</label>
              <input type="text" id="newMenuOpts" class="select-input" placeholder="${t('正常, 飯少', 'Regular, Less Rice', '普通, ご飯少なめ', '보통, 밥 적게')}">
            </div>
            <button type="button" class="btn-tip-action" style="height:40px;" onclick="addManualMenuItem()">＋ ${t('新增', 'Add', '追加', '추가')}</button>
          </div>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
            <h3 style="font-size:0.98rem; font-weight:900;">📋 ${t(`目前架上菜單（共 ${menus.length} 道，支援每日限量自動扣減售罄與客製加料規則）`, `Active Menu (${menus.length} items · daily limits & modifiers)`, `登録メニュー（全${menus.length}品）`, `현재 메뉴 (총 ${menus.length}개)`)}</h3>
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
                <div style="font-size:0.78rem; font-weight:900; color:#92400E; margin-bottom:6px;">⚡ ${t('批次加料售罄開關（點擊一次即同步全店所有含該加料的主餐）', 'Bulk Modifier Sold-Out Toggle (Applies to all dishes using this add-on)', 'トッピング一括品切れ切替', '토핑 일괄 품절 스위치')}</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                  ${sharedMods.map(([cName, info]) => {
                    const allOut = info.soldOut >= info.total;
                    return `<button type="button" onclick="bulkToggleModifierChoiceSoldOut(${escapeJsAttr(cName)})" style="border:1px solid ${allOut ? '#EF4444' : '#D97706'}; background:${allOut ? '#FEE2E2' : '#FFFFFF'}; color:${allOut ? '#B91C1C' : '#92400E'}; padding:4px 10px; border-radius:999px; font-size:0.74rem; font-weight:800;">${allOut ? '🚫 ' : '🟢 '}<span data-dish-name="1">${escapeHtml(trTerm(cName))}</span> (${info.total})${allOut ? ` [${t('已售罄', 'Sold Out', '売切', '품절')}]` : ''}</button>`;
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
                      <span style="font-size:0.7rem; font-weight:800; color:var(--brand-dark); background:var(--brand-light); padding:2px 6px; border-radius:4px;">${escapeHtml(trTerm(m.category || '主餐'))}</span>
                      ${isSoldOut ? `<span class="sold-out-ribbon" style="${m.soldOutType === 'PERMANENT' ? 'background:#DC2626;' : 'background:#D97706;'}">${m.soldOutType === 'PERMANENT' ? t('長期缺貨', 'Out of Stock', '長期品切', '장기 품절') : t('本日售完', 'Sold Out Today', '本日完売', '오늘 품절')}</span>` : (m.tag ? `<span data-dish-name="1" style="font-size:0.68rem; font-weight:800; color:#4338CA; background:#EEF2FF; padding:2px 6px; border-radius:4px;">${escapeHtml(trTerm(m.tag))}</span>` : '')}
                      ${dLimit > 0 ? `<span style="font-size:0.68rem; font-weight:900; color:#DC2626; background:#FEE2E2; padding:2px 6px; border-radius:4px;">📦 ${t(`限量 ${dLimit} 份`, `Limit ${dLimit}`, `限定${dLimit}`, `한정 ${dLimit}`)}${m.remainingToday !== null && m.remainingToday !== undefined ? ` (${t('剩', 'Left', '残', '잔여')}:${m.remainingToday})` : ''}</span>` : ''}
                      <span style="font-size:0.68rem; color:var(--text-secondary); font-weight:700;">⚙️ ${optCount} ${t('組選項', 'opts', 'オプション', '옵션')} (ID:${escapeHtml(m.id)})</span>
                    </div>
                    <div data-dish-name="1" style="font-weight:900; font-size:0.92rem; margin-top:4px; color:var(--text-primary);">${escapeHtml(trDishName(m))}</div>
                  </div>
                  <div style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
                    <span style="font-size:0.8rem; font-weight:800;">$</span>
                    <input type="number" value="${m.price}" onchange="updateMenuItemPrice(${idx}, this.value)" style="width:58px; padding:4px 6px; border:1px solid var(--border); border-radius:6px; font-weight:900;">
                    <button type="button" onclick="toggleMenuItemSoldOut(${idx})" style="border:1px solid ${isSoldOut ? '#10B981' : '#CBD5E1'}; background:${isSoldOut ? '#DCFCE7' : '#FFFFFF'}; color:${isSoldOut ? '#065F46' : '#475569'}; padding:5px 7px; border-radius:6px; font-weight:800; font-size:0.74rem;">
                      ${isSoldOut ? t('上架', 'Restock', '販売再開', '재입고') : t('售罄', 'Sold Out', '売切', '품절')}
                    </button>
                    <button type="button" onclick="openMenuEditModal(${idx})" style="border:1px solid #C7D2FE; background:#EEF2FF; color:#312E81; padding:5px 8px; border-radius:6px; font-weight:800; font-size:0.76rem;">✏️ ${t('編輯', 'Edit', '編集', '수정')}</button>
                    <button type="button" onclick="deleteMenuItem(${idx})" style="border:none; background:#FEE2E2; color:#DC2626; padding:5px 8px; border-radius:6px; font-weight:800; font-size:0.76rem;">${t('刪', 'Del', '削除', '삭제')}</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${sub === 'promo' ? `
        <div class="chart-card">
          <h3 style="font-size:1.05rem; font-weight:900; margin-bottom:6px;">🥢 ${t(`營業狀態・基礎出餐時間・預訂備餐前置・餐具與離峰優惠設定（${store.name}）`, `Store Status, Prep Capacity, Cutlery & Promos (${trTerm(store.name)})`, `営業状態・調理時間・カトラリー・割引設定（${trTerm(store.name)}）`, `영업 상태・조리 시간・수저 및 할인 설정 (${trTerm(store.name)})`)}</h3>
          <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:16px;">
            ${t('可在此調整每 15 分鐘餐點份數產能上限、預訂單自動推入廚房前置時間與離峰折抵/招待優惠。', 'Adjust 15-min order capacity, pre-order kitchen auto-fire lead time, cutlery fees, and promotional discounts.', '15分あたりの生産上限、予約自動開始時間、カトラリー代や割引ルールを設定します。', '15분당 생산 정원, 예약 자동 투입 시간, 수저 요금 및 할인 규칙을 설정하세요.')}
          </p>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:16px;">
            <div>
              <label class="field-label">🏪 ${t('本店目前營業狀態', 'Current Store Status', '現在の営業状態', '현재 매장 영업 상태')}</label>
              <select id="cfgStoreIsOpen" class="select-input">
                <option value="true" ${store.isOpen !== false ? 'selected' : ''}>🟢 ${t('正常營業中 (營業時間開放立即製作，打烊後自動開放預訂)', 'Open (Make Now during hours, Pre-order after closing)', '通常営業中（営業時間外は自動で予約受付）', '정상 영업 중 (마감 후 자동 예약 허용)')}</option>
                <option value="false" ${store.isOpen === false ? 'selected' : ''}>⛔ ${t('暫停營業（全面停止現場點餐與預訂）', 'Paused (Stops ALL Ordering & Pre-orders)', '営業休止（注文・予約すべて停止）', '영업 중지 (모든 주문 및 예약 중단)')}</option>
              </select>
              <div style="font-size:0.72rem; color:var(--text-secondary); margin-top:4px; line-height:1.4;">
                💡 ${t('「已打烊」會依營業時間自動切換並開放預訂；「暫停營業」則會完全關閉點餐與預訂。', '"Closed" follows business hours and allows pre-orders; "Paused" disables all ordering immediately.', '「営業時間外」は予約可、「営業休止」は全注文を停止します。', '"영업 종료"는 예약이 가능하며, "영업 중지"는 모든 주문과 예약을 차단합니다.')}
              </div>
            </div>

            <div>
              <label class="field-label" style="color:var(--brand-dark);">🥢 ${t('一次性免洗餐具收費金額 (NT$)', 'Disposable Cutlery Fee (NT$)', 'カトラリー料金 (NT$)', '일회용 수저 요금 (NT$)')}</label>
              <input type="number" id="cfgCutleryPrice" class="select-input" min="0" max="50" value="${storeCutleryPrice}">
            </div>

            <div>
              <label class="field-label">⏱️ ${t('空閒時基礎出餐時間 (分鐘)', 'Base Prep Time (min)', '基本調理時間 (分)', '기본 조리 시간 (분)')}</label>
              <input type="number" id="cfgBasePrepMin" class="select-input" min="1" max="25" value="${store.basePrepMinutes || 4}">
            </div>

            <div>
              <label class="field-label">🔥 ${t('每 15 分鐘產能與預訂配額上限 (份數)', 'Max Capacity per 15 Min (portions)', '15分あたりの上限 (食数)', '15분당 최대 생산량 (수량)')}</label>
              <input type="number" id="cfgMaxCap" class="select-input" min="5" max="200" value="${store.maxCapacityPer15Min}">
            </div>

            <div>
              <label class="field-label">📅 ${t('預訂單提前自動推入廚房時間 (分鐘)', 'Pre-order Auto-Fire Lead Time (min)', '予約自動調理開始 (分前)', '예약 자동 조리 투입 (분 전)')}</label>
              <input type="number" id="cfgReserveLeadMins" class="select-input" min="10" max="90" value="${store.reserveLeadMinutes || 25}">
            </div>

            <div>
              <label class="field-label">🎁 ${t('行銷優惠模式', 'Promotion Mode', '割引・プロモーション', '프로모션 모드')}</label>
              <select id="cfgPromoMode" class="select-input">
                <option value="none" ${store.promoMode === 'none' ? 'selected' : ''}>${t('關閉優惠', 'Disabled', '無効', '사용 안 함')}</option>
                <option value="gift" ${(store.promoMode === 'gift' || store.promoMode === 'freebie') ? 'selected' : ''}>🎁 ${t('滿額贈送指定餐點 / 飲品', 'Free Gift Over Minimum', '金額達成で無料特典', '기준 금액 이상 사은품')}</option>
                <option value="discount" ${store.promoMode === 'discount' ? 'selected' : ''}>💸 ${t('滿額現金現折', 'Cash Discount Over Minimum', '金額達成で現金割引', '기준 금액 이상 할인')}</option>
                <option value="second_discount" ${store.promoMode === 'second_discount' ? 'selected' : ''}>✌️ ${t('第二件折價 (每 2 件折抵)', '2nd Item Discount', '2点目割引', '2번째 메뉴 할인')}</option>
              </select>
            </div>

            <div>
              <label class="field-label">🕒 ${t('優惠適用時段', 'Promo Active Window', '割引適用時間帯', '할인 적용 시간대')}</label>
              <select id="cfgPromoScope" class="select-input">
                <option value="OFF_PEAK" ${store.promoScope !== 'ALL_DAY' ? 'selected' : ''}>🟢 ${t('僅離峰順暢時段適用 (分流專用)', 'Off-Peak Only', 'オフピークのみ', '비혼잡 시간대 전용')}</option>
                <option value="ALL_DAY" ${store.promoScope === 'ALL_DAY' ? 'selected' : ''}>🌟 ${t('全天候營業時段皆適用', 'All Day', '終日適用', '전일 적용')}</option>
              </select>
            </div>

            <div>
              <label class="field-label">💰 ${t('優惠最低消費門檻 (NT$)', 'Min Spend Threshold (NT$)', '最低利用金額 (NT$)', '최소 주문 금액 (NT$)')}</label>
              <input type="number" id="cfgPromoMinSubtotal" class="select-input" min="0" max="1000" value="${store.promoMinSubtotal !== undefined ? Number(store.promoMinSubtotal) : AI_DISCOUNT_MIN_SUBTOTAL}">
            </div>

            <div>
              <label class="field-label">🏷️ ${t('優惠顯示文案', 'Promo Banner Text', '割引表示テキスト', '프로모션 안내 문구')}</label>
              <input type="text" id="cfgPromoText" class="select-input" value="${escapeHtml(store.promoText || '')}" placeholder="${t('例：🎁 滿百贈招牌紅茶', 'e.g. Free Tea over $100', '例：100元以上で紅茶無料', '예: $100 이상 음료 무료')}">
            </div>

            <div>
              <label class="field-label">💸 ${t('現金折抵 / 第二件折抵金額 (NT$)', 'Discount Amount (NT$)', '割引額 (NT$)', '할인 금액 (NT$)')}</label>
              <input type="number" id="cfgPromoDiscount" class="select-input" min="0" max="200" value="${store.promoDiscount || store.secondItemDiscount || 0}">
            </div>

            <div>
              <label class="field-label">🎁 ${t('指定贈品品項（滿額贈送專用・售罄自動停贈）', 'Gift Item (Auto-pauses when sold out)', '無料特典メニュー', '사은품 지정 메뉴')}</label>
              <select id="cfgGiftMenuItemId" class="select-input">
                <option value="">${t('（不指定特定品項，依文案顯示）', '(None selected — show banner only)', '（指定なし）', '(지정 안 함)')}</option>
                ${menus.map(m => `<option data-dish-name="1" value="${escapeHtml(m.id)}" ${String(store.giftMenuItemId || '') === String(m.id) ? 'selected' : ''}>${escapeHtml(trDishName(m))} (NT$${m.price})${m.soldOut ? ' [Out]' : ''}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="field-label">🪑 ${t('內用掃碼「餐後結帳」模式', 'Dine-in Pay After Meal Mode', '店内後払いモード', '매장 식사 후불 모드')}</label>
              <select id="cfgAllowDineInPostPay" class="select-input">
                <option value="false" ${!store.allowDineInPostPay ? 'selected' : ''}>${t('關閉（學生須先付或取餐付現）', 'Off (Prepay or cash at pickup)', 'オフ（事前決済または受取時払い）', '꺼짐 (선결제 또는 픽업 결제)')}</option>
                <option value="true" ${store.allowDineInPostPay ? 'selected' : ''}>✅ ${t('開啟內用餐後至櫃檯結帳', 'Enabled (Pay at counter after meal)', 'オン（食後にレジで会計）', '켜짐 (식사 후 카운터 결제)')}</option>
              </select>
            </div>

            <div>
              <label class="field-label">💳 ${t('LINE Pay 金流手續費率 (%)（供實拿淨額分析）', 'LINE Pay Fee Rate (%) for Net Analytics', 'LINE Pay 手数料率 (%)', 'LINE Pay 수수료율 (%)')}</label>
              <input type="number" step="0.1" min="0" max="20" id="cfgLinePayFeeRate" class="select-input" value="${store.linePayFeeRate !== undefined ? Number(store.linePayFeeRate) : 2.2}">
            </div>

            <div>
              <label class="field-label">🌅 ${t('昨日「本日售完」品項早班恢復模式', 'Morning Policy for Yesterday\'s Sold-Out Items', '翌朝の品切れ再開方式', '오전 오픈 품절 복구 방식')}</label>
              <select id="cfgMorningSoldOutPolicy" class="select-input">
                <option value="ASK_MORNING" ${store.morningSoldOutPolicy !== 'AUTO_RESTORE' ? 'selected' : ''}>🔔 ${t('每日早班開機自動跳出詢問上架（推薦）', 'Prompt morning staff to review & restock (Recommended)', '翌朝に確認ダイアログを表示（推奨）', '오전 오픈 시 재입고 확인창 표시 (권장)')}</option>
                <option value="AUTO_RESTORE" ${store.morningSoldOutPolicy === 'AUTO_RESTORE' ? 'selected' : ''}>🔄 ${t('隔日自動全部重新上架（長期缺貨除外）', 'Auto-restock all "Today Out" items next day', '翌日自動で再販売（長期品切を除く）', '다음날 자동 재입고 (장기 품절 제외)')}</option>
              </select>
            </div>

            <div>
              <label class="field-label">📱 ${t('學生端開放線上 LINE Pay 預付', 'Student Online LINE Pay Prepayment', '学生画面のオンラインLINE Pay', '학생 온라인 LINE Pay 선결제')}</label>
              <select id="cfgEnableOnlineLinePay" class="select-input">
                <option value="false" ${store.enableOnlineLinePay !== true ? 'selected' : ''}>💵 ${t('關閉（學生端僅顯示「現場付款：現金 / 現場掃 LINE Pay」）', 'Off — Show "Pay at Counter (Cash / Counter LINE Pay)"', 'オフ（店頭払いのみ表示：現金／店頭LINE Pay）', '꺼짐 (현장 결제만 표시: 현금/현장 LINE Pay)')}</option>
                <option value="true" ${store.enableOnlineLinePay === true ? 'selected' : ''}>💚 ${t('開啟（須先完成 LINE Pay 商家線上金流審核串接）', 'On — Enable Online LINE Pay Checkout', 'オン（オンラインLINE Pay決済を有効化）', '켜짐 (온라인 LINE Pay 결제 활성화)')}</option>
              </select>
            </div>
          </div>

          <!-- B7：組合搭配折扣規則（例：買雞排 + 飲料 折 $5） -->
          <div style="background:#ECFDF5; border:1.5px solid #6EE7B7; border-radius:12px; padding:12px; margin-bottom:14px;">
            <div style="font-size:0.88rem; font-weight:950; color:#065F46; margin-bottom:4px;">🎁 ${t('組合搭配折扣規則（例：買雞排 + 飲料 折 $5，學生端與 POS 自動計算）', 'Combo / Bundle Discount Rules (e.g. Chicken Cutlet + Drink -$5)', 'セット割引ルール（例：チキン＋ドリンクで$5引き）', '세트 할인 규칙 (예: 치킨 + 음료 -$5)')}</div>
            <div style="font-size:0.74rem; color:#047857; margin-bottom:8px;">
              ${t('條件 A / B 可填餐點名稱關鍵字（如：雞排）或分類名稱（如：飲料類、飲品），多組關鍵字可用 / 分隔（如：飲料類/紅茶/奶茶）。', 'Match A / B supports dish keywords (e.g. Chicken) or category names (e.g. Drinks), separated by / for multiple.', '条件A/Bには商品名またはカテゴリ名を入力できます（/区切りで複数可）。', '조건 A/B에 메뉴명 또는 카테고리명을 입력하세요 (/로 여러 개 지정 가능).')}
            </div>
            <div style="display:grid; grid-template-columns:1.1fr 1fr 1fr 0.65fr auto; gap:6px; align-items:end; margin-bottom:10px;">
              <div>
                <label class="field-label">${t('活動名稱 *', 'Deal Name *', '割引名 *', '할인명 *')}</label>
                <input type="text" id="newComboNameInput" maxlength="32" class="select-input" placeholder="${t('例：雞排+飲料折5元', 'e.g. Cutlet + Drink -$5')}">
              </div>
              <div>
                <label class="field-label">${t('條件 A (品名或分類) *', 'Match A (Dish/Cat) *', '条件A *', '조건 A *')}</label>
                <input type="text" id="newComboMatchAInput" maxlength="32" class="select-input" placeholder="${t('例：雞排', 'e.g. Cutlet')}">
              </div>
              <div>
                <label class="field-label">${t('條件 B (品名或分類) *', 'Match B (Dish/Cat) *', '条件B *', '조건 B *')}</label>
                <input type="text" id="newComboMatchBInput" maxlength="32" class="select-input" placeholder="${t('例：飲料類/飲品', 'e.g. Drinks')}">
              </div>
              <div>
                <label class="field-label">${t('每組折 ($)', 'Off ($)', '割引 ($)', '할인 ($)')}</label>
                <input type="number" id="newComboAmtInput" class="select-input" min="1" max="500" value="5">
              </div>
              <button type="button" class="btn-tip-action" style="height:38px; background:#059669;" onclick="addStoreComboDiscount()">＋ ${t('新增', 'Add', '追加', '추가')}</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${(Array.isArray(store.comboDiscounts) && store.comboDiscounts.length > 0) ? store.comboDiscounts.map((r, rIdx) => `
                <div style="display:inline-flex; align-items:center; gap:6px; background:#FFFFFF; border:1px solid #34D399; padding:5px 10px; border-radius:999px; font-size:0.78rem; font-weight:850; color:#065F46;">
                  <span>🎁 ${escapeHtml(r.name || `${r.matchA} + ${r.matchB}`)}</span>
                  <span style="font-size:0.72rem; color:#047857;">[${escapeHtml(r.matchA)} + ${escapeHtml(r.matchB)} ➔ -NT$${r.discountAmount}]</span>
                  <button type="button" onclick="deleteStoreComboDiscount(${rIdx})" style="border:none; background:transparent; color:var(--red); font-weight:900; cursor:pointer;">✕</button>
                </div>
              `).join('') : `<span style="font-size:0.76rem; color:#047857;">${t('目前尚未建立組合折扣（新增後請點下方「儲存設定」同步雲端）', 'No combo deals yet. Add one and click Save below.', 'セット割引は未登録です。', '등록된 세트 할인이 없습니다.')}</span>`}
            </div>
          </div>

          <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:12px; padding:12px; margin-bottom:14px;">
            <div style="font-size:0.86rem; font-weight:900; color:var(--indigo); margin-bottom:8px;">🎟️ ${t('本店專屬優惠券 / 折扣碼管理（學生於購物車輸入立即核實折抵）', 'Store Coupon / Promo Code Manager', 'クーポン・割引コード管理', '매장 전용 쿠폰 / 할인코드 관리')}</div>
            <div style="display:grid; grid-template-columns:1fr 0.85fr 0.7fr 0.75fr auto; gap:6px; align-items:end; margin-bottom:10px;">
              <div>
                <label class="field-label">${t('折扣碼 *', 'Code *', 'コード *', '할인코드 *')}</label>
                <input type="text" id="newCouponCodeInput" maxlength="20" class="select-input" style="text-transform:uppercase; font-family:monospace;" placeholder="SCU15">
              </div>
              <div>
                <label class="field-label">${t('類型', 'Type', '種類', '유형')}</label>
                <select id="newCouponTypeSelect" class="select-input">
                  <option value="AMOUNT">${t('折現金 ($)', 'Fixed ($)', '金額割引 ($)', '정액 할인 ($)')}</option>
                  <option value="PERCENT">${t('打折 (% off)', 'Percent (% off)', '割合割引 (%)', '정률 할인 (%)')}</option>
                </select>
              </div>
              <div>
                <label class="field-label">${t('面額/折數', 'Value', '割引値', '할인값')}</label>
                <input type="number" id="newCouponValInput" class="select-input" min="1" value="15">
              </div>
              <div>
                <label class="field-label">${t('低消 ($)', 'Min ($)', '最低額 ($)', '최소 ($)')}</label>
                <input type="number" id="newCouponMinInput" class="select-input" min="0" value="80">
              </div>
              <button type="button" class="btn-tip-action" style="height:38px;" onclick="addStoreCouponItem()">＋ ${t('新增', 'Add', '追加', '추가')}</button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${(Array.isArray(store.coupons) && store.coupons.length > 0) ? store.coupons.map((c, cIdx) => `
                <div style="display:inline-flex; align-items:center; gap:6px; background:#FFFFFF; border:1px solid #C7D2FE; padding:4px 10px; border-radius:999px; font-size:0.76rem; font-weight:800;">
                  <span style="font-family:monospace; color:#4338CA;">${escapeHtml(c.code)}</span>
                  <span>${c.type === 'PERCENT' ? `-${c.value}%` : `-NT$${c.value}`} (${t('滿', 'Min ', '最低', '최소')}$${c.minSubtotal || 0})</span>
                  <button type="button" onclick="deleteStoreCouponItem(${cIdx})" style="border:none; background:transparent; color:var(--red); font-weight:900; cursor:pointer;">✕</button>
                </div>
              `).join('') : `<span style="font-size:0.76rem; color:var(--text-muted);">${t('目前尚未建立優惠券（新增後請點下方「儲存設定」）', 'No coupons yet. Add one and click Save below.', 'クーポン未登録です。', '등록된 쿠폰이 없습니다.')}</span>`}
            </div>
          </div>

          <button type="button" class="btn-primary-full" style="max-width:340px;" onclick="saveMerchantConfig()">💾 ${t('儲存營業狀態、行銷優惠與優惠券設定', 'Save Status, Promos & Coupons', '営業・割引・クーポン設定を保存', '영업 상태・할인・쿠폰 저장')}</button>
        </div>
      ` : ''}

      ${sub === 'storeProfile' ? `
        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
            <div>
              <h3 style="font-size:1.05rem; font-weight:900;">🏪 ${t(`編輯餐廳基本資料・代表圖示・營業時間與公休日（${store.name} / ${store.id}）`, `Store Profile, Hours & Holidays (${trTerm(store.name)} / ${store.id})`, `店舗基本情報・営業時間・定休日（${trTerm(store.name)} / ${store.id}）`, `매장 기본 정보・영업시간・휴무일 (${trTerm(store.name)} / ${store.id})`)}</h3>
              <p style="font-size:0.78rem; color:var(--text-secondary);">${t('支援動態修改店名、所屬校區、營業時間、午休時段與每週公休日，免改程式碼即可即時更新全站預訂時段！', 'Edit store name, campus, hours, break window, and weekly closed days live without changing code.', '店名・キャンパス・営業時間・休憩・定休日をリアルタイム更新できます。', '매장명, 캠퍼스, 영업시간, 휴게시간 및 정기 휴무일을 즉시 수정할 수 있습니다.')}</p>
            </div>
            <button type="button" class="btn-danger-soft" onclick="deleteCurrentMerchantStore()">🗑️ ${t('刪除此餐廳櫃位', 'Delete Store', 'この店舗を削除', '이 매장 삭제')}</button>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:16px;">
            <div>
              <label class="field-label">🏫 ${t('所屬校區 (可自由輸入新校區)', 'Campus', 'キャンパス', '소속 캠퍼스')}</label>
              <input type="text" id="cfgProfileCampus" class="select-input" value="${escapeHtml(store.campus || '雙溪校區')}" placeholder="${t('如：雙溪校區、城中校區', 'e.g. Waishuanghsi Campus', '例：双渓キャンパス', '예: 솽시 캠퍼스')}">
            </div>
            <div>
              <label class="field-label">🏷️ ${t('餐廳名稱 *', 'Store Name *', '店舗名 *', '매장명 *')}</label>
              <input type="text" id="cfgProfileName" class="select-input" value="${escapeHtml(store.name || '')}" placeholder="${t('如：趙班長海苔飯捲', 'Store name', '店舗名', '매장명')}">
            </div>
            <div>
              <label class="field-label">🍜 ${t('餐點類型標語', 'Cuisine Tagline', '料理カテゴリ', '음식 카테고리')}</label>
              <input type="text" id="cfgProfileCategory" class="select-input" value="${escapeHtml(store.category || '')}" placeholder="${t('如：人氣韓式・飯捲', 'e.g. Korean Kimbap', '例：韓国キンパ', '예: 김밥・분식')}">
            </div>
            <div>
              <label class="field-label">🎨 ${t('餐廳代表圖示 (Emoji 或圖片網址)', 'Store Icon (Emoji or Image URL)', '店舗アイコン (絵文字/URL)', '매장 아이콘 (이모지 또는 URL)')}</label>
              <input type="text" id="cfgProfileIcon" class="select-input" value="${escapeHtml(store.icon || STORE_ICONS[store.id] || '🍱')}" placeholder="🍙, 🍱, https://...">
            </div>
            <div>
              <label class="field-label">🌅 ${t('平日預設開始營業時間', 'Default Opening Time', '基本開店時刻', '기본 오픈 시간')}</label>
              <input type="time" id="cfgProfileOpenTime" class="select-input" value="${escapeHtml(store.openTime || '10:30')}">
            </div>
            <div>
              <label class="field-label">🌙 ${t('平日預設結束營業時間', 'Default Closing Time', '基本閉店時刻', '기본 마감 시간')}</label>
              <input type="time" id="cfgProfileCloseTime" class="select-input" value="${escapeHtml(store.closeTime || '19:30')}">
            </div>
            <div>
              <label class="field-label">☕ ${t('午休開始時間 (選填，無午休留空)', 'Break Start (Optional)', '休憩開始 (任意)', '휴게 시작 (선택)')}</label>
              <input type="time" id="cfgProfileBreakStart" class="select-input" value="${escapeHtml(store.breakStartTime || '')}">
            </div>
            <div>
              <label class="field-label">🔔 ${t('午休結束時間 (選填)', 'Break End (Optional)', '休憩終了 (任意)', '휴게 종료 (선택)')}</label>
              <input type="time" id="cfgProfileBreakEnd" class="select-input" value="${escapeHtml(store.breakEndTime || '')}">
            </div>
          </div>

          <!-- B4 + B8：各星期獨立營業時間與每週固定公休視覺化設定（支援週六較短營業時間，儲存後 100% 持久化回顯） -->
          <div style="background:#F8FAFC; border:1.5px solid #CBD5E1; border-radius:12px; padding:12px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
              <div>
                <div style="font-size:0.9rem; font-weight:950; color:#0F172A;">📅 ${t('各星期獨立營業時間與每週固定公休設定', 'Per-Weekday Opening Hours & Weekly Closed Days', '曜日別営業時間・定休日設定', '요일별 영업시간 및 정기 휴무일 설정')}</div>
                <div style="font-size:0.74rem; color:var(--text-secondary);">${t('可為星期六等特定日期單獨設定較短營業時間（如 10:30~15:00），勾選「公休」即設為每週固定公休日。', 'Set custom hours for any weekday (e.g. shorter Saturday hours) and check "Closed" for weekly holidays.')}</div>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" class="pos-chip-btn" style="padding:4px 9px; font-size:0.72rem;" onclick="applyWeekdayDefaultHoursPreset()">⚡ ${t('套用上方時間至一～五', 'Copy to Mon-Fri')}</button>
                <button type="button" class="pos-chip-btn" style="padding:4px 9px; font-size:0.72rem; background:#FFFBEB; color:#B45309; border-color:#F59E0B;" onclick="applySaturdayShortHoursPreset()">☀️ ${t('週六改 10:30~15:00', 'Sat 10:30-15:00')}</button>
              </div>
            </div>
            <div class="weekly-hours-grid">
              ${(function () {
                const dayNames = [
                  [1, t('週一', 'Mon', '月', '월')],
                  [2, t('週二', 'Tue', '火', '화')],
                  [3, t('週三', 'Wed', '水', '수')],
                  [4, t('週四', 'Thu', '木', '목')],
                  [5, t('週五', 'Fri', '金', '금')],
                  [6, t('週六', 'Sat', '土', '토')],
                  [0, t('週日', 'Sun', '日', '일')]
                ];
                const closedArr = typeof normalizeClosedDaysListClient === 'function' ? normalizeClosedDaysListClient(store.closedDays) : [];
                const whMap = (store.weeklyHours && typeof store.weeklyHours === 'object') ? store.weeklyHours : {};
                return dayNames.map(([dIdx, dLabel]) => {
                  const cfg = whMap[String(dIdx)] || whMap[dIdx] || {};
                  const isClosed = cfg.closed === true || closedArr.includes(dIdx);
                  const dOpen = cfg.open || store.openTime || '10:30';
                  const dClose = cfg.close || store.closeTime || '19:30';
                  return `
                    <div class="weekly-day-card ${isClosed ? 'is-closed' : ''}" id="weeklyDayCard_${dIdx}">
                      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <strong style="font-size:0.86rem; color:${isClosed ? '#B91C1C' : '#0F172A'};">${escapeHtml(dLabel)}</strong>
                        <label style="display:inline-flex; align-items:center; gap:4px; font-size:0.74rem; font-weight:850; color:${isClosed ? '#DC2626' : '#475569'}; cursor:pointer;">
                          <input type="checkbox" class="weekly-day-closed-chk" data-day="${dIdx}" ${isClosed ? 'checked' : ''} onchange="toggleWeeklyDayClosedUi(${dIdx}, this.checked)" style="width:15px; height:15px; accent-color:#DC2626;">
                          <span>${t('公休', 'Closed', '休業', '휴무')}</span>
                        </label>
                      </div>
                      <div style="display:grid; grid-template-columns:1fr auto 1fr; gap:4px; align-items:center; opacity:${isClosed ? '0.45' : '1'};">
                        <input type="time" id="weeklyOpen_${dIdx}" class="select-input" style="padding:4px 5px; font-size:0.76rem;" value="${escapeHtml(dOpen)}" ${isClosed ? 'disabled' : ''}>
                        <span style="font-size:0.72rem; color:var(--text-muted);">~</span>
                        <input type="time" id="weeklyClose_${dIdx}" class="select-input" style="padding:4px 5px; font-size:0.76rem;" value="${escapeHtml(dClose)}" ${isClosed ? 'disabled' : ''}>
                      </div>
                    </div>
                  `;
                }).join('');
              })()}
            </div>
          </div>

          <button type="button" class="btn-primary-full" style="max-width:340px;" onclick="saveStoreProfileConfig()">💾 ${t('儲存餐廳資料與各星期營業時段設定', 'Save Store Profile & Weekly Hours', '店舗情報と曜日別営業時間を保存', '매장 정보 및 요일별 영업시간 저장')}</button>
        </div>

        <!-- A7：學生端餐廳顯示控制（勾選哪些餐廳開放於學生端；僅勾選 1 間時掃碼直接進入該餐廳點餐！） -->
        <div class="chart-card" style="border:1.5px solid #818CF8; background:#EEF2FF;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
            <div>
              <h3 style="font-size:1.02rem; font-weight:950; color:#312E81;">👁️ ${t('學生端餐廳顯示控制（選擇哪些餐廳開放給學生點餐）', 'Student Storefront Visibility Control', '学生画面への店舗表示制御', '학생 화면 매장 노출 제어')}</h3>
              <p style="font-size:0.76rem; color:#4338CA; margin-top:2px;">
                ${t('僅勾選 1 間餐廳（如目前僅趙班長）時，學生掃碼將直接進入該餐廳菜單點餐；勾選 2 間以上時自動切換為校區餐廳列表。', 'When only 1 store is checked, students go straight into its menu; when 2+ stores are checked, the store directory is shown automatically.', '1店舗のみ選択すると学生QRから直接その店のメニューを開きます。2店舗以上で一覧表示します。', '1개 매장만 선택하면 학생 QR 스캔 시 해당 매장 메뉴로 바로 이동하며, 2개 이상이면 매장 목록이 표시됩니다.')}
              </p>
            </div>
            <button type="button" class="btn-tip-action" style="background:#4F46E5; padding:8px 16px;" onclick="saveStoresStudentVisibility()">💾 ${t('儲存學生端顯示設定', 'Save Visibility Settings', '表示設定を保存', '노출 설정 저장')}</button>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:8px;">
            ${state.stores.map(s => {
              const isVis = s.visibleToStudents !== false;
              return `
                <label style="display:flex; align-items:center; gap:8px; background:#FFFFFF; border:1.5px solid ${isVis ? '#4F46E5' : '#CBD5E1'}; border-radius:10px; padding:9px 12px; cursor:pointer; font-size:0.84rem; font-weight:800;">
                  <input type="checkbox" class="store-student-vis-chk" data-store-id="${escapeHtml(s.id)}" ${isVis ? 'checked' : ''} style="width:18px; height:18px; accent-color:#4F46E5;">
                  <span style="flex:1; min-width:0;">
                    <span style="font-weight:950; color:var(--text-primary);">${escapeHtml(trTerm(s.name))}</span>
                    <small style="display:block; font-size:0.7rem; color:var(--text-secondary);">${escapeHtml(trTerm(s.campus))} (${escapeHtml(s.id)})</small>
                  </span>
                </label>
              `;
            }).join('')}
          </div>
        </div>

        <div class="chart-card" style="background:#F8FAFC; border:1.5px dashed #94A3B8;">
          <h3 style="font-size:1.02rem; font-weight:900; margin-bottom:8px;">➕ ${t('新增學餐合作餐廳櫃位（須設定獨立店務 PIN 碼）', 'Add New Partner Store (Requires Store PIN)', '新規パートナー店舗を追加（専用PIN必須）', '신규 입점 매장 추가 (전용 PIN 필수)')}</h3>
          <div style="display:grid; grid-template-columns:1fr 1.2fr 1.1fr 0.6fr 1fr auto; gap:8px; align-items:end; flex-wrap:wrap;">
            <div>
              <label class="field-label">${t('所屬校區 *', 'Campus *', 'キャンパス *', '캠퍼스 *')}</label>
              <input type="text" id="newStoreCampusInput" class="select-input" value="${escapeHtml(store.campus || '雙溪校區')}" placeholder="${t('雙溪校區', 'Campus', 'キャンパス', '캠퍼스')}">
            </div>
            <div>
              <label class="field-label">${t('新餐廳名稱 *', 'New Store Name *', '新店舗名 *', '새 매장명 *')}</label>
              <input type="text" id="newStoreNameInput" class="select-input" placeholder="${t('如：阿宏鐵板燒', 'e.g. Teppanyaki', '例：鉄板焼き', '예: 철판구이')}">
            </div>
            <div>
              <label class="field-label">${t('分類說明', 'Category', 'カテゴリ', '카테고리')}</label>
              <input type="text" id="newStoreCatInput" class="select-input" placeholder="${t('現炒鐵板・簡餐', 'Bento & Stir-fry', '定食・弁当', '도시락・식사')}" value="${escapeHtml(t('人氣特餐・便當', 'Bento & Meals', '人気弁当', '인기 도시락'))}">
            </div>
            <div>
              <label class="field-label">${t('圖示', 'Icon', 'アイコン', '아이콘')}</label>
              <input type="text" id="newStoreIconInput" class="select-input" value="🍱" placeholder="🍱">
            </div>
            <div>
              <label class="field-label" style="color:var(--red);">🔒 ${t('專屬管理 PIN (4~8碼) *', 'Store PIN (4-8 digits) *', '管理PIN (4〜8桁) *', '관리 PIN (4~8자리) *')}</label>
              <input type="password" id="newStorePinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="4-8 digits" value="">
            </div>
            <button type="button" class="btn-tip-action" style="height:40px;" onclick="createNewMerchantStore()">＋ ${t('建立新餐廳', 'Create Store', '店舗作成', '매장 생성')}</button>
          </div>
        </div>
      ` : ''}

      ${sub === 'line' ? `
        <div class="chart-card" style="border:1.5px solid #86EFAC; background:#F0FDF4;">
          <h3 style="font-size:1.05rem; font-weight:900; color:#065F46; margin-bottom:6px;">
            💚 ${t(`官方帳號 + 📧 電子信箱雙軌推播設定（${store.name}）`, `LINE OA + Email Dual Push Settings (${trTerm(store.name)})`, `LINE公式 + メール通知設定（${trTerm(store.name)}）`, `LINE 공식계정 + 이메일 알림 설정 (${trTerm(store.name)})`)}
          </h3>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
            <label class="option-label-row ${store.useCustomLineOa ? 'checked' : ''}" style="background:#FFFFFF; margin-bottom:0;" onclick="toggleStoreCustomLineMode(true)">
              <div style="display:flex; align-items:center; gap:10px;">
                <input type="radio" name="storeLineOaMode" ${store.useCustomLineOa ? 'checked' : ''} style="width:18px; height:18px; accent-color:#06C755;">
                <div>
                  <div style="font-weight:900; color:var(--text-primary);">🏪 ${t(`綁定「${store.name}」專屬官方帳號`, `Use Store's Own LINE OA`, `店舗専用LINE公式アカウント`, `매장 전용 LINE 공식계정`)}</div>
                  <div style="font-size:0.74rem; color:var(--text-secondary);">${t('各店獨立計算每月免費推播額度', 'Separate monthly push quota per store', '店舗ごとに月間無料枠を管理', '매장별 월간 무료 발송 한도 관리')}</div>
                </div>
              </div>
            </label>

            <label class="option-label-row ${!store.useCustomLineOa ? 'checked' : ''}" style="background:#FFFFFF; margin-bottom:0;" onclick="toggleStoreCustomLineMode(false)">
              <div style="display:flex; align-items:center; gap:10px;">
                <input type="radio" name="storeLineOaMode" ${!store.useCustomLineOa ? 'checked' : ''} style="width:18px; height:18px; accent-color:#06C755;">
                <div>
                  <div style="font-weight:900; color:var(--text-primary);">🏆 ${t('使用平台預設官方帳號 (2012260287)', 'Use Platform Default LINE OA (2012260287)', 'プラットフォーム標準公式アカウント', '플랫폼 기본 공식계정 사용 (2012260287)')}</div>
                  <div style="font-size:0.74rem; color:var(--text-secondary);">${t('免設定即可推播，並自動啟用電子信箱備援通知', 'Zero setup with automatic Email fallback alerts', '設定不要・メール通知バックアップ付き', '별도 설정 없이 이메일 백업 알림 지원')}</div>
                </div>
              </div>
            </label>
          </div>

          ${store.useCustomLineOa ? `
            <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1px solid #86EFAC; margin-bottom:12px;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                  <label class="field-label">${t('LINE 授權頻道編號', 'LINE Channel ID', 'LINEチャネルID', 'LINE 채널 ID')}</label>
                  <input type="text" id="cfgStoreLineClientId" class="select-input" placeholder="2012260287" value="${escapeHtml(store.customLineClientId || '')}">
                </div>
                <div>
                  <label class="field-label">${t('LINE 授權頻道密鑰', 'LINE Channel Secret', 'LINEチャネルシークレット', 'LINE 채널 시크릿')}</label>
                  <input type="password" id="cfgStoreLineClientSecret" class="select-input" placeholder="${t('輸入新密鑰以更新後端設定', 'Enter new secret to update', '新しいシークレットを入力', '새 시크릿 입력')}" value="">
                </div>
              </div>
              <div>
                <label class="field-label">${t('訊息推播存取權杖', 'Messaging Access Token', 'プッシュアクセストークン', '메시지 푸시 액세스 토큰')}</label>
                <input type="password" id="cfgStoreLineChannelToken" class="select-input" placeholder="${t('貼上本店推播權杖', 'Paste push token', 'プッシュトークンを貼付', '푸시 토큰 붙여넣기')}" value="">
              </div>
            </div>
          ` : `
            <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1px solid #A7F3D0; margin-bottom:12px;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                  <label class="field-label">${t('預設授權頻道編號', 'Default LINE Channel ID', '標準LINEチャネルID', '기본 LINE 채널 ID')}</label>
                  <input type="text" id="cfgSysLineClientId" class="select-input" placeholder="2012260287" value="${escapeHtml(state.lineProfile.customClientId || DEFAULT_LINE_CLIENT_ID)}">
                </div>
                <div>
                  <label class="field-label">${t('預設授權頻道密鑰', 'Default LINE Channel Secret', '標準LINEシークレット', '기본 LINE 시크릿')}</label>
                  <input type="password" id="cfgSysLineClientSecret" class="select-input" placeholder="${t('由雲端伺服器安全託管', 'Managed securely on server', 'サーバーで安全に管理', '서버에서 안전하게 관리')}">
                </div>
              </div>
              <div>
                <label class="field-label">${t('預設訊息推播存取權杖', 'Default Push Access Token', '標準プッシュトークン', '기본 푸시 액세스 토큰')}</label>
                <input type="password" id="cfgLineAccessToken" class="select-input" placeholder="${t('由雲端伺服器安全託管', 'Managed securely on server', 'サーバーで安全に管理', '서버에서 안전하게 관리')}">
              </div>
            </div>
          `}

          <div style="background:#FFFFFF; padding:14px; border-radius:12px; border:1.5px solid #06C755; margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
              <div style="font-weight:900; font-size:0.88rem; color:#065F46;">
                💳 ${t(`各店獨立 LINE Pay 商家金流串接設定（${store.name}）`, `Store LINE Pay Merchant Credentials (${trTerm(store.name)})`, `店舗別 LINE Pay 決済設定（${trTerm(store.name)}）`, `매장별 LINE Pay 결제 연동 (${trTerm(store.name)})`)}
              </div>
              <span style="font-size:0.74rem; font-weight:800; background:#DCFCE7; color:#065F46; padding:2px 8px; border-radius:999px;">
                ${store.linePayChannelId ? `✅ Channel (${escapeHtml(store.linePayChannelId)})` : `⚡ ${t('預設學餐專屬沙盒收銀台', 'Default Sandbox Mode', '標準サンドボックス', '기본 샌드박스 모드')}`}
              </span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 0.9fr; gap:10px;">
              <div>
                <label class="field-label">${t('本店 LINE Pay Channel ID (商家金流代號)', 'Store LINE Pay Channel ID', 'LINE Pay チャネルID', 'LINE Pay 채널 ID')}</label>
                <input type="text" id="cfgStoreLinePayChannelId" class="select-input" placeholder="1657000123" value="${escapeHtml(store.linePayChannelId || '')}">
              </div>
              <div>
                <label class="field-label">${t('本店 LINE Pay Channel Secret Key', 'Store LINE Pay Secret Key', 'LINE Pay シークレットキー', 'LINE Pay 시크릿 키')}</label>
                <input type="password" id="cfgStoreLinePayChannelSecret" class="select-input" placeholder="${store.hasLinePaySecret ? t('已於雲端加密託管 (輸入可更新)', 'Stored securely (enter to replace)', '暗号化保存済（更新時入力）', '암호화 보관 중 (변경 시 입력)') : 'Secret Key'}" value="">
              </div>
              <div>
                <label class="field-label">${t('金流環境模式 (Request ➔ Confirm)', 'Environment Mode', '決済環境モード', '결제 환경 모드')}</label>
                <select id="cfgStoreLinePaySandbox" class="select-input">
                  <option value="true" ${store.linePaySandbox !== false ? 'selected' : ''}>🧪 ${t('Sandbox 測試環境 / 學餐模擬授權', 'Sandbox / Test Mode', 'Sandbox テスト環境', 'Sandbox 테스트 환경')}</option>
                  <option value="false" ${store.linePaySandbox === false ? 'selected' : ''}>🏦 ${t('Production 正式環境 (真實扣款 API V3)', 'Production (Live API V3)', 'Production 本番環境', 'Production 실결제 환경')}</option>
                </select>
              </div>
            </div>
          </div>

          <button type="button" class="btn-line" style="padding:11px 18px; font-size:0.88rem;" onclick="saveLineMessagingConfig()">
            💾 ${t('儲存本店 LINE Pay 商家金流與官方帳號推播設定', 'Save LINE Pay & Messaging Settings', 'LINE Pay・通知設定を保存', 'LINE Pay 및 알림 설정 저장')}
          </button>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
            <h3 style="font-size:1.02rem; font-weight:900;">🔒 ${t('店務安全鎖・平板專屬店鋪綁定與閒置自動上鎖設定', 'POS Security Lock, Device Binding & Auto-Lock', 'POSセキュリティ・端末固定・自動ロック', 'POS 보안 잠금・기기 고정 및 자동 잠금')}</h3>
            <span style="font-size:0.75rem; font-weight:800; color:var(--green); background:var(--green-bg); padding:3px 10px; border-radius:999px;">
              🛡️ ${t(`Session 有效（範圍: ${state.merchantAuthorizedStoreScope} · 剩餘 ${remainMins} 分）`, `Active Session (Scope: ${state.merchantAuthorizedStoreScope} · ${remainMins}m left)`, `認証有効（範囲: ${state.merchantAuthorizedStoreScope}・残${remainMins}分）`, `세션 유효 (범위: ${state.merchantAuthorizedStoreScope} · ${remainMins}분 남음)`)}
            </span>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:14px; padding-bottom:14px; border-bottom:1px dashed var(--border);">
            <div>
              <label class="field-label">⏱️ ${t('POS 閒置自動上鎖時間', 'POS Auto-Lock Timeout', '自動ロック時間', 'POS 자동 잠금 시간')}</label>
              <select id="cfgAutoLockMinsSelect" class="select-input" onchange="updateMerchantAutoLockMinutes(this.value)">
                <option value="5" ${state.merchantAutoLockMinutes === 5 ? 'selected' : ''}>${t('閒置 5 分鐘自動上鎖 (高安全性)', '5 min idle (High Security)', '5分で自動ロック', '5분 유휴 시 잠금')}</option>
                <option value="15" ${state.merchantAutoLockMinutes === 15 ? 'selected' : ''}>${t('閒置 15 分鐘自動上鎖 (推薦標準)', '15 min idle (Recommended)', '15分で自動ロック (推奨)', '15분 유휴 시 잠금 (권장)')}</option>
                <option value="30" ${state.merchantAutoLockMinutes === 30 ? 'selected' : ''}>${t('閒置 30 分鐘自動上鎖', '30 min idle', '30分で自動ロック', '30분 유휴 시 잠금')}</option>
                <option value="60" ${state.merchantAutoLockMinutes === 60 ? 'selected' : ''}>${t('閒置 60 分鐘自動上鎖', '60 min idle', '60分で自動ロック', '60분 유휴 시 잠금')}</option>
              </select>
            </div>
            <div>
              <label class="field-label">📌 ${t('此平板專屬店鋪鎖定模式', 'Dedicated Store Tablet Binding', 'この端末の店舗固定', '이 태블릿 전용 매장 고정')}</label>
              <button type="button" class="btn-outline" style="width:100%; height:40px; font-weight:900; border-color:${state.boundMerchantStoreId === store.id ? 'var(--green)' : 'var(--border)'}; color:${state.boundMerchantStoreId === store.id ? 'var(--green)' : 'var(--text-primary)'};" onclick="toggleBindDeviceToCurrentStore()">
                ${state.boundMerchantStoreId === store.id
                  ? `✅ ${t(`已綁定為「${store.name}」專用機 (點此解除)`, `Bound to ${trTerm(store.name)} (Tap to Unbind)`, `${trTerm(store.name)}専用端末に設定済（解除）`, `${trTerm(store.name)} 전용 기기 (해제)`)}`
                  : `📌 ${t(`將此平板綁定為「${store.name}」專用機`, `Bind Tablet to ${trTerm(store.name)}`, `この端末を${trTerm(store.name)}専用に固定`, `이 태블릿을 ${trTerm(store.name)} 전용으로 고정`)}`}
              </button>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr auto; gap:10px; align-items:end; flex-wrap:wrap; margin-bottom:14px; padding-bottom:14px; border-bottom:1px dashed var(--border);">
            <div>
              <label class="field-label">${t(`目前舊店長 PIN (4~8碼) *`, `Current Manager PIN (4-8) *`, `現在の店長PIN *`, `현재 점장 PIN *`)}</label>
              <input type="password" id="cfgOldMerchantPinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="${t('驗證本店舊密碼', 'Current PIN', '現在のPIN', '현재 PIN')}" value="">
            </div>
            <div>
              <label class="field-label">${t(`新店長 PIN (4~8碼) *`, `New Manager PIN (4-8) *`, `新しい店長PIN *`, `새 점장 PIN *`)}</label>
              <input type="password" id="cfgMerchantPinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="${t('輸入新 4~8 位數字', '4-8 digits', '4〜8桁の数字', '4~8자리 숫자')}" value="">
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn-outline" style="height:40px;" onclick="saveNewMerchantPin()">💾 ${t('驗證並更新店長密碼', 'Update Manager PIN', '店長PINを更新', '점장 PIN 변경')}</button>
              <button type="button" class="btn-danger-soft" style="height:40px;" onclick="lockMerchantSession()">🔒 ${t('立即上鎖', 'Lock Now', '今すぐロック', '즉시 잠금')}</button>
            </div>
          </div>

          <div style="background:#EFF6FF; border:1.5px solid #93C5FD; border-radius:12px; padding:12px; margin-bottom:14px;">
            <div style="font-size:0.9rem; font-weight:950; color:#1E3A8A; margin-bottom:6px;">👥 ${t('員工分級權限與一人一碼獨立 PIN 帳號管理', 'Staff Role Permissions & Individual Per-Staff PINs', 'スタッフ個別PIN・権限管理', '직원 개별 PIN 및 권한 관리')}</div>
            <p style="font-size:0.75rem; color:#1D4ED8; margin-bottom:10px;">
              ${t('每人獨立一組 PIN，打卡登入由伺服器強制綁定真實姓名與角色並寫入打卡稽核；一般收銀員無法無授權退單或改單減價。', 'Each staff member gets a personal PIN; server enforces real staff identity and audit logging on every clock-in and action.', 'スタッフごとに個別PINを発行。出勤打刻と権限チェックをサーバーで強制記録します。', '직원별 개별 PIN 발급 시 출근 기록과 권한을 서버가 강제 검증합니다.')}
            </p>

            <!-- 一人一碼獨立帳號列表 -->
            <div style="background:#FFFFFF; border:1px solid #BFDBFE; border-radius:10px; padding:10px; margin-bottom:10px;">
              <div style="font-size:0.78rem; font-weight:900; color:#1E40AF; margin-bottom:6px;">🔑 ${t('已建立個人獨立 PIN 帳號', 'Registered Individual Staff PIN Accounts', '登録済み個別PINアカウント', '등록된 직원 개별 PIN 계정')} (${Array.isArray(store.staffAccounts) ? store.staffAccounts.length : 0})</div>
              ${Array.isArray(store.staffAccounts) && store.staffAccounts.length > 0 ? `
                <div style="display:flex; flex-direction:column; gap:5px; margin-bottom:8px;">
                  ${store.staffAccounts.map(acc => `
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; background:#F8FAFC; padding:6px 10px; border-radius:8px; border:1px solid #E2E8F0; font-size:0.8rem;">
                      <span>
                        <strong data-dish-name="1">${escapeHtml(acc.name)}</strong>
                        <span style="margin-left:5px; font-size:0.7rem; padding:1px 6px; border-radius:999px; background:${acc.role === 'MANAGER' ? '#FEF3C7' : '#DBEAFE'}; color:${acc.role === 'MANAGER' ? '#92400E' : '#1E40AF'}; font-weight:900;">${acc.role === 'MANAGER' ? t('👑 店長', '👑 Manager', '👑 店長', '👑 점장') : t('👤 收銀員', '👤 Staff', '👤 スタッフ', '👤 캐셔')}</span>
                        ${acc.active === false ? `<span style="margin-left:4px; color:var(--red); font-size:0.7rem; font-weight:900;">(${t('已停用', 'Disabled', '無効', '비활성')})</span>` : ''}
                      </span>
                      <div style="display:flex; gap:5px;">
                        <button type="button" class="pos-chip-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="toggleStaffAccountUi(${escapeJsAttr(acc.id)})">${acc.active === false ? t('啟用', 'Enable', '有効化', '활성화') : t('停用', 'Disable', '無効化', '비활성화')}</button>
                        <button type="button" class="btn-danger-soft" style="padding:3px 8px; font-size:0.72rem;" onclick="removeStaffAccountUi(${escapeJsAttr(acc.id)})">🗑️</button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `<div style="font-size:0.74rem; color:var(--text-muted); margin-bottom:8px;">${t('尚未建立個人獨立 PIN 帳號，可於下方新增「一人一碼」員工帳號。', 'No individual staff accounts yet. Add one below.', '個別PINアカウントはまだありません。', '등록된 개별 PIN 계정이 없습니다.')}</div>`}

              <div style="display:grid; grid-template-columns:1.1fr 0.85fr 0.95fr auto; gap:6px; align-items:end;">
                <div>
                  <label class="field-label">${t('員工姓名 *', 'Staff Name *', 'スタッフ名 *', '직원 이름 *')}</label>
                  <input type="text" id="newStaffAccNameInput" maxlength="20" class="select-input" style="padding:6px 8px; font-size:0.8rem;" placeholder="${t('例：陳小明', 'e.g. Alex', '例：田中', '예: 김민수')}">
                </div>
                <div>
                  <label class="field-label">${t('權限角色', 'Role', '権限', '권한 역할')}</label>
                  <select id="newStaffAccRoleSelect" class="select-input" style="padding:6px 8px; font-size:0.8rem;">
                    <option value="STAFF">👤 ${t('收銀員 (STAFF)', 'Staff', 'スタッフ', '캐셔 (STAFF)')}</option>
                    <option value="MANAGER">👑 ${t('店長 (MANAGER)', 'Manager', '店長', '점장 (MANAGER)')}</option>
                  </select>
                </div>
                <div>
                  <label class="field-label">${t('個人 PIN (4~8碼) *', 'Personal PIN *', '個別PIN *', '개인 PIN *')}</label>
                  <input type="password" id="newStaffAccPinInput" maxlength="8" inputmode="numeric" class="select-input" style="padding:6px 8px; font-size:0.8rem;" placeholder="4-8 digits">
                </div>
                <button type="button" class="btn-tip-action" style="height:36px; background:#059669; padding:0 12px; font-size:0.78rem;" onclick="addStaffAccountUi()">＋ ${t('新增', 'Add', '追加', '추가')}</button>
              </div>
            </div>

            <div style="display:grid; grid-template-columns:0.85fr 1.4fr auto; gap:8px; align-items:end; margin-bottom:8px;">
              <div>
                <label class="field-label">${t('通用收銀員 PIN (4~8碼)', 'Shared Staff PIN (4-8)', '共通スタッフPIN', '공용 캐셔 PIN')} ${store.hasStaffPin ? '✅' : ''}</label>
                <input type="password" id="cfgStaffPinInput" maxlength="8" inputmode="numeric" class="select-input" placeholder="${store.hasStaffPin ? t('留空不變', 'Leave blank to keep', '変更しない場合は空欄', '유지하려면 비워두기') : '1234'}">
              </div>
              <div>
                <label class="field-label">${t('打卡名單（逗號分隔）', 'Roster Names (comma-separated)', '出勤リスト（カンマ区切り）', '출근 명단 (쉼표 구분)')}</label>
                <input type="text" id="cfgStaffListInput" class="select-input" value="${escapeHtml(Array.isArray(store.staffList) ? store.staffList.join(', ') : t('值班店長, 早班收銀, 晚班收銀', 'Shift Manager, Morning Staff, Evening Staff', 'シフト店長, 早番レジ, 遅番レジ', '근무 점장, 오전 캐셔, 오후 캐셔'))}">
              </div>
              <button type="button" class="btn-tip-action" style="height:40px; background:#1D4ED8;" onclick="saveStaffSecurityConfig()">💾 ${t('儲存員工權限', 'Save Staff', 'スタッフ保存', '직원 권한 저장')}</button>
            </div>

            <div style="font-size:0.74rem; color:#4338CA; background:#EEF2FF; border:1px solid #C7D2FE; padding:7px 10px; border-radius:8px; font-weight:800;">
              🛠️ ${t('開發者維護通道：登入時選「開發者 (Developer)」並輸入開發者專屬 PIN（預設 999999，可於 GAS 指令碼屬性 DEVELOPER_PIN 自訂），即可免店家密碼存取全校各店。', 'Developer Access: Select "Developer" on login and enter the Developer PIN (default 999999, customizable via GAS ScriptProperty DEVELOPER_PIN).', '開発者モード：ログイン時に「開発者」を選択し専用PIN（初期値999999）を入力すると全店舗を管理できます。', '개발자 접근: 로그인 시 "개발자"를 선택하고 전용 PIN(기본값 999999)을 입력하면 모든 매장에 접근할 수 있습니다.')}
            </div>
          </div>

          <!-- B15：Windows 芯燁 XP-160II 背景自動出單機 (Print Bridge) 與三聯前後台分區設定 -->
          <div style="background:#EFF6FF; border:1.5px solid #60A5FA; border-radius:12px; padding:12px; margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
              <div style="font-size:0.9rem; font-weight:950; color:#1E3A8A;">🖨️ ${t('Windows 芯燁 XP-160II 背景自動出單機（三聯自動切紙：顧客聯 + 前台 + 後台）', 'Windows Xprinter XP-160II Silent Auto-Print Bridge (3-Slip Cut)', 'Windows 自動レシート印刷ブリッジ（3枚自動カット）', 'Windows 자동 영수증 출력 브릿지 (3장 자동 컷)')}</div>
              <span style="font-size:0.72rem; font-weight:900; background:${store.printerAutoEnabled !== false ? '#DCFCE7' : '#FEE2E2'}; color:${store.printerAutoEnabled !== false ? '#166534' : '#B91C1C'}; padding:2px 8px; border-radius:999px;">
                ${store.printerAutoEnabled !== false ? `🟢 ${t('自動佇列啟用中', 'Auto Queue ON')}` : `⏸️ ${t('已暫停自動出單', 'Auto Queue OFF')}`}
              </span>
            </div>
            <p style="font-size:0.75rem; color:#1D4ED8; margin-bottom:10px; line-height:1.45;">
              ${t('搭配電腦端「printer-bridge」背景程式，學生線上點餐或 POS 結帳後 3~5 秒內免彈視窗自動印出：① 顧客聯、② 前台工單（指定分類）、③ 後台工單（其餘分類，無品項自動略過），並響蜂鳴器與自動切紙！', 'Run printer-bridge on the Windows POS PC to silently auto-print Customer + Front + Back slips (skipping empty zones) with buzzer & auto-cut.')}
            </p>
            <div style="display:grid; grid-template-columns:0.8fr 1.6fr; gap:10px; margin-bottom:10px;">
              <div>
                <label class="field-label">⚡ ${t('新訂單自動送印', 'Auto-Print New Orders')}</label>
                <select id="cfgPrinterAutoEnabled" class="select-input">
                  <option value="true" ${store.printerAutoEnabled !== false ? 'selected' : ''}>🟢 ${t('啟用自動出單（推薦）', 'Enabled (Recommended)')}</option>
                  <option value="false" ${store.printerAutoEnabled === false ? 'selected' : ''}>⏸️ ${t('暫停自動出單', 'Paused')}</option>
                </select>
              </div>
              <div>
                <label class="field-label">🏷️ ${t('前台工單分類（逗號分隔，其餘品項自動分派至後台工單）', 'Front-Zone Categories (comma-separated; others go to Back)')}</label>
                <input type="text" id="cfgPrinterFrontCategories" class="select-input" value="${escapeHtml((Array.isArray(store.printerFrontCategories) && store.printerFrontCategories.length > 0 ? store.printerFrontCategories : ['飯捲類', '飲料類', '飲品類']).join(', '))}" placeholder="${t('飯捲類, 飲料類, 飲品類', 'Kimbap, Drinks', 'キンパ, ドリンク', '김밥, 음료')}">
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; background:#FFFFFF; border:1px solid #BFDBFE; border-radius:10px; padding:8px 12px;">
              <div style="font-size:0.76rem; color:#1E40AF;">
                🔑 <strong>Bridge Key:</strong>
                <code style="background:#EFF6FF; padding:2px 6px; border-radius:4px; font-weight:900;">${escapeHtml(store.printerBridgeKey || t('請先按右側儲存以同步產生金鑰', 'Click Save to generate key'))}</code>
              </div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" class="pos-chip-btn" style="padding:5px 10px; font-size:0.74rem; background:#EFF6FF; color:#1D4ED8; border-color:#93C5FD;" onclick="copyPrinterBridgeConfigJson()">📋 ${t('複製 config.json 設定', 'Copy config.json')}</button>
                <button type="button" class="btn-tip-action" style="padding:6px 14px; font-size:0.78rem; background:#1D4ED8;" onclick="savePrinterBridgeConfig()">💾 ${t('儲存出單機分區設定', 'Save Printer Config')}</button>
              </div>
            </div>
          </div>

          <div style="background:#F8FAFC; border:1.5px solid #CBD5E1; border-radius:12px; padding:12px;">
            <div style="font-size:0.9rem; font-weight:950; color:#0F172A; margin-bottom:6px;">🔌 ${t('瀏覽器直連 WebUSB / WebSerial 出單機 & 錢箱設定（備用模式）', 'Browser WebUSB / WebSerial Direct Printer (Optional)', 'WebUSB/WebSerial直印刷（予備）', 'WebUSB/WebSerial 직접 출력 (보조)')}</div>
            <p style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:10px;">
              ${t('支援透過瀏覽器 WebUSB 或 WebSerial 直接連線 80mm / 58mm 熱感印表機，結帳完成自動靜默切紙出單、依廚房站點分流派單並彈開 RJ-11 現金錢箱！', 'Connect 80mm/58mm thermal printers via WebUSB or WebSerial for silent checkout printing, station routing, and RJ-11 drawer kick.', 'WebUSB/WebSerial経由で80mm/58mmレシートプリンターとドロアーを直接制御します。', 'WebUSB/WebSerial로 80mm/58mm 프린터와 RJ-11 현금서랍을 직접 제어합니다.')}
            </p>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:8px;">
              ${['COUNTER', 'KITCHEN', 'DRINK'].map(rKey => {
                const routeInfo = MerchantHardwarePrinter.routes[rKey];
                return `
                  <div style="background:#FFFFFF; border:1px solid var(--border); border-radius:10px; padding:10px;">
                    <div style="font-weight:900; font-size:0.84rem; margin-bottom:3px;">${escapeHtml(trTerm(routeInfo.label))}</div>
                    <div style="font-size:0.73rem; color:var(--text-secondary); margin-bottom:8px;">${t('狀態', 'Status', '状態', '상태')}: ${escapeHtml(trTerm(MerchantHardwarePrinter.getStatusSummary(rKey)))}</div>
                    <div style="display:flex; gap:5px; flex-wrap:wrap;">
                      <button type="button" class="pos-chip-btn" style="padding:4px 8px; font-size:0.72rem;" onclick="connectHardwarePrinterUi('${rKey}', 'usb')">🔌 WebUSB</button>
                      <button type="button" class="pos-chip-btn" style="padding:4px 8px; font-size:0.72rem;" onclick="connectHardwarePrinterUi('${rKey}', 'serial')">🔗 Serial</button>
                      <button type="button" class="pos-chip-btn" style="padding:4px 8px; font-size:0.72rem; background:#ECFDF5; color:#065F46;" onclick="testHardwarePrinterUi('${rKey}')">🧪 ${t('測試出單', 'Test Print', 'テスト印刷', '테스트 인쇄')}</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="chart-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3 style="font-size:0.98rem; font-weight:900;">🛡️ ${t('店務敏感操作稽核紀錄（雲端 AuditLogs 工作表持久化）', 'Sensitive Operations Audit Log (Cloud AuditLogs)', '重要操作監査ログ（クラウド保存）', '중요 작업 감사 로그 (클라우드 저장)')}</h3>
            <span style="font-size:0.74rem; color:var(--text-secondary);">${t(`最近 ${storeAuditLogs.length} 筆紀錄`, `Latest ${storeAuditLogs.length} logs`, `直近${storeAuditLogs.length}件`, `최근 ${storeAuditLogs.length}건`)}</span>
          </div>
          ${storeAuditLogs.length === 0 ? `
            <div style="font-size:0.82rem; color:var(--text-muted); padding:12px;">${t('尚無敏感操作稽核紀錄', 'No audit logs yet', '監査ログはまだありません', '감사 로그가 아직 없습니다')}</div>
          ` : `
            <div style="max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
              ${storeAuditLogs.map(log => `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 12px; background:#F8FAFC; border:1px solid var(--border); border-radius:8px; font-size:0.78rem;">
                  <div>
                    <strong data-dish-name="1" style="color:var(--indigo);">[${escapeHtml(log.action)}]</strong>
                    ${log.staffName ? `<span data-dish-name="1" style="background:#EEF2FF; color:#312E81; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:800; margin-left:4px;">👤 ${escapeHtml(log.staffName)}${log.approvedBy ? ` (✓${escapeHtml(log.approvedBy)})` : ''}</span>` : ''}
                    <span data-dish-name="1" style="color:var(--text-primary); margin-left:6px;">${escapeHtml(log.detail)}</span>
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

// B4 + B8：各星期營業時間互動輔助函數
function toggleWeeklyDayClosedUi(dIdx, isClosed) {
  const card = document.getElementById(`weeklyDayCard_${dIdx}`);
  const openEl = document.getElementById(`weeklyOpen_${dIdx}`);
  const closeEl = document.getElementById(`weeklyClose_${dIdx}`);
  if (card) card.classList.toggle('is-closed', Boolean(isClosed));
  if (openEl) {
    openEl.disabled = Boolean(isClosed);
    if (openEl.parentElement) openEl.parentElement.style.opacity = isClosed ? '0.45' : '1';
  }
  if (closeEl) closeEl.disabled = Boolean(isClosed);
}

function applyWeekdayDefaultHoursPreset() {
  const openVal = document.getElementById('cfgProfileOpenTime')?.value || '10:30';
  const closeVal = document.getElementById('cfgProfileCloseTime')?.value || '19:30';
  [1, 2, 3, 4, 5].forEach(dIdx => {
    const chk = document.querySelector(`.weekly-day-closed-chk[data-day="${dIdx}"]`);
    if (chk) chk.checked = false;
    toggleWeeklyDayClosedUi(dIdx, false);
    const oEl = document.getElementById(`weeklyOpen_${dIdx}`);
    const cEl = document.getElementById(`weeklyClose_${dIdx}`);
    if (oEl) oEl.value = openVal;
    if (cEl) cEl.value = closeVal;
  });
  showToast(`✅ 已套用 ${openVal}~${closeVal} 至週一～週五，請按下方「儲存」寫入雲端！`);
}

function applySaturdayShortHoursPreset() {
  const chk = document.querySelector('.weekly-day-closed-chk[data-day="6"]');
  if (chk) chk.checked = false;
  toggleWeeklyDayClosedUi(6, false);
  const oEl = document.getElementById('weeklyOpen_6');
  const cEl = document.getElementById('weeklyClose_6');
  if (oEl) oEl.value = '10:30';
  if (cEl) cEl.value = '15:00';
  showToast('☀️ 已將週六設為 10:30~15:00，請按下方「儲存」寫入雲端！');
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

  if (!name) {
    showToast('⚠️ 餐廳名稱不可為空！');
    return;
  }

  // B4 + B8：由 7 天視覺化卡片收集 closedDays（陣列）與 weeklyHours（物件）
  const weeklyHours = {};
  const closedDaysArr = [];
  for (let d = 0; d <= 6; d++) {
    const chk = document.querySelector(`.weekly-day-closed-chk[data-day="${d}"]`);
    const isClosed = Boolean(chk && chk.checked);
    const dOpen = (document.getElementById(`weeklyOpen_${d}`)?.value || openTime).trim();
    const dClose = (document.getElementById(`weeklyClose_${d}`)?.value || closeTime).trim();
    weeklyHours[String(d)] = { closed: isClosed, open: dOpen, close: dClose };
    if (isClosed) closedDaysArr.push(d);
  }

  await withActiveButtonBusy(async () => {
    store.campus = campus;
    store.name = name;
    store.category = category;
    store.icon = icon;
    store.openTime = openTime;
    store.closeTime = closeTime;
    store.breakStartTime = breakStartTime;
    store.breakEndTime = breakEndTime;
    store.closedDays = closedDaysArr;
    store.weeklyHours = weeklyHours;

    recordMerchantAuditLog('修改餐廳與營業時間設定', `${name} (${openTime}~${closeTime} 公休:${closedDaysArr.join(',') || '無'})`);

    state.lastLocalStoreConfigUpdateTs = Date.now();
    enrichStoresAndAi();
    saveLocalStores(state.stores);

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
          closedDays: closedDaysArr,
          weeklyHours
        })
      });
      const data = await res.json();
      if (data && data.success) {
        if (data.store) {
          if (Array.isArray(data.store.closedDays)) store.closedDays = data.store.closedDays;
          if (data.store.weeklyHours && typeof data.store.weeklyHours === 'object') store.weeklyHours = data.store.weeklyHours;
          saveLocalStores(state.stores);
        }
        showToast(`✅ 已更新「${name}」餐廳資料、各星期營業時段與每週公休日並同步雲端！`);
      } else {
        showToast(`⚠️ 本機已更新，雲端回應：${(data && data.message) || '請確認後端已更新部署'}`);
      }
    } catch (e) {
      showToast('⚠️ 本機已儲存餐廳設定，待網路恢復後同步');
    }
    renderMerchantView();
  }, t('⏳ 儲存餐廳設定中...', '⏳ Saving Store Profile...'));
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

  await withActiveButtonBusy(async () => {
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
  }, t('⏳ 建立中...', '⏳ Creating...'));
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

  await withActiveButtonBusy(async () => {
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
  }, t('⏳ 更新密碼中...', '⏳ Updating PIN...'));
}

// ==================== 6.5 菜單辨識、穩定品項 ID 保護與進階餐點編輯器 ====================
async function addManualMenuItem() {
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

  await withActiveButtonBusy(async () => {
    const options = parseShorthandOptionsString(optsRaw);
    store.menus = store.menus || [];

    // B1 關鍵修正：同店不同分類允許同名品項（例如酥炸類・雞米花 vs 飯捲類・雞米花），僅比對 (category + name)
    const existingIdx = store.menus.findIndex(m =>
      String(m.category || '主廚推薦').trim() === cat &&
      String(m.name || '').trim() === name
    );
    const stableId = existingIdx > -1 && store.menus[existingIdx].id
      ? store.menus[existingIdx].id
      : generateStableMenuItemId(store.id, name, store.menus, cat);

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
        soldOutType: 'NONE',
        soldOutDate: '',
        options
      });
    }

    state.lastLocalStoreConfigUpdateTs = Date.now();
    saveLocalStores(state.stores);
    const targetSavedItem = existingIdx > -1 ? store.menus[existingIdx] : store.menus[store.menus.length - 1];
    // #34 改用單一品項原子更新 (upsertSingleMenuItem)，避免兩台裝置同時改菜單時整份陣列互相覆蓋
    await syncSingleMenuItemToCloud(store, targetSavedItem);
    recordMerchantAuditLog(existingIdx > -1 ? '更新菜單品項' : '新增菜單品項', `[${cat}] ${name} (NT$${price} / ID:${stableId})`);
    renderMerchantSettingsPanel(store);
    showToast(`✅ 已儲存餐點：[${cat}] ${name} (NT$${price} / ID:${stableId})`);
  }, t('⏳ 儲存中...', '⏳ Saving...'));
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

    <div style="margin-bottom:10px;">
      <label class="field-label">🌐 ${t('英文 / 國際菜名 (選填，供外籍生切換英文/日韓介面顯示)', 'English / International Dish Name (Optional)')}</label>
      <input type="text" id="editMenuNameEn" class="select-input" placeholder="e.g. Spicy Kimchi Pork Kimbap" value="${escapeHtml(item.nameEn || '')}">
    </div>

    <div style="margin-bottom:10px;">
      <label class="field-label">📝 ${t('餐點簡介 / 特色說明 (選填，顯示於學生點餐卡片)', 'Dish Description (Optional, shown on menu card)')}</label>
      <input type="text" id="editMenuDescription" maxlength="160" class="select-input" placeholder="${t('例：每日現煮台梗九號米搭配手工韓式泡菜與秘製燒肉', 'e.g. Freshly rolled with house kimchi & seared pork')}" value="${escapeHtml(item.description || '')}">
    </div>

    <div style="margin-bottom:12px;">
      <label class="field-label">🏷️ ${t('飲食偏好 / 過敏原標籤 (勾選後顯示於餐點卡片)', 'Dietary & Allergen Tags')}</label>
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${['SPICY', 'VEG', 'BEEF', 'PORK', 'NUTS', 'SEAFOOD', 'DAIRY'].map(code => {
          const isOn = Array.isArray(item.dietaryTags) && item.dietaryTags.includes(code);
          return `
            <label style="display:inline-flex; align-items:center; gap:5px; padding:4px 9px; border-radius:999px; border:1px solid ${isOn ? 'var(--brand)' : '#CBD5E1'}; background:${isOn ? 'var(--brand-light)' : '#F8FAFC'}; font-size:0.76rem; font-weight:800; cursor:pointer;">
              <input type="checkbox" class="edit-menu-dietary-chk" value="${code}" ${isOn ? 'checked' : ''} style="accent-color:var(--brand);">
              <span>${escapeHtml(typeof trDietaryTag === 'function' ? trDietaryTag(code) : code)}</span>
            </label>
          `;
        }).join('')}
      </div>
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
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(document.getElementById('menuEditModal'));
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
    description: document.getElementById('editMenuDescription')?.value || '',
    dietaryTags: Array.from(document.querySelectorAll('.edit-menu-dietary-chk:checked')).map(el => el.value),
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
  const description = (document.getElementById('editMenuDescription')?.value || '').trim().slice(0, 160);
  const dietaryTags = Array.from(document.querySelectorAll('.edit-menu-dietary-chk:checked')).map(el => String(el.value || '').toUpperCase()).filter(Boolean);
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
    id: store.menus[idx].id || generateStableMenuItemId(store.id, name, store.menus, cat),
    category: cat,
    tag,
    name,
    nameEn,
    description,
    dietaryTags,
    station,
    tileColor,
    sortOrder,
    image: cleanImg,
    price,
    dailyLimit,
    remainingToday: dailyLimit > 0 ? Math.max(0, dailyLimit - (Number(store.menus[idx].soldToday) || 0)) : null,
    options: newOptions
  };

  await withActiveButtonBusy(async () => {
    state.lastLocalStoreConfigUpdateTs = Date.now();
    saveLocalStores(state.stores);
    await syncSingleMenuItemToCloud(store, store.menus[idx]);
    recordMerchantAuditLog('編輯菜單與客製選項', `[${cat}] ${name} (NT$${price}・站點:${station}${dailyLimit > 0 ? `・限量${dailyLimit}份` : ''})`);
    closeMenuEditModal();
    renderMerchantSettingsPanel(store);
    showToast(`✅ 已更新「[${cat}] ${name}」之餐點設定、站點與客製選項！`);
  }, t('⏳ 儲存品項中...', '⏳ Saving Item...'));
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
        const cleanCat = String(item.category || '掃描推薦').trim();
        return {
          id: generateStableMenuItemId(store.id, cleanName, store.menus, cleanCat),
          selected: true,
          category: cleanCat,
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
          id: generateStableMenuItemId(store.id, name, store.menus, currentCat),
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
  if (state.lang && state.lang !== 'zh-TW') applyDomSystemTranslation(previewBox);
}

async function commitScannedMenusToStore() {
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

  await withActiveButtonBusy(async () => {
    store.menus = store.menus || [];
    selectedList.forEach(cand => {
      const cleanName = String(cand.name || '').trim();
      const cleanCat = String(cand.category || '掃描推薦').trim();
      const parsedOptions = parseShorthandOptionsString(cand.optionsShorthand);
      // B1：以 (category + name) 比對重複品項，不覆蓋不同分類之同名餐點
      const existing = store.menus.find(m =>
        String(m.category || '').trim() === cleanCat &&
        String(m.name || '').trim() === cleanName
      );
      const stableId = (existing && existing.id) || generateStableMenuItemId(store.id, cleanName, store.menus, cleanCat);

      if (existing) {
        existing.id = stableId;
        existing.price = cand.price;
        existing.category = cleanCat;
        existing.tag = cand.tag || existing.tag;
        if (Object.keys(parsedOptions).length > 0) existing.options = parsedOptions;
      } else {
        store.menus.push({
          id: stableId,
          storeId: store.id,
          category: cleanCat,
          name: cleanName,
          price: cand.price,
          tag: cand.tag || '🔥 店長推薦',
          soldOut: false,
          soldOutType: 'NONE',
          soldOutDate: '',
          options: parsedOptions
        });
      }
    });

    state.scannedMenuCandidates = [];
    state.lastLocalStoreConfigUpdateTs = Date.now();
    saveLocalStores(state.stores);
    await syncStoreMenuToCloud(store);
    renderMerchantSettingsPanel(store);
    showToast(`🎉 已成功匯入 ${selectedList.length} 道餐點（並保持穩定品項 ID）同步至雲端資料庫！`);
  }, t('⏳ 匯入菜單中...', '⏳ Importing Menu...'));
}

// B7：組合搭配折扣規則 CRUD
function addStoreComboDiscount() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  const name = String(document.getElementById('newComboNameInput')?.value || '').trim().slice(0, 32);
  const matchA = String(document.getElementById('newComboMatchAInput')?.value || '').trim().slice(0, 32);
  const matchB = String(document.getElementById('newComboMatchBInput')?.value || '').trim().slice(0, 32);
  const discountAmount = Math.max(1, parseInt(document.getElementById('newComboAmtInput')?.value || '5', 10) || 5);
  if (!matchA || !matchB) {
    showToast('⚠️ 請填寫組合折扣之條件 A 與條件 B（例如：雞排 + 飲料類）！');
    return;
  }
  if (!Array.isArray(store.comboDiscounts)) store.comboDiscounts = [];
  store.comboDiscounts.push({
    id: 'CMB-' + Date.now().toString(36).toUpperCase(),
    name: name || `${matchA} + ${matchB} 折$${discountAmount}`,
    matchA,
    matchB,
    discountAmount,
    active: true
  });
  saveLocalStores(state.stores);
  renderMerchantSettingsPanel(store);
  showToast(`🎁 已新增組合折扣「${name || `${matchA}+${matchB}`} (-$${discountAmount})」，請點擊下方「儲存設定」同步雲端！`);
}

function deleteStoreComboDiscount(idx) {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !Array.isArray(store.comboDiscounts)) return;
  store.comboDiscounts.splice(idx, 1);
  saveLocalStores(state.stores);
  renderMerchantSettingsPanel(store);
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

  await withActiveButtonBusy(async () => {
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
  }, t('⏳ 儲存員工權限中...', '⏳ Saving Staff...'));
}

async function saveMerchantConfig() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  await withActiveButtonBusy(async () => {
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
    const rawLpFee = parseFloat(document.getElementById('cfgLinePayFeeRate')?.value || '2.2');
    store.linePayFeeRate = isNaN(rawLpFee) ? 2.2 : Math.max(0, Math.min(20, rawLpFee));
    const morningPolicyEl = document.getElementById('cfgMorningSoldOutPolicy');
    if (morningPolicyEl) store.morningSoldOutPolicy = morningPolicyEl.value === 'AUTO_RESTORE' ? 'AUTO_RESTORE' : 'ASK_MORNING';
    const onlineLpEl = document.getElementById('cfgEnableOnlineLinePay');
    if (onlineLpEl) store.enableOnlineLinePay = onlineLpEl.value === 'true';

    state.lastLocalStoreConfigUpdateTs = Date.now();
    enrichStoresAndAi();
    saveLocalStores(state.stores);

    try {
      const res = await fetch(GAS_URL, {
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
          comboDiscounts: Array.isArray(store.comboDiscounts) ? store.comboDiscounts : [],
          morningSoldOutPolicy: store.morningSoldOutPolicy,
          enableOnlineLinePay: store.enableOnlineLinePay,
          allowDineInPostPay: store.allowDineInPostPay,
          linePayFeeRate: store.linePayFeeRate
        })
      });
      const data = await res.json();
      if (data && data.success) {
        showToast(`✅ 已儲存「${store.name}」營業狀態、組合折扣、售罄模式與結帳設定並同步雲端！`);
      } else {
        showToast(`⚠️ 本機已更新，雲端回應：${(data && data.message) || '請確認後端已更新部署'}`);
      }
    } catch (e) {
      showToast(`⚠️ 網路異常：已先於本機儲存「${store.name}」設定`);
    }
    renderMerchantView();
  }, t('⏳ 儲存設定中...', '⏳ Saving Settings...'));
}

// A7：儲存學生端餐廳顯示控制（勾選哪些餐廳開放於學生端）
async function saveStoresStudentVisibility() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  if (!isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride(t('修改學生端餐廳顯示控制', 'Update Student Store Visibility'));
    if (!mgrAuth) return;
    state.tempManagerOverridePin = mgrAuth.managerOverridePin;
  }
  const chks = Array.from(document.querySelectorAll('.store-student-vis-chk'));
  const visibilityMap = {};
  let enabledCount = 0;
  chks.forEach(chk => {
    const sid = chk.getAttribute('data-store-id');
    if (!sid) return;
    visibilityMap[sid] = Boolean(chk.checked);
    if (chk.checked) enabledCount++;
  });
  if (enabledCount === 0) {
    showToast(`⚠️ ${t('請至少保留 1 間餐廳開放於學生端顯示！', 'Keep at least 1 store visible to students!')}`);
    return;
  }

  await withActiveButtonBusy(async () => {
    state.stores.forEach(s => {
      if (visibilityMap[s.id] !== undefined) s.visibleToStudents = visibilityMap[s.id];
    });
    state.lastLocalStoreConfigUpdateTs = Date.now();
    saveLocalStores(state.stores);

    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'updateStoresVisibility',
          ...getMerchantAuthPayload(),
          managerOverridePin: state.tempManagerOverridePin || '',
          storeId: state.merchantStoreId,
          visibilityMap
        })
      });
      const data = await res.json();
      if (!data || !data.success) {
        throw new Error((data && data.message) || '儲存學生端顯示設定失敗');
      }
      showToast(`✅ ${t(`已更新學生端顯示設定（目前開放 ${enabledCount} 間餐廳）`, `Saved! ${enabledCount} store(s) visible to students.`)}`);
    } catch (err) {
      showToast(`❌ ${translateServerError(err.message || '儲存失敗')}`);
    }
    const store = state.stores.find(s => s.id === state.merchantStoreId);
    if (store) renderMerchantSettingsPanel(store);
  }, t('⏳ 儲存顯示設定中...', '⏳ Saving Visibility...'));
}

// B15：儲存 Windows 芯燁 XP-160II 出單機分區設定 & 複製 config.json
async function savePrinterBridgeConfig() {
  if (!isMerchantSessionValidNow()) {
    checkMerchantSecurityGate();
    return;
  }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;

  await withActiveButtonBusy(async () => {
    const autoEnabled = document.getElementById('cfgPrinterAutoEnabled')?.value !== 'false';
    const rawFrontCats = String(document.getElementById('cfgPrinterFrontCategories')?.value || '');
    const frontCats = rawFrontCats.split(/[,，、/]/).map(s => s.trim()).filter(Boolean);
    store.printerAutoEnabled = autoEnabled;
    store.printerFrontCategories = frontCats.length > 0 ? frontCats : ['飯捲類', '飲料類', '飲品類'];
    state.lastLocalStoreConfigUpdateTs = Date.now();
    saveLocalStores(state.stores);

    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'updateStoreConfig',
          ...getMerchantAuthPayload(),
          storeId: store.id,
          printerAutoEnabled: store.printerAutoEnabled,
          printerFrontCategories: store.printerFrontCategories
        })
      });
      const data = await res.json();
      if (data && data.success) {
        if (data.printerBridgeKey) {
          store.printerBridgeKey = data.printerBridgeKey;
          saveLocalStores(state.stores);
        }
        showToast(`🖨️ 已儲存「${store.name}」自動出單機設定（前台：${store.printerFrontCategories.join('、')}）！`);
      } else {
        showToast(`⚠️ 雲端回應：${(data && data.message) || '請確認後端已更新部署'}`);
      }
    } catch (e) {
      showToast('⚠️ 網路異常：已先於本機儲存出單機分區設定');
    }
    renderMerchantSettingsPanel(store);
  }, t('⏳ 儲存出單機設定中...', '⏳ Saving Printer Config...'));
}

function copyPrinterBridgeConfigJson() {
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  const frontCats = Array.isArray(store.printerFrontCategories) && store.printerFrontCategories.length > 0
    ? store.printerFrontCategories
    : ['飯捲類', '飲料類', '飲品類'];
  const cfgObj = {
    gas_url: GAS_URL,
    store_id: store.id,
    store_name: store.name,
    printer_key: store.printerBridgeKey || 'PLEASE_SYNC_AND_COPY_KEY_FROM_SETTINGS',
    windows_printer_name: 'XP-80C',
    poll_interval_seconds: 4,
    front_categories: frontCats,
    beep_enabled: true,
    beep_count: 2,
    auto_cut: true,
    open_cash_drawer: false,
    paper_width_px: 576
  };
  const jsonStr = JSON.stringify(cfgObj, null, 2);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(jsonStr).then(() => {
      showToast('📋 已複製 printer-bridge/config.json 設定內容！直接貼上覆蓋即可使用');
    }).catch(() => showToast('⚠️ 無法自動複製，請手動複製 Bridge Key'));
  } else {
    showToast('🔑 Bridge Key: ' + (store.printerBridgeKey || '請先按儲存產生'));
  }
}

// 二-2：一人一碼個人獨立 PIN 帳號 CRUD
async function addStaffAccountUi() {
  if (!isMerchantSessionValidNow()) { checkMerchantSecurityGate(); return; }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store) return;
  const name = String(document.getElementById('newStaffAccNameInput')?.value || '').trim();
  const role = document.getElementById('newStaffAccRoleSelect')?.value === 'MANAGER' ? 'MANAGER' : 'STAFF';
  const pin = String(document.getElementById('newStaffAccPinInput')?.value || '').trim();
  if (!name || !/^\d{4,8}$/.test(pin)) {
    showToast(`⚠️ ${t('請填入員工姓名與 4~8 位數個人 PIN 碼', 'Enter staff name and 4-8 digit PIN')}`);
    return;
  }
  let mgrPin = '';
  if (!isCurrentMerchantManager()) {
    const mgrAuth = await requestManagerPinOverride(t('新增員工獨立 PIN 帳號', 'Add Staff PIN Account'), store.id);
    if (!mgrAuth) return;
    mgrPin = mgrAuth.managerOverridePin;
  }
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
        addStaffAccount: { name, role, pin }
      })
    });
    const data = await res.json();
    if (!data || !data.success) throw new Error((data && data.message) || '新增員工帳號失敗');
    if (Array.isArray(data.staffAccounts)) store.staffAccounts = data.staffAccounts;
    saveLocalStores(state.stores);
    renderMerchantSettingsPanel(store);
    showToast(`✅ ${t(`已新增員工個人 PIN 帳號「${name}」`, `Added personal PIN account for ${name}`)}`);
  } catch (err) {
    showToast(`❌ ${translateServerError(err.message || '新增失敗')}`);
  }
}

async function toggleStaffAccountUi(accId) {
  if (!isMerchantSessionValidNow()) { checkMerchantSecurityGate(); return; }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !accId) return;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStaffSecurityConfig',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        toggleStaffAccountId: accId
      })
    });
    const data = await res.json();
    if (!data || !data.success) throw new Error((data && data.message) || '切換失敗');
    if (Array.isArray(data.staffAccounts)) store.staffAccounts = data.staffAccounts;
    saveLocalStores(state.stores);
    renderMerchantSettingsPanel(store);
    showToast(`✅ ${t('已更新員工帳號狀態', 'Staff account status updated')}`);
  } catch (err) {
    showToast(`❌ ${translateServerError(err.message || '操作失敗')}`);
  }
}

async function removeStaffAccountUi(accId) {
  if (!isMerchantSessionValidNow()) { checkMerchantSecurityGate(); return; }
  const store = state.stores.find(s => s.id === state.merchantStoreId);
  if (!store || !accId) return;
  const ok = await showAppConfirmModal({
    title: t('刪除員工獨立 PIN 帳號', 'Delete Staff PIN Account'),
    message: t('確定刪除此員工的個人 PIN 帳號嗎？刪除後該 PIN 將立即失效。', 'Delete this personal staff PIN? It will stop working immediately.'),
    confirmText: t('確定刪除', 'Delete'),
    danger: true
  });
  if (!ok) return;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStaffSecurityConfig',
        ...getMerchantAuthPayload(),
        storeId: store.id,
        removeStaffAccountId: accId
      })
    });
    const data = await res.json();
    if (!data || !data.success) throw new Error((data && data.message) || '刪除失敗');
    if (Array.isArray(data.staffAccounts)) store.staffAccounts = data.staffAccounts;
    saveLocalStores(state.stores);
    renderMerchantSettingsPanel(store);
    showToast(`🗑️ ${t('已刪除該員工個人 PIN 帳號', 'Staff PIN account deleted')}`);
  } catch (err) {
    showToast(`❌ ${translateServerError(err.message || '刪除失敗')}`);
  }
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

  await withActiveButtonBusy(async () => {
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
      showToast(`✅ 已儲存「${store.name}」專屬 LINE Pay 金流與官方帳號推播設定至雲端後台！`);
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
      showToast(`✅ 已儲存「${store.name}」LINE Pay 商家金流與官方帳號推播設定！`);
    }
    renderMerchantSettingsPanel(store);
  }, t('⏳ 儲存金流設定中...', '⏳ Saving...'));
}
// ==================== XP 自動列印引擎 (搭配 auto_print.vbs) ====================
const AUTO_PRINT_ENABLED = new URLSearchParams(location.search).get('autoprint') === '1';
const PRINTED_KEY = 'mealflow_printed_orders';
let printedIds = new Set(JSON.parse(localStorage.getItem(PRINTED_KEY) || '[]'));
let isFirstLoad = true;
let printQueue = [];
let isPrinting = false;

function checkAndAutoPrint(orders) {
  if (!AUTO_PRINT_ENABLED) return;

  // 1. 第一次載入：把現有舊單全部標記為已看過，不觸發列印
  if (isFirstLoad) {
    orders.forEach(o => printedIds.add(o.orderId));
    localStorage.setItem(PRINTED_KEY, JSON.stringify([...printedIds].slice(-300))); // 最多存300筆防爆
    isFirstLoad = false;
    return;
  }

  // 2. 找出還沒印過的新訂單，丟進排隊佇列
  let hasNew = false;
  orders.forEach(order => {
    if (!printedIds.has(order.orderId)) {
      printedIds.add(order.orderId);
      printQueue.push(order);
      hasNew = true;
    }
  });

  if (hasNew) {
    // 確保存檔並啟動佇列
    localStorage.setItem(PRINTED_KEY, JSON.stringify([...printedIds].slice(-300)));
    processPrintQueue();
  }
}

function processPrintQueue() {
  if (isPrinting || printQueue.length === 0) return;
  isPrinting = true;

  const nextOrder = printQueue.shift();

  // 呼叫 MealFlow 內建的預覽 Modal，強制轉為 80mm 顧客聯模式
  if (typeof openReceiptPrintModal === 'function') {
    openReceiptPrintModal(nextOrder.orderId, 'CUSTOMER');
  }

  // 等待 0.5 秒讓網頁 DOM 渲染出小票畫面
  setTimeout(() => {
    window.print(); // 觸發 XP 列印視窗，由 vbs 接手按 Enter
    
    // 等 2.5 秒讓印表機吐紙與 vbs 消化完，再關閉畫面印下一張
    setTimeout(() => {
      if (typeof closeReceiptPrintModal === 'function') closeReceiptPrintModal();
      isPrinting = false;
      processPrintQueue();
    }, 2500);
  }, 500);
}
