import notificationsReadyEn from './notificationsReady.en.json';
import notificationsReadyFr from './notificationsReady.fr.json';
import customersReadyEn from './customersReady.en.json';
import customersReadyFr from './customersReady.fr.json';
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
import setupEn from './setup.en.json';
import setupFr from './setup.fr.json';
import catalogReadyEn from './catalogReady.en.json';
import catalogReadyFr from './catalogReady.fr.json';
import importsEn from './imports.en.json';
import importsFr from './imports.fr.json';
import purchasingReadyEn from './purchasingReady.en.json';
import purchasingReadyFr from './purchasingReady.fr.json';
import inventoryReadyEn from './inventoryReady.en.json';
import inventoryReadyFr from './inventoryReady.fr.json';
import expiryReadyEn from './expiryReady.en.json';
import expiryReadyFr from './expiryReady.fr.json';
import transferReadyEn from './transferReady.en.json';
import transferReadyFr from './transferReady.fr.json';
import staffReadyEn from './staffReady.en.json';
import staffReadyFr from './staffReady.fr.json';
import posReadyEn from './posReady.en.json';
import posReadyFr from './posReady.fr.json';
import settingsReadyEn from './settingsReady.en.json';
import settingsReadyFr from './settingsReady.fr.json';
import reportsReadyEn from './reportsReady.en.json';
import reportsReadyFr from './reportsReady.fr.json';
import { getPersistedLocale, persistLocale } from './localePersistence';
import { posPresentationTranslations } from './posPresentationTranslations';

const deviceLanguage = getLocales()[0]?.languageCode === 'en' ? 'en' : 'fr';
const configuredLanguage = process.env.EXPO_PUBLIC_DEFAULT_LOCALE;
const defaultLanguage = configuredLanguage === 'en' || configuredLanguage === 'fr'
  ? configuredLanguage
  : deviceLanguage;
const initialLanguage = getPersistedLocale() ?? defaultLanguage;

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  initAsync: false,
  compatibilityJSON: 'v4',
  lng: initialLanguage,
  fallbackLng: 'fr',
  supportedLngs: ['en', 'fr'],
  resources: {
    en: { translation: { ...en, ...sprint7En, ...sprint8En, ...productionEn, ...dashboardEn, ...setupEn, ...catalogReadyEn, ...importsEn, ...purchasingReadyEn, ...inventoryReadyEn, ...expiryReadyEn, ...transferReadyEn, ...staffReadyEn, ...posReadyEn, ...reportsReadyEn, ...settingsReadyEn, ...customersReadyEn, ...notificationsReadyEn } },
    fr: { translation: { ...fr, ...sprint7Fr, ...sprint8Fr, ...productionFr, ...dashboardFr, ...setupFr, ...catalogReadyFr, ...importsFr, ...purchasingReadyFr, ...inventoryReadyFr, ...expiryReadyFr, ...transferReadyFr, ...staffReadyFr, ...posReadyFr, ...reportsReadyFr, ...settingsReadyFr, ...customersReadyFr, ...notificationsReadyFr } },
  },
  interpolation: {
    escapeValue: false,
  },
});

// All translations are bundled; install the POS additions before any render.
i18n.addResourceBundle('en', 'translation', posPresentationTranslations.en, true, true);
i18n.addResourceBundle('fr', 'translation', posPresentationTranslations.fr, true, true);

/** Keep browser document language and explicit language changes in sync. */
export function activateClientLocale() {
  const updateDocumentLanguage = (locale: string) => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  };
  updateDocumentLanguage(i18n.language);
  const onLanguageChanged = (locale: string) => {
    persistLocale(locale);
    updateDocumentLanguage(locale);
  };
  i18n.on('languageChanged', onLanguageChanged);
  return () => { i18n.off('languageChanged', onLanguageChanged); };
}

export { i18n };
