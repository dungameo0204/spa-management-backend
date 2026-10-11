const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const checkPermission = (userRole, targetDate) => {
    const today = new Date();
    const createdDate = new Date(targetDate);
    today.setHours(0, 0, 0, 0);
    createdDate.setHours(0, 0, 0, 0);

    if (String(userRole).toUpperCase() !== 'MANAGER' && createdDate.getTime() < today.getTime()) {
        throw new Error('Nhân viên chỉ được phép sửa hoặc xóa hóa đơn được tạo trong ngày hôm nay.');
    }
};

const getWalletUsedFromInvoice = (invoice) => {
    if (invoice.wallet_used !== undefined && invoice.wallet_used !== null) {
        return Number(invoice.wallet_used);
    }
    const match = invoice.payment_method ? invoice.payment_method.match(/\[WALLET:([0-9]+(?:\.[0-9]+)?)\]/) : null;
    return match ? Number(match[1]) : 0;
};

const calculateDebtAmount = (totalAmount, paidAmount, walletUsed) => {
    const paymentTotal = paidAmount + walletUsed;
    const epsilon = 0.000001;

    if (walletUsed > totalAmount + epsilon) {
        throw new Error('wallet_used không được lớn hơn tổng tiền hóa đơn.');
    }
    if (paymentTotal > totalAmount + epsilon) {
        throw new Error('Tổng wallet_used và paid_amount không được lớn hơn tổng tiền hóa đơn.');
    }

    return Math.max(totalAmount - paymentTotal, 0);
};

const ensureInvoiceHasNoDebtPayments = async (connection, dbName, invoiceId, action) => {
    const [debtPayments] = await connection.query(
        `SELECT id FROM \`${dbName}\`.debt_payments WHERE invoice_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [invoiceId]
    );
    if (debtPayments.length > 0) {
        throw new Error(`Không thể ${action} hóa đơn đã có phiếu thu nợ.`);
    }
};

const validateConsultants = async (connection, dbName, consultants, itemFinalPrice, userRole, userBranchId) => {
    if (consultants === undefined || consultants === null) return [];
    if (!Array.isArray(consultants)) throw new Error('consultants phải là một mảng.');

    const normalizedRole = String(userRole).toUpperCase();
    const normalizedConsultants = [];
    let totalRevenueAmount = 0;
    for (const consultant of consultants) {
        const staffId = toNumber(consultant.staff_id, 'consultant.staff_id', { min: 1, integer: true });
        const revenueAmount = toNumber(consultant.revenue_amount ?? 0, 'consultant.revenue_amount', { min: 0 });
        const [staffs] = await connection.query(
            `SELECT id, branch_id FROM \`${dbName}\`.staffs WHERE id = ? AND deleted_at IS NULL`,
            [staffId]
        );
        if (staffs.length === 0) throw new Error(`Nhân viên tư vấn ID ${staffId} không tồn tại.`);
        if (normalizedRole === 'STAFF' && Number(staffs[0].branch_id) !== Number(userBranchId)) {
            throw new Error(`Nhân viên tư vấn ID ${staffId} không thuộc cơ sở của tài khoản STAFF.`);
        }

        totalRevenueAmount += revenueAmount;
        normalizedConsultants.push({
            staff_id: staffId,
            revenue_amount: revenueAmount,
            role_type: consultant.role_type || null
        });
    }

    if (totalRevenueAmount > Number(itemFinalPrice) + 0.000001) {
        throw new Error('Tổng revenue_amount của nhân viên tư vấn không được lớn hơn thành tiền của mặt hàng.');
    }

    return normalizedConsultants;
};

const adjustInventory = async (connection, dbName, branchId, productId, quantityDelta, executorName) => {
    await connection.query(
        `INSERT INTO \`${dbName}\`.inventory (branch_id, product_id, quantity, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             quantity = quantity + VALUES(quantity),
             updated_at = NOW(),
             updated_by = VALUES(updated_by)`,
        [branchId, productId, quantityDelta, executorName, executorName]
    );
};

const treatmentDetails = item => {
    if (item.is_product !== 0 && item.is_treatment_combo !== 1) return;

    const isCombo = item.is_treatment_combo === 1;
    const totalSessions = isCombo ? Number(item.default_sessions) * item.quantity : 1;
    if (totalSessions <= 0) return;

    const unit = String(item.unit ?? '').trim();
    const note = isCombo ? null : `${item.quantity}${unit ? ` ${unit}` : ''}`;
    return { totalSessions, note };
};

const createInvoiceTreatment = async (connection, dbName, customerId, invoiceId, item, executorName, createdAt) => {
    const details = treatmentDetails(item);
    if (!details) return;
    const { totalSessions, note } = details;
    await connection.query(
        `INSERT INTO \`${dbName}\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))`,
        [customerId, item.product_id, invoiceId, totalSessions, totalSessions, note, executorName, createdAt ?? null]
    );
};

const createInvoice = async (tenantId, invoiceData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        let { customer_id, branch_id, discount_percent = 0, discount_amount = 0, paid_amount = 0, wallet_used, payment_method, note, invoice_date, items } = invoiceData;

        // 1. Phân quyền chi nhánh
        if (String(userRole).toUpperCase() !== 'MANAGER') branch_id = userBranchId;
        else if (!branch_id) throw new Error('Quản lý bắt buộc phải truyền branch_id để chọn cơ sở.');

        const branchId = toNumber(branch_id, 'branch_id', { min: 1, integer: true });
        const customerId = toNumber(customer_id, 'customer_id', { min: 1, integer: true });
        const walletUsed = toNumber(wallet_used ?? 0, 'wallet_used', { min: 0 });

        if (String(userRole).toUpperCase() !== 'MANAGER' && branchId !== userBranchId) throw new Error('Bạn không có quyền tạo hóa đơn cho cơ sở khác.');
        if (!Array.isArray(items) || items.length === 0) throw new Error('Hóa đơn phải có ít nhất một sản phẩm/dịch vụ.');

        await connection.beginTransaction();

        // Kiểm tra Khách hàng & Số dư ví
        const [customers] = await connection.query(`SELECT id, wallet_balance FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [customerId]);
        if (customers.length === 0) throw new Error('Khách hàng không tồn tại.');
        
        // 2. Tính tiền Items
        let grossAmount = 0;
        const normalizedItems = [];

        for (const item of items) {
            const productId = toNumber(item.product_id, 'product_id', { min: 1, integer: true });
            const quantity = toNumber(item.quantity, 'quantity', { min: 1, integer: true });
            const itemDiscountPercent = toNumber(item.discount_percent ?? 0, 'discount_percent');
            const itemDiscountAmount = toNumber(item.discount_amount ?? 0, 'discount_amount');

            const [products] = await connection.query(`SELECT name, price, unit, is_product, is_treatment_combo, default_sessions FROM \`${dbName}\`.products WHERE id = ? AND deleted_at IS NULL`, [productId]);
            if (products.length === 0) throw new Error(`Sản phẩm/Dịch vụ ID ${productId} không tồn tại.`);
            const product = products[0];
            const unitPrice = item.unit_price !== undefined
                ? toNumber(item.unit_price, 'unit_price')
                : item.price !== undefined
                    ? toNumber(item.price, 'price')
                    : Number(product.price);

            const itemGross = quantity * unitPrice;
            const itemFinalPrice = itemGross - (itemGross * itemDiscountPercent / 100) - itemDiscountAmount;
            if (itemFinalPrice < 0) throw new Error(`Chiết khấu của '${product.name}' vượt quá thành tiền.`);
            const consultants = await validateConsultants(connection, dbName, item.consultants, itemFinalPrice, userRole, userBranchId);

            grossAmount += itemFinalPrice;

            normalizedItems.push({
                product_id: productId, snapshot_name: product.name, snapshot_price: unitPrice, quantity,
                unit: product.unit, is_product: product.is_product, is_treatment_combo: product.is_treatment_combo, default_sessions: product.default_sessions,
                discount_percent: itemDiscountPercent, discount_amount: itemDiscountAmount, final_price: itemFinalPrice, consultants
            });
        }

        // Tính tổng tiền Header
        const invDiscountPercent = toNumber(discount_percent, 'discount_percent');
        const invDiscountAmount = toNumber(discount_amount, 'discount_amount');
        const totalAmount = grossAmount - (grossAmount * invDiscountPercent / 100) - invDiscountAmount;
        if (totalAmount < 0) throw new Error('Chiết khấu tổng vượt quá giá trị hóa đơn.');

        const paid = toNumber(paid_amount, 'paid_amount', { min: 0 });
        const debtAmount = calculateDebtAmount(totalAmount, paid, walletUsed);
        const customerWallet = Number(customers[0].wallet_balance);
        if (walletUsed > 0 && customerWallet < walletUsed) {
            throw new Error(`Số dư ví (${customerWallet.toLocaleString()}đ) không đủ để trích ${walletUsed.toLocaleString()}đ. Vui lòng thanh toán phần còn thiếu bằng hình thức khác.`);
        }

        const finalPaymentMethod = payment_method || 'Tiền mặt';

        // 3. Insert Database
        const [invResult] = await connection.query(
            `INSERT INTO \`${dbName}\`.invoices (customer_id, branch_id, total_amount, discount_percent, discount_amount, paid_amount, wallet_used, debt_amount, payment_method, note, invoice_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?)`,
            [customerId, branchId, totalAmount, invDiscountPercent, invDiscountAmount, paid, walletUsed, debtAmount, finalPaymentMethod, note || null, invoice_date || null, executorName]
        );
        const invoiceId = invResult.insertId;

        for (const item of normalizedItems) {
            const [itemResult] = await connection.query(
                `INSERT INTO \`${dbName}\`.invoice_items (invoice_id, product_id, snapshot_name, snapshot_price, quantity, discount_percent, discount_amount, final_price, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.product_id, item.snapshot_name, item.snapshot_price, item.quantity, item.discount_percent, item.discount_amount, item.final_price, executorName]
            );
            const invoiceItemId = itemResult.insertId;

            if (item.consultants && item.consultants.length > 0) {
                for (const consultant of item.consultants) {
                    await connection.query(
                        `INSERT INTO \`${dbName}\`.invoice_item_consultants (invoice_item_id, staff_id, revenue_amount, role_type, created_by) VALUES (?, ?, ?, ?, ?)`,
                        [invoiceItemId, consultant.staff_id, consultant.revenue_amount, consultant.role_type, executorName]
                    );
                }
            }

            await createInvoiceTreatment(connection, dbName, customerId, invoiceId, item, executorName);

            if (item.is_product === 1) {
                await adjustInventory(connection, dbName, branchId, item.product_id, -item.quantity, executorName);
            }
        }

        // 4. Trừ Ví và Tăng Công nợ
        if (debtAmount > 0 || walletUsed > 0) {
            await connection.query(
                `UPDATE \`${dbName}\`.customers SET total_debt = total_debt + ?, wallet_balance = wallet_balance - ?, updated_by = ? WHERE id = ?`,
                [debtAmount, walletUsed, executorName, customerId]
            );
        }

        await connection.commit();
        return { invoiceId, totalAmount, debtAmount, walletUsed };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// Avoid selecting i.* alongside a formatted invoice_date: pagination wraps this
// SELECT in a derived table, where MySQL rejects duplicate column names.
const invoiceHeaderColumns = `i.id, i.customer_id, i.branch_id, i.total_amount,
               i.discount_percent, i.discount_amount, i.paid_amount, i.wallet_used,
               i.debt_amount, i.payment_method, i.note,
               DATE_FORMAT(i.invoice_date, '%Y-%m-%d %H:%i:%s') AS invoice_date,
               i.created_at, i.updated_at, i.deleted_at, i.created_by, i.updated_by, i.deleted_by`;

const getInvoices = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT ${invoiceHeaderColumns},
               b.name AS branch_name, c.fullname AS customer_name, c.phone_number
        FROM \`${dbName}\`.invoices i
        INNER JOIN \`${dbName}\`.branches b ON i.branch_id = b.id
        INNER JOIN \`${dbName}\`.customers c ON i.customer_id = c.id
        WHERE i.deleted_at IS NULL
    `;
    const params = [];

    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        query += ' AND i.branch_id = ?'; params.push(userBranchId);
    } else if (filters.branchId !== undefined) {
        query += ' AND i.branch_id = ?'; params.push(toNumber(filters.branchId, 'branchId', { min: 1, integer: true }));
    }

    if (filters.searchKeyword) {
        query += ' AND (c.fullname LIKE ? OR c.phone_number LIKE ?)';
        params.push(`%${filters.searchKeyword}%`, `%${filters.searchKeyword}%`);
    }
    if (filters.startDate) { query += ' AND DATE(i.invoice_date) >= ?'; params.push(filters.startDate); }
    if (filters.endDate) { query += ' AND DATE(i.invoice_date) <= ?'; params.push(filters.endDate); }
    
    if (filters.minAmount !== undefined) { query += ' AND i.total_amount >= ?'; params.push(toNumber(filters.minAmount, 'minAmount', { min: 0 })); }
    if (filters.maxAmount !== undefined) { query += ' AND i.total_amount <= ?'; params.push(toNumber(filters.maxAmount, 'maxAmount', { min: 0 })); }

    if (filters.hasDebt !== undefined && filters.hasDebt !== '') {
        const hasDebt = String(filters.hasDebt).trim().toLowerCase();
        if (['true', '1'].includes(hasDebt)) {
            query += ' AND i.debt_amount > 0';
        } else if (['false', '0'].includes(hasDebt)) {
            query += ' AND i.debt_amount = 0';
        } else {
            throw new Error('hasDebt chỉ nhận true/false hoặc 1/0.');
        }
    }
    
    if (filters.productName) {
        query += ` AND EXISTS (SELECT 1 FROM \`${dbName}\`.invoice_items ii WHERE ii.invoice_id = i.id AND ii.snapshot_name LIKE ? AND ii.deleted_at IS NULL)`;
        params.push(`%${filters.productName}%`);
    }

    const result = await paginateQuery(masterPool, query, params, 'i.invoice_date DESC, i.created_at DESC, i.id DESC', filters);
    
    // Tương thích dữ liệu cũ từng lưu wallet vào payment_method.
    result.data = result.data.map(row => ({
        ...row,
        payment_method: row.payment_method ? row.payment_method.replace(/\s*\[WALLET:\d+\]/, '') : ''
    }));
    return result;
};

const getInvoiceDetail = async (tenantId, invoiceId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT ${invoiceHeaderColumns},
               b.name AS branch_name, c.fullname AS customer_name, c.phone_number
        FROM \`${dbName}\`.invoices i
        INNER JOIN \`${dbName}\`.branches b ON i.branch_id = b.id
        INNER JOIN \`${dbName}\`.customers c ON i.customer_id = c.id
        WHERE i.id = ? AND i.deleted_at IS NULL
    `;
    const params = [invoiceId];

    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) { query += ' AND i.branch_id = ?'; params.push(userBranchId); }

    const [headers] = await masterPool.query(query, params);
    if (headers.length === 0) throw new Error('Hóa đơn không tồn tại hoặc đã bị xóa.');
    const invoice = headers[0];
    invoice.payment_method = invoice.payment_method ? invoice.payment_method.replace(/\s*\[WALLET:\d+\]/, '') : '';

    const [items] = await masterPool.query(`SELECT * FROM \`${dbName}\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL`, [invoiceId]);

    if (items.length > 0) {
        const itemIds = items.map(item => item.id);
        const [consultants] = await masterPool.query(
            `SELECT c.*, s.fullname AS staff_name FROM \`${dbName}\`.invoice_item_consultants c LEFT JOIN \`${dbName}\`.staffs s ON c.staff_id = s.id WHERE c.invoice_item_id IN (?) AND c.deleted_at IS NULL`, [itemIds]
        );
        items.forEach(item => { item.consultants = consultants.filter(c => c.invoice_item_id === item.id); });
    }

    invoice.items = items;
    return invoice;
};

const updateInvoice = async (tenantId, invoiceId, updateData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        await connection.beginTransaction();

        const [headers] = await connection.query(`SELECT * FROM \`${dbName}\`.invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [invoiceId]);
        if (headers.length === 0) throw new Error('Hóa đơn không tồn tại hoặc đã bị xóa.');
        
        const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền sửa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);
        await ensureInvoiceHasNoDebtPayments(connection, dbName, invoiceId, 'sửa');
        const [oldTreatments] = await connection.query(
            `SELECT id, product_id, total_sessions, remaining_sessions, customer_id, note FROM \`${dbName}\`.treatments WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
            [invoiceId]
        );

        const oldWalletUsed = getWalletUsedFromInvoice(oldInvoice);

        // 1. Hoàn trả Công nợ & Ví cho KH cũ
        if (oldInvoice.debt_amount > 0 || oldWalletUsed > 0) {
            await connection.query(
                `UPDATE \`${dbName}\`.customers SET total_debt = total_debt - ?, wallet_balance = wallet_balance + ?, updated_by = ? WHERE id = ?`,
                [oldInvoice.debt_amount, oldWalletUsed, executorName, oldInvoice.customer_id]
            );
        }

        // Thẻ liệu trình được đối chiếu sau khi chuẩn hóa items mới; không xóa hàng loạt.
        const [oldItems] = await connection.query(`SELECT id, product_id, quantity FROM \`${dbName}\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL`, [invoiceId]);
        if (oldItems.length > 0) {
            for (const item of oldItems) {
                const [products] = await connection.query(`SELECT is_product FROM \`${dbName}\`.products WHERE id = ?`, [item.product_id]);
                if (products.length > 0 && products[0].is_product === 1) {
                    await adjustInventory(connection, dbName, oldInvoice.branch_id, item.product_id, item.quantity, executorName);
                }
            }
            await connection.query(`UPDATE \`${dbName}\`.invoice_item_consultants SET deleted_at = NOW(), deleted_by = ? WHERE invoice_item_id IN (?)`, [executorName, oldItems.map(i => i.id)]);
            await connection.query(`UPDATE \`${dbName}\`.invoice_items SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);
        }

        // 2. Tính toán Hóa đơn mới
        const newCustomerId = updateData.customer_id ? toNumber(updateData.customer_id, 'customer_id', { min: 1, integer: true }) : oldInvoice.customer_id;
        const [newCustomers] = await connection.query(`SELECT id, wallet_balance FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [newCustomerId]);
        if (newCustomers.length === 0) throw new Error('Khách hàng mới không tồn tại.');
        
        const newWalletUsed = updateData.wallet_used !== undefined ? toNumber(updateData.wallet_used, 'wallet_used', { min: 0 }) : oldWalletUsed;

        let grossAmount = 0;
        const normalizedItems = [];
        for (const item of updateData.items) {
            const productId = toNumber(item.product_id, 'product_id', { min: 1, integer: true });
            const quantity = toNumber(item.quantity, 'quantity', { min: 1, integer: true });
            const [products] = await connection.query(`SELECT name, price, unit, is_product, is_treatment_combo, default_sessions FROM \`${dbName}\`.products WHERE id = ?`, [productId]);
            if (products.length === 0) throw new Error(`Sản phẩm/Dịch vụ ID ${productId} không tồn tại.`);
            const unitPrice = item.unit_price !== undefined
                ? toNumber(item.unit_price, 'unit_price')
                : item.price !== undefined
                    ? toNumber(item.price, 'price')
                    : Number(products[0].price);
            const itemDiscountPercent = toNumber(item.discount_percent ?? 0, 'discount_percent');
            const itemDiscountAmount = toNumber(item.discount_amount ?? 0, 'discount_amount');
            const itemGross = quantity * unitPrice;
            const itemFinalPrice = itemGross - (itemGross * itemDiscountPercent / 100) - itemDiscountAmount;
            if (itemFinalPrice < 0) throw new Error(`Chiết khấu của '${products[0].name}' vượt quá thành tiền.`);
            const consultants = await validateConsultants(connection, dbName, item.consultants, itemFinalPrice, userRole, userBranchId);
            grossAmount += itemFinalPrice;

            normalizedItems.push({
                product_id: productId, snapshot_name: products[0].name, snapshot_price: unitPrice, quantity,
                unit: products[0].unit, is_product: products[0].is_product, is_treatment_combo: products[0].is_treatment_combo, default_sessions: products[0].default_sessions,
                discount_percent: itemDiscountPercent, discount_amount: itemDiscountAmount, final_price: itemFinalPrice, consultants
            });
        }

        // Ghép thẻ với từng dòng dịch vụ theo product_id và thứ tự cũ. Giữ ID/lịch sử/ngày tạo.
        const availableTreatments = new Map();
        for (const treatment of oldTreatments) {
            const cards = availableTreatments.get(Number(treatment.product_id)) || [];
            cards.push(treatment);
            availableTreatments.set(Number(treatment.product_id), cards);
        }
        const retainedTreatmentIds = new Set();
        const treatmentChanges = [];
        for (const item of normalizedItems) {
            const details = treatmentDetails(item);
            if (!details) continue;
            const oldTreatment = availableTreatments.get(item.product_id)?.shift();
            if (!oldTreatment) {
                treatmentChanges.push({ item });
                continue;
            }
            const usedSessions = Number(oldTreatment.total_sessions) - Number(oldTreatment.remaining_sessions);
            if (details.totalSessions < usedSessions) {
                throw new Error(`Số buổi mới của liệu trình ID ${oldTreatment.id} không được nhỏ hơn ${usedSessions} buổi đã sử dụng.`);
            }
            if (usedSessions > 0 && Number(oldTreatment.customer_id) !== Number(newCustomerId)) {
                throw new Error('Không thể chuyển liệu trình đã sử dụng sang khách hàng khác.');
            }
            retainedTreatmentIds.add(oldTreatment.id);
            treatmentChanges.push({ item, details, oldTreatment, remainingSessions: details.totalSessions - usedSessions });
        }
        for (const treatment of oldTreatments) {
            if (retainedTreatmentIds.has(treatment.id)) continue;
            if (Number(treatment.total_sessions) !== Number(treatment.remaining_sessions)) {
                throw new Error(`Không thể xóa liệu trình ID ${treatment.id} đã được sử dụng.`);
            }
            await connection.query(`UPDATE \`${dbName}\`.treatments SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL`, [executorName, treatment.id]);
        }
        for (const change of treatmentChanges) {
            if (!change.oldTreatment) continue;
            if (Number(change.oldTreatment.customer_id) === Number(newCustomerId) &&
                Number(change.oldTreatment.total_sessions) === change.details.totalSessions &&
                Number(change.oldTreatment.remaining_sessions) === change.remainingSessions &&
                (change.oldTreatment.note ?? null) === change.details.note) continue;
            await connection.query(
                `UPDATE \`${dbName}\`.treatments SET customer_id = ?, total_sessions = ?, remaining_sessions = ?, note = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL`,
                [newCustomerId, change.details.totalSessions, change.remainingSessions, change.details.note, executorName, change.oldTreatment.id]
            );
        }

        const invDiscountPercent = updateData.discount_percent !== undefined ? toNumber(updateData.discount_percent, 'discount_percent') : oldInvoice.discount_percent;
        const invDiscountAmount = updateData.discount_amount !== undefined ? toNumber(updateData.discount_amount, 'discount_amount') : oldInvoice.discount_amount;
        const totalAmount = grossAmount - (grossAmount * invDiscountPercent / 100) - invDiscountAmount;
        if (totalAmount < 0) throw new Error('Chiết khấu tổng vượt quá giá trị hóa đơn.');
        const paid = updateData.paid_amount !== undefined ? toNumber(updateData.paid_amount, 'paid_amount', { min: 0 }) : oldInvoice.paid_amount;
        const debtAmount = calculateDebtAmount(totalAmount, paid, newWalletUsed);
        if (newWalletUsed > 0 && Number(newCustomers[0].wallet_balance) < newWalletUsed) {
            throw new Error(`Số dư ví không đủ để trích ${newWalletUsed.toLocaleString()}đ.`);
        }

        const basePaymentMethod = updateData.payment_method ? updateData.payment_method : (oldInvoice.payment_method ? oldInvoice.payment_method.replace(/\s*\[WALLET:[0-9]+(?:\.[0-9]+)?\]/, '') : 'Tiền mặt');

        // 3. Insert & Update Database
        await connection.query(
            `UPDATE \`${dbName}\`.invoices SET customer_id = ?, total_amount = ?, discount_percent = ?, discount_amount = ?, paid_amount = ?, wallet_used = ?, debt_amount = ?, payment_method = ?, note = ?, invoice_date = COALESCE(?, invoice_date), updated_by = ? WHERE id = ?`,
            [newCustomerId, totalAmount, invDiscountPercent, invDiscountAmount, paid, newWalletUsed, debtAmount, basePaymentMethod, updateData.note || oldInvoice.note, updateData.invoice_date || null, executorName, invoiceId]
        );

        for (const item of normalizedItems) {
            const [itemResult] = await connection.query(
                `INSERT INTO \`${dbName}\`.invoice_items (invoice_id, product_id, snapshot_name, snapshot_price, quantity, discount_percent, discount_amount, final_price, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.product_id, item.snapshot_name, item.snapshot_price, item.quantity, item.discount_percent, item.discount_amount, item.final_price, executorName]
            );
            if (item.consultants.length > 0) {
                for (const c of item.consultants) await connection.query(`INSERT INTO \`${dbName}\`.invoice_item_consultants (invoice_item_id, staff_id, revenue_amount, role_type, created_by) VALUES (?, ?, ?, ?, ?)`, [itemResult.insertId, c.staff_id, c.revenue_amount, c.role_type, executorName]);
            }
            // Chỉ tạo thẻ cho dòng mới; thẻ cũ giữ nguyên id, created_at và lịch sử.
            const change = treatmentChanges.find(c => c.item === item);
            if (change && !change.oldTreatment) {
                await createInvoiceTreatment(connection, dbName, newCustomerId, invoiceId, item, executorName, oldInvoice.created_at);
            }
            if (item.is_product === 1) {
                await adjustInventory(connection, dbName, oldInvoice.branch_id, item.product_id, -item.quantity, executorName);
            }
        }

        if (debtAmount > 0 || newWalletUsed > 0) {
            await connection.query(`UPDATE \`${dbName}\`.customers SET total_debt = total_debt + ?, wallet_balance = wallet_balance - ?, updated_by = ? WHERE id = ?`, [debtAmount, newWalletUsed, executorName, newCustomerId]);
        }

        await connection.commit();
        return { message: 'Cập nhật hóa đơn thành công', totalAmount, debtAmount };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const deleteInvoice = async (tenantId, invoiceId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        await connection.beginTransaction();

        const [headers] = await connection.query(`SELECT * FROM \`${dbName}\`.invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [invoiceId]);
        if (headers.length === 0) throw new Error('Hóa đơn không tồn tại hoặc đã bị xóa.');

        const oldInvoice = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldInvoice.branch_id !== userBranchId) throw new Error('Bạn không có quyền xóa hóa đơn của cơ sở khác.');
        checkPermission(userRole, oldInvoice.created_at);
        await ensureInvoiceHasNoDebtPayments(connection, dbName, invoiceId, 'xóa');
        const [guardTreatments] = await connection.query(
            `SELECT id FROM \`${dbName}\`.treatments WHERE invoice_id = ? AND deleted_at IS NULL`,
            [invoiceId]
        );
        for (const t of guardTreatments) {
            const [histories] = await connection.query(
                `SELECT id FROM \`${dbName}\`.treatment_history WHERE treatment_id = ? AND deleted_at IS NULL LIMIT 1`,
                [t.id]
            );
            if (histories.length > 0) {
                throw new Error('Không thể sửa/xóa hóa đơn vì thẻ liệu trình đã được khách hàng sử dụng (đã trừ buổi). Vui lòng hoàn tác lịch sử sử dụng liệu trình trước.');
            }
        }

        const oldWalletUsed = getWalletUsedFromInvoice(oldInvoice);

        if (oldInvoice.debt_amount > 0 || oldWalletUsed > 0) {
            await connection.query(
                `UPDATE \`${dbName}\`.customers SET total_debt = total_debt - ?, wallet_balance = wallet_balance + ?, updated_by = ? WHERE id = ?`,
                [oldInvoice.debt_amount, oldWalletUsed, executorName, oldInvoice.customer_id]
            );
        }

        await connection.query(`UPDATE \`${dbName}\`.invoices SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`, [executorName, invoiceId]);
        await connection.query(`UPDATE \`${dbName}\`.treatments SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);
        
        const [oldItems] = await connection.query(`SELECT id, product_id, quantity FROM \`${dbName}\`.invoice_items WHERE invoice_id = ? AND deleted_at IS NULL`, [invoiceId]);
        if (oldItems.length > 0) {
            for (const item of oldItems) {
                const [products] = await connection.query(`SELECT is_product FROM \`${dbName}\`.products WHERE id = ?`, [item.product_id]);
                if (products.length > 0 && products[0].is_product === 1) {
                    await adjustInventory(connection, dbName, oldInvoice.branch_id, item.product_id, item.quantity, executorName);
                }
            }
            await connection.query(`UPDATE \`${dbName}\`.invoice_item_consultants SET deleted_at = NOW(), deleted_by = ? WHERE invoice_item_id IN (?)`, [executorName, oldItems.map(i => i.id)]);
            await connection.query(`UPDATE \`${dbName}\`.invoice_items SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);
        }

        await connection.commit();
        return { message: 'Xóa hóa đơn thành công (Đã hoàn trả công nợ, ví tiền và thu hồi liệu trình)' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = { createInvoice, getInvoices, getInvoiceDetail, updateInvoice, deleteInvoice };