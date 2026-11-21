// Tier selection always uses the pre-discount price of ONE unit.
const loadCommissionBase = async (connection, dbName, treatmentId, roleId) => {
    const [rows] = await connection.query(
        `SELECT t.product_id, t.invoice_id, t.invoice_item_id, t.commission_base_price, t.commission_quantity,
                t.parent_treatment_id, p.is_treatment_combo, ii.snapshot_price, ii.quantity
         FROM \`${dbName}\`.treatments t
         JOIN \`${dbName}\`.products p ON p.id = t.product_id
         LEFT JOIN \`${dbName}\`.invoice_items ii ON ii.id = t.invoice_item_id AND ii.deleted_at IS NULL
             AND ii.invoice_id = t.invoice_id AND ii.product_id = t.product_id
         WHERE t.id = ? AND t.deleted_at IS NULL`, [treatmentId]
    );
    if (!rows.length) throw new Error('Thẻ liệu trình không tồn tại.');
    const row = rows[0];
    const ownSnapshot = row.invoice_id == null || row.parent_treatment_id != null;
    const [[pricing]] = await connection.query(
        `SELECT EXISTS(SELECT 1 FROM \`${dbName}\`.product_commission_tiers WHERE product_id=? AND role_id=?) AS has_tiers,
                EXISTS(SELECT 1 FROM \`${dbName}\`.product_commissions WHERE product_id=? AND role_id=? AND deleted_at IS NULL AND commission_percent<>0) AS has_percent`,
        [row.product_id, roleId, row.product_id, roleId]
    );
    const priceRequired = Number(pricing.has_tiers) === 1 || Number(pricing.has_percent) === 1;
    let multiplier = Number(row.is_treatment_combo) === 1 ? 1 : Number(row.commission_quantity ?? row.quantity ?? 1);
    if (!priceRequired) return { productId: row.product_id, unitPrice: null, multiplier, priceRequired: false };
    let invoiceSnapshotPrice = row.snapshot_price;
    let invoiceQuantity = row.quantity;
    if (!ownSnapshot && invoiceSnapshotPrice == null) {
        // Older invoice amendments replaced invoice_items and could leave treatments pointing at
        // a soft-deleted line. Recover only from the card's own purchase ledger, never from a
        // same-product invoice line selected by guesswork.
        const [sources] = await connection.query(
            `SELECT ii.snapshot_price,ii.quantity FROM \`${dbName}\`.treatment_purchases tp
             JOIN \`${dbName}\`.invoice_items ii ON ii.id=tp.invoice_item_id AND ii.deleted_at IS NULL
             WHERE tp.treatment_id=? AND tp.invoice_id=? AND ii.invoice_id=? AND ii.product_id=?
               AND tp.deleted_at IS NULL ORDER BY tp.id FOR UPDATE`,
            [treatmentId, row.invoice_id, row.invoice_id, row.product_id]
        );
        if (sources.length !== 1) {
            throw new Error(sources.length
                ? 'Thẻ có nhiều nguồn dòng hóa đơn phù hợp; cần đối soát invoice_item_id.'
                : 'Thẻ chưa liên kết dòng hóa đơn; cần đối soát invoice_item_id.');
        }
        invoiceSnapshotPrice = sources[0].snapshot_price;
        invoiceQuantity = sources[0].quantity;
        if (Number(row.is_treatment_combo) !== 1 && row.commission_quantity == null && row.quantity == null) {
            multiplier = Number(invoiceQuantity);
        }
    }
    if (ownSnapshot && row.commission_base_price == null) throw new Error('Thẻ chưa có commission_base_price.');
    return {
        productId: row.product_id,
        unitPrice: Number(ownSnapshot ? row.commission_base_price : invoiceSnapshotPrice),
        multiplier,
        priceRequired: true
    };
};

const calculateCommission = async (connection, dbName, base, roleId) => {
    const [tiers] = base.priceRequired ? await connection.query(
        `SELECT calculation_type, fixed_amount, percent FROM \`${dbName}\`.product_commission_tiers
         WHERE product_id = ? AND role_id = ? AND min_price <= ? AND (max_price IS NULL OR max_price > ?)
         ORDER BY min_price DESC LIMIT 1`, [base.productId, roleId, base.unitPrice, base.unitPrice]
    ) : [[]];
    let fixedAmount = 0;
    let percentAmount = 0;
    if (tiers.length) {
        const tier = tiers[0];
        if (tier.calculation_type === 'FIXED') fixedAmount = Number(tier.fixed_amount);
        else percentAmount = base.unitPrice * Number(tier.percent) / 100;
    } else {
        const [defaults] = await connection.query(
            `SELECT commission_fixed_amount, commission_percent FROM \`${dbName}\`.product_commissions
             WHERE product_id = ? AND role_id = ? AND deleted_at IS NULL LIMIT 1`, [base.productId, roleId]
        );
        if (defaults.length) {
            fixedAmount = Number(defaults[0].commission_fixed_amount);
            percentAmount = base.priceRequired ? base.unitPrice * Number(defaults[0].commission_percent) / 100 : 0;
        }
    }
    // Fixed commissions retain the existing per-card quantity behavior. Percentage commissions
    // are for one executed treatment, so they always use only that treatment's unit price.
    return Math.round(((fixedAmount * base.multiplier) + percentAmount + Number.EPSILON) * 100) / 100;
};

const recalculateTreatmentCommissions = async (connection, dbName, treatmentId, executorName) => {
    const [rows] = await connection.query(
        `SELECT ths.id, s.role_id FROM \`${dbName}\`.treatment_history_staffs ths
         JOIN \`${dbName}\`.treatment_history th ON th.id = ths.treatment_history_id
         JOIN \`${dbName}\`.staffs s ON s.id = ths.staff_id
         WHERE th.treatment_id = ? AND th.deleted_at IS NULL AND ths.deleted_at IS NULL FOR UPDATE`, [treatmentId]
    );
    if (!rows.length) return;
    for (const row of rows) {
        const base = await loadCommissionBase(connection, dbName, treatmentId, row.role_id);
        const amount = await calculateCommission(connection, dbName, base, row.role_id);
        await connection.query(`UPDATE \`${dbName}\`.treatment_history_staffs SET commission_amount_snapshot = ?, updated_by = ? WHERE id = ?`,
            [amount, executorName, row.id]);
    }
};

module.exports = { loadCommissionBase, calculateCommission, recalculateTreatmentCommissions };