-- Run with USE db_spa_template; and repeat with USE <each existing tenant_db>;
-- Back up each database first. Run once per database, before starting the new backend.
CREATE TABLE product_commission_tiers (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id int NOT NULL,
  role_id int NOT NULL,
  min_price decimal(15,2) NOT NULL,
  max_price decimal(15,2) DEFAULT NULL,
  calculation_type enum('FIXED','PERCENT') NOT NULL,
  fixed_amount decimal(15,2) NOT NULL DEFAULT 0,
  percent decimal(5,2) NOT NULL DEFAULT 0,
  created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  created_by varchar(100) DEFAULT NULL,
  UNIQUE KEY product_role_min (product_id, role_id, min_price),
  KEY role_id (role_id),
  CONSTRAINT pct_product_fk FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT pct_role_fk FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE treatments
  ADD COLUMN invoice_item_id int DEFAULT NULL AFTER invoice_id,
  ADD COLUMN commission_base_price decimal(15,2) DEFAULT NULL AFTER invoice_item_id,
  ADD COLUMN commission_quantity int NOT NULL DEFAULT 1 AFTER commission_base_price,
  ADD KEY invoice_item_id (invoice_item_id),
  ADD CONSTRAINT treatments_invoice_item_fk FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id);

-- Link only unambiguous invoice/product pairs: exactly one active line and one active card.
-- Workbench Safe Updates rejects UPDATE ... JOIN without a key-based WHERE.
-- Keep and restore the session setting after BOTH backfill updates.
SET @commission_migration_old_safe_updates = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

UPDATE treatments t
JOIN (SELECT invoice_id, product_id, MIN(id) id FROM invoice_items
      WHERE deleted_at IS NULL GROUP BY invoice_id, product_id HAVING COUNT(*) = 1) ii
  ON ii.invoice_id = t.invoice_id AND ii.product_id = t.product_id
JOIN (SELECT invoice_id, product_id FROM treatments
      WHERE deleted_at IS NULL AND invoice_id IS NOT NULL
      GROUP BY invoice_id, product_id HAVING COUNT(*) = 1) cards
  ON cards.invoice_id = t.invoice_id AND cards.product_id = t.product_id
SET t.invoice_item_id = ii.id
WHERE t.deleted_at IS NULL;

-- Backfill old commissions only when the sold price can be identified; old manual
-- cards and ambiguous duplicate lines deliberately stay unresolved (old 0 amounts).
UPDATE treatment_history_staffs ths
JOIN treatment_history th ON th.id = ths.treatment_history_id AND th.deleted_at IS NULL
JOIN treatments t ON t.id = th.treatment_id AND t.deleted_at IS NULL
JOIN invoice_items ii ON ii.id = t.invoice_item_id AND ii.deleted_at IS NULL
JOIN products p ON p.id = t.product_id
JOIN staffs s ON s.id = ths.staff_id
LEFT JOIN product_commissions pc ON pc.product_id = t.product_id AND pc.role_id = s.role_id AND pc.deleted_at IS NULL
SET ths.commission_amount_snapshot = ROUND((COALESCE(pc.commission_fixed_amount, 0)
    + ii.snapshot_price * COALESCE(pc.commission_percent, 0) / 100)
    * IF(p.is_treatment_combo = 1, 1, ii.quantity), 2)
WHERE ths.deleted_at IS NULL;

-- COALESCE also allows executing this line alone in a new Workbench connection.
SET SESSION SQL_SAFE_UPDATES = COALESCE(@commission_migration_old_safe_updates, 1);

-- Reject mismatched links discovered by manual reconciliation.
SELECT t.id AS treatment_id, t.invoice_item_id
FROM treatments t JOIN invoice_items ii ON ii.id = t.invoice_item_id
WHERE t.invoice_id <> ii.invoice_id OR t.product_id <> ii.product_id;

-- Review unresolved cards before payroll / execution (never guess a sale price).
SELECT t.id, t.invoice_id, t.product_id, t.total_sessions - t.remaining_sessions AS used_sessions
FROM treatments t WHERE t.deleted_at IS NULL AND t.invoice_item_id IS NULL;