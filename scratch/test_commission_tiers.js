const assert = require('node:assert/strict');
const { loadCommissionBase, calculateCommission, recalculateTreatmentCommissions } = require('../src/services/commissionService');

const calls = [];
let baseRow = {};
let tierRows = [];
let assignments = [];
const db = {
    async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM `tenant`.treatments t')) return [[baseRow]];
        if (sql.includes('FROM `tenant`.product_commission_tiers')) return [tierRows];
        if (sql.includes('FROM `tenant`.product_commissions')) return [[{ commission_percent: 5, commission_fixed_amount: 0 }]];
        if (sql.includes('FROM `tenant`.treatment_history_staffs ths')) return [assignments];
        if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }];
        throw new Error(sql);
    }
};
(async () => {
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: 15, is_treatment_combo: 0, snapshot_price: '900000', quantity: 2 };
    tierRows = [{ calculation_type: 'PERCENT', percent: 10 }];
    let base = await loadCommissionBase(db, 'tenant', 1);
    assert.equal(await calculateCommission(db, 'tenant', base, 3), 180000);
    assert.deepEqual(calls.find(c => c.sql.includes('FROM `tenant`.product_commission_tiers')).params, [4, 3, 900000, 900000]);
    tierRows = [{ calculation_type: 'FIXED', fixed_amount: 100000 }];
    baseRow.snapshot_price = '1200000';
    base = await loadCommissionBase(db, 'tenant', 1);
    assert.equal(await calculateCommission(db, 'tenant', base, 3), 200000);
    tierRows = [];
    assert.equal(await calculateCommission(db, 'tenant', base, 3), 120000);
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: 15, is_treatment_combo: 1, snapshot_price: '900000', quantity: 2 };
    tierRows = [{ calculation_type: 'PERCENT', percent: 10 }];
    assert.equal(await calculateCommission(db, 'tenant', await loadCommissionBase(db, 'tenant', 1), 3), 90000);
    baseRow = { product_id: 4, invoice_id: null, commission_base_price: 50000, commission_quantity: 10, is_treatment_combo: 0 };
    assert.equal(await calculateCommission(db, 'tenant', await loadCommissionBase(db, 'tenant', 1), 3), 50000);
    assignments = [{ id: 90, role_id: 3 }];
    await recalculateTreatmentCommissions(db, 'tenant', 1, 'tester');
    assert.deepEqual(calls.filter(c => c.sql.startsWith('UPDATE')).at(-1).params, [50000, 'tester', 90]);
    baseRow = { product_id: 4, invoice_id: null, commission_base_price: null, product_price: '900000', commission_quantity: 2, is_treatment_combo: 0 };
    base = await loadCommissionBase(db, 'tenant', 1);
    assert.equal(base.unitPrice, 900000);
    assert.ok(calls.at(-1).sql.includes('p.price AS product_price'));
    assert.equal(await calculateCommission(db, 'tenant', base, 3), 180000);
    await recalculateTreatmentCommissions(db, 'tenant', 1, 'tester');
    assert.deepEqual(calls.filter(c => c.sql.startsWith('UPDATE')).at(-1).params, [180000, 'tester', 90]);
    baseRow.is_treatment_combo = 1;
    assert.equal(await calculateCommission(db, 'tenant', await loadCommissionBase(db, 'tenant', 1), 3), 90000);
    baseRow.commission_base_price = 0;
    assert.equal((await loadCommissionBase(db, 'tenant', 1)).unitPrice, 0);
    baseRow.commission_base_price = 50000;
    assert.equal((await loadCommissionBase(db, 'tenant', 1)).unitPrice, 50000);
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: 15, commission_base_price: null, product_price: '1200000', snapshot_price: '900000', quantity: 2, is_treatment_combo: 0 };
    assert.equal((await loadCommissionBase(db, 'tenant', 1)).unitPrice, 900000);
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: null, snapshot_price: null };
    await assert.rejects(loadCommissionBase(db, 'tenant', 1), /đối soát/);
    console.log('PASS: unit-price band, quantity, combo, manual card, fallback and retroactive recalculation');
})().catch(e => { console.error(e); process.exitCode = 1; });