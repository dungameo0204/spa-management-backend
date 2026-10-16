// Apply the commission migration to ONE explicitly selected local database.
// Default mode only inspects; --apply performs DDL and backfill after a backup.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const migrationFile = path.resolve(__dirname, '../docs/migrations/2026-10-16_commission_by_invoice_item.sql');
const expectedColumns = ['invoice_item_id', 'commission_base_price', 'commission_quantity'];

const getStatements = () => {
    const sql = fs.readFileSync(migrationFile, 'utf8').replace(/^\s*--[^\r\n]*$/gm, '');
    const statements = sql.split(';').map(part => part.trim()).filter(Boolean);
    const ddl = statements.filter(statement => /^(CREATE TABLE product_commission_tiers|ALTER TABLE treatments)\b/i.test(statement));
    const updates = statements.filter(statement => /^UPDATE\s+(treatments|treatment_history_staffs)\b/i.test(statement));
    if (ddl.length !== 2 || updates.length !== 2) throw new Error('Migration SQL đã thay đổi; kiểm tra lại runner trước khi áp dụng.');
    return { ddl, updates };
};

const inspect = async (connection, db) => {
    const [tables] = await connection.query(
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [db, 'product_commission_tiers']
    );
    const [columns] = await connection.query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?, ?)',
        [db, 'treatments', ...expectedColumns]
    );
    return { tierTable: tables.length === 1, columns: columns.map(row => row.COLUMN_NAME) };
};

const main = async () => {
    const args = process.argv.slice(2);
    const dbIndex = args.indexOf('--db');
    const db = dbIndex >= 0 ? args[dbIndex + 1] : null;
    if (!db || !/^db_spa_[a-zA-Z0-9_]+$/.test(db) || args.some(arg => !['--db', '--apply', db].includes(arg))) {
        throw new Error('Cách dùng: node scripts/apply-commission-migration.js --db db_spa_... [--apply]');
    }
    const apply = args.includes('--apply');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        database: process.env.DB_SYSTEM_NAME, multipleStatements: false
    });
    try {
        const [schemas] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [db]);
        if (!schemas.length) throw new Error(`Database ${db} không tồn tại.`);
        if (db !== 'db_spa_template') {
            const [tenants] = await connection.query('SELECT id FROM db_system_master.tenants WHERE database_name = ?', [db]);
            if (!tenants.length) throw new Error(`${db} không có trong db_system_master.tenants; không tự sửa DB rác/chưa đăng ký.`);
        }
        const state = await inspect(connection, db);
        const existing = expectedColumns.filter(col => state.columns.includes(col));
        console.log(`Target: ${db}; tier table: ${state.tierTable}; treatment columns: ${existing.join(', ') || '(none)'}`);
        if (state.tierTable && existing.length === expectedColumns.length) {
            console.log('Schema đã có đầy đủ; KHÔNG chạy lại migration. Kiểm tra dữ liệu đối soát riêng.');
            return;
        }
        if (state.tierTable || existing.length) {
            throw new Error('Schema đang cập nhật dở dang. Dừng để kiểm tra thủ công; không chạy lại DDL hoặc backfill tự động.');
        }
        if (!apply) {
            console.log('DRY RUN: chưa thay đổi database. Sao lưu DB, dừng ghi dữ liệu, rồi chạy lại với --apply.');
            return;
        }
        const { ddl, updates } = getStatements();
        // DDL commits implicitly in MySQL. Failures require manual inspection, not a blind rerun.
        await connection.query(`USE \`${db}\``);
        for (const statement of ddl) await connection.query(statement);
        const [[{ safe_updates }]] = await connection.query('SELECT @@SESSION.SQL_SAFE_UPDATES AS safe_updates');
        try {
            await connection.query('SET SESSION SQL_SAFE_UPDATES = 0');
            for (const statement of updates) await connection.query(statement);
        } finally {
            await connection.query(`SET SESSION SQL_SAFE_UPDATES = ${Number(safe_updates) === 1 ? 1 : 0}`);
        }
        const finalState = await inspect(connection, db);
        if (!finalState.tierTable || finalState.columns.length !== expectedColumns.length) throw new Error('Schema chưa đầy đủ sau khi chạy.');
        const [badLinks] = await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.treatments t JOIN \`${db}\`.invoice_items ii ON ii.id = t.invoice_item_id WHERE t.invoice_id <> ii.invoice_id OR t.product_id <> ii.product_id`);
        const [unresolved] = await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.treatments WHERE deleted_at IS NULL AND invoice_item_id IS NULL`);
        console.log(`Migration hoàn tất. Liên kết sai: ${badLinks[0].total}; thẻ cần đối soát (gồm thẻ thủ công): ${unresolved[0].total}.`);
    } finally {
        await connection.end();
    }
};

main().catch(error => { console.error(error.message); process.exitCode = 1; });