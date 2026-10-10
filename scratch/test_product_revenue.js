const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const calls = [];
let productExists = true;
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant', masterPool: { query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM `test_tenant`.products WHERE id = ?')) {
            return [productExists ? [{ id: 4, name: 'Trị tàn nhang', is_product: 0 }] : []];
        }
        if (sql.startsWith('SELECT COUNT(*) AS total, COUNT(DISTINCT invoice_id) AS invoice_count')) {
            return [[{ total: 2, invoice_count: 1, quantity: '2', item_total: '1000.00', revenue: '900.00' }]];
        }
        if (sql.includes('COUNT(*) AS total')) return [[{ total: 1, total_revenue: '900.00' }]];
        if (sql.includes('ORDER BY revenue DESC')) return [[{ product_id: 4, product_name: 'Trị tàn nhang', is_product: 0, invoice_count: 1, item_count: 2, quantity: '2', item_total: '1000.00', revenue: '900.00' }]];
        if (sql.includes('ORDER BY invoice_date DESC')) return [[{ invoice_id: 42, invoice_item_id: 30, snapshot_price: '500.00', final_price: '500.00', revenue: '450.00' }]];
        throw new Error(`Unexpected SQL: ${sql}`);
    } }
} };
const service = require('../src/services/reportService');
const period = { startDate: '2026-10-01', endDate: '2026-10-31', branchId: '1' };

(async () => {
    const summary = await service.getProductRevenue(1, { ...period, page: '2', pageSize: '1' });
    assert.equal(summary.totalRevenue, 900);
    assert.equal(summary.totalPages, 1);
    assert.equal(summary.data[0].revenue, 900);
    assert.equal(summary.data[0].invoice_count, 1);
    const summarySql = calls.find(call => call.sql.includes('ORDER BY revenue DESC'));
    assert.deepEqual(summarySql.params, ['2026-10-01', '2026-10-31', 1, 1, 1]);
    assert.match(summarySql.sql, /COUNT\(DISTINCT invoice_id\)/);
    assert.match(summarySql.sql, /SUM\(revenue\)/);
    assert.match(summarySql.sql, /ii\.deleted_at IS NULL/);
    assert.match(summarySql.sql, /i\.deleted_at IS NULL/);
    assert.match(summarySql.sql, /items\.service_gross/);
    assert.match(summarySql.sql, /items\.product_gross/);
    assert.match(summarySql.sql, /ROUND\(CASE WHEN p\.is_product = 0/);
    assert.match(summarySql.sql, /ii\.final_price \* GREATEST/);
    const details = await service.getProductInvoices(1, '4', { ...period, pageSize: '1' });
    assert.equal(details.revenue, 900);
    assert.equal(details.invoiceCount, 1);
    assert.equal(details.total, 2);
    assert.equal(details.totalPages, 2);
    assert.equal(details.data[0].snapshot_price, '500.00');
    assert.equal(details.data[0].revenue, 450);
    const detailsSql = calls.find(call => call.sql.includes('ORDER BY invoice_date DESC'));
    assert.deepEqual(detailsSql.params, ['2026-10-01', '2026-10-31', 1, 4, 1, 0]);
    assert.match(detailsSql.sql, /WHERE product_id = \?/);
    assert.match(detailsSql.sql, /ORDER BY invoice_date DESC, invoice_id DESC, invoice_item_id DESC/);
    assert.doesNotMatch(detailsSql.sql, /invoice_item_consultants/);
    await assert.rejects(service.getProductInvoices(1, 'x', period), error => error.status === 400);
    await assert.rejects(service.getProductInvoices(1, '0', period), error => error.status === 400);
    await assert.rejects(service.getProductRevenue(1, { ...period, staffId: '2' }), /staffId/);
    await assert.rejects(service.getProductRevenue(1, { ...period, pageSize: '101' }), error => error.status === 400);
    await assert.rejects(service.getProductRevenue(1, { ...period, startDate: '2026-02-30' }), /startDate/);
    productExists = false;
    await assert.rejects(service.getProductInvoices(1, '4', period), error => error.status === 404);
    productExists = true;

    process.env.JWT_SECRET = 'product-report-test-secret';
    const app = express();
    app.use('/api/reports', require('../src/routes/reportRoutes'));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/reports`;
        const query = '?startDate=2026-10-01&endDate=2026-10-31';
        const staff = jwt.sign({ tenant_id: 1, system_role: 'STAFF' }, process.env.JWT_SECRET);
        const manager = jwt.sign({ tenant_id: 1, system_role: 'MANAGER' }, process.env.JWT_SECRET);
        assert.equal((await fetch(`${base}/products${query}`)).status, 401);
        assert.equal((await fetch(`${base}/products${query}`, { headers: { Authorization: `Bearer ${staff}` } })).status, 403);
        const headers = { Authorization: `Bearer ${manager}` };
        const response = await fetch(`${base}/products${query}`, { headers });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).totalRevenue, 900);
        const detailResponse = await fetch(`${base}/products/4/invoices${query}`, { headers });
        assert.equal(detailResponse.status, 200);
        assert.equal((await detailResponse.json()).data[0].invoice_id, 42);
        assert.equal((await fetch(`${base}/products/no/invoices${query}`, { headers })).status, 400);
        productExists = false;
        assert.equal((await fetch(`${base}/products/4/invoices${query}`, { headers })).status, 404);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    console.log('PASS: product/service revenue, invoice lines, filters, validation and HTTP permissions');
})().catch(error => { console.error(error); process.exitCode = 1; });