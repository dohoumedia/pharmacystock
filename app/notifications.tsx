import { ScrollView } from 'react-native';
import { PageHeader, Screen, Stack } from '../src/components/ui';
import { NotificationCenter } from '../src/components/NotificationCenter';
import { useTranslation } from '../src/i18n/useTranslation';
export default function NotificationsScreen() {
  const { t } = useTranslation();
  return <Screen><ScrollView contentContainerStyle={{ width: '100%', maxWidth: 1000, alignSelf: 'center', paddingBottom: 32 }}><Stack><PageHeader title={t('notificationsReady.title')} subtitle={t('notificationsReady.subtitle')} /><NotificationCenter /></Stack></ScrollView></Screen>;
}
