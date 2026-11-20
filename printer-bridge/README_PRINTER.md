# 🖨️ MealFlow Windows 芯燁 Xprinter XP-160II 自動三聯出單機 (Print Bridge)

專為 **Windows 觸控 POS 電腦 + 芯燁 Xprinter XP-160II 80mm 熱感應出單機** 設計的背景靜默自動出單程式。  
**免彈出瀏覽器列印視窗、零中文 Big5 亂碼、自動蜂鳴提示、自動三聯切紙！**

---

## ✨ 出單三聯分區規則（自動切刀）

每當學生線上點餐或櫃檯 POS 結帳送出新單，程式將於 **3～5 秒內** 自動依序印出並切紙：
1. **第 1 聯：【顧客聯】取餐明細** — 大字號取餐號、內用/外帶、全品項明細、金額、付款狀態（未付款會反白大字警示）、6 碼核銷碼與 QR Code。
2. **第 2 聯：【前台工單】** — 自動篩選「`飯捲類`、`飲料類`、`飲品類`」（可於 POS 後台即時調整），2 倍超大粗體字＋醒目客製規格與備註；**若本單無前台品項則自動略過不浪費紙！**
3. **第 3 聯：【後台工單】** — 其餘所有分類（如 `酥炸類`、`抓餅類`），同樣超大字體＋備註；**若本單無後台品項則自動略過！**

---

## 🚀 3 步驟快速安裝上線

### 第 1 步：安裝芯燁 XP-160II Windows 驅動程式
1. 將 XP-160II 透過 USB 接上 Windows POS 電腦並開機裝入 80mm 熱感紙。
2. 安裝芯燁官方驅動（通常名稱會顯示為 `XP-80C`、`XP-80` 或 `Xprinter XP-160II`）。
3. 在「控制台 ➔ 裝置和印表機」確認能正常印出測試頁。

### 第 2 步：從店家 POS 後台複製專屬設定
1. 登入店家 POS 後台 ➔ **⚙️ 設定** ➔ **💚 推播設定・安全鎖與稽核紀錄**。
2. 在 **🖨️ Windows 芯燁 XP-160II 背景自動出單機** 區塊確認「前台工單分類」（預設 `飯捲類, 飲料類, 飲品類`），按 **💾 儲存出單機分區設定**。
3. 按 **📋 複製 config.json 設定**，將內容貼上覆蓋本資料夾內的 `config.json`（若尚未建立，請複製 `config.example.json` 改名為 `config.json`）。
4. 確認 `windows_printer_name` 與電腦上看到的印表機名稱一致（可填關鍵字如 `"XP-80"`，系統會自動模糊比對）。

### 第 3 步：測試列印並設為開機自動啟動
1. 雙擊執行 **`install_and_run.bat`**（會自動安裝套件並顯示所有印表機名稱）。
2. 如欲立即測試三聯切紙與中文清晰度，可在命令提示字元執行：
   ```bat
   python mealflow_printer_bridge.py --test
   ```
3. **打包成免安裝 `.exe` + 開機自動背景啟動（強烈推薦正式店鋪使用）**：
   - 雙擊 **`build_exe.bat`** 產出 `dist\MealFlow_PrintBridge.exe`。
   - 將 `config.json` 複製到 `dist\` 資料夾中與 `.exe` 同層。
   - 按下鍵盤 `Win + R`，輸入 `shell:startup` 按 Enter，把 `MealFlow_PrintBridge.exe` 的捷徑放進去，以後每天 POS 開機就會自動在右下角系統匣靜默運行！

---

## 🛠️ 常用除錯指令

| 指令 | 說明 |
|---|---|
| `python mealflow_printer_bridge.py --list-printers` | 列出所有 Windows 印表機名稱 |
| `python mealflow_printer_bridge.py --test` | 立即印出三聯測試單（驗證中文、切刀、蜂鳴器） |
| `python mealflow_printer_bridge.py --preview` | 免接印表機，直接把三聯票樣存成 PNG 圖片檢查排版 |
| `python mealflow_printer_bridge.py --no-tray` | 純黑窗模式執行，即時查看每一筆輪詢與列印 Log |
