const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
async function main() {
    if (!process.env.DOTENV_CONFIG_PATH || process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3308') throw Error('Rosa 3308 explicit config required');
    const database = require('../src/config/database');
    const { masterPool } = database;
    const originalQuery = masterPool.query, originalGet = masterPool.getConnection;
    const db = 'db_spa_1791039769068_e185';
    let connection, server;
    let failChild = false;
    try {
        assert.equal(await database.getTenantDbName(7), db);
        connection = await masterPool.getConnection();
        assert.equal((await connection.query('SELECT @@port AS port'))[0][0].port, 3308);
        await connection.beginTransaction();
        masterPool.query = connection.query.bind(connection);
        masterPool.getConnection = async () => ({
            query: async (sql, params) => {
                if (failChild && sql.includes('INSERT INTO') && sql.includes('parent_treatment_id')) throw Error('Injected child failure');
                return connection.query(sql, params);
            }, beginTransaction: () => connection.query('SAVEPOINT treatment_group_test'),
            commit: () => connection.query('RELEASE SAVEPOINT treatment_group_test'),
            rollback: () => connection.query('ROLLBACK TO SAVEPOINT treatment_group_test'), release() {}
        });
        const [customer] = await connection.query(`INSERT INTO \`${db}\`.customers (fullname,phone_number) VALUES ('Group test',?)`, [`T${Date.now()}`]);
        const customerId = customer.insertId;
        const [[branch]] = await connection.query(`SELECT id FROM \`${db}\`.branches WHERE deleted_at IS NULL LIMIT 1`);
        const products = [];
        for (let i = 0; i < 4; i++) {
            const [p] = await connection.query(`INSERT INTO \`${db}\`.products (name,price,sale_price,is_product) VALUES (?,?,?,0)`, [`Group test ${Date.now()}-${i}`, 1000 + i * 100, 900]);
            products.push(p.insertId);
        }
        for (const child of products.slice(1)) await connection.query(`INSERT INTO \`${db}\`.product_service_components (parent_product_id,child_product_id) VALUES (?,?)`, [products[0], child]);
        const app = express(); app.use(express.json());
        app.use('/api/invoices', require('../src/routes/invoiceRoutes'));
        app.use('/api/treatments', require('../src/routes/treatmentRoutes'));
        app.use('/api/customers', require('../src/routes/customerRoutes'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const request = async (method, route, body, role = 'MANAGER', claims = {}) => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ tenant_id: 7, system_role: role, username: 'group-test', branch_id: branch.id, ...claims }, process.env.JWT_SECRET, { expiresIn: '5m' })}` },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json() };
        };
        const config = { total_sessions: null, children: [{ product_id: products[1], total_sessions: 1 }, { product_id: products[2], total_sessions: null }, { product_id: products[3], total_sessions: 0 }] };
        const invoiceBody = { customer_id: customerId, branch_id: branch.id, paid_amount: 900, items: [{ product_id: products[0], quantity: 1, unit_price: 900, treatment: config }] };
        let response = await request('POST', '/invoices', invoiceBody);
        assert.equal(response.status, 201, JSON.stringify(response.body));
        const invoiceId = response.body.invoiceId;
        const mapping = response.body.itemMappings[0];
        const rootId = mapping.treatment_id;
        assert.equal(mapping.children.length, 2);
        const finite = mapping.children[0].id, lifetime = mapping.children[1].id;
        const [[invoice]] = await connection.query(`SELECT total_amount FROM \`${db}\`.invoices WHERE id=?`, [invoiceId]);
        assert.equal(Number(invoice.total_amount), 900);
        const [children] = await connection.query(`SELECT * FROM \`${db}\`.treatments WHERE parent_treatment_id=? ORDER BY id`, [rootId]);
        assert.equal(children.length, 2);
        assert.equal(Number(children[0].commission_base_price), 1100);
        assert.equal(children[0].invoice_item_id, mapping.invoice_item_id);
        const base = await require('../src/services/commissionService').loadCommissionBase(connection, db, finite);
        assert.equal(base.unitPrice, 1100);
        await connection.query(`UPDATE \`${db}\`.products SET price=9999 WHERE id=?`, [products[1]]);
        assert.equal((await require('../src/services/commissionService').loadCommissionBase(connection, db, finite)).unitPrice, 1100);
        const [[staff]] = await connection.query(`SELECT id,role_id FROM \`${db}\`.staffs WHERE deleted_at IS NULL AND role_id IS NOT NULL LIMIT 1`);
        assert.ok(staff, 'Rosa fixture requires an active staff with a role');
        await connection.query(`INSERT INTO \`${db}\`.product_commission_tiers (product_id,role_id,min_price,max_price,calculation_type,percent) VALUES (?,?,0,2000,'PERCENT',10),(?,?,2000,NULL,'PERCENT',50)`, [products[1], staff.role_id, products[1], staff.role_id]);
        response = await request('GET', `/treatments?customerId=${customerId}&pageSize=1`);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.total, 1);
        assert.equal(response.body.data[0].children.length, 2);
        response = await request('GET', `/invoices/${invoiceId}`);
        assert.equal(response.body.data.items[0].treatment.children.length, 2);
        assert.equal((await request('PUT', `/invoices/${invoiceId}`, { items: invoiceBody.items })).status, 200);
        const sessionSignature = '<svg width="300" height="100"><path d="M 10 20 L 50 60"/></svg>';
        const sessionNote = 'Da hơi đỏ\nLưu ý theo dõi ở buổi tiếp theo.';
        const execute = (treatment_id, extra = {}, role = 'MANAGER') => request('POST', '/treatments/execute', { treatment_id, branch_id: branch.id,
            ...(treatment_id === finite ? { staffs: [{ staff_id: staff.id }] } : {}), ...extra }, role);
        for (const extra of [{ note: {} }, { note: 'đ'.repeat(32768) }, { customer_signature_svg: '' },
            { customer_signature_svg: '<svg onload="evil()"></svg>' }, { customer_signed_at: '2000-01-01' }]) {
            assert.equal((await execute(finite, extra)).status, 400);
        }
        assert.equal((await connection.query(`SELECT remaining_sessions FROM \`${db}\`.treatments WHERE id=?`, [finite]))[0][0].remaining_sessions, 1);
        assert.equal((await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.treatment_history WHERE treatment_id=?`, [finite]))[0][0].total, 0);
        assert.equal((await execute(rootId)).status, 400);
        // Failure after history insertion must roll back note/signature and the session balance too.
        assert.equal((await execute(finite, { note: sessionNote, customer_signature_svg: sessionSignature, staffs: [{ staff_id: 2147483647 }] })).status, 400);
        assert.equal((await connection.query(`SELECT remaining_sessions FROM \`${db}\`.treatments WHERE id=?`, [finite]))[0][0].remaining_sessions, 1);
        assert.equal((await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.treatment_history WHERE treatment_id=?`, [finite]))[0][0].total, 0);
        assert.equal((await execute(finite, { note: `  ${sessionNote}  `, customer_signature_svg: sessionSignature })).status, 201);
        assert.equal((await execute(finite)).status, 400);
        const executed = await execute(lifetime);
        assert.equal(executed.status, 201, JSON.stringify(executed.body));
        response = await request('GET', `/treatments/${rootId}`);
        assert.equal(response.body.data.children[0].remaining_sessions, 0, 'exhausted child remains visible');
        assert.equal(response.body.data.children[1].remaining_sessions, null);
        assert.equal(response.body.data.children[0].histories.length, 1);
        const signedSession = response.body.data.children[0].histories[0];
        assert.equal(signedSession.note, sessionNote);
        assert.match(signedSession.customer_signature_svg, /viewBox="0 0 300 100"/);
        assert.ok(signedSession.customer_signed_at);
        assert.equal(response.body.data.closed_at, null, 'session signature must not close parent');
        assert.equal(response.body.data.children[0].closed_at, null, 'exhausted signed session is not group completion');
        const unsignedSession = response.body.data.children[1].histories[0];
        assert.equal(unsignedSession.note, null);
        assert.equal(unsignedSession.customer_signature_svg, null);
        assert.equal(unsignedSession.customer_signed_at, null);
        const directChild = await request('GET', `/treatments/${finite}`);
        assert.equal(directChild.body.data.histories[0].note, sessionNote);
        assert.equal(directChild.body.data.histories[0].customer_signature_svg, signedSession.customer_signature_svg);
        assert.equal(Number(response.body.data.children[0].histories[0].staffs[0].commission_amount_snapshot), 110);
        response = await request('GET', `/customers/${customerId}/overview`);
        assert.equal(response.body.data.treatments.length, 1);
        assert.equal(response.body.data.treatments[0].children.length, 2);
        assert.equal(response.body.data.timeline.length, 1);
        const overviewFinite = response.body.data.treatments[0].children.find(card => card.id === finite);
        assert.equal(overviewFinite.histories[0].note, sessionNote);
        assert.equal(overviewFinite.histories[0].customer_signature_svg, signedSession.customer_signature_svg);
        const signature = '<svg width="300" height="100"><path d="M 10 20 L 50 60"/></svg>';
        const closeBody = { closure_signature_svg: signature, closure_note: 'Hoàn thành' };
        const unauthenticated = await fetch(`http://127.0.0.1:${server.address().port}/api/treatments/${rootId}/close`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(closeBody)
        });
        assert.equal(unauthenticated.status, 401);
        await unauthenticated.json();
        for (const role of ['CUSTOMER', 'SUPER_ADMIN', 'UNKNOWN']) {
            assert.equal((await request('POST', `/treatments/${rootId}/close`, closeBody, role)).status, 403);
        }
        assert.equal((await request('POST', `/treatments/${rootId}/close`, closeBody, 'STAFF', { customer_id: customerId })).status, 403);
        assert.equal((await request('POST', `/treatments/${rootId}/close`, closeBody, 'STAFF', { tenant_id: null })).status, 403);
        assert.equal((await request('POST', `/treatments/${finite}/close`, closeBody)).status, 400);
        assert.equal((await request('POST', `/treatments/${rootId}/close`, { closure_signature_svg: '<svg onload="evil()"></svg>' })).status, 400);
        const staffClosure = await request('POST', `/treatments/${rootId}/close`, closeBody, 'STAFF', { username: 'staff-group-test' });
        assert.equal(staffClosure.status, 200, JSON.stringify(staffClosure.body));
        assert.deepEqual(staffClosure.body.closedTreatmentIds, [rootId, finite, lifetime]);
        assert.equal((await request('POST', `/treatments/${rootId}/close`, closeBody)).status, 409);
        response = await request('GET', `/treatments/${rootId}`);
        for (const card of [response.body.data, ...response.body.data.children]) {
            assert.ok(card.closed_at); assert.equal(card.remaining_sessions, 0); assert.match(card.closure_signature_svg, /<path/);
            assert.equal(card.closed_by, 'staff-group-test');
            assert.equal(card.closure_signature_svg, response.body.data.closure_signature_svg);
        }
        assert.equal(response.body.data.total_sessions, null);
        assert.equal(response.body.data.children[0].total_sessions, 1);
        assert.equal(Number(response.body.data.children[0].histories[0].staffs[0].commission_amount_snapshot), 110);
        assert.equal((await execute(lifetime)).status, 400);
        assert.equal((await request('GET', `/treatments?customerId=${customerId}&status=completed`)).body.total, 1);
        assert.equal((await request('GET', `/treatments?customerId=${customerId}&status=active`)).body.total, 0);
        assert.equal((await request('DELETE', `/treatments/execute/${executed.body.treatmentHistoryId}`)).status, 200);
        assert.equal((await connection.query(`SELECT remaining_sessions FROM \`${db}\`.treatments WHERE id=?`, [lifetime]))[0][0].remaining_sessions, 0);
        const [[before]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.invoices WHERE customer_id=?`, [customerId]);
        for (const treatment of [{ total_sessions: null, children: [{ product_id: products[1], total_sessions: -1 }] },
            { total_sessions: null, children: [{ product_id: 2147483647, total_sessions: 2 }] }]) {
            assert.equal((await request('POST', '/invoices', { ...invoiceBody, items: [{ ...invoiceBody.items[0], treatment }] })).status, 400);
        }
        failChild = true;
        assert.equal((await request('POST', '/invoices', invoiceBody)).status, 400);
        failChild = false;
        assert.equal((await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.invoices WHERE customer_id=?`, [customerId]))[0][0].total, before.total);
        response = await request('POST', '/treatments', { customer_id: customerId, product_id: products[0], total_sessions: null, commission_base_price: 900, children: config.children });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal(response.body.children.length, 2);
        const manualRoot = response.body.treatmentId;
        const managerClosure = await request('POST', `/treatments/${manualRoot}/close`, closeBody);
        assert.equal(managerClosure.status, 200, JSON.stringify(managerClosure.body));
        assert.equal(managerClosure.body.closedTreatmentIds.length, 3);
        response = await request('POST', '/invoices', { ...invoiceBody, items: [{ ...invoiceBody.items[0], treatment: { total_sessions: null } }] });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.equal((await request('GET', `/treatments/${response.body.itemMappings[0].treatment_id}`)).body.data.total_sessions, null);
        assert.equal((await request('DELETE', `/invoices/${response.body.invoiceId}`)).status, 200);
        response = await request('POST', '/invoices', { ...invoiceBody, items: [{ ...invoiceBody.items[0], treatment: { total_sessions: 3, children: [{ product_id: products[1], total_sessions: 0 }] } }] });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        assert.deepEqual(response.body.itemMappings[0].children, []);
        assert.equal((await request('GET', `/treatments/${response.body.itemMappings[0].treatment_id}`)).body.data.children.length, 0);
        const finiteRoot = response.body.itemMappings[0].treatment_id;
        assert.equal((await execute(finiteRoot, { note: 'Ghi chú của nhân viên', customer_signature_svg: sessionSignature }, 'STAFF')).status, 201);
        let finiteDetail = await request('GET', `/treatments/${finiteRoot}`);
        assert.equal(finiteDetail.body.data.histories[0].note, 'Ghi chú của nhân viên');
        assert.ok(finiteDetail.body.data.histories[0].customer_signed_at);
        assert.equal((await execute(finiteRoot, { note: ' \n ', customer_signature_svg: null })).status, 201);
        finiteDetail = await request('GET', `/treatments/${finiteRoot}`);
        assert.equal(finiteDetail.body.data.histories[0].note, null);
        assert.equal(finiteDetail.body.data.histories[0].customer_signed_at, null);
        assert.equal((await execute(finiteRoot)).status, 201);
        assert.equal((await request('GET', `/treatments?customerId=${customerId}&status=exhausted`)).body.data.some(card => card.id === finiteRoot), true);
        assert.equal((await request('GET', `/treatments?customerId=${customerId}&status=active`)).body.data.some(card => card.id === finiteRoot), true);
        assert.equal((await request('GET', `/treatments?customerId=${customerId}&status=completed`)).body.data.some(card => card.id === finiteRoot), false);
        assert.equal((await request('POST', `/treatments/${finiteRoot}/close`, closeBody, 'STAFF')).status, 200);
        assert.equal((await request('GET', `/treatments?customerId=${customerId}&status=completed`)).body.data.some(card => card.id === finiteRoot), true);
        assert.equal((await request('GET', `/treatments?customerId=${customerId}&status=exhausted`)).body.data.some(card => card.id === finiteRoot), false);
        assert.equal((await request('POST', '/invoices', { ...invoiceBody, items: [{ ...invoiceBody.items[0], quantity: 2 }] })).status, 400);
        // Invoice amendments preserve group IDs/history/snapshots and reconcile each child's own usage.
        const amendment = await request('POST', '/invoices', { ...invoiceBody, items: [{ ...invoiceBody.items[0], treatment: {
            total_sessions: null, children: [{ product_id: products[1], total_sessions: 5 }, { product_id: products[2], total_sessions: null }]
        } }] });
        assert.equal(amendment.status, 201);
        const amendInvoice = amendment.body.invoiceId;
        const amendRoot = amendment.body.itemMappings[0].treatment_id;
        let amendDetail = (await request('GET', `/treatments/${amendRoot}`)).body.data;
        const amendFinite = amendDetail.children[0].id, amendLifetime = amendDetail.children[1].id;
        for (const id of [amendFinite, amendFinite, amendLifetime, amendLifetime]) assert.equal((await execute(id)).status, 201);
        const amendBody = async (finiteCount, lifetimeCount = null, children = true) => {
            const detail = (await request('GET', `/invoices/${amendInvoice}`)).body.data;
            return { items: [{ product_id: products[0], invoice_item_id: detail.items[0].id, quantity: 1, unit_price: 900,
                treatment: { total_sessions: null, ...(children ? { children: [{ product_id: products[1], total_sessions: finiteCount }, { product_id: products[2], total_sessions: lifetimeCount }] } : {}) } }] };
        };
        let amended = await request('PUT', `/invoices/${amendInvoice}`, await amendBody(3, 3));
        assert.equal(amended.status, 200, JSON.stringify(amended.body));
        amendDetail = (await request('GET', `/treatments/${amendRoot}`)).body.data;
        assert.deepEqual(amendDetail.children.map(card => card.id), [amendFinite, amendLifetime]);
        assert.deepEqual(amendDetail.children.map(card => card.remaining_sessions), [1, 1]);
        assert.equal(amendDetail.remaining_sessions, null);
        for (const count of [1]) {
            assert.equal((await request('PUT', `/invoices/${amendInvoice}`, await amendBody(count, 3))).status, 400);
            assert.equal((await request('PUT', `/invoices/${amendInvoice}`, await amendBody(3, count))).status, 400);
        }
        assert.equal((await request('PUT', `/invoices/${amendInvoice}`, await amendBody(0, 3))).status, 400);
        assert.equal((await request('DELETE', `/invoices/${amendInvoice}`)).status, 400);
        const deniedBody = await amendBody(3, 3);
        assert.equal((await request('PUT', `/invoices/${amendInvoice}`, deniedBody, 'STAFF', { branch_id: 2147483647 })).status, 400);
        // A later invoice failure must roll back balances already changed on child cards.
        assert.equal((await request('PUT', `/invoices/${amendInvoice}`, { ...await amendBody(4, 4), paid_amount: 901 })).status, 400);
        assert.deepEqual((await request('GET', `/treatments/${amendRoot}`)).body.data.children.map(card => card.remaining_sessions), [1, 1]);
        amended = await request('PUT', `/invoices/${amendInvoice}`, await amendBody(2, null));
        assert.equal(amended.status, 200, JSON.stringify(amended.body));
        amendDetail = (await request('GET', `/treatments/${amendRoot}`)).body.data;
        assert.deepEqual(amendDetail.children.map(card => card.remaining_sessions), [0, null]);
        assert.deepEqual(amendDetail.children.map(card => card.histories.length), [2, 2]);
        assert.equal((await request('POST', `/treatments/${amendRoot}/close`, closeBody)).status, 200);
        const closedSignature = (await request('GET', `/treatments/${amendRoot}`)).body.data.closure_signature_svg;
        assert.equal((await request('PUT', `/invoices/${amendInvoice}`, await amendBody(5, 5))).status, 200);
        amendDetail = (await request('GET', `/treatments/${amendRoot}`)).body.data;
        assert.deepEqual(amendDetail.children.map(card => card.total_sessions), [5, 5]);
        for (const card of [amendDetail, ...amendDetail.children]) {
            assert.equal(card.remaining_sessions, 0); assert.ok(card.closed_at); assert.equal(card.closure_signature_svg, closedSignature);
        }
        assert.equal((await request('PUT', `/invoices/${amendInvoice}`, await amendBody(1, 5))).status, 400);
        assert.equal((await request('DELETE', `/invoices/${amendInvoice}`)).status, 400);
        // Omitted treatment preserves the sold configuration, not today's catalog defaults.
        const currentItem = (await request('GET', `/invoices/${amendInvoice}`)).body.data.items[0];
        assert.equal((await request('PUT', `/invoices/${amendInvoice}`, { items: [{ product_id: products[0], invoice_item_id: currentItem.id, quantity: 1, unit_price: 900 }] })).status, 200);
        assert.deepEqual((await request('GET', `/treatments/${amendRoot}`)).body.data.children.map(card => card.total_sessions), [5, 5]);
        // An unused group (including lifetime child) can be deleted without orphaning cards.
        const unused = await request('POST', '/invoices', invoiceBody);
        assert.equal(unused.status, 201);
        const unusedDetail = (await request('GET', `/invoices/${unused.body.invoiceId}`)).body.data;
        const unusedRoot = unused.body.itemMappings[0].treatment_id;
        const unusedEdit = { items: [{ ...invoiceBody.items[0], invoice_item_id: unusedDetail.items[0].id, treatment: {
            total_sessions: null, children: [{ product_id: products[1], total_sessions: 0 }, { product_id: products[2], total_sessions: null }, { product_id: products[3], total_sessions: 4 }]
        } }] };
        const unusedUpdated = await request('PUT', `/invoices/${unused.body.invoiceId}`, unusedEdit);
        assert.equal(unusedUpdated.status, 200, JSON.stringify(unusedUpdated.body));
        const unusedCards = (await request('GET', `/treatments/${unusedRoot}`)).body.data.children;
        assert.deepEqual(unusedCards.map(card => card.product_id), [products[2], products[3]]);
        assert.equal(unusedCards[1].remaining_sessions, 4);
        assert.equal(Number(unusedCards[1].commission_base_price), 1300);
        assert.equal((await request('DELETE', `/invoices/${unused.body.invoiceId}`)).status, 200);
        assert.equal((await connection.query(`SELECT COUNT(*) n FROM \`${db}\`.treatments WHERE invoice_id=? AND deleted_at IS NULL`, [unused.body.invoiceId]))[0][0].n, 0);
        await connection.rollback();
        assert.equal((await connection.query(`SELECT COUNT(*) AS total FROM \`${db}\`.customers WHERE id=?`, [customerId]))[0][0].total, 0);
        console.log('PASS: invoice atomic groups/price snapshots, root pagination, exhausted children/history, overview, signature closure, lifetime, auth, edit/delete protection and rollback on Rosa 3308.');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        masterPool.query = originalQuery; masterPool.getConnection = originalGet;
        if (connection) { await connection.rollback(); connection.release(); }
        await masterPool.end();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });