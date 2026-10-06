const { masterPool, getTenantDbName } = require('../config/database');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const toAppointmentDate = (value) => {
    if (!value || Number.isNaN(new Date(value).getTime())) {
        throw new Error('appointment_date không hợp lệ.');
    }
    return value;
};

const toStatus = (value) => {
    const status = String(value || '').trim();
    if (!status) throw new Error('status không được để trống.');
    if (status.length > 50) throw new Error('status không được vượt quá 50 ký tự.');
    return status;
};

const ensureCustomerExists = async (connection, dbName, customerId) => {
    const [customers] = await connection.query(
        `SELECT id FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL`,
        [customerId]
    );
    if (customers.length === 0) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');
};

const ensureBranchExists = async (connection, dbName, branchId) => {
    const [branches] = await connection.query(
        `SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`,
        [branchId]
    );
    if (branches.length === 0) throw new Error('Chi nhánh không tồn tại hoặc đã bị xóa.');
};

const createAppointment = async (tenantId, appointmentData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        let { customer_id, branch_id, appointment_date, note, status = 'Chờ xử lý' } = appointmentData;
        const normalizedRole = String(userRole).toUpperCase();

        if (normalizedRole === 'STAFF') {
            branch_id = userBranchId;
        } else if (branch_id === undefined || branch_id === null || branch_id === '') {
            throw new Error('Quản lý bắt buộc phải truyền branch_id để chọn cơ sở đặt lịch.');
        }

        const customerId = toNumber(customer_id, 'customer_id', { min: 1, integer: true });
        const branchId = toNumber(branch_id, 'branch_id', { min: 1, integer: true });
        const appointmentDate = toAppointmentDate(appointment_date);
        const appointmentStatus = toStatus(status);

        await connection.beginTransaction();
        await ensureCustomerExists(connection, dbName, customerId);
        await ensureBranchExists(connection, dbName, branchId);

        const [result] = await connection.query(
            `INSERT INTO \`${dbName}\`.appointments
                (customer_id, branch_id, appointment_date, note, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [customerId, branchId, appointmentDate, note === undefined || note === '' ? null : note, appointmentStatus, executorName]
        );

        await connection.commit();
        return { appointmentId: result.insertId };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getAppointments = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const normalizedRole = String(userRole).toUpperCase();
    let query = `
        SELECT a.*, c.fullname AS customer_name, c.phone_number, b.name AS branch_name
        FROM \`${dbName}\`.appointments a
        INNER JOIN \`${dbName}\`.customers c ON a.customer_id = c.id
        INNER JOIN \`${dbName}\`.branches b ON a.branch_id = b.id
        WHERE a.deleted_at IS NULL
    `;
    const params = [];

    if (normalizedRole === 'STAFF') {
        query += ' AND a.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    } else if (filters.branchId !== undefined && filters.branchId !== '') {
        query += ' AND a.branch_id = ?';
        params.push(toNumber(filters.branchId, 'branchId', { min: 1, integer: true }));
    }

    if (filters.search) {
        query += ' AND (c.fullname LIKE ? OR c.phone_number LIKE ? OR a.note LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.status) {
        query += ' AND a.status = ?';
        params.push(String(filters.status).trim());
    }
    if (filters.startDate) {
        query += ' AND DATE(a.appointment_date) >= ?';
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        query += ' AND DATE(a.appointment_date) <= ?';
        params.push(filters.endDate);
    }

    query += ' ORDER BY a.appointment_date ASC, a.created_at ASC';
    const [rows] = await masterPool.query(query, params);
    return rows;
};

const getAppointmentDetail = async (tenantId, appointmentId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const normalizedRole = String(userRole).toUpperCase();
    let query = `
        SELECT a.*, c.fullname AS customer_name, c.phone_number, b.name AS branch_name
        FROM \`${dbName}\`.appointments a
        INNER JOIN \`${dbName}\`.customers c ON a.customer_id = c.id
        INNER JOIN \`${dbName}\`.branches b ON a.branch_id = b.id
        WHERE a.id = ? AND a.deleted_at IS NULL
    `;
    const params = [toNumber(appointmentId, 'appointmentId', { min: 1, integer: true })];

    if (normalizedRole === 'STAFF') {
        query += ' AND a.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    }

    const [rows] = await masterPool.query(query, params);
    if (rows.length === 0) throw new Error('Lịch hẹn không tồn tại, đã bị xóa hoặc bạn không có quyền xem.');
    return rows[0];
};

const updateAppointment = async (tenantId, appointmentId, updateData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        const normalizedRole = String(userRole).toUpperCase();
        const id = toNumber(appointmentId, 'appointmentId', { min: 1, integer: true });
        await connection.beginTransaction();

        const [existingRows] = await connection.query(
            `SELECT branch_id FROM \`${dbName}\`.appointments WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
            [id]
        );
        if (existingRows.length === 0) throw new Error('Lịch hẹn không tồn tại hoặc đã bị xóa.');
        if (normalizedRole === 'STAFF' && Number(existingRows[0].branch_id) !== Number(userBranchId)) {
            throw new Error('Bạn không có quyền sửa lịch hẹn của cơ sở khác.');
        }

        const updateFields = [];
        const updateParams = [];

        if (updateData.customer_id !== undefined) {
            const customerId = toNumber(updateData.customer_id, 'customer_id', { min: 1, integer: true });
            await ensureCustomerExists(connection, dbName, customerId);
            updateFields.push('customer_id = ?');
            updateParams.push(customerId);
        }
        if (updateData.branch_id !== undefined && normalizedRole === 'MANAGER') {
            const branchId = toNumber(updateData.branch_id, 'branch_id', { min: 1, integer: true });
            await ensureBranchExists(connection, dbName, branchId);
            updateFields.push('branch_id = ?');
            updateParams.push(branchId);
        }
        if (updateData.appointment_date !== undefined) {
            updateFields.push('appointment_date = ?');
            updateParams.push(toAppointmentDate(updateData.appointment_date));
        }
        if (updateData.note !== undefined) {
            updateFields.push('note = ?');
            updateParams.push(updateData.note === '' ? null : updateData.note);
        }
        if (updateData.status !== undefined) {
            updateFields.push('status = ?');
            updateParams.push(toStatus(updateData.status));
        }

        if (updateFields.length === 0) {
            await connection.rollback();
            return { message: 'Không có dữ liệu nào được cập nhật.' };
        }

        updateFields.push('updated_by = ?');
        updateParams.push(executorName, id);
        await connection.query(
            `UPDATE \`${dbName}\`.appointments SET ${updateFields.join(', ')} WHERE id = ?`,
            updateParams
        );

        await connection.commit();
        return { message: 'Cập nhật lịch hẹn thành công' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const deleteAppointment = async (tenantId, appointmentId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const id = toNumber(appointmentId, 'appointmentId', { min: 1, integer: true });
    const [existingRows] = await masterPool.query(
        `SELECT branch_id FROM \`${dbName}\`.appointments WHERE id = ? AND deleted_at IS NULL`,
        [id]
    );
    if (existingRows.length === 0) throw new Error('Lịch hẹn không tồn tại hoặc đã bị xóa.');
    if (String(userRole).toUpperCase() === 'STAFF' && Number(existingRows[0].branch_id) !== Number(userBranchId)) {
        throw new Error('Bạn không có quyền xóa lịch hẹn của cơ sở khác.');
    }

    await masterPool.query(
        `UPDATE \`${dbName}\`.appointments SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`,
        [executorName, id]
    );
    return { message: 'Xóa lịch hẹn thành công' };
};

module.exports = { createAppointment, getAppointments, getAppointmentDetail, updateAppointment, deleteAppointment };