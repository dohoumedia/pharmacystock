import { OutboxOwnerMismatchError, OutboxStore, type OutboxOperation, type OutboxUpdate } from './outbox';

export type ReplayResult =
  | { status: 'SYNCED'; serverId?: string }
  | { status: 'CONFLICT'; errorCode: string }
  | { status: 'FAILED'; errorCode: string; retryable: boolean };

export type ReplayHandler = (operation: OutboxOperation) => Promise<ReplayResult>;

type ReplaySummary = { synced: number; conflicts: number; failed: number };
type ReplayLock = (run: () => Promise<ReplaySummary>) => Promise<ReplaySummary | null>;

type BrowserLockManager = {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown | null) => T | PromiseLike<T>,
  ): Promise<T>;
};

async function withBrowserReplayLock(run: () => Promise<ReplaySummary>): Promise<ReplaySummary | null> {
  const locks = (globalThis as typeof globalThis & {
    navigator?: { locks?: BrowserLockManager };
  }).navigator?.locks;

  if (!locks) return run();

  return locks.request('pharmacystock:offline-replay', { ifAvailable: true }, async (lock) => {
    if (!lock) return null;
    return run();
  });
}

type SyncCoordinatorOptions = {
  now?: () => Date;
  retryBaseMs?: number;
  retryMaxMs?: number;
  beforeReplay?: () => Promise<void>;
  canReplay?: () => boolean;
  replayLock?: ReplayLock;
  expectedOwnerId?: string;
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
  private readonly replayLock: ReplayLock;
  private readonly expectedOwnerId?: string;

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
    this.replayLock = options.replayLock ?? withBrowserReplayLock;
    this.expectedOwnerId = options.expectedOwnerId;
  }

  replayPending(): Promise<ReplaySummary> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.replayLock(() => this.runReplay())
      .then((result) => result ?? { synced: 0, conflicts: 0, failed: 0 })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private retryAt(attemptCount: number): string {
    const exponent = Math.max(0, attemptCount - 1);
    const delay = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** exponent);
    return new Date(this.now().getTime() + delay).toISOString();
  }

  private async updateForReplay(id: string, patch: OutboxUpdate): Promise<boolean> {
    try {
      await this.outbox.update(id, patch, this.expectedOwnerId);
      return true;
    } catch (error) {
      if (error instanceof OutboxOwnerMismatchError) return false;
      throw error;
    }
  }

  private async runReplay(): Promise<{ synced: number; conflicts: number; failed: number }> {
    let synced = 0;
    let conflicts = 0;
    let failed = 0;

    if (!this.canReplay()) return { synced, conflicts, failed };
    // The browser replay lock is already held here. Refresh after acquiring it
    // so this tab replays the latest transactionally persisted cross-tab state.
    try {
      await this.outbox.refresh(this.expectedOwnerId);
    } catch (error) {
      if (error instanceof OutboxOwnerMismatchError) return { synced, conflicts, failed };
      throw error;
    }
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
          if (!await this.updateForReplay(operation.id, {
            status: preparationError.retryable ? 'FAILED' : 'CONFLICT',
            attemptCount,
            lastAttemptAt: this.now().toISOString(),
            nextAttemptAt: preparationError.retryable ? this.retryAt(attemptCount) : undefined,
            lastErrorCode: preparationError.code,
          })) return { synced, conflicts, failed };
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
        if (!await this.updateForReplay(operation.id, {
          status: 'CONFLICT',
          attemptCount: nextAttemptCount,
          lastAttemptAt: attemptAt,
          nextAttemptAt: undefined,
          lastErrorCode: 'OUTBOX_HANDLER_MISSING',
        })) return { synced, conflicts, failed };
        conflicts += 1;
        continue;
      }

      if (!await this.updateForReplay(operation.id, {
        status: 'SYNCING',
        attemptCount: nextAttemptCount,
        lastAttemptAt: attemptAt,
        nextAttemptAt: undefined,
        lastErrorCode: undefined,
      })) return { synced, conflicts, failed };

      try {
        const result = await handler(operation);
        if (!this.canReplay()) return { synced, conflicts, failed };
        if (result.status === 'SYNCED') {
          if (!await this.updateForReplay(operation.id, {
            status: 'SYNCED',
            serverId: result.serverId,
            nextAttemptAt: undefined,
            lastErrorCode: undefined,
          })) return { synced, conflicts, failed };
          synced += 1;
        } else if (result.status === 'CONFLICT') {
          if (!await this.updateForReplay(operation.id, {
            status: 'CONFLICT',
            nextAttemptAt: undefined,
            lastErrorCode: result.errorCode,
          })) return { synced, conflicts, failed };
          conflicts += 1;
        } else if (result.retryable) {
          if (!await this.updateForReplay(operation.id, {
            status: 'FAILED',
            nextAttemptAt: this.retryAt(nextAttemptCount),
            lastErrorCode: result.errorCode,
          })) return { synced, conflicts, failed };
          failed += 1;
        } else {
          if (!await this.updateForReplay(operation.id, {
            status: 'CONFLICT',
            nextAttemptAt: undefined,
            lastErrorCode: result.errorCode,
          })) return { synced, conflicts, failed };
          conflicts += 1;
        }
      } catch (error) {
        if (error instanceof OutboxOwnerMismatchError) return { synced, conflicts, failed };
        if (!this.canReplay()) return { synced, conflicts, failed };
        if (!await this.updateForReplay(operation.id, {
          status: 'FAILED',
          nextAttemptAt: this.retryAt(nextAttemptCount),
          lastErrorCode: 'NETWORK_OR_UNKNOWN_ERROR',
        })) return { synced, conflicts, failed };
        failed += 1;
      }
    }

    return { synced, conflicts, failed };
  }
}
