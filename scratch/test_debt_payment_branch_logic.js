const assert = require('node:assert/strict');

// Fake mysql connection: kiểm tra contract SQL và quyền mà không ghi vào tenant thật.
const state = {
    payment: null,
    queries: [],
    debt: 500,
    invoiceBranch: 2,
    otherPayments: [],
    nextId: 101,
    inserted: []
};
const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
        state.queries.push({ sql, params });
        if (sql.includes('AS paid_debt_amount') && sql.includes('FROM `test_tenant`.invoices i')) {
            if (params[0] === 999) return [[]];
            const paid = state.otherPayments
                .filter(row => row.invoice_id === params[0] && row.deleted_at == null)
                .reduce((sum, row) => sum + row.amount, 0);
            return [[{ id: params[0], customer_id: 10, branch_id: state.invoiceBranch,
                debt_amount: '500.00', paid_debt_amount: String(paid.toFixed(2)) }]];
        }
        if (sql.includes('FROM `test_tenant`.invoices') && sql.includes('FOR UPDATE')) {
            return [[{ id: params[0], customer_id: 10, branch_id: state.invoiceBranch, debt_amount: 500 }]];
        }
        if (sql.includes('COALESCE(SUM(amount)')) {
            const excluded = sql.includes('AND id != ?') ? params[1] : null;
            const total = state.otherPayments
                .filter(row => row.invoice_id === params[0] && row.deleted_at == null && row.id !== excluded)
                .reduce((sum, row) => sum + row.amount, 0);
            return [[{ paid_debt_amount: total }]];
        }
        if (sql.includes('FROM `test_tenant`.branches WHERE id')) return [[{ id: params[0] }]];
        if (sql.includes('FROM `test_tenant`.customers') && sql.includes('FOR UPDATE')) {
            return [[{ id: 10, total_debt: state.debt }]];
        }
        if (sql.includes('INSERT INTO `test_tenant`.debt_payments')) {
            state.payment = {
                id: state.nextId++, customer_id: params[0], branch_id: params[1],
                collection_branch_id: params[2], invoice_id: params[3], amount: params[4]
            };
            state.inserted.push(state.payment);
            return [{ insertId: state.payment.id }];
        }
        if (sql.includes('FROM `test_tenant`.debt_payments WHERE id = ?') && sql.includes('FOR UPDATE')) {
            return [[state.payment]];
        }
        if (sql.includes('UPDATE `test_tenant`.debt_payments') && sql.includes('SET customer_id')) {
            Object.assign(state.payment, {
                customer_id: params[0], branch_id: params[1], collection_branch_id: params[2],
                invoice_id: params[3], amount: params[4]
            });
        }
        if (sql.includes('SELECT dp.*')) return [[state.payment]];
        return [{}];
    }
};
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: {
        getTenantDbName: async () => 'test_tenant',
        masterPool: { getConnection: async () => connection, query: (...args) => connection.query(...args) }
    }
};
const service = require('../src/services/debtPaymentService');

(async () => {
    await assert.rejects(
        service.createDebtPayment(1, { amount: 100 }, 'tester', 'STAFF', 1),
        /invoice_id là bắt buộc/
    );
    const result = await service.createDebtPayment(1, {
        invoice_id: 77, amount: 100, collection_branch_id: 9
    }, 'tester', 'STAFF', 1);
    assert.deepEqual([result.branchId, result.collectionBranchId, result.customerId], [2, 1, 10]);
    assert.deepEqual([state.payment.branch_id, state.payment.collection_branch_id], [2, 1]);

    await assert.rejects(
        service.createDebtPayment(1, { invoice_id: 77, customer_id: 11, amount: 100 }, 'tester', 'STAFF', 1),
        /customer_id phải khớp/
    );
    // Các khoản thu chưa xóa mềm của cùng hóa đơn: 300 + 200 = 500 hợp lệ;
    // 300 + 200.01 = 500.01 bị từ chối ngay cả khi tổng nợ khách hàng đủ.
    state.otherPayments = [
        { id: 201, invoice_id: 77, amount: 300, deleted_at: null },
        { id: 202, invoice_id: 77, amount: 1000, deleted_at: '2026-10-06' },
        { id: 203, invoice_id: 88, amount: 1000, deleted_at: null }
    ];
    const remaining = await service.getInvoiceRemainingDebt(1, 77);
    assert.deepEqual(remaining, {
        invoiceId: 77, customerId: 10, branchId: 2,
        invoiceDebtAmount: 500, paidDebtAmount: 300, remainingDebtAmount: 200
    });
    assert.ok(state.queries.some(q => q.sql.includes('dp.deleted_at IS NULL') && q.sql.includes('i.deleted_at IS NULL')));
    assert.equal((await service.getInvoiceRemainingDebt(1, 78)).remainingDebtAmount, 500);
    await assert.rejects(service.getInvoiceRemainingDebt(1, 'bad'), /invoiceId không hợp lệ/);
    await assert.rejects(service.getInvoiceRemainingDebt(1, 999), /Hóa đơn không tồn tại/);
    state.otherPayments.push({ id: 204, invoice_id: 77, amount: 200, deleted_at: null });
    assert.equal((await service.getInvoiceRemainingDebt(1, 77)).remainingDebtAmount, 0);
    state.otherPayments.pop();
    state.debt = 10000;
    await assert.rejects(
        service.createDebtPayment(1, { invoice_id: 77, amount: 200.01 }, 'tester', 'STAFF', 1),
        /Tổng tiền thu nợ của hóa đơn không được vượt debt_amount/
    );
    await assert.rejects(
        service.createDebtPayment(1, { invoice_id: 77, amount: 200.001 }, 'tester', 'STAFF', 1),
        /tối đa 2 chữ số thập phân/
    );
    const exact = await service.createDebtPayment(1, { invoice_id: 77, amount: 200 }, 'tester', 'STAFF', 1);
    assert.equal(exact.amount, 200);
    assert.equal(state.inserted.length, 2);
    // Khi sửa chính phiếu, không cộng amount cũ thêm lần nữa.
    state.otherPayments.push({ id: exact.debtPaymentId, invoice_id: 77, amount: 200, deleted_at: null });
    await assert.rejects(
        service.updateDebtPayment(1, exact.debtPaymentId, { amount: 200.01 }, 'tester', 'STAFF', 1),
        /Tổng tiền thu nợ của hóa đơn không được vượt debt_amount/
    );
    await service.updateDebtPayment(1, exact.debtPaymentId, { amount: 200 }, 'tester', 'STAFF', 1);
    state.payment = state.inserted[0];
    state.otherPayments = [];
    state.debt = 500;
    state.queries.length = 0;
    await service.getDebtPayments(1, {}, 'STAFF', 1);
    assert.ok(state.queries.some(q => q.sql.includes('AND dp.collection_branch_id = ?') && q.params.includes(1)));
    await service.getDebtPaymentDetail(1, 101, 'STAFF', 1);
    assert.ok(state.queries.some(q => q.sql.includes('AND dp.collection_branch_id = ?') && q.params.includes(1)));

    await assert.rejects(service.updateDebtPayment(1, 101, { amount: 50 }, 'tester', 'STAFF', 2), /không có quyền sửa/);
    state.invoiceBranch = 3;
    const update = await service.updateDebtPayment(1, 101, { invoice_id: 78, amount: 50, collection_branch_id: 9 }, 'tester', 'STAFF', 1);
    assert.deepEqual([update.branchId, update.collectionBranchId, state.payment.branch_id], [3, 1, 3]);
    await assert.rejects(service.updateDebtPayment(1, 101, { invoice_id: null }, 'tester', 'STAFF', 1), /invoice_id là bắt buộc/);
    await assert.rejects(service.deleteDebtPayment(1, 101, 'tester', 'STAFF', 2), /không có quyền xóa/);
    await service.deleteDebtPayment(1, 101, 'tester', 'STAFF', 1);
    console.log('PASS: invoice branch accounting and collection branch STAFF authorization');
})().catch(error => { console.error(error); process.exitCode = 1; });