const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');
const { assertExtraNoteNotProvided } = require('../utils/appointmentContactNote');
const { attachContactNotes, mutateContactNote } = require('./appointmentContactNoteService');

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

const NOT_ARRIVED = 'Khách chưa đến';
const ARRIVED = 'Khách đã đến';

const assertStatusNotProvided = (data) => {
    if (Object.prototype.hasOwnProperty.call(data, 'status')) {
        throw new Error('status được hệ thống tự tính, không được nhập thủ công.');
    }
};

// Dùng thời điểm ghi nhận để tránh invoice_date/execution_date nhập lùi ngày làm sai lần hẹn.
// Một phát sinh sau khi đã có lịch hẹn tiếp theo cùng khách/cơ sở không tính cho lịch cũ.
const visitStatusSql = (dbName) => {
    const eventExists = (table, customerSql, branchSql) => `EXISTS (
        SELECT 1 FROM \`${dbName}\`.${table} event
        ${table === 'treatment_history' ? `INNER JOIN \`${dbName}\`.treatments t ON t.id = event.treatment_id AND t.deleted_at IS NULL` : ''}
        WHERE ${customerSql} = a.customer_id AND ${branchSql} = a.branch_id
          AND event.deleted_at IS NULL AND event.created_at >= DATE(a.appointment_date)
          AND event.created_at >= a.created_at
          AND event.created_at <= NOW()
          AND NOT EXISTS (
              SELECT 1 FROM \`${dbName}\`.appointments next_a
              WHERE next_a.customer_id = a.customer_id AND next_a.branch_id = a.branch_id
                AND next_a.deleted_at IS NULL AND next_a.appointment_date > a.appointment_date
                AND next_a.appointment_date <= event.created_at
          )
    )`;
    return `CASE WHEN ${eventExists('invoices', 'event.customer_id', 'event.branch_id')}
        OR ${eventExists('treatment_history', 't.customer_id', 'event.branch_id')}
        THEN '${ARRIVED}' ELSE '${NOT_ARRIVED}' END`;
};

const withCalculatedStatus = (row) => {
    const { calculated_status, ...appointment } = row;
    return { ...appointment, status: calculated_status };
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
    assertExtraNoteNotProvided(appointmentData);
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        assertStatusNotProvided(appointmentData);
        let { customer_id, branch_id, appointment_date, note } = appointmentData;
        const normalizedRole = String(userRole).toUpperCase();

        if (normalizedRole === 'STAFF') {
            branch_id = userBranchId;
        } else if (branch_id === undefined || branch_id === null || branch_id === '') {
            throw new Error('Quản lý bắt buộc phải truyền branch_id để chọn cơ sở đặt lịch.');
        }

        const customerId = toNumber(customer_id, 'customer_id', { min: 1, integer: true });
        const branchId = toNumber(branch_id, 'branch_id', { min: 1, integer: true });
        const appointmentDate = toAppointmentDate(appointment_date);

        await connection.beginTransaction();
        await ensureCustomerExists(connection, dbName, customerId);
        await ensureBranchExists(connection, dbName, branchId);

        const [result] = await connection.query(
            `INSERT INTO \`${dbName}\`.appointments
                (customer_id, branch_id, appointment_date, note, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [customerId, branchId, appointmentDate, note === undefined || note === '' ? null : note, NOT_ARRIVED, executorName]
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

const getAppointments = async (tenantId, filters, userRole, userBranchId, view) => {
    const dbName = await getTenantDbName(tenantId);
    const normalizedRole = String(userRole).toUpperCase();
    const statusSql = visitStatusSql(dbName);
    let query = `
        SELECT a.*, c.fullname AS customer_name, c.phone_number, b.name AS branch_name,
               ${statusSql} AS calculated_status
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
    if (view === 'tomorrow') {
        query += ' AND a.appointment_date >= CURDATE() + INTERVAL 1 DAY AND a.appointment_date < CURDATE() + INTERVAL 2 DAY';
    } else if (view === 'not-arrived') {
        query += ` AND a.appointment_date < CURDATE() + INTERVAL 1 DAY AND (${statusSql}) = ?`;
        params.push(NOT_ARRIVED);
    }
    if (filters.status) {
        const status = String(filters.status).trim();
        if (status !== NOT_ARRIVED && status !== ARRIVED) throw new Error('status không hợp lệ.');
        query += ` AND (${statusSql}) = ?`;
        params.push(status);
    }
    if (filters.startDate) {
        query += ' AND DATE(a.appointment_date) >= ?';
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        query += ' AND DATE(a.appointment_date) <= ?';
        params.push(filters.endDate);
    }

    const result = await paginateQuery(masterPool, query, params, 'a.appointment_date ASC, a.created_at ASC, a.id ASC', filters);
    result.data = await attachContactNotes(dbName, result.data.map(withCalculatedStatus));
    return result;
};

const getAppointmentDetail = async (tenantId, appointmentId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const normalizedRole = String(userRole).toUpperCase();
    let query = `
        SELECT a.*, c.fullname AS customer_name, c.phone_number, b.name AS branch_name,
               ${visitStatusSql(dbName)} AS calculated_status
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
    return (await attachContactNotes(dbName, [withCalculatedStatus(rows[0])]))[0];
};

const updateAppointment = async (tenantId, appointmentId, updateData, executorName, userRole, userBranchId) => {
    assertExtraNoteNotProvided(updateData);
    assertStatusNotProvided(updateData);
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

const addContactNote = async (tenantId, appointmentId, data, executorName, userRole, userBranchId) => {
    return mutateContactNote('create', tenantId, appointmentId, null, data, executorName, userRole, userBranchId);
};

const updateContactNote = (tenantId, appointmentId, noteId, data, executorName, userRole, userBranchId) =>
    mutateContactNote('update', tenantId, appointmentId, noteId, data, executorName, userRole, userBranchId);
const deleteContactNote = (tenantId, appointmentId, noteId, executorName, userRole, userBranchId) =>
    mutateContactNote('delete', tenantId, appointmentId, noteId, null, executorName, userRole, userBranchId);

module.exports = { createAppointment, getAppointments, getAppointmentDetail, updateAppointment, deleteAppointment, addContactNote, updateContactNote, deleteContactNote };