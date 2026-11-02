const assert = require('node:assert/strict');
const calls = [];
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant',
    masterPool: { async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 2 }]];
        if (sql.includes('FROM `test_tenant`.treatments t') && sql.includes('WHERE t.id = ?')) return [[{ id: 10, customer_id: 1 }]];
        if (sql.includes('parent_treatment_id IN')) return [[]];
        if (sql.includes('treatment_history th')) return [[]];
        return [[]];
    } }
} };
const { getTreatments, getTreatmentDetail } = require('../src/services/treatmentService');
(async () => {
    let page = await getTreatments(7, { executionStartDate: '2026-11-01', executionEndDate: '2026-11-30', page: 2, pageSize: 10 });
    assert.equal(page.total, 2); assert.equal(page.totalPages, 1);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.match(call.sql, /WITH RECURSIVE treatment_tree/);
        assert.match(call.sql, /SELECT root_t\.id AS root_id, root_t\.id/);
        assert.match(call.sql, /child_t\.parent_treatment_id = tree\.id/);
        assert.match(call.sql, /INNER JOIN treatment_tree tree ON tree\.id = th\.treatment_id/);
        assert.match(call.sql, /tree\.root_id = t\.id/);
        assert.match(call.sql, /th\.deleted_at IS NULL/);
        assert.match(call.sql, /th\.execution_date >= \?/);
        assert.match(call.sql, /th\.execution_date < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
    }
    assert.deepEqual(calls[0].params, ['2026-11-01', '2026-11-30']);
    assert.deepEqual(calls[1].params, ['2026-11-01', '2026-11-30', 10, 10]);
    calls.length = 0;
    await getTreatmentDetail(7, 10, { executionStartDate: '2026-11-01', executionEndDate: '2026-11-30' });
    const history = calls.find(call => call.sql.includes('FROM `test_tenant`.treatment_history th'));
    assert.ok(history); assert.match(history.sql, /th\.execution_date >= \?/); assert.match(history.sql, /th\.execution_date < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
    assert.deepEqual(history.params, [[10], '2026-11-01', '2026-11-30']);
    for (const filters of [{ executionStartDate: 'bad' }, { executionEndDate: '2026-02-30' }, { executionStartDate: '2026-12-01', executionEndDate: '2026-11-30' }]) await assert.rejects(getTreatments(7, filters), error => error.status === 400);
    console.log('PASS: execution-date treatment filtering uses descendant histories in shared count/page SQL and detail histories honor the range.');
})().catch(error => { console.error(error); process.exitCode = 1; });
