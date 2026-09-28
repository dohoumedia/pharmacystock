import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from './storage';
import { LocalStore } from './localStore';
import { OutboxIdempotencyConflictError, OutboxStore } from './outbox';
import { applySaleDraftMutation, cacheSaleQuote, getCachedSaleQuote, pendingSaleReservations, queueOfflineSale, queueOfflineSaleForCheckout, resolveSaleSubmissionIdentity } from './offlinePos';
import { OfflineSessionScope } from './sessionScope';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('offline POS', () => {
  it('creates distinct sale identities for same-time submissions', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_797_681_600_000);
    const immutableContent = {
      organizationId: 'org',
      branchId: 'branch',
      lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ method: 'CASH', amount: 1250 }],
    };
    const first = resolveSaleSubmissionIdentity({
      branchId: 'branch',
      immutableContent,
      createUuid: () => '11111111-1111-4111-8111-111111111111',
    });
    const second = resolveSaleSubmissionIdentity({
      branchId: 'branch',
      immutableContent,
      createUuid: () => '22222222-2222-4222-8222-222222222222',
    });
    clock.mockRestore();

    expect(first.saleNumber).not.toBe(second.saleNumber);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it('keeps the same sale identity for an exact logical retry across a connectivity change', () => {
    const onlineAttempt = {
      organizationId: 'org',
      branchId: 'branch',
      lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ method: 'CASH', amount: 1250 }],
    };
    const first = resolveSaleSubmissionIdentity({
      branchId: 'branch',
      immutableContent: onlineAttempt,
      createUuid: () => '11111111-1111-4111-8111-111111111111',
    });
    const offlineRetry = { ...onlineAttempt, payments: [{ amount: 1250, method: 'CASH' }] };
    const retried = resolveSaleSubmissionIdentity({
      branchId: 'branch',
      immutableContent: offlineRetry,
      previous: first,
      createUuid: () => { throw new Error('retry generated a new identity'); },
    });

    expect(retried).toBe(first);
  });

  it('blocks cart mutation while a sale submission is in flight', () => {
    const cart = [{ product_id: 'product-a', quantity: 1 }];

    const changed = applySaleDraftMutation(true, () => {
      cart.push({ product_id: 'product-b', quantity: 1 });
    });

    expect(changed).toBe(false);
    expect(cart).toEqual([{ product_id: 'product-a', quantity: 1 }]);
  });

  it('persists the last trusted quote for an exact cart', () => {
    const storage = memoryStorage();
    const localStore = new LocalStore(storage);
    const lines = [{ product_id: 'product-a', quantity: 2 }];
    const quote = {
      total_amount: 2500,
      items: [{ product_id: 'product-a', batch_id: 'batch-a', quantity: 2, unit_price: 1250, line_total: 2500, expiry_date: '2027-01-01' }],
    };

    cacheSaleQuote(localStore, 'org', 'branch', lines, quote, '2026-08-23T18:00:00.000Z');
    const cached = getCachedSaleQuote(new LocalStore(storage), 'org', 'branch', lines);

    expect(cached?.data.total_amount).toBe(2500);
    expect(cached?.syncedAt).toBe('2026-08-23T18:00:00.000Z');
  });

  it('queues one pending sale with a stable idempotency key and receipt number', async () => {
    const storage = memoryStorage();
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    const quote = {
      total_amount: 1250,
      items: [{ product_id: 'product-a', batch_id: 'batch-a', quantity: 1, unit_price: 1250, line_total: 1250, expiry_date: '2027-01-01' }],
    };

    const input = {
      outbox,
      userId: 'user-a',
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: 'OFFLINE-001',
      lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ method: 'CASH' as const, amount: 1250 }],
      idempotencyKey: 'sale:branch:offline-001',
      quote,
      quoteSyncedAt: '2026-08-23T18:00:00.000Z',
      trustedAvailableByProduct: { 'product-a': 1 },
      requireCrossContextAtomicity: false,
      createdAt: '2026-08-23T18:05:00.000Z',
    };

    await queueOfflineSale(input);
    await queueOfflineSale(input);

    const reconstructed = new OutboxStore(storage);
    await reconstructed.ready();
    const pending = reconstructed.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.idempotencyKey).toBe('sale:branch:offline-001');
    expect((pending[0]?.payload as { localReceiptNumber: string }).localReceiptNumber).toBe('OFFLINE-001');
  });

  it('counts same-device provisional reservations from pending sales only', async () => {
    const storage = memoryStorage();
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    const quote = {
      total_amount: 2500,
      items: [{ product_id: 'product-a', batch_id: 'batch-a', quantity: 2, unit_price: 1250, line_total: 2500, expiry_date: '2027-01-01' }],
    };

    await queueOfflineSale({
      outbox,
      userId: 'user-a',
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: 'OFFLINE-001',
      lines: [{ product_id: 'product-a', quantity: 2 }],
      payments: [{ method: 'CASH', amount: 2500 }],
      idempotencyKey: 'sale:branch:offline-001',
      quote,
      quoteSyncedAt: '2026-08-23T18:00:00.000Z',
      trustedAvailableByProduct: { 'product-a': 2 },
      requireCrossContextAtomicity: false,
    });

    const reservations = pendingSaleReservations(outbox, 'org', 'branch');
    expect(reservations.get('product-a')).toBe(2);
  });

  it('preserves the cart when a conflicting idempotency key is rejected', async () => {
    const storage = memoryStorage();
    await new OfflineSessionScope(storage).bindUser('user-a');
    const outbox = new OutboxStore(storage);
    const quote = {
      total_amount: 1250,
      items: [{ product_id: 'product-a', batch_id: 'batch-a', quantity: 1, unit_price: 1250, line_total: 1250, expiry_date: '2027-01-01' }],
    };
    const original = {
      outbox,
      userId: 'user-a',
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: 'SALE-ORIGINAL',
      lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ method: 'CASH' as const, amount: 1250 }],
      idempotencyKey: 'sale:branch:shared',
      quote,
      quoteSyncedAt: '2026-09-26T12:00:00.000Z',
      trustedAvailableByProduct: { 'product-a': 1 },
      requireCrossContextAtomicity: false,
      createdAt: '2026-09-26T12:01:00.000Z',
    };
    await queueOfflineSale(original);
    let cart = [{ product_id: 'product-b', quantity: 1 }];

    await expect(queueOfflineSaleForCheckout({
      ...original,
      saleNumber: 'SALE-CONFLICTING',
      lines: cart,
      createdAt: '2026-09-26T12:01:00.001Z',
    }, () => {
      cart = [];
    })).rejects.toBeInstanceOf(OutboxIdempotencyConflictError);

    expect(cart).toEqual([{ product_id: 'product-b', quantity: 1 }]);
    expect(outbox.list()).toHaveLength(1);
  });
});
