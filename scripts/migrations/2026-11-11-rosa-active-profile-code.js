const id = '2026-11-11-rosa-active-profile-code';

const exists = async (connection, sql, params) => Number((await connection.query(sql, params))[0][0].present) > 0;
const columnExists = (connection, database, column) => exists(connection,
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?', [database, 'customers', column]);
const indexExists = (connection, database, index) => exists(connection,
    'SELECT COUNT(*) AS present FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?', [database, 'customers', index]);
const quote = database => `\`${database.replace(/`/g, '``')}\`.\`customers\``;

const up = async (connection, { database }) => {
    const customers = quote(database);
    // Legacy tenants created before Rosa profiles do not have a profile code to migrate.
    if (!await columnExists(connection, database, 'profile_code')) return;
    const [duplicates] = await connection.query(`SELECT profile_code FROM ${customers}
        WHERE deleted_at IS NULL AND profile_code IS NOT NULL
        GROUP BY profile_code HAVING COUNT(*) > 1 LIMIT 1`);
    if (duplicates.length) throw new Error(`Active customer profile_code is duplicated and must be reconciled before migration: ${duplicates[0].profile_code}`);
    if (!await columnExists(connection, database, 'active_profile_code')) {
        await connection.query(`ALTER TABLE ${customers} ADD COLUMN active_profile_code VARCHAR(50)
            CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
            GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN profile_code ELSE NULL END) STORED`);
    }
    if (await indexExists(connection, database, 'uq_customer_profile_code')) {
        await connection.query(`ALTER TABLE ${customers} DROP INDEX uq_customer_profile_code`);
    }
    if (!await indexExists(connection, database, 'uq_customers_active_profile_code')) {
        await connection.query(`ALTER TABLE ${customers} ADD UNIQUE KEY uq_customers_active_profile_code (active_profile_code)`);
    }
};

const verify = async (connection, { database }) => {
    if (!await columnExists(connection, database, 'profile_code')) return;
    if (!await columnExists(connection, database, 'active_profile_code') ||
        !await indexExists(connection, database, 'uq_customers_active_profile_code') ||
        await indexExists(connection, database, 'uq_customer_profile_code')) {
        throw new Error('Active customer profile-code uniqueness verification failed.');
    }
};

module.exports = { id, up, verify };