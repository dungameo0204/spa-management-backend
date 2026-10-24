// Integration test: ONLY run against the disposable MySQL instance in artifacts/mysql-product-test.
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const expectedDir = path.resolve(__dirname, '../artifacts/mysql-product-test/data').replace(/\\/g, '/').toLowerCase();
if (process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3307' || process.env.DB_SYSTEM_NAME !== 'db_system_master') {
    throw new Error('Refusing to run: configure the isolated 127.0.0.1:3307 test MySQL first.');
}

const { masterPool } = require('../src/config/database');
const app = express();
app.use(express.json());
app.use('/api/products', require('../src/routes/productRoutes'));
app.use('/api/invoices', require('../src/routes/invoiceRoutes'));

const main = async () => {
    const [[serverInfo]] = await masterPool.query('SELECT @@port AS port, @@datadir AS dir');
    assert.equal(Number(serverInfo.port), 3307);
    assert.equal(serverInfo.dir.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase(), expectedDir);
    const [[tenant]] = await masterPool.query("SELECT id, database_name FROM db_system_master.tenants WHERE database_name = 'db_spa_product_test'");
    assert.ok(tenant);
    const [[legacy]] = await masterPool.query("SELECT id, price, sale_price FROM db_spa_product_test.products WHERE name = 'legacy product'");
    assert.equal(Number(legacy.price), 1000000);
    assert.equal(Number(legacy.sale_price), 1000000);

    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
        const headers = {
            Authorization: `Bearer ${jwt.sign({ tenant_id: tenant.id, system_role: 'MANAGER', fullname: 'Test' }, process.env.JWT_SECRET)}`,
            'Content-Type': 'application/json'
        };
        const request = async (method, url, body) => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
                method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            return { status: response.status, body: await response.json() };
        };
        const name = `sale price test ${Date.now()}`;
        const created = await request('POST', '/products', { name, price: 1000000, sale_price: 800000, is_product: false });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const id = created.body.productId;
        const detail = await request('GET', `/products/${id}`);
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal(Number(detail.body.data.price), 1000000);
        assert.equal(Number(detail.body.data.sale_price), 800000);
        const list = await request('GET', `/products?search=${encodeURIComponent(name)}`);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        assert.equal(Number(list.body.data[0].sale_price), 800000);

        const updated = await request('PUT', `/products/${id}`, { price: 900000, sale_price: 700000 });
        assert.equal(updated.status, 200, JSON.stringify(updated.body));
        const revised = await request('GET', `/products/${id}`);
        assert.equal(Number(revised.body.data.price), 900000);
        assert.equal(Number(revised.body.data.sale_price), 700000);

        // Partial price updates preserve the other price, and validate the resulting pair.
        assert.equal((await request('PUT', `/products/${id}`, { price: 600000 })).status, 400);
        assert.equal((await request('PUT', `/products/${id}`, { sale_price: 900000 })).status, 400);
        assert.equal((await request('PUT', `/products/${id}`, { price: 700000 })).status, 400);
        assert.equal((await request('PUT', `/products/${id}`, { sale_price: 0 })).status, 200);
        assert.equal((await request('PUT', `/products/${id}`, { price: 1000000 })).status, 200);
        assert.equal(Number((await request('GET', `/products/${id}`)).body.data.sale_price), 0);
        assert.equal((await request('PUT', `/products/${id}`, { sale_price: 800000 })).status, 200);
        assert.equal((await request('PUT', `/products/${id}`, { price: 0, sale_price: 0 })).status, 400);
        for (const bad of [null, '', -1, 'NaN']) {
            assert.equal((await request('PUT', `/products/${id}`, { sale_price: bad })).status, 400);
        }
        for (const bad of [null, '', -1, 'NaN']) {
            assert.equal((await request('PUT', `/products/${id}`, { price: bad })).status, 400);
        }
        assert.equal(Number((await request('GET', `/products/${id}`)).body.data.sale_price), 800000);
        for (const bad of [undefined, null, '', -1, 100, 101, 'NaN']) {
            const result = await request('POST', '/products', { name: `${name} invalid`, price: 100, ...(bad === undefined ? {} : { sale_price: bad }), is_product: false });
            assert.equal(result.status, 400, JSON.stringify(result.body));
        }
        assert.equal((await request('POST', '/products', { name: `${name} zero`, price: 100, sale_price: 0, is_product: false })).status, 201);

        // Backfilled legacy product remains unchanged when editing non-price fields.
        assert.equal((await request('PUT', `/products/${legacy.id}`, { description: 'legacy unchanged price' })).status, 200);
        assert.equal((await request('PUT', `/products/${legacy.id}`, { sale_price: 1000000 })).status, 400);
        assert.equal((await request('PUT', `/products/${legacy.id}`, { price: 900000 })).status, 400);
        const [[legacyAfter]] = await masterPool.query('SELECT price, sale_price, description FROM db_spa_product_test.products WHERE id = ?', [legacy.id]);
        assert.equal(Number(legacyAfter.price), 1000000);
        assert.equal(Number(legacyAfter.sale_price), 1000000);
        assert.equal(legacyAfter.description, 'legacy unchanged price');

        const invoiceBase = { branch_id: 1, customer_id: 1, items: [{ product_id: id, quantity: 1, unit_price: 800000 }], paid_amount: 800000 };
        const invoice = await request('POST', '/invoices', invoiceBase);
        assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
        const [[item]] = await masterPool.query(
            'SELECT ii.snapshot_price, ii.final_price, ii.discount_amount, i.total_amount FROM db_spa_product_test.invoice_items ii JOIN db_spa_product_test.invoices i ON i.id = ii.invoice_id WHERE ii.product_id = ? ORDER BY ii.id DESC LIMIT 1', [id]
        );
        assert.equal(Number(item.snapshot_price), 800000);
        assert.equal(Number(item.final_price), 800000);
        assert.equal(Number(item.total_amount), 800000);
        assert.equal(Number(item.discount_amount), 0);
        // The unchanged invoice fallback still uses products.price (listed price).
        const fallback = await request('POST', '/invoices', { ...invoiceBase, paid_amount: 1000000, items: [{ product_id: id, quantity: 1 }] });
        assert.equal(fallback.status, 201, JSON.stringify(fallback.body));
        const [[latest]] = await masterPool.query('SELECT snapshot_price FROM db_spa_product_test.invoice_items WHERE product_id = ? ORDER BY id DESC LIMIT 1', [id]);
        assert.equal(Number(latest.snapshot_price), 1000000);
        console.log('PASS: isolated MySQL migration/backfill, product API CRUD, invoice explicit sale price and legacy fallback');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
};

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => masterPool.end());