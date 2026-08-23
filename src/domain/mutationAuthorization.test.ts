import { describe, expect, it } from 'vitest';
import { hasFreshMutationAuthorization } from './mutationAuthorization';

describe('fresh mutation authorization', () => {
  it.each([
    { isOnline: true, usingCachedData: false, expected: true },
    { isOnline: true, usingCachedData: true, expected: false },
    { isOnline: false, usingCachedData: false, expected: false },
    { isOnline: false, usingCachedData: true, expected: false },
  ])('returns $expected when online=$isOnline and cached=$usingCachedData', ({ isOnline, usingCachedData, expected }) => {
    expect(hasFreshMutationAuthorization(isOnline, usingCachedData)).toBe(expected);
  });
});
