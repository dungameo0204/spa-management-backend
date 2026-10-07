# Tài liệu API cho Frontend — Spa Management Backend

> Tài liệu được tổng hợp từ mã nguồn trong `src/` và hai schema `db_system_master.sql`, `db_spa_template.sql`; mục thu nợ cập nhật **06/10/2026**. Schema tenant cũ phải được migration trước khi dùng API thu nợ mới.

## 1. Tổng quan

- Stack: Node.js, Express 5, MySQL (`mysql2`), JWT, bcrypt.
- Nội dung JSON: gửi header `Content-Type: application/json`.
- CORS đang mở cho mọi origin (`cors()`).
- URL gốc cục bộ: `http://localhost:<PORT>`, trong đó `PORT` lấy từ biến môi trường, mặc định là `5000`.
- Ví dụ dưới đây dùng: `http://localhost:5000`.
- API không triển khai phân trang. Tất cả API danh sách trả toàn bộ kết quả phù hợp.

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
| `STAFF` | Có thể gọi API staff/customer do route hiện chỉ kiểm tra token; nghiệp vụ staff bị giới hạn theo `branch_id` ở một số thao tác. |

> Lưu ý: Route `/api/staffs` chỉ dùng `verifyToken`, **không** dùng `verifyManager`. Vì vậy STAFF có thể gọi các API này; service tự giới hạn dữ liệu/thao tác theo chi nhánh trong một số trường hợp.

### 2.3. Mã lỗi xác thực chung

| Tình huống | HTTP | Response |
|---|---:|---|
| Thiếu `Authorization: Bearer ...` | 401 | `{ "message": "Từ chối truy cập! Không tìm thấy Token xác thực." }` |
| Token sai/hết hạn | 403 | `{ "message": "Token không hợp lệ hoặc đã hết hạn." }` |
| Không phải `SUPER_ADMIN`/`MANAGER` | 403 | `{ "message": "..." }` |

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
  "data": []
}
```

## 4. Danh sách nhanh API đang được mount

Tại thời điểm hiện tại, `src/server.js` mount các endpoint hoạt động sau:

| Nhóm | Endpoint |
|---|---|
| Auth | `POST /api/auth/login` |
| Tenant | `POST /api/tenants/create`, `GET /api/tenants`, `PUT /api/tenants/:id`, `DELETE /api/tenants/:id`, `PATCH /api/tenants/:id/restore` |
| User | `POST /api/users/create`, `GET /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, `PATCH /api/users/:id/restore` |
| Role | `POST/GET /api/roles`, `PUT/DELETE /api/roles/:id`, `PATCH /api/roles/:id/restore` |
| Staff | `POST/GET /api/staffs`, `PUT/DELETE /api/staffs/:id`, `PATCH /api/staffs/:id/restore` |
| Branch | `POST/GET /api/branches`, `PUT/DELETE /api/branches/:id`, `PATCH /api/branches/:id/restore` |
| Customer | `POST /api/customers/reset-password`, `POST/GET /api/customers`, `GET/PUT/DELETE /api/customers/:id`, `PATCH /api/customers/:id/restore` |
| Product | `POST/GET /api/products`, `GET /api/products/:id`, `PUT/DELETE /api/products/:id`, `PATCH /api/products/:id/restore` |
| Inventory import | `POST/GET /api/inventory-imports`, `PUT/DELETE /api/inventory-imports/:id` |
| Expense | `POST/GET /api/expenses`, `GET /api/expenses/:id`, `PUT/DELETE /api/expenses/:id` |
| Invoice | `POST/GET /api/invoices`, `GET /api/invoices/:id`, `PUT/DELETE /api/invoices/:id` |
| Appointment | `POST/GET /api/appointments`, `GET /api/appointments/tomorrow`, `GET /api/appointments/not-arrived`, `GET /api/appointments/:id`, `PUT/DELETE /api/appointments/:id` |
| Customer booking | `GET /api/customer-bookings` |
| Customer wallet log | `POST/GET /api/customer-wallet-logs`, `GET/PUT/DELETE /api/customer-wallet-logs/:id` |
| Debt payment | `POST/GET /api/debt-payments`, `GET/PUT/DELETE /api/debt-payments/:id`, `GET /api/debt-payments/invoices/:invoiceId/remaining-debt` |
| Treatment | `POST /api/treatments`, `POST /api/treatments/execute`, `DELETE /api/treatments/execute/:historyId`, `PUT /api/treatments/execute/:historyId/staffs`, `GET /api/treatments/commissions` |

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

- Thất bại: `400` khi thiếu username/password; `401` khi không tồn tại, bị xóa mềm hoặc sai mật khẩu.
- Frontend lưu `data.token`; password không được trả về.

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
| `spaName` | Có | Tên Spa. |
| `managerUsername` | Có | Unique toàn bảng `db_system_master.users`. |
| `managerPassword` | Có | Backend băm bcrypt trước khi lưu. |
| `managerFullname` | Có | Họ tên tài khoản MANAGER đầu tiên. |
| `years` | Không | Chuỗi `'lifetime'` thì không hết hạn; giá trị khác được `parseInt`, mặc định 1 năm nếu không parse được. |

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

### `GET /api/tenants?search=<keyword>` — Danh sách Spa

- `search` không bắt buộc; tìm theo `spa_name`, `manager_username`, `manager_fullname`.
- Chỉ trả tenant chưa xóa; join user quản lý chưa xóa.
- Thành công `200`, mỗi phần tử `data` có: `tenant_id`, `spa_name`, `database_name`, `expire_at`, `created_at`, `manager_username`, `manager_fullname`.

### `PUT /api/tenants/:id` — Cập nhật Spa

Body (gửi một hoặc cả hai field):

```json
{ "spaName": "Spa Ngọc Lan - Quận 1", "expireAt": "2027-12-31 23:59:59" }
```

- `spaName`: string.
- `expireAt`: date-time hoặc `null` để chuyển sang không thời hạn.
- Thành công `200`: `{ "message": "Cập nhật thông tin Spa thành công!", "data": { "id": "7", "spa_name": "...", "expire_at": "..." } }`.

### `DELETE /api/tenants/:id` — Vô hiệu hóa Spa

- Xóa mềm tenant **và toàn bộ user thuộc tenant** trong master DB.
- Thành công `200`: `{ "message": "Đã xóa (vô hiệu hóa) Spa thành công!" }`.

### `PATCH /api/tenants/:id/restore` — Khôi phục Spa

- Gỡ xóa mềm tenant và toàn bộ user thuộc tenant.
- Thành công `200`: `{ "message": "Đã khôi phục Spa thành công! Các tài khoản đã có thể đăng nhập lại." }`.

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

- Không được tự đổi `systemRole` của chính tài khoản đang đăng nhập.
- **Quan trọng:** service hiện luôn kiểm tra `branchId` bằng database trước khi update. Vì vậy frontend nên luôn gửi `branchId` hợp lệ, kể cả khi chỉ đổi username/password/fullname. Gửi `branchId: null` hoặc bỏ field có thể bị lỗi `Cơ sở/Chi nhánh không tồn tại hoặc đã bị đóng cửa!`.
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

## 11. Khách hàng `/api/customers`

### `POST /api/customers/reset-password` — Public

Không cần token.

```json
{
  "tenantId": 3,
  "phone_number": "0900000000",
  "new_password": "new-secret"
}
```

- Cả ba field đều bắt buộc.
- Backend tìm customer chưa xóa theo `tenantId + phone_number`, băm `new_password` bằng bcrypt.
- Thành công `200`: `{ "message": "Đổi mật khẩu thành công" }`.
- **Cảnh báo bảo mật:** API hiện không có OTP/xác minh số điện thoại; bất kỳ client nào biết `tenantId` và số điện thoại đều có thể gọi đổi mật khẩu. Frontend không nên coi đây là luồng quên mật khẩu an toàn nếu chưa bổ sung xác minh ở backend.

### `POST /api/customers` — Cần token

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
- `password` không bắt buộc; nếu có thì được bcrypt hash. Nếu không, customer phải gọi reset-password để thiết lập mật khẩu cho MiniApp.
- `phone_number` unique trên customer chưa xóa trong tenant.
- Thành công `201`: `{ "message": "Thêm mới khách hàng thành công", "customerId": 10 }`.

### `GET /api/customers?search=<keyword>` — Cần token

- `search` tìm `fullname` hoặc `phone_number`.
- Mỗi item trả: `id`, `fullname`, `phone_number`, `avatar`, `address`, `wallet_balance`, `total_debt`, `note`, `created_at`, `updated_at`.
- Không bao giờ trả `password`.

### `GET /api/customers/:id` — Cần token

- Lấy thông tin một khách hàng active trong tenant đang đăng nhập.
- Trả: `id`, `fullname`, `phone_number`, `avatar`, `address`, `wallet_balance`, `total_debt`, `note`, `created_at`, `updated_at`, `created_by`, `updated_by`.
- Không bao giờ trả `password`.
- Không tồn tại hoặc đã soft-delete trả `404`.

### `PUT /api/customers/:id` — Cần token

Body hỗ trợ: `fullname`, `phone_number`, `password`, `avatar`, `address`, `note`.

- `fullname`/`phone_number` nếu gửi không được là chuỗi rỗng.
- `phone_number` mới sẽ được kiểm tra trùng.
- `password` chỉ cập nhật khi là chuỗi không rỗng; backend băm bcrypt.
- Các field `avatar`, `address`, `note` gửi `""`/`null` sẽ thành `null`.
- Thành công `200`: `{ "message": "Cập nhật thông tin khách hàng thành công" }`.

### `DELETE /api/customers/:id` / `PATCH /api/customers/:id/restore` — Cần token

- Xóa mềm/khôi phục customer.
- Thành công tương ứng: `Xóa khách hàng thành công`, `Khôi phục khách hàng thành công`.

---

## 12. Sản phẩm/Dịch vụ `/api/products` (chỉ `MANAGER`)

Mọi endpoint trong mục này yêu cầu Bearer token của MANAGER. Product được tạo trong **một transaction** cùng cấu hình hoa hồng/tồn kho ban đầu (nếu có); nếu một bước lỗi thì toàn bộ thao tác bị rollback.

### `POST /api/products`

```json
{
  "name": "Serum phục hồi da",
  "images": ["https://example.com/serum-1.jpg"],
  "description": "Mô tả sản phẩm",
  "benefits": "Phục hồi, dưỡng ẩm",
  "price": 450000,
  "unit": "chai",
  "is_product": true,
  "is_treatment_combo": false,
  "default_sessions": 1,
  "session_unit": "buổi",
  "next_appointment_days": 0,
  "commissions": [
    { "role_id": 2, "commission_percent": 10, "commission_fixed_amount": 0 }
  ],
  "inventory": [
    { "branch_id": 1, "quantity": 20 },
    { "branch_id": 2, "quantity": 10 }
  ]
}
```

| Field | Bắt buộc | Quy tắc |
|---|---:|---|
| `name`, `price`, `is_product` | Có | Tên unique trong product chưa xóa; `price >= 0`; `is_product` nhận boolean hoặc `0/1`. |
| `images` | Không | Mảng JSON hoặc `null`. |
| `description`, `benefits`, `unit` | Không | Chuỗi; rỗng được lưu `null`. |
| `is_treatment_combo`, `default_sessions`, `session_unit`, `next_appointment_days` | Không | Default theo schema; hai field số buổi/ngày là số nguyên `>= 0`. |
| `commissions` | Không | Có thể bỏ qua, gửi `null` hoặc `[]` nếu sản phẩm/dịch vụ không áp dụng hoa hồng. Nếu gửi dòng `{ role_id, commission_percent?, commission_fixed_amount? }`, `role_id` không lặp, role phải active, percent 0–100. |
| `inventory` | Không | Dùng cho tồn đầu kỳ. Có thể bỏ qua, gửi `null` hoặc `[]` — phù hợp với dịch vụ hoặc hàng hóa sẽ nhập kho sau. Nếu gửi dòng `{ branch_id, quantity }`, `branch_id` không lặp, branch phải active, quantity là số nguyên `>= 0`. |

Thành công `201`: `{ "message": "Tạo sản phẩm/dịch vụ thành công", "productId": 12 }`.

### 1. Lấy danh sách Sản phẩm / Dịch vụ
**`GET /api/products?search=&is_product=`**

- `search`: Tìm kiếm theo tên sản phẩm (chuỗi con, không phân biệt hoa/thường).
- `is_product`: Gửi `0` (Dịch vụ) hoặc `1` (Sản phẩm vật lý) để lọc.
- **Lưu ý:** Đã loại bỏ hoàn toàn tham số `is_active` khỏi request và response (trạng thái dựa vào xóa mềm `deleted_at`).
- **Response:** Trả về danh sách products, mỗi product kèm theo 2 mảng:
  - `commissions`: Chiết khấu hoa hồng (kèm `role_name`).
  - `inventory`: Số lượng tồn kho (kèm `branch_name`).
- **Phân quyền hiển thị:**
  - **Manager (Quản lý):** Xem được tồn kho (`inventory`) ở TẤT CẢ chi nhánh.
  - **Staff (Nhân viên):** Chỉ xem được tồn kho (`inventory`) tại cơ sở mà nhân viên đó đang làm việc.

---

### 2. Lấy chi tiết một Sản phẩm / Dịch vụ
**`GET /api/products/:id`**

- **URL Params:** `id` - ID của sản phẩm cần lấy chi tiết.
- **Quyền truy cập:** Dành cho cả Manager và Staff.
- **Response:** Trả về Object thông tin chi tiết của 1 sản phẩm (không chứa `is_active`), kèm mảng `commissions` và mảng `inventory`. (Logic phân quyền hiển thị tồn kho chi nhánh áp dụng tương tự như API Lấy danh sách).

### `PUT /api/products/:id`

- Partial update: `name`, `images`, `description`, `benefits`, `price`, `unit`, `is_product`, `is_treatment_combo`, `default_sessions`, `session_unit`, `next_appointment_days`.
- `is_active` là cột legacy trong schema và bị API Product bỏ qua khi create/update; trạng thái sử dụng product được quản lý bằng xóa mềm (`deleted_at`).
- Nếu gửi `commissions`, backend đồng bộ toàn bộ danh sách: role không còn trong body bị xóa mềm, role trong body được tạo/cập nhật. Có thể gửi `[]` để xóa hết commission.
- API này không nhận `inventory`, để không điều chỉnh tồn kho không có chứng từ. Dùng `POST /api/inventory-imports` để tăng tồn.
- Thành công `200`: `{ "message": "Cập nhật sản phẩm/dịch vụ thành công" }`.

### `DELETE /api/products/:id` / `PATCH /api/products/:id/restore`

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
Trả header (kèm `branch_name`) và `items` snapshot.

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
  "amount": 500000,
  "expense_type": "Thanh toán tiền điện",
  "note": "Tiền điện tháng 9",
  "expense_date": "2026-10-04 10:00:00"
}
```

| Field | Bắt buộc | Quy tắc |
|---|:---:|---|
| `amount` | Có | Số tiền chi >= 0. |
| `expense_type` | Có | Loại phiếu chi. |
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
- **`GET /api/expenses/:id`**: Lấy chi tiết phiếu.
- **`PUT /api/expenses/:id`**: Cập nhật thông tin phiếu.
- **`DELETE /api/expenses/:id`**: Xóa mềm phiếu chi.

---

## 15. Quản lý Hóa đơn Bán hàng `/api/invoices`

Xử lý giao dịch thanh toán, tự động trừ ví, tính công nợ, chia hoa hồng nhân viên và sinh thẻ liệu trình qua Transaction.
*Lưu ý Phân quyền: STAFF chỉ tạo/xem được hóa đơn ở cơ sở mình, và chỉ được SỬA/XÓA hóa đơn được tạo trong ngày hôm nay.*

### `POST /api/invoices`

```json
{
  "customer_id": 1,
  "branch_id": 1,
  "discount_percent": 10,
  "discount_amount": 0,
  "paid_amount": 1000000,
  "wallet_used": 500000,
  "payment_method": "Ví + Chuyển khoản",
  "note": "Khách dùng 500k trong ví, còn lại nợ",
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
| `paid_amount`, `wallet_used` | Không | Mặc định 0. Backend chặn nếu ví không đủ; `wallet_used` không được lớn hơn `total_amount`; và `paid_amount + wallet_used` không được lớn hơn `total_amount`. `wallet_used` được lưu riêng trên invoice và được trả lại ở API list/detail. |
| `discount_percent`, `discount_amount` | Không | Chiết khấu tổng hóa đơn. |
| `items[].product_id`, `items[].quantity` | Có | Product chưa xóa; quantity là số nguyên `> 0`. |
| `items[].unit_price` | Không | Giá bán một đơn vị do frontend nhập, phải `>= 0`. Nếu không gửi, backend dùng `products.price`. `items[].price` cũng được hỗ trợ như alias tương thích. Giá thực dùng được snapshot vào `invoice_items.snapshot_price`. |
| `items[].discount_percent`, `items[].discount_amount` | Không | Mặc định `0`; backend chặn thành tiền dòng âm. |
| `items[].consultants` | Không | Mảng nhân viên tư vấn/chăm sóc. Mỗi dòng có `staff_id`, `revenue_amount?`, `role_type?`; `revenue_amount` mặc định `0`, phải `>= 0`, và tổng `revenue_amount` của tất cả consultant trong **một item** không được vượt `final_price` của item sau chiết khấu. STAFF chỉ được chọn nhân viên thuộc branch trong token, MANAGER có thể chọn nhân viên branch khác. |

> **Backend tự động:** Tính công nợ, giảm trừ ví, sinh thẻ liệu trình (nếu sp có `is_treatment_combo = 1`).

Backend tự tính `totalAmount`, không tin tổng tiền do frontend tự tính. Điều kiện thanh toán là `0 <= wallet_used <= totalAmount`, `paid_amount >= 0`, và `paid_amount + wallet_used <= totalAmount`; request vượt tổng hóa đơn bị từ chối trước khi trừ ví. Nếu thanh toán đủ thì `paid_amount + wallet_used = totalAmount`; nếu nhỏ hơn, phần thiếu là công nợ. `debtAmount` luôn được tính bằng `totalAmount - paid_amount - wallet_used`; ví dụ `totalAmount: 6.000.000`, `paid_amount: 0`, `wallet_used: 6.000.000` sẽ có `debtAmount: 0`.

Khi gửi `items[].consultants`, backend kiểm tra từng `staff_id` còn hoạt động, `revenue_amount` hợp lệ và tổng tiền chia sale trên từng mặt hàng. Ví dụ item thành tiền `10.000.000` chỉ cho phép chia A `6.000.000` + B `4.000.000` (hoặc thấp hơn), không được vượt `10.000.000`. STAFF còn bị kiểm tra consultant thuộc đúng branch trong token; nếu không hợp lệ request bị từ chối với HTTP `400`.

Hàng hóa (`is_product = 1`) vẫn được phép bán vượt tồn. Nếu branch chưa có bản ghi `inventory` cho product, backend tự tạo dòng inventory với tồn âm (ví dụ bán `2` sẽ tạo `quantity = -2`) để phục vụ đối soát; nếu đã có dòng, tồn kho được trừ bình thường và vẫn có thể âm.

Thành công `201`:
```json
{
  "message": "Tạo hóa đơn thành công",
  "invoiceId": 12,
  "totalAmount": 1350000,
  "debtAmount": 0,
  "walletUsed": 500000
}
```

### `GET /api/invoices`

Query tùy chọn: `search`, `branchId`, `startDate`, `endDate`, `productName`, `minAmount`, `maxAmount`, `hasDebt`.

- `search`: tìm trong ghi chú, tên hoặc số điện thoại khách hàng.
- `branchId`: MANAGER lọc theo cơ sở; STAFF luôn chỉ xem cơ sở trong token.
- `startDate`, `endDate`: lọc theo `invoice_date` (dạng `YYYY-MM-DD`).
- `productName`: tìm theo `invoice_items.snapshot_name`.
- `minAmount`, `maxAmount`: lọc `total_amount`, phải `>= 0`.
- `hasDebt`: `true`/`1` chỉ lấy hóa đơn còn công nợ (`debt_amount > 0`); `false`/`0` chỉ lấy hóa đơn không còn công nợ (`debt_amount = 0`). Ví dụ: `GET /api/invoices?hasDebt=true`.
- Thành công `200`: `{ "message": "Lấy danh sách thành công", "total": 1, "data": [ ... ] }`. Mỗi invoice trả `wallet_used` riêng; `payment_method` không chứa số tiền ví.

### `GET /api/invoices/:id`

Lấy header hóa đơn, gồm `paid_amount`, `wallet_used`, `debt_amount`, `branch_name`, `customer_name`, `phone_number`, danh sách `items`, và mỗi item có `consultants`. STAFF không thể lấy hóa đơn cơ sở khác. Thành công `200`: `{ "message": "Lấy chi tiết hóa đơn thành công", "data": { ... } }`; không có quyền/không tồn tại trả `404`.

### `PUT /api/invoices/:id`

Ghi đè **toàn bộ** `items`; body phải gửi `items` theo cấu trúc của POST, trong đó từng item cũng ưu tiên `unit_price` (hoặc `price`) và chỉ fallback `products.price` khi không gửi giá. Các field header có thể gửi: `customer_id`, `discount_percent`, `discount_amount`, `paid_amount`, `wallet_used`, `payment_method`, `note`, `invoice_date`.

Trong một transaction, backend hoàn trả ví/công nợ/tồn kho cũ, xóa mềm item và thẻ liệu trình cũ, sau đó áp dụng hóa đơn mới. Hàng hóa mới cũng dùng cơ chế tồn âm nếu chưa có dòng inventory. Áp dụng cùng các điều kiện thanh toán của POST: `wallet_used` không vượt `totalAmount` và `paid_amount + wallet_used` không được vượt `totalAmount`. Bị chặn nếu thẻ liệu trình từ hóa đơn đã có lịch sử sử dụng **hoặc hóa đơn đã có phiếu thu nợ active**; khi có phiếu thu nợ, API trả lỗi `Không thể sửa hóa đơn đã có phiếu thu nợ.` STAFF chỉ sửa hóa đơn của cơ sở mình được tạo trong ngày hiện tại.

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

Lấy các **lịch hẹn** vào ngày mai theo ngày giờ DB (`CURDATE()`), không phụ thuộc trạng thái. Trả `{ "message": "...", "total": 1, "data": [{ "id": 1, "customer_id": 1, "status": "Khách chưa đến", "customer_name": "...", "phone_number": "...", "branch_name": "..." }] }`. Nhận thêm `branchId`, `search`, `status`, `startDate`, `endDate` như API danh sách. STAFF chỉ thấy branch token.

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

Đây là API quản trị **chỉ đọc** booking do khách tạo từ MiniApp. Backend quản trị không có `POST`, `PUT`, `DELETE` cho resource này; việc khách tạo/sửa/hủy booking thuộc MiniApp.

### `GET /api/customer-bookings`

Query tùy chọn: `search`, `branchId`, `customerId`, `productId`, `status`, `startDate`, `endDate`.

- `search`: tìm gần đúng theo `customer_name`, `customer_phone`, ghi chú hoặc tên dịch vụ đã chọn.
- `branchId`: MANAGER có thể lọc branch; STAFF luôn bị khóa ở branch token.
- `customerId`, `productId`, `status`: lọc khớp chính xác.
- `startDate`, `endDate`: lọc theo `booking_time` dạng `YYYY-MM-DD`.
- Kết quả trả thêm `branch_name`, `product_name`; nếu booking liên kết customer hệ thống thì có thêm `registered_customer_name`, `registered_customer_phone`.
- Thành công `200`: `{ "message": "Lấy danh sách booking khách hàng thành công", "total": 1, "data": [ ... ] }`.

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

Hệ thống tự động sinh thẻ khi item có `is_treatment_combo = 1`; MANAGER cũng có thể tạo thẻ thủ công. Tất cả người dùng đã đăng nhập đều xem được thẻ liệu trình của **mọi cơ sở trong cùng tenant**. STAFF chỉ được tạo/sửa/xóa history tại cơ sở trong token; `branch_id` trong history là cơ sở khách đến làm.

### `GET /api/treatments`

API này hỗ trợ query filter để tìm danh sách thẻ liệu trình. Tất cả query đều không bắt buộc và có thể kết hợp với nhau.

| Query | Kiểu | Mô tả |
|---|---|---|
| `customerId` | number | Lọc theo ID khách hàng (`treatments.customer_id`). |
| `invoiceId` | number | Lọc các thẻ được sinh từ hóa đơn tương ứng (`treatments.invoice_id`). |
| `customerSearch` | string | Tìm gần đúng theo tên hoặc số điện thoại khách hàng. |
| `productSearch` | string | Tìm gần đúng theo tên sản phẩm/dịch vụ. Ví dụ: `productSearch=lông`. |
| `status` | `active` / `completed` | `active`: còn buổi (`remaining_sessions > 0`); `completed`: đã hết buổi (`remaining_sessions = 0`). |
| `startDate` | `YYYY-MM-DD` | Lọc từ ngày tạo thẻ, theo `treatments.created_at`. |
| `endDate` | `YYYY-MM-DD` | Lọc đến ngày tạo thẻ, theo `treatments.created_at`. |
| `branchId` | number | Lọc theo branch của hóa đơn gốc. Thẻ tạo thủ công không có invoice vẫn được bao gồm theo logic hiện tại. |

- `customerSearch` tìm theo tên/số điện thoại; `productSearch` tìm tên dịch vụ.
- `status=active` lọc thẻ còn buổi; `status=completed` lọc thẻ hết buổi.
- `startDate`, `endDate`: lọc ngày tạo thẻ; `invoiceId` lọc toàn bộ thẻ liệu trình được sinh từ một hóa đơn, không phụ thuộc branch của hóa đơn; `branchId` lọc thẻ tạo từ hóa đơn của một cơ sở (thẻ thủ công không có invoice vẫn được bao gồm theo nghiệp vụ hiện tại).
- Thành công `200`: `{ "message": "Lấy danh sách liệu trình thành công", "data": [ ... ] }`.

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
- `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`, `deleted_by`.
- `staffs`: Danh sách nhân viên được gán cho lần thực hiện đó.

Mỗi phần tử trong `histories[].staffs[]` gồm các field của `treatment_history_staffs` và:

- `id`, `treatment_history_id`, `staff_id`.
- `commission_amount_snapshot`: Số tiền hoa hồng đã snapshot tại thời điểm gán nhân viên.
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
            "commission_amount_snapshot": "200000.00"
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
  "invoice_id": null,
  "total_sessions": 10,
  "remaining_sessions": 10,
  "note": "Tặng thêm liệu trình"
}
```

- `customer_id`, `product_id`, `total_sessions` bắt buộc; số buổi là số nguyên và `total_sessions > 0`.
- `remaining_sessions` tùy chọn, mặc định bằng `total_sessions`, không được lớn hơn tổng số buổi.
- Thành công `201`: `{ "message": "Tạo thẻ liệu trình thủ công thành công", "treatmentId": 1 }`.

### `POST /api/treatments/execute`

Trừ một buổi tại cơ sở thực tế khách đến làm.

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
- `execution_date` tùy chọn (mặc định hiện tại). `staffs` tùy chọn; backend lấy role của mỗi staff, tra `product_commissions`, và tự snapshot hoa hồng. Không có cấu hình commission thì hoa hồng bằng `0`.
- Bị chặn nếu thẻ hết buổi. Nếu product có `next_appointment_days` và còn buổi, backend tạo lịch hẹn tiếp theo tại `branch_id` thực hiện.
- Thành công `201`: `{ "message": "Trừ buổi liệu trình thành công", "treatmentHistoryId": 1 }`.

### `PUT /api/treatments/execute/:historyId/staffs`

Gán lại toàn bộ nhân viên cho một history đã trừ buổi.

```json
{ "staffs": [{ "staff_id": 2 }, { "staff_id": 3 }] }
```

`staffs` bắt buộc là mảng và có thể rỗng. Mỗi request luôn xóa mềm các assignment/hoa hồng cũ của history trước khi xử lý danh sách mới:

- Gửi `staffs: [{ "staff_id": 2 }]`: gán lại nhân viên và snapshot lại hoa hồng theo product commission/role hiện tại.
- Gửi `staffs: []`: không gán nhân viên mới; toàn bộ `treatment_history_staffs` hiện có của history bị xóa mềm. Dùng khi không có người thực hiện hoặc cần hủy công/hoa hồng, ví dụ sau khi có khiếu nại.

STAFF chỉ được chỉnh history cùng branch token và chỉ gán staff thuộc branch token; MANAGER không bị giới hạn branch. Khi `staffs: []`, STAFF vẫn phải có quyền trên branch của history.

### `DELETE /api/treatments/execute/:historyId`

Hoàn tác một lần thực hiện: cộng lại một buổi, xóa mềm history và toàn bộ staff/hoa hồng snapshot của history. STAFF chỉ được hoàn tác history tại branch trong token; MANAGER không bị giới hạn branch.

### `GET /api/treatments/commissions`

Báo cáo dòng hoa hồng đã snapshot. Query tùy chọn: `branchId`, `staffName`, `roleName`, `productId`, `startDate`, `endDate`.

- STAFF luôn chỉ xem history và staff thuộc branch trong token; `branchId` gửi lên bị bỏ qua đối với STAFF. MANAGER có thể lọc bằng `branchId`.
- Kết quả sắp xếp theo `branchId`, `staffName`, `staffId`, rồi `commission_amount_snapshot` tăng dần.
- Thành công `200`: `{ "message": "Lấy danh sách hoa hồng nhân viên thành công", "total": 1, "data": [ ... ] }`.

---

## 20. MiniApp (Chưa sử dụng)
Các endpoint `/api/miniapp/*` được định nghĩa nhưng chưa mount trong `src/server.js`.

---

## 21. Database và Lưu ý tích hợp
Xem cấu trúc bảng trong tài liệu đính kèm. Hầu hết API danh mục không trả bản ghi bị `deleted_at IS NOT NULL`.
