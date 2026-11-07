const { normalizeClosureSignature } = require('./treatmentSignature');
const invalid = message => Object.assign(new Error(message), { status: 400 });

const normalizeSessionMetadata = data => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('Dữ liệu buổi thực hiện không hợp lệ.');
    if (Object.hasOwn(data, 'customer_signed_at')) throw invalid('customer_signed_at do server tự ghi; không nhận từ client.');
    let note = data.note ?? null;
    if (note !== null) {
        if (typeof note !== 'string' || Buffer.byteLength(note, 'utf8') > 65535) throw invalid('note phải là chuỗi tối đa 65535 byte hoặc null.');
        note = note.trim() || null;
    }
    const signature = data.customer_signature_svg == null ? null : normalizeClosureSignature(data.customer_signature_svg);
    return { note, signature };
};

module.exports = { normalizeSessionMetadata };