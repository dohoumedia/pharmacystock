import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation, type OutboxStoreOptions } from './outbox';
import { KEY_VALUE_OUTBOX_STATE_KEY as stateKey, LEGACY_USER_IMPORT_PREFIX, legacyOutboxVaultKey,
  OUTBOX_EVIDENCE_MAX_DEPTH, OUTBOX_EVIDENCE_MAX_NODES, classifyOutboxReceiptEvidence, parseKeyValueOutboxRecoveryScope, quarantineOutboxEvidence, scopedOutboxQuarantineEvidence } from './outboxRecovery';
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
const c = { ...sale('independent'), idempotencyKey: 'independent-key' };
const shapes = ['nested', 'direct', 'raw', 'entry record', 'records object'] as const;
function fields(shape: typeof shapes[number], b = sale('source-b', 'B')) {
  if (shape === 'nested') return { records: [{ record: { records: { record: b } } }] };
  if (shape === 'direct') return { records: [{ record: b, reason: 'IMMUTABLE_CONFLICT' }] };
  if (shape === 'entry record') return { record: b, reason: 'IMMUTABLE_CONFLICT' };
  if (shape === 'raw') return { raw: JSON.stringify({ quarantine: [{ records: { record: b } }] }), reason: 'IMMUTABLE_CONFLICT' };
  return { records: { record: b, reason: 'IMMUTABLE_CONFLICT' } };
}
function source(operation = sale()) { return JSON.stringify({ operations: [operation] }); }
async function metadata(factory: IDBFactory, mutate?: (store: IDBObjectStore) => void): Promise<Record<string, unknown> | undefined> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('pharmacystock:outbox:v2', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try { return await new Promise((resolve, reject) => {
    const tx = database.transaction('metadata', mutate ? 'readwrite' : 'readonly'); const store = tx.objectStore('metadata');
    mutate?.(store); const request = store.get('persisted-outbox-v2:quarantine:"user-a"');
    tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error);
  }); } finally { database.close(); }
}
async function install(storage: KeyValueStorage, options: OutboxStoreOptions, value: unknown, rootGarbage = false) {
  if (options.indexedDB) {
    await metadata(options.indexedDB, (store) => store.put({ key: 'persisted-outbox-v2:quarantine:"user-a"', ownerId: 'user-a',
      ...(rootGarbage ? { records: value } : value as object) }));
  } else {
    const state = JSON.parse(storage.getItem(stateKey)!);
    storage.setItem(stateKey, JSON.stringify({ ...state, quarantine: rootGarbage ? value : [{ ownerId: 'user-a', ...value as object }] }));
  }
}
async function retained(storage: KeyValueStorage, options: OutboxStoreOptions) {
  return options.indexedDB ? metadata(options.indexedDB) : JSON.parse(storage.getItem(stateKey)!).quarantine;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('persisted quarantine authoritative evidence', () => {
  it.each([false, true].flatMap((indexed) => shapes.flatMap((shape) => [false, true].map((vaulted) => [indexed, shape, vaulted] as const))))(
    'indexed=%s %s blocks active/vaulted=%s matching work at refresh without recovery and survives restart/A-B-A', async (indexed, shape, vaulted) => {
      const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale(), 'user-a'); await outbox.enqueue(c, 'user-a');
      if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
      await install(storage, options, fields(shape));
      if (vaulted) { expect(await outbox.refresh('user-b')).toEqual([]); await outbox.transitionOwner('user-b', 'user-a'); }
      expect(await outbox.refresh('user-a')).toEqual([c]);
      expect(quarantineOutboxEvidence(await retained(storage, options), 'user-a').records).toContainEqual(sale('source-b', 'B'));
      if (shape === 'raw') {
        const stored = await retained(storage, options);
        const entry = Array.isArray(stored) ? stored.find((item) => item.raw !== undefined) : stored;
        expect(entry?.raw).toBe(fields('raw').raw);
      }
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([c]);
    });
  it.each([false, true].flatMap((indexed) => shapes.map((shape) => [indexed, shape] as const)))(
    'indexed=%s %s blocks cleanup after prior successful import and retains source/evidence on retry', async (indexed, shape) => {
      const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); const raw = source(); storage.setItem(legacyOutboxVaultKey('user-a'), raw);
      expect(await outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
      await install(storage, options, fields(shape));
      expect(await outbox.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false);
      expect(await outbox.refresh('user-a')).toEqual([]); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(raw);
      const restart = new OutboxStore(storage, options); expect(await restart.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false);
      expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(raw);
      expect(quarantineOutboxEvidence(await retained(storage, options), 'user-a').records).toContainEqual(sale('source-b', 'B'));
      if (shape === 'raw') {
        const stored = await retained(storage, options);
        const entry = Array.isArray(stored) ? stored.find((item) => item.raw !== undefined) : stored;
        expect(entry?.raw).toBe(fields('raw').raw);
      }
    });
  it.each([false, true].flatMap((indexed) => ['string', 'number', 'object', 'records object'].map((shape) => [indexed, shape] as const)))(
    'indexed=%s %s unidentifiable garbage never crashes/poisons C, remains durable and cannot authorize cleanup', async (indexed, shape) => {
      const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a');
      const garbage = shape === 'string' ? 'unidentifiable quarantine garbage' : shape === 'number' ? 42
        : shape === 'object' ? { opaque: true } : { ownerId: 'user-a', records: { opaque: true } };
      await install(storage, options, garbage, true); const before = await retained(storage, options);
      const raw = source(c); storage.setItem(legacyOutboxVaultKey('user-a'), raw);
      expect(await outbox.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false);
      expect(await outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
      expect(await outbox.refresh('user-a')).toEqual([c]);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([c]);
      expect(await retained(storage, options)).toEqual(before);
      expect(await outbox.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(true);
      await outbox.update(c.id, { status: 'SYNCED' }, 'user-a'); await outbox.removeSynced();
      expect(await new OutboxStore(storage, options).importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
      expect(await outbox.refresh('user-a')).toEqual([]); expect(await retained(storage, options)).toEqual(before);
      if (!indexed) {
        expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceipts[JSON.stringify(['user-a', c.idempotencyKey])].importedId).toBe(c.id);
        // Supported browser handoff also retains the malformed source quarantine.
        expect(await new OutboxStore(storage, { indexedDB: new IDBFactory() }).refresh('user-a')).toEqual([]);
      }
    });
  it.each(['entry record', 'raw', 'nested'].flatMap((shape) => [2, 99].map((version) => [shape, version] as const)))(
    'scoped archive %s under version=%s blocks A but leaves B owner isolated', async (shape, version) => {
      const storage = memory(); const options = { indexedDB: new IDBFactory() }; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale(), 'user-a');
      const raw = JSON.stringify({ version, ownerId: 'user-a', operations: [], vaults: {}, quarantine: [{ ownerId: 'user-a', ...fields(shape as typeof shapes[number]) }] });
      storage.setItem(stateKey, raw); expect(await outbox.refresh('user-a')).toEqual([]);
      await outbox.transitionOwner('user-a', 'user-b'); await outbox.enqueue(c, 'user-b'); expect(await outbox.refresh('user-b')).toEqual([c]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([]);
      expect(storage.getItem(stateKey)).toBe(raw);
    });
});

describe('bounded recognizable quarantine extraction', () => {
  it('walks known record/raw/receipt shapes, handles cycles, and ignores arbitrary payload/object fields', () => {
    const b = sale('b', 'B'); const cyclic: Record<string, unknown> = { record: b }; cyclic.records = cyclic;
    expect(quarantineOutboxEvidence(cyclic, 'user-a').blockedKeys).toEqual(new Set(['stable-key']));
    expect(quarantineOutboxEvidence({ opaque: { record: b }, payload: { record: b } }, 'user-a').blockedKeys.size).toBe(0);
    const marker = { key: LEGACY_USER_IMPORT_PREFIX + JSON.stringify(['user-a', 'stable-key']), importedId: '', sourceFingerprint: 'garbage' };
    expect(scopedOutboxQuarantineEvidence({ ownerId: 'user-a', raw: { records: [marker] } }, 'user-a').blockedKeys).toEqual(new Set(['stable-key']));
    expect(scopedOutboxQuarantineEvidence({ ownerId: 'user-b', record: b }, 'user-a').blockedKeys.size).toBe(0);
  });
  it('rejected list/encoded roots preserve explicitly named vault scope independently of a different active owner', () => {
    const states = [
      { version: 2, ownerId: 'user-b', operations: [c], vaults: { 'user-a': [sale('b', 'B')] } },
      { version: 2, ownerId: 'user-b', operations: [c], vaults: {}, quarantine: [{ ownerId: 'user-a', record: sale('b', 'B') }] },
    ];
    for (const state of states) for (const raw of [JSON.stringify([state]), JSON.stringify(JSON.stringify(state))]) {
      expect(parseKeyValueOutboxRecoveryScope(raw, 'user-a')!.blockedKeys).toEqual(new Set(['stable-key']));
      expect(parseKeyValueOutboxRecoveryScope(raw, 'user-b')!.blockedKeys).toEqual(new Set(['independent-key']));
    }
  });
  it('receipt extraction retains nested namespace-only keyed evidence without a valid operation', () => {
    const marker = { key: LEGACY_USER_IMPORT_PREFIX + JSON.stringify(['user-a', 'stable-key']), importedId: '', sourceFingerprint: 'garbage' };
    const evidence = classifyOutboxReceiptEvidence({ ownerId: 'user-a', raw: JSON.stringify({ records: [marker] }) });
    expect(evidence.valid).toBe(false);
    expect(evidence.blockedKeys).toEqual(new Set(['stable-key']));
    expect(evidence.importedIds.size).toBe(0);
  });
  it.each(['depth', 'nodes'])('exhausted %s inspection is fail-closed for existing owner work and preserves raw', async (limit) => {
    let raw: unknown = { record: sale('b', 'B') };
    if (limit === 'depth') for (let index = 0; index < OUTBOX_EVIDENCE_MAX_DEPTH + 2; index++) raw = { record: raw };
    else raw = Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 2 }, () => 'garbage');
    expect(quarantineOutboxEvidence(raw, 'user-a').incomplete).toBe(true);
    for (const options of [{}, { indexedDB: new IDBFactory() }]) {
      const storage = memory(); const outbox = new OutboxStore(storage, options); await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale(), 'user-a');
      await install(storage, options, { records: raw });
      expect(await outbox.refresh('user-a')).toEqual([]);
      const stored = await retained(storage, options);
      if (Array.isArray(raw)) {
        const entries = Array.isArray(stored) ? stored : [stored];
        const entry = entries.find((item) => Array.isArray(item.records) && item.records.length >= raw.length);
        expect(entry.records.slice(0, raw.length)).toEqual(raw);
      } else expect(JSON.stringify(stored)).toContain(JSON.stringify(raw));
    }
  });
});
