# Native Device Readiness Acceptance

Date: 2026-11-19. Scope: bounded native-runtime acceptance of the accepted, uncommitted baseline.

## 1. Baseline/environment integrity

Required worktree: `C:\Users\Admin\.codex\worktrees\catalog-opening-stock\pharmacystock`.
Branch: `codex/catalog-opening-stock`; HEAD remained `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`.

Initial nonignored-file hash inventory contained 494 files. Of those, 488 remain byte-identical; six existing files received the scoped native corrections below. No initial file is missing. Added: one regression test and this report. Existing package/lockfile, canonical bootstrap, staging launcher/configuration sources, accepted direct-link fix, and Stage 01/02 evidence were not modified. Ignored staging credentials/configuration were read but not rewritten.

The connected project was verified as **Pharmacy Stock - Staging**, `mncvahzdnofyisflympy`. The guarded launcher and fetched native bundle use its URL and public publishable key. No production Supabase target or secret/service-role key was used. Production was not queried or changed. No schema, migration, bootstrap, advisor, or migration-repair operation was run. No reset, clean, stash, checkout, commit, push, merge, or deployment occurred.

Safety qualification: existing `StaffInvitations.tsx` contains a native invitation-share fallback to the production **website**. It is separate from the verified staging backend configuration. That flow was not exercised or followed; the baseline was preserved. An unrestricted claim that every native flow is free of production URLs cannot be made. Review that fallback before native invitation QA.

## 2. Expo/RN/dependency state

Managed Expo SDK 57; installed Expo 57.0.28, React Native 0.86.3, React 19.2.3. No generated Android/iOS projects or expo-dev-client. Native dependencies include expo-constants 57.0.21, expo-linking 57.0.12, expo-router 57.0.26, expo-sqlite 57.0.4, expo-crypto 57.0.4, expo-file-system 57.0.7, expo-localization 57.0.2, expo-sharing 57.0.26, react-native-safe-area-context 5.7.0, and react-native-screens 4.26.2. Existing native/web platform utility variants were preserved.

Expo Doctor: 20/21 checks passed. Its remaining check and Expo install --check identify these five patch mismatches:

| Package | Installed | Recommended |
| --- | --- | --- |
| expo | 57.0.28 | ~57.0.33 |
| expo-constants | 57.0.21 | ~57.0.24 |
| expo-linking | 57.0.12 | ~57.0.14 |
| expo-router | 57.0.26 | ~57.0.31 |
| expo-sqlite | 57.0.4 | ~57.0.5 |

## 3. Native runtime used

Actual Android emulator: existing Pixel_8 AVD, Android 17 / API 37 x86_64, hardware acceleration, Expo Go 57.0.9. Normal physical profile 1080 x 2400 at density 420; temporary small-phone equivalent 840 x 1680 at density 420. No connected physical device. Windows has no usable iOS simulator/Xcode. No responsive web result is counted as native acceptance.

## 4. Dependency corrections

None. All five mismatches were non-blocking patch drift in the exercised compatible SDK 57 runtime. None was demonstrated obsolete or launch-blocking. This is bounded runtime evidence, not proof of compatibility for every API. Later native-module changes to core/constants/linking/sqlite would require rebuilding a custom native binary; Expo Go supplies its own binary. Package.json and lockfile remained identical to the task-start baseline and consistent with each other.

## 5. Startup result

PASS after the two fatal native defects in section 19 were corrected. Staging configuration, initial English locale, and persisted locale/context hydrated. Final launches had no fatal red screen.

The first emulator connection failed because localhost resolved to IPv6 while adb reverse reached IPv4. Starting the existing guarded staging launcher with NODE_OPTIONS=--dns-result-order=ipv4first resolved this environment issue. Metro ran on port 8096; existing unrelated servers were preserved.

## 6. Auth/session result

Real, confirmed staging owner and cashier identities signed in and out successfully. Cold restarts restored authenticated sessions. Owner permissions exposed Main and Annex; cashier remained restricted to Main. Supplemental authenticated checks verified both identity IDs and confirmed-email state. Email delivery and rejection of an unconfirmed account were not tested because no such fixture was used.

Owner French/Annex and cashier French/Main context survived cold restarts. Supporting read verification signed out only its own local client session.

## 7. Navigation result

Home, POS, Inventory, More, Purchasing, Reports, and business Settings were reached through native controls. Branch switching and role-scoped navigation remained coherent. Android Back dismissed the keyboard and returned through the exercised navigation. Header wrapping, inactive navigation contrast, and keyboard obstruction were corrected and rechecked. Expo Go's floating development tools sometimes overlaid controls; this was development-host UI.

## 8. Owner workflow result

Executed dashboard/inventory, product edit inspection, stock adjustment, PO creation, receipt, physical count, and purchasing report.

Retained minimal staging QA:
- Adjustment of lot STG-261118-A-OPEN: 11.5 to 11, with -0.5 ledger movement and reason Native_acceptance_20261119.
- PO STG-NATIVE-20261119: one unit of product B at purchase cost CAD 3.
- Receipt STG-NATIVE-REC-20261119: one unit, lot STG-NATIVE-LOT-20261119, expiry 2028-12-31; purchase cost 3 and selling price 8 remained distinct.
- PO became received with zero outstanding; report showed ordered/received value CAD 3.
- Count 12d86a91-ceb4-4bfa-95bd-728c02d6c4b2 recovered the unsent local quantity 10.5 after process restart, then completed with zero variance and no correction movement.

Final authenticated reads confirmed all current balances equal their ledger sums.

## 9. POS result

Cashier French workflow: barcode entry, eligible FEFO lot, cart, quantity 0,5, tender 1,50, total CAD 1.25, change 0.25, completed sale and receipt. Server stock decreased exactly once from 11 to 10.5.

Database sale ID: bed14fe5-494b-4710-b37c-aeb08706a141.
Displayed sale number: SALE-652c78ff-ef75-4bc2-adae-4caa7bc95fca.
Sale movement: 86e3ff5b-11b1-436c-8291-3f7a37a27d3c.

The display number contains the attempt identity; verification used the separate database ID and matching movement reference. Exactly one new sale and one sale movement exist relative to the pre-POS snapshot.

## 10. Forms/input result

Product package-size, receiving lot/expiry/quantity/cost/price, adjustment quantity/reason, count quantity, customer phone/name validation, and settings timezone fields were exercised. ISO date text inputs accepted the receipt/PO dates; these are not native calendar pickers. Soft keyboards and relevant action controls fit after the shell correction. Blank customer save displayed visible validation and did not create a customer. Product and settings inspections did not save changes.

## 11. Barcode result

PASS for ordinary text/scanner-style entry plus Enter: barcode 261118001001 selected the eligible lot with server price CAD 2.50. Camera scanning is not implemented and was not added. No physical scanner was available.

## 12. Import result

Native file picking is an existing unsupported capability; the Choose file path is web-only. A native CSV-paste supplier import completed: preview 1 valid / 0 invalid, result 1 imported / 0 failed. Retained supplier: STG_Native_CSV_20261119.

Classification: PASS WITH NON-BLOCKING NOTE for the accepted native paste workflow; native UTF-8 file selection was not accepted or claimed. The tested pasted CSV was an ASCII subset of UTF-8. Existing accented data rendered correctly. Native file selection would need separate work if required for mobile launch.

## 13. Export/share result

Purchasing CSV export opened the real Android share sheet with one file:
purchasing-Staging-Main-2026-11-19-2026-11-19.csv.

The sheet was cancelled without choosing a recipient or sending; returning to the app showed CSV prepared. Share-sheet preparation passed. Saving a file, recipient delivery, and browser-style download behavior were not claimed.

## 14. Receipt/print result

Native completed-sale receipt rendered correct French quantities, units, money, cashier, batch, and traceability. Native print/receipt-share is not implemented in the existing platform utility; printing remains web-only. No hardware integration was added or tested.

## 15. Offline/reconnect result

With actual emulator Wi-Fi and mobile data disabled, Android reported no default network. Inventory displayed Hors ligne, cached/stale notification/data labels, last synchronization time, and online-required mutation guidance. Cached active and disposed stock remained distinguishable.

After restoring connectivity and foregrounding, the app returned to online/synced state and refreshed the sale movement. No offline sale, queued replay, or conflict was created; those broader paths have unit coverage but were not accepted as native runtime scenarios in this pass.

## 16. Background/restart result

Background/foreground, force-close/relaunch, authenticated session, locale, and branch persistence passed in exercised scenarios. A locally unsent count quantity recovered after cold restart while its server count still had zero lines, proving this recovery was not merely server reloading. It was then explicitly saved and reconciled.

Final reconciliation found one native PO, one receipt, one sale, one completed count, and one supplier import. Three inventory movements were added across this pass: adjustment, receiving, sale. No restart duplicate was found. No financial or ledger records were deleted.

## 17. EN/FR/layout result

English and French representative flows passed. French comma quantities/tender, localized money/dates/units, and persisted locale were verified. Normal phone and small-phone equivalent were exercised; small-phone checks covered authentication keyboard, Home and POS navigation. Tablet, physical Android, and iOS layouts were not runtime-tested.

## 18. Runtime errors/warnings

- Functional blockers reproduced and fixed: native transform reset fatal error; browser-only window focus listener invoked on React Native.
- Native usability defects fixed: keyboard obstruction, French header compression, low-contrast inactive navigation, compact PO line compression.
- Inherited warnings retained: outbox/outboxIndexedDb require cycle; SafeAreaView deprecation.
- Compatibility warning: five Expo patch mismatches.
- Development/environment noise: Expo Go Tools overlay, NO_COLOR/FORCE_COLOR warning, initial localhost IPv6 routing issue.
- No final ReactNativeJS/AndroidRuntime fatal error was observed. Warnings were not suppressed.

## 19. Defects found/corrections

Six existing files changed from the task-start baseline:
- src/components/ui/visualStates.ts: reset native transforms with an empty array.
- src/components/ui/foundation.test.ts: cover native-safe button state resets.
- src/providers/OrganizationProvider.tsx: register/remove browser focus listeners only on web; retain AppState handling.
- src/components/AppShell.tsx: native keyboard avoidance, phone header wrapping, readable inactive navigation.
- src/components/AppShell.test.tsx: native keyboard wrapper and navigation contrast regression checks.
- app/purchasing.tsx: vertical compact line editor with unconstrained product label.

Added src/providers/OrganizationProvider.native.test.tsx for Android/iOS window-without-browser-events and web listener cleanup. Focused tests reproduced the native issues before the fixes. Affected scenarios were rechecked in the Android runtime. No pricing, ledger, FEFO, permission, migration, offline replay, or auth business rule changed.

## 20. Tests/build results

| Check | Result |
| --- | --- |
| Full suite | PASS: 111 files, 2,080 tests |
| Typecheck | PASS |
| Lint | PASS: zero errors, two inherited warnings |
| Expo Doctor | 20/21; known patch mismatch check fails |
| Expo install --check | Same five mismatches; exit 1 |
| Android + iOS Hermes exports | PASS; bundle export only |
| Web export | PASS: 22 routes |
| git diff --check | PASS |
| Staging ledger / uniqueness reconciliation | All nine final checks PASS |

Lint warnings remain in catalog-settings.tsx (effect dependency) and catalog.test.ts (import order). Dependencies were reused; no install or package changes were needed. iOS bundle generation does not establish iOS runtime or standalone binary acceptance. No new SQL tests were required because no database code changed.

Evidence is local and ignored under .expo/native-readiness/: final-operational-checks.json, auth-confirmed-identities.json, final-integrity.json, tests-final.log, typecheck-final.log, lint-final.log, expo-doctor.log, dependency-check.log, native-export.log, web-export-verified.log, native-bundle-gate.json, staging snapshots, sanitized UI captures and PNGs. These artifacts are not committed or independently uploaded.

## 21. Acceptance matrix

Statuses apply only to the described bounded scenarios.

| Area | Android emulator | iOS runtime |
| --- | --- | --- |
| Native startup | PASS | BLOCKED BY ENVIRONMENT |
| Authentication | PASS WITH NON-BLOCKING NOTE | BLOCKED BY ENVIRONMENT |
| Navigation | PASS | BLOCKED BY ENVIRONMENT |
| Owner workflow | PASS | BLOCKED BY ENVIRONMENT |
| POS | PASS | BLOCKED BY ENVIRONMENT |
| Inventory/forms | PASS | BLOCKED BY ENVIRONMENT |
| Barcode input | PASS WITH NON-BLOCKING NOTE | BLOCKED BY ENVIRONMENT |
| Imports | PASS WITH NON-BLOCKING NOTE | BLOCKED BY ENVIRONMENT |
| Exports/share | PASS WITH NON-BLOCKING NOTE | BLOCKED BY ENVIRONMENT |
| Receipt/print | PASS WITH NON-BLOCKING NOTE | BLOCKED BY ENVIRONMENT |
| Offline/reconnect | PASS WITH NON-BLOCKING NOTE | BLOCKED BY ENVIRONMENT |
| Background/foreground | PASS | BLOCKED BY ENVIRONMENT |
| Persistence | PASS | BLOCKED BY ENVIRONMENT |
| EN/FR | PASS | BLOCKED BY ENVIRONMENT |
| Phone layout | PASS WITH NON-BLOCKING NOTE | BLOCKED BY ENVIRONMENT |

## 22. Remaining native blockers versus environment-only blockers

No unresolved functional blocker was observed in the exercised Android scope after corrections. Existing camera scanning, native file picking, and native printing/receipt sharing remain capability limitations; they were not added. Unconfirmed-account rejection, invitation URLs, offline queued sales/conflicts, physical hardware, and unexercised screens remain outside this acceptance evidence.

Environment-only blocker: iOS runtime unavailable on Windows. No physical-device or standalone development-build acceptance was performed. The existing invitation production-website fallback also prevents certifying an all-native-flows staging-URL guarantee; its flow remains unexercised pending review.

## 23. Final verdict

**BLOCKED BY ENVIRONMENT** for complete Android/iOS native acceptance.

The exercised Android emulator scope is accepted with non-blocking notes after the scoped fixes. This does not certify every native capability or iOS runtime behavior.

## 24. Recommended next workstream

Run the same bounded staging acceptance on an iOS simulator or device using a compatible runtime. Before invitation QA, resolve the existing native invitation website fallback through a separately scoped decision. Keep dependency alignment, native file picking, camera scanning, printing, and expanded offline replay acceptance separate from this completed pass.
