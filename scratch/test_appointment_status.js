const assert = require('node:assert/strict');

const calls = [];
const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql.includes('.customers WHERE id')) return [[{ id: 1 }]];
        if (sql.includes('.branches WHERE id')) return [[{ id: 2 }]];
        if (sql.includes('INSERT INTO `test_tenant`.appointments')) return [{ insertId: 7 }];
        if (sql.includes('SELECT branch_id FROM `test_tenant`.appointments')) return [[{ branch_id: 2 }]];
        if (sql.includes('SELECT COUNT(*) AS total')) return [[{ total: 1 }]];
        if (sql.includes('SELECT a.*')) return [[{
            id: 7, branch_id: 2, status: 'Chờ xử lý', calculated_status: 'Khách đã đến',
            customer_name: 'Test'
        }]];
        return [{}];
    }
};
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: { getTenantDbName: async () => 'test_tenant', masterPool: {
        getConnection: async () => connection, query: (...args) => connection.query(...args)
    } }
};
const service = require('../src/services/appointmentService');

(async () => {
    await assert.rejects(service.createAppointment(1, {
        customer_id: 1, branch_id: 2, appointment_date: '2026-10-07 09:00:00', status: 'Khách đã đến'
    }, 'tester', 'MANAGER'), /status được hệ thống tự tính/);
    await assert.rejects(service.updateAppointment(1, 7, { status: 'Khách đã đến' }, 'tester', 'MANAGER'),
        /status được hệ thống tự tính/);
    await service.createAppointment(1, { customer_id: 1, branch_id: 2,
        appointment_date: '2026-10-07 09:00:00' }, 'tester', 'MANAGER');
    const insert = calls.find(call => call.sql.includes('INSERT INTO `test_tenant`.appointments'));
    assert.equal(insert.params[4], 'Khách chưa đến');

    const tomorrow = await service.getAppointments(1, {}, 'STAFF', 2, 'tomorrow');
    assert.equal(tomorrow.data[0].status, 'Khách đã đến');
    assert.equal('calculated_status' in tomorrow.data[0], false);
    let query = calls.at(-1);
    assert.match(query.sql, /a\.branch_id = \?/);
    assert.deepEqual(query.params, [2, 20, 0]);
    assert.match(query.sql, /CURDATE\(\) \+ INTERVAL 1 DAY/);
    assert.match(query.sql, /event\.deleted_at IS NULL AND event\.created_at >= DATE\(a\.appointment_date\)/);
    assert.match(query.sql, /event\.created_at >= a\.created_at/);
    assert.match(query.sql, /t\.deleted_at IS NULL/);
    assert.match(query.sql, /next_a\.appointment_date <= event\.created_at/);

    await service.getAppointments(1, { branchId: 2, status: 'Khách chưa đến' }, 'MANAGER', null, 'not-arrived');
    query = calls.at(-1);
    assert.match(query.sql, /a\.appointment_date < CURDATE\(\) \+ INTERVAL 1 DAY/);
    assert.deepEqual(query.params, [2, 'Khách chưa đến', 'Khách chưa đến', 20, 0]);
    await assert.rejects(service.getAppointments(1, { status: 'Chờ xử lý' }, 'MANAGER'), /status không hợp lệ/);

    const detail = await service.getAppointmentDetail(1, 7, 'STAFF', 2);
    assert.equal(detail.status, 'Khách đã đến');
    assert.deepEqual(calls.at(-1).params, [7, 2]);
    console.log('PASS: appointment status, tomorrow/not-arrived filters and branch permissions');
})().catch(error => { console.error(error); process.exitCode = 1; });