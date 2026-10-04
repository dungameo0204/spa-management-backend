const mysql = require('mysql2/promise');

// 1. Cấu hình cơ bản (Lấy từ file .env)
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // pool settings để tối ưu hiệu suất, tái sử dụng kết nối
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// 2. Tạo kết nối CỐ ĐỊNH đến Database Hệ Thống (Master)
// Nơi chứa bảng `tenants` và `users`
const masterPool = mysql.createPool({
    ...dbConfig,
    database: process.env.DB_SYSTEM_NAME
});

// 3. Cơ chế LƯU TRỮ KẾT NỐI (Connection Pooling cho Tenants)
// Chúng ta dùng một Object (Map) để ghi nhớ các kết nối tới từng Spa.
// Ví dụ: khi Spa Ngọc Lan đăng nhập lần đầu, kết nối được tạo ra và cất vào đây.
// Lần sau họ bấm thao tác khác, Backend không cần mất công tạo lại kết nối mới.

// HÀM MỚI: Lấy connection trỏ thẳng vào Database của từng Spa
const getTenantDbName = async (tenantId) => {
    // 1. Chỉ định rõ db_system_master.tenants để không bao giờ bị nhầm
    const [tenants] = await masterPool.query(
        'SELECT database_name FROM db_system_master.tenants WHERE id = ? AND deleted_at IS NULL',
        [tenantId]
    );

    if (tenants.length === 0) {
        throw new Error('Spa không tồn tại hoặc đã bị khóa!');
    }

    return tenants[0].database_name; // Ví dụ trả về: "db_spa_1234_abcd"
};

module.exports = {
    masterPool,
    getTenantDbName
};