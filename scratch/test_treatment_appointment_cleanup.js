const assert = require('node:assert/strict');

const state = { calls: [], history: null, remaining: 2, nextDays: 7, failAppointmentDelete: false, commits: 0, rollbacks: 0 };
const connection = {
    async beginTransaction() { state.calls.push({ sql: 'BEGIN' }); },
    async commit() { state.commits++; },
    async rollback() { state.rollbacks++; },
    release() {},
    async query(sql, params = []) {
        state.calls.push({ sql, params });
        if (sql.includes('SELECT t.customer_id, t.remaining_sessions')) return [[{
            customer_id: 1, remaining_sessions: state.remaining, product_id: 23,
            product_name: 'Chăm sóc da', next_appointment_days: state.nextDays
        }]];
        if (sql.includes('INSERT INTO `test_tenant`.treatment_history (')) return [{ insertId: 51 }];
        if (sql.includes('INSERT INTO `test_tenant`.appointments')) return [{ insertId: 71 }];
        if (sql.includes('SELECT treatment_id, branch_id, appointment_id')) return [state.history ? [state.history] : []];
        if (sql.includes('UPDATE `test_tenant`.appointments') && state.failAppointmentDelete) throw new Error('DB failure');
        return [{}];
    }
};
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection }
} };
const { executeTreatmentSession, deleteTreatmentHistory } = require('../src/services/treatmentService');
const find = fragment => state.calls.filter(call => call.sql.includes(fragment));
const reset = () => { state.calls = []; };

(async () => {
    await executeTreatmentSession(1, { treatment_id: 4, branch_id: 2 }, 'tester', 'MANAGER');
    assert.equal(find('INSERT INTO `test_tenant`.appointments').length, 1);
    assert.deepEqual(find('SET appointment_id = ?')[0].params, [71, 51]);
    assert.equal(state.commits, 1);

    reset();
    state.history = { treatment_id: 4, branch_id: 2, appointment_id: 71, execution_date: new Date(), created_at: new Date() };
    await deleteTreatmentHistory(1, 51, 'tester', 'STAFF', 2);
    assert.deepEqual(find('UPDATE `test_tenant`.appointments SET deleted_at')[0].params, ['tester', 71]);
    assert.match(find('UPDATE `test_tenant`.appointments SET deleted_at')[0].sql, /AND deleted_at IS NULL/);
    assert.equal(state.commits, 2);

    reset();
    state.history = { treatment_id: 4, branch_id: 2, appointment_id: null };
    await deleteTreatmentHistory(1, 50, 'tester', 'MANAGER');
    assert.equal(find('UPDATE `test_tenant`.appointments').length, 0);

    reset();
    state.history = { treatment_id: 4, branch_id: 3, appointment_id: 71 };
    await assert.rejects(deleteTreatmentHistory(1, 51, 'tester', 'STAFF', 2), /không có quyền/);
    assert.equal(find('UPDATE `test_tenant`.appointments').length, 0);

    reset();
    state.history = { treatment_id: 4, branch_id: 2, appointment_id: 71 };
    state.failAppointmentDelete = true;
    await assert.rejects(deleteTreatmentHistory(1, 51, 'tester', 'MANAGER'), /DB failure/);
    assert.equal(state.rollbacks, 2); // Wrong-branch and failed-delete transactions.
    state.failAppointmentDelete = false;

    reset();
    state.remaining = 1;
    await executeTreatmentSession(1, { treatment_id: 4, branch_id: 2 }, 'tester', 'MANAGER');
    assert.equal(find('INSERT INTO `test_tenant`.appointments').length, 0);
    assert.equal(find('SET appointment_id = ?').length, 0);

    console.log('PASS: generated appointment linked and soft-deleted on history removal; legacy/manual safety, permissions, rollback and last session');
})().catch(error => { console.error(error); process.exitCode = 1; });