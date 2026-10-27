const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
async function main() {
    assert.ok(process.env.DOTENV_CONFIG_PATH, 'Explicit Rosa configuration required');
    assert.equal(process.env.DB_HOST, '127.0.0.1');
    assert.equal(process.env.DB_PORT, '3308');
    const connection = await require('mysql2/promise').createConnection({
        host: process.env.DB_HOST, port: 3308, user: process.env.DB_USER, password: process.env.DB_PASSWORD
    });
    try {
        assert.equal(Number((await connection.query('SELECT @@port AS port'))[0][0].port), 3308);
        const manifest = JSON.parse(fs.readFileSync('D:/SpaRosa/backups/pre-treatment-history-note-manifest.json', 'utf8'));
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(manifest.dump)).digest('hex'), manifest.sha256);
        for (const db of ['db_spa_template', 'db_spa_1791039769068_e185']) {
            const [[column]] = await connection.query(`SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA=? AND TABLE_NAME='treatment_history' AND COLUMN_NAME='note'`, [db]);
            assert.deepEqual(column, { COLUMN_TYPE: 'text', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null });
            const [rows] = await connection.query(`SELECT * FROM \`${db}\`.treatment_history ORDER BY id`);
            assert.equal(rows.length, manifest.histories[db].count);
            for (const row of rows) { assert.equal(row.note, null); delete row.note; }
            assert.equal(crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'), manifest.histories[db].sha256);
            const [ledger] = await connection.query(`SELECT step_id FROM \`${db}\`.rosa_schema_migrations WHERE step_id=?`, ['2026-10-27-rosa-treatment-history-note:1']);
            assert.equal(ledger.length, 1);
            if (rows.length) {
                await connection.beginTransaction();
                try {
                    const note = 'Ghi chú mỗi buổi: da hơi đỏ, lưu ý theo dõi.';
                    await connection.query(`UPDATE \`${db}\`.treatment_history SET note=? WHERE id=?`, [note, rows[0].id]);
                    const [[saved]] = await connection.query(`SELECT note FROM \`${db}\`.treatment_history WHERE id=?`, [rows[0].id]);
                    assert.equal(saved.note, note);
                } finally { await connection.rollback(); }
                const [[restored]] = await connection.query(`SELECT note FROM \`${db}\`.treatment_history WHERE id=?`, [rows[0].id]);
                assert.equal(restored.note, null);
            }
            console.log(`PASS ${db}: note TEXT NULL; ${rows.length} pre-migration rows unchanged; migration ledger verified.`);
        }
        console.log('PASS: backup integrity and Vietnamese note write/read with rollback (3308 only).');
    } finally { await connection.end(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });