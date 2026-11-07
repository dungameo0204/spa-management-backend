-- Xuly customer-bookings upgrade for ONE existing tenant database at a time.
-- Target schema expected before this migration: the legacy customer_bookings table
-- with booking_time DATETIME NOT NULL and without the five fields added below.
--
-- IMPORTANT
-- 1) Back up and restore-test the verified tenant database first.
-- 2) Stop backend/MiniApp/Workbench writes to customer_bookings while applying.
-- 3) Run every statement in ONE Workbench session after choosing the exact tenant DB.
-- 4) This is NOT idempotent. Do not rerun ALTER statements blindly after an error.
-- 5) This file never changes invoices, treatments, inventory, wallet or debt.

-- Replace with the verified database_name from db_system_master.tenants.
-- USE `db_spa_1234_abcd`;

-- Confirm the selected schema and inspect the legacy columns before changing anything.
SELECT DATABASE() AS selected_database;
SHOW CREATE TABLE customer_bookings;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'customer_bookings'
ORDER BY ORDINAL_POSITION;

-- Expected for the old Xuly schema: customer_type/promotion_note/arrival_date/
-- arrival_time/consultation_total are absent, booking_time and customer_phone are NOT NULL.
-- If any target column/index/constraint already exists, STOP and inspect its exact state.
SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'customer_bookings'
  AND COLUMN_NAME IN ('customer_type', 'promotion_note', 'arrival_date', 'arrival_time', 'consultation_total');

SELECT INDEX_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'customer_bookings'
  AND INDEX_NAME = 'idx_booking_arrival';

SELECT CONSTRAINT_NAME
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME = 'customer_bookings'
  AND CONSTRAINT_NAME IN ('chk_booking_total', 'chk_booking_time', 'chk_booking_customer');

-- Preflight: every legacy row must become a valid NEW or EXISTING booking.
-- This query MUST return zero rows before the ALTER. Do not invent names, phone
-- numbers, dates or times for records returned here; repair them deliberately first.
SELECT id, customer_id, customer_name, customer_phone, booking_time
FROM customer_bookings
WHERE booking_time IS NULL
   OR (customer_id IS NULL
       AND (customer_name IS NULL OR CHAR_LENGTH(TRIM(customer_name)) = 0
            OR customer_phone IS NULL OR CHAR_LENGTH(TRIM(customer_phone)) = 0));

-- Optional evidence to record with the migration ticket before applying.
SELECT COUNT(*) AS booking_count,
       SUM(customer_id IS NULL) AS legacy_new_count,
       SUM(customer_id IS NOT NULL) AS legacy_existing_count
FROM customer_bookings;

-- Preserve and temporarily disable Safe Updates in THIS session only. This is needed
-- because the backfill below intentionally updates all existing booking rows.
SET @customer_bookings_old_safe_updates := @@SQL_SAFE_UPDATES;
SET SQL_SAFE_UPDATES = 0;

-- MySQL DDL implicitly commits. If an ALTER fails or the session is interrupted,
-- do not restart this script. Re-run the metadata SELECT queries above and apply
-- only the verified missing operation after reviewing the partial schema.
ALTER TABLE customer_bookings
  MODIFY COLUMN customer_phone VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN booking_time DATETIME NULL,
  ADD COLUMN customer_type VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  ADD COLUMN promotion_note TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  ADD COLUMN arrival_date DATE NULL,
  ADD COLUMN arrival_time TIME NULL,
  ADD COLUMN consultation_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD KEY idx_booking_arrival (branch_id, arrival_date, arrival_time),
  ADD CONSTRAINT chk_booking_total CHECK (consultation_total >= 0),
  ADD CONSTRAINT chk_booking_time CHECK (arrival_time IS NULL OR (arrival_time >= '00:00:00' AND arrival_time < '24:00:00'));

-- Preserve old schedule semantics: classification uses existing customer_id, and
-- arrival date/time are split from the old booking_time in the database timezone.
UPDATE customer_bookings
SET customer_type = CASE WHEN customer_id IS NULL THEN 'NEW' ELSE 'EXISTING' END,
    arrival_date = DATE(booking_time),
    arrival_time = TIME(booking_time);

-- Verify backfill before making new fields mandatory and adding the customer rule.
SELECT id, customer_type, customer_id, customer_name, customer_phone,
       booking_time, arrival_date, arrival_time, consultation_total
FROM customer_bookings
WHERE customer_type NOT IN ('NEW', 'EXISTING')
   OR arrival_date IS NULL
   OR consultation_total < 0
   OR (customer_type = 'NEW' AND (customer_id IS NOT NULL
       OR customer_name IS NULL OR CHAR_LENGTH(TRIM(customer_name)) = 0
       OR customer_phone IS NULL OR CHAR_LENGTH(TRIM(customer_phone)) = 0))
   OR (customer_type = 'EXISTING' AND customer_id IS NULL);

-- The verification query above MUST return zero rows before this final ALTER.
ALTER TABLE customer_bookings
  MODIFY COLUMN customer_type VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN arrival_date DATE NOT NULL,
  ADD CONSTRAINT chk_booking_customer CHECK (
    (customer_type = 'NEW' AND customer_id IS NULL
      AND CHAR_LENGTH(TRIM(customer_name)) > 0
      AND customer_phone IS NOT NULL AND CHAR_LENGTH(TRIM(customer_phone)) > 0)
    OR (customer_type = 'EXISTING' AND customer_id IS NOT NULL)
  );

-- Restore the caller's Safe Updates setting in the same session.
SET SQL_SAFE_UPDATES = @customer_bookings_old_safe_updates;

-- Final post-check: expect zero invalid rows and the booking index/constraints present.
SELECT id, customer_type, customer_id, customer_name, customer_phone,
       arrival_date, arrival_time, consultation_total
FROM customer_bookings
WHERE customer_type NOT IN ('NEW', 'EXISTING')
   OR arrival_date IS NULL
   OR consultation_total < 0;

SHOW CREATE TABLE customer_bookings;