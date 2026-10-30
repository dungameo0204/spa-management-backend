# Thu nợ cũ không có hóa đơn

## Triển khai

Chạy migration `docs/migrations/2026-10-29_legacy_debt_payments.sql` trên database template và từng tenant cần dùng (backup, chọn đúng database trước). Migration cho phép `debt_payments.invoice_id = NULL`, không tạo hóa đơn giả và không đổi dữ liệu hiện có. Schema template đã được cập nhật. Không triển khai API mới trước khi migration hoàn tất.

## Tạo phiếu

`POST /api/debt-payments/legacy`, header `Authorization: Bearer <TOKEN>`.

```json
{
  "customer_id": 123,
  "amount": 500000,
  "collection_branch_id": 2,
  "payment_method": "CASH",
  "note": "Thu nợ chuyển từ hệ thống cũ"
}
```

- Chỉ MANAGER/STAFF. MANAGER bắt buộc gửi `collection_branch_id`; STAFF lấy cơ sở từ token, không được gửi cơ sở khác.
- `customer_id` và `amount` bắt buộc. Số tiền > 0, tối đa 2 chữ số thập phân.
- `payment_method`: CASH (mặc định), TRANSFER, CARD.
- `payment_date` tùy chọn, cùng định dạng API thu nợ hiện tại; mặc định thời điểm thu. `note` tùy chọn.
- Không gửi `invoice_id` (hoặc gửi null). Nếu gửi `branch_id`, phải trùng cơ sở thu.
- Nợ cũ có thể thu = `customers.total_debt` trừ tổng nợ còn lại của các hóa đơn chưa xóa. Nợ còn lại mỗi hóa đơn = max(0, debt_amount - tổng phiếu thu theo hóa đơn chưa xóa).
- Không được thu vượt phần nợ cũ. Khách có cả nợ cũ và nợ hóa đơn vẫn dùng được API, nhưng phần nợ hóa đơn phải thu bằng API hiện tại.
- Ghi phiếu và giảm `total_debt` trong một transaction, khóa khách hàng để tránh thu vượt khi gọi đồng thời.

Response HTTP 201 (ID minh họa):

```json
{
  "message": "Ghi nhận thu nợ cũ thành công",
  "debtPaymentId": 456,
  "customerId": 123,
  "branchId": 2,
  "collectionBranchId": 2,
  "invoiceId": null,
  "amount": 500000,
  "totalDebt": 1000000
}
```

Sai payload, vượt nợ, thiếu khách/cơ sở hoặc không được thao tác: HTTP 400 với `{ "message": "..." }`. Thiếu/sai token: 401.

## Số dư để frontend hiển thị

Hai API hiện có trả thêm `invoice_debt` và `legacy_debt`:

- `GET /api/customers/:id`: trong `data`.
- `GET /api/customers/:id/overview`: trong `data.customer`; không đổi purchases/treatments/timeline.

Ví dụ phần dữ liệu khách (các trường khác giữ nguyên):

```json
{
  "id": 123,
  "total_debt": "1500000.00",
  "invoice_debt": 1000000,
  "legacy_debt": 500000
}
```

- `total_debt` giữ kiểu hiện tại từ database; hai trường mới luôn là number.
- `invoice_debt` = tổng max(0, debt_amount - tổng phiếu thu theo hóa đơn chưa xóa) trên mọi hóa đơn chưa xóa của khách trong tenant.
- `legacy_debt` = max(0, total_debt - invoice_debt), cùng công thức giới hạn của API thu nợ cũ. Tổng nợ và nợ hóa đơn được đọc trong cùng một câu SQL.
- Phạm vi toàn khách hàng, không phụ thuộc cơ sở người dùng, phân trang, danh sách hóa đơn đang hiển thị hoặc bộ lọc ngày/cơ sở. API danh sách khách chưa thêm hai trường này.
- Nếu dữ liệu lệch khiến invoice_debt > total_debt, trả đúng nợ hóa đơn thực tế và legacy_debt = 0; không tự sửa số dư để ép tổng khớp.
- Form thu nợ cũ hiển thị “Có thể thu tối đa” bằng legacy_debt. Sau thu/sửa/xóa tải lại chi tiết hoặc tổng quan; backend vẫn kiểm tra số dư trong transaction tại thời điểm thu.
- Ví dụ thu nợ cũ 200.000: total_debt còn 1.300.000, invoice_debt giữ 1.000.000, legacy_debt còn 300.000. Thu theo hóa đơn thì total_debt và invoice_debt cùng giảm, legacy_debt giữ nguyên.
- Không cần migration bổ sung cho các trường số dư tính toán này.

## Xem, sửa, xóa

Dùng các API hiện tại: `GET /api/debt-payments`, `GET /api/debt-payments/:id`, `PUT /api/debt-payments/:id`, `DELETE /api/debt-payments/:id`.

- Nhận diện phiếu nợ cũ bằng `invoice_id === null`. Chi tiết `invoice_total_amount` và `invoice_debt_amount` cũng null. Không phụ thuộc hóa đơn để hiển thị phiếu.
- Sửa hỗ trợ amount, customer_id, collection_branch_id (MANAGER), payment_method, payment_date, note. Chỉ gửi trường cần sửa. Số tiền cũ được hoàn lại khi kiểm tra số tiền mới; đổi khách sẽ hoàn nợ khách cũ và giảm nợ khách mới trong cùng transaction.
- Không chuyển phiếu nợ cũ thành phiếu hóa đơn hoặc ngược lại.
- STAFF chỉ sửa/xóa phiếu tại cơ sở của mình. Xóa mềm hoàn lại nợ đúng số tiền phiếu, xóa lần nữa bị từ chối.
- `POST /api/debt-payments` vẫn **bắt buộc invoice_id**, không thay đổi quy tắc cũ.

## Báo cáo

- Phiếu nợ cũ lưu `branch_id = collection_branch_id`: cả dòng tiền và doanh thu thuộc cơ sở thực thu, theo `payment_date`.
- `receipts.debtPayments` bao gồm cả thu nợ cũ và thu nợ hóa đơn; tiền thu chỉ được cộng một lần vào `receipts.total` và `netCashFlow`.
- `GET /api/reports/revenue` bổ sung `legacyDebtRevenue` cho tổng kỳ và từng phần tử `daily`.
- `totalRevenue = serviceRevenue + productRevenue + legacyDebtRevenue`. Không phân nợ cũ vào sản phẩm/dịch vụ vì không có hóa đơn gốc.
- Phiếu thu **có hóa đơn** không được cộng thêm vào doanh thu (doanh thu đã ghi nhận khi bán); cơ chế phân cơ sở của phiếu có hóa đơn giữ nguyên.
- Xóa mềm phiếu sẽ loại khoản thu khỏi báo cáo; sửa ngày/cơ sở/số tiền cập nhật báo cáo tương ứng.
- Frontend cần dùng `totalRevenue` từ backend hoặc tính thêm `legacyDebtRevenue`, không tiếp tục giả định tổng doanh thu chỉ có hai thành phần sản phẩm/dịch vụ.

## Kiểm thử

- `npm run test:legacy-debt`: test service/HTTP bằng SQL double, phân quyền, nợ hỗn hợp, sửa/xóa, rollback, hồi quy thu theo hóa đơn và báo cáo.
- `npm run test:legacy-debt:mysql`: tự tạo một MySQL instance tách biệt tại port 3349 trong thư mục artifacts riêng cho mỗi lần chạy, không đọc .env, xác minh datadir trước khi tạo schema. Cần MySQL Server 8.0 cài local; có thể chỉ định executable qua `LEGACY_TEST_MYSQLD`. Test migration chạy lặp/giữ FK, công nợ, báo cáo, thu đồng thời và snapshot sau khi chờ khóa. Instance test được dừng sau khi chạy; artifacts được giữ để kiểm tra.