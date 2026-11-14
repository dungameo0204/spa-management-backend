const invalid = message => Object.assign(new Error(message), { status: 400 });

const sessions = value => {
    if (value === null) return null;
    if (!Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) throw invalid('Sá»‘ buá»•i mua khÃ´ng há»£p lá»‡.');
    return Number(value);
};

const insert = async (connection, db, { treatmentId, invoiceId = null, invoiceItemId = null, totalSessions, actor }) => {
    await connection.query(`INSERT INTO \`${db}\`.treatment_purchases
        (treatment_id,invoice_id,invoice_item_id,total_sessions,created_by,updated_by)
        VALUES (?,?,?,?,?,?)`, [treatmentId, invoiceId, invoiceItemId, sessions(totalSessions), actor, actor]);
};

const activePurchaseCount = async (connection, db, treatmentId) => {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${db}\`.treatment_purchases
        WHERE treatment_id=? AND deleted_at IS NULL`, [treatmentId]);
    return Number(row.count);
};

const findMergeable = async (connection, db, customerId, productId) => {
    const [rows] = await connection.query(`SELECT t.id,t.total_sessions,t.remaining_sessions,t.created_at
        FROM \`${db}\`.treatments t
        LEFT JOIN \`${db}\`.treatments parent ON parent.id=t.parent_treatment_id
        WHERE t.customer_id=? AND t.product_id=? AND t.deleted_at IS NULL
          AND t.closed_at IS NULL AND t.closure_signature_svg IS NULL
          AND (t.parent_treatment_id IS NULL OR (parent.deleted_at IS NULL AND parent.closed_at IS NULL AND parent.closure_signature_svg IS NULL))
          AND (t.parent_treatment_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM \`${db}\`.treatments child WHERE child.parent_treatment_id=t.id AND child.deleted_at IS NULL))
        ORDER BY CASE WHEN t.parent_treatment_id IS NULL THEN 1 ELSE 0 END, parent.created_at DESC,parent.id DESC,t.created_at DESC,t.id DESC LIMIT 1 FOR UPDATE`, [customerId, productId]);
    return rows[0] || null;
};

const merge = async (connection, db, treatment, addedSessions, actor, source = {}) => {
    const amount = sessions(addedSessions);
    const becomesUnlimited = treatment.total_sessions === null || amount === null;
    await connection.query(becomesUnlimited
        ? `UPDATE \`${db}\`.treatments SET total_sessions=NULL,remaining_sessions=NULL,updated_by=?
            WHERE id=? AND deleted_at IS NULL AND closed_at IS NULL AND closure_signature_svg IS NULL`
        : `UPDATE \`${db}\`.treatments SET total_sessions=total_sessions+?,remaining_sessions=remaining_sessions+?,updated_by=?
            WHERE id=? AND deleted_at IS NULL AND total_sessions IS NOT NULL AND closed_at IS NULL AND closure_signature_svg IS NULL`,
    becomesUnlimited ? [actor, treatment.id] : [amount, amount, actor, treatment.id]);
    await insert(connection, db, { treatmentId: treatment.id, totalSessions: amount, actor, ...source });
    return treatment.id;
};

const revoke = async (connection, db, whereSql, whereParams, actor) => {
    const [purchases] = await connection.query(`SELECT p.id,p.treatment_id,p.total_sessions,t.total_sessions AS card_total,t.remaining_sessions,
            t.closed_at,t.closure_signature_svg,t.parent_treatment_id,parent.closed_at AS parent_closed_at,parent.closure_signature_svg AS parent_signature
        FROM \`${db}\`.treatment_purchases p
        LEFT JOIN \`${db}\`.treatments t ON t.id=p.treatment_id
        LEFT JOIN \`${db}\`.treatments parent ON parent.id=t.parent_treatment_id
        WHERE ${whereSql} AND p.deleted_at IS NULL
        ORDER BY p.id FOR UPDATE`, whereParams);
    const deletedTreatmentIds = [];
    for (const purchase of purchases) {
        const count = await activePurchaseCount(connection, db, purchase.treatment_id);
        if (purchase.closed_at || purchase.closure_signature_svg || purchase.parent_closed_at || purchase.parent_signature) {
            throw invalid('Không thể xóa hóa đơn có liệu trình đã ký kết thúc.');
        }
        if (purchase.total_sessions === null) {
            const [histories] = await connection.query(`SELECT id FROM \`${db}\`.treatment_history WHERE treatment_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [purchase.treatment_id]);
            if (count !== 1) throw invalid('Không thể xóa hóa đơn vì liệu trình đã nối trọn đời; hãy tạo phiếu điều chỉnh riêng.');
            if (histories.length) throw invalid('Không thể xóa hóa đơn có liệu trình trọn đời đã được sử dụng.');
            await connection.query(`UPDATE \`${db}\`.treatment_purchases SET deleted_at=NOW(),deleted_by=? WHERE id=? AND deleted_at IS NULL`, [actor, purchase.id]);
            await connection.query(`UPDATE \`${db}\`.treatments SET deleted_at=NOW(),deleted_by=? WHERE id=? AND deleted_at IS NULL`, [actor, purchase.treatment_id]);
            deletedTreatmentIds.push(Number(purchase.treatment_id));
            continue;
        }
        if (purchase.card_total === null) {
            throw invalid('Không thể xóa hóa đơn vì liệu trình đã nối trọn đời; hãy tạo phiếu điều chỉnh riêng.');
        }
        const amount = Number(purchase.total_sessions);
        if (Number(purchase.remaining_sessions) < amount || Number(purchase.card_total) < amount) throw invalid('Không thể xóa hóa đơn vì số buổi từ lần mua này đã được sử dụng.');
        await connection.query(`UPDATE \`${db}\`.treatment_purchases SET deleted_at=NOW(),deleted_by=? WHERE id=? AND deleted_at IS NULL`, [actor, purchase.id]);
        if (count === 1) {
            await connection.query(`UPDATE \`${db}\`.treatments SET deleted_at=NOW(),deleted_by=? WHERE id=? AND deleted_at IS NULL`, [actor, purchase.treatment_id]);
            deletedTreatmentIds.push(Number(purchase.treatment_id));
        } else {
            await connection.query(`UPDATE \`${db}\`.treatments SET total_sessions=total_sessions-?,remaining_sessions=remaining_sessions-?,updated_by=? WHERE id=? AND deleted_at IS NULL`,
                [amount, amount, actor, purchase.treatment_id]);
        }
    }
    return { purchases, deletedTreatmentIds };
};

const revokeInvoice = (connection, db, invoiceId, actor) => revoke(connection, db, 'p.invoice_id=?', [invoiceId], actor);
const revokeInvoiceItem = (connection, db, invoiceItemId, actor) => revoke(connection, db, 'p.invoice_item_id=?', [invoiceItemId], actor);

module.exports = { insert, findMergeable, merge, revokeInvoice, revokeInvoiceItem, activePurchaseCount, sessions };
