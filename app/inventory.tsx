import { useEffect, useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
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

export default function InventoryScreen() {
  const { t } = useTranslation();
  const { organization, branches, branch, setBranchId, can } = useOrganization();
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRead = can('inventory.read');
  const canAdjust = can('inventory.adjust');
  const canCount = can('inventory.count');

  useEffect(() => {
    if (!organization || !branch || !canRead) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const [nextBalances, nextMovements, nextBatches, nextProducts] = await Promise.all([
            loadInventoryBalances(organization.id, branch.id),
            loadInventoryMovements(organization.id, branch.id, 50),
            loadBatches(organization.id, branch.id),
            loadProducts(organization.id),
          ]);
          if (cancelled) return;
          setBalances(nextBalances);
          setMovements(nextMovements);
          setBatches(nextBatches);
          setProducts(nextProducts);
          setSelectedBatchId((current) => current && nextBatches.some((item) => item.id === current) ? current : nextBatches[0]?.id ?? null);
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [organization, branch, canRead]);

  const productMap = useMemo(() => new Map(products.map((item) => [item.id, item.name])), [products]);

  const refreshAfterWrite = async () => {
    if (!organization || !branch) return;
    const [nextBalances, nextMovements] = await Promise.all([
      loadInventoryBalances(organization.id, branch.id),
      loadInventoryMovements(organization.id, branch.id, 50),
    ]);
    setBalances(nextBalances);
    setMovements(nextMovements);
  };

  const submitAdjustment = async () => {
    if (!organization || !branch || !selectedBatchId) return;
    const absolute = Math.abs(Number(quantity));
    if (!Number.isFinite(absolute) || absolute <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await postInventoryMovement({
        organizationId: organization.id,
        branchId: branch.id,
        batchId: selectedBatchId,
        movementType: direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantityDelta: direction === 'IN' ? absolute : -absolute,
        reason: reason.trim() || undefined,
      });
      setQuantity('');
      setReason('');
      await refreshAfterWrite();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'UNKNOWN_ERROR';
      setError(message.includes('INSUFFICIENT_STOCK') ? t('inventory.insufficientStock') : message);
    } finally {
      setSaving(false);
    }
  };

  const submitStockCount = async () => {
    if (!organization || !branch) return;
    const entries = Object.entries(counted).filter(([, value]) => value.trim() !== '');
    if (!entries.length) return;
    setSaving(true);
    setError(null);
    try {
      const count = await createStockCount({ organizationId: organization.id, branchId: branch.id });
      for (const [batchId, value] of entries) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) continue;
        await upsertStockCountLine({
          stockCountId: count.id,
          organizationId: organization.id,
          branchId: branch.id,
          batchId,
          countedQuantity: parsed,
        });
      }
      await completeStockCount(count.id);
      setCounted({});
      setCountMode(false);
      await refreshAfterWrite();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.grow}>
            <Text style={styles.title}>{t('inventory.title')}</Text>
            <Text style={styles.subtitle}>{t('inventory.subtitle')}</Text>
          </View>
          <View style={styles.actions}>
            <Link href="/batches" asChild><Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('catalog.manageBatches')}</Text></Pressable></Link>
            <Link href="/" asChild><Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('organization.back')}</Text></Pressable></Link>
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t('organization.branch')}</Text>
        <View style={styles.chips}>
          {branches.map((item) => (
            <Pressable key={item.id} onPress={() => setBranchId(item.id)} style={[styles.chip, item.id === branch?.id && styles.chipSelected]}>
              <Text style={[styles.chipText, item.id === branch?.id && styles.chipTextSelected]}>{item.name}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <Text style={styles.meta}>{t('common.loading')}</Text> : null}

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>{t('inventory.balances')}</Text>
            {canCount ? (
              <Pressable onPress={() => setCountMode((value) => !value)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{countMode ? t('common.cancel') : t('inventory.stockCount')}</Text>
              </Pressable>
            ) : null}
          </View>
          {!loading && balances.length === 0 ? <Text style={styles.meta}>{t('inventory.noStock')}</Text> : null}
          {balances.map((item) => (
            <View key={item.batch_id} style={styles.balanceRow}>
              <View style={styles.grow}>
                <Text style={styles.productName}>{item.product_name}</Text>
                <Text style={styles.meta}>{t('catalog.lotNumber')}: {item.lot_number} · {t('catalog.expiryDate')}: {item.expiry_date}</Text>
              </View>
              <View style={styles.quantityBlock}>
                <Text style={styles.quantity}>{item.on_hand_quantity}</Text>
                <Text style={styles.meta}>{t('inventory.onHand')}</Text>
              </View>
              {countMode ? (
                <TextInput
                  keyboardType="decimal-pad"
                  onChangeText={(value) => setCounted((current) => ({ ...current, [item.batch_id]: value }))}
                  placeholder={t('inventory.counted')}
                  style={styles.countInput}
                  value={counted[item.batch_id] ?? ''}
                />
              ) : null}
            </View>
          ))}
          {countMode ? (
            <Pressable disabled={saving} onPress={() => void submitStockCount()} style={[styles.primaryButton, saving && styles.disabled]}>
              <Text style={styles.primaryButtonText}>{saving ? t('common.loading') : t('inventory.reconcile')}</Text>
            </Pressable>
          ) : null}
        </View>

        {canAdjust && branch && batches.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('inventory.adjustment')}</Text>
            <Text style={styles.sectionLabel}>{t('catalog.selectProduct')}</Text>
            <View style={styles.chips}>
              {batches.slice(0, 60).map((item) => (
                <Pressable key={item.id} onPress={() => setSelectedBatchId(item.id)} style={[styles.chip, item.id === selectedBatchId && styles.chipSelected]}>
                  <Text style={[styles.chipText, item.id === selectedBatchId && styles.chipTextSelected]}>
                    {productMap.get(item.product_id) ?? item.product_id.slice(0, 8)} · {item.lot_number}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.chips}>
              <Pressable onPress={() => setDirection('IN')} style={[styles.chip, direction === 'IN' && styles.chipSelected]}>
                <Text style={[styles.chipText, direction === 'IN' && styles.chipTextSelected]}>{t('inventory.increase')}</Text>
              </Pressable>
              <Pressable onPress={() => setDirection('OUT')} style={[styles.chip, direction === 'OUT' && styles.chipSelected]}>
                <Text style={[styles.chipText, direction === 'OUT' && styles.chipTextSelected]}>{t('inventory.decrease')}</Text>
              </Pressable>
            </View>
            <TextInput keyboardType="decimal-pad" onChangeText={setQuantity} placeholder={t('inventory.quantity')} style={styles.input} value={quantity} />
            <TextInput onChangeText={setReason} placeholder={t('inventory.reason')} style={styles.input} value={reason} />
            <Pressable disabled={saving || !quantity.trim()} onPress={() => void submitAdjustment()} style={[styles.primaryButton, (saving || !quantity.trim()) && styles.disabled]}>
              <Text style={styles.primaryButtonText}>{saving ? t('common.loading') : t('inventory.postAdjustment')}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('inventory.recentMovements')}</Text>
          {movements.length === 0 ? <Text style={styles.meta}>{t('inventory.noMovements')}</Text> : null}
          {movements.map((movement) => (
            <View key={movement.id} style={styles.movementRow}>
              <Text style={styles.movementType}>{movement.movement_type}</Text>
              <Text style={[styles.quantity, movement.quantity_delta < 0 && styles.negative]}>{movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta}</Text>
              <Text style={styles.meta}>{new Date(movement.occurred_at).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6F8FC' },
  container: { padding: 24, gap: 16, width: '100%', maxWidth: 1040, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 180 },
  title: { fontSize: 28, fontWeight: '800', color: '#102A5C' },
  subtitle: { fontSize: 15, color: '#667085' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#46536A' },
  productName: { fontSize: 16, fontWeight: '700', color: '#102A5C' },
  meta: { color: '#667085', fontSize: 13 },
  error: { color: '#9F1239', fontSize: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, gap: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 1 },
  balanceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#EAECF0', paddingVertical: 10 },
  movementRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#EAECF0', paddingVertical: 8 },
  movementType: { flex: 1, minWidth: 160, color: '#344159', fontWeight: '700', fontSize: 13 },
  quantityBlock: { minWidth: 90, alignItems: 'flex-end' },
  quantity: { fontSize: 18, fontWeight: '800', color: '#067647' },
  negative: { color: '#B42318' },
  input: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#FFFFFF', color: '#101828' },
  countInput: { minWidth: 110, borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10, backgroundColor: '#FFFFFF', color: '#101828' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: '#102A5C', borderColor: '#102A5C' },
  chipText: { color: '#344159', fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#FFFFFF' },
  primaryButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#102A5C', paddingVertical: 12, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: '#98A2B3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  secondaryButtonText: { color: '#344159', fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
