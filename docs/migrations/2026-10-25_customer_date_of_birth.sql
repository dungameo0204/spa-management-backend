-- Manual reference only: select ONE backed-up database and inspect information_schema first.
-- Do not execute if the column already exists. Prefer apply-customer-upgrade.js.
ALTER TABLE customers ADD COLUMN date_of_birth DATE NULL AFTER phone_number;
-- Existing customers intentionally keep NULL; no estimated birthdays or session backfills.