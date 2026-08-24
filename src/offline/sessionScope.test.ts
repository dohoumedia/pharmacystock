import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import { OutboxStore } from './outbox';
import { OfflineSessionScope } from './sessionScope';
import type { KeyValueStorage } from './storage';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function seedScopedState(storage: KeyValueStorage) {
  new LocalStore(storage).set('core:customers:org-a', {
    data: [{ id: 'customer-a' }],
    syncedAt: '2026-08-23T18:00:00.000Z',
  });
  new OutboxStore(storage).enqueue({
    id: 'sale-a',
    kind: 'SALE',
    organizationId: 'org-a',
    idempotencyKey: 'sale-key-a',
    payload: {},
    createdAt: '2026-08-23T18:01:00.000Z',
  });
}

describe('offline session scope', () => {
  it('clears cached replica data on sign-out while restoring unsynced intents for the same user', () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    scope.bindUser('user-a');
    seedScopedState(storage);

    scope.bindUser(null);
    scope.bindUser(null);

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    expect(new OutboxStore(storage).list()).toEqual([]);

    scope.bindUser('user-a');
    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    expect(new OutboxStore(storage).list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('isolates stale user and organization data while preserving the original user intent', () => {
    const storage = memoryStorage();
    const firstSession = new OfflineSessionScope(storage);
    firstSession.bindUser('user-a');
    seedScopedState(storage);

    new OfflineSessionScope(storage).bindUser('user-b');

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    expect(new OutboxStore(storage).list()).toEqual([]);

    new OfflineSessionScope(storage).bindUser('user-a');
    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    expect(new OutboxStore(storage).list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('clears unowned legacy data on the first authenticated bind after upgrade', () => {
    const storage = memoryStorage();
    seedScopedState(storage);

    new OfflineSessionScope(storage).bindUser('user-a');

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    expect(new OutboxStore(storage).list()).toEqual([]);
  });

  it('preserves state when the same authenticated user is rebound after restart', () => {
    const storage = memoryStorage();
    const firstSession = new OfflineSessionScope(storage);
    firstSession.bindUser('user-a');
    seedScopedState(storage);

    new OfflineSessionScope(storage).bindUser('user-a');

    expect(new LocalStore(storage).get('core:customers:org-a')).not.toBeNull();
    expect(new OutboxStore(storage).list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('preserves pending and conflicted intents through a user switch', () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    scope.bindUser('user-a');
    seedScopedState(storage);
    const outbox = new OutboxStore(storage);
    outbox.enqueue({
      id: 'sale-conflict',
      kind: 'SALE',
      organizationId: 'org-a',
      idempotencyKey: 'conflict-key-a',
      payload: {},
      createdAt: '2026-08-23T18:02:00.000Z',
    });
    outbox.update('sale-conflict', { status: 'CONFLICT', lastErrorCode: 'INSUFFICIENT_STOCK' });

    scope.bindUser('user-b');
    expect(new OutboxStore(storage).list()).toEqual([]);

    scope.bindUser('user-a');
    expect(new OutboxStore(storage).list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'PENDING', idempotencyKey: 'sale-key-a' }),
      expect.objectContaining({ status: 'CONFLICT', idempotencyKey: 'conflict-key-a' }),
    ]));
  });
});
