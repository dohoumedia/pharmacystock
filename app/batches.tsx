import { useCallback, useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOrganization } from '@/providers/OrganizationProvider';
import { createBatch, loadBatches, loadProducts, type Batch, type ProductListItem } from '@/services/catalog';

const BATCH_STATUSES = ['ACTIVE', 'QUARANTINED', 'RECALLED', 'EXPIRED', 'DEPLETED', 'DISPOSED'] as const;

export default function BatchesScreen() {
  const { t } = useTranslation();
  const { organization, branches, branch, setBranchId, can } = useOrganization();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [lotNumber, setLotNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [status, setStatus] = useState<(typeof BATCH_STATUSES)[number]>('ACTIVE');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRead = can('inventory.read');
  const canCreate = can('inventory.product.create');

  const refresh = useCallback(async () => {
    if (!organization || !canRead) return;
    setLoading(true);
    setError(null);
    try {
      const [nextProducts, nextBatches] = await Promise.all([
        loadProducts(organization.id),
        loadBatches(organization.id, branch?.id),
      ]);
      setProducts(nextProducts);
      setBatches(nextBatches);
      setProductId((current) => current && nextProducts.some((item) => item.id === current) ? current : nextProducts[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setLoading(false);
    }
  }, [organization, branch, canRead]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const submit = async () => {
    if (!organization || !branch || !productId || !lotNumber.trim() || !expiryDate.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createBatch({
        organization_id: organization.id,
        branch_id: branch.id,
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

  const productName = (id: string) => products.find((item) => item.id === id)?.name ?? id.slice(0, 8);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{t('catalog.batches')}</Text>
            <Text style={styles.subtitle}>{t('catalog.batchesSubtitle')}</Text>
          </View>
          <View style={styles.actions}>
            <Link href="/products" asChild>
              <Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('catalog.manageProducts')}</Text></Pressable>
            </Link>
            <Link href="/" asChild>
              <Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('organization.back')}</Text></Pressable>
            </Link>
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t('catalog.selectBranch')}</Text>
        <View style={styles.chips}>
          {branches.map((item) => (
            <Pressable key={item.id} onPress={() => setBranchId(item.id)} style={[styles.chip, item.id === branch?.id && styles.chipSelected]}>
              <Text style={[styles.chipText, item.id === branch?.id && styles.chipTextSelected]}>{item.name}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <Text style={styles.meta}>{t('common.loading')}</Text> : null}
        {!loading && canRead && batches.length === 0 ? <Text style={styles.meta}>{t('catalog.noBatches')}</Text> : null}

        {batches.map((batch) => (
          <View key={batch.id} style={styles.card}>
            <View style={styles.batchHeader}>
              <View style={styles.grow}>
                <Text style={styles.batchName}>{productName(batch.product_id)}</Text>
                <Text style={styles.meta}>{t('catalog.lotNumber')}: {batch.lot_number}</Text>
              </View>
              <View style={styles.statusChip}><Text style={styles.statusText}>{batch.status}</Text></View>
            </View>
            <Text style={styles.meta}>{t('catalog.expiryDate')}: {batch.expiry_date}</Text>
            <Text style={styles.meta}>{t('catalog.purchaseCost')}: {batch.purchase_cost ?? '—'}</Text>
            <Text style={styles.meta}>{t('catalog.sellingPrice')}: {batch.selling_price ?? '—'}</Text>
          </View>
        ))}

        {canCreate && branch && products.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('catalog.addBatch')}</Text>
            <Text style={styles.sectionLabel}>{t('catalog.selectProduct')}</Text>
            <View style={styles.chips}>
              {products.slice(0, 50).map((product) => (
                <Pressable key={product.id} onPress={() => setProductId(product.id)} style={[styles.chip, product.id === productId && styles.chipSelected]}>
                  <Text style={[styles.chipText, product.id === productId && styles.chipTextSelected]}>{product.name}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput value={lotNumber} onChangeText={setLotNumber} placeholder={t('catalog.lotNumber')} style={styles.input} />
            <TextInput value={expiryDate} onChangeText={setExpiryDate} placeholder={t('catalog.expiryDate')} style={styles.input} autoCapitalize="none" />
            <View style={styles.row}>
              <TextInput value={purchaseCost} onChangeText={setPurchaseCost} placeholder={t('catalog.purchaseCost')} style={[styles.input, styles.grow]} keyboardType="decimal-pad" />
              <TextInput value={sellingPrice} onChangeText={setSellingPrice} placeholder={t('catalog.sellingPrice')} style={[styles.input, styles.grow]} keyboardType="decimal-pad" />
            </View>
            <Text style={styles.sectionLabel}>{t('catalog.status')}</Text>
            <View style={styles.chips}>
              {BATCH_STATUSES.map((item) => (
                <Pressable key={item} onPress={() => setStatus(item)} style={[styles.chip, item === status && styles.chipSelected]}>
                  <Text style={[styles.chipText, item === status && styles.chipTextSelected]}>{item}</Text>
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
  safeArea: { flex: 1, backgroundColor: '#F6F8FC' },
  container: { padding: 24, gap: 16, width: '100%', maxWidth: 980, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  headerText: { flex: 1, minWidth: 260, gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#102A5C' },
  subtitle: { fontSize: 15, color: '#667085' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#46536A' },
  batchName: { fontSize: 18, fontWeight: '700', color: '#102A5C' },
  meta: { color: '#667085', fontSize: 13 },
  error: { color: '#9F1239', fontSize: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 1 },
  batchHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  grow: { flex: 1, minWidth: 180 },
  input: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#FFFFFF', color: '#101828' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#D0D5DD', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: '#102A5C', borderColor: '#102A5C' },
  chipText: { color: '#344159', fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#FFFFFF' },
  statusChip: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: '#EEF2FF' },
  statusText: { fontSize: 12, color: '#344159', fontWeight: '700' },
  primaryButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#102A5C', paddingVertical: 12, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: '#98A2B3', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  secondaryButtonText: { color: '#344159', fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
