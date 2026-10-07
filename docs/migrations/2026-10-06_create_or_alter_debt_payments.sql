-- Chạy THỦ CÔNG cho từng database tenant, KHÔNG trên master. Sao lưu và dừng ghi phiếu thu nợ.
-- Tra database_name từ db_system_master.tenants, thay placeholder; chọn CHỈ MỘT nhánh A/B.

USE `your_tenant_database`;
SELECT DATABASE() AS target_database;
SHOW TABLES LIKE 'debt_payments';

-- NHÁNH A: chỉ chạy nếu bảng chưa tồn tại; KHÔNG chạy nhánh B.
CREATE TABLE IF NOT EXISTS `debt_payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `branch_id` int NOT NULL COMMENT 'Chi nhánh hóa đơn / hạch toán',
  `collection_branch_id` int NOT NULL COMMENT 'Chi nhánh thực thu / phân quyền STAFF',
  `invoice_id` int NOT NULL,
  `amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `payment_method` enum('CASH','TRANSFER','CARD') NOT NULL DEFAULT 'CASH',
  `payment_date` datetime NOT NULL,
  `note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `updated_by` varchar(255) DEFAULT NULL,
  `deleted_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_dp_customer` (`customer_id`),
  KEY `fk_dp_branch` (`branch_id`),
  KEY `fk_dp_collection_branch` (`collection_branch_id`),
  KEY `fk_dp_invoice` (`invoice_id`),
  CONSTRAINT `fk_dp_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_dp_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_dp_collection_branch` FOREIGN KEY (`collection_branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_dp_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NHÁNH B: chỉ chạy nếu bảng ĐÃ tồn tại; KHÔNG chạy nhánh A.
-- SHOW CREATE TABLE debt_payments; SHOW COLUMNS FROM debt_payments;
-- Nếu cột thiếu, thêm TẠM NULL, từng cột theo kết quả SHOW COLUMNS:
-- ALTER TABLE debt_payments ADD COLUMN invoice_id int NULL AFTER branch_id;
-- ALTER TABLE debt_payments ADD COLUMN branch_id int NULL AFTER customer_id;
-- ALTER TABLE debt_payments ADD COLUMN collection_branch_id int NULL AFTER branch_id;
-- Với bảng thiếu cả branch_id và invoice_id, thêm branch_id TRƯỚC invoice_id.
-- Kiểm tra TẤT CẢ bản ghi (kể cả đã xóa mềm); KHÔNG tự gán invoice_id tùy tiện:
-- SELECT COUNT(*) AS total, SUM(invoice_id IS NULL) AS without_invoice FROM debt_payments;
-- SELECT id, customer_id, branch_id, collection_branch_id, invoice_id, deleted_at
-- FROM debt_payments WHERE invoice_id IS NULL;
-- Nếu collection_branch_id chưa thêm, bỏ cột đó khỏi SELECT cho tới khi đã ADD COLUMN.
-- SELECT dp.id, dp.customer_id, i.customer_id AS invoice_customer_id,
--        dp.branch_id, i.branch_id AS invoice_branch_id, dp.invoice_id
-- FROM debt_payments dp LEFT JOIN invoices i ON i.id = dp.invoice_id
-- WHERE dp.invoice_id IS NOT NULL AND
--       (i.id IS NULL OR dp.customer_id <> i.customer_id OR dp.branch_id <> i.branch_id);
-- Đối soát từng phiếu thiếu invoice_id với chứng từ gốc; nếu không xác định được,
-- DỪNG và điều tra, không chạy ALTER. Nếu customer_id không khớp invoice, đối soát
-- customers.total_debt (và phiếu đã xóa mềm) trước khi sửa dữ liệu.
-- Nếu branch_id cũ được xác nhận là nơi THỰC THU, lưu lại trước khi sửa hạch toán:
-- UPDATE debt_payments SET collection_branch_id = branch_id WHERE collection_branch_id IS NULL;
-- Nếu không thể xác nhận branch_id cũ là nơi thực thu, backfill collection_branch_id
-- theo chứng từ TỪNG phiếu; tuyệt đối không dùng một branch mặc định.
-- Sau khi lưu nơi thực thu, đồng bộ chi nhánh hạch toán từ invoice:
-- UPDATE debt_payments dp JOIN invoices i ON i.id = dp.invoice_id
-- SET dp.branch_id = i.branch_id WHERE dp.branch_id IS NULL OR dp.branch_id <> i.branch_id;
-- Các truy vấn sau BẮT BUỘC trả 0 hàng trước khi áp dụng NOT NULL và FK:
-- SELECT dp.id, dp.customer_id, dp.branch_id, dp.collection_branch_id, dp.invoice_id
-- FROM debt_payments dp
-- LEFT JOIN invoices i ON i.id = dp.invoice_id
-- LEFT JOIN customers c ON c.id = dp.customer_id
-- LEFT JOIN branches b ON b.id = dp.branch_id
-- LEFT JOIN branches cb ON cb.id = dp.collection_branch_id
-- WHERE dp.invoice_id IS NULL OR dp.customer_id IS NULL OR dp.branch_id IS NULL
--    OR dp.collection_branch_id IS NULL OR i.id IS NULL OR c.id IS NULL OR b.id IS NULL OR cb.id IS NULL
--    OR dp.customer_id <> i.customer_id OR dp.branch_id <> i.branch_id;
-- SELECT dp.invoice_id, SUM(dp.amount) AS paid, MAX(i.debt_amount) AS invoice_debt
-- FROM debt_payments dp JOIN invoices i ON i.id = dp.invoice_id
-- WHERE dp.deleted_at IS NULL GROUP BY dp.invoice_id HAVING paid > invoice_debt;
-- Chỉ sau khi dữ liệu sạch, chạy ALTER từng lệnh phù hợp schema thực tế:
-- ALTER TABLE debt_payments MODIFY COLUMN invoice_id int NOT NULL;
-- ALTER TABLE debt_payments MODIFY COLUMN branch_id int NOT NULL;
-- ALTER TABLE debt_payments MODIFY COLUMN collection_branch_id int NOT NULL;
-- Nếu thiếu index/FK, thêm một lần (kiểm tra SHOW CREATE TABLE trước):
-- ALTER TABLE debt_payments ADD KEY fk_dp_collection_branch (collection_branch_id),
--   ADD CONSTRAINT fk_dp_collection_branch FOREIGN KEY (collection_branch_id) REFERENCES branches (id);
-- ALTER TABLE debt_payments ADD KEY fk_dp_invoice (invoice_id),
--   ADD CONSTRAINT fk_dp_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id);
-- ALTER TABLE debt_payments ADD KEY fk_dp_branch (branch_id),
--   ADD CONSTRAINT fk_dp_branch FOREIGN KEY (branch_id) REFERENCES branches (id);
-- ALTER TABLE debt_payments ADD KEY fk_dp_customer (customer_id),
--   ADD CONSTRAINT fk_dp_customer FOREIGN KEY (customer_id) REFERENCES customers (id);
-- Chỉ chạy ADD KEY/ADD CONSTRAINT nào thực sự còn thiếu; kiểm tra SHOW CREATE TABLE sau cùng.