const { masterPool } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');
const bcrypt = require('bcryptjs');

const badRequest = message => {
    const error = new Error(message);
    error.status = 400;
    return error;
};

const tenantId = value => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) throw badRequest('tenantId không hợp lệ.');
    return id;
};

const text = (value, field, max) => {
    if (typeof value !== 'string') throw badRequest(`${field} phải là chuỗi ký tự.`);
    const result = value.trim();
    if (!result) throw badRequest(`${field} không được để trống.`);
    if (result.length > max) throw badRequest(`${field} không được vượt quá ${max} ký tự.`);
    return result;
};

const subscription = value => {
    if (value === undefined || value === null || value === '' || value === 'lifetime') return { years: null, expireAt: null };
    if (!/^[1-9]\d*$/.test(String(value)) || Number(value) > 100) throw badRequest('years phải là "lifetime" hoặc số nguyên từ 1 đến 100.');
    return { years: Number(value), expireAt: null };
};

const dateTime = value => {
    if (value === null) return null;
    if (typeof value !== 'string' || !value.trim()) throw badRequest('expireAt phải là date-time hợp lệ hoặc null.');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw badRequest('expireAt phải là date-time hợp lệ hoặc null.');
    return parsed;
};

const statusSql = `CASE
    WHEN t.deleted_at IS NOT NULL THEN 'DISABLED'
    WHEN t.expire_at IS NOT NULL AND t.expire_at <= NOW() THEN 'EXPIRED'
    ELSE 'ACTIVE'
END`;

const selectTenant = `t.id AS tenant_id, t.spa_name, t.database_name, t.expire_at,
    t.created_at, t.updated_at, t.deleted_at, t.created_by, t.updated_by, t.deleted_by,
    u.id AS manager_user_id, u.username AS manager_username, u.fullname AS manager_fullname,
    ${statusSql} AS status`;

const createNewSpa = async (spaName, managerUsername, managerPassword, managerFullname, years, creatorName) => {
    spaName = text(spaName, 'spaName', 100);
    managerUsername = text(managerUsername, 'managerUsername', 100);
    managerFullname = text(managerFullname, 'managerFullname', 255);
    managerPassword = text(managerPassword, 'managerPassword', 255);
    if (managerPassword.length < 6) throw badRequest('managerPassword phải có ít nhất 6 ký tự.');
    const plan = subscription(years);
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
        if (plan.years) {
            expireDate = new Date();
            expireDate.setFullYear(expireDate.getFullYear() + plan.years);
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

const getAllTenants = async (searchKeyword = '', filters = {}) => {
    const search = typeof searchKeyword === 'string' ? searchKeyword.trim() : '';
    if (search.length > 100) throw badRequest('search không được vượt quá 100 ký tự.');
    const status = String(filters.status || 'all').toLowerCase();
    if (!['all', 'active', 'expired', 'disabled'].includes(status)) throw badRequest('status chỉ nhận all, active, expired hoặc disabled.');
    let query = `
        SELECT ${selectTenant}
        FROM tenants t
        LEFT JOIN users u ON u.id = (SELECT manager.id FROM users manager WHERE manager.tenant_id = t.id AND manager.system_role = 'MANAGER' AND manager.deleted_at IS NULL ORDER BY manager.created_at ASC, manager.id ASC LIMIT 1)
        WHERE 1 = 1
    `;
    
    const queryParams = [];

    if (search) {
        query += ` AND (t.spa_name LIKE ? OR u.username LIKE ? OR u.fullname LIKE ?)`;
        const likeKeyword = `%${search}%`;
        queryParams.push(likeKeyword, likeKeyword, likeKeyword);
    }

    if (status === 'active') query += ' AND t.deleted_at IS NULL AND (t.expire_at IS NULL OR t.expire_at > NOW())';
    if (status === 'expired') query += ' AND t.deleted_at IS NULL AND t.expire_at IS NOT NULL AND t.expire_at <= NOW()';
    if (status === 'disabled') query += ' AND t.deleted_at IS NOT NULL';

    return paginateQuery(masterPool, query, queryParams, 't.created_at DESC, t.id DESC', filters);
};

const getTenantDetail = async (tenantId) => {
    tenantId = tenantId && typeof tenantId === 'object' ? tenantId.id : tenantId;
    tenantId = Number(tenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw badRequest('tenantId không hợp lệ.');
    const [tenants] = await masterPool.query(
        `SELECT ${selectTenant}
         FROM tenants t
         LEFT JOIN users u ON u.id = (SELECT manager.id FROM users manager WHERE manager.tenant_id = t.id AND manager.system_role = 'MANAGER' AND manager.deleted_at IS NULL ORDER BY manager.created_at ASC, manager.id ASC LIMIT 1)
         WHERE t.id = ?`,
        [tenantId]
    );
    if (tenants.length === 0) {
        const error = new Error('Không tìm thấy Spa.');
        error.status = 404;
        throw error;
    }
    return tenants[0];
};

const updateTenant = async (tenantId, spaName, expireAt, executorName) => {
    tenantId = tenantId && typeof tenantId === 'object' ? tenantId.id : tenantId;
    tenantId = Number(tenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw badRequest('tenantId không hợp lệ.');
    if (spaName === undefined && expireAt === undefined) throw badRequest('Cần gửi ít nhất spaName hoặc expireAt.');
    if (spaName !== undefined) spaName = text(spaName, 'spaName', 100);
    if (expireAt !== undefined) expireAt = dateTime(expireAt);
    const [rows] = await masterPool.query(
        'SELECT spa_name, expire_at FROM tenants WHERE id = ?',
        [tenantId]
    );

    if (rows.length === 0) {
        const error = new Error('Không tìm thấy Spa.');
        error.status = 404;
        throw error;
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
    tenantId = Number(tenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw badRequest('tenantId không hợp lệ.');
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
    tenantId = Number(tenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw badRequest('tenantId không hợp lệ.');
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

const getManagers = async id => {
    const idValue = tenantId(id);
    await getTenantDetail(idValue);
    const [rows] = await masterPool.query(
        `SELECT id, tenant_id, username, fullname, system_role, created_at, updated_at, deleted_at
         FROM users WHERE tenant_id = ? AND system_role = 'MANAGER' ORDER BY created_at ASC, id ASC`,
        [idValue]
    );
    return rows;
};

const resetManagerPassword = async (id, userId, newPassword, executorName) => {
    const idValue = tenantId(id);
    const managerId = tenantId(userId);
    const password = text(newPassword, 'newPassword', 255);
    if (password.length < 6) throw badRequest('newPassword phải có ít nhất 6 ký tự.');
    const [tenants] = await masterPool.query('SELECT id FROM tenants WHERE id = ? AND deleted_at IS NULL', [idValue]);
    if (!tenants.length) {
        const error = new Error('Không tìm thấy Spa đang hoạt động.');
        error.status = 404;
        throw error;
    }
    const hash = await bcrypt.hash(password, 10);
    const [result] = await masterPool.query(
        `UPDATE users SET password = ?, updated_by = ? WHERE id = ? AND tenant_id = ? AND system_role = 'MANAGER' AND deleted_at IS NULL`,
        [hash, executorName, managerId, idValue]
    );
    if (!result.affectedRows) {
        const error = new Error('Không tìm thấy tài khoản MANAGER đang hoạt động của Spa này.');
        error.status = 404;
        throw error;
    }
};

const renewTenant = async (id, years, executorName) => {
    const idValue = tenantId(id);
    if (!/^[1-9]\d*$/.test(String(years)) || Number(years) > 100) {
        throw badRequest('years phải là số nguyên từ 1 đến 100.');
    }
    // The DB clock is also used for the status filter; lock to prevent concurrent renewals losing time.
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT expire_at FROM tenants WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [idValue]);
        if (!rows.length) {
            const error = new Error('Không tìm thấy Spa đang hoạt động.');
            error.status = 404;
            throw error;
        }
        if (rows[0].expire_at === null) throw badRequest('Spa không thời hạn; hãy đặt expireAt trước khi gia hạn.');
        await connection.query(
            'UPDATE tenants SET expire_at = DATE_ADD(GREATEST(expire_at, NOW()), INTERVAL ? YEAR), updated_by = ? WHERE id = ?',
            [Number(years), executorName, idValue]
        );
        const [[updated]] = await connection.query('SELECT expire_at FROM tenants WHERE id = ?', [idValue]);
        await connection.commit();
        return { id: idValue, expire_at: updated.expire_at };
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
    getTenantDetail,
    updateTenant,
    deleteTenant,
    restoreTenant,
    getManagers,
    resetManagerPassword,
    renewTenant
};