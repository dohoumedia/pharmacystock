import { describe, expect, it } from 'vitest';
import type { OutboxOperation } from './outbox';
import {
  classifyOutboxRecoveryGroups, classifyOutboxRecoverySource, immutableOutboxContentMatches, parseOutboxRecoverySource,
  isRecoverableLegacyOperation, resetInterruptedReplay,
} from './outboxRecovery';

const operation: OutboxOperation = {
  id: 'original', kind: 'SALE', organizationId: 'org', branchId: 'branch',
  idempotencyKey: 'stable', payload: { organizationId: 'org', branchId: 'branch', saleNumber: 'A' },
  createdAt: '2026-10-04T11:00:00Z', status: 'CONFLICT', attemptCount: 3, lastErrorCode: 'INSUFFICIENT_STOCK',
};
describe('canonical recovery group classifier', () => {
  it('distinguishes unique intent from exact retries while retaining destination lifecycle', () => {
    expect(classifyOutboxRecoveryGroups([operation]).groups.get('stable')?.classification).toBe('UNIQUE');
    const copy = { ...operation, id: 'new', createdAt: '2026-10-03T11:00:00Z', status: 'PENDING', attemptCount: 0 };
    const result = classifyOutboxRecoveryGroups([operation, copy]);
    expect(result.groups.get('stable')?.classification).toBe('IDENTICAL_RETRIES');
    expect(result.operations).toEqual([operation]);
    expect(result.complete).toBe(true);
  });
  it.each([false, true])('rejects two/three-member conflicts; include identical copy=%s', (includeCopy) => {
    const changed = { ...operation, id: 'changed', payload: { ...operation.payload as object, saleNumber: 'B' } };
    expect(isRecoverableLegacyOperation(changed)).toBe(true);
    expect(immutableOutboxContentMatches(operation, changed)).toBe(false);
    const entries = includeCopy ? [operation, { ...operation, id: 'copy' }, changed] : [operation, changed];
    const result = classifyOutboxRecoveryGroups(entries);
    expect(result.groups.get('stable')?.classification).toBe('IMMUTABLE_CONFLICT');
    expect(result.operations).toEqual([]);
    expect(result.rejected.map(({ record }) => record)).toEqual(entries);
    expect(result.complete).toBe(false);
  });
  it('retains malformed same-key siblings and safe independent intents', () => {
    const bad = { ...operation, createdAt: 123 };
    const independent = { ...operation, id: 'independent', idempotencyKey: 'other' };
    const result = classifyOutboxRecoveryGroups([operation, bad, independent]);
    expect(result.operations).toEqual([independent]);
    expect(result.rejected.map(({ record }) => record)).toEqual([operation, bad]);
  });
  it('keeps previously quarantined keys unavailable without changing identity', () => {
    const result = classifyOutboxRecoveryGroups([operation], new Set(['stable']));
    expect(result.groups.get('stable')?.classification).toBe('QUARANTINED_KEY');
    expect(result.rejected[0]?.record).toBe(operation);
  });
  it('keeps envelope validation separate from sale domain rules', () => {
    expect(isRecoverableLegacyOperation({ ...operation, payload: {} })).toBe(true);
  });
  it('never resets malformed SYNCING merely because its timing is valid', () => {
    const bad = { ...operation, status: 'SYNCING' as const, idempotencyKey: '', lastAttemptAt: '2026-10-04T12:00:00Z' };
    expect(resetInterruptedReplay(bad)).toBe(bad);
  });
});


it.each([false, true])('joint recovery retains rejected source evidence and disputes only matching destination; malformed=%s', (malformed) => {
  const incoming = malformed ? { ...operation, id: 'bad', createdAt: 123 }
    : { ...operation, id: 'different', payload: { saleNumber: 'B' } };
  const source = [operation, { ...operation, id: 'copy' }, incoming];
  const unrelated = { ...operation, id: 'other', idempotencyKey: 'unrelated' };
  const parsed = parseOutboxRecoverySource(JSON.stringify({ operations: source }));
  const checked = classifyOutboxRecoverySource(parsed.records, [operation, unrelated]);
  expect(checked.complete).toBe(false);
  expect(checked.operations).toEqual([]);
  expect(checked.disputed.map(({ record }) => record)).toEqual(expect.arrayContaining(source));
  expect(checked.disputed.some(({ record }) => record === unrelated)).toBe(false);
});
it('joint recovery permits cleanup for a valid removed destination and identical destination lifecycle', () => {
  const pending = { ...operation, id: 'pending-copy', status: 'PENDING' as const, attemptCount: 0 };
  expect(classifyOutboxRecoverySource([pending], []).complete).toBe(true);
  const checked = classifyOutboxRecoverySource([pending], [operation]);
  expect(checked.complete).toBe(true);
  expect(checked.disputed).toEqual([]);
  expect(classifyOutboxRecoveryGroups([operation, pending]).operations).toEqual([operation]);
});
it('source parsing keeps malformed keyed members instead of filtering them before classification', () => {
  const malformed = { idempotencyKey: operation.idempotencyKey, createdAt: null };
  expect(parseOutboxRecoverySource(JSON.stringify({ version: 1, operations: [operation, malformed] }), 1))
    .toEqual({ records: [operation, malformed], validContainer: true });
  expect(parseOutboxRecoverySource('{broken', 1)).toEqual({ records: [], validContainer: false });
  expect(parseOutboxRecoverySource('{"version":2,"operations":[]}', 1).validContainer).toBe(false);
});
