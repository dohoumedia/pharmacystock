import { outboxReplayEligibleAt, OutboxOwnerMismatchError, OutboxStore, type OutboxOperation, type OutboxUpdate } from './outbox';
import { isRecoverableLegacyOperation, stableOutboxSerialize } from './outboxRecovery';

export type ReplayResult =
  | { status: 'SKIPPED' }
  | { status: 'SYNCED'; serverId?: string }
  | { status: 'CONFLICT'; errorCode: string }
  | { status: 'FAILED'; errorCode: string; retryable: boolean };

export type ReplayHandler = (operation: OutboxOperation) => Promise<ReplayResult>;

type ReplaySummary = { synced: number; conflicts: number; failed: number };

function matchesReplayAttempt(current: OutboxOperation | undefined, expected: OutboxOperation): current is OutboxOperation {
  return current !== undefined && isRecoverableLegacyOperation(current)
    && stableOutboxSerialize(current) === stableOutboxSerialize(expected);
}
type ReplayLock = (run: () => Promise<ReplaySummary>) => Promise<ReplaySummary | null>;

// Shared by all coordinator instances in this runtime, not by an auth owner or
// scheduler lifecycle. Never release an unresolved replay on scheduler stop:
// an already-dispatched RPC can still complete after its generation is obsolete.
let runtimeReplayActive = false;

async function withRuntimeReplayLock(replayLock: ReplayLock, run: () => Promise<ReplaySummary>) {
  if (runtimeReplayActive) return null;
  runtimeReplayActive = true;
  try {
    return await replayLock(run);
  } finally {
    runtimeReplayActive = false;
  }
}

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
  private replayOwnerId?: string | null;

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
    this.inFlight = withRuntimeReplayLock(this.replayLock, () => this.runReplay())
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

  private async readForReplay(expected: OutboxOperation): Promise<OutboxOperation | null> {
    if (!this.canReplay()) return null;
    try {
      const operations = await this.outbox.refresh(this.replayOwnerId);
      if (!this.canReplay()) return null;
      const current = operations.find((operation) => operation.id === expected.id);
      // Compare identity, immutable content and the captured lifecycle/attempt.
      // A replacement, quarantine, or newer attempt cannot inherit this replay.
      return matchesReplayAttempt(current, expected) ? current : null;
    } catch (error) {
      if (error instanceof OutboxOwnerMismatchError) return null;
      throw error;
    }
  }

  private isDue(operation: OutboxOperation): boolean {
    const eligibleAt = outboxReplayEligibleAt(operation);
    return eligibleAt !== null && eligibleAt <= this.now().getTime();
  }

  private async updateForReplay(operation: OutboxOperation, patch: OutboxUpdate): Promise<OutboxOperation | null> {
    if (!this.canReplay()) return null;
    try {
      // Compare and update inside the adapter's existing serialized commit.
      // Null is a lost membership/attempt, never permission to submit or count.
      const updated = await this.outbox.update(operation.id, patch, this.replayOwnerId, operation);
      return updated && this.canReplay()
        && stableOutboxSerialize(updated) === stableOutboxSerialize({ ...operation, ...patch }) ? updated : null;
    } catch (error) {
      if (error instanceof OutboxOwnerMismatchError) return null;
      throw error;
    }
  }

  private async runReplay(): Promise<{ synced: number; conflicts: number; failed: number }> {
    let synced = 0;
    let conflicts = 0;
    let failed = 0;

    if (!this.canReplay()) return { synced, conflicts, failed };
    // Even callers without an explicit owner remain bound to the durable owner
    // captured under the replay lock; null is an explicit unowned scope.
    this.replayOwnerId = this.expectedOwnerId ?? await this.outbox.owner();
    if (!this.canReplay()) return { synced, conflicts, failed };
    // The runtime lock and, where available, browser replay lock are held here.
    // Refresh after acquiring them to replay the latest durable owner/state.
    try {
      await this.outbox.refresh(this.replayOwnerId);
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
        for (const captured of pending) {
          if (!this.canReplay()) break;
          const operation = await this.readForReplay(captured);
          if (!operation || !this.isDue(operation)) continue;
          const attemptCount = operation.attemptCount + 1;
          if (!await this.updateForReplay(operation, {
            status: preparationError.retryable ? 'FAILED' : 'CONFLICT',
            attemptCount,
            lastAttemptAt: this.now().toISOString(),
            nextAttemptAt: preparationError.retryable ? this.retryAt(attemptCount) : undefined,
            lastErrorCode: preparationError.code,
          })) continue;
          if (preparationError.retryable) failed += 1;
          else conflicts += 1;
        }
        return { synced, conflicts, failed };
      }
    }

    for (const captured of pending) {
      if (!this.canReplay()) return { synced, conflicts, failed };
      const operation = await this.readForReplay(captured);
      if (!operation || !this.isDue(operation)) continue;
      const handler = this.handlers[operation.kind];
      const nextAttemptCount = operation.attemptCount + 1;
      const attemptAt = this.now().toISOString();

      if (!handler) {
        if (!await this.updateForReplay(operation, {
          status: 'CONFLICT',
          attemptCount: nextAttemptCount,
          lastAttemptAt: attemptAt,
          nextAttemptAt: undefined,
          lastErrorCode: 'OUTBOX_HANDLER_MISSING',
        })) continue;
        conflicts += 1;
        continue;
      }

      const claimed = await this.updateForReplay(operation, {
        status: 'SYNCING',
        attemptCount: nextAttemptCount,
        lastAttemptAt: attemptAt,
        nextAttemptAt: undefined,
        lastErrorCode: undefined,
      });
      if (!claimed) continue;
      // Final durable membership guard after asynchronous preparation AND the
      // SYNCING commit. Only this exact claimed attempt may reach submission.
      let active: OutboxOperation[];
      try {
        active = await this.outbox.refresh(this.replayOwnerId);
      } catch (error) {
        if (error instanceof OutboxOwnerMismatchError) return { synced, conflicts, failed };
        throw error;
      }
      if (!this.canReplay()) return { synced, conflicts, failed };
      const authoritative = active.find((item) => item.id === claimed.id);
      if (!matchesReplayAttempt(authoritative, claimed)) continue;
      try {
        // The SALE transport additionally fences SDK token acquisition at the
        // actual fetch boundary, inside the adapter dispatch critical section.
        const result = await handler(authoritative);
        if (!this.canReplay()) return { synced, conflicts, failed };
        if (result.status === 'SKIPPED') continue;
        if (result.status === 'SYNCED') {
          if (!await this.updateForReplay(authoritative, {
            status: 'SYNCED',
            serverId: result.serverId,
            nextAttemptAt: undefined,
            lastErrorCode: undefined,
          })) continue;
          synced += 1;
        } else if (result.status === 'CONFLICT') {
          if (!await this.updateForReplay(authoritative, {
            status: 'CONFLICT',
            nextAttemptAt: undefined,
            lastErrorCode: result.errorCode,
          })) continue;
          conflicts += 1;
        } else if (result.retryable) {
          if (!await this.updateForReplay(authoritative, {
            status: 'FAILED',
            nextAttemptAt: this.retryAt(nextAttemptCount),
            lastErrorCode: result.errorCode,
          })) continue;
          failed += 1;
        } else {
          if (!await this.updateForReplay(authoritative, {
            status: 'CONFLICT',
            nextAttemptAt: undefined,
            lastErrorCode: result.errorCode,
          })) continue;
          conflicts += 1;
        }
      } catch (error) {
        if (error instanceof OutboxOwnerMismatchError) return { synced, conflicts, failed };
        if (!this.canReplay()) return { synced, conflicts, failed };
        if (!await this.updateForReplay(authoritative, {
          status: 'FAILED',
          nextAttemptAt: this.retryAt(nextAttemptCount),
          lastErrorCode: 'NETWORK_OR_UNKNOWN_ERROR',
        })) continue;
        failed += 1;
      }
    }

    return { synced, conflicts, failed };
  }
}
