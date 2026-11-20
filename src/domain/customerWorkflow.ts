import type { Customer } from '../services/coreCompletion';
export type CustomerDraft = Pick<Customer, 'full_name' | 'phone' | 'email' | 'preferred_locale' | 'notes' | 'status'>;
export type CustomerAttempt = { id: string; organizationId: string; originalUpdatedAt: string | null; draft: CustomerDraft };
export function customerDraft(customer?: Customer, locale = 'en'): CustomerDraft {
  return { full_name: customer?.full_name ?? '', phone: customer?.phone ?? null, email: customer?.email ?? null, preferred_locale: customer?.preferred_locale ?? (locale === 'fr' ? 'fr' : 'en'), notes: customer?.notes ?? null, status: customer?.status ?? 'active' };
}
export function validateCustomer(draft: CustomerDraft): CustomerDraft {
  const clean = { ...draft, full_name: draft.full_name.trim(), phone: draft.phone?.trim() || null, email: draft.email?.trim() || null, notes: draft.notes?.trim() || null };
  if (!clean.full_name || clean.full_name.length > 160 || /[\u0000-\u001f]/.test(clean.full_name)) throw new Error('CUSTOMER_NAME');
  if (clean.phone && (clean.phone.length > 40 || !/^\+?[0-9 ()\-.]+$/.test(clean.phone) || clean.phone.replace(/\D/g, '').length < 5 || clean.phone.replace(/\D/g, '').length > 20)) throw new Error('CUSTOMER_PHONE');
  if (clean.email && (clean.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email))) throw new Error('CUSTOMER_EMAIL');
  if (clean.notes && (clean.notes.length > 2000 || clean.notes.includes('\0'))) throw new Error('CUSTOMER_NOTES');
  if (!['en', 'fr'].includes(clean.preferred_locale) || !['active', 'archived'].includes(clean.status)) throw new Error('CUSTOMER_INVALID');
  return clean;
}
export function customerMatches(customer: Customer, draft: CustomerDraft) {
  return (Object.keys(draft) as (keyof CustomerDraft)[]).every(key => customer[key] === draft[key]);
}
// PostgREST quoted values protect punctuation; LIKE metacharacters stay literal.
export function customerFilterValue(value: string, contains = false): string {
  const literal = value.replace(/[\\%_*]/g, '\\$&');
  return JSON.stringify(contains ? `%${literal}%` : literal);
}
export function customerErrorKey(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String((cause as { message?: string })?.message ?? '');
  const code = ['CUSTOMER_NAME', 'CUSTOMER_PHONE', 'CUSTOMER_EMAIL', 'CUSTOMER_NOTES', 'CUSTOMER_INVALID', 'CUSTOMER_CONFLICT', 'CUSTOMER_DUPLICATE'].find(code => message.includes(code));
  return code ? `customersReady.errors.${code}` : 'customersReady.saveFailed';
}

/** Ignore phone formatting only. Never infer a country code or merge identities. */
export function customerPhonePattern(value: string, exact = false): string | null {
  if (!/^\+?[0-9 ()\-.]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < (exact ? 5 : 3) || digits.length > 20) return null;
  const separators = '[+(). -]*';
  const pattern = separators + digits.split('').join(separators) + separators;
  return exact ? `^${pattern}$` : pattern;
}
