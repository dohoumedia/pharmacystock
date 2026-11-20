import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { formatDateOnly } from '@/utils/dateFormatting';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { ReadModelStatus } from '@/components/ReadModelStatus';
import { Alert, Button, FormField, PageHeader, StatusBadge, Surface, SupportingText, TextField } from '@/components/ui';
import { LocalStore } from '@/offline/localStore';
import { cachePurchasingReadModel, getCachedPurchasingReadModel } from '@/offline/purchasingReadModels';
import { isSnapshotStale, OPERATIONAL_READ_MODEL_MAX_AGE_MS } from '@/offline/readModels';
import { useAuth } from '@/providers/AuthProvider';
import { SupplierMaintenance } from '@/components/SupplierMaintenance';
import { OrderSummary, ReceiptHistory, ReceiptViewer } from '@/components/PurchasingDetails';
import { loadOrderDetail, type OrderDetail } from '@/services/purchasingDetails';
import { assertRequestBranch, canReceiveOrder, purchasingScope, remainingQuantity, retainPurchasingRequest, PurchasingRequestStore, type PurchasingRequest } from '@/domain/purchasingReadiness';
import { hasFreshMutationAuthorization } from '@/domain/mutationAuthorization';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useOrganization } from '@/providers/OrganizationProvider';
import { loadProducts, type ProductListItem } from '@/services/catalog';
import {
  createPurchaseOrder,
  createSupplier,
  loadPurchaseOrders,
  loadReceipts,
  loadSuppliers,
  receivePurchaseOrder,
  normalizedOperationKey,
  type PurchaseOrderLineWithProduct,
  type PurchaseOrderWithSupplier,
  type PurchaseReceipt,
  type Supplier,
} from '@/services/purchasing';
import { border, borderWidths, breakpoints, disabledOpacity, focusRing, foreground, semantic, shape, spacing, surface, touchTarget, typography } from '@/theme/tokens';
import { filterPurchaseOrders, purchasingLayout, purchasingMutationAllowed, type PurchaseOrderFilter } from '@/domain/purchasingState';
import { CatalogSelector } from '@/components/CatalogSelector';
import { searchProducts } from '@/services/catalogReadiness';
import { stockUnitLabel } from '@/domain/stockUnits';
import { hasDecimalPrecision, isDefinitiveRejection, parseLocaleNumber, validDateOnly } from '@/domain/numericInput';
import { validateReceiptRows, type ReceiptRowIssue } from '@/domain/receivingValidation';

type Tab = 'orders' | 'suppliers' | 'receipts';
type DraftLine = { productId: string; quantity: string; unitCost: string };
type ReceiptDraft = { quantity: string; unitCost: string; sellingPrice: string; lotNumber: string; expiryDate: string };

const localStore = new LocalStore();
const requestStore = new PurchasingRequestStore();

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
  if (status === 'cancelled') return 'warning';
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

export default function PurchasingScreen({ initialTab = 'orders' }: { initialTab?: Tab }) {
  const { organization, branch } = useOrganization(); const { user } = useAuth();
  const { receiptId, orderId } = useLocalSearchParams<{ receiptId?: string; orderId?: string }>();
  return <PurchasingContent key={`${user?.id}:${organization?.id}:${branch?.id}:${receiptId ?? ''}:${orderId ?? ''}`} initialOrderId={orderId} initialTab={receiptId ? 'receipts' : initialTab} initialReceiptId={receiptId ?? null} />;
}
function PurchasingContent({ initialTab, initialReceiptId, initialOrderId }: { initialTab: Tab; initialReceiptId: string | null; initialOrderId?: string }) {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const { isOnline } = useConnectivity();
  const { organization, branch, branches, setBranchId, can, usingCachedData: usingCachedPermissions, contextSyncedAt, refresh: refreshOrganization } = useOrganization();
  const { user } = useAuth();
  const requestKey = purchasingScope(user?.id ?? '', organization?.id ?? '', branch?.id ?? '');
  const [pending, setPending] = useState<PurchasingRequest | null>(() => requestStore.get<PurchasingRequest>(requestKey)?.data ?? null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(initialReceiptId);
  const [detailLoading, setDetailLoading] = useState(false);
  const [branchTarget, setBranchTarget] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const resultY = useRef(0);
  const flight = useRef(false); const mounted = useRef(true); const detailRequest = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderWithSupplier[]>([]);
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderLines, setOrderLines] = useState<PurchaseOrderLineWithProduct[]>([]);
  const [draftLines, setDraftLines] = useState<Record<string, DraftLine>>({});
  const [receiptIssues, setReceiptIssues] = useState<ReceiptRowIssue[]>([]);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [supplierDetailId, setSupplierDetailId] = useState<string | null>(null);
  const [supplierQuery, setSupplierQuery] = useState('');
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
  const mutationsAuthorized = purchasingMutationAllowed(isOnline, canCreate || canReceive, usingCachedPermissions) && hasFreshMutationAuthorization(isOnline, usingCachedPermissions, contextSyncedAt);
  const formLocked = saving || pending !== null;
  const activeSuppliers = suppliers.filter((item) => item.status === 'active');
  const selectedOrder = detail?.order;
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
      if (!mounted.current || requestId !== refreshRequest.current) return;
      const nextSyncedAt = new Date().toISOString();
      cachePurchasingReadModel(localStore, organization.id, branch.id, {
        suppliers: nextSuppliers, orders: nextOrders, receipts: nextReceipts, products: nextProducts,
      }, nextSyncedAt);
      setSuppliers(nextSuppliers);
      setOrders(nextOrders);
      setReceipts(nextReceipts);
      setProducts((current) => [...nextProducts, ...current.filter((item) => !nextProducts.some((next) => next.id === item.id))]);
      setSyncedAt(nextSyncedAt);
      setUsingCachedData(false);
      setSelectedSupplierId((current) => current && nextSuppliers.some((item) => item.id === current && item.status === 'active') ? current : nextSuppliers.find((item) => item.status === 'active')?.id ?? null);
    } catch {
      if (!mounted.current || requestId !== refreshRequest.current) return;
      setError(t('production.purchasingView.refreshFailed'));
      setUsingCachedData(hasCachedData);
    } finally {
      if (mounted.current && requestId === refreshRequest.current) setLoading(false);
    }
  }, [applyCachedReadModel, branch, canRead, isOnline, organization, t]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => { clearTimeout(timer); };
  }, [refresh]);

  const openOrder = useCallback(async (orderId: string, resume?: Parameters<typeof receivePurchaseOrder>[0]) => {
    if (!organization || !branch || !isOnline || flight.current) return;
    const request = ++detailRequest.current;
    setSelectedOrderId(orderId); setOrderLines([]); setDetail(null); setReceiptDrafts({}); setReceiptIssues([]); setDetailLoading(true); setError(null);
    try {
      const next = await loadOrderDetail(organization.id, branch.id, orderId);
      if (!mounted.current || request !== detailRequest.current) return;
      setDetail(next); setOrderLines(next.lines);
      requestAnimationFrame(() => { if (mounted.current) scroll.current?.scrollTo({ y: resultY.current, animated: true }); });
      const drafts: Record<string, ReceiptDraft> = {};
      for (const line of next.lines) drafts[line.id] = { quantity: '', unitCost: line.unit_cost == null ? '' : String(line.unit_cost), sellingPrice: '', lotNumber: '', expiryDate: '' };
      if (resume) for (const line of resume.lines) drafts[line.purchaseOrderLineId] = { quantity: String(line.quantity), unitCost: line.unitCost == null ? '' : String(line.unitCost), sellingPrice: line.sellingPrice == null ? '' : String(line.sellingPrice), lotNumber: line.lotNumber, expiryDate: line.expiryDate };
      setReceiptDrafts(drafts);
    } catch (cause) { if (mounted.current && request === detailRequest.current) setError(t(errorPresentationKey(cause))); }
    finally { if (mounted.current && request === detailRequest.current) setDetailLoading(false); }
  }, [organization, branch, isOnline, t]);
  const openedTarget = useRef(false);
  useEffect(() => {
    if (!initialOrderId || !isOnline || openedTarget.current) return;
    const timer = setTimeout(() => { openedTarget.current = true; void openOrder(initialOrderId); }, 0);
    return () => clearTimeout(timer);
  }, [initialOrderId, isOnline, openOrder]);

  const performRequest = async (candidate: PurchasingRequest) => {
    if (!organization || !branch || !user || !mutationsAuthorized || flight.current || (candidate.kind === 'order' ? !canCreate : !canReceive)) return;
    flight.current = true; setSaving(true); setError(null);
    let retained: PurchasingRequest | null = null;
    let accepted = false;
    try {
      if (typeof globalThis.localStorage === 'undefined') { setError(t('purchaseReady.storageRequired')); return; }
      retained = retainPurchasingRequest(requestStore, requestKey, candidate);
      assertRequestBranch(retained, organization.id, branch.id);
      setPending(retained);
      const resultId = retained.resultId ?? (retained.kind === 'order' ? await createPurchaseOrder(retained.input) : await receivePurchaseOrder(retained.input));
      accepted = true;
      const completed = { ...retained, rejected: false, resultId };
      requestStore.set(requestKey, { data: completed, syncedAt: new Date().toISOString() });
      if (!mounted.current) return;
      setPending(completed);
      requestAnimationFrame(() => { if (mounted.current) scroll.current?.scrollTo({ y: resultY.current, animated: true }); });
      if (retained.kind === 'receipt') { setReceiptId(resultId); setReceiptNumber(''); setSupplierInvoice(''); setReceiptDrafts({}); setSelectedOrderId(null); setDetail(null); }
      else { setPoNumber(''); setExpectedAt(''); setDraftLines({}); }
      await refresh();
    } catch (cause) {
      if (retained && !accepted && isDefinitiveRejection(cause)) {
        const rejected = { ...retained, rejected: true };
        requestStore.set(requestKey, { data: rejected, syncedAt: new Date().toISOString() });
        if (mounted.current) setPending(rejected);
      }
      if (mounted.current) {
        const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
        setError(t(message.includes('BATCH_SELLING_PRICE_MISMATCH') || /batches.*lot_number/.test(message) ? 'purchaseReady.identityMismatch' : errorPresentationKey(cause)));
      }
    } finally { flight.current = false; if (mounted.current) setSaving(false); }
  };
  const openReceiptDetail = (id: string) => { setReceiptId(id); requestAnimationFrame(() => scroll.current?.scrollTo({ y: resultY.current, animated: true })); };
  const clearCompletedRequest = () => { if (!pending?.resultId || saving) return; requestStore.remove(requestKey); setPending(null); };
  const reviseRequest = () => {
    if (!pending?.rejected || saving) return;
    requestStore.set(`${requestKey}:rejected:${pending.input.idempotencyKey}`, { data: pending, syncedAt: new Date().toISOString() });
    if (pending.kind === 'order') {
      setPoNumber(pending.input.poNumber); setExpectedAt(pending.input.expectedAt ?? ''); setSelectedSupplierId(pending.input.supplierId);
      setDraftLines(Object.fromEntries(pending.input.lines.map((line) => [line.productId, { productId: line.productId, quantity: String(line.quantity), unitCost: line.unitCost == null ? '' : String(line.unitCost) }])));
    }
    requestStore.remove(requestKey); setPending(null);
    if (pending.kind === 'receipt') { setReceiptNumber(pending.input.receiptNumber); setSupplierInvoice(pending.input.supplierInvoiceNumber ?? ''); void openOrder(pending.input.purchaseOrderId, pending.input); }
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
    if (!organization || !supplierName.trim() || !mutationsAuthorized || !canCreate || flight.current || pending) return;
    flight.current = true;
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
      flight.current = false; setSaving(false);
    }
  };

  const submitOrder = async () => {
    if (!organization || !branch || !selectedSupplierId || !poNumber.trim() || !mutationsAuthorized || !canCreate || formLocked) return;
    const lines = Object.values(draftLines).map((line) => ({ productId: line.productId, quantity: parseLocaleNumber(line.quantity) ?? NaN, unitCost: line.unitCost.trim() ? parseLocaleNumber(line.unitCost) : null }));
    if ((expectedAt.trim() && !validDateOnly(expectedAt.trim())) || lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0 || !hasDecimalPrecision(line.quantity, 3) || (draftLines[line.productId]?.unitCost.trim() && (line.unitCost === null || line.unitCost < 0 || !hasDecimalPrecision(line.unitCost, 2))))) { setError(t('purchaseReady.invalidOrder')); return; }
    if (!lines.length) { setError(t('production.purchasingView.requiredOrderLines')); return; }
    if (!activeSuppliers.some((item) => item.id === selectedSupplierId)) { setError(t('purchaseReady.noActiveSuppliers')); return; }
    await performRequest({ kind: 'order', organizationId: organization.id, branchId: branch.id, rejected: false, input: { organizationId: organization.id, branchId: branch.id, supplierId: selectedSupplierId, poNumber, expectedAt, lines, idempotencyKey: normalizedOperationKey('purchase-order', organization.id, poNumber) } });
  };
  const submitReceipt = async () => {
    if (!organization || !branch || !selectedOrderId || !receiptNumber.trim() || !mutationsAuthorized || !canReceive || formLocked || !selectedOrder || !canReceiveOrder(selectedOrder.status)) return;
    const { lines, issues } = validateReceiptRows(orderLines.map((line) => ({ id: line.id, remaining: remainingQuantity(line.ordered_quantity, line.received_quantity), draft: receiptDrafts[line.id] })));
    setReceiptIssues(issues);
    if (issues.length) { setError(t('catalogReady.receiptInvalid')); return; }
    if (!lines.length) { setError(t('production.purchasingView.requiredReceiptLines')); return; }
    await performRequest({ kind: 'receipt', organizationId: organization.id, branchId: branch.id, rejected: false, input: { purchaseOrderId: selectedOrderId, receiptNumber, supplierInvoiceNumber: supplierInvoice, lines, idempotencyKey: normalizedOperationKey('purchase-receipt', selectedOrderId, receiptNumber) } });
  };

  const stale = isSnapshotStale(syncedAt ? { data: null, syncedAt } : null, OPERATIONAL_READ_MODEL_MAX_AGE_MS);
  const formatQuantity = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(Number(value));
  const formatExpectedDate = (value: string | null) => formatDateOnly(value, i18n.language);

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
      <ScrollView ref={scroll} contentContainerStyle={[styles.container, compact && styles.compactContainer]} keyboardShouldPersistTaps="handled">
        <PageHeader
          title={t('purchasing.title')}
          subtitle={t('purchasing.subtitle')}
          action={<Link href="/" asChild><Button label={t('organization.back')} variant="secondary" /></Link>}
        />

        <Surface tone="inset" style={styles.contextSurface}>
          <FormField label={t('organization.branch')}>
            <View style={styles.chips}>
              {branches.map((item) => <SelectableChip key={item.id} label={item.name} selected={item.id === branch?.id} disabled={saving} onPress={() => { if (item.id !== branch?.id) setBranchTarget(item.id); }} />)}
            </View>
          </FormField>
          <SupportingText>{t('purchaseReady.branchBound', { branch: branch?.name ?? '—' })}</SupportingText>
          {branchTarget ? <><Alert tone="warning" title={t('purchaseReady.switchTitle')} /><Button label={t('purchaseReady.switchConfirm')} onPress={() => setBranchId(branchTarget)} /><Button variant="ghost" label={t('common.cancel')} onPress={() => setBranchTarget(null)} /></> : null}
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
        {!mutationsAuthorized ? <><Alert tone="warning" title={t(isOnline ? 'purchaseReady.accessRefreshRequired' : 'production.purchasingView.offlineReadOnly')} />{isOnline ? <Button variant="secondary" label={t('purchaseReady.refreshAccess')} disabled={saving} onPress={() => void refreshOrganization()} /> : null}</> : null}
        <SupportingText style={styles.authorityNote}>{t('production.purchasingView.serverAuthority')}</SupportingText>
        {error ? <Alert tone="danger" title={error} /> : null}
        {loading && !usingCachedData ? <SupportingText style={styles.meta}>{t('common.loading')}</SupportingText> : null}
        {!loading && !syncedAt && !error ? <Alert tone="info" title={t('production.purchasingView.noCachedData')} /> : null}

        <View onLayout={(event) => { resultY.current = event.nativeEvent.layout.y; }} />
        {pending ? <Surface style={styles.card}><Alert tone={pending.resultId ? 'success' : 'warning'} title={t(pending.resultId ? 'purchaseReady.accepted' : pending.rejected ? 'purchaseReady.rejected' : 'purchaseReady.pending')} />
          <Text>{pending.kind === 'order' ? pending.input.poNumber : pending.input.receiptNumber} · {branch?.name}</Text>
          {pending.resultId ? <><Text selectable>{t('purchaseReady.reference')}: {pending.resultId}</Text>{pending.kind === 'order' ? <Button variant="secondary" label={t('purchaseReady.openOrder')} onPress={() => void openOrder(pending.resultId!)} /> : <Button variant="secondary" label={t('purchaseReady.openReceipt', { reference: pending.input.receiptNumber })} onPress={() => openReceiptDetail(pending.resultId!)} />}<Button label={t('purchaseReady.dismiss')} onPress={clearCompletedRequest} /></> : <><Button label={t('purchaseReady.retry')} disabled={!mutationsAuthorized} loading={saving} onPress={() => void performRequest(pending)} />{pending.rejected ? <Button variant="secondary" label={t('purchaseReady.revise')} disabled={saving} onPress={reviseRequest} /> : null}</>}
        </Surface> : null}
        {receiptId && organization && branch ? <><ReceiptViewer key={receiptId} organizationId={organization.id} branchId={branch.id} receiptId={receiptId} currency={organization.currency_code} confirmation={pending?.kind === 'receipt' && pending.resultId === receiptId} onOrder={(id) => { setReceiptId(null); setTab('orders'); void openOrder(id); }} /><Button variant="ghost" label={t('purchaseReady.close')} onPress={() => setReceiptId(null)} /></> : null}
        {detailLoading ? <Text>{t('common.loading')}</Text> : null}
        {detail ? <><OrderSummary detail={detail} branchName={branch?.name ?? '—'} onReceipt={openReceiptDetail} onSupplier={(supplier) => { setSupplierDetailId(supplier.id); setTab('suppliers'); }} /><Button variant="ghost" label={t('purchaseReady.close')} onPress={() => { detailRequest.current++; setDetail(null); setSelectedOrderId(null); setOrderLines([]); setReceiptDrafts({}); }} /></> : null}

        {tab === 'suppliers' ? (
          <>
            {canCreate && mutationsAuthorized ? (
              <Surface tone="raised" style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.addSupplier')}</Text>
                <FormField label={t('purchasing.supplierName')} required><TextField accessibilityLabel={t('purchasing.supplierName')} placeholder={t('purchasing.supplierName')} editable={!formLocked} value={supplierName} onChangeText={setSupplierName} /></FormField>
                <FormField label={t('organization.phone')}><TextField accessibilityLabel={t('organization.phone')} placeholder={t('organization.phone')} editable={!formLocked} value={supplierPhone} onChangeText={setSupplierPhone} /></FormField>
                <FormField label={t('auth.email')}><TextField accessibilityLabel={t('auth.email')} autoCapitalize="none" keyboardType="email-address" placeholder={t('auth.email')} editable={!formLocked} value={supplierEmail} onChangeText={setSupplierEmail} /></FormField>
                <Button disabled={formLocked || !supplierName.trim()} label={t('common.save')} loading={saving} onPress={() => void submitSupplier()} style={styles.primaryButton} />
              </Surface>
            ) : null}
            {organization ? <SupplierMaintenance key={supplierDetailId ?? 'suppliers'} initialSupplierId={supplierDetailId} suppliers={suppliers} organizationId={organization.id} writable={canCreate && mutationsAuthorized && !formLocked} onSaved={refresh} onOrders={(supplier) => { if (supplier.status === 'active') setSelectedSupplierId(supplier.id); setOrderQuery(supplier.name); setOrderFilter('all'); setTab('orders'); }} /> : null}
          </>
        ) : null}

        {tab === 'orders' ? (
          <>
            {canCreate && mutationsAuthorized ? (
              <Surface tone="raised" style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.newOrder')}</Text><SupportingText>{t('purchaseReady.draft')}</SupportingText>
                <FormField label={t('purchasing.supplier')} required>
                <TextField accessibilityLabel={t('purchaseReady.supplierSearch')} placeholder={t('purchaseReady.supplierSearch')} value={supplierQuery} editable={!formLocked} onChangeText={setSupplierQuery} />
                {!activeSuppliers.length ? <Text>{t('purchaseReady.noActiveSuppliers')}</Text> : null}
                <View style={styles.chips}>
                  {activeSuppliers.filter((item) => `${item.name} ${item.code ?? ''}`.toLocaleLowerCase().includes(supplierQuery.trim().toLocaleLowerCase())).map((item) => <SelectableChip key={item.id} label={item.name} selected={selectedSupplierId === item.id} disabled={formLocked} onPress={() => setSelectedSupplierId(item.id)} />)}
                </View>
                </FormField>
                <FormField label={t('purchasing.poNumber')} required><TextField accessibilityLabel={t('purchasing.poNumber')} placeholder={t('purchasing.poNumber')} editable={!formLocked} value={poNumber} onChangeText={setPoNumber} /></FormField>
                <FormField label={t('purchasing.expectedAt')}><TextField accessibilityLabel={t('purchasing.expectedAt')} placeholder={t('purchasing.expectedAt')} editable={!formLocked} value={expectedAt} onChangeText={setExpectedAt} /></FormField>
                <FormField label={t('purchasing.addProducts')}>
                <CatalogSelector scope={`${organization?.id}:${branch?.id}`} label={t('purchasing.addProducts')} disabled={formLocked || !organization} load={(query, page) => searchProducts(organization!.id, query, page)} renderLabel={(item) => `${item.name} · ${item.sku ?? ''} · ${stockUnitLabel(item.stock_unit, t)}`} onSelect={(item) => { setProducts((current) => current.some((product) => product.id === item.id) ? current : [...current, { ...item, primaryBarcode: null }]); addOrderProduct(item.id); }} />
                </FormField>
                {Object.values(draftLines).map((line) => (
                  <Surface key={line.productId} tone="inset" style={[styles.lineEditor, compact && styles.compactEditor]}>
                    <Text style={[styles.growText, compact && styles.compactLineName]}>{productMap.get(line.productId)} · {stockUnitLabel(products.find((item) => item.id === line.productId)?.stock_unit, t)}</Text>
                    <TextField accessibilityLabel={`${productMap.get(line.productId) ?? ''} ${t('purchasing.quantity')}`} keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('purchasing.quantity')} editable={!formLocked} value={line.quantity} onChangeText={(value) => updateDraftLine(line.productId, { quantity: value })} />
                    <TextField accessibilityLabel={`${productMap.get(line.productId) ?? ''} ${t('purchasing.unitCost')}`} keyboardType="decimal-pad" style={styles.smallInput} placeholder={t('purchasing.unitCost')} editable={!formLocked} value={line.unitCost} onChangeText={(value) => updateDraftLine(line.productId, { unitCost: value })} />
                    <Button variant="ghost" label={t('purchaseReady.removeLine', { name: productMap.get(line.productId) ?? line.productId })} disabled={formLocked} onPress={() => setDraftLines((current) => { const next = { ...current }; delete next[line.productId]; return next; })} />
                  </Surface>
                ))}
                <Button disabled={formLocked || !selectedSupplierId || !poNumber.trim()} label={t('purchasing.createOrder')} loading={saving} onPress={() => void submitOrder()} style={styles.primaryButton} />
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

            {selectedOrderId && selectedOrder && canReceiveOrder(selectedOrder.status) && canReceive && mutationsAuthorized ? (
              <Surface tone="raised" style={styles.card}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t('purchasing.receiveOrder')}</Text><SupportingText>{t('purchaseReady.partialHint')}</SupportingText>
                <Alert tone="info" title={t('production.purchasingView.serverAuthority')} />
                <FormField label={t('purchasing.receiptNumber')} required><TextField accessibilityLabel={t('purchasing.receiptNumber')} placeholder={t('purchasing.receiptNumber')} editable={!formLocked} value={receiptNumber} onChangeText={setReceiptNumber} /></FormField>
                <FormField label={t('purchasing.supplierInvoice')}><TextField accessibilityLabel={t('purchasing.supplierInvoice')} placeholder={t('purchasing.supplierInvoice')} editable={!formLocked} value={supplierInvoice} onChangeText={setSupplierInvoice} /></FormField>
                {orderLines.map((line) => {
                  const draft = receiptDrafts[line.id] ?? { quantity: '', unitCost: '', sellingPrice: '', lotNumber: '', expiryDate: '' };
                  const remaining = remainingQuantity(line.ordered_quantity, line.received_quantity);
                  return (
                    <Surface key={line.id} tone="inset" style={styles.receiveBlock}>
                      <Text style={styles.name}>{line.product_name} · {stockUnitLabel(line.stock_unit, t)}</Text>
                      <View style={styles.quantitySummary}>
                        <StatusBadge label={t('production.purchasingView.ordered', { quantity: formatQuantity(line.ordered_quantity) })} tone="neutral" />
                        <StatusBadge label={t('production.purchasingView.received', { quantity: formatQuantity(line.received_quantity) })} tone="info" />
                        <StatusBadge label={t('production.purchasingView.remaining', { quantity: formatQuantity(remaining) })} tone={remaining > 0 ? 'warning' : 'success'} />
                      </View>
                      {receiptIssues.find((issue) => issue.id === line.id) ? <Alert tone="danger" title={t('purchaseReady.rowInvalid', { fields: receiptIssues.find((issue) => issue.id === line.id)!.fields.map((field) => t(`purchaseReady.fields.${field}`)).join(', ') })} /> : null}
                      <FormField label={t('purchaseReady.receiveNow')} hint={t('purchaseReady.quantityHint')} required><TextField accessibilityLabel={`${line.product_name} ${t('purchasing.quantityReceived')}`} keyboardType="decimal-pad" placeholder={t('purchasing.quantityReceived')} editable={!formLocked} value={draft.quantity} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, quantity: value } }))} /></FormField>
                      <FormField label={t('catalog.lotNumber')} required><TextField accessibilityLabel={`${line.product_name} ${t('catalog.lotNumber')}`} placeholder={t('catalog.lotNumber')} editable={!formLocked} value={draft.lotNumber} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, lotNumber: value } }))} /></FormField>
                      <FormField label={t('catalog.expiryDate')} required><TextField accessibilityLabel={`${line.product_name} ${t('catalog.expiryDate')}`} placeholder={t('catalog.expiryDate')} editable={!formLocked} value={draft.expiryDate} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, expiryDate: value } }))} /></FormField>
                      <FormField label={t('purchasing.unitCost')}><TextField accessibilityLabel={`${line.product_name} ${t('purchasing.unitCost')}`} keyboardType="decimal-pad" placeholder={t('purchasing.unitCost')} editable={!formLocked} value={draft.unitCost} onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, unitCost: value } }))} /></FormField>
                      <FormField
                        label={t('catalog.sellingPrice')}
                        required
                        hint={t('production.purchasingView.sellingPriceHint')}
                        error={draft.sellingPrice.length > 0 && (parseLocaleNumber(draft.sellingPrice) ?? 0) <= 0 ? t('production.purchasingView.sellingPriceRequired') : undefined}
                      >
                        <TextField
                          accessibilityLabel={`${line.product_name} ${t('catalog.sellingPrice')}`}
                          error={draft.sellingPrice.length > 0 && (parseLocaleNumber(draft.sellingPrice) ?? 0) <= 0}
                          keyboardType="decimal-pad"
                          placeholder={t('catalog.sellingPrice')}
                          editable={!formLocked} value={draft.sellingPrice}
                          onChangeText={(value) => setReceiptDrafts((current) => ({ ...current, [line.id]: { ...draft, sellingPrice: value } }))}
                        />
                      </FormField>
                    </Surface>
                  );
                })}
                <Button disabled={formLocked || !receiptNumber.trim()} label={t('purchasing.confirmReceipt')} loading={saving} onPress={() => void submitReceipt()} style={styles.primaryButton} />
              </Surface>
            ) : null}
            {!selectedOrderId && canReceive && mutationsAuthorized ? <Alert tone="info" title={t('production.purchasingView.selectOrder')} /> : null}
          </>
        ) : null}

        {tab === 'receipts' && organization && branch ? <ReceiptHistory key={`${receipts.length}:${pending?.resultId ?? ''}`} organizationId={organization.id} branchId={branch.id} cached={receipts} onReceipt={openReceiptDetail} /> : null}
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
  compactEditor: { flexDirection: 'column', alignItems: 'stretch' },
  compactLineName: { flex: 0 },
  quantitySummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  receiveBlock: { gap: spacing.md, padding: spacing.md },
  name: { ...typography.body, fontWeight: '800', color: foreground.primary },
  primaryButton: { alignSelf: 'flex-start' },
  disabled: { opacity: disabledOpacity },
});
