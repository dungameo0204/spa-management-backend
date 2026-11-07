const assert = require('node:assert/strict');

const calls = [];
const configPath = require.resolve('../src/config/database');
require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: {
        getTenantDbName: async () => 'test_tenant',
        masterPool: {
            async query(sql, params) {
                calls.push({ sql, params });
                return sql.startsWith('SELECT COUNT(*)') ? [[{ total: 3 }]] : [[]];
            }
        }
    }
};
const { getCustomerBookings, getCustomerBookingDetail } = require('../src/services/customerBookingService');

(async () => {
    for (const [filter, clause, timeParams] of [
        [{ startTime: '07:00', endTime: '08:00' }, 'cb.arrival_time >= ? AND cb.arrival_time <= ?', ['07:00:00', '08:00:00']],
        [{ startTime: '07:00' }, 'cb.arrival_time >= ?', ['07:00:00']],
        [{ endTime: '08:00' }, 'cb.arrival_time <= ?', ['08:00:00']]
    ]) {
        calls.length = 0;
        const result = await getCustomerBookings(7, {
            branchId: 2, startDate: '2026-11-01', endDate: '2026-11-02',
            ...filter, page: 2, pageSize: 2
        }, 'MANAGER');
        assert.equal(result.total, 3);
        assert.equal(result.totalPages, 2);
        assert.equal(calls.length, 2);
        for (const call of calls) {
            assert.ok(call.sql.includes(`AND (cb.arrival_time IS NULL OR (${clause}))`));
            assert.match(call.sql, /WHERE cb.deleted_at IS NULL/);
            assert.match(call.sql, /AND cb.branch_id = \?/);
            assert.match(call.sql, /AND cb.arrival_date >= \?/);
            assert.match(call.sql, /AND cb.arrival_date <= \?/);
        }
        const params = [2, '2026-11-01', '2026-11-02', ...timeParams];
        assert.deepEqual(calls[0].params, params);
        assert.deepEqual(calls[1].params, [...params, 2, 2]);
        assert.ok(calls[1].sql.includes('ORDER BY (cb.arrival_time IS NULL) ASC, cb.arrival_date ASC, cb.arrival_time ASC, cb.created_at ASC, cb.id ASC LIMIT ? OFFSET ?'));
    }
    calls.length = 0;
    await getCustomerBookings(7, {}, 'STAFF', 2);
    assert.doesNotMatch(calls[1].sql, /cb.arrival_time IS NULL/);
    assert.match(calls[1].sql, /ORDER BY cb.arrival_date ASC, cb.arrival_time ASC/);
    // Capture detail SQL as well (the SQL double intentionally returns no detail rows).
    await assert.rejects(getCustomerBookingDetail(7, 1, 'MANAGER'));
    for (const call of calls) {
        assert.ok(call.sql.includes('ai.created_at >= cb.arrival_date AND ai.created_at <= NOW()'));
        assert.ok(call.sql.includes('atc.created_at >= cb.arrival_date AND atc.created_at <= NOW()'));
        assert.doesNotMatch(call.sql, /DATE\(cb\.created_at\)/);
    }
    for (const filters of [{ startTime: '' }, { startTime: '24:00' }, { endTime: 'bad' }, { startTime: '08:00', endTime: '07:00' }]) {
        await assert.rejects(getCustomerBookings(7, filters, 'MANAGER'), error => error.status === 400);
    }
    console.log('PASS: booking time filters include unknown times, nulls last before pagination, shared count filters and validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });