const assert = require('node:assert/strict');

const calls = [];
let includeTreatment = false;
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
                if (sql.includes('page_count')) return [[{ total: 1 }]];
                if (sql.includes('ORDER BY t.created_at DESC, t.id DESC LIMIT')) {
                    return [includeTreatment ? [{ id: 1, customer_id: 10 }] : []];
                }
                if (sql.includes('t.parent_treatment_id IN')) {
                    return [includeTreatment && params[0].includes(1) && !params[0].includes(2)
                        ? [{ id: 2, parent_treatment_id: 1, customer_id: 10, product_name: 'Dịch vụ con' }]
                        : []];
                }
                if (sql.includes('FROM `test_tenant`.treatment_history th')) {
                    return [[
                        { id: 101, treatment_id: 1, execution_date: '2026-11-02', branch_name: 'Cơ sở 1' },
                        { id: 102, treatment_id: 2, execution_date: '2026-11-03', branch_name: 'Cơ sở 1' }
                    ]];
                }
                if (sql.includes('FROM `test_tenant`.treatment_history_staffs ths')) return [[]];
                return [[]];
            }
        }
    }
};

const { getTreatments } = require('../src/services/treatmentService');

const matchingCalls = () => calls.filter(({ sql }) => sql.includes('FROM `test_tenant`.treatments t'));

async function main() {
    await getTreatments(1, { executionStartDate: '2026-11-01', executionEndDate: '2026-11-03' });
    assert.equal(calls.length, 2);
    for (const { sql, params } of calls) {
        assert.match(sql, /EXISTS \(\s*SELECT 1\s*FROM `test_tenant`\.treatment_history th/s);
        assert.match(sql, /WITH RECURSIVE treatment_tree AS/);
        assert.match(sql, /INNER JOIN treatment_tree tree ON tree\.id = th\.treatment_id/);
        assert.match(sql, /tree\.root_id = t\.id AND th\.deleted_at IS NULL/);
        assert.match(sql, /th\.execution_date >= \?/);
        assert.match(sql, /th\.execution_date < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
        assert.deepEqual(params.slice(0, 2), ['2026-11-01', '2026-11-03']);
    }

    calls.length = 0;
    await getTreatments(1, { executionStartDate: '2026-11-01', page: '2', pageSize: '5' });
    assert.equal(matchingCalls().length, 2);
    for (const { sql, params } of calls) {
        assert.match(sql, /th\.execution_date >= \?/);
        assert.doesNotMatch(sql, /th\.execution_date < DATE_ADD/);
        assert.equal(params[0], '2026-11-01');
    }

    calls.length = 0;
    includeTreatment = true;
    const page = await getTreatments(1, { executionStartDate: '2026-11-01', executionEndDate: '2026-11-03' });
    assert.equal(page.data.length, 1);
    assert.deepEqual(page.data[0].histories, [{
        id: 101,
        treatment_id: 1,
        execution_date: '2026-11-02',
        branch_name: 'Cơ sở 1',
        staffs: [], children: []
    }]);
    assert.deepEqual(page.data[0].children[0].histories, [{
        id: 102,
        treatment_id: 2,
        execution_date: '2026-11-03',
        branch_name: 'Cơ sở 1',
        staffs: [], children: []
    }]);
    const historyCall = calls.find(({ sql }) => sql.includes('FROM `test_tenant`.treatment_history th') && !sql.includes('WITH RECURSIVE'));
    assert.ok(historyCall, 'Execution-date lists must attach matching histories.');
    assert.match(historyCall.sql, /th\.execution_date >= \?/);
    assert.match(historyCall.sql, /th\.execution_date < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
    assert.deepEqual(historyCall.params, [[1, 2], '2026-11-01', '2026-11-03']);

    await assert.rejects(() => getTreatments(1, { executionStartDate: '2026-02-30' }), {
        message: 'executionStartDate phải là ngày YYYY-MM-DD hợp lệ.', status: 400
    });
    await assert.rejects(() => getTreatments(1, { executionStartDate: '2026-11-04', executionEndDate: '2026-11-03' }), {
        message: 'executionStartDate không được sau executionEndDate.', status: 400
    });

    console.log('Treatment execution-date filters: OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });