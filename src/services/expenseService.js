const { masterPool, getTenantDbName } = require('../config/database');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const createExpense = async (tenantId, expenseData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let { branch_id, amount, expense_type, note, expense_date } = expenseData;

    // Phân quyền: Tự động lấy nhánh của Staff, Manager bắt buộc phải truyền
    if (String(userRole).toUpperCase() !== 'MANAGER') {
        branch_id = userBranchId;
    } else if (!branch_id) {
        throw new Error('Quản lý bắt buộc phải truyền branch_id để chọn cơ sở lập phiếu chi.');
    }

    const branchId = toNumber(branch_id, 'branch_id', { min: 1, integer: true });
    const expenseAmount = toNumber(amount, 'amount', { min: 0 });

    if (!expense_type || !String(expense_type).trim()) {
        throw new Error('Loại phiếu chi (expense_type) không được để trống.');
    }

    // Kiểm tra chi nhánh có tồn tại
    const [branches] = await masterPool.query(
        `SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`,
        [branchId]
    );
    if (branches.length === 0) throw new Error('Chi nhánh không tồn tại hoặc đã bị xóa.');

    const [result] = await masterPool.query(
        `INSERT INTO \`${dbName}\`.expense_vouchers 
            (branch_id, amount, expense_type, note, expense_date, created_by) 
         VALUES (?, ?, ?, ?, COALESCE(?, NOW()), ?)`,
        [branchId, expenseAmount, String(expense_type).trim(), note || null, expense_date || null, executorName]
    );

    return { expenseId: result.insertId, amount: expenseAmount };
};

const getExpenses = async (tenantId, searchKeyword = '', branchId, startDate, endDate, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT e.*, b.name AS branch_name 
        FROM \`${dbName}\`.expense_vouchers e
        INNER JOIN \`${dbName}\`.branches b ON e.branch_id = b.id
        WHERE e.deleted_at IS NULL
    `;
    const params = [];

    // Phân quyền Staff chỉ xem được phiếu của cơ sở mình
    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        query += ' AND e.branch_id = ?';
        params.push(userBranchId);
    } else if (branchId !== undefined) {
        query += ' AND e.branch_id = ?';
        params.push(toNumber(branchId, 'branchId', { min: 1, integer: true }));
    }

    if (searchKeyword) {
        query += ' AND (e.expense_type LIKE ? OR e.note LIKE ?)';
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

    query += ' ORDER BY e.expense_date DESC, e.created_at DESC';

    const [rows] = await masterPool.query(query, params);
    return rows;
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

    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        query += ' AND e.branch_id = ?';
        params.push(userBranchId);
    }

    const [rows] = await masterPool.query(query, params);
    if (rows.length === 0) {
        throw new Error('Phiếu chi không tồn tại, đã bị xóa hoặc bạn không có quyền xem.');
    }

    return rows[0];
};

const updateExpense = async (tenantId, expenseId, updateData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    
    // Kiểm tra phiếu tồn tại & Phân quyền
    const [existing] = await masterPool.query(
        `SELECT branch_id FROM \`${dbName}\`.expense_vouchers WHERE id = ? AND deleted_at IS NULL`,
        [expenseId]
    );
    if (existing.length === 0) throw new Error('Phiếu chi không tồn tại hoặc đã bị xóa.');

    if (String(userRole).toUpperCase() !== 'MANAGER' && existing[0].branch_id !== userBranchId) {
        throw new Error('Bạn không có quyền sửa phiếu chi của cơ sở khác.');
    }

    const { amount, expense_type, note, expense_date } = updateData;
    const updateFields = [];
    const updateParams = [];

    if (amount !== undefined) {
        updateFields.push('amount = ?');
        updateParams.push(toNumber(amount, 'amount', { min: 0 }));
    }
    if (expense_type !== undefined) {
        const typeStr = String(expense_type).trim();
        if (!typeStr) throw new Error('expense_type không được để trống.');
        updateFields.push('expense_type = ?');
        updateParams.push(typeStr);
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

    await masterPool.query(
        `UPDATE \`${dbName}\`.expense_vouchers SET ${updateFields.join(', ')} WHERE id = ?`,
        updateParams
    );

    return { message: 'Cập nhật phiếu chi thành công' };
};

const deleteExpense = async (tenantId, expenseId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);

    const [existing] = await masterPool.query(
        `SELECT branch_id FROM \`${dbName}\`.expense_vouchers WHERE id = ? AND deleted_at IS NULL`,
        [expenseId]
    );
    if (existing.length === 0) throw new Error('Phiếu chi không tồn tại hoặc đã bị xóa.');

    if (String(userRole).toUpperCase() !== 'MANAGER' && existing[0].branch_id !== userBranchId) {
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