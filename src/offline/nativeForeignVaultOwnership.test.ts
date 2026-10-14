import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore, type OutboxOperation } from './outbox';
import { KEY_VALUE_OUTBOX_STATE_KEY as stateKey, legacyOutboxVaultKey, OUTBOX_EVIDENCE_MAX_DEPTH } from './outboxRecovery';
import type { KeyValueStorage } from './storage';

function memory(): KeyValueStorage { const data = new Map<string, string>(); return { getItem: key => data.get(key) ?? null,
  setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }; }
function sale(id = 'a', intent = 'A'): OutboxOperation { return { id, idempotencyKey: `stable-${id}`, kind: 'SALE', organizationId: 'org-a', branchId: 'branch-a',
  createdAt: '2026-10-14T12:00:00Z', status: 'PENDING', attemptCount: 0, payload: { organizationId: 'org-a', branchId: 'branch-a', saleNumber: intent } }; }
const a = sale(); const c = sale('c');
function row(shape: string, child: unknown, ownerId = 'user-b') {
  const fields = shape === 'records' ? { records: [child] } : shape === 'raw' ? { raw: JSON.stringify(child) }
    : shape === 'nested' ? { record: { records: { raw: JSON.stringify(child) } } } : { record: child };
  return { ...sale('foreign-' + ownerId), ownerId, ...fields };
}
function install(storage: KeyValueStorage, wrapper: object, ownerId = 'user-b') {
  const state = JSON.parse(storage.getItem(stateKey)!); storage.setItem(stateKey, JSON.stringify({ ...state, vaults: { ...state.vaults, [ownerId]: [wrapper] } }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('native foreign vault ownership', () => {
  it.each(['record', 'records', 'raw', 'nested'].flatMap(shape => [false, true].map(vaulted => [shape, vaulted] as const)))(
    '%s vaulted=%s valid B envelope routes explicit A witness across cleanup/restart/A-B-A', async (shape, vaulted) => {
      const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a');
      const source = JSON.stringify({ operations: [a] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      if (vaulted) await outbox.transitionOwner('user-a', 'user-d');
      const child = { ...a, id: 'conflicting-a', ownerId: 'user-a', payload: { ...a.payload as object, saleNumber: 'B' }, record: { ...c, ownerId: 'user-b' } };
      const wrapper = row(shape, child); install(storage, wrapper);
      if (vaulted) await outbox.transitionOwner('user-d', 'user-a');
      expect(await outbox.refresh('user-a')).toEqual([c]); expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false);
      expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(false); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
      expect(JSON.parse(storage.getItem(stateKey)!).vaults['user-b']).toEqual([wrapper]);
      expect(await new OutboxStore(storage).refresh('user-a')).toEqual([c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([wrapper]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await new OutboxStore(storage).refresh('user-a')).toEqual([c]);
      expect(JSON.parse(storage.getItem(stateKey)!).vaults['user-b']).toEqual([wrapper]); expect(storage.getItem(legacyOutboxVaultKey('user-a'))).toBe(source);
    });
  it.each(['unowned', 'foreign', 'ambiguous', 'garbage'])(
    '%s child stays foreign; valid outer B and A cleanup remain compatible', async kind => {
      const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a');
      const source = JSON.stringify({ operations: [a] }); storage.setItem(legacyOutboxVaultKey('user-a'), source);
      expect(await outbox.importLegacyVault('user-a', source, { ownershipProven: true })).toBe(true); await outbox.enqueue(c, 'user-a');
      const child = kind === 'garbage' ? 'garbage' : { ...a, payload: { ...a.payload as object, saleNumber: 'B' },
        ...(kind === 'foreign' ? { ownerId: 'user-b' } : kind === 'ambiguous' ? { ownerId: 42 } : {}) };
      const wrapper = row('record', child); install(storage, wrapper);
      expect(await outbox.refresh('user-a')).toEqual([a, c]); expect(await outbox.cleanupLegacyVault('user-a', source, 'user-a')).toBe(true);
      expect(await new OutboxStore(storage).refresh('user-a')).toEqual([a, c]);
      await outbox.transitionOwner('user-a', 'user-b'); expect(await outbox.refresh('user-b')).toEqual([wrapper]);
      await outbox.transitionOwner('user-b', 'user-a'); expect(await outbox.refresh('user-a')).toEqual([a, c]);
    });
  it.each([false, true])('explicit A witness identical=%s cannot create candidates/completion history', async identical => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(c, 'user-a');
    if (identical) await outbox.enqueue(a, 'user-a');
    install(storage, row('record', { ...a, id: 'witness-a', ownerId: 'user-a' }));
    expect(await outbox.refresh('user-a')).toEqual(identical ? [a, c] : [c]);
    expect(JSON.parse(storage.getItem(stateKey)!).legacyVaultReceipts).toBeUndefined();
    expect(await new OutboxStore(storage).refresh('user-a')).toEqual(identical ? [a, c] : [c]);
  });
  it.each([false, true])('near depth limit explicit=%s uncertainty stays narrowly scoped', async explicit => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(a, 'user-a'); await outbox.enqueue(c, 'user-a');
    let child: unknown = { ...a, payload: { ...a.payload as object, saleNumber: 'B' }, ...(explicit ? { ownerId: 'user-a' } : {}) };
    for (let i = 0; i < OUTBOX_EVIDENCE_MAX_DEPTH - 1; i++) child = { record: child };
    install(storage, row('record', child)); expect(await outbox.refresh('user-a')).toEqual(explicit ? [c] : [a, c]);
    expect(await new OutboxStore(storage).refresh('user-a')).toEqual(explicit ? [c] : [a, c]);
  });
  it.each(['record', 'raw'])('multiple foreign B/D vaults %s route only explicit A child', async shape => {
    const storage = memory(); const outbox = new OutboxStore(storage); await outbox.transitionOwner(null, 'user-a'); await outbox.enqueue(a, 'user-a'); await outbox.enqueue(c, 'user-a');
    install(storage, row(shape, { ...a, ownerId: 'user-a', payload: { ...a.payload as object, saleNumber: 'B' } }));
    install(storage, row('record', { ...c, payload: { ...c.payload as object, saleNumber: 'foreign C' } }, 'user-d'), 'user-d');
    expect(await outbox.refresh('user-a')).toEqual([c]); expect(await new OutboxStore(storage).refresh('user-a')).toEqual([c]);
  });
});
