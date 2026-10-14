import { IDBFactory, IDBKeyRange, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { KEY_VALUE_OUTBOX_STATE_KEY as stateKey, legacyOutboxVaultKey, OUTBOX_EVIDENCE_MAX_DEPTH,
  scopedOutboxReceiptEvidence } from './outboxRecovery';
import { persistedQuarantine } from './outboxRecoveryTestUtils';
import type { KeyValueStorage } from './storage';

const prefix = 'persisted-outbox-v2:quarantine:';
function memory(): KeyValueStorage { const data = new Map<string, string>(); return { getItem: key => data.get(key) ?? null,
  setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }; }
function sale(id = 'a', intent = 'A'): OutboxOperation { return { id, idempotencyKey: 'stable-a', kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
  createdAt: '2026-10-13T12:00:00Z', status: 'PENDING', attemptCount: 0, payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: intent } }; }
const a = sale(); const c = { ...sale('c'), idempotencyKey: 'unrelated-c' };
function wrapper(shape: string, child: unknown, owner: unknown = 'user-b') {
  const fields = shape === 'records' ? { records: [child] } : shape === 'raw' ? { raw: JSON.stringify(child) }
    : shape === 'fingerprint' ? { sourceFingerprint: JSON.stringify(child) } : shape === 'nested' ? { records: { record: { raw: JSON.stringify(child) } } } : { record: child };
  return { ...(owner === undefined ? {} : { ownerId: owner }), ...fields };
}
async function metadata(factory: IDBFactory, value: object, read = false): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { return await new Promise((resolve, reject) => { const tx = db.transaction('metadata', read ? 'readonly' : 'readwrite');
    const request = read ? tx.objectStore('metadata').get((value as { key: string }).key) : tx.objectStore('metadata').put(value);
    tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
}
async function install(path: string, storage: KeyValueStorage, factory: IDBFactory | undefined, marker: object) {
  if (path === 'quarantine') { const row = { key: prefix + JSON.stringify('user-b'), ...marker }; await metadata(factory!, row); return row; }
  const prior = storage.getItem(stateKey); const state = path === 'native-map' ? JSON.parse(prior!) : { version: 2, ownerId: 'user-a', operations: [], vaults: {} };
  storage.setItem(stateKey, JSON.stringify({ ...state, legacyVaultReceipts: { ...state.legacyVaultReceipts, broken: marker } })); return marker;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('namespace ownership routing', () => {
  it.each([undefined, 42])('known foreign receipt-map namespace keeps exhausted unowned children foreign, header=%s', header => {
    let nested: unknown = 'unidentifiable'; for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH + 2; i++) nested = [nested];
    const encoded = JSON.stringify(['user-b', 'foreign-key']); const evidence = scopedOutboxReceiptEvidence({ [encoded]: { ...(header === undefined ? {} : { ownerId: header }), records: nested } }, 'user-a');
    expect(evidence.incomplete).not.toBe(true); expect(evidence.blockedKeys.size).toBe(0); expect(evidence.importedIds?.size ?? 0).toBe(0);
    expect(evidence.uncertainties?.every(item => item.ownerId === 'user-b')).toBe(true);
  });
  it.each([false, true])('malformed physical quarantine namespace explicit=%s requires safe child scope without identity invention', async explicit => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(a, 'user-a'); await outbox.enqueue(c, 'user-a');
    const retained = { key: prefix + 'broken', ownerId: 42, record: { ...sale('b', 'B'), ...(explicit ? { ownerId: 'user-a' } : {}) } };
    await metadata(factory, retained); expect(await outbox.refresh('user-a')).toEqual(explicit ? [c] : [a, c]);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual(explicit ? [c] : [a, c]);
    expect(await metadata(factory, retained, true)).toEqual(retained);
  });

  it.each(['quarantine', 'native-map', 'archive-map'].flatMap(path => ['record', 'records', 'raw', 'nested', 'fingerprint'].flatMap(shape => [false, true].map(vaulted => [path, shape, vaulted] as const))))(
    '%s %s vaulted=%s explicitly A child blocks only A at refresh/cleanup/restart/A-B-A', async (path, shape, vaulted) => {
      const storage = memory(); const factory = path === 'native-map' ? undefined : new IDBFactory(); const options = factory ? { indexedDB: factory } : {};
      const outbox = new OutboxStore(storage, options); await outbox.transitionOwner(null, 'user-a');
      const source = JSON.stringify({ operations: [a] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
      const marker = wrapper(shape, { ...sale('b', 'B'), ownerId: 'user-a' }); const retained = await install(path, storage, factory, marker);
      if (vaulted) await outbox.transitionOwner('user-b', 'user-a');
      expect(await outbox.refresh('user-a')).toEqual([c]);
      expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
      expect(await persistedQuarantine(storage, options)).toEqual(expect.arrayContaining([expect.objectContaining({ record: expect.objectContaining({ id: a.id }) })]));
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
      if (path === 'quarantine') expect(await metadata(factory!, retained, true)).toEqual(retained);
      else expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceipts.broken).toEqual(marker);
    });
  it.each(['quarantine', 'native-map', 'archive-map'].flatMap(path => ['unowned', 'foreign', 'ambiguous', 'garbage'].map(kind => [path, kind] as const)))(
    '%s %s foreign children cannot be adopted or poison A/valid cleanup', async (path, kind) => {
      const storage = memory(); const factory = path === 'native-map' ? undefined : new IDBFactory(); const options = factory ? { indexedDB: factory } : {};
      const outbox = new OutboxStore(storage, options); await outbox.transitionOwner(null, 'user-a');
      const source = JSON.stringify({ operations: [a] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      const child = kind === 'garbage' ? 'unidentifiable garbage' : { ...sale('b', 'B'), ...(kind === 'foreign' ? { ownerId: 'user-b' } : kind === 'ambiguous' ? { ownerId: 42 } : {}) };
      // Physical B namespace supplies scope even if its immediate wrapper has no safe owner.
      const marker = wrapper('record', child, path === 'quarantine' ? undefined : 'user-b'); const retained = await install(path, storage, factory, marker);
      expect(await outbox.refresh('user-a')).toEqual([a, c]); expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(true);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([a, c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([a, c]);
      if (path === 'quarantine') expect(await metadata(factory!, retained, true)).toEqual(retained);
      else expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceipts.broken).toEqual(marker);
    });
  it.each([undefined, 'arbitrary-marker-key'])('malformed receipt child key=%s still routes descendants without completion proof', key => {
    const child = { ...sale('b', 'B'), ownerId: 'user-a', record: { ...c, ownerId: 'user-b' } };
    const marker = { ...wrapper('record', child), ...(key === undefined ? {} : { key }) };
    const evidence = scopedOutboxReceiptEvidence({ broken: marker, raw: 'garbage' }, 'user-a');
    expect(evidence.records).toContainEqual(child); expect(evidence.records).not.toContainEqual(child.record);
    expect(evidence.blockedKeys).toEqual(new Set(['stable-a'])); expect(evidence.importedIds?.size ?? 0).toBe(0);
  });
  it('receipt B keyed parent X keeps child A/Y and inherited A descendants independent of B grandchild C', () => {
    const own = { ...a, ownerId: 'user-a', records: [{ ...sale('d'), idempotencyKey: 'inherited-a' }, { ...c, ownerId: 'user-b' }] };
    const evidence = scopedOutboxReceiptEvidence({ broken: { ownerId: 'user-b', idempotencyKey: 'foreign-wrapper', record: own } }, 'user-a');
    expect(evidence.blockedKeys).toEqual(new Set(['stable-a', 'inherited-a'])); expect(evidence.importedIds?.size ?? 0).toBe(0);
  });
  it.each([false, true])('foreign namespace explicit A descendant near depth budget malformedParent=%s stays key-scoped', async malformedParent => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(a, 'user-a'); await outbox.enqueue(c, 'user-a');
    let nested: unknown = { ...sale('b', 'B'), ownerId: 'user-a' }; for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH - 1; i++) nested = { ownerId: 'user-b', record: nested };
    await metadata(factory, { key: prefix + JSON.stringify('user-b'), ...(malformedParent ? { ownerId: 42 } : {}), record: nested });
    expect(await outbox.refresh('user-a')).toEqual([c]); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
  });
  it('prefix enumeration ignores unrelated metadata and uses bounded native IDB key ranges', async () => {
    vi.stubGlobal('IDBKeyRange', IDBKeyRange); const storage = memory(); const factory = new IDBFactory(); const outbox = new OutboxStore(storage, { indexedDB: factory });
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(a, 'user-a');
    await metadata(factory, { key: 'unrelated-metadata', ownerId: 'user-a', record: { ...sale('b', 'B'), ownerId: 'user-a' } });
    const calls: unknown[] = []; const original = FakeObjectStore.prototype.openCursor;
    vi.spyOn(FakeObjectStore.prototype, 'openCursor').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'metadata') calls.push(args[0]); return original.apply(this, args);
    });
    expect(await outbox.refresh('user-a')).toEqual([a]);
    expect(calls.some(range => range instanceof IDBKeyRange && range.lower === prefix && range.upperOpen)).toBe(true);
    expect(calls.every(range => range instanceof IDBKeyRange)).toBe(true);
  });
});
