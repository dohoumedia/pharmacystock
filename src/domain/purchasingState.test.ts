import { describe, expect, it } from 'vitest';
import { filterPurchaseOrders, purchasingLayout, purchasingMutationAllowed } from './purchasingState';
import type { PurchaseOrderWithSupplier } from '@/services/purchasing';

const order = (status: PurchaseOrderWithSupplier['status'], po = 'PO-100'): PurchaseOrderWithSupplier => ({
  id: po, organization_id: 'org', branch_id: 'branch', supplier_id: 'supplier', supplier_name: 'Central Supplier',
  po_number: po, status, ordered_at: null, expected_at: null, notes: null, created_by: 'user', idempotency_key: null,
  created_at: '2026-08-23T00:00:00Z', updated_at: '2026-08-23T00:00:00Z',
});

describe('responsive purchasing state', () => {
  it('uses task cards below desktop and a dense table on desktop', () => {
    expect(purchasingLayout(390)).toBe('cards');
    expect(purchasingLayout(768)).toBe('cards');
    expect(purchasingLayout(1024)).toBe('table');
  });

  it('requires online, current permissions for mutations', () => {
    expect(purchasingMutationAllowed(true, true, false)).toBe(true);
    expect(purchasingMutationAllowed(false, true, false)).toBe(false);
    expect(purchasingMutationAllowed(true, true, true)).toBe(false);
    expect(purchasingMutationAllowed(true, false, false)).toBe(false);
  });

  it('filters by receiving state and PO or supplier text', () => {
    const orders = [order('ordered'), order('partially_received', 'PO-200'), order('received', 'PO-300')];
    expect(filterPurchaseOrders(orders, '', 'partial').map((item) => item.po_number)).toEqual(['PO-200']);
    expect(filterPurchaseOrders(orders, 'central', 'all')).toHaveLength(3);
    expect(filterPurchaseOrders(orders, '300', 'open')).toHaveLength(0);
  });
});
