import type { ExpiryAlert, ExpiryRisk } from '../services/expiry';
import type { BatchChoice } from '../services/catalogReadiness';
import type { InventoryBalance } from '../services/inventory';
import { inventoryQuantity, assertInventoryScope } from './inventoryCompletion';
import { isBatchSellable } from './inventorySafety';

export const DEFAULT_EXPIRY_THRESHOLDS = [180, 90, 60, 30, 7];
export const EXPIRY_REFRESH_MS = 60_000;
export function expiryThresholds(raw: string): number[] {
  const parts = raw.split(',').map((part) => part.trim());
  if (!parts.length || parts.length > 10 || parts.some((part) => !/^\d+$/.test(part) || Number(part) <= 0 || Number(part) > 2147483647)) throw new Error('INVALID_EXPIRY_THRESHOLDS');
  return [...new Set(parts.map(Number))].sort((a, b) => b - a);
}
export function expiryCategory(days: number | null, thresholds: number[]) {
  if (days === null || !Number.isFinite(days)) return { kind: 'UNKNOWN' as const, threshold: null };
  if (days < 0) return { kind: 'EXPIRED' as const, threshold: null };
  const threshold = [...thresholds].sort((a, b) => a - b).find((value) => days <= value) ?? null;
  return { kind: threshold === null ? 'NORMAL' as const : 'SOON' as const, threshold };
}
export function currentExpiryAlerts(alerts: ExpiryAlert[], risk: ExpiryRisk[], thresholds: number[]) {
  const batches = new Map(risk.map((row) => [row.batch_id, row]));
  return alerts.filter((alert) => {
    const batch = batches.get(alert.batch_id);
    if (!batch || batch.expiry_date !== alert.expiry_date_snapshot || alert.status === 'RESOLVED') return false;
    const category = expiryCategory(batch.days_remaining, thresholds);
    return category.kind === 'EXPIRED' ? alert.alert_type === 'EXPIRED' : category.kind === 'SOON' && alert.alert_type === 'EXPIRY_WARNING' && alert.threshold_days === category.threshold;
  });
}
export function expirySnapshotStale(syncedAt: string | null, now = Date.now()) {
  const timestamp = syncedAt ? Date.parse(syncedAt) : NaN;
  return !Number.isFinite(timestamp) || now - timestamp >= EXPIRY_REFRESH_MS;
}
export function riskSellable(row: ExpiryRisk) {
  return row.batch_status === 'ACTIVE' && row.days_remaining !== null && row.days_remaining >= 0 && row.on_hand_quantity !== null && Number(row.on_hand_quantity) > 0 && row.available_quantity != null && Number(row.available_quantity) > 0;
}
export type ExpiryOperation = 'PRIORITIZE_SALE' | 'QUARANTINE' | 'RELEASE_QUARANTINE' | 'RECALL' | 'DISPOSE' | 'SUPPLIER_RETURN';
export const isStockRemoval = (action: ExpiryOperation) => action === 'DISPOSE' || action === 'SUPPLIER_RETURN';
export function expiryActionAllowed(action: ExpiryOperation, batch: BatchChoice, balance: InventoryBalance | null, now = new Date()) {
  if (!balance || !Number.isFinite(Number(balance.on_hand_quantity)) || Number(balance.on_hand_quantity) <= 0) return false;
  if (action === 'DISPOSE') return !['DISPOSED', 'DEPLETED'].includes(batch.status) && Number(balance.reserved_quantity) === 0;
  if (action === 'SUPPLIER_RETURN') return !['DISPOSED', 'DEPLETED'].includes(batch.status);
  if (action === 'QUARANTINE') return batch.status === 'ACTIVE';
  if (action === 'RECALL') return ['ACTIVE', 'QUARANTINED'].includes(batch.status);
  if (action === 'RELEASE_QUARANTINE') return batch.status === 'QUARANTINED' && isBatchSellable('ACTIVE', batch.expiry_date, now);
  return isBatchSellable(batch.status, batch.expiry_date, now);
}
export function expiryActionQuantity(action: ExpiryOperation, raw: string, reason: string, batch: BatchChoice, balance: InventoryBalance | null, organizationId: string, branchId: string, now = new Date()) {
  assertInventoryScope({ organizationId: batch.organization_id, branchId: batch.branch_id }, organizationId, branchId);
  if (!balance || balance.batch_id !== batch.id || balance.organization_id !== organizationId || balance.branch_id !== branchId) throw new Error('EXPIRY_BALANCE_UNAVAILABLE');
  if (!reason.trim()) throw new Error('EXPIRY_REASON_REQUIRED');
  if (!expiryActionAllowed(action, batch, balance, now)) throw new Error('EXPIRY_ACTION_INELIGIBLE');
  if (action === 'DISPOSE') return Number(balance.on_hand_quantity);
  if (action !== 'SUPPLIER_RETURN') return null;
  const quantity = inventoryQuantity(raw);
  const unreserved = Number(balance.on_hand_quantity) - Number(balance.reserved_quantity);
  if (quantity > unreserved) throw new Error('INSUFFICIENT_STOCK');
  return quantity;
}
export type ExpiryRequest = {
  organizationId: string; branchId: string; batch: BatchChoice; action: ExpiryOperation; quantity: number | null;
  reason: string; reference: string; idempotencyKey: string; createdAt: string; observedOnHand: number;
  phase?: 'prepared' | 'dispatched'; resultId?: string; rejected?: boolean;
};
// The existing reason field carries the reference on status RPCs that have no idempotency argument.
export const expiryRequestReason = (request: ExpiryRequest) => [request.reason, request.reference, `[${request.idempotencyKey}]`].filter(Boolean).join('\n');
