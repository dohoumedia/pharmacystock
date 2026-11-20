import type { Notification } from '../services/coreCompletion';
export type OperationalNotification = Notification & { condition_key: string | null; resolved_at: string | null; checked_at: string | null };
export const NOTIFICATION_PAGE_SIZE = 25;
export const NOTIFICATION_REFRESH_MS = 60_000;
export const notificationPermissions: Record<string, string> = {
  LOW_STOCK: 'inventory.read', OUT_OF_STOCK: 'inventory.read', EXPIRY_ALERT: 'inventory.read', BATCH_ATTENTION: 'inventory.read',
  PURCHASE_FOLLOWUP: 'purchase.read', TRANSFER_FOLLOWUP: 'transfer.read', COUNT_FOLLOWUP: 'inventory.count', INVITATION_FOLLOWUP: 'staff.manage', IMPORT_FAILED: 'import.manage',
};
export function notificationPayload(row: OperationalNotification): Record<string, unknown> {
  return row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {};
}
export function notificationVisible(row: OperationalNotification, branches: readonly { id: string }[], can: (code: string) => boolean) {
  return can('notification.read') && Boolean(notificationPermissions[row.type] && can(notificationPermissions[row.type]!)) && (!row.branch_id || branches.some(b => b.id === row.branch_id));
}
export function notificationDestination(row: OperationalNotification, can: (code: string) => boolean): string | null {
  if (row.resolved_at || !notificationPermissions[row.type] || !can(notificationPermissions[row.type]!)) return null;
  const p = notificationPayload(row), param = (key: string) => typeof p[key] === 'string' ? encodeURIComponent(p[key]) : null;
  switch (row.type) {
    case 'LOW_STOCK': case 'OUT_OF_STOCK': return param('reference') ? `/inventory?search=${param('reference')}` : '/inventory';
    case 'EXPIRY_ALERT': case 'BATCH_ATTENTION': return param('batch_id') ? `/expiry?batchId=${param('batch_id')}` : '/expiry';
    case 'PURCHASE_FOLLOWUP': return param('order_id') ? `/purchasing?orderId=${param('order_id')}` : '/purchasing';
    case 'TRANSFER_FOLLOWUP': return param('transfer_id') ? `/transfers?transferId=${param('transfer_id')}` : '/transfers';
    case 'COUNT_FOLLOWUP': return param('count_id') ? `/inventory?countId=${param('count_id')}` : '/inventory';
    case 'INVITATION_FOLLOWUP': return '/staff';
    case 'IMPORT_FAILED': return '/operations';
    default: return null;
  }
}
export function notificationPage<T>(rows: T[]) {
  return { items: rows.slice(0, NOTIFICATION_PAGE_SIZE), hasMore: rows.length > NOTIFICATION_PAGE_SIZE };
}
