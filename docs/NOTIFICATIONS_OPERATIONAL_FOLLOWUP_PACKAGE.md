# Notifications & Operational Follow-up Completion

Local implementation in `C:\Users\Admin\.codex\worktrees\catalog-opening-stock\pharmacystock` on `codex/catalog-opening-stock`. All twelve accumulated package records were present before edits. Existing uncommitted baseline was preserved under `.expo/notifications-baseline` and compared by SHA-256. No reset, clean, stash, checkout, commit, push, merge, deployment or production access occurred.

## 1. Files changed

Existing baseline extensions:

- `app/inventory.tsx`
- `app/operations.tsx`
- `app/purchasing.tsx`
- `app/settings.tsx`
- `app/transfers.tsx`
- `src/components/AppShell.test.tsx`
- `src/components/AppShell.tsx`
- `src/components/InventoryWorkbench.tsx`
- `src/components/PhysicalCounts.tsx`
- `src/components/TransfersWorkspace.tsx`
- `src/i18n/index.ts`
- `src/i18n/settingsReady.en.json`
- `src/i18n/settingsReady.fr.json`
- `src/navigation/items.ts`
- `src/providers/AppProviders.tsx`

New package files:

- `app/notifications.tsx`
- `scripts/notifications-ui-fixture.mjs`
- `scripts/test-notifications-functional.ps1`
- `src/components/NotificationBadge.tsx`
- `src/components/NotificationCenter.tsx`
- `src/components/notificationFollowup.presentation.test.tsx`
- `src/domain/notificationFollowup.test.ts`
- `src/domain/notificationFollowup.ts`
- `src/i18n/notificationsReady.en.json`
- `src/i18n/notificationsReady.fr.json`
- `src/providers/NotificationProvider.tsx`
- `src/services/notifications.test.ts`
- `src/services/notifications.ts`
- `supabase/migrations/20261118213000_notifications_operational_followup.sql`
- `supabase/tests/notifications_functional.sql`
- `docs/NOTIFICATIONS_OPERATIONAL_FOLLOWUP_PACKAGE.md`

Traceability: PRD-008, EXP-FR-003/004 and the existing role/preference-aware notification requirements.

## 2. Existing notification model discovered

The existing Sprint 7 `notifications` table is organization-scoped, addressed to `recipient_user_id`, optionally branch-bound, and stores event type, translation keys, JSON context, `read_at` and creation time. The only existing producer was expiry-alert insertion fanout, reached through expiry-screen refresh. Operations displayed only the latest 50 rows, with mark-one-read; no global badge or bounded follow-up navigation existed. `notification_preferences` already has a single per-user in-app switch and retained external channel flags; there are no category switches to reuse. Organization settings also retain an in-app channel flag. No second notification table/store or delivery platform was introduced.

## 3. Notification-center changes

A dedicated Notifications route is reachable from global header, secondary/More navigation and the existing Operations page. It shows read/unread/closed state, localized title/body/category, entity reference, relevant branch or organization-wide label, creation/closure times, quantity/expiry/status context where supported and a next-workflow action. All/Unread filters use 25-row pages plus one lookahead row. Empty and never-synchronized states are distinct. Priority/severity was not invented.

## 4. Operational event coverage

The shared authenticated application refresh reconciles supported current records for this recipient: low/out-of-sellable-stock, configured near-expiry/expired stock, quarantined/recalled stock, ordered/partially-received POs, transfer approval/dispatch/receipt stages, open physical counts, pending/expired staff invitations and failed imports. Sellable stock excludes unsafe batches. Any missing batch balance suppresses definitive low/out claims, including mixed known/missing products. Branch business dates use configured timezones. No clinical, Exchange, Locator, delivery-provider or Offline Sales Recovery source was invented.

The refresh runs on navigation, active-app return, reconnect and every minute while active. It reads domain state and writes only this user’s existing inbox. It does not mutate inventory or financial state, schedule background jobs, or promise monitoring when nobody is using the app. Legacy expiry-only fanout is superseded by this shared refresh; old expiry messages remain closed history. Expiry worklist refresh/actions themselves are preserved.

## 5. Navigation/actionability

Stock alerts prefill Inventory search; expiry/safety alerts select the existing batch workflow; POs open the exact order; transfers select the exact transfer and actionable branch; physical counts expose an explicit requested-count control in the existing workbench, preserving existing durable count drafts; invitations open Staff; failed imports open Operations for job/result review. Cross-branch opening selects only an accessible branch. Resolved history has no obsolete task action. Existing workflow permissions and server authorization remain authoritative. The unrelated authenticated direct-link reset was not repaired.

## 6. Read/unread and badge behavior

One notification can be marked read/unread while unresolved. Opening a workflow marks only that row read; mark-all affects this recipient’s accessible unresolved unread rows. The global badge uses an exact server count independent of list-page size; 99+ bounds presentation. No synchronized count displays a dash and an unavailable-count message, rather than a false zero. Read changes require online fresh authorization and are not queued offline.

## 7. Duplicate/stale-resolution behavior

The versioned migration extends the same table with `condition_key`, `resolved_at` and `checked_at`; a partial unique index enforces one unresolved row per recipient/condition. Refreshes serialize per organization/recipient and update context without clearing read state. A condition that disappears closes and becomes read; recurrence after closure creates a new unread occurrence. Transfer stage transitions close the old step. Endpoint reassignment updates the same open notification’s branch. Completed POs/transfers/counts, resolved stock safety issues, changed expiry thresholds, disabled preferences and removed eligibility stop producing active follow-ups. Closed history remains inspectable.

## 8. Preferences/branch/role behavior

The existing Settings switch controls future creation; disabling it closes current operational follow-ups on refresh while preserving history. No category preference store was added. Existing external flags are retained with an explicit unavailable-delivery disclosure. Candidate generation and ordinary inbox visibility follow current membership, branch access, active branches and existing capabilities; users do not get actionable notifications for inaccessible branches. Transfer approval may use either accessible endpoint; dispatch remains source-bound and receipt destination-bound. Ordinary cashiers receive their existing read-relevant stock work, without management-only count/staff/transfer follow-ups.

## 9. Offline/current-state presentation

Snapshots use the existing durable `LocalStore`, keyed by user, organization, accessible branches, permissions and filter. Cached/stale/last-sync state is explicit; workflow/read actions are unavailable offline. Reconnect refreshes safely. Failed refresh retains a marked snapshot. Scope/filter state is hidden immediately when context changes, navigation remains mounted, and committed-context request/mutation epochs prevent obsolete responses from replacing the new view or repopulating a signed-out cache. No offline notification mutation queue or recovery subsystem was created.

## 10. EN/FR changes

Matching notification resources cover all event categories, UI states, actions, timing, count, closure, missing-sync and delivery disclosures. Settings wording now describes operational notifications and shared refresh. Timestamps/quantities use the existing locale and branch/organization timezone configuration. Locale initialization/hydration code and dependency manifests are unchanged.

## 11. Tests/build/browser results

Focused domain/service/rendered EN/FR tests cover bounded listing, exact count, pagination, read/unread/mark-all, route targets, branch/role visibility, closed/cached/missing-sync states and translation parity. The disposable local PostgreSQL fixture runs the accumulated catalog/purchasing/POS/report/settings/customer foundations and focused notification assertions for deduplication, replenishment/recurrence, out-of-stock, partial/completed PO, transfer/count completion, access removal/reassignment, preferences, quarantine/disposal, failed imports and branch calendar dates. No hosted connection, migration history query or production advisor was used.

- Final full Vitest: **107 suites / 2,021 tests passed**, including 37 focused notification tests. TypeScript passed; lint passed with only the two inherited catalog warnings. Final web export passed for all 22 routes. `git diff --check` passed.
- Final disposable PostgreSQL assertions passed, including same-recipient source-to-destination reassignment, no duplicate unresolved keys, existing Settings/customer/report regression assertions, and configured branch business date. Local loopback API reconciliation/list returned the 26-row lookahead and exact unread header beyond the first page. A PowerShell array-wrapping assertion was corrected without changing product code.
- **Live desktop/mobile browser acceptance is BLOCKED, not passed.** Browser inventory had no enabled browsers; Chrome and in-app tab creation each returned `Browser is not available`. Native Edge selection timed out after 300 seconds with `Computer Use app approval timed out`; the follow-up discovery call was interrupted. No login, browser action, screenshot, viewport change or primary end-to-end scenario occurred. No tab required closing/resetting. Desktop/mobile overflow, real navigation/read interactions, delayed filter-response regression and cached/reconnect flow remain unverified in a live browser. Rendered EN/FR tests, actual database lifecycle tests and source review do not replace this acceptance gate.
- Browser acceptance must resume when browser/app control is available. No app approval rejection was bypassed. Real iOS/Android device runtime acceptance was outside this local browser task and is not certified.
- No dependency install/alignment change was needed; dependency manifests retain their baseline hashes. Known Expo/dependency drift remains outside scope and was not fixed.

## 12. Self-review findings/corrections

Independent read-only actual-diff review and self-review corrected mixed known/missing balance aggregation, destination-only transfer approval, endpoint reassignment, interrupted loading, consistent branch timestamps/business dates, French settings wording, late mutation responses, navigation remounting and unknown-count presentation. The implementation retains one notification model, one preference store and existing domain workflows. Unrelated baseline hashes and dependency files remain unchanged. Initial verification-tool mistakes (wrong publishable-key environment variable, npm argument forwarding and an assertion that accidentally included unrelated pre-existing POs) were corrected in local verification; no production state was involved.

## 13. Remaining notification blockers

Live desktop/mobile acceptance and the complete primary UI scenario remain blocked by unavailable browser control/native app approval timeout. The package is implemented and locally checked, but cannot be signed off as launch-ready until that acceptance is run.

`20261118213000_notifications_operational_followup.sql` is local and undeployed. It depends on accumulated local baseline migrations, including Settings and staff invitations. Any hosted release requires separately authorized migration-history reconciliation, migration review/deployment and hosted verification. Production was neither inspected nor changed. Existing historical migration drift and pending receiving deployment requirements remain unchanged. External email/SMS/WhatsApp/push is unavailable; no scheduler means notification creation is tied to active app refresh. Native device acceptance, real delivery and background monitoring are not certified. Existing direct-link reset, dependency drift and Offline Sales Recovery remain separate.

## 14. Recommended next functional package

After clearing notification acceptance/release blockers, Controlled Imports & Data Onboarding Completion: bounded existing import preview, mapping/validation, results, partial-failure follow-up and safe retry using the current import model. Keep external delivery, network features and Offline Sales Recovery outside that package unless explicitly requested.

Stop after this package.

Temporary loopback API and notification-only disposable database were stopped after checks. Ignored baseline fingerprints/build/test artifacts remain under `.expo`; no production data was accessed.
