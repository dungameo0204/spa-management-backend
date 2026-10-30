# PROJECT STATE - whole-project map and branch handoff

Read this before exploring code. Snapshot, not live deployment proof. First check git branch --show-current and git status --short; then read only task-relevant source/docs.

## Whole-project architecture
- Purpose: multi-tenant spa operations backend. Superadmin provisions spas; managers/staff manage customers, sales, treatments, scheduling, stock, staff and cash/reporting. A branch is a location WITHIN a spa, not a tenant or Git branch.
- Stack: Node CommonJS, Express 5, mysql2/promise, JWT, bcryptjs, dotenv, CORS. No ORM/TypeScript/test framework. Windows PowerShell; repository D:\Project\SpaManagement\spa-management-backend.
- Entry src/server.js loads .env, validates src/config/server.js, mounts routes, checks DB, starts HTTP. routes -> auth middleware -> controllers (HTTP) -> services (SQL/transactions); utils hold shared validation, pagination, dates and storage.
- src/config/database.js: masterPool/getTenantDbName(tenantId). db_system_master stores tenants, users, subscription_packages, pending_orders, payment_logs. Each spa owns database named by tenants.database_name; services issue qualified tenant SQL through pool. Tenant identity comes from JWT, never payload.
- db_system_master.sql / db_spa_template.sql are schema snapshots. Tenant creation clones template tables; changing template does NOT migrate existing tenants. Add explicit docs/migrations SQL/scripts; do not import schema dumps over populated databases.

## All business domains and navigation (API prefix /api)
| Domain | APIs / responsibilities / source |
|---|---|
| Auth | /auth/login, /auth/me; password hash verification, token claims/expiry and login limiter. authService, auth middleware. |
| SaaS administration | /tenants: SUPER_ADMIN creates spa + initial MANAGER + database, lists/details, updates/renewal, manager password reset, soft delete/restore. tenantService. Subscription schema is not proof of a mounted billing endpoint. |
| Personnel | /users (/create) login accounts; /branches locations; /roles business commission roles; /staffs operational employees. A login user and a service staff record are different resources. Business roles are not JWT system_role. |
| Customers | /customers CRUD/search/restore and manager password reset; /:id/overview combines customer, purchases, treatments, history/timeline. Wallet/debt stored on customer; never return password. customerService. |
| Catalog | /products: goods/services/combo flags, price/sale_price/default sessions, commission settings/tiers. Product flags drive inventory vs treatment creation. productService/commissionService. |
| Stock | /inventory-imports header/items and branch-product inventory. Imports add stock; invoice goods consume it. Edits/deletes reverse/reapply inventory effects. inventoryImportService/invoiceService. |
| Expenses | /expenses vouchers/item breakdown, branch attribution and business dates; CRUD with permissions and staff-date constraints. expenseService. |
| Sales | /invoices header/items/consultant allocations. One transaction coordinates discounts, payment, wallet, customer debt, inventory, treatment cards and customer note events. invoiceService plus branch-specific helpers. |
| Treatments | /treatments lists/details, MANAGER manual cards, execute sessions, remove history, assign staff, commissions. treatment_history and treatment_history_staffs store execution/commission snapshots. Rosa extends groups/lifetime/signing (branch section). |
| Scheduling | /appointments CRUD, tomorrow/not-arrived; treatment execution integrates appointments. /customer-bookings is a separate booking resource. Methods/permissions vary by branch; read the matching route/service. |
| Wallet | /customer-wallet-logs topup/bonus and edit/delete. customerWalletLogService updates balance with transaction/ownership checks. |
| Debt | /debt-payments linked or legacy collection, list/detail/edit/delete and invoice remaining-debt lookup. debtPaymentService/customerDebt utility; exact contract below. |
| Reports | /reports/revenue, products, products/:productId/invoices, details/:type, commissions/consultants and detailed staff allocations. reportService; router requires MANAGER. Totals cover full filter scope, not just a page. |
| Operations | /health DB health check. server.js is the authority for mounted routes: miniappRoutes and tables for orders/promotions/bank_transactions/app_contents do not prove live public API availability. |
- For exact method/payload read src/routes/<domain>Routes.js + controller/service, not guessed table-to-route mapping. docs/API_FRONTEND.md is full integration reference; docs/SUPERADMIN_FRONTEND.md covers SaaS admin.

## Data graph and end-to-end invariants
- Tenant: branches, customers, products, staffs/roles; invoice -> invoice_items -> invoice_item_consultants; treatments reference invoice/item/customer/product -> treatment_history -> treatment_history_staffs. Inventory: inventory_imports/items + inventory. Cash: customer_wallet_logs, debt_payments, expense_vouchers/expenses_vouchers_items.
- Most deletes use deleted_at/deleted_by, not physical delete. Keep parent/dependency soft-delete filters, snapshots, IDs/history and rollback behavior. Financial SQL belongs in transactions with row locks, not controllers.
- Invoice lifecycle: normalize goods/services and discounts -> validate payment/stock/customer -> persist header/items/allocations -> adjust stock, wallet, debt and service cards -> commit. Update reverses old effects and applies new; delete reverses effects subject to payment/treatment usage guards. Inspect branch logic before changing reconciliation.
- Invoice debt = total_amount - paid_amount - wallet_used; reject overpayment. total_debt is a stored aggregate, not sum of a paged invoice screen. Invoice creation adds debt; update reverses old/adds new; deletion reverses debt. Current shared flow prevents editing/deleting invoices with active linked debt receipts.
- Wallet topup balance credit = paid_amount + bonus_amount; only paid_amount is money collected. Invoice wallet use consumes balance, not another cash receipt. Edits/deletes must respect available wallet funds.
- Invoice-linked collections reduce customer debt but preserve original invoice debt_amount. Remaining invoice debt = max(0, debt_amount - active linked receipts). Editing receipt refunds old effect/applies new; soft delete refunds debt. Never treat original debt_amount as remaining after collections.
- Revenue != cash: service/product net sales after discounts vs invoice cash + debt collections + paid wallet topups. Invoice-linked collections do not generate sales revenue again. Inventory imports and expense vouchers are cash outflow in reports; netCashFlow is not accounting profit. Use source-specific dates/soft-delete rules.
- Commissions use product/business-role fixed/percentage/tier config and stored execution price/amount snapshots; treatment staffing commissions differ from invoice consultant revenue allocation. Read commissionService + reportService before formula changes.
- Invoice note events append dated text to customers.note in the same transaction (create/change/clear/delete/customer transfer); preserve text and UTF-8 limit. customers.note is editable, not immutable audit storage.

## Permissions, responses and dates
- SUPER_ADMIN manages tenants; MANAGER manages spa; STAFF performs branch-scoped operations. Router token checks are not universal authorization: services enforce branch/date ownership. Inspect exact route and service; customer/miniapp tokens must not acquire staff privileges.
- STAFF generally derives transaction branch from token; MANAGER selects branch. Exceptions: customers span locations, debt collection location may differ from invoice location, reports are MANAGER-only. Do not add branch filters to whole-customer balances.
- staffDatePolicy.js enforces relevant STAFF expense/import/history date restrictions; created_at and business date are distinct. MANAGER has broader rights, not blanket exemption from accounting invariants.
- Lists usually {message,total,page,pageSize,totalPages,data}; details {message,data}; create IDs may be top-level. pageSize max 100. mysql2 DECIMAL often strings. Unknown-field/validation rules are endpoint-specific, not global.
- Date-only business date, MySQL TIMESTAMP/DATETIME and UTC JSON differ. Convert timestamps to intended local calendar day, never fix by blindly slicing UTC or shifting DB history. Null treatment sessions means unlimited only where branch supports it.

## Running, deployment and testing
- npm ci (lockfile), npm start or npm run dev. Env PORT, DB_HOST/PORT/USER/PASSWORD/SYSTEM_NAME, JWT_SECRET; production NODE_ENV and CORS_ORIGINS. Never print/commit secrets or customer imports.
- Production validates required configuration + HTTPS CORS origins and binds loopback; dev host configurable. Windows wrapper deploy/windows/SpaBackend.xml; scripts/windows handle install, exact-tag release deploy, current junction, health check, rollback, auto-update and backup. Cloudflare/setup: docs/DEPLOY_WINDOWS_CLOUDFLARE.md and deploy/bootstrap. Git merge/push is NOT deployment/migration.
- .env is ignored and DOES NOT follow branch switches. Stop backend/nodemon before environment changes; confirmed settings in D:\SpaConfigs\README.md override obsolete history there. Verify PORT/DB_PORT without exposing credentials.
- Tests: node scratch/*.js, assert + SQL doubles/local HTTP. package.json lists suites: customer-upgrade, invoice-notes, staff-date-policy, auth-session, server-config, product-sale-price, deployment-security, legacy-debt; Rosa has additional suites. Run affected tests + node --check changed JS + git diff --check.
- test:legacy-debt:mysql starts isolated MySQL 3349 and checks datadir. Other :mysql tests may use configured DB or other disposable ports: inspect before running. Report actual mock/real test evidence; do not infer live migration success from unit tests.
- Never DROP populated financial tables, reset total_debt, run import SQL or migrate production automatically. Explicit approval, target verification and backup required. Keep financial effect and documentary history consistent.

## Branch: rosa
- Feature base 618b880; main merged as c6c379b. Merge conflicts already resolved before this documentation task; retain BOTH Rosa profile/rootCards and withDebtBalances.
- Environment: backend 5002 / MySQL 3308; D:\SpaConfigs\rosa.env; tenant 7. Never use 3306 as Rosa data.
- Rosa-specific: extended customer profile, multi-image skin sessions, product components, parent/child treatment groups, lifetime cards, customer bookings, appointment contact-note entries, session note/signature, invoice amendments preserving card/history/signatures.
- Execute child, not group parent. Lifetime NULL is unlimited. Session sign does not close card; root completion closes group. Notes editable before/after signing, signature cannot be overwritten. Closed cards remain closed on invoice edits.
- Child commissions use child configuration + price snapshot. Used/signed children cannot be removed; used/signed cards cannot change customer. Verify quantity rules in treatmentGroupService; older docs have stale quantity=1 wording.
- Read docs/ROSA_FRONTEND_CHANGELOG.md only when needed, then relevant ROSA_*_API.md. New legacy debt docs also apply; deployment/migration on 3308 NOT verified by this task.
- Just verified after merge: npm run test:legacy-debt, test:customer-profile, test:treatment-groups, test:appointment-contact-notes all PASS (mock/HTTP, no live DB).


## Shared current debt contract
- POST /api/debt-payments requires invoice_id. POST /api/debt-payments/legacy uses customer_id, amount, collection_branch_id (MANAGER); STAFF uses token branch.
- Legacy receipts invoice_id=NULL, branch_id=collection_branch_id; transactional customer lock, positive cents, cap at total_debt minus remaining invoice debt. Edit/delete reconcile/refund balance.
- Customer detail data and overview data.customer expose invoice_debt/legacy_debt (numbers); total_debt keeps existing DECIMAL type. Whole customer/tenant, no branch/date/page filtering. Shared SQL: src/utils/customerDebt.js.
- Legacy cash/revenue goes to collecting branch by payment_date; legacyDebtRevenue adds to totalRevenue, never add receipt cash twice. Invoice-linked receipts do not add sales revenue again.
- docs/LEGACY_DEBT_PAYMENTS_API.md; migration docs/migrations/2026-10-29_legacy_debt_payments.sql makes invoice_id nullable. Verify target schema; merge is NOT migration/deployment.


## Handoff and maintenance
- No new business-code/DB change in this documentation task. Ask user for next goal; do not resume historical test-data writes. Recheck runtime/env/migration state.
- Maintain whole-project map AND branch identity when adding domains, rules, schema or deployment changes. Recent work is only the branch section, not a replacement for architecture.
- On merge preserve target branch environment/features and incorporate verified shared changes; never accept incoming identity blindly. docs/CONTEXT.md contains older history; current source wins.
- Base hashes/dates identify historical context, not current HEAD. Keep secrets, customer PII, full API dumps and raw logs out; detail belongs in referenced docs/code.
