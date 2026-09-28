import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import {
  OfflineStockReservationError,
  pendingSaleReservations,
  queueOfflineSaleForCheckout,
  type OfflineSalePayload,
} from './offlinePos';
import { cachePosStockSnapshot, validateOfflineCartAgainstSnapshot } from './offlinePosCatalog';
import {
  OutboxAtomicCoordinationUnavailableError,
  OutboxOwnerMismatchError,
  OutboxStore,
} from './outbox';
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

const balance = {
  organization_id: 'org',
  branch_id: 'branch',
  batch_id: 'batch-product-a',
  product_id: 'product-a',
  on_hand_quantity: 1,
  reserved_quantity: 0,
  available_quantity: 1,
  last_movement_at: '2026-09-27T12:00:00.000Z',
  product_name: 'Product A',
  lot_number: 'LOT-A',
  expiry_date: '2027-01-01',
  batch_status: 'ACTIVE',
};

describe('offline POS cross-tab provisional reservations', () => {
  it('allows only one tab to reserve the final trusted cached unit', async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'offline-pos-last-unit-race';
    const options = { indexedDB, databaseName };
    await new OfflineSessionScope(storage, options).bindUser('user-a');

    const localStore = new LocalStore(storage);
    cachePosStockSnapshot(localStore, 'org', 'branch', [balance]);
    const firstTab = new OutboxStore(storage, options);
    const secondTab = new OutboxStore(storage, options);
    await Promise.all([firstTab.ready(), secondTab.ready()]);

    let validatedTabs = 0;
    let releaseBoth!: () => void;
    const bothValidated = new Promise<void>((resolve) => { releaseBoth = resolve; });
    const submit = async (outbox: OutboxStore, suffix: string) => {
      await outbox.refresh('user-a');
      expect(validateOfflineCartAgainstSnapshot({
        store: localStore,
        outbox,
        organizationId: 'org',
        branchId: 'branch',
        lines: [{ product_id: 'product-a', quantity: 1 }],
      })).toEqual({ ok: true });
      validatedTabs += 1;
      if (validatedTabs === 2) releaseBoth();
      await bothValidated;

      return queueOfflineSaleForCheckout({
        outbox,
        userId: 'user-a',
        organizationId: 'org',
        branchId: 'branch',
        saleNumber: `SALE-${suffix}`,
        lines: [{ product_id: 'product-a', quantity: 1 }],
        payments: [{ method: 'CASH', amount: 1000 }],
        idempotencyKey: `sale:branch:${suffix}`,
        quote: {
          total_amount: 1000,
          items: [{
            product_id: 'product-a',
            batch_id: 'batch-product-a',
            quantity: 1,
            unit_price: 1000,
            line_total: 1000,
            expiry_date: '2027-01-01',
          }],
        },
        quoteSyncedAt: '2026-09-27T12:00:00.000Z',
        trustedAvailableByProduct: { 'product-a': 1 },
        requireCrossContextAtomicity: true,
      }, () => undefined);
    };

    const results = await Promise.allSettled([
      submit(firstTab, 'one'),
      submit(secondTab, 'two'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ reason: 'LOCAL_INSUFFICIENT_STOCK', available: 0 }),
    });
    if (rejected?.status === 'rejected') expect(rejected.reason).toBeInstanceOf(OfflineStockReservationError);

    const verifier = new OutboxStore(storage, options);
    await verifier.refresh('user-a');
    expect(verifier.list()).toHaveLength(1);
    expect(pendingSaleReservations(verifier, 'org', 'branch').get('product-a')).toBe(1);

    const winningOperation = verifier.list()[0]!;
    const winningPayload = winningOperation.payload as OfflineSalePayload;
    let durableCallbackCount = 0;
    const exactRetry = await queueOfflineSaleForCheckout({
      outbox: new OutboxStore(storage, options),
      userId: 'user-a',
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: winningPayload.saleNumber,
      lines: winningPayload.lines,
      payments: winningPayload.payments,
      idempotencyKey: winningOperation.idempotencyKey,
      customerId: winningPayload.customerId,
      notes: winningPayload.notes,
      quote: {
        total_amount: winningPayload.quotedTotal,
        items: [{
          product_id: 'product-a',
          batch_id: 'batch-product-a',
          quantity: 1,
          unit_price: 1000,
          line_total: 1000,
          expiry_date: '2027-01-01',
        }],
      },
      quoteSyncedAt: winningPayload.quoteSyncedAt,
      trustedAvailableByProduct: null,
      requireCrossContextAtomicity: true,
    }, () => { durableCallbackCount += 1; });

    expect(exactRetry.id).toBe(winningOperation.id);
    expect(durableCallbackCount).toBe(1);
    await verifier.refresh('user-a');
    expect(verifier.list()).toHaveLength(1);
    expect(pendingSaleReservations(verifier, 'org', 'branch').get('product-a')).toBe(1);
  });

  it('fails without writing when cross-context atomicity is unavailable', async () => {
    const storage = memoryStorage();
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);

    await expect(queueOfflineSaleForCheckout({
      outbox,
      userId: 'user-a',
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: 'SALE-NO-COORDINATION',
      lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ method: 'CASH', amount: 1000 }],
      idempotencyKey: 'sale:branch:no-coordination',
      quote: {
        total_amount: 1000,
        items: [{
          product_id: 'product-a',
          batch_id: 'batch-product-a',
          quantity: 1,
          unit_price: 1000,
          line_total: 1000,
          expiry_date: '2027-01-01',
        }],
      },
      quoteSyncedAt: '2026-09-27T12:00:00.000Z',
      trustedAvailableByProduct: { 'product-a': 1 },
      requireCrossContextAtomicity: true,
    }, () => undefined)).rejects.toBeInstanceOf(OutboxAtomicCoordinationUnavailableError);

    expect(outbox.list()).toEqual([]);
  });

  it('keeps guarded enqueue bound to the authenticated outbox owner', async () => {
    const indexedDB = new IDBFactory();
    const storage = memoryStorage();
    const databaseName = 'offline-pos-owner-boundary';
    const options = { indexedDB, databaseName };
    const session = new OfflineSessionScope(storage, options);
    await session.bindUser('user-a');
    const staleUserATab = new OutboxStore(storage, options);
    await staleUserATab.ready();
    await session.bindUser('user-b');

    await expect(queueOfflineSaleForCheckout({
      outbox: staleUserATab,
      userId: 'user-a',
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: 'SALE-STALE-A',
      lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ method: 'CASH', amount: 1000 }],
      idempotencyKey: 'sale:branch:stale-a',
      quote: {
        total_amount: 1000,
        items: [{
          product_id: 'product-a',
          batch_id: 'batch-product-a',
          quantity: 1,
          unit_price: 1000,
          line_total: 1000,
          expiry_date: '2027-01-01',
        }],
      },
      quoteSyncedAt: '2026-09-27T12:00:00.000Z',
      trustedAvailableByProduct: { 'product-a': 1 },
      requireCrossContextAtomicity: true,
    }, () => undefined)).rejects.toBeInstanceOf(OutboxOwnerMismatchError);

    const userB = new OutboxStore(storage, options);
    await userB.refresh('user-b');
    expect(userB.list()).toEqual([]);
    await session.bindUser('user-a');
    const userA = new OutboxStore(storage, options);
    await userA.refresh('user-a');
    expect(userA.list()).toEqual([]);
  });
});
