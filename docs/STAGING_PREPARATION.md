# PharmacyStock staging preparation

Status: **STAGING READY FOR REAL-AUTH ACCEPTANCE** — owner browser/session smoke passed; both staging Auth identities, roles and branch assignments are verified.

Prepared November 18, 2026 (America/New_York). This is a non-production setup, not a production deployment or full daily-operations acceptance.

## Baseline integrity

Required worktree: `C:\Users\Admin\.codex\worktrees\catalog-opening-stock\pharmacystock`.
Branch `codex/catalog-opening-stock`; HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`.
All **489** pre-existing tracked/untracked source files were fingerprinted and remain byte-for-byte unchanged. Existing environment files also remain unchanged. No reset, clean, stash, checkout, commit, push, merge or application deployment occurred. Stage 01/02 and all canonical-bootstrap proof files remain unchanged.

The explicit staging-only request overrides the older production-only target rules in repository governance for this task. No production project was queried, linked, configured or mutated.

## Project identity and production isolation

| Property | Value |
| --- | --- |
| Name | Pharmacy Stock - Staging |
| Label | NON-PRODUCTION / STAGING |
| Project ref | `mncvahzdnofyisflympy` |
| Organization | dohoumedia (`nkzhsquimywucgcepnaj`) |
| Region | us-east-1 |
| PostgreSQL | 17.12.0.000 (engine 17) |
| Status after creation | ACTIVE_HEALTHY |
| Prohibited production ref | `jeravdvssuzbthkxfvjy` |

**The staging and production refs differ.** Every hosted project-specific tool/CLI request explicitly selected staging. The generated CLI workspace is separate from the repository's historical migration directory; no implicit existing project link was used. Production absence was not investigated: production was strictly excluded, and no claim relies on a production query.

## Canonical bootstrap and actual migration history

Generated using the existing `scripts/canonical-bootstrap.py` exporter after validating all 53 pinned historical source hashes and manifest order. No forward migrations exist at this baseline.

Artifact: `.expo/staging-preparation/canonical/supabase/migrations/20261118215804_canonical_bootstrap.sql`.
Artifact SHA-256: `52d0d8ae184b62747f4a792a732d9c75ef626f04cd4cc0a6c37f62cdc94fd12c`.

The new staging application schema and migration history were empty before execution. Supabase CLI 2.117.0 dry-run listed only this baseline, then actually executed it. Remote history contains exactly **one** entry: `20261118215804 / canonical_bootstrap` (725 recorded SQL statements). A later dry-run reports up to date, with no pending migrations. No history entry was repaired, inserted manually, or fabricated for the 51 historical versions.

## Schema and assertions

All expected domain relations/functions exist. A fresh disposable local execution of the exact UTF-8 canonical artifact was compared to staging's catalogs. Exact matches:

- 41 public tables, 7 views, 2 sequences;
- 474 columns; 256 constraints; 170 indexes;
- 74 RLS policies and relation RLS flags;
- 39 application triggers; 93 retained application functions, including definitions, security attributes, arguments and defaults.

Platform schemas/extensions/ownership and hosted default ACL additions are outside this definition comparison. The original local normalized pg_dump hash `d88585f0c0e19690c4345bda5f467872f3e9ad6e0abfeb36df7200fda0eded82` is **not** claimed as the hosted dump hash. Hosted Supabase supplies broader default table ACLs than the minimal local platform fixture; those defaults were recorded, not altered or hidden.

**Hosted-compatible suites: 25 passed / 0 failed / 0 skipped.** All original assertions remain in source unchanged. Each hosted suite runs inside an outer rollback-only transaction, with original transaction boundaries mapped to savepoints. Existing prerequisite DML and assertion helpers are included only where the canonical runner includes them.

Two hosted equivalents were necessary because a hosted default ACL permits issuing a statement that RLS denies by returning zero rows instead of raising an insufficient-privilege exception:

- `CAT-T-008`: fail if DELETE affects any row; require the protected product remains visible.
- `INV-T-004`: fail if UPDATE affects any row; compare the full ledger JSON before/after and require the original record remains.

No permissions, schema, policies, RPC authorization or source tests were weakened. After the suites, all fixture users/organizations/ledger rows and temporary helper functions were absent. Only the two real staging Auth users and the UI-created staging pharmacy/branch remain.

## Advisors

- Security: 0 errors, 2 warnings for intentional authenticated SECURITY DEFINER transfer-context functions. Reviewed source verifies signed-in identity, membership, capability and branch checks, an empty search path, and revoked anon/PUBLIC access. These warnings do not block this bounded owner smoke.
- Performance: 0 errors, 7 overlapping-policy warnings; 58 informational findings (20 unindexed foreign keys, 37 unused indexes, 1 Auth connection allocation notice). Existing policy definitions match canonical. No broad hardening was undertaken.
- Health: no findings.

Remediation references: [authenticated SECURITY DEFINER warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [overlapping policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), [foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Auth and test identities

Email/password is enabled; signup is enabled; email confirmation is required (`mailer_autoconfirm=false`). No new Auth provider was enabled. The two test users were created through the staging Auth Admin API and explicitly confirmed, with unique random passwords and fictional `example.invalid` emails. Email delivery/confirmation-link UX was not exercised.

Site URL: `http://localhost:8094`.
Allowed redirects: `http://localhost:8094/**`, `http://127.0.0.1:8094/**`.
Only these two URL settings changed; undeclared hosted settings were preserved. Client configuration uses persistent sessions, token auto-refresh and browser localStorage; sign-out/sign-in/reload were verified. Native behavior remains outside this workstream.

| Account | Auth user ID | Preparation |
| --- | --- | --- |
| staging.owner.mncvahzdnofyisflympy@example.invalid | `a43b275c-365f-411a-ba01-ebf623017ec8` | Confirmed; active OWNER of staging pharmacy |
| staging.cashier.mncvahzdnofyisflympy@example.invalid | `d872bfe6-cf0e-4e28-838e-2173a3acabf4` | Confirmed; active CASHIER, assigned only to Staging Main |

Passwords are retained only in ignored `.expo/staging-preparation/test-identities.local.json`; do not copy them into tracked files. The administrative key was used only in process memory and was never saved into frontend configuration or evidence files.

Staging organization: `aeb81010-32d7-4c66-b8e8-d06715028fdb` — NON-PRODUCTION / STAGING Pharmacy.
Staging branch: `bd9937f4-196e-4263-989e-1cbd5777b05c` — Staging Main.
Country CA, currency CAD, timezone America/Toronto. No inventory or financial operation was retained.

## Staging app configuration and smoke

New ignored `.env.staging.local` contains only the staging URL and modern public publishable key, using existing variable names. Existing env/config files were not overwritten.

New `scripts/staging.mjs` loads only this explicit env file, disables Expo's implicit dotenv loading, pins the dedicated staging origin, rejects production and secret frontend credentials, and validates the served bundle's embedded staging URL/public key. Negative checks reject production URL, a secret key, and a public service-role variable.

Build/start from this worktree:

```powershell
node scripts/staging.mjs --check
node scripts/staging.mjs export --platform web --output-dir .expo/staging-preparation/web
node scripts/staging.mjs
```

The exporter always clears the build cache. The default launcher serves the verified export on loopback port 8094. No public hosting or application deployment was created.

Owner browser smoke passed: open app → real sign-in → verified email identity displayed → create pharmacy/first branch in normal UI → dashboard → Operations → Business settings → sign out → sign in again → reload → same organization/branch and Online/Synced dashboard. No fictional Auth fallback or fixture server was used in the successful run. The final bundle contains only the staging project endpoint and no secret credential.

Corrections before successful smoke: Expo development mode encountered an existing SQLite worker bundling error, so a separate web export was used without dependency/application edits. The first export reused an old fictional test environment from Metro cache; the clean-cache export corrected it and its embedded staging origin was verified before successful sign-in. A comparison-only local reader initially used Windows default encoding; explicit UTF-8 restored exact function-body equivalence. None required changing product code, migrations or the proven source suites.

Screenshot: `.expo/staging-preparation/owner-session-restored.jpg`.
Evidence: `.expo/staging-preparation/{project-identity,final-integrity,schema-comparison,hosted-assertions,advisors,real-auth-smoke}.json`; generated hosted SQL files and per-suite logs are retained beside them.

## Files, remaining blocker and next action

New source files: `scripts/staging.mjs`, `docs/STAGING_PREPARATION.md`. Disposable local servers/comparison databases were stopped/removed. A task-created `supabase/.temp/linked-project.json` contained only staging identity metadata; after checking its provenance and target, it was removed so no new implicit repository link remains.
New ignored config/evidence: `.env.staging.local`, `.expo/staging-preparation/`.
No pre-existing source file, historical migration, canonical proof, dependency file or production configuration changed.

Automatic approval review initially rejected cashier access assignment before execution, requesting exact recipient/role/resource approval. The user then explicitly approved CASHIER access for staging.cashier.mncvahzdnofyisflympy@example.invalid to organization `aeb81010-32d7-4c66-b8e8-d06715028fdb`, limited to branch `bd9937f4-196e-4263-989e-1cbd5777b05c` on staging `mncvahzdnofyisflympy`. After approval, ordinary `invite_staff` → `my_staff_invitations` → `accept_staff_invitation` RPCs succeeded. Both users were independently verified with real Auth `getUser`; the cashier has the CASHIER role and exactly one visible/assigned branch, Staging Main. No workaround was used.

Final checks: staging remains ACTIVE_HEALTHY; the project refs differ; history still contains only the actual canonical baseline; 2 Auth users, 1 organization and 1 branch are retained; both memberships are active and scoped to that branch; no fixture helpers or inventory movements remain. Original source/env fingerprints pass. Passwords do not appear in any non-ignored source file. Guarded launcher startup, production/secret rejection, clean-cache web export, canonical manifest validation and diff whitespace checks pass.

**Remaining staging-preparation blockers: none.** Reviewed advisor warnings and the development-mode worker limitation remain documented above; the verified static web export is the staging acceptance entry point. This is not production security/release sign-off.

**Exact next action:** start the separate real-auth daily-operations acceptance workstream using these preserved staging resources. From this same worktree, run `node scripts/staging.mjs` and open `http://localhost:8094`; test credentials remain in the ignored local identities file. This preparation workstream stops here. Do not begin full daily-operations, native, adversarial or production acceptance without the next scoped request.
