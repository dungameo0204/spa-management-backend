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
  docs/API_FRONTEND.md           Tài liệu tích hợp frontend nghiệp vụ Spa
  docs/SUPERADMIN_FRONTEND.md    Bàn giao độc lập cho frontend quản lý tenant/Superadmin
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
| `/api/reports` | MANAGER | Tổng hợp doanh thu/thu chi, tổng theo nhân viên và chi tiết chứng từ có phân trang |
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
| `expense_vouchers`, `expenses_vouchers_items`, `bank_transactions` | Phiếu chi nhiều mục/giao dịch bank | `/api/expenses` |
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

### Reports (`/api/reports`)

- Chỉ MANAGER xem toàn bộ `/api/reports`; STAFF và SUPER_ADMIN nhận 403. `startDate`/`endDate` bắt buộc YYYY-MM-DD, inclusive; `branchId` tùy chọn cho MANAGER. `GET /revenue` tổng hợp, `GET /commissions`, `/consultants` nhóm theo branch + staff; `GET /details/:type` phân trang (1–100 dòng/trang) cho invoices/debt_payments/wallet_logs/expenses/inventory_imports/commissions/consultants.
- Doanh thu bán hàng theo `invoice_date`, `invoice_items.final_price` phân loại `products.is_product`. Chiết khấu cấp hóa đơn (`SUM(final_price) - invoice.total_amount`) trừ hết dịch vụ trước, còn dư trừ sản phẩm. Tổng thu tiền thật = invoice.paid_amount + debt_payments.amount (branch hóa đơn) + customer_wallet_logs.paid_amount; không cộng lại ví dùng/bonus. Tổng chi = expense_vouchers.amount + inventory_imports.total_amount (nhập kho không ghi phiếu chi). Thu−chi không phải lợi nhuận. Mốc ngày tiền thu nợ/chi/nạp ví/nhập kho lấy từ payment_date/expense_date/created_at/import_date tương ứng. Chứng từ xóa mềm không tính.
- Báo cáo công ca tính tại lúc đọc từ `product_commissions` đang hoạt động, role và giá sản phẩm hiện tại; `commission_amount_snapshot` chỉ là cột legacy, assignment mới lưu 0. Phiếu chi dùng `items[]`, header `amount` là tổng để báo cáo không nhân đôi; migration backfill phiếu cũ tại `docs/migrations/2026-10-12_add_expenses_vouchers_items.sql`. Tiền tư vấn là `invoice_item_consultants.revenue_amount`. Tổng quan khách (`GET /api/customers/:id/overview`) trả mua hàng và mọi thẻ chưa xóa kể cả hết buổi, thứ tự mới nhất trước. Xem contract tại `docs/API_FRONTEND.md`.

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

- `attachTenantDB` chưa mount, nên expire/deleted tenant chưa được chặn bằng middleware ở API thực tế; login đã kiểm tra trạng thái tenant nhưng token đã phát hành chưa bị kiểm tra lại ở mọi request.
- API GET danh sách đã phân trang SQL (`page`, `pageSize`, `total`, `totalPages`); báo cáo tổng quan và chi tiết theo ID không phân trang. Có `GET /health` kiểm tra master MySQL và chỉ trả `ok`/`unavailable`; chưa có refresh token, logout, upload, Swagger hay test suite tích hợp DB thật.

### Kiểm chứng MySQL tenant (2026-10-09)

- Đã chạy script chỉ đọc `scratch/verify_tenant_readonly.js` trên tenant `db_spa_1791039769068_e185` (tenant ID 7), sử dụng API HTTP thực và truy vấn MySQL đối chiếu. Mật khẩu lấy từ `.env`, không lưu trong script. Script chạy trên cổng ngẫu nhiên; không tạo/xóa dữ liệu.
- 13 danh sách tenant, danh sách users/tenants: kiểm tra tổng số, toàn bộ các trang với `pageSize=3`, ID không lặp, trang quá giới hạn rỗng, trang không hợp lệ HTTP 400. Đã kiểm tra lọc theo khách/chi nhánh, ranh giới ngày hóa đơn, quyền STAFF theo chi nhánh và chặn STAFF truy cập báo cáo.
- Đã đối chiếu `reports/revenue` với **toàn bộ trang** của 7 bảng `reports/details/:type`, cả toàn spa và chi nhánh 1; tổng `commissions`/`consultants` của nhóm nhân viên khớp với chi tiết. Kết quả toàn spa trong kỳ 2026-10-01 đến 2026-10-31: 18 hóa đơn, 21 thu nợ, 8 nạp ví, 2 phiếu chi, 3 phiếu nhập, 6 dòng công ca và 7 dòng tư vấn. Doanh thu 42.900.000; dòng tiền ròng -8.170.000. Đây là dữ liệu thử có thể thay đổi, không phải số liệu cố định.
- `customer_bookings`, `appointments/tomorrow`, `appointments/not-arrived` đang rỗng tại thời điểm test; mới xác nhận response rỗng, chưa thể xác nhận nội dung phân trang của các endpoint này với dữ liệu thật. Chưa thử đồng thời ghi/xóa dữ liệu giữa truy vấn COUNT và truy vấn page.
- `POST /api/customers/reset-password` đã chuyển thành thao tác chỉ MANAGER, tenant lấy từ JWT. MiniApp chưa có quên mật khẩu public; nếu bổ sung phải có OTP/xác minh riêng.
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
- Tenant/Superadmin: `GET /api/tenants` hỗ trợ `status=all|active|expired|disabled`, bao gồm tenant đã vô hiệu hóa khi phù hợp bộ lọc và trả audit/status; chi tiết tenant đọc được cả tenant disabled. Login chặn tài khoản thuộc tenant bị vô hiệu hóa hoặc hết hạn. Xem `docs/SUPERADMIN_FRONTEND.md` trước khi làm UI quản trị.
- Hoàn thiện API Invoices (Bán hàng): giá dòng ưu tiên frontend gửi (`unit_price`/`price`), fallback product price; tự động trừ tồn kho, sinh thẻ liệu trình, chặn sửa/xóa nếu liệu trình đã sử dụng.
- Hoàn thiện API Treatments (Thẻ liệu trình): dùng xuyên cơ sở, tìm kiếm theo khách hàng/dịch vụ/khoảng thời gian, thực hiện/hoàn tác buổi và tính hoa hồng KTV.
- Hoàn thiện API Expenses (Phiếu chi).
