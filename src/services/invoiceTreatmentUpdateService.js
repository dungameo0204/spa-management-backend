const groups = require('./treatmentGroupService');

const usedSessions = async (connection, db, card) => {
    const [rows] = await connection.query(`SELECT id FROM \`${db}\`.treatment_history WHERE treatment_id=? AND deleted_at IS NULL FOR UPDATE`, [card.id]);
    // Preserve imported balances for open finite cards; closure zeroes balances and lifetime has no numeric balance.
    return card.closed_at || card.total_sessions === null ? rows.length :
        Math.max(rows.length, Number(card.total_sessions) - Number(card.remaining_sessions));
};

const remaining = (card, total, used) => {
    if (total !== null && total < used) throw new Error(`Số buổi mới của liệu trình ID ${card.id} không được nhỏ hơn ${used} buổi đã sử dụng.`);
    return card.closed_at ? 0 : total === null ? null : total - used;
};

const reconcileGroup = async (connection, db, root, cards, config, customerId, actor) => {
    const children = cards.filter(card => Number(card.parent_treatment_id) === Number(root.id));
    if (children.some(child => cards.some(card => Number(card.parent_treatment_id) === Number(child.id)))) {
        throw new Error('Nhóm nhiều tầng cần đối soát trước khi sửa hóa đơn.');
    }
    const normalized = config === undefined ? { total_sessions: root.total_sessions } : groups.normalizeConfig(config);
    const desired = normalized.children === undefined ? children.map(child => ({ product_id: Number(child.product_id), total_sessions: child.total_sessions })) : normalized.children;
    const retained = [];
    const rootUsed = await usedSessions(connection, db, root);
    const counts = new Map([[root.id, rootUsed]]);
    for (const child of children) counts.set(child.id, await usedSessions(connection, db, child));
    if (Number(root.customer_id) !== Number(customerId) && (root.closed_at || [...counts.values()].some(count => count > 0))) {
        throw new Error('Không thể chuyển liệu trình đã sử dụng hoặc đã ký sang khách hàng khác.');
    }
    for (const child of children) {
        const next = desired.find(entry => entry.product_id === Number(child.product_id));
        if (!next || next.total_sessions === 0) {
            if (counts.get(child.id) > 0 || child.closed_at) throw new Error(`Không thể xóa liệu trình ID ${child.id} đã được sử dụng hoặc đã ký.`);
            await connection.query(`UPDATE \`${db}\`.treatments SET deleted_at=NOW(),deleted_by=? WHERE id=?`, [actor, child.id]);
        } else {
            await connection.query(`UPDATE \`${db}\`.treatments SET customer_id=?,total_sessions=?,remaining_sessions=?,updated_by=? WHERE id=?`,
                [customerId, next.total_sessions, remaining(child, next.total_sessions, counts.get(child.id)), actor, child.id]);
            retained.push(child.id);
        }
    }
    for (const next of desired) {
        if (next.total_sessions === 0 || children.some(child => Number(child.product_id) === next.product_id)) continue;
        if (root.closed_at) throw new Error('Không thêm dịch vụ con mới vào nhóm đã ký kết thúc.');
        if (rootUsed > 0) throw new Error('Không chuyển thẻ đã thực hiện trực tiếp thành nhóm dịch vụ con.');
        const prepared = await groups.prepare(connection, db, root.product_id, { total_sessions: normalized.total_sessions, children: [next] });
        const child = prepared.children[0];
        const [insert] = await connection.query(`INSERT INTO \`${db}\`.treatments
            (customer_id,product_id,invoice_id,invoice_item_id,parent_treatment_id,total_sessions,remaining_sessions,commission_base_price,commission_quantity,created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,1,?,?)`, [customerId, child.product_id, root.invoice_id, root.invoice_item_id, root.id,
            child.total_sessions, child.total_sessions, child.price, actor, root.created_at]);
        retained.push(insert.insertId);
    }
    const rootRemaining = remaining(root, normalized.total_sessions, rootUsed);
    await connection.query(`UPDATE \`${db}\`.treatments SET customer_id=?,total_sessions=?,remaining_sessions=?,updated_by=? WHERE id=?`,
        [customerId, normalized.total_sessions, rootRemaining, actor, root.id]);
    return [root.id, ...retained];
};

module.exports = { usedSessions, remaining, reconcileGroup };