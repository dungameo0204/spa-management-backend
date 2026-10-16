-- Chạy thủ công trên TỪNG database tenant; KHÔNG chạy trên db_system_master.
-- Sao lưu trước khi chạy. SĐT đã xóa mềm vẫn được giữ lại, nên không thể tái sử dụng.
-- Thay your_tenant_database bằng database_name trong db_system_master.tenants.
USE `your_tenant_database`;

-- Phải xử lý hết các nhóm trùng trước khi ADD UNIQUE; bao gồm cả khách đã xóa mềm.
-- Kiểm tra từng khách, hóa đơn, ví, công nợ và lịch sử trước khi hợp nhất/đổi SĐT;
-- KHÔNG tự động xóa khách trùng hoặc đổi số khi chưa đối soát.
SELECT phone_number, COUNT(*) AS duplicate_count, GROUP_CONCAT(id ORDER BY id) AS customer_ids
FROM customers
WHERE phone_number IS NOT NULL
GROUP BY phone_number
HAVING COUNT(*) > 1;

-- Nếu index đã tồn tại, bỏ qua ALTER; nếu truy vấn trùng còn dòng, KHÔNG chạy ALTER.
SHOW INDEX FROM customers WHERE Key_name = 'uq_customers_phone_number';

ALTER TABLE customers
  ADD UNIQUE KEY uq_customers_phone_number (phone_number);