import type { Customer, OrganizationSettings } from '../services/coreCompletion';
import type { OrganizationContextData } from '../services/organization';
import type { Database } from '../types/database';
import { LocalStore, type LocalSnapshot } from './localStore';

export type Organization = Database['public']['Tables']['organizations']['Row'];
export type Product = Database['public']['Tables']['products']['Row'];
export type Batch = Database['public']['Tables']['batches']['Row'];

const organizationsKey = (userId: string) => `core:organizations:${userId}`;
const organizationContextKey = (userId: string, organizationId: string) => `core:organization-context:${userId}:${organizationId}`;
const customersKey = (organizationId: string) => `core:customers:${organizationId}`;
const settingsKey = (organizationId: string) => `core:settings:${organizationId}`;
const productsKey = (organizationId: string) => `core:products:${organizationId}`;
const batchesKey = (organizationId: string, branchId: string) => `core:batches:${organizationId}:${branchId}`;

function save<T>(store: LocalStore, key: string, data: T, syncedAt = new Date().toISOString()) {
  store.set(key, { data, syncedAt });
}

export function cacheOrganizations(store: LocalStore, userId: string, data: Organization[], syncedAt?: string) {
  save(store, organizationsKey(userId), data, syncedAt);
}

export function getCachedOrganizations(store: LocalStore, userId: string) {
  return store.get<Organization[]>(organizationsKey(userId));
}

export function cacheOrganizationContext(store: LocalStore, userId: string, organizationId: string, data: OrganizationContextData, syncedAt?: string) {
  save(store, organizationContextKey(userId, organizationId), data, syncedAt);
}

export function getCachedOrganizationContext(store: LocalStore, userId: string, organizationId: string) {
  return store.get<OrganizationContextData>(organizationContextKey(userId, organizationId));
}

export function cacheCustomers(store: LocalStore, organizationId: string, data: Customer[], syncedAt?: string) {
  save(store, customersKey(organizationId), data, syncedAt);
}

export function getCachedCustomers(store: LocalStore, organizationId: string) {
  return store.get<Customer[]>(customersKey(organizationId));
}

export function cacheOrganizationSettings(store: LocalStore, organizationId: string, data: OrganizationSettings | null, syncedAt?: string) {
  save(store, settingsKey(organizationId), data, syncedAt);
}

export function getCachedOrganizationSettings(store: LocalStore, organizationId: string) {
  return store.get<OrganizationSettings | null>(settingsKey(organizationId));
}

export function cacheProducts(store: LocalStore, organizationId: string, data: Product[], syncedAt?: string) {
  save(store, productsKey(organizationId), data, syncedAt);
}

export function getCachedProducts(store: LocalStore, organizationId: string) {
  return store.get<Product[]>(productsKey(organizationId));
}

export function cacheBatches(store: LocalStore, organizationId: string, branchId: string, data: Batch[], syncedAt?: string) {
  save(store, batchesKey(organizationId, branchId), data, syncedAt);
}

export function getCachedBatches(store: LocalStore, organizationId: string, branchId: string) {
  return store.get<Batch[]>(batchesKey(organizationId, branchId));
}

export function snapshotAgeMs(snapshot: LocalSnapshot<unknown> | null, now = Date.now()) {
  if (!snapshot) return null;
  const syncedAt = Date.parse(snapshot.syncedAt);
  return Number.isFinite(syncedAt) ? Math.max(0, now - syncedAt) : null;
}

export function isSnapshotStale(snapshot: LocalSnapshot<unknown> | null, maxAgeMs: number, now = Date.now()) {
  const age = snapshotAgeMs(snapshot, now);
  return age === null || age > maxAgeMs;
}
