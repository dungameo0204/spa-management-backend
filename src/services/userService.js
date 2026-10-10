const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');
const bcrypt = require('bcryptjs');

// HÀM BỔ TRỢ: Kiểm tra xem branch_id có tồn tại trong DB của Spa không
const checkBranchExists = async (tenantId, branchId) => {
    const dbName = await getTenantDbName(tenantId);
    const [branches] = await masterPool.query(
        `SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`,
        [branchId]
    );
    if (branches.length === 0) throw new Error('Cơ sở/Chi nhánh không tồn tại hoặc đã bị đóng cửa!');
};

// 1. TẠO TÀI KHOẢN
const createUser = async (tenantId, username, password, fullname, systemRole, branchId, executorName) => {
    if (systemRole === 'SUPER_ADMIN') throw new Error('Hành vi bị cấm!');
    if (!['MANAGER', 'STAFF'].includes(systemRole)) throw new Error('Quyền hệ thống không hợp lệ.');

    // --- LOGIC GẮN NHÁNH THEO QUYỀN ---
    let finalBranchId = branchId;
    if (systemRole === 'MANAGER') {
        finalBranchId = null; // Quản lý tổng thì không gắn vào cơ sở nào
    } else if (systemRole === 'STAFF') {
        if (!finalBranchId) throw new Error('Tài khoản STAFF bắt buộc phải có branch_id!');
        await checkBranchExists(tenantId, finalBranchId); // Kiểm tra xem ID cơ sở này có thật không
    }

    // 1. Kiểm tra username tồn tại (chỉ check các tài khoản chưa bị xóa mềm)
    const [existingUsers] = await masterPool.query(
        'SELECT id FROM users WHERE username = ? AND deleted_at IS NULL', 
        [username]
    );
    if (existingUsers.length > 0) throw new Error(`Tên đăng nhập '${username}' đã tồn tại!`);

    // 2. Băm mật khẩu
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Lưu vào Database
    const [result] = await masterPool.query(
        'INSERT INTO users (tenant_id, branch_id, username, password, fullname, system_role, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [tenantId, finalBranchId, username, hashedPassword, fullname, systemRole, executorName]
    );

    return result.insertId;
};

// 2. LẤY DANH SÁCH TÀI KHOẢN
const getUsersByTenant = async (tenantId, searchKeyword = '', pagination) => {
    let query = `SELECT id, branch_id, username, fullname, system_role, created_at, deleted_at FROM users WHERE tenant_id = ?`;
    const params = [tenantId];

    if (searchKeyword) {
        query += ` AND (username LIKE ? OR fullname LIKE ?)`;
        params.push(`%${searchKeyword}%`, `%${searchKeyword}%`);
    }

    const result = await paginateQuery(masterPool, query, params, 'created_at DESC, id DESC', pagination);
    const rows = result.data;
    
    if (rows.length > 0) {
        const dbName = await getTenantDbName(tenantId);
        const [branches] = await masterPool.query(`SELECT id, name FROM \`${dbName}\`.branches WHERE deleted_at IS NULL`);
        
        const branchMap = {};
        branches.forEach(b => branchMap[b.id] = b.name);

        rows.forEach(user => {
            user.branch_name = user.branch_id ? branchMap[user.branch_id] : 'Tổng công ty';
        });
    }

    return result;
};

const getUserDetail = async (tenantId, userId) => {
    const [users] = await masterPool.query(
        'SELECT id, branch_id, username, fullname, system_role, created_at, deleted_at FROM users WHERE id = ? AND tenant_id = ?',
        [userId, tenantId]
    );
    if (users.length === 0) throw new Error('Không tìm thấy tài khoản nhân viên!');
    const user = users[0];
    if (!user.branch_id) {
        user.branch_name = 'Tổng công ty';
    } else {
        const dbName = await getTenantDbName(tenantId);
        const [branches] = await masterPool.query(
            `SELECT name FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`,
            [user.branch_id]
        );
        if (branches.length > 0) user.branch_name = branches[0].name;
    }
    return user;
};

// 3. CẬP NHẬT THÔNG TIN TÀI KHOẢN
const updateUser = async (tenantId, targetUserId, updateData, executorName) => {
    const [checkUser] = await masterPool.query(
        'SELECT id, username, system_role, branch_id FROM users WHERE id = ? AND tenant_id = ?',
        [targetUserId, tenantId]
    );

    if (checkUser.length === 0) throw new Error('Không tìm thấy tài khoản nhân viên!');

    const { newUsername, fullname, newPassword, newRole, branchId } = updateData;
    const effectiveRole = newRole === undefined ? checkUser[0].system_role : newRole;
    if (!['MANAGER', 'STAFF'].includes(effectiveRole)) throw new Error('Quyền hệ thống không hợp lệ.');
    let finalBranchId = null;
    if (effectiveRole === 'STAFF') {
        const candidate = branchId === undefined ? checkUser[0].branch_id : branchId;
        if (candidate === null || candidate === undefined || !/^[1-9]\d*$/.test(String(candidate)) || !Number.isSafeInteger(Number(candidate))) {
            throw new Error('Tài khoản STAFF bắt buộc phải có branchId hợp lệ.');
        }
        finalBranchId = Number(candidate);
        await checkBranchExists(tenantId, finalBranchId);
    }

    let updateFields = [];
    let params = [];

    if (newUsername && newUsername !== checkUser[0].username) {
        const [existing] = await masterPool.query('SELECT id FROM users WHERE username = ?', [newUsername]);
        if (existing.length > 0) throw new Error('Tên đăng nhập mới đã có người sử dụng!');
        updateFields.push('username = ?');
        params.push(newUsername);
    }

    if (fullname) { updateFields.push('fullname = ?'); params.push(fullname); }
    if (newRole && newRole !== checkUser[0].system_role) { updateFields.push('system_role = ?'); params.push(newRole); }
    
    // Mọi lần sửa MANAGER đều ghi NULL, kể cả khi frontend gửi branchId cũ.
    if (effectiveRole === 'MANAGER' || finalBranchId !== checkUser[0].branch_id) {
        updateFields.push('branch_id = ?');
        params.push(finalBranchId);
    }

    if (newPassword) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        updateFields.push('password = ?');
        params.push(hashedPassword);
    }

    if (updateFields.length > 0) {
        updateFields.push('updated_by = ?');
        params.push(executorName);
        params.push(targetUserId, tenantId);

        await masterPool.query(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    }
};

// 4. XÓA TÀI KHOẢN
const deleteUser = async (tenantId, targetUserId, executorName) => {
    const [check] = await masterPool.query('SELECT id FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [targetUserId, tenantId]);
    if (check.length === 0) throw new Error('Tài khoản không tồn tại hoặc đã bị xóa.');

    const now = new Date();
    await masterPool.query(
        'UPDATE users SET deleted_at = ?, deleted_by = ? WHERE id = ?',
        [now, executorName, targetUserId]
    );
};

// 5. KHÔI PHỤC TÀI KHOẢN
const restoreUser = async (tenantId, targetUserId, executorName) => {
    const [check] = await masterPool.query('SELECT id FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL', [targetUserId, tenantId]);
    if (check.length === 0) throw new Error('Tài khoản chưa bị xóa, không thể khôi phục.');

    await masterPool.query(
        'UPDATE users SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?',
        [executorName, targetUserId]
    );
};

module.exports = { createUser, getUsersByTenant, getUserDetail, updateUser, deleteUser, restoreUser };