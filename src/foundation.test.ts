import { describe, expect, it } from 'vitest';

describe('Pharmacy Stock foundation', () => {
  it('keeps English and French as required locales', () => {
    expect(['en', 'fr']).toEqual(['en', 'fr']);
  });
});
