const assert = require('node:assert/strict');
const groups = require('../src/services/treatmentGroupService');

async function run() {
    const connection = { query: async () => [[{ id:40, is_product:0 }]] };
    const config = { total_sessions:10, children:[] };
    assert.deepEqual(await groups.prepare(connection, 'test', 40, config, 10), config);
    assert.doesNotThrow(() => groups.validateInvoiceQuantity(config, 10));
    assert.doesNotThrow(() => groups.validateInvoiceQuantity(config, 1));
    assert.doesNotThrow(() => groups.validateInvoiceQuantity({ total_sessions:null, children:[] }, 1));
    for (const [value, quantity] of [[config, 9], [{ total_sessions:null, children:[] }, 10], [{ total_sessions:10, children:[{ product_id:12, total_sessions:10 }] }, 10]]) {
        assert.throws(() => groups.validateInvoiceQuantity(value, quantity), error => error.status === 400);
    }
    console.log('PASS: finite standalone session quantity accepted; mismatched, grouped and lifetime quantities rejected.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });