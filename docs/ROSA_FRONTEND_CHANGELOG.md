# Rosa — hướng dẫn thay đổi cho frontend

## Bổ sung: ghi chú liên hệ lịch hẹn

- Resource `/api/appointments` (không phải customer-bookings) có thêm `extra_note` tổng hợp và `contact_notes` (mảng entry có ID/ngày/nội dung/metadata) ở các API đọc, tách riêng `note` nguồn lịch hẹn.
- Nút “Thêm lần liên hệ” gửi `POST /api/appointments/:id/contact-notes` với `{ "content": "Đã liên hệ, khách hẹn gọi lại" }`. Backend tự thêm ngày Việt Nam DD/MM/YYYY và nối dòng, không ghi đè lịch sử.
- Sửa từng entry: `PUT /api/appointments/:id/contact-notes/:noteId` body `{ "content": "Nội dung đúng" }`, giữ ngày tạo. Xóa mềm: `DELETE` cùng đường dẫn, không cần body. Lấy noteId từ `contact_notes[].id`.
- Hiển thị text bằng `white-space: pre-wrap`. Sau thêm/sửa/xóa thay state bằng `data.contact_notes` và `data.extra_note`. Không gửi hai field này trong POST/PUT lịch hẹn thông thường. Chặn double-click khi gửi.
- Chi tiết payload/response, quyền branch, giới hạn và lỗi: `ROSA_APPOINTMENT_CONTACT_NOTES_API.md`.

**Chốt nội dung ngày 27/10/2026.** Tài liệu này dành cho việc phát triển frontend Rosa từ bản giao diện cũ: đọc phần thay đổi ở đây trước, sau đó mở đúng mục trong tài liệu API để lấy hợp đồng đầy đủ.

Phạm vi là các thay đổi đã làm trong đợt tách môi trường Rosa và phát triển chức năng Rosa, **bao gồm code chưa commit**. Đây là tổng hợp từ implementation và tài liệu của đợt làm việc, không phải báo cáo đầy đủ mọi commit giữa main và rosa. Không mặc định tất cả API khác đều thay đổi.

## 1. Kết nối đúng môi trường

- Backend local Rosa được kiểm tra trong cấu hình hiện tại: **http://127.0.0.1:5002**, API prefix `/api`. Cổng là **5002, không phải 5502**. Nếu dùng tunnel/deployment khác, lấy origin từ cấu hình triển khai thực tế.
- MySQL Rosa: **127.0.0.1:3308**; frontend không kết nối MySQL trực tiếp. Không trỏ frontend Rosa vào backend cũ 5000/MySQL 3306.
- Tenant đã nâng cấp hiện tại: **tenant 7**. Đăng nhập lấy token đúng môi trường; backend lấy tenant từ JWT, không truyền tenant_id để lựa chọn spa trong payload.
- Backend origin nên cấu hình qua biến môi trường frontend, không hardcode rải rác. Không đưa thông tin DB hoặc đường dẫn storage vào frontend.
- API list dùng `{ message, total, page, pageSize, totalPages, data: [...] }`; chi tiết thường `{ message, data: {...} }`. Create invoice/treatment/booking có ID ở cấp ngoài, không tự giả định tất cả create đều có `data`.
- `pageSize` tối đa 100. Khi đổi search/filter đặt lại page=1. Các giá trị DECIMAL đọc từ MySQL có thể là chuỗi; chuyển đổi rõ ràng khi tính/hiển thị tiền. Không chuyển null số buổi thành 0.

## 2. Bản đồ màn hình cần sửa và chỗ đọc chi tiết

Các tên file bên dưới nằm cùng thư mục docs với tài liệu này.

| Màn hình/luồng | Thay đổi chính | Đọc chi tiết |
|---|---|---|
| Form hồ sơ khách | 16 field hồ sơ, loại da/nguồn giới thiệu nhiều lựa chọn | `API_FRONTEND.md` → mục 11, “Hồ sơ Rosa — bổ sung ngày 27/10/2026” |
| Album ảnh da trong hồ sơ | Lần chụp có nhiều ảnh, ngày chụp, tải file có xác thực | `ROSA_SKIN_IMAGES_API.md` |
| Tạo/sửa dịch vụ | Chọn danh sách dịch vụ con theo thứ tự | `ROSA_PRODUCT_COMPONENTS_API.md` |
| Bán hàng/tạo hóa đơn | Chọn dịch vụ con và số buổi riêng cho khách ngay trong item | `ROSA_TREATMENT_GROUPS_API.md` → Invoice creation |
| Danh sách/chi tiết liệu trình | Thẻ gốc + children, lifetime, lịch sử riêng, trạng thái theo chữ ký kết thúc | `ROSA_TREATMENT_GROUPS_API.md` → Reads |
| Thực hiện buổi | Ghi chú và chữ ký khách của chính buổi đó | `API_FRONTEND.md` → POST /api/treatments/execute; `ROSA_TREATMENT_GROUPS_API.md` → Per-session note and signature |
| Ký kết thúc nhóm | STAFF/MANAGER cho khách ký tại thẻ gốc, đóng cả nhóm | `ROSA_TREATMENT_GROUPS_API.md` → Signed completion |
| Tổng quan khách | Purchases/timeline ghép thẻ gốc; children/history lồng bên trong | `API_FRONTEND.md` → GET /api/customers/:id/overview |
| Booking do nhân viên đặt | CRUD, NEW/EXISTING, giờ hẹn, has_arrived, quyền xem toàn spa | `ROSA_CUSTOMER_BOOKINGS_API.md`; `API_FRONTEND.md` → mục 17 |

`ROSA_SCHEMA.md` giải thích schema/migration cho backend, không phải hợp đồng payload frontend. Các ghi chú “schema-only” trong lịch sử migration mô tả giai đoạn trước; API hiện đã có theo các tài liệu chuyên đề ở trên.

## 3. Hồ sơ khách hàng

API cũ `POST /api/customers`, `PUT /api/customers/:id` được mở rộng; GET list/detail và `overview.data.customer` trả thêm các field. Giữ envelope và trường ví/công nợ hiện có.

| Field gửi/nhận | Ý nghĩa trên form | Kiểu/quy tắc chính |
|---|---|---|
| profile_code | Mã hồ sơ Rosa | Tùy chọn, <=50 ký tự, không tự sinh; duy nhất trong spa kể cả khách xóa mềm |
| profile_date | Ngày lập hồ sơ | YYYY-MM-DD hoặc null, không ở tương lai |
| gender | Giới tính | MALE / FEMALE / OTHER hoặc null |
| skin_types | Các loại/tình trạng da | Mảng mã hoặc null |
| referral_sources | Nguồn biết đến spa | Mảng mã hoặc null |
| referral_note | Ghi chú người/nguồn giới thiệu | Text/null |
| previous_skin_treatments | Các điều trị da trước đây | Text/null |
| peeling_products_history | Lịch sử sản phẩm peel đã dùng | Text/null |
| current_skincare_products | Sản phẩm chăm sóc hiện dùng | Text/null |
| skincare_routine | Quy trình chăm sóc da | Text/null |
| pigmentation_onset | Thời điểm/diễn biến xuất hiện sắc tố | Text, không phải date |
| family_skin_history | Tiền sử da gia đình | Text/null |
| pregnancy_and_medical_history | Thai kỳ và tiền sử bệnh lý | Text/null |
| cosmetic_reaction_history | Tiền sử phản ứng mỹ phẩm | Text/null |
| skin_assessment | Đánh giá tình trạng da | Text/null |
| consultation_note | Nội dung tư vấn hồ sơ | Text/null; khác ghi chú buổi thực hiện |

Mã `skin_types`: DRY (khô), OILY_ACNE (dầu/mụn), SENSITIVE_DAMAGED (nhạy cảm/tổn thương), AGING (lão hóa), COMBINATION (hỗn hợp), PIGMENTED (tăng sắc tố), OTHER (khác).

Mã `referral_sources`: TIKTOK, FACEBOOK, FRIEND (bạn giới thiệu), OTHER.

- Dùng lại fullname, phone_number, date_of_birth, address; không có cột tuổi mới. Tuổi hiển thị tự tính từ ngày sinh nếu cần.
- Mảng gửi JSON array thực, ví dụ `"skin_types": ["DRY"]`, không JSON.stringify riêng field. `null` = chưa ghi nhận, `[]` = đã ghi nhận nhưng không chọn mã nào.
- PUT bỏ field = giữ nguyên; null = xóa giá trị tùy chọn. Text được trim; rỗng thành null; TEXT tối đa 65535 byte UTF-8.
- Ngày sinh/ngày hồ sơ là ngày lịch: gửi YYYY-MM-DD, hiển thị DD/MM/YYYY nếu cần; tránh chuyển qua UTC/toISOString làm lệch ngày.
- Search khách hỗ trợ mã hồ sơ ngoài tìm kiếm thông tin khách hiện có. Không ghi wallet_balance/total_debt từ form hồ sơ.

## 4. Ảnh da: nhóm theo lần chụp, không phải một mảng đường dẫn trên khách

Base resource: `/api/customers/:customerId/skin-image-sessions`.

| Endpoint | Frontend dùng để |
|---|---|
| POST base | Tạo lần chụp và upload nhiều ảnh |
| GET base / GET base/:sessionId | Danh sách/chi tiết lần chụp, kèm images |
| POST base/:sessionId/images | Thêm ảnh vào lần chụp đã có |
| PUT base/:sessionId | Sửa ngày chụp/ghi chú chung |
| DELETE base/:sessionId | Xóa mềm lần chụp và ảnh bên trong |
| GET base/:sessionId/images/:imageId/file | Tải bytes ảnh bằng Bearer token |
| DELETE base/:sessionId/images/:imageId | Xóa mềm riêng ảnh |

- MANAGER/STAFF đều dùng được, không giới hạn branch vì ảnh thuộc hồ sơ khách chung của spa.
- POST tạo dùng FormData: `captured_date` (ngày chụp YYYY-MM-DD, không tương lai), `note` (ghi chú chung tùy chọn), các file cùng key `images`. Không tự set Content-Type multipart boundary.
- Mỗi request 1–10 ảnh, mỗi ảnh <=10 MiB; JPEG/PNG/WebP. Không nhận HEIC/SVG/GIF/PDF. Giới hạn 10 là mỗi request, không phải tổng số ảnh của lần chụp.
- `captured_date` khác `created_at`: ảnh cũ có thể nhập hôm nay nhưng ngày chụp là ngày trước. Có nhiều lần chụp trong cùng ngày.
- Response tạo có `data.sessionId`, `data.images[]`; GET có id lần chụp và images. Metadata ảnh: `id`, `session_id`, `original_filename`, `mime_type`, `file_size` (byte), `sort_order`, `note`, `file_url`.
- `file_url` là đường dẫn API tương đối, không phải đường dẫn ổ đĩa/static public. Fetch bằng Authorization rồi tạo Blob URL cho img; revokeObjectURL khi không dùng. Gắn src trực tiếp không tự mang Bearer header.
- Xóa là xóa mềm, không có restore/purge trên UI. Chưa có sửa note riêng từng ảnh hoặc kéo-thả đổi thứ tự ảnh.

## 5. Dịch vụ con trong danh mục: child_service_ids

POST/PUT `/api/products` nhận `child_service_ids: [12,15,18]`; GET list/detail trả mảng ID theo thứ tự.

- Đây là **cấu hình các dịch vụ con có thể chọn khi bán**, không phải số buổi/thẻ liệu trình thực tế của khách.
- Cha và con đều phải là dịch vụ (`is_product=false/0`), ID không trùng, tối đa 200; không được tự chứa mình hoặc tạo vòng lặp. Một dịch vụ có thể thuộc nhiều gói.
- PUT bỏ field giữ nguyên; gửi [] gỡ hết; gửi mảng mới thay toàn bộ và lấy thứ tự mảng làm thứ tự danh mục. Không gửi null hay chuỗi ID.
- Cấu hình này không tự đổi is_treatment_combo và không sửa lại thẻ đã bán. Thay danh mục không làm thay đổi lịch sử của khách.
- STAFF/MANAGER có thể sửa cấu hình theo luồng hiện tại, nhưng STAFF không được ghi commissions/commission_tiers.
- Có chặn xóa/đổi sang bán lẻ/khôi phục khi quan hệ cha–con không hợp lệ. UI nên hiển thị message lỗi, không coi mọi thao tác danh mục đều luôn thành công.

## 6. Hóa đơn: tạo nhóm thẻ ngay trong request bán hàng

**Không tạo hóa đơn xong rồi gọi POST /api/treatments lần nữa.** Backend tạo invoice/item/thẻ cha/con trong một transaction; frontend gửi lựa chọn ngay trong item:

```json
{
  "product_id": 20,
  "quantity": 1,
  "unit_price": 4500000,
  "treatment": {
    "total_sessions": null,
    "children": [
      { "product_id": 12, "total_sessions": 5 },
      { "product_id": 15, "total_sessions": null },
      { "product_id": 18, "total_sessions": 0 }
    ]
  }
}
```

Đây là một phần tử trong `items[]` của POST /api/invoices, không phải toàn bộ payload hóa đơn. Header khách/cơ sở/thanh toán vẫn theo hợp đồng invoice hiện có.

| Field/giá trị | Ý nghĩa |
|---|---|
| items[].treatment | Cấu hình thẻ thực tế dành riêng khách mua dòng này |
| treatment.total_sessions | Tổng buổi cha: số nguyên dương hoặc null = trọn đời; không nhận 0 |
| children[].product_id | ID dịch vụ con trong cấu hình child_service_ids của dịch vụ cha |
| children[].total_sessions > 0 | Tạo thẻ con hữu hạn với số buổi đó |
| children[].total_sessions = null | Tạo thẻ con trọn đời |
| children[].total_sessions = 0 | Bỏ qua, không tạo thẻ con đó |
| thiếu total_sessions / âm / số lẻ | Không hợp lệ, không có nghĩa là bỏ qua |

- Explicit treatment yêu cầu quantity=1; nhiều gói tách thành nhiều dòng. Không tự nhân số buổi cấu hình với quantity.
- children có thể bỏ, [] hoặc toàn 0: chỉ tạo cha. ID con vẫn phải hợp lệ kể cả con được gửi 0.
- Không gửi giá cho child. Giá snapshot hoa hồng con lấy từ products.price, không sale_price, không cộng thêm tiền hóa đơn. Chỉ cha là dòng tính tiền.
- Không gửi treatment: giữ hành vi cũ — dịch vụ thường tạo thẻ 1 buổi; combo default_sessions × quantity; hàng bán lẻ không tạo thẻ.
- Response POST invoice có invoiceId, totalAmount, debtAmount, walletUsed và itemMappings; mapping gồm request_index, invoice_item_id, treatment_id, cùng children khi tạo cấu hình explicit. Dùng ID thực từ response để mở chi tiết.
- GET invoice detail trả `data.items[].treatment` là thẻ gốc thật + children hoặc null. Không đọc cấu hình products rồi tự dựng lại thẻ khách.
- Invoice PUT không nhận thay đổi treatment; hóa đơn có thẻ lifetime/cha–con/đã ký bị chặn sửa và xóa bằng luồng hiện tại. UI phải xử lý lỗi, không tự xóa/tạo lại thẻ để lách.

## 7. Hiển thị thẻ liệu trình và trạng thái

- GET /api/treatments: data ngoài chỉ là **thẻ gốc**, total/phân trang cũng tính gốc. Các con ở children, không render trùng như dòng top-level.
- GET /api/treatments/:id: thẻ + children; mỗi thẻ có histories và staffs riêng. Có thể gọi detail trực tiếp ID con.
- Con hết buổi hoặc đã ký vẫn được trả nếu chưa xóa mềm. Không filter con bằng remaining_sessions > 0 trên frontend.
- Cha có children không được bấm thực hiện; thao tác buổi nằm trên con. Không suy rằng cha còn buổi là toàn nhóm còn thực hiện được.
- total_sessions=null là lifetime. Lifetime mở: remaining_sessions=null. Lifetime đóng: total_sessions vẫn null, remaining_sessions=0 và closed_at có giá trị. Không dùng `value || 0` để hiển thị lifetime.

| Query status | Điều kiện/nhãn UI |
|---|---|
| active | closed_at IS NULL: đang mở/chưa ký kết thúc; có thể đã hết buổi |
| exhausted | closed_at IS NULL và remaining_sessions=0: hết buổi, chờ ký kết thúc |
| completed | closed_at IS NOT NULL: đã ký kết thúc |

**Hết buổi khác đã ký kết thúc.** Ký xác nhận một buổi cũng không làm thẻ thành completed. Filters áp dụng lên thẻ gốc; children không bị loại theo trạng thái của bộ lọc. Không gửi status thì bao gồm mọi thẻ gốc chưa xóa mềm.

## 8. Ghi chú và hai loại chữ ký — không dùng lẫn

### 8.1 Thực hiện một buổi

POST /api/treatments/execute nhận treatment_id, branch_id theo quyền hiện có, staffs tùy chọn; bổ sung:

| Field | Ý nghĩa |
|---|---|
| note | Ghi chú **của buổi này**, khác treatments.note và consultation_note trên hồ sơ |
| customer_signature_svg | Chữ ký khách xác nhận buổi này; bỏ/null là chưa ký |
| customer_signed_at | Chỉ đọc, server tự ghi khi có chữ ký; không gửi từ client |

note tùy chọn, trim, <=65535 byte UTF-8; rỗng/null thành null. Chữ ký được lưu lúc tạo buổi, cùng transaction trừ buổi/history/hoa hồng. Request cũ không gửi vẫn hoạt động. Response create giữ treatmentHistoryId; metadata đọc lại trong histories của detail/overview.

Chưa có API sửa ghi chú hoặc ký bổ sung sau khi tạo buổi. Frontend nên cho nhập/ký trong modal thực hiện trước khi submit, không hứa chức năng edit sau đó.

### 8.2 Ký kết thúc cả nhóm

POST /api/treatments/:id/close, id phải là **thẻ gốc**, MANAGER và STAFF đều dùng được:

```json
{
  "closure_note": "Khách xác nhận hoàn thành liệu trình",
  "closure_signature_svg": "<svg width=\"300\" height=\"100\"><path d=\"M 10 20 L 50 60\"/></svg>"
}
```

- Chữ ký bắt buộc, note tùy chọn. Ký cha đóng cha và tất cả con chưa xóa mềm trong một transaction, kể cả thẻ còn buổi/lifetime; cần UI xác nhận rõ tác động trước khi gửi.
- Response có treatmentId và closedTreatmentIds. Sau thành công tải lại nhóm; các thẻ có closed_at, closed_by, closure_note, closure_signature_svg, remaining_sessions=0. Tổng buổi/history/hoa hồng không bị xóa bởi thao tác đóng.
- Không ký riêng từng con qua endpoint này. Không ghi đè chữ ký/không có mở lại; lặp lại trả 409. Closed cards không thực hiện tiếp; undo lịch sử theo luồng hiện có không mở lại thẻ đã đóng.

### 8.3 Định dạng SVG chung

Chữ ký là chuỗi SVG nét vẽ, tối đa 128 KiB: svg root có viewBox hoặc width/height số; path trực tiếp và thuộc tính nét vẽ allowlist. Không phải ảnh base64/PNG; không gửi arbitrary SVG chứa g/text/image/style/script/event handler/link/entity. Chuỗi rỗng là lỗi, không phải unsigned. Cần kiểm tra export của thư viện signature pad có phù hợp trước khi tích hợp. Chi tiết validator ở tài liệu treatment groups.

Hiển thị note như text; chữ ký qua image/Blob URL, không chèn SVG nhận về bằng HTML tùy ý. Phân biệt rõ nhãn “Ký xác nhận buổi” và “Ký kết thúc toàn bộ liệu trình”.

## 9. Tổng quan khách hàng

GET /api/customers/:id/overview tiếp tục có customer, purchases, treatments, timeline:

- customer có thêm các field hồ sơ Rosa.
- treatments ngoài chỉ là gốc với children và histories riêng. Không flatten children rồi cộng thêm vào danh sách gốc.
- purchases[].treatment ghép thẻ gốc bằng invoice_item_id, không đoán theo product_id/tên dịch vụ. Các dòng bán trùng dịch vụ vẫn là các dòng riêng.
- timeline dùng để tránh render một lần mua và thẻ của lần mua đó thành hai lần. Thẻ con không thành timeline item riêng.
- remaining=0 vẫn hiển thị; lịch sử có note/chữ ký của buổi. completed_sessions hữu hạn nhập cũ có thể là tổng-trừ-còn-lại, không đồng nghĩa số history thực trên hệ thống; lifetime/closed lấy số history chưa xóa. Không tự tạo history giả để khớp số buổi nhập cũ.

## 10. Booking nội bộ nhân viên — đầy đủ thêm/sửa/xóa

Resource `/api/customer-bookings`: POST/GET list và GET/PUT/DELETE /:id. Không phải luồng MiniApp; không dùng customer token.

| Field gửi/nhận | Ý nghĩa/quy tắc |
|---|---|
| customer_type | NEW = chưa chọn khách hệ thống; EXISTING = khách đã đăng ký |
| customer_id | EXISTING bắt buộc ID đang hoạt động; NEW phải bỏ/null |
| customer_name, customer_phone | Thông tin snapshot của booking. NEW bắt buộc; EXISTING mặc định từ khách khi chọn, cho phép override |
| branch_id | Cơ sở hẹn; MANAGER chọn, STAFF tạo mặc định branch token nếu bỏ |
| product_id | Sản phẩm/dịch vụ dự kiến, tùy chọn/null |
| arrival_date | Ngày hẹn đến YYYY-MM-DD, bắt buộc; khác ngày tạo booking |
| arrival_time | Giờ hẹn HH:mm/HH:mm:ss hoặc null = chưa chốt giờ |
| promotion_note | Ghi chú chương trình ưu đãi, không phải số tiền chiết khấu invoice |
| consultation_total | Số tiền tư vấn tham khảo, không âm, tối đa 2 chữ số thập phân; không phát sinh doanh thu/nợ |
| note | Ghi chú booking |
| status | Trạng thái nghiệp vụ chuỗi <=50, mặc định PENDING; backend chưa áp ENUM/luồng chuyển trạng thái |
| booking_time | Legacy, chỉ đọc; backend ghép ngày/giờ hẹn, null nếu chưa có giờ. Không gửi |
| has_arrived | Boolean chỉ đọc tính động, giải thích bên dưới |
| created_at/audit fields | Thời điểm/người tạo/sửa/xóa do server quản lý; không gửi |

- Cả STAFF/MANAGER **xem toàn bộ booking trong cùng spa**, branchId là filter tùy chọn. Không xem chéo spa.
- STAFF thêm/sửa/xóa vẫn trong branch token; không suy quyền ghi toàn spa từ quyền xem toàn spa. MANAGER thao tác các cơ sở hợp lệ trong tenant.
- PUT partial: bỏ field giữ nguyên, null xóa trường nullable. Đổi loại khách phải thỏa đủ quy tắc NEW/EXISTING; không chỉ đổi mỗi customer_type mà để customer_id sai loại.
- NEW không tự tạo customer. DELETE chỉ xóa mềm booking, không xóa khách/hóa đơn/thẻ. Không có restore booking.
- Create trả `{message, bookingId}` (201); update/delete 200. Sau submit tải lại list/detail để nhận field tính động; không gửi lại nguyên GET object vì có field read-only/join.

### 10.1 Search và lọc ngày/giờ

```http
GET /api/customer-bookings?search=Lan&branchId=1&startDate=2026-10-27&endDate=2026-10-30&startTime=07:00&endTime=08:00&page=1&pageSize=20
```

- search gần đúng tên/SĐT snapshot, note hoặc tên dịch vụ; customerId/productId/status là lọc chính xác.
- Khoảng ngày áp dụng arrival_date; khoảng giờ áp dụng arrival_time trên **từng ngày** trong khoảng ngày. Không phải khoảng datetime liên tục từ ngày đầu 07h đến ngày cuối 08h.
- Bao gồm hai đầu: 07:00:00 đến 08:00:00. Gửi một đầu được. Có filter giờ thì loại giờ null. Giờ sai/rỗng hoặc startTime>endTime trả 400; không hỗ trợ qua đêm.
- Danh sách sắp arrival_date, arrival_time, created_at, id tăng dần; phân trang sau các filter. Giờ null hiển thị “Chưa chốt giờ”, không ép thành 00:00.

### 10.2 has_arrived không phải check-in thủ công

True khi có ít nhất một invoice **hoặc thẻ liệu trình được tạo**, chưa xóa mềm, cho khách đó từ **00:00 ngày tạo booking (`created_at`) đến DB NOW()** theo timezone session MySQL.

- Không lấy ngày hẹn arrival_date làm mốc; khách có thể đến sớm hơn lịch hẹn. Phát sinh cùng ngày nhưng trước giờ nhân viên tạo booking vẫn được tính.
- EXISTING ghép đúng customer_id. NEW không có ID ghép SĐT đăng ký **trùng chính xác** với customer_phone; không dò tên, không match một phần, không tự chuẩn hóa +84/0/dấu cách/dấu gạch. Nếu nhiều khách cùng SĐT thì bất kỳ khách khớp có phát sinh hợp lệ cũng tính.
- Không giới hạn cơ sở/dịch vụ của phát sinh; vẫn trong cùng tenant. Xem created_at của invoice/card, không invoice_date và không treatment_history. Khách chỉ dùng buổi trên thẻ cũ mà không có invoice/card mới trong khoảng không được đánh dấu chỉ từ history đó.
- Phát sinh trước ngày tạo, ở tương lai hoặc đã xóa mềm không tính. Nếu không ghép được khách thì false. Đổi/xóa mềm chứng cứ có thể khiến lần GET sau thay đổi kết quả.
- Không tự đổi status booking, không thêm cột DB; UI dùng badge “Đã có phát sinh”/“Chưa có phát sinh” hoặc giải thích rõ nếu ghi nhãn “Đã đến”. Không coi đây là xác minh khách đã có mặt vật lý.

## 11. Checklist phát triển và kiểm thử frontend

1. Xác nhận base URL 5002/đúng tunnel và token tenant Rosa; không dùng nhầm API cũ.
2. Làm form hồ sơ với enum/multi-select/ngày đúng kiểu; kiểm tra PUT partial/null và lỗi trùng profile_code.
3. Làm album lần chụp, upload nhiều file và authenticated image loading; kiểm tra giới hạn định dạng/dung lượng.
4. Làm danh mục child_service_ids trước; dùng nó làm nguồn lựa chọn trên dòng bán, không dùng thay cho cards thực tế.
5. Làm invoice item treatment: finite/lifetime/skip, quantity=1, gọi duy nhất POST invoice; đọc lại nhóm từ invoice/treatment detail.
6. Hiển thị root/children/history; phân biệt active/exhausted/completed và lifetime null. Không cho execute cha có con.
7. Làm modal buổi có note/chữ ký; test SVG export. Làm riêng modal kết thúc nhóm và xác nhận đóng mọi con, cả STAFF/MANAGER.
8. Làm booking CRUD, NEW/EXISTING, ngày/giờ tách biệt, search/range filters, all-branch reads, branch-scoped STAFF writes và has_arrived read-only.
9. Xử lý 400 validation, 401 token, 403 quyền, 404 dữ liệu không còn, 409 xung đột/đã ký; upload có thêm 413/415/429/503. Hiển thị message API và refresh sau mutation, không sửa state giả là backend đã thành công.

Các test backend đã chạy trong đợt triển khai gồm customer-profile, ảnh, product-components, invoice/treatment groups và booking HTTP/MySQL trên Rosa 3308 với rollback dữ liệu test. Đây không thay thế kiểm thử trình duyệt/signature pad/frontend; tranh chấp nhiều connection và tải lớn chưa được kiểm chứng đầy đủ.

### Chưa có — không dựng UI như thể API đã hỗ trợ

- Ký bổ sung/sửa ghi chú buổi sau khi tạo, ghi đè chữ ký kết thúc, mở lại nhóm đã ký.
- Sửa cấu hình nhóm qua PUT invoice, quy trình amendment/refund chuyên biệt.
- Restore/purge ảnh, đổi thứ tự ảnh, sửa ghi chú riêng từng ảnh.
- MiniApp booking theo schema Rosa, check-in vật lý, tự đổi status theo has_arrived.
- Tự sửa thẻ đã bán khi danh mục child_service_ids thay đổi.