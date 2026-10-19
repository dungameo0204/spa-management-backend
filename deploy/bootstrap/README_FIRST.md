# Spa Backend Bootstrap

Đây là gói hỗ trợ **cài lần đầu** trên máy Windows của khách. Gói không chứa mật khẩu, `.env` thật, database dump, tunnel token, `node_modules` hoặc toàn bộ source backend.

## Cách dùng

1. Giải nén gói vào:

   ```text
   C:\Install\SpaBackendBootstrap
   ```

2. Nếu chạy Codex trực tiếp trên máy khách, mở Codex tại thư mục trên và gửi prompt:

   ```text
   Đọc C:\Install\SpaBackendBootstrap\INSTALL_CUSTOMER_SERVER_TOMORROW.md.
   Bạn đang chạy trực tiếp trên máy Windows production của khách.
   Chỉ thực hiện mục kiểm kê chỉ đọc trước, chưa thay đổi hệ thống.
   Thực hiện từng giai đoạn, dừng sau mỗi giai đoạn để tôi xác nhận.
   Tuân thủ toàn bộ điều kiện DỪNG và không yêu cầu secret trong chat.
   ```

3. Không chạy ngay file SQL hoặc PowerShell trước khi hoàn tất kiểm kê và backup theo tài liệu.

4. Kiểm tra hash của ZIP bằng file `.sha256` được tạo cùng ZIP trước khi copy sang máy khách.

## Nội dung chính

- `INSTALL_CUSTOMER_SERVER_TOMORROW.md`: tài liệu điều phối chính.
- `db_system_master.sql`, `db_spa_template.sql`: schema database mới.
- `scripts\windows\`: deploy, service, backup, rollback và auto-update.
- `deploy\windows\SpaBackend.xml`: cấu hình WinSW.
- `.env.example`: danh sách biến môi trường mẫu, không chứa secret thật.
- `manifest.json`: danh sách và SHA-256 của từng file trong gói.

Backend thật được `Deploy-SpaBackend.ps1` tải từ Git repository theo tag đã duyệt.