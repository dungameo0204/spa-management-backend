const assert = require('node:assert/strict');
const calls = [];
let emptyReport = false;
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant', masterPool: { query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes("DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS date")) return [[
            { date: '2026-10-01', service_revenue: '0.00', product_revenue: '2500000.00', invoice_cash: '100.00', wallet_used: '30.00' }
        ]];
        if (sql.includes("AS date") && sql.includes('GROUP BY DATE_FORMAT(')) {
            const amounts = { 'dp.amount': '20.00', 'w.paid_amount': '50.00', 'e.amount': '10.00', 'imp.total_amount': '40.00' };
            const field = Object.keys(amounts).find(key => sql.includes(`SUM(${key})`));
            return [[{ date: '2026-10-02', value: amounts[field] }]];
        }
        if (emptyReport && sql.includes('COUNT(*) AS total')) return [[{ total: 0, total_amount: '0.00' }]];
        if (emptyReport && sql.includes('ORDER BY')) return [[]];
        if (sql.includes('COUNT(*) AS total')) return [[{ total: 42, total_amount: '120.00', grand_total: '120.00' }]];
        if (sql.includes('GROUP BY th.branch_id') || sql.includes('GROUP BY i.branch_id')) return [[{ branch_id: 1, branch_name: 'A', staff_id: 3, staff_name: 'B', total_amount: '120.00', record_count: 2 }]];
        if (sql.includes('ORDER BY')) return [[{ id: 1, revenue_amount: '100.00' }]];
        if (sql.includes('AS service_revenue') && sql.includes('AS invoice_cash')) return [[{ service_revenue: '0.00', product_revenue: '2500000.00', invoice_cash: '100.00', wallet_used: '30.00' }]];
        if (sql.includes('COALESCE(SUM(')) {
            if (sql.includes('SUM(dp.amount)')) return [[{ value: '20.00' }]];
            if (sql.includes('SUM(w.paid_amount)')) return [[{ value: '50.00' }]];
            if (sql.includes('SUM(e.amount)')) return [[{ value: '10.00' }]];
            if (sql.includes('SUM(imp.total_amount)')) return [[{ value: '40.00' }]];
            return [[{ value: '0.00' }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
    } }
} };
const service = require('../src/services/reportService');
const express = require('express');
const jwt = require('jsonwebtoken');

(async () => {
    const filters = { startDate: '2026-10-01', endDate: '2026-10-31', branchId: '1' };
    const summary = await service.getRevenue(1, filters);
    assert.equal(summary.productRevenue, 2500000);
    assert.equal(summary.serviceRevenue, 0);
    assert.equal(summary.receipts.total, 170);
    assert.equal(summary.receipts.walletUsedExcluded, 30);
    assert.equal(summary.expenses.total, 50);
    assert.equal(summary.netCashFlow, 120);
    assert.equal(summary.daily.length, 31);
    assert.deepEqual(summary.daily.slice(0, 3).map(day => day.date), ['2026-10-01', '2026-10-02', '2026-10-03']);
    assert.equal(summary.daily.at(-1).date, '2026-10-31');
    assert.equal(summary.daily[0].totalRevenue, 2500000);
    assert.equal(summary.daily[0].receipts.invoiceCash, 100);
    assert.equal(summary.daily[0].receipts.walletUsedExcluded, 30);
    assert.equal(summary.daily[1].receipts.total, 70);
    assert.equal(summary.daily[1].expenses.total, 50);
    assert.equal(summary.daily[1].netCashFlow, 20);
    assert.equal(summary.daily[2].totalRevenue, 0);
    assert.equal(summary.daily[2].receipts.total, 0);
    assert.equal(summary.daily[2].expenses.total, 0);
    assert.equal(summary.daily.reduce((sum, day) => sum + day.totalRevenue, 0), summary.totalRevenue);
    assert.equal(summary.daily.reduce((sum, day) => sum + day.receipts.total, 0), summary.receipts.total);
    assert.equal(summary.daily.reduce((sum, day) => sum + day.expenses.total, 0), summary.expenses.total);
    assert.equal(summary.daily.reduce((sum, day) => sum + day.netCashFlow, 0), summary.netCashFlow);
    assert.equal((await service.getRevenue(1, { startDate: '2026-10-02', endDate: '2026-10-02' })).daily.length, 1);
    assert.equal((await service.getRevenue(1, { startDate: '2024-02-28', endDate: '2024-03-01' })).daily.length, 3);
    const invoiceSql = calls.find(c => c.sql.includes('AS service_revenue') && c.sql.includes('AS invoice_cash'));
    assert.match(invoiceSql.sql, /COALESCE\(items\.service_gross, 0\) - GREATEST\(0, COALESCE\(items\.service_gross, 0\) \+ COALESCE\(items\.product_gross, 0\) - i\.total_amount\)/);
    assert.match(invoiceSql.sql, /ii\.deleted_at IS NULL/);
    assert.deepEqual(invoiceSql.params, ['2026-10-01', '2026-10-31', 1]);
    const invoiceDailySql = calls.find(c => c.sql.includes("DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS date"));
    assert.match(invoiceDailySql.sql, /ii\.deleted_at IS NULL/);
    assert.match(invoiceDailySql.sql, /GROUP BY DATE_FORMAT\(i\.invoice_date, '%Y-%m-%d'\)/);
    assert.deepEqual(invoiceDailySql.params, ['2026-10-01', '2026-10-31', 1]);
    for (const column of ['dp.payment_date', 'w.created_at', 'e.expense_date', 'imp.import_date']) {
        const query = calls.find(c => c.sql.includes(`DATE_FORMAT(${column}, '%Y-%m-%d') AS date`));
        assert.match(query.sql, new RegExp(`GROUP BY DATE_FORMAT\\(${column.replace('.', '\\.')}, '%Y-%m-%d'\\)`));
        assert.deepEqual(query.params, ['2026-10-01', '2026-10-31', 1]);
    }
    assert.equal(calls.filter(c => c.sql.includes('FROM `test_tenant`.invoices i')).length, 6);

    const details = await service.getDetails(1, 'consultants', { ...filters, page: '2', pageSize: '10', staffId: '3' });
    assert.equal(details.total, 42);
    assert.equal(details.totalAmount, 120);
    assert.equal(details.totalPages, 5);
    assert.equal(details.period.staffId, 3);
    const detailSql = calls.find(c => c.sql.includes('FROM `test_tenant`.invoice_item_consultants') && c.sql.includes('LIMIT ?'));
    assert.match(detailSql.sql, /ic\.deleted_at IS NULL AND ii\.deleted_at IS NULL AND i\.deleted_at IS NULL/);
    assert.match(detailSql.sql, /ic\.staff_id = \?/);
    assert.deepEqual(detailSql.params, ['2026-10-01', '2026-10-31', 1, 3, 10, 10]);

    const amounts = {
        invoices: 'i.total_amount', debt_payments: 'dp.amount', wallet_logs: 'w.paid_amount',
        expenses: 'e.amount', inventory_imports: 'imp.total_amount',
        commissions: 'dynamic', consultants: 'ic.revenue_amount'
    };
    for (const [type, column] of Object.entries(amounts)) {
        const first = await service.getDetails(1, type, { ...filters, page: 1, pageSize: 2 });
        const next = await service.getDetails(1, type, { ...filters, page: 2, pageSize: 2 });
        assert.equal(first.totalAmount, 120, `${type} first page`);
        assert.equal(next.totalAmount, 120, `${type} second page`);
        const aggregate = calls.at(-2);
        const pageQuery = calls.at(-1);
        if (type === 'commissions') {
            assert.match(aggregate.sql, /SUM\(\(COALESCE\(pc\.commission_fixed_amount, 0\) \+ p\.price \* COALESCE\(pc\.commission_percent, 0\) \/ 100\)\)/);
            assert.match(pageQuery.sql, /product_commissions pc ON pc\.product_id = t\.product_id AND pc\.role_id = s\.role_id AND pc\.deleted_at IS NULL/);
            assert.doesNotMatch(pageQuery.sql, /ths\.commission_amount_snapshot/);
        } else assert.match(aggregate.sql, new RegExp(`COUNT\\(\\*\\) AS total, COALESCE\\(SUM\\(${column.replace('.', '\\.')}\\), 0\\) AS total_amount`));
        assert.match(aggregate.sql, /deleted_at IS NULL/);
        assert.deepEqual(aggregate.params, ['2026-10-01', '2026-10-31', 1]);
        assert.deepEqual(pageQuery.params, [...aggregate.params, 2, 2]);
    }
    const staffDetail = await service.getDetails(1, 'commissions', { ...filters, staffId: 3, page: 99 });
    assert.equal(staffDetail.totalAmount, 120);
    assert.deepEqual(calls.at(-2).params, ['2026-10-01', '2026-10-31', 1, 3]);
    assert.match(calls.at(-2).sql, /s\.id = \?/);
    emptyReport = true;
    const empty = await service.getDetails(1, 'invoices', { ...filters, page: 99 });
    assert.equal(empty.total, 0);
    assert.equal(empty.totalAmount, 0);
    assert.deepEqual(empty.data, []);
    emptyReport = false;

    const groups = await service.getStaffReport(1, 'commissions', { ...filters, staffId: 3 });
    assert.equal(groups.totalAmount, 120);
    assert.equal(groups.total, 42);
    assert.equal(groups.totalPages, 3);
    assert.deepEqual(calls.at(-1).params, ['2026-10-01', '2026-10-31', 1, 3, 20, 0]);
    assert.deepEqual(groups.staffTotals[0], { branch_id: 1, branch_name: 'A', staff_id: 3, staff_name: 'B', total_amount: 120, record_count: 2 });
    assert.match(calls.at(-1).sql, /s\.id = \?/);
    assert.match(calls.at(-1).sql, /ths\.deleted_at IS NULL AND th\.deleted_at IS NULL/);
    const searched = await service.getDetails(1, 'invoices', { ...filters, search: '  Hoa%_  ', page: 2 });
    assert.equal(searched.total, 42);
    assert.equal(searched.totalPages, 3);
    assert.equal(searched.totalAmount, 120);
    assert.match(calls.at(-2).sql, /LOCATE\(LOWER\(\?\), LOWER\(COALESCE\(CAST\(c\.fullname AS CHAR\)/);
    assert.deepEqual(calls.at(-1).params.slice(-2), [20, 20]);
    assert.ok(calls.at(-2).params.slice(3).every(value => value === 'Hoa%_'));
    const productSearch = await service.getProductRevenue(1, { ...filters, search: '  da%  ', page: 2 });
    assert.equal(productSearch.total, 42);
    assert.match(calls.at(-2).sql, /HAVING LOCATE\(LOWER\(\?\), LOWER\(product_name\)\)/);
    assert.deepEqual(calls.at(-1).params.slice(-4), ['da%', 'da%', 20, 20]);
    await assert.rejects(service.getDetails(1, 'invoices', { ...filters, search: 'x'.repeat(101) }), /search/);
    await assert.rejects(service.getRevenue(1, { startDate: '2026-02-30', endDate: '2026-03-01' }), /startDate/);
    await assert.rejects(service.getDetails(1, 'invoices', { ...filters, pageSize: 101 }), /pageSize/);
    await assert.rejects(service.getDetails(1, 'invoices', { ...filters, staffId: 3 }), /staffId/);
    await assert.rejects(service.getDetails(1, 'bogus', filters), /type/);
    await assert.rejects(service.getRevenue(1, { ...filters, branchId: '' }), /branchId/);
    // Real HTTP router: every report, including personnel totals and details, is MANAGER-only.
    process.env.JWT_SECRET = 'report-test-secret';
    const app = express();
    app.use('/api/reports', require('../src/routes/reportRoutes'));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/reports/revenue?startDate=2026-10-01&endDate=2026-10-31`;
        const withoutToken = await fetch(url);
        assert.equal(withoutToken.status, 401);
        const staffToken = jwt.sign({ tenant_id: 1, system_role: 'STAFF', branch_id: 1 }, process.env.JWT_SECRET);
        assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${staffToken}` } })).status, 403);
        const managerToken = jwt.sign({ tenant_id: 1, system_role: 'MANAGER' }, process.env.JWT_SECRET);
        const base = `http://127.0.0.1:${server.address().port}/api/reports`;
        const dateQuery = 'startDate=2026-10-01&endDate=2026-10-31';
        const as = token => ({ headers: { Authorization: `Bearer ${token}` } });
        for (const type of ['commissions', 'consultants']) {
            for (const path of [type, `details/${type}`]) {
                for (const branchQuery of ['', '&branchId=999', '&branchId=bad']) {
                    const before = calls.length;
                    const response = await fetch(`${base}/${path}?${dateQuery}${branchQuery}&staffId=3&page=2&pageSize=2`, as(staffToken));
                    assert.equal(response.status, 403, path);
                    assert.equal(calls.length, before, 'STAFF must not query report data');
                }
                const managerResponse = await fetch(`${base}/${path}?${dateQuery}`, as(managerToken));
                assert.equal(managerResponse.status, 200);
                assert.equal((await managerResponse.json()).period.branchId, null);
                const filtered = await fetch(`${base}/${path}?${dateQuery}&branchId=2`, as(managerToken));
                assert.equal(filtered.status, 200);
                assert.equal((await filtered.json()).period.branchId, 2);
                const before = calls.length;
                const invalidBranch = await fetch(`${base}/${path}?${dateQuery}&branchId=bad`, as(managerToken));
                assert.equal(invalidBranch.status, 400);
                assert.equal(calls.length, before);
                assert.equal((await fetch(`${base}/${path}?${dateQuery}`)).status, 401);
                const withoutBranch = jwt.sign({ tenant_id: 1, system_role: 'STAFF' }, process.env.JWT_SECRET);
                assert.equal((await fetch(`${base}/${path}?${dateQuery}`, as(withoutBranch))).status, 403);
                const badBranch = jwt.sign({ tenant_id: 1, system_role: 'STAFF', branch_id: 'invalid' }, process.env.JWT_SECRET);
                assert.equal((await fetch(`${base}/${path}?${dateQuery}`, as(badBranch))).status, 403);
                const superToken = jwt.sign({ tenant_id: 1, system_role: 'SUPER_ADMIN', branch_id: 1 }, process.env.JWT_SECRET);
                assert.equal((await fetch(`${base}/${path}?${dateQuery}`, as(superToken))).status, 403);
            }
        }
        for (const path of ['details/invoices', 'details/expenses', 'products', 'revenue']) {
            assert.equal((await fetch(`${base}/${path}?${dateQuery}`, as(staffToken))).status, 403);
        }
        const response = await fetch(url, { headers: { Authorization: `Bearer ${managerToken}` } });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).netCashFlow, 120);
        const detailResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/details/invoices?startDate=2026-10-01&endDate=2026-10-31&branchId=1&page=2&pageSize=2`, { headers: { Authorization: `Bearer ${managerToken}` } });
        assert.equal(detailResponse.status, 200);
        assert.equal((await detailResponse.json()).totalAmount, 120);
        const searchResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/details/invoices?startDate=2026-10-01&endDate=2026-10-31&search=Hoa&page=2`, { headers: { Authorization: `Bearer ${managerToken}` } });
        assert.equal(searchResponse.status, 200);
        assert.equal((await searchResponse.json()).total, 42);
        assert.ok(calls.at(-2).params.includes('Hoa'));
        const invalidSearch = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/products?startDate=2026-10-01&endDate=2026-10-31&search=${'x'.repeat(101)}`, { headers: { Authorization: `Bearer ${managerToken}` } });
        assert.equal(invalidSearch.status, 400);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    console.log('PASS: report summary, detail totals across pages, staff grouping, filters');
})().catch(error => { console.error(error); process.exitCode = 1; });