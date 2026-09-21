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

async function seedScopedState(storage: KeyValueStorage) {
  new LocalStore(storage).set('core:customers:org-a', {
    data: [{ id: 'customer-a' }],
    syncedAt: '2026-08-23T18:00:00.000Z',
  });
  await new OutboxStore(storage).enqueue({
    id: 'sale-a',
    kind: 'SALE',
    organizationId: 'org-a',
    idempotencyKey: 'sale-key-a',
    payload: {},
    createdAt: '2026-08-23T18:01:00.000Z',
  });
}

describe('offline session scope', () => {
  it('clears cached replica data on sign-out while restoring unsynced intents for the same user', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    await scope.bindUser('user-a');
    await seedScopedState(storage);

    await scope.bindUser(null);
    await scope.bindUser(null);

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const signedOut = new OutboxStore(storage);
    await signedOut.ready();
    expect(signedOut.list()).toEqual([]);

    await scope.bindUser('user-a');
    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const restored = new OutboxStore(storage);
    await restored.ready();
    expect(restored.list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('isolates stale user and organization data while preserving the original user intent', async () => {
    const storage = memoryStorage();
    const firstSession = new OfflineSessionScope(storage);
    await firstSession.bindUser('user-a');
    await seedScopedState(storage);

    await new OfflineSessionScope(storage).bindUser('user-b');

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const userBOutbox = new OutboxStore(storage);
    await userBOutbox.ready();
    expect(userBOutbox.list()).toEqual([]);

    await new OfflineSessionScope(storage).bindUser('user-a');
    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const userAOutbox = new OutboxStore(storage);
    await userAOutbox.ready();
    expect(userAOutbox.list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('clears unowned legacy data on the first authenticated bind after upgrade', async () => {
    const storage = memoryStorage();
    await seedScopedState(storage);

    await new OfflineSessionScope(storage).bindUser('user-a');

    expect(new LocalStore(storage).get('core:customers:org-a')).toBeNull();
    const outbox = new OutboxStore(storage);
    await outbox.ready();
    expect(outbox.list()).toEqual([]);
  });

  it('preserves state when the same authenticated user is rebound after restart', async () => {
    const storage = memoryStorage();
    const firstSession = new OfflineSessionScope(storage);
    await firstSession.bindUser('user-a');
    await seedScopedState(storage);

    await new OfflineSessionScope(storage).bindUser('user-a');

    expect(new LocalStore(storage).get('core:customers:org-a')).not.toBeNull();
    const outbox = new OutboxStore(storage);
    await outbox.ready();
    expect(outbox.list()[0]?.idempotencyKey).toBe('sale-key-a');
  });

  it('preserves pending and conflicted intents through a user switch', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    await scope.bindUser('user-a');
    await seedScopedState(storage);
    const outbox = new OutboxStore(storage);
    await outbox.enqueue({
      id: 'sale-conflict',
      kind: 'SALE',
      organizationId: 'org-a',
      idempotencyKey: 'conflict-key-a',
      payload: {},
      createdAt: '2026-08-23T18:02:00.000Z',
    });
    await outbox.update('sale-conflict', { status: 'CONFLICT', lastErrorCode: 'INSUFFICIENT_STOCK' });

    await scope.bindUser('user-b');
    const userBOutbox = new OutboxStore(storage);
    await userBOutbox.ready();
    expect(userBOutbox.list()).toEqual([]);

    await scope.bindUser('user-a');
    const userAOutbox = new OutboxStore(storage);
    await userAOutbox.ready();
    expect(userAOutbox.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'PENDING', idempotencyKey: 'sale-key-a' }),
      expect.objectContaining({ status: 'CONFLICT', idempotencyKey: 'conflict-key-a' }),
    ]));
  });
});
