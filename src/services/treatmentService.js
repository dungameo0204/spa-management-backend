const { masterPool, getTenantDbName } = require('../config/database');
const { parsePagination, paginateQuery } = require('../utils/pagination');
const { loadCommissionBase, calculateCommission } = require('./commissionService');
const groups = require('./treatmentGroupService');
const { normalizeSessionMetadata } = require('../utils/treatmentHistory');
const { isToday } = require('../utils/staffDatePolicy');

const toNumber = (value, fieldName, { min = 0, integer = false } = {}) => {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < min || (integer && !Number.isInteger(numberValue))) {
        throw new Error(`${fieldName} không hợp lệ.`);
    }
    return numberValue;
};

const optionalDate = (value, fieldName) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const error = new Error(`${fieldName} phải là ngày YYYY-MM-DD hợp lệ.`); error.status = 400; throw error;
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        const error = new Error(`${fieldName} phải là ngày YYYY-MM-DD hợp lệ.`); error.status = 400; throw error;
    }
    return value;
};

const executionDateFilters = filters => {
    const start = optionalDate(filters.executionStartDate, 'executionStartDate');
    const end = optionalDate(filters.executionEndDate, 'executionEndDate');
    if (start && end && start > end) {
        const error = new Error('executionStartDate không được sau executionEndDate.'); error.status = 400; throw error;
    }
    return { start, end };
};

const matchingExecutionSql = (dbName, rootAlias, dates) => {
    const conditions = ['th.deleted_at IS NULL'];
    const params = [];
    if (dates.start) { conditions.push('th.execution_date >= ?'); params.push(dates.start); }
    if (dates.end) { conditions.push('th.execution_date < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(dates.end); }
    return {
        sql: `EXISTS (
            SELECT 1 FROM \`${dbName}\`.treatment_history th
            INNER JOIN treatment_tree tree ON tree.id = th.treatment_id
            WHERE tree.root_id = ${rootAlias}.id AND ${conditions.join(' AND ')}
        )`,
        params
    };
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
        const { treatment_id, branch_id, execution_date, staffs, children } = historyData;

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

        // Group execution records one parent visit and one child history per selected child card.
        if (children !== undefined) {
            if (signature) throw new Error('Thực hiện nhóm không nhận chữ ký khách hàng.');
            if (!Array.isArray(children) || !children.length || children.length > 200) throw new Error('children phải là mảng từ 0 đến 200 dịch vụ con thực hiện.');
            const [roots] = await connection.query(`SELECT t.id,t.customer_id,t.closed_at,p.name AS product_name
                FROM \`${dbName}\`.treatments t JOIN \`${dbName}\`.products p ON p.id=t.product_id
                WHERE t.id=? AND t.deleted_at IS NULL FOR UPDATE`, [treatmentId]);
            const root = roots[0];
            if (!root) throw new Error('Thẻ liệu trình không tồn tại hoặc đã bị xóa.');
            if (root.closed_at) throw new Error('Liệu trình cha đã kết thúc.');
            const [availableChildren] = await connection.query(`SELECT t.id,t.customer_id,t.remaining_sessions,t.closed_at,t.product_id,p.name AS product_name,p.next_appointment_days
                FROM \`${dbName}\`.treatments t JOIN \`${dbName}\`.products p ON p.id=t.product_id
                WHERE t.parent_treatment_id=? AND t.deleted_at IS NULL FOR UPDATE`, [treatmentId]);
            if (!availableChildren.length) throw new Error('Thẻ này không có dịch vụ con để thực hiện theo nhóm.');
            const seen = new Set();
            const selected = children.map((child, index) => {
                if (!child || typeof child !== 'object' || Array.isArray(child) || Object.keys(child).some(key => !['treatment_id', 'staffs'].includes(key))) throw new Error(`children[${index}] chỉ nhận treatment_id và staffs.`);
                const childId = toNumber(child.treatment_id, `children[${index}].treatment_id`, { min: 1, integer: true });
                if (seen.has(childId)) throw new Error('Mỗi dịch vụ con chỉ được thực hiện một lần trong cùng request.');
                seen.add(childId);
                if (!Array.isArray(child.staffs)) throw new Error(`children[${index}].staffs phải là một mảng.`);
                const card = availableChildren.find(item => Number(item.id) === childId);
                if (!card || Number(card.customer_id) !== Number(root.customer_id)) throw new Error(`Dịch vụ con ID ${childId} không thuộc liệu trình cha.`);
                if (card.closed_at || (card.remaining_sessions !== null && Number(card.remaining_sessions) <= 0)) throw new Error(`Dịch vụ con ${card.product_name} đã hết buổi hoặc đã kết thúc.`);
                return { ...card, staffs: child.staffs };
            });
            const [parentInsert] = await connection.query(`INSERT INTO \`${dbName}\`.treatment_history
                (treatment_id,parent_history_id,branch_id,execution_date,created_by,note,customer_signature_svg,customer_signed_at)
                VALUES (?,NULL,?,COALESCE(?,NOW()),?,?,NULL,NULL)`, [treatmentId, branchId, execution_date || null, executorName, note]);
            const parentHistoryId = parentInsert.insertId;
            const childHistoryIds = [];
            for (const child of selected) {
                await connection.query(`UPDATE \`${dbName}\`.treatments SET remaining_sessions=CASE WHEN remaining_sessions IS NULL THEN NULL ELSE remaining_sessions-1 END,updated_by=? WHERE id=?`, [executorName, child.id]);
                const [insert] = await connection.query(`INSERT INTO \`${dbName}\`.treatment_history
                    (treatment_id,parent_history_id,branch_id,execution_date,created_by,note,customer_signature_svg,customer_signed_at)
                    VALUES (?,?,?,COALESCE(?,NOW()),?,NULL,NULL,NULL)`, [child.id, parentHistoryId, branchId, execution_date || null, executorName]);
                childHistoryIds.push(insert.insertId);
                if (child.staffs.length) {
                    const base = await loadCommissionBase(connection, dbName, child.id);
                    for (const staff of child.staffs) {
                        const staffId = toNumber(staff.staff_id, 'staff_id', { min: 1, integer: true });
                        const [staffInfo] = await connection.query(`SELECT role_id,branch_id FROM \`${dbName}\`.staffs WHERE id=? AND deleted_at IS NULL`, [staffId]);
                        if (!staffInfo.length) throw new Error(`Nhân viên ID ${staffId} không tồn tại.`);
                        if (normalizedRole === 'STAFF' && Number(staffInfo[0].branch_id) !== branchId) throw new Error(`Nhân viên ID ${staffId} không thuộc cơ sở của tài khoản STAFF.`);
                        await connection.query(`INSERT INTO \`${dbName}\`.treatment_history_staffs (treatment_history_id,staff_id,commission_amount_snapshot,created_by) VALUES (?,?,?,?)`,
                            [insert.insertId, staffId, await calculateCommission(connection, dbName, base, staffInfo[0].role_id), executorName]);
                    }
                }
            }
            await connection.commit();
            return { treatmentHistoryId: parentHistoryId, childTreatmentHistoryIds: childHistoryIds, message: 'Đã ghi nhận lần thực hiện nhóm thành công' };
        }

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

// Replace a parent visit's selected child services. Removed services remain soft-deleted/auditable.
const updateGroupedExecution = async (tenantId, parentHistoryId, body, executorName, userRole, userBranchId) => {
    const parentId = toNumber(parentHistoryId, 'parentHistoryId', { min: 1, integer: true });
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['treatment_id', 'branch_id', 'execution_date', 'note', 'children'].includes(key))) throw Object.assign(new Error('Chỉ nhận treatment_id, branch_id, execution_date, note và children.'), { status: 400 });
    const { note } = normalizeSessionMetadata(body);
    const treatmentId = toNumber(body.treatment_id, 'treatment_id', { min: 1, integer: true });
    if (!Array.isArray(body.children) || body.children.length > 200) throw Object.assign(new Error('children phải là mảng từ 0 đến 200 dịch vụ con thực hiện.'), { status: 400 });
    const role = String(userRole).toUpperCase(), selectedIds = new Set();
    const selected = body.children.map((child, index) => {
        if (!child || typeof child !== 'object' || Array.isArray(child) || Object.keys(child).some(key => !['treatment_id', 'staffs'].includes(key))) throw Object.assign(new Error(`children[${index}] chỉ nhận treatment_id và staffs.`), { status: 400 });
        const childId = toNumber(child.treatment_id, `children[${index}].treatment_id`, { min: 1, integer: true });
        if (selectedIds.has(childId)) throw Object.assign(new Error('Mỗi dịch vụ con chỉ được xuất hiện một lần.'), { status: 400 });
        if (!Array.isArray(child.staffs)) throw Object.assign(new Error(`children[${index}].staffs phải là một mảng.`), { status: 400 });
        const staffIds = child.staffs.map(staff => toNumber(staff?.staff_id, 'staff_id', { min: 1, integer: true }));
        if (new Set(staffIds).size !== staffIds.length) throw Object.assign(new Error('Không được chọn trùng nhân viên cho cùng dịch vụ.'), { status: 400 });
        selectedIds.add(childId); return { treatmentId: childId, staffIds };
    });
    if (role === 'STAFF' && (body.branch_id !== undefined || body.execution_date !== undefined)) throw Object.assign(new Error('STAFF không được đổi cơ sở hoặc ngày thực hiện khi sửa lần thực hiện.'), { status: 403 });
    const dbName = await getTenantDbName(tenantId), connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        const [parents] = await connection.query(`SELECT * FROM \`${dbName}\`.treatment_history WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [parentId]);
        const parent = parents[0];
        if (!parent) throw Object.assign(new Error('Lần thực hiện không tồn tại hoặc đã bị xóa.'), { status: 404 });
        if (parent.parent_history_id != null || Number(parent.treatment_id) !== treatmentId) throw Object.assign(new Error('parentHistoryId phải là history cha của treatment_id.'), { status: 400 });
        if (role === 'STAFF' && (Number(parent.branch_id) !== Number(userBranchId) || !isToday(parent.execution_date) || !isToday(parent.created_at))) throw Object.assign(new Error('STAFF chỉ được sửa lần thực hiện hôm nay tại cơ sở trong token.'), { status: 403 });
        const branchId = body.branch_id === undefined ? Number(parent.branch_id) : toNumber(body.branch_id, 'branch_id', { min: 1, integer: true });
        const executionDate = body.execution_date === undefined ? parent.execution_date : body.execution_date;
        const [roots] = await connection.query(`SELECT * FROM \`${dbName}\`.treatments WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [treatmentId]);
        const root = roots[0];
        if (!root || root.parent_treatment_id != null || root.closed_at) throw Object.assign(new Error('Thẻ liệu trình cha không còn hoạt động.'), { status: 409 });
        const [cards] = await connection.query(`SELECT t.*,p.name AS product_name FROM \`${dbName}\`.treatments t JOIN \`${dbName}\`.products p ON p.id=t.product_id WHERE t.parent_treatment_id=? AND t.deleted_at IS NULL FOR UPDATE`, [treatmentId]);
        const cardById = new Map(cards.map(card => [Number(card.id), card]));
        for (const child of selected) { const card = cardById.get(child.treatmentId); if (!card || Number(card.customer_id) !== Number(root.customer_id) || card.closed_at) throw Object.assign(new Error(`Dịch vụ con ID ${child.treatmentId} không thuộc thẻ cha đang hoạt động.`), { status: 400 }); }
        const [oldHistories] = await connection.query(`SELECT * FROM \`${dbName}\`.treatment_history WHERE parent_history_id=? AND deleted_at IS NULL FOR UPDATE`, [parentId]);
        const oldByTreatment = new Map(oldHistories.map(history => [Number(history.treatment_id), history]));
        if (oldByTreatment.size !== oldHistories.length) throw Object.assign(new Error('Dữ liệu history con của lần thực hiện không hợp lệ.'), { status: 409 });
        for (const child of selected) { const card = cardById.get(child.treatmentId); if (!oldByTreatment.has(child.treatmentId) && card.remaining_sessions !== null && Number(card.remaining_sessions) <= 0) throw Object.assign(new Error(`Dịch vụ ${card.product_name} đã hết buổi.`), { status: 409 }); }
        const removed = oldHistories.filter(history => !selectedIds.has(Number(history.treatment_id)));
        for (const history of removed) {
            await connection.query(`UPDATE \`${dbName}\`.treatment_history_staffs SET deleted_at=NOW(),deleted_by=? WHERE treatment_history_id=? AND deleted_at IS NULL`, [executorName, history.id]);
            await connection.query(`UPDATE \`${dbName}\`.treatment_history SET deleted_at=NOW(),deleted_by=? WHERE id=? AND parent_history_id=? AND deleted_at IS NULL`, [executorName, history.id, parentId]);
            await connection.query(`UPDATE \`${dbName}\`.treatments SET remaining_sessions=remaining_sessions+1,updated_by=? WHERE id=? AND remaining_sessions IS NOT NULL AND closed_at IS NULL`, [executorName, history.treatment_id]);
            if (history.appointment_id != null) await connection.query(`UPDATE \`${dbName}\`.appointments SET deleted_at=NOW(),deleted_by=? WHERE id=? AND deleted_at IS NULL`, [executorName, history.appointment_id]);
        }
        const childTreatmentHistoryIds = [];
        for (const child of selected) {
            let history = oldByTreatment.get(child.treatmentId);
            if (!history) {
                await connection.query(`UPDATE \`${dbName}\`.treatments SET remaining_sessions=remaining_sessions-1,updated_by=? WHERE id=? AND remaining_sessions IS NOT NULL`, [executorName, child.treatmentId]);
                const [insert] = await connection.query(`INSERT INTO \`${dbName}\`.treatment_history (treatment_id,parent_history_id,branch_id,execution_date,created_by) VALUES (?,?,?,?,?)`, [child.treatmentId, parentId, branchId, executionDate, executorName]);
                history = { id: insert.insertId };
            } else await connection.query(`UPDATE \`${dbName}\`.treatment_history SET branch_id=?,execution_date=?,updated_by=? WHERE id=?`, [branchId, executionDate, executorName, history.id]);
            await connection.query(`UPDATE \`${dbName}\`.treatment_history_staffs SET deleted_at=NOW(),deleted_by=? WHERE treatment_history_id=? AND deleted_at IS NULL`, [executorName, history.id]);
            if (child.staffIds.length) {
                const base = await loadCommissionBase(connection, dbName, child.treatmentId);
                for (const staffId of child.staffIds) {
                    const [staffInfo] = await connection.query(`SELECT role_id,branch_id FROM \`${dbName}\`.staffs WHERE id=? AND deleted_at IS NULL`, [staffId]);
                    if (!staffInfo.length || (role === 'STAFF' && Number(staffInfo[0].branch_id) !== branchId)) throw Object.assign(new Error(`Nhân viên ID ${staffId} không tồn tại hoặc không thuộc cơ sở.`), { status: 400 });
                    await connection.query(`INSERT INTO \`${dbName}\`.treatment_history_staffs (treatment_history_id,staff_id,commission_amount_snapshot,created_by) VALUES (?,?,?,?)`, [history.id, staffId, await calculateCommission(connection, dbName, base, staffInfo[0].role_id), executorName]);
                }
            }
            childTreatmentHistoryIds.push(history.id);
        }
        const parentHistoryDeleted = selected.length === 0;
        if (parentHistoryDeleted) {
            await connection.query(`UPDATE \`${dbName}\`.treatment_history_staffs SET deleted_at=NOW(),deleted_by=? WHERE treatment_history_id=? AND deleted_at IS NULL`, [executorName, parentId]);
            await connection.query(`UPDATE \`${dbName}\`.treatment_history SET deleted_at=NOW(),deleted_by=? WHERE id=? AND deleted_at IS NULL`, [executorName, parentId]);
        } else {
            await connection.query(`UPDATE \`${dbName}\`.treatment_history SET branch_id=?,execution_date=?,note=?,updated_by=? WHERE id=?`, [branchId, executionDate, Object.hasOwn(body, 'note') ? note : parent.note, executorName, parentId]);
        }
        await connection.commit();
        return { message: 'Cập nhật lần thực hiện nhóm thành công', treatmentHistoryId: parentId, childTreatmentHistoryIds, removedTreatmentHistoryIds: removed.map(history => history.id), parentHistoryDeleted };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
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

        const [histories] = await connection.query(`SELECT id,treatment_id,parent_history_id,branch_id,appointment_id,execution_date,created_at FROM \`${dbName}\`.treatment_history WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [historyId]);
        if (histories.length === 0) throw new Error('Lịch sử không tồn tại hoặc đã bị xóa.');
        
        const history = histories[0];
        if (String(userRole).toUpperCase() === 'STAFF' && Number(history.branch_id) !== Number(userBranchId)) {
            throw new Error('Bạn không có quyền thao tác trên lịch sử của cơ sở khác.');
        }
        if (String(userRole).toUpperCase() === 'STAFF' &&
            (!isToday(history.execution_date) || !isToday(history.created_at))) {
            throw new Error('Nhân viên chỉ được xóa lịch sử có ngày thực hiện và ngày tạo đều là hôm nay.');
        }

        // Serialize cleanup with edits to this parent visit.
        if (history.parent_history_id != null) {
            const [parents] = await connection.query(`SELECT id FROM \`${dbName}\`.treatment_history WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [history.parent_history_id]);
            if (!parents.length) throw Object.assign(new Error('Parent visit no longer exists.'), { status: 409 });
        }
        // Only child or standalone histories can restore a session.
        if (history.parent_history_id == null) {
            const [children] = await connection.query(`SELECT id,treatment_id FROM \`${dbName}\`.treatment_history
                WHERE parent_history_id=? AND deleted_at IS NULL FOR UPDATE`, [history.id]);
            if (children.length) {
                throw Object.assign(new Error('Lần thực hiện nhóm chỉ được hoàn tác từng dịch vụ con.'), { status: 409 });
            }
        }

        // Hoàn lại 1 buổi cho thẻ liệu trình đơn hoặc history con.
        await connection.query(
            `UPDATE \`${dbName}\`.treatments SET remaining_sessions = remaining_sessions + 1, updated_by = ? WHERE id = ? AND closed_at IS NULL AND remaining_sessions IS NOT NULL AND NOT EXISTS (SELECT 1 FROM \`${dbName}\`.treatment_history child_history WHERE child_history.parent_history_id = ?)`,
            [executorName, history.treatment_id, history.id]
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

        let parentHistoryDeleted = false;
        if (history.parent_history_id != null) {
            const [remaining] = await connection.query(`SELECT id FROM \`${dbName}\`.treatment_history WHERE parent_history_id=? AND deleted_at IS NULL FOR UPDATE`, [history.parent_history_id]);
            if (!remaining.length) {
                await connection.query(`UPDATE \`${dbName}\`.treatment_history_staffs SET deleted_at=NOW(),deleted_by=? WHERE treatment_history_id=? AND deleted_at IS NULL`, [executorName, history.parent_history_id]);
                await connection.query(`UPDATE \`${dbName}\`.treatment_history SET deleted_at=NOW(),deleted_by=? WHERE id=? AND deleted_at IS NULL`, [executorName, history.parent_history_id]);
                parentHistoryDeleted = true;
            }
        }
        await connection.commit();
        return { message: 'Xóa lịch sử thực hiện và cộng lại 1 buổi thành công', parentHistoryId: history.parent_history_id ?? null, parentHistoryDeleted };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};


const getTreatments = async (tenantId, filters) => {
    const dbName = await getTenantDbName(tenantId);
    const executionDates = executionDateFilters(filters);
    const executionFilterActive = executionDates.start || executionDates.end;
    let query = `${executionFilterActive ? `WITH RECURSIVE treatment_tree AS (
        SELECT root_t.id AS root_id, root_t.id FROM \`${dbName}\`.treatments root_t
        WHERE root_t.parent_treatment_id IS NULL AND root_t.deleted_at IS NULL
        UNION ALL
        SELECT tree.root_id, child_t.id FROM \`${dbName}\`.treatments child_t
        INNER JOIN treatment_tree tree ON child_t.parent_treatment_id = tree.id
        WHERE child_t.deleted_at IS NULL
    )` : ''}
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

    if (executionDates.start || executionDates.end) {
        const matching = matchingExecutionSql(dbName, 't', executionDates);
        query += ` AND ${matching.sql}`;
        params.push(...matching.params);
    }

    if (filters.branchId) {
        query += ' AND (i.branch_id = ? OR t.invoice_id IS NULL)';
        params.push(filters.branchId);
    }

    const page = await paginateQuery(masterPool, query, params, 't.created_at DESC, t.id DESC', filters);
    page.data = await groups.attach(masterPool, dbName, page.data, {
        histories: Boolean(executionDates.start || executionDates.end),
        executionStartDate: executionDates.start,
        executionEndDate: executionDates.end
    });
    return page;
};

const rootCardIsClosed = card => card.closed_at != null || card.closure_signature_svg != null;
const rootCardIsCompleted = card => {
    if (rootCardIsClosed(card)) return true;
    if (card.children?.length) return card.children.every(rootCardIsCompleted);
    return card.total_sessions !== null && Number(card.remaining_sessions) <= 0;
};
const rootCardIsUsable = card => {
    if (rootCardIsClosed(card)) return false;
    if (card.children?.length) return card.children.some(rootCardIsUsable);
    return card.remaining_sessions === null || Number(card.remaining_sessions) > 0;
};

const getTreatmentsByCustomer = async (tenantId, filters = {}) => {
    const dbName = await getTenantDbName(tenantId);
    const executionDates = executionDateFilters(filters);
    const { page, pageSize, offset } = parsePagination(filters);
    const executionFilterActive = executionDates.start || executionDates.end;
    const withTree = executionFilterActive ? `WITH RECURSIVE treatment_tree AS (
        SELECT root_t.id AS root_id, root_t.id FROM \`${dbName}\`.treatments root_t
        WHERE root_t.parent_treatment_id IS NULL AND root_t.deleted_at IS NULL
        UNION ALL
        SELECT tree.root_id, child_t.id FROM \`${dbName}\`.treatments child_t
        INNER JOIN treatment_tree tree ON child_t.parent_treatment_id=tree.id
        WHERE child_t.deleted_at IS NULL
    )` : '';
    const params = [];
    let rootWhere = 'WHERE t.deleted_at IS NULL AND t.parent_treatment_id IS NULL';
    if (filters.invoiceId) { rootWhere += ' AND t.invoice_id=?'; params.push(toNumber(filters.invoiceId, 'invoiceId', { min: 1, integer: true })); }
    if (filters.productSearch) { rootWhere += ' AND p.name LIKE ?'; params.push(`%${filters.productSearch}%`); }
    if (filters.status === 'active') rootWhere += ' AND t.closed_at IS NULL';
    else if (filters.status === 'completed') rootWhere += ' AND t.closed_at IS NOT NULL';
    else if (filters.status === 'exhausted') rootWhere += ' AND t.closed_at IS NULL AND t.remaining_sessions=0';
    if (filters.startDate) { rootWhere += ' AND DATE(t.created_at)>=?'; params.push(filters.startDate); }
    if (filters.endDate) { rootWhere += ' AND DATE(t.created_at)<=?'; params.push(filters.endDate); }
    if (filters.branchId) { rootWhere += ' AND (i.branch_id=? OR t.invoice_id IS NULL)'; params.push(filters.branchId); }
    if (executionFilterActive) {
        const matching = matchingExecutionSql(dbName, 't', executionDates);
        rootWhere += ` AND ${matching.sql}`;
        params.push(...matching.params);
    }
    const customerSearch = filters.customerSearch ? ' AND (c.fullname LIKE ? OR c.phone_number LIKE ?)' : '';
    const customerParams = filters.customerSearch ? [`%${filters.customerSearch}%`, `%${filters.customerSearch}%`] : [];
    const customerBase = `${withTree}
        SELECT DISTINCT c.id,c.fullname AS customer_name,c.phone_number,c.total_debt
        FROM \`${dbName}\`.customers c
        WHERE c.deleted_at IS NULL${customerSearch} AND EXISTS (
            SELECT 1 FROM \`${dbName}\`.treatments t
            JOIN \`${dbName}\`.products p ON p.id=t.product_id
            LEFT JOIN \`${dbName}\`.invoices i ON i.id=t.invoice_id
            ${rootWhere} AND t.customer_id=c.id
        )`;
    const allParams = [...customerParams, ...params];
    const [countRows] = await masterPool.query(`SELECT COUNT(*) AS total FROM (${customerBase}) AS customer_count`, allParams);
    const total = Number(countRows[0].total);
    const [customers] = await masterPool.query(`${customerBase} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...allParams, pageSize, offset]);
    if (!customers.length) return { total, page, pageSize, totalPages: Math.ceil(total / pageSize), data: [] };

    const customerIds = customers.map(customer => customer.id);
    const [roots] = await masterPool.query(`${withTree}
        SELECT t.*,c.fullname AS customer_name,c.phone_number,p.name AS product_name,i.branch_id,
            COALESCE(today.today_execution_count, 0) AS today_execution_count
        FROM \`${dbName}\`.treatments t
        JOIN \`${dbName}\`.customers c ON c.id=t.customer_id
        JOIN \`${dbName}\`.products p ON p.id=t.product_id
        LEFT JOIN \`${dbName}\`.invoices i ON i.id=t.invoice_id
        LEFT JOIN (
            SELECT treatment_id,COUNT(*) AS today_execution_count FROM \`${dbName}\`.treatment_history
            WHERE parent_history_id IS NULL AND deleted_at IS NULL
                AND execution_date>=CURDATE() AND execution_date<DATE_ADD(CURDATE(), INTERVAL 1 DAY)
            GROUP BY treatment_id
        ) today ON today.treatment_id=t.id
        ${rootWhere} AND t.customer_id IN (?)
        ORDER BY t.customer_id DESC,t.created_at DESC,t.id DESC`, [...params, customerIds]);
    const cards = await groups.attach(masterPool, dbName, roots);
    const byCustomer = new Map(customers.map(customer => [Number(customer.id), {
        customer_id: customer.id, customer_name: customer.customer_name, phone_number: customer.phone_number,
        total_debt: Number(customer.total_debt), active_treatments: [], completed_treatments: []
    }]));
    for (const card of cards) {
        const customer = byCustomer.get(Number(card.customer_id));
        if (!customer) continue;
        card.today_execution_count = Number(card.today_execution_count);
        const completed = rootCardIsCompleted(card);
        if (rootCardIsUsable(card) || card.today_execution_count > 0) customer.active_treatments.push(card);
        if (completed) customer.completed_treatments.push(card);
    }
    return { total, page, pageSize, totalPages: Math.ceil(total / pageSize), data: customers.map(customer => byCustomer.get(Number(customer.id))) };
};

const getTreatmentDetail = async (tenantId, treatmentId, filters = {}) => {
    const dbName = await getTenantDbName(tenantId);
    const executionDates = executionDateFilters(filters);
    
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
    
    return (await groups.attach(masterPool, dbName, treatments, {
        histories: true,
        executionStartDate: executionDates.start,
        executionEndDate: executionDates.end
    }))[0];
};

const closeTreatment = async (tenantId, treatmentId, body, actor) => {
    const id = groups.count(treatmentId, 'treatmentId', 1);
    if (id === null) throw groups.invalid('treatmentId không hợp lệ.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'closure_note')) throw groups.invalid('Chỉ nhận closure_note.');
    if (body.closure_note != null && (typeof body.closure_note !== 'string' || Buffer.byteLength(body.closure_note, 'utf8') > 65535)) throw groups.invalid('closure_note phải là chuỗi tối đa 65535 byte hoặc null.');
    const db = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        const [roots] = await connection.query(`SELECT * FROM \`${db}\`.treatments WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [id]);
        const root = roots[0];
        if (!root) throw Object.assign(new Error('Không tìm thấy thẻ liệu trình.'), { status: 404 });
        if (root.parent_treatment_id != null) throw groups.invalid('Chỉ kết thúc tại thẻ gốc để đóng toàn bộ nhóm.');
        if (root.closed_at) throw Object.assign(new Error('Liệu trình đã kết thúc; không thể đóng lại.'), { status: 409 });
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
            closure_note=?,closure_signature_svg=NULL,updated_by=? WHERE id IN (?)`, [actor, body.closure_note?.trim() || null, actor, ids]);
        await connection.commit();
        return { treatmentId: id, closedTreatmentIds: ids };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
};

module.exports = {
    closeTreatment,
    getTreatments,
    getTreatmentsByCustomer,
    getTreatmentDetail, 
    createTreatment, 
    executeTreatmentSession, 
    updateGroupedExecution,
    assignStaffToHistory, 
    getStaffCommissions,
    deleteTreatmentHistory 
};