const assert = require('node:assert/strict');
const { PROFILE_FIELDS, PROFILE_TEXT_FIELDS, normalizeCustomerProfile } = require('../src/utils/customerProfile');
const calls = [];
let duplicate = false;
let race = false;
const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id') && sql.includes('profile_code = ?')) return [duplicate ? [{ id: 2 }] : []];
    if (sql.startsWith('SELECT id') && sql.includes('phone_number = ?')) return [[]];
    if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) {
        if (race) throw Object.assign(new Error('Duplicate entry for key uq_customer_profile_code'), { code: 'ER_DUP_ENTRY' });
        return [{ insertId: 9, affectedRows: 1 }];
    }
    if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
    if (sql.includes('FROM `test_tenant`.customers')) {
        if (sql.includes('DATE_FORMAT')) {
            for (const field of PROFILE_FIELDS) assert.ok(sql.includes(field), `Missing selected field ${field}`);
            assert.doesNotMatch(sql, /\bpassword\b/);
            return [[{ id: 9, profile_date: '2020-01-02', skin_types: ['DRY'], referral_sources: [] }]];
        }
        return [[{ id: 9 }]];
    }
    if (sql.includes('FROM `test_tenant`.invoices') || sql.includes('FROM `test_tenant`.treatments t')) return [[]];
    throw new Error(`Unexpected SQL: ${sql}`);
};
const db = require.resolve('../src/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: { getTenantDbName: async () => 'test_tenant', masterPool: { query } } };
const service = require('../src/services/customerService');
const controller = require('../src/controllers/customerController');

async function main() {
    assert.deepEqual(normalizeCustomerProfile({ wallet_balance: 100, unknown: 'ignored' }), {});
    assert.deepEqual(normalizeCustomerProfile({ profile_code: '  ROSA-01 ', skin_types: ['DRY', 'DRY'], referral_sources: [], gender: null }), {
        profile_code: 'ROSA-01', gender: null, skin_types: ['DRY'], referral_sources: []
    });
    for (const field of PROFILE_FIELDS) assert.deepEqual(normalizeCustomerProfile({ [field]: null }), { [field]: null });
    for (const field of ['profile_code', ...PROFILE_TEXT_FIELDS]) {
        assert.equal(normalizeCustomerProfile({ [field]: '  ' })[field], null);
        for (const value of [1, true, {}, []]) assert.throws(() => normalizeCustomerProfile({ [field]: value }), error => error.status === 400);
    }
    assert.throws(() => normalizeCustomerProfile({ profile_code: 'x'.repeat(51) }), /50/);
    assert.throws(() => normalizeCustomerProfile({ skin_assessment: 'đ'.repeat(32768) }), /65535/);
    for (const field of ['skin_types', 'referral_sources']) {
        for (const value of ['', '[]', {}, [null], [1], ['INVALID'], Array(20).fill('DRY')]) {
            assert.throws(() => normalizeCustomerProfile({ [field]: value }), error => error.status === 400);
        }
    }
    for (const value of ['', 'female', 1, []]) assert.throws(() => normalizeCustomerProfile({ gender: value }), /gender/);
    for (const value of ['2025-02-29', '9999-01-01', '2020-1-01', {}, '2020-01-01T00:00:00Z']) {
        assert.throws(() => normalizeCustomerProfile({ profile_date: value }), /profile_date/);
    }
    const profile = { profile_code: 'ROSA-01', profile_date: '2020-01-02', gender: 'FEMALE', skin_types: ['DRY'], referral_sources: ['FRIEND'] };
    for (const field of PROFILE_TEXT_FIELDS) profile[field] = `Nội dung ${field}`;
    assert.equal(await service.createCustomer(7, { fullname: 'Test', phone_number: '0900000000', ...profile, wallet_balance: 999 }, 'tester'), 9);
    const insert = calls.find(call => call.sql.startsWith('INSERT'));
    assert.equal(insert.params.length, 8 + PROFILE_FIELDS.length);
    assert.equal((insert.sql.match(/\?/g) || []).length, insert.params.length);
    assert.doesNotMatch(insert.sql, /wallet_balance/);
    assert.ok(insert.params.includes('["DRY"]'));
    assert.ok(insert.params.includes('["FRIEND"]'));
    await service.updateCustomer(7, 9, profile, 'tester');
    const update = calls.at(-1);
    for (const field of PROFILE_FIELDS) assert.ok(update.sql.includes(`${field} = ?`));
    assert.equal(update.params.length, PROFILE_FIELDS.length + 2);
    await service.updateCustomer(7, 9, { note: 'Keep profile' }, 'tester');
    assert.doesNotMatch(calls.at(-1).sql, /profile_code|skin_types/);
    await service.updateCustomer(7, 9, { skin_types: null, referral_sources: [] }, 'tester');
    assert.deepEqual(calls.at(-1).params, [null, '[]', 'tester', 9]);
    const detail = await service.getCustomerById(7, 9);
    assert.deepEqual(detail.skin_types, ['DRY']);
    await service.getCustomers(7, 'ROSA', {});
    const search = calls.find(call => call.sql.includes('profile_code LIKE'));
    assert.deepEqual(search.params.slice(0, 3), ['%ROSA%', '%ROSA%', '%ROSA%']);
    assert.equal((await service.getCustomerOverview(7, 9)).customer.profile_date, '2020-01-02');
    for (const operation of [() => service.createCustomer(7, { skin_types: 'DRY' }, 'tester'), () => service.updateCustomer(7, 9, { skin_types: 'DRY' }, 'tester')]) {
        const before = calls.length;
        await assert.rejects(operation(), /skin_types/);
        assert.equal(calls.length, before);
    }
    duplicate = true;
    await assert.rejects(service.createCustomer(7, { ...profile, phone_number: '1' }, 'tester'), /Mã hồ sơ/);
    await assert.rejects(service.updateCustomer(7, 9, { profile_code: 'ROSA-01' }, 'tester'), /Mã hồ sơ/);
    assert.ok(calls.at(-1).sql.includes('AND id != ?'));
    duplicate = false;
    race = true;
    await assert.rejects(service.createCustomer(7, { phone_number: '1' }, 'tester'), /Mã hồ sơ/);
    await assert.rejects(service.updateCustomer(7, 9, { profile_code: 'ROSA-01' }, 'tester'), /Mã hồ sơ/);
    race = false;
    for (const [handler, body] of [[controller.create, null], [controller.create, { fullname: [], phone_number: '1' }], [controller.update, { fullname: null }], [controller.update, { phone_number: 1 }], [controller.update, []]]) {
        const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
        await handler({ body, params: { id: 9 }, user: { tenant_id: 7 } }, res);
        assert.equal(res.code, 400);
    }
    console.log('PASS: Rosa profile validation, create/update/read/search, partial updates, duplicates/races and controller input types.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });