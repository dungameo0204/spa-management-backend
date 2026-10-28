# Rosa — ghi chú liên hệ lịch hẹn

## Phạm vi

Resource là `appointments`, không phải `customer_bookings`. `note` vẫn giữ ý nghĩa/nội dung hiện có (ví dụ nguồn tạo tự động từ liệu trình). Từ 28/10/2026 mỗi lần liên hệ được lưu riêng trong bảng `appointment_contact_notes`. `extra_note TEXT NULL` là bản tổng hợp tương thích, đồng bộ trong cùng transaction; GET dựng lại từ các entry chưa xóa. Không có entry: `extra_note: null`, `contact_notes: []`.

## POST /api/appointments/:id/contact-notes

Authorization: Bearer token. Chỉ MANAGER và STAFF; STAFF chỉ được thêm/sửa/xóa trên lịch hẹn thuộc branch trong token, MANAGER được thao tác các branch trong tenant. Tenant lấy từ token.

```json
{
  "content": "Đã liên hệ lần 2, khách đã đặt cọc\nKhách xác nhận sẽ đến chiều mai"
}
```

- `content` bắt buộc là chuỗi không trống sau trim, tối đa 10000 byte UTF-8, không chứa NUL. CRLF/CR được chuẩn hóa thành LF; giữ xuống dòng bên trong.
- Backend tự lấy ngày hiện tại theo UTC+07:00 (Việt Nam), định dạng DD/MM/YYYY; không dùng ngày từ client hoặc ngày hẹn. Ngày được gắn một lần ở đầu mỗi lần thêm, kể cả khi nội dung có nhiều dòng.
- Khóa lịch hẹn bằng SELECT FOR UPDATE trong transaction trước khi đọc/nối/ghi. Hai thao tác cùng lịch được tuần tự hóa. Không cập nhật `note`, `status` hoặc dữ liệu thanh toán.
- Tổng `extra_note` không vượt quá 65535 byte UTF-8. Khi vượt giới hạn: từ chối toàn bộ lần thêm, giữ nguyên dữ liệu cũ.
- Mỗi entry có ID, ngày liên hệ và metadata người/thời điểm tạo/sửa riêng. Sửa/xóa sử dụng ID, không dựa vào số dòng text.

Response HTTP 201 (ngày bên dưới chỉ minh họa):

```json
{
  "message": "Thêm ghi chú liên hệ thành công",
  "data": {
    "id": 123,
    "note_id": 15,
    "contact_date": "28/10/2026",
    "entry": "28/10/2026: Đã liên hệ lần 2, khách đã đặt cọc\nKhách xác nhận sẽ đến chiều mai",
    "extra_note": "28/10/2026: Đã liên hệ lần 2, khách đã đặt cọc\nKhách xác nhận sẽ đến chiều mai",
    "contact_notes": [
      {
        "id": 15,
        "appointment_id": 123,
        "content": "Đã liên hệ lần 2, khách đã đặt cọc\nKhách xác nhận sẽ đến chiều mai",
        "contact_date": "28/10/2026",
        "created_at": "2026-10-28T03:00:00.000Z",
        "created_by": "Nhân viên A",
        "updated_at": "2026-10-28T03:00:00.000Z",
        "updated_by": null
      }
    ]
  }
}
```

HTTP 400 theo convention controller lịch hẹn: sai payload/ID, vượt giới hạn, thiếu quyền, khác branch, không tồn tại hoặc đã xóa mềm. Thiếu/sai token: 401.

## PUT /api/appointments/:id/contact-notes/:noteId

Body `{ "content": "Nội dung đã sửa\nDòng tiếp theo" }`, validation như POST. Giữ nguyên `contact_date`, `created_at`, `created_by`; cập nhật `updated_at`, `updated_by`. Ngày client gửi không được sử dụng. Chỉ sửa entry chưa xóa thuộc đúng lịch hẹn chưa xóa. Response 200 có cấu trúc `data` như POST, `note_id` là entry vừa sửa.

## DELETE /api/appointments/:id/contact-notes/:noteId

Không cần body. Xóa mềm bằng `deleted_at`, `deleted_by`; đồng bộ `extra_note` loại entry đã xóa. Response 200: `data` có `id` lịch hẹn, `note_id` vừa xóa, `contact_date: null`, `entry: null`, `extra_note` mới và `contact_notes` còn lại. Xóa hết: `extra_note: null`, `contact_notes: []`. Xóa lại/sửa entry đã xóa hoặc note ID thuộc lịch khác bị từ chối 400. Không có API khôi phục.

Cả ba thao tác khóa lịch hẹn trước khi thay đổi và cập nhật bản tổng hợp trong cùng transaction. Sửa đồng thời cùng một entry dùng cơ chế lần lưu cuối cùng thắng, chưa có optimistic version; không lưu lịch sử các phiên bản nội dung trước khi sửa.

## Đọc và UI

GET `/api/appointments`, `/api/appointments/:id`, `/api/appointments/tomorrow`, `/api/appointments/not-arrived` trả thêm `extra_note` và `contact_notes` như response trên, giữ nguyên envelope và quyền đọc hiện có. Entry sắp theo ID tăng dần (thứ tự tạo), sửa không đổi vị trí. List tải entry theo batch cho cả trang, không query riêng từng lịch. Các dòng ghi chú hiện không được bổ sung vào bộ lọc search.

- Hiển thị `note` và ghi chú liên hệ thành hai mục riêng. Dùng `contact_notes` để hiển thị từng entry có nút Sửa/Xóa theo `entry.id`; `extra_note` dùng để hiển thị tổng hợp chỉ đọc.
- Có textarea nhập **nội dung mới** và nút “Thêm lần liên hệ”; không gửi lại toàn bộ ghi chú cũ. Không cần tự thêm ngày.
- Sau thêm/sửa/xóa lấy `data.extra_note` và `data.contact_notes` thay state hiển thị; sau thêm thành công xóa textarea. Chặn double-click trong lúc gửi: API không có idempotency key; gửi lại POST đã thành công sẽ thêm trùng.
- Render dưới dạng text với `white-space: pre-wrap` hoặc tương đương. Không dùng innerHTML, không thay newline bằng HTML trong dữ liệu lưu.
- POST tạo lịch hẹn và PUT sửa lịch hẹn từ chối payload có `extra_note` hoặc `contact_notes` (kể cả null). Frontend phải bỏ hai field này khỏi form save thông thường.
- “Đã đặt cọc” chỉ là nội dung ghi chú, không ghi nhận tiền tự động.

## Migration và kiểm thử

SQL: `docs/migrations/2026-10-27_rosa_appointment_extra_note.sql`. Runner `scripts/apply-rosa-appointment-extra-note.js` dùng guard Rosa 3308, allowlist template/tenant, manifest backup/hash và migration ledger của runner hiện có. Tên migration giữ theo đợt migration 27/10, không đại diện ngày do API sinh.

Sau đó áp dụng `docs/migrations/2026-10-28_rosa_appointment_contact_notes.sql` bằng runner `scripts/apply-rosa-appointment-contact-notes.js`, cùng guard/backup ledger. Bảng phụ có FK về appointments và index `(appointment_id, deleted_at, id)`. Bước backfill giữ nguyên toàn bộ extra_note cũ thành một entry `contact_date: null` (không đoán ngày hoặc ranh giới nhiều dòng); GET hiển thị nguyên khối đó, không thêm ngày lần nữa. Dữ liệu cũ vẫn sửa/xóa được theo ID, nhưng một khối legacy không tự tách thành từng lần.

Trước migration dừng ghi ghi chú từ code cũ; chỉ bật code mới sau cả hai bước hoàn thành. Không chạy song song writer nối text cũ với writer bảng phụ. Backup local cho bước bảng phụ: `D:/SpaRosa/backups/pre-appointment-contact-table-manifest.json`; khi kiểm tra Rosa có 82 lịch hẹn, 0 khối extra_note cần backfill, dữ liệu lịch hẹn đối chiếu hash không đổi.

Áp dụng template và tenant 7 trước khi triển khai code; các tenant khác phải được migrate trước khi dùng endpoint này. Không chạy trên 3306/3307.

- `npm run test:appointment-contact-notes`
- `DOTENV_CONFIG_PATH` trỏ cấu hình Rosa, rồi `npm run test:appointment-contact-notes:mysql`. Test tích hợp yêu cầu manifest local và đối chiếu dữ liệu lịch hẹn gốc; mọi fixture được rollback.