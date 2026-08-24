import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { LocalStore } from '../offline/localStore';
import { OutboxStore } from '../offline/outbox';
import { OfflineSessionScope } from '../offline/sessionScope';
import type { KeyValueStorage } from '../offline/storage';
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

  it('keeps restoration pending after a transient getSession failure', async () => {
    const auth = fakeAuth(Promise.resolve({ data: { session: null }, error: new Error('temporary') }));
    const commit = vi.fn();
    const bindUser = vi.fn();
    startAuthLifecycle(auth.client, { commit, bindUser });
    auth.emit('INITIAL_SESSION', null);
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(bindUser).not.toHaveBeenCalled();
    auth.emit('SIGNED_IN', session('user-a'));
    expect(commit).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it('prevents stale-user cache or pending-intent replay after sign-out and user switch', () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    const localStore = new LocalStore(storage);
    const outbox = new OutboxStore(storage);
    scope.bindUser('user-a');
    localStore.set('private:user-a', { data: ['secret-a'], syncedAt: '2026-08-24T12:00:00.000Z' });
    outbox.enqueue({ id: 'intent-a', kind: 'SALE', organizationId: 'org-a', idempotencyKey: 'intent-a', payload: {}, createdAt: '2026-08-24T12:00:00.000Z' });

    const auth = fakeAuth(Promise.resolve({ data: { session: session('user-a') }, error: null }));
    startAuthLifecycle(auth.client, { commit: vi.fn(), bindUser: (userId) => scope.bindUser(userId) });
    auth.emit('SIGNED_OUT', null);
    auth.emit('SIGNED_IN', session('user-b'));

    expect(localStore.get('private:user-a')).toBeNull();
    expect(outbox.list()).toEqual([]);
    expect(scope.replayScope().userId).toBe('user-b');
  });
});
