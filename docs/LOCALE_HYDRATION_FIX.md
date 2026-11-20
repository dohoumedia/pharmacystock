# Persisted locale and web hydration correction

Scope: product/runtime initialization only, in `codex/catalog-opening-stock`.
Traceability: BR-010 (selected UI language), bilingual and initial-render QA.
The supplied older checkout was not changed; the user selected this package checkout.
Inherited uncommitted owner/catalog changes were preserved.

## Verified causes

The untouched exported package reproduces React 418 after selecting French and
reloading English static HTML. The first text difference is `app.tagline` in
the sign-in brand: `Pharmacy operations, inventory and expiry control` versus
`Gestion de pharmacie, du stock et des péremptions`.

Classification: locale initialization ordering / persisted-storage timing.
The build cannot read local storage. The browser previously initialized the
one i18n instance from persisted French before React hydrated static English.
The resources were local, not waiting on a remote translation fetch.
A root layout-effect-only restoration was tried and rejected during browser
verification: Expo Router hydrates nested Suspense routes separately, so a root
mount is not proof that every translated component has hydrated.

Direct-route checks also verified a second text mismatch: connectivity was
`checking` on the server and optimistically `online` in the browser. Products
therefore rendered different online/permission warning text. The shared
PageHeader also selected different viewport classes on first render.
Classification: provider initialization mismatch and viewport-dependent initial
render mismatch. These corrections are limited to the verified initial values.

## Correction

- The web translation hook uses React's external-store server snapshot for each
  hydrating boundary. That snapshot and `+html` share the configured build
  locale (English when unspecified). The live snapshot remains the existing
  i18n language, including the persisted preference.
- Translation text, formatter language and language-control labels use the same
  snapshot. Projected methods still call the original instance; no duplicate
  preference/resource store exists. Native uses the original library hook.
- Bundled resources, including existing POS additions, initialize synchronously.
- The root lifecycle synchronizes document language and persists subsequent
  explicit selections, removing its listener on unmount. Storage keys and
  preference precedence are unchanged.
- Connectivity always starts `checking`; its existing probe/events own later
  state. Only PageHeader's first viewport-dependent layout uses the static
  width until hydrated. Content/providers are never withheld.
- Consumer changes outside these modules are translation-hook imports only.

No suppression, timeout-based hydration workaround, new dependency or global
content delay was introduced. No domain, database, price, inventory, receiving,
permissions or offline replay behavior changed.

## Verification

- Focused locale/input suites: 38 tests passed before adding the three
  connectivity initial-render assertions.
- Full final application suite: 74 files / 1,627 tests passed with two workers.
  The initial concurrent run timed out in one existing offline test. The full
  bounded-concurrency rerun passed without changing that test.
- Typecheck passed. Lint passed with seven existing warnings (catalog-settings,
  POS hook dependencies and catalog test import order); no new warnings.
- Web exports passed for English and French defaults, 20 static routes each.
  A clean Metro cache was required when changing the build-time locale between
  exports; otherwise Expo reused the prior browser bundle with the new HTML.
- Local browser checks used only the fictional loopback catalog fixture.
  Fresh English and French-default sessions, EN -> FR -> reload, FR -> EN ->
  reload, and the opposite persisted language against each static build were
  checked. Document language followed the selected language, with no new
  hydration warnings or raw translation keys in these checks.
- Persisted-French direct-route hydration checked Products, Purchasing,
  Opening Stock, Inventory, Batches, POS, Settings and Operations. Signed-out
  routes retained their existing permission/context states and produced no
  hydration warnings. Authenticated Products direct hydration was also clean.
- Authenticated in-app navigation checked owner setup/dashboard, Products,
  Purchasing and receipt-history tab, Opening Stock, Inventory, Batches,
  POS permission shell, Operations/Settings shell and the French mobile menu.
  The catalog fixture does not grant sale/settings-management permissions, so
  complete POS/Settings workflows were not asserted.
- Real Chrome at 390 x 844 verified French first-use form, bottom navigation,
  More menu -> Products -> Opening Stock, with matching document language and
  no console warnings/errors. Desktop was checked at 1440px.
- Self-review compared task-only changes against pre-task file contents.
  Independent read-only review found no actionable issue. Static-render tests
  were accurately named and supplemented with live snapshot/subscription,
  formatting, projected method and cleanup tests; actual nested hydration was
  verified in the browser. Existing decimal-comma parsing and EN/FR parity
  tests remained green.

## Limits and next package

A single static HTML build can show its build language before JavaScript loads;
the browser cannot send its local-storage preference to the static exporter.
After hydration each boundary adopts the saved selection without a global wait.
No key flash was observed. Real native iOS/Android runtime checks were not run.

Authenticated direct links may return to Home while OwnerSetupGate replaces
and remounts the navigator during organization loading. This was reproduced in
the untouched English package export too, and is not caused by this correction.
It is left as a separate bounded routing issue; direct-route retention is not
claimed accepted. No unrelated routing change was made.

The locale reload blocker is corrected. Purchasing & Receiving Completion can
begin as the next bounded local functional package. This is not hosted/native
release sign-off; the independent routing limitation remains recorded.
No production access, deployment, commit, push, merge, Daybreak-dependent work,
security/adversarial review, Expo version change, migration or Stage 01/02
artifact change occurred.

## Exact task file manifest

- `app/+html.tsx`
- `app/_layout.tsx`
- `app/batches.tsx`
- `app/branches.tsx`
- `app/catalog-settings.tsx`
- `app/customers.tsx`
- `app/expiry.tsx`
- `app/index.tsx`
- `app/inventory.tsx`
- `app/more.tsx`
- `app/opening-stock.tsx`
- `app/operations.tsx`
- `app/pos.tsx`
- `app/products.tsx`
- `app/purchasing.tsx`
- `app/reports.tsx`
- `app/staff.tsx`
- `app/transfers.tsx`
- `docs/LOCALE_HYDRATION_FIX.md`
- `src/components/AppShell.tsx`
- `src/components/BatchRepricing.tsx`
- `src/components/BatchStatusBadge.tsx`
- `src/components/CatalogSelector.tsx`
- `src/components/ConnectivityBanner.tsx`
- `src/components/FirstUseSetup.tsx`
- `src/components/ImportWorkbench.tsx`
- `src/components/InvitationInbox.tsx`
- `src/components/OwnerSetupGate.tsx`
- `src/components/ReadModelStatus.tsx`
- `src/components/SetupChecklist.tsx`
- `src/components/StaffInvitations.tsx`
- `src/components/SyncStatusBadge.tsx`
- `src/components/ui/layout.tsx`
- `src/i18n/index.ts`
- `src/i18n/initialization.test.tsx`
- `src/i18n/useTranslation.ts`
- `src/i18n/useTranslation.web.test.tsx`
- `src/i18n/useTranslation.web.ts`
- `src/i18n/webInitialLocale.ts`
- `src/providers/ConnectivityProvider.test.tsx`
- `src/providers/ConnectivityProvider.tsx`
