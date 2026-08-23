# AGENTS.md — DohouLabs Pharmacy Stock

## Mission
Build a production-grade bilingual pharmacy operations SaaS for Web, iOS and Android.

## Read before coding
Consult in this order: `AGENTS.md` → PRD → functional requirements → user stories/business rules → UX → security/RLS → QA. If specifications materially conflict, document the conflict and stop that portion rather than guessing.

## Priority
P0 core first. P1 network only after P0 is stable. P2 intelligence only after sufficient operational data exists.

## Architecture
Prefer UI → domain service → data/API layer → Supabase/PostgreSQL. Critical business logic must not be scattered through React components. Shared domain behavior must be consistent across Web, iOS and Android.

## Supabase and tenant isolation
- Every schema change requires a versioned migration.
- Tenant-owned records require `organization_id`; branch-scoped records require `branch_id` where appropriate.
- Database RLS is mandatory. Frontend filtering is never authorization.
- Pharmacy A must never access Pharmacy B's private data.
- Never ship a Supabase service-role key to browser/mobile clients.
- Privileged operations execute only in trusted server environments.

## Inventory integrity
- `inventory_movements` is the immutable historical source of truth.
- `inventory_balances` is an optimized current-state projection.
- Never silently modify stock without a movement.
- Corrections use compensating movements, not history rewriting.
- Negative inventory is prohibited by default.
- Concurrency controls must prevent two transactions from consuming/reserving the same final unit.
- Each physical batch/lot has independent expiry, quantity, status and traceability.

## Batch safety
Expired, recalled and quarantined batches cannot be sold. This must be enforced below the UI layer. FEFO may select/recommend the earliest-expiring eligible batch only.

## Financial integrity
Completed financial transactions are not hard-deleted. Use refunds/reversals/cancellations as appropriate. Sales and payments are separate concepts. Financial and inventory-changing operations must be idempotent and retry-safe.

## Audit
Sensitive actions require append-oriented audit events, including stock adjustments, disposal, refunds, price/permission changes, employee suspension, exchange approvals, transfer dispatch/receipt and security-sensitive configuration.

## Pharmacy Exchange
- Opt-in only.
- Only explicitly published eligible stock appears.
- Never list expired, recalled, quarantined, prohibited or shelf-life-ineligible inventory.
- Country configuration controls eligibility.
- Workflow: Listing → Request → Approval → Preparation → Dispatch → Transit → Receipt → Completion.
- Preserve batch traceability end to end.

## Public Medicine Locator
Use a controlled public availability projection. Never expose private inventory directly. Exact quantity is hidden by default. Never expose purchase cost, suppliers/contracts, private notes, customers or sales history unless an explicit future requirement safely permits a specific field.

## Clinical boundary
Do not add diagnosis, dosage recommendations, treatment recommendations or autonomous medicine substitution. Pharmacy Stock v1 is an operational pharmacy SaaS.

## Localization
English and French are first-class. No hard-coded user-facing strings. Internal enum/status codes stay language-neutral. Backend business errors return stable codes that the client localizes. Dates, numbers and currencies use locale/country configuration.

## Currency
Do not hard-code FCFA into business logic. Store ISO currency codes such as XOF and configure presentation per country.

## Offline/idempotency
Do not pretend cached data is live. Clearly indicate offline/stale states. Sensitive queued mutations require idempotency keys and deterministic reconciliation. Never silently use last-write-wins for inventory-critical conflicts.

## Errors and UI states
Every data-driven screen must handle Loading, Empty, Success and Error states where applicable. Authorization is enforced server/database-side even when controls are hidden in the UI.

## Accessibility
Support keyboard navigation where applicable, screen-reader semantics, sufficient touch targets, scalable text and status communication that does not rely on color alone.

## Tests
Applicable unit, integration, RLS/security, localization and critical E2E tests accompany implementation. Tenant isolation, inventory integrity, expired-stock protection, idempotency, privilege escalation, exchange integrity and Medicine Locator privacy failures are release blockers.

## Migrations and seed data
Never rewrite applied production migration history. Create new migrations. Development/test seeds must include at least two organizations so isolation is testable, plus active, near-expiry, expired, recalled and quarantined batches.

## Secrets
Never commit `.env`, service-role keys, private keys, payment/messaging credentials or mobile signing secrets. `.env.example` contains variable names only.

## Dependency discipline
Before adding a dependency, check whether the stack already provides the capability, maintenance/security health, and Web+iOS+Android compatibility.

## Code quality
Use TypeScript strictness, focused modules, explicit types, reusable domain logic and predictable naming. Avoid giant components, unexplained magic numbers, business logic in UI, unnecessary `any`, and duplicated platform business rules.

## Documentation and traceability
Behavior changes must update relevant requirements, API/schema docs, tests and translations. Significant implementation work references requirement IDs.

## When Codex must stop
Stop and report rather than guess when specifications conflict, regulatory assumptions are required, a migration risks data loss, security is unclear, clinical behavior is requested without specification, an external provider decision is required, or scope materially expands.

## Definition of Done
A feature is done only when applicable requirements and acceptance criteria are satisfied; permissions and RLS are enforced; audit behavior is implemented; EN/FR are complete; loading/empty/error states exist; Web/iOS/Android behavior is verified as applicable; tests pass; secrets are safe; and documentation is updated.
