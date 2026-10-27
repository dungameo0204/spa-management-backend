# Rosa customer bookings

Uses existing `customer_bookings` schema; no migration. Internal employee-created bookings, authenticated tenant MANAGER/STAFF only (customer tokens/other roles rejected). Both roles can read all bookings across branches within the same spa. STAFF update/delete remain restricted to token branch; create defaults to token branch when omitted, and explicit other branch is rejected. MANAGER selects any active tenant branch. Arrival dates may be past or future; no same-day-only rule is imposed on booking dates.

## Endpoints

- `POST /api/customer-bookings`: 201 `{message, bookingId}`.
- `PUT /api/customer-bookings/:id`: partial update, 200 `{message, bookingId}`. Omitted fields stay unchanged; explicit null clears nullable fields. No restore endpoint.
- `DELETE /api/customer-bookings/:id`: soft delete, 200 `{message, bookingId}`; records actor. Missing/deleted/out-of-scope booking returns 404.
- `GET /api/customer-bookings/:id`: existing `{message,data}` response, includes every booking column, joined branch/product/registered-customer names and boolean `has_arrived`. STAFF can read other branches too.
- `GET /api/customer-bookings`: existing paginated response; filters `branchId`, `customerId`, `productId`, `status`, `search`, `startDate`, `endDate`, `startTime`, `endTime`, `page`, `pageSize`. Date bounds apply to `arrival_date` inclusive; ordering arrival date/time, created_at, id ascending. Branch filter is optional for both roles. Search matches snapshot name/phone, note or product name. Soft-deleted bookings excluded.

## Time filters and arrival indicator

Example: `GET /api/customer-bookings?search=Lan&startDate=2026-10-27&endDate=2026-10-30&startTime=07:00&endTime=08:00`.

- Time bounds accept HH:mm or HH:mm:ss and apply to `arrival_time` on each selected day, inclusive (07:00:00 through 08:00:00). Either bound can be used alone. Unknown/null arrival times are excluded when a time bound is supplied. Invalid/empty bounds or startTime > endTime return 400; overnight ranges are not supported. Pagination total includes all filters.
- `has_arrived` is a computed boolean in list/detail, not a DB column or a status update. True when the customer has at least one non-deleted invoice OR treatment card **created** from 00:00 of the booking's `created_at` calendar day through DB NOW(), using the MySQL session timezone. It does not use arrival_date, invoice_date or treatment execution history. Earlier activity on the same day counts, allowing arrival before the scheduled appointment or booking creation time. Activity before that day, in the future or soft-deleted does not count. No branch/product restriction on matching activity within the tenant.
- EXISTING matches customer_id, never a different customer sharing snapshot phone. NEW with no customer_id matches registered customers by exact stored phone (not name, partial match, country-code or punctuation normalization); any matching customer's qualifying activity counts. No match means false. Customer soft deletion does not erase invoice/card evidence; invoice/card soft deletion does remove that evidence on the next read. A null historical booking created_at has no provable window and yields false. This is an activity-derived indicator, not physical check-in; no changes to invoice/card/booking status are performed.

## Create NEW customer booking

```json
{
  "customer_type": "NEW",
  "customer_name": "Nguyễn Khách Mới",
  "customer_phone": "0901234567",
  "branch_id": 1,
  "product_id": null,
  "arrival_date": "2026-11-01",
  "arrival_time": "09:30",
  "promotion_note": "Ưu đãi khách mới",
  "consultation_total": "1500000.00",
  "note": "Khách cần tư vấn",
  "status": "PENDING"
}
```

## Create EXISTING customer booking

```json
{
  "customer_type": "EXISTING",
  "customer_id": 10,
  "branch_id": 1,
  "arrival_date": "2026-11-01"
}
```

- NEW requires nonblank name/phone, customer_id absent/null. Does not create a registered customer automatically.
- EXISTING requires active customer_id. Missing snapshot name/phone defaults to registered customer values on creation or customer selection change. Explicit snapshot overrides are allowed. Note-only updates preserve snapshots. Switching to NEW requires clearing customer_id and supplying valid name/phone; switching to EXISTING requires customer_id.
- Active branch required; optional product_id references any active tenant product/service, since schema does not restrict product type. Nullable IDs accept null, not 0/empty string.
- Required arrival_date is a real calendar date `YYYY-MM-DD`; optional arrival_time accepts `HH:mm`/`HH:mm:ss` within 00:00:00–23:59:59 or null. Legacy booking_time is server-derived from arrival date/time, NULL if time unknown; never inferred as midnight. Client booking_time is rejected.
- customer_name max 255 characters, customer_phone max 50; note/promotion_note max 65535 UTF-8 bytes, trimmed; whitespace becomes null. NEW name/phone must not be blank.
- consultation_total is advisory, defaults 0, nonnegative DECIMAL(15,2), max 9999999999999.99; numeric or decimal string, no more than two fractional digits. No invoice, payment, inventory, wallet or debt writes.
- status defaults PENDING; nonblank string max 50 characters. Schema uses VARCHAR, not ENUM: no invented status transition restrictions. Frontend should consistently use its agreed business codes.
- Only the documented payload fields are accepted. Audit fields, id, booking_time and unknown fields rejected. Creation/update/delete are transactional; update/delete lock the booking, referenced active records are checked within the transaction.
- 400 invalid payload/reference/date/filter; 401 missing/invalid token; 403 unsupported role or STAFF branch move/create violation; 404 unavailable/out-of-scope ID. List/detail retain existing response envelopes.

## Tests

`npm run test:customer-bookings`. For HTTP/MySQL integration set `DOTENV_CONFIG_PATH=D:\SpaConfigs\rosa.env`, then `npm run test:customer-bookings:mysql`. Requires local Rosa 3308, verifies tenant 7 DB mapping and server port. All fixture/service writes use outer transaction plus service savepoints and are rolled back; AUTO_INCREMENT may advance. Does not test live multi-connection races or MiniApp.