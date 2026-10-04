const { masterPool } = require('../config/database');
const bcrypt = require('bcryptjs');

const createNewSpa = async (spaName, managerUsername, managerPassword, managerFullname, years, creatorName) => {
    const connection = await masterPool.getConnection();
    
    try {
        const [existingUsers] = await connection.query(
            'SELECT id FROM users WHERE username = ?', 
            [managerUsername]
        );
        
        if (existingUsers.length > 0) {
            throw new Error(`Tên đăng nhập '${managerUsername}' đã được sử dụng. Vui lòng chọn tên khác!`);
        }

        await connection.beginTransaction();

        const timestamp = Date.now();
        const randomHex = Math.random().toString(16).substring(2, 6);
        const newDbName = `db_spa_${timestamp}_${randomHex}`;

        let expireDate = null; 
        if (years !== 'lifetime') {
            const subscriptionYears = parseInt(years) || 1; 
            expireDate = new Date();
            expireDate.setFullYear(expireDate.getFullYear() + subscriptionYears);
        }

        // 3. Insert Tenant (Ghi nhận creatorName)
        const [tenantResult] = await connection.query(
            'INSERT INTO tenants (spa_name, database_name, expire_at, created_by) VALUES (?, ?, ?, ?)',
            [spaName, newDbName, expireDate, creatorName]
        );
        const newTenantId = tenantResult.insertId;

        // 4. Insert Tài khoản Quản lý (Có thêm cột fullname và created_by)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(managerPassword, salt);
        await connection.query(
            'INSERT INTO users (tenant_id, username, password, fullname, system_role, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [newTenantId, managerUsername, hashedPassword, managerFullname, 'MANAGER', creatorName]
        );

        // 5. Tạo DB Vật lý
        await connection.query(`CREATE DATABASE \`${newDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

        // 6. Nhân bản Bảng
        const [tables] = await connection.query('SHOW TABLES FROM db_spa_template');
        const tableKey = 'Tables_in_db_spa_template';
        
        for (let row of tables) {
            const tableName = row[tableKey];
            await connection.query(`CREATE TABLE \`${newDbName}\`.\`${tableName}\` LIKE \`db_spa_template\`.\`${tableName}\``);
        }

        await connection.commit();
        
        return {
            tenantId: newTenantId,
            spaName: spaName,
            managerUsername: managerUsername, 
            managerFullname: managerFullname,
            database: newDbName, 
            expireDate: expireDate ? expireDate.toISOString() : 'Vĩnh viễn (Lifetime)'
        };

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getAllTenants = async (searchKeyword = '') => {
    let query = `
        SELECT 
            t.id AS tenant_id,
            t.spa_name,
            t.database_name,
            t.expire_at,
            t.created_at,
            u.username AS manager_username,
            u.fullname AS manager_fullname
        FROM tenants t
        LEFT JOIN users u ON t.id = u.tenant_id
        WHERE t.deleted_at IS NULL 
          AND (u.deleted_at IS NULL OR u.id IS NULL)
    `;
    
    const queryParams = [];

    if (searchKeyword) {
        query += ` AND (t.spa_name LIKE ? OR u.username LIKE ? OR u.fullname LIKE ?)`;
        const likeKeyword = `%${searchKeyword}%`;
        queryParams.push(likeKeyword, likeKeyword, likeKeyword);
    }

    query += ` ORDER BY t.created_at DESC`;

    const [rows] = await masterPool.query(query, queryParams);
    return rows;
};

const updateTenant = async (tenantId, spaName, expireAt, executorName) => {
    const [rows] = await masterPool.query(
        'SELECT spa_name, expire_at FROM tenants WHERE id = ? AND deleted_at IS NULL',
        [tenantId]
    );

    if (rows.length === 0) {
        throw new Error('Không tìm thấy Spa hoặc Spa đã bị xóa.');
    }

    const currentTenant = rows[0];
    const finalSpaName = spaName !== undefined ? spaName : currentTenant.spa_name;
    const finalExpireAt = expireAt !== undefined ? expireAt : currentTenant.expire_at;

    // Cập nhật dữ liệu mới kèm theo updated_by
    await masterPool.query(
        'UPDATE tenants SET spa_name = ?, expire_at = ?, updated_by = ? WHERE id = ?',
        [finalSpaName, finalExpireAt, executorName, tenantId]
    );

    return { id: tenantId, spa_name: finalSpaName, expire_at: finalExpireAt };
};

const deleteTenant = async (tenantId, executorName) => {
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
            'SELECT id FROM tenants WHERE id = ? AND deleted_at IS NULL',
            [tenantId]
        );

        if (rows.length === 0) {
            throw new Error('Không tìm thấy Spa hoặc Spa đã bị xóa từ trước.');
        }

        const now = new Date(); 

        // Đánh dấu xóa mềm (deleted_at) và ghi nhận người xóa (deleted_by)
        await connection.query(
            'UPDATE tenants SET deleted_at = ?, deleted_by = ? WHERE id = ?',
            [now, executorName, tenantId]
        );

        await connection.query(
            'UPDATE users SET deleted_at = ?, deleted_by = ? WHERE tenant_id = ?',
            [now, executorName, tenantId]
        );

        await connection.commit();
        return { id: tenantId, deleted_at: now };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const restoreTenant = async (tenantId, executorName) => {
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
            'SELECT id FROM tenants WHERE id = ? AND deleted_at IS NOT NULL',
            [tenantId]
        );

        if (rows.length === 0) {
            throw new Error('Không tìm thấy Spa hoặc Spa chưa bị xóa, không thể khôi phục.');
        }

        // Gỡ bỏ trạng thái xóa (NULL), đồng thời cập nhật người thực hiện thao tác khôi phục
        await connection.query(
            'UPDATE tenants SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?',
            [executorName, tenantId]
        );

        await connection.query(
            'UPDATE users SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE tenant_id = ?',
            [executorName, tenantId]
        );

        await connection.commit();
        return { id: tenantId, message: 'Khôi phục thành công' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {
    createNewSpa,
    getAllTenants, 
    updateTenant,
    deleteTenant,
    restoreTenant
};