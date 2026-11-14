const id = '2026-11-11-rosa-treatment-purchases';
const exists = async (connection, sql, params) => Number((await connection.query(sql, params))[0][0].present) > 0;
const tableExists = (connection, database) => exists(connection, 'SELECT COUNT(*) AS present FROM information_schema.tables WHERE table_schema=? AND table_name=?', [database, 'treatment_purchases']);
const quote = database => `\`${database.replace(/`/g, '``')}\``;

const up = async (connection, { database }) => {
    const db = quote(database);
    if (!await tableExists(connection, database)) {
        await connection.query(`CREATE TABLE ${db}.treatment_purchases (
            id INT NOT NULL AUTO_INCREMENT,
            treatment_id INT NOT NULL,
            invoice_id INT NULL,
            invoice_item_id INT NULL,
            total_sessions INT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP NULL DEFAULT NULL,
            created_by VARCHAR(100) NULL,
            updated_by VARCHAR(100) NULL,
            deleted_by VARCHAR(100) NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_treatment_purchase_invoice_item (treatment_id,invoice_item_id),
            KEY idx_treatment_purchase_treatment (treatment_id,deleted_at),
            KEY idx_treatment_purchase_invoice (invoice_id,deleted_at),
            KEY idx_treatment_purchase_item (invoice_item_id,deleted_at),
            CONSTRAINT fk_treatment_purchase_treatment FOREIGN KEY (treatment_id) REFERENCES ${db}.treatments (id),
            CONSTRAINT fk_treatment_purchase_invoice FOREIGN KEY (invoice_id) REFERENCES ${db}.invoices (id),
            CONSTRAINT fk_treatment_purchase_invoice_item FOREIGN KEY (invoice_item_id) REFERENCES ${db}.invoice_items (id),
            CONSTRAINT chk_treatment_purchase_sessions CHECK (total_sessions IS NULL OR total_sessions > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
    await connection.query(`INSERT INTO ${db}.treatment_purchases
        (treatment_id,invoice_id,invoice_item_id,total_sessions,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by)
        SELECT t.id,t.invoice_id,t.invoice_item_id,t.total_sessions,t.created_at,t.updated_at,t.created_by,t.updated_by,t.deleted_at,t.deleted_by
        FROM ${db}.treatments t
        LEFT JOIN ${db}.treatment_purchases p ON p.treatment_id=t.id AND p.invoice_item_id <=> t.invoice_item_id
        WHERE p.id IS NULL`);
};

const verify = async (connection, { database }) => {
    if (!await tableExists(connection, database)) throw new Error('Treatment purchase ledger schema verification failed.');
    const [[missing]] = await connection.query(`SELECT COUNT(*) AS count FROM ${quote(database)}.treatments t
        LEFT JOIN ${quote(database)}.treatment_purchases p ON p.treatment_id=t.id AND p.invoice_item_id <=> t.invoice_item_id
        WHERE p.id IS NULL`);
    if (Number(missing.count)) throw new Error('Treatment purchase ledger backfill verification failed.');
};

module.exports = { id, up, verify };