# Inventory adjustments and physical counts completion

Implemented only in `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, on `codex/catalog-opening-stock` at inherited commit `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd` plus the required uncommitted owner, catalog/opening stock, locale/hydration and purchasing/receiving baseline. The baseline was inspected and preserved; its focused preimplementation checks passed 162 tests across 15 files.

Traceability: STK-FR-001/002/003/005, BR-004/005/006/008; the existing inventory ledger, count tables, count posting RPC, batch search RPC and stock-unit conventions remain authoritative.

## Files changed by this package

Modified:

- `app/inventory.tsx`
- `src/services/inventory.ts`
- `src/i18n/index.ts`

Added:

- `src/domain/inventoryCompletion.ts`
- `src/domain/inventoryCompletion.test.ts`
- `src/services/inventoryCompletion.ts`
- `src/services/inventoryCompletion.test.ts`
- `src/components/InventoryWorkbench.tsx`
- `src/components/PhysicalCounts.tsx`
- `src/components/InventoryResultDetails.tsx`
- `src/components/InventoryMovementInspector.tsx`
- `src/components/inventoryCompletion.presentation.test.tsx`
- `src/i18n/inventoryReady.en.json`
- `src/i18n/inventoryReady.fr.json`
- `supabase/migrations/20261118132215_inventory_count_completion_audit_boundary.sql`
- `supabase/tests/inventory_completion_functional.sql`
- `scripts/test-inventory-functional.ps1`
- `scripts/inventory-ui-fixture.mjs`
- this document

## Adjustment workflow and recovery

The form shows branch, product, stock unit, lot, observed On hand/Reserved/Available, increase/decrease, quantity, required reason, optional reference and projected On hand. Unsafe batches retain their sellability restrictions. Search uses the existing server-backed catalog batch search and its paginated product/SKU/barcode/lot matching; selection is not restricted to the currently loaded inventory page.

Validation rejects zero/negative adjustment amounts, malformed localized numbers, excessive quantity precision, unsupported numeric magnitude, blank reasons, missing balances, mismatched batch/branch identity, excessive decreases and inbound adjustments to recalled/disposed batches. No values are clamped. Count quantities accept explicit zero and up to the existing ledger's four decimal places. Missing balance rows remain unavailable.

A request is durably stored before network submission, with user/organization/branch scope, its UUID-based movement key, frozen payload and timestamp. A synchronous in-flight guard blocks duplicate clicks. Recovery checks the existing ledger movement before validating fresh stock, which also permits recovery of a previously accepted adjustment that exhausted stock. Uncertain requests stay locked to their original payload/key. Definitive rejection allows explicit correction; accepted references remain available until the user starts another adjustment. There is no background replay or global transaction framework.

Structured acceptance includes product/lot, observed previous stock, adjustment, projected result, refreshed current stock, reason, movement ID and server movement timestamp. Previous/projected figures are explicitly submission snapshots rather than an invented historical balance: concurrent stock activity can change the refreshed balance. A failed detail refresh preserves acceptance and offers refresh rather than another posting.

## Count lifecycle and durable drafts

Create count allocates a durable client UUID and inserts that same primary key into the existing `inventory_stock_counts` table. A dropped create response recovers by that ID. Counts explicitly cover selected batches, not whole-store inventory. Header context shows branch, reference, creation time and status.

Each raw entry and selected batch is saved synchronously through the existing storage abstraction, outside the disposable read replica and scoped to user/organization/branch/count. Web uses local storage; the application already installs its native SQLite storage implementation. Draft persistence errors prevent dependent posting. Entered valid quantities save into existing `inventory_stock_count_lines`; unfinished blank selections remain on the originating device. Blank is never silently converted to zero. There is no second backend count or inventory model.

Open and completed server counts are paginated in branch history. Reopening an open count preserves same-device unfinished entries and refreshes its expected balances. Without a local draft, server lines reconstruct quantity entry. Completed server history wins over local state and remains read-only. Cancelled history is also read-only. Uncertain reconciliation stays in a dedicated recovery phase until resolved.

## Variance and reconciliation

Review requires every selected quantity to be valid and saves the entered lines before displaying product, lot, stock unit, expected, counted and signed difference. It requires a separate explicit confirmation. The existing server function calculates its final expected quantities from the current ledger while holding the existing locks. The review explains that stock changes between review and posting can change final differences.

Reconciliation uses the same count ID and the existing deterministic `stock-count:<count-id>:batch:<batch-id>` movement identities. Before posting, the client verifies that saved lines match the reviewed quantities. An uncertain retry reads the count first; an already completed count returns its saved result without rewriting lines or posting again. Completed results show the server's persisted expected/count quantities and actual correction movements. Zero variance creates no correction movement. If accepted detail has not loaded, the UI says so rather than falsely claiming that no movements exist.

Manual arithmetic checked in the final phone run: adjustment `10 - 1.5 = 8.5`; count entries `8 / 12.25 / 10` against `8.5 / 10 / 10` produce `-0.5 / +2.25 / 0`, exactly two correction movements and final balances `8 / 12.25 / 10`.

## Approved local audit repair

Real local PostgreSQL assertions reproduced an existing failure in `20260920043646_add_stock_count_audit_log.sql`: the invoker reconciliation function attempted a direct insert into `audit_logs`, whose insert privilege is intentionally unavailable to authenticated users. PostgreSQL rolled the whole transaction back. The user explicitly approved the narrow local repair after this reproduction.

The new compensating migration moves the completion audit insert into a private trusted trigger, following the repository's audit-trigger pattern. The public reconciliation RPC remains an invoker with its existing permission checks, count lock, inventory locks, ledger posting and deterministic movement identities. The trigger preserves the existing completion event and totals metadata. Normal users receive no audit insert grant, and the trigger function is not directly executable by public/anon/authenticated roles. No applied migration was rewritten. No public RPC signature or table shape changed, so client database types did not require an update.

This migration is local and unapplied to production. Hosted migration history and Security Advisor were not accessed under the explicit no-production boundary. Production migration drift and release prerequisites still require a separate approved deployment workflow.

## Branch context and ledger traceability

The inventory screen is keyed by user, organization and branch. Its branch switch asks for confirmation and explains that unsent adjustment fields reset while saved counts and pending operations remain in their original branch. Returning to that branch restores its draft/request. Requests and count reads also enforce the explicit originating scope. No branch switch silently rebinds a saved operation. Fresh online authorization uses the existing helper and access-refresh action.

Adjustment/count results show exact movement IDs, reasons, references and product/lot links. Recent ledger rows can open a focused movement inspector without redesigning the ledger. Server stock remains read-only outside existing posting paths.

## English and French

All added messages have matching nonempty EN/FR resources. New quantity entry preserves decimal commas; variance, result and ledger quantities use locale formatting and existing translated stock units. The existing hydration-stable translation hook and initialization behavior are preserved.

## Verification and self-review

- Full application suite passed: 80 files / 1,692 tests, including 33 package domain/service/presentation cases. Focused tests cover validation, search beyond old batch caps, exact adjustment payload/key/time reuse, exhausted-stock recovery, stable count creation, draft/reload, variance, reconciliation, saved-line changes, uncertain results, branch scope, ledger references and translation parity.
- Typecheck passed. Standard Expo lint passed with the same seven inherited warnings in catalog-settings, POS hook dependencies and catalog test import order; task files had no lint errors or warnings. A separate root-wide ESLint invocation also exposed pre-existing undefined-Buffer errors in older test fixture scripts; those unrelated scripts were preserved. The new fixture imports Buffer explicitly.
- The disposable, network-isolated PostgreSQL runner passed adjustment increase/decrease and retry assertions, saved count lines/history, positive/negative/zero variance, actual expected/count snapshots, immutable movement references, derived balances, duplicate completion rejection, exactly one completion audit, unchanged direct audit-write restrictions, atomic rejection/rollback, corrected-count recovery, and persistence from a new database connection. It uses relevant source migrations in an isolated fixture, not a rehearsal of all historical migrations.
- Web export passed all 20 static routes with fictional loopback-only configuration. No dependency manifests or lockfiles changed.
- Desktop browser at 1440x900 and French phone at 390x844 passed the primary workflow against the fictional loopback API. Checks included lot 140, zero/malformed numeric rejection, decrease/increase, duplicate clicks, dropped adjustment/reconciliation responses, same-count navigation/reload recovery, branch switching and return, signed positive/negative/zero variances, completed history, and ledger drilldown. The final phone scenario was rerun after implementation review. Dropped-response recovery produced one accepted adjustment and one set of count corrections.
- The final phone scenario used `10 -> 8.5 -> counted 8`, plus counted `12.25` and `10` for two other lots. Reopened completed results retained exactly the two nonzero corrections. Browser data assertions separately confirmed counts, movements and balances. Final captured browser warnings/errors were empty for the checked run; this does not certify the separately recorded baseline launch/hydration issue.
- Self-review compared the three modified files against their pre-package copies, inspected all additions and the local migration, and manually checked variance arithmetic. Corrections included preserving accepted references after failed detail refresh, avoiding false zero-movement messages before result detail loads, refreshing expected stock on reopen, making cancelled history read-only, rejecting unsafe numeric precision/magnitude, and localizing recent ledger quantities.

## Remaining limits and next package

The tested local workflows have no remaining functional blocker. Release still requires safe review/deployment of the local audit migration and inherited migrations, hosted history/advisor verification under separate authorization, and integrated non-production browser-to-real-database and real iOS/Android runtime acceptance. Fictional-API browser checks and real PostgreSQL assertions are separate tests. The existing authenticated direct-link reset and Expo patch drift remain outside this package.

No production access, deployment, commit, push, merge, Daybreak work, cybersecurity/adversarial assessment, Stage 01/02 evidence edit, or POS/refund/offline/reporting workflow change occurred.

Recommended next bounded functional package: Expiry, quarantine and disposal completion. Stop after this package.
