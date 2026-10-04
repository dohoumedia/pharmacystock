import {
  OUTBOX_STALE_SYNCING_AFTER_MS,
  OutboxOwnerMismatchError,
  OutboxStore,
  outboxReplayEligibleAt,
  type OutboxOperation,
} from './outbox';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
export const DEFAULT_REPLAY_CONTENTION_RETRY_MS = 5_000;

type ReplaySchedulerOptions = {
  expectedOwnerId: string;
  staleSyncingAfterMs?: number;
  contentionRetryMs?: number;
  now?: () => Date;
};

export type ScheduledReplayContext = {
  expectedOwnerId: string;
  isCurrent: () => boolean;
};

export function nextOutboxReplayAt(
  operations: readonly OutboxOperation[],
  now = new Date(),
  staleSyncingAfterMs = OUTBOX_STALE_SYNCING_AFTER_MS,
  dueRecheckDelayMs = 0,
): number | null {
  let earliest: number | null = null;
  const nowMs = now.getTime();
  for (const operation of operations) {
    const eligibleAt = outboxReplayEligibleAt(operation, staleSyncingAfterMs);
    if (eligibleAt === null) continue;
    // Due work gets a bounded recheck after a replay attempt, but must not
    // mask any other record's earlier future eligibility boundary.
    const wakeAt = eligibleAt <= nowMs ? nowMs + Math.max(0, dueRecheckDelayMs) : eligibleAt;
    if (earliest === null || wakeAt < earliest) earliest = wakeAt;
  }
  return earliest;
}

export class OutboxReplayScheduler {
  private readonly now: () => Date;
  private readonly staleSyncingAfterMs: number;
  private readonly contentionRetryMs: number;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private evaluation = 0;
  private running = false;
  private lifecycle = 0;

  constructor(
    private readonly outbox: OutboxStore,
    private readonly replay: (context: ScheduledReplayContext) => Promise<unknown>,
    private readonly options: ReplaySchedulerOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.staleSyncingAfterMs = options.staleSyncingAfterMs ?? OUTBOX_STALE_SYNCING_AFTER_MS;
    this.contentionRetryMs = Math.max(1, options.contentionRetryMs ?? DEFAULT_REPLAY_CONTENTION_RETRY_MS);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.unsubscribe = this.outbox.subscribe(() => this.wake());
    this.wake();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.evaluation += 1;
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  wake(): void {
    if (!this.active) return;
    if (this.running) return;
    this.clearTimer();
    const evaluation = ++this.evaluation;
    void this.evaluate(evaluation, true, 0);
  }

  private async evaluate(
    evaluation: number,
    allowReplay: boolean,
    minimumDelayMs: number,
  ): Promise<void> {
    let operations: OutboxOperation[];
    try {
      operations = await this.outbox.refresh(this.options.expectedOwnerId);
    } catch (error) {
      if (!this.isCurrent(evaluation)) return;
      if (error instanceof OutboxOwnerMismatchError) return;
      this.schedule(this.contentionRetryMs);
      return;
    }
    if (!this.isCurrent(evaluation)) return;

    const now = this.now();
    const replayAt = nextOutboxReplayAt(
      operations, now, this.staleSyncingAfterMs, allowReplay ? 0 : minimumDelayMs,
    );
    if (replayAt === null) return;
    const delay = Math.max(0, replayAt - now.getTime());
    if (allowReplay && delay === 0) {
      void this.runReplay(evaluation);
      return;
    }
    this.schedule(delay);
  }

  private async runReplay(evaluation: number): Promise<void> {
    if (!this.isCurrent(evaluation) || this.running) return;
    this.running = true;
    const lifecycle = this.lifecycle;
    try {
      await this.replay({
        expectedOwnerId: this.options.expectedOwnerId,
        isCurrent: () => this.active && lifecycle === this.lifecycle,
      });
    } catch {
      // Replay state remains durable. A bounded recheck below retries storage,
      // lock contention, or transient coordinator failures without spinning.
    } finally {
      this.running = false;
      if (!this.active) return;
      const nextEvaluation = ++this.evaluation;
      await this.evaluate(nextEvaluation, false, this.contentionRetryMs);
    }
  }

  private schedule(delayMs: number): void {
    if (!this.active) return;
    this.clearTimer();
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, Math.ceil(delayMs)));
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.active || this.running) return;
      const evaluation = ++this.evaluation;
      void this.evaluate(evaluation, true, 0);
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private isCurrent(evaluation: number): boolean {
    return this.active && evaluation === this.evaluation;
  }
}
