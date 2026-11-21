const assert = require('node:assert/strict');
const { loadCommissionBase, calculateCommission, recalculateTreatmentCommissions } = require('../src/services/commissionService');

const calls = [];
let baseRow = {};
let tierRows = [];
let assignments = [];
let ledgerRows = [];
let pricing = { has_tiers: 1, has_percent: 1 };
const db = {
    async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM `tenant`.treatments t')) return [[baseRow]];
        if (sql.includes('AS has_tiers')) return [[pricing]];
        if (sql.includes('FROM `tenant`.treatment_purchases tp')) return [ledgerRows];
        if (sql.includes('FROM `tenant`.product_commission_tiers')) return [tierRows];
        if (sql.includes('FROM `tenant`.product_commissions')) return [[pricing.has_percent ?
            { commission_percent: 5, commission_fixed_amount: 0 } : { commission_percent: 0, commission_fixed_amount: 40000 }]];
        if (sql.includes('FROM `tenant`.treatment_history_staffs ths')) return [assignments];
        if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }];
        throw new Error(sql);
    }
};
(async () => {
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: 15, is_treatment_combo: 0, snapshot_price: '450000', quantity: 15 };
    tierRows = [{ calculation_type: 'PERCENT', percent: 10 }];
    let base = await loadCommissionBase(db, 'tenant', 1, 3);
    assert.equal(await calculateCommission(db, 'tenant', base, 3), 45000,
        '10% commission uses one treatment unit price, not the invoice line total');
    assert.deepEqual(calls.find(c => c.sql.includes('min_price <= ?')).params, [4, 3, 450000, 450000]);
    tierRows = [{ calculation_type: 'FIXED', fixed_amount: 100000 }];
    baseRow.snapshot_price = '1200000';
    base = await loadCommissionBase(db, 'tenant', 1, 3);
    assert.equal(await calculateCommission(db, 'tenant', base, 3), 1500000,
        'fixed commission retains its existing invoice-line quantity behavior');
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: 15, is_treatment_combo: 0, snapshot_price: '2000000', quantity: 1, total_sessions: 10 };
    tierRows = [{ calculation_type: 'PERCENT', percent: 10 }];
    assert.equal(await calculateCommission(db, 'tenant', await loadCommissionBase(db, 'tenant', 1, 3), 3), 200000,
        'a 2,000,000 treatment with 10 auto-created sessions at 10% pays 200,000, never 2,000,000');
    tierRows = [];
    assert.equal(await calculateCommission(db, 'tenant', await loadCommissionBase(db, 'tenant', 1, 3), 3), 100000,
        'default percentage commission also uses one treatment unit price');
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: 15, is_treatment_combo: 1, snapshot_price: '900000', quantity: 2 };
    tierRows = [{ calculation_type: 'PERCENT', percent: 10 }];
    assert.equal(await calculateCommission(db, 'tenant', await loadCommissionBase(db, 'tenant', 1, 3), 3), 90000);
    baseRow = { product_id: 4, invoice_id: null, commission_base_price: 50000, commission_quantity: 10, is_treatment_combo: 0 };
    assert.equal(await calculateCommission(db, 'tenant', await loadCommissionBase(db, 'tenant', 1, 3), 3), 5000,
        'percentage commission ignores commission_quantity and total_sessions');
    assignments = [{ id: 90, role_id: 3 }];
    await recalculateTreatmentCommissions(db, 'tenant', 1, 'tester');
    assert.deepEqual(calls.filter(c => c.sql.startsWith('UPDATE')).at(-1).params, [5000, 'tester', 90],
        'recalculation snapshots the percentage from the treatment price, not its session count');
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: 999, is_treatment_combo: 0, snapshot_price: null };
    ledgerRows = [{ snapshot_price: '700000', quantity: 2 }];
    tierRows = [{ calculation_type: 'PERCENT', percent: 10 }];
    assert.equal(await calculateCommission(db, 'tenant', await loadCommissionBase(db, 'tenant', 1, 3), 3), 70000,
        'a stale invoice_item_id must recover its price from one active card purchase source');
    ledgerRows = [{ snapshot_price: '700000', quantity: 1 }, { snapshot_price: '900000', quantity: 1 }];
    await assert.rejects(loadCommissionBase(db, 'tenant', 1, 3), /nhiều nguồn/);
    ledgerRows = [];
    await assert.rejects(loadCommissionBase(db, 'tenant', 1, 3), /đối soát/);
    pricing = { has_tiers: 0, has_percent: 0 };
    baseRow = { product_id: 4, invoice_id: 7, invoice_item_id: 999, commission_quantity: 2, is_treatment_combo: 0, snapshot_price: null };
    ledgerRows = [];
    const fixedBase = await loadCommissionBase(db, 'tenant', 1, 3);
    assert.equal(fixedBase.priceRequired, false);
    assert.equal(await calculateCommission(db, 'tenant', fixedBase, 3), 80000,
        'fixed-only roles must not need a price or guess a ledger source');
    console.log('PASS: percentage commissions use one unit price regardless of invoice quantity, fixed commissions retain quantity behavior, unique purchase-ledger recovery, ambiguity rejection and retroactive recalculation');
})().catch(e => { console.error(e); process.exitCode = 1; });