# Catalog and opening stock — functional package

Implementation workspace: `codex/catalog-opening-stock`, based on canonical
snapshot `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd` plus the completed, uncommitted
owner-first-use package. That package was copied from its original checkout;
the original checkout and the older opened checkout were left intact. The
inherited owner setup/navigation files are not new changes from this package.

Traceability: INV-FR-001 through INV-FR-004, BAT-FR-001/BAT-FR-002,
STK-FR-001 through STK-FR-003, PUR-FR-001 through PUR-FR-006, BR-004/006/007/018,
and the import workflow in `02-functional-requirements.md`.

## Product maintenance and barcodes

Products supports maintaining the existing product ID: name, generic/brand,
strength, dosage form, SKU, category, manufacturer, package description and
stock-counting unit. Archive/restore updates the same record. Existing
tenant-scoped identity constraints remain authoritative, including conflicting
SKU restores. Creation saves product, initial barcode and unit in one transaction.

The existing `product_barcodes` table remains the only barcode store. Editing a
product lists its barcodes, supports adding/removing and choosing a primary
barcode. Removing the primary promotes the oldest remaining barcode atomically.
Adding an already-associated barcode is retry-safe; another product's barcode
produces a conflict. Existing permissions remain required: barcode insertion
also needs the catalog-create permission under the existing insert policy.

## Stock unit

`products.stock_unit` uses stable codes: `unit`, `tablet`, `capsule`, `bottle`,
`box`, `ampoule`, `tube`, `sachet`, `ml`, `g`. Labels are localized. Existing
products default to the neutral `unit`; older cached records have the same
presentation fallback. `package_size` remains descriptive and does not perform
pack conversion. Changing a unit after any ledger history is prohibited to
avoid reinterpreting quantities; the database enforces this rule.

Units appear in product maintenance, purchasing selection/draft lines,
receiving, inventory/count rows, batch views/selectors, opening entry and POS
product/cart labels. POS changes are presentation and the additional unit field
only; allocation, price authority and sale behavior are unchanged.

## Full-catalog and batch lookup

The shared selector searches server-side and requests 30 rows plus one lookahead
row. Next/Previous replace the visible page; it never accumulates an unbounded
catalog. Search covers product name/generic/brand/SKU/barcode/manufacturer and,
for batches, lot number. Ordering includes an ID tie-breaker. Older requests are
cancelled logically so they cannot overwrite newer searches.

Applied to PO product selection, batch identity creation, opening stock,
adjustments and repricing. Inventory/count browsing and batch lists are also
query-backed and paginated. Counts can retain explicitly entered quantities
while navigating pages. Receiving resolves product details from the actual
order's product IDs, including products beyond the old initial load.

## Opening stock and batch maintenance

Products and Batches link to `/opening-stock`. Choose branch/product and enter
lot, quantity, expiry, optional purchase cost, selling price and a reason.
Expiry remains mandatory because the existing batch schema requires it.

`post_opening_stock` creates or reuses the batch and calls the existing
`post_inventory_movement` in one transaction. It posts `ADJUSTMENT_IN` with
`reference_type = OPENING_STOCK`; no balances are written directly. Normal
On Hand / Reserved / Available calculations therefore use the same ledger.
An existing lot must agree on expiry, cost and price; disagreement fails rather
than overwriting batch history. Expired opening batches are recorded as EXPIRED.

The complete online request and idempotency key are persisted before sending.
Ambiguous network outcomes retain the exact request for replay after reopening
the form. A definitive transaction rejection permits explicit correction while
retaining the rejected record. Browser local storage or the existing Expo
SQLite local-storage installation is required; the form cannot submit using
the memory fallback. This adds no offline stock posting or background replay.

After posting, the form reads the derived batch balance; missing values remain
unavailable rather than being invented as zero. Inventory remains directly
accessible for verification. Batch identity creation explicitly explains that
it adds no stock and links to opening stock/receiving.

Batch repricing requires deliberate selection, review and confirmation. The
update compares the previously displayed price to detect a concurrent change,
updates only `selling_price`, and uses the existing append-oriented catalog
audit trigger. Purchase cost is never silently rewritten.

## CSV and import

Imports supports browser file selection and a paste workflow on every platform.
Canonical headers are displayed for each import type; a separate mapping step
is unnecessary for these documented templates. Parsing supports quoted commas
(including `"Supplier, SARL"`), escaped quotes, quoted newlines, BOM, headers,
blank rows and explicit malformed-record errors with source row numbers.

The sequence is preview -> validate -> stage -> explicit post -> saved results.
Edits invalidate the preview. Unsupported/duplicate headers, malformed dates,
missing identities, invalid numerics and duplicate input identities block
staging. Preview is bounded to 500 records / 2,000,000 characters. Quantities
allow four decimal places; cost/price allow two. Larger files must be split.

Staging stays DRAFT until its rows exist, then becomes READY. Only READY jobs
can be posted from the UI. Persisted results display imported/failed counts and
paginated row-level errors; partial failure is explicitly reported. Opening
jobs are displayed in their branch context. A failed row must be corrected and
staged again; imported rows in the original job are never posted twice.

Opening import accepts `sku`, `barcode` or `product_id`, plus `lot_number`,
`quantity`, `expiry_date`, `purchase_cost`, `selling_price`, `reason`.
All supplied identifiers must designate the same product. Import invokes the
same atomic opening-stock operation with a stable job/row key.

## Receiving and locale input

Every positive intended receiving row is validated before payload construction.
Missing lot/expiry/price, invalid quantity/cost or quantity exceeding the
remaining order blocks the entire submission and identifies the row's fields.
Blank/zero quantities remain intentional omissions for a partial receipt.
The service also rejects invalid or duplicate line IDs before calling the
existing receiving RPC. Backend receiving and its idempotency boundaries are
preserved.

Quantity, cost and price inputs touched in purchasing, receiving, adjustment,
count, batch creation, repricing, opening stock and imports accept decimal
commas and dots using strict decimal parsing. Ambiguous grouping, exponent
notation and nonfinite values are rejected. New catalog/import copy and error
messages have matching EN/FR resources and key-coverage tests.

## Package files

New:

- `app/opening-stock.tsx`
- `src/components/CatalogSelector.tsx`, `BatchRepricing.tsx`, `ImportWorkbench.tsx`
- `src/domain/numericInput.ts`, `receivingValidation.ts`, `stockUnits.ts`,
  `csv.ts`, `importPreview.ts`, `catalogReadiness.test.ts`, `csv.test.ts`
- `src/services/catalogReadiness.ts`, `catalogReadiness.test.ts`, `imports.test.ts`
- `src/i18n/catalogReady.en.json`, `catalogReady.fr.json`, `imports.en.json`,
  `imports.fr.json`
- `supabase/migrations/20261118035150_catalog_opening_stock.sql`
- `supabase/tests/catalog_opening_stock_functional.sql`
- `scripts/test-catalog-opening-stock.ps1`
- `scripts/catalog-ui-fixture.mjs`
- this document

Extended:

- `app/products.tsx`, `batches.tsx`, `inventory.tsx`, `purchasing.tsx`,
  `operations.tsx`, `pos.tsx`
- `src/services/inventory.ts`, `purchasing.ts`, `purchasing.test.ts`,
  `sales.ts`, `coreCompletion.ts`
- `src/domain/batchPricing.ts`, `src/types/database.ts`, `src/i18n/index.ts`,
  `src/utils/errorPresentation.ts`

## Validation and limits

- Locked dependency installation passed; dependency files unchanged.
- Typecheck passed.
- Lint passed with seven existing warnings and no errors.
- Application suite passed: 71 files / 1,614 tests, including prior owner setup
  and navigation regressions.
- Disposable local PostgreSQL workflow passed, with 36 explicit assertions: product maintenance/identity,
  barcodes, full-catalog/batch pages, opening batch/ledger/balances/retries,
  unit locking, repricing/cost/audit and opening/product imports.
  Run `./scripts/test-catalog-opening-stock.ps1` with Docker Desktop available.
  This is a functional fixture of relevant real source migrations and import
  table DDL, not a full historical migration-chain rehearsal.
- Web export passed with dummy loopback configuration, including `/opening-stock`.
- Real exported-app browser smoke passed against a fictional loopback API:
  product 300 search; product creation, second barcode and name maintenance;
  opening stock with decimal commas and normal quantity display; deliberate
  repricing with unchanged cost; batch 140 selection; PO products 300/299;
  incomplete positive receipt row blocked with its own error, followed by a
  corrected receipt in history. French 390px phone navigation and opening entry
  passed. Import preview preserved quoted supplier commas and escaped quotes;
  a malformed row remained visible and blocked staging. Desktop and French
  phone screenshots were inspected; the first full session ended without
  console errors. Final-build rechecks confirmed clean purchasing separators,
  French `Disponible: 1,5 comprimé` and localized CAD repricing.
  A second-session reload with persisted French against the English static
  build logged React 418 (hydration text mismatch); subsequent workflows
  recovered. The locale initialization/SSR path is unchanged by this package.
  This remains an observed locale/SSR QA issue; its baseline runtime status was
  not independently reproduced, and it is not claimed resolved here.
  This fictional API smoke verifies UI wiring separately from the real local
  PostgreSQL assertions; it is not integrated real-database browser E2E.
  Run `node scripts/catalog-ui-fixture.mjs` after a build using the loopback
  URL `http://127.0.0.1:54339` and a dummy public key. The fixture has no network
  forwarding, uses invented data and resets when restarted.
- `git diff --check` passed.
- Expo compatibility remains a separate baseline issue: five patch mismatches;
  expo-doctor passes 20/21 checks with that same compatibility failure.
- Native device runtime/keyboard/file-picking and durable-restart acceptance
  remain unverified. Native uses paste input for CSV; web provides a file picker.
  Tablet, browser file chooser and browser import posting/results were not
  exercised; parser/staging/results services and actual database imports have
  automated coverage.

## Migration and remaining functional work

The new migration is local only. Hosted migration history, including the
existing receiving guard, was not queried. Known historical drift remains
untouched. The new API/unit field must be released with the reviewed migration
through a separate approved process before use in a hosted environment.

No production access, deployment, commit, push, merge, Daybreak-dependent work,
cybersecurity/adversarial review or Stage 01/Stage 02 evidence changes occurred.
Hosted advisors and generated-type operations were excluded; client contracts
were updated locally. No production sign-off is claimed.

Remaining catalog/opening-stock limits: fixed canonical import templates,
500-row import batches, required expiry under the current model, no automatic
pack conversion, and no reinterpretation of units with ledger history. A true
non-production integrated environment and real iOS/Android acceptance are still
needed before claiming end-to-end platform readiness.
The persisted-locale/static-build hydration warning also needs a separate
bounded locale/SSR investigation before a clean reload-acceptance claim.

Recommended next bounded functional package: **Purchasing and receiving
completion** — supplier/order maintenance, practical multi-line partial/final
receiving and receipt-history journeys, without expanding into POS/refunds,
offline recovery or reports. This catalog/opening-stock package stops here.
