const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const storage = require('../src/utils/skinImageStorage');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function main() {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'rosa-storage-test-'));
    process.env.UPLOAD_ROOT = temp;
    try {
        for (const value of ['../escape', '/etc/passwd', 'C:\\private', 'tenants/../secret', 'tenants//secret']) {
            assert.throws(() => storage.resolveFile(value), error => error.status === 404);
        }
        const directory = await storage.createTemp();
        const file = path.join(directory, 'test');
        await fs.writeFile(file, png);
        const input = { path: file, mimetype: 'image/png', originalname: '../test.png' };
        assert.equal((await storage.validateFile(input)).ext, 'png');
        assert.equal((await storage.validateFile(input)).originalname, 'test.png');
        await assert.rejects(storage.validateFile({ ...input, mimetype: 'image/jpeg' }), /không khớp/);
        await fs.writeFile(file, '<svg onload="alert(1)"></svg>');
        await assert.rejects(storage.validateFile(input), /không khớp/);
        await storage.cleanup(directory);
        await assert.rejects(storage.cleanup(temp), /không hợp lệ/);
        const old = await storage.createTemp();
        const recent = await storage.createTemp();
        const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
        await fs.utimes(old, yesterday, yesterday);
        await storage.cleanupStale();
        await assert.rejects(fs.stat(old), error => error.code === 'ENOENT');
        assert.ok((await fs.stat(recent)).isDirectory());
        await storage.cleanup(recent);
        console.log('PASS: storage traversal guards, signatures/MIME, temporary cleanup ownership and stale cleanup.');
    } finally {
        // Exact directory was created above and contains test fixtures only.
        await fs.rm(temp, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });