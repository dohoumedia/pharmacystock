import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from './storage';
import { LocalStore } from './localStore';
import { OutboxStore } from './outbox';
import { queueOfflineSale } from './offlinePos';
import {
  cachePosCatalog,
  cachePosStockSnapshot,
  getOfflineAvailableQuantity,
  searchCachedPosProducts,
  validateOfflineCartAgainstSnapshot,
} from './offlinePosCatalog';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const balance = (productId: string, available: number) => ({
  organization_id: 'org',
  branch_id: 'branch',
  batch_id: `batch-${productId}`,
  product_id: productId,
  on_hand_quantity: available,
  reserved_quantity: 0,
  available_quantity: available,
  last_movement_at: '2026-08-23T18:00:00.000Z',
  product_name: productId,
  lot_number: 'LOT',
  expiry_date: '2027-01-01',
  batch_status: 'ACTIVE',
});

describe('offline POS catalog', () => {
  it('searches a cached synchronized catalog while offline', () => {
    const store = new LocalStore(memoryStorage());
    cachePosCatalog(
      store,
      'org',
      [
        {
          id: 'p1',
          name: 'Paracetamol 500mg',
          generic_name: 'Paracetamol',
          brand_name: null,
          sku: 'PARA-500',
        },
        {
          id: 'p2',
          name: 'Amoxicillin 500mg',
          generic_name: 'Amoxicillin',
          brand_name: null,
          sku: 'AMOX-500',
        },
      ],
      '2026-08-23T18:00:00.000Z',
    );

    expect(searchCachedPosProducts(store, 'org', 'para').map((item) => item.id)).toEqual(['p1']);
  });

  it('subtracts pending same-device sales from the trusted stock snapshot', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    const outbox = new OutboxStore(storage);
    cachePosStockSnapshot(store, 'org', 'branch', [balance('p1', 5)]);

    queueOfflineSale({
      outbox,
      organizationId: 'org',
      branchId: 'branch',
      saleNumber: 'OFF-1',
      lines: [{ product_id: 'p1', quantity: 2 }],
      payments: [{ method: 'CASH', amount: 2000 }],
      idempotencyKey: 'sale:branch:1',
      quote: {
        total_amount: 2000,
        items: [
          {
            product_id: 'p1',
            batch_id: 'b1',
            quantity: 2,
            unit_price: 1000,
            line_total: 2000,
            expiry_date: '2027-01-01',
          },
        ],
      },
      quoteSyncedAt: '2026-08-23T18:00:00.000Z',
    });

    expect(
      getOfflineAvailableQuantity({
        store,
        outbox,
        organizationId: 'org',
        branchId: 'branch',
        productId: 'p1',
      }),
    ).toBe(3);
  });

  it('blocks an obviously impossible offline cart before enqueue', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    const outbox = new OutboxStore(storage);
    cachePosStockSnapshot(store, 'org', 'branch', [balance('p1', 3)]);

    const result = validateOfflineCartAgainstSnapshot({
      store,
      outbox,
      organizationId: 'org',
      branchId: 'branch',
      lines: [{ product_id: 'p1', quantity: 4 }],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('LOCAL_INSUFFICIENT_STOCK');
  });
});
