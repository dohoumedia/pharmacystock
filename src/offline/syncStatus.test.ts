import { describe, expect, it } from 'vitest';
import type { OutboxOperation, OutboxStatus } from './outbox';
import { deriveSyncStatus } from './syncStatus';
import { OUTBOX_DISPATCH_BLOCKED_CODE } from './outboxRecovery';

function operation(status: OutboxStatus): OutboxOperation {
  return {
    id: status,
    kind: 'SALE',
    organizationId: 'org-1',
    branchId: 'branch-1',
    idempotencyKey: `key-${status}`,
    payload: {},
    createdAt: '2026-08-23T00:00:00.000Z',
    status,
    attemptCount: 0,
  };
}

describe('deriveSyncStatus', () => {
  it('shows conflicts ahead of connectivity and pending work', () => {
    expect(deriveSyncStatus('offline', [operation('PENDING'), operation('CONFLICT')])).toEqual({
      kind: 'conflict',
      pendingCount: 1,
      conflictCount: 1,
    });
  });

  it('shows structural browser dispatch blocking as pending without hiding actual active sync', () => {
    const blocked = { ...operation('SYNCING'), lastErrorCode: OUTBOX_DISPATCH_BLOCKED_CODE };
    expect(deriveSyncStatus('online', [blocked])).toEqual({ kind: 'pending', pendingCount: 1, conflictCount: 0 });
    expect(deriveSyncStatus('online', [blocked, operation('SYNCING')]).kind).toBe('syncing');
    expect(deriveSyncStatus('offline', [blocked]).kind).toBe('offline');
  });

  it('distinguishes active sync, queued work, offline, and synchronized states', () => {
    expect(deriveSyncStatus('online', [operation('SYNCING')]).kind).toBe('syncing');
    expect(deriveSyncStatus('online', [operation('FAILED')]).kind).toBe('pending');
    expect(deriveSyncStatus('offline', []).kind).toBe('offline');
    expect(deriveSyncStatus('online', [operation('SYNCED')]).kind).toBe('synced');
  });
});
