import { describe, expect, it } from 'vitest';
import type { InventoryBalanceItem } from '@/services/inventory';
import { batchSafetyStatus, isBatchSellable, sortBalancesForFefoDisplay } from './inventorySafety';

const NOW = new Date('2026-08-23T12:00:00.000Z');

function balance(batchId: string, expiryDate: string, batchStatus = 'ACTIVE'): InventoryBalanceItem {
  return {
    organization_id: 'org-1',
    branch_id: 'branch-1',
    batch_id: batchId,
    product_id: `product-${batchId}`,
    on_hand_quantity: 10,
    reserved_quantity: 0,
    available_quantity: 10,
    last_movement_at: null,
    product_name: `Product ${batchId}`,
    lot_number: batchId,
    expiry_date: expiryDate,
    batch_status: batchStatus,
  };
}

describe('inventory batch safety presentation', () => {
  it('never treats expired, quarantined, recalled, depleted, or disposed batches as sellable', () => {
    expect(isBatchSellable('ACTIVE', '2026-08-22', NOW)).toBe(false);
    for (const status of ['EXPIRED', 'QUARANTINED', 'RECALLED', 'DEPLETED', 'DISPOSED']) {
      expect(isBatchSellable(status, '2027-01-01', NOW)).toBe(false);
    }
    expect(isBatchSellable('ACTIVE', '2027-01-01', NOW)).toBe(true);
  });

  it('derives expired safety from the date even if a cached status has not caught up', () => {
    expect(batchSafetyStatus('ACTIVE', '2026-08-22', NOW)).toBe('EXPIRED');
  });

  it('orders eligible batches by FEFO and keeps forbidden stock after eligible stock', () => {
    const sorted = sortBalancesForFefoDisplay(
      [
        balance('late', '2027-03-01'),
        balance('recalled', '2026-09-01', 'RECALLED'),
        balance('early', '2026-10-01'),
        balance('expired', '2026-08-01'),
      ],
      NOW,
    );
    expect(sorted.map((item) => item.batch_id)).toEqual(['early', 'late', 'expired', 'recalled']);
  });
});
