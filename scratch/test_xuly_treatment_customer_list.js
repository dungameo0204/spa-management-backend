const assert = require('node:assert/strict');

const calls = [];
const databasePath = require.resolve('../src/config/database');
require.cache[databasePath] = {
    id: databasePath, filename: databasePath, loaded: true,
    exports: {
        getTenantDbName: async () => 'test_tenant',
        masterPool: {
            async query(sql, params = []) {
                calls.push({ sql, params });
                if (sql.includes('AS customer_count')) return [[{ total: 2 }]];
                if (sql.includes('SELECT DISTINCT c.id')) return [[
                    { id: 9, customer_name: 'Lan', phone_number: '0909', total_debt: '1500000.00' },
                    { id: 8, customer_name: 'Minh', phone_number: '0808', total_debt: '0.00' }
                ]];
                if (sql.includes('COALESCE(today.today_execution_count, 0) AS today_execution_count')) return [[
                    { id: 100, customer_id: 9, product_name: 'Combo', total_sessions: null, remaining_sessions: null, closed_at: null, today_execution_count: '1' },
                    { id: 200, customer_id: 9, product_name: 'Laser exhausted', total_sessions: 5, remaining_sessions: 0, closed_at: null, today_execution_count: '1' },
                    { id: 300, customer_id: 8, product_name: 'Closed lifetime', total_sessions: null, remaining_sessions: 0, closed_at: '2026-11-15 10:00:00', today_execution_count: '0' }
                ]];
                if (sql.includes('WHERE t.parent_treatment_id IN (?)')) return [params[0][0] === 100 ? [
                    { id: 101, customer_id: 9, parent_treatment_id: 100, product_name: 'Finite child', total_sessions: 3, remaining_sessions: 0, closed_at: null },
                    { id: 102, customer_id: 9, parent_treatment_id: 100, product_name: 'Unlimited child', total_sessions: null, remaining_sessions: null, closed_at: null }
                ] : []];
                throw new Error(`Unexpected SQL: ${sql}`);
            }
        }
    }
};

const { getTreatmentsByCustomer } = require('../src/services/treatmentService');

(async () => {
    const result = await getTreatmentsByCustomer(1, { page: '1', pageSize: '20', customerSearch: 'Lan' });
    assert.equal(result.total, 2);
    assert.equal(result.data.length, 2);
    const lan = result.data.find(customer => customer.customer_id === 9);
    const minh = result.data.find(customer => customer.customer_id === 8);
    assert.equal(lan.total_debt, 1500000, 'Debt must be a number.');
    assert.equal(lan.active_treatments.length, 2, 'Open group and completed-today standalone card are active.');
    assert.equal(lan.completed_treatments.length, 1, 'The exhausted standalone root is completed.');
    const group = lan.active_treatments.find(card => card.id === 100);
    assert.equal(group.today_execution_count, 1, 'A grouped visit is counted once at root level.');
    assert.deepEqual(group.children.map(child => child.id), [101, 102]);
    assert.equal(lan.active_treatments.some(card => card.id === 101 || card.id === 102), false, 'Children must never become root rows.');
    assert.equal(minh.active_treatments.length, 0);
    assert.equal(minh.completed_treatments[0].id, 300, 'A closed Xuly lifetime root is completed without requiring a signature.');
    const rootQuery = calls.find(call => call.sql.includes('COALESCE(today.today_execution_count, 0) AS today_execution_count'));
    assert.match(rootQuery.sql, /parent_history_id IS NULL/, 'Today count must exclude child execution histories.');
    assert.ok(calls.some(call => call.sql.includes('AS customer_count')), 'Customer pagination must count customers.');
    const customerQuery = calls.find(call => call.sql.includes('SELECT DISTINCT c.id'));
    assert.deepEqual(customerQuery.params.slice(0, 2), ['%Lan%', '%Lan%'], 'customerSearch must filter customer paging.');
    calls.length = 0;
    await getTreatmentsByCustomer(1, { page: '1', pageSize: '20', executionStartDate: '2026-11-01', executionEndDate: '2026-11-15', productSearch: 'Laser', branchId: '2' });
    const filteredCustomerQuery = calls.find(call => call.sql.includes('SELECT DISTINCT c.id'));
    assert.match(filteredCustomerQuery.sql, /WITH RECURSIVE treatment_tree/, 'Execution filters must reach descendant treatment histories.');
    assert.ok(filteredCustomerQuery.params.includes('2026-11-01') && filteredCustomerQuery.params.includes('2026-11-15'));
    assert.ok(filteredCustomerQuery.params.includes('%Laser%') && filteredCustomerQuery.params.includes('2'));
    console.log('PASS: Xuly customer treatment overview paginates customers, nests children, classifies open/exhausted/closed cards and de-duplicates group visit counts.');
})().catch(error => { console.error(error); process.exitCode = 1; });