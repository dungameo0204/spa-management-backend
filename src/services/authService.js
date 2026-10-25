const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { masterPool } = require('../config/database');
const { AuthError } = require('../utils/authError');

const getTenant = async (tenantId) => {
    if (tenantId === null || tenantId === undefined) return null;
    const [tenants] = await masterPool.query('SELECT id, spa_name, deleted_at, expire_at FROM tenants WHERE id = ?', [tenantId]);
    if (!tenants.length || tenants[0].deleted_at !== null) {
        throw new AuthError(403, 'TENANT_DISABLED', 'Spa này đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.');
    }
    const tenant = tenants[0];
    if (tenant.expire_at && new Date(tenant.expire_at).getTime() <= Date.now()) {
        throw new AuthError(403, 'TENANT_EXPIRED', 'Gói phần mềm của Spa đã hết hạn. Vui lòng liên hệ quản trị viên để gia hạn.');
    }
    return { id: tenant.id, spa_name: tenant.spa_name, expire_at: tenant.expire_at };
};

const getSession = async (claims) => {
    if (!Number.isSafeInteger(claims.id) || claims.id <= 0 || claims.customer_id !== undefined ||
        !['SUPER_ADMIN', 'MANAGER', 'STAFF'].includes(claims.system_role) || !Number.isFinite(claims.exp)) {
        throw new AuthError(401, 'AUTH_SESSION_INVALID', 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.');
    }
    const [rows] = await masterPool.query(
        'SELECT id, tenant_id, branch_id, username, fullname, system_role, deleted_at FROM users WHERE id = ?',
        [claims.id]
    );
    const user = rows[0];
    if (!user || user.deleted_at !== null) {
        throw new AuthError(401, 'AUTH_SESSION_INVALID', 'Tài khoản không còn hoạt động. Vui lòng đăng nhập lại.');
    }
    if (user.system_role !== claims.system_role || user.tenant_id !== claims.tenant_id || user.branch_id !== claims.branch_id ||
        (user.system_role !== 'SUPER_ADMIN' && !user.tenant_id)) {
        throw new AuthError(401, 'AUTH_SESSION_CHANGED', 'Phạm vi quyền đã thay đổi. Vui lòng đăng nhập lại.');
    }
    const tenant = await getTenant(user.tenant_id);
    return {
        user: {
            id: user.id, tenant_id: user.tenant_id, branch_id: user.branch_id,
            username: user.username, fullname: user.fullname, system_role: user.system_role
        },
        tenant,
        expires_at: new Date(claims.exp * 1000).toISOString()
    };
};

const login = async (username, password) => {
    // 1. Tìm tài khoản trong bảng users (Nằm ở db_system_master)
    const [rows] = await masterPool.query('SELECT * FROM users WHERE username = ?', [username]);
    
    if (rows.length === 0) {
        throw new AuthError(401, 'AUTH_CREDENTIALS_INVALID', 'Tài khoản hoặc mật khẩu không chính xác!');
    }

    const user = rows[0];

    // 2. Kiểm tra tài khoản có bị XÓA MỀM không (THAY ĐỔI Ở ĐÂY)
    if (user.deleted_at !== null) {
        throw new AuthError(401, 'AUTH_CREDENTIALS_INVALID', 'Tài khoản hoặc mật khẩu không chính xác!');
    }

    // 3. So sánh mật khẩu bằng bcrypt (Đã xóa bỏ đoạn châm chước mật khẩu text hôm trước)
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        throw new AuthError(401, 'AUTH_CREDENTIALS_INVALID', 'Tài khoản hoặc mật khẩu không chính xác!');
    }

    await getTenant(user.tenant_id);

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
    login,
    getSession
};