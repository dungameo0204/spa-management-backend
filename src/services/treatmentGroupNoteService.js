const { masterPool, getTenantDbName } = require('../config/database');
const { normalizeSessionMetadata } = require('../utils/treatmentHistory');
const failure = (status, message) => Object.assign(new Error(message), { status });

async function updateGroupNote(tenantId, treatmentId, body, actor, role, branchId) {
    if (!['MANAGER', 'STAFF'].includes(role)) throw failure(403, 'Không có quyền cập nhật ghi chú liệu trình.');
    const id = Number(treatmentId);
    if (!Number.isSafeInteger(id) || id < 1) throw failure(400, 'ID liệu trình không hợp lệ.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'note') ||
        Object.keys(body).some(key => key !== 'note')) throw failure(400, 'Chỉ nhận trường bắt buộc note.');
    const { note } = normalizeSessionMetadata(body);
    const db = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        const [[card]] = await connection.query(`SELECT id, parent_treatment_id FROM \`${db}\`.treatments WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [id]);
        if (!card) throw failure(404, 'Thẻ liệu trình không tồn tại.');
        const [children] = await connection.query(`SELECT id FROM \`${db}\`.treatments WHERE parent_treatment_id=? AND deleted_at IS NULL`, [id]);
        if (card.parent_treatment_id != null || !children.length) throw failure(400, 'Ghi chú chung chỉ lưu trên thẻ liệu trình cha.');
        if (role === 'STAFF') {
            const [histories] = await connection.query(`SELECT h.id FROM \`${db}\`.treatment_history h
                JOIN \`${db}\`.treatments t ON t.id=h.treatment_id
                WHERE t.parent_treatment_id=? AND t.deleted_at IS NULL AND h.deleted_at IS NULL AND h.branch_id=? LIMIT 1`, [id, branchId]);
            if (!histories.length) throw failure(403, 'Bạn không có quyền cập nhật liệu trình của cơ sở khác.');
        }
        await connection.query(`UPDATE \`${db}\`.treatments SET note=?, updated_by=? WHERE id=?`, [note, actor, id]);
        await connection.commit();
        return { message: 'Đã lưu ghi chú chung liệu trình.', data: { id, note } };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
}

module.exports = { updateGroupNote };