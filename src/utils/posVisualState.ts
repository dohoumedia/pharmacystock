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
export function posErrorTranslationKey(error: string): 'pos.insufficientStock' | 'pos.actionFailed' | null {
  if (error.includes('INSUFFICIENT_STOCK')) return 'pos.insufficientStock';
  return /^[A-Z][A-Z0-9_]+$/.test(error) ? 'pos.actionFailed' : null;
}
