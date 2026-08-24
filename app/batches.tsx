import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '@/utils/dateFormatting';
import { BatchStatusBadge } from '@/components/BatchStatusBadge';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { batchSafetyStatus, type BatchSafetyStatus } from '@/domain/inventorySafety';
import { LocalStore } from '@/offline/localStore';
import {
  cacheBatches,
  cacheProducts,
  getCachedBatches,
  getCachedProducts,
  isSnapshotStale,
  oldestSnapshotSyncedAt,
  OPERATIONAL_READ_MODEL_MAX_AGE_MS,
} from '@/offline/readModels';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { createBatch, loadBatches, loadProducts, type Batch, type ProductListItem } from '@/services/catalog';
import { breakpoints, colors, radii, spacing, touchTarget } from '@/theme/tokens';

const BATCH_STATUSES = ['ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED'] as const;
const FILTER_STATUSES: ('ALL' | BatchSafetyStatus)[] = ['ALL', ...BATCH_STATUSES];
const localStore = new LocalStore();

export default function BatchesScreen() {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const { isOnline } = useConnectivity();
  const { organization, branches, branch, setBranchId, can, usingCachedData: usingCachedPermissions } = useOrganization();
  const organizationId = organization?.id ?? null;
  const branchId = branch?.id ?? null;
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [lotNumber, setLotNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [status, setStatus] = useState<(typeof BATCH_STATUSES)[number]>('ACTIVE');
  const [notes, setNotes] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof FILTER_STATUSES)[number]>('ALL');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const refreshRequest = useRef(0);

  const canRead = can('inventory.read');
  const canCreate = can('inventory.product.create');
  const mutationsAuthorized = isOnline && !usingCachedPermissions;
  const desktopTable = width >= breakpoints.tablet;

  const applyCachedReadModels = useCallback(() => {
    if (!organizationId || !branchId) return false;
    const cachedProducts = getCachedProducts(localStore, organizationId);
    const cachedBatches = getCachedBatches(localStore, organizationId, branchId);
    setProducts(
      cachedProducts
        ? cachedProducts.data.map((product) => ({
            ...product,
            primaryBarcode: null,
          }))
        : [],
    );
    setBatches(cachedBatches?.data ?? []);
    const oldest = cachedBatches ? oldestSnapshotSyncedAt(cachedProducts, cachedBatches) : null;
    setSyncedAt(oldest);
    setUsingCachedData(Boolean(cachedBatches));
    return Boolean(cachedBatches);
  }, [branchId, organizationId]);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequest.current;
    if (!organizationId || !branchId || !canRead) return;
    const hasCachedData = applyCachedReadModels();
    if (!isOnline) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextProducts, nextBatches] = await Promise.all([loadProducts(organizationId), loadBatches(organizationId, branchId)]);
      if (requestId !== refreshRequest.current) return;
      const nextSyncedAt = new Date().toISOString();
      cacheProducts(localStore, organizationId, nextProducts, nextSyncedAt);
      cacheBatches(localStore, organizationId, branchId, nextBatches, nextSyncedAt);
      setProducts(nextProducts);
      setBatches(nextBatches);
      setSyncedAt(nextSyncedAt);
      setUsingCachedData(false);
      setProductId((current) => (current && nextProducts.some((item) => item.id === current) ? current : (nextProducts[0]?.id ?? null)));
    } catch {
      if (requestId !== refreshRequest.current) return;
      setError(t('production.batchView.refreshFailed'));
      setUsingCachedData(hasCachedData);
    } finally {
      if (requestId === refreshRequest.current) setLoading(false);
    }
  }, [applyCachedReadModels, branchId, canRead, isOnline, organizationId, t]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const productMap = useMemo(() => new Map(products.map((item) => [item.id, item.name])), [products]);
  const visibleBatches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return batches
      .filter((batch) => {
        const safety = batchSafetyStatus(batch.status, batch.expiry_date);
        const name = productMap.get(batch.product_id) ?? '';
        return (
          (statusFilter === 'ALL' || safety === statusFilter) &&
          (!needle || name.toLocaleLowerCase().includes(needle) || batch.lot_number.toLocaleLowerCase().includes(needle))
        );
      })
      .sort((left, right) => left.expiry_date.localeCompare(right.expiry_date));
  }, [batches, productMap, query, statusFilter]);
  const stale = isSnapshotStale(syncedAt ? { data: null, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS);

  const submit = async () => {
    if (!organizationId || !branchId || !productId || !lotNumber.trim() || !expiryDate.trim() || !mutationsAuthorized) return;
    setSaving(true);
    setError(null);
    try {
      await createBatch({
        organization_id: organizationId,
        branch_id: branchId,
        product_id: productId,
        lot_number: lotNumber.trim(),
        expiry_date: expiryDate.trim(),
        purchase_cost: purchaseCost.trim() ? Number(purchaseCost) : null,
        selling_price: sellingPrice.trim() ? Number(sellingPrice) : null,
        status,
        notes: notes.trim() || null,
      });
      setLotNumber('');
      setExpiryDate('');
      setPurchaseCost('');
      setSellingPrice('');
      setStatus('ACTIVE');
      setNotes('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSaving(false);
    }
  };

  const money = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: organization?.currency_code ?? 'XOF',
          maximumFractionDigits: 2,
        }).format(value);
  if (!canRead)
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text>{t('production.inventoryView.cannotRead')}</Text>
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.container, width < breakpoints.compact && styles.compactContainer]}>
        <View style={styles.headerRow}>
          <View style={styles.grow}>
            <Text accessibilityRole="header" style={styles.title}>
              {t('catalog.batches')}
            </Text>
            <Text style={styles.subtitle}>{t('catalog.batchesSubtitle')}</Text>
          </View>
          <Link href="/products" asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>{t('catalog.manageProducts')}</Text>
            </Pressable>
          </Link>
        </View>
        <ReadModelStatus
          hasData={syncedAt !== null}
          loading={loading}
          stale={stale}
          syncedAt={syncedAt}
          usingCachedData={usingCachedData}
        />
        <Text style={styles.safetyNote}>{t('production.batchView.safetyNote')}</Text>
        {!isOnline ? (
          <Text accessibilityRole="alert" style={styles.offlineNote}>
            {t('production.batchView.offlineReadOnly')}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Text style={styles.sectionLabel}>{t('catalog.selectBranch')}</Text>
        <View style={styles.chips}>
          {branches.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setBranchId(item.id)}
              style={[styles.chip, item.id === branchId && styles.chipSelected]}
            >
              <Text style={[styles.chipText, item.id === branchId && styles.chipTextSelected]}>{item.name}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <TextInput
            accessibilityLabel={t('production.batchView.search')}
            onChangeText={setQuery}
            placeholder={t('production.batchView.search')}
            style={styles.input}
            value={query}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRow}>
              {FILTER_STATUSES.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setStatusFilter(item)}
                  style={[styles.chip, item === statusFilter && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, item === statusFilter && styles.chipTextSelected]}>
                    {item === 'ALL' ? t('production.batchView.allStatuses') : t(`production.batchStatus.${item.toLowerCase()}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          {!loading && batches.length === 0 ? <Text style={styles.meta}>{t('catalog.noBatches')}</Text> : null}
          {batches.length > 0 && visibleBatches.length === 0 ? (
            <Text style={styles.meta}>{t('production.batchView.noFilteredBatches')}</Text>
          ) : null}
          {desktopTable && visibleBatches.length > 0 ? (
            <View accessibilityRole="list" style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.tableHeading, styles.productColumn]}>{t('catalog.name')}</Text>
                <Text style={[styles.tableHeading, styles.lotColumn]}>{t('catalog.lotNumber')}</Text>
                <Text style={[styles.tableHeading, styles.expiryColumn]}>{t('catalog.expiryDate')}</Text>
                <Text style={[styles.tableHeading, styles.statusColumn]}>{t('catalog.status')}</Text>
                <Text style={[styles.tableHeading, styles.moneyColumn]}>{t('catalog.purchaseCost')}</Text>
                <Text style={[styles.tableHeading, styles.moneyColumn]}>{t('catalog.sellingPrice')}</Text>
              </View>
              {visibleBatches.map((batch) => (
                <View key={batch.id} style={styles.tableRow}>
                  <Text style={[styles.batchName, styles.productColumn]}>
                    {productMap.get(batch.product_id) ?? batch.product_id.slice(0, 8)}
                  </Text>
                  <Text style={[styles.meta, styles.lotColumn]}>{batch.lot_number}</Text>
                  <Text style={[styles.meta, styles.expiryColumn]}>
                    {formatDateOnly(batch.expiry_date, i18n.language)}
                  </Text>
                  <View style={styles.statusColumn}>
                    <BatchStatusBadge status={batchSafetyStatus(batch.status, batch.expiry_date)} />
                  </View>
                  <Text style={[styles.meta, styles.moneyColumn]}>{money(batch.purchase_cost)}</Text>
                  <Text style={[styles.meta, styles.moneyColumn]}>{money(batch.selling_price)}</Text>
                </View>
              ))}
            </View>
          ) : (
            visibleBatches.map((batch) => (
              <View accessibilityRole="summary" key={batch.id} style={styles.batchCard}>
                <View style={styles.headerRow}>
                  <View style={styles.grow}>
                    <Text style={styles.batchName}>{productMap.get(batch.product_id) ?? batch.product_id.slice(0, 8)}</Text>
                    <Text style={styles.meta}>
                      {t('catalog.lotNumber')}: {batch.lot_number}
                    </Text>
                  </View>
                  <BatchStatusBadge status={batchSafetyStatus(batch.status, batch.expiry_date)} />
                </View>
                <Text style={styles.meta}>
                  {t('catalog.expiryDate')}: {formatDateOnly(batch.expiry_date, i18n.language)}
                </Text>
                <View style={styles.costRow}>
                  <Text style={styles.meta}>
                    {t('catalog.purchaseCost')}: {money(batch.purchase_cost)}
                  </Text>
                  <Text style={styles.meta}>
                    {t('catalog.sellingPrice')}: {money(batch.selling_price)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {canCreate && mutationsAuthorized && branchId && products.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('catalog.addBatch')}</Text>
            <Text style={styles.sectionLabel}>{t('catalog.selectProduct')}</Text>
            <View style={styles.chips}>
              {products.slice(0, 50).map((product) => (
                <Pressable
                  key={product.id}
                  onPress={() => setProductId(product.id)}
                  style={[styles.chip, product.id === productId && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, product.id === productId && styles.chipTextSelected]}>{product.name}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={lotNumber} onChangeText={setLotNumber} placeholder={t('catalog.lotNumber')} style={styles.input} />
            <TextInput
              value={expiryDate}
              onChangeText={setExpiryDate}
              placeholder={t('catalog.expiryDate')}
              style={styles.input}
              autoCapitalize="none"
            />
            <View style={styles.costRow}>
              <TextInput
                value={purchaseCost}
                onChangeText={setPurchaseCost}
                placeholder={t('catalog.purchaseCost')}
                style={[styles.input, styles.grow]}
                keyboardType="decimal-pad"
              />
              <TextInput
                value={sellingPrice}
                onChangeText={setSellingPrice}
                placeholder={t('catalog.sellingPrice')}
                style={[styles.input, styles.grow]}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.sectionLabel}>{t('catalog.status')}</Text>
            <View style={styles.chips}>
              {BATCH_STATUSES.map((item) => (
                <Pressable key={item} onPress={() => setStatus(item)} style={[styles.chip, item === status && styles.chipSelected]}>
                  <Text style={[styles.chipText, item === status && styles.chipTextSelected]}>
                    {t(`production.batchStatus.${item.toLowerCase()}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={notes} onChangeText={setNotes} placeholder={t('catalog.notes')} style={styles.input} />
            <Pressable
              disabled={saving || !productId || !lotNumber.trim() || !expiryDate.trim()}
              onPress={() => void submit()}
              style={[styles.primaryButton, (saving || !productId || !lotNumber.trim() || !expiryDate.trim()) && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>{saving ? t('common.loading') : t('common.save')}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: {
    padding: spacing.xl,
    gap: spacing.lg,
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
  },
  compactContainer: { padding: spacing.md },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  grow: { flex: 1, minWidth: 180 },
  title: { fontSize: 28, fontWeight: '800', color: colors.primary },
  subtitle: { fontSize: 15, color: colors.muted },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.primary },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.muted },
  batchName: { fontSize: 15, fontWeight: '800', color: colors.text },
  meta: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  safetyNote: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  offlineNote: { color: colors.warning, fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 1,
  },
  batchCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  costRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  tableRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#EAECF0',
  },
  tableHeader: { minHeight: 42, backgroundColor: '#F9FAFB' },
  tableHeading: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  productColumn: { flex: 2, minWidth: 150 },
  lotColumn: { flex: 1, minWidth: 100 },
  expiryColumn: { flex: 1, minWidth: 120 },
  statusColumn: { flex: 1, minWidth: 120 },
  moneyColumn: { flex: 1, minWidth: 100, textAlign: 'right' },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  chip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: colors.surface },
  primaryButton: {
    minHeight: touchTarget,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: colors.surface, fontWeight: '800' },
  secondaryButton: {
    minHeight: touchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#98A2B3',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: { color: colors.text, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
