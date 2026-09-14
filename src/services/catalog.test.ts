import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn(() => ({ maybeSingle }));
  const is = vi.fn(() => ({ select }));
  const eqBranch = vi.fn(() => ({ is }));
  const eqOrganization = vi.fn(() => ({ eq: eqBranch }));
  const eqId = vi.fn(() => ({ eq: eqOrganization }));
  const update = vi.fn(() => ({ eq: eqId }));
  const from = vi.fn(() => ({ update }));
  return { maybeSingle, select, is, eqBranch, eqOrganization, eqId, update, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

import { setMissingBatchSellingPrice } from './catalog';

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
