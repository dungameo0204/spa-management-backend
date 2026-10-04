const { masterPool, getTenantDbName } = require('../config/database');

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

const createInvoice = async (tenantId, invoiceData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        let { customer_id, branch_id, discount_percent = 0, discount_amount = 0, paid_amount, wallet_used, payment_method, note, invoice_date, items } = invoiceData;

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
        
        const customerWallet = Number(customers[0].wallet_balance);
        if (walletUsed > 0 && customerWallet < walletUsed) {
            throw new Error(`Số dư ví (${customerWallet.toLocaleString()}đ) không đủ để trích ${walletUsed.toLocaleString()}đ. Vui lòng thanh toán phần còn thiếu bằng hình thức khác.`);
        }

        // 2. Tính tiền Items
        let grossAmount = 0;
        const normalizedItems = [];

        for (const item of items) {
            const productId = toNumber(item.product_id, 'product_id', { min: 1, integer: true });
            const quantity = toNumber(item.quantity, 'quantity', { min: 1, integer: true });
            const itemDiscountPercent = toNumber(item.discount_percent ?? 0, 'discount_percent');
            const itemDiscountAmount = toNumber(item.discount_amount ?? 0, 'discount_amount');

            const [products] = await connection.query(`SELECT name, price, is_product, is_treatment_combo, default_sessions FROM \`${dbName}\`.products WHERE id = ? AND deleted_at IS NULL`, [productId]);
            if (products.length === 0) throw new Error(`Sản phẩm/Dịch vụ ID ${productId} không tồn tại.`);
            const product = products[0];

            const itemGross = quantity * Number(product.price);
            const itemFinalPrice = itemGross - (itemGross * itemDiscountPercent / 100) - itemDiscountAmount;
            if (itemFinalPrice < 0) throw new Error(`Chiết khấu của '${product.name}' vượt quá thành tiền.`);

            grossAmount += itemFinalPrice;

            normalizedItems.push({
                product_id: productId, snapshot_name: product.name, snapshot_price: product.price, quantity,
                is_product: product.is_product, is_treatment_combo: product.is_treatment_combo, default_sessions: product.default_sessions,
                discount_percent: itemDiscountPercent, discount_amount: itemDiscountAmount, final_price: itemFinalPrice, consultants: item.consultants || []
            });
        }

        // Tính tổng tiền Header
        const invDiscountPercent = toNumber(discount_percent, 'discount_percent');
        const invDiscountAmount = toNumber(discount_amount, 'discount_amount');
        const totalAmount = grossAmount - (grossAmount * invDiscountPercent / 100) - invDiscountAmount;
        if (totalAmount < 0) throw new Error('Chiết khấu tổng vượt quá giá trị hóa đơn.');

        const paid = toNumber(paid_amount, 'paid_amount', { min: 0 });
        const debtAmount = totalAmount > paid ? totalAmount - paid : 0;

        // Lưu thông tin ví vào payment_method
        let finalPaymentMethod = payment_method || 'Tiền mặt';
        if (walletUsed > 0) finalPaymentMethod += ` [WALLET:${walletUsed}]`;

        // 3. Insert Database
        const [invResult] = await connection.query(
            `INSERT INTO \`${dbName}\`.invoices (customer_id, branch_id, total_amount, discount_percent, discount_amount, paid_amount, debt_amount, payment_method, note, invoice_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?)`,
            [customerId, branchId, totalAmount, invDiscountPercent, invDiscountAmount, paid, debtAmount, finalPaymentMethod, note || null, invoice_date || null, executorName]
        );
        const invoiceId = invResult.insertId;

        for (const item of normalizedItems) {
            const [itemResult] = await connection.query(
                `INSERT INTO \`${dbName}\`.invoice_items (invoice_id, product_id, snapshot_name, snapshot_price, quantity, discount_percent, discount_amount, final_price, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.product_id, item.snapshot_name, item.snapshot_price, item.quantity, item.discount_percent, item.discount_amount, item.final_price, executorName]
            );
            const invoiceItemId = itemResult.insertId;

            // Thêm tư vấn viên (nếu có)
            if (Array.isArray(item.consultants) && item.consultants.length > 0) {
                for (const consultant of item.consultants) {
                    await connection.query(
                        `INSERT INTO \`${dbName}\`.invoice_item_consultants (invoice_item_id, staff_id, revenue_amount, role_type, created_by) VALUES (?, ?, ?, ?, ?)`,
                        [invoiceItemId, consultant.staff_id, consultant.revenue_amount || 0, consultant.role_type || null, executorName]
                    );
                }
            }

            // Sinh liệu trình tự động
            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const totalSessions = item.default_sessions * item.quantity;
                if (totalSessions > 0) {
                    await connection.query(
                        `INSERT INTO \`${dbName}\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                        [customerId, item.product_id, invoiceId, totalSessions, totalSessions, executorName]
                    );
                }
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

const getInvoices = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT i.*, b.name AS branch_name, c.fullname AS customer_name, c.phone_number
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
        query += ' AND (i.note LIKE ? OR c.fullname LIKE ? OR c.phone_number LIKE ?)';
        params.push(`%${filters.searchKeyword}%`, `%${filters.searchKeyword}%`, `%${filters.searchKeyword}%`);
    }
    if (filters.startDate) { query += ' AND DATE(i.invoice_date) >= ?'; params.push(filters.startDate); }
    if (filters.endDate) { query += ' AND DATE(i.invoice_date) <= ?'; params.push(filters.endDate); }
    
    if (filters.minAmount !== undefined) { query += ' AND i.total_amount >= ?'; params.push(toNumber(filters.minAmount, 'minAmount', { min: 0 })); }
    if (filters.maxAmount !== undefined) { query += ' AND i.total_amount <= ?'; params.push(toNumber(filters.maxAmount, 'maxAmount', { min: 0 })); }
    
    if (filters.productName) {
        query += ` AND EXISTS (SELECT 1 FROM \`${dbName}\`.invoice_items ii WHERE ii.invoice_id = i.id AND ii.snapshot_name LIKE ? AND ii.deleted_at IS NULL)`;
        params.push(`%${filters.productName}%`);
    }

    query += ' ORDER BY i.invoice_date DESC, i.created_at DESC';
    const [rows] = await masterPool.query(query, params);
    
    // Format lại chuỗi payment_method để giấu thẻ [WALLET:xxx] khỏi UI Frontend
    return rows.map(row => ({
        ...row,
        payment_method: row.payment_method ? row.payment_method.replace(/\s*\[WALLET:\d+\]/, '') : ''
    }));
};

const getInvoiceDetail = async (tenantId, invoiceId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT i.*, b.name AS branch_name, c.fullname AS customer_name, c.phone_number 
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

        const match = oldInvoice.payment_method ? oldInvoice.payment_method.match(/\[WALLET:(\d+)\]/) : null;
        const oldWalletUsed = match ? Number(match[1]) : 0;

        // 1. Hoàn trả Công nợ & Ví cho KH cũ
        if (oldInvoice.debt_amount > 0 || oldWalletUsed > 0) {
            await connection.query(
                `UPDATE \`${dbName}\`.customers SET total_debt = total_debt - ?, wallet_balance = wallet_balance + ?, updated_by = ? WHERE id = ?`,
                [oldInvoice.debt_amount, oldWalletUsed, executorName, oldInvoice.customer_id]
            );
        }

        // Xóa mềm Items & Treatments
        await connection.query(`UPDATE \`${dbName}\`.treatments SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);
        const [oldItems] = await connection.query(`SELECT id FROM \`${dbName}\`.invoice_items WHERE invoice_id = ?`, [invoiceId]);
        if (oldItems.length > 0) {
            await connection.query(`UPDATE \`${dbName}\`.invoice_item_consultants SET deleted_at = NOW(), deleted_by = ? WHERE invoice_item_id IN (?)`, [executorName, oldItems.map(i => i.id)]);
            await connection.query(`UPDATE \`${dbName}\`.invoice_items SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);
        }

        // 2. Tính toán Hóa đơn mới
        const newCustomerId = updateData.customer_id ? toNumber(updateData.customer_id, 'customer_id', { min: 1, integer: true }) : oldInvoice.customer_id;
        const [newCustomers] = await connection.query(`SELECT id, wallet_balance FROM \`${dbName}\`.customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [newCustomerId]);
        if (newCustomers.length === 0) throw new Error('Khách hàng mới không tồn tại.');
        
        const newWalletUsed = updateData.wallet_used !== undefined ? toNumber(updateData.wallet_used, 'wallet_used', { min: 0 }) : oldWalletUsed;
        if (newWalletUsed > 0 && Number(newCustomers[0].wallet_balance) < newWalletUsed) {
            throw new Error(`Số dư ví không đủ để trích ${newWalletUsed.toLocaleString()}đ.`);
        }

        let grossAmount = 0;
        const normalizedItems = [];
        for (const item of updateData.items) {
            const productId = toNumber(item.product_id, 'product_id', { min: 1, integer: true });
            const quantity = toNumber(item.quantity, 'quantity', { min: 1, integer: true });
            const [products] = await connection.query(`SELECT name, price, is_product, is_treatment_combo, default_sessions FROM \`${dbName}\`.products WHERE id = ?`, [productId]);
            const itemFinalPrice = (quantity * Number(products[0].price)) - (quantity * Number(products[0].price) * toNumber(item.discount_percent ?? 0) / 100) - toNumber(item.discount_amount ?? 0);
            grossAmount += itemFinalPrice;

            normalizedItems.push({
                product_id: productId, snapshot_name: products[0].name, snapshot_price: products[0].price, quantity,
                is_product: products[0].is_product, is_treatment_combo: products[0].is_treatment_combo, default_sessions: products[0].default_sessions,
                discount_percent: item.discount_percent ?? 0, discount_amount: item.discount_amount ?? 0, final_price: itemFinalPrice, consultants: item.consultants || []
            });
        }

        const invDiscountPercent = updateData.discount_percent !== undefined ? toNumber(updateData.discount_percent, 'discount_percent') : oldInvoice.discount_percent;
        const invDiscountAmount = updateData.discount_amount !== undefined ? toNumber(updateData.discount_amount, 'discount_amount') : oldInvoice.discount_amount;
        const totalAmount = grossAmount - (grossAmount * invDiscountPercent / 100) - invDiscountAmount;
        const paid = updateData.paid_amount !== undefined ? toNumber(updateData.paid_amount, 'paid_amount', { min: 0 }) : oldInvoice.paid_amount;
        const debtAmount = totalAmount > paid ? totalAmount - paid : 0;

        let basePaymentMethod = updateData.payment_method ? updateData.payment_method : (oldInvoice.payment_method ? oldInvoice.payment_method.replace(/\s*\[WALLET:\d+\]/, '') : 'Tiền mặt');
        if (newWalletUsed > 0) basePaymentMethod += ` [WALLET:${newWalletUsed}]`;

        // 3. Insert & Update Database
        await connection.query(
            `UPDATE \`${dbName}\`.invoices SET customer_id = ?, total_amount = ?, discount_percent = ?, discount_amount = ?, paid_amount = ?, debt_amount = ?, payment_method = ?, note = ?, invoice_date = COALESCE(?, invoice_date), updated_by = ? WHERE id = ?`,
            [newCustomerId, totalAmount, invDiscountPercent, invDiscountAmount, paid, debtAmount, basePaymentMethod, updateData.note || oldInvoice.note, updateData.invoice_date || null, executorName, invoiceId]
        );

        for (const item of normalizedItems) {
            const [itemResult] = await connection.query(
                `INSERT INTO \`${dbName}\`.invoice_items (invoice_id, product_id, snapshot_name, snapshot_price, quantity, discount_percent, discount_amount, final_price, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.product_id, item.snapshot_name, item.snapshot_price, item.quantity, item.discount_percent, item.discount_amount, item.final_price, executorName]
            );
            if (item.consultants.length > 0) {
                for (const c of item.consultants) await connection.query(`INSERT INTO \`${dbName}\`.invoice_item_consultants (invoice_item_id, staff_id, revenue_amount, role_type, created_by) VALUES (?, ?, ?, ?, ?)`, [itemResult.insertId, c.staff_id, c.revenue_amount || 0, c.role_type || null, executorName]);
            }
            if (item.is_product === 0 || item.is_treatment_combo === 1) {
                const ts = item.default_sessions * item.quantity;
                if (ts > 0) await connection.query(`INSERT INTO \`${dbName}\`.treatments (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, created_by) VALUES (?, ?, ?, ?, ?, ?)`, [newCustomerId, item.product_id, invoiceId, ts, ts, executorName]);
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

        const match = oldInvoice.payment_method ? oldInvoice.payment_method.match(/\[WALLET:(\d+)\]/) : null;
        const oldWalletUsed = match ? Number(match[1]) : 0;

        if (oldInvoice.debt_amount > 0 || oldWalletUsed > 0) {
            await connection.query(
                `UPDATE \`${dbName}\`.customers SET total_debt = total_debt - ?, wallet_balance = wallet_balance + ?, updated_by = ? WHERE id = ?`,
                [oldInvoice.debt_amount, oldWalletUsed, executorName, oldInvoice.customer_id]
            );
        }

        await connection.query(`UPDATE \`${dbName}\`.invoices SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`, [executorName, invoiceId]);
        await connection.query(`UPDATE \`${dbName}\`.treatments SET deleted_at = NOW(), deleted_by = ? WHERE invoice_id = ?`, [executorName, invoiceId]);
        
        const [oldItems] = await connection.query(`SELECT id FROM \`${dbName}\`.invoice_items WHERE invoice_id = ?`, [invoiceId]);
        if (oldItems.length > 0) {
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