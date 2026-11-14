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
        '2026-11-11-rosa-active-profile-code',
        '2026-11-11-rosa-treatment-history-groups',
        '2026-11-11-rosa-treatment-purchases'
    ]);
    for (const migration of productionManifest) {
        const module = require(migration.filePath);
        assert.equal(module.id, migration.id);
        assert.equal(typeof module.up, 'function');
        assert.equal(typeof module.verify, 'function');
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config', 'migration-policy.seed.json'), 'utf8')).targets,
        ['db_spa_template', 'db_spa_1793769062857_7de6', 'db_spa_1793766879802_b38d']);
    console.log('PASS: release migration manifest and CLI validation');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
})().catch(error => { console.error(error); process.exitCode = 1; });