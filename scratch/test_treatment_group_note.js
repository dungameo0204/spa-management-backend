const assert = require('node:assert/strict');
const database = require.resolve('../src/config/database');
let writes = [], parent = { id: 10, parent_treatment_id: null }, allowed = true;
const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
        if (sql.startsWith('UPDATE')) { writes.push({ sql, params }); return [{}]; }
        if (sql.includes('SELECT id, parent_treatment_id')) return [[parent].filter(Boolean)];
        if (sql.includes('SELECT h.id')) return [allowed ? [{ id: 100 }] : []];
        return [[{ id: 11 }]];
    },
};
require.cache[database] = { id: database, filename: database, loaded: true, exports: {
    masterPool: { getConnection: async () => connection }, getTenantDbName: async () => 'test_tenant',
} };
const { updateGroupNote } = require('../src/services/treatmentGroupNoteService');
(async () => {
    const result = await updateGroupNote(1, 10, { note: ' làm lần 1 ' }, 'Tester', 'MANAGER', 1);
    assert.equal(result.data.note, 'làm lần 1');
    assert.equal(writes.length, 1);
    assert.match(writes[0].sql, /\.treatments SET note=/);
    assert.deepEqual(writes[0].params, ['làm lần 1', 'Tester', 10]);
    writes = [];
    allowed = false;
    await assert.rejects(updateGroupNote(1, 10, { note: 'x' }, 'Tester', 'STAFF', 2), e => e.status === 403);
    parent = { id: 11, parent_treatment_id: 10 };
    await assert.rejects(updateGroupNote(1, 11, { note: 'x' }, 'Tester', 'MANAGER', 1), e => e.status === 400);
    parent = null;
    await assert.rejects(updateGroupNote(1, 10, { note: 'x' }, 'Tester', 'MANAGER', 1), e => e.status === 404);
    await assert.rejects(updateGroupNote(1, 10, { note: 'đ'.repeat(32768) }, 'Tester', 'MANAGER', 1), e => e.status === 400);
    await assert.rejects(updateGroupNote(1, 10, { note: 'x', extra: true }, 'Tester', 'MANAGER', 1), e => e.status === 400);
    assert.equal(writes.length, 0);
    console.log('PASS: shared parent note writes once; child/branch/deleted/input guards.');
})().catch(error => { console.error(error); process.exitCode = 1; });