const { masterPool, getTenantDbName } = require('../config/database');
const { normalizeDateOfBirth } = require('../utils/dateOfBirth');
const { paginateQuery } = require('../utils/pagination');
const storage = require('../utils/skinImageStorage');
const { error } = storage;

const id = (value, name) => {
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw error(400, `${name} không hợp lệ.`);
    return Number(value);
};
const scope = async (tenant, customer, session) => {
    if (process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3308') throw error(503, 'API ảnh chỉ được bật trên cấu hình Rosa 3308.');
    const tenantId = id(tenant, 'tenant_id');
    const customerId = id(customer, 'customerId');
    const sessionId = session === undefined ? undefined : id(session, 'sessionId');
    const db = await getTenantDbName(tenantId);
    if (!/^db_spa_[a-zA-Z0-9_]+$/.test(db)) throw error(403, 'Database tenant không hợp lệ.');
    return { db, tenantId, customerId, sessionId };
};
const customerCheck = async (executor, ctx, lock = false) => {
    const [rows] = await executor.query(`SELECT id FROM \`${ctx.db}\`.customers WHERE id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [ctx.customerId]);
    if (!rows.length) throw error(404, 'Khách hàng không tồn tại hoặc đã bị xóa.');
};
const sessionCheck = async (executor, ctx, lock = false) => {
    const [rows] = await executor.query(`SELECT id, customer_id, DATE_FORMAT(captured_date, '%Y-%m-%d') AS captured_date, note,
        created_at, updated_at, created_by, updated_by FROM \`${ctx.db}\`.customer_skin_image_sessions
        WHERE id=? AND customer_id=? AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [ctx.sessionId, ctx.customerId]);
    if (!rows.length) throw error(404, 'Lần chụp không tồn tại hoặc đã bị xóa.');
    return rows[0];
};
const preflight = async (tenant, customer, session) => {
    const ctx = await scope(tenant, customer, session);
    await customerCheck(masterPool, ctx);
    if (ctx.sessionId) await sessionCheck(masterPool, ctx);
    return ctx;
};
const metadata = (body, { required = false, append = false } = {}) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'Body phải là object.');
    const allowed = append ? [] : ['captured_date', 'note'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw error(400, 'Field không hỗ trợ; chỉ nhận captured_date và note khi tạo/sửa lần chụp.');
    const result = {};
    if (required || body.captured_date !== undefined) {
        try { result.captured_date = normalizeDateOfBirth(body.captured_date); }
        catch { throw error(400, 'captured_date phải là ngày hợp lệ YYYY-MM-DD, không ở tương lai.'); }
        if (!result.captured_date) throw error(400, 'captured_date là bắt buộc, không được null/rỗng.');
    }
    if (body.note !== undefined) {
        if (body.note !== null && typeof body.note !== 'string') throw error(400, 'note phải là chuỗi hoặc null.');
        const note = body.note?.trim() || null;
        if (note && Buffer.byteLength(note, 'utf8') > 65535) throw error(400, 'note tối đa 65535 byte UTF-8.');
        result.note = note;
    }
    return result;
};
const imageSelect = 'id, session_id, original_filename, mime_type, file_size, sort_order, note, created_at, updated_at, created_by, updated_by';
const publicImage = (ctx, image) => ({ ...image,
    file_url: `/api/customers/${ctx.customerId}/skin-image-sessions/${image.session_id}/images/${image.id}/file` });
const imagesFor = async (ctx, sessions) => {
    if (!sessions.length) return sessions;
    const [images] = await masterPool.query(`SELECT ${imageSelect} FROM \`${ctx.db}\`.customer_skin_images
        WHERE session_id IN (${sessions.map(() => '?').join(',')}) AND deleted_at IS NULL ORDER BY sort_order,id`, sessions.map(s => s.id));
    return sessions.map(s => ({ ...s, images: images.filter(i => i.session_id === s.id).map(i => publicImage(ctx, i)) }));
};
const detail = async (tenant, customer, session) => {
    const ctx = await preflight(tenant, customer, session);
    return (await imagesFor(ctx, [await sessionCheck(masterPool, ctx)]))[0];
};
const list = async (tenant, customer, filters) => {
    const ctx = await preflight(tenant, customer);
    let sql = `SELECT id, customer_id, DATE_FORMAT(captured_date, '%Y-%m-%d') AS captured_date, note,
        created_at, updated_at, created_by, updated_by FROM \`${ctx.db}\`.customer_skin_image_sessions WHERE customer_id=? AND deleted_at IS NULL`;
    const params = [ctx.customerId];
    const dates = {};
    for (const key of ['startDate', 'endDate']) {
        if (filters[key] === undefined) continue;
        try { dates[key] = normalizeDateOfBirth(filters[key]); } catch { throw error(400, `${key} không hợp lệ.`); }
        if (!dates[key]) throw error(400, `${key} không hợp lệ.`);
        sql += ` AND captured_date ${key === 'startDate' ? '>=' : '<='} ?`;
        params.push(dates[key]);
    }
    if (dates.startDate && dates.endDate && dates.startDate > dates.endDate) throw error(400, 'startDate không được sau endDate.');
    const page = await paginateQuery(masterPool, sql, params, 'captured_date DESC,id DESC', filters);
    page.data = await imagesFor(ctx, page.data);
    return page;
};

const upload = async (tenant, customer, session, body, files, actor) => {
    const ctx = await scope(tenant, customer, session);
    const data = metadata(body, { required: !ctx.sessionId, append: !!ctx.sessionId });
    if (!files?.length || files.length > storage.MAX_FILES) throw error(400, 'Mỗi lần upload cần từ 1 đến 10 ảnh.');
    const validated = [];
    for (const file of files) validated.push(await storage.validateFile(file));
    const connection = await masterPool.getConnection();
    const moved = [];
    let committed = false;
    try {
        await connection.beginTransaction();
        await customerCheck(connection, ctx, true);
        if (ctx.sessionId) await sessionCheck(connection, ctx, true);
        else {
            const [insert] = await connection.query(`INSERT INTO \`${ctx.db}\`.customer_skin_image_sessions
                (customer_id,captured_date,note,created_by) VALUES (?,?,?,?)`, [ctx.customerId, data.captured_date, data.note || null, actor]);
            ctx.sessionId = insert.insertId;
        }
        const [[last]] = await connection.query(`SELECT COALESCE(MAX(sort_order),-1) AS last_order FROM \`${ctx.db}\`.customer_skin_images WHERE session_id=?`, [ctx.sessionId]);
        let order = Number(last.last_order) + 1;
        const images = [];
        for (const file of validated) {
            const relative = storage.newRelativePath(ctx.tenantId, ctx.customerId, ctx.sessionId, file.ext);
            await storage.move(file.path, relative);
            moved.push(relative);
            const [insert] = await connection.query(`INSERT INTO \`${ctx.db}\`.customer_skin_images
                (session_id,file_path,original_filename,mime_type,file_size,sort_order,created_by) VALUES (?,?,?,?,?,?,?)`,
            [ctx.sessionId, relative, file.originalname, file.mime, file.size, order, actor]);
            images.push(publicImage(ctx, { id: insert.insertId, session_id: ctx.sessionId, original_filename: file.originalname,
                mime_type: file.mime, file_size: file.size, sort_order: order++, note: null }));
        }
        await connection.query(`UPDATE \`${ctx.db}\`.customer_skin_image_sessions SET updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [actor, ctx.sessionId]);
        await connection.commit();
        committed = true;
        return { sessionId: ctx.sessionId, images };
    } catch (cause) {
        let rolledBack = false;
        try { await connection.rollback(); rolledBack = true; } catch { /* Keep files if transaction outcome is unknown. */ }
        if (!committed && rolledBack) {
            for (const relative of moved) {
                // A commit network error can be ambiguous: do not delete files referenced by committed rows.
                try {
                    const [rows] = await masterPool.query(`SELECT id FROM \`${ctx.db}\`.customer_skin_images WHERE file_path=?`, [relative]);
                    if (!rows.length) await storage.removeFile(relative);
                } catch { console.error('Skin image reconciliation required; retained file:', relative); }
            }
        }
        throw cause;
    } finally { connection.release(); }
};

const mutate = async (tenant, customer, session, actor, action, body, image) => {
    const ctx = await scope(tenant, customer, session);
    const data = action === 'update' ? metadata(body) : {};
    const imageId = image === undefined ? undefined : id(image, 'imageId');
    const connection = await masterPool.getConnection();
    try {
        await connection.beginTransaction();
        await customerCheck(connection, ctx, true);
        await sessionCheck(connection, ctx, true);
        if (action === 'update') {
            const fields = Object.keys(data);
            if (!fields.length) throw error(400, 'Cần gửi captured_date hoặc note.');
            await connection.query(`UPDATE \`${ctx.db}\`.customer_skin_image_sessions SET ${fields.map(f => `${f}=?`).join(',')},updated_by=? WHERE id=?`, [...fields.map(f => data[f]), actor, ctx.sessionId]);
        } else {
            if (imageId) {
                const [rows] = await connection.query(`SELECT id FROM \`${ctx.db}\`.customer_skin_images WHERE id=? AND session_id=? AND deleted_at IS NULL FOR UPDATE`, [imageId, ctx.sessionId]);
                if (!rows.length) throw error(404, 'Ảnh không tồn tại hoặc đã bị xóa.');
            }
            await connection.query(`UPDATE \`${ctx.db}\`.customer_skin_images SET deleted_at=NOW(),deleted_by=?,updated_by=? WHERE session_id=? AND deleted_at IS NULL${imageId ? ' AND id=?' : ''}`, [actor, actor, ctx.sessionId, ...(imageId ? [imageId] : [])]);
            if (!imageId) await connection.query(`UPDATE \`${ctx.db}\`.customer_skin_image_sessions SET deleted_at=NOW(),deleted_by=?,updated_by=? WHERE id=?`, [actor, actor, ctx.sessionId]);
        }
        await connection.commit();
    } catch (cause) { await connection.rollback(); throw cause; }
    finally { connection.release(); }
};
const file = async (tenant, customer, session, image) => {
    const ctx = await preflight(tenant, customer, session);
    const [rows] = await masterPool.query(`SELECT file_path,mime_type FROM \`${ctx.db}\`.customer_skin_images WHERE id=? AND session_id=? AND deleted_at IS NULL`, [id(image, 'imageId'), ctx.sessionId]);
    const row = rows[0];
    const prefix = `tenants/${ctx.tenantId}/customers/${ctx.customerId}/${ctx.sessionId}/`;
    if (!row || !row.file_path.startsWith(prefix) || !['image/jpeg', 'image/png', 'image/webp'].includes(row.mime_type)) throw error(404, 'Không tìm thấy ảnh.');
    return { path: storage.resolveFile(row.file_path), mime: row.mime_type };
};
module.exports = { preflight, metadata, upload, list, detail, mutate, file };