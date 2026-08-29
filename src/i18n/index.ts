import 'expo-sqlite/localStorage/install';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './en.json';
import fr from './fr.json';
import productionEn from './production.en.json';
import productionFr from './production.fr.json';
import sprint7En from './sprint7.en.json';
import sprint7Fr from './sprint7.fr.json';
import sprint8En from './sprint8.en.json';
import sprint8Fr from './sprint8.fr.json';
import dashboardEn from './dashboard.en.json';
import dashboardFr from './dashboard.fr.json';
import { getPersistedLocale, persistLocale } from './localePersistence';
import { posPresentationTranslations } from './posPresentationTranslations';

const deviceLanguage = getLocales()[0]?.languageCode === 'en' ? 'en' : 'fr';
const configuredLanguage = process.env.EXPO_PUBLIC_DEFAULT_LOCALE;
const defaultLanguage = configuredLanguage === 'en' || configuredLanguage === 'fr'
  ? configuredLanguage
  : deviceLanguage;
const initialLanguage = getPersistedLocale() ?? defaultLanguage;

const i18n = createInstance();

const initialization = i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: initialLanguage,
  fallbackLng: 'fr',
  supportedLngs: ['en', 'fr'],
  resources: {
    en: { translation: { ...en, ...sprint7En, ...sprint8En, ...productionEn, ...dashboardEn } },
    fr: { translation: { ...fr, ...sprint7Fr, ...sprint8Fr, ...productionFr, ...dashboardFr } },
  },
  interpolation: {
    escapeValue: false,
  },
});

// Subscribe only after initialization so a device/organization default is not
// mistaken for an explicit user choice. Every later language change is durable.
void initialization.then(() => {
  i18n.addResourceBundle('en', 'translation', posPresentationTranslations.en, true, true);
  i18n.addResourceBundle('fr', 'translation', posPresentationTranslations.fr, true, true);
  i18n.on('languageChanged', persistLocale);
});

export { i18n };
