const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');

const calls = [];
const users = [
    { id: 1, tenant_id: 7, username: 'manager', system_role: 'MANAGER', branch_id: null },
    { id: 2, tenant_id: 7, username: 'staff', system_role: 'STAFF', branch_id: 4 }
];
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant',
    masterPool: { query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT id, username, system_role, branch_id FROM users')) return [users.filter(u => u.id === Number(params[0]) && u.tenant_id === params[1])];
        if (sql.startsWith('SELECT id, branch_id, username, fullname, system_role, created_at, deleted_at FROM users WHERE id')) return [users.filter(u => u.id === Number(params[0]) && u.tenant_id === params[1]).map(u => ({ ...u }))];
        if (sql.startsWith('SELECT COUNT(*) AS total FROM (SELECT id, branch_id, username')) return [[{ total: users.filter(u => u.tenant_id === params[0]).length }]];
        if (sql.startsWith('SELECT id, branch_id, username, fullname, system_role, created_at, deleted_at FROM users WHERE tenant_id')) return [users.filter(u => u.tenant_id === params[0]).map(u => ({ ...u }))];
        if (sql.includes('`.branches WHERE deleted_at IS NULL')) return [[{ id: 4, name: 'CS2' }, { id: 5, name: 'CS3' }]];
        if (sql.includes('`.branches WHERE id = ?')) return [params[0] === 4 || params[0] === 5 ? [{ id: params[0] }] : []];
        if (sql.startsWith('SELECT id FROM users WHERE username')) return [[]];
        if (sql.startsWith('UPDATE users SET')) {
            const user = users.find(u => u.id === Number(params.at(-2)) && u.tenant_id === params.at(-1));
            if (!user) return [{ affectedRows: 0 }];
            for (const [index, field] of [...sql.matchAll(/(username|fullname|system_role|branch_id|password) = \?/g)].entries()) user[field[1]] = params[index];
            return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    } }
} };
const service = require('../src/services/userService');

(async () => {
    await service.updateUser(7, 1, { fullname: 'Tên mới' }, 'admin');
    assert.equal(users[0].branch_id, null);
    assert.equal(calls.some(c => c.sql.includes('`.branches WHERE id = ?')), false);
    await service.updateUser(7, 1, { newPassword: 'new-password', newRole: 'MANAGER', branchId: null }, 'admin');
    assert.ok(await bcrypt.compare('new-password', users[0].password));
    await service.updateUser(7, 2, { fullname: 'Staff mới' }, 'admin');
    assert.equal(users[1].branch_id, 4);
    await service.updateUser(7, 2, { newRole: 'MANAGER', branchId: 4 }, 'admin');
    assert.equal(users[1].branch_id, null);
    assert.equal((await service.getUserDetail(7, 2)).branch_id, null);
    assert.equal((await service.getUsersByTenant(7)).data.find(u => u.id === 2).branch_name, 'Tổng công ty');
    users[1].branch_id = 4; // Dữ liệu MANAGER cũ còn chi nhánh: PUT phải sửa lại thành NULL.
    await service.updateUser(7, 2, { fullname: 'Manager mới', branchId: 4 }, 'admin');
    assert.equal(users[1].branch_id, null);
    await assert.rejects(service.updateUser(7, 1, { newRole: 'STAFF' }, 'admin'), /branchId/);
    await service.updateUser(7, 1, { newRole: 'STAFF', branchId: 5 }, 'admin');
    assert.equal(users[0].branch_id, 5);
    await assert.rejects(service.updateUser(7, 1, { branchId: null }, 'admin'), /branchId/);
    await assert.rejects(service.updateUser(7, 1, { branchId: 999 }, 'admin'), /Chi nhánh/);
    await assert.rejects(service.updateUser(7, 1, { newRole: 'SUPER_ADMIN', branchId: 4 }, 'admin'), /Quyền hệ thống/);
    await assert.rejects(service.updateUser(8, 1, { fullname: 'Sai tenant' }, 'admin'), /Không tìm thấy/);
    assert.ok(calls.filter(c => c.sql.startsWith('UPDATE users SET')).every(c => c.sql.includes('WHERE id = ? AND tenant_id = ?')));

    process.env.JWT_SECRET = 'user-branch-test-secret';
    const app = express();
    app.use(express.json());
    app.use('/api/users', require('../src/routes/userRoutes'));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/users/2`;
        const request = (token, body) => fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const manager = jwt.sign({ id: 2, tenant_id: 7, system_role: 'MANAGER', username: 'admin' }, process.env.JWT_SECRET);
        users[1].branch_id = 4;
        assert.equal((await request(manager, { systemRole: 'MANAGER', branchId: 4, fullname: 'Tự sửa' })).status, 200);
        assert.equal((await (await fetch(url, { headers: { Authorization: `Bearer ${manager}` } })).json()).data.branch_id, null);
        const list = await (await fetch(`http://127.0.0.1:${server.address().port}/api/users`, { headers: { Authorization: `Bearer ${manager}` } })).json();
        assert.deepEqual([list.data.find(u => u.id === 2).branch_id, list.data.find(u => u.id === 2).branch_name], [null, 'Tổng công ty']);
        assert.equal((await request(manager, { systemRole: 'STAFF', branchId: 4 })).status, 400);
        const staff = jwt.sign({ id: 1, tenant_id: 7, system_role: 'STAFF' }, process.env.JWT_SECRET);
        assert.equal((await request(staff, { fullname: 'blocked' })).status, 403);
        assert.equal((await fetch(url, { method: 'PUT' })).status, 401);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
    console.log('PASS: manager null branch updates; staff branch rules, role transitions, tenant and HTTP permission');
})().catch(error => { console.error(error); process.exitCode = 1; });