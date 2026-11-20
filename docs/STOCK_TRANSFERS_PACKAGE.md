# Stock transfers completion

Implemented only in `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, on `codex/catalog-opening-stock`, over inherited HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd` and all six required uncommitted packages. The exact directory, branch, diff, package documentation and implementation were inspected before editing. Nine baseline suites passed 148 tests. Pre-package fingerprints recorded 133 inherited changed/untracked files; all 131 outside the deliberately extended transfer route and translation registration remain byte-for-byte unchanged. The previously unchanged transfer service is the third modified existing file.

Traceability: BR-004/005/006/008/010/018 and the existing Sprint 8 branch-transfer contracts. Existing transfer tables, status lifecycle, transactional RPCs, ledger keys and audit events remain authoritative. No second transfer, ledger, reservation or discrepancy model was introduced.

## Files changed

Modified: `app/transfers.tsx`, `src/services/transfers.ts`, `src/i18n/index.ts`.

Added:
- `src/domain/transferCompletion.ts` and `.test.ts`
- `src/services/transferCompletion.ts` and `.test.ts`
- `src/components/TransferDetails.tsx`
- `src/components/TransferRequest.tsx`
- `src/components/TransferWorkbench.tsx`
- `src/components/TransfersWorkspace.tsx`
- `src/components/transferCompletion.presentation.test.tsx`
- `src/i18n/transferReady.en.json` and `.fr.json`
- `supabase/migrations/20261118143500_transfer_operational_context.sql`
- `supabase/tests/transfer_completion_functional.sql`
- `scripts/test-transfer-functional.ps1`
- `scripts/transfer-ui-fixture.mjs`
- this document

## List, detail and lifecycle

The list has server reference search, supported-status filters and paging. It shows named branches, reference, localized creation time, lifecycle, exact product/lot per line, requested/dispatched/received/shortage quantities and the next permitted action. Quantities remain per product/unit rather than adding incompatible units together. Line reads page rather than silently truncating totals. Offline cached list/detail reads remain visibly read-only; no offline transfer mutation replay was added.

Detail retains product, SKU/barcodes, exact lot/expiry/source status, stock unit, all quantities, source/destination batch IDs, paired existing movement IDs, branch/delta/time/reference, current balances, requester and lifecycle actor names, timestamps, notes and audit history. Missing balances are explicitly unavailable, never invented as zero. Approved quantity is the requested quantity after approval, clearly labelled full approval; there is no invented approved-quantity column or partial approval. Dispatch-awaiting-receipt is explained without fabricating a new in-transit balance.

Cancellation remains limited to REQUESTED/APPROVED and has a confirmation and note. It retains request lines and approval/history. After dispatch, detail explains why cancellation is unavailable. The current cancellation RPC records status, appended notes and updated_at but no distinct cancellation actor/audit event. Detail labels that limitation honestly and shows the cancellation update time.

## Request, approval, dispatch and receipt

Source choices are the user's existing accessible active branches. A server-backed paged destination selector returns only active same-organization counterpart names for an authorized source. The inherited server catalog search handles product/SKU/barcode/lot, including lots beyond former capped selectors and multiple lots of one product. Each selection resolves an exact source batch and trusted balance. Duplicate batch lines are not added by the form.

Domain validation rejects same branches, missing/wrong-source balances/batches, blocked or calendar-expired stock, malformed/zero/negative/excessively precise/unsafe-magnitude quantities and quantities over available stock. Dot/comma decimals follow the existing four-decimal stock scale. Confirmation preflights stock again. Source stock eligibility is distinct from raw balance availability: blocked lots show zero eligibility and retain their status. Request stock snapshots are explicitly identified as checked at selection and rechecked before sending.

Approval and dispatch use only existing supported statuses and permissions. Approval covers each full requested quantity and does not reserve stock. Dispatch sends the full approved quantity and removes it through existing source ledger movements. These effects and product/lot/branches remain visible at confirmation and after success. The existing backend permits requests/approval above current stock; app preflight blocks those submissions while the authoritative dispatch transaction still rejects excess stock atomically under concurrency.

Receipt sends an explicit quantity for every exact transfer line, within zero..dispatched at four-decimal scale. Every shortage requires a reason. Review shows expected, received and difference. Receipt is final: the existing backend records RECEIVED or RECEIVED_WITH_DISCREPANCY and preserves source/destination provenance, costs/prices and existing destination-lot behavior. The screen explains that no acknowledgement/resolution or second receipt exists in this model. It does not post a parallel adjustment or silently call a shortage full success.

## Branch visibility and local migration

Review identified a real ordinary-staff capability gap: source-only staff could not name/select a destination, while destination-only staff could receive/approve but could not see the source branch/lot/profile through ordinary branch-scoped reads.

The new versioned migration adds two read-only RPCs, with no table/RLS/grant weakening:
- `list_stock_transfer_destinations`: authenticated organization membership, transfer.create, an active same-org accessible source or branch.manage; returns only active counterpart id/name/status.
- `read_stock_transfer_context`: organization membership plus transfer.read and the existing source/destination-access-or-branch.manage predicate. It returns only the selected transfer's branch names, exact source/destination lot identity, lifecycle actor display names, referenced movements and transfer audit entries. It excludes purchase cost, private batch notes and unrelated stock/history. Balances remain branch-access-scoped, with selected-line source quantities additionally visible to authorized transfer approvers/dispatchers for their approval decision.

New RPC types are provided alongside the existing hand-maintained transfer service types. No hosted type generation, migration history/advisor query, migration application, repair or production write occurred. The migration was applied only inside a disposable network-isolated PostgreSQL fixture. Hosted deployment, history reconciliation, generated-schema verification and Security Advisor sign-off remain separately authorized release work.

## Retry and identity

The existing durable form storage saves each submitted operation before networking, under authenticated user/organization/original app branch. It freezes source/destination, exact line IDs/batches/quantities/reasons, UUID key, reference, timestamp and named product/lot snapshots. A synchronous flight guard prevents repeated screen submits. Account/organization/branch keys prevent silently rebinding a saved operation. Branch switching resets unsent forms, gives an explicit warning and leaves submitted operations in their original branch for recovery.

Request retries reuse the exact server-supported idempotency key and payload. All recovery looks up the accepted result before checking current stock, including now-depleted batches. The dispatch uncertainty boundary is persisted before RPC invocation. Lifecycle RPCs lack client operation keys; after an ambiguous dispatch they are checked/recovered rather than blindly resent. An unresolved unkeyed action remains retained for explicit managerial reconciliation instead of offering an unsafe reset. Accepted references survive failed detail refresh.

Receipt recovery compares all recorded line quantities/reasons with the frozen receipt even after a nominally successful RPC (another recipient may have completed first). A different accepted receipt is shown as an explicit mismatch alongside actual server detail, with intent retained and no repost. Definitive rejections, including SQLSTATE23503 for an inactive/invalid destination, permit a corrected new request while archiving the rejected intent. Backend transfer/line movement identities remain unchanged.

## Validation and self-review

- Final full suite: 86 files / 1,802 tests passed, including 51 new domain/service/presentation tests. Coverage includes request validation, quantity scale/comma, unsafe stock, missing balances, server selector paging, supported lifecycle/actions, cancellation restrictions, exact lots/branches, persisted identity, preflight failures, duplicate recovery, dropped receipt response, concurrent different receipt, paired references, EN/FR rendering and translation/interpolation parity.
- Typecheck, normal Expo lint and `git diff --check` passed. Lint retains the same seven inherited warnings (catalog-settings hook, POS hooks and catalog test import order); package sources have no lint errors/warnings. A temporary presentation-fixture failure after adding source-status display was corrected by supplying the required status field, and the full suite was rerun.
- Disposable network-isolated PostgreSQL assertions passed against relevant real source migrations: Main source-only Inventory Officer, East destination-only Inventory Officer approval/receipt, counterpart destination/source names/lot/eligible quantities without widening table reads, full10-unit transfer, exact costs/prices/lot provenance, request/dispatch/receipt retry, paired ledger refs, one receipt audit,1.5 shortage on4→2.5 receipt, distinct same-product lots, pre-dispatch cancellation/history, rejected same/wrong-source/blocked batches, and excess-dispatch atomic rollback. Inherited inventory/count/expiry assertions also pass. This is a focused source-contract fixture, not a replay of the entire historical migration chain.
- Web export passed all20 routes using fictional loopback-only configuration with dotenv disabled. No dependency manifest or lockfile changed. The first export identified a missing fictional publishable-key variable; the corrected local-only environment and final builds passed.
- Desktop1440×900 and French phone390×844 browser workflows passed against a fictional loopback API. Checks covered full ten-unit dispatch/receipt, duplicate clicks, a dropped receipt response, excess quantity rejection, same-product LOT-100/LOT-100-B, LOT-140 beyond historical selector caps, decimal comma1.25, shortage reason enforcement, final1.25→1 receipt/.25 shortage, preserved branch-scoped request recovery, quarantined-stock exclusion and pre-dispatch cancellation. Phone document width equals viewport390 and no transfer translation keys leaked. Captured final phone warnings/errors were empty. Reload exposed the separately known direct-link context reset; navigation through Home resumed testing, without changing that excluded subsystem.
- Independent read-only review corrected: a detail-loading/new-request race, source/destination-only read gaps, successful-concurrent receipt comparison, missing cancellation time, inactive-destination rejection recovery and blocked-stock eligibility presentation. Accepted results now retain selected transfer identity when the user finishes reviewing.
- Independent fictional state assertions confirmed exactly three intentional transfers, three retained lines and four movements: LOT-10010/10 with Main0/East10; LOT-1401.25/1/.25 with Main8.75/East1; cancelled LOT-100-B with Main10 and zero movements. IDs, request/movement keys, exact lot/expiry/product/branch references and source-batch receipt provenance matched. These checks complement, rather than replace, the real PostgreSQL assertions.
- After all product corrections, the full Main→East LOT-100 ten-unit scenario was rerun on the final build in a fresh fictional fixture and account, in French on the phone. It ended RECEIVED with one transfer/one line, exactly two matching movement references, Main0/East10 and zero shortage. The final phone width remained390 with no raw transfer keys or captured warnings/errors. No product changes followed this acceptance run.
- Final source review found no duplicate model, authoritative balance write, unrelated code edit or dependency change. Baseline hash verification confirmed all131 inherited files outside the two deliberately extended files were unchanged.
- Expo compatibility remains the inherited five patch mismatches; `expo install --check` reports them and expo-doctor passes20/21. They were not folded into this package. Native device runtime and integrated browser-to-real-database acceptance remain unverified. Browser execution was performed in the main session; code and fixture-state review were independent.

## Remaining limits and next package

The new read migration needs reviewed non-production/production deployment under separate authorization and normal history/advisor gates. No production state was inspected or certified. The backend still has no partial approval, discrepancy-resolution/second-receipt action, cancellation actor audit or client-keyed lifecycle RPC. Ambiguous unkeyed actions without a recoverable result require explicit reconciliation. Existing concurrency/authorization remains server-enforced; these local checks do not certify arbitrary production concurrency or native device behavior.

No production access, deployment, commit, push, merge, Daybreak work, cybersecurity/adversarial assessment, Stage01/02 evidence edit, excluded direct-link fix, or POS/refund/offline/reporting workflow work occurred.

Recommended next bounded functional package: **Staff roles, branch access and invitations completion**, with normal pharmacy owner/staff workflows only. Stop after this package.
