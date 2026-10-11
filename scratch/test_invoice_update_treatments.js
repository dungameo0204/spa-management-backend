const assert = require('node:assert/strict');

const createdAt = new Date('2026-10-01T09:00:00Z');
const products = new Map([
    [1, { name: 'Combo', price: 100, unit: 'gói', is_product: 0, is_treatment_combo: 1, default_sessions: 1 }],
    [2, { name: 'Kem', price: 20, unit: 'hộp', is_product: 1, is_treatment_combo: 0, default_sessions: 0 }],
    [3, { name: 'Combo mới', price: 50, unit: 'gói', is_product: 0, is_treatment_combo: 1, default_sessions: 2 }]
]);
const state = { cards: [], queries: [], nextId: 200, commits: 0, rollbacks: 0 };
const connection = {
    async beginTransaction() {},
    async commit() { state.commits++; },
    async rollback() { state.rollbacks++; },
    release() {},
    async query(sql, params = []) {
        state.queries.push({ sql, params });
        if (sql.includes('.invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [[{
            id: 20, branch_id: 1, customer_id: 7, created_at: createdAt, total_amount: 500,
            discount_percent: 0, discount_amount: 0, paid_amount: 0, wallet_used: 0,
            debt_amount: 0, payment_method: 'CASH', note: null
        }]];
        if (sql.includes('.customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [[{ id: params[0], wallet_balance: 0 }]];
        if (sql.includes('.products WHERE id = ?')) return [products.has(params[0]) ? [products.get(params[0])] : []];
        if (sql.includes('.debt_payments WHERE invoice_id = ?')) return [[]];
        if (sql.includes('FROM `test_tenant`.treatments WHERE invoice_id = ?') && sql.includes('FOR UPDATE')) return [state.cards.map(card => ({ ...card }))];
        if (sql.includes('SELECT id, product_id, quantity FROM `test_tenant`.invoice_items')) return [[{ id: 12, product_id: 1, quantity: 5 }]];
        if (sql.includes('INSERT INTO `test_tenant`.treatments')) return [{ insertId: state.nextId++ }];
        if (sql.startsWith('INSERT INTO')) return [{ insertId: state.nextId++ }];
        if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected SQL: ${sql}`);
    }
};
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true,
    exports: { getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection } } };
const { updateInvoice } = require('../src/services/invoiceService');
const combo = quantity => ({ product_id: 1, quantity });
const run = items => updateInvoice(1, 20, { items }, 'tester', 'MANAGER');
const card = (id, product_id, total_sessions, remaining_sessions) => ({ id, product_id, total_sessions, remaining_sessions, customer_id: 7, note: null });
const changes = pattern => state.queries.filter(q => pattern.test(q.sql));

(async () => {
    state.cards = [card(10, 1, 5, 3)];
    await run([combo(5), { product_id: 2, quantity: 1 }]);
    assert.equal(changes(/UPDATE `test_tenant`\.treatments SET deleted_at/).length, 0);
    assert.equal(changes(/INSERT INTO `test_tenant`\.treatments/).length, 0);
    assert.equal(changes(/UPDATE `test_tenant`\.treatments SET customer_id/).length, 0);

    state.queries.length = 0;
    await run([combo(3)]);
    assert.deepEqual(changes(/UPDATE `test_tenant`\.treatments SET customer_id/)[0].params.slice(0, 4), [7, 3, 1, null]);
    assert.equal(changes(/INSERT INTO `test_tenant`\.treatments/).length, 0);

    state.queries.length = 0;
    await run([combo(2)]);
    assert.equal(changes(/UPDATE `test_tenant`\.treatments SET customer_id/)[0].params[2], 0);

    state.queries.length = 0;
    const committed = state.commits;
    await assert.rejects(run([combo(1)]), /2 buổi đã sử dụng/);
    assert.equal(state.commits, committed);
    assert.equal(state.rollbacks > 0, true);

    state.queries.length = 0;
    await assert.rejects(run([{ product_id: 2, quantity: 1 }]), /Không thể xóa liệu trình/);
    assert.equal(changes(/UPDATE `test_tenant`\.treatments SET deleted_at/).length, 0);

    state.queries.length = 0;
    await assert.rejects(updateInvoice(1, 20, { customer_id: 8, items: [combo(5)] }, 'tester', 'MANAGER'), /Không thể chuyển liệu trình/);

    state.cards = [card(10, 1, 5, 5)];
    state.queries.length = 0;
    await run([{ product_id: 3, quantity: 1 }]);
    assert.deepEqual(changes(/UPDATE `test_tenant`\.treatments SET deleted_at/)[0].params, ['tester', 10]);
    assert.equal(changes(/INSERT INTO `test_tenant`\.treatments/)[0].params.at(-1), createdAt);

    state.cards = [];
    state.queries.length = 0;
    await run([combo(5)]);
    assert.equal(changes(/INSERT INTO `test_tenant`\.treatments/)[0].params.at(-1), createdAt);
    console.log('PASS: preserve used treatment, adjust remaining sessions, guard removals, preserve invoice creation date');
})().catch(error => { console.error(error); process.exitCode = 1; });