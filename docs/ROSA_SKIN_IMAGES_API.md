# Rosa — API ảnh da

Base local: `http://localhost:5002/api/customers/:customerId/skin-image-sessions`.

## Cấu hình và phạm vi

- Chỉ bật trên cấu hình `DB_HOST=127.0.0.1`, `DB_PORT=3308`; tenant cần schema Rosa đã migrate. Tenant 7 là tenant được migrate hiện tại.
- `UPLOAD_ROOT=D:/SpaRosa/storage` là thư mục tuyệt đối bên ngoài Git. Đã cấu hình trong các file env Rosa local; không cấu hình cho O'HINA/Xuly.
- JWT Bearer của MANAGER hoặc STAFF có tenant_id hợp lệ; token khách hàng/SUPER_ADMIN bị từ chối. Không nhận tenant_id từ request body.
- Khách, lần chụp, ảnh phải thuộc đúng quan hệ trong tenant lấy từ JWT và chưa xóa mềm. Không có phân quyền theo branch vì ảnh thuộc hồ sơ khách chung của tenant.
- File được lưu dưới `tenants/<tenantId>/customers/<customerId>/<sessionId>/<uuid>.<ext>`. Response không trả file_path/đường dẫn máy chủ.
- Không phục vụ static công khai. Cần backup cả MySQL và UPLOAD_ROOT; giữ quyền filesystem chỉ cho tài khoản chạy backend/quản trị.

## Endpoint

Các đường dẫn dưới đây tương đối với base ở trên.

| Method | Đường dẫn | Kết quả |
|---|---|---|
| POST | `/` | Tạo lần chụp và upload 1–10 ảnh; 201 |
| GET | `/` | Danh sách lần chụp kèm ảnh; 200 |
| GET | `/:sessionId` | Chi tiết lần chụp kèm ảnh; 200 |
| POST | `/:sessionId/images` | Thêm 1–10 ảnh vào lần chụp; 201 |
| PUT | `/:sessionId` | Sửa captured_date/note; 200 |
| DELETE | `/:sessionId` | Xóa mềm lần chụp và tất cả ảnh đang active; 200 |
| GET | `/:sessionId/images/:imageId/file` | Trả bytes ảnh có xác thực |
| DELETE | `/:sessionId/images/:imageId` | Xóa mềm riêng ảnh; 200 |

### POST tạo lần chụp — Postman

Authorization: Bearer Token. Body: form-data (không tự đặt Content-Type vì Postman cần sinh boundary).

| Key | Type | Giá trị |
|---|---|---|
| captured_date | Text | 2026-10-27 |
| note | Text | Ảnh trước điều trị (không bắt buộc) |
| images | File | Chọn nhiều ảnh; hoặc lặp nhiều dòng images |

- Ngày bắt buộc, có thật, YYYY-MM-DD, không ở tương lai theo ngày máy backend.
- Chỉ JPEG/image/jpeg, PNG/image/png, WebP/image/webp, tối đa 10 MiB = 10485760 byte mỗi ảnh.
- Kiểm tra MIME và signature/container ở mức cơ bản; không chỉ tin tên đuôi file. Không phải giải mã đầy đủ ảnh, quét malware, resize hoặc loại EXIF. Ảnh hỏng có signature giống ảnh có thể vượt qua kiểm tra cơ bản.
- Không nhận SVG/GIF/HEIC/PDF. Không chuyển đổi định dạng.
- Tối đa 2 text field, mỗi field tối đa 65535 byte. Không gửi mảng/object dưới dạng field lồng nhau.
- Một ảnh lỗi từ chối toàn bộ đợt. Thứ tự file tạo sort_order tăng dần.
- Tối đa 4 upload đồng thời trong một process; request upload không hoạt động trong 2 phút sẽ bị ngắt. Đây không phải quota dung lượng tổng cho tenant.

Response 201 (IDs minh họa):

```json
{
  "message": "Upload ảnh thành công",
  "data": {
    "sessionId": 10,
    "images": [
      {
        "id": 20,
        "session_id": 10,
        "original_filename": "before.png",
        "mime_type": "image/png",
        "file_size": 123456,
        "sort_order": 0,
        "note": null,
        "file_url": "/api/customers/123/skin-image-sessions/10/images/20/file"
      }
    ]
  }
}
```

POST thêm ảnh: chỉ gửi `images` trong form-data; không gửi captured_date/note. Muốn sửa metadata dùng PUT. Giới hạn 10 ảnh áp dụng mỗi request, không phải tổng ảnh của lần chụp. Lần chụp được lock khi thêm ảnh để cấp thứ tự không trùng giữa các thao tác upload của API.

### GET danh sách / chi tiết

Query danh sách: `page=1&pageSize=20&startDate=2026-10-01&endDate=2026-10-27`.

- pageSize 1–100; lọc ngày bao gồm cả hai đầu. startDate <= endDate; ngày hợp lệ, không ở tương lai.
- Thứ tự lần chụp: captured_date DESC, id DESC. Ảnh: sort_order ASC, id ASC.
- Danh sách trả `{ message, total, page, pageSize, totalPages, data: [...] }`.
- Chi tiết trả `{ message, data: { id, customer_id, captured_date, note, created_at, updated_at, created_by, updated_by, images: [...] } }`.
- Metadata ảnh trong GET gồm audit fields; không trả file_path. Một lần chụp rỗng sau khi xóa riêng hết ảnh vẫn tồn tại.

### PUT metadata

Body raw JSON, gửi ít nhất một field:

```json
{
  "captured_date": "2026-10-27",
  "note": "Sau điều trị lần 1"
}
```

Bỏ field giữ nguyên. note null/chuỗi trắng xóa ghi chú; ngày không được null/rỗng. Field lạ bị từ chối. Chưa có endpoint sửa ghi chú riêng của ảnh hoặc sắp xếp lại ảnh.

### Đọc ảnh ở frontend

file_url là đường dẫn tương đối; ghép với origin backend, gọi fetch/axios có Authorization rồi tạo Blob URL. Không gắn token vào query string. Đặt src trực tiếp vào img không tự gửi Bearer header.

```js
const response = await fetch(apiOrigin + image.file_url, {
  headers: { Authorization: `Bearer ${token}` }
});
if (!response.ok) throw new Error('Không tải được ảnh');
const objectUrl = URL.createObjectURL(await response.blob());
// Gán objectUrl cho img.src; URL.revokeObjectURL(objectUrl) khi không còn sử dụng.
```

API trả Content-Type ảnh, Cache-Control private/no-store, nosniff. Ảnh/lần chụp/khách bị xóa mềm không đọc được; physical file vẫn giữ. Chưa có restore/purge ảnh. Không thay ảnh bằng cách ghi đè file.

## Lỗi / tính nhất quán

- 400: ID/ngày/metadata/file/multipart sai, thiếu ảnh, quá số file/field.
- 401: token thiếu hoặc không hợp lệ.
- 403: sai loại tài khoản/phạm vi tenant claim.
- 404: khách/lần chụp/ảnh không thuộc quan hệ yêu cầu, bị xóa hoặc thiếu file vật lý.
- 413: ảnh quá 10 MiB.
- 415: POST upload không dùng multipart/form-data.
- 429: đã có 4 upload đang xử lý trong process.
- 503: chưa cấu hình storage hoặc không phải cấu hình Rosa 3308.
- 500: lỗi lưu file/database; response không lộ chi tiết SQL/đường dẫn.

Upload dùng staging riêng mỗi request rồi transaction DB + move file. Lỗi thông thường rollback và dọn file của request trước khi response. Commit mất kết nối có thể không rõ kết quả: chỉ xóa file nếu kiểm tra không còn bản ghi tham chiếu; khi không xác định được thì giữ file và log để đối chiếu. Không có atomic transaction giữa filesystem và MySQL. Process bị kill có thể để lại file chính không có bản ghi; chưa có job tự xóa file chính mồ côi (cần đối chiếu có backup trước).

Thư mục `.tmp/upload-*` quá 24 giờ được dọn khi startup và mỗi giờ nếu UPLOAD_ROOT được cấu hình. Không dọn ảnh đã soft-delete. Không chạy hai backend dùng cùng thư mục tạm khi có upload kéo dài quá ngưỡng dọn.

## Test

```powershell
npm run test:skin-images
$env:DOTENV_CONFIG_PATH='D:\SpaConfigs\rosa.env'
npm run test:skin-images:mysql
```

Test HTTP dùng port ngẫu nhiên, thư mục file tạm riêng, MySQL thật 3308 trong outer transaction/savepoint rồi rollback. Không ghi ảnh test vào storage dùng thật. AUTO_INCREMENT có thể tăng. Test gồm upload/append/list/detail/file/update/soft-delete, auth/STAFF/tenant isolation, limits, malformed metadata/MIME, DB/disk failure và cleanup. Chưa benchmark tải lớn, chưa kiểm tra ảnh bằng decoder đầy đủ.