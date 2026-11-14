const id = '2026-11-11-rosa-treatment-history-groups';

const exists = async (connection, sql, params) => Number((await connection.query(sql, params))[0][0].present) > 0;
const columnExists = (connection, database, column) => exists(connection,
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?', [database, 'treatment_history', column]);
const indexExists = (connection, database, index) => exists(connection,
    'SELECT COUNT(*) AS present FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?', [database, 'treatment_history', index]);
const constraintExists = (connection, database, constraint) => exists(connection,
    'SELECT COUNT(*) AS present FROM information_schema.table_constraints WHERE constraint_schema=? AND table_name=? AND constraint_name=?', [database, 'treatment_history', constraint]);
const quote = database => `\`${database.replace(/`/g, '``')}\`.\`treatment_history\``;

const up = async (connection, { database }) => {
    const histories = quote(database);
    if (!await columnExists(connection, database, 'parent_history_id')) {
        await connection.query(`ALTER TABLE ${histories} ADD COLUMN parent_history_id INT NULL AFTER treatment_id`);
    }
    if (!await indexExists(connection, database, 'idx_treatment_history_parent')) {
        await connection.query(`ALTER TABLE ${histories} ADD KEY idx_treatment_history_parent (parent_history_id)`);
    }
    if (!await constraintExists(connection, database, 'fk_treatment_history_parent')) {
        await connection.query(`ALTER TABLE ${histories} ADD CONSTRAINT fk_treatment_history_parent FOREIGN KEY (parent_history_id) REFERENCES ${histories} (id)`);
    }
};

const verify = async (connection, { database }) => {
    if (!await columnExists(connection, database, 'parent_history_id') ||
        !await indexExists(connection, database, 'idx_treatment_history_parent') ||
        !await constraintExists(connection, database, 'fk_treatment_history_parent')) {
        throw new Error('Rosa treatment history-group schema verification failed.');
    }
};

module.exports = { id, up, verify };