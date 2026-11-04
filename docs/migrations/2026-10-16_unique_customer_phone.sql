-- Chạy thủ công trên TỪNG database tenant; KHÔNG chạy trên db_system_master.
-- Sao lưu trước khi chạy. Ưu tiên scripts/apply-customer-upgrade.js vì SQL này không idempotent.
-- Thay your_tenant_database bằng database_name trong db_system_master.tenants.
USE `your_tenant_database`;

-- Phải xử lý hết các nhóm trùng của khách ĐANG HOẠT ĐỘNG trước khi ADD UNIQUE.
-- Kiểm tra từng khách, hóa đơn, ví, công nợ và lịch sử trước khi hợp nhất/đổi SĐT;
-- KHÔNG tự động xóa khách trùng hoặc đổi số khi chưa đối soát.
SELECT phone_number, COUNT(*) AS duplicate_count, GROUP_CONCAT(id ORDER BY id) AS customer_ids
FROM customers
WHERE deleted_at IS NULL AND phone_number IS NOT NULL
GROUP BY phone_number
HAVING COUNT(*) > 1;

-- Nếu truy vấn trùng còn dòng, KHÔNG chạy ALTER.
SHOW INDEX FROM customers WHERE Key_name = 'uq_customers_phone_number';

ALTER TABLE customers
  ADD COLUMN active_phone_number VARCHAR(15)
    GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN phone_number ELSE NULL END) STORED
    AFTER deleted_at,
  ADD UNIQUE KEY uq_customers_active_phone_number (active_phone_number),
  DROP INDEX uq_customers_phone_number;