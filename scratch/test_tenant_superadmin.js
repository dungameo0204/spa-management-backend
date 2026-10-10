const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');

const calls = [];
const tenant = { id: 1, expire_at: new Date('2030-01-01T00:00:00Z'), deleted_at: null };
const manager = { id: 10, tenant_id: 1, username: 'manager', fullname: 'Manager', system_role: 'MANAGER', deleted_at: null };
let hash = '';
const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('WHERE t.id = ?')) return [[{ tenant_id: tenant.id }]];
    if (sql.includes("FROM users WHERE tenant_id = ? AND system_role = 'MANAGER'")) return [[manager]];
    if (sql.includes('SELECT id FROM tenants WHERE id = ?')) return [tenant.deleted_at ? [] : [tenant]];
    if (sql.includes('SELECT expire_at FROM tenants WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [tenant.deleted_at ? [] : [{ expire_at: tenant.expire_at }]];
    if (sql.includes('UPDATE tenants SET expire_at = DATE_ADD')) {
        const base = tenant.expire_at > new Date() ? tenant.expire_at : new Date();
        tenant.expire_at = new Date(base);
        tenant.expire_at.setUTCFullYear(base.getUTCFullYear() + params[0]);
        return [{ affectedRows: 1 }];
    }
    if (sql.includes('SELECT expire_at FROM tenants WHERE id = ?')) return [[{ expire_at: tenant.expire_at }]];
    if (sql.includes('UPDATE users SET password = ?')) {
        if (params[2] !== manager.id || params[3] !== manager.tenant_id || manager.deleted_at) return [{ affectedRows: 0 }];
        hash = params[0];
        return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
};
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: {
    masterPool: { query, getConnection: async () => ({ query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }) }
} };
const service = require('../src/services/tenantService');

(async () => {
    process.env.JWT_SECRET = 'superadmin-test-secret';
    const app = express();
    app.use(express.json());
    app.use('/api/tenants', require('../src/routes/tenantRoutes'));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/tenants`;
    const as = role => ({ Authorization: `Bearer ${jwt.sign({ system_role: role, username: role }, process.env.JWT_SECRET)}` });
    const request = (path, role = 'SUPER_ADMIN', method = 'GET', body) => fetch(`${base}${path}`, { method, headers: { ...as(role), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    try {
        for (const path of ['/1/managers', '/1/managers/10/password', '/1/renew']) {
            const method = path.endsWith('password') ? 'PATCH' : path.endsWith('renew') ? 'POST' : 'GET';
            assert.equal((await fetch(`${base}${path}`, { method })).status, 401);
            assert.equal((await request(path, 'MANAGER', method, method === 'GET' ? undefined : {})).status, 403);
        }
        const list = await request('/1/managers');
        assert.equal(list.status, 200);
        assert.equal((await list.json()).data[0].username, 'manager');
        assert.equal((await request('/1/managers/10/password', 'SUPER_ADMIN', 'PATCH', { newPassword: 'short' })).status, 400);
        assert.equal((await request('/1/managers/999/password', 'SUPER_ADMIN', 'PATCH', { newPassword: 'newSecret1' })).status, 404);
        assert.equal((await request('/1/managers/11/password', 'SUPER_ADMIN', 'PATCH', { newPassword: 'newSecret1' })).status, 404); // STAFF in the same tenant
        assert.equal((await request('/2/managers/10/password', 'SUPER_ADMIN', 'PATCH', { newPassword: 'newSecret1' })).status, 404);
        assert.equal((await request('/1/managers/10/password', 'SUPER_ADMIN', 'PATCH', { newPassword: 'newSecret1' })).status, 200);
        assert.ok(await bcrypt.compare('newSecret1', hash));
        assert.notEqual(hash, 'newSecret1');
        const renew = await request('/1/renew', 'SUPER_ADMIN', 'POST', { years: 2 });
        assert.equal(renew.status, 200);
        assert.equal(new Date((await renew.json()).data.expire_at).getUTCFullYear(), 2032);
        assert.match(calls.find(call => call.sql.includes('UPDATE tenants SET expire_at = DATE_ADD')).sql, /GREATEST\(expire_at, NOW\(\)\)/);
        assert.ok(calls.some(call => call.sql.includes('FOR UPDATE')));
        tenant.expire_at = new Date('2020-01-01T00:00:00Z');
        const expiredRenew = await request('/1/renew', 'SUPER_ADMIN', 'POST', { years: 1 });
        assert.equal(expiredRenew.status, 200);
        assert.equal(new Date((await expiredRenew.json()).data.expire_at).getUTCFullYear(), new Date().getUTCFullYear() + 1);
        assert.equal((await request('/1/renew', 'SUPER_ADMIN', 'POST', { years: 0 })).status, 400);
        assert.equal((await request('/1/renew', 'SUPER_ADMIN', 'POST', { years: '1x' })).status, 400);
        tenant.expire_at = null;
        assert.equal((await request('/1/renew', 'SUPER_ADMIN', 'POST', { years: 1 })).status, 400);
        tenant.deleted_at = new Date();
        assert.equal((await request('/1/renew', 'SUPER_ADMIN', 'POST', { years: 1 })).status, 404);
        assert.equal((await request('/1/managers/10/password', 'SUPER_ADMIN', 'PATCH', { newPassword: 'newSecret2' })).status, 404);
        assert.match(calls.find(call => call.sql.includes('UPDATE users SET password = ?')).sql, /tenant_id = \? AND system_role = 'MANAGER' AND deleted_at IS NULL/);
        console.log('PASS: superadmin manager list, password reset, renewal, validation and permissions');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });