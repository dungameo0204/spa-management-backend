// Explicit operator-run migration. Importing this module never opens a connection.
const fs = require('node:fs');
const path = require('node:path');

const parseArgs = args => {
    const options = { apply: false, backupConfirmed: false };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--db' && !options.db) options.db = args[++i];
        else if (args[i] === '--apply' && !options.apply) options.apply = true;
        else if (args[i] === '--backup-confirmed' && !options.backupConfirmed) options.backupConfirmed = true;
        else throw new Error('Unknown or duplicate argument.');
    }
    if (!/^db_spa_[a-zA-Z0-9_]+$/.test(options.db || '') || (options.apply && !options.backupConfirmed)) {
        throw new Error('Usage: node scripts/apply-customer-upgrade.js --db db_spa_... [--apply --backup-confirmed]');
    }
    return options;
};

const expectedSchema = () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../db_spa_template.sql'), 'utf8');
    const result = [];
    for (const table of sql.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=/g)) {
        for (const column of table[2].matchAll(/^\s*`([^`]+)`\s/gm)) {
            if ((table[1] === 'customers' && column[1] === 'date_of_birth') || (table[1] === 'products' && column[1] === 'sale_price')) continue;
            result.push(`${table[1]}.${column[1]}`);
        }
    }
    if (result.length < 50) throw new Error('Cannot read prerequisite schema; inspect template parser.');
    return result;
};

const inspect = async (connection, db) => {
    const [rows] = await connection.query(
        'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [db]);
    const columns = new Map(rows.map(row => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]));
    const missing = expectedSchema().filter(key => !columns.has(key));
    if (missing.length) throw new Error(`Missing prerequisite schema (review earlier migrations): ${missing.join(', ')}`);
    const dob = columns.get('customers.date_of_birth');
    const sale = columns.get('products.sale_price');
    if (dob && (dob.DATA_TYPE !== 'date' || dob.IS_NULLABLE !== 'YES' || dob.COLUMN_DEFAULT !== null || dob.EXTRA)) throw new Error('Incompatible customers.date_of_birth; manual review required.');
    if (sale && (sale.COLUMN_TYPE.toLowerCase() !== 'decimal(15,2)' || sale.EXTRA)) throw new Error('Incompatible products.sale_price; manual review required.');
    return { dob, sale };
};

const migrate = async (connection, { db, apply, backupConfirmed }, log = console.log) => {
    if (!/^db_spa_[a-zA-Z0-9_]+$/.test(db || '') || (apply && !backupConfirmed)) throw new Error('Invalid target or missing backup confirmation.');
    const [schemas] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [db]);
    if (!schemas.length) throw new Error(`Database ${db} does not exist.`);
    if (db !== 'db_spa_template') {
        const [tenants] = await connection.query('SELECT id FROM db_system_master.tenants WHERE database_name = ?', [db]);
        if (tenants.length !== 1) throw new Error('Target must belong to exactly one registered tenant.');
    }
    const target = `\`${db}\``;
    const lockName = `spa-upgrade:${db}`;
    if (lockName.length > 64) throw new Error('Target name too long for migration lock.');
    let locked = false;
    try {
        if (apply) {
            const [[lock]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
            if (Number(lock.acquired) !== 1) throw new Error('Another migration is running.');
            locked = true;
        }
        let state = await inspect(connection, db);
        log(`Target ${db}: DOB ${state.dob ? 'present' : 'missing'}, sale_price ${state.sale ? state.sale.IS_NULLABLE === 'YES' ? 'nullable/partial' : 'present' : 'missing'}`);
        if (state.sale) {
            const [[counts]] = await connection.query(`SELECT COUNT(*) AS total, SUM(sale_price IS NULL) AS null_prices, SUM(sale_price >= price) AS legacy_pairs FROM ${target}.products`);
            log(`Products: ${counts.total}; NULL sale prices: ${Number(counts.null_prices)}; existing sale_price >= price: ${Number(counts.legacy_pairs)} (preserved).`);
        }
        if (!apply) {
            log('DRY RUN only. Stop writes/tenant creation, verify backup, then use --apply --backup-confirmed. No schema or data changed.');
            return;
        }
        // DDL implicitly commits. An interrupted run can resume only from compatible states above.
        if (!state.dob) await connection.query(`ALTER TABLE ${target}.customers ADD COLUMN date_of_birth DATE NULL AFTER phone_number`);
        if (!state.sale) await connection.query(`ALTER TABLE ${target}.products ADD COLUMN sale_price DECIMAL(15,2) NULL AFTER price`);
        state = await inspect(connection, db);
        if (state.sale.IS_NULLABLE === 'YES') {
            const [[settings]] = await connection.query('SELECT @@SESSION.SQL_SAFE_UPDATES AS safe_updates');
            try {
                await connection.query('SET SESSION SQL_SAFE_UPDATES = 0');
                await connection.query(`UPDATE ${target}.products SET sale_price = price WHERE sale_price IS NULL`);
            } finally {
                await connection.query(`SET SESSION SQL_SAFE_UPDATES = ${Number(settings.safe_updates) === 1 ? 1 : 0}`);
            }
            const [[counts]] = await connection.query(`SELECT COUNT(*) AS total FROM ${target}.products WHERE sale_price IS NULL`);
            if (Number(counts.total)) throw new Error('NULL prices remain; inspect products.price before continuing.');
            await connection.query(`ALTER TABLE ${target}.products MODIFY COLUMN sale_price DECIMAL(15,2) NOT NULL`);
        }
        state = await inspect(connection, db);
        if (!state.dob || !state.sale || state.sale.IS_NULLABLE !== 'NO') throw new Error('Post-migration verification failed.');
        log('Upgrade verified. No existing non-NULL selling prices or session counts changed.');
    } finally {
        if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    }
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    require('dotenv').config();
    const port = Number(process.env.DB_PORT || 3306);
    if (!process.env.DB_HOST || !process.env.DB_USER || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Explicit DB_HOST, DB_USER and valid DB_PORT configuration required.');
    console.log(`Endpoint: ${process.env.DB_HOST}:${port}; target: ${options.db}; mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);
    const connection = await require('mysql2/promise').createConnection({
        host: process.env.DB_HOST, port, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        multipleStatements: false
    });
    try { await migrate(connection, options); } finally { await connection.end(); }
};

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, expectedSchema, inspect, migrate };