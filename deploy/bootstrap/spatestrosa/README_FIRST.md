# Spa Test Rosa Bootstrap

Đây là gói cài đặt **môi trường dùng thử Rosa trước khi vận hành chính thức**.

## Thông tin môi trường

| Mục | Giá trị |
| --- | --- |
| Server ID | `spatestrosa` |
| Backend release đầu tiên | `backend-spatestrosa-v1.0.0` |
| Bản vá ảnh da hiện tại | `backend-spatestrosa-v1.0.1` |
| Kênh cập nhật | `backend-spatestrosa-v*` |
| API public | `https://api-spa-testrosa.infinityhavocx.men` |
| Frontend public | `https://app-spa-testrosa.infinityhavocx.men` |
| Tenant database có dữ liệu dùng thử | `db_spa_1791039769068_e185` |

## Dùng gói này như thế nào

1. Kiểm tra SHA-256 của ZIP trước khi giải nén.
2. Giải nén vào `C:\Install\SpaBackendBootstrap_SpaTestRosa`.
3. Làm lần lượt theo `INSTALL_TEST_ENVIRONMENT.md`.
4. Chỉ import SQL vào MySQL/database **dùng cho môi trường test mới**. Không import vào database production đang sử dụng.

Gói có ba SQL export, bao gồm dữ liệu tenant dùng thử. Không gửi ZIP, SQL hoặc ảnh chụp dữ liệu ra nơi công khai.

## Phạm vi thử nghiệm

- Không yêu cầu thiết lập backup hoặc Scheduled Task backup cho đợt dùng thử này.
- Không bật auto-update trong thời gian test trừ khi người phụ trách yêu cầu riêng.
- Không sử dụng Super Admin để thao tác các tenant khác xuất hiện trong master export: package chỉ kèm dump cho tenant được ghi ở bảng trên.
- Khi chuyển sang vận hành chính thức, cần tạo release/package production riêng và rà soát lại dữ liệu, quyền truy cập, backup, monitoring và quy trình cập nhật.

## Nội dung chính

- `INSTALL_TEST_ENVIRONMENT.md`: runbook cài môi trường Rosa test.
- `.env.example`: cấu hình backend mẫu với CORS Rosa; không có secret thật.
- `db_system_master.sql`, `db_spa_template.sql`, `db_spa_1791039769068_e185.sql`: ba SQL export cần import.
- `scripts\windows\`: script deploy, service, rollback và auto-update (không cần bật auto-update khi test).
- `manifest.json`: danh sách file và SHA-256 từng file trong package.