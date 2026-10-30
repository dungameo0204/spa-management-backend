# PROJECT STATE - read this first

## Branch: O'HINA
- Feature base 42dd1b9, tag backend-ohina-v1.0.6. Contains main legacy-debt feature; differs from main in deployment/import/backup assets, not Rosa treatments/profile.
- Shared local environment with xuly: backend 5000 / MySQL 3306; D:\SpaConfigs\ohina-xuly.env. Do not assume MySQL 3307.
- Branch assets: deploy/bootstrap/Install-SpaBackend-OHINA.ps1 + README_AI_INSTALL_OHINA.md; scripts/upload-backup-r2.js; scripts/windows/Backup-SpaDatabase.ps1.
- Import SQL: docs/migrations/customers_complete_with_debt.sql, customers_import.sql, customers_omskin_import.sql, products_omskin_import.sql, services_omskin_import.sql. Treat as sensitive customer data; inspect targets, backup, never execute blindly.
- Prior date investigation: execution_date TIMESTAMP; date-only local midnight serializes to previous UTC day. Frontend must convert timezone, not slice UTC date. Specific incident not fully established; do not blanket-shift DB dates.
- package.json includes test:legacy-debt; tests not rerun here for documentation-only task. Runtime/migration state must be checked separately.

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
