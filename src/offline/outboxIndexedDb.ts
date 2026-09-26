import type { KeyValueStorage } from './storage';
import {
  OutboxOwnerMismatchError,
  type OutboxOperation,
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
type LegacyImportMarker = { key: string; sourceFingerprint: string; importedId: string };
type LegacyVaultQuarantine = { key: string; raw: string; safeToDelete: boolean };
type OwnerMetadata = { key: string; userId: string | null; legacySnapshotOwner?: boolean };
type LegacyOutbox = { version: 1; operations: unknown[] };
type LegacyVault = { operations: unknown[] };
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

function isOutboxOperation(value: unknown): value is OutboxOperation {
  if (!value || typeof value !== 'object') return false;
  const operation = value as Partial<OutboxOperation>;
  return typeof operation.id === 'string'
    && operation.id.length > 0
    && typeof operation.kind === 'string'
    && operation.kind.length > 0
    && typeof operation.organizationId === 'string'
    && operation.organizationId.length > 0
    && typeof operation.idempotencyKey === 'string'
    && operation.idempotencyKey.length > 0
    && typeof operation.createdAt === 'string'
    && ['PENDING', 'SYNCING', 'SYNCED', 'CONFLICT', 'FAILED'].includes(operation.status ?? '')
    && typeof operation.attemptCount === 'number'
    && Number.isFinite(operation.attemptCount)
    && operation.attemptCount >= 0
    && 'payload' in operation;
}

function parseLegacy(raw: string): { operations: OutboxOperation[]; complete: boolean } {
  try {
    const parsed = JSON.parse(raw) as LegacyOutbox;
    if (parsed.version !== 1 || !Array.isArray(parsed.operations)) return { operations: [], complete: false };
    const operations = parsed.operations.filter(isOutboxOperation);
    return { operations, complete: operations.length === parsed.operations.length };
  } catch {
    return { operations: [], complete: false };
  }
}

function parseLegacyVault(raw: string): { operations: OutboxOperation[]; complete: boolean } {
  try {
    const parsed = JSON.parse(raw) as LegacyVault;
    if (!Array.isArray(parsed.operations)) return { operations: [], complete: false };
    const operations = parsed.operations.filter(isOutboxOperation);
    return { operations, complete: operations.length === parsed.operations.length };
  } catch {
    return { operations: [], complete: false };
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function operationFingerprint(operation: OutboxOperation): string {
  return stableSerialize(operation);
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

function resetInterruptedReplay(operation: OutboxOperation): OutboxOperation {
  if (operation.status !== 'SYNCING') return operation;
  return { ...operation, status: 'PENDING', nextAttemptAt: undefined, lastErrorCode: undefined };
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

function legacyGroups(operations: OutboxOperation[]) {
  const groups = new Map<string, OutboxOperation[]>();
  for (const operation of sortOperations(operations)) {
    const group = groups.get(operation.idempotencyKey) ?? [];
    group.push(operation);
    groups.set(operation.idempotencyKey, group);
  }
  return groups;
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
    if (raw === null) {
      const marker = await requestResult(metadata.get(LEGACY_MIGRATION_KEY)) as MigrationMarker | undefined;
      if (!marker) {
        metadata.put({ key: LEGACY_MIGRATION_KEY, completedAt: new Date().toISOString() } satisfies MigrationMarker);
      }
      await completion;
      return;
    }

    const legacy = parseLegacy(raw);
    let migrationComplete = legacy.complete;
    const owner = await requestResult(metadata.get(OWNER_METADATA_KEY)) as OwnerMetadata | undefined;
    const importIntoActive = (owner?.userId ?? null) === legacyOwnerId;
    const vaultOwnerId = legacyOwnerId ?? UNOWNED_VAULT;
    for (const [idempotencyKey, group] of legacyGroups(legacy.operations)) {
      const source = group[0];
      if (!source) continue;
      if (group.some((candidate) => !operationsMatch(candidate, source))) {
        migrationComplete = false;
        continue;
      }

      const markerKey = `${LEGACY_IMPORT_PREFIX}${idempotencyKey}`;
      const importMarker = await requestResult(metadata.get(markerKey)) as LegacyImportMarker | undefined;
      const sourceFingerprint = operationFingerprint(source);
      if (importMarker?.sourceFingerprint === sourceFingerprint) continue;
      if (importMarker) {
        migrationComplete = false;
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
        if (!operationsMatch(duplicate, source)) {
          migrationComplete = false;
        } else {
          metadata.put({ key: markerKey, sourceFingerprint, importedId: duplicate.id } satisfies LegacyImportMarker);
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
        importedId: imported.id,
      } satisfies LegacyImportMarker);
    }

    if (migrationComplete) {
      metadata.put({ key: LEGACY_MIGRATION_KEY, completedAt: new Date().toISOString() } satisfies MigrationMarker);
    }
    await completion;

    // localStorage cannot join the IndexedDB transaction. Remove it only after
    // every record was proven imported (or an identical duplicate) and committed.
    // A late legacy writer must be left for the next migration attempt.
    if (migrationComplete
      && legacyStorage.getItem(LEGACY_OWNER_KEY) === legacyOwnerId
      && legacyStorage.getItem(LEGACY_KEY) === raw) {
      try {
        legacyStorage.removeItem(LEGACY_KEY);
      } catch {
        // Retaining the source makes cleanup safely retryable.
      }
    }
  } catch (error) {
    return abortTransaction(transaction, completion, error);
  }
}

export class IndexedDbOutboxPersistence implements OutboxPersistence {
  private readonly database: Promise<IDBDatabase>;

  constructor(
    factory: IDBFactory,
    legacyStorage: KeyValueStorage,
    databaseName = DATABASE_NAME,
    private readonly transitionHook?: (point: ScopeTransitionPoint) => void,
  ) {
    this.database = openDatabase(factory, databaseName).then(async (database) => {
      await migrateLegacyOutbox(database, legacyStorage);
      return database;
    });
  }

  async list(expectedOwnerId?: string): Promise<OutboxOperation[]> {
    const database = await this.database;
    const stores = expectedOwnerId === undefined ? [OPERATIONS_STORE] : [OPERATIONS_STORE, METADATA_STORE];
    const transaction = database.transaction(stores, 'readonly');
    const completion = transactionDone(transaction);
    try {
      if (expectedOwnerId !== undefined) {
        const owner = await requestResult(
          transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY),
        ) as OwnerMetadata | undefined;
        const actualOwnerId = owner?.userId ?? null;
        if (actualOwnerId !== expectedOwnerId) throw new OutboxOwnerMismatchError(expectedOwnerId, actualOwnerId);
      }
      const operations = await requestResult(
        transaction.objectStore(OPERATIONS_STORE).getAll(),
      ) as OutboxOperation[];
      await completion;
      return sortOperations(operations);
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

  async enqueue(operation: OutboxOperation, expectedOwnerId?: string): Promise<OutboxOperation> {
    const database = await this.database;
    const transaction = database.transaction([OPERATIONS_STORE, METADATA_STORE], 'readwrite');
    const completion = transactionDone(transaction);
    try {
      if (expectedOwnerId === undefined) throw new Error('OUTBOX_EXPECTED_OWNER_REQUIRED');
      const owner = await requestResult(
        transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY),
      ) as OwnerMetadata | undefined;
      const actualOwnerId = owner?.userId ?? null;
      if (actualOwnerId !== expectedOwnerId) throw new OutboxOwnerMismatchError(expectedOwnerId, actualOwnerId);

      const store = transaction.objectStore(OPERATIONS_STORE);
      const duplicate = await requestResult(
        store.index(IDEMPOTENCY_INDEX).get(operation.idempotencyKey),
      ) as OutboxOperation | undefined;
      if (duplicate) {
        await completion;
        return duplicate;
      }
      store.add(operation);
      await completion;
      return operation;
    } catch (error) {
      return abortTransaction(transaction, completion, error);
    }
  }

  async update(id: string, patch: OutboxUpdate, expectedOwnerId?: string): Promise<OutboxOperation | null> {
    const database = await this.database;
    const stores = expectedOwnerId === undefined ? [OPERATIONS_STORE] : [OPERATIONS_STORE, METADATA_STORE];
    const transaction = database.transaction(stores, 'readwrite');
    const completion = transactionDone(transaction);
    try {
      if (expectedOwnerId !== undefined) {
        const owner = await requestResult(
          transaction.objectStore(METADATA_STORE).get(OWNER_METADATA_KEY),
        ) as OwnerMetadata | undefined;
        const actualOwnerId = owner?.userId ?? null;
        if (actualOwnerId !== expectedOwnerId) throw new OutboxOwnerMismatchError(expectedOwnerId, actualOwnerId);
      }

      const store = transaction.objectStore(OPERATIONS_STORE);
      const existing = await requestResult(store.get(id)) as OutboxOperation | undefined;
      if (!existing) {
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

  async importLegacyVault(ownerId: string, raw: string): Promise<boolean> {
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
      const quarantine = await requestResult(metadata.get(quarantineKey)) as LegacyVaultQuarantine | undefined;
      if (quarantine?.raw === raw) {
        await completion;
        return quarantine.safeToDelete;
      }
      const importIntoActive = owner?.userId === ownerId;
      const legacy = parseLegacyVault(raw);
      if (importIntoActive && owner?.legacySnapshotOwner) {
        let safeToDelete = legacy.complete;
        for (const [idempotencyKey, group] of legacyGroups(legacy.operations)) {
          const source = group[0];
          if (!source || group.some((candidate) => !operationsMatch(candidate, source))) {
            safeToDelete = false;
            continue;
          }
          const existing = await requestResult(
            operations.index(IDEMPOTENCY_INDEX).get(idempotencyKey),
          ) as OutboxOperation | undefined;
          if (!existing || !operationsMatch(existing, resetInterruptedReplay(source))) safeToDelete = false;
        }
        metadata.put({
          key: quarantineKey,
          raw,
          safeToDelete,
          quarantinedAt: new Date().toISOString(),
          reason: safeToDelete
            ? 'CURRENT_OWNER_LEGACY_VAULT_IS_REDUNDANT'
            : 'CURRENT_OWNER_LEGACY_VAULT_IS_AMBIGUOUS',
        });
        await completion;
        return safeToDelete;
      }
      let migrationComplete = legacy.complete;

      for (const [idempotencyKey, group] of legacyGroups(legacy.operations)) {
        const source = group[0];
        if (!source) continue;
        if (group.some((candidate) => !operationsMatch(candidate, source))) {
          migrationComplete = false;
          continue;
        }

        const restored = resetInterruptedReplay(source);
        const markerKey = `${LEGACY_VAULT_IMPORT_PREFIX}${JSON.stringify([ownerId, idempotencyKey])}`;
        const importMarker = await requestResult(metadata.get(markerKey)) as LegacyImportMarker | undefined;
        const sourceFingerprint = operationFingerprint(restored);
        if (importMarker?.sourceFingerprint === sourceFingerprint) continue;
        if (importMarker) {
          migrationComplete = false;
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
          if (!operationsMatch(existing, restored)) {
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

      await completion;
      return migrationComplete;
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
      if (actualOwnerId === targetOwnerId) {
        await completion;
        return;
      }

      this.transitionHook?.('after-owner-check');
      const currentOperations = sortOperations(
        await requestResult(operations.getAll()) as OutboxOperation[],
      );
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
        const targetRecords = await requestResult(
          vault.index(VAULT_OWNER_INDEX).getAll(targetOwnerId),
        ) as VaultedOperation[];
        for (const record of sortOperations(targetRecords.map(withoutOwner))) {
          operations.add(resetInterruptedReplay(record));
        }
        const targetKeys = await requestResult(
          vault.index(VAULT_OWNER_INDEX).getAllKeys(targetOwnerId),
        );
        for (const key of targetKeys) vault.delete(key);
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

  async removeSynced(): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(OPERATIONS_STORE);
    const keys = await requestResult(store.index(STATUS_INDEX).getAllKeys('SYNCED'));
    for (const key of keys) store.delete(key);
    await completion;
  }

  async clear(): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    const completion = transactionDone(transaction);
    transaction.objectStore(OPERATIONS_STORE).clear();
    await completion;
  }

  async replaceAll(operations: OutboxOperation[]): Promise<void> {
    const database = await this.database;
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(OPERATIONS_STORE);
    store.clear();
    for (const operation of sortOperations(operations)) store.add(operation);
    await completion;
  }
}
