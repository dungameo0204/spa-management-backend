const assert = require('node:assert/strict');
const { normalizeInvoiceNote, formatInvoiceNoteEntry, appendInvoiceCustomerNote } = require('../src/services/customerNoteService');

assert.equal(normalizeInvoiceNote('  khách VIP  '), 'khách VIP');
assert.equal(normalizeInvoiceNote(' \n '), null);
for (const value of [{}, [], 123, false]) assert.throws(() => normalizeInvoiceNote(value), /note phải/);
assert.throws(() => normalizeInvoiceNote('ế'.repeat(22000)), /giới hạn/);
assert.equal(formatInvoiceNoteEntry(123, 'Tạo', 'Peel', new Date(2026, 9, 27, 12)), '27/10/2026 [HĐ #123 - Tạo] Peel');

const state = { customers: new Map(), invoice: null, calls: [], commits: 0, rollbacks: 0, fail: false };
let snapshot;
const connection = {
    async beginTransaction() {
        snapshot = { customers: new Map(state.customers), invoice: state.invoice && { ...state.invoice } };
    },
    async commit() { state.commits++; },
    async rollback() {
        state.rollbacks++;
        state.customers = snapshot.customers;
        state.invoice = snapshot.invoice;
    },
    release() {},
    async query(sql, params = []) {
        state.calls.push({ sql, params });
        if (sql.includes('SET note = CONCAT')) {
            assert.match(sql, /OCTET_LENGTH/);
            if (state.fail) throw new Error('append failure');
            const [entry, , id] = params;
            if (!state.customers.has(id)) return [{ affectedRows: 0 }];
            const previous = state.customers.get(id) || '';
            const combined = previous ? `${previous}\n${entry}` : entry;
            if (Buffer.byteLength(combined, 'utf8') > 65535) return [{ affectedRows: 0 }];
            state.customers.set(id, combined);
            return [{ affectedRows: 1 }];
        }
        if (sql.includes('.invoices WHERE id = ?')) return [state.invoice && !state.invoice.deleted_at ? [{ ...state.invoice }] : []];
        if (sql.includes('.customers WHERE id = ?')) return [state.customers.has(params[0]) ? [{ id: params[0], wallet_balance: 1000 }] : []];
        if (sql.includes('.products WHERE id = ?')) return [[{ name: 'Service', price: 100, unit: 'buổi', is_product: 0, is_treatment_combo: 1, default_sessions: 0 }]];
        if (sql.includes('.debt_payments WHERE') || sql.includes('.treatments WHERE') || sql.includes('.invoice_items WHERE')) return [[]];
        if (sql.includes('INSERT INTO `test_tenant`.invoices')) {
            state.invoice = { id: 123, customer_id: params[0], branch_id: params[1], total_amount: params[2],
                discount_percent: 0, discount_amount: 0, paid_amount: 100, wallet_used: 0, debt_amount: 0,
                note: params[9], created_at: new Date(), payment_method: 'CASH' };
        }
        if (sql.includes('UPDATE `test_tenant`.invoices SET customer_id')) {
            state.invoice.customer_id = params[0];
            state.invoice.note = params[8];
        }
        if (sql.includes('UPDATE `test_tenant`.invoices SET deleted_at')) state.invoice.deleted_at = new Date();
        if (/^(INSERT|UPDATE)/.test(sql.trim())) return [{ insertId: 123, affectedRows: 1 }];
        throw new Error(`Unexpected SQL: ${sql}`);
    }
};
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection }
} };
const service = require('../src/services/invoiceService');
const base = { customer_id: 7, branch_id: 1, paid_amount: 100, items: [{ product_id: 1, quantity: 1 }] };
const create = data => service.createInvoice(1, { ...base, ...data }, 'tester', 'MANAGER');
const update = data => service.updateInvoice(1, 123, { items: base.items, ...data }, 'tester', 'MANAGER');
const remove = () => service.deleteInvoice(1, 123, 'tester', 'MANAGER');
const reset = () => { state.customers = new Map([[7, 'Khách VIP'], [8, null]]); state.invoice = null; state.calls = []; state.fail = false; };

(async () => {
    reset();
    await create({ note: '  Khách đổi 1 buổi nặn mụn thành 1 buổi peel  ' });
    assert.equal(state.invoice.note, 'Khách đổi 1 buổi nặn mụn thành 1 buổi peel');
    assert.match(state.customers.get(7), /^Khách VIP\n\d{2}\/\d{2}\/\d{4} \[HĐ #123 - Tạo\] Khách đổi/);
    const original = state.customers.get(7);
    await update({});
    await update({ note: state.invoice.note });
    assert.equal(state.customers.get(7), original);
    await update({ note: 'Peel nhẹ' });
    assert.ok(state.customers.get(7).startsWith(original));
    assert.match(state.customers.get(7), /\[HĐ #123 - Sửa ghi chú\] Peel nhẹ$/);
    await update({ note: '' });
    assert.equal(state.invoice.note, null);
    assert.match(state.customers.get(7), /\[HĐ #123 - Đã xóa ghi chú\]$/);
    const cleared = state.customers.get(7);
    await update({ note: null });
    assert.equal(state.customers.get(7), cleared);
    await remove();
    assert.ok(state.customers.get(7).startsWith(cleared));
    assert.match(state.customers.get(7), /\[HĐ #123 - Đã xóa\]$/);
    await assert.rejects(remove(), /không tồn tại/);

    reset();
    await create({ note: 'Ghi chú chuyển khách' });
    await update({ customer_id: 8 });
    assert.match(state.customers.get(7), /Chuyển sang khách #8/);
    assert.match(state.customers.get(8), /Chuyển từ khách #7\] Ghi chú chuyển khách$/);

    for (const note of [undefined, null, '', '  ']) {
        reset();
        await create({ note });
        assert.equal(state.customers.get(7), 'Khách VIP');
    }
    reset();
    await assert.rejects(create({ note: {} }), /note phải/);
    assert.equal(state.invoice, null);

    reset();
    state.fail = true;
    await assert.rejects(create({ note: 'Must rollback' }), /append failure/);
    assert.equal(state.invoice, null);
    assert.equal(state.customers.get(7), 'Khách VIP');
    state.fail = false;
    await create({ note: 'Original' });
    const beforeFailure = state.customers.get(7);
    state.fail = true;
    await assert.rejects(update({ note: 'Changed' }), /append failure/);
    assert.equal(state.invoice.note, 'Original');
    await assert.rejects(remove(), /append failure/);
    assert.equal(state.invoice.deleted_at, undefined);
    assert.equal(state.customers.get(7), beforeFailure);
    state.fail = false;
    state.customers.set(7, 'a'.repeat(65530));
    await assert.rejects(update({ note: 'Too large' }), /giới hạn TEXT/);
    assert.equal(state.invoice.note, 'Original');
    assert.equal(state.customers.get(7).length, 65530);

    reset();
    // Simulates interleaved append requests; real InnoDB locking needs a DB integration test.
    await Promise.all([
        appendInvoiceCustomerNote(connection, 'test_tenant', 7, 1, 'Tạo', 'First', 'tester'),
        appendInvoiceCustomerNote(connection, 'test_tenant', 7, 2, 'Tạo', 'Second', 'tester')
    ]);
    assert.match(state.customers.get(7), /First/);
    assert.match(state.customers.get(7), /Second/);
    console.log('PASS: invoice customer note history, normalization, unchanged/cleared notes, transfers, delete, byte guard and rollback (mock DB)');
})().catch(error => { console.error(error); process.exitCode = 1; });