const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const getCustomerBookings = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const normalizedRole = String(userRole).toUpperCase();
    let query = `
        SELECT cb.*, b.name AS branch_name, p.name AS product_name,
               c.fullname AS registered_customer_name, c.phone_number AS registered_customer_phone
        FROM \`${dbName}\`.customer_bookings cb
        INNER JOIN \`${dbName}\`.branches b ON cb.branch_id = b.id
        LEFT JOIN \`${dbName}\`.products p ON cb.product_id = p.id
        LEFT JOIN \`${dbName}\`.customers c ON cb.customer_id = c.id
        WHERE cb.deleted_at IS NULL
    `;
    const params = [];

    if (normalizedRole === 'STAFF') {
        query += ' AND cb.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    } else if (filters.branchId !== undefined && filters.branchId !== '') {
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
        query += ' AND DATE(cb.booking_time) >= ?';
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        query += ' AND DATE(cb.booking_time) <= ?';
        params.push(filters.endDate);
    }

    return paginateQuery(masterPool, query, params, 'cb.booking_time ASC, cb.created_at ASC, cb.id ASC', filters);
};

const getCustomerBookingDetail = async (tenantId, bookingId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const id = toNumber(bookingId, 'bookingId', { min: 1, integer: true });
    let query = `SELECT cb.*, b.name AS branch_name, p.name AS product_name,
                       c.fullname AS registered_customer_name, c.phone_number AS registered_customer_phone
        FROM \`${dbName}\`.customer_bookings cb
        INNER JOIN \`${dbName}\`.branches b ON cb.branch_id = b.id
        LEFT JOIN \`${dbName}\`.products p ON cb.product_id = p.id
        LEFT JOIN \`${dbName}\`.customers c ON cb.customer_id = c.id
        WHERE cb.id = ? AND cb.deleted_at IS NULL`;
    const params = [id];
    if (String(userRole).toUpperCase() === 'STAFF') {
        query += ' AND cb.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    }
    const [bookings] = await masterPool.query(query, params);
    if (bookings.length === 0) throw new Error('Booking không tồn tại, đã bị xóa hoặc bạn không có quyền xem.');
    return bookings[0];
};

module.exports = { getCustomerBookings, getCustomerBookingDetail };