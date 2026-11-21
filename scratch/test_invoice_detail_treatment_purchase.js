const assert = require('node:assert/strict');

const dbPath = require.resolve('../src/config/database');
const rootCard = { id: 70, product_id: 9, total_sessions: 11, remaining_sessions: 11, customer_id: 5 };
const pool = {
    async query(sql, params = []) {
        if (sql.includes('FROM `test_tenant`.invoices i')) return [[{ id: 30, customer_id: 5, payment_method: 'CASH' }]];
        if (sql.includes('FROM `test_tenant`.invoice_items')) return [[
            { id: 101, invoice_id: 30, product_id: 9, quantity: 10, snapshot_price: 1000 },
            { id: 102, invoice_id: 30, product_id: 9, quantity: 1, snapshot_price: 1000 }
        ]];
        if (sql.includes('invoice_item_consultants')) return [[]];
        if (sql.includes('FROM `test_tenant`.treatment_purchases tp')) return [[rootCard]];
        if (sql.includes('FROM `test_tenant`.treatments t') && sql.includes('parent_treatment_id IN')) return [[]];
        if (sql.includes('SELECT treatment_id,invoice_item_id,total_sessions FROM `test_tenant`.treatment_purchases')) {
            assert.deepEqual(params, [[101, 102]]);
            return [[
                { treatment_id: 70, invoice_item_id: 101, total_sessions: 10 },
                { treatment_id: 70, invoice_item_id: 102, total_sessions: 1 }
            ]];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    }
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { masterPool: pool, getTenantDbName: async () => 'test_tenant' } };
const { getInvoiceDetail } = require('../src/services/invoiceService');

(async () => {
    const invoice = await getInvoiceDetail(1, 30, 'MANAGER', 1);
    assert.equal(invoice.items[0].treatment.total_sessions, 11);
    assert.equal(invoice.items[1].treatment.total_sessions, 11);
    assert.equal(invoice.items[0].treatment.purchased_total_sessions, 10);
    assert.equal(invoice.items[1].treatment.purchased_total_sessions, 1);
    assert.notEqual(invoice.items[0].treatment, invoice.items[1].treatment);
    console.log('PASS: invoice detail keeps merged-card entitlement separate from each invoice item purchase contribution');
})().catch(error => { console.error(error); process.exitCode = 1; });