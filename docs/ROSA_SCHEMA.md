# Bổ sung appointments.extra_note

`appointments.extra_note TEXT NULL` là bản tổng hợp tương thích của ghi chú liên hệ, độc lập với `appointments.note`. Migration `2026-10-27_rosa_appointment_extra_note.sql` và runner `scripts/apply-rosa-appointment-extra-note.js` chỉ dùng Rosa 3308 với backup guard. Tiếp theo migration `2026-10-28_rosa_appointment_contact_notes.sql`/runner `scripts/apply-rosa-appointment-contact-notes.js` tạo bảng phụ `appointment_contact_notes`: id, appointment_id FK, content TEXT, contact_date DATE, metadata tạo/sửa/xóa mềm. Ngày server sinh theo Việt Nam, giữ nguyên khi sửa. GET dựng extra_note từ entry còn hoạt động và trả cả mảng contact_notes. Backfill text cũ thành nguyên khối contact_date NULL, không đoán ngày. API/giới hạn/UI xem `ROSA_APPOINTMENT_CONTACT_NOTES_API.md`.

# Rosa schema — 2026-10-27

## Scope and migration

Only MySQL 127.0.0.1:3308, targets db_spa_template and db_spa_1791039769068_e185 (tenant 7). Other cloned historical tenant databases are NOT upgraded and must not be used with new Rosa functionality. No changes on 3306/3307.

- Backup manifest: D:\SpaRosa\backups\pre-schema-manifest.json; contains dump path and SHA-256.
- Migration: docs/migrations/2026-10-27_rosa_profiles_treatments.sql.
- Runner: scripts/apply-rosa-schema.js; explicit DOTENV_CONFIG_PATH, database allowlist, server port check, backup validation, advisory lock and per-step checksum ledger.
- DDL is not transactional. Interruption between DDL and its ledger write requires manual inspection; do not blindly retry or drop tables. Step ledger otherwise skips completed steps.
- db_spa_template.sql includes new columns/tables. Existing tenant provisioning uses CREATE TABLE LIKE, which does not copy foreign keys: new-tenant FK provisioning remains a separate follow-up.

## Customers

New nullable fields: profile_code (unique), profile_date, gender, skin_types JSON, referral_sources JSON, referral_note, previous_skin_treatments, peeling_products_history, current_skincare_products, skincare_routine, pigmentation_onset, family_skin_history, pregnancy_and_medical_history, cosmetic_reaction_history, skin_assessment, consultation_note.

Existing fullname, phone_number, date_of_birth and address are reused. No stored age. Customer POST/PUT and list/detail/overview now support all 16 profile fields; see docs/API_FRONTEND.md for codes and payloads. JSON fields accept arrays of allowed codes or null, never JSON-encoded strings. Profile codes are optional, trimmed, unique per tenant including soft-deleted customers, and are not auto-generated. Profile dates are calendar-only and cannot be in the future. Omitted PUT fields stay unchanged; null clears optional fields. No schema change is required for this API update.

## Images

customer_skin_image_sessions: one row per capture session with customer_id, captured_date (DATE independent of created_at), shared note and audit/soft-delete fields. Index (customer_id,captured_date,id), FK to customers. Multiple sessions on the same date are allowed.

customer_skin_images: one row per image with required session_id, relative file_path (not JSON), original_filename, mime_type, file_size, unsigned sort_order (default 0), per-image note and audit/soft-delete fields. Index (session_id,sort_order,id), FK to customer_skin_image_sessions. customer_id and captured_date now live only on the parent. Hard deletes are restricted by FKs; soft-delete visibility and file lifecycle must be implemented in the future API.

Follow-up migration: docs/migrations/2026-10-27_rosa_skin_image_sessions.sql, runner scripts/apply-rosa-image-sessions.js (npm run db:migrate:rosa-image-sessions). Uses the same 3308 target allowlist, backup hash, advisory lock and ledger with independent prefix 2026-10-27-rosa-image-sessions. Do not modify the original migration SQL/checksums. Run the original migration first on a new database, then this follow-up. Existing images map one-to-one to sessions (preserve image IDs, paths, metadata, timestamps, soft deletes and per-image notes); no guessed grouping by date. Old notes remain on the image; new session notes start NULL.

Applied to both approved Rosa databases after a fresh backup at D:\SpaRosa\backups\pre-image-sessions-manifest.json. Both image tables were empty before migration. Re-running the follow-up skipped all five recorded steps. No upload endpoint has been added in this schema-only step.

Upload API implemented after the schema phase: see docs/ROSA_SKIN_IMAGES_API.md. UPLOAD_ROOT=D:/SpaRosa/storage is configured in local Rosa env files. Files use relative tenant/customer/session/UUID paths with authenticated reads, not public static serving. Multi-file create/append, list/detail, metadata update and soft-delete are implemented. Ordinary failure cleanup is implemented; filesystem and MySQL cannot commit atomically, so ambiguous commits/crash leftovers require reconciliation. Backups must include image files as well as SQL.

## Product and treatment hierarchy

Products API now supports child_service_ids using product_service_components: ordered arrays, service-only validation, DAG cycle guards, atomic relation replacement, type/delete/restore protection and tenant advisory lock across all product writes. See docs/ROSA_PRODUCT_COMPONENTS_API.md. No schema migration added for this API implementation. This does not generate treatment cards or allocate prices/commissions; those remain follow-ups.

products schema is unchanged. product_service_components links parent_product_id to child_product_id, unique pair, sort_order and audit fields. CHECK prevents self-reference; service-only validation and multi-node cycle prevention are now implemented in productComponentService. Same-customer treatment validation still belongs to the future treatment hierarchy API. Do not populate raw relations without these checks.

treatments adds parent_treatment_id (self FK), closed_at, closed_by, closure_note and closure_signature_svg MEDIUMTEXT. Parent and child must share customer; existing cards do not auto-change when product definitions change. Parent itself is not executable when it has non-deleted children. Child execution checks parent is present and open.

Session rules:
- Finite: total_sessions > 0; remaining_sessions between 0 and total.
- Lifetime open: total_sessions=NULL, remaining_sessions=NULL.
- Lifetime closed: total_sessions=NULL, remaining_sessions=0; closed_at non-null.
- Closed finite cards retain original total_sessions; remaining_sessions=0.
- Existing execute API accepts lifetime cards without decrementing NULL, continues history/commission and next-appointment behavior.
- Manual treatment API accepts explicit total_sessions=null and customer-specific children; direct parent_treatment_id assignment remains prohibited.
- Undo history does not increment closed cards or NULL balances, so it cannot reopen a closed lifetime card.
- Specialized lifetime/hierarchy/closed cards cannot be reconciled by the legacy invoice update flow and block invoice delete. This is an intentional safe restriction pending dedicated package reconciliation.
- Ordinary finite imported cards preserve total-minus-remaining completed count; lifetime/closed cards use non-deleted history count.

Treatment groups and closure API are now implemented: see docs/ROSA_TREATMENT_GROUPS_API.md for invoice/manual payloads, root-only nested reads, price snapshots, MANAGER/STAFF signed closure of the parent and all descendants together, quantity restrictions and verification. No additional schema migration was needed. The original schema-only notes above describe the migration phase; the API document specifies current behavior.

## Booking

customer_bookings keeps branch/status/audit fields and legacy nullable booking_time. Adds customer_type NEW/EXISTING, promotion_note, arrival_date DATE NOT NULL, arrival_time TIME NULL, consultation_total DECIMAL(15,2) nonnegative. Existing booking_time backfills arrival_date/time, existing customer_id determines type.

NEW requires no customer_id, nonblank name and phone; EXISTING requires customer_id. Time range 00:00:00 <= time < 24:00:00. Money is advisory, not revenue/debt. GET filters and order use arrival_date/time, including optional startTime/endTime. Employee POST/PUT/DELETE booking endpoints are implemented with MANAGER/STAFF authorization; STAFF write scope remains its branch, while both roles read all branches within the tenant. List/detail expose computed has_arrived from non-deleted invoice/card creation since midnight on booking creation day, matching NEW via exact phone and EXISTING via customer_id. See docs/ROSA_CUSTOMER_BOOKINGS_API.md. No new DB changes. Existing MiniApp remains unmounted and is incompatible with the new required booking columns; do not mount it.

## Session signature

### Per-session note (schema and API)

`treatment_history.note TEXT NULL` added on Rosa 3308 to both db_spa_template and db_spa_1791039769068_e185. Existing history rows retain NULL. This is separate from treatments.note and closure_note. POST /api/treatments/execute now accepts optional note and customer_signature_svg at session creation; see docs/ROSA_TREATMENT_GROUPS_API.md. No additional schema change was needed for API support.

Migration: `docs/migrations/2026-10-27_rosa_treatment_history_note.sql`; guarded runner: `scripts/apply-rosa-treatment-history-note.js` (explicit DOTENV_CONFIG_PATH, --db, --apply and --backup, same port/allowlist/backup-hash/ledger protections as previous Rosa migrations). Independent ledger ID: `2026-10-27-rosa-treatment-history-note:1`. Backup manifest: `D:\SpaRosa\backups\pre-treatment-history-note-manifest.json`, including pre-DDL history row counts/hashes. Verify with explicit Rosa config and `node --require dotenv/config scratch/test_treatment_history_note_schema_mysql.js`; this migration-specific verification compares historical rows against that backup baseline and rolls back its note write/read test.

treatment_history adds customer_signature_svg MEDIUMTEXT and customer_signed_at DATETIME. Distinct from card closure_signature_svg. Execution now validates and stores an optional SVG session signature with server-generated customer_signed_at; client-supplied signing time is rejected. Supplemental signature/update endpoints remain out of scope.

## Tests

- npm run test:invoice-notes
- npm run test:staff-date-policy
- npm run test:customer-upgrade
- npm run test:customer-profile
- npm run test:skin-images
- Set DOTENV_CONFIG_PATH=D:\SpaConfigs\rosa.env, then npm run test:skin-images:mysql (HTTP + transaction/savepoint rollback, isolated temp files).
- npm run test:rosa-image-sessions (migration runner mocks: dry run, guards, backup integrity, checksums, rerun and mapping SQL).
- Set DOTENV_CONFIG_PATH=D:\SpaConfigs\rosa.env, then npm run test:customer-profile:mysql (local 3308 only, transaction rolled back).
- node scratch/test_customer_overview.js
- Set DOTENV_CONFIG_PATH=D:\SpaRosa\config\.env, then npm run test:rosa:mysql.

MySQL test writes are transaction-rolled-back; AUTO_INCREMENT counters can advance even on rollback. Rosa MySQL test also checks two images per session, sort order, capture date independence, orphan-image FK rejection and parent hard-delete restriction. Legacy nonempty backfill is covered by SQL-contract assertions, not a live legacy-data migration fixture. Separate skin-images HTTP tests cover uploads. Implemented per-session metadata/group closure and booking APIs have their own test suites: npm run test:treatment-groups, npm run test:treatment-groups:mysql, npm run test:customer-bookings and npm run test:customer-bookings:mysql (explicit Rosa configuration for MySQL). Frontend overview: docs/ROSA_FRONTEND_CHANGELOG.md.