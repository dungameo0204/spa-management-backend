const { masterPool, getTenantDbName } = require('../config/database');
const { paginateQuery } = require('../utils/pagination');
const { isToday } = require('../utils/staffDatePolicy');
const { loadCommissionBase, calculateCommission } = require('./commissionService');
const groups = require('./treatmentGroupService');
const { normalizeClosureSignature } = require('../utils/treatmentSignature');
const { normalizeSessionMetadata } = require('../utils/treatmentHistory');

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
    if (treatmentData.parent_treatment_id != null) throw new Error('Tạo thẻ con cần luồng gói dịch vụ riêng; không gán cha qua API thẻ thủ công hiện tại.');
    const dbName = await getTenantDbName(tenantId);
    const { customer_id, product_id, total_sessions, remaining_sessions, note, commission_base_price, commission_quantity } = treatmentData;

    const customerId = toNumber(customer_id, 'customer_id', { min: 1, integer: true });
    const productId = toNumber(product_id, 'product_id', { min: 1, integer: true });
    // Keep numeric form strings compatible, but reject coercions such as null/false/[] -> 0.
    const sessionCount = (value, field, min) => {
        if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
            throw new Error(`${field} không hợp lệ.`);
        }
        return toNumber(value, field, { min, integer: true });
    };
    const totalSessions = total_sessions === null ? null : sessionCount(total_sessions, 'total_sessions', 1);
    const remainingSessions = remaining_sessions === undefined ? totalSessions :
        remaining_sessions === null && totalSessions === null ? null : sessionCount(remaining_sessions, 'remaining_sessions', 0);
    if (totalSessions === null && remainingSessions !== null) throw new Error('Thẻ trọn đời mới phải có remaining_sessions = null.');
    if (treatmentData.invoice_id != null) throw new Error('Thẻ thủ công không nhận invoice_id; thẻ từ hóa đơn phải tạo qua API hóa đơn.');
    if (commission_base_price === undefined || commission_base_price === null || commission_base_price === '') throw new Error('commission_base_price bắt buộc.');
    const basePrice = toNumber(commission_base_price, 'commission_base_price');
    const quantity = toNumber(commission_quantity ?? 1, 'commission_quantity', { min: 1, integer: true });

    if (totalSessions !== null && remainingSessions > totalSessions) {
        throw new Error('Số buổi còn lại không được lớn hơn tổng số buổi.');
    }

    if (treatmentData.children !== undefined) {
        const connection = await masterPool.getConnection();
        try {
            await connection.beginTransaction();
            const [customers] = await connection.query(`SELECT id FROM \`${dbName}\`.customers WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [customerId]);
            if (!customers.length) throw groups.invalid('Khách hàng không tồn tại hoặc đã bị xóa.');
            const config = await groups.prepare(connection, dbName, productId, { total_sessions: totalSessions, children: treatmentData.children });
            const result = await groups.create(connection, dbName, { customerId, productId, basePrice, quantity, remaining: remainingSessions, note }, config, executorName);
            await connection.commit();
            return result;
        } catch (error) { await connection.rollback(); throw error; }
        finally { connection.release(); }
    }

    const [result] = await masterPool.query(
        `INSERT INTO \`${dbName}\`.treatments 
            (customer_id, product_id, total_sessions, remaining_sessions, commission_base_price, commission_quantity, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [customerId, productId, totalSessions, remainingSessions, basePrice, quantity, note || null, executorName]
    );

    return { treatmentId: result.insertId };
};

// ==========================
// 2. LỊCH SỬ THỰC HIỆN BẤM BUỔI (TREATMENT HISTORY)
// ==========================

const executeTreatmentSession = async (tenantId, historyData, executorName, userRole, userBranchId) => {
    const { note, signature } = normalizeSessionMetadata(historyData);
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        const { treatment_id, branch_id, execution_date, staffs } = historyData;

        const treatmentId = toNumber(treatment_id, 'treatment_id', { min: 1, integer: true });
        const normalizedRole = String(userRole).toUpperCase();
        const branchId = normalizedRole === 'STAFF'
            ? toNumber(userBranchId, 'branch_id', { min: 1, integer: true })
            : toNumber(branch_id, 'branch_id', { min: 1, integer: true });

        if (normalizedRole === 'MANAGER' && branch_id === undefined) {
            throw new Error('Tài khoản MANAGER bắt buộc phải truyền branch_id.');
        }
        if (normalizedRole === 'STAFF' && branch_id !== undefined && Number(branch_id) !== branchId) {
            throw new Error('Tài khoản STAFF chỉ được thực hiện liệu trình tại cơ sở trong token.');
        }

        await connection.beginTransaction();

        // 1. Kiểm tra thẻ liệu trình & Lấy thông tin Dịch vụ (Để tính hoa hồng + Lịch hẹn)
        const [treatments] = await connection.query(
            `SELECT t.customer_id, t.remaining_sessions, t.product_id, p.name AS product_name, p.price, p.next_appointment_days,
                    t.closed_at, t.parent_treatment_id,
                    EXISTS(SELECT 1 FROM \`${dbName}\`.treatments child WHERE child.parent_treatment_id = t.id AND child.deleted_at IS NULL) AS has_children
             FROM \`${dbName}\`.treatments t
             INNER JOIN \`${dbName}\`.products p ON t.product_id = p.id
             WHERE t.id = ? AND t.deleted_at IS NULL FOR UPDATE`, 
            [treatmentId]
        );
        if (treatments.length === 0) throw new Error('Thẻ liệu trình không tồn tại hoặc đã bị xóa.');
        
        const treatment = treatments[0];
        if (Number(treatment.has_children)) throw new Error('Vui lòng thực hiện trên thẻ dịch vụ con, không thực hiện trên thẻ cha.');
        if (treatment.closed_at || (treatment.remaining_sessions !== null && treatment.remaining_sessions <= 0)) throw new Error('Thẻ liệu trình này đã hết số buổi hoặc đã kết thúc.');
        if (treatment.parent_treatment_id) {
            const [parents] = await connection.query(`SELECT id, closed_at, deleted_at FROM \`${dbName}\`.treatments WHERE id = ? FOR UPDATE`, [treatment.parent_treatment_id]);
            if (!parents.length || parents[0].closed_at || parents[0].deleted_at) throw new Error('Liệu trình cha đã kết thúc hoặc không còn tồn tại.');
        }

        // 2. Trừ buổi
        await connection.query(
            `UPDATE \`${dbName}\`.treatments SET remaining_sessions = remaining_sessions - 1, updated_by = ? WHERE id = ?`,
            [executorName, treatmentId]
        );

        // 3. Lưu lịch sử làm dịch vụ
        const [historyResult] = await connection.query(
            `INSERT INTO \`${dbName}\`.treatment_history (treatment_id, branch_id, execution_date, created_by, note, customer_signature_svg, customer_signed_at)
             VALUES (?, ?, COALESCE(?, NOW()), ?, ?, ?, IF(? IS NULL, NULL, NOW()))`,
            [treatmentId, branchId, execution_date || null, executorName, note, signature, signature]
        );
        const treatmentHistoryId = historyResult.insertId;

        // 4. TỰ ĐỘNG TẠO LỊCH HẸN (Nếu dịch vụ có cài đặt số ngày quay lại và thẻ liệu trình vẫn còn buổi)
        const nextDays = Number(treatment.next_appointment_days || 0);
        if (nextDays > 0 && (treatment.remaining_sessions === null || treatment.remaining_sessions - 1 > 0)) {
            // Tính toán ngày hẹn tiếp theo
            const baseDate = execution_date ? new Date(execution_date) : new Date();
            baseDate.setDate(baseDate.getDate() + nextDays);

            const [appointmentResult] = await connection.query(
                `INSERT INTO \`${dbName}\`.appointments 
                    (customer_id, branch_id, appointment_date, note, status, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [treatment.customer_id, branchId, baseDate, `Lịch hẹn tự động từ liệu trình: ${treatment.product_name}`, 'Khách chưa đến', executorName]
            );
            await connection.query(
                `UPDATE \`${dbName}\`.treatment_history SET appointment_id = ? WHERE id = ?`,
                [appointmentResult.insertId, treatmentHistoryId]
            );
        }

        // 5. Lưu tiền công dựa trên giá bán của thẻ.
        if (Array.isArray(staffs) && staffs.length > 0) {
            const base = await loadCommissionBase(connection, dbName, treatmentId);
            for (const staff of staffs) {
                const staffId = toNumber(staff.staff_id, 'staff_id', { min: 1, integer: true });
                
                // Lấy role_id của nhân viên đó
                const [staffInfo] = await connection.query(`SELECT role_id, branch_id FROM \`${dbName}\`.staffs WHERE id = ? AND deleted_at IS NULL`, [staffId]);
                if (staffInfo.length === 0) throw new Error(`Nhân viên ID ${staffId} không tồn tại.`);
                if (normalizedRole === 'STAFF' && Number(staffInfo[0].branch_id) !== branchId) {
                    throw new Error(`Nhân viên ID ${staffId} không thuộc cơ sở của tài khoản STAFF.`);
                }
                await connection.query(
                    `INSERT INTO \`${dbName}\`.treatment_history_staffs (treatment_history_id, staff_id, commission_amount_snapshot, created_by) VALUES (?, ?, ?, ?)`,
                    [treatmentHistoryId, staffId, await calculateCommission(connection, dbName, base, staffInfo[0].role_id), executorName]
                );
            }
        }

        await connection.commit();
        return { treatmentHistoryId, message: 'Đã trừ 1 buổi liệu trình thành công' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

// ==========================
// 3. GÁN BỔ SUNG NHÂN VIÊN VÀO LỊCH SỬ CŨ
// ==========================

const assignStaffToHistory = async (tenantId, historyId, staffData, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    
    const { staffs } = staffData;
    if (!Array.isArray(staffs)) throw new Error('staffs phải là một mảng.');

    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        const [histories] = await connection.query(
            `SELECT th.branch_id, th.treatment_id FROM \`${dbName}\`.treatment_history th
             WHERE th.id = ? AND th.deleted_at IS NULL FOR UPDATE`, [historyId]
        );
        if (histories.length === 0) throw new Error('Lịch sử thực hiện không tồn tại.');
        const history = histories[0];
        const normalizedRole = String(userRole).toUpperCase();
        if (normalizedRole === 'STAFF' && Number(history.branch_id) !== Number(userBranchId)) {
            throw new Error('Bạn không có quyền thao tác trên lịch sử của cơ sở khác.');
        }
        const base = staffs.length ? await loadCommissionBase(connection, dbName, history.treatment_id) : null;

        // Cơ chế Ghi đè: Xóa mềm các nhân viên cũ đã gán (nếu có)
        await connection.query(
            `UPDATE \`${dbName}\`.treatment_history_staffs SET deleted_at = NOW(), deleted_by = ? WHERE treatment_history_id = ?`,
            [executorName, historyId]
        );

        // staffs: [] hợp lệ để xóa toàn bộ assignment của history.
        for (const staff of staffs) {
            const staffId = toNumber(staff.staff_id, 'staff_id', { min: 1, integer: true });
            
            // Lấy role_id của nhân viên
            const [staffInfo] = await connection.query(`SELECT role_id, branch_id FROM \`${dbName}\`.staffs WHERE id = ? AND deleted_at IS NULL`, [staffId]);
            if (staffInfo.length === 0) throw new Error(`Nhân viên ID ${staffId} không tồn tại.`);
            if (normalizedRole === 'STAFF' && Number(staffInfo[0].branch_id) !== Number(userBranchId)) {
                throw new Error(`Nhân viên ID ${staffId} không thuộc cơ sở của tài khoản STAFF.`);
            }
            await connection.query(
                `INSERT INTO \`${dbName}\`.treatment_history_staffs (treatment_history_id, staff_id, commission_amount_snapshot, created_by) VALUES (?, ?, ?, ?)`,
                [historyId, staffId, await calculateCommission(connection, dbName, base, staffInfo[0].role_id), executorName]
            );
        }

        await connection.commit();
        return { message: 'Đã cập nhật danh sách nhân viên thực hiện thành công' };
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
         SELECT ths.id, ths.treatment_history_id, ths.commission_amount_snapshot AS commission_amount, ths.created_at,
               th.execution_date, th.branch_id, b.name AS branch_name,
               s.id AS staff_id, s.fullname AS staff_name, r.name AS role_name,
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
    const normalizedRole = String(userRole).toUpperCase();

    if (normalizedRole === 'STAFF') {
        query += ' AND th.branch_id = ? AND s.branch_id = ?';
        params.push(toNumber(userBranchId, 'branch_id', { min: 1, integer: true }), toNumber(userBranchId, 'branch_id', { min: 1, integer: true }));
    } else if (filters.branchId !== undefined) {
        query += ' AND th.branch_id = ?'; params.push(toNumber(filters.branchId, 'branchId', { min: 1, integer: true }));
    }

    if (filters.staffName) {
        query += ' AND s.fullname LIKE ?'; params.push(`%${filters.staffName}%`);
    }
    if (filters.roleName) {
        query += ' AND r.name = ?'; params.push(filters.roleName);
    }
    if (filters.productId !== undefined) {
        query += ' AND t.product_id = ?'; params.push(toNumber(filters.productId, 'productId', { min: 1, integer: true }));
    }
    if (filters.startDate) { 
        query += ' AND DATE(th.execution_date) >= ?'; params.push(filters.startDate); 
    }
    if (filters.endDate) { 
        query += ' AND DATE(th.execution_date) <= ?'; params.push(filters.endDate); 
    }

    return paginateQuery(masterPool, query, params, 'th.branch_id ASC, s.fullname ASC, s.id ASC, commission_amount ASC, ths.id ASC', filters);
};

// ==========================
// 5. HOÀN TÁC TRỪ BUỔI (XÓA HISTORY)
// ==========================

const deleteTreatmentHistory = async (tenantId, historyId, executorName, userRole, userBranchId) => {
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();

    try {
        await connection.beginTransaction();

        const [histories] = await connection.query(`SELECT treatment_id, branch_id, appointment_id, execution_date, created_at FROM \`${dbName}\`.treatment_history WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [historyId]);
        if (histories.length === 0) throw new Error('Lịch sử không tồn tại hoặc đã bị xóa.');
        
        const history = histories[0];
        if (String(userRole).toUpperCase() === 'STAFF' && Number(history.branch_id) !== Number(userBranchId)) {
            throw new Error('Bạn không có quyền thao tác trên lịch sử của cơ sở khác.');
        }

        const now = new Date();
        if (String(userRole).toUpperCase() === 'STAFF' &&
            (!isToday(history.execution_date, now) || !isToday(history.created_at, now))) {
            throw new Error('Nhân viên chỉ được xóa lịch sử có ngày thực hiện và ngày tạo đều là hôm nay.');
        }

        // Hoàn lại 1 buổi cho thẻ liệu trình
        await connection.query(
            `UPDATE \`${dbName}\`.treatments SET remaining_sessions = remaining_sessions + 1, updated_by = ? WHERE id = ? AND closed_at IS NULL AND remaining_sessions IS NOT NULL`,
            [executorName, history.treatment_id]
        );

        // Xóa mềm
        await connection.query(`UPDATE \`${dbName}\`.treatment_history SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`, [executorName, historyId]);
        await connection.query(`UPDATE \`${dbName}\`.treatment_history_staffs SET deleted_at = NOW(), deleted_by = ? WHERE treatment_history_id = ?`, [executorName, historyId]);
        // Chỉ xóa lịch do chính lần thực hiện này tạo, không đụng lịch thủ công/lịch cũ không có liên kết.
        if (history.appointment_id != null) {
            await connection.query(
                `UPDATE \`${dbName}\`.appointments SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL`,
                [executorName, history.appointment_id]
            );
        }

        await connection.commit();
        return { message: 'Xóa lịch sử thực hiện và cộng lại 1 buổi thành công' };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};


const getTreatments = async (tenantId, filters) => {
    const dbName = await getTenantDbName(tenantId);
    let query = `
        SELECT t.*, c.fullname as customer_name, c.phone_number, p.name as product_name, i.branch_id
        FROM \`${dbName}\`.treatments t
        JOIN \`${dbName}\`.customers c ON t.customer_id = c.id
        JOIN \`${dbName}\`.products p ON t.product_id = p.id
        LEFT JOIN \`${dbName}\`.invoices i ON t.invoice_id = i.id
        WHERE t.deleted_at IS NULL AND t.parent_treatment_id IS NULL
    `;
    const params = [];

    if (filters.customerId) {
        query += ' AND t.customer_id = ?';
        params.push(filters.customerId);
    }
    if (filters.invoiceId) {
        query += ' AND t.invoice_id = ?';
        params.push(toNumber(filters.invoiceId, 'invoiceId', { min: 1, integer: true }));
    }
    if (filters.customerSearch) {
        query += ' AND (c.fullname LIKE ? OR c.phone_number LIKE ?)';
        params.push(`%${filters.customerSearch}%`, `%${filters.customerSearch}%`);
    }
    if (filters.productSearch) {
        query += ' AND p.name LIKE ?';
        params.push(`%${filters.productSearch}%`);
    }
    if (filters.status === 'active') {
        query += ' AND t.closed_at IS NULL';
    } else if (filters.status === 'completed') {
        query += ' AND t.closed_at IS NOT NULL';
    } else if (filters.status === 'exhausted') {
        query += ' AND t.closed_at IS NULL AND t.remaining_sessions = 0';
    }
    
    if (filters.startDate) {
        query += ' AND DATE(t.created_at) >= ?';
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        query += ' AND DATE(t.created_at) <= ?';
        params.push(filters.endDate);
    }

    if (filters.branchId) {
        query += ' AND (i.branch_id = ? OR t.invoice_id IS NULL)';
        params.push(filters.branchId);
    }

    const page = await paginateQuery(masterPool, query, params, 't.created_at DESC, t.id DESC', filters);
    page.data = await groups.attach(masterPool, dbName, page.data);
    return page;
};

const getTreatmentDetail = async (tenantId, treatmentId) => {
    const dbName = await getTenantDbName(tenantId);
    
    let query = `
        SELECT t.*, c.fullname as customer_name, c.phone_number, p.name as product_name, i.branch_id
        FROM \`${dbName}\`.treatments t
        JOIN \`${dbName}\`.customers c ON t.customer_id = c.id
        JOIN \`${dbName}\`.products p ON t.product_id = p.id
        LEFT JOIN \`${dbName}\`.invoices i ON t.invoice_id = i.id
        WHERE t.id = ? AND t.deleted_at IS NULL
    `;
    const params = [treatmentId];

    const [treatments] = await masterPool.query(query, params);
    if (treatments.length === 0) {
        throw new Error('Không tìm thấy thẻ liệu trình hoặc thẻ đã bị xóa');
    }
    
    return (await groups.attach(masterPool, dbName, treatments, { histories: true }))[0];
};

const closeTreatment = async (tenantId, treatmentId, body, actor) => {
    const id = groups.count(treatmentId, 'treatmentId', 1);
    if (id === null) throw groups.invalid('treatmentId không hợp lệ.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['closure_note', 'closure_signature_svg'].includes(k))) throw groups.invalid('Chỉ nhận closure_note và closure_signature_svg.');
    const signature = normalizeClosureSignature(body.closure_signature_svg);
    if (body.closure_note != null && (typeof body.closure_note !== 'string' || Buffer.byteLength(body.closure_note, 'utf8') > 65535)) throw groups.invalid('closure_note phải là chuỗi tối đa 65535 byte hoặc null.');
    const db = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        const [roots] = await connection.query(`SELECT * FROM \`${db}\`.treatments WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [id]);
        const root = roots[0];
        if (!root) throw Object.assign(new Error('Không tìm thấy thẻ liệu trình.'), { status: 404 });
        if (root.parent_treatment_id != null) throw groups.invalid('Chỉ ký hoàn thành tại thẻ gốc để đóng toàn bộ nhóm.');
        if (root.closed_at) throw Object.assign(new Error('Liệu trình đã ký hoàn thành; không được ghi đè chữ ký.'), { status: 409 });
        const ids = [id];
        const seen = new Set(ids);
        let frontier = ids;
        while (frontier.length) {
            const [children] = await connection.query(`SELECT id,customer_id,closed_at FROM \`${db}\`.treatments WHERE parent_treatment_id IN (?) AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [frontier]);
            frontier = [];
            for (const child of children) {
                if (seen.has(Number(child.id)) || Number(child.customer_id) !== Number(root.customer_id)) throw groups.invalid('Quan hệ thẻ con không hợp lệ.');
                if (child.closed_at) throw groups.invalid('Thẻ con đã đóng riêng; cần đối soát nhóm trước khi ký.');
                seen.add(Number(child.id));
                ids.push(Number(child.id));
                frontier.push(Number(child.id));
            }
            if (ids.length > 10000) throw groups.invalid('Nhóm liệu trình quá lớn.');
        }
        await connection.query(`UPDATE \`${db}\`.treatments SET remaining_sessions=0,closed_at=NOW(),closed_by=?,
            closure_note=?,closure_signature_svg=?,updated_by=? WHERE id IN (?)`, [actor, body.closure_note?.trim() || null, signature, actor, ids]);
        await connection.commit();
        return { treatmentId: id, closedTreatmentIds: ids };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
};

module.exports = {
    closeTreatment,
    getTreatments,
    getTreatmentDetail, 
    createTreatment, 
    executeTreatmentSession, 
    assignStaffToHistory, 
    getStaffCommissions,
    deleteTreatmentHistory 
};