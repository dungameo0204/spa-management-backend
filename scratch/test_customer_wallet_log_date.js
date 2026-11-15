const assert = require('node:assert/strict');

const state = { calls: [] };
const query = async (sql, params = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('.branches WHERE')) return [[{ id: 2 }]];
    if (sql.includes('.customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [[{ id: 1, wallet_balance: 500 }]];
    if (sql.startsWith('INSERT INTO')) return [{ insertId: 11 }];
    if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
};
const connection = {
    query,
    async beginTransaction() { state.calls.push({ sql: 'BEGIN' }); },
    async commit() { state.calls.push({ sql: 'COMMIT' }); },
    async rollback() { state.calls.push({ sql: 'ROLLBACK' }); },
    release() { state.calls.push({ sql: 'RELEASE' }); }
};
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant',
    masterPool: { getConnection: async () => connection }
} };
const { createWalletLog } = require('../src/services/customerWalletLogService');
const payload = { customer_id: 1, branch_id: 2, paid_amount: 100 };
const reset = () => { state.calls = []; };
const insertCall = () => state.calls.find(call => call.sql.startsWith('INSERT INTO'));

(async () => {
    reset();
    await createWalletLog(1, { ...payload, created_at: '2026-11-10 14:30:00' }, 'tester', 'MANAGER');
    assert.match(insertCall().sql, /created_at, created_by\)[\s\S]*COALESCE\(\?, NOW\(\)\)/);
    assert.equal(insertCall().params.at(-2), '2026-11-10 14:30:00');
    assert.ok(state.calls.some(call => call.sql === 'COMMIT'));

    reset();
    await createWalletLog(1, { ...payload, created_at: '2026-11-10' }, 'tester', 'MANAGER');
    assert.equal(insertCall().params.at(-2), '2026-11-10 00:00:00');

    reset();
    await createWalletLog(1, payload, 'tester', 'MANAGER');
    assert.equal(insertCall().params.at(-2), null);

    for (const createdAt of ['invalid', '2026-02-29', '2026-11-10 24:00:00', null, 0]) {
        reset();
        await assert.rejects(createWalletLog(1, { ...payload, created_at: createdAt }, 'tester', 'MANAGER'), /created_at/);
        assert.equal(state.calls.length, 0);
    }

    for (const createdAt of [undefined, null, '', '2026-11-10']) {
        reset();
        await assert.rejects(createWalletLog(1, { ...payload, created_at: createdAt }, 'tester', 'STAFF', 2), /Nhân viên không được gửi/);
        assert.equal(state.calls.length, 0);
    }
    console.log('PASS: wallet logs accept validated manager created_at, default to NOW(), and reject STAFF date input');
})().catch(error => { console.error(error); process.exitCode = 1; });