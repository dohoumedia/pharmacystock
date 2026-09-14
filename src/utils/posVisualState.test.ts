import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { posPresentationTranslations } from '../i18n/posPresentationTranslations';
import { isPosProductSelected, isPosSaleActionDisabled, posChoiceVisualState, posErrorTranslationKey, posSyncTone } from './posVisualState';

describe('POS visual presentation state', () => {
  it('keeps a selected tab selected while its keyboard focus ring is visible', () => {
    expect(posChoiceVisualState(true, true)).toEqual({ selected: true, focused: true, preserveSelectedBackground: true });
  });

  it('represents cart membership as a selected product state', () => {
    expect(isPosProductSelected(1)).toBe(true);
    expect(isPosProductSelected(0)).toBe(false);
  });

  it('disables sale submission only when the existing sale prerequisites are missing', () => {
    expect(isPosSaleActionDisabled({ busy: false, cartCount: 1, total: 10 })).toBe(false);
    expect(isPosSaleActionDisabled({ busy: false, cartCount: 0, total: 10 })).toBe(true);
    expect(isPosSaleActionDisabled({ busy: false, cartCount: 1, total: 0 })).toBe(true);
    expect(isPosSaleActionDisabled({ busy: true, cartCount: 1, total: 10 })).toBe(true);
  });

  it('communicates offline, pending, and conflict status without changing offline behavior', () => {
    expect(posSyncTone({ isOnline: true, pendingCount: 0, conflictCount: 0 })).toBe('success');
    expect(posSyncTone({ isOnline: false, pendingCount: 1, conflictCount: 0 })).toBe('offline');
    expect(posSyncTone({ isOnline: true, pendingCount: 1, conflictCount: 0 })).toBe('syncing');
    expect(posSyncTone({ isOnline: true, pendingCount: 1, conflictCount: 1 })).toBe('conflict');
  });

  it('keeps the POS presentation labels available in English and French', () => {
    expect(en.pos.search).toBe('Search product, generic, brand or SKU');
    expect(en.pos.estimatedTotal).toBe('Estimated total');
    expect(fr.pos.search).toBe('Rechercher un produit, générique, marque ou SKU');
    expect(fr.pos.estimatedTotal).toBe('Total estimé');
  });

  it('maps known blocked-stock errors and safely localizes unknown errors', () => {
    expect(posErrorTranslationKey('INSUFFICIENT_STOCK')).toBe('pos.insufficientStock');
    expect(posErrorTranslationKey('SELLING_PRICE_REQUIRED')).toBe('pos.sellingPriceRequired');
    expect(posErrorTranslationKey({ code: 'P0001', message: 'SELLING_PRICE_REQUIRED' })).toBe('pos.sellingPriceRequired');
    expect(posErrorTranslationKey('UNEXPECTED_UPSTREAM_RESPONSE')).toBe('pos.actionFailed');
    expect(posErrorTranslationKey('No trusted synchronized price is available.')).toBeNull();
    expect(posPresentationTranslations.en.pos.actionFailed).toBeTruthy();
    expect(posPresentationTranslations.fr.pos.actionFailed).toBeTruthy();
    expect(posPresentationTranslations.en.pos.sellingPriceRequired).toContain('Selling price required');
    expect(posPresentationTranslations.fr.pos.sellingPriceRequired).toContain('Prix de vente requis');
  });
});
