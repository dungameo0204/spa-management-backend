// Starts its own disposable MySQL instance. Never reads .env or connects to tenant servers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');

(async () => {
    const executable = process.env.LEGACY_TEST_MYSQLD || 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe';
    assert.ok(fs.existsSync(executable), 'Set LEGACY_TEST_MYSQLD to a local mysqld executable.');
    const directory = path.resolve(__dirname, `../artifacts/mysql-legacy-debt-${Date.now()}`);
    fs.mkdirSync(directory, { recursive: true });
    const dataDir = path.join(directory, 'data');
    const initialized = spawnSync(executable, ['--no-defaults', '--initialize-insecure', `--datadir=${dataDir}`, `--log-error=${path.join(directory, 'init.err')}`], { timeout: 120000 });
    assert.equal(initialized.status, 0, `MySQL initialization failed; inspect ${directory}`);
    const port = 3349;
    const server = spawn(executable, ['--no-defaults', `--datadir=${dataDir}`, '--bind-address=127.0.0.1', `--port=${port}`, '--mysqlx=OFF', `--log-error=${path.join(directory, 'server.err')}`], { stdio: 'ignore' });
    let admin;
    let pool;
    const options = { host: '127.0.0.1', port, user: 'root', password: '', connectTimeout: 1000, multipleStatements: true };
    try {
        for (let attempt = 0; attempt < 80; attempt++) {
            if (server.exitCode !== null) throw new Error(`Disposable MySQL stopped; inspect ${directory}`);
            try { admin = await mysql.createConnection(options); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
        }
        assert.ok(admin, 'Disposable MySQL startup timed out.');
        const [[identity]] = await admin.query('SELECT @@datadir AS dir, @@port AS port');
        assert.equal(identity.dir.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase(), dataDir.replace(/\\/g, '/').toLowerCase());
        assert.equal(Number(identity.port), port);
        await admin.query('CREATE DATABASE legacy_debt_test; USE legacy_debt_test');
        const root = path.resolve(__dirname, '..');
        await admin.query(fs.readFileSync(path.join(root, 'db_spa_template.sql'), 'utf8'));
        // Recreate old constraint, then apply the exact deployment migration twice.
        await admin.query('ALTER TABLE debt_payments MODIFY invoice_id INT NOT NULL');
        const migration = fs.readFileSync(path.join(root, 'docs/migrations/2026-10-29_legacy_debt_payments.sql'), 'utf8');
        await admin.query(migration);
        await admin.query(migration);
        const [[column]] = await admin.query("SHOW COLUMNS FROM debt_payments LIKE 'invoice_id'");
        assert.equal(column.Null, 'YES');
        const [fk] = await admin.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = 'legacy_debt_test' AND TABLE_NAME = 'debt_payments' AND COLUMN_NAME = 'invoice_id' AND REFERENCED_TABLE_NAME = 'invoices'");
        assert.equal(fk.length, 1);
        await admin.query("INSERT INTO branches (id,name) VALUES (1,'Sale'),(2,'Collection'),(3,'Other'); INSERT INTO customers (id,fullname,total_debt) VALUES (10,'Mixed',300),(11,'Legacy only',90),(12,'Concurrent',100),(13,'Invoice concurrent',300); INSERT INTO invoices (id,customer_id,branch_id,total_amount,paid_amount,debt_amount,invoice_date) VALUES (1,10,1,100,0,100,'2026-10-29'),(2,13,1,100,0,100,'2026-10-29')");
        pool = mysql.createPool({ ...options, database: 'legacy_debt_test' });
        const configPath = require.resolve('../src/config/database');
        require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: {
            getTenantDbName: async () => 'legacy_debt_test', masterPool: pool
        } };
        const service = require('../src/services/debtPaymentService');
        const reports = require('../src/services/reportService');
        const customers = require('../src/services/customerService');
        const assertBalances = async (id, total, invoice, legacy) => {
            const detail = await customers.getCustomerById(1, id);
            const overview = await customers.getCustomerOverview(1, String(id));
            for (const result of [detail, overview.customer]) {
                assert.equal(Number(result.total_debt), total);
                assert.equal(result.invoice_debt, invoice);
                assert.equal(result.legacy_debt, legacy);
                assert.equal(typeof result.invoice_debt, 'number');
                assert.equal(typeof result.legacy_debt, 'number');
            }
        };
        const create = (customerId, amount, branchId = 2) => service.createLegacyDebtPayment(1, { customer_id: customerId, amount, collection_branch_id: branchId, payment_date: '2026-10-29 12:00:00' }, 'test', 'MANAGER');
        const debt = async id => Number((await admin.query('SELECT total_debt FROM customers WHERE id = ?', [id]))[0][0].total_debt);
        const filters = { startDate: '2026-10-29', endDate: '2026-10-29', branchId: 2 };
        await assertBalances(10, 300, 100, 200);
        await assertBalances(11, 90, 0, 90);
        const first = await create(10, 200);
        await assertBalances(10, 100, 100, 0);
        assert.equal(await debt(10), 100);
        await assert.rejects(create(10, 0.01), /nợ cũ/);
        let report = await reports.getRevenue(1, filters);
        assert.equal(report.legacyDebtRevenue, 200);
        assert.equal(report.totalRevenue, 200);
        assert.equal(report.receipts.total, 200);
        assert.equal(report.daily[0].legacyDebtRevenue, 200);
        assert.equal((await reports.getRevenue(1, { ...filters, branchId: 1 })).legacyDebtRevenue, 0);
        const detail = await service.getDebtPaymentDetail(1, first.debtPaymentId, 'MANAGER');
        assert.equal(detail.invoice_id, null);
        assert.equal(detail.invoice_total_amount, null);
        await service.updateDebtPayment(1, first.debtPaymentId, { amount: 50, customer_id: 11, collection_branch_id: 3 }, 'test', 'MANAGER');
        assert.equal(await debt(10), 300);
        assert.equal(await debt(11), 40);
        await assertBalances(10, 300, 100, 200);
        await assertBalances(11, 40, 0, 40);
        assert.equal((await reports.getRevenue(1, filters)).legacyDebtRevenue, 0);
        assert.equal((await reports.getRevenue(1, { ...filters, branchId: 3 })).legacyDebtRevenue, 50);
        await service.deleteDebtPayment(1, first.debtPaymentId, 'test', 'MANAGER');
        assert.equal(await debt(11), 90);
        await assertBalances(11, 90, 0, 90);
        assert.equal((await reports.getRevenue(1, { ...filters, branchId: 3 })).legacyDebtRevenue, 0);
        await assert.rejects(create(10, 201), /nợ cũ/);
        await assert.rejects(service.createLegacyDebtPayment(1, { customer_id: 10, amount: 20, collection_branch_id: 999 }, 'test', 'MANAGER'), /Chi nhánh/);
        assert.equal(await debt(10), 300, 'failure must roll back');

        const concurrent = await Promise.allSettled([create(12, 80), create(12, 80)]);
        assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(await debt(12), 20);
        assert.match(concurrent.find(result => result.status === 'rejected').reason.message, /nợ cũ/);

        // Force a wait on a customer while an invoice-linked collection commits.
        // Legacy calculation must use the post-commit invoice balance, not an older snapshot.
        const blocker = await pool.getConnection();
        try {
            await blocker.beginTransaction();
            await blocker.query('SELECT id FROM customers WHERE id = 13 FOR UPDATE');
            await blocker.query("INSERT INTO debt_payments (customer_id,branch_id,collection_branch_id,invoice_id,amount,payment_date) VALUES (13,1,2,2,100,'2026-10-29')");
            await blocker.query('UPDATE customers SET total_debt = total_debt - 100 WHERE id = 13');
            const pending = create(13, 200);
            await new Promise(resolve => setTimeout(resolve, 150));
            await blocker.commit();
            await pending;
            assert.equal(await debt(13), 0);
        } finally { await blocker.rollback(); blocker.release(); }
        report = await reports.getRevenue(1, filters);
        assert.equal(report.legacyDebtRevenue, 280);
        assert.equal(report.totalRevenue, 280);
        assert.equal(report.receipts.debtPayments, 280, 'invoice-linked cash stays attributed to invoice branch');
        const all = await reports.getRevenue(1, { startDate: filters.startDate, endDate: filters.endDate });
        assert.equal(all.legacyDebtRevenue, 280);
        assert.equal(all.totalRevenue, 480, '200 invoice revenue + 280 legacy revenue');
        assert.equal(all.receipts.debtPayments, 380, 'invoice-linked receipt is cash, not new revenue');
        await assertBalances(13, 0, 0, 0);
        // Invoice collection changes invoice debt, not legacy debt; edits/deletion reverse it.
        const linked = await service.createDebtPayment(1, { invoice_id: 1, amount: 25, collection_branch_id: 2 }, 'test', 'MANAGER');
        await assertBalances(10, 275, 75, 200);
        await service.updateDebtPayment(1, linked.debtPaymentId, { amount: 40 }, 'test', 'MANAGER');
        await assertBalances(10, 260, 60, 200);
        await service.deleteDebtPayment(1, linked.debtPaymentId, 'test', 'MANAGER');
        await assertBalances(10, 300, 100, 200);
        // Deleted invoices and their receipts do not contribute. Preserve inconsistent totals.
        await admin.query("INSERT INTO invoices (id,customer_id,branch_id,total_amount,paid_amount,debt_amount,invoice_date,deleted_at) VALUES (3,10,3,900,0,900,NOW(),NOW()); UPDATE customers SET total_debt = 50 WHERE id = 10");
        await assertBalances(10, 50, 100, 0);
        await assert.rejects(create(10, 1), /nợ cũ/);
        await admin.query('UPDATE customers SET total_debt = 300 WHERE id = 10');
        await assertBalances(10, 300, 100, 200);
        console.log('PASS: isolated MySQL migration/FK, mixed debt, edit/delete, report attribution, rollback, concurrent collections and post-lock snapshot');
    } finally {
        if (pool) await pool.end();
        if (admin) await admin.end();
        // This child process belongs exclusively to this test, never a deployed server.
        if (server.exitCode === null) {
            const exited = new Promise(resolve => server.once('exit', resolve));
            server.kill();
            await exited;
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });