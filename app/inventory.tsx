import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '@/utils/dateFormatting';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { BatchStatusBadge } from '@/components/BatchStatusBadge';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { Alert, Button, TextField } from '@/components/ui/controls';
import { PageHeader, Surface } from '@/components/ui/layout';
import { CardTitle, MetadataText, SupportingText } from '@/components/ui/typography';
import { batchSafetyStatus, isBatchSellable, sortBalancesForFefoDisplay, type BatchSafetyStatus } from '@/domain/inventorySafety';
import { formatInventoryMovementType } from '@/domain/inventoryMovementPresentation';
import { LocalStore } from '@/offline/localStore';
import {
  cacheBatches,
  cacheInventoryReadModel,
  cacheProducts,
  getCachedBatches,
  getCachedInventoryReadModel,
  getCachedProducts,
  isSnapshotStale,
  OPERATIONAL_READ_MODEL_MAX_AGE_MS,
} from '@/offline/readModels';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { loadBatches, loadProducts, type Batch, type ProductListItem } from '@/services/catalog';
import {
  completeStockCount,
  createStockCount,
  loadInventoryBalances,
  loadInventoryMovements,
  postInventoryMovement,
  upsertStockCountLine,
  type InventoryBalanceItem,
  type InventoryMovement,
} from '@/services/inventory';
import { breakpoints, colors, radii, semantic, spacing, touchTarget } from '@/theme/tokens';

const localStore = new LocalStore();
const FILTER_STATUSES: ('ALL' | BatchSafetyStatus)[] = ['ALL', 'ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED'];

function SelectableChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={onPress} style={[styles.chip, selected && styles.chipSelected, focused && styles.chipFocused]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

export default function InventoryScreen() {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const { isOnline } = useConnectivity();
  const { organization, branches, branch, setBranchId, can, usingCachedData: usingCachedPermissions } = useOrganization();
  const organizationId = organization?.id ?? null;
  const branchId = branch?.id ?? null;
  const [balances, setBalances] = useState<InventoryBalanceItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [countMode, setCountMode] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof FILTER_STATUSES)[number]>('ALL');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const refreshRequest = useRef(0);

  const canRead = can('inventory.read');
  const canAdjust = can('inventory.adjust');
  const canCount = can('inventory.count');
  const mutationsAuthorized = isOnline && !usingCachedPermissions;
  const desktopTable = width >= breakpoints.tablet;

  const applyCachedReadModels = useCallback(() => {
    if (!organizationId || !branchId) return false;
    const inventory = getCachedInventoryReadModel(localStore, organizationId, branchId);
    const cachedBatches = getCachedBatches(localStore, organizationId, branchId);
    const cachedProducts = getCachedProducts(localStore, organizationId);
    if (inventory) {
      setBalances(inventory.data.balances);
      setMovements(inventory.data.movements);
      setSyncedAt(inventory.syncedAt);
      setUsingCachedData(true);
    } else {
      setBalances([]);
      setMovements([]);
      setSyncedAt(null);
      setUsingCachedData(false);
    }
    setBatches(cachedBatches?.data ?? []);
    setProducts(
      cachedProducts
        ? cachedProducts.data.map((product) => ({
            ...product,
            primaryBarcode: null,
          }))
        : [],
    );
    return Boolean(inventory);
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
      const [nextBalances, nextMovements, nextBatches, nextProducts] = await Promise.all([
        loadInventoryBalances(organizationId, branchId),
        loadInventoryMovements(organizationId, branchId, 50),
        loadBatches(organizationId, branchId),
        loadProducts(organizationId),
      ]);
      if (requestId !== refreshRequest.current) return;
      const nextSyncedAt = new Date().toISOString();
      cacheInventoryReadModel(localStore, organizationId, branchId, { balances: nextBalances, movements: nextMovements }, nextSyncedAt);
      cacheBatches(localStore, organizationId, branchId, nextBatches, nextSyncedAt);
      cacheProducts(localStore, organizationId, nextProducts, nextSyncedAt);
      setBalances(nextBalances);
      setMovements(nextMovements);
      setBatches(nextBatches);
      setProducts(nextProducts);
      setSyncedAt(nextSyncedAt);
      setUsingCachedData(false);
      setSelectedBatchId((current) =>
        current && nextBatches.some((item) => item.id === current) ? current : (nextBatches[0]?.id ?? null),
      );
    } catch {
      if (requestId !== refreshRequest.current) return;
      setError(t('production.inventoryView.refreshFailed'));
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
  const visibleBalances = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sortBalancesForFefoDisplay(
      balances.filter((item) => {
        const safety = batchSafetyStatus(item.batch_status, item.expiry_date);
        return (
          (statusFilter === 'ALL' || safety === statusFilter) &&
          (!needle || item.product_name.toLocaleLowerCase().includes(needle) || item.lot_number.toLocaleLowerCase().includes(needle))
        );
      }),
    );
  }, [balances, query, statusFilter]);
  const stale = isSnapshotStale(syncedAt ? { data: null, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS);

  const refreshAfterWrite = async () => {
    if (!organizationId || !branchId || !mutationsAuthorized) return;
    const [nextBalances, nextMovements] = await Promise.all([
      loadInventoryBalances(organizationId, branchId),
      loadInventoryMovements(organizationId, branchId, 50),
    ]);
    const nextSyncedAt = new Date().toISOString();
    cacheInventoryReadModel(localStore, organizationId, branchId, { balances: nextBalances, movements: nextMovements }, nextSyncedAt);
    setBalances(nextBalances);
    setMovements(nextMovements);
    setSyncedAt(nextSyncedAt);
    setUsingCachedData(false);
  };

  const submitAdjustment = async () => {
    if (!organizationId || !branchId || !selectedBatchId || !mutationsAuthorized) return;
    const absolute = Math.abs(Number(quantity));
    if (!Number.isFinite(absolute) || absolute <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await postInventoryMovement({
        organizationId,
        branchId,
        batchId: selectedBatchId,
        movementType: direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantityDelta: direction === 'IN' ? absolute : -absolute,
        reason: reason.trim() || undefined,
      });
      setQuantity('');
      setReason('');
      await refreshAfterWrite();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('INSUFFICIENT_STOCK') ? t('inventory.insufficientStock') : t(errorPresentationKey(cause)));
    } finally {
      setSaving(false);
    }
  };

  const submitStockCount = async () => {
    if (!organizationId || !branchId || !mutationsAuthorized) return;
    const entries = Object.entries(counted).filter(([, value]) => value.trim() !== '');
    if (!entries.length) return;
    setSaving(true);
    setError(null);
    try {
      const count = await createStockCount({ organizationId, branchId });
      for (const [batchId, value] of entries) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0)
          await upsertStockCountLine({
            stockCountId: count.id,
            organizationId,
            branchId,
            batchId,
            countedQuantity: parsed,
          });
      }
      await completeStockCount(count.id);
      setCounted({});
      setCountMode(false);
      await refreshAfterWrite();
    } catch (cause) {
      setError(t(errorPresentationKey(cause)));
    } finally {
      setSaving(false);
    }
  };

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
          title={t('inventory.title')}
          subtitle={t('inventory.subtitle')}
          action={<Link href="/batches" asChild><Button label={t('catalog.manageBatches')} variant="secondary" /></Link>}
        />
        <ReadModelStatus
          hasData={syncedAt !== null}
          loading={loading}
          stale={stale}
          syncedAt={syncedAt}
          usingCachedData={usingCachedData}
        />
        <SupportingText style={styles.authorityNote}>{t('production.inventoryView.ledgerAuthority')}</SupportingText>
        {!isOnline ? (
          <Alert tone="warning" title={t('production.inventoryView.offlineReadOnly')} />
        ) : null}
        {error ? (
          <Alert tone="danger" title={error} />
        ) : null}
        <Text style={styles.sectionLabel}>{t('organization.branch')}</Text>
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
          <View style={styles.headerRow}>
            <CardTitle>{t('inventory.balances')}</CardTitle>
            {canCount && mutationsAuthorized ? (
              <Button label={countMode ? t('common.cancel') : t('inventory.stockCount')} onPress={() => setCountMode((value) => !value)} variant="secondary" />
            ) : null}
          </View>
          <TextField
            accessibilityLabel={t('production.inventoryView.search')}
            onChangeText={setQuery}
            placeholder={t('production.inventoryView.search')}
            style={styles.input}
            value={query}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRow}>
              {FILTER_STATUSES.map((item) => (
                <SelectableChip
                  key={item}
                  label={item === 'ALL' ? t('production.inventoryView.allStatuses') : t(`production.batchStatus.${item.toLowerCase()}`)}
                  onPress={() => setStatusFilter(item)}
                  selected={item === statusFilter}
                />
              ))}
            </View>
          </ScrollView>
          {!loading && balances.length === 0 ? <SupportingText>{t('inventory.noStock')}</SupportingText> : null}
          {balances.length > 0 && visibleBalances.length === 0 ? (
            <SupportingText>{t('production.inventoryView.noFilteredStock')}</SupportingText>
          ) : null}
          {desktopTable && visibleBalances.length > 0 ? (
            <InventoryTable balances={visibleBalances} countMode={countMode} counted={counted} onCounted={setCounted} />
          ) : (
            visibleBalances.map((item) => (
              <InventoryCard
                balance={item}
                countMode={countMode}
                counted={counted[item.batch_id] ?? ''}
                key={item.batch_id}
                onCounted={(value) =>
                  setCounted((current) => ({
                    ...current,
                    [item.batch_id]: value,
                  }))
                }
              />
            ))
          )}
          {countMode ? (
            <Button disabled={saving} label={saving ? t('common.loading') : t('inventory.reconcile')} loading={saving} onPress={() => void submitStockCount()} />
          ) : null}
        </Surface>

        {canAdjust && mutationsAuthorized && branchId && batches.length > 0 ? (
          <Surface tone="default" style={styles.card}>
            <CardTitle>{t('inventory.adjustment')}</CardTitle>
            <Text style={styles.sectionLabel}>{t('catalog.selectProduct')}</Text>
            <View style={styles.chips}>
              {batches.slice(0, 60).map((item) => (
                <SelectableChip
                  key={item.id}
                  label={`${productMap.get(item.product_id) ?? item.product_id.slice(0, 8)} · ${item.lot_number}`}
                  onPress={() => setSelectedBatchId(item.id)}
                  selected={item.id === selectedBatchId}
                />
              ))}
            </View>
            <View style={styles.chips}>
              <SelectableChip label={t('inventory.increase')} onPress={() => setDirection('IN')} selected={direction === 'IN'} />
              <SelectableChip label={t('inventory.decrease')} onPress={() => setDirection('OUT')} selected={direction === 'OUT'} />
            </View>
            <TextField
              accessibilityLabel={t('inventory.quantity')}
              keyboardType="decimal-pad"
              onChangeText={setQuantity}
              placeholder={t('inventory.quantity')}
              style={styles.input}
              value={quantity}
            />
            <TextField accessibilityLabel={t('inventory.reason')} onChangeText={setReason} placeholder={t('inventory.reason')} style={styles.input} value={reason} />
            <Button disabled={saving || !quantity.trim()} label={saving ? t('common.loading') : t('inventory.postAdjustment')} loading={saving} onPress={() => void submitAdjustment()} />
          </Surface>
        ) : null}

        <Surface tone="default" style={styles.card}>
          <CardTitle>{t('inventory.recentMovements')}</CardTitle>
          <SupportingText style={styles.authorityNote}>{t('production.inventoryView.ledgerAuthority')}</SupportingText>
          {movements.length === 0 ? <SupportingText>{t('inventory.noMovements')}</SupportingText> : null}
          {movements.map((movement) => (
            <View key={movement.id} style={styles.movementRow}>
              <Text style={styles.movementType}>{formatInventoryMovementType(movement.movement_type, t)}</Text>
              <Text style={[styles.quantity, movement.quantity_delta < 0 && styles.negative]}>
                {movement.quantity_delta > 0 ? '+' : ''}
                {movement.quantity_delta}
              </Text>
              <MetadataText style={styles.movementMeta}>
                {new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(movement.occurred_at))}
              </MetadataText>
            </View>
          ))}
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

type CountProps = {
  countMode: boolean;
  counted: Record<string, string>;
  onCounted: React.Dispatch<React.SetStateAction<Record<string, string>>>;
};

function InventoryTable({ balances, countMode, counted, onCounted }: { balances: InventoryBalanceItem[] } & CountProps) {
  const { t, i18n } = useTranslation();
  return (
    <View accessibilityRole="list" style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeader]}>
        <Text style={[styles.tableHeading, styles.productColumn]}>{t('catalog.name')}</Text>
        <Text style={[styles.tableHeading, styles.lotColumn]}>{t('catalog.lotNumber')}</Text>
        <Text style={[styles.tableHeading, styles.expiryColumn]}>{t('catalog.expiryDate')}</Text>
        <Text style={[styles.tableHeading, styles.statusColumn]}>{t('production.inventoryView.status')}</Text>
        <Text style={[styles.tableHeading, styles.numberColumn]}>{t('inventory.onHand')}</Text>
        <Text style={[styles.tableHeading, styles.numberColumn]}>{t('production.inventoryView.available')}</Text>
      </View>
      {balances.map((item) => {
        const safety = batchSafetyStatus(item.batch_status, item.expiry_date);
        const sellable = isBatchSellable(item.batch_status, item.expiry_date);
        return (
          <View key={item.batch_id} style={styles.tableRow}>
            <Text style={[styles.productName, styles.productColumn]}>{item.product_name}</Text>
            <Text style={[styles.meta, styles.lotColumn]}>{item.lot_number}</Text>
            <Text style={[styles.meta, styles.expiryColumn]}>
              {formatDateOnly(item.expiry_date, i18n.language)}
            </Text>
            <View style={styles.statusColumn}>
              <BatchStatusBadge status={safety} />
            </View>
            <Text style={[styles.quantity, styles.numberColumn]}>{item.on_hand_quantity}</Text>
            <Text style={[styles.quantity, styles.numberColumn, !sellable && styles.unavailable]}>
              {sellable ? item.available_quantity : t('production.inventoryView.notSellable')}
            </Text>
            {countMode ? (
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={(value) =>
                  onCounted((current) => ({
                    ...current,
                    [item.batch_id]: value,
                  }))
                }
                placeholder={t('inventory.counted')}
                style={styles.countInput}
                value={counted[item.batch_id] ?? ''}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function InventoryCard({
  balance,
  countMode,
  counted,
  onCounted,
}: {
  balance: InventoryBalanceItem;
  countMode: boolean;
  counted: string;
  onCounted: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const safety = batchSafetyStatus(balance.batch_status, balance.expiry_date);
  const sellable = isBatchSellable(balance.batch_status, balance.expiry_date);
  return (
    <View accessibilityRole="summary" style={[styles.stockCard, !sellable && styles.stockCardBlocked]}>
      <View style={styles.headerRow}>
        <Text style={styles.productName}>{balance.product_name}</Text>
        <BatchStatusBadge status={safety} />
      </View>
      <Text style={styles.meta}>
        {t('catalog.lotNumber')}: {balance.lot_number}
      </Text>
      <Text style={styles.meta}>
        {t('catalog.expiryDate')}: {formatDateOnly(balance.expiry_date, i18n.language)}
      </Text>
      <View style={styles.metrics}>
        <Text style={styles.metric}>
          {t('inventory.onHand')}: {balance.on_hand_quantity}
        </Text>
        <Text style={styles.metric}>
          {t('production.inventoryView.reserved')}: {balance.reserved_quantity}
        </Text>
        <Text style={[styles.metric, !sellable && styles.unavailable]}>
          {sellable
            ? `${t('production.inventoryView.available')}: ${balance.available_quantity}`
            : t('production.inventoryView.notSellable')}
        </Text>
      </View>
      {countMode ? (
        <TextInput
          keyboardType="decimal-pad"
          onChangeText={onCounted}
          placeholder={t('inventory.counted')}
          style={styles.countInput}
          value={counted}
        />
      ) : null}
    </View>
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
  productName: { fontSize: 15, fontWeight: '800', color: colors.text },
  meta: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  authorityNote: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  offlineNote: { color: colors.warning, fontWeight: '700', fontSize: 13 },
  card: {
    gap: spacing.md,
  },
  stockCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metric: { color: colors.text, fontWeight: '700', fontSize: 13 },
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
  numberColumn: { width: 86, textAlign: 'right' },
  movementRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  movementType: {
    flex: 1,
    minWidth: 160,
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  stockCardBlocked: { backgroundColor: semantic.danger.background, borderColor: semantic.danger.border },
  movementMeta: { flexShrink: 1, textAlign: 'right' },
  quantity: { fontSize: 15, fontWeight: '800', color: colors.success },
  unavailable: { color: colors.danger, fontSize: 12 },
  negative: { color: colors.danger },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  countInput: {
    minWidth: 110,
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
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
