const fail = message => Object.assign(new Error(message), { status: 400 });
const normalizeIds = value => {
    if (!Array.isArray(value) || value.length > 200 || value.some(id => !Number.isInteger(id) || id < 1 || id > 2147483647)) {
        throw fail('child_service_ids phải là mảng tối đa 200 ID số nguyên dương.');
    }
    if (new Set(value).size !== value.length) throw fail('child_service_ids không được trùng ID.');
    return value;
};
// All product writes take the same connection-scoped lock BEFORE starting a transaction.
// This prevents concurrent opposite edges/type changes/delete/restore from invalidating checks.
const acquire = async (connection, db) => {
    const [[row]] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [`rosa-product-graph:${db}`]);
    if (Number(row.acquired) !== 1) throw Object.assign(new Error('Sản phẩm đang được cập nhật; vui lòng thử lại.'), { status: 409 });
};
const release = (connection, db) => connection.query('SELECT RELEASE_LOCK(?)', [`rosa-product-graph:${db}`]);

const validateGraph = (products, edges) => {
    const active = new Map(products.filter(p => !p.deleted_at).map(p => [Number(p.id), p]));
    const graph = new Map();
    for (const edge of edges) {
        if (edge.deleted_at) continue;
        const parent = active.get(Number(edge.parent_product_id));
        // A deleted parent's outgoing configuration is dormant until restore.
        if (!parent) continue;
        const child = active.get(Number(edge.child_product_id));
        if (!child || Number(parent.is_product) !== 0 || Number(child.is_product) !== 0) {
            throw fail('Cha và con phải là dịch vụ chưa bị xóa; hãy gỡ liên kết không hợp lệ trước.');
        }
        if (Number(parent.id) === Number(child.id)) throw fail('Dịch vụ không được chứa chính nó.');
        if (!graph.has(Number(parent.id))) graph.set(Number(parent.id), []);
        graph.get(Number(parent.id)).push(Number(child.id));
    }
    const done = new Set();
    const visiting = new Set();
    const visit = node => {
        if (visiting.has(node)) throw fail('Quan hệ dịch vụ con tạo vòng lặp.');
        if (done.has(node)) return;
        visiting.add(node);
        for (const child of graph.get(node) || []) visit(child);
        visiting.delete(node);
        done.add(node);
    };
    for (const node of graph.keys()) visit(node);
};
const check = async (connection, db, productId, { ids, isProduct, action } = {}) => {
    const [products] = await connection.query(`SELECT id,is_product,deleted_at FROM \`${db}\`.products`);
    const [edges] = await connection.query(`SELECT parent_product_id,child_product_id,deleted_at FROM \`${db}\`.product_service_components`);
    const current = products.find(p => Number(p.id) === Number(productId));
    if (!current) throw fail('Sản phẩm/dịch vụ không tồn tại.');
    if (action === 'delete') {
        const active = new Set(products.filter(p => !p.deleted_at).map(p => Number(p.id)));
        if (edges.some(e => !e.deleted_at && Number(e.child_product_id) === Number(productId) && active.has(Number(e.parent_product_id)))) {
            throw fail('Dịch vụ đang được gói khác sử dụng; hãy gỡ liên kết trước khi xóa.');
        }
        return;
    }
    if (action === 'restore') current.deleted_at = null;
    if (isProduct !== undefined) current.is_product = isProduct;
    let proposed = edges;
    if (ids !== undefined) {
        normalizeIds(ids);
        if (ids.length && Number(current.is_product) !== 0) throw fail('Chỉ dịch vụ mới được khai báo child_service_ids.');
        for (const childId of ids) {
            const child = products.find(p => Number(p.id) === childId);
            if (!child || child.deleted_at || Number(child.is_product) !== 0) throw fail(`Dịch vụ con ID ${childId} không tồn tại, đã xóa hoặc là sản phẩm bán lẻ.`);
        }
        proposed = edges.filter(e => Number(e.parent_product_id) !== Number(productId));
        proposed.push(...ids.map(child => ({ parent_product_id: Number(productId), child_product_id: child })));
    }
    // Even dormant incoming links prevent converting their child to retail.
    if (Number(current.is_product) === 1 && proposed.some(e => !e.deleted_at &&
        (Number(e.parent_product_id) === Number(productId) || Number(e.child_product_id) === Number(productId)))) {
        throw fail('Không thể đổi thành sản phẩm bán lẻ khi còn liên kết cha/con.');
    }
    validateGraph(products, proposed);
};
const sync = async (connection, db, productId, ids, actor) => {
    await connection.query(`UPDATE \`${db}\`.product_service_components SET deleted_at=NOW(),deleted_by=?,updated_by=? WHERE parent_product_id=? AND deleted_at IS NULL`, [actor, actor, productId]);
    for (const [order, child] of ids.entries()) {
        await connection.query(`INSERT INTO \`${db}\`.product_service_components (parent_product_id,child_product_id,sort_order,created_by,updated_by)
            VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE sort_order=VALUES(sort_order),updated_by=VALUES(updated_by),deleted_at=NULL,deleted_by=NULL`,
        [productId, child, order, actor, actor]);
    }
};
const read = async (executor, db, ids) => {
    const [rows] = await executor.query(`SELECT c.parent_product_id,c.child_product_id FROM \`${db}\`.product_service_components c
        JOIN \`${db}\`.products p ON p.id=c.child_product_id AND p.deleted_at IS NULL AND p.is_product=0
        WHERE c.parent_product_id IN (?) AND c.deleted_at IS NULL ORDER BY c.sort_order,c.id`, [ids]);
    const result = new Map();
    for (const row of rows) {
        if (!result.has(row.parent_product_id)) result.set(row.parent_product_id, []);
        result.get(row.parent_product_id).push(row.child_product_id);
    }
    return result;
};
module.exports = { normalizeIds, validateGraph, acquire, release, check, sync, read };