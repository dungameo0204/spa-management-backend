const assert = require('node:assert/strict');
const state = { calls: [], remaining: [], failCleanup: false, deleted: false };
const connection = {
    async beginTransaction() { state.calls.push({ sql: 'BEGIN' }); },
    async commit() { state.calls.push({ sql: 'COMMIT' }); },
    async rollback() { state.calls.push({ sql: 'ROLLBACK' }); },
    release() {},
    async query(sql, params = []) {
        state.calls.push({ sql, params });
        if (sql.includes('WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [state.deleted ? [] : [{ id: 601, treatment_id: 101, parent_history_id: 501, branch_id: 2, execution_date: new Date(), created_at: new Date() }]];
        if (sql.includes('SELECT id FROM `test_tenant`.treatment_history WHERE id=?')) return [[{ id: 501 }]];
        if (sql.includes('SELECT id FROM `test_tenant`.treatment_history WHERE parent_history_id=?')) return [state.remaining];
        if (state.failCleanup && sql.includes('treatment_history SET deleted_at=NOW()') && params[1] === 501) throw new Error('cleanup failure');
        if (sql.startsWith('SELECT')) throw new Error(`Unexpected SQL: ${sql}`);
        return [{ affectedRows: 1 }];
    }
};
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection } } };
const { deleteTreatmentHistory } = require('../src/services/treatmentService');
(async () => {
    state.remaining = [{ id: 602 }];
    let result = await deleteTreatmentHistory(1, 601, 'tester', 'STAFF', 2);
    assert.equal(result.parentHistoryDeleted, false);
    assert.equal(state.calls.some(call => call.sql.includes('treatment_history SET deleted_at=NOW()') && call.params[1] === 501), false);
    state.calls = []; state.remaining = [];
    result = await deleteTreatmentHistory(1, 601, 'tester', 'MANAGER');
    assert.equal(result.parentHistoryDeleted, true);
    assert.equal(result.parentHistoryId, 501);
    const restorations = state.calls.filter(call => call.sql.includes('remaining_sessions = remaining_sessions + 1'));
    assert.equal(restorations.length, 1);
    assert.deepEqual(restorations[0].params, ['tester', 101, 601]);
    assert.ok(state.calls.some(call => call.sql.includes('treatment_history SET deleted_at=NOW()') && call.params[1] === 501));
    assert.ok(state.calls.some(call => call.sql === 'COMMIT'));
    state.calls = []; state.failCleanup = true;
    await assert.rejects(deleteTreatmentHistory(1, 602, 'tester', 'MANAGER'), /cleanup failure/);
    assert.ok(state.calls.some(call => call.sql === 'ROLLBACK'));
    assert.equal(state.calls.some(call => call.sql === 'COMMIT'), false);
    state.calls = []; state.failCleanup = false; state.deleted = true;
    await assert.rejects(deleteTreatmentHistory(1, 601, 'tester', 'MANAGER'), error => error.message === 'Lịch sử không tồn tại hoặc đã bị xóa.');
    assert.equal(state.calls.some(call => call.sql.includes('remaining_sessions = remaining_sessions + 1')), false);
    console.log('PASS: child undo preserves nonempty visit, removes empty parent without restoring parent sessions, rolls back cleanup errors and rejects repeated undo.');
})().catch(error => { console.error(error); process.exitCode = 1; });
