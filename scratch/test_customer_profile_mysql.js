// Explicit opt-in; every service write stays on one transaction and is rolled back.
const assert = require('node:assert/strict');
async function main() {
    if (process.env.DB_PORT !== '3308' || process.env.DB_HOST !== '127.0.0.1' || !process.env.DOTENV_CONFIG_PATH) {
        throw new Error('Explicit local Rosa 3308 environment required.');
    }
    const { masterPool, getTenantDbName } = require('../src/config/database');
    let connection;
    const originalQuery = masterPool.query;
    const db = 'db_spa_1791039769068_e185';
    try {
        assert.equal(await getTenantDbName(7), db);
        connection = await masterPool.getConnection();
        const [[server]] = await connection.query('SELECT @@port AS port');
        assert.equal(server.port, 3308);
        await connection.beginTransaction();
        masterPool.query = connection.query.bind(connection);
        const service = require('../src/services/customerService');
        const { PROFILE_TEXT_FIELDS } = require('../src/utils/customerProfile');
        const suffix = `${Date.now()}-${process.pid}`;
        const profile = {
            fullname: 'Rosa profile rollback test', phone_number: `T${Date.now()}`,
            profile_code: `TEST-${suffix}`, profile_date: '2020-02-29', gender: 'FEMALE',
            skin_types: ['DRY', 'SENSITIVE_DAMAGED'], referral_sources: ['FRIEND'], date_of_birth: '1995-08-21'
        };
        for (const field of PROFILE_TEXT_FIELDS) profile[field] = `Kiểm thử ${field}`;
        const id = await service.createCustomer(7, profile, 'profile-test');
        const detail = await service.getCustomerById(7, id);
        for (const [field, value] of Object.entries(profile)) assert.deepEqual(detail[field], value, field);
        assert.equal(detail.password, undefined);
        assert.equal((await service.getCustomers(7, profile.profile_code, { page: '1', pageSize: '10' })).data[0].id, id);
        assert.deepEqual((await service.getCustomerOverview(7, id)).customer.skin_types, profile.skin_types);
        await service.updateCustomer(7, id, { note: 'Only note' }, 'profile-test');
        assert.deepEqual((await service.getCustomerById(7, id)).skin_types, profile.skin_types);
        await service.updateCustomer(7, id, { skin_types: [], referral_sources: null, profile_date: null, gender: null, consultation_note: '' }, 'profile-test');
        const cleared = await service.getCustomerById(7, id);
        assert.deepEqual(cleared.skin_types, []);
        for (const field of ['referral_sources', 'profile_date', 'gender', 'consultation_note']) assert.equal(cleared[field], null);
        await service.updateCustomer(7, id, { profile_code: profile.profile_code }, 'profile-test');
        await assert.rejects(service.createCustomer(7, { ...profile, phone_number: `U${profile.phone_number.slice(1)}` }, 'profile-test'), /Mã hồ sơ/);
        await service.deleteCustomer(7, id, 'profile-test');
        await assert.rejects(service.createCustomer(7, { ...profile, phone_number: `U${profile.phone_number.slice(1)}` }, 'profile-test'), /Mã hồ sơ/);
        await service.restoreCustomer(7, id, 'profile-test');
        await connection.rollback();
        const [[count]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.customers WHERE id=?`, [id]);
        assert.equal(count.total, 0);
        console.log('PASS: Rosa 3308 actual customer service roundtrip, JSON arrays, date formatting, unique code, soft-delete/restore; rollback verified.');
    } finally {
        masterPool.query = originalQuery;
        if (connection) { await connection.rollback(); connection.release(); }
        await masterPool.end();
    }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });