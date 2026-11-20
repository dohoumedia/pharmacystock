import { hasDecimalPrecision, parseLocaleNumber } from './numericInput';
import { createNamespacedStorage, type KeyValueStorage } from '../offline/storage';
import type { BatchChoice } from '../services/catalogReadiness';
import type { InventoryBalance, StockCount } from '../services/inventory';

// The existing ledger and count lines use numeric(18,4).
export function inventoryQuantity(raw: string, allowZero = false): number {
  const value = parseLocaleNumber(raw);
  const fraction = raw.trim().split(/[.,]/)[1] ?? '';
  if (value === null || value < 0 || (!allowZero && value === 0) || value >= 1e14 || fraction.replace(/0+$/, '').length > 4 || !Number.isSafeInteger(Math.round(value * 10000)) || !hasDecimalPrecision(value, 4)) throw new Error('INVENTORY_QUANTITY_INVALID');
  return value;
}
export const variance = (counted: number, expected: number) => Math.round((counted - expected) * 10000) / 10000;
export type CountEntry = { batch: BatchChoice; raw: string; expected: number | null };
export type CountDraft = { id: string; organizationId: string; branchId: string; createdAt: string; entries: CountEntry[]; phase: 'editing' | 'review' | 'reconciling' | 'completed' | 'cancelled' };
export type AdjustmentRequest = { organizationId: string; branchId: string; batch: BatchChoice; quantityDelta: number; reason: string; reference: string; idempotencyKey: string; occurredAt: string; observedOnHand: number; resultId?: string; rejected?: boolean };
export function adjustmentValues(raw: string, direction: 'IN' | 'OUT', reason: string, batch: BatchChoice | null, balance: InventoryBalance | null, organizationId: string, branchId: string) {
  const amount = inventoryQuantity(raw);
  if (!reason.trim()) throw new Error('INVENTORY_REASON_REQUIRED');
  if (!batch || !balance || batch.organization_id !== organizationId || batch.branch_id !== branchId || balance.batch_id !== batch.id || balance.branch_id !== branchId || balance.organization_id !== organizationId) throw new Error('INVENTORY_BATCH_INVALID');
  if (direction === 'IN' && ['RECALLED', 'DISPOSED'].includes(batch.status)) throw new Error('INVENTORY_BATCH_STATUS_BLOCKS_INBOUND');
  if (direction === 'OUT' && amount > Number(balance.on_hand_quantity)) throw new Error('INSUFFICIENT_STOCK');
  return direction === 'IN' ? amount : -amount;
}
export function countValues(draft: CountDraft) {
  if (!draft.entries.length || new Set(draft.entries.map((entry) => entry.batch.id)).size !== draft.entries.length) throw new Error('INVENTORY_COUNT_INCOMPLETE');
  return draft.entries.map((entry) => {
    if (entry.batch.organization_id !== draft.organizationId || entry.batch.branch_id !== draft.branchId) throw new Error('INVENTORY_BATCH_INVALID');
    if (!entry.raw.trim()) throw new Error('INVENTORY_COUNT_INCOMPLETE');
    return { batchId: entry.batch.id, countedQuantity: inventoryQuantity(entry.raw, true) };
  });
}
export function assertInventoryScope(value: { organizationId: string; branchId: string }, organizationId: string, branchId: string) {
  if (value.organizationId !== organizationId || value.branchId !== branchId) throw new Error('INVENTORY_BRANCH_CHANGED');
}
export function assertCountScope(count: StockCount, organizationId: string, branchId: string) {
  assertInventoryScope({ organizationId: count.organization_id, branchId: count.branch_id }, organizationId, branchId);
}
/** Only form intent and recovery references. No local stock authority or automatic replay. */
export class InventoryFormStore {
  private readonly storage;
  constructor(storage?: KeyValueStorage) { this.storage = createNamespacedStorage('pharmacystock:inventory-forms:v1', storage); }
  get<T>(key: string): T | null { const raw = this.storage.get(key); return raw === null ? null : JSON.parse(raw) as T; }
  set<T>(key: string, value: T) { this.storage.set(key, JSON.stringify(value)); }
  remove(key: string) { this.storage.remove(key); }
}
export const inventoryFormScope = (userId: string, organizationId: string, branchId: string) => `${userId}:${organizationId}:${branchId}`;
