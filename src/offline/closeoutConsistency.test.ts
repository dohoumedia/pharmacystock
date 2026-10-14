import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation, type OutboxStoreOptions } from './outbox';
import { OfflineSessionScope } from './sessionScope';
import { KEY_VALUE_OUTBOX_STATE_KEY as stateKey, LEGACY_OUTBOX_KEY as globalKey, LEGACY_OUTBOX_OWNER_KEY as ownerKey,
  LEGACY_USER_IMPORT_PREFIX, legacyOutboxVaultKey, visibleLegacyOutboxEvidence } from './outboxRecovery';
import { persistedQuarantine, quarantineOperationRecords } from './outboxRecoveryTestUtils';
import type { KeyValueStorage } from './storage';

function memory(): KeyValueStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, raw) => { values.set(key, raw); }, removeItem: (key) => { values.delete(key); } };
}
function sale(id = 'sale-a', intent = 'A'): OutboxOperation {
  return { id, idempotencyKey: 'stable-key', kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
    createdAt: '2026-10-10T12:00:00Z', status: 'PENDING', attemptCount: 0,
    payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: intent } };
}
const independent = { ...sale('independent'), idempotencyKey: 'independent-key' };
function raw(records: unknown[], global = false) { return JSON.stringify({ ...(global ? { version: 1 } : {}), operations: records }); }
function nativeReceipts(storage: KeyValueStorage) { return JSON.parse(storage.getItem(stateKey)!).legacyVaultReceipts; }
async function db(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function mutate(storage: KeyValueStorage, options: OutboxStoreOptions, mutation: string) {
  const b = sale('conflicting-b', 'B');
  if (!options.indexedDB) {
    const state = JSON.parse(storage.getItem(stateKey)!);
    if (mutation === 'active') state.operations = [b];
    if (mutation === 'vaulted') state.vaults['user-a'] = [b];
    if (mutation === 'receipt') state.legacyVaultReceipts[JSON.stringify(['user-a', 'stable-key'])].importedId = '';
    storage.setItem(stateKey, JSON.stringify(state)); return;
  }
  const database = await db(options.indexedDB);
  try { await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['operations', 'vaultOperations', 'metadata'], 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    if (mutation === 'active') { tx.objectStore('operations').clear(); tx.objectStore('operations').put(b); }
    if (mutation === 'vaulted') tx.objectStore('vaultOperations').put({ ...b, ownerId: 'user-a' });
    if (mutation === 'receipt') {
      const metadata = tx.objectStore('metadata'); const key = LEGACY_USER_IMPORT_PREFIX + JSON.stringify(['user-a', 'stable-key']);
      const request = metadata.get(key); request.onsuccess = () => metadata.put({ ...request.result, importedId: '' });
    }
  }); } finally { database.close(); }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('current visible legacy evidence', () => {
  it.each(['conflict', 'malformed', 'identical'])('retained IndexedDB raw per-user %s source remains evidence without becoming an import receipt', async (kind) => {
    const storage = memory(); const options = { indexedDB: new IDBFactory() }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(independent, 'user-a');
    const source = raw([kind === 'conflict' ? sale('source-b', 'B') : kind === 'malformed' ? { ...sale(), createdAt: 'invalid' } : sale()]);
    expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: false })).toBe(false);
    // The caller's raw bytes live in retained metadata, not localStorage.
    expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBeNull();
    if (kind === 'malformed') await expect(outbox.enqueue(sale(), 'user-a')).rejects.toThrow('OUTBOX_IDEMPOTENCY_CONFLICT');
    else await outbox.enqueue(sale(), 'user-a');
    const expected = kind === 'identical' ? [independent, sale()] : [independent];
    expect(await outbox.refresh('user-a')).toEqual(expected);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual(expected);
    await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
    await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual(expected);
  });
  it.each(['global', 'user'].flatMap((path) => [false, true].map((vaulted) => [path, vaulted] as const)))(
    '%s evidence disputes active/vaulted=%s IndexedDB work during refresh without import first', async (path, vaulted) => {
      const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; storage.setItem(ownerKey, 'user-a');
      const outbox = new OutboxStore(storage, options); await outbox.ready(); await outbox.enqueue(sale(), 'user-a'); await outbox.enqueue(independent, 'user-a');
      if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
      const sourceKey = path === 'global' ? globalKey : legacyOutboxVaultKey('user-a');
      const source = raw([sale('source-b', 'B')], path === 'global'); storage.setItem(sourceKey, source);
      if (vaulted) { await outbox.transitionOwner('user-b', 'user-a'); }
      expect(await outbox.refresh('user-a')).toEqual([independent]);
      expect(storage.getItem(sourceKey)).toBe(source);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([independent]);
      expect(quarantineOperationRecords(await persistedQuarantine(storage, options))).toContainEqual(sale());
    },
  );
  it('global wrong-version keyed evidence and owner-scoped malformed sibling block only their known keys', () => {
    const storage = memory(); storage.setItem(ownerKey, 'user-a'); storage.setItem(globalKey, JSON.stringify({ version: 99, operations: [sale()] }));
    storage.setItem(legacyOutboxVaultKey('user-a'), raw([independent, { ...independent, createdAt: 'invalid' }]));
    const evidence = visibleLegacyOutboxEvidence(storage, 'user-a');
    expect(evidence.blockedKeys).toEqual(new Set(['stable-key', 'independent-key']));
    expect(evidence.importedIds?.size ?? 0).toBe(0); // Visibility is never an import receipt.
    expect(visibleLegacyOutboxEvidence(storage, 'user-b').records).toEqual([]);
  });
});

describe('native per-user durable import receipts', () => {
  it.each(['PENDING', 'FAILED', 'SYNCING'] as const)('%s imports persist stable identity/receipt in one v2 record', async (status) => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a');
    const operation = { ...sale(), status, attemptCount: 2,
      ...(status === 'SYNCING' ? { lastAttemptAt: '2026-10-10T13:00:00Z' } : {}),
      ...(status === 'FAILED' ? { nextAttemptAt: '2026-10-12T13:00:00Z', lastErrorCode: 'NETWORK' } : {}) };
    expect(await outbox.importLegacyVault('user-a', raw([operation]), { ownershipProven: true })).toBe(true);
    const receipt = nativeReceipts(storage)[JSON.stringify(['user-a', 'stable-key'])];
    expect(receipt.importedId).toBe(operation.id); expect(JSON.parse(receipt.sourceFingerprint)).toEqual(operation);
    expect(outbox.list()[0]).toMatchObject({ id: operation.id, idempotencyKey: operation.idempotencyKey, createdAt: operation.createdAt,
      attemptCount: operation.attemptCount, status: status === 'SYNCING' ? 'PENDING' : status });
    expect(await new OutboxStore(storage).refresh('user-a')).toEqual(outbox.list());
  });
  it('completed exact A never resurrects across restart/A-B-A; B disputes history and unrelated C survives', async () => {
    const storage = memory(); const scope = new OfflineSessionScope(storage); await scope.bindUser('user-a');
    const outbox = new OutboxStore(storage); const source = raw([sale()]); storage.setItem(legacyOutboxVaultKey('user-a'), source);
    await scope.bindUser('user-a'); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBeNull();
    await outbox.update('sale-a', { status: 'SYNCED' }, 'user-a'); await outbox.removeSynced();
    const receipts = nativeReceipts(storage);
    for (let retry = 0; retry < 2; retry++) {
      storage.setItem(legacyOutboxVaultKey('user-a'), source); await new OfflineSessionScope(storage).bindUser('user-a');
      expect(await new OutboxStore(storage).refresh('user-a')).toEqual([]); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBeNull();
    }
    await scope.bindUser('user-b'); expect(await new OutboxStore(storage).refresh('user-b')).toEqual([]);
    await scope.bindUser('user-a'); expect(await outbox.refresh('user-a')).toEqual([]);
    const changed = raw([sale('later-b', 'B'), independent]); storage.setItem(legacyOutboxVaultKey('user-a'), changed);
    expect(await outbox.importLegacyVault('user-a', changed, { ownershipProven: true })).toBe(false);
    expect(await outbox.refresh('user-a')).toEqual([]); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(changed);
    expect(nativeReceipts(storage)).toEqual(receipts);
    await outbox.enqueue(independent, 'user-a'); expect(await outbox.refresh('user-a')).toEqual([independent]);
  });
  it('inactive owner A import retains A identity and receipts while B never sees A work', async () => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-b');
    expect(await outbox.importLegacyVault('user-a', raw([sale()]), { ownershipProven: true })).toBe(true);
    expect(await outbox.refresh('user-b')).toEqual([]);
    const receipts = nativeReceipts(storage); await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([sale()]);
    await outbox.update('sale-a', { status: 'SYNCED' }, 'user-a'); await outbox.removeSynced();
    await outbox.transitionOwner('user-a', 'user-b'); await outbox.transitionOwner('user-b', 'user-a');
    expect(await outbox.importLegacyVault('user-a', raw([sale()]), { ownershipProven: true })).toBe(true);
    expect(await outbox.refresh('user-a')).toEqual([]); expect(nativeReceipts(storage)).toEqual(receipts);
  });
  it('failed native receipt commit leaves original state/source intact and import retries atomically', async () => {
    const base = memory(); let fail = false;
    const storage = { ...base, setItem: (key: string, value: string) => {
      if (fail && key === stateKey && JSON.parse(value).legacyVaultReceipts) throw new Error('RECEIPT_COMMIT_FAILED'); base.setItem(key, value);
    } };
    const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a');
    const before = base.getItem(stateKey); const source = raw([sale()]); base.setItem(legacyOutboxVaultKey('user-a'), source); fail = true;
    await expect(outbox.importLegacyVault('user-a', source, { ownershipProven: true })).rejects.toThrow('RECEIPT_COMMIT_FAILED');
    expect(base.getItem(stateKey)).toBe(before); expect(base.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
    fail = false; expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true);
    expect(nativeReceipts(storage)).toBeTruthy(); expect(await outbox.refresh('user-a')).toEqual([sale()]);
  });
  it('native completed history survives browser v2 handoff and cannot resurrect through another legacy path', async () => {
    const storage = memory(); const native = new OutboxStore(storage); await native.transitionOwner(null, 'user-a');
    expect(await native.importLegacyVault('user-a', raw([sale()]), { ownershipProven: true })).toBe(true);
    await native.update('sale-a', { status: 'SYNCED' }, 'user-a'); await native.removeSynced();
    const archive = storage.getItem(stateKey); const factory = new IDBFactory(); storage.setItem(globalKey, raw([sale()], true));
    const selected = new OutboxStore(storage, { indexedDB: factory }); expect(await selected.refresh('user-a')).toEqual([]);
    expect(storage.getItem(stateKey)).toBe(archive);
    expect(await selected.importLegacyVault('user-a', raw([sale()]), { ownershipProven: true })).toBe(true);
    expect(await selected.refresh('user-a')).toEqual([]);
    const changed = raw([sale('changed', 'B')]); storage.setItem(legacyOutboxVaultKey('user-a'), changed);
    expect(await selected.importLegacyVault('user-a', changed, { ownershipProven: true })).toBe(false);
    expect(await selected.refresh('user-a')).toEqual([]); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(changed);
  });
});

describe('per-user cleanup revalidates invocation state', () => {
  it.each(['conflict', 'malformed'])('IndexedDB observes late global %s evidence arriving during cleanup marker reads', async (kind) => {
    const storage = memory(); const options = { indexedDB: new IDBFactory() }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); const source = raw([sale()]); const key = legacyOutboxVaultKey('user-a'); storage.setItem(key, source);
    expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true);
    const late = raw([kind === 'conflict' ? sale('late-b', 'B') : { ...sale('late-malformed'), createdAt: 'invalid' }], true);
    const original = FakeObjectStore.prototype.get; let injected = false;
    vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, query) {
      if (!injected && typeof query === 'string' && query.startsWith(LEGACY_USER_IMPORT_PREFIX)) {
        injected = true; storage.setItem(ownerKey, 'user-a'); storage.setItem(globalKey, late);
      }
      return original.call(this, query);
    });
    expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false); expect(injected).toBe(true);
    expect(storage.getItem(key)).toBe(source); expect(storage.getItem(globalKey)).toBe(late);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([]);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, options))).toContainEqual(sale());
  });
  it.each([false, true].flatMap((indexed) => ['conflict', 'malformed'].map((kind) => [indexed, kind] as const)))(
    'indexed=%s late global %s evidence blocks cleanup without another import pass', async (indexed, kind) => {
      const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {};
      const outbox = new OutboxStore(storage, options); await outbox.transitionOwner(null, 'user-a');
      const key = legacyOutboxVaultKey('user-a'); const source = raw([sale()]); storage.setItem(key, source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true);
      const late = raw([kind === 'conflict' ? sale('late-b', 'B') : { ...sale('late-malformed'), createdAt: 'invalid' }], true);
      storage.setItem(ownerKey, 'user-a'); storage.setItem(globalKey, late);
      expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false);
      expect(storage.getItem(key)).toBe(source); expect(storage.getItem(globalKey)).toBe(late);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([]);
      expect(quarantineOperationRecords(await persistedQuarantine(storage, options))).toContainEqual(sale());
    },
  );
  it.each([false, true].flatMap((indexed) => ['active', 'vaulted', 'receipt'].map((mutation) => [indexed, mutation] as const)))(
    'indexed=%s %s changed after successful import retains source and fail-closed state', async (indexed, mutation) => {
      const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {};
      const scope = new OfflineSessionScope(storage, options); await scope.bindUser('user-a');
      const outbox = new OutboxStore(storage, options); const source = raw([sale()]); const key = legacyOutboxVaultKey('user-a'); storage.setItem(key, source);
      const original = OutboxStore.prototype.importLegacyVault; let injected = false;
      vi.spyOn(OutboxStore.prototype, 'importLegacyVault').mockImplementation(async function (this: OutboxStore, ...args) {
        const imported = await original.apply(this, args); expect(imported).toBe(true);
        if (!injected) { injected = true; await mutate(storage, options, mutation); } return imported;
      });
      await scope.bindUser('user-a'); expect(injected).toBe(true); expect(storage.getItem(key)).toBe(source);
      expect(await outbox.refresh('user-a')).toEqual([]);
      expect(await new OutboxStore(storage, options).cleanupLegacyVault('user-a', source, 'user-a')).toBe(false);
      expect(storage.getItem(key)).toBe(source);
      if (mutation !== 'receipt') expect(quarantineOperationRecords(await persistedQuarantine(storage, options))).toContainEqual(sale('conflicting-b', 'B'));
    },
  );
  it.each([false, true])('indexed=%s restart/retained compatible source cleanup retries idempotently after a storage failure', async (indexed) => {
    const base = memory(); let fail = true; const key = legacyOutboxVaultKey('user-a');
    const storage = { ...base, removeItem: (item: string) => { if (item === key && fail) throw new Error('CLEANUP_FAILED'); base.removeItem(item); } };
    const options = indexed ? { indexedDB: new IDBFactory() } : {}; const scope = new OfflineSessionScope(storage, options); await scope.bindUser('user-a');
    const source = raw([sale()]); base.setItem(key, source); await scope.bindUser('user-a'); expect(base.getItem(key)).toBe(source);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([sale()]);
    fail = false; await new OfflineSessionScope(storage, options).bindUser('user-a'); expect(base.getItem(key)).toBeNull();
    await new OfflineSessionScope(storage, options).bindUser('user-a'); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([sale()]);
  });
  it.each([false, true])('indexed=%s source/owner replacement before cleanup is retained, then a compatible retry succeeds', async (indexed) => {
    const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); const key = legacyOutboxVaultKey('user-a'); const source = raw([sale()]); storage.setItem(key, source);
    expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true);
    const replacement = raw([sale(), independent]); storage.setItem(key, replacement);
    expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false); expect(storage.getItem(key)).toBe(replacement);
    expect(await outbox.importLegacyVault('user-a', replacement, { ownershipProven: true })).toBe(true);
    await outbox.transitionOwner('user-a', 'user-b');
    expect(await outbox.cleanupLegacyVault('user-a', replacement, 'user-a')).toBe(false); expect(storage.getItem(key)).toBe(replacement);
    await outbox.transitionOwner('user-b', 'user-a');
    expect(await new OutboxStore(storage, options).cleanupLegacyVault('user-a', replacement, 'user-a')).toBe(true);
    expect(storage.getItem(key)).toBeNull(); expect(await outbox.refresh('user-a')).toEqual([independent, sale()]);
  });
});
