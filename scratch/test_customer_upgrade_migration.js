const assert = require('node:assert/strict');
const { parseArgs, expectedSchema, migrate } = require('../scripts/apply-customer-upgrade');
const column = (table, name, type, nullable = 'YES') => ({ TABLE_NAME: table, COLUMN_NAME: name, DATA_TYPE: type.split('(')[0], COLUMN_TYPE: type, IS_NULLABLE: nullable, COLUMN_DEFAULT: null, EXTRA: '' });
const fixture = ({ dob = false, sale = false, nullable = 'NO', missing = false, failBackfill = false } = {}) => {
    const state = { calls: [], prices: [null, 80, 100, 120, 0], safe: 1, released: false };
    state.columns = expectedSchema().filter((_, i) => !missing || i > 0).map(key => { const [table, name] = key.split('.'); return column(table, name, 'int'); });
    if (dob) state.columns.push(column('customers', 'date_of_birth', 'date'));
    if (sale) state.columns.push(column('products', 'sale_price', 'decimal(15,2)', nullable));
    const connection = { query: async (sql, params) => {
        state.calls.push({ sql, params });
        if (sql.includes('information_schema.SCHEMATA')) return [[{ SCHEMA_NAME: 'db_spa_test' }]];
        if (sql.includes('FROM db_system_master.tenants')) return [[{ id: 1 }]];
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (sql.includes('RELEASE_LOCK')) { state.released = true; return [[{}]]; }
        if (sql.includes('information_schema.COLUMNS')) return [state.columns];
        if (sql.includes('ADD COLUMN date_of_birth')) { state.columns.push(column('customers', 'date_of_birth', 'date')); return [{}]; }
        if (sql.includes('ADD COLUMN sale_price')) { state.columns.push(column('products', 'sale_price', 'decimal(15,2)')); state.prices = [null, null]; return [{}]; }
        if (sql.includes('@@SESSION.SQL_SAFE_UPDATES')) return [[{ safe_updates: state.safe }]];
        if (sql.startsWith('SET SESSION')) { state.safe = Number(sql.slice(-1)); return [{}]; }
        if (sql.startsWith('UPDATE')) { if (failBackfill) throw new Error('Injected failure'); state.prices = state.prices.map(price => price === null ? 100 : price); return [{}]; }
        if (sql.includes('MODIFY COLUMN')) { state.columns.find(c => c.COLUMN_NAME === 'sale_price').IS_NULLABLE = 'NO'; return [{}]; }
        if (sql.includes('COUNT(*)')) return [[{ total: sql.includes('WHERE sale_price IS NULL') ? state.prices.filter(p => p === null).length : state.prices.length, null_prices: state.prices.filter(p => p === null).length, legacy_pairs: state.prices.filter(p => p >= 100).length }]];
        throw new Error(`Unexpected SQL: ${sql}`);
    } };
    return { state, connection };
};
const run = (test, apply = true, db = 'db_spa_test') => migrate(test.connection, { db, apply, backupConfirmed: apply }, () => {});
(async () => {
    assert.deepEqual(parseArgs(['--db', 'db_spa_test']), { db: 'db_spa_test', apply: false, backupConfirmed: false });
    for (const args of [[], ['--db', 'db_system_master'], ['--db', 'db_spa_a;DROP'], ['--db', 'db_spa_test', '--apply'], ['--db', 'db_spa_test', '--unknown']]) assert.throws(() => parseArgs(args));
    const dry = fixture(); await run(dry, false);
    assert.ok(dry.state.calls.every(c => c.sql.startsWith('SELECT')));
    const fresh = fixture(); await run(fresh);
    assert.deepEqual(fresh.state.prices, [100, 100]);
    assert.equal(fresh.state.safe, 1); assert.equal(fresh.state.released, true);
    fresh.state.calls = []; await run(fresh);
    assert.equal(fresh.state.calls.filter(c => /^(ALTER|UPDATE|SET)/.test(c.sql)).length, 0);
    const partial = fixture({ sale: true, nullable: 'YES' }); await run(partial);
    assert.deepEqual(partial.state.prices, [100, 80, 100, 120, 0]);
    assert.equal(partial.state.calls.filter(c => c.sql.includes('ADD COLUMN sale_price')).length, 0);
    const template = fixture(); await run(template, true, 'db_spa_template');
    assert.equal(template.state.calls.filter(c => c.sql.includes('FROM db_system_master.tenants')).length, 0);
    const broken = fixture({ missing: true }); await assert.rejects(run(broken), /prerequisite/);
    assert.ok(broken.state.calls.every(c => !/^(ALTER|UPDATE|SET)/.test(c.sql)));
    assert.equal(broken.state.released, true);
    const incompatible = fixture({ dob: true }); incompatible.state.columns.find(c => c.COLUMN_NAME === 'date_of_birth').DATA_TYPE = 'datetime';
    await assert.rejects(run(incompatible), /Incompatible/);
    const failure = fixture({ sale: true, nullable: 'YES', failBackfill: true });
    await assert.rejects(run(failure), /Injected failure/);
    assert.equal(failure.state.safe, 1); assert.equal(failure.state.released, true);
    const unregistered = fixture(); const original = unregistered.connection.query;
    unregistered.connection.query = (sql, params) => sql.includes('FROM db_system_master.tenants') ? Promise.resolve([[]]) : original(sql, params);
    await assert.rejects(run(unregistered), /registered tenant/);
    console.log('PASS: migration dry run, fresh/partial/rerun/template, legacy price preservation, prerequisites, incompatible types, safe-updates restoration and target guards.');
})().catch(error => { console.error(error); process.exitCode = 1; });