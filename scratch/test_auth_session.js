const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = 'isolated-auth-session-test-secret';
const secret = process.env.JWT_SECRET;
const originalUser = {
    id: 12, tenant_id: 3, branch_id: null, username: 'manager.demo', fullname: 'Demo',
    system_role: 'MANAGER', deleted_at: null, password: bcrypt.hashSync('password123', 4)
};
let user;
let tenant;
let dbError;
let queries = 0;
const reset = () => {
    user = { ...originalUser };
    tenant = { id: 3, spa_name: 'Demo Spa', expire_at: null, deleted_at: null, database_name: 'private_db' };
    dbError = false;
    process.env.JWT_SECRET = secret;
};
reset();
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
    id: databasePath, filename: databasePath, loaded: true,
    exports: { masterPool: { query: async (sql, params) => {
        queries += 1;
        if (dbError) throw new Error('PRIVATE_DATABASE_ERROR');
        if (sql.includes('FROM users')) {
            const match = user && (sql.includes('username = ?') ? user.username === params[0] : user.id === params[0]);
            return [match ? [{ ...user }] : []];
        }
        if (sql.includes('FROM tenants')) return [tenant && tenant.id === params[0] ? [{ ...tenant }] : []];
        throw new Error(`Unexpected SQL: ${sql}`);
    } } }
};

const { verifyToken, verifyManager } = require('../src/middlewares/auth');
const { attachTenantDB } = require('../src/middlewares/tenant');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../src/routes/authRoutes'));
app.get('/manager', verifyToken, verifyManager, (_req, res) => res.json({ ok: true }));
app.get('/tenant', verifyToken, attachTenantDB, (_req, res) => res.json({ ok: true }));
const claims = { id: 12, tenant_id: 3, branch_id: null, system_role: 'MANAGER' };
const token = (changes = {}, options = {}) => jwt.sign({ ...claims, ...changes }, secret, { expiresIn: '15h', ...options });

(async () => {
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, authorization, body) => {
        const headers = {};
        if (authorization !== undefined) headers.Authorization = authorization;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(`${base}${path}`, {
            method: body === undefined ? 'GET' : 'POST', headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
    };
    const expect = async (authorization, status, code) => {
        const response = await request('/api/auth/me', authorization);
        assert.equal(response.status, status);
        assert.equal(response.body.code, code);
        assert.equal(response.cache, 'no-store');
        return response;
    };
    try {
        const valid = token();
        const session = await expect(`Bearer ${valid}`, 200, undefined);
        assert.deepEqual(session.body.data.user, {
            id: 12, tenant_id: 3, branch_id: null, username: 'manager.demo', fullname: 'Demo', system_role: 'MANAGER'
        });
        assert.deepEqual(session.body.data.tenant, { id: 3, spa_name: 'Demo Spa', expire_at: null });
        assert.equal(session.body.data.expires_at, new Date(jwt.decode(valid).exp * 1000).toISOString());
        assert.equal(session.body.data.token, undefined);
        assert.ok(!JSON.stringify(session.body).includes('password'));
        assert.ok(!JSON.stringify(session.body).includes('private_db'));
        const before = queries;
        await expect(undefined, 401, 'AUTH_TOKEN_MISSING');
        for (const value of ['Basic abc', 'Bearer', 'Bearer bad.token', 'Bearer a b']) {
            await expect(value, 401, 'AUTH_TOKEN_INVALID');
        }
        await expect(`Bearer ${token({}, { expiresIn: -1 })}`, 401, 'AUTH_TOKEN_EXPIRED');
        await expect(`Bearer ${jwt.sign(claims, 'wrong-secret')}`, 401, 'AUTH_TOKEN_INVALID');
        await expect(`Bearer ${token({}, { algorithm: 'HS384' })}`, 401, 'AUTH_TOKEN_INVALID');
        assert.equal(queries, before, 'Invalid tokens must not query DB');
        await expect(`Bearer ${token({ customer_id: 8 })}`, 401, 'AUTH_SESSION_INVALID');
        await expect(`Bearer ${token({ id: undefined })}`, 401, 'AUTH_SESSION_INVALID');
        await expect(`Bearer ${jwt.sign(claims, secret)}`, 401, 'AUTH_SESSION_INVALID');
        user = null;
        await expect(`Bearer ${valid}`, 401, 'AUTH_SESSION_INVALID');
        reset(); user.deleted_at = new Date();
        await expect(`Bearer ${valid}`, 401, 'AUTH_SESSION_INVALID');
        for (const change of [{ system_role: 'STAFF' }, { tenant_id: 9 }, { branch_id: 5 }]) {
            reset(); Object.assign(user, change);
            await expect(`Bearer ${valid}`, 401, 'AUTH_SESSION_CHANGED');
        }
        reset(); user.fullname = 'Updated name';
        assert.equal((await expect(`Bearer ${valid}`, 200)).body.data.user.fullname, 'Updated name');
        reset(); tenant = null;
        await expect(`Bearer ${valid}`, 403, 'TENANT_DISABLED');
        reset(); tenant.deleted_at = new Date();
        await expect(`Bearer ${valid}`, 403, 'TENANT_DISABLED');
        reset(); tenant.expire_at = new Date(Date.now() - 1000);
        await expect(`Bearer ${valid}`, 403, 'TENANT_EXPIRED');
        const expiredTenant = await request('/tenant', `Bearer ${valid}`);
        assert.equal(expiredTenant.status, 403);
        assert.equal(expiredTenant.body.code, 'TENANT_EXPIRED');
        reset(); tenant.expire_at = new Date(Date.now() + 86400000);
        await expect(`Bearer ${valid}`, 200);
        reset(); user = { ...user, tenant_id: null, system_role: 'SUPER_ADMIN' };
        const admin = await expect(`Bearer ${token({ tenant_id: null, system_role: 'SUPER_ADMIN' })}`, 200);
        assert.equal(admin.body.data.tenant, null);
        reset(); user = { ...user, branch_id: 5, system_role: 'STAFF' };
        await expect(`Bearer ${token({ branch_id: 5, system_role: 'STAFF' })}`, 200);
        const denied = await request('/manager', `Bearer ${token({ system_role: 'STAFF' })}`);
        assert.equal(denied.status, 403);
        assert.equal(denied.body.code, 'FORBIDDEN');
        reset(); dbError = true;
        const failed = await expect(`Bearer ${valid}`, 500, 'AUTH_SERVICE_ERROR');
        assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_DATABASE_ERROR'));
        reset(); delete process.env.JWT_SECRET;
        await expect(`Bearer ${valid}`, 500, 'AUTH_SERVICE_ERROR');
        reset();
        const login = body => request('/api/auth/login', undefined, body);
        assert.equal((await login({ username: 'manager.demo' })).status, 400);
        assert.equal((await login({ username: [], password: {} })).status, 400);
        assert.equal((await login({ username: 'manager.demo', password: 'wrong' })).body.code, 'AUTH_CREDENTIALS_INVALID');
        tenant.deleted_at = new Date();
        assert.equal((await login({ username: 'manager.demo', password: 'password123' })).body.code, 'TENANT_DISABLED');
        reset();
        const loggedIn = await login({ username: 'manager.demo', password: 'password123' });
        assert.equal(loggedIn.status, 200);
        assert.equal(loggedIn.body.data.user.password, undefined);
        const decoded = jwt.verify(loggedIn.body.data.token, secret);
        assert.equal(decoded.exp - decoded.iat, 15 * 3600);
        await expect(`Bearer ${loggedIn.body.data.token}`, 200);
        dbError = true;
        assert.equal((await login({ username: 'manager.demo', password: 'password123' })).status, 500);
        reset(); delete process.env.JWT_SECRET;
        assert.equal((await login({ username: 'manager.demo', password: 'password123' })).status, 500);
        console.log('PASS: auth session HTTP contract, token errors, live user/tenant checks, permissions and login failures (mock DB only)');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });