import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import { OutboxStore } from './outbox';
import { cachePosStockSnapshot, getOfflineAvailableQuantity, validateOfflineCartAgainstSnapshot } from './offlinePosCatalog';
import { queueOfflineSale } from './offlinePos';
import { OfflineSessionScope } from './sessionScope';
import { SyncCoordinator } from './sync';
import type { KeyValueStorage } from './storage';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function quote(quantity = 1) {
  return {
    total_amount: 1250 * quantity,
    items: [{
      product_id: 'product-a',
      batch_id: 'batch-a',
      quantity,
      unit_price: 1250,
      line_total: 1250 * quantity,
      expiry_date: '2027-01-01',
    }],
  };
}

describe('offline recovery scenarios', () => {
  it('queues an offline POS sale once and immediately reserves it against the cached stock snapshot', () => {
    const storage = memoryStorage();
    const localStore = new LocalStore(storage);
    const outbox = new OutboxStore(storage);

    cachePosStockSnapshot(localStore, 'org-a', 'branch-a', [{
      batch_id: 'batch-a',
      product_id: 'product-a',
      on_hand_quantity: 5,
      reserved_quantity: 0,
      available_quantity: 5,
    }], '2026-09-20T12:00:00.000Z');

    const input = {
      outbox,
      organizationId: 'org-a',
      branchId: 'branch-a',
      saleNumber: 'OFFLINE-001',
      lines: [{ product_id: 'product-a', quantity: 2 }],
      payments: [{ method: 'CASH' as const, amount: 2500 }],
      idempotencyKey: 'sale:branch-a:offline-001',
      quote: quote(2),
      quoteSyncedAt: '2026-09-20T12:00:00.000Z',
      createdAt: '2026-09-20T12:01:00.000Z',
    };

    queueOfflineSale(input);
    queueOfflineSale(input);

    expect(outbox.list()).toHaveLength(1);
    expect(outbox.list()[0]).toMatchObject({
      status: 'PENDING',
      idempotencyKey: 'sale:branch-a:offline-001',
    });
    expect(getOfflineAvailableQuantity({
      store: localStore,
      outbox,
      organizationId: 'org-a',
      branchId: 'branch-a',
      productId: 'product-a',
    })).toBe(3);
    expect(validateOfflineCartAgainstSnapshot({
      store: localStore,
      outbox,
      organizationId: 'org-a',
      branchId: 'branch-a',
      lines: [{ product_id: 'product-a', quantity: 4 }],
    })).toMatchObject({
      ok: false,
      reason: 'LOCAL_INSUFFICIENT_STOCK',
      available: 3,
    });
  });

  it('replays after reconnect with the exact original idempotency key', async () => {
    const outbox = new OutboxStore(memoryStorage());
    outbox.enqueue({
      id: 'sale-1',
      kind: 'SALE',
      organizationId: 'org-a',
      branchId: 'branch-a',
      idempotencyKey: 'stable-offline-key',
      payload: {},
      createdAt: '2026-09-20T12:01:00.000Z',
    });

    const events: string[] = [];
    const coordinator = new SyncCoordinator(outbox, {
      SALE: async (operation) => {
        events.push(`submit:${operation.idempotencyKey}`);
        return { status: 'SYNCED', serverId: 'server-sale-1' };
      },
    }, {
      beforeReplay: async () => {
        events.push('refresh-session');
        events.push('pull-current-stock');
      },
    });

    const result = await coordinator.replayPending();

    expect(events).toEqual([
      'refresh-session',
      'pull-current-stock',
      'submit:stable-offline-key',
    ]);
    expect(result).toEqual({ synced: 1, conflicts: 0, failed: 0 });
    expect(outbox.list()[0]).toMatchObject({
      status: 'SYNCED',
      idempotencyKey: 'stable-offline-key',
      serverId: 'server-sale-1',
    });
  });

  it('turns a stock or eligibility change before sync into a terminal conflict without changing the key', async () => {
    const outbox = new OutboxStore(memoryStorage());
    outbox.enqueue({
      id: 'sale-1',
      kind: 'SALE',
      organizationId: 'org-a',
      branchId: 'branch-a',
      idempotencyKey: 'stable-conflict-key',
      payload: {},
      createdAt: '2026-09-20T12:01:00.000Z',
    });

    const coordinator = new SyncCoordinator(outbox, {
      SALE: async () => ({ status: 'CONFLICT', errorCode: 'RECALLED' }),
    });

    const first = await coordinator.replayPending();
    const second = await coordinator.replayPending();

    expect(first).toEqual({ synced: 0, conflicts: 1, failed: 0 });
    expect(second).toEqual({ synced: 0, conflicts: 0, failed: 0 });
    expect(outbox.list()[0]).toMatchObject({
      status: 'CONFLICT',
      idempotencyKey: 'stable-conflict-key',
      attemptCount: 1,
      lastErrorCode: 'RECALLED',
    });
    expect(outbox.pending()).toHaveLength(0);
  });

  it('stops replay when the signed-in user changes and restores only the original user intent later', async () => {
    const storage = memoryStorage();
    const scope = new OfflineSessionScope(storage);
    scope.bindUser('user-a');
    const replayScope = scope.replayScope();
    const outbox = new OutboxStore(storage);

    outbox.enqueue({
      id: 'sale-1',
      kind: 'SALE',
      organizationId: 'org-a',
      branchId: 'branch-a',
      idempotencyKey: 'user-a-key-1',
      payload: {},
      createdAt: '2026-09-20T12:01:00.000Z',
    });
    outbox.enqueue({
      id: 'sale-2',
      kind: 'SALE',
      organizationId: 'org-a',
      branchId: 'branch-a',
      idempotencyKey: 'user-a-key-2',
      payload: {},
      createdAt: '2026-09-20T12:02:00.000Z',
    });

    let firstStartedResolve: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { firstStartedResolve = resolve; });
    let releaseFirstResolve: (() => void) | undefined;
    const releaseFirst = new Promise<void>((resolve) => { releaseFirstResolve = resolve; });
    const seen: string[] = [];

    const coordinator = new SyncCoordinator(outbox, {
      SALE: async (operation) => {
        seen.push(operation.idempotencyKey);
        firstStartedResolve?.();
        await releaseFirst;
        return { status: 'SYNCED' };
      },
    }, {
      canReplay: () => scope.isReplayScopeCurrent(replayScope),
    });

    const replay = coordinator.replayPending();
    await firstStarted;

    scope.bindUser('user-b');
    releaseFirstResolve?.();
    await replay;

    expect(seen).toEqual(['user-a-key-1']);
    expect(new OutboxStore(storage).list()).toEqual([]);

    scope.bindUser('user-a');
    expect(new OutboxStore(storage).list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'sale-1',
        status: 'SYNCING',
        idempotencyKey: 'user-a-key-1',
      }),
      expect.objectContaining({
        id: 'sale-2',
        status: 'PENDING',
        idempotencyKey: 'user-a-key-2',
      }),
    ]));
  });
});
