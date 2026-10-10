const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');
const bcrypt = require('bcryptjs'); // Đừng quên import thư viện mã hóa

const createCustomer = async (tenantId, customerData, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    // Bóc tách tất cả các trường từ bảng mới
    const { fullname, phone_number, password, avatar, address, note } = customerData;

    // Kiểm tra trùng số điện thoại
    const [existing] = await masterPool.query(
        `SELECT id FROM \`${dbName}\`.customers WHERE phone_number = ? AND deleted_at IS NULL`,
        [phone_number]
    );
    if (existing.length > 0) {
        throw new Error(`Khách hàng với số điện thoại '${phone_number}' đã tồn tại trong hệ thống!`);
    }

    // Mã hóa mật khẩu nếu có (Khi khách tự đăng ký qua MiniApp)
    let hashedPassword = null;
    if (password) {
        const salt = await bcrypt.genSalt(10);
        hashedPassword = await bcrypt.hash(password, salt);
    }

    const [result] = await masterPool.query(
        `INSERT INTO \`${dbName}\`.customers 
        (fullname, phone_number, password, avatar, address, note, created_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            fullname, 
            phone_number, 
            hashedPassword, // Lưu mật khẩu đã mã hóa (hoặc null nếu Lễ tân tạo nhanh)
            avatar || null, 
            address || null, 
            note || null, 
            executorName
        ]
    );

    return result.insertId;
};

const getCustomers = async (tenantId, searchKeyword = '', pagination) => {
    const dbName = await getTenantDbName(tenantId);
    
    // Lưu ý: Tuyệt đối không Select trả về cột password cho Frontend
    let query = `
        SELECT id, fullname, phone_number, avatar, address, wallet_balance, total_debt, note, created_at, updated_at 
        FROM \`${dbName}\`.customers 
        WHERE deleted_at IS NULL
    `;
    const params = [];

    if (searchKeyword) {
        query += ` AND (fullname LIKE ? OR phone_number LIKE ?)`;
        params.push(`%${searchKeyword}%`, `%${searchKeyword}%`);
    }
    
    return paginateQuery(masterPool, query, params, 'created_at DESC, id DESC', pagination);
};

const getCustomerById = async (tenantId, customerId) => {
    const dbName = await getTenantDbName(tenantId);
    const [rows] = await masterPool.query(
        `SELECT id, fullname, phone_number, avatar, address, wallet_balance, total_debt, note, created_at, updated_at, created_by, updated_by
         FROM \`${dbName}\`.customers
         WHERE id = ? AND deleted_at IS NULL`,
        [customerId]
    );
    if (rows.length === 0) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');
    return rows[0];
};

const updateCustomer = async (tenantId, customerId, updateData, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL`, [customerId]);
    if (check.length === 0) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa!');

    let updateFields = [];
    let params = [];

    // 1. Xử lý Phone Number để check trùng
    if (updateData.phone_number !== undefined) { 
        const [existing] = await masterPool.query(
            `SELECT id FROM \`${dbName}\`.customers WHERE phone_number = ? AND id != ? AND deleted_at IS NULL`, 
            [updateData.phone_number, customerId]
        );
        if (existing.length > 0) throw new Error('Số điện thoại này đã được khách hàng khác sử dụng!');
        
        updateFields.push('phone_number = ?'); 
        params.push(updateData.phone_number); 
    }
    
    // 2. Xử lý Password (Nếu có gửi lên thì phải mã hóa lại)
    if (updateData.password !== undefined && updateData.password !== '') {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(updateData.password, salt);
        updateFields.push('password = ?');
        params.push(hashedPassword);
    }

    // 3. Xử lý các trường cơ bản khác
    const allowedFields = ['fullname', 'avatar', 'address', 'note'];
    allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
            updateFields.push(`${field} = ?`);
            params.push(updateData[field] || null); 
        }
    });

    if (updateFields.length > 0) {
        updateFields.push('updated_by = ?'); 
        params.push(executorName);
        params.push(customerId);

        const query = `UPDATE \`${dbName}\`.customers SET ${updateFields.join(', ')} WHERE id = ?`;
        await masterPool.query(query, params);
    }
};

// Hàm dành riêng cho việc Đổi mật khẩu qua MiniApp (Quên mật khẩu)
const updatePasswordByPhone = async (tenantId, phone_number, newPassword) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.customers WHERE phone_number = ? AND deleted_at IS NULL`, [phone_number]);
    if (check.length === 0) throw new Error('Số điện thoại không tồn tại trong hệ thống!');

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await masterPool.query(
        `UPDATE \`${dbName}\`.customers SET password = ?, updated_by = ? WHERE phone_number = ?`,
        [hashedPassword, 'SYSTEM_MINIAPP', phone_number]
    );
};

const deleteCustomer = async (tenantId, customerId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL`, [customerId]);
    if (check.length === 0) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');

    const now = new Date();
    await masterPool.query(
        `UPDATE \`${dbName}\`.customers SET deleted_at = ?, deleted_by = ? WHERE id = ?`,
        [now, executorName, customerId]
    );
};

const restoreCustomer = async (tenantId, customerId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NOT NULL`, [customerId]);
    if (check.length === 0) throw new Error('Khách hàng chưa bị xóa, không thể khôi phục.');

    await masterPool.query(
        `UPDATE \`${dbName}\`.customers SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?`,
        [executorName, customerId]
    );
};

module.exports = { 
    createCustomer, 
    getCustomers, 
    getCustomerById,
    updateCustomer, 
    deleteCustomer, 
    restoreCustomer,
    updatePasswordByPhone // Xuất thêm hàm mới
};