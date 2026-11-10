const assert = require('node:assert/strict');

const state = { calls: [], nextId: 500 };
const connection = {
    async beginTransaction() { state.calls.push({ sql: 'BEGIN' }); }, async commit() { state.calls.push({ sql: 'COMMIT' }); },
    async rollback() { state.calls.push({ sql: 'ROLLBACK' }); }, release() {},
    async query(sql, params = []) {
        state.calls.push({ sql, params });
        if (sql.includes('WHERE t.id=? AND t.deleted_at IS NULL FOR UPDATE')) return [[{ id: 100, customer_id: 7, closed_at: null, product_name: 'Chữa nám' }]];
        if (sql.includes('WHERE t.parent_treatment_id=?')) return [[
            { id: 101, customer_id: 7, remaining_sessions: 3, closed_at: null, product_id: 1, product_name: 'Laser nám', next_appointment_days: 0 },
            { id: 102, customer_id: 7, remaining_sessions: 2, closed_at: null, product_id: 2, product_name: 'Tàn nhang', next_appointment_days: 0 }
        ]];
        if (sql.includes('INSERT INTO `test_tenant`.treatment_history')) return [{ insertId: state.nextId++ }];
        if (sql.includes('SELECT role_id,branch_id')) return [[{ role_id: 1, branch_id: 2 }]];
        if (sql.includes('FROM `test_tenant`.treatments t') && sql.includes('commission_base_price')) return [[{ commission_base_price: 100, commission_quantity: 1 }]];
        if (sql.includes('FROM `test_tenant`.commission_rates')) return [[{ percentage: 10 }]];
        return [{ affectedRows: 1 }];
    }
};
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection } } };
const { executeTreatmentSession } = require('../src/services/treatmentService');

(async () => {
    const result = await executeTreatmentSession(1, { treatment_id: 100, branch_id: 2, execution_date: '2026-11-08', note: 'Ghi chú lần làm', children: [
        { treatment_id: 101, staffs: [{ staff_id: 11 }] }, { treatment_id: 102, staffs: [] }
    ] }, 'tester', 'MANAGER');
    assert.equal(result.treatmentHistoryId, 500);
    assert.equal(result.childTreatmentHistoryIds.length, 2);
    const inserts = state.calls.filter(call => call.sql.includes('INSERT INTO `test_tenant`.treatment_history\n'));
    assert.equal(inserts.length, 3);
    assert.deepEqual(inserts[0].params, [100, 2, '2026-11-08', 'tester', 'Ghi chú lần làm']);
    assert.deepEqual(inserts[1].params, [101, 500, 2, '2026-11-08', 'tester']);
    assert.deepEqual(inserts[2].params, [102, 500, 2, '2026-11-08', 'tester']);
    const decrements = state.calls.filter(call => call.sql.includes('remaining_sessions=CASE'));
    assert.deepEqual(decrements.map(call => call.params), [['tester', 101], ['tester', 102]]);
    assert.equal(decrements.some(call => call.params.includes(100)), false, 'Parent treatment must not lose a session.');
    assert.equal(state.calls.filter(call => call.sql.includes('treatment_history_staffs')).length, 1);
    assert.ok(state.calls.some(call => call.sql === 'COMMIT'));
    state.calls = [];
    await assert.rejects(executeTreatmentSession(1, { treatment_id: 100, branch_id: 2, children: [{ treatment_id: 101, staffs: [] }, { treatment_id: 999, staffs: [] }] }, 'tester', 'MANAGER'), /không thuộc liệu trình cha/);
    assert.ok(state.calls.some(call => call.sql === 'ROLLBACK'), 'Invalid child must roll back the entire grouped request.');
    assert.equal(state.calls.some(call => call.sql.includes('INSERT INTO `test_tenant`.treatment_history')), false, 'Validation failure must not create a parent visit.');
    console.log('PASS: grouped execution creates parent/child histories, only decrements selected child cards and keeps child commissions.');
})().catch(error => { console.error(error); process.exitCode = 1; });