const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const toBooleanNumber = (value, fieldName) => {
    if (typeof value === 'boolean') return Number(value);
    if ([0, 1, '0', '1'].includes(value)) return Number(value);
    throw new Error(`${fieldName} phải là true/false hoặc 0/1.`);
};

const validateCommissions = async (connection, dbName, commissions) => {
    if (!Array.isArray(commissions)) {
        throw new Error('commissions phải là một mảng.');
    }

    const roleIds = new Set();
    for (const commission of commissions) {
        const roleId = toNumber(commission.role_id, 'role_id', { min: 1, integer: true });
        const percent = toNumber(commission.commission_percent ?? 0, 'commission_percent');
        const fixedAmount = toNumber(commission.commission_fixed_amount ?? 0, 'commission_fixed_amount');

        if (percent > 100) throw new Error('commission_percent không được lớn hơn 100.');
        if (roleIds.has(roleId)) throw new Error('Không được khai báo trùng role_id trong commissions.');
        roleIds.add(roleId);

        const [roles] = await connection.query(
            `SELECT id FROM \`${dbName}\`.roles WHERE id = ? AND deleted_at IS NULL`,
            [roleId]
        );
        if (roles.length === 0) throw new Error(`Chức vụ có ID ${roleId} không tồn tại hoặc đã bị xóa.`);
    }
};

const validateInitialInventory = async (connection, dbName, inventories) => {
    if (!Array.isArray(inventories)) {
        throw new Error('inventory phải là một mảng.');
    }

    const branchIds = new Set();
    for (const inventory of inventories) {
        const branchId = toNumber(inventory.branch_id, 'branch_id', { min: 1, integer: true });
        toNumber(inventory.quantity, 'quantity', { min: 0, integer: true });

        if (branchIds.has(branchId)) throw new Error('Không được khai báo trùng branch_id trong inventory.');
        branchIds.add(branchId);

        const [branches] = await connection.query(
            `SELECT id FROM \`${dbName}\`.branches WHERE id = ? AND deleted_at IS NULL`,
            [branchId]
        );
        if (branches.length === 0) throw new Error(`Chi nhánh có ID ${branchId} không tồn tại hoặc đã bị xóa.`);
    }
};

const insertOrUpdateCommissions = async (connection, dbName, productId, commissions, executorName) => {
    for (const commission of commissions) {
        const roleId = Number(commission.role_id);
        const percent = Number(commission.commission_percent ?? 0);
        const fixedAmount = Number(commission.commission_fixed_amount ?? 0);

        await connection.query(
            `INSERT INTO \`${dbName}\`.product_commissions
                (product_id, role_id, commission_percent, commission_fixed_amount, created_by, updated_by, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE
                commission_percent = VALUES(commission_percent),
                commission_fixed_amount = VALUES(commission_fixed_amount),
                updated_by = VALUES(updated_by),
                deleted_at = NULL,
                deleted_by = NULL`,
            [productId, roleId, percent, fixedAmount, executorName, executorName]
        );
    }
};

const syncCommissions = async (connection, dbName, productId, commissions, executorName) => {
    if (commissions.length === 0) {
        await connection.query(
            `UPDATE \`${dbName}\`.product_commissions
             SET deleted_at = NOW(), deleted_by = ?, updated_by = ?
             WHERE product_id = ? AND deleted_at IS NULL`,
            [executorName, executorName, productId]
        );
        return;
    }

    const roleIds = commissions.map(item => Number(item.role_id));
    await connection.query(
        `UPDATE \`${dbName}\`.product_commissions
         SET deleted_at = NOW(), deleted_by = ?, updated_by = ?
         WHERE product_id = ? AND deleted_at IS NULL AND role_id NOT IN (?)`,
        [executorName, executorName, productId, roleIds]
    );

    await insertOrUpdateCommissions(connection, dbName, productId, commissions, executorName);
};

const guardCommissionWrite = (data, role) => {
    if ((Object.prototype.hasOwnProperty.call(data, 'commissions') || Object.prototype.hasOwnProperty.call(data, 'commission_tiers')) && String(role).toUpperCase() !== 'MANAGER') {
        const error = new Error('Chỉ MANAGER được thay đổi product_commissions.');
        error.status = 403;
        throw error;
    }
};

const syncCommissionTiers = async (connection, dbName, productId, tiers, executorName) => {
    if (!Array.isArray(tiers)) throw new Error('commission_tiers phải là mảng.');
    const byRole = new Map();
    for (const tier of tiers) {
        const roleId = toNumber(tier.role_id, 'role_id', { min: 1, integer: true });
        if (tier.min_price == null || tier.min_price === '') throw new Error('min_price bắt buộc.');
        const min = toNumber(tier.min_price, 'min_price');
        const max = tier.max_price == null ? null : toNumber(tier.max_price, 'max_price');
        if (max !== null && max <= min) throw new Error('max_price phải lớn hơn min_price.');
        if (!['FIXED', 'PERCENT'].includes(tier.calculation_type)) throw new Error('calculation_type phải là FIXED hoặc PERCENT.');
        if (tier.calculation_type === 'FIXED' && (tier.fixed_amount == null || tier.fixed_amount === '')) throw new Error('fixed_amount bắt buộc.');
        if (tier.calculation_type === 'PERCENT' && (tier.percent == null || tier.percent === '')) throw new Error('percent bắt buộc.');
        const fixed = tier.calculation_type === 'FIXED' ? toNumber(tier.fixed_amount, 'fixed_amount') : 0;
        const percent = tier.calculation_type === 'PERCENT' ? toNumber(tier.percent, 'percent') : 0;
        if (percent > 100) throw new Error('percent không được lớn hơn 100.');
        if (!byRole.has(roleId)) byRole.set(roleId, []);
        byRole.get(roleId).push({ roleId, min, max, type: tier.calculation_type, fixed, percent });
    }
    for (const [roleId, rows] of byRole) {
        const [roles] = await connection.query(`SELECT id FROM \`${dbName}\`.roles WHERE id = ? AND deleted_at IS NULL`, [roleId]);
        if (!roles.length) throw new Error(`Chức vụ ID ${roleId} không tồn tại.`);
        rows.sort((a, b) => a.min - b.min);
        for (let i = 1; i < rows.length; i++) {
            if (rows[i - 1].max === null || rows[i].min < rows[i - 1].max) throw new Error('Các bậc công không được chồng lấn.');
        }
    }
    await connection.query(`DELETE FROM \`${dbName}\`.product_commission_tiers WHERE product_id = ?`, [productId]);
    for (const rows of byRole.values()) for (const tier of rows) {
        await connection.query(
            `INSERT INTO \`${dbName}\`.product_commission_tiers (product_id, role_id, min_price, max_price, calculation_type, fixed_amount, percent, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [productId, tier.roleId, tier.min, tier.max, tier.type, tier.fixed, tier.percent, executorName]
        );
    }
};

const createProduct = async (tenantId, productData, executorName, userRole) => {
    guardCommissionWrite(productData, userRole);
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        const {
            name, images, description, benefits, price, sale_price, unit, is_product,
            is_treatment_combo = false, default_sessions = 1, session_unit = 'buổi',
            next_appointment_days = 0, commissions, inventory
        } = productData;

        if (!name || !String(name).trim()) throw new Error('Tên sản phẩm/dịch vụ không được để trống.');
        if (price === null || price === '') throw new Error('price không hợp lệ.');
        const listedPrice = toNumber(price, 'price');
        if (sale_price === undefined || sale_price === null || sale_price === '') throw new Error('sale_price không hợp lệ.');
        const sellingPrice = toNumber(sale_price, 'sale_price');
        if (sellingPrice > listedPrice) throw new Error('sale_price không được lớn hơn price.');
        toBooleanNumber(is_product, 'is_product');
        toNumber(default_sessions, 'default_sessions', { min: 0, integer: true });
        toNumber(next_appointment_days, 'next_appointment_days', { min: 0, integer: true });

        if (images !== undefined && images !== null && !Array.isArray(images)) {
            throw new Error('images phải là một mảng JSON hoặc null.');
        }
        if (commissions !== undefined && commissions !== null && !Array.isArray(commissions)) {
            throw new Error('commissions phải là một mảng, null hoặc không gửi field này.');
        }
        if (inventory !== undefined && inventory !== null && !Array.isArray(inventory)) {
            throw new Error('inventory phải là một mảng, null hoặc không gửi field này.');
        }

        await connection.beginTransaction();
        if (Array.isArray(commissions) && commissions.length > 0) {
            await validateCommissions(connection, dbName, commissions);
        }
        if (Array.isArray(inventory) && inventory.length > 0) {
            await validateInitialInventory(connection, dbName, inventory);
        }

        const [existing] = await connection.query(
            `SELECT id FROM \`${dbName}\`.products WHERE name = ? AND deleted_at IS NULL`,
            [String(name).trim()]
        );
        if (existing.length > 0) throw new Error('Tên sản phẩm/dịch vụ này đã tồn tại.');

        const [result] = await connection.query(
            `INSERT INTO \`${dbName}\`.products
                (name, images, description, benefits, price, sale_price, unit, is_product, is_treatment_combo,
                 default_sessions, session_unit, next_appointment_days, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(name).trim(), images === undefined || images === null ? null : JSON.stringify(images),
                description || null, benefits || null, listedPrice, sellingPrice, unit || null,
                toBooleanNumber(is_product, 'is_product'), toBooleanNumber(is_treatment_combo, 'is_treatment_combo'), Number(default_sessions),
                session_unit || 'buổi', Number(next_appointment_days), executorName
            ]
        );
        const productId = result.insertId;

        if (Array.isArray(commissions)) {
            await insertOrUpdateCommissions(connection, dbName, productId, commissions, executorName);
        }
        if (productData.commission_tiers !== undefined) {
            await syncCommissionTiers(connection, dbName, productId, productData.commission_tiers, executorName);
        }

        if (Array.isArray(inventory)) {
            for (const item of inventory) {
                await connection.query(
                    `INSERT INTO \`${dbName}\`.inventory (branch_id, product_id, quantity, created_by, updated_by)
                     VALUES (?, ?, ?, ?, ?)`,
                    [Number(item.branch_id), productId, Number(item.quantity), executorName, executorName]
                );
            }
        }

        await connection.commit();
        return productId;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getProducts = async (tenantId, searchKeyword = '', isProduct, userRole, userBranchId, pagination) => {
    const dbName = await getTenantDbName(tenantId);
    
    // Tuyệt đối không query cột is_active nữa
    let query = `SELECT * FROM \`${dbName}\`.products WHERE deleted_at IS NULL`;
    const params = [];

    if (searchKeyword) {
        // Tìm kiếm không phân biệt hoa/thường một cách triệt để
        query += ' AND LOWER(name) LIKE LOWER(?)';
        params.push(`%${searchKeyword}%`);
    }
    if (isProduct !== undefined) {
        query += ' AND is_product = ?';
        params.push(Number(isProduct));
    }
    const result = await paginateQuery(masterPool, query, params, 'created_at DESC, id DESC', pagination);
    const products = result.data;
    if (products.length === 0) return result;

    const productIds = products.map(product => product.id);

    // 1. Lấy thông tin hoa hồng
    const [commissions] = await masterPool.query(
        `SELECT pc.id, pc.product_id, pc.role_id, pc.commission_percent, pc.commission_fixed_amount,
                r.name AS role_name
         FROM \`${dbName}\`.product_commissions pc
         INNER JOIN \`${dbName}\`.roles r ON r.id = pc.role_id
         WHERE pc.product_id IN (?) AND pc.deleted_at IS NULL
         ORDER BY pc.id ASC`,
        [productIds]
    );
    const [tiers] = await masterPool.query(
        `SELECT pct.*, r.name AS role_name FROM \`${dbName}\`.product_commission_tiers pct
         JOIN \`${dbName}\`.roles r ON r.id = pct.role_id WHERE pct.product_id IN (?) ORDER BY pct.role_id, pct.min_price`, [productIds]
    );

    // 2. Lấy thông tin tồn kho
    let inventoryQuery = `
        SELECT i.id, i.product_id, i.branch_id, i.quantity, b.name AS branch_name
        FROM \`${dbName}\`.inventory i
        INNER JOIN \`${dbName}\`.branches b ON b.id = i.branch_id
        WHERE i.product_id IN (?) AND b.deleted_at IS NULL
    `;
    const inventoryParams = [productIds];

    // LOGIC PHÂN QUYỀN: Nếu là Nhân viên (Không phải Manager), chỉ hiển thị tồn kho của cơ sở họ đang làm việc
    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        inventoryQuery += ' AND i.branch_id = ?';
        inventoryParams.push(userBranchId);
    }
    inventoryQuery += ' ORDER BY i.branch_id ASC';

    const [inventories] = await masterPool.query(inventoryQuery, inventoryParams);

    result.data = products.map(product => {
        // Bóc tách để loại bỏ hoàn toàn is_active khỏi response trả về Frontend
        const { is_active, ...cleanProduct } = product; 
        
        return {
            ...cleanProduct,
            commissions: commissions.filter(item => item.product_id === product.id),
            commission_tiers: tiers.filter(item => item.product_id === product.id),
            inventory: inventories.filter(item => item.product_id === product.id)
        };
    });
    return result;
};

const getProductById = async (tenantId, productId, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    
    const [products] = await masterPool.query(
        `SELECT * FROM \`${dbName}\`.products WHERE id = ? AND deleted_at IS NULL`,
        [productId]
    );

    if (products.length === 0) {
        throw new Error('Không tìm thấy sản phẩm hoặc sản phẩm đã bị xóa.');
    }
    
    const { is_active, ...cleanProduct } = products[0];

    const [commissions] = await masterPool.query(
        `SELECT pc.id, pc.product_id, pc.role_id, pc.commission_percent, pc.commission_fixed_amount, r.name AS role_name
         FROM \`${dbName}\`.product_commissions pc
         INNER JOIN \`${dbName}\`.roles r ON r.id = pc.role_id
         WHERE pc.product_id = ? AND pc.deleted_at IS NULL`,
        [productId]
    );
    const [tiers] = await masterPool.query(
        `SELECT pct.*, r.name AS role_name FROM \`${dbName}\`.product_commission_tiers pct
         JOIN \`${dbName}\`.roles r ON r.id = pct.role_id WHERE pct.product_id = ? ORDER BY pct.role_id, pct.min_price`, [productId]
    );

    let inventoryQuery = `
        SELECT i.id, i.product_id, i.branch_id, i.quantity, b.name AS branch_name
        FROM \`${dbName}\`.inventory i
        INNER JOIN \`${dbName}\`.branches b ON b.id = i.branch_id
        WHERE i.product_id = ? AND b.deleted_at IS NULL
    `;
    const inventoryParams = [productId];

    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        inventoryQuery += ' AND i.branch_id = ?';
        inventoryParams.push(userBranchId);
    }

    const [inventories] = await masterPool.query(inventoryQuery, inventoryParams);

    return {
        ...cleanProduct,
        commissions,
        commission_tiers: tiers,
        inventory: inventories
    };
};

const updateProduct = async (tenantId, productId, updateData, executorName, userRole) => {
    guardCommissionWrite(updateData, userRole);
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        await connection.beginTransaction();
        const [products] = await connection.query(
            `SELECT id, price, sale_price FROM \`${dbName}\`.products WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
            [productId]
        );
        if (products.length === 0) throw new Error('Sản phẩm/dịch vụ không tồn tại hoặc đã bị xóa.');

        // Keep legacy prices untouched for non-price edits; validate the final pair on any price edit.
        if (updateData.price !== undefined || updateData.sale_price !== undefined) {
            if (updateData.price === null || updateData.price === '') throw new Error('price không hợp lệ.');
            if (updateData.sale_price === null || updateData.sale_price === '') throw new Error('sale_price không hợp lệ.');
            const listedPrice = updateData.price === undefined ? Number(products[0].price) : toNumber(updateData.price, 'price');
            const sellingPrice = updateData.sale_price === undefined ? Number(products[0].sale_price) : toNumber(updateData.sale_price, 'sale_price');
            if (sellingPrice > listedPrice) throw new Error('sale_price không được lớn hơn price.');
        }

        const updateFields = [];
        const params = [];
        const allowedFields = [
            'description', 'benefits', 'unit', 'is_product', 'is_treatment_combo',
            'default_sessions', 'session_unit', 'next_appointment_days', 'price', 'sale_price'
        ];

        if (updateData.name !== undefined) {
            if (!String(updateData.name).trim()) throw new Error('Tên sản phẩm/dịch vụ không được để trống.');
            const [existing] = await connection.query(
                `SELECT id FROM \`${dbName}\`.products WHERE name = ? AND id != ? AND deleted_at IS NULL`,
                [String(updateData.name).trim(), productId]
            );
            if (existing.length > 0) throw new Error('Tên sản phẩm/dịch vụ này đã tồn tại.');
            updateFields.push('name = ?');
            params.push(String(updateData.name).trim());
        }

        if (updateData.images !== undefined) {
            if (updateData.images !== null && !Array.isArray(updateData.images)) throw new Error('images phải là một mảng JSON hoặc null.');
            updateFields.push('images = ?');
            params.push(updateData.images === null ? null : JSON.stringify(updateData.images));
        }

        for (const field of allowedFields) {
            if (updateData[field] === undefined) continue;
            if (field === 'sale_price' && (updateData[field] === null || updateData[field] === '')) throw new Error('sale_price không hợp lệ.');
            if (field === 'price' || field === 'sale_price') toNumber(updateData[field], field);
            if (['default_sessions', 'next_appointment_days'].includes(field)) {
                toNumber(updateData[field], field, { min: 0, integer: true });
            }
            if (['is_product', 'is_treatment_combo'].includes(field)) {
                updateFields.push(`${field} = ?`);
                params.push(toBooleanNumber(updateData[field], field));
            } else {
                updateFields.push(`${field} = ?`);
                params.push(['description', 'benefits', 'unit', 'session_unit'].includes(field) ? (updateData[field] || null) : Number(updateData[field]));
            }
        }

        if (updateFields.length > 0) {
            updateFields.push('updated_by = ?');
            params.push(executorName, productId);
            await connection.query(
                `UPDATE \`${dbName}\`.products SET ${updateFields.join(', ')} WHERE id = ?`,
                params
            );
        }

        if (updateData.commissions !== undefined) {
            await validateCommissions(connection, dbName, updateData.commissions);
            await syncCommissions(connection, dbName, productId, updateData.commissions, executorName);
        }
        if (updateData.commission_tiers !== undefined) {
            await syncCommissionTiers(connection, dbName, productId, updateData.commission_tiers, executorName);
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const deleteProduct = async (tenantId, productId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    const [result] = await masterPool.query(
        `UPDATE \`${dbName}\`.products SET deleted_at = NOW(), deleted_by = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [executorName, productId]
    );
    if (result.affectedRows === 0) throw new Error('Sản phẩm/dịch vụ không tồn tại hoặc đã bị xóa.');
};

const restoreProduct = async (tenantId, productId, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    const [result] = await masterPool.query(
        `UPDATE \`${dbName}\`.products SET deleted_at = NULL, deleted_by = NULL, updated_by = ?
         WHERE id = ? AND deleted_at IS NOT NULL`,
        [executorName, productId]
    );
    if (result.affectedRows === 0) throw new Error('Sản phẩm/dịch vụ chưa bị xóa hoặc không tồn tại.');
};

module.exports = { createProduct, getProducts, getProductById, updateProduct, deleteProduct, restoreProduct };