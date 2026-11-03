const assert = require('node:assert/strict');

const database = require('../src/config/database');
const originalGetTenantDbName = database.getTenantDbName;
const originalQuery = database.masterPool.query;
const originalEnvironment = Object.fromEntries([
    'DB_HOST', 'DB_PORT', 'SKIN_IMAGES_ENABLED'
].map(key => [key, process.env[key]]));

const restoreEnvironment = () => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
};

async function main() {
    database.getTenantDbName = async tenantId => ({
        7: 'db_spa_1791039769068_e185',
        8: 'db_spa_1799999999999_abcd',
        9: 'not-a-tenant-database'
    })[tenantId];
    database.masterPool.query = async sql => sql.includes('customer_skin_images')
        ? [[{ file_path: 'tenants/7/customers/1/1/cross-tenant.png', mime_type: 'image/png' }]]
        : [[{ id: 1 }]];
    const service = require('../src/services/skinImageService');
    try {
        process.env.DB_HOST = '127.0.0.1';
        process.env.DB_PORT = '3306';
        process.env.SKIN_IMAGES_ENABLED = 'true';
        assert.deepEqual(await service.preflight(7, 1), {
            db: 'db_spa_1791039769068_e185', tenantId: 7, customerId: 1, sessionId: undefined
        });
        assert.deepEqual(await service.preflight(8, 1), {
            db: 'db_spa_1799999999999_abcd', tenantId: 8, customerId: 1, sessionId: undefined
        });
        await assert.rejects(service.file(8, 1, 1, 1), error => error.status === 404);

        delete process.env.SKIN_IMAGES_ENABLED;
        await assert.rejects(service.preflight(7, 1), error => error.status === 503);

        process.env.SKIN_IMAGES_ENABLED = 'true';
        await assert.rejects(service.preflight(9, 1), error => error.status === 403);

        process.env.DB_HOST = 'mysql.example.test';
        await assert.rejects(service.preflight(7, 1), error => error.status === 503);
        console.log('PASS: skin-image feature flag, all registered db_spa_* tenants, malformed tenant DB rejection, loopback guard and DB_PORT=3306 runtime configuration.');
    } finally {
        database.getTenantDbName = originalGetTenantDbName;
        database.masterPool.query = originalQuery;
        restoreEnvironment();
        await database.masterPool.end();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });