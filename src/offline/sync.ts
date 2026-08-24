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
  beforeReplay?: () => Promise<void>;
  canReplay?: () => boolean;
};

export class ReplayPreparationError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'ReplayPreparationError';
  }
}

export class SyncCoordinator {
  private inFlight: Promise<{ synced: number; conflicts: number; failed: number }> | null = null;
  private readonly now: () => Date;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly beforeReplay?: () => Promise<void>;
  private readonly canReplay: () => boolean;

  constructor(
    private readonly outbox: OutboxStore,
    private readonly handlers: Record<string, ReplayHandler>,
    options: SyncCoordinatorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.retryBaseMs = options.retryBaseMs ?? 2_000;
    this.retryMaxMs = options.retryMaxMs ?? 5 * 60_000;
    this.beforeReplay = options.beforeReplay;
    this.canReplay = options.canReplay ?? (() => true);
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

    const pending = this.outbox.pending(this.now());
    if (!this.canReplay()) return { synced, conflicts, failed };
    if (pending.length > 0 && this.beforeReplay) {
      try {
        await this.beforeReplay();
        if (!this.canReplay()) return { synced, conflicts, failed };
      } catch (error) {
        if (!this.canReplay()) return { synced, conflicts, failed };
        const preparationError = error instanceof ReplayPreparationError
          ? error
          : new ReplayPreparationError('REPLAY_PREPARATION_FAILED', true);
        for (const operation of pending) {
          const attemptCount = operation.attemptCount + 1;
          this.outbox.update(operation.id, {
            status: preparationError.retryable ? 'FAILED' : 'CONFLICT',
            attemptCount,
            lastAttemptAt: this.now().toISOString(),
            nextAttemptAt: preparationError.retryable ? this.retryAt(attemptCount) : undefined,
            lastErrorCode: preparationError.code,
          });
        }
        return preparationError.retryable
          ? { synced: 0, conflicts: 0, failed: pending.length }
          : { synced: 0, conflicts: pending.length, failed: 0 };
      }
    }

    for (const operation of pending) {
      if (!this.canReplay()) return { synced, conflicts, failed };
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
        if (!this.canReplay()) return { synced, conflicts, failed };
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
        if (!this.canReplay()) return { synced, conflicts, failed };
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
