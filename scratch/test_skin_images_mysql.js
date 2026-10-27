// Real HTTP + MySQL, outer transaction with per-service savepoints; all writes rolled back.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function main() {
    if (!process.env.DOTENV_CONFIG_PATH || process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3308') throw new Error('Explicit Rosa 3308 environment required.');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'rosa-upload-http-'));
    process.env.UPLOAD_ROOT = temp;
    const database = require('../src/config/database');
    const { masterPool } = database;
    const originalQuery = masterPool.query;
    const originalGet = masterPool.getConnection;
    const storage = require('../src/utils/skinImageStorage');
    const originalMove = storage.move;
    const db = 'db_spa_1791039769068_e185';
    let connection;
    let server;
    let customerId;
    let failInsert = false;
    try {
        assert.equal(await database.getTenantDbName(7), db);
        connection = await masterPool.getConnection();
        assert.equal((await connection.query('SELECT @@port AS port'))[0][0].port, 3308);
        await connection.beginTransaction();
        const [insert] = await connection.query(`INSERT INTO \`${db}\`.customers (fullname,phone_number) VALUES (?,?)`, ['Upload HTTP test', `T${Date.now()}`]);
        customerId = insert.insertId;
        masterPool.query = connection.query.bind(connection);
        masterPool.getConnection = async () => ({
            query: async (sql, params) => {
                if (failInsert && sql.includes('INSERT INTO') && sql.includes('customer_skin_images')) throw new Error('Injected DB failure');
                return connection.query(sql, params);
            },
            beginTransaction: () => connection.query('SAVEPOINT upload_test'),
            commit: () => connection.query('RELEASE SAVEPOINT upload_test'),
            rollback: () => connection.query('ROLLBACK TO SAVEPOINT upload_test'), release() {}
        });
        const app = express();
        app.use(express.json());
        app.use('/api/customers/:customerId/skin-image-sessions', require('../src/routes/skinImageRoutes'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const route = `/api/customers/${customerId}/skin-image-sessions`;
        const token = claims => jwt.sign({ tenant_id: 7, system_role: 'MANAGER', username: 'upload-test', ...claims }, process.env.JWT_SECRET, { expiresIn: '5m' });
        const manager = token({});
        const request = async (url, { method = 'GET', body, bearer = manager, json = false } = {}) => {
            const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
            if (json) headers['Content-Type'] = 'application/json';
            const response = await fetch(base + url, { method, headers, body: json ? JSON.stringify(body) : body });
            return { status: response.status, headers: response.headers, body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
        };
        const form = ({ count = 2, date = '2020-02-29', bytes = png, mime = 'image/png', field = 'images', note } = {}) => {
            const body = new FormData();
            if (date !== undefined && date !== null) body.append('captured_date', date);
            if (note !== undefined) body.append('note', note);
            for (let i = 0; i < count; i++) body.append(field, new Blob([bytes], { type: mime }), `test-${i}.png`);
            return body;
        };
        assert.equal((await request(route, { bearer: null })).status, 401);
        for (const claims of [{ customer_id: customerId }, { system_role: 'SUPER_ADMIN' }, { tenant_id: null }]) {
            assert.equal((await request(route, { bearer: token(claims) })).status, 403);
        }
        let response = await request(route, { method: 'POST', body: form({ note: 'Before treatment' }) });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        const session = response.body.data.sessionId;
        assert.equal(response.body.data.images.length, 2);
        const first = response.body.data.images[0];
        assert.equal(first.file_path, undefined);
        response = await request(route + '/' + session);
        assert.equal(response.body.data.captured_date, '2020-02-29');
        assert.equal(response.body.data.images.length, 2);
        assert.equal(response.body.data.note, 'Before treatment');
        const downloaded = await request(first.file_url);
        assert.equal(downloaded.status, 200);
        assert.deepEqual(downloaded.body, png);
        assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
        assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
        assert.equal((await request(first.file_url, { bearer: null })).status, 401);
        response = await request(route + '?startDate=2020-01-01&endDate=2020-12-31&pageSize=1', { bearer: token({ system_role: 'STAFF' }) });
        assert.equal(response.status, 200);
        assert.equal(response.body.total, 1);
        assert.equal(response.body.data[0].images.length, 2);
        assert.equal((await request(route + '?startDate=2021-01-01&endDate=2020-01-01')).status, 400);
        assert.equal((await request(route + '?pageSize=101')).status, 400);
        response = await request(`${route}/${session}/images`, { method: 'POST', body: form({ count: 1, date: null }) });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.data.images[0].sort_order, 2);
        assert.equal((await request(`${route}/${session}`, { method: 'PUT', json: true, body: { captured_date: '2021-01-02', note: null } })).status, 200);
        response = await request(`${route}/${session}`);
        assert.equal(response.body.data.note, null);
        assert.equal(response.body.data.captured_date, '2021-01-02');
        for (const options of [{ count: 0 }, { date: '2026-02-30' }, { date: '2099-01-01' }, { date: null },
            { bytes: Buffer.from('<svg/>') }, { mime: 'image/jpeg' }, { mime: 'text/plain' }, { field: 'other' }, { count: 11 }]) {
            response = await request(route, { method: 'POST', body: form(options) });
            assert.equal(response.status, 400, JSON.stringify({ options: { ...options, bytes: undefined }, result: response.body }));
        }
        response = await request(route, { method: 'POST', body: form({ count: 1, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }) });
        assert.equal(response.status, 413);
        response = await request(route, { method: 'POST', json: true, body: {} });
        assert.equal(response.status, 415);
        // Invalid fields reject the whole request, even when some files were received.
        const extra = form(); extra.append('tenant_id', '999');
        assert.equal((await request(route, { method: 'POST', body: extra })).status, 400);
        const mixed = form({ count: 1 }); mixed.append('images', new Blob(['not an image'], { type: 'image/png' }), 'invalid.png');
        assert.equal((await request(route, { method: 'POST', body: mixed })).status, 400);
        const fileCount = async () => (await fs.readdir(temp, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).length;
        assert.equal(await fileCount(), 3);
        failInsert = true;
        assert.equal((await request(route, { method: 'POST', body: form() })).status, 500);
        failInsert = false;
        assert.equal(await fileCount(), 3, 'DB error must remove moved files');
        let moves = 0;
        storage.move = async (...args) => { if (++moves === 2) throw new Error('Injected disk failure'); return originalMove(...args); };
        assert.equal((await request(route, { method: 'POST', body: form() })).status, 500);
        storage.move = originalMove;
        assert.equal(await fileCount(), 3, 'disk error must remove earlier moved files');
        const otherCustomer = (await connection.query(`INSERT INTO \`${db}\`.customers (fullname,phone_number) VALUES (?,?)`, ['Other test', `U${Date.now()}`]))[0].insertId;
        assert.equal((await request(first.file_url.replace(`/customers/${customerId}/`, `/customers/${otherCustomer}/`))).status, 404);
        const otherTenant = (await connection.query('SELECT id FROM db_system_master.tenants WHERE id<>7 AND deleted_at IS NULL LIMIT 1'))[0][0];
        if (otherTenant) assert.equal((await request(first.file_url, { bearer: token({ tenant_id: otherTenant.id }) })).status, 404);
        assert.equal((await request(`${route}/${session}/images/${first.id}`, { method: 'DELETE' })).status, 200);
        assert.equal((await request(first.file_url)).status, 404);
        assert.equal((await request(`${route}/${session}`)).body.data.images.length, 2);
        const remaining = (await request(`${route}/${session}`)).body.data.images[0].file_url;
        assert.equal((await request(`${route}/${session}`, { method: 'DELETE' })).status, 200);
        assert.equal((await request(remaining)).status, 404);
        assert.equal((await request(`${route}/${session}`)).status, 404);
        assert.equal((await request(`${route}/${session}/images`, { method: 'POST', body: form({ date: null }) })).status, 404);
        assert.equal((await request(route)).body.total, 0);
        assert.equal(await fileCount(), 3, 'soft delete must retain physical files');
        response = await request(route, { method: 'POST', body: form({ count: 10, note: 'Maximum files and both text fields' }) });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.data.images.length, 10);
        assert.equal(await fileCount(), 13);
        const secondSession = response.body.data.sessionId;
        await connection.query(`UPDATE \`${db}\`.customers SET deleted_at=NOW() WHERE id=?`, [customerId]);
        assert.equal((await request(`${route}/${secondSession}`)).status, 404);
        assert.equal((await request(response.body.data.images[0].file_url)).status, 404);
        await connection.query(`UPDATE \`${db}\`.customers SET deleted_at=NULL WHERE id=?`, [customerId]);
        assert.deepEqual(await fs.readdir(path.join(temp, '.tmp')), []);
        await connection.rollback();
        assert.equal((await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.customers WHERE id=?`, [customerId]))[0][0].total, 0);
        console.log('PASS: HTTP multipart upload/list/detail/append/file/update/delete, STAFF access, auth/tenant isolation, limits, validation, DB/disk failures and cleanup; Rosa MySQL writes rolled back.');
    } finally {
        storage.move = originalMove;
        if (server) await new Promise(resolve => server.close(resolve));
        masterPool.query = originalQuery;
        masterPool.getConnection = originalGet;
        if (connection) { await connection.rollback(); connection.release(); }
        await masterPool.end();
        // This exact directory was allocated above exclusively for this test.
        await fs.rm(temp, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });