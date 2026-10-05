import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation, type OutboxStoreOptions } from './outbox';
import { OfflineSessionScope } from './sessionScope';
import type { KeyValueStorage } from './storage';

const globalKey = 'pharmacystock:outbox:v1:operations';
const ownerKey = 'pharmacystock:offline-scope:v1:user-id';
const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a';
const stateKey = 'pharmacystock:outbox:v2:key-value-state';
const now = new Date('2026-10-04T12:00:00.000Z');
const paths = ['idb-global', 'idb-vault', 'kv-global'] as const;
type RecoveryPath = typeof paths[number];

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}
function operation(id = 'sale-a'): OutboxOperation {
  return {
    id, kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
    idempotencyKey: `stable-${id}`, createdAt: '2026-10-04T11:00:00.000Z',
    status: 'PENDING', attemptCount: 0,
    payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: id, lines: [], payments: [], customerId: null },
  };
}
function optionsFor(path: RecoveryPath): OutboxStoreOptions {
  return path === 'kv-global' ? {} : { indexedDB: new IDBFactory(), databaseName: 'legacy-envelope-regression' };
}
function seed(storage: KeyValueStorage, path: RecoveryPath, entries: unknown[], owner: string | null = 'user-a') {
  if (owner !== null) storage.setItem(ownerKey, owner);
  const key = path === 'idb-vault' ? vaultKey : globalKey;
  const raw = JSON.stringify(path === 'idb-vault' ? { operations: entries } : { version: 1, operations: entries });
  storage.setItem(key, raw);
  return { key, raw };
}
async function recover(path: RecoveryPath, entries: unknown[], owner: string | null = 'user-a', target = 'user-a') {
  const storage = memoryStorage();
  const source = seed(storage, path, entries, owner);
  const options = optionsFor(path);
  const scope = new OfflineSessionScope(storage, options);
  const outbox = new OutboxStore(storage, options);
  await scope.bindUser(target);
  await outbox.refresh(target);
  return { storage, ...source, scope, outbox, options };
}

const malformedFields: { name: string; patch: Record<string, unknown> }[] = [
  { name: 'missing idempotencyKey', patch: { idempotencyKey: undefined } },
  { name: 'empty idempotencyKey', patch: { idempotencyKey: '' } },
  { name: 'blank idempotencyKey', patch: { idempotencyKey: '  ' } },
  { name: 'numeric idempotencyKey', patch: { idempotencyKey: 12 } },
  { name: 'missing id', patch: { id: undefined } },
  { name: 'blank id', patch: { id: '  ' } },
  { name: 'missing branch', patch: { branchId: undefined } },
  { name: 'blank branch', patch: { branchId: '  ' } },
  { name: 'numeric branch', patch: { branchId: 12 } },
  { name: 'null branch', patch: { branchId: null } },
  { name: 'missing organization', patch: { organizationId: undefined } },
  { name: 'blank organization', patch: { organizationId: '  ' } },
  { name: 'numeric organization', patch: { organizationId: 12 } },
  { name: 'null organization', patch: { organizationId: null } },
  { name: 'payload branch mismatch', patch: { payload: { ...operation().payload as object, branchId: 'branch-b' } } },
  { name: 'payload organization mismatch', patch: { payload: { ...operation().payload as object, organizationId: 'org-b' } } },
  { name: 'payload branch wrong type', patch: { payload: { ...operation().payload as object, branchId: 12 } } },
  { name: 'invalid createdAt', patch: { createdAt: 'not-a-date' } },
  { name: 'missing createdAt', patch: { createdAt: undefined } },
  { name: 'numeric createdAt', patch: { createdAt: 12 } },
  { name: 'unknown kind', patch: { kind: 'OTHER' } },
  { name: 'unknown status', patch: { status: 'READY' } },
  { name: 'missing payload', patch: { payload: undefined } },
  { name: 'null payload', patch: { payload: null } },
  { name: 'array payload', patch: { payload: [] } },
  { name: 'string payload', patch: { payload: 'sale' } },
  { name: 'fractional attemptCount', patch: { attemptCount: 0.5 } },
  { name: 'unsafe attemptCount', patch: { attemptCount: Number.MAX_SAFE_INTEGER + 1 } },
  { name: 'string attemptCount', patch: { attemptCount: '1' } },
  { name: 'invalid nextAttemptAt', patch: { nextAttemptAt: 'not-a-date' } },
  { name: 'numeric lastErrorCode', patch: { lastErrorCode: 12 } },
  { name: 'numeric serverId', patch: { serverId: 12 } },
  { name: 'SYNCING missing lastAttemptAt', patch: { status: 'SYNCING', attemptCount: 1 } },
  { name: 'SYNCING invalid lastAttemptAt', patch: { status: 'SYNCING', attemptCount: 1, lastAttemptAt: 'not-a-date' } },
];

for (const path of paths) {
  describe(`${path} canonical envelope recovery`, () => {
    it.each(malformedFields)('rejects $name and retains exact source through restart/account switches', async ({ patch }) => {
      const h = await recover(path, [{ ...operation(), ...patch }]);
      expect(h.outbox.list()).toEqual([]);
      expect(h.outbox.pending(now)).toEqual([]);
      expect(h.storage.getItem(h.key)).toBe(h.raw);
      const restartedScope = new OfflineSessionScope(h.storage, h.options);
      const restartedOutbox = new OutboxStore(h.storage, h.options);
      for (const user of ['user-b', 'user-a']) {
        await restartedScope.bindUser(user);
        await restartedOutbox.refresh(user);
        expect(restartedOutbox.list()).toEqual([]);
        expect(h.storage.getItem(h.key)).toBe(h.raw);
      }
      expect(h.storage.getItem(ownerKey)).toBe('user-a');
    });

    it.each([true, false])('preserves mixed-source policy, malformed first=%s', async (malformedFirst) => {
      const valid = operation('valid');
      const malformed = { ...operation('bad'), idempotencyKey: '  ' };
      const h = await recover(path, malformedFirst ? [malformed, valid] : [valid, malformed]);
      expect(h.outbox.list()).toEqual(path === 'kv-global' ? [] : [valid]);
      expect(h.storage.getItem(h.key)).toBe(h.raw);
      const retry = new OutboxStore(h.storage, h.options);
      await retry.refresh('user-a');
      expect(retry.list()).toEqual(path === 'kv-global' ? [] : [valid]);
      expect(h.storage.getItem(h.key)).toBe(h.raw);
    });

    it.each(['PENDING', 'FAILED', 'CONFLICT', 'SYNCED', 'SYNCING'] as const)(
      'preserves historical %s envelope and empty payload compatibility', async (status) => {
        const source = {
          ...operation(), payload: {}, status,
          ...(status === 'SYNCING' ? { attemptCount: 1, lastAttemptAt: now.toISOString() } : {}),
        };
        const h = await recover(path, [source]);
        // Per-user vault restoration resets valid SYNCING. Global import does
        // not change its timing/state while the recorded owner is unchanged.
        const expected = path === 'idb-vault' && status === 'SYNCING' ? { ...source, status: 'PENDING' } : source;
        expect(h.outbox.list()).toEqual([expected]);
        if (path === 'kv-global') await h.outbox.update(source.id, {}, 'user-a');
        expect(h.storage.getItem(h.key)).toBeNull();
      },
    );

    it('preserves full valid identity across A/B/A and restart', async () => {
      const valid = operation();
      const h = await recover(path, [valid]);
      await h.scope.bindUser('user-b');
      await h.outbox.refresh('user-b');
      expect(h.outbox.list()).toEqual([]);
      const restart = new OfflineSessionScope(h.storage, h.options);
      await restart.bindUser('user-a');
      const outbox = new OutboxStore(h.storage, h.options);
      await outbox.refresh('user-a');
      expect(outbox.list()).toEqual([valid]);
      expect(outbox.list()[0]?.idempotencyKey).toBe(valid.idempotencyKey);
    });
  });
}

for (const path of ['idb-global', 'idb-vault'] as const) {
  describe(`${path} partial recovery and immutable conflicts`, () => {
    it.each([true, false])('does not erase a malformed same-key sibling, malformed first=%s', async (malformedFirst) => {
      const valid = operation('valid');
      const malformed = { ...operation('bad'), idempotencyKey: valid.idempotencyKey, branchId: undefined };
      const independent = operation('independent');
      const entries = malformedFirst ? [malformed, valid, independent] : [valid, malformed, independent];
      const h = await recover(path, entries);
      expect(h.outbox.list()).toEqual([independent]);
      expect(h.storage.getItem(h.key)).toBe(h.raw);
    });

    it('detects conflicts between valid siblings and recovers only independent keys', async () => {
      const valid = operation('valid');
      const conflict = { ...operation('conflict'), idempotencyKey: valid.idempotencyKey, payload: { changed: true } };
      const independent = operation('independent');
      const h = await recover(path, [valid, conflict, independent]);
      expect(h.outbox.list()).toEqual([independent]);
      expect(h.storage.getItem(h.key)).toBe(h.raw);
    });

    it('collapses identical immutable retries with the original key', async () => {
      const valid = operation('valid');
      const copy = { ...valid, id: 'copy' };
      const h = await recover(path, [valid, copy]);
      expect(h.outbox.list()).toHaveLength(1);
      expect(h.outbox.list()[0]?.idempotencyKey).toBe(valid.idempotencyKey);
      expect(h.storage.getItem(h.key)).toBeNull();
    });
  });
}

async function writeMetadata(factory: IDBFactory, name: string, value: unknown) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('metadata', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore('metadata').put(value);
    });
  } finally { database.close(); }
}

it.each([true, false])('revalidates an old safeToDelete marker with ownershipProven=%s', async (ownershipProven) => {
  const storage = memoryStorage();
  const factory = new IDBFactory();
  const options = { indexedDB: factory, databaseName: 'cached-cleanup-regression' };
  const outbox = new OutboxStore(storage, options);
  await outbox.transitionOwner(null, 'user-a');
  const raw = JSON.stringify({ operations: [{ ...operation(), idempotencyKey: '  ' }] });
  storage.setItem(vaultKey, raw);
  await writeMetadata(factory, options.databaseName, {
    key: 'legacy-session-vault-v1:quarantine:user-a', raw, safeToDelete: true,
  });
  expect(await outbox.importLegacyVault('user-a', raw, { ownershipProven })).toBe(false);
  await new OfflineSessionScope(storage, options).bindUser('user-a');
  await outbox.refresh('user-a');
  expect(outbox.list()).toEqual([]);
  expect(storage.getItem(vaultKey)).toBe(raw);
});

for (const path of ['idb-global', 'kv-global'] as const) {
  describe(`${path} global owner isolation`, () => {
    it('keeps valid foreign-owner work inactive until its owner returns', async () => {
      const valid = operation();
      const h = await recover(path, [valid], 'user-a', 'user-b');
      expect(h.outbox.list()).toEqual([]);
      await h.scope.bindUser('user-a');
      await h.outbox.refresh('user-a');
      expect(h.outbox.list()).toEqual([valid]);
    });

    it.each([true, false])('keeps ownerless source isolated, malformed=%s', async (malformed) => {
      const h = await recover(path, [{ ...operation(), ...(malformed ? { branchId: undefined } : {}) }], null);
      for (const user of ['user-a', 'user-b', 'user-a']) {
        await h.scope.bindUser(user);
        await h.outbox.refresh(user);
        expect(h.outbox.list()).toEqual([]);
      }
      if (malformed) {
        expect(h.storage.getItem(h.key)).toBe(h.raw);
        expect(h.storage.getItem(ownerKey)).toBeNull();
      }
    });
  });
}

it('keeps a foreign per-user malformed vault untouched', async () => {
  const h = await recover('idb-vault', [{ ...operation(), branchId: undefined }], 'user-a', 'user-b');
  expect(h.outbox.list()).toEqual([]);
  expect(h.storage.getItem(h.key)).toBe(h.raw);
  await h.scope.bindUser('user-a');
  await h.outbox.refresh('user-a');
  expect(h.outbox.list()).toEqual([]);
  expect(h.storage.getItem(h.key)).toBe(h.raw);
});

it.each(['{broken', 'null', '{}', '{"version":1,"operations":[null]}'])('kv-global retains malformed container %s through mutations', async (raw) => {
  const storage = memoryStorage();
  storage.setItem(globalKey, raw);
  storage.setItem(ownerKey, 'user-a');
  const scope = new OfflineSessionScope(storage);
  await scope.bindUser('user-b');
  const outbox = new OutboxStore(storage);
  await outbox.refresh('user-b');
  await outbox.enqueue(operation('new-user-b-operation'), 'user-b');
  expect(storage.getItem(globalKey)).toBe(raw);
  expect(storage.getItem(ownerKey)).toBe('user-a');
  expect(await outbox.owner()).toBe('user-b');
});

it('kv-global preserves source replacement during v2 commit and subsequent owner changes', async () => {
  const base = memoryStorage();
  const original = operation();
  seed(base, 'kv-global', [original]);
  const replacement = JSON.stringify({ version: 1, operations: [operation('late')] });
  let replaced = false;
  const storage: KeyValueStorage = {
    ...base,
    setItem: (key, value) => {
      base.setItem(key, value);
      if (key === stateKey && !replaced) {
        replaced = true;
        base.setItem(globalKey, replacement);
      }
    },
  };
  const outbox = new OutboxStore(storage);
  await outbox.refresh('user-a');
  await outbox.update(original.id, { status: 'CONFLICT', lastErrorCode: 'INSUFFICIENT_STOCK' }, 'user-a');
  expect(storage.getItem(globalKey)).toBe(replacement);
  const restartedScope = new OfflineSessionScope(storage);
  for (const user of ['user-b', 'user-a']) {
    await restartedScope.bindUser(user);
    await outbox.refresh(user);
    expect(storage.getItem(globalKey)).toBe(replacement);
    expect(storage.getItem(ownerKey)).toBe('user-a');
  }
  expect(outbox.list()).toEqual([{ ...original, status: 'CONFLICT', lastErrorCode: 'INSUFFICIENT_STOCK' }]);
});

it('kv-global retains a source whose recorded owner changes during commit', async () => {
  const base = memoryStorage();
  const { raw } = seed(base, 'kv-global', [operation()]);
  const storage: KeyValueStorage = {
    ...base,
    setItem: (key, value) => {
      base.setItem(key, value);
      if (key === stateKey) base.setItem(ownerKey, 'user-b');
    },
  };
  const outbox = new OutboxStore(storage);
  await outbox.update('sale-a', {}, 'user-a');
  expect(storage.getItem(globalKey)).toBe(raw);
  expect(storage.getItem(ownerKey)).toBe('user-b');
});

it('kv-global never cleans an unconsumed late source during an unrelated v2 write', async () => {
  const storage = memoryStorage();
  const scope = new OfflineSessionScope(storage);
  await scope.bindUser('user-b');
  const { raw } = seed(storage, 'kv-global', [operation()]);
  const outbox = new OutboxStore(storage);
  await outbox.enqueue(operation('user-b'), 'user-b');
  expect(storage.getItem(globalKey)).toBe(raw);
  expect(storage.getItem(ownerKey)).toBe('user-a');
});

it('kv-global retries cleanup after restart without reactivating a synced/removed operation', async () => {
  const base = memoryStorage();
  const { raw } = seed(base, 'kv-global', [operation()]);
  let failCleanup = true;
  const storage: KeyValueStorage = {
    ...base,
    removeItem: (key) => {
      if (key === globalKey && failCleanup) throw new Error('cleanup interrupted');
      base.removeItem(key);
    },
  };
  const outbox = new OutboxStore(storage);
  await outbox.update('sale-a', { status: 'SYNCED' }, 'user-a');
  await outbox.removeSynced();
  expect(storage.getItem(globalKey)).toBe(raw);
  expect(outbox.list()).toEqual([]);
  await new OfflineSessionScope(storage).bindUser('user-b');
  expect(storage.getItem(ownerKey)).toBe('user-a');
  failCleanup = false;
  const restarted = new OutboxStore(storage);
  await restarted.clear();
  expect(storage.getItem(globalKey)).toBeNull();
  await new OfflineSessionScope(storage).bindUser('user-a');
  await restarted.refresh('user-a');
  expect(restarted.list()).toEqual([]);
});

it('kv-global retains a valid source on commit failure, then consumes it exactly once', async () => {
  const base = memoryStorage();
  const { raw } = seed(base, 'kv-global', [operation()]);
  let failCommit = true;
  const storage: KeyValueStorage = {
    ...base,
    setItem: (key, value) => {
      if (key === stateKey && failCommit) throw new Error('commit interrupted');
      base.setItem(key, value);
    },
  };
  const outbox = new OutboxStore(storage);
  await expect(outbox.update('sale-a', {}, 'user-a')).rejects.toThrow('commit interrupted');
  expect(storage.getItem(globalKey)).toBe(raw);
  expect(storage.getItem(stateKey)).toBeNull();
  failCommit = false;
  await outbox.update('sale-a', {}, 'user-a');
  expect(storage.getItem(globalKey)).toBeNull();
  expect(outbox.list()).toEqual([operation()]);
});

// Test the actual app replay boundary, while mocking every server/auth service.
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
for (const path of paths) {
  describe(`${path} actual sale replay recovery`, () => {
    it.each([
      ...malformedFields.filter(({ name }) => ['missing idempotencyKey', 'blank idempotencyKey', 'missing branch',
        'payload branch mismatch', 'payload organization mismatch', 'invalid createdAt'].includes(name)),
      { name: 'valid identity and scope', patch: {} },
    ])('only submits a valid recovered envelope: $name', async ({ name, patch }) => {
      vi.resetModules();
      const storage = memoryStorage();
      const source = seed(storage, path, [{ ...operation(), ...patch }]);
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('indexedDB', path === 'kv-global' ? undefined : new IDBFactory());
      vi.stubGlobal('navigator', {});
      const completeSale = vi.fn(async (_input: unknown) => 'mock-server-sale');
      const loadInventoryBalances = vi.fn(async (_organizationId: string, _branchId: string) => []);
      const session = async () => ({ data: { session: { user: { id: 'user-a' }, expires_at: now.getTime() / 1000 + 3600 } }, error: null });
      vi.doMock('../services/sales', () => ({ completeSale }));
      vi.doMock('../services/inventory', () => ({ loadInventoryBalances }));
      vi.doMock('../lib/supabase', () => ({ supabase: { auth: { getSession: session, refreshSession: session } } }));
      const { offlineSessionScope } = await import('./sessionScope');
      const { OutboxStore: Store } = await import('./outbox');
      const { replayPendingSales } = await import('./offlinePos');
      await offlineSessionScope.bindUser('user-a');
      const outbox = new Store();
      const valid = name === 'valid identity and scope';
      const result = await replayPendingSales(outbox, { expectedOwnerId: 'user-a', now: () => now });
      expect(result).toEqual({ synced: valid ? 1 : 0, conflicts: 0, failed: 0 });
      if (valid) {
        expect(loadInventoryBalances.mock.calls).toEqual([['org-a', 'branch-a']]);
        expect(completeSale).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          organizationId: 'org-a', branchId: 'branch-a', idempotencyKey: 'stable-sale-a',
        }));
        expect(storage.getItem(source.key)).toBeNull();
      } else {
        expect(completeSale).not.toHaveBeenCalled();
        expect(loadInventoryBalances).not.toHaveBeenCalled();
        expect(storage.getItem(source.key)).toBe(source.raw);
      }
    });
  });
}
