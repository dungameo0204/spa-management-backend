# Hướng Dẫn Cài Đặt Tự Động Máy Chủ Spa O'HINA Cho AI (Codex / Antigravity / Cursor)

Tài liệu này được thiết kế để **gửi trực tiếp cho một AI Agent** chạy trên máy chủ Windows của Spa O'HINA để tự động cài đặt toàn bộ hệ thống từ đầu mà không cần con người thao tác thủ công.

---

## 1. Thông Tin Cấu Hình Của Spa O'HINA
* **Thư mục cài đặt:** `D:\SpaBackend` (Bắt buộc ổ D)
* **Git Repository:** `https://github.com/dungameo0204/spa-management-backend.git`
* **Git Branch / Tag:** Nhánh `O'HINA` (Tag phát hành đầu tiên: `backend-ohina-v1.0.0`)
* **ServerId:** `spa-ohina`
* **Domain Backend (API):** `https://api-spa-ohina.infinityhavocx.men` (Port nội bộ `5000`)
* **Domain Frontend (CORS):** `https://app-spa-ohina.infinityhavocx.men`
* **Cloudflare R2 Bucket:** `spa-ohina`
  * **Access Key ID:** `8d01082731c2f5bc46d4c2c85bf608ee`
  * **Secret Access Key:** `f107e157982ed618dbfe5835e7eb9fce8470ea10007a26f3dcce4a812f47b482`
  * **Endpoint:** `https://91765969becc4314153c19e2a5523e50.r2.cloudflarestorage.com`

---

## 2. Nhiệm Vụ Của AI Agent (Prompt dành cho AI thực thi)

> **PROMPT DÀNH CHO AI:**
> "Bạn đang là kỹ sư DevOps phụ trách cài đặt máy chủ backend cho Spa O'HINA trên Windows. Hãy thực hiện tuần tự các bước dưới đây bằng PowerShell Administrator:"

### BƯỚC 1: Cài đặt công cụ nền tảng (nếu máy trắng)
Chạy lệnh cài Git, Node.js LTS và MySQL qua winget nếu máy chưa có:
```powershell
# Cài Git và Node.js
winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements

# Mở quyền chạy script vĩnh viễn cho máy
Set-ExecutionPolicy -Scope LocalMachine -ExecutionPolicy RemoteSigned -Force
```

### BƯỚC 2: Khởi tạo Database MySQL
1. Đảm bảo MySQL đang chạy ở port 3306.
2. Tạo 2 database và cấp quyền user `spa_backend`:
```sql
CREATE DATABASE IF NOT EXISTS `db_system_master` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS `db_spa_template` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'spa_backend'@'localhost' IDENTIFIED BY 'spa_secure_password_2026';
CREATE USER IF NOT EXISTS 'spa_backend'@'127.0.0.1' IDENTIFIED BY 'spa_secure_password_2026';

GRANT ALL PRIVILEGES ON *.* TO 'spa_backend'@'localhost' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON *.* TO 'spa_backend'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```
3. Import file `db_system_master.sql` vào database `db_system_master`.
4. Import file `db_spa_template.sql` vào database `db_spa_template`.

### BƯỚC 3: Chạy Script Bootstrap tự động
Chạy script cài đặt đã đóng gói sẵn trong gói bootstrap:
```powershell
powershell.exe -ExecutionPolicy Bypass -File "D:\SpaBackendBootstrap\Install-SpaBackend-OHINA.ps1" -Root "D:\SpaBackend" -DbPassword "spa_secure_password_2026"
```

### BƯỚC 4: Cấu hình Cloudflare Tunnel
1. Vào Cloudflare Zero Trust (one.dash.cloudflare.com) -> Networks -> Tunnels -> Tạo tunnel `spa-ohina`.
2. Cài đặt connector trên máy khách:
```powershell
winget install --id Cloudflare.cloudflared
cloudflared.exe service install <TUNNEL_TOKEN>
```
3. Trỏ Public Hostname:
   * Subdomain: `api-spa-ohina`
   * Domain: `infinityhavocx.men`
   * Service: `HTTP` -> `127.0.0.1:5000`

### BƯỚC 5: Kiểm tra kết quả
1. Gọi `curl http://127.0.0.1:5000/health` -> Trả về `{"status":"OK"}`.
2. Kiểm tra 2 Task trong Task Scheduler:
   * `SpaBackendDailyBackup` (Chạy lúc 19:15 hàng ngày đẩy lên R2).
   * `SpaBackendAutoUpdate` (Chạy lúc 19:30 hàng ngày cập nhật tag `backend-ohina-v*`).
