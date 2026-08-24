import { useCallback, useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { formatReportDate, formatReportMoney, reportsLayoutForWidth } from '@/domain/operationsPresentation';
import { LocalStore } from '@/offline/localStore';
import { cacheReports, getCachedReports } from '@/offline/reportReadModel';
import { isSnapshotStale, OPERATIONAL_READ_MODEL_MAX_AGE_MS } from '@/offline/readModels';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { loadDailySales, loadInventoryValue, type DailySalesReport, type InventoryValueReport } from '@/services/coreCompletion';
import { colors, radii, spacing, touchTarget } from '@/theme/tokens';

const localStore = new LocalStore();

export default function ReportsScreen() {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const { organization, branch, can } = useOrganization();
  const { isOnline } = useConnectivity();
  const [sales, setSales] = useState<DailySalesReport[]>([]);
  const [stock, setStock] = useState<InventoryValueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [usingCache, setUsingCache] = useState(false);
  const canRead = can('reports.read');
  const currency = organization?.currency_code ?? 'XOF';
  const layout = reportsLayoutForWidth(width);

  const applyCache = useCallback(() => {
    if (!organization || !branch) return false;
    const cached = getCachedReports(localStore, organization.id, branch.id);
    if (!cached) return false;
    setSales(cached.data.dailySales); setStock(cached.data.inventoryValue);
    setSyncedAt(cached.syncedAt); setUsingCache(true);
    return true;
  }, [organization, branch]);

  const refresh = useCallback(async () => {
    if (!organization || !branch || !canRead) return;
    setLoading(true); setError(false); applyCache();
    if (!isOnline) { setLoading(false); return; }
    try {
      const [dailySales, inventoryValue] = await Promise.all([loadDailySales(organization.id, branch.id), loadInventoryValue(organization.id, branch.id)]);
      const now = new Date().toISOString();
      cacheReports(localStore, organization.id, branch.id, { dailySales, inventoryValue }, now);
      setSales(dailySales); setStock(inventoryValue); setSyncedAt(now); setUsingCache(false);
    } catch { setError(true); applyCache(); }
    finally { setLoading(false); }
  }, [organization, branch, canRead, isOnline, applyCache]);

  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh]);
  if (!organization || !branch) return <SafeAreaView style={s.safe}><View style={s.center}><Text>{t('organization.noOrganization')}</Text></View></SafeAreaView>;
  if (!canRead) return <SafeAreaView style={s.safe}><View style={s.center}><Text>{t('sprint7.reports.cannotRead')}</Text><Link href="/">{t('organization.back')}</Link></View></SafeAreaView>;
  const stale = isSnapshotStale(syncedAt ? { data: { sales, stock }, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS);
  const money = (value: number | null) => formatReportMoney(value, i18n.language, currency);

  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container}>
    <View style={s.header}><View style={s.headerText}><Text accessibilityRole="header" style={s.title}>{t('sprint7.reports.title')}</Text><Text style={s.sub}>{t('sprint7.reports.subtitle')}</Text></View><Link href="/">{t('organization.back')}</Link></View>
    <ReadModelStatus loading={loading} usingCachedData={usingCache} stale={stale} syncedAt={syncedAt} hasData={Boolean(stock || sales.length)} />
    {error ? <View accessibilityRole="alert" style={s.errorBox}><Text style={s.error}>{t('production.reports.refreshFailed')}</Text><Pressable accessibilityRole="button" onPress={() => void refresh()} style={s.retry}><Text style={s.retryText}>{t('production.connectivity.retry')}</Text></Pressable></View> : null}
    <View style={s.card}><Text style={s.section}>{t('sprint7.reports.inventoryValue')}</Text>{loading && !stock ? <Text style={s.meta}>{t('common.loading')}</Text> : stock ? <View style={s.metrics}><Metric label={t('sprint7.reports.stockedBatches')} value={String(stock.stocked_batches ?? 0)} /><Metric label={t('sprint7.reports.costValue')} value={money(stock.inventory_cost_value)} /><Metric label={t('sprint7.reports.retailValue')} value={money(stock.inventory_retail_value)} /></View> : <Text style={s.meta}>{t('sprint7.reports.noData')}</Text>}</View>
    <View style={s.card}><Text style={s.section}>{t('sprint7.reports.dailySales')}</Text>{layout === 'desktop' && sales.length > 0 ? <View style={[s.row,s.tableHeader]}><Text style={[s.meta,s.dateColumn]}>{t('production.reports.date')}</Text><Text style={[s.meta,s.countColumn]}>{t('sprint7.reports.saleCount')}</Text><Text style={[s.meta,s.amountColumn]}>{t('production.reports.grossSales')}</Text></View> : null}{loading && sales.length === 0 ? <Text style={s.meta}>{t('common.loading')}</Text> : sales.length === 0 ? <Text style={s.meta}>{t('sprint7.reports.noData')}</Text> : sales.map((row, index) => <View key={`${row.sale_date ?? 'unknown'}-${index}`} style={s.row}><Text style={[s.bold,layout === 'desktop'&&s.dateColumn]}>{formatReportDate(row.sale_date,i18n.language)}</Text>{layout === 'desktop' ? <Text style={[s.meta,s.countColumn]}>{row.sale_count ?? 0}</Text> : <Text style={s.meta}>{t('sprint7.reports.saleCount')}: {row.sale_count ?? 0}</Text>}<Text style={[s.amount,layout === 'desktop'&&s.amountColumn]}>{money(row.gross_sales)}</Text></View>)}</View>
  </ScrollView></SafeAreaView>;
}

function Metric({ label, value }: { label: string; value: string }) { return <View style={s.metric}><Text style={s.meta}>{label}</Text><Text style={s.metricValue}>{value}</Text></View>; }
const s = StyleSheet.create({ safe:{flex:1,backgroundColor:colors.background},container:{padding:spacing.xl,gap:spacing.lg,maxWidth:1000,width:'100%',alignSelf:'center'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:spacing.md},header:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:spacing.md},headerText:{flex:1,minWidth:240},title:{fontSize:28,fontWeight:'800',color:colors.primary},sub:{color:colors.muted,marginTop:spacing.xs},card:{backgroundColor:colors.surface,padding:spacing.lg,borderRadius:radii.lg,gap:spacing.md},section:{fontSize:19,fontWeight:'700',color:colors.primary},metrics:{flexDirection:'row',flexWrap:'wrap',gap:spacing.md},metric:{flexGrow:1,minWidth:180,borderWidth:1,borderColor:colors.border,borderRadius:radii.md,padding:spacing.lg,gap:spacing.xs},metricValue:{fontSize:20,fontWeight:'800',color:colors.primary},row:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:spacing.md,paddingVertical:spacing.md,borderBottomWidth:1,borderBottomColor:colors.border},tableHeader:{backgroundColor:colors.background,paddingHorizontal:spacing.sm},dateColumn:{flex:2},countColumn:{flex:1,textAlign:'right'},amountColumn:{flex:1,textAlign:'right'},bold:{fontWeight:'700',color:colors.text},amount:{fontWeight:'800',color:colors.text},meta:{color:colors.muted},errorBox:{backgroundColor:'#FEF3F2',borderRadius:radii.md,padding:spacing.md,gap:spacing.sm},error:{color:colors.danger,fontWeight:'600'},retry:{minHeight:touchTarget,alignSelf:'flex-start',justifyContent:'center'},retryText:{color:colors.primary,fontWeight:'700'} });
