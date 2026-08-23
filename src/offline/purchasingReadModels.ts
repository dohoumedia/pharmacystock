import type { ProductListItem } from '@/services/catalog';
import type { PurchaseOrderWithSupplier, PurchaseReceipt, Supplier } from '@/services/purchasing';
import { LocalStore } from './localStore';

export type PurchasingReadModel = {
  suppliers: Supplier[];
  orders: PurchaseOrderWithSupplier[];
  receipts: PurchaseReceipt[];
  products: ProductListItem[];
};

const key = (organizationId: string, branchId: string) =>
  `purchasing:read-model:${organizationId}:${branchId}`;

export function cachePurchasingReadModel(
  store: LocalStore,
  organizationId: string,
  branchId: string,
  data: PurchasingReadModel,
  syncedAt = new Date().toISOString(),
) {
  store.set(key(organizationId, branchId), { data, syncedAt });
}

export function getCachedPurchasingReadModel(store: LocalStore, organizationId: string, branchId: string) {
  return store.get<PurchasingReadModel>(key(organizationId, branchId));
}
