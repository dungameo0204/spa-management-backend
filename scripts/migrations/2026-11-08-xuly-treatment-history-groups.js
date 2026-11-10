const id = '2026-11-08-xuly-treatment-history-groups';

const quote = (database, table) => `\`${database.replace(/`/g, '``')}\`.\`${table.replace(/`/g, '``')}\``;
const exists = async (connection, sql, params) => Number((await connection.query(sql, params))[0][0].present) > 0;
const columnExists = (connection, database, table, column) => exists(connection,
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?', [database, table, column]);
const indexExists = (connection, database, table, index) => exists(connection,
    'SELECT COUNT(*) AS present FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?', [database, table, index]);
const constraintExists = (connection, database, table, constraint) => exists(connection,
    'SELECT COUNT(*) AS present FROM information_schema.table_constraints WHERE constraint_schema=? AND table_name=? AND constraint_name=?', [database, table, constraint]);

const up = async (connection, { database }) => {
    const histories = quote(database, 'treatment_history');
    if (!await columnExists(connection, database, 'treatment_history', 'parent_history_id')) {
        await connection.query(`ALTER TABLE ${histories} ADD COLUMN parent_history_id INT NULL AFTER treatment_id`);
    }
    if (!await indexExists(connection, database, 'treatment_history', 'idx_treatment_history_parent')) {
        await connection.query(`ALTER TABLE ${histories} ADD KEY idx_treatment_history_parent (parent_history_id)`);
    }
    if (!await constraintExists(connection, database, 'treatment_history', 'fk_treatment_history_parent')) {
        await connection.query(`ALTER TABLE ${histories} ADD CONSTRAINT fk_treatment_history_parent FOREIGN KEY (parent_history_id) REFERENCES ${histories} (id)`);
    }
};

const verify = async (connection, { database }) => {
    if (!await columnExists(connection, database, 'treatment_history', 'parent_history_id') ||
        !await indexExists(connection, database, 'treatment_history', 'idx_treatment_history_parent') ||
        !await constraintExists(connection, database, 'treatment_history', 'fk_treatment_history_parent')) {
        throw new Error('Treatment history-group schema verification failed.');
    }
};

module.exports = { id, up, verify };