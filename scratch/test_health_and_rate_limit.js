const assert = require('node:assert/strict');
const { createHealthHandler } = require('../src/controllers/healthController');
const { createRateLimiter } = require('../src/middlewares/rateLimit');

const response = () => ({
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; }
});

(async () => {
    const healthy = response();
    await createHealthHandler({ query: async () => [[{ ok: 1 }]] })({}, healthy);
    assert.equal(healthy.statusCode, 200);
    assert.deepEqual(healthy.body, { status: 'ok' });

    const unavailable = response();
    await createHealthHandler({ query: async () => { throw new Error('db down'); } })({}, unavailable);
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.body, { status: 'unavailable' });

    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, message: 'limited' });
    const req = { get: () => '203.0.113.10', ip: '127.0.0.1', socket: {} };
    let passed = 0;
    limiter(req, response(), () => { passed += 1; });
    limiter(req, response(), () => { passed += 1; });
    const limited = response();
    limiter(req, limited, () => { passed += 1; });
    assert.equal(passed, 2);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.body.message, 'limited');
    assert.ok(Number(limited.headers['Retry-After']) > 0);

    console.log('PASS: health check verifies MySQL and rate limiter blocks excessive requests');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});