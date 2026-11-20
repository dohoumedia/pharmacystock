import { supabase } from '@/lib/supabase';
import { validateInvitation, validatePharmacy, type SetupStep } from '../domain/ownerSetup';
import { errorPresentationKey } from '../utils/errorPresentation';
import type { Database } from '@/types/database';

export type Invitation = Database['public']['Tables']['staff_invitations']['Row'];
export type IncomingInvitation = { id: string; organization_name: string; branch_name: string; role_name_en: string; role_name_fr: string; expires_at: string };
export type PharmacyDraft = { name: string; branchName: string; country: string; currency: string; timezone: string; locale: string };
export type InvitationDraft = { email: string; name: string; roleId: string; branchId: string };

export function setupErrorKey(cause: unknown) {
  const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
  const keys: Record<string, string> = {
    EMAIL_VERIFICATION_REQUIRED: 'setup.errors.verifyEmail',
    INVITATION_UNAVAILABLE: 'setup.errors.invitationUnavailable',
    INVITATION_ALREADY_MEMBER: 'setup.errors.alreadyMember',
    INVITATION_PENDING: 'setup.errors.invitationPending',
    SETUP_ALREADY_MEMBER: 'setup.errors.alreadyMember',
    SETUP_INVALID: 'setup.errors.names',
    INVITATION_INVALID: 'setup.errors.assignment',
    AUTH_FORBIDDEN: 'production.error.permissionDenied',
  };
  return keys[message] ?? errorPresentationKey(cause);
}

export async function createPharmacy(draft: PharmacyDraft) {
  const validation = validatePharmacy(draft);
  if (validation) throw new Error(validation);
  const { data, error } = await supabase.rpc('complete_owner_setup', {
    p_name: draft.name.trim(), p_branch_name: draft.branchName.trim(),
    p_country_code: draft.country.trim().toUpperCase() || null,
    p_currency_code: draft.currency.trim().toUpperCase(), p_timezone: new Intl.DateTimeFormat('en', { timeZone: draft.timezone.trim() }).resolvedOptions().timeZone,
    p_locale: draft.locale === 'en' ? 'en' : 'fr',
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.organization_id !== 'string' || typeof data.branch_id !== 'string') throw new Error('SETUP_RESULT_INVALID');
  return { organizationId: data.organization_id, branchId: data.branch_id };
}

export async function inviteStaff(organizationId: string, draft: InvitationDraft) {
  const validation = validateInvitation(draft);
  if (validation) throw new Error(validation);
  const { data, error } = await supabase.rpc('invite_staff', {
    p_organization_id: organizationId, p_email: draft.email.trim().toLowerCase(),
    p_display_name: draft.name.trim(), p_role_id: draft.roleId, p_branch_id: draft.branchId,
  });
  if (error) throw error;
  return data;
}

export async function loadInvitations(organizationId: string) {
  const { data, error } = await supabase.from('staff_invitations').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function loadIncomingInvitations(): Promise<IncomingInvitation[]> {
  const { data, error } = await supabase.rpc('my_staff_invitations');
  if (error) throw error;
  return data;
}

export async function acceptInvitation(invitationId: string) {
  const { data, error } = await supabase.rpc('accept_staff_invitation', { p_invitation_id: invitationId });
  if (error) throw error;
  return data;
}

export async function cancelInvitation(invitationId: string) {
  const { error } = await supabase.rpc('cancel_staff_invitation', { p_invitation_id: invitationId });
  if (error) throw error;
}

export async function loadSetupProgress(organizationId: string, branchId: string): Promise<Record<SetupStep, boolean>> {
  const { data, error } = await supabase.rpc('owner_setup_progress', { p_organization_id: organizationId, p_branch_id: branchId });
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('SETUP_RESULT_INVALID');
  return { pharmacy: data.pharmacy === true, branch: data.branch === true, staff: data.staff === true, supplier: data.supplier === true, product: data.product === true, purchase: data.purchase === true };
}
