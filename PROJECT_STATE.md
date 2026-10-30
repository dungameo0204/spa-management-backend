# PROJECT STATE - read this first

## Branch: rosa
- Feature base 618b880; main merged as c6c379b. Merge conflicts already resolved before this documentation task; retain BOTH Rosa profile/rootCards and withDebtBalances.
- Environment: backend 5002 / MySQL 3308; D:\SpaConfigs\rosa.env; tenant 7. Never use 3306 as Rosa data.
- Rosa-specific: extended customer profile, multi-image skin sessions, product components, parent/child treatment groups, lifetime cards, customer bookings, appointment contact-note entries, session note/signature, invoice amendments preserving card/history/signatures.
- Execute child, not group parent. Lifetime NULL is unlimited. Session sign does not close card; root completion closes group. Notes editable before/after signing, signature cannot be overwritten. Closed cards remain closed on invoice edits.
- Child commissions use child configuration + price snapshot. Used/signed children cannot be removed; used/signed cards cannot change customer. Verify quantity rules in treatmentGroupService; older docs have stale quantity=1 wording.
- Read docs/ROSA_FRONTEND_CHANGELOG.md only when needed, then relevant ROSA_*_API.md. New legacy debt docs also apply; deployment/migration on 3308 NOT verified by this task.
- Just verified after merge: npm run test:legacy-debt, test:customer-profile, test:treatment-groups, test:appointment-contact-notes all PASS (mock/HTTP, no live DB).

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
