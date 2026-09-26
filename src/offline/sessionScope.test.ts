import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import { OutboxStore } from './outbox';
import { OfflineSessionScope } from './sessionScope';
import type { KeyValueStorage } from './storage';
import { SyncCoordinator } from './sync';

function indexedOutbox(factory: IDBFactory, storage: KeyValueStorage, databaseName: string) {
  return new OutboxStore(storage, { indexedDB: factory, databaseName });
}

function pendingOperation(id: string, user: string) {
  return {
    id,
    kind: 'SALE',
    organizationId: `org-${user}`,
    idempotencyKey: `key-${id}`,
    payload: { saleNumber: id },
    createdAt: `2026-09-20T12:0${id.length}:00.000Z`,
  };
}

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

async function seedScopedState(storage: KeyValueStorage) {
  new LocalStore(storage).set('core:customers:org-a', {
    data: [{ id: 'customer-a' }],
    syncedAt: '2026-08-23T18:00:00.000Z',
  });
  await new OutboxStore(storage).enqueue({
    id: 'sale-a',
    kind: 'SALE',
    organizationId: 'org-a',
    idempotencyKey: 'sale-key-a',
    payload: {},
    createdAt: '2026-08-23T18:01:00.000Z',
  });
}

describe('offline session scope', () => {
  it('clears cached replica data on sign-out while restoring unsynced intents for the same user', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    await scope.bindUser('user-a');
    await seedScopedState(storage);

    await scope.bindUser(null);
    await scope.bindUser(null);

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const signedOut = new OutboxStore(storage);
    await signedOut.ready();
    expect(signedOut.list()).toEqual([]);

    await scope.bindUser('user-a');
    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const restored = new OutboxStore(storage);
    await restored.ready();
    expect(restored.list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('isolates stale user and organization data while preserving the original user intent', async () => {
    const storage = memoryStorage();
    const firstSession = new OfflineSessionScope(storage);
    await firstSession.bindUser('user-a');
    await seedScopedState(storage);

    await new OfflineSessionScope(storage).bindUser('user-b');

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const userBOutbox = new OutboxStore(storage);
    await userBOutbox.ready();
    expect(userBOutbox.list()).toEqual([]);

    await new OfflineSessionScope(storage).bindUser('user-a');
    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const userAOutbox = new OutboxStore(storage);
    await userAOutbox.ready();
    expect(userAOutbox.list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('clears unowned legacy data on the first authenticated bind after upgrade', async () => {
    const storage = memoryStorage();
    await seedScopedState(storage);

    await new OfflineSessionScope(storage).bindUser('user-a');

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const outbox = new OutboxStore(storage);
    await outbox.ready();
    expect(outbox.list()).toEqual([]);
  });

  it('preserves state when the same authenticated user is rebound after restart', async () => {
    const storage = memoryStorage();
    const firstSession = new OfflineSessionScope(storage);
    await firstSession.bindUser('user-a');
    await seedScopedState(storage);

    await new OfflineSessionScope(storage).bindUser('user-a');

    expect(new LocalStore(storage).get('core:customers:org-a')).not.toBeNull();
    const outbox = new OutboxStore(storage);
    await outbox.ready();
    expect(outbox.list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('preserves pending and conflicted intents through a user switch', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    await scope.bindUser('user-a');
    await seedScopedState(storage);
    const outbox = new OutboxStore(storage);
    await outbox.enqueue({
      id: 'sale-conflict',
      kind: 'SALE',
      organizationId: 'org-a',
      idempotencyKey: 'conflict-key-a',
      payload: {},
      createdAt: '2026-08-23T18:02:00.000Z',
    });
    await outbox.update('sale-conflict', { status: 'CONFLICT', lastErrorCode: 'INSUFFICIENT_STOCK' });

    await scope.bindUser('user-b');
    const userBOutbox = new OutboxStore(storage);
    await userBOutbox.ready();
    expect(userBOutbox.list()).toEqual([]);

    await scope.bindUser('user-a');
    const userAOutbox = new OutboxStore(storage);
    await userAOutbox.ready();
    expect(userAOutbox.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'PENDING', idempotencyKey: 'sale-key-a' }),
      expect.objectContaining({ status: 'CONFLICT', idempotencyKey: 'conflict-key-a' }),
    ]));
  });

  it('serializes an enqueue concurrent with an account switch without loss or cross-user leakage', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-enqueue-switch-race';
    const scope = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    const outbox = indexedOutbox(factory, storage, databaseName);
    await scope.bindUser('user-a');
    await outbox.enqueue(pendingOperation('sale-a', 'a'), 'user-a');

    const enqueue = outbox.enqueue(pendingOperation('sale-race', 'a'), 'user-a');
    await Promise.resolve();
    const switching = scope.bindUser('user-b');
    await Promise.all([enqueue, switching]);

    await outbox.refresh();
    expect(await outbox.owner()).toBe('user-b');
    expect(outbox.list()).toEqual([]);
    await expect(outbox.enqueue(pendingOperation('stale-a', 'a'), 'user-a')).rejects.toMatchObject({
      message: 'OUTBOX_OWNER_CHANGED',
    });

    await scope.bindUser('user-a');
    await outbox.refresh();
    expect(outbox.list().map((operation) => operation.id)).toEqual(['sale-a', 'sale-race']);
  });

  it('imports a pre-existing localStorage user vault before restoring that user', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-legacy-user-vault';
    const userAOperation = { ...pendingOperation('sale-a', 'a'), status: 'PENDING' as const, attemptCount: 0 };
    const userBOperation = { ...pendingOperation('sale-b', 'b'), status: 'PENDING' as const, attemptCount: 0 };
    storage.setItem('pharmacystock:offline-scope:v1:user-id', 'user-a');
    storage.setItem('pharmacystock:outbox:v1:operations', JSON.stringify({
      version: 1,
      operations: [userAOperation],
    }));
    const userBVaultKey = 'pharmacystock:offline-scope:v1:vault:user-b';
    storage.setItem(userBVaultKey, JSON.stringify({ operations: [userBOperation] }));

    const scope = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    const outbox = indexedOutbox(factory, storage, databaseName);
    await scope.bindUser('user-b');
    await outbox.refresh();
    expect(await outbox.owner()).toBe('user-b');
    expect(outbox.list()).toEqual([userBOperation]);
    expect(storage.getItem(userBVaultKey)).toBeNull();

    await scope.bindUser('user-a');
    await outbox.refresh();
    expect(outbox.list()).toEqual([userAOperation]);
  });

  it('retains an ambiguous current-owner legacy vault without replaying or deleting it', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-stale-current-user-vault';
    const staleOperation = { ...pendingOperation('already-synced', 'a'), status: 'PENDING' as const, attemptCount: 0 };
    storage.setItem('pharmacystock:offline-scope:v1:user-id', 'user-a');
    const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a';
    storage.setItem(vaultKey, JSON.stringify({ operations: [staleOperation] }));

    const scope = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    const outbox = indexedOutbox(factory, storage, databaseName);
    await scope.bindUser('user-a');
    await outbox.refresh();

    expect(await outbox.owner()).toBe('user-a');
    expect(outbox.list()).toEqual([]);
    expect(storage.getItem(vaultKey)).not.toBeNull();

    await scope.bindUser('user-b');
    await scope.bindUser('user-a');
    await outbox.refresh();
    expect(outbox.list()).toEqual([]);
    expect(storage.getItem(vaultKey)).not.toBeNull();
  });

  it('removes a current-owner legacy vault only when every operation is already active and identical', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-redundant-current-user-vault';
    const operation = { ...pendingOperation('sale-a', 'a'), status: 'PENDING' as const, attemptCount: 0 };
    storage.setItem('pharmacystock:offline-scope:v1:user-id', 'user-a');
    storage.setItem('pharmacystock:outbox:v1:operations', JSON.stringify({ version: 1, operations: [operation] }));
    const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a';
    storage.setItem(vaultKey, JSON.stringify({ operations: [operation] }));

    const scope = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    const outbox = indexedOutbox(factory, storage, databaseName);
    await scope.bindUser('user-a');
    await outbox.refresh();

    expect(outbox.list()).toEqual([operation]);
    expect(storage.getItem(vaultKey)).toBeNull();
  });

  it('keeps a retained malformed legacy snapshot from leaking its imported operation to another owner', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-retained-malformed-legacy-snapshot';
    const valid = { ...pendingOperation('sale-a', 'a'), status: 'PENDING' as const, attemptCount: 0 };
    const legacyKey = 'pharmacystock:outbox:v1:operations';
    storage.setItem('pharmacystock:offline-scope:v1:user-id', 'user-a');
    storage.setItem(legacyKey, JSON.stringify({
      version: 1,
      operations: [valid, { id: 'malformed-sale' }],
    }));

    const scope = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    const outbox = indexedOutbox(factory, storage, databaseName);
    await scope.bindUser('user-a');
    await outbox.refresh();
    expect(outbox.list()).toEqual([valid]);
    expect(storage.getItem(legacyKey)).not.toBeNull();

    await scope.bindUser('user-b');
    const reconstructed = indexedOutbox(factory, storage, databaseName);
    await reconstructed.ready();
    expect(await reconstructed.owner()).toBe('user-b');
    expect(reconstructed.list()).toEqual([]);
    expect(storage.getItem(legacyKey)).not.toBeNull();

    await scope.bindUser('user-a');
    await reconstructed.refresh();
    expect(reconstructed.list()).toEqual([valid]);
  });

  it('routes a late global legacy write to its recorded owner instead of the active owner', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-late-global-legacy-owner';
    const legacyKey = 'pharmacystock:outbox:v1:operations';
    const ownerKey = 'pharmacystock:offline-scope:v1:user-id';
    const userAOperation = { ...pendingOperation('late-sale-a', 'a'), status: 'PENDING' as const, attemptCount: 0 };
    storage.setItem(ownerKey, 'user-a');

    const scope = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    await scope.bindUser('user-b');
    storage.setItem(legacyKey, JSON.stringify({ version: 1, operations: [userAOperation] }));

    const reconstructed = indexedOutbox(factory, storage, databaseName);
    await reconstructed.ready();
    expect(await reconstructed.owner()).toBe('user-b');
    expect(reconstructed.list()).toEqual([]);
    expect(storage.getItem(legacyKey)).toBeNull();

    await scope.bindUser('user-a');
    await reconstructed.refresh();
    expect(reconstructed.list()).toEqual([userAOperation]);
  });

  it('serializes two tab-like account switches with deterministic ownership and isolated vaults', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-concurrent-tab-switches';
    const seeder = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    const outbox = indexedOutbox(factory, storage, databaseName);

    await seeder.bindUser('user-a');
    await outbox.enqueue(pendingOperation('sale-a', 'a'), 'user-a');
    await seeder.bindUser('user-b');
    await outbox.enqueue(pendingOperation('sale-b', 'b'), 'user-b');
    await seeder.bindUser('user-c');
    await outbox.enqueue(pendingOperation('sale-c', 'c'), 'user-c');
    await seeder.bindUser('user-a');

    const firstTab = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    const secondTab = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    await Promise.all([
      firstTab.bindUser('user-b'),
      secondTab.bindUser('user-c'),
    ]);

    await outbox.refresh();
    expect(await outbox.owner()).toBe('user-c');
    expect(outbox.list().map((operation) => operation.id)).toEqual(['sale-c']);
    expect((await firstTab.verifiedReplayScope()).userId).toBeNull();
    expect((await secondTab.verifiedReplayScope()).userId).toBe('user-c');
    const staleUserBView = indexedOutbox(factory, storage, databaseName);
    await expect(staleUserBView.refresh('user-b')).rejects.toMatchObject({
      message: 'OUTBOX_OWNER_CHANGED',
    });
    expect(staleUserBView.list()).toEqual([]);

    const verifier = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    await verifier.bindUser('user-b');
    await outbox.refresh();
    expect(outbox.list().map((operation) => operation.id)).toEqual(['sale-b']);
    await verifier.bindUser('user-a');
    await outbox.refresh();
    expect(outbox.list().map((operation) => operation.id)).toEqual(['sale-a']);
  });

  it('aborts an interrupted scope transition and retries without losing operations', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-interrupted-transition';
    let failAfterClear = false;
    const scope = new OfflineSessionScope(storage, {
      indexedDB: factory,
      databaseName,
      transitionHook: (point) => {
        if (failAfterClear && point === 'after-clear') throw new Error('simulated transition interruption');
      },
    });
    const outbox = indexedOutbox(factory, storage, databaseName);
    await scope.bindUser('user-a');
    await outbox.enqueue(pendingOperation('sale-a', 'a'), 'user-a');

    failAfterClear = true;
    await expect(scope.bindUser('user-b')).rejects.toThrow('simulated transition interruption');
    await outbox.refresh();
    expect(await outbox.owner()).toBe('user-a');
    expect(outbox.list().map((operation) => operation.id)).toEqual(['sale-a']);

    failAfterClear = false;
    await scope.bindUser('user-b');
    await outbox.refresh();
    expect(await outbox.owner()).toBe('user-b');
    expect(outbox.list()).toEqual([]);
    await scope.bindUser('user-a');
    await outbox.refresh();
    expect(outbox.list().map((operation) => operation.id)).toEqual(['sale-a']);
  });

  it('stops replay safely when another tab changes the active owner', async () => {
    const factory = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'session-owner-change-during-replay';
    const scope = new OfflineSessionScope(storage, { indexedDB: factory, databaseName });
    const outbox = indexedOutbox(factory, storage, databaseName);
    await scope.bindUser('user-a');
    await outbox.enqueue(pendingOperation('sale-a', 'a'), 'user-a');

    const coordinator = new SyncCoordinator(outbox, {
      SALE: async () => {
        await new OfflineSessionScope(storage, { indexedDB: factory, databaseName }).bindUser('user-b');
        return { status: 'SYNCED', serverId: 'server-sale-a' };
      },
    }, { expectedOwnerId: 'user-a' });

    await expect(coordinator.replayPending()).resolves.toEqual({ synced: 0, conflicts: 0, failed: 0 });
    await outbox.refresh();
    expect(await outbox.owner()).toBe('user-b');
    expect(outbox.list()).toEqual([]);

    await scope.bindUser('user-a');
    await outbox.refresh();
    expect(outbox.list()).toEqual([
      expect.objectContaining({ id: 'sale-a', idempotencyKey: 'key-sale-a', status: 'PENDING' }),
    ]);
  });
});
