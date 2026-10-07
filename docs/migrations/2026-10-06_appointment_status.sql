-- Chạy trên từng tenant DB hiện có; API tính trạng thái động từ invoices/treatment_history.
UPDATE appointments SET status = 'Khách chưa đến'
WHERE status IS NULL OR status <> 'Khách chưa đến';
ALTER TABLE appointments MODIFY COLUMN status varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Khách chưa đến';