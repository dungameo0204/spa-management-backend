require('dotenv').config();
const mysql = require('mysql2/promise');

const quoteIdentifier = (value) => `\`${String(value).replace(/`/g, '``')}\``;

(async () => {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_SYSTEM_NAME
    });

    try {
        const [templateTables] = await connection.query(
            'SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
            ['db_spa_template', 'debt_payments']
        );
        if (templateTables.length) {
            const [templateColumns] = await connection.query('SHOW COLUMNS FROM `db_spa_template`.debt_payments');
            console.log(JSON.stringify({ database: 'db_spa_template', columns: templateColumns.map(c => c.Field) }, null, 2));
        }
        const [tenants] = await connection.query('SELECT id, database_name FROM tenants WHERE deleted_at IS NULL');
        for (const tenant of tenants) {
            const dbName = quoteIdentifier(tenant.database_name);
            const [targetInvoices] = await connection.query(
                `SELECT id, customer_id, branch_id, debt_amount, deleted_at FROM ${dbName}.invoices WHERE id = ?`, [30]
            );
            if (targetInvoices.length) {
                const [branches] = await connection.query(
                    `SELECT id, deleted_at FROM ${dbName}.branches WHERE id IN (?, ?)`,
                    [2, targetInvoices[0].branch_id]
                );
                const [customers] = await connection.query(
                    `SELECT id, total_debt, deleted_at FROM ${dbName}.customers WHERE id = ?`,
                    [targetInvoices[0].customer_id]
                );
                console.log(JSON.stringify({ database: tenant.database_name, invoice30: targetInvoices[0], branches, customer: customers[0] }, null, 2));
            }
            const [tables] = await connection.query(
                'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
                [tenant.database_name, 'debt_payments']
            );
            if (tables.length === 0) {
                console.log(JSON.stringify({ database: tenant.database_name, debt_payments: 'ABSENT' }, null, 2));
                continue;
            }
            const [referencingTables] = await connection.query(
                'SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ?',
                [tenant.database_name, 'debt_payments']
            );
            if (referencingTables.length) console.log(JSON.stringify({ database: tenant.database_name, referencingTables }, null, 2));
            const [columns] = await connection.query(`SHOW COLUMNS FROM ${dbName}.debt_payments`);
            const names = new Set(columns.map(column => column.Field));
            if (!['customer_id', 'invoice_id'].every(name => names.has(name))) {
                console.log(JSON.stringify({ database: tenant.database_name, columns: columns.map(column => column.Field), note: 'Kiểm tra schema thủ công trước khi đối soát dữ liệu.' }, null, 2));
                continue;
            }
            const [counts] = await connection.query(`
                SELECT COUNT(*) AS total,
                       COALESCE(SUM(invoice_id IS NULL), 0) AS without_invoice,
                       ${names.has('branch_id') ? 'COALESCE(SUM(branch_id IS NULL), 0)' : 'COUNT(*)'} AS without_branch
                FROM ${dbName}.debt_payments
            `);
            const [missingInvoices] = await connection.query(
                `SELECT id, customer_id, ${names.has('branch_id') ? 'branch_id,' : ''} invoice_id, deleted_at FROM ${dbName}.debt_payments WHERE invoice_id IS NULL`
            );
            const [inconsistencies] = await connection.query(`
                SELECT dp.id, dp.customer_id, ${names.has('branch_id') ? 'dp.branch_id' : 'NULL AS branch_id'}, dp.invoice_id
                FROM ${dbName}.debt_payments dp
                LEFT JOIN ${dbName}.invoices i ON i.id = dp.invoice_id
                WHERE dp.invoice_id IS NOT NULL
                  AND (i.id IS NULL OR i.customer_id <> dp.customer_id ${names.has('branch_id') ? 'OR i.branch_id <> dp.branch_id' : ''})
                LIMIT 10
            `);
            console.log(JSON.stringify({
                database: tenant.database_name,
                columns: columns.map(({ Field, Type, Null, Key, Default }) => ({ Field, Type, Null, Key, Default })),
                counts: counts[0],
                missingInvoices,
                inconsistencies
            }, null, 2));
        }
    } finally {
        await connection.end();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});