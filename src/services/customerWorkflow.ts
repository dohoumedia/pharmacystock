import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Customer } from './coreCompletion';
import { customerFilterValue, customerPhonePattern, customerMatches, validateCustomer, type CustomerAttempt, type CustomerDraft } from '../domain/customerWorkflow';
type CustomerDatabase = { public: { Tables: { customers: { Row: Customer; Insert: CustomerDraft & { id: string; organization_id: string }; Update: CustomerDraft; Relationships: [] } }; Views: Record<string, never>; Functions: Record<string, never> } };
const db = supabase as unknown as SupabaseClient<CustomerDatabase>;
export const CUSTOMER_PAGE_SIZE = 25;
export async function customerPage(organizationId: string, search = '', status: Customer['status'] = 'active', page = 0) {
  if (!Number.isInteger(page) || page < 0 || search.length > 160) throw new Error('CUSTOMER_INVALID');
  let query = db.from('customers').select('*').eq('organization_id', organizationId).eq('status', status).order('full_name').order('id');
  if (search.trim()) { const value = customerFilterValue(search.trim(), true); const phone = customerPhonePattern(search.trim()); query = query.or(`full_name.ilike.${value},phone.ilike.${value},email.ilike.${value}${phone ? `,phone.match.${JSON.stringify(phone)}` : ''}`); }
  const { data, error } = await query.range(page * CUSTOMER_PAGE_SIZE, (page + 1) * CUSTOMER_PAGE_SIZE);
  if (error) throw error;
  return { items: data.slice(0, CUSTOMER_PAGE_SIZE), hasMore: data.length > CUSTOMER_PAGE_SIZE };
}
export async function customerById(organizationId: string, id: string) {
  const { data, error } = await db.from('customers').select('*').eq('organization_id', organizationId).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function customerDuplicates(organizationId: string, draft: CustomerDraft, excludeId: string): Promise<Customer[]> {
  if (draft.status !== 'active') return [];
  const filters: string[] = [];
  if (draft.phone) filters.push(`phone.eq.${JSON.stringify(draft.phone)}`);
  const phone = draft.phone ? customerPhonePattern(draft.phone, true) : null;
  if (phone) filters.push(`phone.match.${JSON.stringify(phone)}`);
  if (draft.email) filters.push(`email.ilike.${customerFilterValue(draft.email)}`);
  if (!filters.length) return [];
  const { data, error } = await db.from('customers').select('*').eq('organization_id', organizationId).eq('status', 'active').neq('id', excludeId).or(filters.join(',')).order('id').limit(10);
  if (error) throw error;
  return data;
}
/** Reuse the existing primary key and updated_at. An uncertain create checks the
 * same UUID; update recovery never overwrites a newer edit. */
export async function saveCustomerAttempt(attempt: CustomerAttempt): Promise<Customer> {
  const draft = validateCustomer(attempt.draft);
  const existing = await customerById(attempt.organizationId, attempt.id);
  if (existing && customerMatches(existing, draft)) return existing;
  if ((attempt.originalUpdatedAt === null && existing) || (attempt.originalUpdatedAt !== null && (!existing || existing.updated_at !== attempt.originalUpdatedAt))) throw new Error('CUSTOMER_CONFLICT');
  if ((await customerDuplicates(attempt.organizationId, draft, attempt.id)).length) throw new Error('CUSTOMER_DUPLICATE');
  const request = attempt.originalUpdatedAt === null
    ? db.from('customers').insert({ ...draft, id: attempt.id, organization_id: attempt.organizationId }).select('*').single()
    : db.from('customers').update(draft).eq('organization_id', attempt.organizationId).eq('id', attempt.id).eq('updated_at', attempt.originalUpdatedAt).select('*').maybeSingle();
  const { data, error } = await request;
  if (error) {
    if (error.code === '23505') { const accepted = await customerById(attempt.organizationId, attempt.id); if (accepted && customerMatches(accepted, draft)) return accepted; throw new Error('CUSTOMER_DUPLICATE'); }
    throw error;
  }
  if (!data) throw new Error('CUSTOMER_CONFLICT');
  return data;
}
