# Expiry, quarantine and disposal completion

Implemented only in `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, on `codex/catalog-opening-stock`, inherited HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd` plus the required uncommitted owner/navigation, catalog/opening stock, locale/hydration, purchasing/receiving and inventory/count packages. Before editing, the exact directory, branch, working diff and all five package documents/implementations were inspected. Twelve focused baseline files passed 136 tests. Pre-package copies and SHA-256 hashes were retained in a temporary baseline folder. All inherited changed/untracked files outside the two deliberately extended baseline files (`app/expiry.tsx`, `src/i18n/index.ts`) remain byte-for-byte unchanged. `src/services/expiry.ts` was previously unchanged and is the third modified existing file.

Traceability: PRD-004/014/020, EXP-FR-001/002/004, BAT-FR-002/003/004/005, STK-FR-001/002/005, BR-002/003/004/005/006/007/008/010/018. Existing expiry policies, risk view, alerts, action history, status RPCs, removal RPCs, inventory ledger and branch access remain authoritative. No second expiry/recall system, schema migration, dependency or background-job service was added.

## Files changed by this package

Modified:
- `app/expiry.tsx`
- `src/services/expiry.ts`
- `src/i18n/index.ts`

Added:
- `src/domain/expiryCompletion.ts`
- `src/domain/expiryCompletion.test.ts`
- `src/services/expiryCompletion.ts`
- `src/services/expiryCompletion.test.ts`
- `src/components/ExpiryBatchDetails.tsx`
- `src/components/ExpiryWorkbench.tsx`
- `src/components/ExpiryHistory.tsx`
- `src/components/expiryCompletion.presentation.test.tsx`
- `src/i18n/expiryReady.en.json`
- `src/i18n/expiryReady.fr.json`
- `scripts/expiry-ui-fixture.mjs`
- `scripts/test-expiry-functional.ps1`
- `supabase/tests/expiry_completion_functional.sql`
- this document

Generated local QA artifacts are ignored in `.expo`: a French phone screenshot and the first complete fictional scenario state. They are not Stage 01/02 evidence.

## Worklist, thresholds and refresh

The worklist shows product, lot, branch, expiry date, affected quantity/unit, current status and eligibility separately. Search and filters cover expiry risk, all stocked batches, expired, soon, quarantine and recall. The existing catalog batch search reaches normal, disposed/depleted or otherwise non-worklist batches. Search results collapse after selection to keep the action panel usable on a phone.

Risk categories are recalculated from the existing view's server-calculated `days_remaining` and the saved organization policy. This fixes the former fixed 7/30/60/90/180 presentation disagreement without creating another backend view. Thresholds are positive whole-day values, 1–10 entries, deduplicated and ordered; malformed members are rejected rather than silently dropped. Boundaries are inclusive and expiry occurs after the expiry date, consistent with the existing server contract. The default policy remains 180/90/60/30/7.

Risk and alert reads page through results rather than silently stopping at a server page or the old 100-alert limit. Product units and actual derived available quantities are added through existing reads. A missing balance is never invented as zero. Only the currently applicable alert level/date appears under the saved policy; older stored warning levels remain historical. The existing refresh RPC still owns alert creation/deduplication and expired-status updates.

Refresh is explicit, on focus/reconnect, once per minute while this screen is active, and on app resume. A timestamp and offline/cached/stale state remain visible. A failed refresh cannot claim freshness. A 15-second display tick updates staleness, with a one-minute expiry freshness boundary. Refresh calls serialize so a successful policy save cannot lose its required refresh behind an older in-flight read. Refreshing the selected action panel preserves entered fields and invalidates its confirmation. No unrelated notification/dashboard subsystem was introduced. The existing dashboard's shared risk service now also uses the saved thresholds.

## Quarantine, release and recall

Actions show the originating branch, product/lot, expiry, status, On hand/Reserved/Available and unit. Reason is required, with an optional note/reference. Each action has a separate review/confirm step. Current batch/balance/scope/eligibility are checked again before dispatch; existing database rules remain final.

Quarantine changes eligibility without inventing a quantity movement. Release is available only for a quarantined, unexpired batch with stock. Recalled, expired, disposed and depleted stock cannot be released through this workflow. Recall retains the existing ACTIVE/QUARANTINED transition rule; no unsupported EXPIRED-to-RECALLED transition was added. All status actions retain their existing action history references.

Exact product plus lot lookup shows the same lot in branches visible through the existing read policies, with current status/quantity and navigation into the originating branch/batch. A branch change requires confirmation. Recall remains separately confirmed for each batch/branch; the UI does not claim an organization-wide recall transaction.

## Disposal and supplier return

The existing `dispose_batch` RPC has no quantity argument. The UI therefore explicitly supports whole-batch disposal only and shows the reviewed on-hand quantity, unit, reason and confirmation. It rejects changed stock between review and client preflight. The accepted action's actual quantity is distinct from the reviewed submission snapshot. Its exact ledger movement, current remaining balance and DISPOSED status are visible. No partial-disposal imitation or generic adjustment bypass was added.

The inherited disposal implementation reads its full removal quantity within the transaction before the ledger advisory lock. Concurrent inbound-stock behavior was not certified or changed here; the UI explicitly asks users to verify actual accepted quantity/current stock and does not claim snapshot equality under arbitrary concurrency. Sequential whole-disposal behavior and duplicate-key recovery are asserted in real PostgreSQL.

Supplier returns accept an explicit positive quantity at the existing ledger's four-decimal scale, with decimal dot/comma entry, magnitude/precision checks and unreserved-stock limits. Zero, negative, malformed and excessive values are rejected without clamping. Partial and full returns use the existing return RPC. Supplier provenance comes from the existing purchase-receipt chain; missing or inaccessible provenance is stated honestly. Because the current return RPC records only stock removal, the UI asks for supplier/return authorization in the note/reference and does not pretend to create a supplier credit, refund or dedicated return-order record. Return and disposal remain separate actions.

## Recovery and branch context

Requests use the existing durable form storage abstraction, scoped by authenticated user, organization and branch, outside the disposable read replica. Before networking they save the frozen batch/action/quantity/reason/reference, UUID operation key, timestamp and observed quantity. A synchronous in-flight guard prevents duplicate submissions from the screen. Prepared versus dispatched state is saved before the mutation call; a failed preflight read remains safely retryable.

Removal requests retain the same UUID key/payload. Recovery reads the accepted expiry action first, before validating now-depleted stock. This avoids the inherited supplier-return retry limitation when a full return has already depleted the batch. A movement without its corresponding action is retained for reconciliation instead of reposted. Accepted IDs survive failed detail refresh; refresh does not issue another removal.

The existing status RPC has no idempotency argument. Its saved reason includes the stable operation reference so the same action can be recovered. Once dispatch is uncertain, the screen checks history and never blindly repeats the status action. If no outcome can be established, the request remains retained for explicit reconciliation. This is a deliberate remaining backend capability limit, not a claim of cross-tab exactly-once status writes. Definitive rejection permits a corrected action; accepted/rejected local requests are archived when the user starts another action. There is no new global transaction/outbox framework or offline mutation replay.

The expiry content is keyed by user/organization/branch. Confirmed branch switching resets unsent fields; saved requests remain in and restore from their original branch. A saved operation is never rebound to another selected batch/branch. Fresh online authorization and the existing access-refresh flow remain required. Same-batch selection after a failed batch-detail read now retries that read instead of leaving the user stuck until another selection.

## Traceability and localization

Action results/history expose product, lot, branch, action, quantity or unchanged-quantity status, reason/reference, server time and action ID. Removal drilldown resolves the exact existing movement through the action's saved idempotency key and displays its movement/reference IDs. No quantity movement is fabricated for status-only actions. History is paginated, retains disposed/depleted batches and uses current labels separately from historical action quantities.

All new copy has matching nonempty English/French keys. Numbers use locale formatting and existing translated stock units. Date-only and timestamp presentation reuse existing helpers. Hydration-stable locale initialization/hooks are preserved. Language changes do not cause an accidental reselection/reset of the active form.

## Verification and review

- Focused new coverage: 59 tests across domain, service and presentation suites; expiry boundaries, custom thresholds, staleness, status eligibility, precision/dot/comma, missing balances, branch scope, request persistence, prepared/dispatch recovery, dropped responses, exact keys, partial/full returns, whole disposal, cross-branch lot visibility, pagination, history/ledger references and EN/FR rendering/key parity.
- Full application suite: 83 files / 1,751 tests passed. Typecheck passed. Standard Expo lint passed with the same seven inherited warnings in catalog-settings, POS hook dependencies and catalog test import order. Package sources have no lint errors. `git diff --check` passed; fixture JavaScript syntax check passed.
- Disposable local PostgreSQL assertions passed using relevant real source migrations, including the existing expiry movement-type migration. They cover configured 7/21 boundaries and day22 exclusion, repeated alert refresh, expired status, quarantine/release/recall and FEFO exclusions, duplicate quarantine rejection, same lot in two branches, separate recall scope, partial/full supplier returns, excessive-quantity rollback, whole disposal, retry references, exact movements and derived balances. The inherited adjustment/count assertions also pass. This is a focused source-contract fixture, not the full historical migration chain or a hosted database check.
- Web static export passed all 20 routes with fictional loopback configuration. A clean-cache rebuild removed a stale fixture address; no real environment values were used in QA exports. Dependency manifests and lockfile are unchanged.
- Desktop 1440×900 and French phone 390×844 browser workflows passed against the fictional loopback API: initial 7/21 boundaries and day22 exclusion, expired/quarantined/recalled blocked presentation, quarantine double-click protection, eligible release, per-batch recall, same-lot Main/East quantities/navigation, saved-request branch restoration, unsent-draft branch reset, French decimal comma, excessive-return rejection, supplier provenance, whole disposal, invalid/updated thresholds, explicit refresh and current alerts/history. Phone document width equalled viewport width390; no raw expiry translation keys appeared. Captured warnings/errors were empty for the checked complete run; this does not certify the separately recorded baseline launch/reset issue.
- Independent read-only review and independent fictional state checks confirmed the first full scenario had nine intentional actions and exactly three removal movements: supplier return1.25, Main disposal10 and East disposal8. Resulting quantities were8.75/0/0. Every removal key, branch, batch, action quantity and ledger delta matched; no duplicate IDs/keys, negative balance or sequential disposal residue appeared. Evidence was saved before resetting the disposable fixture.
- After the final same-selection recovery correction, a second browser run deliberately failed the selected batch-detail read, showed the localized error, selected that same batch again and recovered its stock8 without changing branch. The primary near-expiry → quarantine → release → recall → cross-branch lookup → whole disposal workflow was rerun on the final build. It ended with East quantity0 and one disposal movement of-8. No code changes followed that verification.
- Browser fixtures and real SQL assertions are separate checks; an integrated browser-to-real-database non-production environment and real iOS/Android runtime remain unverified. Child browser QA was unavailable; browser execution was performed in the main session and its state was independently reviewed.
- Expo compatibility remains the inherited five patch mismatches. `expo install --check` reports them and expo-doctor passes20/21. They were not folded into this feature package.

Review corrections included: restoring disposal-only permissions; refreshing selected context without wiping drafts; alert paging; actual availability/null handling; stable batch selection; reviewed versus actual quantity labels; serialized policy refresh; fixing encoding artifacts; preserving unsent preflight retries; retaining drafts across locale updates; collapsing selected search results; and same-batch recovery after a detail read failure. No duplicate backend model, ledger/balance write, unrelated package edit or dependency change was introduced.

## Remaining limits and next package

Partial disposal is unsupported by the current backend. Ambiguous status actions without a visible accepted record require reconciliation; server-keyed/cross-tab exactly-once status behavior is not supplied by the current RPC. Concurrent inbound/disposal behavior, integrated non-production browser/database acceptance and real native acceptance remain open. Supplier financial credits and enterprise-wide recall transactions are not part of the existing supported model.

No production access, deployment, commit, push, merge, migration repair/application, Daybreak work, cybersecurity/adversarial assessment, Stage01/02 edit, excluded direct-link reset fix, or POS/refund/offline/reporting workflow change occurred. Hosted migration history, advisor status and inherited release prerequisites were not queried or certified. No new migration is required by this package.

Recommended next bounded functional package: **Stock transfers completion** (existing transfer workflow only), while tracking the above expiry backend limitations separately. Stop after this package.
