import { IDBFactory, IDBDatabase as FakeIDBDatabase } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { classifyOutboxReceiptEvidence, classifyOutboxRecoveryGroups, stableOutboxSerialize, KEY_VALUE_OUTBOX_STATE_KEY } from './outboxRecovery';
import { persistedQuarantine, quarantineOperationRecords } from './outboxRecoveryTestUtils';
import type { KeyValueStorage } from './storage';

const ownerKey = 'pharmacystock:offline-scope:v1:user-id';
const globalKey = 'pharmacystock:outbox:v1:operations';
const globalPrefix = 'legacy-local-storage-v1:import:';
const userPrefix = 'legacy-session-vault-v1:import:';
const handoffPrefix = 'key-value-outbox-v2:import:';
function memory(): KeyValueStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, raw) => { values.set(key, raw); }, removeItem: (key) => { values.delete(key); } };
}
function sale(id = 'sale-a', intent = 'A'): OutboxOperation {
  return { id, idempotencyKey: 'stable-key', kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
    createdAt: '2026-10-10T12:00:00Z', status: 'PENDING', attemptCount: 0,
    payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: intent } };
}
const unrelated = { ...sale('unrelated'), idempotencyKey: 'unrelated-key' };
function snapshot(records: unknown[]) { return JSON.stringify({ version: 1, operations: records }); }
function rawState(records: unknown[], receipt: unknown, extra: object = {}) {
  return JSON.stringify({ version: 2, ownerId: 'user-a', operations: records, vaults: {}, legacyGlobalRecovery: receipt, ...extra });
}
function markerKey(path: string) { return path === 'global' ? globalPrefix + 'stable-key' : (path === 'user' ? userPrefix : handoffPrefix) + JSON.stringify(['user-a', 'stable-key']); }
async function database(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => { const req = factory.open('pharmacystock:outbox:v2', 2);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function mutate(factory: IDBFactory, action: (tx: IDBTransaction) => void) {
  const db = await database(factory);
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(['operations', 'vaultOperations', 'metadata'], 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); action(tx); }); } finally { db.close(); }
}
async function readMarker(factory: IDBFactory, key: string) {
  const db = await database(factory);
  try { return await new Promise<unknown>((resolve, reject) => { const tx = db.transaction('metadata', 'readonly');
    const req = tx.objectStore('metadata').get(key); tx.oncomplete = () => resolve(req.result); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
}

afterEach(() => vi.restoreAllMocks());

describe('shared historical receipt evidence', () => {
  it('valid historical A agrees with A and disputes B using canonical immutable semantics', () => {
    const evidence = classifyOutboxReceiptEvidence({ ownerId: 'user-a', raw: snapshot([sale()]) });
    expect(evidence.valid).toBe(true);
    expect(classifyOutboxRecoveryGroups([sale(), ...evidence.records], evidence.blockedKeys).complete).toBe(true);
    expect(classifyOutboxRecoveryGroups([sale('b', 'B'), ...evidence.records], evidence.blockedKeys).operations).toEqual([]);
  });
  it('malformed same-key sibling preserves all discoverable members and blocks only that key', () => {
    const bad = { ...sale('bad'), createdAt: 'invalid' };
    const evidence = classifyOutboxReceiptEvidence({ ownerId: 'user-a', raw: snapshot([sale(), bad, unrelated]) });
    expect(evidence.valid).toBe(false); expect(evidence.records).toEqual([sale(), bad, unrelated]);
    expect([...evidence.blockedKeys]).toEqual(['stable-key']);
    expect(classifyOutboxRecoveryGroups([sale(), unrelated, ...evidence.records], evidence.blockedKeys).operations).toEqual([unrelated]);
  });
  it.each(['importedId', 'fingerprint', 'key', 'owner'])('malformed marker %s cannot authorize cleanup', (field) => {
    const key = markerKey('global'); const marker = { key, importedId: 'sale-a', sourceFingerprint: stableOutboxSerialize(sale()), ownerId: 'user-a' };
    const bad = field === 'importedId' ? { ...marker, importedId: '' } : field === 'fingerprint' ? { ...marker, sourceFingerprint: '{}' }
      : field === 'key' ? { ...marker, key: 'wrong' } : { ...marker, ownerId: 123 };
    const evidence = classifyOutboxReceiptEvidence(bad, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.blockedKeys.has('stable-key')).toBe(true);
  });
  it('unidentifiable garbage is invalid evidence and cannot block unrelated keys', () => {
    const evidence = classifyOutboxReceiptEvidence({ ownerId: 'user-a', raw: '{broken' });
    expect(evidence.valid).toBe(false); expect(evidence.records).toEqual([]); expect(evidence.blockedKeys.size).toBe(0);
  });
});

describe('IndexedDB historical receipt integrity', () => {
  it.each(['global', 'user'].flatMap((path) => [false, true].map((vaulted) => [path, vaulted] as const)))('%s historical sync/removal receipt disputes later %s vaulted destination and source across restart/A-B-A', async (path, vaulted) => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory };
    storage.setItem(ownerKey, 'user-a');
    if (path === 'global') storage.setItem(globalKey, snapshot([sale()]));
    const first = new OutboxStore(storage, options); await first.ready();
    if (path === 'user') expect(await first.importLegacyVault('user-a', snapshot([sale()]), { ownershipProven: true })).toBe(true);
    await first.update('sale-a', { status: 'SYNCED' }, 'user-a'); await first.removeSynced();
    expect(await first.refresh('user-a')).toEqual([]);
    const receipt = await readMarker(factory, markerKey(path)); expect(receipt).toBeTruthy();
    if (vaulted) await first.transitionOwner('user-a', 'user-b');
    const b = sale('later-b', 'B');
    await mutate(factory, (tx) => { (vaulted ? tx.objectStore('vaultOperations') : tx.objectStore('operations')).put(vaulted ? { ...b, ownerId: 'user-a' } : b); });
    const source = snapshot([b]);
    if (path === 'global') { storage.setItem(globalKey, source); storage.setItem(ownerKey, 'user-a'); }
    else { storage.setItem('vault-source', source); expect(await first.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(false); }
    const restart = new OutboxStore(storage, options); await restart.ready();
    if (vaulted) await restart.transitionOwner('user-b', 'user-a');
    expect(await restart.refresh('user-a')).toEqual([]);
    await restart.transitionOwner('user-a', 'user-b'); await restart.transitionOwner('user-b', 'user-a');
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([]);
    expect(storage.getItem(path === 'global' ? globalKey : 'vault-source')).toBe(source);
    expect(await readMarker(factory, markerKey(path))).toEqual(receipt);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, options))).toContainEqual(b);
  });

  it.each(['global', 'user', 'handoff'])('%s historical receipt remains evidence with no current source or destination witness', async (path) => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; storage.setItem(ownerKey, 'user-a');
    const first = new OutboxStore(storage, options); await first.ready();
    const marker = { key: markerKey(path), importedId: 'sale-a', sourceFingerprint: stableOutboxSerialize(sale()) };
    const b = sale('b', 'B');
    await mutate(factory, (tx) => { tx.objectStore('metadata').put(marker); tx.objectStore('operations').put(b); tx.objectStore('operations').put(unrelated); });
    expect(await first.refresh('user-a')).toEqual([unrelated]);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([unrelated]);
    expect(await readMarker(factory, marker.key)).toEqual(marker);
  });

  it.each(['global', 'user', 'handoff'].flatMap((path) => ['blank-id', 'missing-id', 'bad-intent', 'missing-intent'].map((fault) => [path, fault] as const)))('%s %s receipt never cleans/suppresses source and stays retained on restart', async (path, fault) => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; storage.setItem(ownerKey, 'user-a');
    const first = new OutboxStore(storage, options); await first.ready();
    const marker: Record<string, unknown> = { key: markerKey(path), importedId: 'sale-a', sourceFingerprint: stableOutboxSerialize(sale()) };
    if (fault === 'blank-id') marker.importedId = '';
    if (fault === 'missing-id') delete marker.importedId;
    if (fault === 'bad-intent') marker.sourceFingerprint = stableOutboxSerialize({ ...sale(), createdAt: 'invalid' });
    if (fault === 'missing-intent') delete marker.sourceFingerprint;
    await mutate(factory, (tx) => { tx.objectStore('metadata').put(marker); tx.objectStore('operations').put(sale()); tx.objectStore('operations').put(unrelated); });
    const source = path === 'handoff' ? rawState([sale()], undefined) : snapshot([sale()]);
    const sourceKey = path === 'handoff' ? KEY_VALUE_OUTBOX_STATE_KEY : path === 'global' ? globalKey : 'vault-source';
    storage.setItem(sourceKey, source);
    if (path === 'user') expect(await first.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(false);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([unrelated]);
    expect(storage.getItem(sourceKey)).toBe(source); expect(await readMarker(factory, marker.key as string)).toEqual(marker);
  });

  it('cleanup revalidates a destination conflict committed after import and before cleanup invocation', async () => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; storage.setItem(ownerKey, 'user-a');
    const first = new OutboxStore(storage, options); await first.ready();
    const marker = { key: markerKey('global'), importedId: 'sale-a', sourceFingerprint: stableOutboxSerialize(sale()) };
    await mutate(factory, (tx) => tx.objectStore('metadata').put(marker));
    const raw = snapshot([sale()]); storage.setItem(globalKey, raw);
    const original = FakeIDBDatabase.prototype.transaction;
    let injected = false;
    vi.spyOn(FakeIDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, stores, mode, options) {
      if (!injected && mode === 'readonly' && Array.isArray(stores) && stores.includes('operations') && stores.includes('metadata')) {
        injected = true;
        const write = original.call(this, ['operations', 'vaultOperations', 'metadata'], 'readwrite');
        write.objectStore('operations').put(sale('late-b', 'B'));
      }
      return original.call(this, stores, mode, options);
    });
    const restart = new OutboxStore(storage, options); expect(await restart.refresh('user-a')).toEqual([]);
    expect(injected).toBe(true); expect(storage.getItem(globalKey)).toBe(raw);
    expect(await readMarker(factory, marker.key)).toEqual(marker);
  });

  it.each(['legacy-session-vault-v1:import:{broken', 'key-value-outbox-v2:import:[123,"stable-key"]'])('broken scope marker %s retains keyed fingerprint evidence and blocks only that key', async (key) => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; storage.setItem(ownerKey, 'user-a');
    const first = new OutboxStore(storage, options); await first.ready();
    const marker = { key, importedId: 'sale-a', sourceFingerprint: stableOutboxSerialize(sale()) };
    await mutate(factory, (tx) => { tx.objectStore('metadata').put(marker); tx.objectStore('operations').put(sale()); tx.objectStore('operations').put(unrelated); });
    expect(await first.refresh('user-a')).toEqual([unrelated]); expect(await readMarker(factory, key)).toEqual(marker);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([unrelated]);
  });

  it.each(['global', 'user'])('%s valid receipt allows identical cleanup after sync/removal repeatedly; replacement blocks it', async (path) => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; storage.setItem(ownerKey, 'user-a');
    const first = new OutboxStore(storage, options); await first.ready(); const raw = snapshot([sale()]);
    if (path === 'global') { storage.setItem(globalKey, raw); await new OutboxStore(storage, options).ready(); }
    else expect(await first.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
    await first.update('sale-a', { status: 'SYNCED' }, 'user-a'); await first.removeSynced();
    for (let retry = 0; retry < 2; retry++) {
      if (path === 'global') { storage.setItem(globalKey, raw); await new OutboxStore(storage, options).ready(); expect(storage.getItem(globalKey)).toBeNull(); }
      else expect(await first.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
      expect(await first.refresh('user-a')).toEqual([]);
    }
    const replacement = snapshot([sale('replacement', 'B')]);
    if (path === 'global') { storage.setItem(globalKey, replacement); await new OutboxStore(storage, options).ready(); expect(storage.getItem(globalKey)).toBe(replacement); }
    else expect(await first.importLegacyVault('user-a', replacement, { ownershipProven: true })).toBe(false);
    expect(await first.refresh('user-a')).toEqual([]);
  });
});

describe('key/value raw receipt preservation and handoff', () => {
  it.each([false, true].flatMap((handoff) => [false, true].map((vaulted) => [handoff, vaulted] as const)))('handoff=%s vaulted=%s malformed sibling quarantines only its key and survives writes/restart/A-B-A', async (handoff, vaulted) => {
    const storage = memory(); const factory = handoff ? new IDBFactory() : undefined; const options = factory ? { indexedDB: factory } : {};
    const bad = { ...sale('malformed'), createdAt: 'invalid' };
    const receipt = { ownerId: 'user-a', raw: snapshot([sale(), bad]) };
    const extra = vaulted ? { ownerId: 'user-b', vaults: { 'user-a': [sale()] } } : {};
    const raw = rawState(vaulted ? [] : [sale(), unrelated], receipt, extra); storage.setItem(KEY_VALUE_OUTBOX_STATE_KEY, raw); storage.setItem(ownerKey, vaulted ? 'user-b' : 'user-a');
    const first = new OutboxStore(storage, options); await first.ready();
    if (vaulted) await first.transitionOwner('user-b', 'user-a');
    expect((await first.refresh('user-a')).some((item) => item.idempotencyKey === 'stable-key')).toBe(false);
    await first.enqueue({ ...unrelated, id: 'other', idempotencyKey: 'other-key' }, 'user-a');
    await first.transitionOwner('user-a', 'user-b'); await first.transitionOwner('user-b', 'user-a');
    expect((await new OutboxStore(storage, options).refresh('user-a')).some((item) => item.idempotencyKey === 'stable-key')).toBe(false);
    const persisted = JSON.parse(storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY)!);
    expect(persisted.legacyGlobalRecovery).toEqual(receipt);
    expect(quarantineOperationRecords(await persistedQuarantine(storage, options))).toContainEqual(sale());
    if (!vaulted) expect(first.list().some((item) => item.id === unrelated.id)).toBe(true);
  });

  it.each([{ ownerId: 'user-a', raw: '{broken' }, 'completely broken', { raw: '{}', ownerId: 123 }])('unidentifiable garbage is retained without blocking unrelated valid work: %j', async (receipt) => {
    const storage = memory(); storage.setItem(KEY_VALUE_OUTBOX_STATE_KEY, rawState([unrelated], receipt));
    const first = new OutboxStore(storage); expect(await first.refresh('user-a')).toEqual([unrelated]);
    await first.update(unrelated.id, { status: 'FAILED' }, 'user-a');
    expect(JSON.parse(storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY)!).legacyGlobalRecovery).toEqual(receipt);
    expect(await new OutboxStore(storage).refresh('user-a')).toHaveLength(1);
  });

  it('missing receipt owner retains known-key evidence conservatively without inventing owner or blocking unrelated work', async () => {
    const storage = memory(); const receipt = { raw: snapshot([sale()]) };
    storage.setItem(KEY_VALUE_OUTBOX_STATE_KEY, rawState([sale(), unrelated], receipt));
    const first = new OutboxStore(storage); expect(await first.refresh('user-a')).toEqual([unrelated]);
    expect(JSON.parse(storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY)!).legacyGlobalRecovery).toEqual(receipt);
  });

  it('identical key/value cleanup is restart-safe after sync/removal and later replacement conflicts remain retained', async () => {
    const storage = memory(); const raw = snapshot([sale()]); storage.setItem(globalKey, raw); storage.setItem(ownerKey, 'user-a');
    const first = new OutboxStore(storage); await first.ready(); await first.update('sale-a', { status: 'SYNCED' }, 'user-a'); await first.removeSynced();
    for (let retry = 0; retry < 2; retry++) {
      storage.setItem(globalKey, raw); await first.enqueue({ ...unrelated, id: `other-${retry}`, idempotencyKey: `other-${retry}` }, 'user-a');
      expect(storage.getItem(globalKey)).toBeNull();
      expect((await new OutboxStore(storage).refresh('user-a')).some((item) => item.idempotencyKey === 'stable-key')).toBe(false);
    }
    const persisted = JSON.parse(storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY)!);
    storage.setItem(KEY_VALUE_OUTBOX_STATE_KEY, JSON.stringify({ ...persisted, operations: [...persisted.operations, sale('later-b', 'B')] }));
    const replacement = snapshot([sale('replacement', 'B')]); storage.setItem(globalKey, replacement);
    expect((await new OutboxStore(storage).refresh('user-a')).some((item) => item.idempotencyKey === 'stable-key')).toBe(false);
    expect(storage.getItem(globalKey)).toBe(replacement);
    expect(JSON.parse(storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY)!).legacyGlobalRecovery).toEqual(persisted.legacyGlobalRecovery);
  });

  it('malformed snapshot arrays retain discoverable keyed evidence rather than disappear on a v2 write', async () => {
    const storage = memory(); const receipt = { ownerId: 'user-a', raw: JSON.stringify([sale()]) };
    storage.setItem(KEY_VALUE_OUTBOX_STATE_KEY, rawState([sale(), unrelated], receipt));
    const first = new OutboxStore(storage); expect(await first.refresh('user-a')).toEqual([unrelated]);
    await first.update(unrelated.id, { status: 'FAILED' }, 'user-a');
    expect(JSON.parse(storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY)!).legacyGlobalRecovery).toEqual(receipt);
  });

  it('malformed receipt never authorizes source deletion on subsequent writes', async () => {
    const storage = memory(); const source = snapshot([sale()]); const receipt = { ownerId: 'user-a', raw: snapshot([sale(), { idempotencyKey: 'stable-key' }]) };
    storage.setItem(globalKey, source); storage.setItem(ownerKey, 'user-a'); storage.setItem(KEY_VALUE_OUTBOX_STATE_KEY, rawState([sale(), unrelated], receipt));
    const first = new OutboxStore(storage); expect(await first.refresh('user-a')).toEqual([unrelated]);
    await first.update(unrelated.id, { status: 'FAILED' }, 'user-a');
    expect(storage.getItem(globalKey)).toBe(source); expect(JSON.parse(storage.getItem(KEY_VALUE_OUTBOX_STATE_KEY)!).legacyGlobalRecovery).toEqual(receipt);
  });
});
