// Calendar days follow the backend host's local timezone, not a rolling 24-hour window.
const isToday = (value, now = new Date()) => {
    if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim())) return false;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) &&
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
};

const assertStaffDateFieldsAbsent = (userRole, data, dateField) => {
    if (String(userRole).toUpperCase() !== 'STAFF') return;
    for (const field of [dateField, 'created_at']) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
            throw new Error(`Nhân viên không được gửi ${field}; ngày do hệ thống tự ghi nhận và không được thay đổi.`);
        }
    }
};

module.exports = { isToday, assertStaffDateFieldsAbsent };