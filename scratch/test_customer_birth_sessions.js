const assert = require('node:assert/strict');
const { normalizeDateOfBirth } = require('../src/utils/dateOfBirth');
const calls = [];
let remaining = 0;
let histories = 0;
let storedDob = null;
const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO `test_tenant`.customers')) { storedDob = params[7]; return [{ insertId: 1 }]; }
    if (sql.includes('UPDATE `test_tenant`.customers')) { if (sql.includes('date_of_birth = ?')) storedDob = params[0]; return [{}]; }
    if (sql.includes('SELECT COUNT(*)')) return [[{ total: 1 }]];
    if (sql.includes('FROM `test_tenant`.customers')) {
        if (sql.includes('phone_number = ?')) return [[]];
        if (sql.includes('DATE_FORMAT')) {
            assert.doesNotMatch(sql, /SELECT[^]*\bpassword\b/);
            return [[{ id: 1, date_of_birth: storedDob }]];
        }
        return [[{ id: 1 }]];
    }
    if (sql.includes('INSERT INTO `test_tenant`.treatments')) { remaining = params[3]; return [{ insertId: 7 }]; }
    if (sql.includes('SELECT t.customer_id, t.remaining_sessions')) return [[{ customer_id: 1, remaining_sessions: remaining, next_appointment_days: 0 }]];
    if (sql.includes('remaining_sessions = remaining_sessions - 1')) { remaining--; return [{}]; }
    if (sql.includes('INSERT INTO `test_tenant`.treatment_history')) { histories++; return [{ insertId: histories }]; }
    if (sql.includes('FROM `test_tenant`.invoices') || sql.includes('FROM `test_tenant`.treatments t')) return [[]];
    throw new Error(`Unexpected SQL: ${sql}`);
};
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant',
    masterPool: { query, getConnection: async () => ({ query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) }
} };
const customers = require('../src/services/customerService');
const treatments = require('../src/services/treatmentService');

(async () => {
    const today = new Date(2026, 9, 25, 12);
    for (const value of [undefined, null, '']) assert.equal(normalizeDateOfBirth(value, today), null);
    for (const value of ['2000-02-29', '1995-08-21', '2026-10-25', '1000-01-01']) assert.equal(normalizeDateOfBirth(value, today), value);
    for (const value of ['1900-02-29', '2025-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-10-26', '0999-01-01', '1995-8-21', '21/08/1995', '2000-01-01T00:00:00Z', ' ', false, 1995, {}, []]) {
        assert.throws(() => normalizeDateOfBirth(value, today), error => error.status === 400);
    }
    await customers.createCustomer(1, { fullname: 'A', phone_number: '0900000000' }, 'tester');
    assert.equal(storedDob, null);
    await customers.createCustomer(1, { fullname: 'A', phone_number: '0900000000', date_of_birth: '1995-08-21' }, 'tester');
    assert.equal(storedDob, '1995-08-21');
    assert.equal((await customers.getCustomerById(1, 1)).date_of_birth, storedDob);
    assert.equal((await customers.getCustomers(1, '', {})).data[0].date_of_birth, storedDob);
    assert.equal((await customers.getCustomerOverview(1, 1)).customer.date_of_birth, storedDob);
    await customers.updateCustomer(1, 1, { note: 'Unchanged birthday' }, 'tester');
    assert.equal(storedDob, '1995-08-21');
    for (const value of [null, '', '2000-02-29']) {
        await customers.updateCustomer(1, 1, { date_of_birth: value }, 'tester');
        assert.equal(storedDob, value || null);
    }
    for (const operation of [() => customers.createCustomer(1, { date_of_birth: '2025-02-29' }, 'tester'), () => customers.updateCustomer(1, 1, { date_of_birth: '2025-02-29' }, 'tester')]) {
        const before = calls.length;
        await assert.rejects(operation(), /date_of_birth/);
        assert.equal(calls.length, before);
    }
    const base = { customer_id: 1, product_id: 2, total_sessions: 10, commission_base_price: 900000 };
    await treatments.createTreatment(1, base, 'tester');
    assert.equal(remaining, 10);
    assert.equal(histories, 0);
    for (const value of [0, 4, 10, '4']) {
        await treatments.createTreatment(1, { ...base, remaining_sessions: value }, 'tester');
        assert.equal(remaining, Number(value));
    }
    for (const value of [null, '', ' ', true, false, [], {}, -1, 11, 1.5, 'NaN', Infinity, 2147483648]) {
        const before = calls.length;
        await assert.rejects(treatments.createTreatment(1, { ...base, remaining_sessions: value }, 'tester'));
        assert.equal(calls.length, before);
    }
    for (const value of [undefined, null, '', false, [], 0, -1, 1.5, 2147483648]) {
        await assert.rejects(treatments.createTreatment(1, { ...base, total_sessions: value }, 'tester'));
    }
    await treatments.createTreatment(1, { ...base, remaining_sessions: 4 }, 'tester');
    assert.equal(histories, 0); // Import must not invent six past sessions/commissions.
    for (let i = 3; i >= 0; i--) {
        await treatments.executeTreatmentSession(1, { treatment_id: 7, branch_id: 1 }, 'tester', 'MANAGER');
        assert.equal(remaining, i);
    }
    await assert.rejects(treatments.executeTreatmentSession(1, { treatment_id: 7, branch_id: 1 }, 'tester', 'MANAGER'), /hết số buổi/);
    assert.equal(histories, 4);
    assert.ok(calls.some(call => call.sql.includes('FOR UPDATE')));
    console.log('PASS: calendar DOB, create/update/read contracts, strict counts, imported sessions consumed from remaining balance without fake history.');
})().catch(error => { console.error(error); process.exitCode = 1; });