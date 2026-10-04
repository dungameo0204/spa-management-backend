const { masterPool, getTenantDbName } = require('../config/database');

const createBranch = async (tenantId, branchData, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    // Bóc tách dữ liệu từ Object truyền vào
    const { 
        name, address, bank_code, bank_account_no, 
        bank_account_name, payment_provider, 
        payment_api_key, payment_client_id 
    } = branchData;

    const [existing] = await masterPool.query(
        `SELECT id FROM \`${dbName}\`.branches WHERE name = ? AND deleted_at IS NULL`,
        [name]
    );
    if (existing.length > 0) throw new Error('Tên cơ sở/chi nhánh này đã tồn tại trong hệ thống!');

    const [result] = await masterPool.query(
        `INSERT INTO \`${dbName}\`.branches (
            name, address, bank_code, bank_account_no, bank_account_name, 
            payment_provider, payment_api_key, payment_client_id, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            name, 
            address || null, 
            bank_code || null, 
            bank_account_no || null, 
            bank_account_name || null, 
            payment_provider || 'MANUAL', 
            payment_api_key || null, 
            payment_client_id || null, 
            executorName
        ]
    );
    return result.insertId;
};

const getBranches = async (tenantId, searchKeyword = '') => {
    const dbName = await getTenantDbName(tenantId);
    
    let query = `SELECT * FROM \`${dbName}\`.branches WHERE deleted_at IS NULL`;
    const params = [];

    if (searchKeyword) {
        query += ` AND (name LIKE ? OR address LIKE ?)`;
        params.push(`%${searchKeyword}%`, `%${searchKeyword}%`);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const [rows] = await masterPool.query(query, params);
    return rows;
};

const updateBranch = async (tenantId, branchId, updateData, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`, [branchId]);
    if (check.length === 0) throw new Error('Chi nhánh không tồn tại hoặc đã bị xóa!');

    let updateFields = [];
    let params = [];

    // Xử lý riêng trường name để check trùng
    if (updateData.name !== undefined) {
        const [existing] = await masterPool.query(`SELECT id FROM \`${dbName}\`.branches WHERE name = ? AND id != ? AND deleted_at IS NULL`, [updateData.name, branchId]);
        if (existing.length > 0) throw new Error('Tên chi nhánh này đã được sử dụng!');
        
        updateFields.push('name = ?');
        params.push(updateData.name);
    }

    // Mảng các trường có thể update (không bao gồm name)
    const allowedFields = [
        'address', 'bank_code', 'bank_account_no', 'bank_account_name', 
        'payment_provider', 'payment_api_key', 'payment_client_id'
    ];

    allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
            updateFields.push(`${field} = ?`);
            // Cho phép truyền rỗng hoặc null để xóa thông tin ngân hàng cũ đi
            params.push(updateData[field] || null); 
        }
    });

    if (updateFields.length > 0) {
        updateFields.push('updated_by = ?');
        params.push(executorName);
        params.push(branchId);

        await masterPool.query(`UPDATE \`${dbName}\`.branches SET ${updateFields.join(', ')} WHERE id = ?`, params);
    }
};

const deleteBranch = async (tenantId, branchId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`, [branchId]);
    if (check.length === 0) throw new Error('Chi nhánh không tồn tại hoặc đã bị xóa.');

    const now = new Date();
    await masterPool.query(
        `UPDATE \`${dbName}\`.branches SET deleted_at = ?, deleted_by = ? WHERE id = ?`,
        [now, executorName, branchId]
    );
};

const restoreBranch = async (tenantId, branchId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NOT NULL`, [branchId]);
    if (check.length === 0) throw new Error('Chi nhánh chưa bị xóa, không thể khôi phục.');

    await masterPool.query(
        `UPDATE \`${dbName}\`.branches SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?`,
        [executorName, branchId]
    );
};

module.exports = { createBranch, getBranches, updateBranch, deleteBranch, restoreBranch };