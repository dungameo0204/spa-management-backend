const assert = require('node:assert/strict');
const calls = [];
let failItem = false;
const connection = {
    beginTransaction: async () => calls.push('BEGIN'), commit: async () => calls.push('COMMIT'),
    rollback: async () => calls.push('ROLLBACK'), release: () => {},
    query: async (sql, params) => {
        calls.push({ sql, params });
        if (failItem && sql.includes('INSERT INTO `test_tenant`.expenses_vouchers_items')) throw new Error('item error');
        return [{ insertId: 4, affectedRows: 1 }];
    }
};
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant', masterPool: {
        getConnection: async () => connection,
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (sql.includes('.branches WHERE')) return [[{ id: 1 }]];
            if (sql.includes('SELECT e.*, b.name')) return [[{ id: 4, branch_id: 1, amount: '30.00' }]];
            if (sql.includes('SELECT branch_id FROM')) return [[{ branch_id: 1 }]];
            if (sql.includes('FROM `test_tenant`.expenses_vouchers_items')) return [[{ id: 2, expenses_voucher_id: 4, expense_type: 'Điện', amount: '30.00' }]];
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    }
} };
const service = require('../src/services/expenseService');
(async () => {
    await assert.rejects(service.createExpense(1, { branch_id: 1, items: [{ expense_type: 'X', amount: -2 }] }, 'tester', 'MANAGER'), /amount/);
    const result = await service.createExpense(1, { branch_id: 1, items: [{ expense_type: 'Điện', amount: 10 }, { expense_type: 'Nước', amount: 20 }] }, 'tester', 'MANAGER');
    assert.equal(result.amount, 30);
    assert.equal(calls.find(c => c.sql?.includes('INSERT INTO `test_tenant`.expense_vouchers\n')).params[1], 30);
    assert.equal(calls.filter(c => c.sql?.includes('INSERT INTO `test_tenant`.expenses_vouchers_items')).length, 2);
    assert.equal((await service.getExpenseDetail(1, 4, 'MANAGER')).items[0].expense_type, 'Điện');
    await service.updateExpense(1, 4, { items: [{ expense_type: 'Điện', amount: 30 }] }, 'tester', 'MANAGER');
    assert.ok(calls.some(c => c.sql?.includes('DELETE FROM `test_tenant`.expenses_vouchers_items')));
    failItem = true;
    await assert.rejects(service.createExpense(1, { branch_id: 1, items: [{ expense_type: 'X', amount: 1 }] }, 'tester', 'MANAGER'), /item error/);
    assert.equal(calls.at(-1), 'ROLLBACK');
    console.log('PASS: multi-item expense, detail, replacement, rollback');
})().catch(error => { console.error(error); process.exitCode = 1; });