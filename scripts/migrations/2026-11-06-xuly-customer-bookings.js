const id = '2026-11-06-xuly-customer-bookings';

const quote = (database, table) => `\`${database.replace(/`/g, '``')}\`.\`${table.replace(/`/g, '``')}\``;
const count = async (connection, sql, params) => Number((await connection.query(sql, params))[0][0].present);
const columnExists = (connection, database, column) => count(connection,
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?', [database, 'customer_bookings', column]);
const indexExists = (connection, database, index) => count(connection,
    'SELECT COUNT(*) AS present FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?', [database, 'customer_bookings', index]);
const constraintExists = (connection, database, constraint) => count(connection,
    'SELECT COUNT(*) AS present FROM information_schema.table_constraints WHERE constraint_schema=? AND table_name=? AND constraint_name=?', [database, 'customer_bookings', constraint]);

const assertRowsCanMigrate = async (connection, table) => {
    const [[result]] = await connection.query(`SELECT COUNT(*) AS invalid_rows FROM ${table}
        WHERE booking_time IS NULL OR (customer_id IS NULL AND (
            customer_name IS NULL OR CHAR_LENGTH(TRIM(customer_name))=0 OR
            customer_phone IS NULL OR CHAR_LENGTH(TRIM(customer_phone))=0))`);
    if (Number(result.invalid_rows)) throw new Error('Customer bookings contain legacy rows that cannot be migrated safely; repair them before retrying.');
};

const addColumn = async (connection, database, table, column, definition) => {
    if (!await columnExists(connection, database, column)) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
};

const up = async (connection, { database }) => {
    const table = quote(database, 'customer_bookings');
    const present = await count(connection, 'SELECT COUNT(*) AS present FROM information_schema.tables WHERE table_schema=? AND table_name=?', [database, 'customer_bookings']);
    if (!present) throw new Error('Required customer_bookings table is missing.');
    const existingColumns = {};
    for (const column of ['customer_type', 'promotion_note', 'arrival_date', 'arrival_time', 'consultation_total']) existingColumns[column] = Boolean(await columnExists(connection, database, column));
    const modernSchemaAlreadyPresent = Object.values(existingColumns).every(Boolean);
    const partialModernSchema = Object.values(existingColumns).some(Boolean) && !modernSchemaAlreadyPresent;
    if (partialModernSchema) throw new Error('Customer bookings schema is partially upgraded; manual schema review is required before retrying.');
    // A completed schema legitimately permits booking_time=NULL for date-only bookings.
    // Only legacy schemas need a booking_time value to derive the new arrival fields.
    if (!modernSchemaAlreadyPresent) await assertRowsCanMigrate(connection, table);

    await connection.query(`ALTER TABLE ${table}
        MODIFY COLUMN customer_phone VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
        MODIFY COLUMN booking_time DATETIME NULL`);
    await addColumn(connection, database, table, 'customer_type', 'customer_type VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL');
    await addColumn(connection, database, table, 'promotion_note', 'promotion_note TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL');
    await addColumn(connection, database, table, 'arrival_date', 'arrival_date DATE NULL');
    await addColumn(connection, database, table, 'arrival_time', 'arrival_time TIME NULL');
    await addColumn(connection, database, table, 'consultation_total', 'consultation_total DECIMAL(15,2) NOT NULL DEFAULT 0');
    if (!await indexExists(connection, database, 'idx_booking_arrival')) await connection.query(`ALTER TABLE ${table} ADD KEY idx_booking_arrival (branch_id,arrival_date,arrival_time)`);
    if (!await constraintExists(connection, database, 'chk_booking_total')) await connection.query(`ALTER TABLE ${table} ADD CONSTRAINT chk_booking_total CHECK (consultation_total >= 0)`);
    if (!await constraintExists(connection, database, 'chk_booking_time')) await connection.query(`ALTER TABLE ${table} ADD CONSTRAINT chk_booking_time CHECK (arrival_time IS NULL OR (arrival_time >= '00:00:00' AND arrival_time < '24:00:00'))`);

    if (!modernSchemaAlreadyPresent) {
        const [[settings]] = await connection.query('SELECT @@SESSION.SQL_SAFE_UPDATES AS safe_updates');
        try {
            await connection.query('SET SESSION SQL_SAFE_UPDATES=0');
            await connection.query(`UPDATE ${table} SET
                customer_type=CASE WHEN customer_id IS NULL THEN 'NEW' ELSE 'EXISTING' END,
                arrival_date=DATE(booking_time), arrival_time=TIME(booking_time)`);
        } finally {
            await connection.query('SET SESSION SQL_SAFE_UPDATES=?', [Number(settings.safe_updates)]);
        }
    }
    const [[invalid]] = await connection.query(`SELECT COUNT(*) AS invalid_rows FROM ${table} WHERE
        customer_type NOT IN ('NEW','EXISTING') OR arrival_date IS NULL OR consultation_total < 0 OR
        (customer_type='NEW' AND (customer_id IS NOT NULL OR customer_name IS NULL OR CHAR_LENGTH(TRIM(customer_name))=0 OR customer_phone IS NULL OR CHAR_LENGTH(TRIM(customer_phone))=0)) OR
        (customer_type='EXISTING' AND customer_id IS NULL)`);
    if (Number(invalid.invalid_rows)) throw new Error('Customer bookings backfill verification failed; manual review required.');
    await connection.query(`ALTER TABLE ${table}
        MODIFY COLUMN customer_type VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        MODIFY COLUMN arrival_date DATE NOT NULL`);
    if (!await constraintExists(connection, database, 'chk_booking_customer')) await connection.query(`ALTER TABLE ${table} ADD CONSTRAINT chk_booking_customer CHECK (
        (customer_type='NEW' AND customer_id IS NULL AND CHAR_LENGTH(TRIM(customer_name))>0 AND customer_phone IS NOT NULL AND CHAR_LENGTH(TRIM(customer_phone))>0) OR
        (customer_type='EXISTING' AND customer_id IS NOT NULL))`);
};

const verify = async (connection, { database }) => {
    const table = quote(database, 'customer_bookings');
    for (const column of ['customer_type', 'promotion_note', 'arrival_date', 'arrival_time', 'consultation_total']) {
        if (!await columnExists(connection, database, column)) throw new Error(`Missing customer_bookings.${column} after migration.`);
    }
    for (const index of ['idx_booking_arrival']) if (!await indexExists(connection, database, index)) throw new Error(`Missing ${index} after migration.`);
    for (const constraint of ['chk_booking_total', 'chk_booking_time', 'chk_booking_customer']) if (!await constraintExists(connection, database, constraint)) throw new Error(`Missing ${constraint} after migration.`);
    const [[invalid]] = await connection.query(`SELECT COUNT(*) AS invalid_rows FROM ${table} WHERE customer_type NOT IN ('NEW','EXISTING') OR arrival_date IS NULL OR consultation_total < 0`);
    if (Number(invalid.invalid_rows)) throw new Error('Customer bookings verification failed.');
};

module.exports = { id, up, verify };