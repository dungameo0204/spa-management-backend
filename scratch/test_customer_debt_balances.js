const assert = require('node:assert/strict');
const { invoiceDebtSql, withDebtBalances } = require('../src/utils/customerDebt');

for (const [total, invoice, legacy] of [['1500000.00', '1000000.00', 500000], ['90.00', '0.00', 90], ['100.00', '100.00', 0], ['50.00', '100.00', 0], ['0.00', '0.00', 0], [null, null, 0], ['0.30', '0.10', 0.2]]) {
    const result = withDebtBalances({ total_debt: total, invoice_debt: invoice });
    assert.equal(result.total_debt, total);
    assert.equal(result.invoice_debt, Number(invoice || 0));
    assert.equal(result.legacy_debt, legacy);
}
const sql = invoiceDebtSql('test_tenant', 'customers.id');
assert.match(sql, /i.customer_id = customers.id/);
assert.match(sql, /i.deleted_at IS NULL/);
assert.match(sql, /deleted_at IS NULL AND invoice_id IS NOT NULL/);
assert.doesNotMatch(sql, /LIMIT|branch_id|invoice_date/);

let customer = { id: 10, fullname: 'Mixed', total_debt: '1500000.00', invoice_debt: '1000000.00' };
const calls = [];
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant', masterPool: { query: async (query, params) => {
        calls.push({ query, params });
        if (query.includes('FROM `test_tenant`.customers')) {
            assert.ok(query.includes(sql), 'same shared aggregate inside the customer query');
            return [customer ? [{ ...customer }] : []];
        }
        if (query.includes('invoice_items') || query.includes('.treatments t')) return [[]];
        throw new Error(`Unexpected SQL: ${query}`);
    } }
} };
const service = require('../src/services/customerService');
const express = require('express');
const jwt = require('jsonwebtoken');

(async () => {
    const detail = await service.getCustomerById(1, 10);
    assert.equal(calls.length, 1, 'balances use one SQL snapshot');
    assert.equal(detail.legacy_debt, 500000);
    assert.deepEqual((await service.getCustomerOverview(1, '10')).customer, detail);
    process.env.JWT_SECRET = 'customer-debt-test-only';
    const app = express();
    app.use('/api/customers', require('../src/routes/customerRoutes'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const token = jwt.sign({ tenant_id: 1, system_role: 'STAFF', branch_id: 2 }, process.env.JWT_SECRET);
        for (const endpoint of ['/10', '/10/overview']) {
            const url = `http://127.0.0.1:${server.address().port}/api/customers${endpoint}?branchId=999&page=2&pageSize=1`;
            assert.equal((await fetch(url)).status, 401);
            const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            assert.equal(response.status, 200);
            const body = await response.json();
            const result = endpoint.endsWith('overview') ? body.data.customer : body.data;
            assert.equal(result.total_debt, '1500000.00');
            assert.equal(result.invoice_debt, 1000000);
            assert.equal(result.legacy_debt, 500000);
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
    customer = null;
    await assert.rejects(service.getCustomerById(1, 999), /không tồn tại/);
    await assert.rejects(service.getCustomerOverview(1, '999'), /không tồn tại/);
    console.log('PASS: customer debt balances, number types, cents, inconsistent debt, shared SQL snapshot and detail/overview HTTP responses');
})().catch(error => { console.error(error); process.exitCode = 1; });