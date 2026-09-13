/**
 * Presentation-only classification for errors received from services and RPCs.
 * Never render the original message, SQL details, or backend code to users.
 */
export type ErrorPresentationKey =
  | 'production.readModel.noCachedData'
  | 'production.error.duplicateBarcode'
  | 'production.error.duplicateValue'
  | 'production.error.permissionDenied'
  | 'production.error.validation'
  | 'production.error.authentication'
  | 'production.error.temporary'
  | 'production.error.generic';

type ErrorDetails = { code: string; message: string; details: string; hint: string };

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function detailsFor(error: unknown): ErrorDetails {
  if (typeof error === 'string') return { code: error, message: error, details: '', hint: '' };
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown; details?: unknown; hint?: unknown };
    return {
      code: stringValue(candidate.code),
      message: error.message,
      details: stringValue(candidate.details),
      hint: stringValue(candidate.hint),
    };
  }
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    return {
      code: stringValue(candidate.code),
      message: stringValue(candidate.message),
      details: stringValue(candidate.details),
      hint: stringValue(candidate.hint),
    };
  }
  return { code: '', message: '', details: '', hint: '' };
}

function normalized(error: unknown) {
  const details = detailsFor(error);
  return { ...details, all: `${details.code} ${details.message} ${details.details} ${details.hint}`.toLowerCase() };
}

/** Returns a localized presentation key, never an untrusted backend string. */
export function errorPresentationKey(error: unknown): ErrorPresentationKey {
  const { code, all } = normalized(error);

  if (code === 'OFFLINE_CACHE_EMPTY') return 'production.readModel.noCachedData';
  if (code === 'BARCODE_ALREADY_EXISTS' || all.includes('barcode')) return 'production.error.duplicateBarcode';
  if (code === '23505' || all.includes('duplicate key') || all.includes('unique constraint')) return 'production.error.duplicateValue';
  if (
    code === '42501' ||
    code === '403' ||
    all.includes('permission denied') ||
    all.includes('row-level security') ||
    all.includes('not authorized')
  ) return 'production.error.permissionDenied';
  if (
    ['22007', '22P02', '23502', '23503', '23514', 'INVALID_EXPIRY_THRESHOLDS', 'PURCHASE_ORDER_REQUIRES_LINES', 'RECEIPT_REQUIRES_LINES'].includes(code) ||
    all.includes('validation') ||
    all.includes('invalid input') ||
    all.includes('invalid date')
  ) return 'production.error.validation';
  if (
    code === 'AUTH_ERROR' ||
    code === 'AUTH_SESSION_MISSING' ||
    code === '401' ||
    all.includes('invalid login') ||
    all.includes('invalid jwt') ||
    all.includes('session')
  ) return 'production.error.authentication';
  if (
    ['408', '429', '500', '502', '503', '504'].includes(code) ||
    all.includes('failed to fetch') ||
    all.includes('network') ||
    all.includes('timeout') ||
    all.includes('temporarily unavailable')
  ) return 'production.error.temporary';
  return 'production.error.generic';
}
