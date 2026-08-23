import type { PosProduct, CartLine } from '../services/sales';
import type { InventoryBalanceItem } from '../services/inventory';
import { LocalStore } from './localStore';
import { OutboxStore } from './outbox';
import { pendingSaleReservations } from './offlinePos';

export type CachedPosCatalog = {
  products: PosProduct[];
};

export type CachedPosStock = {
  productAvailable: Record<string, number>;
};

const catalogKey = (organizationId: string) => `pos:catalog:${organizationId}`;
const stockKey = (organizationId: string, branchId: string) => `pos:stock:${organizationId}:${branchId}`;

export function cachePosCatalog(store: LocalStore, organizationId: string, products: PosProduct[], syncedAt = new Date().toISOString()) {
  const deduped = [...new Map(products.map((product) => [product.id, product])).values()];
  store.set<CachedPosCatalog>(catalogKey(organizationId), { data: { products: deduped }, syncedAt });
}

export function mergePosCatalog(store: LocalStore, organizationId: string, products: PosProduct[], syncedAt = new Date().toISOString()) {
  const existing = store.get<CachedPosCatalog>(catalogKey(organizationId));
  cachePosCatalog(store, organizationId, [...(existing?.data.products ?? []), ...products], syncedAt);
}

export function getCachedPosCatalog(store: LocalStore, organizationId: string) {
  return store.get<CachedPosCatalog>(catalogKey(organizationId));
}

export function searchCachedPosProducts(store: LocalStore, organizationId: string, query: string, limit = 30): PosProduct[] {
  const cached = getCachedPosCatalog(store, organizationId);
  if (!cached) return [];
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return cached.data.products.slice(0, limit);
  return cached.data.products
    .filter((product) => [product.name, product.generic_name, product.brand_name, product.sku]
      .some((value) => value?.toLocaleLowerCase().includes(needle)))
    .slice(0, limit);
}

export function cachePosStockSnapshot(store: LocalStore, organizationId: string, branchId: string, balances: InventoryBalanceItem[], syncedAt = new Date().toISOString()) {
  const productAvailable: Record<string, number> = {};
  for (const balance of balances) {
    productAvailable[balance.product_id] = (productAvailable[balance.product_id] ?? 0) + Number(balance.available_quantity ?? 0);
  }
  store.set<CachedPosStock>(stockKey(organizationId, branchId), { data: { productAvailable }, syncedAt });
}

export function getCachedPosStock(store: LocalStore, organizationId: string, branchId: string) {
  return store.get<CachedPosStock>(stockKey(organizationId, branchId));
}

export function getOfflineAvailableQuantity(input: {
  store: LocalStore;
  outbox: OutboxStore;
  organizationId: string;
  branchId: string;
  productId: string;
}) {
  const snapshot = getCachedPosStock(input.store, input.organizationId, input.branchId);
  if (!snapshot) return null;
  const reserved = pendingSaleReservations(input.outbox, input.organizationId, input.branchId).get(input.productId) ?? 0;
  return Math.max(0, (snapshot.data.productAvailable[input.productId] ?? 0) - reserved);
}

export function validateOfflineCartAgainstSnapshot(input: {
  store: LocalStore;
  outbox: OutboxStore;
  organizationId: string;
  branchId: string;
  lines: CartLine[];
}) {
  const stock = getCachedPosStock(input.store, input.organizationId, input.branchId);
  if (!stock) return { ok: false as const, reason: 'NO_STOCK_SNAPSHOT' as const };
  const reservations = pendingSaleReservations(input.outbox, input.organizationId, input.branchId);
  for (const line of input.lines) {
    const remaining = Math.max(0, (stock.data.productAvailable[line.product_id] ?? 0) - (reservations.get(line.product_id) ?? 0));
    if (line.quantity > remaining) {
      return { ok: false as const, reason: 'LOCAL_INSUFFICIENT_STOCK' as const, productId: line.product_id, available: remaining };
    }
  }
  return { ok: true as const };
}
