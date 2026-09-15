import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn(() => ({ maybeSingle }));
  const is = vi.fn(() => ({ select }));
  const eqBranch = vi.fn(() => ({ is }));
  const eqOrganization = vi.fn(() => ({ eq: eqBranch }));
  const eqId = vi.fn(() => ({ eq: eqOrganization }));
  const update = vi.fn(() => ({ eq: eqId }));
  const inBalances = vi.fn();
  const eqBalanceBranch = vi.fn(() => ({ in: inBalances }));
  const eqBalanceOrganization = vi.fn(() => ({ eq: eqBalanceBranch }));
  const selectBalances = vi.fn(() => ({ eq: eqBalanceOrganization }));
  const from = vi.fn((table: string) => (table === 'inventory_balances' ? { select: selectBalances } : { update }));
  return {
    maybeSingle,
    select,
    is,
    eqBranch,
    eqOrganization,
    eqId,
    update,
    inBalances,
    eqBalanceBranch,
    eqBalanceOrganization,
    selectBalances,
    from,
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

import { loadBatchStockBalances, setMissingBatchSellingPrice } from './catalog';

describe('setMissingBatchSellingPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'batch-id', selling_price: 1500 }, error: null });
  });

  it('updates only the missing price in the authorized tenant and branch row', async () => {
    await setMissingBatchSellingPrice({ batchId: 'batch-id', organizationId: 'org-id', branchId: 'branch-id', sellingPrice: 1500 });

    expect(mocks.from).toHaveBeenCalledWith('batches');
    expect(mocks.update).toHaveBeenCalledWith({ selling_price: 1500 });
    expect(mocks.eqId).toHaveBeenCalledWith('id', 'batch-id');
    expect(mocks.eqOrganization).toHaveBeenCalledWith('organization_id', 'org-id');
    expect(mocks.eqBranch).toHaveBeenCalledWith('branch_id', 'branch-id');
    expect(mocks.is).toHaveBeenCalledWith('selling_price', null);
  });

  it.each([0, -1, Number.NaN])('rejects invalid pricing before issuing an update (%s)', async (sellingPrice) => {
    await expect(setMissingBatchSellingPrice({ batchId: 'batch-id', organizationId: 'org-id', branchId: 'branch-id', sellingPrice })).rejects.toThrow('INVALID_BATCH_SELLING_PRICE');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not silently reprice a batch that is no longer unpriced', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(setMissingBatchSellingPrice({ batchId: 'batch-id', organizationId: 'org-id', branchId: 'branch-id', sellingPrice: 1500 })).rejects.toThrow('BATCH_SELLING_PRICE_ALREADY_SET');
  });
});

describe('loadBatchStockBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads only the derived balances for visible batches in the selected organization and branch', async () => {
    mocks.inBalances.mockResolvedValue({
      data: [{ batch_id: 'batch-a', on_hand_quantity: 12, reserved_quantity: 2, available_quantity: 10 }],
      error: null,
    });

    await expect(loadBatchStockBalances('org-id', 'branch-id', ['batch-a'])).resolves.toEqual([
      { batch_id: 'batch-a', on_hand_quantity: 12, reserved_quantity: 2, available_quantity: 10 },
    ]);

    expect(mocks.from).toHaveBeenCalledWith('inventory_balances');
    expect(mocks.selectBalances).toHaveBeenCalledWith('batch_id,on_hand_quantity,reserved_quantity,available_quantity');
    expect(mocks.eqBalanceOrganization).toHaveBeenCalledWith('organization_id', 'org-id');
    expect(mocks.eqBalanceBranch).toHaveBeenCalledWith('branch_id', 'branch-id');
    expect(mocks.inBalances).toHaveBeenCalledWith('batch_id', ['batch-a']);
  });

  it('does not query or invent zero quantities when there are no visible batches', async () => {
    await expect(loadBatchStockBalances('org-id', 'branch-id', [])).resolves.toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
