import { useState } from 'react';
import { FormField, TextField, SupportingText, Button, Stack } from './ui';
import { SettingsSection } from './SettingsSection';
import { useTranslation } from '../i18n/useTranslation';
import { saveBranchConfiguration, type BranchDraft } from '../services/businessSettings';
import { settingsChanged } from '../services/settingsEvents';
import type { Branch } from '../services/organization';
export function BranchConfiguration({ branch, organizationTimezone, allowed, refresh }: { branch: Branch; organizationTimezone: string; allowed: boolean; refresh: () => Promise<boolean> }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<BranchDraft>(() => ({ name: branch.name, address_line1: branch.address_line1, address_line2: branch.address_line2, city: branch.city, phone: branch.phone, email: branch.email, timezone: branch.timezone, status: branch.status }));
  return <SettingsSection valueKey={JSON.stringify(draft)} title={t('settingsReady.branchTitle', { name: branch.name })} allowed={allowed} save={async () => {
    await saveBranchConfiguration(branch.organization_id, branch.id, draft); settingsChanged(branch.organization_id);
    if (!await refresh()) throw new Error('SETTINGS_REFRESH_REQUIRED');
  }}>{busy => <Stack>
    {(['name','address_line1','address_line2','city','phone','email','timezone'] as const).map(field => <FormField key={field} label={t(`settingsReady.branchFields.${field}`)} hint={field === 'timezone' ? t('settingsReady.branchTimezoneHint', { zone: organizationTimezone }) : undefined}>
      <TextField accessibilityLabel={t(`settingsReady.branchFields.${field}`)} value={draft[field] ?? ''} editable={allowed && !busy} maxLength={field === 'timezone' ? 100 : 200} autoCapitalize={field === 'email' || field === 'timezone' ? 'none' : 'sentences'} keyboardType={field === 'email' ? 'email-address' : field === 'phone' ? 'phone-pad' : 'default'} onChangeText={value => setDraft(d => ({ ...d, [field]: field === 'name' ? value : value || null }))} />
    </FormField>)}
    <SupportingText>{t('settingsReady.branchStatusHint')}</SupportingText>
    {(['active','inactive'] as const).map(status => <Button key={status} label={t(`settingsReady.${status}`)} variant={draft.status === status ? 'primary' : 'secondary'} accessibilityState={{ selected: draft.status === status }} disabled={!allowed || busy} onPress={() => setDraft(d => ({ ...d, status }))} />)}
  </Stack>}</SettingsSection>;
}
