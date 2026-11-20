# Daily Operations Readiness & Cross-Workflow Acceptance

2026-11-18. Bounded local acceptance only. Traceability: ORG-FR-002/003, PUR-FR-003/004/005/006, STK-FR-001/002/003/005, POS-FR-001/003/004/005/007/008, CUS-FR-001/002/003, PRD-019, BR-002/003/004/005/007/008/009/010/016/018.

## 1. Baseline integrity

Work performed in `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, on `codex/catalog-opening-stock`, HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`. All thirteen functional-package documents plus the locale/hydration record and their accumulated implementations were present. The pre-edit status, binary tracked diff and SHA-256 inventory of 473 existing tracked/untracked files are under `.expo/daily-acceptance/`.

Final comparison: no missing baseline file; 471 unchanged files; only two existing fixture scripts changed by one added line each. An independent reviewer reconstructed both original script hashes by removing their added lines. Application code, dependencies, prior package documents/evidence, and every existing migration remain unchanged. New files are this report, `scripts/test-daily-operations.ps1`, and `supabase/tests/daily_operations_acceptance.sql`. No reset, clean, stash, checkout, commit, push, merge, deployment, production access, Daybreak work or Stage 01/02 evidence change occurred.

## 2. Fresh-owner journey

PASS WITH NON-BLOCKING NOTE. The exported app signed in a fictional new owner, accepted pharmacy `Pharmacie du Jour`, first branch `Montréal Centre`, country CA, currency CAD and timezone America/Toronto, and reached the usable dashboard with the correct pharmacy/branch and CAD presentation. French survived reload. Separate existing owner SQL assertions passed the real setup/invitation functions. Browser authentication and owner records were the existing in-memory fixture, not real Supabase Auth. The database-backed settings/day checks below are separate from that fresh-owner browser session.

## 3. Staff journey

PASS WITH NON-BLOCKING NOTE. Owner created an East/Cashier invitation; the invited email signed in, accepted through the supported in-app inbox, and reached East-only navigation. Adding Main made both branches available after sign-in. Owner changed the role to Inventory Officer, removed Main, deactivated and reactivated the membership. Final staff sign-in showed East only, inventory/purchasing navigation and no POS navigation. Existing local staff SQL assertions independently passed the actual workers. Browser identity/access changes used the existing fictional staff fixture; no email or real account access was created.

## 4. Catalog/import journey

PASS WITH NON-BLOCKING NOTE. New integrated SQL staged/posted supplier, product and opening-stock imports through the existing functions, retried the same job identities, and created one `DAY-A` product with barcode `000DAY01`, tablet unit, `DAY-OPEN`, quantity20, cost1.20 and selling price2.50. A manually created/edited `DAY-B` bottle product remained the same identity through receiving and sales. The imported barcode was scanned in the real exported POS UI, and its transferred lot was sold. Existing import/catalog suites cover mapping, duplicate identities, partial results and retained attempts. CSV upload/stage/post UI was not newly rerun in this cross-workflow pass; that is a browser coverage limit, not a new import defect.

## 5. Purchasing/receiving journey

PASS in the tested local scope. Submission uses `create_purchase_order`, which immediately creates `ordered` status; there is no separate submitted-state mutation. DAY-PO ordered10 bottles at estimated cost2. Receipts4+6 used actual cost3 and selling price8, producing one batch with10 bottles and a final received PO. Exact retries of partial and final receiving returned the original receipt identities. Browser drilldown showed both receipt links; final receipt quantity6, original PO/supplier, exact batch/lot, expiry, historical cost3 and current price8. Unsent purchase reference was cleared only after the explicit branch-switch confirmation. Existing purchasing SQL additionally verified duplicate-line rejection, atomic failures and exact retries.

## 6. Adjustment/count journey

PASS in the tested local scope. Tablet opening20 minus adjustment1 leaves19; saved count18 creates one correction-1 and leaves18. Adjustment retry and second reconciliation create no extra movements. Existing inventory tests verify saved lines across separate database connections and recovery cases. The phone browser reopened the completed count and displayed expected19/count18/variance-1, original branch, movement reference and read-only completion. New day scenario assertions independently verify final ledger arithmetic. Completed-count direct RPC retries may return STOCK_COUNT_NOT_FOUND because the update policy hides completed rows; the normal UI recognizes the completed result and prevents a second reconciliation.

## 7. Expiry/quarantine/recall/disposal journey

PASS in the tested local scope. Quarantine removes DAY-OPEN from eligible allocation; release restores it. Another positive lot with earlier expiry is recalled, and an actual server quote still selects DAY-OPEN. Whole disposal consumes the recalled quantity3 exactly once and leaves a disposed, non-sellable zero balance. Existing expiry/POS SQL suites verify expired/quarantined/recalled/disposed/depleted exclusions, threshold boundaries and partial/full supplier returns. Phone inventory displayed the disposed lot as non-sellable. A notification opened the exact source branch and batch in the expiry center.

## 8. Transfer journey

PASS in the tested local scope. Request4 tablets, approve, dispatch, receive: source18→14 and destination0→4. Dispatch/receipt retries preserve exactly two transfer movements. Destination product, lot, purchase cost and selling price match the source. A separate requested bottle transfer was cancelled without dispatch. Phone history displayed Daily A→Daily B, requested4/dispatched4/received4/missing0, and the cancelled transfer. The existing transfer suite also passed the supported shortage/discrepancy path.

## 9. POS/sale/refund journey

PASS in the tested local scope. Integrated day sale1 contains2 tablets at2.50 and2 bottles at8: total21, cash tender25, change4. A partial refund of the non-first bottle item is0.5×8=4. Anonymous sale2 is1 tablet at2.50. Exact sale/refund retries preserve original identities, payment records and movements. The browser separately scanned the transferred barcode in Daily B, attached the existing customer, completed one sale2.50 with tender3/change0.50, and posted/recovered one0.5-tablet refund1.25 in French. Source-day totals remain independent of this destination browser transaction.

## 10. Customer journey

PASS in the tested local scope. The same customer identity was created, attached, edited, archived and restored in the integrated SQL day; sale/refund relationships survived. The phone browser found that existing profile, attached it to the destination sale, saved an operational note, and showed both source/destination partially refunded sales. Opening source DAY-SALE-1 while Daily B was selected correctly displayed a Daily A receipt and its bottle refund. Existing customer assertions cover duplicate contacts, anonymous sales and retained history.

## 11. Notification journey

PASS in the tested local scope. Day operations generated expiry follow-up without duplicate active conditions. The destination browser sale reduced available tablets4→3 and generated low stock at threshold3; refund restored3.5 and closed that condition. Existing SQL verified purchasing/count/transfer follow-up, preferences, recurrence and resolution. From selected Daily B, opening the Daily A expiry notification changed context to Daily A and opened `/expiry?batchId=<original DAY-OPEN batch>`. External notification delivery remains intentionally unsupported.

## 12. Reporting/reconciliation with actual sample totals

Sample business day: 2026-11-18, Daily A, America/Toronto, CAD. New SQL uses the configured business date rather than assuming UTC and Toronto dates agree. Raw transaction sums, report summaries and browser figures independently agree.

| Measure | Expected | Actual |
|---|---:|---:|
| Completed sales | 2 | 2 |
| Gross sales | 23.50 | 23.50 |
| Refunds | 4.00 | 4.00 |
| Net sales | 19.50 | 19.50 |
| Recorded payments | 23.50 | 23.50 |
| Payments minus gross | 0.00 | 0.00 |
| PO estimate | 20.00 | 20.00 |
| Actual received cost | 30.00 | 30.00 |
| Outstanding PO value | 0.00 | 0.00 |
| Daily A tablet balance | 11 | 11 |
| Daily B tablet balance, before browser sale | 4 | 4 |
| Daily A bottle balance | 8.5 | 8.5 |
| Disposed lot balance | 0 | 0 |
| Tested ledger movements, both branches | 13 | 13 |
| Daily A stock cost value | 38.70 | 38.70 |
| Daily A stock retail value | 95.50 | 95.50 |

Tablet arithmetic:20-1 adjustment-1 count-4 transfer-2 first sale-1 anonymous sale=11. Bottles:4+6 receipts-2 sale+0.5 refund=8.5. Transfer is12 source movements plus1 destination movement, not thirteen movements in each branch. The later browser transaction in Daily B independently verified one sale2.50, one refund1.25, unchanged recorded payment2.50 and final stock4-1+0.5=3.5. Quantities of different stock units are never summed into a business total.

## 13. Exports

Actual browser downloads passed strict CSV parsing, consistent field counts, strict UTF-8 decoding and independent sums. Sales2 rows/12 columns, Inventory3/22, Purchasing1/17, Movements12/19; French Sales2/12. Localized headers retained machine amounts. `Été, "Jour"` retained its comma, quotes and accents; `Fournisseur, Montréal` remained one supplier field. Export amounts matched23.50 sales,38.70 cost value,95.50 retail value and30 actual receipt cost. Movement deltas sum to11 tablets and8.5 bottles for Daily A. Filenames identify report, branch and date range. Exports and `exports-validation.log` are under `.expo/daily-acceptance/`.

## 14. Branch-context consistency

PASS for the exercised boundaries. Server operations bind explicit branch IDs. Purchase draft switching required confirmation and erased the unsent reference. Retained count/receipt/transfer identities continued to point to Daily A; paired transfer destination was Daily B. Customer history kept original receipt branches despite the currently selected branch. Notification navigation selected its original branch/batch. Staff branch changes selected the remaining permitted branch. Existing package tests cover receiving, adjustment/count, expiry, transfer, import and POS context/retry scopes; not every editable form was newly exercised through branch-switch UI in this pass.

## 15. EN/FR desktop/mobile result

English desktop1440×1000 and French phone390×844 representative flows passed. Phone document width equalled viewport390 for POS, inventory and reports; no horizontal overflow was observed. French money, dates, accents, stock units, decimal-comma refund0,5 and threshold3,0 worked. No raw translation keys or hydration regression were observed; final captured console contains zero warning/error entries. The French refund confirmation/recovery identity line still renders raw `0.5`, while input, amount and history use localized formatting: a non-blocking presentation note, left unchanged under the workflow-blocking-fixes-only scope. Screenshot: `.expo/daily-acceptance/pharmacystock-daily-phone-closeout.jpg`.

## 16. Reload/recovery result

PASS WITH NON-BLOCKING NOTE. Owner/dashboard locale and selected branch survived reload. The known authenticated direct-link reset returned to Home; ordinary navigation reopened the workflow. Reload immediately after confirming the destination refund left its accepted server record and the same durable uncertain attempt. Explicit Recover/retry found the existing identity, cleared uncertainty and retained exactly one refund/movement; it did not submit a second refund. An unconfirmed review is intentionally not a durable confirmed attempt. Existing package suites passed receiving/import/adjustment/count/sale retry and saved-state assertions. Not every dropped-response path was newly exercised in the browser. Cached/freshness states were observed during local fixture restart and recovered with live reads.

## 17. Defects found and corrections

No new product-code functional blocker was reproduced. Two inherited browser-fixture compatibility gaps were corrected: owner membership availability had fallen through to an array instead of the current boolean response; the notifications fixture lacked two existing inventory read API mappings. Each correction is one added line in its existing fixture. No application/RPC/security behavior changed. Added45 explicit cross-workflow assertions plus the runner reusing the existing network-disabled fixture. Initial scenario assumptions about a separate submitted PO state, inactive customer status and completed-count retry error were corrected to the existing documented contracts; they were test-authoring errors, not product defects. No architecture, dependency or migration was introduced.

## 18. Test/build/browser results

- Full application suite:109 files/2051 tests passed, both initial and final runs with two workers.
- All13 existing functional database runners passed: owner, catalog, purchasing, inventory, expiry, transfers, staff, POS, reports, settings, customers, notifications and imports.
- New day scenario:45 explicit assertions passed; clean final runner rerun from a fresh disposable fixture passed, including precursor notification assertions.
- Typecheck passed. Lint passed with exactly the two inherited catalog-settings/catalog-test warnings.
- Current web export passed for all22 routes using fictional loopback configuration; owner, primary and staff browser builds succeeded.
- Both changed fixture scripts passed JavaScript syntax checks. Strict parser assertions passed all5 downloaded CSVs. `git diff --check` passed.
- Current Expo alignment check still reports the same five inherited expo/constants/linking/router/sqlite patch mismatches. No dependencies were installed/aligned or manifests changed; expo-doctor was not rerun in this pass. Prior dependency warnings remain inherited, not newly assessed.
- Independent read-only review inspected actual fixture deltas, new assertions/runner, logs and baseline hashes and found no actionable issues.

Reproduce the bounded SQL acceptance with `pwsh -NoProfile -File scripts/test-daily-operations.ps1`. It requires the already-used Docker `postgres:17-alpine` image and existing package infrastructure. It applies relevant source DDL only inside its disposable network-disabled database; it is not a full historical migration-chain rehearsal. It runs the SQL transaction with rollback and removes its own container. All task-started loopback servers, browser tabs and disposable containers were closed/removed after evidence capture.

## 19. Functional readiness matrix

PASS below means the stated local contracts/scenarios passed. It does not mean every requested action was newly executed through one real-authenticated browser session.

| Module | Status | Evidence / qualification |
|---|---|---|
| Onboarding/navigation | PASS WITH NON-BLOCKING NOTE | SQL + owner browser fixture; known direct-link reset |
| Settings | PASS | Real local DB + French phone save/consumption |
| Staff/access | PASS WITH NON-BLOCKING NOTE | SQL + fictional browser identity/access journey |
| Catalog/imports | PASS WITH NON-BLOCKING NOTE | Real RPC integration through POS/report; upload UI not newly rerun |
| Suppliers/purchasing/receiving | PASS | SQL partial/final/retry + browser PO/receipt traceability |
| Inventory/adjustments/counts | PASS | SQL/save/retry assertions + persisted browser count/stock |
| Expiry/quarantine/recall/disposal | PASS | SQL actions/server allocation + non-sellable UI |
| Transfers | PASS | SQL lifecycle/cancel/discrepancy + browser source/destination history |
| POS/payments/sales | PASS | SQL + actual local DB browser checkout |
| Refunds | PASS | Non-first SQL partial + browser confirmed-attempt reload/recovery |
| Customers | PASS | SQL lifecycle + browser attachment/edit/cross-branch history |
| Notifications | PASS | Actual operations/resolution + original-branch navigation |
| Reports/exports | PASS | Independent exact totals +5 strict-parsed downloads |
| EN/FR | PASS WITH NON-BLOCKING NOTE | Localized workflows; raw decimal in identity summary only |
| Desktop | PASS | English1440×1000 browser checks |
| Mobile web | PASS | French390×844 browser checks |
| Single real-Supabase-Auth end-to-end day | BLOCKED BY ENVIRONMENT | Existing fixtures use synthetic auth; no suitable full local Auth stack was available |
| iOS/Android native runtime | BLOCKED BY ENVIRONMENT | Not exercised; explicitly outside this environment/pass |

## 20. Remaining functional blockers and environment-only blockers

No new functional blocker in the exercised local workflows. Non-blocking existing notes: direct-link reset, French raw numeric identity line, unsupported submitted-PO amendment/cancellation, external notification delivery and refund payment-method settlement accounting. These were not expanded into new features.

Environment/coverage limits: no single real Supabase Auth→owner/staff setup→whole-day browser session; current import upload UI and every recovery/form-switch variant were not newly rerun; no native runtime or physical printer certification. Production and hosted advisors were intentionally not accessed. All accumulated baseline migrations remain local/undeployed prerequisites as recorded by their packages; production history drift and receiving guard deployment status remain unverified and unchanged.

## 21. Final verdict

**FUNCTIONALLY READY WITH NON-BLOCKING NOTES — for this bounded local acceptance scope.** This is not production release sign-off or unrestricted real-auth/native UAT certification. The tested business day reconciles exactly, retries preserve identities, unsafe stock is excluded, and the accumulated functional baseline is preserved.

## 22. Recommended next workstream

A bounded **non-production authenticated end-to-end acceptance** workstream using the complete reviewed baseline and real Supabase Auth: one fresh owner, invited staff, catalog upload, receipt, count, transfer, checkout/refund, notification and closeout in the same browser/database environment. Keep production migration reconciliation/deployment and native-device acceptance as separately authorized work. Stop after this package.