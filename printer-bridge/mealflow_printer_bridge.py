#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
===============================================================================
MealFlow v26.0 — Windows 芯燁 Xprinter XP-160II 80mm 背景靜默自動出單機 (Print Bridge)
===============================================================================
功能特色：
  1. 背景輪詢 MealFlow 雲端列印佇列（3~5 秒），免開瀏覽器列印視窗、零彈窗靜默出單
  2. 每筆訂單自動切紙印出最多 3 聯（無品項之區域自動略過不浪費紙）：
       - 第 1 聯：【顧客聯 / 取餐明細】（大字號取餐號、用餐方式、品項與價格、付款狀態、核銷碼、QR Code）
       - 第 2 聯：【前台工單】（飯捲類 + 飲料類，可於後台或 config.json 自訂分類）
       - 第 3 聯：【後台工單】（其餘所有分類，如酥炸類、抓餅類，2 倍粗體超大字＋醒目備註）
  3. 採用 Pillow 576px 單色點陣圖 (ESC/POS GS v 0) 渲染微軟正黑體粗體，100% 杜絕中文 Big5 亂碼
  4. 內建自動切刀 (GS V 66 0)、新單蜂鳴提示音 (ESC B)、選配 RJ-11 錢箱彈開 (ESC p)
  5. 透過 Windows win32print RAW 模式直接指定印表機名稱（不吃系統預設印表機）
  6. 本機 printed_orders.json 防重複列印＋重印戳記辨識＋斷網指數退避自動重連
  7. 選配 Windows 系統匣常駐圖示 (pystray)，滑鼠右鍵即可測試列印或退出

指令參數：
  python mealflow_printer_bridge.py                 # 正常背景執行
  python mealflow_printer_bridge.py --list-printers # 列出本機所有 Windows 印表機名稱
  python mealflow_printer_bridge.py --test          # 立刻印出三聯測試單（驗證中文/切刀/蜂鳴器）
  python mealflow_printer_bridge.py --preview       # 將三聯測試單輸出為 PNG 圖檔預覽（免接印表機）
===============================================================================
"""

import argparse
import json
import logging
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from PIL import Image, ImageDraw, ImageFont

try:
    import win32print  # type: ignore
except ImportError:
    win32print = None

try:
    import qrcode  # type: ignore
except ImportError:
    qrcode = None

try:
    import pystray  # type: ignore
except ImportError:
    pystray = None


APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"
PRINTED_CACHE_PATH = APP_DIR / "printed_orders.json"
LOG_PATH = APP_DIR / "printer_bridge.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
    ],
)
logger = logging.getLogger("MealFlowPrintBridge")


DEFAULT_CONFIG: Dict[str, Any] = {
    "gas_url": "https://script.google.com/macros/s/AKfycbzN2e0bi-jQG5RvGBpZYu5190f2JfX-6P1C8DxUy2aPyrrpbJpBl0oaTwYFRhAyBl8/exec",
    "store_id": "S01",
    "store_name": "趙班長海苔飯捲",
    "printer_key": "",
    "windows_printer_name": "XP-80C",
    "poll_interval_seconds": 4,
    "front_categories": ["飯捲類", "飲料類", "飲品類"],
    "beep_enabled": True,
    "beep_count": 2,
    "auto_cut": True,
    "open_cash_drawer": False,
    "paper_width_px": 576,
    "print_customer_slip": True,
    "print_front_slip": True,
    "print_back_slip": True,
    "print_qr_on_customer_slip": True,
}


# ==================== 字型與 576px 單色熱感圖檔渲染引擎 ====================

def find_cjk_font_path(bold: bool = True) -> Optional[str]:
    win_fonts = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    candidates = (
        ["msjhbd.ttc", "msjh.ttc", "mingliub.ttc", "kaiu.ttf", "simhei.ttf", "arialbd.ttf"]
        if bold
        else ["msjh.ttc", "msjhbd.ttc", "mingliu.ttc", "kaiu.ttf", "simhei.ttf", "arial.ttf"]
    )
    for fname in candidates:
        p = win_fonts / fname
        if p.exists():
            return str(p)
    # Linux / macOS fallback for local testing
    for p in [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansTC-Bold.otf",
        "/System/Library/Fonts/PingFang.ttc",
    ]:
        if os.path.exists(p):
            return p
    return None


FONT_BOLD_PATH = find_cjk_font_path(bold=True)
FONT_REG_PATH = find_cjk_font_path(bold=False)
_FONT_CACHE: Dict[Tuple[bool, int], ImageFont.FreeTypeFont] = {}


def get_font(size: int, bold: bool = True) -> ImageFont.ImageFont:
    key = (bold, size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    path = FONT_BOLD_PATH if bold else (FONT_REG_PATH or FONT_BOLD_PATH)
    if path:
        try:
            f = ImageFont.truetype(path, size)
            _FONT_CACHE[key] = f
            return f
        except Exception:
            pass
    return ImageFont.load_default()


def measure_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> Tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return (bbox[2] - bbox[0], bbox[3] - bbox[1])


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_w: int) -> List[str]:
    text = str(text or "").strip()
    if not text:
        return []
    lines: List[str] = []
    for raw_para in text.splitlines():
        cur = ""
        for ch in raw_para:
            cand = cur + ch
            w, _ = measure_text(draw, cand, font)
            if w <= max_w or not cur:
                cur = cand
            else:
                lines.append(cur)
                cur = ch
        if cur:
            lines.append(cur)
    return lines


class ThermalCanvas:
    """動態高度之 576px (80mm) 黑白單色熱感畫布"""

    def __init__(self, width: int = 576, margin_x: int = 12):
        self.width = width
        self.margin_x = margin_x
        self.inner_w = width - margin_x * 2
        self.ops: List[Tuple[str, Dict[str, Any]]] = []
        self._tmp_img = Image.new("1", (width, 64), 1)
        self._tmp_draw = ImageDraw.Draw(self._tmp_img)
        self.y = 8

    def add_spacer(self, px: int = 10) -> None:
        self.y += px

    def add_divider(self, style: str = "dashed", thickness: int = 2) -> None:
        self.y += 6
        self.ops.append(("divider", {"y": self.y, "style": style, "thickness": thickness}))
        self.y += thickness + 8

    def add_banner(self, text: str, font_size: int = 34, pad_y: int = 10) -> None:
        font = get_font(font_size, bold=True)
        lines = wrap_text(self._tmp_draw, text, font, self.inner_w - 20)
        line_heights = [measure_text(self._tmp_draw, ln, font)[1] for ln in lines] or [font_size]
        box_h = sum(line_heights) + max(0, len(lines) - 1) * 6 + pad_y * 2
        self.ops.append(("banner", {"y": self.y, "h": box_h, "lines": lines, "font": font, "pad_y": pad_y}))
        self.y += box_h + 10

    def add_text(self, text: str, font_size: int = 26, bold: bool = True, align: str = "left", indent: int = 0) -> None:
        font = get_font(font_size, bold=bold)
        lines = wrap_text(self._tmp_draw, text, font, self.inner_w - indent)
        for ln in lines:
            w, h = measure_text(self._tmp_draw, ln, font)
            x = self.margin_x + indent
            if align == "center":
                x = max(self.margin_x, (self.width - w) // 2)
            elif align == "right":
                x = max(self.margin_x, self.width - self.margin_x - w)
            self.ops.append(("text", {"x": x, "y": self.y, "text": ln, "font": font}))
            self.y += h + 7

    def add_left_right(self, left_text: str, right_text: str, font_size: int = 26, bold: bool = True) -> None:
        font = get_font(font_size, bold=bold)
        rw, rh = measure_text(self._tmp_draw, right_text, font)
        max_left_w = max(80, self.inner_w - rw - 14)
        left_lines = wrap_text(self._tmp_draw, left_text, font, max_left_w) or [""]
        for idx, ln in enumerate(left_lines):
            _, lh = measure_text(self._tmp_draw, ln, font)
            self.ops.append(("text", {"x": self.margin_x, "y": self.y, "text": ln, "font": font}))
            if idx == 0 and right_text:
                rx = self.width - self.margin_x - rw
                self.ops.append(("text", {"x": rx, "y": self.y, "text": right_text, "font": font}))
            self.y += max(lh, rh if idx == 0 else lh) + 7

    def add_qr(self, data: str, size: int = 180) -> None:
        if not qrcode or not data:
            return
        try:
            qr = qrcode.QRCode(version=None, box_size=5, border=2)
            qr.add_data(data)
            qr.make(fit=True)
            qr_img = qr.make_image(fill_color="black", back_color="white").convert("1")
            qr_img = qr_img.resize((size, size), Image.NEAREST)
            x = (self.width - size) // 2
            self.ops.append(("image", {"x": x, "y": self.y, "img": qr_img}))
            self.y += size + 10
        except Exception as exc:
            logger.warning("QR 碼繪製失敗（略過）: %s", exc)

    def render(self) -> Image.Image:
        total_h = self.y + 24
        img = Image.new("1", (self.width, total_h), 1)  # 1 = 白底, 0 = 黑字
        draw = ImageDraw.Draw(img)
        for op, p in self.ops:
            if op == "text":
                draw.text((p["x"], p["y"]), p["text"], font=p["font"], fill=0)
            elif op == "divider":
                y = p["y"]
                if p["style"] == "solid":
                    draw.rectangle([self.margin_x, y, self.width - self.margin_x, y + p["thickness"]], fill=0)
                else:
                    x = self.margin_x
                    while x < self.width - self.margin_x:
                        draw.rectangle([x, y, min(x + 12, self.width - self.margin_x), y + p["thickness"]], fill=0)
                        x += 20
            elif op == "banner":
                y0, h = p["y"], p["h"]
                draw.rectangle([self.margin_x, y0, self.width - self.margin_x, y0 + h], fill=0)
                cy = y0 + p["pad_y"]
                for ln in p["lines"]:
                    w, lh = measure_text(draw, ln, p["font"])
                    tx = (self.width - w) // 2
                    draw.text((tx, cy), ln, font=p["font"], fill=1)
                    cy += lh + 6
            elif op == "image":
                img.paste(p["img"], (p["x"], p["y"]))
        return img


# ==================== ESC/POS 點陣圖 + 切紙 + 蜂鳴器編碼器 ====================

def image_to_escpos_raster(img: Image.Image) -> bytes:
    """將 1-bit Pillow 圖片轉為標準 ESC/POS GS v 0 點陣指令（分段傳輸防溢位）"""
    mono = img.convert("1")
    w, h = mono.size
    if w % 8 != 0:
        pad_w = ((w + 7) // 8) * 8
        padded = Image.new("1", (pad_w, h), 1)
        padded.paste(mono, (0, 0))
        mono = padded
        w = pad_w
    bytes_per_row = w // 8
    pixels = mono.load()

    out = bytearray()
    out.extend(b"\x1b\x40")  # ESC @ 初始化印表機
    out.extend(b"\x1b\x61\x01")  # 置中對齊

    # 每次最多傳 200 行，避免廉價機型緩衝區爆滿
    stripe_h = 200
    for y_start in range(0, h, stripe_h):
        cur_h = min(stripe_h, h - y_start)
        xL = bytes_per_row & 0xFF
        xH = (bytes_per_row >> 8) & 0xFF
        yL = cur_h & 0xFF
        yH = (cur_h >> 8) & 0xFF
        out.extend(bytes([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]))
        for y in range(y_start, y_start + cur_h):
            for bx in range(bytes_per_row):
                byte_val = 0
                base_x = bx * 8
                for bit in range(8):
                    # Pillow mode '1': 0 = 黑點 (要印), 255/1 = 白底 (不印)
                    if pixels[base_x + bit, y] == 0:
                        byte_val |= (1 << (7 - bit))
                out.append(byte_val)
    return bytes(out)


def build_slip_escpos_bytes(
    img: Image.Image,
    auto_cut: bool = True,
    beep: bool = False,
    beep_count: int = 2,
    open_drawer: bool = False,
) -> bytes:
    buf = bytearray()
    if beep:
        # 芯燁 Xprinter 標準蜂鳴指令：ESC B n t (n=次數 1~9, t=時長 1~9)
        n = max(1, min(9, int(beep_count)))
        buf.extend(bytes([0x1B, 0x42, n, 2]))
    if open_drawer:
        # RJ-11 錢箱彈開脈衝：ESC p 0 25 250
        buf.extend(b"\x1b\x70\x00\x19\xfa")
    buf.extend(image_to_escpos_raster(img))
    buf.extend(b"\x1b\x64\x04")  # 進紙 4 行讓內容露出切刀口
    if auto_cut:
        buf.extend(b"\x1d\x56\x42\x00")  # GS V 66 0 進紙半切/全切
    return bytes(buf)


# ==================== 三聯票據排版引擎（顧客聯 / 前台 / 後台） ====================

def format_selections_text(selections: Any) -> str:
    if not isinstance(selections, dict) or not selections:
        return ""
    parts = [f"{k}:{v}" for k, v in selections.items() if str(v or "").strip()]
    return " / ".join(parts)


def render_customer_slip(job: Dict[str, Any], cfg: Dict[str, Any]) -> Image.Image:
    c = ThermalCanvas(width=int(cfg.get("paper_width_px", 576)))
    store_name = str(job.get("storeName") or cfg.get("store_name") or "MealFlow").strip()
    pickup_no = str(job.get("pickupNumber") or "----")
    dine_type = str(job.get("dineType") or "外帶自取")
    is_res = bool(job.get("isReservation"))
    ver_code = str(job.get("verificationCode") or "")
    pay_status = str(job.get("paymentStatus") or "")
    pay_method = str(job.get("paymentMethod") or "")
    is_paid = "已付款" in pay_status

    c.add_text(store_name, font_size=30, bold=True, align="center")
    c.add_banner("【顧 客 聯】取餐明細", font_size=30, pad_y=8)

    c.add_text(f"取餐號  #{pickup_no}", font_size=58, bold=True, align="center")
    c.add_text(f"{dine_type}{'  ★預訂單' if is_res else ''}", font_size=32, bold=True, align="center")

    if is_res:
        c.add_text(f"預訂取餐：{job.get('pickupDate', '')} {job.get('pickupTime', '')}", font_size=26, bold=True, align="center")
    else:
        ts_str = str(job.get("createdAt") or datetime.now().strftime("%H:%M:%S"))
        c.add_text(f"下單時間：{job.get('pickupDate', '')} {ts_str}", font_size=22, bold=False, align="center")

    c.add_divider("solid", 3)

    for it in job.get("items") or []:
        name = str(it.get("name") or "")
        qty = int(it.get("qty") or 1)
        price = int(it.get("price") or 0) * qty
        c.add_left_right(f"{name} ×{qty}", f"${price}", font_size=26, bold=True)
        sel_txt = format_selections_text(it.get("selections"))
        if sel_txt:
            c.add_text(f"↳ {sel_txt}", font_size=21, bold=False, indent=16)
        if it.get("itemNote"):
            c.add_text(f"★ 備註：{it['itemNote']}", font_size=22, bold=True, indent=16)

    c.add_divider("dashed", 2)

    cutlery_fee = int(job.get("cutleryFee") or 0)
    discount = int(job.get("discount") or 0)
    final_total = int(job.get("finalTotal") or 0)
    if job.get("needCutlery"):
        c.add_left_right("免洗餐具", f"+${cutlery_fee}", font_size=23, bold=False)
    if discount > 0:
        c.add_left_right("活動 / 組合折扣", f"-${discount}", font_size=23, bold=True)
    c.add_left_right("應付總計", f"NT$ {final_total}", font_size=34, bold=True)

    c.add_divider("dashed", 2)
    if is_paid:
        c.add_text(f"付款狀態：✓ 已付款 ({pay_method})", font_size=24, bold=True)
    else:
        c.add_banner(f"尚未付款  NT${final_total}（現場付）", font_size=26, pad_y=6)

    if job.get("customerNote"):
        c.add_text(f"整單備註：{job['customerNote']}", font_size=24, bold=True)
    if job.get("customerPhone"):
        c.add_text(f"聯絡電話：{job['customerPhone']}", font_size=22, bold=False)
    if job.get("taxId"):
        c.add_text(f"統一編號：{job['taxId']} (非電子發票)", font_size=22, bold=True)
    if ver_code:
        c.add_text(f"核銷碼：{ver_code}", font_size=24, bold=True, align="center")
        if cfg.get("print_qr_on_customer_slip", True):
            c.add_spacer(4)
            c.add_qr(ver_code, size=150)

    c.add_text("※ 本單僅供取餐核對，非正式電子發票", font_size=19, bold=False, align="center")
    return c.render()


def render_station_slip(job: Dict[str, Any], zone_label: str, zone_items: List[Dict[str, Any]], cfg: Dict[str, Any]) -> Image.Image:
    """廚房工單（前台工單 / 後台工單）：超大字體＋醒目規格與備註，方便忙碌時一眼看清！"""
    c = ThermalCanvas(width=int(cfg.get("paper_width_px", 576)))
    pickup_no = str(job.get("pickupNumber") or "----")
    dine_type = str(job.get("dineType") or "外帶自取")
    is_res = bool(job.get("isReservation"))
    pay_status = str(job.get("paymentStatus") or "")
    is_paid = "已付款" in pay_status

    c.add_banner(f"【{zone_label}】", font_size=38, pad_y=10)
    c.add_left_right(f"#{pickup_no}", dine_type, font_size=46, bold=True)

    if is_res:
        c.add_banner(f"預訂取餐 {job.get('pickupDate', '')} {job.get('pickupTime', '')}", font_size=26, pad_y=6)
    else:
        ts_str = str(job.get("createdAt") or datetime.now().strftime("%H:%M:%S"))
        c.add_left_right(f"時間 {ts_str}", "✓已付" if is_paid else "★未付", font_size=24, bold=True)

    c.add_divider("solid", 4)

    total_qty = 0
    for it in zone_items:
        qty = int(it.get("qty") or 1)
        total_qty += qty
        cat = str(it.get("category") or "")
        name = str(it.get("name") or "")
        c.add_left_right(f"[{cat}] {name}", f"×{qty}", font_size=34, bold=True)
        sel_txt = format_selections_text(it.get("selections"))
        if sel_txt:
            c.add_text(f"  ► {sel_txt}", font_size=26, bold=True, indent=12)
        if it.get("itemNote"):
            c.add_text(f"  ★ {it['itemNote']}", font_size=28, bold=True, indent=12)
        c.add_spacer(6)

    c.add_divider("dashed", 2)
    if job.get("needCutlery"):
        c.add_text("★ 需要免洗餐具", font_size=26, bold=True)
    if job.get("customerNote"):
        c.add_text(f"★ 整單備註：{job['customerNote']}", font_size=28, bold=True)
    c.add_text(f"本區共 {total_qty} 份", font_size=24, bold=True, align="right")
    return c.render()


# ==================== Windows win32print RAW 列印控制 ====================

def list_windows_printers() -> List[str]:
    if win32print is None:
        return []
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    return [p[2] for p in win32print.EnumPrinters(flags)]


def resolve_target_printer_name(desired_name: str) -> str:
    if win32print is None:
        raise RuntimeError("尚未安裝 pywin32（請執行 pip install pywin32 或 install_and_run.bat）")
    printers = list_windows_printers()
    desired = str(desired_name or "").strip()
    if desired:
        # 1. 完全相符
        for p in printers:
            if p.lower() == desired.lower():
                return p
        # 2. 關鍵字包含相符（例如 "XP-80" 對應 "XP-80C (copy 1)"）
        for p in printers:
            if desired.lower() in p.lower():
                return p
        raise RuntimeError(f"找不到名稱含「{desired}」的印表機！本機可用印表機：{printers}")
    return win32print.GetDefaultPrinter()


def send_raw_bytes_to_windows_printer(printer_name: str, payload: bytes, doc_name: str = "MealFlow Receipt") -> None:
    resolved = resolve_target_printer_name(printer_name)
    h_printer = win32print.OpenPrinter(resolved)
    try:
        win32print.StartDocPrinter(h_printer, 1, (doc_name, None, "RAW"))
        try:
            win32print.StartPagePrinter(h_printer)
            win32print.WritePrinter(h_printer, payload)
            win32print.EndPagePrinter(h_printer)
        finally:
            win32print.EndDocPrinter(h_printer)
    finally:
        win32print.ClosePrinter(h_printer)


# ==================== 佇列分類與三聯出單主流程 ====================

def classify_item_zone(item: Dict[str, Any], front_categories: List[str]) -> str:
    if str(item.get("zone") or "").upper() in ("FRONT", "BACK"):
        return str(item["zone"]).upper()
    cat = str(item.get("category") or "").strip()
    for fc in front_categories:
        fc_clean = str(fc or "").strip()
        if fc_clean and (cat == fc_clean or fc_clean in cat or cat in fc_clean):
            return "FRONT"
    return "BACK"


def print_order_three_slips(
    job: Dict[str, Any],
    cfg: Dict[str, Any],
    preview_dir: Optional[Path] = None,
) -> List[str]:
    front_cats = list(cfg.get("front_categories") or ["飯捲類", "飲料類", "飲品類"])
    items = list(job.get("items") or [])
    front_items = [it for it in items if classify_item_zone(it, front_cats) == "FRONT"]
    back_items = [it for it in items if classify_item_zone(it, front_cats) == "BACK"]

    slips: List[Tuple[str, Image.Image]] = []
    if cfg.get("print_customer_slip", True):
        slips.append(("customer", render_customer_slip(job, cfg)))
    if cfg.get("print_front_slip", True) and len(front_items) > 0:
        slips.append(("front", render_station_slip(job, "前台工單", front_items, cfg)))
    if cfg.get("print_back_slip", True) and len(back_items) > 0:
        slips.append(("back", render_station_slip(job, "後台工單", back_items, cfg)))

    printed_names: List[str] = []
    pickup_no = str(job.get("pickupNumber") or "TEST")
    auto_cut = bool(cfg.get("auto_cut", True))
    beep_enabled = bool(cfg.get("beep_enabled", True))
    beep_count = int(cfg.get("beep_count", 2))
    open_drawer = bool(cfg.get("open_cash_drawer", False))

    for idx, (slip_key, img) in enumerate(slips):
        if preview_dir is not None:
            preview_dir.mkdir(parents=True, exist_ok=True)
            out_png = preview_dir / f"preview_{pickup_no}_{idx + 1}_{slip_key}.png"
            img.save(out_png)
            logger.info("🖼️ 已儲存預覽圖：%s", out_png)
            printed_names.append(slip_key)
            continue

        raw_bytes = build_slip_escpos_bytes(
            img=img,
            auto_cut=auto_cut,
            beep=(beep_enabled and idx == 0),  # 每筆新單在第 1 聯響蜂鳴器一次即可
            beep_count=beep_count,
            open_drawer=(open_drawer and idx == 0),
        )
        send_raw_bytes_to_windows_printer(
            str(cfg.get("windows_printer_name") or ""),
            raw_bytes,
            doc_name=f"MealFlow #{pickup_no} ({slip_key})",
        )
        printed_names.append(slip_key)
        time.sleep(0.25)

    return printed_names


# ==================== 設定檔與本機防重印快取 ====================

def load_config() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        example_path = APP_DIR / "config.example.json"
        if example_path.exists():
            CONFIG_PATH.write_text(example_path.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.warning("📝 已自動建立 %s，請填入後台設定頁的 printer_key 與印表機名稱！", CONFIG_PATH)
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    merged = {**DEFAULT_CONFIG, **data}
    return merged


def load_printed_cache() -> Dict[str, float]:
    if not PRINTED_CACHE_PATH.exists():
        return {}
    try:
        raw = json.loads(PRINTED_CACHE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            now = time.time()
            # 僅保留 36 小時內的防重印記錄
            return {k: float(v) for k, v in raw.items() if (now - float(v)) < 36 * 3600}
    except Exception:
        pass
    return {}


def save_printed_cache(cache: Dict[str, float]) -> None:
    try:
        PRINTED_CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("無法寫入防重印快取：%s", exc)


def make_test_order_job(cfg: Dict[str, Any]) -> Dict[str, Any]:
    now_str = datetime.now().strftime("%H:%M:%S")
    today_str = datetime.now().strftime("%Y-%m-%d")
    return {
        "orderId": f"TEST-{int(time.time())}",
        "pickupNumber": "A888",
        "verificationCode": "TEST88",
        "storeId": cfg.get("store_id", "S01"),
        "storeName": cfg.get("store_name", "趙班長海苔飯捲"),
        "dineType": "外帶自取",
        "isReservation": False,
        "pickupDate": today_str,
        "pickupTime": now_str[:5],
        "needCutlery": True,
        "cutleryFee": 1,
        "subtotal": 190,
        "discount": 5,
        "finalTotal": 186,
        "paymentMethod": "現場現金",
        "paymentStatus": "已付款",
        "taxId": "",
        "customerPhone": "0912345678",
        "customerNote": "測試三聯自動切紙（顧客＋前台＋後台）",
        "createdAt": now_str,
        "items": [
            {
                "id": "T1",
                "name": "卡拉雞腿飯捲",
                "category": "飯捲類",
                "zone": "FRONT",
                "qty": 1,
                "price": 75,
                "selections": {"辣度": "小辣", "加料": "加起司"},
                "itemNote": "不要生菜",
            },
            {
                "id": "T2",
                "name": "古早味紅茶",
                "category": "飲料類",
                "zone": "FRONT",
                "qty": 1,
                "price": 30,
                "selections": {"冰塊": "少冰"},
                "itemNote": "",
            },
            {
                "id": "T3",
                "name": "酥炸大雞排",
                "category": "酥炸類",
                "zone": "BACK",
                "qty": 1,
                "price": 85,
                "selections": {"切塊": "要切", "辣度": "中辣"},
                "itemNote": "胡椒多一點",
            },
        ],
    }


# ==================== 背景輪詢引擎 ====================

class MealFlowPrintBridgeDaemon:
    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.stop_event = threading.Event()
        self.force_poll_event = threading.Event()
        self.printed_cache = load_printed_cache()
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "text/plain;charset=utf-8"})

    def poll_once(self) -> int:
        gas_url = str(self.cfg.get("gas_url") or "").strip()
        store_id = str(self.cfg.get("store_id") or "S01").strip().upper()
        printer_key = str(self.cfg.get("printer_key") or "").strip()
        if not gas_url or not printer_key:
            logger.warning("⚠️ 尚未設定 gas_url 或 printer_key（請從 POS 設定 ➔ 推播/硬體頁複製 config.json）")
            return 0

        resp = self.session.post(
            gas_url,
            data=json.dumps({
                "action": "getPendingPrintJobs",
                "storeId": store_id,
                "printerKey": printer_key,
            }),
            timeout=15,
        )
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("success"):
            raise RuntimeError(payload.get("message") or "雲端佇列驗證失敗")

        # 動態同步後台設定的前台分類（免改本機 config.json）
        if isinstance(payload.get("frontCategories"), list) and payload["frontCategories"]:
            self.cfg["front_categories"] = payload["frontCategories"]

        jobs = payload.get("jobs") or []
        printed_count = 0
        for job in jobs:
            oid = str(job.get("orderId") or "").strip()
            if not oid:
                continue
            reprint_ts = int(job.get("reprintRequestedAtTs") or 0)
            dedupe_key = f"{oid}::{reprint_ts}"
            if dedupe_key in self.printed_cache:
                # 若本機已印過但雲端還沒 ack，補發一次 ack 即可
                self._ack_job(gas_url, store_id, printer_key, oid)
                continue

            slips = print_order_three_slips(job, self.cfg)
            self.printed_cache[dedupe_key] = time.time()
            save_printed_cache(self.printed_cache)
            self._ack_job(gas_url, store_id, printer_key, oid)
            printed_count += 1
            logger.info("🖨️ 已自動列印訂單 #%s (%s) ➔ 聯別：%s", job.get("pickupNumber"), oid, ", ".join(slips))
        return printed_count

    def _ack_job(self, gas_url: str, store_id: str, printer_key: str, order_id: str) -> None:
        try:
            self.session.post(
                gas_url,
                data=json.dumps({
                    "action": "ackPrintJob",
                    "storeId": store_id,
                    "printerKey": printer_key,
                    "orderId": order_id,
                }),
                timeout=12,
            )
        except Exception as exc:
            logger.warning("回報已列印狀態 (ackPrintJob) 失敗（將於下次補回報）: %s", exc)

    def run_loop(self) -> None:
        base_interval = max(2, int(self.cfg.get("poll_interval_seconds", 4)))
        cur_delay = base_interval
        logger.info(
            "🚀 MealFlow 自動出單橋接程式啟動！門市=%s | 印表機=%s | 輪詢=%ds | 前台分類=%s",
            self.cfg.get("store_id"),
            self.cfg.get("windows_printer_name") or "(Windows 預設)",
            base_interval,
            ", ".join(self.cfg.get("front_categories") or []),
        )
        while not self.stop_event.is_set():
            try:
                self.poll_once()
                cur_delay = base_interval
            except Exception as exc:
                logger.error("⚠️ 輪詢或列印異常：%s（%ds 後自動重試）", exc, cur_delay)
                cur_delay = min(30, cur_delay * 2)
            self.force_poll_event.wait(timeout=cur_delay)
            self.force_poll_event.clear()

    def stop(self) -> None:
        self.stop_event.set()
        self.force_poll_event.set()


def run_with_optional_tray(daemon: MealFlowPrintBridgeDaemon) -> None:
    if pystray is None:
        daemon.run_loop()
        return

    worker = threading.Thread(target=daemon.run_loop, daemon=True)
    worker.start()

    icon_img = Image.new("RGB", (64, 64), (234, 88, 12))
    d = ImageDraw.Draw(icon_img)
    d.rectangle([12, 16, 52, 48], fill=(255, 255, 255))
    d.rectangle([18, 22, 46, 30], fill=(15, 23, 42))
    d.rectangle([18, 34, 46, 42], fill=(16, 185, 129))

    def on_test_print(_icon: Any, _item: Any) -> None:
        try:
            slips = print_order_three_slips(make_test_order_job(daemon.cfg), daemon.cfg)
            logger.info("🧪 系統匣測試列印完成：%s", slips)
        except Exception as exc:
            logger.error("❌ 測試列印失敗：%s", exc)

    def on_poll_now(_icon: Any, _item: Any) -> None:
        daemon.force_poll_event.set()

    def on_quit(icon: Any, _item: Any) -> None:
        daemon.stop()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("🖨️ 列印三聯測試單", on_test_print),
        pystray.MenuItem("🔄 立即檢查新訂單", on_poll_now),
        pystray.MenuItem("❌ 結束出單程式", on_quit),
    )
    tray = pystray.Icon("MealFlowPrintBridge", icon_img, "MealFlow 自動出單機 (運行中)", menu)
    tray.run()


def main() -> None:
    parser = argparse.ArgumentParser(description="MealFlow Windows 芯燁 XP-160II 背景靜默三聯自動出單程式")
    parser.add_argument("--list-printers", action="store_true", help="列出所有已安裝之 Windows 印表機名稱")
    parser.add_argument("--test", action="store_true", help="立刻列印一份三聯測試單（顧客＋前台＋後台）")
    parser.add_argument("--preview", action="store_true", help="將三聯測試單存成 PNG 預覽圖（免印表機）")
    parser.add_argument("--no-tray", action="store_true", help="以純主控台模式執行（不啟用系統匣圖示）")
    args = parser.parse_args()

    if args.list_printers:
        printers = list_windows_printers()
        print("===== 本機已安裝之 Windows 印表機 =====")
        for p in printers:
            print("  •", p)
        if not printers:
            print("  (找不到印表機，或尚未安裝 pywin32)")
        return

    cfg = load_config()

    if args.preview:
        slips = print_order_three_slips(make_test_order_job(cfg), cfg, preview_dir=APP_DIR / "previews")
        print(f"✅ 已產生 {len(slips)} 張預覽圖於 {APP_DIR / 'previews'}")
        return

    if args.test:
        slips = print_order_three_slips(make_test_order_job(cfg), cfg)
        print(f"✅ 三聯測試單已送出列印：{', '.join(slips)}")
        return

    daemon = MealFlowPrintBridgeDaemon(cfg)
    try:
        if args.no_tray:
            daemon.run_loop()
        else:
            run_with_optional_tray(daemon)
    except KeyboardInterrupt:
        daemon.stop()
        logger.info("👋 已安全停止 MealFlow 自動出單機程式。")


if __name__ == "__main__":
    main()
