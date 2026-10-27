const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
async function main() {
    assert.ok(process.env.DOTENV_CONFIG_PATH);
    assert.equal(process.env.DB_HOST, '127.0.0.1'); assert.equal(process.env.DB_PORT, '3308');
    const database = require('../src/config/database');
    const pool = database.masterPool;
    const query = pool.query, getConnection = pool.getConnection;
    let c, server;
    const db = 'db_spa_1791039769068_e185';
    try {
        assert.equal(await database.getTenantDbName(7), db);
        c = await pool.getConnection();
        assert.equal(Number((await c.query('SELECT @@port port'))[0][0].port), 3308);
        await c.beginTransaction();
        pool.query = c.query.bind(c);
        pool.getConnection = async () => ({ query: c.query.bind(c), beginTransaction: () => c.query('SAVEPOINT booking_test'), commit: () => c.query('RELEASE SAVEPOINT booking_test'), rollback: () => c.query('ROLLBACK TO SAVEPOINT booking_test'), release() {} });
        const [[branch]] = await c.query(`SELECT id FROM \`${db}\`.branches WHERE deleted_at IS NULL LIMIT 1`);
        const [customer] = await c.query(`INSERT INTO \`${db}\`.customers (fullname,phone_number) VALUES ('Booking customer',?)`, [`T${Date.now()}`]);
        const app = express(); app.use(express.json()); app.use('/api/customer-bookings', require('../src/routes/customerBookingRoutes'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const request = async (method, path = '', body, role = 'MANAGER', branchId = branch.id) => {
            const r = await fetch(`http://127.0.0.1:${server.address().port}/api/customer-bookings${path}`, { method,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ tenant_id: 7, system_role: role, username: 'booking-test', branch_id: branchId }, process.env.JWT_SECRET)}` },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: r.status, body: await r.json() };
        };
        const base = { customer_type: 'NEW', customer_name: 'Khách mới', customer_phone: '0901234567', branch_id: branch.id, arrival_date: '2028-02-29', arrival_time: '09:30', promotion_note: 'Ưu đãi', consultation_total: '1234.50', note: 'Ghi chú' };
        let r = await request('POST', '', base); assert.equal(r.status, 201, JSON.stringify(r.body));
        const id = r.body.bookingId;
        r = await request('GET', `/${id}`); assert.equal(r.status, 200); assert.equal(r.body.data.arrival_time, '09:30:00'); assert.equal(r.body.data.promotion_note, 'Ưu đãi'); assert.equal(Number(r.body.data.consultation_total), 1234.5);
        assert.equal((await request('PUT', `/${id}`, { note: 'Sửa ghi chú', status: 'CONFIRMED' }, 'STAFF')).status, 200);
        r = await request('GET', `/${id}`); assert.equal(r.body.data.note, 'Sửa ghi chú'); assert.equal(r.body.data.customer_name, 'Khách mới');
        assert.equal((await request('PUT', `/${id}`, { arrival_time: null, promotion_note: null })).status, 200);
        assert.equal((await request('GET', `/${id}`)).body.data.booking_time, null);
        assert.equal((await request('GET', `/${id}`, undefined, 'STAFF', 2147483647)).status, 200);
        assert.equal((await request('PUT', `/${id}`, { note: 'Forbidden' }, 'STAFF', 2147483647)).status, 404);
        assert.equal((await request('DELETE', `/${id}`, undefined, 'STAFF', 2147483647)).status, 404);
        assert.equal((await request('POST', '', base, 'STAFF', 2147483647)).status, 403);
        for (const patch of [{ arrival_date: '2026-02-29' }, { arrival_time: '24:00' }, { consultation_total: -1 }, { created_by: 'forged' }, { product_id: 2147483647 }]) {
            assert.equal((await request('PUT', `/${id}`, patch)).status, 400);
        }
        assert.equal((await request('GET', `/${id}`)).body.data.note, 'Sửa ghi chú');
        r = await request('POST', '', { customer_type: 'EXISTING', customer_id: customer.insertId, arrival_date: '2028-03-01' }, 'STAFF');
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const existingId = r.body.bookingId;
        r = await request('GET', `/${existingId}`); assert.equal(r.body.data.customer_name, 'Booking customer'); assert.equal(r.body.data.arrival_time, null);
        assert.equal((await request('PUT', `/${existingId}`, { customer_type: 'NEW' })).status, 400);
        assert.equal((await request('PUT', `/${existingId}`, { customer_type: 'NEW', customer_id: null, customer_name: 'Khách chuyển loại', customer_phone: '0901111222' })).status, 200);
        assert.equal((await request('GET', `/${existingId}`)).body.data.customer_type, 'NEW');
        assert.equal((await request('PUT', `/${existingId}`, { customer_type: 'EXISTING', customer_id: customer.insertId })).status, 200);
        assert.equal((await request('GET', `/${existingId}`)).body.data.customer_name, 'Booking customer');
        assert.equal((await request('GET', `?customerId=${customer.insertId}&startDate=2028-03-01&endDate=2028-03-01`)).body.total, 1);
        assert.equal((await request('GET', '?startDate=invalid')).status, 400);
        const scope = `?customerId=${customer.insertId}`;
        assert.equal((await request('GET', scope, undefined, 'STAFF', 2147483647)).body.total, 1);
        assert.equal((await request('GET', `${scope}&branchId=${branch.id}`, undefined, 'STAFF', 2147483647)).body.total, 1);
        assert.equal((await request('GET', `${scope}&branchId=2147483647`, undefined, 'STAFF')).body.total, 0);
        for (const filters of ['startTime=24:00', 'endTime=bad', 'startTime=08:00&endTime=07:00', 'startTime=']) {
            assert.equal((await request('GET', `?${filters}`)).status, 400);
        }
        assert.equal((await request('GET', `${scope}&startTime=07:00&endTime=08:00`)).body.total, 0, 'unknown time excluded');
        for (const clock of ['07:00', '08:00', '08:00:01']) {
            assert.equal((await request('PUT', `/${existingId}`, { arrival_time: clock })).status, 200);
            const page = await request('GET', `${scope}&startTime=07:00&endTime=08:00&pageSize=1`);
            assert.equal(page.body.total, clock === '08:00:01' ? 0 : 1);
        }
        assert.equal((await request('GET', `${scope}&startTime=08:00:01`)).body.total, 1);
        assert.equal((await request('GET', `${scope}&endTime=08:00:00`)).body.total, 0);
        assert.equal((await request('GET', `${scope}&search=Booking`)).body.total, 1);
        assert.equal((await request('GET', `${scope}&search=T`)).body.total, 1);
        assert.equal((await request('GET', `/${existingId}`)).body.data.has_arrived, false);
        // Use deterministic historical booking day; include activity before booking time, not before midnight.
        await c.query(`UPDATE \`${db}\`.customer_bookings SET created_at='2026-01-02 18:00:00' WHERE id=?`, [existingId]);
        const [invoice] = await c.query(`INSERT INTO \`${db}\`.invoices (customer_id,branch_id,total_amount,paid_amount,invoice_date,created_at)
            VALUES (?,?,0,0,'2026-01-03','2026-01-01 23:59:59')`, [customer.insertId, branch.id]);
        assert.equal((await request('GET', `/${existingId}`)).body.data.has_arrived, false);
        await c.query(`UPDATE \`${db}\`.invoices SET created_at='2026-01-02 00:00:00' WHERE id=?`, [invoice.insertId]);
        assert.equal((await request('GET', `/${existingId}`)).body.data.has_arrived, true);
        assert.equal((await request('GET', scope)).body.data[0].has_arrived, true);
        await c.query(`UPDATE \`${db}\`.invoices SET created_at=DATE_ADD(NOW(),INTERVAL 1 DAY) WHERE id=?`, [invoice.insertId]);
        assert.equal((await request('GET', `/${existingId}`)).body.data.has_arrived, false);
        await c.query(`UPDATE \`${db}\`.invoices SET created_at='2026-01-02 08:00:00',deleted_at=NOW() WHERE id=?`, [invoice.insertId]);
        assert.equal((await request('GET', `/${existingId}`)).body.data.has_arrived, false);
        const [product] = await c.query(`INSERT INTO \`${db}\`.products (name,price,sale_price,is_product) VALUES ('Booking arrival test',100,100,0)`);
        const [card] = await c.query(`INSERT INTO \`${db}\`.treatments (customer_id,product_id,total_sessions,remaining_sessions,created_at) VALUES (?,?,1,1,'2026-01-02 08:00:00')`, [customer.insertId, product.insertId]);
        assert.equal((await request('GET', `/${existingId}`)).body.data.has_arrived, true, 'standalone card is enough');
        const phone = (await c.query(`SELECT phone_number FROM \`${db}\`.customers WHERE id=?`, [customer.insertId]))[0][0].phone_number;
        const newBooking = await request('POST', '', { ...base, customer_phone: phone });
        assert.equal(newBooking.status, 201);
        const newId = newBooking.body.bookingId;
        await c.query(`UPDATE \`${db}\`.customer_bookings SET created_at='2026-01-02 18:00:00' WHERE id=?`, [newId]);
        assert.equal((await request('GET', `/${newId}`)).body.data.has_arrived, true, 'NEW exact phone match');
        await request('PUT', `/${newId}`, { customer_phone: `${phone}0` });
        assert.equal((await request('GET', `/${newId}`)).body.data.has_arrived, false, 'no partial phone matching');
        await c.query(`UPDATE \`${db}\`.treatments SET deleted_at=NOW() WHERE id=?`, [card.insertId]);
        assert.equal((await request('GET', `/${existingId}`)).body.data.has_arrived, false);
        assert.equal((await request('POST', '', base, 'CUSTOMER')).status, 403);
        assert.equal((await request('DELETE', `/${id}`, undefined, 'STAFF')).status, 200);
        assert.equal((await request('GET', `/${id}`)).status, 404);
        assert.equal((await request('PUT', `/${id}`, { note: 'No' })).status, 404);
        await c.rollback();
        assert.equal((await c.query(`SELECT COUNT(*) total FROM \`${db}\`.customer_bookings WHERE id IN (?,?)`, [id, existingId]))[0][0].total, 0);
        console.log('PASS: Rosa booking CRUD, all-branch reads/write guards, inclusive time filters, exact-phone arrival evidence, midnight/future/deleted boundaries and rollback on 3308.');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        pool.query = query; pool.getConnection = getConnection;
        if (c) { await c.rollback(); c.release(); }
        await pool.end();
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });