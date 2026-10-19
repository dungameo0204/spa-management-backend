const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-for-reset-route';

const controllerPath = require.resolve('../src/controllers/customerController');
const routePath = require.resolve('../src/routes/customerRoutes');
const calls = [];
require.cache[controllerPath] = {
    id: controllerPath,
    filename: controllerPath,
    loaded: true,
    exports: {
        resetPassword: (req, res) => { calls.push(req.user); res.status(200).json({ ok: true }); },
        create: (_req, res) => res.status(200).json({}), getList: (_req, res) => res.status(200).json({}),
        getOverview: (_req, res) => res.status(200).json({}), getDetail: (_req, res) => res.status(200).json({}),
        update: (_req, res) => res.status(200).json({}), remove: (_req, res) => res.status(200).json({}),
        restore: (_req, res) => res.status(200).json({})
    }
};
delete require.cache[routePath];

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/customers', require('../src/routes/customerRoutes'));

(async () => {
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/customers/reset-password`;
        const body = JSON.stringify({ tenantId: 999, phone_number: '0900000000', new_password: 'secret123' });
        const publicResponse = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        assert.equal(publicResponse.status, 401);

        const staffToken = jwt.sign({ tenant_id: 7, system_role: 'STAFF' }, process.env.JWT_SECRET);
        const staffResponse = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` }, body });
        assert.equal(staffResponse.status, 403);

        const managerToken = jwt.sign({ tenant_id: 7, system_role: 'MANAGER', username: 'manager' }, process.env.JWT_SECRET);
        const managerResponse = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` }, body });
        assert.equal(managerResponse.status, 200);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].tenant_id, 7);

        console.log('PASS: customer password reset rejects public/STAFF requests and uses authenticated MANAGER');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});