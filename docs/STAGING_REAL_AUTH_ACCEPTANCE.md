# Real-authenticated staging daily-operations acceptance

November 18, 2026 (America/New_York). Result: **PASS WITH NON-BLOCKING NOTES in the exercised staging scope**.

All retained operational results below come from real Supabase Auth and hosted Postgres/PostgREST/RLS. No fictional auth, browser API fixtures, SQL fixture totals, service-role client, or privileged data-write bypass was used. Browser actions and supplemental positive API checks are distinguished below. This is one functional acceptance pass, not an adversarial security assessment or native-device release certification.

## Safety and preserved baseline

Worktree: C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock.
Branch: codex/catalog-opening-stock.
HEAD: e3e390c58dcdf9203a67733c00b3ebbfd08b90fd.

Verified project: Pharmacy Stock - Staging / mncvahzdnofyisflympy / ACTIVE_HEALTHY.
The prohibited production project was never queried, configured, migrated, or mutated. Explicit task instructions override the older repository production-only target rules.

The app was launched with node scripts/staging.mjs at http://localhost:8094. Its gate accepted only the explicit staging URL and public publishable key, disabled implicit dotenv loading, and checked the served bundle for the staging credentials and absence of the production ref/secret keys. No ordinary app launcher or fixture server was used. Existing staging launcher, env, canonical bootstrap, source, and earlier evidence were not edited.

All 491 tracked/untracked baseline files remain byte-for-byte unchanged; HEAD and branch are unchanged. This report is the only new non-ignored repository file. Acceptance helpers, logs, exports and snapshots are in ignored .expo/real-auth-acceptance/. No reset, clean, stash, checkout, commit, push, merge or deployment occurred.

Staging migration history was checked before and after: exactly 20261118215804 / canonical_bootstrap. No new migration was needed or applied. Prior 25-suite staging preparation results were not presented as newly executed tests in this pass.

## Acceptance matrix

PASS means the stated normal workflow was exercised successfully, not every possible variant.

| Area | Classification | Newly observed staging evidence |
| --- | --- | --- |
| Authentication/session | PASS WITH NOTE | Owner sign-out/sign-in, real identity/context, reload and session restoration; cashier sign-in/reload; direct-link note below |
| Owner onboarding | PASS WITH NOTE | Existing prepared owner, pharmacy/branch, setup checklist and settings usable; fresh signup/new pharmacy creation was not repeated |
| Staff/access | PASS | Owner directory shows active cashier/CASHIER on Main; cashier dashboard shows 9 permissions, Main only even after Annex creation; Staff/Purchasing/Transfers navigation and refund mutation absent for cashier |
| Catalog/imports | PASS | Two UI-created products, SKU/barcodes and tablet/bottle units; opening stock UI; supplier CSV mapping/preview/stage/reload/post and authenticated post retry |
| Purchasing/receiving | PASS | UI supplier → ordered PO10 → partial4/final6 → receipt/batch/movement inspection; exact authenticated retries return original receipt IDs |
| Inventory/adjustments | PASS | UI decrease1: observed20, projected/current19, reason/reference, exact movement; actor/branch retained |
| Counts | PASS | UI count18 from19, save → navigate/reload → resume → variance review → reconcile once; completed read-only result and one -1 movement |
| Expiry/safety | PASS | UI quarantine/release and disposal; real cashier quote rejects quarantine; supplemental authenticated earlier lot/recall and FEFO checks |
| Transfers | PASS | UI request4 → approve → dispatch → receive; Main18→14, Annex receives4; paired movements and exact lot/cost/price preserved |
| POS/payments | PASS | Cashier barcode lookup, two items, customer, server price/FEFO, cash25, total21/change4, attributed receipt; French anonymous sale2.50/tender3/change0.50 |
| Refunds | PASS | Owner selected second displayed item, partial0.5 tablet/1.25; reload interrupts dispatch, retained identity recovered; exact authenticated retry returns same refund, one reversal movement |
| Customers | PASS | UI create/search/attach/edit/reopen history; sale/refund retain original customer; anonymous sale has null customer |
| Notifications | PASS | Hosted expiry/purchasing/count/transfer history; bounded Annex stock3 alert, unread count, branch-aware navigation; compensation to4 resolves it; three refreshes produce one low-stock record |
| Reports/exports | PASS | Raw transactions, report RPCs and UI agree; four browser CSV downloads strict-validated against actual hosted row IDs |
| EN/FR | PASS WITH NOTE | English desktop and French phone login/dashboard/POS/inventory/reports/notifications; no captured console warning/error; raw decimal in refund history remains a presentation note |
| Desktop web | PASS | English1440×1000, sidebar and report tables; document width1440 |
| Mobile web | PASS | French390×844, mobile navigation/cards; dashboard/POS/inventory/reports/notifications document width390 |

Clearly identifiable staging operational records were retained, including the second branch, two products, supplier/import, receipts, count, transfer, sales, refund, safety history and compensating notification-test movements. The low-stock threshold was saved as 3 for the notification scenario; business currency CAD, country CA and timezone America/Toronto remain unchanged. Test users and project were not deleted.

No staff membership/role/branch assignment was changed. The existing cashier still has only Staging Main. Creating a second branch did not grant cashier access to it. Normal intended operations succeeded under the authenticated users' real grants/RLS; no permission widening was needed.

## Actual records and traceability

Organization: aeb81010-32d7-4c66-b8e8-d06715028fdb.
Main: bd9937f4-196e-4263-989e-1cbd5777b05c.
Annex: f88372be-e97f-4ee9-8580-f5100cee9972.

Dedicated prefix: STG-261118-A. Product A is STG Été, "Acceptation" A, SKU STG-261118-A-A, barcode261118001001, tablet. Product B is STG Acceptation B, SKU STG-261118-A-B, barcode261118001002, bottle.

A opening lot: 06c796ab-4758-4bff-846f-e2e74470add0, expiry2027-02-15, cost1.20, price2.50, opening20.
B receipt lot: bc79645e-f336-46c1-a095-2eb3cbd4bdbd, expiry2027-10-01, cost3, price8.
Safety lot: 6b30b3d5-56f0-4680-8bed-60cbd1d57639, opening3, expiry2026-12-01; recall excluded it from FEFO, disposal removed3 and left DISPOSED/zero.
Annex A lot: ed9ca547-d445-49c6-8c53-299e282eb39c.

PO ccff7a5c-40e0-4714-8f45-b0e4efe03c77; receipts ef901408-7388-4c1e-acc3-d05b7c8de4da and709a792c-f941-4165-aad4-658d87092a86. Estimated cost2 remains distinct from actual receipt cost3 and selling price8.
Count7eb54ea0-420d-44ba-93df-33a4fbf72607; correction a8843755-1f82-44d3-80f3-f626f7cac70b.
Transfer c91d4137-1888-4155-a542-cbbac77535c2; paired movement IDs and full branch context are in reconciliation.json.
Cashier sale c969acf2-b1b5-4ce3-9c90-16f585e2c5af.
Refund993094c1-a680-4678-b423-f7543e4b4764 selected sale item de198060-0236-42d5-b5b8-7e01513e1dcb, the second displayed refund row. It returns0.5 to original A lot; remaining refundable1.5. B remains unrefunded.
Customer17878444-e133-436b-a4f5-9ed477cad66a retains the purchase/refund relationship after its note update.
Supplier import89847c4d-ca0f-41b1-aa53-df4d33ca508a completed one row and repeat posting retained exactly one supplier.

Settings were read through the owner UI; notification acceptance saved a low-stock threshold3 with cash default. This staging business setting and clearly identified test records are retained as evidence. Hosting/Auth redirects, credentials, launcher and schema configuration were not changed. The notification stock test was compensated through a second movement; no ledger/financial history was deleted.

## Exact reconciliation

Business day2026-11-18, America/Toronto, CAD; Main unless specified. Values were expected from the performed operations, independently compared with hosted rows and report results.

| Measure | Expected | Actual |
| --- | ---: | ---: |
| Completed/partially refunded sales | 2 | 2 |
| Gross sales | 23.50 | 23.50 |
| Refunds | 1.25 | 1.25 |
| Net sales | 22.25 | 22.25 |
| Recorded payments | 23.50 | 23.50 |
| Payments minus gross | 0 | 0 |
| PO estimate | 20 | 20 |
| Actual received cost | 30 | 30 |
| Outstanding PO value | 0 | 0 |
| Main A tablets | 11.5 | 11.5 |
| Main B bottles | 8 | 8 |
| Annex A tablets | 4 | 4 |
| Disposed safety lot | 0 | 0 |
| Ledger movements, all branches | 15 | 15 |
| Main movements | 12 | 12 |
| Annex movements | 3 | 3 |
| Main stock cost value | 37.80 | 37.80 |
| Main stock retail value | 92.75 | 92.75 |
| Completed transfers | 1 | 1 |

Main A arithmetic:20-1 adjustment-1 count-4 transfer-2 cashier sale+0.5 refund-1 anonymous sale=11.5. B:4+6-2=8. Annex:4-1 notification test+1 compensation=4. Safety:3-3=0. Each of the four balances equals its own immutable ledger sum. Different stock units were not summed into one stock total.

The retained reconciliation helper contains19 explicit numeric assertions covering raw/report totals, ledger counts, purchasing, valuation, transfer count and all four balance/ledger equalities. Additional requested measures in the table were checked from the retained rows/UI. This pass used no earlier fixture totals.

## Exports

Actual browser downloads: Sales2 rows/12 columns; Inventory3/22; Purchasing1/17; Movements12/19. Filenames identify report, Staging Main and business-date range. All decode strictly as UTF-8 with consistent CSV fields; every exported hosted row ID appears once. A second validation compares every exported business field and amount to the hosted report, including embedded line breaks; all match. Inventory/movements preserve Été, the comma and escaped quotes in the product name; purchasing preserves Fournisseur, Montréal as one field. French headers/accents are retained. Evidence: the four named CSVs, sales-fr.csv and exports-validation.json.

## Direct links, reload and recovery

| Expected route | Actual after direct load | Ordinary navigation |
| --- | --- | --- |
| /inventory | / | Recovers /inventory |
| /reports | / | Recovers /reports |
| /sales | / | Recovers /sales |
| /staff | / | Recovers /staff |
| /settings | / | Recovers /settings |

Separate reload checks on inventory/reports/sales/staff also returned Home while retaining the real owner session. No routing rewrite was made: ordinary navigation restored every workflow, with accepted receiving/count/sale results and the confirmed refund intent retained. This remains a real usability defect and a non-blocking note for this tested daily workflow, not a claim that direct-link behavior passed.

Receiving recovered its saved receipt reference after reload. Count quantities18 persisted locally and on the hosted count row. Sale survived reload with one accepted server record and exact retry ID. Refund reload occurred before its server mutation completed: the retained reference reopened, explicit recovery posted one refund, and exact retry created no duplicate. Supplier import READY job survived reload before posting and remained single after post retry. Dropped-response variants at every possible request boundary were not newly simulated.

## Validation and remaining notes

- Typecheck passed.
- Vitest:109 files / 2,051 tests passed; full log retained.
- Lint:0 errors,2 inherited warnings (catalog-settings.tsx missing t hook dependency; catalog.test.ts import order). Initial restricted cache-write attempt failed; normal check completed with evidence-folder permission.
- Staging-launcher web export passed into separate .expo/real-auth-acceptance/web; the existing staging-preparation export was preserved.
- git diff --check passed.
- Expo compatibility check reports patch drift in expo, expo-constants, expo-linking, expo-router, expo-sqlite. Expo Doctor20/21; its one failed check is that version alignment. No dependency file changed; npm install was unnecessary with the prepared dependencies.
- Captured browser console:0 warnings/errors. Phone document width390; desktop1440. Native iOS/Android were outside this web acceptance.
- Fresh owner signup/email delivery, role-change writes, supplier-return variant, file-picker upload (CSV paste used), and every possible interrupted transport boundary were not repeated.
- The refund history/identity summary still renders a raw0.5 in some places. French inputs, amount, remaining quantity and main inventory/report values were usable; no fix was needed for the tested workflow.
- No new product blocker or valid-workflow RLS/PostgREST rejection occurred. One supplemental sale-retry harness initially omitted the required expected-quote argument and returned PGRST202; correcting the harness to match the application's existing request passed. It was not an app defect.
- No schema/grant/RLS changes or new migration: no new advisor run was required. The staging preparation's reviewed advisor notices remain inherited, not newly resolved.
- Dedicated staging data and both prepared users were preserved; no production action occurred.

Evidence directory: .expo/real-auth-acceptance/. Principal artifacts: baseline-integrity.json, final-integrity.json, hosted-api.jsonl, reconciliation.json, exports-validation.json, routes.json, reloads.json, console.json, tests.log, lint.log, expo-check.log, expo-doctor.log, web-export.log, French/desktop screenshots and snapshots.

Acceptance pass complete. Stop here; no merge, commit, push, application deployment or production database operation is authorized by this report.
