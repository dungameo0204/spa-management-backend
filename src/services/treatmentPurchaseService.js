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

const entitlement = (sources, used, serviceName) => {
    const totalSessions = sources.some(source => source.total_sessions === null)
        ? null
        : sources.reduce((total, source) => total + Number(source.total_sessions), 0);
    if (totalSessions !== null && used > totalSessions) {
        throw invalid(`Dịch vụ "${serviceName}": sau khi sửa/xóa hóa đơn chỉ còn ${totalSessions} buổi, ít hơn ${used} buổi đã sử dụng.`);
    }
    return { totalSessions, remainingSessions: totalSessions === null ? null : totalSessions - used };
};

const usedSessions = async (connection, db, card) => {
    const [histories] = await connection.query(`SELECT id FROM \`${db}\`.treatment_history
        WHERE treatment_id=? AND deleted_at IS NULL FOR UPDATE`, [card.id]);
    // Cards that are already unlimited have no numeric balance. History remains the verifiable used-session source.
    return card.total_sessions === null ? histories.length :
        Math.max(histories.length, Number(card.total_sessions) - Number(card.remaining_sessions));
};

const applySources = async (connection, db, card, sources, actor) => {
    const used = await usedSessions(connection, db, card);
    const next = entitlement(sources, used, card.product_name || `liệu trình ID ${card.id}`);
    if (!sources.length) {
        await connection.query(`UPDATE \`${db}\`.treatments SET deleted_at=NOW(),deleted_by=?
            WHERE id=? AND deleted_at IS NULL`, [actor, card.id]);
        return { deleted: true, used, ...next };
    }
    await connection.query(`UPDATE \`${db}\`.treatments SET total_sessions=?,remaining_sessions=?,updated_by=?
        WHERE id=? AND deleted_at IS NULL`, [next.totalSessions, next.remainingSessions, actor, card.id]);
    return { deleted: false, used, ...next };
};

const replaceInvoiceItemContribution = async (connection, db, card, invoiceId, invoiceItemId, totalSessions, actor) => {
    const [sources] = await connection.query(`SELECT id,invoice_id,invoice_item_id,total_sessions FROM \`${db}\`.treatment_purchases
        WHERE treatment_id=? AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [card.id]);
    const source = sources.find(row => Number(row.invoice_id) === Number(invoiceId) && Number(row.invoice_item_id) === Number(invoiceItemId));
    if (!source) throw invalid(`Không tìm thấy nguồn mua của liệu trình ID ${card.id}.`);
    const replacement = sessions(totalSessions);
    await applySources(connection, db, card, sources.map(row => row.id === source.id
        ? { ...row, total_sessions: replacement }
        : row), actor);
    await connection.query(`UPDATE \`${db}\`.treatment_purchases SET total_sessions=?,updated_by=? WHERE id=?`,
        [replacement, actor, source.id]);
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
    const [purchases] = await connection.query(`SELECT p.id,p.treatment_id,p.total_sessions,t.product_id,product.name AS product_name,t.total_sessions AS card_total,t.remaining_sessions,
            t.closed_at,t.closure_signature_svg,t.parent_treatment_id,parent.closed_at AS parent_closed_at,parent.closure_signature_svg AS parent_signature
        FROM \`${db}\`.treatment_purchases p
        LEFT JOIN \`${db}\`.treatments t ON t.id=p.treatment_id
        LEFT JOIN \`${db}\`.products product ON product.id=t.product_id
        LEFT JOIN \`${db}\`.treatments parent ON parent.id=t.parent_treatment_id
        WHERE ${whereSql} AND p.deleted_at IS NULL
        ORDER BY p.id FOR UPDATE`, whereParams);
    const deletedTreatmentIds = [];
    const revokedIds = new Set(purchases.map(purchase => Number(purchase.id)));
    for (const treatmentId of new Set(purchases.map(purchase => Number(purchase.treatment_id)))) {
        const purchase = purchases.find(row => Number(row.treatment_id) === treatmentId);
        if (purchase.closed_at || purchase.closure_signature_svg || purchase.parent_closed_at || purchase.parent_signature) {
            throw invalid('Không thể xóa hóa đơn có liệu trình đã ký kết thúc.');
        }
        const [sources] = await connection.query(`SELECT id,invoice_id,invoice_item_id,total_sessions FROM \`${db}\`.treatment_purchases
            WHERE treatment_id=? AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [treatmentId]);
        const remainingSources = sources.filter(source => !revokedIds.has(Number(source.id)));
        await applySources(connection, db, { ...purchase, id: treatmentId, total_sessions: purchase.card_total }, remainingSources, actor);
        for (const source of sources.filter(source => revokedIds.has(Number(source.id)))) {
            await connection.query(`UPDATE \`${db}\`.treatment_purchases SET deleted_at=NOW(),deleted_by=?
                WHERE id=? AND deleted_at IS NULL`, [actor, source.id]);
        }
        if (!remainingSources.length) deletedTreatmentIds.push(treatmentId);
    }
    return { purchases, deletedTreatmentIds };
};

const revokeInvoice = (connection, db, invoiceId, actor) => revoke(connection, db, 'p.invoice_id=?', [invoiceId], actor);
const revokeInvoiceItem = (connection, db, invoiceItemId, actor) => revoke(connection, db, 'p.invoice_item_id=?', [invoiceItemId], actor);
const revokeTreatmentInvoiceItem = (connection, db, treatmentId, invoiceId, invoiceItemId, actor) => revoke(connection, db,
    'p.treatment_id=? AND p.invoice_id=? AND p.invoice_item_id=?', [treatmentId, invoiceId, invoiceItemId], actor);

module.exports = { insert, findMergeable, merge, revokeInvoice, revokeInvoiceItem, activePurchaseCount, sessions,
    entitlement, usedSessions, applySources, replaceInvoiceItemContribution, revokeTreatmentInvoiceItem };
