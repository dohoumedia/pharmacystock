import { describe, expect, it } from 'vitest';
import { customerDraft, customerPhonePattern, customerMatches, customerFilterValue, validateCustomer } from './customerWorkflow';
import type { Customer } from '../services/coreCompletion';
const draft = { ...customerDraft(), full_name: ' Client ', phone: '+1 (514) 555-0123', email: 'Client@example.test', notes: ' operational ' };
describe('minimal existing customer identity', () => {
  it('trims boundaries without merging distinct identities or changing email case', () => { expect(validateCustomer(draft)).toMatchObject({ full_name: 'Client', phone: '+1 (514) 555-0123', email: 'Client@example.test', notes: 'operational' }); });
  it('permits a name-only profile and preserves default language/status', () => { expect(validateCustomer({ ...customerDraft(undefined, 'fr'), full_name: 'Client' })).toMatchObject({ phone: null, email: null, notes: null, preferred_locale: 'fr', status: 'active' }); });
  it.each([['full_name', '', 'NAME'], ['full_name', 'x'.repeat(161), 'NAME'], ['phone', 'abc', 'PHONE'], ['phone', '1234', 'PHONE'], ['phone', '1'.repeat(21), 'PHONE'], ['email', 'bad@', 'EMAIL'], ['notes', 'x'.repeat(2001), 'NOTES']])('validates %s', (field, value, code) => { expect(() => validateCustomer({ ...draft, [field]: value })).toThrow(`CUSTOMER_${code}`); });
  it('recognizes accepted retries using only editable profile fields', () => { const clean = validateCustomer(draft); const current = { ...clean, id: 'same', updated_at: 'later', marketing_consent: true } as Customer; expect(customerMatches(current, clean)).toBe(true); expect(customerMatches(current, { ...clean, full_name: 'Other' })).toBe(false); });
  it('finds formatted phone digits without guessing country or ignoring additional digits', () => { const pattern = new RegExp(customerPhonePattern('15145550123', true)!); expect(pattern.test('+1 (514) 555-0123')).toBe(true); expect(pattern.test('+33 15145550123')).toBe(false); expect(pattern.test('5145550123')).toBe(false); expect(customerPhonePattern('bad')).toBeNull(); });
  it('quotes punctuation and makes wildcard search literal', () => { const encoded = customerFilterValue('A,B_("x")%*', true); expect(JSON.parse(encoded)).toBe('%A,B\\_("x")\\%\\*%'); });
});
