const { masterPool, getTenantDbName } = require('../config/database');
const { normalizeContactContent } = require('../utils/appointmentContactNote');

const positiveId = value => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('ID không hợp lệ.');
    return id;
};

const formatNotes = notes => {
    const extra_note = notes.map(note => note.contact_date ? `${note.contact_date}: ${note.content}` : note.content).join('\n') || null;
    if (extra_note && Buffer.byteLength(extra_note, 'utf8') > 65535) throw new Error('Ghi chú liên hệ đã vượt giới hạn TEXT (65535 byte UTF-8).');
    return extra_note;
};

const readNotes = async (connection, dbName, ids) => {
    if (!ids.length) return [];
    const [notes] = await connection.query(
        `SELECT id, appointment_id, content, DATE_FORMAT(contact_date, '%d/%m/%Y') AS contact_date,
                created_at, created_by, updated_at, updated_by
         FROM \`${dbName}\`.appointment_contact_notes
         WHERE appointment_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL ORDER BY id ASC`, ids
    );
    return notes;
};

const attachContactNotes = async (dbName, appointments) => {
    const notes = await readNotes(masterPool, dbName, appointments.map(row => row.id));
    const grouped = new Map();
    for (const note of notes) {
        if (!grouped.has(note.appointment_id)) grouped.set(note.appointment_id, []);
        grouped.get(note.appointment_id).push(note);
    }
    return appointments.map(row => {
        const contact_notes = grouped.get(row.id) || [];
        return { ...row, extra_note: formatNotes(contact_notes), contact_notes };
    });
};

const mutateContactNote = async (action, tenantId, appointmentId, noteId, data, executorName, userRole, userBranchId) => {
    const role = String(userRole).toUpperCase();
    if (!['MANAGER', 'STAFF'].includes(role)) throw new Error('Chỉ MANAGER và STAFF được thao tác ghi chú liên hệ.');
    const id = positiveId(appointmentId);
    const targetId = action === 'create' ? null : positiveId(noteId);
    const content = action === 'delete' ? null : normalizeContactContent(data);
    const dbName = await getTenantDbName(tenantId);
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        const [[appointment]] = await connection.query(
            `SELECT branch_id FROM \`${dbName}\`.appointments WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [id]
        );
        if (!appointment) throw new Error('Lịch hẹn không tồn tại hoặc đã bị xóa.');
        if (role === 'STAFF' && Number(appointment.branch_id) !== Number(userBranchId)) throw new Error('Bạn không có quyền sửa lịch hẹn của cơ sở khác.');
        let changedId = targetId;
        if (action === 'create') {
            const [insert] = await connection.query(
                `INSERT INTO \`${dbName}\`.appointment_contact_notes (appointment_id, content, contact_date, created_by)
                 VALUES (?, ?, DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+07:00')), ?)`, [id, content, executorName]
            );
            changedId = insert.insertId;
        } else {
            const [[existing]] = await connection.query(
                `SELECT id FROM \`${dbName}\`.appointment_contact_notes WHERE id = ? AND appointment_id = ? AND deleted_at IS NULL FOR UPDATE`, [targetId, id]
            );
            if (!existing) throw new Error('Ghi chú không tồn tại, đã xóa hoặc không thuộc lịch hẹn này.');
            if (action === 'update') {
                await connection.query(`UPDATE \`${dbName}\`.appointment_contact_notes SET content = ?, updated_by = ? WHERE id = ?`, [content, executorName, targetId]);
            } else {
                await connection.query(`UPDATE \`${dbName}\`.appointment_contact_notes SET deleted_at = NOW(), deleted_by = ?, updated_by = ? WHERE id = ?`, [executorName, executorName, targetId]);
            }
        }
        const contact_notes = await readNotes(connection, dbName, [id]);
        const extra_note = formatNotes(contact_notes);
        await connection.query(`UPDATE \`${dbName}\`.appointments SET extra_note = ?, updated_by = ? WHERE id = ?`, [extra_note, executorName, id]);
        await connection.commit();
        const changed = contact_notes.find(note => Number(note.id) === Number(changedId));
        return {
            message: action === 'delete' ? 'Xóa ghi chú liên hệ thành công' : action === 'update' ? 'Cập nhật ghi chú liên hệ thành công' : 'Thêm ghi chú liên hệ thành công',
            data: { id, note_id: changedId, contact_date: changed?.contact_date || null,
                entry: changed ? (changed.contact_date ? `${changed.contact_date}: ${changed.content}` : changed.content) : null,
                extra_note, contact_notes }
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally { connection.release(); }
};

module.exports = { attachContactNotes, mutateContactNote, formatNotes };