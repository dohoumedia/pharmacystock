import { describe, expect, it } from 'vitest';
import { LocalStore } from './localStore';
import type { KeyValueStorage } from './storage';
import {
  cacheCustomers,
  cacheOrganizationContext,
  cacheOrganizations,
  getCachedCustomers,
  getCachedOrganizationContext,
  getCachedOrganizations,
  isSnapshotStale,
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
    cacheOrganizations(store, 'user-1', [{ id: 'org-1', name: 'Pharmacy', slug: 'pharmacy', status: 'active', country_code: 'BJ', currency_code: 'XOF', timezone: 'Africa/Porto-Novo', default_locale: 'fr', created_at: '2026-01-01', updated_at: '2026-01-01' }], '2026-08-23T18:00:00.000Z');
    cacheOrganizationContext(store, 'user-1', 'org-1', { branches: [], membership: null, role: null, permissions: ['sale.read'] }, '2026-08-23T18:00:00.000Z');

    const restored = new LocalStore(storage);
    expect(getCachedOrganizations(restored, 'user-1')?.data[0]?.id).toBe('org-1');
    expect(getCachedOrganizationContext(restored, 'user-1', 'org-1')?.data.permissions).toEqual(['sale.read']);
  });

  it('persists customer lists for disconnected reads', () => {
    const storage = memoryStorage();
    const store = new LocalStore(storage);
    cacheCustomers(store, 'org-1', [{ id: 'customer-1', organization_id: 'org-1', full_name: 'Ada', phone: null, email: null, preferred_locale: 'fr', marketing_consent: false, service_notification_consent: true, notes: null, status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01' }], '2026-08-23T18:00:00.000Z');
    expect(getCachedCustomers(new LocalStore(storage), 'org-1')?.data[0]?.full_name).toBe('Ada');
  });

  it('reports snapshot freshness deterministically', () => {
    const snapshot = { data: [], syncedAt: '2026-08-23T18:00:00.000Z' };
    const now = Date.parse('2026-08-23T18:10:00.000Z');
    expect(snapshotAgeMs(snapshot, now)).toBe(10 * 60 * 1000);
    expect(isSnapshotStale(snapshot, 15 * 60 * 1000, now)).toBe(false);
    expect(isSnapshotStale(snapshot, 5 * 60 * 1000, now)).toBe(true);
  });
});
