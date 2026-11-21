const assert = require('node:assert/strict');

const queries = [];
let existingPhone = false;
let oldBooking = null;
let rolledBack = false;
let createdCustomerCount = 0;
let customerByPhone = null;
let customerUpdates = [];
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: {
        getTenantDbName: async () => 'test_tenant',
        masterPool: {
            getConnection: async () => ({
                beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { rolledBack = true; }, release() {},
                query: async (sql, params = []) => {
                    queries.push({ sql, params });
                    if (sql.includes('FROM `test_tenant`.customer_bookings WHERE id=?')) return [oldBooking ? [oldBooking] : []];
                    if (sql.includes('FROM `test_tenant`.branches')) return [[{ id: 1 }]];
                    if (sql.includes('FROM `test_tenant`.customers WHERE phone_number=?')) {
                        if (customerByPhone && params[0] === customerByPhone.phone) return [[{ id: customerByPhone.id }]];
                        return [existingPhone ? [{ id: 4 }] : []];
                    }
                    if (sql.startsWith('INSERT INTO `test_tenant`.customers')) { createdCustomerCount += 1; return [{ insertId: 23 }]; }
                    if (sql.startsWith('UPDATE `test_tenant`.customers')) { customerUpdates.push(params); return [{ affectedRows: 1 }]; }
                    if (sql.includes('FROM `test_tenant`.customers WHERE id=?')) return [[{ fullname: 'Khách mới', phone_number: '0901234567' }]];
                    if (sql.startsWith('INSERT INTO `test_tenant`.customer_bookings')) return [{ insertId: 45 }];
                    if (sql.startsWith('UPDATE `test_tenant`.customer_bookings')) return [{ affectedRows: 1 }];
                    throw new Error(`Unexpected query: ${sql}`);
                }
            })
        }
    }
};
const { writeBooking } = require('../src/services/customerBookingService');
const body = { customer_type: 'NEW', customer_name: 'Khách mới', customer_phone: '0901234567', branch_id: 1, arrival_date: '2028-02-29' };

(async () => {
    let result = await writeBooking(7, null, body, 'tester', 'MANAGER');
    assert.equal(result.bookingId, 45);
    assert.equal(createdCustomerCount, 1);
    const bookingInsert = queries.find(call => call.sql.startsWith('INSERT INTO `test_tenant`.customer_bookings'));
    assert.equal(bookingInsert.params[1], null, 'NEW booking keeps customer_id null under the existing schema constraint');

    existingPhone = true; rolledBack = false; queries.length = 0;
    await assert.rejects(writeBooking(7, null, body, 'tester', 'MANAGER'), error => error.status === 400 && error.message === "Khách hàng với số điện thoại '0901234567' đã tồn tại trong hệ thống!");
    assert.equal(rolledBack, true);
    assert.equal(queries.some(call => call.sql.startsWith('INSERT INTO `test_tenant`.customer_bookings')), false, 'duplicate phone does not create a booking');

    existingPhone = false; oldBooking = { id: 45, customer_type: 'NEW', customer_id: null, customer_name: 'Khách mới', customer_phone: '0901234567', branch_id: 1, product_id: null, arrival_date: '2028-02-29', arrival_time: null, note: null, promotion_note: null, consultation_total: '0.00', status: 'PENDING' };
    customerByPhone = { id: 23, phone: '0901234567' };
    queries.length = 0; const before = createdCustomerCount;
    result = await writeBooking(7, 45, { note: 'Đã gọi lại' }, 'tester', 'MANAGER');
    assert.equal(result.bookingId, 45);
    assert.equal(createdCustomerCount, before, 'updating a NEW booking does not create another customer');
    result = await writeBooking(7, 45, { customer_name: 'Khách mới A1', customer_phone: '0901234568' }, 'tester', 'MANAGER');
    assert.equal(result.bookingId, 45);
    assert.deepEqual(customerUpdates.at(-1), ['Khách mới A1', '0901234568', 'tester', 23], 'PUT NEW booking updates the originally created customer atomically');
    customerByPhone = { id: 23, phone: '0901234567' };
    existingPhone = true;
    await assert.rejects(writeBooking(7, 45, { customer_phone: '0907654321' }, 'tester', 'MANAGER'), /đã tồn tại trong hệ thống/);
    existingPhone = false;
    customerByPhone = null;
    result = await writeBooking(7, 45, { note: 'Booking NEW legacy không có hồ sơ khách' }, 'tester', 'MANAGER');
    assert.equal(result.bookingId, 45, 'legacy NEW booking without a matching customer remains editable');
    await assert.rejects(writeBooking(7, 45, { customer_id: 99 }, 'tester', 'MANAGER'), /Khách NEW không được tự đặt customer_id/);
    oldBooking = { ...oldBooking, customer_type: 'EXISTING', customer_id: 9 };
    result = await writeBooking(7, 45, { customer_type: 'NEW', customer_name: 'Khách chuyển loại', customer_phone: '0907654321' }, 'tester', 'MANAGER');
    assert.equal(result.bookingId, 45);
    assert.equal(createdCustomerCount, before, 'updating or changing a booking to NEW does not create another customer');
    console.log('PASS: creating a NEW booking creates a customer atomically; PUT synchronizes its original customer, rejects duplicate phones, and preserves legacy NEW bookings without customer records.');
})().catch(error => { console.error(error); process.exitCode = 1; });