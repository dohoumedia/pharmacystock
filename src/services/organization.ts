import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type Organization = Database['public']['Tables']['organizations']['Row'];
type Branch = Database['public']['Tables']['branches']['Row'];
type Membership = Database['public']['Tables']['organization_memberships']['Row'];
type Role = Database['public']['Tables']['roles']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

type StaffMember = {
  membership: Membership;
  profile: Profile | null;
  role: Role | null;
  branchIds: string[];
};

export type OrganizationContextData = {
  organizations: Organization[];
  branches: Branch[];
  membership: Membership | null;
  role: Role | null;
  permissions: string[];
};

export async function loadOrganizationsForUser(userId: string): Promise<Organization[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (membershipError) throw membershipError;
  const organizationIds = memberships.map((membership) => membership.organization_id);
  if (organizationIds.length === 0) return [];

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .in('id', organizationIds)
    .order('name');

  if (error) throw error;
  return data;
}

export async function loadOrganizationContext(
  organizationId: string,
  userId: string,
): Promise<OrganizationContextData> {
  const [branchesResult, membershipResult] = await Promise.all([
    supabase.from('branches').select('*').eq('organization_id', organizationId).order('name'),
    supabase
      .from('organization_memberships')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
  ]);

  if (branchesResult.error) throw branchesResult.error;
  if (membershipResult.error) throw membershipResult.error;

  const membership = membershipResult.data;
  let role: Role | null = null;
  let permissions: string[] = [];

  if (membership?.role_id) {
    const [roleResult, permissionResult] = await Promise.all([
      supabase.from('roles').select('*').eq('id', membership.role_id).maybeSingle(),
      supabase.from('role_permissions').select('permission_code').eq('role_id', membership.role_id),
    ]);
    if (roleResult.error) throw roleResult.error;
    if (permissionResult.error) throw permissionResult.error;
    role = roleResult.data;
    permissions = permissionResult.data.map((item) => item.permission_code);
  }

  return {
    organizations: [],
    branches: branchesResult.data,
    membership,
    role,
    permissions,
  };
}

export async function loadStaff(organizationId: string): Promise<StaffMember[]> {
  const { data: memberships, error } = await supabase
    .from('organization_memberships')
    .select('*')
    .eq('organization_id', organizationId)
    .neq('status', 'revoked')
    .order('created_at');
  if (error) throw error;

  if (memberships.length === 0) return [];
  const userIds = memberships.map((membership) => membership.user_id);
  const roleIds = memberships.flatMap((membership) => (membership.role_id ? [membership.role_id] : []));
  const membershipIds = memberships.map((membership) => membership.id);

  const [profilesResult, rolesResult, branchesResult] = await Promise.all([
    supabase.from('profiles').select('*').in('user_id', userIds),
    roleIds.length > 0 ? supabase.from('roles').select('*').in('id', roleIds) : Promise.resolve({ data: [] as Role[], error: null }),
    supabase.from('branch_memberships').select('*').in('organization_membership_id', membershipIds),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (rolesResult.error) throw rolesResult.error;
  if (branchesResult.error) throw branchesResult.error;

  const profilesByUser = new Map(profilesResult.data.map((profile) => [profile.user_id, profile]));
  const rolesById = new Map(rolesResult.data.map((role) => [role.id, role]));

  return memberships.map((membership) => ({
    membership,
    profile: profilesByUser.get(membership.user_id) ?? null,
    role: membership.role_id ? rolesById.get(membership.role_id) ?? null : null,
    branchIds: branchesResult.data
      .filter((item) => item.organization_membership_id === membership.id)
      .map((item) => item.branch_id),
  }));
}

export async function loadAssignableRoles(organizationId: string): Promise<Role[]> {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
    .order('code');
  if (error) throw error;
  return data;
}

export async function updateStaffMembership(
  membershipId: string,
  patch: Pick<Membership, 'role_id' | 'status'>,
) {
  const { error } = await supabase
    .from('organization_memberships')
    .update({ role_id: patch.role_id, status: patch.status })
    .eq('id', membershipId);
  if (error) throw error;
}

export async function replaceStaffBranches(
  membershipId: string,
  currentBranchIds: string[],
  nextBranchIds: string[],
) {
  const remove = currentBranchIds.filter((id) => !nextBranchIds.includes(id));
  const add = nextBranchIds.filter((id) => !currentBranchIds.includes(id));

  if (remove.length > 0) {
    const { error } = await supabase
      .from('branch_memberships')
      .delete()
      .eq('organization_membership_id', membershipId)
      .in('branch_id', remove);
    if (error) throw error;
  }

  if (add.length > 0) {
    const { error } = await supabase
      .from('branch_memberships')
      .insert(add.map((branchId) => ({ branch_id: branchId, organization_membership_id: membershipId })));
    if (error) throw error;
  }
}

export async function createBranch(input: Database['public']['Tables']['branches']['Insert']) {
  const { data, error } = await supabase.from('branches').insert(input).select('*').single();
  if (error) throw error;
  return data;
}

export type { Organization, Branch, Membership, Role, Profile, StaffMember };
