const { masterPool, getTenantDbName } = require('../config/database');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

// ==========================
// 1. QUẢN LÝ THẺ LIỆU TRÌNH
// ==========================

const createTreatment = async (tenantId, treatmentData, executorName) => {
    const dbName = await getTenantDbName(tenantId);
    const { customer_id, product_id, invoice_id, total_sessions, remaining_sessions, note } = treatmentData;

    const customerId = toNumber(customer_id, 'customer_id', { min: 1, integer: true });
    const productId = toNumber(product_id, 'product_id', { min: 1, integer: true });
    const totalSessions = toNumber(total_sessions, 'total_sessions', { min: 1, integer: true });
    const remainingSessions = remaining_sessions !== undefined ? toNumber(remaining_sessions, 'remaining_sessions', { min: 0, integer: true }) : totalSessions;

    if (remainingSessions > totalSessions) {
        throw new Error('Số buổi còn lại không được lớn hơn tổng số buổi.');
    }

    const [result] = await masterPool.query(
        `INSERT INTO \`${dbName}\`.treatments 
            (customer_id, product_id, invoice_id, total_sessions, remaining_sessions, note, created_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [customerId, productId, invoice_id || null, totalSessions, remainingSessions, note || null, executorName]
    );

    return { treatmentId: result.insertId };
};

// ==========================
// 2. LỊCH SỬ THỰC HIỆN BẤM BUỔI (TREATMENT HISTORY)
// ==========================

const executeTreatmentSession = async (tenantId, historyData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        let { treatment_id, branch_id, execution_date, staffs } = historyData;

        if (String(userRole).toUpperCase() !== 'MANAGER') branch_id = userBranchId;
        else if (!branch_id) throw new Error('Quản lý bắt buộc phải truyền branch_id.');

        const treatmentId = toNumber(treatment_id, 'treatment_id', { min: 1, integer: true });
        const branchId = toNumber(branch_id, 'branch_id', { min: 1, integer: true });

        await connection.beginTransaction();

        // 1. Kiểm tra thẻ liệu trình & Lấy thông tin Dịch vụ (Để tính hoa hồng + Lịch hẹn)
        const [treatments] = await connection.query(
            `SELECT t.customer_id, t.remaining_sessions, t.product_id, p.price, p.next_appointment_days 
             FROM \`${dbName}\`.treatments t
             INNER JOIN \`${dbName}\`.products p ON t.product_id = p.id
             WHERE t.id = ? AND t.deleted_at IS NULL FOR UPDATE`, 
            [treatmentId]
        );
        if (treatments.length === 0) throw new Error('Thẻ liệu trình không tồn tại hoặc đã bị xóa.');
        
        const treatment = treatments[0];
        if (treatment.remaining_sessions <= 0) throw new Error('Thẻ liệu trình này đã hết số buổi.');

        // 2. Trừ buổi
        await connection.query(
            `UPDATE \`${dbName}\`.treatments SET remaining_sessions = remaining_sessions - 1, updated_by = ? WHERE id = ?`,
            [executorName, treatmentId]
        );

        // 3. Lưu lịch sử làm dịch vụ
        const [historyResult] = await connection.query(
            `INSERT INTO \`${dbName}\`.treatment_history (treatment_id, branch_id, execution_date, created_by) VALUES (?, ?, COALESCE(?, NOW()), ?)`,
            [treatmentId, branchId, execution_date || null, executorName]
        );
        const treatmentHistoryId = historyResult.insertId;

        // 4. TỰ ĐỘNG TẠO LỊCH HẸN (Nếu dịch vụ có cài đặt số ngày quay lại và thẻ liệu trình vẫn còn buổi)
        const nextDays = Number(treatment.next_appointment_days || 0);
        if (nextDays > 0 && treatment.remaining_sessions - 1 > 0) {
            // Tính toán ngày hẹn tiếp theo
            const baseDate = execution_date ? new Date(execution_date) : new Date();
            baseDate.setDate(baseDate.getDate() + nextDays);

            await connection.query(
                `INSERT INTO \`${dbName}\`.appointments 
                    (customer_id, branch_id, appointment_date, note, status, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [treatment.customer_id, branchId, baseDate, 'Lịch hẹn tự động từ liệu trình', 'Chờ xử lý', executorName]
            );
        }

        // 5. TỰ ĐỘNG TÍNH HOA HỒNG & Lưu nhân viên (Nếu Frontend truyền lên)
        if (Array.isArray(staffs) && staffs.length > 0) {
            for (const staff of staffs) {
                const staffId = toNumber(staff.staff_id, 'staff_id', { min: 1, integer: true });
                
                // Lấy role_id của nhân viên đó
                const [staffInfo] = await connection.query(`SELECT role_id FROM \`${dbName}\`.staffs WHERE id = ? AND deleted_at IS NULL`, [staffId]);
                if (staffInfo.length === 0) throw new Error(`Nhân viên ID ${staffId} không tồn tại.`);
                const roleId = staffInfo[0].role_id;

                // Tra cứu bảng product_commissions
                let commission = 0;
                const [commissions] = await connection.query(
                    `SELECT commission_percent, commission_fixed_amount 
                     FROM \`${dbName}\`.product_commissions 
                     WHERE product_id = ? AND role_id = ? AND deleted_at IS NULL`,
                    [treatment.product_id, roleId]
                );

                if (commissions.length > 0) {
                    const pct = Number(commissions[0].commission_percent || 0);
                    const fixed = Number(commissions[0].commission_fixed_amount || 0);
                    commission = fixed + (Number(treatment.price) * pct / 100);
                }

                await connection.query(
                    `INSERT INTO \`${dbName}\`.treatment_history_staffs (treatment_history_id, staff_id, commission_amount_snapshot, created_by) VALUES (?, ?, ?, ?)`,
                    [treatmentHistoryId, staffId, commission, executorName]
                );
            }
        }

        await connection.commit();
        return { treatmentHistoryId, message: 'Đã trừ 1 buổi liệu trình và tính hoa hồng thành công' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// ==========================
// 3. GÁN BỔ SUNG NHÂN VIÊN VÀO LỊCH SỬ CŨ (TÍNH LẠI HOA HỒNG)
// ==========================

const assignStaffToHistory = async (tenantId, historyId, staffData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    
    // Kiểm tra lịch sử tồn tại & Lấy thông tin để tính hoa hồng
    const [histories] = await masterPool.query(
        `SELECT th.branch_id, t.product_id, p.price 
         FROM \`${dbName}\`.treatment_history th
         INNER JOIN \`${dbName}\`.treatments t ON th.treatment_id = t.id
         INNER JOIN \`${dbName}\`.products p ON t.product_id = p.id
         WHERE th.id = ? AND th.deleted_at IS NULL`, 
        [historyId]
    );
    if (histories.length === 0) throw new Error('Lịch sử thực hiện không tồn tại.');
    
    const history = histories[0];
    if (String(userRole).toUpperCase() !== 'MANAGER' && history.branch_id !== userBranchId) {
        throw new Error('Bạn không có quyền thao tác trên lịch sử của cơ sở khác.');
    }

    const { staffs } = staffData;
    if (!Array.isArray(staffs) || staffs.length === 0) throw new Error('Danh sách nhân viên không được để trống.');

    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();

        // Cơ chế Ghi đè: Xóa mềm các nhân viên cũ đã gán (nếu có)
        await connection.query(
            `UPDATE \`${dbName}\`.treatment_history_staffs SET deleted_at = NOW(), deleted_by = ? WHERE treatment_history_id = ?`,
            [executorName, historyId]
        );

        // TỰ ĐỘNG TÍNH HOA HỒNG & Lưu mới
        for (const staff of staffs) {
            const staffId = toNumber(staff.staff_id, 'staff_id', { min: 1, integer: true });
            
            // Lấy role_id của nhân viên
            const [staffInfo] = await connection.query(`SELECT role_id FROM \`${dbName}\`.staffs WHERE id = ? AND deleted_at IS NULL`, [staffId]);
            if (staffInfo.length === 0) throw new Error(`Nhân viên ID ${staffId} không tồn tại.`);
            const roleId = staffInfo[0].role_id;

            // Tra cứu bảng product_commissions
            let commission = 0;
            const [commissions] = await connection.query(
                `SELECT commission_percent, commission_fixed_amount 
                 FROM \`${dbName}\`.product_commissions 
                 WHERE product_id = ? AND role_id = ? AND deleted_at IS NULL`,
                [history.product_id, roleId]
            );

            if (commissions.length > 0) {
                const pct = Number(commissions[0].commission_percent || 0);
                const fixed = Number(commissions[0].commission_fixed_amount || 0);
                commission = fixed + (Number(history.price) * pct / 100);
            }

            await connection.query(
                `INSERT INTO \`${dbName}\`.treatment_history_staffs (treatment_history_id, staff_id, commission_amount_snapshot, created_by) VALUES (?, ?, ?, ?)`,
                [historyId, staffId, commission, executorName]
            );
        }

        await connection.commit();
        return { message: 'Đã cập nhật danh sách nhân viên thực hiện và tính hoa hồng thành công' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// ==========================
// 4. TÌM KIẾM HOA HỒNG NHÂN VIÊN (TÍNH LƯƠNG)
// ==========================

const getStaffCommissions = async (tenantId, filters, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT ths.id, ths.treatment_history_id, ths.commission_amount_snapshot, ths.created_at,
               th.execution_date, th.branch_id, b.name AS branch_name,
               s.fullname AS staff_name, r.name AS role_name,
               t.product_id, p.name AS product_name, c.fullname AS customer_name
        FROM \`${dbName}\`.treatment_history_staffs ths
        INNER JOIN \`${dbName}\`.treatment_history th ON ths.treatment_history_id = th.id
        INNER JOIN \`${dbName}\`.treatments t ON th.treatment_id = t.id
        INNER JOIN \`${dbName}\`.staffs s ON ths.staff_id = s.id
        LEFT JOIN \`${dbName}\`.roles r ON s.role_id = r.id
        INNER JOIN \`${dbName}\`.branches b ON th.branch_id = b.id
        LEFT JOIN \`${dbName}\`.products p ON t.product_id = p.id
        LEFT JOIN \`${dbName}\`.customers c ON t.customer_id = c.id
        WHERE ths.deleted_at IS NULL AND th.deleted_at IS NULL
    `;
    const params = [];

    if (String(userRole).toUpperCase() !== 'MANAGER' && userBranchId) {
        query += ' AND th.branch_id = ?'; params.push(userBranchId);
    } else if (filters.branchId !== undefined) {
        query += ' AND th.branch_id = ?'; params.push(toNumber(filters.branchId, 'branchId', { min: 1, integer: true }));
    }

    if (filters.staffName) {
        query += ' AND s.fullname LIKE ?'; params.push(`%${filters.staffName}%`);
    }
    const roleFilter = filters.roleName || filters.systemRole;
    if (roleFilter) {
        query += ' AND r.name = ?'; params.push(roleFilter);
    }
    if (filters.startDate) { 
        query += ' AND DATE(th.execution_date) >= ?'; params.push(filters.startDate); 
    }
    if (filters.endDate) { 
        query += ' AND DATE(th.execution_date) <= ?'; params.push(filters.endDate); 
    }

    query += ' ORDER BY s.fullname ASC, ths.commission_amount_snapshot ASC, th.execution_date DESC';

    const [rows] = await masterPool.query(query, params);
    return rows;
};

// ==========================
// 5. HOÀN TÁC TRỪ BUỔI (XÓA HISTORY)
// ==========================

const deleteTreatmentHistory = async (tenantId, historyId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        await connection.beginTransaction();

        const [histories] = await connection.query(`SELECT treatment_id, branch_id FROM \`${dbName}\`.treatment_history WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [historyId]);
        if (histories.length === 0) throw new Error('Lịch sử không tồn tại hoặc đã bị xóa.');
        
        const history = histories[0];
        if (String(userRole).toUpperCase() !== 'MANAGER' && history.branch_id !== userBranchId) throw new Error('Bạn không có quyền xóa lịch sử của cơ sở khác.');

        // Hoàn lại 1 buổi cho thẻ liệu trình
        await connection.query(
            `UPDATE \`${dbName}\`.treatments SET remaining_sessions = remaining_sessions + 1, updated_by = ? WHERE id = ?`,
            [executorName, history.treatment_id]
        );

        // Xóa mềm
        await connection.query(`UPDATE \`${dbName}\`.treatment_history SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`, [executorName, historyId]);
        await connection.query(`UPDATE \`${dbName}\`.treatment_history_staffs SET deleted_at = NOW(), deleted_by = ? WHERE treatment_history_id = ?`, [executorName, historyId]);

        await connection.commit();
        return { message: 'Xóa lịch sử thực hiện và cộng lại 1 buổi thành công' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = { 
    createTreatment, 
    executeTreatmentSession, 
    assignStaffToHistory, 
    getStaffCommissions,
    deleteTreatmentHistory 
};