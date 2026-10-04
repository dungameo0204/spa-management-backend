# Tài liệu API cho Frontend — Spa Management Backend

> Tài liệu được tổng hợp trực tiếp từ mã nguồn trong `src/` và hai schema `db_system_master.sql`, `db_spa_template.sql` vào ngày **03/10/2026**. Đây là mô tả của hành vi backend hiện có, không phải đặc tả dự kiến.

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

Tại thời điểm hiện tại, `src/server.js` mount **51 endpoint** hoạt động:

| Nhóm | Endpoint |
|---|---|
| Auth | `POST /api/auth/login` |
| Tenant | `POST /api/tenants/create`, `GET /api/tenants`, `PUT /api/tenants/:id`, `DELETE /api/tenants/:id`, `PATCH /api/tenants/:id/restore` |
| User | `POST /api/users/create`, `GET /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, `PATCH /api/users/:id/restore` |
| Role | `POST/GET /api/roles`, `PUT/DELETE /api/roles/:id`, `PATCH /api/roles/:id/restore` |
| Staff | `POST/GET /api/staffs`, `PUT/DELETE /api/staffs/:id`, `PATCH /api/staffs/:id/restore` |
| Branch | `POST/GET /api/branches`, `PUT/DELETE /api/branches/:id`, `PATCH /api/branches/:id/restore` |
| Customer | `POST /api/customers/reset-password`, `POST/GET /api/customers`, `PUT/DELETE /api/customers/:id`, `PATCH /api/customers/:id/restore` |
| Product | `POST/GET /api/products`, `GET /api/products/:id`, `PUT/DELETE /api/products/:id`, `PATCH /api/products/:id/restore` |
| Inventory import | `POST/GET /api/inventory-imports`, `PUT/DELETE /api/inventory-imports/:id` |
| Expense | `POST/GET /api/expenses`, `GET /api/expenses/:id`, `PUT/DELETE /api/expenses/:id` |
| Invoice | `POST/GET /api/invoices`, `GET /api/invoices/:id`, `PUT/DELETE /api/invoices/:id` |
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
  "is_active": true,
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
| `is_treatment_combo`, `default_sessions`, `session_unit`, `next_appointment_days`, `is_active` | Không | Default theo schema; hai field số buổi/ngày là số nguyên `>= 0`. |
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

- Partial update: `name`, `images`, `description`, `benefits`, `price`, `unit`, `is_product`, `is_treatment_combo`, `default_sessions`, `session_unit`, `next_appointment_days`, `is_active`.
- Nếu gửi `commissions`, backend đồng bộ toàn bộ danh sách: role không còn trong body bị xóa mềm, role trong body được tạo/cập nhật. Có thể gửi `[]` để xóa hết commission.
- API này không nhận `inventory`, để không điều chỉnh tồn kho không có chứng từ. Dùng `POST /api/inventory-imports` để tăng tồn.
- Thành công `200`: `{ "message": "Cập nhật sản phẩm/dịch vụ thành công" }`.

### `DELETE /api/products/:id` / `PATCH /api/products/:id/restore`

- Xóa mềm/khôi phục product.
- Thành công: `Xóa sản phẩm/dịch vụ thành công` hoặc `Khôi phục sản phẩm/dịch vụ thành công`.

---

13. Nhập kho /api/inventory-importsTạo phiếu nhập dùng transaction: tạo header, các item snapshot và cập nhật inventory.quantity cùng lúc.Lưu ý Phân quyền: STAFF chỉ xem/tạo phiếu ở cơ sở mình, và chỉ được SỬA/XÓA phiếu nhập trong ngày. MANAGER được toàn quyền mọi cơ sở.

POST /api/inventory-importsJSON{
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
FieldBắt buộcQuy tắcimport_code, itemsCóimport_code unique; items không rỗng.branch_idKhôngMANAGER bắt buộc truyền. STAFF có thể bỏ trống (hệ thống tự lấy branch_id từ Token của nhân viên).import_dateKhôngBỏ qua thì dùng thời điểm hiện tại.supplier_name, noteKhôngChuỗi hoặc null.items[].product_id, quantity, unit_priceCóProduct active; quantity nguyên > 0; unit price >= 0; không lặp product trong cùng phiếu.items[].discount_percent, discount_amountKhôngDefault 0; percent 0–100, amount >= 0.Frontend không gửi total_amount, product_name, total_price. Backend snapshot tên product và tự tính:total_price = quantity × unit_price − (quantity × unit_price × discount_percent / 100) − discount_amountNếu thành tiền âm, API từ chối. Thành công 201:JSON{
  "message": "Tạo phiếu nhập kho thành công",
  "inventoryImportId": 5,
  "totalAmount": 5700000
}

GET /api/inventory-imports?search=&branchId=&startDate=&endDate=search: theo import_code hoặc supplier_name.branchId: lọc chi nhánh (STAFF tự động bị ép dùng branch của họ).startDate, endDate: lọc theo ngày nhập hàng (Định dạng bắt buộc dùng dấu gạch ngang YYYY-MM-DD).Response: Mỗi bản ghi có header, branch_name và bao gồm luôn mảng items (chi tiết sản phẩm) bên trong.GET /api/inventory-imports/:idTrả header (kèm branch_name) và items snapshot (Dùng khi cần tải lại chi tiết một phiếu cụ thể).Thành công: { "message": "Lấy chi tiết phiếu nhập kho thành công", "data": { "items": [] } }.PUT /api/inventory-imports/:idBody JSON: Cấu trúc gửi lên y hệt POST.Logic (Ghi đè): Dùng transaction để hoàn trả toàn bộ số lượng tồn kho của các items cũ, xóa mềm items cũ, sau đó tính toán tiền và cộng lượng tồn kho mới của các items gửi lên. (Mảng items gửi lên phải chứa toàn bộ sản phẩm của phiếu nhập đó, kể cả sản phẩm không thay đổi số lượng).Không cần truyền branch_id (Backend tự lấy từ phiếu cũ).Thành công 200: { "message": "Cập nhật phiếu nhập kho thành công", "totalAmount": 5700000 }DELETE /api/inventory-imports/:idLogic: Xóa mềm phiếu nhập kho và các items. Hệ thống tự động trừ lại đúng số lượng đã nhập ra khỏi inventory.quantity.Thành công 200: { "message": "Xóa phiếu nhập kho và trừ kho thành công" }

---

## 14. Quản lý Phiếu chi `/api/expenses`

Quản lý các khoản chi tiêu, thanh toán của Spa (như tiền điện, nước, nhập hàng ngoài, v.v.).
*Lưu ý Phân quyền: STAFF chỉ xem/thêm/sửa/xóa phiếu chi tại cơ sở của mình. MANAGER được toàn quyền trên mọi cơ sở.*

### `POST /api/expenses`

**Tạo mới phiếu chi.**

```json
{
  "branch_id": 1,
  "amount": 500000,
  "expense_type": "Thanh toán tiền điện",
  "note": "Tiền điện tháng 9",
  "expense_date": "2026-10-04 10:00:00"
}
FieldBắt buộcQuy tắcamountCóSố tiền chi (Dạng số, >= 0).expense_typeCóLoại phiếu chi / Mục đích chi (Chuỗi không được rỗng).branch_idKhôngMANAGER bắt buộc truyền để chọn cơ sở. STAFF có thể bỏ trống (hệ thống tự lấy branch_id từ Token của nhân viên).expense_dateKhôngThời gian chi tiền. Bỏ qua thì dùng thời điểm hiện tại. (Định dạng YYYY-MM-DD HH:mm:ss).noteKhôngGhi chú thêm (Chuỗi hoặc null).Response (Thành công 201):JSON{
  "message": "Tạo phiếu chi thành công",
  "expenseId": 1,
  "amount": 500000
}
GET /api/expenses?search=&branchId=&startDate=&endDate=Lấy danh sách phiếu chi.search: Tìm kiếm theo loại phiếu chi (expense_type) hoặc ghi chú (note).branchId: Lọc theo chi nhánh (STAFF tự động bị ép dùng branch của họ).startDate, endDate: Lọc theo khoảng ngày chi tiền (expense_date). Định dạng bắt buộc dùng dấu gạch ngang YYYY-MM-DD.Response 200: Trả về mảng data chứa danh sách phiếu chi (đã bao gồm trường branch_name để hiển thị).GET /api/expenses/:idLấy chi tiết một phiếu chi cụ thể.Trả về thông tin chi tiết của 1 phiếu chi (Kèm branch_name).Báo lỗi 403/404 nếu STAFF cố tình truy cập vào ID phiếu chi của cơ sở khác.Thành công 200: { "message": "Lấy chi tiết phiếu chi thành công", "data": { ... } }.PUT /api/expenses/:idCập nhật phiếu chi.Body JSON: Gửi lên các trường cần cập nhật (Có thể gửi 1 trường hoặc nhiều trường giống cấu trúc POST). Frontend không cần gửi lại branch_id.Logic: Backend sẽ tự kiểm tra quyền và cập nhật. Báo lỗi nếu STAFF cố tình sửa phiếu của cơ sở khác.Thành công 200: { "message": "Cập nhật phiếu chi thành công" }DELETE /api/expenses/:idXóa phiếu chi.Logic: Xóa mềm phiếu chi (deleted_at = NOW()).Báo lỗi nếu STAFF cố tình xóa phiếu của cơ sở khác.Thành công 200: { "message": "Xóa phiếu chi thành công" }


Markdown---

## 15. Quản lý Hóa đơn Bán hàng `/api/invoices`

Module xử lý giao dịch thanh toán, tự động trừ số dư ví, tự động tính công nợ khách hàng, tự động chia hoa hồng nhân viên và tự động sinh thẻ liệu trình (nếu mua dịch vụ/combo). Toàn bộ xử lý qua Transaction.

*Lưu ý Phân quyền: STAFF chỉ tạo/xem được hóa đơn ở cơ sở mình, và chỉ được SỬA/XÓA hóa đơn được tạo trong ngày hôm nay. MANAGER toàn quyền.*

### `POST /api/invoices`

**Tạo mới hóa đơn.** 

```json
{
  "customer_id": 1,
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
      "discount_percent": 0,
      "discount_amount": 0,
      "consultants": [
        {
          "staff_id": 2,
          "revenue_amount": 500000,
          "role_type": "Tư vấn chính"
        }
      ]
    },
    {
      "product_id": 4,
      "quantity": 2,
      "discount_percent": 0,
      "discount_amount": 0,
      "consultants": [] 
    }
  ]
}
FieldBắt buộcQuy tắccustomer_id, itemsCóitems không được rỗng. Khách hàng phải tồn tại.branch_idKhôngMANAGER bắt buộc truyền. STAFF có thể bỏ trống (Hệ thống tự lấy theo Token).paid_amountKhôngSố tiền khách trả bằng Tiền mặt / Chuyển khoản / Thẻ. Mặc định 0.wallet_usedKhôngSố tiền muốn trích từ số dư ví của khách. Backend sẽ chặn nếu ví không đủ.discount_percent, discount_amountKhôngChiết khấu tổng hóa đơn (áp dụng sau khi đã cộng dồn chiết khấu từng sản phẩm).invoice_dateKhôngNgày ghi trên hóa đơn (YYYY-MM-DD). Bỏ qua thì dùng thời điểm hiện tại.items[].consultantsKhôngMảng nhân viên tư vấn/chăm sóc. Nếu không có ai, gửi mảng rỗng [] hoặc bỏ key này.Logic Backend tự động:Tổng tiền = Tổng (Tiền từng món sau chiết khấu) - Chiết khấu tổng hóa đơn.Công nợ = Tổng tiền - paid_amount - wallet_used. (Nếu > 0 sẽ tự cộng vào total_debt của khách).Nếu sản phẩm có is_product = 0 hoặc is_treatment_combo = 1, hệ thống tự sinh thẻ liệu trình.Response (Thành công 201):JSON{
  "message": "Tạo hóa đơn thành công",
  "invoiceId": 12,
  "totalAmount": 1350000,
  "debtAmount": 350000,
  "walletUsed": 500000
}
GET /api/invoices?search=&branchId=&startDate=&endDate=&productName=&minAmount=&maxAmount=Lấy danh sách hóa đơn (Hỗ trợ lọc nâng cao):search: Tìm theo tên KH, số điện thoại hoặc Ghi chú.branchId: Lọc theo chi nhánh (STAFF tự động bị ép dùng branch của họ).startDate, endDate: Lọc theo ngày lập hóa đơn (YYYY-MM-DD).productName: Lọc các hóa đơn có chứa sản phẩm/dịch vụ tên tương ứng.minAmount, maxAmount: Lọc theo khoảng giá trị tổng tiền của hóa đơn.Response: Mảng danh sách hóa đơn (đã giấu thông tin trừ ví nội bộ trong chuỗi payment_method để UI hiển thị sạch đẹp).GET /api/invoices/:idLấy chi tiết một hóa đơn cụ thể.Trả về thông tin Header, kèm mảng items. Trong mỗi item sẽ có mảng consultants đi kèm.Báo lỗi 404 nếu STAFF cố truy cập hóa đơn chi nhánh khác.PUT /api/invoices/:idCập nhật hóa đơn (Cơ chế Ghi đè toàn bộ).Body JSON: Gửi lên y hệt cấu trúc POST ban đầu.Lưu ý: Frontend phải gửi toàn bộ danh sách items và consultants hiện tại của hóa đơn. Nếu có sản phẩm bị xóa hoặc đổi số lượng, chỉnh sửa trực tiếp trên mảng đó rồi gửi lên.Logic Backend: Sử dụng Transaction khôi phục (Revert) toàn bộ số dư ví, trừ nợ cũ và xóa liệu trình cũ. Sau đó tự động tính toán lại và áp dụng dữ liệu hóa đơn mới. An toàn tuyệt đối.DELETE /api/invoices/:idXóa hóa đơn.Logic Backend:Hoàn trả tiền vào ví khách hàng (nếu hóa đơn này có dùng ví).Trừ đi số nợ trong hồ sơ khách hàng (nếu hóa đơn này có ghi nợ).Xóa mềm (thu hồi) toàn bộ thẻ liệu trình, hoa hồng nhân viên và chi tiết hóa đơn liên quan.Thành công 200: { "message": "Xóa hóa đơn thành công (Đã hoàn trả công nợ, ví tiền và thu hồi liệu trình)" 


## 14. MiniApp: route có trong source nhưng chưa sử dụng được

File `src/routes/miniappRoutes.js` khai báo 3 endpoint, nhưng **`src/server.js` không import và không mount router này**. Vì vậy hiện tại không có URL `/api/miniapp/*` nào hoạt động qua HTTP; request sẽ nhận 404.

| Endpoint dự kiến | Trạng thái mã nguồn |
|---|---|
| `POST /api/miniapp/login` | Có handler `miniappLogin`, nhưng router chưa mount. |
| `GET /api/miniapp/profile` | Router tham chiếu `getMyProfile`, nhưng controller không export hàm này. |
| `POST /api/miniapp/bookings` | Router tham chiếu `bookAppointment`, nhưng controller không export hàm này. |

> Không nên mount nguyên file `miniappRoutes.js` trước khi bổ sung hai handler còn thiếu: Express sẽ báo lỗi vì callback route không phải function.

Nếu chỉ xét handler `miniappLogin` đã viết, body dự kiến là:

```json
{ "tenantId": 3, "phone_number": "0900000000", "password": "secret" }
```

Và response thành công dự kiến `200`:

```json
{
  "message": "Đăng nhập thành công",
  "token": "<customer-jwt>",
  "data": { "id": 10, "fullname": "Phạm Khách Hàng", "avatar": null }
}
```

---

## 15. Database và phạm vi API hiện tại

Hệ thống sử dụng mô hình multi-tenant:

1. `db_system_master` lưu tenant và user đăng nhập hệ thống.
2. Khi tạo Spa, backend tạo một database tenant mới và clone table từ `db_spa_template`.
3. Với dữ liệu nghiệp vụ, service lấy `database_name` theo `req.user.tenant_id` rồi query trực tiếp vào DB của Spa đó.

### 15.1. Database master: `db_system_master`

| Bảng | Mục đích | API hiện có |
|---|---|---|
| `tenants` | Thông tin Spa, database tenant, hạn dùng, audit/xóa mềm. | Có `/api/tenants`. |
| `users` | Tài khoản SUPER_ADMIN/MANAGER/STAFF; `tenant_id` FK `tenants.id`; `branch_id` là ID branch trong DB tenant. | Có `/api/auth`, `/api/users`. |
| `subscription_packages` | Danh mục gói thuê bao. | Chưa có API. |
| `pending_orders` | Đơn mua/gia hạn chờ thanh toán. | Chưa có API. |
| `payment_logs` | Log webhook/giao dịch thanh toán hệ thống. | Chưa có API. |

### 15.2. Database mỗi Spa (clone từ `db_spa_template`)

| Bảng | Mục đích/quan hệ chính | API hiện có |
|---|---|---|
| `branches` | Chi nhánh, cấu hình ngân hàng/payment provider. | Có `/api/branches`. |
| `roles` | Chức vụ nhân sự. | Có `/api/roles`. |
| `staffs` | Hồ sơ nhân viên; FK `roles`, `branches`. | Có `/api/staffs`. |
| `customers` | Khách hàng, wallet/debt, mật khẩu MiniApp. | Có `/api/customers`. |
| `appointments` | Lịch hẹn; FK `customers`, `branches`. | Chưa có API. |
| `customer_bookings` | Booking do khách tạo; FK `customers`, `branches`, `products`. | Chưa có API; MiniApp booking handler cũng chưa viết. |
| `products` | Sản phẩm/dịch vụ. | Có `/api/products`. |
| `product_commissions` | Hoa hồng theo sản phẩm/chức vụ. | Ghi/đọc lồng trong `/api/products`. |
| `inventory` | Tồn kho theo branch + product; unique `(branch_id, product_id)`. | Tạo kèm product, tăng qua phiếu nhập, đọc lồng trong products. |
| `inventory_imports` | Header phiếu nhập; FK `branches`. | Có `/api/inventory-imports`. |
| `inventory_import_items` | Chi tiết nhập, snapshot giá/tên; FK `inventory_imports`, `products`. | Có trong `GET /api/inventory-imports/:id`. |
| `invoices` | Hóa đơn; FK `customers`, `branches`. | Chưa có API. |
| `invoice_items` | Dòng hóa đơn; FK `invoices`, `products`, có consultant staff. | Chưa có API. |
| `invoice_item_consultants` | Nhân sự tư vấn của invoice item; FK `invoice_items`, `staffs`. | Chưa có API. |
| `treatments` | Liệu trình; FK `customers`, `products`, `invoices`. | Chưa có API. |
| `treatment_history` | Lịch sử buổi điều trị; FK `treatments`, `branches`. | Chưa có API. |
| `treatment_history_staffs` | Nhân viên thực hiện buổi điều trị; FK `treatment_history`, `staffs`. | Chưa có API. |
| `customer_wallet_logs` | Nạp ví khách; FK `customers`, `branches`. | Chưa có API. |
| `debt_payments` | Thu nợ khách hàng. | Chưa có API. |
| `expense_vouchers` | Phiếu chi theo chi nhánh. | Chưa có API. |
| `bank_transactions` | Giao dịch ngân hàng theo chi nhánh. | Chưa có API. |
| `orders` | Đơn hàng online. | Chưa có API. |
| `order_items` | Dòng đơn hàng; FK `orders`, `products`. | Chưa có API. |
| `promotions` | Chương trình khuyến mãi. | Chưa có API. |
| `app_contents` | Banner/thông báo MiniApp theo hệ thống/branch. | Chưa có API. |

> Toàn bộ bảng tenant có cột audit/xóa mềm không phải lúc nào cũng được service hiện tại kiểm tra đầy đủ. Ví dụ service branch/role/customer/staff chỉ lấy bản ghi `deleted_at IS NULL` khi đọc danh sách.

## 16. Lưu ý tích hợp quan trọng

1. `attachTenantDB` trong `src/middlewares/tenant.js` có logic chặn tenant bị khóa/hết hạn và gửi header `X-Expire-Warning`, `X-Expire-Days-Left`. Tuy nhiên middleware này hiện **không được gắn vào bất kỳ route nào**, nên frontend chưa thể dựa vào hai header đó.
2. Không có endpoint health check, upload file, refresh token, logout hoặc OpenAPI/Swagger.
3. Các API list không có `page`, `limit`, `sort`; frontend cần chủ động xử lý lượng dữ liệu lớn hoặc backend cần được mở rộng.
4. Khi xây màn hình khôi phục, API list branch/role/staff/customer không trả bản ghi xóa mềm; frontend vẫn có thể gọi restore nếu đã lưu ID, nhưng không có API list deleted riêng. Riêng `/api/users` trả `deleted_at` nên hỗ trợ hiển thị tài khoản khóa.
5. Chưa có API mount cho appointments, hóa đơn, thanh toán, liệu trình, đơn hàng, promotion hoặc nội dung app; không nên gọi trực tiếp database từ frontend.
