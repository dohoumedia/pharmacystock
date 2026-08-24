import { createNamespacedStorage, type KeyValueStorage } from '../offline/storage';

export type AppLocale = 'en' | 'fr';

const LOCALE_KEY = 'selected-locale';

function isAppLocale(value: string | null): value is AppLocale {
  return value === 'en' || value === 'fr';
}

export function getPersistedLocale(storage?: KeyValueStorage): AppLocale | null {
  const value = createNamespacedStorage('pharmacystock:preferences:v1', storage).get(LOCALE_KEY);
  return isAppLocale(value) ? value : null;
}

export function persistLocale(locale: string, storage?: KeyValueStorage): void {
  if (!isAppLocale(locale)) return;
  createNamespacedStorage('pharmacystock:preferences:v1', storage).set(LOCALE_KEY, locale);
}
