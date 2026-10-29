# Rosa — sửa hóa đơn và số buổi liệu trình

## PUT /api/invoices/:id

Không cần schema mới. Quyền chi nhánh/ngày sửa STAFF và chặn hóa đơn đã có phiếu thu nợ giữ nguyên. Gửi toàn bộ `items` không rỗng như luồng sửa cũ, không phải PATCH một dòng. Field không gửi ở header giữ theo luồng hiện tại. Dòng cũ nên gửi `invoice_item_id` lấy từ GET invoice; bắt buộc khi có nhiều dòng cùng dịch vụ để tránh ghép nhầm thẻ.

```json
{
  "items": [
    {
      "invoice_item_id": 123,
      "product_id": 20,
      "quantity": 1,
      "unit_price": 4500000,
      "treatment": {
        "total_sessions": null,
        "children": [
          { "product_id": 12, "total_sessions": 3 },
          { "product_id": 15, "total_sessions": null }
        ]
      }
    }
  ]
}
```

## Quy tắc số buổi

- Thẻ mở hữu hạn: đã dùng lấy mức lớn hơn giữa tổng cũ − còn cũ và số history chưa xóa, bảo toàn số dư đã nhập/chuyển từ hệ cũ.
- Thẻ trọn đời hoặc đã đóng: số đã dùng lấy số history chưa xóa; không tính tổng − 0 của thẻ đã ký.
- Tổng mới hữu hạn phải >= số đã dùng. 5 dùng 2: đổi tổng 3 còn 1; đổi 2 còn 0; đổi 1 bị từ chối.
- Tổng mới null = trọn đời; còn lại null khi mở. Đổi trọn đời sang hữu hạn cũng kiểm tra số đã làm.
- Thẻ đóng luôn còn 0; sửa tổng không mở lại, không đổi closed_at/closed_by/chữ ký/ghi chú đóng.
- Mỗi con tính riêng theo history/số dư của nó; không trừ vào cha. ID thẻ, ngày tạo, note thẻ và history được giữ nguyên.

## Cấu hình và liên kết

- `treatment` chỉ nhận `total_sessions`, `children`; cấu hình tường minh và các dòng nhóm/trọn đời/đóng yêu cầu quantity=1.
- Bỏ `treatment` trên dòng nhóm/trọn đời/đóng: giữ cấu hình đang bán, không dựng lại theo danh mục. Dòng dịch vụ thường quantity=1 giữ số buổi riêng đã chốt; combo thường vẫn dùng default_sessions × quantity như luồng cũ khi không có cấu hình tường minh.
- Có treatment nhưng bỏ children: giữ các con hiện tại. Gửi children là danh sách mong muốn đầy đủ; con bỏ khỏi danh sách hoặc total_sessions=0 bị loại chỉ khi chưa dùng/chưa ký.
- Con hiện có ghép theo product_id trong cùng cha; giữ snapshot giá công của con dù danh mục đã đổi giá/cấu hình. Không nhận giá con từ client. Con mới phải thuộc cấu hình danh mục hiện tại, snapshot products.price khi thêm.
- Chặn đổi khách nếu thẻ/nhóm đã dùng hoặc đã đóng. Chặn thêm con mới vào nhóm đã đóng; chặn chuyển thẻ đã thực hiện trực tiếp thành nhóm con. Nhóm nhiều tầng cần đối soát, chưa hỗ trợ sửa bằng luồng này.
- Dòng mới dùng quy tắc POST hiện có; frontend không tạo thêm thẻ sau PUT. Các dòng invoice_items được tạo lại theo luồng cũ, nhưng ID thẻ không đổi. Cập nhật liên kết invoice_item_id cho cha và các con, nên GET invoice lại sau save.
- Giá hóa đơn sửa theo unit_price, tính lại công ca của thẻ cha theo luồng cũ nếu có history; snapshot công của thẻ con và công ca con hiện có không thay đổi khi chỉ sửa số buổi/giá cha.
- Transaction chung với tiền/ví/nợ/kho: lỗi bất kỳ rollback toàn bộ. Response PUT giữ envelope hiện tại, không tự giả định có itemMappings như POST.

## DELETE /api/invoices/:id

Nhóm/trọn đời không còn bị chặn chỉ vì loại thẻ. Chỉ cho xóa nếu tất cả thẻ chưa có history hoạt động, chưa dùng số dư hữu hạn và chưa ký đóng. Xóa mềm toàn bộ thẻ invoice cùng các dòng, hoàn kho/ví/nợ theo logic cũ. Không tự xóa history để cho phép xóa hóa đơn, không hỗ trợ hoàn tiền/mở lại thẻ đã ký.

## Kiểm thử

`npm run test:invoice-notes`, `npm run test:treatment-groups:mysql` (DOTENV_CONFIG_PATH Rosa 3308). Test MySQL dùng transaction/savepoint rollback, không tạo dữ liệu thật lâu dài. Bao gồm sửa 5→3 sau 2 buổi, bằng số dùng, dưới số dùng, lifetime↔finite, ID/history/snapshot, chữ ký đóng, thiếu treatment, quyền chi nhánh, rollback lỗi thanh toán và xóa nhóm chưa dùng.