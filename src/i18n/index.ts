import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './en.json';
import fr from './fr.json';
import sprint7En from './sprint7.en.json';
import sprint7Fr from './sprint7.fr.json';

const deviceLanguage = getLocales()[0]?.languageCode === 'en' ? 'en' : 'fr';

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: deviceLanguage,
  fallbackLng: 'fr',
  supportedLngs: ['en', 'fr'],
  resources: {
    en: { translation: { ...en, ...sprint7En } },
    fr: { translation: { ...fr, ...sprint7Fr } },
  },
  interpolation: {
    escapeValue: false,
  },
});

export { i18n };
