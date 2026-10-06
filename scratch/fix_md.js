const fs = require('fs');
let content = fs.readFileSync('docs/API_FRONTEND.md', 'utf8');

const oldSection = content.substring(content.indexOf('13. Nhập kho /api/inventory-imports'));

const newSection = `## 13. Nhập kho \`/api/inventory-imports\`

Tạo phiếu nhập dùng transaction: tạo header, các item snapshot và cập nhật \`inventory.quantity\` cùng lúc.

*Lưu ý Phân quyền: STAFF chỉ xem/tạo phiếu ở cơ sở mình, và chỉ được SỬA/XÓA phiếu nhập trong ngày. MANAGER được toàn quyền mọi cơ sở.*

### \`POST /api/inventory-imports\`

\`\`\`json
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
\`\`\`

| Field | Bắt buộc | Quy tắc |
|---|:---:|---|
| \`import_code\`, \`items\` | Có | \`import_code\` unique; \`items\` không rỗng. |
| \`branch_id\` | Không | MANAGER bắt buộc truyền. STAFF có thể bỏ trống (tự lấy từ Token). |
| \`import_date\` | Không | Bỏ qua thì dùng thời điểm hiện tại. |
| \`supplier_name\`, \`note\` | Không | Chuỗi hoặc null. |
| \`items[].product_id\`, \`quantity\`, \`unit_price\` | Có | Product active; quantity > 0; unit price >= 0; không lặp product. |
| \`items[].discount_percent\`, \`discount_amount\` | Không | Default 0; percent 0–100, amount >= 0. |

> Frontend không gửi \`total_amount\`, \`product_name\`, \`total_price\`. Backend tự tính tiền và lưu snapshot. Nếu thành tiền âm, API từ chối.

Thành công \`201\`:
\`\`\`json
{
  "message": "Tạo phiếu nhập kho thành công",
  "inventoryImportId": 5,
  "totalAmount": 5700000
}
\`\`\`

### \`GET /api/inventory-imports\`
Lọc nâng cao theo: \`search\` (Mã/NCC), \`branchId\`, \`startDate\`, \`endDate\` (YYYY-MM-DD). Trả về danh sách phiếu nhập.

### \`GET /api/inventory-imports/:id\`
Trả header (kèm \`branch_name\`) và \`items\` snapshot.

### \`PUT /api/inventory-imports/:id\`
Ghi đè phiếu nhập (Cấu trúc giống POST). Sử dụng Transaction để hoàn trả tồn kho cũ, và tính toán lại tồn kho mới an toàn.

### \`DELETE /api/inventory-imports/:id\`
Xóa mềm phiếu nhập kho và trừ lại số lượng tồn kho tự động.

---

## 14. Quản lý Phiếu chi \`/api/expenses\`

Quản lý các khoản chi tiêu, thanh toán của Spa (tiền điện, nước, v.v.).
*Lưu ý Phân quyền: STAFF chỉ xem/thêm/sửa/xóa phiếu chi tại cơ sở của mình. MANAGER được toàn quyền.*

### \`POST /api/expenses\`

\`\`\`json
{
  "branch_id": 1,
  "amount": 500000,
  "expense_type": "Thanh toán tiền điện",
  "note": "Tiền điện tháng 9",
  "expense_date": "2026-10-04 10:00:00"
}
\`\`\`

| Field | Bắt buộc | Quy tắc |
|---|:---:|---|
| \`amount\` | Có | Số tiền chi >= 0. |
| \`expense_type\` | Có | Loại phiếu chi. |
| \`branch_id\` | Không | MANAGER bắt buộc truyền. STAFF tự lấy từ token. |
| \`expense_date\` | Không | (YYYY-MM-DD HH:mm:ss). |
| \`note\` | Không | Ghi chú thêm. |

Thành công \`201\`:
\`\`\`json
{
  "message": "Tạo phiếu chi thành công",
  "expenseId": 1,
  "amount": 500000
}
\`\`\`

### Các API khác của Phiếu chi:
- **\`GET /api/expenses\`**: Hỗ trợ \`search\`, \`branchId\`, \`startDate\`, \`endDate\`.
- **\`GET /api/expenses/:id\`**: Lấy chi tiết phiếu.
- **\`PUT /api/expenses/:id\`**: Cập nhật thông tin phiếu.
- **\`DELETE /api/expenses/:id\`**: Xóa mềm phiếu chi.

---

## 15. Quản lý Hóa đơn Bán hàng \`/api/invoices\`

Xử lý giao dịch thanh toán, tự động trừ ví, tính công nợ, chia hoa hồng nhân viên và sinh thẻ liệu trình qua Transaction.
*Lưu ý Phân quyền: STAFF chỉ tạo/xem được hóa đơn ở cơ sở mình, và chỉ được SỬA/XÓA hóa đơn được tạo trong ngày hôm nay.*

### \`POST /api/invoices\`

\`\`\`json
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
        { "staff_id": 2, "revenue_amount": 500000, "role_type": "Tư vấn chính" }
      ]
    }
  ]
}
\`\`\`

| Field | Bắt buộc | Quy tắc |
|---|:---:|---|
| \`customer_id\`, \`items\` | Có | Khách hàng phải tồn tại; \`items\` không rỗng. |
| \`paid_amount\`, \`wallet_used\` | Không | Mặc định 0. Backend chặn nếu ví không đủ. |
| \`discount_percent\`, \`discount_amount\` | Không | Chiết khấu tổng hóa đơn. |
| \`items[].consultants\` | Không | Mảng nhân viên tư vấn/chăm sóc (để chia hoa hồng). |

> **Backend tự động:** Tính công nợ, giảm trừ ví, sinh thẻ liệu trình (nếu sp có \`is_treatment_combo = 1\`).

Thành công \`201\`:
\`\`\`json
{
  "message": "Tạo hóa đơn thành công",
  "invoiceId": 12,
  "totalAmount": 1350000,
  "debtAmount": 350000,
  "walletUsed": 500000
}
\`\`\`

### Các API khác của Hóa đơn:
- **\`GET /api/invoices\`**: Lọc theo \`search\`, \`branchId\`, \`startDate\`, \`endDate\`, \`productName\`, \`minAmount\`, \`maxAmount\`.
- **\`GET /api/invoices/:id\`**: Trả về Header + \`items\` + \`consultants\`.
- **\`PUT /api/invoices/:id\`**: Cập nhật ghi đè toàn bộ items. Transaction tự khôi phục nợ/ví/kho cũ rồi áp dụng cái mới.
- **\`DELETE /api/invoices/:id\`**: Xóa mềm hóa đơn, trả tiền ví, trừ nợ, và thu hồi liệu trình. Nếu liệu trình đã bị sử dụng, chặn xóa.

---

## 16. Thẻ Liệu trình \`/api/treatments\`

Hệ thống **tự động sinh** thẻ liệu trình khi mua hóa đơn. Các API này dùng để xem thẻ và theo dõi việc thực hiện (trừ buổi).

### \`GET /api/treatments\`
Lấy danh sách thẻ liệu trình của khách hàng. Yêu cầu query \`?customerId=...\`. 

### \`GET /api/treatments/:id\`
Xem chi tiết số buổi đã dùng, còn lại, và danh sách \`histories\` (Lịch sử các lần làm dịch vụ).

### \`POST /api/treatments/execute\`
Trừ 1 buổi liệu trình (Khách hàng đến làm dịch vụ).

\`\`\`json
{
  "treatment_id": 1,
  "branch_id": 1,
  "staffs": [
    { "staff_id": 2, "commission_amount": 50000 }
  ]
}
\`\`\`
- Chặn nếu \`remaining_sessions = 0\`. Trừ đi 1 buổi và chia hoa hồng cho \`staffs\` thực hiện.

### \`DELETE /api/treatments/execute/:historyId\`
Hoàn tác (Xóa) 1 buổi đã thực hiện. Tự động cộng lại 1 buổi vào thẻ và thu hồi hoa hồng KTV.

---

## 17. MiniApp (Chưa sử dụng)
Các endpoint \`/api/miniapp/*\` được định nghĩa nhưng chưa mount trong \`src/server.js\`.

---

## 18. Database và Lưu ý tích hợp
Xem cấu trúc bảng trong tài liệu đính kèm. Hầu hết API danh mục không trả bản ghi bị \`deleted_at IS NOT NULL\`. 
`;

content = content.replace(oldSection, newSection);
fs.writeFileSync('docs/API_FRONTEND.md', content);
console.log('Fixed markdown file');
