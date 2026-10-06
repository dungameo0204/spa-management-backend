-- Migration cho MỘT database tenant đã có bảng customer_wallet_logs.
-- Thay `your_tenant_database` bằng database_name trong db_system_master.tenants.
-- Chạy một lần trên từng database tenant. Không chạy trên db_system_master.

USE `your_tenant_database`;

-- Lưu được phần trăm lẻ khi người dùng nhập bonus_amount và hệ thống tính ngược bonus_percent.
ALTER TABLE `customer_wallet_logs`
  MODIFY COLUMN `bonus_percent` decimal(7,2) NOT NULL DEFAULT '0.00';