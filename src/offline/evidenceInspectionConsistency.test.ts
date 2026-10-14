import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { KEY_VALUE_OUTBOX_STATE_KEY as stateKey, LEGACY_OUTBOX_KEY, LEGACY_OUTBOX_OWNER_KEY,
  LEGACY_USER_IMPORT_PREFIX, legacyOutboxVaultKey, OUTBOX_EVIDENCE_MAX_DEPTH, OUTBOX_EVIDENCE_MAX_NODES,
  classifyOutboxReceiptEvidence, outboxEvidenceBlockedKeys, scopedOutboxReceiptEvidence, parseKeyValueOutboxRecoveryScope, quarantineOutboxEvidence } from './outboxRecovery';
import type { KeyValueStorage } from './storage';
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
function deep(value: unknown): unknown { for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH + 6; i++) value = { record: value }; return value; }
function receipt(intent = sale()) {
  const encoded = JSON.stringify(['user-a', intent.idempotencyKey]);
  return { [encoded]: { key: LEGACY_USER_IMPORT_PREFIX + encoded, importedId: intent.id, sourceFingerprint: JSON.stringify(intent) }, raw: 'unidentifiable garbage' };
}
async function installQuarantine(storage: KeyValueStorage, factory: IDBFactory | undefined, value: unknown, ownerId = 'user-a') {
  if (!factory) { const state = JSON.parse(storage.getItem(stateKey)!); storage.setItem(stateKey, JSON.stringify({ ...state, quarantine: value })); return; }
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open('pharmacystock:outbox:v2', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('metadata', 'readwrite');
    tx.objectStore('metadata').put({ key: 'persisted-outbox-v2:quarantine:' + JSON.stringify(ownerId), ownerId, records: value });
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
}
afterEach(() => vi.restoreAllMocks());
describe('evidence inspection consistency', () => {
  it('a malformed map sibling cannot erase a valid historical receipt child', () => {
    const evidence = scopedOutboxReceiptEvidence(receipt(), 'user-a');
    expect(evidence.records).toContainEqual(sale());
    expect(evidence.importedIds?.get('stable-key')).toBe('a');
  });
  it.each([false, true].flatMap(indexed => [false, true].map(vaulted => [indexed, vaulted] as const)))('indexed=%s vaulted=%s mixed receipt map blocks B at refresh/cleanup/restart without poisoning C', async (indexed, vaulted) => {
    const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale('b', 'B'), 'user-a'); await outbox.enqueue(c, 'user-a');
    if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
    const root = receipt(); const archived = { version: 2, ownerId: 'user-a', operations: [], vaults: {}, legacyVaultReceipts: root };
    if (indexed) storage.setItem(stateKey, JSON.stringify(archived));
    else storage.setItem(stateKey, JSON.stringify({ ...JSON.parse(storage.getItem(stateKey)!), legacyVaultReceipts: root }));
    if (vaulted) { expect(await outbox.refresh('user-b')).toEqual([]); await outbox.transitionOwner('user-b', 'user-a'); }
    const source = JSON.stringify({ operations: [sale('b', 'B')] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
    expect(await outbox.refresh('user-a')).toEqual([c]);
    expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false);
    expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
    await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
    await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([c]);
    expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceipts).toEqual(root);
  });
  it.each(['operations', 'vault'])('malformed archive %s extraction preserves depth uncertainty', field => {
    const root = { version: 2, ownerId: 'user-a', operations: field === 'operations' ? deep(sale('b', 'B')) : [], vaults: field === 'vault' ? { 'user-a': deep(sale('b', 'B')) } : {} };
    expect(parseKeyValueOutboxRecoveryScope(JSON.stringify(root), 'user-a')!.incomplete).toBe(true);
  });
  it.each([false, true].flatMap(perUser => ['depth', 'nodes'].flatMap(limit => [false, true].map(vaulted => [perUser, limit, vaulted] as const))))('native live legacy owner source uncertainty is preserved: per-user=%s limit=%s vaulted=%s', async (perUser, limit, vaulted) => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale(), 'user-a');
    if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
    const uncertain = limit === 'depth' ? deep(sale('b', 'B')) : { records: [...Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 2 }, () => 'garbage'), sale('b', 'B')] };
    const raw = JSON.stringify({ version: 1, operations: [uncertain] });
    const key = perUser ? legacyOutboxVaultKey('user-a') : LEGACY_OUTBOX_KEY;
    storage.setItem(LEGACY_OUTBOX_OWNER_KEY, 'user-a'); storage.setItem(key, raw);
    if (vaulted) await outbox.transitionOwner('user-b', 'user-a');
    expect(await outbox.refresh('user-a')).toEqual([]); expect(storage.getItem(key)).toBe(raw);
    expect(await new OutboxStore(storage).refresh('user-a')).toEqual([]);
    await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
    await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([]);
  });
  it.each(['operations', 'vault'].flatMap(field => ['depth', 'nodes'].flatMap(limit => [false, true].map(vaulted => [field, limit, vaulted] as const))))('archive %s %s vaulted=%s fails closed at refresh/cleanup/restart while retaining raw', async (field, limit, vaulted) => {
    const storage = memory(); const options = { indexedDB: new IDBFactory() }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); const source = JSON.stringify({ operations: [sale()] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
    expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true);
    if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
    const uncertain = limit === 'depth' ? deep(sale('b', 'B')) : { records: [...Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 2 }, () => 'garbage'), sale('b', 'B')] };
    const raw = JSON.stringify({ version: 2, ownerId: field === 'operations' ? 'user-a' : 'user-b', operations: field === 'operations' ? uncertain : [], vaults: field === 'vault' ? { 'user-a': uncertain } : {} });
    storage.setItem(stateKey, raw);
    if (vaulted) await outbox.transitionOwner('user-b', 'user-a');
    expect(await outbox.refresh('user-a')).toEqual([]); expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false);
    expect(storage.getItem(stateKey)).toBe(raw); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([]);
    await outbox.transitionOwner('user-a', 'user-b'); await outbox.enqueue(c, 'user-b'); expect(await outbox.refresh('user-b')).toEqual([c]);
    await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([]);
  });
  it('foreign enclosing headers cannot hide a selected-owner vault after a collection budget is spent', () => {
    const values = [...Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 2 }, () => ({ ownerId: 'user-b', records: 'foreign' })),
      { version: 2, ownerId: 'user-b', operations: [], vaults: { 'user-a': deep(sale('b', 'B')) } }];
    expect(quarantineOutboxEvidence(values, 'user-a', true).incomplete).toBe(true);
  });
  it('valid receipt children with arbitrary labels survive malformed siblings without becoming malformed evidence', () => {
    const child = Object.values(receipt())[0];
    const evidence = scopedOutboxReceiptEvidence({ 'known-receipt-key': child, raw: 'unidentifiable garbage' }, 'user-a');
    expect(evidence.records).toContainEqual(sale()); expect(evidence.blockedKeys.size).toBe(0);
    expect(evidence.importedIds?.get('stable-key')).toBe('a');
  });
  it.each([false, true])('indexed=%s mixed-root valid history prevents exact resurrection and supports unrelated receipt creation', async indexed => {
    const storage = memory(); const options = indexed ? { indexedDB: new IDBFactory() } : {}; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); const root = receipt();
    storage.setItem(stateKey, JSON.stringify({ version: 2, ownerId: 'user-a', operations: [], vaults: {}, legacyVaultReceipts: root }));
    const exact = JSON.stringify({ operations: [sale()] });
    expect(await outbox.importLegacyVault('user-a', exact, { ownershipProven: true })).toBe(true);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([]);
    const fresh = JSON.stringify({ operations: [c] });
    expect(await outbox.importLegacyVault('user-a', fresh, { ownershipProven: true })).toBe(true);
    expect(await outbox.refresh('user-a')).toEqual([c]);
    expect(storage.getItem(stateKey)).toContain('unidentifiable garbage');
    await outbox.update(c.id, { status: 'SYNCED' }, 'user-a'); await outbox.removeSynced();
    expect(await new OutboxStore(storage, options).importLegacyVault('user-a', fresh, { ownershipProven: true })).toBe(true);
    expect(await outbox.refresh('user-a')).toEqual([]);
  });
  it('a keyed malformed parent does not invent a key binding for its unknown nested children', () => {
    const evidence = quarantineOutboxEvidence({ ownerId: 'user-a', idempotencyKey: 'stable-key', record: deep(c) }, 'user-a');
    expect(evidence.incomplete).toBe(true);
    expect(outboxEvidenceBlockedKeys(evidence, [sale(), c])).toEqual(new Set(['stable-key', 'unrelated-key']));
    const filler = { ...sale('filler'), idempotencyKey: 'filler-key' };
    const exhausted = quarantineOutboxEvidence([...Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES }, () => ({ ...filler })),
      { ownerId: 'user-a', idempotencyKey: 'stable-key', record: deep(c) }], 'user-a');
    expect(exhausted.incomplete).toBe(true);
    expect(outboxEvidenceBlockedKeys(exhausted, [sale(), c])).toContain('unrelated-key');
  });
  it('a known receipt key narrows fingerprint exhaustion without poisoning unrelated C', () => {
    const key = LEGACY_USER_IMPORT_PREFIX + JSON.stringify(['user-a', 'stable-key']);
    const evidence = classifyOutboxReceiptEvidence({ key, importedId: 'a', sourceFingerprint: JSON.stringify(deep(sale('b', 'B'))) }, { key, idempotencyKey: 'stable-key', ownerId: 'user-a' });
    expect(evidence.valid).toBe(false); expect(evidence.incomplete).not.toBe(true);
    expect(evidence.uncertainties).toContainEqual({ ownerId: 'user-a', idempotencyKey: 'stable-key', reason: 'DEPTH_LIMIT' });
    expect(outboxEvidenceBlockedKeys(evidence, [sale(), c])).toEqual(new Set(['stable-key']));
  });
  it.each([false, true])('indexed=%s genuinely unscoped exhausted collection conservatively blocks actual current work and retains raw', async indexed => {
    const storage = memory(); const factory = indexed ? new IDBFactory() : undefined; const options = factory ? { indexedDB: factory } : {}; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(c, 'user-a');
    const raw = Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 4 }, () => 'garbage'); await installQuarantine(storage, factory, raw);
    const evidence = quarantineOutboxEvidence(raw, undefined, true);
    expect(evidence.incomplete).toBe(true); expect(evidence.blockedKeys.size).toBe(0);
    expect(evidence.uncertainties).toContainEqual({ reason: 'NODE_LIMIT' });
    expect(await outbox.refresh('user-a')).toEqual([]);
    if (!factory) expect(JSON.parse(storage.getItem(stateKey)!).quarantine.slice(0, raw.length)).toEqual(raw);
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([]);
  });
  it.each([false, true])('indexed=%s foreign-owner collection exhaustion does not poison A after restart/A-B-A', async indexed => {
    const storage = memory(); const factory = indexed ? new IDBFactory() : undefined; const options = factory ? { indexedDB: factory } : {}; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(c, 'user-a');
    await outbox.transitionOwner('user-a', 'user-b'); await outbox.enqueue(sale('b', 'B'), 'user-b'); await outbox.transitionOwner('user-b', 'user-a');
    const foreign = Array.from({ length: OUTBOX_EVIDENCE_MAX_NODES + 4 }, () => ({ ownerId: 'user-b', records: 'unidentifiable garbage' }));
    await installQuarantine(storage, factory, foreign);
    if (factory) await installQuarantine(storage, factory, foreign, 'user-b');
    expect(quarantineOutboxEvidence(foreign, 'user-a').incomplete).not.toBe(true);
    expect(quarantineOutboxEvidence(foreign, 'user-b').incomplete).toBe(true);
    expect(await outbox.refresh('user-a')).toEqual([c]); expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([c]);
    await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
    await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([c]);
  });
});
