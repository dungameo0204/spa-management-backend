const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const error = (status, message) => Object.assign(new Error(message), { status });
const root = () => {
    if (!process.env.UPLOAD_ROOT || !path.isAbsolute(process.env.UPLOAD_ROOT)) {
        throw error(503, 'Chưa cấu hình UPLOAD_ROOT là đường dẫn tuyệt đối.');
    }
    return path.resolve(process.env.UPLOAD_ROOT);
};
const resolveFile = relative => {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..')) {
        throw error(404, 'Không tìm thấy ảnh.');
    }
    const target = path.resolve(root(), relative);
    if (!target.startsWith(root() + path.sep)) throw error(404, 'Không tìm thấy ảnh.');
    return target;
};
const cleanup = async directory => {
    if (!directory) return;
    // Only request-owned temporary directories can be removed recursively.
    const temp = path.join(root(), '.tmp') + path.sep;
    if (!directory.startsWith(temp) || !/^upload-[a-zA-Z0-9_-]+$/.test(path.basename(directory))) {
        throw error(500, 'Đường dẫn tạm không hợp lệ.');
    }
    await fs.rm(directory, { recursive: true, force: true });
};
const cleanupStale = async () => {
    const temp = path.join(root(), '.tmp');
    await fs.mkdir(temp, { recursive: true });
    for (const entry of await fs.readdir(temp, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^upload-[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
        const directory = path.join(temp, entry.name);
        if ((await fs.stat(directory)).mtimeMs < Date.now() - 24 * 60 * 60 * 1000) await cleanup(directory);
    }
};
const createTemp = async () => {
    const temp = path.join(root(), '.tmp');
    await fs.mkdir(temp, { recursive: true });
    return fs.mkdtemp(path.join(temp, 'upload-'));
};

// Signature/container checks only, not an image decoder or malware scanner.
const validateFile = async file => {
    const bytes = await fs.readFile(file.path); // bounded to 10 MiB by multipart limits
    let type;
    if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
        bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' &&
        bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') {
        type = { mime: 'image/png', ext: 'png' };
    } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
        type = { mime: 'image/jpeg', ext: 'jpg' };
    } else if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' &&
        ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16)) && bytes.readUInt32LE(4) + 8 === bytes.length) {
        type = { mime: 'image/webp', ext: 'webp' };
    }
    if (!type || file.mimetype !== type.mime) throw error(400, 'Nội dung file không khớp ảnh JPEG, PNG hoặc WebP hợp lệ.');
    if (!bytes.length || bytes.length > MAX_FILE_SIZE) throw error(413, 'Mỗi ảnh tối đa 10 MiB.');
    return { ...file, ...type, size: bytes.length, originalname: Array.from(path.basename(file.originalname).replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 255).join('') };
};
const newRelativePath = (tenant, customer, session, ext) =>
    `tenants/${tenant}/customers/${customer}/${session}/${randomUUID()}.${ext}`;
const move = async (source, relative) => {
    const target = resolveFile(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
};
const removeFile = relative => fs.rm(resolveFile(relative), { force: true });
module.exports = { MAX_FILES, MAX_FILE_SIZE, error, root, resolveFile, cleanup, cleanupStale, createTemp, validateFile, newRelativePath, move, removeFile };