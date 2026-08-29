import { describe, expect, it } from 'vitest';
import { formatPosCurrency, formatPosDate, posStatusTranslationKey } from './posPresentation';

describe('POS presentation', () => {
  it('formats dates and money for the selected locale', () => {
    expect(formatPosDate('2026-08-27T14:30:00.000Z', 'fr')).toContain('2026');
    expect(formatPosCurrency(1234.5, 'XOF', 'fr')).toContain('1');
  });

  it('uses localization keys for internal sale statuses', () => {
    expect(posStatusTranslationKey('PARTIALLY_REFUNDED')).toBe('pos.statuses.PARTIALLY_REFUNDED');
  });
});
