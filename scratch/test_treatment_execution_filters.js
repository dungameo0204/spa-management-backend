const assert = require('node:assert/strict');
const calls = [];
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: {
    getTenantDbName: async () => 'test_tenant',
    masterPool: { async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 1 }]];
        if (sql.includes('FROM `test_tenant`.treatments t')) return [[{ id: 10, customer_id: 1 }]];
        if (sql.includes('FROM `test_tenant`.treatment_history th')) return [[{ id: 50, treatment_id: 10, execution_date: '2026-11-05' }]];
        if (sql.includes('FROM `test_tenant`.treatment_history_staffs')) return [[{ treatment_history_id: 50, staff_name: 'Lan' }]];
        return [[]];
    } }
} };
const { getTreatments } = require('../src/services/treatmentService');

(async () => {
    const page = await getTreatments(7, { executionStartDate: '2026-11-05', executionEndDate: '2026-11-05', page: 1, pageSize: 20 });
    assert.equal(page.total, 1);
    assert.equal(page.data[0].histories.length, 1);
    assert.equal(page.data[0].histories[0].staffs[0].staff_name, 'Lan');
    const treatmentQueries = calls.filter(call => call.sql.includes('FROM `test_tenant`.treatments t'));
    assert.equal(treatmentQueries.length, 2);
    for (const call of treatmentQueries) {
        assert.match(call.sql, /EXISTS \(\s*SELECT 1\s*FROM `test_tenant`\.treatment_history th/s);
        assert.match(call.sql, /th\.execution_date >= \?/);
        assert.match(call.sql, /th\.execution_date < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
    }
    assert.ok(calls.some(call => call.sql.includes('WHERE th.treatment_id IN (?)')));
    for (const filters of [{ executionStartDate: 'bad' }, { executionEndDate: '2026-02-30' }, { executionStartDate: '2026-11-06', executionEndDate: '2026-11-05' }]) {
        await assert.rejects(getTreatments(7, filters), error => error.status === 400);
    }
    console.log('PASS: execution-date treatment filtering returns matching histories with assigned staff.');
})().catch(error => { console.error(error); process.exitCode = 1; });