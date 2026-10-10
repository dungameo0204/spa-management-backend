const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { masterPool } = require('../config/database');

const login = async (username, password) => {
    // 1. Tìm tài khoản trong bảng users (Nằm ở db_system_master)
    const [rows] = await masterPool.query('SELECT * FROM users WHERE username = ?', [username]);
    
    if (rows.length === 0) {
        throw new Error('Tài khoản hoặc mật khẩu không chính xác!');
    }

    const user = rows[0];

    // 2. Kiểm tra tài khoản có bị XÓA MỀM không (THAY ĐỔI Ở ĐÂY)
    if (user.deleted_at !== null) {
        throw new Error('Tài khoản này không tồn tại hoặc đã bị xóa!');
    }

    if (user.tenant_id) {
        const [tenants] = await masterPool.query('SELECT deleted_at, expire_at FROM tenants WHERE id = ?', [user.tenant_id]);
        if (tenants.length === 0 || tenants[0].deleted_at !== null) throw new Error('Spa này đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.');
        if (tenants[0].expire_at && new Date(tenants[0].expire_at).getTime() <= Date.now()) throw new Error('Gói phần mềm của Spa đã hết hạn. Vui lòng liên hệ quản trị viên để gia hạn.');
    }

    // 3. So sánh mật khẩu bằng bcrypt (Đã xóa bỏ đoạn châm chước mật khẩu text hôm trước)
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        throw new Error('Tài khoản hoặc mật khẩu không chính xác!');
    }

    // 4. Tạo thẻ JWT (Token)
    const payload = {
        id: user.id,
        tenant_id: user.tenant_id, // Nếu là Super Admin thì cái này có thể là null
        username: user.username,
        fullname: user.fullname,
        branch_id: user.branch_id,
        system_role: user.system_role
    };

    // Tạo token có hạn 15 giờ (như code bạn gửi)
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15h' });

    // 5. Trả về thông tin cho Controller (Ẩn mật khẩu đi)
    delete user.password;
    
    return {
        user,
        token
    };
};

module.exports = {
    login
};