const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');
const { normalizeDateOfBirth } = require('../utils/dateOfBirth');
const { normalizeCustomerProfile, profileSqlValue, profileSelect } = require('../utils/customerProfile');
const { invoiceDebtSql, withDebtBalances } = require('../utils/customerDebt');
const bcrypt = require('bcryptjs'); // Đừng quên import thư viện mã hóa

const customerDuplicateError = error => new Error(
    String(error.sqlMessage || error.message || '').includes('uq_customer_profile_code')
        ? 'Mã hồ sơ đã được khách hàng khác sử dụng!'
        : 'Số điện thoại đã được khách hàng khác sử dụng!'
);

const assertProfileCodeAvailable = async (dbName, code, excludeId) => {
    if (!code) return;
    const params = [code];
    let sql = `SELECT id FROM \`${dbName}\`.customers WHERE profile_code = ?`;
    if (excludeId !== undefined) { sql += ' AND id != ?'; params.push(excludeId); }
    const [rows] = await masterPool.query(sql, params);
    if (rows.length) throw new Error('Mã hồ sơ đã được khách hàng khác sử dụng!');
};

const createCustomer = async (tenantId, customerData, executorName) => {
    const profile = normalizeCustomerProfile(customerData);
    const dateOfBirth = normalizeDateOfBirth(customerData.date_of_birth);
    const dbName = await getTenantDbName(tenantId);
    
    // Bóc tách tất cả các trường từ bảng mới
    const { fullname, phone_number, password, avatar, address, note } = customerData;

    // Kiểm tra trùng số điện thoại
    const [existing] = await masterPool.query(
        `SELECT id FROM \`${dbName}\`.customers WHERE phone_number = ?`,
        [phone_number]
    );
    if (existing.length > 0) {
        throw new Error(`Khách hàng với số điện thoại '${phone_number}' đã tồn tại trong hệ thống!`);
    }

    await assertProfileCodeAvailable(dbName, profile.profile_code);
    const profileFields = Object.keys(profile);

    // Mã hóa mật khẩu nếu có (Khi khách tự đăng ký qua MiniApp)
    let hashedPassword = null;
    if (password) {
        const salt = await bcrypt.genSalt(10);
        hashedPassword = await bcrypt.hash(password, salt);
    }

    let result;
    try {
        [result] = await masterPool.query(
            `INSERT INTO \`${dbName}\`.customers
            (fullname, phone_number, password, avatar, address, note, created_by, date_of_birth${profileFields.length ? ', ' + profileFields.join(', ') : ''})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?${profileFields.map(() => ', ?').join('')})`,
            [fullname, phone_number, hashedPassword, avatar || null, address || null, note || null, executorName, dateOfBirth, ...profileFields.map(field => profileSqlValue(field, profile[field]))]
        );
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw customerDuplicateError(error);
        throw error;
    }

    return result.insertId;
};

const getCustomers = async (tenantId, searchKeyword = '', pagination) => {
    const dbName = await getTenantDbName(tenantId);
    
    // Lưu ý: Tuyệt đối không Select trả về cột password cho Frontend
    let query = `
        SELECT id, fullname, phone_number, DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth, avatar, address, wallet_balance, total_debt, note, created_at, updated_at, ${profileSelect()}
        FROM \`${dbName}\`.customers 
        WHERE deleted_at IS NULL
    `;
    const params = [];

    if (searchKeyword) {
        query += ` AND (fullname LIKE ? OR phone_number LIKE ? OR profile_code LIKE ?)`;
        params.push(`%${searchKeyword}%`, `%${searchKeyword}%`, `%${searchKeyword}%`);
    }
    
    return paginateQuery(masterPool, query, params, 'created_at DESC, id DESC', pagination);
};

const getCustomerById = async (tenantId, customerId) => {
    const dbName = await getTenantDbName(tenantId);
    const [rows] = await masterPool.query(
        `SELECT id, fullname, phone_number, DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth, avatar, address, wallet_balance, total_debt, note, created_at, updated_at, created_by, updated_by,
                (${invoiceDebtSql(dbName, 'customers.id')}) AS invoice_debt, ${profileSelect()}
         FROM \`${dbName}\`.customers
         WHERE id = ? AND deleted_at IS NULL`,
        [customerId]
    );
    if (rows.length === 0) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');
    return withDebtBalances(rows[0]);
};

// One customer, all sold lines and all non-deleted cards, including exhausted cards.
const getCustomerOverview = async (tenantId, customerId) => {
    const id = Number(customerId);
    if (!Number.isSafeInteger(id) || id < 1 || String(id) !== String(customerId)) {
        const error = new Error('customerId không hợp lệ.'); error.status = 400; throw error;
    }
    const dbName = await getTenantDbName(tenantId);
    const [customers] = await masterPool.query(
        `SELECT id, fullname, phone_number, DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth, avatar, address, wallet_balance, total_debt, note,
                created_at, updated_at, deleted_at, created_by, updated_by, deleted_by,
                (${invoiceDebtSql(dbName, 'customers.id')}) AS invoice_debt, ${profileSelect()}
         FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!customers.length) { const error = new Error('Khách hàng không tồn tại hoặc đã bị xóa.'); error.status = 404; throw error; }

    const [purchases] = await masterPool.query(
        `SELECT ii.id AS invoice_item_id, ii.invoice_id, ii.product_id, ii.snapshot_name AS product_name,
                ii.snapshot_price AS unit_price, ii.quantity, ii.discount_percent, ii.discount_amount,
                ii.final_price, p.is_product, i.invoice_date AS purchase_date, i.branch_id
         FROM \`${dbName}\`.invoices i
         JOIN \`${dbName}\`.invoice_items ii ON ii.invoice_id = i.id AND ii.deleted_at IS NULL
         JOIN \`${dbName}\`.products p ON p.id = ii.product_id
         WHERE i.customer_id = ? AND i.deleted_at IS NULL
         ORDER BY i.invoice_date DESC, i.id DESC, ii.id DESC`, [id]);
    const [cards] = await masterPool.query(
        `SELECT t.*, p.name AS product_name, i.invoice_date AS purchase_date, i.branch_id,
                 (SELECT ii.snapshot_price FROM \`${dbName}\`.invoice_items ii
                  WHERE ii.id = t.invoice_item_id AND ii.deleted_at IS NULL) AS unit_price
         FROM \`${dbName}\`.treatments t
         JOIN \`${dbName}\`.products p ON p.id = t.product_id
         LEFT JOIN \`${dbName}\`.invoices i ON i.id = t.invoice_id AND i.deleted_at IS NULL
         WHERE t.customer_id = ? AND t.deleted_at IS NULL AND (t.invoice_id IS NULL OR i.id IS NOT NULL)
         ORDER BY COALESCE(i.invoice_date, t.created_at) DESC, t.id DESC`, [id]);
    if (cards.length) {
        const [histories] = await masterPool.query(
            `SELECT th.*, b.name AS branch_name FROM \`${dbName}\`.treatment_history th
             LEFT JOIN \`${dbName}\`.branches b ON b.id = th.branch_id
             WHERE th.treatment_id IN (?) AND th.deleted_at IS NULL
             ORDER BY th.execution_date DESC, th.id DESC`, [cards.map(card => card.id)]);
        if (histories.length) {
            const [staffs] = await masterPool.query(
                `SELECT ths.*, s.fullname AS staff_name FROM \`${dbName}\`.treatment_history_staffs ths
                 JOIN \`${dbName}\`.staffs s ON s.id = ths.staff_id
                 WHERE ths.treatment_history_id IN (?) AND ths.deleted_at IS NULL ORDER BY ths.id`, [histories.map(history => history.id)]);
            histories.forEach(history => { history.staffs = staffs.filter(staff => staff.treatment_history_id === history.id); });
        }
        cards.forEach(card => {
            card.histories = histories.filter(history => history.treatment_id === card.id);
            card.completed_sessions = card.total_sessions === null || card.closed_at ? card.histories.length : card.total_sessions - card.remaining_sessions;
        });
    }
    const matchedCardIds = new Set();
    const cardMap = new Map(cards.map(card => [Number(card.id), card]));
    cards.forEach(card => { card.children = []; });
    cards.forEach(card => {
        if (card.parent_treatment_id != null) {
            const parent = cardMap.get(Number(card.parent_treatment_id));
            if (parent && Number(parent.customer_id) === Number(card.customer_id)) parent.children.push(card);
        }
    });
    const rootCards = cards.filter(card => card.parent_treatment_id == null);
    const purchasesWithTreatments = purchases.map(item => {
        const treatment = rootCards.find(card => card.invoice_item_id != null && Number(card.invoice_item_id) === Number(item.invoice_item_id)) || null;
        if (treatment) matchedCardIds.add(treatment.id);
        return { ...item, treatment };
    });
    const timeline = [
        ...purchasesWithTreatments.map(item => ({ type: 'purchase', date: item.purchase_date, item })),
        ...rootCards.filter(card => !matchedCardIds.has(card.id))
            .map(treatment => ({ type: 'treatment', date: treatment.purchase_date || treatment.created_at, treatment }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date) || a.type.localeCompare(b.type));
    return { customer: withDebtBalances(customers[0]), purchases: purchasesWithTreatments, treatments: rootCards, timeline };
};

const updateCustomer = async (tenantId, customerId, updateData, executorName) => {
    const profile = normalizeCustomerProfile(updateData);
    const dateOfBirth = updateData.date_of_birth !== undefined ? normalizeDateOfBirth(updateData.date_of_birth) : undefined;
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL`, [customerId]);
    if (check.length === 0) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa!');

    await assertProfileCodeAvailable(dbName, profile.profile_code, customerId);

    let updateFields = [];
    let params = [];

    if (dateOfBirth !== undefined) {
        updateFields.push('date_of_birth = ?');
        params.push(dateOfBirth);
    }

    // 1. Xử lý Phone Number để check trùng
    if (updateData.phone_number !== undefined) { 
        const [existing] = await masterPool.query(
            `SELECT id FROM \`${dbName}\`.customers WHERE phone_number = ? AND id != ?`,
            [updateData.phone_number, customerId]
        );
        if (existing.length > 0) throw new Error('Số điện thoại này đã được khách hàng khác sử dụng!');
        
        updateFields.push('phone_number = ?'); 
        params.push(updateData.phone_number); 
    }
    
    // 2. Xử lý Password (Nếu có gửi lên thì phải mã hóa lại)
    if (updateData.password !== undefined && updateData.password !== '') {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(updateData.password, salt);
        updateFields.push('password = ?');
        params.push(hashedPassword);
    }

    // 3. Xử lý các trường cơ bản khác
    const allowedFields = ['fullname', 'avatar', 'address', 'note'];
    allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
            updateFields.push(`${field} = ?`);
            params.push(updateData[field] || null); 
        }
    });

    for (const [field, value] of Object.entries(profile)) {
        updateFields.push(`${field} = ?`);
        params.push(profileSqlValue(field, value));
    }

    if (updateFields.length > 0) {
        updateFields.push('updated_by = ?'); 
        params.push(executorName);
        params.push(customerId);

        const query = `UPDATE \`${dbName}\`.customers SET ${updateFields.join(', ')} WHERE id = ? AND deleted_at IS NULL`;
        try {
            await masterPool.query(query, params);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') throw customerDuplicateError(error);
            throw error;
        }
    }
};

// MANAGER đặt lại mật khẩu MiniApp cho khách thuộc tenant của mình.
const updatePasswordByPhone = async (tenantId, phone_number, newPassword, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.customers WHERE phone_number = ? AND deleted_at IS NULL`, [phone_number]);
    if (check.length === 0) throw new Error('Số điện thoại không tồn tại trong hệ thống!');

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await masterPool.query(
        `UPDATE \`${dbName}\`.customers SET password = ?, updated_by = ? WHERE phone_number = ? AND deleted_at IS NULL`,
        [hashedPassword, executorName, phone_number]
    );
};

const deleteCustomer = async (tenantId, customerId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL`, [customerId]);
    if (check.length === 0) throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');

    const now = new Date();
    await masterPool.query(
        `UPDATE \`${dbName}\`.customers SET deleted_at = ?, deleted_by = ? WHERE id = ?`,
        [now, executorName, customerId]
    );
};

const restoreCustomer = async (tenantId, customerId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [check] = await masterPool.query(`SELECT id FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NOT NULL`, [customerId]);
    if (check.length === 0) throw new Error('Khách hàng chưa bị xóa, không thể khôi phục.');

    await masterPool.query(
        `UPDATE \`${dbName}\`.customers SET deleted_at = NULL, deleted_by = NULL, updated_by = ? WHERE id = ?`,
        [executorName, customerId]
    );
};

module.exports = { 
    createCustomer, 
    getCustomers, 
    getCustomerById,
    getCustomerOverview,
    updateCustomer, 
    deleteCustomer, 
    restoreCustomer,
    updatePasswordByPhone // Xuất thêm hàm mới
};