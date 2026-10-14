import type { KeyValueStorage } from './storage';
import {
  classifyOutboxReceiptEvidence, classifyOutboxRecoveryGroups, classifyOutboxRecoverySource, immutableOutboxContentMatches, isRecoverableLegacyOperation, orderOutboxRecoveryRecords,
  KEY_VALUE_OUTBOX_STATE_KEY, parseKeyValueOutboxRecoveryScope, type OutboxEvidence, outboxOperationEvidence,
  parseOutboxRecoverySource, quarantinedOutboxKeys, quarantineOutboxEvidence, outboxEvidenceBlockedKeys, resetInterruptedReplay, retainOutboxQuarantine, stableOutboxSerialize,
  keyValueOutboxHistoricalEvidence, mergeOutboxEvidence, visibleLegacyOutboxEvidence, legacyOutboxVaultKey, outboxWitnessEvidence,
} from './outboxRecovery';
import {
  OutboxIdempotencyConflictError,
  OutboxOwnerMismatchError,
  type OutboxOperation,
  type OutboxEnqueueValidator,
  type LegacyVaultImportOptions,
  type OutboxPersistence,
  type OutboxUpdate,
  type ScopeTransitionPoint,
} from './outbox';

const DATABASE_NAME = 'pharmacystock:outbox:v2';
const DATABASE_VERSION = 2;
const OPERATIONS_STORE = 'operations';
const VAULT_OPERATIONS_STORE = 'vaultOperations';
const METADATA_STORE = 'metadata';
const IDEMPOTENCY_INDEX = 'idempotencyKey';
const STATUS_INDEX = 'status';
const VAULT_OWNER_INDEX = 'ownerId';
const VAULT_OWNER_IDEMPOTENCY_INDEX = 'ownerIdIdempotencyKey';
const LEGACY_KEY = 'pharmacystock:outbox:v1:operations';
const LEGACY_OWNER_KEY = 'pharmacystock:offline-scope:v1:user-id';
const LEGACY_MIGRATION_KEY = 'legacy-local-storage-v1';
const LEGACY_IMPORT_PREFIX = `${LEGACY_MIGRATION_KEY}:import:`;
const LEGACY_VAULT_IMPORT_PREFIX = 'legacy-session-vault-v1:import:';
const LEGACY_VAULT_QUARANTINE_PREFIX = 'legacy-session-vault-v1:quarantine:';
const OWNER_METADATA_KEY = 'active-owner';
const UNOWNED_VAULT = '__unowned__';

type MigrationMarker = { key: string; completedAt: string };
type LegacyImportMarker = { key: string; sourceFingerprint: string; importedId: string; ownerId?: string | null };
const PERSISTED_QUARANTINE_PREFIX = 'persisted-outbox-v2:quarantine:';
type PersistedQuarantine = { key: string; ownerId: string | null; records?: unknown; [field: string]: unknown };
type OwnerMetadata = { key: string; userId: string | null; legacySnapshotOwner?: boolean };
type VaultedOperation = OutboxOperation & { ownerId: string };

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

async function abortTransaction(transaction: IDBTransaction, completion: Promise<void>, error: unknown): Promise<never> {
  try {
    transaction.abort();
  } catch {
    // The transaction may already have aborted because of a failed request.
  }
  await completion.catch(() => undefined);
  throw error;
}

function parseLegacy(raw: string) {
  return parseOutboxRecoverySource(raw, 1);
}

function parseLegacyVault(raw: string) {
  return parseOutboxRecoverySource(raw);
}

function operationFingerprint(operation: OutboxOperation): string {
  return stableOutboxSerialize(operation);
}

function operationsMatch(left: OutboxOperation, right: OutboxOperation): boolean {
  return operationFingerprint(left) === operationFingerprint(right);
}

function sortOperations(operations: OutboxOperation[]) {
  return [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function withoutOwner(record: VaultedOperation): OutboxOperation {
  const { ownerId: _ownerId, ...operation } = record;
  return operation;
}

async function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  const request = factory.open(databaseName, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
      const operations = database.createObjectStore(OPERATIONS_STORE, { keyPath: 'id' });
      operations.createIndex(IDEMPOTENCY_INDEX, IDEMPOTENCY_INDEX, { unique: true });
      operations.createIndex(STATUS_INDEX, STATUS_INDEX);
    }
    if (!database.objectStoreNames.contains(METADATA_STORE)) {
      database.createObjectStore(METADATA_STORE, { keyPath: 'key' });
    }
    if (!database.objectStoreNames.contains(VAULT_OPERATIONS_STORE)) {
      const vault = database.createObjectStore(VAULT_OPERATIONS_STORE, { keyPath: ['ownerId', 'id'] });
      vault.createIndex(VAULT_OWNER_INDEX, VAULT_OWNER_INDEX);
      vault.createIndex(VAULT_OWNER_IDEMPOTENCY_INDEX, ['ownerId', IDEMPOTENCY_INDEX], { unique: true });
    }
  };
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => {
      // Keep the upgrade request pending. Once every older tab closes its v1
      // connection, this same request resumes instead of poisoning the store
      // instance with a permanently rejected initialization promise.
    };
  });
  database.onversionchange = () => database.close();
  return database;
}

async function allocateLegacyId(store: IDBObjectStore, requestedId: string): Promise<string> {
  if (!await requestResult(store.getKey(requestedId))) return requestedId;
  let suffix = 1;
  while (await requestResult(store.getKey(`${requestedId}:legacy:${suffix}`))) suffix += 1;
  return `${requestedId}:legacy:${suffix}`;
}

async function allocateVaultId(store: IDBObjectStore, ownerId: string, requestedId: string): Promise<string> {
  if (!await requestResult(store.getKey([ownerId, requestedId]))) return requestedId;
  let suffix = 1;
  while (await requestResult(store.getKey([ownerId, `${requestedId}:legacy:${suffix}`]))) suffix += 1;
  return `${requestedId}:legacy:${suffix}`;
}

// The existing metadata store is the quarantine boundary. Invalid records are
// copied unchanged before their source row is removed in this same transaction.
// No schema upgrade, replacement operation identity or indexed-key repair.
async function recoverPersistedOwner(
  transaction: IDBTransaction,
  ownerId: string | null,
  includeActive: boolean,
  storage: KeyValueStorage,
): Promise<{ active: OutboxOperation[]; vaulted: OutboxOperation[]; records: OutboxOperation[]; blockedKeys: Set<string> }> {
  const operations = transaction.objectStore(OPERATIONS_STORE);
  const vault = transaction.objectStore(VAULT_OPERATIONS_STORE);
  const metadata = transaction.objectStore(METADATA_STORE);
  const quarantineKey = `${PERSISTED_QUARANTINE_PREFIX}${JSON.stringify(ownerId)}`;
  const retained = await requestResult(metadata.get(quarantineKey)) as PersistedQuarantine | undefined;
  const activeRows = includeActive ? await requestResult(operations.getAll()) as unknown[] : [];
  const activeKeys = includeActive ? await requestResult(operations.getAllKeys()) : [];
  const vaultOwnerId = ownerId ?? UNOWNED_VAULT;
  const vaultRows = await requestResult(vault.index(VAULT_OWNER_INDEX).getAll(vaultOwnerId)) as unknown[];
  const vaultKeys = await requestResult(vault.index(VAULT_OWNER_INDEX).getAllKeys(vaultOwnerId));
  const evidence = mergeOutboxEvidence(await authoritativeEvidenceForOwner(metadata, storage, ownerId),
    outboxOperationEvidence([...activeRows, ...vaultRows], ownerId));
  const blockedKeys = quarantinedOutboxKeys(retained, ownerId);
  for (const key of outboxEvidenceBlockedKeys(evidence, [...activeRows, ...vaultRows])) blockedKeys.add(key);
  const recovery = classifyOutboxRecoveryGroups([
    ...orderOutboxRecoveryRecords(activeRows), ...orderOutboxRecoveryRecords(vaultRows),
    ...orderOutboxRecoveryRecords(evidence.records),
  ], blockedKeys);
  // Raw receipt evidence remains in metadata; quarantine only actual destination
  // rows here, preserving existing exact malformed-v2 retention semantics.
  const rejected = recovery.rejected.filter(({ record }) => activeRows.includes(record) || vaultRows.includes(record));
  const quarantined = retainOutboxQuarantine(retained?.records ?? [], rejected);
  if (rejected.length) {
    metadata.put({ ...retained, key: quarantineKey, ownerId, records: quarantined } satisfies PersistedQuarantine);
  }
  const accepted = new Set<unknown>(recovery.operations);
  // Keys come from the primary stores, never from malformed envelope fields.
  // This also removes only proven identical retry copies, with destination first.
  for (let index = 0; index < activeRows.length; index += 1) {
    if (!accepted.has(activeRows[index])) operations.delete(activeKeys[index]!);
  }
  for (let index = 0; index < vaultRows.length; index += 1) {
    if (!accepted.has(vaultRows[index])) vault.delete(vaultKeys[index]!);
  }
  return {
    records: recovery.operations.filter((item) => activeRows.includes(item) || vaultRows.includes(item)),
    active: recovery.operations.filter((item) => activeRows.includes(item)),
    vaulted: recovery.operations.filter((item) => vaultRows.includes(item)).map((item) => withoutOwner(item as VaultedOperation)),
    blockedKeys: new Set([...quarantinedOutboxKeys(quarantined, ownerId), ...blockedKeys]),
  };
}

async function reconcileRecoverySource(
  transaction: IDBTransaction,
  ownerId: string | null,
  includeActive: boolean,
  source: { records: unknown[]; validContainer: boolean },
  storage: KeyValueStorage,
) {
  const destination = await recoverPersistedOwner(transaction, ownerId, includeActive, storage);
  const evidence = mergeOutboxEvidence(await authoritativeEvidenceForOwner(transaction.objectStore(METADATA_STORE), storage, ownerId),
    outboxOperationEvidence(source.records, ownerId, 'ARCHIVE'));
  const recovery = classifyOutboxRecoverySource(
    source.records, [...destination.records, ...evidence.records],
    new Set([...destination.blockedKeys, ...outboxEvidenceBlockedKeys(evidence, source.records)]),
  );
  if (recovery.disputed.length) {
    const metadata = transaction.objectStore(METADATA_STORE);
    const key = `${PERSISTED_QUARANTINE_PREFIX}${JSON.stringify(ownerId)}`;
    const prior = await requestResult(metadata.get(key)) as PersistedQuarantine | undefined;
    metadata.put({
      ...prior, key, ownerId, records: retainOutboxQuarantine(prior?.records, recovery.disputed),
    } satisfies PersistedQuarantine);
    await recoverPersistedOwner(transaction, ownerId, includeActive, storage);
  }
  const consumed = new Map([...evidence.importedIds ?? []].filter(([key]) => !destination.records.some((item) => item.idempotencyKey === key)));
  return { operations: recovery.operations, consumed, complete: !evidence.incomplete && source.validContainer && recovery.complete };
}

const KEY_VALUE_IMPORT_PREFIX = 'key-value-outbox-v2:import:';

// Global v1 markers predate owner fields. Keep their evidence conservatively
// key-scoped across owners; never assign a historical owner that was not stored.
// Enumerate only one string-key metadata family. Native browsers use a range;
// injected factories without a global IDBKeyRange use a cursor seek and stop at
// the first nonmatching key. Neither path walks unrelated metadata values.
function metadataFamily(metadata: IDBObjectStore, prefix: string): Promise<Record<string, unknown>[]> {
  const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
  const range = typeof IDBKeyRange === 'undefined' ? undefined : IDBKeyRange.bound(prefix, end, false, true);
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = [];
    const request = metadata.openCursor(range);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB metadata cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(rows); return; }
      // IndexedDB numbers/dates precede strings; binary/array keys follow them.
      if (typeof cursor.key !== 'string') {
        if (typeof cursor.key === 'number' || cursor.key instanceof Date) cursor.continue(prefix);
        else resolve(rows);
        return;
      }
      if (cursor.key < prefix) { cursor.continue(prefix); return; }
      if (!cursor.key.startsWith(prefix)) { resolve(rows); return; }
      rows.push(cursor.value as Record<string, unknown>);
      cursor.continue();
    };
  });
}

// The owner index is the vault-specific enumeration boundary. Exclude the
// selected owner's normal admission rows; foreign descendants are witnesses,
// never candidates, and their physical rows are not mutated by this collector.
async function foreignVaultEvidenceForOwner(vault: IDBObjectStore, ownerId: string | null): Promise<OutboxEvidence> {
  const selected = ownerId ?? UNOWNED_VAULT;
  const index = vault.index(VAULT_OWNER_INDEX);
  const sources: OutboxEvidence[] = [];
  const collect = (range?: IDBKeyRange) => new Promise<void>((resolve, reject) => {
    const request = index.openCursor(range);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB vault cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      if (cursor.key !== selected) {
        const inheritedOwner = typeof cursor.key === 'string' && cursor.key.trim() ? cursor.key : undefined;
        sources.push(outboxWitnessEvidence(cursor.value, ownerId, inheritedOwner === undefined, inheritedOwner));
      }
      cursor.continue();
    };
  });
  if (typeof IDBKeyRange === 'undefined') await collect();
  else await Promise.all([collect(IDBKeyRange.upperBound(selected, true)), collect(IDBKeyRange.lowerBound(selected, true))]);
  return mergeOutboxEvidence(...sources);
}

async function persistedQuarantineEvidenceForOwner(metadata: IDBObjectStore, ownerId: string | null) {
  const rows = await metadataFamily(metadata, PERSISTED_QUARANTINE_PREFIX);
  return mergeOutboxEvidence(...rows.map(row => {
    let namespaceOwnerId: string | null | undefined;
    try {
      const scoped: unknown = JSON.parse((row.key as string).slice(PERSISTED_QUARANTINE_PREFIX.length));
      if (scoped === null || (typeof scoped === 'string' && scoped.trim())) namespaceOwnerId = scoped;
    } catch { /* Invalid physical namespaces provide no inherited identity. */ }
    // Physical namespace is inherited context, never an override of a safely
    // explicit node/descendant owner. Unknown namespaces require explicit scope.
    return quarantineOutboxEvidence(row, ownerId, namespaceOwnerId === undefined, namespaceOwnerId);
  }));
}

async function receiptEvidenceForOwner(metadata: IDBObjectStore, ownerId: string | null) {
  const records: unknown[] = [];
  const blockedKeys = new Set<string>();
  const importedIds = new Map<string, string>();
  const inspections: OutboxEvidence[] = [];
  let incomplete = false;
  const markers = (await Promise.all([LEGACY_VAULT_QUARANTINE_PREFIX, LEGACY_IMPORT_PREFIX, LEGACY_VAULT_IMPORT_PREFIX, KEY_VALUE_IMPORT_PREFIX]
    .map(prefix => metadataFamily(metadata, prefix)))).flat().sort((left, right) => {
    const a = left.key as string; const b = right.key as string;
    return a < b ? -1 : a > b ? 1 : 0; // Preserve the former primary-key receipt iteration order.
  });
  for (const marker of markers) {
    if (typeof marker.key !== 'string') continue;
    const markerKey = marker.key;
    if (markerKey.startsWith(LEGACY_VAULT_QUARANTINE_PREFIX)) {
      if (markerKey.slice(LEGACY_VAULT_QUARANTINE_PREFIX.length) === ownerId) {
        // A retained raw vault is live source evidence, not proof of import.
        // Its stored owner namespace supplies scope, without activating work.
        const source = classifyOutboxReceiptEvidence({ raw: marker.raw, ownerId }, undefined, {});
        incomplete ||= source.incomplete === true;
        inspections.push(source);
        records.push(...source.records);
        for (const disputed of source.blockedKeys) blockedKeys.add(disputed);
      } else {
        const namespaceOwner = markerKey.slice(LEGACY_VAULT_QUARANTINE_PREFIX.length);
        inspections.push(quarantineOutboxEvidence(marker, ownerId, !namespaceOwner.trim(), namespaceOwner.trim() ? namespaceOwner : undefined));
      }
      continue;
    }
    let key: string | undefined;
    if (marker.key.startsWith(LEGACY_IMPORT_PREFIX)) {
      if ((marker.ownerId === null || (typeof marker.ownerId === 'string' && marker.ownerId.trim()))
        && marker.ownerId !== ownerId) { inspections.push(quarantineOutboxEvidence(marker, ownerId, true)); continue; }
      key = marker.key.slice(LEGACY_IMPORT_PREFIX.length);
    } else {
      const prefix = [LEGACY_VAULT_IMPORT_PREFIX, KEY_VALUE_IMPORT_PREFIX].find((item) => markerKey.startsWith(item));
      if (!prefix) continue;
      try {
        const scope: unknown = JSON.parse(marker.key.slice(prefix.length));
        if (Array.isArray(scope) && scope.length === 2
          && (scope[0] === null || (typeof scope[0] === 'string' && scope[0].trim()))
          && typeof scope[1] === 'string') {
          if (scope[0] !== ownerId) { inspections.push(quarantineOutboxEvidence(marker, ownerId, true)); continue; }
          key = scope[1];
        }
      } catch { /* A broken scope can still contain discoverable intent evidence. */ }
    }
    const evidence = classifyOutboxReceiptEvidence(marker, { key: marker.key, idempotencyKey: key, ownerId });
    incomplete ||= evidence.incomplete === true;
    inspections.push(evidence);
    records.push(...evidence.records);
    for (const disputed of evidence.blockedKeys) blockedKeys.add(disputed);
    for (const [key, id] of evidence.importedIds) importedIds.set(key, id);
  }
  const collected = mergeOutboxEvidence(...inspections);
  return { ...collected, records: [...new Set([...records, ...collected.records])],
    blockedKeys: new Set([...blockedKeys, ...collected.blockedKeys]), importedIds, ...(incomplete ? { incomplete: true } : {}) };
}

// One current-evidence collector is used at mutation/visibility, dispatch and
// cleanup boundaries. Reading a live legacy source never activates its members.
async function authoritativeEvidenceForOwner(metadata: IDBObjectStore, storage: KeyValueStorage, ownerId: string | null) {
  const historical = await receiptEvidenceForOwner(metadata, ownerId);
  const persisted = await persistedQuarantineEvidenceForOwner(metadata, ownerId);
  const foreignVault = await foreignVaultEvidenceForOwner(metadata.transaction.objectStore(VAULT_OPERATIONS_STORE), ownerId);
  const raw = storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY);
  const archive = raw !== null && ownerId !== null ? parseKeyValueOutboxRecoveryScope(raw, ownerId) : null;
  const archived = { records: archive ? [...archive.records, ...archive.witnesses] : [],
    blockedKeys: quarantinedOutboxKeys(archive?.quarantine ?? [], ownerId), ...(archive?.incomplete ? { incomplete: true } : {}), ...(archive?.uncertainties ? { uncertainties: archive.uncertainties } : {}) };
  for (const key of archive?.blockedKeys ?? []) archived.blockedKeys.add(key);
  const native = raw !== null && ownerId !== null ? keyValueOutboxHistoricalEvidence(raw, ownerId) : { records: [], blockedKeys: new Set<string>() };
  return mergeOutboxEvidence(historical, visibleLegacyOutboxEvidence(storage, ownerId), archived, native, persisted, foreignVault);
}

async function recoverKeyValueScope(
  transaction: IDBTransaction, storage: KeyValueStorage,
  ownerId: string | null, includeActive: boolean,
): Promise<void> {
  if (ownerId === null) return; // Ownerless work must not acquire an identity.
  const raw = storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY);
  if (raw === null) return;
  const source = parseKeyValueOutboxRecoveryScope(raw, ownerId);
  if (!source) return; // Ambiguous containers stay untouched at their source.
  const metadata = transaction.objectStore(METADATA_STORE);
  const quarantineKey = `${PERSISTED_QUARANTINE_PREFIX}${JSON.stringify(ownerId)}`;
  const prior = await requestResult(metadata.get(quarantineKey)) as PersistedQuarantine | undefined;
  if (source.quarantine.length) metadata.put({
    ...prior, key: quarantineKey, ownerId,
    records: retainOutboxQuarantine(prior?.records, source.quarantine),
  } satisfies PersistedQuarantine);
  const destination = await recoverPersistedOwner(transaction, ownerId, includeActive, storage);
  const blockedKeys = new Set(destination.blockedKeys);
  for (const key of outboxEvidenceBlockedKeys(source, source.records)) blockedKeys.add(key);
  const incoming = classifyOutboxRecoveryGroups(orderOutboxRecoveryRecords(source.records), blockedKeys);
  const receipts = new Map<string, LegacyImportMarker>();
  const historical = await authoritativeEvidenceForOwner(metadata, storage, ownerId);
  const witnesses = [...source.witnesses, ...historical.records];
  for (const key of outboxEvidenceBlockedKeys(historical, [...source.records, ...destination.records])) blockedKeys.add(key);
  for (const key of new Set([...incoming.groups.keys(), ...destination.records.map((item) => item.idempotencyKey)])) {
    const markerKey = `${KEY_VALUE_IMPORT_PREFIX}${JSON.stringify([ownerId, key])}`;
    const receipt = await requestResult(metadata.get(markerKey)) as LegacyImportMarker | undefined;
    if (!receipt) continue;
    // A receipt is evidence of the original intent, not an import shortcut.
    // Compare it with the current source AND current destination on every retry.
    const evidence = classifyOutboxReceiptEvidence(receipt, { key: markerKey, idempotencyKey: key });
    witnesses.push(...evidence.records);
    for (const disputed of evidence.blockedKeys) blockedKeys.add(disputed);
    if (evidence.valid) receipts.set(key, receipt);
  }
  const joint = classifyOutboxRecoveryGroups([
    ...orderOutboxRecoveryRecords(destination.records),
    ...orderOutboxRecoveryRecords(witnesses), ...orderOutboxRecoveryRecords(source.records),
  ], blockedKeys);
  // Historical/raw witnesses stay at their original evidence source. Copying an
  // unkeyed malformed fingerprint into quarantine would discard its namespace
  // scope and incorrectly turn key-only uncertainty into owner-wide uncertainty.
  const destinationAndSource = new Set<unknown>([...destination.records, ...source.records]);
  const rejected = retainOutboxQuarantine(incoming.rejected, joint.rejected.filter(item => destinationAndSource.has(item.record) || isRecoverableLegacyOperation(item.record)));
  if (rejected.length) {
    const retained = await requestResult(metadata.get(quarantineKey)) as PersistedQuarantine | undefined;
    metadata.put({ ...retained, key: quarantineKey, ownerId,
      records: retainOutboxQuarantine(retained?.records, rejected),
    } satisfies PersistedQuarantine);
    await recoverPersistedOwner(transaction, ownerId, includeActive, storage);
  }
  const store = transaction.objectStore(includeActive ? OPERATIONS_STORE : VAULT_OPERATIONS_STORE);
  for (const operation of incoming.operations) {
    if (!joint.groups.get(operation.idempotencyKey)?.operation) continue;
    const existing = destination.records.find((item) => item.idempotencyKey === operation.idempotencyKey);
    if (receipts.has(operation.idempotencyKey) && !existing) continue;
    const targetId = existing?.id ?? operation.id;
    const idKey = includeActive ? targetId : [ownerId, targetId];
    const collision = await requestResult(store.get(idKey)) as OutboxOperation | undefined;
    if (collision && (!existing || collision.idempotencyKey !== operation.idempotencyKey)) {
      // Stable ids cannot be renamed to bypass another intent's primary key,
      // including a vaulted retry colliding with another active key.
      const retained = await requestResult(metadata.get(quarantineKey)) as PersistedQuarantine | undefined;
      metadata.put({ ...retained, key: quarantineKey, ownerId, records: retainOutboxQuarantine(retained?.records, [
        { record: operation, reason: 'IMMUTABLE_CONFLICT' },
        ...(existing ? [{ record: existing, reason: 'IMMUTABLE_CONFLICT' as const }] : []),
      ]) } satisfies PersistedQuarantine);
      await recoverPersistedOwner(transaction, ownerId, includeActive, storage);
      continue;
    }
    if (includeActive && existing && !destination.active.includes(existing)) {
      transaction.objectStore(OPERATIONS_STORE).add(resetInterruptedReplay(withoutOwner(existing as VaultedOperation)));
      transaction.objectStore(VAULT_OPERATIONS_STORE).delete([ownerId, existing.id]);
    }
    if (receipts.has(operation.idempotencyKey)) continue;
    if (!existing) {
      const restored = resetInterruptedReplay(operation);
      if (includeActive) store.add(restored);
      else store.add({ ...restored, ownerId } satisfies VaultedOperation);
    }
    metadata.put({
      key: `${KEY_VALUE_IMPORT_PREFIX}${JSON.stringify([ownerId, operation.idempotencyKey])}`,
      sourceFingerprint: operationFingerprint(operation), importedId: existing?.id ?? operation.id,
    } satisfies LegacyImportMarker);
  }
  // Snapshot retained as a recovery archive. Import receipts commit atomically
  // with destination rows. This logical cleanup prevents resurrection after sync
  // removal and never risks deleting a concurrent/replaced localStorage source.
}

async function initializeOwnerMetadata(metadata: IDBObjectStore, legacyStorage: KeyValueStorage): Promise<void> {
  const owner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
  if (owner) return;
  const legacyOwnerId = legacyStorage.getItem(LEGACY_OWNER_KEY);
  metadata.put({
    key: OWNER_METADATA_KEY,
    userId: legacyOwnerId,
    legacySnapshotOwner: legacyOwnerId !== null,
  } satisfies OwnerMetadata);
}

async function migrateLegacyOutbox(database: IDBDatabase, legacyStorage: KeyValueStorage): Promise<void> {
  const legacyOwnerId = legacyStorage.getItem(LEGACY_OWNER_KEY);
  const raw = legacyStorage.getItem(LEGACY_KEY);
  const transaction = database.transaction(
    [OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE],
    'readwrite',
  );
  const completion = transactionDone(transaction);
  const operations = transaction.objectStore(OPERATIONS_STORE);
  const vault = transaction.objectStore(VAULT_OPERATIONS_STORE);
  const metadata = transaction.objectStore(METADATA_STORE);

  try {
    await initializeOwnerMetadata(metadata, legacyStorage);
    const currentOwner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
    const currentOwnerId = currentOwner?.userId ?? null;
    await recoverPersistedOwner(transaction, currentOwnerId, true, legacyStorage);
    if (raw === null) {
      const marker = await requestResult(metadata.get(LEGACY_MIGRATION_KEY)) as MigrationMarker | undefined;
      if (!marker) {
        metadata.put({ key: LEGACY_MIGRATION_KEY, completedAt: new Date().toISOString() } satisfies MigrationMarker);
      }
      await completion;
      return;
    }

    const owner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
    const importIntoActive = (owner?.userId ?? null) === legacyOwnerId;
    const legacy = await reconcileRecoverySource(transaction, legacyOwnerId, importIntoActive, parseLegacy(raw), legacyStorage);
    let migrationComplete = legacy.complete;
    const vaultOwnerId = legacyOwnerId ?? UNOWNED_VAULT;
    for (const source of legacy.operations) {
      const idempotencyKey = source.idempotencyKey;

      const markerKey = `${LEGACY_IMPORT_PREFIX}${idempotencyKey}`;
      const importMarker = await requestResult(metadata.get(markerKey)) as LegacyImportMarker | undefined;
      const sourceFingerprint = operationFingerprint(source);
      if (importMarker && classifyOutboxReceiptEvidence(importMarker, { key: markerKey, idempotencyKey }).valid
        && importMarker.sourceFingerprint === sourceFingerprint) continue;
      if (importMarker) {
        migrationComplete = false;
        continue;
      }
      const consumedId = legacy.consumed.get(idempotencyKey);
      if (consumedId) {
        metadata.put({ key: markerKey, sourceFingerprint, importedId: consumedId, ownerId: legacyOwnerId } satisfies LegacyImportMarker);
        continue;
      }
      let duplicate: OutboxOperation | undefined;
      if (importIntoActive) {
        duplicate = await requestResult(
          operations.index(IDEMPOTENCY_INDEX).get(idempotencyKey),
        ) as OutboxOperation | undefined;
      } else {
        const vaulted = await requestResult(
          vault.index(VAULT_OWNER_IDEMPOTENCY_INDEX).get([vaultOwnerId, idempotencyKey]),
        ) as VaultedOperation | undefined;
        duplicate = vaulted ? withoutOwner(vaulted) : undefined;
      }
      if (duplicate) {
        if (!immutableOutboxContentMatches(duplicate, source)) {
          migrationComplete = false;
        } else {
          metadata.put({ key: markerKey, sourceFingerprint, importedId: duplicate.id, ownerId: legacyOwnerId } satisfies LegacyImportMarker);
        }
        continue;
      }

      const id = importIntoActive
        ? await allocateLegacyId(operations, source.id)
        : await allocateVaultId(vault, vaultOwnerId, source.id);
      const imported = id === source.id ? source : { ...source, id };
      if (importIntoActive) operations.add(imported);
      else vault.add({ ...imported, ownerId: vaultOwnerId } satisfies VaultedOperation);
      metadata.put({
        key: markerKey,
        sourceFingerprint,
        importedId: imported.id, ownerId: legacyOwnerId,
      } satisfies LegacyImportMarker);
    }

    if (migrationComplete) {
      metadata.put({ key: LEGACY_MIGRATION_KEY, completedAt: new Date().toISOString() } satisfies MigrationMarker);
    }
    await completion;

    // Revalidate at cleanup invocation too: a destination/receipt mutation can
    // commit after import but before this separately awaited cleanup boundary.
    if (migrationComplete) await cleanupLegacySource(database, legacyStorage, legacyOwnerId, raw);
  } catch (error) {
    return abortTransaction(transaction, completion, error);
  }
}

async function cleanupLegacySource(database: IDBDatabase, storage: KeyValueStorage, ownerId: string | null, raw: string): Promise<void> {
  const transaction = database.transaction([OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE], 'readonly');
  const completion = transactionDone(transaction);
  try {
    const metadata = transaction.objectStore(METADATA_STORE);
    const owner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
    const active = owner?.userId === ownerId ? await requestResult(transaction.objectStore(OPERATIONS_STORE).getAll()) as unknown[] : [];
    const vaulted = await requestResult(transaction.objectStore(VAULT_OPERATIONS_STORE).index(VAULT_OWNER_INDEX).getAll(ownerId ?? UNOWNED_VAULT)) as unknown[];
    const retained = await requestResult(metadata.get(`${PERSISTED_QUARANTINE_PREFIX}${JSON.stringify(ownerId)}`)) as PersistedQuarantine | undefined;
    const evidence = await authoritativeEvidenceForOwner(metadata, storage, ownerId);
    const blocked = quarantinedOutboxKeys(retained, ownerId);
    for (const key of evidence.blockedKeys) blocked.add(key);
    const source = parseLegacy(raw);
    const classified = classifyOutboxRecoverySource(source.records, [...active, ...vaulted, ...evidence.records], blocked);
    let permitted = !evidence.incomplete && source.validContainer && classified.complete;
    for (const operation of classified.operations) {
      const key = `${LEGACY_IMPORT_PREFIX}${operation.idempotencyKey}`;
      const marker = await requestResult(metadata.get(key)) as LegacyImportMarker | undefined;
      if (!classifyOutboxReceiptEvidence(marker, { key, idempotencyKey: operation.idempotencyKey, ownerId }).valid
        || marker?.sourceFingerprint !== operationFingerprint(operation)) permitted = false;
    }
    // Raw key/value sources do not join this transaction. Read them after all
    // marker awaits too, so the cleanup decision includes currently visible data.
    const latest = await authoritativeEvidenceForOwner(metadata, storage, ownerId);
    const latestBlocked = new Set([...blocked, ...latest.blockedKeys]);
    permitted &&= !latest.incomplete && classifyOutboxRecoverySource(source.records, [...active, ...vaulted, ...latest.records], latestBlocked).complete;
    // Invoke synchronous cleanup while overlapping destination/receipt writers
    // are still excluded. No active destination is required after successful sync.
    if (permitted && storage.getItem(LEGACY_OWNER_KEY) === ownerId && storage.getItem(LEGACY_KEY) === raw) {
      try { storage.removeItem(LEGACY_KEY); } catch { /* Receipt/source remain retryable. */ }
    }
    await completion;
  } catch (error) {
    return abortTransaction(transaction, completion, error);
  }
}

export class IndexedDbOutboxPersistence implements OutboxPersistence {
  readonly supportsCrossContextAtomicity = true;
  private readonly database: Promise<IDBDatabase>;

  constructor(
    factory: IDBFactory,
    private readonly legacyStorage: KeyValueStorage,
    databaseName = DATABASE_NAME,
    private readonly transitionHook?: (point: ScopeTransitionPoint) => void,
  ) {
    this.database = openDatabase(factory, databaseName).then(async (database) => {
      await migrateLegacyOutbox(database, legacyStorage);
      const transaction = database.transaction([OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE], 'readwrite');
      const completion = transactionDone(transaction);
      try {
        const owner = await requestResult(transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
        await recoverKeyValueScope(transaction, legacyStorage, owner?.userId ?? null, true);
        await completion;
      } catch (error) {
        return abortTransaction(transaction, completion, error);
      }
      return database;
    });
  }

  async list(expectedOwnerId?: string | null): Promise<OutboxOperation[]> {
    const database = await this.database;
    const transaction = database.transaction(
      [OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE], 'readwrite',
    );
    const completion = transactionDone(transaction);
    try {
      const owner = await requestResult(
        transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY),
      ) as OwnerMetadata | undefined;
      const actualOwnerId = owner?.userId ?? null;
      if (expectedOwnerId !== undefined && actualOwnerId !== expectedOwnerId) {
        throw new OutboxOwnerMismatchError(expectedOwnerId, actualOwnerId);
      }
      await recoverKeyValueScope(transaction, this.legacyStorage, actualOwnerId, true);
      const recovered = await recoverPersistedOwner(transaction, actualOwnerId, true, this.legacyStorage);
      const operations = recovered.active;
      await completion;
      return sortOperations(operations);
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  async dispatchIfAuthoritative(expected: OutboxOperation, ownerId: string, canDispatch: () => boolean, dispatch: () => void): Promise<boolean> {
    const database = await this.database;
    // Recovery/owner writes use overlapping stores. They cannot commit between
    // this snapshot and fetch invocation. Never await a network response here.
    const transaction = database.transaction(
      [OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE], 'readonly',
    );
    const completion = transactionDone(transaction);
    try {
      const metadata = transaction.objectStore(METADATA_STORE);
      const owner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
      const retained = await requestResult(metadata.get(`${PERSISTED_QUARANTINE_PREFIX}${JSON.stringify(ownerId)}`)) as PersistedQuarantine | undefined;
      const active = await requestResult(transaction.objectStore(OPERATIONS_STORE).getAll()) as OutboxOperation[];
      const vaulted = await requestResult(transaction.objectStore(VAULT_OPERATIONS_STORE).index(VAULT_OWNER_INDEX).getAll(ownerId)) as VaultedOperation[];
      const blockedKeys = quarantinedOutboxKeys(retained, ownerId);
      const evidence = mergeOutboxEvidence(await authoritativeEvidenceForOwner(metadata, this.legacyStorage, ownerId),
        outboxOperationEvidence([...active, ...vaulted], ownerId));
      for (const key of evidence.blockedKeys) blockedKeys.add(key);
      const groups = classifyOutboxRecoveryGroups([
        ...orderOutboxRecoveryRecords(active), ...orderOutboxRecoveryRecords(vaulted),
        ...orderOutboxRecoveryRecords(evidence.records),
      ], blockedKeys);
      const current = groups.operations.find((item) => active.includes(item) && item.id === expected.id);
      const permitted = !evidence.incomplete && owner?.userId === ownerId && current !== undefined
        && isRecoverableLegacyOperation(current) && current.status === 'SYNCING'
        && operationsMatch(current, expected) && canDispatch();
      if (permitted) dispatch();
      await completion;
      return permitted;
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  async owner(): Promise<string | null> {
    const database = await this.database;
    const transaction = database.transaction(METADATA_STORE, 'readonly');
    const completion = transactionDone(transaction);
    const owner = await requestResult(
      transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY),
    ) as OwnerMetadata | undefined;
    await completion;
    return owner?.userId ?? null;
  }

  async enqueue(
    operation: OutboxOperation,
    expectedOwnerId?: string,
    validate?: OutboxEnqueueValidator,
  ): Promise<OutboxOperation> {
    const database = await this.database;
    const transaction = database.transaction([OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE], 'readwrite');
    const completion = transactionDone(transaction);
    try {
      if (expectedOwnerId === undefined) throw new Error('OUTBOX_EXPECTED_OWNER_REQUIRED');
      const owner = await requestResult(
        transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY),
      ) as OwnerMetadata | undefined;
      const actualOwnerId = owner?.userId ?? null;
      if (actualOwnerId !== expectedOwnerId) throw new OutboxOwnerMismatchError(expectedOwnerId, actualOwnerId);

      const recovered = await recoverPersistedOwner(transaction, actualOwnerId, true, this.legacyStorage);
      if (recovered.blockedKeys.has(operation.idempotencyKey)) {
        throw new OutboxIdempotencyConflictError(operation.idempotencyKey);
      }
      const store = transaction.objectStore(OPERATIONS_STORE);
      const duplicate = await requestResult(
        store.index(IDEMPOTENCY_INDEX).get(operation.idempotencyKey),
      ) as OutboxOperation | undefined;
      if (duplicate) {
        if (!immutableOutboxContentMatches(duplicate, operation)) {
          throw new OutboxIdempotencyConflictError(operation.idempotencyKey);
        }
        await completion;
        return duplicate;
      }
      if (validate) {
        const operations = await requestResult(store.getAll()) as OutboxOperation[];
        validate(operations);
      }
      store.add(operation);
      await completion;
      return operation;
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  async update(id: string, patch: OutboxUpdate, expectedOwnerId?: string | null, expectedOperation?: OutboxOperation): Promise<OutboxOperation | null> {
    const database = await this.database;
    const transaction = database.transaction([OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE], 'readwrite');
    const completion = transactionDone(transaction);
    try {
      const owner = await requestResult(transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
      const actualOwnerId = owner?.userId ?? null;
      if (expectedOwnerId !== undefined && actualOwnerId !== expectedOwnerId) throw new OutboxOwnerMismatchError(expectedOwnerId, actualOwnerId);
      await recoverPersistedOwner(transaction, actualOwnerId, true, this.legacyStorage);

      const store = transaction.objectStore(OPERATIONS_STORE);
      const existing = await requestResult(store.get(id)) as OutboxOperation | undefined;
      if (!existing || (expectedOperation && !operationsMatch(existing, expectedOperation))) {
        await completion;
        return null;
      }
      const updated = { ...existing, ...patch };
      store.put(updated);
      await completion;
      return updated;
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  async importLegacyVault(
    ownerId: string,
    raw: string,
    options: LegacyVaultImportOptions,
  ): Promise<boolean> {
    const database = await this.database;
    const transaction = database.transaction(
      [OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE],
      'readwrite',
    );
    const completion = transactionDone(transaction);
    try {
      const operations = transaction.objectStore(OPERATIONS_STORE);
      const vault = transaction.objectStore(VAULT_OPERATIONS_STORE);
      const metadata = transaction.objectStore(METADATA_STORE);
      const owner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
      const quarantineKey = `${LEGACY_VAULT_QUARANTINE_PREFIX}${ownerId}`;
      const importIntoActive = owner?.userId === ownerId;
      const legacy = await reconcileRecoverySource(transaction, ownerId, importIntoActive, parseLegacyVault(raw), this.legacyStorage);
      if (!options.ownershipProven) {
        let safeToDelete = legacy.complete;
        for (const source of legacy.operations) {
          const idempotencyKey = source.idempotencyKey;
          if (!importIntoActive || !owner?.legacySnapshotOwner) {
            safeToDelete = false;
            continue;
          }
          const existing = await requestResult(
            operations.index(IDEMPOTENCY_INDEX).get(idempotencyKey),
          ) as OutboxOperation | undefined;
          if (!existing || !isRecoverableLegacyOperation(existing) || !immutableOutboxContentMatches(existing, resetInterruptedReplay(source))) {
            safeToDelete = false;
          }
        }
        metadata.put({
          key: quarantineKey,
          raw,
          safeToDelete,
          quarantinedAt: new Date().toISOString(),
          reason: safeToDelete
            ? 'CURRENT_OWNER_LEGACY_VAULT_IS_REDUNDANT'
            : 'LEGACY_VAULT_OWNERSHIP_UNPROVEN',
        });
        await completion;
        return safeToDelete;
      }
      let migrationComplete = legacy.complete;

      for (const source of legacy.operations) {
        const idempotencyKey = source.idempotencyKey;

        const restored = resetInterruptedReplay(source);
        const markerKey = `${LEGACY_VAULT_IMPORT_PREFIX}${JSON.stringify([ownerId, idempotencyKey])}`;
        const importMarker = await requestResult(metadata.get(markerKey)) as LegacyImportMarker | undefined;
        const sourceFingerprint = operationFingerprint(restored);
        if (importMarker && classifyOutboxReceiptEvidence(importMarker, { key: markerKey, idempotencyKey }).valid
        && importMarker.sourceFingerprint === sourceFingerprint) continue;
        if (importMarker) {
          migrationComplete = false;
          continue;
        }
        const consumedId = legacy.consumed.get(idempotencyKey);
        if (consumedId) {
          metadata.put({ key: markerKey, sourceFingerprint, importedId: consumedId } satisfies LegacyImportMarker);
          continue;
        }
        let existing: OutboxOperation | undefined;
        if (importIntoActive) {
          existing = await requestResult(
            operations.index(IDEMPOTENCY_INDEX).get(idempotencyKey),
          ) as OutboxOperation | undefined;
        } else {
          const vaulted = await requestResult(
            vault.index(VAULT_OWNER_IDEMPOTENCY_INDEX).get([ownerId, idempotencyKey]),
          ) as VaultedOperation | undefined;
          existing = vaulted ? withoutOwner(vaulted) : undefined;
        }
        if (existing) {
          if (!immutableOutboxContentMatches(existing, restored)) {
            migrationComplete = false;
          } else {
            metadata.put({ key: markerKey, sourceFingerprint, importedId: existing.id } satisfies LegacyImportMarker);
          }
          continue;
        }

        const id = importIntoActive
          ? await allocateLegacyId(operations, restored.id)
          : await allocateVaultId(vault, ownerId, restored.id);
        const imported = id === restored.id ? restored : { ...restored, id };
        if (importIntoActive) operations.add(imported);
        else vault.add({ ...imported, ownerId } satisfies VaultedOperation);
        metadata.put({
          key: markerKey,
          sourceFingerprint,
          importedId: imported.id,
        } satisfies LegacyImportMarker);
      }

      if (migrationComplete) {
        metadata.delete(quarantineKey);
      } else {
        metadata.put({
          key: quarantineKey,
          raw,
          safeToDelete: false,
          quarantinedAt: new Date().toISOString(),
          reason: 'LEGACY_VAULT_MALFORMED_OR_IMMUTABLE_CONFLICT',
        });
      }
      await completion;
      return migrationComplete;
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  async cleanupLegacyVault(ownerId: string, raw: string, expectedOwnerId: string | null): Promise<boolean> {
    const database = await this.database;
    const transaction = database.transaction([OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE], 'readwrite');
    const completion = transactionDone(transaction);
    try {
      const metadata = transaction.objectStore(METADATA_STORE);
      const owner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
      if ((owner?.userId ?? null) !== expectedOwnerId) { await completion; return false; }
      const source = parseLegacyVault(raw);
      const checked = await reconcileRecoverySource(transaction, ownerId, expectedOwnerId === ownerId, source, this.legacyStorage);
      let permitted = checked.complete;
      for (const operation of checked.operations) {
        const key = `${LEGACY_VAULT_IMPORT_PREFIX}${JSON.stringify([ownerId, operation.idempotencyKey])}`;
        const marker = await requestResult(metadata.get(key)) as LegacyImportMarker | undefined;
        const evidence = classifyOutboxReceiptEvidence(marker, { key, idempotencyKey: operation.idempotencyKey, ownerId });
        if (!evidence.valid || !classifyOutboxRecoveryGroups([operation, ...evidence.records], evidence.blockedKeys).complete) permitted = false;
      }
      // Re-read live raw sources after marker awaits. Destination/receipt rows
      // remain transaction-ordered; external legacy writers do not share it.
      const latest = await authoritativeEvidenceForOwner(metadata, this.legacyStorage, ownerId);
      permitted &&= !latest.incomplete && classifyOutboxRecoverySource(checked.operations, latest.records, latest.blockedKeys).complete;
      if (!permitted) await recoverPersistedOwner(transaction, ownerId, expectedOwnerId === ownerId, this.legacyStorage);
      const key = legacyOutboxVaultKey(ownerId);
      let cleaned = false;
      if (permitted && this.legacyStorage.getItem(key) === raw) {
        // Invoke synchronous removal while destination/receipt/owner writers are
        // excluded. No response/network promise is held by this transaction.
        try { this.legacyStorage.removeItem(key); cleaned = true; } catch { /* Retry from durable receipts. */ }
      }
      await completion;
      return cleaned;
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  async transitionOwner(expectedOwnerId: string | null, targetOwnerId: string | null): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction(
      [OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE],
      'readwrite',
    );
    const completion = transactionDone(transaction);
    try {
      const operations = transaction.objectStore(OPERATIONS_STORE);
      const vault = transaction.objectStore(VAULT_OPERATIONS_STORE);
      const metadata = transaction.objectStore(METADATA_STORE);
      const owner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
      const actualOwnerId = owner?.userId ?? null;
      if (actualOwnerId !== expectedOwnerId) throw new OutboxOwnerMismatchError(expectedOwnerId, actualOwnerId);
      const recovered = await recoverPersistedOwner(transaction, actualOwnerId, true, this.legacyStorage);
      if (actualOwnerId === targetOwnerId) {
        await completion;
        return;
      }

      this.transitionHook?.('after-owner-check');
      const currentOperations = recovered.active;
      const vaultOwnerId = actualOwnerId ?? UNOWNED_VAULT;
      for (const operation of currentOperations) {
        if (operation.status === 'SYNCED') continue;
        const existing = await requestResult(
          vault.index(VAULT_OWNER_IDEMPOTENCY_INDEX).get([vaultOwnerId, operation.idempotencyKey]),
        ) as VaultedOperation | undefined;
        if (existing && !operationsMatch(withoutOwner(existing), operation)) {
          throw new Error('OUTBOX_VAULT_IDEMPOTENCY_COLLISION');
        }
        if (!existing) vault.put({ ...operation, ownerId: vaultOwnerId } satisfies VaultedOperation);
      }

      this.transitionHook?.('after-vault');
      operations.clear();
      this.transitionHook?.('after-clear');
      if (targetOwnerId) {
        await recoverKeyValueScope(transaction, this.legacyStorage, targetOwnerId, false);
        const target = await recoverPersistedOwner(transaction, targetOwnerId, false, this.legacyStorage);
        for (const record of target.vaulted) operations.add(resetInterruptedReplay(record));
        // Rejected records are already durable in metadata. Delete only the
        // valid target rows restored by this transaction.
        for (const record of target.vaulted) vault.delete([targetOwnerId, record.id]);
      }

      this.transitionHook?.('after-restore');
      metadata.put({
        key: OWNER_METADATA_KEY,
        userId: targetOwnerId,
        legacySnapshotOwner: false,
      } satisfies OwnerMetadata);
      this.transitionHook?.('after-owner-write');
      await completion;
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  private async cleanActive(
    action: (store: IDBObjectStore, active: OutboxOperation[]) => void,
  ): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction(
      [OPERATIONS_STORE, VAULT_OPERATIONS_STORE, METADATA_STORE], 'readwrite',
    );
    const completion = transactionDone(transaction);
    try {
      const owner = await requestResult(
        transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY),
      ) as OwnerMetadata | undefined;
      const recovered = await recoverPersistedOwner(transaction, owner?.userId ?? null, true, this.legacyStorage);
      action(transaction.objectStore(OPERATIONS_STORE), recovered.active);
      // replaceAll may have introduced untrusted records; quarantine atomically.
      await recoverPersistedOwner(transaction, owner?.userId ?? null, true, this.legacyStorage);
      await completion;
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  removeSynced(): Promise<void> {
    return this.cleanActive((store, active) => {
      for (const operation of active) if (operation.status === 'SYNCED') store.delete(operation.id);
    });
  }

  clear(): Promise<void> {
    return this.cleanActive((store) => { store.clear(); });
  }

  replaceAll(operations: OutboxOperation[]): Promise<void> {
    return this.cleanActive((store) => {
      store.clear();
      for (const operation of operations) store.add(operation);
    });
  }
}
