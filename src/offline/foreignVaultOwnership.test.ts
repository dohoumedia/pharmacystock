import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { KEY_VALUE_OUTBOX_STATE_KEY as stateKey, legacyOutboxVaultKey, OUTBOX_EVIDENCE_MAX_DEPTH,
  parseKeyValueOutboxRecoveryScope } from './outboxRecovery';
import { persistedQuarantine } from './outboxRecoveryTestUtils';
import type { KeyValueStorage } from './storage';

function memory(): KeyValueStorage { const data = new Map<string, string>(); return { getItem: key => data.get(key) ?? null,
  setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }; }
function sale(id = 'a', intent = 'A'): OutboxOperation { return { id, idempotencyKey: 'stable-a', kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
  createdAt: '2026-10-13T12:00:00Z', status: 'PENDING', attemptCount: 0, payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: intent } }; }
const a = sale(); const c = { ...sale('c'), idempotencyKey: 'unrelated-c' };
function row(shape: string, child: unknown) {
  const fields = shape === 'records' ? { records: [child] } : shape === 'raw' ? { raw: JSON.stringify(child) }
    : shape === 'nested' ? { record: { records: { raw: JSON.stringify(child) } } } : { record: child };
  return { id: 'foreign-wrapper', ownerId: 'user-b', idempotencyKey: 'foreign-wrapper-key', ...fields };
}
async function dbRequest(factory: IDBFactory, store: string, value: object | IDBValidKey, read = false): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('pharmacystock:outbox:v2', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { return await new Promise((resolve, reject) => { const tx = db.transaction(store, read ? 'readonly' : 'readwrite');
    const request = read ? tx.objectStore(store).get(value as IDBValidKey) : tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
}
async function install(path: string, storage: KeyValueStorage, factory: IDBFactory, wrapper: object) {
  if (path === 'physical') { await dbRequest(factory, 'vaultOperations', wrapper); return null; }
  const base = { version: path === 'invalid-version' ? 99 : 2, ownerId: 'user-a', operations: [], vaults: { 'user-b': path === 'invalid-slot' ? { records: [wrapper] } : [wrapper] } };
  const raw = JSON.stringify(path === 'root-array' ? [base] : path === 'root-string' ? JSON.stringify(base) : base);
  storage.setItem(stateKey, raw); return raw;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('foreign vault ownership', () => {
  it.each([false, true].flatMap(nativeRange => ['a', 'aa', 'b'].map(selected => [nativeRange, selected] as const)))(
    'LOW vault owner-index boundary nativeRange=%s selected=%s sees adjacent/first/last foreign owners', async (nativeRange, selected) => {
      vi.stubGlobal('IDBKeyRange', nativeRange ? IDBKeyRange : undefined);
      const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, selected); await outbox.enqueue(a, selected); await outbox.enqueue(c, selected);
      for (const owner of ['a', 'aa', 'b'].filter(owner => owner !== selected)) {
        const wrapper = { ...row('record', { ...sale('b', 'B'), ownerId: selected }), id: 'wrapper-' + owner, ownerId: owner };
        await dbRequest(factory, 'vaultOperations', wrapper);
      }
      expect(await outbox.refresh(selected)).toEqual([c]); expect(await new OutboxStore(storage, options).refresh(selected)).toEqual([c]);
      for (const owner of ['a', 'aa', 'b'].filter(owner => owner !== selected)) {
        expect(await dbRequest(factory, 'vaultOperations', [owner, 'wrapper-' + owner], true)).toBeDefined();
      }
    });

  it.each(['physical', 'archive', 'invalid-version', 'invalid-slot', 'root-array', 'root-string'].flatMap(path => ['record', 'records', 'raw', 'nested'].flatMap(shape => [false, true].map(vaulted => [path, shape, vaulted] as const))))(
    '%s %s vaulted=%s child A disputes only A across visibility/cleanup/restart/A-B-A', async (path, shape, vaulted) => {
      const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); const source = JSON.stringify({ operations: [a] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
      const child = { ...sale('b', 'B'), ownerId: 'user-a', record: { ...c, ownerId: 'user-b' } }; const wrapper = row(shape, child);
      const raw = await install(path, storage, factory, wrapper);
      if (vaulted) await outbox.transitionOwner('user-b', 'user-a');
      expect(await outbox.refresh('user-a')).toEqual([c]); expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false);
      expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
      if (raw !== null) expect(storage.getItem(stateKey)).toBe(raw);
      else { const stored = await dbRequest(factory, 'vaultOperations', ['user-b', wrapper.id], true);
        const retained = await persistedQuarantine(storage, options, 'user-b');
        expect(stored === undefined ? retained.map(item => item.record) : [stored]).toContainEqual(wrapper); }
    });
  it.each(['physical', 'archive', 'invalid-version'].flatMap(path => ['unowned', 'foreign', 'ambiguous', 'garbage'].map(kind => [path, kind] as const)))(
    '%s %s foreign children are not adopted and do not block A cleanup', async (path, kind) => {
      const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); const source = JSON.stringify({ operations: [a] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      const child = kind === 'garbage' ? 'unidentifiable' : { ...sale('b', 'B'), ...(kind === 'foreign' ? { ownerId: 'user-b' } : kind === 'ambiguous' ? { ownerId: 42 } : {}) };
      const raw = await install(path, storage, factory, row('record', child));
      expect(await outbox.refresh('user-a')).toEqual([a, c]); expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(true);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([a, c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([a, c]);
      if (raw !== null) expect(storage.getItem(stateKey)).toBe(raw);
    });
  it.each(['physical', 'archive'])('%s foreign descendant is a witness, never a new replay candidate or completion receipt', async path => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(c, 'user-a');
    const wrapper = row('record', { ...a, ownerId: 'user-a' }); await install(path, storage, factory, wrapper);
    expect(await outbox.refresh('user-a')).toEqual([c]); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
    if (path === 'archive') { const view = parseKeyValueOutboxRecoveryScope(storage.getItem(stateKey)!, 'user-a')!;
      expect(view.records).toEqual([]); expect(view.witnesses).toContainEqual(wrapper.record); }
  });
  it.each(['physical', 'archive'])('%s identical explicitly A-owned witness preserves active identity/exact retry and safe cleanup', async path => {
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); const source = JSON.stringify({ operations: [a] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
    expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
    await install(path, storage, factory, row('record', { ...a, id: 'identical-retry', ownerId: 'user-a' }));
    expect(await outbox.refresh('user-a')).toEqual([a, c]); expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(true);
  });
  it.each(['physical', 'archive'].flatMap(path => [false, true].map(explicit => [path, explicit] as const)))(
    '%s foreign exhausted wrapper explicit=%s retains narrow scope', async (path, explicit) => {
      const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(a, 'user-a'); await outbox.enqueue(c, 'user-a');
      let child: unknown = { ...sale('b', 'B'), ...(explicit ? { ownerId: 'user-a' } : {}) };
      for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH - 1; i++) child = { record: child };
      await install(path, storage, factory, row('record', child));
      expect(await outbox.refresh('user-a')).toEqual(explicit ? [c] : [a, c]);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual(explicit ? [c] : [a, c]);
    });
  it.each([false, true])('LOW multiple foreign quarantine namespaces nativeRange=%s route only explicitly re-owned evidence', async nativeRange => {
    vi.stubGlobal('IDBKeyRange', nativeRange ? IDBKeyRange : undefined);
    const storage = memory(); const factory = new IDBFactory(); const options = { indexedDB: factory }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(a, 'user-a'); await outbox.enqueue(c, 'user-a');
    const foreign = { key: 'persisted-outbox-v2:quarantine:"user-b"', record: { ...sale('b', 'B'), ownerId: 'user-a' } };
    const unrelated = { key: 'persisted-outbox-v2:quarantine:"user-d"', records: [{ ...c, payload: { ...c.payload as object, saleNumber: 'foreign C' } }] };
    await dbRequest(factory, 'metadata', foreign); await dbRequest(factory, 'metadata', unrelated);
    expect(await outbox.refresh('user-a')).toEqual([c]); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
    expect(await dbRequest(factory, 'metadata', foreign.key, true)).toEqual(foreign); expect(await dbRequest(factory, 'metadata', unrelated.key, true)).toEqual(unrelated);
  });
});
