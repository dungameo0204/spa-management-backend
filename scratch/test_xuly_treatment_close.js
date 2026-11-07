const assert = require('node:assert/strict');

const state = { calls: [] };
const connection = {
    async beginTransaction() { state.calls.push({ sql: 'BEGIN' }); },
    async commit() { state.calls.push({ sql: 'COMMIT' }); },
    async rollback() { state.calls.push({ sql: 'ROLLBACK' }); },
    release() { state.calls.push({ sql: 'RELEASE' }); },
    async query(sql, params = []) {
        state.calls.push({ sql, params });
        if (sql.includes('WHERE id=? AND deleted_at IS NULL FOR UPDATE')) return [[{ id: 10, customer_id: 3, parent_treatment_id: null, closed_at: null }]];
        if (sql.includes('WHERE parent_treatment_id IN (?)')) {
            return state.calls.filter(call => call.sql.includes('WHERE parent_treatment_id IN (?)')).length === 1
                ? [[{ id: 11, customer_id: 3, closed_at: null }]]
                : [[]];
        }
        return [{ affectedRows: 2 }];
    }
};
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: { getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection } }
};

const { closeTreatment } = require('../src/services/treatmentService');
(async () => {
    const result = await closeTreatment(1, '10', {}, 'tester');
    assert.deepEqual(result.closedTreatmentIds, [10, 11]);
    const update = state.calls.find(call => call.sql.includes('closure_signature_svg=NULL'));
    assert.ok(update, 'Xuly close must clear/avoid closure signature storage');
    assert.deepEqual(update.params, ['tester', null, 'tester', [10, 11]]);
    await assert.rejects(closeTreatment(1, 10, { closure_signature_svg: '<svg />' }, 'tester'), /Chỉ nhận closure_note/);
    console.log('PASS: Xuly closes a treatment group without customer signature.');
})().catch(error => { console.error(error); process.exitCode = 1; });