-- Preserve any legacy text as one entry, without guessing multiline boundaries/dates.
CREATE TABLE appointment_contact_notes (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    content TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
    contact_date DATE NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100) NULL,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(100) NULL,
    deleted_at DATETIME NULL,
    deleted_by VARCHAR(100) NULL,
    KEY appointment_contact_active (appointment_id, deleted_at, id),
    CONSTRAINT appointment_contact_notes_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO appointment_contact_notes (appointment_id, content, contact_date, created_at, created_by)
SELECT id, extra_note, NULL, created_at, created_by FROM appointments WHERE extra_note IS NOT NULL AND extra_note <> '';