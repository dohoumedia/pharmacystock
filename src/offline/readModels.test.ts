import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import type { KeyValueStorage } from './storage';
import {
  cacheCustomers,
  cacheOrganizationContext,
  cacheOrganizations,
  cacheBatches,
  cacheInventoryReadModel,
  cacheProducts,
  getCachedBatches,
  getCachedCustomers,
  getCachedInventoryReadModel,
  getCachedOrganizationContext,
  getCachedOrganizations,
  getCachedProducts,
  isSnapshotStale,
  oldestSnapshotSyncedAt,
  snapshotAgeMs,
} from './readModels';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('offline core read models', () => {
  it('persists organization and branch context across store instances', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    cacheOrganizations(
      store,
      'user-1',
      [
        {
          id: 'org-1',
          name: 'Pharmacy',
          slug: 'pharmacy',
          status: 'active',
          country_code: 'BJ',
          currency_code: 'XOF',
          timezone: 'Africa/Porto-Novo',
          default_locale: 'fr',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
      '2026-08-23T18:00:00.000Z',
    );
    cacheOrganizationContext(
      store,
      'user-1',
      'org-1',
      {
        branches: [],
        membership: null,
        role: null,
        permissions: ['sale.read'],
      },
      '2026-08-23T18:00:00.000Z',
    );

    const restored = new LocalStore(storage);
    expect(getCachedOrganizations(restored, 'user-1')?.data[0]?.id).toBe('org-1');
    expect(getCachedOrganizationContext(restored, 'user-1', 'org-1')?.data.permissions).toEqual(['sale.read']);
  });

  it('persists customer lists for disconnected reads', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    cacheCustomers(
      store,
      'org-1',
      [
        {
          id: 'customer-1',
          organization_id: 'org-1',
          full_name: 'Ada',
          phone: null,
          email: null,
          preferred_locale: 'fr',
          marketing_consent: false,
          service_notification_consent: true,
          notes: null,
          status: 'active',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
      '2026-08-23T18:00:00.000Z',
    );
    expect(getCachedCustomers(new LocalStore(storage), 'org-1')?.data[0]?.full_name).toBe('Ada');
  });

  it('reports snapshot freshness deterministically', () => {
    const snapshot = { data: [], syncedAt: '2026-08-23T18:00:00.000Z' };
    const now = Date.parse('2026-08-23T18:10:00.000Z');
    expect(snapshotAgeMs(snapshot, now)).toBe(10 * 60 * 1000);
    expect(isSnapshotStale(snapshot, 15 * 60 * 1000, now)).toBe(false);
    expect(isSnapshotStale(snapshot, 5 * 60 * 1000, now)).toBe(true);
  });

  it('persists branch-scoped inventory balances and immutable movement reads', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    cacheInventoryReadModel(
      store,
      'org-1',
      'branch-1',
      {
        balances: [
          {
            organization_id: 'org-1',
            branch_id: 'branch-1',
            batch_id: 'batch-1',
            product_id: 'product-1',
            on_hand_quantity: 4,
            reserved_quantity: 0,
            available_quantity: 0,
            last_movement_at: '2026-08-23T17:00:00.000Z',
            product_name: 'Safety batch',
            lot_number: 'LOT-1',
            expiry_date: '2027-01-01',
            batch_status: 'QUARANTINED',
          },
        ],
        movements: [
          {
            id: 'movement-1',
            organization_id: 'org-1',
            branch_id: 'branch-1',
            batch_id: 'batch-1',
            movement_type: 'PURCHASE_RECEIPT',
            quantity_delta: 4,
            unit_cost: null,
            reference_type: null,
            reference_id: null,
            idempotency_key: 'receipt-1',
            reason: null,
            metadata: {},
            occurred_at: '2026-08-23T17:00:00.000Z',
            created_at: '2026-08-23T17:00:00.000Z',
            created_by: 'user-1',
          },
        ],
      },
      '2026-08-23T18:00:00.000Z',
    );

    const restored = getCachedInventoryReadModel(new LocalStore(storage), 'org-1', 'branch-1');
    expect(restored?.data.balances[0]?.batch_status).toBe('QUARANTINED');
    expect(restored?.data.movements[0]?.idempotency_key).toBe('receipt-1');
    expect(getCachedInventoryReadModel(new LocalStore(storage), 'org-1', 'branch-2')).toBeNull();
  });

  it('persists batch and product reads with tenant and branch scoping', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    cacheProducts(
      store,
      'org-1',
      [
        {
          id: 'product-1',
          organization_id: 'org-1',
          category_id: null,
          manufacturer_id: null,
          name: 'Medicine',
          generic_name: null,
          brand_name: null,
          strength: null,
          dosage_form: null,
          package_size: null,
          sku: null,
          status: 'active',
          archived_at: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
      '2026-08-23T18:00:00.000Z',
    );
    cacheBatches(
      store,
      'org-1',
      'branch-1',
      [
        {
          id: 'batch-1',
          organization_id: 'org-1',
          branch_id: 'branch-1',
          product_id: 'product-1',
          lot_number: 'LOT-1',
          expiry_date: '2027-01-01',
          purchase_cost: null,
          selling_price: null,
          status: 'RECALLED',
          notes: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        },
      ],
      '2026-08-23T18:02:00.000Z',
    );

    expect(getCachedProducts(new LocalStore(storage), 'org-1')?.data[0]?.name).toBe('Medicine');
    expect(getCachedBatches(new LocalStore(storage), 'org-1', 'branch-1')?.data[0]?.status).toBe('RECALLED');
    expect(getCachedBatches(new LocalStore(storage), 'org-1', 'branch-2')).toBeNull();
    expect(getCachedProducts(new LocalStore(storage), 'org-2')).toBeNull();
  });

  it('uses the oldest contributing snapshot as combined view freshness', () => {
    const oldest = oldestSnapshotSyncedAt(
      { data: [], syncedAt: '2026-08-23T18:05:00.000Z' },
      { data: [], syncedAt: '2026-08-23T18:00:00.000Z' },
      null,
    );
    expect(oldest).toBe('2026-08-23T18:00:00.000Z');
  });
});
