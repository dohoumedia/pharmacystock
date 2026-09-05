import { describe, expect, it } from 'vitest';
import english from './dashboard.en.json';
import french from './dashboard.fr.json';

describe('dashboard presentation copy', () => {
  it('provides the operational dashboard headings and actions in English and French', () => {
    for (const copy of [english.dashboard, french.dashboard]) {
      expect(copy.title).toBeTruthy();
      expect(copy.stockTitle).toBeTruthy();
      expect(copy.expiryTitle).toBeTruthy();
      expect(copy.transferTitle).toBeTruthy();
      expect(copy.salesTitle).toBeTruthy();
      expect(copy.quickActions).toBeTruthy();
      expect(copy.quickSell).toBeTruthy();
      expect(copy.quickSellDescription).toBeTruthy();
      expect(copy.quickStockDescription).toBeTruthy();
    }
  });

  it('keeps risk and attention copy distinct from routine sales copy', () => {
    expect(english.dashboard.outOfStock).toContain('out of stock');
    expect(french.dashboard.expiryRisk).toContain('à risque');
    expect(english.dashboard.salesTitle).not.toEqual(english.dashboard.stockTitle);
  });
});
