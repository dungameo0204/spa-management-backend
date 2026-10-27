const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');
const { assertStaffDateFieldsAbsent } = require('../utils/staffDatePolicy');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

// Hàm hỗ trợ kiểm tra quyền hạn sửa/xóa theo thời gian
const checkPermission = (userRole, importDate) => {
    const today = new Date();
    const createdDate = new Date(importDate);
    
    // Đưa về cùng mốc đầu ngày để so sánh chuẩn xác
    today.setHours(0, 0, 0, 0);
    createdDate.setHours(0, 0, 0, 0);

    if (String(userRole).toUpperCase() !== 'MANAGER' && createdDate.getTime() < today.getTime()) {
        throw new Error('Nhân viên chỉ được phép sửa/xóa phiếu nhập kho được tạo trong ngày hôm nay.');
    }
};

const createInventoryImport = async (tenantId, importData, executorName, userRole, userBranchId) => {
    assertStaffDateFieldsAbsent(userRole, importData, 'import_date');
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        let { branch_id, import_code, import_date, supplier_name, note, items } = importData;

        if (String(userRole).toUpperCase() !== 'MANAGER') {
            branch_id = userBranchId;
        } else if (!branch_id) {
            // MANAGER thì bắt buộc phải truyền để biết đang nhập cho kho nào
            throw new Error('Quản lý bắt buộc phải truyền branch_id để chọn cơ sở nhập kho.');
        }
        
        const branchId = toNumber(branch_id, 'branch_id', { min: 1, integer: true });
        
        // Phân quyền Staff
        if (String(userRole).toUpperCase() !== 'MANAGER' && branchId !== userBranchId) {
            throw new Error('Bạn không có quyền nhập kho cho cơ sở khác.');
        }

        if (!import_code || !String(import_code).trim()) throw new Error('import_code không được để trống.');
        if (!Array.isArray(items) || items.length === 0) throw new Error('items phải là mảng có ít nhất một sản phẩm.');

        await connection.beginTransaction();

        const [branches] = await connection.query(
            `SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`,
            [branchId]
        );
        if (branches.length === 0) throw new Error('Chi nhánh không tồn tại hoặc đã bị xóa.');

        const [duplicateImport] = await connection.query(
            `SELECT id FROM \`${dbName}\`.inventory_imports WHERE import_code = ?`,
            [String(import_code).trim()]
        );
        if (duplicateImport.length > 0) throw new Error('Mã phiếu nhập đã tồn tại.');

        const productIds = new Set();
        const normalizedItems = [];
        let totalAmount = 0;

        for (const item of items) {
            const productId = toNumber(item.product_id, 'product_id', { min: 1, integer: true });
            const quantity = toNumber(item.quantity, 'quantity', { min: 1, integer: true });
            const unitPrice = toNumber(item.unit_price, 'unit_price');
            const discountPercent = toNumber(item.discount_percent ?? 0, 'discount_percent');
            const discountAmount = toNumber(item.discount_amount ?? 0, 'discount_amount');
            
            if (discountPercent > 100) throw new Error('discount_percent không được lớn hơn 100.');
            if (productIds.has(productId)) throw new Error('Không được nhập trùng product_id trong cùng một phiếu.');
            productIds.add(productId);

            const [products] = await connection.query(
                `SELECT id, name FROM \`${dbName}\`.products WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
                [productId]
            );
            if (products.length === 0) throw new Error(`Sản phẩm có ID ${productId} không tồn tại hoặc đã bị xóa.`);

            const grossAmount = quantity * unitPrice;
            const totalPrice = Number((grossAmount - (grossAmount * discountPercent / 100) - discountAmount).toFixed(2));
            if (totalPrice < 0) throw new Error(`Chiết khấu của sản phẩm '${products[0].name}' vượt quá thành tiền.`);
            totalAmount += totalPrice;

            normalizedItems.push({
                productId,
                productName: products[0].name,
                quantity,
                unitPrice,
                discountPercent,
                discountAmount,
                totalPrice
            });
        }

        const [headerResult] = await connection.query(
            `INSERT INTO \`${dbName}\`.inventory_imports
                (branch_id, import_code, import_date, supplier_name, total_amount, note, created_by)
             VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?, ?)`,
            [branchId, String(import_code).trim(), import_date || null, supplier_name || null, Number(totalAmount.toFixed(2)), note || null, executorName]
        );
        const inventoryImportId = headerResult.insertId;

        for (const item of normalizedItems) {
            await connection.query(
                `INSERT INTO \`${dbName}\`.inventory_import_items
                    (inventory_import_id, product_id, product_name, quantity, unit_price, discount_percent,
                     discount_amount, total_price, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    inventoryImportId, item.productId, item.productName, item.quantity, item.unitPrice,
                    item.discountPercent, item.discountAmount, item.totalPrice, executorName
                ]
            );

            await connection.query(
                `INSERT INTO \`${dbName}\`.inventory (branch_id, product_id, quantity, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), updated_by = VALUES(updated_by)`,
                [branchId, item.productId, item.quantity, executorName, executorName]
            );
        }

        await connection.commit();
        return { inventoryImportId, totalAmount: Number(totalAmount.toFixed(2)) };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getInventoryImports = async (tenantId, searchKeyword = '', branchId, startDate, endDate, userRole, userBranchId, pagination) => {
    const dbName = await getTenantDbName(tenantId);
    
    // 1. LẤY DANH SÁCH PHIẾU NHẬP (HEADER)
    let query = `
        SELECT ii.*, b.name AS branch_name
        FROM \`${dbName}\`.inventory_imports ii
        INNER JOIN \`${dbName}\`.branches b ON b.id = ii.branch_id
        WHERE ii.deleted_at IS NULL
    `;
    const params = [];

    // Phân quyền Staff
    if (String(userRole).toUpperCase() !== 'MANAGER') {
        query += ' AND ii.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    } else if (branchId !== undefined) {
        query += ' AND ii.branch_id = ?';
        params.push(toNumber(branchId, 'branchId', { min: 1, integer: true }));
    }

    if (searchKeyword) {
        query += ' AND (ii.import_code LIKE ? OR ii.supplier_name LIKE ?)';
        params.push(`%${searchKeyword}%`, `%${searchKeyword}%`);
    }

    if (startDate) {
        query += ' AND DATE(ii.import_date) >= ?';
        params.push(startDate);
    }
    if (endDate) {
        query += ' AND DATE(ii.import_date) <= ?';
        params.push(endDate);
    }

    const result = await paginateQuery(masterPool, query, params, 'ii.import_date DESC, ii.created_at DESC, ii.id DESC', pagination);
    const imports = result.data;

    // Nếu không có phiếu nhập nào thì trả về mảng rỗng luôn, không cần query items
    if (imports.length === 0) return result;

    // 2. LẤY TOÀN BỘ SẢN PHẨM (ITEMS) CỦA CÁC PHIẾU NHẬP Ở TRÊN
    const importIds = imports.map(imp => imp.id);

    const [allItems] = await masterPool.query(
        `SELECT id, inventory_import_id, product_id, product_name, quantity, unit_price,
                discount_percent, discount_amount, total_price
         FROM \`${dbName}\`.inventory_import_items
         WHERE inventory_import_id IN (?) AND deleted_at IS NULL
         ORDER BY id ASC`,
        [importIds]
    );

    // 3. MAPPING ĐỂ GỘP MẢNG ITEMS VÀO TỪNG PHIẾU NHẬP
    result.data = imports.map(imp => ({
        ...imp,
        items: allItems.filter(item => item.inventory_import_id === imp.id)
    }));
    return result;
};

const getInventoryImportDetail = async (tenantId, inventoryImportId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const id = toNumber(inventoryImportId, 'inventoryImportId', { min: 1, integer: true });
    let query = `SELECT ii.*, b.name AS branch_name
        FROM \`${dbName}\`.inventory_imports ii
        INNER JOIN \`${dbName}\`.branches b ON b.id = ii.branch_id
        WHERE ii.id = ? AND ii.deleted_at IS NULL`;
    const params = [id];
    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        query += ' AND ii.branch_id = ?';
        params.push(userBranchId);
    }
    const [imports] = await masterPool.query(query, params);
    if (imports.length === 0) throw new Error('Phiếu nhập kho không tồn tại, đã bị xóa hoặc bạn không có quyền xem.');

    const [items] = await masterPool.query(
        `SELECT id, inventory_import_id, product_id, product_name, quantity, unit_price,
                discount_percent, discount_amount, total_price
         FROM \`${dbName}\`.inventory_import_items
         WHERE inventory_import_id = ? AND deleted_at IS NULL ORDER BY id ASC`,
        [id]
    );
    return { ...imports[0], items };
};

const updateInventoryImport = async (tenantId, inventoryImportId, updateData, executorName, userRole, userBranchId) => {
    assertStaffDateFieldsAbsent(userRole, updateData, 'import_date');
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Kiểm tra phiếu tồn tại & Phân quyền
        const [headers] = await connection.query(
            `SELECT * FROM \`${dbName}\`.inventory_imports WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
            [inventoryImportId]
        );
        if (headers.length === 0) throw new Error('Phiếu nhập kho không tồn tại hoặc đã bị xóa.');
        
        const oldImport = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldImport.branch_id !== userBranchId) {
            throw new Error('Bạn không có quyền sửa phiếu nhập kho của cơ sở khác.');
        }

        // Kiểm tra quyền theo thời gian (Staff chỉ sửa trong ngày)
        checkPermission(userRole, oldImport.created_at);

        // Lấy danh sách item cũ để tính chênh lệch
        const [oldItems] = await connection.query(
            `SELECT product_id, quantity FROM \`${dbName}\`.inventory_import_items WHERE inventory_import_id = ? AND deleted_at IS NULL`,
            [inventoryImportId]
        );

        const { import_code, import_date, supplier_name, note, items } = updateData;
        if (!Array.isArray(items) || items.length === 0) throw new Error('items phải là mảng có ít nhất một sản phẩm.');

        let totalAmount = 0;
        const normalizedItems = [];
        const newProductMap = new Map();

        // Validate items mới
        for (const item of items) {
            const productId = toNumber(item.product_id, 'product_id', { min: 1, integer: true });
            const quantity = toNumber(item.quantity, 'quantity', { min: 1, integer: true });
            const unitPrice = toNumber(item.unit_price, 'unit_price');
            const discountPercent = toNumber(item.discount_percent ?? 0, 'discount_percent');
            const discountAmount = toNumber(item.discount_amount ?? 0, 'discount_amount');

            if (newProductMap.has(productId)) throw new Error('Không được nhập trùng product_id trong cùng một phiếu.');
            
            const grossAmount = quantity * unitPrice;
            const totalPrice = Number((grossAmount - (grossAmount * discountPercent / 100) - discountAmount).toFixed(2));
            if (totalPrice < 0) throw new Error(`Chiết khấu vượt quá thành tiền.`);
            totalAmount += totalPrice;

            newProductMap.set(productId, quantity);
            normalizedItems.push({ productId, quantity, unitPrice, discountPercent, discountAmount, totalPrice });
        }

        // 2. Cập nhật thông tin Header
        const updateFields = [];
        const updateParams = [];
        
        if (import_code !== undefined) {
            const codeStr = String(import_code).trim();
            if (!codeStr) throw new Error('import_code không được để trống.');
            const [dup] = await connection.query(
                `SELECT id FROM \`${dbName}\`.inventory_imports WHERE import_code = ? AND id != ?`,
                [codeStr, inventoryImportId]
            );
            if (dup.length > 0) throw new Error('Mã phiếu nhập đã tồn tại.');
            updateFields.push('import_code = ?');
            updateParams.push(codeStr);
        }
        
        if (import_date !== undefined) { updateFields.push('import_date = ?'); updateParams.push(import_date); }
        if (supplier_name !== undefined) { updateFields.push('supplier_name = ?'); updateParams.push(supplier_name); }
        if (note !== undefined) { updateFields.push('note = ?'); updateParams.push(note); }
        
        updateFields.push('total_amount = ?', 'updated_by = ?');
        updateParams.push(Number(totalAmount.toFixed(2)), executorName, inventoryImportId);

        if (updateFields.length > 0) {
            await connection.query(
                `UPDATE \`${dbName}\`.inventory_imports SET ${updateFields.join(', ')} WHERE id = ?`,
                updateParams
            );
        }

        // 3. Xử lý tồn kho (HOÀN TRẢ LẠI KHO CŨ TRƯỚC)
        for (const oldItem of oldItems) {
            await connection.query(
                `UPDATE \`${dbName}\`.inventory SET quantity = quantity - ?, updated_by = ? WHERE branch_id = ? AND product_id = ?`,
                [oldItem.quantity, executorName, oldImport.branch_id, oldItem.product_id]
            );
        }

        // 4. Xóa mềm các item cũ
        await connection.query(
            `UPDATE \`${dbName}\`.inventory_import_items SET deleted_at = NOW(), deleted_by = ? WHERE inventory_import_id = ?`,
            [executorName, inventoryImportId]
        );

        // 5. Thêm item mới & CỘNG LẠI KHO MỚI
        for (const item of normalizedItems) {
            const [products] = await connection.query(`SELECT name FROM \`${dbName}\`.products WHERE id = ?`, [item.productId]);
            const productName = products[0] ? products[0].name : 'Unknown Product';

            await connection.query(
                `INSERT INTO \`${dbName}\`.inventory_import_items
                    (inventory_import_id, product_id, product_name, quantity, unit_price, discount_percent, discount_amount, total_price, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [inventoryImportId, item.productId, productName, item.quantity, item.unitPrice, item.discountPercent, item.discountAmount, item.totalPrice, executorName]
            );

            await connection.query(
                `INSERT INTO \`${dbName}\`.inventory (branch_id, product_id, quantity, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), updated_by = VALUES(updated_by)`,
                [oldImport.branch_id, item.productId, item.quantity, executorName, executorName]
            );
        }

        await connection.commit();
        return { message: 'Cập nhật phiếu nhập kho thành công', totalAmount };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const deleteInventoryImport = async (tenantId, inventoryImportId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        await connection.beginTransaction();

        const [headers] = await connection.query(
            `SELECT * FROM \`${dbName}\`.inventory_imports WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
            [inventoryImportId]
        );
        if (headers.length === 0) throw new Error('Phiếu nhập kho không tồn tại hoặc đã bị xóa.');

        const oldImport = headers[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && oldImport.branch_id !== userBranchId) {
            throw new Error('Bạn không có quyền xóa phiếu nhập kho của cơ sở khác.');
        }

        // Kiểm tra quyền theo thời gian (Staff chỉ xóa trong ngày)
        checkPermission(userRole, oldImport.created_at);

        // 1. Lấy danh sách item để trừ kho
        const [oldItems] = await connection.query(
            `SELECT product_id, quantity FROM \`${dbName}\`.inventory_import_items WHERE inventory_import_id = ? AND deleted_at IS NULL`,
            [inventoryImportId]
        );

        // 2. Trừ lại số lượng tồn kho (Khôi phục lại như chưa từng nhập)
        for (const oldItem of oldItems) {
            await connection.query(
                `UPDATE \`${dbName}\`.inventory SET quantity = quantity - ?, updated_by = ? WHERE branch_id = ? AND product_id = ?`,
                [oldItem.quantity, executorName, oldImport.branch_id, oldItem.product_id]
            );
        }

        // 3. Xóa mềm phiếu và các items
        await connection.query(
            `UPDATE \`${dbName}\`.inventory_imports SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`,
            [executorName, inventoryImportId]
        );
        
        await connection.query(
            `UPDATE \`${dbName}\`.inventory_import_items SET deleted_at = NOW(), deleted_by = ? WHERE inventory_import_id = ?`,
            [executorName, inventoryImportId]
        );

        await connection.commit();
        return { message: 'Xóa phiếu nhập kho và trừ kho thành công' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = { 
    createInventoryImport, 
    getInventoryImports, 
    getInventoryImportDetail,
    updateInventoryImport,
    deleteInventoryImport
};