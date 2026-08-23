# Codex Production Handoff

## Start here

Repository: `dohoumedia/pharmacystock`

Current productionization baseline on `main` is merge commit `3877ae656e684d0d111e0062e7f9c22d136e4d7a` after PR #17.

Supabase production project:
- Name: `Pharmacy Stock`
- Project ref: `jeravdvssuzbthkxfvjy`
- Region: eu-west-3

Before any Supabase migration, query, advisor run, or type generation, verify the target resolves exactly to `Pharmacy Stock / jeravdvssuzbthkxfvjy`. Stop on mismatch.

Read in this order:
1. `AGENTS.md`
2. this file
3. `docs/UI_UX_BLUEPRINT.md`
4. `docs/OFFLINE_FIRST_ARCHITECTURE.md`
5. existing services, screens, migrations, and SQL tests

Do not rebuild the product from scratch. Productionize the existing Expo Router application and preserve all completed Core v1 + Sprint 8 domain contracts.

## Product state through Sprint 8

Implemented business domains:
1. organizations, branches, staff, roles, permissions
2. product catalog, barcodes, physical batches/lots
3. immutable inventory ledger, balance view, stock counts
4. suppliers, purchase orders, receiving into the ledger
5. expiry center, FEFO, quarantine/release, supplier returns, disposal
6. POS, server-authoritative pricing, payments, receipts, refunds
7. customers, reports, controlled imports, notifications foundation, pharmacy settings, immutable audit logs, subscription foundation
8. multi-branch stock transfers with request/approve/dispatch/receive/cancel, discrepancies, and paired ledger movements

## Productionization already completed

Do not repeat these slices. Build on them.

### PR #12: responsive shell/connectivity/PWA foundation
- design tokens in `src/theme/tokens.ts`
- connectivity provider and global banner
- EN/FR production translation resources
- PWA manifest, offline page, service worker, Expo web HTML integration

### PR #13: durable offline replica + outbox
- `LocalStore`
- `OutboxStore`
- storage abstraction
- sync coordinator foundation
- idempotent queued operations
- persistence tests

### PR #14: offline POS pending-sale capture and replay
- durable pending sale envelope
- stable sale idempotency key across replay
- pending/conflict visibility in POS
- reconnect replay through existing `complete_sale_with_customer` RPC
- server remains price, stock, FEFO, RLS, and ledger authority

### PR #15: offline POS catalog and stock safeguards
- cached synchronized POS catalog/search
- cached trusted branch stock snapshot from `inventory_balances.available_quantity`
- offline catalog search
- freshness timestamps
- pending same-device reservations deducted from cached available stock
- obvious local oversell blocked before enqueue
- server still revalidates on reconnect

### PR #16: broader offline read models
- cached organizations and organization/branch context
- cached role/permission snapshots for offline UX only
- cached customers, settings, products, batches
- organization provider fallback to cached context
- explicit cached-data/freshness metadata
- offline customer read support with online-only mutation enforcement

### PR #17: sync retry/crash hardening
- exponential backoff for retryable failures
- missing handlers become terminal conflicts instead of infinite retry loops
- stale `SYNCING` operations recover after interrupted sessions
- stable idempotency retained across retries
- single-flight replay per coordinator instance
- tests for missing handlers, backoff, stale-sync recovery

## Non-negotiable backend invariants

### Inventory
`public.inventory_movements` is immutable and is the historical source of truth. `public.inventory_balances` is derived state.

Never write inventory balances directly from the client. All stock-changing flows must resolve through existing transactional server/database paths.

### Transactions
Preserve existing RPC boundaries for purchasing, receiving, POS/refunds, expiry actions, stock transfers, and inventory ledger posting. Do not move critical consistency rules into React state.

### Authorization
RLS and `app_private` helpers are authoritative. UI permission gates improve UX but never replace database enforcement. Cached permission snapshots are navigation/read hints only and must never authorize server mutations.

### Idempotency
Every retryable or offline mutation must retain one stable idempotency key for its full lifecycle. Never regenerate it on retry.

### POS safety
Expired, quarantined, recalled, or otherwise ineligible stock must never become sellable. Preserve FEFO and server-authoritative prices. Offline stock is a last-trusted snapshot only, never live authority.

### Conflict policy
No silent last-write-wins for inventory-critical or financial conflicts. Server ledger wins reconciliation. Preserve local intent, mark conflicts explicitly, and require clear user resolution where needed.

## UI/UX direction

Use one design system with responsive expressions.

Design synthesis:
- Sortly clarity
- PrimeRx pharmacy speed
- PioneerRx task focus
- Odoo responsive/PWA structure

Avoid:
- dated visual treatment
- ERP clutter
- fragmented app-family behavior
- generic non-pharmacy terminology

Desktop:
- persistent side navigation where appropriate
- denser inventory tables
- keyboard-friendly POS
- filters, split panes, operational dashboards

Tablet:
- adaptive layouts between desktop density and touch-first flows

Mobile iOS/Android:
- thumb-friendly task screens
- bottom navigation/native patterns where appropriate
- scan-first interactions
- large quantity controls
- native-feeling keyboard and safe-area behavior

Every data view must handle loading, empty, error, offline, stale, syncing, synced, pending, and conflict states.

Accessibility requirements:
- screen-reader semantics
- keyboard support on Web
- sufficient touch targets
- non-color-only status communication

Languages: English and French throughout.

## Offline architecture contract

Client is a durable local replica plus operation outbox, never stock authority.

Persist synchronized read data needed for meaningful disconnected work, including:
- orgs/branches
- permissions snapshot + timestamp
- products/barcodes
- batches and trusted inventory snapshots
- customers
- settings/locale/currency
- recent receipts/sales where appropriate
- queued operations and retry state
- sync metadata

Read path:
1. render local data immediately when available
2. visibly mark freshness/staleness
3. refresh from server when online
4. update local replica after successful refresh

Write path:
1. preserve local intent in durable outbox
2. keep stable idempotency key
3. refresh/validate server state before replay where needed
4. replay through existing authoritative server RPCs
5. save returned server IDs
6. refresh local read models
7. mark synced or conflict

Transient failures use backoff. Deterministic validation/auth failures must not retry forever.

## Remaining production work for Codex

Start now from current `main`. Do not wait for Sprint 9.

Priority order:
1. finish the production responsive application shell and shared UI primitives across all major screens
2. make inventory, purchasing, expiry, transfers, reports, settings, and customer flows consistently offline-aware using the shared read-model infrastructure
3. add a global sync-status surface showing Offline / Syncing / Synced / Pending changes / Conflict
4. add sign-out cleanup for local user/org data
5. harden sync lifecycle with session refresh and pull-before-replay where required
6. verify native durability/runtime behavior on iOS and Android, including SQLite-backed storage behavior
7. complete PWA installability polish: production icons, manifest details, service-worker update strategy, app-shell behavior
8. verify and polish native navigation, scanning ergonomics, keyboard handling, safe areas, and touch targets
9. move new inline EN/FR strings into translation resources where appropriate
10. add missing offline integration tests for reconnect replay, deterministic conflicts, crash recovery, sign-out cleanup, and multi-pending-sale behavior
11. productionize ESLint configuration instead of relying on Expo to auto-install lint dependencies in CI
12. review dependency warnings and vulnerability report without destabilizing Expo compatibility

## Known caveats to verify, not assume

- Native persistence has not yet been fully runtime-verified on real iOS/Android devices.
- The local persistence abstraction is currently key/value based rather than a dedicated relational offline schema.
- Multi-device offline overselling cannot be fully prevented client-side. Communicate the limitation and let server reconciliation decide final acceptance.
- Some legacy lint warnings remain in older feature areas but current CI passes.
- `npm install` currently reports moderate vulnerabilities and some dependency/deprecation warnings. Do not claim a warning-free dependency tree.
- Provider-specific SMS, WhatsApp, email, push, and automatic subscription payment integrations remain intentionally undecided.

## Validation gates

Keep all of these green:

```bash
npm install
npx expo install --check
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo export --platform web
```

For database changes additionally:
- verify Supabase target exactly
- use versioned migrations
- run applicable SQL regression tests
- run Supabase Security Advisor
- ship with zero security lints

Do not confuse repository application CI with live database regression execution unless CI is explicitly extended to run it.

## Scope control

Do not begin Sprint 9 Exchange Network, Sprint 10 Medicine Locator, Sprint 11 reservations/Notify Me, or Sprint 12 analytics/intelligence until the current Core v1 + Sprint 8 production Web/PWA + iOS + Android build is complete enough to release and the productionization handoff is accepted.
