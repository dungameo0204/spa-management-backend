const { masterPool, getTenantDbName } = require('../config/database');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const getBranchId = (branchId, userRole, userBranchId) => {
    if (String(userRole).toUpperCase() === 'STAFF') {
        return toNumber(userBranchId, 'branch_id', { min: 1, integer: true });
    }
    if (!hasValue(branchId)) throw new Error('Quản lý bắt buộc phải truyền branch_id để ghi nhận thu nợ.');
    return toNumber(branchId, 'branch_id', { min: 1, integer: true });
};

const normalizePaymentMethod = (paymentMethod) => {
    const normalizedPaymentMethod = String(paymentMethod || 'CASH').trim().toUpperCase();
    if (!['CASH', 'TRANSFER', 'CARD'].includes(normalizedPaymentMethod)) {
        throw new Error('payment_method chỉ nhận CASH, TRANSFER hoặc CARD.');
    }
    return normalizedPaymentMethod;
};

const ensureBranchExists = async (connection, dbName, branchId) => {
    const [branches] = await connection.query(
        `SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`,
        [branchId]
    );
    if (branches.length === 0) throw new Error('Chi nhánh không tồn tại hoặc đã bị xóa.');
};

const getLockedCustomers = async (connection, dbName, customerIds) => {
    const uniqueCustomerIds = [...new Set(customerIds)].sort((a, b) => a - b);
    const [customers] = await connection.query(
        `SELECT id, total_debt
         FROM \`${dbName}\`.customers
         WHERE id IN (?) AND deleted_at IS NULL
         ORDER BY id
         FOR UPDATE`,
        [uniqueCustomerIds]
    );
    if (customers.length !== uniqueCustomerIds.length) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');
    return new Map(customers.map(customer => [Number(customer.id), customer]));
};

const validateInvoice = async (connection, dbName, invoiceId, customerId, branchId, paymentIdToExclude = null) => {
    if (!hasValue(invoiceId)) return null;
    const normalizedInvoiceId = toNumber(invoiceId, 'invoice_id', { min: 1, integer: true });
    const [invoices] = await connection.query(
        `SELECT id, customer_id, branch_id, debt_amount
         FROM \`${dbName}\`.invoices
         WHERE id = ? AND deleted_at IS NULL
         FOR UPDATE`,
        [normalizedInvoiceId]
    );
    if (invoices.length === 0) throw new Error('Hóa đơn không tồn tại hoặc đã bị xóa.');
    const invoice = invoices[0];
    if (Number(invoice.customer_id) !== Number(customerId)) throw new Error('invoice_id phải thuộc đúng khách hàng thu nợ.');
    if (Number(invoice.branch_id) !== Number(branchId)) throw new Error('invoice_id phải thuộc đúng chi nhánh thu nợ.');

    let query = `SELECT COALESCE(SUM(amount), 0) AS paid_debt_amount FROM \`${dbName}\`.debt_payments WHERE invoice_id = ? AND deleted_at IS NULL`;
    const params = [normalizedInvoiceId];
    if (paymentIdToExclude !== null) {
        query += ' AND id != ?';
        params.push(paymentIdToExclude);
    }
    const [payments] = await connection.query(query, params);
    return { invoiceId: normalizedInvoiceId, invoiceDebtAmount: Number(invoice.debt_amount), paidDebtAmount: Number(payments[0].paid_debt_amount) };
};

const ensureInvoicePaymentDoesNotExceedDebt = (invoice, amount) => {
    if (invoice && invoice.paidDebtAmount + amount > invoice.invoiceDebtAmount + 0.000001) {
        throw new Error('Tổng tiền thu nợ của hóa đơn không được vượt debt_amount của hóa đơn.');
    }
};

const createDebtPayment = async (tenantId, paymentData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        const customerId = toNumber(paymentData.customer_id, 'customer_id', { min: 1, integer: true });
        const branchId = getBranchId(paymentData.branch_id, userRole, userBranchId);
        const amount = toNumber(paymentData.amount, 'amount', { min: 0 });
        if (amount <= 0) throw new Error('amount phải lớn hơn 0.');
        const paymentMethod = normalizePaymentMethod(paymentData.payment_method);

        await connection.beginTransaction();
        await ensureBranchExists(connection, dbName, branchId);
        const customersById = await getLockedCustomers(connection, dbName, [customerId]);
        const customer = customersById.get(customerId);
        if (Number(customer.total_debt) + 0.000001 < amount) throw new Error('Số tiền thu nợ vượt quá tổng công nợ hiện tại của khách hàng.');

        const invoice = await validateInvoice(connection, dbName, paymentData.invoice_id, customerId, branchId);
        ensureInvoicePaymentDoesNotExceedDebt(invoice, amount);

        const [result] = await connection.query(
            `INSERT INTO \`${dbName}\`.debt_payments
             (customer_id, branch_id, invoice_id, amount, payment_method, payment_date, note, created_by)
             VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, ?)`,
            [customerId, branchId, invoice?.invoiceId || null, amount, paymentMethod, paymentData.payment_date || null, paymentData.note || null, executorName]
        );
        await connection.query(
            `UPDATE \`${dbName}\`.customers SET total_debt = total_debt - ?, updated_by = ? WHERE id = ?`,
            [amount, executorName, customerId]
        );
        await connection.commit();
        return { debtPaymentId: result.insertId, customerId, branchId, invoiceId: invoice?.invoiceId || null, amount, totalDebt: Number(customer.total_debt) - amount };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getDebtPayments = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT dp.*, c.fullname AS customer_name, c.phone_number, b.name AS branch_name
        FROM \`${dbName}\`.debt_payments dp
        INNER JOIN \`${dbName}\`.customers c ON dp.customer_id = c.id
        INNER JOIN \`${dbName}\`.branches b ON dp.branch_id = b.id
        WHERE dp.deleted_at IS NULL
    `;
    const params = [];
    if (String(userRole).toUpperCase() === 'STAFF') {
        query += ' AND dp.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    } else if (hasValue(filters.branchId)) {
        query += ' AND dp.branch_id = ?';
        params.push(toNumber(filters.branchId, 'branchId', { min: 1, integer: true }));
    }
    if (hasValue(filters.customerId)) {
        query += ' AND dp.customer_id = ?';
        params.push(toNumber(filters.customerId, 'customerId', { min: 1, integer: true }));
    }
    if (hasValue(filters.invoiceId)) {
        query += ' AND dp.invoice_id = ?';
        params.push(toNumber(filters.invoiceId, 'invoiceId', { min: 1, integer: true }));
    }
    if (filters.paymentMethod) {
        query += ' AND dp.payment_method = ?';
        params.push(normalizePaymentMethod(filters.paymentMethod));
    }
    if (filters.search) {
        query += ' AND (c.fullname LIKE ? OR c.phone_number LIKE ? OR dp.note LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.startDate) { query += ' AND DATE(dp.payment_date) >= ?'; params.push(filters.startDate); }
    if (filters.endDate) { query += ' AND DATE(dp.payment_date) <= ?'; params.push(filters.endDate); }
    query += ' ORDER BY dp.payment_date DESC, dp.id DESC';
    const [rows] = await masterPool.query(query, params);
    return rows;
};

const getDebtPaymentDetail = async (tenantId, paymentId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT dp.*, c.fullname AS customer_name, c.phone_number, b.name AS branch_name,
               i.total_amount AS invoice_total_amount, i.debt_amount AS invoice_debt_amount
        FROM \`${dbName}\`.debt_payments dp
        INNER JOIN \`${dbName}\`.customers c ON dp.customer_id = c.id
        INNER JOIN \`${dbName}\`.branches b ON dp.branch_id = b.id
        LEFT JOIN \`${dbName}\`.invoices i ON dp.invoice_id = i.id
        WHERE dp.id = ? AND dp.deleted_at IS NULL
    `;
    const params = [toNumber(paymentId, 'paymentId', { min: 1, integer: true })];
    if (String(userRole).toUpperCase() === 'STAFF') {
        query += ' AND dp.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    }
    const [rows] = await masterPool.query(query, params);
    if (rows.length === 0) throw new Error('Phiếu thu nợ không tồn tại, đã bị xóa hoặc bạn không có quyền xem.');
    return rows[0];
};

const updateDebtPayment = async (tenantId, paymentId, updateData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        const normalizedPaymentId = toNumber(paymentId, 'paymentId', { min: 1, integer: true });
        await connection.beginTransaction();
        const [payments] = await connection.query(`SELECT * FROM \`${dbName}\`.debt_payments WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [normalizedPaymentId]);
        if (payments.length === 0) throw new Error('Phiếu thu nợ không tồn tại hoặc đã bị xóa.');
        const oldPayment = payments[0];
        const normalizedRole = String(userRole).toUpperCase();
        if (normalizedRole === 'STAFF' && Number(oldPayment.branch_id) !== Number(userBranchId)) throw new Error('Bạn không có quyền sửa phiếu thu nợ của cơ sở khác.');

        const customerId = hasValue(updateData.customer_id) ? toNumber(updateData.customer_id, 'customer_id', { min: 1, integer: true }) : Number(oldPayment.customer_id);
        const branchId = normalizedRole === 'STAFF' ? toNumber(userBranchId, 'branch_id', { min: 1, integer: true }) : (hasValue(updateData.branch_id) ? toNumber(updateData.branch_id, 'branch_id', { min: 1, integer: true }) : Number(oldPayment.branch_id));
        const amount = hasValue(updateData.amount) ? toNumber(updateData.amount, 'amount', { min: 0 }) : Number(oldPayment.amount);
        if (amount <= 0) throw new Error('amount phải lớn hơn 0.');
        const invoiceInput = Object.prototype.hasOwnProperty.call(updateData, 'invoice_id') ? updateData.invoice_id : oldPayment.invoice_id;
        const paymentMethod = hasValue(updateData.payment_method) ? normalizePaymentMethod(updateData.payment_method) : oldPayment.payment_method;
        const paymentDate = Object.prototype.hasOwnProperty.call(updateData, 'payment_date') ? updateData.payment_date : oldPayment.payment_date;
        const note = Object.prototype.hasOwnProperty.call(updateData, 'note') ? (updateData.note || null) : oldPayment.note;

        await ensureBranchExists(connection, dbName, branchId);
        const customersById = await getLockedCustomers(connection, dbName, [Number(oldPayment.customer_id), customerId]);
        const oldCustomer = customersById.get(Number(oldPayment.customer_id));
        const newCustomer = customersById.get(customerId);
        const debtAvailableForNewPayment = Number(oldPayment.customer_id) === customerId ? Number(newCustomer.total_debt) + Number(oldPayment.amount) : Number(newCustomer.total_debt);
        if (debtAvailableForNewPayment + 0.000001 < amount) throw new Error('Số tiền thu nợ vượt quá tổng công nợ hiện tại của khách hàng.');

        const invoice = await validateInvoice(connection, dbName, invoiceInput, customerId, branchId, normalizedPaymentId);
        ensureInvoicePaymentDoesNotExceedDebt(invoice, amount);

        if (Number(oldPayment.customer_id) === customerId) {
            await connection.query(`UPDATE \`${dbName}\`.customers SET total_debt = total_debt + ? - ?, updated_by = ? WHERE id = ?`, [oldPayment.amount, amount, executorName, customerId]);
        } else {
            await connection.query(`UPDATE \`${dbName}\`.customers SET total_debt = total_debt + ?, updated_by = ? WHERE id = ?`, [oldPayment.amount, executorName, oldPayment.customer_id]);
            await connection.query(`UPDATE \`${dbName}\`.customers SET total_debt = total_debt - ?, updated_by = ? WHERE id = ?`, [amount, executorName, customerId]);
        }
        await connection.query(
            `UPDATE \`${dbName}\`.debt_payments
             SET customer_id = ?, branch_id = ?, invoice_id = ?, amount = ?, payment_method = ?, payment_date = ?, note = ?, updated_by = ?
             WHERE id = ?`,
            [customerId, branchId, invoice?.invoiceId || null, amount, paymentMethod, paymentDate, note, executorName, normalizedPaymentId]
        );
        await connection.commit();
        return { message: 'Cập nhật phiếu thu nợ thành công', debtPaymentId: normalizedPaymentId, customerId, branchId, invoiceId: invoice?.invoiceId || null, amount, totalDebt: debtAvailableForNewPayment - amount };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const deleteDebtPayment = async (tenantId, paymentId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        const normalizedPaymentId = toNumber(paymentId, 'paymentId', { min: 1, integer: true });
        await connection.beginTransaction();
        const [payments] = await connection.query(`SELECT * FROM \`${dbName}\`.debt_payments WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [normalizedPaymentId]);
        if (payments.length === 0) throw new Error('Phiếu thu nợ không tồn tại hoặc đã bị xóa.');
        const payment = payments[0];
        if (String(userRole).toUpperCase() === 'STAFF' && Number(payment.branch_id) !== Number(userBranchId)) throw new Error('Bạn không có quyền xóa phiếu thu nợ của cơ sở khác.');
        const customersById = await getLockedCustomers(connection, dbName, [Number(payment.customer_id)]);
        const customer = customersById.get(Number(payment.customer_id));
        await connection.query(`UPDATE \`${dbName}\`.customers SET total_debt = total_debt + ?, updated_by = ? WHERE id = ?`, [payment.amount, executorName, payment.customer_id]);
        await connection.query(`UPDATE \`${dbName}\`.debt_payments SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`, [executorName, normalizedPaymentId]);
        await connection.commit();
        return { message: 'Xóa phiếu thu nợ thành công', debtPaymentId: normalizedPaymentId, totalDebt: Number(customer.total_debt) + Number(payment.amount) };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = { createDebtPayment, getDebtPayments, getDebtPaymentDetail, updateDebtPayment, deleteDebtPayment };