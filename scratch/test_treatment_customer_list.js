const assert = require('node:assert/strict');

const calls = [];
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {
        getTenantDbName: async () => 'test_tenant',
        masterPool: {
            async query(sql, params = []) {
                calls.push({ sql, params });
                if (sql.includes('AS customer_count')) return [[{ total: 2 }]];
                if (sql.includes('ORDER BY EXISTS') && sql.includes('LIMIT ? OFFSET ?')) return [[
                    { id: 9, customer_name: 'Lan', phone_number: '0909', total_debt: '1500000.00' },
                    { id: 8, customer_name: 'Minh', phone_number: '0808', total_debt: '0.00' }
                ]];
                if (sql.includes('COUNT(th.id) AS today_execution_count')) return [[
                    { id: 101, customer_id: 9, product_id: 1, product_name: 'PRP', total_sessions: 20, remaining_sessions: 7, created_at: '2026-11-01', today_execution_count: '2' },
                    { id: 102, customer_id: 9, product_id: 2, product_name: 'Laser', total_sessions: 10, remaining_sessions: 0, created_at: '2026-10-01', today_execution_count: '1' },
                    { id: 103, customer_id: 8, product_id: 3, product_name: 'Unlimited', total_sessions: null, remaining_sessions: null, created_at: '2026-09-01', today_execution_count: '0' },
                    { id: 104, customer_id: 8, product_id: 4, product_name: 'Done', total_sessions: 5, remaining_sessions: 0, created_at: '2026-08-01', today_execution_count: '0' }
                ]];
                throw new Error(`Unexpected SQL: ${sql}`);
            }
        }
    }
};

const { getTreatmentsByCustomer } = require('../src/services/treatmentService');

(async () => {
    const result = await getTreatmentsByCustomer(1, { page: '2', pageSize: '2', customerSearch: 'Lan', executionStartDate: '2026-11-01', executionEndDate: '2026-11-03' });
    assert.deepEqual({ total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages }, { total: 2, page: 2, pageSize: 2, totalPages: 1 });
    assert.equal(result.data[0].total_debt, 1500000);
    assert.deepEqual(result.data[0].active_treatments.map(card => card.id), [101, 102]);
    assert.deepEqual(result.data[0].completed_treatments.map(card => card.id), [102]);
    assert.deepEqual(result.data[1].active_treatments.map(card => card.id), [103]);
    assert.deepEqual(result.data[1].completed_treatments.map(card => card.id), [104]);
    const cardQuery = calls.find(call => call.sql.includes('COUNT(th.id) AS today_execution_count'));
    assert.match(cardQuery.sql, /th\.execution_date >= CURDATE\(\) AND th\.execution_date < CURDATE\(\) \+ INTERVAL 1 DAY/);
    assert.match(cardQuery.sql, /t\.customer_id IN \(\?\)/);
    assert.deepEqual(cardQuery.params.slice(0, 4), ['%Lan%', '%Lan%', '2026-11-01', '2026-11-03']);
    await assert.rejects(() => getTreatmentsByCustomer(1, { page: '0' }), { status: 400 });
    console.log('Treatment customer list: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });