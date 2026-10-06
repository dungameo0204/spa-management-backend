-- Migration cho MỘT database tenant. Không chạy trên db_system_master.
-- Thay `your_tenant_database` bằng database_name trong db_system_master.tenants.
-- Nếu bảng debt_payments đã tồn tại nhưng chưa có branch_id, chạy phần ALTER bên dưới.

USE `your_tenant_database`;

CREATE TABLE IF NOT EXISTS `debt_payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `branch_id` int NOT NULL,
  `invoice_id` int DEFAULT NULL,
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
  KEY `fk_dp_invoice` (`invoice_id`),
  CONSTRAINT `fk_dp_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_dp_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_dp_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chỉ chạy đoạn này khi bảng debt_payments đã tồn tại từ schema cũ và chưa có branch_id.
-- Chọn một branch hợp lệ để backfill dữ liệu cũ trước khi đổi sang NOT NULL.
-- ALTER TABLE `debt_payments` ADD COLUMN `branch_id` int NULL AFTER `customer_id`;
-- UPDATE `debt_payments` SET `branch_id` = <default_active_branch_id> WHERE `branch_id` IS NULL;
-- ALTER TABLE `debt_payments` MODIFY COLUMN `branch_id` int NOT NULL,
--   ADD KEY `fk_dp_branch` (`branch_id`),
--   ADD CONSTRAINT `fk_dp_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`);