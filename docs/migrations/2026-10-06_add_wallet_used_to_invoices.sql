-- Migration cho MỘT database tenant. Không chạy trên db_system_master.
-- Thay `your_tenant_database` bằng database_name trong db_system_master.tenants.
-- Chạy một lần cho tenant đã có bảng invoices nhưng chưa có cột wallet_used.

USE `your_tenant_database`;

ALTER TABLE `invoices`
  ADD COLUMN `wallet_used` decimal(15,2) NOT NULL DEFAULT '0.00' AFTER `paid_amount`;

-- Backfill dữ liệu legacy trước đây được lưu trong payment_method theo marker [WALLET:<amount>].
UPDATE `invoices`
SET `wallet_used` = CAST(
  SUBSTRING_INDEX(SUBSTRING_INDEX(`payment_method`, '[WALLET:', -1), ']', 1)
  AS DECIMAL(15,2)
)
WHERE `payment_method` REGEXP '\\[WALLET:[0-9]+(\\.[0-9]+)?\\]';