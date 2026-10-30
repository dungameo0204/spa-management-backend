const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

// Transactional SQL double: never opens a connection to an actual tenant.
let state;
let snapshot;
let failInsert = false;
const reset = () => {
    state = { customers: { 10: 300, 11: 90 }, invoiceDebt: { 10: 100, 11: 0 }, payments: {}, nextId: 1, calls: [] };
};
const connection = {
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() {},
    async rollback() { if (snapshot) state = snapshot; },
    release() {},
    async query(sql, params = []) {
        state.calls.push({ sql, params });
        if (sql.includes('.branches WHERE')) return [params[0] === 999 ? [] : [{ id: params[0] }]];
        if (sql.includes('WHERE id IN (?)')) {
            assert.match(sql, /FOR UPDATE/);
            return [params[0].filter(id => state.customers[id] !== undefined).map(id => ({ id, total_debt: state.customers[id] }))];
        }
        if (sql.includes('AS invoice_debt\n')) {
            assert.match(sql, /i.deleted_at IS NULL/);
            assert.match(sql, /deleted_at IS NULL AND invoice_id IS NOT NULL/);
            assert.match(sql, /GREATEST\(0, i.debt_amount - COALESCE\(p.paid, 0\)\)/);
            return [[{ invoice_debt: state.invoiceDebt[params[0]] || 0 }]];
        }
        if (sql.includes('INSERT INTO')) {
            if (failInsert) throw new Error('injected insert failure');
            const [customer_id, branch_id, collection_branch_id, invoice_id, amount, payment_method, payment_date, note] = params;
            const id = state.nextId++;
            state.payments[id] = { id, customer_id, branch_id, collection_branch_id, invoice_id, amount, payment_method, payment_date, note };
            return [{ insertId: id }];
        }
        if (sql.includes('SELECT * FROM') && sql.includes('.debt_payments')) {
            const payment = state.payments[params[0]];
            return [payment && !payment.deleted_at ? [{ ...payment }] : []];
        }
        if (sql.includes('.customers SET total_debt')) {
            if (sql.includes('total_debt + ? - ?')) state.customers[params[3]] += Number(params[0]) - Number(params[1]);
            else if (sql.includes('total_debt + ?')) state.customers[params[2]] += Number(params[0]);
            else state.customers[params[2]] -= Number(params[0]);
            return [{ affectedRows: 1 }];
        }
        if (sql.includes('.debt_payments SET deleted_at')) {
            state.payments[params[1]].deleted_at = 'deleted';
            return [{ affectedRows: 1 }];
        }
        if (sql.includes('SET customer_id = ?')) {
            const [customer_id, branch_id, collection_branch_id, invoice_id, amount, payment_method, payment_date, note, , id] = params;
            Object.assign(state.payments[id], { customer_id, branch_id, collection_branch_id, invoice_id, amount, payment_method, payment_date, note });
            return [{ affectedRows: 1 }];
        }
        if (sql.includes('SELECT dp.*')) {
            let rows = Object.values(state.payments).filter(p => !p.deleted_at);
            if (sql.includes('dp.id = ?')) rows = rows.filter(p => p.id === params[0]);
            if (sql.includes('dp.collection_branch_id = ?')) rows = rows.filter(p => p.collection_branch_id === params.at(-1));
            return [rows.map(p => ({ ...p, invoice_total_amount: null, invoice_debt_amount: null }))];
        }
        if (sql.includes('COUNT(*)')) return [[{ total: Object.values(state.payments).filter(p => !p.deleted_at).length }]];
        throw new Error(`Unexpected query: ${sql}`);
    }
};
const dbPath = require.resolve('../src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant', masterPool: { getConnection: async () => connection, query: (...args) => connection.query(...args) }
} };
const service = require('../src/services/debtPaymentService');
const base = { customer_id: 10, collection_branch_id: 2, amount: 50 };
const create = (data = {}, role = 'MANAGER', branchId = null) => service.createLegacyDebtPayment(1, { ...base, ...data }, 'tester', role, branchId);
const update = (id, data, role = 'MANAGER', branchId = null) => service.updateDebtPayment(1, id, data, 'tester', role, branchId);
const remove = (id, role = 'MANAGER', branchId = null) => service.deleteDebtPayment(1, id, 'tester', role, branchId);

(async () => {
    reset();
    const first = await create();
    assert.equal(first.invoiceId, null);
    assert.equal(first.branchId, 2);
    assert.equal(first.collectionBranchId, 2);
    assert.equal(first.totalDebt, 250);
    assert.equal(state.payments[first.debtPaymentId].payment_method, 'CASH');
    await create({ amount: 150 });
    assert.equal(state.customers[10], 100, 'invoice debt must remain untouched');
    await assert.rejects(create({ amount: 0.01 }), /nợ cũ/);
    assert.equal(state.customers[10], 100);
    await remove(2);
    assert.equal(state.customers[10], 250);
    await assert.rejects(remove(2), /không tồn tại/);
    await assert.rejects(update(1, { amount: 201 }), /nợ cũ/);
    await update(1, { amount: 200 });
    assert.equal(state.customers[10], 100);
    await update(1, { amount: 30, customer_id: 11, collection_branch_id: 3 });
    assert.equal(state.customers[10], 300);
    assert.equal(state.customers[11], 60);
    assert.equal(state.payments[1].branch_id, 3);
    await update(1, { note: 'edited' });
    assert.equal(state.customers[11], 60);
    await assert.rejects(update(1, { invoice_id: 9 }), /không được gắn/);
    await assert.rejects(update(1, { amount: 91 }), /nợ cũ/);
    await assert.rejects(update(1, {}, 'STAFF', 2), /không có quyền/);
    await assert.rejects(remove(1, 'STAFF', 2), /không có quyền/);
    const detail = await service.getDebtPaymentDetail(1, 1, 'STAFF', 3);
    assert.equal(detail.invoice_id, null);
    await remove(1, 'STAFF', 3);
    assert.equal(state.customers[11], 90);

    reset();
    for (const data of [{ amount: 0 }, { amount: -1 }, { amount: 0.001 }, { amount: 'bad' }, { customer_id: 999 }, { collection_branch_id: 999 }, { collection_branch_id: null }, { invoice_id: 4 }, { branch_id: 3 }]) {
        await assert.rejects(create(data));
        assert.equal(state.customers[10], 300);
    }
    await assert.rejects(create({}, 'SUPER_ADMIN'), /không có quyền/);
    await assert.rejects(create({ collection_branch_id: 3 }, 'STAFF', 2), /cơ sở khác/);
    const staff = await create({ collection_branch_id: undefined }, 'STAFF', 2);
    assert.equal(staff.collectionBranchId, 2);
    await assert.rejects(update(staff.debtPaymentId, { collection_branch_id: 3 }, 'STAFF', 2), /cơ sở khác/);
    await update(staff.debtPaymentId, { amount: 25 }, 'STAFF', 2);
    assert.equal(state.customers[10], 275);
    await assert.rejects(service.createDebtPayment(1, base, 'tester', 'MANAGER'), /invoice_id là bắt buộc/);
    state.payments[99] = { ...state.payments[1], id: 99, invoice_id: 9 };
    await assert.rejects(update(99, { invoice_id: null }), /invoice_id là bắt buộc/);
    failInsert = true;
    const before = structuredClone(state);
    await assert.rejects(create(), /injected insert failure/);
    assert.deepEqual(state, before);
    failInsert = false;

    reset();
    await create({ customer_id: 11, amount: 90 });
    assert.equal(state.customers[11], 0, 'full legacy collection without invoices');
    await assert.rejects(create({ customer_id: 11, amount: 1 }), /nợ cũ/);

    reset();
    process.env.JWT_SECRET = 'legacy-debt-test-only';
    const app = express();
    app.use(express.json());
    app.use('/api/debt-payments', require('../src/routes/debtPaymentRoutes'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const token = jwt.sign({ tenant_id: 1, system_role: 'MANAGER', username: 'tester' }, process.env.JWT_SECRET);
        const url = `http://127.0.0.1:${server.address().port}/api/debt-payments`;
        const send = (path, method, body, auth = true) => fetch(url + path, { method,
            headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        assert.equal((await send('/legacy', 'POST', base, false)).status, 401);
        const response = await send('/legacy', 'POST', base);
        assert.equal(response.status, 201);
        const data = await response.json();
        assert.equal(data.invoiceId, null);
        assert.equal(data.totalDebt, 250);
        assert.equal((await send('/legacy', 'POST', { ...base, amount: 201 })).status, 400);
        assert.equal((await send('', 'POST', base)).status, 400);
        const list = await send('', 'GET');
        assert.equal(list.status, 200);
        assert.equal((await list.json()).data[0].invoice_id, null);
        assert.equal((await send(`/${data.debtPaymentId}`, 'GET')).status, 200);
        assert.equal((await send(`/${data.debtPaymentId}`, 'PUT', { amount: 100 })).status, 200);
        assert.equal(state.customers[10], 200);
        assert.equal((await send(`/${data.debtPaymentId}`, 'DELETE')).status, 200);
        assert.equal(state.customers[10], 300);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
    console.log('PASS: legacy debt transactions, mixed debt protection, edit/delete, branch permissions, rollback and HTTP contract');
})().catch(error => { console.error(error); process.exitCode = 1; });