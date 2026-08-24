import { beforeEach, describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../offline/storage';
import { getPersistedLocale, persistLocale } from './localePersistence';

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('locale persistence', () => {
  let storage: KeyValueStorage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('keeps an explicit French selection across authenticated route navigation and refresh', () => {
    persistLocale('fr', storage);

    for (const route of ['/', '/inventory', '/batches', '/purchasing', '/settings']) {
      expect(getPersistedLocale(storage), route).toBe('fr');
    }

    expect(getPersistedLocale(storage)).toBe('fr');
  });

  it('persists switching back to English for the next session render', () => {
    persistLocale('fr', storage);
    persistLocale('en', storage);

    expect(getPersistedLocale(storage)).toBe('en');
  });

  it('ignores invalid values so default-locale selection can still apply', () => {
    persistLocale('es', storage);

    expect(getPersistedLocale(storage)).toBeNull();
  });
});
