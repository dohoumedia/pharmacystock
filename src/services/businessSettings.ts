import { supabase } from '../lib/supabase';
import { validateBusiness, validTimezone } from '../domain/businessSettings';
import type { Branch, Organization } from './organization';
export type BusinessDraft = Pick<Organization, 'name' | 'country_code' | 'currency_code' | 'timezone'>;
export async function saveBusinessProfile(organizationId: string, input: BusinessDraft): Promise<Organization> {
  const clean = { ...input, name: input.name.trim(), timezone: input.timezone.trim(), currency_code: input.currency_code.trim().toUpperCase(), country_code: input.country_code?.trim().toUpperCase() || null };
  validateBusiness(clean);
  const { data, error } = await supabase.from('organizations').update(clean).eq('id', organizationId).select('*').single();
  if (error) throw error;
  return data;
}
export type BranchDraft = Pick<Branch, 'name' | 'address_line1' | 'address_line2' | 'city' | 'phone' | 'email' | 'timezone' | 'status'>;
export async function saveBranchConfiguration(organizationId: string, branchId: string, input: BranchDraft): Promise<Branch> {
  const clean = { ...input, name: input.name.trim(), timezone: input.timezone?.trim() || null, email: input.email?.trim() || null };
  if (!clean.name || clean.name.length > 160) throw new Error('SETTINGS_NAME_INVALID');
  if (clean.timezone && !validTimezone(clean.timezone)) throw new Error('SETTINGS_TIMEZONE_INVALID');
  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) throw new Error('SETTINGS_EMAIL_INVALID');
  if (!['active', 'inactive'].includes(clean.status)) throw new Error('SETTINGS_NAME_INVALID');
  const { data, error } = await supabase.from('branches').update(clean).eq('organization_id', organizationId).eq('id', branchId).select('*').single();
  if (error) throw error;
  return data;
}
