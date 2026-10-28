const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

async function main() {
    assert.ok(process.env.DOTENV_CONFIG_PATH);
    assert.equal(process.env.DB_HOST, '127.0.0.1'); assert.equal(process.env.DB_PORT, '3308');
    const database = require('../src/config/database');
    const pool = database.masterPool;
    const originalQuery = pool.query, originalGet = pool.getConnection;
    const db = 'db_spa_1791039769068_e185';
    let c, server, failRead = false;
    try {
        assert.equal(await database.getTenantDbName(7), db);
        c = await pool.getConnection();
        assert.equal(Number((await c.query('SELECT @@port port'))[0][0].port), 3308);
        await c.beginTransaction();
        pool.query = c.query.bind(c);
        pool.getConnection = async () => ({
            query: (sql, params) => {
                if (failRead && sql.includes('SELECT id, treatment_id, branch_id, note')) throw Error('Injected read failure');
                return c.query(sql, params);
            },
            beginTransaction: () => c.query('SAVEPOINT followup_test'),
            commit: () => c.query('RELEASE SAVEPOINT followup_test'),
            rollback: () => c.query('ROLLBACK TO SAVEPOINT followup_test'), release() {}
        });
        const [[branch]] = await c.query(`SELECT id FROM \`${db}\`.branches WHERE deleted_at IS NULL LIMIT 1`);
        const [[staff]] = await c.query(`SELECT id FROM \`${db}\`.staffs WHERE deleted_at IS NULL LIMIT 1`);
        const [customer] = await c.query(`INSERT INTO \`${db}\`.customers (fullname,phone_number) VALUES ('Followup test',?)`, [`F${Date.now()}`]);
        const [product] = await c.query(`INSERT INTO \`${db}\`.products (name,price,sale_price,is_product) VALUES ('Followup test',100,100,0)`);
        const [card] = await c.query(`INSERT INTO \`${db}\`.treatments (customer_id,product_id,total_sessions,remaining_sessions) VALUES (?,?,1,0)`, [customer.insertId, product.insertId]);
        const createHistory = async () => (await c.query(`INSERT INTO \`${db}\`.treatment_history (treatment_id,branch_id,execution_date,created_at,note) VALUES (?,?,'2026-01-02 09:00:00','2026-01-02 09:00:00','Initial')`, [card.insertId, branch.id]))[0].insertId;
        const id = await createHistory();
        await c.query(`INSERT INTO \`${db}\`.treatment_history_staffs (treatment_history_id,staff_id,commission_amount_snapshot) VALUES (?,?,123)`, [id, staff.id]);
        const snapshot = async () => JSON.stringify({
            card: (await c.query(`SELECT * FROM \`${db}\`.treatments WHERE id=?`, [card.insertId]))[0],
            staffs: (await c.query(`SELECT * FROM \`${db}\`.treatment_history_staffs WHERE treatment_history_id=?`, [id]))[0],
            count: (await c.query(`SELECT COUNT(*) n FROM \`${db}\`.treatment_history WHERE treatment_id=?`, [card.insertId]))[0]
        });
        const app = express(); app.use(express.json()); app.use('/api/treatments', require('../src/routes/treatmentRoutes'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const request = async (method, suffix, body, role = 'MANAGER', claims = {}, auth = true) => {
            const r = await fetch(`http://127.0.0.1:${server.address().port}/api/treatments${suffix}`, {
                method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${jwt.sign({ tenant_id: 7, system_role: role, username: 'followup-test', branch_id: branch.id, ...claims }, process.env.JWT_SECRET)}` } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            return { status: r.status, body: await r.json() };
        };
        const notePath = `/execute/${id}/note`, signPath = `/execute/${id}/sign`;
        const signature = '<svg width="300" height="100"><path d="M 10 20 L 50 60"/></svg>';
        const before = await snapshot();
        assert.equal((await request('PUT', notePath, { note: 'No' }, 'MANAGER', {}, false)).status, 401);
        for (const [method, path, body] of [['PUT', notePath, { note: 'No' }], ['POST', signPath, { customer_signature_svg: signature }]]) {
            assert.equal((await request(method, path, body, 'CUSTOMER')).status, 403);
            assert.equal((await request(method, path, body, 'MANAGER', { customer_id: 1 })).status, 403);
            assert.equal((await request(method, path, body, 'STAFF', { branch_id: 2147483647 })).status, 403);
            assert.equal((await request(method, path.replace(`/${id}/`, '/2147483647/'), body)).status, 404);
            assert.equal((await request(method, path.replace(`/${id}/`, '/bad/'), body)).status, 400);
        }
        for (const body of [{}, [], { note: {} }, { note: false }, { note: 'đ'.repeat(32768) }, { note: 'Yes', customer_signed_at: null }]) {
            assert.equal((await request('PUT', notePath, body)).status, 400);
        }
        for (const body of [{}, { customer_signature_svg: null }, { customer_signature_svg: '' },
            { customer_signature_svg: '<svg onload="evil()"></svg>' }, { customer_signature_svg: signature, customer_signed_at: '2000-01-01' }]) {
            assert.equal((await request('POST', signPath, body)).status, 400);
        }
        let r = await request('PUT', notePath, { note: '  Da hơi đỏ\nKhách hẹn ký lúc ra về  ' }, 'STAFF');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.data.note, 'Da hơi đỏ\nKhách hẹn ký lúc ra về');
        assert.equal(r.body.data.customer_signed_at, null);
        assert.equal(r.body.data.updated_by, 'followup-test');
        for (const note of [null, ' \n ']) {
            r = await request('PUT', notePath, { note }); assert.equal(r.status, 200); assert.equal(r.body.data.note, null);
        }
        failRead = true;
        assert.equal((await request('PUT', notePath, { note: 'Must rollback' })).status, 400);
        assert.equal((await request('POST', signPath, { customer_signature_svg: signature })).status, 400);
        failRead = false;
        const [[rolledBack]] = await c.query(`SELECT note,customer_signature_svg,customer_signed_at FROM \`${db}\`.treatment_history WHERE id=?`, [id]);
        assert.deepEqual(rolledBack, { note: null, customer_signature_svg: null, customer_signed_at: null });
        await request('PUT', notePath, { note: 'Final\nTiếng Việt' });
        r = await request('POST', signPath, { customer_signature_svg: signature }, 'STAFF');
        assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.data.customer_signed_at);
        assert.equal(r.body.data.note, 'Final\nTiếng Việt');
        const [[signedTime]] = await c.query(`SELECT ABS(TIMESTAMPDIFF(SECOND,customer_signed_at,NOW())) seconds FROM \`${db}\`.treatment_history WHERE id=?`, [id]);
        assert.ok(signedTime.seconds <= 5);
        const signed = r.body.data;
        for (const [role, note] of [['STAFF', 'Nhân viên sửa sau ký\nDòng hai'], ['MANAGER', null], ['STAFF', ' \n '], ['MANAGER', 'Final\nTiếng Việt']]) {
            const edited = await request('PUT', notePath, { note }, role);
            assert.equal(edited.status, 200, JSON.stringify(edited.body));
            assert.equal(edited.body.data.note, note?.trim() || null);
            assert.equal(edited.body.data.customer_signature_svg, signed.customer_signature_svg);
            assert.equal(edited.body.data.customer_signed_at, signed.customer_signed_at);
        }
        assert.equal((await request('PUT', notePath, { note: 'Wrong branch' }, 'STAFF', { branch_id: 2147483647 })).status, 403);
        failRead = true;
        assert.equal((await request('PUT', notePath, { note: 'Rollback after signing' })).status, 400);
        failRead = false;
        assert.equal((await request('POST', signPath, { customer_signature_svg: signature })).status, 409);
        r = await request('GET', `/${card.insertId}`);
        const read = r.body.data.histories.find(h => h.id === id);
        assert.equal(read.note, 'Final\nTiếng Việt'); assert.ok(read.customer_signature_svg); assert.ok(read.customer_signed_at);
        assert.equal(read.customer_signature_svg, signed.customer_signature_svg);
        assert.equal(read.customer_signed_at, signed.customer_signed_at);
        assert.equal(await snapshot(), before, 'No card, history count or commission changes');
        const otherId = await createHistory();
        await c.query(`UPDATE \`${db}\`.treatments SET closed_at=NOW() WHERE id=?`, [card.insertId]);
        assert.equal((await request('POST', `/execute/${otherId}/sign`, { customer_signature_svg: signature })).status, 200, 'Closed/exhausted cards allow late session signing');
        const closedEdit = await request('PUT', `/execute/${otherId}/note`, { note: 'Sửa note thẻ đã đóng' }, 'STAFF');
        assert.equal(closedEdit.status, 200); assert.ok(closedEdit.body.data.customer_signed_at);
        const deletedId = await createHistory();
        await c.query(`UPDATE \`${db}\`.treatment_history SET deleted_at=NOW() WHERE id=?`, [deletedId]);
        assert.equal((await request('PUT', `/execute/${deletedId}/note`, { note: 'No' })).status, 404);
        assert.equal((await request('POST', `/execute/${deletedId}/sign`, { customer_signature_svg: signature })).status, 404);
        const orphanId = await createHistory();
        await c.query(`UPDATE \`${db}\`.treatments SET deleted_at=NOW() WHERE id=?`, [card.insertId]);
        assert.equal((await request('PUT', `/execute/${orphanId}/note`, { note: 'No' })).status, 404);
        assert.equal((await request('POST', `/execute/${orphanId}/sign`, { customer_signature_svg: signature })).status, 404);
        await c.rollback();
        assert.equal((await c.query(`SELECT COUNT(*) n FROM \`${db}\`.treatment_history WHERE id=?`, [id]))[0][0].n, 0);
        console.log('PASS: HTTP late note/sign, role/branch guards, old/exhausted/closed sessions, signed/deleted guards, server timestamp, GET metadata, failure rollback and unchanged sessions/commissions on 3308.');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        pool.query = originalQuery; pool.getConnection = originalGet;
        if (c) { await c.rollback(); c.release(); }
        await pool.end();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });