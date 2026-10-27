-- Rosa 3308 only. Run via guarded runner after a verified backup.
-- Existing history rows retain NULL; no changes to sessions, signatures or commissions.
ALTER TABLE treatment_history ADD COLUMN note TEXT NULL;