import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { i18n as I18n } from 'i18next';

// Exercise both sides of the external-store contract. Real React hydration is
// additionally checked in the exported browser app, including nested routes.
const runtime = vi.hoisted(() => ({
  client: false,
  contract: null as null | {
    subscribe: (notify: () => void) => () => void;
    live: () => string;
    server: () => string;
  },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useSyncExternalStore: (...args: Parameters<typeof actual.useSyncExternalStore>) => {
    const [subscribe, live, server] = args;
    if (typeof live() !== 'string') return actual.useSyncExternalStore(...args);
    runtime.contract = { subscribe, live: live as () => string, server: server as () => string };
    return runtime.client ? live() : server!();
  } };
});
vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_DEFAULT_LOCALE', 'en');
  runtime.client = false; runtime.contract = null;
  const values = new Map([['pharmacystock:preferences:v1:selected-locale', 'fr']]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('uses a stable hydration locale and the live language for text, formatting and controls', async () => {
  const { useTranslation } = await import('./useTranslation.web');
  let projected: I18n | undefined;
  function Content() {
    const { t, i18n } = useTranslation(); projected = i18n;
    return <p lang={i18n.language}>{t('auth.signIn')} | {new Intl.NumberFormat(i18n.language).format(1.5)}</p>;
  }
  expect(renderToString(<Content />)).toBe('<p lang="en">Sign in<!-- --> | <!-- -->1.5</p>');
  const contract = runtime.contract!;
  expect(contract.server()).toBe('en'); expect(contract.live()).toBe('fr');
  const notified = vi.fn();
  const stop = contract.subscribe(notified);
  runtime.client = true;
  expect(renderToString(<Content />)).toBe('<p lang="fr">Se connecter<!-- --> | <!-- -->1,5</p>');
  // The projected control must still change the one real i18n instance.
  await projected!.changeLanguage('en');
  expect(notified).toHaveBeenCalledTimes(1);
  expect(contract.live()).toBe('en'); expect(contract.server()).toBe('en');
  expect(renderToString(<Content />)).toBe('<p lang="en">Sign in<!-- --> | <!-- -->1.5</p>');
  stop();
  await projected!.changeLanguage('fr');
  expect(notified).toHaveBeenCalledTimes(1);
});
