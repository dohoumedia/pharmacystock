import { describe, expect, it } from 'vitest';
import { hasFreshMutationAuthorization } from './mutationAuthorization';

describe('fresh mutation authorization', () => {
  const now = Date.parse('2026-08-23T18:10:00.000Z');
  const fresh = '2026-08-23T18:05:00.000Z';
  it.each([
    { isOnline: true, usingCachedData: false, expected: true },
    { isOnline: true, usingCachedData: true, expected: false },
    { isOnline: false, usingCachedData: false, expected: false },
    { isOnline: false, usingCachedData: true, expected: false },
  ])('returns $expected when online=$isOnline and cached=$usingCachedData', ({ isOnline, usingCachedData, expected }) => {
    expect(hasFreshMutationAuthorization(isOnline, usingCachedData, fresh, now)).toBe(expected);
  });

  it('rejects missing and stale permission snapshots', () => {
    expect(hasFreshMutationAuthorization(true, false, null, now)).toBe(false);
    expect(hasFreshMutationAuthorization(true, false, '2026-08-23T17:00:00.000Z', now)).toBe(false);
  });
});
