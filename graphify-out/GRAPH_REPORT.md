# Graph Report - spa-management-backend  (2026-11-11)

## Corpus Check
- 255 files · ~228,327 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: .example 3, .zip 2, (none) 1)

## Summary
- 1587 nodes · 2623 edges · 162 communities (118 shown, 44 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 343 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `794d83bd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- customerService.js
- invoiceService.js
- skinImageService.js
- test_rosa_image_sessions_migration.js
- debtPaymentService.js
- appointmentService.js
- scripts
- reportService.js
- Module 3.2: Bấm thực hiện buổi dịch vụ (`POST /api/treatments/execute`)
- productService.js
- tenantService.js
- CONTEXT — Spa Management Backend
- getTenantDbName
- Rosa — hướng dẫn thay đổi cho frontend
- verifyToken
- apply-release-migrations.js
- inventoryImportService.js
- Handoff cài backend Spa trên máy Windows khách
- Tài liệu API cho Frontend — Spa Management Backend
- Common-SpaBackend.ps1
- respondListError
- Triển khai backend trên máy Windows của khách (không VPS)
- 4. Quy trình tại máy khách (đọc theo thứ tự)
- test_commission_tiers.js
- userService.js
- customerRoutes.js
- customerWalletLogService.js
- treatmentService.js
- treatmentController.js
- database.js
- apply-customer-upgrade.js
- test_treatment_appointment_cleanup.js
- src/server.js
- authService.js
- express
- fix.js
- ref_node_fs
- customerBookingService.js
- Rosa schema — 2026-10-27
- package.json
- customerBooking.js
- treatmentGroupService.js
- test_legacy_debt_payments.js
- normalizeSessionMetadata
- tenantController.js
- Cài Rosa production trên Windows
- Cài môi trường dùng thử Spa Test Rosa trên Windows
- 20. Thẻ Liệu trình `/api/treatments`
- Endpoint
- Bàn giao Frontend Superadmin — Quản lý Spa/Tenant
- 4. API tenant — toàn bộ API dùng cho app này
- dependencies
- PROJECT STATE - whole-project map and branch handoff
- test_auth_session.js
- test_tenant_superadmin.js
- expenseService.js
- treatmentPurchaseService.js
- Rosa treatment groups — 2026-10-27
- test_skin_images_mysql.js
- treatmentGroupNoteService.js
- apply-commission-migration.js
- auth.js
- Hướng dẫn thay đổi frontend Rosa
- 16. Lịch hẹn `/api/appointments`
- 6. Tenant/Spa (chỉ `SUPER_ADMIN`)
- Thu nợ cũ không có hóa đơn
- Nâng cấp ngày sinh + giá bán — 25/10/2026
- Rosa — ghi chú liên hệ lịch hẹn
- Rosa — sửa ghi chú buổi và ký bổ sung
- 5. Luồng/màn hình bắt buộc
- jsonwebtoken
- ref_node_assert
- test_skin_image_storage.js
- test_customer_reset_security.js
- test_product_sale_price.js
- test_user_update_branch.js
- 2026-11-11-rosa-treatment-history-groups.js
- debtPaymentController.js
- 19. Thu nợ khách hàng `/api/debt-payments`
- Báo cáo `/api/reports` — chỉ MANAGER
- 7. Tài khoản nhân viên hệ thống `/api/users` (chỉ `MANAGER`)
- Rosa customer bookings
- Rosa — sửa hóa đơn và số buổi liệu trình
- Rosa: dịch vụ con trong products
- ref_fs
- test_legacy_debt_payments_mysql.js
- test_appointment_contact_notes_mysql.js
- test_customer_upgrade_mysql.js
- test_product_permissions.js
- test_product_revenue.js
- test_tenant_admin.js
- verify_tenant_readonly.js
- 2026-11-11-rosa-active-profile-code.js
- branchController.js
- productController.js
- roleController.js
- staffController.js
- userController.js
- Spa Test Rosa Bootstrap
- 10. Hồ sơ nhân sự `/api/staffs` (cần token)
- 12. Sản phẩm/Dịch vụ `/api/products` (MANAGER và STAFF quản lý)
- 13. Nhập kho `/api/inventory-imports`
- 15. Quản lý Hóa đơn Bán hàng `/api/invoices`
- 18. Nạp ví khách hàng `/api/customer-wallet-logs`
- 8. Chức vụ `/api/roles` (chỉ `MANAGER`)
- 9. Chi nhánh `/api/branches` (chỉ `MANAGER`)
- Hợp đồng response cho toàn bộ API quản trị đang mount
- 2. Cấu hình và xác thực
- test_reports.js
- 2026-11-11-rosa-treatment-purchases.js
- customerWalletLogController.js
- expenseController.js
- inventoryImportController.js
- invoiceController.js
- mysql2
- test_customer_bookings_mysql.js
- pagination.js
- test_product_components_mysql.js
- test_rosa_treatment_history_groups.js
- test_treatment_groups_mysql.js
- test_treatment_history_followup_mysql.js
- test_treatment_purchase_merge_mysql.js
- Spa Backend Bootstrap
- Áp dụng migration công ca (16/10/2026)
- Product listed price and sale price (customer-specific rollout)
- fix2.js
- fix_md.js
- test_invoice_payment_and_debt_payment_guards.js
- patch_all.js
- patch_clean.js
- patch_controller.js
- patch_delete.js
- patch_inv_deduct.js
- patch_inventory.js
- patch_invoice.js
- patch_invoice2.js
- patch_invoice4.js
- patch_log.js
- patch_service.js
- patch_update.js
- workspace.globals.yaml
- workspace
- customerBookingRoutes.js
- debtPaymentRoutes.js
- inventoryImportRoutes.js
- productRoutes.js
- roleRoutes.js
- optimize-context.md
- sparosa-production/README_FIRST.md
- README.md

## God Nodes (most connected - your core abstractions)
1. `getTenantDbName()` - 111 edges
2. `express` - 41 edges
3. `paginateQuery()` - 36 edges
4. `respondListError()` - 34 edges
5. `scripts` - 33 edges
6. `masterPool` - 30 edges
7. `Tài liệu API cho Frontend — Spa Management Backend` - 27 edges
8. `jsonwebtoken` - 26 edges
9. `verifyToken()` - 21 edges
10. `updateInvoice()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `4.3. Tạo tenant + Manager ban đầu` --references--> `tenantId()`  [INFERRED]
  docs/SUPERADMIN_FRONTEND.md → src/services/tenantService.js
- `1. `GET /api/reports/revenue` — các thẻ tổng quan` --references--> `date()`  [INFERRED]
  docs/API_FRONTEND.md → src/utils/customerBooking.js
- `Liệu trình và báo cáo` --references--> `date()`  [INFERRED]
  docs/API_FRONTEND.md → src/utils/customerBooking.js
- `9. Ghi chú backend cho đội frontend` --references--> `attachTenantDB()`  [INFERRED]
  docs/SUPERADMIN_FRONTEND.md → src/middlewares/tenant.js
- `4. Checklist thực thi kiểm thử nhanh` --references--> `remaining()`  [INFERRED]
  docs/TEST_CASES_TREATMENTS.md → src/services/invoiceTreatmentUpdateService.js

## Import Cycles
- None detected.

## Communities (162 total, 44 thin omitted)

### Community 0 - "customerService.js"
Cohesion: 0.05
Nodes (42): 1. Môi trường & Dữ liệu chuẩn bị (Seed Data mẫu), 2. Ma trận phân quyền (Role Matrix), 4. Checklist thực thi kiểm thử nhanh, Kịch bản kiểm thử API Liệu trình (Test Cases — `/api/treatments`), assert, calls, db, query() (+34 more)

### Community 1 - "invoiceService.js"
Cohesion: 0.06
Nodes (42): assert, base, connection, db, state, assert, calls, dbPath (+34 more)

### Community 2 - "skinImageService.js"
Cohesion: 0.09
Nodes (41): 2. Cài Node và chuẩn bị thư mục trên máy khách, assert, main(), originalEnvironment, restoreEnvironment(), actor(), express, multer (+33 more)

### Community 3 - "test_rosa_image_sessions_migration.js"
Cohesion: 0.09
Nodes (26): assert, crypto, fs, main(), os, path, main(), migrationFile (+18 more)

### Community 4 - "debtPaymentService.js"
Cohesion: 0.14
Nodes (31): assert, calls, customer, db, express, jwt, sql, assert (+23 more)

### Community 5 - "appointmentService.js"
Cohesion: 0.13
Nodes (29): assert, configPath, assert, calls, configPath, connection, attachContactNotes(), formatNotes() (+21 more)

### Community 6 - "scripts"
Cohesion: 0.06
Nodes (33): scripts, db:migrate:commission, db:migrate:customer-upgrade, db:migrate:rosa, db:migrate:rosa-image-sessions, dev, start, test:appointment-contact-notes (+25 more)

### Community 7 - "reportService.js"
Cohesion: 0.13
Nodes (25): commissionDetails, commissions, consultantDetails, consultants, details, productInvoices, products, revenue (+17 more)

### Community 8 - "Module 3.2: Bấm thực hiện buổi dịch vụ (`POST /api/treatments/execute`)"
Cohesion: 0.07
Nodes (28): 3. Chi tiết các trường hợp test (Test Cases), Module 3.1: Tạo thẻ liệu trình thủ công (`POST /api/treatments`), Module 3.2: Bấm thực hiện buổi dịch vụ (`POST /api/treatments/execute`), Module 3.3: Gán bổ sung / Cập nhật nhân viên cho buổi cũ (`PUT /api/treatments/execute/:historyId/staffs`), Module 3.4: Báo cáo tra cứu hoa hồng nhân viên (`GET /api/treatments/commissions`), Module 3.5: Hoàn tác buổi dịch vụ (`DELETE /api/treatments/execute/:historyId`), TC-TR-01: Tạo thẻ thủ công thành công bởi MANAGER (Happy Path), TC-TR-02: Bỏ qua `remaining_sessions` thì mặc định bằng `total_sessions` (+20 more)

### Community 9 - "productService.js"
Cohesion: 0.16
Nodes (23): assert, main(), acquire(), check(), fail(), normalizeIds(), release(), validateGraph() (+15 more)

### Community 10 - "tenantService.js"
Cohesion: 0.15
Nodes (24): 11. Khách hàng `/api/customers`, `DELETE /api/customers/:id` / `PATCH /api/customers/:id/restore` — Cần token, `GET /api/customers/:id` — Cần token, `GET /api/customers/:id/overview` — Tổng quan chuyên sâu (cần token), `GET /api/customers?search=<keyword>` — Cần token, Hồ sơ Rosa — bổ sung ngày 27/10/2026, `POST /api/customers` — Cần token, `POST /api/customers/reset-password` — Chỉ MANAGER (+16 more)

### Community 11 - "CONTEXT — Spa Management Backend"
Cohesion: 0.08
Nodes (23): Appointment (`/api/appointments`), Auth, quyền và quy chuẩn, Bổ sung chính sách ngày cho STAFF, Checklist thêm tính năng, CONTEXT — Spa Management Backend, Customer booking và wallet (`/api/customer-bookings`, `/api/customer-wallet-logs`), Công nghệ và lệnh chạy, Cấu trúc dự án (+15 more)

### Community 12 - "getTenantDbName"
Cohesion: 0.17
Nodes (20): getTenantDbName(), createBranch(), deleteBranch(), getBranchDetail(), getBranches(), restoreBranch(), updateBranch(), createRole() (+12 more)

### Community 13 - "Rosa — hướng dẫn thay đổi cho frontend"
Cohesion: 0.09
Nodes (21): 10.1 Search và lọc ngày/giờ, 10.2 has_arrived không phải check-in thủ công, 10. Booking nội bộ nhân viên — đầy đủ thêm/sửa/xóa, 11. Checklist phát triển và kiểm thử frontend, 1. Kết nối đúng môi trường, 2. Bản đồ màn hình cần sửa và chỗ đọc chi tiết, 3. Hồ sơ khách hàng, 4. Ảnh da: nhóm theo lần chụp, không phải một mảng đường dẫn trên khách (+13 more)

### Community 14 - "verifyToken"
Cohesion: 0.12
Nodes (15): 2.1. Header JWT, 2.2. Các quyền hệ thống, 2. Xác thực và quyền, verifyManager(), verifyToken(), express, router, express (+7 more)

### Community 15 - "apply-release-migrations.js"
Cohesion: 0.18
Nodes (18): assert, fs, os, path, root, applyTarget(), assertTarget(), ensureLedger() (+10 more)

### Community 16 - "inventoryImportService.js"
Cohesion: 0.17
Nodes (14): assert, connection, db, now, state, checkPermission(), createInventoryImport(), deleteInventoryImport() (+6 more)

### Community 17 - "Handoff cài backend Spa trên máy Windows khách"
Cohesion: 0.11
Nodes (17): 10. Cloudflare Tunnel, 11. Nghiệm thu, 12. Backup định kỳ sau khi app mới hoạt động, 13. Rollback, 14. Biên bản bàn giao tối thiểu, 1. Giá trị phải được xác nhận trước khi thao tác, 2. Quy tắc không ảnh hưởng hệ thống cũ, 3. Kiểm kê chỉ đọc (+9 more)

### Community 18 - "Tài liệu API cho Frontend — Spa Management Backend"
Cohesion: 0.12
Nodes (17): 14. Quản lý Phiếu chi `/api/expenses`, 17. Booking do khách đặt `/api/customer-bookings`, 1. Tổng quan, 20. MiniApp (Chưa sử dụng), 21. Database và Lưu ý tích hợp, 3. Quy ước dữ liệu và response, 4. Danh sách nhanh API đang được mount, 5. Auth (+9 more)

### Community 19 - "Common-SpaBackend.ps1"
Cohesion: 0.29
Nodes (8): Assert-Administrator(), Assert-SafeVersion(), Get-CurrentReleasePath(), Get-DotEnvValues(), Invoke-CheckedCommand(), Set-ReleaseJunction(), Wait-BackendHealth(), Write-DeploymentState()

### Community 20 - "respondListError"
Cohesion: 0.16
Nodes (5): getList(), getNotArrived(), getTomorrow(), getList(), respondListError()

### Community 21 - "Triển khai backend trên máy Windows của khách (không VPS)"
Cohesion: 0.13
Nodes (14): 0. Phương án và điều kiện, 1. Mua tên miền và đưa DNS lên Cloudflare, 3. Backend chạy Windows Service (WinSW), 4. Tạo Cloudflare Tunnel (token, remote-managed), 5.1. Nâng cấp thủ công có kiểm soát, 5. Nâng cấp tự động từ Git tag (không cần remote máy khách), 6. Script Windows và triển khai độc lập nhiều máy, Backup database (+6 more)

### Community 22 - "4. Quy trình tại máy khách (đọc theo thứ tự)"
Cohesion: 0.13
Nodes (14): 1. Mình đang cài cái gì?, 2. Trước khi tới máy khách: chốt những gì?, 3. Mang gói tới máy khách, 4. Quy trình tại máy khách (đọc theo thứ tự), 5. Mẹo nhớ nhanh, Giai đoạn A — Kiểm kê, chưa thay đổi gì, Giai đoạn B — Backup app/DB cũ trước thay đổi, Giai đoạn C — Tạo database riêng cho app mới (+6 more)

### Community 23 - "test_commission_tiers.js"
Cohesion: 0.22
Nodes (13): assert, assignments, baseRow, calls, db, tierRows, calculateCommission(), loadCommissionBase() (+5 more)

### Community 24 - "userService.js"
Cohesion: 0.15
Nodes (11): assert, calls, databasePath, pool, rows, bcrypt, checkBranchExists(), createUser() (+3 more)

### Community 25 - "customerRoutes.js"
Cohesion: 0.17
Nodes (9): assert, createHealthHandler(), createRateLimiter(), express, loginLimiter, router, express, resetPasswordLimiter (+1 more)

### Community 26 - "customerWalletLogService.js"
Cohesion: 0.35
Nodes (14): calculateBonus(), createWalletLog(), deleteWalletLog(), ensureBranchExists(), ensureWalletBalanceIsSufficient(), getBranchIdForTransaction(), getLockedCustomers(), getWalletLogDetail() (+6 more)

### Community 27 - "treatmentService.js"
Cohesion: 0.24
Nodes (11): assert, calls, configPath, createTreatment(), executionDateFilters(), getStaffCommissions(), getTreatmentDetail(), getTreatments() (+3 more)

### Community 28 - "treatmentController.js"
Cohesion: 0.18
Nodes (5): getCommissions(), getList(), historyMetadata(), failure(), updateHistoryMetadata()

### Community 29 - "database.js"
Cohesion: 0.18
Nodes (10): Hạn chế/rủi ro đã biết, Kiểm chứng MySQL tenant (2026-10-09), bcryptjs, dbConfig, masterPool, mysql, bcrypt, jwt (+2 more)

### Community 30 - "apply-customer-upgrade.js"
Cohesion: 0.28
Nodes (11): assert, column(), fixture(), run(), expectedSchema(), fs, inspect(), main() (+3 more)

### Community 31 - "test_treatment_appointment_cleanup.js"
Cohesion: 0.15
Nodes (9): assert, connection, databasePath, state, assert, connection, db, state (+1 more)

### Community 32 - "src/server.js"
Cohesion: 0.18
Nodes (9): assert, production, getServerConfig(), express, router, app, config, cors (+1 more)

### Community 33 - "authService.js"
Cohesion: 0.28
Nodes (9): login(), me(), bcrypt, getSession(), getTenant(), jwt, login(), AuthError (+1 more)

### Community 34 - "express"
Cohesion: 0.17
Nodes (9): 2.3. Mã lỗi xác thực chung, express, verifyCustomerToken(), express, router, express, router, express (+1 more)

### Community 35 - "fix.js"
Cohesion: 0.17
Nodes (11): code, deductNewTargetMatch, deleteGuardLogic, deleteGuardTargetMatch, forLoopReplace, forLoopTargetMatch, fs, newCode (+3 more)

### Community 36 - "ref_node_fs"
Cohesion: 0.17
Nodes (6): assert, fs, mysql, assert, crypto, fs

### Community 37 - "customerBookingService.js"
Cohesion: 0.29
Nodes (9): assert, calls, configPath, arrivedSql(), getCustomerBookingDetail(), getCustomerBookings(), toNumber(), withArrival() (+1 more)

### Community 38 - "Rosa schema — 2026-10-27"
Cohesion: 0.18
Nodes (10): Booking, Bổ sung appointments.extra_note, Customers, Images, Per-session note (schema and API), Product and treatment hierarchy, Rosa schema — 2026-10-27, Scope and migration (+2 more)

### Community 39 - "package.json"
Cohesion: 0.20
Nodes (10): author, description, devDependencies, nodemon@^3.1.14, keywords, license, main, name (+2 more)

### Community 40 - "customerBooking.js"
Cohesion: 0.35
Nodes (9): assert, base, date(), fail(), fields, id(), normalize(), text() (+1 more)

### Community 41 - "treatmentGroupService.js"
Cohesion: 0.33
Nodes (7): assert, attach(), count(), invalid(), normalizeConfig(), prepare(), validateInvoiceQuantity()

### Community 42 - "test_legacy_debt_payments.js"
Cohesion: 0.18
Nodes (6): assert, base, connection, dbPath, express, jwt

### Community 43 - "normalizeSessionMetadata"
Cohesion: 0.29
Nodes (7): assert, assert, closeTreatment(), invalid(), normalizeSessionMetadata(), invalid(), normalizeClosureSignature()

### Community 44 - "tenantController.js"
Cohesion: 0.24
Nodes (5): getManagers(), getTenants(), renew(), resetManagerPassword(), respondAdminError()

### Community 45 - "Cài Rosa production trên Windows"
Cohesion: 0.20
Nodes (9): 1. Thông số chốt, 2. Dừng nếu máy không sạch, 3. Kiểm tra và giải nén ZIP, 4. Khởi tạo MySQL và import schema sạch, 5. Cấu hình, deploy, và tạo Super Admin, 6. Cloudflare Tunnel và frontend, 7. Cloudflare R2 backup, 8. Restore drill và nghiệm thu (+1 more)

### Community 46 - "Cài môi trường dùng thử Spa Test Rosa trên Windows"
Cohesion: 0.20
Nodes (9): 1. Giá trị đã chốt, 2. Điều kiện trước khi cài, 3. Kiểm tra và giải nén package, 4. Tạo database và import ba SQL export, 5. Tạo cấu hình backend và deploy release, 6. Cloudflare Tunnel và frontend, 7. Cập nhật/rollback trong giai đoạn test, Cài môi trường dùng thử Spa Test Rosa trên Windows (+1 more)

### Community 47 - "20. Thẻ Liệu trình `/api/treatments`"
Cohesion: 0.20
Nodes (10): 20. Thẻ Liệu trình `/api/treatments`, Các field trả về, Cách gọi, `DELETE /api/treatments/execute/:historyId`, `GET /api/treatments`, `GET /api/treatments/commissions`, `GET /api/treatments/:id`, `POST /api/treatments` — chỉ `MANAGER` (+2 more)

### Community 48 - "Endpoint"
Cohesion: 0.20
Nodes (9): Cấu hình và phạm vi, Endpoint, GET danh sách / chi tiết, Lỗi / tính nhất quán, POST tạo lần chụp — Postman, PUT metadata, Rosa — API ảnh da, Test (+1 more)

### Community 49 - "Bàn giao Frontend Superadmin — Quản lý Spa/Tenant"
Cohesion: 0.20
Nodes (9): 1. Mục tiêu và phạm vi, 3.1. Tenant list/detail, 3.2. Phân trang, 3. Model dữ liệu, 6. API client contract mẫu, 7. Bảo mật và dữ liệu nhạy cảm, 8. Checklist nghiệm thu frontend, 9. Ghi chú backend cho đội frontend (+1 more)

### Community 50 - "4. API tenant — toàn bộ API dùng cho app này"
Cohesion: 0.20
Nodes (10): 4.1. Danh sách và tìm kiếm, 4.2. Chi tiết, 4.3. Tạo tenant + Manager ban đầu, 4.4. Cập nhật tên/hạn dùng, 4.5. Vô hiệu hóa, 4.6. Khôi phục, 4.7. Danh sách MANAGER thuộc Spa, 4.8. Cấp lại mật khẩu MANAGER (+2 more)

### Community 51 - "dependencies"
Cohesion: 0.20
Nodes (10): dependencies, bcryptjs@^3.0.3, cors@^2.8.6, dotenv@^18.0.4, express@^5.2.1, jsonwebtoken@^9.0.3, multer@2.5.0, cors (+2 more)

### Community 52 - "PROJECT STATE - whole-project map and branch handoff"
Cohesion: 0.20
Nodes (9): All business domains and navigation (API prefix /api), Branch: rosa, Data graph and end-to-end invariants, Handoff and maintenance, Permissions, responses and dates, PROJECT STATE - whole-project map and branch handoff, Running, deployment and testing, Shared current debt contract (+1 more)

### Community 53 - "test_auth_session.js"
Cohesion: 0.20
Nodes (8): app, assert, bcrypt, claims, databasePath, express, jwt, originalUser

### Community 54 - "test_tenant_superadmin.js"
Cohesion: 0.20
Nodes (8): assert, bcrypt, calls, configPath, express, jwt, manager, tenant

### Community 55 - "expenseService.js"
Cohesion: 0.42
Nodes (9): addItems(), createExpense(), deleteExpense(), getExpenseDetail(), getExpenses(), normalizeItems(), toNumber(), totalItems() (+1 more)

### Community 56 - "treatmentPurchaseService.js"
Cohesion: 0.38
Nodes (8): activePurchaseCount(), insert(), invalid(), merge(), revoke(), revokeInvoice(), revokeInvoiceItem(), sessions()

### Community 57 - "Rosa treatment groups — 2026-10-27"
Cohesion: 0.22
Nodes (8): Execute several child services in one visit, Group execution history, per-session note and signature, Invoice creation (preferred), Manual groups, Reads, Rosa treatment groups — 2026-10-27, Signed completion, Verification commands

### Community 58 - "test_skin_images_mysql.js"
Cohesion: 0.25
Nodes (8): assert, express, fs, jwt, main(), os, path, png

### Community 59 - "treatmentGroupNoteService.js"
Cohesion: 0.28
Nodes (7): assert, connection, database, parent, writes, failure(), updateGroupNote()

### Community 60 - "apply-commission-migration.js"
Cohesion: 0.28
Nodes (8): expectedColumns, fs, getStatements(), inspect(), main(), migrationFile, mysql, path

### Community 61 - "auth.js"
Cohesion: 0.25
Nodes (6): jwt, verifySuperAdmin(), express, router, express, router

### Community 62 - "Hướng dẫn thay đổi frontend Rosa"
Cohesion: 0.25
Nodes (7): Bổ sung Rosa: lịch sử liên hệ lịch hẹn, Hướng dẫn thay đổi frontend Rosa, Lịch sử ghi chú hóa đơn trong hồ sơ khách hàng, Rosa: chức năng đã triển khai sau giai đoạn schema nền tảng, Rosa treatment groups, STAFF: giới hạn ngày phiếu và phạm vi cơ sở lịch sử liệu trình, Thu nợ cũ không có hóa đơn (29/10/2026)

### Community 63 - "16. Lịch hẹn `/api/appointments`"
Cohesion: 0.25
Nodes (8): 16. Lịch hẹn `/api/appointments`, `DELETE /api/appointments/:id`, `GET /api/appointments`, `GET /api/appointments/:id`, `GET /api/appointments/not-arrived`, `GET /api/appointments/tomorrow`, `POST /api/appointments`, `PUT /api/appointments/:id`

### Community 64 - "6. Tenant/Spa (chỉ `SUPER_ADMIN`)"
Cohesion: 0.25
Nodes (8): 6. Tenant/Spa (chỉ `SUPER_ADMIN`), `DELETE /api/tenants/:id` — Vô hiệu hóa Spa, `GET /api/tenants/:id` — Chi tiết Spa, `GET /api/tenants?search=<keyword>&status=all&page=1&pageSize=20` — Danh sách Spa, `PATCH /api/tenants/:id/restore` — Khôi phục Spa, `POST /api/tenants/create` — Tạo Spa mới, `PUT /api/tenants/:id` — Cập nhật Spa, Quản trị MANAGER và gia hạn (chỉ SUPER_ADMIN)

### Community 65 - "Thu nợ cũ không có hóa đơn"
Cohesion: 0.25
Nodes (7): Báo cáo, Kiểm thử, Số dư để frontend hiển thị, Thu nợ cũ không có hóa đơn, Triển khai, Tạo phiếu, Xem, sửa, xóa

### Community 66 - "Nâng cấp ngày sinh + giá bán — 25/10/2026"
Cohesion: 0.25
Nodes (7): 1. Kiểm kê và thử trước, 2. Backup, ngừng ghi và áp dụng, 3. Đối soát và deploy, Kiểm thử local, Nâng cấp ngày sinh + giá bán — 25/10/2026, Phạm vi và điều kiện dừng, Workbench error 1175 / migration bị ngắt

### Community 67 - "Rosa — ghi chú liên hệ lịch hẹn"
Cohesion: 0.25
Nodes (7): DELETE /api/appointments/:id/contact-notes/:noteId, Migration và kiểm thử, Phạm vi, POST /api/appointments/:id/contact-notes, PUT /api/appointments/:id/contact-notes/:noteId, Rosa — ghi chú liên hệ lịch hẹn, Đọc và UI

### Community 68 - "Rosa — sửa ghi chú buổi và ký bổ sung"
Cohesion: 0.25
Nodes (7): An toàn và hiển thị, Kiểm thử, Luồng frontend, POST /api/treatments/execute/:historyId/sign, PUT /api/treatments/execute/:historyId/note, Response, Rosa — sửa ghi chú buổi và ký bổ sung

### Community 69 - "5. Luồng/màn hình bắt buộc"
Cohesion: 0.25
Nodes (8): 5. Luồng/màn hình bắt buộc, A. Login (`/login`), B. Tenant list (`/tenants`), C. Tạo Spa (modal/drawer), D. Chi tiết Tenant (`/tenants/:id` hoặc drawer), E. Gia hạn/sửa, F. Vô hiệu hóa/khôi phục, G. Tài khoản MANAGER và quên mật khẩu

### Community 70 - "jsonwebtoken"
Cohesion: 0.25
Nodes (4): jsonwebtoken, jwt, jwt, token

### Community 71 - "ref_node_assert"
Cohesion: 0.25
Nodes (5): assert, assert, calls, connection, db

### Community 72 - "test_skin_image_storage.js"
Cohesion: 0.25
Nodes (5): assert, fs, os, path, png

### Community 73 - "test_customer_reset_security.js"
Cohesion: 0.25
Nodes (7): app, assert, calls, controllerPath, express, jwt, routePath

### Community 74 - "test_product_sale_price.js"
Cohesion: 0.25
Nodes (6): app, assert, expectedDir, express, jwt, path

### Community 75 - "test_user_update_branch.js"
Cohesion: 0.25
Nodes (7): assert, bcrypt, calls, databasePath, express, jwt, users

### Community 76 - "2026-11-11-rosa-treatment-history-groups.js"
Cohesion: 0.61
Nodes (7): columnExists(), constraintExists(), exists(), indexExists(), quote(), up(), verify()

### Community 78 - "19. Thu nợ khách hàng `/api/debt-payments`"
Cohesion: 0.29
Nodes (7): 19. Thu nợ khách hàng `/api/debt-payments`, `DELETE /api/debt-payments/:id`, `GET /api/debt-payments`, `GET /api/debt-payments/:id`, `GET /api/debt-payments/invoices/:invoiceId/remaining-debt`, `POST /api/debt-payments`, `PUT /api/debt-payments/:id`

### Community 79 - "Báo cáo `/api/reports` — chỉ MANAGER"
Cohesion: 0.29
Nodes (7): 1. `GET /api/reports/revenue` — các thẻ tổng quan, 2. `GET /api/reports/details/:type` — các bảng chứng từ có phân trang, 3. `GET /api/reports/commissions` — tổng công ca theo nhân viên, 4. `GET /api/reports/consultants` — tổng tiền tư vấn theo nhân viên, 5. `GET /api/reports/products` — doanh thu từng sản phẩm/dịch vụ, 6. `GET /api/reports/products/:productId/invoices` — các hóa đơn chứa sản phẩm/dịch vụ, Báo cáo `/api/reports` — chỉ MANAGER

### Community 80 - "7. Tài khoản nhân viên hệ thống `/api/users` (chỉ `MANAGER`)"
Cohesion: 0.29
Nodes (7): 7. Tài khoản nhân viên hệ thống `/api/users` (chỉ `MANAGER`), `DELETE /api/users/:id`, `GET /api/users/:id`, `GET /api/users?search=<keyword>`, `PATCH /api/users/:id/restore`, `POST /api/users/create`, `PUT /api/users/:id`

### Community 81 - "Rosa customer bookings"
Cohesion: 0.29
Nodes (6): Create EXISTING customer booking, Create NEW customer booking, Endpoints, Rosa customer bookings, Tests, Time filters and arrival indicator

### Community 82 - "Rosa — sửa hóa đơn và số buổi liệu trình"
Cohesion: 0.29
Nodes (6): Cấu hình và liên kết, DELETE /api/invoices/:id, Kiểm thử, PUT /api/invoices/:id, Quy tắc số buổi, Rosa — sửa hóa đơn và số buổi liệu trình

### Community 83 - "Rosa: dịch vụ con trong products"
Cohesion: 0.29
Nodes (6): Ranh giới danh mục và thẻ thực tế, Rosa: dịch vụ con trong products, Test, Tạo / sửa, Đọc, Đổi loại, xóa, khôi phục

### Community 84 - "ref_fs"
Cohesion: 0.29
Nodes (4): code, fs, code, fs

### Community 85 - "test_legacy_debt_payments_mysql.js"
Cohesion: 0.29
Nodes (5): assert, fs, mysql, path, { spawn, spawnSync }

### Community 86 - "test_appointment_contact_notes_mysql.js"
Cohesion: 0.33
Nodes (6): assert, crypto, express, fs, jwt, main()

### Community 87 - "test_customer_upgrade_mysql.js"
Cohesion: 0.29
Nodes (5): assert, expectedDir, fs, mysql, path

### Community 88 - "test_product_permissions.js"
Cohesion: 0.29
Nodes (6): app, assert, calls, db, express, jwt

### Community 89 - "test_product_revenue.js"
Cohesion: 0.29
Nodes (6): assert, calls, databasePath, express, jwt, period

### Community 90 - "test_tenant_admin.js"
Cohesion: 0.29
Nodes (6): assert, calls, configPath, jwt, tenants, users

### Community 91 - "verify_tenant_readonly.js"
Cohesion: 0.29
Nodes (5): assert, base, express, jwt, routes

### Community 92 - "2026-11-11-rosa-active-profile-code.js"
Cohesion: 0.62
Nodes (6): columnExists(), exists(), indexExists(), quote(), up(), verify()

### Community 98 - "Spa Test Rosa Bootstrap"
Cohesion: 0.33
Nodes (5): Dùng gói này như thế nào, Nội dung chính, Phạm vi thử nghiệm, Spa Test Rosa Bootstrap, Thông tin môi trường

### Community 99 - "10. Hồ sơ nhân sự `/api/staffs` (cần token)"
Cohesion: 0.33
Nodes (6): 10. Hồ sơ nhân sự `/api/staffs` (cần token), `DELETE /api/staffs/:id` / `PATCH /api/staffs/:id/restore`, `GET /api/staffs/:id`, `GET /api/staffs?search=&branchId=&roleId=`, `POST /api/staffs`, `PUT /api/staffs/:id`

### Community 100 - "12. Sản phẩm/Dịch vụ `/api/products` (MANAGER và STAFF quản lý)"
Cohesion: 0.33
Nodes (6): 12. Sản phẩm/Dịch vụ `/api/products` (MANAGER và STAFF quản lý), 1. Lấy danh sách Sản phẩm / Dịch vụ, 2. Lấy chi tiết một Sản phẩm / Dịch vụ, `DELETE /api/products/:id` / `PATCH /api/products/:id/restore` (MANAGER/STAFF), `POST /api/products` (MANAGER/STAFF; cấu hình công ca chỉ MANAGER), `PUT /api/products/:id` (MANAGER/STAFF; cấu hình công ca chỉ MANAGER)

### Community 101 - "13. Nhập kho `/api/inventory-imports`"
Cohesion: 0.33
Nodes (6): 13. Nhập kho `/api/inventory-imports`, `DELETE /api/inventory-imports/:id`, `GET /api/inventory-imports`, `GET /api/inventory-imports/:id`, `POST /api/inventory-imports`, `PUT /api/inventory-imports/:id`

### Community 102 - "15. Quản lý Hóa đơn Bán hàng `/api/invoices`"
Cohesion: 0.33
Nodes (6): 15. Quản lý Hóa đơn Bán hàng `/api/invoices`, `DELETE /api/invoices/:id`, `GET /api/invoices`, `GET /api/invoices/:id`, `POST /api/invoices`, `PUT /api/invoices/:id`

### Community 103 - "18. Nạp ví khách hàng `/api/customer-wallet-logs`"
Cohesion: 0.33
Nodes (6): 18. Nạp ví khách hàng `/api/customer-wallet-logs`, `DELETE /api/customer-wallet-logs/:id`, `GET /api/customer-wallet-logs`, `GET /api/customer-wallet-logs/:id`, `POST /api/customer-wallet-logs`, `PUT /api/customer-wallet-logs/:id`

### Community 104 - "8. Chức vụ `/api/roles` (chỉ `MANAGER`)"
Cohesion: 0.33
Nodes (6): 8. Chức vụ `/api/roles` (chỉ `MANAGER`), `DELETE /api/roles/:id` / `PATCH /api/roles/:id/restore`, `GET /api/roles/:id`, `GET /api/roles?search=<keyword>`, `POST /api/roles`, `PUT /api/roles/:id`

### Community 105 - "9. Chi nhánh `/api/branches` (chỉ `MANAGER`)"
Cohesion: 0.33
Nodes (6): 9. Chi nhánh `/api/branches` (chỉ `MANAGER`), `DELETE /api/branches/:id` / `PATCH /api/branches/:id/restore`, `GET /api/branches/:id`, `GET /api/branches?search=<keyword>`, `POST /api/branches`, `PUT /api/branches/:id`

### Community 106 - "Hợp đồng response cho toàn bộ API quản trị đang mount"
Cohesion: 0.33
Nodes (6): Hóa đơn, lịch hẹn, booking, Hợp đồng response cho toàn bộ API quản trị đang mount, Liệu trình và báo cáo, Nạp ví, thu nợ, Quy tắc đọc response, Sản phẩm, nhập kho, phiếu chi

### Community 107 - "2. Cấu hình và xác thực"
Cohesion: 0.33
Nodes (6): Xác thực, tenant, tài khoản, danh mục, 2.1. Base URL, 2.2. Login, 2.3. Response lỗi chung, 2. Cấu hình và xác thực, token()

### Community 108 - "test_reports.js"
Cohesion: 0.33
Nodes (5): assert, calls, configPath, express, jwt

### Community 109 - "2026-11-11-rosa-treatment-purchases.js"
Cohesion: 0.67
Nodes (5): exists(), quote(), tableExists(), up(), verify()

### Community 114 - "mysql2"
Cohesion: 0.40
Nodes (3): mysql2@^3.24.4, mysql2, mysql

### Community 115 - "test_customer_bookings_mysql.js"
Cohesion: 0.50
Nodes (4): assert, express, jwt, main()

### Community 116 - "pagination.js"
Cohesion: 0.70
Nodes (3): assert, paginateQuery(), parsePagination()

### Community 117 - "test_product_components_mysql.js"
Cohesion: 0.50
Nodes (4): assert, express, jwt, main()

### Community 118 - "test_rosa_treatment_history_groups.js"
Cohesion: 0.40
Nodes (4): assert, connection, databasePath, state

### Community 119 - "test_treatment_groups_mysql.js"
Cohesion: 0.50
Nodes (4): assert, express, jwt, main()

### Community 120 - "test_treatment_history_followup_mysql.js"
Cohesion: 0.50
Nodes (4): assert, express, jwt, main()

### Community 121 - "test_treatment_purchase_merge_mysql.js"
Cohesion: 0.50
Nodes (4): assert, express, jwt, main()

### Community 122 - "Spa Backend Bootstrap"
Cohesion: 0.50
Nodes (3): Cách dùng, Nội dung chính, Spa Backend Bootstrap

### Community 123 - "Áp dụng migration công ca (16/10/2026)"
Cohesion: 0.50
Nodes (3): Chạy trực tiếp lên MySQL từ dự án (không cần nhập SQL vào Workbench), Nếu Workbench báo lỗi 1175 tại `UPDATE treatments` sau khi `ALTER TABLE` đã thành công, Áp dụng migration công ca (16/10/2026)

### Community 124 - "Product listed price and sale price (customer-specific rollout)"
Cohesion: 0.50
Nodes (3): Customer deployment (NOT run as part of local testing), Local test setup, Product listed price and sale price (customer-specific rollout)

### Community 125 - "fix2.js"
Cohesion: 0.50
Nodes (3): code, deleteGuardLogic, fs

### Community 127 - "fix_md.js"
Cohesion: 0.50
Nodes (3): content, fs, oldSection

### Community 128 - "test_invoice_payment_and_debt_payment_guards.js"
Cohesion: 0.83
Nodes (3): assertStatus(), request(), run()

## Knowledge Gaps
- **44 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Tài liệu API cho Frontend — Spa Management Backend` connect `Tài liệu API cho Frontend — Spa Management Backend` to `6. Tenant/Spa (chỉ `SUPER_ADMIN`)`, `10. Hồ sơ nhân sự `/api/staffs` (cần token)`, `12. Sản phẩm/Dịch vụ `/api/products` (MANAGER và STAFF quản lý)`, `13. Nhập kho `/api/inventory-imports``, `15. Quản lý Hóa đơn Bán hàng `/api/invoices``, `18. Nạp ví khách hàng `/api/customer-wallet-logs``, `8. Chức vụ `/api/roles` (chỉ `MANAGER`)`, `9. Chi nhánh `/api/branches` (chỉ `MANAGER`)`, `tenantService.js`, `Hợp đồng response cho toàn bộ API quản trị đang mount`, `19. Thu nợ khách hàng `/api/debt-payments``, `20. Thẻ Liệu trình `/api/treatments``, `verifyToken`, `7. Tài khoản nhân viên hệ thống `/api/users` (chỉ `MANAGER`)`, `Báo cáo `/api/reports` — chỉ MANAGER`, `Hướng dẫn thay đổi frontend Rosa`, `16. Lịch hẹn `/api/appointments``?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Should `customerService.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05480225988700565 - nodes in this community are weakly interconnected._
- **Why does `express` connect `express` to `skinImageService.js`, `debtPaymentService.js`, `verifyToken`, `customerBookingRoutes.js`, `debtPaymentRoutes.js`, `inventoryImportRoutes.js`, `productRoutes.js`, `roleRoutes.js`, `customerRoutes.js`, `src/server.js`, `package.json`, `test_legacy_debt_payments.js`, `dependencies`, `test_auth_session.js`, `test_tenant_superadmin.js`, `test_skin_images_mysql.js`, `auth.js`, `test_customer_reset_security.js`, `test_product_sale_price.js`, `test_user_update_branch.js`, `test_appointment_contact_notes_mysql.js`, `test_product_permissions.js`, `test_product_revenue.js`, `test_tenant_admin.js`, `verify_tenant_readonly.js`, `test_reports.js`, `test_customer_bookings_mysql.js`, `test_product_components_mysql.js`, `test_treatment_groups_mysql.js`, `test_treatment_history_followup_mysql.js`, `test_treatment_purchase_merge_mysql.js`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Should `invoiceService.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05974025974025974 - nodes in this community are weakly interconnected._
- **Why does `2. Xác thực và quyền` connect `verifyToken` to `express`, `Tài liệu API cho Frontend — Spa Management Backend`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Should `skinImageService.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08888888888888889 - nodes in this community are weakly interconnected._
- **Should `test_rosa_image_sessions_migration.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09243697478991597 - nodes in this community are weakly interconnected._