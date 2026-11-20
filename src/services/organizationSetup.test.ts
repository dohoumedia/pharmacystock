import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBranch } from './organization';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => vi.clearAllMocks());
describe('branch creation after setup', () => {
  it('creates the branch and creator access through one transaction with the same identity on retry', async () => {
    mocks.rpc.mockResolvedValue({ data: 'stable-branch-id', error: null });
    const draft = { id: 'stable-branch-id', organization_id: 'pharmacy', name: ' North ', city: ' Cotonou ' };
    await expect(createBranch(draft)).resolves.toEqual({ id: 'stable-branch-id' });
    await createBranch(draft);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.rpc).toHaveBeenCalledWith('create_branch_with_access', { p_branch_id: 'stable-branch-id', p_organization_id: 'pharmacy', p_name: 'North', p_code: null, p_city: 'Cotonou', p_phone: null });
  });
  it('propagates a failed create for the branch form error state', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'network timeout' } });
    await expect(createBranch({ id: 'stable', organization_id: 'pharmacy', name: 'North' })).rejects.toEqual({ message: 'network timeout' });
  });
});
