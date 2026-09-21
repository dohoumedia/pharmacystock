import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import type { KeyValueStorage } from './storage';

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

function operation(id: string, idempotencyKey: string, createdAt: string): Omit<OutboxOperation, 'status' | 'attemptCount'> {
  return {
    id,
    kind: 'SALE',
    organizationId: 'org-a',
    branchId: 'branch-a',
    idempotencyKey,
    payload: { saleNumber: id },
    createdAt,
  };
}

describe('IndexedDB outbox persistence', () => {
  it('keeps concurrent enqueues from two tab-like writers', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const first = store(factory, storage, 'outbox-concurrent-writers');
    const second = store(factory, storage, 'outbox-concurrent-writers');

    await Promise.all([
      first.enqueue(operation('sale-a', 'idempotency-a', '2026-09-20T12:02:00.000Z')),
      second.enqueue(operation('sale-b', 'idempotency-b', '2026-09-20T12:01:00.000Z')),
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

    const results = await Promise.all([
      first.enqueue(operation('sale-a', 'shared-idempotency', '2026-09-20T12:00:00.000Z')),
      second.enqueue(operation('sale-b', 'shared-idempotency', '2026-09-20T12:01:00.000Z')),
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
    await first.enqueue(operation('sale-a', 'idempotency-a', '2026-09-20T12:00:00.000Z'));
    await second.enqueue(operation('sale-b', 'idempotency-b', '2026-09-20T12:01:00.000Z'));

    await Promise.all([
      first.update('sale-a', { status: 'SYNCING', attemptCount: 1 }),
      second.update('sale-b', { status: 'CONFLICT', lastErrorCode: 'INSUFFICIENT_STOCK' }),
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
    await initial.enqueue(operation('sale-a', 'stable-key', '2026-09-20T12:00:00.000Z'));

    const reconstructed = store(factory, storage, 'outbox-reconstruction');
    await reconstructed.ready();

    expect(reconstructed.list()[0]).toMatchObject({
      id: 'sale-a',
      idempotencyKey: 'stable-key',
      status: 'PENDING',
    });
  });

  it('migrates every valid legacy localStorage operation before removing the legacy value', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const legacyOperations: OutboxOperation[] = [
      { ...operation('sale-b', 'legacy-b', '2026-09-20T12:02:00.000Z'), status: 'FAILED', attemptCount: 2 },
      { ...operation('sale-a', 'legacy-a', '2026-09-20T12:01:00.000Z'), status: 'PENDING', attemptCount: 0 },
    ];
    storage.setItem('pharmacystock:outbox:v1:operations', JSON.stringify({
      version: 1,
      operations: legacyOperations,
    }));

    const migrated = store(factory, storage, 'outbox-legacy-migration');
    await migrated.ready();

    expect(migrated.list()).toEqual([
      expect.objectContaining({ id: 'sale-a', idempotencyKey: 'legacy-a', status: 'PENDING' }),
      expect.objectContaining({ id: 'sale-b', idempotencyKey: 'legacy-b', status: 'FAILED', attemptCount: 2 }),
    ]);
    expect(storage.getItem('pharmacystock:outbox:v1:operations')).toBeNull();
  });

  it('imports a legacy write created after the first migration marker', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const initial = store(factory, storage, 'outbox-late-legacy-write');
    await initial.ready();

    storage.setItem('pharmacystock:outbox:v1:operations', JSON.stringify({
      version: 1,
      operations: [{
        ...operation('late-sale', 'late-legacy-key', '2026-09-20T12:03:00.000Z'),
        status: 'PENDING',
        attemptCount: 0,
      }],
    }));

    const migrated = store(factory, storage, 'outbox-late-legacy-write');
    await migrated.ready();
    expect(migrated.list()[0]).toMatchObject({ id: 'late-sale', idempotencyKey: 'late-legacy-key' });
    expect(storage.getItem('pharmacystock:outbox:v1:operations')).toBeNull();
  });

  it('keeps replaceAll, removeSynced, and clear atomic and ordered', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const outbox = store(factory, storage, 'outbox-bulk-behavior');
    await outbox.replaceAll([
      { ...operation('sale-b', 'key-b', '2026-09-20T12:02:00.000Z'), status: 'SYNCED', attemptCount: 1 },
      { ...operation('sale-a', 'key-a', '2026-09-20T12:01:00.000Z'), status: 'PENDING', attemptCount: 0 },
    ]);
    expect(outbox.list().map((item) => item.id)).toEqual(['sale-a', 'sale-b']);

    await outbox.removeSynced();
    expect(outbox.list().map((item) => item.id)).toEqual(['sale-a']);

    await outbox.clear();
    expect(outbox.list()).toEqual([]);
  });
});
