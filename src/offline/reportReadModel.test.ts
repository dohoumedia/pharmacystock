import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import type { KeyValueStorage } from './storage';
import { cacheReports, getCachedReports } from './reportReadModel';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

describe('reports read model', () => {
  it('keeps reports isolated by organization and branch', () => {
    const store = new LocalStore(memoryStorage());
    cacheReports(store, 'org-a', 'branch-a', {
      dailySales: [{ organization_id: 'org-a', branch_id: 'branch-a', sale_date: '2026-08-23', sale_count: 2, gross_sales: 1200 }],
      inventoryValue: { organization_id: 'org-a', branch_id: 'branch-a', stocked_batches: 3, inventory_cost_value: 800, inventory_retail_value: 1200 },
      expirySummary: { organization_id:'org-a', branch_id:'branch-a', expired_batches:0, expired_units:0, quarantined_batches:1, quarantined_units:2, recalled_batches:0, recalled_units:0, expiring_30d_batches:1, expiring_30d_units:4 },
      purchasingSummary: { organization_id:'org-a', branch_id:'branch-a', open_orders:1, partially_received_orders:0, received_orders:2, ordered_quantity:10, received_quantity:8, ordered_value:100, outstanding_value:20 },
      transferSummary: { organization_id:'org-a', branch_id:'branch-a', open_transfers:1, in_transit_transfers:1, received_transfers:2, requested_quantity:5, dispatched_quantity:5, received_quantity:4, discrepancy_quantity:1 },
    }, '2026-08-23T12:00:00.000Z');
    expect(getCachedReports(store, 'org-a', 'branch-a')?.data.dailySales).toHaveLength(1);
    expect(getCachedReports(store, 'org-a', 'branch-b')).toBeNull();
    expect(getCachedReports(store, 'org-b', 'branch-a')).toBeNull();
  });
});
