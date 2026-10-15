const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const normalizeItems = items => {
    if (!Array.isArray(items) || items.length === 0) throw new Error('items phải là mảng có ít nhất một mục chi.');
    return items.map((item, index) => {
        if (!item || typeof item.expense_type !== 'string' || !item.expense_type.trim() || item.expense_type.length > 255) {
            throw new Error(`items[${index}].expense_type không hợp lệ.`);
        }
        if (typeof item.amount !== 'number' && (typeof item.amount !== 'string' || !item.amount.trim())) {
            throw new Error(`items[${index}].amount không hợp lệ.`);
        }
        const amount = toNumber(item.amount, `items[${index}].amount`);
        if (amount > 9999999999999.99 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) throw new Error(`items[${index}].amount không hợp lệ.`);
        return { expense_type: item.expense_type.trim(), amount };
    });
};

const addItems = async (connection, dbName, voucherId, items) => {
    for (const item of items) {
        await connection.query(`INSERT INTO \`${dbName}\`.expenses_vouchers_items (expenses_voucher_id, expense_type, amount) VALUES (?, ?, ?)`,
            [voucherId, item.expense_type, item.amount]);
    }
};

const totalItems = items => Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

const createExpense = async (tenantId, expenseData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let { branch_id, note, expense_date } = expenseData;
    const items = normalizeItems(expenseData.items);

    // Phân quyền: Tự động lấy nhánh của Staff, Manager bắt buộc phải truyền
    if (String(userRole).toUpperCase() !== 'MANAGER') {
        branch_id = userBranchId;
    } else if (!branch_id) {
        throw new Error('Quản lý bắt buộc phải truyền branch_id để chọn cơ sở lập phiếu chi.');
    }

    const branchId = toNumber(branch_id, 'branch_id', { min: 1, integer: true });
    const expenseAmount = totalItems(items);
    if (expenseAmount > 9999999999999.99) throw new Error('Tổng tiền phiếu chi vượt giới hạn.');

    // Kiểm tra chi nhánh có tồn tại
    const [branches] = await masterPool.query(
        `SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`,
        [branchId]
    );
    if (branches.length === 0) throw new Error('Chi nhánh không tồn tại hoặc đã bị xóa.');

    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.query(
            `INSERT INTO \`${dbName}\`.expense_vouchers
                (branch_id, amount, expense_type, note, expense_date, created_by)
             VALUES (?, ?, ?, ?, COALESCE(?, NOW()), ?)`,
            [branchId, expenseAmount, items.length === 1 ? items[0].expense_type : 'Nhiều mục chi', note || null, expense_date || null, executorName]
        );
        await addItems(connection, dbName, result.insertId, items);
        await connection.commit();
        return { expenseId: result.insertId, amount: expenseAmount };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getExpenses = async (tenantId, searchKeyword = '', branchId, startDate, endDate, userRole, userBranchId, pagination) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT e.*, b.name AS branch_name 
        FROM \`${dbName}\`.expense_vouchers e
        INNER JOIN \`${dbName}\`.branches b ON e.branch_id = b.id
        WHERE e.deleted_at IS NULL
    `;
    const params = [];

    // Phân quyền Staff chỉ xem được phiếu của cơ sở mình
    if (String(userRole).toUpperCase() !== 'MANAGER') {
        query += ' AND e.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    } else if (branchId !== undefined) {
        query += ' AND e.branch_id = ?';
        params.push(toNumber(branchId, 'branchId', { min: 1, integer: true }));
    }

    if (searchKeyword) {
        query += ` AND (e.note LIKE ? OR EXISTS (SELECT 1 FROM \`${dbName}\`.expenses_vouchers_items x WHERE x.expenses_voucher_id = e.id AND x.expense_type LIKE ?))`;
        params.push(`%${searchKeyword}%`, `%${searchKeyword}%`);
    }

    if (startDate) {
        query += ' AND DATE(e.expense_date) >= ?';
        params.push(startDate);
    }
    if (endDate) {
        query += ' AND DATE(e.expense_date) <= ?';
        params.push(endDate);
    }

    const result = await paginateQuery(masterPool, query, params, 'e.expense_date DESC, e.created_at DESC, e.id DESC', pagination);
    if (result.data.length) {
        const [items] = await masterPool.query(`SELECT id, expenses_voucher_id, expense_type, amount FROM \`${dbName}\`.expenses_vouchers_items WHERE expenses_voucher_id IN (?) ORDER BY id`, [result.data.map(row => row.id)]);
        result.data = result.data.map(row => ({ ...row, items: items.filter(item => item.expenses_voucher_id === row.id) }));
    }
    return result;
};

const getExpenseDetail = async (tenantId, expenseId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT e.*, b.name AS branch_name 
        FROM \`${dbName}\`.expense_vouchers e
        INNER JOIN \`${dbName}\`.branches b ON e.branch_id = b.id
        WHERE e.id = ? AND e.deleted_at IS NULL
    `;
    const params = [expenseId];

    if (String(userRole).toUpperCase() !== 'MANAGER') {
        query += ' AND e.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    }

    const [rows] = await masterPool.query(query, params);
    if (rows.length === 0) {
        throw new Error('Phiếu chi không tồn tại, đã bị xóa hoặc bạn không có quyền xem.');
    }

    const [items] = await masterPool.query(`SELECT id, expenses_voucher_id, expense_type, amount FROM \`${dbName}\`.expenses_vouchers_items WHERE expenses_voucher_id = ? ORDER BY id`, [expenseId]);
    return { ...rows[0], items };
};

const updateExpense = async (tenantId, expenseId, updateData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    
    // Kiểm tra phiếu tồn tại & Phân quyền
    const [existing] = await masterPool.query(
        `SELECT branch_id FROM \`${dbName}\`.expense_vouchers WHERE id = ? AND deleted_at IS NULL`,
        [expenseId]
    );
    if (existing.length === 0) throw new Error('Phiếu chi không tồn tại hoặc đã bị xóa.');

    if (String(userRole).toUpperCase() !== 'MANAGER' && Number(existing[0].branch_id) !== Number(userBranchId)) {
        throw new Error('Bạn không có quyền sửa phiếu chi của cơ sở khác.');
    }

    if (updateData.amount !== undefined || updateData.expense_type !== undefined) throw new Error('Sửa khoản chi bằng items, không gửi amount/expense_type ở header.');
    const { note, expense_date } = updateData;
    const items = updateData.items === undefined ? null : normalizeItems(updateData.items);
    const updateFields = [];
    const updateParams = [];

    if (items) {
        if (totalItems(items) > 9999999999999.99) throw new Error('Tổng tiền phiếu chi vượt giới hạn.');
        updateFields.push('amount = ?', 'expense_type = ?');
        updateParams.push(totalItems(items), items.length === 1 ? items[0].expense_type : 'Nhiều mục chi');
    }
    if (note !== undefined) {
        updateFields.push('note = ?');
        updateParams.push(note);
    }
    if (expense_date !== undefined) {
        updateFields.push('expense_date = ?');
        updateParams.push(expense_date);
    }

    if (updateFields.length === 0) return { message: 'Không có dữ liệu nào được cập nhật.' };

    updateFields.push('updated_by = ?');
    updateParams.push(executorName);
    updateParams.push(expenseId);

    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            `UPDATE \`${dbName}\`.expense_vouchers SET ${updateFields.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
            updateParams
        );
        if (items) {
            await connection.query(`DELETE FROM \`${dbName}\`.expenses_vouchers_items WHERE expenses_voucher_id = ?`, [expenseId]);
            await addItems(connection, dbName, expenseId, items);
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    return { message: 'Cập nhật phiếu chi thành công' };
};

const deleteExpense = async (tenantId, expenseId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);

    const [existing] = await masterPool.query(
        `SELECT branch_id FROM \`${dbName}\`.expense_vouchers WHERE id = ? AND deleted_at IS NULL`,
        [expenseId]
    );
    if (existing.length === 0) throw new Error('Phiếu chi không tồn tại hoặc đã bị xóa.');

    if (String(userRole).toUpperCase() !== 'MANAGER' && Number(existing[0].branch_id) !== Number(userBranchId)) {
        throw new Error('Bạn không có quyền xóa phiếu chi của cơ sở khác.');
    }

    await masterPool.query(
        `UPDATE \`${dbName}\`.expense_vouchers SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`,
        [executorName, expenseId]
    );

    return { message: 'Xóa phiếu chi thành công' };
};

module.exports = {
    createExpense,
    getExpenses,
    getExpenseDetail,
    updateExpense,
    deleteExpense
};