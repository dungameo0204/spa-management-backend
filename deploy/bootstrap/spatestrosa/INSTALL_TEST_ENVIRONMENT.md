# Cài môi trường dùng thử Spa Test Rosa trên Windows

> Mục tiêu: khởi tạo môi trường test độc lập trước vận hành chính thức. Thực hiện PowerShell bằng quyền Administrator khi tài liệu yêu cầu.

## 1. Giá trị đã chốt

| Giá trị | Nội dung |
| --- | --- |
| ServerId | `spatestrosa` |
| Backend tag | `backend-spatestrosa-v1.0.0` |
| Tag pattern | `backend-spatestrosa-v*` |
| API hostname | `api-spa-testrosa.infinityhavocx.men` |
| Frontend origin | `https://app-spa-testrosa.infinityhavocx.men` |
| Backend local port | `5000` |
| Tenant dump database | `db_spa_1791039769068_e185` |

## 2. Điều kiện trước khi cài

- Máy/MySQL database dành riêng cho test; không import vào database production.
- Port `5000`, service `SpaBackend` và thư mục `C:\SpaBackend` chưa thuộc ứng dụng khác.
- Có Node.js, Git, MySQL 8.x và WinSW x64 trên máy.
- Tài khoản MySQL có quyền tạo database/user và import schema.
- Máy có thể đọc repository Git tag `backend-spatestrosa-v1.0.0`.

Kiểm tra nhanh:

```powershell
Get-Service -Name 'SpaBackend' -ErrorAction SilentlyContinue
Get-NetTCPConnection -State Listen -LocalPort 5000 -ErrorAction SilentlyContinue
Test-Path 'C:\SpaBackend'
node --version
git --version
```

Nếu `SpaBackend`, port `5000` hoặc `C:\SpaBackend` đã được dùng bởi hệ thống không phải Rosa test, dừng và dùng máy/port/root khác đã được người phụ trách phê duyệt.

## 3. Kiểm tra và giải nén package

```powershell
Get-FileHash -Algorithm SHA256 'C:\Install\SpaBackendBootstrap_SpaTestRosa.zip'
Get-Content 'C:\Install\SpaBackendBootstrap_SpaTestRosa.zip.sha256'
Expand-Archive -LiteralPath 'C:\Install\SpaBackendBootstrap_SpaTestRosa.zip' -DestinationPath 'C:\Install'
Test-Path 'C:\Install\SpaBackendBootstrap_SpaTestRosa\INSTALL_TEST_ENVIRONMENT.md'
```

Hai hash phải khớp và `Test-Path` phải trả `True`.

## 4. Tạo database và import ba SQL export

Mở MySQL bằng tài khoản quản trị, sau đó tạo ba database rỗng với `utf8mb4`:

```sql
CREATE DATABASE `db_system_master` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE `db_spa_template` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE `db_spa_1791039769068_e185` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'spa_backend'@'127.0.0.1' IDENTIFIED BY 'TAO_MAT_KHAU_RIENG_TAI_MAY_TEST';
GRANT ALL PRIVILEGES ON `db_system_master`.* TO 'spa_backend'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `db_spa_template`.* TO 'spa_backend'@'127.0.0.1';
GRANT ALL PRIVILEGES ON `db_spa_1791039769068_e185`.* TO 'spa_backend'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Không lưu mật khẩu thật vào file SQL, chat hoặc Git. Từ PowerShell, import đúng thứ tự:

```powershell
$mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
$package = 'C:\Install\SpaBackendBootstrap_SpaTestRosa'

Get-Content -LiteralPath "$package\\db_system_master.sql" -Raw | & $mysql -u root -p db_system_master
Get-Content -LiteralPath "$package\\db_spa_template.sql" -Raw | & $mysql -u root -p db_spa_template
Get-Content -LiteralPath "$package\\db_spa_1791039769068_e185.sql" -Raw | & $mysql -u root -p db_spa_1791039769068_e185
```

Mỗi lệnh phải kết thúc thành công. Xác nhận tenant dump đã được master export đăng ký:

```sql
SELECT id, spa_name, database_name FROM db_system_master.tenants
WHERE database_name = 'db_spa_1791039769068_e185';
```

Master export có metadata tenant lịch sử khác, nhưng package không kèm database của chúng. Trong giai đoạn test, chỉ đăng nhập/thao tác tenant `db_spa_1791039769068_e185`.

## 5. Tạo cấu hình backend và deploy release

```powershell
$root = 'C:\SpaBackend'
$bootstrap = 'C:\Install\SpaBackendBootstrap_SpaTestRosa'
New-Item -ItemType Directory -Path "$root\config", "$root\scripts" -Force | Out-Null
Copy-Item -LiteralPath "$bootstrap\scripts\windows\*" -Destination "$root\scripts" -Recurse -Force
Copy-Item -LiteralPath "$bootstrap\.env.example" -Destination "$root\config\.env"
notepad "$root\config\.env"
```

Trong `.env`, thay `DB_PASSWORD` và `JWT_SECRET` bằng giá trị bí mật mạnh tại máy test; giữ nguyên `CORS_ORIGINS=https://app-spa-testrosa.infinityhavocx.men`.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& 'C:\SpaBackend\scripts\Deploy-SpaBackend.ps1' `
  -Version 'backend-spatestrosa-v1.0.0' `
  -ServerId 'spatestrosa'
```

Sau khi deploy, cài service bằng WinSW x64:

```powershell
& 'C:\SpaBackend\scripts\Install-SpaBackendService.ps1' `
  -WinSWPath 'C:\Install\WinSW-x64.exe'

Invoke-RestMethod 'http://127.0.0.1:5000/health'
```

Health phải trả `status: ok`.

## 6. Cloudflare Tunnel và frontend

Tạo Cloudflare Tunnel managed trong tài khoản quản lý domain, cài connector theo lệnh dashboard cung cấp và tạo Published Application:

```text
Hostname: api-spa-testrosa.infinityhavocx.men
Service:  http://127.0.0.1:5000
```

Không mở inbound port `5000`, `3306` hoặc `3389`. Từ mạng ngoài, kiểm tra:

```powershell
Invoke-RestMethod 'https://api-spa-testrosa.infinityhavocx.men/health'
```

Frontend production phải build với:

```text
VITE_API_BASE_URL=https://api-spa-testrosa.infinityhavocx.men
```

Sau khi publish frontend tại `https://app-spa-testrosa.infinityhavocx.men`, thử login tenant Rosa, kiểm tra request CORS và các chức năng cần demo.

## 7. Cập nhật/rollback trong giai đoạn test

Không bật `SpaBackendAutoUpdate` mặc định. Khi cần bản mới, tạo tag mới theo mẫu `backend-spatestrosa-vX.Y.Z`, sau đó deploy thủ công:

```powershell
& 'C:\SpaBackend\current\scripts\windows\Deploy-SpaBackend.ps1' `
  -Version 'backend-spatestrosa-vX.Y.Z' `
  -ServerId 'spatestrosa'
```

Nếu cần quay về release code trước:

```powershell
& 'C:\SpaBackend\current\scripts\windows\Rollback-SpaBackend.ps1'
Invoke-RestMethod 'http://127.0.0.1:5000/health'
```

Rollback chỉ đổi code; không thay đổi dữ liệu SQL đã import.