@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================================
echo   MealFlow Print Bridge - 打包為獨立免安裝 Windows .EXE
echo ==========================================================
python -m pip install -r requirements.txt pyinstaller
python -m PyInstaller --noconfirm --onefile --windowed --name "MealFlow_PrintBridge" mealflow_printer_bridge.py
echo.
echo ✅ 打包完成！執行檔位於：dist\MealFlow_PrintBridge.exe
echo 💡 請將 config.json 放在與 MealFlow_PrintBridge.exe 同一資料夾，
echo    並將捷徑拖曳至「Win+R ➔ shell:startup」即可開機自動背景常駐出單！
pause
