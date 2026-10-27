-- ROSA 3308 ONLY. Run through apply-rosa-image-sessions.js with a fresh backup.
-- Each legacy image becomes its own session, preserving image IDs and metadata.
CREATE TABLE customer_skin_image_sessions (
 id INT NOT NULL AUTO_INCREMENT,
 customer_id INT NOT NULL,
 captured_date DATE NOT NULL,
 note TEXT NULL,
 created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 deleted_at DATETIME NULL,
 created_by VARCHAR(100) NULL,
 updated_by VARCHAR(100) NULL,
 deleted_by VARCHAR(100) NULL,
 PRIMARY KEY (id),
 KEY idx_skin_session_customer_date (customer_id, captured_date, id),
 CONSTRAINT fk_skin_session_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE customer_skin_images
 ADD COLUMN session_id INT NULL AFTER id,
 ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER file_size;

INSERT INTO customer_skin_image_sessions
 (id, customer_id, captured_date, created_at, updated_at, deleted_at, created_by, updated_by, deleted_by)
 SELECT id, customer_id, captured_date, created_at, updated_at, deleted_at, created_by, updated_by, deleted_by
 FROM customer_skin_images;

-- Preserve updated_at: linking a legacy image is not a user edit.
UPDATE customer_skin_images SET session_id = id, updated_at = updated_at WHERE session_id IS NULL;

ALTER TABLE customer_skin_images
 DROP FOREIGN KEY fk_skin_customer,
 DROP INDEX idx_skin_customer_date,
 DROP COLUMN customer_id,
 DROP COLUMN captured_date,
 MODIFY COLUMN session_id INT NOT NULL,
 ADD KEY idx_skin_image_session_order (session_id, sort_order, id),
 ADD CONSTRAINT fk_skin_image_session FOREIGN KEY (session_id) REFERENCES customer_skin_image_sessions (id);