# AGENTS.md — DohouLabs Pharmacy Stock

## Mission

Build a production-grade bilingual pharmacy operations SaaS for Web, iOS and Android, with a responsive installable PWA and durable offline-safe behavior.

PharmacyStock should allow a normal pharmacy owner and staff to operate the business without needing Supabase, GitHub, SQL, DevTools, or other developer tools for routine operations.

---

## Absolute Production Target

Repository:
`dohoumedia/pharmacystock`

Production branch:
`main`

Production app:
`https://pharmacystock-neon.vercel.app`

Production Supabase:
- Project name: `Pharmacy Stock`
- Project ref: `jeravdvssuzbthkxfvjy`

Before any Supabase query, migration, advisor check, branch operation, generated type operation, migration repair, or production write:

1. Verify the target project name is exactly `Pharmacy Stock`.
2. Verify the project ref is exactly `jeravdvssuzbthkxfvjy`.
3. Stop immediately if either differs.

Never operate on another Supabase project for this repository.

---

## Read Before Coding

Consult specifications in this order:

1. `AGENTS.md`
2. `docs/CODEX_PRODUCTION_HANDOFF.md`
3. `docs/UI_UX_BLUEPRINT.md`
4. `docs/OFFLINE_FIRST_ARCHITECTURE.md`
5. PRD
6. Functional requirements
7. User stories / business rules
8. Security / RLS requirements
9. QA requirements

If specifications materially conflict, document the conflict and stop that portion rather than guessing.

---

## Product Goal

The finished product should reliably provide:

- secure pharmacy / organization and branch access
- staff roles and permissions
- product / catalog management
- supplier management
- purchase orders and receiving
- batch and expiry management
- selling price per batch
- live stock quantities
- immutable inventory ledger
- FEFO stock allocation
- quarantine / recall / expiry / disposal protection
- POS checkout with server-controlled pricing
- payments and sales history
- stock transfers
- inventory adjustments and physical counts
- useful operational reports
- bilingual EN/FR experience
- desktop / tablet / mobile usability
- Web / iOS / Android support
- installable PWA
- safe offline behavior where intended
- maintainable production deployments and database migrations

---

## Priority

P0 core operations first.

P1 network features only after P0 is stable.

P2 intelligence / advanced analytics only after sufficient trusted operational data exists.

---

## Architecture

Prefer:

UI
→ domain service
→ data / API layer
→ Supabase / PostgreSQL

Critical business logic must not be scattered through React components.

Shared domain behavior must remain consistent across Web, iOS and Android.

Preserve existing architecture unless the task explicitly requires an approved architectural change.

---

## Supabase and Tenant Isolation

- Every schema change requires a versioned migration.
- Tenant-owned records require `organization_id`.
- Branch-scoped records require `branch_id` where appropriate.
- Database RLS is mandatory.
- Frontend filtering is never authorization.
- Pharmacy A must never access Pharmacy B's private data.
- Never ship a Supabase service-role key to browser or mobile clients.
- Privileged operations execute only in trusted database / server boundaries.
- Do not weaken least-privilege grants.
- Do not weaken RPC authorization.

---

## Inventory Integrity

`inventory_movements` is the immutable historical source of truth.

`inventory_balances` is derived / read-only current state.

Never directly overwrite authoritative stock quantities.

Never silently modify inventory without an inventory movement.

Corrections use compensating movements, not history rewriting.

Negative inventory is prohibited by default.

Concurrency controls must prevent two transactions from consuming or reserving the same final unit.

Each physical batch / lot has independent:

- expiry
- quantity
- status
- purchase cost
- selling price
- traceability

Missing `inventory_balances` rows must not be invented as zero unless the business rule explicitly proves zero.

---

## Batch Safety

Expired, recalled, disposed, quarantined, and depleted batches must not be sold.

They must not be treated as available stock.

These protections must be enforced below the UI layer.

FEFO remains authoritative for sellable stock allocation.

FEFO may select or recommend only the earliest-expiring eligible batch.

Do not weaken FEFO protections.

---

## Pricing

Selling price belongs to the batch.

Purchase cost and selling price are separate concepts.

POS pricing must remain server-authoritative.

Cashiers must not manually override normal selling price unless explicitly required by an approved feature.

Do not derive selling price from purchase cost unless an explicit business rule requires it.

---

## Purchasing and Receiving

Receiving must remain atomic.

Support partial receiving safely.

Support final receiving safely.

Preserve exact retry / idempotency behavior.

Duplicate submission must not create duplicate:

- purchase receipts
- receipt lines
- inventory movements
- received quantities
- PO status changes
- batches
- audit events

Duplicate `purchase_order_line_id` values inside a single receipt payload must be rejected before any receiving state is written.

Receiving must preserve purchase cost and selling price as distinct concepts.

---

## Financial Integrity

Completed financial transactions must not be hard-deleted.

Use refunds, reversals, or cancellations as appropriate.

Sales and payments are separate concepts.

POS pricing is server-authoritative.

Financial and inventory-changing operations must be:

- atomic
- idempotent
- retry-safe

---

## Audit

Sensitive actions require append-oriented audit events.

Examples include:

- stock adjustments
- physical count reconciliation
- disposal
- refunds
- price changes
- permission changes
- employee suspension
- exchange approvals
- transfer dispatch
- transfer receipt
- security-sensitive configuration changes

---

## Pharmacy Exchange

Pharmacy Exchange is opt-in only.

Only explicitly published eligible stock appears.

Never list:

- expired inventory
- recalled inventory
- quarantined inventory
- prohibited inventory
- shelf-life-ineligible inventory

Country configuration controls eligibility.

Workflow:

Listing
→ Request
→ Approval
→ Preparation
→ Dispatch
→ Transit
→ Receipt
→ Completion

Preserve batch traceability end to end.

---

## Public Medicine Locator

Use a controlled public availability projection.

Never expose private inventory tables directly.

Exact stock quantity is hidden by default.

Never expose:

- purchase cost
- supplier contracts
- private notes
- customers
- sales history

unless a future approved requirement safely permits a specific field.

---

## Clinical Boundary

Do not add:

- diagnosis
- dosage recommendations
- treatment recommendations
- autonomous medicine substitution

PharmacyStock v1 is an operational pharmacy SaaS.

---

## Localization

English and French are first-class.

Do not introduce hard-coded user-facing strings.

Internal enum / status codes remain language-neutral.

Backend business errors return stable codes that the client localizes.

Dates, numbers, and currencies use locale / country configuration.

---

## Currency

Do not hard-code FCFA into business logic.

Store ISO currency codes such as:

- XOF
- XAF
- CAD
- USD
- EUR

Presentation must be configurable by country / organization.

---

## Offline-First and PWA

Web must be responsive and installable as a PWA with:

- manifest
- icons
- standalone mode
- service worker
- cached app shell

Previously synchronized operational / reference data may remain readable offline where safe.

Use durable local storage suitable for Web, iOS and Android rather than volatile component state.

Queue safe writes in a durable outbox.

Every queued mutation gets a stable idempotency key.

Never pretend cached data is live.

Show status such as:

- Offline
- Syncing
- Synced
- pending operation count
- stale timestamp
- conflicts

Stock-affecting offline operations are queued intents, not local edits to authoritative stock.

Offline POS may use the last trusted synchronized stock snapshot and local provisional reservations only where explicitly supported.

Offline sales remain visibly `Pending sync` until accepted by the server.

Reconnect replay must be deterministic and retry-safe.

Never use last-write-wins for inventory-critical conflicts.

If the server rejects a queued inventory transaction because stock changed elsewhere:

- preserve the local record
- mark it conflicted
- require explicit resolution
- never rewrite the server ledger

---

## Errors and UI States

Every data-driven screen should handle applicable states:

- Loading
- Empty
- Success
- Error
- Offline
- Stale
- Sync conflict

Authorization remains enforced server / database-side even when controls are hidden in the UI.

---

## Responsive and Native UX

Web:

- desktop / tablet / mobile breakpoints
- keyboard-friendly workflows
- wider tables where appropriate
- persistent navigation where space permits

iOS / Android:

- touch-first navigation
- comfortable hit targets
- scan-first operations
- native-feeling presentation

Do not merely shrink desktop layouts onto phones.

Core domain behavior must remain shared even when presentation differs by platform.

---

## Accessibility

Support:

- keyboard navigation where applicable
- screen-reader semantics
- sufficient touch targets
- scalable text
- status communication that does not rely on color alone

---

## Security

Do not weaken:

- authentication
- RLS
- organization isolation
- branch isolation
- staff permissions
- RPC authorization
- least-privilege grants

Never add service-role credentials or private secrets to frontend code.

Never bypass server-side authorization merely to make a UI flow work.

---

## Database Migrations

Treat production migrations as high-risk.

Never:

- run `migration repair` blindly
- rewrite applied production migration history casually
- delete applied production migrations
- push unexpected migrations
- apply a migration when local / remote history is ambiguous
- assume a migration is deployed without checking remote history

Before any production migration:

1. verify project name and ref
2. inspect migration contents
3. inspect remote migration history
4. inspect local migration history
5. run dry-run where supported
6. confirm only reviewed migrations would be applied
7. stop on drift or unexpected state
8. require explicit user approval before execution

If deployment fails, stop and inspect before retrying.

Prefer a new compensating migration over rewriting applied history.

---

## Current Migration History Warning

There is known historical version / timestamp drift between:

- local files in `supabase/migrations`
- production `supabase_migrations.schema_migrations`

Do not run:

`supabase db push`

or:

`supabase migration repair`

against production until this drift has been safely reconciled.

Do not assume matching migration names automatically prove matching contents.

Historical migration reconciliation must be evidence-based.

---

## Current Pending Production Migration

The following migration was merged in PR #58:

`20260916045315_reject_duplicate_purchase_receipt_lines.sql`

Purpose:

Reject duplicate `purchase_order_line_id` values inside one receiving payload before any receiving state is written.

Do not assume this migration is deployed.

Verify production migration history first.

Production Purchasing / Receiving write QA remains blocked until this migration is safely deployed and verified.

---

## Development Workflow

Use small, scoped PRs.

Do not combine unrelated fixes.

Do not modify unrelated files.

Do not automatically merge.

Do not automatically deploy production changes.

Stop and report unexpected repository, schema, migration, security, or production state instead of guessing.

Before modifying code:

- inspect current branch
- inspect `git status`
- inspect relevant diff / base state

Use dedicated branches or worktrees for scoped changes where appropriate.

---

## Model / Reasoning Guidance

Use the smallest capable model for the task.

### GPT-5.6 Terra Light

Prefer for:

- status checks
- file inspection
- Git history
- hashes
- logs
- simple comparisons
- mechanical cleanup
- migration inventory listing
- CI inspection

### GPT-5.6 Terra Medium

Prefer for:

- UI work
- TypeScript
- tests
- bounded debugging
- ordinary feature work
- localization
- responsive layout work

### GPT-5.6 Sol High

Use for:

- production migrations
- Supabase schema changes
- RLS
- authentication / authorization
- security
- immutable inventory ledger
- FEFO
- transaction integrity
- idempotency
- payments
- migration reconciliation final judgment
- high-risk production operations

Keep investigations narrowly scoped to reduce unnecessary agent usage.

Do not use Sol High for simple mechanical work.

---

## Tests

Applicable unit, integration, RLS / security, localization, offline-sync and critical E2E tests accompany implementation.

Release blockers include failures in:

- tenant isolation
- inventory integrity
- expired-stock protection
- idempotency
- privilege escalation
- transfer integrity
- offline replay integrity

---

## Quality Gates

For relevant application changes, normally run:

- `npm install`
- `npx expo install --check`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npx expo-doctor`
- `npx expo export --platform web`
- `git diff --check`
- relevant SQL regression tests

Run focused tests where available.

Do not modify dependency files merely to fix unrelated Expo live patch drift unless dependency work is explicitly requested.

Known baseline:

Expo package metadata may drift independently of a feature PR.

Treat Expo patch drift separately from feature correctness unless dependency alignment is the explicit task.

---

## Supabase Security Advisor

After relevant database / RLS / grant changes, run Supabase Security Advisor.

Security lints should be resolved or explicitly reviewed before production sign-off.

---

## Migration and Seed Data

Never rewrite applied production migration history.

Create new migrations for new schema changes.

Development / test seed data should include at least:

- two organizations
- multiple branches where relevant
- active batches
- near-expiry batches
- expired batches
- recalled batches
- quarantined batches

so isolation and stock safety are testable.

---

## Secrets

Never commit:

- `.env`
- service-role keys
- private keys
- payment credentials
- messaging credentials
- mobile signing secrets

`.env.example` contains variable names only.

---

## Dependency Discipline

Before adding a dependency, verify:

- the current stack does not already provide the capability
- maintenance status
- security health
- Web compatibility
- iOS compatibility
- Android compatibility

Avoid unnecessary dependencies.

---

## Code Quality

Use:

- TypeScript strictness
- focused modules
- explicit types
- reusable domain logic
- predictable naming

Avoid:

- giant components
- unexplained magic numbers
- business logic in UI
- unnecessary `any`
- duplicated platform business rules

---

## Git and PR Safety

PR reports should include:

- root cause
- files changed
- safety impact
- validation results
- migration status if applicable
- production impact
- whether production changed

Never auto-merge PRs.

Never auto-deploy production database migrations.

---

## Production Operations

Production writes require extra caution.

For production QA:

- prefer read-only investigation first
- use minimal test data
- avoid destructive operations
- confirm expected before / after state
- verify ledger after inventory mutations
- verify derived balances after inventory mutations
- verify permissions and branch scope

Pharmacy owners should not need Supabase, GitHub, SQL, or DevTools for routine operations.

If they do, treat it as a product usability gap.

---

## Recently Completed and Production-Verified

The following are already completed and production-verified unless later evidence proves otherwise:

- batch selling price foundation
- selling price display per batch
- server-controlled POS pricing
- FEFO price autofill behavior
- batch stock visibility
- On hand / Reserved / Available display
- responsive stock cards
- connectivity health probe fix
- removal of repeated unauthenticated REST HEAD 401 probe
- PWA service-worker response clone race fix
- PWA failed-fetch terminal 503 protection
- production PWA console verification
- PR #58 receiving duplicate-line guard merged into `main`

---

## Working Style

Prefer:

- NEXT STEP ONLY
- precise commands
- minimal blast radius
- evidence before mutation
- short scoped investigations
- explicit stop conditions

When a task is investigative:

Do not implement changes unless explicitly requested.

When a task involves production:

Separate:

1. investigation
2. recommendation
3. approval
4. execution
5. verification

into distinct steps.

Do not combine them into one autonomous production operation.

---

## When Codex Must Stop

Stop and report instead of guessing when:

- specifications conflict
- project target is not verified
- migration history is ambiguous
- migration risks data loss
- security is unclear
- RLS behavior is uncertain
- production state differs from expectation
- clinical behavior is requested without specification
- regulatory assumptions are required
- external provider decisions are required
- scope materially expands
- unrelated files would need changes
- production writes were not explicitly approved

---

## Documentation and Traceability

Behavior changes should update applicable:

- requirements
- API / schema docs
- tests
- translations
- operational documentation

Significant implementation work should reference requirement IDs where available.

---

## Definition of Done

A feature is done only when applicable:

- requirements are satisfied
- acceptance criteria are satisfied
- permissions are enforced
- RLS is enforced
- audit behavior exists where required
- EN / FR are complete
- loading / empty / error / offline states exist where applicable
- desktop / tablet / mobile behavior is verified
- Web / iOS / Android behavior is verified where applicable
- tests pass
- secrets remain safe
- documentation is updated
- production migration status is known
- production verification is complete where required