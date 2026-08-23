import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from './storage';
import { LocalStore } from './localStore';
import { OutboxStore } from './outbox';
import { cacheSaleQuote, getCachedSaleQuote, pendingSaleReservations, queueOfflineSale } from './offlinePos';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('offline POS', () => {
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

  it('queues one pending sale with a stable idempotency key and receipt number', () => {
    const storage = memoryStorage();
    const outbox = new OutboxStore(storage);
    const quote = {
      total_amount: 1250,
      items: [{ product_id: 'product-a', batch_id: 'batch-a', quantity: 1, unit_price: 1250, line_total: 1250, expiry_date: '2027-01-01' }],
    };

    const input = {
      outbox,
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: 'OFFLINE-001',
      lines: [{ product_id: 'product-a', quantity: 1 }],
      payments: [{ method: 'CASH' as const, amount: 1250 }],
      idempotencyKey: 'sale:branch:offline-001',
      quote,
      quoteSyncedAt: '2026-08-23T18:00:00.000Z',
      createdAt: '2026-08-23T18:05:00.000Z',
    };

    queueOfflineSale(input);
    queueOfflineSale(input);

    const pending = new OutboxStore(storage).pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.idempotencyKey).toBe('sale:branch:offline-001');
    expect((pending[0]?.payload as { localReceiptNumber: string }).localReceiptNumber).toBe('OFFLINE-001');
  });

  it('counts same-device provisional reservations from pending sales only', () => {
    const outbox = new OutboxStore(memoryStorage());
    const quote = {
      total_amount: 2500,
      items: [{ product_id: 'product-a', batch_id: 'batch-a', quantity: 2, unit_price: 1250, line_total: 2500, expiry_date: '2027-01-01' }],
    };

    queueOfflineSale({
      outbox,
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: 'OFFLINE-001',
      lines: [{ product_id: 'product-a', quantity: 2 }],
      payments: [{ method: 'CASH', amount: 2500 }],
      idempotencyKey: 'sale:branch:offline-001',
      quote,
      quoteSyncedAt: '2026-08-23T18:00:00.000Z',
    });

    const reservations = pendingSaleReservations(outbox, 'org', 'branch');
    expect(reservations.get('product-a')).toBe(2);
  });
});
