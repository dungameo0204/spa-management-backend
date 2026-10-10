const assert = require('node:assert/strict');
const { parsePagination, paginateQuery } = require('../src/utils/pagination');

(async () => {
    assert.deepEqual(parsePagination(), { page: 1, pageSize: 20, offset: 0 });
    for (const input of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'abc' }, { page: ['1'] }, { pageSize: '0' }, { pageSize: '101' }, { pageSize: '1e2' }, { page: '9007199254740992' }]) {
        assert.throws(() => parsePagination(input), error => error.status === 400);
    }
    const calls = [];
    const pool = { query: async (sql, params) => {
        calls.push({ sql, params });
        return [sql.includes('COUNT(*)') ? [{ total: 23 }] : [{ id: 11 }, { id: 12 }]];
    } };
    const query = 'SELECT a.id FROM `tenant`.appointments a WHERE a.deleted_at IS NULL AND a.branch_id = ?';
    const result = await paginateQuery(pool, query, [3], 'a.created_at DESC, a.id DESC', { page: '2', pageSize: '10' });
    assert.deepEqual(result, { total: 23, page: 2, pageSize: 10, totalPages: 3, data: [{ id: 11 }, { id: 12 }] });
    assert.deepEqual(calls[0].params, [3]);
    assert.deepEqual(calls[1].params, [3, 10, 10]);
    assert.match(calls[0].sql, /FROM \(SELECT a.id FROM `tenant`.appointments a WHERE a.deleted_at IS NULL AND a.branch_id = \?\) AS page_count/);
    assert.match(calls[1].sql, /ORDER BY a.created_at DESC, a.id DESC LIMIT \? OFFSET \?$/);
    console.log('PASS: pagination parsing, filters, count, SQL page bounds');
})().catch(error => { console.error(error); process.exitCode = 1; });