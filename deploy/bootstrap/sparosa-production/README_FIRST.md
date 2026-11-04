# Rosa Production Bootstrap

Package này dành riêng cho môi trường production Rosa:

- API: `https://api-spa-rosa.infinityhavocx.men`
- Frontend: `https://app-spa-rosa.infinityhavocx.men`
- Backend MySQL user: `rosa@127.0.0.1`

Nó **không** chứa tunnel token, R2 credential, JWT secret, mật khẩu MySQL, Super Admin password, tenant dump, tenant test hoặc upload ảnh khách hàng. Đọc và thực hiện tuần tự `INSTALL_PRODUCTION.md` trên server Windows production.

Không dùng package `SpaTestRosa` cho server này.