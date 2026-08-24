import { afterEach, describe, expect, it } from 'vitest';
import { formatDateOnly, formatInstantDate } from './dateFormatting';

const originalTimeZone = process.env.TZ;
afterEach(() => { process.env.TZ = originalTimeZone; });

describe('formatDateOnly', () => {
  it.each(['America/New_York', 'Pacific/Honolulu', 'Europe/Paris', 'Pacific/Kiritimati'])(
    'keeps 2028-12-31 on December 31 in %s',
    (timeZone) => {
      process.env.TZ = timeZone;
      expect(formatDateOnly('2028-12-31', 'en-US')).toBe('Dec 31, 2028');
    },
  );

  it('localizes the same calendar date in English and French', () => {
    expect(formatDateOnly('2028-12-31', 'en-US')).toBe('Dec 31, 2028');
    expect(formatDateOnly('2028-12-31', 'fr-FR')).toBe('31 déc. 2028');
  });

  it('leaves invalid or non-date values intact', () => {
    expect(formatDateOnly(null, 'en-US')).toBe('—');
    expect(formatDateOnly('2028-02-30', 'en-US')).toBe('2028-02-30');
    expect(formatDateOnly('2028-12-31T00:00:00Z', 'en-US')).toBe('2028-12-31T00:00:00Z');
  });

  it('continues to apply device timezone semantics to true instants', () => {
    process.env.TZ = 'America/New_York';
    expect(formatInstantDate('2028-12-31T00:30:00.000Z', 'en-US')).toBe('Dec 30, 2028');
  });
});
