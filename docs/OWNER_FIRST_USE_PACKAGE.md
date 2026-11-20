# Owner first use and navigation — functional package

Implemented locally on `codex/owner-first-use-navigation`, based on the functional
audit's exact canonical snapshot `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`.
The original checkout and its unrelated local edits were left intact.

Traceability: audit B01/B02; PRD-005, PRD-009, ORG-FR-001 through ORG-FR-004,
AUTH-FR-001, BR-009 and BR-010. This is a functional product package only.
Stage 01/Stage 02 evidence, Daybreak work, POS/refunds, offline operations and
reporting were not changed. No production access, deployment, commit, push or
merge was performed.

## Delivered journey

1. Register with email/password if necessary; confirm the existing auth email and
   sign in. Registration shows confirmation guidance rather than claiming an
   authenticated session when confirmation is required.
2. The shared setup gate waits for organization lookup. Empty successful lookup
   shows pharmacy setup. Failed lookup offers retry; offline lookup does not
   masquerade as a new pharmacy. This works regardless of the requested route.
3. Enter pharmacy name, optional country, ISO currency code and business timezone.
   Defaults follow the existing organization model: XOF, UTC and selected EN/FR.
   Enter a branch name or use the localized Main branch default.
4. One transactional operation creates organization, first branch, OWNER
   membership, branch access and audit records. Retrying returns the existing
   owner context. The normal shell opens only after context loads.
5. Staff, Branches, Suppliers, Products and Purchasing are reachable in the
   desktop sidebar/tablet rail, or the phone's More screen.
6. Owners can create additional branches and switch the current branch.
   Creating a branch also creates the actor's branch membership atomically;
   retries retain the form's branch ID. Existing organizations with no active
   branch get first-branch recovery. Editing/deactivating branches is deferred.
7. Staff invitation collects name, email, role and one initial branch. OWNER is
   excluded from invitation roles. Default staff role is CASHIER. The initial
   branch defaults to current branch; existing staff branch maintenance remains.
8. Invitations are in-app, expire in seven days and can be cancelled/recreated.
   The owner explicitly shares the app link/instructions. No invitation delivery
   provider exists in the baseline, so the UI explicitly says **no invitation
   email is sent**. A new staff member can register, confirm email, sign in, and
   accept from their verified-email inbox. Acceptance creates active membership
   and branch access atomically; retries do not duplicate membership. The owner
   refreshes Staff to see acceptance and the new active membership.

## Setup checklist

The owner's dashboard queries saved facts: pharmacy, selected active branch,
active colleague or unexpired pending invitation, active supplier, active
product, and a non-cancelled purchase order in the current branch. Clicking a
link never marks its step done. The checklist refreshes on dashboard focus and
explicit refresh, and collapses to a completion message when all six are done.
It guides without gating operational screens. Requests are scoped so an older
branch response cannot overwrite the current branch's progress.

All new UI copy, validation and invitation states are in equivalent EN/FR
resources. New forms have visible labels, pending/loading feedback, localized
errors and safe retry paths. Setup/team writes require an online, non-cached
context; this package does not introduce offline mutations.

## Changed files

Routes and shell:
- `app/_layout.tsx`, `app/index.tsx`, `app/branches.tsx`, `app/staff.tsx`
- `app/purchasing.tsx`, `app/suppliers.tsx`, `app/more.tsx`
- `src/components/AppShell.tsx`, `src/navigation/items.ts`

New functional components:
- `src/components/OwnerSetupGate.tsx`, `src/components/FirstUseSetup.tsx`
- `src/components/StaffInvitations.tsx`, `src/components/InvitationInbox.tsx`
- `src/components/SetupChecklist.tsx`

Services, context, types and translations:
- `src/domain/ownerSetup.ts`, `src/services/ownerSetup.ts`
- `src/services/organization.ts`, `src/providers/OrganizationProvider.tsx`
- `src/providers/AuthProvider.tsx`, `src/types/database.ts`
- `src/i18n/index.ts`, `src/i18n/setup.en.json`, `src/i18n/setup.fr.json`

Tests and local fixtures:
- `src/components/AppShell.test.tsx`, `src/components/ownerSetup.presentation.test.tsx`
- `src/domain/ownerSetup.test.ts`, `src/services/ownerSetup.test.ts`
- `src/services/organizationSetup.test.ts`, `src/navigation/ownerNavigation.test.ts`
- `src/i18n/setupTranslations.test.ts`
- `supabase/tests/owner_first_use_functional.sql`, `scripts/test-owner-setup.ps1`
- `scripts/owner-setup-ui-fixture.mjs`

Database and documentation:
- `supabase/migrations/20261118025513_owner_first_use_and_invitations.sql`
- `docs/OWNER_FIRST_USE_PACKAGE.md`

## Local verification

- Locked installation: `npm ci --ignore-scripts --no-audit --no-fund` passed.
- Typecheck passed.
- Lint passed with 11 pre-existing warnings and no errors.
- Application suite: 67 files / 1,538 tests passed (44 added cases).
- Web export passed, including `/more` and `/suppliers`.
- `git diff --check` passed.
- `scripts/test-owner-setup.ps1` passed against a new disposable PostgreSQL 17
  container with no network or published ports. It uses the real tenancy/RBAC
  foundation migrations and this new migration, with minimal supplier/product/PO
  tables solely for checklist facts. It verifies pharmacy/first branch, owner
  context, retry identity, usable new branch access, pending invitation,
  verified-email inbox, acceptance, active staff visibility and checklist
  completion. It is **not** a full historical migration-chain rehearsal or a
  production database test.
- Browser smoke used the built real app with a fictional local API fixture,
  independent of the real PostgreSQL test above. At 390px: login → setup → main
  shell → Staff → validation → invitation → Suppliers → Products → Purchasing →
  Branches → create/switch branch all passed through normal navigation. French
  registration confirmation, staff login, invitation acceptance and owner staff
  visibility passed. Tablet 900px and desktop 1440px navigation passed. No
  production URL was used in the browser. The fixture resets on restart and
  never sends mail.
- Expo compatibility check reports the existing five package patch mismatches;
  expo-doctor passed 20/21 checks with the same compatibility failure. Dependency
  files were not changed. This package does not claim real iOS/Android device QA
  or actual auth-email delivery verification.

To repeat the database workflow locally, run `./scripts/test-owner-setup.ps1`
with Docker Desktop available. For fictional browser smoke, build with
`EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329`, a dummy public key and the desired
default locale, then run `node scripts/owner-setup-ui-fixture.mjs` and open its
loopback URL. Do not use real credentials or point the fixture at hosted data.

## Migration and remaining release blockers

The new migration is authored and tested locally only. It reuses existing
tenancy tables, adds invitations, and adds narrowly scoped setup/invitation/
branch/progress operations. No inventory, balance, FEFO, pricing, purchasing
transaction or existing authorization helper/policy was weakened or replaced.
Generated type operations and hosted advisor checks were not run because this
task prohibits production access. Client type contracts were updated locally.

Production has not changed. Before a real new owner can use this journey, the
application and reviewed migration must be released through a separately
approved process, after the known migration-history reconciliation. Production
migration status, including the existing PR #58 receiving guard, was not
queried and remains unverified here. Real auth confirmation delivery and native
device acceptance still need a controlled non-production acceptance environment.

No remaining local navigation blocker was found for **Supplier → Product →
Purchase Order**. Creating/maintaining those operational records beyond the
existing baseline was not expanded in this package.

Recommended next functional package: **Catalog and opening stock** (audit B03,
B10 and the unit/input foundations of B09): full-catalog search/selection,
product maintenance, clear stock units and dependable import/preview. Stop this
package here; receiving, POS/refunds, offline recovery and reporting remain
separate workstreams.
