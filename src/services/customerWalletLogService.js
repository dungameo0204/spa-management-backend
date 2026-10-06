const { masterPool, getTenantDbName } = require('../config/database');

const toNumber = (value, fieldName, { min = 0, integer = false, max } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue)) || (max !== undefined && numberValue > max)) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const getBranchIdForTransaction = (branchId, userRole, userBranchId) => {
    if (String(userRole).toUpperCase() === 'STAFF') {
        return toNumber(userBranchId, 'branch_id', { min: 1, integer: true });
    }
    if (branchId === undefined || branchId === null || branchId === '') {
        throw new Error('Quản lý bắt buộc phải truyền branch_id để ghi nhận nạp ví.');
    }
    return toNumber(branchId, 'branch_id', { min: 1, integer: true });
};

const ensureBranchExists = async (connection, dbName, branchId) => {
    const [branches] = await connection.query(`SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`, [branchId]);
    if (branches.length === 0) throw new Error('Chi nhánh không tồn tại hoặc đã bị xóa.');
};

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const roundMoney = (value) => Number(Number(value).toFixed(2));

const calculateBonus = (walletData, paidAmount) => {
    const hasBonusPercent = hasValue(walletData.bonus_percent);
    const hasBonusAmount = hasValue(walletData.bonus_amount);

    if (!hasBonusPercent && !hasBonusAmount) {
        return { bonusPercent: 0, bonusAmount: 0 };
    }

    const inputBonusPercent = hasBonusPercent
        ? toNumber(walletData.bonus_percent, 'bonus_percent', { min: 0 })
        : null;
    const inputBonusAmount = hasBonusAmount
        ? roundMoney(toNumber(walletData.bonus_amount, 'bonus_amount', { min: 0 }))
        : null;

    if (paidAmount === 0) {
        if (inputBonusPercent !== null && inputBonusPercent !== 0) {
            throw new Error('Không thể áp dụng bonus_percent khi paid_amount bằng 0. Hãy truyền bonus_amount.');
        }
        return { bonusPercent: 0, bonusAmount: inputBonusAmount ?? 0 };
    }

    if (inputBonusPercent !== null && inputBonusAmount !== null) {
        const calculatedBonusAmount = roundMoney(paidAmount * inputBonusPercent / 100);
        if (calculatedBonusAmount !== inputBonusAmount) {
            throw new Error('bonus_percent và bonus_amount không khớp với paid_amount.');
        }
        return { bonusPercent: inputBonusPercent, bonusAmount: inputBonusAmount };
    }

    if (inputBonusPercent !== null) {
        return {
            bonusPercent: inputBonusPercent,
            bonusAmount: roundMoney(paidAmount * inputBonusPercent / 100)
        };
    }

    return {
        bonusPercent: Number((inputBonusAmount * 100 / paidAmount).toFixed(2)),
        bonusAmount: inputBonusAmount
    };
};

const normalizePaymentMethod = (paymentMethod) => {
    const normalizedPaymentMethod = String(paymentMethod || 'CASH').trim().toUpperCase();
    if (!['CASH', 'TRANSFER', 'CARD'].includes(normalizedPaymentMethod)) {
        throw new Error('payment_method chỉ nhận CASH, TRANSFER hoặc CARD.');
    }
    return normalizedPaymentMethod;
};

const ensureWalletBalanceIsSufficient = (walletBalance, amountToDeduct) => {
    if (Number(walletBalance) + 0.000001 < amountToDeduct) {
        throw new Error('Số dư ví hiện tại không đủ để hoàn tác giao dịch nạp ví này.');
    }
};

const getLockedCustomers = async (connection, dbName, customerIds) => {
    const uniqueCustomerIds = [...new Set(customerIds)].sort((a, b) => a - b);
    const [customers] = await connection.query(
        `SELECT id, wallet_balance
         FROM \`${dbName}\`.customers
         WHERE id IN (?) AND deleted_at IS NULL
         ORDER BY id
         FOR UPDATE`,
        [uniqueCustomerIds]
    );
    if (customers.length !== uniqueCustomerIds.length) {
        throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');
    }
    return new Map(customers.map(customer => [Number(customer.id), customer]));
};

const createWalletLog = async (tenantId, walletData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        const customerId = toNumber(walletData.customer_id, 'customer_id', { min: 1, integer: true });
        const branchId = getBranchIdForTransaction(walletData.branch_id, userRole, userBranchId);
        const paidAmount = toNumber(walletData.paid_amount, 'paid_amount', { min: 0 });
        const { bonusPercent, bonusAmount } = calculateBonus(walletData, paidAmount);
        const totalReceived = roundMoney(paidAmount + bonusAmount);
        if (totalReceived <= 0) throw new Error('paid_amount và bonus_amount không thể cùng bằng 0.');
        const paymentMethod = normalizePaymentMethod(walletData.payment_method);
        await connection.beginTransaction();
        await ensureBranchExists(connection, dbName, branchId);
        const [customers] = await connection.query(
            `SELECT id, wallet_balance FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
            [customerId]
        );
        if (customers.length === 0) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');

        const [result] = await connection.query(
            `INSERT INTO \`${dbName}\`.customer_wallet_logs
                (customer_id, branch_id, paid_amount, bonus_percent, bonus_amount, total_received, payment_method, note, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [customerId, branchId, paidAmount, bonusPercent, bonusAmount, totalReceived, paymentMethod, walletData.note || null, executorName]
        );
        await connection.query(
            `UPDATE \`${dbName}\`.customers SET wallet_balance = wallet_balance + ?, updated_by = ? WHERE id = ?`,
            [totalReceived, executorName, customerId]
        );

        await connection.commit();
        return {
            walletLogId: result.insertId,
            paidAmount,
            bonusPercent,
            bonusAmount,
            totalReceived,
            walletBalance: Number(customers[0].wallet_balance) + totalReceived
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const updateWalletLog = async (tenantId, walletLogId, updateData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        const normalizedWalletLogId = toNumber(walletLogId, 'walletLogId', { min: 1, integer: true });
        const normalizedRole = String(userRole).toUpperCase();
        await connection.beginTransaction();

        const [walletLogs] = await connection.query(
            `SELECT * FROM \`${dbName}\`.customer_wallet_logs WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
            [normalizedWalletLogId]
        );
        if (walletLogs.length === 0) throw new Error('Giao dịch nạp ví không tồn tại hoặc đã bị xóa.');

        const oldWalletLog = walletLogs[0];
        if (normalizedRole === 'STAFF' && Number(oldWalletLog.branch_id) !== Number(userBranchId)) {
            throw new Error('Bạn không có quyền sửa giao dịch nạp ví của cơ sở khác.');
        }

        const customerId = hasValue(updateData.customer_id)
            ? toNumber(updateData.customer_id, 'customer_id', { min: 1, integer: true })
            : Number(oldWalletLog.customer_id);
        const branchId = normalizedRole === 'STAFF'
            ? toNumber(userBranchId, 'branch_id', { min: 1, integer: true })
            : (hasValue(updateData.branch_id)
                ? toNumber(updateData.branch_id, 'branch_id', { min: 1, integer: true })
                : Number(oldWalletLog.branch_id));
        const paidAmount = hasValue(updateData.paid_amount)
            ? toNumber(updateData.paid_amount, 'paid_amount', { min: 0 })
            : Number(oldWalletLog.paid_amount);
        const bonusData = (hasValue(updateData.bonus_percent) || hasValue(updateData.bonus_amount))
            ? updateData
            : { bonus_percent: oldWalletLog.bonus_percent };
        const { bonusPercent, bonusAmount } = calculateBonus(bonusData, paidAmount);
        const totalReceived = roundMoney(paidAmount + bonusAmount);
        if (totalReceived <= 0) throw new Error('paid_amount và bonus_amount không thể cùng bằng 0.');
        const paymentMethod = hasValue(updateData.payment_method)
            ? normalizePaymentMethod(updateData.payment_method)
            : oldWalletLog.payment_method;
        const note = Object.prototype.hasOwnProperty.call(updateData, 'note')
            ? (updateData.note || null)
            : oldWalletLog.note;

        await ensureBranchExists(connection, dbName, branchId);
        const customersById = await getLockedCustomers(connection, dbName, [Number(oldWalletLog.customer_id), customerId]);
        const oldCustomer = customersById.get(Number(oldWalletLog.customer_id));
        const newCustomer = customersById.get(customerId);
        const oldTotalReceived = Number(oldWalletLog.total_received);

        if (Number(oldWalletLog.customer_id) === customerId) {
            const walletBalanceDelta = roundMoney(totalReceived - oldTotalReceived);
            if (walletBalanceDelta < 0) ensureWalletBalanceIsSufficient(oldCustomer.wallet_balance, Math.abs(walletBalanceDelta));
            await connection.query(
                `UPDATE \`${dbName}\`.customers SET wallet_balance = wallet_balance + ?, updated_by = ? WHERE id = ?`,
                [walletBalanceDelta, executorName, customerId]
            );
        } else {
            ensureWalletBalanceIsSufficient(oldCustomer.wallet_balance, oldTotalReceived);
            await connection.query(
                `UPDATE \`${dbName}\`.customers SET wallet_balance = wallet_balance - ?, updated_by = ? WHERE id = ?`,
                [oldTotalReceived, executorName, oldWalletLog.customer_id]
            );
            await connection.query(
                `UPDATE \`${dbName}\`.customers SET wallet_balance = wallet_balance + ?, updated_by = ? WHERE id = ?`,
                [totalReceived, executorName, customerId]
            );
        }

        await connection.query(
            `UPDATE \`${dbName}\`.customer_wallet_logs
             SET customer_id = ?, branch_id = ?, paid_amount = ?, bonus_percent = ?, bonus_amount = ?, total_received = ?, payment_method = ?, note = ?, updated_by = ?
             WHERE id = ?`,
            [customerId, branchId, paidAmount, bonusPercent, bonusAmount, totalReceived, paymentMethod, note, executorName, normalizedWalletLogId]
        );

        await connection.commit();
        return {
            message: 'Cập nhật giao dịch nạp ví thành công',
            walletLogId: normalizedWalletLogId,
            customerId,
            branchId,
            paidAmount,
            bonusPercent,
            bonusAmount,
            totalReceived,
            walletBalance: Number(newCustomer.wallet_balance) + (Number(oldWalletLog.customer_id) === customerId ? roundMoney(totalReceived - oldTotalReceived) : totalReceived)
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const deleteWalletLog = async (tenantId, walletLogId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        const normalizedWalletLogId = toNumber(walletLogId, 'walletLogId', { min: 1, integer: true });
        await connection.beginTransaction();

        const [walletLogs] = await connection.query(
            `SELECT * FROM \`${dbName}\`.customer_wallet_logs WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
            [normalizedWalletLogId]
        );
        if (walletLogs.length === 0) throw new Error('Giao dịch nạp ví không tồn tại hoặc đã bị xóa.');

        const walletLog = walletLogs[0];
        if (String(userRole).toUpperCase() === 'STAFF' && Number(walletLog.branch_id) !== Number(userBranchId)) {
            throw new Error('Bạn không có quyền xóa giao dịch nạp ví của cơ sở khác.');
        }

        const customersById = await getLockedCustomers(connection, dbName, [Number(walletLog.customer_id)]);
        const customer = customersById.get(Number(walletLog.customer_id));
        const totalReceived = Number(walletLog.total_received);
        ensureWalletBalanceIsSufficient(customer.wallet_balance, totalReceived);

        await connection.query(
            `UPDATE \`${dbName}\`.customers SET wallet_balance = wallet_balance - ?, updated_by = ? WHERE id = ?`,
            [totalReceived, executorName, walletLog.customer_id]
        );
        await connection.query(
            `UPDATE \`${dbName}\`.customer_wallet_logs SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`,
            [executorName, normalizedWalletLogId]
        );

        await connection.commit();
        return {
            message: 'Xóa giao dịch nạp ví thành công',
            walletLogId: normalizedWalletLogId,
            walletBalance: Number(customer.wallet_balance) - totalReceived
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getWalletLogs = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const normalizedRole = String(userRole).toUpperCase();
    let query = `
        SELECT wl.*, c.fullname AS customer_name, c.phone_number, b.name AS branch_name
        FROM \`${dbName}\`.customer_wallet_logs wl
        INNER JOIN \`${dbName}\`.customers c ON wl.customer_id = c.id
        LEFT JOIN \`${dbName}\`.branches b ON wl.branch_id = b.id
        WHERE wl.deleted_at IS NULL
    `;
    const params = [];

    if (normalizedRole === 'STAFF') {
        query += ' AND wl.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    } else if (filters.branchId !== undefined && filters.branchId !== '') {
        query += ' AND wl.branch_id = ?';
        params.push(toNumber(filters.branchId, 'branchId', { min: 1, integer: true }));
    }
    if (filters.customerId !== undefined && filters.customerId !== '') {
        query += ' AND wl.customer_id = ?';
        params.push(toNumber(filters.customerId, 'customerId', { min: 1, integer: true }));
    }
    if (filters.paymentMethod) {
        const paymentMethod = String(filters.paymentMethod).trim().toUpperCase();
        if (!['CASH', 'TRANSFER', 'CARD'].includes(paymentMethod)) throw new Error('paymentMethod không hợp lệ.');
        query += ' AND wl.payment_method = ?';
        params.push(paymentMethod);
    }
    if (filters.search) {
        query += ' AND (c.fullname LIKE ? OR c.phone_number LIKE ? OR wl.note LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.startDate) {
        query += ' AND DATE(wl.created_at) >= ?';
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        query += ' AND DATE(wl.created_at) <= ?';
        params.push(filters.endDate);
    }

    query += ' ORDER BY wl.created_at DESC, wl.id DESC';
    const [rows] = await masterPool.query(query, params);
    return rows;
};

const getWalletLogDetail = async (tenantId, walletLogId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT wl.*, c.fullname AS customer_name, c.phone_number, b.name AS branch_name
        FROM \`${dbName}\`.customer_wallet_logs wl
        INNER JOIN \`${dbName}\`.customers c ON wl.customer_id = c.id
        LEFT JOIN \`${dbName}\`.branches b ON wl.branch_id = b.id
        WHERE wl.id = ? AND wl.deleted_at IS NULL
    `;
    const params = [toNumber(walletLogId, 'walletLogId', { min: 1, integer: true })];
    if (String(userRole).toUpperCase() === 'STAFF') {
        query += ' AND wl.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    }

    const [rows] = await masterPool.query(query, params);
    if (rows.length === 0) throw new Error('Giao dịch nạp ví không tồn tại, đã bị xóa hoặc bạn không có quyền xem.');
    return rows[0];
};

module.exports = { createWalletLog, updateWalletLog, deleteWalletLog, getWalletLogs, getWalletLogDetail };