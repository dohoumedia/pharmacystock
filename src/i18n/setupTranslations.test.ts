import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import en from './setup.en.json';
import fr from './setup.fr.json';
function keys(value: object, prefix = ''): string[] { return Object.entries(value).flatMap(([key, child]) => typeof child === 'string' ? [`${prefix}${key}`] : keys(child as object, `${prefix}${key}.`)); }
describe('owner setup EN/FR', () => {
  it('has equivalent nonempty English and French keys, including every step, status and validation', async () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
    const instance = createInstance();
    await instance.init({ resources: { en: { translation: en }, fr: { translation: fr } }, fallbackLng: false });
    for (const lng of ['en', 'fr']) for (const key of keys(en)) {
      expect(instance.exists(key, { lng })).toBe(true);
      expect(instance.t(key, { lng })).not.toBe(key);
      expect(instance.t(key, { lng }).trim()).not.toBe('');
    }
  });
  it('renders the essential navigation and owner workflow in both languages', async () => {
    const instance = createInstance(); await instance.init({ resources: { en: { translation: en }, fr: { translation: fr } }, lng: 'en' });
    expect(instance.t('setup.nav.staff')).toBe('Staff'); expect(instance.t('setup.steps.purchase')).toBe('Create purchase order');
    await instance.changeLanguage('fr');
    expect(instance.t('setup.nav.staff')).toBe('Personnel'); expect(instance.t('setup.steps.purchase')).toBe('Créer un bon de commande');
  });
});
