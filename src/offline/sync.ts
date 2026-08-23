import { OutboxStore, type OutboxOperation } from './outbox';

export type ReplayResult =
  | { status: 'SYNCED'; serverId?: string }
  | { status: 'CONFLICT'; errorCode: string }
  | { status: 'FAILED'; errorCode: string; retryable: boolean };

export type ReplayHandler = (operation: OutboxOperation) => Promise<ReplayResult>;

type SyncCoordinatorOptions = {
  now?: () => Date;
  retryBaseMs?: number;
  retryMaxMs?: number;
};

export class SyncCoordinator {
  private inFlight: Promise<{ synced: number; conflicts: number; failed: number }> | null = null;
  private readonly now: () => Date;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(
    private readonly outbox: OutboxStore,
    private readonly handlers: Record<string, ReplayHandler>,
    options: SyncCoordinatorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.retryBaseMs = options.retryBaseMs ?? 2_000;
    this.retryMaxMs = options.retryMaxMs ?? 5 * 60_000;
  }

  replayPending(): Promise<{ synced: number; conflicts: number; failed: number }> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runReplay().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private retryAt(attemptCount: number): string {
    const exponent = Math.max(0, attemptCount - 1);
    const delay = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** exponent);
    return new Date(this.now().getTime() + delay).toISOString();
  }

  private async runReplay(): Promise<{ synced: number; conflicts: number; failed: number }> {
    let synced = 0;
    let conflicts = 0;
    let failed = 0;

    for (const operation of this.outbox.pending(this.now())) {
      const handler = this.handlers[operation.kind];
      const nextAttemptCount = operation.attemptCount + 1;
      const attemptAt = this.now().toISOString();

      if (!handler) {
        this.outbox.update(operation.id, {
          status: 'CONFLICT',
          attemptCount: nextAttemptCount,
          lastAttemptAt: attemptAt,
          nextAttemptAt: undefined,
          lastErrorCode: 'OUTBOX_HANDLER_MISSING',
        });
        conflicts += 1;
        continue;
      }

      this.outbox.update(operation.id, {
        status: 'SYNCING',
        attemptCount: nextAttemptCount,
        lastAttemptAt: attemptAt,
        nextAttemptAt: undefined,
        lastErrorCode: undefined,
      });

      try {
        const result = await handler(operation);
        if (result.status === 'SYNCED') {
          this.outbox.update(operation.id, {
            status: 'SYNCED',
            serverId: result.serverId,
            nextAttemptAt: undefined,
            lastErrorCode: undefined,
          });
          synced += 1;
        } else if (result.status === 'CONFLICT') {
          this.outbox.update(operation.id, {
            status: 'CONFLICT',
            nextAttemptAt: undefined,
            lastErrorCode: result.errorCode,
          });
          conflicts += 1;
        } else if (result.retryable) {
          this.outbox.update(operation.id, {
            status: 'FAILED',
            nextAttemptAt: this.retryAt(nextAttemptCount),
            lastErrorCode: result.errorCode,
          });
          failed += 1;
        } else {
          this.outbox.update(operation.id, {
            status: 'CONFLICT',
            nextAttemptAt: undefined,
            lastErrorCode: result.errorCode,
          });
          conflicts += 1;
        }
      } catch {
        this.outbox.update(operation.id, {
          status: 'FAILED',
          nextAttemptAt: this.retryAt(nextAttemptCount),
          lastErrorCode: 'NETWORK_OR_UNKNOWN_ERROR',
        });
        failed += 1;
      }
    }

    return { synced, conflicts, failed };
  }
}
