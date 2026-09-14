import { isSellingPriceRequiredError } from '../domain/batchPricing';

export type PosSyncTone = 'success' | 'offline' | 'syncing' | 'conflict';

/** Presentation-only state for POS choice tabs. Focus adds a ring without replacing selection. */
export function posChoiceVisualState(selected: boolean, focused: boolean) {
  return { selected, focused, preserveSelectedBackground: selected };
}

export function isPosSaleActionDisabled({ busy, cartCount, total }: { busy: boolean; cartCount: number; total: number }) {
  return busy || cartCount === 0 || total <= 0;
}

export function posSyncTone({ isOnline, pendingCount, conflictCount }: { isOnline: boolean; pendingCount: number; conflictCount: number }): PosSyncTone {
  if (conflictCount > 0) return 'conflict';
  if (!isOnline) return 'offline';
  if (pendingCount > 0) return 'syncing';
  return 'success';
}

export function isPosProductSelected(cartQuantity: number) {
  return cartQuantity > 0;
}

/** Maps stable server error codes for display only; it never changes sale handling. */
function errorText(error: unknown) {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  return [candidate.code, candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

export function posErrorTranslationKey(error: unknown): 'pos.insufficientStock' | 'pos.sellingPriceRequired' | 'pos.actionFailed' | null {
  const text = errorText(error);
  if (text.includes('INSUFFICIENT_STOCK')) return 'pos.insufficientStock';
  if (isSellingPriceRequiredError(error)) return 'pos.sellingPriceRequired';
  return /^[A-Z][A-Z0-9_]+$/.test(text) ? 'pos.actionFailed' : null;
}
