# Purchasing and receiving completion

Implementation checkout: `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, branch `codex/catalog-opening-stock`, inherited commit `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd` plus the user-selected uncommitted owner/catalog/locale packages. Those inherited changes were preserved. This document describes only the purchasing completion delta.

Traceability: SUP-FR-001, PUR-FR-001 through PUR-FR-006, BAT-FR-001/002, STK-FR-001/002, BR-004/005/006/007/008/009/010/018.

## Files changed by this package

Modified:

- `app/purchasing.tsx`
- `app/batches.tsx`
- `src/services/purchasing.ts`
- `src/domain/receivingValidation.ts`
- `src/domain/catalogReadiness.test.ts`
- `src/i18n/index.ts`

Added:

- `src/services/purchasingDetails.ts`
- `src/services/purchasingReadiness.test.ts`
- `src/domain/purchasingReadiness.ts`
- `src/domain/purchasingReadiness.test.ts`
- `src/components/SupplierMaintenance.tsx`
- `src/components/PurchasingDetails.tsx`
- `src/components/purchasingPresentation.test.tsx`
- `src/i18n/purchasingReady.en.json`
- `src/i18n/purchasingReady.fr.json`
- `supabase/tests/purchasing_readiness_functional.sql`
- `scripts/test-purchasing-functional.ps1`
- `scripts/purchasing-ui-fixture.mjs`
- this document

No dependency manifest/lock changes, new database migration, alternate purchasing model or duplicate traceability table.

## Supplier maintenance

Suppliers are searchable by name, code, phone and email. Detail exposes name/code/phone/email/address, with editing under the existing `purchase.create` permission. Deactivation changes the existing status to `inactive`; reactivation restores `active`. The original supplier ID and its PO/receipt references remain. New PO selection offers active suppliers only. Already submitted orders from inactive suppliers remain receivable under existing backend rules. Deactivation requires confirmation. This is supplier maintenance, not a CRM.

## Purchase order lifecycle and line maintenance

Unsent local drafts allow adding a product from the full catalog, editing quantity/cost and removing a line. Submission uses the existing transactional `create_purchase_order` and immediately produces `ordered`; no new persisted draft/submission state is invented.

Detail combines supplier, branch, creation date/time, current status, products, stock units, ordered/received/remaining quantities, linked receipts and the next available action. Existing `draft`, `ordered`, `partially_received`, `received` and `cancelled` values remain supported for display. Receiving is available only in the existing receivable states and with `purchase.receive`.

The backend has no supported amendment/cancellation action, and ordinary clients cannot directly update PO/line tables. The UI therefore explains that submitted POs cannot be amended or cancelled, asks users to verify lines before submission and directs corrections through the pharmacy manager while preserving the original order. It never posts an unwanted delivery to close an order. Existing cancelled records are visibly distinct, preserve receipt access and have no receiving form. Adding a real cancellation/amendment RPC requires a separately approved backend contract; it was not fabricated here.

## Receiving and validation

Each row shows product/unit, ordered, already received, remaining, receive-now quantity, lot, expiry, purchase cost and selling price. Quantities default blank so partial receiving is deliberate. Blank means not delivered now; explicit zero/negative/invalid quantities produce a row error. Positive intended rows are all validated before payload construction. Any invalid intended row blocks the entire submission and names its failing fields.

Quantities cannot exceed remaining and must fit the existing `numeric(14,3)` quantity scale. Cost is optional and nonnegative when provided; selling price is positive. Both must fit two decimal places rather than being silently rounded. Lot is required and expiry must be a real YYYY-MM-DD date. Database batch/product identity, price matching and transaction checks remain authoritative. A batch identity/price mismatch is explained for correction. Service validation also rejects invalid or duplicate receipt line IDs before calling the existing RPC. PO creation no longer silently filters invalid lines.

Manual and automated arithmetic: ordered A=10/B=3; first receipt A=2.5/B=3; remaining A=7.5/B=0; second receipt A=7.5; final remaining zero and status `received`. Different lots for A retain separate batch identities. Matching an existing eligible lot uses the same batch and preserves every receipt reference.

## Confirmation, history and traceability

Successful receipt posting retains the server reference and displays a structured confirmation: receipt number/ID, supplier, PO, received date/time, lines/quantities/units, resulting batch IDs/lots/expiry, purchase costs, current selling prices, inventory movement IDs, current PO status and remaining quantities. The view scrolls to the result. A failed detail refresh does not erase the accepted reference or suggest posting another operation.

Receipt history supports server-side receipt-number search and 30-row pages with a lookahead row, rather than searching only a previously loaded list. Each receipt opens its lines. The cost and quantity belong to historical receipt lines. The existing model does not snapshot selling price on a receipt, so the UI explicitly labels the batch price as current rather than misrepresenting it as historical.

Receipt-to-batch links identify the exact resulting batch, show product/lot/expiry, current batch cost/price and derived On hand/Reserved/Available values. Missing balance rows remain unavailable. Batch provenance follows existing receipt-line/receipt/PO/supplier references and links back to receipts. Opening-stock batches with no purchase receipt explain that absence; no zero receipt or invented provenance is created.

## Retry and branch context

PO/receipt submissions preserve their existing normalized operation identity. Before sending, the complete request is durably saved in a purchasing-specific namespace with user/organization/branch scope. The separate namespace survives disposal of the offline read replica on sign-out. No background replay or global transaction framework is added.

A synchronous in-flight guard handles double clicks. Ambiguous responses retain and lock the exact request and show an explicit uncertain-outcome message with a retry action. Retry uses the saved payload/reference/key. Known server rejection allows explicit correction, retaining the rejected record and restoring receipt lot/expiry/quantity/cost/price onto refreshed order lines. Accepted IDs remain available until the user finishes the operation. Refreshing detail does not issue another posting.

Each screen instance is keyed by authenticated user, organization and branch. Unsent forms are reset on context change and the draft branch is always shown. The in-screen branch selector requires confirmation before reset. Saved requests remain in their original branch and cannot be silently rebound. Existing fresh online authorization remains required, with an access-refresh action when the context expires. Server permissions and transaction boundaries remain unchanged.

## English and French

All added copy has matching nonempty EN/FR resources. Decimal dot/comma entry is preserved. Quantity badges, receipt quantities and prices use locale formatting. Receipt timestamps reuse the existing localized date/time helper. Locale initialization and hydration handling were not changed.

## Validation

- Locked dependencies restored with `npm ci --ignore-scripts --no-audit --no-fund`; package manifests/lock are unchanged. The preceding installation check selected newer allowed packages locally; the locked restore removed that incidental change.
- Typecheck passed. Lint passed with the same seven inherited warnings in catalog-settings, POS hook dependencies and the catalog test import order.
- Full application suite passed: 77 files / 1,659 tests, including 32 new domain/service/presentation tests and the revised explicit-zero receiving test.
- Disposable local PostgreSQL purchasing assertions passed: supplier editing/deactivation/reference retention, new-order inactive-supplier exclusion, partial/final receiving, remaining quantities, different lots and matched lots, immutable movement references, derived balances, atomic invalid inputs, duplicate-line rejection, retries after completion and preserved cancelled-state history. The runner uses relevant real source migrations in an isolated PostgreSQL container without hosted access or published database ports. It is a focused functional fixture, not a rehearsal of the full historical migration chain.
- Web static export passed for all 20 routes using fictional loopback configuration.
- Desktop 1536x791 and French phone 390x844 browser workflows passed against the fictional loopback API: supplier maintenance; product300/299 selection and product298 removal; multi-field row validation; partial/final receiving; confirmations; receipt history search/drilldown; batch provenance/balances; cancelled PO display; branch reset; French decimal comma; dropped response followed by exact retry. The final retry produced one final receipt, with three total receipt lines across the partial/final scenario.
- Final-build phone rerun passed: ordered 1.5/2.5, received 0.5/2.5, reopened with 1/0 remaining, then received final 1 into another lot. Localized comma badges, received date/time, current PO-status label and visible confirmation were verified. Phone screenshots wrapped without horizontal clipping; the temporary viewport override was reset.
- Browser QA observed React418 at app launch/root reload before purchasing interactions. Its cause was not investigated or changed in this package. No console-clean launch claim is made. Fictional API browser QA and real PostgreSQL assertions are separate checks, not an integrated real-database browser E2E.
- Expo compatibility remains the separate inherited five-patch mismatch; expo-doctor passes 20/21 with that compatibility check failing. No patch alignment was included.
- Real iOS/Android runtime, native keyboards and an integrated non-production environment remain unverified.

## Self-review and corrections

Compared package changes against pre-package copies, preserving inherited owner/navigation/catalog/import/unit/locale work. No duplicate purchasing or traceability model, ledger/balance write, migration or unrelated workflow was introduced. Confirmed partial arithmetic in tests and browser, complete intended-row validation, cancelled-history retention and retry identity. Independent review corrections include: retaining requests outside the disposable replica; restoring rejected receipt fields; refreshing same-route batch provenance; refreshing stale access without losing drafts; localized inactive supplier status; preserving supplier detail after deactivation; keeping selected full-catalog product labels during refresh; scrolling to accepted results; date/time and current-status labels; and French quantity badges.

## Limits, migration status and next package

No production access, deploy, commit, push, merge, Daybreak-dependent work, cybersecurity/adversarial testing, Stage01/02 evidence edit, or excluded direct-link reset fix. No new migration. The existing production migration-history drift and receiving-guard deployment status were not queried and are not certified here. Inherited owner/catalog migrations remain local release prerequisites.

Remaining purchasing limits are the unsupported submitted-order amendment/cancellation actions and missing historical receipt selling-price snapshot. Launch/reload React418, integrated environment and native acceptance are separate readiness limits. This package is verified for the supported local workflows, not production-signed-off.

Recommended next bounded functional package: **Inventory adjustments and physical counts completion**. Stop here; do not begin that work as part of this package.
