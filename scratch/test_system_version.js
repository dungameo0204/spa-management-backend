const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'system-version-test-secret';
process.env.DEPLOY_VERSION = 'backend-spaxuly-v1.0.0-test';
process.env.DEPLOY_COMMIT = '0123456789abcdef';
const routePath = require.resolve('../src/routes/systemRoutes');
delete require.cache[routePath];
const app = express();
app.use('/api/system', require('../src/routes/systemRoutes'));

(async () => {
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const request = async authorization => {
            const response = await fetch(`${base}/api/system/version`, { headers: authorization ? { Authorization: authorization } : {} });
            return { status: response.status, body: await response.json() };
        };
        const denied = await request();
        assert.equal(denied.status, 401);
        assert.equal(denied.body.code, 'AUTH_TOKEN_MISSING');
        const token = jwt.sign({ tenant_id: 7, system_role: 'MANAGER', username: 'version-test' }, process.env.JWT_SECRET, { expiresIn: '5m' });
        const allowed = await request(`Bearer ${token}`);
        assert.equal(allowed.status, 200);
        assert.equal(allowed.body.message, 'Lấy phiên bản máy chủ thành công');
        assert.equal(allowed.body.data.version, 'backend-spaxuly-v1.0.0-test');
        assert.equal(allowed.body.data.commit, '0123456789abcdef');
        assert.match(allowed.body.data.startedAt, /^\d{4}-\d{2}-\d{2}T/);
        console.log('PASS: authenticated system version endpoint exposes deployed release metadata only');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });