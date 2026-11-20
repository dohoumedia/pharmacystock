import { useSettingsRevision } from '../src/hooks/useSettingsRevision';
import { loadOrganizationSettings } from '../src/services/coreCompletion';
import { LocalStore } from '../src/offline/localStore';
import { cacheOrganizationSettings, getCachedOrganizationSettings } from '../src/offline/readModels';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { Alert, Button, PageHeader, Screen, Stack, Surface } from '../src/components/ui';
import { CustomerDirectory } from '../src/components/CustomerDirectory';
import { CustomerEditor } from '../src/components/CustomerEditor';
import { SalesHistory } from '../src/components/SalesHistory';
import { SaleDetails } from '../src/components/SaleDetails';
import { useOrganization } from '../src/providers/OrganizationProvider';
import { useAuth } from '../src/providers/AuthProvider';
import { useConnectivity } from '../src/providers/ConnectivityProvider';
import { hasFreshMutationAuthorization } from '../src/domain/mutationAuthorization';
import { effectiveTimezone } from '../src/domain/businessSettings';
import type { Customer } from '../src/services/coreCompletion';
const store = new LocalStore();
export default function CustomersScreen() {
  const { t } = useTranslation(); const { user } = useAuth(); const { organization, can } = useOrganization();
  if (!user || !organization) return <Text>{t('organization.noOrganization')}</Text>;
  if (!can('customer.read')) return <Alert tone="warning" title={t('sprint7.customers.cannotRead')} />;
  return <CustomerWorkspace key={`${user.id}:${organization.id}`} organizationId={organization.id} userId={user.id} />;
}
function CustomerWorkspace({ organizationId, userId }: { organizationId: string; userId: string }) {
  const { t } = useTranslation(); const { organization, configurationBranches, can, usingCachedData, contextSyncedAt } = useOrganization(); const { isOnline } = useConnectivity();
  const [customer, setCustomer] = useState<Customer | null>(null); const [editing, setEditing] = useState(false); const [creating, setCreating] = useState(false); const [revision, setRevision] = useState(0); const [saved, setSaved] = useState(false);
  const settingsRevision = useSettingsRevision(organizationId);
  const [footer, setFooter] = useState<string | null>(() => getCachedOrganizationSettings(store, organizationId)?.data?.receipt_footer ?? null);
  useEffect(() => { let active = true; if (isOnline) void loadOrganizationSettings(organizationId).then(settings => { if (active) { cacheOrganizationSettings(store, organizationId, settings); setFooter(settings?.receipt_footer ?? null); } }).catch(() => { /* Retain synchronized receipt settings; no mutation is inferred. */ }); return () => { active = false; }; }, [organizationId, isOnline, settingsRevision]);
  const [sale, setSale] = useState<{ id: string; branchId: string } | null>(null);
  const writable = can('customer.manage') && hasFreshMutationAuthorization(isOnline, usingCachedData, contextSyncedAt);
  const saleBranch = configurationBranches.find(b => b.id === sale?.branchId);
  const context = { timezone: effectiveTimezone(organization?.timezone, saleBranch?.timezone), address: [saleBranch?.address_line1, saleBranch?.address_line2, saleBranch?.city, saleBranch?.country_code || organization?.country_code].filter(Boolean).join(', '), contact: [saleBranch?.phone, saleBranch?.email].filter(Boolean).join(' · ') };
  const select = (value: Customer) => { setCustomer(value); setEditing(false); setCreating(false); setSale(null); setSaved(false); };
  return <ScrollView><Screen style={{ maxWidth: 1000, width: '100%', alignSelf: 'center' }}><Stack>
    <PageHeader title={t('sprint7.customers.title')} subtitle={t('customersReady.scope')} />
    {can('customer.manage') ? <Button label={t('customersReady.create')} disabled={!writable || editing || creating} onPress={() => { setCreating(true); setEditing(false); setSaved(false); }} /> : <Text>{t('customersReady.manageRequired')}</Text>}
    {saved ? <Alert tone="success" title={t('customersReady.saved')} /> : null}
    {creating || editing && customer ? <CustomerEditor key={creating ? 'new' : customer!.id} organizationId={organizationId} userId={userId} customer={creating ? undefined : customer!} writable={writable} onSaved={value => { select(value); setRevision(r => r + 1); setSaved(true); }} onExisting={select} onCancel={() => { setCreating(false); setEditing(false); }} /> : null}
    {customer && !editing && !creating ? <Surface><Stack><Text accessibilityRole="header">{customer.full_name}</Text><Text>{customer.phone} · {customer.email}</Text><Text>{t(`customersReady.${customer.status}`)}</Text><Text>{t('customersReady.language')}: {t(`customersReady.${customer.preferred_locale}`)}</Text>{customer.notes ? <Text>{customer.notes}</Text> : null}
      <Text>{t('customersReady.consent', { marketing: t(customer.marketing_consent ? 'customersReady.yes' : 'customersReady.no'), service: t(customer.service_notification_consent ? 'customersReady.yes' : 'customersReady.no') })}</Text>
      {can('customer.manage') ? <Button label={t('customersReady.edit')} variant="secondary" disabled={!writable || editing || creating} onPress={() => { setEditing(true); setCreating(false); setSaved(false); }} /> : null}
      <Button label={t('customersReady.close')} variant="secondary" disabled={editing || creating} onPress={() => { setCustomer(null); setEditing(false); setSale(null); }} />
      <Text accessibilityRole="header">{t('customersReady.history')}</Text><Text>{t('customersReady.historyScope')}</Text>
      {can('sale.read') ? <SalesHistory key={customer.id} organizationId={organizationId} branchId={null} customerId={customer.id} branchNames={Object.fromEntries(configurationBranches.map(b => [b.id, b.name]))} timezone={effectiveTimezone(organization?.timezone)} online={isOnline} revision={revision} onOpen={(id, branchId) => setSale({ id, branchId })} /> : <Text>{t('customersReady.historyPermission')}</Text>}
    </Stack></Surface> : null}
    {sale && !editing && !creating && can('sale.read') ? <SaleDetails key={sale.id} organizationId={organizationId} branchId={sale.branchId} saleId={sale.id} userId={userId} footer={footer} business={organization?.name ?? ''} branchName={saleBranch?.name ?? sale.branchId} {...context} canRefund={can('sale.refund') && hasFreshMutationAuthorization(isOnline, usingCachedData, contextSyncedAt)} online={isOnline} onClose={() => setSale(null)} onChanged={() => setRevision(r => r + 1)} /> : null}
    <CustomerDirectory organizationId={organizationId} userId={userId} online={isOnline} disabled={editing || creating} revision={revision} onSelect={select} />
  </Stack></Screen></ScrollView>;
}
