import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { classifyOutboxReceiptEvidence, inspectOutboxEvidence, quarantineOutboxEvidence, KEY_VALUE_OUTBOX_STATE_KEY as stateKey,
  LEGACY_USER_IMPORT_PREFIX, OUTBOX_EVIDENCE_MAX_DEPTH, OUTBOX_EVIDENCE_MAX_NODES, legacyOutboxVaultKey } from './outboxRecovery';
import type { KeyValueStorage } from './storage';
function memory(): KeyValueStorage { const data = new Map<string, string>(); return { getItem: key => data.get(key) ?? null,
  setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }; }
function sale(id = 'a', intent = 'A'): OutboxOperation { return { id, idempotencyKey: 'stable-key', kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
  createdAt: '2026-10-10T12:00:00Z', status: 'PENDING', attemptCount: 0, payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: intent } }; }
const c = { ...sale('c'), idempotencyKey: 'unrelated-key' };
function foreign(shape: string, child: unknown) {
  const nested = shape === 'records' ? { records: [child] } : shape === 'raw' ? { raw: JSON.stringify(child) }
    : shape === 'fingerprint' ? { sourceFingerprint: JSON.stringify(child) } : { record: child };
  return { ownerId: 'user-b', ...nested };
}
function marker(intent: unknown = { ...sale(), ownerId: 'user-b' }) { const encoded = JSON.stringify(['user-a', 'stable-key']); const key = LEGACY_USER_IMPORT_PREFIX + encoded;
  return { encoded, key, value: { key, ownerId: 'user-a', importedId: 'a', sourceFingerprint: JSON.stringify(intent) } }; }
describe('explicit ownership', () => {
  it.each(['record', 'records', 'raw', 'fingerprint'])('foreign %s wrapper cannot hide explicit current-owner evidence', shape => {
    const child = { ...sale('b', 'B'), ownerId: 'user-a' };
    expect(inspectOutboxEvidence([foreign(shape, child)], 'user-a').records).toContainEqual(child);
    expect(quarantineOutboxEvidence([foreign(shape, child)], 'user-a').blockedKeys).toContain('stable-key');
  });
  it.each([false, true].flatMap(indexed => ['record', 'records', 'raw', 'fingerprint'].flatMap(shape => [false, true].map(vaulted => [indexed, shape, vaulted] as const))))(
    'indexed=%s foreign %s wrapper with vaulted=%s A child blocks refresh/cleanup and retains evidence through restart/A-B-A', async (indexed, shape, vaulted) => {
      const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); const source = JSON.stringify({ operations: [sale()] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
      const child = { ...sale('b', 'B'), ownerId: 'user-a' }; const wrapper = foreign(shape, child);
      const raw = JSON.stringify(indexed ? { version: 2, ownerId: 'user-b', operations: [], vaults: {}, quarantine: [wrapper] }
        : { ...JSON.parse(storage.getItem(stateKey)!), quarantine: [wrapper] }); storage.setItem(stateKey, raw);
      if (vaulted) await outbox.transitionOwner('user-b', 'user-a');
      expect(await outbox.refresh('user-a')).toEqual([c]); expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false);
      expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
      if (indexed) expect(storage.getItem(stateKey)).toBe(raw); else expect(JSON.parse(storage.getItem(stateKey)!).quarantine).toContainEqual(wrapper);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([c]);
    });
  it.each(['record', 'records', 'raw', 'fingerprint'].flatMap(shape => ['unowned', 'user-b'].map(childOwner => [shape, childOwner] as const)))(
    'foreign %s wrapper keeps %s child foreign while its independent explicit A descendant remains attributable', (shape, childOwner) => {
      const own = { ...sale('own'), ownerId: 'user-a' }; const hidden = { ...sale('b', 'B'), ...(childOwner === 'unowned' ? {} : { ownerId: childOwner }), record: own };
      const evidence = inspectOutboxEvidence(foreign(shape, hidden), 'user-a'); expect(evidence.records).toEqual([own]); expect(evidence.incomplete).not.toBe(true);
    });
  it('B to A to B keeps independent keys and owner subtrees separate without adopting foreign/unowned children', () => {
    const b = { ...sale('b', 'B'), idempotencyKey: 'foreign-key', ownerId: 'user-b' }; const a = { ...sale(), ownerId: 'user-a', record: b };
    const root = { ownerId: 'user-b', idempotencyKey: 'wrapper-key', record: { ownerId: 'user-b', records: [a, sale('foreign-unowned')] } };
    expect(inspectOutboxEvidence(root, 'user-a').records).toEqual([a]); expect(inspectOutboxEvidence(root, 'user-b').records).toContainEqual(b);
    expect(quarantineOutboxEvidence(root, 'user-a').blockedKeys).toEqual(new Set(['stable-key']));
  });
  it.each(['user-a', 'absent', 'user-b', 'invalid'])('fingerprint owner=%s obeys marker A proof binding', fingerprintOwner => {
    const intent = { ...sale(), ...(fingerprintOwner === 'absent' ? {} : { ownerId: fingerprintOwner === 'invalid' ? '' : fingerprintOwner }) };
    const { value, key } = marker(intent); const evidence = classifyOutboxReceiptEvidence(value, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    const allowed = fingerprintOwner === 'user-a' || fingerprintOwner === 'absent'; expect(evidence.valid).toBe(allowed);
    expect(evidence.importedIds.size).toBe(allowed ? 1 : 0); expect(evidence.blockedKeys.has('stable-key')).toBe(!allowed);
  });
  it.each(['namespace', 'node'])('contradictory marker owner=%s cannot turn foreign unowned extras into current-owner evidence', conflict => {
    const encoded = JSON.stringify(['user-a', 'stable-key']); const key = LEGACY_USER_IMPORT_PREFIX + encoded;
    const value = { key, ownerId: 'user-b', importedId: 'a', sourceFingerprint: JSON.stringify({ ...sale(), ownerId: 'user-b' }), record: c };
    const evidence = classifyOutboxReceiptEvidence(value, { key, idempotencyKey: 'stable-key', ...(conflict === 'node' ? { ownerId: 'user-a' } : {}) });
    expect(evidence.valid).toBe(false); expect(evidence.importedIds.size).toBe(0); expect(evidence.blockedKeys).toEqual(new Set(['stable-key']));
    expect(evidence.records).not.toContainEqual(c); expect(inspectOutboxEvidence({ ...value, record: c }, 'user-a').records).not.toContainEqual(c);
  });
  it('a contradictory explicit marker owner also controls unowned fingerprint descendants for routing', () => {
    const encoded = JSON.stringify(['user-a', 'stable-key']); const key = LEGACY_USER_IMPORT_PREFIX + encoded;
    const value = { key, ownerId: 'user-b', importedId: 'a', sourceFingerprint: JSON.stringify(c) };
    const evidence = classifyOutboxReceiptEvidence(value, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.records).not.toContainEqual(c);
    expect(evidence.blockedKeys).toEqual(new Set(['stable-key'])); expect(evidence.importedIds.size).toBe(0);
  });
  it.each(['depth', 'nodes'])('contradictory receipt near %s budget remains key-scoped and cannot become completion proof', limit => {
    let nested: unknown = { ...sale(), ownerId: 'user-b' };
    if (limit === 'depth') for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH - 1; i++) nested = [nested];
    else nested = [...Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 2 }, () => 'garbage'), nested];
    const { value, key } = marker({ ownerId: 'user-b', records: nested });
    const evidence = classifyOutboxReceiptEvidence(value, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.importedIds.size).toBe(0); expect(evidence.incomplete).not.toBe(true); expect(evidence.blockedKeys).toEqual(new Set(['stable-key']));
  });
  it.each([OUTBOX_EVIDENCE_MAX_DEPTH, OUTBOX_EVIDENCE_MAX_DEPTH + 1])('explicit A ownership at foreign wrapper depth=%s remains discoverable or narrowly held', depth => {
    const own = { ...sale('b', 'B'), ownerId: 'user-a' }; let nested: unknown = own;
    for (let i = 0; i < depth; i++) nested = { ownerId: 'user-b', record: nested };
    const evidence = quarantineOutboxEvidence(nested, 'user-a');
    expect(evidence.blockedKeys).toEqual(new Set(['stable-key'])); expect(evidence.incomplete).not.toBe(true);
    if (depth === OUTBOX_EVIDENCE_MAX_DEPTH) expect(evidence.records).toContainEqual(own);
  });
  it('receipt A with foreign fingerprint of unrelated C holds only A and cannot infer C completion', () => {
    const { value, key } = marker({ ...c, ownerId: 'user-b' });
    const evidence = classifyOutboxReceiptEvidence(value, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.importedIds.size).toBe(0);
    expect(evidence.blockedKeys).toEqual(new Set(['stable-key'])); expect(evidence.records).not.toContainEqual({ ...c, ownerId: 'user-b' });
  });
  it('contradictory fingerprint with an explicitly A-owned malformed same-key child still fails closed at A', () => {
    const body = { ...sale(), ownerId: 'user-b', record: { ...sale('bad'), ownerId: 'user-a', createdAt: 'invalid' } };
    const { value, key } = marker(body); const evidence = classifyOutboxReceiptEvidence(value, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.importedIds.size).toBe(0); expect(evidence.blockedKeys).toEqual(new Set(['stable-key']));
  });
  it('contradictory proof A retains an independent valid A-owned C descendant without treating C as completion proof', () => {
    const child = { ...c, ownerId: 'user-a' }; const { value, key } = marker({ ...sale(), ownerId: 'user-b', record: child });
    const evidence = classifyOutboxReceiptEvidence(value, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.records).toContainEqual(child); expect(evidence.importedIds.size).toBe(0);
    expect(evidence.blockedKeys).toEqual(new Set(['stable-key']));
  });
  it.each([false, true])('indexed=%s explicitly foreign operation in owned import scope cannot activate or mint a valid receipt', async indexed => {
    const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options); await outbox.transitionOwner(null, 'user-a');
    const raw = JSON.stringify({ operations: [{ ...sale(), ownerId: 'user-b' }] }); storage.setItem(legacyOutboxVaultKey('user-a'), raw);
    expect(await outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(false); expect(await outbox.refresh('user-a')).toEqual([]);
    expect(await outbox.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(raw);
  });
  it.each([false, true])('indexed=%s rejected owned-row owner contradiction remains held across restart and cannot resurrect through a new import', async indexed => {
    const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options); await outbox.transitionOwner(null, 'user-a');
    const row = { ...sale(), ownerId: 'user-b', record: { ...c, ownerId: 'user-a' } };
    if (indexed) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = options.indexedDB!.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('operations', 'readwrite'); tx.objectStore('operations').put(row); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
    } else { const state = JSON.parse(storage.getItem(stateKey)!); storage.setItem(stateKey, JSON.stringify({ ...state, operations: [row] })); }
    expect(await outbox.refresh('user-a')).toEqual([]); await outbox.enqueue(c, 'user-a'); expect(await outbox.refresh('user-a')).toEqual([c]);
    const restart = new OutboxStore(storage, options); const raw = JSON.stringify({ operations: [sale()] }); storage.setItem(legacyOutboxVaultKey('user-a'), raw);
    expect(await restart.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(false); expect(await restart.refresh('user-a')).toEqual([c]);
    expect(await restart.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(raw);
  });
  it('a contradictory fingerprint cannot supply completion/import proof', () => {
    const { value, key } = marker(); const evidence = classifyOutboxReceiptEvidence(value, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.importedIds.size).toBe(0); expect(evidence.blockedKeys).toEqual(new Set(['stable-key']));
  });
  it.each([false, true])('indexed=%s contradictory receipt holds A, preserves C, denies cleanup and survives owner restoration', async indexed => {
    const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); const raw = JSON.stringify({ operations: [sale()] }); storage.setItem(legacyOutboxVaultKey('user-a'), raw);
    const { encoded, value } = marker(); const state = indexed ? { version: 2, ownerId: 'user-a', operations: [], vaults: {} } : JSON.parse(storage.getItem(stateKey)!);
    storage.setItem(stateKey, JSON.stringify({ ...state, legacyVaultReceipts: { [encoded]: value } }));
    expect(await outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(false);
    expect(await outbox.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(raw);
    await outbox.enqueue(c, 'user-a'); expect(await outbox.refresh('user-a')).toEqual([c]);
    await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
    await outbox.transitionOwner('user-b', 'user-a'); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
    expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceipts[encoded]).toEqual(value);
  });
});
