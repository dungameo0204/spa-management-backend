const assert = require('node:assert/strict');
const { isToday } = require('../src/utils/staffDatePolicy');

const now = new Date(2026, 9, 27, 12);
assert.equal(isToday(new Date(2026, 9, 27, 0), now), true);
assert.equal(isToday(new Date(2026, 9, 27, 23, 59, 59), now), true);
for (const value of [new Date(2026, 9, 26, 23, 59), new Date(2026, 9, 28), null, undefined, '', false, 0, 'invalid', new Date(NaN)]) {
    assert.equal(isToday(value, now), false);
}

const state = { calls: [], history: null };
const query = async (sql, params = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT treatment_id, branch_id, appointment_id')) return [[state.history]];
    if (sql.includes('.branches WHERE')) return [[{ id: 2 }]];
    if (sql.includes('SELECT id FROM `test_tenant`.inventory_imports')) return [[]];
    if (sql.includes('.products WHERE')) return [[{ id: 3, name: 'Product' }]];
    if (/^SELECT/.test(sql.trim())) throw new Error(`Unexpected query: ${sql}`);
    return [{ insertId: 10, affectedRows: 1 }];
};
const connection = {
    query,
    async beginTransaction() { state.calls.push({ sql: 'BEGIN' }); },
    async commit() { state.calls.push({ sql: 'COMMIT' }); },
    async rollback() { state.calls.push({ sql: 'ROLLBACK' }); },
    release() { state.calls.push({ sql: 'RELEASE' }); }
};
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant',
    masterPool: { query, getConnection: async () => connection }
} };
const inventory = require('../src/services/inventoryImportService');
const expense = require('../src/services/expenseService');
const { deleteTreatmentHistory } = require('../src/services/treatmentService');
const reset = () => { state.calls = []; };

(async () => {
    for (const [service, create, update, field, payload, insert, dateIndex] of [
        [inventory, 'createInventoryImport', 'updateInventoryImport', 'import_date',
            { branch_id: 2, import_code: 'TEST', items: [{ product_id: 3, quantity: 1, unit_price: 100 }] }, 'inventory_imports', 2],
        [expense, 'createExpense', 'updateExpense', 'expense_date',
            { branch_id: 2, items: [{ expense_type: 'Test', amount: 100 }] }, 'expense_vouchers', 4]
    ]) {
        for (const key of [field, 'created_at']) {
            for (const value of [undefined, null, '', '2026-10-26', '2026-10-27', '2026-10-28', 'invalid']) {
                reset();
                await assert.rejects(service[create](1, { ...payload, [key]: value }, 'tester', 'STAFF', 2), /Nhân viên không được gửi/);
                await assert.rejects(service[update](1, 10, { ...payload, [key]: value }, 'tester', 'STAFF', 2), /Nhân viên không được gửi/);
                assert.equal(state.calls.length, 0, 'Rejected date must not reach DB');
            }
        }
        reset();
        await service[create](1, payload, 'tester', 'STAFF', 2);
        const header = state.calls.find(call => call.sql.includes(`INSERT INTO \`test_tenant\`.${insert}\n`));
        assert.equal(header.params[dateIndex], null, 'STAFF date must default to SQL NOW()');
        assert.match(header.sql, /COALESCE\(\?, NOW\(\)\)/);
        assert.ok(state.calls.some(call => call.sql === 'COMMIT'));

        reset();
        await service[create](1, { ...payload, [field]: '2026-01-01 10:00:00' }, 'tester', 'MANAGER');
        assert.equal(state.calls.find(call => call.sql.includes(`INSERT INTO \`test_tenant\`.${insert}\n`)).params[dateIndex], '2026-01-01 10:00:00');
    }

    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    for (const [execution_date, created_at] of [
        [yesterday, today], [today, yesterday], [tomorrow, today], [today, tomorrow],
        [null, today], [today, 'invalid'], [today, undefined]
    ]) {
        reset();
        state.history = { treatment_id: 1, branch_id: 2, appointment_id: 4, execution_date, created_at };
        await assert.rejects(deleteTreatmentHistory(1, 10, 'tester', 'STAFF', 2), /ngày thực hiện và ngày tạo/);
        assert.equal(state.calls.filter(call => /^(UPDATE|INSERT|DELETE)/.test(call.sql)).length, 0);
        assert.ok(state.calls.some(call => call.sql === 'ROLLBACK'));
        assert.equal(state.calls.at(-1).sql, 'RELEASE');
    }
    reset();
    state.history = { treatment_id: 1, branch_id: 2, appointment_id: 4, execution_date: today, created_at: today };
    await deleteTreatmentHistory(1, 10, 'tester', 'STAFF', 2);
    assert.ok(state.calls.some(call => call.sql.includes('remaining_sessions = remaining_sessions + 1')));
    assert.ok(state.calls.some(call => call.sql.includes('.treatment_history_staffs SET deleted_at')));
    assert.ok(state.calls.some(call => call.sql.includes('.appointments SET deleted_at')));
    assert.ok(state.calls.some(call => call.sql === 'COMMIT'));

    reset();
    state.history = { ...state.history, execution_date: yesterday, created_at: yesterday };
    await deleteTreatmentHistory(1, 10, 'tester', 'MANAGER');
    assert.ok(state.calls.some(call => call.sql === 'COMMIT'));
    console.log('PASS: STAFF date input guards, server-generated dates, same-day history deletion, no rejected-write side effects and MANAGER bypass');
})().catch(error => { console.error(error); process.exitCode = 1; });