# POS, sales and refunds completion

## Workspace and required baseline

Implemented only in `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, branch `codex/catalog-opening-stock`, inherited HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`. All eight accumulated packages were required baseline: owner first use/navigation, catalog/opening stock, locale/hydration, purchasing/receiving, inventory/counts, expiry/quarantine/disposal, transfers and staff/access/invitations.

Before editing, the exact directory, branch, working diff, package documents and source were inspected. Eight baseline suites passed 170 tests. SHA-256 fingerprints recorded 374 inherited files. Only five inherited files were deliberately extended; the other 369 remain unchanged, including dependency manifests/lockfile, earlier package documentation, migrations and evidence. No reset, clean, stash, checkout, commit, push, merge, hosted access or deployment occurred. No Daybreak work, adversarial testing, Stage 01/02 evidence work or direct-link-reset repair was performed.

Traceability: PRD-002, POS-FR-001 through POS-FR-008, BAT-FR-003/004, BR-002/003/004/005/006/008/009/016/017 and US-POS-001.

## Files changed

Extended inherited files:

- `app/pos.tsx`
- `src/services/sales.ts`
- `src/navigation/items.ts`
- `src/i18n/index.ts`
- `src/offline/offlinePosReplay.test.ts` (updates the moved-history wiring assertion)

New files:

- `app/sales.tsx`
- `src/domain/posCompletion.ts`, `src/domain/posCompletion.test.ts`
- `src/services/posCompletion.ts`, `src/services/posCompletion.test.ts`
- `src/services/posAttempts.ts`, `src/services/posAttempts.test.ts`
- `src/components/QuoteAllocation.tsx`
- `src/components/Receipt.tsx`
- `src/components/SaleDetails.tsx`
- `src/components/SalesHistory.tsx`
- `src/components/posCompletion.presentation.test.tsx`
- `src/components/salesHistory.route.test.tsx`
- `src/utils/printReceipt.ts`, `src/utils/printReceipt.web.ts`, `src/utils/printReceipt.web.test.ts`
- `src/i18n/posReady.en.json`, `src/i18n/posReady.fr.json`
- `supabase/migrations/20261118163907_pos_sales_refunds_completion.sql`
- `supabase/tests/pos_completion_functional.sql`
- `scripts/test-pos-functional.ps1`
- `scripts/pos-ui-fixture.mjs`
- this document

## Lookup, cart and pricing

Text/SKU/barcode search reuses the existing catalog search operation. Exact scanner/keyboard barcode entry (Enter or Add) resolves the existing `product_barcodes` mapping, including alternate codes for one product. Unknown/inactive products and ambiguous mappings have localized errors; ambiguity never silently selects a product. Cached text search remains the inherited offline path. Exact barcode resolution is online-only and explains that limitation.

Cart quantities accept dot or comma decimals at the existing four-decimal stock scale, and reject malformed, nonpositive, excessively precise or unsafe-magnitude values. Invalid input blocks checkout. Product and stock units remain visible. Each server-quoted allocation displays lot, expiry, quantity, selling price and line total, including multiple lots and prices for one product. Missing/failed quotes block completion. Insufficient and blocked stock have clear guidance; eligibility and FEFO remain server-controlled.

Checkout re-quotes before submission. Changed prices or allocation require explicit acceptance. The new reviewed overload of the existing sale command delegates to the existing atomic sale/customer worker and compares the resulting actual sale items with the accepted quote inside that same transaction. A changed allocation, including a same-total change, aborts and rolls back sale/items/payments/movements. No client-supplied price overrides the server price. Existing ledger and FEFO implementations were not replaced.

## Payment and completion

Existing configured payment preference initializes POS and is restored after completion; the cashier may change the current sale. Cash tender must cover the due amount at two-decimal precision. Only the exact due amount is a payment; tender/change are separate receipt metadata. Noncash methods record externally collected payments, with optional external reference and explicit guidance that this app does not process those funds.

The reviewed online command saves cash tender/change atomically and uses the organization's currency for the sale. Completed results open a structured receipt with business/branch, reference, time, cashier, products/units, actual lot lines, prices, total, existing discounts when present, payments and footer.

An immediate submission guard prevents double-click dispatch. Existing identity generation remains in use. Before a command is sent, the immutable attempt is durably saved through the existing storage adapter in a namespace scoped by user/organization/branch (and sale for refunds). This is retained form/result recovery state, not a new replay scheduler or transaction framework. Storage failure prevents dispatch and leaves the form usable. Read-model cleanup/sign-out cannot erase an uncertain attempt. Other users/organizations/branches use different keys.

Uncertain sales retain a locked cart, submitted quote, payment and operation identity. Recovery first looks for the accepted sale using the original identity and only reissues that exact command if needed. A receipt-read failure does not discard a possibly accepted sale. A definitive command rejection is distinguished from a failed recovery/read request. The reviewed server path serializes identical operation keys and does not accept an identity bound to a different branch.

The inherited offline outbox/replay transport is unchanged. Offline sales remain pending intents through the established path. This package does not add offline barcode data or retrofit cash-tender metadata into the offline envelope, and does not implement offline conflict resolution.

## History, detail and refunds

History is independent of checkout, both as a sibling in POS and a separate `/sales` destination gated by `sale.read`. It supports receipt/reference search, a local-calendar-day filter, stable ordering, 25-row pages with lookahead, empty/loading/error/offline states and opening detail. The existing `loadSales` query was extended rather than leaving a second parallel history query. The former latest-100 ceiling is removed. Both screens subscribe to the existing sale-sync observer; replay stays in the application provider.

Detail loads original sale items, named products/stock units, branch, cashier, time, lots/expiry, movement references, payments, status and prior refunds/return movements. Child collections page instead of silently truncating. Original payment records remain intact when a refund is recorded.

Refunds require explicit selection of an original sale-item/lot row; there is no `saleItems[0]` selection. Each row shows sold, previously refunded and remaining refundable quantities. Review refreshes authoritative state, validates quantity/reason and shows amount before confirmation. Backend locking and cumulative refund checks still enforce the final limit. For multi-lot sales, selecting an existing original allocation row follows the current backend semantics; no new allocation algorithm or manual replacement-batch selection was added.

A confirmed refund retains a stable durable identity, with an immediate duplicate-submission guard. Recovery checks the accepted refund before reissuing the unchanged command. Post-command read failure preserves recovery state. Success retains item/lot, quantity, amount, time, reason, reference, updated status and movement references in refund history. Guidance explains that return funds are handled externally where required and that the original payment is not rewritten.

## Receipts, print and localization

Receipts support EN/FR and existing stock-unit/currency/date formatting, decimal-comma entry and hydration-stable translation hooks. All new copy is registered in matching EN/FR resource files with interpolation parity tests. The existing configurable footer is used unchanged.

Web print creates an isolated document containing only the receipt, with print CSS and the active document language. It clones text/DOM rather than injecting business strings into HTML. The native platforms retain receipt presentation; no printer hardware integration, new print dependency or integrated payment processor was added.

## Validation

Final full application suite: **94 files / 1,885 tests passed**. The original full suite found an eager catalog import disrupting the real-SDK offline dispatch harness; catalog loading was made lazy, the affected 264-test dispatch suite passed, and subsequent complete runs passed. Focused tests cover quantities, quotes, same-total changes, barcode mappings/errors, payment arithmetic, history pagination/scoping, non-first partial/remaining refunds, EN/FR receipt/allocation content, independent read-only routing, print isolation and durable attempts across replica cleanup. Final typecheck passed. Lint passed with two inherited warnings (`app/catalog-settings.tsx`, `src/services/catalog.test.ts`).

Final web export passed all **21 routes**, with dotenv disabled and only fictional loopback URL/publishable-key configuration. Existing node_modules were reused; no dependency files changed. Expo compatibility reports the five inherited patch mismatches (expo, constants, linking, router, sqlite). Expo Doctor passes 20/21 checks, with only that compatibility check failing.

`pwsh -NoProfile -File scripts/test-pos-functional.ps1` passed against disposable PostgreSQL 17 with no network/published ports. It applies the relevant actual source DDL/functions and the new migration, runs the existing Sprint 6 assertions, then the new functional assertions. Coverage includes multi-lot FEFO/prices, expired and blocked statuses, payment rollback, sale idempotency, recorded cash/change, organization currency, same-total allocation rollback, non-first partial/refollow-up refunds, refund retry/audit, over-refund rejection, original payment preservation and per-lot ledger-derived balances. This is a domain fixture, not a full historical migration-chain rehearsal. Hosted schema history, generated hosted types and Supabase Advisor were not accessed.

Browser checks used the real exported app against `scripts/pos-ui-fixture.mjs` at loopback port 54373 with fictional identities/data. Desktop 1440x900 and French phone 390x844 checks covered alternate/unknown/ambiguous barcodes, text/SKU/no-result lookup, multiple products and actual allocations, blocked/insufficient stock, changed quote acceptance, double-click, sustained dropped responses, same-attempt recovery across reload and sign-out/sign-in, cash/change, configured default/per-sale override, external card reference, independent history/search beyond 100/paging, non-first partial/refollow-up refunds, over-refund disabling, second-lot return and read-only history without checkout/refund permission.

The final primary scenario was repeated on the final durable-storage build: alternate barcode, three tablets spanning EARLY/LATER, one syrup, CA$12 total, CA$20 cash, CA$8 change; sustained response loss, sign-out/sign-in, recovery of the original sale; find it through the separate history destination; return 0.5 syrup for CA$2.50. Final fixture assertions prove exactly one sale, three original sale items, one unchanged original payment, one refund and four movements. Per-lot quantities are EARLY=0, LATER=4, SYRUP=9.5, blocked lot=9. The phone viewport/document widths both equal 390px. The final browser console captured no warnings/errors. Ignored artifacts include `.expo/pos-primary-durable-final.json` and `.expo/pos-final-phone.jpg`.

Earlier additional browser assertions proved two sales/two payments, three intentional refunds totaling CA$5.75 and seven movements, including the second allocated lot and noncash reference. Browser fixture assertions and real PostgreSQL assertions complement each other; this is not browser-to-database integrated certification.

Print-document unit checks and the generated isolated receipt content passed. Invoking browser print blocked automation in the in-app browser; a fresh tab was required. Physical printer/output was not certified. The existing authenticated direct-link reset to Home was reproduced and deliberately not repaired; navigation through Home/More was used.

## Self-review and remaining release work

Review corrected unnecessary eager replay dependencies, stale quote display during input changes, exact recovery versus read-failure classification, account/branch-bound screen state, retained cart/quote presentation, durable attempt survival beyond cache cleanup, editable forms after storage failure, default-payment reset, missing detail loading feedback, source encoding/line-ending noise and reuse of the existing sales query. No new dependencies, ledger model, refund model, FEFO algorithm or integrated payment service was introduced.

Local functional package is complete with the limits above. The new and accumulated migrations remain undeployed and require a separately authorized release process, historical migration reconciliation, hosted verification/type generation/advisor checks, integrated non-production acceptance and real iOS/Android device QA. Physical printing remains unverified. Expo patch drift remains separate. Hosted/production state is unknown and unchanged by this package.

Recommended next bounded functional package: **Operational Reports and Exports Completion**, based on authoritative sales/refunds/ledger data. Stop this package here.
