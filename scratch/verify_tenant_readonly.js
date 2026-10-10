// Read-only live verification; no API writes or SQL mutations.
const assert = require('node:assert/strict');
require('dotenv').config({ quiet: true });
const express = require('express');
const jwt = require('jsonwebtoken');
const { masterPool } = require('../src/config/database');

const db = 'db_spa_1791039769068_e185';
const routes = {
    branches: 'branchRoutes', roles: 'roleRoutes', staffs: 'staffRoutes', customers: 'customerRoutes',
    products: 'productRoutes', invoices: 'invoiceRoutes', expenses: 'expenseRoutes',
    'inventory-imports': 'inventoryImportRoutes', treatments: 'treatmentRoutes',
    appointments: 'appointmentRoutes', 'customer-bookings': 'customerBookingRoutes',
    'customer-wallet-logs': 'customerWalletLogRoutes', 'debt-payments': 'debtPaymentRoutes',
    reports: 'reportRoutes', users: 'userRoutes', tenants: 'tenantRoutes'
};
const base = { startDate: '2026-10-01', endDate: '2026-10-31' };
const near = (a, b, label) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.02, `${label}: ${a} != ${b}`);

(async () => {
    const [[tenant]] = await masterPool.query('SELECT id FROM db_system_master.tenants WHERE database_name = ? AND deleted_at IS NULL', [db]);
    assert.ok(tenant, 'Tenant unavailable');
    const app = express();
    for (const [path, file] of Object.entries(routes)) app.use(`/api/${path}`, require(`../src/routes/${file}`));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const managerToken = jwt.sign({ tenant_id: tenant.id, system_role: 'MANAGER' }, process.env.JWT_SECRET);
    const superToken = jwt.sign({ tenant_id: tenant.id, system_role: 'SUPER_ADMIN' }, process.env.JWT_SECRET);
    const request = async (path, params = {}, token = managerToken, status = 200) => {
        const url = new URL(`http://127.0.0.1:${server.address().port}/api/${path}`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const body = await response.json();
        assert.equal(response.status, status, `${path}: HTTP ${response.status}: ${body.message}`);
        return body;
    };
    const checks = [
        ['branches', 'branches'], ['roles', 'roles'], ['staffs', 'staffs'], ['customers', 'customers'],
        ['products', 'products'], ['invoices', 'invoices'], ['expenses', 'expense_vouchers'],
        ['inventory-imports', 'inventory_imports'], ['treatments', 'treatments'],
        ['appointments', 'appointments'], ['customer-bookings', 'customer_bookings'],
        ['customer-wallet-logs', 'customer_wallet_logs'], ['debt-payments', 'debt_payments']
    ];
    try {
        for (const [path, table] of checks) {
            const [[expected]] = await masterPool.query(`SELECT COUNT(*) AS total FROM \`${db}\`.\`${table}\` WHERE deleted_at IS NULL`);
            const first = await request(path, { page: 1, pageSize: 3 });
            assert.equal(first.total, expected.total, `${path}: total != active SQL rows`);
            assert.equal(first.totalPages, Math.ceil(expected.total / 3), `${path}: pages`);
            const seen = new Set();
            for (let page = 1; page <= first.totalPages; page++) {
                const response = page === 1 ? first : await request(path, { page, pageSize: 3 });
                assert.ok(response.data.length <= 3);
                assert.equal(response.page, page);
                for (const row of response.data) { assert.ok(!seen.has(row.id), `${path}: duplicate ${row.id}`); seen.add(row.id); }
            }
            assert.equal(seen.size, first.total, `${path}: rows missing`);
            const beyond = await request(path, { page: first.totalPages + 1, pageSize: 3 });
            assert.deepEqual(beyond.data, []);
            await request(path, { page: 0 }, managerToken, 400);
            await request(path, { pageSize: 101 }, managerToken, 400);
            console.log(`PASS ${path}: ${first.total} active, ${first.totalPages} pages`);
        }
        const users = await request('users', { pageSize: 2 });
        const [[userCount]] = await masterPool.query('SELECT COUNT(*) AS total FROM db_system_master.users WHERE tenant_id = ?', [tenant.id]);
        assert.equal(users.total, userCount.total);
        console.log(`PASS users: ${users.total}`);
        const tenants = await request('tenants', { pageSize: 2 }, superToken);
        const [[tenantCount]] = await masterPool.query('SELECT COUNT(*) AS total FROM db_system_master.tenants t LEFT JOIN db_system_master.users u ON t.id = u.tenant_id WHERE t.deleted_at IS NULL AND (u.deleted_at IS NULL OR u.id IS NULL)');
        assert.equal(tenants.total, tenantCount.total);
        console.log(`PASS tenants: ${tenants.total}`);

        const [[branch]] = await masterPool.query(`SELECT branch_id AS id FROM \`${db}\`.invoices WHERE deleted_at IS NULL LIMIT 1`);
        assert.ok(branch);
        const [[branchCount]] = await masterPool.query(`SELECT COUNT(*) AS total FROM \`${db}\`.invoices WHERE deleted_at IS NULL AND branch_id = ?`, [branch.id]);
        assert.equal((await request('invoices', { branchId: branch.id, pageSize: 2 })).total, branchCount.total);
        const [[customer]] = await masterPool.query(`SELECT id FROM \`${db}\`.customers WHERE deleted_at IS NULL ORDER BY id LIMIT 1`);
        const [[customerCount]] = await masterPool.query(`SELECT COUNT(*) AS total FROM \`${db}\`.treatments WHERE deleted_at IS NULL AND customer_id = ?`, [customer.id]);
        assert.equal((await request('treatments', { customerId: customer.id, pageSize: 2 })).total, customerCount.total);
        console.log('PASS scoped invoices/treatments');

        const staffToken = jwt.sign({ tenant_id: tenant.id, system_role: 'STAFF', branch_id: branch.id }, process.env.JWT_SECRET);
        const staffInvoices = await request('invoices', { pageSize: 2, branchId: 999999 }, staffToken);
        assert.equal(staffInvoices.total, branchCount.total, 'STAFF branch must override caller branch');
        const [[walletBranchCount]] = await masterPool.query(`SELECT COUNT(*) AS total FROM \`${db}\`.customer_wallet_logs WHERE deleted_at IS NULL AND branch_id = ?`, [branch.id]);
        assert.equal((await request('customer-wallet-logs', { branchId: 999999 }, staffToken)).total, walletBranchCount.total);
        await request('reports/revenue', base, staffToken, 403);
        console.log(`PASS STAFF branch isolation: invoices=${staffInvoices.total}, wallet=${walletBranchCount.total}; reports forbidden`);

        const [invoiceDates] = await masterPool.query(`SELECT DATE_FORMAT(invoice_date, '%Y-%m-%d') AS day, COUNT(*) AS total FROM \`${db}\`.invoices WHERE deleted_at IS NULL GROUP BY DATE_FORMAT(invoice_date, '%Y-%m-%d') ORDER BY day`);
        for (const date of invoiceDates) {
            const oneDay = { startDate: date.day, endDate: date.day, pageSize: 2 };
            const listed = await request('invoices', oneDay);
            assert.equal(listed.total, date.total, `invoice date boundary ${date.day}`);
            const reported = await request('reports/details/invoices', oneDay);
            assert.equal(reported.total, date.total, `report date boundary ${date.day}`);
        }
        console.log(`PASS invoice inclusive date bounds: ${invoiceDates.length} distinct days`);

        for (const branchId of [undefined, branch.id]) {
            const params = { ...base, ...(branchId ? { branchId } : {}) };
            const summary = await request('reports/revenue', params);
            const details = {};
            for (const type of ['invoices', 'debt_payments', 'wallet_logs', 'expenses', 'inventory_imports', 'commissions', 'consultants']) {
                const first = await request(`reports/details/${type}`, { ...params, page: 1, pageSize: 2 });
                const rows = [...first.data];
                for (let page = 2; page <= first.totalPages; page++) rows.push(...(await request(`reports/details/${type}`, { ...params, page, pageSize: 2 })).data);
                assert.equal(rows.length, first.total, `${type} total mismatch`);
                assert.equal(new Set(rows.map(row => row.id)).size, rows.length, `${type} duplicate`);
                details[type] = rows;
            }
            const sum = (rows, field) => rows.reduce((n, row) => n + Number(row[field] || 0), 0);
            near(sum(details.invoices, 'service_revenue'), summary.serviceRevenue, 'service revenue');
            near(sum(details.invoices, 'product_revenue'), summary.productRevenue, 'product revenue');
            near(sum(details.invoices, 'paid_amount'), summary.receipts.invoiceCash, 'invoice cash');
            near(sum(details.invoices, 'wallet_used'), summary.receipts.walletUsedExcluded, 'wallet used');
            near(sum(details.debt_payments, 'amount'), summary.receipts.debtPayments, 'debt payments');
            near(sum(details.wallet_logs, 'paid_amount'), summary.receipts.walletTopups, 'wallet topups');
            near(sum(details.expenses, 'amount'), summary.expenses.expenseVouchers, 'expenses');
            near(sum(details.inventory_imports, 'total_amount'), summary.expenses.inventoryImports, 'inventory imports');
            for (const type of ['commissions', 'consultants']) {
                const first = await request(`reports/${type}`, { ...params, page: 1, pageSize: 2 });
                const groups = [...first.staffTotals];
                for (let page = 2; page <= first.totalPages; page++) groups.push(...(await request(`reports/${type}`, { ...params, page, pageSize: 2 })).staffTotals);
                assert.equal(groups.length, first.total, `${type} staff count`);
                near(sum(groups, 'total_amount'), first.totalAmount, `${type} grand total`);
                near(sum(details[type], type === 'commissions' ? 'commission_amount_snapshot' : 'revenue_amount'), first.totalAmount, `${type} detail sum`);
            }
            console.log(`PASS reports branch=${branchId ?? 'all'}: ${Object.entries(details).map(([key, rows]) => `${key}:${rows.length}`).join(' ')}; revenue=${summary.totalRevenue}; cash=${summary.netCashFlow}`);
        }
        const tomorrow = await request('appointments/tomorrow', { pageSize: 2 });
        const notArrived = await request('appointments/not-arrived', { pageSize: 2 });
        console.log(`PASS appointment views: tomorrow=${tomorrow.total}, not-arrived=${notArrived.total}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
        await masterPool.end();
    }
})().catch(error => { console.error('FAIL:', error); process.exitCode = 1; });