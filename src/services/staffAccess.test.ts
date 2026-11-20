import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maintainStaff, staffErrorKey } from './staffAccess';
import { staffState } from '../domain/staffAccess';
import type { StaffMember } from './organization';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mock.rpc } }));
const member = { membership: { id: 'member', user_id: 'actor', role_id: 'cashier', status: 'active' }, branchIds: ['main'] } as StaffMember;
beforeEach(() => vi.clearAllMocks());
describe('atomic staff maintenance', () => {
  it.each([
    { role_id: 'manager', status: 'active', branch_ids: ['main'] },
    { role_id: 'cashier', status: 'active', branch_ids: ['east','main'] },
    { role_id: 'cashier', status: 'active', branch_ids: ['east'] },
    { role_id: 'cashier', status: 'suspended', branch_ids: ['main'] },
  ])('retries the exact observed and desired state for %j', async (next) => {
    mock.rpc.mockResolvedValueOnce({ error: { message: 'network interrupted' } }).mockResolvedValue({ error: null });
    await expect(maintainStaff(member, next)).rejects.toEqual({ message: 'network interrupted' });
    await maintainStaff(member, next);
    expect(mock.rpc.mock.calls[0]).toEqual(mock.rpc.mock.calls[1]);
    expect(mock.rpc).toHaveBeenLastCalledWith('maintain_staff_access', { p_membership_id: 'member', p_expected: staffState(member), p_next: next });
  });
  it('reactivates the same membership identity and assignment', async () => {
    mock.rpc.mockResolvedValue({ error: null }); const suspended = { ...member, membership: { ...member.membership, status: 'suspended' } };
    await maintainStaff(suspended, { ...staffState(suspended), status: 'active' });
    expect(mock.rpc.mock.calls[0]?.[1].p_membership_id).toBe('member'); expect(mock.rpc.mock.calls[0]?.[1].p_expected.status).toBe('suspended');
  });
  it.each(['STAFF_ACCESS_CHANGED','STAFF_OWNER_PROTECTED','STAFF_ACCESS_INVALID'])('localizes product rejection %s', (message) => expect(staffErrorKey({ message })).toBeTruthy());
});
