-- Migration cho MỘT database Spa đã được tạo trước ngày 03/10/2026.
-- Thay `your_tenant_database` bằng database_name tương ứng trong db_system_master.tenants.
-- Chạy một lần trên từng database tenant. Không chạy trên db_system_master.

USE `your_tenant_database`;

-- Điều kiện bắt buộc để API nhập kho dùng UPSERT an toàn.
-- Trước khi chạy, xử lý các bản ghi inventory trùng (branch_id, product_id) nếu đang tồn tại.
ALTER TABLE `inventory`
  ADD UNIQUE KEY `uniq_inventory_branch_product` (`branch_id`, `product_id`);

CREATE TABLE `inventory_imports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `branch_id` int NOT NULL COMMENT 'Nhập vào cơ sở nào',
  `import_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Mã phiếu nhập',
  `import_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Ngày giờ nhập hàng thực tế',
  `supplier_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `note` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deleted_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_inventory_imports_code` (`import_code`),
  KEY `fk_ii_branch` (`branch_id`),
  CONSTRAINT `fk_ii_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventory_import_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `inventory_import_id` int NOT NULL,
  `product_id` int NOT NULL,
  `product_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` int NOT NULL,
  `unit_price` decimal(15,2) NOT NULL,
  `discount_percent` int DEFAULT '0',
  `discount_amount` decimal(15,2) DEFAULT '0.00',
  `total_price` decimal(15,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `created_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deleted_by` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_iii_import` (`inventory_import_id`),
  KEY `fk_iii_product` (`product_id`),
  CONSTRAINT `fk_iii_import` FOREIGN KEY (`inventory_import_id`) REFERENCES `inventory_imports` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_iii_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;