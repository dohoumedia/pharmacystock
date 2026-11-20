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
  email?: string | null;
  accessChangedAt?: string | null;
};

export type OrganizationContextData = {
  branches: Branch[];
  membership: Membership | null;
  role: Role | null;
  permissions: string[];
  branchIds?: string[];
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
    .eq('status', 'active')
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
  let branchIds: string[] = [];

  if (membership) {
    const access = await supabase.from('branch_memberships').select('branch_id').eq('organization_membership_id', membership.id);
    if (access.error) throw access.error;
    branchIds = access.data.map((item) => item.branch_id);
  }

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
    branches: branchesResult.data,
    membership,
    role,
    permissions,
    branchIds,
  };
}

export async function loadStaff(organizationId: string): Promise<StaffMember[]> {
  const { data: memberships, error } = await supabase
    .from('organization_memberships')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at');
  if (error) throw error;
  if (memberships.length === 0) return [];

  const userIds = memberships.map((membership) => membership.user_id);
  const roleIds = memberships.flatMap((membership) => (membership.role_id ? [membership.role_id] : []));
  const membershipIds = memberships.map((membership) => membership.id);

  const profilesResult = await supabase.from('profiles').select('*').in('user_id', userIds);
  if (profilesResult.error) throw profilesResult.error;

  let roles: Role[] = [];
  if (roleIds.length > 0) {
    const rolesResult = await supabase.from('roles').select('*').in('id', roleIds);
    if (rolesResult.error) throw rolesResult.error;
    roles = rolesResult.data;
  }

  const branchesResult = await supabase
    .from('branch_memberships')
    .select('*')
    .in('organization_membership_id', membershipIds);
  if (branchesResult.error) throw branchesResult.error;
  const details = await supabase.rpc('staff_directory_details', { p_organization_id: organizationId });
  if (details.error) throw details.error;

  const profilesByUser = new Map(profilesResult.data.map((profile) => [profile.user_id, profile]));
  const rolesById = new Map(roles.map((role) => [role.id, role]));

  return memberships.map((membership) => ({
    membership,
    profile: profilesByUser.get(membership.user_id) ?? null,
    role: membership.role_id ? rolesById.get(membership.role_id) ?? null : null,
    email: details.data.find((item) => item.user_id === membership.user_id)?.email ?? null,
    accessChangedAt: details.data.find((item) => item.user_id === membership.user_id)?.access_changed_at ?? membership.updated_at,
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

export async function loadMembershipUnavailable() {
  const { data, error } = await supabase.rpc('my_membership_unavailable');
  if (error) throw error;
  return data;
}

export async function createBranch(input: Database['public']['Tables']['branches']['Insert'] & { id: string }) {
  const { data, error } = await supabase.rpc('create_branch_with_access', {
    p_branch_id: input.id, p_organization_id: input.organization_id, p_name: input.name.trim(),
    p_code: input.code?.trim() || null, p_city: input.city?.trim() || null, p_phone: input.phone?.trim() || null,
  });
  if (error) throw error;
  if (!data) throw new Error('BRANCH_RESULT_INVALID');
  return { id: data };
}

export type { Organization, Branch, Membership, Role, Profile, StaffMember };
