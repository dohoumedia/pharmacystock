import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import type { KeyValueStorage } from './storage';
import { cacheExpiryReadModel, cacheTransferLines, cacheTransfersReadModel, getCachedExpiryReadModel, getCachedTransferLines, getCachedTransfersReadModel } from './expiryTransfersReadModels';

function storage(): KeyValueStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

describe('expiry and transfer cached read models', () => {
  it('persists branch-scoped expiry snapshots with freshness metadata', () => {
    const store = new LocalStore(storage());
    cacheExpiryReadModel(store, 'org-a', 'branch-a', { risk: [], alerts: [], actions: [], policy: null }, '2026-08-23T12:00:00.000Z');
    expect(getCachedExpiryReadModel(store, 'org-a', 'branch-a')?.syncedAt).toBe('2026-08-23T12:00:00.000Z');
    expect(getCachedExpiryReadModel(store, 'org-a', 'branch-b')).toBeNull();
  });

  it('persists transfer summaries and details without crossing organizations', () => {
    const store = new LocalStore(storage());
    cacheTransfersReadModel(store, 'org-a', 'branch-a', { transfers: [], transferableBatches: [] }, '2026-08-23T13:00:00.000Z');
    cacheTransferLines(store, 'org-a', 'transfer-a', [], '2026-08-23T13:01:00.000Z');
    expect(getCachedTransfersReadModel(store, 'org-a', 'branch-a')?.data.transfers).toEqual([]);
    expect(getCachedTransferLines(store, 'org-a', 'transfer-a')?.syncedAt).toBe('2026-08-23T13:01:00.000Z');
    expect(getCachedTransferLines(store, 'org-b', 'transfer-a')).toBeNull();
  });
});
