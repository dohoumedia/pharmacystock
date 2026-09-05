import { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ActionCard, AttentionCard, MetricCard, ReadModelStatus } from '@/components/DashboardCards';
import { Alert, Button, FormField, Inline, PageHeader, Screen, Stack, Surface, TextField } from '@/components/ui';
import { signInActionState } from '@/domain/authPresentation';
import { expiryRiskLevel, getExpiryAttention, getStockAttention, getTodaysSales, getTransferAttention, localDateKey, stockRiskCopyKey, stockRiskLevel, transferRiskLevel } from '@/domain/dashboardPresentation';
import { getCachedExpiryReadModel, getCachedTransfersReadModel } from '@/offline/expiryTransfersReadModels';
import { LocalStore } from '@/offline/localStore';
import { getCachedInventoryReadModel, getCachedOrganizationSettings } from '@/offline/readModels';
import { getCachedReports } from '@/offline/reportReadModel';
import { useAuth } from '@/providers/AuthProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { loadDailySales, loadOrganizationSettings, type DailySalesReport, type OrganizationSettings } from '@/services/coreCompletion';
import { loadExpiryRisk, type ExpiryRisk } from '@/services/expiry';
import { loadInventoryBalances, type InventoryBalanceItem } from '@/services/inventory';
import { loadTransfers, type StockTransfer } from '@/services/transfers';
import { foreground, shape, spacing, surface, typography } from '@/theme/tokens';

const localStore = new LocalStore();

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { loading: authLoading, user, signIn, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const actionState = signInActionState(email, password, authBusy);
  const switchLanguage = async () => { await i18n.changeLanguage(i18n.language === 'fr' ? 'en' : 'fr'); };
  const submitSignIn = async () => { setAuthBusy(true); setAuthError(null); try { await signIn(email, password); setPassword(''); } catch (cause) { setAuthError(cause instanceof Error ? cause.message : 'AUTH_ERROR'); } finally { setAuthBusy(false); } };
  const submitSignOut = async () => { setAuthBusy(true); setAuthError(null); try { await signOut(); } catch (cause) { setAuthError(cause instanceof Error ? cause.message : 'AUTH_ERROR'); } finally { setAuthBusy(false); } };

  return <SafeAreaView style={styles.safeArea}><View style={styles.screen}>
    {!user ? <><AuthScreen busy={actionState.loading} disabled={actionState.disabled} email={email} error={authError} loading={authLoading} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={() => void submitSignIn()} password={password} /><Button label={i18n.language === 'fr' ? t('common.english') : t('common.french')} onPress={() => void switchLanguage()} style={styles.languageButton} variant="secondary" /></> : <Dashboard authError={authError} languageLabel={i18n.language === 'fr' ? t('common.english') : t('common.french')} onSignOut={() => void submitSignOut()} onSwitchLanguage={() => void switchLanguage()} signOutBusy={authBusy} />}
  </View></SafeAreaView>;
}

function AuthScreen({ busy, disabled, email, error, loading, onEmailChange, onPasswordChange, onSubmit, password }: { busy: boolean; disabled: boolean; email: string; error: string | null; loading: boolean; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: () => void; password: string }) {
  const { t } = useTranslation();
  return <View style={styles.authLayout}>
    <View style={styles.authBrand}><View accessible={false} style={styles.brandMark}><Text style={styles.brandMarkText}>Rx</Text></View><Stack gap={spacing.xs}><Text style={styles.brand}>{t('app.name')}</Text><Text style={styles.tagline}>{t('app.tagline')}</Text></Stack></View>
    <Surface tone="raised" style={styles.authCard}>
      <PageHeader title={t('auth.signIn')} subtitle={t('app.tagline')} />
      {loading ? <ReadModelStatus label={t('common.loading')} tone="info" /> : null}
      <Stack gap={spacing.lg}>
        <FormField label={t('auth.email')} required><TextField accessibilityLabel={t('auth.email')} autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={onEmailChange} placeholder={t('auth.email')} textContentType="emailAddress" value={email} /></FormField>
        <FormField label={t('auth.password')} required><TextField accessibilityLabel={t('auth.password')} autoCapitalize="none" autoComplete="current-password" onChangeText={onPasswordChange} placeholder={t('auth.password')} secureTextEntry textContentType="password" value={password} /></FormField>
        {error ? <Alert accessibilityLabel={error} tone="danger" title={t('auth.signIn')}>{error}</Alert> : null}
        <Button disabled={disabled} label={t('auth.signIn')} loading={busy} onPress={onSubmit} style={styles.signInButton} />
      </Stack>
    </Surface>
  </View>;
}

function Dashboard({ onSignOut, onSwitchLanguage, languageLabel, signOutBusy, authError }: { onSignOut: () => void; onSwitchLanguage: () => void; languageLabel: string; signOutBusy: boolean; authError: string | null }) {
  const { t, i18n } = useTranslation(); const { isOnline } = useConnectivity(); const { organizations, organization, branches, branch, role, permissions, loading: organizationLoading, error: organizationError, setOrganizationId, setBranchId, can } = useOrganization();
  const [balances, setBalances] = useState<InventoryBalanceItem[]>([]); const [risk, setRisk] = useState<ExpiryRisk[]>([]); const [transfers, setTransfers] = useState<StockTransfer[]>([]); const [sales, setSales] = useState<DailySalesReport[]>([]); const [settings, setSettings] = useState<OrganizationSettings | null>(null); const [loading, setLoading] = useState(false); const [usingCachedData, setUsingCachedData] = useState(false); const [syncedAt, setSyncedAt] = useState<string | null>(null); const [error, setError] = useState(false);
  const canReadInventory = can('inventory.read'); const canReadTransfers = can('transfer.read'); const canReadReports = can('reports.read');
  const refresh = useCallback(async () => {
    if (!organization || !branch) return;
    const inventoryCache = getCachedInventoryReadModel(localStore, organization.id, branch.id); const expiryCache = getCachedExpiryReadModel(localStore, organization.id, branch.id); const transferCache = getCachedTransfersReadModel(localStore, organization.id, branch.id); const reportsCache = getCachedReports(localStore, organization.id, branch.id); const settingsCache = getCachedOrganizationSettings(localStore, organization.id);
    const cachedAt = [inventoryCache, expiryCache, transferCache, reportsCache, settingsCache].map((item) => item?.syncedAt).filter((item): item is string => Boolean(item)).sort()[0] ?? null;
    if (inventoryCache) setBalances(inventoryCache.data.balances); if (expiryCache) setRisk(expiryCache.data.risk); if (transferCache) setTransfers(transferCache.data.transfers); if (reportsCache) setSales(reportsCache.data.dailySales); if (settingsCache) setSettings(settingsCache.data); setSyncedAt(cachedAt); setUsingCachedData(Boolean(cachedAt));
    if (!isOnline) return;
    setLoading(true); setError(false);
    try {
      const [nextBalances, nextRisk, nextTransfers, nextSales, nextSettings] = await Promise.all([canReadInventory ? loadInventoryBalances(organization.id, branch.id) : Promise.resolve(null), canReadInventory ? loadExpiryRisk(organization.id, branch.id) : Promise.resolve(null), canReadTransfers ? loadTransfers(organization.id) : Promise.resolve(null), canReadReports ? loadDailySales(organization.id, branch.id) : Promise.resolve(null), canReadInventory ? loadOrganizationSettings(organization.id) : Promise.resolve(null)]);
      if (canReadInventory) { setBalances(nextBalances ?? []); setRisk(nextRisk ?? []); setSettings(nextSettings); } if (canReadTransfers) setTransfers(nextTransfers ?? []); if (canReadReports) setSales(nextSales ?? []); setSyncedAt(new Date().toISOString()); setUsingCachedData(false);
    } catch { setError(true); } finally { setLoading(false); }
  }, [branch, canReadInventory, canReadReports, canReadTransfers, isOnline, organization]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh]);
  const stock = useMemo(() => getStockAttention(balances, settings?.low_stock_default_threshold ?? null), [balances, settings]); const expiry = useMemo(() => getExpiryAttention(risk), [risk]); const transferAttention = useMemo(() => branch ? getTransferAttention(transfers, branch.id) : [], [branch, transfers]); const todaySales = useMemo(() => getTodaysSales(sales, localDateKey()), [sales]); const money = (value: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: organization?.currency_code ?? 'XOF' }).format(value);
  const stockLevel = stockRiskLevel(stock); const expiryLevel = expiryRiskLevel(expiry.map((item) => item.days_remaining)); const transferLevel = transferRiskLevel(transferAttention.length);
  return <ScrollView contentContainerStyle={styles.dashboardScroll}><Screen style={styles.dashboardScreen}>
    <PageHeader title={t('dashboard.title')} subtitle={branch ? t('dashboard.subtitle', { branch: branch.name }) : t('dashboard.noContext')} action={<Inline gap={spacing.sm} wrap><Button label={languageLabel} onPress={onSwitchLanguage} variant="secondary" />{organization && branch ? <Button disabled={!isOnline || loading} label={t('dashboard.refresh')} loading={loading} onPress={() => void refresh()} variant="secondary" /> : null}</Inline>} />
    {organizationLoading ? <ReadModelStatus label={t('common.loading')} tone="info" /> : null}{organizationError ? <Alert accessibilityLabel={organizationError} tone="danger" title={t('dashboard.title')}>{organizationError}</Alert> : null}
    {organizations.length > 1 ? <ContextSelector label={t('organization.title')} items={organizations.map((item) => ({ id: item.id, label: item.name }))} selectedId={organization?.id} onSelect={setOrganizationId} /> : null}
    {organization ? <ContextSelector label={t('organization.branch')} items={branches.map((item) => ({ id: item.id, label: item.name }))} selectedId={branch?.id} onSelect={setBranchId} footer={`${t('organization.role')}: ${role ? (i18n.language === 'fr' ? role.name_fr : role.name_en) : t('organization.noRole')} · ${t('organization.permissions')}: ${permissions.length}`} /> : null}
    {error ? <Alert tone="warning" title={t('dashboard.refreshFailed')} /> : null}{usingCachedData ? <ReadModelStatus label={`${t('dashboard.cached')}${syncedAt ? ` · ${t('dashboard.lastUpdated', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(syncedAt)) })}` : ''}`} tone="warning" /> : null}
    {organization && branch ? <><View style={styles.cardGrid}>
      {canReadInventory ? <AttentionCard actionLabel={t('dashboard.viewInventory')} href="/inventory" label={t(`dashboard.${stockRiskCopyKey(stock)}`, { count: stock[stockRiskCopyKey(stock)] })} level={stockLevel} title={t('dashboard.stockTitle')}><Text style={styles.metric}>{t('dashboard.outOfStock', { count: stock.outOfStock })}</Text>{stock.lowStockThreshold === null ? <Text style={styles.metadata}>{t('dashboard.lowStockUnavailable')}</Text> : <Text style={styles.metric}>{t('dashboard.lowStock', { count: stock.lowStock })}</Text>}{stock.outOfStock === 0 && stock.lowStock === 0 ? <Text style={styles.metadata}>{t('dashboard.stockEmpty')}</Text> : null}</AttentionCard> : null}
      {canReadInventory ? <AttentionCard actionLabel={t('dashboard.viewExpiry')} href="/expiry" label={t('dashboard.expiryRisk', { count: expiry.length })} level={expiryLevel} title={t('dashboard.expiryTitle')}><Text style={styles.metric}>{t('dashboard.expiryRisk', { count: expiry.length })}</Text>{expiry.length === 0 ? <Text style={styles.metadata}>{t('dashboard.expiryEmpty')}</Text> : expiry.slice(0, 3).map((item) => <Text key={item.batch_id ?? `${item.product_id}-${item.lot_number}`} style={styles.listItem}>{Number(item.days_remaining) < 0 ? t('dashboard.expiryExpired', { product: item.product_name ?? item.lot_number }) : t('dashboard.expiryDays', { product: item.product_name ?? item.lot_number, count: item.days_remaining })}</Text>)}</AttentionCard> : null}
      {canReadTransfers ? <AttentionCard actionLabel={t('dashboard.viewTransfers')} href="/transfers" label={t('dashboard.transferOpen', { count: transferAttention.length })} level={transferLevel} title={t('dashboard.transferTitle')}><Text style={styles.metric}>{t('dashboard.transferOpen', { count: transferAttention.length })}</Text>{transferAttention.length === 0 ? <Text style={styles.metadata}>{t('dashboard.transferEmpty')}</Text> : transferAttention.slice(0, 3).map((item) => <Text key={item.id} style={styles.listItem}>{item.transfer_number} · {t(`dashboard.transferStatus.${item.status}`)}</Text>)}</AttentionCard> : null}
      {canReadReports ? <MetricCard actionLabel={t('dashboard.viewReports')} href="/reports" title={t('dashboard.salesTitle')}><Text style={styles.salesValue}>{money(todaySales.grossSales)}</Text><Text style={styles.metric}>{t('dashboard.salesCount', { count: todaySales.saleCount })}</Text>{todaySales.saleCount === 0 ? <Text style={styles.metadata}>{t('dashboard.salesEmpty')}</Text> : null}</MetricCard> : null}
    </View><Stack gap={spacing.md}><Text style={styles.quickActionsTitle}>{t('dashboard.quickActions')}</Text><View style={styles.actionGrid}><ActionCard description={t('dashboard.quickSellDescription')} href="/pos" label={t('dashboard.quickSell')} title={t('production.navigation.pos')} /><ActionCard description={t('dashboard.quickStockDescription')} href="/inventory" label={t('dashboard.viewInventory')} title={t('dashboard.stockTitle')} /></View></Stack></> : null}
    <Button disabled={signOutBusy} label={t('auth.signOut')} onPress={onSignOut} variant="ghost" />{authError ? <Alert accessibilityLabel={authError} tone="danger" title={t('auth.signOut')}>{authError}</Alert> : null}
  </Screen></ScrollView>;
}

function ContextSelector({ footer, items, label, onSelect, selectedId }: { footer?: string; items: { id: string; label: string }[]; label: string; onSelect: (id: string) => void; selectedId?: string }) {
  return <Surface tone="default" style={styles.contextCard}><Text style={styles.contextLabel}>{label}</Text><View style={styles.chips}>{items.map((item) => <Button key={item.id} label={item.label} accessibilityState={{ selected: item.id === selectedId }} onPress={() => onSelect(item.id)} style={item.id === selectedId ? styles.selectedChip : styles.chip} variant={item.id === selectedId ? 'primary' : 'secondary'} />)}</View>{footer ? <Text style={styles.metadata}>{footer}</Text> : null}</Surface>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: surface.canvas }, screen: { flex: 1 }, authLayout: { flex: 1, alignSelf: 'center', justifyContent: 'center', width: '100%', maxWidth: 520, padding: spacing.xl, gap: spacing.xl }, authBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, brandMark: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: shape.md, backgroundColor: surface.brand }, brandMarkText: { color: foreground.inverse, ...typography.cardTitle, fontWeight: '900' }, brand: { color: foreground.brand, ...typography.sectionTitle }, tagline: { color: foreground.secondary, ...typography.supporting }, authCard: { gap: spacing.xl }, signInButton: { alignSelf: 'stretch' }, languageButton: { position: 'absolute', right: spacing.lg, bottom: spacing.lg }, dashboardScroll: { flexGrow: 1 }, dashboardScreen: { alignSelf: 'center', width: '100%', maxWidth: 1280, gap: spacing.lg }, contextCard: { gap: spacing.sm }, contextLabel: { color: foreground.secondary, ...typography.metadata, textTransform: 'uppercase' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, chip: { minWidth: 44 }, selectedChip: { minWidth: 44 }, cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }, actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, quickActionsTitle: { color: foreground.primary, ...typography.sectionTitle }, metric: { color: foreground.primary, ...typography.body, fontWeight: '800' }, salesValue: { color: foreground.brand, fontSize: 28, lineHeight: 34, fontWeight: '900' }, listItem: { color: foreground.primary, ...typography.supporting }, metadata: { color: foreground.secondary, ...typography.supporting },
});
