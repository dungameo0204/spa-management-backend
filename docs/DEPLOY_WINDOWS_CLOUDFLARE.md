# Triển khai backend trên máy Windows của khách (không VPS)

> Runbook cho `infinityhavocx.men`. Repo có script hỗ trợ tại `scripts/windows/`, nhưng vẫn phải chạy thử trên máy khác trước khi đưa dữ liệu khách lên Internet. Thực hiện lệnh PowerShell/CMD trên máy khách với quyền Administrator khi được chỉ rõ; không chạy migration lên DB khách nếu chưa backup/đối chiếu schema.

## 0. Phương án và điều kiện

`https://api-spa-xuly.infinityhavocx.men` → Cloudflare (HTTPS) → Cloudflare Tunnel (`cloudflared` chạy Windows Service) → `http://127.0.0.1:5000` (Node/Express chạy Windows Service) → MySQL trên cùng máy (`127.0.0.1:3306`). Không NAT, không mở inbound port 5000/3306/3389, không cần IP tĩnh; máy khách phải bật, có điện và Internet để API hoạt động. Tunnel không thay thế JWT/bảo mật ứng dụng; hostname API công khai vẫn có thể bị gọi trực tiếp. Không dùng Cloudflare Access login tương tác trước toàn bộ API nếu frontend hiện dùng Bearer JWT (Access sẽ chặn cả login/CORS); muốn dùng Access phải thiết kế luồng xác thực frontend riêng.

Điều kiện: Windows 10/11 hoặc Windows Server, MySQL đã cài và schema đã khớp code; quyền quản trị máy và router/firewall (để *đóng* port đã từng mở), Node.js LTS tương thích với lockfile, git, một domain và tài khoản Cloudflare bật MFA. Bạn quản lý quyền admin trên máy; không dùng password của khách để đăng nhập GitHub/Cloudflare. Nên có UPS, tự bật máy sau mất điện (BIOS), tắt sleep/hibernate và kiểm tra kết nối ISP cho Cloudflare Tunnel (outbound port 7844 nếu mạng chặn). Cloudflare có thể đổi giao diện; đối chiếu tài liệu chính thức ở cuối.

### Chuẩn bị code trước khi bật public

- Code phải được commit/tag sau khi chạy test; máy khách tải **tag/release đã duyệt** thay vì bám `main` (không tự chạy code mới ngay khi push). Không commit `.env`, token Tunnel, private key hay database dump; repo có `.gitignore`, kiểm tra thêm `git status` và lịch sử trước khi public repo.
- Trong production backend yêu cầu `NODE_ENV=production`, bind `127.0.0.1` dù cấu hình `HOST` khác, `CORS_ORIGINS` HTTPS rõ ràng, và kiểm tra kết nối master MySQL **trước** khi mở cổng. Nếu DB rớt sau khi đã chạy, API có thể lỗi: theo dõi log/DB, không coi việc service còn sống là DB đang khỏe.
- `CORS_ORIGINS` chỉ hạn chế trình duyệt, **không** phải tường lửa hoặc xác thực. Chọn JWT secret dài/ngẫu nhiên, giữ riêng trên máy khách; thay secret sẽ làm token cũ hết hiệu lực. Bảo vệ login khỏi brute-force (rate limit tại edge/WAF và/hoặc app), giám sát lỗi 4xx/5xx, xem lại quyền endpoint và hạn chế request body trước khi triển khai rộng. Không coi các mục này đã được cấu hình tự động bởi tài liệu này.
- Trước khi đổi schema: kiểm kê DB `db_system_master`, `db_spa_template`, danh sách `db_system_master.tenants` và toàn bộ `docs/migrations/`; đối chiếu migration nào **đã** áp dụng. Ví dụ migration công ca có hướng dẫn riêng ở `docs/migrations/README_commission_by_invoice_item.md`; không chạy lại file schema mẫu (`DROP TABLE`) lên DB thật. MySQL DDL không rollback cùng ứng dụng.

## 1. Mua tên miền và đưa DNS lên Cloudflare

Tên miền `infinityhavocx.men` được mua tại Cloudflare Registrar. API máy chủ đầu tiên dùng `api-spa-xuly.infinityhavocx.men`; frontend web nếu host riêng có thể dùng `app.infinityhavocx.men`.

1. Tạo tài khoản Cloudflare do **bạn** quản lý; bật MFA, xác minh email. Trong dashboard vào **Domain Registration → Register Domains**, tìm tên miền chưa ai sở hữu; xem **giá mua, giá gia hạn, kỳ hạn và điều kiện của TLD** trước khi trả tiền. Trả phí bằng tài khoản của bạn, bật auto-renew và xác minh email chủ sở hữu tên miền để tránh domain bị treo. Giá phụ thuộc đuôi tên miền/thời điểm; không giả định luôn miễn phí. Một số đuôi có thể không được bán trên Cloudflare: nếu vậy mua qua nhà đăng ký uy tín, sau đó **Add a domain** trên Cloudflare và đổi nameserver ở nhà đăng ký theo đúng 2 nameserver Cloudflare cấp; giữ/copy các bản ghi DNS cũ (mail, TXT, v.v.) trước khi đổi. Đợi Cloudflare báo domain Active.
2. Không tạo bản ghi A trỏ về IP máy khách và không tạo NAT. Khi tạo *Published application* ở bước Tunnel, Cloudflare tạo/quản lý DNS cho `api-spa-xuly` (kiểm tra trạng thái route/DNS trong dashboard; nếu DNS xung đột thì xử lý trước). Giữ tên miền và quyền Cloudflare nếu đổi nhà mạng/máy: hostname frontend không phải đổi.
3. Nếu frontend ở origin `https://app.infinityhavocx.men`, frontend sẽ gọi `https://api-spa-xuly.infinityhavocx.men`: thiết lập `VITE_API_BASE_URL=https://api-spa-xuly.infinityhavocx.men` **lúc build frontend**, sau đó thêm đúng `https://app.infinityhavocx.men` vào `CORS_ORIGINS` backend. Origin frontend hiện chưa được xác nhận; nếu frontend deploy trên domain khác, dùng origin thực tế, không thêm dấu `/` cuối. HTTPS frontend không gọi HTTP API.

## 2. Cài Node và chuẩn bị thư mục trên máy khách

1. Cài Node.js LTS chính thức, git và cập nhật Windows/MySQL. Kiểm tra `node -v`, `npm -v`, `where.exe node`; ghi **đường dẫn tuyệt đối** đến `node.exe` (ví dụ `C:\Program Files\nodejs\node.exe`). Đặt tài khoản MySQL riêng có mật khẩu mạnh, chỉ kết nối `127.0.0.1`; do ứng dụng tạo tenant/database, account phải có quyền thực sự cần cho `db_system_master`, template và tenant, **không mở MySQL ra Internet**. Không cấp quyền `root` nếu có thể tránh; thử luồng tạo tenant/login/invoice trên bản sao DB trước khi áp quyền production.
2. Tạo `C:\SpaBackend\releases`, `C:\SpaBackend\config`, `C:\SpaBackend\service`, `C:\SpaBackend\logs`, `C:\SpaBackend\backups` (backups cần thêm bản sao **ngoài máy**). Đặt một bản release/tag đã duyệt của repo ở `C:\SpaBackend\releases\v1` (qua GitHub Releases hoặc `git clone` và checkout tag); không dùng `scratch/` hay `.env` trong release. Trong thư mục release chạy `npm ci --omit=dev`. Nếu repo private, dùng tài khoản/deploy key **chỉ đọc**, không lưu token GitHub trong script hoặc file public.
3. CMD (Administrator): `mklink /J C:\SpaBackend\current C:\SpaBackend\releases\v1`. Kiểm tra `C:\SpaBackend\current\src\server.js` tồn tại. Đây là junction trỏ tới release đang chạy; không tạo junction nếu `current` đã có thư mục thật.
4. Copy `.env.example` thành `C:\SpaBackend\config\.env`, sửa giá trị thật trong file này, **không** commit. Đường dẫn này là working directory của service; `dotenv` nạp `.env` từ đó. Ví dụ:

   ```dotenv
   NODE_ENV=production
   PORT=5000
   DB_HOST=127.0.0.1
   DB_USER=spa_backend
   DB_PASSWORD=<mat-khau-db-do-ban-tao>
   DB_SYSTEM_NAME=db_system_master
   JWT_SECRET=<chuoi-ngau-nhien-dai-do-ban-tao>
   CORS_ORIGINS=https://app.infinityhavocx.men
   ```

   Để tạo secret trên PowerShell: `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. `DB_PASSWORD` vẫn phải phù hợp với tài khoản MySQL thực tế. Đặt ACL cho `config`/`backups` chỉ tài khoản service, Administrators và người vận hành được phép đọc; tài khoản chạy service cần đọc release/config, ghi logs và kết nối MySQL. Đừng đăng log secret/token.

## 3. Backend chạy Windows Service (WinSW)

Tải WinSW x64 từ GitHub Releases **chính thức** của `winsw/winsw`, kiểm tra chữ ký/hash theo hướng dẫn của nhà phát hành nếu có. Copy executable thành `C:\SpaBackend\service\SpaBackend.exe`. Tạo `C:\SpaBackend\service\SpaBackend.xml` (đổi đường dẫn Node nếu khác):

```xml
<service>
  <id>SpaBackend</id>
  <name>Spa Backend</name>
  <description>Spa Management API</description>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>C:\SpaBackend\current\src\server.js</arguments>
  <workingdirectory>C:\SpaBackend\config</workingdirectory>
  <logpath>C:\SpaBackend\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>10</keepFiles>
  </log>
  <onfailure action="restart" delay="30 sec" />
</service>
```

Trong CMD Administrator chạy `C:\SpaBackend\service\SpaBackend.exe install` rồi `C:\SpaBackend\service\SpaBackend.exe start`. Kiểm tra `sc query SpaBackend`, log `C:\SpaBackend\logs`, `curl.exe -i http://127.0.0.1:5000/api/auth/login` (GET có thể trả 404/405: chỉ cần chứng minh đã tới API; test login POST bằng tài khoản test riêng). `netstat -ano | findstr :5000` phải thấy `127.0.0.1:5000`, **không phải** `0.0.0.0:5000`; từ máy khác trong LAN không được nối tới `:5000`. Nếu DB chưa sẵn sàng khi máy vừa boot, service sẽ thoát và WinSW thử lại; giám sát log để phát hiện lỗi lặp. Cấu hình service startup Automatic trong `services.msc` và khởi động lại Windows thử một lần. Với production nên cấu hình account service quyền tối thiểu (trong Services → Log On), không mặc định để LocalSystem lâu dài; cấp ACL trước khi đổi account, kiểm tra lại quyền MySQL/file và service restart.

## 4. Tạo Cloudflare Tunnel (token, remote-managed)

1. Vào Cloudflare Dashboard → **Networking → Tunnels** (hoặc Zero Trust → Networks → Tunnels tùy phiên bản giao diện) → Create tunnel → chọn **cloudflared**, đặt tên ví dụ `spa-customer-pc`. Chọn kết nối Windows, copy lệnh cài service/token **chỉ một lần vào cửa sổ Administrator trên máy khách**, tuyệt đối không dán token vào GitHub, screenshot, log, tài liệu hay máy không tin cậy. Token tunnel là bí mật có quyền kết nối vào tunnel; nếu lộ, thu hồi/rotate và cài lại connector. Tải `cloudflared.exe` từ nguồn chính thức Cloudflare và dùng lệnh trên dashboard; dạng CMD thường là `cloudflared.exe service install <TUNNEL_TOKEN>` (thay token riêng tư thật khi chạy; không ghi vào file script). Kiểm tra `sc query cloudflared` và tunnel báo **Healthy**.
2. Trong tunnel chọn **Routes → Add route → Published application**: Hostname subdomain `api-spa-xuly`, domain `infinityhavocx.men`, Service URL `http://127.0.0.1:5000` (HTTP local trên **cùng máy**, HTTPS kết thúc ở Cloudflare). Không bật cache cho API; nếu cấu hình WAF/rate limiting cho `/api/auth/login`, test CORS preflight `OPTIONS` và luồng frontend thật. Tránh Access interactive cho API JWT như lưu ý đầu tài liệu.
3. Từ mạng khác (4G) thử `https://api-spa-xuly.infinityhavocx.men/health` và POST `https://api-spa-xuly.infinityhavocx.men/api/auth/login` bằng user test; HTTPS phải hợp lệ. Kiểm tra `sc query cloudflared`, `sc query SpaBackend`, DNS, HTTPS, login, endpoint cần JWT không token phải từ chối, CORS từ frontend hợp lệ. Nếu lỗi 502, kiểm tra origin loopback/WinSW/DB và Cloudflare tunnel; nếu lỗi CORS kiểm tra `CORS_ORIGINS` và build frontend. Tránh ghi raw token JWT/password vào log. Thiết lập cảnh báo uptime từ bên ngoài, backup DB định kỳ và thử **restore** từ backup.

## 5. Nâng cấp tự động từ Git tag (không cần remote máy khách)

Không chạy production trực tiếp theo `main`. Mỗi máy cài Scheduled Task và theo dõi một tag pattern riêng, ví dụ máy `spa-a` dùng `backend-spa-a-v*`. Khi push tag mới khớp pattern, máy tự gọi deploy script, restart service, health-check và rollback code nếu health thất bại. Máy có pattern khác không bị cập nhật.

Sau khi deploy release đầu tiên và cài service:

```powershell
& 'C:\SpaBackend\current\scripts\windows\Install-SpaBackendAutoUpdate.ps1' `
  -ServerId 'spa-a' `
  -TagPattern 'backend-spa-a-v*' `
  -IntervalMinutes 15
```

Phát hành riêng máy A:

```powershell
git tag -a 'backend-spa-a-v1.1.0' -m 'Deploy spa-a v1.1.0'
git push origin 'backend-spa-a-v1.1.0'
```

Theo dõi tại `C:\SpaBackend\logs\auto-update.log`, `C:\SpaBackend\state\deployment.json` và Scheduled Task `SpaBackendAutoUpdate`. Không force-move/reuse tag đã phát hành. Auto-update **không** chạy migration database; release cần đổi schema phải backup và triển khai có giám sát riêng. Repo private cần cơ chế credential/deploy key chỉ đọc hoạt động dưới tài khoản `SYSTEM`; nếu chưa có thì task sẽ không tải được tag/code.

Chi tiết cài mới và checklist dừng an toàn nằm ở `docs/INSTALL_CUSTOMER_SERVER_TOMORROW.md`.

## 5.1. Nâng cấp thủ công có kiểm soát

**Không cần tới tận máy khách** nhưng máy đó phải bật và bạn phải có phương thức quản trị từ xa riêng, bảo vệ bằng MFA và được khách đồng ý (ví dụ công cụ remote-support có kiểm soát); **không mở RDP 3389 ra Internet**. Tunnel API không tự cấp quyền vào desktop. Cách ban đầu: đăng nhập hỗ trợ từ xa, tải release đã duyệt từ GitHub qua HTTPS hoặc git read-only, chạy những bước sau trong phiên bảo trì; không cài GitHub Actions self-hosted runner chạy workflow tùy ý trên máy khách. `git push main` **không** tự deploy và đây là chủ ý để tránh hỏng DB.

1. Ở nhà: chạy test; commit/tag và phát hành release sau review. Kiểm tra migrations trong release và khả năng tương thích frontend/API. Nếu schema đổi, chuẩn bị kế hoạch migration riêng cho template **và mọi tenant**, đối chiếu trạng thái từng schema; backup dữ liệu và lưu một bản ngoài máy; lịch bảo trì/dừng ghi. Không chạy migration mù quáng trong task tự động.
2. Trên máy khách: tải tag mới vào `C:\SpaBackend\releases\v2` (không sửa `current`), chạy `npm ci --omit=dev`, kiểm tra `.env` và test trên máy thử/staging trước; **không** chạy tests `scratch` trực tiếp vào DB production vì có test ghi dữ liệu. Nếu phải chạy migration, dừng backend, backup và chạy **đúng migration đã được kiểm tra** cho từng DB; ghi lại DB nào đã xong. Nếu migration lỗi giữa chừng, giữ backend tắt và khôi phục/xử lý thủ công, không chỉ đổi lại code.
3. Khi đã sẵn sàng, trong CMD Administrator: `C:\SpaBackend\service\SpaBackend.exe stop`, xác nhận service thực sự dừng (`sc query SpaBackend`); `rmdir C:\SpaBackend\current` (**chỉ khi chắc chắn current là junction**, lệnh này không xóa thư mục release đích); `mklink /J C:\SpaBackend\current C:\SpaBackend\releases\v2`; `C:\SpaBackend\service\SpaBackend.exe start`. Giữ nguyên `C:\SpaBackend\config\.env` và tunnel, không commit secret. Test API nội bộ và từ mạng ngoài, test login, đọc và một nghiệp vụ test được phép; kiểm tra logs; ghi tag và thời gian đã deploy.
4. Nếu code lỗi và **schema còn tương thích**: stop service, đổi `current` về `releases\v1`, start, kiểm tra lại. Nếu migration đã đổi schema/data không tương thích, rollback code **không đủ**: cần kế hoạch khôi phục DB từ backup hoặc migration sửa tiến; không xóa DB, không restore đè dữ liệu phát sinh sau backup nếu chưa có quyết định của chủ dữ liệu.

Sau khi quy trình này chạy ổn định, có thể xây dựng script cập nhật **release được duyệt** qua Scheduled Task với deploy key/token chỉ đọc, kiểm tra hash, lock tránh chạy song song, backup + health check + rollback code và thông báo lỗi. Không kích hoạt auto-update/migration chỉ vì push GitHub. Giữ ít nhất hai release và test cả phục hồi khi máy mất điện/mạng.

## 6. Script Windows và triển khai độc lập nhiều máy

Repo dùng chung không đồng nghĩa mọi máy chạy cùng phiên bản. Mỗi máy lưu junction, `.env`, database và `state/deployment.json` riêng. Script bắt buộc nhận tag cụ thể và `ServerId`; tạo tag hoặc push `main` không tự cập nhật máy nào.

### Deploy release đầu tiên trước khi cài service

Copy thư mục `scripts/windows` từ release/bộ cài vào `C:\SpaBackend\scripts`, tạo `C:\SpaBackend\config\.env`, rồi chạy PowerShell Administrator từ source/release có script:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& 'C:\SpaBackend\scripts\Deploy-SpaBackend.ps1' `
  -Version 'backend-v1.0.0' `
  -ServerId 'spa-a'
```

Lần đầu chưa có service, script tải tag, chạy `npm ci --omit=dev --ignore-scripts`, tạo `C:\SpaBackend\current` và ghi state. Sau đó tải WinSW x64 từ nguồn chính thức và cài service:

```powershell
& 'C:\SpaBackend\scripts\Install-SpaBackendService.ps1' `
  -WinSWPath 'C:\Install\WinSW-x64.exe'
```

### Cập nhật riêng máy A, không cập nhật máy B

Ví dụ cùng repo có tag `backend-v1.1.0` nhưng chỉ nâng máy A:

```powershell
# Chỉ chạy trên máy A
& 'C:\SpaBackend\scripts\Deploy-SpaBackend.ps1' `
  -Version 'backend-v1.1.0' `
  -ServerId 'spa-a'
```

Không chạy lệnh trên máy B thì B vẫn giữ phiên bản cũ. Có thể kiểm tra từng máy bằng:

```powershell
Get-Content 'C:\SpaBackend\state\deployment.json'
```

Nếu A và B là hai Spa/database độc lập, dùng tunnel/hostname riêng, ví dụ `api-spa-a.infinityhavocx.men` và `api-spa-b.infinityhavocx.men`; không đặt hai connector độc lập vào cùng một hostname như thể chúng là bản sao của cùng dịch vụ.

### Rollback code

```powershell
& 'C:\SpaBackend\scripts\Rollback-SpaBackend.ps1'
```

Rollback script chỉ đổi code sang `previousVersion`. Nếu release đã chạy migration không tương thích, phải xử lý/khôi phục database theo kế hoạch riêng; rollback code không tự hoàn tác DDL/data.

### Backup database

```powershell
& 'C:\SpaBackend\scripts\Backup-SpaDatabase.ps1' `
  -MySqlBin 'C:\Program Files\MySQL\MySQL Server 8.0\bin' `
  -RetentionDays 30
```

Script đọc credential từ `C:\SpaBackend\config\.env`, lấy danh sách tenant active từ master DB, dump master/template/tất cả tenant vào một file transaction-consistent, tạo SHA-256 và manifest. Mật khẩu được truyền qua biến môi trường tạm `MYSQL_PWD`, không đưa vào command line; vẫn phải bảo vệ ACL của `.env`, backup và tài khoản Windows. Luôn thử restore trên máy/database thử.

## Tài liệu chính thức để đối chiếu khi thao tác

- Mua domain: https://developers.cloudflare.com/registrar/get-started/register-domain/ ; thêm domain mua ở nơi khác: https://developers.cloudflare.com/fundamentals/manage-domains/
- Tunnel/dashboard + route + Windows service token: https://developers.cloudflare.com/tunnel/get-started/ ; https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/
- WinSW XML/service CLI/logs: https://github.com/winsw/winsw/blob/v3/docs/xml-config-file.md ; https://github.com/winsw/winsw/blob/v3/docs/cli-commands.md ; https://github.com/winsw/winsw/blob/v3/docs/logging-and-error-reporting.md
- `npm ci`: https://docs.npmjs.com/cli/v10/commands/npm-ci ; GitHub release/archives: https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives