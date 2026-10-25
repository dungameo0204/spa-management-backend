# Nâng cấp database đã có dữ liệu (bổ sung 25/10/2026)

Nếu đây là máy đã triển khai, không import lại schema bootstrap. Làm theo
`docs/migrations/README_customer_upgrade.md` trong release source để kiểm kê, backup,
migrate ngày sinh + `sale_price` cho từng tenant và template trước khi đổi release.
Script deploy/auto-update không tự thực hiện migration. Không bật auto-update trong đợt nâng cấp schema.

# Handoff cài backend Spa trên máy Windows khách

> Runbook thao tác production. Mục tiêu là chạy app mới song song với app/database cũ, public qua Cloudflare Tunnel và tự cập nhật theo Git tag dành riêng cho máy. Không tự suy luận khi gặp khác biệt; áp dụng các điều kiện **DỪNG** trong tài liệu.

Nếu dùng gói bootstrap, giải nén nguyên thư mục vào `C:\Install\SpaBackendBootstrap`. Mọi đường dẫn bootstrap bên dưới giả định vị trí này; nếu giải nén nơi khác thì phải thay đồng bộ đường dẫn, không tự đổi đích database.

## 1. Giá trị phải được xác nhận trước khi thao tác

Ghi lại, không để placeholder khi chạy lệnh:

| Giá trị | Ví dụ | Trạng thái |
|---|---|---|
| Git tag đầu tiên | `backend-spa-a-v1.0.0` | Chưa chốt |
| `ServerId` | `spa-a` | Chưa chốt |
| Tag pattern riêng máy | `backend-spa-a-v*` | Chưa chốt |
| API hostname | `api-spa-xuly.infinityhavocx.men` | Đã chốt; cần cấu hình Cloudflare Tunnel |
| Frontend origin HTTPS | `https://app.infinityhavocx.men` | Chưa xác nhận |
| Port backend mới | `5000` | Phải kiểm tra trống |
| MySQL host/port | `127.0.0.1:3306` | Phải kiểm kê |
| MySQL bin | `C:\Program Files\MySQL\MySQL Server 8.0\bin` | Phải kiểm tra |
| WinSW x64 path | `C:\Install\WinSW-x64.exe` | Phải chuẩn bị |

## 2. Quy tắc không ảnh hưởng hệ thống cũ

1. Không gỡ, nâng cấp hoặc cài đè MySQL đang chạy.
2. Không dừng, sửa service, app pool, Scheduled Task hoặc thư mục của app cũ.
3. Không đổi MySQL `bind-address`, firewall, router/NAT hoặc quyền user cũ trước khi biết đầy đủ phụ thuộc.
4. Không import `db_system_master.sql` hay `db_spa_template.sql` vào database cũ. Hai file có lệnh `DROP TABLE IF EXISTS`.
5. Không chạy migration tự động. Auto-update chỉ đổi code và restart backend.
6. Không mở inbound port `5000`, `3306` hoặc `3389`; backend production chỉ nghe `127.0.0.1`.
7. Không commit `.env`, mật khẩu, JWT secret, tunnel token hoặc dump database.
8. Không xóa release/backup cũ trước khi test rollback và restore.

### DỪNG và hỏi người phụ trách nếu

- `db_system_master` hoặc `db_spa_template` đã tồn tại nhưng không chắc thuộc app mới.
- Port `5000`, service `SpaBackend`, service `cloudflared` hoặc `C:\SpaBackend` đã được dùng.
- Không xác định được app cũ dùng database/user/port/service nào.
- MySQL đang public ra Internet hoặc việc đóng port có thể làm app cũ mất kết nối.
- MySQL không tương thích schema, import báo lỗi, hoặc không tạo được database/user riêng.
- Chưa có backup kiểm tra được kích thước/hash hoặc chưa biết cách restore.
- Git tag, `ServerId`, tag pattern, hostname, frontend origin hoặc credential chưa được xác nhận.
- Repo private nhưng tài khoản `SYSTEM` trên máy chưa có cơ chế Git credential/deploy key chỉ đọc.

## 3. Kiểm kê chỉ đọc

Mở PowerShell Administrator và lưu output vào biên bản triển khai, không chứa password/token:

```powershell
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsArchitecture
Get-Service | Where-Object { $_.Name -match 'mysql|maria|spa|cloudflared' -or $_.DisplayName -match 'mysql|maria|spa|cloudflare' }
Get-NetTCPConnection -State Listen | Sort-Object LocalPort | Select-Object LocalAddress, LocalPort, OwningProcess
Get-Process -Id (Get-NetTCPConnection -State Listen | Select-Object -ExpandProperty OwningProcess -Unique) -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, Path
node --version
npm --version
git --version
```

Kiểm tra MySQL bằng tài khoản quản trị được khách cung cấp:

```sql
SELECT VERSION() AS mysql_version, @@hostname AS host, @@port AS port, @@bind_address AS bind_address;
SHOW DATABASES;
SELECT user, host FROM mysql.user ORDER BY user, host;
```

Không ghi password vào command line, ảnh chụp hoặc tài liệu bàn giao.

## 4. Backup trước thay đổi

Vì `.env` app mới chưa tồn tại, backup ban đầu phải dùng quy trình backup hiện có của khách hoặc `mysqldump` với tài khoản quản trị. Backup **toàn bộ database cũ liên quan**, lưu ngoài thư mục app cũ và tạo SHA-256:

```powershell
Get-FileHash -Algorithm SHA256 'D:\Backup\before-spa-install.sql'
```

Xác nhận file không rỗng, ghi thời gian, MySQL version, danh sách DB và hash. Nếu có thể, restore vào MySQL thử nghiệm. Không coi backup là đạt nếu chỉ chạy lệnh mà chưa kiểm tra file.

## 5. Tạo database và user riêng cho app mới

Code hiện vẫn tham chiếu cứng `db_system_master` và `db_spa_template`; không tự đổi hai tên này. Trước tiên:

```sql
SHOW DATABASES LIKE 'db_system_master';
SHOW DATABASES LIKE 'db_spa_template';
```

Nếu có kết quả ngoài dự kiến: **DỪNG, không import**.

Sau khi xác nhận hai tên chưa tồn tại, tạo DB và user mới. Thay password tại phiên làm việc, không lưu câu lệnh thật vào Git:

```sql
CREATE DATABASE db_system_master CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE db_spa_template CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'spa_backend'@'localhost' IDENTIFIED BY '<STRONG_RANDOM_PASSWORD>';
GRANT ALL PRIVILEGES ON db_system_master.* TO 'spa_backend'@'localhost';
GRANT ALL PRIVILEGES ON db_spa_template.* TO 'spa_backend'@'localhost';
GRANT ALL PRIVILEGES ON `db_spa\_%`.* TO 'spa_backend'@'localhost';
GRANT CREATE ON *.* TO 'spa_backend'@'localhost';
FLUSH PRIVILEGES;
```

Lưu ý: backend tạo tenant database động có tiền tố `db_spa_` và clone bảng từ template, nên user cần quyền tạo DB và thao tác trên các tenant DB mới. Dấu `\_` trong mẫu quyền làm `_` trở thành ký tự thật, không phải wildcard một ký tự. Không cấp quyền vào database app cũ. Nếu chính sách MySQL không cho mô hình quyền này, **DỪNG** để thiết kế lại provisioning; không cấp `GRANT ALL ON *.*`.

Import schema từ đúng release đã duyệt:

```powershell
$mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
& $mysql -u root -p db_system_master --execute="source C:/Install/SpaBackendBootstrap/db_system_master.sql"
& $mysql -u root -p db_spa_template --execute="source C:/Install/SpaBackendBootstrap/db_spa_template.sql"
```

Đường dẫn trong lệnh MySQL `source` dùng dấu `/`. Tuyệt đối không đổi đích sang DB cũ. Sau import:

```sql
SHOW TABLES FROM db_system_master;
SHOW TABLES FROM db_spa_template;
SELECT COUNT(*) AS master_users FROM db_system_master.users;
```

## 6. Chuẩn bị `C:\SpaBackend` và `.env`

Tạo thư mục và copy toàn bộ `scripts/windows/` từ gói bootstrap đã kiểm tra hash vào `C:\SpaBackend\scripts`:

```powershell
New-Item -ItemType Directory -Force -Path 'C:\SpaBackend\config', 'C:\SpaBackend\scripts' | Out-Null
Copy-Item 'C:\Install\SpaBackendBootstrap\scripts\windows\*' 'C:\SpaBackend\scripts' -Force
```

Tạo `C:\SpaBackend\config\.env`:

```dotenv
NODE_ENV=production
PORT=5000
DB_HOST=127.0.0.1
DB_USER=spa_backend
DB_PASSWORD=<STRONG_RANDOM_PASSWORD>
DB_SYSTEM_NAME=db_system_master
JWT_SECRET=<LONG_RANDOM_SECRET>
CORS_ORIGINS=https://app.infinityhavocx.men
```

`CORS_ORIGINS` phải là HTTPS origin thật, không có path. Giới hạn ACL `.env` cho Administrators, SYSTEM và tài khoản vận hành cần thiết.

## 7. Deploy tag đầu tiên và cài Windows Service

Tag phải tồn tại trên remote và đã qua test:

```powershell
git ls-remote --tags --refs 'https://github.com/dungameo0204/spa-management-backend.git' 'backend-spa-a-v1.0.0'
```

Deploy lần đầu:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& 'C:\SpaBackend\scripts\Deploy-SpaBackend.ps1' `
  -Version 'backend-spa-a-v1.0.0' `
  -ServerId 'spa-a'
```

Kiểm tra `C:\SpaBackend\current` là junction và state đúng:

```powershell
Get-Item 'C:\SpaBackend\current' -Force | Select-Object FullName, LinkType, Target
Get-Content 'C:\SpaBackend\state\deployment.json'
```

Cài WinSW:

```powershell
& 'C:\SpaBackend\scripts\Install-SpaBackendService.ps1' `
  -WinSWPath 'C:\Install\WinSW-x64.exe'
```

Kiểm tra:

```powershell
Get-Service SpaBackend
Invoke-RestMethod 'http://127.0.0.1:5000/health'
Get-Content 'C:\SpaBackend\logs\SpaBackend.out.log' -Tail 100 -ErrorAction SilentlyContinue
Get-Content 'C:\SpaBackend\logs\SpaBackend.err.log' -Tail 100 -ErrorAction SilentlyContinue
```

Health đúng là `{ "status": "ok" }`; endpoint này đồng thời kiểm tra master MySQL.

## 8. Tạo `SUPER_ADMIN` đầu tiên

Schema yêu cầu `users.username` unique; backend kiểm tra mật khẩu bằng bcrypt. Superadmin phải có `tenant_id = NULL`, `branch_id = NULL`, `system_role = 'SUPER_ADMIN'`.

Sinh hash trong release đang chạy mà không ghi plaintext vào file:

```powershell
Set-Location 'C:\SpaBackend\current'
$securePassword = Read-Host 'Nhap mat khau SUPER_ADMIN' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $env:INITIAL_ADMIN_PASSWORD = $plainPassword
    node -e "const bcrypt=require('bcryptjs'); bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD,10).then(console.log).catch(e=>{console.error(e);process.exit(1)})"
} finally {
    $env:INITIAL_ADMIN_PASSWORD = $null
    $plainPassword = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
```

Copy hash đầy đủ vào transaction sau:

```sql
START TRANSACTION;

INSERT INTO db_system_master.users
    (tenant_id, branch_id, username, fullname, password, system_role, created_by)
SELECT NULL, NULL, 'superadmin', 'Quản trị hệ thống', '<BCRYPT_HASH>', 'SUPER_ADMIN', 'INITIAL_SETUP'
WHERE NOT EXISTS (
    SELECT 1 FROM db_system_master.users WHERE username = 'superadmin'
);

SELECT ROW_COUNT() AS inserted_rows;
COMMIT;
```

`inserted_rows` phải là `1` ở lần đầu. Nếu là `0`, kiểm tra user đang có; không tự ghi đè password.

```sql
SELECT id, tenant_id, branch_id, username, fullname, system_role, deleted_at
FROM db_system_master.users
WHERE username = 'superadmin';
```

Không query/chụp/log cột password nếu không cần.

## 9. Bật auto-update theo tag riêng của máy

Auto-update không theo `main`. Máy chỉ nhận tag khớp pattern riêng, giúp mỗi máy độc lập. Ví dụ máy `spa-a` dùng `backend-spa-a-v*`:

```powershell
& 'C:\SpaBackend\current\scripts\windows\Install-SpaBackendAutoUpdate.ps1' `
  -ServerId 'spa-a' `
  -TagPattern 'backend-spa-a-v*' `
  -IntervalMinutes 15
```

Script tạo:

- Scheduled Task `SpaBackendAutoUpdate`, chạy bằng `SYSTEM` với quyền cao nhất.
- `C:\SpaBackend\config\auto-update.json`.
- Log `C:\SpaBackend\logs\auto-update.log`.

Kiểm tra thủ công lần đầu:

```powershell
Get-ScheduledTask -TaskName 'SpaBackendAutoUpdate'
Start-ScheduledTask -TaskName 'SpaBackendAutoUpdate'
Start-Sleep -Seconds 10
Get-ScheduledTaskInfo -TaskName 'SpaBackendAutoUpdate'
Get-Content 'C:\SpaBackend\logs\auto-update.log' -Tail 50
```

Quy trình phát hành từ máy phát triển:

```powershell
git tag -a 'backend-spa-a-v1.1.0' -m 'Deploy spa-a v1.1.0'
git push origin 'backend-spa-a-v1.1.0'
```

Máy khách sẽ tự thấy tag mới, deploy, restart, gọi `/health`, rồi cập nhật `deployment.json`. Nếu health fail, deploy script tự đưa junction về release trước. Không force-move hoặc tái sử dụng tag đã phát hành; tạo tag version mới.

Muốn tạm dừng auto-update mà không remote vào service backend, cần có người tại máy chạy:

```powershell
Disable-ScheduledTask -TaskName 'SpaBackendAutoUpdate'
```

Không đưa migration DB vào auto-update. Release cần migration phải được đánh dấu và triển khai có giám sát/backup riêng.

## 10. Cloudflare Tunnel

1. Tạo remote-managed tunnel trong tài khoản Cloudflare có MFA.
2. Trên máy khách, chạy duy nhất lệnh install connector do dashboard cung cấp. Tunnel token là secret: không lưu vào Git/tài liệu/log/screenshot.
3. Published application:
   - Hostname: `api-spa-xuly.infinityhavocx.men` (subdomain `api-spa-xuly`, domain `infinityhavocx.men`).
   - Service: `http://127.0.0.1:5000`.
4. Không bật Cloudflare Access interactive trước toàn bộ API JWT.
5. Không cache API; nếu thêm WAF/rate limit phải test `OPTIONS` và login thật.

Kiểm tra:

```powershell
Get-Service cloudflared
```

Từ mạng ngoài máy khách (ví dụ 4G):

```powershell
Invoke-RestMethod 'https://api-spa-xuly.infinityhavocx.men/health'
```

## 11. Nghiệm thu

- [ ] App/service/database cũ vẫn hoạt động như trước.
- [ ] `SpaBackend` Automatic và tự chạy lại sau restart Windows.
- [ ] Local `/health` trả `ok`.
- [ ] Public HTTPS `/health` trả `ok` từ mạng ngoài.
- [ ] Backend chỉ listen `127.0.0.1:<PORT>`.
- [ ] Login `SUPER_ADMIN` thành công và response có `tenant_id: null`, `system_role: SUPER_ADMIN`.
- [ ] `GET /api/tenants` với token Superadmin thành công.
- [ ] Endpoint bảo vệ không token trả 401/403.
- [ ] CORS cho phép đúng frontend HTTPS và từ chối origin ngoài danh sách.
- [ ] Tạo tenant thử sinh DB mới không trùng DB cũ; MANAGER đăng nhập được.
- [ ] Restart `SpaBackend` rồi health/login vẫn thành công.
- [ ] Scheduled Task chạy, log `Already current` hoặc deploy đúng tag.
- [ ] Backup sau cài đặt tạo được dump, SHA-256 và manifest.
- [ ] Không có password/token/dump trong Git hoặc thư mục public.

## 12. Backup định kỳ sau khi app mới hoạt động

```powershell
& 'C:\SpaBackend\current\scripts\windows\Backup-SpaDatabase.ps1' `
  -MySqlBin 'C:\Program Files\MySQL\MySQL Server 8.0\bin' `
  -RetentionDays 30
```

Script backup master, template và tenant active được đăng ký. Phải tạo Scheduled Task backup riêng, sao chép backup ra thiết bị/vị trí khác và thử restore định kỳ.

## 13. Rollback

Rollback code thủ công:

```powershell
Disable-ScheduledTask -TaskName 'SpaBackendAutoUpdate'
& 'C:\SpaBackend\current\scripts\windows\Rollback-SpaBackend.ps1'
Invoke-RestMethod 'http://127.0.0.1:5000/health'
```

Sau khi điều tra xong mới bật lại task. Rollback code không hoàn tác migration/DDL/data; database phải phục hồi theo kế hoạch riêng.

## 14. Biên bản bàn giao tối thiểu

Không ghi secret. Bàn giao:

- `ServerId`, hostname, tag pattern, tag hiện tại và thời gian deploy.
- Tên service, port nội bộ, MySQL version và tên DB mới.
- Đường dẫn install/log/backup/state.
- Kết quả local/public health, login, restart và auto-update dry run.
- Hash backup trước/sau cài và nơi lưu bản restore.
- Các cảnh báo còn mở, người quản lý Cloudflare/GitHub và quy trình phát hành tag.