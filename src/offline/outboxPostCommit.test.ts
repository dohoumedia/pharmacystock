import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  OfflineStockReservationError,
  queueOfflineSaleForCheckout,
  type QueueOfflineSaleInput,
} from './offlinePos';
import { OutboxOwnerMismatchError, OutboxStore, type OutboxOperation } from './outbox';
import { OfflineSessionScope } from './sessionScope';
import type { KeyValueStorage } from './storage';

const OUTBOX_STATE_KEY = 'pharmacystock:outbox:v2:key-value-state';

type ControlledStorage = KeyValueStorage & {
  failOperationWrite: boolean;
  failReadAfterOperationWrite: boolean;
  values: Map<string, string>;
};

function controlledStorage(): ControlledStorage {
  const values = new Map<string, string>();
  let failNextStateRead = false;
  return {
    values,
    failOperationWrite: false,
    failReadAfterOperationWrite: false,
    getItem(key) {
      if (key === OUTBOX_STATE_KEY && failNextStateRead) {
        failNextStateRead = false;
        throw new Error('simulated post-commit refresh failure');
      }
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      const writesOperation = key === OUTBOX_STATE_KEY
        && (JSON.parse(value) as { operations?: unknown[] }).operations?.length;
      if (writesOperation && this.failOperationWrite) {
        throw new Error('simulated pre-commit persistence failure');
      }
      values.set(key, value);
      if (writesOperation && this.failReadAfterOperationWrite) {
        this.failReadAfterOperationWrite = false;
        failNextStateRead = true;
      }
    },
    removeItem: (key) => values.delete(key),
  };
}

function operation(
  id = 'sale-a',
  idempotencyKey = 'sale:branch:stable-a',
): Omit<OutboxOperation, 'status' | 'attemptCount'> {
  return {
    id,
    kind: 'SALE',
    organizationId: 'org',
    branchId: 'branch',
    idempotencyKey,
    payload: { saleNumber: 'SALE-A' },
    createdAt: '2026-09-28T12:00:00.000Z',
  };
}

function saleInput(outbox: OutboxStore): QueueOfflineSaleInput {
  return {
    outbox,
    userId: 'user-a',
    organizationId: 'org',
    branchId: 'branch',
    saleNumber: 'SALE-A',
    lines: [{ product_id: 'product-a', quantity: 1 }],
    payments: [{ method: 'CASH', amount: 1000 }],
    idempotencyKey: 'sale:branch:stable-a',
    quote: {
      total_amount: 1000,
      items: [{
        product_id: 'product-a',
        batch_id: 'batch-a',
        quantity: 1,
        unit_price: 1000,
        line_total: 1000,
        expiry_date: '2027-01-01',
      }],
    },
    quoteSyncedAt: '2026-09-28T11:59:00.000Z',
    trustedAvailableByProduct: { 'product-a': 1 },
    requireCrossContextAtomicity: false,
    createdAt: '2026-09-28T12:00:00.000Z',
  };
}

describe('outbox post-commit durability boundary', () => {
  it('reports durable enqueue success when the post-commit refresh fails', async () => {
    const storage = controlledStorage();
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    await outbox.ready();
    storage.failReadAfterOperationWrite = true;
    let cartClearCount = 0;

    await expect(queueOfflineSaleForCheckout(saleInput(outbox), () => {
      cartClearCount += 1;
    })).resolves.toMatchObject({ idempotencyKey: 'sale:branch:stable-a' });

    expect(cartClearCount).toBe(1);
    const reconstructed = new OutboxStore(storage);
    await reconstructed.ready();
    expect(reconstructed.list()).toEqual([
      expect.objectContaining({ idempotencyKey: 'sale:branch:stable-a', status: 'PENDING' }),
    ]);
  });

  it('reports durable enqueue success when a notification listener throws', async () => {
    const storage = controlledStorage();
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    let successfulNotifications = 0;
    const unsubscribeThrowing = outbox.subscribe(() => { throw new Error('simulated listener failure'); });
    const unsubscribeHealthy = outbox.subscribe(() => { successfulNotifications += 1; });

    try {
      await expect(outbox.enqueue(operation(), 'user-a')).resolves.toMatchObject({ id: 'sale-a' });
      expect(outbox.list()).toEqual([expect.objectContaining({ id: 'sale-a', status: 'PENDING' })]);
      expect(successfulNotifications).toBe(1);
    } finally {
      unsubscribeThrowing();
      unsubscribeHealthy();
    }
  });

  it('still rejects a persistence failure before commit', async () => {
    const storage = controlledStorage();
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    await outbox.ready();
    storage.failOperationWrite = true;

    await expect(outbox.enqueue(operation(), 'user-a')).rejects.toThrow('simulated pre-commit persistence failure');
    storage.failOperationWrite = false;
    const reconstructed = new OutboxStore(storage);
    await reconstructed.ready();
    expect(reconstructed.list()).toEqual([]);
  });

  it('still rejects an owner mismatch before commit', async () => {
    const storage = controlledStorage();
    await new OfflineSessionScope(storage).bindUser('user-b');
    const outbox = new OutboxStore(storage);

    await expect(outbox.enqueue(operation(), 'user-a')).rejects.toBeInstanceOf(OutboxOwnerMismatchError);
    expect(outbox.list()).toEqual([]);
  });

  it('still rejects reservation validation before commit', async () => {
    const storage = controlledStorage();
    const indexedDB = new IDBFactory();
    const options = { indexedDB, databaseName: 'post-commit-reservation-rejection' };
    await new OfflineSessionScope(storage, options).bindUser('user-a');
    const outbox = new OutboxStore(storage, options);

    await expect(queueOfflineSaleForCheckout({
      ...saleInput(outbox),
      trustedAvailableByProduct: { 'product-a': 0 },
      requireCrossContextAtomicity: true,
    }, () => undefined)).rejects.toBeInstanceOf(OfflineStockReservationError);

    const reconstructed = new OutboxStore(storage, options);
    await reconstructed.refresh('user-a');
    expect(reconstructed.list()).toEqual([]);
  });

  it('keeps an exact retry idempotent after durable enqueue', async () => {
    const storage = controlledStorage();
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    const input = saleInput(outbox);

    const first = await queueOfflineSaleForCheckout(input, () => undefined);
    const retry = await queueOfflineSaleForCheckout(input, () => undefined);

    expect(retry.id).toBe(first.id);
    expect(outbox.list()).toHaveLength(1);
  });
});
