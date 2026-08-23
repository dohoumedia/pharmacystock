import type { InventoryBalanceItem } from '@/services/inventory';

export type BatchSafetyStatus = 'ACTIVE' | 'QUARANTINED' | 'RECALLED' | 'EXPIRED' | 'DEPLETED' | 'DISPOSED' | 'UNKNOWN';

const NON_SELLABLE = new Set<BatchSafetyStatus>(['QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED', 'UNKNOWN']);

export function batchSafetyStatus(status: string, expiryDate: string, now = new Date()): BatchSafetyStatus {
  const normalized = status.toUpperCase() as BatchSafetyStatus;
  const today = [
    now.getFullYear().toString().padStart(4, '0'),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0'),
  ].join('-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) && expiryDate < today) return 'EXPIRED';
  return ['ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED'].includes(normalized) ? normalized : 'UNKNOWN';
}

export function isBatchSellable(status: string, expiryDate: string, now = new Date()) {
  return !NON_SELLABLE.has(batchSafetyStatus(status, expiryDate, now));
}

export function sortBalancesForFefoDisplay(balances: InventoryBalanceItem[], now = new Date()) {
  return [...balances].sort((left, right) => {
    const leftEligible = isBatchSellable(left.batch_status, left.expiry_date, now);
    const rightEligible = isBatchSellable(right.batch_status, right.expiry_date, now);
    if (leftEligible !== rightEligible) return leftEligible ? -1 : 1;
    return (
      left.expiry_date.localeCompare(right.expiry_date) ||
      left.product_name.localeCompare(right.product_name) ||
      left.lot_number.localeCompare(right.lot_number)
    );
  });
}
