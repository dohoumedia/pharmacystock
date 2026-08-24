import type { PurchaseOrderWithSupplier } from '@/services/purchasing';

export type PurchasingLayout = 'cards' | 'table';
export type PurchaseOrderFilter = 'open' | 'partial' | 'received' | 'all';

export const purchasingLayout = (width: number): PurchasingLayout => width >= 900 ? 'table' : 'cards';

export const purchasingMutationAllowed = (online: boolean, permission: boolean, cachedPermissions: boolean) =>
  online && permission && !cachedPermissions;

export function filterPurchaseOrders(orders: PurchaseOrderWithSupplier[], query: string, filter: PurchaseOrderFilter) {
  const normalized = query.trim().toLocaleLowerCase();
  return orders.filter((order) => {
    const matchesText = !normalized || `${order.po_number} ${order.supplier_name}`.toLocaleLowerCase().includes(normalized);
    const matchesStatus = filter === 'all'
      || (filter === 'open' && ['draft', 'ordered', 'partially_received'].includes(order.status))
      || (filter === 'partial' && order.status === 'partially_received')
      || (filter === 'received' && order.status === 'received');
    return matchesText && matchesStatus;
  });
}
