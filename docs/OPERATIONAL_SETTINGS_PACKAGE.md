# Operational Settings & Business Configuration Completion

## 1. Files changed

Work performed only in `C:\Users\Admin\.codex\worktrees\catalog-opening-stock\pharmacystock`, on `codex/catalog-opening-stock`.
All ten required functional packages and the locale/hydration baseline were verified before edits. Existing uncommitted work was preserved; no reset, clean, stash, checkout, commit, push, merge, hosted project query or deployment occurred. The pre-task file hashes/copies remain under ignored `.expo/settings-baseline` (backup tests use `.snapshot` suffixes so Vitest does not execute them).

Changes relative to that accumulated baseline:

- `app/batches.tsx`
- `app/branches.tsx`
- `app/expiry.tsx`
- `app/index.tsx`
- `app/operations.tsx`
- `app/pos.tsx`
- `app/reports.tsx`
- `app/sales.tsx`
- `app/settings.tsx`
- `scripts/settings-ui-fixture.mjs`
- `scripts/test-settings-functional.ps1`
- `src/components/BatchRepricing.tsx`
- `src/components/BranchConfiguration.tsx`
- `src/components/ExpiryBatchDetails.tsx`
- `src/components/ExpiryHistory.tsx`
- `src/components/InventoryResultDetails.tsx`
- `src/components/PhysicalCounts.tsx`
- `src/components/PurchasingDetails.tsx`
- `src/components/Receipt.tsx`
- `src/components/ReportDrilldown.tsx`
- `src/components/ReportRows.tsx`
- `src/components/ReportSummary.tsx`
- `src/components/SaleDetails.tsx`
- `src/components/SalesHistory.tsx`
- `src/components/SettingsSection.tsx`
- `src/components/businessSettings.presentation.test.tsx`
- `src/domain/businessSettings.test.ts`
- `src/domain/businessSettings.ts`
- `src/domain/dashboardPresentation.test.ts`
- `src/domain/dashboardPresentation.ts`
- `src/domain/operationsPresentation.ts`
- `src/hooks/useBusinessTimezone.ts`
- `src/hooks/useSettingsRevision.ts`
- `src/i18n/index.ts`
- `src/i18n/settingsReady.en.json`
- `src/i18n/settingsReady.fr.json`
- `src/providers/OrganizationProvider.tsx`
- `src/providers/organizationContext.ts`
- `src/services/businessSettings.test.ts`
- `src/services/businessSettings.ts`
- `src/services/expiry.ts`
- `src/services/inventory.ts`
- `src/services/organization.ts`
- `src/services/posCompletion.ts`
- `src/services/sales.ts`
- `src/services/settingsEvents.ts`
- `src/utils/dateFormatting.ts`
- `src/utils/posPresentation.ts`
- `supabase/.temp/cli-latest`
- `supabase/migrations/20261118191935_operational_settings_configuration.sql`
- `supabase/tests/business_settings_functional.sql`

- `docs/OPERATIONAL_SETTINGS_PACKAGE.md` (this handoff).

Package/dependency manifests, previous package documents, previous migration files and Stage 01/02 evidence are unchanged.

## 2. Business / branch settings

The existing organization record exposes name, country, currency and default timezone. The existing branch record exposes name, address lines, city, phone, email, optional timezone and active/inactive status. No parallel profile/configuration table was added. Organization/branch edits use the existing corresponding management permissions; receipt/payment/low-stock edits use `settings.manage`; expiry uses `inventory.expiry.manage`; individual notification preferences use the existing per-user record. Staff without management rights see understandable current business context, their allowed branch choices, language and supported personal preferences.

Contact details belong to branches in the current model and are used in receipts. Organization-level address/contact fields, tax/registration identifier and logo storage are absent and explicitly disclosed rather than invented. Current branch selection is persisted per account/organization/device through the existing replica storage, revalidated against active assigned branches and falls back to an accessible active branch. Inactive branches are retained in configuration, without changing staff-assignment behavior. Deactivating the final active branch is rejected to preserve a usable pharmacy.

## 3. Timezone / currency behavior

Client validates IANA names with built-in Intl; database validates changed timezone values against PostgreSQL's bundled timezone names. Blank branch override inherits the organization zone; presentation safely falls back to UTC for invalid/missing legacy context. Reports and receipt timestamps consume branch timezone; operational purchasing, expiry and inventory timestamps use the same context. SQL DATE expiry values remain calendar dates. Sales-history filter boundaries are parsed by PostgreSQL with the explicit IANA zone, including daylight-saving transitions, instead of device-local midnight.

One organization currency is retained. A currency can change before batches, purchase orders or sales exist; afterward the database rejects the change. New batches/POs/sales acquire a shared organization row lock to serialize against currency changes. Existing PO/batch amounts inherit organization currency (POs do not have a currency column); new sales take their currency from the locked organization before the existing checkout wrapper runs. Historical sale/payment currencies remain recorded values. Missing currency is disclosed in settings/POS, blocks POS submission and never silently becomes USD/XOF. Receipt, report and purchasing formatters do not crash on an absent currency.

## 4. Receipt / payment settings

POS, sales-history details and report sale drilldown pass current business name, branch identity, address/contact, configured footer and timezone to the same receipt component. Browser print clones that localized receipt and document language. Changing the footer is visible in new print views; sale monetary values stay attached to the original sale currency. No historical identity snapshot model was introduced.

The existing payment-default preference starts a new sale. A cashier can choose another supported method; an invalid/unavailable default falls back to cash, then the first supported method (or none if no method is supported). Current supported recording methods are cash, card, mobile money, bank transfer and other; external methods record payments without processing them. No new payment-availability settings or duplicate defaults were introduced.

## 5. Low-stock / expiry settings

The existing global low-stock default accepts nonnegative values with at most four decimals, including French decimal commas. Dashboard/report low-stock semantics aggregate eligible sellable availability by product and branch before comparing with the threshold; unpriced lots are excluded from sellable quantities. Missing balances remain unknown. The setup form proposes 5 for an absent settings record; operational low-stock classification remains unconfigured/unknown until that record is saved, consistent with the existing report contract.

Expiry configuration updates the existing `expiry_policies.thresholds_days`; the existing expiry screen and Settings edit the same record. Bands are positive whole days, at most ten, deduplicated and sorted. Dashboard/expiry worklists consume those bands. Reports initialize the warning window from the largest threshold; report filters remain temporary overrides and retain their existing 3,650-day cap, now disclosed in EN/FR. Refreshing expiry alerts generates future warnings; existing notification history is retained.

## 6. Notification / locale settings

Only future in-app expiry delivery is configurable. The existing fanout now checks each recipient's `in_app` preference; absent preferences preserve default-on behavior. Existing notifications are not deleted. Email/SMS/WhatsApp/push are explicitly unavailable, with old stored preferences retained but not represented as active delivery.

Language controls use the existing i18next instance and existing locale persistence/document-language synchronization. No locale store or hydration lifecycle was replaced. Explicit EN/FR controls affect receipts, numbers and monetary formatting; business timestamps use configured zones rather than device defaults. Tax calculation/configuration is unsupported and plainly disclosed.

## 7. Settings-consumption verification

| Setting | Consuming workflow / evidence |
| --- | --- |
| Organization name / country | Name saved through owner UI, then displayed in navigation and French sale/print receipt. Country code is included in the receipt address, with branch-country override. |
| Branch contact/address | Saved through owner UI; visible in receipt and cloned print document. |
| Organization/branch timezone | Local SQL verified override and fallback; browser report and sale receipt used America/Toronto while organization default was Africa/Porto-Novo. |
| Currency | Real local CAD checkout and purchasing passed after migration; receipt/report showed CAD. Missing/invalid currency format and POS gating covered by focused tests. |
| Payment default | CARD selected in settings and appeared selected on entering POS; cashier override retained. Unavailable-default fallbacks covered by focused tests. |
| Low-stock threshold | French input `2,5` persisted; dashboard changed from two low-stock products to zero; report displayed threshold 2.5 and zero low-stock products. Unpriced-stock aggregation has regression coverage. |
| Expiry bands | `60,7` saved; report initial warning input showed 60; shared service classifies expiry/dashboard rows with the same policy. |
| Receipt footer | Simulated lost response after commit, same-record retry, then configured footer displayed in French receipt and print document. |
| In-app preference | Local actual expiry-alert inserts verified opted-out recipients receive no new notification and enabled recipients receive subsequent alerts. |
| Locale | French UI and receipt verified on desktop/mobile; persisted French after root reload. Existing hydration/persistence tests passed. |
| Current branch | Owner selected Second; full root reload restored Second and French. Selection/fallback retains existing active branch access helpers. |

## 8. Save / retry behavior

Each form saves one existing record. Business and branch saves are scoped updates; settings/policy/preferences retain their existing primary-key upserts. A section has a synchronous in-flight guard, disabled controls, localized validation/loading/success/error/retry feedback, and hides success when the current draft changes. Failed or uncertain saves preserve entries. Retrying confirms the same record rather than creating duplicate preference records. Writes require online, freshly synchronized authorization and successfully loaded settings. These configuration edits are online-only, not queued inventory operations.

Successful writes invalidate consuming workflows without a second values store. Organization/branch saves refresh context. Explicit reload refreshes context before remounting drafts, and preserves drafts/shows failure when refresh fails. Reconnect does not silently replace edited settings drafts. Explicit reload restored the stored profile after an unsaved draft; settings, selected branch and French survived a full root reload. Saved settings survive reload; concurrent administrator conflict resolution is not a new versioned settings subsystem.

## 9. EN / FR changes

Added matching `settingsReady.en.json` / `settingsReady.fr.json` resources for every new field, helper, disclosure, permission state, timezone/currency/threshold/email validation, save status and retry. Existing language and status enums remain neutral. Focused coverage verifies matching keys and configured receipt presentation in both languages.

## 10. Tests / build / browser results

- Focused domain, service-save/retry and rendered receipt/missing-currency regression tests added.
- Full Vitest: 101 suites / 1,944 tests passed. TypeScript, lint (0 errors; 2 inherited warnings), web export and git diff --check passed. Final country/receipt and invalidation cleanup also passed 28 focused tests, typecheck, lint and export. All 52 package files are listed above.
- Disposable `postgres:17-alpine` fixture runs the accumulated reporting/purchasing/POS foundations plus this package's new migration, existing reporting reconciliation assertions, and settings assertions. PASS: profile save/load, invalid timezone, branch override/fallback/status, final-branch protection, currency lock/configuration, same-record retry, threshold changes, real CAD checkout, real purchase order and actual in-app fanout preferences.
- Loopback-only browser fixture at `127.0.0.1:54375`: desktop 1440×1000 and mobile 390×844; owner settings, French language, default card payment, real sale, receipt/print content, dashboard/report consumption, uncertain-save retry and ordinary-staff controls verified. The accepted sale's item linked to exactly one matching ledger movement and balances remained nonnegative.
- npm install --ignore-scripts completed; no dependency manifests changed. Existing 24 audit findings (13 moderate, 10 high, 1 critical) and worklets peer warning remain outside this package. No vulnerability investigation/remediation was performed.
- Expo compatibility check retains five pre-existing patch mismatches; Expo Doctor passes 20/21 with only the dependency-version check failing. No dependency drift was fixed.
- Physical printing and real iOS/Android runtime acceptance are not certified. No hosted Security Advisor or production verification was run because production access was forbidden.

## 11. Self-review findings / corrections

Independent read-only review compared actual changes against the accumulated baseline. Corrections included explicit draft reload, nullable branch name handling, safe missing-currency presentation, configured-zone sales filters/operational dates, disclosed report window cap, notification preference consumption, PO schema compatibility and sales insert currency timing. Local SQL additionally exposed the existing organization audit trigger assuming an `organization_id` field on the organization row; the new migration corrects that assignment while retaining existing before/after audit behavior and other trigger users. Dashboard sellable low-stock aggregation was aligned with reports. Existing settings/locale models and unrelated functionality were retained.

An initial full test run also executed copied baseline tests; backup tests were renamed `.snapshot` and excluded without changing the test configuration. The initial browser export retained the previous package's loopback port in the bundler cache; a cleared export rebuilt correctly for port 54375. These fixture/tooling corrections did not alter production or dependencies.

## 12. Remaining settings / configuration blockers

`20261118191935_operational_settings_configuration.sql` is LOCAL AND UNDEPLOYED, depends on the accumulated baseline and requires a separately authorized migration-history reconciliation/release review before any hosted application. No production sign-off is implied. Production state was neither queried nor changed; hosted generated types/advisors remain outside this task. No new table or public RPC type contract was added.

Tax engine, registration/tax identifier, organization-level contact model, logo storage and external notification delivery remain unsupported by the current model, as disclosed. No multi-currency accounting/conversion, shared organization default-branch model, native/physical-printer certification or advanced concurrent-settings conflict system was added. Existing authenticated direct-link reset and Expo drift remain separate, unchanged work.

## 13. Recommended next functional package

Customer Records & Day-to-Day Customer Workflow Completion: bounded maintenance/search, sale linkage, consent/preferences disclosure, EN/FR and ordinary staff workflows using the existing customer model. No clinical recommendations, marketing delivery integration or advanced accounting.

Local browser tab, loopback API process and disposable database container were closed after verification. Ignored build/baseline artifacts remain available in `.expo`.

Stop after this package.
