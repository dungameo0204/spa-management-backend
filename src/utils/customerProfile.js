const { normalizeDateOfBirth } = require('./dateOfBirth');

// Stable API codes; labels belong to the frontend.
const SKIN_TYPES = Object.freeze(['DRY', 'OILY_ACNE', 'SENSITIVE_DAMAGED', 'AGING', 'COMBINATION', 'PIGMENTED', 'OTHER']);
const REFERRAL_SOURCES = Object.freeze(['TIKTOK', 'FACEBOOK', 'FRIEND', 'OTHER']);
const GENDERS = Object.freeze(['MALE', 'FEMALE', 'OTHER']);
const PROFILE_TEXT_FIELDS = Object.freeze([
    'referral_note', 'previous_skin_treatments', 'peeling_products_history',
    'current_skincare_products', 'skincare_routine', 'pigmentation_onset',
    'family_skin_history', 'pregnancy_and_medical_history', 'cosmetic_reaction_history',
    'skin_assessment', 'consultation_note'
]);
const PROFILE_FIELDS = Object.freeze([
    'profile_code', 'profile_date', 'gender', 'skin_types', 'referral_sources', ...PROFILE_TEXT_FIELDS
]);
const invalid = message => Object.assign(new Error(message), { status: 400 });

const normalizeCustomerProfile = data => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('Dữ liệu khách hàng phải là object.');
    const result = {};
    for (const field of PROFILE_FIELDS) {
        const value = data[field];
        if (value === undefined) continue;
        if (value === null) { result[field] = null; continue; }
        if (field === 'profile_date') {
            try { result[field] = normalizeDateOfBirth(value); }
            catch { throw invalid('profile_date phải là ngày hợp lệ YYYY-MM-DD và không được ở tương lai.'); }
        } else if (field === 'skin_types' || field === 'referral_sources') {
            const choices = field === 'skin_types' ? SKIN_TYPES : REFERRAL_SOURCES;
            if (!Array.isArray(value) || value.length > choices.length || value.some(item => !choices.includes(item))) {
                throw invalid(`${field} phải là mảng mã hợp lệ: ${choices.join(', ')}; hoặc null.`);
            }
            result[field] = [...new Set(value)];
        } else if (field === 'gender') {
            if (!GENDERS.includes(value)) throw invalid(`gender phải là ${GENDERS.join(', ')}; hoặc null.`);
            result[field] = value;
        } else {
            if (typeof value !== 'string') throw invalid(`${field} phải là chuỗi hoặc null.`);
            const text = value.trim();
            if (field === 'profile_code' ? Array.from(text).length > 50 : Buffer.byteLength(text, 'utf8') > 65535) {
                throw invalid(`${field} vượt giới hạn ${field === 'profile_code' ? '50 ký tự' : '65535 byte UTF-8'}.`);
            }
            result[field] = text || null;
        }
    }
    return result;
};

const profileSqlValue = (field, value) =>
    (field === 'skin_types' || field === 'referral_sources') && value !== null ? JSON.stringify(value) : value;

const profileSelect = () => PROFILE_FIELDS.map(field => field === 'profile_date'
    ? "DATE_FORMAT(profile_date, '%Y-%m-%d') AS profile_date" : field).join(', ');

module.exports = { SKIN_TYPES, REFERRAL_SOURCES, GENDERS, PROFILE_FIELDS, PROFILE_TEXT_FIELDS, normalizeCustomerProfile, profileSqlValue, profileSelect };