const assert = require('node:assert/strict');
const { getServerConfig } = require('../src/config/server');

const production = {
    NODE_ENV: 'production', DB_HOST: '127.0.0.1', DB_USER: 'spa_backend', DB_PASSWORD: 'secret',
    DB_SYSTEM_NAME: 'db_system_master', JWT_SECRET: 'a-secret', CORS_ORIGINS: 'https://app.example.com, https://admin.example.com'
};
assert.deepEqual(getServerConfig(production), {
    port: 5000, host: '127.0.0.1', allowedOrigins: ['https://app.example.com', 'https://admin.example.com']
});
assert.equal(getServerConfig({}).host, '0.0.0.0');
for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_SYSTEM_NAME', 'JWT_SECRET', 'CORS_ORIGINS']) {
    const env = { ...production };
    delete env[key];
    assert.throws(() => getServerConfig(env), /Thiếu|CORS_ORIGINS/);
}
assert.throws(() => getServerConfig({ ...production, CORS_ORIGINS: 'http://app.example.com' }), /CORS_ORIGINS/);
assert.throws(() => getServerConfig({ ...production, PORT: '0' }), /PORT/);
assert.equal(getServerConfig({ ...production, HOST: '0.0.0.0' }).host, '127.0.0.1');
console.log('PASS: production backend binds only loopback and validates configuration');