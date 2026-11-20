import { parseLocaleNumber } from './numericInput';
export function parsePositiveSellingPrice(value: string): number | null {
  const amount = parseLocaleNumber(value);
  return amount !== null && amount > 0 ? amount : null;
}

export function canRemediateMissingBatchPrice({
  hasPermission,
  isOnline,
  usingCachedPermissions,
  sellingPrice,
}: {
  hasPermission: boolean;
  isOnline: boolean;
  usingCachedPermissions: boolean;
  sellingPrice: number | null;
}) {
  return hasPermission && isOnline && !usingCachedPermissions && sellingPrice === null;
}

function errorText(error: unknown) {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  return [candidate.code, candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

export function isSellingPriceRequiredError(error: unknown) {
  return errorText(error).includes('SELLING_PRICE_REQUIRED');
}
