import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { Alert, Button, FormField, PageHeader, Screen, Stack, StatusBadge, Surface, SupportingText, TextField } from '@/components/ui';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { createBranch } from '@/services/organization';
import { setupErrorKey } from '@/services/ownerSetup';
import { spacing } from '@/theme/tokens';
import { newBranchId } from '@/domain/ownerSetup';

export default function BranchesScreen() {
  const { t } = useTranslation(); const { isOnline } = useConnectivity();
  const { organization, branches, managementBranches, configurationBranches, branch: current, can, refresh, setBranchId, loading, error: contextError, usingCachedData } = useOrganization();
  const visibleBranches = configurationBranches ?? managementBranches ?? branches;
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [city, setCity] = useState(''); const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newBranchId);
  const submit = async () => {
    if (saving || !organization || !isOnline || usingCachedData) return;
    if (!name.trim()) { setError('setup.errors.branchName'); return; }
    setSaving(true); setError(null); setSuccess(false);
    try {
      if (!createdId) {
        const created = await createBranch({ id: requestId, organization_id: organization.id, name: name.trim(), code: code.trim() || null, city: city.trim() || null, phone: phone.trim() || null });
        setCreatedId(created.id);
      }
      if (await refresh()) setSuccess(true); else setError('setup.refreshFailed');
    } catch (cause) { setError(setupErrorKey(cause)); } finally { setSaving(false); }
  };
  return <ScrollView><Screen style={styles.screen}><Stack>
    <PageHeader title={t('organization.branchesTitle')} subtitle={t('organization.branchesSubtitle')} />
    <SupportingText>{t('staffReady.branchSelectionHint')}</SupportingText>
    {loading ? <SupportingText>{t('common.loading')}</SupportingText> : null}
    {contextError ? <Alert tone="danger" title={t(contextError)} /> : null}
    {usingCachedData ? <Alert tone="info" title={t('setup.cachedBranches')} /> : null}
    <Button label={t('common.retry')} variant="ghost" disabled={!isOnline || loading} onPress={() => void refresh()} />
    {!loading && !branches.length ? <Alert tone="info" title={t(can('branch.manage') && !visibleBranches.length ? 'setup.noBranches' : 'staffReady.noAccess')} /> : null}
    {visibleBranches.map((branch) => <Surface key={branch.id}><Stack>
      <SupportingText>{branch.name} · {t(`settingsReady.${branch.status}`)}</SupportingText><SupportingText>{[branch.code, branch.city, branch.phone].filter(Boolean).join(' · ')}</SupportingText>
      {current?.id === branch.id ? <StatusBadge tone="success" label={t('setup.currentBranch')} /> : branches.some((item) => item.id === branch.id) ? <Button label={t('setup.switchBranch', { name: branch.name })} variant="secondary" onPress={() => setBranchId(branch.id)} /> : <SupportingText>{t('staffReady.managementOnly')}</SupportingText>}
    </Stack></Surface>)}
    {can('branch.manage') ? <Button label={t('settingsReady.title')} variant="secondary" onPress={() => router.push('/settings')} /> : null}
    {can('branch.manage') ? <Surface><Stack>
      <SupportingText>{t('organization.addBranch')}</SupportingText>
      {(['name', 'code', 'city', 'phone'] as const).map((field) => {
        const fields = { name: [name, setName, 'organization.branchName'], code: [code, setCode, 'organization.branchCode'], city: [city, setCity, 'organization.city'], phone: [phone, setPhone, 'organization.phone'] } as const;
        const [value, change, label] = fields[field];
        return <FormField key={field} required={field === 'name'} label={t(label)}><TextField accessibilityLabel={t(label)} value={value} onChangeText={change} editable={!saving && !createdId} maxLength={160} keyboardType={field === 'phone' ? 'phone-pad' : 'default'} /></FormField>;
      })}
      {!isOnline || usingCachedData ? <Alert tone="warning" title={t('setup.onlineRequired')} /> : null}
      {error ? <Alert tone="danger" title={t(error)} /> : null}
      {success ? <Alert tone="success" title={t('setup.branchCreated')} /> : null}
      {!success ? <Button label={t(createdId ? 'common.retry' : 'common.save')} loading={saving} disabled={!isOnline || usingCachedData} onPress={() => void submit()} /> : <Button label={t('organization.addBranch')} variant="secondary" onPress={() => { setName(''); setCode(''); setCity(''); setPhone(''); setCreatedId(null); setRequestId(newBranchId()); setSuccess(false); }} />}
    </Stack></Surface> : null}
  </Stack></Screen></ScrollView>;
}
const styles = StyleSheet.create({ screen: { width: '100%', maxWidth: 900, alignSelf: 'center', gap: spacing.lg } });
