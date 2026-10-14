import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { isRecoverableLegacyOperation, stableOutboxSerialize } from './outboxRecovery';
import { prePr89OutboxV2Fixture } from './testFixtures/prePr89OutboxV2';
import type { KeyValueStorage } from './storage';
import { persistedQuarantine, quarantineOperationRecords } from './outboxRecoveryTestUtils';

// Fixed-behavior regressions; original observations retained in .investigation/.
// Tracked historical persistence fixtures describe 622ecc7 (main before PR #89).
const globalKey = 'pharmacystock:outbox:v1:operations';
const ownerKey = 'pharmacystock:offline-scope:v1:user-id';
const stateKey = 'pharmacystock:outbox:v2:key-value-state';
const vaultKey = 'pharmacystock:offline-scope:v1:vault:user-a';
const now = new Date('2026-10-04T12:00:00.000Z');

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}
function sale(id = 'sale-a'): OutboxOperation {
  return {
    id, kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
    idempotencyKey: 'stable-sale-a', status: 'PENDING', attemptCount: 0,
    createdAt: '2026-10-04T11:00:00.000Z',
    payload: {
      organizationId: 'org-a', branchId: 'branch-a', saleNumber: 'SALE-A',
      lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ payment_type: 'CASH', amount: 10 }], customerId: null,
      localReceiptNumber: 'SALE-A', quotedTotal: 10, quoteSyncedAt: '2026-10-04T10:00:00.000Z',
    },
  };
}
function seedGlobal(storage: KeyValueStorage, entries: unknown[]) {
  const raw = JSON.stringify({ version: 1, operations: entries });
  storage.setItem(ownerKey, 'user-a');
  storage.setItem(globalKey, raw);
  return raw;
}
async function replayHarness(storage: KeyValueStorage, factory?: IDBFactory) {
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('navigator', {});
  let authUserId = 'user-a';
  const completeSale = vi.fn(async (_input: unknown) => 'same-first-server-sale');
  const loadInventoryBalances = vi.fn(async (_organizationId: string, _branchId: string) => []);
  const session = async () => ({
    data: { session: { user: { id: authUserId }, expires_at: now.getTime() / 1000 + 3600 } }, error: null,
  });
  vi.doMock('../services/sales', () => ({ completeSale }));
  vi.doMock('../services/inventory', () => ({ loadInventoryBalances }));
  const getSession = vi.fn(session);
  vi.doMock('../lib/supabase', () => ({ supabase: { auth: { getSession, refreshSession: session } } }));
  const { offlineSessionScope: scope } = await import('./sessionScope');
  const { OutboxStore: Store } = await import('./outbox');
  const { replayPendingSales } = await import('./offlinePos');
  const outbox = new Store();
  return {
    scope, outbox, Store, completeSale, loadInventoryBalances, getSession, session,
    bind: async (owner: string) => { authUserId = owner; await scope.bindUser(owner); await outbox.refresh(owner); },
    replay: () => replayPendingSales(outbox, { expectedOwnerId: authUserId, now: () => now }),
  };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function seedIdbV2(factory: IDBFactory, operation: unknown, vaulted: boolean) {
  // Initialize schema only, then seed exact persisted bytes as an old/untrusted v2 writer could.
  const initialized = new OutboxStore(memoryStorage(), { indexedDB: factory });
  await initialized.ready();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(['operations', 'vaultOperations', 'metadata'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.objectStore('metadata').put({ key: 'active-owner', userId: vaulted ? 'user-b' : 'user-a' });
      tx.objectStore(vaulted ? 'vaultOperations' : 'operations').put(vaulted
        ? { ...operation as object, ownerId: 'user-a' } : operation);
    });
  } finally { database.close(); }
}


// Reproduce the old writer's durable post-import/post-owner-switch state. This
// bypasses current import validation while retaining historical IDB receipts.
async function seedPrePr89ImportedV2(storage: KeyValueStorage, operation: OutboxOperation, factory?: IDBFactory) {
  const fixture = prePr89OutboxV2Fixture(operation);
  if (!factory) {
    storage.setItem(stateKey, JSON.stringify(fixture.keyValueState));
    storage.setItem(ownerKey, 'user-b');
    expect(JSON.parse(storage.getItem(stateKey)!)).toEqual(fixture.keyValueState);
    return;
  }
  // The supported tracked helper initializes schema and seeds the vaulted row.
  await seedIdbV2(factory, operation, true);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    let stored: unknown;
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(['vaultOperations', 'metadata'], 'readwrite');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      const vaulted = tx.objectStore('vaultOperations').get(['user-a', operation.id]);
      vaulted.onsuccess = () => { stored = vaulted.result; };
      for (const receipt of fixture.metadata) tx.objectStore('metadata').put(receipt);
    });
    expect(stored).toEqual(fixture.vaultOperation);
  } finally { database.close(); }
  // Old IndexedDB owner transitions update metadata, leaving this compatibility
  // key at the original source owner. There is no surviving global v1 source.
  storage.setItem(ownerKey, 'user-a');
}

describe('same-key recovery fix regressions', () => {
  it('KV global collapses identical retries and submits the unchanged key once', async () => {
    const storage = memoryStorage();
    const first = sale();
    seedGlobal(storage, [first, { ...first, id: 'sale-b' }]);
    const h = await replayHarness(storage);
    await h.bind('user-a');
    expect(h.outbox.pending(now)).toEqual([first]);
    expect(await h.replay()).toEqual({ synced: 1, conflicts: 0, failed: 0 });
    expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.completeSale).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ idempotencyKey: first.idempotencyKey }), expect.objectContaining({ outbox: expect.any(Object), canReplay: expect.any(Function) }));
    expect(storage.getItem(globalKey)).toBeNull();
  });

  it.each(['kv-global', 'kv-vault', 'idb-global', 'idb-vault'] as const)(
    '%s retains a three-member conflicting source through writes, A/B/A and restart', async (path) => {
      const storage = memoryStorage();
      const factory = path.startsWith('idb') ? new IDBFactory() : undefined;
      const first = sale();
      const entries = [first, { ...first, id: 'same-copy' }, {
        ...first, id: 'conflicting', payload: { ...first.payload as object, saleNumber: 'SALE-B' },
      }];
      const key = path.endsWith('global') ? globalKey : vaultKey;
      const raw = JSON.stringify(path.endsWith('global') ? { version: 1, operations: entries } : { operations: entries });
      storage.setItem(key, raw);
      storage.setItem(ownerKey, 'user-a');
      const h = await replayHarness(storage, factory);
      await h.bind('user-a');
      expect(h.outbox.list()).toEqual([]);
      await h.outbox.clear();
      expect(storage.getItem(key)).toBe(raw);
      for (const owner of ['user-b', 'user-a']) {
        await h.bind(owner);
        expect(h.outbox.list()).toEqual([]);
        expect(storage.getItem(key)).toBe(raw);
      }
      const restart = await replayHarness(storage, factory);
      await restart.bind('user-a');
      expect(await restart.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
      expect(restart.completeSale).not.toHaveBeenCalled();
      expect(storage.getItem(key)).toBe(raw);
    },
  );

  it('KV conflicting cleanup receipt never authorizes source deletion', async () => {
    const storage = memoryStorage();
    const first = sale();
    const raw = seedGlobal(storage, [first, { ...first, id: 'sale-b', payload: { changed: true } }]);
    storage.setItem(stateKey, JSON.stringify({
      version: 2, ownerId: 'user-a', operations: [], vaults: {},
      legacyGlobalRecovery: { raw, ownerId: 'user-a' },
    }));
    await new OutboxStore(storage).clear();
    expect(storage.getItem(globalKey)).toBe(raw);
  });

  it('KV already-conflicting v2 destination quarantines the entire key and retains retry source', async () => {
    const storage = memoryStorage();
    const first = sale();
    const conflicting = { ...first, id: 'sale-b', payload: { ...first.payload as object, saleNumber: 'SALE-B' } };
    const independent = { ...sale('independent'), idempotencyKey: 'independent-key' };
    storage.setItem(stateKey, JSON.stringify({
      version: 2, ownerId: 'user-a', operations: [first, conflicting, independent], vaults: {},
    }));
    const raw = JSON.stringify({ operations: [{ ...first, id: 'retry-copy' }] });
    storage.setItem(vaultKey, raw);
    const h = await replayHarness(storage);
    await h.bind('user-a');
    expect(h.outbox.list()).toEqual([independent]);
    expect(storage.getItem(vaultKey)).toBe(raw);
    await h.bind('user-b');
    await h.bind('user-a');
    expect(quarantineOperationRecords(await persistedQuarantine(storage))).toEqual(expect.arrayContaining([first, conflicting]));
    expect(await h.replay()).toEqual({ synced: 1, conflicts: 0, failed: 0 });
    expect(h.completeSale).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ idempotencyKey: 'independent-key' }), expect.objectContaining({ outbox: expect.any(Object), canReplay: expect.any(Function) }));
  });

  it.each(['kv', 'idb'] as const)('%s rejects incoming immutable conflict against destination', async (adapter) => {
    const storage = memoryStorage();
    const factory = adapter === 'idb' ? new IDBFactory() : undefined;
    const h = await replayHarness(storage, factory);
    await h.bind('user-a');
    await h.outbox.enqueue(sale(), 'user-a');
    const incoming = { ...sale('incoming'), payload: { ...sale().payload as object, saleNumber: 'OTHER' } };
    const raw = JSON.stringify({ operations: [incoming] });
    storage.setItem(vaultKey, raw);
    await h.bind('user-a');
    expect(storage.getItem(vaultKey)).toBe(raw);
    expect(h.outbox.list()).toEqual([]); // both members of the disputed key fail closed
    await h.outbox.removeSynced();
    await h.bind('user-b');
    await h.bind('user-a');
    expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(storage.getItem(vaultKey)).toBe(raw);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory })))
      .toEqual(expect.arrayContaining([sale(), incoming]));
  });
});

const malformedFields: { name: string; patch: Record<string, unknown> }[] = [
  { name: 'blank key', patch: { idempotencyKey: '  ' } },
  { name: 'missing key', patch: { idempotencyKey: undefined } },
  { name: 'org mismatch', patch: { payload: { ...sale().payload as object, organizationId: 'other' } } },
  { name: 'branch mismatch', patch: { payload: { ...sale().payload as object, branchId: 'other' } } },
  { name: 'missing branch', patch: { branchId: undefined } },
  { name: 'invalid createdAt', patch: { createdAt: 'not-a-date' } },
  { name: 'numeric createdAt', patch: { createdAt: 1 } },
  { name: 'numeric key', patch: { idempotencyKey: 1 } },
  { name: 'null payload', patch: { payload: null } },
  { name: 'invalid attempts', patch: { attemptCount: '1' } },
];
for (const adapter of ['kv', 'idb'] as const) {
  for (const vaulted of [false, true]) {
    describe(adapter + (vaulted ? ' persisted vault' : ' same-owner startup'), () => {
      it.each(malformedFields)('$name stays durable, isolated and never reaches sale replay', async ({ patch }) => {
        const storage = memoryStorage();
        const factory = adapter === 'idb' ? new IDBFactory() : undefined;
        const malformed = JSON.parse(JSON.stringify({ ...sale(), ...patch })) as OutboxOperation;
        expect(isRecoverableLegacyOperation(malformed)).toBe(false);
        if (factory) await seedIdbV2(factory, malformed, vaulted);
        else storage.setItem(stateKey, JSON.stringify({
          version: 2, ownerId: vaulted ? 'user-b' : 'user-a',
          operations: vaulted ? [] : [malformed], vaults: vaulted ? { 'user-a': [malformed] } : {},
        }));
        const h = await replayHarness(storage, factory);
        if (vaulted) {
          await h.bind('user-b');
          expect(h.outbox.list()).toEqual([]);
        }
        await h.bind('user-a');
        expect(h.outbox.list()).toEqual([]);
        expect(h.outbox.pending(now)).toEqual([]);
        expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
        expect(h.completeSale).not.toHaveBeenCalled();
        expect(h.loadInventoryBalances).not.toHaveBeenCalled();
        await expect(h.bind('user-b')).resolves.toBeUndefined(); // no missing-index DataError
        expect(h.outbox.list()).toEqual([]);
        expect(await persistedQuarantine(storage, { indexedDB: factory }, 'user-b')).toEqual([]);
        const restarted = await replayHarness(storage, factory);
        await restarted.bind('user-a');
        expect(restarted.outbox.list()).toEqual([]);
        expect(await restarted.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
        expect(restarted.completeSale).not.toHaveBeenCalled();
        const before = await persistedQuarantine(storage, { indexedDB: factory });
        expect(quarantineOperationRecords(before)).toEqual([malformed]);
        await restarted.outbox.clear();
        await restarted.outbox.removeSynced();
        await restarted.outbox.replaceAll([]);
        expect(await persistedQuarantine(storage, { indexedDB: factory })).toEqual(before);
      });
    });
  }

  it.each(['PENDING', 'FAILED', 'SYNCING', 'SYNCED'] as const)(
    adapter + ' malformed %s remains unchanged, valid independent work still replays', async (status) => {
      const storage = memoryStorage();
      const factory = adapter === 'idb' ? new IDBFactory() : undefined;
      const bad: OutboxOperation = {
        ...sale(), idempotencyKey: ' ', status,
        ...(status === 'SYNCING' ? { lastAttemptAt: now.toISOString(), attemptCount: 1 } : {}),
      };
      if (factory) await seedIdbV2(factory, bad, true);
      else storage.setItem(stateKey, JSON.stringify({ version: 2, ownerId: 'user-b', operations: [], vaults: { 'user-a': [bad] } }));
      const h = await replayHarness(storage, factory);
      await h.bind('user-a');
      expect(h.outbox.list()).toEqual([]);
      const valid = { ...sale('valid'), idempotencyKey: 'valid-key' };
      await h.outbox.enqueue(valid, 'user-a');
      expect(await h.replay()).toEqual({ synced: 1, conflicts: 0, failed: 0 });
      expect(h.completeSale).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ idempotencyKey: 'valid-key' }), expect.objectContaining({ outbox: expect.any(Object), canReplay: expect.any(Function) }));
      expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toEqual([bad]);
    },
  );

  it.each(['PENDING', 'SYNCING'] as const)(
    adapter + ' valid %s and stable retry identity survive a pre-PR89 persisted upgrade', async (status) => {
      const storage = memoryStorage();
      const factory = adapter === 'idb' ? new IDBFactory() : undefined;
      const valid: OutboxOperation = {
        ...sale(), status,
        ...(status === 'SYNCING' ? { lastAttemptAt: '2026-10-04T11:59:00.000Z', attemptCount: 1 } : {}),
      };
      await seedPrePr89ImportedV2(storage, valid, factory);
      const h = await replayHarness(storage, factory);
      await h.bind('user-b');
      expect(h.outbox.list()).toEqual([]);
      await h.bind('user-a');
      expect(h.outbox.list()[0]).toMatchObject({ id: valid.id, idempotencyKey: valid.idempotencyKey, status: 'PENDING' });
      expect(await h.replay()).toEqual({ synced: 1, conflicts: 0, failed: 0 });
      expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
      expect(h.completeSale).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ idempotencyKey: valid.idempotencyKey }), expect.objectContaining({ outbox: expect.any(Object), canReplay: expect.any(Function) }));
    },
  );

  it.each(malformedFields.filter(({ name }) => ['blank key', 'org mismatch', 'branch mismatch', 'invalid createdAt'].includes(name)))(
    adapter + ' persisted pre-PR89 import of $name is quarantined on upgrade', async ({ patch }) => {
      const storage = memoryStorage();
      const factory = adapter === 'idb' ? new IDBFactory() : undefined;
      const bad = { ...sale(), ...patch };
      await seedPrePr89ImportedV2(storage, bad, factory);
      const h = await replayHarness(storage, factory);
      await h.bind('user-b');
      await h.bind('user-a');
      await h.bind('user-b');
      const restarted = await replayHarness(storage, factory);
      await restarted.bind('user-a');
      expect(await restarted.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
      expect(restarted.completeSale).not.toHaveBeenCalled();
      expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toEqual([bad]);
    },
  );
}

it.each([true, false])('cached IDB cleanup marker cannot bypass group validation; ownershipProven=%s', async (ownershipProven) => {
  const storage = memoryStorage();
  const factory = new IDBFactory();
  const h = await replayHarness(storage, factory);
  await h.bind('user-a');
  const first = sale();
  const raw = JSON.stringify({ operations: [first, { ...first, id: 'sale-b', payload: { changed: true } }] });
  storage.setItem(vaultKey, raw);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('metadata', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.objectStore('metadata').put({
        key: 'legacy-session-vault-v1:quarantine:user-a', raw, safeToDelete: true,
      });
    });
  } finally { database.close(); }
  expect(await h.outbox.importLegacyVault('user-a', raw, { ownershipProven })).toBe(false);
  await h.bind('user-a');
  expect(storage.getItem(vaultKey)).toBe(raw);
  expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
  expect(h.completeSale).not.toHaveBeenCalled();
});


it('KV keeps a consumed valid source when its key is now durably disputed', async () => {
  const storage = memoryStorage();
  const first = sale();
  const raw = seedGlobal(storage, [first]);
  storage.setItem(stateKey, JSON.stringify({
    version: 2, ownerId: 'user-a', operations: [], vaults: {},
    quarantine: [{ ownerId: 'user-a', records: [{ record: first, reason: 'IMMUTABLE_CONFLICT' }] }],
    legacyGlobalRecovery: { raw, ownerId: 'user-a' },
  }));
  await new OutboxStore(storage).clear();
  expect(storage.getItem(globalKey)).toBe(raw);
});

it('KV quarantine commit failure preserves original owner and exact v2 source', async () => {
  const base = memoryStorage();
  const bad = { ...sale(), idempotencyKey: undefined };
  const raw = JSON.stringify({ version: 2, ownerId: 'user-a', operations: [bad], vaults: {} });
  base.setItem(stateKey, raw);
  let fail = true;
  const storage: KeyValueStorage = {
    ...base,
    setItem: (key, value) => {
      if (key === stateKey && fail) throw new Error('QUARANTINE_COMMIT_FAILED');
      base.setItem(key, value);
    },
  };
  const h = await replayHarness(storage);
  await h.bind('user-a');
  expect(h.outbox.list()).toEqual([]);
  await expect(h.bind('user-b')).rejects.toThrow('QUARANTINE_COMMIT_FAILED');
  expect(base.getItem(stateKey)).toBe(raw);
  fail = false;
  await h.bind('user-b');
  expect(h.outbox.list()).toEqual([]);
  await h.bind('user-a');
  expect(h.outbox.list()).toEqual([]);
  expect(quarantineOperationRecords(await persistedQuarantine(storage))).toEqual([JSON.parse(raw).operations[0]]);
});

it('IDB owner-transition abort rolls back quarantine and source removal together', async () => {
  const storage = memoryStorage();
  const factory = new IDBFactory();
  const outbox = new OutboxStore(storage, {
    indexedDB: factory,
    transitionHook: (point) => { if (point === 'after-vault') throw new Error('TRANSITION_ABORTED'); },
  });
  await outbox.ready();
  const bad = JSON.parse(JSON.stringify({ ...sale(), idempotencyKey: undefined })) as OutboxOperation;
  await seedIdbV2(factory, bad, false);
  await expect(outbox.transitionOwner('user-a', 'user-b')).rejects.toThrow('TRANSITION_ABORTED');
  expect(await outbox.owner()).toBe('user-a');
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const original = await new Promise<unknown>((resolve, reject) => {
      const tx = database.transaction('operations', 'readonly');
      const request = tx.objectStore('operations').get(bad.id);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
    expect(original).toEqual(bad);
    expect(await persistedQuarantine(storage, { indexedDB: factory })).toEqual([]);
  } finally { database.close(); }
  await outbox.refresh('user-a');
  expect(outbox.list()).toEqual([]);
  expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toEqual([bad]);
});


it.each([false, true])('IDB validates an existing active/vault same-key group; immutable conflict=%s', async (conflicting) => {
  const storage = memoryStorage();
  const factory = new IDBFactory();
  const first = { ...sale(), status: 'SYNCED' as const, serverId: 'existing-server-sale' };
  const vaulted = {
    ...sale('vaulted-copy'),
    ...(conflicting ? { payload: { ...sale().payload as object, saleNumber: 'OTHER' } } : {}),
  };
  await seedIdbV2(factory, first, false);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('vaultOperations', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.objectStore('vaultOperations').put({ ...vaulted, ownerId: 'user-a' });
    });
  } finally { database.close(); }
  const raw = seedGlobal(storage, [sale()]);
  const h = await replayHarness(storage, factory);
  await h.bind('user-a');
  expect(h.outbox.list()).toEqual(conflicting ? [] : [first]);
  expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
  expect(h.completeSale).not.toHaveBeenCalled();
  if (conflicting) {
    expect(storage.getItem(globalKey)).toBe(raw);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory })))
      .toEqual(expect.arrayContaining([first, vaulted]));
  } else {
    expect(storage.getItem(globalKey)).toBeNull();
    expect(await persistedQuarantine(storage, { indexedDB: factory })).toEqual([]);
  }
  await h.bind('user-b');
  await h.bind('user-a');
  expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
  expect(h.completeSale).not.toHaveBeenCalled();
});

const reviewedSourceDisputes = [
  { name: 'identical plus conflicting', members: () => [sale('incoming-a'), { ...sale('incoming-b'), payload: { ...sale().payload as object, saleNumber: 'B' } }] },
  { name: 'malformed same-key sibling', members: () => [sale('incoming-a'), { ...sale('malformed'), createdAt: 123 }] },
  { name: 'three members identical plus conflicting', members: () => [sale('incoming-a'), sale('incoming-copy'), { ...sale('incoming-b'), payload: { ...sale().payload as object, saleNumber: 'B' } }] },
  { name: 'only malformed same-key member', members: () => [{ ...sale('malformed'), attemptCount: '1' }] },
];
for (const path of ['kv-global', 'kv-vault', 'idb-global', 'idb-vault'] as const) {
  for (const vaulted of [false, true]) {
    it.each(reviewedSourceDisputes)(path + (vaulted ? ' inactive destination ' : ' active destination ') + '$name disputes destination only for its key', async ({ members }) => {
      const storage = memoryStorage();
      const factory = path.startsWith('idb') ? new IDBFactory() : undefined;
      const existing = await replayHarness(storage, factory);
      await existing.bind('user-a');
      const destination = sale();
      const unrelated = { ...sale('unrelated'), idempotencyKey: 'unrelated-key' };
      await existing.outbox.enqueue(destination, 'user-a');
      await existing.outbox.enqueue(unrelated, 'user-a');
      if (vaulted) await existing.bind('user-b');
      const source = members();
      const key = path.endsWith('global') ? globalKey : vaultKey;
      const raw = JSON.stringify(path.endsWith('global') ? { version: 1, operations: source } : { operations: source });
      storage.setItem(key, raw);
      if (path.endsWith('global')) storage.setItem(ownerKey, 'user-a');
      const h = await replayHarness(storage, factory);
      await h.bind('user-a');
      expect(h.outbox.list()).toEqual([unrelated]);
      expect(storage.getItem(key)).toBe(raw);
      expect(await h.replay()).toEqual({ synced: 1, conflicts: 0, failed: 0 });
      expect(h.completeSale).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ idempotencyKey: unrelated.idempotencyKey }), expect.objectContaining({ outbox: expect.any(Object), canReplay: expect.any(Function) }));
      const quarantined = quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }));
      expect(quarantined).toEqual(expect.arrayContaining([destination, ...source]));
      expect(quarantined).toHaveLength(source.length + 1);
      expect(quarantined.every((record) => (record as OutboxOperation).idempotencyKey === destination.idempotencyKey)).toBe(true);
      await h.bind('user-b');
      expect(h.outbox.list()).toEqual([]);
      expect(await persistedQuarantine(storage, { indexedDB: factory }, 'user-b')).toEqual([]);
      await h.bind('user-a');
      expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
      const restarted = await replayHarness(storage, factory);
      await restarted.bind('user-a');
      expect(await restarted.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
      expect(restarted.completeSale).not.toHaveBeenCalled();
      expect(storage.getItem(key)).toBe(raw);
      expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toEqual(quarantined);
    });
  }
}

it.each([false, true])('KV valid receipt A rejects current conflicting destination B; vaulted=%s', async (vaulted) => {
  const storage = memoryStorage();
  const source = sale('source-a');
  const conflicting = { ...sale('destination-b'), payload: { ...sale().payload as object, saleNumber: 'B' } };
  const unrelated = { ...sale('unrelated'), idempotencyKey: 'unrelated-key' };
  const raw = seedGlobal(storage, [source]);
  storage.setItem(stateKey, JSON.stringify({
    version: 2, ownerId: vaulted ? 'user-b' : 'user-a',
    operations: vaulted ? [] : [conflicting, unrelated],
    vaults: vaulted ? { 'user-a': [conflicting, unrelated] } : {},
    legacyGlobalRecovery: { raw, ownerId: 'user-a' },
  }));
  const h = await replayHarness(storage);
  await h.bind('user-a');
  expect(h.outbox.list()).toEqual([unrelated]);
  expect(await h.replay()).toEqual({ synced: 1, conflicts: 0, failed: 0 });
  expect(h.completeSale).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ idempotencyKey: unrelated.idempotencyKey }), expect.objectContaining({ outbox: expect.any(Object), canReplay: expect.any(Function) }));
  expect(storage.getItem(globalKey)).toBe(raw);
  const q = quarantineOperationRecords(await persistedQuarantine(storage));
  expect(q).toEqual(expect.arrayContaining([source, conflicting]));
  await h.outbox.removeSynced();
  await h.bind('user-b');
  await h.bind('user-a');
  const restarted = await replayHarness(storage);
  await restarted.bind('user-a');
  expect(await restarted.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
  expect(restarted.completeSale).not.toHaveBeenCalled();
  expect(storage.getItem(globalKey)).toBe(raw);
});

it('KV receipt cleanup retries after destination removal without reactivating the intent', async () => {
  const base = memoryStorage();
  const source = sale();
  const raw = seedGlobal(base, [source]);
  base.setItem(stateKey, JSON.stringify({ version: 2, ownerId: 'user-a', operations: [], vaults: {}, legacyGlobalRecovery: { raw, ownerId: 'user-a' } }));
  let blockCleanup = true;
  const storage = { ...base, removeItem: (key: string) => {
    if (key === globalKey && blockCleanup) throw new Error('CLEANUP_INTERRUPTED');
    base.removeItem(key);
  } };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const h = await replayHarness(storage);
    await h.bind('user-a');
    await h.outbox.removeSynced();
    expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(base.getItem(globalKey)).toBe(raw);
  }
  blockCleanup = false;
  const h = await replayHarness(storage);
  await h.bind('user-a');
  await h.outbox.removeSynced();
  await h.outbox.removeSynced();
  expect(base.getItem(globalKey)).toBeNull();
  expect(h.outbox.list()).toEqual([]);
  expect(await persistedQuarantine(storage)).toEqual([]);
});

it('KV receipt retains a replaced unrelated source while valid consumed intent stays removed', async () => {
  const storage = memoryStorage();
  const raw = seedGlobal(storage, [sale()]);
  const replacement = JSON.stringify({ version: 1, operations: [{ ...sale('replacement'), idempotencyKey: 'different-key' }] });
  storage.setItem(stateKey, JSON.stringify({ version: 2, ownerId: 'user-a', operations: [], vaults: {}, legacyGlobalRecovery: { raw, ownerId: 'user-a' } }));
  storage.setItem(globalKey, replacement);
  const h = await replayHarness(storage);
  await h.bind('user-a');
  await h.outbox.removeSynced();
  expect(storage.getItem(globalKey)).toBe(replacement);
  expect(h.outbox.list()).toEqual([]);
  expect(await persistedQuarantine(storage)).toEqual([]);
});

it.each(['kv-global', 'kv-vault', 'idb-global', 'idb-vault'] as const)('%s disputes cannot cross owner association even when another owner uses the same key', async (path) => {
  const storage = memoryStorage();
  const factory = path.startsWith('idb') ? new IDBFactory() : undefined;
  const h = await replayHarness(storage, factory);
  await h.bind('user-a');
  await h.outbox.enqueue(sale(), 'user-a');
  await h.bind('user-b');
  const ownerB = { ...sale('owner-b'), organizationId: 'org-b', branchId: 'branch-b', payload: { ...sale().payload as object, organizationId: 'org-b', branchId: 'branch-b' } };
  await h.outbox.enqueue(ownerB, 'user-b');
  const key = path.endsWith('global') ? globalKey : vaultKey;
  const source = reviewedSourceDisputes[0]!.members();
  const raw = JSON.stringify(path.endsWith('global') ? { version: 1, operations: source } : { operations: source });
  storage.setItem(key, raw);
  if (path.endsWith('global')) storage.setItem(ownerKey, 'user-a');
  const restarted = await replayHarness(storage, factory);
  await restarted.bind('user-b');
  expect(restarted.outbox.list()).toEqual([ownerB]);
  expect(await restarted.replay()).toEqual({ synced: 1, conflicts: 0, failed: 0 });
  expect(restarted.completeSale).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ organizationId: 'org-b' }), expect.any(Object));
  expect(await persistedQuarantine(storage, { indexedDB: factory }, 'user-b')).toEqual([]);
  await restarted.bind('user-a');
  expect(restarted.outbox.list()).toEqual([]);
  expect(await restarted.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
  expect(storage.getItem(key)).toBe(raw);
});

async function seedReviewImportMarker(factory: IDBFactory, path: 'global' | 'vault', source: OutboxOperation, raw: string) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('metadata', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      const metadata = tx.objectStore('metadata');
      metadata.put({
        key: path === 'global' ? 'legacy-local-storage-v1:import:' + source.idempotencyKey
          : 'legacy-session-vault-v1:import:' + JSON.stringify(['user-a', source.idempotencyKey]),
        sourceFingerprint: stableOutboxSerialize(source), importedId: source.id,
      });
      if (path === 'vault') metadata.put({ key: 'legacy-session-vault-v1:quarantine:user-a', raw, safeToDelete: true });
    });
  } finally { database.close(); }
}

for (const path of ['global', 'vault'] as const) {
  it.each([false, true])('IDB ' + path + ' matching fingerprint/cleanup marker cannot excuse destination conflict; vaulted=%s', async (vaulted) => {
    const storage = memoryStorage();
    const factory = new IDBFactory();
    const source = sale('imported-a');
    const conflicting = { ...sale('destination-b'), payload: { ...sale().payload as object, saleNumber: 'B' } };
    await seedIdbV2(factory, conflicting, vaulted);
    const key = path === 'global' ? globalKey : vaultKey;
    const raw = JSON.stringify(path === 'global' ? { version: 1, operations: [source] } : { operations: [source] });
    storage.setItem(key, raw);
    storage.setItem(ownerKey, 'user-a');
    await seedReviewImportMarker(factory, path, source, raw);
    const h = await replayHarness(storage, factory);
    await h.bind('user-a');
    expect(h.outbox.list()).toEqual([]);
    expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBe(raw);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory })))
      .toEqual(expect.arrayContaining([source, conflicting]));
  });

  it('IDB ' + path + ' marker permits repeated valid cleanup after imported destination was removed', async () => {
    const storage = memoryStorage();
    const factory = new IDBFactory();
    const source = sale('already-removed');
    const existing = await replayHarness(storage, factory);
    await existing.bind('user-a');
    const key = path === 'global' ? globalKey : vaultKey;
    const raw = JSON.stringify(path === 'global' ? { version: 1, operations: [source] } : { operations: [source] });
    await seedReviewImportMarker(factory, path, source, raw);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      storage.setItem(key, raw);
      storage.setItem(ownerKey, 'user-a');
      const h = await replayHarness(storage, factory);
      await h.bind('user-a');
      expect(storage.getItem(key)).toBeNull();
      expect(h.outbox.list()).toEqual([]);
      expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
      expect(h.completeSale).not.toHaveBeenCalled();
      expect(await persistedQuarantine(storage, { indexedDB: factory })).toEqual([]);
    }
  });
}

for (const adapter of ['kv', 'idb'] as const) {
  for (const vaulted of [false, true]) {
    it.each(reviewedSourceDisputes.slice(0, 2))(adapter + (vaulted ? ' inactive ' : ' active ') + 'unproven per-user source $name cannot leave owned destination replayable', async ({ members }) => {
      const storage = memoryStorage();
      const factory = adapter === 'idb' ? new IDBFactory() : undefined;
      const h = await replayHarness(storage, factory);
      await h.bind('user-a');
      await h.outbox.enqueue(sale(), 'user-a');
      if (vaulted) await h.bind('user-b');
      const source = members();
      const raw = JSON.stringify({ operations: source });
      storage.setItem(vaultKey, raw);
      expect(await h.outbox.importLegacyVault('user-a', raw, { ownershipProven: false })).toBe(false);
      expect(storage.getItem(vaultKey)).toBe(raw);
      expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory })))
        .toEqual(expect.arrayContaining([sale(), ...source]));
      await h.bind('user-a');
      expect(h.outbox.list()).toEqual([]);
      expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
      expect(h.completeSale).not.toHaveBeenCalled();
      expect(storage.getItem(vaultKey)).toBe(raw);
    });
  }
}


function replayRaceGate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const recoveryRacePaths = ['kv-global', 'kv-vault', 'idb-global', 'idb-vault'] as const;
async function quarantineDuringReplay(
  h: Awaited<ReturnType<typeof replayHarness>>, storage: KeyValueStorage,
  factory: IDBFactory | undefined, path: typeof recoveryRacePaths[number],
) {
  const source = reviewedSourceDisputes[0]!.members();
  const global = path.endsWith('global');
  const key = global ? globalKey : vaultKey;
  const raw = JSON.stringify(global ? { version: 1, operations: source } : { operations: source });
  storage.setItem(key, raw);
  if (global) storage.setItem(ownerKey, 'user-a');
  // A second store models recovery concurrent with the coordinator's captured snapshot.
  const recovery = new h.Store(storage, { indexedDB: factory });
  await recovery.ready();
  if (!global) expect(await recovery.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(false);
  await recovery.refresh('user-a');
  expect(recovery.list()).toEqual([]);
  expect(storage.getItem(key)).toBe(raw);
  return { key, raw };
}

for (const path of recoveryRacePaths) {
  for (const preparation of ['auth', 'inventory'] as const) {
    it.each([false, true])(path + ' stale replay during ' + preparation + '; TOKEN_REFRESHED=%s', async (tokenRefreshed) => {
      const storage = memoryStorage();
      const factory = path.startsWith('idb') ? new IDBFactory() : undefined;
      const h = await replayHarness(storage, factory);
      await h.bind('user-a');
      await h.outbox.enqueue(sale(), 'user-a');
      const capturedScope = h.scope.replayScope();
      const started = replayRaceGate<void>();
      const resume = replayRaceGate<void>();
      if (preparation === 'auth') h.getSession.mockImplementationOnce(async () => {
        started.resolve(); await resume.promise; return h.session();
      });
      else h.loadInventoryBalances.mockImplementationOnce(async () => {
        started.resolve(); await resume.promise; return [];
      });
      const replay = h.replay();
      await started.promise;
      let stopLifecycle: (() => void) | undefined;
      try {
        if (tokenRefreshed) {
          const { startAuthLifecycle } = await import('../providers/authLifecycle');
          const refreshed = { user: { id: 'user-a' }, access_token: 'new-token' } as import('@supabase/supabase-js').Session;
          const committed = replayRaceGate<void>();
          let emit!: Parameters<import('../providers/authLifecycle').AuthLifecycleClient['onAuthStateChange']>[0];
          const lifecycle = startAuthLifecycle({
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: (callback) => {
              emit = callback;
              return { data: { subscription: { unsubscribe: vi.fn() } } };
            },
          }, { bindUser: (owner) => h.scope.bindUser(owner), commit: (session) => { if (session) committed.resolve(); } });
          stopLifecycle = () => lifecycle.stop();
          emit('TOKEN_REFRESHED', refreshed);
          await committed.promise;
          expect(h.scope.replayScope()).toEqual(capturedScope);
        }
        const retained = await quarantineDuringReplay(h, storage, factory, path);
        resume.resolve();
        expect(await replay).toEqual({ synced: 0, conflicts: 0, failed: 0 });
        expect(h.completeSale).not.toHaveBeenCalled();
        expect(await h.outbox.refresh('user-a')).toEqual([]);
        expect(storage.getItem(retained.key)).toBe(retained.raw);
        expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory })))
          .toEqual(expect.arrayContaining([sale()]));
        // Repeated replay has no retryable active work and cannot spin on this key.
        expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
        const restarted = new h.Store(storage, { indexedDB: factory });
        expect(await restarted.refresh('user-a')).toEqual([]);
        await h.bind('user-b');
        await h.bind('user-a');
        expect(h.outbox.list()).toEqual([]);
        expect(storage.getItem(retained.key)).toBe(retained.raw);
      } finally {
        stopLifecycle?.(); resume.resolve(); await replay;
      }
    });
  }
  it(path + ' quarantines after SYNCING commits but before the submission boundary', async () => {
    const storage = memoryStorage();
    const factory = path.startsWith('idb') ? new IDBFactory() : undefined;
    const h = await replayHarness(storage, factory);
    await h.bind('user-a');
    await h.outbox.enqueue(sale(), 'user-a');
    const update = h.outbox.update.bind(h.outbox);
    let retained!: { key: string; raw: string };
    vi.spyOn(h.outbox, 'update').mockImplementation(async (...args) => {
      const result = await update(...args);
      if (args[1].status === 'SYNCING') retained = await quarantineDuringReplay(h, storage, factory, path);
      return result;
    });
    expect(await h.replay()).toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(await h.outbox.refresh('user-a')).toEqual([]);
    expect(storage.getItem(retained.key)).toBe(retained.raw);
  });
}
