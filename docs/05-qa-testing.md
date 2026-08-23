# QA, Test Catalogue & Release Gates

## Test layers
Unit, database, Supabase RLS/security, integration, Web UI, iOS, Android, end-to-end, localization, performance and regression tests as applicable.

## Release-critical tenant tests
Fixture: Organization A/User A and Organization B/User B.
- RLS-T-001: A reads A products.
- RLS-T-002: A cannot read B products.
- RLS-T-003: A cannot read B batches.
- RLS-T-004: A cannot read B inventory movements.
- RLS-T-005: A cannot update B products.
- RLS-T-006: A cannot create B transactions.
- RLS-T-007: request parameter manipulation cannot bypass RLS.
- RLS-T-008: direct client Supabase calls cannot bypass RLS.
- RLS-T-009: staff cannot elevate own role.
- RLS-T-010: public customer cannot access private tables.
Any failure blocks release.

## Inventory tests
- Receiving 100 creates +100 movement.
- Sale of 3 creates -3 movement.
- Eligible refund creates correct compensating movement.
- Adjustment requires reason.
- Balance equals ledger calculation.
- Movements cannot be ordinarily updated/deleted.
- Negative stock rejected.
- Concurrency: with available=1, two simultaneous requests for 1 result in exactly one success and final stock=0.

## Batch/expiry tests
- Same product supports batches with independent expiry/stock.
- Expired/recalled/quarantined batches are unsellable.
- Depleted batches remain historical.
- Threshold calculations are correct at boundaries (91/90, 30, 7, expired).
- Duplicate expiry notifications are controlled.
- Value at risk uses remaining quantity × appropriate cost.
- FEFO selects earliest eligible valid batch and skips forbidden statuses.

## Purchasing tests
- Multi-item PO creation.
- Partial receipt updates remaining quantity/status.
- Final receipt sets Received.
- Receipt requires batch data.
- Receipt creates correct inventory movements.
- Same idempotency key cannot double-receive.

## POS tests
- Barcode lookup.
- FEFO selection.
- Forbidden batch rejection below UI.
- Insufficient stock blocks checkout.
- Successful sale reduces inventory once.
- Retry cannot duplicate sale.
- Receipt totals match sale.
- Payment types record correctly.
- Unauthorized discount/refund rejected.
- Refund references original transaction and preserves original history.

## Exchange tests (P1)
- Opt-in required; unpublished inventory invisible.
- Expired/recalled/quarantined/shelf-life-ineligible inventory cannot list.
- Request cannot exceed eligible offered quantity.
- Partial approval works.
- Approval does not instantly create destination inventory.
- Dispatch/receipt create correct controlled movements.
- Batch traceability survives transfer.
- Transfer cannot complete twice.
- Duplicate requests are idempotent.
- Unauthorized approval rejected.
- Third-party pharmacy cannot see private commercial details.
- Country restrictions block prohibited transactions.
- Discrepancy/dispute preserves audit history.

## Medicine Locator tests (P1)
- Only opted-in public projection rows appear.
- Private stock never appears.
- Exact quantity hidden by default.
- Price only appears if published.
- Supplier/cost/private batch/customer/sales data never exposed.
- Basic search works without account.
- Geolocation permission is optional; manual location remains possible.
- No autonomous substitution advice.
- Public abuse-sensitive endpoints rate-limited.

## Reservation tests (P1)
- Request starts REQUESTED.
- Pharmacy acceptance reserves eligible quantity.
- Reserved quantity is not freely available.
- Rejection reserves nothing.
- Expiry/cancellation releases stock.
- Collection enters legitimate sale workflow.
- Concurrency prevents double-reserving final unit.
- Customers cannot read another customer's reservation.

## Import tests
CSV/Excel-compatible import, mapping, validation, preview-before-commit, invalid date/quantity handling, duplicate barcode warnings, error reporting, tenant isolation and asynchronous handling for large imports.

## Localization tests
Critical journeys run in both English and French. No raw translation keys visible. Accents render. Currency/date formatting is appropriate. Receipts, email/push/error messages localize correctly. Missing critical translations block completion.

## Mobile tests
iOS and Android: login, barcode permission/scan, lookup, quick sale, receiving, expiry alert, branch switch, language switch, offline state, background/resume, expired session and authorized push deep links.

## Offline/idempotency tests
Network interruption/retry cannot duplicate sales, receipts, exchange dispatch/receipt or reservations. Conflicting sensitive offline stock state requires deterministic reconciliation rather than silent last-write-wins.

## Security checklist tests
No committed secrets; service-role key absent from client; RLS on tenant tables; storage policies; input validation; rate limiting; vulnerable dependencies reviewed; logs exclude passwords/tokens; staging/production secrets separated; local/JWT manipulation cannot grant capabilities.

## Performance targets (initial, subject to pilot measurement)
- Typical backend barcode lookup target: ~500ms under supported normal conditions.
- Public medicine search target: <2s typical.
- Dashboard usable target: ~2s after application shell/cache conditions, connectivity dependent.
- Large product lists use pagination/virtualization.
- Large imports asynchronous.

## Critical E2E scenarios
1. Purchase → receive batch → inventory 100 → sell 2 → inventory 98 → receipt.
2. Expired batch → attempt sale → backend rejects.
3. Exchange: A lists → B requests → A approves/dispatches → B receives → source/destination correct and traceability preserved.
4. Locator: A publishes, B does not → public search may show A and never B's private stock.
5. Reservation: stock 5 → reserve 2 → available 3/reserved 2 → collection → legitimate sale and consistent inventory.
6. Tenant attack: User A substitutes Organization B UUID → database RLS rejects.

## Release blockers
Tenant/RLS failure, inventory integrity failure, forbidden-batch sale, financial/inventory duplication, idempotency failure, privilege escalation, Exchange corruption, Locator privacy leak, critical EN/FR failure, invalid production build or unsafe migration.

## Seed fixtures
At least two organizations, multiple branches/roles, ~20 representative products, active/near-expiry/expired/recalled/quarantined batches, EN/FR customers and multiple suppliers.

## QA Definition of Done
P0 requires applicable unit + integration + RLS + critical E2E coverage. P1 Exchange/Locator requires dedicated security/privacy/integrity coverage before release.
