import { describe, expect, it } from 'vitest';
import en from '../i18n/production.en.json';
import fr from '../i18n/production.fr.json';
import { posPresentationTranslations } from '../i18n/posPresentationTranslations';
import { canRemediateMissingBatchPrice, isSellingPriceRequiredError, parsePositiveSellingPrice } from './batchPricing';

describe('batch selling-price presentation rules', () => {
  it('accepts finite positive decimal values and rejects missing or invalid values', () => {
    expect(parsePositiveSellingPrice('1500')).toBe(1500);
    expect(parsePositiveSellingPrice('1500.50')).toBe(1500.5);
    expect(parsePositiveSellingPrice('1500,50')).toBe(1500.5);
    expect(parsePositiveSellingPrice('')).toBeNull();
    expect(parsePositiveSellingPrice('0')).toBeNull();
    expect(parsePositiveSellingPrice('-1')).toBeNull();
    expect(parsePositiveSellingPrice('Infinity')).toBeNull();
    expect(parsePositiveSellingPrice('1e3')).toBeNull();
  });

  it('allows remediation only for an unpriced batch with current online update permission', () => {
    expect(canRemediateMissingBatchPrice({ hasPermission: true, isOnline: true, usingCachedPermissions: false, sellingPrice: null })).toBe(true);
    expect(canRemediateMissingBatchPrice({ hasPermission: false, isOnline: true, usingCachedPermissions: false, sellingPrice: null })).toBe(false);
    expect(canRemediateMissingBatchPrice({ hasPermission: true, isOnline: false, usingCachedPermissions: false, sellingPrice: null })).toBe(false);
    expect(canRemediateMissingBatchPrice({ hasPermission: true, isOnline: true, usingCachedPermissions: true, sellingPrice: null })).toBe(false);
    expect(canRemediateMissingBatchPrice({ hasPermission: true, isOnline: true, usingCachedPermissions: false, sellingPrice: 1500 })).toBe(false);
  });

  it('recognizes the stable server failure without exposing unrelated errors', () => {
    expect(isSellingPriceRequiredError(new Error('SELLING_PRICE_REQUIRED'))).toBe(true);
    expect(isSellingPriceRequiredError({ code: 'P0001', message: 'SELLING_PRICE_REQUIRED' })).toBe(true);
    expect(isSellingPriceRequiredError({ code: '23514', message: 'INVALID_BATCH_SELLING_PRICE' })).toBe(false);
  });

  it('provides required pricing guidance in English and French', () => {
    expect(en.production.batchView.sellingPriceRequired).toBeTruthy();
    expect(fr.production.batchView.sellingPriceRequired).toBeTruthy();
    expect(en.production.purchasingView.sellingPriceRequired).toBeTruthy();
    expect(fr.production.purchasingView.sellingPriceRequired).toBeTruthy();
    expect(posPresentationTranslations.en.pos.sellingPriceRequired).toContain('Selling price required');
    expect(posPresentationTranslations.fr.pos.sellingPriceRequired).toContain('Prix de vente requis');
  });
});
