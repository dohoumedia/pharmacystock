import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { KEY_VALUE_OUTBOX_STATE_KEY as stateKey, LEGACY_OUTBOX_OWNER_KEY as ownerKey,
  LEGACY_USER_IMPORT_PREFIX, legacyOutboxVaultKey, parseKeyValueOutboxRecoveryScope,
  classifyOutboxReceiptEvidence, scopedOutboxReceiptEvidence } from './outboxRecovery';
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
const shapes = ['version', 'owner', 'quarantine object', 'nested quarantine', 'quarantine root', 'nested operation'] as const;
function archive(shape: typeof shapes[number], operation = sale('source-b', 'B'), owner = 'user-a') {
  const base = { version: 2, ownerId: owner, operations: [], vaults: {} };
  if (shape === 'version') return { ...base, version: 99, operations: [operation] };
  if (shape === 'owner') return { ...base, ownerId: 123, vaults: { [owner]: [operation] } };
  if (shape === 'nested operation') return { ...base, operations: [{ records: { record: operation } }] };
  const entry = { ownerId: owner, records: shape === 'nested quarantine'
    ? [{ record: { records: { record: operation } }, reason: 'IMMUTABLE_CONFLICT' }]
    : { record: operation, reason: 'IMMUTABLE_CONFLICT' } };
  return { ...base, quarantine: shape === 'quarantine root' ? entry : [entry] };
}
function source(operation = sale()) { return JSON.stringify({ operations: [operation] }); }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('malformed wrapper evidence at authoritative boundaries', () => {
  it('rejected array root preserves explicit child ownership but never admits child work', () => {
    const raw = JSON.stringify([{ version: 2, ownerId: 'user-a', operations: [sale()], vaults: {} }, 'garbage']);
    const scope = parseKeyValueOutboxRecoveryScope(raw, 'user-a')!;
    expect(scope.records).toEqual([]); expect(scope.blockedKeys).toEqual(new Set(['stable-key']));
    expect(parseKeyValueOutboxRecoveryScope(raw, 'user-b')!.blockedKeys.size).toBe(0);
  });
  it('JSON-encoded malformed roots/quarantine retain discoverable identity as tainted evidence', () => {
    const encoded = JSON.stringify(JSON.stringify({ version: 2, ownerId: 'user-a', operations: [sale()], vaults: {} }));
    expect(parseKeyValueOutboxRecoveryScope(encoded, 'user-a')!.blockedKeys).toEqual(new Set(['stable-key']));
    const q = JSON.stringify({ version: 2, ownerId: 'user-a', operations: [], vaults: {},
      quarantine: [JSON.stringify({ ownerId: 'user-a', records: [{ record: sale(), reason: 'IMMUTABLE_CONFLICT' }] })] });
    expect(parseKeyValueOutboxRecoveryScope(q, 'user-a')!.blockedKeys).toEqual(new Set(['stable-key']));
    const marker = { key: LEGACY_USER_IMPORT_PREFIX + JSON.stringify(['user-a', 'stable-key']), importedId: 'sale-a', sourceFingerprint: JSON.stringify(sale()) };
    const evidence = scopedOutboxReceiptEvidence(JSON.stringify({ [JSON.stringify(['user-a', 'stable-key'])]: marker }), 'user-a');
    expect(evidence.blockedKeys).toEqual(new Set(['stable-key'])); expect(evidence.importedIds?.size ?? 0).toBe(0);
  });
  it.each(['raw nested', 'direct nested', 'missing key sibling'])(
    '%s receipt extracts tainted fragments without validating a broken fingerprint/container', (shape) => {
      const b = sale('b', 'B');
      const evidence = classifyOutboxReceiptEvidence(shape === 'direct nested'
        ? { ownerId: 'user-a', records: { record: b } }
        : { ownerId: 'user-a', raw: JSON.stringify({ version: 1, operations: shape === 'raw nested' ? [{ record: b }] : [b, { ...b, idempotencyKey: undefined }] }) });
      expect(evidence.valid).toBe(false); expect(evidence.importedIds.size).toBe(0);
      if (shape !== 'missing key sibling') expect(evidence.blockedKeys).toEqual(new Set(['stable-key']));
    });

  it.each(shapes)('%s separates rejected admission from known-key evidence without inventing identity', (shape) => {
    const b = sale('source-b', 'B'); const raw = JSON.stringify(archive(shape, b));
    const scope = parseKeyValueOutboxRecoveryScope(raw, 'user-a')!;
    expect(scope.blockedKeys).toEqual(new Set(['stable-key']));
    expect([...scope.witnesses, ...scope.quarantine.map((item) => item.record)]).toContainEqual(b);
    expect(parseKeyValueOutboxRecoveryScope(raw, 'user-d')!.blockedKeys.size).toBe(0);
  });
  it.each(shapes.flatMap((shape) => [false, true].map((vaulted) => [shape, vaulted] as const)))(
    '%s disputes active/vaulted=%s destination on refresh, persists across restart/A-B-A and retains raw', async (shape, vaulted) => {
      const storage = memory(); const options = { indexedDB: new IDBFactory() }; storage.setItem(ownerKey, 'user-a');
      const outbox = new OutboxStore(storage, options); await outbox.ready(); await outbox.enqueue(sale(), 'user-a'); await outbox.enqueue(independent, 'user-a');
      if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
      const raw = JSON.stringify(archive(shape)); storage.setItem(stateKey, raw);
      if (vaulted) { expect(await outbox.refresh('user-b')).toEqual([]); await outbox.transitionOwner('user-b', 'user-a'); }
      expect(await outbox.refresh('user-a')).toEqual([independent]);
      expect(quarantineOperationRecords(await persistedQuarantine(storage, options))).toContainEqual(sale());
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([independent]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([independent]);
      expect(storage.getItem(stateKey)).toBe(raw);
    });
  it.each(shapes)('%s current scoped evidence blocks per-user cleanup after successful import', async (shape) => {
    const storage = memory(); const options = { indexedDB: new IDBFactory() }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); const raw = source(); storage.setItem(legacyOutboxVaultKey('user-a'), raw);
    expect(await outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
    const malformed = JSON.stringify(archive(shape)); storage.setItem(stateKey, malformed);
    expect(await outbox.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false);
    expect(await outbox.refresh('user-a')).toEqual([]);
    expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(raw); expect(storage.getItem(stateKey)).toBe(malformed);
    const restart = new OutboxStore(storage, options);
    expect(await restart.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(false);
  });
  it.each(['root', 'quarantine', 'other owner'])(
    '%s unidentifiable/unrelated evidence cannot poison independent destination or authorize cleanup', async (shape) => {
      const storage = memory(); const options = { indexedDB: new IDBFactory() }; const outbox = new OutboxStore(storage, options);
      await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(independent, 'user-a');
      const raw = JSON.stringify(shape === 'root' ? 'unidentifiable wrapper garbage' : shape === 'other owner'
        ? archive('owner', sale('b', 'B'), 'user-d') : { version: 2, ownerId: 'user-a', operations: [], vaults: {}, quarantine: 'unidentifiable quarantine garbage' });
      storage.setItem(stateKey, raw); expect(await outbox.refresh('user-a')).toEqual([independent]);
      expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([independent]);
      expect(await outbox.cleanupLegacyVault('user-a', source(independent), 'user-a')).toBe(false);
      expect(storage.getItem(stateKey)).toBe(raw);
    });
  it('unidentifiable quarantine in an otherwise supported scope does not block valid handoff/receipt', async () => {
    const storage = memory(); const options = { indexedDB: new IDBFactory() }; storage.setItem(ownerKey, 'user-a');
    const raw = JSON.stringify({ version: 2, ownerId: 'user-a', operations: [independent], vaults: {}, quarantine: 'garbage' });
    storage.setItem(stateKey, raw); const outbox = new OutboxStore(storage, options);
    expect(await outbox.refresh('user-a')).toEqual([independent]);
    await outbox.update(independent.id, { status: 'SYNCED' }, 'user-a'); await outbox.removeSynced();
    expect(await new OutboxStore(storage, options).refresh('user-a')).toEqual([]); expect(storage.getItem(stateKey)).toBe(raw);
  });
  it('tainted receipt children under invalid headers cannot prove consumed intent or cleanup', async () => {
    const storage = memory(); const options = { indexedDB: new IDBFactory() }; const outbox = new OutboxStore(storage, options);
    await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale(), 'user-a');
    const raw = JSON.stringify({ version: 99, ownerId: 'user-a', operations: [], vaults: {},
      legacyGlobalRecovery: { ownerId: 'user-a', raw: JSON.stringify({ version: 1, operations: [sale()] }) } });
    storage.setItem(stateKey, raw); expect(await outbox.refresh('user-a')).toEqual([]); expect(storage.getItem(stateKey)).toBe(raw);
  });
});

describe('native receipt-root retention without unrelated poisoning', () => {
  it.each(['string', 'array', 'null'])('%s garbage survives valid C import, completion, cleanup, restart and owner restoration', async (shape) => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a');
    const garbage = shape === 'string' ? ' unidentifiable receipt garbage ' : shape === 'array' ? ['garbage'] : null;
    const state = JSON.parse(storage.getItem(stateKey)!); storage.setItem(stateKey, JSON.stringify({ ...state, legacyVaultReceipts: garbage }));
    const raw = source(independent); storage.setItem(legacyOutboxVaultKey('user-a'), raw);
    expect(await outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
    const persisted = JSON.parse(storage.getItem(stateKey)!);
    expect(persisted.legacyVaultReceiptArchives).toEqual([garbage]);
    const encoded = JSON.stringify(['user-a', independent.idempotencyKey]);
    expect(persisted.legacyVaultReceipts[encoded]).toMatchObject({ importedId: independent.id, sourceFingerprint: expect.any(String) });
    expect(await outbox.refresh('user-a')).toEqual([independent]);
    const restart = new OutboxStore(storage); expect(await restart.refresh('user-a')).toEqual([independent]);
    expect(await restart.cleanupLegacyVault('user-a', raw, 'user-a')).toBe(true);
    await restart.update(independent.id, { status: 'SYNCED' }, 'user-a'); await restart.removeSynced();
    await restart.transitionOwner('user-a', 'user-b'); expect(await restart.refresh('user-b')).toEqual([]);
    await restart.transitionOwner('user-b', 'user-a');
    expect(await restart.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
    expect(await restart.refresh('user-a')).toEqual([]);
    expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceiptArchives).toEqual([garbage]);
    // Evidence/consumption proof also survives selection of IndexedDB.
    const selected = new OutboxStore(storage, { indexedDB: new IDBFactory() });
    expect(await selected.refresh('user-a')).toEqual([]);
  });
  it('malformed keyed root blocks only its owner/key while a valid unrelated import creates a receipt', async () => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale(), 'user-a');
    const marker = { key: LEGACY_USER_IMPORT_PREFIX + JSON.stringify(['user-a', 'stable-key']), importedId: '', sourceFingerprint: JSON.stringify(sale('b', 'B')) };
    const state = JSON.parse(storage.getItem(stateKey)!); storage.setItem(stateKey, JSON.stringify({ ...state, legacyVaultReceipts: [marker] }));
    expect(await outbox.refresh('user-a')).toEqual([]);
    expect(await outbox.importLegacyVault('user-a', source(independent), { ownershipProven: true })).toBe(true);
    expect(await outbox.refresh('user-a')).toEqual([independent]);
    const saved = JSON.parse(storage.getItem(stateKey)!); expect(saved.legacyVaultReceiptArchives).toEqual([[marker]]);
    expect(await new OutboxStore(storage).refresh('user-a')).toEqual([independent]);
    expect(scopedOutboxReceiptEvidence([marker], 'user-b').blockedKeys.size).toBe(0);
    const selected = new OutboxStore(storage, { indexedDB: new IDBFactory() }); expect(await selected.refresh('user-a')).toEqual([independent]);
    expect(storage.getItem(stateKey)).toBe(JSON.stringify(saved));
  });
  it.each([false, true])('owner-scoped malformed receipt root disputes active/vaulted=%s without blocking C or owner B', async (vaulted) => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(sale(), 'user-a');
    if (vaulted) await outbox.transitionOwner('user-a', 'user-b');
    const malformed = { ownerId: 'user-a', records: { record: sale('b', 'B') } };
    const state = JSON.parse(storage.getItem(stateKey)!); storage.setItem(stateKey, JSON.stringify({ ...state, legacyVaultReceipts: malformed }));
    if (vaulted) { expect(await outbox.refresh('user-b')).toEqual([]); await outbox.transitionOwner('user-b', 'user-a'); }
    expect(await outbox.refresh('user-a')).toEqual([]);
    expect(await outbox.importLegacyVault('user-a', source(independent), { ownershipProven: true })).toBe(true);
    expect(await new OutboxStore(storage).refresh('user-a')).toEqual([independent]);
    expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceiptArchives).toEqual([malformed]);
    await outbox.transitionOwner('user-a', 'user-b'); await outbox.transitionOwner('user-b', 'user-a');
    expect(await outbox.refresh('user-a')).toEqual([independent]);
  });
  it('failed conversion/import commit preserves original root/source and can retry', async () => {
    const base = memory(); let fail = false; const storage = { ...base, setItem: (key: string, raw: string) => {
      if (fail && key === stateKey && JSON.parse(raw).legacyVaultReceiptArchives) throw new Error('COMMIT_FAILED'); base.setItem(key, raw);
    } };
    const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a');
    const state = JSON.parse(base.getItem(stateKey)!); base.setItem(stateKey, JSON.stringify({ ...state, legacyVaultReceipts: 'garbage' }));
    const before = base.getItem(stateKey); const raw = source(independent); base.setItem(legacyOutboxVaultKey('user-a'), raw); fail = true;
    await expect(outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).rejects.toThrow('COMMIT_FAILED');
    expect(base.getItem(stateKey)).toBe(before); expect(base.getItem(legacyOutboxVaultKey('user-a'))).toBe(raw);
    fail = false; expect(await outbox.importLegacyVault('user-a', raw, { ownershipProven: true })).toBe(true);
  });
});
