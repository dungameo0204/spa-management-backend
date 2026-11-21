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
        if (sql.includes('FROM `test_tenant`.treatments t') && sql.includes('t.customer_id=? AND t.product_id=?') && sql.includes('LIMIT 1 FOR UPDATE')) return [[]];
        state.queries.push({ sql, params });
        if (sql.includes('.invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [[{
            id: 20, branch_id: 1, customer_id: 7, created_at: createdAt, total_amount: 500,
            discount_percent: 0, discount_amount: 0, paid_amount: 0, wallet_used: 0,
            debt_amount: 0, payment_method: 'CASH', note: null
        }]];
        if (sql.includes('.customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [[{ id: params[0], wallet_balance: 0 }]];
        if (sql.includes('.products WHERE id = ?')) return [products.has(params[0]) ? [products.get(params[0])] : []];
        if (sql.includes('.debt_payments WHERE invoice_id = ?')) return [[]];
        if (sql.includes('FROM `test_tenant`.treatment_purchases tp JOIN')) return [state.cards.map(card => ({ ...card, purchase_invoice_item_id: card.invoice_item_id ?? null }))];
        if (sql.includes('SELECT id,invoice_id,invoice_item_id,total_sessions FROM `test_tenant`.treatment_purchases')) {
            const sourceCard = state.cards.find(card => Number(card.id) === Number(params[0]));
            return [sourceCard ? [{ id: sourceCard.id, invoice_id: 20, invoice_item_id: 12, total_sessions: sourceCard.total_sessions }] : []];
        }
        if (sql.includes('FROM `test_tenant`.treatment_purchases p') && sql.includes('WHERE p.invoice_item_id=?')) {
            return [state.cards.map(card => ({
                id: card.id, treatment_id: card.id, total_sessions: card.total_sessions,
                product_id: card.product_id, product_name: products.get(card.product_id).name,
                card_total: card.total_sessions, remaining_sessions: card.remaining_sessions,
                closed_at: null, closure_signature_svg: null, parent_treatment_id: null,
                parent_closed_at: null, parent_signature: null
            }))];
        }
        if (sql.includes('SELECT COUNT(*) AS count FROM `test_tenant`.treatment_purchases')) return [[{ count: 1 }]];
        if (sql.includes('.treatment_history') && sql.includes('treatment_id=?')) return [[]];
        if (sql.includes('FROM `test_tenant`.treatments WHERE invoice_id = ?') && sql.includes('FOR UPDATE')) return [state.cards.map(card => ({ ...card }))];
        if (sql.includes('SELECT id, product_id, quantity FROM `test_tenant`.invoice_items')) return [[{ id: 12, product_id: 1, quantity: 5 }]];
        if (sql.includes('FROM `test_tenant`.treatments t') && sql.includes('commission_base_price')) return [[{
            product_id: 1, invoice_id: 20, invoice_item_id: 201, is_treatment_combo: 1, snapshot_price: 100, quantity: 5
        }]];
        if (sql.includes('FROM `test_tenant`.treatment_history_staffs ths') && sql.includes('FOR UPDATE')) return [[]];
        if (sql.includes('INSERT INTO `test_tenant`.treatments')) return [{ insertId: state.nextId++ }];
        if (sql.includes('UPDATE `test_tenant`.treatments SET total_sessions=?,remaining_sessions=?,updated_by=?')) {
            const card = state.cards.find(entry => Number(entry.id) === Number(params[3]));
            if (card) {
                card.total_sessions = params[0];
                card.remaining_sessions = params[1];
            }
            return [{ affectedRows: 1 }];
        }
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
const run = (items, branchId = 1) => updateInvoice(1, 20, { items }, 'tester', 'STAFF', branchId);
const card = (id, product_id, total_sessions, remaining_sessions) => ({ id, product_id, total_sessions, remaining_sessions, customer_id: 7, note: null });
const changes = pattern => state.queries.filter(q => pattern.test(q.sql));

(async () => {
    state.cards = [card(10, 1, 5, 3)];
    await run([combo(5), { product_id: 2, quantity: 1 }]);
    assert.equal(changes(/UPDATE `test_tenant`\.treatments SET deleted_at/).length, 0);
    assert.equal(changes(/INSERT INTO `test_tenant`\.treatments/).length, 0);
    assert.deepEqual(changes(/UPDATE `test_tenant`\.treatments SET total_sessions/)[0].params.slice(0, 2), [5, 3]);
    const retainedLine = changes(/UPDATE `test_tenant`\.invoice_items SET snapshot_name/);
    assert.equal(retainedLine.length, 1, 'existing invoice line must be updated in place');
    assert.equal(retainedLine[0].params.at(-2), 12, 'update must preserve the original invoice_items.id');
    assert.equal(changes(/UPDATE `test_tenant`\.invoice_items SET deleted_at/).length, 0, 'retained line must not be soft-deleted');
    assert.equal(changes(/INSERT INTO `test_tenant`\.invoice_items/).length, 1, 'only the genuinely new goods line is inserted');

    state.queries.length = 0;
    await assert.rejects(run([combo(5)], 2), /cơ sở khác/);
    assert.equal(state.queries.filter(query => /^(UPDATE|INSERT)/.test(query.sql.trim())).length, 0,
        'STAFF must remain blocked from another branch before any write');

    state.queries.length = 0;
    await run([combo(3)]);
    assert.deepEqual(changes(/UPDATE `test_tenant`\.treatments SET total_sessions/)[0].params.slice(0, 2), [3, 1]);
    assert.equal(changes(/INSERT INTO `test_tenant`\.treatments/).length, 0);

    state.queries.length = 0;
    await run([combo(2)]);
    assert.equal(changes(/UPDATE `test_tenant`\.treatments SET total_sessions/)[0].params[1], 0);

    state.queries.length = 0;
    const committed = state.commits;
    await assert.rejects(run([combo(1)]), /2 buổi đã sử dụng/);
    assert.equal(state.commits, committed);
    assert.equal(state.rollbacks > 0, true);

    state.queries.length = 0;
    await assert.rejects(run([{ product_id: 2, quantity: 1 }]), /Dịch vụ "Combo": sau khi sửa\/xóa hóa đơn chỉ còn 0 buổi, ít hơn 2 buổi đã sử dụng/);
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
    console.log('PASS: invoice amendments retain invoice item IDs, insert/delete only actual line changes, preserve used treatment, adjust balances and retain branch/date safeguards');
})().catch(error => { console.error(error); process.exitCode = 1; });