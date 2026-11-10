const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, readManifest, run } = require('../scripts/apply-release-migrations');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-release-migrations-'));
(async () => {
try {
    fs.mkdirSync(path.join(root, 'scripts', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'release-migrations.json'), JSON.stringify({ version: 1, migrations: [] }));
    assert.deepEqual(readManifest(root), []);
    assert.deepEqual(await run({ releasePath: root, root, mode: 'plan' }), { requiresMigration: false, targets: [] });
    assert.deepEqual(parseArgs(['--release-path', 'release', '--root', 'root', '--plan']), { releasePath: 'release', root: 'root', mode: 'plan' });
    assert.throws(() => parseArgs(['--release-path', 'release', '--root', 'root']), /Usage/);
    fs.writeFileSync(path.join(root, 'scripts', 'release-migrations.json'), JSON.stringify({ version: 1, migrations: [{ id: 'bad', file: '../unsafe.js' }] }));
    assert.throws(() => readManifest(root), /Invalid/);
    const productionManifest = readManifest(path.resolve(__dirname, '..'));
    assert.deepEqual(productionManifest.map(migration => migration.id), [
        '2026-11-06-xuly-customer-bookings',
        '2026-11-07-xuly-treatment-groups',
        '2026-11-08-xuly-treatment-history-groups',
    ]);
    for (const migration of productionManifest) {
        const module = require(migration.filePath);
        assert.equal(module.id, migration.id);
        assert.equal(typeof module.up, 'function');
        assert.equal(typeof module.verify, 'function');
    }
    const backupScript = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'windows', 'Backup-SpaDatabase.ps1'), 'utf8');
    assert.match(backupScript, /Join-Path \$Root 'runtime\\mysql\\bin'/);
    assert.match(backupScript, /\[string\]\$MySqlBin,/);
    console.log('PASS: release migration manifest and CLI validation');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
})().catch(error => { console.error(error); process.exitCode = 1; });