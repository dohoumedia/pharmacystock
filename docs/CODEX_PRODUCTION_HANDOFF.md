# Codex Production Handoff

## Stable checkpoint
This handoff starts from `main` after Sprint 8 merge.

- Repository: `dohoumedia/pharmacystock`
- Stable baseline merge: `80e70e3e343ab63aeed09dedc5cf0f5d6f3e7ab8`
- Supabase project: `Pharmacy Stock`
- Supabase project ref: `jeravdvssuzbthkxfvjy`
- Languages: French and English
- Platforms: responsive Web/PWA, iOS, Android

## Product state through Sprint 8
Implemented business domains:
1. Organizations, branches, staff, roles and permissions.
2. Product catalog, barcodes and physical batches/lots.
3. Immutable inventory ledger, current balance view and stock counts.
4. Suppliers, purchase orders and partial receiving into the inventory ledger.
5. Expiry Center, configurable alerts, FEFO, quarantine/release, supplier returns and disposal.
6. POS, server-authoritative prices, payments, receipts, sales history and refunds.
7. Customers, reports, controlled imports/onboarding, notifications foundation, pharmacy settings, immutable audit logs and subscription foundation.
8. Multi-branch stock transfer request/approve/dispatch/receive/cancel flow with discrepancies and paired inventory movements.

## Existing application structure
- Expo Router routes under `app/`
- shared services under `src/services/`
- shared providers under `src/providers/`
- translations under `src/i18n/`
- Supabase migration history under `supabase/migrations/`
- SQL regression specs under `supabase/tests/`
- generated/focused database types under `src/types/`

Codex should improve and productionize this application rather than starting another frontend from scratch.

## Backend invariants
### Inventory
`public.inventory_movements` is the historical source of truth. `public.inventory_balances` is derived state. Never implement client-side direct quantity writes.

Stock-changing business operations should end in ledger movements such as purchase receipt, sale, refund/return-in, adjustment, transfer, supplier return or disposal according to the existing database rules.

### Transactions
Critical flows are database-authoritative and transactional. Preserve existing RPC boundaries for purchasing, receiving, POS/refunds, expiry actions and stock transfers. Do not move critical consistency logic into the React client.

### Authorization
RLS and `app_private` permission/branch helpers are authoritative. UI permission gates improve UX but never replace database enforcement.

### Idempotency
Any retryable network or offline transaction must keep a stable idempotency key across retries. Generating a new key on every retry defeats the guarantee.

## Productionization objective
Transform the current functional application into a production-ready pharmacy operating system with:
- coherent design system
- responsive desktop/tablet/mobile Web layouts
- native-feeling iOS and Android interaction patterns
- robust navigation and information architecture
- accessibility
- loading, empty, error, offline, stale and conflict states
- durable offline persistence and synchronization
- installable PWA behavior
- high-confidence tests around stock/financial/offline boundaries

## Priority user journeys
Codex should optimize these first:
1. Sign in and select pharmacy/branch.
2. Search/scan a product and inspect live/cached stock.
3. POS sale from scan/search through payment and receipt.
4. Receive a purchase order with lots and expiry dates.
5. Review expiry risk and execute controlled actions.
6. Perform stock count/adjustment.
7. Request, approve, dispatch and receive a branch transfer.
8. Inspect daily sales, inventory value and operational alerts.

## Responsive Web expectations
Desktop should not look like a stretched mobile application. Use the available width for:
- persistent sidebar/navigation when appropriate
- compact data tables with sortable/filterable columns
- split panes for list/detail workflows
- keyboard navigation and shortcuts for POS
- dense but readable operational dashboards

Tablet layouts should gracefully collapse side-by-side regions. Mobile browser/PWA should use touch-first layouts and the same durable offline engine as native apps.

## Native expectations
On iOS and Android:
- prefer focused task screens over oversized desktop tables
- support safe-area behavior and native keyboard ergonomics
- make barcode/scan workflows first-class
- use clear bottom-sheet/modal/detail patterns where appropriate
- preserve platform accessibility semantics
- never duplicate domain logic just to achieve platform-specific presentation

## Offline objective
Users must be able to continue meaningful work during internet loss. The target is not merely cached static pages. Implement a local persistence/sync subsystem as specified in `docs/OFFLINE_FIRST_ARCHITECTURE.md`.

Offline support must distinguish between:
- cached read data
- local drafts
- queued safe mutations
- inventory/financial transactions pending server acceptance
- conflicts requiring human resolution

## Security target
Before every database release:
- verify Supabase target is exactly `jeravdvssuzbthkxfvjy`
- use versioned migrations
- run applicable SQL regression tests
- run Supabase Security Advisor
- do not ship with security lints

Never expose service-role credentials to browser or native clients.

## Current known external-provider gaps
Foundations exist but provider-specific integrations are intentionally unfinished for:
- SMS
- WhatsApp
- email delivery
- push notification delivery
- automatic subscription payment collection/webhooks

Do not invent a provider. Implement provider abstractions only when a provider decision is supplied.

## Build and validation commands
Use the repository scripts/configuration and keep these green:

```bash
npm install
npx expo install --check
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo export --platform web
```

Also maintain SQL regression tests for database workflows. Repository CI currently validates the application build; database regression files must not be mistaken for automatically executed CI unless the workflow is explicitly extended.

## Immediate Codex implementation phase
Before building later network features, productionize Core v1 + Sprint 8:
1. establish the shared design system and responsive app shell
2. implement durable local storage/cache abstraction
3. implement durable mutation outbox and sync coordinator
4. add global connectivity/sync-status UX
5. make priority journeys responsive and offline-aware
6. add PWA manifest/service-worker/install behavior
7. harden POS offline behavior and conflict handling
8. verify iOS/Android navigation and interaction ergonomics
9. add offline replay/idempotency tests
10. keep all existing RLS/ledger invariants intact

Only then continue with the later P1 network roadmap such as Exchange Network, Medicine Locator and reservations/Notify Me.
