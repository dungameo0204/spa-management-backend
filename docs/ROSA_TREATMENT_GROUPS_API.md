# Rosa treatment groups — 2026-10-27

No new schema migration. Uses existing treatment hierarchy, lifetime, closure and price-snapshot columns. Examples use authenticated tenant MANAGER tokens unless noted. Execution/list/detail retain existing authorization; both MANAGER and STAFF can collect the customer's completion signature.

## Invoice creation (preferred)

`POST /api/invoices` creates the invoice, items and actual customer-specific cards in **one transaction**. Do not call `POST /api/treatments` again for the same purchase.

```json
{
  "customer_id": 10,
  "branch_id": 1,
  "paid_amount": 4500000,
  "items": [{
    "product_id": 20,
    "quantity": 1,
    "unit_price": 4500000,
    "treatment": {
      "total_sessions": null,
      "children": [
        {"product_id": 12, "total_sessions": 5},
        {"product_id": 15, "total_sessions": null},
        {"product_id": 18, "total_sessions": 0}
      ]
    }
  }]
}
```

- Explicit treatment configuration requires `quantity=1`. For multiple configured packages use separate invoice lines; counts are **per line**, not multiplied. This is intentionally rejected rather than silently guessing quantity semantics.
- Without `treatment`, legacy behavior remains: ordinary service gets one session; combo gets `default_sessions × quantity`; retail gets no card.
- Parent `total_sessions` is required, positive integer or `null` (lifetime).
- `children` is optional; an empty array or all-zero choices creates only the parent. Every supplied child, even a skipped child, must be a unique active service currently configured under the parent product in the same tenant.
- Child `total_sessions`: `0` skips creation, positive integer creates finite card, explicit `null` creates lifetime card. Missing, negative, fractional and invalid/coerced values are rejected. Numeric integer strings remain compatible with existing form APIs.
- Children accept **only** `product_id`, `total_sessions`; client prices are rejected. Snapshot `products.price` (not `sale_price`) into each child's `commission_base_price`; commission quantity is 1. Later product-price changes do not alter this snapshot. No child invoice charge.
- Children and parent share customer/invoice/invoice-item IDs. `itemMappings[]` includes root `treatment_id` and created `children` IDs/counts for explicit configurations. Any failure rolls back invoice/cards/wallet/debt/inventory together.

## Manual groups

`POST /api/treatments` (MANAGER) accepts existing manual fields plus `children` using the same child contract. Requires `customer_id`, `product_id`, `total_sessions`, `commission_base_price`; optional `remaining_sessions`, `commission_quantity`, `note`. Creates the group transactionally without invoice linkage. Direct client `parent_treatment_id` or `invoice_id` assignment remains prohibited. Do not use this endpoint after invoice creation.

## Reads

- `GET /api/treatments`: outer `data[]` and pagination totals contain **roots only**, with nested `children`. Filters apply to roots; children are not removed for exhausted/closed state. `active` means unsigned/open, including exhausted finite cards awaiting signature; `completed` means signed/closed; `exhausted` means open with zero remaining sessions.
- `GET /api/treatments/:id`: returns `data` with `children`; every returned card has its own `histories` with `staffs`. Direct child detail remains available.
- `GET /api/invoices/:id`: `data.items[].treatment` is actual root plus `children`, or `null` when no linked root exists. Historical cards with no `invoice_item_id` are not guessed/reassigned by this read.
- `GET /api/customers/:id/overview`: root-only `treatments`, nested children/history; purchase treatment matches only roots, avoiding duplicate child timeline entries.

## Signed completion

`POST /api/treatments/:id/close` — authenticated tenant MANAGER or STAFF; ID must be a root. Signing the parent completes the parent and **all non-deleted descendant cards together**, including lifetime cards. No separate child signature/request is required.

```json
{
  "closure_note": "Khách hàng xác nhận hoàn thành",
  "closure_signature_svg": "<svg width=\"300\" height=\"100\"><path d=\"M 10 20 L 50 60\" stroke=\"black\" fill=\"none\"/></svg>"
}
```

- Required nonempty path-based SVG, max 128 KiB. Narrow accepted dialect: `svg` root with `viewBox` or numeric width/height, direct `path` children, numeric path data and allowlisted paint/stroke attributes. No script, event handlers, text, groups, image, links, style, XML declarations/entities, data URLs or external resources. Export signature-pad strokes as paths; arbitrary SVG exports may need conversion. Validator rebuilds markup before storage. Frontend should still render via an image rather than untrusted HTML injection.
- `closure_note` optional string/null, max 65535 UTF-8 bytes. This signature is separate from per-session `customer_signature_svg`; session signatures are accepted at session creation as described below.
- Locks root and descendants, checks customer consistency, atomically stores closure note/signature/actor/time and sets remaining sessions to 0. Original totals/history/commission rows remain unchanged by closure. Open lifetime totals stay NULL after closure; remaining becomes 0.
- Empty/malformed signature or child-ID closure: 400; missing card: 404; repeated closure: 409; unauthenticated: 401; roles other than MANAGER/STAFF, customer tokens or invalid tenant claims: 403. Existing closed child inside an open group requires reconciliation rather than overwriting its signature.
- Finite cards do not auto-close when exhausted. Parents with children cannot execute. Closed groups cannot execute. Undo history retains existing soft-delete behavior but cannot increment a closed card or reopen it; it does not erase the completion signature.
- Invoice PUT rejects treatment configuration and protects lifetime/hierarchical/closed cards from legacy reconciliation. Invoice DELETE also rejects lifetime/hierarchical/closed cards. Dedicated amendment/refund/reopening workflows are not part of this API.

## Per-session note and signature

`POST /api/treatments/execute` retains existing MANAGER/STAFF execution/branch rules and accepts optional `note` and `customer_signature_svg` at creation:

```json
{
  "treatment_id": 123,
  "branch_id": 1,
  "note": "Da hơi đỏ, lưu ý theo dõi buổi tiếp theo.",
  "customer_signature_svg": "<svg width=\"300\" height=\"100\"><path d=\"M 10 20 L 50 60\"/></svg>"
}
```

`note`: string, max 65535 UTF-8 bytes, trimmed; absent/null/whitespace becomes NULL. Signature: absent/null means unsigned; any supplied string must pass the same narrow SVG validator and 128 KiB limit as completion signatures. Empty strings and malformed SVG are rejected. Server sets `customer_signed_at` when a signature exists; client-supplied `customer_signed_at` is rejected. Existing payloads without these fields remain valid. Metadata is stored atomically with history/session decrement/commissions; errors roll everything back.

Root/child treatment detail and customer overview expose these fields in each card's `histories[]`. Session signatures never set `closed_at` or complete a group, even when a finite card reaches zero sessions. Group completion still requires the separate root `/close` operation. No post-creation note-edit or supplemental-signature endpoint is provided. Render notes as text and signatures via images, not arbitrary HTML.

## Verification commands

From repository root: `npm run test:treatment-groups`. For HTTP/MySQL integration explicitly set `DOTENV_CONFIG_PATH=D:\SpaConfigs\rosa.env`, then `npm run test:treatment-groups:mysql`. The integration test refuses non-local/non-3308 configurations, checks tenant 7 DB mapping and server port, and runs all writes inside an outer transaction with service savepoints, then rolls back and verifies fixture removal. AUTO_INCREMENT values may still advance. It does not test true concurrent connections or browser rendering of SVG.