const { masterPool, getTenantDbName } = require('../config/database');
const { normalizeSessionMetadata } = require('../utils/treatmentHistory');

const failure = (status, message) => Object.assign(new Error(message), { status });

const updateHistoryMetadata = async (action, tenantId, historyId, body, actor, role, branchId) => {
    if (!['MANAGER', 'STAFF'].includes(role)) throw failure(403, 'Chỉ MANAGER/STAFF được cập nhật buổi thực hiện.');
    const id = Number(historyId);
    if (!Number.isSafeInteger(id) || id < 1) throw failure(400, 'historyId không hợp lệ.');
    const field = action === 'sign' ? 'customer_signature_svg' : 'note';
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, field) ||
        Object.keys(body).some(key => key !== field)) throw failure(400, `Chỉ nhận trường bắt buộc ${field}.`);
    const metadata = normalizeSessionMetadata(body);
    if (action === 'sign' && !metadata.signature) throw failure(400, 'Chữ ký là bắt buộc.');
    const db = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        // Shared history lock serializes note edits, signing and history deletion.
        const [[history]] = await connection.query(
            `SELECT treatment_id, branch_id, customer_signature_svg, customer_signed_at FROM \`${db}\`.treatment_history
             WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [id]
        );
        if (!history) throw failure(404, 'Buổi thực hiện không tồn tại hoặc đã bị xóa.');
        if (role === 'STAFF' && Number(history.branch_id) !== Number(branchId)) throw failure(403, 'Bạn không có quyền thao tác buổi của cơ sở khác.');
        const [[treatment]] = await connection.query(`SELECT id FROM \`${db}\`.treatments WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [history.treatment_id]);
        if (!treatment) throw failure(404, 'Thẻ liệu trình không tồn tại hoặc đã bị xóa.');
        if (action === 'sign' && (history.customer_signature_svg != null || history.customer_signed_at != null)) {
            throw failure(409, 'Buổi đã ký; không được ghi đè chữ ký.');
        }
        if (action === 'sign') {
            await connection.query(`UPDATE \`${db}\`.treatment_history SET customer_signature_svg=?, customer_signed_at=NOW(), updated_by=? WHERE id=?`, [metadata.signature, actor, id]);
        } else {
            await connection.query(`UPDATE \`${db}\`.treatment_history SET note=?, updated_by=? WHERE id=?`, [metadata.note, actor, id]);
        }
        const [[data]] = await connection.query(
            `SELECT id, treatment_id, branch_id, note, customer_signature_svg, customer_signed_at, updated_at, updated_by
             FROM \`${db}\`.treatment_history WHERE id=?`, [id]
        );
        await connection.commit();
        return { message: action === 'sign' ? 'Ký xác nhận buổi thành công' : 'Cập nhật ghi chú buổi thành công', data };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
};

module.exports = { updateHistoryMetadata };