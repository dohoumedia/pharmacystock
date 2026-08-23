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
    }, '2026-08-23T12:00:00.000Z');
    expect(getCachedReports(store, 'org-a', 'branch-a')?.data.dailySales).toHaveLength(1);
    expect(getCachedReports(store, 'org-a', 'branch-b')).toBeNull();
    expect(getCachedReports(store, 'org-b', 'branch-a')).toBeNull();
  });
});
