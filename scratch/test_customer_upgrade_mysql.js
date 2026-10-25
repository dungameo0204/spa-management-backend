// Disposable instance only. Never loads .env or uses production connection settings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { migrate } = require('../scripts/apply-customer-upgrade');
const expectedDir = path.resolve(__dirname, '../artifacts/mysql-customer-upgrade-test/data').replace(/\\/g, '/').toLowerCase();

(async () => {
    const connection = await mysql.createConnection({ host: '127.0.0.1', port: 3308, user: 'root', password: '', multipleStatements: true });
    try {
        const [[info]] = await connection.query('SELECT @@port AS port, @@datadir AS dir');
        assert.equal(Number(info.port), 3308);
        assert.equal(info.dir.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase(), expectedDir);
        // Refuse to overwrite anything, even in this isolated instance.
        const [existing] = await connection.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('db_system_master','db_spa_template','db_spa_upgrade_test')");
        assert.equal(existing.length, 0, 'Test schemas already exist; use a fresh disposable instance.');
        await connection.query('CREATE DATABASE db_system_master; CREATE TABLE db_system_master.tenants (id INT PRIMARY KEY, database_name VARCHAR(100)); INSERT INTO db_system_master.tenants VALUES (1, \'db_spa_upgrade_test\'); CREATE DATABASE db_spa_template; CREATE DATABASE db_spa_upgrade_test; USE db_spa_upgrade_test');
        const schema = fs.readFileSync(path.resolve(__dirname, '../db_spa_template.sql'), 'utf8');
        await connection.query(schema);
        await connection.query('USE db_spa_template');
        await connection.query(schema);
        await connection.query("INSERT INTO db_spa_upgrade_test.customers (fullname, phone_number) VALUES ('Legacy customer', '0900000000'); INSERT INTO db_spa_upgrade_test.products (name, price, sale_price, is_product) VALUES ('Legacy service', 100, 100, 0)");
        await connection.query('ALTER TABLE db_spa_upgrade_test.customers DROP COLUMN date_of_birth; ALTER TABLE db_spa_upgrade_test.products DROP COLUMN sale_price; SET SESSION SQL_SAFE_UPDATES = 1');
        const options = { db: 'db_spa_upgrade_test', apply: false };
        await migrate(connection, options, () => {});
        const [[absent]] = await connection.query("SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'db_spa_upgrade_test' AND COLUMN_NAME = 'date_of_birth'");
        assert.equal(Number(absent.total), 0);
        await migrate(connection, { ...options, apply: true, backupConfirmed: true }, () => {});
        const [[legacy]] = await connection.query('SELECT c.date_of_birth, p.sale_price FROM db_spa_upgrade_test.customers c CROSS JOIN db_spa_upgrade_test.products p');
        assert.equal(legacy.date_of_birth, null); assert.equal(Number(legacy.sale_price), 100);
        const [[safe]] = await connection.query('SELECT @@SESSION.SQL_SAFE_UPDATES AS value'); assert.equal(safe.value, 1);
        // Partial Workbench scenario: column exists nullable, mixed NULL/valid/legacy prices.
        await connection.query("ALTER TABLE db_spa_upgrade_test.products MODIFY sale_price DECIMAL(15,2) NULL; INSERT INTO db_spa_upgrade_test.products (name, price, sale_price, is_product) VALUES ('Partial',100,NULL,0),('Discount',100,80,0),('Above',100,120,0)");
        await migrate(connection, { ...options, apply: true, backupConfirmed: true }, () => {});
        const [prices] = await connection.query('SELECT sale_price FROM db_spa_upgrade_test.products ORDER BY id');
        assert.deepEqual(prices.map(p => Number(p.sale_price)), [100, 100, 80, 120]);
        await migrate(connection, { ...options, apply: true, backupConfirmed: true }, () => {});
        await migrate(connection, { db: 'db_spa_template', apply: true, backupConfirmed: true }, () => {});

        const db = require.resolve('../src/config/database');
        require.cache[db] = { id: db, filename: db, loaded: true, exports: {
            getTenantDbName: async () => 'db_spa_upgrade_test', masterPool: { query: connection.query.bind(connection), getConnection: async () => ({
                query: connection.query.bind(connection), beginTransaction: connection.beginTransaction.bind(connection), commit: connection.commit.bind(connection), rollback: connection.rollback.bind(connection), release() {}
            }) }
        } };
        const customers = require('../src/services/customerService');
        const treatments = require('../src/services/treatmentService');
        const id = await customers.createCustomer(1, { fullname: 'Birthday', phone_number: '0900000001', date_of_birth: '2000-02-29' }, 'test');
        assert.equal((await customers.getCustomerById(1, id)).date_of_birth, '2000-02-29');
        assert.equal((await customers.getCustomers(1, 'Birthday', {})).data[0].date_of_birth, '2000-02-29');
        assert.equal((await customers.getCustomerOverview(1, id)).customer.date_of_birth, '2000-02-29');
        await customers.updateCustomer(1, id, { note: 'Keep date' }, 'test');
        assert.equal((await customers.getCustomerById(1, id)).date_of_birth, '2000-02-29');
        await customers.updateCustomer(1, id, { date_of_birth: null }, 'test');
        assert.equal((await customers.getCustomerById(1, id)).date_of_birth, null);
        await connection.query("INSERT INTO db_spa_upgrade_test.branches (name) VALUES ('Test')");
        const { treatmentId } = await treatments.createTreatment(1, { customer_id: id, product_id: 1, total_sessions: 10, remaining_sessions: 4, commission_base_price: 100 }, 'test');
        for (let i = 0; i < 4; i++) await treatments.executeTreatmentSession(1, { treatment_id: treatmentId, branch_id: 1 }, 'test', 'MANAGER');
        await assert.rejects(treatments.executeTreatmentSession(1, { treatment_id: treatmentId, branch_id: 1 }, 'test', 'MANAGER'), /hết số buổi/);
        const [[card]] = await connection.query('SELECT total_sessions, remaining_sessions FROM db_spa_upgrade_test.treatments WHERE id = ?', [treatmentId]);
        assert.equal(card.total_sessions, 10); assert.equal(card.remaining_sessions, 0);
        const [[history]] = await connection.query('SELECT COUNT(*) AS total FROM db_spa_upgrade_test.treatment_history');
        assert.equal(history.total, 4);
        console.log('PASS: real isolated MySQL 3308 schema import, fresh/partial/rerun/template migration, Safe Updates, customer DOB read/write, imported treatment consumption.');
    } finally { await connection.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });