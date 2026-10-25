# Nâng cấp ngày sinh + giá bán — 25/10/2026

Đây là runbook cho database **đã có dữ liệu**, không phải hướng dẫn import lại dump.
Chưa chạy trên máy khách. Script không tự chạy khi start/deploy backend.

## Kiểm thử local

`npm run test:customer-upgrade` chạy mock DB, không kết nối MySQL.
`npm run test:customer-upgrade:mysql` chỉ kết nối cứng `127.0.0.1:3308`, root không mật khẩu,
và kiểm tra `@@datadir` phải đúng thư mục `artifacts/mysql-customer-upgrade-test/data` của workspace trước khi ghi.
Chỉ khởi tạo instance disposable tại thư mục đó, không dùng `.env` production. Test từ chối nếu schema thử đã tồn tại;
muốn chạy lại phải chuẩn bị instance thử sạch sau khi dừng instance cũ, không trỏ sang database khác.
Test import schema vào database trống và tạo dữ liệu giả; không có dữ liệu khách hàng.

## Phạm vi và điều kiện dừng

- Thêm `customers.date_of_birth DATE NULL`; khách cũ giữ NULL.
- Nếu thiếu `products.sale_price`: thêm nullable, điền NULL bằng `price`, chuyển NOT NULL.
- Nếu cột giá đã có và đúng kiểu: chỉ điền những giá trị NULL, không chạm giá đã nhập (kể cả `sale_price >= price`).
- Nếu đã hoàn tất: chạy lại không ALTER/UPDATE. Nếu dở dang nhưng đúng kiểu: tiếp tục phần còn thiếu.
- Không sửa tổng/còn lại của thẻ, không tạo lịch sử hay hoa hồng quá khứ.
- Kiểm tra tên tenant trong `db_system_master.tenants`; template được chọn riêng bằng `--db db_spa_template`.
- Đối chiếu sự hiện diện của mọi bảng/cột nền trong schema template của release. Thiếu mục nào thì DỪNG, xem migration cũ và kiểm thử riêng. Đây không phải chứng nhận đầy đủ cho kiểu dữ liệu/index/constraint của tất cả bảng nền.
- Ngày sinh đã có phải là DATE nullable, default NULL; giá bán đã có phải là DECIMAL(15,2) không generated. Khác kiểu thì DỪNG, không tự ép kiểu dữ liệu đang có.
- MySQL DDL implicit commit: không có rollback transaction cho cả đợt. Advisory lock chỉ chặn runner cùng loại, **không chặn app/Workbench ghi**.

## 1. Kiểm kê và thử trước

Trên máy khách, ghi lại release hiện tại, phiên bản MySQL, endpoint, các tenant kể cả tenant tạm khóa, schema thực tế và task auto-update. Không gửi secret qua chat/log. Bản backend mới cần các cột mới trên mọi tenant sẽ được phục vụ hoặc mở lại.

Danh sách tenant (chỉ đọc):

```sql
SELECT id, spa_name, database_name, deleted_at FROM db_system_master.tenants ORDER BY id;
```

Khôi phục backup vào MySQL cô lập, thử đúng release và migration trên bản sao trước. Không import dump có `DROP TABLE` vào database thật. Không dùng server production chỉ vì đã đổi tên schema.

Chuẩn bị release mới trong thư mục staging có dependencies; **chưa chuyển service sang code mới**. Chạy lệnh từ thư mục release đó để dotenv đọc đúng `.env` của máy, hoặc cung cấp biến môi trường qua cơ chế kín đang dùng. DB_HOST và DB_USER phải có; DB_PORT được tôn trọng (mặc định 3306). Script in endpoint/target nhưng không in password.

```powershell
# Chạy từ release đã chuẩn bị; thay tên bằng tenant đã đối soát, không copy mù.
npm run db:migrate:customer-upgrade -- --db db_spa_1234_abcd
npm run db:migrate:customer-upgrade -- --db db_spa_template
```

Mặc định chỉ SELECT, không sửa schema/data. Nếu thiếu migration cũ: đối chiếu toàn bộ `docs/migrations`, đặc biệt commission theo invoice item, liên kết appointment và các thay đổi ví/kho/công nợ; không tự động chạy toàn bộ thư mục theo tên.

## 2. Backup, ngừng ghi và áp dụng

1. Dừng ghi từ backend, MiniApp, tác vụ nền và các công cụ khác; tạm dừng auto-update và tạo Spa mới.
2. Backup master, template và tất cả tenant liên quan bằng quy trình backup hiện có; xác nhận file và thử restore trên server cô lập. Giữ release cũ và cấu hình production để rollback.
3. Chạy dry-run một lần nữa, xác nhận endpoint và từng database.
4. Chạy từng mục đã duyệt (không có chế độ wildcard/all tự động):

```powershell
npm run db:migrate:customer-upgrade -- --db db_spa_1234_abcd --apply --backup-confirmed
npm run db:migrate:customer-upgrade -- --db db_spa_template --apply --backup-confirmed
```

`--backup-confirmed` là xác nhận của người vận hành, **script không tự tạo/kiểm chứng backup**. Migrate template sống để Spa tạo mới có cột; sửa file SQL trong Git không cập nhật template đang chạy. Các dump schema chỉ dành cho cài mới/DB thử trống.

### Workbench error 1175 / migration bị ngắt

Không chạy lại ADD COLUMN mù. Runner kiểm tra metadata trước; nếu `sale_price` đã thêm nullable, runner tiếp tục backfill NULL và NOT NULL. Nó lưu/khôi phục `SQL_SAFE_UPDATES` trên **cùng session**, kể cả backfill lỗi; không thay cấu hình global. Nếu schema không tương thích hoặc lỗi DDL, giữ maintenance và kiểm tra trước khi tiếp tục.

Chạy tay chỉ dành cho người hiểu trạng thái hiện tại: file `2026-10-25_customer_date_of_birth.sql` và `2026-10-22_product_sale_price.sql` là SQL tham khảo **không idempotent**. Ưu tiên runner; không tắt Safe Updates toàn hệ thống, không ghi đè giá bán đã nhập.

## 3. Đối soát và deploy

Chạy với từng database đã chọn trong Workbench:

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'customers' AND COLUMN_NAME = 'date_of_birth')
    OR (TABLE_NAME = 'products' AND COLUMN_NAME = 'sale_price'));
SELECT COUNT(*) AS missing_sale_price FROM products WHERE sale_price IS NULL;
SELECT COUNT(*) AS known_birthdays FROM customers WHERE date_of_birth IS NOT NULL;
SELECT id, price, sale_price FROM products WHERE sale_price >= price;
SELECT id, total_sessions, remaining_sessions FROM treatments
WHERE remaining_sessions < 0 OR remaining_sessions > total_sessions;
```

Kỳ vọng DATE nullable, DECIMAL(15,2) NOT NULL, missing_sale_price = 0. Ngày sinh cũ vẫn NULL trừ dữ liệu đã nhập trước đó. Giá đã có giữ nguyên; giá mới backfill bằng price kể cả sản phẩm xóa mềm. `sale_price >= price` legacy không phải lý do tự giảm giá. Dữ liệu thẻ bất thường phải đối soát, không sửa tự động.

Deploy backend bằng tag **mới**, giữ cấu hình/secret; không thay tag đã phát hành. Script deploy hiện tại không migrate DB. Phối hợp frontend: product POST phải gửi hai giá, hóa đơn gửi `items[].unit_price = sale_price` (fallback hiện tại vẫn là price). Migrate xong mọi tenant/template cần thiết rồi mới bật code và mở ghi.

Smoke test: GET /auth/me; tạo/sửa/list/detail/overview khách có ngày sinh; xóa ngày sinh bằng NULL; tạo thẻ tổng 10 còn 4 và kiểm tra còn 3 sau một buổi; thẻ bỏ số còn lại mặc định đủ tổng; product legacy sửa note không đổi giá; tạo/sửa hóa đơn với giá bán rõ ràng. Dùng bản sao/staging cho thử nghiệp vụ trước, không tạo giao dịch giả trên dữ liệu thật.

Rollback: dừng ghi, chuyển release cũ khi đã xác minh tương thích. Giữ cột bổ sung; không DROP cột để rollback code. Nếu cần phục hồi dữ liệu, dùng backup đã thử restore và đối soát giao dịch sau backup; rollback service không rollback database. Chỉ bật lại auto-update sau khi hoàn tất.