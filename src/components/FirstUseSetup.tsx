import { useState } from 'react';
import { useTranslation } from '../i18n/useTranslation';
import { StyleSheet } from 'react-native';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { createPharmacy, setupErrorKey } from '@/services/ownerSetup';
import { createBranch } from '@/services/organization';
import { newBranchId, validatePharmacy } from '@/domain/ownerSetup';
import { Alert, Button, FormField, PageHeader, Screen, Stack, Surface, TextField } from './ui';
import { spacing } from '@/theme/tokens';

export function FirstUseSetup() {
  const { t, i18n } = useTranslation();
  const { organization, refresh, usingCachedData } = useOrganization();
  const { isOnline } = useConnectivity();
  const [name, setName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('XOF');
  const [timezone, setTimezone] = useState('UTC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [requestId] = useState(newBranchId);
  const branchOnly = Boolean(organization);
  const submit = async () => {
    if (busy || !isOnline || usingCachedData) return;
    const draft = { name, branchName: branchName.trim() || t('setup.defaultBranch'), country, currency, timezone, locale: i18n.language };
    const validation = branchOnly ? null : validatePharmacy(draft);
    if (validation) { setError(validation); return; }
    setBusy(true); setError(null);
    try {
      // Once the server has accepted a branch, retry only the context read.
      // This avoids a second branch if refreshing after creation fails.
      if (!saved) {
        if (organization) await createBranch({ id: requestId, organization_id: organization.id, name: draft.branchName });
        else await createPharmacy(draft);
        setSaved(true);
      }
      if (!await refresh()) setError('setup.refreshFailed');
    } catch (cause) { setError(setupErrorKey(cause)); } finally { setBusy(false); }
  };
  return <Screen style={styles.screen}>
    <PageHeader title={t(branchOnly ? 'setup.firstBranch' : 'setup.title')} subtitle={t('setup.subtitle')} />
    <Surface><Stack>
      {!branchOnly ? <><FormField label={t('setup.pharmacyName')} required><TextField accessibilityLabel={t('setup.pharmacyName')} value={name} onChangeText={setName} editable={!busy && !saved} maxLength={160} /></FormField>
        <FormField label={t('setup.country')} hint={t('setup.countryHint')}><TextField accessibilityLabel={t('setup.country')} value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} editable={!busy && !saved} /></FormField>
        <FormField label={t('setup.currency')} hint={t('setup.currencyHint')}><TextField accessibilityLabel={t('setup.currency')} value={currency} onChangeText={setCurrency} autoCapitalize="characters" maxLength={3} editable={!busy && !saved} /></FormField>
        <FormField label={t('setup.timezone')} hint={t('setup.timezoneHint')}><TextField accessibilityLabel={t('setup.timezone')} value={timezone} onChangeText={setTimezone} autoCapitalize="none" editable={!busy && !saved} /></FormField></> : null}
      <FormField label={t('organization.branchName')} hint={t('setup.branchHint')}><TextField accessibilityLabel={t('organization.branchName')} value={branchName} onChangeText={setBranchName} placeholder={t('setup.defaultBranch')} maxLength={160} editable={!busy && !saved} /></FormField>
      {!isOnline || usingCachedData ? <Alert tone="warning" title={t('setup.onlineRequired')} /> : null}
      {saved ? <Alert tone="success" title={t('setup.saved')} /> : null}
      {error ? <Alert tone="danger" title={t(error)} /> : null}
      <Button label={t(saved ? 'setup.enterApp' : branchOnly ? 'organization.addBranch' : 'setup.create')} onPress={() => void submit()} loading={busy} disabled={!isOnline || usingCachedData} />
    </Stack></Surface>
  </Screen>;
}
const styles = StyleSheet.create({ screen: { width: '100%', maxWidth: 650, alignSelf: 'center', gap: spacing.lg } });
