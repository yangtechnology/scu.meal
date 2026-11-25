-- MealFlow Cloudflare D1 Database Schema (9 Core Tables)
-- 對應原 Google Apps Script (code.gs) 之試算表與 ScriptProperties

-- 1. 店家基本資料與擴充設定
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  campus TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  max_capacity_per_15min INTEGER DEFAULT 20,
  base_prep_minutes INTEGER DEFAULT 4,
  cutlery_price INTEGER DEFAULT 1,
  promo_mode TEXT DEFAULT 'none',
  promo_text TEXT DEFAULT '',
  promo_discount INTEGER DEFAULT 0,
  rating REAL DEFAULT 4.8,
  is_open INTEGER DEFAULT 1,
  custom_meta_json TEXT DEFAULT '{}', -- 營業時間、公休、組合折扣、優惠券、前台分類、LINE開關、預訂提前分鐘數等
  deleted_at INTEGER DEFAULT NULL
);

-- 2. 菜單品項
CREATE TABLE IF NOT EXISTS menus (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  tag TEXT DEFAULT '',
  category TEXT DEFAULT '招牌主餐',
  image TEXT DEFAULT '',
  options_json TEXT DEFAULT '{}',
  sold_out INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 999
);
CREATE INDEX IF NOT EXISTS idx_menus_store ON menus(store_id);

-- 3. 訂單主表
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  pickup_number TEXT NOT NULL,
  store_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  student_id TEXT DEFAULT '',
  student_name TEXT DEFAULT '',
  items_json TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER DEFAULT 0,
  cutlery_fee INTEGER DEFAULT 0,
  takeout_fee INTEGER DEFAULT 0,
  service_fee INTEGER DEFAULT 0,
  final_total INTEGER NOT NULL,
  promo_applied TEXT DEFAULT '',
  dine_type TEXT DEFAULT '外帶自取',
  pickup_date TEXT NOT NULL,      -- YYYY-MM-DD
  pickup_time TEXT NOT NULL,      -- HH:mm
  pickup_time_slot TEXT DEFAULT '',
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  paid_at_date TEXT DEFAULT '',
  status TEXT NOT NULL,
  is_reservation INTEGER DEFAULT 0,
  print_status TEXT DEFAULT 'PENDING', -- PENDING / PRINTED
  preprint_done INTEGER DEFAULT 0,     -- 預訂反黑聯是否已印過
  needs_print INTEGER NOT NULL DEFAULT 0, -- 1=尚有待印出單任務, 0=無需出單（配合索引讓無新單時 rows_read=0）
  customer_phone TEXT DEFAULT '',
  line_user_id TEXT DEFAULT '',
  verification_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_at_ts INTEGER NOT NULL,
  extra_meta_json TEXT DEFAULT '{}'    -- 時間軸、退單、分帳、留言、劃單狀態、notifyCount、clientDeviceId 等
);
CREATE INDEX IF NOT EXISTS idx_orders_store_date ON orders(store_id, pickup_date);
CREATE INDEX IF NOT EXISTS idx_orders_created_ts ON orders(created_at_ts DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_store_needs_print ON orders(store_id, needs_print, pickup_date, created_at_ts DESC);
CREATE INDEX IF NOT EXISTS idx_orders_active_status ON orders(status, created_at_ts DESC);

-- 4. 原子單號計數器（徹底取代 GAS ScriptLock，100 人同時點也不撞號）
CREATE TABLE IF NOT EXISTS pickup_counters (
  store_id TEXT NOT NULL,
  pickup_date TEXT NOT NULL,
  channel TEXT NOT NULL, -- 'POS' (001~100) 或 'ONLINE' (101~200)
  seq_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, pickup_date, channel)
);

-- 5. 防重複下單金鑰表 (clientRequestId)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  req_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  created_at_ts INTEGER NOT NULL
);

-- 6. 交班日結表
CREATE TABLE IF NOT EXISTS shift_reports (
  shift_key TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  date_str TEXT NOT NULL,
  shift_slot TEXT NOT NULL,
  status TEXT NOT NULL,
  cashier_name TEXT DEFAULT '',
  opening_float INTEGER DEFAULT 0,
  expected_cash INTEGER DEFAULT 0,
  actual_counted_cash INTEGER DEFAULT 0,
  variance INTEGER DEFAULT 0,
  petty_cash_json TEXT DEFAULT '[]',
  summary_json TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shift_store_updated ON shift_reports(store_id, updated_at DESC);

-- 7. 店務稽核紀錄
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  date_str TEXT NOT NULL,
  store_id TEXT NOT NULL,
  staff_name TEXT DEFAULT '',
  staff_role TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_store_ts ON audit_logs(store_id, ts DESC);

-- 8. 會員資料
CREATE TABLE IF NOT EXISTS members (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  tax_id TEXT DEFAULT '',
  points INTEGER DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  favorite_items_json TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- 9. 系統與各店機密設定（PIN Hash、員工帳號、LINE/LINE Pay 金鑰、印表機金鑰）
CREATE TABLE IF NOT EXISTS kv_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
