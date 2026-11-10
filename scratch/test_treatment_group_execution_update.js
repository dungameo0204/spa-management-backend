const assert = require('node:assert/strict');

const state = { calls: [], nextId: 602, pnpRemaining: 3 };
const connection = {
    async beginTransaction() { state.calls.push({ sql: 'BEGIN' }); }, async commit() { state.calls.push({ sql: 'COMMIT' }); },
    async rollback() { state.calls.push({ sql: 'ROLLBACK' }); }, release() {},
    async query(sql, params = []) {
        state.calls.push({ sql, params });
        if (sql.includes('FROM `test_tenant`.treatment_history WHERE id=?')) return [[{ id: 501, treatment_id: 100, parent_history_id: null, branch_id: 2, execution_date: new Date(), created_at: new Date(), note: 'Làm Laser nhầm' }]];
        if (sql.includes('FROM `test_tenant`.treatments WHERE id=?')) return [[{ id: 100, customer_id: 7, parent_treatment_id: null, closed_at: null }]];
        if (sql.includes('FROM `test_tenant`.treatments t JOIN')) return [[
            { id: 101, customer_id: 7, remaining_sessions: 2, closed_at: null, product_name: 'Laser' },
            { id: 102, customer_id: 7, remaining_sessions: state.pnpRemaining, closed_at: null, product_name: 'PNP' }
        ]];
        if (sql.includes('WHERE parent_history_id=? AND deleted_at IS NULL FOR UPDATE')) return [[{ id: 601, treatment_id: 101, parent_history_id: 501, appointment_id: null }]];
        if (sql.includes('INSERT INTO `test_tenant`.treatment_history (treatment_id,parent_history_id')) return [{ insertId: state.nextId++ }];
        if (sql.includes('SELECT role_id,branch_id')) return [[{ role_id: 1, branch_id: 2 }]];
        if (sql.includes('FROM `test_tenant`.treatments t') && sql.includes('commission_base_price')) return [[{ commission_base_price: 100, commission_quantity: 1 }]];
        if (sql.includes('product_commission_tiers')) return [[]];
        if (sql.includes('product_commissions')) return [[]];
        return [{ affectedRows: 1 }];
    }
};
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection } } };
const { updateGroupedExecution } = require('../src/services/treatmentService');

(async () => {
    const result = await updateGroupedExecution(1, 501, { treatment_id: 100, note: 'Đổi sang PNP', children: [{ treatment_id: 102, staffs: [{ staff_id: 11 }] }] }, 'tester', 'MANAGER');
    assert.equal(result.treatmentHistoryId, 501);
    assert.deepEqual(result.childTreatmentHistoryIds, [602]);
    assert.deepEqual(result.removedTreatmentHistoryIds, [601]);
    const laserHistory = state.calls.find(call => call.sql.includes('treatment_history SET deleted_at=NOW()') && call.params.includes(601));
    assert.ok(laserHistory, 'Laser history must be soft-deleted.');
    assert.ok(state.calls.some(call => call.sql.includes('treatment_history_staffs SET deleted_at=NOW()') && call.params.includes(601)), 'Laser staff mappings must be soft-deleted.');
    assert.ok(state.calls.some(call => call.sql.includes('remaining_sessions=remaining_sessions+1') && call.params.includes(101)), 'Laser session must be restored.');
    assert.ok(state.calls.some(call => call.sql.includes('remaining_sessions=remaining_sessions-1') && call.params.includes(102)), 'PNP session must be decremented.');
    const pnpInsert = state.calls.find(call => call.sql.includes('INSERT INTO `test_tenant`.treatment_history (treatment_id,parent_history_id'));
    assert.deepEqual(pnpInsert.params.slice(0, 2), [102, 501]);
    assert.ok(state.calls.some(call => call.sql === 'COMMIT'));
    state.calls = []; state.pnpRemaining = 0;
    await assert.rejects(updateGroupedExecution(1, 501, { treatment_id: 100, children: [{ treatment_id: 102, staffs: [] }] }, 'tester', 'MANAGER'), /đã hết buổi/);
    assert.ok(state.calls.some(call => call.sql === 'ROLLBACK'), 'A failed replacement must roll back the visit update.');
    assert.equal(state.calls.some(call => call.sql.includes('treatment_history SET deleted_at=NOW()')), false, 'Failed replacement must not soft-delete Laser.');
    state.pnpRemaining = 3;
    state.calls = [];
    const cleared = await updateGroupedExecution(1, 501, { treatment_id: 100, children: [] }, 'tester', 'MANAGER');
    assert.equal(cleared.parentHistoryDeleted, true);
    assert.deepEqual(cleared.childTreatmentHistoryIds, []);
    assert.deepEqual(cleared.removedTreatmentHistoryIds, [601]);
    assert.ok(state.calls.some(call => call.sql.includes('treatment_history SET deleted_at=NOW()') && call.params[1] === 501));
    assert.equal(state.calls.filter(call => call.sql.includes('remaining_sessions=remaining_sessions+1')).length, 1);
    assert.ok(state.calls.some(call => call.sql === 'COMMIT'));
    console.log('PASS: grouped visit update soft-deletes removed Laser, restores its session and creates PNP under the same parent visit.');
})().catch(error => { console.error(error); process.exitCode = 1; });