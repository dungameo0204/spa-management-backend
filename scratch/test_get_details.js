const assert = require('node:assert/strict');

const calls = [];
let rows = [];
const pool = {
    query: async (sql, params) => {
        calls.push({ sql, params });
        return [rows.shift() || []];
    }
};
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
    id: databasePath, filename: databasePath, loaded: true,
    exports: { masterPool: pool, getTenantDbName: async () => 'test_tenant' }
};

const inventory = require('../src/services/inventoryImportService');
const booking = require('../src/services/customerBookingService');
const staff = require('../src/services/staffService');
const user = require('../src/services/userService');
const tenant = require('../src/services/tenantService');
const role = require('../src/services/roleService');
const branch = require('../src/services/branchService');

(async () => {
    rows = [[{ id: 9, branch_id: 2, branch_name: 'B' }], [{ id: 3, inventory_import_id: 9 }]];
    assert.deepEqual((await inventory.getInventoryImportDetail(1, '9', 'STAFF', 2)).items, [{ id: 3, inventory_import_id: 9 }]);
    assert.deepEqual(calls.at(-2).params, [9, 2]);
    assert.match(calls.at(-2).sql, /ii.deleted_at IS NULL.*ii.branch_id = \?/s);
    assert.match(calls.at(-1).sql, /deleted_at IS NULL ORDER BY id ASC/);
    rows = [[]];
    await assert.rejects(inventory.getInventoryImportDetail(1, 9, 'STAFF', 2), /không tồn tại/);
    await assert.rejects(inventory.getInventoryImportDetail(1, 'oops', 'MANAGER'), /không hợp lệ/);
    rows = [[{ id: 7, branch_name: 'B' }]];
    assert.equal((await booking.getCustomerBookingDetail(1, 7, 'STAFF', 2)).id, 7);
    assert.deepEqual(calls.at(-1).params, [7, 2]);
    rows = [[]];
    await assert.rejects(booking.getCustomerBookingDetail(1, 7, 'STAFF', 2), /không tồn tại/);
    rows = [[{ id: 4, role_name: 'A' }]];
    assert.equal((await staff.getStaffDetail(1, 4, 'STAFF', 2)).id, 4);
    assert.deepEqual(calls.at(-1).params, [4, 2]);
    rows = [[{ id: 3, branch_id: null, deleted_at: '2026-01-01' }]];
    assert.equal((await user.getUserDetail(1, 3)).branch_name, 'Tổng công ty');
    assert.match(calls.at(-1).sql, /tenant_id = \?/);
    assert.doesNotMatch(calls.at(-1).sql, /password/i);
    rows = [[{ id: 3, branch_id: 2 }], [{ name: 'B' }]];
    assert.equal((await user.getUserDetail(1, 3)).branch_name, 'B');
    rows = [[{ tenant_id: 1 }]];
    assert.equal((await tenant.getTenantDetail(1)).tenant_id, 1);
    rows = [[{ id: 2 }]];
    assert.equal((await role.getRoleDetail(1, 2)).id, 2);
    rows = [[{ id: 2 }]];
    assert.equal((await branch.getBranchDetail(1, 2)).id, 2);
    for (const [fn, args] of [
        [tenant.getTenantDetail, [99]], [role.getRoleDetail, [1, 99]],
        [branch.getBranchDetail, [1, 99]], [staff.getStaffDetail, [1, 99, 'MANAGER']],
        [user.getUserDetail, [1, 99]]
    ]) {
        rows = [[]];
        await assert.rejects(fn(...args), /không|Không/);
    }
    console.log('PASS: GET detail shape, tenant/branch scoping, soft-delete and missing ID');
})().catch(error => { console.error(error); process.exitCode = 1; });