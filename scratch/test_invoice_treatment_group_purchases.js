const assert = require('node:assert/strict');

const calls = { replace: [], revoke: [], insert: [] };
const purchasesPath = require.resolve('../src/services/treatmentPurchaseService');
require.cache[purchasesPath] = { id: purchasesPath, filename: purchasesPath, loaded: true, exports: {
    replaceInvoiceItemContribution: async (...args) => { calls.replace.push(args.slice(2)); },
    revokeTreatmentInvoiceItem: async (...args) => { calls.revoke.push(args.slice(2)); },
    insert: async (...args) => { calls.insert.push(args.slice(2)); }
} };
const { reconcileGroup } = require('../src/services/invoiceTreatmentUpdateService');

let nextId = 40;
const updates = [];
const connection = { query: async (sql, params = []) => {
    if (sql.includes('.treatment_history')) return [[]];
    if (sql.includes('FROM `test_tenant`.products WHERE id=?')) return [[{ id: 1, is_product: 0 }]];
    if (sql.includes('product_service_components')) return [[{ child_product_id: 4, price: 400, is_product: 0, deleted_at: null }]];
    if (sql.includes('INSERT INTO `test_tenant`.treatments')) return [{ insertId: nextId++ }];
    if (sql.includes('UPDATE `test_tenant`.treatments')) { updates.push({ sql, params }); return [{ affectedRows: 1 }]; }
    throw new Error(`Unexpected SQL: ${sql}`);
} };
const root = { id: 10, customer_id: 7, product_id: 1, total_sessions: 5, remaining_sessions: 5, invoice_id: 20, invoice_item_id: 30, created_at: '2026-11-01', closed_at: null };
const child = (id, product_id, total_sessions) => ({ id, customer_id: 7, product_id, parent_treatment_id: 10,
    total_sessions, remaining_sessions: total_sessions, closed_at: null });

(async () => {
    const ids = await reconcileGroup(connection, 'test_tenant', root, [root, child(11, 2, 2), child(12, 3, 3)], {
        total_sessions: 6,
        children: [{ product_id: 2, total_sessions: 4 }, { product_id: 4, total_sessions: 1 }]
    }, 7, 'tester', { invoiceId: 20, invoiceItemId: 30 });

    assert.deepEqual(ids, [10, 11, 40]);
    assert.deepEqual(calls.replace.map(args => [args[0].id, args[1], args[2], args[3]]), [[11, 20, 30, 4], [10, 20, 30, 6]]);
    assert.deepEqual(calls.revoke.map(args => [args[0], args[1], args[2], args[3]]), [[12, 20, 30, 'tester']]);
    assert.deepEqual(calls.insert.map(args => [args[0].treatmentId, args[0].invoiceId, args[0].invoiceItemId, args[0].totalSessions]), [[40, 20, 30, 1]]);
    assert.equal(updates.some(update => /total_sessions=\?/.test(update.sql)), false,
        'group aggregates must be recalculated from treatment_purchases, not written directly');
    console.log('PASS: group invoice amendment updates, revokes, and creates child treatment purchase sources while rebuilding entitlement from the ledger');
})().catch(error => { console.error(error); process.exitCode = 1; });