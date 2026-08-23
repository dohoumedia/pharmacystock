import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import type { KeyValueStorage } from './storage';
import { cachePurchasingReadModel, getCachedPurchasingReadModel } from './purchasingReadModels';

describe('purchasing read models', () => {
  it('keeps branch-scoped purchasing data and its synchronization timestamp', () => {
    const values = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    const store = new LocalStore(storage);
    const data = { suppliers: [], orders: [], receipts: [], products: [] };
    cachePurchasingReadModel(store, 'org-a', 'branch-a', data, '2026-08-23T12:00:00.000Z');

    expect(getCachedPurchasingReadModel(store, 'org-a', 'branch-a')).toEqual({
      data,
      syncedAt: '2026-08-23T12:00:00.000Z',
    });
    expect(getCachedPurchasingReadModel(store, 'org-a', 'branch-b')).toBeNull();
  });
});
