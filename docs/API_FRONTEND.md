# Bổ sung Rosa: lịch sử liên hệ lịch hẹn

Ghi chú liên hệ lưu riêng từng entry trong bảng phụ, không ghi đè `note` tự động từ liệu trình. Dùng `POST /api/appointments/:id/contact-notes` với `{ "content": "Đã liên hệ khách" }` để thêm một lần có ngày Việt Nam do backend sinh. Sửa nội dung bằng PUT và xóa mềm bằng DELETE `/api/appointments/:id/contact-notes/:noteId`. GET lịch hẹn trả `extra_note` tổng hợp và `contact_notes` có ID/ngày/metadata; POST/PUT lịch hẹn thông thường không nhận hai field này. Xem hợp đồng đầy đủ trong `ROSA_APPOINTMENT_CONTACT_NOTES_API.md`.

# Hướng dẫn thay đổi frontend Rosa

Đọc `docs/ROSA_FRONTEND_CHANGELOG.md` trước để biết màn hình/API nào thay đổi, ý nghĩa trường gửi/nhận, các quy tắc tích hợp và checklist frontend. Backend local Rosa hiện cấu hình cổng 5002 → MySQL 3308. Tài liệu này bên dưới là tham chiếu API đầy đủ.

## Rosa treatment groups

See `docs/ROSA_TREATMENT_GROUPS_API.md` for invoice `items[].treatment` creation, nested children/history, lifetime cards and signed group completion. Invoice creation already creates the cards atomically: **do not send a second POST /api/treatments**. Explicit configured lines require quantity=1; omitted configuration retains legacy behavior. Invoice detail exposes actual cards at `data.items[].treatment`.

## Rosa: chức năng đã triển khai sau giai đoạn schema nền tảng

Xem `docs/ROSA_SCHEMA.md`. POST thẻ thủ công chấp nhận `total_sessions: null` cho trọn đời, khi đó bỏ `remaining_sessions` hoặc gửi null; không nhận parent_treatment_id. Thẻ trọn đời hoạt động giữ số buổi NULL khi thực hiện; thẻ đóng/cha đóng bị chặn. Bộ lọc active bao gồm thẻ trọn đời còn mở.

GET booking dùng arrival_date/time để lọc/sắp xếp, hỗ trợ khoảng giờ và has_arrived; booking có CRUD nội bộ. API hồ sơ, ảnh nhiều file, cấu hình dịch vụ con, tạo nhóm từ invoice, chữ ký từng buổi và ký kết thúc đã triển khai. Xem các tài liệu chuyên đề được liệt kê trong ROSA_FRONTEND_CHANGELOG.md; không áp dụng ghi chú schema-only cũ như giới hạn của API hiện tại.

Hóa đơn có thẻ trọn đời/cha-con/đã đóng bị chặn sửa và xóa qua luồng hiện tại để tránh mất liên kết/chữ ký.

## Lịch sử ghi chú hóa đơn trong hồ sơ khách hàng

- `customers.note` vẫn là chuỗi text, giữ ghi chú cũ và nối từng sự kiện bằng `\n`; không thay đổi schema/response khách hàng. Frontend render text với CSS `white-space: pre-wrap`, không dùng HTML injection.
- Dòng mới có dạng `27/10/2026 [HĐ #123 - Tạo] Khách đổi 1 buổi nặn mụn thành 1 buổi peel`. Ngày là ngày thao tác thực tế theo timezone local backend, không lấy `invoice_date`.
- POST hóa đơn: `note` không rỗng sau trim thì nối dòng `Tạo`; không có nội dung thì không nối.
- PUT hóa đơn: không gửi `note` giữ nội dung hiện tại; gửi cùng nội dung sau trim không nối trùng; thay đổi nội dung nối dòng `Sửa ghi chú`. Gửi null/chuỗi rỗng/khoảng trắng sẽ xóa `invoices.note` và nối dòng `Đã xóa ghi chú` nếu trước đó có nội dung.
- DELETE hóa đơn thành công: luôn nối dòng `[HĐ #123 - Đã xóa]`, không xóa các ghi chú cũ trong hồ sơ khách.
- Đổi khách trên hóa đơn: khách cũ nhận dòng `Chuyển sang khách #ID`; khách mới nhận dòng `Chuyển từ khách #ID` cùng ghi chú hiện tại. Lịch sử cũ không di chuyển/xóa.
- `note` chỉ nhận string/null, không nhận object/array/boolean/number. Nếu ghi chú vượt dung lượng TEXT (65535 byte UTF-8), API trả HTTP 400 và rollback toàn bộ thao tác hóa đơn, không cắt nội dung.
- Không tự bổ sung ghi chú cho hóa đơn cũ khi triển khai; API sửa hồ sơ khách vẫn có thể thay thế toàn bộ `customers.note`, nên đây không phải audit log bất biến.
- Sau khi tạo/sửa/xóa hóa đơn, frontend cần tải lại dữ liệu khách để thấy ghi chú mới; response hóa đơn không đổi.

# STAFF: giới hạn ngày phiếu và xóa lịch sử liệu trình

- `POST /api/inventory-imports`, `PUT /api/inventory-imports/:id`: STAFF không được gửi `import_date` hoặc `created_at` (kể cả null/rỗng); vi phạm trả HTTP 400. Khi tạo, ngày được ghi tự động bằng thời gian hiện tại của database.
- `POST /api/expenses`, `PUT /api/expenses/:id`: STAFF không được gửi `expense_date` hoặc `created_at` (kể cả null/rỗng); vi phạm trả HTTP 400. Frontend cần bỏ các trường này khỏi payload STAFF, không chỉ khóa ô nhập.
- `DELETE /api/treatments/execute/:historyId`: STAFF chỉ được xóa khi cả `execution_date` và `created_at` đều thuộc hôm nay theo ngày lịch/múi giờ local của backend. Ngày thiếu/không hợp lệ, quá khứ hoặc tương lai đều bị chặn HTTP 400, trước khi hoàn buổi/xóa công ca/lịch hẹn. Giới hạn chi nhánh vẫn áp dụng.
- MANAGER không bị áp dụng các giới hạn mới này. Không thay đổi các quyền sửa/xóa phiếu khác.
- Máy chạy Node.js và MySQL cần cấu hình đồng bộ thời gian/múi giờ.

# Tài liệu API cho Frontend — Spa Management Backend

## Phân trang cho API danh sách (cập nhật 2026-10-09)

Tất cả API GET trả **danh sách** (`/api/tenants`, `/api/users`, `/api/branches`, `/api/roles`, `/api/staffs`, `/api/customers`, `/api/products`, `/api/invoices`, `/api/expenses`, `/api/inventory-imports`, `/api/treatments`, `/api/treatments/commissions`, `/api/appointments`, `/api/appointments/tomorrow`, `/api/appointments/not-arrived`, `/api/customer-bookings`, `/api/customer-wallet-logs`, `/api/debt-payments`) nhận `page` (mặc định `1`) và `pageSize` (mặc định `20`, tối đa `100`). Query tìm kiếm và bộ lọc trước đây vẫn dùng như cũ. Tham số phân trang không hợp lệ trả HTTP `400`.

Ví dụ: `GET /api/customers?search=An&page=2&pageSize=10` trả `{ "message": "Lấy danh sách thành công", "total": 42, "page": 2, "pageSize": 10, "totalPages": 5, "data": [ /* tối đa 10 khách hàng */ ] }`. `total` là số bản ghi **sau lọc trên tất cả trang**, không phải `data.length`; trang vượt quá `totalPages` trả `data: []`. Không truyền tham số chỉ tải trang đầu (không còn trả toàn bộ danh sách). Khi đổi bộ lọc, frontend cần đặt lại `page=1`.

`GET /api/reports/details/:type` giữ nguyên phân trang như phần báo cáo bên dưới. `GET /api/reports/commissions` và `/api/reports/consultants` nay cũng hỗ trợ `page/pageSize`, trả thêm `total`, `page`, `pageSize`, `totalPages` cho mảng `staffTotals`; `totalAmount` vẫn là tổng của **toàn bộ nhóm sau lọc**, không chỉ trang đang xem. API tổng quan `/api/reports/revenue`, chi tiết theo ID và API trả một đối tượng đơn lẻ không phân trang.


> Tài liệu được tổng hợp từ mã nguồn trong `src/` và hai schema `db_system_master.sql`, `db_spa_template.sql`; mục thu nợ cập nhật **06/10/2026**. Schema tenant cũ phải được migration trước khi dùng API thu nợ mới.

## 1. Tổng quan

- Stack: Node.js, Express 5, MySQL (`mysql2`), JWT, bcrypt.
- Nội dung JSON: gửi header `Content-Type: application/json`.
- Khi `NODE_ENV=production`, backend chỉ cho các origin HTTPS liệt kê trong `CORS_ORIGINS` (phân tách dấu phẩy) và chỉ lắng nghe `127.0.0.1` để sử dụng cùng Cloudflare Tunnel; ngoài production, CORS mở theo cấu hình dev. Xem `docs/DEPLOY_WINDOWS_CLOUDFLARE.md` trước khi công bố API.
- URL gốc cục bộ: `http://localhost:<PORT>`, trong đó `PORT` lấy từ biến môi trường, mặc định là `5000`.
- Ví dụ dưới đây dùng: `http://localhost:5000`.
- Các API GET trả danh sách có phân trang bằng `page`/`pageSize`; xem phần **Phân trang cho API danh sách** ở đầu tài liệu. API tổng quan `/api/reports/revenue` không phân trang.

## 2. Xác thực và quyền

### 2.1. Header JWT

Với các API yêu cầu đăng nhập nhân sự/hệ thống, gửi:

```http
Authorization: Bearer <token-nhận-từ-POST-/api/auth/login>
```

Token hệ thống có hiệu lực **15 giờ**. Token customer MiniApp (nếu được kích hoạt) có hiệu lực **30 ngày**.

### 2.2. Các quyền hệ thống

| `system_role` | Phạm vi |
|---|---|
| `SUPER_ADMIN` | Quản lý tenant/Spa trên database master. |
| `MANAGER` | Quản lý Spa của mình; quản lý chi nhánh, chức vụ và tài khoản. |
| `STAFF` | Có thể gọi API staff/customer và **xem** danh sách/chi tiết sản phẩm (`GET /api/products`, `GET /api/products/:id`) do các route này chỉ kiểm tra token; không được tạo/sửa/xóa/khôi phục sản phẩm. Nghiệp vụ staff bị giới hạn theo `branch_id` ở một số thao tác. |

> Lưu ý: Route `/api/staffs` chỉ dùng `verifyToken`, **không** dùng `verifyManager`. Vì vậy STAFF có thể gọi các API này; service tự giới hạn dữ liệu/thao tác theo chi nhánh trong một số trường hợp.

### 2.3. Mã lỗi xác thực chung

| Tình huống | HTTP | Response |
|---|---:|---|
| Thiếu header Authorization | 401 | `{ "code": "AUTH_TOKEN_MISSING", "message": "..." }` |
| Header/token sai định dạng, sai chữ ký hoặc chưa có hiệu lực | 401 | `{ "code": "AUTH_TOKEN_INVALID", "message": "..." }` |
| Token hết hạn | 401 | `{ "code": "AUTH_TOKEN_EXPIRED", "message": "..." }` |
| Không phải `SUPER_ADMIN`/`MANAGER` | 403 | `{ "code": "FORBIDDEN", "message": "..." }` |

Từ 2026-10-25, middleware token nhân sự trả **401 thay vì 403** khi token sai/hết hạn. Không phân loại lỗi bằng regex `message`. Các API nghiệp vụ khác có thể vẫn trả 403 không có `code`: không tự logout vì 403. Luồng `verifyCustomerToken` MiniApp không đổi.

## 3. Quy ước dữ liệu và response

- Tên field giữ nguyên `snake_case` hoặc `camelCase` đúng theo từng endpoint; không tự đổi tên khi gọi API.
- `PUT` tại các API nghiệp vụ hiện hoạt động như **partial update**: chỉ field nào được gửi (`!== undefined`) mới được cập nhật, trừ `/api/users/:id` có quy tắc riêng.
- Các thao tác `DELETE` là **xóa mềm** (`deleted_at`, `deleted_by`), không xóa bản ghi vật lý.
- Các endpoint danh sách chỉ lấy bản ghi chưa xóa, **trừ** `/api/users`, endpoint này trả cả tài khoản đã khóa để frontend có thể khôi phục.
- Các trường ngày/giờ từ MySQL trả theo format do driver MySQL serialize; frontend nên parse như giá trị date-time, không phụ thuộc chuỗi hiển thị.
- Lỗi nghiệp vụ thường là `400` với `{ "message": "..." }`; lỗi đọc danh sách thường là `500`.

Mẫu response danh sách:

```json
{
  "message": "Lấy danh sách thành công",
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "data": [{ "id": 1 }]
}
```

## 4. Danh sách nhanh API đang được mount

Tại thời điểm hiện tại, `src/server.js` mount các endpoint hoạt động sau:

| Nhóm | Endpoint |
|---|---|
| Auth | `POST /api/auth/login`, `GET /api/auth/me` |
| Tenant | `POST /api/tenants/create`, `GET /api/tenants`, `GET/PUT/DELETE /api/tenants/:id`, `PATCH /api/tenants/:id/restore`, `POST /api/tenants/:id/renew`, `GET /api/tenants/:id/managers`, `PATCH /api/tenants/:id/managers/:userId/password` |
| User | `POST /api/users/create`, `GET /api/users`, `GET/PUT/DELETE /api/users/:id`, `PATCH /api/users/:id/restore` |
| Role | `POST/GET /api/roles`, `GET/PUT/DELETE /api/roles/:id`, `PATCH /api/roles/:id/restore` |
| Staff | `POST/GET /api/staffs`, `GET/PUT/DELETE /api/staffs/:id`, `PATCH /api/staffs/:id/restore` |
| Branch | `POST/GET /api/branches`, `GET/PUT/DELETE /api/branches/:id`, `PATCH /api/branches/:id/restore` |
| Customer | `POST /api/customers/reset-password` (MANAGER), `POST/GET /api/customers`, `GET/PUT/DELETE /api/customers/:id`, `PATCH /api/customers/:id/restore` |
| Product | `GET /api/products`, `GET /api/products/:id`, `POST /api/products`, `PUT/DELETE /api/products/:id`, `PATCH /api/products/:id/restore` (MANAGER và STAFF); chỉ MANAGER được ghi `commissions`/`commission_tiers` |
| Inventory import | `POST/GET /api/inventory-imports`, `GET/PUT/DELETE /api/inventory-imports/:id` |
| Expense | `POST/GET /api/expenses`, `GET /api/expenses/:id`, `PUT/DELETE /api/expenses/:id` |
| Invoice | `POST/GET /api/invoices`, `GET /api/invoices/:id`, `PUT/DELETE /api/invoices/:id` |
| Appointment | `POST/GET /api/appointments`, `GET /api/appointments/tomorrow`, `GET /api/appointments/not-arrived`, `GET /api/appointments/:id`, `PUT/DELETE /api/appointments/:id` |
| Customer booking | `POST/GET /api/customer-bookings`, `GET/PUT/DELETE /api/customer-bookings/:id` |
| Customer wallet log | `POST/GET /api/customer-wallet-logs`, `GET/PUT/DELETE /api/customer-wallet-logs/:id` |
| Debt payment | `POST/GET /api/debt-payments`, `GET/PUT/DELETE /api/debt-payments/:id`, `GET /api/debt-payments/invoices/:invoiceId/remaining-debt` |
| Treatment | `POST /api/treatments`, `POST /api/treatments/execute`, `DELETE /api/treatments/execute/:historyId`, `PUT /api/treatments/execute/:historyId/staffs`, `GET /api/treatments/commissions` |
| Report (chỉ MANAGER) | `GET /api/reports/revenue`, `GET /api/reports/commissions`, `GET /api/reports/consultants`, `GET /api/reports/details/:type`, `GET /api/reports/products`, `GET /api/reports/products/:productId/invoices` |

---

## 5. Auth

### `POST /api/auth/login`

- Quyền: Public.
- Body bắt buộc:

```json
{ "username": "manager.demo", "password": "your-password" }
```

- Thành công `200`:

```json
{
  "message": "Đăng nhập thành công!",
  "data": {
    "user": {
      "id": 12,
      "tenant_id": 3,
      "branch_id": null,
      "username": "manager.demo",
      "fullname": "Nguyễn Văn A",
      "system_role": "MANAGER",
      "created_at": "...",
      "updated_at": "...",
      "deleted_at": null
    },
    "token": "<jwt>"
  }
}
```

- Thất bại: `400 AUTH_INPUT_INVALID` khi thiếu/sai kiểu username/password; `401 AUTH_CREDENTIALS_INVALID` khi không tồn tại, bị xóa mềm hoặc sai mật khẩu; `403 TENANT_DISABLED`/`TENANT_EXPIRED` khi Spa không sử dụng được; `500 AUTH_SERVICE_ERROR` khi lỗi database/cấu hình/ký token. Giới hạn đăng nhập vẫn trả `429` kèm `Retry-After`.
- Frontend lưu `data.token`; password không được trả về.

### `GET /api/auth/me` — Kiểm tra phiên khi reload (2026-10-25)

- Header bắt buộc: `Authorization: Bearer <token>`; không có body, không truyền tenant/user ID.
- Response auth (cả login và me, kể cả lỗi) có `Cache-Control: no-store`.
- Backend xác minh JWT, đọc user/tenant hiện tại. Không phát token mới, không gia hạn 15 giờ.
- `200`:

```json
{
  "message": "Phiên đăng nhập hợp lệ.",
  "data": {
    "user": {
      "id": 12,
      "tenant_id": 3,
      "branch_id": null,
      "username": "manager.demo",
      "fullname": "Nguyễn Văn A",
      "system_role": "MANAGER"
    },
    "tenant": { "id": 3, "spa_name": "Spa Demo", "expire_at": null },
    "expires_at": "2026-10-26T05:00:00.000Z"
  }
}
```

`expires_at` là thời điểm hết hạn token ISO 8601 UTC (giá trị trên chỉ minh họa); `tenant.expire_at` là hạn gói phần mềm, `null` nếu không giới hạn. `tenant` là `null` cho SUPER_ADMIN không thuộc tenant. User chỉ gồm các field trong ví dụ, không có password/database name/permissions động. Frontend Spa vẫn chỉ nhận MANAGER/STAFF.

| Lỗi `/me` | HTTP | Frontend xử lý |
|---|---:|---|
| `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`, `AUTH_TOKEN_EXPIRED` | 401 | Xóa phiên, yêu cầu đăng nhập lại. |
| `AUTH_SESSION_INVALID` (user không còn hoạt động, JWT không phải phiên nhân sự hợp lệ) | 401 | Xóa phiên, yêu cầu đăng nhập lại. |
| `AUTH_SESSION_CHANGED` (role/tenant/branch khác JWT hiện tại) | 401 | Xóa phiên, đăng nhập lại để nhận quyền mới. |
| `TENANT_DISABLED` (tenant không tồn tại hoặc bị khóa), `TENANT_EXPIRED` | 403 | Giữ token; hiển thị trạng thái bị chặn/gia hạn, không cho vào protected pages. |
| `AUTH_SERVICE_ERROR` | 500 | Giữ phiên, hiển thị lỗi và cho thử lại. |

**Luồng frontend bắt buộc để tránh logout khi reload:**

1. Đọc phiên lưu, cấu hình token provider **trước khi request đầu tiên chạy**. Không chỉ cấu hình trong effect cha trong khi các trang con đã mount và gọi API.
2. Có token thì vào trạng thái `checking`, gọi `/api/auth/me`; chặn protected pages và truy vấn nghiệp vụ cho đến khi xác minh thành công. Không redirect login chỉ vì chưa tải xong user.
3. `200`: giữ token cũ, thay user cache bằng `data.user`, lưu tenant/expires_at nếu cần; giữ nguyên pathname/query/hash.
4. `401` của phiên hiện tại: logout. Login 401 chỉ là sai thông tin đăng nhập, không dùng handler hết phiên toàn cục.
5. `403` không phải hết phiên. Lỗi mạng/timeout/abort/429/5xx cũng không xóa storage; cung cấp trạng thái lỗi và nút thử lại, tôn trọng Retry-After khi có.
6. Chống request xác minh trùng (kể cả React StrictMode); bỏ qua response cũ sau logout/login bằng tài khoản khác. Chỉ handler lỗi của token đang được dùng mới được phép logout.

**Giới hạn bảo mật:** `/me` kiểm tra user/quyền hiện tại khi xác minh phiên; các API nghiệp vụ vẫn dựa vào claims JWT hiện có. Đây không phải cơ chế thu hồi toàn bộ JWT ngay sau đổi mật khẩu/role/xóa tài khoản. Không có refresh token; hết 15 giờ phải đăng nhập lại. Giữ `JWT_SECRET` ổn định và giống nhau giữa các instance backend.

Kiểm thử backend không cần MySQL: `npm run test:auth-session` (database giả lập, HTTP localhost cổng ngẫu nhiên).

---

## 6. Tenant/Spa (chỉ `SUPER_ADMIN`)

Mọi API trong mục này đều yêu cầu Bearer token và `system_role = SUPER_ADMIN`.

### `POST /api/tenants/create` — Tạo Spa mới

Body:

```json
{
  "spaName": "Spa Ngọc Lan",
  "managerUsername": "ngoclan.manager",
  "managerPassword": "secret123",
  "managerFullname": "Nguyễn Ngọc Lan",
  "years": "1"
}
```

| Field | Bắt buộc | Ghi chú |
|---|---:|---|
| `spaName` | Có | String trim 1–100 ký tự. |
| `managerUsername` | Có | String trim 1–100 ký tự, unique toàn bảng `db_system_master.users`. |
| `managerPassword` | Có | String trim 6–255 ký tự; backend băm bcrypt trước khi lưu. |
| `managerFullname` | Có | String trim 1–255 ký tự, họ tên tài khoản MANAGER đầu tiên. |
| `years` | Không | `'lifetime'`, rỗng/null thì không hết hạn; còn lại là số nguyên 1–100. |

Thành công `201`:

```json
{
  "message": "Khởi tạo Spa và nhân bản Database thành công!",
  "data": {
    "tenantId": 7,
    "spaName": "Spa Ngọc Lan",
    "managerUsername": "ngoclan.manager",
    "managerFullname": "Nguyễn Ngọc Lan",
    "database": "db_spa_<timestamp>_<hex>",
    "expireDate": "2027-10-03T...Z"
  }
}
```

Backend tạo tenant, tài khoản MANAGER và clone mọi table từ `db_spa_template` trong transaction.

### `GET /api/tenants?search=<keyword>&status=all&page=1&pageSize=20` — Danh sách Spa

- `search` không bắt buộc, tối đa 100 ký tự; tìm theo `spa_name`, `manager_username`, `manager_fullname`.
- `status` không bắt buộc: `all` (mặc định), `active`, `expired`, `disabled`. `disabled` là tenant xóa mềm; `expired` là tenant chưa xóa nhưng `expire_at` đã đến/quá thời điểm hiện tại.
- Phân trang theo `page`/`pageSize` như quy ước đầu tài liệu.
- Thành công `200`, mỗi phần tử `data` có: `tenant_id`, `spa_name`, `database_name`, `expire_at`, `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`, `deleted_by`, `manager_user_id`, `manager_username`, `manager_fullname`, `status` (`ACTIVE`/`EXPIRED`/`DISABLED`).

### `GET /api/tenants/:id` — Chi tiết Spa

Chỉ SUPER_ADMIN. Thành công `200`: `{ "message": "Lấy chi tiết Spa thành công", "data": Tenant }`, trong đó `Tenant` có cùng các field đầy đủ như item danh sách. Endpoint đọc được cả tenant đã vô hiệu hóa để phục vụ màn khôi phục; không tồn tại trả `404`, ID sai trả `400`.

### `PUT /api/tenants/:id` — Cập nhật Spa

Body (gửi một hoặc cả hai field):

```json
{ "spaName": "Spa Ngọc Lan - Quận 1", "expireAt": "2027-12-31 23:59:59" }
```

- Cần gửi ít nhất một field.
- `spaName`: string trim 1–100 ký tự.
- `expireAt`: date-time hợp lệ hoặc `null` để chuyển sang không thời hạn.
- Thành công `200`: `{ "message": "Cập nhật thông tin Spa thành công!", "data": { "id": "7", "spa_name": "...", "expire_at": "..." } }`.

### `DELETE /api/tenants/:id` — Vô hiệu hóa Spa

- Xóa mềm tenant **và toàn bộ user thuộc tenant** trong master DB.
- Thành công `200`: `{ "message": "Đã xóa (vô hiệu hóa) Spa thành công!" }`.

### `PATCH /api/tenants/:id/restore` — Khôi phục Spa

- Gỡ xóa mềm tenant và toàn bộ user thuộc tenant.
- Thành công `200`: `{ "message": "Đã khôi phục Spa thành công! Các tài khoản đã có thể đăng nhập lại." }`.

### Quản trị MANAGER và gia hạn (chỉ SUPER_ADMIN)

- `GET /api/tenants/:id/managers`: trả `{ message, total, data: [{ id, tenant_id, username, fullname, system_role, created_at, updated_at, deleted_at }] }`; gồm cả tài khoản MANAGER đã xóa mềm để hiển thị, không bao giờ trả password.
- `PATCH /api/tenants/:id/managers/:userId/password` body `{ "newPassword": "matkhau123" }`: cấp lại mật khẩu cho **MANAGER đang hoạt động thuộc đúng Spa đang hoạt động**; 6–255 ký tự sau trim, lưu bcrypt, không trả mật khẩu. Thành công `200 { "message": "Đã cấp lại mật khẩu MANAGER thành công." }`; user/Spa sai hoặc bị vô hiệu hóa `404`.
- `POST /api/tenants/:id/renew` body `{ "years": 1 }`: cộng 1–100 năm vào `max(expire_at, NOW())` trên giờ DB; tenant hết hạn cộng từ hiện tại, tenant còn hạn cộng từ hạn cũ. Trả `200 { "message": "Gia hạn Spa thành công.", "data": { "id": 7, "expire_at": "..." } }`. Tenant không thời hạn (`expire_at=null`) trả `400`: dùng `PUT /api/tenants/:id` với `expireAt` để đặt hạn trước. Tenant vô hiệu hóa/không tồn tại trả `404`.

Chi tiết hướng dẫn AI frontend xây giao diện Superadmin tại `docs/SUPERADMIN_FRONTEND.md`. Các API này không tạo đơn hàng, lịch sử thanh toán hoặc thay đổi bảng `subscription_packages`.

---

## 7. Tài khoản nhân viên hệ thống `/api/users` (chỉ `MANAGER`)

Mọi API trong mục này yêu cầu token MANAGER. Các user được lưu ở `db_system_master.users`, nhưng `branch_id` được đối chiếu với bảng `branches` của tenant.

### `POST /api/users/create`

```json
{
  "username": "le.tan.q1",
  "password": "secret123",
  "fullname": "Lê Thị Tân",
  "systemRole": "STAFF",
  "branchId": 4
}
```

| Field | Bắt buộc | Ghi chú |
|---|---:|---|
| `username`, `password`, `fullname`, `systemRole` | Có | `systemRole` chỉ nhận `MANAGER` hoặc `STAFF`; `SUPER_ADMIN` bị cấm. |
| `branchId` | STAFF: Có | STAFF phải trỏ tới chi nhánh đang hoạt động. Với MANAGER backend tự lưu `null`. |

Thành công `201`: `{ "message": "Tạo tài khoản đăng nhập thành công", "userId": 20 }`.

### `GET /api/users?search=<keyword>`

- Tìm theo `username` hoặc `fullname`.
- Trả **cả user đã xóa mềm** (`deleted_at`) để dùng cho màn khôi phục.
- Mỗi item: `id`, `branch_id`, `username`, `fullname`, `system_role`, `created_at`, `deleted_at`, `branch_name` (`'Tổng công ty'` khi không có branch).

### `GET /api/users/:id`

Chỉ MANAGER; `200`: `{ "message": "Lấy chi tiết tài khoản thành công", "data": { ... } }`. `data` có cùng field như item danh sách, **không có password**, kể cả khi tài khoản đã bị khóa (`deleted_at` khác null). `branch_name` có thể vắng mặt nếu branch đã xóa. ID không thuộc tenant/không tồn tại trả `404`.

### `PUT /api/users/:id`

Body hỗ trợ:

```json
{
  "username": "le.tan.q1.new",
  "fullname": "Lê Thị Tân",
  "password": "new-secret",
  "systemRole": "STAFF",
  "branchId": 4
}
```

- Không được tự **đổi** `systemRole` của chính tài khoản đang đăng nhập; gửi lại cùng quyền hiện có (ví dụ `"MANAGER"`) vẫn được. `systemRole` có thể bỏ qua nếu không đổi.
- Với tài khoản MANAGER (kể cả khi chuyển từ STAFF sang MANAGER), mỗi lần PUT backend ghi `branch_id = null` dù frontend gửi `branchId` cũ; frontend có thể bỏ `branchId` hoặc gửi `null`, không cần chọn chi nhánh. GET danh sách/chi tiết sau khi lưu trả `branch_id: null`, `branch_name: "Tổng công ty"`. Nếu chuyển MANAGER sang STAFF thì phải gửi `branchId` của chi nhánh đang hoạt động.
- Với STAFF, `branchId` phải là chi nhánh hợp lệ khi tạo/chuyển quyền/đổi chi nhánh. Nếu chỉ sửa username, họ tên hoặc mật khẩu, có thể **bỏ** `branchId` để giữ chi nhánh đang lưu; gửi `null` hoặc giá trị sai sẽ bị từ chối. MANAGER tự sửa tên/mật khẩu có thể gửi body như `{ "fullname": "Tên mới", "password": "mật khẩu mới" }`.
- Thành công `200`: `{ "message": "Cập nhật tài khoản thành công!" }`.

### `DELETE /api/users/:id`

- Khóa mềm tài khoản. Không thể tự khóa chính mình.
- Thành công `200`: `{ "message": "Khóa tài khoản thành công!" }`.

### `PATCH /api/users/:id/restore`

- Khôi phục tài khoản đã khóa của cùng tenant.
- Thành công `200`: `{ "message": "Khôi phục tài khoản thành công!" }`.

---

## 8. Chức vụ `/api/roles` (chỉ `MANAGER`)

### `POST /api/roles`

```json
{ "name": "Kỹ thuật viên", "description": "Thực hiện dịch vụ" }
```

- `name` bắt buộc, unique trong các role chưa xóa của tenant.
- Thành công `201`: `{ "message": "Tạo chức vụ thành công", "roleId": 2 }`.

### `GET /api/roles?search=<keyword>`

- `search` tìm theo `name`; chỉ trả role chưa xóa, sắp xếp mới nhất trước.

### `GET /api/roles/:id`

Cần token (như GET danh sách); `200`: `{ "message": "Lấy chi tiết chức vụ thành công", "data": { ... } }`, `data` cùng cấu trúc bản ghi role trong danh sách. Không tồn tại/đã xóa trả `404`.

### `PUT /api/roles/:id`

```json
{ "name": "KTV cao cấp", "description": "Mô tả mới" }
```

- Partial update; `name` nếu gửi sẽ được kiểm tra trùng.
- Thành công `200`: `{ "message": "Cập nhật chức vụ thành công" }`.

### `DELETE /api/roles/:id` / `PATCH /api/roles/:id/restore`

- Xóa mềm/khôi phục role.
- Thành công tương ứng: `Xóa chức vụ thành công`, `Khôi phục chức vụ thành công`.

---

## 9. Chi nhánh `/api/branches` (chỉ `MANAGER`)

### `POST /api/branches`

```json
{
  "name": "Cơ sở Quận 1",
  "address": "1 Nguyễn Huệ, Quận 1",
  "bank_code": "VCB",
  "bank_account_no": "0123456789",
  "bank_account_name": "CONG TY ABC",
  "payment_provider": "MANUAL",
  "payment_api_key": null,
  "payment_client_id": null
}
```

| Field | Bắt buộc | Ghi chú |
|---|---:|---|
| `name` | Có | Unique trong các branch chưa xóa của tenant. |
| `address`, `bank_code`, `bank_account_no`, `bank_account_name`, `payment_api_key`, `payment_client_id` | Không | Null/rỗng được lưu là `null`. |
| `payment_provider` | Không | Nếu bỏ qua, backend dùng `MANUAL`. Schema nhận `PAYOS`, `CASSO`, `SEPAY`, `MANUAL`. |

Thành công `201`: `{ "message": "Thêm mới chi nhánh thành công", "branchId": 4 }`.

### `GET /api/branches?search=<keyword>`

- `search` tìm theo `name` hoặc `address`.
- Trả `SELECT *` từ `branches` (gồm cấu hình thanh toán); frontend cần bảo vệ dữ liệu nhạy cảm như `payment_api_key` khi hiển thị.

### `GET /api/branches/:id`

Chỉ MANAGER; `200`: `{ "message": "Lấy chi tiết chi nhánh thành công", "data": { ... } }`. `data` cùng cấu trúc item danh sách, bao gồm cả `payment_api_key` nếu có; không tồn tại/đã xóa trả `404`.

### `PUT /api/branches/:id`

- Partial update với các field tạo mới bên trên.
- Gửi `""` hoặc `null` cho các field tùy chọn sẽ xóa giá trị cũ thành `null`.
- Thành công `200`: `{ "message": "Cập nhật chi nhánh thành công" }`.

### `DELETE /api/branches/:id` / `PATCH /api/branches/:id/restore`

- Xóa mềm/khôi phục branch.
- Thành công tương ứng: `Xóa chi nhánh thành công`, `Khôi phục chi nhánh thành công`.

---

## 10. Hồ sơ nhân sự `/api/staffs` (cần token)

### `POST /api/staffs`

```json
{
  "fullname": "Trần Kỹ Thuật",
  "phone_number": "0900000000",
  "address": "Quận 1",
  "role_id": 2,
  "branch_id": 4
}
```

- Bắt buộc: `fullname`, `phone_number`, `role_id`.
- `branch_id` có thể null khi MANAGER tạo. Nếu người gọi là STAFF, backend bỏ qua `branch_id` gửi lên và buộc dùng `branch_id` trong token.
- Kiểm tra trùng theo cặp `fullname + phone_number` (hoặc chỉ fullname nếu không có số điện thoại).
- Thành công `201`: `{ "message": "Tạo hồ sơ nhân viên thành công", "staffId": 8 }`.

### `GET /api/staffs?search=&branchId=&roleId=`

| Query | Mô tả |
|---|---|
| `search` | Tìm theo họ tên hoặc số điện thoại. |
| `branchId` | MANAGER có thể lọc chi nhánh. STAFF luôn bị ép xem branch của chính mình, query này bị bỏ qua. |
| `roleId` | Lọc theo `role_id`. |

Mỗi item gồm toàn bộ `staffs` (`s.*`) và `role_name`, `branch_name` từ LEFT JOIN.

### `GET /api/staffs/:id`

Cần token; `200`: `{ "message": "Lấy chi tiết hồ sơ nhân viên thành công", "data": { ... } }`, `data` cùng cấu trúc item danh sách. STAFF chỉ xem được hồ sơ thuộc branch trong token; không tồn tại/đã xóa/khác branch trả `404`.

### `PUT /api/staffs/:id`

Body có thể gửi một phần: `fullname`, `phone_number`, `address`, `role_id`, `branch_id`.

- Nếu `fullname` được gửi, không được là chuỗi rỗng.
- `role_id` có giá trị thì phải tham chiếu một role chưa xóa.
- STAFF không thể chuyển branch: backend luôn ghi branch của token.
- STAFF chỉ có thể update hồ sơ thuộc chi nhánh token; trái branch nhận lỗi `400`.
- Thành công `200`: `{ "message": "Cập nhật hồ sơ thành công" }`.

### `DELETE /api/staffs/:id` / `PATCH /api/staffs/:id/restore`

- Xóa mềm/khôi phục staff. Với người gọi STAFF, thao tác chỉ hợp lệ trên cùng chi nhánh.
- Thành công tương ứng: `Xóa hồ sơ nhân viên thành công`, `Khôi phục hồ sơ thành công`.

---

## Rosa: quan hệ dịch vụ con trong products

POST/PUT `/api/products` hỗ trợ `child_service_ids: [12, 15]` chỉ cho dịch vụ (`is_product: false`). GET danh sách/chi tiết trả thêm mảng ID này, sản phẩm bán lẻ/dịch vụ không có con trả `[]`. PUT bỏ field giữ nguyên; `[]` gỡ hết; null/ID trùng/ID không hợp lệ/vòng lặp bị từ chối. Quan hệ lưu trong `product_service_components`, không phải cột JSON mới. Khi bán, gửi `items[].treatment.children` để tạo thẻ con thực tế cho khách trong transaction invoice; không tự chọn tất cả con từ danh mục. Chi tiết cấu hình: `docs/ROSA_PRODUCT_COMPONENTS_API.md`; tạo thẻ: `docs/ROSA_TREATMENT_GROUPS_API.md`.

## 11. Khách hàng `/api/customers`

### Hồ sơ Rosa — bổ sung ngày 27/10/2026

Chỉ dùng trên schema Rosa đã migrate (MySQL 3308, tenant 7 hiện tại). Các field dưới đây được hỗ trợ trong POST/PUT và trả về trong GET danh sách, chi tiết và `overview.data.customer`. Không thay đổi response envelope hoặc các trường ví/công nợ cũ. Không trả `password`.

| Field | Kiểu và quy tắc |
|---|---|
| `profile_code` | Chuỗi tối đa 50 ký tự; mã hồ sơ tùy chọn, không tự sinh. Trim khoảng trắng, duy nhất trong tenant kể cả khách đã xóa mềm. |
| `profile_date` | Ngày lập hồ sơ `YYYY-MM-DD` hoặc null; ngày có thật, năm >= 1000, không ở tương lai theo ngày máy backend. GET không có giờ/múi giờ. |
| `gender` | `MALE`, `FEMALE`, `OTHER` hoặc null. |
| `skin_types` | Mảng mã: `DRY` (khô), `OILY_ACNE` (dầu/mụn), `SENSITIVE_DAMAGED` (nhạy cảm/tổn thương), `AGING` (lão hóa), `COMBINATION` (hỗn hợp), `PIGMENTED` (tăng sắc tố), `OTHER` (khác); hoặc null. |
| `referral_sources` | Mảng mã `TIKTOK`, `FACEBOOK`, `FRIEND`, `OTHER`; hoặc null. |
| `referral_note` | Ghi chú nguồn giới thiệu. |
| `previous_skin_treatments` | Các điều trị da trước đây. |
| `peeling_products_history` | Lịch sử dùng sản phẩm peel. |
| `current_skincare_products` | Sản phẩm chăm sóc da đang dùng. |
| `skincare_routine` | Quy trình chăm sóc da. |
| `pigmentation_onset` | Thời điểm/diễn biến xuất hiện sắc tố (text). |
| `family_skin_history` | Tiền sử da gia đình. |
| `pregnancy_and_medical_history` | Thai kỳ và tiền sử bệnh lý. |
| `cosmetic_reaction_history` | Tiền sử phản ứng mỹ phẩm. |
| `skin_assessment` | Đánh giá da. |
| `consultation_note` | Nội dung tư vấn. |

Các field text nhận chuỗi hoặc null, trim khoảng trắng; chuỗi rỗng thành null. Mỗi field TEXT giới hạn 65535 byte UTF-8. Mảng phải gửi dạng JSON array, không gửi chuỗi `"[\"DRY\"]"`; mã phân biệt hoa/thường, mã lặp được loại bỏ. `[]` là danh sách rỗng, khác với null (chưa ghi nhận). Không tự đoán hoặc tự chuyển mã không hợp lệ.

POST bỏ các field tùy chọn thì lưu NULL. PUT bỏ field giữ nguyên, gửi null xóa field; `profile_date: ""` cũng xóa ngày. Dữ liệu sai hoặc trùng mã hồ sơ trả 400. Không ghi trực tiếp `wallet_balance`, `total_debt` qua API hồ sơ. Loại da/nguồn giới thiệu được lưu JSON trong MySQL và trả về dạng mảng, không phải chuỗi JSON.

Ví dụ POST `/api/customers` (PUT dùng cùng các field, nhưng chỉ gửi phần cần sửa):

```json
{
  "fullname": "Nguyễn Thị An",
  "phone_number": "0912345678",
  "date_of_birth": "1995-08-21",
  "profile_code": "ROSA-000123",
  "profile_date": "2026-10-27",
  "gender": "FEMALE",
  "skin_types": ["DRY", "SENSITIVE_DAMAGED"],
  "referral_sources": ["FRIEND"],
  "referral_note": "Bạn giới thiệu",
  "current_skincare_products": "Sữa rửa mặt, kem chống nắng",
  "skin_assessment": "Da khô, dễ kích ứng",
  "consultation_note": "Ưu tiên phục hồi hàng rào bảo vệ da"
}
```

Ảnh da tổ chức theo lần chụp: bảng cha `customer_skin_image_sessions` chứa khách/ngày chụp/ghi chú chung; bảng con `customer_skin_images` chứa từng đường dẫn ảnh và metadata, liên kết bằng `session_id`. Một lần chụp có nhiều ảnh. API upload nhiều file, đọc có Bearer token và xóa mềm đã có dưới `/api/customers/:customerId/skin-image-sessions`; xem `docs/ROSA_SKIN_IMAGES_API.md` để biết multipart fields, endpoint, response và ví dụ Postman/frontend.

### `POST /api/customers/reset-password` — Chỉ MANAGER

Cần JWT của MANAGER. Tenant được lấy từ token; backend bỏ hoàn toàn `tenantId` do client gửi để không thể đổi mật khẩu khách của Spa khác. Đây là thao tác quản trị, **không phải** luồng “quên mật khẩu” public của MiniApp.

```json
{
  "phone_number": "0900000000",
  "new_password": "new-secret"
}
```

- Cả hai field đều bắt buộc; mật khẩu mới dài 6–255 ký tự.
- Backend tìm customer chưa xóa theo tenant trong JWT + `phone_number`, băm `new_password` bằng bcrypt và ghi người thực hiện.
- Thành công `200`: `{ "message": "Đổi mật khẩu thành công" }`.
- Không token trả `401`, token không phải MANAGER trả `403`. Endpoint có giới hạn số lần gọi theo IP.
- MiniApp chưa có luồng quên mật khẩu public; muốn mở lại phải bổ sung OTP/xác minh quyền sở hữu số điện thoại ở backend.

### `POST /api/customers` — Cần token

**Ngày sinh (bản nâng cấp 25/10/2026):** field tùy chọn `date_of_birth`, ví dụ `"1995-08-21"`.
Chỉ nhận ngày lịch tồn tại theo `YYYY-MM-DD`, năm 1000–9999, không được sau ngày hiện tại của máy backend; sai định dạng/ngày không tồn tại trả `400`.
POST bỏ field, gửi `null` hoặc `""` thì lưu NULL. PUT bỏ field giữ nguyên, gửi `null` hoặc `""` xóa ngày sinh.
GET danh sách, chi tiết và `GET /api/customers/:id/overview` (trong `data.customer`) trả `date_of_birth` dạng chuỗi `YYYY-MM-DD` hoặc null, không có giờ/múi giờ.
Frontend hiển thị DD/MM/YYYY nhưng gửi chuỗi YYYY-MM-DD; không dùng `toISOString()` để chuyển ngày sinh.
Triển khai phải migrate tenant và template trước khi bật code mới; xem `docs/migrations/README_customer_upgrade.md`.

```json
{
  "fullname": "Phạm Khách Hàng",
  "phone_number": "0912345678",
  "password": "optional-password",
  "avatar": "https://example.com/avatar.jpg",
  "address": "TP.HCM",
  "note": "Khách VIP"
}
```

- Bắt buộc: `fullname`, `phone_number`.
- `password` không bắt buộc; nếu có thì được bcrypt hash. Nếu không, MANAGER có thể thiết lập sau bằng endpoint reset-password ở trên. Khách không thể tự đặt lại mật khẩu public khi chưa có OTP/xác minh.
- `phone_number` là duy nhất **theo SĐT trong từng tenant**, không ghép với `fullname`: cùng tên nhưng khác SĐT được phép; khác tên nhưng trùng SĐT bị từ chối (`400`). Khách đã xóa mềm vẫn giữ SĐT để có thể khôi phục, vì vậy **không thể dùng lại SĐT đó để tạo khách mới**. Frontend nên tìm khách theo SĐT trước khi tạo, không thêm bản ghi thứ hai.
- Thành công `201`: `{ "message": "Thêm mới khách hàng thành công", "customerId": 10 }`.

### `GET /api/customers?search=<keyword>` — Cần token

- `search` tìm `fullname`, `phone_number` hoặc `profile_code` (Rosa).
- Mỗi item trả: `id`, `fullname`, `phone_number`, `avatar`, `address`, `wallet_balance`, `total_debt`, `note`, `created_at`, `updated_at`.
- Không bao giờ trả `password`.

### `GET /api/customers/:id` — Cần token

- Lấy thông tin một khách hàng active trong tenant đang đăng nhập.
- Trả: `id`, `fullname`, `phone_number`, `avatar`, `address`, `wallet_balance`, `total_debt`, `note`, `created_at`, `updated_at`, `created_by`, `updated_by`.
- Không bao giờ trả `password`.
- Không tồn tại hoặc đã soft-delete trả `404`.

### `GET /api/customers/:id/overview` — Tổng quan chuyên sâu (cần token)

Response `{ message, data: { customer, purchases, treatments, timeline } }`. `customer` gồm các field customer trừ `password` (không bao giờ trả mật khẩu). `purchases[]` gồm tất cả dòng sản phẩm **và dịch vụ** của hóa đơn chưa xóa: `invoice_item_id`, `invoice_id`, `product_id`, `product_name` (snapshot), `unit_price` (snapshot lúc mua), `quantity`, `discount_percent`, `discount_amount`, `final_price`, `is_product`, `purchase_date`, `branch_id`, **`treatment`** (thẻ tương ứng hoặc `null`). Sắp xếp ngày mua mới nhất trước, rồi ID hóa đơn và dòng giảm dần.

`treatments[]` gồm mọi thẻ còn tồn tại của khách, **kể cả `remaining_sessions=0`**, mới nhất trước theo ngày mua (thẻ thủ công theo `created_at`), rồi `id` giảm dần. Mỗi thẻ có toàn bộ field của `treatments` (đặc biệt `id` dùng gửi vào `POST /api/treatments/execute` với key `treatment_id`), `product_name`, `purchase_date` (`null` với thẻ thủ công), `unit_price` (`null` nếu không có dòng hóa đơn tương ứng), `branch_id`, `completed_sessions = total_sessions - remaining_sessions`, `histories[]`. `histories[]` là các dòng `treatment_history` chưa xóa, mới nhất trước; từng history có `staffs[]` là các dòng `treatment_history_staffs` chưa xóa, kèm `staff_name` và `staff_id`. Frontend có thể dùng `history.id` khi gán nhân viên qua `PUT /api/treatments/execute/:historyId/staffs`.

Để render **một dòng cho mỗi dịch vụ đã mua**, dùng `timeline[]`: `{ type: "purchase", date, item }` với `item.treatment` là thẻ kèm lịch sử/nhân viên, hoặc `null` nếu không có thẻ. Ghép bằng `treatments.invoice_item_id`; thẻ cũ chưa đối soát dòng bán hoặc thẻ thủ công sẽ hiện riêng `{ type: "treatment", date, treatment }`, không đoán ghép theo tên dịch vụ. `purchases[]` và `treatments[]` vẫn giữ để xem riêng; thẻ/hóa đơn/dòng mua đã xóa mềm không được trả.

Ví dụ một dòng trong `timeline`: `{ "type": "purchase", "date": "2026-10-11T07:46:39.000Z", "item": { "invoice_item_id": 83, "invoice_id": 64, "product_id": 23, "product_name": "tẩy nốt ruồi", "quantity": 5, "unit_price": "50000.00", "final_price": "250000.00", "treatment": { "id": 54, "total_sessions": 1, "remaining_sessions": 0, "completed_sessions": 1, "note": "5 nốt", "histories": [] } } }` (các field khác giữ nguyên; `histories` thực tế chứa các buổi đã thực hiện).

### `PUT /api/customers/:id` — Cần token

Body hỗ trợ: `fullname`, `phone_number`, `password`, `avatar`, `address`, `note`, `date_of_birth` và các trường hồ sơ Rosa ở đầu mục 11.

- `fullname`/`phone_number` nếu gửi không được là chuỗi rỗng.
- `phone_number` mới được kiểm tra trùng trên **toàn bộ khách trong tenant, kể cả khách đã xóa mềm**; trùng trả `400`. Không kiểm tra theo cặp tên + SĐT.
- `password` chỉ cập nhật khi là chuỗi không rỗng; backend băm bcrypt.
- Các field `avatar`, `address`, `note` gửi `""`/`null` sẽ thành `null`.
- Thành công `200`: `{ "message": "Cập nhật thông tin khách hàng thành công" }`.

### `DELETE /api/customers/:id` / `PATCH /api/customers/:id/restore` — Cần token

- Xóa mềm/khôi phục customer.
- Xóa mềm không giải phóng SĐT; khôi phục giữ lại số cũ. Tenant đã có dữ liệu cần chạy `docs/migrations/2026-10-16_unique_customer_phone.sql` sau khi xử lý hết SĐT trùng (kể cả bản ghi đã xóa mềm).
- Thành công tương ứng: `Xóa khách hàng thành công`, `Khôi phục khách hàng thành công`.

---

## 12. Sản phẩm/Dịch vụ `/api/products` (MANAGER và STAFF quản lý)

> Bản triển khai giá bán riêng (chỉ tenant đã migration): `price` là **giá niêm yết**, `sale_price` là **giá bán**. POST product bắt buộc gửi cả hai, với `0 <= sale_price < price` (vì vậy `price > 0`). PUT có thể sửa một hoặc cả hai giá; backend kiểm tra cặp giá sau cập nhật, không tự đồng bộ giá còn lại. Nếu dữ liệu cũ đang có `sale_price >= price`, vẫn được sửa các trường không liên quan đến giá mà không tự thay đổi giá; mọi PUT sửa giá phải đưa cặp giá về hợp lệ. GET danh sách/chi tiết trả về cả `price` và `sale_price`. Frontend tính phần trăm hiển thị; khi POST/PUT invoice phải gửi `items[].unit_price` bằng giá bán mong muốn. Nếu bỏ `unit_price` và alias `items[].price`, invoice vẫn dùng `products.price` (giá niêm yết), **không tự lấy `sale_price` và không tự tính chiết khấu**. Xem `docs/migrations/README_product_sale_price.md` trước khi deploy.

Mọi endpoint trong mục này yêu cầu Bearer token. MANAGER và STAFF đều có quyền tạo/sửa/xóa mềm/khôi phục sản phẩm. Chỉ MANAGER được gửi `commissions` **hoặc** `commission_tiers` khi tạo hoặc sửa (`STAFF` gửi một trong hai field, kể cả `[]` hay `null`, sẽ nhận `403`, không ghi dữ liệu). Product được tạo trong **một transaction** cùng cấu hình hoa hồng/tồn kho ban đầu (nếu có); nếu một bước lỗi thì toàn bộ thao tác bị rollback.

### `POST /api/products` (MANAGER/STAFF; cấu hình công ca chỉ MANAGER)

Ví dụ MANAGER tạo dịch vụ có **hai bậc công** cho chức vụ `role_id=2` (thay ID bằng chức vụ thực tế của tenant). `commissions` bên dưới chỉ là mức dự phòng khi giá bán không thuộc bậc nào:

```json
{
  "name": "Liệu trình phục hồi da",
  "images": ["https://example.com/treatment-1.jpg"],
  "description": "Mô tả dịch vụ",
  "benefits": "Phục hồi, dưỡng ẩm",
  "price": 900000,
  "sale_price": 800000,
  "unit": "nốt",
  "is_product": false,
  "is_treatment_combo": false,
  "default_sessions": 1,
  "session_unit": "buổi",
  "next_appointment_days": 0,
  "commissions": [
    { "role_id": 2, "commission_percent": 5, "commission_fixed_amount": 0 }
  ],
  "commission_tiers": [
    { "role_id": 2, "min_price": 0, "max_price": 1000000, "calculation_type": "PERCENT", "percent": 10 },
    { "role_id": 2, "min_price": 1000000, "max_price": null, "calculation_type": "FIXED", "fixed_amount": 100000 }
  ]
}
```

Ví dụ giá bán một đơn vị là 900.000đ thì khớp bậc `[0, 1.000.000)` và nhận công 10% = 90.000đ/đơn vị; giá đúng 1.000.000đ khớp bậc thứ hai và nhận 100.000đ/đơn vị. `price` khi tạo sản phẩm là giá niêm yết; lúc tính công cho buổi thực hiện, backend dùng **đơn giá bán lưu trên dòng hóa đơn** (`snapshot_price`), không dùng giá niêm yết hiện tại. Với dịch vụ không combo, công mỗi buổi còn nhân với số lượng của dòng bán. Có thể bỏ `commissions` nếu không cần mức dự phòng; `inventory` không cần gửi khi tạo dịch vụ.

| Field | Bắt buộc | Quy tắc |
|---|---:|---|
| `name`, `price`, `sale_price`, `is_product` | Có | Tên unique trong product chưa xóa; `0 <= sale_price < price`; `is_product` nhận boolean hoặc `0/1`. Không gửi hoặc gửi `null`/chuỗi rỗng cho giá sẽ bị từ chối. |
| `images` | Không | Mảng JSON hoặc `null`. |
| `description`, `benefits`, `unit` | Không | Chuỗi; rỗng được lưu `null`. |
| `is_treatment_combo`, `default_sessions`, `session_unit`, `next_appointment_days` | Không | Default theo schema; hai field số buổi/ngày là số nguyên `>= 0`. |
| `commissions` | Không | Mức **dự phòng** theo role khi không có bậc khớp. `{ role_id, commission_percent?, commission_fixed_amount? }`, role không lặp; có thể bỏ qua. Phần trăm tính trên giá bán một đơn vị trước chiết khấu. Chỉ MANAGER được ghi. |
| `commission_tiers` | Không | Mảng `{ role_id, min_price, max_price: number|null, calculation_type: "FIXED"|"PERCENT", fixed_amount?, percent? }`. `min_price` bắt buộc, `max_price: null` hoặc không gửi nghĩa là không có giới hạn trên; khoảng `[min_price,max_price)` (bao gồm min, không bao gồm max). `fixed_amount` bắt buộc với `FIXED`; `percent` bắt buộc với `PERCENT`. Mỗi bậc tính trên **đơn giá**, không phải tổng dòng; cố định cũng là tiền **mỗi đơn vị**. Các bậc cùng role không được chồng lấn, phần trăm 0–100. Chỉ MANAGER được ghi. |
| `inventory` | Không | Dùng cho tồn đầu kỳ. Có thể bỏ qua, gửi `null` hoặc `[]` — phù hợp với dịch vụ hoặc hàng hóa sẽ nhập kho sau. Nếu gửi dòng `{ branch_id, quantity }`, `branch_id` không lặp, branch phải active, quantity là số nguyên `>= 0`. |

Thành công `201`: `{ "message": "Tạo sản phẩm/dịch vụ thành công", "productId": 12 }`.

### 1. Lấy danh sách Sản phẩm / Dịch vụ
**`GET /api/products?search=&is_product=`**

- **Quyền truy cập:** MANAGER và STAFF có token hợp lệ; không yêu cầu quyền quản lý sản phẩm.
- `search`: Tìm kiếm theo tên sản phẩm (chuỗi con, không phân biệt hoa/thường).
- `is_product`: Gửi `0` (Dịch vụ) hoặc `1` (Sản phẩm vật lý) để lọc.
- **Lưu ý:** Đã loại bỏ hoàn toàn tham số `is_active` khỏi request và response (trạng thái dựa vào xóa mềm `deleted_at`).
- **Response:** Trả về danh sách products, mỗi product kèm theo 3 mảng:
  - `commissions`: Mức công mặc định theo role (kèm `role_name`).
  - `commission_tiers`: Các bậc công theo đơn giá bán (kèm `role_name`).
  - `inventory`: Số lượng tồn kho (kèm `branch_name`).
- **Phân quyền hiển thị:**
  - **Manager (Quản lý):** Xem được tồn kho (`inventory`) ở TẤT CẢ chi nhánh.
  - **Staff (Nhân viên):** Nếu token có `branch_id`, mảng tồn kho (`inventory`) chỉ gồm chi nhánh đó; danh sách sản phẩm và các mảng `commissions`, `commission_tiers` không lọc theo chi nhánh. Không dùng tồn kho trả về để suy ra quyền chỉnh sửa sản phẩm.

---

### 2. Lấy chi tiết một Sản phẩm / Dịch vụ
**`GET /api/products/:id`**

- **URL Params:** `id` - ID của sản phẩm cần lấy chi tiết.
- **Quyền truy cập:** Dành cho cả MANAGER và STAFF có token hợp lệ; không có quyền chỉnh sửa sản phẩm.
- **Response:** Trả về Object thông tin chi tiết của 1 sản phẩm (không chứa `is_active`), kèm các mảng `commissions`, `commission_tiers` và `inventory`. (Logic phân quyền hiển thị tồn kho chi nhánh áp dụng tương tự như API Lấy danh sách).

### `PUT /api/products/:id` (MANAGER/STAFF; cấu hình công ca chỉ MANAGER)

- Partial update: `name`, `images`, `description`, `benefits`, `price`, `sale_price`, `unit`, `is_product`, `is_treatment_combo`, `default_sessions`, `session_unit`, `next_appointment_days`. Sửa một trong hai giá phải bảo đảm `0 <= sale_price < price` sau cập nhật; không tự thay đổi giá còn lại. Sản phẩm cũ có giá không hợp lệ vẫn được sửa các trường khác nhưng không được sửa giá thành cặp không hợp lệ.
- `is_active` là cột legacy trong schema và bị API Product bỏ qua khi create/update; trạng thái sử dụng product được quản lý bằng xóa mềm (`deleted_at`).
- Nếu gửi `commissions`, backend đồng bộ toàn bộ danh sách: role không còn trong body bị xóa mềm, role trong body được tạo/cập nhật. Có thể gửi `[]` để xóa hết commission.
- Nếu gửi `commission_tiers`, backend thay toàn bộ bậc của sản phẩm trong transaction; `[]` xóa tất cả bậc. Nếu không gửi, giữ nguyên. Chỉ MANAGER được gửi field này.

Ví dụ `commission_tiers` cho một dịch vụ và role KTV (`role_id=2`):

```json
[
  { "role_id": 2, "min_price": 0, "max_price": 1000000, "calculation_type": "PERCENT", "percent": 10 },
  { "role_id": 2, "min_price": 1000000, "max_price": null, "calculation_type": "FIXED", "fixed_amount": 100000 }
]
```

Bậc được chọn bằng `snapshot_price` của **một đơn vị**. Dịch vụ không combo: công cho một buổi = công một đơn vị × `invoice_items.quantity` (900.000đ/nốt × 2 nốt × 10% = 180.000đ). Combo: mỗi buổi tính công trên đơn giá **một combo**, không nhân số lượng combo mỗi buổi. Giá dùng để tính công không chịu chiết khấu dòng/tổng hóa đơn. Nếu không có bậc khớp, dùng `product_commissions` theo role; không có cả hai thì công = 0. Thay cấu hình bậc không tự tính lại buổi cũ; sửa hóa đơn có tính lại các buổi đã làm theo cấu hình đang có khi sửa.
- API này không nhận `inventory`, để không điều chỉnh tồn kho không có chứng từ. Dùng `POST /api/inventory-imports` để tăng tồn.
- Thành công `200`: `{ "message": "Cập nhật sản phẩm/dịch vụ thành công" }`.

### `DELETE /api/products/:id` / `PATCH /api/products/:id/restore` (MANAGER/STAFF)

- Xóa mềm/khôi phục product.
- Thành công: `Xóa sản phẩm/dịch vụ thành công` hoặc `Khôi phục sản phẩm/dịch vụ thành công`.

---

## 13. Nhập kho `/api/inventory-imports`

Tạo phiếu nhập dùng transaction: tạo header, các item snapshot và cập nhật `inventory.quantity` cùng lúc.

*Lưu ý Phân quyền: STAFF chỉ xem/tạo phiếu ở cơ sở mình, và chỉ được SỬA/XÓA phiếu nhập trong ngày. MANAGER được toàn quyền mọi cơ sở.*

### `POST /api/inventory-imports`

```json
{
  "branch_id": 1,
  "import_code": "PN20261003001",
  "import_date": "2026-10-03 14:30:00",
  "supplier_name": "Nhà cung cấp ABC",
  "note": "Giao đủ hàng",
  "items": [
    {
      "product_id": 12,
      "quantity": 30,
      "unit_price": 200000,
      "discount_percent": 5,
      "discount_amount": 0
    }
  ]
}
```

| Field | Bắt buộc | Quy tắc |
|---|:---:|---|
| `import_code`, `items` | Có | `import_code` unique; `items` không rỗng. |
| `branch_id` | Không | MANAGER bắt buộc truyền. STAFF có thể bỏ trống (tự lấy từ Token). |
| `import_date` | Không | Bỏ qua thì dùng thời điểm hiện tại. |
| `supplier_name`, `note` | Không | Chuỗi hoặc null. |
| `items[].product_id`, `quantity`, `unit_price` | Có | Product active; quantity > 0; unit price >= 0; không lặp product. |
| `items[].discount_percent`, `discount_amount` | Không | Default 0; percent 0–100, amount >= 0. |

> Frontend không gửi `total_amount`, `product_name`, `total_price`. Backend tự tính tiền và lưu snapshot. Nếu thành tiền âm, API từ chối.

Thành công `201`:
```json
{
  "message": "Tạo phiếu nhập kho thành công",
  "inventoryImportId": 5,
  "totalAmount": 5700000
}
```

### `GET /api/inventory-imports`
Lọc nâng cao theo: `search` (Mã/NCC), `branchId`, `startDate`, `endDate` (YYYY-MM-DD). Trả về danh sách phiếu nhập.

### `GET /api/inventory-imports/:id`

Cần token; MANAGER xem mọi cơ sở, STAFF chỉ xem phiếu tại cơ sở trong token (thiếu branch hợp lệ trả `400`). Thành công `200`: `{ "message": "Lấy chi tiết phiếu nhập kho thành công", "data": { ... } }`. `data` có header (`id`, `branch_id`, `branch_name`, `import_code`, `import_date`, `supplier_name`, `total_amount`, `note`, audit) và `items[]`: `{ id, inventory_import_id, product_id, product_name, quantity, unit_price, discount_percent, discount_amount, total_price }` (snapshot, sắp theo ID tăng). ID không hợp lệ trả `400`; không tồn tại/đã xóa/khác branch trả `404`. Không phân trang.

### `PUT /api/inventory-imports/:id`
Ghi đè phiếu nhập (Cấu trúc giống POST). Sử dụng Transaction để hoàn trả tồn kho cũ, và tính toán lại tồn kho mới an toàn.

### `DELETE /api/inventory-imports/:id`
Xóa mềm phiếu nhập kho và trừ lại số lượng tồn kho tự động.

---

## 14. Quản lý Phiếu chi `/api/expenses`

Quản lý các khoản chi tiêu, thanh toán của Spa (tiền điện, nước, v.v.).
*Lưu ý Phân quyền: STAFF chỉ xem/thêm/sửa/xóa phiếu chi tại cơ sở của mình. MANAGER được toàn quyền.*

### `POST /api/expenses`

```json
{
  "branch_id": 1,
  "items": [{ "expense_type": "Tiền điện", "amount": 300000 }, { "expense_type": "Tiền nước", "amount": 200000 }],
  "note": "Tiền điện tháng 9",
  "expense_date": "2026-10-04 10:00:00"
}
```

| Field | Bắt buộc | Quy tắc |
|---|:---:|---|
| `items` | Có | Mảng ít nhất một `{ expense_type, amount }`, loại chi không rỗng và tiền >= 0, tối đa 2 số lẻ. |
| `branch_id` | Không | MANAGER bắt buộc truyền. STAFF tự lấy từ token. |
| `expense_date` | Không | (YYYY-MM-DD HH:mm:ss). |
| `note` | Không | Ghi chú thêm. |

Thành công `201`:
```json
{
  "message": "Tạo phiếu chi thành công",
  "expenseId": 1,
  "amount": 500000
}
```

### Các API khác của Phiếu chi:
- **`GET /api/expenses`**: Hỗ trợ `search`, `branchId`, `startDate`, `endDate`.
- **`GET /api/expenses/:id`**: Lấy chi tiết phiếu. Danh sách và chi tiết đều trả `items[]`: `{ id, expenses_voucher_id, expense_type, amount }`. `amount` trên header là tổng các mục; `expense_type` trên header giữ để tương thích (một mục: tên mục; nhiều mục: `Nhiều mục chi`). Tìm kiếm `search` theo loại chi trong các mục hoặc ghi chú.
- **`PUT /api/expenses/:id`**: Cập nhật `note`, `expense_date`, hoặc gửi `items[]` để **thay toàn bộ mục chi** và tính lại tổng; không gửi `amount`/`expense_type` ở header. Thay mục chi sẽ cấp ID mới cho các item.
- **`DELETE /api/expenses/:id`**: Xóa mềm phiếu chi.

Chạy migration `docs/migrations/2026-10-12_add_expenses_vouchers_items.sql` cho template và từng tenant trước khi dùng API mới. Migration backfill phiếu cũ thành một mục, báo cáo cộng tổng `expense_vouchers.amount` **một lần cho mỗi phiếu**, không cộng thêm item.

---

## 15. Quản lý Hóa đơn Bán hàng `/api/invoices`

Xử lý giao dịch thanh toán, trừ đúng **số tiền ví người dùng chọn**, tính công nợ, chia hoa hồng nhân viên và sinh thẻ liệu trình qua Transaction.
*Lưu ý Phân quyền: STAFF chỉ tạo/xem được hóa đơn ở cơ sở mình, và chỉ được SỬA/XÓA hóa đơn được tạo trong ngày hôm nay.*

### `POST /api/invoices`

```json
{
  "customer_id": 1,
  "branch_id": 1,
  "discount_percent": 10,
  "discount_amount": 0,
  "paid_amount": 850000,
  "wallet_used": 500000,
  "payment_method": "Ví + Chuyển khoản",
  "note": "Khách dùng 500k trong ví và chuyển khoản 850k",
  "invoice_date": "2026-10-04",
  "items": [
    {
      "product_id": 2,
      "quantity": 1,
      "unit_price": 1500000,
      "discount_percent": 0,
      "discount_amount": 0,
      "consultants": [
        { "staff_id": 2, "revenue_amount": 500000, "role_type": "Tư vấn chính" }
      ]
    }
  ]
}
```

| Field | Bắt buộc | Quy tắc |
|---|:---:|---|
| `customer_id`, `items` | Có | Khách hàng phải tồn tại; `items` không rỗng. |
| `branch_id` | Có với MANAGER | Cơ sở lập hóa đơn. STAFF bị backend buộc dùng `branch_id` trong token, nên không cần/không thể chọn cơ sở khác. |
| `paid_amount`, `wallet_used` | Không | Mặc định 0. `wallet_used` là **số tiền lấy từ ví do người dùng nhập** (có thể chỉ một phần, không tự lấy tối đa số dư); `paid_amount` là tiền thu bằng phương thức khác. Backend chặn nếu `wallet_used` vượt số dư ví hoặc tổng hóa đơn, hay `paid_amount + wallet_used` vượt tổng hóa đơn. Lưu `wallet_used` riêng trên invoice và trả lại ở API list/detail. |
| `discount_percent`, `discount_amount` | Không | Chiết khấu tổng hóa đơn. |
| `items[].product_id`, `items[].quantity` | Có | Product chưa xóa; quantity là số nguyên `> 0`. |
- `items[].unit_price` | Không | Giá bán **một đơn vị trước chiết khấu**, phải `>= 0`. Nếu không gửi, backend dùng `products.price`. `items[].price` là alias. Lưu vào `invoice_items.snapshot_price`, không nhân sẵn số lượng. |
| `items[].discount_percent`, `items[].discount_amount` | Không | Mặc định `0`; backend chặn thành tiền dòng âm. |
| `items[].consultants` | Không | Mảng nhân viên tư vấn/chăm sóc. Mỗi dòng có `staff_id`, `revenue_amount?`, `role_type?`; `revenue_amount` mặc định `0`, phải `>= 0`, và tổng `revenue_amount` của tất cả consultant trong **một item** không được vượt `final_price` của item sau chiết khấu. STAFF chỉ được chọn nhân viên thuộc branch trong token, MANAGER có thể chọn nhân viên branch khác. |

> **Backend tự động:** Tính công nợ, giảm trừ ví, sinh thẻ liệu trình cho dịch vụ (`is_product = 0`) và combo (`is_treatment_combo = 1`). Combo có `total_sessions = remaining_sessions = quantity × default_sessions` (nếu kết quả > 0), `note = null`; dịch vụ không phải combo luôn sinh một thẻ **1 buổi** dù `quantity > 1` hoặc `default_sessions = 0`. Thẻ dịch vụ thường ghi `note = "<quantity> <unit>"` lấy từ `products.unit`: ví dụ mua 5 lần dịch vụ tẩy nốt ruồi, `unit = "nốt"` ⇒ 1 buổi, `note = "5 nốt"`. Nếu `unit` trống/null, ghi riêng số lượng (ví dụ `"5"`). Hàng hóa không phải combo không sinh thẻ.

Backend tự tính `totalAmount`, không tin tổng tiền do frontend tự tính. Frontend cho nhập `wallet_used` từ `0` đến `min(wallet_balance, totalAmount)`; **không tự điền số tối đa khi chọn thanh toán bằng ví**. Gửi đúng số người dùng chọn, ví dụ ví còn `1.000.000`, hóa đơn `800.000`, khách chỉ muốn dùng `200.000` trong ví và trả `600.000` bằng tiền khác: gửi `wallet_used: 200000`, `paid_amount: 600000`; sau thanh toán ví còn `800.000`, công nợ `0`. Nếu không dùng ví, gửi `wallet_used: 0` hoặc bỏ field. Backend kiểm tra `0 <= wallet_used <= wallet_balance`, `wallet_used <= totalAmount`, `paid_amount >= 0`, và `paid_amount + wallet_used <= totalAmount`; phần thiếu trở thành công nợ `debtAmount = totalAmount - paid_amount - wallet_used`. Backend **không tự lấy phần còn thiếu từ ví** và không tự tăng `paid_amount`.

Khi gửi `items[].consultants`, backend kiểm tra từng `staff_id` còn hoạt động, `revenue_amount` hợp lệ và tổng tiền chia sale trên từng mặt hàng. Ví dụ item thành tiền `10.000.000` chỉ cho phép chia A `6.000.000` + B `4.000.000` (hoặc thấp hơn), không được vượt `10.000.000`. STAFF còn bị kiểm tra consultant thuộc đúng branch trong token; nếu không hợp lệ request bị từ chối với HTTP `400`.

Hàng hóa (`is_product = 1`) vẫn được phép bán vượt tồn. Nếu branch chưa có bản ghi `inventory` cho product, backend tự tạo dòng inventory với tồn âm (ví dụ bán `2` sẽ tạo `quantity = -2`) để phục vụ đối soát; nếu đã có dòng, tồn kho được trừ bình thường và vẫn có thể âm.

Thành công `201`:
```json
{
  "message": "Tạo hóa đơn thành công",
  "invoiceId": 12,
  "totalAmount": 1350000,
  "debtAmount": 0,
  "walletUsed": 500000,
  "itemMappings": [
    { "request_index": 0, "invoice_item_id": 31, "treatment_id": 41 }
  ]
}
```

`itemMappings` có đúng một phần tử cho **mỗi** phần tử `items` gửi lên, kể cả hàng hóa/dịch vụ không sinh thẻ (`treatment_id: null`). `request_index` là chỉ số **0-based** của dòng trong mảng `items` của chính request POST (không phải thứ tự GET, không phải `product_id`); `invoice_item_id` là ID dòng bán vừa tạo, `treatment_id` là ID thẻ vừa tạo. Ví dụ hai dòng trùng dịch vụ vẫn có hai `request_index`, hai `invoice_item_id` và hai `treatment_id` riêng biệt. Frontend dùng `itemMappings` ngay từ response 201 để ghi nhận “làm ngay” cho đúng thẻ; không suy đoán theo `product_id`, giá hay thứ tự dữ liệu GET. Response này chỉ trả về sau khi transaction commit thành công; nếu bước ghi nhận buổi sau đó lỗi, không POST lại hóa đơn.

### `GET /api/invoices`

Query tùy chọn: `search`, `branchId`, `startDate`, `endDate`, `productName`, `minAmount`, `maxAmount`, `hasDebt`.

- `search`: tìm trong ghi chú, tên hoặc số điện thoại khách hàng.
- `branchId`: MANAGER lọc theo cơ sở; STAFF luôn chỉ xem cơ sở trong token.
- `startDate`, `endDate`: lọc theo `invoice_date` (dạng `YYYY-MM-DD`).
- `productName`: tìm theo `invoice_items.snapshot_name`.
- `minAmount`, `maxAmount`: lọc `total_amount`, phải `>= 0`.
- `hasDebt`: `true`/`1` chỉ lấy hóa đơn còn công nợ (`debt_amount > 0`); `false`/`0` chỉ lấy hóa đơn không còn công nợ (`debt_amount = 0`). Ví dụ: `GET /api/invoices?hasDebt=true`.
- Thành công `200`: `{ "message": "Lấy danh sách thành công", "total": 1, "page": 1, "pageSize": 20, "totalPages": 1, "data": [ ... ] }`. Mỗi invoice trả `wallet_used` riêng; `payment_method` không chứa số tiền ví.

### `GET /api/invoices/:id`

Lấy header hóa đơn, gồm `paid_amount`, `wallet_used`, `debt_amount`, `branch_name`, `customer_name`, `phone_number`, danh sách `items`, và mỗi item có `consultants`. STAFF không thể lấy hóa đơn cơ sở khác. Thành công `200`: `{ "message": "Lấy chi tiết hóa đơn thành công", "data": { ... } }`; không có quyền/không tồn tại trả `404`.

### `PUT /api/invoices/:id`

Ghi đè **toàn bộ** `items`; body phải gửi `items` theo cấu trúc của POST, trong đó từng item cũng ưu tiên `unit_price` (hoặc `price`) và chỉ fallback `products.price` khi không gửi giá. Với dòng cũ, gửi `items[].invoice_item_id` lấy từ GET chi tiết để gắn đúng thẻ nếu nhiều dòng cùng dịch vụ. Các field header có thể gửi: `customer_id`, `discount_percent`, `discount_amount`, `paid_amount`, `wallet_used`, `payment_method`, `note`, `invoice_date`. `wallet_used` nếu gửi là **số tiền ví mới người dùng chọn**, kể cả `0` hoặc một phần số dư; nếu bỏ qua thì giữ số tiền ví đã dùng của hóa đơn cũ (không tự lấy tối đa). `paid_amount` là số tiền thu ngoài ví; frontend nên gửi cả hai khi đổi phương thức thanh toán.

Trong một transaction, backend hoàn trả ví/công nợ/tồn kho cũ, xóa mềm item cũ rồi áp dụng hóa đơn mới. Thẻ liệu trình của mặt hàng còn trong hóa đơn được giữ nguyên ID, lịch sử và `created_at`; số buổi còn lại được tính bằng **tổng số buổi mới trừ số buổi đã sử dụng** (ví dụ 5 buổi đã dùng 2, sửa còn 3 buổi thì thẻ còn 1). Chỉ chặn khi tổng buổi mới nhỏ hơn số buổi đã dùng, hoặc bỏ/chuyển khách hàng của thẻ đã dùng. Thẻ mới tạo theo quy tắc POST nhưng có `created_at` bằng ngày tạo hóa đơn gốc, kể cả khi sửa hóa đơn vào ngày khác. Hàng hóa mới vẫn có thể làm tồn âm. Áp dụng cùng điều kiện thanh toán của POST. Hóa đơn có phiếu thu nợ active vẫn bị chặn sửa; STAFF chỉ sửa hóa đơn cơ sở mình được tạo trong ngày hiện tại.

Khi sửa giá/số lượng dòng bán, backend cập nhật lại `commission_amount_snapshot` của **mọi buổi đã làm** trên thẻ trong cùng transaction; báo cáo sau đó hiển thị công mới. Với thẻ cũ có nhiều dòng cùng dịch vụ mà chưa liên kết dòng bán, cần đối soát `invoice_item_id` trước khi sửa.

### `DELETE /api/invoices/:id`

Xóa mềm hóa đơn trong transaction, hoàn ví, giảm công nợ, hoàn lại tồn kho **một lần theo từng invoice item hàng hóa** và xóa mềm item/thẻ liệu trình liên quan. Bị chặn nếu bất kỳ thẻ liệu trình nào của hóa đơn đã được sử dụng hoặc đã có phiếu thu nợ active; khi có phiếu thu nợ, API trả lỗi `Không thể xóa hóa đơn đã có phiếu thu nợ.` STAFF chỉ xóa hóa đơn cơ sở mình được tạo trong ngày hiện tại.

---

## 16. Lịch hẹn `/api/appointments`

Tất cả tài khoản đã đăng nhập được thao tác lịch hẹn. MANAGER được thao tác lịch hẹn của mọi cơ sở trong tenant. STAFF chỉ xem/tạo/sửa/xóa lịch hẹn thuộc branch trong token.

### `POST /api/appointments`

```json
{
  "customer_id": 1,
  "branch_id": 1,
  "appointment_date": "2026-10-10T09:30:00",
  "note": "Khách tái khám da"
}
```

- `customer_id`, `appointment_date` bắt buộc. Khách hàng phải còn hoạt động; `appointment_date` phải là ngày giờ hợp lệ.
- Không gửi `status` khi tạo/sửa: backend từ chối trường này. Lịch mới được lưu `Khách chưa đến`.
- Với MANAGER, `branch_id` bắt buộc và phải là branch active. Với STAFF, backend luôn dùng branch trong token và bỏ qua `branch_id` gửi lên.
- Thành công `201`: `{ "message": "Tạo lịch hẹn thành công", "appointmentId": 1 }`.

### `GET /api/appointments`

Query tùy chọn: `search`, `branchId`, `status`, `startDate`, `endDate`.

- `search`: tìm gần đúng theo tên/số điện thoại khách hàng hoặc ghi chú.
- `branchId`: MANAGER có thể lọc branch; STAFF luôn bị khóa ở branch token và query này bị bỏ qua.
- `status`: chỉ nhận `Khách chưa đến` hoặc `Khách đã đến`, lọc theo trạng thái **tính lúc đọc**, không theo giá trị lưu trong bảng.
- `startDate`, `endDate`: lọc theo ngày hẹn `appointment_date` dạng `YYYY-MM-DD`.
- Dữ liệu trả thêm `customer_name`, `phone_number`, `branch_name`; sắp xếp theo ngày hẹn tăng dần.
- `status` trả về được tính tự động: `Khách đã đến` nếu khách có hóa đơn hoặc lịch sử thực hiện liệu trình còn hiệu lực tại **cùng cơ sở**, được ghi nhận sau khi tạo lịch, từ đầu ngày hẹn đến hiện tại và trước lịch hẹn tiếp theo của cùng khách/cơ sở; còn lại `Khách chưa đến`. Không cần sửa luồng hóa đơn/liệu trình, nhưng đây là trạng thái suy ra khi GET, không ghi ngược vào cột `appointments.status`. `created_at` được dùng thay ngày nghiệp vụ có thể nhập lùi; chỉ ghi nhận hoạt động đã lưu và không thể phân biệt chắc chắn hai lần hẹn cùng ngày.

### `GET /api/appointments/tomorrow`

Lấy các **lịch hẹn** vào ngày mai theo ngày giờ DB (`CURDATE()`), không phụ thuộc trạng thái. Trả `{ "message": "Lấy danh sách khách hẹn ngày mai thành công", "total": 1, "page": 1, "pageSize": 20, "totalPages": 1, "data": [{ "id": 1, "customer_id": 1, "status": "Khách chưa đến", "customer_name": "...", "phone_number": "...", "branch_name": "..." }] }`. Nhận thêm `branchId`, `search`, `status`, `startDate`, `endDate` như API danh sách. STAFF chỉ thấy branch token.

### `GET /api/appointments/not-arrived`

Lấy các lịch hẹn **hôm nay hoặc trước đó** mà trạng thái tính lúc đọc vẫn là `Khách chưa đến`. Cùng format, bộ lọc và quyền truy cập như API danh sách. Một khách có nhiều lịch hẹn có thể xuất hiện nhiều dòng.

### `GET /api/appointments/:id`

Lấy chi tiết một lịch hẹn. STAFF nhận `404` khi id thuộc cơ sở khác hoặc đã bị xóa.

### `PUT /api/appointments/:id`

Partial update các field: `customer_id`, `branch_id`, `appointment_date`, `note`. Gửi `status` sẽ bị từ chối.

- MANAGER được thay đổi `branch_id` sang mọi branch active.
- STAFF chỉ sửa appointment thuộc branch token; `branch_id` trong body bị bỏ qua nên không thể chuyển lịch hẹn sang branch khác.
- Gửi `note: ""` để xóa ghi chú (`null`).

### `DELETE /api/appointments/:id`

Xóa mềm lịch hẹn. MANAGER xóa được mọi branch; STAFF chỉ xóa được lịch hẹn của branch token.

---

## 17. Booking do khách đặt `/api/customer-bookings`

API đặt lịch nội bộ do nhân viên tạo theo schema Rosa, dành cho MANAGER/STAFF; hỗ trợ POST/GET danh sách và GET/PUT/DELETE chi tiết. Cả hai vai trò xem được toàn bộ booking trong cùng spa; STAFF thêm/sửa/xóa vẫn giới hạn branch token. Không giới hạn ngày đến là hôm nay vì đây là ngày hẹn. MiniApp hiện không được mount. Chi tiết hợp đồng payload: `docs/ROSA_CUSTOMER_BOOKINGS_API.md`.

### `GET /api/customer-bookings`

Query tùy chọn: `search`, `branchId`, `customerId`, `productId`, `status`, `startDate`, `endDate`, `startTime`, `endTime`.

- `search`: tìm gần đúng theo `customer_name`, `customer_phone`, ghi chú hoặc tên dịch vụ đã chọn.
- `branchId`: cả MANAGER và STAFF đều có thể lọc branch; bỏ qua thì xem toàn spa, không xem chéo tenant.
- `customerId`, `productId`, `status`: lọc khớp chính xác.
- `startDate`, `endDate`: lọc theo `arrival_date` dạng `YYYY-MM-DD`, bao gồm hai đầu. Thứ tự `arrival_date`, `arrival_time`, `created_at`, `id` tăng dần.
- `startTime`, `endTime`: lọc giờ hẹn `arrival_time`, nhận HH:mm/HH:mm:ss, bao gồm hai đầu; có thể gửi một đầu. Ví dụ 07:00–08:00 áp dụng cho mỗi ngày trong khoảng lọc, loại giờ NULL. Sai định dạng hoặc đầu > cuối trả 400, không hỗ trợ qua đêm.
- `has_arrived`: boolean tính động ở list/detail, true nếu khách phát sinh hóa đơn hoặc thẻ liệu trình chưa xóa mềm từ 00:00 ngày tạo booking (`created_at`) đến hiện tại. Khách EXISTING ghép customer_id; NEW chưa có ID ghép số điện thoại trùng chính xác. Kiểm tra toàn spa, không dùng ngày hẹn; không tự đổi status hay thêm cột DB.
- Kết quả trả thêm `branch_name`, `product_name`; nếu booking liên kết customer hệ thống thì có thêm `registered_customer_name`, `registered_customer_phone`.
- Thành công `200`: `{ "message": "Lấy danh sách booking khách hàng thành công", "total": 1, "page": 1, "pageSize": 20, "totalPages": 1, "data": [ ... ] }`.

### `GET /api/customer-bookings/:id`

Cần token MANAGER/STAFF; `200`: `{ "message": "Lấy chi tiết booking khách hàng thành công", "data": { ... } }`, cùng các field `customer_bookings`, `has_arrived` và thông tin join (`branch_name`, `product_name`, `registered_customer_name`, `registered_customer_phone`) như item danh sách; LEFT JOIN có thể trả `null`. STAFF xem được khác branch trong cùng spa. ID không hợp lệ trả `400`; không tồn tại/đã xóa trả `404`.

---

## 18. Nạp ví khách hàng `/api/customer-wallet-logs`

Ghi nhận khách nạp tiền vào ví. Trong **một transaction**, backend tạo `customer_wallet_logs` và cộng `total_received` vào `customers.wallet_balance`.

### `POST /api/customer-wallet-logs`

```json
{
  "customer_id": 1,
  "branch_id": 1,
    "paid_amount": 1000000,
    "bonus_percent": 10,
  "payment_method": "TRANSFER",
  "note": "Nạp ví khuyến mãi tháng 10"
}
```

- `customer_id`, `paid_amount` bắt buộc; `paid_amount >= 0`.
- Có thể nhập khuyến mãi bằng `bonus_percent` hoặc `bonus_amount` (hoặc gửi cả hai nếu khớp). Hai giá trị đều phải `>= 0`.
- Chỉ gửi `bonus_percent`: backend tính `bonus_amount = paid_amount * bonus_percent / 100`.
- Chỉ gửi `bonus_amount`: backend tính ngược `bonus_percent = bonus_amount * 100 / paid_amount`, làm tròn 2 chữ số. Không giới hạn mức phần trăm để hỗ trợ thưởng theo số tiền.
- Khi `paid_amount = 0`, chỉ được tặng theo `bonus_amount > 0`; `bonus_percent` được lưu là `0.00`. Vì vậy Spa có thể tặng trực tiếp, ví dụ `paid_amount: 0`, `bonus_amount: 2000000`.
- `paid_amount` và `bonus_amount` không được cùng bằng `0`. Nếu gửi đồng thời percent và amount nhưng không khớp với `paid_amount`, backend trả `400`.
- Backend luôn tự tính/lưu `total_received = paid_amount + bonus_amount`.
- `payment_method` tùy chọn, mặc định `CASH`; chỉ nhận `CASH`, `TRANSFER`, `CARD`.
- MANAGER bắt buộc gửi `branch_id`. STAFF luôn dùng branch token và bỏ qua `branch_id` gửi lên.
- Thành công `201` trả `walletLogId`, `paidAmount`, `bonusPercent`, `bonusAmount`, `totalReceived`, `walletBalance` mới.

### `GET /api/customer-wallet-logs`

Query tùy chọn: `search`, `branchId`, `customerId`, `paymentMethod`, `startDate`, `endDate`.

- `search`: tên/số điện thoại khách hoặc ghi chú.
- `branchId`: MANAGER có thể lọc branch; STAFF bị khóa branch token.
- `paymentMethod`: `CASH`, `TRANSFER` hoặc `CARD`.
- `startDate`, `endDate`: lọc theo thời điểm nạp (`created_at`) dạng `YYYY-MM-DD`.

### `GET /api/customer-wallet-logs/:id`

Xem một giao dịch nạp ví. STAFF không xem được giao dịch của branch khác.

### `PUT /api/customer-wallet-logs/:id`

Sửa giao dịch nạp ví. Có thể gửi một phần field; field không truyền sẽ giữ giá trị cũ.

```json
{
  "paid_amount": 1000000,
  "bonus_percent": 10.5,
  "payment_method": "TRANSFER",
  "note": "Điều chỉnh ưu đãi nạp ví"
}
```

- Hỗ trợ sửa `customer_id`, `branch_id`, `paid_amount`, `bonus_percent`, `bonus_amount`, `payment_method`, `note`.
- Nếu không gửi `bonus_percent` và `bonus_amount`, backend giữ tỷ lệ bonus cũ và tính lại `bonus_amount` nếu `paid_amount` thay đổi.
- Backend luôn tính lại `total_received`; không tin giá trị `total_received` từ frontend.
- Trong một transaction, backend khóa log và customer bằng `FOR UPDATE`, sau đó chỉ cộng/trừ **phần chênh lệch** `total_received` vào ví.
- Nếu đổi `customer_id`, backend hoàn tác toàn bộ tiền cũ ở khách cũ và cộng toàn bộ tiền mới cho khách mới trong cùng transaction.
- Nếu số dư hiện tại không đủ để trừ phần cần hoàn tác, API trả `400` và không thay đổi log/số dư.
- STAFF chỉ sửa được log của branch token và không thể chuyển log sang branch khác.

### `DELETE /api/customer-wallet-logs/:id`

Soft-delete giao dịch nạp ví và trừ lại `total_received` khỏi ví khách trong cùng transaction.

- Backend khóa log và ví khách bằng `FOR UPDATE` trước khi trừ tiền.
- Nếu số dư ví không đủ để hoàn tác, API trả `400`; log không bị xóa và số dư không thay đổi.
- STAFF chỉ xóa được log thuộc branch token.

---

## 19. Thu nợ khách hàng `/api/debt-payments`

Ghi nhận tiền khách thanh toán công nợ theo hóa đơn. `branch_id` của phiếu luôn là chi nhánh của hóa đơn (hạch toán doanh thu thu nợ); `collection_branch_id` là nơi thực thu (có thể khác), dùng phân quyền STAFF. Trong cùng transaction backend điều chỉnh `customers.total_debt`.

### `GET /api/debt-payments/invoices/:invoiceId/remaining-debt`

Lấy công nợ còn lại **của một hóa đơn** trong tenant, trước khi ghi nhận phiếu thu. Cần JWT; STAFF có thể tra hóa đơn thuộc chi nhánh khác để thu nợ liên chi nhánh. Hóa đơn đã xóa/không tồn tại hoặc ID không hợp lệ trả `404`.

`remainingDebtAmount = max(0, invoices.debt_amount - SUM(debt_payments.amount))`, chỉ cộng phiếu thu nợ cùng `invoice_id` có `deleted_at IS NULL`. `invoices.debt_amount` là nợ gốc của riêng hóa đơn, khác với `customers.total_debt` của cả khách hàng. Dữ liệu được tính lại mỗi lần gọi, không lưu thêm cột.

```json
{
  "message": "Lấy công nợ còn lại của hóa đơn thành công",
  "data": {
    "invoiceId": 30,
    "customerId": 1,
    "branchId": 1,
    "invoiceDebtAmount": 6000000,
    "paidDebtAmount": 500000,
    "remainingDebtAmount": 5500000
  }
}
```

### `POST /api/debt-payments`

```json
{
  "invoice_id": 30,
  "collection_branch_id": 2,
  "amount": 500000,
  "payment_method": "TRANSFER",
  "payment_date": "2026-10-06 10:30:00",
  "note": "Khách thanh toán công nợ"
}
```

- Bắt buộc: `invoice_id`, `amount`; invoice phải active. Backend lấy `customer_id` và `branch_id` hạch toán từ invoice; nếu body gửi hai field này thì phải khớp invoice, không dùng để chọn nơi thu.
- `collection_branch_id`: MANAGER bắt buộc gửi branch đang hoạt động; STAFF luôn dùng branch trong token, bỏ qua field body. STAFF ở A có thể thu invoice của B.
- `amount` phải lớn hơn 0, không vượt `customers.total_debt` hiện tại. Backend cộng `amount` của **tất cả phiếu chưa xóa mềm cùng `invoice_id`** với phiếu đang tạo/sửa và chặn nếu vượt `invoices.debt_amount` (nợ gốc của riêng hóa đơn). Khi sửa, phiếu hiện tại không bị tính hai lần; chỉ chấp nhận tối đa 2 chữ số thập phân.
- `payment_method` mặc định `CASH`; chỉ nhận `CASH`, `TRANSFER`, `CARD`.
- `payment_date` tùy chọn, mặc định thời điểm hiện tại.
- Thành công `201`: trả `debtPaymentId`, `customerId`, `branchId` (hạch toán), `collectionBranchId`, `invoiceId`, `amount`, `totalDebt` còn lại của khách.

### `GET /api/debt-payments`

Query tùy chọn: `search`, `branchId`, `collectionBranchId`, `customerId`, `invoiceId`, `paymentMethod`, `startDate`, `endDate`.

- `search`: tên/số điện thoại khách hoặc ghi chú.
- `branchId`: lọc theo branch hạch toán (MANAGER); `collectionBranchId`: lọc nơi thực thu. STAFF luôn chỉ xem được phiếu có `collection_branch_id` bằng branch token.
- Danh sách trả `branch_name` và `collection_branch_name` cùng hai ID tương ứng.
- `startDate`, `endDate`: lọc theo `payment_date` dạng `YYYY-MM-DD`.

### `GET /api/debt-payments/:id`

Xem chi tiết phiếu, gồm hai chi nhánh và tổng nợ hóa đơn. STAFF chỉ xem phiếu thu tại branch token (không phụ thuộc branch hóa đơn).

### `PUT /api/debt-payments/:id`

Partial update các field: `invoice_id`, `collection_branch_id`, `amount`, `payment_method`, `payment_date`, `note`. `invoice_id` không được đặt `null`; khi bỏ qua sẽ giữ invoice cũ. Nếu truyền `customer_id`/`branch_id`, chúng phải khớp invoice.

- Backend khóa phiếu, hóa đơn và customer bằng `FOR UPDATE`; khi đổi invoice, tự cập nhật customer và `branch_id` hạch toán.
- Cùng khách: `total_debt` được điều chỉnh bằng chênh lệch giữa amount cũ và amount mới.
- Đổi khách: backend cộng lại amount cũ vào công nợ khách cũ và trừ amount mới ở công nợ khách mới trong cùng transaction.
- Tất cả quy tắc không vượt tổng công nợ/tổng debt của invoice vẫn được kiểm tra. STAFF không thể chuyển nơi thực thu sang branch khác, nhưng có thể chọn invoice thuộc branch hạch toán khác.

### `DELETE /api/debt-payments/:id`

Soft-delete phiếu và cộng lại `amount` vào `customers.total_debt` trong cùng transaction. STAFF chỉ xóa phiếu có `collection_branch_id` là branch token.

---

## 20. Thẻ Liệu trình `/api/treatments`

Hệ thống tự động sinh thẻ khi item là dịch vụ (`is_product = 0`) hoặc combo (`is_treatment_combo = 1`); dịch vụ không phải combo chỉ 1 buổi và `note` ghi số lượng + `products.unit`, combo tính `quantity × default_sessions`. MANAGER cũng có thể tạo thẻ thủ công. Tất cả người dùng đã đăng nhập đều xem được thẻ liệu trình của **mọi cơ sở trong cùng tenant**. STAFF chỉ được tạo/sửa/xóa history tại cơ sở trong token; `branch_id` trong history là cơ sở khách đến làm.

### `GET /api/treatments`

API này hỗ trợ query filter để tìm danh sách thẻ liệu trình. Tất cả query đều không bắt buộc và có thể kết hợp với nhau.

| Query | Kiểu | Mô tả |
|---|---|---|
| `customerId` | number | Lọc theo ID khách hàng (`treatments.customer_id`). |
| `invoiceId` | number | Lọc các thẻ được sinh từ hóa đơn tương ứng (`treatments.invoice_id`). |
| `customerSearch` | string | Tìm gần đúng theo tên hoặc số điện thoại khách hàng. |
| `productSearch` | string | Tìm gần đúng theo tên sản phẩm/dịch vụ. Ví dụ: `productSearch=lông`. |
| `status` | `active` / `exhausted` / `completed` | `active`: chưa ký kết thúc (`closed_at IS NULL`), gồm cả thẻ hết buổi; `exhausted`: chưa ký kết thúc và `remaining_sessions = 0`; `completed`: đã ký kết thúc (`closed_at IS NOT NULL`). |
| `startDate` | `YYYY-MM-DD` | Lọc từ ngày tạo thẻ, theo `treatments.created_at`. |
| `endDate` | `YYYY-MM-DD` | Lọc đến ngày tạo thẻ, theo `treatments.created_at`. |
| `branchId` | number | Lọc theo branch của hóa đơn gốc. Thẻ tạo thủ công không có invoice vẫn được bao gồm theo logic hiện tại. |

- `customerSearch` tìm theo tên/số điện thoại; `productSearch` tìm tên dịch vụ.
- `status=active` lọc thẻ chưa ký kết thúc; `status=exhausted` lọc thẻ hết buổi nhưng chưa ký kết thúc; `status=completed` lọc thẻ đã ký kết thúc. Chữ ký từng buổi không làm thẻ chuyển sang completed.
- `startDate`, `endDate`: lọc ngày tạo thẻ; `invoiceId` lọc toàn bộ thẻ liệu trình được sinh từ một hóa đơn, không phụ thuộc branch của hóa đơn; `branchId` lọc thẻ tạo từ hóa đơn của một cơ sở (thẻ thủ công không có invoice vẫn được bao gồm theo nghiệp vụ hiện tại).
- Thành công `200`: `{ "message": "Lấy danh sách liệu trình thành công", "total": 1, "page": 1, "pageSize": 20, "totalPages": 1, "data": [ ... ] }`.

Ví dụ tìm các thẻ liệu trình có tên dịch vụ chứa `lông`:

```http
GET /api/treatments?productSearch=lông
Authorization: Bearer <token>
```

Ví dụ gọi bằng cURL:

```bash
curl -G "http://localhost:5000/api/treatments" \
  --data-urlencode "productSearch=lông" \
  -H "Authorization: Bearer <token>"
```

Ví dụ kết hợp nhiều điều kiện:

```http
GET /api/treatments?customerId=1&productSearch=lông&status=active&startDate=2026-10-01&endDate=2026-10-31
Authorization: Bearer <token>
```

Lưu ý: endpoint này trả danh sách `data`. Muốn xem chi tiết một thẻ và toàn bộ lịch sử thực hiện, gọi `GET /api/treatments/:id`.
Không gửi `status` thì API trả cả thẻ chưa ký, đã hết buổi và đã ký kết thúc (trừ thẻ xóa mềm). `status=active` lấy thẻ chưa ký kết thúc, `status=exhausted` lấy thẻ hết buổi nhưng chưa ký kết thúc, `status=completed` lấy thẻ đã ký kết thúc. Danh sách ngoài và tổng phân trang chỉ tính thẻ gốc; `children` lồng bên trong vẫn hiển thị dù hết buổi/đã đóng. Danh sách mặc định mới nhất trước theo `created_at`, rồi `id`.

### `GET /api/treatments/:id`

Trả thông tin thẻ, khách hàng, sản phẩm, cơ sở của hóa đơn gốc (nếu có) và `histories`; từng history chứa `staffs` cùng `commission_amount_snapshot`. Thành công `200`: `{ "message": "Lấy chi tiết liệu trình thành công", "data": { ... } }`; không tồn tại/đã xóa trả `404`.

#### Cách gọi

`id` là `treatments.id` của thẻ liệu trình cần xem:

```http
GET /api/treatments/17
Authorization: Bearer <token>
```

Ví dụ cURL:

```bash
curl -X GET "http://localhost:5000/api/treatments/17" \
  -H "Authorization: Bearer <token>"
```

Ví dụ JavaScript:

```js
const response = await fetch('http://localhost:5000/api/treatments/17', {
  headers: {
    Authorization: `Bearer ${token}`
  }
});

const result = await response.json();
```

Endpoint này **không hỗ trợ query parameter**. Không truyền `customerId`, `invoiceId`, `branchId`, `status`, `startDate` hoặc `endDate` cho endpoint detail. Các bộ lọc đó chỉ dùng với `GET /api/treatments`.

#### Các field trả về

`data` gồm các field của bảng `treatments` và các field bổ sung:

- `id`: ID thẻ liệu trình.
- `customer_id`: ID khách hàng.
- `product_id`: ID sản phẩm/dịch vụ.
- `invoice_id`: ID hóa đơn sinh ra thẻ, có thể `null` nếu thẻ được tạo thủ công.
- `total_sessions`: Tổng số buổi.
- `remaining_sessions`: Số buổi còn lại.
- `note`: Ghi chú của thẻ.
- `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`, `deleted_by`.
- `customer_name`, `phone_number`: Tên và số điện thoại khách hàng.
- `product_name`: Tên sản phẩm/dịch vụ.
- `branch_id`: Branch của hóa đơn gốc nếu có; thẻ tạo thủ công có thể là `null`. Đây không phải branch giới hạn quyền xem treatment.
- `histories`: Danh sách các lần thực hiện dịch vụ, sắp xếp `execution_date` mới nhất trước.

Mỗi phần tử trong `histories[]` gồm các field của `treatment_history`:

- `id`, `treatment_id`, `branch_id`.
- `execution_date`: Thời điểm thực hiện dịch vụ.
- `note`: Ghi chú riêng của buổi, có thể `null`, khác ghi chú chung trên thẻ.
- `customer_signature_svg`, `customer_signed_at`: Chữ ký xác nhận buổi và thời điểm server ghi nhận, có thể `null`; khác chữ ký kết thúc cả nhóm.
- `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`, `deleted_by`.
- `staffs`: Danh sách nhân viên được gán cho lần thực hiện đó.

Mỗi phần tử trong `histories[].staffs[]` gồm các field của `treatment_history_staffs` và:

- `id`, `treatment_history_id`, `staff_id`.
- `commission_amount_snapshot`: Field legacy trong bảng, không dùng tính báo cáo; với assignment mới có giá trị 0.
- `staff_name`: Tên nhân viên.
- `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`, `deleted_by`.

Response thành công `200`:

```json
{
  "message": "Lấy chi tiết liệu trình thành công",
  "data": {
    "id": 17,
    "customer_id": 1,
    "product_id": 12,
    "invoice_id": 18,
    "total_sessions": 5,
    "remaining_sessions": 4,
    "customer_name": "Phạm Khách Hàng",
    "phone_number": "0912345678",
    "product_name": "Peel da",
    "branch_id": 1,
    "histories": [
      {
        "id": 14,
        "treatment_id": 17,
        "branch_id": 1,
        "execution_date": "2026-10-05T02:00:00.000Z",
        "staffs": [
          {
            "id": 15,
            "treatment_history_id": 14,
            "staff_id": 7,
            "staff_name": "Trần Kỹ Thuật",
  "commission_amount_snapshot": "0.00"
          }
        ]
      }
    ]
  }
}
```

Nếu `id` không tồn tại hoặc treatment đã bị soft delete, API trả `404`:

```json
{
  "message": "Không tìm thấy thẻ liệu trình hoặc thẻ đã bị xóa"
}
```

### `POST /api/treatments` — chỉ `MANAGER`

Tạo thẻ thủ công.

```json
{
  "customer_id": 1,
  "product_id": 5,
  "commission_base_price": 900000,
  "commission_quantity": 2,
  "total_sessions": 10,
  "remaining_sessions": 10,
  "note": "Tặng thêm liệu trình"
}
```

- `customer_id`, `product_id`, `total_sessions` bắt buộc; số buổi là số nguyên và `total_sessions > 0`.
- `commission_base_price` bắt buộc (đơn giá trước giảm, >= 0); `commission_quantity` tùy chọn (số đơn vị trong một buổi dịch vụ không combo, mặc định 1). Không gửi `invoice_id` khác null: thẻ từ hóa đơn tạo qua API hóa đơn.
- `remaining_sessions` tùy chọn: bỏ field thì mặc định bằng `total_sessions`; cho phép 0, không được lớn hơn tổng số buổi. Hai số buổi phải là số nguyên trong phạm vi INT (tổng >= 1, còn lại >= 0); chấp nhận chuỗi chỉ chứa chữ số cho form cũ, từ chối null/chuỗi rỗng/boolean/số lẻ.
- Nhập thẻ cũ: tổng 10 còn 4 thì gửi `total_sessions: 10, remaining_sessions: 4`; backend không sinh 6 lịch sử/hoa hồng quá khứ. Buổi tiếp theo còn 3. `completed_sessions` suy ra từ tổng trừ còn lại có thể lớn hơn số lịch sử trên hệ thống mới. Không áp dụng số dư nhập này cho thẻ tự sinh qua hóa đơn.
- Thành công `201`: `{ "message": "Tạo thẻ liệu trình thủ công thành công", "treatmentId": 1 }`.

### `POST /api/treatments/execute`

Trừ một buổi tại cơ sở thực tế khách đến làm.

Nhận thêm `note` và `customer_signature_svg` tùy chọn (MANAGER/STAFF theo quyền thực hiện hiện có). `note` là chuỗi tối đa 65535 byte UTF-8; bỏ qua/null/chuỗi trắng lưu NULL, chuỗi khác được trim hai đầu và giữ xuống dòng. `customer_signature_svg` bỏ qua/null là chưa ký; nếu gửi chuỗi thì phải là SVG nét vẽ hợp lệ theo validator chữ ký tại `docs/ROSA_TREATMENT_GROUPS_API.md` (tối đa 128 KiB); chuỗi rỗng hoặc SVG không hợp lệ trả 400. Khi có chữ ký hợp lệ server tự ghi `customer_signed_at=NOW()`, client **không gửi customer_signed_at** (gửi lên bị từ chối). Ghi chú/chữ ký được lưu cùng transaction trừ buổi/lịch sử/hoa hồng; request cũ không gửi các trường mới vẫn dùng được. Chưa có API sửa ghi chú hoặc ký bổ sung sau khi tạo buổi.

Ví dụ phần bổ sung vào payload: `"note": "Da hơi đỏ, lưu ý theo dõi buổi sau", "customer_signature_svg": "<svg width=\"300\" height=\"100\"><path d=\"M 10 20 L 50 60\"/></svg>"`. Frontend render ghi chú dạng text và chữ ký qua image, không chèn HTML tùy ý. Ký từng buổi không đóng liệu trình; ký kết thúc dùng `POST /api/treatments/:id/close` tại thẻ cha để đóng cha và toàn bộ thẻ con.

```json
{
  "treatment_id": 1,
  "branch_id": 1,
  "execution_date": "2026-10-05T09:00:00",
  "staffs": [
    { "staff_id": 2 }
  ]
}
```
- `treatment_id` bắt buộc. Với STAFF, `branch_id` có thể bỏ qua và backend tự lấy `branch_id` trong token; nếu truyền lên thì phải trùng token. Với MANAGER, `branch_id` bắt buộc.
- `execution_date` tùy chọn (mặc định hiện tại). `staffs` tùy chọn; công được tính và ghi `commission_amount_snapshot` khi gán nhân viên. Thẻ hóa đơn chưa đối soát dòng bán hoặc thẻ thủ công cũ chưa có giá sẽ bị từ chối gán nhân viên cho đến khi sửa dữ liệu.
- Bị chặn nếu thẻ hết buổi. Nếu product có `next_appointment_days` và còn buổi, backend tạo lịch hẹn tiếp theo tại `branch_id` thực hiện.
- Frontend **không gửi `appointment_id`**. Đây là cột nội bộ của `treatment_history` do backend tự ghi khi tạo lịch hẹn; cần chạy migration `docs/migrations/2026-10-14_link_treatment_history_appointment.sql` trên **từng tenant database** trước khi dùng phiên bản backend này, nếu chưa chạy sẽ gặp lỗi `Unknown column 'appointment_id'`.
- Thành công `201`: `{ "message": "Đã trừ 1 buổi liệu trình thành công", "treatmentHistoryId": 1 }`.

### `PUT /api/treatments/execute/:historyId/staffs`

Gán lại toàn bộ nhân viên cho một history đã trừ buổi.

```json
{ "staffs": [{ "staff_id": 2 }, { "staff_id": 3 }] }
```

`staffs` bắt buộc là mảng và có thể rỗng. Mỗi request luôn xóa mềm các assignment/hoa hồng cũ của history trước khi xử lý danh sách mới:

- Gửi `staffs: [{ "staff_id": 2 }]`: gán lại nhân viên; tiền công được tính lúc đọc báo cáo.
- Gửi `staffs: []`: không gán nhân viên mới; toàn bộ `treatment_history_staffs` hiện có của history bị xóa mềm. Dùng khi không có người thực hiện hoặc cần hủy công/hoa hồng, ví dụ sau khi có khiếu nại.

STAFF chỉ được chỉnh history cùng branch token và chỉ gán staff thuộc branch token; MANAGER không bị giới hạn branch. Khi `staffs: []`, STAFF vẫn phải có quyền trên branch của history.

### `DELETE /api/treatments/execute/:historyId`

Hoàn tác một lần thực hiện: cộng lại một buổi, xóa mềm `treatment_history` và toàn bộ `treatment_history_staffs` của buổi đó. Nếu buổi thực hiện đã tự tạo lịch hẹn tiếp theo (`treatment_history.appointment_id` khác `null`), backend **đồng thời xóa mềm đúng lịch hẹn liên kết** trong bảng `appointments` nếu lịch chưa bị xóa. Các thao tác này nằm trong cùng transaction: nếu có lỗi, toàn bộ thao tác được rollback. Không xóa lịch hẹn thủ công hoặc lịch của buổi khác.

History được tạo trước khi áp dụng migration `docs/migrations/2026-10-14_link_treatment_history_appointment.sql` không có liên kết (`appointment_id = null`), nên **không thể tự động xóa lịch hẹn cũ** khi hoàn tác; cần kiểm tra và xóa riêng lịch tương ứng nếu cần. STAFF chỉ được hoàn tác history tại branch trong token; MANAGER không bị giới hạn branch. Frontend chỉ gọi `DELETE /api/treatments/execute/:historyId`, **không cần gửi `appointment_id`**. Thành công `200`: `{ "message": "Xóa lịch sử thực hiện và cộng lại 1 buổi thành công" }`.

### `GET /api/treatments/commissions`

Báo cáo dòng công ca đọc `treatment_history_staffs.commission_amount_snapshot`. Query tùy chọn: `branchId`, `staffName`, `roleName`, `productId`, `startDate`, `endDate`.

- STAFF luôn chỉ xem history và staff thuộc branch trong token; `branchId` gửi lên bị bỏ qua đối với STAFF. MANAGER có thể lọc bằng `branchId`.
- Kết quả sắp xếp theo `branchId`, `staffName`, `staffId`, rồi `commission_amount` tăng dần.
- Thành công `200` (mỗi phần tử `data` là một lần phân công, `total` là số dòng, **không phải tổng tiền**):

```json
{
  "message": "Lấy danh sách hoa hồng nhân viên thành công",
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "data": [{
    "id": 15, "treatment_history_id": 9, "commission_amount": "80000.00",
    "created_at": "2026-10-09T10:00:00.000Z", "execution_date": "2026-10-09T09:00:00.000Z",
    "branch_id": 1, "branch_name": "Cơ sở 1", "staff_id": 3, "staff_name": "Nguyễn A",
    "role_name": "Kỹ thuật viên", "product_id": 4, "product_name": "Chăm sóc da",
    "customer_name": "Trần B"
  }]
}
```

`commission_amount` là DECIMAL đã lưu của mỗi lượt làm (chuỗi số tiền); sửa giá/số lượng dòng hóa đơn sẽ tính lại công các buổi liên quan. Muốn **tổng công ca theo nhân viên + phân trang** thì dùng API báo cáo `/api/reports/commissions` và `/api/reports/details/commissions` bên dưới.

---

## Báo cáo `/api/reports` — chỉ MANAGER

Tất cả request là `GET`, yêu cầu `Authorization: Bearer <JWT>` của MANAGER. STAFF và các quyền khác bị `403` ở mọi báo cáo (bao gồm `/commissions`, `/consultants`, `/details/commissions`, `/details/consultants`); thiếu token `401`. MANAGER có thể chọn `branchId` số nguyên dương; không gửi = toàn tenant. Tất cả endpoint nhận **bắt buộc** `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` (gồm cả hai ngày). `branchId` dùng theo **chi nhánh thực hiện** công ca hoặc **chi nhánh hóa đơn** của tư vấn. Khoảng ngày căn theo giờ DB; ngày giờ MySQL được driver trả dưới dạng JSON datetime, không giả định múi giờ browser. Ngày không hợp lệ, đảo thứ tự, branchId/page/pageSize sai hoặc type không hợp lệ trả `400 {"message":"..."}`. Sự cố DB trả `500`.

Ví dụ báo cáo tuần `GET /api/reports/revenue?startDate=2026-10-05&endDate=2026-10-11&branchId=1`; báo cáo tháng `startDate=2026-10-01&endDate=2026-10-31`. Không cần tham số `week`/`month`.

**Quy tắc tiền:** `productRevenue` và `serviceRevenue` là giá trị bán sau chiết khấu, **không phải tiền thực thu**. Mỗi hóa đơn: tổng trước chiết khấu cấp hóa đơn = tổng `invoice_items.final_price` sau chiết khấu từng dòng; lấy phần chênh giữa số đó và `invoices.total_amount` để trừ **dịch vụ trước**, phần dư trừ **sản phẩm**. Ví dụ dịch vụ 500.000 + sản phẩm 3.000.000, giảm tổng hóa đơn 1.000.000 ⇒ `serviceRevenue=0`, `productRevenue=2500000`. Combo được phân loại theo `products.is_product` (`0` dịch vụ, `1` sản phẩm). Hóa đơn/chi tiết đã xóa mềm không tính. `totalRevenue = serviceRevenue + productRevenue`; số tiền ví đã dùng (`wallet_used`) nằm trong giá trị doanh thu hóa đơn nhưng không được cộng vào **tổng thu tiền mặt** lần nữa.

`receipts.total = invoices.paid_amount` theo `invoice_date` + `debt_payments.amount` theo `payment_date` + `customer_wallet_logs.paid_amount` theo `created_at`. Nạp ví thưởng (`bonus_amount`) không phải tiền thu; tiền thu nợ chỉ cộng ở ngày thực thu, không cộng lại vào doanh thu hóa đơn. Tiền thu nợ phân theo `debt_payments.branch_id` (chi nhánh của hóa đơn); response chi tiết còn có `collection_branch_id` (nơi thực thu). `expenses.total = expense_vouchers.amount` theo `expense_date` + `inventory_imports.total_amount` theo `import_date`; theo quy trình này tiền nhập kho **không** ghi thêm phiếu chi. `netCashFlow = receipts.total - expenses.total`, không phải lợi nhuận sau giá vốn. Hoa hồng/tư vấn là báo cáo riêng, **không trừ thêm** vào chi nếu chưa ghi phiếu chi.

### 1. `GET /api/reports/revenue` — các thẻ tổng quan

Thành công `200` (mọi số tiền ở endpoint này là `number` tính theo đơn vị tiền của hệ thống):

```json
{
  "message": "Lấy báo cáo thành công",
  "period": { "startDate": "2026-10-05", "endDate": "2026-10-11", "branchId": 1 },
  "serviceRevenue": 0,
  "productRevenue": 2500000,
  "totalRevenue": 2500000,
  "receipts": {
    "invoiceCash": 1000000,
    "debtPayments": 200000,
    "walletTopups": 500000,
    "total": 1700000,
    "walletUsedExcluded": 300000
  },
  "expenses": { "expenseVouchers": 100000, "inventoryImports": 600000, "total": 700000 },
  "netCashFlow": 1000000,
  "daily": [
    {
      "date": "2026-10-05",
      "serviceRevenue": 0, "productRevenue": 2500000, "totalRevenue": 2500000,
      "receipts": { "invoiceCash": 1000000, "debtPayments": 200000, "walletTopups": 500000, "total": 1700000, "walletUsedExcluded": 300000 },
      "expenses": { "expenseVouchers": 100000, "inventoryImports": 600000, "total": 700000 },
      "netCashFlow": 1000000
    },
    { "date": "2026-10-06", "serviceRevenue": 0, "productRevenue": 0, "totalRevenue": 0,
      "receipts": { "invoiceCash": 0, "debtPayments": 0, "walletTopups": 0, "total": 0, "walletUsedExcluded": 0 },
      "expenses": { "expenseVouchers": 0, "inventoryImports": 0, "total": 0 }, "netCashFlow": 0 }
  ]
}
```

`daily` gồm **tất cả ngày lịch** từ `startDate` đến `endDate` (bao gồm cả hai đầu), sắp xếp tăng dần, kể cả ngày không có chứng từ (mọi chỉ tiêu bằng `0`). Ví dụ `2026-10-01` đến `2026-10-30` trả đúng 30 phần tử; ví dụ JSON trên chỉ minh họa hai phần tử đầu. Mỗi phần tử có `date` dạng `YYYY-MM-DD` và **cùng cấu trúc chỉ tiêu** với tổng kỳ: `totalRevenue` (doanh thu bán hàng) = `serviceRevenue` (dịch vụ) + `productRevenue` (sản phẩm); `receipts.invoiceCash` là tiền **thực thu trên hóa đơn**, `receipts.total` là **tổng thu** (thêm thu nợ và nạp ví), `expenses.total` là **tổng chi**, `netCashFlow = receipts.total - expenses.total` là thực thu sau chi/tiền ròng. Tiền thu nợ tính vào ngày `payment_date`, nạp ví vào ngày `created_at`, chi theo ngày phiếu; hóa đơn theo `invoice_date`, cùng quy tắc `branchId` và loại trừ bản ghi xóa mềm như tổng kỳ. Không cần request riêng; các trường tổng hiện có không đổi. `walletUsedExcluded` chỉ là chỉ tiêu tham khảo (tổng ví đã sử dụng trên hóa đơn **trong khoảng lọc**), **không trừ** khỏi `receipts.total` lần nữa; không phải doanh thu nạp ví. Nếu không lọc chi nhánh thì `period.branchId=null`. Kỳ không có chứng từ trả các tổng bằng `0` và `daily` vẫn có đầy đủ ngày.

### 2. `GET /api/reports/details/:type` — các bảng chứng từ có phân trang

Có thể thêm `search` (tối đa 100 ký tự) để tìm trên toàn bộ kỳ, trước khi phân trang. Tìm không phân biệt hoa/thường theo mã dòng, tên cơ sở, khách hàng, nhân viên, sản phẩm/dịch vụ và các trường có ý nghĩa của từng loại (ví dụ mã hóa đơn, số điện thoại, ghi chú, loại chi, nhà cung cấp, số tiền). `total`, `totalAmount` và `totalPages` là kết quả sau lọc; không gửi `search` thì giữ kết quả cũ. Tham số `query` không được hỗ trợ.

`type` chỉ nhận: `invoices`, `debt_payments`, `wallet_logs`, `expenses`, `inventory_imports`, `commissions`, `consultants`. Chỉ MANAGER xem được các type báo cáo. Query giống API revenue, thêm `page` (mặc định `1`) và `pageSize` (mặc định `20`, tối đa `100`). Với hai type `commissions`/`consultants` có thể thêm `staffId` để xem đúng toàn bộ giao dịch của một nhân viên qua các trang; các type còn lại không nhận `staffId`. Nếu có lọc này, response `period` thêm `staffId`. Các dòng thuộc **trang hiện tại**, nhưng `total` là số dòng và `totalAmount` (number) là tổng tiền của **toàn khoảng lọc**, không phụ thuộc `page`/`pageSize`; `totalPages=ceil(total/pageSize)`. Không có dòng thì `totalAmount=0`, trang vượt giới hạn vẫn có tổng toàn kỳ. Sắp xếp mới nhất trước cho chứng từ thu/chi; công ca và tư vấn theo `branch_id`, tên nhân viên, `staff_id`, tiền tăng dần, `id` tăng dần. Khi đổi bộ lọc, frontend đặt lại `page=1`. Gọi riêng từng type khi người dùng mở tab, thay vì tải 7 bảng một lúc.

`totalAmount` theo type: `invoices` = tổng `total_amount` hóa đơn (giá trị bán sau giảm giá, **không phải** tiền đã thanh toán); `debt_payments` = tổng `amount` thu nợ; `wallet_logs` = tổng `paid_amount` nạp ví (không gồm thưởng); `expenses` = tổng `amount` phiếu chi; `inventory_imports` = tổng `total_amount` nhập hàng; `commissions` = tổng `commission_amount_snapshot` (được tính lại khi sửa dòng bán); `consultants` = tổng `revenue_amount` phân bổ tư vấn. Dùng cùng bộ lọc ngày, chi nhánh, nhân viên (nếu áp dụng) và xóa mềm như danh sách chi tiết. Không cộng các loại tổng này với nhau thành doanh thu.

Ví dụ `GET /api/reports/details/invoices?startDate=2026-10-05&endDate=2026-10-11&branchId=1&page=1&pageSize=20`:

```json
{
  "message": "Lấy báo cáo thành công",
  "type": "invoices",
  "period": { "startDate": "2026-10-05", "endDate": "2026-10-11", "branchId": 1 },
  "page": 1, "pageSize": 20, "total": 1, "totalAmount": 2500000, "totalPages": 1,
  "data": [{
    "id": 42, "branch_id": 1, "branch_name": "Cơ sở 1",
    "customer_id": 8, "customer_name": "Trần B", "phone_number": "0900000000",
    "invoice_date": "2026-10-09T10:00:00.000Z", "total_amount": "2500000.00",
    "paid_amount": "1000000.00", "wallet_used": "300000.00", "debt_amount": "1200000.00",
    "payment_method": "TRANSFER", "service_before_invoice_discount": "500000.00",
    "product_before_invoice_discount": "3000000.00", "invoice_discount_total": "1000000.00",
    "service_revenue": "0.00", "product_revenue": "2500000.00"
  }]
}
```

Các khoản tiền ở bảng chi tiết là MySQL `DECIMAL` (thường serialize dưới dạng **chuỗi**) chứ không giống thẻ summary dạng number; frontend format tiền sau khi chuyển đổi một cách an toàn. Bảng `invoices` trả tổng tiền và phân bổ doanh thu **theo hóa đơn**, không nhúng toàn bộ items để giữ response gọn; nút xem item/chi tiết dùng `GET /api/invoices/:id`.

Các `type` còn lại **dùng đúng envelope** (`message`, `type`, `period`, `page`, `pageSize`, `total`, `totalAmount`, `totalPages`, `data`) ở trên; một phần tử `data` có các field sau (số tiền DECIMAL thể hiện dạng chuỗi trong ví dụ):

```jsonc
// type=debt_payments — nút xem chi tiết: GET /api/debt-payments/:id
{ "id": 5, "invoice_id": 42, "customer_id": 8, "customer_name": "Trần B", "phone_number": "0900000000", "branch_id": 1, "branch_name": "Cơ sở 1", "collection_branch_id": 2, "collection_branch_name": "Cơ sở 2", "payment_date": "2026-10-10T10:00:00.000Z", "amount": "200000.00", "payment_method": "CASH", "note": "Thanh toán nợ" }

// type=wallet_logs — nút xem chi tiết: GET /api/customer-wallet-logs/:id
{ "id": 6, "customer_id": 8, "customer_name": "Trần B", "phone_number": "0900000000", "branch_id": 1, "branch_name": "Cơ sở 1", "created_at": "2026-10-09T10:00:00.000Z", "paid_amount": "500000.00", "bonus_amount": "50000.00", "total_received": "550000.00", "payment_method": "CASH", "note": "Nạp ví" }

// type=expenses — nút xem chi tiết: GET /api/expenses/:id
{ "id": 7, "branch_id": 1, "branch_name": "Cơ sở 1", "expense_date": "2026-10-09T10:00:00.000Z", "amount": "100000.00", "expense_type": "Điện", "note": "Tiền điện" }

// type=inventory_imports — nút xem chi tiết: GET /api/inventory-imports/:id (có items[])
{ "id": 9, "branch_id": 1, "branch_name": "Cơ sở 1", "import_code": "PN20261009001", "import_date": "2026-10-09T10:00:00.000Z", "supplier_name": "Nhà cung cấp A", "total_amount": "600000.00", "note": "Nhập hàng" }

// type=commissions — một dòng công ca của nhân viên
{ "id": 15, "treatment_history_id": 9, "execution_date": "2026-10-09T09:00:00.000Z", "branch_id": 1, "branch_name": "Cơ sở 1", "staff_id": 3, "staff_name": "Nguyễn A", "role_name": "Kỹ thuật viên", "product_id": 4, "product_name": "Chăm sóc da", "customer_id": 8, "customer_name": "Trần B", "commission_amount": "80000.00" }

// type=consultants — một lần nhân viên được phân tiền tư vấn cho một mặt hàng hóa đơn
{ "id": 22, "invoice_item_id": 30, "invoice_id": 42, "invoice_date": "2026-10-09T10:00:00.000Z", "branch_id": 1, "branch_name": "Cơ sở 1", "staff_id": 3, "staff_name": "Nguyễn A", "customer_id": 8, "customer_name": "Trần B", "product_id": 4, "product_name": "Chăm sóc da", "item_final_price": "500000.00", "role_type": "CONSULTANT", "revenue_amount": "100000.00" }
```

`GET /api/reports/details/consultants` lấy theo `invoice_date`, không theo thời gian gán consultant; loại các consultant, item, invoice xóa mềm. `revenue_amount` là **tiền tư vấn phân bổ**, không phải % hoa hồng phải trả. Một hóa đơn có thể có nhiều dòng consultant và cùng xuất hiện nhiều lần; key bảng chi tiết dùng `id` (ID phân bổ), nút xem hóa đơn dùng `invoice_id`.

### 3. `GET /api/reports/commissions` — tổng công ca theo nhân viên

```json
{
  "message": "Lấy báo cáo thành công",
  "period": { "startDate": "2026-10-05", "endDate": "2026-10-11", "branchId": null },
  "totalAmount": 80000,
  "total": 1, "page": 1, "pageSize": 20, "totalPages": 1,
  "staffTotals": [
    { "branch_id": 1, "branch_name": "Cơ sở 1", "staff_id": 3, "staff_name": "Nguyễn A", "total_amount": 80000, "record_count": 1 }
  ]
}
```

Gọi `GET /api/reports/commissions?startDate=2026-10-05&endDate=2026-10-11&branchId=1&page=1&pageSize=20` để lấy tổng công ca từng nhân viên. `totalAmount` = tổng `commission_amount` của tất cả nhân viên trong phạm vi lọc, tính lại mỗi lần gọi API từ `product_commissions` theo role và giá sản phẩm **hiện tại** (`fixed + price × percent / 100`; không có cấu hình đang hoạt động thì bằng 0). Thay giá, chức vụ hoặc cấu hình hoa hồng sẽ thay đổi cả kết quả của buổi cũ. `staffTotals` nhóm theo **chi nhánh thực hiện + staff_id** (cùng nhân viên ở hai chi nhánh là hai dòng). `record_count` là số lần phân công. Danh sách chi tiết lấy qua `GET /api/reports/details/commissions` với bộ lọc tương ứng. Chỉ MANAGER xem được báo cáo.

### 4. `GET /api/reports/consultants` — tổng tiền tư vấn theo nhân viên

```json
{
  "message": "Lấy báo cáo thành công",
  "period": { "startDate": "2026-10-05", "endDate": "2026-10-11", "branchId": 1 },
  "totalAmount": 100000,
  "total": 1, "page": 1, "pageSize": 20, "totalPages": 1,
  "staffTotals": [
    { "branch_id": 1, "branch_name": "Cơ sở 1", "staff_id": 3, "staff_name": "Nguyễn A", "total_amount": 100000, "record_count": 1 }
  ]
}
```

`totalAmount` = tổng `invoice_item_consultants.revenue_amount` của hóa đơn hợp lệ trong kỳ; `staffTotals` nhóm theo chi nhánh **của hóa đơn** + nhân viên. Đây là phần phân bổ sale, không tự cộng vào `receipts.total` và không mặc định là hoa hồng thực trả. Muốn liệt kê hóa đơn tư vấn của nhân viên, dùng `details/consultants?startDate=...&endDate=...&staffId=3&branchId=1` (có `invoice_id`), phân trang trên DB; **không** dùng lọc trên frontend để tính lại tổng tất cả các trang.

### 5. `GET /api/reports/products` — doanh thu từng sản phẩm/dịch vụ

Chỉ MANAGER. Query bắt buộc `startDate`, `endDate` (YYYY-MM-DD, gồm cả hai ngày), tùy chọn `branchId`, `page` (mặc định 1), `pageSize` (mặc định 20, tối đa 100), `search` (tối đa 100 ký tự, tìm tên sản phẩm/dịch vụ hoặc mã sản phẩm trên toàn kỳ trước phân trang). Ví dụ tháng: `GET /api/reports/products?startDate=2026-10-01&endDate=2026-10-31&branchId=1`. Sắp theo doanh thu giảm dần rồi product ID; chỉ liệt kê loại có dòng bán trong kỳ (dù doanh thu sau giảm giá bằng 0). `totalRevenue` và `total` là tổng trên **toàn bộ phạm vi lọc**, không chỉ trang hiện tại.

```json
{
  "message": "Lấy báo cáo thành công",
  "period": { "startDate": "2026-10-01", "endDate": "2026-10-31", "branchId": 1 },
  "totalRevenue": 900000,
  "total": 1, "page": 1, "pageSize": 20, "totalPages": 1,
  "data": [{
    "product_id": 4, "product_name": "Trị tàn nhang", "is_product": 0,
    "invoice_count": 2, "item_count": 2, "quantity": 2,
    "item_total": 1000000, "revenue": 900000
  }]
}
```

`is_product=0` là dịch vụ, `1` là hàng hóa. `item_total` là tổng tiền các dòng sau chiết khấu **cấp dòng**, trước chiết khấu cấp hóa đơn; `revenue` là doanh thu sau **cả** chiết khấu cấp hóa đơn (không phải tiền đã thu). Mỗi hóa đơn trừ phần giảm giá cấp hóa đơn vào nhóm dịch vụ trước, sau đó nhóm hàng hóa; phân bổ theo tỷ lệ `final_price` của mỗi dòng trong nhóm, làm tròn từng dòng đến 2 chữ số rồi cộng. Có thể chênh với báo cáo `/revenue` do làm tròn theo từng dòng; mức chênh tích lũy phụ thuộc số dòng hóa đơn. `invoice_count` đếm hóa đơn khác nhau; `item_count` đếm dòng bán, không nhân đôi theo số nhân viên tư vấn. Loại trừ hóa đơn và dòng item đã xóa mềm. Dùng `product_id` để mở chi tiết; tên hiện tại có thể đã đổi kể từ khi bán.

### 6. `GET /api/reports/products/:productId/invoices` — các hóa đơn chứa sản phẩm/dịch vụ

Query ngày/chi nhánh và phân trang như mục 5. Ví dụ: `GET /api/reports/products/4/invoices?startDate=2026-10-01&endDate=2026-10-31&page=1&pageSize=20`. `productId` là ID nguyên dương; sản phẩm không tồn tại trả `404` (sản phẩm xóa mềm vẫn có thể xem lịch sử); ngày/ID/trang sai trả `400`.

```json
{
  "message": "Lấy báo cáo thành công",
  "period": { "startDate": "2026-10-01", "endDate": "2026-10-31", "branchId": null },
  "product": { "id": 4, "name": "Trị tàn nhang", "is_product": 0 },
  "invoiceCount": 2, "quantity": 2, "itemTotal": 1000000, "revenue": 900000,
  "total": 2, "page": 1, "pageSize": 20, "totalPages": 1,
  "data": [{
    "invoice_item_id": 30, "invoice_id": 42, "invoice_date": "2026-10-09T10:00:00.000Z",
    "branch_id": 1, "branch_name": "Cơ sở 1", "customer_id": 8,
    "customer_name": "Trần B", "phone_number": "0900000000",
    "product_id": 4, "product_name": "Trị tàn nhang", "is_product": 0,
    "snapshot_name": "Trị tàn nhang", "snapshot_price": "500000.00", "quantity": 1,
    "discount_percent": "0.00", "discount_amount": "0.00",
    "final_price": "500000.00", "revenue": 450000
  }]
}
```

**Mỗi dòng `data[]` là một dòng hóa đơn**, không phải cả hóa đơn: nếu cùng một dịch vụ có nhiều dòng trên một hóa đơn thì `invoice_id` lặp, `invoice_item_id` khác. `snapshot_price` là **giá một đơn vị lúc bán** (có thể khác giá catalog hiện tại), `final_price` là thành tiền dòng sau chiết khấu cấp dòng, `revenue` đã được phân bổ chiết khấu cấp hóa đơn. Tiền từ MySQL (`snapshot_price`, `final_price`, các mức giảm) có thể là chuỗi số; `revenue`, `itemTotal` là number. Các tổng `invoiceCount`, `quantity`, `itemTotal`, `revenue`, `total` tính **toàn bộ kỳ**. Nút mở hóa đơn dùng `GET /api/invoices/:invoice_id`; không cộng `invoices.total_amount` để tính doanh thu riêng cho sản phẩm.

---

## 20. MiniApp (Chưa sử dụng)
Các endpoint `/api/miniapp/*` được định nghĩa nhưng chưa mount trong `src/server.js`.

---

## 21. Database và Lưu ý tích hợp
Xem cấu trúc bảng trong tài liệu đính kèm. Hầu hết API danh mục không trả bản ghi bị `deleted_at IS NOT NULL`.

---

## Hợp đồng response cho toàn bộ API quản trị đang mount

Mục này là bảng tra cứu **response thực tế**, bổ sung cho phần mô tả request/quy tắc nghiệp vụ phía trên. Các đường dẫn dưới đây đều bắt đầu bằng `/api`. MiniApp **chưa mount**, nên không có response để gọi qua server hiện tại. Ví dụ giá trị chỉ minh họa; key và kiểu/envelope mới là hợp đồng để frontend đọc. Không suy luận từ request rằng API sẽ trả lại bản ghi vừa lưu.

### Quy tắc đọc response

- Mọi response JSON thành công có `message: string`. Request thất bại trả `{ "message": "<mô tả lỗi>" }`, **không** kèm `data`/`total`; frontend cần kiểm tra HTTP status trước khi đọc dữ liệu. Thiếu token: `401`; token sai/hết hạn hoặc sai quyền qua middleware: `403`. Lỗi nghiệp vụ ghi dữ liệu thường `400`, GET chi tiết không tồn tại/thất bại theo controller thường `404`; riêng GET chi tiết liệu trình có thể `500` với lỗi không thuộc loại “Không tìm thấy”. Xem chi tiết ở các mục tương ứng.
- GET danh sách thường trả `{ "message": string, "total": number, "page": number, "pageSize": number, "totalPages": number, "data": T[] }`. `data` luôn là mảng, kể cả không có bản ghi hoặc trang vượt phạm vi; khi `total=0`, `totalPages=0`. `total` là số dòng **sau lọc, trước phân trang**. Ngoại lệ: các báo cáo tổng hợp dùng `staffTotals` hoặc chỉ có số tổng, được ghi riêng dưới đây.
- GET chi tiết trả `{ "message": string, "data": T }`, không phải mảng; không tìm thấy không trả `data: null` mà trả lỗi. API tạo/cập nhật/xóa chỉ trả các key nêu trong bảng, **không** tự động trả `data`. `id` sinh từ DB và `page`/`total` là number; cột MySQL `DECIMAL` (như `price`, `amount`, các tổng tiền lưu DB) thường serialize dạng **chuỗi số** qua mysql2, còn cột `quantity` kiểu INT và số tiền backend tính bằng JavaScript ở response ghi dữ liệu thường là number. Date/datetime do driver serialize, không nên so sánh chuỗi hiển thị.
- Cụm “toàn bộ cột” bên dưới nghĩa là **toàn bộ cột DB của bảng tương ứng**, bao gồm audit (`created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`, `deleted_by`) nếu có; một số cột có thể `null`. Danh sách các field quan trọng được ghi rõ để frontend không phải tra schema. Các API dùng `SELECT *` có thể bổ sung cột theo migration; không hard-code giả định chỉ có các field liệt kê. Riêng customer và user là các phép SELECT giới hạn cột để tránh trả password.

### Xác thực, tenant, tài khoản, danh mục

| Endpoint | HTTP | Response thành công |
|---|---:|---|
| `POST /auth/login` | 200 | `{ message, data: { user, token } }`; `user` là bản ghi master `users` **không có `password`**, `token` là JWT string. |
| `POST /tenants/create` | 201 | `{ message, data: { tenantId, spaName, managerUsername, managerFullname, database, expireDate } }`; `expireDate` là ISO datetime hoặc chuỗi `"Vĩnh viễn (Lifetime)"` nếu không thời hạn. |
| `GET /tenants` | 200 | Danh sách phân trang; `data[]`: `{ tenant_id, spa_name, database_name, expire_at, created_at, manager_username, manager_fullname }`; các field manager có thể `null` khi LEFT JOIN không có user. |
| `GET /tenants/:id` | 200 | `{ message: "Lấy chi tiết Spa thành công", data: Tenant }`; cùng field item danh sách. Chỉ SUPER_ADMIN; không tồn tại/đã xóa `404`. |
| `PUT /tenants/:id` | 200 | `{ message, data: { id, spa_name, expire_at } }`; `id` là tham số URL, `expire_at` có thể `null`. |
| `DELETE /tenants/:id` | 200 | `{ message: "Đã xóa (vô hiệu hóa) Spa thành công!" }`. |
| `PATCH /tenants/:id/restore` | 200 | `{ message: "Đã khôi phục Spa thành công! Các tài khoản đã có thể đăng nhập lại." }`. |
| `POST /users/create` | 201 | `{ message: "Tạo tài khoản đăng nhập thành công", userId: number }`. |
| `GET /users` | 200 | Danh sách phân trang, **bao gồm user xóa mềm**; `data[]`: `{ id, branch_id, username, fullname, system_role, created_at, deleted_at, branch_name }` (`branch_name` có thể không có nếu branch đã xóa, `'Tổng công ty'` nếu `branch_id` rỗng). Không có `password`. |
| `GET /users/:id` | 200 | `{ message: "Lấy chi tiết tài khoản thành công", data: User }`; cùng field list, kể cả user đã khóa; **không có password**. Chỉ MANAGER; không tồn tại/khác tenant `404`. |
| `PUT /users/:id` | 200 | `{ message: "Cập nhật tài khoản thành công!" }`. |
| `DELETE /users/:id` | 200 | `{ message: "Khóa tài khoản thành công!" }`. |
| `PATCH /users/:id/restore` | 200 | `{ message: "Khôi phục tài khoản thành công!" }`. |
| `POST /roles` | 201 | `{ message: "Tạo chức vụ thành công", roleId: number }`. |
| `GET /roles` | 200 | Danh sách phân trang; `data[]`: bản ghi `roles` (`id`, `name`, `description`, audit). |
| `GET /roles/:id` | 200 | `{ message: "Lấy chi tiết chức vụ thành công", data: Role }`; cùng field list; đã xóa/không tồn tại `404`. |
| `PUT /roles/:id` | 200 | `{ message: "Cập nhật chức vụ thành công" }`. |
| `DELETE /roles/:id` | 200 | `{ message: "Xóa chức vụ thành công" }`. |
| `PATCH /roles/:id/restore` | 200 | `{ message: "Khôi phục chức vụ thành công" }`. |
| `POST /branches` | 201 | `{ message: "Thêm mới chi nhánh thành công", branchId: number }`. |
| `GET /branches` | 200 | Danh sách phân trang; `data[]`: bản ghi `branches` (`id`, `name`, `address`, `bank_name`, `bank_code`, `bank_account_no`, `bank_account_name`, `payment_provider`, `payment_api_key`, `payment_client_id`, audit). **Có thể chứa khóa thanh toán nhạy cảm.** |
| `GET /branches/:id` | 200 | `{ message: "Lấy chi tiết chi nhánh thành công", data: Branch }`; cùng field list, bao gồm khóa thanh toán nếu có. Chỉ MANAGER; đã xóa/không tồn tại `404`. |
| `PUT /branches/:id` | 200 | `{ message: "Cập nhật chi nhánh thành công" }`. |
| `DELETE /branches/:id` | 200 | `{ message: "Xóa chi nhánh thành công" }`. |
| `PATCH /branches/:id/restore` | 200 | `{ message: "Khôi phục chi nhánh thành công" }`. |
| `POST /staffs` | 201 | `{ message: "Tạo hồ sơ nhân viên thành công", staffId: number }`. |
| `GET /staffs` | 200 | Danh sách phân trang; `data[]`: bản ghi `staffs` (`id`, `fullname`, `phone_number`, `address`, `role_id`, `branch_id`, audit) cộng `role_name`, `branch_name` (LEFT JOIN, có thể `null`). |
| `GET /staffs/:id` | 200 | `{ message: "Lấy chi tiết hồ sơ nhân viên thành công", data: Staff }`; cùng field list; STAFF chỉ xem branch token. Đã xóa/khác branch/không tồn tại `404`. |
| `PUT /staffs/:id` | 200 | `{ message: "Cập nhật hồ sơ thành công" }`. |
| `DELETE /staffs/:id` | 200 | `{ message: "Xóa hồ sơ nhân viên thành công" }`. |
| `PATCH /staffs/:id/restore` | 200 | `{ message: "Khôi phục hồ sơ thành công" }`. |
| `POST /customers/reset-password` | 200 | `{ message: "Đổi mật khẩu thành công" }`. |
| `POST /customers` | 201 | `{ message: "Thêm mới khách hàng thành công", customerId: number }`. |
| `GET /customers` | 200 | Danh sách phân trang; `data[]`: `{ id, fullname, phone_number, avatar, address, wallet_balance, total_debt, note, created_at, updated_at }` (không có password). |
| `GET /customers/:id` | 200 | `{ message: "Lấy thông tin khách hàng thành công", data: { id, fullname, phone_number, avatar, address, wallet_balance, total_debt, note, created_at, updated_at, created_by, updated_by } }`. |
| `PUT /customers/:id` | 200 | `{ message: "Cập nhật thông tin khách hàng thành công" }`. |
| `DELETE /customers/:id` | 200 | `{ message: "Xóa khách hàng thành công" }`. |
| `PATCH /customers/:id/restore` | 200 | `{ message: "Khôi phục khách hàng thành công" }`. |

Các GET danh sách trong bảng này sử dụng message theo controller: `/tenants`: `Lấy danh sách Spa thành công`; `/users`: `Lấy danh sách tài khoản thành công`; các danh mục còn lại: `Lấy danh sách thành công`. `POST /customers/reset-password` cần JWT của MANAGER và lấy tenant từ token.

### Sản phẩm, nhập kho, phiếu chi

| Endpoint | HTTP | Response thành công |
|---|---:|---|
| `POST /products` | 201 | `{ message: "Tạo sản phẩm/dịch vụ thành công", productId: number }`. MANAGER/STAFF; chỉ MANAGER được gửi cấu hình công ca. |
| `GET /products` | 200 | Danh sách phân trang với `message: "Lấy danh sách thành công"`; `data[]`: bản ghi `products` (ngoại trừ `is_active`) cộng `commissions[]`, `commission_tiers[]`, `inventory[]` như mô tả dưới bảng. MANAGER/STAFF. |
| `GET /products/:id` | 200 | `{ message: "Lấy chi tiết sản phẩm thành công", data: Product }`; cùng cấu trúc item danh sách. MANAGER/STAFF. |
| `PUT /products/:id` | 200 | `{ message: "Cập nhật sản phẩm/dịch vụ thành công" }`. MANAGER/STAFF; chỉ MANAGER được sửa cấu hình công ca. |
| `DELETE /products/:id` | 200 | `{ message: "Xóa sản phẩm/dịch vụ thành công" }`. MANAGER/STAFF. |
| `PATCH /products/:id/restore` | 200 | `{ message: "Khôi phục sản phẩm/dịch vụ thành công" }`. MANAGER/STAFF. |
| `POST /inventory-imports` | 201 | `{ message: "Tạo phiếu nhập kho thành công", inventoryImportId: number, totalAmount: number }`. |
| `GET /inventory-imports` | 200 | Danh sách phân trang, `message: "Lấy danh sách thành công"`; `data[]`: toàn bộ cột `inventory_imports` (`id`, `branch_id`, `import_code`, `import_date`, `supplier_name`, `total_amount`, `note`, audit), `branch_name`, **`items[]`**. Mỗi item: `{ id, inventory_import_id, product_id, product_name, quantity, unit_price, discount_percent, discount_amount, total_price }`. |
| `GET /inventory-imports/:id` | 200 | `{ message: "Lấy chi tiết phiếu nhập kho thành công", data: InventoryImport }`; header và `items[]` như item list. STAFF có branch token chỉ xem phiếu tại branch đó; ID sai `400`, không tồn tại/đã xóa/khác branch `404`. |
| `PUT /inventory-imports/:id` | 200 | `{ message: "Cập nhật phiếu nhập kho thành công", totalAmount: number }`; không trả ID/item. |
| `DELETE /inventory-imports/:id` | 200 | `{ message: "Xóa phiếu nhập kho và trừ kho thành công" }`. |
| `POST /expenses` | 201 | `{ message: "Tạo phiếu chi thành công", expenseId: number, amount: number }`. |
| `GET /expenses` | 200 | Danh sách phân trang, `message: "Lấy danh sách thành công"`; `data[]`: header `expense_vouchers` (`id`, `branch_id`, `amount`, `expense_type`, `note`, `expense_date`, audit), `branch_name` và `items[]` của `expenses_vouchers_items`. |
| `GET /expenses/:id` | 200 | `{ message: "Lấy chi tiết phiếu chi thành công", data: Expense }`; `Expense` cùng cấu trúc item danh sách. |
| `PUT /expenses/:id` | 200 | `{ message: "Cập nhật phiếu chi thành công" }` hoặc `{ message: "Không có dữ liệu nào được cập nhật." }` khi body không có field để sửa. |
| `DELETE /expenses/:id` | 200 | `{ message: "Xóa phiếu chi thành công" }`. |

`Product` có `id`, `name`, `images` (JSON từ DB, có thể `null`), `description`, `benefits`, `price`, `unit`, `is_product`, `is_treatment_combo`, `default_sessions`, `session_unit`, `next_appointment_days` và audit; **không có `is_active`**. `commissions[]` (mức dự phòng): `{ id, product_id, role_id, commission_percent, commission_fixed_amount, role_name }`. `commission_tiers[]`: `{ id, product_id, role_id, min_price, max_price, calculation_type, fixed_amount, percent, created_at, created_by, role_name }`. `inventory[]`: `{ id, product_id, branch_id, quantity, branch_name }`. Mảng rỗng khi không có cấu hình/bản ghi; với STAFF có `branch_id`, chỉ `inventory[]` được lọc theo branch token (không lọc `commissions[]`, `commission_tiers[]` hay danh sách product). Dữ liệu giá/hoa hồng/tồn kho từ MySQL có thể là chuỗi số; kiểm tra theo schema và không cộng chuỗi trực tiếp.

### Hóa đơn, lịch hẹn, booking

| Endpoint | HTTP | Response thành công |
|---|---:|---|
| `POST /invoices` | 201 | `{ message: "Tạo hóa đơn thành công", invoiceId: number, totalAmount: number, debtAmount: number, walletUsed: number, itemMappings: { request_index: number, invoice_item_id: number, treatment_id: number \| null }[] }`. `request_index` là vị trí 0-based trong `items` của POST. |
| `GET /invoices` | 200 | Danh sách phân trang, `message: "Lấy danh sách thành công"`; `data[]`: toàn bộ `invoices` (`id`, `customer_id`, `branch_id`, `total_amount`, `discount_percent`, `discount_amount`, `paid_amount`, `wallet_used`, `debt_amount`, `payment_method`, `note`, `invoice_date`, audit) cộng `branch_name`, `customer_name`, `phone_number`. **Không có `items` trong list**. |
| `GET /invoices/:id` | 200 | `{ message: "Lấy chi tiết hóa đơn thành công", data: InvoiceDetail }`; header cùng field list, thêm `items[]` là bản ghi `invoice_items` (gồm `id`, `invoice_id`, `product_id`, `snapshot_name`, `snapshot_price`, `quantity`, `discount_percent`, `discount_amount`, `final_price`, audit). Mỗi item có `consultants[]`: toàn bộ cột `invoice_item_consultants` (gồm `id`, `invoice_item_id`, `staff_id`, `revenue_amount`, `role_type`, audit) cộng `staff_name` (có thể `null`). Nếu không có item: `items: []`. |
| `PUT /invoices/:id` | 200 | `{ message: "Cập nhật hóa đơn thành công", totalAmount: number, debtAmount: number }`; không trả `invoiceId` hoặc `walletUsed`. |
| `DELETE /invoices/:id` | 200 | `{ message: "Xóa hóa đơn thành công (Đã hoàn trả công nợ, ví tiền và thu hồi liệu trình)" }`. |
| `POST /appointments` | 201 | `{ message: "Tạo lịch hẹn thành công", appointmentId: number }`. |
| `GET /appointments` | 200 | Danh sách phân trang, `message: "Lấy danh sách lịch hẹn thành công"`; item là bản ghi `appointments` (`id`, `customer_id`, `branch_id`, `appointment_date`, `note`, audit) cộng `customer_name`, `phone_number`, `branch_name` và **`status` tính tại thời điểm đọc**. |
| `GET /appointments/tomorrow` | 200 | Cùng envelope/item GET list, `message: "Lấy danh sách khách hẹn ngày mai thành công"`; chỉ lịch hẹn ngày mai (theo ngày DB). |
| `GET /appointments/not-arrived` | 200 | Cùng envelope/item GET list, `message: "Lấy danh sách khách chưa đến thành công"`; lịch hẹn đến hết hôm nay, trạng thái tính được là `Khách chưa đến`. |
| `GET /appointments/:id` | 200 | `{ message: "Lấy chi tiết lịch hẹn thành công", data: Appointment }`; cùng field item list, `status` được tính lại, không dùng trạng thái lưu ở DB. |
| `PUT /appointments/:id` | 200 | `{ message: "Cập nhật lịch hẹn thành công" }` hoặc `{ message: "Không có dữ liệu nào được cập nhật." }` nếu không gửi field có thể sửa. |
| `DELETE /appointments/:id` | 200 | `{ message: "Xóa lịch hẹn thành công" }`. |
| `GET /customer-bookings` | 200 | Danh sách phân trang, `message: "Lấy danh sách booking khách hàng thành công"`; `data[]`: toàn bộ `customer_bookings` (`id`, `customer_id`, `customer_name`, `customer_phone`, `branch_id`, `product_id`, `booking_time`, `note`, `status`, audit) cộng `branch_name`, `product_name`, `registered_customer_name`, `registered_customer_phone`. Các field từ LEFT JOIN có thể `null`. |
| `GET /customer-bookings/:id` | 200 | `{ message: "Lấy chi tiết booking khách hàng thành công", data: CustomerBooking }`; cùng field list, STAFF chỉ xem branch token. ID sai `400`, không tồn tại/đã xóa/khác branch `404`. |

Ở `GET /invoices` và chi tiết, `payment_method` được bỏ hậu tố legacy `[WALLET:n]`; tiền ví đọc từ `wallet_used`. Booking Rosa có POST/GET danh sách và GET/PUT/DELETE chi tiết; xem `docs/ROSA_CUSTOMER_BOOKINGS_API.md`. Dữ liệu list/chi tiết không mặc nhiên cùng cấu trúc (đặc biệt `items`, `consultants` hóa đơn).

### Nạp ví, thu nợ

| Endpoint | HTTP | Response thành công |
|---|---:|---|
| `POST /customer-wallet-logs` | 201 | `{ message: "Nạp ví khách hàng thành công", walletLogId: number, paidAmount: number, bonusPercent: number, bonusAmount: number, totalReceived: number, walletBalance: number }`. Các giá trị camelCase là kết quả tính sau khi cộng ví. |
| `GET /customer-wallet-logs` | 200 | Danh sách phân trang, `message: "Lấy lịch sử nạp ví thành công"`; `data[]`: toàn bộ `customer_wallet_logs` (`id`, `customer_id`, `branch_id`, `paid_amount`, `bonus_percent`, `bonus_amount`, `total_received`, `payment_method`, `note`, audit) cộng `customer_name`, `phone_number`, `branch_name` (LEFT JOIN, có thể `null`). |
| `GET /customer-wallet-logs/:id` | 200 | `{ message: "Lấy chi tiết giao dịch nạp ví thành công", data: WalletLog }`; cùng cấu trúc item danh sách. |
| `PUT /customer-wallet-logs/:id` | 200 | `{ message: "Cập nhật giao dịch nạp ví thành công", walletLogId: number, customerId: number, branchId: number, paidAmount: number, bonusPercent: number, bonusAmount: number, totalReceived: number, walletBalance: number }`. |
| `DELETE /customer-wallet-logs/:id` | 200 | `{ message: "Xóa giao dịch nạp ví thành công", walletLogId: number, walletBalance: number }`; số dư sau hoàn tác. |
| `GET /debt-payments/invoices/:invoiceId/remaining-debt` | 200 | `{ message: "Lấy công nợ còn lại của hóa đơn thành công", data: { invoiceId: number, customerId: number, branchId: number, invoiceDebtAmount: number, paidDebtAmount: number, remainingDebtAmount: number } }`. Đây là số dư **một hóa đơn**, không phải tổng nợ khách. |
| `POST /debt-payments` | 201 | `{ message: "Ghi nhận thu nợ thành công", debtPaymentId: number, customerId: number, branchId: number, collectionBranchId: number, invoiceId: number, amount: number, totalDebt: number }`; `totalDebt` là tổng công nợ khách sau thu. |
| `GET /debt-payments` | 200 | Danh sách phân trang, `message: "Lấy danh sách phiếu thu nợ thành công"`; `data[]`: toàn bộ `debt_payments` (`id`, `customer_id`, `branch_id`, `collection_branch_id`, `invoice_id`, `amount`, `payment_method`, `payment_date`, `note`, audit) cộng `customer_name`, `phone_number`, `branch_name`, `collection_branch_name`. |
| `GET /debt-payments/:id` | 200 | `{ message: "Lấy chi tiết phiếu thu nợ thành công", data: DebtPaymentDetail }`; cùng field item list, **thêm** `invoice_total_amount`, `invoice_debt_amount` (LEFT JOIN invoice, có thể `null`). |
| `PUT /debt-payments/:id` | 200 | `{ message: "Cập nhật phiếu thu nợ thành công", debtPaymentId: number, customerId: number, branchId: number, collectionBranchId: number, invoiceId: number, amount: number, totalDebt: number }`. |
| `DELETE /debt-payments/:id` | 200 | `{ message: "Xóa phiếu thu nợ thành công", debtPaymentId: number, totalDebt: number }`; `totalDebt` sau khi cộng lại tiền nợ khách. |

`branchId` của phiếu thu là chi nhánh hạch toán thuộc hóa đơn; `collectionBranchId` là chi nhánh thực thu. Trong GET, các key tương ứng là `branch_id` và `collection_branch_id`. Không lấy `walletBalance` từ GET nạp ví: GET chứa log, còn số dư hiện tại của khách lấy từ `/customers/:id`.

### Liệu trình và báo cáo

| Endpoint | HTTP | Response thành công |
|---|---:|---|
| `GET /treatments` | 200 | Danh sách phân trang, `message: "Lấy danh sách liệu trình thành công"`; `data[]`: toàn bộ `treatments` (`id`, `customer_id`, `product_id`, `invoice_id`, `total_sessions`, `remaining_sessions`, `note`, audit) cộng `customer_name`, `phone_number`, `product_name`, `branch_id` (từ hóa đơn gốc, `null` nếu thẻ thủ công). **Không có `histories` trong list.** |
| `GET /treatments/:id` | 200 | `{ message: "Lấy chi tiết liệu trình thành công", data: TreatmentDetail }`; cùng field item list, thêm `histories[]`. Mỗi history là bản ghi `treatment_history` (`id`, `treatment_id`, `branch_id`, `execution_date`, audit) cộng `staffs[]`. Mỗi staff là bản ghi `treatment_history_staffs` (gồm `id`, `treatment_history_id`, `staff_id`, `commission_amount_snapshot`, audit) cộng `staff_name`. Mảng rỗng khi chưa có lịch sử/nhân viên. |
| `POST /treatments` | 201 | `{ message: "Tạo thẻ liệu trình thủ công thành công", treatmentId: number }`. |
| `POST /treatments/execute` | 201 | `{ message: "Đã trừ 1 buổi liệu trình thành công", treatmentHistoryId: number }`. |
| `PUT /treatments/execute/:historyId/staffs` | 200 | `{ message: "Đã cập nhật danh sách nhân viên thực hiện thành công" }`. |
| `DELETE /treatments/execute/:historyId` | 200 | `{ message: "Xóa lịch sử thực hiện và cộng lại 1 buổi thành công" }`. |

| `GET /treatments/commissions` | 200 | Danh sách phân trang, `message: "Lấy danh sách hoa hồng nhân viên thành công"`; `data[]`: `{ id, treatment_history_id, commission_amount, created_at, execution_date, branch_id, branch_name, staff_id, staff_name, role_name, product_id, product_name, customer_name }`. Mỗi dòng là một lần phân công, không phải tổng tiền. |
| `GET /reports/revenue` | 200 | `{ message: "Lấy báo cáo thành công", period, serviceRevenue, productRevenue, totalRevenue, receipts, expenses, netCashFlow, daily: DailyRevenue[] }`; **không** có `data`/phân trang. `daily[]` trả từng ngày trong khoảng lọc, gồm cả ngày 0, cùng cấu trúc tiền với tổng kỳ và thêm `date`; xem ví dụ ở mục báo cáo bên trên. |
| `GET /reports/details/:type` | 200 | `{ message: "Lấy báo cáo thành công", type, period, page, pageSize, total, totalAmount, totalPages, data: ReportRow[] }`; `totalAmount` là number tổng tiền toàn kỳ theo bộ lọc (không phụ thuộc trang); `ReportRow` thay đổi theo `type`, xem ví dụ đầy đủ 7 loại trong mục báo cáo. Không có `data` của trang sau nếu hết trang (`[]`). |
| `GET /reports/commissions` | 200 | `{ message: "Lấy báo cáo thành công", period, totalAmount, total, page, pageSize, totalPages, staffTotals: StaffTotal[] }`; `StaffTotal`: `{ branch_id, branch_name, staff_id, staff_name, total_amount, record_count }`. `totalAmount` là tổng **toàn bộ phạm vi lọc**, không chỉ trang hiện tại. |
| `GET /reports/consultants` | 200 | Cùng envelope và cấu trúc `StaffTotal[]` như `/reports/commissions`; tiền tư vấn thay vì hoa hồng. |
| `GET /reports/products` | 200 | `{ message: "Lấy báo cáo thành công", period, totalRevenue, total, page, pageSize, totalPages, data: ProductRevenue[] }`; mỗi dòng có `product_id`, `product_name`, `is_product`, `invoice_count`, `item_count`, `quantity`, `item_total`, `revenue`. Tổng tiền dạng number trên toàn kỳ. |
| `GET /reports/products/:productId/invoices` | 200 | `{ message: "Lấy báo cáo thành công", period, product, invoiceCount, quantity, itemTotal, revenue, total, page, pageSize, totalPages, data: InvoiceItemSale[] }`; `data[]` gồm `invoice_item_id`, `invoice_id`, thông tin ngày/chi nhánh/khách, `snapshot_name`, `snapshot_price`, `quantity`, chiết khấu dòng, `final_price`, `revenue`. Một dòng trên mỗi item bán ra. |

`POST /treatments/execute` chỉ tự tạo lịch hẹn tiếp theo khi `next_appointment_days > 0` và thẻ vẫn còn buổi sau khi trừ. `treatment_history.appointment_id` lưu ID lịch hẹn tự tạo (`null` khi không tạo). `DELETE /treatments/execute/:historyId` xóa mềm cả lịch hẹn liên kết (nếu chưa bị xóa) trong cùng transaction với việc hoàn buổi/xóa lịch sử; không xóa lịch hẹn thủ công. Với history cũ trước migration, `appointment_id` là `null`, nên lịch cũ không tự xóa: không thể xác định quan hệ này an toàn từ dữ liệu hiện có.

Các GET reports dùng query `startDate`/`endDate` bắt buộc và đều chỉ dành cho MANAGER. `period` chứa `startDate`, `endDate`, `branchId` (có thể `null`); báo cáo nhân sự với filter `staffId` còn thêm `period.staffId`. `totalAmount` ở báo cáo nhân sự là number, nhưng `commission_amount_snapshot` của GET `/treatments/commissions` là DECIMAL từ DB (thường là chuỗi). Riêng `/reports/revenue` không có `page`, `pageSize` hay `totalPages`.
