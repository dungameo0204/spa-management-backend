const normalizeContactContent = (data) => {
    if (!data || typeof data.content !== 'string') throw new Error('content phải là chuỗi.');
    const content = data.content.replace(/\r\n?/g, '\n').trim();
    if (!content) throw new Error('content không được để trống.');
    if (content.includes('\0') || Buffer.byteLength(content, 'utf8') > 10000) {
        throw new Error('content không hợp lệ hoặc vượt quá 10000 byte UTF-8.');
    }
    return content;
};

const appendContactEntry = (previous, date, content) => {
    const entry = `${date}: ${content}`;
    const extraNote = previous ? `${previous}\n${entry}` : entry;
    if (Buffer.byteLength(extraNote, 'utf8') > 65535) throw new Error('Ghi chú liên hệ đã vượt giới hạn TEXT (65535 byte UTF-8).');
    return { entry, extra_note: extraNote };
};

const assertExtraNoteNotProvided = (data) => {
    if (Object.prototype.hasOwnProperty.call(data, 'extra_note') || Object.prototype.hasOwnProperty.call(data, 'contact_notes')) {
        throw new Error('extra_note/contact_notes chỉ được thao tác qua API contact-notes.');
    }
};

module.exports = { normalizeContactContent, appendContactEntry, assertExtraNoteNotProvided };