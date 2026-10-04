# CONTEXT — Spa Management Backend

> File bàn giao cho developer/AI. Đọc file này trước khi sửa code; cập nhật nó cùng lúc khi thêm route, schema, migration hoặc quy tắc nghiệp vụ. Trạng thái: **03/10/2026**.

## Công nghệ và lệnh chạy

- Node.js CommonJS, Express 5, MySQL 8 (`mysql2/promise`), JWT, bcryptjs.
- Dependencies không có ORM, test runner, TypeScript, lint hoặc Swagger.
- `.env`: `PORT`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_SYSTEM_NAME`, `JWT_SECRET`.
- `npm install`; `npm start`; `npm run dev`.
- Kiểm tra syntax: `Get-ChildItem .\src -Recurse -Filter *.js | % { node --check $_.FullName }`.

## Cấu trúc dự án

```text
src/
  server.js                    Express bootstrap + mount route
  config/database.js           masterPool, getTenantDbName(tenantId)
  controllers/                 HTTP request/response mỏng
  services/                    SQL + nghiệp vụ chính
  routes/                      Route mapping + middleware quyền
  middlewares/auth.js          verifyToken, verifySuperAdmin, verifyManager
  middlewares/tenant.js        attachTenantDB (đang chưa mount)
  utils/response.js            đang rỗng
db_system_master.sql           Schema master
db_spa_template.sql            Schema để clone cho tenant/Spa mới
docs/API_FRONTEND.md           Tài liệu tích hợp frontend
docs/migrations/               Migration cho tenant cũ
docs/CONTEXT.md                File này
```

## Kiến trúc multi-tenant

1. `db_system_master` chứa `tenants`, `users`, subscription/payment records.
2. Mỗi Spa có database riêng, tên ở `tenants.database_name`.
3. Service lấy database tenant bằng `getTenantDbName(tenantId)`, sau đó query `` `dbName`.table `` qua `masterPool`.
4. Tạo tenant clone toàn bộ table từ `db_spa_template` bằng `CREATE TABLE ... LIKE`.
5. Sửa template **không** cập nhật tenant cũ: schema mới phải có file migration trong `docs/migrations/`.

## Auth, quyền và quy chuẩn

- Login: `POST /api/auth/login`; JWT hệ thống sống 15h; header `Authorization: Bearer <token>`.
- Payload: `id`, `tenant_id`, `username`, `fullname`, `branch_id`, `system_role`.
- Roles: `SUPER_ADMIN` quản lý tenant; `MANAGER` quản lý nghiệp vụ Spa; `STAFF` có một số route token-only và bị giới hạn branch trong service staff.
- Router -> controller -> service. SQL chỉ đặt ở service; CommonJS `require/module.exports`; query dùng placeholder `?`.
- Audit executor: `req.user.fullname || req.user.username`.
- DELETE theo convention là soft delete (`deleted_at`, `deleted_by`); restore clear các cột đó, set `updated_by`.
- Thao tác nhiều bảng/số tiền/tồn kho phải dùng transaction: get connection -> begin -> commit/rollback -> release `finally`.
- Tên API tenant ưu tiên snake_case; user/tenant lịch sử dùng một số camelCase (`systemRole`, `branchId`, `spaName`).

## Route đang mount

| Base route | Quyền | Chức năng |
|---|---|---|
| `/api/auth` | Public | Login |
| `/api/tenants` | SUPER_ADMIN | CRUD soft-delete tenant |
| `/api/users` | MANAGER | Tài khoản system thuộc tenant |
| `/api/roles` | MANAGER | Chức vụ |
| `/api/staffs` | Token | Nhân sự; STAFF bị giới hạn branch ở service |
| `/api/branches` | MANAGER | Chi nhánh/payment config |
| `/api/customers` | reset password public, còn lại token | Khách hàng |
| `/api/products` | MANAGER | Product, commission, tồn đầu kỳ |
| `/api/inventory-imports` | MANAGER | Phiếu nhập kho |

`miniappRoutes.js` là demo và chưa mount trong `server.js`; không ưu tiên cho tới khi chức năng quản trị hoàn thành. File không thể mount nguyên trạng vì router tham chiếu `getMyProfile` và `bookAppointment` chưa export từ controller.

## Schema master

| Table | Mục đích |
|---|---|
| `tenants` | Spa, tenant database, expire, audit/soft delete. |
| `users` | System user; FK `tenant_id -> tenants`; `branch_id` là ID ở tenant DB. |
| `subscription_packages` | Gói thuê bao, chưa API. |
| `pending_orders` | Đơn mua/gia hạn chờ thanh toán, chưa API. |
| `payment_logs` | Webhook/payment log, chưa API. |

## Schema tenant và trạng thái API

| Table | Quan hệ/nghiệp vụ | API |
|---|---|---|
| `branches` | Chi nhánh + cấu hình payment | CRUD branches |
| `roles` | Chức vụ | CRUD roles |
| `staffs` | FK branches, roles | CRUD staffs |
| `customers` | Customer, password, wallet/debt | CRUD customers |
| `products` | Product/service, price, session, active | CRUD products |
| `product_commissions` | unique `(product_id, role_id)` | Nested products |
| `inventory` | branch/product/quantity; unique `(branch_id, product_id)` | Tồn đầu kỳ/increase import, read nested product |
| `inventory_imports` | Header nhập, code unique, FK branch | Create/list/detail import |
| `inventory_import_items` | Snapshot product name/price/discount, FK import/product | Import detail |
| `appointments`, `customer_bookings` | Lịch/booking | Chưa API |
| `customer_wallet_logs`, `debt_payments` | Ví/thu nợ | Chưa API |
| `expense_vouchers`, `bank_transactions` | Chi phí/giao dịch bank | Chưa API |
| `invoices`, `invoice_items`, `invoice_item_consultants` | Bán hàng/hóa đơn | Chưa API |
| `treatments`, `treatment_history`, `treatment_history_staffs` | Liệu trình | Chưa API |
| `orders`, `order_items` | Online order | Chưa API |
| `promotions`, `app_contents` | Khuyến mãi/nội dung app | Chưa API |

Đọc `db_system_master.sql` và `db_spa_template.sql` khi cần datatype/default/index đầy đủ: hai file đó là source of truth.

## Product và nhập kho: quy tắc quan trọng

### Product (`/api/products`)

- Tất cả endpoint MANAGER-only.
- Create bắt buộc `name`, `price`, `is_product`. `commissions` và `inventory` đều tùy chọn.
- Create transaction: insert product -> commissions (nếu có) -> tồn ban đầu (nếu có).
- Commission tùy chọn: có thể bỏ qua/gửi `null`/`[]`. Nếu có `{ role_id, commission_percent?, commission_fixed_amount? }`: role không lặp; percent 0–100.
- Initial inventory tùy chọn: có thể bỏ qua/gửi `null`/`[]` (dịch vụ hoặc hàng hóa nhập sau). Nếu có dòng `{ branch_id, quantity }`: branch không lặp, quantity nguyên >= 0.
- GET trả product + `commissions` kèm `role_name` + `inventory` kèm `branch_name`.
- PUT cho partial metadata và optional full-sync commissions; gửi `commissions: []` xóa mềm toàn bộ commission.
- PUT không chỉnh inventory; tăng tồn phải tạo phiếu nhập.

### Inventory import (`/api/inventory-imports`)

- Endpoint hiện có: POST create, GET list, GET detail. Chưa update/delete/hoàn phiếu để tránh lệch tồn.
- Create bắt buộc `branch_id`, `import_code` unique, `items` không rỗng.
- Item: `{ product_id, quantity, unit_price, discount_percent?, discount_amount? }`; product không lặp, quantity nguyên > 0.
- Không trust total từ frontend. Backend snapshot `product_name`, tính `total_price = qty*unit_price - qty*unit_price*discount_percent/100 - discount_amount`, không cho âm, cộng `total_amount`.
- Cùng transaction: insert header -> items -> upsert inventory `quantity = quantity + imported quantity`.
- Upsert phụ thuộc unique index `inventory(branch_id, product_id)`.

## Migration tenant cũ

- `docs/migrations/2026-10-03_add_inventory_imports.sql` thêm unique inventory và table nhập kho.
- Chạy **một lần trên từng tenant database cũ**, không chạy `db_system_master`.
- Nếu inventory cũ có duplicate `(branch_id, product_id)`, gộp/xử lý trước khi thêm unique key.

## Hạn chế/rủi ro đã biết

- `attachTenantDB` chưa mount, nên expire/deleted tenant chưa được chặn bằng middleware ở API thực tế.
- Không pagination, health check, refresh token, logout, upload, Swagger hay test suite.
- `POST /api/customers/reset-password` public chưa OTP/xác minh: rủi ro bảo mật.
- `GET /api/branches` dùng `SELECT *`, có thể trả `payment_api_key`; cần xử lý khi production.
- Cập nhật đồng thời `docs/API_FRONTEND.md` và `docs/CONTEXT.md` khi thay đổi tính năng.

## Checklist thêm tính năng

1. Xác định table ở master hay tenant.
2. Cập nhật template SQL + migration tenant cũ nếu schema đổi.
3. Service -> controller -> route; mount ở `server.js`.
4. Validate quyền, tenant ownership, FK, soft delete, money/quantity.
5. Dùng transaction khi nhiều bảng hoặc thay đổi số dư/tồn kho.
6. Cập nhật API docs và CONTEXT.
7. Chạy `node --check` cho toàn bộ `src/**/*.js`; test HTTP với MySQL khi schema sẵn sàng.