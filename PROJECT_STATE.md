# PROJECT STATE - read this first

## Branch: main
- Shared baseline; latest feature base 6a05e90 (legacy debt + customer balances). Tenant-specific branches may have extra schemas/logic: merge selectively.
- Local shared environment: backend 5000 / MySQL 3306, D:\SpaConfigs\main-3306.env (ohina-xuly.env also shared). Verify runtime config.
- Core: invoices/wallet/debt, treatment cards, appointments/bookings, commissions/reports, customer note history, staff date restrictions.
- Tests previously passed in this work: test:legacy-debt, test:legacy-debt:mysql (disposable 3349), test:customer-upgrade, test:invoice-notes. Not rerun on this branch for this documentation-only task.
- Dev DB 3306 had a user-approved legacy-debt test setup; never copy its balances to Rosa/live customers. Historical 1.42M mismatch traced to deleted test receipts during table recreation, not proven API arithmetic bug.

## Read first / rules
- Run git branch --show-current and git status --short before work; this file is a snapshot, not live deployment truth. Update it after feature/schema/environment changes; keep it short, no secrets or customer PII.
- Windows/PowerShell; root D:\Project\SpaManagement\spa-management-backend. Node CommonJS, Express 5, mysql2/promise, JWT, bcryptjs; no ORM/TypeScript.
- src/routes -> controllers -> services (SQL/transactions); src/config/database.js resolves tenant DB from master tenants. New schema needs template + migration for existing tenants.
- .env is ignored and DOES NOT follow branch switches. Stop backend before switching environment; inspect PORT/DB_PORT only, never print credentials. Config copies: D:\SpaConfigs.
- Never DROP/recreate populated accounting tables or reset total_debt automatically. Backup + explicit approval before live writes/migrations; mock tests preferred. Some :mysql tests touch configured DB: inspect first.
- npm start / npm run dev. Tests are node scratch/*.js (see package.json); git diff --check + node --check edited JS. Do not claim a test/deploy passed without evidence.

## Shared current debt contract
- POST /api/debt-payments requires invoice_id. POST /api/debt-payments/legacy uses customer_id, amount, collection_branch_id (MANAGER); STAFF uses token branch.
- Legacy receipts invoice_id=NULL, branch_id=collection_branch_id; transactional customer lock, positive cents, cap at total_debt minus remaining invoice debt. Edit/delete reconcile/refund balance.
- Customer detail data and overview data.customer expose invoice_debt/legacy_debt (numbers); total_debt keeps existing DECIMAL type. Whole customer/tenant, no branch/date/page filtering. Shared SQL: src/utils/customerDebt.js.
- Legacy cash/revenue goes to collecting branch by payment_date; legacyDebtRevenue adds to totalRevenue, never add receipt cash twice. Invoice-linked receipts do not add sales revenue again.
- docs/LEGACY_DEBT_PAYMENTS_API.md; migration docs/migrations/2026-10-29_legacy_debt_payments.sql makes invoice_id nullable. Verify target schema; merge is NOT migration/deployment.

## Next AI handoff
- Ask user for next goal; do not resume historical DB writes. Read only relevant files, not entire docs tree.
- This file is branch-local; when merging, retain target branch identity/environment + incorporate verified new shared features. Do not accept an incoming branch header blindly.
- Documentation snapshot from session following 2026-10-29 debt work; verify current git/config/process state instead of trusting old dates.
