-- Run on the three databases after backing them up. Re-running safely skips
-- vouchers that already have items. Keep expense_vouchers.amount as the total
-- and expense_type as the legacy summary for existing clients/reports.

CREATE TABLE IF NOT EXISTS `db_spa_template`.`expenses_vouchers_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `expenses_voucher_id` int NOT NULL,
  `expense_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_expenses_voucher_id` (`expenses_voucher_id`),
  CONSTRAINT `fk_expenses_vouchers_items_voucher` FOREIGN KEY (`expenses_voucher_id`) REFERENCES `db_spa_template`.`expense_vouchers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idempotent backfill of old single-line vouchers.
INSERT INTO `db_spa_template`.`expenses_vouchers_items` (`expenses_voucher_id`, `expense_type`, `amount`)
SELECT e.id, e.expense_type, e.amount FROM `db_spa_template`.`expense_vouchers` e
WHERE NOT EXISTS (SELECT 1 FROM `db_spa_template`.`expenses_vouchers_items` x WHERE x.expenses_voucher_id = e.id);

CREATE TABLE IF NOT EXISTS `db_spa_1791642286670_c571`.`expenses_vouchers_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `expenses_voucher_id` int NOT NULL,
  `expense_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_expenses_voucher_id` (`expenses_voucher_id`),
  CONSTRAINT `fk_expenses_vouchers_items_voucher` FOREIGN KEY (`expenses_voucher_id`) REFERENCES `db_spa_1791642286670_c571`.`expense_vouchers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO `db_spa_1791642286670_c571`.`expenses_vouchers_items` (`expenses_voucher_id`, `expense_type`, `amount`)
SELECT e.id, e.expense_type, e.amount FROM `db_spa_1791642286670_c571`.`expense_vouchers` e
WHERE NOT EXISTS (SELECT 1 FROM `db_spa_1791642286670_c571`.`expenses_vouchers_items` x WHERE x.expenses_voucher_id = e.id);

CREATE TABLE IF NOT EXISTS `db_spa_1791039769068_e185`.`expenses_vouchers_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `expenses_voucher_id` int NOT NULL,
  `expense_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_expenses_voucher_id` (`expenses_voucher_id`),
  CONSTRAINT `fk_expenses_vouchers_items_voucher` FOREIGN KEY (`expenses_voucher_id`) REFERENCES `db_spa_1791039769068_e185`.`expense_vouchers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO `db_spa_1791039769068_e185`.`expenses_vouchers_items` (`expenses_voucher_id`, `expense_type`, `amount`)
SELECT e.id, e.expense_type, e.amount FROM `db_spa_1791039769068_e185`.`expense_vouchers` e
WHERE NOT EXISTS (SELECT 1 FROM `db_spa_1791039769068_e185`.`expenses_vouchers_items` x WHERE x.expenses_voucher_id = e.id);