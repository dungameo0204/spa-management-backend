-- ROSA ONLY. Execute through scripts/apply-rosa-schema.js, never on ports 3306/3307.
-- DDL implicitly commits: backup first. Script records applied steps and supports resume.
ALTER TABLE customers
 ADD COLUMN profile_code VARCHAR(50) NULL,
 ADD COLUMN profile_date DATE NULL,
 ADD COLUMN gender VARCHAR(20) NULL,
 ADD COLUMN skin_types JSON NULL,
 ADD COLUMN referral_sources JSON NULL,
 ADD COLUMN referral_note TEXT NULL,
 ADD COLUMN previous_skin_treatments TEXT NULL,
 ADD COLUMN peeling_products_history TEXT NULL,
 ADD COLUMN current_skincare_products TEXT NULL,
 ADD COLUMN skincare_routine TEXT NULL,
 ADD COLUMN pigmentation_onset TEXT NULL,
 ADD COLUMN family_skin_history TEXT NULL,
 ADD COLUMN pregnancy_and_medical_history TEXT NULL,
 ADD COLUMN cosmetic_reaction_history TEXT NULL,
 ADD COLUMN skin_assessment TEXT NULL,
 ADD COLUMN consultation_note TEXT NULL,
 ADD UNIQUE KEY uq_customer_profile_code (profile_code);

CREATE TABLE customer_skin_images (
 id INT NOT NULL AUTO_INCREMENT,
 customer_id INT NOT NULL,
 captured_date DATE NOT NULL,
 file_path VARCHAR(1000) NOT NULL,
 original_filename VARCHAR(255) NULL,
 mime_type VARCHAR(100) NULL,
 file_size BIGINT UNSIGNED NULL,
 note TEXT NULL,
 created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 deleted_at DATETIME NULL,
 created_by VARCHAR(100) NULL,
 updated_by VARCHAR(100) NULL,
 deleted_by VARCHAR(100) NULL,
 PRIMARY KEY (id),
 KEY idx_skin_customer_date (customer_id, captured_date),
 CONSTRAINT fk_skin_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_service_components (
 id INT NOT NULL AUTO_INCREMENT,
 parent_product_id INT NOT NULL,
 child_product_id INT NOT NULL,
 sort_order INT NOT NULL DEFAULT 0,
 created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 deleted_at DATETIME NULL,
 created_by VARCHAR(100) NULL,
 updated_by VARCHAR(100) NULL,
 deleted_by VARCHAR(100) NULL,
 PRIMARY KEY (id),
 UNIQUE KEY uq_product_component (parent_product_id, child_product_id),
 CONSTRAINT fk_component_parent FOREIGN KEY (parent_product_id) REFERENCES products (id),
 CONSTRAINT fk_component_child FOREIGN KEY (child_product_id) REFERENCES products (id),
 CONSTRAINT chk_component_not_self CHECK (parent_product_id <> child_product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE customer_bookings
 MODIFY COLUMN customer_phone VARCHAR(50) NULL,
 MODIFY COLUMN booking_time DATETIME NULL,
 ADD COLUMN customer_type VARCHAR(10) NULL,
 ADD COLUMN promotion_note TEXT NULL,
 ADD COLUMN arrival_date DATE NULL,
 ADD COLUMN arrival_time TIME NULL,
 ADD COLUMN consultation_total DECIMAL(15,2) NOT NULL DEFAULT 0,
 ADD KEY idx_booking_arrival (branch_id, arrival_date, arrival_time),
 ADD CONSTRAINT chk_booking_total CHECK (consultation_total >= 0),
 ADD CONSTRAINT chk_booking_time CHECK (arrival_time IS NULL OR (arrival_time >= '00:00:00' AND arrival_time < '24:00:00'));

UPDATE customer_bookings SET
 customer_type = CASE WHEN customer_id IS NULL THEN 'NEW' ELSE 'EXISTING' END,
 arrival_date = DATE(booking_time), arrival_time = TIME(booking_time);

ALTER TABLE customer_bookings
 MODIFY COLUMN customer_type VARCHAR(10) NOT NULL,
 MODIFY COLUMN arrival_date DATE NOT NULL,
 ADD CONSTRAINT chk_booking_customer CHECK (
   (customer_type = 'NEW' AND customer_id IS NULL AND CHAR_LENGTH(TRIM(customer_name)) > 0 AND customer_phone IS NOT NULL AND CHAR_LENGTH(TRIM(customer_phone)) > 0)
   OR (customer_type = 'EXISTING' AND customer_id IS NOT NULL)
 );

ALTER TABLE treatments
 MODIFY COLUMN total_sessions INT NULL,
 MODIFY COLUMN remaining_sessions INT NULL,
 ADD COLUMN parent_treatment_id INT NULL,
 ADD COLUMN closed_at DATETIME NULL,
 ADD COLUMN closed_by VARCHAR(100) NULL,
 ADD COLUMN closure_note TEXT NULL,
 ADD COLUMN closure_signature_svg MEDIUMTEXT NULL,
 ADD KEY idx_treatment_parent (parent_treatment_id),
 ADD CONSTRAINT fk_treatment_parent FOREIGN KEY (parent_treatment_id) REFERENCES treatments (id),
 ADD CONSTRAINT chk_treatment_sessions CHECK (
   (total_sessions IS NULL AND (remaining_sessions IS NULL OR remaining_sessions = 0))
   OR (total_sessions IS NOT NULL AND total_sessions > 0 AND remaining_sessions IS NOT NULL AND remaining_sessions >= 0 AND remaining_sessions <= total_sessions)
 ),
 ADD CONSTRAINT chk_treatment_closure CHECK (closed_at IS NULL OR (remaining_sessions IS NOT NULL AND remaining_sessions = 0));

ALTER TABLE treatment_history
 ADD COLUMN customer_signature_svg MEDIUMTEXT NULL,
 ADD COLUMN customer_signed_at DATETIME NULL;