# Cài Rosa production trên Windows

> Thực hiện trong PowerShell **Run as Administrator**. Không paste password, JWT, R2 key hay Cloudflare Tunnel token vào chat, Git, screenshot hoặc log.

## 1. Thông số chốt

| Giá trị | Nội dung |
| --- | --- |
| Server ID | `sparosa-production` |
| API public | `https://api-spa-rosa.infinityhavocx.men` |
| Frontend public | `https://app-spa-rosa.infinityhavocx.men` |
| Backend port nội bộ | `5000` |
| Master DB | `db_system_master` |
| Template DB | `db_spa_template` |
| Local backup retention | 10 ngày |
| R2 retention | 4 daily recovery points + 4 weekly recovery points |

## 2. Dừng nếu máy không sạch

Không import/cài đè nếu `C:\SpaBackend`, port `5000`, service `SpaBackend` hoặc `cloudflared` đang thuộc một hệ thống khác. Kiểm tra:

```powershell
Get-Service -Name 'SpaBackend','cloudflared' -ErrorAction SilentlyContinue
Get-NetTCPConnection -State Listen -LocalPort 5000 -ErrorAction SilentlyContinue
Test-Path 'C:\SpaBackend'
node --version
git --version
```

Máy cần MySQL 8.x, Node.js LTS, Git, WinSW x64 và AWS CLI v2. MySQL phải listen loopback; không public `3306`.

## 3. Kiểm tra và giải nén ZIP

```powershell
Get-FileHash -Algorithm SHA256 'C:\Install\SpaBackendBootstrap_SpaRosaProduction.zip'
Get-Content 'C:\Install\SpaBackendBootstrap_SpaRosaProduction.zip.sha256'
Expand-Archive -LiteralPath 'C:\Install\SpaBackendBootstrap_SpaRosaProduction.zip' -DestinationPath 'C:\Install'
$bootstrap = 'C:\Install\SpaBackendBootstrap_SpaRosaProduction'
Test-Path "$bootstrap\INSTALL_PRODUCTION.md"
```

Hai hash phải giống nhau và `Test-Path` phải là `True`.

## 4. Khởi tạo MySQL và import schema sạch

1. Mở `mysql-initialize-rosa.sql`, chỉ thay `ROSA_BACKEND_PASSWORD` bằng password random mạnh tạo **ngay trên server**. Không lưu file đã thay password.
2. Chạy SQL này bằng MySQL administrator. `SHOW GRANTS` phải cho thấy quyền master/template, namespace ``db\_spa\_%`` và `CREATE ON *.*` cho `rosa@127.0.0.1`.
3. Import hai schema dưới đây vào hai database tương ứng. Các file sẽ drop/create table trong database đã chọn; chỉ thực hiện trên instance Rosa trống.

```powershell
$mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
$bootstrap = 'C:\Install\SpaBackendBootstrap_SpaRosaProduction'
Get-Content -LiteralPath "$bootstrap\db_system_master.production.sql" -Raw | & $mysql -u root -p db_system_master
Get-Content -LiteralPath "$bootstrap\db_spa_template.schema.sql" -Raw | & $mysql -u root -p db_spa_template
```

Xác nhận master không mang tenant/user test:

```sql
SELECT COUNT(*) AS tenants FROM db_system_master.tenants;
SELECT username, system_role FROM db_system_master.users;
SELECT package_code FROM db_system_master.subscription_packages ORDER BY id;
```

Hai count đầu phải là `0`; packages mặc định phải có 3 hàng.

## 5. Cấu hình, deploy, và tạo Super Admin

```powershell
$root = 'C:\SpaBackend'
New-Item -ItemType Directory -Path "$root\config", "$root\scripts" -Force | Out-Null
Copy-Item -LiteralPath "$bootstrap\scripts\windows\*" -Destination "$root\scripts" -Recurse -Force
Copy-Item -LiteralPath "$bootstrap\.env.example" -Destination "$root\config\.env"
notepad "$root\config\.env"
```

Trong `.env`, thay `DB_PASSWORD` bằng đúng password của `rosa@127.0.0.1` và thay `JWT_SECRET`. Giữ nguyên `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `CORS_ORIGINS=https://app-spa-rosa.infinityhavocx.men`, `SKIN_IMAGES_ENABLED=true`, `UPLOAD_ROOT=C:/SpaBackend/uploads`. Không thêm `SKIN_IMAGES_TENANT_DATABASE`.

Deploy tag Rosa đã duyệt (thay phiên bản theo release được phê duyệt):

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& 'C:\SpaBackend\scripts\Deploy-SpaBackend.ps1' -Version 'backend-spatestrosa-v1.0.2' -ServerId 'sparosa-production'
```

Sau deploy, tạo SQL Super Admin từ password nhập kín, copy output vào cửa sổ MySQL admin và chạy đúng một lần:

```powershell
& 'C:\SpaBackend\scripts\New-SpaRosaSuperAdminSql.ps1'
```

`inserted_rows` phải là `1`. Sau đó cài service:

```powershell
& 'C:\SpaBackend\scripts\Install-SpaBackendService.ps1' -WinSWPath 'C:\Install\WinSW-x64.exe'
Invoke-RestMethod 'http://127.0.0.1:5000/health'
```

## 6. Cloudflare Tunnel và frontend

Tạo managed tunnel trong Cloudflare, cài `cloudflared` service bằng token được dashboard cấp **trực tiếp trên server**, sau đó tạo Published application:

```text
Hostname: api-spa-rosa.infinityhavocx.men
Service:  http://127.0.0.1:5000
```

Không mở inbound port `5000`, `3306` hoặc `3389`. Kiểm tra từ mạng ngoài:

```powershell
Invoke-RestMethod 'https://api-spa-rosa.infinityhavocx.men/health'
```

Frontend phải build với `VITE_API_BASE_URL=https://api-spa-rosa.infinityhavocx.men`, rồi publish tại `https://app-spa-rosa.infinityhavocx.men`.

## 7. Cloudflare R2 backup

Tạo R2 bucket và access key chỉ có quyền cần thiết cho bucket đó. Copy mẫu config, điền secret **chỉ tại server**, rồi khóa ACL:

```powershell
Copy-Item "$bootstrap\r2-backup.example.json" 'C:\SpaBackend\config\r2-backup.json'
notepad 'C:\SpaBackend\config\r2-backup.json'
icacls 'C:\SpaBackend\config\r2-backup.json' /inheritance:r
icacls 'C:\SpaBackend\config\r2-backup.json' /grant:r 'Administrators:F' 'SYSTEM:F'
```

Chạy thử một backup trước khi tạo task:

```powershell
& 'C:\SpaBackend\current\scripts\windows\Backup-SpaRosaToR2.ps1'
& 'C:\SpaBackend\current\scripts\windows\Install-SpaRosaBackupTask.ps1' -DailyAt '01:30'
Get-ScheduledTask -TaskName 'SpaRosaBackupToR2'
```

Mỗi run tạo `C:\SpaBackend\backups\YYYY-MM-DD_HHmmss`, dump master/template/tất cả DB tenant đã đăng ký, SHA-256 và manifest; local backup cũ hơn 10 ngày bị xóa. R2 giữ 4 recovery point daily và 4 weekly. Backup R2 là private object; bật encryption at rest/managed encryption của R2 và giới hạn token theo bucket/prefix.

## 8. Restore drill và nghiệm thu

Không restore thẳng production lần đầu. Trên instance MySQL thử riêng, tạo database trống và import dump:

```powershell
$dump = 'C:\SpaBackend\backups\YYYY-MM-DD_HHmmss\spa-rosa-databases.sql'
Get-Content -LiteralPath $dump -Raw | & $mysql -u root -p
```

Nghiệm thu production:

1. Login `superadmin` từ frontend Rosa.
2. Super Admin tạo một Spa với Manager qua UI/API; xác nhận `db_spa_<timestamp>_<hex>` được tạo và `SHOW TABLES` khớp template.
3. Manager login tenant mới, thử upload skin image; file mới phải nằm trong `C:\SpaBackend\uploads\tenants\<tenantId>\...`.
4. Kiểm tra health public, CORS từ app domain, Scheduled Task và object R2.
5. Lưu biên bản restore drill; chỉ backup chưa từng restore thử không được xem là backup đã xác minh.