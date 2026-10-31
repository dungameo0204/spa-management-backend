# Áp dụng migration công ca (16/10/2026)

Sao lưu dữ liệu và tạm dừng API trước khi chạy. **Không chạy lại migration trên cùng DB**; đừng chạy `db_spa_template.sql` lên DB đang có dữ liệu vì file dump chứa `DROP TABLE`.

## Chạy trực tiếp lên MySQL từ dự án (không cần nhập SQL vào Workbench)

Lệnh dùng kết nối từ `.env`, **chỉ** thao tác DB được chỉ định. Mặc định chỉ kiểm tra schema, không ghi dữ liệu. Sau khi sao lưu DB và tạm dừng ghi, thêm `--apply` để chạy migration chưa có schema:

```powershell
npm run db:migrate:commission -- --db db_spa_1791039769068_e185
npm run db:migrate:commission -- --db db_spa_1791039769068_e185 --apply
```

Chạy riêng cho từng DB cần nâng cấp (kể cả `db_spa_template`). DB đã đủ schema được bỏ qua, DB có schema dở dang sẽ báo lỗi để kiểm tra thủ công; lệnh không tự đối soát thẻ không rõ dòng bán. **Không dùng `--apply` cho tenant đang thử nếu chưa có backup.** Lệnh này chỉ hỗ trợ migration công ca này; migration mới cần thêm runner/kiểm tra trạng thái tương ứng, không tự chạy tất cả file `.sql` khi khởi động server.

## Nếu Workbench báo lỗi 1175 tại `UPDATE treatments` sau khi `ALTER TABLE` đã thành công

**Không chạy lại từ đầu:** `CREATE TABLE` và `ALTER TABLE` đã có hiệu lực và sẽ lỗi nếu thực hiện lại. Giữ đúng schema đang chọn, trong **cùng một tab/kết nối Workbench**, chọn và chạy đoạn từ `SET @commission_migration_old_safe_updates = ...` (ngay trước `UPDATE treatments`) **đến hết file**, bao gồm câu khôi phục `SET SESSION SQL_SAFE_UPDATES = COALESCE(@commission_migration_old_safe_updates, 1);`. Không chạy riêng dòng khôi phục (biến session có thể chưa được gán) hoặc chỉ mỗi `UPDATE` (Safe Updates vẫn bật). Kiểm tra schema đang chọn bằng `SELECT DATABASE();` trước khi chạy.

Nếu đã tắt Safe Updates nhưng có lỗi khác giữa chừng, chạy `SET SESSION SQL_SAFE_UPDATES = 1;` trong cùng tab/kết nối trước khi xử lý tiếp. Không chạy lại toàn bộ migration sau khi DDL đã hoàn thành.

**Trường hợp đã chạy nhầm riêng câu khôi phục và gặp lỗi 1231:** biến `@commission_migration_old_safe_updates` là NULL trong connection này. Đừng chạy lại DDL. Chạy `USE \`db_spa_template\`;` (hoặc chọn đúng tenant), kiểm tra `SELECT DATABASE(), @@SESSION.SQL_SAFE_UPDATES;`, sau đó chạy `SET SESSION SQL_SAFE_UPDATES = 0;`, chạy cả **hai câu UPDATE** ở phần còn lại của file, cuối cùng chạy `SET SESSION SQL_SAFE_UPDATES = 1;`. Kiểm tra lại bằng `SELECT @@SESSION.SQL_SAFE_UPDATES;` (phải là 1). Nếu kết nối bị ngắt giữa chừng, thực hiện lại SET 0 trước khi chạy UPDATE. Backfill hai UPDATE có thể chạy lại; không chạy lại CREATE TABLE/ALTER TABLE.

1. Với DB template đã tồn tại, chạy SQL trong `docs/migrations/2026-10-16_commission_by_invoice_item.sql` với database mặc định là `db_spa_template`.
2. Lấy danh sách DB tenant: `SELECT id, database_name FROM db_system_master.tenants WHERE deleted_at IS NULL;`. Chạy **cùng file SQL** một lần cho mỗi `database_name` (bao gồm tenant đang bị khóa nếu cần bảo toàn dữ liệu). Ví dụ PowerShell trên máy có MySQL CLI (CLI sẽ hỏi mật khẩu, không đặt mật khẩu lên command line):

   ```powershell
   & 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' -u root -p db_spa_template --execute="source docs/migrations/2026-10-16_commission_by_invoice_item.sql"
   ```

   Hoặc mở MySQL Workbench, chọn schema mặc định rồi chạy nội dung file. Chạy lại với từng tên tenant thay cho `db_spa_template`.
3. Kiểm tra các thẻ chưa có `invoice_item_id` bằng SELECT cuối file. Nếu có nhiều dòng dịch vụ trùng product trong một hóa đơn, cần đối soát thủ công với `invoice_items` (kể cả dòng xóa mềm), không đoán theo thứ tự. Ví dụ sau khi xác minh `42` thực sự là dòng của thẻ `17`:

   ```sql
   UPDATE treatments t JOIN invoice_items ii ON ii.id = 42
   SET t.invoice_item_id = ii.id
   WHERE t.id = 17 AND t.invoice_id = ii.invoice_id AND t.product_id = ii.product_id;
   ```

    Nhánh `xuly`: thẻ thủ công cũ thiếu `commission_base_price` dùng `products.price` hiện tại khi tính công ca; giá đã nhập (kể cả 0) được giữ nguyên. Fallback này không ghi giá vào thẻ và không tự cập nhật công ca lịch sử. Có thể nhập giá và số lượng thực làm sau đối soát để cố định cơ sở tính công. Thẻ từ hóa đơn vẫn bắt buộc liên kết đúng dòng hóa đơn, không dùng fallback giá sản phẩm. Backfill công trong migration chỉ áp dụng **mức mặc định cũ** cho thẻ có liên kết duy nhất.
4. Chỉ khởi động backend mới khi template **và toàn bộ tenant đang hoạt động** đã có schema mới. Test tích hợp với DB local trước khi deploy.

**Sau khi deploy:** không sửa schema thủ công riêng lẻ nữa. Viết migration có phiên bản, chạy một lần trên template và tất cả tenant trước khi chuyển traffic sang backend mới; lưu trạng thái migration theo tenant (`schema_migrations` hoặc bảng quản lý tập trung), có backup, thử trên staging, log lỗi, khả năng tiếp tục tenant thất bại và chiến lược rollback. `CREATE TABLE ... LIKE db_spa_template` trong `tenantService` chỉ tạo cấu trúc cho **tenant mới**, không tự nâng cấp tenant cũ. SQL DDL MySQL tự commit: đừng coi migration nhiều DDL là một transaction có thể rollback.