import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import type { KeyValueStorage } from './storage';

const LEGACY_KEY = 'pharmacystock:outbox:v1:operations';

function memoryStorage(): KeyValueStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function store(factory: IDBFactory, storage: KeyValueStorage, databaseName: string) {
  return new OutboxStore(storage, { indexedDB: factory, databaseName });
}

function operation(
  id: string,
  idempotencyKey: string,
  createdAt: string,
  payload: unknown = { saleNumber: id },
): Omit<OutboxOperation, 'status' | 'attemptCount'> {
  return {
    id,
    kind: 'SALE',
    organizationId: 'org-a',
    branchId: 'branch-a',
    idempotencyKey,
    payload,
    createdAt,
  };
}

function persistedOperation(
  id: string,
  idempotencyKey: string,
  createdAt: string,
  payload?: unknown,
): OutboxOperation {
  return { ...operation(id, idempotencyKey, createdAt, payload), status: 'PENDING', attemptCount: 0 };
}

async function bind(outbox: OutboxStore, userId = 'user-a') {
  await outbox.transitionOwner(await outbox.owner(), userId);
}

function setLegacy(storage: KeyValueStorage, operations: unknown[]) {
  storage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, operations }));
}

describe('IndexedDB outbox persistence', () => {
  it('resumes a blocked database upgrade after the legacy tab closes', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'outbox-blocked-upgrade';
    const legacyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const upgraded = store(factory, storage, databaseName);
    let ready = false;
    const readiness = upgraded.ready().then(() => { ready = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ready).toBe(false);

    legacyDatabase.close();
    await readiness;
    await bind(upgraded);
    await upgraded.enqueue(operation('sale-a', 'upgrade-key', '2026-09-20T12:00:00.000Z'), 'user-a');
    expect(upgraded.list().map((item) => item.id)).toEqual(['sale-a']);
  });

  it('keeps concurrent enqueues from two tab-like writers', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const first = store(factory, storage, 'outbox-concurrent-writers');
    const second = store(factory, storage, 'outbox-concurrent-writers');
    await bind(first);

    await Promise.all([
      first.enqueue(operation('sale-a', 'idempotency-a', '2026-09-20T12:02:00.000Z'), 'user-a'),
      second.enqueue(operation('sale-b', 'idempotency-b', '2026-09-20T12:01:00.000Z'), 'user-a'),
    ]);

    const reconstructed = store(factory, storage, 'outbox-concurrent-writers');
    await reconstructed.ready();
    expect(reconstructed.list().map((item) => item.id)).toEqual(['sale-b', 'sale-a']);
  });

  it('enforces one operation per idempotency key across concurrent writers', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const first = store(factory, storage, 'outbox-unique-idempotency');
    const second = store(factory, storage, 'outbox-unique-idempotency');
    await bind(first);

    const results = await Promise.all([
      first.enqueue(operation('sale-a', 'shared-idempotency', '2026-09-20T12:00:00.000Z'), 'user-a'),
      second.enqueue(operation('sale-b', 'shared-idempotency', '2026-09-20T12:01:00.000Z'), 'user-a'),
    ]);

    const reconstructed = store(factory, storage, 'outbox-unique-idempotency');
    await reconstructed.ready();
    expect(reconstructed.list()).toHaveLength(1);
    expect(results[0].id).toBe(results[1].id);
    expect(reconstructed.list()[0]?.idempotencyKey).toBe('shared-idempotency');
  });

  it('updates individual records without overwriting unrelated operations', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const first = store(factory, storage, 'outbox-isolated-updates');
    const second = store(factory, storage, 'outbox-isolated-updates');
    await bind(first);
    await first.enqueue(operation('sale-a', 'idempotency-a', '2026-09-20T12:00:00.000Z'), 'user-a');
    await second.enqueue(operation('sale-b', 'idempotency-b', '2026-09-20T12:01:00.000Z'), 'user-a');

    await Promise.all([
      first.update('sale-a', { status: 'SYNCING', attemptCount: 1 }, 'user-a'),
      second.update('sale-b', { status: 'CONFLICT', lastErrorCode: 'INSUFFICIENT_STOCK' }, 'user-a'),
    ]);

    const reconstructed = store(factory, storage, 'outbox-isolated-updates');
    await reconstructed.ready();
    expect(reconstructed.list()).toEqual([
      expect.objectContaining({ id: 'sale-a', status: 'SYNCING', attemptCount: 1 }),
      expect.objectContaining({ id: 'sale-b', status: 'CONFLICT', lastErrorCode: 'INSUFFICIENT_STOCK' }),
    ]);
  });

  it('survives store reconstruction with the original idempotency key', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const initial = store(factory, storage, 'outbox-reconstruction');
    await bind(initial);
    await initial.enqueue(operation('sale-a', 'stable-key', '2026-09-20T12:00:00.000Z'), 'user-a');

    const reconstructed = store(factory, storage, 'outbox-reconstruction');
    await reconstructed.ready();
    expect(reconstructed.list()[0]).toMatchObject({ id: 'sale-a', idempotencyKey: 'stable-key', status: 'PENDING' });
  });

  it('migrates every valid legacy localStorage operation before removing the legacy value', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    setLegacy(storage, [
      { ...persistedOperation('sale-b', 'legacy-b', '2026-09-20T12:02:00.000Z'), status: 'FAILED', attemptCount: 2 },
      persistedOperation('sale-a', 'legacy-a', '2026-09-20T12:01:00.000Z'),
    ]);

    const migrated = store(factory, storage, 'outbox-legacy-migration');
    await migrated.ready();
    expect(migrated.list()).toEqual([
      expect.objectContaining({ id: 'sale-a', idempotencyKey: 'legacy-a', status: 'PENDING' }),
      expect.objectContaining({ id: 'sale-b', idempotencyKey: 'legacy-b', status: 'FAILED', attemptCount: 2 }),
    ]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('imports a legacy write created after the first migration marker', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const initial = store(factory, storage, 'outbox-late-legacy-write');
    await initial.ready();
    setLegacy(storage, [persistedOperation('late-sale', 'late-legacy-key', '2026-09-20T12:03:00.000Z')]);

    const migrated = store(factory, storage, 'outbox-late-legacy-write');
    await migrated.ready();
    expect(migrated.list()[0]).toMatchObject({ id: 'late-sale', idempotencyKey: 'late-legacy-key' });
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('does not delete a legacy write that changes while an earlier snapshot imports', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const first = persistedOperation('first-sale', 'first-key', '2026-09-20T12:00:00.000Z');
    const late = persistedOperation('late-sale', 'late-key', '2026-09-20T12:01:00.000Z');
    setLegacy(storage, [first]);
    const originalGet = storage.getItem;
    let legacyReads = 0;
    storage.getItem = (key) => {
      if (key === LEGACY_KEY && ++legacyReads === 2) {
        setLegacy(storage, [late]);
      }
      return originalGet(key);
    };

    const initial = store(factory, storage, 'outbox-concurrent-legacy-write');
    await initial.ready();
    expect(initial.list()).toEqual([first]);
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();

    const retried = store(factory, storage, 'outbox-concurrent-legacy-write');
    await retried.ready();
    expect(retried.list()).toEqual([first, late]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('collapses identical legacy duplicate idempotency keys', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const duplicate = persistedOperation('sale-a', 'same-key', '2026-09-20T12:00:00.000Z');
    setLegacy(storage, [duplicate, duplicate]);

    const migrated = store(factory, storage, 'outbox-identical-legacy-duplicate');
    await migrated.ready();
    expect(migrated.list()).toEqual([duplicate]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('retains ambiguous legacy duplicate idempotency keys without importing either record', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const first = persistedOperation('sale-a', 'ambiguous-key', '2026-09-20T12:00:00.000Z', { total: 10 });
    const second = persistedOperation('sale-b', 'ambiguous-key', '2026-09-20T12:01:00.000Z', { total: 20 });
    setLegacy(storage, [first, second]);

    const migrated = store(factory, storage, 'outbox-ambiguous-legacy-duplicate');
    await migrated.ready();
    expect(migrated.list()).toEqual([]);
    expect(JSON.parse(storage.getItem(LEGACY_KEY) ?? '{}').operations).toEqual([first, second]);

    const retried = store(factory, storage, 'outbox-ambiguous-legacy-duplicate');
    await retried.ready();
    expect(retried.list()).toEqual([]);
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it('retains malformed legacy data while importing any independently valid record', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const valid = persistedOperation('sale-a', 'valid-key', '2026-09-20T12:00:00.000Z');
    setLegacy(storage, [valid, { id: 'malformed-sale' }]);

    const migrated = store(factory, storage, 'outbox-malformed-legacy');
    await migrated.ready();
    expect(migrated.list()).toEqual([valid]);
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it('retries legacy cleanup idempotently after a successful import', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const valid = persistedOperation('sale-a', 'cleanup-key', '2026-09-20T12:00:00.000Z');
    setLegacy(storage, [valid]);
    let failCleanup = true;
    const originalRemove = storage.removeItem;
    storage.removeItem = (key) => {
      if (key === LEGACY_KEY && failCleanup) throw new Error('simulated cleanup interruption');
      originalRemove(key);
    };

    const first = store(factory, storage, 'outbox-cleanup-retry');
    await first.ready();
    expect(first.list()).toEqual([valid]);
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();

    failCleanup = false;
    const retried = store(factory, storage, 'outbox-cleanup-retry');
    await retried.ready();
    expect(retried.list()).toEqual([valid]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('does not re-import a successfully migrated operation after cleanup failed and sync removed it', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const valid = persistedOperation('sale-a', 'removed-key', '2026-09-20T12:00:00.000Z');
    storage.setItem('pharmacystock:offline-scope:v1:user-id', 'user-a');
    setLegacy(storage, [valid]);
    let failCleanup = true;
    const originalRemove = storage.removeItem;
    storage.removeItem = (key) => {
      if (key === LEGACY_KEY && failCleanup) throw new Error('simulated cleanup interruption');
      originalRemove(key);
    };

    const first = store(factory, storage, 'outbox-cleanup-after-sync-removal');
    await first.ready();
    await bind(first);
    await first.update(valid.id, { status: 'SYNCED' }, 'user-a');
    await first.removeSynced();
    expect(first.list()).toEqual([]);
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();

    failCleanup = false;
    const reconstructed = store(factory, storage, 'outbox-cleanup-after-sync-removal');
    await reconstructed.ready();
    expect(reconstructed.list()).toEqual([]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('retains a materially changed legacy record after its original fingerprint was imported', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const original = persistedOperation('sale-a', 'changed-key', '2026-09-20T12:00:00.000Z', { total: 10 });
    storage.setItem('pharmacystock:offline-scope:v1:user-id', 'user-a');
    setLegacy(storage, [original]);
    const originalRemove = storage.removeItem;
    storage.removeItem = (key) => {
      if (key === LEGACY_KEY) throw new Error('simulated cleanup interruption');
      originalRemove(key);
    };

    const first = store(factory, storage, 'outbox-changed-import-fingerprint');
    await first.ready();
    const changed = { ...original, payload: { total: 20 } };
    setLegacy(storage, [changed]);

    const reconstructed = store(factory, storage, 'outbox-changed-import-fingerprint');
    await reconstructed.ready();
    expect(reconstructed.list()).toEqual([original]);
    expect(JSON.parse(storage.getItem(LEGACY_KEY) ?? '{}').operations).toEqual([changed]);
  });

  it('renames a colliding legacy primary key so both valid operations survive', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const initial = store(factory, storage, 'outbox-primary-key-collision');
    await bind(initial);
    await initial.enqueue(operation('same-id', 'existing-key', '2026-09-20T12:00:00.000Z'), 'user-a');
    storage.setItem('pharmacystock:offline-scope:v1:user-id', 'user-a');
    setLegacy(storage, [persistedOperation('same-id', 'legacy-key', '2026-09-20T12:01:00.000Z')]);

    const migrated = store(factory, storage, 'outbox-primary-key-collision');
    await migrated.ready();
    expect(migrated.list()).toEqual([
      expect.objectContaining({ id: 'same-id', idempotencyKey: 'existing-key' }),
      expect.objectContaining({ id: 'same-id:legacy:1', idempotencyKey: 'legacy-key' }),
    ]);
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('keeps replaceAll, removeSynced, and clear atomic and ordered', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const outbox = store(factory, storage, 'outbox-bulk-behavior');
    await outbox.replaceAll([
      { ...operation('sale-b', 'key-b', '2026-09-20T12:02:00.000Z'), status: 'SYNCED', attemptCount: 1 },
      persistedOperation('sale-a', 'key-a', '2026-09-20T12:01:00.000Z'),
    ]);
    expect(outbox.list().map((item) => item.id)).toEqual(['sale-a', 'sale-b']);
    await outbox.removeSynced();
    expect(outbox.list().map((item) => item.id)).toEqual(['sale-a']);
    await outbox.clear();
    expect(outbox.list()).toEqual([]);
  });
});
