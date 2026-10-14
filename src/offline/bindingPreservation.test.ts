import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { classifyOutboxReceiptEvidence, classifyOutboxRecoveryGroups, outboxOperationEvidence, quarantineOutboxEvidence, inspectOutboxEvidence, parseKeyValueOutboxRecoveryScope, KEY_VALUE_OUTBOX_STATE_KEY as stateKey,
  LEGACY_USER_IMPORT_PREFIX, legacyOutboxVaultKey, OUTBOX_EVIDENCE_MAX_DEPTH, OUTBOX_EVIDENCE_MAX_NODES } from './outboxRecovery';
import type { KeyValueStorage } from './storage';
import { persistedQuarantine } from './outboxRecoveryTestUtils';
function memory(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
function sale(id = 'a', intent = 'A'): OutboxOperation {
  return { id, idempotencyKey: 'stable-key', kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
    createdAt: '2026-10-10T12:00:00Z', status: 'PENDING', attemptCount: 0,
    payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: intent } };
}
const c = { ...sale('c'), idempotencyKey: 'unrelated-key' };
function fingerprint(limit: string): unknown {
  let value: unknown = 'garbage';
  if (limit === 'nodes') return Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 4 }, () => 'garbage');
  for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH + 4; i++) value = [value]; return value;
}
function boundReceipt(limit: string) {
  const encoded = JSON.stringify(['user-a', 'stable-key']); const key = LEGACY_USER_IMPORT_PREFIX + encoded;
  return { encoded, key, marker: { key, importedId: 'a', sourceFingerprint: JSON.stringify(fingerprint(limit)) } };
}
afterEach(() => vi.restoreAllMocks());
describe('binding preservation', () => {
  it.each(['operations', 'vault'])('valid archive %s keyed malformed wrapper still exposes its independently keyed child', field => {
    const wrapper = { idempotencyKey: 'wrapper-key', record: sale('b', 'B') };
    const scope = parseKeyValueOutboxRecoveryScope(JSON.stringify({ version: 2, ownerId: 'user-a', operations: field === 'operations' ? [wrapper] : [], vaults: field === 'vault' ? { 'user-a': [wrapper] } : {} }), 'user-a')!;
    expect(scope.records).toContainEqual(wrapper); expect(scope.witnesses).toContainEqual(sale('b', 'B'));
  });
  it('wrapper X and child Y remain separate fragments; conflict on Y holds Y without poisoning C', () => {
    const wrapper = { idempotencyKey: 'wrapper-key', record: sale('b', 'B') };
    const extracted = inspectOutboxEvidence(wrapper, 'user-a');
    expect(extracted.records).toEqual([wrapper, sale('b', 'B')]);
    const evidence = outboxOperationEvidence([wrapper], 'user-a');
    expect(evidence.blockedKeys).toEqual(new Set(['wrapper-key']));
    const classified = classifyOutboxRecoveryGroups([sale(), c, wrapper, ...evidence.records], evidence.blockedKeys);
    expect(classified.operations).toEqual([c]); expect(classified.groups.has('wrapper-key')).toBe(true); expect(classified.groups.has('stable-key')).toBe(true);
  });
  it('a safely identified canonical child overrides inherited receipt binding without erasing parent evidence', () => {
    const child = { ...c, records: Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 4 }, () => 'garbage') };
    const extracted = inspectOutboxEvidence({ idempotencyKey: 'wrapper-key', record: child }, 'user-a', false, 'stable-key', 'RECEIPT');
    expect(extracted.records.map(row => (row as { idempotencyKey: string }).idempotencyKey)).toEqual(['wrapper-key', 'unrelated-key']);
    expect(extracted.incomplete).not.toBe(true);
    expect(extracted.uncertainties).toContainEqual({ ownerId: 'user-a', idempotencyKey: 'unrelated-key', reason: 'NODE_LIMIT' });
  });
  it('retained malformed-row quarantine rejects X while comparing its independent valid child as a witness', () => {
    const row = { id: 'wrapper', idempotencyKey: 'wrapper-key', record: c };
    const evidence = quarantineOutboxEvidence({ ownerId: 'user-a', records: [{ record: row, reason: 'MALFORMED_ENVELOPE' }] }, 'user-a');
    expect(evidence.records).toContainEqual(c); expect(evidence.blockedKeys).toEqual(new Set(['wrapper-key']));
    expect(quarantineOutboxEvidence({ ownerId: 'user-a', records: [{ record: row, reason: 'IMMUTABLE_CONFLICT' }] }, 'user-a').blockedKeys).toEqual(new Set(['wrapper-key', 'unrelated-key']));
  });
  it.each(['operations', 'vault'].flatMap(field => ['record', 'records', 'same key', 'raw', 'malformed child', 'unrelated child'].flatMap(shape => [false, true].map(vaulted => [field, shape, vaulted] as const))))(
    'archive %s %s vaulted=%s classifies both keys at refresh/cleanup/restart without losing source', async (field, shape, vaulted) => {
      const storage = memory(); const options = { indexedDB: new IDBFactory() }; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); const source = JSON.stringify({ operations: [sale()] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
      const child = shape === 'unrelated child' ? c : shape === 'malformed child' ? { ...sale('bad'), createdAt: 'invalid' } : sale('b', 'B');
      const wrapper = { idempotencyKey: shape === 'same key' ? 'stable-key' : 'wrapper-key', ...(shape === 'raw' ? { raw: JSON.stringify({ record: child }) }
        : shape === 'records' ? { records: [{ record: child }] } : { record: child }) };
      const raw = JSON.stringify({ version: 2, ownerId: 'user-a', operations: field === 'operations' ? [wrapper] : [], vaults: field === 'vault' ? { 'user-a': [wrapper] } : {} }); storage.setItem(stateKey, raw);
      if (vaulted) await outbox.transitionOwner('user-b', 'user-a');
      const expected = shape === 'unrelated child' ? [sale(), c] : [c];
      expect(await outbox.refresh('user-a')).toEqual(expected);
      expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(shape === 'unrelated child');
      if (shape !== 'unrelated child') expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
      expect(storage.getItem(stateKey)).toBe(raw); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual(expected);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual(expected);
    });
  it.each([false, true].flatMap(indexed => [false, true].flatMap(vaulted => ['conflict', 'malformed', 'unrelated'].map(kind => [indexed, vaulted, kind] as const))))(
    'indexed=%s destination wrapper vaulted=%s child=%s survives normalization/cleanup/restart with both keys preserved', async (indexed, vaulted, kind) => {
      const storage = memory(); const factory = indexed ? new IDBFactory() : undefined; const options = factory ? { indexedDB: factory } : {}; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); const source = JSON.stringify({ operations: [sale()] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      const child = kind === 'unrelated' ? c : kind === 'malformed' ? { ...sale('bad'), createdAt: 'invalid' } : sale('b', 'B');
      const wrapper = { id: 'wrapper', idempotencyKey: 'wrapper-key', ...(vaulted ? { ownerId: 'user-a' } : {}), record: child };
      if (factory) {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try { await new Promise<void>((resolve, reject) => { const store = vaulted ? 'vaultOperations' : 'operations'; const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(wrapper); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
      } else {
        const state = JSON.parse(storage.getItem(stateKey)!);
        storage.setItem(stateKey, JSON.stringify(vaulted ? { ...state, vaults: { ...state.vaults, 'user-a': [wrapper] } } : { ...state, operations: [...state.operations, wrapper] }));
      }
      const expected = kind === 'unrelated' ? [sale(), c] : [c]; expect(await outbox.refresh('user-a')).toEqual(expected);
      expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(kind === 'unrelated');
      if (kind !== 'unrelated') expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
      const retained = await persistedQuarantine(storage, options); expect(retained).toContainEqual({ record: wrapper, reason: 'MALFORMED_ENVELOPE' });
      expect(quarantineOutboxEvidence({ ownerId: 'user-a', records: retained }, 'user-a').records).toContainEqual(child);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual(expected);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual(expected);
    });
  it.each(['nodes', 'depth'])('receipt bound key survives %s array traversal exhaustion', limit => {
    const { marker, key } = boundReceipt(limit);
    const evidence = classifyOutboxReceiptEvidence(marker, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.incomplete).not.toBe(true);
    expect(evidence.blockedKeys).toEqual(new Set(['stable-key']));
    expect(evidence.uncertainties).toContainEqual({ ownerId: 'user-a', idempotencyKey: 'stable-key', reason: limit === 'nodes' ? 'NODE_LIMIT' : 'DEPTH_LIMIT' });
  });
  it.each([false, true].flatMap(indexed => ['nodes', 'depth'].map(limit => [indexed, limit] as const)))('indexed=%s %s receipt array exhaustion holds only A and preserves C across restart/A-B-A', async (indexed, limit) => {
    const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale(), 'user-a'); await outbox.enqueue(c, 'user-a');
    const { marker, encoded } = boundReceipt(limit);
    const state = indexed ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(storage.getItem(stateKey)!);
    storage.setItem(stateKey, JSON.stringify({ ...state, legacyVaultReceipts: { [encoded]: marker } }));
    expect(await outbox.refresh('user-a')).toEqual([c]); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
    await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
    await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([c]);
    expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceipts[encoded]).toEqual(marker);
  });
});
