# Customer Records & Day-to-Day Customer Workflow Completion

## 1. Files changed

Work performed only in `C:/Users/Admin/.codex/worktrees/catalog-opening-stock/pharmacystock`, branch `codex/catalog-opening-stock`, inherited HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`. All eleven required package/locale documents and their implementation were present. Before editing, eleven baseline suites passed 200 tests, and SHA-256 fingerprints captured 433 source files under ignored `.expo/customer-baseline`. No inherited files were removed. The 425 files outside the eight intentional extensions remain byte-for-byte unchanged, including dependencies, prior migrations, earlier package documents and evidence.

Modified existing files:
- `app/customers.tsx`
- `app/pos.tsx`
- `src/components/Receipt.tsx`
- `src/components/SalesHistory.tsx`
- `src/i18n/index.ts`
- `src/services/coreCompletion.ts`
- `src/services/posCompletion.ts`
- `src/services/sales.ts`

Added:
- `src/components/CustomerDirectory.tsx`
- `src/components/CustomerEditor.tsx`
- `src/components/PosCustomerPicker.tsx`
- `src/components/customerWorkflow.presentation.test.tsx`
- `src/domain/customerWorkflow.ts`
- `src/domain/customerWorkflow.test.ts`
- `src/services/customerWorkflow.ts`
- `src/services/customerWorkflow.test.ts`
- `src/i18n/customersReady.en.json`
- `src/i18n/customersReady.fr.json`
- `scripts/customer-ui-fixture.mjs`
- `scripts/test-customer-functional.ps1`
- `supabase/tests/customer_workflow_functional.sql`
- `docs/CUSTOMER_WORKFLOW_PACKAGE.md`

Traceability: PRD-007, CUS-FR-001/002/003, POS-FR-001/007/008, BR-005/008/010/016/018. No Daybreak, adversarial/security testing, production access, deployment, commit, push, merge, dependency alignment, direct-link reset repair or Stage 01/02 evidence changes occurred.

## 2. Existing customer model discovered

Existing organization-wide `public.customers`: UUID, organization ID, full name, optional phone/email/notes, preferred EN/FR locale, marketing/service notification consent, active/archived status, creator and timestamps. There is no branch field or customer/member/reference number. `sales.customer_id` is optional and has an organization-scoped foreign key. Refunds reference the original sale. Existing active-phone exact uniqueness and case-insensitive active-email uniqueness remain intact. `customer.read`, `customer.manage`, `sale.read` and `sale.refund` remain authoritative through existing RLS/RPCs. No new table, identity system, permission, RPC, migration or generated schema contract was introduced.

## 3. Customer list/search changes

Directory shows name, phone/email, status, searchable identity fields and a useful empty state. Queries select 25 rows plus one lookahead, with stable name/UUID ordering and previous/next controls. Search is server-side and bounded for all names, emails and phone formats. Phone regex matching ignores formatting separators while preserving the exact digit sequence; no country code or national/international equivalence is inferred. The existing directory and POS reuse one component. The old unbounded customer loader and unused unsafe create/archive entry points were retired from the core service.

Only the most recently synchronized page per user/organization/surface is retained in the existing durable replica. Cached pages are explicitly labeled incomplete/stale, and uncached searches never pretend to be complete/live. Profile writes and purchase history/refunds remain online-only. The most recent purchase is first in the history drilldown; no unbounded per-customer last-purchase scan or separate analytics model was added.

## 4. Create/edit behavior

Minimum form: name, optional phone/email/operational notes and preferred language. Input validation trims boundaries only, limits field lengths, checks phone/email syntax, and rejects malformed values. It preserves stored phone formatting and email case rather than rewriting identity. Existing consent values are disclosed read-only and preserved on update; creation uses existing database defaults. No clinical fields or delivery integration were added.

Changes update only the existing customer record. A conditional `updated_at` match rejects a stale/concurrent edit instead of overwriting it. During editing, directory/profile actions cannot replace the form; save/cancel returns to profile/history.

## 5. Duplicate handling

Existing active phone/email matches are checked before saving, and exact-contact database unique violations are localized. Formatting variants with the same full phone digit sequence produce a bounded duplicate warning. Users may select the existing customer, correct the entry or omit a shared contact for a genuinely distinct person. Equal names alone do not block profiles. Archived contacts follow the existing active-only uniqueness rule; restoration checks active duplicates again.

Phone-format matching is an application advisory, not a new database uniqueness constraint: independent simultaneous creations with differently formatted equivalent phones are not serialized by a normalized-phone index. No country inference, fuzzy matching, automatic merge or historical reassignment occurs.

## 6. POS customer integration

POS can open bounded search, create through the same editor when permitted, attach an existing/new customer, clear selection and continue anonymously. The selected customer remains visible. Customer forms/recovery block checkout until saved/selected/cancelled, preventing late association with the wrong sale. A synchronous guard protects programmatic/double-click submission; picker unmount cleanup releases that guard if customer access changes.

The existing sale attempt retains `customerId` on recovery; final success clears it for the next customer. FEFO, server price quote, stock availability, tender, financial idempotency and durable offline sale transport are unchanged.

## 7. Anonymous-sale behavior

No placeholder customer is created. Checkout sends the existing nullable customer parameter. Anonymous receipts show a localized walk-in label and remain valid. Both SQL and mobile French browser checkout confirmed null customer identity.

## 8. Customer purchase history

Reuses `SalesHistory`, `salesPage`, `loadSales` and `SaleDetails`, with an optional customer filter. Customer profiles stay organization-wide; sales are still restricted to branches and permissions accessible through existing RLS. History shows reference, date, branch, original total and refund state. It is bounded and opens the same sale detail for recorded payment methods, original items and refund records. Filtering across branches uses the organization timezone; sale receipts use the actual branch timezone/context. No parallel sales engine or customer analytics was created.

## 9. Refund relationship

Refunds continue through existing sale/refund identities and RPCs. Profile corrections and archive leave original sale ID, customer FK, item/payment amounts and refund links unchanged. Receipt displays the current customer name without phone, email, notes or consent. No historical customer-name snapshot existed; current profile naming is not written back to any sale. Unavailable customer reads use a localized linked-customer fallback so a profile lookup cannot block original sale/refund detail. Customer-history receipts retain configured footer/address/contact/timezone context.

## 10. Archive/status behavior

Archive and restore use the existing active/archived status, require explicit status confirmation and profile save, and preserve history. Archived profiles are searchable in their own list and still resolve on original sales. They are omitted from active POS search; existing server eligibility checks remain authoritative. No hard delete was added.

## 11. Retry/idempotency behavior

Profile forms have synchronous in-flight protection and disabled controls. Before sending, a confirmed save attempt is persisted with the same user/organization/customer identity using the existing durable attempt store. Creation generates one UUID, and recovery reads that UUID before another insert. An acknowledged-lost update is recognized by matching the intended current fields. Changed server versions are explicit conflicts. Uncertain results retain the exact form/attempt across cancel, navigation or reload; the next edit of that identity/new-profile flow checks/retries it. No new replay framework or automatic offline customer writes were added.

## 12. EN/FR changes

Matching English/French resources cover directory, search, fields, validation, duplicates, recovery, consent disclosure, status, empty/offline states and POS linkage. Existing locale initialization and persistence remain intact. Receipts and history use existing configured-zone, currency and number formatters. French decimal comma refund quantities continue through the existing refund validation.

## 13. Tests/build/browser results

- 40 new focused tests: validation, bounded search/history, creation/editing, exact and formatted-phone duplicates, name-only distinct people, lost create/update recovery, concurrent update rejection, archive/restore, nullable checkout, sale/customer/refund reads, EN/FR UI and receipt privacy.
- Final full Vitest: 104 suites / 1,984 tests passed with `npm test -- --maxWorkers=2`. One earlier unrestricted parallel run timed out in the unchanged offline evidence-inspection suite; limited-concurrency full reruns passed without changing that suite or its timeout.
- TypeScript passed; lint passed with only the two inherited warnings in catalog settings/catalog tests. Web export passed for all 21 routes. `git diff --check` passed.
- Disposable local `postgres:17-alpine` fixture passed real customer creation, duplicate phone/email constraints, profile correction, sale attachment, partial/refund retry, archive history, anonymous checkout, original payment/ledger links and nonnegative balances. No hosted database was queried or modified; no schema migration was needed.
- Real local browser fixture at `127.0.0.1:54376`: desktop 1440x1000 and mobile 390x844. POS search-none/create/attach/checkout/receipt/history/partial-refund completed in English desktop and French mobile. Lost create and update responses after commit recovered one customer each. Formatted phone and case-insensitive duplicate email warnings, selecting existing, clearing to anonymous sale, archived receipt/history, no-purchase history, 25-row page 2 from 80 seeded profiles, French persistence and mobile no-horizontal-overflow verified. A separate real CASHIER session also searched, created a customer, attached it and completed a sale with the correct cashier/customer receipt; refund controls remained absent because that role lacks sale.refund.
- Final mobile receipt retained the configured footer and showed the corrected current profile plus original total/payment and partial-refund state. Local reconciliation found one record per uncertain creation, no rejected-duplicate profiles, correct nullable anonymous sale, one refund per action and zero negative balances. Cached page and disabled writes/history were verified during a local API disconnect.
- Expo compatibility retains five inherited patch mismatches; Expo Doctor 20/21, with the version-alignment check failing. No dependency manifests changed. No iOS/Android device or physical-printer certification is claimed.

## 14. Self-review findings/corrections

Independent read-only review checked the scoped diff against the preserved baseline. Corrections: retained receipt footer in customer history; phone-format tolerant bounded lookup; checkout guard while customer creation/recovery is open; stable guard cleanup when picker unmounts; focused edit UI; optional profile lookup fallback; removed duplicate customer-reset calls. Original FEFO/pricing/ledger/refund engine and anonymous-sale behavior remain intact. No CRM/clinical overbuild was introduced.

Windows text-encoding conversion in existing-file edits was corrected before final validation. Initial new receipt test fixtures lacked a required timestamp; fixtures were corrected without changing runtime date handling. Existing noncustomer source hashes outside the eight intended extensions are unchanged. An initial permission assessment read only the later Sprint 7 additions and missed the earlier CASHIER customer.manage grant. The full inherited seed history and actual cashier browser session corrected that assessment; no permission change was necessary.

## 15. Remaining customer-workflow blockers

No unresolved blocker was reproduced in the tested local customer workflows. The inherited Sprint 1 seed already grants CASHIER both customer.read and customer.manage; the later Sprint 7 seed adds permissions without removing those grants. Actual local cashier customer creation and checkout passed. Refunds remain restricted to the existing sale.refund permission and were exercised by Owner. No RLS, grant or role change was needed. Hosted effective permissions were not inspected because production access was forbidden.

Customer-name snapshots, member/customer numbers and normalized-phone transactional uniqueness do not exist in the inherited model and were not invented. Purchase history is online-only and role/branch restricted. Native device/physical print verification, known direct-link reset behavior and Expo patch drift remain separate. Production state was not accessed or changed; all accumulated prior migration-release blockers remain unchanged.

## 16. Recommended next functional package

Notifications & Operational Follow-up Completion, limited to existing in-app notifications, role-aware inbox, deep-link recovery and existing preference delivery behavior. External email/SMS/WhatsApp/push, Exchange/Locator, clinical records and advanced CRM stay outside that package unless separately specified.

The local browser tab was closed, the temporary viewport reset, and the loopback API and disposable database were stopped after verification. Ignored exports and preserved baseline fingerprints remain under `.expo`.

Stop after this package.
