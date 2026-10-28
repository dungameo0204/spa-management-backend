const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
async function main() {
    assert.equal(process.env.DB_HOST, '127.0.0.1');
    assert.equal(process.env.DB_PORT, '3308');
    const database = require('../src/config/database');
    const pool = database.masterPool;
    const query = pool.query, getConnection = pool.getConnection;
    const db = 'db_spa_1791039769068_e185';
    let c, server;
    try {
        assert.equal(await database.getTenantDbName(7), db);
        c = await pool.getConnection();
        assert.equal(Number((await c.query('SELECT @@port port'))[0][0].port), 3308);
        const manifest = JSON.parse(fs.readFileSync('D:/SpaRosa/backups/pre-appointment-contact-table-manifest.json', 'utf8'));
        for (const target of manifest.databases) {
            const [rows] = await c.query(`SELECT * FROM \`${target}\`.appointments ORDER BY id`);
            assert.equal(rows.length, manifest.appointments[target].count);
            assert.equal(crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'), manifest.appointments[target].sha256);
            const [[counts]] = await c.query(`SELECT COUNT(*) n FROM \`${target}\`.appointment_contact_notes`);
            assert.equal(counts.n, manifest.appointments[target].legacy_notes);
        }
        await c.beginTransaction();
        pool.query = c.query.bind(c);
        pool.getConnection = async () => ({ query: c.query.bind(c), beginTransaction: () => c.query('SAVEPOINT contact_test'), commit: () => c.query('RELEASE SAVEPOINT contact_test'), rollback: () => c.query('ROLLBACK TO SAVEPOINT contact_test'), release() {} });
        const [[branch]] = await c.query(`SELECT id FROM \`${db}\`.branches WHERE deleted_at IS NULL LIMIT 1`);
        const [customer] = await c.query(`INSERT INTO \`${db}\`.customers (fullname,phone_number) VALUES ('Contact note test',?)`, [`N${Date.now()}`]);
        const original = 'Lịch hẹn tự động từ liệu trình: làm móng';
        const [insert] = await c.query(`INSERT INTO \`${db}\`.appointments (customer_id,branch_id,appointment_date,note) VALUES (?,?,NOW(),?)`, [customer.insertId, branch.id, original]);
        const id = insert.insertId;
        const app = express(); app.use(express.json()); app.use('/api/appointments', require('../src/routes/appointmentRoutes'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const request = async (method, path, body, role = 'MANAGER', branchId = branch.id, auth = true) => {
            const r = await fetch(`http://127.0.0.1:${server.address().port}/api/appointments${path}`, {
                method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${jwt.sign({ tenant_id: 7, system_role: role, username: 'contact-test', branch_id: branchId }, process.env.JWT_SECRET)}` } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            return { status: r.status, body: await r.json() };
        };
        const path = `/${id}/contact-notes`;
        assert.equal((await request('POST', path, { content: 'No' }, 'MANAGER', branch.id, false)).status, 401);
        for (const content of [null, '', ' \n ', 123, {}, 'a'.repeat(10001), '\0']) {
            assert.equal((await request('POST', path, { content })).status, 400);
        }
        assert.equal((await request('POST', path, { content: 'No' }, 'CUSTOMER')).status, 400);
        assert.equal((await request('POST', path, { content: 'No' }, 'STAFF', 2147483647)).status, 400);
        assert.equal((await request('POST', '/2147483647/contact-notes', { content: 'No' })).status, 400);
        let r = await request('POST', path, { content: ' Đã liên hệ lần 1\r\nKhách hẹn gọi lại ', contact_date: '01/01/2000' }, 'STAFF');
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const date = (await c.query("SELECT DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+07:00'), '%d/%m/%Y') d"))[0][0].d;
        const first = `${date}: Đã liên hệ lần 1\nKhách hẹn gọi lại`;
        assert.equal(r.body.data.extra_note, first);
        assert.equal(r.body.data.contact_date, date);
        const firstId = r.body.data.note_id;
        assert.equal(r.body.data.contact_notes[0].id, firstId);
        r = await request('POST', path, { content: 'Đã liên hệ lần 2, khách đã đặt cọc' });
        assert.equal(r.status, 201);
        const expected = `${first}\n${date}: Đã liên hệ lần 2, khách đã đặt cọc`;
        assert.equal(r.body.data.extra_note, expected);
        const secondId = r.body.data.note_id;
        for (const suffix of [`/${id}`, `?search=${encodeURIComponent('Contact note test')}`, '/tomorrow', '/not-arrived']) {
            r = await request('GET', suffix);
            assert.equal(r.status, 200);
            if (suffix === `/${id}`) { assert.equal(r.body.data.extra_note, expected); assert.equal(r.body.data.note, original); assert.equal(r.body.data.contact_notes.length, 2); }
            if (suffix.startsWith('?')) {
                const row = r.body.data.find(row => row.id === id);
                assert.equal(row.extra_note, expected); assert.equal(row.contact_notes.length, 2);
            }
        }
        assert.equal((await request('PUT', `/${id}`, { extra_note: null })).status, 400);
        assert.equal((await request('PUT', `/${id}`, { contact_notes: [] })).status, 400);
        assert.equal((await request('POST', '', { extra_note: 'Overwrite' })).status, 400);
        await c.query(`UPDATE \`${db}\`.appointments SET appointment_date=CURDATE() + INTERVAL 1 DAY WHERE id=?`, [id]);
        r = await request('GET', `/tomorrow?search=${encodeURIComponent('Contact note test')}`);
        assert.equal(r.body.data.find(row => row.id === id).contact_notes.length, 2);
        await c.query(`UPDATE \`${db}\`.appointments SET appointment_date=CURDATE() WHERE id=?`, [id]);
        r = await request('GET', `/not-arrived?search=${encodeURIComponent('Contact note test')}`);
        assert.equal(r.body.data.find(row => row.id === id).extra_note, expected);
        await request('PUT', `/${id}`, { appointment_date: '2026-11-01 09:00:00' });
        assert.equal((await request('GET', `/${id}`)).body.data.extra_note, expected);
        for (const method of ['PUT', 'DELETE']) {
            assert.equal((await request(method, `${path}/${firstId}`, { content: 'No' }, 'STAFF', 2147483647)).status, 400);
            assert.equal((await request(method, `${path}/${firstId}`, { content: 'No' }, 'CUSTOMER')).status, 400);
            assert.equal((await request(method, `${path}/2147483647`, { content: 'No' })).status, 400);
            assert.equal((await request(method, `${path}/bad`, { content: 'No' })).status, 400);
        }
        const [other] = await c.query(`INSERT INTO \`${db}\`.appointments (customer_id,branch_id,appointment_date) VALUES (?,?,NOW())`, [customer.insertId, branch.id]);
        assert.equal((await request('PUT', `/${other.insertId}/contact-notes/${firstId}`, { content: 'Wrong parent' })).status, 400);
        assert.equal((await request('DELETE', `/${other.insertId}/contact-notes/${firstId}`)).status, 400);
        assert.equal((await request('PUT', `${path}/${firstId}`, { content: ' ' })).status, 400);
        // Changing content must keep the original business date, even for old entries.
        await c.query(`UPDATE \`${db}\`.appointment_contact_notes SET contact_date='2026-10-25' WHERE id=?`, [firstId]);
        r = await request('PUT', `${path}/${firstId}`, { content: 'Sửa sai\r\nKhách chưa đặt cọc', contact_date: '01/01/2000' }, 'STAFF');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.data.contact_date, '25/10/2026');
        assert.equal(r.body.data.contact_notes[0].updated_by, 'contact-test');
        assert.equal(r.body.data.contact_notes[0].created_by, 'contact-test');
        assert.equal(r.body.data.extra_note, `25/10/2026: Sửa sai\nKhách chưa đặt cọc\n${date}: Đã liên hệ lần 2, khách đã đặt cọc`);
        r = await request('DELETE', `${path}/${secondId}`, undefined, 'STAFF');
        assert.equal(r.status, 200); assert.equal(r.body.data.contact_notes.length, 1);
        const [[deleted]] = await c.query(`SELECT deleted_at,deleted_by FROM \`${db}\`.appointment_contact_notes WHERE id=?`, [secondId]);
        assert.ok(deleted.deleted_at); assert.equal(deleted.deleted_by, 'contact-test');
        assert.equal((await request('PUT', `${path}/${secondId}`, { content: 'Deleted' })).status, 400);
        assert.equal((await request('DELETE', `${path}/${secondId}`)).status, 400);
        assert.equal((await request('DELETE', `${path}/${firstId}`)).status, 200);
        r = await request('GET', `/${id}`);
        assert.equal(r.body.data.extra_note, null); assert.deepEqual(r.body.data.contact_notes, []); assert.equal(r.body.data.note, original);
        // Legacy migration preserves a multiline block without inventing dates.
        const legacy = '25/10/2026: Cũ\nDòng tiếp theo';
        await c.query(`INSERT INTO \`${db}\`.appointment_contact_notes (appointment_id,content,contact_date) VALUES (?,?,NULL)`, [id, legacy]);
        assert.equal((await request('GET', `/${id}`)).body.data.extra_note, legacy);
        await c.query(`UPDATE \`${db}\`.appointment_contact_notes SET content=? WHERE appointment_id=? AND deleted_at IS NULL`, ['x'.repeat(65530), id]);
        const [[beforeOverflow]] = await c.query(`SELECT COUNT(*) n FROM \`${db}\`.appointment_contact_notes WHERE appointment_id=?`, [id]);
        assert.equal((await request('POST', path, { content: 'Overflow' })).status, 400);
        assert.equal((await c.query(`SELECT COUNT(*) n FROM \`${db}\`.appointment_contact_notes WHERE appointment_id=?`, [id]))[0][0].n, beforeOverflow.n);
        await c.query(`UPDATE \`${db}\`.appointments SET deleted_at=NOW() WHERE id=?`, [id]);
        assert.equal((await request('POST', path, { content: 'Deleted' })).status, 400);
        assert.equal((await request('PUT', `${path}/${firstId}`, { content: 'Deleted parent' })).status, 400);
        assert.equal((await request('DELETE', `${path}/${firstId}`)).status, 400);
        await c.rollback();
        assert.equal((await c.query(`SELECT COUNT(*) n FROM \`${db}\`.appointments WHERE id=?`, [id]))[0][0].n, 0);
        assert.equal((await c.query(`SELECT COUNT(*) n FROM \`${db}\`.appointment_contact_notes WHERE appointment_id=?`, [id]))[0][0].n, 0);
        console.log('PASS: data preservation, HTTP create/update/soft-delete, GET arrays/text, auth/branch/parent guards, original dates, Unicode/newlines, legacy block, overflow rollback and fixture rollback on 3308.');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        pool.query = query; pool.getConnection = getConnection;
        if (c) { await c.rollback(); c.release(); }
        await pool.end();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });