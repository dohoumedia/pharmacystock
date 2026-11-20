import { loadExpiryPolicy } from '../src/services/expiry';
import { DEFAULT_EXPIRY_THRESHOLDS } from '../src/domain/expiryCompletion';
import { useSettingsRevision } from '../src/hooks/useSettingsRevision';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { Platform, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { Alert, Button, FormField, Surface, TextField } from '../src/components/ui';
import { ReadModelStatus } from '../src/components/ReadModelStatus';
import { ReportSummary } from '../src/components/ReportSummary';
import { ReportRows } from '../src/components/ReportRows';
import { ReportDrilldown } from '../src/components/ReportDrilldown';
import { useOrganization } from '../src/providers/OrganizationProvider';
import { useAuth } from '../src/providers/AuthProvider';
import { useConnectivity } from '../src/providers/ConnectivityProvider';
import { useSyncStatus } from '../src/providers/SyncStatusProvider';
import { LocalStore } from '../src/offline/localStore';
import { isSnapshotStale, OPERATIONAL_READ_MODEL_MAX_AGE_MS } from '../src/offline/readModels';
import { businessDate, shiftBusinessDate, reportPeriod, validateReportFilters, REPORTS, reportTarget, reportCsv, reportColumns, reportStates, financeColumns, reportFilename, type ReportFilters, type ReportKind, type OperationalReport } from '../src/domain/operationalReports';
import { loadOperationalReport, exportOperationalReport } from '../src/services/operationalReports';
import { exportCsv } from '../src/utils/exportCsv';
import { printReceipt } from '../src/utils/printReceipt';
import { colors } from '../src/theme/tokens';

const store = new LocalStore();
export default function ReportsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { organization, branch, can } = useOrganization();
  if (!organization || !branch || !user) return <Text>{t('organization.noOrganization')}</Text>;
  if (!can('reports.read')) return <Text>{t('sprint7.reports.cannotRead')}</Text>;
  return <ReportsWorkspace key={`${user.id}:${organization.id}:${branch.id}:${branch.timezone || organization.timezone}:${can('reports.finance.read')}:${can('sale.read')}:${can('purchase.read')}:${can('inventory.read')}:${can('transfer.read')}`} />;
}
function ReportsWorkspace() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { organization, branch, branches, can, setBranchId } = useOrganization();
  const { isOnline } = useConnectivity();
  const { pendingCount, conflictCount } = useSyncStatus();
  const timezone = branch?.timezone || organization?.timezone || 'UTC';
  const currency = organization?.currency_code || '';
  const orgId = organization!.id, branchId = branch!.id;
  const allowed = REPORTS.filter(kind => ['sales', 'refunds', 'payments'].includes(kind) ? can('reports.finance.read') && can('sale.read') : kind === 'purchasing' ? can('reports.finance.read') && can('purchase.read') : kind === 'transfers' ? can('transfer.read') : can('inventory.read'));
  const [clock, setClock] = useState(() => Date.now());
  const today = businessDate(new Date(clock), timezone);
  const [mode, setMode] = useState<'today' | 'yesterday' | 'custom'>('today');
  const [draft, setDraft] = useState({ start: today, end: today, search: '', state: '', supplier: '', days: '30' });
  const [filters, setFilters] = useState<ReportFilters>({ report: allowed[0] || 'inventory', start: today, end: today, search: '', state: '', supplier: '', days: 30, page: 0 });
  const settingsRevision = useSettingsRevision(orgId);
  const canReadPolicy = can('inventory.read');
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; report: OperationalReport } | null>(null), [busy, setBusy] = useState(true), [cached, setCached] = useState(false), [error, setError] = useState('');
  const [exporting, setExporting] = useState(false), [exportMessage, setExportMessage] = useState('');
  const [target, setTarget] = useState<ReturnType<typeof reportTarget> | null>(null);
  const printRef = useRef<View>(null);
  useEffect(() => {
    if (!isOnline || !canReadPolicy) return;
    let active = true;
    void loadExpiryPolicy(orgId).then(policy => { if (!active) return; const days = Math.min(3650, Math.max(...(policy?.thresholds_days ?? DEFAULT_EXPIRY_THRESHOLDS))); setDraft(d => ({ ...d, days: String(days) })); setFilters(f => ({ ...f, days, page: 0 })); }).catch(() => { if (active) setError('reportsReady.error'); });
    return () => { active = false; };
  }, [orgId, isOnline, settingsRevision, canReadPolicy]);

  const date = mode === 'yesterday' ? shiftBusinessDate(today, -1) : today;
  const applied: ReportFilters = { ...filters, ...reportPeriod(mode, today, filters.start, filters.end) };
  const queryKey = JSON.stringify(applied);
  const result = loaded?.key === queryKey ? loaded.report : null;
  const cacheKey = `operationalReports:${user!.id}:${orgId}:${branchId}:${filters.report}:${can('reports.finance.read')}`;
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [timezone]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true); setError(''); setTarget(null); setExportMessage('');
      const snapshot = store.get<{ queryKey: string; timezone: string; report: OperationalReport }>(cacheKey);
      const previous = snapshot?.data.queryKey === queryKey && snapshot.data.timezone === timezone ? snapshot.data.report : null;
      setLoaded(previous ? { key: queryKey, report: previous } : null); setCached(Boolean(previous));
      if (!isOnline) { setBusy(false); return; }
      void loadOperationalReport(orgId, branchId, JSON.parse(queryKey) as ReportFilters).then(report => {
        if (!active) return;
        setLoaded({ key: queryKey, report }); setCached(false);
        store.set(cacheKey, { data: { queryKey, timezone, report }, syncedAt: report.generated_at });
      }).catch(() => { if (active) setError('reportsReady.error'); }).finally(() => { if (active) setBusy(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [queryKey, cacheKey, orgId, branchId, isOnline, revision, today, timezone, settingsRevision]);
  const edit = (key: 'start' | 'end' | 'search', value: string) => {
    if ((key === 'start' || key === 'end') && mode !== 'custom') {
      setDraft(d => ({ ...d, start: date, end: date, [key]: value }));
      setFilters(f => ({ ...f, start: date, end: date })); setMode('custom');
    } else setDraft(d => ({ ...d, [key]: value }));
  };
  const apply = () => {
    const next = { ...filters, ...draft, ...reportPeriod(mode, today, draft.start, draft.end), days: Number(draft.days), productId: undefined, page: 0 };
    try { if (!/^\d+$/.test(draft.days)) throw new Error(); validateReportFilters(next); }
    catch { setError('reportsReady.invalid'); return; }
    setMode('custom'); setFilters(next); setRevision(r => r + 1);
  };
  const download = async () => {
    if (!isOnline || busy || exporting || !result || cached) return;
    setExporting(true); setExportMessage('');
    try {
      const full = await exportOperationalReport(orgId, branchId, applied);
      const columns = reportColumns[filters.report].filter(key => full.summary.finance !== false || !financeColumns.has(key));
      const context = ['branch', 'timezone', 'period_start', 'period_end', 'business_date', 'generated_at'];
      if (!columns.includes('currency_code')) context.push('currency_code');
      const rows = full.rows.map(row => ({ branch: branch!.name, timezone: full.timezone, period_start: full.start, period_end: full.end, business_date: full.business_date, generated_at: full.generated_at, currency_code: currency, ...row }));
      await exportCsv(reportFilename(filters.report, branch!.name, applied.start, applied.end), reportCsv([...context, ...columns], rows, key => t(`reportsReady.columns.${key}`)));
      setExportMessage('reportsReady.exportDone');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setExportMessage(message === 'REPORT_EXPORT_TOO_LARGE' ? 'reportsReady.exportLarge' : message === 'REPORT_CHANGED' ? 'reportsReady.exportChanged' : message === 'REPORT_SHARING_UNAVAILABLE' ? 'reportsReady.sharingUnavailable' : 'reportsReady.error');
    } finally { setExporting(false); }
  };
  const chooseReport = (kind: ReportKind) => { setFilters(f => ({ ...f, report: kind, search: '', supplier: '', state: '', page: 0, productId: undefined })); setDraft(d => ({ ...d, search: '', supplier: '', state: '' })); };
  const stale = isSnapshotStale(result ? { data: result, syncedAt: result.generated_at } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS);
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 1150, width: '100%', alignSelf: 'center' }}>
    <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '800', color: colors.primary }}>{t('reportsReady.title')}</Text><Text>{t('reportsReady.subtitle')}</Text><Link href="/">{t('organization.back')}</Link>
    <Text>{t('reportsReady.timezone', { zone: timezone })}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{branches.map(b => <Button key={b.id} variant={b.id === branchId ? 'primary' : 'secondary'} label={b.name} disabled={exporting} onPress={() => setBranchId(b.id)} />)}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{allowed.map(kind => <Button key={kind} variant={kind === filters.report ? 'primary' : 'secondary'} label={t(`reportsReady.types.${kind}`)} disabled={exporting} onPress={() => chooseReport(kind)} />)}</View>
    <Surface style={{ gap: 12 }}><Text>{t('settingsReady.reportExpiryHint')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['today', 'yesterday'] as const).map(preset => <Button key={preset} label={t(`reportsReady.${preset}`)} variant={mode === preset ? 'primary' : 'secondary'} disabled={exporting} onPress={() => { setMode(preset); const d = preset === 'today' ? today : shiftBusinessDate(today, -1); setDraft(v => ({ ...v, start: d, end: d })); setFilters(f => ({ ...f, start: d, end: d, page: 0 })); }} />)}</View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{(['start', 'end', 'search'] as const).map(key => <View key={key} style={{ minWidth: 180, flexGrow: 1 }}><FormField label={t(`reportsReady.${key}`)}><TextField accessibilityLabel={t(`reportsReady.${key}`)} value={(key === 'start' || key === 'end') && mode !== 'custom' ? date : draft[key]} editable={!exporting} onChangeText={value => edit(key, value)} /></FormField></View>)}</View>
      <FormField label={t('reportsReady.state')}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['', ...reportStates[filters.report]].map(state => <Button key={state} variant={draft.state === state ? 'primary' : 'secondary'} label={state ? t(`reportsReady.values.${state}`) : t('reportsReady.all')} disabled={exporting} onPress={() => setDraft(d => ({ ...d, state }))} />)}</View></FormField>
      {filters.report === 'purchasing' ? <FormField label={t('reportsReady.supplierFilter')}><TextField accessibilityLabel={t('reportsReady.supplierFilter')} value={draft.supplier} onChangeText={supplier => setDraft(d => ({ ...d, supplier }))} /></FormField> : null}
      {filters.report === 'expiry' ? <FormField label={t('reportsReady.days')}><TextField accessibilityLabel={t('reportsReady.days')} value={draft.days} keyboardType="number-pad" onChangeText={days => setDraft(d => ({ ...d, days }))} /></FormField> : null}
      <Button label={t('reportsReady.apply')} disabled={exporting} onPress={apply} /><Button variant="secondary" label={t('reportsReady.refresh')} disabled={busy || !isOnline || exporting} onPress={() => setRevision(r => r + 1)} />
    </Surface>
    <ReadModelStatus loading={busy} usingCachedData={cached} stale={stale} syncedAt={result?.generated_at || null} hasData={!!result} />
    {error ? <Alert tone="danger" title={t(error)} /> : null}
    {busy ? <Text>{t('reportsReady.loading')}</Text> : null}
    {result ? <>
      <Surface><View ref={printRef} collapsable={false}><ReportSummary report={result} kind={filters.report} currency={currency} branchName={branch!.name} pending={pendingCount} conflicts={conflictCount} /></View></Surface>
      <Button label={t(exporting ? 'reportsReady.exportBusy' : 'reportsReady.export')} disabled={!isOnline || busy || cached || exporting || !!error} onPress={() => void download()} /><Text>{t('reportsReady.exportNote')}</Text>
      {filters.report === 'sales' && Platform.OS === 'web' ? <Button variant="secondary" label={t('reportsReady.print')} disabled={busy || cached || !!error} onPress={() => { if (!printReceipt(printRef)) setExportMessage('reportsReady.printUnavailable'); }} /> : null}
      {exportMessage ? <Text accessibilityLiveRegion="polite">{t(exportMessage)}</Text> : null}
      {target ? <ReportDrilldown receiptContext={{ timezone, address: [branch?.address_line1, branch?.address_line2, branch?.city, branch?.country_code || organization?.country_code].filter(Boolean).join(', '), contact: [branch?.phone, branch?.email].filter(Boolean).join(' · ') }} key={`${target.kind}:${target.id}`} target={target} organizationId={orgId} branchId={branchId} userId={user!.id} business={organization!.name} branchName={branch!.name} currency={currency} branches={branches} online={isOnline} onClose={() => setTarget(null)} onProduct={id => { setTarget(null); setFilters(f => ({ ...f, report: 'inventory', productId: id, search: '', state: '', page: 0 })); }} /> : null}
      <ReportRows report={result} kind={filters.report} currency={currency} branches={branches} onOpen={row => setTarget(reportTarget(filters.report, row))} />
      <Text>{t('reportsReady.page', { page: applied.page + 1, total: result.total })}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label={t('reportsReady.previous')} variant="secondary" disabled={busy || exporting || !isOnline || applied.page === 0} onPress={() => setFilters(f => ({ ...f, page: f.page - 1 }))} /><Button label={t('reportsReady.next')} variant="secondary" disabled={busy || exporting || !isOnline || !!error || (applied.page + 1) * result.page_size >= result.total} onPress={() => setFilters(f => ({ ...f, page: f.page + 1 }))} /></View>
    </> : null}
  </ScrollView></SafeAreaView>;
}
