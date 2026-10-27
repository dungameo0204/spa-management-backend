const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { migrate, statements } = require('../scripts/apply-rosa-schema');
const { migrationFile, migrationId } = require('../scripts/apply-rosa-image-sessions');

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rosa-image-migration-'));
    const dump = path.join(dir, 'backup.sql');
    const backup = path.join(dir, 'manifest.json');
    fs.writeFileSync(dump, 'test backup');
    fs.writeFileSync(backup, JSON.stringify({ port: 3308, databases: ['db_spa_template'], dump,
        sha256: crypto.createHash('sha256').update('test backup').digest('hex') }));
    const ledger = new Map();
    const executed = [];
    let port = 3308;
    const connection = { query: async (sql, params = []) => {
        if (sql.includes('@@port')) return [[{ port }]];
        if (sql.includes('information_schema.COLUMNS')) return [[
            ['customers', 'date_of_birth'], ['products', 'sale_price'], ['treatments', 'invoice_item_id'],
            ['treatment_history', 'created_at'], ['customer_bookings', 'booking_time']
        ].map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }))];
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (sql.startsWith('SELECT checksum')) return [ledger.has(params[0]) ? [{ checksum: ledger.get(params[0]) }] : []];
        if (sql.startsWith('INSERT INTO rosa_schema_migrations')) { ledger.set(params[0], params[1]); return [{}]; }
        if (statements(migrationFile).includes(sql)) executed.push(sql);
        return [{}];
    } };
    const options = { apply: true, backup, migrationFile, migrationId };
    try {
        await migrate(connection, 'db_spa_template', { ...options, apply: false });
        assert.equal(executed.length, 0);
        port = 3306;
        await assert.rejects(migrate(connection, 'db_spa_template', options), /guard/);
        port = 3308;
        await assert.rejects(migrate(connection, 'other_tenant', options), /guard/);
        await migrate(connection, 'db_spa_template', options);
        assert.equal(executed.length, 5);
        await migrate(connection, 'db_spa_template', options);
        assert.equal(executed.length, 5, 'rerun must skip all completed steps');
        ledger.set(`${migrationId}:1`, 'changed');
        await assert.rejects(migrate(connection, 'db_spa_template', options), /checksum mismatch/);
        assert.match(executed[2], /SELECT id, customer_id, captured_date/);
        assert.doesNotMatch(executed[2], /GROUP BY/);
        assert.match(executed[3], /updated_at = updated_at/);
        assert.match(executed[4], /MODIFY COLUMN session_id INT NOT NULL/);
        assert.match(executed[4], /FOREIGN KEY \(session_id\)/);
        fs.writeFileSync(dump, 'tampered');
        await assert.rejects(migrate(connection, 'db_spa_template', options), /backup/);
        console.log('PASS: image-session migration dry run, endpoint allowlist, checksums, rerun, backup integrity and legacy mapping SQL.');
    } finally {
        fs.unlinkSync(dump);
        fs.unlinkSync(backup);
        fs.rmdirSync(dir);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });