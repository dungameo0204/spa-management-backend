// Explicit allowlist, port guard, backup hash and per-step ledger. No implicit .env fallback.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const migrationPath = path.join(__dirname, '../docs/migrations/2026-10-27_rosa_profiles_treatments.sql');
const targets = ['db_spa_template', 'db_spa_1791039769068_e185'];
const statements = (file = migrationPath) => fs.readFileSync(file, 'utf8').replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

const migrate = async (connection, db, { apply = false, backup, migrationFile = migrationPath, migrationId = '2026-10-27-rosa' } = {}) => {
    const [[endpoint]] = await connection.query('SELECT @@port AS port');
    if (Number(endpoint.port) !== 3308 || !targets.includes(db)) throw new Error('ROSA endpoint/target guard failed.');
    const [columns] = await connection.query('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [db]);
    const present = new Set(columns.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
    for (const required of ['customers.date_of_birth', 'products.sale_price', 'treatments.invoice_item_id', 'treatment_history.created_at', 'customer_bookings.booking_time']) {
        if (!present.has(required)) throw new Error(`Prerequisite missing: ${db}.${required}`);
    }
    const steps = statements(migrationFile);
    if (!apply) { console.log(`DRY RUN: ${db}, ${steps.length} steps; no changes.`); return; }
    const manifest = JSON.parse(fs.readFileSync(backup, 'utf8'));
    if (manifest.port !== 3308 || !manifest.databases.includes(db) || hash(fs.readFileSync(manifest.dump)) !== manifest.sha256) throw new Error('Invalid ROSA backup manifest/hash.');
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [`rosa-schema:${db}`]);
    if (Number(lock.acquired) !== 1) throw new Error('Migration already running.');
    try {
        await connection.query('USE ??', [db]);
        await connection.query(`CREATE TABLE IF NOT EXISTS rosa_schema_migrations (
            step_id VARCHAR(100) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB`);
        for (const [index, sql] of steps.entries()) {
            const id = `${migrationId}:${index + 1}`;
            const checksum = hash(sql);
            const [done] = await connection.query('SELECT checksum FROM rosa_schema_migrations WHERE step_id = ?', [id]);
            if (done.length) {
                if (done[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${id}`);
                continue;
            }
            // An interruption between DDL and ledger insert requires operator review, not blind rerun.
            await connection.query(sql);
            await connection.query('INSERT INTO rosa_schema_migrations (step_id, checksum) VALUES (?, ?)', [id, checksum]);
            console.log(`${db}: step ${index + 1}/${steps.length} applied.`);
        }
    } finally { await connection.query('SELECT RELEASE_LOCK(?)', [`rosa-schema:${db}`]); }
};

async function main() {
    const args = process.argv.slice(2);
    const dbIndex = args.indexOf('--db');
    const backupIndex = args.indexOf('--backup');
    const db = args[dbIndex + 1];
    if (dbIndex < 0 || !process.env.DOTENV_CONFIG_PATH) throw new Error('Explicit DOTENV_CONFIG_PATH and --db required.');
    require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
    if (process.env.DB_PORT !== '3308' || process.env.DB_HOST !== '127.0.0.1') throw new Error('ROSA configuration required.');
    const connection = await require('mysql2/promise').createConnection({ host: process.env.DB_HOST, port: 3308, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    try { await migrate(connection, db, { apply: args.includes('--apply'), backup: backupIndex < 0 ? undefined : args[backupIndex + 1] }); }
    finally { await connection.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { migrate, statements, targets };