/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

const routes = import.meta.glob('../../app/settings.tsx');

describe('settings route', () => {
  it('includes the general pharmacy settings route', () => {
    expect(Object.keys(routes)).toEqual(['../../app/settings.tsx']);
  });
});
