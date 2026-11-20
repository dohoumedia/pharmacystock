import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation as useBaseTranslation } from 'react-i18next';
import { i18n } from './index';
import { webInitialLocale } from './webInitialLocale';

const subscribe = (notify: () => void) => {
  i18n.on('languageChanged', notify);
  return () => { i18n.off('languageChanged', notify); };
};
const getSnapshot = () => i18n.language;
const getServerSnapshot = () => webInitialLocale;

export function useTranslation() {
  // Each Suspense boundary hydrates with the export locale, then reads the live
  // selection. A root mount effect is too early for selectively hydrated routes.
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { t, i18n: instance, ready } = useBaseTranslation(undefined, { lng: locale });
  // Formatting and language controls must use the same snapshot as translations.
  // Methods still target the original instance; no second locale/resource store.
  const localizedInstance = useMemo(() => Object.create(instance, {
    language: { value: locale },
    resolvedLanguage: { value: locale },
  }) as typeof instance, [instance, locale]);
  return { t, i18n: localizedInstance, ready };
}
