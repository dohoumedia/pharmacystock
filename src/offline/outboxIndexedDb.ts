import type { KeyValueStorage } from './storage';
import type { OutboxOperation, OutboxPersistence, OutboxUpdate } from './outbox';

const DATABASE_NAME = 'pharmacystock:outbox:v2';
const DATABASE_VERSION = 1;
const OPERATIONS_STORE = 'operations';
const METADATA_STORE = 'metadata';
const IDEMPOTENCY_INDEX = 'idempotencyKey';
const STATUS_INDEX = 'status';
const LEGACY_KEY = 'pharmacystock:outbox:v1:operations';
const LEGACY_MIGRATION_KEY = 'legacy-local-storage-v1';

type MigrationMarker = {
  key: string;
  completedAt: string;
};

type LegacyOutbox = {
  version: 1;
  operations: unknown[];
};

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
    if (parsed.version !== 1 || !Array.isArray(parsed.operations)) {
      return { operations: [], complete: false };
    }
    const operations = parsed.operations.filter(isOutboxOperation);
    return { operations, complete: operations.length === parsed.operations.length };
  } catch {
    return { operations: [], complete: false };
  }
}

function sortOperations(operations: OutboxOperation[]) {
  return [...operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  const request = factory.open(databaseName, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    const operations = database.createObjectStore(OPERATIONS_STORE, { keyPath: 'id' });
    operations.createIndex(IDEMPOTENCY_INDEX, IDEMPOTENCY_INDEX, { unique: true });
    operations.createIndex(STATUS_INDEX, STATUS_INDEX);
    database.createObjectStore(METADATA_STORE, { keyPath: 'key' });
  };
  return requestResult(request);
}

async function allocateLegacyId(store: IDBObjectStore, requestedId: string): Promise<string> {
  if (!await requestResult(store.getKey(requestedId))) return requestedId;
  let suffix = 1;
  while (await requestResult(store.getKey(`${requestedId}:legacy:${suffix}`))) suffix += 1;
  return `${requestedId}:legacy:${suffix}`;
}

async function migrateLegacyOutbox(database: IDBDatabase, legacyStorage: KeyValueStorage): Promise<void> {
  const raw = legacyStorage.getItem(LEGACY_KEY);
  const transaction = database.transaction([OPERATIONS_STORE, METADATA_STORE], 'readwrite');
  const completion = transactionDone(transaction);
  const operations = transaction.objectStore(OPERATIONS_STORE);
  const metadata = transaction.objectStore(METADATA_STORE);
  const marker = await requestResult(metadata.get(LEGACY_MIGRATION_KEY)) as MigrationMarker | undefined;

  if (raw === null) {
    if (!marker) {
      metadata.put({ key: LEGACY_MIGRATION_KEY, completedAt: new Date().toISOString() } satisfies MigrationMarker);
    }
    await completion;
    return;
  }

  const legacy = parseLegacy(raw);
  for (const operation of sortOperations(legacy.operations)) {
    const duplicate = await requestResult(
      operations.index(IDEMPOTENCY_INDEX).get(operation.idempotencyKey),
    ) as OutboxOperation | undefined;
    if (duplicate) continue;

    const id = await allocateLegacyId(operations, operation.id);
    operations.add(id === operation.id ? operation : { ...operation, id });
  }

  if (legacy.complete) {
    metadata.put({ key: LEGACY_MIGRATION_KEY, completedAt: new Date().toISOString() } satisfies MigrationMarker);
  }
  await completion;

  // Local storage cannot participate in the IndexedDB transaction. Removing it
  // only after the import and marker commit makes interruption retry-safe.
  if (legacy.complete) {
    try {
      legacyStorage.removeItem(LEGACY_KEY);
    } catch {
      // IndexedDB is authoritative now; retain the legacy copy for retryable cleanup.
    }
  }
}

export class IndexedDbOutboxPersistence implements OutboxPersistence {
  private readonly database: Promise<IDBDatabase>;

  constructor(
    factory: IDBFactory,
    legacyStorage: KeyValueStorage,
    databaseName = DATABASE_NAME,
  ) {
    this.database = openDatabase(factory, databaseName).then(async (database) => {
      await migrateLegacyOutbox(database, legacyStorage);
      return database;
    });
  }

  async list(): Promise<OutboxOperation[]> {
    const database = await this.database;
    const transaction = database.transaction(OPERATIONS_STORE, 'readonly');
    const completion = transactionDone(transaction);
    const operations = await requestResult(transaction.objectStore(OPERATIONS_STORE).getAll()) as OutboxOperation[];
    await completion;
    return sortOperations(operations);
  }

  async enqueue(operation: OutboxOperation): Promise<OutboxOperation> {
    const database = await this.database;
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    const completion = transactionDone(transaction);
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
  }

  async update(id: string, patch: OutboxUpdate): Promise<OutboxOperation | null> {
    const database = await this.database;
    const transaction = database.transaction(OPERATIONS_STORE, 'readwrite');
    const completion = transactionDone(transaction);
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
