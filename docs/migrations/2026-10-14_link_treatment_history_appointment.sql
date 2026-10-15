-- Run on each existing tenant database before deploying the service change.
-- Old history rows remain NULL; there is no reliable way to identify their generated appointments.
ALTER TABLE treatment_history
  ADD COLUMN appointment_id int DEFAULT NULL AFTER branch_id,
  ADD KEY appointment_id (appointment_id),
  ADD CONSTRAINT treatment_history_ibfk_3 FOREIGN KEY (appointment_id) REFERENCES appointments (id);