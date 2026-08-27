import { describe, expect, it } from 'vitest';
import { getExpiryAttention, getStockAttention, getTodaysSales, getTransferAttention } from './dashboardPresentation';
import type { InventoryBalanceItem } from '../services/inventory';
import type { StockTransfer } from '../services/transfers';

const balance = (available: number, status = 'ACTIVE', expiryDate = '2030-01-01') => ({
  batch_id: `batch-${available}-${status}`,
  available_quantity: available,
  batch_status: status,
  expiry_date: expiryDate,
} as InventoryBalanceItem);

const transfer = (status: StockTransfer['status'], source = 'branch-a', destination = 'branch-b') => ({
  id: `${status}-${source}-${destination}`, source_branch_id: source, destination_branch_id: destination, status,
} as StockTransfer);

describe('dashboard presentation', () => {
  it('counts only eligible depleted and configured-low batch balances', () => {
    expect(getStockAttention([balance(0), balance(2), balance(0, 'QUARANTINED')], 2)).toEqual({
      outOfStock: 1,
      lowStock: 1,
      lowStockThreshold: 2,
    });
  });

  it('excludes healthy, empty, and depleted expiry rows from attention', () => {
    expect(getExpiryAttention([
      { risk_bucket: 'OK', on_hand_quantity: 2 },
      { risk_bucket: '7_DAYS', on_hand_quantity: 0 },
      { risk_bucket: '30_DAYS', on_hand_quantity: 3 },
    ] as never[])).toHaveLength(1);
  });

  it('keeps only open lifecycle transfers for the selected branch', () => {
    expect(getTransferAttention([transfer('REQUESTED'), transfer('RECEIVED'), transfer('DISPATCHED', 'branch-x', 'branch-a')], 'branch-a')).toHaveLength(2);
  });

  it('uses the current branch sales row only', () => {
    expect(getTodaysSales([{ organization_id: 'org', branch_id: 'branch', sale_date: '2026-08-27', sale_count: 3, gross_sales: 42 }], '2026-08-27')).toEqual({ saleCount: 3, grossSales: 42 });
  });
});
