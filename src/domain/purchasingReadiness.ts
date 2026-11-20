import type { LocalSnapshot } from '../offline/localStore';
import { createNamespacedStorage, type KeyValueStorage } from '../offline/storage';
import type { createPurchaseOrder, receivePurchaseOrder } from '../services/purchasing';

export const remainingQuantity = (ordered: number, received: number) => Math.round((Number(ordered) - Number(received)) * 1000) / 1000;
export const canReceiveOrder = (status: string) => ['draft', 'ordered', 'partially_received'].includes(status);
export const purchasingScope = (userId: string, organizationId: string, branchId: string) => `purchasing-request:${userId}:${organizationId}:${branchId}`;
export type PurchasingRequest = (
  { kind: 'order'; input: Parameters<typeof createPurchaseOrder>[0] } |
  { kind: 'receipt'; input: Parameters<typeof receivePurchaseOrder>[0] }
) & { branchId: string; organizationId: string; rejected: boolean; resultId?: string };

/** Per-user keys keep uncertain online requests outside the disposable read replica. */
export class PurchasingRequestStore {
  private readonly storage;
  constructor(storage?: KeyValueStorage) { this.storage = createNamespacedStorage('pharmacystock:purchasing-requests:v1', storage); }
  get<T>(key: string): LocalSnapshot<T> | null {
    const raw = this.storage.get(key);
    return raw === null ? null : JSON.parse(raw) as LocalSnapshot<T>;
  }
  set<T>(key: string, snapshot: LocalSnapshot<T>) { this.storage.set(key, JSON.stringify(snapshot)); }
  remove(key: string) { this.storage.remove(key); }
}
/** Same durable form-request pattern as opening stock. No background replay or stock edits. */
export function retainPurchasingRequest(store: Pick<PurchasingRequestStore, 'get' | 'set'>, key: string, request: PurchasingRequest): PurchasingRequest {
  const existing = store.get<PurchasingRequest>(key)?.data;
  if (existing) return existing;
  store.set(key, { data: request, syncedAt: new Date().toISOString() });
  return request;
}
export function assertRequestBranch(request: PurchasingRequest, organizationId: string, branchId: string) {
  if (request.organizationId !== organizationId || request.branchId !== branchId) throw new Error('PURCHASING_BRANCH_CHANGED');
}
