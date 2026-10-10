const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const tenants = [
    { id: 1, spa_name: 'Spa Active', database_name: 'db_spa_active', expire_at: null, deleted_at: null },
    { id: 2, spa_name: 'Spa Expired', database_name: 'db_spa_expired', expire_at: '2020-01-01T00:00:00.000Z', deleted_at: null },
    { id: 3, spa_name: 'Spa Disabled', database_name: 'db_spa_disabled', expire_at: null, deleted_at: new Date() }
];
const users = [
    { id: 10, tenant_id: 1, username: 'active.manager', fullname: 'Active Manager', password: '$2b$10$57zVRsNzNwxBiobm9/Eo0eMr4b0HfCctCH1pPCczF0zlK6qnZMupC', system_role: 'MANAGER', deleted_at: null },
    { id: 11, tenant_id: 2, username: 'expired.manager', fullname: 'Expired Manager', password: '$2b$10$57zVRsNzNwxBiobm9/Eo0eMr4b0HfCctCH1pPCczF0zlK6qnZMupC', system_role: 'MANAGER', deleted_at: null },
    { id: 12, tenant_id: 3, username: 'disabled.manager', fullname: 'Disabled Manager', password: '$2b$10$57zVRsNzNwxBiobm9/Eo0eMr4b0HfCctCH1pPCczF0zlK6qnZMupC', system_role: 'MANAGER', deleted_at: null }
];
const configPath = require.resolve('../src/config/database');
const calls = [];
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: {
    masterPool: {
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            if (sql.includes('SELECT * FROM users WHERE username = ?')) return [users.filter(user => user.username === params[0])];
            if (sql.includes('SELECT deleted_at, expire_at FROM tenants WHERE id = ?')) return [tenants.filter(tenant => tenant.id === params[0])];
            if (sql.includes('WHERE t.id = ?')) return [[{ tenant_id: 3, spa_name: 'Spa Disabled', status: 'DISABLED', manager_username: null }]];
            if (sql.includes('UPDATE tenants SET spa_name')) return [{ affectedRows: 1 }];
            if (sql.includes('SELECT spa_name, expire_at FROM tenants WHERE id = ?')) return [[tenants.find(tenant => tenant.id === params[0])].filter(Boolean)];
            if (sql.includes('SELECT COUNT(*) AS total FROM')) return [[{ total: 1 }]];
            if (sql.includes('ORDER BY t.created_at DESC')) return [[{ tenant_id: 3, spa_name: 'Spa Disabled', status: 'DISABLED' }]];
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    }
} };
const tenantService = require('../src/services/tenantService');
const authService = require('../src/services/authService');

(async () => {
    const disabled = await tenantService.getAllTenants('', { status: 'disabled', page: 1, pageSize: 20 });
    assert.equal(disabled.total, 1);
    assert.equal(disabled.data[0].status, 'DISABLED');
    assert.match(calls.at(-1).sql, /t\.deleted_at IS NOT NULL/);
    const detail = await tenantService.getTenantDetail(3);
    assert.equal(detail.status, 'DISABLED');
    await assert.rejects(tenantService.getAllTenants('', { status: 'wrong' }), /status/);
    await assert.rejects(tenantService.getTenantDetail('0'), /tenantId/);
    await assert.rejects(tenantService.updateTenant(1), /ít nhất spaName hoặc expireAt/);
    await assert.rejects(tenantService.updateTenant(1, '   '), /spaName/);
    await assert.rejects(tenantService.updateTenant(1, undefined, 'not-a-date'), /expireAt/);
    await assert.rejects(authService.login('expired.manager', 'secret'), /hết hạn/);
    await assert.rejects(authService.login('disabled.manager', 'secret'), /vô hiệu hóa/);
    process.env.JWT_SECRET = 'tenant-test-secret';
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/tenants', require('../src/routes/tenantRoutes'));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    try {
        const token = jwt.sign({ system_role: 'SUPER_ADMIN', username: 'root' }, process.env.JWT_SECRET);
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tenants?status=disabled&page=1&pageSize=20`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data[0].status, 'DISABLED');
        const forbidden = await fetch(`http://127.0.0.1:${server.address().port}/api/tenants`, { headers: { Authorization: `Bearer ${jwt.sign({ system_role: 'MANAGER' }, process.env.JWT_SECRET)}` } });
        assert.equal(forbidden.status, 403);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
    console.log('PASS: tenant admin filters, detail, validation, login blocking and route auth');
})().catch(error => { console.error(error); process.exitCode = 1; });