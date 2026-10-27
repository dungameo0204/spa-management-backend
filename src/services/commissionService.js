// Tier selection always uses the pre-discount price of ONE unit.
const loadCommissionBase = async (connection, dbName, treatmentId) => {
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
    if (!ownSnapshot && row.snapshot_price == null) throw new Error('Thẻ chưa liên kết dòng hóa đơn; cần đối soát invoice_item_id.');
    if (ownSnapshot && row.commission_base_price == null) throw new Error('Thẻ chưa có commission_base_price.');
    return {
        productId: row.product_id,
        unitPrice: Number(ownSnapshot ? row.commission_base_price : row.snapshot_price),
        multiplier: Number(row.is_treatment_combo) === 1 ? 1 : Number(ownSnapshot ? row.commission_quantity : row.quantity)
    };
};

const calculateCommission = async (connection, dbName, base, roleId) => {
    const [tiers] = await connection.query(
        `SELECT calculation_type, fixed_amount, percent FROM \`${dbName}\`.product_commission_tiers
         WHERE product_id = ? AND role_id = ? AND min_price <= ? AND (max_price IS NULL OR max_price > ?)
         ORDER BY min_price DESC LIMIT 1`, [base.productId, roleId, base.unitPrice, base.unitPrice]
    );
    let perUnit = 0;
    if (tiers.length) {
        const tier = tiers[0];
        perUnit = tier.calculation_type === 'FIXED' ? Number(tier.fixed_amount) : base.unitPrice * Number(tier.percent) / 100;
    } else {
        const [defaults] = await connection.query(
            `SELECT commission_fixed_amount, commission_percent FROM \`${dbName}\`.product_commissions
             WHERE product_id = ? AND role_id = ? AND deleted_at IS NULL LIMIT 1`, [base.productId, roleId]
        );
        if (defaults.length) perUnit = Number(defaults[0].commission_fixed_amount) + base.unitPrice * Number(defaults[0].commission_percent) / 100;
    }
    return Math.round((perUnit * base.multiplier + Number.EPSILON) * 100) / 100;
};

const recalculateTreatmentCommissions = async (connection, dbName, treatmentId, executorName) => {
    const [rows] = await connection.query(
        `SELECT ths.id, s.role_id FROM \`${dbName}\`.treatment_history_staffs ths
         JOIN \`${dbName}\`.treatment_history th ON th.id = ths.treatment_history_id
         JOIN \`${dbName}\`.staffs s ON s.id = ths.staff_id
         WHERE th.treatment_id = ? AND th.deleted_at IS NULL AND ths.deleted_at IS NULL FOR UPDATE`, [treatmentId]
    );
    if (!rows.length) return;
    const base = await loadCommissionBase(connection, dbName, treatmentId);
    for (const row of rows) {
        const amount = await calculateCommission(connection, dbName, base, row.role_id);
        await connection.query(`UPDATE \`${dbName}\`.treatment_history_staffs SET commission_amount_snapshot = ?, updated_by = ? WHERE id = ?`,
            [amount, executorName, row.id]);
    }
};

module.exports = { loadCommissionBase, calculateCommission, recalculateTreatmentCommissions };