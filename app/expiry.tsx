import { useSettingsRevision } from '../src/hooks/useSettingsRevision';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { AppState, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { Alert, Button, FormField, PageHeader, Surface, TextField } from '@/components/ui';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { ExpiryWorkbench } from '@/components/ExpiryWorkbench';
import { ExpiryHistory } from '@/components/ExpiryHistory';
import { ExpiryRiskLabel, expiryErrorKey } from '@/components/ExpiryBatchDetails';
import { BatchStatusBadge } from '@/components/BatchStatusBadge';
import { LocalStore } from '@/offline/localStore';
import { cacheExpiryReadModel, getCachedExpiryReadModel, type ExpiryReadModel } from '@/offline/expiryTransfersReadModels';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useAuth } from '@/providers/AuthProvider';
import { hasFreshMutationAuthorization } from '@/domain/mutationAuthorization';
import { inventoryFormScope } from '@/domain/inventoryCompletion';
import { currentExpiryAlerts, DEFAULT_EXPIRY_THRESHOLDS, EXPIRY_REFRESH_MS, expiryCategory, expirySnapshotStale, expiryThresholds, riskSellable } from '@/domain/expiryCompletion';
import type { BatchSafetyStatus } from '@/domain/inventorySafety';
import { stockUnitLabel } from '@/domain/stockUnits';
import { formatDateOnly } from '@/utils/dateFormatting';
import { acknowledgeExpiryAlert, saveExpiryPolicy } from '@/services/expiry';
import { loadExpiryWorkspace } from '@/services/expiryCompletion';

const localStore = new LocalStore();
export default function ExpiryScreen() {
  const { organization, branch } = useOrganization();
  const { user } = useAuth();
  return <ExpiryContent key={`${user?.id}:${organization?.id}:${branch?.id}`} />;
}
function ExpiryContent() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ batchId?: string }>();
  const router = useRouter();
  const { isOnline } = useConnectivity();
  const { organization, branch, branches, setBranchId, can, usingCachedData: cachedPermissions, contextSyncedAt, refresh: refreshAccess } = useOrganization();
  const organizationId = organization?.id ?? '';
  const branchId = branch?.id ?? '';
  const settingsRevision = useSettingsRevision(organizationId);
  const canRead = can('inventory.read');
  const writable = hasFreshMutationAuthorization(isOnline, cachedPermissions, contextSyncedAt);
  const [model, setModel] = useState<ExpiryReadModel>({ risk: [], alerts: [], actions: [], policy: null });
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [thresholdInput, setThresholdInput] = useState(DEFAULT_EXPIRY_THRESHOLDS.join(', '));
  const policyDirty = useRef(false);
  const refreshFlight = useRef<Promise<void> | null>(null);
  const mutationFlight = useRef(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('RISK');
  const [selected, setSelected] = useState<string | null>(params.batchId ?? null);
  const [pendingBranch, setPendingBranch] = useState<{ branchId: string; batchId: string | null } | null>(null);
  const [clock, setClock] = useState<number | null>(null);
  const thresholds = model.policy?.thresholds_days ?? DEFAULT_EXPIRY_THRESHOLDS;
  const refresh = useCallback(async function performRefresh(): Promise<void> {
    void settingsRevision;
    if (!organizationId || !branchId || !canRead || !isOnline) return;
    // Serialize rather than drop a post-policy/post-action refresh behind older data.
    if (refreshFlight.current) { await refreshFlight.current; return performRefresh(); }
    const run = async () => {
      setLoading(true); setError(null);
      try {
        const next = await loadExpiryWorkspace(organizationId, branchId);
        const timestamp = new Date().toISOString();
        cacheExpiryReadModel(localStore, organizationId, branchId, next, timestamp);
        setModel(next); setSyncedAt(timestamp); setCached(false); setFailed(false);
        if (!policyDirty.current) setThresholdInput((next.policy?.thresholds_days ?? DEFAULT_EXPIRY_THRESHOLDS).join(', '));
      } catch (cause) { setFailed(true); setError(t(expiryErrorKey(cause))); }
      finally { setLoading(false); }
    };
    const pending = run(); refreshFlight.current = pending;
    try { await pending; } finally { refreshFlight.current = null; }
  }, [organizationId, branchId, canRead, isOnline, t, settingsRevision]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const snapshot = getCachedExpiryReadModel(localStore, organizationId, branchId);
      if (snapshot) { setModel(snapshot.data); setSyncedAt(snapshot.syncedAt); setCached(true); setThresholdInput((snapshot.data.policy?.thresholds_days ?? DEFAULT_EXPIRY_THRESHOLDS).join(', ')); }
      setClock(Date.now());
    }, 0);
    const tick = setInterval(() => setClock(Date.now()), 15_000);
    return () => { clearTimeout(timer); clearInterval(tick); };
  }, [organizationId, branchId]);
  useFocusEffect(useCallback(() => {
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, EXPIRY_REFRESH_MS);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [refresh]));
  const alerts = currentExpiryAlerts(model.alerts, model.risk, thresholds);
  const rows = model.risk.filter((row) => {
    const matches = [row.product_name, row.generic_name, row.lot_number].some((text) => text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const category = expiryCategory(row.days_remaining, thresholds);
    return matches && (filter === 'ALL' || filter === 'RISK' && ['EXPIRED', 'SOON'].includes(category.kind) || filter === 'EXPIRED' && category.kind === 'EXPIRED' || filter === 'SOON' && category.kind === 'SOON' || filter === row.batch_status);
  });
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 }).format(value);
  const totals = useMemo(() => model.risk.reduce((acc, row) => {
    const kind = expiryCategory(row.days_remaining, model.policy?.thresholds_days ?? DEFAULT_EXPIRY_THRESHOLDS).kind;
    if (kind === 'EXPIRED') acc.expired++; if (kind === 'SOON') acc.soon++;
    if (kind === 'EXPIRED' || kind === 'SOON') acc.value += Number(row.value_at_risk ?? 0);
    return acc;
  }, { expired: 0, soon: 0, value: 0 }), [model]);
  const savePolicy = async () => {
    if (!writable || !can('inventory.expiry.manage') || mutationFlight.current) return;
    mutationFlight.current = true; setSaving(true); setError(null); setNotice(null);
    try {
      const values = expiryThresholds(thresholdInput);
      const policy = await saveExpiryPolicy(organizationId, values);
      policyDirty.current = false; setThresholdInput(policy.thresholds_days.join(', ')); setModel((current) => ({ ...current, policy }));
      setNotice(t('expiryReady.policySaved')); await refresh();
    } catch (cause) { setError(t(expiryErrorKey(cause))); }
    finally { mutationFlight.current = false; setSaving(false); }
  };
  const acknowledge = async (id: string) => {
    if (!writable || !can('inventory.expiry.manage') || mutationFlight.current) return;
    mutationFlight.current = true; setSaving(true); setError(null);
    try { await acknowledgeExpiryAlert(id); await refresh(); }
    catch (cause) { setError(t(expiryErrorKey(cause))); }
    finally { mutationFlight.current = false; setSaving(false); }
  };
  const navigate = (nextBranch: string, batchId: string | null) => {
    if (nextBranch === branchId) { setSelected(batchId); return; }
    setPendingBranch({ branchId: nextBranch, batchId });
  };
  const stale = failed || cached || !isOnline || (clock !== null && expirySnapshotStale(syncedAt, clock));
  if (!canRead) return <Surface><Text>{t('expiry.cannotRead')}</Text><Link href="/">{t('organization.back')}</Link></Surface>;
  return <SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={{ padding: 20, gap: 18, maxWidth: 1120, width: '100%', alignSelf: 'center' }}>
    <PageHeader title={t('expiry.title')} subtitle={t('expiryReady.subtitle')} action={<Button label={t('expiryReady.refresh')} disabled={!isOnline || loading} loading={loading} onPress={() => void refresh()} />} />
    <Text style={{ fontWeight: '800' }}>{t('organization.branch')}: {branch?.name}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{branches.map((item) => <Button key={item.id} disabled={saving} label={item.name} variant={item.id === branchId ? 'primary' : 'secondary'} onPress={() => navigate(item.id, null)} />)}</View>
    {pendingBranch ? <Alert tone="warning" title={t('expiryReady.switchBranch')}><View style={{ gap: 8 }}><Text>{t('expiryReady.switchHint')}</Text><Button label={t('expiryReady.confirmSwitch')} onPress={() => { const target = pendingBranch; router.setParams({ batchId: target.batchId ?? undefined }); setBranchId(target.branchId); }} /><Button variant="secondary" label={t('common.cancel')} onPress={() => setPendingBranch(null)} /></View></Alert> : null}
    {error ? <Alert tone="danger" title={error} /> : null}{notice ? <Alert tone="success" title={notice} /> : null}
    <ReadModelStatus loading={loading} usingCachedData={cached} stale={stale} syncedAt={syncedAt} hasData={model.risk.length + model.actions.length > 0} />
    <Text>{t('expiryReady.refreshHint')}</Text>
    {!writable ? <><Alert tone="warning" title={t('production.authorizationReadOnly')} /><Button disabled={!isOnline} variant="secondary" label={t('inventoryReady.refreshAccess')} onPress={() => { void refreshAccess().catch((cause: unknown) => setError(t(expiryErrorKey(cause)))); }} /></> : null}
    <Surface style={{ gap: 8 }}><Text>{t('expiryReady.expiredCount', { count: totals.expired })} · {t('expiryReady.soonCount', { count: totals.soon })}</Text><Text>{t('expiry.valueAtRisk')}: {new Intl.NumberFormat(i18n.language, { ...(organization?.currency_code ? { style: 'currency' as const, currency: organization.currency_code } : {}) }).format(totals.value)}</Text><Text>{t('expiryReady.activePolicy', { days: thresholds.join(', ') })}</Text></Surface>
    {can('inventory.expiry.manage') ? <Surface style={{ gap: 10 }}><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 20 }}>{t('expiry.policy')}</Text><FormField label={t('expiryReady.thresholdLabel')} hint={t('expiryReady.thresholdHint')}><TextField accessibilityLabel={t('expiryReady.thresholdLabel')} editable={writable && !saving} value={thresholdInput} onChangeText={(value) => { policyDirty.current = true; setThresholdInput(value); }} /></FormField><Button disabled={!writable || saving || loading} label={t('expiryReady.savePolicy')} onPress={() => void savePolicy()} /></Surface> : null}
    <Surface style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 20 }}>{t('expiry.riskList')}</Text><TextField accessibilityLabel={t('expiryReady.search')} placeholder={t('expiryReady.search')} value={query} onChangeText={setQuery} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['RISK', 'ALL', 'EXPIRED', 'SOON', 'QUARANTINED', 'RECALLED'].map((value) => <Button key={value} label={t(`expiryReady.filter.${value}`)} variant={filter === value ? 'primary' : 'secondary'} onPress={() => setFilter(value)} />)}</View>
      {!loading && !rows.length ? <Text>{t('expiryReady.noMatches')}</Text> : null}
      {rows.map((row) => <Pressable key={row.batch_id} accessibilityRole="button" accessibilityLabel={`${row.product_name} · ${row.lot_number}`} accessibilityState={{ selected: selected === row.batch_id }} onPress={() => setSelected(row.batch_id)} style={{ padding: 14, gap: 6, borderWidth: 1, borderColor: selected === row.batch_id ? '#102A5C' : '#D0D5DD', borderRadius: 12 }}><Text style={{ fontWeight: '800' }}>{row.product_name} · {row.lot_number}</Text><Text>{t('organization.branch')}: {branch?.name} · {row.on_hand_quantity === null ? t('expiryReady.balanceUnavailable') : number(Number(row.on_hand_quantity))} {stockUnitLabel(row.stock_unit, t)}</Text><Text>{t('expiry.expires')}: {formatDateOnly(row.expiry_date, i18n.language)}</Text><ExpiryRiskLabel days={row.days_remaining} thresholds={thresholds} /><BatchStatusBadge status={(['ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED'].includes(row.batch_status ?? '') ? row.batch_status : 'UNKNOWN') as BatchSafetyStatus} /><Text>{t(riskSellable(row) ? 'expiryReady.sellable' : 'expiryReady.blocked')}</Text></Pressable>)}
    </Surface>
    {organization && branch && user ? <ExpiryWorkbench scope={inventoryFormScope(user.id, organizationId, branchId)} organizationId={organizationId} branchId={branchId} branchName={branch.name} branches={branches} selectedBatchId={selected} writable={writable} online={isOnline} revision={syncedAt} canManage={can('inventory.expiry.manage')} canDispose={can('inventory.dispose')} onSaved={refresh} onNavigate={navigate} onSelectBatch={setSelected} /> : null}
    <Surface style={{ gap: 12 }}><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 20 }}>{t('expiry.alerts')}</Text><Text>{t('expiryReady.alertHint')}</Text>{!alerts.length ? <Text>{t('expiry.noAlerts')}</Text> : alerts.map((alert) => { const row = model.risk.find((item) => item.batch_id === alert.batch_id); return <View key={alert.id} style={{ gap: 8 }}><Text>{row?.product_name} · {row?.lot_number}</Text><Text>{alert.alert_type === 'EXPIRED' ? t('expiry.expired') : t('expiryReady.withinDays', { days: alert.threshold_days })} · {t(`production.expiryAlertStatus.${alert.status.toLowerCase()}`)}</Text>{can('inventory.expiry.manage') && alert.status === 'OPEN' ? <Button disabled={!writable || saving} label={t('expiry.acknowledge')} onPress={() => void acknowledge(alert.id)} /> : null}</View>; })}</Surface>
    {branch ? <ExpiryHistory organizationId={organizationId} branchId={branchId} branchName={branch.name} online={isOnline} revision={syncedAt} /> : null}
  </ScrollView></SafeAreaView>;
}
