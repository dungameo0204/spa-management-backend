// Calendar-only value: never convert a birthday to a timezone-dependent timestamp.
const normalizeDateOfBirth = (value, today = new Date()) => {
    if (value === undefined || value === null || value === '') return null;
    const invalid = () => {
        const error = new Error('date_of_birth phải là ngày hợp lệ YYYY-MM-DD và không được ở tương lai.');
        error.status = 400;
        return error;
    };
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
    const [year, month, day] = value.split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || value > localToday) throw invalid();
    return value;
};

module.exports = { normalizeDateOfBirth };