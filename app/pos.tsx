import { PosCustomerPicker } from '../src/components/PosCustomerPicker';
import { hasFreshMutationAuthorization } from '../src/domain/mutationAuthorization';
import { effectiveTimezone, configuredCurrency, defaultPaymentMethod } from '../src/domain/businessSettings';
import { useSettingsRevision } from '../src/hooks/useSettingsRevision';
import { stockUnitLabel } from '@/domain/stockUnits';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from '../src/i18n/useTranslation';
import { Alert, Button, IconButton, PageHeader, Stack, StatusBadge, Surface, TextField } from '@/components/ui';
import { border, borderWidths, focusRing, foreground, semantic, shape, spacing, surface, touchTarget, typography } from '@/theme/tokens';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useAuth } from '@/providers/AuthProvider';
import { loadOrganizationSettings, type Customer } from '@/services/coreCompletion';
import { loadInventoryBalances } from '@/services/inventory';
import { completeSale, quoteSale, searchPosProducts, type CartLine, type PosProduct, type SaleQuote } from '@/services/sales';
import { applySaleDraftMutation, cacheSaleQuote, createOfflinePosStores, getCachedSaleQuote, OfflineStockReservationError, queueOfflineSaleForCheckout, resolveSaleSubmissionIdentity, type SaleSubmissionIdentity } from '@/offline/offlinePos';
import { OutboxAtomicCoordinationUnavailableError, OutboxIdempotencyConflictError, OutboxOwnerMismatchError } from '@/offline/outbox';
import { cachePosStockSnapshot, getCachedPosCatalog, getCachedPosStock, getOfflineAvailableQuantity, mergePosCatalog, searchCachedPosProducts } from '@/offline/offlinePosCatalog';
import { formatPosCurrency, formatPosDate } from '@/utils/posPresentation';
import { isPosProductSelected, isPosSaleActionDisabled, posChoiceVisualState, posErrorTranslationKey, posSyncTone } from '@/utils/posVisualState';
import { errorPresentationKey } from '@/utils/errorPresentation';
import { createPosAttemptStore } from '../src/services/posAttempts';
import { SaleDetails } from '../src/components/SaleDetails';
import { SalesHistory } from '../src/components/SalesHistory';
import { QuoteAllocation } from '../src/components/QuoteAllocation';
import { resolvePosBarcode, saleByIdentity, saleDetail } from '../src/services/posCompletion';
import { cashPayment, quoteFingerprint, stockQuantity } from '../src/domain/posCompletion';
import { isDefinitiveRejection } from '../src/domain/numericInput';
import { cacheOrganizationSettings, getCachedOrganizationSettings } from '../src/offline/readModels';
import { observeSyncedSales } from '@/offline/saleSyncObserver';

type SaleAttempt = { cart?: CartRow[]; identity: SaleSubmissionIdentity; input: Parameters<typeof completeSale>[0] };
type CartRow = CartLine & { product: PosProduct };
type ChoiceTabProps = { label: string; selected: boolean; focused: boolean; disabled?: boolean; accessibilityLabel?: string; onFocus: () => void; onBlur: () => void; onPress: () => void };
const paymentMethods = ['CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'OTHER'] as const;
const offlineStores = createOfflinePosStores();
const attemptStore = createPosAttemptStore();

function ChoiceTab({ label, selected, focused, disabled = false, accessibilityLabel, onFocus, onBlur, onPress }: ChoiceTabProps) {
  const visualState = posChoiceVisualState(selected, focused);
  return <Pressable accessibilityRole="tab" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ selected: visualState.selected, disabled }} aria-selected={visualState.selected} disabled={disabled} focusable onFocus={onFocus} onBlur={onBlur} onPress={onPress} style={StyleSheet.flatten([styles.choiceTab, visualState.selected && styles.choiceTabSelected, visualState.focused && styles.choiceTabFocused])}>
    <Text numberOfLines={2} style={visualState.selected ? styles.choiceTabTextSelected : styles.choiceTabText}>{label}</Text>
  </Pressable>;
}

export default function PosScreen() {
  const { organization, branch } = useOrganization(); const { user } = useAuth();
  return <PosWorkspace key={`${user?.id}:${organization?.id}:${branch?.id}`} />;
}
function PosWorkspace() {
  const { t, i18n } = useTranslation();
  const { organization, branch, can, usingCachedData, contextSyncedAt } = useOrganization();
  const { isOnline } = useConnectivity();
  const { user } = useAuth();
  const userId = user?.id;
  const organizationId = organization?.id;
  const settingsRevision = useSettingsRevision(organizationId);
  const receiptContext = { timezone: effectiveTimezone(organization?.timezone, branch?.timezone), address: [branch?.address_line1, branch?.address_line2, branch?.city, branch?.country_code || organization?.country_code].filter(Boolean).join(', '), contact: [branch?.phone, branch?.email].filter(Boolean).join(' · ') };
  const branchId = branch?.id;
  const language = i18n.language === 'fr' ? 'fr' : 'en';
  const attemptKey = `pos:attempt:${userId}:${organizationId}:${branchId}`;
  const [attempt, setAttempt] = useState<SaleAttempt | null>(() => attemptStore.read<SaleAttempt>(attemptKey));
  const [query, setQuery] = useState(''); const [products, setProducts] = useState<PosProduct[]>([]); const [cart, setCart] = useState<CartRow[]>(() => attempt?.cart ?? []);
  const [catalogSyncedAt, setCatalogSyncedAt] = useState<string | null>(null); const [stockSyncedAt, setStockSyncedAt] = useState<string | null>(null);
  const [quoteTotal, setQuoteTotal] = useState(0); const [quoteSyncedAt, setQuoteSyncedAt] = useState<string | null>(null); const [paymentMethod, setPaymentMethod] = useState<(typeof paymentMethods)[number]>(() => attempt?.input.payments[0]?.method ?? 'CASH');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null); const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(attempt?.input.customerId ?? null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customerEditing, setCustomerEditing] = useState(false); const customerFormOpen = useRef(false);
  const [quote, setQuote] = useState<SaleQuote | null>(null); const [quoteLoading, setQuoteLoading] = useState(false); const [quoteAccepted, setQuoteAccepted] = useState(true);
  const [quantityText, setQuantityText] = useState<Record<string, string>>({});
  const [barcode, setBarcode] = useState(''); const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [cashTendered, setCashTendered] = useState(attempt?.input.cashTendered != null ? String(attempt.input.cashTendered) : ''); const [paymentReference, setPaymentReference] = useState(attempt?.input.payments[0]?.external_reference ?? '');
  const [defaultPayment, setDefaultPayment] = useState<(typeof paymentMethods)[number]>('CASH');
  const [receiptFooter, setReceiptFooter] = useState<string | null>(null); const paymentTouched = useRef(!!attempt);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const draftLocked = busy || attempt !== null;

  const [pendingCount, setPendingCount] = useState(0); const [conflictCount, setConflictCount] = useState(0);
  const [salesSyncRevision, setSalesSyncRevision] = useState(0);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [priceBlocked, setPriceBlocked] = useState(false);
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const saleSubmissionRef = useRef<SaleSubmissionIdentity | null>(null);
  const saleSubmissionInFlight = useRef(!!attempt);
  const canCreate = can('sale.create'); const canRead = can('sale.read'); const canRefund = can('sale.refund'); const canReadCustomers = can('customer.read'); const canManageBatchPrices = can('inventory.product.update');
  const lines = useMemo(() => cart.map(({ product_id, quantity }) => ({ product_id, quantity })), [cart]); const displayTotal = lines.length && quote ? quoteTotal : 0; const currencyCode = configuredCurrency(organization?.currency_code);
  const refreshOutboxState = useCallback(async () => { if (!userId) { setPendingCount(0); setConflictCount(0); return; } try { await offlineStores.outbox.refresh(userId); } catch (error) { if (error instanceof OutboxOwnerMismatchError) { setPendingCount(0); setConflictCount(0); return; } throw error; } setPendingCount(offlineStores.outbox.pending().filter((item) => item.kind === 'SALE').length); setConflictCount(offlineStores.outbox.conflicts().filter((item) => item.kind === 'SALE').length); }, [userId]);
  const refreshSales = async () => { setSalesSyncRevision(revision => revision + 1); };
  const presentServerError = useCallback((cause: unknown) => {
    const text = cause instanceof Error ? cause.message : String((cause as { message?: string })?.message ?? '');
    if (text.includes('POS_BARCODE_UNKNOWN')) { setError(t('posReady.barcodeUnknown')); return; }
    if (text.includes('POS_BARCODE_AMBIGUOUS')) { setError(t('posReady.barcodeAmbiguous')); return; }
    if (text.includes('INSUFFICIENT_STOCK')) { setError(t('posReady.unavailable')); return; }
    const posKey = posErrorTranslationKey(cause);
    setError(posKey ? t(posKey) : t(errorPresentationKey(cause)));
  }, [t]);


  useEffect(() => {
    if (!userId || !organizationId || !branchId) return;
    return observeSyncedSales(offlineStores.outbox, userId, organizationId, branchId,
      () => setSalesSyncRevision((revision) => revision + 1));
  }, [userId, organizationId, branchId]);
  useEffect(() => { if (!organizationId || !canCreate) return; let active = true; const timer = setTimeout(() => { if (!active) return; setCatalogLoading(true); if (!isOnline) { const cached = getCachedPosCatalog(offlineStores.localStore, organizationId); setCatalogSyncedAt(cached?.syncedAt ?? null); setProducts(searchCachedPosProducts(offlineStores.localStore, organizationId, query)); setCatalogLoading(false); return; } void searchPosProducts(organizationId, query).then((data) => { if (!active) return; const syncedAt = new Date().toISOString(); mergePosCatalog(offlineStores.localStore, organizationId, data, syncedAt); setCatalogSyncedAt(syncedAt); setProducts(data); }).catch((cause) => active && presentServerError(cause)).finally(() => { if (active) setCatalogLoading(false); }); }, 200); return () => { active = false; clearTimeout(timer); }; }, [organizationId, query, canCreate, isOnline, t, presentServerError]);
  useEffect(() => { if (!organizationId || !branchId || !canCreate) return; let active = true; if (!isOnline) { const cached = getCachedPosStock(offlineStores.localStore, organizationId, branchId); const timer = setTimeout(() => active && setStockSyncedAt(cached?.syncedAt ?? null), 0); return () => { active = false; clearTimeout(timer); }; } void loadInventoryBalances(organizationId, branchId).then((balances) => { if (!active) return; const syncedAt = new Date().toISOString(); cachePosStockSnapshot(offlineStores.localStore, organizationId, branchId, balances, syncedAt); setStockSyncedAt(syncedAt); }).catch((cause) => active && presentServerError(cause)); return () => { active = false; }; }, [organizationId, branchId, canCreate, isOnline, t, presentServerError]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setQuote(null); setQuoteLoading(true); setQuoteAccepted(true);
      if (attempt?.input.expectedQuote) { setQuote(attempt.input.expectedQuote); setQuoteTotal(Number(attempt.input.expectedQuote.total_amount)); setQuoteLoading(false); return; }
      if (!organizationId || !branchId || !lines.length || lines.some(line => !stockQuantity(String(line.quantity)))) { setQuoteTotal(0); setQuoteSyncedAt(null); setQuoteLoading(false); return; }
      if (!isOnline) { const cached = getCachedSaleQuote(offlineStores.localStore, organizationId, branchId, lines); setQuote(cached?.data ?? null); setQuoteTotal(cached ? Number(cached.data.total_amount) : 0); setQuoteSyncedAt(cached?.syncedAt ?? null); setQuoteLoading(false); if (!cached) setError(t('pos.noTrustedOfflinePrice')); return; }
      void quoteSale(organizationId, branchId, lines).then(value => {
        if (!active) return; const syncedAt = new Date().toISOString(); cacheSaleQuote(offlineStores.localStore, organizationId, branchId, lines, value, syncedAt);
        setQuote(value); setQuoteTotal(Number(value.total_amount)); setQuoteSyncedAt(syncedAt); setPriceBlocked(false); setError(null);
      }).catch(cause => { if (active) { setQuoteTotal(0); setQuoteSyncedAt(null); setPriceBlocked(posErrorTranslationKey(cause) === 'pos.sellingPriceRequired'); presentServerError(cause); } }).finally(() => { if (active) setQuoteLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, branchId, lines, isOnline, t, presentServerError, attempt]);
  useEffect(() => {
    if (!organizationId) return; let active = true;
    const apply = (settings: Awaited<ReturnType<typeof loadOrganizationSettings>>) => { if (!active) return; setReceiptFooter(settings?.receipt_footer ?? null); setDefaultPayment(defaultPaymentMethod(settings?.default_payment_method) ?? 'CASH'); if (!paymentTouched.current) setPaymentMethod(defaultPaymentMethod(settings?.default_payment_method) ?? 'CASH'); };
    const timer = setTimeout(() => { apply(getCachedOrganizationSettings(offlineStores.localStore, organizationId)?.data ?? null);
    if (isOnline) void loadOrganizationSettings(organizationId).then(settings => { if (active) { cacheOrganizationSettings(offlineStores.localStore, organizationId, settings); apply(settings); } }).catch(cause => { if (active) presentServerError(cause); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [organizationId, isOnline, t, presentServerError, settingsRevision]);
  useEffect(() => { const timer = setTimeout(() => { void refreshOutboxState(); }, 0); const unsubscribe = offlineStores.outbox.subscribe(() => { void refreshOutboxState(); }); return () => { clearTimeout(timer); unsubscribe(); }; }, [refreshOutboxState]);

  const offlineAvailable = (productId: string) => organizationId && branchId ? getOfflineAvailableQuantity({ store: offlineStores.localStore, outbox: offlineStores.outbox, organizationId, branchId, productId }) : null;
  const addProduct = (product: PosProduct) => applySaleDraftMutation(saleSubmissionInFlight.current, () => { if (!isOnline) { const available = offlineAvailable(product.id); const inCart = cart.find((row) => row.product_id === product.id)?.quantity ?? 0; if (available === null) { setError(t('pos.noOfflineStockSnapshot')); return; } if (inCart + 1 > available) { setError(t('pos.offlineStockAvailable', { count: available })); return; } } setQuote(null); setQuantityText(current => { const next = { ...current }; delete next[product.id]; return next; }); setCart((current) => { const existing = current.find((row) => row.product_id === product.id); return existing ? current.map((row) => row.product_id === product.id ? { ...row, quantity: row.quantity + 1 } : row) : [...current, { product_id: product.id, quantity: 1, product }]; }); });
  const setQuantity = (productId: string, value: string) => applySaleDraftMutation(saleSubmissionInFlight.current, () => { const parsed = stockQuantity(value); setQuantityText(current => ({ ...current, [productId]: value })); if (parsed === null) { setQuote(null); setCart(current => current.map(row => row.product_id === productId ? { ...row, quantity: 0 } : row)); setError(t('posReady.quantityInvalid')); return; } const quantity = parsed; if (!isOnline) { const available = offlineAvailable(productId); if (available === null || quantity > available) { setQuote(null); setCart(current => current.map(row => row.product_id === productId ? { ...row, quantity: 0 } : row)); setError(t('pos.offlineQuantityExceeded', { count: available ?? 0 })); return; } } setQuote(null); setCart((current) => current.map((row) => row.product_id === productId ? { ...row, quantity } : row)); });
  const removeProduct = (productId: string) => applySaleDraftMutation(saleSubmissionInFlight.current, () => { setQuote(null); setCart((current) => current.filter((row) => row.product_id !== productId)); setQuantityText(current => { const next = { ...current }; delete next[productId]; return next; }); });
  const scanInFlight = useRef(false);
  const scan = async () => {
    if (!organizationId || draftLocked || scanInFlight.current) return;
    if (!isOnline) { setError(t('posReady.barcodeOnline')); return; }
    scanInFlight.current = true; setBarcodeBusy(true); setError(null);
    try { const product = await resolvePosBarcode(organizationId, barcode); addProduct(product); setBarcode(''); } catch (cause) { presentServerError(cause); } finally { scanInFlight.current = false; setBarcodeBusy(false); }
  };
  const dispatchInFlight = useRef(false);
  const submitSale = async () => {
    if (!currencyCode) { setError(t('settingsReady.currencyMissing')); return; }
    if (customerFormOpen.current || dispatchInFlight.current || busy || !organizationId || !branchId || !userId || (saleSubmissionInFlight.current && !attempt)) return;
    if (!attempt && (!quote || !quoteAccepted || quoteLoading || lines.some(line => !stockQuantity(String(line.quantity))))) return;
    dispatchInFlight.current = true; saleSubmissionInFlight.current = true; setBusy(true); setError(null); setMessage(null);
    let retained: SaleAttempt | null = attempt;
    let commandRejected = false;
    let persisted = !!attempt;
    const dispatch = async (input: Parameters<typeof completeSale>[0]) => { try { return await completeSale(input); } catch (cause) { commandRejected = isDefinitiveRejection(cause); throw cause; } };
    try {
      if (retained) {
        if (!isOnline) return;
        const accepted = await saleByIdentity(organizationId, branchId, retained.identity.idempotencyKey);
        const id = accepted?.id ?? await dispatch(retained.input);
        await saleDetail(organizationId, branchId, id);
        setSelectedSaleId(id);
      } else {
        const tender = paymentMethod === 'CASH' ? cashPayment(displayTotal, cashTendered) : null;
        if (paymentMethod === 'CASH' && !tender) { setError(t('posReady.cashInvalid')); return; }
        const payments = [{ method: paymentMethod, amount: displayTotal, ...(paymentReference.trim() && paymentMethod !== 'CASH' ? { external_reference: paymentReference.trim() } : {}) }];
        const immutableContent = { organizationId, branchId, lines, payments, customerId: selectedCustomerId };
        const submission = resolveSaleSubmissionIdentity({ branchId, immutableContent, previous: saleSubmissionRef.current, createUuid: randomUUID });
        saleSubmissionRef.current = submission;
        if (!isOnline) {
        const trustedStock = getCachedPosStock(offlineStores.localStore, organizationId, branchId);
        const cached = getCachedSaleQuote(offlineStores.localStore, organizationId, branchId, lines);
        if (!cached || !quoteSyncedAt) throw new Error(t('pos.offlineQuoteRequired'));
        await queueOfflineSaleForCheckout({
          outbox: offlineStores.outbox,
          userId,
          organizationId,
          branchId,
          saleNumber: submission.saleNumber,
          lines,
          payments,
          idempotencyKey: submission.idempotencyKey,
          customerId: selectedCustomerId,
          quote: cached.data,
          quoteSyncedAt: cached.syncedAt,
          trustedAvailableByProduct: trustedStock?.data.productAvailable ?? null,
          requireCrossContextAtomicity: Platform.OS === 'web',
        }, () => {
          setCart([]); setSelectedCustomer(null); setSelectedCustomerId(null);
          saleSubmissionRef.current = null;
        });
        try {
          await refreshOutboxState();
        } catch {
          // The sale intent is already durable and the cart has been cleared.
          // A later subscription or explicit refresh will recover the count.
        }
        setMessage(t('pos.saleSavedPending', { saleNumber: submission.saleNumber }));
        return;

        }
        const fresh = await quoteSale(organizationId, branchId, lines);
        if (!quote || quoteFingerprint(fresh) !== quoteFingerprint(quote)) {
          setQuote(fresh); setQuoteTotal(Number(fresh.total_amount)); setQuoteAccepted(false); setError(t('posReady.changed')); return;
        }
        retained = { cart, identity: submission, input: { organizationId, branchId, saleNumber: submission.saleNumber, lines, payments, idempotencyKey: submission.idempotencyKey, customerId: selectedCustomerId, expectedQuote: fresh, cashTendered: tender?.tendered ?? null } };
        attemptStore.save(attemptKey, retained); persisted = true;
        setAttempt(retained);
        const id = await dispatch(retained.input);
        await saleDetail(organizationId, branchId, id);
        setSelectedSaleId(id);
      }
      attemptStore.remove(attemptKey); setAttempt(null); retained = null;
      setCart([]); setSelectedCustomer(null); setSelectedCustomerId(null); setQuantityText({}); setCashTendered(''); setPaymentReference(''); saleSubmissionRef.current = null;
      setPaymentMethod(defaultPayment); paymentTouched.current = false;
      setMessage(t('posReady.completed')); await refreshSales();
    } catch (cause) {
      if (!persisted && retained) { retained = null; setError(t('posReady.storageUnavailable')); }
      else if (commandRejected || (!retained && isDefinitiveRejection(cause))) {
        attemptStore.remove(attemptKey); setAttempt(null); retained = null; saleSubmissionRef.current = null;
        if (String((cause as { message?: string }).message).includes('SALE_QUOTE_CHANGED') || String((cause as { message?: string }).message).includes('PAYMENT_TOTAL_MISMATCH')) {
          setQuote(null); setQuoteAccepted(false); setError(t('posReady.changed'));
          try { const fresh = await quoteSale(organizationId, branchId, lines); setQuote(fresh); setQuoteTotal(Number(fresh.total_amount)); } catch (refreshCause) { presentServerError(refreshCause); }
        } else { setQuote(null); presentServerError(cause); }
      } else if (retained) setError(t('posReady.recovery'));
      else if (cause instanceof OfflineStockReservationError) setError(t('pos.insufficientStock'));
      else if (cause instanceof OutboxAtomicCoordinationUnavailableError) setError(t('pos.offlineReservationUnavailable'));
      else if (cause instanceof OutboxIdempotencyConflictError) { saleSubmissionRef.current = null; setError(t('pos.saleQueueConflict')); }
      else presentServerError(cause);
    } finally { dispatchInFlight.current = false; saleSubmissionInFlight.current = retained !== null; setBusy(false); }
  };

  if (!organization || !branch) return <SafeAreaView style={styles.safe}><View style={styles.center}><Text>{t('organization.noOrganization')}</Text></View></SafeAreaView>;
  if (!canRead && !canCreate) return <SafeAreaView style={styles.safe}><View style={styles.center}><Text>{t('pos.cannotRead')}</Text><Link href="/">{t('organization.back')}</Link></View></SafeAreaView>;
  const timestamp = (value: string | null) => value ? formatPosDate(value, language) : t('pos.unavailable');
  const paymentLabel = (method: typeof paymentMethods[number]) => t(`pos.${method === 'CASH' ? 'cash' : method === 'CARD' ? 'card' : method === 'MOBILE_MONEY' ? 'mobileMoney' : method === 'BANK_TRANSFER' ? 'bankTransfer' : 'other'}`);
  const tender = cashPayment(displayTotal, cashTendered);
  const submitDisabled = !currencyCode || draftLocked || quoteLoading || !quote || !quoteAccepted || (paymentMethod === 'CASH' && !tender) || isPosSaleActionDisabled({ busy, cartCount: cart.length, total: displayTotal });
  const syncTone = posSyncTone({ isOnline, pendingCount, conflictCount });
  const totalPresentation = priceBlocked ? t('pos.priceUnavailable') : formatPosCurrency(displayTotal, currencyCode, language);

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    {!currencyCode ? <Alert tone="warning" title={t('settingsReady.currencyMissing')} /> : null}
    <PageHeader title={t('pos.title')} subtitle={t('pos.subtitle')} action={<Link href="/" asChild><Pressable accessibilityRole="button" focusable onFocus={() => setFocusedControl('back')} onBlur={() => setFocusedControl(null)} style={StyleSheet.flatten([styles.backButton, focusedControl === 'back' && styles.focusedControl])}><Text style={styles.backText}>{t('organization.back')}</Text></Pressable></Link>} />
    <Surface tone="inset" style={[styles.syncSurface, syncTone === 'offline' && styles.offlineSurface, syncTone === 'conflict' && styles.conflictSurface]}><View style={styles.syncTopline}><StatusBadge label={isOnline ? t('pos.online') : t('pos.offline')} tone={syncTone} /><Text style={styles.syncCounts}>{t('pos.pendingCount', { count: pendingCount })} · {t('pos.conflictCount', { count: conflictCount })}</Text></View>{!isOnline ? <Text style={styles.note}>{t('pos.catalogSynced', { timestamp: timestamp(catalogSyncedAt), stockTimestamp: timestamp(stockSyncedAt) })}</Text> : null}</Surface>
    {error ? <Alert tone="danger" title={error} /> : null}{priceBlocked && canManageBatchPrices ? <Link href="/batches" asChild><Button label={t('pos.manageBatchPrices')} variant="secondary" /></Link> : null}{message ? <Alert tone="success" title={message} /> : null}
    {canCreate ? <View style={styles.workspace}>
      <Stack style={styles.primaryColumn} gap={spacing.lg}>
        <Surface tone="raised" style={styles.card}><Text accessibilityRole="header" style={styles.section}>{t('pos.search')}</Text><TextField accessibilityLabel={t('pos.search')} value={query} onChangeText={setQuery} placeholder={t('posReady.lookup')} style={styles.input} /><Text>{t('posReady.scan')}</Text><TextField accessibilityLabel={t('posReady.scan')} value={barcode} onChangeText={setBarcode} editable={!draftLocked && !barcodeBusy} onSubmitEditing={() => void scan()} /><Button label={t('posReady.scanAction')} disabled={draftLocked || barcodeBusy || !barcode.trim()} onPress={() => void scan()} />{catalogLoading ? <Text>{t('common.loading')}</Text> : products.length === 0 ? <Text>{t('posReady.noProducts')}</Text> : null}{!isOnline ? <Alert tone="warning" title={t('pos.searchingCached')} /> : null}<View style={styles.list}>{products.map((product) => { const productQuantity = cart.find((row) => row.product_id === product.id)?.quantity ?? 0; const selected = isPosProductSelected(productQuantity); return <View key={product.id} style={[styles.productRow, selected && styles.productRowSelected]}><View style={styles.flex}><Text style={styles.bold}>{product.name} / {stockUnitLabel(product.stock_unit, t)}</Text><Text style={styles.meta}>{product.generic_name || product.brand_name || product.sku || ''}{!isOnline && offlineAvailable(product.id) !== null ? ` · ${t('pos.offlineAvailable', { count: offlineAvailable(product.id) })}` : ''}</Text>{selected ? <Text style={styles.selectedProductMeta}>{t('pos.quantity')}: {productQuantity}</Text> : null}</View><Button label={t('pos.add')} accessibilityLabel={`${t('pos.add')} ${product.name}`} disabled={draftLocked} onPress={() => addProduct(product)} style={styles.addButton} /></View>; })}</View></Surface>

      </Stack>
      <Stack style={styles.checkoutColumn} gap={spacing.lg}>
        <Surface tone="raised" style={styles.checkoutCard}><Text accessibilityRole="header" style={styles.section}>{t('pos.cart')}</Text>{cart.length === 0 ? <View style={styles.emptyState}><Text style={styles.meta}>{t('pos.emptyCart')}</Text></View> : cart.map((row) => <View key={row.product_id} style={styles.cartRow}><View style={styles.flex}><Text style={styles.bold}>{row.product.name}</Text><Text style={styles.meta}>{t('pos.quantity')} / {stockUnitLabel(row.product.stock_unit, t)}{!isOnline && offlineAvailable(row.product_id) !== null ? ` · ${t('pos.remaining', { count: offlineAvailable(row.product_id) })}` : ''}</Text></View><View style={{ width: '100%' }}>{quoteLoading ? <Text>{t('common.loading')}</Text> : quote ? <QuoteAllocation quote={quote} product={row.product} currency={currencyCode} /> : <Text>{t('posReady.unavailable')}</Text>}</View><TextField accessibilityLabel={`${t('pos.quantity')} ${row.product.name}`} editable={!draftLocked} keyboardType="decimal-pad" value={quantityText[row.product_id] ?? String(row.quantity)} onChangeText={(value) => setQuantity(row.product_id, value)} style={styles.qty} /><IconButton accessibilityLabel={t('pos.removeItem', { name: row.product.name })} disabled={draftLocked} onPress={() => removeProduct(row.product_id)} style={styles.removeButton}><Text style={styles.remove}>×</Text></IconButton></View>)}<View style={[styles.totalPanel, priceBlocked && styles.totalPanelBlocked]}><Text style={styles.totalLabel}>{t('pos.estimatedTotal')}</Text><Text accessibilityRole="summary" accessibilityLabel={`${t('pos.estimatedTotal')}: ${totalPresentation}`} style={[styles.total, priceBlocked && styles.totalBlocked]}>{totalPresentation}</Text></View>{!quoteAccepted ? <><Alert tone="warning" title={t('posReady.changed')} /><Button label={t('posReady.acceptQuote')} disabled={!quote || draftLocked} onPress={() => { setQuoteAccepted(true); setError(null); }} /></> : null}<Text style={styles.note}>{isOnline ? t('pos.serverPriceNote') : quoteSyncedAt ? t('pos.offlinePriceQuote', { timestamp: formatPosDate(quoteSyncedAt, language) }) : t('pos.noTrustedOfflinePrice')}</Text></Surface>
        <Surface tone="default" style={styles.checkoutCard}><Text accessibilityRole="header" style={styles.section}>{t('pos.payment')}</Text>{canReadCustomers && organizationId && userId ? <PosCustomerPicker organizationId={organizationId} userId={userId} online={isOnline} writable={hasFreshMutationAuthorization(isOnline, usingCachedData, contextSyncedAt)} canManage={can('customer.manage')} locked={draftLocked} onEditingChange={editing => { customerFormOpen.current = editing; setCustomerEditing(editing); }} customerId={selectedCustomerId} customer={selectedCustomer} onSelect={customer => { applySaleDraftMutation(saleSubmissionInFlight.current, () => { setSelectedCustomer(customer); setSelectedCustomerId(customer?.id ?? null); }); }} /> : null}<View style={styles.choiceGroup}><Text style={styles.groupLabel}>{t('pos.paymentMethod')}</Text><View accessibilityRole="tablist" style={styles.chips}>{paymentMethods.map((method) => <ChoiceTab key={method} label={paymentLabel(method)} accessibilityLabel={t('pos.selectPayment', { method: paymentLabel(method) })} selected={paymentMethod === method} focused={focusedControl === `payment:${method}`} disabled={draftLocked} onFocus={() => setFocusedControl(`payment:${method}`)} onBlur={() => setFocusedControl(null)} onPress={() => { applySaleDraftMutation(saleSubmissionInFlight.current, () => { paymentTouched.current = true; setPaymentMethod(method); }); }} />)}</View></View><Text>{t('posReady.defaultPayment')}</Text><Text>{t('posReady.due')}: {formatPosCurrency(displayTotal, currencyCode, language)}</Text>{paymentMethod === 'CASH' ? <><Text>{t('posReady.tender')}</Text><TextField accessibilityLabel={t('posReady.tender')} value={cashTendered} onChangeText={setCashTendered} editable={!draftLocked} keyboardType="decimal-pad" /><Text>{t('posReady.change')}: {tender ? formatPosCurrency(tender.change, currencyCode, language) : '—'}</Text></> : <><Text>{t('posReady.recorded')}</Text><Text>{t('posReady.reference')}</Text><TextField accessibilityLabel={t('posReady.reference')} value={paymentReference} onChangeText={setPaymentReference} editable={!draftLocked} /></>}<Button label={busy ? t('common.loading') : isOnline ? t('pos.completeSale') : t('pos.savePendingSync')} loading={busy} disabled={submitDisabled || customerEditing} onPress={() => void submitSale()} style={styles.submitButton} /></Surface>
      </Stack>
    </View> : null}
    {attempt ? <Surface><Alert tone="warning" title={t('posReady.recovery')} /><Text>{attempt.identity.saleNumber}</Text><Button label={t('posReady.retry')} loading={busy} disabled={!isOnline || busy} onPress={() => void submitSale()} /></Surface> : null}
    {selectedSaleId && userId ? <SaleDetails {...receiptContext} key={selectedSaleId} organizationId={organization.id} branchId={branch.id} saleId={selectedSaleId} userId={userId} business={organization.name} branchName={branch.name} footer={receiptFooter} canRefund={canRefund} online={isOnline} onClose={() => setSelectedSaleId(null)} onChanged={() => { void refreshSales(); }} /> : null}
    {canRead ? <SalesHistory timezone={receiptContext.timezone} organizationId={organization.id} branchId={branch.id} online={isOnline} revision={salesSyncRevision} onOpen={setSelectedSaleId} /> : null}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: surface.canvas }, container: { padding: spacing.xl, gap: spacing.lg, maxWidth: 1280, width: '100%', alignSelf: 'center' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }, backButton: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: shape.md, borderWidth: borderWidths.hairline, borderColor: border.default, backgroundColor: surface.default }, backText: { ...typography.body, color: foreground.brand, fontWeight: '800' }, focusedControl: { borderWidth: focusRing.width, borderColor: focusRing.color }, syncSurface: { padding: spacing.md, gap: spacing.sm }, offlineSurface: { backgroundColor: semantic.offline.background, borderColor: semantic.offline.border }, conflictSurface: { backgroundColor: semantic.conflict.background, borderColor: semantic.conflict.border }, syncTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }, syncCounts: { ...typography.supporting, color: foreground.secondary, fontWeight: '700' }, workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg, flexWrap: 'wrap' }, primaryColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 480, minWidth: 0 }, checkoutColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 360, minWidth: 0 }, card: { gap: spacing.md }, checkoutCard: { gap: spacing.md }, section: { ...typography.sectionTitle, color: foreground.brand }, input: { borderColor: border.default }, list: { gap: spacing.sm }, productRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: borderWidths.hairline, borderColor: border.subtle, borderRadius: shape.md, backgroundColor: surface.default }, productRowSelected: { backgroundColor: surface.info, borderColor: semantic.info.border }, cartRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: borderWidths.hairline, borderBottomColor: border.subtle }, saleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 56, borderBottomWidth: borderWidths.hairline, borderBottomColor: border.subtle, borderRadius: shape.sm }, flex: { flex: 1, minWidth: 0 }, bold: { ...typography.body, fontWeight: '800', color: foreground.primary }, meta: { ...typography.supporting, color: foreground.secondary }, selectedProductMeta: { ...typography.metadata, color: semantic.info.foreground, marginTop: spacing.xs }, addButton: { alignSelf: 'center' }, qty: { width: 72, textAlign: 'center', borderColor: border.default }, removeButton: { borderColor: semantic.danger.border }, remove: { fontSize: 26, lineHeight: 28, color: semantic.danger.foreground }, totalPanel: { backgroundColor: surface.inset, borderRadius: shape.md, padding: spacing.md, gap: spacing.xs, borderWidth: borderWidths.hairline, borderColor: border.subtle }, totalPanelBlocked: { backgroundColor: semantic.warning.background, borderColor: semantic.warning.border }, totalLabel: { ...typography.metadata, color: foreground.secondary, textTransform: 'uppercase' }, total: { ...typography.sectionTitle, color: foreground.brand }, totalBlocked: { color: semantic.warning.foreground }, note: { ...typography.supporting, color: foreground.secondary }, choiceGroup: { gap: spacing.sm }, groupLabel: { ...typography.supporting, color: foreground.secondary, fontWeight: '700' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, choiceTab: { minHeight: touchTarget, maxWidth: 220, borderWidth: borderWidths.hairline, borderColor: border.default, borderRadius: shape.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, justifyContent: 'center', backgroundColor: surface.default }, choiceTabSelected: { backgroundColor: surface.brand, borderColor: surface.brand }, choiceTabFocused: { borderWidth: focusRing.width, borderColor: focusRing.color }, choiceTabText: { ...typography.body, color: foreground.secondary, fontWeight: '700', textAlign: 'center' }, choiceTabTextSelected: { ...typography.body, color: foreground.inverse, fontWeight: '800', textAlign: 'center' }, submitButton: { width: '100%', minHeight: 52 }, emptyState: { minHeight: 88, borderWidth: borderWidths.hairline, borderColor: border.subtle, borderStyle: 'dashed', borderRadius: shape.md, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: surface.inset }, saleAmount: { ...typography.body, color: foreground.primary, fontWeight: '800', textAlign: 'right' }, receiptCard: { gap: spacing.md }, receiptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }, refundButton: { alignSelf: 'flex-start' },
});
