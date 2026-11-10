const assert = require('node:assert/strict');
const migration = require('../scripts/migrations/2026-11-06-xuly-customer-bookings');

const legacyColumns = new Set(['id', 'branch_id', 'customer_id', 'customer_name', 'customer_phone', 'booking_time', 'updated_at']);
const run = async columns => {
    const calls = [];
    const connection = { query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (sql.includes('information_schema.tables')) return [[{ present: 1 }]];
        if (sql.includes('information_schema.columns')) {
            const column = params[2];
            return [[{ present: columns.has(column) ? 1 : 0 }]];
        }
        if (sql.includes('information_schema.statistics') || sql.includes('information_schema.table_constraints')) return [[{ present: 0 }]];
        if (sql.includes('invalid_rows')) return [[{ invalid_rows: 0 }]];
        if (sql.includes('@@SESSION.SQL_SAFE_UPDATES')) return [[{ safe_updates: 1 }]];
        return [{}];
    } };
    await migration.up(connection, { database: 'test_tenant' });
    return calls;
};

(async () => {
    const calls = await run(legacyColumns);
    assert.ok(calls.some(call => call.sql.includes('MODIFY COLUMN customer_phone')));
    assert.ok(calls.some(call => call.sql.includes('ADD COLUMN customer_type')));
    assert.ok(calls.some(call => call.sql.includes('SET SESSION SQL_SAFE_UPDATES=0')));
    assert.ok(calls.some(call => call.sql.includes("customer_type=CASE WHEN customer_id IS NULL THEN 'NEW' ELSE 'EXISTING' END")));
    assert.ok(calls.some(call => call.sql.includes('ADD CONSTRAINT chk_booking_customer')));

    const partialCalls = [];
    const partial = { query: async (sql, params = []) => {
        partialCalls.push({ sql, params });
        if (sql.includes('information_schema.tables')) return [[{ present: 1 }]];
        if (sql.includes('information_schema.columns')) return [[{ present: params[2] === 'customer_type' ? 1 : 0 }]];
        throw new Error(`Unexpected query after partial-schema guard: ${sql}`);
    } };
    await assert.rejects(migration.up(partial, { database: 'test_tenant' }), /partially upgraded/);
    assert.equal(partialCalls.some(call => call.sql.startsWith('ALTER TABLE')), false);
    console.log('PASS: release bookings migration upgrades legacy schema and rejects partial schema before DDL.');
})().catch(error => { console.error(error); process.exitCode = 1; });