import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboxStore } from './outbox';
import { OutboxReplayScheduler } from './replayScheduler';
import { OfflineSessionScope } from './sessionScope';
import type { KeyValueStorage } from './storage';
import { SyncCoordinator } from './sync';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

async function ownedOutbox(storage: KeyValueStorage, userId = 'user-a') {
  const scope = new OfflineSessionScope(storage);
  await scope.bindUser(userId);
  const outbox = new OutboxStore(storage);
  await outbox.ready();
  return { outbox, scope };
}

async function enqueue(outbox: OutboxStore, id: string, userId = 'user-a') {
  await outbox.enqueue({
    id,
    kind: 'SALE',
    organizationId: 'org-a',
    branchId: 'branch-a',
    idempotencyKey: `${id}-stable-key`,
    payload: {},
    createdAt: '2026-10-01T11:55:00.000Z',
  }, userId);
}

describe('outbox replay scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not replay young SYNCING work before the threshold and replays at the boundary', async () => {
    const { outbox } = await ownedOutbox(memoryStorage());
    await enqueue(outbox, 'young-syncing');
    await outbox.update('young-syncing', {
      status: 'SYNCING',
      attemptCount: 1,
      lastAttemptAt: '2026-10-01T12:00:00.000Z',
    }, 'user-a');
    vi.setSystemTime(new Date('2026-10-01T12:01:00.000Z'));

    const seen: string[] = [];
    const coordinator = new SyncCoordinator(outbox, {
      SALE: async (operation) => {
        seen.push(operation.idempotencyKey);
        return { status: 'SYNCED' };
      },
    }, { expectedOwnerId: 'user-a' });
    const scheduler = new OutboxReplayScheduler(
      outbox,
      () => coordinator.replayPending(),
      { expectedOwnerId: 'user-a' },
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(seen).toEqual([]);
    expect(outbox.list()[0]?.status).toBe('SYNCING');

    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual(['young-syncing-stable-key']);
    expect(outbox.list()[0]?.status).toBe('SYNCED');
    scheduler.stop();
  });

  it('wakes FAILED work at nextAttemptAt', async () => {
    const { outbox } = await ownedOutbox(memoryStorage());
    await enqueue(outbox, 'failed-retry');
    await outbox.update('failed-retry', {
      status: 'FAILED',
      attemptCount: 1,
      lastAttemptAt: '2026-10-01T12:00:00.000Z',
      nextAttemptAt: '2026-10-01T12:00:30.000Z',
      lastErrorCode: 'NETWORK',
    }, 'user-a');
    const submit = vi.fn(async () => ({ status: 'SYNCED' as const }));
    const coordinator = new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a' });
    const scheduler = new OutboxReplayScheduler(outbox, () => coordinator.replayPending(), {
      expectedOwnerId: 'user-a',
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(submit).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('keeps malformed replay timing fail-closed while preserving existing missing FAILED retry behavior', async () => {
    const { outbox } = await ownedOutbox(memoryStorage());
    await enqueue(outbox, 'syncing-missing');
    await enqueue(outbox, 'syncing-invalid');
    await enqueue(outbox, 'failed-invalid');
    await enqueue(outbox, 'failed-empty');
    await enqueue(outbox, 'failed-number');
    await enqueue(outbox, 'failed-missing');
    await outbox.update('syncing-missing', { status: 'SYNCING', attemptCount: 1 }, 'user-a');
    await outbox.update('syncing-invalid', {
      status: 'SYNCING', attemptCount: 1, lastAttemptAt: 'not-a-date',
    }, 'user-a');
    await outbox.update('failed-invalid', {
      status: 'FAILED', attemptCount: 1, nextAttemptAt: 'not-a-date',
    }, 'user-a');
    await outbox.update('failed-missing', { status: 'FAILED', attemptCount: 1 }, 'user-a');
    await outbox.update('failed-empty', { status: 'FAILED', nextAttemptAt: '' }, 'user-a');
    await outbox.update('failed-number', {
      status: 'FAILED', nextAttemptAt: 0 as unknown as string,
    }, 'user-a');
    const malformed = outbox.list().filter((operation) => operation.id !== 'failed-missing');

    const seen: string[] = [];
    const coordinator = new SyncCoordinator(outbox, {
      SALE: async (operation) => {
        seen.push(operation.id);
        return { status: 'SYNCED' };
      },
    }, { expectedOwnerId: 'user-a' });
    const scheduler = new OutboxReplayScheduler(outbox, () => coordinator.replayPending(), {
      expectedOwnerId: 'user-a',
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['failed-missing']);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(seen).toEqual(['failed-missing']);
    expect(outbox.list().filter((operation) => operation.status !== 'SYNCED')).toEqual(malformed);
    expect(vi.getTimerCount()).toBe(0);
    scheduler.stop();
  });

  it('uses a bounded retry after lock contention instead of a zero-delay loop', async () => {
    const { outbox } = await ownedOutbox(memoryStorage());
    await enqueue(outbox, 'contended');
    const attempts = vi.fn(async () => undefined);
    const scheduler = new OutboxReplayScheduler(outbox, attempts, {
      expectedOwnerId: 'user-a',
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(attempts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('preserves a two-second FAILED deadline after replay instead of imposing the contention delay', async () => {
    const { outbox } = await ownedOutbox(memoryStorage());
    await enqueue(outbox, 'short-retry');
    const submit = vi.fn()
      .mockResolvedValueOnce({ status: 'FAILED', errorCode: 'NETWORK', retryable: true })
      .mockResolvedValueOnce({ status: 'SYNCED' });
    const coordinator = new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a' });
    const scheduler = new OutboxReplayScheduler(outbox, () => coordinator.replayPending(), {
      expectedOwnerId: 'user-a',
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(outbox.list()[0]?.nextAttemptAt).toBe('2026-10-01T12:00:02.000Z');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(outbox.list()[0]?.status).toBe('SYNCED');
    expect(vi.getTimerCount()).toBe(0);
    scheduler.stop();
  });

  it.each(['FAILED', 'SYNCING'] as const)(
    'does not let stalled due work mask a future %s boundary in two seconds', async (status) => {
      const { outbox } = await ownedOutbox(memoryStorage());
      await enqueue(outbox, 'already-due');
      await enqueue(outbox, 'future');
      await outbox.update('future', status === 'FAILED'
        ? { status, nextAttemptAt: '2026-10-01T12:00:02.000Z' }
        : { status, lastAttemptAt: '2026-10-01T11:58:02.000Z' }, 'user-a');
      const attempts = vi.fn(async () => outbox.pending().map((operation) => operation.id));
      const scheduler = new OutboxReplayScheduler(outbox, attempts, { expectedOwnerId: 'user-a' });
      try {
        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(attempts).toHaveBeenCalledTimes(1);
        await expect(attempts.mock.results[0]?.value).resolves.toEqual(['already-due']);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1_999);
        expect(attempts).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(attempts).toHaveBeenCalledTimes(2);
        await expect(attempts.mock.results[1]?.value).resolves.toEqual(['already-due', 'future']);
        // Both are now due: resume the bounded recheck, not a zero-delay loop.
        await vi.advanceTimersByTimeAsync(4_999);
        expect(attempts).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(attempts).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(1);
      } finally {
        scheduler.stop();
      }
    },
  );

  it.each(['', 'not-a-date', 0, null, {}])(
    'keeps malformed SYNCING lastAttemptAt %j unchanged and unscheduled', async (lastAttemptAt) => {
      const { outbox } = await ownedOutbox(memoryStorage());
      await enqueue(outbox, 'malformed-syncing');
      await outbox.update('malformed-syncing', {
        status: 'SYNCING', lastAttemptAt: lastAttemptAt as unknown as string,
      }, 'user-a');
      const original = outbox.list();
      const replay = vi.fn(async () => undefined);
      const scheduler = new OutboxReplayScheduler(outbox, replay, { expectedOwnerId: 'user-a' });
      try {
        scheduler.start();
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(replay).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(outbox.pending()).toEqual([]);
        expect(outbox.list()).toEqual(original);
      } finally {
        scheduler.stop();
      }
    },
  );

  it('keeps one in-flight coordinator across stop/start lifecycle transitions', async () => {
    const { outbox } = await ownedOutbox(memoryStorage());
    await enqueue(outbox, 'single-runtime');
    let started!: () => void;
    const handlerStarted = new Promise<void>((resolve) => { started = resolve; });
    let finish!: () => void;
    const handlerBlocked = new Promise<void>((resolve) => { finish = resolve; });
    const submit = vi.fn(async () => {
      started();
      await handlerBlocked;
      return { status: 'SYNCED' as const };
    });
    const coordinator = new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a' });
    const scheduler = new OutboxReplayScheduler(outbox, () => coordinator.replayPending(), {
      expectedOwnerId: 'user-a',
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await handlerStarted;
    scheduler.stop();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(outbox.list()[0]?.status).toBe('SYNCED');
    scheduler.stop();
  });

  it('does not double-submit when Tab A holds the replay lock and Tab B reaches the stale threshold', async () => {
    const storage = memoryStorage();
    const { outbox: firstOutbox } = await ownedOutbox(storage);
    const secondOutbox = new OutboxStore(storage);
    await secondOutbox.ready();
    await enqueue(firstOutbox, 'cross-tab');

    let locked = false;
    const sharedReplayLock = async (
      run: () => Promise<{ synced: number; conflicts: number; failed: number }>,
    ) => {
      if (locked) return null;
      locked = true;
      try {
        return await run();
      } finally {
        locked = false;
      }
    };
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    let finishFirst!: () => void;
    const blocked = new Promise<void>((resolve) => { finishFirst = resolve; });
    const seen: string[] = [];
    const firstCoordinator = new SyncCoordinator(firstOutbox, {
      SALE: async (operation) => {
        seen.push(`first:${operation.idempotencyKey}`);
        firstStarted();
        await blocked;
        return { status: 'SYNCED' };
      },
    }, { expectedOwnerId: 'user-a', replayLock: sharedReplayLock });
    const secondCoordinator = new SyncCoordinator(secondOutbox, {
      SALE: async (operation) => {
        seen.push(`second:${operation.idempotencyKey}`);
        return { status: 'SYNCED' };
      },
    }, { expectedOwnerId: 'user-a', replayLock: sharedReplayLock });

    const firstReplay = firstCoordinator.replayPending();
    await started;
    const secondScheduler = new OutboxReplayScheduler(
      secondOutbox,
      () => secondCoordinator.replayPending(),
      { expectedOwnerId: 'user-a', contentionRetryMs: 1_000 },
    );
    secondScheduler.start();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(seen).toEqual(['first:cross-tab-stable-key']);

    finishFirst();
    await firstReplay;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen).toEqual(['first:cross-tab-stable-key']);
    expect(secondOutbox.list()[0]).toMatchObject({
      status: 'SYNCED',
      idempotencyKey: 'cross-tab-stable-key',
    });
    secondScheduler.stop();
  });

  it('recovers an abandoned SYNCING operation exactly once with its stable idempotency key', async () => {
    const { outbox } = await ownedOutbox(memoryStorage());
    await enqueue(outbox, 'abandoned');
    await outbox.update('abandoned', {
      status: 'SYNCING',
      attemptCount: 1,
      lastAttemptAt: '2026-10-01T12:00:00.000Z',
    }, 'user-a');
    vi.setSystemTime(new Date('2026-10-01T12:01:00.000Z'));
    const submit = vi.fn(async (operation) => ({
      status: 'SYNCED' as const,
      serverId: operation.idempotencyKey,
    }));
    const coordinator = new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a' });
    const scheduler = new OutboxReplayScheduler(outbox, () => coordinator.replayPending(), {
      expectedOwnerId: 'user-a',
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'abandoned-stable-key',
    }));
    expect(outbox.list()[0]).toMatchObject({
      status: 'SYNCED',
      idempotencyKey: 'abandoned-stable-key',
      serverId: 'abandoned-stable-key',
    });
    scheduler.stop();
  });

  it('cancels an old-owner timer on sign-out or user switch', async () => {
    const storage = memoryStorage();
    const { outbox, scope } = await ownedOutbox(storage);
    await enqueue(outbox, 'old-owner');
    await outbox.update('old-owner', {
      status: 'SYNCING',
      attemptCount: 1,
      lastAttemptAt: '2026-10-01T12:00:00.000Z',
    }, 'user-a');
    const submit = vi.fn(async () => ({ status: 'SYNCED' as const }));
    const replayScope = scope.replayScope();
    const coordinator = new SyncCoordinator(outbox, { SALE: submit }, {
      expectedOwnerId: 'user-a',
      canReplay: () => scope.isReplayScopeCurrent(replayScope),
    });
    const scheduler = new OutboxReplayScheduler(outbox, () => coordinator.replayPending(), {
      expectedOwnerId: 'user-a',
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await scope.bindUser('user-b');
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(submit).not.toHaveBeenCalled();
    expect(await outbox.owner()).toBe('user-b');
    expect(outbox.list()).toEqual([]);
  });

  it('recomputes eligibility on resume after a delayed timer deadline', async () => {
    const { outbox } = await ownedOutbox(memoryStorage());
    await enqueue(outbox, 'resume');
    await outbox.update('resume', {
      status: 'SYNCING',
      attemptCount: 1,
      lastAttemptAt: '2026-10-01T12:00:00.000Z',
    }, 'user-a');
    vi.setSystemTime(new Date('2026-10-01T12:01:00.000Z'));
    const submit = vi.fn(async () => ({ status: 'SYNCED' as const }));
    const coordinator = new SyncCoordinator(outbox, { SALE: submit }, { expectedOwnerId: 'user-a' });
    const scheduler = new OutboxReplayScheduler(outbox, () => coordinator.replayPending(), {
      expectedOwnerId: 'user-a',
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(new Date('2026-10-01T12:03:00.000Z'));
    scheduler.wake();
    await vi.advanceTimersByTimeAsync(0);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(outbox.list()[0]?.status).toBe('SYNCED');
    scheduler.stop();
  });

  it('does not replay operations owned by another authenticated user', async () => {
    const storage = memoryStorage();
    const { outbox, scope } = await ownedOutbox(storage);
    await enqueue(outbox, 'private-a');
    await scope.bindUser('user-b');
    const replay = vi.fn(async () => undefined);
    const staleOwnerScheduler = new OutboxReplayScheduler(outbox, replay, {
      expectedOwnerId: 'user-a',
      contentionRetryMs: 1_000,
    });

    staleOwnerScheduler.start();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(replay).not.toHaveBeenCalled();
    expect(await outbox.owner()).toBe('user-b');
    expect(outbox.list()).toEqual([]);
    staleOwnerScheduler.stop();
  });
});
