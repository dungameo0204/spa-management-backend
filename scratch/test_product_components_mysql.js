const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
async function main() {
    if (!process.env.DOTENV_CONFIG_PATH || process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3308') throw new Error('Explicit Rosa 3308 config required.');
    const { masterPool, getTenantDbName } = require('../src/config/database');
    const originalQuery = masterPool.query;
    const originalGet = masterPool.getConnection;
    const db = 'db_spa_1791039769068_e185';
    let connection;
    let server;
    let rejectSync = false;
    const ids = [];
    try {
        assert.equal(await getTenantDbName(7), db);
        connection = await masterPool.getConnection();
        assert.equal((await connection.query('SELECT @@port AS port'))[0][0].port, 3308);
        await connection.beginTransaction();
        masterPool.query = connection.query.bind(connection);
        masterPool.getConnection = async () => ({
            query: async (sql, params) => {
                if (rejectSync && sql.includes('INSERT INTO') && sql.includes('product_service_components')) throw new Error('Injected component write error');
                return connection.query(sql, params);
            },
            beginTransaction: () => connection.query('SAVEPOINT product_component_test'),
            commit: () => connection.query('RELEASE SAVEPOINT product_component_test'),
            rollback: () => connection.query('ROLLBACK TO SAVEPOINT product_component_test'), release() {}
        });
        const app = express();
        app.use(express.json());
        app.use('/api/products', require('../src/routes/productRoutes'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const url = `http://127.0.0.1:${server.address().port}/api/products`;
        const token = role => jwt.sign({ tenant_id: 7, system_role: role, username: 'product-component-test' }, process.env.JWT_SECRET, { expiresIn: '5m' });
        const request = async (method, route = '', body, role = 'MANAGER') => {
            const response = await fetch(url + route, { method, headers: { Authorization: `Bearer ${token(role)}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json() };
        };
        const suffix = Date.now();
        const create = async (name, more = {}, role) => {
            const result = await request('POST', '', { name: `TEST components ${name} ${suffix}`, price: 1000, sale_price: 900, is_product: false, ...more }, role);
            assert.equal(result.status, 201, JSON.stringify(result.body));
            ids.push(result.body.productId);
            return result.body.productId;
        };
        const child1 = await create('child1');
        const child2 = await create('child2');
        const retail = await create('retail', { is_product: true });
        const parent = await create('parent', { child_service_ids: [child2, child1] });
        const invalidName = `TEST invalid component ${suffix}`;
        assert.equal((await request('POST', '', { name: invalidName, price: 1000, sale_price: 900, is_product: true, child_service_ids: [child1] })).status, 400);
        assert.equal((await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.products WHERE name=?`, [invalidName]))[0][0].total, 0);
        assert.equal((await request('PUT', `/${parent}`, { price: 800 })).status, 400);
        assert.equal((await request('PUT', `/${parent}`, { sale_price: null })).status, 400);
        assert.equal((await request('PUT', `/${parent}`, { sale_price: 0 })).status, 200);
        assert.equal(Number((await request('GET', `/${parent}`)).body.data.sale_price), 0);
        assert.equal((await request('PUT', `/${parent}`, { sale_price: 900 })).status, 200);
        assert.deepEqual((await request('GET', `/${parent}`)).body.data.child_service_ids, [child2, child1]);
        assert.deepEqual((await request('GET', `/${retail}`)).body.data.child_service_ids, []);
        const list = await request('GET', `?search=${encodeURIComponent('TEST components parent ' + suffix)}&pageSize=10`);
        assert.deepEqual(list.body.data[0].child_service_ids, [child2, child1]);
        assert.equal((await request('PUT', `/${parent}`, { description: 'keep links' })).status, 200);
        assert.deepEqual((await request('GET', `/${parent}`)).body.data.child_service_ids, [child2, child1]);
        for (const child_service_ids of [null, '[]', [child1, child1], [String(child1)], [0], [2147483647], [retail], [parent]]) {
            assert.equal((await request('PUT', `/${parent}`, { child_service_ids })).status, 400, JSON.stringify(child_service_ids));
        }
        assert.equal((await request('PUT', `/${retail}`, { child_service_ids: [child1] })).status, 400);
        assert.equal((await request('PUT', `/${child1}`, { child_service_ids: [parent] })).status, 400);
        assert.equal((await request('PUT', `/${child2}`, { child_service_ids: [child1] })).status, 200);
        assert.equal((await request('PUT', `/${child1}`, { child_service_ids: [parent] })).status, 400);
        assert.equal((await request('PUT', `/${child1}`, { is_product: true })).status, 400);
        assert.equal((await request('PUT', `/${parent}`, { is_product: true })).status, 400);
        assert.equal((await request('DELETE', `/${child1}`)).status, 400);
        // Removing/readding links reuses the unique pair; order follows the supplied array.
        assert.equal((await request('PUT', `/${parent}`, { child_service_ids: [] })).status, 200);
        assert.deepEqual((await request('GET', `/${parent}`)).body.data.child_service_ids, []);
        assert.equal((await request('PUT', `/${parent}`, { child_service_ids: [child1, child2] }, 'STAFF')).status, 200);
        assert.deepEqual((await request('GET', `/${parent}`)).body.data.child_service_ids, [child1, child2]);
        const [[links]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.product_service_components WHERE parent_product_id=?`, [parent]);
        assert.equal(links.total, 2);
        // Later failure rolls back relation sync and normal product edits together.
        assert.equal((await request('PUT', `/${parent}`, { child_service_ids: [], sale_price: 1001 })).status, 400);
        assert.deepEqual((await request('GET', `/${parent}`)).body.data.child_service_ids, [child1, child2]);
        rejectSync = true;
        assert.equal((await request('PUT', `/${parent}`, { child_service_ids: [child2], description: 'must rollback' })).status, 400);
        rejectSync = false;
        assert.deepEqual((await request('GET', `/${parent}`)).body.data.child_service_ids, [child1, child2]);
        assert.equal((await request('GET', `/${parent}`)).body.data.description, 'keep links');
        // Shared children allowed; commission permission stays unchanged.
        await create('shared', { child_service_ids: [child1] });
        assert.equal((await request('PUT', `/${parent}`, { commissions: [] }, 'STAFF')).status, 403);
        const p = await create('restore-parent', { child_service_ids: [child2] });
        assert.equal((await request('DELETE', `/${p}`)).status, 200);
        assert.equal((await request('PUT', `/${parent}`, { child_service_ids: [] })).status, 200);
        assert.equal((await request('DELETE', `/${child2}`)).status, 200);
        assert.equal((await request('PATCH', `/${p}/restore`)).status, 400);
        assert.equal((await request('PATCH', `/${child2}/restore`)).status, 200);
        assert.equal((await request('PATCH', `/${p}/restore`)).status, 200);
        assert.deepEqual((await request('GET', `/${p}`)).body.data.child_service_ids, [child2]);
        // Restore must also reject cycles introduced while the parent was dormant.
        const a = await create('dormant-a');
        const b = await create('dormant-b', { child_service_ids: [a] });
        assert.equal((await request('DELETE', `/${b}`)).status, 200);
        assert.equal((await request('PUT', `/${a}`, { child_service_ids: [b] })).status, 400, 'deleted child rejected');
        // A physical invalid edge models legacy/operator data; restore must detect it.
        await connection.query(`INSERT INTO \`${db}\`.product_service_components (parent_product_id,child_product_id) VALUES (?,?)`, [a, b]);
        assert.equal((await request('PATCH', `/${b}/restore`)).status, 400);
        await connection.query(`DELETE FROM \`${db}\`.product_service_components WHERE parent_product_id=?`, [a]);
        // Simulate tenant graph lock held on a separate connection; acquire must time out.
        const blocker = await originalGet.call(masterPool);
        try {
            await blocker.query('SELECT GET_LOCK(?,0)', [`rosa-product-graph:${db}`]);
            assert.equal((await request('PUT', `/${parent}`, { child_service_ids: [child1] })).status, 409);
        } finally {
            await blocker.query('SELECT RELEASE_LOCK(?)', [`rosa-product-graph:${db}`]);
            blocker.release();
        }
        assert.equal((await request('PUT', `/${parent}`, { child_service_ids: [], is_product: true })).status, 200);
        await connection.rollback();
        const [[remaining]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.products WHERE id IN (?)`, [ids]);
        assert.equal(remaining.total, 0);
        console.log('PASS: product HTTP child arrays, order, partial sync, cycles, retail/type/delete/restore guards, STAFF commission restriction, lock contention and rollback on Rosa 3308.');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        masterPool.query = originalQuery;
        masterPool.getConnection = originalGet;
        if (connection) { await connection.rollback(); connection.release(); }
        await masterPool.end();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });