import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { LocalStore } from '@/offline/localStore';
import { cachePurchasingReadModel, getCachedPurchasingReadModel } from '@/offline/purchasingReadModels';
import { isSnapshotStale, OPERATIONAL_READ_MODEL_MAX_AGE_MS } from '@/offline/readModels';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { loadProducts, type ProductListItem } from '@/services/catalog';
import {
  createPurchaseOrder,
  createSupplier,
  loadPurchaseOrderLines,
  loadPurchaseOrders,
  loadReceipts,
  loadSuppliers,
  receivePurchaseOrder,
  type PurchaseOrderLineWithProduct,
  type PurchaseOrderWithSupplier,
  type PurchaseReceipt,
  type Supplier,
} from '@/services/purchasing';
import { breakpoints, colors, radii, spacing, touchTarget } from '@/theme/tokens';
import { filterPurchaseOrders, purchasingLayout, purchasingMutationAllowed, type PurchaseOrderFilter } from '@/domain/purchasingState';

type Tab = 'orders' | 'suppliers' | 'receipts';
type DraftLine = { productId: string; quantity: string; unitCost: string };
type ReceiptDraft = { quantity: string; unitCost: string; lotNumber: string; expiryDate: string };

const localStore = new LocalStore();

export default function PurchasingScreen() {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const { isOnline } = useConnectivity();
  const { organization, branch, branches, setBranchId, can, usingCachedData: usingCachedPermissions } = useOrganization();
  const [tab, setTab] = useState<Tab>('orders');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderWithSupplier[]>([]);
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderLines, setOrderLines] = useState<PurchaseOrderLineWithProduct[]>([]);
  const [draftLines, setDraftLines] = useState<Record<string, DraftLine>>({});
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [supplierInvoice, setSupplierInvoice] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [orderQuery, setOrderQuery] = useState('');
  const [orderFilter, setOrderFilter] = useState<PurchaseOrderFilter>('open');
  const refreshRequest = useRef(0);

  const canRead = can('purchase.read');
  const canCreate = can('purchase.create');
  const canReceive = can('purchase.receive');
  const mutationsAuthorized = purchasingMutationAllowed(isOnline, canCreate || canReceive, usingCachedPermissions);
  const compact = width < breakpoints.tablet;
  const orderLayout = purchasingLayout(width);
  const productMap = useMemo(() => new Map(products.map((item) => [item.id, item.name])), [products]);
  const visibleOrders = useMemo(() => filterPurchaseOrders(orders, orderQuery, orderFilter), [orderFilter, orderQuery, orders]);

  const applyCachedReadModel = useCallback(() => {
    if (!organization || !branch) return false;
    const cached = getCachedPurchasingReadModel(localStore, organization.id, branch.id);
    if (!cached) return false;
    setSuppliers(cached.data.suppliers);
    setOrders(cached.data.orders);
    setReceipts(cached.data.receipts);
    setProducts(cached.data.products);
    setSyncedAt(cached.syncedAt);
    setUsingCachedData(true);
    return true;
  }, [branch, organization]);

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequest.current;
    if (!organization || !branch || !canRead) return;
    const hasCachedData = applyCachedReadModel();
    if (!isOnline) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextSuppliers, nextOrders, nextReceipts, nextProducts] = await Promise.all([
        loadSuppliers(organization.id),
        loadPurchaseOrders(organization.id, branch.id),
        loadReceipts(organization.id, branch.id),
        loadProducts(organization.id),
      ]);
      if (requestId !== refreshRequest.current) return;
      const nextSyncedAt = new Date().toISOString();
      cachePurchasingReadModel(localStore, organization.id, branch.id, {
        suppliers: nextSuppliers, orders: nextOrders, receipts: nextReceipts, products: nextProducts,
      }, nextSyncedAt);
      setSuppliers(nextSuppliers);
      setOrders(nextOrders);
      setReceipts(nextReceipts);
      setProducts(nextProducts);
      setSyncedAt(nextSyncedAt);
      setUsingCachedData(false);
      setSelectedSupplierId((current) => current && nextSuppliers.some((item) => item.id === current) ? current : nextSuppliers[0]?.id ?? null);
    } catch {
      if (requestId !== refreshRequest.current) return;
      setError(t('production.purchasingView.refreshFailed'));
      setUsingCachedData(hasCachedData);
    } finally {
      if (requestId === refreshRequest.current) setLoading(false);
    }
  }, [applyCachedReadModel, branch, canRead, isOnline, organization, t]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const openOrder = async (orderId: string) => {
    if (!organization || !isOnline) return;
    setSelectedOrderId(orderId);
    setError(null);
    try {
      const lines = await loadPurchaseOrderLines(organization.id, orderId, productMap);
      setOrderLines(lines);
      const next: Record<string, ReceiptDraft> = {};
      for (const line of lines) {
        const remaining = Number(line.ordered_quantity) - Number(line.received_quantity);
        next[line.id] = {
          quantity: remaining > 0 ? String(remaining) : '',
          unitCost: line.unit_cost == null ? '' : String(line.unit_cost),
          lotNumber: '',
          expiryDate: '',
        };
      }
      setReceiptDrafts(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    }
  };

  const addOrderProduct = (productId: string) => {
    setDraftLines((current) => current[productId]
      ? current
      : { ...current, [productId]: { productId, quantity: '1', unitCost: '' } });
  };

  const updateDraftLine = (productId: string, patch: Partial<Omit<DraftLine, 'productId'>>) => {
    setDraftLines((current) => {
      const existing = current[productId];
      if (!existing) return current;
      return { ...current, [productId]: { ...existing, ...patch } };
    });
  };

  const submitSupplier = async () => {
    if (!organization || !supplierName.trim() || !mutationsAuthorized) return;
    setSaving(true);
    setError(null);
    try {
      await createSupplier({ organizationId: organization.id, name: supplierName, phone: supplierPhone, email: supplierEmail });
      setSupplierName('');
      setSupplierPhone('');
      setSupplierEmail('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSaving(false);
    }
  };

  const submitOrder = async () => {
    if (!organization || !branch || !selectedSupplierId || !poNumber.trim() || !mutationsAuthorized) return;
    const lines = Object.values(draftLines)
      .map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitCost: line.unitCost ? Number(line.unitCost) : null }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
    if (!lines.length) {
      setError(t('production.purchasingView.requiredOrderLines'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createPurchaseOrder({ organizationId: organization.id, branchId: branch.id, supplierId: selectedSupplierId, poNumber, expectedAt, lines });
      setPoNumber('');
      setExpectedAt('');
      setDraftLines({});
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSaving(false);
    }
  };

  const submitReceipt = async () => {
    if (!selectedOrderId || !receiptNumber.trim() || !mutationsAuthorized) return;
    const lines = orderLines
      .map((line) => {
        const draft = receiptDrafts[line.id];
        return {
          purchaseOrderLineId: line.id,
          quantity: Number(draft?.quantity ?? 0),
          unitCost: draft?.unitCost ? Number(draft.unitCost) : null,
          lotNumber: draft?.lotNumber ?? '',
          expiryDate: draft?.expiryDate ?? '',
        };
      })
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0 && line.lotNumber.trim() && line.expiryDate.trim());
    if (!lines.length) {
      setError(t('production.purchasingView.requiredReceiptLines'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await receivePurchaseOrder({ purchaseOrderId: selectedOrderId, receiptNumber, supplierInvoiceNumber: supplierInvoice, lines });
      setReceiptNumber('');
      setSupplierInvoice('');
      setSelectedOrderId(null);
      setOrderLines([]);
      setReceiptDrafts({});
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UNKNOWN_ERROR');
    } finally {
      setSaving(false);
    }
  };

  const stale = isSnapshotStale(syncedAt ? { data: null, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS);
  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(value))
    : '—';

  if (!canRead) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.error}>{t('purchasing.cannotRead')}</Text>
          <Link href="/">{t('organization.back')}</Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.container, compact && styles.compactContainer]}>
        <View style={styles.headerRow}>
          <View style={styles.grow}>
            <Text style={styles.title}>{t('purchasing.title')}</Text>
            <Text style={styles.subtitle}>{t('purchasing.subtitle')}</Text>
          </View>
          <Link href="/" asChild>
            <Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('organization.back')}</Text></Pressable>
          </Link>
        </View>

        <Text style={styles.label}>{t('organization.branch')}</Text>
        <View style={styles.chips}>
          {branches.map((item) => (
            <Pressable key={item.id} onPress={() => setBranchId(item.id)} style={[styles.chip, item.id === branch?.id && styles.chipSelected]}>
              <Text style={[styles.chipText, item.id === branch?.id && styles.chipTextSelected]}>{item.name}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.chips}>
          {(['orders', 'suppliers', 'receipts'] as Tab[]).map((item) => (
            <Pressable key={item} onPress={() => setTab(item)} style={[styles.chip, tab === item && styles.chipSelected]}>
              <Text style={[styles.chipText, tab === item && styles.chipTextSelected]}>{t(`purchasing.tabs.${item}`)}</Text>
            </Pressable>
          ))}
        </View>

        <ReadModelStatus
          loading={loading}
          usingCachedData={usingCachedData}
          stale={stale}
          syncedAt={syncedAt}
          hasData={suppliers.length + orders.length + receipts.length > 0}
        />
        {!mutationsAuthorized ? <Text accessibilityRole="alert" style={styles.offlineNote}>{t('production.purchasingView.offlineReadOnly')}</Text> : null}
        <Text style={styles.authorityNote}>{t('production.purchasingView.serverAuthority')}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading && !usingCachedData ? <Text style={styles.meta}>{t('common.loading')}</Text> : null}
        {!loading && !syncedAt && !error ? <Text style={styles.meta}>{t('production.purchasingView.noCachedData')}</Text> : null}

        {tab === 'suppliers' ? (
          <>
            {canCreate && mutationsAuthorized ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t('purchasing.addSupplier')}</Text>
                <TextInput accessibilityLabel={t('purchasing.supplierName')} style={styles.input} placeholder={t('purchasing.supplierName')} value={supplierName} onChangeText={setSupplierName} />
                <TextInput accessibilityLabel={t('organization.phone')} style={styles.input} placeholder={t('organization.phone')} value={supplierPhone} onChangeText={setSupplierPhone} />
                <TextInput accessibilityLabel={t('auth.email')} autoCapitalize="none" keyboardType="email-address" style={styles.input} placeholder={t('auth.email')} value={supplierEmail} onChangeText={setSupplierEmail} />
                <Pressable disabled={saving || !supplierName.trim()} onPress={() => void submitSupplier()} style={[styles.primaryButton, saving && styles.disabled]}>
                  <Text style={styles.primaryButtonText}>{t('common.save')}</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t('purchasing.suppliers')}</Text>
              {suppliers.length === 0 ? <Text style={styles.meta}>{t('purchasing.noSuppliers')}</Text> : suppliers.map((item) => (
                <View key={item.id} style={styles.row}>
                  <View><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.phone ?? item.email ?? '—'}</Text></View>
                  <Text style={styles.status}>{t('production.purchasingView.statusLabel', { status: item.status })}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {tab === 'orders' ? (
          <>
            {canCreate && mutationsAuthorized ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t('purchasing.newOrder')}</Text>
                <Text style={styles.label}>{t('purchasing.supplier')}</Text>
                <View style={styles.chips}>
                  {suppliers.map((item) => (
                    <Pressable key={item.id} onPress={() => setSelectedSupplierId(item.id)} style={[styles.chip, selectedSupplierId === item.id && styles.chipSelected]}>
                      <Text style={[styles.chipText, selectedSupplierId === item.id && styles.chipTextSelected]}>{item.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput accessibilityLabel={t('purchasing.poNumber')} style={styles.input} placeholder={t('purchasing.poNumber')} value={poNumber} onChangeText={setPoNumber} />
                <TextInput accessibilityLabel={t('purchasing.expectedAt')} style={styles.input} placeholder={t('purchasing.expectedAt')} value={expectedAt} onChangeText={setExpectedAt} />
                <Text style={styles.label}>{t('purchasing.addProducts')}</Text>
                <View style={styles.chips}>
                  {products.slice(0, 80).map((item) => (
                    <Pressable key={item.id} onPress={() => addOrderProduct(item.id)} style={styles.chip}>
                      <Text style={styles.chipText}>{item.name}</Text>
                    </Pressable>
                  ))}
                </View>
                {Object.values(draftLines).map((line) => (
                  <View key={line.productId} style={[styles.lineEditor, compact && styles.compactEditor]}>
                    <Text style={styles.growText}>{productMap.get(line.productId)}</Text>
                    <TextInput keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('purchasing.quantity')} value={line.quantity} onChangeText={(value) => updateDraftLine(line.productId, { quantity: value })} />
                    <TextInput keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('purchasing.unitCost')} value={line.unitCost} onChangeText={(value) => updateDraftLine(line.productId, { unitCost: value })} />
                  </View>
                ))}
                <Pressable disabled={saving || !selectedSupplierId || !poNumber.trim()} onPress={() => void submitOrder()} style={[styles.primaryButton, saving && styles.disabled]}>
                  <Text style={styles.primaryButtonText}>{t('purchasing.createOrder')}</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t('purchasing.orders')}</Text>
              <TextInput accessibilityLabel={t('production.purchasingView.search')} onChangeText={setOrderQuery} placeholder={t('production.purchasingView.search')} style={styles.input} value={orderQuery} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.chips}>{(['open', 'partial', 'received', 'all'] as PurchaseOrderFilter[]).map((filter) => (
                <Pressable key={filter} onPress={() => setOrderFilter(filter)} style={[styles.chip, orderFilter === filter && styles.chipSelected]}><Text style={[styles.chipText, orderFilter === filter && styles.chipTextSelected]}>{t(`production.purchasingView.filters.${filter}`)}</Text></Pressable>
              ))}</View></ScrollView>
              {orders.length === 0 ? <Text style={styles.meta}>{t('purchasing.noOrders')}</Text> : null}
              {orders.length > 0 && visibleOrders.length === 0 ? <Text style={styles.meta}>{t('production.purchasingView.noMatches')}</Text> : null}
              {orderLayout === 'table' && visibleOrders.length > 0 ? <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}><Text style={[styles.tableHeading, styles.poColumn]}>{t('purchasing.poNumber')}</Text><Text style={[styles.tableHeading, styles.supplierColumn]}>{t('purchasing.supplier')}</Text><Text style={[styles.tableHeading, styles.dateColumn]}>{t('purchasing.expectedAt')}</Text><Text style={[styles.tableHeading, styles.statusColumn]}>{t('production.purchasingView.status')}</Text></View>
                {visibleOrders.map((item) => <Pressable accessibilityRole="button" key={item.id} disabled={!isOnline} onPress={() => void openOrder(item.id)} style={styles.tableRow}><Text style={[styles.name, styles.poColumn]}>{item.po_number}</Text><Text style={[styles.meta, styles.supplierColumn]}>{item.supplier_name}</Text><Text style={[styles.meta, styles.dateColumn]}>{formatDate(item.expected_at)}</Text><Text style={[styles.status, styles.statusColumn]}>{t(`purchasing.status.${item.status}`)}</Text></Pressable>)}
              </View> : visibleOrders.map((item) => (
                <Pressable accessibilityRole="button" key={item.id} disabled={!isOnline} onPress={() => void openOrder(item.id)} style={[styles.row, compact && styles.compactRow]}>
                  <View style={styles.grow}><Text style={styles.name}>{item.po_number}</Text><Text style={styles.meta}>{item.supplier_name} · {formatDate(item.expected_at)}</Text></View>
                  <Text style={styles.status}>{t(`purchasing.status.${item.status}`)}</Text>
                </Pressable>
              ))}
            </View>

            {selectedOrderId && canReceive && mutationsAuthorized ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t('purchasing.receiveOrder')}</Text>
                <TextInput style={styles.input} placeholder={t('purchasing.receiptNumber')} value={receiptNumber} onChangeText={setReceiptNumber} />
                <TextInput style={styles.input} placeholder={t('purchasing.supplierInvoice')} value={supplierInvoice} onChangeText={setSupplierInvoice} />
                {orderLines.map((line) => {
                  const draft = receiptDrafts[line.id] ?? { quantity: '', unitCost: '', lotNumber: '', expiryDate: '' };
                  const remaining = Number(line.ordered_quantity) - Number(line.received_quantity);
                  return (
                    <View key={line.id} style={styles.receiveBlock}>
                      <Text style={styles.name}>{line.product_name}</Text>
                      <View style={styles.quantitySummary}>
                        <Text style={styles.meta}>{t('production.purchasingView.ordered', { quantity: line.ordered_quantity })}</Text>
                        <Text style={styles.meta}>{t('production.purchasingView.received', { quantity: line.received_quantity })}</Text>
                        <Text style={styles.meta}>{t('production.purchasingView.remaining', { quantity: remaining })}</Text>
                      </View>
                      <TextInput keyboardType="decimal-pad" style={styles.input} placeholder={t('purchasing.quantityReceived')} value={draft.quantity} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, quantity: value } }))} />
                      <TextInput style={styles.input} placeholder={t('catalog.lotNumber')} value={draft.lotNumber} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, lotNumber: value } }))} />
                      <TextInput style={styles.input} placeholder={t('catalog.expiryDate')} value={draft.expiryDate} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, expiryDate: value } }))} />
                      <TextInput keyboardType="decimal-pad" style={styles.input} placeholder={t('purchasing.unitCost')} value={draft.unitCost} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, unitCost: value } }))} />
                    </View>
                  );
                })}
                <Pressable disabled={saving || !receiptNumber.trim()} onPress={() => void submitReceipt()} style={[styles.primaryButton, saving && styles.disabled]}>
                  <Text style={styles.primaryButtonText}>{t('purchasing.confirmReceipt')}</Text>
                </Pressable>
              </View>
            ) : null}
            {!selectedOrderId && canReceive && mutationsAuthorized ? <Text style={styles.meta}>{t('production.purchasingView.selectOrder')}</Text> : null}
          </>
        ) : null}

        {tab === 'receipts' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('purchasing.receiptHistory')}</Text>
            {receipts.length === 0 ? <Text style={styles.meta}>{t('purchasing.noReceipts')}</Text> : receipts.map((item) => (
              <View key={item.id} style={styles.row}>
                <View><Text style={styles.name}>{item.receipt_number}</Text><Text style={styles.meta}>{formatDate(item.received_at)} · {item.supplier_invoice_number ?? '—'}</Text></View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.xl, gap: spacing.lg, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  compactContainer: { padding: spacing.md },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' },
  grow: { flex: 1 },
  growText: { flex: 1, color: '#101828', fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '800', color: colors.primary },
  subtitle: { color: colors.muted, marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.primary },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  meta: { color: colors.muted, fontSize: 13 },
  authorityNote: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  offlineNote: { color: colors.warning, fontSize: 13, fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '700' },
  input: { minHeight: touchTarget, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, color: colors.text },
  smallInput: { minWidth: 120, minHeight: touchTarget, flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: touchTarget, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: '#344054' },
  chipTextSelected: { color: '#FFF' },
  row: { minHeight: touchTarget, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  compactRow: { alignItems: 'flex-start', flexWrap: 'wrap' },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: 'hidden' },
  tableRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  tableHeader: { minHeight: 40, backgroundColor: '#F9FAFB' },
  tableHeading: { color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  poColumn: { flex: 1, minWidth: 110 }, supplierColumn: { flex: 2, minWidth: 170 }, dateColumn: { flex: 1, minWidth: 130 }, statusColumn: { flex: 1, minWidth: 150 },
  lineEditor: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  compactEditor: { alignItems: 'stretch' },
  quantitySummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  receiveBlock: { gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EAECF0' },
  name: { fontWeight: '700', color: '#101828' },
  status: { fontWeight: '700', color: '#344054' },
  primaryButton: { minHeight: touchTarget, justifyContent: 'center', alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: radii.md, paddingHorizontal: spacing.lg },
  primaryButtonText: { color: '#FFF', fontWeight: '700' },
  secondaryButton: { minHeight: touchTarget, justifyContent: 'center', borderWidth: 1, borderColor: '#98A2B3', borderRadius: radii.md, paddingHorizontal: spacing.md },
  secondaryButtonText: { color: '#344054', fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
