import { supabase } from '@/lib/supabase';
import { staffState } from '../domain/staffAccess';
import type { StaffMember } from './organization';

export async function maintainStaff(member: StaffMember, next: ReturnType<typeof staffState>) {
  const { error } = await supabase.rpc('maintain_staff_access', {
    p_membership_id: member.membership.id, p_expected: staffState(member), p_next: next,
  });
  if (error) throw error;
}

export function staffErrorKey(cause: unknown) {
  const message = cause instanceof Error ? cause.message : cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
  return ({ STAFF_ACCESS_CHANGED: 'staffReady.errors.changed', STAFF_OWNER_PROTECTED: 'staffReady.protected', STAFF_ACCESS_INVALID: 'setup.errors.assignment' } as Record<string, string>)[message];
}
