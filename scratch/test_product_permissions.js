const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const calls = [];
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant', masterPool: {
        getConnection: async () => ({
            beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
            query: async (sql, params) => {
                calls.push({ sql, params });
                if (sql.includes('SELECT id FROM `test_tenant`.products WHERE id = ?')) return [[{ id: 10 }]];
                if (sql.includes('SELECT id FROM `test_tenant`.products')) return [[]];
                return [{ insertId: 10, affectedRows: 1 }];
            }
        }),
        query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 1 }]; }
    }
} };
process.env.JWT_SECRET = 'product-permission-test';
const app = express(); app.use(express.json()); app.use('/api/products', require('../src/routes/productRoutes'));
(async () => {
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/products`;
        const token = role => ({ Authorization: `Bearer ${jwt.sign({ tenant_id: 1, system_role: role, fullname: 'A' }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' });
        const request = (method, url, body, role = 'STAFF') => fetch(`${base}${url}`, { method, headers: token(role), ...(body ? { body: JSON.stringify(body) } : {}) });
        assert.equal((await request('POST', '/', { name: 'A', price: 20, is_product: 1 })).status, 201);
        for (const field of [[], null, [{ role_id: 1 }]]) {
            const before = calls.length;
            assert.equal((await request('POST', '/', { name: 'B', price: 20, is_product: 1, commissions: field })).status, 403);
            assert.equal((await request('PUT', '/10', { name: 'B', commissions: field })).status, 403);
            assert.equal(calls.length, before);
        }
        assert.equal((await request('PUT', '/10', { name: 'B' })).status, 200);
        assert.equal((await request('DELETE', '/10')).status, 200);
        assert.equal((await request('PATCH', '/10/restore')).status, 200);
        console.log('PASS: STAFF product CRUD, reject commission writes before DB');
    } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });