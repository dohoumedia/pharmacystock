# Controlled Imports & Data Onboarding Completion

Local functional package for PRD-019 and the import workflow in `docs/02-functional-requirements.md`.

## 1. Files changed

Existing baseline files extended:
- `app/operations.tsx` (passes authenticated actor and branch/business presentation context)
- `src/components/ImportWorkbench.tsx`
- `src/domain/csv.ts`
- `src/domain/csv.test.ts`
- `src/domain/importPreview.ts`
- `src/services/coreCompletion.ts`
- `src/services/imports.test.ts`
- `src/i18n/imports.en.json`
- `src/i18n/imports.fr.json`

New scoped files:
- `src/components/ImportColumnMapping.tsx`
- `src/components/importsOnboarding.presentation.test.tsx`
- `src/domain/importMapping.ts`
- `src/domain/importMapping.test.ts`
- `supabase/migrations/20261118215803_controlled_imports_onboarding.sql`
- `supabase/tests/imports_onboarding_functional.sql`
- `scripts/test-imports-functional.ps1`
- `scripts/imports-ui-fixture.mjs`
- this document

Work was performed in `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, on the existing `codex/catalog-opening-stock` branch. All thirteen required package documents and their accumulated functional code were present before implementation. A pre-edit fingerprint of 463 baseline files was retained outside the repository. Final comparison found no missing baseline files and changes to only the nine intended existing files above. Dependency files and all other baseline files retain their original hashes. No reset, clean, stash, checkout, commit, push, merge, or production access occurred.

## 2. Existing import architecture discovered

Operations already hosted `ImportWorkbench`, backed by `coreCompletion` services and the existing `import_jobs` / `import_rows` tables. The catalog package supplied the state-machine CSV parser, canonical preview validation, saved row results, product creation and opening-stock RPCs. Posting already used per-row subtransactions and job locking, and opening stock already derived ledger keys from job/row IDs. Staging previously required three requests without a stable client operation identity. Supplier posting previously upserted by name. There was no separate durable file store or general transformation engine.

The package extends those same components, tables, parser, platform storage adapter and CSV export utility. It adds no import tables, external services, dependencies, or new domain models.

## 3. Supported import types

Products/catalog with an optional primary barcode; suppliers; basic customers; opening stock. CSV file upload is supported on web; CSV paste remains available on web/native. Templates exist for all four types. Product fields have no product-level price/cost: batch purchase cost and selling price belong to opening stock. There is no standalone bulk append/replace-barcode importer, Excel workbook parser, automatic identity merge, or clinical import.

## 4. CSV parsing and mapping

The existing standards-aware parser still handles quoted commas, escaped quotes, quoted newlines, BOM, UTF-8, CRLF/LF, blank lines, trailing empty fields and malformed records. Mapping recognizes canonical/common EN/FR headers, allows explicit destination selection or Ignore, preserves original header-based values and physical row numbers, and blocks duplicate destination mappings. Empty mapped rows remain visible even when only ignored source columns contain data.

Limits are 500 data rows, 30 source columns and 2,000,000 UTF-8 input bytes; the serialized staging request must also fit 2 MB including original and normalized values. Limit failures are explicit and never silently truncate data. Byte counting is shared and does not depend on browser-only encoders. Machine headers stay stable; template descriptions distinguish required/optional fields. Example rows are explicitly fictional.

## 5. Product, supplier and customer validation

Local checks cover names/lengths/control characters, supported stock units, SKU/barcode duplicates, visible ASCII barcodes with leading zeros retained, phone/email formats, customer locale/status, dates, strict decimal-comma numbers and precision. Server preview and posting recheck current identities and domain permissions under existing RLS.

Existing SKU, barcode or exact case-insensitive product-name matches are blocking conflicts. Suppliers with matching name/code/contact identity are rejected rather than overwritten. Customer email and formatted-phone matches are blocking conflicts with active records; a matching customer name alone is a warning and never an identity merge. Customer consent defaults remain unchanged. Classifications are optional in the existing schema and are not invented or matched by names.

## 6. Opening-stock behavior

Posting still calls the unchanged `post_opening_stock` -> `post_inventory_movement` path. No balance or ledger history is overwritten. Product identities must agree, explicit branch IDs must equal the selected active accessible branch, supplied stock units must match the product, quantities/prices/costs must satisfy existing precision, and existing lots must retain compatible dates/prices/costs/status. Expired opening lots retain the existing expired status behavior. Cost and selling price remain independent.

Repeated rows resolving through different identifiers to the same product/lot within one job cannot post stock twice. Switching branches discards an unstaged preview with an explicit disclosure; staged jobs and retained attempts keep their original branch. A deliberate new opening-stock job remains a new additive operation; uncertain attempts must be recovered rather than re-uploading the whole file.

## 7. Preview, conflicts and partial success

Preview shows total/valid/warning/invalid row counts and the create-only plan with zero updates/skips. Duplicate warnings are also blocking invalid rows, so warning and invalid counts may overlap. Client-detected errors must be corrected before staging. Staging is atomic and creates no catalog or stock records.

Posting retains the existing honest per-row partial-success model: rows accepted by the server are imported, rejected rows remain saved with errors, and the final job reports cumulative imported/failed counts. A server conflict appearing after preview never silently overwrites a record. Correct only failed rows in a new file; never re-import already accepted opening rows as a retry.

## 8. Retry/idempotency

One UUID and immutable command are durably retained before the staging request, scoped to user/organization/original branch through the existing web/SQLite storage adapter. Atomic `stage_import_job` serialization recovers the same job for an exact retry and rejects changed payloads. A failed staging transaction leaves no partial draft.

The UI synchronously latches requests against double submission and retains an uncertain command across reload. Existing job/row-derived opening movement keys remain stable. Completed and partial-failed posting retries return saved cumulative counts without rewriting the job or repeating audit transitions. These are explicit online recoveries; no offline import outbox or Offline Sales Recovery was added.

## 9. Import history and error export

The existing latest-50 organization history now displays type, filename, branch, timestamp, actor ID and staged/imported/failed counts/status. Opening-stock history is filtered to the current branch. Details reopen saved rows with their original values and localized errors; row results remain paginated at 25.

Local and saved invalid rows can be downloaded through the existing `reportCsv` / platform `exportCsv` utilities, with original header-based values, row number, field and reason. Existing spreadsheet-formula escaping is retained. Historical jobs exceeding the current 500-row bound can still be paged, but are not exported through the bounded error download.

## 10. Downstream verification

Real disposable PostgreSQL assertions verified imported catalog/barcode lookup, normal opening-stock ledger movement exactly once, derived balances, separate purchase/selling amounts, POS quote usability and the existing operational inventory report. Supplier records preserve original contact data on conflicts; customers retain language/status and existing consent behavior.

Browser checks against the fictional loopback API verified uploaded catalog records searched by barcode, the imported UI-LOT with 12.5 on-hand/available, the imported customer in Customers, and reopened product/opening/customer results. Browser fixture success is UI wiring evidence, not integrated real-Supabase E2E evidence.

## 11. EN/FR changes

Matching resources cover mapping fields, ignored columns, templates, required fields, limits, validation, duplicate warnings, branch binding, recovery, history, results and exports. Preview quantities and batch money use locale/organization currency; history timestamps use configured branch/organization timezone. The established locale/hydration implementation is preserved. Retained drafts restore after hydration through a cancellable scoped initialization.

## 12. Tests, build and browser results

- Final full suite: 109 files, 2,051 tests passed with `npx vitest run --maxWorkers=2`.
- Focused import/parser/mapping/service/rendered EN/FR coverage: 63 tests passed.
- Typecheck passed.
- Lint passed with the two pre-existing warnings in `app/catalog-settings.tsx` and `src/services/catalog.test.ts`.
- Disposable network-disabled PostgreSQL fixture passed the accumulated customer/report/catalog foundations and focused import assertions. It was removed afterward; no hosted project, migration history or existing database was accessed.
- Final web export passed, including all 22 existing routes, using a dummy key and loopback-only URL. Output: ignored `.expo/imports-web`.
- `git diff --check` passed. Existing line-ending notices remain baseline notices.
- Expo compatibility check reports five existing patch mismatches. Expo Doctor passes 20/21 checks with that same compatibility failure. No dependency alignment was attempted; existing installed dependencies were reused.
- Desktop (1365x900) and French mobile (390x844) browser flows passed: template and error downloads, actual CSV chooser upload, invalid preview, duplicate mapping, corrected re-upload, stage/post/results, opening stock, barcode lookup, customer visibility, double-click submission (one saved job), and branch switching without redirecting a preview.
- Accepted-but-failed staging response simulation retained the command, survived reload, stayed scoped to the original branch, and recovered once before posting. A service test also covers a thrown dropped response.
- The final primary upload/correct/import/opening/results scenario was rerun. Browser console history contained earlier fictional fixture startup/restart connectivity warnings; no new import runtime or hydration error was observed in the final flow.
- The existing authenticated direct-link reset was encountered on reload; normal navigation reopened Operations. That separate issue was not changed.
- Real iOS/Android devices and a real integrated non-production Supabase browser environment were not available. Native file upload remains unsupported; paste input and existing native file sharing are preserved.

Browser evidence is saved at:
`C:/Users/Admin/.codex/visualizations/2026/11/18/01a1f0a8-14a9-7ea1-9b4a-c7875f2dc8b4/imports-mobile-fr.jpg`
and `imports-desktop-results.jpg` in the same directory.

## 13. Self-review findings and corrections

Kept a single parser and import model. Removed name-based supplier overwrites. Replaced non-atomic staging with an immutable, recoverable existing job identity. Corrected mapped empty-row provenance, overlapping warning counts, duplicate source error reporting, UTF-8 byte bounds, native encoder assumptions, hydration-safe restore and terminal partial-result retries. Added a same-product/lot alias duplicate guard below the UI. Adjusted the customer template to avoid formula-escaping a leading-plus example phone. Test fixture SQL syntax/dependency issues and presentation-test module paths were corrected and rerun before completion. No unrelated baseline or dependency files changed.

## 14. Remaining import/onboarding blockers

The new migration is local and undeployed. It depends on the accumulated catalog/opening-stock and customer baseline. Hosted release remains blocked on separately approved migration-history reconciliation, review/deployment and hosted verification; neither the project nor production migration state was inspected. Hosted advisor/type generation and production sign-off were excluded by the no-production boundary.

A real integrated non-production browser run and real native acceptance remain required before platform launch sign-off. Bounded CSV-only imports, latest-50 history, create-only conflicts, one primary barcode per new product, optional schema classifications and required lot expiry are intentional scope limits. Additional barcodes use existing product barcode maintenance. There is no automatic cross-system identity resolution or arbitrary large-file processing.

## 15. Recommended next functional package

Daily Operations Readiness & Cross-Workflow Acceptance: a bounded owner/staff operating-day walkthrough across the completed existing workflows, resolving practical onboarding/operational exceptions without adding network features, clinical logic, external providers or another import subsystem.

No production access/deployment, Daybreak-dependent work, cybersecurity/adversarial testing, Stage 01/Stage 02 evidence changes, commit/push/merge, dependency drift fix, direct-link reset fix, or Offline Sales Recovery implementation occurred. Stop after this package.
