# Bàn giao Frontend Superadmin — Quản lý Spa/Tenant

> **Nguồn sự thật cho frontend/AI:** tài liệu này và mã backend hiện tại trong `src/routes/tenantRoutes.js`, `src/controllers/tenantController.js`, `src/services/tenantService.js`. Cập nhật: **09/10/2026**. Nếu khác nhau, ưu tiên response thực tế của backend và cập nhật lại tài liệu; không tự suy luận API mới.

## 1. Mục tiêu và phạm vi

Xây một frontend riêng cho tài khoản `SUPER_ADMIN` để quản lý các Spa (tenant) trên database master.

Frontend **được làm**:

- Đăng nhập Superadmin.
- Xem, tìm kiếm, lọc trạng thái và phân trang danh sách tenant.
- Xem chi tiết tenant, kể cả tenant đã vô hiệu hóa.
- Tạo Spa mới kèm tài khoản MANAGER ban đầu và thời hạn sử dụng.
- Đổi tên Spa, gia hạn cộng năm trên backend hoặc chuyển sang không thời hạn; xem danh sách MANAGER và cấp lại mật khẩu khi quên.
- Vô hiệu hóa và khôi phục tenant.

Frontend **không được giả định có API** cho:

- Sửa username/họ tên Manager từ màn Superadmin (chỉ hỗ trợ xem danh sách và cấp mật khẩu mới).
- Xóa vật lý database tenant hoặc tenant.
- Thống kê tổng tenant/dashboard, quản lý gói dịch vụ, nhật ký thanh toán, nhập vai tenant.
- Upload logo/hình, phân quyền chi tiết, refresh token hay logout API.

Nếu cần các chức năng trên, phải bổ sung backend trước; không gọi API tenant của MANAGER với token Superadmin để thay thế.

---

## 2. Cấu hình và xác thực

### 2.1. Base URL

- Base URL lấy từ biến môi trường frontend, ví dụ `VITE_API_BASE_URL`.
- Khi để rỗng, request cùng origin; môi trường local backend mặc định dùng `http://localhost:5000`.
- Mọi URL bên dưới đã bao gồm `/api`.

### 2.2. Login

`POST /api/auth/login` — public.

```json
{
  "username": "superadmin",
  "password": "your-password"
}
```

Thành công HTTP `200`:

```json
{
  "message": "Đăng nhập thành công!",
  "data": {
    "user": {
      "id": 1,
      "tenant_id": null,
      "branch_id": null,
      "username": "superadmin",
      "fullname": "Quản trị hệ thống",
      "system_role": "SUPER_ADMIN"
    },
    "token": "jwt-string"
  }
}
```

Sau login:

1. Chỉ vào app quản trị nếu `data.user.system_role === 'SUPER_ADMIN'`.
2. Nếu là `MANAGER` hoặc `STAFF`, xóa session vừa lưu (nếu có) và hiển thị: **“Tài khoản không có quyền quản trị hệ thống.”**
3. Lưu `token` ở session phù hợp với chính sách dự án. Mọi request riêng tư gửi header:

```http
Authorization: Bearer <token>
Accept: application/json
```

4. Token có hiệu lực 15 giờ. HTTP `401` (không có token) hoặc `403` (token hết hạn/sai quyền) phải xóa session và chuyển về `/login`.
5. Không bao giờ log token hoặc password ra console, analytics, toast hay URL.

### 2.3. Response lỗi chung

Mọi lỗi trả JSON:

```json
{ "message": "Mô tả lỗi tiếng Việt" }
```

- `400`: request/validation sai.
- `401`: thiếu token.
- `403`: token không hợp lệ/hết hạn hoặc không phải Superadmin.
- `404`: tenant không tồn tại.
- `500`: lỗi server, nhất là khi tạo tenant/clone database thất bại.

Khi lỗi, ưu tiên hiển thị `message` từ server. Không cố đọc `data` hoặc `total` từ response lỗi.

---

## 3. Model dữ liệu

### 3.1. Tenant list/detail

`Tenant` có các field sau. UI không được gửi `database_name`, audit fields, `status` hoặc `manager_*` khi cập nhật.

```ts
type TenantStatus = 'ACTIVE' | 'EXPIRED' | 'DISABLED'

type Tenant = {
  tenant_id: number
  spa_name: string
  database_name: string
  expire_at: string | null
  created_at: string
  updated_at: string | null
  deleted_at: string | null
  created_by: string | null
  updated_by: string | null
  deleted_by: string | null
  manager_user_id: number | null
  manager_username: string | null
  manager_fullname: string | null
  status: TenantStatus
}
```

Ý nghĩa `status` do backend tính theo thời điểm request:

| Status | Điều kiện | Hiển thị/Thao tác UI |
|---|---|---|
| `ACTIVE` | Chưa xóa và `expire_at` là `null` hoặc ở tương lai | Badge xanh; cho sửa hoặc vô hiệu hóa. |
| `EXPIRED` | Chưa xóa, có `expire_at` và đã đến/quá thời điểm đó | Badge vàng/đỏ; cho sửa để gia hạn hoặc vô hiệu hóa. User tenant không thể login. |
| `DISABLED` | `deleted_at` khác `null` | Badge xám/đỏ; chỉ cho xem chi tiết và khôi phục. Không cho update/delete lại. |

**Lưu ý thời gian:** `expire_at: null` nghĩa là không thời hạn. Hiển thị “Không thời hạn”, không suy diễn ngày hết hạn. Date/datetime từ MySQL phải parse như thời gian thực, không cắt chuỗi thủ công. Khi user chỉ chọn ngày ở UI, gửi ISO đầy đủ hoặc `YYYY-MM-DDTHH:mm:ss` theo timezone mong muốn của sản phẩm.

### 3.2. Phân trang

Tất cả danh sách tenant trả:

```ts
type Paged<T> = {
  message: string
  total: number
  page: number
  pageSize: number
  totalPages: number
  data: T[]
}
```

- `page`: số nguyên từ 1.
- `pageSize`: số nguyên 1–100.
- Mặc định: `page=1`, `pageSize=20`.
- `total` là số dòng **sau lọc, trước phân trang**.
- Khi `total=0`, `totalPages=0`; UI vẫn hiển thị trang 1 và disable cả hai nút phân trang.
- Đổi `search` hoặc `status` phải đặt `page=1` trước khi gọi lại API.

---

## 4. API tenant — toàn bộ API dùng cho app này

Tất cả endpoint dưới đây yêu cầu token với `system_role = SUPER_ADMIN`.

### 4.1. Danh sách và tìm kiếm

`GET /api/tenants?search=&status=all&page=1&pageSize=20`

| Query | Bắt buộc | Giá trị | Mô tả |
|---|---:|---|---|
| `search` | Không | Tối đa 100 ký tự | Tìm gần đúng theo tên Spa, username Manager hoặc họ tên Manager. |
| `status` | Không | `all` / `active` / `expired` / `disabled` | Mặc định `all`. Không phân biệt hoa thường. |
| `page` | Không | integer ≥ 1 | Mặc định 1. |
| `pageSize` | Không | integer 1–100 | Mặc định 20. |

Ví dụ:

```http
GET /api/tenants?search=ngoc&status=active&page=1&pageSize=20
Authorization: Bearer <token>
```

Thành công `200`:

```json
{
  "message": "Lấy danh sách Spa thành công",
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "data": [
    {
      "tenant_id": 7,
      "spa_name": "Spa Ngọc Lan",
      "database_name": "db_spa_1791039769068_e185",
      "expire_at": "2027-10-03T00:00:00.000Z",
      "created_at": "2026-10-03T08:00:00.000Z",
      "updated_at": "2026-10-10T08:00:00.000Z",
      "deleted_at": null,
      "created_by": "Quản trị hệ thống",
      "updated_by": "Quản trị hệ thống",
      "deleted_by": null,
      "manager_user_id": 18,
      "manager_username": "ngoclan.manager",
      "manager_fullname": "Nguyễn Ngọc Lan",
      "status": "ACTIVE"
    }
  ]
}
```

### 4.2. Chi tiết

`GET /api/tenants/:id`

- `id` phải là số nguyên dương.
- Trả được tenant ở mọi trạng thái, kể cả `DISABLED`; đây là lý do cần dùng API này cho drawer chi tiết của tenant đã vô hiệu hóa.
- `404` khi không tồn tại; `400` nếu id không hợp lệ.

Thành công `200`: `{ "message": "Lấy chi tiết Spa thành công", "data": Tenant }`.

### 4.3. Tạo tenant + Manager ban đầu

`POST /api/tenants/create`

```json
{
  "spaName": "Spa Ngọc Lan",
  "managerUsername": "ngoclan.manager",
  "managerPassword": "mat-khau-it-nhat-6-ky-tu",
  "managerFullname": "Nguyễn Ngọc Lan",
  "years": "1"
}
```

| Body field | Bắt buộc | Rule backend | UI gợi ý |
|---|---:|---|---|
| `spaName` | Có | string trim, 1–100 ký tự | Text input. |
| `managerUsername` | Có | string trim, 1–100 ký tự, unique toàn hệ thống | Text input; không tự thêm prefix. |
| `managerPassword` | Có | string trim, 6–255 ký tự | Password + confirm password chỉ kiểm tra ở frontend. Không hiển thị lại sau khi gửi. |
| `managerFullname` | Có | string trim, 1–255 ký tự | Text input. |
| `years` | Không | `"lifetime"` hoặc chuỗi/số nguyên 1–100; bỏ field/null/rỗng cũng là không thời hạn | Select: Không thời hạn, 1/2/3/5/10 năm. |

Hành vi server: tạo row tenant, băm password, tạo user `MANAGER`, tạo database tenant và clone toàn bộ bảng từ `db_spa_template`. Đây là thao tác nặng và có thể mất thời gian; nút submit phải disable trong khi request đang chạy và không cho click lặp.

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
    "expireDate": "2027-10-10T08:00:00.000Z"
  }
}
```

Với gói không thời hạn, `expireDate` là chuỗi chính xác: `"Vĩnh viễn (Lifetime)"` — không parse chuỗi này thành date.

Sau thành công: đóng modal, toast thành công, xóa form/password, reset list về `page=1`, refetch danh sách. Có thể mở detail của `tenantId` vừa tạo.

### 4.4. Cập nhật tên/hạn dùng

`PUT /api/tenants/:id`

Gửi **ít nhất một** field:

```json
{ "spaName": "Spa Ngọc Lan - Quận 1" }
```

```json
{ "expireAt": "2027-12-31T23:59:59+07:00" }
```

```json
{ "expireAt": null }
```

| Field | Rule |
|---|---|
| `spaName` | Nếu gửi: string trim, 1–100 ký tự. |
| `expireAt` | Nếu gửi: ISO/date-time hợp lệ; `null` chuyển tenant sang không thời hạn. |

- API cập nhật được cả tenant `ACTIVE`, `EXPIRED` và `DISABLED`. Tuy nhiên UI chuẩn chỉ nên mở form sửa cho `ACTIVE`/`EXPIRED`; với `DISABLED`, yêu cầu khôi phục trước để tránh vô tình bật/sửa trạng thái không rõ ràng.
- Không có field `years` ở endpoint này: UI tính ngày hết hạn rồi gửi `expireAt` tuyệt đối.
- `404` nếu tenant không tồn tại; `400` nếu body không hợp lệ.

Thành công `200`:

```json
{
  "message": "Cập nhật thông tin Spa thành công!",
  "data": { "id": 7, "spa_name": "Spa Ngọc Lan - Quận 1", "expire_at": "2027-12-31T16:59:59.000Z" }
}
```

Sau thành công refetch list + detail đang mở. Không tự ghép optimistic state vì response PUT không có đầy đủ audit/manager/status.

### 4.5. Vô hiệu hóa

`DELETE /api/tenants/:id`

- Soft-delete tenant và **toàn bộ user thuộc tenant** ở master DB.
- Không xóa database vật lý tenant và không xóa dữ liệu nghiệp vụ.
- Sau đó user tenant không thể đăng nhập mới. Frontend không được suy diễn rằng token cũ đã tự bị thu hồi: middleware kiểm tenant hiện chưa được mount toàn cục cho mọi API nghiệp vụ.
- Không gửi request nếu row đã `DISABLED`.

Thành công `200`:

```json
{ "message": "Đã xóa (vô hiệu hóa) Spa thành công!" }
```

UI bắt buộc confirm dialog, nêu rõ tên Spa và hậu quả: **“Tất cả tài khoản của Spa sẽ không thể đăng nhập. Dữ liệu không bị xóa và có thể khôi phục.”** Sau thành công refetch list/detail; row sẽ biến mất nếu filter hiện tại không phải `all`/`disabled`.

### 4.6. Khôi phục

`PATCH /api/tenants/:id/restore`

- Chỉ dùng cho tenant `DISABLED`.
- Gỡ soft-delete tenant và **toàn bộ user của tenant**. Điều này khôi phục cả các tài khoản user đã bị khóa riêng lẻ trước đó; Superadmin phải hiểu đây là hành vi backend hiện tại.
- Nếu thời hạn tenant đã quá hạn, khôi phục vẫn thành công nhưng tenant có `status=EXPIRED` và user vẫn không thể login cho đến khi gia hạn qua `POST /api/tenants/:id/renew` hoặc đặt `expireAt` bằng PUT.

Thành công `200`:

```json
{ "message": "Đã khôi phục Spa thành công! Các tài khoản đã có thể đăng nhập lại." }
```

UI confirm dialog. Sau thành công refetch list/detail; hiển thị `EXPIRED` thay vì thông báo “đã dùng được” nếu `expire_at` đã qua.

---

### 4.7. Danh sách MANAGER thuộc Spa

`GET /api/tenants/:id/managers` (SUPER_ADMIN) trả `200`:

```json
{
  "message": "Lấy danh sách MANAGER thành công",
  "total": 1,
  "data": [{
    "id": 18, "tenant_id": 7, "username": "ngoclan.manager",
    "fullname": "Nguyễn Ngọc Lan", "system_role": "MANAGER",
    "created_at": "2026-10-03T08:00:00.000Z", "updated_at": null, "deleted_at": null
  }]
}
```

Bao gồm MANAGER đã xóa mềm để hiển thị, nhưng chỉ cấp lại mật khẩu cho người có `deleted_at=null` thuộc tenant chưa vô hiệu hóa. Không có password/hash trong response. Danh sách này không phân trang; `GET /api/tenants/:id` chỉ hiển thị một MANAGER đại diện, không thay thế danh sách này. ID sai `400`, Spa không tồn tại `404`.

### 4.8. Cấp lại mật khẩu MANAGER

`PATCH /api/tenants/:id/managers/:userId/password` body:

```json
{ "newPassword": "mat-khau-moi-123" }
```

`newPassword`: string sau trim 6–255 ký tự. Backend xác minh `userId` là MANAGER đang hoạt động **của đúng tenantId trên URL** (không cấp cho STAFF/SUPER_ADMIN), băm bcrypt; thành công `200 { "message": "Đã cấp lại mật khẩu MANAGER thành công." }`, không trả mật khẩu. Thiếu/sai dữ liệu `400`; Spa hoặc MANAGER sai, bị vô hiệu hóa `404`. Mật khẩu cũ không đăng nhập được nữa; JWT đã cấp trước đó **chưa tự thu hồi**. UI tạo mật khẩu đủ mạnh, có ô xác nhận mật khẩu ở client, xác nhận tên Spa và username, chỉ chuyển mật khẩu mới qua HTTPS trong JSON, không ghi log, không lưu vào list/detail/localStorage và xóa form sau khi request hoàn tất. Giao mật khẩu cho Manager qua kênh bảo mật riêng; backend không gửi email/SMS.

### 4.9. Gia hạn thêm số năm

`POST /api/tenants/:id/renew` body `{ "years": 1 }` (`years` số nguyên hoặc chuỗi số nguyên 1–100). Nếu chưa hết hạn, cộng năm vào `expire_at` cũ; nếu đã hết hạn, cộng từ `NOW()` theo **giờ DB**. Backend khóa row trong transaction để hai lần gia hạn không ghi đè nhau. Thành công `200`:

```json
{ "message": "Gia hạn Spa thành công.", "data": { "id": 7, "expire_at": "2028-10-10T08:00:00.000Z" } }
```

Spa đã vô hiệu hóa/không tồn tại: `404`; Spa không thời hạn (`expire_at=null`) hoặc years sai: `400`. Nếu muốn chuyển sang không thời hạn hay ấn định một ngày cụ thể, dùng `PUT /api/tenants/:id` với `expireAt: null` hoặc ISO date-time; không dùng renew. API renew chỉ sửa `tenants.expire_at`, **không** ghi nhận thanh toán, hóa đơn hoặc `subscription_packages` (schema hiện không liên kết gói với tenant). Không retry tự động khi timeout: kiểm tra chi tiết Spa trước khi thử lại để tránh cộng năm hai lần.

---

## 5. Luồng/màn hình bắt buộc

### A. Login (`/login`)

- Username/password, submit bằng Enter, show/hide password, loading state.
- Sau success chỉ nhận `SUPER_ADMIN`; role khác báo lỗi quyền và ở lại màn login.
- Không cần link đăng ký, quên mật khẩu hoặc reset password vì backend chưa có cho Superadmin.

### B. Tenant list (`/tenants`)

Toolbar:

- Ô search debounce khoảng 300–500 ms hoặc submit explicit.
- Filter trạng thái: Tất cả / Hoạt động / Hết hạn / Đã vô hiệu hóa.
- Nút “Tạo Spa”.
- Khi thay filter/search, reset page = 1.

Bảng đề xuất:

| Cột | Dữ liệu |
|---|---|
| Spa | `spa_name`; click mở chi tiết. |
| Manager | `manager_fullname` và `manager_username`; nếu null hiển thị “Chưa có Manager”. |
| Hạn dùng | `expire_at`, hoặc “Không thời hạn”. |
| Trạng thái | badge theo `status`. |
| Ngày tạo | `created_at`. |
| Thao tác | Xem; Sửa khi không DISABLED; Vô hiệu hóa khi ACTIVE/EXPIRED; Khôi phục khi DISABLED. |

Phải có loading skeleton, empty state theo filter, error state + retry, pagination dùng `totalPages` server trả về.

### C. Tạo Spa (modal/drawer)

- Fields đúng mục 4.3; không có field database name.
- Gợi ý mặc định `years="lifetime"` hoặc tuân theo yêu cầu sản phẩm; không gửi password confirm lên API.
- Cảnh báo username là duy nhất trên toàn hệ thống.
- Chặn submit client-side khi required rỗng hoặc password < 6, nhưng vẫn hiển thị message backend khi server từ chối.

### D. Chi tiết Tenant (`/tenants/:id` hoặc drawer)

Hiển thị toàn bộ `Tenant`: thông tin Spa, Manager, database name (chỉ để Superadmin xem/copy), trạng thái, hạn dùng, created/updated/deleted audit. Database name không sửa được.

Các CTA phụ thuộc status:

- `ACTIVE`: Sửa, Vô hiệu hóa.
- `EXPIRED`: Gia hạn/Sửa, Vô hiệu hóa.
- `DISABLED`: Khôi phục; không sửa/vô hiệu hóa lại trong UX chuẩn.

### E. Gia hạn/sửa

- `spaName` là optional; chỉ gửi field user thực sự thay đổi.
- UI gia hạn có hai lựa chọn: “Không thời hạn” gửi `expireAt: null`; hoặc date/time gửi ISO hợp lệ.
- Để gia hạn theo số năm, chọn số năm 1–100 rồi gọi `POST /api/tenants/:id/renew`; backend tính từ `max(NOW(), expire_at)` theo giờ DB. Không tự cộng năm trong frontend. Sau thành công refetch list/detail và hiển thị hạn mới.

### G. Tài khoản MANAGER và quên mật khẩu

- Trong detail Spa, gọi `GET /api/tenants/:id/managers`, hiển thị username, họ tên, trạng thái hoạt động/xóa mềm. Nút “Cấp lại mật khẩu” chỉ hiện cho MANAGER đang hoạt động khi Spa không `DISABLED`.
- Confirm tên Spa + username trước khi gọi `PATCH /api/tenants/:id/managers/:userId/password`; nhập mật khẩu mới và confirm, không đọc/gửi mật khẩu cũ. Xóa giá trị nhập sau thành công/lỗi, hiển thị thông báo phải chuyển mật khẩu mới an toàn cho Manager. Không chuyển mật khẩu vào URL/toast/log.

### F. Vô hiệu hóa/khôi phục

- Không optimistic update.
- Loading trên nút; không cho gọi cùng mutation hai lần.
- Sau mutation invalidate/refetch cả list và detail.

---

## 6. API client contract mẫu

Ví dụ JavaScript thuần. Điều chỉnh theo thư viện dự án, nhưng giữ nguyên paths, HTTP methods, fields và cách xử lý lỗi.

```js
const apiBase = import.meta.env.VITE_API_BASE_URL || ''

async function request(path, { method = 'GET', token, body, query } = {}) {
  const url = new URL(`${apiBase}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(json.message || 'Yêu cầu không thành công.'), { status: response.status })
  return json
}

export const tenantApi = {
  list: (token, { search = '', status = 'all', page = 1, pageSize = 20 } = {}) =>
    request('/api/tenants', { token, query: { search, status, page, pageSize } }),
  detail: (token, id) => request(`/api/tenants/${encodeURIComponent(id)}`, { token }),
  create: (token, payload) => request('/api/tenants/create', { method: 'POST', token, body: payload }),
  update: (token, id, payload) => request(`/api/tenants/${encodeURIComponent(id)}`, { method: 'PUT', token, body: payload }),
  disable: (token, id) => request(`/api/tenants/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
  restore: (token, id) => request(`/api/tenants/${encodeURIComponent(id)}/restore`, { method: 'PATCH', token }),
  managers: (token, id) => request(`/api/tenants/${encodeURIComponent(id)}/managers`, { token }),
  resetManagerPassword: (token, id, userId, newPassword) => request(`/api/tenants/${encodeURIComponent(id)}/managers/${encodeURIComponent(userId)}/password`, { method: 'PATCH', token, body: { newPassword } }),
  renew: (token, id, years) => request(`/api/tenants/${encodeURIComponent(id)}/renew`, { method: 'POST', token, body: { years } })
}
```

---

## 7. Bảo mật và dữ liệu nhạy cảm

1. Route guard frontend chỉ là UX; backend mới là nơi quyết định quyền.
2. Không đưa token, password Manager, `database_name` vào public URL, error tracker, telemetry hay clipboard tự động.
3. `database_name` là metadata nội bộ: chỉ hiển thị ở detail Superadmin, không render ở list mặc định.
4. Không cache lâu response danh sách/detail tenant ở shared/public cache. Khi logout, clear cache query/session.
5. Với các mutation nguy hiểm, bắt người dùng xác nhận bằng tên Spa; không chỉ dùng confirm mơ hồ.
6. Khi API trả 401/403, không retry mutation tự động.

---

## 8. Checklist nghiệm thu frontend

- [ ] Login `SUPER_ADMIN` vào `/tenants`; MANAGER/STAFF bị chặn ở frontend.
- [ ] Header `Authorization: Bearer` có ở toàn bộ endpoint tenant.
- [ ] Danh sách support `search`, 4 trạng thái, loading/error/empty/pagination.
- [ ] Search/filter luôn reset trang về 1.
- [ ] Tenant `DISABLED` hiển thị trong `all` và `disabled`, xem detail được.
- [ ] Tạo Spa gửi đúng 5 fields, password không bị log/hiển thị sau submit.
- [ ] Update gửi `expireAt: null` được cho gói không thời hạn.
- [ ] Hết hạn hiển thị `EXPIRED`; UI dẫn user đến gia hạn.
- [ ] Gia hạn cộng năm gọi `POST /:id/renew` và refetch, không tự cộng năm; Spa không thời hạn dùng PUT đặt hạn tuyệt đối.
- [ ] Danh sách MANAGER theo tenant; cấp lại mật khẩu chỉ cho MANAGER active của Spa active; không lưu hoặc log mật khẩu.
- [ ] Disable có confirm và không gọi lại nếu đã DISABLED.
- [ ] Restore có confirm; sau restore kiểm tra status mới. Nếu vẫn EXPIRED, hướng dẫn gia hạn.
- [ ] 400 hiện message server cạnh form/toast; 401/403 logout và redirect; 404 đóng detail và báo tenant không còn tồn tại; 500 có retry.
- [ ] Không tự gọi endpoint chưa tồn tại nêu ở mục 1.

---

## 9. Ghi chú backend cho đội frontend

- Backend đã chặn login của user thuộc tenant `DISABLED` hoặc `EXPIRED`.
- API nghiệp vụ của tenant hiện không mount `attachTenantDB` globally; app Superadmin không cần dựa vào chi tiết này, nhưng không được coi UI status là lớp bảo mật.
- `DELETE` và `PATCH restore` xử lý tenant cùng toàn bộ users của tenant. Khôi phục sẽ khôi phục cả user từng bị khóa riêng lẻ; đây là hạn chế nghiệp vụ cần xác nhận nếu thay đổi sau này.
- Tạo tenant clone schema template trong transaction. Nếu thất bại, frontend chỉ hiển thị lỗi; không retry tự động vì cần tránh tạo duplicate do mạng chập chờn. Người vận hành kiểm tra danh sách theo `spaName`/Manager username trước khi thử lại.