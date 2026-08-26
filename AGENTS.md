# AGENTS.md — DohouLabs Pharmacy Stock

## Mission
Build a production-grade bilingual pharmacy operations SaaS for Web, iOS and Android, with a responsive installable PWA and durable offline-first behavior.

## Absolute production target
- Repository: `dohoumedia/pharmacystock`
- Production branch: `main`
- Supabase project name: `Pharmacy Stock`
- Supabase project ref: `jeravdvssuzbthkxfvjy`
- Before any Supabase query, migration, advisor check, branch operation, or generated type operation, verify the target resolves to `Pharmacy Stock` with ref `jeravdvssuzbthkxfvjy`. If not, stop. Never operate on another Supabase project for this repository.

## Read before coding
Consult in this order: `AGENTS.md` → `docs/AGENT_OPERATING_MODEL.md` → `docs/CODEX_PRODUCTION_HANDOFF.md` → `docs/UI_UX_BLUEPRINT.md` → `docs/OFFLINE_FIRST_ARCHITECTURE.md` → PRD → functional requirements → user stories/business rules → security/RLS → QA. If specifications materially conflict, document the conflict and stop that portion rather than guessing.

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
- Privileged operations execute only in trusted database/server boundaries.

## Inventory integrity
- `inventory_movements` is the immutable historical source of truth.
- `inventory_balances` is derived/read-only current state.
- Never directly overwrite stock quantities or silently modify stock without a movement.
- Corrections use compensating movements, not history rewriting.
- Negative inventory is prohibited by default.
- Concurrency controls must prevent two transactions from consuming/reserving the same final unit.
- Each physical batch/lot has independent expiry, quantity, status and traceability.

## Batch safety
Expired, recalled, disposed and quarantined batches cannot be sold or transferred as available stock. This must be enforced below the UI layer. FEFO may select/recommend the earliest-expiring eligible batch only.

## Financial integrity
Completed financial transactions are not hard-deleted. Use refunds/reversals/cancellations as appropriate. Sales and payments are separate concepts. POS pricing is server-authoritative. Financial and inventory-changing operations must be idempotent and retry-safe.

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

## Offline-first and PWA
- Web must be responsive and installable as a PWA with manifest, icons, standalone mode, service worker and cached app shell.
- Previously synchronized operational/reference data remains readable offline where safe.
- Use a durable local database/cache suitable for Web, iOS and Android rather than volatile component state.
- Queue safe writes in a durable outbox. Every queued mutation gets a stable idempotency key.
- Never pretend cached data is live. Show `Offline`, `Syncing`, `Synced`, pending-operation count, stale timestamps and conflicts.
- Stock-affecting offline operations are queued intents, not local edits to authoritative stock.
- Offline POS may use the last trusted synchronized stock snapshot and local provisional reservations, but the receipt/sale is visibly `Pending sync` until accepted by the server.
- Reconnect replay is deterministic and retry-safe. Never use last-write-wins for inventory-critical conflicts.
- If the server rejects a queued inventory transaction because stock changed elsewhere, preserve the local record, mark it conflicted, and require explicit resolution. Never rewrite the server ledger.

## Errors and UI states
Every data-driven screen must handle Loading, Empty, Success, Error, Offline, Stale and Sync-conflict states where applicable. Authorization is enforced server/database-side even when controls are hidden in the UI.

## Responsive and native UX
- Web: use desktop/tablet/mobile breakpoints, keyboard-friendly workflows, wider tables and persistent navigation where space permits.
- iOS/Android: touch-first navigation, comfortable hit targets, scan-first operations and native-feeling presentation.
- Do not merely shrink desktop layouts onto phones.
- Core domain behavior must remain shared even when presentation differs by platform.

## Accessibility
Support keyboard navigation where applicable, screen-reader semantics, sufficient touch targets, scalable text and status communication that does not rely on color alone.

## Tests
Applicable unit, integration, RLS/security, localization, offline-sync and critical E2E tests accompany implementation. Tenant isolation, inventory integrity, expired-stock protection, idempotency, privilege escalation, transfer integrity and offline replay failures are release blockers.

## Migrations and seed data
Never rewrite applied production migration history. Create new migrations. Development/test seeds must include at least two organizations so isolation is testable, plus active, near-expiry, expired, recalled and quarantined batches.

## Secrets
Never commit `.env`, service-role keys, private keys, payment/messaging credentials or mobile signing secrets. `.env.example` contains variable names only.

## Dependency discipline
Before adding a dependency, check whether the stack already provides the capability, maintenance/security health, and Web+iOS+Android compatibility.

## Code quality
Use TypeScript strictness, focused modules, explicit types, reusable domain logic and predictable naming. Avoid giant components, unexplained magic numbers, business logic in UI, unnecessary `any`, and duplicated platform business rules.

## Quality gates
Before work is considered complete, run and pass:
- `npm install`
- `npx expo install --check`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npx expo-doctor`
- Web export
- relevant SQL regression tests
- Supabase Security Advisor with zero security lints

## Documentation and traceability
Behavior changes must update relevant requirements, API/schema docs, tests and translations. Significant implementation work references requirement IDs where available.

## Agent operating model
`docs/AGENT_OPERATING_MODEL.md` is mandatory for future multi-agent/Codex work.

Apply these defaults automatically unless a stricter task-specific instruction overrides them:
- Use Low reasoning for deterministic, low-risk mechanical work.
- Use Medium reasoning for normal feature implementation, QA, tests, ordinary debugging and routine review.
- Use High reasoning for architecture, security, database/RLS/RPC work, auth/session lifecycle, offline replay/reconciliation, inventory/financial integrity, concurrency, cross-user isolation, contradictory evidence, or repeated failures.
- Parallelize independent implementation only; serialize integration and merge one PR at a time.
- Every concurrent worker uses its own branch, worktree and localhost port.
- QA remains independent and does not silently modify product code.
- The Supervisor owns decomposition, merge order and final merge/UAT recommendations.
- Do not send full project history to every worker; provide the current `main` SHA, scoped objective, relevant invariants, acceptance criteria, validation and forbidden scope.
- Escalate Low → Medium → High when failures or uncertainty increase rather than starting every task at maximum reasoning.
- Tooling limitations must be distinguished from real product defects by independent reproduction where practical.

## When Codex must stop
Stop and report rather than guess when specifications conflict, regulatory assumptions are required, a migration risks data loss, security is unclear, clinical behavior is requested without specification, an external provider decision is required, or scope materially expands.

## Definition of Done
A feature is done only when applicable requirements and acceptance criteria are satisfied; permissions and RLS are enforced; audit behavior is implemented; EN/FR are complete; loading/empty/error/offline states exist; Web/iOS/Android behavior is verified as applicable; tests pass; secrets are safe; and documentation is updated.
