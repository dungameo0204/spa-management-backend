const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

async function main() {
    if (!process.env.DOTENV_CONFIG_PATH || process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3308') throw Error('Rosa 3308 explicit config required');
    const database = require('../src/config/database');
    const groups = require('../src/services/treatmentGroupService');
    const { masterPool } = database, db = 'db_spa_1791039769068_e185';
    let connection, server;
    try {
        connection = await masterPool.getConnection();
        await connection.beginTransaction();
        masterPool.query = connection.query.bind(connection);
        masterPool.getConnection = async () => ({ query: connection.query.bind(connection), beginTransaction: () => connection.query('SAVEPOINT child_merge'), commit: () => connection.query('RELEASE SAVEPOINT child_merge'), rollback: () => connection.query('ROLLBACK TO SAVEPOINT child_merge'), release() {} });
        const suffix = Date.now();
        const [customer] = await connection.query(`INSERT INTO \`${db}\`.customers (fullname,phone_number) VALUES (?,?)`, [`Child merge ${suffix}`, `CM${suffix}`]);
        const [[branch]] = await connection.query(`SELECT id FROM \`${db}\`.branches WHERE deleted_at IS NULL LIMIT 1`);
        const [rootProduct] = await connection.query(`INSERT INTO \`${db}\`.products (name,price,sale_price,is_product,is_treatment_combo,default_sessions) VALUES (?,?,?,?,?,?)`, [`Root ${suffix}`,0,0,0,1,1]);
        const [laserProduct] = await connection.query(`INSERT INTO \`${db}\`.products (name,price,sale_price,is_product,is_treatment_combo,default_sessions,unit) VALUES (?,?,?,?,?,?,?)`, [`Laser ${suffix}`,1000,1000,0,1,10,'session']);
        const [pnpProduct] = await connection.query(`INSERT INTO \`${db}\`.products (name,price,sale_price,is_product,is_treatment_combo,default_sessions,unit) VALUES (?,?,?,?,?,?,?)`, [`PNP ${suffix}`,1000,1000,0,1,10,'session']);
        const config = { total_sessions: null, children: [
            { product_id: laserProduct.insertId, total_sessions: 10, price: 1000 },
            { product_id: pnpProduct.insertId, total_sessions: 10, price: 1000 }
        ] };
        await groups.create(connection, db, { customerId: customer.insertId, productId: rootProduct.insertId, basePrice: 0, createdAt: '2026-01-01 00:00:00' }, config, 'child-merge-test');
        const latest = await groups.create(connection, db, { customerId: customer.insertId, productId: rootProduct.insertId, basePrice: 0, createdAt: '2026-02-01 00:00:00' }, config, 'child-merge-test');
        const latestRoot = latest.treatmentId;
        const latestLaser = latest.children.find(child => child.product_id === laserProduct.insertId).id;
        const latestPnp = latest.children.find(child => child.product_id === pnpProduct.insertId).id;
        await connection.query(`UPDATE \`${db}\`.treatments SET remaining_sessions=? WHERE id=?`, [3, latestLaser]);
        await connection.query(`UPDATE \`${db}\`.treatments SET remaining_sessions=? WHERE id=?`, [4, latestPnp]);
        const app = express(); app.use(express.json()); app.use('/api/invoices', require('../src/routes/invoiceRoutes'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const token = jwt.sign({ tenant_id: 7, system_role: 'MANAGER', username: 'child-merge-test', branch_id: branch.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/invoices`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ customer_id: customer.insertId, branch_id: branch.id, paid_amount: 10000, invoice_date: '2026-10-29 10:30:00', items: [{ product_id: laserProduct.insertId, quantity: 1, unit_price: 10000 }] }) });
        const body = await response.json();
        assert.equal(response.status, 201, JSON.stringify(body));
        assert.equal(body.invoiceDate, '2026-10-29 10:30:00');
        assert.equal(body.itemMappings[0].treatment_id, latestLaser);
        assert.equal(body.itemMappings[0].parent_treatment_id, latestRoot);
        assert.equal(body.itemMappings[0].root_treatment_id, latestRoot);
        const [cards] = await connection.query(`SELECT id,parent_treatment_id,product_id,total_sessions,remaining_sessions FROM \`${db}\`.treatments WHERE customer_id=? AND product_id IN (?,?) AND deleted_at IS NULL ORDER BY id`, [customer.insertId, laserProduct.insertId, pnpProduct.insertId]);
        const laser = cards.find(card => Number(card.id) === Number(latestLaser));
        const pnp = cards.find(card => Number(card.id) === Number(latestPnp));
        assert.deepEqual([Number(laser.total_sessions), Number(laser.remaining_sessions)], [20, 13]);
        assert.deepEqual([Number(pnp.total_sessions), Number(pnp.remaining_sessions)], [10, 4]);
        assert.equal(cards.filter(card => Number(card.product_id) === Number(laserProduct.insertId) && card.parent_treatment_id == null).length, 0);
        console.log('PASS: individual service purchase merges into matching child of newest active group only.');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (connection) { await connection.rollback(); connection.release(); }
        await masterPool.end();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
