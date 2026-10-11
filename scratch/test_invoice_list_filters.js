const assert = require('node:assert/strict');
const dbPath = require.resolve('../src/config/database');
const paginationPath = require.resolve('../src/utils/pagination');
const calls = [];
const pool = {
    query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('page_count')) return [[{ total: 1 }]];
        if (sql.includes('LIMIT ? OFFSET ?')) return [[{ id: 8, invoice_date: '2026-10-10 10:00:00' }]];
        return [[{ id: 8, invoice_date: '2026-10-10 10:00:00' }]];
    }
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { masterPool: pool, getTenantDbName: async () => 'test_spa' } };
// Keep real pagination so the COUNT query and the data query both use the same filters.
const { paginateQuery } = require(paginationPath);
assert.equal(typeof paginateQuery, 'function');
const { getInvoices, getInvoiceDetail } = require('../src/services/invoiceService');

async function main() {
    const list = await getInvoices(1, { searchKeyword: 'dũng', startDate: '2026-10-10', endDate: '2026-10-10' }, 'MANAGER', 1);
    assert.equal(list.data[0].invoice_date.slice(0, 10), '2026-10-10');
    assert.equal(calls.length, 2);
    for (const { sql, params } of calls) {
        assert.match(sql, /DATE_FORMAT\(i\.invoice_date, '%Y-%m-%d %H:%i:%s'\)/);
        assert.doesNotMatch(sql, /SELECT\s+i\.\*/);
        assert.equal((sql.match(/AS invoice_date/g) || []).length, 1);
        assert.match(sql, /i\.created_at, i\.updated_at, i\.deleted_at, i\.created_by, i\.updated_by, i\.deleted_by/);
        assert.match(sql, /c\.fullname LIKE \? OR c\.phone_number LIKE \?/);
        assert.doesNotMatch(sql, /i\.note LIKE/);
        assert.match(sql, /DATE\(i\.invoice_date\) >= \?/);
        assert.match(sql, /DATE\(i\.invoice_date\) <= \?/);
        assert.deepEqual(params.slice(0, 4), ['%dũng%', '%dũng%', '2026-10-10', '2026-10-10']);
    }
    calls.length = 0;
    await getInvoiceDetail(1, 8, 'MANAGER', 1);
    assert.match(calls[0].sql, /DATE_FORMAT\(i\.invoice_date, '%Y-%m-%d %H:%i:%s'\)/);
    assert.doesNotMatch(calls[0].sql, /SELECT\s+i\.\*/);
    console.log('Invoice filters, count, display date and detail: OK');
}
main().catch(error => { console.error(error); process.exitCode = 1 });