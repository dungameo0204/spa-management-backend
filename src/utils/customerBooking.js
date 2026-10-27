const fail = message => Object.assign(new Error(message), { status: 400 });
const id = (value, field) => {
    if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw fail(`${field} không hợp lệ.`);
    return Number(value);
};
const text = (value, field, max, required = false, bytes = false) => {
    if (value == null && !required) return null;
    if (typeof value !== 'string' || (bytes ? Buffer.byteLength(value, 'utf8') : [...value].length) > max || (required && !value.trim())) throw fail(`${field} không hợp lệ (tối đa ${max} ${bytes ? 'byte UTF-8' : 'ký tự'}).`);
    return value.trim() || null;
};
const date = value => {
    if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw fail('arrival_date phải là ngày YYYY-MM-DD hợp lệ.');
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw fail('arrival_date không hợp lệ.');
    return value;
};
const fields = ['customer_type', 'customer_id', 'customer_name', 'customer_phone', 'branch_id', 'product_id', 'arrival_date', 'arrival_time', 'note', 'promotion_note', 'consultation_total', 'status'];
const time = (value, field = 'arrival_time') => {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw fail(`${field} phải là HH:mm hoặc HH:mm:ss trong ngày.`);
    return value.length === 5 ? `${value}:00` : value;
};
const normalize = (body, old = null) => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw fail('Payload booking chứa trường không được hỗ trợ.');
    const data = { customer_id: null, product_id: null, arrival_time: null, note: null, promotion_note: null, consultation_total: '0.00', status: 'PENDING', ...old, ...body };
    if (!['NEW', 'EXISTING'].includes(data.customer_type)) throw fail('customer_type chỉ nhận NEW hoặc EXISTING.');
    data.branch_id = id(data.branch_id, 'branch_id');
    data.customer_id = data.customer_id == null ? null : id(data.customer_id, 'customer_id');
    data.product_id = data.product_id == null ? null : id(data.product_id, 'product_id');
    if (data.customer_type === 'NEW' && data.customer_id !== null) throw fail('Khách NEW không được có customer_id.');
    if (data.customer_type === 'EXISTING' && data.customer_id === null) throw fail('Khách EXISTING bắt buộc customer_id.');
    data.customer_name = text(data.customer_name, 'customer_name', 255, data.customer_type === 'NEW');
    data.customer_phone = text(data.customer_phone, 'customer_phone', 50, data.customer_type === 'NEW');
    data.arrival_date = date(data.arrival_date);
    if (data.arrival_time != null) {
        if (typeof data.arrival_time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(data.arrival_time)) throw fail('arrival_time phải là HH:mm hoặc HH:mm:ss trong ngày.');
        if (data.arrival_time.length === 5) data.arrival_time += ':00';
    }
    for (const field of ['note', 'promotion_note']) data[field] = text(data[field], field, 65535, false, true);
    data.status = text(data.status, 'status', 50, true);
    if (!['number', 'string'].includes(typeof data.consultation_total) || !/^\d+(?:\.\d{1,2})?$/.test(String(data.consultation_total)) || !Number.isFinite(Number(data.consultation_total)) || Number(data.consultation_total) > 9999999999999.99) throw fail('consultation_total phải là số tiền không âm, tối đa 2 chữ số thập phân.');
    data.consultation_total = String(data.consultation_total);
    // Legacy timestamp is derived only when an arrival time exists; never invent midnight.
    data.booking_time = data.arrival_time === null ? null : `${data.arrival_date} ${data.arrival_time}`;
    return data;
};
module.exports = { fail, id, date, time, normalize, fields };