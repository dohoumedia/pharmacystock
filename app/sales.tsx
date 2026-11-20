import { effectiveTimezone } from '../src/domain/businessSettings';
import { useSettingsRevision } from '../src/hooks/useSettingsRevision';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { PageHeader, Screen, Stack } from '../src/components/ui';
import { SalesHistory } from '../src/components/SalesHistory';
import { SaleDetails } from '../src/components/SaleDetails';
import { useOrganization } from '../src/providers/OrganizationProvider';
import { useAuth } from '../src/providers/AuthProvider';
import { useConnectivity } from '../src/providers/ConnectivityProvider';
import { createOfflinePosStores } from '../src/offline/offlinePos';
import { observeSyncedSales } from '../src/offline/saleSyncObserver';
import { loadOrganizationSettings } from '../src/services/coreCompletion';
const stores = createOfflinePosStores();
export default function SalesScreen() {
  const { organization, branch, can } = useOrganization(); const { user } = useAuth();
  if (!organization || !branch || !user || !can('sale.read')) return null;
  return <HistoryWorkspace key={`${user.id}:${organization.id}:${branch.id}`} organizationId={organization.id} branchId={branch.id} userId={user.id} business={organization.name} branchName={branch.name} canRefund={can('sale.refund')} />;
}
function HistoryWorkspace({ organizationId, branchId, userId, business, branchName, canRefund }: { organizationId: string; branchId: string; userId: string; business: string; branchName: string; canRefund: boolean }) {
  const { organization, branch } = useOrganization();
  const settingsRevision = useSettingsRevision(organizationId);
  const receiptContext = { timezone: effectiveTimezone(organization?.timezone, branch?.timezone), address: [branch?.address_line1, branch?.address_line2, branch?.city, branch?.country_code || organization?.country_code].filter(Boolean).join(', '), contact: [branch?.phone, branch?.email].filter(Boolean).join(' · ') };
  const { t } = useTranslation(); const { isOnline } = useConnectivity();
  const [selected, setSelected] = useState<string | null>(null); const [revision, setRevision] = useState(0); const [footer, setFooter] = useState<string | null>(null); const [error, setError] = useState('');
  useEffect(() => observeSyncedSales(stores.outbox, userId, organizationId, branchId, () => setRevision(r => r + 1)), [userId, organizationId, branchId]);
  useEffect(() => { let active = true; if (isOnline) void loadOrganizationSettings(organizationId).then(settings => { if (active) { setFooter(settings?.receipt_footer ?? null); setError(''); } }).catch(() => { if (active) setError(t('posReady.detailError')); }); return () => { active = false; }; }, [organizationId, isOnline, t, settingsRevision]);
  return <ScrollView><Screen><Stack><PageHeader title={t('pos.salesHistory')} />{error ? <Text>{error}</Text> : null}{selected ? <SaleDetails {...receiptContext} key={selected} organizationId={organizationId} branchId={branchId} userId={userId} saleId={selected} business={business} branchName={branchName} footer={footer} canRefund={canRefund} online={isOnline} onClose={() => setSelected(null)} onChanged={() => setRevision(r => r + 1)} /> : null}<SalesHistory timezone={receiptContext.timezone} organizationId={organizationId} branchId={branchId} online={isOnline} revision={revision} onOpen={setSelected} /></Stack></Screen></ScrollView>;
}
