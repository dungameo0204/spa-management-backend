-- Run on db_spa_template and each tenant database that will use legacy debt receipts.
-- Select the intended database explicitly before running; back up first.
-- Existing invoice-linked receipts and their foreign key remain unchanged.
ALTER TABLE debt_payments MODIFY COLUMN invoice_id int NULL DEFAULT NULL;

-- Verification: SHOW COLUMNS FROM debt_payments LIKE 'invoice_id';
-- Expected Null = YES. Do not revert to NOT NULL while legacy receipts exist.