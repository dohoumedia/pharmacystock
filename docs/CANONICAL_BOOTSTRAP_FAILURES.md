# Canonical bootstrap assertion resolution

Scope: the original ten failed full-schema suites only. Production and staging were never selected or accessed. No application, migration, privilege, policy, function or main-bootstrap execution behavior changed. The existing CLI proof is extended with an explicitly disposable post-baseline migration.

## Failure matrix

The original reproduction executed all 25 suites from a new empty isolated database: **15 passed, 10 failed, 0 skipped**. Exact original SQL, database errors, expected/actual results, affected objects, migration evolution and current application/test evidence are retained in [assertion-failure-evidence.json](../supabase/bootstrap/assertion-failure-evidence.json).

| Suite | Classification | Proven root cause | Correction / retained invariant |
| --- | --- | --- | --- |
| `business_settings_functional.sql` | OBSOLETE ASSERTION | Later notifications migration explicitly removed expiry insert-trigger fanout. No trigger or notifications existed in diagnostic. | Test current recipient refresh: absent preference defaults on; opting out closes active rows and creates none; re-enabling produces exactly one unread expiry condition across repeats. |
| `catalog_opening_stock_functional.sql` | OBSOLETE ASSERTION | Later import worker returns saved cumulative `valid_rows` on terminal partial retry: result 1, ledger count 1. | Expect stable result 1; retain original invalid-row/error and exactly-once ledger checks. |
| `operational_reports_functional.sql` | FIXTURE/ASSUMPTION DEFECT | Fixture yesterday in UTC was today in Toronto: session date Nov 19, business date and expiry both Nov 18. Actual expired filter correctly returned 0. | Set expiry to pharmacy business yesterday; retain expected ACTIVE stored status, expired risk and report count unchanged. |
| `owner_first_use_functional.sql` | FIXTURE/ASSUMPTION DEFECT | Selective fixture inserted incomplete supplier/product/PO rows; full schema correctly requires supplier/product names and real PO fields. | Named supplier, normal catalog and purchasing RPCs as owner; exact initial/final checklists retained. |
| `sprint2_catalog_rls.sql` | FIXTURE/ASSUMPTION DEFECT | `ma00` manufacturer and `pr00` product IDs are invalid UUIDs. | Consistent hexadecimal IDs; every original isolation/creation/deletion check retained. |
| `sprint3_inventory.sql` | FIXTURE/ASSUMPTION DEFECT | Authenticated UPDATE fails at grants before immutability trigger. A bad closing dollar quote and incorrect replay error expectation were subsequently exposed. | Require authenticated denial; independently test owner UPDATE/DELETE trigger with exact immutable error. Fix delimiter. Require exact completed-count P0002 plus unchanged balance, one correction and one audit. |
| `sprint5_expiry.sql` | FIXTURE/ASSUMPTION DEFECT | Single-dollar DO delimiter is invalid SQL. | Correct dollar quotes only; all 14 original expiry/FEFO/action checks retained. |
| `sprint6_sales_history_rls.sql` | FIXTURE/ASSUMPTION DEFECT | Cashier lacks `inventory.adjust`, so seeding inventory as cashier correctly fails RLS. | Seed stock as fixture owner; original cashier still executes all four blocked-branch checks. Add real allowed-branch sale/item positive controls. |
| `sprint7_core_completion.sql` | OBSOLETE ASSERTION | Legacy automatic expiry notification fanout intentionally superseded. | Invoke the current inbox refresh after expiry refresh; all original checks retained. |
| `sprint8_branch_transfers.sql` | FIXTURE/ASSUMPTION DEFECT | Inventory officer has no `audit.read`: stored create event 1, actor-visible raw events 0, scoped history events 1. | Preserve every original workflow/branch check and all six raw audit count/metadata checks using owner observer; add current scoped history checks. |

Totals: **0 real schema defects; 3 obsolete assertions; 7 fixture/assumption defects; 0 order/state dependencies; 0 unknown**. No obsolete classification relies merely on successful application behavior.

## Evidence for intentional contract replacements

1. **Notification suites:** `20260823171000_sprint7_import_notifications_customer_sales.sql` created insert-trigger delivery with `payload.alert_id`. `20261118191935_operational_settings_configuration.sql` added preferences to that worker. `20261118213000_notifications_operational_followup.sql` explicitly drops `expiry_alert_notify` and introduces `refresh_operational_notifications`, `condition_key`, `resolved_at` and batch-based payloads. `src/services/notifications.ts` and `NotificationProvider.tsx` use that replacement; their current types/read queries and `notifications_functional.sql` validate it. Preference semantics and owner-visible expiry notices remain covered.
2. **Import suite:** the Sprint 7 worker was replaced by catalog/opening-stock and then `20261118215803_controlled_imports_onboarding.sql`. The final function returns saved `valid_rows` for COMPLETED and FAILED terminal jobs. `src/services/coreCompletion.ts` exposes numeric commit results and saved counts; `ImportWorkbench.tsx` consumes saved job/row results. `imports_onboarding_functional.sql` independently verifies cumulative partial retries, unchanged terminal job version and exactly-once stock. The older incremental-count expectation is superseded, while ledger protection is retained.

## Current contracts that were never obsolete

- Inventory grant denial is a valid enforcement layer. The original ledger migration defines both the immutable trigger and OPEN-only count UPDATE policy. SELECT FOR UPDATE on a completed count cannot find an updatable row. Both the September audit worker and November audit-boundary replacement preserve that locking contract. The current application reads/recoveries completed counts before retry (`reconcileInventoryCount`); `inventory_completion_functional.sql` already covers that behavior. The corrected legacy suite requires the precise current error and unchanged domain state, alongside direct trigger coverage.
- Transfer creation audit is valid. Sprint 1 restricts raw audit reads, and the September audit migration records lifecycle events. The November transfer-context migration supplies a guarded history projection used by `readTransferProjection`/`loadTransferDetail`. Raw metadata assertions now use an appropriate observer; no grants were added.
- Report expiry is evaluated against the live pharmacy business calendar, independently of the requested historical financial window. The stored ACTIVE/risk-expired assertion is unchanged; only its clock assumption is repaired.
- Supplier/product required fields, UUID syntax, cashier inventory permissions, expiry action safety and checklist semantics remain unchanged. Their original/current migrations and application APIs are itemized in the JSON evidence.

## Determinism and starting state

The existing runner requires an empty application schema and executes all 53 pinned files intact. It clones that complete clean schema into a separate database for **each** suite. Suite execution cannot affect another suite, including fixture-retaining suites. No suite relies on a preceding suite's domain state.

Explicit shared DML prerequisites are `suite-fixture.sql` for business settings, customer workflow, notifications and daily operations. `assertion-helper.sql` supplies only the test assertion function for expiry/transfer completion. These are documented runner prerequisites, not selective application schemas or compensating schema changes. All other setup remains inside its own suite. No testing framework or runner exception was added.

## Reproduce

From the required checkout, using the already-installed pinned PostgreSQL image:

```powershell
python scripts/canonical-bootstrap.py --runs 1
python scripts/canonical-bootstrap.py --runs 2
python scripts/canonical-cli-proof.py --cli <absolute-path-to-supabase.exe>
npm test
npm run typecheck
```

The first two commands run the complete suite list, not a selection. See [CANONICAL_BOOTSTRAP.md](CANONICAL_BOOTSTRAP.md) and [proof-report.json](../supabase/bootstrap/proof-report.json) for final results, schema hashes and evidence paths.

## Review and compatibility

No assertion was skipped/deleted; original invariants remain covered. The obsolete notification transport is replaced with stronger current preference/lifecycle coverage. The import result change retains the original exactly-one movement check. All six transfer audit checks retain their original predicates and metadata expectations; only their observer changes. Inventory coverage now tests both permission denial and the actual immutable trigger. Syntax repairs expose all formerly unreachable checks.

Review caught an incidental accent-encoding change in the reports fixture and restored the original text. It also clarified the sales-history role transition comment. The final two clean proofs were rerun after those corrections. All 53 migration raw hashes and application/package/manifest/main-bootstrap-runner fingerprints remain unchanged. The CLI proof extension executes only in a separate unlinked local export.

This is a **fresh-environment proof**. Production requires no migration-history changes, historical replay or corrective bootstrap SQL. Never apply the generated baseline to an existing pharmacy database. Real Auth, PostgREST, hosted-platform and browser/native E2E verification remain separate future work, not claims made by this database proof. No staging, production operation or follow-on feature work is authorized by this result.
