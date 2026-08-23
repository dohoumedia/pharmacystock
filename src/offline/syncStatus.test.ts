import { describe, expect, it } from 'vitest';
import type { OutboxOperation, OutboxStatus } from './outbox';
import { deriveSyncStatus } from './syncStatus';

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

  it('distinguishes active sync, queued work, offline, and synchronized states', () => {
    expect(deriveSyncStatus('online', [operation('SYNCING')]).kind).toBe('syncing');
    expect(deriveSyncStatus('online', [operation('FAILED')]).kind).toBe('pending');
    expect(deriveSyncStatus('offline', []).kind).toBe('offline');
    expect(deriveSyncStatus('online', [operation('SYNCED')]).kind).toBe('synced');
  });
});
