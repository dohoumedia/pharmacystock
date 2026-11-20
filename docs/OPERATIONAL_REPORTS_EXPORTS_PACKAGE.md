# Operational reports and exports completion

## 1. Files and required baseline

Implementation workspace only: `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, branch `codex/catalog-opening-stock`, inherited HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`. All nine required packages were present and preserved: owner first use/navigation, catalog/opening stock, locale/hydration, purchasing/receiving, inventory/counts, expiry/quarantine/disposal, transfers, staff/access/invitations, and POS/sales/refunds. Pre-implementation baseline checks passed 192 tests in nine suites. SHA-256 fingerprints captured 397 inherited files: 386 remain byte-for-byte unchanged; the 11 deliberate extensions are listed below.

No reset, clean, stash, checkout, commit, push, merge, deployment, production/hosted access, Stage 01/02 evidence modification, Daybreak work or adversarial testing occurred. Temporary test state and captures are ignored under `.expo`. Traceability: PRD-006, ORG-FR-005, STK-FR-001/004, EXP-FR-001/002, PUR-FR-003/004/006, POS-FR-006/008, BR-004/005/006/009/010/016.

Extended inherited files:

- `app/index.tsx`
- `app/reports.tsx`
- `package-lock.json`
- `package.json`
- `src/components/PurchasingDetails.tsx`
- `src/domain/dashboardPresentation.test.ts`
- `src/domain/dashboardPresentation.ts`
- `src/i18n/dashboard.en.json`
- `src/i18n/dashboard.fr.json`
- `src/i18n/index.ts`
- `src/types/database.ts`

New files:

- `docs/OPERATIONAL_REPORTS_EXPORTS_PACKAGE.md`
- `scripts/reports-ui-fixture.mjs`
- `scripts/test-reports-functional.ps1`
- `src/components/ReportDrilldown.tsx`
- `src/components/ReportRows.tsx`
- `src/components/ReportSummary.tsx`
- `src/components/operationalReports.presentation.test.tsx`
- `src/domain/operationalReports.test.ts`
- `src/domain/operationalReports.ts`
- `src/i18n/reportsReady.en.json`
- `src/i18n/reportsReady.fr.json`
- `src/services/operationalReports.test.ts`
- `src/services/operationalReports.ts`
- `src/utils/exportCsv.test.ts`
- `src/utils/exportCsv.ts`
- `src/utils/exportCsv.web.ts`
- `supabase/migrations/20261118175946_operational_reports_exports.sql`
- `supabase/tests/operational_reports_functional.sql`

## 2. Business dates and closeout

Reports use the selected branch timezone when set, otherwise the organization timezone already stored by first-use setup. The same interpretation now drives Home's existing daily-sales view and date selection. A period includes local midnight at its start and excludes local midnight after its end. PostgreSQL converts each boundary independently, preserving 23/25-hour days. Client calendar calculations use the configured timezone rather than the device timezone. Today/Yesterday advance across midnight; shared period selection also prevents stale draft dates from changing the displayed day when Apply is pressed. A 15-second clock updates day and freshness presentation without causing routine provider refreshes to close details.

A one-day financial report is a compact daily closeout; a custom range is a period summary. Both show branch, dates, timezone, read timestamp, sales/refunds/net, sale count, average, payment methods and existing device-wide pending/conflict counts. Pending local operations are explicitly excluded from accepted server totals. There is no cash-drawer accounting or new timezone framework. Timezone maintenance after first-use setup remains limited to existing configuration capabilities; a broader owner settings editor was not added here.

## 3. Sales, payments and refunds

A new read-only `read_operational_report` operation aggregates existing authoritative records in the database and returns at most 25 detail rows plus full-period totals. It is STABLE and SECURITY INVOKER, retains table RLS, checks organization/branch/report/domain permissions, and requires finance permission for financial reports. It does not alter sales, refund, receiving, ledger, FEFO or pricing workers.

Gross means the existing recorded sale total after recorded discounts and before refunds. VOIDED sales are excluded. Refund totals use each refund's actual amount and its own recording date, including refunds against sales in earlier periods. Full, partial and repeated refunds are separate rows linked to the original sale and existing refund history. Net may be negative on a refund-heavy day.

Payments use their own recorded date and method. RECORDED amounts and reversed-record counts are separated. Original payments are not rewritten by refunds. A difference metric compares recorded payments with gross sales; it is not processor settlement or cash-drawer reconciliation. Refund payment methods are absent from the existing model, so no method allocation is invented. Sales/refunds/payments retain original currency codes; mixed currencies make combined financial amounts unavailable. Units are grouped by stock unit; incomplete sales without item records explicitly suppress incomplete unit totals while preserving recorded financial amounts.

## 4. Inventory and product stock attention

Current inventory shows product, lot, stock unit, on hand, reserved, available balance, eligible available stock, stored status, expiry, separate purchase cost/selling price and cost/retail values. Missing balance rows remain unknown. Missing costs/prices for positive stock or unknown balances make affected headline valuation unavailable, with completeness counters. Filtered completeness counters match the displayed stock rows. Finance-restricted users do not receive valuation amounts through this operation.

Product attention aggregates all lots before applying the configured low-stock threshold. It includes active catalog products with no recorded lots, blocked-only/no-sellable stock, and unknown stock caused by missing balances or configuration. Date, status, available quantity and missing selling price affect report sale eligibility. A no-lot catalog product has no recorded stock; a batch without a balance is not assigned a zero quantity. Individual lot drill-down remains available.

The earlier Home low-stock calculation now groups eligible known stock balances by product before applying its threshold, with matching EN/FR product labels. Home retains the inherited known-balance read scope; the reporting view is the expanded catalog-level attention inspection.

## 5. Expiry

Expiry filters use actual lot dates in the business timezone, not stored EXPIRED status alone. Expired and near-expiry are distinct, and the report horizon is adjustable from 0 to 3,650 days without changing the pharmacy's expiry-policy settings. Today's expiry date remains eligible by date, consistent with the existing convention. Product/lot search, branch, quantity, status and stock unit are retained; zero-stock lots are excluded from risk while unknown balances remain explicit.

## 6. Purchasing

Purchasing filters select PO creation date, branch, literal supplier-name search and lifecycle. The report provides PO count and draft/open/partial/received/cancelled counts, ordered value, received value and outstanding value. Received value uses actual receipt-line costs, while ordered/outstanding values use order estimates and remaining quantities. Cancelled orders have no outstanding commitment. Missing order/receipt costs make affected totals unknown. Existing PO, supplier and receipt detail are reused. A report-only readOnly option removes misleading receiving-form guidance without changing normal purchasing behavior.

## 7. Movements, counts and transfers

Movements query the immutable ledger by occurrence date, branch, product/lot/reference search and movement type. Rows include time, product, unit, lot, signed quantity, reason, reference and source workflow. Opening stock, manual adjustments, counts, receipts, sales, refunds, transfers, disposal and supplier returns have EN/FR source labels and relevant filters.

Physical-count reporting selects count creation dates and opens existing expected/counted quantities, variances and reconciliation movements. Transfers select request dates and expose lifecycle, source/destination, line counts and discrepancy counts, opening the existing lot/unit-level transfer detail. Quantities in tablets and bottles are never added into a meaningless headline total.

## 8. Filters, pagination and drill-down

Filters execute in the database. Details page in stable date/ID or product/ID order, with full-period aggregates independent of the selected page. Transaction histories are not fetched unbounded into client memory. Existing detail viewers remain responsible for one selected operational record. Drill-down covers original sale/refund history, batch, exact product stock, order, receipt, movement, count and transfer. In-flight results are scoped to the selected query, user, organization and branch. Routine same-context provider refreshes no longer discard open detail. Cached snapshots include query, timezone and permission scope and use the existing durable LocalStore, retaining only the last page per report/scope.

## 9. CSV and print

Sales, Payments, Refunds, Inventory, Purchasing and Movements all have exports; the remaining report kinds use the same bounded export path. CSV has stable translated headings, RFC-style quoting with doubled quotes, CRLF records and a UTF-8 BOM. Machine values retain ISO dates/currencies, neutral codes and decimal-dot numbers. Unknowns are blank rather than zero. Spreadsheet formula-like text is made inert. Branch, period, timezone and read timestamp accompany exported rows. Filenames include report, sanitized branch and date range.

Exports traverse filtered pages with a 10,000-row bound and fail explicitly rather than truncate. Changed counts/summaries, missing pages and duplicate IDs abort the download. This is a sequence of read-time snapshots, not a database snapshot export; the UI states that limitation. Larger exports require narrower periods/filters. Web uses a CSV Blob download. Native uses a real temporary UTF-8 file and Expo sharing, including cleanup on failed sharing; completion does not assert recipient delivery.

`expo-file-system` and `expo-sharing` were added using Expo-compatible installation. Their required configuration-tool dependencies changed in the lockfile; unrelated Expo patch drift was not aligned. Sending files requires no share-receiving extension/config plugin. A simple isolated Web closeout print reuses the existing receipt-print document, without PDF infrastructure.

## 10. English and French

All new report navigation, filters, metrics, lifecycle/source labels, empty/error/incomplete states, export headings and print content have matching EN/FR resources and interpolation coverage. Dates, numbers, currencies and stock units use the active locale. Existing hydration-stable translation hooks remain intact. Export numeric/date values remain machine-readable regardless of locale. Home low-stock labels now say products rather than batches.

## 11. Validation and browser results

Final full suite: **98 files / 1,928 tests passed**. Typecheck passed. Lint passed with only the two inherited warnings in `app/catalog-settings.tsx` and `src/services/catalog.test.ts`. Web export passed all **21 routes** using dotenv-disabled fictional loopback configuration. `git diff --check` passed.

Disposable PostgreSQL 17 assertions pass from the actual relevant source DDL plus the new migration, with no network or published database ports. They cover period boundaries, organization/branch timezone precedence, Home/read-model consistency, actual gross/refund/net/payment reconciliation, repeated/full refunds, distinct units, product-level aggregation, unknown valuation/balances, stale-status expiry, threshold filtering, partial receipt values, supplier search, movement filters, count variance/movement traceability, mixed-unit transfers, pagination beyond 100 records and incomplete historical item records. This is a relevant-domain fixture, not a complete migration-history rehearsal.

The real exported app was tested on desktop and 390x844 French phone against a loopback API backed by that disposable PostgreSQL. Primary day: Main / 2026-11-18 / America/Toronto, gross CAD10, refunds CAD15, net CAD-5, one sale, card payments CAD10, payment difference zero. Original records independently confirm these figures. Refunds include two CAD2.50 partial returns and one CAD10 full return for earlier sales. Sale/refund, PO/receipt, count and mixed-unit transfer details were opened and verified. The partial PO is 10 ordered at estimated cost 2, four received at actual cost 3: ordered20, received12, outstanding12. Count detail is expected2/counted1/variance-1 with its movement. Transfer detail preserves 2 tablets and 1 bottle separately.

Large history shows 25 records on each of the first two pages, with unchanged 132-sale/CAD150 full-period figures. Empty custom day and Second branch show zero activity. Date-driven expiry finds an ACTIVE-stored lot whose actual expiry has passed. Inventory distinguishes missing balances, costs and prices. Cached report data remains readable during an induced local server outage, shows cached/failure warnings, disables export and recovers after reconnection. French persistence/reload preserves locale without hydration errors; document and viewport widths are both390. Final captured console has zero entries.

Actual downloads for all six critical CSVs were independently parsed: Sales1 row/12 columns; Inventory9/22; Purchasing1/17; Movements15/19; Payments1 record totaling10; Refunds3 totaling15. French Sales/Inventory also parse with localized headers and the same machine values. A product `Two, quoted "lots"` and supplier `Supplier, Montréal` retain their contents and column boundaries.

Independent source review found no remaining actionable findings after corrections. Independent direct browser execution was unavailable to the QA agent; it separately assessed root-captured artifacts and confirmed the visible financial/detail/pagination/French/cache evidence. Root executed the actual browser interactions. Native devices and physical printer output were not certified.

Expo compatibility still reports the five inherited patch mismatches (expo/constants/linking/router/sqlite); Expo Doctor passes20/21 with only that check failing. Installation reports24 dependency vulnerabilities (13 moderate,10 high,1 critical) and a worklets peer warning; these were not remediated as unrelated dependency/security work. No blanket audit fix was run.

## 12. Self-review findings and corrections

Corrections made before handoff: actual refund-period accounting; actual receipt costs rather than multiplying received quantities by order estimates; product aggregation before low-stock thresholds; missing-value propagation and filtered completeness; missing historical item warnings; date-driven expiry; stable page-independent aggregates; bounded export validation; proper CSV quoting/UTF-8; native CSV attachment instead of text sharing; no mixed-unit transfer totals; complete workflow source translations; explicit UTF-8 file handling after Windows text-round-trip encoding damage; periodic stale-clock updates; primitive context dependencies preserving detail; shared rollover-safe preset application; permission-scoped caches; and report-only purchasing guidance.

An ignored backup test file was initially discovered by Vitest; the backup was renamed as a snapshot, and the final full suite passes. Initial local fixture failures reflected unset synthetic timezone/threshold and an incorrect assumed opening-stock movement type; fixtures were corrected to the actual configured model and existing worker semantics. No unrelated legacy trigger was changed.

## 13. Remaining reporting/export blockers and release limits

The migration `20261118175946_operational_reports_exports.sql` is **local and undeployed**. Production was neither read nor changed. This package requires the accumulated baseline migrations. Production migration history drift must be reconciled in a separately authorized release process before reviewing/applying this migration, generating hosted types, running hosted advisors and performing integrated non-production/release acceptance. No production sign-off is implied.

Native runtime/file-sharing acceptance and physical printing remain unverified. Exports are limited explicitly to10,000 filtered rows and do not provide immutable cross-page snapshots. Refund payment-method allocation/processor settlement/cash drawer accounting remain unsupported by the existing model. Existing authenticated direct-link reset remains out of scope and unchanged. General owner timezone/configuration maintenance, dependency vulnerability remediation and Expo patch alignment remain separate work.

## 14. Recommended next functional package

**Operational Settings & Business Configuration Completion**: make existing business/branch timezone, country/currency presentation, receipt and operational thresholds maintainable through normal owner UI, with EN/FR and focused validation. Keep it bounded and independent of Daybreak, advanced analytics and offline conflict resolution.

The loopback server and disposable report containers were stopped after verification. Browser captures and CSV validation evidence remain under the ignored `.expo` directory.

Stop after this package.
