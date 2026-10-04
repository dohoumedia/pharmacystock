import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { LocalStore } from '../offline/localStore';
import { OutboxStore } from '../offline/outbox';
import { OfflineSessionScope } from '../offline/sessionScope';
import type { KeyValueStorage } from '../offline/storage';
import { SyncCoordinator } from '../offline/sync';
import { OutboxReplayScheduler } from '../offline/replayScheduler';
import { startAuthLifecycle, type AuthLifecycleClient } from './authLifecycle';

function session(userId: string, accessToken = 'access-1'): Session {
  return { user: { id: userId }, access_token: accessToken } as Session;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function fakeAuth(initial: Promise<{ data: { session: Session | null }; error: unknown }>) {
  let callback: ((event: AuthChangeEvent, nextSession: Session | null) => void) | null = null;
  const client: AuthLifecycleClient = {
    getSession: () => initial,
    onAuthStateChange: (next) => {
      callback = next;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  };
  return {
    client,
    emit: (event: AuthChangeEvent, nextSession: Session | null) => callback?.(event, nextSession),
  };
}

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('authenticated session lifecycle', () => {
  it('does not cancel reconnect replay when Supabase refreshes the same user token', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    const outbox = new OutboxStore(storage);
    await scope.bindUser('user-a');
    await outbox.enqueue({
      id: 'sale-a',
      kind: 'SALE',
      organizationId: 'org-a',
      idempotencyKey: 'stable-sale-key',
      payload: {},
      createdAt: '2026-09-29T12:00:00.000Z',
    }, 'user-a');

    const auth = fakeAuth(Promise.resolve({ data: { session: session('user-a') }, error: null }));
    const commit = vi.fn();
    const lifecycle = startAuthLifecycle(auth.client, {
      commit,
      bindUser: (userId) => scope.bindUser(userId),
    });
    await vi.waitFor(() => expect(commit).toHaveBeenCalled());

    const replayScope = scope.replayScope();
    const submit = vi.fn(async () => ({ status: 'SYNCED' as const, serverId: 'server-sale-a' }));
    const coordinator = new SyncCoordinator(outbox, { SALE: submit }, {
      expectedOwnerId: 'user-a',
      canReplay: () => scope.isReplayScopeCurrent(replayScope),
      beforeReplay: async () => {
        auth.emit('TOKEN_REFRESHED', session('user-a', 'access-2'));
        await vi.waitFor(() => expect(commit).toHaveBeenLastCalledWith(
          expect.objectContaining({ access_token: 'access-2' }),
          false,
        ));
        auth.emit('TOKEN_REFRESHED', session('user-a', 'access-3'));
        await vi.waitFor(() => expect(commit).toHaveBeenLastCalledWith(
          expect.objectContaining({ access_token: 'access-3' }),
          false,
        ));
        expect(scope.replayScope()).toEqual(replayScope);
      },
    });

    await expect(coordinator.replayPending()).resolves.toEqual({ synced: 1, conflicts: 0, failed: 0 });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'stable-sale-key' }));
    lifecycle.stop();
  });

  it('preserves a scheduled stale replay across same-user TOKEN_REFRESHED events', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    const outbox = new OutboxStore(storage);
    await scope.bindUser('user-a');
    await outbox.enqueue({
      id: 'scheduled-sale-a',
      kind: 'SALE',
      organizationId: 'org-a',
      idempotencyKey: 'scheduled-stable-sale-key',
      payload: {},
      createdAt: '2026-09-29T11:55:00.000Z',
    }, 'user-a');
    await outbox.update('scheduled-sale-a', {
      status: 'SYNCING',
      attemptCount: 1,
      lastAttemptAt: '2026-09-29T12:00:00.000Z',
    }, 'user-a');

    const auth = fakeAuth(Promise.resolve({ data: { session: session('user-a') }, error: null }));
    const commit = vi.fn();
    const lifecycle = startAuthLifecycle(auth.client, {
      commit,
      bindUser: (userId) => scope.bindUser(userId),
    });
    await vi.waitFor(() => expect(commit).toHaveBeenCalled());

    vi.useFakeTimers();
    let scheduler: OutboxReplayScheduler | null = null;
    try {
      vi.setSystemTime(new Date('2026-09-29T12:01:00.000Z'));
      const replayScope = scope.replayScope();
      const submit = vi.fn(async () => ({ status: 'SYNCED' as const }));
      const coordinator = new SyncCoordinator(outbox, { SALE: submit }, {
        expectedOwnerId: 'user-a',
        canReplay: () => scope.isReplayScopeCurrent(replayScope),
      });
      scheduler = new OutboxReplayScheduler(outbox, () => coordinator.replayPending(), {
        expectedOwnerId: 'user-a',
      });
      scheduler.start();
      await vi.advanceTimersByTimeAsync(0);

      auth.emit('TOKEN_REFRESHED', session('user-a', 'access-2'));
      await vi.advanceTimersByTimeAsync(0);
      expect(scope.replayScope()).toEqual(replayScope);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({
        idempotencyKey: 'scheduled-stable-sale-key',
      }));
    } finally {
      scheduler?.stop();
      lifecycle.stop();
      vi.useRealTimers();
    }
  });

  it('invalidates stale replay immediately on a real user switch without exposing the previous user outbox', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    const outbox = new OutboxStore(storage);
    await scope.bindUser('user-a');
    await outbox.enqueue({
      id: 'intent-a',
      kind: 'SALE',
      organizationId: 'org-a',
      idempotencyKey: 'intent-a',
      payload: {},
      createdAt: '2026-09-29T12:00:00.000Z',
    }, 'user-a');

    const auth = fakeAuth(Promise.resolve({ data: { session: session('user-a') }, error: null }));
    const lifecycle = startAuthLifecycle(auth.client, {
      commit: vi.fn(),
      bindUser: (userId) => scope.bindUser(userId),
    });
    await vi.waitFor(() => expect(scope.replayScope().userId).toBe('user-a'));
    const staleReplay = scope.replayScope();

    auth.emit('SIGNED_IN', session('user-b'));
    expect(scope.isReplayScopeCurrent(staleReplay)).toBe(false);
    await vi.waitFor(async () => {
      await outbox.refresh('user-b');
      expect(outbox.list()).toEqual([]);
      expect(scope.replayScope().userId).toBe('user-b');
    });

    lifecycle.stop();
  });

  it('invalidates replay immediately on logout and leaves no active operations', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    const outbox = new OutboxStore(storage);
    await scope.bindUser('user-a');
    await outbox.enqueue({
      id: 'intent-a',
      kind: 'SALE',
      organizationId: 'org-a',
      idempotencyKey: 'intent-a',
      payload: {},
      createdAt: '2026-09-29T12:00:00.000Z',
    }, 'user-a');

    const auth = fakeAuth(Promise.resolve({ data: { session: session('user-a') }, error: null }));
    const lifecycle = startAuthLifecycle(auth.client, {
      commit: vi.fn(),
      bindUser: (userId) => scope.bindUser(userId),
    });
    await vi.waitFor(() => expect(scope.replayScope().userId).toBe('user-a'));
    const staleReplay = scope.replayScope();

    auth.emit('SIGNED_OUT', null);
    expect(scope.isReplayScopeCurrent(staleReplay)).toBe(false);
    await vi.waitFor(async () => {
      await outbox.refresh();
      expect(await outbox.owner()).toBeNull();
      expect(outbox.list()).toEqual([]);
    });

    lifecycle.stop();
  });

  it('keeps sign-in through route changes, refresh, reload, sign-out, and sign-in again', async () => {
    const commits: { userId: string | null; loading: boolean; token?: string }[] = [];
    const bindUser = vi.fn();
    const firstAuth = fakeAuth(Promise.resolve({ data: { session: null }, error: null }));
    const first = startAuthLifecycle(firstAuth.client, {
      bindUser,
      commit: (value, loading) => commits.push({ userId: value?.user.id ?? null, loading, token: value?.access_token }),
    });

    firstAuth.emit('SIGNED_IN', session('user-a'));
    for (const route of ['/inventory', '/batches', '/purchasing', '/reports', '/inventory']) {
      expect(commits.at(-1)?.userId, route).toBe('user-a');
    }
    firstAuth.emit('TOKEN_REFRESHED', session('user-a', 'access-2'));
    expect(commits.at(-1)).toMatchObject({ userId: 'user-a', token: 'access-2', loading: false });
    first.stop();

    const reloadAuth = fakeAuth(Promise.resolve({ data: { session: session('user-a', 'access-2') }, error: null }));
    const reloaded = startAuthLifecycle(reloadAuth.client, {
      bindUser,
      commit: (value, loading) => commits.push({ userId: value?.user.id ?? null, loading, token: value?.access_token }),
    });
    await Promise.resolve();
    expect(commits.at(-1)?.userId).toBe('user-a');

    reloadAuth.emit('SIGNED_OUT', null);
    expect(commits.at(-1)?.userId).toBeNull();
    reloaded.acceptSession(session('user-a', 'access-3'));
    expect(commits.at(-1)).toMatchObject({ userId: 'user-a', token: 'access-3' });
    expect(bindUser).toHaveBeenCalledWith(null);
  });

  it('does not turn a temporary null initialization or refresh state into sign-out', async () => {
    const restoration = deferred<{ data: { session: Session | null }; error: unknown }>();
    const auth = fakeAuth(restoration.promise);
    const commit = vi.fn();
    const bindUser = vi.fn();
    startAuthLifecycle(auth.client, { commit, bindUser });

    auth.emit('INITIAL_SESSION', null);
    auth.emit('TOKEN_REFRESHED', null);
    expect(commit).not.toHaveBeenCalled();
    expect(bindUser).not.toHaveBeenCalled();

    restoration.resolve({ data: { session: session('user-a') }, error: null });
    await restoration.promise;
    await Promise.resolve();
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'user-a' }) }), false);
    expect(bindUser).toHaveBeenLastCalledWith('user-a');
  });

  it('ends loading after a transient getSession failure without treating it as sign-out', async () => {
    vi.useFakeTimers();
    const auth = fakeAuth(Promise.resolve({ data: { session: null }, error: new Error('temporary') }));
    const commit = vi.fn();
    const bindUser = vi.fn();
    const lifecycle = startAuthLifecycle(auth.client, { commit, bindUser }, 2_000);
    auth.emit('INITIAL_SESSION', null);
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(bindUser).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(commit).toHaveBeenLastCalledWith(null, false);
    expect(bindUser).not.toHaveBeenCalled();

    auth.emit('SIGNED_IN', session('user-a'));
    expect(commit).toHaveBeenLastCalledWith(expect.anything(), false);
    lifecycle.stop();
    vi.useRealTimers();
  });

  it('does not remain loading when persisted-session resolution never completes', async () => {
    vi.useFakeTimers();
    const restoration = deferred<{ data: { session: Session | null }; error: unknown }>();
    const auth = fakeAuth(restoration.promise);
    const commit = vi.fn();
    const bindUser = vi.fn();
    const lifecycle = startAuthLifecycle(auth.client, { commit, bindUser }, 2_000);

    auth.emit('INITIAL_SESSION', null);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(commit).toHaveBeenLastCalledWith(null, false);
    expect(bindUser).not.toHaveBeenCalled();
    lifecycle.stop();
    vi.useRealTimers();
  });

  it('prevents stale-user cache or pending-intent replay after sign-out and user switch', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    const localStore = new LocalStore(storage);
    const outbox = new OutboxStore(storage);
    await scope.bindUser('user-a');
    localStore.set('private:user-a', { data: ['secret-a'], syncedAt: '2026-08-24T12:00:00.000Z' });
    await outbox.enqueue({ id: 'intent-a', kind: 'SALE', organizationId: 'org-a', idempotencyKey: 'intent-a', payload: {}, createdAt: '2026-08-24T12:00:00.000Z' });

    const auth = fakeAuth(Promise.resolve({ data: { session: session('user-a') }, error: null }));
    startAuthLifecycle(auth.client, { commit: vi.fn(), bindUser: (userId) => scope.bindUser(userId) });
    auth.emit('SIGNED_OUT', null);
    auth.emit('SIGNED_IN', session('user-b'));

    await vi.waitFor(() => {
      expect(localStore.get('private:user-a')).toBeNull();
      expect(outbox.list()).toEqual([]);
      expect(scope.replayScope().userId).toBe('user-b');
    });
  });
});
