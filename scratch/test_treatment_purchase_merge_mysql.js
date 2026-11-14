const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

async function main() {
    if (!process.env.DOTENV_CONFIG_PATH || process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3308') throw Error('Rosa 3308 explicit config required');
    const database = require('../src/config/database');
    const { masterPool } = database, db = 'db_spa_1791039769068_e185';
    let connection, server;
    try {
        connection = await masterPool.getConnection();
        await connection.beginTransaction();
        masterPool.query = connection.query.bind(connection);
        masterPool.getConnection = async () => ({ query: connection.query.bind(connection), beginTransaction: () => connection.query('SAVEPOINT treatment_purchase_merge'), commit: () => connection.query('RELEASE SAVEPOINT treatment_purchase_merge'), rollback: () => connection.query('ROLLBACK TO SAVEPOINT treatment_purchase_merge'), release() {} });
        const [customer] = await connection.query(`INSERT INTO \`${db}\`.customers (fullname,phone_number) VALUES ('Purchase merge',?)`, [`M${Date.now()}`]);
        const [[branch]] = await connection.query(`SELECT id FROM \`${db}\`.branches WHERE deleted_at IS NULL LIMIT 1`);
        const [product] = await connection.query(`INSERT INTO \`${db}\`.products (name,price,sale_price,is_product,is_treatment_combo,default_sessions,unit) VALUES (?,?,?,?,?,?,?)`, [`Merge ${Date.now()}`,1000,1000,0,1,5,'gÃ³i']);
        const app = express(); app.use(express.json()); app.use('/api/invoices', require('../src/routes/invoiceRoutes')); app.use('/api/treatments', require('../src/routes/treatmentRoutes'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const request = async (method, route, body) => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ tenant_id: 7, system_role: 'MANAGER', username: 'merge-test', branch_id: branch.id }, process.env.JWT_SECRET, { expiresIn: '5m' })}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json() };
        };
        const sale = (quantity, treatmentConfig, invoiceDate) => request('POST', '/invoices', { customer_id: customer.insertId, branch_id: branch.id, paid_amount: quantity * 1000, ...(invoiceDate === undefined ? {} : { invoice_date: invoiceDate }), items: [{ product_id: product.insertId, quantity, unit_price: 1000, ...(treatmentConfig === undefined ? {} : { treatment: treatmentConfig }) }] });
        const invoiceDate = '2026-10-28 09:15:00';
        const first = await sale(2, undefined, invoiceDate); assert.equal(first.status, 201, JSON.stringify(first.body));
        const second = await sale(1); assert.equal(second.status, 201, JSON.stringify(second.body));
        assert.equal(first.body.invoiceDate, invoiceDate);
        const [[createdDates]] = await connection.query(`SELECT DATE_FORMAT(i.invoice_date, '%Y-%m-%d %H:%i:%s') AS invoice_date,DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS treatment_created_at FROM \`${db}\`.invoices i JOIN \`${db}\`.treatments t ON t.invoice_id=i.id WHERE i.id=?`, [first.body.invoiceId]);
        assert.deepEqual([createdDates.invoice_date, createdDates.treatment_created_at], [invoiceDate, invoiceDate]);
        assert.equal(first.body.itemMappings[0].treatment_id, second.body.itemMappings[0].treatment_id);
        assert.equal(first.body.itemMappings[0].parent_treatment_id, null);
        assert.equal(first.body.itemMappings[0].root_treatment_id, first.body.itemMappings[0].treatment_id);
        const treatmentId = first.body.itemMappings[0].treatment_id;
        let [[card]] = await connection.query(`SELECT total_sessions,remaining_sessions FROM \`${db}\`.treatments WHERE id=?`, [treatmentId]);
        assert.deepEqual([Number(card.total_sessions), Number(card.remaining_sessions)], [15, 15]);
        assert.equal((await connection.query(`SELECT COUNT(*) count FROM \`${db}\`.treatment_purchases WHERE treatment_id=? AND deleted_at IS NULL`, [treatmentId]))[0][0].count, 2);
        const [[dates]] = await connection.query('SELECT DATE_FORMAT(CURDATE(),\'%Y-%m-%d\') AS today,DATE_FORMAT(DATE_ADD(CURDATE(),INTERVAL 1 DAY),\'%Y-%m-%d\') AS tomorrow');
        const execute = await request('POST', '/treatments/execute', { treatment_id: treatmentId, branch_id: branch.id, execution_date: `${dates.today}T09:00:00` }); assert.equal(execute.status, 201, JSON.stringify(execute.body));
        const duplicate = await request('POST', '/treatments/execute', { treatment_id: treatmentId, branch_id: branch.id, execution_date: `${dates.today}T15:00:00` });
        assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
        assert.match(duplicate.body.message, /tick hai l.n/);
        assert.equal((await request('POST', '/treatments/execute', { treatment_id: treatmentId, branch_id: branch.id, execution_date: `${dates.tomorrow}T09:00:00` })).status, 201);
        await connection.query(`UPDATE \`${db}\`.treatment_history SET deleted_at=NOW(),deleted_by='merge-test' WHERE id=?`, [execute.body.treatmentHistoryId]);
        assert.equal((await request('POST', '/treatments/execute', { treatment_id: treatmentId, branch_id: branch.id, execution_date: `${dates.today}T15:00:00` })).status, 201);
        await connection.query(`UPDATE \`${db}\`.treatment_history SET deleted_at=NOW(),deleted_by='merge-test' WHERE treatment_id=?`, [treatmentId]);
        card = (await connection.query(`SELECT total_sessions,remaining_sessions FROM \`${db}\`.treatments WHERE id=?`, [treatmentId]))[0][0];
        await connection.query(`UPDATE \`${db}\`.treatments SET remaining_sessions=total_sessions WHERE id=?`, [treatmentId]);
        assert.equal((await request('DELETE', `/invoices/${second.body.invoiceId}`)).status, 200);
        card = (await connection.query(`SELECT total_sessions,remaining_sessions,deleted_at FROM \`${db}\`.treatments WHERE id=?`, [treatmentId]))[0][0];
        assert.deepEqual([Number(card.total_sessions), Number(card.remaining_sessions), card.deleted_at], [10, 10, null]);
        const unlimited = await sale(1, { total_sessions: null });
        assert.equal(unlimited.status, 201, JSON.stringify(unlimited.body));
        assert.equal(unlimited.body.itemMappings[0].treatment_id, treatmentId);
        card = (await connection.query(`SELECT total_sessions,remaining_sessions FROM \`${db}\`.treatments WHERE id=?`, [treatmentId]))[0][0];
        assert.deepEqual([card.total_sessions, card.remaining_sessions], [null, null]);
        const afterUnlimitedFinite = await sale(1);
        assert.equal(afterUnlimitedFinite.status, 201, JSON.stringify(afterUnlimitedFinite.body));
        assert.equal(afterUnlimitedFinite.body.itemMappings[0].treatment_id, treatmentId);
        card = (await connection.query(`SELECT total_sessions,remaining_sessions FROM \`${db}\`.treatments WHERE id=?`, [treatmentId]))[0][0];
        assert.deepEqual([card.total_sessions, card.remaining_sessions], [null, null]);
        const revokeUnlimited = await request('DELETE', `/invoices/${unlimited.body.invoiceId}`);
        assert.equal(revokeUnlimited.status, 400, JSON.stringify(revokeUnlimited.body));
        assert.match(revokeUnlimited.body.message, /nối trọn đời/);
        console.log('PASS: finite purchase merges to unlimited, unlimited remains dominant, and merged unlimited purchase cannot be revoked.');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (connection) { await connection.rollback(); connection.release(); }
        await masterPool.end();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
