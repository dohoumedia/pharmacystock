import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { useAuth } from '../src/providers/AuthProvider';
import { useOrganization } from '../src/providers/OrganizationProvider';
import { TransfersWorkspace } from '../src/components/TransfersWorkspace';

export default function TransfersScreen() {
  const { t } = useTranslation();
  const { transferId } = useLocalSearchParams<{ transferId?: string }>();
  const { user } = useAuth();
  const { organization, branch } = useOrganization();
  if (!user || !organization || !branch) return <Text>{t('organization.noOrganization')}</Text>;
  return <TransfersWorkspace key={`${user.id}:${organization.id}:${branch.id}:${transferId ?? ''}`} initialSelectedId={transferId} scope={`${user.id}:${organization.id}:${branch.id}`} organizationId={organization.id} branchId={branch.id} />;
}
