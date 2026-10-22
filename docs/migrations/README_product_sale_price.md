# Product listed price and sale price (customer-specific rollout)

`products.price` remains the listed price for existing clients and the current invoice fallback. `products.sale_price` is the selling price. The frontend must send `items[].unit_price = sale_price` to `POST /api/invoices` (and `PUT /api/invoices/:id`); the backend does not calculate the displayed percentage discount. An invoice without an explicit unit price still falls back to `products.price`.

## Local test setup

Use an isolated MySQL instance, not merely schemas renamed on the same MySQL server: tenant lookup and template cloning reference `db_system_master` and `db_spa_template` literally. The local integration test uses a disposable instance at `127.0.0.1:3307` with data directory `artifacts/mysql-product-test/data` and three schemas: `db_system_master`, `db_spa_template`, `db_spa_product_test`. It checks the server's actual data directory before writing. The SQL dumps in the repo contain `DROP TABLE`; import them **only** into empty schemas on the isolated instance. Do not import them into a populated server. The test data contains no real customer records.

The local test instance's `db_spa_template.products` has `sale_price DECIMAL(15,2) NOT NULL` so new Spa databases cloned from it support selling prices. The repo's `db_spa_template.sql` matches that schema, but contains `DROP TABLE` statements: never import it over a populated database. This local-template change does not migrate any customer server or other existing tenant.

In PowerShell, set `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_USER`, `DB_PASSWORD`, `DB_SYSTEM_NAME=db_system_master`, and `JWT_SECRET` for that isolated instance, then run `npm run test:product-sale-price`. The test is intentionally refused when the host/port/data directory does not match the disposable instance. Do not put test credentials in a tracked file.

## Customer deployment (NOT run as part of local testing)

1. Verify the target tenant in `db_system_master.tenants` and its actual database name. Stop writes to that tenant; back up the master and target tenant database, verify the backup can be restored. Never use the bootstrap schema dumps on populated databases.
2. Inspect `information_schema.COLUMNS` for `products.sale_price` in the target database. If absent, run `docs/migrations/2026-10-22_product_sale_price.sql` **against that tenant database only**. This is not a blindly rerunnable migration: MySQL DDL implicitly commits; if interrupted, inspect columns and values before continuing. Do not run on other tenants or the shared `db_spa_template` without explicitly deciding to enable this feature for them.
3. Verify: `SELECT COUNT(*) FROM products WHERE sale_price IS NULL OR sale_price <> price;` should return `0` immediately after backfill (before editing prices), including soft-deleted products. Then test POST/PUT/GET product and POST invoice with explicit `unit_price`.
4. Deploy backend from a **new** tag after verification. Do not alter or reuse `backend-xuly-v1.0.0`. Confirm frontend always sends the selling unit price on invoice create/update.

The **customer server's** shared template remains unchanged in this customer-specific rollout. A newly created tenant cloned from that old template will need the migration before using the new product code. Plan that separately before creating new tenants on the updated backend. Other existing tenants likewise require the column if they will call the changed product endpoints; deploy to a shared backend only after accounting for every tenant on it.