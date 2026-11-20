@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================================
echo   MealFlow v26.0 - Xprinter XP-160II 自動三聯出單機啟動器
echo ==========================================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 尚未安裝 Python 3！請先至 https://www.python.org/downloads/ 安裝（記得勾選 Add Python to PATH）
  pause
  exit /b 1
)

echo [1/3] 正在安裝／檢查必要套件 (Pillow, requests, pywin32, qrcode, pystray)...
python -m pip install --upgrade pip >nul 2>&1
python -m pip install -r requirements.txt

if not exist "config.json" (
  copy "config.example.json" "config.json" >nul
  echo.
  echo [2/3] 已建立 config.json！
  echo       請從店家 POS 設定頁（💚 推播設定・安全鎖與硬體）按「複製 config.json 設定」，
  echo       貼上覆蓋 config.json 後，再重新雙擊本檔案啟動！
  notepad config.json
  exit /b 0
)

echo.
echo [2/3] 本機 Windows 印表機清單：
python mealflow_printer_bridge.py --list-printers
echo.
echo [3/3] 正在啟動 MealFlow 背景自動三聯出單機（縮至右下角系統匣常駐）...
python mealflow_printer_bridge.py
pause
