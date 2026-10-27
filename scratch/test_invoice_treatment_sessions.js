const assert = require('node:assert/strict');

const inserts = [];
const products = new Map([
    [1, { name: 'Tẩy nốt ruồi', price: '100000.00', unit: ' nốt ', is_product: 0, is_treatment_combo: 0, default_sessions: 10 }],
    [2, { name: 'Combo chăm sóc', price: '200000.00', unit: 'gói', is_product: 0, is_treatment_combo: 1, default_sessions: 3 }],
    [3, { name: 'Kem', price: '50000.00', unit: 'hộp', is_product: 1, is_treatment_combo: 0, default_sessions: 10 }],
    [4, { name: 'Dịch vụ không có đơn vị', price: '100000.00', unit: null, is_product: 0, is_treatment_combo: 0, default_sessions: 0 }],
    [5, { name: 'Combo không có buổi', price: '100000.00', unit: 'gói', is_product: 0, is_treatment_combo: 1, default_sessions: 0 }],
    [6, { name: 'Hàng hóa combo', price: '100000.00', unit: 'gói', is_product: 1, is_treatment_combo: 1, default_sessions: 2 }]
]);
let nextId = 20;
const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params = []) {
        if (sql.includes('SELECT t.id FROM `test_tenant`.treatments t')) return [[]];
        if (sql.includes('.invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [[{
            id: 20, branch_id: 1, customer_id: 7, created_at: new Date(), total_amount: 0,
            discount_percent: 0, discount_amount: 0, paid_amount: 0, wallet_used: 0, debt_amount: 0, payment_method: 'CASH', note: null
        }]];
        if (sql.includes('.customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [[{ id: 7, wallet_balance: 0 }]];
        if (sql.includes('.products WHERE id = ?')) return [products.has(params[0]) ? [products.get(params[0])] : []];
        if (sql.includes('FROM `test_tenant`.treatments WHERE invoice_id = ?') && sql.includes('FOR UPDATE')) return [[]];
        if (sql.includes('SELECT id FROM `test_tenant`.debt_payments WHERE invoice_id = ?')) return [[]];
        if (sql.includes('SELECT id, product_id, quantity FROM `test_tenant`.invoice_items')) return [[]];
        if (sql.includes('INSERT INTO `test_tenant`.treatments')) {
            const insertId = nextId++;
            inserts.push({ sql, params, insertId });
            return [{ insertId }];
        }
        if (sql.startsWith('INSERT INTO')) return [{ insertId: nextId++ }];
        if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected SQL: ${sql}`);
    }
};
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: { getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection } }
};
const service = require('../src/services/invoiceService');
const items = [
    { product_id: 1, quantity: 5 },
    { product_id: 2, quantity: 2 },
    { product_id: 3, quantity: 2 },
    { product_id: 4, quantity: 4 },
    { product_id: 5, quantity: 2 },
    { product_id: 6, quantity: 2 }
];
const assertTreatments = () => {
    assert.equal(inserts.length, 4, 'ordinary services always create a card; combos require sessions');
    for (const entry of inserts) assert.match(entry.sql, /invoice_item_id, total_sessions, remaining_sessions, note, created_by, created_at/);
    assert.deepEqual(inserts.map(entry => [entry.params[1], entry.params[2], ...entry.params.slice(4, 7)]), [
        [1, 20, 1, 1, '5 nốt'],
        [2, 20, 6, 6, null],
        [4, 20, 1, 1, '4'],
        [6, 20, 4, 4, null]
    ]);
};

(async () => {
    await service.createInvoice(1, { customer_id: 7, branch_id: 1, items }, 'tester', 'MANAGER');
    assertTreatments();
    inserts.length = 0;
    await service.updateInvoice(1, 20, { items }, 'tester', 'MANAGER');
    assertTreatments();
    inserts.length = 0;
    const duplicated = [items[0], items[0], items[2], items[4]];
    const result = await service.createInvoice(1, { customer_id: 7, branch_id: 1, items: duplicated }, 'tester', 'MANAGER');
    assert.deepEqual(result.itemMappings.map(mapping => mapping.request_index), [0, 1, 2, 3]);
    assert.equal(new Set(result.itemMappings.map(mapping => mapping.invoice_item_id)).size, 4);
    assert.deepEqual(result.itemMappings.map(mapping => mapping.treatment_id), [inserts[0].insertId, inserts[1].insertId, null, null]);
    assert.deepEqual(inserts.map(entry => entry.params[3]), result.itemMappings.slice(0, 2).map(mapping => mapping.invoice_item_id));
    assert.equal(inserts[0].params[1], inserts[1].params[1], 'same service must receive two distinct cards');
    console.log('PASS: POST/PUT invoice creates one session for ordinary services, combo quantity × default_sessions, correct note, no product card');
})().catch(error => { console.error(error); process.exitCode = 1; });