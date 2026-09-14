import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}));

import { receivePurchaseOrder } from './purchasing';

describe('receivePurchaseOrder selling-price contract', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: 'receipt-id', error: null });
  });

  it('includes a positive batch selling price without changing purchase cost', async () => {
    await receivePurchaseOrder({
      purchaseOrderId: 'po-id',
      receiptNumber: 'RCPT-001',
      lines: [{
        purchaseOrderLineId: 'line-id',
        quantity: 2,
        unitCost: 700,
        sellingPrice: 1_000,
        lotNumber: ' LOT-001 ',
        expiryDate: '2027-09-13',
      }],
    });

    expect(rpc).toHaveBeenCalledWith('receive_purchase_order', expect.objectContaining({
      p_lines: [{
        purchase_order_line_id: 'line-id',
        quantity: 2,
        unit_cost: 700,
        selling_price: 1_000,
        lot_number: 'LOT-001',
        expiry_date: '2027-09-13',
      }],
    }));
  });

  it('keeps the current client contract backward compatible when price is omitted', async () => {
    await receivePurchaseOrder({
      purchaseOrderId: 'po-id',
      receiptNumber: 'RCPT-LEGACY',
      lines: [{
        purchaseOrderLineId: 'line-id',
        quantity: 1,
        unitCost: 700,
        lotNumber: 'LOT-LEGACY',
        expiryDate: '2027-09-13',
      }],
    });

    expect(rpc).toHaveBeenCalledWith('receive_purchase_order', expect.objectContaining({
      p_lines: [expect.objectContaining({ selling_price: null })],
    }));
  });

  it.each([0, -1, Number.NaN])('rejects an invalid supplied selling price before the RPC call (%s)', async (sellingPrice) => {
    await expect(receivePurchaseOrder({
      purchaseOrderId: 'po-id',
      receiptNumber: 'RCPT-INVALID',
      lines: [{
        purchaseOrderLineId: 'line-id',
        quantity: 1,
        sellingPrice,
        lotNumber: 'LOT-INVALID',
        expiryDate: '2027-09-13',
      }],
    })).rejects.toThrow('INVALID_BATCH_SELLING_PRICE');
    expect(rpc).not.toHaveBeenCalled();
  });
});
