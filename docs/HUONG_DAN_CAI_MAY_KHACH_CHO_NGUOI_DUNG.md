# Hướng dẫn cho người trực tiếp cài backend Spa trên máy khách

Đọc tài liệu này **trước khi thao tác**. Đây là bản giải thích quy trình, không thay thế runbook kỹ thuật `INSTALL_CUSTOMER_SERVER_TOMORROW.md`. Khi làm thật, mở hai tài liệu cạnh nhau: tài liệu này để hiểu và kiểm tra, runbook để xem lệnh cụ thể và điều kiện **DỪNG**. Làm từng giai đoạn, kiểm tra kết quả rồi mới tiếp tục; không giao cho công cụ AI tự chạy một mạch trên máy production.

## 1. Mình đang cài cái gì?

```text
Trình duyệt/frontend (địa chỉ frontend CHƯA CHỐT)
    -> https://api-spa-xuly.infinityhavocx.men
    -> Cloudflare Tunnel trên máy khách
    -> http://127.0.0.1:5000 (SpaBackend, Windows Service)
    -> MySQL trên cùng máy, database RIÊNG của app mới
```

App và database cũ **tiếp tục chạy song song**. Không gỡ MySQL, không import lên DB cũ, không dừng service app cũ, không mở cổng từ Internet vào máy khách. Cloudflare Tunnel là đường vào API, **không thay thế** đăng nhập/JWT. Máy khách tắt hoặc mất mạng thì API public không hoạt động.

Gói `SpaBackendBootstrap.zip` chứa tài liệu, schema và script cài đặt, **không chứa source backend đầy đủ**: script deploy sẽ tải code từ Git theo tag được bạn duyệt. `.env` thật, mật khẩu, JWT secret và tunnel token không có trong ZIP; không gửi chúng vào chat, commit Git hay chụp màn hình.

## 2. Trước khi tới máy khách: chốt những gì?

| Mục | Tình trạng / ý nghĩa |
| --- | --- |
| API public | `api-spa-xuly.infinityhavocx.men` đã chọn; **chưa** có nghĩa là Tunnel/route đã hoạt động. |
| Frontend HTTPS origin | **Chưa chốt**. Đây là origin của web gọi API để điền `CORS_ORIGINS`, không phải URL API. |
| Git tag đầu tiên, `ServerId`, tag pattern | **Chưa chốt**. Ví dụ trong runbook là `backend-spa-a-v1.0.0`, `spa-a`, `backend-spa-a-v*`; không dùng ví dụ nếu chưa duyệt/tag thật. |
| MySQL/version/path/quyền | Phải kiểm kê trực tiếp máy khách; tên DB mới dự kiến là `db_system_master` và `db_spa_template`. |
| Port `5000`, service `SpaBackend`, `cloudflared`, thư mục `C:\SpaBackend` | Phải kiểm tra chưa bị hệ thống cũ sử dụng. |
| WinSW, Node.js, Git, quyền admin, repo Git đọc được | Phải chuẩn bị/xác minh trên máy khách; nếu repo private, Scheduled Task chạy dưới `SYSTEM` cũng phải đọc được tag theo cơ chế chỉ đọc. |

Chỉ chọn tag **sau khi code và hai schema trong gói được đối chiếu với release đã duyệt**. Nếu schema trong ZIP khác release định cài, dừng và tạo lại gói/đối chiếu; không import rồi hy vọng code tự thích nghi. Chuẩn bị backup có thể restore và cách liên hệ người quản lý hệ thống cũ trước khi đụng DB.

## 3. Mang gói tới máy khách

Mang **cả hai file** `SpaBackendBootstrap.zip` và `SpaBackendBootstrap.zip.sha256` từ thư mục `artifacts` trên máy phát triển. Hash có thể đổi mỗi lần tạo ZIP; **không dùng hash ghi từ lần trước**. Trên máy khách, kiểm tra:

```powershell
Get-FileHash -Algorithm SHA256 'C:\Install\SpaBackendBootstrap.zip'
Get-Content 'C:\Install\SpaBackendBootstrap.zip.sha256'
```

Hai giá trị SHA-256 phải giống nhau. Giải nén ZIP vào `C:\Install` (không lồng thêm một cấp thư mục):

```powershell
Expand-Archive -LiteralPath 'C:\Install\SpaBackendBootstrap.zip' -DestinationPath 'C:\Install'
Test-Path 'C:\Install\SpaBackendBootstrap\INSTALL_CUSTOMER_SERVER_TOMORROW.md'
```

Kết quả `Test-Path` phải là `True`. Nếu thư mục đích đã tồn tại, **dừng kiểm tra nội dung trước**, không giải nén đè. Đọc `C:\Install\SpaBackendBootstrap\README_FIRST.md`, sau đó mở runbook trong cùng thư mục. Chỉ ZIP không đủ để chạy API offline: cần truy cập Git tag được duyệt.

## 4. Quy trình tại máy khách (đọc theo thứ tự)

### Giai đoạn A — Kiểm kê, chưa thay đổi gì

Mở PowerShell Administrator, làm phần **kiểm kê chỉ đọc** của runbook. Ghi lại app/service/port/DB hiện có, đường dẫn MySQL và Node/Git. Kiểm tra `db_system_master`, `db_spa_template` có tồn tại không, cổng `5000` có ai dùng chưa. **Nếu hai DB đã tồn tại mà không xác định được chủ sở hữu, hoặc `C:\SpaBackend`/service/port đã được dùng: DỪNG.** Không sửa cấu hình app cũ để “nhường chỗ”.

### Giai đoạn B — Backup app/DB cũ trước thay đổi

Dùng quy trình backup của khách hoặc tài khoản quản trị MySQL để sao lưu **các database cũ liên quan**. Kiểm tra file không rỗng, SHA-256, nơi lưu và phương án restore; tốt nhất thử restore trên môi trường thử. Backup của app mới sau này **không thay thế** backup này. Nếu chưa có backup tin cậy: **DỪNG**.

### Giai đoạn C — Tạo database riêng cho app mới

Chỉ khi đã xác nhận hai tên `db_system_master`, `db_spa_template` **chưa tồn tại và không thuộc app cũ**, thực hiện phần tạo DB và MySQL user riêng trong runbook. Import hai SQL trong gói **chỉ vào đúng hai DB mới**; schema có lệnh `DROP TABLE IF EXISTS`, import nhầm có thể làm mất dữ liệu. Kiểm tra bảng sau import; nếu import lỗi hoặc quyền user không phù hợp: **DỪNG**, không tự cấp toàn quyền trên mọi DB.

### Giai đoạn D — Tạo cấu hình riêng, deploy bản đầu và service

Tạo `C:\SpaBackend\config\.env` theo runbook, nhập mật khẩu DB/JWT secret **trực tiếp trên máy khách**. `CORS_ORIGINS` phải là **origin HTTPS thật của frontend** (ví dụ `https://app.infinityhavocx.men` chỉ khi đúng frontend đã chốt), không phải `https://api-spa-xuly.infinityhavocx.men`. Bảo vệ quyền đọc file `.env`.

Xác nhận Git tag đầu tiên đã tồn tại trên remote và máy khách đọc được. Script `Deploy-SpaBackend.ps1` tải đúng tag vào `C:\SpaBackend\releases`, chạy `npm ci --omit=dev --ignore-scripts`, rồi tạo junction `C:\SpaBackend\current`. **Lần deploy đầu chưa tự kiểm tra `/health` nếu service chưa tồn tại**: tiếp tục cài WinSW service bằng `Install-SpaBackendService.ps1` theo runbook, khi đó script khởi động service và kiểm tra health.

Trên máy khách, xem:

```powershell
Get-Service SpaBackend
Get-Content 'C:\SpaBackend\state\deployment.json'
Invoke-RestMethod 'http://127.0.0.1:5000/health'
```

Health cần trả `{ "status": "ok" }` (có kiểm tra kết nối master MySQL). Nếu lỗi, xem log trong `C:\SpaBackend\logs`, **chưa mở Tunnel**; không gửi file `.env` hoặc log chứa secret lên chat.

### Giai đoạn E — Tài khoản quản trị và kiểm thử local

Tạo `SUPER_ADMIN` đầu tiên theo phần riêng của runbook: nhập mật khẩu bằng secure prompt, tạo bcrypt hash, chỉ ghi hash vào DB mới. Kiểm tra login, quyền API và thao tác tenant trên app mới; tuyệt đối không dùng user/database cũ để “test nhanh”.

### Giai đoạn F — Auto-update theo Git tag riêng

Sau khi bản đầu chạy tốt và **chốt đúng `ServerId` + tag pattern**, dùng script `Install-SpaBackendAutoUpdate.ps1` trong runbook. Nó tạo Scheduled Task `SpaBackendAutoUpdate` chạy dưới `SYSTEM`, định kỳ đọc tag khớp pattern (ví dụ `backend-spa-a-v*` nếu đúng máy này); **push `main` không tự deploy**. Kiểm tra `C:\SpaBackend\logs\auto-update.log` và `C:\SpaBackend\state\deployment.json`. Test lần đầu có giám sát. Nếu repo private mà SYSTEM không truy cập được, dừng xử lý quyền truy cập, không để credential trong script/chat.

Mỗi lần muốn cập nhật: trên máy phát triển test code, tạo **tag mới riêng máy**, push tag; máy khách thấy tag, tải release, restart service, kiểm tra health và ghi state. Nếu health fail, script cố rollback **code** về release trước; rollback code **không phục hồi thay đổi schema/dữ liệu**. Migration DB phải làm riêng có backup/giám sát, không đưa vào auto-update. Không sửa/di chuyển tag đã phát hành.

### Giai đoạn G — Mở đường public bằng Cloudflare Tunnel

Sau khi API local khỏe, tạo Tunnel trong tài khoản Cloudflare đang quản lý domain. Cài connector `cloudflared` trên máy khách theo lệnh dashboard cung cấp; **tunnel token là bí mật**, chỉ nhập ở máy khách, không chụp/gửi. Trong Tunnel tạo Published application với:

```text
Subdomain: api-spa-xuly
Domain: infinityhavocx.men
Service: http://127.0.0.1:5000
```

Không tạo A record trỏ tới IP máy khách, không mở inbound port `5000`/`3306`/`3389`, không bật Cloudflare Access login tương tác chặn toàn API JWT. Kiểm tra connector Healthy và từ **mạng ngoài** (ví dụ 4G) gọi:

```powershell
Invoke-RestMethod 'https://api-spa-xuly.infinityhavocx.men/health'
```

Chỉ đưa frontend sang URL này sau khi HTTPS, login, CORS và phân quyền đều được kiểm thử. Có `/health` public không có nghĩa mọi endpoint đều an toàn.

### Giai đoạn H — Nghiệm thu, bàn giao và bảo trì

Theo checklist nghiệm thu cuối runbook: app cũ vẫn chạy, DB cũ không đổi, service tự chạy sau restart, health local/public, login/quyền, CORS đúng frontend, tạo tenant thử và kiểm tra auto-update. Thiết lập backup DB mới, sao lưu ngoài máy và thử restore; theo dõi service, Tunnel và log. Ghi tag hiện chạy, tên DB/port, vị trí backup và người có quyền Cloudflare/GitHub; **không ghi mật khẩu/token vào biên bản**.

Nếu bản cập nhật lỗi: vô hiệu hóa task `SpaBackendAutoUpdate` trước, đọc phần rollback trong runbook, kiểm tra lại local/public health. Chỉ bật lại task sau khi tìm nguyên nhân; nếu lỗi do migration/data, rollback code một mình không đủ.

## 5. Mẹo nhớ nhanh

- **Bootstrap ZIP** = bộ hướng dẫn và công cụ; **Git tag** = code backend chạy thật.
- **`.env`** = bí mật/cấu hình chỉ ở máy khách; **`CORS_ORIGINS`** = frontend, **API hostname** = `api-spa-xuly.infinityhavocx.men`.
- **`C:\SpaBackend\current`** = bản release đang chạy; **`deployment.json`** = ghi nhận phiên bản; **Scheduled Task** = kiểm tra tag để cập nhật.
- **Cloudflare Tunnel** = đưa API local ra HTTPS mà không mở cổng vào máy khách.
- **Đang nghi ngờ DB/backup/tag/port/quyền? DỪNG**, hỏi người phụ trách, không đoán.