-- Migration 001: 降低 D1 rows_read 耗用（新增 needs_print 欄位與高效查詢索引）
-- 1. orders 表新增 needs_print (1=待出單, 0=無需出單)
ALTER TABLE orders ADD COLUMN needs_print INTEGER NOT NULL DEFAULT 0;

-- 2. 回填既有訂單之 needs_print 狀態
UPDATE orders
SET needs_print = CASE
  WHEN status IN ('已完成', '已退單', '待付款 (LINE Pay 授權中)') OR status LIKE '已取消%' THEN 0
  WHEN status IN ('製作中', '可取餐') AND UPPER(COALESCE(print_status, 'PENDING')) != 'PRINTED' THEN 1
  WHEN (is_reservation = 1 OR status LIKE '%預訂%' OR status LIKE '%預約%' OR status LIKE '%排程%') AND COALESCE(preprint_done, 0) = 0 THEN 1
  ELSE 0
END;

-- 3. 建立精準覆蓋索引，讓 getPendingPrintJobs 無新單時 rows_read = 0
CREATE INDEX IF NOT EXISTS idx_orders_store_needs_print
  ON orders(store_id, needs_print, pickup_date, created_at_ts DESC);

-- 4. 建立進行中狀態索引，讓每 5 分鐘 Cron 不掃歷史已完成/取消單
CREATE INDEX IF NOT EXISTS idx_orders_active_status
  ON orders(status, created_at_ts DESC);

-- 5. 建立交班表索引，加速 initBundle 讀取近期班別
CREATE INDEX IF NOT EXISTS idx_shift_store_updated
  ON shift_reports(store_id, updated_at DESC);
