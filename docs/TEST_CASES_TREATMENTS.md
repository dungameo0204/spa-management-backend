# Kịch bản kiểm thử API Liệu trình (Test Cases — `/api/treatments`)

> Tài liệu mô tả chi tiết các kịch bản kiểm thử (Test Cases / Scenarios) cho toàn bộ chức năng thuộc module Quản lý Liệu trình (`/api/treatments`), bao gồm phân quyền, tính toán số buổi, tính hoa hồng kỹ thuật viên, tự động tạo lịch hẹn và cơ chế hoàn tác dữ liệu trong Transaction.

---

## 1. Môi trường & Dữ liệu chuẩn bị (Seed Data mẫu)

Trước khi thực hiện kiểm thử, đảm bảo database của Spa đã có dữ liệu nền sau:

1. **Chi nhánh (`branches`):**
   - Chi nhánh 1 (`id = 1`): "Spa Chi Nhánh Quận 1"
   - Chi nhánh 2 (`id = 2`): "Spa Chi Nhánh Quận 7"
2. **Chức vụ (`roles`):**
   - Role 1 (`id = 1`): "Quản lý"
   - Role 2 (`id = 2`): "Kỹ thuật viên"
3. **Nhân sự (`staffs`):**
   - Staff 1 (`id = 1`): Chi nhánh 1, Role 2 ("Nguyễn Kỹ Thuật Viên 1")
   - Staff 2 (`id = 2`): Chi nhánh 1, Role 2 ("Trần Kỹ Thuật Viên 2")
   - Staff 3 (`id = 3`): Chi nhánh 2, Role 2 ("Lê Kỹ Thuật Viên CN2")
4. **Khách hàng (`customers`):**
   - Khách 1 (`id = 1`): "Phạm Khách Hàng VIP", sđt "0901234567"
5. **Dịch vụ liệu trình (`products`):**
   - Dịch vụ A (`id = 5`): "Liệu trình Chăm sóc da chuyên sâu 10 buổi", `price = 5,000,000`, `is_product = 0`, `is_treatment_combo = 1`, `default_sessions = 10`, `next_appointment_days = 7`.
6. **Cấu hình hoa hồng (`product_commissions`):**
   - `product_id = 5`, `role_id = 2` (Kỹ thuật viên): `commission_percent = 5` (5% của 5tr = 250k) hoặc `commission_fixed_amount = 50,000`. Tổng hoa hồng = 300,000 VNĐ / buổi.
7. **Tài khoản test:**
   - Account Manager: Token JWT có `system_role = 'MANAGER'`, `tenant_id = <id>`, `branch_id = null`.
   - Account Staff CN1: Token JWT có `system_role = 'STAFF'`, `tenant_id = <id>`, `branch_id = 1`.
   - Account Staff CN2: Token JWT có `system_role = 'STAFF'`, `tenant_id = <id>`, `branch_id = 2`.

---

## 2. Ma trận phân quyền (Role Matrix)

| Endpoint | Method | Public / Không Token | STAFF | MANAGER | SUPER_ADMIN |
|---|---|:---:|:---:|:---:|:---:|
| `/api/treatments` | `POST` | 401 | 403 | 201 | 403 |
| `/api/treatments/execute` | `POST` | 401 | 201 (khóa theo branch) | 201 (chọn branch) | 403 (không có tenant_id) |
| `/api/treatments/execute/:historyId/staffs` | `PUT` | 401 | 200 (chỉ branch mình) | 200 (mọi branch) | 403 |
| `/api/treatments/commissions` | `GET` | 401 | 200 (chỉ branch mình) | 200 (mọi branch) | 403 |
| `/api/treatments/execute/:historyId` | `DELETE` | 401 | 200 (chỉ branch mình) | 200 (mọi branch) | 403 |

---

## 3. Chi tiết các trường hợp test (Test Cases)

### Module 3.1: Tạo thẻ liệu trình thủ công (`POST /api/treatments`)

#### TC-TR-01: Tạo thẻ thủ công thành công bởi MANAGER (Happy Path)
- **Actor:** MANAGER.
- **Request Body:**
  ```json
  {
    "customer_id": 1,
    "product_id": 5,
    "total_sessions": 10,
    "remaining_sessions": 10,
    "note": "Tặng khách VIP nhân dịp khai trương"
  }
  ```
- **Kỳ vọng:**
  - Status `201 Created`.
  - Body: `{ "message": "Tạo thẻ liệu trình thủ công thành công", "treatmentId": <number> }`.
  - Database: Bảng `treatments` có bản ghi mới: `customer_id = 1`, `product_id = 5`, `total_sessions = 10`, `remaining_sessions = 10`, `deleted_at IS NULL`.

#### TC-TR-02: Bỏ qua `remaining_sessions` thì mặc định bằng `total_sessions`
- **Actor:** MANAGER.
- **Request Body:** `{ "customer_id": 1, "product_id": 5, "total_sessions": 5 }`.
- **Kỳ vọng:** Status `201 Created`, database lưu `remaining_sessions = 5`.

#### TC-TR-03: Thất bại khi `remaining_sessions > total_sessions`
- **Actor:** MANAGER.
- **Request Body:** `{ "customer_id": 1, "product_id": 5, "total_sessions": 5, "remaining_sessions": 6 }`.
- **Kỳ vọng:** Status `400 Bad Request`, message: `"Số buổi còn lại không được lớn hơn tổng số buổi."`.

#### TC-TR-04: Thất bại khi STAFF cố tình gọi API tạo thẻ
- **Actor:** STAFF.
- **Request Body:** Dữ liệu hợp lệ.
- **Kỳ vọng:** Status `403 Forbidden`, message: `"Từ chối truy cập! Chỉ tài khoản Chủ Spa (MANAGER) mới có quyền thực hiện hành động này."`.

#### TC-TR-05: Thất bại khi `customer_id` hoặc `product_id` âm / không phải số nguyên
- **Actor:** MANAGER.
- **Request Body:** `{ "customer_id": "abc", "product_id": 5, "total_sessions": 10 }`.
- **Kỳ vọng:** Status `400 Bad Request`, message: `"customer_id không hợp lệ."`.

---

### Module 3.2: Bấm thực hiện buổi dịch vụ (`POST /api/treatments/execute`)

#### TC-TR-06: Bấm buổi thành công không truyền nhân viên (Happy Path)
- **Actor:** STAFF (Chi nhánh 1). Thẻ liệu trình có `remaining_sessions = 10`.
- **Request Body:**
  ```json
  {
    "treatment_id": 1
  }
  ```
- **Kỳ vọng:**
  - Status `201 Created`.
  - Response: `{ "treatmentHistoryId": <id>, "message": "Đã trừ 1 buổi liệu trình và tính hoa hồng thành công" }`.
  - Database:
    - `treatments.remaining_sessions` giảm từ 10 xuống 9.
    - `treatment_history` có 1 bản ghi mới với `treatment_id = 1`, `branch_id = 1` (lấy từ token Staff).
    - `treatment_history_staffs` không có bản ghi mới.

#### TC-TR-07: Bấm buổi thành công có chọn nhân viên phục vụ (Tính hoa hồng tự động)
- **Actor:** STAFF (Chi nhánh 1).
- **Request Body:**
  ```json
  {
    "treatment_id": 1,
    "staffs": [
      { "staff_id": 1 },
      { "staff_id": 2 }
    ]
  }
  ```
- **Kỳ vọng:**
  - Status `201 Created`.
  - `treatments.remaining_sessions` giảm tiếp 1 buổi.
  - Bảng `treatment_history_staffs` lưu 2 dòng:
    - Dòng 1: `staff_id = 1`, `commission_amount_snapshot = 0` (legacy, không dùng tính báo cáo).
    - Dòng 2: `staff_id = 2`, `commission_amount_snapshot = 0`; API báo cáo tính tiền công theo cấu hình hiện tại.

#### TC-TR-08: Tự động tạo lịch hẹn tái khám nếu dịch vụ có `next_appointment_days > 0`
- **Điều kiện:** Dịch vụ có `next_appointment_days = 7`, thẻ còn `remaining_sessions = 5`.
- **Request Body:** `{ "treatment_id": 1, "execution_date": "2026-10-10 10:00:00" }`.
- **Kỳ vọng:**
  - Sau khi trừ 1 buổi, còn lại 4 buổi (`> 0`).
  - Bảng `appointments` tự động có bản ghi mới:
    - `customer_id = 1`, `branch_id = 1`.
    - `appointment_date = 2026-10-17 10:00:00` (đúng ngày thực hiện + 7 ngày).
    - `note = 'Lịch hẹn tự động từ liệu trình: <tên dịch vụ>'` (ví dụ: `Lịch hẹn tự động từ liệu trình: Liệu trình Chăm sóc da chuyên sâu 10 buổi`).

#### TC-TR-09: Không tạo lịch hẹn tái khám khi bấm buổi cuối cùng
- **Điều kiện:** Thẻ liệu trình chỉ còn `remaining_sessions = 1`.
- **Request Body:** `{ "treatment_id": 1 }`.
- **Kỳ vọng:**
  - `remaining_sessions` giảm về 0.
  - Bảng `appointments` KHÔNG sinh lịch hẹn mới (vì khách đã dùng hết liệu trình).

#### TC-TR-10: Thất bại khi thẻ liệu trình đã hết buổi (`remaining_sessions <= 0`)
- **Điều kiện:** Thẻ liệu trình có `remaining_sessions = 0`.
- **Request Body:** `{ "treatment_id": 1 }`.
- **Kỳ vọng:**
  - Status `400 Bad Request`.
  - Message: `"Thẻ liệu trình này đã hết số buổi."`.
  - Database không có bản ghi nào bị thay đổi.

#### TC-TR-11: MANAGER bắt buộc phải truyền `branch_id`
- **Actor:** MANAGER.
- **Request Body:** `{ "treatment_id": 1 }` (không có `branch_id`).
- **Kỳ vọng:** Status `400 Bad Request`, message: `"Quản lý bắt buộc phải truyền branch_id."`.

#### TC-TR-12: Transaction Rollback khi truyền ID nhân viên không tồn tại
- **Request Body:** `{ "treatment_id": 1, "staffs": [{ "staff_id": 999999 }] }`.
- **Kỳ vọng:**
  - Status `400 Bad Request`, message: `"Nhân viên ID 999999 không tồn tại."`.
  - **Kiểm tra Rollback:** `remaining_sessions` của thẻ liệu trình KHÔNG được giảm, và không có bản ghi `treatment_history` nào được tạo.

---

### Module 3.3: Gán bổ sung / Cập nhật nhân viên cho buổi cũ (`PUT /api/treatments/execute/:historyId/staffs`)

#### TC-TR-13: Gán / Đổi nhân viên thành công (Ghi đè và tính lại hoa hồng)
- **Actor:** STAFF (Chi nhánh 1). `historyId = 1` thuộc Chi nhánh 1.
- **Request Body:**
  ```json
  {
    "staffs": [
      { "staff_id": 2 }
    ]
  }
  ```
- **Kỳ vọng:**
  - Status `200 OK`.
  - Message: `"Đã cập nhật danh sách nhân viên thực hiện và tính hoa hồng thành công"`.
  - Database: Các bản ghi cũ trong `treatment_history_staffs` của `treatment_history_id = 1` được cập nhật `deleted_at = NOW()`, bản ghi mới được tạo cho `staff_id = 2`.

#### TC-TR-14: Thất bại khi STAFF cố sửa lịch sử của chi nhánh khác
- **Actor:** STAFF (Chi nhánh 2). Gọi `historyId` thuộc Chi nhánh 1.
- **Kỳ vọng:** Status `400 Bad Request`, message: `"Bạn không có quyền thao tác trên lịch sử của cơ sở khác."`.

#### TC-TR-15: Xóa toàn bộ nhân viên/hoa hồng khi gửi mảng `staffs` rỗng
- **Request Body:** `{ "staffs": [] }`.
- **Kỳ vọng:**
  - Status `200 OK`.
  - Các bản ghi `treatment_history_staffs` active của history được soft delete (`deleted_at IS NOT NULL`).
  - Không có bản ghi assignment/hoa hồng active mới được tạo.
  - STAFF chỉ thực hiện được với history thuộc branch trong token.

---

### Module 3.4: Báo cáo tra cứu hoa hồng nhân viên (`GET /api/treatments/commissions`)

#### TC-TR-16: Lấy danh sách hoa hồng nhân viên đầy đủ
- **Actor:** MANAGER. Gọi `GET /api/treatments/commissions`.
- **Kỳ vọng:**
  - Status `200 OK`.
  - Body: `{ "message": "...", "total": <n>, "data": [...] }`.
  - Mỗi phần tử có đủ: `id`, `treatment_history_id`, `commission_amount`, `execution_date`, `branch_id`, `branch_name`, `staff_name`, `role_name`, `product_id`, `product_name`, `customer_name`.
  - Không gặp lỗi SQL `Unknown column 's.system_role'`.

#### TC-TR-17: STAFF tự động bị khóa theo chi nhánh của mình
- **Actor:** STAFF (Chi nhánh 1). Gọi `GET /api/treatments/commissions?branchId=2`.
- **Kỳ vọng:** Backend bỏ qua param `branchId=2` và chỉ trả về hoa hồng của Chi nhánh 1.

#### TC-TR-18: Lọc theo tên nhân viên (`staffName`) và chức vụ (`roleName`)
- **Query:** `GET /api/treatments/commissions?staffName=Nguyễn&roleName=Kỹ thuật viên`.
- **Kỳ vọng:** Chỉ trả về các bản ghi của nhân viên có họ tên chứa "Nguyễn" và role là "Kỹ thuật viên".

#### TC-TR-19: Lọc theo khoảng ngày (`startDate` và `endDate`)
- **Query:** `GET /api/treatments/commissions?startDate=2026-10-01&endDate=2026-10-31`.
- **Kỳ vọng:** Chỉ trả về các bản ghi có `DATE(execution_date)` nằm trong tháng 10/2026.

---

### Module 3.5: Hoàn tác buổi dịch vụ (`DELETE /api/treatments/execute/:historyId`)

#### TC-TR-20: Hoàn tác thành công (Happy Path)
- **Actor:** STAFF (Chi nhánh 1). `historyId = 1` thuộc Chi nhánh 1, thẻ liệu trình hiện có `remaining_sessions = 8`.
- **Request:** `DELETE /api/treatments/execute/1`.
- **Kỳ vọng:**
  - Status `200 OK`.
  - Message: `"Xóa lịch sử thực hiện và cộng lại 1 buổi thành công"`.
  - Database:
    - `treatments.remaining_sessions` được cộng lại từ 8 lên 9.
    - Bản ghi `treatment_history` (id = 1) có `deleted_at IS NOT NULL`.
    - Toàn bộ bản ghi hoa hồng `treatment_history_staffs` liên quan có `deleted_at IS NOT NULL`.

#### TC-TR-21: Thất bại khi STAFF cố hoàn tác buổi của cơ sở khác
- **Actor:** STAFF (Chi nhánh 2). Gọi `DELETE /api/treatments/execute/1` (thuộc Chi nhánh 1).
- **Kỳ vọng:** Status `400 Bad Request`, message: `"Bạn không có quyền xóa lịch sử của cơ sở khác."`.

#### TC-TR-22: Thất bại khi `historyId` không tồn tại hoặc đã bị xóa trước đó
- **Request:** `DELETE /api/treatments/execute/999999`.
- **Kỳ vọng:** Status `400 Bad Request`, message: `"Lịch sử không tồn tại hoặc đã bị xóa."`.

---

## 4. Checklist thực thi kiểm thử nhanh

| ID | Test Case | Phân quyền | Kết quả mong đợi | Trạng thái |
|:---:|---|:---:|:---:|:---:|
| 01 | Tạo thẻ thủ công | MANAGER | 201 Created, thẻ có đủ số buổi | [ ] |
| 02 | Tạo thẻ thủ công | STAFF | 403 Forbidden | [ ] |
| 03 | Tạo thẻ `remaining > total` | MANAGER | 400 Bad Request | [ ] |
| 04 | Bấm trừ 1 buổi | STAFF | 201 Created, `remaining` giảm 1 | [ ] |
| 05 | Bấm trừ buổi kèm nhân viên | STAFF | 201 Created, snapshot hoa hồng đúng role | [ ] |
| 06 | Tự động hẹn lịch tái khám | STAFF/MANAGER | Thêm 1 dòng vào `appointments` | [ ] |
| 07 | Thẻ còn 0 buổi bấm tiếp | STAFF | 400 Bad Request | [ ] |
| 08 | Gán lại nhân viên buổi cũ | STAFF | 200 OK, xóa nhân viên cũ, tính lại hoa hồng | [ ] |
| 09 | Xem báo cáo hoa hồng | MANAGER | 200 OK, đủ `role_name`, không lỗi SQL | [ ] |
| 10 | Xem hoa hồng nhân viên | STAFF | 200 OK, tự động lọc theo branch token | [ ] |
| 11 | Hoàn tác xóa buổi | STAFF | 200 OK, cộng lại 1 buổi, xóa mềm history | [ ] |
| 12 | Xóa buổi chi nhánh khác | STAFF | 400 Bad Request chặn chéo cơ sở | [ ] |
