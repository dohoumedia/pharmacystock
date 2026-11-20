import { describe, expect, it } from 'vitest';
import { expiryRiskLevel, getExpiryAttention, getStockAttention, getTodaysSales, getTransferAttention, stockRiskCopyKey, stockRiskLevel, transferRiskLevel } from './dashboardPresentation';
import type { InventoryBalanceItem } from '../services/inventory';
import type { StockTransfer } from '../services/transfers';

const balance = (available: number, status = 'ACTIVE', expiryDate = '2030-01-01') => ({
  batch_id: `batch-${available}-${status}`,
  available_quantity: available,
  selling_price: 1,
  batch_status: status,
  expiry_date: expiryDate,
} as InventoryBalanceItem);

const transfer = (status: StockTransfer['status'], source = 'branch-a', destination = 'branch-b') => ({
  id: `${status}-${source}-${destination}`, source_branch_id: source, destination_branch_id: destination, status,
} as StockTransfer);

describe('dashboard presentation', () => {
  it('keeps risk presentation distinct from routine metrics', () => {
    expect(stockRiskLevel({ outOfStock: 1, lowStock: 4 })).toBe('critical');
    expect(stockRiskLevel({ outOfStock: 0, lowStock: 1 })).toBe('high');
    expect(stockRiskCopyKey({ outOfStock: 1, lowStock: 4 })).toBe('outOfStock');
    expect(stockRiskCopyKey({ outOfStock: 0, lowStock: 1 })).toBe('lowStock');
    expect(expiryRiskLevel([-1, 5])).toBe('critical');
    expect(expiryRiskLevel([5])).toBe('high');
    expect(transferRiskLevel(1)).toBe('medium');
    expect(transferRiskLevel(0)).toBe('low');
  });
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

it('aggregates all eligible lots of a product before low/out-of-stock headlines', () => {
  const rows = [{ ...balance(2), batch_id: 'lot-a', product_id: 'same' }, { ...balance(2), batch_id: 'lot-b', product_id: 'same' }, { ...balance(0), product_id: 'same' }];
  expect(getStockAttention(rows, 3, '2026-11-18')).toEqual({ lowStock: 0, outOfStock: 0, lowStockThreshold: 3 });
  expect(getStockAttention(rows, 5, '2026-11-18')).toEqual({ lowStock: 1, outOfStock: 0, lowStockThreshold: 5 });
});
it('does not make unknown balance information look like a confirmed zero', () => {
  const rows = [{ ...balance(2), product_id: 'same' }, { ...balance(0), product_id: 'same', available_quantity: null }];
  expect(getStockAttention(rows as InventoryBalanceItem[], 5, '2026-11-18').lowStock).toBe(0);
});

it('matches report low-stock semantics by excluding unpriced stock from sellable availability', () => {
  const rows = [{ ...balance(2), product_id: 'same', selling_price: 10 }, { ...balance(5), product_id: 'same', selling_price: null }];
  expect(getStockAttention(rows, 3, '2026-11-18').lowStock).toBe(1);
});

it('does not label positive unpriced inventory as physically out of stock', () => {
  expect(getStockAttention([{ ...balance(5), selling_price: null }], 10, '2026-11-18')).toEqual({ outOfStock: 0, lowStock: 0, lowStockThreshold: 10 });
});
