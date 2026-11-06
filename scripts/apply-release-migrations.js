// Release migration runner. It is invoked by Deploy-SpaBackend.ps1, never by server startup.
const fs = require('node:fs');
const path = require('node:path');

const usage = 'Usage: node scripts/apply-release-migrations.js --release-path <release> --root <C:\\SpaBackend> --plan|--apply';

const parseArgs = args => {
    const options = {};
    for (let index = 0; index < args.length; index++) {
        const value = args[index];
        if (value === '--release-path' && !options.releasePath) options.releasePath = args[++index];
        else if (value === '--root' && !options.root) options.root = args[++index];
        else if (value === '--plan' && !options.mode) options.mode = 'plan';
        else if (value === '--apply' && !options.mode) options.mode = 'apply';
        else throw new Error(usage);
    }
    if (!options.releasePath || !options.root || !options.mode) throw new Error(usage);
    return options;
};

const readDotEnv = file => {
    if (!fs.existsSync(file)) throw new Error(`Missing environment file: ${file}`);
    const values = {};
    for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    return values;
};

const readManifest = releasePath => {
    const manifestPath = path.resolve(releasePath, 'scripts', 'release-migrations.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Release migration manifest is missing: ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.migrations)) throw new Error('Invalid release migration manifest.');
    const seen = new Set();
    return manifest.migrations.map(entry => {
        if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(entry.id) || typeof entry.file !== 'string' || !/^scripts\/migrations\/[A-Za-z0-9._-]+\.js$/.test(entry.file) || seen.has(entry.id)) {
            throw new Error('Invalid or duplicate release migration entry.');
        }
        seen.add(entry.id);
        const filePath = path.resolve(releasePath, entry.file);
        if (!filePath.startsWith(`${path.resolve(releasePath)}${path.sep}`) || !fs.existsSync(filePath)) throw new Error(`Migration file is missing: ${entry.file}`);
        const checksum = require('node:crypto').createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        return { id: entry.id, filePath, checksum };
    });
};

const readPolicy = root => {
    const policyPath = path.resolve(root, 'config', 'migration-policy.json');
    if (!fs.existsSync(policyPath)) throw new Error(`Migration policy is required when a release contains migrations: ${policyPath}`);
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    if (!policy || policy.enabled !== true || !Array.isArray(policy.targets) || !policy.targets.length) throw new Error('Migration policy must enable migrations and specify one or more targets.');
    const targets = [...new Set(policy.targets)];
    if (targets.some(target => typeof target !== 'string' || !(target === 'db_spa_template' || /^db_spa_[A-Za-z0-9_]+$/.test(target)))) throw new Error('Migration policy contains an unsafe target database name.');
    return { targets };
};

const quoteIdentifier = value => `\`${value.replace(/`/g, '``')}\``;

const listApplied = async (connection, database) => {
    const [tables] = await connection.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [database, 'spa_backend_schema_migrations']);
    if (!tables.length) return new Map();
    const [rows] = await connection.query(`SELECT migration_id, checksum FROM ${quoteIdentifier(database)}.spa_backend_schema_migrations`);
    return new Map(rows.map(row => [row.migration_id, row.checksum]));
};

const assertTarget = async (connection, database) => {
    const [schemas] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if (!schemas.length) throw new Error(`Migration target does not exist: ${database}`);
    if (database === 'db_spa_template') return;
    const [tenants] = await connection.query('SELECT id FROM db_system_master.tenants WHERE database_name = ?', [database]);
    if (tenants.length !== 1) throw new Error(`Migration target is not exactly one registered tenant: ${database}`);
};

const pendingForTarget = async (connection, database, migrations) => {
    await assertTarget(connection, database);
    const applied = await listApplied(connection, database);
    return migrations.filter(migration => {
        const oldChecksum = applied.get(migration.id);
        if (oldChecksum && oldChecksum !== migration.checksum) throw new Error(`Applied migration checksum differs for ${database}/${migration.id}; manual review required.`);
        return !oldChecksum;
    });
};

const ensureLedger = async (connection, database) => {
    await connection.query(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(database)}.spa_backend_schema_migrations (
        migration_id VARCHAR(120) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (migration_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
};

const applyTarget = async (connection, database, migrations) => {
    const lockName = `spa-release-migrations:${database}`;
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    if (Number(lock.acquired) !== 1) throw new Error(`Another migration is running for ${database}.`);
    try {
        const pending = await pendingForTarget(connection, database, migrations);
        if (!pending.length) return [];
        await ensureLedger(connection, database);
        const applied = [];
        for (const migration of pending) {
            const modulePath = require.resolve(migration.filePath);
            delete require.cache[modulePath];
            const migrationModule = require(modulePath);
            if (!migrationModule || migrationModule.id !== migration.id || typeof migrationModule.up !== 'function' || typeof migrationModule.verify !== 'function') {
                throw new Error(`Migration module ${migration.id} must export id, up and verify.`);
            }
            await migrationModule.up(connection, { database, quoteIdentifier });
            await migrationModule.verify(connection, { database, quoteIdentifier });
            await connection.query(`INSERT INTO ${quoteIdentifier(database)}.spa_backend_schema_migrations (migration_id, checksum) VALUES (?, ?)`, [migration.id, migration.checksum]);
            applied.push(migration.id);
        }
        return applied;
    } finally {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    }
};

const run = async (options, dependencies = {}) => {
    const migrations = readManifest(options.releasePath);
    if (!migrations.length) return { requiresMigration: false, targets: [] };
    const policy = readPolicy(options.root);
    const env = readDotEnv(path.resolve(options.root, 'config', '.env'));
    for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_SYSTEM_NAME']) if (!env[key]) throw new Error(`Missing ${key} in deployment environment.`);
    const mysql = dependencies.mysql || require(path.resolve(options.releasePath, 'node_modules', 'mysql2', 'promise'));
    const connection = await mysql.createConnection({ host: env.DB_HOST, port: env.DB_PORT ? Number(env.DB_PORT) : 3306, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_SYSTEM_NAME });
    try {
        const targets = [];
        for (const database of policy.targets) {
            const pending = await pendingForTarget(connection, database, migrations);
            targets.push({ database, pending: pending.map(migration => migration.id) });
        }
        if (options.mode === 'plan') return { requiresMigration: targets.some(target => target.pending.length), targets };
        const applied = [];
        for (const target of targets) applied.push({ database: target.database, applied: await applyTarget(connection, target.database, migrations) });
        return { requiresMigration: applied.some(target => target.applied.length), targets: applied };
    } finally {
        await connection.end();
    }
};

if (require.main === module) {
    run(parseArgs(process.argv.slice(2))).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { parseArgs, readManifest, readPolicy, run };