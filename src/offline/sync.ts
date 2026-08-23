import { OutboxStore, type OutboxOperation } from './outbox';

export type ReplayResult =
  | { status: 'SYNCED'; serverId?: string }
  | { status: 'CONFLICT'; errorCode: string }
  | { status: 'FAILED'; errorCode: string; retryable: boolean };

export type ReplayHandler = (operation: OutboxOperation) => Promise<ReplayResult>;

export class SyncCoordinator {
  constructor(
    private readonly outbox: OutboxStore,
    private readonly handlers: Record<string, ReplayHandler>,
  ) {}

  async replayPending(): Promise<{ synced: number; conflicts: number; failed: number }> {
    let synced = 0;
    let conflicts = 0;
    let failed = 0;

    for (const operation of this.outbox.pending()) {
      const handler = this.handlers[operation.kind];
      if (!handler) {
        this.outbox.update(operation.id, {
          status: 'FAILED',
          attemptCount: operation.attemptCount + 1,
          lastAttemptAt: new Date().toISOString(),
          lastErrorCode: 'OUTBOX_HANDLER_MISSING',
        });
        failed += 1;
        continue;
      }

      const attemptAt = new Date().toISOString();
      this.outbox.update(operation.id, {
        status: 'SYNCING',
        attemptCount: operation.attemptCount + 1,
        lastAttemptAt: attemptAt,
        lastErrorCode: undefined,
      });

      try {
        const result = await handler(operation);
        if (result.status === 'SYNCED') {
          this.outbox.update(operation.id, { status: 'SYNCED', serverId: result.serverId, lastErrorCode: undefined });
          synced += 1;
        } else if (result.status === 'CONFLICT') {
          this.outbox.update(operation.id, { status: 'CONFLICT', lastErrorCode: result.errorCode });
          conflicts += 1;
        } else {
          this.outbox.update(operation.id, {
            status: result.retryable ? 'FAILED' : 'CONFLICT',
            lastErrorCode: result.errorCode,
          });
          if (result.retryable) failed += 1;
          else conflicts += 1;
        }
      } catch {
        this.outbox.update(operation.id, { status: 'FAILED', lastErrorCode: 'NETWORK_OR_UNKNOWN_ERROR' });
        failed += 1;
      }
    }

    return { synced, conflicts, failed };
  }
}
