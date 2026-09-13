import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDateOnly, formatInstantDate } from '@/utils/dateFormatting';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { Alert, Button, FormField, PageHeader, Stack, StatusBadge, Surface, SupportingText, TextField } from '@/components/ui';
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
import { border, borderWidths, breakpoints, disabledOpacity, focusRing, foreground, semantic, shape, spacing, surface, touchTarget, typography } from '@/theme/tokens';
import { filterPurchaseOrders, purchasingLayout, purchasingMutationAllowed, type PurchaseOrderFilter } from '@/domain/purchasingState';

type Tab = 'orders' | 'suppliers' | 'receipts';
type DraftLine = { productId: string; quantity: string; unitCost: string };
type ReceiptDraft = { quantity: string; unitCost: string; lotNumber: string; expiryDate: string };

const localStore = new LocalStore();

function SelectableChip({ label, selected = false, disabled = false, onPress }: { label: string; selected?: boolean; disabled?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, focused && styles.chipFocused, disabled && styles.disabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function purchaseOrderTone(status: PurchaseOrderWithSupplier['status']): 'neutral' | 'success' | 'warning' | 'info' {
  if (status === 'received') return 'success';
  if (status === 'partially_received') return 'info';
  if (status === 'ordered') return 'warning';
  return 'neutral';
}

function FocusableRow({ accessibilityLabel, children, disabled = false, onPress, style }: { accessibilityLabel: string; children: ReactNode; disabled?: boolean; onPress: () => void; style: StyleProp<ViewStyle> }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={[style, focused && styles.rowFocused, disabled && styles.disabled]}
    >
      {children}
    </Pressable>
  );
}

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
      setError(t(errorPresentationKey(cause)));
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
      setError(t(errorPresentationKey(cause)));
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
      setError(t(errorPresentationKey(cause)));
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
      setError(t(errorPresentationKey(cause)));
    } finally {
      setSaving(false);
    }
  };

  const stale = isSnapshotStale(syncedAt ? { data: null, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS);
  const formatExpectedDate = (value: string | null) => formatDateOnly(value, i18n.language);
  const formatReceivedDate = (value: string | null) => formatInstantDate(value, i18n.language);

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
        <PageHeader
          title={t('purchasing.title')}
          subtitle={t('purchasing.subtitle')}
          action={<Link href="/" asChild><Button label={t('organization.back')} variant="secondary" /></Link>}
        />

        <Surface tone="inset" style={styles.contextSurface}>
          <FormField label={t('organization.branch')}>
            <View style={styles.chips}>
              {branches.map((item) => <SelectableChip key={item.id} label={item.name} selected={item.id === branch?.id} onPress={() => setBranchId(item.id)} />)}
            </View>
          </FormField>
          <View accessibilityRole="tablist" style={styles.chips}>
            {(['orders', 'suppliers', 'receipts'] as Tab[]).map((item) => <SelectableChip key={item} label={t(`purchasing.tabs.${item}`)} selected={tab === item} onPress={() => setTab(item)} />)}
          </View>
        </Surface>

        <ReadModelStatus
          loading={loading}
          usingCachedData={usingCachedData}
          stale={stale}
          syncedAt={syncedAt}
          hasData={suppliers.length + orders.length + receipts.length > 0}
        />
        {!mutationsAuthorized ? <Alert tone="warning" title={t('production.purchasingView.offlineReadOnly')} /> : null}
        <SupportingText style={styles.authorityNote}>{t('production.purchasingView.serverAuthority')}</SupportingText>
        {error ? <Alert tone="danger" title={error} /> : null}
        {loading && !usingCachedData ? <SupportingText style={styles.meta}>{t('common.loading')}</SupportingText> : null}
        {!loading && !syncedAt && !error ? <Alert tone="info" title={t('production.purchasingView.noCachedData')} /> : null}

        {tab === 'suppliers' ? (
          <>
            {canCreate && mutationsAuthorized ? (
              <Surface tone="raised" style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.addSupplier')}</Text>
                <FormField label={t('purchasing.supplierName')} required><TextField accessibilityLabel={t('purchasing.supplierName')} placeholder={t('purchasing.supplierName')} value={supplierName} onChangeText={setSupplierName} /></FormField>
                <FormField label={t('organization.phone')}><TextField accessibilityLabel={t('organization.phone')} placeholder={t('organization.phone')} value={supplierPhone} onChangeText={setSupplierPhone} /></FormField>
                <FormField label={t('auth.email')}><TextField accessibilityLabel={t('auth.email')} autoCapitalize="none" keyboardType="email-address" placeholder={t('auth.email')} value={supplierEmail} onChangeText={setSupplierEmail} /></FormField>
                <Button disabled={!supplierName.trim()} label={t('common.save')} loading={saving} onPress={() => void submitSupplier()} style={styles.primaryButton} />
              </Surface>
            ) : null}
            <Surface tone="default" style={styles.card}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.suppliers')}</Text>
              {suppliers.length === 0 ? <SupportingText style={styles.meta}>{t('purchasing.noSuppliers')}</SupportingText> : suppliers.map((item) => (
                <View key={item.id} style={styles.row}>
                  <View style={styles.grow}><Text style={styles.name}>{item.name}</Text><SupportingText style={styles.meta}>{item.phone ?? item.email ?? '—'}</SupportingText></View>
                  <StatusBadge label={t(`production.purchasingView.supplierStatus.${item.status}`, { defaultValue: t('production.purchasingView.supplierStatus.unavailable') })} tone={item.status === 'active' ? 'success' : 'neutral'} />
                </View>
              ))}
            </Surface>
          </>
        ) : null}

        {tab === 'orders' ? (
          <>
            {canCreate && mutationsAuthorized ? (
              <Surface tone="raised" style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.newOrder')}</Text>
                <FormField label={t('purchasing.supplier')} required>
                <View style={styles.chips}>
                  {suppliers.map((item) => <SelectableChip key={item.id} label={item.name} selected={selectedSupplierId === item.id} onPress={() => setSelectedSupplierId(item.id)} />)}
                </View>
                </FormField>
                <FormField label={t('purchasing.poNumber')} required><TextField accessibilityLabel={t('purchasing.poNumber')} placeholder={t('purchasing.poNumber')} value={poNumber} onChangeText={setPoNumber} /></FormField>
                <FormField label={t('purchasing.expectedAt')}><TextField accessibilityLabel={t('purchasing.expectedAt')} placeholder={t('purchasing.expectedAt')} value={expectedAt} onChangeText={setExpectedAt} /></FormField>
                <FormField label={t('purchasing.addProducts')}>
                <View style={styles.chips}>
                  {products.slice(0, 80).map((item) => <SelectableChip key={item.id} label={item.name} onPress={() => addOrderProduct(item.id)} />)}
                </View>
                </FormField>
                {Object.values(draftLines).map((line) => (
                  <Surface key={line.productId} tone="inset" style={[styles.lineEditor, compact && styles.compactEditor]}>
                    <Text style={styles.growText}>{productMap.get(line.productId)}</Text>
                    <TextField accessibilityLabel={`${productMap.get(line.productId) ?? ''} ${t('purchasing.quantity')}`} keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('purchasing.quantity')} value={line.quantity} onChangeText={(value) => updateDraftLine(line.productId, { quantity: value })} />
                    <TextField accessibilityLabel={`${productMap.get(line.productId) ?? ''} ${t('purchasing.unitCost')}`} keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('purchasing.unitCost')} value={line.unitCost} onChangeText={(value) => updateDraftLine(line.productId, { unitCost: value })} />
                  </Surface>
                ))}
                <Button disabled={!selectedSupplierId || !poNumber.trim()} label={t('purchasing.createOrder')} loading={saving} onPress={() => void submitOrder()} style={styles.primaryButton} />
              </Surface>
            ) : null}

            <Surface tone="default" style={styles.card}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.orders')}</Text>
              <TextField accessibilityLabel={t('production.purchasingView.search')} onChangeText={setOrderQuery} placeholder={t('production.purchasingView.search')} value={orderQuery} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.chips}>{(['open', 'partial', 'received', 'all'] as PurchaseOrderFilter[]).map((filter) => (
                <SelectableChip key={filter} label={t(`production.purchasingView.filters.${filter}`)} selected={orderFilter === filter} onPress={() => setOrderFilter(filter)} />
              ))}</View></ScrollView>
              {orders.length === 0 ? <Alert tone="info" title={t('purchasing.noOrders')} /> : null}
              {orders.length > 0 && visibleOrders.length === 0 ? <Alert tone="info" title={t('production.purchasingView.noMatches')} /> : null}
              {orderLayout === 'table' && visibleOrders.length > 0 ? <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}><Text style={[styles.tableHeading, styles.poColumn]}>{t('purchasing.poNumber')}</Text><Text style={[styles.tableHeading, styles.supplierColumn]}>{t('purchasing.supplier')}</Text><Text style={[styles.tableHeading, styles.dateColumn]}>{t('purchasing.expectedAt')}</Text><Text style={[styles.tableHeading, styles.statusColumn]}>{t('production.purchasingView.status')}</Text></View>
                {visibleOrders.map((item) => <FocusableRow accessibilityLabel={item.po_number} key={item.id} disabled={!isOnline} onPress={() => void openOrder(item.id)} style={styles.tableRow}><Text style={[styles.name, styles.poColumn]}>{item.po_number}</Text><Text style={[styles.meta, styles.supplierColumn]}>{item.supplier_name}</Text><Text style={[styles.meta, styles.dateColumn]}>{formatExpectedDate(item.expected_at)}</Text><StatusBadge label={t(`purchasing.status.${item.status}`)} tone={purchaseOrderTone(item.status)} style={styles.statusColumn} /></FocusableRow>)}
              </View> : visibleOrders.map((item) => (
                <FocusableRow accessibilityLabel={item.po_number} key={item.id} disabled={!isOnline} onPress={() => void openOrder(item.id)} style={[styles.row, compact && styles.compactRow]}>
                  <View style={styles.grow}><Text style={styles.name}>{item.po_number}</Text><SupportingText style={styles.meta}>{item.supplier_name} · {formatExpectedDate(item.expected_at)}</SupportingText></View>
                  <StatusBadge label={t(`purchasing.status.${item.status}`)} tone={purchaseOrderTone(item.status)} />
                </FocusableRow>
              ))}
            </Surface>

            {selectedOrderId && canReceive && mutationsAuthorized ? (
              <Surface tone="raised" style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.receiveOrder')}</Text>
                <Alert tone="info" title={t('production.purchasingView.serverAuthority')} />
                <FormField label={t('purchasing.receiptNumber')} required><TextField accessibilityLabel={t('purchasing.receiptNumber')} placeholder={t('purchasing.receiptNumber')} value={receiptNumber} onChangeText={setReceiptNumber} /></FormField>
                <FormField label={t('purchasing.supplierInvoice')}><TextField accessibilityLabel={t('purchasing.supplierInvoice')} placeholder={t('purchasing.supplierInvoice')} value={supplierInvoice} onChangeText={setSupplierInvoice} /></FormField>
                {orderLines.map((line) => {
                  const draft = receiptDrafts[line.id] ?? { quantity: '', unitCost: '', lotNumber: '', expiryDate: '' };
                  const remaining = Number(line.ordered_quantity) - Number(line.received_quantity);
                  return (
                    <Surface key={line.id} tone="inset" style={styles.receiveBlock}>
                      <Text style={styles.name}>{line.product_name}</Text>
                      <View style={styles.quantitySummary}>
                        <StatusBadge label={t('production.purchasingView.ordered', { quantity: line.ordered_quantity })} tone="neutral" />
                        <StatusBadge label={t('production.purchasingView.received', { quantity: line.received_quantity })} tone="info" />
                        <StatusBadge label={t('production.purchasingView.remaining', { quantity: remaining })} tone={remaining > 0 ? 'warning' : 'success'} />
                      </View>
                      <FormField label={t('purchasing.quantityReceived')} required><TextField accessibilityLabel={`${line.product_name} ${t('purchasing.quantityReceived')}`} keyboardType="decimal-pad" placeholder={t('purchasing.quantityReceived')} value={draft.quantity} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, quantity: value } }))} /></FormField>
                      <FormField label={t('catalog.lotNumber')} required><TextField accessibilityLabel={`${line.product_name} ${t('catalog.lotNumber')}`} placeholder={t('catalog.lotNumber')} value={draft.lotNumber} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, lotNumber: value } }))} /></FormField>
                      <FormField label={t('catalog.expiryDate')} required><TextField accessibilityLabel={`${line.product_name} ${t('catalog.expiryDate')}`} placeholder={t('catalog.expiryDate')} value={draft.expiryDate} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, expiryDate: value } }))} /></FormField>
                      <FormField label={t('purchasing.unitCost')}><TextField accessibilityLabel={`${line.product_name} ${t('purchasing.unitCost')}`} keyboardType="decimal-pad" placeholder={t('purchasing.unitCost')} value={draft.unitCost} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, unitCost: value } }))} /></FormField>
                    </Surface>
                  );
                })}
                <Button disabled={!receiptNumber.trim()} label={t('purchasing.confirmReceipt')} loading={saving} onPress={() => void submitReceipt()} style={styles.primaryButton} />
              </Surface>
            ) : null}
            {!selectedOrderId && canReceive && mutationsAuthorized ? <Alert tone="info" title={t('production.purchasingView.selectOrder')} /> : null}
          </>
        ) : null}

        {tab === 'receipts' ? (
          <Surface tone="default" style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.receiptHistory')}</Text>
            {receipts.length === 0 ? <Alert tone="info" title={t('purchasing.noReceipts')} /> : receipts.map((item) => (
              <View key={item.id} style={styles.row}>
                <View style={styles.grow}><Text style={styles.name}>{item.receipt_number}</Text><SupportingText style={styles.meta}>{formatReceivedDate(item.received_at)} · {item.supplier_invoice_number ?? '—'}</SupportingText></View>
                <StatusBadge label={t('purchasing.tabs.receipts')} tone="success" />
              </View>
            ))}
          </Surface>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: surface.canvas },
  container: { padding: spacing.xl, gap: spacing.lg, maxWidth: 1280, width: '100%', alignSelf: 'center' },
  compactContainer: { padding: spacing.md },
  contextSurface: { gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  growText: { flex: 1, minWidth: 0, color: foreground.primary, ...typography.body, fontWeight: '700' },
  card: { gap: spacing.md },
  sectionTitle: { ...typography.sectionTitle, color: foreground.brand },
  meta: { ...typography.supporting, color: foreground.secondary },
  authorityNote: { color: foreground.secondary, ...typography.supporting },
  error: { color: semantic.danger.foreground, ...typography.body, fontWeight: '700' },
  smallInput: { minWidth: 120, flexGrow: 1, borderColor: border.default },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: touchTarget, maxWidth: '100%', justifyContent: 'center', borderWidth: borderWidths.hairline, borderColor: border.default, borderRadius: shape.pill, paddingHorizontal: spacing.md, backgroundColor: surface.default },
  chipSelected: { backgroundColor: surface.brand, borderColor: surface.brand },
  chipFocused: { borderWidth: focusRing.width, borderColor: focusRing.color },
  chipText: { ...typography.body, fontWeight: '700', color: foreground.secondary, flexShrink: 1 },
  chipTextSelected: { color: foreground.inverse },
  row: { minHeight: touchTarget, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: borderWidths.hairline, borderBottomColor: border.subtle, borderRadius: shape.sm },
  rowFocused: { borderWidth: focusRing.width, borderColor: focusRing.color, paddingHorizontal: spacing.sm },
  compactRow: { alignItems: 'flex-start', flexWrap: 'wrap' },
  table: { borderWidth: borderWidths.hairline, borderColor: border.default, borderRadius: shape.md, overflow: 'hidden' },
  tableRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: borderWidths.hairline, borderBottomColor: border.subtle },
  tableHeader: { minHeight: 40, backgroundColor: surface.inset },
  tableHeading: { color: foreground.secondary, ...typography.metadata, fontWeight: '800', textTransform: 'uppercase' },
  poColumn: { flex: 1, minWidth: 110 }, supplierColumn: { flex: 2, minWidth: 170 }, dateColumn: { flex: 1, minWidth: 130 }, statusColumn: { flex: 1, minWidth: 150 },
  lineEditor: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  compactEditor: { alignItems: 'stretch' },
  quantitySummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  receiveBlock: { gap: spacing.md, padding: spacing.md },
  name: { ...typography.body, fontWeight: '800', color: foreground.primary },
  primaryButton: { alignSelf: 'flex-start' },
  disabled: { opacity: disabledOpacity },
});
