const express = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const { verifyToken } = require('../middlewares/auth');
const service = require('../services/skinImageService');
const storage = require('../utils/skinImageStorage');
const router = express.Router({ mergeParams: true });
const sendError = (res, cause) => {
    const status = cause.status || 500;
    if (status >= 500) console.error('Skin image operation failed:', cause.code || cause.message);
    return res.status(status).json({ message: status >= 500 ? 'Không thể xử lý ảnh lúc này. Vui lòng thử lại.' : cause.message });
};
router.use(verifyToken, (req, res, next) => {
    if (req.user.customer_id !== undefined || !['MANAGER', 'STAFF'].includes(req.user.system_role) ||
        !Number.isSafeInteger(req.user.tenant_id) || req.user.tenant_id <= 0) {
        return res.status(403).json({ message: 'Chỉ MANAGER/STAFF của Spa được truy cập ảnh khách hàng.' });
    }
    next();
});
const actor = req => req.user.fullname || req.user.username || req.user.system_role;
const params = req => [req.user.tenant_id, req.params.customerId];
let activeUploads = 0;

const multipart = multer({
    storage: multer.diskStorage({
        destination: (req, _file, cb) => cb(null, req.skinTemp),
        filename: (_req, _file, cb) => cb(null, randomUUID())
    }),
    limits: { fileSize: storage.MAX_FILE_SIZE, files: storage.MAX_FILES, fields: 2, parts: 13,
        fieldSize: 65535, fieldNameSize: 50, headerPairs: 100, fieldNestingDepth: 0 },
    fileFilter: (_req, file, cb) => cb(['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
        ? null : storage.error(400, 'Chỉ nhận ảnh JPEG, PNG, WebP.'), true)
}).array('images', storage.MAX_FILES);

const receive = async (req, res) => {
    if (activeUploads >= 4) return res.status(429).json({ message: 'Đang có nhiều lượt upload; vui lòng thử lại sau.' });
    activeUploads++;
    let result;
    let failure;
    try {
        await service.preflight(...params(req), req.params.sessionId);
        if (!req.is('multipart/form-data')) throw storage.error(415, 'Upload phải dùng multipart/form-data, field images.');
        req.skinTemp = await storage.createTemp();
        // Limit stalled requests; stale cleanup uses a much longer 24-hour threshold.
        req.setTimeout(2 * 60 * 1000, () => req.destroy());
        await new Promise((resolve, reject) => multipart(req, res, cause => cause ? reject(cause) : resolve()));
        result = await service.upload(...params(req), req.params.sessionId, req.body, req.files, actor(req));
    } catch (cause) {
        if (cause instanceof multer.MulterError) {
            cause.status = cause.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            cause.message = cause.code === 'LIMIT_FILE_SIZE' ? 'Mỗi ảnh tối đa 10 MiB.' : 'Multipart không hợp lệ: tối đa 10 ảnh, field images, tối đa 2 text field.';
        } else if (!cause.status && /multipart|boundary|unexpected end/i.test(cause.message)) {
            cause.status = 400;
            cause.message = 'Dữ liệu multipart không hợp lệ hoặc upload bị gián đoạn.';
        }
        failure = cause;
    } finally {
        try { await storage.cleanup(req.skinTemp); }
        catch (cause) { console.error('Skin upload temporary cleanup failed:', cause.code || cause.message); }
        req.setTimeout(0);
        activeUploads--;
    }
    if (failure && !res.destroyed) return sendError(res, failure);
    if (result && !res.destroyed) res.status(201).json({ message: 'Upload ảnh thành công', data: result });
};
router.post('/', receive);
router.post('/:sessionId/images', receive);
router.get('/', async (req, res) => {
    try { res.json({ message: 'Lấy danh sách lần chụp thành công', ...await service.list(...params(req), req.query) }); }
    catch (cause) { sendError(res, cause); }
});
router.get('/:sessionId', async (req, res) => {
    try { res.json({ message: 'Lấy lần chụp thành công', data: await service.detail(...params(req), req.params.sessionId) }); }
    catch (cause) { sendError(res, cause); }
});
router.put('/:sessionId', async (req, res) => {
    try {
        await service.mutate(...params(req), req.params.sessionId, actor(req), 'update', req.body);
        res.json({ message: 'Cập nhật lần chụp thành công' });
    } catch (cause) { sendError(res, cause); }
});
router.delete('/:sessionId', async (req, res) => {
    try {
        await service.mutate(...params(req), req.params.sessionId, actor(req), 'delete');
        res.json({ message: 'Xóa lần chụp thành công' });
    } catch (cause) { sendError(res, cause); }
});
router.delete('/:sessionId/images/:imageId', async (req, res) => {
    try {
        await service.mutate(...params(req), req.params.sessionId, actor(req), 'delete', undefined, req.params.imageId);
        res.json({ message: 'Xóa ảnh thành công' });
    } catch (cause) { sendError(res, cause); }
});
router.get('/:sessionId/images/:imageId/file', async (req, res) => {
    try {
        const file = await service.file(...params(req), req.params.sessionId, req.params.imageId);
        res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Type': file.mime, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" });
        res.sendFile(file.path, { dotfiles: 'deny', cacheControl: false }, cause => {
            if (!cause) return;
            if (res.headersSent) { res.destroy(); return; }
            sendError(res, cause.code === 'ENOENT' ? storage.error(404, 'Không tìm thấy file ảnh.') : cause);
        });
    } catch (cause) { sendError(res, cause); }
});
module.exports = router;