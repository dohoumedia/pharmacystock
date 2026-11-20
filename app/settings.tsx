import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { Alert, Button, FormField, PageHeader, Screen, Stack, Surface, SupportingText, TextField } from '../src/components/ui';
import { SettingsSection } from '../src/components/SettingsSection';
import { BranchConfiguration } from '../src/components/BranchConfiguration';
import { useOrganization } from '../src/providers/OrganizationProvider';
import { useAuth } from '../src/providers/AuthProvider';
import { useConnectivity } from '../src/providers/ConnectivityProvider';
import { hasFreshMutationAuthorization } from '../src/domain/mutationAuthorization';
import { effectiveTimezone, PAYMENT_METHODS, parseLowStockThreshold } from '../src/domain/businessSettings';
import { DEFAULT_EXPIRY_THRESHOLDS, expiryThresholds } from '../src/domain/expiryCompletion';
import { loadOrganizationSettings, saveOrganizationSettings, loadNotificationPreferences, saveNotificationPreferences, type OrganizationSettings, type NotificationPreferences } from '../src/services/coreCompletion';
import { loadExpiryPolicy, saveExpiryPolicy } from '../src/services/expiry';
import { saveBusinessProfile } from '../src/services/businessSettings';
import { settingsChanged } from '../src/services/settingsEvents';
import { LocalStore } from '../src/offline/localStore';
import { cacheOrganizationSettings, getCachedOrganizationSettings } from '../src/offline/readModels';
const store = new LocalStore();
export default function SettingsScreen() {
  const { organization } = useOrganization(); const { user } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  return <SettingsWorkspace key={`${user?.id}:${organization?.id}:${reloadKey}`} onReload={() => setReloadKey(v => v + 1)} />;
}
function SettingsWorkspace({ onReload }: { onReload: () => void }) {
  const { t, i18n } = useTranslation(); const { user } = useAuth(); const { isOnline } = useConnectivity();
  const { organization, branch, branches, managementBranches, configurationBranches, can, refresh, setBranchId, usingCachedData, contextSyncedAt } = useOrganization();
  const orgId = organization?.id, userId = user?.id;
  const canInventory = can('inventory.read'), canNotify = can('notification.read');
  const initialized = useRef(false);
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false), [loading, setLoading] = useState(true), [cached, setCached] = useState(false);
  const [settings, setSettings] = useState<OrganizationSettings | null>(null), [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [footer, setFooter] = useState(''), [low, setLow] = useState('5'), [payment, setPayment] = useState<OrganizationSettings['default_payment_method']>('CASH');
  const [thresholds, setThresholds] = useState(DEFAULT_EXPIRY_THRESHOLDS.join(', ')); const [inApp, setInApp] = useState(true);
  const [name, setName] = useState(organization?.name ?? ''), [country, setCountry] = useState(organization?.country_code ?? ''), [currency, setCurrency] = useState(organization?.currency_code ?? ''), [timezone, setTimezone] = useState(organization?.timezone ?? 'UTC');
  const [editBranch, setEditBranch] = useState(branch?.id ?? '');
  const reload = useCallback(async () => {
    if (!orgId || !userId) { setLoading(false); return; }
    setLoading(true); setFailed(false); setLoaded(false);
    const snapshot = getCachedOrganizationSettings(store, orgId);
    const apply = (s: OrganizationSettings | null) => { setSettings(s); setFooter(s?.receipt_footer ?? ''); setLow(String(s?.low_stock_default_threshold ?? 5)); setPayment(s?.default_payment_method ?? 'CASH'); };
    if (snapshot && !initialized.current) { apply(snapshot.data); setCached(true); }
    if (!isOnline) { setLoading(false); return; }
    try {
      const [s, policy, preferences] = await Promise.all([loadOrganizationSettings(orgId), canInventory ? loadExpiryPolicy(orgId) : null, canNotify ? loadNotificationPreferences(orgId, userId) : null]);
      if (!initialized.current) { apply(s); setThresholds((policy?.thresholds_days ?? DEFAULT_EXPIRY_THRESHOLDS).join(', ')); setInApp(preferences?.in_app ?? true); initialized.current = true; }
      cacheOrganizationSettings(store, orgId, s); setPrefs(preferences); setCached(false); setLoaded(true);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, [orgId, userId, isOnline, canInventory, canNotify]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);
  if (!organization || !user) return <Screen><SupportingText>{t('organization.noOrganization')}</SupportingText></Screen>;
  const fresh = hasFreshMutationAuthorization(isOnline, usingCachedData, contextSyncedAt), allowed = fresh && loaded && !loading;
  const selected = (configurationBranches ?? managementBranches).find(b => b.id === editBranch) ?? branch;
  return <ScrollView><Screen style={{ width: '100%', maxWidth: 900, alignSelf: 'center' }}><Stack>
    <PageHeader title={t('settingsReady.title')} subtitle={t('settingsReady.subtitle')} />
    {loading ? <SupportingText>{t('common.loading')}</SupportingText> : null}
    {failed ? <Alert tone="danger" title={t('settingsReady.loadFailed')} /> : null}
    {!isOnline || cached ? <Alert tone="warning" title={t('settingsReady.offline')} /> : null}
    {!fresh && isOnline ? <Alert tone="warning" title={t('production.settings.freshAuthorizationRequired')} /> : null}
    <Button label={t('settingsReady.reload')} variant="secondary" disabled={!isOnline || loading} onPress={() => { void refresh().then(ok => { if (ok) onReload(); else setFailed(true); }); }} />
    {!can('settings.manage') || !can('organization.manage') ? <Alert tone="info" title={t('settingsReady.readOnly')} /> : null}
    <SupportingText>{t('settingsReady.currentContext', { business: organization.name, branch: branch?.name ?? '—', currency: organization.currency_code || t('settingsReady.currencyMissing'), zone: effectiveTimezone(organization.timezone, branch?.timezone) })}</SupportingText>
    {!organization.currency_code ? <Alert tone="warning" title={t('settingsReady.currencyMissing')} /> : null}
    {can('organization.manage') ? <SettingsSection valueKey={JSON.stringify({ name, country, currency, timezone })} title={t('settingsReady.business')} allowed={allowed} save={async () => {
      const saved = await saveBusinessProfile(organization.id, { name, country_code: country || null, currency_code: currency, timezone }); setName(saved.name); setCountry(saved.country_code ?? ''); setCurrency(saved.currency_code); setTimezone(saved.timezone); settingsChanged(organization.id);
      if (!await refresh()) throw new Error('SETTINGS_REFRESH_REQUIRED');
    }}>{busy => <Stack>
      {([{ key: 'name', value: name, change: setName },{ key: 'country', value: country, change: setCountry },{ key: 'currency', value: currency, change: setCurrency },{ key: 'timezone', value: timezone, change: setTimezone }]).map(f => <FormField key={f.key} label={t(`settingsReady.${f.key}`)} hint={t(`settingsReady.${f.key}Hint`)}><TextField accessibilityLabel={t(`settingsReady.${f.key}`)} value={f.value} editable={allowed && !busy} autoCapitalize={f.key === 'name' ? 'sentences' : f.key === 'timezone' ? 'none' : 'characters'} maxLength={f.key === 'currency' ? 3 : f.key === 'country' ? 2 : 160} onChangeText={f.change} /></FormField>)}
      <SupportingText>{t('settingsReady.profileLimit')}</SupportingText><SupportingText>{t('settingsReady.taxLimit')}</SupportingText>
    </Stack>}</SettingsSection> : null}
    <Surface><Stack><SupportingText accessibilityRole="header">{t('settingsReady.branches')}</SupportingText><SupportingText>{t('settingsReady.branchChoiceHint')}</SupportingText>
      {branches.map(b => <Button key={b.id} label={t(branch?.id === b.id ? 'settingsReady.currentBranch' : 'settingsReady.useBranch', { name: b.name })} variant={branch?.id === b.id ? 'primary' : 'secondary'} onPress={() => { setBranchId(b.id); setEditBranch(b.id); }} />)}
      {can('branch.manage') ? (configurationBranches ?? managementBranches).map(b => <Button key={b.id} label={t('settingsReady.configureBranch', { name: b.name, status: t(`settingsReady.${b.status}`) })} variant="ghost" onPress={() => setEditBranch(b.id)} />) : null}
    </Stack></Surface>
    {can('branch.manage') && selected ? <BranchConfiguration key={selected.id} branch={selected} organizationTimezone={organization.timezone} allowed={allowed} refresh={refresh} /> : null}
    {can('settings.manage') ? <SettingsSection valueKey={JSON.stringify({ footer, low, payment })} title={t('settingsReady.receiptPaymentStock')} allowed={allowed} save={async () => {
      const saved = await saveOrganizationSettings({ organization_id: organization.id, receipt_footer: footer.trim() || null, default_payment_method: payment, low_stock_default_threshold: parseLowStockThreshold(low) }); setSettings(saved); cacheOrganizationSettings(store, organization.id, saved); settingsChanged(organization.id);
    }}>{busy => <Stack>
      <FormField label={t('settingsReady.receiptFooter')} hint={t('settingsReady.receiptHint')}><TextField accessibilityLabel={t('settingsReady.receiptFooter')} multiline value={footer} maxLength={1000} editable={allowed && !busy} onChangeText={setFooter} /></FormField>
      <FormField label={t('settingsReady.lowStock')} hint={t('settingsReady.lowStockHint')}><TextField accessibilityLabel={t('settingsReady.lowStock')} value={low} editable={allowed && !busy} keyboardType="decimal-pad" onChangeText={setLow} /></FormField>
      <SupportingText>{t('settingsReady.defaultPayment')}</SupportingText><SupportingText>{t('settingsReady.paymentHint')}</SupportingText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{PAYMENT_METHODS.map(m => <Button key={m} label={t(`production.settings.payment.${m}`)} variant={payment === m ? 'primary' : 'secondary'} accessibilityState={{ selected: payment === m }} disabled={!allowed || busy} onPress={() => setPayment(m)} />)}</View>
      <SupportingText>{t('settingsReady.lastSaved', { date: settings?.updated_at ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: effectiveTimezone(organization.timezone, branch?.timezone) }).format(new Date(settings.updated_at)) : '—' })}</SupportingText>
    </Stack>}</SettingsSection> : null}
    {canInventory && can('inventory.expiry.manage') ? <SettingsSection valueKey={thresholds} title={t('settingsReady.expiry')} allowed={allowed} save={async () => { const policy = await saveExpiryPolicy(organization.id, expiryThresholds(thresholds)); setThresholds(policy.thresholds_days.join(', ')); }}>{busy => <FormField label={t('settingsReady.expiryDays')} hint={t('settingsReady.expiryHint')}><TextField accessibilityLabel={t('settingsReady.expiryDays')} value={thresholds} editable={allowed && !busy} onChangeText={setThresholds} /></FormField>}</SettingsSection> : null}
    {canNotify ? <SettingsSection valueKey={String(inApp)} title={t('settingsReady.notifications')} allowed={allowed} save={async () => { const saved = await saveNotificationPreferences({ organization_id: organization.id, user_id: user.id, in_app: inApp, email: prefs?.email ?? false, sms: prefs?.sms ?? false, whatsapp: prefs?.whatsapp ?? false, push: prefs?.push ?? false }); setPrefs(saved); settingsChanged(organization.id); }}>{busy => <Stack>
      <SupportingText>{t('settingsReady.inAppHint')}</SupportingText><Button label={t(inApp ? 'settingsReady.inAppOn' : 'settingsReady.inAppOff')} variant="secondary" disabled={!allowed || busy} onPress={() => setInApp(v => !v)} /><SupportingText>{t('settingsReady.deliveryUnavailable')}</SupportingText>
    </Stack>}</SettingsSection> : null}
    <Surface><Stack><SupportingText accessibilityRole="header">{t('settingsReady.language')}</SupportingText><SupportingText>{t('settingsReady.languageHint')}</SupportingText><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['en','fr'] as const).map(locale => <Button key={locale} label={t(`settingsReady.languages.${locale}`)} variant={i18n.language === locale ? 'primary' : 'secondary'} onPress={() => { void i18n.changeLanguage(locale); }} />)}</View></Stack></Surface>
  </Stack></Screen></ScrollView>;
}
