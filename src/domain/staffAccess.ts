import type { Branch, StaffMember } from '../services/organization';

/** Presentation/search only; the existing role permissions and database remain authoritative. */
export function filterStaff(staff: StaffMember[], query: string, status = 'all') {
  const needle = query.trim().toLocaleLowerCase();
  return staff.filter((member) => (status === 'all' || member.membership.status === status)
    && [member.profile?.display_name, member.email, member.membership.user_id].some((value) => value?.toLocaleLowerCase().includes(needle)));
}

export function assignedBranches(branches: Branch[], membership: { status: string } | null, ids?: string[], permissions: string[] = []) {
  if (membership?.status !== 'active') return [];
  // Legacy ordinary-staff snapshots already contain only RLS-visible assigned
  // branches. Preserve those read hints offline. A staff manager's broader legacy
  // directory snapshot needs an explicit assignment refresh unless branch.manage applies.
  return branches.filter((branch) => branch.status === 'active' && (permissions.includes('branch.manage')
    || (ids ? ids.includes(branch.id) : !permissions.includes('staff.manage'))));
}

export function staffState(member: StaffMember) {
  return { role_id: member.membership.role_id, status: member.membership.status, branch_ids: [...member.branchIds].sort() };
}

export function invitationState(item: { status: string; expires_at: string }, now = Date.now()) {
  return item.status === 'pending' && Date.parse(item.expires_at) <= now ? 'expired' : item.status;
}

export function roleDescriptionKey(code?: string) {
  return `staffReady.roles.${['OWNER', 'MANAGER', 'PHARMACIST', 'INVENTORY_OFFICER', 'CASHIER', 'AUDITOR'].includes(code ?? '') ? code : 'custom'}`;
}
