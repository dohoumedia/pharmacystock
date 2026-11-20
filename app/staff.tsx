import { ScrollView } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { useOrganization } from '@/providers/OrganizationProvider';
import { StaffDirectory } from '@/components/StaffDirectory';
import { Alert, PageHeader, Screen, Stack } from '@/components/ui';

export default function StaffScreen() {
  const { t } = useTranslation();
  const { organization, can } = useOrganization();
  return <ScrollView><Screen><Stack>
    <PageHeader title={t('organization.staffTitle')} subtitle={t('staffReady.subtitle')} />
    {can('staff.manage') && organization ? <StaffDirectory key={organization.id} /> : <Alert tone="info" title={t('organization.cannotManage')} />}
  </Stack></Screen></ScrollView>;
}
