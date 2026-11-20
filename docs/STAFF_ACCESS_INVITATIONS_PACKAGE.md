# Staff roles, branch access and invitations completion

Workspace: `C:\Users\Admin\.codex\worktrees\catalog-opening-stock\pharmacystock`, branch `codex/catalog-opening-stock`, HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd` plus the seven accumulated uncommitted functional packages. These packages remain the required baseline. No reset, clean, stash, checkout, commit, push, merge, production access or deployment was performed.

Traceability: ORG-FR-002/003, AUTH-FR-006/007 and existing role/branch business rules. This is normal product/functionality work. No Daybreak work, adversarial testing, Stage 01/02 evidence edits or direct-link-reset repair is included. The Home sales quick link and shared navigation now follow the existing sale.create capability; no POS transaction behavior changed.

## Delivered behavior

Staff directory shows name, email when available, current membership status, role and practical role explanation, assigned branches, membership creation and last membership/access change. Search matches name/email/identity; status filters include inactive and revoked memberships. Invitation history is refreshed with Refresh Staff, and separately on request. Pending reviews stay beside the affected member and remain visible if a successful-but-unacknowledged change moves the member outside the selected filter.

Invitations reuse the existing verified-email inbox and invite/accept/cancel operations. No invitation email is sent. Owners can copy/share the app URL and account/acceptance instructions; the link is not a bearer invitation credential. Owners see branch/role, creation, expiry, acceptance and cancellation state. Pending invitations can be cancelled with confirmation. Expired/cancelled invitations can be reissued using the original role/branch/name/email; the existing operation supplies a fresh seven-day invitation while retaining the old record. Matching duplicate/retried invitations return the same pending record. A changed duplicate remains a conflict. An inactive initial branch blocks reissue and requires a new deliberate assignment.

The recipient sees the pharmacy, branch, role, expiry, signed-in email and what acceptance does. Missing/expired/used invitations have owner-check/reissue guidance; backend failures retain their localized existing codes. Acceptance retry reuses the invitation identity and existing atomic acceptance operation. Authentication and confirmation delivery remain the existing auth provider's responsibility.

Role, branch and activation changes require explicit review. The existing roles, role_permissions, organization_memberships and branch_memberships remain the only access model. Self and owner memberships are protected from routine edits; this package does not introduce ownership transfer. Revoked/invited legacy memberships can first prepare a valid role/access in the suspended state and then reactivate. Memberships, profiles and historical actor references are never deleted.

Ordinary staff switch only among assigned active branches. Existing branch.manage capability continues to allow managers/owners to operate across active organization branches. Broader branch-management visibility is distinguished from ordinary assigned access. Current branch is retained while valid; otherwise the first permitted active branch is selected. There is no new default-branch setting. The existing backend supports zero assignments, so removal of all assignments shows an explicit warning and leads ordinary staff to a no-access recovery screen. No new minimum-branch business rule was invented.

Signed-in access refreshes on app foreground/browser focus and every 30 seconds online. Background refresh does not clear the screen's branch-bound forms. Request generations prevent late responses from replacing a newer organization/account context or cache. New context snapshots include assignment IDs; older ordinary-staff RLS-filtered branch read snapshots remain usable as existing offline read hints. All staff writes remain online-only using the existing authorization architecture.

## Data boundary and retry behavior

New versioned migration: `20261118160000_staff_access_completion.sql`, applied only to disposable local PostgreSQL.

- `staff_directory_details` returns same-organization staff email and last change time to the existing staff manager capability; it is not a general auth-user directory.
- `my_membership_unavailable` returns only whether the signed-in user already has membership history, so a deactivated colleague receives access guidance rather than pharmacy-creation guidance.
- `maintain_staff_access` compares the complete observed role/status/branch set and writes the desired set atomically. Organization-scoped serialization and membership locking protect this supported maintenance path. Retrying an already achieved desired state returns without duplicate updates/audits; a divergent observed state requires refresh/review. Existing membership-change audit triggers remain; branch changes append a specific audit event. No table policies or existing authorization helpers were weakened.

The client retains a pending confirmation after ambiguous failure. If a later refresh reveals the changed membership, that review stays reachable under its previous filter. Cancelling a review does not reverse an accepted server change; the directory shows the saved server state. Historical records are neither rewritten nor hard-deleted. Hand-maintained RPC types were updated; hosted type generation and advisor checks were not run because hosted access is prohibited.

## Files in this package

Extended inherited files:

- `app/staff.tsx`, `app/branches.tsx`, `app/index.tsx`
- `src/components/StaffInvitations.tsx`, `InvitationInbox.tsx`, `OwnerSetupGate.tsx`, `ownerSetup.presentation.test.tsx`
- `src/providers/OrganizationProvider.tsx`, `src/services/organization.ts`
- `src/navigation/items.ts`, `src/i18n/index.ts`, `src/types/database.ts`

New files:

- `src/components/StaffDirectory.tsx`
- `src/domain/staffAccess.ts`, `staffAccess.test.ts`
- `src/services/staffAccess.ts`, `staffAccess.test.ts`
- `src/i18n/staffReady.en.json`, `staffReady.fr.json`
- `supabase/migrations/20261118160000_staff_access_completion.sql`
- `supabase/tests/staff_access_functional.sql`, `scripts/test-staff-access.ps1`
- `scripts/staff-ui-fixture.mjs` and this document

## Verification and limits

The full application suite passed 88 files / 1,835 tests. Focused final staff/gate/locale tests passed 4 files / 53 tests. Typecheck passed. Normal Expo lint retains the seven inherited warnings; package warnings were corrected. Web export passed all 20 routes using dotenv-disabled fictional loopback configuration; the build cache was cleared once to discard the previous package's embedded fixture address. Dependency manifests and lockfile are unchanged. Expo compatibility reports the same five inherited patch mismatches; Expo Doctor passes 20/21 checks with that same compatibility failure. The initial default-concurrency suite had one unrelated offline test timeout; the complete rerun with two workers passed without changing that test.

`scripts/test-staff-access.ps1` passed against disposable PostgreSQL 17 with no network or published ports. It includes the existing permission-helper correction in its foundation fixture and tests the actual setup/invitation/membership source operations. Checks cover duplicate/invalid/conflicting invitations, acceptance/retry, branch add/remove/empty access, role change, stale review rejection, exact retry without duplicate branch audit, suspended access, reactivation, expiry/reissue/cancellation, legacy role-less/branch-less restoration, and retained profile/membership/actor references. Business attribution is represented by a fixture reference to the real auth/profile identity; it is not a new sale/ledger transaction or a full migration-chain rehearsal.

Browser checks use the real exported app against a separate fictional loopback API, not a real Supabase deployment. Desktop 1440x900 and French phone 390x844 checks exercise ordinary navigation, invitation validation and duplicate submission, acceptance, single/multiple branch access, current-branch removal/fallback, role/navigation refresh while signed in, membership deactivation/reactivation, search/filter, expired reissue and pending cancellation. The complete owner-to-staff primary journey was repeated on the final French phone build. Interruption testing deliberately drops a successful maintenance response, retaining its inline review for retry after the status filter no longer matches. Browser fixture and real PostgreSQL assertions complement each other; this is not integrated browser-to-database certification or real iOS/Android device QA.

Self-review and independent read-only review corrected manager branch-capability preservation, legacy restore controls, offscreen confirmation placement, filtered pending-review recovery, stale account/organization refresh responses, stale invitation history after directory refresh and a Home action that remained visible after losing sale.create. The excluded authenticated direct-link context-reset subsystem was not repaired.

Final fictional-state assertions passed: exactly two memberships, one accepted invitation bound to the retained Final Staff user identity, Inventory Officer role, East-only branch assignment and suspended status. Exactly four intended access events exist (branch add, role change, Main removal, deactivation); retrying the lost deactivation response adds none. The final phone viewport/document widths both measured 390px and captured console warnings/errors were empty. A final phone image is retained as the ignored generated artifact `.expo/staff-access-phone.jpg`.

Final independent source review found no remaining concrete blockers. Baseline SHA-256 verification confirmed all 350 inherited files outside the 12 deliberately extended files were unchanged. No dependency files or prior package documentation/evidence changed. Browser execution was performed in the main session; source review was independent.

## Remaining release work and next package

No local staff/access functional blocker remains from these checks. The new and inherited local migrations still require a separately authorized release process, migration-history reconciliation and deployment/advisor/type verification. Hosted state and the previously documented production receiving migration were not queried. Real auth-email confirmation delivery, integrated non-production acceptance and native devices remain unverified. Invitation email delivery is intentionally absent and is explicitly described in the UI.

Recommended next bounded functional package: **POS, sales and refunds completion**, using the accumulated baseline and normal pharmacy workflows. Stop this staff/access package here.
