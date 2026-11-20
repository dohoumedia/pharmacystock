import { hasDecimalPrecision, parseLocaleNumber } from './numericInput';
export const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export function validTimezone(value: string): boolean {
  if (!value || value !== value.trim() || (value !== 'UTC' && !value.includes('/'))) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return true; } catch { return false; }
}
export function effectiveTimezone(organization?: string | null, branch?: string | null): string {
  return branch && validTimezone(branch) ? branch : organization && validTimezone(organization) ? organization : 'UTC';
}
export function validCurrency(value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value)) return false;
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (intl.supportedValuesOf) return intl.supportedValuesOf('currency').includes(value);
  try { new Intl.NumberFormat('en', { style: 'currency', currency: value }).format(0); return true; } catch { return false; }
}
export function configuredCurrency(value?: string | null): string { return value && validCurrency(value) ? value : ''; }
export function parseLowStockThreshold(value: string): number {
  const number = parseLocaleNumber(value);
  if (number === null || number < 0 || number >= 1e14 || !hasDecimalPrecision(number, 4)) throw new Error('SETTINGS_THRESHOLD_INVALID');
  return number;
}
export function defaultPaymentMethod(value: unknown, available: readonly PaymentMethod[] = PAYMENT_METHODS): PaymentMethod | null {
  if (available.includes(value as PaymentMethod)) return value as PaymentMethod;
  return available.includes('CASH') ? 'CASH' : available[0] ?? null;
}
export function validateBusiness(input: { name: string; timezone: string; currency_code: string; country_code: string | null }) {
  if (!input.name.trim() || input.name.trim().length > 160) throw new Error('SETTINGS_NAME_INVALID');
  if (!validTimezone(input.timezone)) throw new Error('SETTINGS_TIMEZONE_INVALID');
  if (!validCurrency(input.currency_code)) throw new Error('SETTINGS_CURRENCY_INVALID');
  if (input.country_code && !/^[A-Z]{2}$/.test(input.country_code)) throw new Error('SETTINGS_COUNTRY_INVALID');
}
export function settingsErrorKey(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String((cause as { message?: string })?.message ?? '');
  const code = ['SETTINGS_LAST_BRANCH','SETTINGS_NAME_INVALID','SETTINGS_TIMEZONE_INVALID','SETTINGS_CURRENCY_INVALID','SETTINGS_CURRENCY_LOCKED','SETTINGS_CURRENCY_MISMATCH','SETTINGS_THRESHOLD_INVALID','SETTINGS_COUNTRY_INVALID','SETTINGS_EMAIL_INVALID','SETTINGS_REFRESH_REQUIRED','INVALID_EXPIRY_THRESHOLDS'].find(code => message.includes(code));
  return code ? `settingsReady.errors.${code}` : 'settingsReady.saveFailed';
}
