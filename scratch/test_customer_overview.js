const assert = require('node:assert/strict');
const calls = [];
let dataset;
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant',
    masterPool: { query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM `test_tenant`.customers WHERE')) return [[{ id: 1, fullname: 'Khách' }]];
        if (sql.includes('FROM `test_tenant`.invoices i')) return [dataset.purchases];
        if (sql.includes('FROM `test_tenant`.treatments t')) return [dataset.cards.map(card => ({ ...card }))];
        if (sql.includes('FROM `test_tenant`.treatment_history th')) return [dataset.histories.map(history => ({ ...history }))];
        if (sql.includes('FROM `test_tenant`.treatment_history_staffs ths')) return [dataset.staffs];
        throw new Error(`Unexpected SQL ${sql}`);
    } }
} };
const { getCustomerOverview } = require('../src/services/customerService');
(async () => {
    await assert.rejects(getCustomerOverview(1, 'abc'), /customerId/);
    dataset = {
        purchases: [
            { invoice_item_id: 83, invoice_id: 64, product_id: 23, product_name: 'tẩy nốt ruồi', is_product: 0, purchase_date: '2026-10-12', unit_price: '50000.00', quantity: 5, final_price: '250000.00' },
            { invoice_item_id: 85, invoice_id: 64, product_id: 23, is_product: 0, purchase_date: '2026-10-12' },
            { invoice_item_id: 84, invoice_id: 64, product_id: 24, is_product: 1, purchase_date: '2026-10-12' },
            { invoice_item_id: 78, invoice_id: 63, product_id: 23, is_product: 0, purchase_date: '2026-10-11' },
            { invoice_item_id: 7, invoice_id: 50, product_id: 2, is_product: 0, purchase_date: '2026-10-10' }
        ],
        cards: [
            { id: 54, invoice_id: 64, product_id: 23, total_sessions: 1, remaining_sessions: 0, purchase_date: '2026-10-12' },
            { id: 55, invoice_id: 64, product_id: 23, total_sessions: 5, remaining_sessions: 3, purchase_date: '2026-10-12' },
            { id: 56, invoice_id: 64, product_id: 23, total_sessions: 1, remaining_sessions: 1, purchase_date: '2026-10-12' },
            { id: 57, invoice_id: null, product_id: 23, total_sessions: 2, remaining_sessions: 2, purchase_date: null, created_at: '2026-10-09' }
        ],
        histories: [{ id: 53, treatment_id: 54, execution_date: '2026-10-12' }],
        staffs: [{ id: 8, treatment_history_id: 53, staff_id: 9, staff_name: 'A' }]
    };
    const result = await getCustomerOverview(1, '1');
    assert.equal(result.customer.password, undefined);
    assert.deepEqual(result.treatments.map(t => t.id), [54, 55, 56, 57]);
    assert.equal(result.purchases[0].treatment.id, 54);
    assert.equal(result.purchases[0].treatment.completed_sessions, 1);
    assert.equal(result.purchases[0].treatment.histories[0].staffs[0].staff_id, 9);
    assert.equal(result.purchases[1].treatment.id, 55);
    assert.equal(result.purchases[2].treatment, null);
    assert.equal(result.purchases[3].treatment, null); // Same product, different invoice.
    assert.equal(result.purchases[4].treatment, null);
    assert.equal(result.timeline.length, 7);
    assert.deepEqual(result.timeline.filter(entry => entry.type === 'treatment').map(entry => entry.treatment.id), [56, 57]);
    assert.equal(result.timeline.find(entry => entry.type === 'purchase' && entry.item.invoice_item_id === 83).item.treatment.id, 54);
    assert.match(calls[2].sql, /t\.deleted_at IS NULL AND \(t\.invoice_id IS NULL OR i\.id IS NOT NULL\)/);
    assert.doesNotMatch(calls[2].sql, /remaining_sessions\s*>/);
    assert.match(calls[1].sql, /ORDER BY i\.invoice_date DESC, i\.id DESC, ii\.id DESC/);

    dataset = { purchases: [], cards: [], histories: [], staffs: [] };
    const empty = await getCustomerOverview(1, '1');
    assert.deepEqual(empty.purchases, []);
    assert.deepEqual(empty.treatments, []);
    assert.deepEqual(empty.timeline, []);
    console.log('PASS: overview merges service purchase with card once; distinct invoices, duplicate products, manual/unmatched cards and empty result');
})().catch(error => { console.error(error); process.exitCode = 1; });