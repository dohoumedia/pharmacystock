# Bounded authenticated direct-link hydration fix

Date: November 18, 2026 (America/New_York). Final status: **BLOCKED** pending remaining real-browser acceptance.

## 1. Reproduction

Only C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock was used. On the untouched accepted staging export at localhost:8094, a real staging owner session directly opened /inventory and landed on /. Clicking Inventory worked; reloading /inventory returned to / again. A fresh owner sign-in through the actual UI succeeded, then direct /reports again returned Home. Signed-out direct /inventory displayed its existing permission denial without an authentication form.

## 2. Root cause

RootLayout put the Expo Stack beneath OwnerSetupGate and AppShell. Initial Auth restoration renders the navigator; when the user becomes available but organization/branch membership is incomplete, OwnerSetupGate replaces its children with loading/setup content, unmounting the navigator. AppShell also changes its unsigned/authenticated child structure. Recreating Stack loses the selected direct-link navigation state and falls back to Home. There is no explicit Home redirect in the setup gate. Installed Expo navigation code confirms useNavigationBuilder owns navigation state above its layout callback.

## 3. Files changed

- app/_layout.tsx: only pre-existing file changed by this task.
- src/navigation/directLinks.test.tsx: new focused regression coverage.
- docs/DIRECT_LINK_HYDRATION_FIX.md: this report.

The pre-task snapshot hashes all 492 non-ignored baseline files. Final comparison records only app/_layout.tsx changed; no existing file was removed. Evidence: .expo/direct-link-fix/baseline.json and final-integrity.json. Baseline providers, schema, scripts, dependencies, locale resources and prior acceptance evidence remain unchanged.

## 4. Fix

Stack remains mounted directly beneath the existing providers. Its supported layout callback wraps screen content in the unchanged OwnerSetupGate and AppShell. Their loading, setup, no-access and error views still withhold operational screens while navigation state survives.

For unauthenticated non-Home entry, the callback renders the existing HomeScreen sign-in UI at the requested URL. This also covers initial session loading. No new redirect discards that URL: the existing Auth lifecycle can settle its fallback before subsequently restoring a session. HomeScreen already owns loading/disabled controls and EN/FR authentication. No timers or delays were added; no Auth lifecycle, membership, branch or permission checks were modified.

## 5. Authorized direct-link result

Final staging-only export at localhost:8095: real authenticated owner direct /inventory showed Inventory and retained /inventory; reload again showed Inventory and retained /inventory. Other final owner routes and cashier routes remain browser-unverified. Contract tests cover Inventory, Reports, Sales, Settings, Purchasing and Staff layout states; those tests are not mounted navigator E2E proof.

## 6. Unauthorized and signed-out result

Focused tests retain the actual StaffScreen permission denial for a cashier, prevent private staff-directory rendering, and preserve setup/no-access/error gates. Signed-out tests render the reused sign-in flow without a redirect loop; late-session fallback coverage retains the requested route. The final signed-out UI and unauthorized cashier route still require real-browser acceptance. No permission or server authorization change occurred.

## 7. Branch and locale result

Focused contracts cover incomplete branch hydration followed by a valid selected Annex branch, and both EN/FR hydration values without losing the route. Existing ownerSetup branch-selection and locale initialization/hook suites passed. Real reload after selecting a branch and the final EN/FR browser matrix remain unverified. No branch selection or locale implementation was edited.

## 8. Staging verification

The unchanged staging launcher validates mncvahzdnofyisflympy and the public publishable key and disables implicit dotenv loading. The task uses a separate ignored server/export on port8095, preserving the old export/server on8094. It applies the same served-bundle staging/production/secret gates. Real staging Auth getUser, active membership, role permissions and branch assignments were also verified for both prepared owner/cashier users using public clients. No operational inventory/financial writes, schema changes, migrations or project configuration changes were performed. Production was never accessed.

The in-app browser actually rendered at407px; its viewport override did not produce the requested desktop width. That check is classified as mobile-width evidence only. Attempting to open the native desktop browser stopped Computer Use because it could not confidently determine the current Windows browser URL for policy enforcement. No alternate browser-control bypass was attempted. Remaining browser acceptance is blocked.

## 9. Tests and build

- Focused suites:6 files /62 tests passed before the last small auth-loading display simplification; all final tests subsequently passed in the full run.
- Full final Vitest suite:110 files /2,070 tests passed, two workers,77.66s.
- Final typecheck passed.
- Final lint:0 errors;2 inherited warnings in catalog-settings.tsx and catalog.test.ts.
- Final staging web export passed; output .expo/direct-link-fix/web.
- git diff --check passed.
- No dependency installation or Expo drift changes were needed. No database tests/advisor run is applicable to this layout-only runtime change.

Logs are retained under .expo/direct-link-fix/. Static contract tests intentionally do not claim to simulate React navigation lifetime, real session transport timing, persisted branch storage or browser locale hydration. Actual Inventory lifetime was checked in the browser; the broader real-browser matrix remains pending.

## 10. Self-review

Reviewed task changes against the pre-task file contents, not the already dirty Git baseline. Independent read-only correctness review confirmed Stack.layout keeps navigator state above conditional screen content. It identified the late Auth fallback edge case in an intermediate redirect; the final version uses the existing sign-in view without redirecting and adds late-session coverage. It also requested a valid Annex test branch; that fixture was corrected. No new dependency, architecture rewrite, weakened permission gate or arbitrary delay was introduced.

## 11. Remaining blockers

Finish final real-auth desktop/mobile direct-entry and reload checks for owner Inventory/Reports/Sales/Staff/Settings/Purchasing (including routable PO parameters), authorized cashier routes, unauthorized management denial, signed-out sign-in, selected-branch persistence and EN/FR. Verify invalid-route behavior through the existing host/not-found handling. Browser control must be available before acceptance can be completed.

## 12. Final status

**BLOCKED**: the scoped implementation, regression suite and web build are complete, but the required real-browser matrix is incomplete. No commit, push, merge, deployment, production action, Daybreak/security work or Expo drift fix occurred. Stop after this bounded change.
