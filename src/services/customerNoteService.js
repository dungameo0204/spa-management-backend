const normalizeInvoiceNote = value => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new Error('note phải là chuỗi hoặc null.');
    const note = value.trim();
    if (Buffer.byteLength(note, 'utf8') > 65535) throw new Error('Ghi chú vượt giới hạn dung lượng TEXT.');
    return note || null;
};

const formatInvoiceNoteEntry = (invoiceId, action, note, now = new Date()) => {
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${now.getFullYear()} [HĐ #${invoiceId} - ${action}]${note ? ` ${note}` : ''}`;
};

// Append against the current row under MySQL's UPDATE lock, never a stale JS snapshot.
// The byte guard prevents TEXT truncation even when MySQL strict mode is disabled.
const appendInvoiceCustomerNote = async (connection, dbName, customerId, invoiceId, action, note, executorName, now) => {
    const entry = formatInvoiceNoteEntry(invoiceId, action, note, now);
    const [result] = await connection.query(
        `UPDATE \`${dbName}\`.customers
         SET note = CONCAT(COALESCE(note, ''), IF(COALESCE(note, '') = '', '', CHAR(10)), ?), updated_by = ?
         WHERE id = ? AND OCTET_LENGTH(COALESCE(note, '')) + IF(COALESCE(note, '') = '', 0, 1) + OCTET_LENGTH(?) <= 65535`,
        [entry, executorName, customerId, entry]
    );
    if (result.affectedRows !== 1) {
        throw new Error('Không thể lưu lịch sử ghi chú khách hàng: khách không tồn tại hoặc ghi chú vượt giới hạn TEXT.');
    }
};

module.exports = { normalizeInvoiceNote, formatInvoiceNoteEntry, appendInvoiceCustomerNote };