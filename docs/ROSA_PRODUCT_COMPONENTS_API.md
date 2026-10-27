# Rosa: dịch vụ con trong products

Áp dụng schema Rosa đã có bảng product_service_components; tenant hiện tại là tenant 7 trên MySQL 3308. Không cần migration mới. Không lưu thêm JSON vào products. API nhận/trả mảng child_service_ids, bảng liên kết lưu mỗi cặp cha/con cùng sort_order và audit fields.

## Tạo / sửa

POST /api/products (Bearer MANAGER/STAFF, raw JSON):

```json
{
  "name": "Gói chăm sóc da tổng hợp",
  "price": 5000000,
  "sale_price": 4500000,
  "is_product": false,
  "child_service_ids": [12, 15, 18]
}
```

ID minh họa phải thay bằng dịch vụ đang tồn tại trong tenant. Cha và con đều phải là dịch vụ (is_product=0/false). Mảng tối đa 200 phần tử, chỉ nhận JSON number nguyên dương trong phạm vi INT signed; không nhận chuỗi số, null, object, ID trùng, bản thân, ID đã xóa/khác tenant/sản phẩm bán lẻ. Chặn chu trình trực tiếp và gián tiếp. Một dịch vụ có thể thuộc nhiều gói và có thể có con riêng, miễn không tạo chu trình.

- POST không gửi field: không có con.
- PUT /api/products/:id không gửi field: giữ nguyên.
- PUT gửi child_service_ids: thay toàn bộ danh sách, thứ tự mảng là thứ tự hiển thị.
- PUT gửi []: gỡ hết liên kết con (xóa mềm quan hệ).
- Sản phẩm bán lẻ được gửi [] hoặc bỏ field; mảng không rỗng trả 400.
- Gỡ rồi thêm lại dùng cùng cặp unique cha/con, khôi phục liên kết và cập nhật sort_order, không tạo cặp trùng.
- Field khác, giá, tồn kho, commission vẫn theo API products cũ. STAFF được sửa quan hệ nhưng không được ghi commissions/commission_tiers.

PUT ví dụ:

```json
{ "child_service_ids": [18, 12] }
```

Response tạo vẫn `{ message, productId }` (201), sửa vẫn `{ message }` (200). Dữ liệu sai trả 400; commission không đủ quyền 403; tenant graph lock chờ quá 10 giây trả 409.

## Đọc

GET /api/products và GET /api/products/:id thêm child_service_ids theo sort_order,id. Dịch vụ thường/sản phẩm bán lẻ trả []. Chỉ trả con chưa xóa và là dịch vụ. List lấy các liên kết cho cả trang bằng một query, không query riêng từng sản phẩm. Không tự trả cấu trúc lồng nhiều cấp.

```json
{
  "id": 20,
  "name": "Gói chăm sóc da tổng hợp",
  "is_product": 0,
  "child_service_ids": [18, 12]
}
```

## Đổi loại, xóa, khôi phục

- Chặn đổi sang sản phẩm bán lẻ khi còn liên kết cha/con chưa xóa mềm, kể cả liên kết từ cha đang xóa mềm. Có thể gỡ hết con và đổi loại trong cùng PUT nếu không còn ai tham chiếu nó.
- DELETE chặn nếu dịch vụ đang được cha chưa xóa mềm sử dụng; cần gỡ liên kết trước.
- Xóa cha giữ cấu hình con ở trạng thái dormant; không xóa sản phẩm con hay các thẻ đã bán.
- Khôi phục cha kiểm tra lại con còn hoạt động, đúng loại và không tạo chu trình. Nếu con đã xóa, khôi phục con trước.
- Đồ thị hoạt động được kiểm tra trên toàn tenant; dữ liệu quan hệ lỗi do thao tác SQL ngoài API có thể chặn cập nhật cho đến khi được sửa.

Mọi thao tác tạo/sửa/xóa/khôi phục products lấy advisory lock cùng tenant trước transaction và nhả sau commit/rollback. Điều này tuần tự hóa các thao tác quản trị products trong tenant để tránh race vòng lặp/đổi loại; SQL thủ công không tuân thủ lock vẫn có thể làm sai quan hệ. Quy mô hiện tại dùng kiểm tra đồ thị toàn tenant, chưa benchmark dữ liệu rất lớn.

## Ranh giới danh mục và thẻ thực tế

- Không tự đổi is_treatment_combo.
- Danh mục không tự sinh thẻ cho khách. Invoice hiện nhận items[].treatment.children để tạo nhóm thực tế trong cùng transaction; xem docs/ROSA_TREATMENT_GROUPS_API.md. Không gửi cấu hình treatment thì giữ hành vi invoice cũ.
- Danh mục không tự chọn số buổi con. Khi bán, frontend gửi số buổi/null/0 riêng từng con; giá snapshot hoa hồng con lấy products.price, không phải giá frontend gửi và không cộng thành dòng tiền mới.
- Không thay đổi thẻ/hóa đơn lịch sử khi sửa danh mục.

## Test

```powershell
npm run test:product-components
$env:DOTENV_CONFIG_PATH='D:\SpaConfigs\rosa.env'
npm run test:product-components:mysql
```

MySQL test chạy HTTP port ngẫu nhiên, outer transaction/savepoint rồi rollback; AUTO_INCREMENT có thể tăng. Kiểm tra CRUD, thứ tự, clear/readd, partial update, dữ liệu sai, chu trình, shared child, đổi loại, xóa/khôi phục, quyền STAFF, khóa bị connection khác chiếm và rollback lỗi. Test lock contention không phải stress test nhiều writer độc lập. Không dùng script product-sale-price cũ vì script đó yêu cầu instance test 3307 riêng, không phải môi trường Rosa hiện tại.