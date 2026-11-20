import { router } from 'expo-router';
import { ScrollView } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { Button, PageHeader, Screen, Stack, Surface } from '@/components/ui';
import { visibleNavigation } from '@/navigation/items';
import { useOrganization } from '@/providers/OrganizationProvider';

export default function MoreScreen() {
  const { t } = useTranslation(); const { can } = useOrganization();
  return <ScrollView><Screen><Stack><PageHeader title={t('setup.nav.more')} subtitle={t('setup.nav.description')} /><Surface><Stack>
    {visibleNavigation(can).map((item) => <Button key={item.href} label={t(item.labelKey)} variant="secondary" onPress={() => router.push(item.href as '/')} />)}
  </Stack></Surface></Stack></Screen></ScrollView>;
}
