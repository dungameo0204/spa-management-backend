const id = '2026-11-07-xuly-treatment-groups';

const tableExists = async (connection, database, table) => {
    const [[row]] = await connection.query(
        `SELECT COUNT(*) AS present FROM information_schema.tables WHERE table_schema=? AND table_name=?`,
        [database, table]
    );
    return Number(row.present) === 1;
};

const columnExists = async (connection, database, table, column) => {
    const [[row]] = await connection.query(
        `SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?`,
        [database, table, column]
    );
    return Number(row.present) === 1;
};

const indexExists = async (connection, database, table, index) => {
    const [[row]] = await connection.query(
        `SELECT COUNT(*) AS present FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?`,
        [database, table, index]
    );
    return Number(row.present) > 0;
};

const constraintExists = async (connection, database, table, constraint) => {
    const [[row]] = await connection.query(
        `SELECT COUNT(*) AS present FROM information_schema.table_constraints WHERE constraint_schema=? AND table_name=? AND constraint_name=?`,
        [database, table, constraint]
    );
    return Number(row.present) === 1;
};

const addColumn = async (connection, database, table, column, definition) => {
    if (!await columnExists(connection, database, table, column)) {
        await connection.query(`ALTER TABLE ${quote(database, table)} ADD COLUMN ${definition}`);
    }
};

const quote = (database, table) => `\`${database.replace(/`/g, '``')}\`.\`${table.replace(/`/g, '``')}\``;

const up = async (connection, { database }) => {
    const products = quote(database, 'products');
    const treatments = quote(database, 'treatments');
    const histories = quote(database, 'treatment_history');
    const components = quote(database, 'product_service_components');

    if (!await tableExists(connection, database, 'products') ||
        !await tableExists(connection, database, 'treatments') ||
        !await tableExists(connection, database, 'treatment_history')) {
        throw new Error('Required Xuly treatment tables are missing.');
    }

    if (!await tableExists(connection, database, 'product_service_components')) {
        await connection.query(`CREATE TABLE ${components} (
            id INT NOT NULL AUTO_INCREMENT,
            parent_product_id INT NOT NULL,
            child_product_id INT NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            deleted_at DATETIME NULL,
            created_by VARCHAR(100) NULL,
            updated_by VARCHAR(100) NULL,
            deleted_by VARCHAR(100) NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_product_component (parent_product_id, child_product_id),
            KEY fk_component_child (child_product_id),
            CONSTRAINT fk_component_parent FOREIGN KEY (parent_product_id) REFERENCES ${products} (id),
            CONSTRAINT fk_component_child FOREIGN KEY (child_product_id) REFERENCES ${products} (id),
            CONSTRAINT chk_component_not_self CHECK (parent_product_id <> child_product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    await addColumn(connection, database, 'treatments', 'parent_treatment_id', 'parent_treatment_id INT NULL');
    await addColumn(connection, database, 'treatments', 'closed_at', 'closed_at DATETIME NULL');
    await addColumn(connection, database, 'treatments', 'closed_by', 'closed_by VARCHAR(100) NULL');
    await addColumn(connection, database, 'treatments', 'closure_note', 'closure_note TEXT NULL');
    await addColumn(connection, database, 'treatments', 'closure_signature_svg', 'closure_signature_svg MEDIUMTEXT NULL');
    await addColumn(connection, database, 'treatment_history', 'customer_signature_svg', 'customer_signature_svg MEDIUMTEXT NULL');
    await addColumn(connection, database, 'treatment_history', 'customer_signed_at', 'customer_signed_at DATETIME NULL');
    await addColumn(connection, database, 'treatment_history', 'note', 'note TEXT NULL');

    await connection.query(`ALTER TABLE ${treatments} MODIFY COLUMN total_sessions INT NULL, MODIFY COLUMN remaining_sessions INT NULL`);
    if (!await indexExists(connection, database, 'treatments', 'idx_treatment_parent')) {
        await connection.query(`ALTER TABLE ${treatments} ADD KEY idx_treatment_parent (parent_treatment_id)`);
    }
    if (!await constraintExists(connection, database, 'treatments', 'fk_treatment_parent')) {
        await connection.query(`ALTER TABLE ${treatments} ADD CONSTRAINT fk_treatment_parent FOREIGN KEY (parent_treatment_id) REFERENCES ${treatments} (id)`);
    }
    if (!await constraintExists(connection, database, 'treatments', 'chk_treatment_sessions')) {
        await connection.query(`ALTER TABLE ${treatments} ADD CONSTRAINT chk_treatment_sessions CHECK (
            (total_sessions IS NULL AND (remaining_sessions IS NULL OR remaining_sessions=0)) OR
            (total_sessions IS NOT NULL AND total_sessions>0 AND remaining_sessions IS NOT NULL AND remaining_sessions>=0 AND remaining_sessions<=total_sessions)
        )`);
    }
    if (!await constraintExists(connection, database, 'treatments', 'chk_treatment_closure')) {
        await connection.query(`ALTER TABLE ${treatments} ADD CONSTRAINT chk_treatment_closure CHECK (
            closed_at IS NULL OR (remaining_sessions IS NOT NULL AND remaining_sessions=0)
        )`);
    }
};

const verify = async (connection, { database }) => {
    for (const [table, column] of [
        ['treatments', 'parent_treatment_id'], ['treatments', 'closed_at'], ['treatments', 'closed_by'],
        ['treatments', 'closure_note'], ['treatment_history', 'note'], ['treatment_history', 'customer_signature_svg']
    ]) {
        if (!await columnExists(connection, database, table, column)) throw new Error(`Missing ${table}.${column} after migration.`);
    }
    if (!await tableExists(connection, database, 'product_service_components') ||
        !await indexExists(connection, database, 'treatments', 'idx_treatment_parent')) {
        throw new Error('Treatment-group schema verification failed.');
    }
};

module.exports = { id, up, verify };