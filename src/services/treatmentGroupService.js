const invalid = message => Object.assign(new Error(message), { status: 400 });
const count = (value, field, min = 0) => {
    if (value === null) return null;
    if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > 2147483647) throw invalid(`${field} phải là số nguyên >= ${min} hoặc null (trọn đời).`);
    return Number(value);
};
const normalizeConfig = config => {
    if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !['total_sessions', 'children'].includes(key))) throw invalid('treatment chỉ nhận total_sessions và children.');
    const total = count(config.total_sessions, 'total_sessions', 1);
    let children;
    if (config.children !== undefined) {
        if (!Array.isArray(config.children) || config.children.length > 200) throw invalid('children phải là mảng tối đa 200 dịch vụ.');
        const seen = new Set();
        children = config.children.map(child => {
            if (!child || typeof child !== 'object' || Array.isArray(child) || Object.keys(child).some(k => !['product_id', 'total_sessions'].includes(k))) throw invalid('Mỗi child chỉ nhận product_id và total_sessions; giá được lấy từ products.price.');
            const productId = count(child.product_id, 'child.product_id', 1);
            if (productId === null || seen.has(productId)) throw invalid('child.product_id phải là ID hợp lệ và không trùng.');
            seen.add(productId);
            return { product_id: productId, total_sessions: count(child.total_sessions, 'child.total_sessions') };
        });
    }
    return { total_sessions: total, children };
};
const validateInvoiceQuantity = (config, quantity) => {
    const perSession = !config.children?.length && config.total_sessions !== null && quantity === config.total_sessions;
    if (quantity !== 1 && !perSession) throw invalid('Dòng hóa đơn có cấu hình treatment phải có quantity=1 hoặc bằng total_sessions đối với dịch vụ đơn lẻ hữu hạn.');
};
const prepare = async (connection, db, productId, config, quantity = 1) => {
    const normalized = normalizeConfig(config);
    validateInvoiceQuantity(normalized, quantity);
    const [parents] = await connection.query(`SELECT id,is_product FROM \`${db}\`.products WHERE id=? AND deleted_at IS NULL FOR SHARE`, [productId]);
    if (!parents.length || Number(parents[0].is_product) !== 0) throw invalid('Chỉ dịch vụ còn hoạt động được tạo liệu trình.');
    if (!normalized.children) return normalized;
    const [components] = await connection.query(`SELECT c.child_product_id,p.price,p.is_product,p.deleted_at FROM \`${db}\`.product_service_components c
        JOIN \`${db}\`.products p ON p.id=c.child_product_id WHERE c.parent_product_id=? AND c.deleted_at IS NULL FOR SHARE`, [productId]);
    normalized.children = normalized.children.map(child => {
        const product = components.find(c => Number(c.child_product_id) === child.product_id);
        if (!product || product.deleted_at || Number(product.is_product) !== 0 || child.product_id === Number(productId)) throw invalid(`Dịch vụ con ID ${child.product_id} không thuộc cấu hình dịch vụ cha đang hoạt động.`);
        const price = Number(product.price);
        if (!Number.isFinite(price) || price < 0) throw invalid('Giá dịch vụ con không hợp lệ.');
        return { ...child, price };
    });
    return normalized;
};
const create = async (connection, db, data, config, actor) => {
    const [root] = await connection.query(`INSERT INTO \`${db}\`.treatments
        (customer_id,product_id,invoice_id,invoice_item_id,total_sessions,remaining_sessions,commission_base_price,commission_quantity,note,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,COALESCE(?,NOW()))`, [data.customerId, data.productId, data.invoiceId ?? null, data.invoiceItemId ?? null,
        config.total_sessions, data.remaining === undefined ? config.total_sessions : data.remaining, data.basePrice, data.quantity ?? 1, data.note || null, actor, data.createdAt ?? null]);
    const children = [];
    for (const child of config.children || []) {
        if (child.total_sessions === 0) continue;
        const [insert] = await connection.query(`INSERT INTO \`${db}\`.treatments
            (customer_id,product_id,invoice_id,invoice_item_id,parent_treatment_id,total_sessions,remaining_sessions,commission_base_price,commission_quantity,created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,1,?,COALESCE(?,NOW()))`, [data.customerId, child.product_id, data.invoiceId ?? null, data.invoiceItemId ?? null,
            root.insertId, child.total_sessions, child.total_sessions, child.price, actor, data.createdAt ?? null]);
        children.push({ id: insert.insertId, product_id: child.product_id, parent_treatment_id: root.insertId, total_sessions: child.total_sessions, remaining_sessions: child.total_sessions });
    }
    return { treatmentId: root.insertId, children };
};

// Load all descendants in batches; do not apply remaining-session/status filters to children.
const attach = async (executor, db, roots, { histories = false } = {}) => {
    if (!roots.length) return roots;
    const all = new Map(roots.map(root => [Number(root.id), { ...root, children: [] }]));
    let frontier = [...all.keys()];
    while (frontier.length) {
        const [rows] = await executor.query(`SELECT t.*,p.name AS product_name FROM \`${db}\`.treatments t
            JOIN \`${db}\`.products p ON p.id=t.product_id WHERE t.parent_treatment_id IN (?) AND t.deleted_at IS NULL ORDER BY t.id`, [frontier]);
        frontier = [];
        for (const row of rows) {
            if (all.has(Number(row.id))) throw invalid('Quan hệ thẻ liệu trình bị vòng lặp.');
            const parent = all.get(Number(row.parent_treatment_id));
            if (!parent || Number(parent.customer_id) !== Number(row.customer_id)) throw invalid('Thẻ con không cùng khách hàng với thẻ cha.');
            const child = { ...row, children: [] };
            parent.children.push(child);
            all.set(Number(child.id), child);
            frontier.push(Number(child.id));
        }
        if (all.size > 10000) throw invalid('Nhóm liệu trình quá lớn.');
    }
    if (histories) {
        const [rows] = await executor.query(`SELECT * FROM \`${db}\`.treatment_history WHERE treatment_id IN (?) AND deleted_at IS NULL ORDER BY execution_date DESC,id DESC`, [[...all.keys()]]);
        let staffs = [];
        if (rows.length) [staffs] = await executor.query(`SELECT ths.*,s.fullname AS staff_name FROM \`${db}\`.treatment_history_staffs ths
            JOIN \`${db}\`.staffs s ON s.id=ths.staff_id WHERE ths.treatment_history_id IN (?) AND ths.deleted_at IS NULL ORDER BY ths.id`, [rows.map(h => h.id)]);
        for (const h of rows) h.staffs = staffs.filter(s => Number(s.treatment_history_id) === Number(h.id));
        for (const card of all.values()) card.histories = rows.filter(h => Number(h.treatment_id) === Number(card.id));
    }
    return roots.map(root => all.get(Number(root.id)));
};
module.exports = { count, normalizeConfig, validateInvoiceQuantity, prepare, create, attach, invalid };