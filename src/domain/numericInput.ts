/** Decimal quantities/prices follow the existing batch-price input convention.
 * Dot or comma is a decimal separator; grouping and scientific notation are not accepted.
 */
export function parseLocaleNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?(?:\d+|\d*[.,]\d+)$/.test(trimmed)) return null;
  const amount = Number(trimmed.replace(',', '.'));
  return Number.isFinite(amount) ? amount : null;
}

export function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function hasDecimalPrecision(value: number, scale: number): boolean {
  const scaled = value * 10 ** scale;
  return Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) < 0.0000001;
}

/** These database errors abort the complete transaction; uncertain transport errors do not. */
export function isDefinitiveRejection(cause: unknown): boolean {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  return ['23514', '23505', '42501', 'P0002', '22P02', '22007'].includes(code);
}
