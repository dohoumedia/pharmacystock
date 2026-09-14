import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '@/utils/dateFormatting';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { BatchStatusBadge } from '@/components/BatchStatusBadge';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { Alert, Button, FormField, TextField } from '@/components/ui/controls';
import { PageHeader, Surface } from '@/components/ui/layout';
import { CardTitle, SupportingText } from '@/components/ui/typography';
import { batchSafetyStatus, type BatchSafetyStatus } from '@/domain/inventorySafety';
import { canRemediateMissingBatchPrice, parsePositiveSellingPrice } from '@/domain/batchPricing';
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
import { createBatch, loadBatches, loadProducts, setMissingBatchSellingPrice, type Batch, type ProductListItem } from '@/services/catalog';
import { breakpoints, colors, radii, semantic, spacing, touchTarget } from '@/theme/tokens';

const BATCH_STATUSES = ['ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED'] as const;
const FILTER_STATUSES: ('ALL' | BatchSafetyStatus)[] = ['ALL', ...BATCH_STATUSES];
const localStore = new LocalStore();

function SelectableChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={onPress} style={[styles.chip, selected && styles.chipSelected, focused && styles.chipFocused]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

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
  const [remediationPrices, setRemediationPrices] = useState<Record<string, string>>({});
  const [savingPriceBatchId, setSavingPriceBatchId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
  const canUpdate = can('inventory.product.update');
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
  const parsedSellingPrice = parsePositiveSellingPrice(sellingPrice);
  const unpricedBatches = useMemo(() => batches.filter((batch) => batch.selling_price === null), [batches]);

  const submit = async () => {
    if (!organizationId || !branchId || !productId || !lotNumber.trim() || !expiryDate.trim() || !mutationsAuthorized) return;
    if (parsedSellingPrice === null) {
      setError(t('production.batchView.sellingPriceRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await createBatch({
        organization_id: organizationId,
        branch_id: branchId,
        product_id: productId,
        lot_number: lotNumber.trim(),
        expiry_date: expiryDate.trim(),
        purchase_cost: purchaseCost.trim() ? Number(purchaseCost) : null,
        selling_price: parsedSellingPrice,
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
      setError(t(errorPresentationKey(cause)));
    } finally {
      setSaving(false);
    }
  };

  const remediateSellingPrice = async (batch: Batch) => {
    if (!organizationId || !branchId || !canRemediateMissingBatchPrice({
      hasPermission: canUpdate,
      isOnline,
      usingCachedPermissions,
      sellingPrice: batch.selling_price,
    })) return;
    const price = parsePositiveSellingPrice(remediationPrices[batch.id] ?? '');
    if (price === null) {
      setError(t('production.batchView.sellingPriceRequired'));
      return;
    }
    setSavingPriceBatchId(batch.id);
    setError(null);
    setMessage(null);
    try {
      await setMissingBatchSellingPrice({
        batchId: batch.id,
        organizationId,
        branchId,
        sellingPrice: price,
      });
      setRemediationPrices((current) => {
        const next = { ...current };
        delete next[batch.id];
        return next;
      });
      setMessage(t('production.batchView.sellingPriceSaved', { lotNumber: batch.lot_number }));
      await refresh();
    } catch (cause) {
      const alreadySet = cause instanceof Error && cause.message === 'BATCH_SELLING_PRICE_ALREADY_SET';
      setError(alreadySet ? t('production.batchView.sellingPriceAlreadySet') : t(errorPresentationKey(cause)));
    } finally {
      setSavingPriceBatchId(null);
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
        <PageHeader
          title={t('catalog.batches')}
          subtitle={t('catalog.batchesSubtitle')}
          action={<Link href="/products" asChild><Button label={t('catalog.manageProducts')} variant="secondary" /></Link>}
        />
        <ReadModelStatus
          hasData={syncedAt !== null}
          loading={loading}
          stale={stale}
          syncedAt={syncedAt}
          usingCachedData={usingCachedData}
        />
        <SupportingText style={styles.safetyNote}>{t('production.batchView.safetyNote')}</SupportingText>
        {!isOnline ? (
          <Alert tone="warning" title={t('production.batchView.offlineReadOnly')} />
        ) : null}
        {error ? (
          <Alert tone="danger" title={error} />
        ) : null}
        {message ? <Alert tone="success" title={message} /> : null}
        <Text style={styles.sectionLabel}>{t('catalog.selectBranch')}</Text>
        <View style={styles.chips}>
          {branches.map((item) => (
            <SelectableChip
              key={item.id}
              label={item.name}
              onPress={() => setBranchId(item.id)}
              selected={item.id === branchId}
            />
          ))}
        </View>

        <Surface tone="raised" style={styles.card}>
          <TextField
            accessibilityLabel={t('production.batchView.search')}
            onChangeText={setQuery}
            placeholder={t('production.batchView.search')}
            style={styles.input}
            value={query}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRow}>
              {FILTER_STATUSES.map((item) => (
                <SelectableChip
                  key={item}
                  label={item === 'ALL' ? t('production.batchView.allStatuses') : t(`production.batchStatus.${item.toLowerCase()}`)}
                  onPress={() => setStatusFilter(item)}
                  selected={item === statusFilter}
                />
              ))}
            </View>
          </ScrollView>
          {!loading && batches.length === 0 ? <SupportingText>{t('catalog.noBatches')}</SupportingText> : null}
          {batches.length > 0 && visibleBatches.length === 0 ? (
            <SupportingText>{t('production.batchView.noFilteredBatches')}</SupportingText>
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
            visibleBatches.map((batch) => {
              const safety = batchSafetyStatus(batch.status, batch.expiry_date);
              return <View accessibilityRole="summary" key={batch.id} style={[styles.batchCard, safety !== 'ACTIVE' && styles.batchCardAttention]}>
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
              </View>;
            })
          )}
        </Surface>

        {canUpdate && mutationsAuthorized && unpricedBatches.length > 0 ? (
          <Surface tone="raised" style={styles.card}>
            <CardTitle>{t('production.batchView.unpricedTitle')}</CardTitle>
            <SupportingText>{t('production.batchView.unpricedDescription')}</SupportingText>
            {unpricedBatches.map((batch) => {
              const remediationValue = remediationPrices[batch.id] ?? '';
              const invalid = remediationValue.length > 0 && parsePositiveSellingPrice(remediationValue) === null;
              return (
                <View key={batch.id} style={styles.remediationRow}>
                  <View style={styles.grow}>
                    <Text style={styles.batchName}>{productMap.get(batch.product_id) ?? batch.product_id.slice(0, 8)}</Text>
                    <Text style={styles.meta}>{t('catalog.lotNumber')}: {batch.lot_number}</Text>
                  </View>
                  <FormField
                    label={t('catalog.sellingPrice')}
                    required
                    hint={t('production.batchView.sellingPriceHint')}
                    error={invalid ? t('production.batchView.sellingPriceRequired') : undefined}
                  >
                    <TextField
                      accessibilityLabel={`${productMap.get(batch.product_id) ?? batch.lot_number} ${t('catalog.sellingPrice')}`}
                      error={invalid}
                      keyboardType="decimal-pad"
                      onChangeText={(value) => setRemediationPrices((current) => ({ ...current, [batch.id]: value }))}
                      placeholder={t('catalog.sellingPrice')}
                      style={styles.priceInput}
                      value={remediationValue}
                    />
                  </FormField>
                  <Button
                    accessibilityLabel={`${t('production.batchView.setSellingPrice')}: ${batch.lot_number}`}
                    disabled={parsePositiveSellingPrice(remediationValue) === null || savingPriceBatchId !== null}
                    label={t('production.batchView.setSellingPrice')}
                    loading={savingPriceBatchId === batch.id}
                    onPress={() => void remediateSellingPrice(batch)}
                  />
                </View>
              );
            })}
          </Surface>
        ) : null}

        {canCreate && mutationsAuthorized && branchId && products.length > 0 ? (
          <Surface tone="default" style={styles.card}>
            <CardTitle>{t('catalog.addBatch')}</CardTitle>
            <Text style={styles.sectionLabel}>{t('catalog.selectProduct')}</Text>
            <View style={styles.chips}>
              {products.slice(0, 50).map((product) => (
                <SelectableChip
                  key={product.id}
                  label={product.name}
                  onPress={() => setProductId(product.id)}
                  selected={product.id === productId}
                />
              ))}
            </View>
            <TextField accessibilityLabel={t('catalog.lotNumber')} value={lotNumber} onChangeText={setLotNumber} placeholder={t('catalog.lotNumber')} style={styles.input} />
            <TextField
              accessibilityLabel={t('catalog.expiryDate')}
              value={expiryDate}
              onChangeText={setExpiryDate}
              placeholder={t('catalog.expiryDate')}
              style={styles.input}
              autoCapitalize="none"
            />
            <View style={styles.costRow}>
              <FormField label={t('catalog.purchaseCost')}>
                <TextField
                  accessibilityLabel={t('catalog.purchaseCost')}
                  value={purchaseCost}
                  onChangeText={setPurchaseCost}
                  placeholder={t('catalog.purchaseCost')}
                  style={styles.input}
                  keyboardType="decimal-pad"
                />
              </FormField>
              <FormField
                label={t('catalog.sellingPrice')}
                required
                hint={t('production.batchView.sellingPriceHint')}
                error={sellingPrice.length > 0 && parsedSellingPrice === null ? t('production.batchView.sellingPriceRequired') : undefined}
              >
                <TextField
                  accessibilityLabel={t('catalog.sellingPrice')}
                  error={sellingPrice.length > 0 && parsedSellingPrice === null}
                  value={sellingPrice}
                  onChangeText={setSellingPrice}
                  placeholder={t('catalog.sellingPrice')}
                  style={styles.input}
                  keyboardType="decimal-pad"
                />
              </FormField>
            </View>
            <Text style={styles.sectionLabel}>{t('catalog.status')}</Text>
            <View style={styles.chips}>
              {BATCH_STATUSES.map((item) => (
                <SelectableChip key={item} label={t(`production.batchStatus.${item.toLowerCase()}`)} onPress={() => setStatus(item)} selected={item === status} />
              ))}
            </View>
            <TextField accessibilityLabel={t('catalog.notes')} value={notes} onChangeText={setNotes} placeholder={t('catalog.notes')} style={styles.input} />
            <Button disabled={saving || !productId || !lotNumber.trim() || !expiryDate.trim()} label={saving ? t('common.loading') : t('common.save')} loading={saving} onPress={() => void submit()} />
          </Surface>
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
    gap: spacing.md,
  },
  batchCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  batchCardAttention: { backgroundColor: semantic.warning.background, borderColor: semantic.warning.border },
  costRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  remediationRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  priceInput: { minWidth: 180 },
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
    borderBottomColor: colors.border,
  },
  tableHeader: { minHeight: 42, backgroundColor: colors.background },
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
    maxWidth: '100%',
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipFocused: { borderWidth: 2, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
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
