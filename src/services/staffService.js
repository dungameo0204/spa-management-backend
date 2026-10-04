const { masterPool, getTenantDbName } = require('../config/database');

// TẠO MỚI
const createStaff = async (tenantId, staffData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let { fullname, phone_number, address, role_id, branch_id } = staffData;

    // --- LOGIC PHÂN QUYỀN ĐA CHI NHÁNH ---
    if (userRole === 'STAFF') {
        if (!userBranchId) throw new Error('Tài khoản của bạn chưa được cấp cơ sở, không thể thêm nhân viên!');
        branch_id = userBranchId; // Bắt buộc lấy branch_id của người đang đăng nhập, phớt lờ data gửi lên
    }
    // ------------------------------------

    // Logic kiểm tra trùng lặp (Tên + SDT) giữ nguyên như bạn vừa yêu cầu
    if (phone_number) {
        const [existing] = await masterPool.query(
            `SELECT id FROM \`${dbName}\`.staffs WHERE fullname = ? AND phone_number = ? AND deleted_at IS NULL`,
            [fullname, phone_number]
        );
        if (existing.length > 0) throw new Error('Nhân sự này đã tồn tại!');
    } else {
        const [existing] = await masterPool.query(
            `SELECT id FROM \`${dbName}\`.staffs WHERE fullname = ? AND (phone_number IS NULL OR phone_number = '') AND deleted_at IS NULL`,
            [fullname]
        );
        if (existing.length > 0) throw new Error('Đã có nhân sự trùng tên!');
    }

    const [result] = await masterPool.query(
        `INSERT INTO \`${dbName}\`.staffs (fullname, phone_number, address, role_id, branch_id, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
        [fullname, phone_number || null, address || null, role_id || null, branch_id || null, executorName]
    );
    return result.insertId;
};

// LẤY DANH SÁCH
// ... trong staffService.js

// ... trong staffService.js

const getStaffs = async (tenantId, searchKeyword = '', userRole, userBranchId, filterBranchId, filterRoleId) => {
    const dbName = await getTenantDbName(tenantId);
    
    let query = `
        SELECT s.*, r.name AS role_name, b.name AS branch_name
        FROM \`${dbName}\`.staffs s
        LEFT JOIN \`${dbName}\`.roles r ON s.role_id = r.id
        LEFT JOIN \`${dbName}\`.branches b ON s.branch_id = b.id
        WHERE s.deleted_at IS NULL
    `;
    const params = [];

    // 1. Phân quyền và Lọc theo Cơ sở (Branch)
    if (userRole === 'STAFF') {
        query += ` AND s.branch_id = ?`;
        params.push(userBranchId);
    } else if (filterBranchId) {
        query += ` AND s.branch_id = ?`;
        params.push(filterBranchId);
    }

    // 2. BỔ SUNG: Lọc theo Chức vụ (Role)
    if (filterRoleId) {
        query += ` AND s.role_id = ?`;
        params.push(filterRoleId);
    }

    // 3. Tìm kiếm theo Tên hoặc Số điện thoại
    if (searchKeyword) {
        query += ` AND (s.fullname LIKE ? OR s.phone_number LIKE ?)`;
        params.push(`%${searchKeyword}%`, `%${searchKeyword}%`);
    }
    
    query += ` ORDER BY s.created_at DESC`;
    
    const [rows] = await masterPool.query(query, params);
    return rows;
};

// KIỂM TRA QUYỀN TRUY CẬP (Hàm dùng chung cho Update/Delete/Restore)
const checkBranchPermission = async (dbName, staffId, userRole, userBranchId) => {
    const [staff] = await masterPool.query(`SELECT branch_id FROM \`${dbName}\`.staffs WHERE id = ?`, [staffId]);
    if (staff.length === 0) throw new Error('Hồ sơ không tồn tại!');
    
    if (userRole === 'STAFF' && staff[0].branch_id !== userBranchId) {
        throw new Error('Bạn không có quyền thao tác trên nhân viên của cơ sở khác!');
    }
};

// CẬP NHẬT
// Tìm hàm updateStaff trong staffService.js và thay bằng đoạn này:

const updateStaff = async (tenantId, staffId, updateData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    await checkBranchPermission(dbName, staffId, userRole, userBranchId);

    const { fullname, phone_number, address, role_id, branch_id } = updateData;
    
    let updateFields = [];
    let params = [];

    // Người dùng CÓ gửi trường nào lên (khác undefined), thì mới add vào câu SQL
    if (fullname !== undefined) { 
        updateFields.push('fullname = ?'); 
        params.push(fullname); 
    }
    
    if (phone_number !== undefined) { 
        updateFields.push('phone_number = ?'); 
        params.push(phone_number || null); 
    }
    
    if (address !== undefined) { 
        updateFields.push('address = ?'); 
        params.push(address || null); 
    }
    
    if (role_id !== undefined) {
        if (role_id) { // Nếu có truyền ID thì check xem ID chức vụ có tồn tại ko
            const [roles] = await masterPool.query(`SELECT id FROM \`${dbName}\`.roles WHERE id = ? AND deleted_at IS NULL`, [role_id]);
            if (roles.length === 0) throw new Error('Chức vụ không tồn tại!');
        }
        updateFields.push('role_id = ?'); 
        params.push(role_id || null);
    }

    // Xử lý Branch ID (Phân quyền chi nhánh)
    if (userRole === 'STAFF') {
        updateFields.push('branch_id = ?'); 
        params.push(userBranchId); // STAFF tự sửa thì vẫn giữ nguyên cơ sở cũ
    } else if (branch_id !== undefined) {
        updateFields.push('branch_id = ?'); 
        params.push(branch_id || null);
    }

    // Nếu mảng updateFields có dữ liệu (có ít nhất 1 trường cần update)
    if (updateFields.length > 0) {
        updateFields.push('updated_by = ?'); 
        params.push(executorName);
        
        params.push(staffId); // Thêm staffId cho điều kiện WHERE cuối cùng

        const query = `UPDATE \`${dbName}\`.staffs SET ${updateFields.join(', ')} WHERE id = ?`;
        await masterPool.query(query, params);
    }
};

// XÓA
const deleteStaff = async (tenantId, staffId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    await checkBranchPermission(dbName, staffId, userRole, userBranchId);

    const now = new Date();
    await masterPool.query(
        `UPDATE \`${dbName}\`.staffs SET deleted_at = ?, deleted_by = ? WHERE id = ?`,
        [now, executorName, staffId]
    );
};

// KHÔI PHỤC
const restoreStaff = async (tenantId, staffId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    await checkBranchPermission(dbName, staffId, userRole, userBranchId);

    await masterPool.query(
        `UPDATE \`${dbName}\`.staffs SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?`,
        [executorName, staffId]
    );
};

module.exports = { createStaff, getStaffs, updateStaff, deleteStaff, restoreStaff };