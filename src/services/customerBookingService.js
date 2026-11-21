const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');
const booking = require('../utils/customerBooking');

// Same tenant, all branches. Activity must be recorded on/after the scheduled arrival day.
const arrivedSql = db => `EXISTS (
    SELECT 1 FROM \`${db}\`.customers ac
    WHERE ((cb.customer_id IS NOT NULL AND ac.id=cb.customer_id)
        OR (cb.customer_type='NEW' AND cb.customer_id IS NULL
            AND ac.phone_number=cb.customer_phone AND BINARY ac.phone_number=BINARY cb.customer_phone))
    AND (
        EXISTS (SELECT 1 FROM \`${db}\`.invoices ai WHERE ai.customer_id=ac.id AND ai.deleted_at IS NULL
            AND ai.created_at >= cb.arrival_date AND ai.created_at <= NOW())
        OR EXISTS (SELECT 1 FROM \`${db}\`.treatments atc WHERE atc.customer_id=ac.id AND atc.deleted_at IS NULL
            AND atc.created_at >= cb.arrival_date AND atc.created_at <= NOW())
    )
) AS has_arrived`;
const withArrival = row => ({ ...row, has_arrived: Number(row.has_arrived) === 1 });

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = booking.id(value, fieldName);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const createNewBookingCustomer = async (connection, db, data, actor) => {
    const [existing] = await connection.query(
        `SELECT id FROM \`${db}\`.customers WHERE phone_number=? AND deleted_at IS NULL FOR UPDATE`,
        [data.customer_phone]
    );
    if (existing.length) throw booking.fail(`Khách hàng với số điện thoại '${data.customer_phone}' đã tồn tại trong hệ thống!`);
    try {
        await connection.query(
            `INSERT INTO \`${db}\`.customers (fullname,phone_number,created_by) VALUES (?,?,?)`,
            [data.customer_name, data.customer_phone, actor]
        );
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw booking.fail(`Khách hàng với số điện thoại '${data.customer_phone}' đã tồn tại trong hệ thống!`);
        throw error;
    }
};

const updateNewBookingCustomer = async (connection, db, old, data, actor) => {
    const [customers] = await connection.query(
        `SELECT id FROM \`${db}\`.customers WHERE phone_number=? AND deleted_at IS NULL FOR UPDATE`,
        [old.customer_phone]
    );
    // Older NEW bookings may predate automatic customer creation. Preserve their booking
    // update behavior, but never create a second customer during PUT.
    if (!customers.length) return;
    if (customers.length !== 1) {
        throw Object.assign(new Error('Không xác định được duy nhất hồ sơ khách hàng đã tạo từ booking NEW.'), { status: 409 });
    }
    const customerId = customers[0].id;
    if (data.customer_phone !== old.customer_phone) {
        const [duplicate] = await connection.query(
            `SELECT id FROM \`${db}\`.customers WHERE phone_number=? AND deleted_at IS NULL FOR UPDATE`,
            [data.customer_phone]
        );
        if (duplicate.some(customer => Number(customer.id) !== Number(customerId))) {
            throw booking.fail(`Khách hàng với số điện thoại '${data.customer_phone}' đã tồn tại trong hệ thống!`);
        }
    }
    try {
        await connection.query(
            `UPDATE \`${db}\`.customers SET fullname=?,phone_number=?,updated_by=? WHERE id=? AND deleted_at IS NULL`,
            [data.customer_name, data.customer_phone, actor, customerId]
        );
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw booking.fail(`Khách hàng với số điện thoại '${data.customer_phone}' đã tồn tại trong hệ thống!`);
        throw error;
    }
};

const getCustomerBookings = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT cb.*, b.name AS branch_name, p.name AS product_name,
               c.fullname AS registered_customer_name, c.phone_number AS registered_customer_phone,
               ${arrivedSql(dbName)}
        FROM \`${dbName}\`.customer_bookings cb
        INNER JOIN \`${dbName}\`.branches b ON cb.branch_id = b.id
        LEFT JOIN \`${dbName}\`.products p ON cb.product_id = p.id
        LEFT JOIN \`${dbName}\`.customers c ON cb.customer_id = c.id
        WHERE cb.deleted_at IS NULL
    `;
    const params = [];

    if (filters.branchId !== undefined && filters.branchId !== '') {
        query += ' AND cb.branch_id = ?';
        params.push(toNumber(filters.branchId, 'branchId', { min: 1, integer: true }));
    }

    if (filters.customerId !== undefined && filters.customerId !== '') {
        query += ' AND cb.customer_id = ?';
        params.push(toNumber(filters.customerId, 'customerId', { min: 1, integer: true }));
    }
    if (filters.productId !== undefined && filters.productId !== '') {
        query += ' AND cb.product_id = ?';
        params.push(toNumber(filters.productId, 'productId', { min: 1, integer: true }));
    }
    if (filters.status) {
        query += ' AND cb.status = ?';
        params.push(String(filters.status).trim());
    }
    if (filters.search) {
        query += ' AND (cb.customer_name LIKE ? OR cb.customer_phone LIKE ? OR cb.note LIKE ? OR p.name LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.startDate) {
        query += ' AND cb.arrival_date >= ?';
        params.push(booking.date(filters.startDate));
    }
    if (filters.endDate) {
        query += ' AND cb.arrival_date <= ?';
        params.push(booking.date(filters.endDate));
    }

    const startTime = filters.startTime === undefined ? null : booking.time(filters.startTime, 'startTime');
    const endTime = filters.endTime === undefined ? null : booking.time(filters.endTime, 'endTime');
    if (startTime && endTime && startTime > endTime) throw booking.fail('startTime không được lớn hơn endTime; không hỗ trợ khoảng qua đêm.');
    const timeConditions = [];
    if (startTime) { timeConditions.push('cb.arrival_time >= ?'); params.push(startTime); }
    if (endTime) { timeConditions.push('cb.arrival_time <= ?'); params.push(endTime); }
    if (timeConditions.length) {
        query += ` AND (cb.arrival_time IS NULL OR (${timeConditions.join(' AND ')}))`;
    }
    const orderBy = `${timeConditions.length ? '(cb.arrival_time IS NULL) ASC, ' : ''}cb.arrival_date ASC, cb.arrival_time ASC, cb.created_at ASC, cb.id ASC`;
    const result = await paginateQuery(masterPool, query, params, orderBy, filters);
    result.data = result.data.map(withArrival);
    return result;
};

const getCustomerBookingDetail = async (tenantId, bookingId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const id = toNumber(bookingId, 'bookingId', { min: 1, integer: true });
    let query = `SELECT cb.*, b.name AS branch_name, p.name AS product_name,
                       c.fullname AS registered_customer_name, c.phone_number AS registered_customer_phone,
                       ${arrivedSql(dbName)}
        FROM \`${dbName}\`.customer_bookings cb
        INNER JOIN \`${dbName}\`.branches b ON cb.branch_id = b.id
        LEFT JOIN \`${dbName}\`.products p ON cb.product_id = p.id
        LEFT JOIN \`${dbName}\`.customers c ON cb.customer_id = c.id
        WHERE cb.id = ? AND cb.deleted_at IS NULL`;
    const params = [id];
    const [bookings] = await masterPool.query(query, params);
    if (bookings.length === 0) throw new Error('Booking không tồn tại, đã bị xóa hoặc bạn không có quyền xem.');
    return withArrival(bookings[0]);
};

const writeBooking = async (tenantId, bookingId, body, actor, role, branchId, remove = false) => {
    const db = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        let old = null;
        if (bookingId !== null) {
            const [rows] = await connection.query(`SELECT *,DATE_FORMAT(arrival_date,'%Y-%m-%d') AS arrival_date FROM \`${db}\`.customer_bookings WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [booking.id(bookingId, 'bookingId')]);
            old = rows[0];
            if (!old || (role === 'STAFF' && Number(old.branch_id) !== Number(branchId))) throw Object.assign(new Error('Booking không tồn tại hoặc bạn không có quyền thao tác.'), { status: 404 });
        }
        if (remove) {
            await connection.query(`UPDATE \`${db}\`.customer_bookings SET deleted_at=NOW(),deleted_by=?,updated_by=? WHERE id=?`, [actor, actor, old.id]);
        } else {
            const data = booking.normalize(role === 'STAFF' && !old && body && !Object.hasOwn(body, 'branch_id') ? { ...body, branch_id: branchId } : body, old);
            if (role === 'STAFF' && data.branch_id !== Number(branchId)) throw Object.assign(new Error('Nhân viên chỉ được thao tác booking tại cơ sở trong token.'), { status: 403 });
            if (data.customer_type === 'NEW') data.customer_id = null;
            if (data.customer_type === 'NEW' && body && Object.hasOwn(body, 'customer_id') && (
                (!old && body.customer_id != null)
                || (old && old.customer_type === 'NEW' && body.customer_id != null)
                || (old && old.customer_type !== 'NEW' && body.customer_id != null)
            )) {
                throw booking.fail('Khách NEW không được tự đặt customer_id.');
            }
            const [branches] = await connection.query(`SELECT id FROM \`${db}\`.branches WHERE id=? AND deleted_at IS NULL FOR SHARE`, [data.branch_id]);
            if (!branches.length) throw booking.fail('Cơ sở không tồn tại hoặc đã xóa.');
            if (!old && data.customer_type === 'NEW') await createNewBookingCustomer(connection, db, data, actor);
            if (old && old.customer_type === 'NEW' && data.customer_type === 'NEW') {
                await updateNewBookingCustomer(connection, db, old, data, actor);
            }
            if (data.customer_id !== null) {
                const [customers] = await connection.query(`SELECT fullname,phone_number FROM \`${db}\`.customers WHERE id=? AND deleted_at IS NULL FOR SHARE`, [data.customer_id]);
                if (!customers.length) throw booking.fail('Khách hàng không tồn tại hoặc đã xóa.');
                // Refresh snapshots when selecting a registered customer; otherwise preserve the booking snapshot.
                if (!old || old.customer_id !== data.customer_id || old.customer_type !== data.customer_type) {
                    if (body.customer_name === undefined) data.customer_name = customers[0].fullname;
                    if (body.customer_phone === undefined) data.customer_phone = customers[0].phone_number;
                }
                if (!data.customer_name) data.customer_name = customers[0].fullname;
            }
            if (data.product_id !== null) {
                const [products] = await connection.query(`SELECT id FROM \`${db}\`.products WHERE id=? AND deleted_at IS NULL FOR SHARE`, [data.product_id]);
                if (!products.length) throw booking.fail('Sản phẩm/dịch vụ không tồn tại hoặc đã xóa.');
            }
            const fields = [...booking.fields, 'booking_time'];
            if (old) {
                await connection.query(`UPDATE \`${db}\`.customer_bookings SET ${fields.map(f => `${f}=?`).join(',')},updated_by=? WHERE id=?`, [...fields.map(f => data[f]), actor, old.id]);
            } else {
                const [insert] = await connection.query(`INSERT INTO \`${db}\`.customer_bookings (${fields.join(',')},created_by) VALUES (${fields.map(() => '?').join(',')},?)`, [...fields.map(f => data[f]), actor]);
                bookingId = insert.insertId;
            }
        }
        await connection.commit();
        return { bookingId: Number(bookingId) };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
};
module.exports = { getCustomerBookings, getCustomerBookingDetail, writeBooking };