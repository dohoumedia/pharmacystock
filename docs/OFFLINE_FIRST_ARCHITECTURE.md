# Offline-first and PWA Architecture

## Goal
The pharmacy must remain operational during intermittent or absent internet access across responsive Web/PWA, iOS and Android without corrupting authoritative inventory or financial state.

## Core model
Treat the client as a durable local replica plus operation outbox, not as the authority for stock.

### Local persistence domains
Persist at minimum:
- authenticated user/session metadata needed for offline shell access where platform/security policy permits
- organizations/branches available to the user
- permissions snapshot and timestamp
- products, barcodes and display metadata
- batches and last trusted inventory snapshot
- customers needed for operational lookup
- suppliers and open purchase-order context needed for receiving
- transfer summaries/detail needed for in-progress branch transfers
- settings/locale/currency
- recent sales/receipts needed for lookup
- queued operations and their retry state
- synchronization metadata including server revision/timestamp where available

Do not put service-role credentials or server secrets into local storage.

## Layers
Implement shared abstractions rather than sprinkling `AsyncStorage` or browser APIs through screens.

Suggested responsibilities:
- `LocalStore`: durable entity/read-model persistence
- `OutboxStore`: durable queued operation persistence
- `ConnectivityService`: online/offline state
- `SyncCoordinator`: pull refresh + ordered outbox replay
- `ConflictStore`: unresolved server rejections requiring user action
- `SyncStatusProvider`: app-wide status exposed to UI

Platform adapters may differ internally, but domain interfaces should remain shared.

## Read path
1. Render last synchronized local data immediately.
2. Mark it with freshness metadata.
3. If online, refresh from Supabase and update the local replica.
4. If offline, remain usable and clearly indicate the data is cached/stale.

Avoid blank screens merely because a refresh failed.

## Write classification
### A. Local drafts
Examples: transfer draft, count draft, unsent notes.
These can be created/edited offline freely because they are not yet authoritative transactions.

### B. Queueable non-stock mutations
Examples depend on existing authorization/business rules, such as customer edits or settings drafts.
Store an operation envelope with stable idempotency key and replay on reconnect.

### C. Inventory/financial transactions
Examples:
- POS sale
- refund
- purchase receipt
- transfer dispatch/receipt
- expiry disposal/supplier return
- stock adjustment/count completion

These require server acceptance to become authoritative. When captured offline, store a complete immutable intent envelope and show it as `Pending sync`.

Never fake server completion by editing the local authoritative inventory balance.

## Outbox envelope
Each queued operation should contain equivalent fields to:

```ts
{
  id: string;                 // local operation id
  kind: string;               // SALE, PURCHASE_RECEIPT, TRANSFER_RECEIVE, ...
  organizationId: string;
  branchId?: string;
  idempotencyKey: string;     // stable for lifetime of operation
  payload: unknown;
  createdAt: string;
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'FAILED';
  attemptCount: number;
  lastAttemptAt?: string;
  lastErrorCode?: string;
}
```

Never regenerate `idempotencyKey` merely because a retry occurs.

## Replay
When connectivity returns:
1. authenticate/refresh session
2. pull essential server state
3. replay pending operations in deterministic creation order within their required domain ordering
4. use the existing RPC that owns each business transaction
5. persist returned server identifiers
6. refresh affected read models
7. mark the operation synchronized

Retry transient network errors with backoff. Do not infinitely retry deterministic validation/authorization failures.

## Conflict handling
A conflict is not equivalent to a network failure.

Examples:
- offline sale requests stock that another till already consumed
- source batch became quarantined while device was offline
- purchase/transfer state advanced on another device
- permission was revoked while offline

On conflict:
- do not mutate the server to match stale client state
- preserve the local intent and receipt/draft history
- mark it `CONFLICT`
- show a human-readable localized explanation and stable backend error code
- fetch current server state when possible
- provide explicit resolution actions appropriate to the workflow
- maintain auditability

## Offline POS
Offline POS is the most sensitive path.

### Local behavior
- use the last trusted synchronized eligible stock snapshot
- perform FEFO-like provisional allocation locally for cashier feedback
- maintain local provisional reservations so the same device does not repeatedly sell its own last cached units
- create a durable sale intent with lines, payments, local receipt number and stable idempotency key
- label the transaction and receipt `Pending sync`

### Server reconciliation
On reconnect, submit through the existing server-authoritative sale RPC. The server re-evaluates eligibility, FEFO and prices according to current truth.

If accepted, replace provisional state with server sale/receipt identifiers and refreshed balances.

If rejected for insufficient/changed stock, keep the local transaction visible as a conflict and require explicit resolution. Never silently convert it into a different medicine/batch or overwrite the ledger.

### Multi-device limitation
Two devices may be offline simultaneously with the same last trusted stock snapshot. Therefore local offline quantities are advisory and cannot guarantee global stock availability. The UX must communicate pending synchronization, and server reconciliation remains final authority.

## Receiving and transfers offline
Drafting can be offline. Final stock-affecting receive/dispatch actions may be captured as pending intents if all required payload information is present, but must remain pending until server acceptance. State-machine conflicts must surface explicitly.

## PWA requirements
Web production build should include:
- valid web app manifest
- installable name/short name/icons/theme metadata
- standalone display mode
- service worker registered only in production-safe configuration
- app-shell caching
- offline fallback route/shell
- cache versioning and safe upgrade behavior
- storage migration strategy for local schema changes

Do not cache sensitive API responses indiscriminately in a generic service-worker cache. Operational data belongs in the controlled local data layer.

## Sync status UX
Global shell should expose states such as:
- Online · Synced
- Syncing…
- Offline · last synced 14:32
- 3 changes pending
- 1 conflict needs attention

Individual records pending upload should carry a visible status badge.

## Security
- encrypt/protect local data using reasonable platform facilities when available
- minimize sensitive cached fields
- clear organization-scoped cached data appropriately on sign-out/account removal
- bind the durable replica and outbox to the authenticated user; clear both before a different user session can consume them
- never cache secrets
- authorization is revalidated by Supabase on replay; a stale permission snapshot never grants server authority

## Sync lifecycle hardening
- Auth restoration remains loading until Supabase returns a persisted session or confirms that none exists. A temporary null initialization/refresh callback is not treated as sign-out.
- `SIGNED_OUT` is the authoritative runtime event for clearing the active user scope. Successful explicit sign-out performs the same cleanup as a deterministic fallback.
- Refresh and same-user route/layout remounts preserve the offline scope; a real user change still clears the readable replica and restores only that user's pending-intent vault.
- Reconnect replay refreshes an expired or near-expiry session before reading or submitting server state.
- Sensitive queued operations pull the essential authoritative read model before replay; POS refreshes branch inventory snapshots.
- Preparation failures do not bypass replay semantics: transient failures retain exponential backoff, while deterministic authentication failures become conflicts.
- Session changes and sign-out clear the cached replica and move unsynchronized outbox intents into a durable per-user vault, leaving the active namespace empty. Another user cannot inherit cached or offline data, while the original user's pending, syncing, failed, and conflicted intents remain recoverable with their unchanged idempotency keys.
- Replay is bound to the initiating authenticated-user generation and stops applying results or processing further intents as soon as sign-out or a user switch changes that generation.

## Testing matrix
Automated tests should cover:
- launch with no network after prior synchronization
- cached product/stock/customer reads
- queued operation persistence across app restart
- stable idempotency key across retries
- network drop during submission
- duplicate replay
- revoked permission on reconnect
- stale stock conflict
- two pending sales consuming overlapping cached stock
- quarantine/expiry state changed before replay
- PWA app-shell offline startup
- local schema/cache upgrade
- sign-out local-data cleanup
