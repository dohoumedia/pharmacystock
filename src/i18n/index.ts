import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './en.json';
import fr from './fr.json';

const deviceLanguage = getLocales()[0]?.languageCode === 'en' ? 'en' : 'fr';

void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: deviceLanguage,
  fallbackLng: 'fr',
  supportedLngs: ['en', 'fr'],
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  interpolation: {
    escapeValue: false,
  },
});

export { i18n };
