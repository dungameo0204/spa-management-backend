const assert = require('node:assert/strict');
const { normalize, time } = require('../src/utils/customerBooking');
assert.equal(time('07:00'), '07:00:00');
assert.equal(time('08:00:01'), '08:00:01');
for (const value of ['', '7:00', '24:00', '07:60', null, [], '07:00:00 OR 1=1']) assert.throws(() => time(value), e => e.status === 400);
const base = { customer_type: 'NEW', customer_name: ' Khách mới ', customer_phone: '0901234567', branch_id: 1, arrival_date: '2028-02-29' };
assert.equal(normalize(base).customer_name, 'Khách mới');
assert.equal(normalize(base).booking_time, null);
assert.equal(normalize({ ...base, arrival_time: '09:30' }).booking_time, '2028-02-29 09:30:00');
assert.equal(normalize({ ...base, consultation_total: '1200.50' }).consultation_total, '1200.50');
for (const patch of [{ arrival_date: '2026-02-29' }, { arrival_time: '24:00' }, { customer_id: 1 }, { customer_name: '' },
    { customer_phone: null }, { consultation_total: -1 }, { consultation_total: 1.234 }, { branch_id: true }, { status: '' }, { note: {} }, { booking_time: '2028-01-01' }]) {
    assert.throws(() => normalize({ ...base, ...patch }), e => e.status === 400);
}
assert.equal(normalize({ customer_type: 'EXISTING', customer_id: 1, branch_id: 1, arrival_date: '2028-01-01' }).customer_id, 1);
console.log('PASS: booking schema payload, calendar date/time, money precision, customer rules and protected fields.');