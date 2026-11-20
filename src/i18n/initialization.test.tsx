import { createElement } from 'react';
import { renderToString, renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ os: 'web', device: 'en' }));
vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: runtime.device }] }));
vi.mock('react-native', () => ({ Platform: { get OS() { return runtime.os; } } }));
vi.mock('expo-router/html', () => ({ ScrollViewStyleReset: () => null }));

type TranslationHook = () => { t: TFunction; i18n: { language: string } };
function LocaleContent({ useLocaleTranslation }: { useLocaleTranslation: TranslationHook }) {
  const { t, i18n } = useLocaleTranslation();
  return <p lang={i18n.language}>{t('app.tagline')} | {t('auth.signIn')} | {t('pos.saleSavedPending', { saleNumber: '1' })} | {new Intl.NumberFormat(i18n.language).format(1.5)}</p>;
}
async function markup() {
  const { useTranslation } = await import('./useTranslation.web');
  return renderToString(createElement(LocaleContent, { useLocaleTranslation: useTranslation }));
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_DEFAULT_LOCALE', 'en');
  runtime.os = 'web'; runtime.device = 'en';
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal('document', { documentElement: { lang: 'en' } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('locale initialization and hydration', () => {
  it.each(['fr', 'en'] as const)('keeps the server hydration snapshot stable with persisted %s', async (locale) => {
    // Simulate a static export with no browser storage or document.
    const storage = globalThis.localStorage;
    const doc = globalThis.document;
    vi.stubGlobal('localStorage', undefined); vi.stubGlobal('document', undefined);
    const server = await import('./index');
    expect(server.i18n.isInitialized).toBe(true);
    const serverMarkup = await markup();
    vi.resetModules();
    vi.stubGlobal('localStorage', storage); vi.stubGlobal('document', doc);
    const persistence = await import('./localePersistence');
    persistence.persistLocale(locale);
    const client = await import('./index');
    expect(client.i18n.isInitialized).toBe(true);
    expect(client.i18n.language).toBe(locale);
    expect(await markup()).toBe(serverMarkup);
    expect(serverMarkup).toContain('lang="en"');
    expect(serverMarkup).toContain('1.5');
    const cleanup = client.activateClientLocale();
    expect(client.i18n.language).toBe(locale);
    expect(client.i18n.t('auth.signIn')).toBe(locale === 'fr' ? 'Se connecter' : 'Sign in');
    expect(document.documentElement.lang).toBe(locale);
    expect(persistence.getPersistedLocale()).toBe(locale);
    expect(await markup()).not.toContain('pos.saleSavedPending');
    cleanup();
  });

  it('switches EN -> FR -> EN and persists document and reload selection', async () => {
    const { i18n, activateClientLocale } = await import('./index');
    const { getPersistedLocale } = await import('./localePersistence');
    const cleanup = activateClientLocale();
    expect(getPersistedLocale()).toBeNull();
    for (const locale of ['fr', 'en'] as const) {
      await i18n.changeLanguage(locale);
      expect(getPersistedLocale()).toBe(locale);
      expect(document.documentElement.lang).toBe(locale);
      expect(i18n.t('auth.signIn')).toBe(locale === 'fr' ? 'Se connecter' : 'Sign in');
    }
    cleanup();
    await i18n.changeLanguage('fr');
    expect(getPersistedLocale()).toBe('en'); // unmounted listener was removed
    vi.resetModules();
    const reloaded = await import('./index');
    const stop = reloaded.activateClientLocale();
    expect(reloaded.i18n.language).toBe('en');
    stop();
  });

  it.each(['en', 'fr'])('restores a fresh %s device without persisting a default', async (device) => {
    vi.stubEnv('EXPO_PUBLIC_DEFAULT_LOCALE', undefined);
    runtime.device = device;
    const { i18n, activateClientLocale } = await import('./index');
    expect(i18n.language).toBe(device);
    expect(await markup()).toContain('lang="en"');
    const cleanup = activateClientLocale();
    expect(i18n.language).toBe(device);
    expect(document.documentElement.lang).toBe(device);
    expect((await import('./localePersistence')).getPersistedLocale()).toBeNull();
    cleanup();
  });

  it.each(['en', 'fr'])('shares the configured %s locale with static document HTML', async (locale) => {
    vi.stubEnv('EXPO_PUBLIC_DEFAULT_LOCALE', locale);
    const { i18n } = await import('./index');
    const { default: Root } = await import('../../app/+html');
    expect(i18n.language).toBe(locale);
    expect(renderToStaticMarkup(<Root><main /></Root>)).toContain(`<html lang="${locale}">`);
  });

  it('loads persisted native French before the first native render', async () => {
    runtime.os = 'ios';
    (await import('./localePersistence')).persistLocale('fr');
    const { i18n } = await import('./index');
    expect(i18n.language).toBe('fr');
    expect(i18n.t('auth.signIn')).toBe('Se connecter');
  });

  it('has all bundled EN/FR resources available synchronously without raw keys', async () => {
    const { i18n } = await import('./index');
    const keys = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(
      ([key, child]) => typeof child === 'object' && child !== null
        ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
    );
    const en = keys(i18n.getResourceBundle('en', 'translation')).sort();
    const fr = keys(i18n.getResourceBundle('fr', 'translation')).sort();
    expect(en).toEqual(fr);
    for (const lng of ['en', 'fr']) for (const key of en) {
      expect(i18n.exists(key, { lng, fallbackLng: false }), `${lng}:${key}`).toBe(true);
      expect(i18n.t(key, { lng }).trim(), `${lng}:${key}`).not.toBe('');
      expect(i18n.t(key, { lng }), `${lng}:${key}`).not.toBe(key);
    }
  });
});
