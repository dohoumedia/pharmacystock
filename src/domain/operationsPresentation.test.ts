import { describe, expect, it } from 'vitest';
import { formatReportDate, formatReportMoney, isSettingsReadStale, reportsLayoutForWidth } from './operationsPresentation';

describe('operations presentation helpers', () => {
  const now = Date.parse('2026-08-23T18:10:00.000Z');

  it('uses dense report presentation on wider screens', () => {
    expect(reportsLayoutForWidth(390)).toBe('mobile');
    expect(reportsLayoutForWidth(1024)).toBe('desktop');
  });

  it('formats server-provided report values for the selected locale and currency', () => {
    expect(formatReportMoney(1234, 'en-US', 'USD')).toContain('1,234');
    expect(formatReportDate('2026-08-23', 'en-US')).toContain('Aug');
  });

  it('marks missing and expired settings snapshots stale', () => {
    expect(isSettingsReadStale(null, now)).toBe(true);
    expect(isSettingsReadStale('2026-08-23T17:00:00.000Z', now)).toBe(true);
    expect(isSettingsReadStale('2026-08-23T18:05:00.000Z', now)).toBe(false);
  });

});
