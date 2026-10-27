const path = require('node:path');
const { migrate } = require('./apply-rosa-schema');
const migrationFile = path.join(__dirname, '../docs/migrations/2026-10-27_rosa_treatment_history_note.sql');
const migrationId = '2026-10-27-rosa-treatment-history-note';

async function main() {
    const args = process.argv.slice(2);
    const value = flag => {
        const index = args.indexOf(flag);
        return index < 0 ? undefined : args[index + 1];
    };
    if (!process.env.DOTENV_CONFIG_PATH || !value('--db')) throw new Error('Explicit DOTENV_CONFIG_PATH and --db required.');
    require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
    if (process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3308') throw new Error('ROSA local 3308 configuration required.');
    const connection = await require('mysql2/promise').createConnection({
        host: process.env.DB_HOST, port: 3308, user: process.env.DB_USER, password: process.env.DB_PASSWORD
    });
    try {
        await migrate(connection, value('--db'), {
            apply: args.includes('--apply'), backup: value('--backup'), migrationFile, migrationId
        });
    } finally { await connection.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { migrationFile, migrationId };