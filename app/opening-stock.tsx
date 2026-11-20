import 'expo-sqlite/localStorage/install';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'expo-router';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../src/i18n/useTranslation';
import { Alert, Button, FormField, PageHeader, Surface, TextField } from '@/components/ui';
import { CatalogSelector } from '@/components/CatalogSelector';
import { useOrganization } from '@/providers/OrganizationProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { useAuth } from '@/providers/AuthProvider';
import { hasFreshMutationAuthorization } from '@/domain/mutationAuthorization';
import { hasDecimalPrecision, isDefinitiveRejection, parseLocaleNumber, validDateOnly } from '@/domain/numericInput';
import { stockUnitLabel } from '@/domain/stockUnits';
import { LocalStore } from '@/offline/localStore';
import { loadBatchStockBalances, type BatchStockBalance, type Product } from '@/services/catalog';
import { postOpeningStock, searchProducts, type OpeningStockInput } from '@/services/catalogReadiness';
import { errorPresentationKey } from '@/utils/errorPresentation';

const local = new LocalStore();
type SavedOpeningRequest = { intent: OpeningStockInput; rejected: boolean };
export default function OpeningStockScreen() {
  const { organization, branch } = useOrganization(); const { user } = useAuth();
  return <OpeningStockContent key={`${user?.id}:${organization?.id}:${branch?.id}`} />;
}
function OpeningStockContent() {
  const { t, i18n } = useTranslation(); const { user } = useAuth();
  const { organization, branch, branches, setBranchId, can, usingCachedData, contextSyncedAt } = useOrganization();
  const { isOnline } = useConnectivity();
  const scope = `${user?.id}:${organization?.id}:${branch?.id}`;
  const key = `opening-stock-form:${scope}`;
  const [product, setProduct] = useState<Product | null>(null);
  const [lot, setLot] = useState(''); const [expiry, setExpiry] = useState(''); const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState(''); const [price, setPrice] = useState(''); const [reason, setReason] = useState('');
  const [pending, setPending] = useState<OpeningStockInput | null>(() => local.get<SavedOpeningRequest>(key)?.data.intent ?? null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [postedBatch, setPostedBatch] = useState<string | null>(null);
  const [balance, setBalance] = useState<BatchStockBalance | null>(null);
  const [postedExpiry, setPostedExpiry] = useState<string | null>(null);
  const [rejected, setRejected] = useState(() => local.get<SavedOpeningRequest>(key)?.data.rejected ?? false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const writable = hasFreshMutationAuthorization(isOnline, usingCachedData, contextSyncedAt) && can('inventory.adjust') && can('inventory.product.create');
  const submit = async () => {
    if (!writable || !organization || !branch || !user || inFlight.current) return;
    const q = parseLocaleNumber(quantity); const c = cost.trim() ? parseLocaleNumber(cost) : null; const p = parseLocaleNumber(price);
    if (!pending && (!product || !lot.trim() || !validDateOnly(expiry) || q === null || q <= 0 || !hasDecimalPrecision(q, 4) || p === null || p <= 0 || !hasDecimalPrecision(p, 2) || (cost.trim() && (c === null || c < 0 || !hasDecimalPrecision(c, 2))) || !reason.trim())) { setError(t('catalogReady.openingInvalid')); return; }
    const intent: OpeningStockInput = pending ?? { organizationId: organization.id, branchId: branch.id, productId: product!.id, lotNumber: lot.trim(), expiryDate: expiry, quantity: q!, purchaseCost: c, sellingPrice: p!, reason: reason.trim(), idempotencyKey: `opening:${Date.now()}:${Math.random().toString(36).slice(2)}` };
    inFlight.current = true; setBusy(true); setError(null);
    let accepted = false;
    try {
      // Persist the complete online request before sending; retries retain the exact payload and key.
      if (typeof globalThis.localStorage === 'undefined') throw new Error('DURABLE_STORAGE_REQUIRED');
      local.set(key, { data: { intent, rejected: false }, syncedAt: new Date().toISOString() }); setPending(intent); setRejected(false);
      const batchId = await postOpeningStock(intent);
      accepted = true;
      local.remove(key);
      if (!mounted.current) return;
      setPending(null); setPostedBatch(batchId); setPostedExpiry(intent.expiryDate); setQuantity('');
      const rows = await loadBatchStockBalances(intent.organizationId, intent.branchId, [batchId]);
      if (mounted.current) setBalance(rows[0] ?? null);
    } catch (cause) {
      if (!accepted && isDefinitiveRejection(cause)) {
        local.set(key, { data: { intent, rejected: true }, syncedAt: new Date().toISOString() });
        if (mounted.current) setRejected(true);
      }
      if (mounted.current) setError(t(errorPresentationKey(cause)));
    }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const disabled = busy || pending !== null || !writable;
  const fields = [
    { label: t('catalog.lotNumber'), value: lot, change: setLot, decimal: false },
    { label: t('catalog.expiryDate'), value: expiry, change: setExpiry, decimal: false },
    { label: `${t('inventory.quantity')} · ${stockUnitLabel(product?.stock_unit, t)}`, value: quantity, change: setQuantity, decimal: true },
    { label: t('catalog.purchaseCost'), value: cost, change: setCost, decimal: true },
    { label: t('catalog.sellingPrice'), value: price, change: setPrice, decimal: true },
    { label: t('inventory.reason'), value: reason, change: setReason, decimal: false },
  ];
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
    <PageHeader title={t('catalogReady.openingStock')} subtitle={t('catalogReady.openingDescription')} />
    <View style={s.row}><Link href="/inventory" asChild><Button variant="secondary" label={t('inventory.title')} /></Link><Link href="/operations" asChild><Button variant="secondary" label={t('catalogReady.importStock')} /></Link></View>
    <FormField label={t('organization.branch')}><View style={s.row}>{branches.map((item) => <Button variant="secondary" key={item.id} disabled={busy || pending !== null} label={`${item.id === branch?.id ? '✓ ' : ''}${item.name}`} onPress={() => setBranchId(item.id)} />)}</View></FormField>
    {!writable ? <Alert tone="warning" title={t('catalogReady.onlineOnly')} /> : null}
    {error ? <Alert tone="danger" title={error} /> : null}
    {postedBatch ? <Surface style={s.card}><Alert tone="success" title={t('catalogReady.openingSaved')} />{balance ? <Text>{t('inventory.onHand')}: {new Intl.NumberFormat(i18n.language).format(balance.on_hand_quantity)} · {t('catalog.reservedQuantity')}: {new Intl.NumberFormat(i18n.language).format(balance.reserved_quantity)} · {postedExpiry && postedExpiry < new Date().toISOString().slice(0, 10) ? t('production.inventoryView.notSellable') : `${t('catalog.availableQuantity')}: ${new Intl.NumberFormat(i18n.language).format(balance.available_quantity)}`} {product ? stockUnitLabel(product.stock_unit, t) : ''}</Text> : <Text>{t('catalog.balanceUnavailable')}</Text>}<Link href="/inventory" asChild><Button label={t('catalogReady.verifyInventory')} /></Link></Surface> : null}
    {pending ? <Surface style={s.card}><Alert tone="warning" title={t('catalogReady.retryOpening')} /><Text>{pending.lotNumber} · {pending.quantity} · {pending.expiryDate}</Text><Button label={t('catalogReady.retry')} loading={busy} disabled={!writable} onPress={() => void submit()} />{rejected ? <Button variant="secondary" disabled={busy} label={t('catalogReady.reviseRequest')} onPress={() => { local.set(`${key}:rejected:${pending.idempotencyKey}`, { data: pending, syncedAt: new Date().toISOString() }); local.remove(key); setPending(null); setRejected(false); }} /> : null}</Surface> : null}
    <Surface style={s.card}>
      <CatalogSelector<Product> scope={scope} label={t('catalog.selectProduct')} selectedLabel={product?.name} disabled={disabled} load={(query, page) => searchProducts(organization!.id, query, page)} renderLabel={(item) => `${item.name} · ${item.sku ?? ''} · ${stockUnitLabel(item.stock_unit, t)}`} onSelect={setProduct} />
      {fields.map((field) => <FormField key={field.label} label={field.label} hint={field.label === t('catalog.expiryDate') ? t('catalogReady.dateHint') : undefined}><TextField accessibilityLabel={field.label} value={field.value} onChangeText={field.change} editable={!disabled} keyboardType={field.decimal ? 'decimal-pad' : 'default'} /></FormField>)}
      <Button label={t('catalogReady.postOpening')} loading={busy} disabled={disabled || !product} onPress={() => void submit()} />
    </Surface>
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1 }, container: { width: '100%', maxWidth: 1000, alignSelf: 'center', padding: 16, gap: 16 }, card: { padding: 16, gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
