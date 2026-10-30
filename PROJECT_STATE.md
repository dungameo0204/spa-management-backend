# PROJECT STATE - read this first

## Branch: xuly
- Feature base a7a3a99 (main merged, includes legacy debt); prior release tag backend-xuly-v1.0.5 is older. No Rosa-specific treatment/profile extensions assumed.
- Shared local environment with O'HINA: backend 5000 / MySQL 3306; D:\SpaConfigs\ohina-xuly.env. Old notes about missing config/3307 are superseded.
- Diff from main: docs/migrations/customers_import.sql; scripts/upload-backup-r2.js; scripts/windows/Backup-SpaDatabase.ps1. Imports contain sensitive data; never run automatically or paste contents.
- package.json includes test:legacy-debt; tests not rerun here for documentation-only task. Live deployment/migration state not established.

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
