# Rosa — sửa ghi chú buổi và ký bổ sung

## Luồng frontend

1. Gọi POST `/api/treatments/execute` tạo buổi như hiện tại; note/chữ ký lúc tạo vẫn tùy chọn.
2. Dùng `treatmentHistoryId` trong response hoặc `histories[].id` trong detail/overview để mở đúng buổi.
3. Nhân viên có thể cập nhật ghi chú buổi cả trước và sau khi khách ký.
4. Khách làm xong, ra về: ký vào buổi đã tạo, không gọi execute lần nữa.

Đây là note/chữ ký của `treatment_history`, không phải `treatments.note`, `appointments.note` hoặc contact-notes lịch hẹn. Không thay đổi DB/schema; dùng các cột đã có.

## PUT /api/treatments/execute/:historyId/note

Authorization Bearer token MANAGER/STAFF của tenant. STAFF chỉ được thao tác buổi có `branch_id` bằng branch trong token. Không giới hạn buổi phải tạo/thực hiện hôm nay; note sửa được cả trước/sau khi ký và khi thẻ đã đóng, miễn buổi/thẻ chưa bị xóa.

```json
{
  "note": "Da hơi đỏ sau thực hiện\nDặn khách theo dõi thêm"
}
```

- Body object chỉ nhận field `note`, bắt buộc có; null hoặc chuỗi trắng xóa nội dung thành NULL.
- Chuỗi tối đa 65535 byte UTF-8, trim hai đầu, giữ newline bên trong. Sai kiểu/vượt giới hạn trả 400.
- Note là ghi chú của nhân viên, được sửa/xóa nội dung cả khi buổi đã ký. Chữ ký và thời điểm ký giữ nguyên.
- Thay toàn bộ nội dung note của buổi, không phải nối thêm entry.

## POST /api/treatments/execute/:historyId/sign

Cùng quyền như sửa note.

```json
{
  "customer_signature_svg": "<svg width=\"300\" height=\"100\"><path d=\"M 10 20 L 50 60\"/></svg>"
}
```

- Body chỉ nhận `customer_signature_svg`, bắt buộc SVG nét vẽ hợp lệ, không nhận null/rỗng. Dùng cùng validator an toàn và giới hạn 128 KiB như ký lúc execute/ký kết thúc nhóm.
- Client không gửi `customer_signed_at`; server ghi NOW() tại thời điểm ký thật, không lấy execution_date.
- Không ký lại/ghi đè chữ ký đã có (409). Không có API xóa chữ ký.
- Ký buổi không đóng liệu trình; ký đóng nhóm vẫn dùng POST `/api/treatments/:id/close`.
- Thẻ hết buổi hoặc đã đóng vẫn cho ký bổ sung buổi cũ chưa ký. Thẻ/buổi bị xóa thì không cho thao tác (404).

## Response

Cả hai API trả 200, ví dụ:

```json
{
  "message": "Cập nhật ghi chú buổi thành công",
  "data": {
    "id": 321,
    "treatment_id": 123,
    "branch_id": 1,
    "note": "Da hơi đỏ sau thực hiện\nDặn khách theo dõi thêm",
    "customer_signature_svg": null,
    "customer_signed_at": null,
    "updated_at": "2026-10-28T03:00:00.000Z",
    "updated_by": "Nhân viên A"
  }
}
```

Sau ký: `message` là `Ký xác nhận buổi thành công`, chữ ký và thời điểm ký có giá trị; note giữ nguyên. Các timestamp trả theo serialization MySQL/Node như API hiện có; frontend không tự suy ra thời điểm ký từ ngày thực hiện.

Lỗi: 400 payload/ID sai; 401 token thiếu/sai; 403 role/tenant claim không hợp lệ hoặc STAFF khác chi nhánh; 404 buổi/thẻ không tồn tại hoặc đã xóa; 409 chỉ khi ký lại buổi đã ký, không áp dụng cho sửa note. Field lạ bị từ chối ở hai API này, không thay đổi quy tắc contact-note lịch hẹn.

## An toàn và hiển thị

- Transaction khóa bản ghi history trước khi sửa/ký để tuần tự hóa cập nhật. Sửa note không thay đổi chữ ký hoặc thời điểm ký dù diễn ra trước hay sau ký. Hai lần sửa note cùng lúc: lần lưu cuối thắng, chưa có version check.
- Chỉ cập nhật metadata history và updated_by/updated_at; không tạo buổi mới, không trừ/hoàn buổi, không đổi lịch hẹn, phân công/hoa hồng hay đóng thẻ.
- Không lưu lịch sử phiên bản note trước khi sửa. Note là ghi chú nhân viên có thể thay đổi sau ký, không phải bản nội dung bất biến được chữ ký xác nhận.
- Sau response cập nhật entry history tương ứng, hoặc tải lại detail/overview; các reads này đã trả note/chữ ký/thời điểm ký.
- UI luôn cho Sửa note theo quyền, không khóa theo trạng thái chữ ký. Chỉ hiện Ký xác nhận khi cả customer_signature_svg/customer_signed_at chưa có; sau ký chữ ký chỉ đọc. Disable khi gửi để tránh gửi hai lần.
- Render note dưới dạng text (`white-space: pre-wrap`), chữ ký qua image; không chèn SVG/HTML tùy ý vào DOM.

## Kiểm thử

`npm run test:treatment-history-followup:mysql` với DOTENV_CONFIG_PATH cấu hình Rosa 3308. Test HTTP/MySQL dùng fixture rollback: quyền role/branch, note tiếng Việt nhiều dòng/null, SVG an toàn, ngày server, buổi cũ/hết buổi/đã đóng, chặn ghi đè/đã xóa, rollback khi lỗi sau update, GET history và đối chiếu thẻ/số history/hoa hồng không đổi.