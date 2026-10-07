# CONTEXT — Spa Management Backend

> File bàn giao cho developer/AI. Đọc file này trước khi sửa code; cập nhật nó cùng lúc khi thêm route, schema, migration hoặc quy tắc nghiệp vụ. Trạng thái: **06/10/2026**.

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
| `/api/invoices` | Token | Tạo/xem/sửa/xóa hóa đơn; STAFF bị giới hạn cơ sở và ngày thao tác |
| `/api/appointments` | Token | CRUD lịch hẹn; STAFF bị giới hạn branch token, MANAGER thao tác mọi branch |
| `/api/customer-bookings` | Token | Chỉ đọc/tìm kiếm booking từ MiniApp; STAFF bị giới hạn branch token |
| `/api/customer-wallet-logs` | Token | CRUD nạp ví; STAFF bị giới hạn branch token |
| `/api/debt-payments` | Token | CRUD thu nợ; điều chỉnh `customers.total_debt`, STAFF bị giới hạn branch token |
| `/api/treatments` | Token; POST thẻ thủ công chỉ MANAGER | Thẻ liệu trình, lịch sử thực hiện, hoa hồng |

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
| `products` | Product/service, price, session; `is_active` legacy | CRUD products |
| `product_commissions` | unique `(product_id, role_id)` | Nested products |
| `inventory` | branch/product/quantity; unique `(branch_id, product_id)` | Tồn đầu kỳ/increase import, read nested product |
| `inventory_imports` | Header nhập, code unique, FK branch | Create/list/detail import |
| `inventory_import_items` | Snapshot product name/price/discount, FK import/product | Import detail |
| `appointments`, `customer_bookings` | Lịch/booking | Appointment CRUD; customer booking chỉ read/search |
| `customer_wallet_logs`, `debt_payments` | Ví/thu nợ | Debt payment bắt buộc invoice; `branch_id` hạch toán theo invoice, `collection_branch_id` là nơi thực thu và giới hạn STAFF |
| `expense_vouchers`, `bank_transactions` | Chi phí/giao dịch bank | Chưa API |
| `invoices`, `invoice_items`, `invoice_item_consultants` | Bán hàng/hóa đơn | CRUD invoice |
| `treatments`, `treatment_history`, `treatment_history_staffs` | Liệu trình | Create/list/detail, execute/undo, staff commission |
| `orders`, `order_items` | Online order | Chưa API |
| `promotions`, `app_contents` | Khuyến mãi/nội dung app | Chưa API |

Đọc `db_system_master.sql` và `db_spa_template.sql` khi cần datatype/default/index đầy đủ: hai file đó là source of truth.

## Product và nhập kho: quy tắc quan trọng

### Product (`/api/products`)

- POST/PUT/DELETE/restore chỉ MANAGER; GET list/detail dùng được bởi người có token.
- Create bắt buộc `name`, `price`, `is_product`. `commissions` và `inventory` đều tùy chọn.
- Create transaction: insert product -> commissions (nếu có) -> tồn ban đầu (nếu có).
- Commission tùy chọn: có thể bỏ qua/gửi `null`/`[]`. Nếu có `{ role_id, commission_percent?, commission_fixed_amount? }`: role không lặp; percent 0–100.
- Initial inventory tùy chọn: có thể bỏ qua/gửi `null`/`[]` (dịch vụ hoặc hàng hóa nhập sau). Nếu có dòng `{ branch_id, quantity }`: branch không lặp, quantity nguyên >= 0.
- `is_active` còn trong schema cũ nhưng Product API cố ý bỏ qua khi create/update và không trả về response; khả dụng product dựa trên soft delete.
- GET list tìm theo chuỗi con không phân biệt hoa/thường. GET detail trả product + `commissions` kèm `role_name` + `inventory` kèm `branch_name`.
- PUT cho partial metadata và optional full-sync commissions; gửi `commissions: []` xóa mềm toàn bộ commission.
- PUT không chỉnh inventory; tăng tồn phải tạo phiếu nhập.

### Inventory import (`/api/inventory-imports`)

- Endpoint hiện có: POST create, GET list, GET detail. Chưa update/delete/hoàn phiếu để tránh lệch tồn.
- Create bắt buộc `branch_id`, `import_code` unique, `items` không rỗng.
- Item: `{ product_id, quantity, unit_price, discount_percent?, discount_amount? }`; product không lặp, quantity nguyên > 0.
- Không trust total từ frontend. Backend snapshot `product_name`, tính `total_price = qty*unit_price - qty*unit_price*discount_percent/100 - discount_amount`, không cho âm, cộng `total_amount`.
- Cùng transaction: insert header -> items -> upsert inventory `quantity = quantity + imported quantity`.
- Upsert phụ thuộc unique index `inventory(branch_id, product_id)`.

## Invoice và treatment: quy tắc quan trọng

### Invoice (`/api/invoices`)

- Create/update nhận `items[].unit_price` (hoặc alias `items[].price`) là giá bán thực tế; chỉ khi không gửi hai field này mới dùng `products.price`.
- Giá sử dụng được snapshot vào `invoice_items.snapshot_price`; tổng dòng/tổng hóa đơn được server tính lại sau chiết khấu.
- Transaction đồng thời cập nhật ví, công nợ, tồn kho, invoice items và thẻ liệu trình tạo từ combo.
- Bán hàng hóa dùng UPSERT theo unique `(branch_id, product_id)`: cho phép tồn âm; nếu branch chưa có dòng inventory của product thì tự tạo với quantity âm. Hoàn tồn khi update/delete cũng dùng cùng cơ chế để không bị bỏ qua khi thiếu dòng kho.
- Khi xóa invoice, mỗi `invoice_item` hàng hóa chỉ được hoàn tồn kho đúng một lần trong cùng transaction.
- STAFF chỉ xem/tạo/sửa/xóa invoice thuộc branch token; sửa/xóa chỉ invoice tạo trong ngày.
- `items[].consultants` được kiểm tra theo branch: STAFF chỉ được chọn staff thuộc branch trong token; MANAGER có thể chọn staff ở branch khác. `revenue_amount` mỗi consultant phải `>= 0` và tổng chia sale của từng item không được vượt `final_price` sau chiết khấu. `paid_amount` bỏ qua sẽ mặc định bằng `0`.
- Backend tự tính tiền invoice và bắt buộc `wallet_used <= total_amount`, `paid_amount + wallet_used <= total_amount`; không thể trừ ví hoặc ghi nhận tổng thanh toán vượt giá trị hóa đơn. Nếu tổng thanh toán nhỏ hơn tổng hóa đơn, phần chênh lệch là công nợ: `debt_amount = total_amount - paid_amount - wallet_used`.
- `invoices.wallet_used` là cột DECIMAL riêng để lưu số tiền ví đã dùng; không lưu số tiền ví vào `payment_method`. Migration backfill dữ liệu legacy từng dùng marker `[WALLET:<amount>]`.
- `GET /api/invoices?hasDebt=true` lọc hóa đơn có `invoices.debt_amount > 0`; `hasDebt=false` lọc hóa đơn có `debt_amount = 0`.
- Không được sửa hoặc xóa invoice nếu tồn tại `debt_payments` active cùng `invoice_id`, nhằm tránh lệch `customers.total_debt` với sổ phiếu thu nợ.

### Appointment (`/api/appointments`)

- Có CRUD soft-delete: POST, GET list/detail, PUT partial và DELETE. List hỗ trợ `search`, `branchId`, `status`, `startDate`, `endDate`; trả thêm tên/số điện thoại khách và tên branch.
- MANAGER phải truyền `branch_id` khi tạo và có thể tạo/sửa/chuyển/xóa lịch hẹn ở mọi branch active trong tenant.
- STAFF tạo lịch hẹn luôn dùng branch token (bỏ qua `branch_id` body), chỉ xem/sửa/xóa lịch hẹn thuộc branch token và không thể chuyển lịch hẹn sang branch khác.
- `customer_id` phải active, `appointment_date` hợp lệ; không cho POST/PUT `status`. Lịch mới lưu `Khách chưa đến` (cả lịch tự tạo từ liệu trình). GET list/detail trả `status` động: `Khách đã đến` khi có invoice hoặc treatment_history active cùng khách/cơ sở được tạo sau khi đặt lịch, từ đầu ngày hẹn đến hiện tại và trước lần hẹn kế tiếp; không sửa code invoices/treatment_history, không ghi status động vào DB. Migration `docs/migrations/2026-10-06_appointment_status.sql` đổi default trên từng tenant hiện hữu.
- GET `/api/appointments/tomorrow` lấy lịch ngày mai; GET `/api/appointments/not-arrived` lấy lịch hôm nay/trước đó chưa đến. Cùng filter và phân quyền như GET list; dùng múi giờ ngày của DB.

### Customer booking và wallet (`/api/customer-bookings`, `/api/customer-wallet-logs`)

- Customer booking là dữ liệu MiniApp: API quản trị chỉ có `GET /api/customer-bookings` để tìm kiếm/lọc; không tạo/sửa/xóa từ backend quản trị. STAFF chỉ xem branch token, MANAGER xem/lọc mọi branch.
- Nạp ví qua `POST /api/customer-wallet-logs`: MANAGER bắt buộc gửi `branch_id`; STAFF bị ép branch token. Có thể nhập bonus theo `bonus_percent` hoặc `bonus_amount`; backend tính field còn lại (với `paid_amount = 0` chỉ nhận bonus amount) và `total_received`, sau đó insert log rồi tăng `customers.wallet_balance` trong cùng transaction. History có GET list/detail cùng giới hạn branch cho STAFF.
- Thu nợ qua CRUD `/api/debt-payments`: bắt buộc `invoice_id` active; `customer_id` và `branch_id` hạch toán lấy từ invoice (nếu body cung cấp phải khớp). MANAGER chọn `collection_branch_id` đang hoạt động; STAFF bị ép nơi thực thu bằng branch token, kể cả khi invoice thuộc branch khác. Quyền list/detail/update/delete của STAFF theo `collection_branch_id`. Amount > 0, không vượt `customers.total_debt`; tổng phiếu active không vượt `invoices.debt_amount`. Create/update/delete chạy transaction và trừ/điều chỉnh/cộng lại `total_debt`.
- `GET /api/debt-payments/invoices/:invoiceId/remaining-debt` trả nợ gốc hóa đơn, tổng phiếu thu active và nợ còn lại = max(0, nợ gốc - tổng đã thu); STAFF có thể tra invoice khác branch để thu liên chi nhánh. Không thay đổi schema.

### Treatment (`/api/treatments`)

- Thẻ liệu trình dùng xuyên cơ sở trong cùng tenant: mọi tài khoản có token được list/detail; treatment được tạo history tại branch thực tế. STAFF khi execute có thể bỏ qua `branch_id` và backend tự lấy branch token; MANAGER bắt buộc truyền `branch_id`. Lịch hẹn tự tạo sau khi execute có note `Lịch hẹn tự động từ liệu trình: <tên dịch vụ>`.
- STAFF chỉ được execute, gán staff và hoàn tác history tại branch trong token; các staff được lưu vào `treatment_history_staffs` cũng phải thuộc branch token. MANAGER không bị giới hạn branch khi sửa/xóa/gán.
- `PUT /api/treatments/execute/:historyId/staffs` nhận `staffs` là mảng, kể cả `[]`. Gửi mảng rỗng sẽ xóa mềm toàn bộ assignment/hoa hồng snapshot hiện có của history; quyền branch của STAFF vẫn được áp dụng.
- `GET /api/treatments/commissions` khóa STAFF theo branch token ở cả history và staff; hỗ trợ `roleName`, `productId` và sắp xếp theo branch, staff name, staff id, commission.
- `GET /api/treatments?invoiceId=...` lọc các thẻ liệu trình được sinh từ hóa đơn, không phụ thuộc hóa đơn được tạo ở branch nào.
- Hoa hồng history được snapshot theo `product_commissions` và role của staff; không có rule hợp lệ thì bằng `0`.

## Migration tenant cũ

- `docs/migrations/2026-10-03_add_inventory_imports.sql` thêm unique inventory và table nhập kho.
- Chạy **một lần trên từng tenant database cũ**, không chạy `db_system_master`.
- `docs/migrations/2026-10-06_create_or_alter_debt_payments.sql`: chọn nhánh tạo bảng nếu chưa có, hoặc kiểm tra và đối soát tất cả phiếu cũ trước khi ALTER. Không gán invoice tùy tiện; bảo toàn nơi thực thu trước khi đồng bộ branch hạch toán.
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

## Cập nhật gần đây
- Hoàn thiện API Invoices (Bán hàng): giá dòng ưu tiên frontend gửi (`unit_price`/`price`), fallback product price; tự động trừ tồn kho, sinh thẻ liệu trình, chặn sửa/xóa nếu liệu trình đã sử dụng.
- Hoàn thiện API Treatments (Thẻ liệu trình): dùng xuyên cơ sở, tìm kiếm theo khách hàng/dịch vụ/khoảng thời gian, thực hiện/hoàn tác buổi và tính hoa hồng KTV.
- Hoàn thiện API Expenses (Phiếu chi).
