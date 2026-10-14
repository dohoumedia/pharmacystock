import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { KEY_VALUE_OUTBOX_STATE_KEY as sourceKey, OUTBOX_DISPATCH_BLOCKED_CODE, immutableOutboxContentMatches } from './outboxRecovery';
import { persistedQuarantine, quarantineOperationRecords } from './outboxRecoveryTestUtils';
import { nextOutboxReplayAt, OutboxReplayScheduler } from './replayScheduler';
import { deriveSyncStatus } from './syncStatus';
import { SyncCoordinator } from './sync';
import type { KeyValueStorage } from './storage';

const ownerKey = 'pharmacystock:offline-scope:v1:user-id';
const now = new Date('2026-10-10T12:00:00Z');
const prefix = 'key-value-outbox-v2:import:';
function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
function sale(id = 'sale-a'): OutboxOperation {
  return { id, kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a', idempotencyKey: `stable-${id}`,
    createdAt: '2026-10-09T12:00:00Z', status: 'PENDING', attemptCount: 0,
    payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: id } };
}
function rawState(records: unknown[], ownerId = 'user-a', extra: object = {}) {
  return JSON.stringify({ version: 2, ownerId, operations: records, vaults: {}, ...extra });
}
function seed(storage: KeyValueStorage, records: unknown[], owner = 'user-a', extra: object = {}) {
  const raw = rawState(records, owner, extra);
  storage.setItem(sourceKey, raw); storage.setItem(ownerKey, owner); return raw;
}
function selected(factory: IDBFactory, storage: KeyValueStorage) { return new OutboxStore(storage, { indexedDB: factory }); }
async function database(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('pharmacystock:outbox:v2', 2);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function mutateDatabase(factory: IDBFactory, action: (tx: IDBTransaction) => void) {
  const db = await database(factory);
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['operations', 'vaultOperations', 'metadata'], 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    action(tx);
  }); } finally { db.close(); }
}
async function receipts(factory: IDBFactory) {
  const db = await database(factory);
  try { return await new Promise<{ key: string; sourceFingerprint: string; importedId: string }[]>((resolve, reject) => {
    const tx = db.transaction('metadata', 'readonly'); const request = tx.objectStore('metadata').getAll();
    tx.oncomplete = () => resolve(request.result.filter((item) => item.key.startsWith(prefix)));
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('browser key/value v2 IndexedDB handoff', () => {
  it.each(['PENDING', 'FAILED', 'SYNCING'] as const)('%s handoff preserves stable intent and retry semantics across same-owner restart', async (status) => {
    const storage = memory(); const factory = new IDBFactory();
    const source = { ...sale(), status, attemptCount: 3, lastAttemptAt: '2026-10-10T10:00:00Z',
      ...(status === 'FAILED' ? { nextAttemptAt: '2026-10-10T13:00:00Z', lastErrorCode: 'NETWORK_OR_SERVER_ERROR' } : {}),
      ...(status === 'SYNCING' ? { lastErrorCode: OUTBOX_DISPATCH_BLOCKED_CODE } : {}) };
    const raw = seed(storage, [source]); const first = selected(factory, storage);
    const expected = status === 'SYNCING' ? { ...source, status: 'PENDING', nextAttemptAt: undefined, lastErrorCode: undefined } : source;
    expect(await first.refresh('user-a')).toEqual([expected]);
    expect(immutableOutboxContentMatches(first.list()[0]!, source)).toBe(true);
    const restart = selected(factory, storage);
    expect(await restart.refresh('user-a')).toEqual([expected]);
    expect(storage.getItem(sourceKey)).toBe(raw); // Non-destructive recovery archive.
    expect(await receipts(factory)).toHaveLength(1);
    expect(first.pending(now)).toHaveLength(status === 'FAILED' ? 0 : 1);
  });

  it('B never adopts A active work; A/B/A restores exact identity and owner-associated quarantine', async () => {
    const storage = memory(); const factory = new IDBFactory(); const a = sale();
    const b = { ...sale('sale-b'), organizationId: 'org-b', branchId: 'branch-b', payload: { organizationId: 'org-b', branchId: 'branch-b' } };
    const bad = { ...sale('bad-a'), idempotencyKey: '' };
    const raw = seed(storage, [b], 'user-b', { vaults: { 'user-a': [a] }, quarantine: [{ ownerId: 'user-a', records: [{ record: bad, reason: 'MALFORMED_ENVELOPE' }] }] });
    const first = selected(factory, storage);
    expect(await first.refresh('user-b')).toEqual([b]);
    expect(await receipts(factory)).toHaveLength(1); // A's scope has not been imported.
    expect(await persistedQuarantine(storage, { indexedDB: factory }, 'user-b')).toEqual([]);
    await first.transitionOwner('user-b', 'user-a');
    expect(await first.refresh('user-a')).toEqual([a]);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toContainEqual(bad);
    await first.transitionOwner('user-a', 'user-b'); expect(await first.refresh('user-b')).toEqual([b]);
    await first.transitionOwner('user-b', 'user-a'); expect(await first.refresh('user-a')).toEqual([a]);
    expect(await selected(factory, storage).refresh('user-a')).toEqual([a]);
    expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it('current B does not import source A until the owner transition explicitly selects A', async () => {
    const storage = memory(); const factory = new IDBFactory(); const raw = seed(storage, [sale()]);
    storage.setItem(ownerKey, 'user-b');
    const first = selected(factory, storage);
    expect(await first.refresh('user-b')).toEqual([]); expect(await receipts(factory)).toEqual([]);
    await first.transitionOwner('user-b', 'user-a'); expect(await first.refresh('user-a')).toEqual([sale()]);
    expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it.each(['blank key', 'missing key', 'invalid createdAt', 'missing branch', 'organization mismatch', 'branch mismatch', 'invalid field type', 'malformed syncing'])('%s source is retained/quarantined while unrelated valid work imports', async (name) => {
    const storage = memory(); const factory = new IDBFactory(); const malformed: Record<string, unknown> = { ...sale() };
    if (name === 'blank key') malformed.idempotencyKey = '';
    if (name === 'missing key') delete malformed.idempotencyKey;
    if (name === 'invalid createdAt') malformed.createdAt = 'invalid';
    if (name === 'missing branch') delete malformed.branchId;
    if (name === 'organization mismatch') malformed.organizationId = 'other';
    if (name === 'branch mismatch') malformed.branchId = 'other';
    if (name === 'invalid field type') malformed.attemptCount = '1';
    if (name === 'malformed syncing') malformed.status = 'SYNCING';
    const raw = seed(storage, [malformed, sale('unrelated')]); const first = selected(factory, storage);
    expect(await first.refresh('user-a')).toEqual([sale('unrelated')]);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toContainEqual(malformed);
    expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it.each(['conflict', 'malformed sibling', 'three members', 'source quarantine', 'legacy witness'])('%s propagates disputed keys into the current destination', async (variant) => {
    const storage = memory(); const factory = new IDBFactory(); storage.setItem(ownerKey, 'user-a');
    const first = selected(factory, storage); await first.ready(); await first.enqueue(sale(), 'user-a');
    const conflicting = { ...sale('conflicting'), idempotencyKey: sale().idempotencyKey, payload: { saleNumber: 'different' } };
    const malformed = { ...sale('malformed'), idempotencyKey: sale().idempotencyKey, createdAt: 'invalid' };
    const members = variant === 'malformed sibling' ? [sale(), malformed] : variant === 'three members'
      ? [sale(), { ...sale(), id: 'identical' }, conflicting] : [conflicting];
    const extra = variant === 'source quarantine' ? { quarantine: [{ ownerId: 'user-a', records: [{ record: sale(), reason: 'QUARANTINED_KEY' }] }] }
      : variant === 'legacy witness' ? { legacyGlobalRecovery: { ownerId: 'user-a', raw: JSON.stringify({ version: 1, operations: [conflicting] }) } } : {};
    const raw = seed(storage, [...(variant === 'source quarantine' || variant === 'legacy witness' ? [sale()] : members), sale('unrelated')], 'user-a', extra);
    expect(await first.refresh('user-a')).toEqual([sale('unrelated')]);
    const submit = vi.fn(async (_operation: OutboxOperation) => ({ status: 'SYNCED' as const }));
    expect(await new SyncCoordinator(first, { SALE: submit }, { expectedOwnerId: 'user-a', now: () => now }).replayPending()).toEqual({ synced: 1, conflicts: 0, failed: 0 });
    expect(submit).toHaveBeenCalledTimes(1); expect(submit.mock.calls[0]?.[0]).toMatchObject({ id: 'unrelated' });
    expect(storage.getItem(sourceKey)).toBe(raw);
    const restart = selected(factory, storage); expect((await restart.refresh('user-a')).map((item) => item.id)).toEqual(['unrelated']);
    await restart.transitionOwner('user-a', 'user-b'); await restart.transitionOwner('user-b', 'user-a');
    expect((await restart.refresh('user-a')).every((item) => item.idempotencyKey !== sale().idempotencyKey)).toBe(true);
  });

  it('identical source/destination and duplicate source members collapse under existing immutable semantics', async () => {
    const storage = memory(); const factory = new IDBFactory(); storage.setItem(ownerKey, 'user-a');
    const first = selected(factory, storage); await first.ready(); await first.enqueue(sale(), 'user-a');
    const raw = seed(storage, [sale(), { ...sale(), id: 'retry-copy' }]);
    expect(await first.refresh('user-a')).toEqual([sale()]);
    expect(await receipts(factory)).toHaveLength(1);
    expect(await selected(factory, storage).refresh('user-a')).toEqual([sale()]);
    expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it('committed receipts make logical cleanup retry-safe after successful sync/removal', async () => {
    const storage = memory(); const factory = new IDBFactory(); const raw = seed(storage, [sale()]);
    const first = selected(factory, storage); await first.ready();
    expect(await receipts(factory)).toHaveLength(1); // Destination row + receipt committed together.
    await first.update(sale().id, { status: 'SYNCED', serverId: 'server-a' }, 'user-a'); await first.removeSynced();
    for (let attempt = 0; attempt < 3; attempt += 1) expect(await selected(factory, storage).refresh('user-a')).toEqual([]);
    expect(await receipts(factory)).toHaveLength(1); expect(storage.getItem(sourceKey)).toBe(raw);
    // A fallback retry's changed lifecycle cannot resurrect the consumed intent.
    seed(storage, [{ ...sale(), status: 'FAILED', attemptCount: 8, lastErrorCode: 'NETWORK_ERROR' }]);
    expect(await first.refresh('user-a')).toEqual([]);
  });

  it('source replacement conflicts with an earlier receipt even after the destination was removed', async () => {
    const storage = memory(); const factory = new IDBFactory(); seed(storage, [sale()]);
    const first = selected(factory, storage); await first.ready(); await first.clear();
    const replacement = { ...sale(), payload: { saleNumber: 'replacement' } };
    const raw = seed(storage, [replacement]); expect(await first.refresh('user-a')).toEqual([]);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toContainEqual(replacement);
    expect(await selected(factory, storage).refresh('user-a')).toEqual([]); expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it('a cached valid receipt cannot hide a conflicting current destination', async () => {
    const storage = memory(); const factory = new IDBFactory(); const raw = seed(storage, [sale()]);
    const first = selected(factory, storage); await first.ready();
    await mutateDatabase(factory, (tx) => tx.objectStore('operations').put({ ...sale(), payload: { saleNumber: 'other' } }));
    expect(await selected(factory, storage).refresh('user-a')).toEqual([]);
    expect(storage.getItem(sourceKey)).toBe(raw);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toHaveLength(2);
  });

  it('aborting the receipt transaction does not acknowledge or erase uncommitted source work', async () => {
    const storage = memory(); const factory = new IDBFactory(); const raw = seed(storage, [sale()]);
    const original = IDBObjectStore.prototype.put;
    const interrupt = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key);
      if (this.name === 'metadata' && typeof value.key === 'string' && value.key.startsWith(prefix)) this.transaction.abort();
      return request;
    });
    const interrupted = selected(factory, storage);
    await expect(interrupted.ready()).rejects.toThrow();
    expect(await receipts(factory)).toEqual([]);
    interrupt.mockRestore();
    const first = selected(factory, storage); await first.ready();
    expect(await receipts(factory)).toHaveLength(1); expect(await first.refresh('user-a')).toEqual([sale()]);
    expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it('does not rename an id collision and does not block an unrelated destination key', async () => {
    const storage = memory(); const factory = new IDBFactory(); storage.setItem(ownerKey, 'user-a');
    const first = selected(factory, storage); await first.ready(); await first.enqueue(sale(), 'user-a');
    const collision = { ...sale(), idempotencyKey: 'different-key' }; const raw = seed(storage, [collision]);
    expect(await first.refresh('user-a')).toEqual([sale()]); expect(await receipts(factory)).toEqual([]);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toContainEqual(collision);
    expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it('source replacement during the import commit is preserved and reclassified before exposure', async () => {
    const storage = memory(); const factory = new IDBFactory(); seed(storage, [sale()]);
    const replacement = rawState([{ ...sale(), payload: { saleNumber: 'late replacement' } }]);
    const original = IDBObjectStore.prototype.add;
    const lateWriter = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key);
      if (this.name === 'operations') storage.setItem(sourceKey, replacement);
      return request;
    });
    const first = selected(factory, storage);
    expect(await first.refresh('user-a')).toEqual([]);
    lateWriter.mockRestore();
    expect(storage.getItem(sourceKey)).toBe(replacement);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toHaveLength(2);
  });

  it('ownerless work is retained and never acquires A identity', async () => {
    const storage = memory(); const factory = new IDBFactory();
    const raw = JSON.stringify({ version: 2, ownerId: null, operations: [sale()], vaults: {} });
    storage.setItem(sourceKey, raw); storage.setItem(ownerKey, 'user-a');
    expect(await selected(factory, storage).refresh('user-a')).toEqual([]);
    expect(await receipts(factory)).toEqual([]); expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it('a malformed receipt cannot authorize reactivation or cleanup', async () => {
    const storage = memory(); const factory = new IDBFactory(); seed(storage, [sale()]);
    const first = selected(factory, storage); await first.ready();
    await mutateDatabase(factory, (tx) => tx.objectStore('metadata').put({ key: `${prefix}${JSON.stringify(['user-a', sale().idempotencyKey])}`, sourceFingerprint: '{}', importedId: sale().id }));
    expect(await selected(factory, storage).refresh('user-a')).toEqual([]);
    expect(storage.getItem(sourceKey)).not.toBeNull();
  });

  it.each(['vaults', 'quarantine', 'operations'])('malformed %s container retains known disputed keys and cannot bypass destination quarantine', async (field) => {
    const storage = memory(); const factory = new IDBFactory(); storage.setItem(ownerKey, 'user-a');
    const first = selected(factory, storage); await first.ready(); await first.enqueue(sale(), 'user-a');
    const conflicting = { ...sale(), payload: { saleNumber: 'ambiguous replacement' } };
    const raw = rawState([conflicting], 'user-a', { [field]: field === 'operations' ? conflicting : 'invalid container' });
    storage.setItem(sourceKey, raw);
    expect(await first.refresh('user-a')).toEqual([]);
    expect(storage.getItem(sourceKey)).toBe(raw); expect(await receipts(factory)).toEqual([]);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toContainEqual(conflicting);
  });

  it('same-owner vaulted duplicate is restored without changing the destination identity', async () => {
    const storage = memory(); const factory = new IDBFactory(); storage.setItem(ownerKey, 'user-a');
    const first = selected(factory, storage); await first.ready();
    await mutateDatabase(factory, (tx) => tx.objectStore('vaultOperations').add({ ...sale(), ownerId: 'user-a' }));
    seed(storage, [{ ...sale(), id: 'retry-copy' }]);
    expect(await first.refresh('user-a')).toEqual([sale()]);
    expect(await selected(factory, storage).refresh('user-a')).toEqual([sale()]);
  });

  it('actual fallback A/B/A transitions hand off each selected owner without sharing work', async () => {
    const storage = memory(); const factory = new IDBFactory(); storage.setItem(ownerKey, 'user-a');
    const fallback = new OutboxStore(storage); await fallback.enqueue(sale(), 'user-a');
    await fallback.transitionOwner('user-a', 'user-b');
    await fallback.enqueue(sale('sale-b'), 'user-b');
    const first = selected(factory, storage);
    expect((await first.refresh('user-b')).map((item) => item.id)).toEqual(['sale-b']);
    await fallback.transitionOwner('user-b', 'user-a');
    await first.transitionOwner('user-b', 'user-a');
    expect((await first.refresh('user-a')).map((item) => item.id)).toEqual(['sale-a']);
    await first.transitionOwner('user-a', 'user-b'); expect((await first.refresh('user-b')).map((item) => item.id)).toEqual(['sale-b']);
    await first.transitionOwner('user-b', 'user-a'); expect((await first.refresh('user-a')).map((item) => item.id)).toEqual(['sale-a']);
  });

  it('a conflicting inactive destination stays quarantined when its owner is restored', async () => {
    const storage = memory(); const factory = new IDBFactory(); storage.setItem(ownerKey, 'user-b');
    const first = selected(factory, storage); await first.ready();
    await mutateDatabase(factory, (tx) => tx.objectStore('vaultOperations').put({ ...sale(), ownerId: 'user-a' }));
    const raw = rawState([{ ...sale(), payload: { saleNumber: 'conflict' } }, sale('unrelated')]);
    storage.setItem(sourceKey, raw);
    await first.transitionOwner('user-b', 'user-a');
    expect(await first.refresh('user-a')).toEqual([sale('unrelated')]);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toContainEqual(sale());
    expect(storage.getItem(sourceKey)).toBe(raw);
  });

  it('the browser fallback scheduler retries on the interrupted boundary rather than spinning', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); vi.stubGlobal('document', {});
    const storage = memory(); storage.setItem(ownerKey, 'user-a'); const fallback = new OutboxStore(storage);
    await fallback.enqueue(sale(), 'user-a'); const network = vi.fn();
    const replay = vi.fn(async () => new SyncCoordinator(fallback, {
      SALE: async (claim) => {
        await fallback.dispatchIfAuthoritative(claim, 'user-a', () => true, network);
        return { status: 'SKIPPED' as const };
      },
    }, { expectedOwnerId: 'user-a' }).replayPending());
    const scheduler = new OutboxReplayScheduler(fallback, replay, { expectedOwnerId: 'user-a' });
    scheduler.start();
    try {
      await vi.advanceTimersByTimeAsync(0); expect(replay).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(119999); expect(replay).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(replay).toHaveBeenCalledTimes(2);
      expect(network).not.toHaveBeenCalled();
      expect(deriveSyncStatus('online', await fallback.refresh('user-a')).kind).toBe('pending');
    } finally { scheduler.stop(); }
  });

  it('empty source replacement cannot hide receipt/destination incompatibility', async () => {
    const storage = memory(); const factory = new IDBFactory(); seed(storage, [sale()]);
    const first = selected(factory, storage); await first.ready();
    const empty = seed(storage, []);
    await mutateDatabase(factory, (tx) => tx.objectStore('operations').put({ ...sale(), payload: { saleNumber: 'conflicting current intent' } }));
    expect(await selected(factory, storage).refresh('user-a')).toEqual([]);
    expect(storage.getItem(sourceKey)).toBe(empty);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toHaveLength(2);
  });

  it('a vaulted retry id collision quarantines only that key without aborting unrelated work', async () => {
    const storage = memory(); const factory = new IDBFactory(); storage.setItem(ownerKey, 'user-a');
    const first = selected(factory, storage); await first.ready(); await first.enqueue(sale(), 'user-a');
    const vaulted = { ...sale(), idempotencyKey: 'vault-key' };
    await mutateDatabase(factory, (tx) => tx.objectStore('vaultOperations').put({ ...vaulted, ownerId: 'user-a' }));
    seed(storage, [vaulted, sale('unrelated')]);
    expect((await first.refresh('user-a')).map((item) => item.idempotencyKey)).toEqual(['stable-sale-a', 'stable-unrelated']);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, { indexedDB: factory }))).toContainEqual(vaulted);
  });

  it('blocked browser claim keeps bounded scheduling and uses existing Pending sync presentation', async () => {
    const storage = memory(); storage.setItem(ownerKey, 'user-a'); const fallback = new OutboxStore(storage);
    await fallback.enqueue(sale(), 'user-a');
    const claimed = (await fallback.update(sale().id, { status: 'SYNCING', lastAttemptAt: now.toISOString(), attemptCount: 1 }, 'user-a'))!;
    vi.stubGlobal('document', {}); const network = vi.fn();
    const observed = vi.fn(() => deriveSyncStatus('online', fallback.list()).kind);
    const unsubscribe = fallback.subscribe(observed);
    expect(await fallback.dispatchIfAuthoritative(claimed, 'user-a', () => true, network)).toBe(false);
    const current = await fallback.refresh('user-a'); expect(network).not.toHaveBeenCalled();
    expect(current[0]).toMatchObject({ status: 'SYNCING', lastErrorCode: OUTBOX_DISPATCH_BLOCKED_CODE });
    expect(observed).toHaveReturnedWith('pending'); unsubscribe();
    expect(deriveSyncStatus('online', current)).toEqual({ kind: 'pending', pendingCount: 1, conflictCount: 0 });
    expect(nextOutboxReplayAt(current, now)).toBe(now.getTime() + 120000);
    const supported = selected(new IDBFactory(), storage);
    expect((await supported.refresh('user-a'))[0]).toMatchObject({ status: 'PENDING', id: sale().id, idempotencyKey: sale().idempotencyKey });
    expect(supported.list()[0]?.lastErrorCode).toBeUndefined(); expect(supported.pending(now)).toHaveLength(1);
  });
});
