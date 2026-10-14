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

On Web, the durable outbox uses IndexedDB with one record per operation. The
operation `id` is the primary key and `idempotencyKey` is uniquely indexed, so
enqueue and record-level status updates are transactional across tabs/windows.
Active-owner metadata and per-user vaulted operations live in the same database;
account changes atomically vault the old operation set, restore the target set,
and change ownership. Enqueue verifies the expected authenticated owner inside
that serialization boundary and fails without writing if ownership changed.
Reads and replay preparation verify the same owner in their IndexedDB
transaction, so a tab that loses a concurrent account switch clears its cached
view and cannot inspect or replay the winning tab's active operation set.
Offline POS enqueue also recalculates active same-owner provisional sale
reservations and validates the requested quantities inside the same IndexedDB
read/write transaction that inserts the intent. Concurrent tabs therefore
serialize at the database boundary: an exact immutable retry returns the
existing operation, while a distinct sale that would exceed the last trusted
cached quantity is rejected without writing. Web/PWA checkout fails closed if
cross-context atomic enqueue is unavailable; native retains its serialized
single-runtime key/value transaction and owner check.
The persistence transaction is the enqueue success boundary. Once that commit
returns, cache refresh and local/cross-tab notifications are best-effort and
cannot turn the durable result into a caller-visible failure. Persistence,
owner, idempotency and reservation failures before commit still reject.
Existing `pharmacystock:outbox:v1:operations` localStorage data is imported in a
retry-safe migration before the legacy value is removed. Identical duplicates
may collapse, but malformed or materially conflicting idempotency records keep
the legacy source intact for safe retry/recovery. Pre-existing per-user session
vaults are also imported before their user is restored, and late global legacy
writes are routed to their recorded owner rather than whichever account is
currently active. A current-user legacy vault is deleted only after complete
recovery, with a validated durable historical receipt and unchanged source
checked again at cleanup invocation. Cleanup is an adapter-authorized operation,
not permission carried forward from an earlier successful import: current
active/vaulted/quarantined destinations, live sources, historical receipts and
owner expectation must still agree inside the native mutation queue or short
IndexedDB transaction before synchronous source removal. Authentication proves the named vault owner; it
does not substitute for envelope validation or a successful persistence commit.
The key/value adapter validates every legacy envelope before sorting or merging;
any malformed entry rejects the entire vault without a partial import. Current
recovery supports branch-scoped `SALE` envelopes with nonblank identity/scope,
an object payload, recognized status, valid creation/replay timestamps and a
nonnegative safe-integer attempt count. Payload scope, when duplicated, must
match the envelope. Sale lines, quantities and payments retain their existing
domain validation. No missing identity, scope or timestamp is invented.
Recovery retains the original idempotency key and is idempotent across cleanup
interruptions. Both adapters use the replay eligibility timestamp parser to
reset interrupted `SYNCING` work to `PENDING` only when `lastAttemptAt` is valid.
Persisted v2 active and owner-vault records pass the same envelope validator
before sorting, listing, owner restoration, replay eligibility or interrupted
replay reset. Malformed records (including invalid `SYNCING` timing) remain
unchanged in owner-bound durable quarantine and never enter normal outbox lists
or replay. Key/value reads fail closed while retaining the original v2 source;
the next serialized write atomically stores quarantine with the active/vault
state. IndexedDB copies rejected rows into its existing metadata store and
removes their source rows in the same transaction, using original primary-store
keys instead of malformed idempotency-index values. No replacement identity,
scope, owner or timestamp is invented.

A shared group classifier separates unique intents, identical immutable retries
and immutable conflicts from envelope validity. Existing destination lifecycle
state takes precedence over incoming identical retries. Malformed siblings or
conflicts block their stored key; independent valid keys remain recoverable.
Disputed destination and incoming records stay quarantined across cleanup,
restart and account switches. Source cleanup requires conflict-free current
validation as well as complete durable recovery and unchanged source/owner;
cached cleanup markers cannot skip these checks. Parsed source members remain
available through joint source/destination classification, including rejected
same-key siblings. A source dispute therefore quarantines existing active and
vaulted destination members for that key under the original owner, while
unrelated keys remain available. Receipt intents are also grouped with current
destination state before cleanup; a conflicting destination blocks cleanup and
is quarantined even when the receipt was previously valid. Valid receipts and
fingerprints can still clean up after successful sync/removal without requiring
an active destination record. Malformed
key/value legacy vaults retain their exact source instead of becoming active.
Ownerless records and records that reuse an idempotency key for different
immutable content remain quarantined; the client never guesses an owner or
silently merges the conflict.
Another authenticated user cannot inspect or recover that vault. Native and test
environments retain the shared key/value-compatible adapter. That fallback
stores the active owner, active operations, and per-owner vaults in one
versioned record. All reads and mutations share one serialized queue, so an
owner expectation is checked in the same commit boundary as an enqueue or
update, and an account change replaces owner plus active/vaulted operations
together. A stale operation either commits before the switch and is vaulted for
its original owner, or runs after the switch and is rejected; it cannot be
written into the new owner's active outbox.

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
Outbox enqueue may collapse a repeated key only when the operation kind,
organization/branch scope, and canonical payload match the stored immutable
intent. Reusing a key for different immutable content is an explicit conflict;
the new operation must not be reported as queued and the original record must
remain unchanged.

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

The authenticated app shell owns one replay scheduler per active user. It
subscribes to durable outbox changes and wakes at the earliest eligibility
boundary: `PENDING` immediately, `FAILED` at `nextAttemptAt`, and `SYNCING`
after the interrupted-replay stale threshold. A timer always refreshes and
recomputes durable state before replay, including after application resume.
All scheduled attempts still pass through `SyncCoordinator` and its replay
lock. Lock contention uses a bounded recheck rather than a zero-delay loop.
Same-user token refresh does not replace the scheduler; sign-out or a real
user change stops the old owner's scheduler. A `SYNCING` record with missing
or invalid `lastAttemptAt`, or a `FAILED` record with an invalid
`nextAttemptAt`, remains unscheduled rather than being destructively reset.
For compatibility, a `FAILED` record with no `nextAttemptAt` remains
immediately retryable because it no longer represents an active submission.
Only an absent/undefined retry timestamp counts as missing; empty strings and
non-string values fail closed. Future deadlines retain their exact timing; the
five-second contention recheck applies only to work already due after replay.
When due and future work coexist, the next wake is the earlier of the bounded
due-work recheck and every valid future FAILED/SYNCING eligibility boundary.
All coordinator instances share a non-blocking runtime replay lock. It spans
preparation, submission and durable result handling, and is released in `finally`
only after replay settles, including errors. Replacing a scheduler or switching
A → B → A cannot release an already-dispatched RPC's serialization boundary.
Browser Web Locks additionally serialize across tabs; without Web Locks the
runtime lock still prevents overlapping coordinators in the same JS runtime.
Contention returns without enqueueing a stale callback; the scheduler refreshes
durable owner/state on its next bounded attempt. Once the active invocation
settles, restored eligible work retries with its unchanged idempotency key.
An unresolved RPC deliberately retains the lock: a timer must not assume the
server stopped processing it. Separate runtimes without Web Locks still rely
on server idempotency, and real device/browser QA remains required.
Each invocation captures its initiating owner/generation before asynchronous
preparation, and scheduler stop invalidates its cancellation token. Preparation
and submission check both fences without invalidating same-user token refresh.
An auth-owner mismatch also aborts unchanged if it precedes the lifecycle event.
POS observes newly durable `SYNCED` sales in its organization/branch and
refreshes history through its existing cancellable read effect; it owns no
replay coordinator.

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
- After asynchronous preparation, replay rechecks durable owner, envelope, identity, content and eligibility before claiming an attempt. Adapter updates compare the expected record within the existing serialized commit. A durable read confirms that exact SYNCING attempt before entering the handler; the SALE transport then validates again inside storage coordination at the actual fetch boundary after SDK token acquisition. Quarantine, removal, replacement or a lifecycle change skips the captured intent. Null/no-op updates never authorize submission or increment completion counters. Unrelated valid work continues, and storage read failures remain fail-closed with the existing scheduler delay.

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

## Legacy outbox recovery

- Key/value per-user vaults, key/value global v1 snapshots, and IndexedDB global/per-user legacy imports share the envelope validator in `outboxRecovery.ts`. It validates identity, branch-bound SALE scope, duplicated payload scope, status/attempt metadata and timestamps; it does not impose a sale-line/payment schema. Historical object payloads, including `{}`, remain supported.
- Key/value global v1 recovery is whole-snapshot atomic: one malformed envelope prevents any activation. Exact raw data and its original owner metadata remain retained for explicit recovery; ownerless data is never assigned to the current account.
- Key/value global cleanup requires a durable recovery receipt, unchanged source bytes and unchanged original owner after the v2 commit. The receipt supports cleanup retries after restart without reactivating synced/removed work. A replaced or unconsumed source is retained, and its owner metadata is not overwritten by account switches while it remains present.
- IndexedDB retains partial recovery of independent valid groups, its owner routing, fingerprints, immutable conflict checks and transaction boundaries. A malformed member blocks its own stored idempotency-key group, so filtering cannot erase a conflicting sibling. Invalid entries never count toward complete recovery or cleanup eligibility.
- Cached IndexedDB safe-to-delete markers are revalidated against the canonical envelope contract before authorizing cleanup. Malformed global raw data stays at its original source/owner; per-user raw data stays in that user's retained vault/quarantine.
- Previously imported v2 records now pass the same canonical envelope and immutable-group checks. Rejected records remain unchanged in durable owner-bound quarantine. Scheduler, replay-lock and token-refresh behavior remain unchanged; valid interrupted v2 replay still recovers with its original identity.


### Offline SALE replay dispatch boundary

Offline SALE replay uses a request-scoped Supabase client with a memoized token
provider delegated to the existing authenticated client. It creates no persisted
auth session. After the SDK has prepared Authorization, the configured fetch
checks the captured owner, replay generation, cancellation predicate, session
owner and token subject, and the exact durable SYNCING claim (including stable
identity, immutable content and attempt state). The final classification also
reads currently visible global v1 and owner-scoped per-user legacy sources,
including raw owner-scoped legacy vaults retained in IndexedDB metadata, alongside
v2 archive, destination, quarantine and receipt evidence. A recovery or
import pass is not a prerequisite for blocking a disputed key: late conflicting
or malformed-keyed source evidence prevents dispatch after token acquisition.
Refresh applies the same evidence view before exposing replayable work.

IndexedDB validates inside a short readonly transaction over operations, owner /
quarantine metadata and vaulted operations. Recovery mutations use overlapping
readwrite transactions. The underlying fetch is invoked before the guard
transaction releases, but its response is awaited outside storage coordination.
The native key/value adapter performs the same check and fetch invocation in its
existing synchronous mutation queue. This guarantee is within that runtime;
key/value browser fallback has no shared cross-tab recovery mutation primitive
and therefore skips offline SALE dispatch. Its claim keeps the existing bounded
interrupted-SYNCING retry delay; it does not immediately retry.

Pre-dispatch invalidation returns a typed skipped replay outcome: no mutation
fetch, no synced/failed/conflict increment, and no rewrite of quarantined,
replaced or owner-invalidated state. Unrelated valid operations can continue.
Already-invoked fetches are dispatched requests and are not locally cancellable.
A later lost durable claim cannot be counted as locally synchronized, but the
server may have accepted the request. Server idempotency, authorization, pricing
and FEFO remain authoritative. No guarantee is made against writers bypassing
the adapter transaction/queue or across separate native runtimes.


### Browser key/value v2 handoff into IndexedDB

When a new outbox selects IndexedDB, startup, owner-scoped refresh and explicit
owner restoration discover `pharmacystock:outbox:v2:key-value-state`. Handoff
reads only the selected owner's active/vault scope and quarantine. It never
assigns ownerless work to an authenticated owner or activates A's work under B.
Owner switches import the target scope into its vault in the existing transition
transaction before restoration. Other owners' source scopes remain untouched.

Container validation remains separate from canonical operation-envelope and
immutable-idempotency-group classification. Source records, current active /
vaulted destination records and receipt witnesses are classified together.
Malformed/conflicting keys enter the existing owner-bound metadata quarantine;
valid unrelated keys can proceed. Existing source quarantine transfers unchanged
and remains blocked. An ambiguous container cannot activate work; discoverable
scoped keys still participate in destination dispute detection. Unique records
keep their original id, key, immutable content and timestamps. Identical retries
use existing destination/lifecycle precedence. Id collisions never cause renaming.

New valid interrupted SYNCING source records use resetInterruptedReplay, becoming
PENDING with the original attempt count/last-attempt timestamp; stale scheduling
is not treated as proof of validity. PENDING and FAILED retain their retry fields.
An already-active destination keeps its lifecycle, including an existing claim.

Destination rows and owner/key-scoped import receipts commit together. Receipts
retain the canonical source intent and are reclassified against current source /
destination state on every recovery retry. They prevent resurrection after a
successfully synchronized destination is removed, without requiring that row to
still exist. A conflicting replacement or destination cannot use a cached receipt
to bypass quarantine. Transaction abort leaves neither new rows nor receipts.

Cleanup is deliberately logical: the raw key/value snapshot remains as a recovery
archive. localStorage writers do not share the IndexedDB transaction, so this
handoff does not physically delete/prune that snapshot or risk erasing a late
writer, another owner's records or malformed evidence. There is no import/cleanup
crash window requiring a destructive cross-store repair. The archive is conflict
evidence at the dispatch guard as well; the guard rejects already-visible late
archive disputes. IndexedDB transaction ordering fences committed handoff /
quarantine changes; no atomicity is claimed against uncoordinated raw key/value
writes across tabs.

Browser fallback still skips dispatch. Its exact current claim records the
existing OUTBOX_ATOMIC_COORDINATION_UNAVAILABLE error code, retains bounded
interrupted-SYNCING eligibility, and publishes the change through existing
subscriptions. The status banner maps that structural block to the existing
localized Pending sync state rather than claiming an active server sync. No new
UI/status subsystem is introduced. Supported IndexedDB handoff clears that error
when restoring valid interrupted work, which then follows normal guarded replay.
An existing outbox does not hot-swap adapters; discovery begins when a supported
IndexedDB outbox is selected/constructed, including restart.


### Historical receipt evidence integrity

Recovery receipts/import markers are immutable historical intent evidence, not
just cleanup optimizations. Every successful import path establishes durable
historical intent evidence before its source can be forgotten. Native per-user
imports commit owner/key-scoped receipts with destination rows in the same v2
write; IndexedDB commits rows and receipts in one transaction. Exact already-known
work whose destination was completed/removed is not recreated as fresh PENDING
work, including across restart, account restoration and adapter handoff. Live
source discovery alone never counts as proof of a successful historical import.
Their original raw values/fingerprints remain durable
after successful sync and destination removal. Current sources, active/vaulted
records, quarantine and all relevant historical receipt witnesses participate in
the same immutable-idempotency classification at recovery, replay exposure and
the guarded dispatch boundary.

The shared receipt-evidence view validates the wrapper/marker, nonblank imported
id, scope/key association and canonical envelope fingerprint separately from
immutable-content grouping. Valid historical A disputes later same-key B even
when A's destination is absent. Malformed-but-keyed evidence blocks that key;
matching active/vaulted destination records enter the existing owner-bound
quarantine. Unidentifiable garbage is retained without inventing identity or
blocking unrelated work. Key/value writes preserve the original receipt value,
including valid members and malformed siblings, rather than dropping the receipt
when validation fails. Browser v2 handoff uses the same evidence view and retains
its raw archive.

Older global IndexedDB receipts did not store an owner. Their known-key evidence
is considered conservatively across owners; no historical owner is invented.
New global receipts record the proven recovery scope. Per-user and handoff markers
use their stored owner/key scope. Broken scope markers retain any discoverable
keyed fingerprint evidence and cannot authorize cleanup.

Cleanup never relies on an unvalidated marker. It requires structurally valid
receipt evidence, matching source identity/fingerprint, immutable agreement with
current sources/destinations and no malformed keyed sibling or quarantine block.
An identical destination legitimately absent after sync/removal remains compatible.
Legacy IndexedDB cleanup revalidates inside a short transaction and invokes
synchronous source removal before releasing that ordering boundary; source/owner
replacement checks remain in place. Raw key/value writers across tabs still cannot
join that IndexedDB transaction, so no broader cross-store atomicity is claimed.
Uncertain sources and receipts stay retained. Browser v2 archive cleanup remains
logical and restart-safe.

The final dispatch guard reads historical receipts after token acquisition within
the existing adapter dispatch critical section. A disputed/malformed keyed receipt
makes the exact claim ineligible: typed SKIPPED, zero mutation fetches and no false
synced/failed/conflict increment. Owner/JWT/session-generation checks, exact retry
identity and the already-dispatched request boundary remain unchanged.


### Malformed containers and discoverable evidence

Container admission and evidence extraction are separate concerns. An invalid v2
version/owner header does not erase safely attributable children: a valid explicit
owner on the active array or a named owner vault still supplies tainted keyed
evidence. Malformed quarantine wrappers are inspected only at recognizable
record/records/receipt locations, never by searching arbitrary sale payload fields.
Discoverable keyed children of rejected wrappers fail closed for that key at
refresh, import, cleanup and final guarded dispatch; recovery need not run first.
They are not normalized into valid operations or admitted as import/cleanup proof.

Completely unidentifiable garbage remains raw and never authorizes cleanup or
blocks unrelated keys. Damage confined to such garbage does not taint otherwise
valid owner-scoped records. Browser v2 archives remain physically unchanged.
Native per-user import preserves an unsupported receipt root in
legacyVaultReceiptArchives while committing a supported receipt map and valid
unrelated destination rows in the same serialized v2 replacement. Retained roots
remain classification evidence across writes, owner restoration and IndexedDB
handoff. An unsupported root alone never authorizes cleanup/consumption; each
identifiable receipt child is validated independently before supplying history.
No missing owner, key, id or
timestamp is generated. Existing cross-runtime dispatch limitations still apply.


### Persisted quarantine evidence

Native persisted quarantine, IndexedDB quarantine metadata and browser v2 archive
quarantine use the same explicit evidence extractor. It follows record, records,
raw, operations, sourceFingerprint and quarantine fields, plus the selected owner's
explicit vault slot, including recognizable nested wrappers and JSON-encoded
evidence. An explicit quarantine-entry owner remains discoverable independently
of a rejected enclosing v2 wrapper's active owner; unowned entries do not inherit
that active owner. Direct record/raw children on an
explicit owner-scoped entry participate just like children under records. The
extractor checks stored owner/receipt namespaces; it does not search arbitrary
payload fields, invent identities, or adopt another owner's children.

Deep inspection is bounded to 64 wrapper levels and 4096 nodes. A shallow
collection-header pass routes explicit owners/keys before spending that budget;
foreign-owner children do not consume the selected owner's deep-inspection
budget. Hitting a limit records the stored owner, stored key when known, and
exhaustion reason. A stored receipt namespace can bind fingerprint uncertainty to its key; a
malformed parent key alone cannot bind its unknown descendants. Safely known-key
uncertainty blocks that key, owner-only uncertainty
holds that owner's current work, and genuinely unscoped uncertainty fails closed
conservatively. Explicitly foreign exhaustion does not block another owner.
Current work in the affected scope stays held at import/refresh/cleanup/dispatch
until the retained evidence can be diagnosed. Ordinary fully inspected unidentifiable string/number/object
garbage supplies no blocked key and does not make unrelated valid work unusable.

Malformed quarantine parents cannot hide recognizable keyed children. All
quarantine keys, including nested receipt namespace evidence, participate at
visibility, recovery, cleanup and the post-token-acquisition fetch guard without
requiring an earlier recovery pass. Pre-dispatch invalidation retains typed SKIPPED
and zero mutation fetches/counters. Previously dispatched requests retain their
existing response/idempotency semantics.

Raw quarantine values remain durable. Native writes preserve original malformed
entries and add owner-associated destination quarantine only when needed.
IndexedDB writes preserve original metadata record/raw/extension fields and
malformed records values while adding rejected destination rows. String/number/
object garbage never enters an unchecked array helper and never authorizes
cleanup; successful unrelated imports still establish historical receipts.


### Scoped evidence inspection consistency

Malformed receipt-map parents are inspected entry by entry: a valid identifiable
receipt child remains historical immutable-intent evidence even beside an
unidentifiable malformed sibling. The root and sibling remain retained; neither
can authorize cleanup on its own. Encoded/malformed wrappers retain their existing
fail-closed interpretation. Envelope validation and immutable grouping remain
separate from container admission and evidence discovery.

Bounded extraction returns raw evidence, identifiable fragments, blocked keys and
scoped uncertainties (owner/key when stored, depth/node exhaustion reason). The
compatibility incomplete flag means broad uncertainty relevant to the selected
scope; key-only uncertainty contributes a blocked key without poisoning unrelated
keys. Archive operations/vault extraction, current legacy-source reconciliation,
receipt/quarantine collectors and both adapters preserve inspection metadata
through visibility, recovery, cleanup, replay exposure and final guarded dispatch.
No authoritative consumer may reinterpret incomplete inspection as empty evidence.
Live source evidence cannot prove import/completion. Historical malformed raw
fingerprints remain at their original receipt/archive source instead of being
copied into quarantine without their namespace scope. Canonical conflict witnesses
and actual rejected destination/source records still retain quarantine semantics.


### Binding preservation at replay authority boundaries

A keyed malformed wrapper does not suppress recognized record/records/raw or
fingerprint descendants. Its immediate fragment and descendant fragments remain
separate even when their keys differ. Valid v2 archive members use the shared
operation-evidence view; nested witnesses never become additional import or replay
candidates. Existing keyless rejected-container taint rules remain in place.

Traversal context carries the owner, current wrapper key, inherited receipt key
binding, evidence source type and disposition. Arrays inherit a known binding;
a safely identified canonical child or receipt namespace can supply a more
specific binding. Exhaustion keeps the narrowest safely known owner/key. A
malformed wrapper's immediate key still does not invent a binding for unknown
children when no inherited binding exists. Foreign-owner routing, inspection
limits and raw retention remain unchanged.

Native and IndexedDB normalization, plus IndexedDB's actual post-token dispatch
transaction, inspect active/vaulted row descendants with the same bounded helper.
This includes rows inserted after the replay snapshot was captured. Classification
combines current destination, nested witnesses and existing source/receipt/archive/
quarantine evidence before fetch invocation. A prior refresh/restart is not required.

When a malformed keyed destination row X is retained with MALFORMED_ENVELOPE,
its own key remains rejected. Valid descendants are independent immutable
witnesses, not automatically rejected merely for being inside X; malformed child
keys and conflicting child intents still fail closed. Explicitly disputed
quarantine retains its existing blocked-key semantics. This interpretation
preserves both the original raw row and unrelated work, without adding durable
identities, timestamps or a parallel quarantine store.

Per-user cleanup uses the canonical source/destination classifier for the actual
source keys, so unrelated rejected wrapper X does not authorize or prevent source
A cleanup. A conflicting or malformed child with A's key still blocks cleanup,
and the original source/receipt/owner checks remain required. Typed pre-dispatch
SKIPPED, counter accounting, JWT/generation fencing and already-dispatched response
semantics remain unchanged.


### Explicit ownership routing and receipt proof integrity

A foreign-owner parent does not hide recognized record/records/raw/operations or
sourceFingerprint descendants with their own explicit safe owner. Routing walks
only those recognized fields, including arrays and encoded JSON. The parent's
owner applies to unowned descendants; an explicit child owner overrides it for
that subtree only. Unowned foreign children are never adopted into the current
owner, and changing owner clears any incompatible inherited key binding.

Receipt namespace/proof ownership is tracked separately from routing ownership.
A contradictory namespace does not replace an explicit marker owner when routing
unowned fingerprint children. Foreign receipt/source collector shortcuts still
inspect independently owned descendants; foreign completion/import IDs are never
borrowed for the current owner. Ordinary valid foreign source fragments can act
as immutable witnesses without becoming current-owner activation candidates;
malformed and quarantine evidence retains its fail-closed interpretation.

A receipt/marker and every explicit owner within its recognized fingerprint proof
must agree before importedId/completion history is trusted. Matching fingerprints
and fingerprints with no explicit owner keep their intended inherited-owner
behavior. Contradictory or malformed explicit ownership invalidates the proof,
returns no trusted imported IDs, retains raw evidence, and blocks the known receipt
key. An independently valid current-owner fragment at another key remains an
immutable witness, not additional completion proof. Cleanup revalidates this same
proof/evidence view and cannot delete or logically suppress a contradicted source.

Foreign descendant routing has the existing depth limit and a separate bounded
routing budget so inspecting foreign containers does not spend the selected
owner's deep-inspection budget. Fully inspected foreign garbage and leaf evidence
do not block unrelated owners. Exhaustion retains its safely known inherited owner
until an explicit override is observed; a known contradicted receipt key keeps its
key-scoped uncertainty. No unknown owner change or key is invented.

Admission into an owned operation slot/source cannot accept a row with a
contradictory explicit owner. Its original owned-slot quarantine association and
rejected key remain durable across restart; independently owned valid descendants
are kept as witnesses instead of being implicitly quarantined with that row.
Archive/handoff views carry this distinction and preserve the quarantine owner in
all intermediate evidence views.

These rules apply at refresh, import, owner restoration, cleanup and the final
post-token fetch guard without requiring an earlier recovery pass. Pre-dispatch
invalidated A yields zero A mutation fetches and no false success/failure/conflict
accounting, while unrelated valid C can submit once. Existing JWT, authorization,
owner-generation and already-dispatched response guarantees are unchanged.

### Physical namespaces and malformed receipt children

Storage namespace ownership is inherited routing context, distinct from explicit
wrapper/node ownership and the selected owner. IndexedDB enumerates the persisted
quarantine metadata family by its string-key prefix at every authoritative boundary,
including the actual post-token dispatch check. Foreign namespaces can therefore
supply recognized descendants with their own safely explicit current-owner identity;
they cannot adopt unowned or ambiguously owned foreign descendants into that owner.
Malformed physical namespaces require explicit evidence ownership. The shared bounded
extractor retains its depth/node budgets and scoped uncertainty behavior.

Metadata family cursors use a native prefix key range, or a seek-and-stop fallback
for injected factories without a global range constructor. Receipt metadata is also
read only from its recognized families. Unrelated metadata values are not inspected.
No database version, index or schema change is needed.

Malformed receipt-map children, including arbitrary map keys and unsupported marker
keys, still pass through recognized-descendant extraction. A foreign malformed parent
remains foreign; an independently explicit current-owner child remains evidence for
its own key. Such parents supply no importedId/completion proof and never authorize
cleanup. Their raw values remain retained, and cleanup and guarded dispatch consume
the same current evidence view without requiring an earlier recovery pass.

The retained legacy-vault quarantine family uses the same foreign-namespace routing.
A safely parsed foreign receipt-map namespace also remains inherited context for
malformed children, so exhaustion of unowned foreign evidence stays foreign instead
of becoming unscoped uncertainty against the selected owner.

### Foreign vault evidence

Physical vault ownership is inherited scope, separate from an evidence node's
explicit owner. IndexedDB authority checks enumerate foreign rows through the
existing vault owner index (ranges excluding the selected owner, or an index
cursor fallback). Only the vault store is inspected. The shared bounded extractor
routes an explicitly A-owned descendant independently from its B-owned physical
row; unowned B descendants remain B. Foreign rows and descendants are immutable
witnesses, never additional replay/admission candidates or completion receipts.
Normal selected-owner vault restoration remains the only admission path.

Browser v2 archive parsing likewise inspects foreign vault slots, including inside
recognized malformed wrappers. A valid foreign slot supplies witnesses; rejected
container/slot shapes supply tainted keyed evidence. Explicit owner overrides apply
only to their subtree. Raw archives/foreign evidence remain retained, and foreign
uncertainty retains its inherited scope without poisoning unrelated owners.

Refresh, recovery, cleanup and the actual post-token dispatch guard use this same
current vault evidence. No prior refresh/import pass is needed for a late dispute to
block network submission. Existing overlapping transaction ordering is preserved;
fetch is invoked while authority is validated, with no network-response wait inside
storage coordination. Cleanup retains A's source on dispute and valid unrelated C
remains available. Raw foreign rows may be durably quarantined under their own owner
when that owner's normal restoration rejects them; they are never repaired into A.


Native key/value authority uses the same foreign-vault witness extraction. A
valid B-owned envelope in B's native vault remains B's normal work, while a
recognized descendant with its own explicit A owner is independently classified
as evidence for A. An unowned child inherits B and cannot be adopted into A.
Foreign vault descendants never create A replay candidates or completion proof.
This evidence view participates in normalization, visibility, owner restoration,
current cleanup revalidation and the actual post-token dispatch check inside the
existing native serialized queue. Conflicting A evidence retains A's source and
B's stored envelope; unrelated C stays available. No earlier refresh or recovery
pass is necessary, and native coordination remains scoped to one runtime.
