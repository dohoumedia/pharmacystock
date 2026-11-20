import { describe, expect, it } from 'vitest';
import { assignedBranches, filterStaff, invitationState, roleDescriptionKey, staffState } from './staffAccess';
import { selectedActiveBranch } from './ownerSetup';
import { mobileItems, visibleNavigation } from '../navigation/items';
import type { Branch, StaffMember } from '../services/organization';
import en from '../i18n/staffReady.en.json';
import fr from '../i18n/staffReady.fr.json';

const member = { membership: { id: 'member', user_id: 'staff', role_id: 'cashier', status: 'active' }, profile: { display_name: 'Marie Doe' }, email: 'marie@example.test', role: null, branchIds: ['east','main'] } as StaffMember;
const branches = [{ id: 'east', status: 'active' }, { id: 'main', status: 'active' }, { id: 'closed', status: 'inactive' }] as Branch[];
describe('staff directory and branch context', () => {
  it.each(['Marie', 'DOE', ' marie@example.test '])('searches name/email: %s', (query) => expect(filterStaff([member], query)).toEqual([member]));
  it('combines status and search and keeps deactivated staff discoverable', () => {
    const suspended = { ...member, membership: { ...member.membership, status: 'suspended' } };
    expect(filterStaff([member,suspended], 'Marie', 'active')).toEqual([member]);
    expect(filterStaff([suspended], '', 'suspended')).toEqual([suspended]);
    expect(filterStaff([member], 'absent')).toEqual([]);
  });
  it('keeps only assigned active branches, even if a manager can read more', () => expect(assignedBranches(branches, member.membership, ['main','closed']).map((branch) => branch.id)).toEqual(['main']));
  it('preserves existing branch.manage operational access without requiring explicit assignments', () => expect(assignedBranches(branches, member.membership, [], ['branch.manage']).map((branch) => branch.id)).toEqual(['east','main']));
  it('preserves an older ordinary-staff RLS-filtered branch snapshot for offline reads', () => expect(assignedBranches(branches.slice(0,1), member.membership).map((branch) => branch.id)).toEqual(['east']));
  it('keeps empty assignment and ambiguous legacy staff-manager snapshots without branch access', () => {
    expect(assignedBranches(branches, member.membership, [])).toEqual([]);
    expect(assignedBranches(branches, member.membership, undefined, ['staff.manage'])).toEqual([]);
  });
  it('removes operational branch context for deactivated memberships', () => expect(assignedBranches(branches, { status: 'suspended' }, ['main'])).toEqual([]));
  it('retains current branch, falls back after removal, and returns null for no access', () => {
    expect(selectedActiveBranch(assignedBranches(branches, member.membership, ['main','east']), 'main')).toBe('main');
    expect(selectedActiveBranch(assignedBranches(branches, member.membership, ['east']), 'main')).toBe('east');
    expect(selectedActiveBranch(assignedBranches(branches, member.membership, []), 'main')).toBeNull();
  });
  it('snapshots role/status/access without mutating or deleting staff identity', () => {
    expect(staffState(member)).toEqual({ role_id: 'cashier', status: 'active', branch_ids: ['east','main'] });
    expect(member.membership.user_id).toBe('staff'); expect(member.profile?.display_name).toBe('Marie Doe');
  });
});
describe('invitation status and role copy', () => {
  it('expires pending invitations at the boundary, preserving accepted/cancelled history', () => {
    for (const status of ['pending','accepted','cancelled']) expect(invitationState({ status, expires_at: '2026-01-01' }, Date.parse('2026-01-01'))).toBe(status === 'pending' ? 'expired' : status);
    expect(invitationState({ status: 'pending', expires_at: '2027-01-01' }, Date.parse('2026-01-01'))).toBe('pending');
  });
  it.each(['OWNER','MANAGER','PHARMACIST','INVENTORY_OFFICER','CASHIER','AUDITOR','custom'])('describes existing role %s', (code) => expect(roleDescriptionKey(code)).toBe(`staffReady.roles.${code}`));
  it('uses configured permissions copy for an existing custom role', () => expect(roleDescriptionKey('CUSTOM_EXISTING')).toBe('staffReady.roles.custom'));
  it('covers matching nonempty EN/FR keys and interpolation fields', () => {
    const flatten = (object: object, prefix = ''): Record<string,string> => Object.fromEntries(Object.entries(object).flatMap(([key,value]) => typeof value === 'string' ? [[prefix+key,value]] : Object.entries(flatten(value,prefix+key+'.'))));
    const english = flatten(en); const french = flatten(fr);
    expect(Object.keys(english).sort()).toEqual(Object.keys(french).sort());
    for (const key of Object.keys(english)) { expect(french[key]?.trim()).toBeTruthy(); expect(french[key]?.match(/{{\w+}}/g) ?? []).toEqual(english[key]?.match(/{{\w+}}/g) ?? []); }
  });
});
describe('shared desktop and mobile navigation uses existing capabilities', () => {
  it('shows staff management to owners/managers, including phone More', () => {
    expect(visibleNavigation(() => true).map((item) => item.href)).toContain('/staff');
    expect(visibleNavigation(() => true, mobileItems).map((item) => item.href)).toContain('/more');
  });
  it('hides management from ordinary staff and sales from read-only roles', () => {
    const hrefs = visibleNavigation((permission) => permission === 'inventory.read').map((item) => item.href);
    expect(hrefs).not.toContain('/staff'); expect(hrefs).not.toContain('/pos'); expect(hrefs).not.toContain('/purchasing'); expect(hrefs).toContain('/branches');
    expect(visibleNavigation(() => false, mobileItems).map((item) => item.href)).toEqual(['/','/more']);
  });
});
