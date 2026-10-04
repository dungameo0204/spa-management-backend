// src/services/roleService.js
const { masterPool, getTenantDbName } = require('../config/database'); // Import cả 2 cái

const createRole = async (tenantId, name, description, executorName) => {
    // 1. Lấy tên DB của Spa đó
    const dbName = await getTenantDbName(tenantId);
    
    // Kiểm tra trùng tên role (Chú ý cách nhét biến dbName vào chuỗi SQL)
    const [existing] = await masterPool.query(
        `SELECT id FROM \`${dbName}\`.roles WHERE name = ? AND deleted_at IS NULL`,
        [name]
    );
    if (existing.length > 0) throw new Error('Tên chức vụ này đã tồn tại!');

    // Insert thẳng vào DB của Spa đó (Chú ý: \`${dbName}\`.roles)
    const [result] = await masterPool.query(
        `INSERT INTO \`${dbName}\`.roles (name, description, created_by) VALUES (?, ?, ?)`,
        [name, description, executorName]
    );
    return result.insertId;
};

const getRoles = async (tenantId, searchKeyword = '') => {
    const dbName = await getTenantDbName(tenantId);
    
    let query = `SELECT * FROM \`${dbName}\`.roles WHERE deleted_at IS NULL`;
    const params = [];

    if (searchKeyword) {
        query += ` AND name LIKE ?`;
        params.push(`%${searchKeyword}%`);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const [rows] = await masterPool.query(query, params);
    return rows;
};

const updateRole = async (tenantId, roleId, updateData, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.roles WHERE id = ? AND deleted_at IS NULL`, [roleId]);
    if (check.length === 0) throw new Error('Chức vụ không tồn tại!');

    const { name, description } = updateData;
    let updateFields = [];
    let params = [];

    if (name !== undefined) {
        // Nếu có đổi tên, check xem trùng tên khác không
        const [existing] = await masterPool.query(`SELECT id FROM \`${dbName}\`.roles WHERE name = ? AND id != ? AND deleted_at IS NULL`, [name, roleId]);
        if (existing.length > 0) throw new Error('Tên chức vụ này đã tồn tại!');
        
        updateFields.push('name = ?');
        params.push(name);
    }

    if (description !== undefined) {
        updateFields.push('description = ?');
        params.push(description);
    }

    if (updateFields.length > 0) {
        updateFields.push('updated_by = ?');
        params.push(executorName);
        params.push(roleId);

        await masterPool.query(`UPDATE \`${dbName}\`.roles SET ${updateFields.join(', ')} WHERE id = ?`, params);
    }
};

const deleteRole = async (tenantId, roleId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.roles WHERE id = ? AND deleted_at IS NULL`, [roleId]);
    if (check.length === 0) throw new Error('Chức vụ không tồn tại hoặc đã bị xóa.');

    const now = new Date();
    await masterPool.query(
        `UPDATE \`${dbName}\`.roles SET deleted_at = ?, deleted_by = ? WHERE id = ?`,
        [now, executorName, roleId]
    );
};

const restoreRole = async (tenantId, roleId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.roles WHERE id = ? AND deleted_at IS NOT NULL`, [roleId]);
    if (check.length === 0) throw new Error('Chức vụ chưa bị xóa, không thể khôi phục.');

    await masterPool.query(
        `UPDATE \`${dbName}\`.roles SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?`,
        [executorName, roleId]
    );
};

module.exports = { createRole, getRoles, updateRole, deleteRole, restoreRole };