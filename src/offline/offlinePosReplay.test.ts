/// <reference types="vite/client" />

import posSource from '../../app/pos.tsx?raw';
import providerSource from '../providers/SyncStatusProvider.tsx?raw';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxStore } from './outbox';
import type { OutboxReplayScheduler } from './replayScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

const schedulers: OutboxReplayScheduler[] = [];
const observers: (() => void)[] = [];

async function harness(importGate?: ReturnType<typeof deferred<void>>) {
  let userId = 'user-a';
  const importStarted = deferred<void>();
  const completeSale = vi.fn(async () => 'server-sale');
  const loadSales = vi.fn(async () => [{ id: 'server-sale' }]);
  const session = () => ({ data: { session: {
    user: { id: userId }, expires_at: Math.floor(Date.now() / 1000) + 3600,
  } }, error: null });
  const getSession = vi.fn(async () => session());
  const refreshSession = vi.fn(async () => session());
  const loadInventoryBalances = vi.fn(async () => []);
  vi.doMock('../services/sales', async () => {
    importStarted.resolve();
    await importGate?.promise;
    return { completeSale, loadSales };
  });
  vi.doMock('../lib/supabase', () => ({ supabase: { auth: { getSession, refreshSession } } }));
  vi.doMock('../services/inventory', () => ({ loadInventoryBalances }));
  const { replayPendingSales, createOfflinePosStores } = await import('./offlinePos');
  const { offlineSessionScope: scope } = await import('./sessionScope');
  const { OutboxReplayScheduler: Scheduler } = await import('./replayScheduler');
  await scope.bindUser(userId);
  const { outbox } = createOfflinePosStores();
  await outbox.ready();
  const replays: Promise<unknown>[] = [];
  const scheduler = (owner: string) => {
    const result = new Scheduler(outbox, (context) => {
      const replay = replayPendingSales(outbox, {
        expectedOwnerId: context.expectedOwnerId, canReplay: context.isCurrent,
      });
      replays.push(replay);
      return replay;
    }, { expectedOwnerId: owner });
    schedulers.push(result);
    return result;
  };
  return {
    outbox, scope, replayPendingSales, scheduler, importStarted, replays,
    completeSale, loadSales, getSession, refreshSession, loadInventoryBalances, session,
    switchUser: async (next: string | null) => {
      userId = next ?? '';
      await scope.bindUser(next);
    },
  };
}

async function enqueue(outbox: OutboxStore, owner = 'user-a', branchId = 'branch-a') {
  await outbox.enqueue({
    id: `sale-${owner}-${branchId}`, kind: 'SALE', organizationId: 'org-a', branchId,
    idempotencyKey: `stable-${owner}-${branchId}`, createdAt: new Date().toISOString(),
    payload: { organizationId: 'org-a', branchId, saleNumber: `SALE-${owner}`, lines: [], payments: [] },
  }, owner);
}

describe('app-level scheduled POS replay integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    // No Web Locks/IndexedDB: exercise the native single-runtime path.
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('indexedDB', undefined);
  });

  afterEach(() => {
    schedulers.splice(0).forEach((scheduler) => scheduler.stop());
    observers.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fences a stopped A callback during async import so overlapping native lifecycles submit B only once', async () => {
    const gate = deferred<void>();
    const h = await harness(gate);
    await enqueue(h.outbox);
    const first = h.scheduler('user-a');
    first.start();
    await vi.advanceTimersByTimeAsync(0);
    await h.importStarted.promise;
    first.stop();
    await h.switchUser('user-b');
    await enqueue(h.outbox, 'user-b');
    const secondInitialization = deferred<string | null>();
    vi.spyOn(h.outbox, 'owner').mockImplementationOnce(() => secondInitialization.promise);
    const second = h.scheduler('user-b');
    second.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.replays).toHaveLength(2);
    gate.resolve();
    await expect(h.replays[0]).resolves.toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.completeSale).not.toHaveBeenCalled();
    secondInitialization.resolve('user-b');
    await Promise.all(h.replays);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.completeSale).toHaveBeenCalledTimes(1);
    expect(h.completeSale).toHaveBeenCalledWith(expect.objectContaining({
      saleNumber: 'SALE-user-b', idempotencyKey: 'stable-user-b-branch-a',
    }));
    expect(h.getSession).toHaveBeenCalledTimes(1);
    expect(h.outbox.list()).toEqual([expect.objectContaining({ status: 'SYNCED', id: 'sale-user-b-branch-a' })]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(h.completeSale).toHaveBeenCalledTimes(1);
  });

  it('captures the initiating generation before asynchronous durable owner initialization', async () => {
    const h = await harness();
    await enqueue(h.outbox);
    const gate = deferred<string | null>();
    vi.spyOn(h.outbox, 'owner').mockImplementationOnce(() => gate.promise);
    const oldReplay = h.replayPendingSales(h.outbox, { expectedOwnerId: 'user-a' });
    await h.switchUser('user-b');
    await enqueue(h.outbox, 'user-b');
    gate.resolve('user-b');
    await expect(oldReplay).resolves.toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(h.outbox.list()[0]?.status).toBe('PENDING');
  });

  it.each([null, 'user-b'])('cancels preparation on real account boundary %s, even before provider cleanup', async (next) => {
    const h = await harness();
    await enqueue(h.outbox);
    const gate = deferred<ReturnType<typeof h.session>>();
    h.getSession.mockImplementationOnce(() => gate.promise);
    const scheduler = h.scheduler('user-a');
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getSession).toHaveBeenCalledTimes(1);
    await h.switchUser(next);
    gate.resolve(h.session());
    await Promise.all(h.replays);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshSession).not.toHaveBeenCalled();
    expect(h.loadInventoryBalances).not.toHaveBeenCalled();
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(h.outbox.list()).toEqual([]);
  });

  it('invalidates stopped preparation across stop/start without concurrent native submissions', async () => {
    const h = await harness();
    await enqueue(h.outbox);
    const gate = deferred<ReturnType<typeof h.session>>();
    h.getSession.mockImplementationOnce(() => gate.promise);
    const scheduler = h.scheduler('user-a');
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
    scheduler.start();
    gate.resolve(h.session());
    await Promise.all(h.replays);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(h.outbox.list()[0]?.status).toBe('PENDING');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.replays).toHaveLength(2);
    await Promise.all(h.replays);
    expect(h.completeSale).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'serializes an unresolved native RPC across A to B to A replacement, releasing after %s', async (settlement) => {
    const h = await harness();
    await enqueue(h.outbox);
    const started = deferred<void>();
    const finish = deferred<string>();
    let activeRpcs = 0;
    let maximumActiveRpcs = 0;
    h.completeSale.mockImplementation(async () => {
      activeRpcs += 1;
      maximumActiveRpcs = Math.max(maximumActiveRpcs, activeRpcs);
      try {
        if (h.completeSale.mock.calls.length === 1) {
          started.resolve();
          return await finish.promise;
        }
        return 'server-sale';
      } finally {
        activeRpcs -= 1;
      }
    });
    const original = h.scheduler('user-a');
    let replacement: OutboxReplayScheduler | undefined;
    try {
      original.start();
      await vi.advanceTimersByTimeAsync(0);
      await started.promise;
      const originalScope = h.scope.replayScope();
      expect(h.outbox.list()[0]?.status).toBe('SYNCING');
      original.stop();
      await h.switchUser('user-b');
      expect(h.scope.isReplayScopeCurrent(originalScope)).toBe(false);
      expect(h.outbox.list()).toEqual([]);
      await h.switchUser('user-a');
      await h.outbox.refresh('user-a');
      expect(h.outbox.list()[0]).toMatchObject({
        status: 'PENDING', idempotencyKey: 'stable-user-a-branch-a',
      });
      expect(h.scope.isReplayScopeCurrent(originalScope)).toBe(false);
      replacement = h.scheduler('user-a');
      replacement.start();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(h.completeSale).toHaveBeenCalledTimes(1);
      expect(activeRpcs).toBe(1);
      expect(h.outbox.list()[0]?.status).toBe('PENDING');

      if (settlement === 'resolve') finish.resolve('server-sale');
      else finish.reject(new Error('NETWORK_OR_UNKNOWN_RESULT'));
      await expect(h.replays[0]).resolves.toEqual({ synced: 0, conflicts: 0, failed: 0 });
      // The obsolete generation must not apply its result to the restored intent.
      expect(h.outbox.list()[0]?.status).toBe('PENDING');
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.all(h.replays);
      expect(h.completeSale).toHaveBeenCalledTimes(2);
      expect(maximumActiveRpcs).toBe(1);
      expect(h.completeSale.mock.calls).toEqual([
        [expect.objectContaining({ idempotencyKey: 'stable-user-a-branch-a' })],
        [expect.objectContaining({ idempotencyKey: 'stable-user-a-branch-a' })],
      ]);
      expect(h.outbox.list()[0]).toMatchObject({ status: 'SYNCED', serverId: 'server-sale' });
      await vi.advanceTimersByTimeAsync(300_000);
      expect(h.completeSale).toHaveBeenCalledTimes(2);
    } finally {
      original.stop();
      replacement?.stop();
      finish.resolve('server-sale');
      await Promise.allSettled(h.replays);
    }
    },
  );

  it('fences an account switch while inventory preparation is awaiting data', async () => {
    const h = await harness();
    await enqueue(h.outbox);
    const gate = deferred<[]>();
    h.loadInventoryBalances.mockImplementationOnce(() => gate.promise);
    h.scheduler('user-a').start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.loadInventoryBalances).toHaveBeenCalledTimes(1);
    await h.switchUser('user-b');
    await enqueue(h.outbox, 'user-b');
    gate.resolve([]);
    await Promise.all(h.replays);
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(h.outbox.list()[0]?.status).toBe('PENDING');
  });

  it('checks obsolescence again at submission after the asynchronous SYNCING commit', async () => {
    const h = await harness();
    await enqueue(h.outbox);
    const update = h.outbox.update.bind(h.outbox);
    vi.spyOn(h.outbox, 'update').mockImplementation(async (id, patch, owner) => {
      const result = await update(id, patch, owner);
      if (patch.status === 'SYNCING') await h.switchUser('user-b');
      return result;
    });
    await expect(h.replayPendingSales(h.outbox, { expectedOwnerId: 'user-a' }))
      .resolves.toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(await h.outbox.owner()).toBe('user-b');
  });

  it('leaves old-owner work unchanged when auth reports another account before its lifecycle event', async () => {
    const h = await harness();
    await enqueue(h.outbox);
    const original = h.outbox.list();
    h.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'user-b' }, expires_at: 1 } }, error: null,
    });
    await expect(h.replayPendingSales(h.outbox, { expectedOwnerId: 'user-a' }))
      .resolves.toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(h.refreshSession).not.toHaveBeenCalled();
    expect(h.completeSale).not.toHaveBeenCalled();
    expect(h.outbox.list()).toEqual(original);
  });

  it('preserves real same-user TOKEN_REFRESHED during asynchronous preparation', async () => {
    const h = await harness();
    await enqueue(h.outbox);
    const { startAuthLifecycle } = await import('../providers/authLifecycle');
    let emit!: (event: AuthChangeEvent, session: Session | null) => void;
    const session = { user: { id: 'user-a' }, access_token: 'new-token' } as Session;
    const commit = vi.fn();
    const lifecycle = startAuthLifecycle({
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (callback) => {
        emit = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    }, { bindUser: (userId) => h.scope.bindUser(userId), commit });
    observers.push(() => lifecycle.stop());
    await vi.advanceTimersByTimeAsync(0);
    const initiating = h.scope.replayScope();
    const gate = deferred<ReturnType<typeof h.session>>();
    h.getSession.mockImplementationOnce(() => gate.promise);
    h.scheduler('user-a').start();
    await vi.advanceTimersByTimeAsync(0);
    emit('TOKEN_REFRESHED', session);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.scope.replayScope()).toEqual(initiating);
    gate.resolve(h.session());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.completeSale).toHaveBeenCalledTimes(1);
    expect(h.outbox.list()[0]?.status).toBe('SYNCED');
  });

  it('refreshes POS history once on scheduled durable sale completion and clears pending count', async () => {
    const h = await harness();
    await enqueue(h.outbox);
    const { observeSyncedSales } = await import('./saleSyncObserver');
    const { deriveSyncStatus } = await import('./syncStatus');
    const { OutboxStore: Store } = await import('./outbox');
    const posOutbox = new Store();
    await posOutbox.ready();
    const refreshHistory = vi.fn(() => { void h.loadSales(); });
    observers.push(observeSyncedSales(posOutbox, 'user-a', 'org-a', 'branch-a', refreshHistory));
    await vi.advanceTimersByTimeAsync(0);
    expect(deriveSyncStatus('online', posOutbox.list()).pendingCount).toBe(1);
    expect(refreshHistory).not.toHaveBeenCalled();
    h.scheduler('user-a').start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.completeSale).toHaveBeenCalledTimes(1);
    expect(deriveSyncStatus('online', posOutbox.list()).pendingCount).toBe(0);
    expect(refreshHistory).toHaveBeenCalledTimes(1);
    expect(h.loadSales).toHaveBeenCalledTimes(1);
    // Further metadata changes and synced cleanup must not cause refresh loops.
    await h.outbox.update('sale-user-a-branch-a', { serverId: 'same-server' }, 'user-a');
    await h.outbox.removeSynced();
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshHistory).toHaveBeenCalledTimes(1);
  });

  it('ignores other branches and cancels obsolete POS observers', async () => {
    const h = await harness();
    const { observeSyncedSales } = await import('./saleSyncObserver');
    const refresh = vi.fn();
    const stop = observeSyncedSales(h.outbox, 'user-a', 'org-a', 'branch-a', refresh);
    observers.push(stop);
    await enqueue(h.outbox, 'user-a', 'branch-b');
    await h.outbox.update('sale-user-a-branch-b', { status: 'SYNCED' }, 'user-a');
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).not.toHaveBeenCalled();
    await h.switchUser('user-b');
    await enqueue(h.outbox, 'user-b');
    await h.outbox.update('sale-user-b-branch-a', { status: 'SYNCED' }, 'user-b');
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it('wires POS history to the observer and keeps replay exclusively in the app provider', () => {
    expect(posSource).toContain('observeSyncedSales(offlineStores.outbox, userId, organizationId, branchId');
    expect(posSource).toContain('isOnline, salesSyncRevision, t]');
    expect(posSource).not.toMatch(/replayPendingSales|SyncCoordinator|OutboxReplayScheduler/);
    expect(providerSource).toContain('expectedOwnerId: context.expectedOwnerId');
    expect(providerSource).toContain('canReplay: context.isCurrent');
  });
});
