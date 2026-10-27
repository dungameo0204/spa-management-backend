// Explicitly opted-in, transaction-only test against the migrated Rosa tenant.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const { masterPool } = require('../src/config/database');
const treatmentService = require('../src/services/treatmentService');
async function main() {
    if (process.env.DB_PORT !== '3308' || !process.env.DOTENV_CONFIG_PATH) throw new Error('Explicit ROSA environment required.');
    const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: 3308, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    const db = 'db_spa_1791039769068_e185';
    const originalConnection = masterPool.getConnection;
    try {
        await connection.beginTransaction();
        const [[customer]] = await connection.query(`SELECT id FROM \`${db}\`.customers WHERE deleted_at IS NULL LIMIT 1`);
        const [[product]] = await connection.query(`SELECT id FROM \`${db}\`.products WHERE deleted_at IS NULL LIMIT 1`);
        const [[branch]] = await connection.query(`SELECT id FROM \`${db}\`.branches WHERE deleted_at IS NULL LIMIT 1`);
        assert.ok(customer && product && branch);
        const [insert] = await connection.query(`INSERT INTO \`${db}\`.treatments (customer_id, product_id, total_sessions, remaining_sessions) VALUES (?, ?, NULL, NULL)`, [customer.id, product.id]);
        const id = insert.insertId;
        // Keep service writes inside this outer transaction, regardless of its commit/rollback calls.
        masterPool.getConnection = async () => ({
            query: connection.query.bind(connection), beginTransaction: async () => {},
            commit: async () => {}, rollback: async () => {}, release() {}
        });
        const result = await treatmentService.executeTreatmentSession(7, { treatment_id: id, branch_id: branch.id }, 'rosa-schema-test', 'MANAGER');
        let [[card]] = await connection.query(`SELECT * FROM \`${db}\`.treatments WHERE id=?`, [id]);
        assert.equal(card.remaining_sessions, null);
        await connection.query(`UPDATE \`${db}\`.treatments SET remaining_sessions=0, closed_at=NOW(), closure_signature_svg='<svg></svg>' WHERE id=?`, [id]);
        await assert.rejects(treatmentService.executeTreatmentSession(7, { treatment_id: id, branch_id: branch.id }, 'test', 'MANAGER'), /kết thúc/);
        await treatmentService.deleteTreatmentHistory(7, result.treatmentHistoryId, 'test', 'MANAGER');
        [[card]] = await connection.query(`SELECT * FROM \`${db}\`.treatments WHERE id=?`, [id]);
        assert.equal(card.remaining_sessions, 0, 'Deleting history must not reopen closed treatment');
        const [child] = await connection.query(`INSERT INTO \`${db}\`.treatments (customer_id,product_id,total_sessions,remaining_sessions,parent_treatment_id) VALUES (?,?,NULL,NULL,?)`, [customer.id,product.id,id]);
        await assert.rejects(treatmentService.executeTreatmentSession(7, { treatment_id: child.insertId, branch_id: branch.id }, 'test', 'MANAGER'), /cha đã kết thúc/);
        await assert.rejects(connection.query(`INSERT INTO \`${db}\`.treatments (customer_id,product_id,total_sessions,remaining_sessions) VALUES (?,?,NULL,3)`, [customer.id,product.id]), /constraint/i);
        await assert.rejects(connection.query(`INSERT INTO \`${db}\`.customer_bookings (customer_name,branch_id,customer_type,arrival_date,arrival_time) VALUES ('test',?,'NEW',CURRENT_DATE(),'25:00:00')`, [branch.id]), /constraint/i);
        const [session] = await connection.query(`INSERT INTO \`${db}\`.customer_skin_image_sessions (customer_id,captured_date) VALUES (?,'2020-01-01')`, [customer.id]);
        await connection.query(`INSERT INTO \`${db}\`.customer_skin_images (session_id,file_path,sort_order) VALUES (?,'customers/test-left.jpg',0),(?,'customers/test-right.jpg',1)`, [session.insertId, session.insertId]);
        const [[image]] = await connection.query(`SELECT captured_date <> DATE(created_at) AS separate FROM \`${db}\`.customer_skin_image_sessions WHERE id=?`, [session.insertId]);
        assert.equal(image.separate, 1);
        const [images] = await connection.query(`SELECT file_path, sort_order FROM \`${db}\`.customer_skin_images WHERE session_id=? ORDER BY sort_order,id`, [session.insertId]);
        assert.equal(images.length, 2);
        assert.equal(images[1].sort_order, 1);
        await assert.rejects(connection.query(`INSERT INTO \`${db}\`.customer_skin_images (session_id,file_path) VALUES (0,'invalid.jpg')`), error => error.code === 'ER_NO_REFERENCED_ROW_2');
        await assert.rejects(connection.query(`DELETE FROM \`${db}\`.customer_skin_image_sessions WHERE id=?`, [session.insertId]), error => error.code === 'ER_ROW_IS_REFERENCED_2');
        console.log('PASS: MySQL 3308 constraints, lifetime execution, closure guard, closed-parent guard, no reopening on undo, capture date independent; all test writes rolled back.');
    } finally {
        masterPool.getConnection = originalConnection;
        await connection.rollback();
        await connection.end();
        await masterPool.end();
    }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });