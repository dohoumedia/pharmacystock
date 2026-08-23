import type { ConnectivityState } from '@/providers/ConnectivityProvider';
import type { OutboxOperation } from './outbox';

export type SyncStatusKind = 'checking' | 'offline' | 'syncing' | 'conflict' | 'pending' | 'synced';

export type SyncStatusSnapshot = {
  kind: SyncStatusKind;
  pendingCount: number;
  conflictCount: number;
};

export function deriveSyncStatus(
  connectivity: ConnectivityState,
  operations: OutboxOperation[],
): SyncStatusSnapshot {
  const pendingCount = operations.filter((operation) =>
    ['PENDING', 'SYNCING', 'FAILED'].includes(operation.status),
  ).length;
  const conflictCount = operations.filter((operation) => operation.status === 'CONFLICT').length;

  if (connectivity === 'checking') return { kind: 'checking', pendingCount, conflictCount };
  if (conflictCount > 0) return { kind: 'conflict', pendingCount, conflictCount };
  if (connectivity === 'offline') return { kind: 'offline', pendingCount, conflictCount };
  if (operations.some((operation) => operation.status === 'SYNCING')) {
    return { kind: 'syncing', pendingCount, conflictCount };
  }
  if (pendingCount > 0) return { kind: 'pending', pendingCount, conflictCount };
  return { kind: 'synced', pendingCount, conflictCount };
}
