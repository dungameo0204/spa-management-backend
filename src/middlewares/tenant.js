const { masterPool } = require('../config/database');

/**
 * Middleware: Xác định Database của Spa dựa vào thông tin User
 * (Lưu ý: Middleware này phải chạy SAU Middleware xác thực đăng nhập - auth)
 */
const attachTenantDB = async (req, res, next) => {
    try {
        // Giả sử middleware `auth.js` (chưa viết) đã giải mã xong và gắn `req.user` vào request
        const user = req.user;

        // Nếu là SUPER_ADMIN đang thực hiện nghiệp vụ trên Master DB, thì cho đi qua luôn
        if (!user.tenant_id) {
            return next();
        }

        // Truy vấn vào DB Hệ thống để tìm tên DB của Spa này
        const [rows] = await masterPool.query(
            'SELECT database_name, deleted_at, expire_at FROM tenants WHERE id = ?', 
              [user.tenant_id]
                  );

        if (rows.length === 0) {
            return res.status(403).json({ code: 'TENANT_DISABLED', message: 'Không tìm thấy thông tin cơ sở (Tenant).' });
        }

        const tenant = rows[0];

        // Kiểm tra xem Spa có bị hệ thống khóa tay không
        if (tenant.deleted_at !== null) {
            return res.status(403).json({ code: 'TENANT_DISABLED', message: 'Tài khoản Spa này đã bị khóa hệ thống!' });
        }

        // Kiểm tra xem Spa đã hết hạn sử dụng phần mềm chưa (Áp dụng cho gói Thuê)
        if (tenant.expire_at) {
            const now = new Date();
            const expireDate = new Date(tenant.expire_at);
            
            // Tính số mili-giây chênh lệch
            const timeDiff = expireDate.getTime() - now.getTime();
            
            // Quy đổi mili-giây ra số ngày
            const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)); 

            if (timeDiff <= 0) {
                // Trường hợp 1: Đã quá hạn thật sự -> CHẶN ĐỨNG YÊU CẦU
                return res.status(403).json({ 
                    code: 'TENANT_EXPIRED',
                    message: 'Gói phần mềm đã hết hạn! Vui lòng gia hạn để tiếp tục sử dụng.' 
                });
            } else if (daysLeft <= 10) {
                // Trường hợp 2: Còn dưới 10 ngày -> CHỈ CẢNH BÁO, VẪN CHO ĐI TIẾP
                // Đính kèm cảnh báo vào Header (để ReactJS đọc được ở mọi API)
                res.setHeader('X-Expire-Warning', `Phần mềm sẽ hết hạn sau ${daysLeft} ngày nữa.`);
                res.setHeader('X-Expire-Days-Left', daysLeft);
                
                // Gắn thêm vào req phòng khi Controller nào đó cần dùng trực tiếp
                req.expireWarning = `Phần mềm của bạn sắp hết hạn sau ${daysLeft} ngày.`;
            }
        }

        // 🌟 Gắn cái tên database (VD: 'db_spa_ngoclan') vào req để thằng đằng sau dùng
        req.tenantDbName = tenant.database_name;

        // Cho phép request đi tiếp tới Controller
        next();
        
    } catch (error) {
        console.error('[Tenant Middleware Error]', error);
        res.status(500).json({ code: 'TENANT_SERVICE_ERROR', message: 'Lỗi xác thực hệ thống Tenant.' });
    }
};

module.exports = {
    attachTenantDB
};